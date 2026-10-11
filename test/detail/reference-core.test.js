// 레퍼런스 자동 템플릿(1단계 POC) 단위테스트 — node --test test/detail/reference-core.test.js
// 손잡이 정규화 · 섹션 자리 보정 · 레퍼런스 순서 → 우리 레시피 · 키커 번호 · 벤치마킹 가이드 · 표절 가드(3-gram) · 카피 가드(AI 없이 규칙·예비 문구)
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTokens, refRecipe, applyReferenceOrder, refKickers, kickerWord, referenceGuide, similarTo, guardSimilarity, refLinesFromOcr, claimsFromLines, styleFromSections, locateSections, getPath, setPath, TOKEN_ENUM } from "../../src/main/detail/reference-core.js";
import { planSectionsV5, buildPlanV5 } from "../../src/main/detail/plan-core.js";
import { guardCopySimilarity, rulesCopyV5 } from "../../src/main/detail/copy.js";
import { renderCopyInputV5 } from "../../src/main/detail/copy-prompt.js";

const BRIEF = { product_name_ko: "폭조절 풀아웃 커피용품 수납랙", product_type: "커피용품 수납랙", key_appeal: "틈새에 맞춰 폭을 늘려 쓰는 수납랙", advantages: ["폭 37~57.5cm 조절", "풀아웃 서랍", "대용량 수납", "먼지·습기 관리"], specs: [{ k: "폭", v: "37~57.5cm" }, { k: "재질", v: "탄소강" }] };
const REF = { // 클린맥스 레퍼런스(비전 결과 모양) 축약
  sections: [
    { order: 1, our_type: "hero", role: "첫 화면", angle: "성능 수치 + 결과로 즉시 전달", kicker: "", title: "750Hz 초강력 진동 묵은 때까지 싹" },
    { order: 2, our_type: "versatility", role: "용도", angle: "여러 용도를 한눈에", kicker: "", title: "안경부터 메이크업브러쉬까지 뭐든지 OK" },
    { order: 3, our_type: "compare", role: "구형 vs 신형", angle: "새 버전의 차이", kicker: "UPGRADE 1", title: "집에서 새 것처럼" },
    { order: 4, our_type: "feature", role: "장점", angle: "번거로움 제거", kicker: "UPGRADE 2", title: "충전 대기 ZERO" },
    { order: 5, our_type: "trust", role: "판매 실적", angle: "실적", kicker: "", title: "7차 완판" },
    { order: 6, our_type: "problem", role: "고민", angle: "고민 공감 → 질문", kicker: "", title: "이걸 한 번에 해결할 순 없을까?" },
    { order: 7, our_type: "feature", role: "신제품", angle: "제품 등장", kicker: "2026 신제품", title: "더루마 클린맥스 3.0" },
    { order: 8, our_type: "before_after", role: "차이", angle: "전후 차이 증명", kicker: "Difference 1", title: "닦지 마세요! 초강력 진동 세척" },
    { order: 9, our_type: "before_after", role: "차이2", angle: "눈으로 비교", kicker: "Difference 2", title: "직접 보세요! 선명함의 차이" },
    { order: 10, our_type: "feature", role: "장점", angle: "수치로 과학성", kicker: "POINT 2", title: "3D로 퍼지는 360° 입체 세척" },
    { order: 11, our_type: "feature", role: "장점", angle: "넷째 장점", kicker: "POINT 3", title: "빠른 세척" },
    { order: 12, our_type: "faq", role: "FAQ", angle: "구매 전 의문 해소", kicker: "QnA", title: "자주 묻는 질문" },
    { order: 13, our_type: "notice", role: "주의", angle: "주의", kicker: "", title: "사용 불가 품목 안내" },
    { order: 14, our_type: "spec", role: "스펙", angle: "스펙", kicker: "", title: "제품 상세정보" },
  ],
  copy: { title_len: 9, two_line: true, tone: "짧고 단정", problem_frame: "고민 나열 → 질문", selling_points: ["수치로 성능 증명", "번거로움 제거"], chain: "공감 → 질문 → 해결 → 증명" },
  avoid: ["7차 완판", "연구 개발 비용 2억", "KC 인증 B052R792-3008"],
  ocr_lines: ["이걸 한 번에 해결할 순 없을까?", "닦지 마세요! 초강력 진동 세척", "3D로 퍼지는 360° 입체 세척", "- 색상은 모니터의 사양 및 실내 조명에 따라 다소 차이가 있을 수 있습니다.", "Q. 세척 시간은 얼마나 걸리나요?", "자주 묻는 질문"],
};

