// 전략 탐색 — 계산 로직 (chrome API 없음, Node로 테스트 가능)
// 카테고리별 최신 인기상품 스냅샷을 "시장" 하나로 보고, 강의 기준(큰 시장)과 틈새 기준으로 판정한다.
// 근거: 강의교재_분석/00_종합분석.md 4장(숫자·공식), 6장(틈새 응용)

export const DEFAULTS = {
  mode: "niche",        // "big" | "niche"
  unit: "cat",          // "cat" 카테고리 시장 | "kw" 키워드 시장(제휴 DB + Wing 키워드 보완)
  // 공통
  topN: 36,             // 1페이지로 보는 상위 상품 수
  cvr: 0.05,            // 구매전환율 (강의 5~7%, 보수적 하단)
  // 대표님 기준 (판단규칙사전 v0.2, 2026-10-03)
  fx: 300,              // 원가 계수 원/위안 — 빠른 암산용(실제는 품목·물량에 따라 270~320)
  feeRate: 0.1188,      // 쿠팡 수수료 부가세 포함 (별도면 0.108)
  etcRate: 0,           // 광고비는 아래 최소 마진(광고 시 30%)으로 반영
  logistics: 2200,      // 개당 입출고·배송비(원) — 극소형 기준
  days: 30,
  goal: 3000000,        // 월 목표 순수익 (강의 1주 p.14)
  success: 0.42,        // 런칭 성공률 (강의 1주 p.21)
  pbBrands: "곰곰, 탐사, 코멧, 홈플래닛, 캐럿, 베이스알파에센셜, 비타할로",
  // 큰 시장 (강의 기준)
  bigMinTopViews: 20000,   // Top 상품 28일 조회 2만+ (1주 p.93)
  bigMinRev500: 3,         // 후기 500+ 상품 3개 이상 (1주 p.56)
  bigMaxPbTop5: 1,         // 상위 5위 안 PB 허용 수
  bigMaxBrandShare: 0.6,   // 상위 3개 브랜드 판매 점유율 상한
  bigMinMedianPrice: 5000, // 초저가 시장 회피 (1주 p.52)
  bigMinProfit: 0,         // 개당 최소 순익(원) — 대표님 기준은 마진율로 판단
  bigMinMargin: 0.3,       // 순이익률: 광고 시 30%, 광고 없으면 20%
  // 틈새
  nicheMinTopViews: 1000,  // 이 미만이면 시장 없음
  nicheMaxTopViews: 20000, // 이 초과면 큰 시장
  nicheMaxPbTop10: 0,
  nicheMaxTopReviews: 100, // 1위 리뷰 상한 — 대표님 기준 "경쟁사 리뷰 100개 미만이면 해 볼 만"
  nicheMinProfit: 0,
  nicheMinMargin: 0.3,     // 순이익률: 광고 시 30%, 광고 없으면 20%
  nicheShare: 0.5,         // 1위 달성 시 상위 5개 판매 합 중 내 몫
};

const NO_BRAND = new Set(["", "기타", "없음", "브랜드없음", "브랜드 없음", "상세페이지 참조", "상세설명 참조", "자체제작", "notbrand", "no brand"]);
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");

export const midViews = (it) => {
  if (it.ex?.views != null) return it.ex.views;
  const lo = it.pvLo == null ? null : Math.max(0, it.pvLo);
  if (lo != null && it.pvHi != null) return (lo + it.pvHi) / 2;
  return lo;
};

// 하루 판매 추정: 정확한 28일 판매량이 있으면 그 값, 없으면 조회수 × 전환율
export const dailySales = (it, s) => (it.ex?.sales != null ? it.ex.sales / 28 : ((midViews(it) ?? 0) / 28) * s.cvr);

export function pbList(s) {
  return String(s.pbBrands || "").split(/[,\n]/).map(norm).filter(Boolean);
}
export function isPB(it, pbs) {
  const b = norm(it.brand), n = norm(it.name);
  return pbs.some((p) => b === p || n.startsWith(p));
}

const median = (a) => {
  const v = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const quantile = (a, q) => {
  const v = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.round((v.length - 1) * q)))];
};

