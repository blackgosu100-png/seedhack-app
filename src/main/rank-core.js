// 1688 결과 카드 → 판매자 점수 (순수 로직, Node로 테스트 가능)
// 카드에 보이는 숫자(판매량·재구매율·입점 연차·최소주문·운송비·배지·노출 순위)로 1차 점수를 내고,
// 상품 페이지에서 읽은 "진짜 옵션 가격"(sku-core)이 오면 가격 점수(30점)를 더해 최종 🟢🟡🔴를 낸다.
// 결과 카드의 ¥는 옵션 중 최저가(낚시 가능)라 1차 점수에는 쓰지 않고 참고로만 보여준다.

import { normKoCard } from "./ko-norm.js";

export const DEFAULT_WEIGHTS = {
  price: 30, repeat: 25, sales: 20, years: 10, rank: 10,
  bonus: 5,                    // 랭킹 배지 / 동일상품 대비 저렴 / 7일 무조건 반품 / 1件起批 각각
  moqPenalty: 15, moqExclude: 500, moqPenaltyFrom: 50,
  shipPenalty: 10, shipRatio: 0.5,
  green: 80, yellow: 60,
};

const num = (s) => { const m = String(s || "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };

// 카드 innerText 줄 목록 → 구조화. 1688은 가격을 "¥" "6" ".8" 세 줄로 쪼개 놓는다.
export function parseCard(lines, extra = {}) {
  const t = (Array.isArray(lines) ? lines : String(lines || "").split("\n")).map((s) => s.trim()).filter(Boolean);
  const joined = normKoCard(t.join(" ")); // 1688 한국어판 글자도 같은 규칙으로 읽는다
  const price = (() => { const m = joined.match(/[¥￥]\s*(\d+)(?:\s*\.\s*(\d+))?/); return m ? Number(m[1] + (m[2] ? "." + m[2] : "")) : null; })();
  const salesM = joined.match(/(\d+(?:\.\d+)?)\s*(万)?\+?\s*件(?!\s*起批)/);
  const sales = salesM ? Math.round(Number(salesM[1]) * (salesM[2] ? 10000 : 1)) : null;
  const moq = num((joined.match(/(\d+)\s*件起批/) || [])[1]);
  const repeat = num((joined.match(/回头率\s*(\d+)%/) || [])[1]);
  const years = num((joined.match(/入驻\s*(\d+)\s*年/) || [])[1]);
  const ship = (joined.match(/运费\s*(\d+(?:\.\d+)?)\s*元/) || [])[1];
  const shipping = ship != null ? Number(ship) : /包邮/.test(joined) ? 0 : null;
  const deliveryM = joined.match(/(\d+)天达|(后天|今天|次日|明天)达/);
  const delivery = deliveryM ? (deliveryM[1] ? Number(deliveryM[1]) : deliveryM[2] === "后天" ? 2 : 1) : null;
  const badges = [];
  if (/榜第\s*\d+\s*名|热卖榜|TOP\s*\d/i.test(joined)) badges.push("랭킹");
  if (/比同款低\s*\d+/.test(joined)) badges.push("동일상품 대비 저렴");
  if (/7天无理由/.test(joined)) badges.push("7일 무조건 반품");
  if (/一件代发/.test(joined)) badges.push("1개 대리발송");
  if (/实力|工厂|严选/.test(joined)) badges.push("인증");
  const company = t.length ? t[t.length - 1] : "";
  return { title: t[0] || "", price, sales, moq, repeat, years, shipping, delivery, badges, company, ...extra };
}

const band = (v, steps) => { if (v == null) return 0; for (const [min, pts] of steps) if (v >= min) return pts; return 0; };

// 1차 점수(가격 제외, 최대 70 + 가산). realPrice·allow가 있으면 가격 점수까지.
export function scoreCard(c, { allow = null, realPrice = null, weights = DEFAULT_WEIGHTS, medianPrice = null } = {}) {
  const W = { ...DEFAULT_WEIGHTS, ...weights };
  const parts = {};
  parts.repeat = band(c.repeat, [[60, W.repeat], [50, Math.round(W.repeat * 0.72)], [40, Math.round(W.repeat * 0.4)], [0, Math.round(W.repeat * 0.12)]]);
  parts.sales = band(c.sales, [[10000, W.sales], [3000, Math.round(W.sales * 0.75)], [1000, Math.round(W.sales * 0.5)], [300, Math.round(W.sales * 0.25)]]);
  parts.years = band(c.years, [[5, W.years], [3, Math.round(W.years * 0.6)], [1, Math.round(W.years * 0.3)]]);
  parts.rank = c.rank == null ? 0 : c.rank <= 5 ? W.rank : c.rank <= 15 ? Math.round(W.rank * 0.6) : c.rank <= 30 ? Math.round(W.rank * 0.3) : 0;
  parts.bonus = Math.min(W.bonus * 2, (c.badges || []).filter((b) => b !== "인증").length * W.bonus + (c.moq != null && c.moq <= 1 ? W.bonus : 0));
  let penalty = 0; const notes = [];
  if (c.moq != null && c.moq >= W.moqExclude) return { score: 0, parts, verdict: "exclude", notes: [`최소주문 ${c.moq}개 — 소량 테스트 불가`], excluded: true };
  if (c.moq != null && c.moq >= W.moqPenaltyFrom) { penalty += W.moqPenalty; notes.push(`최소주문 ${c.moq}개`); }
  // 운송비 감점은 진짜 옵션 가격을 안 뒤에만 (카드의 ¥는 낚시 최저가일 수 있어 기준으로 못 씀)
  if (c.shipping != null && realPrice && c.shipping > realPrice * W.shipRatio) { penalty += W.shipPenalty; notes.push(`운송비 ¥${c.shipping}가 상품가 대비 큼`); }
  if (c.sales == null && c.repeat == null) return { score: 0, parts, verdict: "exclude", notes: ["판매량·재구매율 없음"], excluded: true };

  // 가격 점수: 진짜 옵션 가격 vs 허용 소싱가. 허용가가 없으면 결과 목록 중앙가 기준.
  let priceKnown = false, priceOk = null;
  const ref = allow ?? medianPrice;
  if (realPrice != null && ref) {
    priceKnown = true;
    const r = realPrice / ref;
    parts.price = r <= 0.7 ? W.price : r <= 0.85 ? Math.round(W.price * 0.73) : r <= 1 ? Math.round(W.price * 0.4) : 0;
    priceOk = allow != null ? realPrice <= allow : r <= 1;
    notes.push(allow != null ? `옵션가 ¥${realPrice} = 허용 ¥${allow.toFixed(1)}의 ${Math.round(r * 100)}%` : `옵션가 ¥${realPrice} (목록 중앙가 ¥${medianPrice} 대비 ${Math.round(r * 100)}%)`);
  } else parts.price = 0;

  const base = parts.repeat + parts.sales + parts.years + parts.rank + parts.bonus - penalty;
  const score = Math.max(0, base + parts.price);
  const max = priceKnown ? 100 : 100 - W.price;
  // 판정: 가격 확인 전엔 "후보/보류"만, 확인 후 🟢🟡🔴
  let verdict;
  if (!priceKnown) verdict = base >= W.yellow - W.price * 0.4 ? "candidate" : "low";
  else verdict = score >= W.green && priceOk ? "green" : score >= W.yellow || (score >= W.green && !priceOk) ? "yellow" : "red";
  return { score, max, parts, penalty, verdict, notes, priceKnown, priceOk };
}

// ---- 같은 상품인지: 쿠팡 상품명·대표키워드 vs 1688 카드 제목 (한글 두 글자 조각 겹침) ----
// 1688 이미지 검색은 사진 속 물체 하나(예: 빨래건조대의 기둥)만 잘라 찾기도 해서 엉뚱한 상품(TV 거치대)이 섞인다.
// 판매량·재구매율 점수만 보면 그런 상품이 위로 올라오므로, 제목이 한국어(1688 한국어판)일 때 겹침이 낮은 카드는 후보에서 뺀다.
const grams = (s) => { const out = new Set(); for (const w of String(s || "").replace(/\s+/g, "").match(/[가-힣]{2,}/g) || []) for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2)); return out; };
export function relevance(title, { name = "", keyword = "" } = {}) {
  const T = grams(title);
  if (T.size < 2) return null; // 제목이 중국어 등 → 판단 못 함
  const hit = (S) => (S.size ? [...S].filter((g) => T.has(g)).length / S.size : null);
  const k = hit(grams(keyword)), n = hit(grams(name));
  if (k == null && n == null) return null;
  return k == null ? n : n == null ? k : Math.max(k, 0.6 * k + 0.4 * n);
}
// rel 목록 → 통과 기준. 한국어 제목이 절반 미만이거나 기준을 넘는 카드가 너무 적으면 거르지 않는다(규칙이 틀렸을 때 다 지우는 것보다 낫다)
export function relevanceGate(rels) {
  const known = rels.filter((r) => r != null);
  if (known.length < Math.max(5, rels.length / 2)) return null;
  const best = Math.max(...known);
  if (best < 0.2) return null;
  const cut = Math.max(0.15, Math.min(0.3, best * 0.4));
  return known.filter((r) => r >= cut).length >= 3 ? cut : null;
}

