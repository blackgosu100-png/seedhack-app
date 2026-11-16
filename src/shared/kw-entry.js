// 🚪 쿠팡 진입용 키워드 규칙 (2026-11-16 대표님 전달문 「쿠팡 진입용 키워드 필터 규칙」)
// 수저정리함 키워드군에서 뽑은 기준: 로켓배송(직매입) 비율 낮음 + 쿠팡 평균·최대 리뷰 낮음 + 검색량 일정 이상
//  - 로켓배송 45%↑ 키워드는 예외 없이 평균 리뷰 600↑ → 로켓배송 조건은 완화하지 않는다
//  - 로켓그로스(판매자로켓) 비율이 높은 건 경고가 아니라 "검증된 시장"(대표님: 시장이 형성돼 있으니 더 잘 소싱해서 차별화)
// 입력은 제휴 키워드 DB(sellar_YYYY-MM.db) 한 줄의 원래 칸 이름 그대로. 순수 계산이라 앱·키워드 서버가 같이 쓴다.

export const ENTRY = {
  main:    { m1: 2000, ly: 20000, rocket: 0.25, ar: 300, mx: 3000, price: 12000 },
  relaxed: { m1: 1000, ly: 20000, rocket: 0.25, ar: 400, mx: 3000, price: 12000 }, // 결과가 적을 때: 월검색 1천 · 평균 리뷰 400
  sub:     { m1: 300, rocket: 0.25, ar: 250 },
  growth: 0.5, // 로켓그로스 50%↑ = 검증된 시장
  mixed: 2.5, // 네이버·쿠팡 평균가 차이 — 전달문은 1.8배였지만 11월 DB 키워드의 32%가 걸려 2.5배(17%)로
};
const n = (v) => (v == null || v === "" ? null : Number(v));

// 메인 프리셋 통과? (예상 상승률이 비어 있으면 통과 + "예측 불가" 꼬리표)
export function entryLevel(r) {
  if (!r || r.is_brand === "O") return null;
  const m1 = n(r.m1) || 0, ly = n(r.last_year) || 0, rk = n(r.cp_rocket), ar = n(r.cp_avg_reviews), mx = n(r.cp_max_reviews), pr = n(r.cp_avg_price) || 0, fc = n(r.m1_fc_rate);
  if (rk == null || ar == null || mx == null) return null;
  const ok = (p) => m1 >= p.m1 && ly >= p.ly && rk <= p.rocket && ar <= p.ar && mx <= p.mx && pr >= p.price && (fc == null || fc >= 0);
  if (ok(ENTRY.main)) return "main";
  if (ok(ENTRY.relaxed)) return "relaxed";
  if (m1 >= ENTRY.sub.m1 && rk <= ENTRY.sub.rocket && ar <= ENTRY.sub.ar) return "sub";
  return null;
}

// 같은 카테고리 · 비슷한 이름(두 글자 이상 겹침)의 키워드들에서 1등 상품 리뷰 수가 똑같이(300개 이상) 반복 = 한 상품이 그 키워드군을 장악
//  전달문은 ±1%였지만 11월 DB에서 키워드의 51%가 걸려(큰 카테고리는 우연히 비슷한 값이 많음) "같은 값 + 이름 겹침"으로 좁힘 → 약 6%
const share2 = (a, b) => { for (let i = 0; i < a.length - 1; i++) if (b.includes(a.slice(i, i + 2))) return true; return false; };
export function dominantSet(rows) {
  const byKey = new Map();
  for (const r of rows) { const mx = n(r.cp_max_reviews); if (!mx || mx < 300) continue; const k = `${String(r.category || "").split(/[,|]/)[0]}|${mx}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(String(r.keyword)); }
  const out = new Set();
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (share2(arr[i], arr[j])) { out.add(arr[i]); out.add(arr[j]); }
  }
  return out;
}

// 꼬리표(빼지 않고 표시만): { id, ko, tone: "good"|"warn"|"info", tip }
export function entryFlags(r, { dominant = null, month = new Date().getMonth() + 1 } = {}) {
  const f = [];
  if (!r) return f;
  const m1 = n(r.m1) || 0, fc1 = n(r.m1_fc), pm = n(r.ly_peak_month), pv = n(r.ly_peak_vol), nv = n(r.nv_avg_price), cp = n(r.cp_avg_price), sr = n(r.cp_seller_rocket);
  if (pm && pm >= 1 && pm <= 12) {
    const ahead = (pm - month + 12) % 12;
    if (ahead >= 1 && ahead <= 3) f.push({ id: "timing", ko: "지금 진입 권장", tone: "good", tip: `작년엔 ${pm}월에 검색이 가장 많았어요 · ${ahead}달 뒤` });
    if (ahead === 0 && pv && m1 < pv * 0.3) f.push({ id: "suspect", ko: "예측 의심", tone: "warn", tip: `이번 달이 작년 최대 달(${pv.toLocaleString("ko-KR")})인데 지금 검색이 30%도 안 돼요 · 예상 상승률을 믿기 어려워요` });
  }
  if (sr != null && sr >= ENTRY.growth) f.push({ id: "growth", ko: `검증된 시장 · 로켓그로스 ${Math.round(sr * 100)}%`, tone: "info", tip: "로켓그로스 판매자가 많아 이미 팔리는 시장이에요 · 더 좋은 상품을 소싱해 차별화하면 들어갈 수 있어요" });
  if (dominant?.has(r.keyword)) f.push({ id: "dominant", ko: "한 상품이 장악", tone: "warn", tip: "같은 카테고리 여러 키워드에서 1등 상품 리뷰 수가 같아요 · 한 상품이 이 키워드군을 차지하고 있어요" });
  if (nv && cp && Math.max(nv, cp) >= Math.min(nv, cp) * ENTRY.mixed) f.push({ id: "mixed", ko: "상품 섞임", tone: "warn", tip: `네이버 평균가 ${Math.round(nv).toLocaleString("ko-KR")}원 · 쿠팡 평균가 ${Math.round(cp).toLocaleString("ko-KR")}원 — 서로 다른 상품이 섞여 보이는 키워드예요` });
  if (!fc1) f.push({ id: "nofc", ko: "예측 불가", tone: "info", tip: `표본이 적어 다음 달 예상 검색량이 없어요 · 최근 3개월 검색 ${(n(r.m3) || 0).toLocaleString("ko-KR")}` });
  return f;
}
