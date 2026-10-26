// 키워드 검색 → 그 키워드 상품들의 실지표(판매가·28일 판매량·판매액·조회수·전환율)
// Wing 상품 매칭 검색에 키워드를 넣어 요청 1번에 여러 상품을 받는다(로켓그로스 확장 "쿠팡 지표 보기"와 같은 경로).
// 정확한 지표 조회와 같은 속도 제한·하루 예산을 함께 쓰고, 같은 키워드는 7일 동안 저장된 결과를 재사용한다.
import { store } from "./store.js";
import { wingShip, runInWing, classify, gate, mark, markDaily, markBlocked, sleep, MIN_GAP, num } from "./exact.js";

const FRESH = 7 * 24 * 60 * 60 * 1000;

const first = (o, keys) => {
  for (const k of keys) {
    const v = k.includes(".") ? k.split(".").reduce((a, p) => a?.[p], o) : o?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
};
function walk(node, out, depth) {
  if (!node || depth > 12 || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x) => walk(x, out, depth + 1)); return out; }
  const hasId = node.productId != null || node.coupangProductId != null || node.vendorItemId != null;
  if (hasId && (node.pvLast28Day != null || node.salesLast28d != null || node.productName != null)) out.push(node);
  Object.values(node).forEach((v) => walk(v, out, depth + 1));
  return out;
}

// 응답에서 상품 목록 뽑기 (wing-trend-helper/kw-core.js parseKeywordResult와 같은 규칙)
export function parseItems(data, startOrder = 0) {
  const seen = new Set(), items = [], nodes = walk(data, [], 0);
  for (const x of nodes) {
    const pid = first(x, ["productId", "coupangProductId"]);
    const k = String(pid ?? x.vendorItemId);
    if (seen.has(k)) continue;
    seen.add(k);
    const views = num(x.pvLast28Day), sales = num(x.salesLast28d);
    const price = num(first(x, ["salePrice", "salesPrice.amount", "salesPrice", "price", "originalPrice"]));
    items.push({
      order: startOrder + items.length + 1,
      pid: pid != null ? String(pid) : null, vid: x.vendorItemId != null ? String(x.vendorItemId) : null, iid: first(x, ["itemId", "productItemId"]),
      name: String(first(x, ["productName", "itemName", "name"]) || ""), brand: String(first(x, ["brandName", "brand"]) || ""),
      price, reviews: num(first(x, ["ratingCount", "reviewCount", "productReviewCount", "reviewCnt"])),
      rating: num(first(x, ["rating", "ratingAverage", "averageRating"])),
      img: String(first(x, ["imagePath", "image", "imageUrl", "thumbnailUrl", "representativeImageUrl", "productImage"]) || ""),
      ex: views != null || sales != null ? { ts: Date.now(), views, sales, price, ship: wingShip(x) } : null,
    });
  }
  return { items, raw: nodes.length, fields: nodes[0] ? Object.keys(nodes[0]).slice(0, 50) : [] }; // raw = 같은 상품 합치기 전 Wing이 준 개수(키워드마다 상품 수가 다른 원인 확인용)
}

// keyword: 검색어, pages: 1~3, wc: 로그인된 Wing webContents, log(cls, text)
// saved: 🕘 최근 검색에서 다시 열기 — 저장된 결과가 있으면 기간과 상관없이 그대로(Wing 요청 없음, 하루 예산 사용 안 함)
export async function searchKeyword(keyword, pages, wc, log, force = false, saved = false) {
  const kw = String(keyword || "").trim();
  if (!kw) return { error: "키워드를 입력해 주세요." };
  const cache = store.get("kwCache") || {};
  const hit = cache[kw];
  if (saved && hit && !force) {
    log("dim", `  '${kw}' 저장된 결과 열기 (${new Date(hit.ts).toLocaleString("ko-KR")}) — Wing 요청 없음`);
    return { ...hit, cached: true };
  }
  if (!force && hit && Date.now() - hit.ts < FRESH && hit.pages >= pages) {
    log("dim", `  '${kw}' 최근 검색 결과 재사용 (${new Date(hit.ts).toLocaleString("ko-KR")}) — 하루 예산 사용 안 함`);
    return { ...hit, cached: true };
  }
  const all = [];
  let fields = [], raw = 0;
  for (let p = 0; p < pages; p++) {
    const g = gate();
    if (g) return { error: `${g.reason} — ${new Date(g.until).toLocaleString("ko-KR")} 이후 다시 시도하세요.`, partial: all };
    const wait = Math.max(0, MIN_GAP - (Date.now() - ((store.get("limit") || {}).last || 0)));
    if (wait) await sleep(wait);
    mark();
    log("sys", `↗ Wing 상품 매칭 검색 '${kw}' ${p + 1}페이지`);
    const r = classify(await runInWing(wc, kw, p));
    if (r.dailyLimit) { markDaily(); return { error: "오늘 검색 한도 초과 — 24시간 뒤 다시 시도하세요." }; }
    if (r.blocked) { markBlocked(); return { error: `${r.error} — 60분간 정지합니다.` }; }
    if (r.auth) return { error: "Wing 로그인이 필요합니다. 왼쪽 Wing 탭에서 로그인한 뒤 다시 검색하세요." };
    if (r.stuck) return { error: r.error };
    if (!r.ok) return { error: r.error || "응답 오류" };
    const parsed = parseItems(r.data, all.length);
    raw += parsed.raw;
    if (!fields.length) fields = parsed.fields;
    const fresh = parsed.items.filter((it) => !all.some((a) => a.pid === it.pid));
    all.push(...fresh);
    log("go", `✔ ${p + 1}페이지 · 상품 ${parsed.items.length}개 (Wing 원본 ${parsed.raw}개 · 지표 있음 ${parsed.items.filter((it) => it.ex).length}개)`);
    if (!parsed.items.length) break;
  }
  // 받은 지표는 정확한 지표 캐시에도 넣어 다른 화면(카테고리 카드)에서도 재사용
  all.forEach((it) => { if (it.ex) store.putExact(`${it.pid}:${it.vid ?? ""}`, it.ex); });
  const res = { keyword: kw, ts: Date.now(), pages, items: all, raw, fields };
  cache[kw] = res;
  const keys = Object.keys(cache);
  if (keys.length > 300) keys.sort((a, b) => cache[a].ts - cache[b].ts).slice(0, keys.length - 300).forEach((k) => delete cache[k]);
  store.set("kwCache", cache);
  return res;
}
