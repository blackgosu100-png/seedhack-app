// 🎯 진입 추천 — 원가 입력 없이 "얼마에 팔면 되고, 1688에서 얼마 이하로 사 오면 되는지"를 거꾸로 계산한다.
//  · 추천 판매가: 경쟁사 가격대별 "체감 할인 폭"(1만 미만 300~500원 · 1~3만 1,000~2,000원 · 3~10만 4~6% · 10만+ 3~5%)
//    → 가격 경계(1만 미만은 천원, 그 위는 만원 단위)를 조금만 더 내려 넘을 수 있으면 넘고(10,500 → 9,900, 단 8% 이내),
//    아니면 쿠팡에서 흔한 끝자리(…900 / …500, 10만+는 천원 단위)로 맞춘다.
//  · 허용 소싱가(위안) = (추천가 × (1 − 수수료 − 광고비 − 목표 마진) − 물류비) ÷ 원가 계수
//  · 같은 검색어 가격 분포: 판매량 가중 25~75% 구간 = "잘 팔리는 가격대", 판매 중앙값 이상 상품 중 최저가 = "가장 싼 강자"
(() => {
  const E = {
    cfg: { fee: 0.1188, ad: 0.1, margin: 0.2, logi: 2200, fx: 300 }, // 물류 2,200원 = 극소형 가정(크기를 알면 리스트업에서 정확히)

    // 정확히 10,000원은 아래 구간(9,500원)으로 본다 · 어느 구간이든 8%를 넘게 깎지 않는다(12,900 → 11,900)
    cutRange(p) {
      const q = p - 1;
      const [lo, hi] = q < 10000 ? [300, 500] : q < 30000 ? [1000, 2000] : q < 100000 ? [p * 0.04, p * 0.06] : [p * 0.03, p * 0.05];
      const h = Math.min(hi, p * 0.08);
      return [Math.min(lo, h), h];
    },
    nice(n, p) {
      if (p < 100000) return n % 1000 === 900 || n % 1000 === 500;
      return n % 10000 === 9000 || n % 10000 === 5000;
    },
    // 경쟁사 가격 → { price, cut, crossed }
    undercut(p) {
      if (!(p > 0)) return null;
      const [lo, hi] = E.cutRange(p);
      const B = p <= 10000 ? 1000 : 10000;
      const bnd = Math.floor((p - 1) / B) * B;
      const cross = bnd - (p < 100000 ? 100 : 1000);
      if (cross > 0 && p - cross >= lo * 0.5 && p - cross <= Math.min(hi * 1.5, p * 0.08)) return { price: cross, cut: p - cross, crossed: true };
      const mid = p - (lo + hi) / 2;
      let best = null;
      for (let n = Math.ceil((p - hi) / 100) * 100; n <= p - lo; n += 100) {
        if (E.nice(n, p) && (best == null || Math.abs(n - mid) < Math.abs(best - mid))) best = n;
      }
      if (best == null) best = Math.round(mid / (p < 100000 ? 100 : 1000)) * (p < 100000 ? 100 : 1000);
      if (best <= 0 || best >= p) return { price: p, cut: 0, crossed: false };
      return { price: best, cut: p - best, crossed: false };
    },
    allowYuan(price, o = {}) {
      const c = { ...E.cfg, ...o };
      if (!(price > 0)) return null;
      return (price * (1 - c.fee - c.ad - c.margin) - c.logi) / c.fx;
    },
    // 상품 하나: 경쟁사 가격 → 추천가 · 허용 위안
    forItem(p, o) {
      const u = E.undercut(p);
      if (!u) return null;
      return { ...u, comp: p, yuan: E.allowYuan(u.price, o) };
    },
    // 🚦 진입 시그널(원가 없이 검색 단계에서 아는 것만): ① 시장 = 28일 판매 300개+ ② 이길 틈 = 리뷰 300개 미만 또는 전환율이 검색어 중앙값보다 높음
    //   ③ 원가 여유 = 추천가 기준 1688 허용가 ¥10 이상 → 셋 다 GO · 둘 HOLD · 하나 이하 DROP
    //   바로 DROP: 판매 30개 미만(시장 없음) · 리뷰 3,000개+(굳은 강자) · 허용가 ¥3 미만(원가로 못 맞춤)
    SIG: { minSales: 300, gapReviews: 300, minYuan: 10, deadSales: 30, wallReviews: 3000, deadYuan: 3 },
    signal({ sales, reviews, cvr, medCvr, yuan }) {
      const T = E.SIG;
      if (sales == null || yuan == null) return null;
      const rv = reviews ?? 0, why = [];
      if (sales < T.deadSales) return { s: "stop", why: [`28일 판매 ${sales}개 — 시장이 거의 없음`] };
      if (rv >= T.wallReviews) return { s: "stop", why: [`리뷰 ${rv.toLocaleString("ko-KR")}개 — 이미 굳은 강자`] };
      if (yuan < T.deadYuan) return { s: "stop", why: [`1688 허용가 ¥${yuan.toFixed(1)} — 이 가격대로는 원가를 못 맞춤`] };
      const m = sales >= T.minSales, g = rv < T.gapReviews || (cvr != null && medCvr != null && cvr > medCvr), c = yuan >= T.minYuan;
      why.push(m ? `팔리는 시장 (28일 ${sales.toLocaleString("ko-KR")}개)` : `판매 적음 (28일 ${sales}개)`);
      why.push(g ? (rv < T.gapReviews ? `리뷰 ${rv}개 — 아직 자리 안 잡힘` : `전환율이 검색어 평균보다 높음`) : `리뷰 ${rv.toLocaleString("ko-KR")}개 · 전환율 평범`);
      why.push(c ? `1688 ¥${yuan.toFixed(1)} 이하면 OK` : `1688 ¥${yuan.toFixed(1)} 이하로 사야 함 (빠듯)`);
      const n = [m, g, c].filter(Boolean).length;
      return { s: n === 3 ? "go" : n === 2 ? "warn" : "stop", why, ok: [m, g, c] };
    },
    // 같은 검색어 상품들 [{price, sales}] → 잘 팔리는 가격대 · 가장 싼 강자
    market(list) {
      const v = list.filter((x) => x.price > 0 && x.sales > 0).sort((a, b) => a.price - b.price);
      if (v.length < 3) return null;
      const tot = v.reduce((a, x) => a + x.sales, 0);
      const at = (q) => { let s = 0; for (const x of v) { s += x.sales; if (s >= tot * q) return x.price; } return v[v.length - 1].price; };
      const ss = v.map((x) => x.sales).sort((a, b) => a - b);
      const medS = ss[Math.floor((ss.length - 1) / 2)];
      return { lo: at(0.25), hi: at(0.75), strongMin: Math.min(...v.filter((x) => x.sales >= medS).map((x) => x.price)), n: v.length };
    },
  };
  if (typeof window !== "undefined") window.Entry = E;
  if (typeof module !== "undefined") module.exports = E;
})();
