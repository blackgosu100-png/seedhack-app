// 원본 한글화 앱 내 검수 — 판정·plan 고치기 단위테스트
// node --test test/detail/loc-qa-core.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeSection, fixPlan, rewriteTargets, realChinese, literalOf, headline, summarize, LIMITS } from "../../src/main/detail/loc-qa-core.js";

test("깨끗한 장은 문제 없음", () => {
  assert.deepEqual(judgeSection({ overlaps: [], overflow: [], roleDev: { pct: 4 }, colDev: { px: 2 }, low: [], residue: [], chinese: [], literal: [], emptyDeco: [], ai: { ok: true, issues: [] } }), []);
});

test("겹침·넘침·크기·열 편차는 배치 고치기(layout)로", () => {
  const is = judgeSection({ overlaps: [["물 세척 가능", "분리형 칼날"]], overflow: ["초강력 모터"], roleDev: { pct: 22, a: "가", b: "나" }, colDev: { px: 14, a: "다", b: "라" } });
  assert.deepEqual(is.map((x) => x.kind), ["overlap", "overflow", "roleDev", "colDev"]);
  assert.ok(is.every((x) => x.fix === "layout"));
  assert.equal(judgeSection({ roleDev: { pct: LIMITS.roleDev } }).length, 0, "상한과 같으면 통과");
});

test("대비: 그림자·테두리 글은 2:1 까지 봐준다", () => {
  assert.equal(judgeSection({ low: [{ text: "흰 글", median: 2.4, need: 4.5, shadow: true }] }).length, 0);
  assert.equal(judgeSection({ low: [{ text: "흰 글", median: 1.6, need: 4.5, shadow: true }] })[0].kind, "contrast");
  assert.equal(judgeSection({ low: [{ text: "회색 글", median: 3.9, need: 4.5, shadow: false }] })[0].fix, "ink");
  assert.equal(judgeSection({ low: [{ text: "주황 알약 흰 글", median: 2.17, need: 4.5, shadow: false, own: true }] }).length, 0, "원본 디자인 알약 색은 유지");
});

test("잔상 검사는 AI 가 같은 장에서 얼룩을 봤을 때만(오탐 거르기), AI 를 못 돌렸으면 그대로", () => {
  assert.equal(judgeSection({ residue: ["手表 경계 단차"], ai: { ok: true, issues: [] } }).length, 0);
  assert.equal(judgeSection({ residue: ["手表 경계 단차"], ai: { ok: false, issues: [{ kind: "residue", what: "흐린 사각형" }] } })[0].fix, "erase");
  assert.equal(judgeSection({ residue: ["手表 경계 단차"], ai: null })[0].kind, "residue");
});

test("AI 지적은 같은 종류 측정 문제와 겹치면 한 번만", () => {
  const is = judgeSection({ overflow: ["가"], literal: ["당신의 손을 거부합니다"], ai: { ok: false, issues: [{ kind: "overflow", what: "원 밖", text: "가" }, { kind: "translation", what: "직역", text: "당신의" }, { kind: "empty_deco", what: "빈 알약", text: "" }] } });
  assert.deepEqual(is.map((x) => x.kind), ["overflow", "literal", "ai"]);
  assert.equal(is[2].fix, null, "빈 장식은 자동으로 못 고침 → ⚠");
});

test("남은 한자: 2자 이상 · 한글 없음 · 우리가 얹은 글과 겹치지 않는 것만", () => {
  const boxes = [{ text: "大葱", x: 10, y: 10, w: 40, h: 20 }, { text: "甲", x: 100, y: 10, w: 20, h: 20 }, { text: "仝晉", x: 200, y: 10, w: 60, h: 20 }, { text: "한글 中文", x: 300, y: 10, w: 60, h: 20 }];
  const ours = [{ x: 195, y: 5, w: 80, h: 30 }];
  assert.deepEqual(realChinese(boxes, ours).map((b) => b.text), ["大葱"]);
});

test("직역 검출", () => { assert.deepEqual(literalOf(["물로 씻을 수 있어요", "당신의 주방", "大파"]), ["당신의 주방", "大파"]); });