// 목표 판매가에서 거꾸로 계산한 "허용 소싱가(위안)": 최소 순익과 최소 마진율을 모두 지키는 최대 중국 단가
export function allowedYuan(target, s, minProfit, minMargin = 0) {
  if (!target) return null;
  const net = target * (1 - s.feeRate - s.etcRate) - s.logistics;
  const byProfit = net - minProfit;
  const byMargin = net - target * minMargin;
  return Math.min(byProfit, byMargin) / s.fx;
}

// 정확한 지표 캐시(키 pid:vid)를 스냅샷 상품에 덧붙인다 (더 최신 값 우선)
function withExact(it, cache) {
  const c = cache?.[`${it.pid}:${it.vid ?? ""}`];
  if (c && (!it.ex || c.ts > it.ex.ts)) return { ...it, ex: c };
  return it;
}

// snapshots: DB의 snapshots 전체 / cache: exactCache
export function buildMarkets(snapshots, cache, s) {
  const byKey = new Map();
  for (const snap of snapshots) {
    if (!snap.code) continue; // 키워드 검색 스냅샷은 제외, 카테고리만 시장으로 본다
    const arr = byKey.get(snap.key) || [];
    arr.push(snap);
    byKey.set(snap.key, arr);
  }
  const pbs = pbList(s);
  const out = [];
  for (const arr of byKey.values()) {
    arr.sort((a, b) => (a.date < b.date ? 1 : -1));
    const cur = arr[0], prev = arr[1] || null;
    const items = (cur.items || []).map((it) => withExact(it, cache)).sort((a, b) => a.order - b.order);
    if (!items.length) continue;
    out.push(marketStats(cur, items, prev, pbs, s));
  }
  return out;
}