test("R-1 손잡이: 측정값(색·정렬·여백·글자 크기) 우선, 모양은 비전, enum 밖 값은 기본값 · 브랜드 없으면 무채색 대안", () => {
  const t = normalizeTokens({ bg: "#ffffff", brand: "#045cc5", brandShare: 0.049, darkRatio: 0.06, align: { center: 88, left: 54 }, gapPx: 119, titlePx: 47, panel: "#e9e9e9", panelRatio: 0.02 }, { kicker: "pill-dark", bands: "alternate", problem: "dark-bubble", photo: "full", emph: "line-color", icons: "brand-fill", panel: "cards", hero: "above", notice: "dark", brand_usage: "bands", title_weight: 800 });
  assert.equal(t.colors.brand, "#045cc5"); assert.equal(t.align, "center"); assert.equal(t.spacing, "normal"); assert.equal(t.title_size, 47);
  assert.equal(t.bands, "alternate"); assert.equal(t.icons, "brand-fill"); assert.equal(t.kicker, "pill-dark");
  for (const k of Object.keys(TOKEN_ENUM)) if (k !== "spacing") assert.ok(TOKEN_ENUM[k].includes(t[k]), `${k}=${t[k]}`);
  // 브랜든형: 브랜드 후보가 사진 색(비전 none·면적 작음) → 없음, 왼쪽 정렬, 여백 넓음, 회색 판, 글→사진 히어로면 회색 한 줄
  const b = normalizeTokens({ bg: "#ffffff", brand: "#bc7344", brandShare: 0.011, darkRatio: 0.015, align: { center: 73, left: 127 }, gapPx: 181, titlePx: 36, panel: "#f2f2f1", panelRatio: 0.148 }, { kicker: "pill-brand", emph: "line-color", icons: "none", panel: "lines", hero: "above", brand_usage: "none", title_weight: 700 });
  assert.equal(b.colors.brand, null); assert.equal(b.align, "left"); assert.equal(b.spacing, "airy"); assert.equal(b.panel, "gray"); assert.equal(b.icons, "text-line");
  assert.equal(b.kicker, "pill-dark", "브랜드 색 없는 알약 → 어두운 알약"); assert.equal(b.emph, "weight");
  const z = normalizeTokens({}, { kicker: "rainbow", photo: 3 });
  assert.equal(z.kicker, "none"); assert.equal(z.photo, "full"); assert.equal(z.colors.bg, "#ffffff");
});

test("R-2 섹션 자리 보정: 제목을 OCR 에서 찾아 바탕을 재고 → 문제 띠·주의 검정·키커 유무·히어로 글 자리", () => {
  const boxes = [{ y: 10, h: 20, x: 0.1, w: 0.8, text: "750Hz 초강력 진동" }, { y: 32, h: 20, x: 0.1, w: 0.8, text: "묵은 때까지 싹" }, { y: 300, h: 20, x: 0.2, w: 0.6, text: "이걸 한 번에" }, { y: 322, h: 20, x: 0.2, w: 0.6, text: "해결할 순 없을까?" }, { y: 600, h: 20, x: 0.1, w: 0.5, text: "사용 불가 품목 안내" }];
  const rows = Array.from({ length: 800 }, (_, y) => (y >= 270 && y < 380) || y >= 580 ? { lum: 0.1, share: 0.9, sat: 0.05 } : { lum: 0.98, share: 0.95, sat: 0 });
  const secs = locateSections([{ our_type: "hero", title: "750Hz 초강력 진동 묵은 때까지 싹" }, { our_type: "problem", title: "이걸 한 번에 해결할 순 없을까?" }, { our_type: "notice", title: "사용 불가 품목 안내" }, { our_type: "feature", title: "없는 제목 문장" }], boxes, rows, 1);
  assert.deepEqual(secs.map((s) => s.bg), ["light", "dark", "dark", undefined]);
  const st = styleFromSections([...secs, { our_type: "feature", kicker: "POINT 1" }, { our_type: "feature", kicker: "POINT 2" }], { problem: "plain", notice: "same", hero: "on-photo", kicker: "none" });
  assert.equal(st.problem, "dark-bubble"); assert.equal(st.notice, "dark"); assert.equal(st.hero, "above"); assert.equal(st.kicker, "pill-dark");
  assert.equal(styleFromSections([{ our_type: "feature", kicker: "" }], { kicker: "pill-dark" }).kicker, "none", "영문 키커가 없으면 키커 없음");
});

