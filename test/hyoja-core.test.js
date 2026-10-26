// 효자상품 정리(hyoja-core) — node --test test/hyoja-core.test.js
// 상품명·판매량은 2026-10-11 앱에 저장된 실제 Wing 조회 결과(kwCache)에서 일부를 옮겨 온 것
import test from "node:test";
import assert from "node:assert/strict";
import { summarize, cover, wMedianPrice } from "../src/shared/hyoja-core.js";

const it = (name, price, sales, reviews) => ({ name, price, sales, reviews });
const LEOPARD = [
  it("마스마룰즈 남녀공용 래빗에코백 + 파우치 세트", 39900, 2143, 1496),
  it("APNCC 여성 여자 호피 얼룩말 에코백 숄더백", 8610, 1099, 1580),
  it("MULAIDI 호피무늬 캔버스 레오파드 숄더백 에코백 토트백", 21800, 361, 314),
  it("라뷰드 호피 패턴 코듀로이 에코백 레오파드 무늬 가방 데일리 숄더백", 42390, 350, 157),
  it("[국내매장정품] EMIS 이미스 호피 레오파드 코듀로이 에코백", 43900, 295, 145),
  it("업홀드 여성 레오파드 에코백 캔버스 호피무늬 숄더백", 16900, 180, 139),
];

test("검색어와 다른 상품(래빗에코백)만 빼고, 다른 표기(호피)는 남긴다", () => {
  const s = summarize("레오파드에코백", LEOPARD);
  assert.deepEqual(s.drop.map((x) => x.name), ["마스마룰즈 남녀공용 래빗에코백 + 파우치 세트"]);
  assert.equal(s.n, 5);
  assert.ok(s.top.every((x) => !/래빗/.test(x.name)));
  assert.equal(s.rev, 8610 * 1099 + 21800 * 361 + 42390 * 350 + 43900 * 295 + 16900 * 180);
});

test("틈 = 리뷰 300개 미만 중 가장 많이 팔린 상품", () => {
  const s = summarize("레오파드에코백", LEOPARD);
  assert.equal(s.gap.name, "라뷰드 호피 패턴 코듀로이 에코백 레오파드 무늬 가방 데일리 숄더백");
});

test("다른 말로 파는 시장(굽은등교정기 → 자세 밴드)은 거르지 않고, 의료기기 표시를 잡는다", () => {
  const s = summarize("굽은등교정기", [
    it("[1등급 의료기기] 올바름 자세 밸런스 밴드", 35300, 4997, 3306),
    it("정직한닥터 바른 자세 밴드 어깨 숄더 남녀공용", 46400, 3406, 6212),
    it("누비즈 바른자세 어깨 보정 밴드 남녀공용", 10900, 3213, 2165),
    it("텐톤 남녀공용 바른자세 밴드 어깨 등 서포트밴드pro", 5090, 1541, 264),
  ]);
  assert.equal(s.drop.length, 0);
  assert.equal(s.medical, true);
  assert.equal(s.gap.reviews, 264);
});

test("짧은 검색어(채칼)는 거르지 않는다 — 슬라이서도 채칼", () => {
  const s = summarize("채칼", [
    it("노노지 양배추 채칼 와이드 일본 채칼", 15000, 3000, 900),
    it("무디타 마그넷 스테인리스 슬라이서 세트", 30000, 5149, 2000),
    it("채칼 세트", 9000, 100, 50), it("다용도 채칼", 9000, 100, 50),
  ]);
  assert.equal(s.drop.length, 0);
  assert.equal(s.gap.reviews, 50);
});

test("1등 쏠림 · 판매량 가중 중앙가", () => {
  const s = summarize("볼드귀걸이", [it("볼드 귀걸이 A", 10000, 900, 10), it("볼드 귀걸이 B", 10000, 100, 10), it("투라인 볼드 은침 후프 이어링", 20000, 50, 5)]);
  assert.equal(s.drop.length, 0); // 이어링 = 귀걸이
  assert.equal(Math.round(s.top1Share * 100), 82);
  assert.equal(wMedianPrice(s.top), 10000);
  assert.ok(cover("레오파드에코백", "호피 에코백") > cover("레오파드에코백", "래빗에코백"));
});

