import { test } from "node:test";
import assert from "node:assert/strict";
import { placeProduct, touchesEdge, boxesToErase, isDimText, parseDims, dimsGrounded, fmtDim, pickHero, inspectHero, judgeThumb, summarizeSet, sceneBackgroundPrompt, tidyOptionLabel, THUMB_SIZE } from "../../src/main/detail/thumb-core.js";

test("placeProduct: 긴 변이 85%, 가운데, 가장자리 여백", () => {
  const r = placeProduct({ w: 400, h: 800 });
  assert.equal(r.h, 850); assert.equal(r.w, 425);
  assert.ok(r.x > 0 && r.x + r.w < THUMB_SIZE && r.y >= 30 && r.y + r.h < THUMB_SIZE);
  assert.equal(placeProduct({ w: 0, h: 10 }), null);
});

test("touchesEdge: 원본 가장자리에 닿은 제품 = 잘림 의심", () => {
  assert.equal(touchesEdge({ x: 0, y: 10, w: 100, h: 100 }, 800, 800), true);
  assert.equal(touchesEdge({ x: 79, y: 0, w: 582, h: 807 }, 750, 1000), true);
  assert.equal(touchesEdge({ x: 72, y: 172, w: 672, h: 528 }, 800, 800), false);
});

test("boxesToErase: 제품 상자 안 글자만, 치수 표시는 dim 표시", () => {
  const boxes = [{ x: 423, y: 83, w: 75, h: 23, text: "10.5cm" }, { x: 21, y: 40, w: 239, h: 60, text: "90型单口" }, { x: 370, y: 189, w: 51, h: 10, text: "PIADLIEK" }];
  const r = boxesToErase(boxes, { x: 309, y: 30, w: 483, h: 522 });
  assert.deepEqual(r.map((b) => b.text), ["10.5cm", "PIADLIEK"]);
  assert.equal(r[0].dim, true); assert.equal(r[1].dim, false);
  assert.deepEqual(boxesToErase(boxes, { x: 309, y: 30, w: 483, h: 522 }, { all: false }).map((b) => b.text), ["10.5cm"]);
  assert.ok(isDimText("38CM") && isDimText("27.5 cm") && !isDimText("1500W"));
});

test("parseDims·dimsGrounded: 원본 글에 있는 숫자만 통과", () => {
  const d = parseDims("제품 크기: 38×27.5×27.5cm(수동 측정)");
  assert.deepEqual(d[0].nums, [38, 27.5, 27.5]); assert.equal(d[0].unit, "cm");
  assert.equal(parseDims("30*20 mm")[0].unit, "mm");
  const src = "제품 크기: 38×27.5×27.5cm";
  assert.equal(dimsGrounded({ width: 27.5, height: 38, depth: 27.5 }, src), true);
  assert.equal(dimsGrounded({ width: 27, height: 38 }, src), false); // 27.5 의 일부(27)는 근거 아님
  assert.equal(dimsGrounded({ width: 40, height: 38 }, src), false);
  assert.equal(dimsGrounded({}, src), false);
  assert.equal(dimsGrounded({ width: "37~57.5", height: "13.5/20.5" }, "폭 37~57.5cm, 높이 13.5cm / 20.5cm"), true);
  assert.equal(dimsGrounded({ width: "37~60" }, "폭 37~57.5cm"), false);
  assert.equal(fmtDim("37~57.5", "cm"), "37~57.5cm"); assert.equal(fmtDim(38), "38cm");
});

test("pickHero: 손·잘림·다른 제품 제외, 단일 제품·사선 우선", () => {
  const base = { whole_product: true, single_unit: true, hands_or_people: false, extra_items: false, overlay_text: false, same_product: true, view: "front", score: 4 };
  const c = [
    { id: "g02", kind: "gallery", coverage: 0.4, v: { ...base, hands_or_people: true, score: 5 } },
    { id: "g04", kind: "gallery", coverage: 0.1, v: { ...base, single_unit: false } },
    { id: "o04", kind: "option", coverage: 0.3, v: { ...base, view: "angle" } },
    { id: "g05", kind: "gallery", coverage: 0.3, touchesEdge: true, v: { ...base, score: 5 } },
  ];
  assert.equal(pickHero(c).id, "o04");
  assert.equal(pickHero([c[0]]), null);
});

function bitmap(w, h, paint) { const data = Buffer.alloc(w * h * 4, 255); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = paint(x, y); if (v != null) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; } } return { data, w, h }; }
test("inspectHero: 순백 가장자리·잘림·채움", () => {
  const ok = inspectHero(bitmap(1000, 1000, (x, y) => (x > 80 && x < 920 && y > 60 && y < 900 ? 90 : null)));
  assert.equal(ok.issues.length, 0); assert.ok(ok.fill > 0.8);
  const cut = inspectHero(bitmap(1000, 1000, (x, y) => (x > 80 && x < 920 && y > 60 ? 90 : null)));
  assert.ok(cut.issues.some((i) => i.level === "bad"));
  const small = inspectHero(bitmap(1000, 1000, (x, y) => (x > 400 && x < 600 && y > 400 && y < 600 ? 90 : null)));
  assert.ok(small.issues.some((i) => i.level === "warn"));
});

test("judgeThumb·summarizeSet", () => {
  assert.equal(judgeThumb("hero", { vc: { same_product: true, product_cut_off: false, other_brand_logo: false, any_text: false, looks_natural: true } }).status, "ok");
  assert.equal(judgeThumb("scene", { vc: { same_product: false } }).status, "bad");
  assert.equal(judgeThumb("scene", { vc: { same_product: true, looks_natural: false } }).status, "warn");
  assert.equal(judgeThumb("hero", { bytes: 4 * 1048576 }).status, "bad");
  const s = summarizeSet([{ id: "hero", kind: "hero", status: "warn" }, { id: "size", kind: "size", status: "ok" }, { id: "scene", kind: "scene", status: "bad" }]);
  assert.equal(s.recommended, "hero"); assert.equal(s.bad, 1); assert.equal(s.pass, 1);
});

