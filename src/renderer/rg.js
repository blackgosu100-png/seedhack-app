// 🚚 로켓그로스 예상 입출고비·배송비 (단품 1개 기준, VAT 별도) — 요금·사이즈 기준은 코드와 분리된 rg-fees.json(앱 시작 시 GitHub 최신본 확인)
// 사이즈: 세 변의 합(cm)과 무게(kg)를 모두 충족하는 가장 작은 유형(하나라도 넘으면 위 유형). 특대형 초과는 입고 불가.
// 요금: 판매가 구간 → 저가 전용 할인 금액이 있으면 그것, 없으면 프로모션(기간 내), 그다음 기본. 요금표가 없으면 계산하지 않는다(임의 금액 금지).
(() => {
  let C = { sizeRules: [], fees: [], categories: [] };
  const RATE_LABEL = { lowPriceDedicated: "저가 전용 할인", promotion: "프로모션", standard: "기본" };
  const RG = {
    ready: false,
    get config() { return C; },
    async load() {
      try { C = (await window.signal.invoke("rg:config")) || C; } catch {}
      RG.ready = (C.sizeRules || []).length > 0 && (C.fees || []).length > 0;
      return C;
    },
    // "280x200x120", "280*200*120", "280 200 120" 모두 허용 (mm)
    parseDims(s) {
      const v = String(s || "").split(/[x×*,\s/]+/i).map((x) => +x).filter((x) => x > 0);
      return v.length === 3 ? v : null;
    },
    estimate({ category, dims, weight, price }) {
      const d = RG.parseDims(dims);
      if (!d) return { error: "크기 없음" };
      const sumCm = d.reduce((a, b) => a + b, 0) / 10;
      const out = { sumCm: Math.round(sumCm * 10) / 10 };
      if (!RG.ready) return { ...out, error: "요금표 준비 전" };
      const kg = weight === "" || weight == null ? null : +weight / 1000;
      const rule = (C.sizeRules || []).find((r) => sumCm <= r.maxDimensionSumCm && (kg == null || kg <= r.maxWeightKg));
      if (!rule) return { ...out, error: "특대형 초과 · 입고 불가" };
      out.sizeClass = rule.sizeClass;
      if (price == null || !(price > 0)) return { ...out, error: "판매가 필요" };
      const band = (C.fees || []).find((f) => f.sizeClass === rule.sizeClass && price >= f.minPriceWon && (f.maxPriceWonExclusive == null || price < f.maxPriceWonExclusive));
      if (!band) return { ...out, error: "요금 구간 없음" };
      const today = new Date().toISOString().slice(0, 10);
      const promoOk = !C.promotionValidTo || today <= C.promotionValidTo;
      const key = band.lowPriceDedicated ? "lowPriceDedicated" : promoOk && band.promotion ? "promotion" : "standard";
      const r = band[key];
      const covered = (C.coveredCategories || []).includes(category);
      return {
        ...out, rate: key, rateLabel: RATE_LABEL[key], inout: r.inboundOutboundWon, ship: r.shippingWon, total: r.totalWon ?? r.inboundOutboundWon + r.shippingWon,
        noWeight: kg == null, estimated: !covered, // 요금표가 없는 카테고리는 스킨케어 요금표로 추정
      };
    },
  };
  window.RG = RG;
})();