test("유명 브랜드(나이키)는 리뷰가 적어도 틈으로 보지 않고, 브랜드 비중을 센다 — 헬스장가방 실데이터", () => {
  const items = [
    { name: "나이키 브라질리아 트레이닝 더플백", brand: "나이키", price: 45000, sales: 2468, reviews: 466 },
    { name: "나이키 브라질리아 트레이닝 더플백 M", brand: "나이키", price: 39000, sales: 2007, reviews: 271 },
    { name: "제로투히어로 미니멀 짐 더플 백", brand: "제로투히어로", price: 39000, sales: 1456, reviews: 3932 },
    { name: "젠핏 여행용 피트니스 보스턴백", brand: "젠핏", price: 25000, sales: 336, reviews: 142 },
  ];
  const s = summarize("헬스장가방", items, { famous: new Set(["나이키", "제로투히어로"]) });
  assert.equal(s.gap.brand, "젠핏");
  assert.ok(s.brandShare > 0.8);
  assert.deepEqual(s.brandTop, ["나이키", "제로투히어로"]);
  const only = summarize("헬스장가방", items.slice(0, 3), { famous: new Set(["나이키", "제로투히어로"]) });
  assert.equal(only.gap, null);
  assert.equal(only.gapBrandOnly, true);
});

test("월매출·판매량·리뷰 수는 판매액 상위 10개 합", () => {
  const items = Array.from({ length: 14 }, (_, i) => ({ name: `헬스 가방 ${i}`, price: 10000, sales: 100 - i, reviews: 10 }));
  const s = summarize("헬스가방", items);
  assert.equal(s.n, 10); assert.equal(s.nAll, 14);
  assert.equal(s.sales, [...Array(10).keys()].reduce((t, i) => t + 100 - i, 0));
  assert.equal(s.rev, s.sales * 10000); assert.equal(s.reviews, 100);
});

test("팔아봤어요 지표: 1등 판매량 · 리뷰 500개+ 상품 수 (검색어와 다른 상품은 빼고)", () => {
  const s = summarize("레오파드에코백", LEOPARD);
  assert.equal(s.top1Sales, 1099); // 래빗에코백(2,143개)은 빠짐
  assert.equal(s.big500, 1); // 리뷰 1,580개 1개만(래빗에코백 1,496개는 빠짐)
});

test("pagePrice: 쿠팡 화면 쿠폰가 — 옵션 같으면 큰 할인도, 옵션 다르거나 너무 싸면 Wing가", async () => {
  const { pagePrice } = await import("../src/shared/hyoja-core.js");
  assert.deepEqual(pagePrice({ price: 14900, vid: "1" }, { page: { price: 9900, vid: "1" } }).price, 9900);
  assert.equal(pagePrice({ price: 63800, vid: "1" }, { page: { price: 12800, vid: "1" } }).src, "page"); // 홀럭스 79% 할인
  assert.equal(pagePrice({ price: 63800, vid: "1" }, { page: { price: 12800, vid: "" } }).src, "odd"); // 옵션 확인 못 하면 35% 규칙
  assert.equal(pagePrice({ price: 14900, vid: "1" }, { page: { price: 9900, vid: "2" } }).src, "vid");
  assert.equal(pagePrice({ price: 14900, vid: "1" }, { page: { price: 900, vid: "1" } }).src, "odd"); // 15% 아래는 단위가격 오독
  assert.equal(pagePrice({ price: 14900 }, null).price, 14900);
  // 로그나스: 옵션 번호는 다르지만 카드의 할인 전 가격이 Wing가와 같음 → 88% 할인가 사용
  assert.equal(pagePrice({ price: 26900, vid: "95864940372" }, { page: { price: 3000, vid: "95864940371", raw: "로그나스 … | 할인 | 26,900원 | 88% | 3,000원 | (1개당 3,000원)" } }).price, 3000);
  // a2액자: 다른 옵션(2개짜리)이고 할인 전 가격도 다름 → Wing가 유지
  assert.equal(pagePrice({ price: 16900, vid: "1" }, { page: { price: 33800, vid: "2", raw: "… | 33,800원 | (1개당 16,900원)" } }).src, "vid");
});