// 쿠팡 상품명에서 읽는 "핵심 특징"(소재·색·형태·쓰는 곳) → 1688 제목(중국어 원문·한글 번역)에서 찾을 낱말
const FEATS = [
  ["투명", /투명|클리어/, /透明|亚克力|压克力|水晶|투명|아크릴/, "color"], ["아크릴", /아크릴/, /亚克力|压克力|아크릴/, "mat"],
  ["블랙", /블랙|검정|검은/, /黑|블랙|검정|검은/, "color"], ["화이트", /화이트|흰색|하얀/, /白|화이트|흰/, "color"],
  ["스테인리스", /스테인|스텐/, /不锈钢|스테인/, "mat"], ["대나무", /대나무|뱀부/, /竹|대나무/, "mat"], ["원목", /원목|우드|나무/, /实木|木质|木|원목|나무/, "mat"],
  ["실리콘", /실리콘/, /硅胶|실리콘/, "mat"], ["유리", /유리|글라스/, /玻璃|유리/, "mat"], ["철제", /철제|스틸|메탈/, /铁|金属|碳钢|철제|금속/, "mat"], ["플라스틱", /플라스틱|PP\b/i, /塑料|PP|플라스틱/, "mat"],
  ["접이식", /접이식|폴더블|폴딩/, /折叠|접이|접는/, "form"], ["길이조절", /길이\s*조절|확장형|신축/, /伸缩|可调|신축|조절/, "form"], ["무타공", /무타공/, /免打孔|无痕|무타공|펀칭.*없/, "form"],
  ["욕조", /욕조/, /浴缸|泡澡|욕조/, "place"], ["욕실", /욕실|화장실/, /浴室|卫生间|욕실|화장실/, "place"], ["주방", /주방|부엌|싱크대/, /厨房|주방|부엌/, "place"], ["냉장고", /냉장고/, /冰箱|냉장고/, "place"],
  ["차량", /차량|자동차/, /车载|汽车|차량|자동차/, "place"], ["벽걸이", /벽걸이/, /壁挂|挂墙|벽걸이/, "form"],
];
export function featuresOf(name) { return FEATS.filter(([, k]) => k.test(String(name || ""))).map(([ko, , re, group]) => ({ ko, re, group })); }
// 같은 묶음(색·소재)에서 쿠팡과 다른 값이 제목에 있고 쿠팡 값은 없으면 "다른 특징"
function clashOf(feats, title) {
  const out = [];
  for (const g of ["color", "mat"]) {
    const want = feats.filter((f) => f.group === g); if (!want.length || want.some((f) => f.re.test(title))) continue;
    const other = FEATS.filter(([ko, , , grp]) => grp === g && !want.some((f) => f.ko === ko)).filter(([, , re]) => re.test(title)).map(([ko]) => ko);
    if (other.length) out.push(other[0]);
  }
  return out;
}
export function rankCards(cards, opts = {}) {
  const prices = cards.map((c) => c.price).filter((p) => p > 0).sort((a, b) => a - b);
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const rels = cards.map((c) => relevance(c.titleKo || c.title, opts.target || {})); // titleKo: 중국어 제목을 번역한 것
  const cut = opts.target ? relevanceGate(rels) : null;
  const scored = cards.map((c, i) => {
    if (cut != null && (rels[i] == null || rels[i] < cut)) return { ...c, rel: rels[i], score: 0, parts: {}, verdict: "exclude", notes: ["다른 상품 의심 — 쿠팡 상품명과 제목이 거의 안 겹침"], excluded: true, offTarget: true };
    return { ...c, rel: rels[i], ...scoreCard(c, { ...opts, medianPrice, realPrice: c.realPrice ?? null }) };
  });
  // ── 순서 원칙(2026-11-18 대표님 지적): "같은 상품이 먼저, 판매자 점수는 그다음" ──
  // 예전엔 판매량·재구매율 점수만으로 줄 세워, 1688이 사진과 가장 닮았다고 맨 위에 준 상품(욕조 트레이)을 제치고
  // 많이 팔리는 다른 상품(아크릴 소품 정리함)이 추천 1번이 됐다. → ① 1688 사진 유사 순서 위쪽(SIM_TOP)을 먼저 본다
  // ② 그 안에서 쿠팡 상품명의 핵심 특징(투명·아크릴·접이식…)과 종류 낱말(욕조…)이 제목에 맞는 것을 앞에 ③ 그다음이 판매자 점수.
  const SIM_TOP = 12;
  const feats = featuresOf(`${opts.target?.name || ""} ${opts.target?.keyword || ""}`);
  for (const x of scored) {
    if (x.excluded) continue;
    const t = `${x.title || ""} ${x.titleKo || ""}`;
    x.featHit = feats.filter((f) => f.re.test(t)).map((f) => f.ko);
    x.featMiss = feats.filter((f) => !f.re.test(t)).map((f) => f.ko);
    x.featClash = clashOf(feats, t);
    x.simTier = (x.rank ?? 99) <= SIM_TOP ? 0 : (x.rank ?? 99) <= SIM_TOP * 2.5 ? 1 : 2;
    // 맞는 특징 가중치: 쓰는 곳·종류(욕조) 3 > 소재 2 > 색 1.5 > 형태 1 · 반대 특징(투명인데 검정·대나무)은 −3
    const W = { place: 3, mat: 2, color: 1.5, form: 1 };
    x.fit = feats.filter((f) => f.re.test(t)).reduce((a, f) => a + W[f.group], 0) - x.featClash.length * 3;
    if (x.featClash.length) (x.notes ||= []).push(`쿠팡 상품과 다른 특징: ${x.featClash.join("·")}`);
  }
  const near = (x) => x.score + Math.max(0, 13 - (x.rank ?? 99)) * 2.5; // 특징이 같으면: 판매자 점수 + 사진 유사 순서 가산(1위 +30 … 12위 +2.5)
  // 같은 회사는 가장 앞선 상품 하나만
  const seen = new Set(); const out = [];
  for (const s of scored.filter((x) => !x.excluded).sort((a, b) => a.simTier - b.simTier || b.fit - a.fit || near(b) - near(a) || (a.rank ?? 99) - (b.rank ?? 99))) {
    const key = s.company || s.offerId; if (seen.has(key)) continue; seen.add(key); out.push(s);
  }
  // 사진 검색이 빗나갔는지: 제목을 읽을 수 있는 후보가 충분한데 쿠팡 상품명과 닮은 게 하나도 없으면(가장 닮은 것도 20% 미만) 결과 전체가 엉뚱한 것
  const known = rels.filter((r) => r != null), bestRel = known.length ? Math.max(...known) : null;
  const mismatch = !!opts.target && known.length >= 8 && bestRel != null && bestRel < 0.2;
  return { ranked: out, excluded: scored.filter((x) => x.excluded), medianPrice, bestRel, mismatch };
}

