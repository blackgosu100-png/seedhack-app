// 📄 상세페이지·🖼 썸네일 AI 제공자 고르기 + 서버 중계 — 대표님 맥(개발 PC)은 지금처럼 로컬 도구(Claude CLI·gcloud ADC·macOS Vision)를 쓰고,
// 그 밖(수강생 윈도우 PC 등)은 대시보드 서버 `${DASHBOARD_URL}/api/signal/ai` 가 대표님 키로 대신 부른다(task: claude / image / ocr, 대시보드 web/src/lib/signal-relay.mjs).
//   SEEDHACK_RELAY=server — 로컬 도구가 있어도 서버 중계로(맥에서 윈도우 흉내·시험) · SEEDHACK_RELAY=off — 서버 중계 안 씀(로컬 도구 없으면 AI 생략)
//   하네스(로그인 없는 임시 userData): DASHBOARD_URL · SIGNAL_VENDOR_ID · SIGNAL_ACCESS_TOKEN 환경변수
// 한도 초과·로그인 만료처럼 다시 해도 안 되는 실패는 한 번 겪으면 이번 실행 동안 더 부르지 않고, 수강생용 안내 글(relayNotice)을 남긴다.
import fs from "node:fs";
import path from "node:path";

const noop = () => {};
export const forceServer = () => process.env.SEEDHACK_RELAY === "server";
// 노드 단독 테스트(Electron 아님)에서는 시키지 않는 한 서버를 부르지 않는다
export const relayEnabled = () => process.env.SEEDHACK_RELAY === "server" || (process.env.SEEDHACK_RELAY !== "off" && !!process.versions.electron);

// 지금 작업 ID — 서버가 "하루 상세페이지 수"를 센다(index.js 가 작업 시작 때 넣음)
let curJob = null;
export const setRelayJob = (id) => { curJob = id ? String(id) : null; };

// 수강생에게 보여 줄 마지막 안내(한도·로그인·연결). index.js 가 결과 화면 경고로 보여 준다
let notice = null, blocked = null;
export const relayNotice = () => notice;
export const clearRelayNotice = () => { notice = null; blocked = null; };

// 서버 오류 → 수강생용 한국어 안내(가독성 매뉴얼: 무엇이 안 됐는지 + 어떻게 하면 되는지, 짧게)
export function userMessage({ status, code, error } = {}) {
  if (code === "login" || status === 401) return "앱 로그인이 끝났어요. 앱을 껐다 켜서 다시 로그인해 주세요.";
  if (code === "approval" || status === 403) return /Wing|판매자/.test(error || "") ? "Wing 에 로그인해야 AI 를 쓸 수 있어요. ① Wing 탭에서 로그인해 주세요." : "승인된 수강생만 AI 를 쓸 수 있어요. 승인을 기다려 주세요.";
  if (code === "pages" || code === "daily" || code === "global") return error || "오늘 쓸 수 있는 AI 사용량을 다 썼어요. 내일 다시 해 주세요.";
  if (code === "wing") return "Wing 에 로그인해야 AI 를 쓸 수 있어요. ① Wing 탭에서 로그인해 주세요.";
  if (code === "net") return "인터넷 연결이 불안정해 AI 를 부르지 못했어요. 연결을 확인하고 다시 해 주세요.";
  if (code === "setup" || status === 503) return "AI 서버가 잠시 준비 중이에요. 잠시 뒤 다시 해 주세요.";
  return "AI 처리 중 문제가 생겼어요. 잠시 뒤 다시 해 주세요.";
}
const STICKY = new Set(["login", "approval", "wing", "pages", "daily", "global"]);

async function ident() {
  const el = await import("electron").catch(() => null);
  const url = process.env.DASHBOARD_URL || (await import("../auth-config.js")).DASHBOARD_URL;
  let vendorId = process.env.SIGNAL_VENDOR_ID || null, token = process.env.SIGNAL_ACCESS_TOKEN || null;
  if (el?.session && (!vendorId || !token)) {
    try { const a = await import("../auth.js"); vendorId ||= await a.wingVendorId(); token ||= await a.accessToken(); } catch {}
  }
  const doFetch = el?.net?.fetch ? el.net.fetch.bind(el.net) : globalThis.fetch;
  return { url, vendorId, token, doFetch };
}

