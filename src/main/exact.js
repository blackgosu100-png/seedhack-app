// 정확한 28일 조회수·판매량 조회 (Wing 상품 매칭 검색, 로그인된 Wing 화면 안에서 실행)
// 안전 원칙은 Wing 트렌드 도우미 확장과 같다:
//   요청 간격 4초 · 10분 60건 · 최근 24시간 하루 예산 · "검색 한도 초과"면 24시간 정지 · 403/429·접근 제한이면 60분 정지
//   같은 상품은 7일 동안 다시 조회하지 않음
import { store } from "./store.js";
import { catOfWingItem, codesOfWingItem } from "./cat-core.js";

const MIN_INTERVAL = 4000, WINDOW = 10 * 60 * 1000, MAX_PER_WINDOW = 60;
const DAY = 24 * 60 * 60 * 1000, BLOCK = 60 * 60 * 1000, CACHE_TTL = 7 * DAY;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const MIN_GAP = MIN_INTERVAL;
const keyOf = (it) => `${it.pid}:${it.vid ?? ""}`;
export const num = (v) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };

// 📂 Wing 상품 매칭 응답에 쿠팡 분류가 들어 있으면 상품 번호별로 기억해 둔다(리스트업 카테고리 자동 넣기에 씀)
export function rememberCat(pid, x) {
  const p = typeof x === "string" ? x : catOfWingItem(x) || codesOfWingItem(x); // 경로 글이 없으면 분류 번호("#…")
  if (!p && x && typeof x === "object") store.set("catDiag", { ts: Date.now(), pid, displayCategoryInfo: x.displayCategoryInfo ?? null, categoryId: x.categoryId ?? null }); // 분류를 못 읽은 응답의 모양(원인 확인용)
  if (!p || pid == null) return;
  const m = store.get("pidCat") || {};
  if (m[pid] === p) return;
  m[pid] = p;
  const keys = Object.keys(m);
  if (keys.length > 8000) keys.slice(0, keys.length - 8000).forEach((k) => delete m[k]);
  store.set("pidCat", m);
}

// Wing 화면 안에서 실행할 코드 (로그인 세션 사용)
export const pageFetch = (keyword, page = 0) => `(async () => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch("/tenants/seller-web/post-matching/search", { method: "POST", credentials: "include", cache: "no-store", signal: c.signal,
      headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ keyword: ${JSON.stringify(String(keyword))}, excludedProductIds: [], searchPage: ${Number(page) || 0}, searchOrder: "DEFAULT" }) });
    const text = await r.text();
    return { status: r.status, type: r.headers.get("content-type") || "", text, url: r.url, redirected: r.redirected };
  } catch (e) { return { error: e.name === "AbortError" ? "시간 초과" : String(e.message || e) }; } finally { clearTimeout(t); }
})()`;

