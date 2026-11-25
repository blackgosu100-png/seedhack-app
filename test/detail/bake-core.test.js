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

// 👁 구글 비전 카피(2026-11-24)
import { VISION_COPY_SYSTEM, VISION_COPY_SCHEMA, renderVisionCopyInput, sanitizeVisionCopy, matchBakeBoxes, FONT_PRESETS } from "../../src/main/detail/bake-core.js";
import { bakeVisionCopy, bakeVisionCopyBatch } from "../../src/main/detail/bake.js";
import { sectionView, applyPatch, ACTIONS } from "../../src/main/detail/loc-edit.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("비전 카피 정화: 원문·직역·의역 보존 · 톤 정리(느낌표·슬래시) · 斤→kg 환산 허용 · 한자/금지어/지어낸 숫자 차단", () => {
  assert.match(VISION_COPY_SYSTEM, /설명조·구어체·홈쇼핑 멘트를 쓰지 않습니다/);
  assert.match(VISION_COPY_SYSTEM, /딱딱한 한자어·보고서\/매뉴얼식/);
  assert.match(renderVisionCopyInput({ brief: { product_name_ko: "테스트 상품", key_appeal: "핵심 장점" } }), /테스트 상품/);
  assert.ok(VISION_COPY_SCHEMA.required.includes("promo"));
  assert.ok(VISION_COPY_SCHEMA.properties.items.items.required.includes("literal"));
  assert.ok(FONT_PRESETS.some((f) => f.id === "serif"));

  const ok = sanitizeVisionCopy({
    promo: false,
    promo_reason: "",
    items: [
      { zh: "大料口真商用", literal: "큰 재료 투입구 진짜 상업용", ko: "대형 투입구, 진짜 업소용!", role: "title", head: false, drop: false },
      { zh: "切丁/切丝/切片", literal: "깍둑/채/편 썰기", ko: "깍둑썰기/채썰기/편썰기", role: "sub", head: false, drop: false },
      { zh: "600斤/1小时", literal: "600근/1시간", ko: "시간당 300kg 처리", role: "label", head: false, drop: false },
      { zh: "小贴士：说明文字", literal: "작은 팁: 설명 문구", ko: "사용 안내\n부드러운 재료도 모양 그대로 유지합니다.", role: "body", head: true, drop: false },
      { zh: "晒图返现", literal: "사진 후기 현금 환급", ko: "", role: "label", head: false, drop: true },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.promo, false);
  assert.equal(ok.layers.length, 5);
  assert.equal(ok.layers[0].ko, "대형 투입구, 진짜 업소용"); // 제목 끝 느낌표 제거
  assert.equal(ok.layers[0].literal, "큰 재료 투입구 진짜 상업용");
  assert.equal(ok.layers[0].ko_ai, "대형 투입구, 진짜 업소용");
  assert.equal(ok.layers[1].ko, "깍둑썰기 · 채썰기 · 편썰기"); // 슬래시 → 가운뎃점
  assert.equal(ok.layers[2].ko, "시간당 300kg 처리"); // 600斤 → 300kg 허용
  assert.equal(ok.layers[3].head, true);
  assert.equal(ok.layers[4].drop, true);
  const bp = bakePrompt([{ ...ok.layers[0], style: { color: "#b91c1c", font: "serif", weight: 700 } }, ...ok.layers.slice(1)]);
  assert.match(bp, /사용자 지정 스타일: 글자색 #b91c1c, 글꼴 단정한 명조체\(세리프\), 굵게/);
  assert.match(bp, /첫째 줄만 굵은 소제목/);
  assert.match(bp, /지울 글[\s\S]*「晒图返现」/);

  const bad = sanitizeVisionCopy({
    promo: false,
    promo_reason: "",
    items: [
      { zh: "加厚设计", ko: "加厚 튼튼한 설계", role: "title", head: false, drop: false },
      { zh: "加厚设计", ko: "최고 100% 튼튼함", role: "title", head: false, drop: false },
      { zh: "加厚设计", ko: "하중 50kg 견딤", role: "title", head: false, drop: false },
      { zh: "耐用材质", ko: "튼튼한 소재", role: "label", head: false, drop: false },
    ],
  }, { banned: (t) => (/최고/.test(t) ? ["최고"] : []) });
  assert.equal(bad.ok, true);
  assert.equal(bad.layers.length, 1);
  assert.equal(bad.rejected.length, 3);
  assert.match(bad.rejected.join(" | "), /한자 남음/);
  assert.match(bad.rejected.join(" | "), /금지 문구/);
  assert.match(bad.rejected.join(" | "), /없던 숫자\(50\)/);

  const pr = sanitizeVisionCopy({ promo: true, promo_reason: "사은품·후기 이벤트", items: [] });
  assert.equal(pr.ok, true);
  assert.equal(pr.promo, true);
  assert.equal(pr.promo_reason, "사은품·후기 이벤트");
});

test("비전 카피 호출·배치: 모의 응답으로 정상 변환 · 홍보 이미지 판정 · 404 모델 폴백", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-vc-test-"));
  const imgF = path.join(tmpDir, "a.png");
  // 최소 1x1 PNG
  fs.writeFileSync(imgF, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const auth = {
    engine: "google",
    url: "https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-3-pro-image:generateContent",
    textUrl: (m) => `https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/${m}:generateContent`,
    headers: { "Content-Type": "application/json" },
  };
  let calls = 0;
  const mockFetch = async (url) => {
    calls++;
    if (calls === 1 && /gemini-3\.1-pro-preview/.test(url)) {
      return { ok: false, status: 404, json: async () => ({ error: { message: "not found" } }) };
    }
    const payload = calls === 3
      ? { promo: true, promo_reason: "리뷰 이벤트", items: [] }
      : { promo: false, promo_reason: "", items: [{ zh: "大料口", ko: "대형 투입구", role: "title", head: false, drop: false }] };
    return {
      ok: true, status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
      }),
    };
  };
  try {
    const r1 = await bakeVisionCopy({ file: imgF, auth, fetchImpl: mockFetch });
    assert.equal(r1.ok, true);
    assert.equal(r1.layers[0].ko, "대형 투입구");
    assert.ok(r1.costUsd > 0);
    const batch = await bakeVisionCopyBatch({
      items: [{ id: "d01", file: imgF }, { id: "d02", file: imgF }],
      auth, concurrency: 2, fetchImpl: mockFetch,
    });
    assert.equal(batch.okCount, 2);
    assert.equal(batch.promoIds.length, 1);
    assert.equal(batch.fails.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("좌표 매칭 · 즉시 편집 패치 · 원문/직역/의역 sectionView", () => {
  assert.ok(ACTIONS.includes("rebake"));
  const matched = matchBakeBoxes(
    [
      { zh: "大料口真商用", literal: "큰 투입구 진짜 상업용", ko: "대형 투입구 업소용", role: "title", drop: false },
      { zh: "切丁切丝", literal: "깍둑썰기 채썰기", ko: "깍둑썰기·채썰기", role: "sub", drop: false },
    ],
    {
      seenBoxes: [{ text: "대형 투입구 업소용", x: 100, y: 80, w: 600, h: 90 }],
      origBoxes: [{ text: "切丁切丝", x: 50, y: 120, w: 300, h: 30 }],
      w0: 400, h0: 600, w1: 800, h1: 1200,
    }
  );
  assert.deepEqual(matched[0].box, { x: 100, y: 80, w: 600, h: 90 }); // 결과 OCR 에서 바로 매칭
  assert.deepEqual(matched[1].box, { x: 100, y: 240, w: 600, h: 60 }); // 없으면 원본 OCR 좌표를 비율 환산

  const plan = {
    sections: [{
      id: "d02", type: "image", image: "localize/d02-bake.png", iw: 800, ih: 1200,
      bake: {
        baseImage: "localize/d02-bake.png",
        layers: [{ ...matched[0], ko_ai: "대형 투입구 업소용", style: { color: "#111111", size: 64, weight: 700, font: "bold", align: "center" } }],
      },
    }],
  };
  const v = sectionView(plan, "d02");
  assert.equal(v.baked, true);
  assert.equal(v.layers[0].zh, "大料口真商用");
  assert.equal(v.layers[0].literal, "큰 투입구 진짜 상업용");
  assert.equal(v.layers[0].ko_ai, "대형 투입구 업소용");
  assert.equal(v.layers[0].color, "#111111");
  assert.equal(v.layers[0].font, "bold");
  assert.deepEqual(v.layers[0].box, { x: 100, y: 80, w: 600, h: 90 });

  const target = plan.sections[0].bake.layers[0];
  const changed = applyPatch(target, { ko: "넓은 투입구 업소용", color: "#B91C1C", font: "serif", size: 72, align: "left" });
  assert.equal(changed, true);
  assert.equal(target.ko, "넓은 투입구 업소용");
  assert.equal(target.style.color, "#b91c1c");
  assert.equal(target.style.userColor, true);
  assert.equal(target.style.font, "serif");
  assert.equal(target.style.size, 72);
  assert.equal(target.style.align, "left");
});

test("429 페이서: 워커 시작 간격 분산 · 공유 쿨다운 · Retry-After 헤더 해석", async () => {
  const { createBakePacer, parseRetryAfter } = await import("../../src/main/detail/bake.js");
  assert.equal(parseRetryAfter("12"), 12000);
  assert.equal(parseRetryAfter("1"), 2000); // 최소 2초 클램프
  assert.equal(parseRetryAfter("120"), 60000); // 최대 60초 클램프
  assert.equal(parseRetryAfter(""), null);

  let clock = 10000;
  const sleeps = [];
  const pacer = createBakePacer({
    minGapMs: 4500,
    jitterMs: 0,
    now: () => clock,
    sleepFn: async (ms) => { sleeps.push(ms); clock += ms; },
  });
  const starts = [];
  await Promise.all([
    pacer.beforeCall().then(() => starts.push(clock)),
    pacer.beforeCall().then(() => starts.push(clock)),
  ]);
  assert.deepEqual(starts, [10000, 14500]); // 두 워커가 동시에 쏘지 않고 4.5초 간격으로 분산

  // 한 워커가 429(Retry-After: 15) 받으면 다른 워커도 공유 쿨다운 끝난 뒤에 요청
  const w = pacer.onRateLimit(0, "15");
  assert.equal(w, 15000);
  await pacer.beforeCall();
  assert.equal(clock, 29500);
});