test("R-3 레퍼런스 순서 → 우리 레시피: 재료 없는 섹션(compare·trust) 버림, feature 3개 상한, 같은 종류 반복은 앞 섹션에 합침", () => {
  const { recipe, dropped } = refRecipe(REF);
  assert.deepEqual(recipe.map((r) => r.type), ["hero", "versatility", "feature", "problem", "feature", "before_after", "feature", "faq", "notice", "spec"]);
  assert.ok(dropped.some((d) => d.our_type === "compare") && dropped.some((d) => d.our_type === "trust"));
  assert.ok(dropped.some((d) => /feature 3개 초과/.test(d.why)), "넷째 feature 는 합침");
  assert.equal(recipe.find((r) => r.type === "before_after").extra[0], "눈으로 비교", "Difference 2 각도는 앞 before_after 에 덧붙임");
  assert.deepEqual(kickerWord("POINT 2"), { word: "POINT", numbered: true }); assert.deepEqual(kickerWord("CHECK POINT"), { word: "CHECK POINT", numbered: false }); assert.equal(kickerWord("2026 신제품"), null);
});

test("R-4 planSectionsV5(reference): 레퍼런스 순서대로, hero 맨 앞, 레퍼런스에 없는 checkpoint·detail 은 빼고 spec·notice 는 남김, 지난 섹션 id 유지", () => {
  const plain = planSectionsV5({ brief: BRIEF });
  const secs = planSectionsV5({ brief: BRIEF, reference: REF, prev: plain });
  assert.deepEqual(secs.map((s) => s.type), ["hero", "versatility", "feature", "problem", "feature", "before_after", "feature", "faq", "notice", "spec"]);
  assert.ok(!secs.some((s) => s.type === "checkpoint" || s.type === "detail"));
  assert.ok(secs.refRemoved.some((r) => r.type === "checkpoint"));
  for (const s of secs) assert.ok(plain.some((p) => p.id === s.id), `id 유지 ${s.id}`);
  assert.equal(secs.find((s) => s.type === "before_after").ref.angle, "전후 차이 증명");
  // 레퍼런스가 없으면 그대로(기존 동작)
  assert.deepEqual(planSectionsV5({ brief: BRIEF, reference: null }).map((s) => s.type), plain.map((s) => s.type));
  // 레퍼런스 순서가 비어 있으면 그대로
  assert.deepEqual(applyReferenceOrder(plain, { sections: [] }).sections.map((s) => s.type), plain.map((s) => s.type));
});

test("R-5 키커: 레퍼런스 낱말을 종류별로 번호 매김, 주장성 낱말(UPGRADE·NEW)·한글 키커는 같은 종류 낱말로 · buildPlanV5 에 반영", () => {
  const secs = planSectionsV5({ brief: BRIEF, reference: REF });
  const ks = refKickers(secs);
  assert.deepEqual(secs.map((s, i) => [s.type, ks[i]]).filter(([, k]) => k), [["feature", "POINT 1"], ["feature", "POINT 2"], ["before_after", "Difference 1"], ["feature", "POINT 3"], ["faq", "QnA"]]);
  const copy = { sections: Object.fromEntries(secs.map((s) => [s.id, s.type === "faq" ? { items: [{ q: "q", a: "a" }] } : s.type === "notice" ? { items: ["안내"] } : s.type === "problem" ? { question: "질문?" } : { title: "제목" }])) };
  const plan = buildPlanV5({ sections: secs, copy });
  assert.deepEqual(plan.sections.filter((s) => s.type === "feature").map((s) => s.kicker), ["POINT 1", "POINT 2", "POINT 3"]);
  assert.equal(plan.sections.find((s) => s.type === "versatility").kicker, "USAGE", "레퍼런스 키커가 없는 섹션은 기본 키커");
});

test("R-6 벤치마킹 가이드: 순서·각도·리듬·피할 주장 · 문장·사실 복사 금지 규칙 · 징검다리 순서 · 카피 입력 섹션 줄에 '벤치마킹' 칸", () => {
  const secs = planSectionsV5({ brief: BRIEF, reference: REF });
  const g = referenceGuide(REF, secs);
  assert.match(g, /벤치마킹 가이드/); assert.match(g, /문장·표현·고유 명칭·숫자/); assert.match(g, /7차 완판/); assert.match(g, /줄당 약 9자/);
  assert.match(g, /징검다리 순서는 레퍼런스 순서/); assert.match(g, /feature → problem\.question → feature → before_after\.title → feature/);
  const txt = renderCopyInputV5({ images: [] }, BRIEF, secs, g);
  assert.match(txt, /- before_after · 사진: .* · 벤치마킹: 전후 차이 증명 \(\+ 눈으로 비교\)/);
  assert.equal(referenceGuide({ sections: [] }), "");
  assert.ok(!/- hero.*벤치마킹/.test(renderCopyInputV5({ images: [] }, BRIEF, planSectionsV5({ brief: BRIEF }))), "레퍼런스 없으면 기존 입력 그대로");
});

