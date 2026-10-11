// fitCalloutsToBox: 제품 영역 안 유지, 가장자리 근처 보정, 멀리 벗어나면 제거
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitCalloutsToBox } from "../../src/main/detail/plan-core.js";

test("fitCalloutsToBox: 안·근처·밖 처리", () => {
  const box = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 };
  const out = fitCalloutsToBox([
    { label: "안", x: 0.5, y: 0.5 },
    { label: "근처", x: 0.93, y: 0.18 },
    { label: "밖", x: 0.15, y: 0.95 },
  ], box);
  assert.deepEqual(out.map((c) => c.label), ["안", "근처"]);
  assert.equal(out[0].snapped, undefined);
  assert.ok(out[1].snapped && out[1].x <= 0.9 && out[1].y >= 0.2);
});

test("fitCalloutsToBox: box 없으면 그대로", () => {
  const cs = [{ label: "a", x: 0.99, y: 0.99 }];
  assert.equal(fitCalloutsToBox(cs, null), cs);
});
