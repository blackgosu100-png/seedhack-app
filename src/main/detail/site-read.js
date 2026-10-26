// 📄 ▶ 주소로 만들기 — 한국 판매처(쿠팡·네이버·오늘의집) 상품 화면 읽기 (Electron)
// · 네이버·오늘의집: 전용 화면이 없어 숨은 창(persist:detail-web — 로그인·쿠키가 남는 세션)에서 한 번 연다. 막히면 같은 세션의 「보이는 창」으로 사람에게 넘긴다.
// · 쿠팡: 앱의 쿠팡 탭(사람이 보는 화면)에서 한 번 연 화면을 그대로 읽는다(index.js). 자동 반복 요청 없음.
// 화면에서는 그림 주소·크기·위치·구역과 표·옵션 글만 모으고(collectPage), 고르기·정리는 site-core.buildKoRaw 가 한다.
import { BrowserWindow, session as electronSession } from "electron";
import { koWall } from "./site-core.js";

export const WEB_PARTITION = "persist:detail-web";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 실제 크롬과 같은 UA·클라이언트 힌트(sec-ch-ua) — 힌트가 없으면 네이버가 429(접속 불가)로 막는다(2026-10-13 실측)
let hooked = false;
export function webSession() {
  const ses = electronSession.fromPartition(WEB_PARTITION);
  if (!hooked) {
    hooked = true;
    const maj = String(process.versions.chrome || "138").split(".")[0];
    ses.setUserAgent(`Mozilla/5.0 (${process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "Macintosh; Intel Mac OS X 10_15_7"}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maj}.0.0.0 Safari/537.36`, "ko-KR,ko,en-US,en");
    ses.webRequest.onBeforeSendHeaders((d, cb) => {
      const h = d.requestHeaders;
      h["sec-ch-ua"] = `"Google Chrome";v="${maj}", "Chromium";v="${maj}", "Not_A Brand";v="24"`; h["sec-ch-ua-mobile"] = "?0"; h["sec-ch-ua-platform"] = process.platform === "win32" ? '"Windows"' : '"macOS"';
      cb({ requestHeaders: h });
    });
  }
  return ses;
}

export const WALL_PROBE_JS = `({ url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 3000) })`;

// ---- 화면 안에서 도는 수집기(executeJavaScript 로 문자열이 되어 들어간다 — 바깥 변수를 쓰면 안 된다) ----
async function collectPage(site) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const abs = (u) => { try { return new URL(String(u || "").trim(), location.href).href; } catch { return ""; } };
  const LAZY = ["data-src", "data-original", "data-lazy-src", "data-img-src", "data-lazyload-src", "data-srcset"];
  const srcOf = (im) => { for (const a of LAZY) { const v = im.getAttribute(a); if (v && !/^data:/i.test(v)) return abs(v.split(/\s+/)[0]); } const s = im.currentSrc || im.getAttribute("src") || ""; return /^data:/i.test(s) ? "" : abs(s); };
  const CFG = {
    coupang: { gallery: ".product-image, .prod-image", detail: ".product-detail-content-inside, .product-detail-content, #productDetail, .vendor-item, [class*='vendor-item-detail']", skip: "[class*='review' i], [class*='recommend' i], [class*='also-'], .rl-item, [class*='promotion'], [class*='carousel'], [class*='cmg-'], header, footer, nav", attrs: "#itemBrief", title: "h1.product-title, h1", more: /^상품\s*정보\s*더\s*보기$/ },
    ohou: { gallery: "", detail: "", skip: "header, footer, nav, [class*='review' i], [class*='product-thumbnail'], [class*='product-info'], [data-component*='Rec']", attrs: "table", title: "h1", more: /^(상품\s*정보\s*더\s*보기|펼치기)$/ },
    naver: { gallery: "", detail: ".se-main-container, .se-viewer, #INTRODUCE, [id*='INTRODUCE'], [class*='detail_area' i], [class*='introduce' i]", skip: "header, footer, nav, [class*='review' i], [id*='REVIEW'], [class*='recommend' i], [class*='banner' i], [class*='qna' i]", attrs: "table", title: "h3, h2, h1", more: /^상세\s*정보\s*(펼쳐\s*보기|더\s*보기)$/ },
  }[site] || { gallery: "", detail: "", skip: "header, footer, nav", attrs: "table", title: "h1", more: /^$/ };
  const near = (el, sel) => !!(sel && el.closest(sel));
  // ① 상세 펼치기 버튼(있으면 한 번) ② 천천히 끝까지 내려 지연 로딩 깨우기(높이가 3번 연속 그대로이거나 약 25초) ③ 맨 위로
  const clickMore = () => { const b = [...document.querySelectorAll("button, a")].find((x) => CFG.more.test(txt(x.textContent)) && x.offsetParent); if (b) { b.scrollIntoView({ block: "center" }); b.click(); return true; } return false; };
  let clicked = clickMore(); if (clicked) await sleep(1200);
  const step = Math.max(700, innerHeight);
  for (let i = 0, y = 0, lastH = 0, still = 0, t0 = Date.now(); i < 120 && still < 3 && Date.now() - t0 < 25000; i++) {
    y += step; scrollTo(0, y); await sleep(250);
    if (!clicked && clickMore()) { clicked = true; await sleep(1200); }
    const H = document.documentElement.scrollHeight;
    if (y + innerHeight >= H) { still = H === lastH ? still + 1 : 0; lastH = H; y = Math.max(0, H - innerHeight - step); await sleep(300); }
  }
  scrollTo(0, 0); await sleep(300);
  const imgs = [];
  for (const im of document.images) {
    const u = srcOf(im); if (!u || /^data:/.test(u)) continue;
    const r = im.getBoundingClientRect();
    const zone = near(im, CFG.skip) ? "skip" : near(im, CFG.gallery) ? "gallery" : near(im, CFG.detail) ? "detail" : "";
    imgs.push({ u, w: im.naturalWidth || +im.getAttribute("width") || 0, h: im.naturalHeight || +im.getAttribute("height") || 0, rw: Math.round(r.width), rh: Math.round(r.height), top: Math.round(r.top + scrollY), left: Math.round(r.left + scrollX), zone });
    if (imgs.length >= 500) break;
  }
  const attrs = [];
  for (const root of document.querySelectorAll(CFG.attrs)) {
    if (near(root, "header, footer, nav")) continue;
    for (const tr of root.querySelectorAll("tr")) { const c = [...tr.children].map((x) => txt(x.textContent)); for (let i = 0; i + 1 < c.length; i += 2) attrs.push({ k: c[i], v: c[i + 1] }); }
    for (const dt of root.querySelectorAll("dt")) { const dd = dt.nextElementSibling; if (dd && dd.tagName === "DD") attrs.push({ k: txt(dt.textContent), v: txt(dd.textContent) }); }
  }
  const options = [];
  for (const sel of document.querySelectorAll("select")) { if (near(sel, "header, footer, nav") || /additional|추가/i.test(sel.getAttribute("data-testid") || "")) continue; for (const o of sel.options) if (o.value !== "" && !o.disabled && !o.hidden) options.push(txt(o.textContent)); }
  const ld = []; for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { ld.push(JSON.parse(s.textContent)); } catch {} }
  const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || "";
  let state = null;
  if (site === "naver") { // 네이버 상태 JSON 중 상품 칸만(크기를 줄여 보낸다)
    try {
      const st = window.__PRELOADED_STATE__ || {}, pick = (o, ks) => Object.fromEntries(ks.filter((k) => o && o[k] != null).map((k) => [k, o[k]]));
      state = JSON.parse(JSON.stringify({ simpleProductForDetailPage: { A: pick(st.simpleProductForDetailPage?.A, ["name", "dispName", "representativeImageUrl", "representativeImageWidth", "representativeImageHeight", "optionalImageUrls", "detailContents", "naverShoppingSearchInfo", "category", "salePrice", "dispSalePrice", "optionStandards", "productInfoProvidedNoticeView"]) }, product: { A: pick(st.product?.A, ["name", "productImages", "options", "optionCombinations", "productInfoProvidedNoticeView", "naverShoppingSearchInfo", "category", "salePrice", "discountedSalePrice"]) } }));
    } catch {}
  }
  const dEl = CFG.detail && document.querySelector(CFG.detail);
  const h1 = [...document.querySelectorAll(CFG.title)].map((e) => txt(e.textContent)).find((t) => t.length >= 4 && t.length <= 200) || "";
  return { url: location.href.split("#")[0], title: document.title, h1, og: { title: meta("og:title"), image: meta("og:image"), description: meta("og:description") }, ld, state, imgs, attrs, options, text: dEl ? String(dEl.innerText || "").slice(0, 8000) : "", height: document.documentElement.scrollHeight, clicked };
}
export const collectJs = (site) => `(${collectPage.toString()})(${JSON.stringify(site)})`;

