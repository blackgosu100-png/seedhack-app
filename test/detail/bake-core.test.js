// 🖼 통째 한글화(bake) 규칙 — 지시문·검수
import test from "node:test";
import assert from "node:assert/strict";
import { bakePrompt, verifyBake, numTokens, textHit, hanCount } from "../../src/main/detail/bake-core.js";

const L = [
  { zh: "足够快 才真省力", ko: "빨라야 진짜 편하다" },
  { zh: "600斤/1小时", ko: "시간당 300kg" },
  { zh: "约0.5-1%", ko: "약 0.5-1%" },
  { zh: "厂家直销", ko: "", drop: true },
];

test("지시문: 바꿀 글은 표로, 지울 글은 따로, 색·비율 유지 규칙 포함", () => {
  const p = bakePrompt(L);
  assert.match(p, /「足够快 才真省力」 → 「빨라야 진짜 편하다」/);
  assert.match(p, /지울 글[\s\S]*「厂家直销」/);
  assert.ok(!/「厂家直销」 →/.test(p), "지울 글은 바꿀 글 표에 없어야 한다");
  assert.match(p, /글자 색은 원본/);
  assert.match(p, /이미지 비율은 원본 그대로/);
  assert.match(bakePrompt(L, { retry: "숫자가 빠졌습니다" }), /앞선 결과에서 고칠 점: 숫자가 빠졌습니다/);
});

test("숫자 토큰: 소수·범위·단위", () => {
  assert.deepEqual(numTokens("약 0.5-1%"), ["0.5", "1"]);
  assert.deepEqual(numTokens("시간당 300kg"), ["300"]);
  assert.deepEqual(numTokens("2단 수납"), ["2"]);
  assert.deepEqual(numTokens("제품 1 소개"), []); // 단위 없는 한 자리 숫자는 보지 않는다
});

test("검수 통과: 문구·숫자가 그대로, 한자 없음", () => {
  const v = verifyBake({ layers: L, seenText: "빨라야 진짜 편하다 시간당 300kg 약 0.5-1%", ratio0: 0.5, ratio1: 0.495, drift: 4 });
  assert.equal(v.ok, true);
  assert.equal(v.numHit, 1);
});

test("검수 탈락: 한자 남음 · 숫자 빠짐 · 문구 다름 · 비율 · 사진 변형", () => {
  const ks = (v) => v.fails.map((f) => f.k);
  assert.ok(ks(verifyBake({ layers: L, seenText: "빨라야 진짜 편하다 시간당 300kg 약 0.5-1% 足够快才真省力厂家直销" })).includes("han"));
  assert.ok(ks(verifyBake({ layers: L, seenText: "빨라야 진짜 편하다 시간당 kg 약 %" })).includes("num"));
  assert.ok(ks(verifyBake({ layers: L, seenText: "과일 손질 팁 300 0.5 1" })).includes("text"));
  assert.ok(ks(verifyBake({ layers: L, seenText: "빨라야 진짜 편하다 시간당 300kg 약 0.5-1%", ratio0: 0.5, ratio1: 0.6 })).includes("ratio"));
  assert.ok(ks(verifyBake({ layers: L, seenText: "빨라야 진짜 편하다 시간당 300kg 약 0.5-1%", drift: 40 })).includes("drift"));
});

test("아이콘 속 한자 한두 글자는 봐준다(글자 3자 이하)", () => {
  assert.equal(verifyBake({ layers: L, seenText: "빨라야 진짜 편하다 시간당 300kg 약 0.5-1% 样 检" }).ok, true);
});

test("문구 비교는 띄어쓰기·문장부호에 느슨하다", () => {
  assert.ok(textHit("빨라야 진짜 편하다", "빨라야진짜 편하다!") >= 0.9);
  assert.ok(textHit("빨라야 진짜 편하다", "과일 손질 팁") < 0.2);
  assert.equal(hanCount("M1 碎渣率 10%"), 3);
});