// 서버 한 번 부르기 → { ok, result, model, usage, costUsd, quota } 또는 { error, code, status, userMessage }
// 일시 실패(연결·503·5xx)는 2번 더(5초·15초 뒤). 한도·로그인은 다시 하지 않는다.
export async function callRelay(task, input, { timeoutMs = 300000, log = noop, retries = 2 } = {}) {
  if (blocked) return { ...blocked };
  const { url, vendorId, token, doFetch } = await ident();
  if (!vendorId) { blocked = { error: "Wing 판매자ID 없음", code: "wing", userMessage: userMessage({ code: "wing" }) }; notice = blocked.userMessage; return { ...blocked }; }
  const body = JSON.stringify({ vendor_id: vendorId, access_token: token || undefined, task, job_id: curJob || undefined, input });
  let last = null;
  for (let a = 0; a <= retries; a++) {
    if (a) await new Promise((r) => setTimeout(r, a === 1 ? 5000 : 15000));
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    let r, j;
    try { r = await doFetch(`${url}/api/signal/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ac.signal }); j = await r.json().catch(() => ({})); }
    catch (e) { last = { error: e?.name === "AbortError" ? `서버 응답 시간 초과(${Math.round(timeoutMs / 1000)}초)` : `서버 연결 실패: ${String(e?.message || e).slice(0, 80)}`, code: "net" }; continue; }
    finally { clearTimeout(t); }
    if (r.ok && j?.ok) return { ok: true, result: j.result, model: j.model || "server", usage: j.usage || null, costUsd: j.costUsd ?? null, quota: j.quota || null };
    last = { error: j?.error || `서버 응답 ${r.status}`, code: j?.code || null, status: r.status };
    if (STICKY.has(last.code) || [400, 401, 403, 413, 429].includes(r.status)) break;
  }
  last.userMessage = userMessage(last);
  if (STICKY.has(last.code) || last.status === 401 || last.status === 403) { blocked = last; notice = last.userMessage; }
  else if (!notice) notice = last.userMessage;
  log("dim", `  ☁ 서버 AI(${task}) 실패 · ${last.error}`);
  return { ...last };
}

// ── 사진 줄여 보내기 ── Vercel 요청 한도(4.5MB) 안에 들도록. 긴 변 maxSide, JPEG(투명 PNG 는 PNG 그대로)
// → { mime, b64, w, h, scale(보낸 크기/원래 크기) }
export async function prepImage(file, { maxSide = 1280, quality = 82, keepPng = false } = {}) {
  const { nativeImage } = await import("electron");
  let im = nativeImage.createFromPath(file);
  if (im.isEmpty()) { // webp 등 nativeImage 가 못 여는 것 — 원본 그대로(작으면)
    const buf = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();
    return { mime: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg", b64: buf.toString("base64"), w: 0, h: 0, scale: 1 };
  }
  const { width: w0, height: h0 } = im.getSize();
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  if (s < 1) im = im.resize({ width: Math.round(w0 * s), height: Math.round(h0 * s), quality: "best" });
  const { width: w, height: h } = im.getSize();
  const png = /\.png$/i.test(file) && (keepPng || hasAlpha(im));
  const buf = png ? im.toPNG() : im.toJPEG(quality);
  return { mime: png ? "image/png" : "image/jpeg", b64: buf.toString("base64"), w, h, scale: w0 ? w / w0 : 1 };
}
function hasAlpha(im) {
  try { const bm = im.toBitmap(), step = Math.max(4, Math.floor(bm.length / 4 / 4000) * 4); for (let i = 3; i < bm.length; i += step) if (bm[i] < 250) return true; } catch {}
  return false;
}

// ── Claude 구조화 호출(서버) ── cli.js runStructured 와 같은 인자·같은 반환({ ok, result, model, usage, costUsd } | { error })
// allowedTools 에 Read 가 있으면 입력 글 속 사진 절대경로를 찾아 첨부한다(서버는 Read 도구가 없으므로). WebSearch 는 서버에서 쓰지 않는다.
// 경로에 빈칸이 있을 수 있어("Application Support", 윈도우 사용자 이름) 확장자 끝마다 앞쪽 시작점("/" 또는 "C:\")을 차례로 대 보고 실제 있는 파일만 고른다
const IMG_END = /\.(?:png|jpe?g|webp)(?=$|[\s"'`)\],;·])/gi;
export function findImagePaths(text) {
  const seen = new Set(), out = [];
  for (const line of String(text || "").split("\n")) {
    for (const m of line.matchAll(IMG_END)) {
      const end = m.index + m[0].length;
      for (let s = 0; s < m.index; s++) {
        const c = line[s];
        if (!(c === "/" || (/[A-Za-z]/.test(c) && line[s + 1] === ":" && line[s + 2] === "\\"))) continue;
        if (s > 0 && !/[\s:("'`=\[]/.test(line[s - 1])) continue;
        const p = line.slice(s, end);
        if (fs.existsSync(p)) { if (!seen.has(p)) { seen.add(p); out.push(p); } break; }
      }
    }
  }
  return out;
}
const READ_NOTE = "\n\n[이 환경 안내] Read 도구는 없습니다. 입력 글에 적힌 사진 파일은 모두 이 메시지에 첨부되어 있고, 각 사진 바로 앞 줄에 그 파일 경로가 적혀 있습니다. 첨부된 사진을 직접 보고 판정하세요(열어 본 것으로 칩니다).";
// 사진 수에 따라 크기를 줄여 합계가 서버 한도(약 3.4MB) 안에 들게
const BUDGET = 3_400_000;
export async function relayStructured({ system, schema, text, model = "sonnet", timeoutMs = 300000, allowedTools = null, purpose = "other", log = noop } = {}) {
  if (!system || !schema) return { error: "지시문(system)과 스키마(schema)가 필요합니다" };
  const t0 = Date.now();
  const wantRead = Array.isArray(allowedTools) && allowedTools.includes("Read");
  const files = wantRead ? findImagePaths(text).slice(0, 24) : [];
  let images = [];
  if (files.length) {
    const side = files.length <= 2 ? 1568 : files.length <= 6 ? 1280 : files.length <= 12 ? 1024 : 800;
    for (const [side2, q] of [[side, 82], [Math.round(side * 0.75), 70], [Math.round(side * 0.55), 60]]) {
      images = [];
      for (const f of files) { try { const p = await prepImage(f, { maxSide: side2, quality: q }); images.push({ mime: p.mime, b64: p.b64, label: `파일: ${f}` }); } catch {} }
      if (images.reduce((s, im) => s + im.b64.length, 0) <= BUDGET) break;
    }
  }
  const r = await callRelay("claude", { purpose, system: wantRead ? system + READ_NOTE : system, schema, text: String(text ?? ""), images, model, effort: "medium" }, { timeoutMs, log });
  if (!r.ok) return { error: r.userMessage ? `${r.userMessage} (${r.error})` : r.error, relay: true, code: r.code };
  return { ok: true, result: r.result, model: `server:${r.model}`, usage: r.usage, costUsd: Number(r.costUsd) || 0, elapsedMs: Date.now() - t0, relay: true };
}
