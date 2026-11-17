// 씨드핵(SEEDHACK) — 메인 프로세스 (구 쿠팡 소싱 신호등)
// 화면: 왼쪽 검은 사이드바(메뉴) + 위 머리줄 + 본문(실제 사이트 화면 또는 패널 화면 — 키워드 분석·수집함·리스트업)
import electron, { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session, net, nativeImage, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { store } from "./store.js";
import { watchWing } from "./wing.js";
import { runExact, stopExact, lookupOne, gate, sleep } from "./exact.js";
import { buildXlsx } from "./excel.js";
import { lookup, recommend, nameLookup } from "./kwdb.js";
import { buildPool, defaultPicks, buildNames, checkName } from "../shared/name-core.js"; // ✍ 상품명 짓기
import { searchKeyword } from "./kwsearch.js";
import { buildListupXlsx, buildCollectXlsx } from "./listup-excel.js";
import { upsertPage, upsertMetric, listCollect, removeCollect, countCollect, pickCollect } from "./collect.js";
import { signIn, signOut, restore, checkVendor, licensed, memberOk, state as authState, GATE_ON, wingVendorId, accessToken } from "./auth.js";
import { DASHBOARD_URL } from "./auth-config.js";
import * as hot from "./hot.js"; // ⬆ 화면만 바로 업데이트
import { recommendViaCli, cliAvailable } from "./ai-cli.js";
import { parseSpecs } from "./spec-core.js";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import { DEFAULTS, buildMarkets, judge, isPB, pbList } from "../shared/strategy-core.js";
import { REVIEW_CAP } from "../shared/review-core.js";
import { summarize as hyojaSummarize, pagePrice } from "../shared/hyoja-core.js";
import { dhashFromGray, grayFromBGRA, rankBySimilarity, specRerank, decidePrice, koHint, toNum } from "./sku-core.js";
import { parseCard, rankCards, decideCost, VERDICT_KO, DEFAULT_WEIGHTS } from "./rank-core.js";
import { combo, scan as kwScan, draw as kwDraw, famousBrands } from "./kw-combo.js";
import { useServer, kwSource, hasLocalDb, rScan, rDraw, rState, rBonus, rLookup, rName, rBrands } from "./kw-remote.js"; // 🔑 키워드 DB 파일이 없는 PC(수강생)는 맥미니 키워드 서버에 묻는다
import { STRATEGY_SYSTEM, STRATEGY_SCHEMA, renderStrategyInput } from "./strategy-prompt.js";
import { runStructured } from "./detail/cli.js";
import { initChat } from "./chat.js";
import { initWave } from "./wave.js"; // 🌊 파도타기
import { initDetail } from "./detail/index.js"; // 📄 상세페이지 자동 생성(1688 상세 이미지 → 한글 상세페이지)
import { handleExtAction } from "./dash-ext.js"; // 📊 마진 대시보드의 확장 요청(Wing 정산 받기)을 앱이 대신

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WING_TREND = "https://wing.coupang.com/tenants/rfm-ss/coupang-trends/popularity-search";
// 앱 시작·⌂ 버튼은 Wing 첫 화면으로 — 일반 브라우저와 같은 경로로 로그인(깊은 주소로 바로 들어가 로그인으로 넘어가는 흐름을 피함)
const WING_HOME = "https://wing.coupang.com/";
const COUPANG_HOME = "https://www.coupang.com/";
const BAR_H = 56, SIDE_W = 200;
let ZOOM = 1; // 발표 모드(화면 공유용) 확대 배율 — 패널과 사이트 화면을 함께 키운다
// 왼쪽 사이드바 폭(접으면 64px) · Wing 화면 오른쪽 칸 폭(🚦 카테고리 판정·수강생 확인 카드) — 화면(panel.js)이 ui:frame으로 알려 준다
let sideW = SIDE_W, stripW = 0;
// 📊 판매 관리(로켓그로스 대시보드 웹): 마진·광고 보고서·쿠폰·재고 — 대시보드 화면을 그대로 띄운다(로그인 유지 persist:dash)
let dashView = null, dashTab = null;
const SELFTEST = process.argv.includes("--selftest");
if (SELFTEST) { const d = path.join(app.getPath("temp"), "signal-selftest-data"); fs.rmSync(path.join(d, "signal-data.json"), { force: true }); app.setPath("userData", d); } // 실제 데이터 파일을 건드리지 않음

// Electron 기본 브라우저 표시에서 앱 이름 부분만 빼고 크롬 엔진 그대로 표기 (사이트 호환용, 엔진은 실제 크롬)
// (한글 앱 이름이 들어가면 쿠팡 서버가 요청을 거부하므로, "(KHTML, like Gecko)"와 "Chrome/" 사이의 앱 이름 토큰을 모두 지운다)
app.userAgentFallback = app.userAgentFallback
  .replace(/\(KHTML, like Gecko\).*?Chrome\//, "(KHTML, like Gecko) Chrome/")
  .replace(/\sElectron\/\S+/g, "")
  .replace(/[^\x20-\x7E]/g, "");

let win, wingView, cleanView = null, active = "wing", current = null;
// ② 쿠팡 검색: 같은 클린 세션(파티션) 안에서 브라우저처럼 탭 여러 개 — 쿠키를 함께 써서 새 창 차단 문제가 없다
let cleanTabs = [], cleanPart = null, tabSeq = 0;
// 🛡 숨은 자동 화면(쿠폰가·상품 페이지 가격·연관검색어)은 사람이 보는 쿠팡 탭과 다른 세션을 쓴다(2026-11-17)
//  같은 쿠키를 쓰면 자동 조회가 쿠팡에 "기계"로 찍힐 때 대표님이 누른 상품 링크까지 쿠팡 오류 화면이 떴다
let bgPart = null;
const cpWarm = new WeakSet(); // 쿠팡 홈을 한 번 거친 세션(그래야 상품 링크로 바로 들어가도 403이 안 난다)
const bgPartition = () => (bgPart ||= `cpbg-${Date.now()}`);
// 📦 1688 탭: 로그인 유지(persist:1688). 리스트업 행에서 🔍1688 → 이미지 검색 → 상품 페이지에서 "리스트업에 넣기"
let cnView = null, cnTarget = null, cnPending = null; // cnPending: 1688 첫 화면에서 올릴 사진(한 번 쓰고 비움)
// 🗂 1688 탭(2026-10-13): 첫 탭 = cnView(🔍 검색 · 고정 — 이미지 검색·판매자 점수·자동 조사가 쓰는 화면), 검색 결과에서 상품을 열면 새 탭(cnTabs)
//  쿠팡 검색과 같은 탭 줄 · 상품 탭에서도 리스트업에 넣기·문의·번역·상세페이지가 되도록 "1688 화면에서 온 요청" 확인은 isCnWc 로
let cnTabs = [], cnCur = null; // cnCur = 지금 보이는 1688 화면(첫 탭 또는 상품 탭)
const isCnWc = (wc) => !!wc && ((cnView && wc === cnView.webContents) || cnTabs.some((t) => t.view.webContents === wc));
const CN_HOME = "https://www.1688.com/";
const TAB_H = 32, MAX_TABS = 12;

// 프로그램은 하나만: 이미 켜져 있으면 새로 띄우지 않고 기존 창을 앞으로 (데이터 폴더 동시 사용 오류 방지)
const GOT_LOCK = SELFTEST || app.requestSingleInstanceLock();
if (!GOT_LOCK) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const log = (cls, text) => { send("console", { cls, text }); console.log(`[신호등] ${text}`); }; // 패널 콘솔 + 터미널

function settings() {
  const st = store.get("settings") || {};
  const margin = st.ads === false ? 0.2 : 0.3;
  return { ...DEFAULTS, mode: st.mode || "niche", nicheMinMargin: margin, bigMinMargin: margin };
}

function buildPayload(snap) {
  if (!snap?.items?.length) return null;
  const S = settings();
  const [m] = buildMarkets([{ ...snap, code: snap.code || "q" }], store.get("exactCache"), S);
  if (!m) return null;
  const j = judge(m, S);
  const pbs = pbList(S);
  const light = (it) => {
    const rv = it.reviews ?? 0;
    if (S.mode === "big") return rv >= 500 ? "go" : rv >= 100 ? "warn" : "stop";
    return rv < 100 ? "go" : rv <= 500 ? "warn" : "stop";
  };
  return {
    key: snap.key, code: snap.code, name: snap.name, path: snap.path, date: snap.date, total: snap.total, mode: S.mode, ads: S.nicheMinMargin === 0.3,
    verdict: j.verdict, note: j.note, target: j.target, yuan: j.yuan, monthly: j.monthly,
    checks: j.checks.map((c) => ({ label: c.label, pass: c.pass, need: c.need })),
    items: m.items.slice(0, 60).map((it) => ({
      order: it.order, pid: it.pid, vid: it.vid, iid: it.iid, name: it.name, brand: it.brand, price: it.ex?.price ?? it.price,
      rating: it.rating, reviews: it.reviews, pvLo: it.pvLo, pvHi: it.pvHi, img: it.img, ex: it.ex || null, light: light(it),
      pb: isPB(it, pbs), // 쿠팡 자체 브랜드(PB): 판매자 상품 매칭에 지표가 없어 정확한 판매량 조회에서 제외
    })),
  };
}

// 🔰 첫 실행 안내(renderer/onboard.js): "login" = 앱 로그인만 창 전체(사이트 화면 숨김) · "wing" = Wing 화면 둘레에 빛나는 테두리 자리(ONB_PAD)를 비움
let onbPhase = null;
const ONB_PAD = 10;
function layout() {
  if (!win) return;
  if (onbPhase === "login") { [wingView, dashView, chat.view(), cnView, ...cnTabs.map((t) => t.view), ...cleanTabs.map((t) => t.view)].forEach((v) => v?.setVisible(false)); return; }
  const [w, h] = win.getContentSize();
  const sw = Math.round(sideW * ZOOM), bh = Math.round(BAR_H * ZOOM), st = Math.round(stripW * ZOOM);
  const b = { x: sw, y: bh, width: Math.max(200, w - sw), height: Math.max(200, h - bh) };
  const th = Math.round(TAB_H * ZOOM);
  const bc = { ...b, y: b.y + th, height: Math.max(200, b.height - th) }; // 쿠팡 탭은 위에 탭 줄 자리
  const pad = onbPhase === "wing" ? Math.round(ONB_PAD * ZOOM) : 0;
  wingView?.setBounds({ x: b.x + pad, y: b.y + pad, width: Math.max(200, b.width - st - pad * 2), height: Math.max(200, b.height - pad * 2) }); // Wing 오른쪽에 판정·수강생 확인 칸
  dashView?.setBounds(b);
  dashView?.setVisible(active === "dash");
  wingView?.setVisible(active === "wing");
  const chatV = chat.view();
  // 💬 채팅 화면: 숨겨도 크기는 유지된다(크기를 받은 뒤 숨김) — 창 밖으로 옮기면 크기가 0이 되어 답 확인·입력을 못 한다
  chatV?.setBounds(b);
  chatV?.setVisible(active === "chat");
  cnView?.setBounds(bc); // 1688도 위에 탭 줄 자리
  cnView?.setVisible(active === "cn" && (cnCur || cnView) === cnView);
  cnTabs.forEach((t) => { t.view.setBounds(bc); t.view.setVisible(active === "cn" && t.view === cnCur); });
  cleanTabs.forEach((t) => { t.view.setBounds(bc); t.view.setVisible(active === "clean" && t.view === cleanView); });
}
const isClean = (wc) => cleanTabs.some((t) => t.view.webContents === wc) || Object.values(cpBgs).some((o) => o.view?.webContents === wc);
// 🕶 쿠폰가 읽기 전용 숨은 화면 — 쿠팡 탭과 같은 세션(클린 세션)이지만 화면에 보이지 않는다.
//  키워드 추천·키워드 분석이 쿠팡 검색 화면을 열 때 사람이 보고 있는 쿠팡 탭을 새로고침하지 않도록 따로 둔다(2026-10-12)
//  "search" = 검색 화면 쿠폰가 · "detail" = 옵션이 다른 상품의 상품 페이지 가격(검색 화면 읽기와 겹쳐도 서로 새로고침하지 않게 따로)
const cpBgs = {};
function coupangBgView(slot = "search") {
  const o = cpBgs[slot];
  if (o?.view && !o.view.webContents.isDestroyed() && o.part === bgPartition()) return o.view;
  if (o?.view) { try { win.contentView.removeChildView(o.view); o.view.webContents.close(); } catch {} }
  const cpBg = new WebContentsView({ webPreferences: { partition: bgPartition(), contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "../preload/coupang.cjs") } });
  win.contentView.addChildView(cpBg);
  const [w, h] = win.getContentSize();
  cpBg.setBounds({ x: 0, y: 0, width: Math.max(800, w), height: Math.max(600, h) }); // 크기를 준 뒤 숨김(크기 0이면 카드가 안 그려질 수 있음)
  cpBg.setVisible(false);
  cpBg.webContents.setAudioMuted(true);
  cpBg.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  cpBg.webContents.on("preload-error", (_e, _p, err) => log("stop", `✕ 쿠팡 지표 스크립트를 불러오지 못했습니다(쿠폰가 읽기): ${err?.message || err}`));
  cpBgs[slot] = { view: cpBg, part: bgPartition() };
  cpBg.webContents.on("did-finish-load", () => cpBlocked(cpBg.webContents).then((b) => { if (b && bgPart === cpBgs[slot]?.part) { log("dim", "  쿠팡이 자동 조회를 잠시 막았어요 — 숨은 화면 세션을 새로 만들어 다음 키워드부터 이어 가요"); bgPart = null; } }));
  return cpBg;
}
// 옵션이 다른 상품: 그 옵션(vendorItemId)의 상품 페이지를 숨은 화면에서 열어 판매가를 읽는다(2026-10-13, 한누네 팬트리 8개 Wing 116,000 → 실제 35,200)
//  coupang.cjs pagePrice와 같은 규칙: 위쪽 구매 칸의 "35,200원" 중 가장 큰 글씨 · 취소선(할인 전 가격) 제외 · 열린 옵션 번호가 요청한 것과 같을 때만
const DETAIL_PRICE_JS = `(() => {
  let best = null;
  for (const el of document.querySelectorAll("strong, span, div, em")) {
    if (el.children.length > 2) continue;
    const t = (el.textContent || "").replace(/\\s+/g, "");
    const m = t.match(/^(\\d{1,3}(?:,\\d{3})+|\\d{3,7})원$/); if (!m) continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.top > 900 || r.top < 0) continue;
    if (getComputedStyle(el).textDecorationLine.includes("line-through")) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize) || 0, v = Number(m[1].replace(/,/g, ""));
    if (v >= 100 && (!best || fs > best.fs)) best = { v, fs };
  }
  return { price: best ? best.v : null, vid: new URL(location.href).searchParams.get("vendorItemId") || "" };
})()`;
async function readDetailPrice(pid, vid) {
  const wc = coupangBgView("detail").webContents;
  const url = `https://www.coupang.com/vp/products/${encodeURIComponent(pid)}?vendorItemId=${encodeURIComponent(vid)}`;
  if (!cpWarm.has(wc.session)) { try { await wc.loadURL(COUPANG_HOME); cpWarm.add(wc.session); await new Promise((r) => setTimeout(r, 900)); } catch {} } // 처음 세션이면 쿠팡 홈부터(바로 들어가면 403)
  try { await wc.loadURL(url, { httpReferrer: "https://www.coupang.com/" }); } catch { /* 쿠팡이 뒤에서 주소를 바꿔도 화면은 뜬다 — 아래에서 읽어 봄 */ }
  for (let i = 0; i < 12; i++) { // 최대 약 6초
    const r = await wc.executeJavaScript(DETAIL_PRICE_JS, true).catch(() => null);
    if (r?.price > 0) return !r.vid || r.vid === String(vid) ? r.price : null; // 품절 등으로 다른 옵션이 열렸으면 안 씀
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}
function sendTabs() {
  send("ctabs", { kind: "clean",
    active: cleanTabs.find((t) => t.view === cleanView)?.id ?? null,
    tabs: cleanTabs.map((t) => { const wc = t.view.webContents; return { id: t.id, title: wc.getTitle() || "불러오는 중…", url: wc.getURL(), loading: wc.isLoading() }; }),
  });
}
// 쿠팡 오류·차단 화면인지(제목·첫 글자들로만 판단)
const CP_BLOCK = /서버에서 오류가 발생|Access Denied|요청하신 페이지를 처리하는 중|잠시 후 다시 시도/;
const cpBlocked = (wc) => wc.executeJavaScript(`(document.title + " " + (document.body?.innerText || "").slice(0, 400))`).then((t) => CP_BLOCK.test(t) && !cpNormal(t)).catch(() => false);
const cpNormal = (t) => /장바구니|바로구매|로켓배송/.test(t); // 정상 쿠팡 화면이면 이런 말이 보인다
function openCleanTab(url = COUPANG_HOME, activate = true, retried = false) {
  if (!cleanPart) cleanPart = `clean-${Date.now()}`;
  // 너무 많으면 가장 오래된(지금 보는 탭이 아닌) 탭부터 닫는다
  while (cleanTabs.length >= MAX_TABS) { const old = cleanTabs.find((t) => t.view !== cleanView); if (!old) break; closeCleanTab(old.id, true); }
  const view = new WebContentsView({ webPreferences: { partition: cleanPart, contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "../preload/coupang.cjs") } }); // 숨겨도 멈추지 않게 — 탭 전환 즉시 표시(2026-10-13)
  const t = { id: ++tabSeq, view };
  cleanTabs.push(t);
  win.contentView.addChildView(view);
  hookView(view, "clean");
  view.webContents.on("preload-error", (_e, _p, err) => log("stop", `✕ 쿠팡 지표 스크립트를 불러오지 못했습니다: ${err?.message || err}`));
  ["page-title-updated", "did-start-loading", "did-stop-loading", "did-navigate"].forEach((ev) => view.webContents.on(ev, sendTabs));
  // 🛡 쿠팡 오류 화면이 뜨면: 이 탭만 닫고 새 세션(쿠키 없음)으로 같은 주소를 한 번 다시 연다
  // 🔁 처음 세션에서 상품 링크로 바로 들어가면 쿠팡이 403 「요청하신 페이지의 사용권한이 없습니다」를 보낸다(2026-11-17 대표님 확인)
  //  쿠팡 홈을 한 번 거친 세션이면 같은 주소가 열린다 → 홈을 먼저 열고 이어서 그 주소로. 그래도 막히면 옵션 번호를 빼고 한 번 더
  let denyTry = 0;
  view.webContents.on("did-finish-load", () => {
    const u = view.webContents.getURL();
    if (/^https:\/\/www\.coupang\.com\/?$/.test(u)) { cpWarm.add(view.webContents.session); return; }
    if (denyTry >= 2 || !/coupang\.com\/vp\/products\//.test(u)) return;
    view.webContents.executeJavaScript(`(document.body?.innerText || "").slice(0, 300)`).then((tx) => {
      if (!/사용권한이 (없습니다|제한된)/.test(tx)) { cpWarm.add(view.webContents.session); return; }
      denyTry++;
      const wc = view.webContents, target = denyTry === 1 ? u : u.split("?")[0];
      log("sys", denyTry === 1 ? "▶ 쿠팡이 바로 들어가는 걸 막았어요 — 쿠팡 홈을 거쳐 다시 열어요" : "▶ 한 번 더 막혀서 옵션 번호를 빼고 상품 페이지를 열어요");
      if (denyTry === 1) { wc.once("did-finish-load", () => setTimeout(() => !wc.isDestroyed() && wc.loadURL(target, { httpReferrer: COUPANG_HOME }), 900)); wc.loadURL(COUPANG_HOME); }
      else wc.loadURL(target, { httpReferrer: COUPANG_HOME });
    }).catch(() => {});
  });
  if (!retried) view.webContents.once("did-finish-load", () => cpBlocked(view.webContents).then((b) => {
    if (!b || !cleanTabs.includes(t)) return;
    const u = view.webContents.getURL() || url, was = cleanView === view;
    log("sys", "▶ 쿠팡이 오류 화면을 보냈어요 — 새 클린 세션으로 다시 열어요");
    cleanPart = `clean-${Date.now()}`;
    closeCleanTab(t.id, true);
    openCleanTab(u, was || activate, true);
  }));
  if (/coupang\.com\/vp\/products\//.test(url) && !cpWarm.has(view.webContents.session)) {
    const wc = view.webContents; // 이 세션이 쿠팡 홈을 아직 안 거쳤다 → 홈 먼저(사람이 들어가는 순서)
    wc.once("did-finish-load", () => setTimeout(() => !wc.isDestroyed() && wc.loadURL(url, { httpReferrer: COUPANG_HOME }), 900));
    wc.loadURL(COUPANG_HOME);
  } else view.webContents.loadURL(url, { httpReferrer: "https://www.coupang.com/" });
  if (activate || !cleanView) cleanView = view;
  if (activate) active = "clean"; // 뒤에서 열기(키워드 분석의 쿠폰가 읽기 등)는 지금 화면을 그대로 둔다
  layout(); sendTabs();
  if (activate) send("nav", { tab: "clean", url });
  return t;
}
function selectCleanTab(id) {
  const t = cleanTabs.find((x) => x.id === id);
  if (!t) return;
  cleanView = t.view; active = "clean"; layout(); sendTabs();
  send("nav", { tab: "clean", url: t.view.webContents.getURL() });
}
function closeCleanTab(id, quiet) {
  const i = cleanTabs.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [t] = cleanTabs.splice(i, 1);
  win.contentView.removeChildView(t.view); t.view.webContents.close();
  if (t.view === cleanView) cleanView = (cleanTabs[i] || cleanTabs[i - 1])?.view || null;
  if (quiet) return;
  if (!cleanTabs.length) { openCleanTab(COUPANG_HOME); return; }
  layout(); sendTabs();
  if (active === "clean" && cleanView) send("nav", { tab: "clean", url: cleanView.webContents.getURL() });
}

// 🗂 1688 탭 줄 — 첫 탭(id 0)은 고정
function sendCnTabs() {
  if (!cnView) return;
  const row = (id, v, fixed) => { const wc = v.webContents; return { id, title: wc.getTitle() || "불러오는 중…", url: wc.getURL(), loading: wc.isLoading(), fixed }; };
  send("ctabs", { kind: "cn", active: cnCur && cnCur !== cnView ? cnTabs.find((t) => t.view === cnCur)?.id ?? 0 : 0, tabs: [row(0, cnView, true), ...cnTabs.map((t) => row(t.id, t.view, false))] });
}
function openCnTab(url, activate = true) {
  if (!cnView) createCn("about:blank");
  while (cnTabs.length >= MAX_TABS - 1) { const old = cnTabs.find((t) => t.view !== cnCur); if (!old) break; closeCnTab(old.id, true); }
  const view = new WebContentsView({ webPreferences: { partition: "persist:1688", contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "../preload/cn.cjs") } });
  const t = { id: ++tabSeq, view };
  cnTabs.push(t);
  win.contentView.addChildView(view);
  hookView(view, "cn");
  view.webContents.on("preload-error", (_e, _p, err) => log("stop", `✕ 1688 도우미 스크립트 오류: ${err?.message || err}`));
  view.webContents.on("did-navigate", (_e, u) => { if (chat.isImUrl(u)) { chat.opened(u); view.webContents.navigationHistory.goBack(); } });
  ["page-title-updated", "did-start-loading", "did-stop-loading", "did-navigate"].forEach((ev) => view.webContents.on(ev, sendCnTabs));
  view.webContents.loadURL(url);
  if (activate) { cnCur = view; active = "cn"; }
  layout(); sendCnTabs();
  if (activate) send("nav", { tab: "cn", url });
}
function selectCnTab(id) {
  const v = id === 0 ? cnView : cnTabs.find((x) => x.id === id)?.view;
  if (!v) return;
  cnCur = v; active = "cn"; layout(); sendCnTabs();
  send("nav", { tab: "cn", url: v.webContents.getURL() });
}
function closeCnTab(id, quiet) {
  const i = cnTabs.findIndex((x) => x.id === id);
  if (i < 0) return; // 첫 탭(검색)은 닫지 않는다
  const [t] = cnTabs.splice(i, 1);
  win.contentView.removeChildView(t.view); t.view.webContents.close();
  if (t.view === cnCur) cnCur = (cnTabs[i] || cnTabs[i - 1])?.view || cnView;
  if (quiet) return;
  layout(); sendCnTabs();
  if (active === "cn") send("nav", { tab: "cn", url: (cnCur || cnView).webContents.getURL() });
}

function hookView(view, tab) {
  const wc = view.webContents;
  const report = () => tab === active && (tab !== "clean" || view === cleanView) && (tab !== "cn" || view === (cnCur || cnView)) && send("nav", { tab, url: wc.getURL(), canBack: wc.navigationHistory.canGoBack() });
  wc.on("did-navigate", report);
  wc.on("did-navigate-in-page", report);
  wc.on("did-finish-load", report);
  wc.on("did-finish-load", () => wc.setZoomFactor(ZOOM));
  // 📊 대시보드가 로그인 화면으로 튕기면 앱 계정(Supabase 토큰)으로 자동 로그인 — 대시보드 /api/signal/embed-login → /auth/embed#th=…
  if (tab === "dash") wc.on("did-navigate", (_e, url) => { if (url.startsWith(`${DASHBOARD_URL}/login`)) dashAutoLogin(wc); });
  if (tab === "wing") wc.on("did-navigate", (_e, url) => {
    if (onbPhase === "wing") sendWingStep(url);
    if (!/^https:\/\/wing\.coupang\.com\//.test(url)) return;
    flushWing(); // 로그인 성공 직후 저장
    if (GATE_ON && !licensed()) checkVendor(true).then(sendAuth); // 판매자ID 승인 확인
  });
  wc.setWindowOpenHandler(({ url, disposition }) => {
    // 쿠팡 화면의 새 창·Cmd+클릭 → 같은 세션의 새 탭 (뒤에서 열기는 지금 탭 유지) · Wing은 같은 화면에서
    if (tab === "clean" && /^https:\/\/(www|m)\.coupang\.com\//i.test(url)) { openCleanTab(url, disposition !== "background-tab"); return { action: "deny" }; }
    if (tab === "clean" && /^https?:\/\//i.test(url)) { shell.openExternal(url); return { action: "deny" }; }
    // 대시보드: 대시보드 주소는 같은 화면에서, 그 밖(카카오 오픈채팅 등)은 평소 브라우저에서
    if (tab === "dash") { if (url.startsWith(DASHBOARD_URL)) wc.loadURL(url); else if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: "deny" }; }
    // 1688 이미지 검색 결과는 "//s.1688.com/…"(프로토콜 없음)으로 와서 그대로 열면 실패 → 현재 주소 기준으로 완성
    // 1688은 사진에서 물체 하나를 자동으로 골라(主体) 검색한다 → 영역을 전체(0~360 기준)로 지정해 "전체 사진"으로 검색
    try {
      const u = new URL(url, wc.getURL() || "https://www.1688.com/");
      // 💬 판매자 연락(旺旺) 버튼이 연 채팅창 → 문의 도우미 화면으로
      if (tab === "cn" && (chat.isImUrl(u.href) || chat.waitingOpen())) {
        log("dim", `  💬 채팅창 열림 ${u.href.slice(0, 160)}`);
        if (/^https?:$/.test(u.protocol)) chat.opened(u.href); else log("stop", `✕ 💬 1688이 PC용 旺旺 프로그램(${u.protocol})을 열려고 합니다 — 웹 채팅이 아니라 자동 문의를 할 수 없습니다`);
        return { action: "deny" };
      }
      // 🛍 타오바오 사진 검색: 결과 주소(s.taobao.com/search?imgSearchOrigin=…)에 사진 번호가 없고, 사진은 "새로 연 창"에 넘겨준다.
      // 같은 화면에 다시 열면 사진이 빠져 "网络信号走丢啦"(결과 없음) → 이 창만은 진짜 새 창으로 열어 준다(같은 로그인·도우미 스크립트 그대로)
      if (tab === "cn" && /(^|\.)taobao\.com$/i.test(u.hostname) && u.searchParams.has("imgSearchOrigin")) {
        log("dim", "  🛍 타오바오 사진 검색 결과를 새 창으로 엽니다");
        return { action: "allow", overrideBrowserWindowOptions: { width: 1360, height: 900, title: "🛍 타오바오 — 씨드핵", autoHideMenuBar: true, backgroundColor: "#ffffff" } };
      }
      // (2026-10-08) 예전에 "전체 사진" 뜻으로 region=0,360,0,360 을 붙였으나 1688이 더 이상 받지 않아(썸네일 깨짐·0건) 붙이지 않는다 — 1688 기본(물체 자동 선택)으로 검색
      // 🗂 상품 페이지(detail.1688.com/offer/…)는 새 1688 탭으로 — 검색 결과는 첫 탭에 그대로 남는다(2026-10-13)
      if (tab === "cn" && /(^|\.)detail\.1688\.com$/i.test(u.hostname) && /\/offer\//.test(u.pathname)) { openCnTab(u.href, disposition !== "background-tab"); return { action: "deny" }; }
      wc.loadURL(u.href);
    } catch { shell.openExternal(url); }
    return { action: "deny" };
  });
}

// 새 클린 세션: 탭을 모두 닫고 새 파티션으로 첫 탭을 연다
// "persist:"가 없는 파티션 = 메모리 전용 세션: 쿠키·기록이 없고 프로그램을 닫으면 사라진다(시크릿 창과 같은 효과)
function createClean() {
  [...cleanTabs].forEach((t) => closeCleanTab(t.id, true));
  cleanView = null;
  cleanPart = `clean-${Date.now()}`;
  openCleanTab(COUPANG_HOME, active === "clean");
  log("sys", "▶ 새 클린 세션을 열었습니다 · 쿠키·로그인·최근 본 상품 없음 (개인화 영향 최소)");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 700, title: "씨드핵 — 소싱을 해킹하다", backgroundColor: "#0b0f14", show: !SELFTEST,
    webPreferences: { preload: path.join(__dirname, "../preload/panel.cjs"), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "../renderer/panel.html"));
  // 패널·수집함·리스트업의 링크: 새 창(쿠키 없는 맨 창)을 띄우면 쿠팡이 "사용권한이 제한된 페이지"로 막는다.
  // → 쿠팡 주소는 ② 쿠팡 검색 탭에서, Cmd/Ctrl+클릭은 평소 쓰는 브라우저에서, 그 밖의 주소(1688 등)는 브라우저에서 연다.
  win.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (!/^https?:\/\//i.test(url)) return { action: "deny" };
    const coupang = /^https:\/\/(www|m)\.coupang\.com\//i.test(url);
    if (!coupang || disposition === "background-tab") { shell.openExternal(url); return { action: "deny" }; }
    openCleanTab(url, true); // 수집함·리스트업에서 누른 상품은 새 탭으로 — 보던 검색 탭은 그대로
    return { action: "deny" };
  });

  keepWingSession();
  wingView = new WebContentsView({ webPreferences: { partition: "persist:wing", contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.contentView.addChildView(wingView);
  hookView(wingView, "wing");
  watchWing(wingView.webContents, onWingSnap, log); // 사람이 Wing 탭에서 직접 카테고리를 열어도 판정
  if (!SELFTEST) wingView.webContents.loadURL(WING_HOME);

  win.on("resize", layout);
  win.webContents.on("did-finish-load", () => {
    layout();
    send("nav", { tab: "wing", url: wingView.webContents.getURL() || WING_HOME });
    log("sys", "▶ 시작 · ① Wing 로그인 → ② 쿠팡 검색 탭에서 검색 → 화면 오른쪽 📊 버튼 → ③ 수집함에서 고르기 → ④ 리스트업에 위안 입력");
    if (SELFTEST) selftest();
    else { startAuth(); startUpdater(); hot.markGood(); hot.startHot({ log, onReady: (r) => send("hot", r) }); if (hot.hotReady()) send("hot", hot.hotReady()); }
    send("version", process.env.SEEDHACK_HOT_LABEL ? `${app.getVersion()}+${process.env.SEEDHACK_HOT_LABEL}` : app.getVersion());
  });
  layout();
}

// ---------- Wing 로그인 유지 ----------
// Wing 로그인 쿠키 일부는 "브라우저를 닫으면 사라지는 쿠키"라, 앱을 다시 켤 때마다 Wing 로그인을 새로 해야 했다.
// 짧은 시간에 로그인이 반복되면 쿠팡 보안(Akamai)이 막는다 → 이런 쿠키를 7일 유지로 바꿔 저장한다(크롬 "로그인 상태 유지"와 같은 효과).
// 쿠키는 이 PC의 앱 데이터에만 남고, 비밀번호는 저장하지 않는다. 서버 쪽 로그인 만료는 그대로 따른다.
function keepWingSession() {
  const ses = session.fromPartition("persist:wing");
  ses.cookies.on("changed", (_e, c, _cause, removed) => {
    if (removed || c.session === false || c.expirationDate) return;
    const host = String(c.domain || "").replace(/^\./, "");
    if (!/(^|\.)coupang\.com$/.test(host)) return;
    ses.cookies.set({
      url: `https://${host}${c.path || "/"}`, name: c.name, value: c.value, path: c.path,
      ...(c.hostOnly ? {} : { domain: c.domain }), secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
      expirationDate: Date.now() / 1000 + 7 * 24 * 60 * 60,
    }).catch(() => {});
  });
}

// ---------- 자동 업데이트 (설치판만) — GitHub 릴리스(blackgosu100-png/coupang-signal-releases)에서 새 버전 확인 ----------
let updateReady = null;
function startUpdater() {
  if (!app.isPackaged || process.platform !== "win32") return; // 맥 개발용 실행은 제외
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 버튼을 안 눌러도 다음에 끌 때 설치
  autoUpdater.on("update-available", (i) => log("sys", `▶ 새 버전 ${i.version}을 내려받는 중입니다 (사용은 계속 가능)`));
  autoUpdater.on("update-downloaded", (i) => { updateReady = i.version; send("update", { version: i.version }); log("go", `■ 새 버전 ${i.version} 준비됨 — 위쪽 '다시 시작해 업데이트'를 누르거나 다음에 끌 때 자동 설치`); });
  autoUpdater.on("error", (e) => console.log("[업데이트]", e?.message || e));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
// ⬆ 화면만 바로 업데이트(hot.js) — 받아 둔 새 코드로 다시 켠다. Wing 로그인은 저장한 뒤
ipcMain.handle("hot:apply", async () => {
  if (!hot.hotReady()) return;
  flushWing();
  await session.fromPartition("persist:wing").cookies.flushStore().catch(() => {});
  hot.applyHot();
});
// 설치 전에 화면·쿠팡 탭을 모두 닫고 완전히 끝낸 뒤 설치 — 옛 파일이 잠겨 있으면 "Failed to uninstall old application files" 오류가 난다
ipcMain.handle("update:install", async () => {
  if (!updateReady) return;
  flushWing();
  await session.fromPartition("persist:wing").cookies.flushStore().catch(() => {});
  [...cleanTabs].forEach((t) => closeCleanTab(t.id, true));
  try { wingView?.webContents.close(); } catch {}
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 300);
  setTimeout(() => app.exit(0), 2500); // 안전장치: 그래도 안 꺼지면 강제 종료(설치 프로그램이 기다리는 중)
});

// ---------- 수강생 확인(로그인 + 판매자ID 승인) ----------
const sendAuth = () => send("auth", authState());
const LOCKED = { error: "수강생 확인 후 사용할 수 있습니다 — 오른쪽 패널에서 로그인해 주세요." };
async function startAuth() {
  if (!GATE_ON) { sendAuth(); return; }
  await restore();
  await checkVendor();
  sendAuth();
  setInterval(async () => { await checkVendor(true); sendAuth(); if (!licensed()) { active = "wing"; layout(); send("nav", { tab: "wing", url: wingView.webContents.getURL() }); } }, 6 * 60 * 60 * 1000);
}
ipcMain.handle("auth:state", () => authState());
ipcMain.handle("auth:signin", async (_e, { email, password }) => {
  try { await signIn(email, password); } catch (e) { return { ...authState(), error: e.message }; }
  await checkVendor(true);
  log("sys", `▶ 로그인: ${email}`);
  const s = authState(); sendAuth(); return s;
});
ipcMain.handle("auth:signout", () => { signOut(); active = "wing"; layout(); send("nav", { tab: "wing", url: wingView.webContents.getURL() }); sendAuth(); return authState(); });
ipcMain.handle("auth:recheck", async () => {
  if (!memberOk()) await restore(); // 회원 승인 대기였다면 최신 승인 상태를 다시 받아 온다
  await checkVendor(true); sendAuth(); return authState();
});
ipcMain.handle("auth:open", (_e, url) => { if (/^https:\/\/(rocketgrowth-sale-dashboard\.vercel\.app|docs\.google\.com)\//.test(String(url))) shell.openExternal(url); });

// ---------- 패널 요청 처리 ----------
ipcMain.handle("nav:tab", (_e, tab) => {
  if (tab === "cat") { try { if (!/popularity-search/.test(wingView.webContents.getURL())) wingView.webContents.loadURL(WING_TREND); } catch {} } // 판정 화면을 열면 뒤에서 Wing 인기상품 화면을 준비(카테고리 목록도 이때 저장됨)
  if (!licensed() && tab !== "wing") { send("nav", { tab: "wing", url: wingView.webContents.getURL() }); return; } // 잠금: Wing(판매자 확인용)만
  const dash = /^dash:/.test(tab) ? tab.slice(5) : null; // 📊 판매 관리: "dash:margin" 처럼 대시보드 메뉴 id
  if (dash) tab = "dash";
  active = tab;
  if (dash) openDash(dash);
  if (tab === "clean" && !cleanTabs.length) createClean();
  if (tab === "cn" && !cnView) createCn();
  if (tab === "chat") chat.show(true); // ⑥ 💬 문의 탭: 채팅 화면(처음이면 마지막 문의 대화를 연다)
  layout(); sendTabs(); if (tab === "cn") sendCnTabs(); // 리스트업(list)이면 사이트 화면을 모두 숨기고 패널 왼쪽에 표를 보여 준다
  const v = tab === "wing" ? wingView : tab === "clean" ? cleanView : tab === "cn" ? cnCur || cnView : tab === "chat" ? chat.view() : tab === "dash" ? dashView : null;
  send("nav", { tab, dash: dashTab, url: v ? v.webContents.getURL() : tab === "collect" ? "수집함 — 쿠팡에서 본 상품 다시 보기·고르기" : tab === "kw" ? "키워드 분석" : tab === "reco" ? "💡 키워드 추천" : tab === "name" ? "✍ 상품명 짓기" : tab === "cat" ? "🚦 카테고리 판정 — 1차~4차 고르면 Wing 인기상품으로 판정" : tab === "detail" ? "📄 상세페이지 — 1688 상세 이미지 → 한글 상세페이지" : "리스트업 — 중국 원가·마진 계산" });
});
// 화면(panel.js)이 알려 주는 틀 크기: 왼쪽 사이드바 폭, Wing 오른쪽 칸 폭
ipcMain.handle("ui:onboard", (_e, { phase } = {}) => {
  onbPhase = ["login", "wing"].includes(phase) ? phase : null;
  if (onbPhase === "wing" && active !== "wing") { active = "wing"; send("nav", { tab: "wing", url: wingView.webContents.getURL() }); }
  layout();
  if (onbPhase === "wing") sendWingStep(wingView.webContents.getURL());
});
// Wing 화면이 지금 어느 단계인지(로그인 칸 · 휴대폰 인증 · 로그인 끝) — 안내 말풍선용. 주소만 보고 판단한다(쿠팡 화면 안은 건드리지 않음)
function sendWingStep(url = "") {
  const u = String(url);
  const step = /^https:\/\/wing\.coupang\.com\//.test(u) ? "ok" : /xauth\.coupang\.com/.test(u) && /(otp|verif|mfa|2fa|authenticat|certif)/i.test(u) ? "verify" : /xauth\.coupang\.com|login/i.test(u) ? "login" : "loading";
  send("onb:wing", { step });
}
ipcMain.handle("ui:frame", (_e, { side, strip } = {}) => {
  sideW = Math.min(320, Math.max(0, Math.round(+side) || 0));
  stripW = Math.min(600, Math.max(0, Math.round(+strip) || 0));
  layout();
});
// 📊 대시보드 자동 로그인: 앱 토큰으로 본인 확인 → 1회용 token_hash → /auth/embed 가 세션을 만들고 /dashboard 로 돌아온다. 30초에 한 번만 시도(실패 반복 방지)
let dashLoginAt = 0;
async function dashAutoLogin(wc) {
  if (Date.now() - dashLoginAt < 30000) return;
  dashLoginAt = Date.now();
  const at = await accessToken();
  if (!at) { log("dim", "  📊 대시보드 로그인 화면 — 앱에 로그인된 계정이 없어 직접 로그인해 주세요"); return; }
  try {
    const r = await net.fetch(`${DASHBOARD_URL}/api/signal/embed-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: at }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.token_hash) { log("warn", `△ 📊 대시보드 자동 로그인 실패 — ${j?.error || r.status}`); return; }
    if (wc.isDestroyed()) return;
    log("dim", `  📊 대시보드에 앱 계정(${j.email || ""})으로 들어가는 중`);
    wc.loadURL(`${DASHBOARD_URL}/auth/embed#th=${encodeURIComponent(j.token_hash)}&tab=${encodeURIComponent(dashTab || "margin")}`);
  } catch (e) { log("warn", `△ 📊 대시보드 자동 로그인 오류 — ${e?.message || e}`); }
}
// 📊 판매 관리 — 로켓그로스 대시보드의 메뉴(margin·ads·coupons·stock)를 본문에 띄운다
function openDash(id) {
  if (!dashView) {
    // preload(dash.cjs) = 크롬 확장 대신 대시보드와 대화 · 대시보드 본문은 iframe(legacy.html) 안이라 하위 프레임에도 넣는다(요청은 dash:ext에서 대시보드 주소인지 확인)
    dashView = new WebContentsView({ webPreferences: { partition: "persist:dash", contextIsolation: true, sandbox: true, backgroundThrottling: false, nodeIntegrationInSubFrames: true, preload: path.join(__dirname, "../preload/dash.cjs") } });
    win.contentView.addChildView(dashView);
    hookView(dashView, "dash");
    // 대시보드 자체 왼쪽 메뉴(로켓그로스 · 마진 대시보드 · 광고 보고서…)는 숨긴다 — 앱 사이드바 "판매 관리"와 중복(2026-10-13)
    //  대시보드는 embed=1 을 아직 처리하지 않음 → 앱에서 그 메뉴(aside, 대시보드에 하나뿐)만 가린다. 대시보드가 embed=1 을 처리하게 되면 이 줄은 지워도 됨
    dashView.webContents.on("dom-ready", () => {
      if (/[?&]embed=1/.test(dashView.webContents.getURL())) dashView.webContents.insertCSS("aside.w-64.bg-slate-950 { display: none !important; }").catch(() => {});
    });
  }
  if (dashTab === id && dashView.webContents.getURL()) return;
  dashTab = id;
  const wc = dashView.webContents;
  // 이미 대시보드 화면이 떠 있으면 페이지를 다시 불러오지 않고 메뉴만 바꾼다(탭 전환 지연 해결, 2026-10-13)
  //  ① 대시보드에 seedhack-set-tab 메시지(배포 뒤 동작) ② 아직 옛 버전이면 숨겨진 왼쪽 메뉴의 같은 이름 버튼을 눌러 준다
  if (/\/dashboard(\?|$)/.test(wc.getURL()) && !wc.isLoading()) {
    const label = DASH_LABEL[id] || "";
    wc.executeJavaScript(`(() => { window.postMessage({ type: "seedhack-set-tab", tab: ${JSON.stringify(id)} }, "*");
      const b = [...document.querySelectorAll("aside button")].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (b && !b.disabled) b.click(); return !!b; })()`, true)
      .then((ok) => { if (!ok) wc.loadURL(`${DASHBOARD_URL}/dashboard?tab=${encodeURIComponent(id)}&embed=1`); })
      .catch(() => wc.loadURL(`${DASHBOARD_URL}/dashboard?tab=${encodeURIComponent(id)}&embed=1`));
    return;
  }
  wc.loadURL(`${DASHBOARD_URL}/dashboard?tab=${encodeURIComponent(id)}&embed=1`);
}
const DASH_LABEL = { margin: "마진 대시보드", ads: "광고 보고서 분석", coupons: "쿠폰 관리", stock: "쿠팡 재고조회", costs: "원가 관리" };
// 📢 광고센터 화면(광고 보고서 받기용) — Wing과 같은 세션(persist:wing)이라 보통 Wing 로그인으로 바로 들어가진다
//  평소엔 숨김. 광고센터 로그인이 필요하면 대시보드 자리에 잠깐 보여 주고, 로그인되어 보고서 화면이 열리면 다시 숨기고 이어서 받는다
const AD_REPORT_URL = "https://advertising.coupang.com/marketing-reporting/billboard/reports/pa";
let adView = null;
const adReady = (wc) => /^https:\/\/advertising\.coupang\.com\/marketing-reporting\//.test(wc.getURL());
async function adPage(log) {
  if (!adView || adView.webContents.isDestroyed()) {
    adView = new WebContentsView({ webPreferences: { partition: "persist:wing", contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    win.contentView.addChildView(adView);
    adView.setVisible(false);
    adView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
  const wc = adView.webContents;
  if (adReady(wc) && !wc.isLoading()) return wc;
  await wc.loadURL(AD_REPORT_URL).catch(() => {}); // 로그인 화면으로 넘어가도 오류 없이 계속
  if (wc.isLoading()) await new Promise((r) => { const t = setTimeout(r, 10000); wc.once("did-stop-loading", () => { clearTimeout(t); r(); }); });
  if (adReady(wc)) { await sleep(1500); return wc; }
  log?.("광고센터 로그인이 필요합니다. 화면에 뜬 광고센터에서 로그인하면 자동으로 이어집니다.");
  adView.setBounds(dashView?.getBounds() || { x: 0, y: 0, width: 1200, height: 800 }); adView.setVisible(true);
  const t0 = Date.now();
  while (Date.now() - t0 < 180000 && !adReady(wc)) await sleep(1000);
  adView.setVisible(false);
  if (!adReady(wc)) return null;
  if (wc.isLoading()) await new Promise((r) => { const t = setTimeout(r, 10000); wc.once("did-stop-loading", () => { clearTimeout(t); r(); }); });
  await sleep(1500);
  log?.("광고센터 로그인 확인 완료. 광고 보고서 생성을 이어서 진행합니다.");
  return wc;
}
// 📊 대시보드 → 확장 요청을 앱이 처리(Wing 정산 받기 등) — 대시보드 주소의 프레임에서 온 것만
ipcMain.handle("dash:ext", async (e, message) => {
  const from = e.senderFrame?.url || "";
  if (!from.startsWith(DASHBOARD_URL)) return { ok: false, msg: "허용되지 않은 화면" };
  if (!licensed()) return { ok: false, msg: "씨드핵 사용 승인이 필요해요" };
  const frame = e.senderFrame;
  return handleExtAction(message, {
    wingSession: wingView.webContents.session,
    adPage,
    emit: (m) => { try { if (!frame.isDestroyed()) frame.send("dash:ext-event", m); } catch {} },
    // Wing 화면이 wing.coupang.com(로그인된 화면)이어야 그 안에서 요청할 수 있음 — 로그인 화면이면 null
    ensureWing: async () => {
      const wc = wingView.webContents;
      if (wc.isLoading()) await new Promise((r) => { const t = setTimeout(r, 8000); wc.once("did-stop-loading", () => { clearTimeout(t); r(); }); });
      return /^https:\/\/wing\.coupang\.com\//.test(wc.getURL()) ? wc : null;
    },
    // Wing 로그인 초기화: 앱 Wing 화면의 쿠팡 쿠키를 지우고 Wing 첫 화면(로그인)으로
    resetWing: async () => {
      const ses = wingView.webContents.session, all = await ses.cookies.get({}).catch(() => []);
      let removed = 0;
      for (const c of all.filter((x) => String(x.domain || "").includes("coupang.com"))) {
        const url = `https://${String(c.domain).replace(/^\./, "")}${c.path || "/"}`;
        try { await ses.cookies.remove(url, c.name); removed++; } catch {}
      }
      wingView.webContents.loadURL(WING_HOME);
      log("sys", `▶ 마진 대시보드에서 Wing 로그인 초기화 — 쿠키 ${removed}개 삭제 · Wing 로그인 메뉴에서 다시 로그인하세요`);
      return { ok: true, removed, msg: `Wing 로그인 정보 초기화 완료 (${removed}개 쿠키 삭제)` };
    },
  });
});
// 🔎 키워드 분석의 쿠폰가 읽기: ② 쿠팡 탭에서 같은 검색어를 뒤에서 연다(지금 보는 화면은 그대로). coupang.cjs가 카드 가격을 수집함에 넣는다
ipcMain.handle("kw:coupang", (_e, kw) => openCoupangSearch(kw));
function openCoupangSearch(kw) {
  const q = String(kw || "").trim().slice(0, 60);
  if (!q || !licensed()) return false;
  if (SELFTEST && process.env.SELFTEST_SITES !== "1") return false; // 자체 점검은 실제 쿠팡에 접속하지 않는다
  const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}`;
  if (!win) return false;
  coupangBgView("search").webContents.loadURL(url, { httpReferrer: "https://www.coupang.com/" }); // 숨은 화면에서 — 사람이 보는 쿠팡 탭은 그대로
  return true; // 화면이 가격을 기다려도 된다
}
// 쿠팡 화면이 이 검색어의 카드 가격을 수집함에 넣을 때까지 기다린다(coupang.cjs가 화면을 연 뒤 약 3초에 읽음) — 못 오면 있는 그대로
async function waitCoupangRows(kw, since, ms) {
  const q = String(kw || "").trim().slice(0, 60), end = since + ms;
  for (;;) {
    const rows = listCollect();
    if (rows.some((r) => r.pos?.[q]?.ts >= since) || Date.now() >= end) return rows;
    await new Promise((r) => setTimeout(r, 400));
  }
}
const curView = () => (active === "wing" ? wingView : active === "cn" ? cnCur || cnView : active === "chat" ? chat.view() : active === "dash" ? dashView : cleanView);
ipcMain.handle("nav:back", () => { const v = curView(); if (v?.webContents.navigationHistory.canGoBack()) v.webContents.navigationHistory.goBack(); });
ipcMain.handle("nav:reload", () => curView()?.webContents.reload());
ipcMain.handle("nav:home", () => (active === "wing" ? wingView.webContents.loadURL(WING_HOME) : active === "cn" ? (cnCur || cnView)?.webContents.loadURL(CN_HOME) : active === "chat" ? null
  : active === "dash" ? dashView?.webContents.loadURL(`${DASHBOARD_URL}/dashboard?tab=${encodeURIComponent(dashTab || "margin")}&embed=1`) : cleanView?.webContents.loadURL(COUPANG_HOME)));

// ---------- 📦 1688 ----------
function createCn(url = CN_HOME) {
  if (!cnView) {
    cnView = new WebContentsView({ webPreferences: { partition: "persist:1688", contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "../preload/cn.cjs") } });
    win.contentView.addChildView(cnView);
    hookView(cnView, "cn");
    cnView.webContents.on("preload-error", (_e, _p, err) => log("stop", `✕ 1688 도우미 스크립트 오류: ${err?.message || err}`));
    // 🛍 타오바오 사진 검색 새 창: 같은 로그인(persist:1688)·도우미 스크립트를 물려받는다. 그 창에서 상품을 누르면 같은 창에서 연다(창이 늘어나지 않게)
    const tbWin = (w) => {
      const wc = w.webContents; tbWins.add(wc);
      wc.setWindowOpenHandler(({ url }) => {
        if (/(^|\.)taobao\.com\/search\?.*imgSearchOrigin/i.test(url.replace(/^https?:\/\//, ""))) return { action: "allow", overrideBrowserWindowOptions: { width: 1360, height: 900, title: "🛍 타오바오 — 씨드핵", autoHideMenuBar: true } }; // 그 창 안에서 다시 사진 검색해도 사진이 넘어가게
        if (/^https?:\/\//i.test(url)) wc.loadURL(url);
        return { action: "deny" };
      });
      wc.on("did-create-window", tbWin);
      w.on("closed", () => tbWins.delete(wc));
    };
    cnView.webContents.on("did-create-window", tbWin);
    // 판매자 연락 버튼이 같은 화면에서 채팅으로 넘어간 경우: 채팅은 💬 화면으로 옮기고 상품 화면은 되돌린다
    cnView.webContents.on("did-navigate", (_e, url) => { if (chat.isImUrl(url)) { chat.opened(url); cnView.webContents.navigationHistory.goBack(); } });
    ["page-title-updated", "did-start-loading", "did-stop-loading", "did-navigate"].forEach((ev) => cnView.webContents.on(ev, sendCnTabs));
  }
  cnView.webContents.loadURL(url);
  cnCur = cnView; // 첫 탭에 무언가를 열면(🔍1688 이미지 검색 등) 첫 탭을 보여 준다
  layout(); sendCnTabs();
}
// ---------- 💬 1688 판매자 문의 ----------
const chat = initChat({
  getWin: () => win, getCnView: () => cnView, layout, log, store,
  setShown: (v) => { if (v && active !== "chat") { active = "chat"; send("nav", { tab: "chat", url: "💬 판매자 문의" }); } else if (!v && active === "chat") { active = "cn"; send("nav", { tab: "cn", url: cnView?.webContents.getURL() || "" }); } layout(); },
  sendPanel: send,
  isShown: () => active === "chat",
  isCnShown: () => active === "cn",
});
// 📄 상세페이지 자동 생성: 1688 상품 화면의 📄 버튼(detail:fromPage) 또는 패널(detail:run) → 파이프라인 → 패널 📄 화면(사이트 화면은 layout()이 모두 숨김)
initDetail({
  ipcMain, app, getWin: () => win, store, log, send,
  translate: (texts) => chat.translate(texts), getCnSession: () => cnView?.webContents.session || session.fromPartition("persist:1688"), getCnView: () => cnView,
  showDetail: () => { active = "detail"; layout(); send("nav", { tab: "detail", url: "📄 상세페이지 — 1688 상세 이미지 → 한글 상세페이지" }); },
  // 📄 화면의 주소 칸: 1688 탭을 보이게 열고 그 주소로 이동(화면이 보여야 지연 로딩 이미지·상세가 깨어난다). 읽기가 끝나면 showDetail 로 돌아온다
  openCn: (url) => { createCn(url); active = "cn"; layout(); send("nav", { tab: "cn", url }); },
  // 📄 주소 칸의 쿠팡 상품 주소: 쿠팡 탭(사람이 보는 화면)에 새 탭으로 한 번 연다 — 그 화면을 읽고 끝나면 showDetail 로 돌아온다
  openCoupang: (url) => (win ? openCleanTab(url, true).view.webContents : null),
});
ipcMain.handle("chat:inquire", (e, p) => (isCnWc(e.sender) ? chat.inquire({ offerId: String(p?.offerId || ""), title: String(p?.title || "") }) : { error: "1688 상품 화면에서만 됩니다" }));
ipcMain.handle("chat:state", () => chat.state());
ipcMain.handle("cn:trmode", (e, cycle) => (isCnWc(e.sender) ? (cycle ? chat.cycleSiteMode() : chat.siteMode()) : null)); // ⑤ 1688 사이트 번역 방식
ipcMain.handle("chat:act", (_e, { a, id } = {}) => {
  if (a === "show") chat.show(true);
  else if (a === "back") chat.show(false);
  else if (a === "auto") chat.toggleAuto();
  else if (a === "open") chat.openOne(id);
  else if (a === "resume") chat.resume(id);
  else if (a === "pause") chat.pauseOne(id);
  else if (a === "check") chat.checkNow(id);
  else if (a === "tr") chat.toggleTr();
  else if (a === "remove") chat.remove(id);
  chat.push();
});
const IMG_CDN = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
// 리스트업 행 → 1688 이미지 검색. 사진은 클립보드에도 넣어 둔다(검색이 바로 안 뜨면 1688 검색창 카메라 아이콘에 Ctrl+V)
// 1688에 올릴 사진은 긴 쪽 300px 이하로 줄인다. 1688은 "전체 사진" 영역(region=0,가로,0,세로)을 줄여 둔 사진 기준으로 받아서,
// 640px 사진에 region=0,640,0,640을 주면 영역이 사진 밖이라 0건 → 대신 1688이 물체 하나(통조림·라면)를 골라 엉뚱한 결과(2026-10-13).
// 230px 쿠팡 썸네일에서는 전체 사진 검색이 맞게 동작함을 확인했다
const upImg = (im) => { const { width: w, height: h } = im.getSize(); const m = Math.max(w, h); return m > 300 ? im.resize(w >= h ? { width: 300, quality: "best" } : { height: 300, quality: "best" }) : im; };
ipcMain.handle("cn:search", (_e, p) => { autoPause("직접 🔍1688 검색"); return cnSearch(p); });
async function cnSearch({ rowId, name, keyword, img, allow, price, auto = false }) {
  cnTarget = { rowId, name: String(name || "").slice(0, 80), keyword: String(keyword || "").slice(0, 40), allow: Number(allow) > 0 ? Number(allow) : null, price: Number(String(price || "").replace(/[^\d.]/g, "")) || null, auto: !!auto }; // allow: 리스트업 허용 소싱가(¥) · auto: 담기 자동 조사
  cnRank = null; probeStop();
  const src = !img ? "" : /^https?:/.test(img) ? img : IMG_CDN + String(img).replace(/^\//, "");
  // 1688 이미지 검색은 "사진 주소"로는 결과가 안 나온다 → 1688 첫 화면의 이미지 검색 칸에 사진 파일을 올려 주는 방식(cn.cjs).
  // 사진은 클립보드에도 넣어 둔다(자동 업로드가 안 되면 1688 검색창 카메라 아이콘에서 Ctrl+V)
  let copied = false, clip = false, why = "";
  cnPending = null;
  if (src) {
    // 쿠팡 CDN은 브라우저 정보·참조 주소 없는 요청을 막을 수 있다 → 쿠팡 탭 세션(쿠키·UA)으로 먼저 받고, 안 되면 기본 세션으로
    const headers = { Accept: "image/jpeg,image/png,image/webp,*/*;q=0.8", Referer: "https://www.coupang.com/" };
    const fetchers = [
      () => (cleanView?.webContents.session || session.defaultSession).fetch(src, { headers }),
      () => net.fetch(src, { headers }),
    ];
    for (const f of fetchers) {
      try {
        const r = await f();
        if (!r.ok) { why = `HTTP ${r.status}`; continue; }
        const im = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
        if (im.isEmpty()) { why = "그림 해석 실패"; continue; }
        cnPending = { b64: upImg(im).toJPEG(90).toString("base64"), type: "image/jpeg", ts: Date.now() }; cnPhoto = cnPending; // 🛍 타오바오 같은 상품 찾기에 다시 쓴다
        cnPhotoHash = imageHash(im); // 상품 페이지에서 "사진과 같은 옵션" 고를 때 비교용
        copied = true;
        try { (electron.clipboard || clipboard).writeImage(im); clip = true; } catch {} // 클립보드는 보조 수단 — 실패해도 자동 검색은 진행
        break;
      } catch (e) { why = e?.message || String(e); }
    }
  } else why = "사진 주소 없음";
  createCn(SELFTEST && !process.env.SELFTEST_1688 ? "about:blank" : CN_HOME); // 자체 점검은 1688에 접속하지 않음(SELFTEST_1688=1일 때만 실제 시험)
  active = "cn"; layout();
  send("nav", { tab: "cn", url: "1688 이미지 검색" });
  log("sys", `▶ 1688 이미지 검색 · ${cnTarget.name}${copied ? " — 사진을 1688 화면에 자동으로 올립니다" : ""}${clip ? " (클립보드에도 복사됨)" : ""}`);
  if (!copied) log("stop", `✕ 상품 사진을 받지 못해 자동 이미지 검색을 못 합니다 (${why}) — 1688 첫 화면의 '以图搜款'에 사진을 직접 올려 주세요 · ${src.slice(0, 120)}`);
  if (!copied && auto) autoFail("상품 사진을 받지 못함");
  return { copied };
}

// ---- 🎯 담기 → 1688 자동 조사 줄: 이미지 검색 → 판매자 점수 → 진짜 옵션가 → AI → 원가 기준(decideCost) → 리스트업 위안 칸 + 알림 ----
// 한 번에 하나씩, 상품 사이 20~40초 쉼(1688 보안 인증을 덜 부르게). 보안 인증·직접 검색이 끼면 멈추고 사람에게.
let autoQ = [], autoCur = null, autoTimer = null, autoPaused = false;
const autoGap = () => 20000 + Math.floor(Math.random() * 20000);
const AUTO_LIMIT_MS = 6 * 60 * 1000;
const autoPush = () => send("auto:state", { cur: autoCur ? { rowId: autoCur.rowId, name: autoCur.name } : null, queue: autoQ.map((x) => x.rowId), left: autoQ.length, paused: autoPaused });
// 🧠 판매전략 AI: 리스트업 한 행의 사실·계산값 → 전술 3~6개. 개발 실행은 Claude CLI(구독), 배포판은 서버 중계(task:"strategy" — 서버 준비 전)
ipcMain.handle("ai:strategy", async (_e, input) => {
  if (!input?.name) return { error: "상품 정보가 없습니다" };
  const useCli = !app.isPackaged && process.env.SIGNAL_AI !== "server" && cliAvailable();
  log("sys", `▶ 판매전략 AI · ${String(input.name).slice(0, 26)} (${useCli ? "Claude CLI·구독" : "서버 중계"})`);
  try {
    let j;
    if (useCli) j = await runStructured({ system: STRATEGY_SYSTEM, schema: STRATEGY_SCHEMA, text: renderStrategyInput(input), model: process.env.SIGNAL_AI_MODEL || "sonnet" });
    else {
      const vendorId = await wingVendorId();
      if (!vendorId) return { error: "Wing에 로그인되어 있어야 AI를 쓸 수 있습니다 (① Wing 탭)" };
      const r = await net.fetch(`${DASHBOARD_URL}/api/signal/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor_id: vendorId, task: "strategy", input }) });
      j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) return { error: j?.error || `서버 응답 ${r.status} — 판매전략 서버 중계가 아직 준비되지 않았을 수 있습니다` };
    }
    if (j?.error) return { error: j.error };
    log("go", `■ 판매전략 · ${String(input.name).slice(0, 22)} — ${String(j.result?.summary || "").slice(0, 80)}${j.costUsd != null ? ` · $${Number(j.costUsd).toFixed(3)}` : ""}`);
    return { ok: true, result: j.result, model: j.model };
  } catch (err) { return { error: err?.message || String(err) }; }
});
// 🔬 정확도 대조 파일: 키워드 검색마다 Wing 값·쿠팡 화면 값·카드 글을 나란히 저장 (userData/accuracy/검색어.json, 최근 30개)
ipcMain.handle("diag:save", (_e, p) => {
  try {
    const dir = path.join(app.getPath("userData"), "accuracy");
    fs.mkdirSync(dir, { recursive: true });
    const name = String(p?.kw || "kw").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ kw: p?.kw, ts: new Date().toISOString(), rows: Array.isArray(p?.rows) ? p.rows.slice(0, 120) : [] }, null, 1));
    const files = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    files.slice(30).forEach(({ f }) => fs.unlinkSync(path.join(dir, f)));
    return { ok: true };
  } catch (e) { return { error: e?.message || String(e) }; }
});
ipcMain.handle("cn:queue", (_e, p) => {
  if (!p?.rowId || !p?.img) return { error: "사진이 없는 상품은 자동 조사를 못 합니다" };
  if (autoCur?.rowId === p.rowId || autoQ.some((x) => x.rowId === p.rowId)) return { ok: true, already: true };
  autoQ.push({ rowId: p.rowId, name: String(p.name || "").slice(0, 80), keyword: p.keyword || "", img: p.img, allow: p.allow, price: p.price });
  log("sys", `▶ 1688 자동 조사 줄에 넣음 · ${String(p.name || "").slice(0, 26)} (${autoCur ? `대기 ${autoQ.length}번째` : "바로 시작"})`);
  if (!autoCur && !autoPaused && !autoTimer) autoNext();
  autoPush();
  return { ok: true, pos: autoQ.length };
});
ipcMain.handle("cn:queueAct", (_e, a) => {
  if (a === "resume") { autoPaused = false; log("sys", "▶ 1688 자동 조사 다시 시작"); if (!autoCur) autoNext(); }
  else if (a === "stop") { autoQ = []; autoPaused = false; if (autoCur) autoFail("사용자가 멈춤"); log("sys", "■ 1688 자동 조사 멈춤 · 줄 비움"); }
  autoPush();
  return { ok: true };
});
function autoNext() {
  clearTimeout(autoTimer); autoTimer = null;
  if (autoPaused || autoCur) return;
  autoCur = autoQ.shift() || null;
  if (!autoCur) { autoPush(); return; }
  log("sys", `▶ 1688 자동 조사 · ${autoCur.name.slice(0, 26)}${autoQ.length ? ` · 남은 ${autoQ.length}개` : ""}`);
  autoTimer = setTimeout(() => autoFail("시간 초과(6분)"), AUTO_LIMIT_MS);
  autoPush();
  cnSearch({ ...autoCur, auto: true }).catch((err) => autoFail(err?.message || String(err)));
}
function autoEnd(result) {
  const cur = autoCur; autoCur = null; clearTimeout(autoTimer); autoTimer = null;
  if (cnTarget?.auto) cnTarget.auto = false;
  send("auto:done", { rowId: cur?.rowId, name: cur?.name || "", ...result });
  if (autoQ.length && !autoPaused) { log("dim", `  다음 상품까지 잠깐 쉼 (1688 보안 인증 예방)`); autoTimer = setTimeout(autoNext, autoGap()); }
  else if (!autoQ.length) log("go", "■ 1688 자동 조사 끝");
  autoPush();
}
function autoFail(why) {
  if (!autoCur) return;
  log("warn", `△ 1688 자동 조사 실패 · ${autoCur.name.slice(0, 26)} — ${why} (리스트업 🔍1688로 직접 해 보세요)`);
  autoEnd({ ok: false, why });
}
function autoPause(why) {
  if (!autoCur && !autoQ.length) return;
  if (autoCur) { autoQ.unshift(autoCur); autoCur = null; }
  clearTimeout(autoTimer); autoTimer = null; autoPaused = true;
  log("warn", `△ 1688 자동 조사 일시정지 — ${why} · 남은 ${autoQ.length}개 (리스트업에서 ▶ 다시 시작)`);
  autoPush();
}
// pushRank 때마다: 자동 조사 중인 상품의 AI 판단(또는 실패)이 끝났으면 원가를 정해 리스트업에 넣는다
function autoCheck() {
  if (!autoCur || !cnTarget?.auto || cnTarget.rowId !== autoCur.rowId || !cnRank) return;
  if (cnRank.captcha) { autoPause("1688 보안 인증 — 1688 탭에서 슬라이더를 밀어 주세요"); return; }
  if (!cnRank.ai || cnRank.aiBusy) return;
  const cost = costNow();
  const picks = cnRank.ai?.picks?.length ? cnRank.ai.picks : cnRank.ranked || [];
  const top = picks[0];
  if (!cost || !top?.offerId) { autoFail("추천할 1688 상품을 못 찾음"); return; }
  const allow = autoCur.allow > 0 ? autoCur.allow : null;
  const verdict = allow == null ? null : cost.yuan <= allow ? "ok" : "over";
  const cnUrl = `https://detail.1688.com/offer/${top.offerId}.html`;
  send("listup:fill", { rowId: autoCur.rowId, cnUrl, yuan: cost.yuan, auto: { how: cost.how, sure: cost.sure, warn: cost.warn || "", option: top.optionLabel || "", ai: !cnRank.ai?.error } });
  log(verdict === "over" ? "warn" : "go", `■ 1688 자동 조사 완료 · ${autoCur.name.slice(0, 22)} → ¥${cost.yuan} (${cost.how}${cost.sure ? "" : " · 추정"})${allow ? ` · 허용 ¥${allow.toFixed(1)} ${verdict === "ok" ? "이하 ✔" : "초과 ✕"}` : ""}${cost.warn ? ` · ⚠ ${cost.warn}` : ""}`);
  autoEnd({ ok: true, yuan: cost.yuan, sure: cost.sure, how: cost.how, warn: cost.warn || "", allow, verdict });
}
// 쿠팡 화면 사진 위 🔍1688: 수집함의 지표(있으면)와 함께 리스트업에 담고, 리스트업 화면이 이어서 1688 검색을 연다
ipcMain.handle("cp:to1688", (e, p) => {
  if (!fromClean(e)) return { error: "잘못된 요청" };
  if (!licensed()) return LOCKED;
  if (!/^\d+$/.test(String(p?.pid || ""))) return { error: "상품을 찾지 못했습니다" };
  const o = listCollect().find((x) => String(x.pid) === String(p.pid)) || {};
  send("listup:add1688", {
    pid: String(p.pid), vid: p.vid || o.vid || "", name: p.name || o.name || "", img: p.img || o.img || "",
    price: p.price ?? o.price ?? o.ex?.price ?? null, query: p.query || o.query || "",
    sales: o.ex?.sales ?? null, views: o.ex?.views ?? null,
  });
  return { ok: true };
});
ipcMain.handle("cn:target", (e) => (fromCn(e) ? cnTarget : null));
ipcMain.handle("cn:present", () => true); // 해커 화면이 기본(구 발표 모드) — 1688 화면에도 적용
const fromCn = (e) => !!(isCnWc(e.sender)) || !!(probeView && e.sender === probeView.webContents);

// ---- 결과 목록 → 판매자 추천 TOP ----
// 카드 글자(판매량·재구매율·연차·최소주문·운송비·배지)로 1차 점수 → "진짜 가격 확인"을 누르면 숨은 창에서 상위 후보의
// 상품 페이지를 하나씩(4초 간격) 열어 사진과 같은 옵션 가격을 읽고(sku-core) 가격 점수를 더해 🟢🟡🔴 확정.
let cnRank = null;      // { cards: [...], ranked: [...] }
let probeView = null, probeQueue = [], probeCur = null, probeTimer = null;
const PROBE_MAX = 3, PROBE_TIMEOUT_MS = 25000; // 추천은 3개라 3개만 확인(예전 5개)
const probeGapFast = () => 1500 + Math.floor(Math.random() * 1500); // 빠른 확인(페이지 글만 받기) 사이 1.5~3초
const probeGap = () => 8000 + Math.floor(Math.random() * 7000); // 8~15초 무작위 — 사람이 상품을 하나씩 열어 보는 속도. 1688 보안 인증을 덜 부른다
function rankNow() {
  if (!cnRank) return null;
  const weights = { ...DEFAULT_WEIGHTS, ...(store.get("settings")?.rankWeights || {}) };
  const r = rankCards(cnRank.cards, { allow: cnTarget?.allow ?? null, weights, target: { name: cnTarget?.name || "", keyword: cnTarget?.keyword || "" } }); // target: 다른 상품(엉뚱한 물체로 찾은 결과) 거르기
  cnRank.ranked = r.ranked; cnRank.medianPrice = r.medianPrice; cnRank.offTarget = r.excluded.filter((x) => x.offTarget).length;
  if (r.mismatch && !cnRank.mismatchLogged) { cnRank.mismatchLogged = true; log("stop", `✕ 1688 결과가 쿠팡 상품(${(cnTarget?.name || "").slice(0, 24)})과 닮은 게 없습니다 — 사진 검색이 빗나간 것 같습니다`); }
  const top = r.ranked.slice(0, 8).map((x) => ({ ...x, verdictKo: VERDICT_KO[x.verdict] || x.verdict }));
  return { top, total: cnRank.cards.length, excluded: r.excluded.length, allow: cnTarget?.allow ?? null, medianPrice: r.medianPrice,
    probing: !!probeCur || probeQueue.length > 0, probeLeft: probeQueue.length + (probeCur ? 1 : 0), ai: cnRank.ai || null, aiBusy: !!cnRank.aiBusy, captcha: !!cnRank.captcha, cost: costNow(), mismatch: !!r.mismatch };
}
// 원가 기준: AI 추천(없으면 점수) 상위 3개 → 1순위의 확인된 옵션가, 애매하면 확인된 것들의 중간값
function costNow() {
  const card = (id) => cnRank.cards.find((o) => o.offerId === id) || {};
  const picks = cnRank.ai?.picks?.length ? cnRank.ai.picks : (cnRank.ranked || []);
  const list = picks.slice(0, 3).map((p) => { const c = card(p.offerId), price = p.price ?? c.realPrice ?? c.price ?? null;
    return { offerId: p.offerId, price, real: c.realPrice != null, sure: c.realPrice != null && !!c.priceSure && price === c.realPrice }; });
  return decideCost(list);
}
const pushRank = () => { const r = rankNow(); if (r && cnView) cnView.webContents.send("cn:rankUpdate", r); autoCheck(); return r; };
ipcMain.handle("cn:rank", async (e, p) => {
  if (!isCnWc(e.sender) || !cnTarget) return { error: "리스트업에서 🔍1688로 들어온 검색이 아닙니다" };
  const cards = (Array.isArray(p?.cards) ? p.cards : []).slice(0, 80).map((c, i) => parseCard(c.lines, { rank: i + 1, offerId: String(c.offerId || ""), img: c.img || "" }))
    .map((c) => { const o = cnRank?.cards.find((x) => x.offerId === c.offerId) || {}; return { ...c, realPrice: o.realPrice ?? null, option: o.option ?? null, priceSure: !!o.priceSure, priceHow: o.priceHow || "" }; }); // 다시 읽어도 확인한 옵션가·확신 유지
  // 1688 원문 제목이 중국어면 "같은 상품인지"(쿠팡 상품명·대표키워드 겹침)를 볼 수 없다 → 제목만 번역해(저장해 둔 번역 재사용) 판단에 쓴다. 8초 넘으면 번역 없이 진행
  const zh = cards.filter((c) => /[\u4e00-\u9fff]/.test(c.title || "") && !/[가-힣]{2}/.test(c.title || ""));
  if (zh.length) {
    const tr = (async () => { for (let i = 0; i < zh.length; i += 40) { const part = zh.slice(i, i + 40), ko = await chat.translate(part.map((c) => c.title)); part.forEach((c, j) => { if (ko[j]) c.titleKo = ko[j]; }); } })();
    await Promise.race([tr.catch((err) => log("dim", `  1688 제목 번역 실패: ${err?.message || err}`)), new Promise((res) => setTimeout(res, 8000))]);
    log("dim", `  1688 제목 번역 ${zh.filter((c) => c.titleKo).length}/${zh.length}개 (같은 상품 확인용)`);
  }
  cnRank = { cards };
  const r = rankNow();
  // 후보를 하나도 못 읽었으면 실제 카드 글자를 남긴다(1688 표기·언어가 바뀌었을 때 규칙을 맞추는 근거)
  if (!r.top.length && cnTarget.auto) setTimeout(() => autoFail("1688 후보가 없음"), 0);
  if (!r.top.length && p?.cards?.length) log("dim", `  1688 카드를 못 읽음 · 예: ${(p.cards[0].lines || []).map((x) => String(x).trim()).filter(Boolean).join(" | ").slice(0, 400)}`);
  const off = cnRank.offTarget || 0;
  if (off) log("dim", `  1688 다른 상품 의심 ${off}개 뺌 (쿠팡 상품명·대표키워드와 제목이 거의 안 겹침 — 사진 일부만 잘라 찾은 결과)`);
  log("sys", `▶ 1688 후보 ${cards.length}개 읽음 · 상위 ${r.top.slice(0, 3).map((x) => `${x.score}점`).join("/")}${cnTarget.allow ? ` · 허용 소싱가 ¥${cnTarget.allow.toFixed(1)}` : " · 허용 소싱가 없음(리스트업 판매가 필요)"}`);
  return r;
});
// 카드 하나만 진짜 옵션가 확인(보드의 "옵션가 확인" 버튼)
ipcMain.handle("cn:probeOne", async (e, offerId) => {
  if (!isCnWc(e.sender) || !cnRank) return { error: "먼저 결과 목록을 읽어야 합니다" };
  const id = String(offerId || ""); if (!/^\d{6,15}$/.test(id)) return { error: "상품 번호가 없습니다" };
  try {
    const r = await fastProbe(id);
    if (!r || r.captcha) return { error: r?.captcha ? "1688 보안 인증 — 상품 열기로 확인해 주세요" : "옵션표를 못 찾았습니다 — 상품 열기로 확인해 주세요" };
    markProbe(id, r); log("dim", `  1688 가격 확인(하나) · ${id} → ${r.price != null ? "¥" + r.price : "없음"} · ${r.how || ""}`); pushRank();
    return { ok: true, price: r.price };
  } catch (err) { return { error: String(err?.message || err).slice(0, 80) }; }
});
// 진짜 가격 확인: 가격 모르는 상위 PROBE_MAX개를 숨은 창에서 차례로
ipcMain.handle("cn:probe", (e) => {
  if (!isCnWc(e.sender) || !cnRank) return { error: "먼저 결과 목록을 읽어야 합니다" };
  if (probeCur || probeQueue.length) return { ok: true, already: true };
  cnRank.captcha = false;
  probeQueue = cnRank.ranked.filter((x) => x.realPrice == null && x.offerId).slice(0, PROBE_MAX).map((x) => x.offerId);
  if (!probeQueue.length) return { ok: true, nothing: true };
  log("sys", `▶ 1688 진짜 가격 확인 · 상위 ${probeQueue.length}개 (상품 페이지 글에서 옵션표를 바로 읽음)`);
  probeNext();
  return { ok: true, count: probeQueue.length };
});
const probeSlow = new Set(); // 빠른 확인이 안 되는 상품 → 예전 방식(숨은 창)
function probeStop() { clearTimeout(probeTimer); probeQueue = []; probeCur = null; if (probeView) { try { win?.contentView.removeChildView(probeView); probeView.webContents.close(); } catch {} probeView = null; } }
// ---- 빠른 옵션가 확인 (2026-10-13) ----
// 상품 페이지를 숨은 창에 통째로 그리던 방식(상품당 10~20초 + 8~15초 쉼) 대신, 페이지 글(HTML)만 한 번 받아
// 안에 든 옵션표(skuProps: 옵션 이름·사진 / skuInfoMap: 옵션별 가격·재고)를 읽는다 → 상품당 1초 안팎.
// 보안 인증 페이지가 오거나 옵션표를 못 찾으면 예전 방식(숨은 창)으로 그 상품만 다시 확인한다.
function jsonAt(html, key, open) {
  const i = html.indexOf(`"${key}":`); if (i < 0) return null;
  const st = html.indexOf(open, i); if (st < 0) return null;
  const close = open === "{" ? "}" : "]"; let d = 0, inStr = false;
  for (let k = st; k < html.length && k < st + 400000; k++) {
    const ch = html[k];
    if (inStr) { if (ch === "\\") k++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === open) d++; else if (ch === close && --d === 0) { try { return JSON.parse(html.slice(st, k + 1)); } catch { return null; } }
  }
  return null;
}
async function fastProbe(id) {
  const ses = cnView?.webContents.session || session.fromPartition("persist:1688");
  const r = await ses.fetch(`https://detail.1688.com/offer/${id}.html`, { headers: { Referer: "https://s.1688.com/", Accept: "text/html" } });
  const html = await r.text();
  if (/punish|_____tmd_____|x5sec|滑动验证|请拖动|captcha/i.test(html.slice(0, 20000)) && !/skuInfoMap/.test(html)) return { captcha: true };
  const props = jsonAt(html, "skuProps", "[") || [], info = jsonAt(html, "skuInfoMap", "{");
  const dec = (t) => String(t || "").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&quot;/g, '"');
  const imgOf = new Map(); for (const pr of props) for (const v of pr?.value || []) if (v?.imageUrl) imgOf.set(dec(v.name), v.imageUrl);
  let entries = [];
  if (info && typeof info === "object") entries = Object.entries(info).map(([k, v]) => { const parts = dec(k).split(">"); return { label: parts.join(" › "), price: v?.discountPrice || v?.price || "", img: parts.map((x) => imgOf.get(x)).find(Boolean) || "", stock: v?.canBookCount ?? null }; }).filter((x) => x.price);
  if (!entries.length) {
    const pm = html.match(/"(?:price|discountPrice)"\s*:\s*"(\d+(?:\.\d+)?)"/);
    return pm ? { price: Number(pm[1]), how: "옵션 없음 — 단일 가격", sure: true, fast: true } : null;
  }
  const list = entries.slice(0, 40);
  const withHash = [];
  for (let k = 0; k < list.length; k += 6) withHash.push(...await Promise.all(list.slice(k, k + 6).map(async (it) => ({ ...it, hash: it.img ? await hashImageUrl(it.img) : null, ko: koHint(it.label) }))));
  const d = decidePrice(withHash, { photoHash: cnPhotoHash, name: cnTarget?.name || "" });
  const options = (d.alts || []).slice(0, 10).map((a) => ({ label: a.label, price: a.price, dist: a.dist ?? null, bait: !!a.bait }));
  return { price: d.price ?? null, pick: d.pick ? { i: d.pick.i, label: d.pick.label, price: d.pick.price, dist: d.pick.dist ?? null, ko: koHint(d.pick.label) } : null, how: (d.how || "") + " · 빠른 확인", sure: !!d.sure, options, fast: true };
}
function probeNext() {
  clearTimeout(probeTimer);
  probeCur = probeQueue.shift() || null;
  if (!probeCur) { log("sys", "■ 1688 진짜 가격 확인 끝"); probeStop(); pushRank(); return; }
  if (!probeSlow.has(probeCur)) {
    const id = probeCur; pushRank();
    fastProbe(id).then((r) => {
      if (probeCur !== id) return; // 그사이 취소
      if (r?.captcha) { probeSlow.add(id); log("dim", `  1688 빠른 확인 중 보안 인증 → 화면으로 확인 · ${id}`); probeQueue.unshift(id); probeCur = null; return probeNext(); }
      if (!r) { probeSlow.add(id); probeQueue.unshift(id); probeCur = null; return probeNext(); } // 옵션표 못 찾음 → 예전 방식
      markProbe(id, r);
      log("dim", `  1688 가격 확인 · ${id} → ${r.price != null ? "¥" + r.price : "없음"}${r.pick?.label ? ` (${String(r.pick.label).slice(0, 24)})` : ""} · ${r.how || ""}`);
      pushRank();
      probeTimer = setTimeout(probeNext, probeGapFast());
    }).catch((err) => { probeSlow.add(id); log("dim", `  1688 빠른 확인 실패(${String(err?.message || err).slice(0, 60)}) → 화면으로 확인 · ${id}`); probeQueue.unshift(id); probeCur = null; probeNext(); });
    return;
  }
  if (!probeView) {
    probeView = new WebContentsView({ webPreferences: { partition: "persist:1688", contextIsolation: true, sandbox: true, preload: path.join(__dirname, "../preload/cn.cjs") } });
    win.contentView.addChildView(probeView);
    probeView.setBounds({ x: 0, y: 0, width: 1100, height: 900 }); probeView.setVisible(false); // 보이지 않는 창(화면 밖이 아니라 숨김)
  }
  probeView.webContents.loadURL(`https://detail.1688.com/offer/${probeCur}.html`);
  pushRank();
  probeTimer = setTimeout(() => { log("dim", `  1688 가격 확인 시간 초과 · ${probeCur}`); markProbe(probeCur, { price: null, how: "시간 초과" }); probeTimer = setTimeout(probeNext, probeGap()); }, PROBE_TIMEOUT_MS);
}
function markProbe(offerId, r) {
  const c = cnRank?.cards.find((x) => x.offerId === String(offerId));
  if (c) { c.realPrice = r.price ?? null; c.option = r.pick ? { label: r.pick.label, ko: r.pick.ko || "", dist: r.pick.dist ?? null } : null; c.priceHow = r.how || ""; c.priceSure = !!r.sure; c.options = Array.isArray(r.options) ? r.options.slice(0, 10) : c.options; }
}
// ---- AI 추천: 서버 중계(강사 키) → Claude. 앱이 읽은 숫자·글자만 보내고, AI는 후보 번호·옵션 번호·이유(한글)만 돌려준다 ----
ipcMain.handle("cn:ai", async (e) => {
  if (!isCnWc(e.sender) || !cnRank?.ranked?.length) return { error: "먼저 결과 목록을 읽어야 합니다" };
  if (cnRank.aiBusy) return { ok: true, already: true };
  // 개발 실행 + Claude CLI 있음 → 구독 CLI로(개발자 시험용). 그 밖(배포판)은 서버 중계(강사 키, 수강생 승인·하루 한도)
  const useCli = !app.isPackaged && process.env.SIGNAL_AI !== "server" && cliAvailable();
  const vendorId = useCli ? null : await wingVendorId();
  if (!useCli && !vendorId) { const error = "Wing에 로그인되어 있어야 AI 추천을 쓸 수 있습니다 (① Wing 탭)"; cnRank.ai = { error }; pushRank(); return { error }; } // 자동 조사는 AI 없이 확인된 옵션가로 이어 간다
  cnRank.aiBusy = true; cnRank.ai = null; pushRank();
  const cards = cnRank.ranked.slice(0, useCli ? 15 : 25).map((c, i) => ({ // CLI는 느려서 후보를 줄인다
    n: i + 1, offerId: c.offerId, title: c.title, price: c.price, shipping: c.shipping, sales: c.sales, moq: c.moq, repeat: c.repeat, years: c.years, rank: c.rank,
    badges: c.badges, company: c.company, score: c.score, max: c.max, realPrice: c.realPrice ?? null, option: c.option?.label || null, priceHow: c.priceHow || "",
    options: c.options ? c.options.map((o, j) => ({ n: j + 1, label: o.label, price: o.price, dist: o.dist, bait: !!o.bait })) : undefined,
  }));
  const input = { target: { name: cnTarget?.name || "", allow: cnTarget?.allow ?? null, price: cnTarget?.price ?? null }, medianPrice: cnRank.medianPrice ?? null, cards };
  log("sys", `▶ AI 추천 요청 (${useCli ? "Claude CLI·구독" : "서버 중계"}) · 후보 ${cards.length}개 (옵션가 확인된 것 ${cards.filter((c) => c.realPrice != null).length}개)`);
  try {
    let j;
    if (useCli) {
      j = await recommendViaCli(input);
      if (j?.error) throw new Error(j.error);
    } else {
      const r = await net.fetch(`${DASHBOARD_URL}/api/signal/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor_id: vendorId, task: "recommend", input }) });
      j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `서버 응답 ${r.status}`);
    }
    // 후보·옵션 번호를 실제 카드·옵션으로 풀어 둔다
    const picks = (j.result?.picks || []).map((p) => {
      const c = cards[p.candidate - 1]; const card = cnRank.cards.find((x) => x.offerId === c?.offerId);
      const opt = p.option != null && c?.options ? c.options[p.option - 1] : null;
      return { ...p, offerId: c?.offerId || "", title: c?.title || "", company: c?.company || "", price: opt?.price ?? card?.realPrice ?? c?.price ?? null, optionLabel: opt?.label || card?.option?.label || "", sales: c?.sales, repeat: c?.repeat, years: c?.years, moq: c?.moq };
    }).filter((p) => p.offerId);
    cnRank.ai = { picks, skipped: j.result?.skipped_ko || "", summary: j.result?.summary_ko || "", model: j.model, used: j.used ?? null, limit: j.limit ?? null, ts: Date.now() };
    log("go", `■ AI 추천 ${picks.length}개 · ${picks.map((p) => `${p.verdict === "green" ? "🟢" : p.verdict === "yellow" ? "🟡" : "🔴"} ${p.title.slice(0, 18)} ¥${p.price ?? "?"}`).join(" / ")}${j.used != null ? ` (오늘 ${j.used}/${j.limit}회)` : ""}${j.costUsd != null ? ` · $${Number(j.costUsd).toFixed(3)}` : ""}`);
  } catch (err) {
    cnRank.ai = { error: err?.message || String(err) };
    log("stop", `✕ AI 추천 실패 · ${cnRank.ai.error}`);
  }
  cnRank.aiBusy = false;
  pushRank();
  return { ok: true };
});

// 상품 페이지 상세 글·속성표에서 크기·무게·박스 수량 읽기 (리스트업 🚚 물류 칸 자동 입력용)
ipcMain.handle("cn:specs", (e, p) => (fromCn(e) ? parseSpecs({ text: String(p?.text || "").slice(0, 20000), attrText: String(p?.attrText || "").slice(0, 4000), optionLabel: p?.optionLabel || "" }) : { found: false }));

ipcMain.on("cn:captcha", (e) => { if (isCnWc(e.sender)) { log("stop", "✕ 1688 보안 인증(슬라이더)이 떴습니다 — 1688 탭에서 직접 밀어 주세요. 프로그램은 대신 풀지 않습니다."); autoPause("1688 보안 인증"); } });
ipcMain.on("cn:noResult", (e, why) => { if (isCnWc(e.sender) && cnTarget?.auto) autoFail(String(why || "1688 결과 없음").slice(0, 80)); });

ipcMain.handle("cn:probeMode", (e) => !!(probeView && e.sender === probeView.webContents));
ipcMain.on("cn:probeResult", (e, r) => {
  if (!probeView || e.sender !== probeView.webContents || !probeCur || String(r?.offerId) !== String(probeCur)) return;
  clearTimeout(probeTimer);
  if (r?.captcha) {
    // 숨은 창이 보안 인증을 만남 → 사용자가 볼 수 있게 1688 탭에 그 페이지를 띄우고 가격 확인은 중단
    const id = probeCur; probeStop();
    if (cnRank) cnRank.captcha = true;
    cnView?.webContents.loadURL(`https://detail.1688.com/offer/${id}.html`);
    active = "cn"; layout(); send("nav", { tab: "cn", url: "1688 보안 인증 필요" });
    log("stop", "✕ 1688 보안 인증(슬라이더)이 떴습니다 — 1688 탭에서 직접 밀어 주세요. 인증 후 '딸깍 추천'을 다시 누르면 이어집니다.");
    pushRank();
    return;
  }
  markProbe(probeCur, r || {});
  log("dim", `  1688 가격 확인 · ${probeCur} → ${r?.price != null ? "¥" + r.price : "없음"}${r?.pick?.label ? ` (${String(r.pick.label).slice(0, 24)})` : ""} · ${r?.how || ""}`);
  pushRank();
  probeTimer = setTimeout(probeNext, probeGap());
});
ipcMain.handle("cn:pending", (e) => {
  if (!isCnWc(e.sender) || !cnPending || Date.now() - cnPending.ts > 10 * 60 * 1000) return null; // 로그인·인증을 거쳐 돌아와도 이어지게 10분
  return cnPending; // 업로드가 끝났다고 알려 올 때까지 유지(페이지가 한 번 다시 열려도 이어서)
});
ipcMain.handle("cn:pendingDone", (e) => { if (isCnWc(e.sender)) cnPending = null; });
// ✕ 1688 검색 취소: 잘못 누른 검색(예: 상세페이지 사진)을 멈춘다 — 올릴 사진·대상·옵션가 확인을 모두 비우고 1688 첫 화면으로
ipcMain.handle("cn:cancel", (e) => {
  if (!isCnWc(e.sender)) return;
  log("stop", `■ 1688 검색 취소 · ${cnTarget?.name || ""}`);
  cnPending = null; cnTarget = null; cnRank = null; probeStop();
  cnView.webContents.loadURL(CN_HOME);
});

// ---- 🛍 타오바오에서 같은 상품 찾기 + 📷 리뷰 사진 모으기 ----
// 1688은 도매라 싸지만 상세·리뷰 사진이 약하다 → 같은 사진으로 타오바오를 찾아, 직접 촬영한 판매자 상세와 구매자 리뷰 사진을 참고 자료로 모은다.
// 1688 탭(같은 알리바바 로그인)에서 연다. 화면에 뜬 것만 읽고, 사진 검색·리뷰 저장은 사람이 누를 때만.
initWave({ ipcMain, store, log, getCnView: () => cnView, fromCn: (e) => fromCn(e) || tbWins.has(e.sender), getTarget: () => cnTarget });
let cnPhoto = null, tbPending = null;
const tbWins = new Set(); // 타오바오 사진 검색 새 창(들)의 화면
const fromTb = (e) => fromCn(e) || tbWins.has(e.sender);
ipcMain.handle("tb:search", (e) => {
  if (!fromCn(e)) return { error: "1688 탭에서만 됩니다" };
  if (!cnPhoto) return { error: "쿠팡 상품 사진이 없습니다 — 리스트업에서 🔍1688로 먼저 검색해 주세요" };
  tbPending = { ...cnPhoto, ts: Date.now() };
  log("sys", `▶ 🛍 타오바오에서 같은 상품 찾기 · ${cnTarget?.name || ""} — 같은 쿠팡 사진으로 타오바오 사진 검색`);
  cnView.webContents.loadURL("https://www.taobao.com/");
  return { ok: true };
});
ipcMain.handle("tb:pending", (e) => (fromTb(e) && tbPending && Date.now() - tbPending.ts < 10 * 60 * 1000 ? tbPending : null));
ipcMain.handle("tb:pendingDone", (e) => { if (fromTb(e)) tbPending = null; });
ipcMain.on("tb:log", (e, t) => { if (fromTb(e)) log("dim", `  🛍 ${String(t).slice(0, 900)}`); });
ipcMain.handle("tb:translate", async (e, texts) => (fromTb(e) ? chat.translate((Array.isArray(texts) ? texts : []).slice(0, 60).map((t) => String(t || "").slice(0, 500))) : []));
// 고른 리뷰 사진을 폴더에 저장(+번역한 리뷰 글) → 폴더를 연다. 상세페이지에 쓸지는 사람이 고른다(다른 판매자·구매자 사진의 권리 주의)
ipcMain.handle("tb:saveReviews", async (e, p = {}) => {
  if (!fromTb(e)) return { error: "1688 탭에서만 됩니다" };
  const id = String(p.itemId || "item").replace(/[^\w-]/g, "").slice(0, 30) || "item";
  const dir = path.join(app.getPath("userData"), "taobao-reviews", id);
  fs.mkdirSync(dir, { recursive: true });
  const items = (Array.isArray(p.items) ? p.items : []).slice(0, 80);
  const ses = cnView?.webContents.session || session.fromPartition("persist:1688");
  let ok = 0; const lines = [`${p.title || ""}`, p.url || "", ""];
  for (const [i, it] of items.entries()) {
    const u = String(it.url || "");
    if (!/^https:\/\/[\w.-]*(alicdn|taobaocdn|tbcdn)\.(com|cn)\//i.test(u)) continue;
    try {
      const r = await ses.fetch(u, { headers: { Referer: "https://item.taobao.com/" } });
      if (!r.ok) continue;
      const ext = /png/i.test(r.headers.get("content-type") || "") ? "png" : "jpg";
      fs.writeFileSync(path.join(dir, `review-${String(i + 1).padStart(2, "0")}.${ext}`), Buffer.from(await r.arrayBuffer()));
      ok++;
      lines.push(`review-${String(i + 1).padStart(2, "0")}: ${it.ko || ""}${it.zh ? `\n   (원문) ${it.zh}` : ""}`);
    } catch {}
  }
  fs.writeFileSync(path.join(dir, "리뷰내용.txt"), lines.join("\n"), "utf8");
  log("go", `■ 📷 타오바오 리뷰 사진 ${ok}/${items.length}장 저장 · ${dir}`);
  shell.openPath(dir);
  return { ok: true, saved: ok, dir };
});

// ---- 상품 페이지 옵션(SKU) 가격: 쿠팡 사진과 가장 비슷한 옵션을 고른다 ----
// 1688 결과 목록의 ¥는 옵션 중 최저가라 부품·차액 같은 낚시 옵션이 섞이면 실제 가격과 다르다.
let cnPhotoHash = null;
const imageHash = (im) => { try { return dhashFromGray(grayFromBGRA(im.resize({ width: 9, height: 8, quality: "good" }).toBitmap())); } catch { return null; } };
const skuHashCache = new Map(); // 옵션 사진 주소 → 해시 (같은 페이지에서 반복 비교)
async function hashImageUrl(url) {
  const u = String(url || "").replace(/_sum\.jpg$/, "").replace(/\.webp$/, ""); // 썸네일 꼬리 제거
  if (!/^https?:\/\//.test(u)) return null;
  if (skuHashCache.has(u)) return skuHashCache.get(u);
  let h = null;
  try {
    const r = await ((cnView || probeView)?.webContents.session || session.defaultSession).fetch(u, { headers: { Referer: "https://detail.1688.com/" } });
    if (r.ok) { const im = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer())); if (!im.isEmpty()) h = imageHash(im); }
  } catch {}
  skuHashCache.set(u, h);
  if (skuHashCache.size > 300) skuHashCache.delete(skuHashCache.keys().next().value);
  return h;
}
// entries: [{label, img, price?}] → 사진 비교 순위 + (가격이 있으면) 가격 판단
ipcMain.handle("cn:sku", async (e, p) => {
  if (!fromCn(e)) return { error: "잘못된 요청" };
  const entries = Array.isArray(p?.entries) ? p.entries.slice(0, 60) : [];
  const withHash = [];
  for (const it of entries) withHash.push({ ...it, hash: it.img ? await hashImageUrl(it.img) : null, ko: koHint(it.label) });
  const name = cnTarget?.name || ""; // 사진이 같은 옵션은 쿠팡 상품명의 규격(4단·대형·2개입·120cm)으로 가른다
  const ranked = specRerank(cnPhotoHash ? rankBySimilarity(cnPhotoHash, withHash) : withHash.map((x, i) => ({ ...x, i, dist: null })), name);
  const out = { hasPhoto: !!cnPhotoHash, ranked: ranked.map(({ hash, ...r }) => ({ ...r, price: toNum(r.price) })) }; // 가격은 숫자로(원문 "¥11.2" 그대로 흘러가 "¥¥" 표시되던 문제)
  if (p?.stage === "items") {
    const d = decidePrice(withHash, { photoHash: cnPhotoHash, name });
    out.decision = { ...d, pick: d.pick ? { i: d.pick.i, label: d.pick.label, price: d.pick.price, dist: d.pick.dist ?? null, ko: koHint(d.pick.label) } : null,
      alts: d.alts.map((a) => ({ i: a.i, label: a.label, price: a.price, dist: a.dist ?? null, ko: koHint(a.label) })) };
  }
  return out;
});
ipcMain.on("cn:log", (e, text) => { if (isCnWc(e.sender)) log("dim", `  1688 · ${String(text).slice(0, 900)}`); });
// 상품 페이지에서 사람이 옵션을 직접 고르면 그 가격을 "확인됨"으로 — 추천 카드·원가 기준에 바로 반영
ipcMain.on("cn:optPick", (e, p) => {
  if (!isCnWc(e.sender) || !cnRank) return;
  const c = cnRank.cards.find((o) => o.offerId === String(p?.offerId || "")), price = Number(p?.price);
  if (!c || !(price > 0)) return;
  Object.assign(c, { realPrice: price, priceSure: true, priceHow: "직접 고른 옵션", option: { label: String(p?.label || "").slice(0, 80), ko: "", dist: null } });
  log("dim", `  1688 옵션 직접 선택 · ${c.offerId} → ¥${price} (${String(p?.label || "").slice(0, 30)})`);
  pushRank();
});
ipcMain.handle("cn:pick", (e, p) => {
  if (!isCnWc(e.sender) || !cnTarget) return { error: "넣을 리스트업 행이 없습니다 — 리스트업에서 🔍1688을 먼저 눌러 주세요" };
  const yuan = Number(p?.yuan);
  const url = String(p?.url || "");
  if (!/^https:\/\/([\w-]+\.)*1688\.com\//.test(url)) return { error: "1688 상품 주소가 아닙니다" };
  const specs = p?.specs && typeof p.specs === "object" ? { dims: String(p.specs.dims || ""), wt: p.specs.g != null ? String(p.specs.g) : "", cartonQty: p.specs.cartonQty ?? null } : null;
  send("listup:fill", { rowId: cnTarget.rowId, cnUrl: url, yuan: yuan > 0 ? yuan : null, cnTitle: String(p?.title || "").slice(0, 120), option: String(p?.option || "").slice(0, 80), specs });
  log("go", `■ 1688 → 리스트업 · ${cnTarget.name} ← ¥${yuan > 0 ? yuan : "?"}${p?.option ? ` (옵션: ${String(p.option).slice(0, 40)})` : ""}${specs?.dims ? ` · 크기 ${specs.dims}mm` : ""}${specs?.wt ? ` · ${specs.wt}g` : ""}${specs?.cartonQty ? ` · ${specs.cartonQty}개/박스` : ""} ${url}`);
  active = "list"; layout(); send("nav", { tab: "list", url: "리스트업 — 중국 원가·마진 계산" });
  return { ok: true };
});
// 탭 줄 버튼은 지금 보는 화면(쿠팡 검색 / 1688)의 탭에 적용
ipcMain.handle("ctab:select", (_e, id) => { if (active === "cn") selectCnTab(id); else selectCleanTab(id); });
ipcMain.handle("ctab:close", (_e, id) => { if (active === "cn") closeCnTab(id); else closeCleanTab(id); });
ipcMain.handle("ctab:new", () => { if (active === "cn") openCnTab(CN_HOME, true); else openCleanTab(COUPANG_HOME, true); });
ipcMain.on("cp:log", (e, text) => { if (isClean(e.sender)) log("dim", `  ${String(text).slice(0, 200)}`); });
// 쿠팡 화면 카드의 "쿠팡 지표" 조회 — 클린 세션 화면에서 온 요청만 받는다. Wing 조회는 로그인된 Wing 화면에서.
const fromClean = (e) => isClean(e.sender);
const collectChanged = () => send("collect:changed", { count: countCollect() });
// 쿠팡 검색 화면에서 읽은 카드 정보(검색어·순위·광고 칸·리뷰·로켓·가격)를 수집함에 넣는다 — 네트워크 요청 없음
ipcMain.on("cp:page", (e, { query, page, items }) => {
  if (!fromClean(e) || !Array.isArray(items)) return;
  const pbs = pbList(settings());
  upsertPage(query, page, items.slice(0, 120).map((it) => ({ ...it, pb: isPB({ name: it.name, brand: "" }, pbs) })));
  collectChanged();
});
// 검색어 한 번으로 화면 상품 여러 개의 지표를 받기 (Wing 상품 매칭 검색에 검색어를 넣음 · 7일 저장 · 같은 속도 제한)
ipcMain.handle("cp:batch", async (e, { query, pids }) => {
  if (!licensed()) return { hits: {}, ...LOCKED, auth: true };
  if (!fromClean(e) || !query) return { hits: {} };
  const res = await searchKeyword(String(query).slice(0, 60), 1, wingView.webContents, log, false);
  if (res.error) {
    log("warn", `△ 검색어 한 번에 받기 실패 — ${res.error} · 상품별 조회로 진행`);
    return { hits: {}, error: res.error, paused: /한도|정지|제한/.test(res.error), auth: /로그인/.test(res.error) };
  }
  const want = new Set((pids || []).map(String));
  const hits = {};
  res.items.forEach((it) => { if (it.ex && want.has(String(it.pid))) hits[it.pid] = it.ex; });
  Object.entries(hits).forEach(([pid, ex]) => upsertMetric(pid, ex));
  const withM = res.items.filter((it) => it.ex).length;
  log(Object.keys(hits).length ? "go" : "warn", `${Object.keys(hits).length ? "⚡" : "△"} 검색어 '${query}' 한 번에 받기 — Wing 응답 ${res.items.length}개(지표 ${withM}개) 중 화면 상품 ${Object.keys(hits).length}개 일치${res.cached ? " (저장값)" : ""}`);
  if (!withM && res.items.length) log("dim", `  응답 필드: ${(res.fields || []).slice(0, 20).join(", ")}`);
  if (!res.items.length) log("dim", `  응답에 상품 목록이 없었습니다 — 상품별 조회로 진행`);
  collectChanged();
  return { hits, cached: !!res.cached, total: res.items.length };
});
// 📦 담기: 쿠팡 화면의 상품 하나를 사람이 직접 수집함에 넣는다(네트워크 요청 없음)
ipcMain.handle("cp:pick", (e, it) => {
  if (!fromClean(e) || !/^\d+$/.test(String(it?.pid || ""))) return { error: "상품을 찾지 못했습니다" };
  const n = pickCollect({ pid: String(it.pid), vid: it.vid || "", name: String(it.name || "").slice(0, 120), price: Number(it.price) || null, img: String(it.img || "").slice(0, 400) }, it.query || "");
  log("go", `📦 담음 · ${String(it.name || it.pid).slice(0, 30)}${it.query ? ` (${it.query})` : ""} · 수집함 ${n}개`);
  collectChanged();
  return { ok: true, count: n };
});
ipcMain.handle("cp:metric", async (e, it) => {
  if (!licensed()) return { ...LOCKED, auth: true };
  if (!fromClean(e) || !/^\d+$/.test(String(it?.pid || ""))) return { error: "잘못된 요청" };
  const nm = String(it.name || it.pid).slice(0, 24);
  // 쿠팡 PB(코멧·곰곰 등)는 판매자 상품 매칭에 지표가 없다 → 조회하지 않고 바로 표시
  if (isPB({ name: it.name, brand: "" }, pbList(settings()))) { log("dim", `  − 쿠팡 PB 건너뜀 · ${nm}`); return { pb: true, error: "쿠팡 PB · 지표 없음" }; }
  const r = await lookupOne({ pid: String(it.pid), vid: it.vid || "", iid: it.iid || "", name: String(it.name || "") }, wingView.webContents);
  // 검색어가 없는 화면(상품 상세 등)에서 조회해도 상품명·사진·가격은 수집함에 남긴다
  if (r.ex) { upsertMetric(String(it.pid), r.ex, { name: String(it.name || ""), vid: it.vid || "", price: Number(it.price) || null, img: String(it.img || "").slice(0, 400) }); collectChanged(); }
  if (r.recent) return r;
  if (r.soft) { log("dim", `  ⏸ 10분 60건 한도 — ${new Date(r.until).toLocaleTimeString("ko-KR")}에 자동으로 이어서 조회`); return r; }
  if (r.ex) log(r.cached ? "dim" : "go", `${r.cached ? "  ↺" : "✔"} 쿠팡 지표 · ${nm} — 판매 ${r.ex.sales ?? "-"} / 조회 ${r.ex.views ?? "-"}${r.cached ? " (저장값)" : ""}`);
  else log(r.paused || r.auth ? "stop" : "warn", `✕ 쿠팡 지표 · ${nm} — ${r.error}`);
  return r;
});
// 📝 리뷰 분석: 쿠팡 상품 화면이 최신순으로 받은 리뷰(최대 1,500개 · 더 받기 3,000) → 급증 구간·의심 신호 계산
// 저장: userData/reviews/상품번호.json(마지막 조회 원문, 최근 200개 상품) + index.json(조회 기록: 상품별 요약·조회 이력 20회)
// 분석 계산(review-core)은 고칠 때마다 다시 읽는다 — 기준을 다듬을 때 앱 재시작이 필요 없게(쿠팡 차단 위험 줄이기)
const reviewCore = async () => {
  const f = path.join(__dirname, "../shared/review-core.js");
  return import(`${pathToFileURL(f).href}?v=${Math.round(fs.statSync(f).mtimeMs)}`);
};
const revDir = () => { const d = path.join(app.getPath("userData"), "reviews"); fs.mkdirSync(d, { recursive: true }); return d; };
const revIndex = () => { try { return JSON.parse(fs.readFileSync(path.join(revDir(), "index.json"), "utf8")); } catch { return {}; } };
const revSummary = (a) => ({ got: a.got, total: a.total, firstDate: a.firstDate, burst: a.burst, suspect: a.suspect, older: a.older || null });
const revDoc = (pid) => { try { return JSON.parse(fs.readFileSync(path.join(revDir(), `${pid}.json`), "utf8")); } catch { return null; } };
ipcMain.handle("cp:reviews", async (e, p) => {
  if (!licensed()) return { ok: false, ...LOCKED };
  if (!fromClean(e) || !/^\d+$/.test(String(p?.pid || ""))) return { ok: false, error: "잘못된 요청" };
  const reviews = Array.isArray(p.reviews) ? p.reviews.slice(0, REVIEW_CAP * 2) : []; // 기본 1,500 · 더 받기 3,000
  const { analyzeReviews } = await reviewCore();
  const a = analyzeReviews({ reviews, total: Number(p.total) || null });
  const nm = String(p.name || p.pid).slice(0, 24);
  try {
    const dir = revDir(), pid = String(p.pid), ts = new Date().toISOString();
    fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ pid, name: String(p.name || ""), ts, src: p.src || "", ms: p.ms || null, total: a.total, sample: p.sample || null, reviews, analysis: a }, null, 1));
    if (a.ok) {
      const idx = revIndex(), old = idx[pid] || { runs: [] };
      idx[pid] = { pid, name: String(p.name || old.name || ""), ts, ...revSummary(a), runs: [{ ts, ...revSummary(a) }, ...(old.runs || [])].slice(0, 20) };
      const keep = Object.values(idx).sort((x, y) => (x.ts < y.ts ? 1 : -1));
      keep.slice(200).forEach((x) => { delete idx[x.pid]; try { fs.unlinkSync(path.join(dir, `${x.pid}.json`)); } catch {} });
      fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx));
    }
  } catch (err) { log("warn", `△ 리뷰 저장 실패 — ${err.message}`); }
  if (a.ok) log("go", `📝 리뷰 분석 · ${nm} — ${a.got}개${a.capped ? `(전체 ${a.total ?? "?"}개 중 최신)` : ""} · ${a.burst ? `급증 ${a.burst.from.slice(5)}~${a.burst.to.slice(5)} · 의심 신호 ${a.suspect}/5` : "급증 구간 없음"}${p.ms ? ` · ${Math.round(p.ms / 1000)}초` : ""}`);
  else log("warn", `△ 리뷰 분석 · ${nm} — ${a.error}`);
  return a;
});
// 조회 기록 목록 — 예전 조회 파일(index.json 전)도 한 번 읽어 채운다
ipcMain.handle("cp:reviews:list", async (e) => {
  if (!fromClean(e)) return [];
  const dir = revDir(), idx = revIndex();
  let changed = false;
  for (const f of fs.readdirSync(dir)) {
    const pid = (f.match(/^(\d+)\.json$/) || [])[1];
    if (!pid || idx[pid]) continue;
    const d = revDoc(pid);
    if (d?.analysis?.ok) { idx[pid] = { pid, name: d.name, ts: d.ts, ...revSummary(d.analysis), runs: [{ ts: d.ts, ...revSummary(d.analysis) }] }; changed = true; }
  }
  if (changed) fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx));
  return Object.values(idx).sort((x, y) => (x.ts < y.ts ? 1 : -1)).map(({ runs, ...x }) => ({ ...x, runs: (runs || []).length, prevTotal: runs?.[1]?.total ?? null }));
});
// 저장된 결과 다시 보기 — 쿠팡에 다시 묻지 않고, 지금 분석 기준으로 다시 계산
ipcMain.handle("cp:reviews:get", async (e, pid) => {
  if (!fromClean(e) || !/^\d+$/.test(String(pid || ""))) return { ok: false, error: "잘못된 요청" };
  const d = revDoc(pid);
  if (!d) return { ok: false, error: "저장된 결과가 없습니다" };
  const { analyzeReviews } = await reviewCore();
  const a = analyzeReviews({ reviews: d.reviews, total: d.total, today: String(d.ts).slice(0, 10) });
  return { ...a, saved: { ts: d.ts, name: d.name, ms: d.ms } };
});
ipcMain.handle("cp:reviews:xlsx", async (e, pid) => {
  if (!fromClean(e) || !/^\d+$/.test(String(pid || ""))) return { error: "잘못된 요청" };
  const d = revDoc(pid);
  if (!d) return { error: "저장된 결과가 없습니다" };
  const { analyzeReviews } = await reviewCore();
  d.analysis = analyzeReviews({ reviews: d.reviews, total: d.total, today: String(d.ts).slice(0, 10) });
  const nm = String(d.name || pid).replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  const def = path.join(app.getPath("downloads"), `리뷰분석_${nm}_${String(d.ts).slice(0, 10)}.xlsx`);
  const out = (await dialog.showSaveDialog(win, { title: "리뷰 분석 엑셀로 저장", defaultPath: def, filters: [{ name: "Excel", extensions: ["xlsx"] }] })).filePath;
  if (!out) return { cancelled: true };
  const { buildReviewXlsx } = await import(`${pathToFileURL(path.join(__dirname, "review-excel.js")).href}?v=${Math.round(fs.statSync(path.join(__dirname, "review-excel.js")).mtimeMs)}`);
  await buildReviewXlsx(d, revIndex()[pid]?.runs || [], out);
  log("go", `■ 리뷰 분석 엑셀 저장: ${out}`);
  shell.showItemInFolder(out);
  return { path: out };
});