test("R-7 표절 가드: 그대로·살짝 바꾼 문장은 잡고, 흔한 안내 말끝·질문 꼴·우리 상품 낱말 겹침은 통과", () => {
  const L = REF.ocr_lines;
  assert.ok(similarTo("이걸 한 번에 해결할 순 없을까?", L), "그대로 복사");
  assert.ok(similarTo("이걸 한번에 해결할 수는 없을까", L), "띄어쓰기·어미만 바꿈");
  assert.ok(similarTo("3D로 퍼지는 360도 입체 세척", L), "살짝 바꿈");
  assert.equal(similarTo("수작업 측정으로 치수에 약간의 오차가 있을 수 있습니다.", L), null, "흔한 말끝(있을 수 있습니다)");
  assert.equal(similarTo("배송은 얼마나 걸리나요?", L), null, "질문 꼴(얼마나 걸리나요)");
  assert.equal(similarTo("자주 묻는 질문", L), null, "흔한 라벨");
  assert.equal(similarTo("맞춘 다음엔 어떻게 꺼낼까?", L), null, "새로 쓴 질문");
  // 우리 상품 사실 낱말(같은 카테고리 명사)은 겹쳐도 표절 아님
  assert.equal(similarTo("커피용품 수납랙 폭 조절", ["커피용품 수납랙 폭 조절 가능 제품"], { ours: "커피용품 수납랙 폭 조절" }), null);
  const g = guardSimilarity({ problem: { question: "이걸 한 번에 해결할 순 없을까?" }, features: [{ title: "빈틈없이 채우는\n3D로 퍼지는 360° 입체 세척" }], sections: { x: { title: "이걸 한 번에 해결할 순 없을까?" } } }, L);
  assert.deepEqual(g.flagged.map((f) => f.path), ["problem.question", "features[0].title"], "sections(중복 사본)는 검사하지 않음 · 2줄 제목은 줄마다");
});

test("R-8 카피 가드(AI 없이): 비슷한 줄 → 규칙 문구, 규칙도 비슷하면 예비 문구 · 남은 비슷한 줄 0", async () => {
  const secs = planSectionsV5({ brief: BRIEF, reference: REF });
  const copy = rulesCopyV5({}, BRIEF, secs);
  copy.problem.question = "이걸 한 번에 해결할 순 없을까?"; // 규칙 문구도 같은 문장 → 예비 문구로
  copy.features[1].title = "3D로 퍼지는\n360° 입체 세척";
  const r = await guardCopySimilarity(copy, REF, { brief: BRIEF, sections: secs, useCli: false });
  assert.equal(r.report.flagged.length, 2);
  assert.equal(r.report.final.length, 0);
  assert.notEqual(r.copy.problem.question, "이걸 한 번에 해결할 순 없을까?");
  assert.ok(/\?$/.test(r.copy.problem.question));
  assert.ok(!/360/.test(r.copy.features[1].title));
  assert.ok(r.fixes.some((f) => /레퍼런스와 비슷함/.test(f)));
  // 깨끗한 카피는 그대로
  const clean = await guardCopySimilarity(rulesCopyV5({}, BRIEF, secs), { ...REF, ocr_lines: ["전혀 다른 상품 문장입니다"] }, { brief: BRIEF, sections: secs, useCli: false });
  assert.equal(clean.report.flagged.length, 0);
});

test("R-9 OCR 줄·근거 주장·경로 도구", () => {
  const lines = refLinesFromOcr({ images: [{ boxes: [{ text: "이걸 한 번에", y: 0, h: 20 }, { text: "해결할 순 없을까?", y: 22, h: 20 }, { text: "ABC", y: 100, h: 10 }] }] });
  assert.ok(lines.includes("이걸 한 번에 해결할 순 없을까?"), "이웃 줄 이어 붙임"); assert.ok(!lines.includes("ABC"));
  assert.deepEqual(claimsFromLines(["7차 완판", "KC 인증 B052R792-3008", "부드러운 세척", "쿠팡 1위"]), ["7차 완판", "KC 인증 B052R792-3008", "쿠팡 1위"]);
  const o = { features: [{ title: "a" }] }; setPath(o, "features[0].title", "b"); setPath(o, "hero.icons[1].label", "c");
  assert.equal(getPath(o, "features[0].title"), "b"); assert.equal(o.hero.icons[1].label, "c");
});