// Wing 화면에서 요청 실행 — 화면이 로그인 페이지이거나 이동 중이면 실행이 멈출 수 있으므로 시간 제한을 둔다
export async function runInWing(wc, keyword, page = 0) {
  const url = wc.getURL();
  if (!/^https:\/\/wing\.coupang\.com\//.test(url)) return { error: "WING_PAGE", url };
  if (wc.isLoading()) await new Promise((r) => { const t = setTimeout(r, 8000); wc.once("did-stop-loading", () => { clearTimeout(t); r(); }); });
  let timer;
  const timeout = new Promise((r) => (timer = setTimeout(() => r({ error: "WING_STUCK", url: wc.getURL() }), 15000)));
  const res = await Promise.race([wc.executeJavaScript(pageFetch(keyword, page), true).catch((e) => ({ error: String(e.message || e) })), timeout]);
  clearTimeout(timer);
  return res;
}

export function classify(res) {
  if (res.error === "WING_PAGE") return { ok: false, auth: true, error: "Wing 로그인 필요" };
  if (res.error === "WING_STUCK") return { ok: false, stuck: true, error: "Wing 화면이 응답하지 않습니다 — 왼쪽 Wing 탭에서 ⟳ 새로고침 후 다시 시도하세요" };
  if (res.error) return { ok: false, error: res.error };
  const head = (res.text || "").slice(0, 4000);
  if (/검색\s*한도를?\s*초과|한도를\s*초과하셨습니다/.test(head)) return { ok: false, dailyLimit: true, error: "오늘 검색 한도 초과" };
  if (res.status === 403 || res.status === 429 || /사용권한이 없습니다|권한이 제한된 페이지|비정상적인 접근|Access Denied|자동입력 방지/i.test(head)) return { ok: false, blocked: true, error: `Wing 접근 제한 (HTTP ${res.status})` };
  if (res.status === 401 || (!res.type.includes("json") && /Sign in to seller|로그인/i.test(head))) return { ok: false, auth: true, error: "Wing 로그인 필요" };
  if (!res.type.includes("json")) {
    // 데이터 대신 웹페이지가 왔을 때 — 무엇인지 가려서 알려 준다
    const title = (head.match(/<title[^>]*>([^<]{0,80})/i)?.[1] || "").trim();
    const where = (() => { try { return new URL(res.url || "").pathname.slice(0, 60); } catch { return ""; } })();
    if (/xauth|\/login|\/sso|signin|openid-connect/i.test(res.url || "")) return { ok: false, auth: true, error: "Wing 로그인이 풀렸습니다 (로그인 화면으로 이동됨)" };
    if (res.status >= 500) return { ok: false, nonJson: true, error: `Wing 서버 일시 오류 (HTTP ${res.status}) — 잠시 뒤 다시 시도하세요` };
    if (/점검|maintenance/i.test(head)) return { ok: false, nonJson: true, error: "Wing 점검 중 — 점검이 끝난 뒤 다시 시도하세요" };
    if (/captcha|challenge|robot|bot\s*detect|보안\s*문자|본인\s*확인/i.test(head)) return { ok: false, blocked: true, error: "쿠팡 보안 확인 페이지가 나왔습니다" };
    return { ok: false, nonJson: true, error: `예상과 다른 응답 (HTTP ${res.status}${title ? ` · ${title}` : ""}${where ? ` · ${where}` : ""})` };
  }
  try { return { ok: true, data: JSON.parse(res.text) }; } catch { return { ok: false, error: "응답 해석 실패" }; }
}

function collect(node, out, depth) {
  if (!node || depth > 12 || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x) => collect(x, out, depth + 1)); return out; }
  if (node.pvLast28Day != null || node.salesLast28d != null || node.vendorItemId != null || node.productName != null) out.push(node);
  Object.values(node).forEach((v) => collect(v, out, depth + 1));
  return out;
}
function pickItem(data, it) {
  const same = (v, e) => !!e && v != null && String(v) === String(e);
  let best = null, score = 0;
  for (const x of collect(data, [], 0)) {
    let s = 0;
    if (same(x.productId, it.pid) || same(x.coupangProductId, it.pid)) s += 1500;
    if (same(x.vendorItemId, it.vid)) s += 1000;
    if (same(x.itemId, it.iid) || same(x.productItemId, it.iid)) s += 900;
    if (!s) continue;
    if (x.pvLast28Day != null) s += 10;
    if (x.salesLast28d != null) s += 10;
    if (s > score) { best = x; score = s; }
  }
  return score >= 800 ? best : null;
}

// 속도 제한: 들어갈 수 있으면 null, 아니면 { until, reason }
export function gate() {
  const L = store.get("limit") || {};
  const now = Date.now();
  if ((L.dailyUntil || 0) > now) return { until: L.dailyUntil, reason: "오늘 검색 한도 초과" };
  if ((L.blockedUntil || 0) > now) return { until: L.blockedUntil, reason: "접근 제한 감지" };
  const win = (L.times || []).filter((t) => now - t < WINDOW);
  if (win.length >= MAX_PER_WINDOW) return { until: win[0] + WINDOW, reason: "10분 60건 한도" };
  const day = (L.day || []).filter((t) => now - t < DAY);
  const budget = Number(store.get("budget")) || 0;
  if (budget && day.length >= budget) return { until: day[day.length - budget] + DAY, reason: `하루 예산 ${budget}건` };
  return null;
}
export function mark() {
  const L = store.get("limit") || {};
  const now = Date.now();
  store.set("limit", { ...L, last: now, times: [...(L.times || []).filter((t) => now - t < WINDOW), now], day: [...(L.day || []).filter((t) => now - t < DAY), now] });
}

