// 1688 결과 카드 → 판매자 점수 (순수 로직, Node로 테스트 가능)
// 카드에 보이는 숫자(판매량·재구매율·입점 연차·최소주문·운송비·배지·노출 순위)로 1차 점수를 내고,
// 상품 페이지에서 읽은 "진짜 옵션 가격"(sku-core)이 오면 가격 점수(30점)를 더해 최종 🟢🟡🔴를 낸다.
// 결과 카드의 ¥는 옵션 중 최저가(낚시 가능)라 1차 점수에는 쓰지 않고 참고로만 보여준다.

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
  const joined = t.join(" ");
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

export function rankCards(cards, opts = {}) {
  const prices = cards.map((c) => c.price).filter((p) => p > 0).sort((a, b) => a - b);
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const scored = cards.map((c) => ({ ...c, ...scoreCard(c, { ...opts, medianPrice, realPrice: c.realPrice ?? null }) }));
  // 같은 회사는 가장 점수 높은 상품 하나만
  const seen = new Set(); const out = [];
  for (const s of scored.filter((x) => !x.excluded).sort((a, b) => b.score - a.score || (a.rank ?? 99) - (b.rank ?? 99))) {
    const key = s.company || s.offerId; if (seen.has(key)) continue; seen.add(key); out.push(s);
  }
  return { ranked: out, excluded: scored.filter((x) => x.excluded), medianPrice };
}

export const VERDICT_KO = { green: "🟢 샘플 후보", yellow: "🟡 비교 대상", red: "🔴 보류", candidate: "⚪ 후보 (가격 확인 전)", low: "· 낮음", exclude: "✕ 제외" };
