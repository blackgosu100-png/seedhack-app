// ⏱ 스톱워치 — 단계별 실제 시간
import test from "node:test";
import assert from "node:assert/strict";
import { newClock, clockKey, clockTick, clockStop, clockResume, clockSummary, fmtDur } from "../../src/main/detail/clock-core.js";

test("이벤트 사이 시간이 빈틈없이 나뉜다 + 화면 읽기 시간 포함", () => {
  const c = newClock(10_000, 8_000);
  clockTick(c, "download", 10_000);
  clockTick(c, "ocr", 30_000);
  clockTick(c, clockKey("scene", { bg: "localize" }), 50_000);
  clockTick(c, clockKey("scene", { bg: "localize", clk: "bake" }), 80_000);
  clockTick(c, "render", 680_000);
  clockStop(c, 700_000);
  const s = clockSummary(c);
  assert.equal(s.totalMs, 698_000); // 8초(읽기) + 690초
  assert.equal(s.rows.reduce((n, r) => n + r.ms, 0), s.totalMs);
  assert.equal(s.rows.find((r) => r.id === "bake").ms, 600_000);
  assert.equal(s.rows.find((r) => r.id === "bake").bar, 100);
  assert.equal(s.rows.find((r) => r.id === "read").ms, 8_000);
  assert.equal(s.rows.find((r) => r.id === "fetch").ms, 40_000);
});

test("기획안을 보느라 멈춘 시간은 전체에서 빠진다", () => {
  const c = newClock(0);
  clockTick(c, "brief", 0); clockStop(c, 60_000);
  clockResume(c, 360_000); // 5분 동안 사람이 봄
  clockTick(c, "copy", 360_000); clockStop(c, 400_000);
  const s = clockSummary(c);
  assert.equal(s.totalMs, 100_000);
  assert.equal(s.waitMs, 300_000);
});

test("1초 안 되는 칸은 숨기고, 모르는 칸은 마지막 줄에 더한다", () => {
  const c = newClock(0);
  clockTick(c, "extract", 0); clockTick(c, "mystery", 300); clockTick(c, "render", 5_300); clockStop(c, 7_300);
  const s = clockSummary(c);
  assert.deepEqual(s.rows.map((r) => r.id), ["render"]);
  assert.equal(s.rows[0].ms, 7_000);
  assert.equal(clockSummary(null), null);
});

test("시간 표기", () => {
  assert.equal(fmtDur(45_400), "45초");
  assert.equal(fmtDur(785_000), "13분 5초");
  assert.equal(fmtDur(120_000), "2분");
});