export const VERDICT_KO = { green: "🟢 샘플 후보", yellow: "🟡 비교 대상", red: "🔴 보류", candidate: "⚪ 후보 (가격 확인 전)", low: "· 낮음", exclude: "✕ 제외" };

// 원가로 쓸 1688 가격 — list: 추천 순서대로 [{ price, real(상품 페이지에서 옵션가 확인), sure(옵션이 확실) }]
//  ① 1순위 옵션가가 확실하면 그 값 ② 애매하면 확인된 후보들의 중간값(추정) ③ 확인 전이면 1순위 목록가(추정)
//  1순위가 확인된 다른 후보들 중간값보다 30% 넘게 싸면 경고(낚시 옵션·다른 품질 의심)
export function decideCost(list) {
  const c = (list || []).filter((x) => x && x.price > 0);
  if (!c.length) return null;
  const known = c.filter((x) => x.real).map((x) => x.price).sort((a, b) => a - b);
  const med = known.length ? (known.length % 2 ? known[(known.length - 1) / 2] : (known[known.length / 2 - 1] + known[known.length / 2]) / 2) : null;
  const first = c[0];
  let out;
  if (first.real && first.sure) out = { yuan: first.price, sure: true, how: "1순위 확인된 옵션가" };
  else if (med != null) out = { yuan: med, sure: false, how: `확인된 ${known.length}개 중간값${first.real ? " (1순위 옵션이 애매)" : " (1순위 확인 전)"}` };
  else out = { yuan: first.price, sure: false, how: "목록 최저가 · 옵션 확인 전" };
  const others = c.slice(1).filter((x) => x.real).map((x) => x.price).sort((a, b) => a - b);
  const oMed = others.length ? others[Math.floor((others.length - 1) / 2)] : null;
  if (first.real && oMed != null && first.price < oMed * 0.7) out.warn = `1순위 ¥${first.price}가 다른 후보(¥${oMed})보다 ${Math.round((1 - first.price / oMed) * 100)}% 싸요 — 옵션·품질 확인`;
  if (known.length >= 2) out.range = [known[0], known[known.length - 1]];
  return out;
}
