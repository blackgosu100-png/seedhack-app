// 리뷰 분석(review-core) — node --test test/review-core.test.js
// 주의: 화면 사진 모양을 흉내 낸 가짜 데이터. 실제 쿠팡 리뷰로 다시 확인해야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeReviews, toDate } from "../src/shared/review-core.js";

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const day = (s, k) => new Date(Date.parse(s) + k * 86400000).toISOString().slice(0, 10);
function gen(from, to, perDay, mk) {
  const out = [];
  for (let d = from; d <= to; d = day(d, 1)) { const n = Math.floor(perDay + rnd()); for (let i = 0; i < n; i++) out.push({ id: `${d}-${i}-${out.length}-${rnd()}`, date: d, ...mk() }); }
  return out;
}
const fake = () => ({ rating: 5, text: rnd() < 0.55 ? "" : "안경 세척하려고 샀는데 물만 넣고 버튼 하나로 코받침 때가 싹 빠져요 무선이라 편해요 " + Math.floor(rnd() * 3) });
const real = () => { const r = rnd(); return { rating: r < 0.12 ? 2 : r < 0.2 ? 3 : r < 0.4 ? 4 : 5, text: ["생각보다 작아요", "배송 빨라요 잘 쓸게요", "", "소음이 좀 있네요 그래도 괜찮아요", "싼티나요 재구매 안 해요"][Math.floor(rnd() * 5)] }; };

test("날짜 읽기", () => {
  assert.equal(toDate("2026.10.08"), "2026-10-08");
  assert.equal(toDate(Date.parse("2026-10-07T20:00:00Z")), "2026-10-08"); // 한국 시간
});

test("신규 상품: 소량 → 급증(작업) → 실제 고객", () => {
  const rs = [...gen("2026-05-01", "2026-05-12", 0.4, real), ...gen("2026-08-24", "2026-09-20", 3.6, fake), ...gen("2026-09-21", "2026-10-09", 0.6, real)];
  const a = analyzeReviews({ reviews: rs, total: rs.length, today: "2026-10-10" });
  assert.equal(a.capped, false);
  assert.ok(a.burst, "급증 구간을 찾아야 함");
  assert.ok(a.burst.from >= "2026-08-17" && a.burst.from <= "2026-08-26", a.burst.from);
  assert.ok(a.burst.to >= "2026-09-14" && a.burst.to <= "2026-09-22", a.burst.to);
  assert.ok(a.suspect >= 3, JSON.stringify(a.signals, null, 1));
  console.log(a.signals.map((s) => (s.on ? "● " : "○ ") + s.text).join("\n"));
});

test("한도에 걸린 꾸준한 상품: 잘린 지점을 급증으로 보지 않음", () => {
  const rs = gen("2026-07-25", "2026-10-09", 20, real).slice(-1500);
  const a = analyzeReviews({ reviews: rs, total: 8207, today: "2026-10-10" });
  assert.equal(a.capped, true);
  assert.equal(a.burst, null);
  console.log(a.notes.join("\n"));
});

test("한도에 걸린 계절 상품: 잘린 지점 근처는 무시, 이후 감소는 급증 아님", () => {
  const rs = [...gen("2025-11-15", "2026-01-31", 12, real), ...gen("2026-02-01", "2026-04-30", 4, real), ...gen("2026-09-01", "2026-10-09", 1.5, real)].slice(-1500);
  const a = analyzeReviews({ reviews: rs, total: 2513, today: "2026-10-10" });
  assert.equal(a.capped, true);
  assert.ok(!a.burst || a.burst.from > "2026-08-01", JSON.stringify(a.burst));
});