test("sceneBackgroundPrompt: 빈 자리·글자/로고 금지·소품 3개까지", () => {
  const p = sceneBackgroundPrompt({ props: ["a", "b", "c", "d"] });
  assert.match(p, /EMPTY/); assert.match(p, /no logos/); assert.ok(!p.includes(", d"));
  assert.equal(tidyOptionLabel("【무료배송】 쌍구형"), "쌍구형");
});

test("IPR·소구점: 쿠팡 엠블럼·로켓배송·무료반품 금지, 숫자는 원문 근거", async () => {
  const { hasIprText, appealOk } = await import("../../src/main/detail/thumb-core.js");
  for (const t of ["로켓배송", "무료 반품", "쿠팡추천", "BEST", "베스트 상품", "판매 1위", "최저가"]) assert.equal(hasIprText(t), true, t);
  assert.equal(hasIprText("칼날 분리 세척"), false);
  assert.equal(appealOk("1100W 강력 모터", "모터 출력: 1100W~1500W"), true);
  assert.equal(appealOk("2000W 모터", "모터 출력: 1100W~1500W"), false);
  assert.equal(appealOk("로켓배송 가능", "로켓배송"), false);
  assert.equal(appealOk("아주아주아주긴소구점라벨입니다요", ""), false);
});

test("orderItems·pickDetailSections: 연출 먼저, 추가 9장까지, 상세는 머리·스펙 빼고 고르게", async () => {
  const { orderItems, pickDetailSections } = await import("../../src/main/detail/thumb-core.js");
  const its = ["detail", "size", "hero", "scene", "scene_person", "appeal", "bcut", "detail", "detail", "detail", "detail", "options"].map((kind, i) => ({ kind, i }));
  const o = orderItems(its);
  assert.deepEqual(o.slice(0, 4).map((x) => x.kind), ["hero", "scene_person", "scene", "appeal"]);
  assert.equal(o.length, 10);
  const secs = [{ type: "hero", y: 0 }, { type: "feature", y: 1000 }, { type: "feature", y: 1100 }, { type: "detail", y: 1600 }, { type: "spec", y: 2600 }, { type: "faq", y: 3000 }];
  const p = pickDetailSections(secs, 3500, 5);
  assert.deepEqual(p.map((s) => s.type), ["feature", "detail"]); // 100짜리 띠·머리·스펙·FAQ 제외
  assert.equal(pickDetailSections(secs, 3500, 0).length, 0);
});

test("pickBcut: 옵션 사진만, 색 분포가 대표와 비슷해야", async () => {
  const { pickBcut, colorHist, histMatch } = await import("../../src/main/detail/thumb-core.js");
  const v = { whole_product: true, single_unit: true, hands_or_people: false, extra_items: false, overlay_text: false, same_product: true, view: "angle", score: 4 };
  const hero = { id: "g06" };
  const c = [{ id: "g10", kind: "gallery", match: 0.73, coverage: 0.3, v }, { id: "o04", kind: "option", match: 0.75, coverage: 0.3, v }, { id: "o99", kind: "option", match: 0.4, coverage: 0.3, v: { ...v, score: 5 } }];
  assert.equal(pickBcut(c, hero).id, "o04");
  assert.equal(pickBcut([c[0], c[2]], hero), null);
  const px = (r, g, b) => Buffer.from([b, g, r, 255]);
  const grey = { data: Buffer.concat(Array(8).fill(px(150, 150, 150))) }, white = { data: Buffer.concat(Array(8).fill(px(250, 250, 250))) };
  assert.equal(histMatch(colorHist(grey, 1), colorHist(grey, 1)), 1);
  assert.equal(histMatch(colorHist(grey, 1), colorHist(white, 1)), 0);
});

test("applyEdit·exportPick: 대표는 흰 바탕만, 빼기·순서는 보이는 장끼리, 내보내기 = 대표 + 추가 9", async () => {
  const { applyEdit, exportPick } = await import("../../src/main/detail/thumb-core.js");
  const its = [{ id: "hero", kind: "hero", status: "ok" }, { id: "scene", kind: "scene", status: "ok" }, { id: "bad", kind: "detail", status: "bad" }, { id: "bcut", kind: "bcut", status: "ok" }, { id: "size", kind: "size", status: "warn" }];
  assert.ok(applyEdit(its, { op: "hero", id: "scene" }).error);
  const h = applyEdit(its, { op: "hero", id: "bcut" });
  assert.deepEqual(h.map((x) => x.id).slice(0, 2), ["bcut", "hero"]);
  assert.ok(applyEdit(its, { op: "exclude", id: "hero" }).error);
  const ex = applyEdit(its, { op: "exclude", id: "scene" });
  assert.deepEqual(exportPick(ex).map((x) => x.id), ["hero", "bcut", "size"]);
  assert.deepEqual(applyEdit(its, { op: "move", id: "bcut", dir: -1 }).map((x) => x.id), ["hero", "bcut", "bad", "scene", "size"]); // 빠진(bad) 장을 건너뛰고 scene 과 자리 바꿈
  assert.deepEqual(applyEdit(its, { op: "move", id: "scene", dir: -1 }).map((x) => x.id), its.map((x) => x.id)); // 대표 자리로는 못 감
  assert.equal(exportPick([{ id: "h" }, ...Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, status: "ok" }))]).length, 10);
  assert.equal(its[1].excluded, undefined); // 원본 안 바꿈
});
