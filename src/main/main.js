// 씨드핵(SEEDHACK) — 메인 프로세스 (구 쿠팡 소싱 신호등)
// 화면: 왼쪽 검은 사이드바(메뉴) + 위 머리줄 + 본문(실제 사이트 화면 또는 패널 화면 — 키워드 분석·수집함·리스트업)
import electron, { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session, net, nativeImage, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { store } from "./store.js";
import { watchWing } from "./wing.js";
import { runExact, stopExact, lookupOne, gate } from "./exact.js";
import { buildXlsx } from "./excel.js";
import { lookup } from "./kwdb.js";
import { searchKeyword } from "./kwsearch.js";
import { buildListupXlsx, buildCollectXlsx } from "./listup-excel.js";
import { upsertPage, upsertMetric, listCollect, removeCollect, countCollect } from "./collect.js";
import { signIn, signOut, restore, checkVendor, licensed, memberOk, state as authState, GATE_ON, wingVendorId } from "./auth.js";
import { DASHBOARD_URL } from "./auth-config.js";
import { recommendViaCli, cliAvailable } from "./ai-cli.js";
import { parseSpecs } from "./spec-core.js";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import { DEFAULTS, buildMarkets, judge, isPB, pbList } from "../shared/strategy-core.js";
import { dhashFromGray, grayFromBGRA, rankBySimilarity, decidePrice, koHint, toNum } from "./sku-core.js";
import { parseCard, rankCards, VERDICT_KO, DEFAULT_WEIGHTS } from "./rank-core.js";
import { initChat } from "./chat.js";

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
// 📦 1688 탭: 로그인 유지(persist:1688). 리스트업 행에서 🔍1688 → 이미지 검색 → 상품 페이지에서 "리스트업에 넣기"
let cnView = null, cnTarget = null, cnPending = null; // cnPending: 1688 첫 화면에서 올릴 사진(한 번 쓰고 비움)
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
    key: snap.key, name: snap.name, path: snap.path, date: snap.date, total: snap.total, mode: S.mode, ads: S.nicheMinMargin === 0.3,
    verdict: j.verdict, note: j.note, target: j.target, yuan: j.yuan, monthly: j.monthly,
    checks: j.checks.map((c) => ({ label: c.label, pass: c.pass, need: c.need })),
    items: m.items.slice(0, 60).map((it) => ({
      order: it.order, pid: it.pid, vid: it.vid, iid: it.iid, name: it.name, brand: it.brand, price: it.ex?.price ?? it.price,
      rating: it.rating, reviews: it.reviews, pvLo: it.pvLo, pvHi: it.pvHi, img: it.img, ex: it.ex || null, light: light(it),
      pb: isPB(it, pbs), // 쿠팡 자체 브랜드(PB): 판매자 상품 매칭에 지표가 없어 정확한 판매량 조회에서 제외
    })),
  };
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const sw = Math.round(sideW * ZOOM), bh = Math.round(BAR_H * ZOOM), st = Math.round(stripW * ZOOM);
  const b = { x: sw, y: bh, width: Math.max(200, w - sw), height: Math.max(200, h - bh) };
  const th = Math.round(TAB_H * ZOOM);
  const bc = { ...b, y: b.y + th, height: Math.max(200, b.height - th) }; // 쿠팡 탭은 위에 탭 줄 자리
  wingView?.setBounds({ ...b, width: Math.max(200, b.width - st) }); // Wing 오른쪽에 판정·수강생 확인 칸
  dashView?.setBounds(b);
  dashView?.setVisible(active === "dash");
  wingView?.setVisible(active === "wing");
  const chatV = chat.view();
  // 💬 채팅 화면: 숨겨도 크기는 유지된다(크기를 받은 뒤 숨김) — 창 밖으로 옮기면 크기가 0이 되어 답 확인·입력을 못 한다
  chatV?.setBounds(b);
  chatV?.setVisible(active === "chat");
  cnView?.setBounds(b);
  cnView?.setVisible(active === "cn");
  cleanTabs.forEach((t) => { t.view.setBounds(bc); t.view.setVisible(active === "clean" && t.view === cleanView); });
}
const isClean = (wc) => cleanTabs.some((t) => t.view.webContents === wc);
function sendTabs() {
  send("ctabs", {
    active: cleanTabs.find((t) => t.view === cleanView)?.id ?? null,
    tabs: cleanTabs.map((t) => { const wc = t.view.webContents; return { id: t.id, title: wc.getTitle() || "불러오는 중…", url: wc.getURL(), loading: wc.isLoading() }; }),
  });
}
function openCleanTab(url = COUPANG_HOME, activate = true) {
  if (!cleanPart) cleanPart = `clean-${Date.now()}`;
  // 너무 많으면 가장 오래된(지금 보는 탭이 아닌) 탭부터 닫는다
  while (cleanTabs.length >= MAX_TABS) { const old = cleanTabs.find((t) => t.view !== cleanView); if (!old) break; closeCleanTab(old.id, true); }
  const view = new WebContentsView({ webPreferences: { partition: cleanPart, contextIsolation: true, sandbox: true, preload: path.join(__dirname, "../preload/coupang.cjs") } });
  const t = { id: ++tabSeq, view };
  cleanTabs.push(t);
  win.contentView.addChildView(view);
  hookView(view, "clean");
  view.webContents.on("preload-error", (_e, _p, err) => log("stop", `✕ 쿠팡 지표 스크립트를 불러오지 못했습니다: ${err?.message || err}`));
  ["page-title-updated", "did-start-loading", "did-stop-loading", "did-navigate"].forEach((ev) => view.webContents.on(ev, sendTabs));
  view.webContents.loadURL(url, { httpReferrer: "https://www.coupang.com/" });
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

function hookView(view, tab) {
  const wc = view.webContents;
  const report = () => tab === active && (tab !== "clean" || view === cleanView) && send("nav", { tab, url: wc.getURL(), canBack: wc.navigationHistory.canGoBack() });
  wc.on("did-navigate", report);
  wc.on("did-navigate-in-page", report);
  wc.on("did-finish-load", report);
  wc.on("did-finish-load", () => wc.setZoomFactor(ZOOM));
  if (tab === "wing") wc.on("did-navigate", (_e, url) => {
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
      // (2026-10-08) 예전에 "전체 사진" 뜻으로 region=0,360,0,360 을 붙였으나 1688이 더 이상 받지 않아(썸네일 깨짐·0건) 붙이지 않는다 — 1688 기본(물체 자동 선택)으로 검색
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
  watchWing(wingView.webContents, (snap) => {
    current = snap;
    const p = buildPayload(snap);
    if (p) { log("sys", `▶ Wing 인기상품 응답 수신 · ${snap.name} · 상품 ${snap.items.length}개`); send("live", p); }
  }, log);
  if (!SELFTEST) wingView.webContents.loadURL(WING_HOME);

  win.on("resize", layout);
  win.webContents.on("did-finish-load", () => {
    layout();
    send("nav", { tab: "wing", url: wingView.webContents.getURL() || WING_HOME });
    log("sys", "▶ 시작 · ① Wing 로그인 → ② 쿠팡 검색 탭에서 검색 → 화면 오른쪽 📊 버튼 → ③ 수집함에서 고르기 → ④ 리스트업에 위안 입력");
    if (SELFTEST) selftest();
    else { startAuth(); startUpdater(); }
    send("version", app.getVersion());
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
  if (!licensed() && tab !== "wing") { send("nav", { tab: "wing", url: wingView.webContents.getURL() }); return; } // 잠금: Wing(판매자 확인용)만
  const dash = /^dash:/.test(tab) ? tab.slice(5) : null; // 📊 판매 관리: "dash:margin" 처럼 대시보드 메뉴 id
  if (dash) tab = "dash";
  active = tab;
  if (dash) openDash(dash);
  if (tab === "clean" && !cleanTabs.length) createClean();
  if (tab === "cn" && !cnView) createCn();
  if (tab === "chat") chat.show(true); // ⑥ 💬 문의 탭: 채팅 화면(처음이면 마지막 문의 대화를 연다)
  layout(); sendTabs(); // 리스트업(list)이면 사이트 화면을 모두 숨기고 패널 왼쪽에 표를 보여 준다
  const v = tab === "wing" ? wingView : tab === "clean" ? cleanView : tab === "cn" ? cnView : tab === "chat" ? chat.view() : tab === "dash" ? dashView : null;
  send("nav", { tab, dash: dashTab, url: v ? v.webContents.getURL() : tab === "collect" ? "수집함 — 쿠팡에서 본 상품 다시 보기·고르기" : tab === "kw" ? "키워드 분석" : "리스트업 — 중국 원가·마진 계산" });
});
// 화면(panel.js)이 알려 주는 틀 크기: 왼쪽 사이드바 폭, Wing 오른쪽 칸 폭
ipcMain.handle("ui:frame", (_e, { side, strip } = {}) => {
  sideW = Math.min(320, Math.max(0, Math.round(+side) || 0));
  stripW = Math.min(600, Math.max(0, Math.round(+strip) || 0));
  layout();
});
// 📊 판매 관리 — 로켓그로스 대시보드의 메뉴(margin·ads·coupons·stock)를 본문에 띄운다
function openDash(id) {
  if (!dashView) {
    dashView = new WebContentsView({ webPreferences: { partition: "persist:dash", contextIsolation: true, sandbox: true } });
    win.contentView.addChildView(dashView);
    hookView(dashView, "dash");
  }
  if (dashTab === id && dashView.webContents.getURL()) return;
  dashTab = id;
  dashView.webContents.loadURL(`${DASHBOARD_URL}/dashboard?tab=${encodeURIComponent(id)}&embed=1`);
}
// 🔎 키워드 분석의 쿠폰가 읽기: ② 쿠팡 탭에서 같은 검색어를 뒤에서 연다(지금 보는 화면은 그대로). coupang.cjs가 카드 가격을 수집함에 넣는다
ipcMain.handle("kw:coupang", (_e, kw) => {
  const q = String(kw || "").trim().slice(0, 60);
  if (!q || !licensed()) return false;
  if (SELFTEST && process.env.SELFTEST_SITES !== "1") return false; // 자체 점검은 실제 쿠팡에 접속하지 않는다
  const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}`;
  if (!cleanView) openCleanTab(url, false);
  else { cleanView.webContents.loadURL(url, { httpReferrer: "https://www.coupang.com/" }); layout(); sendTabs(); }
  return true; // 화면이 가격을 기다려도 된다
});
const curView = () => (active === "wing" ? wingView : active === "cn" ? cnView : active === "chat" ? chat.view() : active === "dash" ? dashView : cleanView);
ipcMain.handle("nav:back", () => { const v = curView(); if (v?.webContents.navigationHistory.canGoBack()) v.webContents.navigationHistory.goBack(); });
ipcMain.handle("nav:reload", () => curView()?.webContents.reload());
ipcMain.handle("nav:home", () => (active === "wing" ? wingView.webContents.loadURL(WING_HOME) : active === "cn" ? cnView?.webContents.loadURL(CN_HOME) : active === "chat" ? null
  : active === "dash" ? dashView?.webContents.loadURL(`${DASHBOARD_URL}/dashboard?tab=${encodeURIComponent(dashTab || "margin")}&embed=1`) : cleanView?.webContents.loadURL(COUPANG_HOME)));

// ---------- 📦 1688 ----------
function createCn(url = CN_HOME) {
  if (!cnView) {
    cnView = new WebContentsView({ webPreferences: { partition: "persist:1688", contextIsolation: true, sandbox: true, preload: path.join(__dirname, "../preload/cn.cjs") } });
    win.contentView.addChildView(cnView);
    hookView(cnView, "cn");
    cnView.webContents.on("preload-error", (_e, _p, err) => log("stop", `✕ 1688 도우미 스크립트 오류: ${err?.message || err}`));
    // 판매자 연락 버튼이 같은 화면에서 채팅으로 넘어간 경우: 채팅은 💬 화면으로 옮기고 상품 화면은 되돌린다
    cnView.webContents.on("did-navigate", (_e, url) => { if (chat.isImUrl(url)) { chat.opened(url); cnView.webContents.navigationHistory.goBack(); } });
  }
  cnView.webContents.loadURL(url);
}
// ---------- 💬 1688 판매자 문의 ----------
const chat = initChat({
  getWin: () => win, getCnView: () => cnView, layout, log, store,
  setShown: (v) => { if (v && active !== "chat") { active = "chat"; send("nav", { tab: "chat", url: "💬 판매자 문의" }); } else if (!v && active === "chat") { active = "cn"; send("nav", { tab: "cn", url: cnView?.webContents.getURL() || "" }); } layout(); },
  sendPanel: send,
  isShown: () => active === "chat",
  isCnShown: () => active === "cn",
});
ipcMain.handle("chat:inquire", (e, p) => (cnView && e.sender === cnView.webContents ? chat.inquire({ offerId: String(p?.offerId || ""), title: String(p?.title || "") }) : { error: "1688 상품 화면에서만 됩니다" }));
ipcMain.handle("chat:state", () => chat.state());
ipcMain.handle("cn:trmode", (e, cycle) => (cnView && e.sender === cnView.webContents ? (cycle ? chat.cycleSiteMode() : chat.siteMode()) : null)); // ⑤ 1688 사이트 번역 방식
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
ipcMain.handle("cn:search", async (_e, { rowId, name, img, allow, price }) => {
  cnTarget = { rowId, name: String(name || "").slice(0, 40), allow: Number(allow) > 0 ? Number(allow) : null, price: Number(String(price || "").replace(/[^\d.]/g, "")) || null }; // allow: 리스트업 허용 소싱가(¥)
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
        cnPending = { b64: im.toJPEG(90).toString("base64"), type: "image/jpeg", ts: Date.now() };
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
  return { copied };
});
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
const fromCn = (e) => !!(cnView && e.sender === cnView.webContents) || !!(probeView && e.sender === probeView.webContents);

// ---- 결과 목록 → 판매자 추천 TOP ----
// 카드 글자(판매량·재구매율·연차·최소주문·운송비·배지)로 1차 점수 → "진짜 가격 확인"을 누르면 숨은 창에서 상위 후보의
// 상품 페이지를 하나씩(4초 간격) 열어 사진과 같은 옵션 가격을 읽고(sku-core) 가격 점수를 더해 🟢🟡🔴 확정.
let cnRank = null;      // { cards: [...], ranked: [...] }
let probeView = null, probeQueue = [], probeCur = null, probeTimer = null;
const PROBE_MAX = 5, PROBE_TIMEOUT_MS = 25000;
const probeGap = () => 8000 + Math.floor(Math.random() * 7000); // 8~15초 무작위 — 사람이 상품을 하나씩 열어 보는 속도. 1688 보안 인증을 덜 부른다
function rankNow() {
  if (!cnRank) return null;
  const weights = { ...DEFAULT_WEIGHTS, ...(store.get("settings")?.rankWeights || {}) };
  const r = rankCards(cnRank.cards, { allow: cnTarget?.allow ?? null, weights });
  cnRank.ranked = r.ranked; cnRank.medianPrice = r.medianPrice;
  const top = r.ranked.slice(0, 8).map((x) => ({ ...x, verdictKo: VERDICT_KO[x.verdict] || x.verdict }));
  return { top, total: cnRank.cards.length, excluded: r.excluded.length, allow: cnTarget?.allow ?? null, medianPrice: r.medianPrice,
    probing: !!probeCur || probeQueue.length > 0, probeLeft: probeQueue.length + (probeCur ? 1 : 0), ai: cnRank.ai || null, aiBusy: !!cnRank.aiBusy, captcha: !!cnRank.captcha };
}
const pushRank = () => { const r = rankNow(); if (r && cnView) cnView.webContents.send("cn:rankUpdate", r); return r; };
ipcMain.handle("cn:rank", (e, p) => {
  if (!cnView || e.sender !== cnView.webContents || !cnTarget) return { error: "리스트업에서 🔍1688로 들어온 검색이 아닙니다" };
  const cards = (Array.isArray(p?.cards) ? p.cards : []).slice(0, 80).map((c, i) => parseCard(c.lines, { rank: i + 1, offerId: String(c.offerId || ""), img: c.img || "" }))
    .map((c) => ({ ...c, realPrice: cnRank?.cards.find((o) => o.offerId === c.offerId)?.realPrice ?? null, option: cnRank?.cards.find((o) => o.offerId === c.offerId)?.option ?? null }));
  cnRank = { cards };
  const r = rankNow();
  log("sys", `▶ 1688 후보 ${cards.length}개 읽음 · 상위 ${r.top.slice(0, 3).map((x) => `${x.score}점`).join("/")}${cnTarget.allow ? ` · 허용 소싱가 ¥${cnTarget.allow.toFixed(1)}` : " · 허용 소싱가 없음(리스트업 판매가 필요)"}`);
  return r;
});
// 진짜 가격 확인: 가격 모르는 상위 PROBE_MAX개를 숨은 창에서 차례로
ipcMain.handle("cn:probe", (e) => {
  if (!cnView || e.sender !== cnView.webContents || !cnRank) return { error: "먼저 결과 목록을 읽어야 합니다" };
  if (probeCur || probeQueue.length) return { ok: true, already: true };
  cnRank.captcha = false;
  probeQueue = cnRank.ranked.filter((x) => x.realPrice == null && x.offerId).slice(0, PROBE_MAX).map((x) => x.offerId);
  if (!probeQueue.length) return { ok: true, nothing: true };
  log("sys", `▶ 1688 진짜 가격 확인 · 상위 ${probeQueue.length}개 상품 페이지를 8~15초 간격으로 엽니다`);
  probeNext();
  return { ok: true, count: probeQueue.length };
});
function probeStop() { clearTimeout(probeTimer); probeQueue = []; probeCur = null; if (probeView) { try { win?.contentView.removeChildView(probeView); probeView.webContents.close(); } catch {} probeView = null; } }
function probeNext() {
  clearTimeout(probeTimer);
  probeCur = probeQueue.shift() || null;
  if (!probeCur) { log("sys", "■ 1688 진짜 가격 확인 끝"); probeStop(); pushRank(); return; }
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
  if (!cnView || e.sender !== cnView.webContents || !cnRank?.ranked?.length) return { error: "먼저 결과 목록을 읽어야 합니다" };
  if (cnRank.aiBusy) return { ok: true, already: true };
  // 개발 실행 + Claude CLI 있음 → 구독 CLI로(개발자 시험용). 그 밖(배포판)은 서버 중계(강사 키, 수강생 승인·하루 한도)
  const useCli = !app.isPackaged && process.env.SIGNAL_AI !== "server" && cliAvailable();
  const vendorId = useCli ? null : await wingVendorId();
  if (!useCli && !vendorId) return { error: "Wing에 로그인되어 있어야 AI 추천을 쓸 수 있습니다 (① Wing 탭)" };
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

ipcMain.on("cn:captcha", (e) => { if (cnView && e.sender === cnView.webContents) log("stop", "✕ 1688 보안 인증(슬라이더)이 떴습니다 — 1688 탭에서 직접 밀어 주세요. 프로그램은 대신 풀지 않습니다."); });

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
  if (!cnView || e.sender !== cnView.webContents || !cnPending || Date.now() - cnPending.ts > 10 * 60 * 1000) return null; // 로그인·인증을 거쳐 돌아와도 이어지게 10분
  return cnPending; // 업로드가 끝났다고 알려 올 때까지 유지(페이지가 한 번 다시 열려도 이어서)
});
ipcMain.handle("cn:pendingDone", (e) => { if (cnView && e.sender === cnView.webContents) cnPending = null; });

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
  const ranked = cnPhotoHash ? rankBySimilarity(cnPhotoHash, withHash) : withHash.map((x, i) => ({ ...x, i, dist: null }));
  const out = { hasPhoto: !!cnPhotoHash, ranked: ranked.map(({ hash, ...r }) => ({ ...r, price: toNum(r.price) })) }; // 가격은 숫자로(원문 "¥11.2" 그대로 흘러가 "¥¥" 표시되던 문제)
  if (p?.stage === "items") {
    const d = decidePrice(withHash, { photoHash: cnPhotoHash });
    out.decision = { ...d, pick: d.pick ? { i: d.pick.i, label: d.pick.label, price: d.pick.price, dist: d.pick.dist ?? null, ko: koHint(d.pick.label) } : null,
      alts: d.alts.map((a) => ({ i: a.i, label: a.label, price: a.price, dist: a.dist ?? null, ko: koHint(a.label) })) };
  }
  return out;
});
ipcMain.on("cn:log", (e, text) => { if (cnView && e.sender === cnView.webContents) log("dim", `  1688 · ${String(text).slice(0, 900)}`); });
ipcMain.handle("cn:pick", (e, p) => {
  if (!cnView || e.sender !== cnView.webContents || !cnTarget) return { error: "넣을 리스트업 행이 없습니다 — 리스트업에서 🔍1688을 먼저 눌러 주세요" };
  const yuan = Number(p?.yuan);
  const url = String(p?.url || "");
  if (!/^https:\/\/([\w-]+\.)*1688\.com\//.test(url)) return { error: "1688 상품 주소가 아닙니다" };
  const specs = p?.specs && typeof p.specs === "object" ? { dims: String(p.specs.dims || ""), wt: p.specs.g != null ? String(p.specs.g) : "", cartonQty: p.specs.cartonQty ?? null } : null;
  send("listup:fill", { rowId: cnTarget.rowId, cnUrl: url, yuan: yuan > 0 ? yuan : null, cnTitle: String(p?.title || "").slice(0, 120), option: String(p?.option || "").slice(0, 80), specs });
  log("go", `■ 1688 → 리스트업 · ${cnTarget.name} ← ¥${yuan > 0 ? yuan : "?"}${p?.option ? ` (옵션: ${String(p.option).slice(0, 40)})` : ""}${specs?.dims ? ` · 크기 ${specs.dims}mm` : ""}${specs?.wt ? ` · ${specs.wt}g` : ""}${specs?.cartonQty ? ` · ${specs.cartonQty}개/박스` : ""} ${url}`);
  active = "list"; layout(); send("nav", { tab: "list", url: "리스트업 — 중국 원가·마진 계산" });
  return { ok: true };
});
ipcMain.handle("ctab:select", (_e, id) => selectCleanTab(id));
ipcMain.handle("ctab:close", (_e, id) => closeCleanTab(id));
ipcMain.handle("ctab:new", () => openCleanTab(COUPANG_HOME, true));
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

ipcMain.handle("live:open", () => {
  let code = null;
  try { code = new URL(wingView.webContents.getURL()).searchParams.get("categoryCode"); } catch {}
  const snap = store.latestSnapshot(code) || store.latestSnapshot(null);
  if (!snap) return { error: "저장된 인기상품 데이터가 없습니다. 왼쪽 Wing에서 카테고리를 먼저 선택해 주세요." };
  current = snap;
  return buildPayload(snap) || { error: "판정할 상품이 없습니다." };
});

ipcMain.handle("settings:get", () => store.get("settings") || {});
ipcMain.handle("settings:set", (_e, patch) => {
  store.set("settings", { ...(store.get("settings") || {}), ...patch });
  return current ? buildPayload(current) : null;
});

ipcMain.handle("exact:start", async (_e, items) => {
  if (!licensed()) return LOCKED;
  if (!items?.length) return { error: "조회할 상품이 없습니다." };
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
ipcMain.handle("kw:search", async (_e, { keyword, pages = 1, force = false }) => {
  if (!licensed()) return LOCKED;
  const db = await lookup(keyword).catch(() => ({ month: null, main: null, subs: [] }));
  if (db.main) log("sys", `▶ '${keyword}' 네이버 월검색 ${db.main.m1?.toLocaleString() ?? "-"} · 서브키워드 후보 ${db.subs.length}개 (제휴 DB ${db.month})`);
  const res = await searchKeyword(keyword, Math.min(3, Math.max(1, pages)), wingView.webContents, log, force);
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
ipcMain.handle("kw:db", (_e, keyword) => lookup(keyword).catch(() => ({ month: null, main: null, subs: [] })));
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
  if (process.env.SELFTEST_1688) { // 실제 1688 이미지 검색 시험(쿠팡·Wing 접속 없음)
    const fakeImg = "https://picsum.photos/id/1060/400/400.jpg";
    cnTarget = { rowId: 1, name: "시험 상품" };
    // cn:search 처리와 같은 흐름
    const rr = await net.fetch(fakeImg); const im = nativeImage.createFromBuffer(Buffer.from(await rr.arrayBuffer()));
    cnPending = { b64: im.toJPEG(90).toString("base64"), type: "image/jpeg", ts: Date.now() };
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