// 차단·한도 응답을 받았을 때 정지 기록 (키워드 검색도 같이 씀)
export function markDaily() { const L = store.get("limit") || {}; store.set("limit", { ...L, dailyUntil: Date.now() + DAY + 5 * 60 * 1000 }); }
export function markBlocked() { const L = store.get("limit") || {}; store.set("limit", { ...L, blockedUntil: Date.now() + BLOCK }); }
export function isBusy() { return !!running; }

let running = null;

// items: [{pid,vid,iid,name}], wc: 로그인된 Wing webContents, emit(event, payload)
export async function runExact(items, wc, emit) {
  if (running) return { error: "이미 조회가 진행 중입니다." };
  running = { stop: false };
  const job = running;
  const total = items.length;
  let ok = 0, fail = 0, skip = 0;
  emit("progress", { pos: 0, total, status: "running", msg: `시작 — ${total}개 (요청 간격 4초)` });
  try {
    for (let i = 0; i < total; i++) {
      if (job.stop) { emit("progress", { pos: i, total, status: "stopped", msg: "중지했습니다. 받은 값은 저장되어 있습니다." }); return { ok, fail, skip }; }
      const it = items[i], key = keyOf(it);
      const cached = store.get("exactCache")[key];
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        skip++;
        emit("item", { key, ex: cached });
        emit("progress", { pos: i + 1, total, status: "running", msg: `${it.name.slice(0, 28)} — 최근 조회값 재사용 (조회 ${cached.views ?? "-"} / 판매 ${cached.sales ?? "-"})` });
        continue;
      }
      const g = gate();
      if (g) { emit("progress", { pos: i, total, status: "paused", msg: `${g.reason} — ${new Date(g.until).toLocaleString("ko-KR")} 이후 다시 시도하세요.` }); return { ok, fail, skip }; }
      const wait = Math.max(0, MIN_INTERVAL - (Date.now() - ((store.get("limit") || {}).last || 0)));
      if (wait) await sleep(wait);
      if (job.stop) continue;
      mark();
      emit("progress", { pos: i, total, status: "running", msg: `↗ 상품 매칭 조회 #${it.pid} ${it.name.slice(0, 24)}` });
      const r = classify(await runInWing(wc, it.pid));
      if (r.dailyLimit) {
        const L = store.get("limit") || {};
        store.set("limit", { ...L, dailyUntil: Date.now() + DAY + 5 * 60 * 1000 });
        emit("progress", { pos: i, total, status: "paused", msg: "오늘 검색 한도 초과 — 24시간 뒤 다시 시도하세요." });
        return { ok, fail, skip };
      }
      if (r.blocked) {
        const L = store.get("limit") || {};
        store.set("limit", { ...L, blockedUntil: Date.now() + BLOCK });
        emit("progress", { pos: i, total, status: "paused", msg: `${r.error} — 60분간 정지합니다.` });
        return { ok, fail, skip };
      }
      if (r.auth) { emit("progress", { pos: i, total, status: "paused", msg: "Wing 로그인이 필요합니다. 왼쪽 Wing 화면에서 로그인한 뒤 다시 누르세요." }); return { ok, fail, skip }; }
      const x = r.ok ? pickItem(r.data, it) : null;
      const views = num(x?.pvLast28Day), sales = num(x?.salesLast28d);
      if (x && (views != null || sales != null)) {
        const ex = { ts: Date.now(), views, sales, price: num(x.salePrice) };
        store.putExact(key, ex);
        rememberCat(it.pid, x);
        ok++;
        emit("item", { key, ex });
        emit("progress", { pos: i + 1, total, status: "running", msg: `✔ ${it.name.slice(0, 24)} — 28일 조회 ${views ?? "-"} / 판매 ${sales ?? "-"}` });
      } else {
        fail++;
        emit("progress", { pos: i + 1, total, status: "running", msg: `✕ ${it.name.slice(0, 24)} — ${r.error || "상품 매칭 실패"}` });
      }
    }
    emit("progress", { pos: total, total, status: "done", msg: `완료 — 조회 ${ok} · 재사용 ${skip} · 실패 ${fail}` });
    return { ok, fail, skip };
  } finally {
    running = null;
  }
}