// 시연·사용 전 점검: Wing 로그인 화면인지, 조회 정지 상태인지, 오늘 몇 건 썼는지
ipcMain.handle("check:status", () => {
  const url = wingView?.webContents.getURL() || "";
  const L = store.get("limit") || {};
  const now = Date.now();
  return {
    wing: /^https:\/\/wing\.coupang\.com\//.test(url) ? "ok" : /xauth|login/.test(url) ? "login" : "unknown",
    gate: gate(), today: (L.day || []).filter((t) => now - t < 864e5).length, win10: (L.times || []).filter((t) => now - t < 6e5).length,
    collect: countCollect(),
  };
});
ipcMain.handle("app:version", () => app.getVersion());
// 🚚 로켓그로스 요금표: 앱에 들어 있는 rg-fees.json + GitHub 최신본(버전이 더 크면 사용, 받은 것은 저장해 두고 오프라인에도 사용)
const RG_REMOTE = "https://raw.githubusercontent.com/blackgosu100-png/coupang-signal-releases/main/rg-fees.json";
let rgCache = null;
ipcMain.handle("rg:config", async () => {
  if (rgCache) return rgCache;
  let best = JSON.parse(fs.readFileSync(path.join(__dirname, "../shared/rg-fees.json"), "utf8"));
  const saved = store.get("rgFees");
  if (saved?.version > best.version) best = saved;
  if (!SELFTEST) {
    try {
      const r = await net.fetch(RG_REMOTE, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (j?.version > best.version) { best = j; store.set("rgFees", j); log("sys", `▶ 로켓그로스 요금표 갱신 · v${j.version} (${j.updated || ""})`); } }
    } catch {}
  }
  rgCache = best;
  return best;
});
ipcMain.handle("view:zoom", (_e, z) => {
  ZOOM = Math.min(1.6, Math.max(1, +z || 1));
  win.webContents.setZoomFactor(ZOOM);
  [wingView, cnView, dashView, ...cleanTabs.map((t) => t.view)].forEach((v) => v?.webContents.setZoomFactor(ZOOM));
  layout();
  return ZOOM;
});
// 주소창 입력: 주소면 그대로 열고, 주소가 아니면 쿠팡 검색어로 본다(쿠팡 탭)
ipcMain.handle("nav:go", (_e, text) => {
  const t = String(text || "").trim();
  if (!t) return;
  const looksUrl = /^https?:\/\//i.test(t) || (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t));
  if (!looksUrl || active === "list") { active = active === "wing" && looksUrl ? "wing" : "clean"; }
  let url = looksUrl ? (/^https?:\/\//i.test(t) ? t : `https://${t}`) : `https://www.coupang.com/np/search?q=${encodeURIComponent(t)}`;
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return; url = u.href; } catch { return; }
  if (active === "clean" && !cleanTabs.length) createClean();
  layout();
  (active === "wing" ? wingView : cleanView).webContents.loadURL(url);
});
ipcMain.handle("nav:newClean", () => { active = "clean"; createClean(); layout(); });

