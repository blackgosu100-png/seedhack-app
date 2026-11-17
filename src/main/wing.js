// Wing 화면이 받아오는 "쿠팡 트렌드 > 인기상품 검색" 응답을 읽어 스냅샷으로 저장한다.
// 페이지에 코드를 심지 않고, 브라우저 내장 개발자 프로토콜(CDP)의 네트워크 이벤트로 응답 본문만 읽는다.
// 추가 요청은 보내지 않는다(사람이 Wing에서 카테고리를 고를 때 Wing이 스스로 받는 응답만 사용).
import { store } from "./store.js";

const WATCH = /\/tenants\/rfm-ss\/api\/(trends\/search|cms\/categories$)/;
const IS_TREE = /\/cms\/categories$/;

// 카테고리 트리(약 18MB)를 대시보드 선택용으로 평탄화: {code,name,path,depth,parent,leaf}
export function flattenTree(root) {
  const out = [];
  const walk = (node, path, depth, parent) => {
    const dto = node?.displayItemCategoryDto || {};
    const isRoot = dto.name === "ROOT" || depth === 0;
    const kids = (node?.child || []).filter((c) => (c?.displayItemCategoryDto?.status || "ACTIVE") === "ACTIVE");
    const p = isRoot ? [] : [...path, dto.name];
    if (!isRoot && dto.displayItemCategoryCode != null) out.push({ code: String(dto.displayItemCategoryCode), name: dto.name, path: p.join(">"), depth, parent, leaf: kids.length === 0 });
    kids.forEach((c) => walk(c, p, depth + 1, isRoot ? null : String(dto.displayItemCategoryCode)));
  };
  (Array.isArray(root) ? root : [root]).forEach((r) => walk(r, [], Array.isArray(root) ? 1 : 0, null));
  return out;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function parseSearchBody(raw) {
  try {
    const sc = JSON.parse(raw)?.searchCondition || {};
    const filters = sc.filter?.INTERNAL_CATEGORY?.generalFilters || [];
    const code = filters.find((f) => f.field === "INTERNAL_CATEGORY")?.values?.[0] || null;
    return { code: code ? String(code) : null, query: sc.query || "", sort: sc.sort?.[0] || "DEFAULT", start: sc.start || 0 };
  } catch {
    return { code: null, query: "", sort: "DEFAULT", start: 0 };
  }
}

// Wing 확장(wing-trend-helper/background.js normalizeItem)과 같은 필드
function normalizeItem(x, order) {
  return {
    order,
    pid: x.productId ?? null,
    vid: x.vendorItemId ?? null,
    iid: x.itemId ?? null,
    name: x.productName || x.itemName || "",
    brand: x.brandName || "",
    price: x.salesPrice?.amount ?? null,
    rating: x.rating ?? null,
    reviews: x.ratingCount ?? null,
    pvLo: x.lowerPvLast28d == null ? null : Math.max(0, x.lowerPvLast28d),
    pvHi: x.upperPvLast28d ?? null,
    leaf: x.displayCategoryInfos?.[0]?.categoryHierarchy || "",
    img: x.imagePath || "",
  };
}

// 응답 하나를 처리해 저장. 화면에 다시 그릴 스냅샷을 돌려준다(인기상품 응답이 아니면 null).
export function handleResponse(url, postData, bodyText, pageUrl) {
  if (!WATCH.test(url)) return null;
  let data;
  try { data = JSON.parse(bodyText); } catch { return null; }
  if (IS_TREE.test(url)) {
    try { const nodes = flattenTree(data); if (nodes.length) { store.set("cattree", { ts: Date.now(), nodes }); return { tree: nodes.length }; } } catch {}
    return null;
  }
  const items = data?.searchItems;
  if (!Array.isArray(items) || !items.length) return null;
  const { code, query, sort, start } = parseSearchBody(postData);
  const key = `${code ? "c:" + code : "q:" + query}|${sort}`;
  const date = today();
  const prev = store.get("snapshots")[key];
  const merged = new Map(start > 0 && prev?.date === date ? (prev.items || []).map((it) => [it.vid ?? it.pid, it]) : []);
  items.forEach((x, i) => { const it = normalizeItem(x, start + i + 1); merged.set(it.vid ?? it.pid, it); });
  let name = query || code || "검색";
  try { name = new URL(pageUrl).searchParams.get("categoryName") || name; } catch {}
  const leafPath = items[0]?.displayCategoryInfos?.[0]?.categoryHierarchy || "";
  const snap = {
    id: `${key}|${date}`, key, date, ts: Date.now(), code, query, sort, name,
    path: code ? leafPath.replace(/^ROOT>/, "").split(">").slice(0, -1).join(">") : "",
    total: data.totalCount ?? items.length,
    items: [...merged.values()].sort((a, b) => a.order - b.order),
  };
  store.putSnapshot(snap);
  return snap;
}

// webContents에 CDP를 붙여 응답을 감시한다. onSnapshot(snap)은 인기상품을 새로 받을 때마다 호출된다.
// 로그인 과정처럼 다른 주소(xauth.coupang.com 등)로 넘어가면 화면 내부가 새로 만들어지며 연결이 끊길 수 있어
// 끊기면 자동으로 다시 붙이고, 페이지 이동 때마다 연결 상태를 확인한다.
export function watchWing(wc, onSnapshot, onLog) {
  const dbg = wc.debugger;
  const reqs = new Map();
  let warned = false;

  // 🔐 로그인 화면(xauth.coupang.com 등)에서는 감시를 뗀다(2026-11-17) — 처음 로그인 때 휴대폰 인증번호를 넣으면 쿠팡 보안이
  //  "Access Denied"로 막았다. 감시(디버거)가 붙은 브라우저를 자동 프로그램으로 보는 것으로 보고, Wing 화면에서만 붙인다
  const isWing = (u) => /^https:\/\/wing\.coupang\.com\//.test(u || "");
  let onWing = true;
  const attach = (why) => {
    if (wc.isDestroyed() || dbg.isAttached() || !onWing) return;
    try {
      dbg.attach("1.3");
      dbg.sendCommand("Network.enable", { maxTotalBufferSize: 64 * 1024 * 1024, maxResourceBufferSize: 48 * 1024 * 1024 }).catch(() => {}); // 카테고리 트리(약 18MB)도 읽히게
      if (why) onLog?.("dim", `네트워크 감시 다시 연결 (${why})`);
      warned = false;
    } catch (e) {
      if (!warned) onLog?.("stop", `네트워크 감시를 시작하지 못했습니다: ${e.message}`);
      warned = true;
    }
  };

  dbg.on("message", async (_e, method, params) => {
    try {
      if (method === "Network.requestWillBeSent" && WATCH.test(params.request.url)) {
        reqs.set(params.requestId, { url: params.request.url, postData: params.request.postData, has: params.request.hasPostData });
      } else if (method === "Network.loadingFinished" && reqs.has(params.requestId)) {
        const r = reqs.get(params.requestId);
        reqs.delete(params.requestId);
        if (!r.postData && r.has) {
          const pd = await dbg.sendCommand("Network.getRequestPostData", { requestId: params.requestId }).catch(() => null);
          r.postData = pd?.postData;
        }
        const res = await dbg.sendCommand("Network.getResponseBody", { requestId: params.requestId });
        const body = res.base64Encoded ? Buffer.from(res.body, "base64").toString("utf8") : res.body;
        const snap = handleResponse(r.url, r.postData, body, wc.getURL());
        if (snap?.tree) { onLog?.("sys", `▶ 카테고리 목록 ${snap.tree}개 저장 — 대시보드에서 바로 고를 수 있습니다`); onSnapshot(snap); }
        else if (snap) onSnapshot(snap);
      } else if (method === "Network.loadingFailed") {
        reqs.delete(params.requestId);
      }
    } catch (e) {
      onLog?.("dim", `응답 읽기 건너뜀: ${e.message}`);
    }
  });
  dbg.on("detach", (_e, reason) => {
    reqs.clear();
    if (onWing) setTimeout(() => attach(`끊김: ${reason || "화면 전환"}`), 300);
  });
  // 페이지 이동 때마다: Wing 이면 붙이고(응답을 놓치지 않도록 요청 전에), 로그인 화면 등 다른 주소면 뗀다
  const sync = (url) => {
    onWing = isWing(url);
    if (onWing) return attach();
    if (dbg.isAttached()) { try { dbg.detach(); } catch {} }
  };
  wc.on("did-start-navigation", (e, url, _inPlace, isMain) => { const main = e?.isMainFrame ?? isMain; if (main === false) return; sync(e?.url || url); });
  wc.on("did-redirect-navigation", (e, url, _inPlace, isMain) => { const main = e?.isMainFrame ?? isMain; if (main === false) return; sync(e?.url || url); }); // wing → 로그인 화면 넘김(302)
  wc.on("did-navigate", (_e, url) => sync(url));
  wc.on("dom-ready", () => sync(wc.getURL()));
  sync(wc.getURL() || "https://wing.coupang.com/");
}