const withTimeout = (p, ms, msg) => Promise.race([p, sleep(ms).then(() => { throw new Error(msg); })]);
// 열린 화면(webContents)에서 막힘 확인 → 수집. 반환 { page } | { wall, state }
export async function readFrom(wc, site, { timeoutMs = 60000 } = {}) {
  const st = await wc.executeJavaScript(WALL_PROBE_JS, true).catch(() => null);
  const wall = st ? koWall(site, st) : "blocked";
  if (wall) return { wall, state: st };
  const page = await withTimeout(wc.executeJavaScript(collectJs(site), true), timeoutMs, "화면 읽기 시간 초과");
  return { page };
}
export const waitLoad = (wc, ms = 25000) => new Promise((res) => { let done = false; const fin = () => { if (done) return; done = true; wc.removeListener("did-stop-loading", fin); clearTimeout(t); res(); }; const t = setTimeout(fin, ms); wc.on("did-stop-loading", fin); });

// 네이버·오늘의집: 숨은 창에서 한 번 열고 읽고 닫는다. 반환 { page } | { wall, state }
export async function readHidden({ site, url, log = () => {} }) {
  const ses = webSession();
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    const loaded = waitLoad(win.webContents);
    try { await win.loadURL(url); } catch (e) { log(`  📄 화면 열기 경고 ${String(e?.message || e).slice(0, 80)}`); }
    await loaded; await sleep(2000);
    return await readFrom(win.webContents, site);
  } finally { try { win.destroy(); } catch {} }
}

// 「보이는 창으로 열기」: 같은 세션으로 사람이 로그인·보안 확인을 넘기게 한다(닫으면 끝). 이 창에서 상품 화면이 보이면 그대로 읽을 수도 있다
let visibleWin = null;
export function openVisible(url, { title = "씨드핵 — 로그인·보안 확인을 넘긴 뒤 이 창을 닫고 ▶ 주소로 만들기를 다시 누르세요" } = {}) {
  const ses = webSession();
  if (!visibleWin || visibleWin.isDestroyed()) {
    visibleWin = new BrowserWindow({ show: true, width: 1280, height: 900, title, autoHideMenuBar: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
    visibleWin.on("page-title-updated", (e) => e.preventDefault());
    visibleWin.on("closed", () => { visibleWin = null; });
  }
  visibleWin.loadURL(url).catch(() => {});
  visibleWin.focus();
  return visibleWin;
}
export const visibleWebContents = () => (visibleWin && !visibleWin.isDestroyed() ? visibleWin.webContents : null);