// 대시보드에서 카테고리 고르기: 저장된 트리를 주고, 고르면 Wing 화면을 그 카테고리 주소로 연다(Wing이 스스로 인기상품을 받아오면 CDP가 읽어 판정)
ipcMain.handle("cat:tree", () => { const t = store.get("cattree"); return t ? { ts: t.ts, nodes: t.nodes } : null; });
// Wing 인기상품 응답(카테고리 목록·인기상품 60개) → 판정 화면으로
function onWingSnap(snap) {
  if (snap?.tree) { send("cattree", { count: snap.tree }); return; } // 카테고리 목록 저장됨 → 대시보드 검색창 갱신
  current = snap;
  const p = buildPayload(snap);
  if (p) { log("sys", `▶ Wing 인기상품 응답 수신 · ${snap.name} · 상품 ${snap.items.length}개`); send("live", p); }
}
// 🕶 카테고리 조회 전용 숨은 Wing 화면(2026-10-26) — Wing 로그인(persist:wing)은 같이 쓰고, 사람이 보는 Wing 탭은 그대로 둔다.
//  Wing 탭 안에서 도는 키워드 검색(runInWing)과 겹쳐도 페이지가 넘어가며 검색이 끊기지 않게 따로
let catBg = null;
function catBgView() {
  if (catBg && !catBg.webContents.isDestroyed()) return catBg;
  catBg = new WebContentsView({ webPreferences: { partition: "persist:wing", contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.contentView.addChildView(catBg);
  const [w, h] = win.getContentSize();
  catBg.setBounds({ x: 0, y: 0, width: Math.max(1100, w), height: Math.max(700, h) }); // 크기를 준 뒤 숨김(크기 0이면 Wing 화면이 데이터를 안 부를 수 있음)
  catBg.setVisible(false);
  catBg.webContents.setAudioMuted(true);
  catBg.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  watchWing(catBg.webContents, onWingSnap, log);
  return catBg;
}
// 숨은 화면에 Wing 인기상품 페이지를 연다 — 로그인 화면으로 넘어가면(로그인 만료) 알려 준다
async function openCatBg(url) {
  const wc = catBgView().webContents;
  await wc.loadURL(url).catch(() => {}); // 로그인 화면으로 넘어가도 오류 없이 계속
  if (!/^https:\/\/wing\.coupang\.com\//.test(wc.getURL())) return { error: "Wing 로그인이 필요해요 — 왼쪽 Wing 로그인 메뉴에서 로그인한 뒤 다시 진단해 주세요" };
  return { ok: true };
}
ipcMain.handle("cat:loadTree", () => openCatBg(WING_TREND));
ipcMain.handle("cat:open", async (_e, { code, name }) => {
  if (!/^\d+$/.test(String(code || ""))) return { error: "카테고리 코드가 없습니다" };
  const u = new URL(WING_TREND); u.searchParams.set("categoryCode", String(code)); u.searchParams.set("categoryName", String(name || ""));
  log("sys", `▶ 카테고리 열기 · ${name} (${code}) — Wing 응답을 받으면 판정합니다(숨은 Wing 화면 · Wing 탭은 그대로)`);
  const r = await openCatBg(u.href);
  if (r.error) log("stop", `✕ ${r.error}`);
  return r;
});
ipcMain.on("cattree:changed", () => {});

ipcMain.handle("live:open", () => {
  let code = null;
  try { code = new URL(wingView.webContents.getURL()).searchParams.get("categoryCode"); } catch {}
  const snap = store.latestSnapshot(code) || store.latestSnapshot(null);
  if (!snap) return { error: "저장된 인기상품 데이터가 없습니다. 왼쪽 Wing에서 카테고리를 먼저 선택해 주세요." };
  current = snap;
  return buildPayload(snap) || { error: "판정할 상품이 없습니다." };
});
// 🕘 카테고리 진단 시작 화면의 "최근 진단한 카테고리": 저장된 인기상품 스냅샷(카테고리마다 최신 1개) · 최신 순
ipcMain.handle("cat:history", () => Object.values(store.get("snapshots") || {}).filter((s) => s?.items?.length > 1).sort((a, b) => b.ts - a.ts).slice(0, 100)
  .map((s) => { const lead = [...s.items].sort((a, b) => a.order - b.order)[0]; return { key: s.key, name: s.name, path: s.path, date: s.date, ts: s.ts, total: s.total, pvLo: lead?.pvLo ?? null, pvHi: lead?.pvHi ?? null, reviews: lead?.reviews ?? null }; }));
// 저장본 바로 열기: Wing 요청 없이 그 스냅샷으로 판정(틈새/큰 시장 전환도 이 스냅샷 기준으로 다시 계산되게 current로)
ipcMain.handle("cat:openSaved", (_e, key) => {
  const s = (store.get("snapshots") || {})[key];
  if (!s) return { error: "저장된 진단이 없어요" };
  current = s;
  const p = buildPayload(s);
  return p ? { ...p, ts: s.ts, saved: true } : { error: "판정할 상품이 없습니다." };
});

ipcMain.handle("settings:get", () => store.get("settings") || {});
ipcMain.handle("settings:set", (_e, patch) => {
  store.set("settings", { ...(store.get("settings") || {}), ...patch });
  return current ? buildPayload(current) : null;
});

// ⚡ 카테고리 진단: 상품마다 하나씩 묻기 전에 카테고리 이름으로 Wing 키워드 검색 1번 → 응답에 있는 상품은 판매량을 바로 채운다(2026-10-13)
//  같은 상품 판단은 하나씩 조회(exact.js pickItem)와 같게 — 상품 번호가 같으면 같은 상품, 옵션 번호까지 같으면 그 옵션 값을 우선
//  응답에 없는 상품만 runExact가 예전처럼 하나씩(4초 간격) 조회 — 채운 상품은 "최근 조회값 재사용"으로 Wing 요청 없이 지나감
const catQuery = (name) => String(name || "").replace(/[/·,()]/g, " ").split(/\s+/).filter((w) => w && w !== "기타").join(" ").trim().slice(0, 60);
async function catBatch(name, items) {
  const q = catQuery(name);
  if (!q) return 0;
  const exC = store.get("exactCache") || {};
  const need = items.filter((it) => { const c = exC[`${it.pid}:${it.vid ?? ""}`]; return !(c && Date.now() - c.ts < 7 * 864e5); });
  if (!need.length) return 0;
  const res = await searchKeyword(q, 1, wingView.webContents, log, false);
  if (res.error) { log("warn", `△ '${q}' 키워드 검색으로 한 번에 받기 실패 — ${res.error} · 상품별 조회로 진행`); return 0; }
  const got = (res.items || []).filter((x) => x.ex && (x.ex.sales != null || x.ex.views != null));
  let n = 0;
  for (const it of need) {
    const x = got.find((g) => g.pid === String(it.pid) && g.vid === String(it.vid)) || got.find((g) => g.pid === String(it.pid));
    if (!x) continue;
    store.putExact(`${it.pid}:${it.vid ?? ""}`, { ts: Date.now(), views: x.ex.views, sales: x.ex.sales, price: x.ex.price });
    n++;
  }
  log(n ? "go" : "warn", `${n ? "⚡" : "△"} '${q}' 키워드 검색 1번 — 상위 ${need.length}개 중 ${n}개 판매량 바로 채움${n < need.length ? ` · 나머지 ${need.length - n}개는 하나씩 조회` : ""}${res.cached ? " (저장된 검색 결과 · Wing 요청 없음)" : ""}`);
  return n;
}
ipcMain.handle("exact:start", async (_e, arg) => {
  if (!licensed()) return LOCKED;
  const items = Array.isArray(arg) ? arg : arg?.items, opt = Array.isArray(arg) ? {} : arg || {}; // 예전 호출(상품 배열)도 그대로 받음
  if (!items?.length) return { error: "조회할 상품이 없습니다." };
  if (opt.catName) await catBatch(opt.catName, items).catch((e) => log("warn", `△ 키워드 검색으로 한 번에 받기 실패 — ${e?.message || e}`));
  const r = await runExact(items, wingView.webContents, (ev, data) => { send(`exact:${ev}`, data); if (ev === "progress") console.log(`[정확한 지표] ${data.pos}/${data.total} ${data.msg}`); });
  if (current) send("live:refresh", buildPayload(current));
  return r;
});
ipcMain.handle("exact:stop", () => stopExact());
ipcMain.handle("budget:get", () => ({ budget: Number(store.get("budget")) || 0, used: ((store.get("limit") || {}).day || []).filter((t) => Date.now() - t < 864e5).length }));

ipcMain.handle("excel:save", async (_e, payload) => {
  const def = path.join(app.getPath("downloads"), `쿠팡소싱신호등_${payload.name}_${payload.date}.xlsx`.replace(/[\\/:*?"<>|]/g, "_"));
  const out = SELFTEST ? path.join(app.getPath("temp"), "signal-selftest.xlsx")
    : (await dialog.showSaveDialog(win, { title: "엑셀로 저장", defaultPath: def, filters: [{ name: "Excel", extensions: ["xlsx"] }] })).filePath;
  if (!out) return { cancelled: true };
  send("excel:log", { cls: "sys", text: `▶ 엑셀 생성 시작 · ${payload.items.length}개 상품 · 썸네일 이미지 포함`, p: 0 });
  await buildXlsx(payload, out, (cls, text, p) => send("excel:log", { cls, text, p }));
  send("excel:log", { cls: "go", text: `■ 저장 완료: ${out}`, p: 1 });
  if (!SELFTEST) shell.showItemInFolder(out);
  return { path: out };
});

// ---------- 키워드 검색 · 리스트업 ----------
const calc = () => ({ fx: 300, fee: 0.1188, adRate: 0.1, ...(store.get("calc") || {}) });
// 🕘 키워드 분석 최근 검색: 저장된 검색 결과(kwCache, 최근 300개) 목록 — 최신 순 · 요약 숫자만
//  키워드 추천이 카드를 채우려고 돌린 Wing 검색도 kwCache에 쌓인다 → 추천에서 받은 키워드는 사람이 키워드 분석에서 직접 검색한 것(kwMine)만 보여 준다(2026-10-12)
const markMine = (kw) => { const m = mineInit(); m[kw] = Date.now(); const ks = Object.keys(m); if (ks.length > 500) ks.sort((a, b) => m[a] - m[b]).slice(0, ks.length - 500).forEach((k) => delete m[k]); store.set("kwMine", m); };
// 처음 한 번: 키워드 분석 검색 때만 남는 정확도 대조 파일(userData/accuracy/검색어.json)로 예전에 직접 검색한 키워드를 채운다
function mineInit() {
  const had = store.get("kwMine");
  if (had && !store.get("kwMineNoReco")) { // 한 번만: 추천 카드에서 넘어와 기록된 추천 키워드를 뺀다(예전에는 구분이 없었음 · 2026-10-13 대표님 결정)
    for (const k of (store.get("recoDraw")?.history || []).map((x) => x.kw)) delete had[k];
    store.set("kwMine", had); store.set("kwMineNoReco", true);
  }
  if (had) return had;
  const m = {};
  try { const dir = path.join(app.getPath("userData"), "accuracy");
    for (const f of fs.readdirSync(dir)) { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); if (j?.kw) m[j.kw] = Date.parse(j.ts) || 0; } catch {} } } catch {}
  for (const k of (store.get("recoDraw")?.history || []).map((x) => x.kw)) delete m[k]; // 추천 키워드는 빼고 시작(위와 같은 규칙)
  store.set("kwMine", m); store.set("kwMineNoReco", true);
  return m;
}
ipcMain.handle("kw:history", () => {
  const cache = store.get("kwCache") || {}, mine = mineInit();
  const fromReco = new Set((store.get("recoDraw")?.history || []).map((k) => k.kw));
  return Object.values(cache).filter((h) => h?.keyword && h.items?.length && (!fromReco.has(h.keyword) || mine[h.keyword])).sort((a, b) => b.ts - a.ts).slice(0, 100)
    .map((h) => ({ kw: h.keyword, ts: h.ts, n: h.items.length, sales: h.items.reduce((t, it) => t + (it.ex?.sales || 0), 0), rev: h.items.reduce((t, it) => t + (it.ex?.sales || 0) * (it.ex?.price || it.price || 0), 0) }));
});
ipcMain.handle("kw:search", async (_e, { keyword, pages = 1, force = false, saved = false, src = "" }) => {
  if (!licensed()) return LOCKED;
  if (src !== "reco") markMine(String(keyword || "")); // 키워드 분석에서 직접 검색 → 최근 검색에 보임 · 추천 카드의 🔎 키워드 분석으로 넘어온 건 남기지 않음(2026-10-13)
  const db = await (useServer() ? rLookup(keyword) : lookup(keyword)).catch(() => ({ month: null, main: null, subs: [] }));
  if (db.main) log("sys", `▶ '${keyword}' 네이버 월검색 ${db.main.m1?.toLocaleString() ?? "-"} · 서브키워드 후보 ${db.subs.length}개 (제휴 DB ${db.month})`);
  const res = await searchKeyword(keyword, Math.min(3, Math.max(1, pages)), wingView.webContents, log, force, saved);
  if (res.items?.length) {
    const pbs = pbList(settings());
    upsertPage(null, 1, res.items.map((it) => ({ ...it, pb: isPB(it, pbs) })), "wing", keyword); // Wing 결과는 쿠팡 화면 순위(pos)를 건드리지 않는다
    collectChanged();
  }
  return { db, ...res };
});
ipcMain.handle("collect:get", () => listCollect());
ipcMain.handle("collect:export", async (_e, { rows, cpc, margin }) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const def = path.join(app.getPath("downloads"), `수집함_${stamp}.xlsx`);
  const out = SELFTEST ? path.join(app.getPath("temp"), "collect-selftest.xlsx")
    : (await dialog.showSaveDialog(win, { title: "수집함 엑셀로 저장", defaultPath: def, filters: [{ name: "Excel", extensions: ["xlsx"] }] })).filePath;
  if (!out) return { cancelled: true };
  await buildCollectXlsx(rows, { cpc, margin }, out);
  if (!SELFTEST) shell.showItemInFolder(out);
  return { path: out };
});
ipcMain.handle("collect:pagelog", () => store.get("pageLog") || []);
ipcMain.handle("collect:remove", (_e, pids) => { const n = removeCollect(pids); collectChanged(); return n; });
ipcMain.handle("kw:db", (_e, keyword) => (useServer() ? rLookup(keyword) : lookup(keyword)).catch(() => ({ month: null, main: null, subs: [] })));
// ✍ 상품명 짓기(강의 2주차 공식) — 제휴 DB 서브키워드 + 키워드 분석에서 받아 둔 쿠팡 상위 상품명(Wing 요청 없음)으로 단어 후보·후보 상품명 3개·검사
//  picks 를 안 주면 처음 고를 단어를 정해서 돌려준다. 계산은 shared/name-core.js
const namePools = new Map();
const nameItems = (kw) => {
  const cache = store.get("kwCache") || {};
  const hit = cache[kw] || cache[kw.replace(/\s+/g, "")];
  return { ts: hit?.ts || null, items: (hit?.items || []).filter((it) => it.name).sort((a, b) => (b.ex?.sales || 0) - (a.ex?.sales || 0)).slice(0, 20)
    .map((it) => ({ name: it.name, brand: it.brand, sales: it.ex?.sales ?? null, reviews: it.reviews ?? null, price: it.ex?.price ?? it.price ?? null, pid: it.pid, img: it.img || null })) };
};
async function namePool(keyword) {
  const kw = String(keyword || "").trim();
  const { items, ts } = nameItems(kw);
  const cp = cpWordsGet(kw);
  const words = buildPool({ keyword: kw, items, cp }).filter((p) => p.top >= 2 || p.cp).map((p) => p.word.replace(/\s+/g, ""));
  const db = await (useServer() ? rName(kw, words) : nameLookup(kw, words)).catch(() => ({ month: null, main: null, subs: [], vol: {} }));
  const pool = buildPool({ keyword: kw, subs: db.subs, items, vol: db.vol, cp });
  const r = { keyword: kw, month: db.month, main: db.main, pool, items, ts, cp };
  namePools.set(kw, r);
  return r;
}
ipcMain.handle("name:build", async (_e, { keyword, brand = "", qty = "", feats = "", picks = null, fresh = false } = {}) => {
  if (!licensed()) return LOCKED;
  const kw = String(keyword || "").trim();
  if (!kw) return { error: "키워드를 넣어 주세요" };
  const p = (!fresh && namePools.get(kw)) || (await namePool(kw));
  const use = Array.isArray(picks) ? picks : defaultPicks(p.pool);
  return { ...p, picks: use, names: buildNames({ keyword: kw, brand, qty, feats, pool: p.pool, picks: use, main: p.main }) };
});
// 🛒 쿠팡 자동완성·연관검색어(강의 p.9~11): 숨은 쿠팡 화면에서 검색 1번 → ① 연관검색어(검색 결과 위 줄) ② 자동완성(검색창과 같은 주소)
//  ③ 파생 키워드(고탄력·학생 등)로 자동완성을 한 번 더 — 내 키워드가 들어간 것만. 키워드당 7일 저장(쿠팡 보안에 걸리지 않게 자주 열지 않음)
const CPW_FRESH = 7 * 864e5;
const cpWordsGet = (kw) => { const c = (store.get("cpWords") || {})[kw]; return c && c.v === 2 && Date.now() - c.ts < CPW_FRESH ? c : null; }; // v2: 연관검색어 2단계(related2) 추가
let cpwBusy = null, cpwView = null, cpwPart = null;
// 상품명 짓기 전용 숨은 쿠팡 화면 — 쿠팡 탭과 같은 클린 세션이지만 지표 스크립트(coupang.cjs)를 안 붙여서 수집함에 상품이 쌓이지 않는다
function cpWordsView() {
  if (cpwView && !cpwView.webContents.isDestroyed() && cpwPart === bgPartition()) return cpwView;
  if (cpwView) { try { win.contentView.removeChildView(cpwView); cpwView.webContents.close(); } catch {} }
  cpwPart = bgPartition();
  cpwView = new WebContentsView({ webPreferences: { partition: cpwPart, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.contentView.addChildView(cpwView);
  const [w, h] = win.getContentSize();
  cpwView.setBounds({ x: 0, y: 0, width: Math.max(800, w), height: Math.max(600, h) });
  cpwView.setVisible(false);
  cpwView.webContents.setAudioMuted(true);
  cpwView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return cpwView;
}
async function cpWordsFetch(kw) {
  if (cpwBusy) await cpwBusy.catch(() => {});
  const run = (async () => {
    if (!win) return { error: "창이 없어요" };
    const wc = cpWordsView().webContents;
    log("sys", `↗ 쿠팡 자동완성·연관검색어 읽기 '${kw.replace(/[<&]/g, "")}' (숨은 쿠팡 화면 · 연관검색어 2단계까지 최대 4번)`);
    // 쿠팡 검색 화면 1장 열고 "연관검색어:" 줄 읽기 — 연관검색어가 없는 검색이면 [] , 화면을 못 읽으면 null
    let blocked = false;
    const readRelated = async (q) => {
      wc.loadURL(`https://www.coupang.com/np/search?q=${encodeURIComponent(q)}`, { httpReferrer: "https://www.coupang.com/" }).catch(() => {});
      const want = encodeURIComponent(q);
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const got = await wc.executeJavaScript(`(() => { if (!/\\/np\\/search/.test(location.pathname) || !location.search.includes(${JSON.stringify(want)}) || document.readyState === "loading") return null;
          const box = document.querySelector('[class*="srp_relatedKeywords"]'); if (box) return [...box.querySelectorAll("a")].map((a) => (a.title || a.textContent || "").trim()).filter(Boolean);
          return document.querySelector('[class*="ProductUnit_productName"]') ? [] : null; })()`).catch(() => null);
        if (got != null) return got;
      }
      const why = await wc.executeJavaScript(`(document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 80)`).catch(() => "");
      if (/사용권한|Access Denied/i.test(why)) blocked = true; // 쿠팡 보안이 잠시 막음(짧은 시간에 여러 번 열었을 때)
      log("warn", `△ 쿠팡 화면 읽기 실패 · ${blocked ? "쿠팡이 잠시 접속을 막았어요" : why.slice(0, 60)}`);
      return null;
    };
    const related = await readRelated(kw);
    if (related == null) return { error: blocked ? "쿠팡이 잠시 접속을 막았어요 · 30분쯤 뒤 ↻로 다시 읽어 주세요" : "쿠팡 화면을 읽지 못했어요 · 잠시 뒤 다시 눌러 주세요" };
    const ac = async (q) => {
      const r = await wc.executeJavaScript(`fetch("/n-api/web-adapter/search?keyword=" + encodeURIComponent(${JSON.stringify(q)}) + "&_=" + Date.now(), { credentials: "include", headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : [])).then((j) => (Array.isArray(j) ? j.map((x) => String(x?.keyword || "").trim()).filter(Boolean) : [])).catch(() => [])`).catch(() => []);
      await new Promise((r) => setTimeout(r, 400));
      return r;
    };
    const auto = await ac(kw);
    // 파생 키워드: 자동완성·연관검색어에서 내 키워드 앞뒤에 붙은 단어 + 상위 판매 상품명에 자주 나오는 단어 중 5개
    //  상위 상품에만 나오고 쿠팡 검색어로는 아직 확인 안 된 단어(학생용 등)를 먼저 — 그게 "다시 검색해서 확인"하는 단계
    const cand = buildPool({ keyword: kw, items: nameItems(kw).items, cp: { auto, related, deep: {} } }).filter((p) => !p.flag && (p.cp || p.top >= 3));
    const seeds = [...cand.filter((p) => !p.cp).sort((a, b) => b.top - a.top), ...cand.filter((p) => p.cp)].slice(0, 5).map((p) => p.word);
    const base = kw.replace(/\s+/g, ""), tail = base.length >= 4 ? base.slice(-3) : base, deep = {};
    for (const s of seeds) deep[s] = (await ac(s)).filter((x) => { const k = x.replace(/\s+/g, ""); return k.includes(base) || k.endsWith(tail); });
    // 연관검색어 2단계(변기솔 → 화장실변기솔 → 스텐변기솔): 첫 화면 연관검색어 중 내 키워드가 들어가고 색상·브랜드가 아닌 것 3개를 다시 열어 그 화면의 연관검색어를 읽는다
    const norm = (x) => x.replace(/\s+/g, "").toLowerCase();
    const hops = related.filter((r) => { const k = norm(r); return k !== norm(base) && (k.includes(norm(base)) || k.endsWith(norm(tail))); })
      .filter((r) => { const ws = buildPool({ keyword: kw, cp: { related: [r] } }); return ws.length && ws.every((w) => !w.flag); }).slice(0, 3);
    const related2 = {};
    for (const h of hops) {
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000)); // 쿠팡 보안: 화면 사이 간격
      const r2 = await readRelated(h);
      if (r2 == null) break; // 막히면 더 열지 않는다
      related2[h] = r2.filter((x) => !related.includes(x) && norm(x) !== norm(h));
    }
    const out = { v: 2, ts: Date.now(), auto, related, related2, deep };
    store.set("cpWords", { ...Object.fromEntries(Object.entries(store.get("cpWords") || {}).filter(([, v]) => Date.now() - v.ts < CPW_FRESH)), [kw]: out });
    log("go", `✔ 쿠팡 자동완성 ${auto.length}개 · 연관검색어 ${related.length}개 · 연관 2단계 ${Object.values(related2).flat().length}개(${Object.keys(related2).length}화면) · 파생 ${Object.values(deep).flat().length}개`);
    return out;
  })();
  cpwBusy = run;
  return run;
}
ipcMain.handle("name:coupang", async (_e, { keyword, force = false } = {}) => {
  if (!licensed()) return LOCKED;
  const kw = String(keyword || "").trim();
  if (!kw) return { error: "키워드를 넣어 주세요" };
  if (SELFTEST && process.env.SELFTEST_SITES !== "1") return { error: "자체 점검은 쿠팡에 접속하지 않아요" };
  const hit = !force && cpWordsGet(kw);
  const r = hit || (await cpWordsFetch(kw));
  if (r.error) return r;
  namePools.delete(kw); // 다음 name:build 에서 새 단어로 다시 계산
  return { ok: true, cached: !!hit };
});
ipcMain.handle("name:check", (_e, { name, keyword, brand = "" } = {}) => checkName(name, { keyword, brand, pool: namePools.get(String(keyword || "").trim())?.pool || [] }));
ipcMain.handle("kw:reco", () => recommend());
// 🔑 키워드 DB를 어디서 읽을지: auto(DB 파일 있으면 로컬) · server · local — 대표님 맥에서 수강생과 같은 서버 모드를 시험할 때 server
ipcMain.handle("kw:source", (_e, v) => { if (["auto", "server", "local"].includes(v)) { store.set("kwSource", v); log("sys", `▶ 키워드 DB 읽는 곳: ${v} → 지금 ${kwSource() === "server" ? "키워드 서버" : "이 PC의 DB 파일"}`); } return { set: store.get("kwSource") || "auto", now: kwSource(), local: hasLocalDb() }; });
ipcMain.handle("kw:combo", (_e, c) => combo(c || {}));
ipcMain.handle("kw:scan", (_e, o) => (useServer() ? rScan(o || {}) : kwScan(o || {})));
// 🏆 효자상품: 키워드 1개 = Wing 키워드 검색 1번(상품 여러 개의 28일 판매량을 한 번에) → 판매액 상위 N개 + 합계
//  상품마다 "쿠팡 지표 보기"(1개 4초)를 쓰지 않아서 10개 키워드도 요청 10번이면 끝. 7일 저장 결과는 바로 돌려줌
// 받은 키워드 결과 다시 보기용: 카드 요약을 키워드별로 저장(기간 제한 없음, 최근 300개) — 껐다 켜도 Wing 조회 없이 그대로 보여 줌
const HY_KEEP = 300;
const hySave = (kw, r) => { const all = store.get("hyojaSaved") || {}; all[kw] = { ...r, savedAt: Date.now() }; const ks = Object.keys(all); if (ks.length > HY_KEEP) ks.sort((a, b) => all[a].savedAt - all[b].savedAt).slice(0, ks.length - HY_KEEP).forEach((k) => delete all[k]); store.set("hyojaSaved", all); };
// 카드를 빨리 보여 주려고 두 번에 나눠 채운다(2026-10-12)
//  ① kw:hyoja — Wing 검색만으로 바로 카드(가격은 예전에 쿠팡 화면에서 본 것만 쿠폰가, 나머지는 Wing 판매가)
//  ② kw:hyojaCp — 10개가 다 뜬 뒤 키워드마다 쿠팡 검색 화면을 뒤에서 1번 열어 쿠폰가를 읽고 숫자를 다시 계산(cp: true)
const hyWing = new Map(); // 검색어 → 방금 받은 Wing 결과(②에서 Wing을 다시 부르지 않으려고)
async function hyojaBuild(kw, res, rows, { top, t0, cp, detail = new Map() }) {
  const byPid = new Map(rows.map((r) => [String(r.pid), r]));
  const raw = (res.items || []).filter((x) => x.ex?.sales != null).map((x) => {
    const wingP = x.ex.price || x.price || 0, dp = detail.get(`${x.pid}:${x.vid}`);
    const p = dp ? { price: dp.price, src: "detail", pagePrice: dp.page } : pagePrice({ price: wingP, vid: x.vid }, byPid.get(String(x.pid)));
    return { name: x.name, brand: x.brand || "", pid: x.pid, vid: x.vid, img: x.img, price: p.price || 0, listPrice: wingP, priceSrc: p.src, pagePrice: p.pagePrice, reviews: x.reviews, sales: x.ex.sales };
  });
  // 카드 숫자(월매출·틈·1688 기준가)는 검색어와 다른 상품을 뺀 뒤 계산 — hyoja-core.js · 유명 브랜드(키워드 DB)는 "틈"에서 뺌
  const famous = await (useServer() ? rBrands(raw.map((x) => x.brand)) : famousBrands(raw.map((x) => x.brand))).catch(() => new Set());
  const s = hyojaSummarize(kw, raw, { top, famous });
  // total = 판매액 상위 10개 합 · v3: v2 저장본은 price·gap·주의 정보가 빠진 채 저장됐음(주석 실수) → 다시 계산 · v4: 팔아봤어요 지표(top1Sales·big500) 추가 · v5: 쿠팡 화면 쿠폰가 반영(v4는 Wing 할인 전 가격)
  const nPage = raw.filter((x) => x.priceSrc === "page" || x.priceSrc === "detail").length, nDetail = raw.filter((x) => x.priceSrc === "detail").length;
  if (cp) log(nPage ? "go" : "warn", `${nPage ? "✔" : "△"} ${kw.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}: 쿠폰가 반영 ${nPage}/${raw.length}개${nDetail ? `(상품 페이지 ${nDetail}개)` : ""}${nPage < raw.length ? " · 나머지는 Wing 판매가(쿠폰 전)" : ""}`);
  const out = { v: 6, keyword: kw, cp, priced: { page: nPage, all: raw.length }, ms: Date.now() - t0, cached: !!res.cached, n: s.n, nAll: s.nAll, wingRaw: res.raw ?? null,
    total: { sales: s.sales, rev: s.rev, reviews: s.reviews, brandRev: s.brandRev }, price: s.price, gap: s.gap, top1Sales: s.top1Sales, big500: s.big500, gapBrandOnly: s.gapBrandOnly, top1Share: s.top1Share, brandShare: s.brandShare, brandTop: s.brandTop, medical: s.medical,
    drop: s.drop.map((x) => ({ name: x.name, sales: x.sales, why: x.why })),
    top: { sales: s.top.reduce((t, x) => t + x.sales, 0), rev: s.top.reduce((t, x) => t + x.rev, 0) },
    items: s.top };
  hySave(kw, out);
  return out;
}
ipcMain.handle("kw:hyoja", async (_e, { keyword, top = 5, saved = false } = {}) => {
  if (!licensed()) return LOCKED;
  const t0 = Date.now();
  const kw = String(keyword || "");
  if (saved) { const s = (store.get("hyojaSaved") || {})[kw]; if (s?.v === 6) return { ...s, cached: true, ms: 0 }; } // 지난 결과 다시 열기: 저장본 우선(v6 = 쿠팡 화면 쿠폰가 + 옵션 다른 상품의 상품 페이지 가격 · cp가 false면 화면에서 ②를 이어서 함)
  const res = await searchKeyword(kw, 1, wingView.webContents, log, false);
  if (res.error) return { error: res.error, ms: Date.now() - t0 };
  hyWing.set(kw, res);
  return hyojaBuild(kw, res, listCollect(), { top, t0, cp: false });
});
ipcMain.handle("kw:hyojaCp", async (_e, { keyword, top = 5 } = {}) => {
  if (!licensed()) return LOCKED;
  const t0 = Date.now();
  const kw = String(keyword || "");
  const cpOpen = openCoupangSearch(kw);
  const res = hyWing.get(kw) || (await searchKeyword(kw, 1, wingView.webContents, log, false)); // 지난 결과를 다시 열 때는 7일 Wing 캐시
  if (res.error) return { error: res.error };
  if (!cpOpen) return { error: "쿠팡 화면을 열 수 없어요" };
  const rows = await waitCoupangRows(kw, t0, 10000);
  hyWing.delete(kw);
  // 판매액 상위 10개 중 "옵션 다름"이면서 Wing가와 쿠팡 화면 가격이 1.5배 넘게 차이 나는 상품만(키워드당 최대 3개) 상품 페이지를 연다 — 월매출을 크게 흔드는 것만
  const byPid = new Map(rows.map((r) => [String(r.pid), r]));
  const cand = (res.items || []).filter((x) => x.ex?.sales != null).map((x) => ({ x, wingP: x.ex.price || x.price || 0 }))
    .sort((a, b) => b.x.ex.sales * b.wingP - a.x.ex.sales * a.wingP).slice(0, 10)
    .filter(({ x, wingP }) => { const p = pagePrice({ price: wingP, vid: x.vid }, byPid.get(String(x.pid))); return p.src === "vid" && wingP > 0 && p.pagePrice > 0 && Math.max(wingP / p.pagePrice, p.pagePrice / wingP) > 1.5; })
    .slice(0, 3);
  const detail = new Map();
  for (const { x, wingP } of cand) {
    const price = await readDetailPrice(x.pid, x.vid).catch(() => null);
    if (price > 0 && price <= wingP * 1.05 && price >= wingP * 0.1) detail.set(`${x.pid}:${x.vid}`, { price, page: byPid.get(String(x.pid))?.page?.price ?? null }); // 할인가는 Wing가(할인 전)보다 클 수 없음
    else log("dim", `  ${String(x.name).slice(0, 24)} — 상품 페이지 가격을 못 읽어 Wing 판매가 유지`);
  }
  return hyojaBuild(kw, res, rows, { top, t0, cp: true, detail });
});
// 🎁 키워드 받기: 10개 × 하루 10번(대표님 결정 2026-10-11). 이미 받은 키워드·오늘 횟수는 store("recoDraw")에 — 앱을 껐다 켜도 유지(서버 배분은 나중)
const DRAW_PER = 10, DRAW_DAILY = 10, DRAW_BONUS = 5; // 보너스: 하루 1번, 다 쓴 뒤 +5 (2026-10-12)
const drawState = () => { const st = store.get("recoDraw") || { day: "", used: 0, seen: [], history: [] }; const today = new Date().toLocaleDateString("sv-SE"); if (st.day !== today) { st.day = today; st.used = 0; st.bonus = false; } return st; };
const drawLimit = (st) => DRAW_DAILY + (st.bonus ? DRAW_BONUS : 0);
const drawResetAt = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }; // 다음 자정(앱 시계 기준)
const drawInfo = (st) => ({ left: Math.max(0, drawLimit(st) - st.used), daily: DRAW_DAILY, per: DRAW_PER, bonus: DRAW_BONUS, bonusUsed: !!st.bonus, resetAt: drawResetAt(), seenTotal: st.seen.length });
// batches = 받은 시각(at)별 묶음, 최근 순 30개 — 화면을 다시 열면 마지막 묶음을 그대로 보여 주고, 지난 묶음도 고를 수 있게
const drawBatches = (hist) => { const m = new Map(); for (const k of hist || []) { if (!k.at) continue; if (!m.has(k.at)) m.set(k.at, []); m.get(k.at).push(k); } return [...m.entries()].sort((a, b) => b[0] - a[0]).slice(0, 30).map(([at, items]) => ({ at, items })); };
ipcMain.handle("kw:drawState", () => { if (useServer()) return rState(); const st = drawState(); return { ...drawInfo(st), history: st.history.slice(0, 200), batches: drawBatches(st.history) }; });
ipcMain.handle("kw:drawBonus", () => { // 🎁 보너스 5번: 오늘 횟수를 다 썼을 때 하루 1번
  if (useServer()) return rBonus(); // 서버가 횟수를 센다(앱 저장소를 지워도 초기화 안 됨)
  const st = drawState();
  if (st.bonus) return { error: "bonusUsed", ...drawInfo(st) };
  if (st.used < DRAW_DAILY) return { error: "notYet", ...drawInfo(st) };
  st.bonus = true; store.set("recoDraw", st);
  log("go", `🎁 키워드 받기 보너스 +${DRAW_BONUS}번 (오늘 1회)`);
  return { ok: true, ...drawInfo(st) };
});
ipcMain.handle("kw:draw", async (_e, o) => {
  if (useServer()) return rDraw(o || {});
  const st = drawState();
  if (st.used >= drawLimit(st)) return { error: "limit", ...drawInfo(st) };
  const d = await kwDraw({ seen: st.seen, n: DRAW_PER, opts: o || {} });
  if (!d.items.length) return { error: "empty", ...d, ...drawInfo(st) };
  st.used++; st.seen.push(...d.items.map((k) => k.kw));
  st.history = [...d.items.map((k) => ({ ...k, at: Date.now() })), ...(st.history || [])].slice(0, 500);
  store.set("recoDraw", st);
  return { ...d, ...drawInfo(st) };
}); // 🔍 AI 소싱: 깔때기(단계별 실제 개수·빠진 이유) + 세 묶음 결과 // 💡 조건 조합(로켓그로스·로켓배송·해외배송·리뷰·추세·평균가 적음/많음)
ipcMain.handle("calc:get", () => calc());
ipcMain.handle("calc:set", (_e, patch) => { store.set("calc", { ...calc(), ...patch }); return calc(); });
ipcMain.handle("listup:get", () => store.get("listup") || []);
ipcMain.handle("listup:save", (_e, rows) => { store.set("listup", rows); return rows.length; });
ipcMain.handle("listup:export", async (_e, rows) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const def = path.join(app.getPath("downloads"), `소싱리스트업_${stamp}.xlsx`);
  const out = SELFTEST ? path.join(app.getPath("temp"), "listup-selftest.xlsx")
    : (await dialog.showSaveDialog(win, { title: "리스트업 엑셀로 저장", defaultPath: def, filters: [{ name: "Excel", extensions: ["xlsx"] }] })).filePath;
  if (!out) return { cancelled: true };
  await buildListupXlsx(rows, calc(), out);
  log("go", `■ 리스트업 저장 완료: ${out} (${rows.length}개 상품)`);
  if (!SELFTEST) shell.showItemInFolder(out);
  return { path: out };
});

// ---------- 자체 점검 (화면 캡처 후 종료) ----------
async function selftest() {
  const out = process.env.SELFTEST_OUT || path.join(app.getPath("temp"), "signal-selftest");
  fs.mkdirSync(out, { recursive: true });
  { // Wing 로그인 유지: 브라우저 종료 시 사라지는 쿠키 → 7일 유지로 바뀌는지(네트워크 없음)
    const ses = session.fromPartition("persist:wing");
    await ses.cookies.set({ url: "https://xauth.coupang.com/", name: "selftest_sess", value: "1", secure: true, httpOnly: true });
    await new Promise((r) => setTimeout(r, 300));
    const [c] = await ses.cookies.get({ name: "selftest_sess" });
    console.log("WING_COOKIE", c ? `session=${c.session} 남은 일수=${c.expirationDate ? Math.round((c.expirationDate - Date.now() / 1000) / 86400) : "-"}` : "없음");
    await ses.cookies.remove("https://xauth.coupang.com/", "selftest_sess");
  }
  if (process.env.SELFTEST_NAME) { // ✍ 상품명 짓기 화면: 강의 예시(팬티스타킹) 상위 상품을 저장된 검색 결과로 넣고 화면 캡처(Wing 접속 없음)
    const nm = (name, brand, sales) => ({ name, brand, pid: String(sales), ex: { sales, price: 11590 }, reviews: 100 });
    store.set("kwCache", { ...(store.get("kwCache") || {}), 팬티스타킹: { keyword: "팬티스타킹", ts: Date.now(), pages: 1, fields: [], items: [
      nm("베이스알파에센셜 국내산 학생용 팬티스타킹 20D 10p 벌크형", "베이스알파에센셜", 5200), nm("비비안 고탄력 팬티스타킹 5+5", "비비안", 3100),
      nm("베이스알파에센셜 팬티스타킹 쫀쫀 고탄력 20D 10매입", "베이스알파에센셜", 2800), nm("비비안 판도라 고탄력 팬티스타킹 벌크 10매세트", "비비안", 1900),
      nm("탐사 학생용 고탄력 20D 팬티스타킹 벌크형 10P", "탐사", 1500), nm("시글락 요즘애들 학생용 80D 팬티스타킹 6P", "", 900),
      nm("패션파트너 [자체제작] 프리미엄 슬림 핏 하이서포트 고탄력 20D 팬티스타킹 10P", "", 600), nm("플레시크 고탄력 팬티스타킹 내추럴 7매 SET", "", 400)] } });
    await new Promise((r) => setTimeout(r, 1500));
    const go = (js) => win.webContents.executeJavaScript(`(async () => { ${js} })()`).catch((e) => ({ err: e.message }));
    await go(`document.getElementById("tName").click();`);
    await new Promise((r) => setTimeout(r, 800));
    fs.writeFileSync(path.join(out, "name-start.png"), (await win.webContents.capturePage()).toPNG());
    const r = await go(`window.NameMaker.open(${JSON.stringify(process.env.SELFTEST_NAME_KW || "팬티스타킹")}); for (let i = 0; i < 40 && !document.querySelector(".nm-cand"); i++) await new Promise((r) => setTimeout(r, 100));
      document.getElementById("nmBrand").value = "제이"; const q = document.getElementById("nmQty"); q.value = "10P"; document.getElementById("nmForm").requestSubmit(); await new Promise((r) => setTimeout(r, 600));
      const m = document.getElementById("nmMine"); m.value = "패션파트너 [자체제작] 프리미엄 슬림핏 고탄력 하이서포트 엉덩이 두줄 봉제선 150D 페이크 착시 팬티 스타킹 검정"; m.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 800));
      for (let i = 0; i < 300 && document.querySelector(".nm-cp.run"); i++) await new Promise((r) => setTimeout(r, 100)); // 쿠팡 읽기(SELFTEST_SITES=1)
      await new Promise((r) => setTimeout(r, 1200));
      document.querySelector("details.nm-cp")?.setAttribute("open", "");
      return { cp: document.querySelector(".nm-cp")?.textContent.replace(/\s+/g, " ").trim().slice(0, 600), view: document.body.dataset.view, names: [...document.querySelectorAll(".nm-name b")].map((b) => b.textContent), words: [...document.querySelectorAll(".nm-w")].map((b) => b.textContent.trim().replace(/\\s+/g, " ")), chks: [...document.querySelectorAll(".nm-chk")].map((b) => b.textContent) };`);
    console.log("NAME", JSON.stringify(r, null, 1));
    fs.writeFileSync(path.join(out, "name.png"), (await win.webContents.capturePage()).toPNG());
    console.log("SELFTEST_OK", out); app.quit(); return;
  }
  if (process.env.SELFTEST_1688) { // 실제 1688 이미지 검색 시험(쿠팡·Wing 접속 없음)
    const fakeImg = "https://picsum.photos/id/1060/400/400.jpg";
    cnTarget = { rowId: 1, name: "시험 상품" };
    // cn:search 처리와 같은 흐름
    const rr = await net.fetch(fakeImg); const im = nativeImage.createFromBuffer(Buffer.from(await rr.arrayBuffer()));
    cnPending = { b64: upImg(im).toJPEG(90).toString("base64"), type: "image/jpeg", ts: Date.now() }; cnPhoto = cnPending; // 🛍 타오바오 같은 상품 찾기에 다시 쓴다
    createCn(CN_HOME); active = "cn"; layout();
    await new Promise((res) => setTimeout(res, 40000));
    console.log("CN_URL", cnView.webContents.getURL().slice(0, 160), "| TITLE", cnView.webContents.getTitle());
    try { fs.writeFileSync(path.join(out, "cn.png"), (await cnView.webContents.capturePage()).toPNG()); } catch (e) { console.log("CAPTURE_FAIL", e.message); }
    console.log("SELFTEST_OK", out); app.quit(); return;
  }
  if (GATE_ON) { // 잠금 화면 시험: 잘못된 계정으로 로그인 → 오류 문구, 잠금 상태 확인 후 종료
    sendAuth();
    await new Promise((r) => setTimeout(r, 800));
    const r = await win.webContents.executeJavaScript(`(async () => {
      document.getElementById("gEmail").value = "selftest-not-a-user@example.com"; document.getElementById("gPw").value = "wrong-password";
      document.getElementById("gateLogin").requestSubmit();
      for (let i = 0; i < 40 && !document.getElementById("gErr").textContent; i++) await new Promise((r) => setTimeout(r, 250));
      return { gate: !document.getElementById("gate").hidden, err: document.getElementById("gErr").textContent, cleanDisabled: document.getElementById("tClean").disabled };
    })()`);
    console.log("GATE", JSON.stringify(r), "licensed", licensed());
    console.log("LOCKED_METRIC", JSON.stringify(await (async () => (licensed() ? "open" : LOCKED.error))()));
    fs.writeFileSync(path.join(out, "gate.png"), (await win.webContents.capturePage()).toPNG());
    console.log("SELFTEST_OK", out); app.quit(); return;
  }
  const fake = JSON.parse(fs.readFileSync(path.join(__dirname, "../../test/fake-snapshot.json"), "utf8"));
  store.putSnapshot(fake);
  // 실판매 가짜 값: 전환율이 튀는 상품(🔥)과 광고로 이익이 안 나는 저전환 상품(🔴) 포함
  const cv = [0.119, 0.057, 0.067, 0.075, 0.069, 0.072, 0.071, 0.06, 0.03, 0.067];
  fake.items.slice(0, 10).forEach((it, i) => { const views = 20000 + i * 4000; store.putExact(`${it.pid}:${it.vid}`, { ts: Date.now(), views, sales: Math.round(views * cv[i]), price: null }); });
  current = fake;
  // 실제 사이트가 이 프로그램 안에서 열리는지 확인 (로그인 없이 첫 화면만)
  // 실제 사이트 접속은 SELFTEST_SITES=1일 때만 (반복 접속이 쿠팡 보안에 걸리지 않도록)
  const SITES = process.env.SELFTEST_SITES === "1";
  if (SITES) { wingView.webContents.loadURL(WING_TREND); createClean(); }
  active = "wing"; layout();
  // 키워드 검색 화면·리스트업: 가짜 검색 결과를 캐시에 넣고 패널이 직접 검색하게 한다
  const kwItems = fake.items.slice(0, 12).map((it, i) => {
    const views = 9000 + i * 2100, price = 9900 + i * 1300;
    return { order: i + 1, pid: it.pid, vid: it.vid, name: it.name, brand: "", price, reviews: it.reviews, rating: 4.7, img: it.img,
      ex: { ts: Date.now(), views, sales: Math.round(views * cv[i % cv.length]), price } };
  });
  store.set("kwCache", { ...(store.get("kwCache") || {}), 빨래바구니: { keyword: "빨래바구니", ts: Date.now(), pages: 3, items: kwItems, fields: [] } });
  store.set("listup", []);
  setTimeout(() => win.webContents.executeJavaScript(`(async () => {
    document.getElementById("pmKw").click();
    document.getElementById("kwInput").value = "빨래바구니";
    document.getElementById("kwForm").requestSubmit();
    await new Promise((r) => setTimeout(r, 3500));
    document.querySelectorAll("button[data-add]")[0]?.click();
    document.querySelectorAll("button[data-add]")[2]?.click();
    await new Promise((r) => setTimeout(r, 300));
    const inp = (i, f, v) => { const el = document.querySelector('[data-r="' + i + '"][data-f="' + f + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
    inp(0, "yuan", "12.5"); inp(0, "monthly", "300"); inp(0, "size", "120");
    inp(1, "yuan", "30"); inp(1, "monthly", "150");
    return [document.getElementById("lcount").textContent, document.getElementById("luInfo").textContent];
  })()`).then((r) => console.log("LISTUP", JSON.stringify(r))).catch((e) => console.log("LISTUP_FAIL", e.message)), 3000);
  setTimeout(async () => {
    await shot(win.webContents, "panel-kw.png");
    active = "list"; layout(); send("nav", { tab: "list", url: "리스트업" });
    await new Promise((r) => setTimeout(r, 600));
    await shot(win.webContents, "listup.png");
    await win.webContents.executeJavaScript(`document.querySelector("#listup .lu-wrap").scrollLeft = 900`);
    await new Promise((r) => setTimeout(r, 300));
    await shot(win.webContents, "listup-calc.png");
    const rows = store.get("listup") || [];
    console.log("LISTUP_ROWS", rows.length, JSON.stringify(rows.map((r) => [r.name?.slice(0, 10), r.yuan, r.price, r.monthly, r.subKw])));
    const x = await buildListupXlsx(rows, calc(), path.join(out, "listup.xlsx")).catch((e) => "ERR " + e.message);
    console.log("LISTUP_XLSX", x);
    active = "wing"; layout(); send("nav", { tab: "wing", url: "" });
    send("live", buildPayload(fake));
  }, 9000);
  // 쿠팡 화면 지표 오버레이: 가짜 쿠팡 화면 + 앞 5개만 저장값 → 5개 표시, 나머지는 Wing 미로그인으로 실패 표시
  fake.items.slice(0, 5).forEach((it, i) => store.putExact(`${it.pid}:${it.vid}`, { ts: Date.now(), views: 30000 + i * 5000, sales: 2000 + i * 300, price: 12900 + i * 1000 }));
  openCleanTab("about:blank", false); // 자체 점검은 실제 쿠팡에 접속하지 않는다
  store.set("collect", {});
  if (process.env.SELFTEST_SOFT) { // 10분 한도 자동 대기 시험: 가장 오래된 기록이 6초 뒤 만료되도록 60건을 채운다
    const t0 = Date.now() - 600000 + 6000;
    store.set("limit", { times: Array.from({ length: 60 }, (_, i) => t0 + i * 100), day: [], last: Date.now() - 5000 });
    store.set("exactCache", {});
  }
  // 검색어 한 번에 받기: '빨래건조대' 저장 결과에 6~12번째 상품 지표를 넣어 둔다 → 버튼 한 번에 7개가 바로 채워져야 함
  store.set("kwCache", { ...(store.get("kwCache") || {}), 빨래건조대: { keyword: "빨래건조대", ts: Date.now(), pages: 1, fields: [],
    items: fake.items.slice(5, 12).map((it, i) => ({ order: i + 1, pid: it.pid, vid: it.vid, name: it.name, price: 15000, ex: { ts: Date.now(), views: 20000 + i * 3000, sales: 900 + i * 450, price: 15000 } })) } });
  cleanView.webContents.loadFile(path.join(__dirname, "../../test/fake-coupang.html"), { query: { q: "빨래건조대" } });
  setTimeout(async () => {
    active = "clean"; layout();
    await cleanView.webContents.executeJavaScript(`document.querySelector(".sg-cp-button")?.click(); !!document.querySelector(".sg-cp-button")`).then((b) => console.log("CP_BUTTON", b));
    await new Promise((r) => setTimeout(r, 2500));
    console.log("CP_OVERLAYS", await cleanView.webContents.executeJavaScript(`JSON.stringify([...document.querySelectorAll(".sg-cp")].map((b) => b.innerText.replace(/\\s+/g, " ").slice(0, 70)))`));
    console.log("CP_BTN_TEXT", await cleanView.webContents.executeJavaScript(`document.querySelector(".sg-cp-button").innerText`));
    try { fs.writeFileSync(path.join(out, "coupang-overlay.png"), (await cleanView.webContents.capturePage()).toPNG()); } catch (e) { console.log("CAPTURE_FAIL", e.message); }
    const col = listCollect();
    console.log("COLLECT", col.length, JSON.stringify(col.slice(0, 4).map((o) => [o.name?.slice(0, 8), o.query, o.pos?.[o.query], o.reviews, o.rocket, o.pb, o.ex?.sales])));
    active = "collect"; layout(); send("nav", { tab: "collect", url: "수집함" });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(win.webContents, "collect.png");
    console.log("RANK_INDEX", await win.webContents.executeJavaScript(`(async () => { const f = document.getElementById("fQuery"); f.value = "빨래건조대"; f.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((r) => setTimeout(r, 300));
      return JSON.stringify({ mode: document.getElementById("coMode").innerText, rows: [...document.querySelectorAll("#coBody tr")].slice(0, 12).map((tr) => [tr.children[4].innerText, tr.children[5].innerText, tr.children[6].innerText, tr.children[2].innerText.slice(0, 10)]) }); })()`));
    await shot(win.webContents, "collect-slots.png");
    await win.webContents.executeJavaScript(`document.querySelector("#collect .lu-wrap").scrollLeft = 2000`);
    await new Promise((r) => setTimeout(r, 300));
    await shot(win.webContents, "collect-right.png");
    // 쿠팡 탭: 새 탭 2개(하나는 뒤에서 열기) → 탭 줄 캡처 → 하나 닫기
    const f = new URL("file://" + path.join(__dirname, "../../test/fake-coupang.html"));
    f.searchParams.set("q", "수건걸이"); openCleanTab(f.href, true);
    f.searchParams.set("q", "비누받침"); openCleanTab(f.href, false);
    await new Promise((r) => setTimeout(r, 1500));
    await shot(win.webContents, "tabs.png");
    console.log("TABS", cleanTabs.length, "active", cleanTabs.findIndex((t) => t.view === cleanView));
    closeCleanTab(cleanTabs[1].id);
    // 왼쪽 사이드바 접기 → 64px, 사이트 화면이 그만큼 넓어짐 → 다시 펼침
    const sst = async () => win.webContents.executeJavaScript(`({ min: document.body.classList.contains("side-min"), w: Math.round(document.querySelector(".side").getBoundingClientRect().width) })`);
    await win.webContents.executeJavaScript(`document.getElementById("sideFold").click()`); await new Promise((r) => setTimeout(r, 400));
    console.log("SIDE_MIN", JSON.stringify(await sst()), "viewX", cleanView.getBounds().x, "viewW", cleanView.getBounds().width);
    await shot(win.webContents, "side-min.png");
    await win.webContents.executeJavaScript(`document.getElementById("sideFold").click()`); await new Promise((r) => setTimeout(r, 400));
    console.log("SIDE_OPEN", JSON.stringify(await sst()), "viewX", cleanView.getBounds().x);
    // 1688: 리스트업 첫 행을 대상으로 가짜 1688 상품 페이지 → 상자에서 넣기 → 리스트업 위안·중국URL 채워짐(실제 1688 접속 없음)
    const lrows = store.get("listup") || [];
    if (lrows[0]) {
      cnTarget = { rowId: lrows[0].id, name: lrows[0].name };
      createCn("about:blank");
      await cnView.webContents.loadFile(path.join(__dirname, "../../test/offer/123456789.html"));
      await new Promise((r) => setTimeout(r, 1200));
      const boxPrice = await cnView.webContents.executeJavaScript(`(() => { const i = document.querySelector("#sg-cn-box input"); const v = i && i.value; document.querySelector("#sg-cn-box button")?.click(); return v; })()`);
      await new Promise((r) => setTimeout(r, 1200));
      const filled = (store.get("listup") || [])[0];
      console.log("CN_PICK", "상자 가격", boxPrice, "→ 리스트업", filled?.yuan, filled?.cnUrl);
    }
    // 쿠팡 사진 위 🔍1688: 첫 탭(가짜 쿠팡)의 11번째 상품 사진에 마우스 → 버튼 클릭 → 리스트업에 담기 + 1688 대상 지정
    selectCleanTab(cleanTabs[0].id);
    const before = (store.get("listup") || []).length;
    const hov = await cleanView.webContents.executeJavaScript(`(async () => {
      const img = document.querySelectorAll('a[href*="/products/"] img')[2];
      img.scrollIntoView(); img.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const b = document.querySelector(".sg-cn-hover"); const shown = b && b.style.display;
      const rc = img.getBoundingClientRect();
      b && b.click(); return { shown, alt: img.alt, w: Math.round(rc.width), h: Math.round(rc.height), btn: !!b };
    })()`).catch((e) => ({ err: e.message }));
    await new Promise((r) => setTimeout(r, 1500));
    console.log("HOVER_1688", JSON.stringify(hov), "리스트업", before, "→", (store.get("listup") || []).length, "대상", cnTarget?.name, "탭", active);
    // 🚚 로켓그로스: 실제 요금표(rg-fees.json)로 Wing 계산기 검증 예시 2건 재현 — 280x200x120mm·900g·스킨케어: 13,000원 → 2,665원(저가 전용), 15,000원 → 2,825원(프로모션)
    rgCache = null;
    active = "list"; layout(); send("nav", { tab: "list", url: "리스트업" });
    const rgt = await win.webContents.executeJavaScript(`(async () => {
      await window.RG.load(); window.Listup.render();
      const set = (f, v) => { const el = document.querySelector('[data-r="0"][data-f="' + f + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("cat", "뷰티 > 스킨케어"); set("dims", "280x200x120"); set("wt", "900");
      const read = () => ({ size: document.querySelector('[data-r="0"] [data-c="rgSize"]')?.textContent, logi: document.querySelector('input[data-r="0"][data-f="logi"]')?.value });
      set("price", "13000"); await new Promise((r) => setTimeout(r, 150)); const a = read();
      set("price", "15000"); await new Promise((r) => setTimeout(r, 150)); const b = read();
      set("dims", "1200x800x700"); await new Promise((r) => setTimeout(r, 150)); const c = read();
      return { p13000: a, p15000: b, over: c, ready: window.RG.ready };
    })()`).catch((e) => ({ err: e.message }));
    console.log("RG_TEST", JSON.stringify(rgt));
    console.log("TABS_AFTER_CLOSE", cleanTabs.length, "active", cleanTabs.findIndex((t) => t.view === cleanView));
    // 🚦 카테고리 판정: Wing 화면 + 오른쪽 400px 판정 칸 (다른 시험이 끝난 뒤 순서대로)
    await win.webContents.executeJavaScript(`document.getElementById("tCat").click()`);
    send("live", buildPayload(fake));
    await new Promise((r) => setTimeout(r, 2500));
    console.log("CAT_VIEW", await win.webContents.executeJavaScript(`document.body.dataset.view + " " + document.getElementById("call").textContent`), "wingW", wingView.getBounds().width, "x", wingView.getBounds().x);
    await shot(win.webContents, "cat.png");
    active = "wing"; layout(); send("nav", { tab: "wing", url: "" });
  }, 1500);
  const shot = async (wc, name) => { try { fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG()); } catch (e) { console.log("CAPTURE_FAIL", name, e.message); } };
  setTimeout(async () => {
    const _unused = async (wc, name) => { try { fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG()); } catch (e) { console.log("CAPTURE_FAIL", name, e.message); } };
    await shot(win.webContents, "panel.png");
    await shot(wingView.webContents, "wing.png");
    if (SITES) { cleanView.setVisible(true); await shot(cleanView.webContents, "coupang.png"); }
    if (SITES) console.log("WING_URL", wingView.webContents.getURL(), "| TITLE", wingView.webContents.getTitle());
    if (SITES) console.log("COUPANG_URL", cleanView.webContents.getURL(), "| TITLE", cleanView.webContents.getTitle());
    console.log("SELFTEST_OK", out);
    app.quit();
  }, 16000);
}

app.whenReady().then(() => { if (GOT_LOCK) { createWindow(); if (!SELFTEST) chat.schedule(); } }); // 답 기다리는 문의가 있으면 이어서 확인
app.on("window-all-closed", () => app.quit());

// Wing 로그인 쿠키를 바로 디스크에 저장 — 강제 종료돼도 다음 실행 때 다시 로그인하지 않게(반복 로그인은 쿠팡 보안 차단 원인)
const flushWing = () => session.fromPartition("persist:wing").flushStorageData();
app.on("before-quit", flushWing);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { try { flushWing(); } finally { app.quit(); } });