// ✍ 장 단위 편집
import { applyEdit, renderEditInput } from "../../src/main/detail/bake-core.js";
const P = [
  { zh: "一般的切丁机只能切萝卜", ko: "일반 기계로는 무와 감자만", role: "body" },
  { zh: "M1采用特殊刀片", ko: "M1은 특수한 칼날 구조로", role: "body" },
  { zh: "600斤/1小时", ko: "시간당 300kg", role: "body" },
  { zh: "厂家直销", ko: "", drop: true },
  { zh: "芒果丁", ko: "망고 깍둑", role: "label" },
];
test("편집 적용: 묶음은 한 레이어로 합치고 나머지는 그대로", () => {
  const a = applyEdit(P, [{ idxs: [0, 1], ko: "무른 재료도 깔끔하게\nM1 특수 칼날", head: true }]);
  assert.equal(a.used, 1);
  assert.equal(a.layers.length, 4);
  assert.deepEqual(a.layers[0].block, [0, 1]);
  assert.equal(a.layers[0].head, true);
  assert.match(a.layers[0].zh, /萝卜\nM1/);
  assert.match(bakePrompt(a.layers), /첫째 줄만 굵은 소제목/);
});
test("편집 버림: 숫자 빠짐 · 없던 숫자 · 한자 · 지울 글 포함 · 금지 문구 · 더 길어짐", () => {
  const rej = (b, o) => applyEdit(P, [b], o).rejected.join(" ");
  assert.match(rej({ idxs: [0, 1], ko: "특수 칼날 구조", head: false }), /숫자 빠짐\(1\)/);
  assert.match(rej({ idxs: [1, 2], ko: "M1 시간당 300kg, 2배 빠름", head: false }), /없던 숫자\(2\)/);
  assert.match(rej({ idxs: [0], ko: "萝卜도 썰어요", head: false }), /한자/);
  assert.match(rej({ idxs: [4], ko: "망고 조각", head: false }), /고칠 이유 없음/); // 멀쩡한 한 줄은 건드리지 않는다
  assert.match(rej({ idxs: [3, 4], ko: "망고", head: false }), /지울 글/);
  assert.match(rej({ idxs: [0, 1], ko: "무·감자 최고 M1", head: false }, { banned: (t) => (/최고/.test(t) ? ["최고"] : []) }), /금지 문구/);
  assert.match(rej({ idxs: [0, 1], ko: "일반 기계로는 무와 감자만 썰 수 있지만 M1은 특수한 칼날 구조로 무른 재료까지 썹니다", head: false }), /더 길어짐/);
  assert.equal(applyEdit(P, [{ idxs: [1, 2], ko: "M1 특수 칼날\n1시간에 300kg", head: false }]).used, 1); // 원문(1小时)에 있는 숫자는 허용
  assert.equal(applyEdit([{ zh: "芒果/菠萝/凤梨切丁利器", ko: "망고/파인애플/파인애플 다이싱 툴", role: "title" }], [{ idxs: [0], ko: "망고·파인애플 깍둑썰기", head: false }]).used, 1); // 흠(슬래시·반복)이 있는 한 줄은 고친다
});
test("편집 입력: 지울 글은 (지움)으로 보인다", () => { assert.match(renderEditInput([{ id: "a", layers: P }]), /厂家直销 → \(지움\)/); });

test("편집: 슬래시 나열은 가운뎃점으로, 숫자/단위 슬래시는 그대로 · 여러 줄은 줄마다 따로 적는다", () => {
  assert.match(applyEdit(P, [{ idxs: [0, 1], ko: "무 / 감자 절단\nM1 칼날 600/1", head: false }]).rejected.join(""), /없던 숫자\(600\)/); // 숫자/숫자는 슬래시를 건드리지 않는다
  const b = applyEdit(P, [{ idxs: [0, 1], ko: "무 / 감자 절단\nM1 특수 칼날", head: false }]);
  assert.equal(b.layers[0].ko, "무 · 감자 절단"); assert.equal(b.layers[1].ko, "M1 특수 칼날"); // 줄 수가 그대로면 줄 단위로 푼다(자리·색 유지)
  assert.match(bakePrompt(b.layers), /가는 글은 가늘게/);
  assert.match(applyEdit(P, [{ idxs: [0, 1], ko: "무른 재료도\nM1 특수 칼날\n모양 그대로", head: true }]).rejected.join(""), /줄 수 넘침\(2→3줄\)/); // 자리보다 줄이 많으면 그림을 덮는다
  const h = applyEdit(P, [{ idxs: [0, 1, 2], ko: "무른 재료도\nM1 특수 칼날\n시간당 300kg", head: true }]);
  const hp = bakePrompt(h.layers); assert.match(hp, /아래 3줄로 나눠 씁니다 \(첫째 줄만 굵은 소제목/); assert.match(hp, /2째 줄: 「M1 특수 칼날」/); assert.ok(!/⏎| \/ /.test(hp.split("바꿀 글")[1]));
});
