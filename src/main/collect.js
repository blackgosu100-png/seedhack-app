// 📦 수집함 — 쿠팡 화면(클린 세션)·키워드 검색에서 본 상품을 자동으로 모아 둔다. 나중에 필터로 다시 보고 골라 리스트업.
// 페이지 정보(검색어·순위·광고·리뷰·로켓·가격)는 화면에서, 판매량·조회수는 Wing 조회 결과에서 채운다.
import { store } from "./store.js";

const MAX = 5000;
const all = () => store.get("collect") || {};

function put(c) {
  const keys = Object.keys(c);
  if (keys.length > MAX) keys.sort((a, b) => (c[a].seen || 0) - (c[b].seen || 0)).slice(0, keys.length - MAX).forEach((k) => delete c[k]);
  store.set("collect", c);
}

// items: [{pid, vid, name, img, price, reviews, rating, rocket, adSlot, rank, organic}]
// query: 쿠팡 화면 검색어(순위 기록) · tagQuery: 순위 없이 검색어만 붙일 때(Wing 키워드 검색)
export function upsertPage(query, page, items, source = "coupang", tagQuery = "") {
  const c = all(), now = Date.now();
  for (const it of items) {
    if (!it?.pid) continue;
    const o = c[it.pid] || { pid: it.pid, first: now, queries: [] };
    const q = query ? String(query).trim() : "";
    const tq = tagQuery ? String(tagQuery).trim() : "";
    if (tq && !o.queries.includes(tq)) o.queries = [tq, ...o.queries].slice(0, 8);
    if (tq && !o.query) o.query = tq;
    Object.assign(o, {
      vid: it.vid || o.vid || "", name: it.name || o.name || "", img: it.img || o.img || "",
      price: source === "coupang" ? it.price ?? o.price ?? null : o.price ?? it.price ?? null,
      reviews: source === "coupang" ? it.reviews ?? o.reviews ?? null : o.reviews ?? it.reviews ?? null, rating: it.rating ?? o.rating ?? null,
      rocket: it.rocket ?? o.rocket ?? null, pb: !!(it.pb ?? o.pb), seen: now, source: o.source || source,
      ship: it.ship ?? o.ship ?? null, shipDays: it.shipDays ?? o.shipDays ?? null,
    });
    if (q) {
      o.query = q;
      if (!o.queries.includes(q)) o.queries = [q, ...o.queries].slice(0, 8);
      // 같은 검색어에서의 노출 위치(가장 최근) — 광고 칸은 따로 표시
      o.pos = o.pos || {};
      o.pos[q] = { page: page || 1, rank: it.rank ?? null, organic: it.organic ?? null, ad: !!it.adSlot, ts: now };
    }
    if (it.ex) o.ex = it.ex;
    c[it.pid] = o;
  }
  put(c);
  // 노출 순서 기록: 같은 검색어·카테고리 페이지를 다시 열 때 "어느 자리 상품이 바뀌는지"(롤링 노출 자리) 분석용
  if (query && source === "coupang") {
    const log = store.get("pageLog") || [];
    const order = [...items].filter((it) => it.rank != null).sort((a, b) => a.rank - b.rank);
    const last = log.filter((e) => e.q === query && e.page === (page || 1)).at(-1);
    const sig = order.map((it) => it.pid).join(",");
    if (!last || last.sig !== sig || now - last.ts > 30 * 60 * 1000) { // 같은 화면을 연달아 누른 것은 한 번만
      log.push({ q: query, page: page || 1, ts: now, sig, pids: order.map((it) => it.pid), adf: order.map((it) => (it.adSlot ? 1 : 0)) });
      store.set("pageLog", log.slice(-600));
    }
  }
  return Object.keys(c).length;
}

export function upsertMetric(pid, ex, extra = {}) {
  const c = all();
  const o = c[pid] || { pid, first: Date.now(), queries: [] };
  // 화면 정보는 비어 있는 칸만 채운다(검색 화면에서 읽은 값이 우선)
  Object.entries(extra).forEach(([k, v]) => { if (v != null && v !== "" && (o[k] == null || o[k] === "")) o[k] = v; });
  Object.assign(o, { ex, seen: Date.now() });
  c[pid] = o;
  put(c);
  return Object.keys(c).length;
}

export const listCollect = () => Object.values(all());
export function removeCollect(pids) {
  const c = all();
  (pids || []).forEach((p) => delete c[p]);
  put(c);
  return Object.keys(c).length;
}
export const countCollect = () => Object.keys(all()).length;