export function stopExact() { if (running) running.stop = true; }

// Wing 상품 매칭의 배송 유형 → 판매자로켓/로켓배송 (확장 shippingMethodFromCoupangWingItem과 같은 규칙: deliveryType 우선)
export function wingShip(x) {
  const t = String(x?.deliveryType || x?.delivery_type || "").toUpperCase();
  if (t.includes("ROCKET_MERCHANT")) return "판매자로켓";
  if (t.includes("ROCKET_DELIVERY")) return "로켓배송";
  return null;
}

// 쿠팡 화면 오버레이용 단건 조회 (로켓그로스 확장 "쿠팡 지표 보기"와 같은 방식: productId로 상품 매칭 검색)
// 여러 카드가 동시에 요청해도 한 줄로 세워 4초 간격·10분 60건·하루 예산을 지킨다.
let oneQueue = Promise.resolve();
let nonJsonRun = 0;
const recentFail = new Map(); // pid → { ts, error } — 매칭 실패 상품은 10분 동안 다시 조회하지 않는다(예산 낭비 방지)
export function lookupOne(it, wc, opt = {}) { // opt.needCat: 저장값이 있어도 쿠팡 분류를 모르면 한 번 더 조회(리스트업 카테고리 자동)
  const f = recentFail.get(it.pid);
  if (f && Date.now() - f.ts < 10 * 60 * 1000) return Promise.resolve({ error: f.error, recent: true });
  const run = oneQueue.then(async () => {
    const c = store.get("exactCache") || {};
    const hit = c[keyOf(it)] || Object.entries(c).find(([k, v]) => k.startsWith(`${it.pid}:`) && Date.now() - v.ts < CACHE_TTL)?.[1];
    if (hit && Date.now() - hit.ts < CACHE_TTL && !(opt.needCat && !(store.get("pidCat") || {})[it.pid])) return { ex: hit, cached: true };
    const g = gate();
    if (g) return /10분/.test(g.reason) ? { error: g.reason, soft: true, until: g.until } // 10분 한도는 기다리면 풀림
      : { error: `${g.reason} — ${new Date(g.until).toLocaleString("ko-KR")} 이후`, paused: true, until: g.until };
    const wait = Math.max(0, MIN_INTERVAL - (Date.now() - ((store.get("limit") || {}).last || 0)));
    if (wait) await sleep(wait);
    mark();
    const r = classify(await runInWing(wc, it.pid));
    // 이상한 응답(웹페이지)이 연달아 오면 로그인 풀림·보안 확인일 가능성이 높아 멈춘다(조회 한도 낭비 방지)
    nonJsonRun = r.nonJson ? nonJsonRun + 1 : 0;
    if (nonJsonRun >= 3) { nonJsonRun = 0; return { error: `${r.error} — 연속 3번 이런 응답이라 멈춥니다. 왼쪽 Wing 화면에서 ⟳ 새로고침하거나 다시 로그인한 뒤 눌러 주세요`, paused: true }; }
    if (r.dailyLimit) { markDaily(); return { error: "오늘 검색 한도 초과", paused: true }; }
    if (r.blocked) { markBlocked(); return { error: `${r.error} — 60분 정지`, paused: true }; }
    if (r.auth) return { error: "Wing 로그인 필요", auth: true };
    if (!r.ok) return { error: r.error || "응답 오류" };
    const x = pickItem(r.data, it);
    const views = num(x?.pvLast28Day), sales = num(x?.salesLast28d);
    if (!x || (views == null && sales == null)) { recentFail.set(it.pid, { ts: Date.now(), error: "Wing 상품 매칭 실패" }); return { error: "Wing 상품 매칭 실패" }; }
    const ex = { ts: Date.now(), views, sales, price: num(x.salePrice), ship: wingShip(x) };
    store.putExact(keyOf({ pid: it.pid, vid: it.vid || (x.vendorItemId != null ? String(x.vendorItemId) : "") }), ex);
    rememberCat(it.pid, x);
    return { ex };
  });
  oneQueue = run.catch(() => {});
  return run;
}