export function marketStats(cur, items, prev, pbs, s) {
  const top = items.slice(0, s.topN);
  const daily = top.map((it) => dailySales(it, s));
  const allDaily = daily.reduce((a, b) => a + b, 0);
  // 시장 크기 = 상위 5개 판매 합 (틈새시장_계산기.xlsx 와 같은 정의)
  const marketDaily = daily.slice(0, 5).reduce((a, b) => a + b, 0);
  const views = top.map(midViews);
  const top5 = top.slice(0, 5);
  const topViews = Math.max(0, ...top5.map((it) => midViews(it) ?? 0));
  const leader = top[0];

  // 브랜드 점유: 상위 N의 추정 판매 중 상위 3개 브랜드 비중
  const byBrand = new Map();
  top.forEach((it, i) => {
    const b = norm(it.brand);
    if (NO_BRAND.has(b)) return;
    byBrand.set(b, (byBrand.get(b) || 0) + daily[i]);
  });
  const brandTop = [...byBrand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const brandShare = allDaily > 0 ? brandTop.reduce((a, [, v]) => a + v, 0) / allDaily : 0;
  const brandNames = brandTop.map(([b]) => top.find((it) => norm(it.brand) === b)?.brand || b);

  const prices = top.map((it) => it.ex?.price ?? it.price);
  const top4Prices = top.slice(0, 4).map((it) => it.ex?.price ?? it.price).filter((x) => x != null);
  const top10Prices = top.slice(0, 10).map((it) => it.ex?.price ?? it.price);
  const p10 = quantile(prices, 0.1), p90 = quantile(prices, 0.9);

  let viewsTrend = null;
  if (prev?.items?.length) {
    const sum = (arr) => arr.slice(0, s.topN).reduce((a, it) => a + (midViews(it) ?? 0), 0);
    const before = sum([...prev.items].sort((a, b) => a.order - b.order));
    if (before > 0) viewsTrend = sum(items) / before - 1;
  }

  return {
    key: cur.key, code: cur.code, name: cur.name, path: cur.path, date: cur.date, prevDate: prev?.date || null,
    items, count: items.length,
    topViews, leaderViews: midViews(leader), leaderReviews: leader?.reviews ?? null, leaderName: leader?.name || "",
    marketDaily, rank10Daily: top[9] ? dailySales(top[9], s) : null,
    rev500: top.filter((it) => (it.reviews ?? 0) >= 500).length,
    pbTop5: top5.filter((it) => isPB(it, pbs)).length,
    pbTop10: top.slice(0, 10).filter((it) => isPB(it, pbs)).length,
    brandShare, brandNames,
    lowRevTop20: top.slice(0, 20).filter((it) => (it.reviews ?? 0) < 100).length,
    medianPrice: median(prices), minTop4Price: top4Prices.length ? Math.min(...top4Prices) : null,
    medianTop10Price: median(top10Prices),
    priceSpread: p10 && p90 ? p90 / p10 : null,
    exactTop10: top.slice(0, 10).filter((it) => it.ex).length,
    viewsTrend,
    hasViews: views.some((v) => v != null),
  };
}

// pass: true 통과 / false 탈락 / null 데이터 없음(판정에 반영하지 않음)
const chk = (key, label, pass, value, need) => ({ key, label, pass: value == null && key !== "margin" ? null : pass, value, need });
const failed = (checks, k) => checks.find((c) => c.key === k)?.pass === false;
const allOk = (checks) => checks.every((c) => c.pass !== false);

// 큰 시장 (강의 기준)
export function judgeBig(m, s) {
  const target = m.minTop4Price; // 경쟁 Top4 최저가 = 목표 판매가 (1주 p.76)
  const yuan = allowedYuan(target, s, s.bigMinProfit, s.bigMinMargin ?? 0.3);
  const checks = [
    chk("size", "시장 크기", m.topViews >= s.bigMinTopViews, m.topViews, `Top5 최대 28일 조회 ≥ ${s.bigMinTopViews.toLocaleString()}`),
    chk("demand", "수요 검증", m.rev500 >= s.bigMinRev500, m.rev500, `후기 500+ 상품 ≥ ${s.bigMinRev500}개`),
    chk("pb", "PB 장악 회피", m.pbTop5 <= s.bigMaxPbTop5, m.pbTop5, `상위 5위 PB ≤ ${s.bigMaxPbTop5}개`),
    chk("brand", "대형브랜드 회피", m.brandShare <= s.bigMaxBrandShare, m.brandShare, `상위 3브랜드 점유 ≤ ${Math.round(s.bigMaxBrandShare * 100)}%`),
    chk("price", "초저가 회피", (m.medianPrice ?? 0) >= s.bigMinMedianPrice, m.medianPrice, `중앙 판매가 ≥ ${s.bigMinMedianPrice.toLocaleString()}원`),
    chk("margin", "원가 여유", yuan != null && yuan > 0, yuan, `순이익률 ${Math.round((s.bigMinMargin ?? 0.3) * 100)}% 가능한 소싱가 > 0`),
  ];
  const fail = (k) => failed(checks, k);
  // 강의 진입 3기준(수요 검증·PB 장악·시장 크기) 탈락은 DROP, 대리 지표(브랜드 점유·가격·원가)는 검토
  const verdict = fail("size") || fail("demand") || fail("pb") ? "DROP" : allOk(checks) ? "GO" : "검토";
  const myDaily = m.rank10Daily; // 신규 자리(10위) 수준의 판매를 현실적 착지점으로 본다
  return {
    verdict, checks, target, yuan, myDaily,
    monthly: myDaily != null && target ? myDaily * target * (s.bigMinMargin ?? 0.3) * s.days : null,
    note: verdict !== "DROP" ? "" : fail("size") ? "시장이 작음 → 틈새 모드로 보세요"
      : fail("demand") ? "후기 500+ 상품이 부족해 수요 미검증" : "쿠팡 PB가 상위를 장악한 시장 (강의 1주 p.57: 진입 부적합)",
  };
}

// 틈새 (분석 의견 6장)
export function judgeNiche(m, s) {
  const target = m.medianTop10Price; // 평균가 근처로 진입 (6-3 ⑤)
  const yuan = allowedYuan(target, s, s.nicheMinProfit, s.nicheMinMargin);
  const checks = [
    chk("exists", "시장 존재", m.topViews >= s.nicheMinTopViews, m.topViews, `Top5 최대 28일 조회 ≥ ${s.nicheMinTopViews.toLocaleString()}`),
    chk("small", "틈새 규모", m.topViews <= s.nicheMaxTopViews, m.topViews, `Top5 최대 28일 조회 ≤ ${s.nicheMaxTopViews.toLocaleString()}`),
    chk("pb", "PB 없음", m.pbTop10 <= s.nicheMaxPbTop10, m.pbTop10, `상위 10위 PB ≤ ${s.nicheMaxPbTop10}개`),
    chk("leader", "약한 1위", (m.leaderReviews ?? 0) <= s.nicheMaxTopReviews, m.leaderReviews, `1위 리뷰 ≤ ${s.nicheMaxTopReviews.toLocaleString()}`),
    chk("margin", "마진 가능", yuan != null && yuan > 0, yuan, `순이익률 ${Math.round(s.nicheMinMargin * 100)}% 가능한 소싱가 > 0`),
  ];
  const fail = (k) => failed(checks, k);
  const verdict = fail("exists") ? "DROP" : fail("small") ? "큰 시장" : allOk(checks) ? "GO" : "검토";
  // 큰 시장으로 분류되면 틈새 공식(상위5 × 내 몫)이 맞지 않으므로 예상치를 비운다
  const myDaily = verdict === "큰 시장" ? null : m.marketDaily * s.nicheShare;
  return {
    verdict, checks, target, yuan, myDaily,
    monthly: myDaily == null || !target ? null : myDaily * target * s.nicheMinMargin * s.days,
    note: verdict === "큰 시장" ? "트래픽이 커서 틈새가 아님 → 큰 시장 모드로 보세요" : verdict === "DROP" ? "조회수가 거의 없는 시장" : "",
  };
}

export const judge = (m, s) => (s.mode === "big" ? judgeBig(m, s) : judgeNiche(m, s));

// GO 시장으로 월 목표를 채우려면 몇 개를 런칭해야 하나
export function portfolio(rows, s) {
  const go = rows.filter((r) => r.j.verdict === "GO" && r.j.monthly != null);
  const sum = go.reduce((a, r) => a + r.j.monthly, 0);
  const avg = go.length ? sum / go.length : 0;
  const needWin = avg > 0 ? Math.ceil(s.goal / avg) : null;
  const needLaunch = needWin != null && s.success > 0 ? Math.ceil(needWin / s.success) : null;
  return { goCount: go.length, sum, expected: sum * s.success, avg, needWin, needLaunch };
}

// ---------- 키워드 시장 (제휴 DB 후보 + Wing 키워드 보완 결과) ----------
// results: kwresults 전체, kwdb: { 키워드: 제휴 DB 행 } (keyword-pipeline JSON의 keywords)
// 상품 순서는 Wing 응답 순서가 쿠팡 검색 순위와 같다는 보장이 없으므로 "28일 판매량 많은 순"으로 다시 매긴다.
export function buildKeywordMarkets(results, kwdb, s) {
  const byKw = new Map();
  for (const r of results) {
    const arr = byKw.get(r.kw) || [];
    arr.push(r);
    byKw.set(r.kw, arr);
  }
  const pbs = pbList(s);
  const bySales = (items) => [...items]
    .sort((a, b) => (b.ex?.sales ?? -1) - (a.ex?.sales ?? -1))
    .map((it, i) => ({ ...it, order: i + 1 }));
  const out = [];
  for (const [kw, arr] of byKw) {
    arr.sort((a, b) => (a.date < b.date ? 1 : -1));
    const cur = arr[0], prev = arr[1] || null;
    const items = bySales(cur.items || []);
    if (!items.length) continue;
    const db = kwdb?.[kw] || null;
    const m = marketStats({ key: `k:${kw}`, code: null, name: kw, path: db?.cat || "", date: cur.date },
      items, prev ? { ...prev, items: bySales(prev.items || []) } : null, pbs, s);
    if (!items.some((it) => it.reviews != null)) {
      // Wing 응답에 리뷰가 없으면 제휴 DB(쿠팡 검색 상위 60개 기준) 값으로 대신한다
      m.leaderReviews = db?.mx ?? null;
      m.rev500 = null;
      m.lowRevTop20 = null;
      m.reviewSrc = db ? "제휴DB" : null;
    }
    if (m.medianPrice == null && db?.price) { m.medianPrice = db.price; m.medianTop10Price = db.price; m.minTop4Price = db.price; }
    m.unit = "kw";
    m.naverM1 = db?.m1 ?? null;
    m.groups = db?.groups || [];
    m.metricCount = items.filter((it) => it.ex).length;
    m.top5Sales28 = items.slice(0, 5).reduce((a, it) => a + (it.ex?.sales || 0), 0);
    m.cpPerNaver = m.naverM1 ? m.top5Sales28 / m.naverM1 : null;
    m.db = db;
    out.push(m);
  }
  return out;
}
