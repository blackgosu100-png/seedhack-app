// 이미지 생성 사용량 단위테스트 (node --test test/detail/usage-core.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { addUsage, summarize, costOf, dayKey, FALLBACK_USD_PER_IMAGE } from "../../src/main/detail/usage-core.js";

const T = new Date(2026, 9, 12, 15, 0).getTime(); // 2026-10-12 15:00(현지)

test("costOf: 토큰 × 단가, 토큰 없으면 1장 기본값", () => {
  assert.ok(Math.abs(costOf({ model: "gemini-2.5-flash-image", inTok: 0, outTok: 1290 }) - 0.0387) < 1e-6);
  assert.ok(costOf({ model: "gemini-3-pro-image-preview", inTok: 500, outTok: 1120 }) > 0.13);
  assert.equal(costOf({ model: "gemini-2.5-flash-image" }), FALLBACK_USD_PER_IMAGE);
  assert.equal(costOf({ model: "알수없음", outTok: 9999 }), FALLBACK_USD_PER_IMAGE);
});

test("addUsage → summarize: 오늘·이번 달·7일·모델별", () => {
  let s = null;
  s = addUsage(s, { provider: "vertex", model: "gemini-2.5-flash-image", outTok: 1290 }, T);
  s = addUsage(s, { provider: "vertex", model: "gemini-2.5-flash-image", outTok: 1290 }, T);
  s = addUsage(s, { provider: "vertex", model: "gemini-3-pro-image-preview", outTok: 1120 }, T - 3 * 864e5);
  s = addUsage(s, { model: "gemini-2.5-flash-image" }, new Date(2026, 8, 30).getTime()); // 지난달
  const u = summarize(s, T);
  assert.equal(u.today.n, 2);
  assert.equal(u.month.n, 3);
  assert.equal(u.all.n, 4);
  assert.equal(u.week.length, 7); assert.equal(u.week[6].day, dayKey(T)); assert.equal(u.week[6].n, 2); assert.equal(u.week[3].n, 1);
  assert.deepEqual(u.models, { "gemini-2.5-flash-image": 2, "gemini-3-pro-image-preview": 1 });
  assert.equal(u.month.krw, Math.round(u.month.usd * u.krwPerUsd));
  assert.equal(u.provider, "vertex");
});

test("오래된 기록(120일 넘음)은 지운다 · 빈 기록도 요약된다", () => {
  let s = addUsage(null, { model: "x" }, T - 200 * 864e5);
  s = addUsage(s, { model: "x" }, T);
  assert.equal(Object.keys(s.days).length, 1);
  const e = summarize(undefined, T);
  assert.equal(e.today.n, 0); assert.equal(e.month.krw, 0);
});
