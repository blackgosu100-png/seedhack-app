// 📊 마진 대시보드 ↔ 앱 연결 — 크롬 확장(로켓그로스 확장 background.js)이 하던 일을 앱이 대신한다(2026-10-13, 앱만 쓰기로 결정)
// 대시보드(legacy.html)는 확장과 postMessage로 대화한다: { __to: "rocketg-extension", requestId, message:{ action, payload } }
//   → preload/dash.cjs가 받아 여기로 넘기고, 응답을 { __from: "rocketg-extension", type: "response", requestId, response }로 돌려준다
// 지금 지원: wing-download(정산 3종 파일) · ad-download(광고 PA 보고서) · get-vendor-id · reset-wing-login · ping
//   쿠폰은 아직 — "준비 중" 응답
// Wing 요청은 로그인된 Wing 화면 안에서 실행한다(앱의 Wing 로그인을 그대로 씀 · 확장처럼 쿠키를 읽어 따로 보내지 않음)
import { app, net } from "electron";
import fs from "node:fs";
import path from "node:path";

const WING_BASE = "https://wing.coupang.com/tenants/rfm/v2/settlements";
const WING_REPORT_TYPES = ["CATEGORY_TR", "WAREHOUSING_SHIPPING", "STORAGE_FEE"];
const WING_DOWNLOAD_HOSTS = ["coupangcdn.com", "amazonaws.com", "cloudfront.net"];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstDateToUtcIso = (d) => new Date(`${d}T00:00:00+09:00`).toISOString().replace(/\.\d{3}Z$/, ".000Z");

// Wing 화면 안에서 POST(JSON) — x-xsrf-token = Wing 세션의 XSRF-TOKEN 쿠키 값(확장과 같은 헤더 · httpOnly여도 앱은 세션에서 읽을 수 있음)
const xsrfOf = async (wc) => { const c = await wc.session.cookies.get({ url: "https://wing.coupang.com", name: "XSRF-TOKEN" }).catch(() => []); return c[0]?.value ? decodeURIComponent(c[0].value) : ""; };
const wingPost = async (wc, url, body) => { const xsrf = await xsrfOf(wc); return wc.executeJavaScript(`(async () => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const xsrf = ${JSON.stringify(xsrf)};
    const r = await fetch(${JSON.stringify(url)}, { method: "POST", credentials: "include", cache: "no-store", signal: c.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", "x-xsrf-token": xsrf },
      body: ${JSON.stringify(JSON.stringify(body))} });
    const text = await r.text();
    return { status: r.status, type: r.headers.get("content-type") || "", text, xsrf: !!xsrf };
  } catch (e) { return { error: e.name === "AbortError" ? "시간 초과" : String(e.message || e) }; } finally { clearTimeout(t); }
})()`, true).catch((e) => ({ error: String(e.message || e) })); };

const json = (r) => { try { return JSON.parse(r.text); } catch { return null; } };
const isLoginLost = (r) => r.status === 401 || r.status === 403 || (r.status === 200 && !/json/.test(r.type));
const allowedUrl = (url) => { try { const u = new URL(url); const h = u.hostname.toLowerCase(); return u.protocol === "https:" && (h === "wing.coupang.com" || WING_DOWNLOAD_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))); } catch { return false; } };
const fileName = (url) => { try { const n = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); if (n.endsWith(".xlsx")) return n; } catch {} return `wing_${Date.now()}.xlsx`; };