test("plan 고치기: 같은 역할·같은 높이 줄 크기 맞춤 + 왼쪽 끝 맞춤 + 걸린 줄 줄이기", () => {
  const sec = { type: "image", layers: [
    { ko: "첫째 설명", role: "body", x: 40, y: 100, w: 300, h: 30, style: { size: 24 } },
    { ko: "둘째 설명", role: "body", x: 52, y: 140, w: 300, h: 31, style: { size: 38 } },
    { ko: "큰 제목", role: "title", x: 40, y: 20, w: 400, h: 60, style: { size: 48 } },
    { ko: "왼쪽 제목", role: "title", x: 600, y: 20, w: 100, h: 60, style: { size: 48, align: "left" } },
    { ko: "왼쪽 제목 아래", role: "body", x: 608, y: 90, w: 100, h: 30, style: { size: 24 } },
  ] };
  const d = fixPlan(sec, [{ kind: "roleDev", fix: "layout", texts: ["첫째 설명", "둘째 설명"] }, { kind: "overlap", fix: "layout", texts: ["큰 제목"] }], 0);
  assert.ok(d.length >= 2, d.join(" / "));
  assert.equal(sec.layers[0].style.size, sec.layers[1].style.size, "같은 크기");
  assert.equal(sec.layers[1].x, 40, "왼쪽 끝 맞춤"); assert.equal(sec.layers[1].w, 312); assert.equal(sec.layers[0].w, 312, "묶음 폭 같이");
  assert.equal(sec.layers[2].style.size, 40.8, "겹친 제목 15% 줄임");
  assert.equal(sec.layers[2].x, 40, "가운데 정렬 제목은 열 맞춤 안 함"); assert.equal(sec.layers[4].x, 600, "왼쪽 정렬 제목과 본문은 같은 x");
  fixPlan(sec, [{ kind: "overlap", fix: "layout", texts: ["큰 제목"] }], 1);
  assert.equal(sec.layers[2].style.size, 30.6, "두 번째는 25%");
});

test("plan 고치기: 높이가 사슬처럼 이어진 같은 역할 줄(37·41·42)은 한 묶음 — 튀는 1.6배 줄도 맞춤", () => {
  const sec = { type: "image", layers: [37, 41, 42, 37].map((h, i) => ({ ko: `라벨${i}`, role: "label", x: i * 200, y: 300, w: 150, h, style: { size: i === 2 ? 45 : 26 } })) };
  fixPlan(sec, [{ kind: "roleDev", fix: "layout", texts: ["라벨2", "라벨0"] }]);
  assert.deepEqual(sec.layers.map((l) => l.style.size), [26, 26, 26, 26]);
});

test("plan 고치기: 대비 → 테두리, A2 형식 크기(fontSizePx)도 읽음", () => {
  const sec = { type: "image", layers: [{ ko: "흰 라벨", role: "label", x: 0, y: 0, w: 100, h: 20, style: { color: "#ffffff", fontSizePx: 18 } }, { ko: "검정 라벨", role: "label", x: 0, y: 40, w: 100, h: 20, style: { color: "#111111", fontSizePx: 18 } }] };
  fixPlan(sec, [{ kind: "contrast", fix: "ink", texts: ["흰 라벨"] }, { kind: "contrast", fix: "ink", texts: ["검정 라벨"] }]);
  assert.match(sec.layers[0].style.outline, /rgba\(0,0,0/); assert.match(sec.layers[1].style.outline, /rgba\(255,255,255/);
  const s2 = { type: "image", layers: [{ ko: "가", role: "x", x: 0, y: 0, w: 10, h: 20, style: { fontSizePx: 20 } }] };
  fixPlan(s2, [{ kind: "overflow", fix: "layout", texts: ["가"] }]); assert.equal(s2.layers[0].style.size, 17);
});

test("다시 쓸 줄 · 대표 한 줄 · 요약", () => {
  const sec = { layers: [{ ko: "당신의 주방" }, { ko: "물 세척" }] };
  assert.deepEqual(rewriteTargets(sec, [{ kind: "literal", fix: "rewrite", texts: ["당신의 주방"] }]).map((l) => l.ko), ["당신의 주방"]);
  assert.equal(headline([{ kind: "colDev", why: "열" }, { kind: "chinese", why: "중국어 남음" }]), "중국어 남음");
  assert.deepEqual(summarize({ a: { pass: true, fixed: true }, b: { pass: false }, c: { pass: true } }), { checked: 3, flagged: 1, fixed: 1 });
});
