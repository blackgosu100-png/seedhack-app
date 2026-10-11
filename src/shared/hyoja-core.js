// 🏆 효자상품 정리 — Wing 키워드 검색 결과(상품 여러 개의 28일 판매량)를 "키워드 월매출" 카드 숫자로 바꾼다.
// 순수 함수(네트워크·파일 없음). 판정은 내지 않고, 숫자를 부풀리는 상품만 빼고 근거를 남긴다.
//  · 검색어와 다른 상품: 검색어 글자 쌍(2글자)이 상품명에 40%도 없는 상품(레오파드에코백에 섞인 "래빗에코백", 접이식장바구니의 "쇼핑카트")
//    — 검색어가 5글자 이상이고, 검색어 표현을 거의 그대로 쓰는 상품이 3개 이상일 때만 거른다.
//      다른 말로 파는 시장(굽은등교정기 → "자세 밴드")이나 짧은 검색어(채칼 → "슬라이서")는 거르지 않음
//  · 가격대로는 거르지 않는다: 실데이터에서 750원 장바구니·8,610원 호피 에코백처럼 진짜 같은 상품이 빠졌음(2026-10-11)
//  · 유명 브랜드 상품(famous: 소문자 브랜드 이름 Set, 메인이 키워드 DB로 판별)은 "틈"에서 뺀다 — 이름값으로 팔려서 진입 증거가 못 됨
//  월매출 = 남은 상품들의 28일 판매량 × 판매가 합(화면엔 "최근 28일 기준"으로 표시)

export const GAP_REVIEWS = 300; // 리뷰 이 개수 미만인데 팔리는 상품 = "틈"(새로 들어가도 팔린다는 증거)

// 같은 뜻 다른 표기(실데이터에서 찾은 것만): 호피=레오파드, 검정=블랙, 러닝=런닝, 꽃이=꽂이, 이어링=귀걸이, black/paper
const SAME = [[/호피/g, "레오파드"], [/검정/g, "블랙"], [/black/g, "블랙"], [/paper/g, "페이퍼"], [/러닝/g, "런닝"], [/꽃이/g, "꽂이"], [/이어링/g, "귀걸이"]];
const norm = (s) => SAME.reduce((t, [a, b]) => t.replace(a, b), String(s || "").toLowerCase()).replace(/[^0-9a-z가-힣]/g, "");
const grams = (s) => { const t = norm(s), g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
// 검색어 글자 쌍 중 상품명에 들어 있는 비율(0~1)
export function cover(keyword, name) {
  const g = grams(keyword); if (!g.size) return 1;
  const n = norm(name); let hit = 0; for (const x of g) if (n.includes(x)) hit++;
  return hit / g.size;
}
// 판매량 가중 중앙 가격
export function wMedianPrice(list) {
  const v = list.filter((x) => x.price > 0 && x.sales > 0).sort((a, b) => a.price - b.price);
  const tot = v.reduce((t, x) => t + x.sales, 0); let acc = 0;
  for (const x of v) { acc += x.sales; if (acc >= tot / 2) return x.price; }
  return v.length ? v[v.length - 1].price : 0;
}

// items: [{ name, brand, price, reviews, sales, img, pid, vid }] → { n, rev, sales, price(판매량 가중 중앙가), top, gap, top1Share, brandShare, brandTop, medical, drop:[{...item, why}] }
export function summarize(keyword, items, { top = 3, famous = new Set() } = {}) {
  const all = (items || []).filter((x) => x && x.price > 0 && x.sales != null);
  const drop = [];
  const strong = all.filter((x) => cover(keyword, x.name) >= 0.8).length;
  const keep = all.filter((x) => {
    if (norm(keyword).length >= 5 && strong >= 3 && cover(keyword, x.name) < 0.4) { drop.push({ ...x, why: "검색어와 다른 상품" }); return false; }
    return true;
  }).map((x) => ({ ...x, rev: x.sales * x.price, famous: famous.has(String(x.brand || "").trim().toLowerCase()) })).sort((a, b) => b.rev - a.rev);
  const rev = keep.reduce((t, x) => t + x.rev, 0), sales = keep.reduce((t, x) => t + x.sales, 0);
  const gaps = keep.filter((x) => (x.reviews ?? 0) < GAP_REVIEWS && x.sales > 0 && !x.famous);
  const brandRev = keep.filter((x) => x.famous).reduce((t, x) => t + x.rev, 0);
  const brandTop = [...new Set(keep.filter((x) => x.famous).map((x) => x.brand))].slice(0, 2);
  const gap = gaps.length ? gaps.reduce((a, b) => (b.sales > a.sales ? b : a)) : null;
  const medical = keep.slice(0, top).some((x) => /의료기기/.test(x.name));
  return { n: keep.length, rev, sales, price: wMedianPrice(keep), top: keep.slice(0, top), gap, top1Share: rev ? keep[0].rev / rev : 0, brandShare: rev ? brandRev / rev : 0, brandTop, gapBrandOnly: !gap && keep.some((x) => x.famous && (x.reviews ?? 0) < GAP_REVIEWS && x.sales > 0), medical, drop };
}