// 정산 다운로드 전체 흐름(확장 runWingDownload와 같음): 70% 정산행 → 3종 × N주 보고서 요청 → 완료될 때까지 8초마다 확인 → 파일 받기
export async function runWingDownload({ startDate, endDate } = {}, { wingWc, ensureWing, emit }) {
  const logs = [];
  const log = (msg) => { const line = `[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] ${msg}`; logs.push(line); if (logs.length > 200) logs.shift(); emit({ type: "log", channel: "wing", line }); };
  if (!startDate || !endDate) { // 기본: 지난달 전체
    const t = new Date(), first = new Date(t.getFullYear(), t.getMonth(), 1), last = new Date(first - 864e5);
    const f = (d) => d.toLocaleDateString("sv-SE");
    startDate = f(new Date(last.getFullYear(), last.getMonth(), 1)); endDate = f(last);
  }
  try {
    log(`정산 다운로드 시작: ${startDate} ~ ${endDate}`);
    const wc = await ensureWing();
    if (!wc) return { ok: false, needsLogin: true, msg: "Wing 로그인이 필요합니다. 왼쪽 Wing 로그인 메뉴에서 로그인한 뒤 다시 시도해주세요.", logs };

    log("정산 목록 조회 중...");
    const s = await wingPost(wc, `${WING_BASE}/status/api`, { startDate: kstDateToUtcIso(startDate), endDate: kstDateToUtcIso(endDate), searchDateType: "SALES" });
    if (s.error) throw new Error(`정산 목록 요청 실패: ${s.error}`);
    if (isLoginLost(s)) return { ok: false, needsLogin: true, msg: "Wing 로그인이 만료되었습니다. 왼쪽 Wing 로그인 메뉴에서 다시 로그인한 뒤 시도해주세요.", logs };
    if (s.status !== 200) throw new Error(`정산 목록 조회 실패: HTTP ${s.status}`);
    const keys = (json(s)?.settlementStatusReports || []).filter((x) => x.settlementRatio === 70 && x.settlementGroupKey).map((x) => x.settlementGroupKey);
    log(`70% 정산행 ${keys.length}개 발견: ${keys.join(", ")}`);
    if (!keys.length) return { ok: false, msg: "70% 정산행이 없습니다. 날짜 범위를 확인하세요.", logs };

    log(`${keys.length}주 × 3종 = ${keys.length * 3}개 보고서 큐잉 중...`);
    const ids = {}, queueStart = Date.now();
    for (const gkey of keys) for (const rtype of WING_REPORT_TYPES) {
      const r = await wingPost(wc, `${WING_BASE}/request-download/api`, { sellerReportType: rtype, requestTime: String(Date.now()), locale: "ko", settlementGroupKeys: [gkey] });
      const j = r.status === 200 ? json(r) : null;
      if (j?.requestId) { ids[j.requestId] = { rtype, gkey }; log(`큐잉 완료: ${rtype} / ${gkey} → ${j.requestId}`); }
      else log(`큐잉 실패: ${rtype} / ${gkey} (${r.error || r.status})`);
      await sleep(500);
    }
    const expected = Object.keys(ids).length;
    if (!expected) return { ok: false, msg: "큐잉 실패", logs };
    log(`큐잉 완료 (${expected}개) — 바로 파일 생성 확인 시작`);

    // 다운로드 폴더에도 저장(확장과 같은 rocketg_날짜_시각 폴더)
    const pad = (n) => String(n).padStart(2, "0"), n = new Date();
    const folder = `rocketg_${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}_${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
    const dir = path.join(app.getPath("downloads"), folder);
    const files = [], fileBlobs = [], done = new Set(), t0 = Date.now();
    log(`파일 생성 대기 중... (${expected}개)`);
    while (Date.now() - t0 < 180000) {
      log(`상태 확인 중... (${Math.floor((Date.now() - t0) / 1000)}초 경과, ${files.length}/${expected} 완료)`);
      const l = await wingPost(wc, `${WING_BASE}/download-list/api`, { requestTimeFrom: String(queueStart - 5000), requestTimeTo: String(Date.now() + 60000) });
      if (isLoginLost(l)) { log("인증 만료"); break; }
      const list = l.status === 200 ? json(l) : null;
      if (!Array.isArray(list)) log(`목록 조회 실패: ${l.error || l.status}`);
      for (const x of Array.isArray(list) ? list : []) {
        if (x.downloadStatus !== "COMPLETED" || !ids[x.requestId] || done.has(x.requestId)) continue;
        const label = `${ids[x.requestId].rtype}/${ids[x.requestId].gkey}`;
        const u = await wingPost(wc, `${WING_BASE}/download/api/v2`, { requestTime: String(x.requestTime), locale: "ko" });
        const url = u.status === 200 ? json(u)?.url : null;
        if (!url) { log(`URL 조회 실패: ${label} (${u.error || u.status})`); continue; }
        if (!allowedUrl(url)) { log(`허용되지 않은 다운로드 URL: ${label}`); continue; }
        const fname = fileName(url);
        log(`다운로드 중: ${fname} (${new URL(url).hostname})`);
        try {
          const r = await net.fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = Buffer.from(await r.arrayBuffer());
          try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, fname), buf); } catch (e) { log(`폴더 저장 실패(대시보드 전달은 계속): ${e.message}`); }
          fileBlobs.push({ name: fname, base64: buf.toString("base64"), mimeType: XLSX });
          files.push(fname); done.add(x.requestId);
          log(`완료 (${files.length}/${expected}): ${fname}`);
          emit({ type: "progress", channel: "wing", progress: files.length, total: expected, file: fname });
        } catch (e) { log(`다운로드 실패: ${fname} (${e.message})`); }
      }
      if (files.length >= expected) break;
      await sleep(8000);
    }
    if (!files.length) return { ok: false, msg: "다운로드된 파일이 없습니다.", logs };
    log(`완료! ${files.length}개 파일 저장됨 → 다운로드/${folder}/`);
    return { ok: true, msg: `완료 · ${files.length}개 파일`, folder, files, fileBlobs, logs };
  } catch (e) {
    log(`오류: ${e.message}`);
    return { ok: false, msg: "Wing 다운로드 오류: " + e.message, logs };
  }
}

// ── 광고 보고서(PA 일별·키워드) — 확장 runAdDownload와 같은 흐름: 캠페인 목록 → 보고서 생성 요청 → 완료 확인 → 엑셀 받기 ──
// 요청은 광고센터 화면(advertising.coupang.com, Wing과 같은 세션) 안에서 실행 — ctx.adPage()가 그 화면을 준비(로그인 필요하면 잠깐 보여 줌)
const AD_GRAPHQL = "https://advertising.coupang.com/marketing-reporting/v2/graphql";
const AD_EXCEL_URL = "https://advertising.coupang.com/marketing-reporting/v2/api/excel-report";
const adGql = async (wc, payload) => {
  const r = await wc.executeJavaScript(`(async () => {
    try {
      const r = await fetch(${JSON.stringify(AD_GRAPHQL)}, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "*/*" }, body: ${JSON.stringify(JSON.stringify(payload))} });
      return { status: r.status, type: r.headers.get("content-type") || "", text: await r.text() };
    } catch (e) { return { error: String(e.message || e) }; }
  })()`, true).catch((e) => ({ error: String(e.message || e) }));
  if (r.error) throw new Error(`광고 요청 실패: ${r.error}`);
  if (r.status !== 200) throw new Error(`광고 GraphQL 응답 ${r.status}: ${String(r.text).slice(0, 300)}`);
  if (!/json/.test(r.type)) throw new Error("광고센터 로그인이 필요합니다. 광고센터에 로그인한 뒤 다시 시도해주세요.");
  const data = json(r);
  if (!data) throw new Error(`광고 GraphQL JSON 파싱 실패: ${String(r.text).slice(0, 300)}`);
  const errors = Array.isArray(data) ? data.flatMap((x) => x?.errors || []) : data.errors || [];
  if (errors.length) throw new Error(`광고 GraphQL 오류: ${errors.map((e) => e.message || JSON.stringify(e)).join(" / ").slice(0, 500)}`);
  return data;
};
const toInt = (d) => parseInt(String(d).replace(/-/g, ""), 10);
export async function runAdDownload({ startDate, endDate } = {}, { adPage, emit }) {
  const logs = [];
  const log = (msg) => { const line = `[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] ${msg}`; logs.push(line); if (logs.length > 200) logs.shift(); emit({ type: "log", channel: "ad", line }); };
  try {
    if (!startDate || !endDate) throw new Error("광고 다운로드 기간이 없습니다.");
    log(`광고 보고서 다운로드 시작: ${startDate} ~ ${endDate}`);
    log("광고센터 로그인 확인 중...");
    const wc = await adPage(log);
    if (!wc) return { ok: false, msg: "광고센터 로그인 대기 시간이 초과되었습니다. 로그인 후 다시 시도해주세요.", logs };
    const sd = toInt(startDate), ed = toInt(endDate);
    log("캠페인 목록 조회 중...");
    const list = await adGql(wc, [{ operationName: "GetCampaignListInBillboard", variables: { startDate: sd, endDate: ed, reportType: "pa" },
      query: "query GetCampaignListInBillboard($startDate: Int!, $endDate: Int!, $reportType: ReportType!) {\n  getCampaignList(startDate: $startDate, endDate: $endDate, reportType: $reportType) {\n    id\n    name\n    __typename\n  }\n}" }]);
    const campaignIds = (list?.[0]?.data?.getCampaignList || []).map((c) => c.id);
    log(`캠페인 ${campaignIds.length}개 조회 완료`);
    if (!campaignIds.length) log("캠페인 목록이 비어 있어 전체 캠페인 보고서 요청으로 다시 시도합니다.");
    const q = await adGql(wc, [{ variables: { reportType: "pa", startDate: sd, endDate: ed, dateGroup: "daily", granularity: "keyword", campaignIds, excludeIfNoClickCount: true },
      query: "mutation ($startDate: Int!, $endDate: Int!, $campaignIds: [ID], $reportType: ReportType!, $dateGroup: DateGroup!, $granularity: Granularity, $excludeIfNoClickCount: Boolean) {\n  requestReport(data: {startDate: $startDate, endDate: $endDate, campaignIds: $campaignIds, reportType: $reportType, dateGroup: $dateGroup, granularity: $granularity, excludeIfNoClickCount: $excludeIfNoClickCount}) {\n    id\n    status\n    __typename\n  }\n}" }]);
    const reportId = q?.[0]?.data?.requestReport?.id;
    if (!reportId) throw new Error("광고 보고서 생성 요청 실패");
    log(`보고서 생성 요청 완료: ${reportId}`);
    // 완료 확인(2초마다 최대 2분) — 목록 조회가 실패하면 파일 받기에서 직접 확인
    let completed = null; const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const sec = Math.floor((Date.now() - t0) / 1000);
      let rep = null;
      try {
        const d = await adGql(wc, [{ variables: { data: { reportType: "pa", page: 1, pageSize: 10, duration: 90, onlyScheduledReport: false } },
          query: "query($data: QueryReportRequestsInput!) {\n  reportList(data: $data) {\n    reports {\n      id\n      status\n      __typename\n    }\n  }\n}" }]);
        rep = (d?.[0]?.data?.reportList?.reports || []).find((x) => x.id === reportId);
      } catch (e) { if (/reportList/.test(e.message)) { log(`광고 보고서 목록 확인 실패 - 다운로드 준비 여부를 직접 확인합니다. (${sec}초)`); await sleep(2000); continue; } throw e; }
      if (rep) { log(`광고 보고서 생성 중... (${sec}초, ${rep.status})`); if (rep.status === "completed") { completed = true; break; } if (rep.status === "failed" || rep.status === "error") { completed = false; break; } }
      else log(`광고 보고서 생성 대기 중... (${sec}초)`);
      await sleep(2000);
    }
    if (completed === false) return { ok: false, msg: "광고 보고서 생성 실패 또는 타임아웃", logs };
    if (completed === null) log("광고 보고서 목록 확인을 건너뛰고 파일 다운로드 준비 여부를 직접 확인합니다.");
    log("광고 엑셀 다운로드 중...");
    let file = null, last = ""; const t1 = Date.now();
    while (Date.now() - t1 < 120000) {
      const r = await wc.executeJavaScript(`(async () => {
        try {
          const r = await fetch(${JSON.stringify(`${AD_EXCEL_URL}?id=${encodeURIComponent(reportId)}`)}, { credentials: "include", cache: "no-store", headers: { Accept: "*/*" } });
          if (!r.ok) return { status: r.status, text: (await r.text().catch(() => "")).slice(0, 120) };
          const b = new Uint8Array(await r.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
          return { status: 200, cd: r.headers.get("content-disposition") || "", size: b.length, base64: btoa(s) };
        } catch (e) { return { error: String(e.message || e) }; }
      })()`, true).catch((e) => ({ error: String(e.message || e) }));
      if (r.status === 200 && r.size > 0) {
        const utf = r.cd.match(/filename\*=UTF-8''([^;]+)/i), ascii = r.cd.match(/filename=([^;]+)/i);
        file = { name: utf ? decodeURIComponent(utf[1].trim().replace(/"/g, "")) : ascii ? ascii[1].trim().replace(/"/g, "") : `ad_report_${reportId}.xlsx`, base64: r.base64 };
        break;
      }
      last = r.error || (r.status === 200 ? "빈 파일 응답" : `HTTP ${r.status}${r.text ? `: ${r.text}` : ""}`);
      const sec = Math.floor((Date.now() - t1) / 1000);
      if (sec === 0 || sec % 10 < 2) log(`광고 보고서 파일 준비 대기 중... (${sec}초, ${last})`);
      await sleep(2000);
    }
    if (!file) throw new Error(`광고 엑셀 다운로드 준비 시간 초과: ${last || "응답 없음"}`);
    const pad = (n) => String(n).padStart(2, "0"), n = new Date();
    const dir = path.join(app.getPath("downloads"), `rocketg_ad_${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}_${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`);
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, file.name), Buffer.from(file.base64, "base64")); } catch (e) { log(`폴더 저장 실패(대시보드 전달은 계속): ${e.message}`); }
    log(`완료! ${file.name}`);
    emit({ type: "progress", channel: "ad", progress: 1, total: 1, file: file.name });
    return { ok: true, msg: `완료 · ${file.name}`, file: file.name, fileBlob: { name: file.name, base64: file.base64, mimeType: XLSX }, logs };
  } catch (e) {
    log(`오류: ${e.message}`);
    return { ok: false, msg: "광고 다운로드 오류: " + e.message, logs };
  }
}

// 확장 action → 앱 처리. ctx: { ensureWing, adPage, emit, wingSession, resetWing }
export async function handleExtAction(message, ctx) {
  const a = message?.action, p = message?.payload || {};
  if (a === "ping") return { ok: true, msg: "pong" };
  if (a === "get-vendor-id") {
    const c = await ctx.wingSession.cookies.get({ name: "sc_vid" }).catch(() => []);
    const vendorId = c.find((x) => /coupang\.com$/.test(x.domain.replace(/^\./, "")))?.value || c[0]?.value || null;
    return { ok: !!vendorId, vendorId, msg: vendorId ? "vendorId 확인" : "Wing 로그인 필요 (sc_vid 쿠키 없음)" };
  }
  if (a === "wing-download") return runWingDownload(p, ctx);
  if (a === "reset-wing-login") return ctx.resetWing();
  if (a === "ad-download") return runAdDownload(p, ctx);
  return { ok: false, msg: `앱에서 아직 지원하지 않는 기능이에요 (${a || "알 수 없음"})` };
}
