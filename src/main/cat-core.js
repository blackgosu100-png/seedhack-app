// 📂 리스트업 카테고리 자동 찾기 — 쿠팡에서 실제로 받은 분류만 쓴다(네이버 분류·임의 추측 금지).
//  ① 카테고리 진단 때 Wing이 준 상품별 분류(가장 정확)  ② Wing 상품 매칭 응답의 분류(있을 때)
//  ③ Wing 카테고리 목록에서 키워드·상품명과 이름이 같은 분류(추정 — 화면에 "추정"으로 표시)
// 순수 함수만 둔다(시험 가능). 저장소는 main.js가 넘겨준다.

const clean = (p) => String(p || "").replace(/^ROOT>/, "").split(">").map((s) => s.trim()).filter(Boolean).join(">");
const norm = (s) => String(s || "").replace(/[\s·,()\[\]]/g, "").toLowerCase();

// 쿠팡 분류 경로 → 리스트업 카테고리 칸의 선택지(로켓그로스 요금표 묶음). 선택지에 없는 대분류(테마관·여행 등)는 ""
export function rgCat(path, cats = []) {
  const seg = clean(path).split(">"), top = seg[0] || "";
  if (!top) return "";
  if (top === "뷰티") {
    const skin = cats.find((c) => /^뷰티\s*>\s*스킨/.test(c)), etc = cats.find((c) => /^뷰티\(/.test(c));
    return (seg[1] === "스킨" && skin) || etc || skin || "";
  }
  return cats.includes(top) ? top : "";
}

// Wing 상품 매칭 응답의 상품 하나에서 분류 경로 찾기 — 필드 이름이 바뀌어도 "A>B>C" 꼴 글이면 읽는다
export function catOfWingItem(x) {
  const hit = (v) => (typeof v === "string" && />/.test(v) && v.length < 200 ? clean(v) : "");
  const info = x?.displayCategoryInfo ?? x?.displayCategoryInfos; // 상품 매칭 응답 = displayCategoryInfo, 인기상품 응답 = displayCategoryInfos
  const direct = hit((Array.isArray(info) ? info[0] : info)?.categoryHierarchy) || hit(x?.categoryHierarchy);
  if (direct) return direct;
  for (const [k, v] of Object.entries(x || {})) {
    if (!/categor/i.test(k)) continue;
    if (hit(v)) return hit(v);
    for (const o of Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []) {
      for (const [k2, v2] of Object.entries(o || {})) if (/hierarch|path|name/i.test(k2) && hit(v2)) return hit(v2);
    }
  }
  return "";
}

// 분류 경로 글이 없을 때: 분류 번호들("#123,456") — 카테고리 목록의 번호로 경로를 찾는다
export function codesOfWingItem(x) {
  const out = new Set();
  const walk = (v, d) => {
    if (v == null || d > 3) return;
    if (Array.isArray(v)) return v.forEach((o) => walk(o, d + 1));
    if (typeof v === "object") return Object.entries(v).forEach(([k, o]) => (typeof o === "object" ? walk(o, d + 1) : /code|id$/i.test(k) && /^\d{3,}$/.test(String(o)) && out.add(String(o))));
  };
  walk(x?.displayCategoryInfo ?? x?.displayCategoryInfos, 0);
  return out.size ? "#" + [...out].slice(0, 8).join(",") : "";
}
// "#123,456" → 목록에 있는 것 중 가장 깊은 분류 경로
export function pathOfCodes(v, byCode) {
  if (!String(v || "").startsWith("#") || !byCode?.size) return "";
  return String(v).slice(1).split(",").map((c) => byCode.get(c)).filter(Boolean).sort((a, b) => b.split(">").length - a.split(">").length)[0] || "";
}

// 카테고리 목록 → 이름 찾기표. "담요/이불"처럼 /로 묶인 이름은 각각으로도 찾는다
export function buildIndex(nodes = []) {
  const idx = new Map();
  const put = (k, v) => { if (k.length < 2) return; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(v); };
  for (const n of nodes) {
    const full = norm(n.name), e = { path: clean(n.path), depth: n.depth || clean(n.path).split(">").length, whole: true };
    put(full, e);
    if (n.name.includes("/")) for (const a of n.name.split("/")) { const k = norm(a); if (k !== full) put(k, { ...e, whole: false }); }
  }
  return idx;
}

// 이름이 같은 분류 후보 중 하나 고르기: 선택지에 있는 대분류만 · 이름이 통째로 같은 것 우선 · 얕은 분류 우선
function pick(list, cats) {
  const ok = (list || []).map((e) => ({ ...e, cat: rgCat(e.path, cats) })).filter((e) => e.cat);
  if (!ok.length) return null;
  ok.sort((a, b) => (b.whole - a.whole) || (a.depth - b.depth));
  return { ...ok[0], many: new Set(ok.map((e) => e.cat)).size > 1 };
}

// 키워드(통째) → 상품명(붙은 낱말 3·2개, 긴 것부터)으로 카테고리 목록에서 찾기
export function guessFromTree(idx, { keyword, name }, cats) {
  if (!idx?.size) return null;
  const kw = norm(String(keyword || "").replace(/^📂\s*/, ""));
  const k = kw && pick(idx.get(kw), cats);
  if (k) return { path: k.path, cat: k.cat, how: `키워드 "${String(keyword).replace(/^📂\s*/, "")}"와 이름이 같은 쿠팡 분류${k.many ? " (같은 이름이 여러 대분류에 있어 가장 가까운 것)" : ""}` };
  // 상품명: 붙은 낱말 3·2개가 분류 이름과 통째로 같을 때만("빨래 건조대"). 낱말 하나("남성용"·"드라이기")는 엉뚱한 분류에 걸려서 쓰지 않는다
  const words = String(name || "").split(/[\s,]+/).filter(Boolean).slice(0, 14);
  for (let len = 3; len >= 2; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const p = pick((idx.get(norm(words.slice(i, i + len).join(""))) || []).filter((e) => e.whole), cats);
      if (p && !p.many) return { path: p.path, cat: p.cat, how: `상품명의 "${words.slice(i, i + len).join(" ")}"와 이름이 같은 쿠팡 분류` };
    }
  }
  return null;
}

// 한 행의 카테고리 찾기. src: { byPid: Map(pid→경로), bySnapName: Map(진단 이름→경로), wingCat: (pid)=>경로, idx }
export function findCat(row, src, cats) {
  const pid = row.pid != null ? String(row.pid) : "";
  const sure = (path, how) => { const cat = rgCat(path, cats); return cat ? { cat, path: clean(path), sure: true, how } : null; };
  const a = pid && src.byPid?.get(pid);
  if (a) { const r = sure(a, "Wing 카테고리 진단에서 받은 이 상품의 쿠팡 분류"); if (r) return r; }
  const b = pid && src.wingCat?.(pid);
  if (b) { const r = sure(b, "Wing 상품 매칭에서 받은 이 상품의 쿠팡 분류"); if (r) return r; }
  const kw = String(row.keyword || "");
  if (kw.startsWith("📂")) {
    const c = src.bySnapName?.get(norm(kw.replace(/^📂\s*/, "")));
    if (c) { const r = sure(c, "이 상품을 담은 쿠팡 카테고리"); if (r) return r; }
  }
  const g = guessFromTree(src.idx, row, cats);
  return g ? { cat: g.cat, path: g.path, sure: false, how: g.how } : null;
}

export const _t = { clean, norm };
