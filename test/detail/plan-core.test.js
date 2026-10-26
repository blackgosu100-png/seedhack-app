// A3 구성(plan) 단위테스트 — node --test test/detail/plan-core.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, classifyImage, cutRects, relPath, estimateHeight, SECTION_ORDER, CUT_HEIGHT, MAX_FEATURES, MAX_OVERFLOW, MAX_PAGE_H } from "../../src/main/detail/plan-core.js";
import { rulesCopy, buildCopyInput } from "../../src/main/detail/copy.js";
import { isSpecTable, UNIT_WORD_RE, MAX_GALLERY, SECTION_ORDER_V2, photoKey, dedupePhotos } from "../../src/main/detail/plan-core.js";
import { rulesCopyV2 } from "../../src/main/detail/copy.js";
import { rulesBrief, briefInputFrom } from "../../src/main/detail/brief.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, "fixture", "source-sample.json"), "utf8"));
const copyInput = buildCopyInput({ source: fx.source, ocr: fx.ocr, ko: fx.translations, keyword: fx.keyword });
const copy = rulesCopy(copyInput);
const mk = (over = {}) => buildPlan({ source: fx.source, ocr: fx.ocr, cleaned: fx.cleaned, copy, templateId: "clean", translations: fx.translations, copyInput, jobId: "20261009-010203-712345678901", now: 1760000000000, ...over });
const NOLIM = { limits: { maxFeatures: 99, maxPageH: 1e9 } }; // 길이 조정 없이 순수 구성 규칙만 볼 때
const orderOk = (plan) => { let last = -1; for (const s of plan.sections) { const i = SECTION_ORDER.indexOf(s.type); assert.ok(i >= 0, `알 수 없는 섹션 ${s.type}`); assert.ok(i >= last, `순서 어긋남: ${s.type}`); last = i; } };

test("C-5 섹션 순서 고정 + meta/product + 경로는 jobDir 상대(/ 구분자)", () => {
  const plan = mk();
  orderOk(plan);
  assert.deepEqual(plan.meta, { jobId: "20261009-010203-712345678901", templateId: "clean", width: 780, createdAt: 1760000000000, version: 1 });
  assert.equal(plan.product.keyword, "빨래바구니");
  assert.ok(plan.product.name_ko.includes("빨래바구니"));
  const types = plan.sections.map((s) => s.type);
  for (const t of ["hero", "pain", "usp", "feature", "gallery", "spec", "size", "package", "notice", "faq", "cta"]) assert.ok(types.includes(t), `섹션 ${t}`);
  for (const s of plan.sections) for (const p of [s.image, ...(s.images || []), ...(s.items || []).map((i) => i.image)]) if (p) assert.match(p, /^(clean|raw)\/[^/\\]+$/, p);
  assert.equal(mk({ templateId: "weird" }).meta.templateId, "editorial", "모르는 템플릿은 기본 editorial");
  assert.equal(buildPlan({ source: fx.source, ocr: fx.ocr, cleaned: fx.cleaned, copy }).meta.templateId, "editorial");
  assert.equal(mk({ templateId: "pop" }).meta.templateId, "pop");
});

test("C-5 hero: 갤러리 첫 장, 갤러리가 없으면 가장 정사각형에 가까운 상세 이미지", () => {
  const plan = mk();
  assert.equal(plan.sections[0].type, "hero");
  assert.equal(plan.sections[0].image, "clean/g01.png");
  assert.equal(plan.sections[0].badges.length, 3);
  assert.ok(plan.sections[0].headline);
  const noGal = { ...fx.source, images: fx.source.images.filter((im) => im.kind !== "gallery") };
  const p2 = mk({ source: noGal });
  // d08(790x800)이 가장 정사각형이지만 구성(package) 표라서 제외 → 분류되지 않은 것 중 d01(790x900, 0.122) < d12(790x700, 0.128)
  assert.equal(p2.sections[0].image, "clean/d01.png", "분류되지 않은 상세 이미지 중 가장 정사각형에 가까운 것");
  assert.ok(!p2.sections.some((s) => s.type === "feature" && s.image === "clean/d01.png"), "hero 로 쓴 이미지는 feature 에서 뺀다");
  assert.equal(p2.sections.find((s) => s.type === "package").image, "clean/d08.png");
  assert.ok(!p2.sections.some((s) => s.type === "gallery" && s.images.some((p) => /\/g\d+/.test(p))), "갤러리 사진 없음(넘친 상세 이미지만)");
});

test("C-5 긴 이미지(세로 > 가로×2.5) → cuts 1500px 단위 + 조각마다 feature", () => {
  const plan = mk(NOLIM);
  assert.deepEqual(plan.cuts, [
    { src: "clean/d05.png", out: "clean/d05_01.png", rect: { x: 0, y: 0, w: 790, h: 1500 } },
    { src: "clean/d05.png", out: "clean/d05_02.png", rect: { x: 0, y: 1500, w: 790, h: 1100 } },
  ]);
  const parts = plan.sections.filter((s) => s.type === "feature" && s.imageId === "d05");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].image, "clean/d05_01.png");
  assert.equal(parts[0].title, "통기성 메쉬 설계");
  assert.equal(parts[1].title, "방수·방습, 쉬운 세척", "두 번째 조각 제목은 그 조각 안의 OCR 번역");
  assert.ok(!plan.sections.some((s) => s.image === "clean/d05.png"), "원본 긴 이미지는 그대로 쓰지 않음");
  assert.deepEqual(cutRects(790, 1975), [{ x: 0, y: 0, w: 790, h: 1500 }, { x: 0, y: 1500, w: 790, h: 475 }]);
  assert.deepEqual(cutRects(790, 3100), [{ x: 0, y: 0, w: 790, h: 1500 }, { x: 0, y: 1500, w: 790, h: 1600 }], "100px 꼬리는 앞 조각에 붙임");
  assert.equal(CUT_HEIGHT, 1500);
  // 2.5배 이하는 자르지 않음
  const src2 = { ...fx.source, images: fx.source.images.map((im) => (im.id === "d05" ? { ...im, h: 1975 } : im)) };
  assert.deepEqual(mk({ source: src2, ...NOLIM }).cuts, []);
});

test("C-5 분류: size/package/notice/spec 키워드 → 섹션 이미지, notice 이미지는 글로만", () => {
  assert.equal(classifyImage(["产品尺寸", "长40cm", "宽30cm", "高60cm"]), "size");
  assert.equal(classifyImage(["包装清单", "脏衣篮 x1", "说明书 x1"]), "package");
  assert.equal(classifyImage(["温馨提示", "请勿放置重物", "请远离火源"]), "notice");
  assert.equal(classifyImage(["产品参数", "材质：加厚PP", "规格：40*30*60cm"]), "spec");
  assert.equal(classifyImage(["加厚材质 耐用不变形"]), null);
  assert.equal(classifyImage([]), null);
  assert.equal(classifyImage(["规格：40*30*60cm"]), "size", "규격 + 치수 패턴 → size");
  assert.equal(classifyImage(["产品尺寸", "适合各种衣物"]), null, "尺寸 머리글이라도 치수 패턴이 없으면 size 아님");
  assert.equal(classifyImage(["温馨提示", "手工测量 尺寸误差1-2cm属正常现象", "产品尺寸40*30*25cm"]), "notice", "우선순위 notice > size");
  assert.equal(classifyImage(["包装清单", "脏衣篮x1说明书x1", "尺寸40*30cm"]), "package", "说明书 는 notice 아님, package > size");
  assert.equal(classifyImage(["产品参数", "材质：PP", "尺寸：40*30*60cm"]), "spec", "参数 머리글이 결정");
  const plan = mk(NOLIM);
  const by = (t) => plan.sections.find((s) => s.type === t);
  assert.equal(by("size").image, "clean/d06.png"); assert.ok(by("size").note.includes("40cm"));
  assert.equal(by("package").image, "clean/d08.png"); assert.deepEqual(by("package").items, ["빨래바구니 x1", "설명서 x1"]);
  assert.equal(by("spec").image, null, "스펙 섹션은 attrs 표만(표 이미지는 안 씀)"); assert.ok(by("spec").rows.length >= 5);
  const withBrand = mk({ copy: { ...copy, spec: [...copy.spec, { k: "상표", v: "바도마" }, { k: "brand", v: "X" }] }, ...NOLIM }).sections.find((s) => s.type === "spec");
  assert.ok(!withBrand.rows.some((r) => /상표|brand/i.test(r.k)), "공급사 브랜드 행은 표에서 뺀다");
  assert.ok(plan.dropped.some((d) => d.id === "d07" && d.why === "spec-table"), "스펙 표 이미지는 버림 기록");
  assert.ok(by("notice").items.length >= 3);
  const featureIds = plan.sections.filter((s) => s.type === "feature").map((s) => s.imageId);
  assert.ok(!featureIds.includes("d06") && !featureIds.includes("d07") && !featureIds.includes("d08") && !featureIds.includes("d09"), "분류된 이미지는 feature 에 중복되지 않음");
  assert.deepEqual(featureIds, ["d01", "d02", "d03", "d04", "d05", "d05", "d10", "d11", "d12", "g03"], "페이지 순서 유지(+중국어가 남은 갤러리 g03 은 overlay feature)");
});

test("C-5 usp.imageId → 이미지 경로(긴 이미지는 첫 조각), 사진 위 kept 상자 → overlay(번역문)", () => {
  const plan = mk(NOLIM);
  const usp = plan.sections.find((s) => s.type === "usp");
  // 한 사진은 1회만: usp 카드가 가리킨 d01·d05_01 은 feature 가 이미 크게 쓰므로 카드에서는 빠진다(null)
  assert.equal(usp.items[0].image, null); assert.equal(usp.items[3].image, null);
  const usedElse = plan.sections.filter((s) => s.type !== "usp").flatMap((s) => [s.image, ...(s.images || [])]).filter(Boolean);
  assert.ok(usp.items.every((it) => !it.image || !usedElse.includes(it.image)), "카드 사진은 다른 섹션과 겹치지 않음");
  const c2 = { ...copy, usp: { ...copy.usp, items: [{ title: "a", desc: "b", imageId: "d99" }, ...copy.usp.items.slice(1)] } };
  assert.equal(mk({ copy: c2 }).sections.find((s) => s.type === "usp").items[0].image, null);
  const f10 = plan.sections.find((s) => s.type === "feature" && s.imageId === "d10");
  assert.deepEqual(f10.overlay, [{ x: 60, y: 860, w: 560, h: 40, text: "침실, 욕실, 베란다 어디든 어울림" }]);
  const f01 = plan.sections.find((s) => s.type === "feature" && s.imageId === "d01");
  assert.deepEqual(f01.overlay, [], "지운(erased) 상자는 overlay 아님");
  // 번역이 없으면 캡션 제목으로 덮는다(중국어를 그대로 띄우지 않음)
  const p3 = mk({ translations: null, copyInput: null, ...NOLIM });
  const f10b = p3.sections.find((s) => s.type === "feature" && s.imageId === "d10");
  assert.equal(f10b.overlay[0].text, copy.captions.find((c) => c.imageId === "d10").title);
  assert.ok(!/[\u4e00-\u9fff]/.test(JSON.stringify(plan)), "plan 에 한자 없음");
});

test("C-5 빈 섹션 제거 + cleaned 없을 때 raw 경로 + 절대경로·역슬래시 정리", () => {
  const thin = { ...copy, pain: { title: "", items: [] }, faq: [], notice: [], package_items: [], size_note: "", cta: { headline: "", sub: "" } };
  const src = { ...fx.source, images: fx.source.images.filter((im) => ["g01", "d01"].includes(im.id)) };
  const plan = buildPlan({ source: src, ocr: fx.ocr, cleaned: [], copy: thin, templateId: "dark" });
  assert.deepEqual(plan.sections.map((s) => s.type), ["hero", "usp", "feature", "spec"]);
  assert.equal(plan.sections[0].image, "raw/g01.jpg");
  assert.equal(plan.sections[2].image, "raw/d01.png");
  assert.equal(plan.meta.jobId, "");
  assert.equal(relPath("/Users/x/Library/Application Support/app/detail/job1/clean/d01.png"), "clean/d01.png");
  assert.equal(relPath("C:\\Users\\x\\AppData\\detail\\job1\\clean\\d01.png"), "clean/d01.png");
  assert.equal(relPath("d01.png"), "clean/d01.png");
  assert.equal(relPath("raw/g01.jpg"), "raw/g01.jpg");
});

test("길이 조정: feature 상한 8(근거 강한 순), 넘친 이미지는 2열 gallery(최대 6), 예상 높이 ≤ 18,000", () => {
  const plan = mk();
  const feats = plan.sections.filter((s) => s.type === "feature");
  assert.ok(feats.length <= MAX_FEATURES);
  assert.ok(plan.estimatedHeight <= MAX_PAGE_H, `예상 높이 ${plan.estimatedHeight}`);
  assert.equal(estimateHeight(plan), plan.estimatedHeight);
  const gal = plan.sections.find((s) => s.type === "gallery");
  assert.equal(gal.cols, 2);
  assert.ok(gal.images.length <= 4 + MAX_OVERFLOW);
  assert.equal(gal.images[0], "clean/g02.png", "갤러리 사진이 앞, 넘친 상세 이미지가 뒤");
  assert.ok(!gal.images.includes("clean/g03.png"), "중국어가 남은(kept) g03 은 갤러리에 못 들어감");
  for (const d of [{ id: "d07", why: "spec-table" }, { id: "g03", why: "kept" }]) assert.ok(plan.dropped.some((x) => x.id === d.id && x.why === d.why), "스펙 표·gallery 로 못 가는(중국어 남은) 이미지는 버림 기록");
  assert.ok(!plan.dropped.some((x) => x.why === "duplicate"), "중복은 dropped 가 아니라 duplicates");
  // 샘플은 전부 feature 로 두면 18,000 을 넘는다 → 뒤에서부터 gallery 로 옮겨 맞춘다
  assert.ok(estimateHeight(mk(NOLIM)) > MAX_PAGE_H);
  assert.deepEqual(feats.map((f) => f.imageId).slice(0, 5), ["d01", "d02", "d03", "d05", "d05"], "usp 가 가리키는(근거 강한) 이미지가 앞에 남는다");
  assert.equal(plan.cuts.length, 2, "feature 로 남은 긴 이미지는 조각 전부 자른다");
  const p9 = mk({ limits: { maxPageH: 12000 } });
  const g9 = p9.sections.find((s) => s.type === "gallery");
  assert.ok(g9.images.includes("clean/d05_01.png") && p9.cuts.length === 1 && p9.cuts[0].out === "clean/d05_01.png", "gallery 로 간 긴 이미지는 첫 조각만 자른다");
  for (const f of feats) assert.ok(f.w > 0 && f.h > 0, "feature 에 이미지 크기(높이 추정용)");
  // 상한을 넘기지 않는 작은 입력은 그대로
  const small = { ...fx.source, images: fx.source.images.filter((im) => ["g01", "d01", "d02"].includes(im.id)) };
  const ps = mk({ source: small });
  assert.equal(ps.sections.filter((s) => s.type === "feature").length, 2);
  assert.ok(!ps.sections.some((s) => s.type === "gallery"));
});

test("길이 조정: 상세 이미지 20장(OCR 없음) → feature 8 + gallery 6 + dropped 기록, 근거 점수 순", () => {
  const imgs = [{ id: "g01", kind: "gallery", w: 800, h: 800, file: "raw/g01.jpg" }];
  for (let i = 1; i <= 20; i++) imgs.push({ id: `d${String(i).padStart(2, "0")}`, kind: "detail", w: 790, h: 600, file: `raw/d${String(i).padStart(2, "0")}.png` });
  const ocr = { provider: "none", images: [{ id: "d20", w: 790, h: 600, boxes: [{ x: 0, y: 0, w: 100, h: 20, text: "加厚材质" }, { x: 0, y: 30, w: 100, h: 20, text: "耐用" }] }] };
  const c = { ...copy, usp: { title: "", items: [{ title: "a", desc: "b", imageId: "d15" }] }, captions: [] };
  const plan = buildPlan({ source: { images: imgs }, ocr, cleaned: [], copy: c, limits: { maxPageH: 1e9 } });
  const feats = plan.sections.filter((s) => s.type === "feature").map((s) => s.imageId);
  assert.equal(feats.length, 8);
  assert.ok(feats.includes("d15") && feats.includes("d20"), "usp 매핑·OCR 문장이 있는 이미지가 우선");
  assert.deepEqual(feats, [...feats].sort(), "페이지 순서 유지");
  const gal = plan.sections.find((s) => s.type === "gallery");
  assert.equal(gal.images.length, 6);
  assert.equal(plan.dropped.length, 20 - 8 - 6); assert.ok(plan.dropped.every((d) => d.why === "overflow"));
  assert.ok(!plan.sections.some((s) => s.type === "feature" && plan.dropped.some((d) => d.id === s.imageId)));
});

test("길이 조정: spec·size 섹션 이미지는 렌더 세로 1500px 이하만(길면 image:null 로 표만)", () => {
  const src = { ...fx.source, images: fx.source.images.map((im) => (im.id === "d07" ? { ...im, h: 1700 } : im.id === "d06" ? { ...im, h: 1520 } : im)) };
  const plan = mk({ source: src });
  const spec = plan.sections.find((s) => s.type === "spec"), size = plan.sections.find((s) => s.type === "size");
  assert.equal(spec.image, null); assert.ok(spec.rows.length >= 5);
  assert.equal(size.image, null); assert.ok(size.note.includes("40cm")); assert.deepEqual(size.overlay, []);
  assert.ok(!plan.sections.some((s) => s.type === "feature" && ["d06", "d07"].includes(s.imageId)), "긴 표 이미지는 feature 로도 안 감");
  const ok = mk().sections.find((s) => s.type === "size");
  assert.equal(ok.image, "clean/d06.png"); assert.equal(ok.w, 790); assert.equal(ok.h, 1000);
});

test("estimateHeight: 섹션 타입별 대략치", () => {
  const h = estimateHeight({ sections: [
    { type: "hero" }, { type: "pain" }, { type: "usp", items: [{ image: "a" }, { image: null }] },
    { type: "feature", image: "x", w: 790, h: 1580 }, { type: "gallery", images: [1, 2, 3], cols: 2 },
    { type: "spec", rows: [1, 2, 3], image: null }, { type: "size", image: "y", w: 780, h: 1000 }, { type: "package" }, { type: "notice" }, { type: "faq", items: [1, 2] }, { type: "cta" } ] });
  assert.equal(h, 1000 + 700 + (900 + 600) + (1560 + 260) + 2 * 520 + (120 + 210) + (1000 + 200) + 400 + 500 + 440 + 600);
});

test("보완 3: hero 는 kept(중국어 남음) 이미지를 피한다 — g01 에 글자가 남으면 g02, 전부 남았으면 상자가 가장 적은 것", () => {
  const keptBox = { x: 10, y: 10, w: 100, h: 30, text: "厂家直销", conf: 0.9, action: "kept", bg: "#888", onPhoto: true };
  const cl = fx.cleaned.map((c) => (c.id === "g01" ? { ...c, boxesOut: [keptBox] } : c));
  assert.equal(mk({ cleaned: cl }).sections[0].image, "clean/g02.png");
  const cl2 = fx.cleaned.map((c) => (c.id === "g01" ? { ...c, boxesOut: [keptBox, { ...keptBox, y: 50 }] } : c.id === "g02" ? { ...c, boxesOut: [keptBox] } : c));
  assert.equal(mk({ cleaned: cl2 }).sections[0].image, "clean/g02.png", "g01 2개 > g02 1개 = g03 1개(원래 샘플) → 가장 적은 것 중 앞선 g02");
  // 갤러리 없음 + 모든 상세 이미지에 kept → 상자가 가장 적은 것
  const noGal = { ...fx.source, images: fx.source.images.filter((im) => im.kind !== "gallery") };
  const allKept = fx.cleaned.map((c) => ({ ...c, boxesOut: [keptBox, ...(c.id === "d02" ? [] : [{ ...keptBox, y: 60 }])] }));
  assert.equal(mk({ source: noGal, cleaned: allKept }).sections[0].image, "clean/d02.png");
  assert.equal(mk().sections[0].image, "clean/g01.png", "샘플 g01 은 kept 없음 → 그대로");
});

test("보완 3: 갤러리에 kept 이미지를 넣지 않고 feature(overlay)로, 상한에 걸리면 dropped — 긴 이미지는 조각 단위 분류", () => {
  // e2e fixture 와 같은 모양: g01 에 厂家直销 kept, d07(750x3200) 에 치수+구성+주의가 한 장에, d02 는 温馨提示 + 尺寸误差
  const imgs = [
    { id: "g01", kind: "gallery", w: 800, h: 800, file: "raw/g01.png" }, { id: "g02", kind: "gallery", w: 800, h: 800, file: "raw/g02.png" },
    { id: "d01", kind: "detail", w: 790, h: 1200, file: "raw/d01.png" }, { id: "d02", kind: "detail", w: 790, h: 600, file: "raw/d02.png" },
    { id: "d05", kind: "detail", w: 790, h: 1200, file: "raw/d05.png" }, { id: "d07", kind: "detail", w: 750, h: 3200, file: "raw/d07.png" },
  ];
  const B = (y, text, extra = {}) => ({ x: 50, y, w: 300, h: 40, text, conf: 0.9, ...extra });
  const ocr = { provider: "vision", images: [
    { id: "g01", w: 800, h: 800, boxes: [B(43, "厂家直销")] }, { id: "g02", w: 800, h: 800, boxes: [] },
    { id: "d01", w: 790, h: 1200, boxes: [B(80, "加厚材质 耐用不变形"), B(160, "承重可达15kg")] },
    { id: "d02", w: 790, h: 600, boxes: [B(65, "温馨提示"), B(153, "由于显示器色差 实物颜色可能略有不同"), B(211, "手工测量 尺寸误差1-2cm属正常现象")] },
    { id: "d05", w: 790, h: 1200, boxes: [B(64, "实拍细节展示"), B(1084, "加粗提手 久提不累")] },
    { id: "d07", w: 750, h: 3200, boxes: [B(84, "产品尺寸"), B(171, "产品尺寸40*30*25cm"), B(1125, "包装清单"), B(1208, "脏衣篮x1说明书x1"), B(2165, "注意事项"), B(2249, "请勿靠近火源 避免暴晒")] },
  ] };
  const kept = (b) => ({ ...b, action: "kept", bg: "#888", onPhoto: true }), erased = (b) => ({ ...b, action: "erased", bg: "#fff", onPhoto: false });
  const cl = ocr.images.map((o) => ({ id: o.id, out: `clean/${o.id}.png`, w: o.w, h: o.h, boxesOut: o.boxes.map((b) => (["g01", "d05"].includes(o.id) ? kept(b) : erased(b))) }));
  const tr = { "厂家直销": "제조사 직판", "实拍细节展示": "실제 촬영 디테일", "加粗提手 久提不累": "굵은 손잡이, 오래 들어도 편함", "产品尺寸": "제품 치수" };
  const c = { ...copy, usp: { title: "", items: [{ title: "a", desc: "b", imageId: "d01" }] }, captions: [] };
  const plan = buildPlan({ source: { images: imgs }, ocr, cleaned: cl, copy: c, translations: tr });
  const by = (t) => plan.sections.find((s) => s.type === t);
  assert.equal(by("hero").image, "clean/g02.png", "g01 은 kept → hero 아님");
  assert.equal(by("size").image, "clean/d07_01.png", "긴 이미지의 첫 조각(产品尺寸 + 40*30*25cm) 이 size");
  assert.equal(by("size").h, 1500);
  assert.ok(!by("package")?.image, "包装清单 은 size 조각 안에 있어 섹션 이미지 없음(글만)");
  assert.ok(!plan.sections.some((s) => s.image === "clean/d07_02.png"), "注意事项 조각은 버림");
  assert.deepEqual(plan.cuts.map((cu) => cu.out), ["clean/d07_01.png"], "쓰인 조각만 자른다");
  assert.ok(!plan.sections.some((s) => s.type === "size" && s.image === "clean/d02.png"), "温馨提示+误差 는 notice → 이미지 안 씀");
  const feats = plan.sections.filter((s) => s.type === "feature");
  assert.deepEqual(feats.map((f) => f.imageId), ["d01", "d05", "g01"], "kept 이미지(d05·g01)는 overlay 띠로 feature");
  assert.deepEqual(feats[1].overlay.map((o) => o.text), ["실제 촬영 디테일", "굵은 손잡이, 오래 들어도 편함"]);
  assert.equal(feats[1].title, "실제 촬영 디테일"); assert.equal(feats[1].desc, "굵은 손잡이, 오래 들어도 편함");
  assert.deepEqual(feats[2].overlay.map((o) => o.text), ["제조사 직판"]);
  assert.ok(!by("gallery") || !by("gallery").images.some((p) => /g01|d05/.test(p)), "kept 이미지는 gallery 에 없음");
  // feature 상한 2 → kept 인 g01 은 gallery 로 못 가고 dropped
  const p2 = buildPlan({ source: { images: imgs }, ocr, cleaned: cl, copy: c, translations: tr, limits: { maxFeatures: 2 } });
  assert.deepEqual(p2.sections.filter((s) => s.type === "feature").map((f) => f.imageId), ["d01", "d05"]);
  assert.deepEqual(p2.dropped, [{ id: "g01", why: "kept" }]);
  assert.ok(!p2.sections.find((s) => s.type === "gallery")?.images.includes("clean/g01.png"));
  // A2 가 띠를 잘라 w/h 가 바뀌면 cleaned 크기를 쓴다
  const cl3 = cl.map((x) => (x.id === "d01" ? { ...x, h: 1000 } : x));
  assert.equal(buildPlan({ source: { images: imgs }, ocr, cleaned: cl3, copy: c, translations: tr }).sections.find((s) => s.type === "feature").h, 1000);
});

test("보완 3: trim.blank(글자만 있던 이미지)는 어떤 섹션 image 로도 쓰지 않고 글만 — dropped {id, why:\"blank\"}", () => {
  const blank = (id) => ({ ...fx.cleaned.find((c) => c.id === id), trim: { rect: { x: 0, y: 0, w: 790, h: 1000 }, bandCut: false, blank: true } });
  const cl = fx.cleaned.map((c) => (["d06", "d08", "d02", "g01"].includes(c.id) ? blank(c.id) : c)); // 사이즈 표·구성표·feature·갤러리 첫 장
  const plan = mk({ cleaned: cl, ...NOLIM });
  const by = (t) => plan.sections.find((s) => s.type === t);
  assert.equal(by("hero").image, "clean/g02.png", "blank 인 g01 은 hero 아님");
  assert.equal(by("size").image, null); assert.equal(by("size").blankImage, "d06"); assert.ok(by("size").note.includes("40cm"), "글(size_note)은 그대로");
  assert.equal(by("package").image, null); assert.equal(by("package").blankImage, "d08"); assert.deepEqual(by("package").items, ["빨래바구니 x1", "설명서 x1"]);
  assert.ok(!plan.sections.some((s) => s.type === "feature" && s.imageId === "d02"), "blank feature 는 안 그림");
  assert.ok(!plan.sections.some((s) => [s.image, ...(s.images || [])].some((p) => /d06|d08|d02|g01/.test(p || ""))), "어디에도 이미지로 안 씀");
  assert.deepEqual(plan.dropped.filter((d) => d.why === "blank").map((d) => d.id).sort(), ["d02", "d06", "d08", "g01"]);
  assert.equal(by("spec").image, null, "스펙 섹션은 항상 표만");
});

test("QA 재작업: trim.contentRatio < 0.06 이면 blank 와 같이 — 긴 이미지는 조각 전부 제외", () => {
  const ratio = (id, r) => ({ ...fx.cleaned.find((c) => c.id === id), trim: { rect: { x: 0, y: 0, w: 790, h: 1000 }, bandCut: false, blank: false, contentRatio: r } });
  const cl = fx.cleaned.map((c) => (c.id === "d05" ? ratio("d05", 0.02) : c.id === "d06" ? ratio("d06", 0.059) : c.id === "d01" ? ratio("d01", 0.3) : c));
  const plan = mk({ cleaned: cl, ...NOLIM });
  assert.ok(!plan.sections.some((s) => [s.image, ...(s.images || []), ...(s.items || []).map((i) => i?.image)].some((p) => /d05|d06/.test(p || ""))), "어디에도 이미지로 안 씀(usp 매핑 포함 조각 d05_01 도)");
  assert.deepEqual(plan.cuts, [], "긴 이미지 d05 는 조각을 만들지 않음");
  assert.equal(plan.sections.find((s) => s.type === "size").image, null); assert.equal(plan.sections.find((s) => s.type === "size").blankImage, "d06");
  assert.deepEqual(plan.dropped.filter((d) => d.why === "blank").map((d) => d.id).sort(), ["d05", "d06"]);
  assert.ok(plan.sections.some((s) => s.type === "feature" && s.imageId === "d01"), "0.3 은 정상");
  assert.ok(plan.sections.some((s) => s.type === "feature" && s.imageId === "d02"), "contentRatio 없는 이미지는 그대로");
});

// 실제 1688 작업(20261009-080956-948424797701, 벽걸이 접이식 빨래 건조대)의 source/ocr/copy JSON — 이미지는 없음. A5 가 기록할 photo 를 흉내 내 붙인다
const REAL = path.join(here, "fixture", "real-948424797701");
const real = { source: JSON.parse(fs.readFileSync(path.join(REAL, "source.json"), "utf8")), ocr: JSON.parse(fs.readFileSync(path.join(REAL, "ocr.json"), "utf8")), copy: JSON.parse(fs.readFileSync(path.join(REAL, "copy.json"), "utf8")), clean: JSON.parse(fs.readFileSync(path.join(REAL, "clean.json"), "utf8")) };
const PHOTO = { d13: null, d21: null, g04: null, d09: { w: 790, h: 150 }, d04: { w: 790, h: 230 } }; // 없음 / 납작(150) / 가로/세로 > 3(230 → 790/230=3.4)
const realCleaned = (over = {}) => real.clean.map((c) => {
  const src = real.source.images.find((im) => im.id === c.id) || c; // 실제 clean.json 은 A2 가 글자 띠만 남긴 이미지(d17 299×50 등)도 있어 원본 크기로 흉내 낸다
  const p = Object.prototype.hasOwnProperty.call({ ...PHOTO, ...over }, c.id) ? { ...PHOTO, ...over }[c.id] : { w: src.w, h: Math.round(src.h * 0.7) };
  return { ...c, trim: { ...(c.trim || {}), blank: false, contentRatio: 0.5 }, full: `clean/${c.id}_full.png`, photo: p ? { file: `clean/${c.id}.png`, w: p.w, h: p.h, rect: { x: 0, y: Math.round(c.h * 0.15), w: p.w, h: p.h }, contentRatio: 0.5 } : null };
});
const imageIdOf = (p) => (p || "").replace(/^clean\//, "").replace(/(_\d+)?\.png$/, "");

test("재설계(실제 작업): photo 가 없는 이미지는 어떤 섹션 이미지로도 쓰지 않고 dropped no-photo, 납작한 크롭은 usp·gallery·hero 금지", () => {
  const cleaned = realCleaned();
  const plan = buildPlan({ source: real.source, ocr: real.ocr, cleaned, copy: real.copy, templateId: "clean" });
  const used = plan.sections.flatMap((s) => [s.image, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean).map(imageIdOf);
  for (const id of ["d13", "d21", "g04"]) assert.ok(!used.includes(id), `photo 없는 ${id} 이 섹션 이미지로 쓰임`);
  assert.ok(plan.dropped.some((d) => d.id === "d13" && d.why === "no-photo") && plan.dropped.some((d) => d.id === "g04" && d.why === "no-photo"));
  const usp = plan.sections.find((s) => s.type === "usp"), gal = plan.sections.find((s) => s.type === "gallery");
  assert.ok(!usp.items.some((i) => ["d09", "d04"].includes(imageIdOf(i.image))) && !(gal?.images || []).some((p) => ["d09", "d04"].includes(imageIdOf(p))), "납작한 크롭은 usp·gallery 에 없음");
  assert.ok(!["d09", "d04", "d13", "d21", "g04"].includes(imageIdOf(plan.sections[0].image)) && plan.sections[0].image, "hero 는 사진 있는 갤러리");
  assert.equal(plan.sections[0].image, "clean/g01.png");
  for (const s of plan.sections.filter((x) => x.type === "feature")) assert.ok(s.w > 0 && s.h > 0 && cleaned.find((c) => c.id === s.imageId)?.photo, "feature 는 photo 크기·경로");
  assert.ok(plan.sections.filter((s) => s.type === "feature").length >= 3);
});

test("재설계(실제 작업): usp.imageId 대체 — 스펙 표 d21 → '접이식' 이 OCR 번역에 있는 사진으로, 납작한 d09 → '옷걸이' 사진으로, 근거 없으면 null", () => {
  const plan = buildPlan({ source: real.source, ocr: real.ocr, cleaned: realCleaned(), copy: real.copy });
  const usp = plan.sections.find((s) => s.type === "usp");
  assert.deepEqual(real.copy.usp.items.map((i) => i.imageId), ["d21", "d09", "d13", "d17"]);
  const koOf = (id) => real.ocr.images.find((i) => i.id === id).boxes.map((b) => b.text_ko || "").join(" ") + " " + JSON.stringify(real.copy.captions.find((c) => c.imageId === id) || "");
  // 대체 사진은 근거(명사)가 맞고 다른 섹션에 쓰이지 않은 것만 — 모두 쓰였으면 null(한 사진 1회만)
  const usedElse = new Set(plan.sections.filter((s) => s.type !== "usp").flatMap((s) => [s.image, ...(s.images || [])]).filter(Boolean));
  assert.ok(usp.items[0].image === null || (imageIdOf(usp.items[0].image) !== "d21" && /접이식|540/.test(koOf(imageIdOf(usp.items[0].image))) && !usedElse.has(usp.items[0].image)), JSON.stringify(usp.items[0]));
  assert.ok(usp.items[1].image === null || (imageIdOf(usp.items[1].image) !== "d09" && /옷걸이|50개/.test(koOf(imageIdOf(usp.items[1].image))) && !usedElse.has(usp.items[1].image)), JSON.stringify(usp.items[1]));
  const p16 = buildPlan({ source: real.source, ocr: real.ocr, cleaned: realCleaned(), copy: real.copy, limits: { maxFeatures: 1 } }).sections.find((s) => s.type === "usp");
  assert.ok(p16.items[0].image && imageIdOf(p16.items[0].image) !== "d21" && /접이식|540/.test(koOf(imageIdOf(p16.items[0].image))), "feature 자리가 적어 사진이 남으면 근거 맞는 사진으로 대체: " + JSON.stringify(p16.items[0]));
  assert.ok(usp.items[2].image === null || /알루미늄|합금|두꺼운/.test(koOf(imageIdOf(usp.items[2].image))), JSON.stringify(usp.items[2]));
  const used = plan.sections.filter((s) => s.type !== "usp").flatMap((s) => [s.image, ...(s.images || [])]).filter(Boolean);
  assert.ok(usp.items[3].image === null || !used.includes(usp.items[3].image), "원래 id 사진이 다른 섹션에 쓰이면 카드에서는 빠진다(1회만)");
  for (const it of usp.items) if (it.image) { const c = realCleaned().find((x) => x.id === imageIdOf(it.image)); assert.ok(c.photo && c.photo.h >= 220 && c.photo.w / c.photo.h <= 3); }
});

test("재설계(실제 작업): 스펙 표 이미지(参数·PARAMETER·品牌·品名…)는 사진이 있어도 어떤 섹션 이미지로도 안 쓰고 spec 섹션은 attrs 표만", () => {
  assert.ok(isSpecTable(real.ocr.images.find((i) => i.id === "d21").boxes.map((b) => b.text)));
  assert.ok(!isSpecTable(real.ocr.images.find((i) => i.id === "d13").boxes.map((b) => b.text)));
  const plan = buildPlan({ source: real.source, ocr: real.ocr, cleaned: realCleaned({ d21: { w: 790, h: 600 } }), copy: real.copy });
  const used = plan.sections.flatMap((s) => [s.image, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean).map(imageIdOf);
  assert.ok(!used.includes("d21"));
  assert.ok(plan.dropped.some((d) => d.id === "d21" && d.why === "spec-table"));
  const spec = plan.sections.find((s) => s.type === "spec");
  assert.equal(spec.image, null); assert.ok(spec.rows.length >= 5);
  // 옛 결과(photo 키 없음)는 지운 전체본을 그대로 쓴다(fixture 호환)
  const legacy = buildPlan({ source: real.source, ocr: real.ocr, cleaned: real.clean, copy: real.copy });
  assert.ok(legacy.sections.filter((s) => s.type === "feature").length >= 3 && legacy.sections[0].image === "clean/g01.png");
  assert.ok(!legacy.sections.flatMap((s) => [s.image, ...(s.items || []).map((i) => i?.image)]).map(imageIdOf).includes("d21"), "옛 결과에서도 스펙 표는 안 씀");
});

test("재설계: 띠(overlay) 글자는 labels 우선, 1~2자 수량 단위어(个·扇)는 넣지 않는다", () => {
  assert.ok(UNIT_WORD_RE.test("个") && UNIT_WORD_RE.test("扇") && UNIT_WORD_RE.test("2扇") && UNIT_WORD_RE.test("5 个") && !UNIT_WORD_RE.test("幻夜黑") && !UNIT_WORD_RE.test("可折叠"));
  const keptBox = (text, y) => ({ x: 10, y, w: 60, h: 30, text, conf: 0.9, action: "kept", bg: "#888", onPhoto: true });
  const cl = fx.cleaned.map((c) => (c.id === "d10" ? { ...c, boxesOut: [keptBox("个", 100), keptBox("扇", 140), keptBox("多场景适用", 860)] } : c));
  const c2 = { ...copy, labels: [{ imageId: "d10", zh: "多场景适用", ko: "어디서나 OK" }] };
  const plan = buildPlan({ source: fx.source, ocr: fx.ocr, cleaned: cl, copy: c2, translations: { ...fx.translations, "个": "개인", "扇": "팬" }, copyInput, limits: { maxFeatures: 99, maxPageH: 1e9 } });
  const f10 = plan.sections.find((s) => s.type === "feature" && s.imageId === "d10");
  assert.deepEqual(f10.overlay.map((o) => o.text), ["어디서나 OK"], "단위어는 띠 없음, labels 번역 우선");
  const p2 = buildPlan({ source: fx.source, ocr: fx.ocr, cleaned: cl, copy, translations: { ...fx.translations, "多场景适用": "다양한 장소에 사용" }, copyInput, limits: { maxFeatures: 99, maxPageH: 1e9 } });
  assert.deepEqual(p2.sections.find((s) => s.type === "feature" && s.imageId === "d10").overlay.map((o) => o.text), ["다양한 장소에 사용"], "labels 없으면 번역표");
});

test("마무리 보완: feature 도 납작 크롭(h<260 또는 w/h>3.2)은 글만, coverage<0.45 는 gallery·hero 금지(feature 허용), 갤러리 ≤8·같은 장면 중복 제거", () => {
  // d11 은 coverage 0.3, g02 는 coverage 0.2, d03(790×549) 은 g03(800×560) 크롭과 거의 같은 장면
  const cleaned = realCleaned({ d05: { w: 790, h: 250 }, d07: { w: 790, h: 240 }, d03: { w: 800, h: 561 } }).map((c) => (c.id === "d11" ? { ...c, photo: { ...c.photo, coverage: 0.3 } } : c.id === "g02" ? { ...c, photo: { ...c.photo, coverage: 0.2 } } : c));
  const plan = buildPlan({ source: real.source, ocr: real.ocr, cleaned, copy: real.copy, limits: { maxPageH: 1e9 } });
  const feats = plan.sections.filter((s) => s.type === "feature").map((s) => s.imageId);
  assert.ok(!feats.includes("d05") && !feats.includes("d07"), "납작한 크롭은 feature 로도 안 씀");
  assert.ok(plan.dropped.some((d) => d.id === "d05" && d.why === "flat") && plan.dropped.some((d) => d.id === "d07" && d.why === "flat"));
  const gal = plan.sections.find((s) => s.type === "gallery");
  assert.ok(gal.images.length <= MAX_GALLERY);
  assert.ok(!gal.images.includes("clean/g02.png"), "coverage 0.2 는 gallery 금지");
  assert.ok(plan.sections[0].image !== "clean/g02.png");
  assert.ok(gal.images.includes("clean/g03.png") && !gal.images.includes("clean/d03.png"), "같은 장면(크기·비율 5% 안)의 상세 크롭은 갤러리에 안 넣음");
  const feats2 = buildPlan({ source: real.source, ocr: real.ocr, cleaned, copy: real.copy, limits: { maxPageH: 1e9, maxFeatures: 99 } }).sections.filter((s) => s.type === "feature").map((s) => s.imageId);
  assert.ok(feats2.includes("d11"), "coverage 낮아도 feature 는 허용");
});

test("비전 검수: usable:false 는 어디에도 안 씀(dropped vision), hero 는 role hero·score 최고, feature 캡션은 vision 우선, gallery 는 score 순", () => {
  const vision = JSON.parse(fs.readFileSync(path.join(here, "fixture", "vision-sample.json"), "utf8"));
  const plan = mk({ vision, ...NOLIM });
  const used = plan.sections.flatMap((s) => [s.image, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean).map(imageIdOf);
  for (const id of ["d03", "d10", "d12"]) assert.ok(!used.includes(id), `usable:false 인 ${id} 가 쓰임`);
  assert.deepEqual(plan.dropped.filter((d) => d.why === "vision").map((d) => d.id).sort(), ["d03", "d10", "d12"]);
  assert.equal(plan.sections[0].image, "clean/g02.png", "role hero 인 g02 가 hero (g01 은 score 4)");
  const f02 = plan.sections.find((s) => s.type === "feature" && s.imageId === "d02");
  assert.equal(f02.title, "접으면 납작하게"); assert.equal(f02.desc, "쓰지 않을 때는 접어 틈새에 세워 둘 수 있어요.");
  assert.ok(!plan.sections.some((s) => s.type === "feature" && s.imageId === "d01"), "role detail(클로즈업) 사진은 feature 가 아니라 갤러리로만");
  const f04 = plan.sections.find((s) => s.type === "feature" && s.imageId === "d04");
  assert.equal(f04.title, copy.captions.find((c) => c.imageId === "d04").title, "비전 캡션이 비면 copy.captions");
  const vb = vision.items.map((v) => (v.id === "d02" ? { ...v, caption_title: "튼튼한 내구성", caption_desc: "성인 두 사람의 체중도 끄떡없이 지탱해요" } : v));
  assert.equal(mk({ vision: vb, ...NOLIM }).sections.find((s) => s.type === "feature" && s.imageId === "d02").title, copy.captions.find((c) => c.imageId === "d02").title, "체중·하중 캡션은 비전 캡션을 버리고 copy.captions");
  const gal = plan.sections.find((s) => s.type === "gallery");
  assert.ok(!gal || !gal.images.some((p) => ["d03", "d10", "d12"].includes(imageIdOf(p))));
  // usp 가 usable:false 사진을 가리키면 대체(근거 있는 다른 사진) 또는 null
  const c2 = { ...copy, usp: { ...copy.usp, items: [{ title: "대용량 60L", desc: "x", imageId: "d03" }, ...copy.usp.items.slice(1)] } };
  const u = mk({ vision, copy: c2, ...NOLIM }).sections.find((s) => s.type === "usp").items[0].image;
  assert.ok(u !== "clean/d03.png");
  // 비전 없는 호출은 그대로
  assert.equal(mk(NOLIM).sections[0].image, "clean/g01.png");
});

test("최종 라운드: 가운데 글자(text_pos center) 사진 제외, feature 는 score≥4 우선·3은 자리 남을 때·≤2 제외·최대 7, usp 빈 칸은 안 쓰인 usable 사진 배정", () => {
  const base = JSON.parse(fs.readFileSync(path.join(here, "fixture", "vision-sample.json"), "utf8")).items;
  const vision = base.map((v) => (v.id === "d01" ? { ...v, has_text: true, text_pos: "center" } : v.id === "d04" ? { ...v, score: 2, role: "scene" } : v.id === "d11" ? { ...v, score: 3 } : v));
  vision.push({ id: "d05", usable: true, score: 4, has_text: true, text_pos: "top", shows: "메쉬 벽면", caption_title: "숨 쉬는 메쉬", caption_desc: "공기가 통해 눅눅함이 덜해요.", role: "feature" });
  vision.push({ id: "d09", usable: true, score: 3, has_text: false, text_pos: null, shows: "바구니 옆면", caption_title: "", caption_desc: "", role: "detail" }); // 주의 문구 이미지라 어느 섹션에도 안 쓰임 → usp 빈 칸 후보
  const plan = mk({ vision, limits: { maxPageH: 1e9 } });
  const feats = plan.sections.filter((s) => s.type === "feature").map((s) => s.imageId);
  assert.ok(!feats.includes("d01") && plan.dropped.some((d) => d.id === "d01" && d.why === "vision"), "가운데 글자 사진은 버림");
  assert.ok(!feats.includes("d04"), "score 2 는 feature 아님");
  assert.ok(feats.includes("d05") && feats.includes("d02"), "score ≥4 우선(가장자리 글자 top 은 허용 — A5 가 띠를 잘라냄)");
  assert.ok(feats.length <= 7);
  assert.equal(feats.indexOf("d02") < feats.indexOf("d11") || !feats.includes("d11"), true, "순서는 페이지 순서 유지, 3점은 자리 남을 때만");
  const many = mk({ vision, limits: { maxPageH: 1e9, maxFeatures: 2 } }).sections.filter((s) => s.type === "feature").map((s) => s.imageId);
  assert.ok(!many.includes("d11"), "자리가 없으면 3점은 빠짐");
  // usp 빈 칸 채우기: usp 가 가리키는 사진이 없으면(아직 안 쓰인 score≥3 usable 사진) 배정
  const c2 = { ...copy, usp: { ...copy.usp, items: [{ title: "오래오래 든든하게", desc: "x", imageId: null }, { title: "쉬운 세척", desc: "y", imageId: "d12" }] } }; // 첫 항목은 명사 근거도 없음 → 빈 칸 채우기
  const p2 = mk({ vision, copy: c2, limits: { maxPageH: 1e9, maxFeatures: 1 } });
  const usp = p2.sections.find((s) => s.type === "usp");
  const used = p2.sections.filter((s) => s.type !== "usp").flatMap((s) => [s.image, ...(s.images || [])]).filter(Boolean);
  assert.ok(usp.items[0].image, JSON.stringify(usp.items[0]));
  for (const it of usp.items) if (it.image) assert.ok(!["d03", "d10", "d12", "d01"].includes(imageIdOf(it.image)) && !used.includes(it.image));
  assert.equal(usp.items[0].image, "clean/d09.png", "빈 칸에는 다른 섹션에 안 쓰인 usable(score 3) 사진");
  assert.ok(!used.includes(usp.items[0].image));
});

test("usp 카드: coverage 낮은 사진(자르지 못해 쓴 전체본 — 상품이 작고 벽이 큼)은 쓰지 않는다(feature 만)", () => {
  // 사진 모드(photo 키 있음): d01 만 coverage 0.17(전체본 대체), 나머지는 1
  const cl = fx.cleaned.map((c) => ({ ...c, photo: { file: c.out, rect: { x: 0, y: 0, w: 790, h: 600 }, coverage: c.id === "d01" ? 0.17 : 1 } }));
  const plan = mk({ cleaned: cl, ...NOLIM });
  const usp = plan.sections.find((s) => s.type === "usp");
  assert.notEqual(usp.items[0].image, "clean/d01.png", "usp.imageId 가 d01 이라도 coverage 0.17 이면 안 쓴다");
  assert.ok(plan.sections.some((s) => s.type === "feature" && s.imageId === "d01"), "feature 로는 쓴다");
  assert.ok(!(plan.sections.find((s) => s.type === "gallery")?.images || []).includes("clean/d01.png"));
});

test("v2: 기획안 기반 카피 → problem/agitate/solution/benefits/proof/compare/steps/objections/trust 섹션(순서 고정), 누끼는 hero·solution/proof·compare·size 에 우선", () => {
  const brief = rulesBrief(briefInputFrom(copyInput));
  const c2 = { ...rulesCopyV2(copyInput, brief), compare: { rows: [{ item: "재질", generic: "얇은 플라스틱", ours: "두꺼운 PP" }] } };
  const cut = (id) => ({ file: `clean/${id}_cut.png`, w: 600, h: 700, ok: true });
  const cleaned = fx.cleaned.map((c) => (c.id === "g02" ? { ...c, cutout: cut("g02") } : c.id === "d04" ? { ...c, cutout: cut("d04") } : c.id === "d11" ? { ...c, cutout: { ...cut("d11"), ok: false } } : c.id === "d01" ? { ...c, cutout: cut("d01") } : c));
  // 누끼 사용 여부는 비전이 정한다: g02·d04·d11 은 product_only, d01 은 사람이 함께(product_in_scene) → 누끼 금지
  const vision = [{ id: "g02", usable: true, score: 4, subject: "product", product_only: true, role: "hero" }, { id: "d04", usable: true, score: 3, subject: "product", product_only: true, role: "detail" },
    { id: "d11", usable: true, score: 3, subject: "product", product_only: true, role: "detail" }, { id: "d01", usable: true, score: 5, subject: "product_in_scene", product_only: false, role: "feature" }, { id: "g01", usable: true, score: 5, subject: "product_in_scene", product_only: false, role: "hero" }];
  const plan = mk({ copy: c2, cleaned, vision, ...NOLIM });
  assert.equal(plan.meta.version, 2);
  const types = plan.sections.map((s) => s.type);
  let last = -1; for (const t of types) { const i = SECTION_ORDER_V2.indexOf(t); assert.ok(i >= 0, `알 수 없는 섹션 ${t}`); assert.ok(i >= last, `순서 어긋남 ${t}`); last = i; }
  for (const t of ["hero", "keywords", "problem", "agitate", "solution", "benefits", "foryou", "point", "proof", "compare", "steps", "objections", "trust", "faq", "cta"]) assert.ok(types.includes(t), `섹션 ${t}`);
  assert.ok(!types.includes("feature"), "editorial 필드가 있으면 feature 는 point 로");
  assert.ok(!types.includes("pain") && !types.includes("usp"), "v2 에서는 pain/usp 대신 problem/benefits");
  const by = (t) => plan.sections.find((s) => s.type === t);
  assert.equal(by("hero").image, "clean/g02_cut.png", "product_only 누끼가 있는 g02 의 누끼가 hero 1순위(score 5 인 g01 보다 우선)");
  assert.deepEqual(by("hero").title_en, c2.hero_en.title_en); assert.equal(by("hero").script, c2.hero_en.script);
  assert.equal(by("solution").image, null, "hero 누끼(g02)는 이미 쓰였으니 solution 에는 안 씀(1회만)");
  const all = plan.sections.flatMap((s) => [s.image, s.cutout, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean);
  assert.equal(all.filter((p) => /d04/.test(p)).length, 1, "같은 원본(d04 사진·누끼)은 페이지에 1회만");
  assert.equal(all.filter((p) => /g02/.test(p)).length, 1);
  assert.ok(/[가-힣]/.test(by("point").label) && by("point").label.length <= 8 && by("point").title && by("point").image, JSON.stringify(by("point")));
  assert.ok(!JSON.stringify(plan.sections).includes("d01_cut"), "사람이 함께 있는 사진의 누끼는 어디에도 안 씀");
  const noVision = mk({ copy: c2, cleaned, ...NOLIM });
  assert.ok(!JSON.stringify(noVision.sections).includes("_cut"), "비전 판정이 없으면 누끼를 쓰지 않고 사진을 쓴다");
  assert.equal(mk({ copy: c2, cleaned, vision: vision.filter((v) => v.subject !== "product").concat([{ id: "g02", usable: true, score: 4, subject: "product_in_scene", product_only: false, role: "feature" }]), ...NOLIM }).sections[0].image, "clean/g01.png", "product_only 누끼가 없으면 score 최고 사진이 hero");
  assert.equal(by("benefits").chain_check, c2.chain_check); assert.equal(by("benefits").items.length, c2.usp.items.length);
  assert.equal(by("problem").items.length, 3); assert.ok(by("agitate").text.length > 10); assert.ok(by("solution").angle);
  assert.equal(by("proof").items.length, c2.proof.length); assert.equal(by("compare").rows.length, 1); assert.equal(by("steps").items.length, 3);
  assert.equal(by("keywords").items.length, c2.keywords.length); assert.equal(by("foryou").items.length, 4);
  assert.ok(!by("size") || by("size").image === null || /_cut/.test(by("size").image), "v2 사이즈 이미지는 누끼만");
  assert.ok(by("objections").items.length >= 3 && by("trust").items.length >= 1);
  assert.ok(plan.estimatedHeight > 0);
  // v1 카피는 그대로 v1 구조
  const p1 = mk({ cleaned, vision, ...NOLIM });
  assert.equal(p1.meta.version, 1); assert.ok(p1.sections.some((s) => s.type === "pain") && !p1.sections.some((s) => s.type === "problem"));
  assert.equal(p1.sections[0].image, "clean/g02.png", "v1 에서도 product_only 누끼 있는 사진이 hero 우선");
});

test("다음 라운드: 같은 사진은 페이지에 1회만(크롭·누끼 포함), v2 사이즈는 누끼만, checkpoint 는 비전 callout_points + 카피 라벨, options_table", () => {
  assert.deepEqual(photoKey("clean/g01_cut.png"), { id: "g01", piece: null }); assert.deepEqual(photoKey("clean/d05_02.png"), { id: "d05", piece: "02" });
  const d = dedupePhotos([{ type: "hero", image: "clean/g01.png" }, { type: "problem", items: [] }, { type: "point", image: "clean/g01_cut.png" }, { type: "size", image: "clean/g01.png" }, { type: "point", image: "clean/d05_01.png" }, { type: "point", image: "clean/d05_02.png" }, { type: "gallery", images: ["clean/d05.png", "clean/g03.png"] }]);
  assert.deepEqual(d.sections.map((s) => s.type), ["hero", "problem", "size", "point", "point", "gallery"], "hero 와 같은 원본 point 는 빠짐");
  assert.equal(d.sections[2].image, null, "사이즈에 hero 사진 재사용 금지");
  assert.deepEqual(d.sections[5].images, ["clean/g03.png"], "조각이 쓰인 원본 전체는 갤러리에서 빠짐");
  // checkpoint·options (editorial)
  const brief = rulesBrief(briefInputFrom(copyInput));
  const c2 = { ...rulesCopyV2(copyInput, brief), callouts: [{ label: "두꺼운 벽면" }, { label: "손잡이" }, { label: "접이 구조" }], options_table: [{ name: "소형", size: "40*30*60cm" }] };
  const cut = (id) => ({ file: `clean/${id}_cut.png`, w: 600, h: 700, ok: true });
  const cleaned = fx.cleaned.map((c) => (["g02", "d04"].includes(c.id) ? { ...c, cutout: cut(c.id) } : c));
  const vision = [{ id: "g02", usable: true, score: 5, subject: "product", product_only: true, role: "hero", callout_points: [] },
    { id: "d04", usable: true, score: 4, subject: "product", product_only: true, role: "detail", callout_points: [{ x: 0.2, y: 0.3, label: "벽면" }, { x: 0.8, y: 0.2, label: "손잡이" }, { x: 0.5, y: 0.9, label: "바닥" }, { x: 1.4, y: -1, label: "모서리" }] }];
  const plan = mk({ copy: c2, cleaned, vision, ...NOLIM });
  const cp = plan.sections.find((s) => s.type === "checkpoint");
  assert.equal(cp.cutout, "clean/d04_cut.png");
  assert.deepEqual(cp.callouts.map((c) => c.label), ["두꺼운 벽면", "손잡이", "접이 구조", "모서리"], "카피 라벨 우선, 모자라면 비전 부품 이름");
  assert.deepEqual([cp.callouts[3].x, cp.callouts[3].y], [1, 0], "좌표는 0~1 로");
  const opt = plan.sections.find((s) => s.type === "options");
  assert.ok(!opt || opt.cutout === null, "options 누끼는 checkpoint 와 같은 d04 라 1회만(빠짐)");
  assert.deepEqual(opt.options_table, [{ name: "소형", size: "40*30*60cm" }]);
  assert.ok(!plan.sections.find((s) => s.type === "size")?.image, "v2 사이즈: 남은 product_only 누끼가 없으면 글만");
  assert.equal(plan.meta.templateId, "clean"); assert.equal(buildPlan({ source: fx.source, ocr: fx.ocr, cleaned, copy: c2, vision }).meta.templateId, "editorial");
});

test("지휘자 판정: AI 장면 사진(scenes) 1순위 — hero·point·usp, 사람 사진은 usp·point·hero 금지, 클로즈업(role detail)은 갤러리로만", () => {
  const vision = [{ id: "g01", usable: true, score: 4, subject: "product_in_scene", role: "scene" }, { id: "g02", usable: true, score: 5, subject: "product", role: "hero" },
    { id: "d01", usable: true, score: 5, subject: "person", role: "scene", caption_title: "" }, { id: "d02", usable: true, score: 4, subject: "product_in_scene", role: "feature" },
    { id: "d04", usable: true, score: 4, subject: "product", role: "detail" }, { id: "d11", usable: true, score: 4, subject: "product_in_scene", role: "feature" }];
  const scenes = { items: [
    { id: "s01_1", shot: "s01", purpose: "hero", file: "scene/s01-1.png", pass: true, score: 5, human: "ok" }, { id: "s01_2", shot: "s01", purpose: "hero", file: "scene/s01-2.png", pass: true, score: 4 },
    { id: "s02_1", shot: "s02", purpose: "point", file: "scene/s02-1.png", pass: false, score: 4, human: "reject" }, { id: "s02_2", shot: "s02", purpose: "point", file: "scene/s02-2.png", pass: true, score: 4, title_ko: "길이 조절" },
    { id: "s06_1", shot: "s06", purpose: "usage", file: "scene/s06-1.png", pass: true, score: 4 }, { id: "s07_1", shot: "s07", purpose: "detail", file: "scene/s07-1.png", pass: true, score: 3, human: "reject" } ] };
  const plan = mk({ vision, scenes, limits: { maxPageH: 1e9 } });
  assert.equal(plan.sections[0].image, "scene/s01-1.png"); assert.equal(plan.sections[0].scene, true);
  const feats = plan.sections.filter((s) => s.type === "feature");
  assert.deepEqual(feats.slice(0, 2).map((f) => f.image), ["scene/s02-2.png", "scene/s06-1.png"], "통과한 장면만(사람이 reject 한 것 제외), 같은 컷은 최고 점수 1장");
  assert.ok(feats.slice(0, 2).every((f) => f.scene));
  const used = plan.sections.flatMap((s) => [s.image, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean);
  assert.ok(!used.includes("scene/s02-1.png") && !used.includes("scene/s07-1.png") && !used.includes("scene/s01-2.png"));
  const usp = plan.sections.find((s) => s.type === "usp");
  assert.ok(!usp.items.some((i) => /d01/.test(i.image || "")) && !feats.some((f) => f.imageId === "d01"), "사람 사진(d01)은 usp·point 금지");
  assert.ok(!feats.some((f) => f.imageId === "d04"), "role detail(클로즈업)은 point 금지");
  const gal = plan.sections.find((s) => s.type === "gallery");
  assert.ok(gal && gal.images.includes("clean/d04.png"), "클로즈업은 갤러리로");
  assert.deepEqual(plan.scenes.map((x) => x.id), ["s01_1", "s01_2", "s02_2", "s06_1"]);
  // 사람이 hero 후보면 금지
  assert.notEqual(mk({ vision: vision.map((v) => (v.id === "g02" ? { ...v, subject: "person" } : v)).concat([{ id: "g01", usable: true, score: 3, subject: "person", role: "hero" }]), limits: { maxPageH: 1e9 } }).sections[0].image, "clean/g02.png");
});

test("마지막 손질: editorial 포인트 최대 4개 — 장면 > score≥4·제품 보이는 사진만, 갤러리도 같은 규칙 최대 4장", () => {
  const brief = rulesBrief(briefInputFrom(copyInput));
  const c2 = { ...rulesCopyV2(copyInput, brief) }; c2.points = [...c2.points, { label: "추가", title: "추가 포인트", desc: "x" }, { label: "추가2", title: "추가 포인트2", desc: "y" }];
  const ids = ["g01", "g02", "g03", "d01", "d02", "d04", "d05", "d06", "d08", "d09", "d11", "d12"];
  const vision = ids.map((id, i) => ({ id, usable: true, score: id === "d11" ? 3 : 4, subject: id === "d09" ? "other" : id === "d06" ? "person" : "product_in_scene", role: "feature" }));
  const plan = mk({ copy: c2, vision, limits: { maxPageH: 1e9 } });
  const pts = plan.sections.filter((s) => s.type === "point");
  assert.ok(pts.length <= 4 && pts.length >= 1, String(pts.length));
  assert.ok(pts.every((p) => !["d09", "d11", "d06"].includes(imageIdOf(p.image))), "score 3·other·person 사진은 포인트 금지");
  const gal = plan.sections.find((s) => s.type === "gallery");
  assert.ok(!gal || (gal.images.length <= 4 && gal.images.every((p) => !["d09", "d11", "d06"].includes(imageIdOf(p)))));
});

test("v4: 기획서 plan_direction 이 있으면 구간 순서(첫 화면→초반→중반→디테일→후반→마지막)로 섹션 배치, scene-prompt 에 styleGuide 공통 규칙", async () => {
  const { SECTION_ORDER_V3, PLAN_PART_SECTIONS } = await import("../../src/main/detail/plan-core.js");
  const { planShots, styleRule } = await import("../../src/main/detail/scene-prompt.js");
  const { rulesBriefV3, briefV3InputFrom, rulesStyleGuide } = await import("../../src/main/detail/brief.js");
  const kc = rulesBriefV3(briefV3InputFrom(copyInput));
  const c2 = rulesCopyV2(copyInput, kc);
  const plan = mk({ copy: c2, brief: kc, limits: { maxPageH: 1e9 } });
  const types = plan.sections.map((s) => s.type);
  let last = -1; for (const t of types) { const i = SECTION_ORDER_V3.indexOf(t); assert.ok(i >= 0, t); assert.ok(i >= last, `순서 ${t}`); last = i; }
  assert.ok(types.indexOf("size") > types.indexOf("gallery") && types.indexOf("spec") > types.indexOf("size"), "후반=사이즈, 마지막=스펙");
  assert.deepEqual(plan.meta.plan_direction.map((p) => p.part), Object.keys(PLAN_PART_SECTIONS));
  const sg = { ...rulesStyleGuide(null), lighting: "아침 창가 햇살", forbiddenProductUsage: "제품을 손에 들지 않은 컷에서 제품을 새로 만들지 말 것" };
  const shots = planShots({ product: { title_ko: "빨래 건조대" }, styleGuide: sg, brief: { avoid: "사람 얼굴", avoid_en: "human faces" } });
  assert.ok(shots.every((s) => s.prompt_ko.includes("아침 창가 햇살") && s.prompt_ko.includes("새로 만들지 말 것") && s.prompt_en.includes("Do not invent the product") && s.prompt_en.endsWith("Avoid: human faces.")));
  assert.ok(styleRule(null).ko.includes("새로 그려 넣지"));
});

test("v5: planSectionsV5 — 섹션 9~11개(기획 방향 순서), 섹션마다 shot(needs·textZone)·copy 자리, 규격 2종이면 options, 활용 장소 4", async () => {
  const { planSectionsV5, buildPlanV5, sizeOptionsFrom, placesFrom } = await import("../../src/main/detail/plan-core.js");
  const { parseBriefText } = await import("../../src/main/detail/brief.js");
  const { rulesCopyV5, attachV5 } = await import("../../src/main/detail/copy.js");
  const kc = parseBriefText(fs.readFileSync(path.join(here, "fixture", "moast-keycontent-sample.txt"), "utf8"));
  const secs = planSectionsV5({ brief: kc, styleGuide: { forbiddenProductUsage: "제품 사진 없는 섹션에 제품을 새로 넣지 않는다" } });
  assert.ok(secs.length >= 9 && secs.length <= 12, String(secs.length)); // v8: 문제 제기(질문 한 줄) 섹션 추가로 최대 12
  assert.deepEqual(secs.map((s) => s.type).slice(0, 7), ["hero", "problem", "before_after", "checkpoint", "feature", "feature", "feature"]);
  assert.ok(secs.find((s) => s.type === "feature").shot.needs.includes(kc.advantages[0]));
  assert.deepEqual(sizeOptionsFrom(kc).map((r) => r.name), ["낮은형", "높은형"]); assert.ok(secs.some((s) => s.type === "options"));
  assert.equal(placesFrom(kc).length, 4); assert.ok(placesFrom(kc).includes("홈카페"));
  assert.ok(secs.filter((s) => s.shot).every((s) => s.shot.needs && s.shot.textZone && s.shot.rule));
  assert.ok(!secs.some((s) => s.type === "notice" && s.shot), "주의 섹션은 장면 없음");
  // buildPlanV5: 장면 1순위 → 비전 상위 사진 → 글만 카드
  const copy = attachV5(rulesCopyV5({ title_ko: "커피머신 선반" }, kc, secs), secs);
  const T = (t, k = 0) => secs.filter((x) => x.type === t)[k]; const hero = T("hero"), f1 = T("feature"), f2 = T("feature", 1), cpS = T("checkpoint"), f3 = T("feature", 2);
  const scenes = { items: [{ section: hero.id, file: "scene/v5-hero-1.png", pass: true, score: 5 }, { section: f1.id, file: "scene/v5-f1-1.png", pass: true, score: 4 }, { section: f1.id, file: "scene/v5-f1-2.png", pass: false }] };
  const vision = [{ id: "g02", usable: true, score: 5, subject: "product", role: "hero" }, { id: "d03", usable: true, score: 4, subject: "product_in_scene", role: "feature" }, { id: "d04", usable: true, score: 5, subject: "person", role: "scene" }];
  const cleaned = [{ id: "g02", out: "clean/g02.png", photo: { file: "clean/g02.png" } }, { id: "d03", out: "clean/d03.png", photo: { file: "clean/d03.png" } }, { id: "d04", out: "clean/d04.png", photo: { file: "clean/d04.png" } }];
  const pts = [{ x: 0.2, y: 0.3, part: "슬라이드" }, { x: 0.5, y: 0.6, part: "조립" }, { x: 0.8, y: 0.4, part: "거치" }, { x: 0.4, y: 0.9, part: "패드" }];
  const plan = buildPlanV5({ sections: secs, copy, scenes, vision, cleaned, calloutPoints: { [cpS.id]: pts }, sceneScope: "all" });
  const by = (id) => plan.sections.find((s) => s.id === id);
  assert.equal(plan.meta.templateId, "card"); assert.equal(plan.meta.version, 5);
  assert.equal(by(hero.id).image, "scene/v5-hero-1.png"); assert.equal(by(hero.id).from, "scene");
  assert.equal(by(f1.id).image, "scene/v5-f1-1.png");
  assert.equal(by(cpS.id).image, "clean/g02.png", "checkpoint 는 장면이 없으면 제품 단독(subject product) 비전 상위 사진");
  assert.equal(by(f2.id).image, "clean/d03.png", "다음 feature 는 남은 비전 사진");
  assert.ok(by(f3.id).textOnly && !by(f3.id).image, "사진이 없으면 글만 카드");
  assert.ok(!JSON.stringify(plan.sections).includes("d04"), "사람 사진은 안 씀");
  assert.ok(by(hero.id).name && by(hero.id).icons.length === 4 && by(f1.id).title.includes("\n"));
  assert.equal(by(cpS.id).callouts[0].label.split("\n").length, 2, "체크포인트 라벨 2줄(가는 설명/굵은 키워드)");
  assert.ok(plan.sections.some((s) => s.type === "spec" && s.rows.length >= 5));
  const noPhoto = buildPlanV5({ sections: secs, copy });
  assert.ok(!noPhoto.sections.some((s) => s.type === "checkpoint"), "제품 사진이 없으면 지시선 섹션은 뺀다");
});

test("지휘자 판정 v5: 체크포인트 지시선 좌표 매칭(라벨↔부품 이름), 좌표 없으면 섹션 생략, 규격 2종(스펙 '짧은/하이 스타일 크기'·이미지 글), 이전 섹션 id 유지", async () => {
  const { matchCallouts, sizeOptionsFrom, planSectionsV5, buildPlanV5 } = await import("../../src/main/detail/plan-core.js");
  const callouts = [{ thin: "꺼낼 때마다", bold: "슬라이드 레일" }, { thin: "손에 걸림 없이", bold: "둥근 손잡이" }, { thin: "넘어짐 방지", bold: "높은 가드레일" }, { thin: "흔들림 줄여주는", bold: "미끄럼 방지 매트" }];
  const m = matchCallouts(callouts, [{ x: 0.9, y: 0.9, part: "미끄럼 방지 매트" }, { x: 0.1, y: 0.2, part: "슬라이드 레일" }, { x: 1.4, y: 0.5, part: "가드레일" }, { x: 0.5, y: 0.5, part: "손잡이" }]);
  assert.deepEqual(m.map((c) => [c.bold, c.x, c.y]), [["슬라이드 레일", 0.1, 0.2], ["둥근 손잡이", 0.5, 0.5], ["높은 가드레일", 1, 0.5], ["미끄럼 방지 매트", 0.9, 0.9]]);
  assert.equal(matchCallouts(callouts, []).length, 0);
  const brief = { advantages: ["a", "b", "c"], specs: [{ k: "짧은 스타일 크기", v: "13.5cm x 37-57.5cm x 33.7cm" }, { k: "하이 스타일 크기", v: "20.5cm x 37-57.5cm x 33.7cm" }, { k: "제품 무게", v: "4.17kg / 5.15kg" }, { k: "스타일", v: "한국 스타일(심플)" }] };
  assert.deepEqual(sizeOptionsFrom(brief).map((r) => r.name), ["낮은형", "높은형"]);
  assert.deepEqual(sizeOptionsFrom({}, [], ["낮은형: 높이 13.5cm", "높은형 높이 20.5cm", "다양한 공간에 적합"]).map((r) => r.name), ["낮은형", "높은형"], "이미지별 글에서도");
  assert.deepEqual(sizeOptionsFrom({ specs: [{ k: "스타일", v: "심플" }] }), [], "규격 1종 이하면 없음");
  const prev = ["hero", "before_after", "checkpoint", "feature", "feature", "feature", "detail", "versatility", "notice", "spec", "faq"].map((t, i) => ({ id: `v5-${String(i + 1).padStart(2, "0")}-${t}`, type: t }));
  const secs = planSectionsV5({ brief, prev });
  assert.ok(secs.some((s) => s.type === "options" && s.id === "v5-options"), "새 섹션은 v5-<type>");
  assert.equal(secs.find((s) => s.type === "detail").id, "v5-07-detail", "기존 섹션 id 유지(장면 파일이 id 에 묶임)");
  assert.equal(secs.filter((s) => s.type === "feature")[2].id, "v5-06-feature");
  const cp = secs.find((s) => s.type === "checkpoint");
  const copy = { sections: { [cp.id]: { title: "CHECK", callouts: callouts.map((c) => ({ ...c, label: `${c.thin}\n${c.bold}` })) } } };
  const scenes = { items: [{ section: cp.id, file: "scene/cp.png", pass: true, callout_points: [{ x: 0.1, y: 0.2, part: "슬라이드 레일" }, { x: 0.5, y: 0.5, part: "손잡이" }, { x: 0.7, y: 0.5, part: "가드레일" }] }] };
  const plan = buildPlanV5({ sections: secs, copy, scenes, sceneScope: "all" });
  assert.equal(plan.sections.find((s) => s.type === "checkpoint").callouts.length, 3, "장면 검수에 묶인 callout_points 도 읽는다");
  assert.ok(!buildPlanV5({ sections: secs, copy, scenes: { items: [{ section: cp.id, file: "scene/cp.png", pass: true }] }, sceneScope: "all" }).sections.some((s) => s.type === "checkpoint"), "좌표가 없으면 체크포인트 생략");
});

test("사실 오류 방지: 스펙 색상 행 — 여러 색 옵션이면 '옵션 선택', 대표 사진 색과 반대면 빼고 주의에 기록, 의미 없는 속성 키 제외, options 제목 규격 이름 맞춤", async () => {
  const { cleanSpecRows, productColorFamily, planSectionsV5, buildPlanV5, MEANINGLESS_SPEC_KEY } = await import("../../src/main/detail/plan-core.js");
  const { attachV5 } = await import("../../src/main/detail/copy.js");
  const vision = [{ id: "g01", usable: true, score: 5, shows: "흰색 서랍 선반 정면" }, { id: "g02", usable: true, score: 4, shows: "화이트 수납장 위 커피머신" }, { id: "d01", usable: true, score: 2, shows: "검은 레일 클로즈업" }];
  assert.equal(productColorFamily({ vision }), "white");
  const specs = [{ k: "재질", v: "탄소강" }, { k: "색상", v: "블랙" }, { k: "스타일", v: "한국 스타일(심플)" }, { k: "적용 인원", v: "성인" }, { k: "하중", v: "25kg (제조사 표시 기준)" }];
  const r = cleanSpecRows(specs, { vision, options: [{ label_ko: "검은색" }] });
  assert.deepEqual(r.rows.map((x) => x.k), ["재질", "하중"]); assert.equal(r.cautions.length, 1);
  assert.deepEqual(cleanSpecRows([{ k: "색상", v: "블랙" }], { options: [{ label_ko: "블랙" }, { label_ko: "화이트" }] }).rows, [{ k: "색상", v: "옵션 선택" }]);
  assert.deepEqual(cleanSpecRows([{ k: "색상", v: "화이트" }], { vision }).rows, [{ k: "색상", v: "화이트" }], "사진과 같으면 그대로");
  assert.ok(MEANINGLESS_SPEC_KEY.test("스타일") && !MEANINGLESS_SPEC_KEY.test("재질") && !MEANINGLESS_SPEC_KEY.test("제품 무게"));
  const brief = { advantages: ["a", "b", "c"], specs: [...specs, { k: "짧은 스타일 크기", v: "13.5cm x 37cm" }, { k: "하이 스타일 크기", v: "20.5cm x 37cm" }] };
  const secs = planSectionsV5({ brief, vision });
  const plan = buildPlanV5({ sections: secs, copy: attachV5({ options: { title: "짧은형 13.5cm\n하이형 20.5cm" }, notice: { title: "주의", items: ["사진 속 소품은 구성품이 아닙니다."] } }, secs), vision });
  assert.ok(!plan.sections.find((s) => s.type === "spec").rows.some((r) => /색상|스타일|적용/.test(r.k)));
  assert.ok(!plan.sections.find((s) => s.type === "notice").items.some((t) => t.includes("색상(블랙)")), "색상 불일치 메모는 고객 주의 섹션에 넣지 않는다");
  assert.ok(plan.internalNotes.some((t) => t.includes("색상(블랙)")), "→ plan.internalNotes(확인 화면·로그 전용)");
  assert.equal(plan.sections.find((s) => s.type === "options").title, "낮은형 13.5cm\n높은형 20.5cm");
});

test("지휘자 판정: 활용 장소는 상품에 맞게(주방 수납장에 욕실·침실 금지) + 장면 레시피 shot.places 로 전달, 주의 문구는 고객 안내형만·규격 이름 통일", async () => {
  const { planSectionsV5, placeFits, placesFrom } = await import("../../src/main/detail/plan-core.js");
  const { sanitizeCopyV5, rulesCopyV5, attachV5, customerNotice, INTERNAL_TONE } = await import("../../src/main/detail/copy.js");
  const brief = { product_type: "커피머신 수납 슬라이드 서랍 선반", key_appeal: "홈카페 정리", advantages: ["a", "b", "c"], targets: ["홈카페 공간을 정리하고 싶은 분", "사무실 탕비실"],
    specs: [{ k: "짧은 스타일 크기", v: "13.5cm x 37cm" }, { k: "하이 스타일 크기", v: "20.5cm x 37cm" }],
    caution: ["하중 25kg은 제조사 표시 기준으로만 표기", "사진 속 커피용품 등 소품은 구성품이 아님", "녹 방지·방수 보호층은 완전 방수를 의미하지 않음", "협력사 로고 이미지는 노출하지 않음"] };
  assert.ok(!placeFits("욕실", brief) && !placeFits("침실", brief) && placeFits("데스크", brief));
  assert.ok(placesFrom(brief).every((p) => placeFits(p, brief)) && placesFrom(brief).includes("홈카페"));
  const secs = planSectionsV5({ brief });
  const vs = secs.find((s) => s.type === "versatility");
  assert.deepEqual(vs.shot.places, vs.copy.items.map((x) => x.label), "섹션 장소 = 장면 레시피 장소");
  const ai = { ...rulesCopyV5({ title_ko: "선반" }, brief, secs), versatility: { title: "어디든\n잘 어울려요", sub: "공간을 가리지 않아요", items: [{ label: "주방" }, { label: "데스크" }, { label: "욕실" }, { label: "침실" }] },
    notice: { title: "확인해 주세요", items: ["하중 25kg은 제조사 표시 기준으로만 표기", "사진 속 소품은 구성품에 포함되지 않습니다.", "짧은형과 높은형은 무게가 다릅니다.", "협력사 로고 이미지는 노출하지 않음"] } };
  const { copy, fixes } = sanitizeCopyV5(ai, { title_ko: "선반", images: [], attrs: [] }, brief, secs);
  const labels = copy.versatility.items.map((x) => x.label);
  assert.ok(!labels.includes("욕실") && !labels.includes("침실") && labels.length === 4, labels.join(","));
  assert.ok(fixes.some((f) => f.includes("상품에 안 맞는 장소")));
  assert.ok(copy.notice.items.every((t) => !INTERNAL_TONE.test(t)), JSON.stringify(copy.notice.items));
  assert.ok(copy.notice.items.includes("낮은형과 높은형은 무게가 다릅니다."), "짧은형 → 낮은형");
  const att = attachV5(copy, secs);
  assert.deepEqual(secs.find((s) => s.type === "versatility").shot.places, labels, "카피가 고른 장소가 장면 레시피로");
  assert.ok(att.sections[vs.id].items.length === 4);
  const cn = customerNotice(brief.caution);
  assert.ok(cn.includes("사진 속 소품은 구성품에 포함되지 않습니다.") && cn.every((t) => /니다\.$/.test(t)) && !cn.some((t) => /로고/.test(t)));
  assert.ok(rulesCopyV5({ title_ko: "선반" }, brief, secs).notice.items.every((t) => !INTERNAL_TONE.test(t)), "규칙 주의 문구도 고객 안내형");
});

test("v6: sceneScope 'mood'(기본) — 생성 장면은 hero·before_after·versatility 에만, options 는 치수 도면(한글화본) 1순위, checkpoint·feature 는 실제 썸네일(main) 후보", async () => {
  const { planSectionsV5, buildPlanV5, MOOD_SECTIONS } = await import("../../src/main/detail/plan-core.js");
  const brief = { product_type: "커피머신 수납 선반", advantages: ["슬라이드 레일 서랍", "설치 불필요", "보호 난간"], specs: [{ k: "낮은형 크기", v: "13.5cm x 37cm" }, { k: "높은형 크기", v: "20.5cm x 37cm" }] };
  const secs = planSectionsV5({ brief });
  const id = (t, k = 0) => secs.filter((s) => s.type === t)[k].id;
  const scenes = { items: ["hero", "before_after", "checkpoint", "feature", "options", "versatility"].map((t) => ({ section: id(t), file: `scene/${t}.png`, pass: true, score: 5 })) };
  const source = { images: [{ id: "g01", kind: "gallery" }, { id: "g02", kind: "gallery" }, { id: "d05", kind: "detail" }, { id: "d09", kind: "detail" }] };
  const vision = [{ id: "g01", usable: true, score: 5, subject: "product", has_text: false }, { id: "g02", usable: true, score: 4, subject: "product", has_text: false }, { id: "d05", usable: true, score: 4, subject: "product_in_scene" }];
  const cleaned = ["g01", "g02", "d05", "d09"].map((x) => ({ id: x, out: `clean/${x}.png` }));
  const ocr = { images: [{ id: "d09", boxes: [{ text: "13.5cm" }, { text_ko: "높이 20.5cm" }, { text: "33.7cm" }] }] };
  const localized = [{ id: "d09", out: "loc/d09.png" }];
  const plan = buildPlanV5({ sections: secs, copy: {}, scenes, vision, cleaned, source, ocr, localized });
  const by = (t, k = 0) => plan.sections.filter((s) => s.type === t)[k];
  assert.deepEqual(MOOD_SECTIONS, ["hero", "before_after", "versatility"]);
  assert.equal(by("hero").image, "scene/hero.png"); assert.equal(by("versatility").image, "scene/versatility.png");
  assert.equal(by("options").image, "loc/d09.png"); assert.equal(by("options").from, "localized", "치수 도면 한글화본이 1순위");
  assert.equal(by("feature").image, "clean/g01.png"); assert.equal(by("feature").from, "main", "feature 는 생성 장면 대신 실제 썸네일");
  assert.ok(!JSON.stringify(plan.sections).includes("scene/feature.png") && !JSON.stringify(plan.sections).includes("scene/options.png"));
  const all = buildPlanV5({ sections: secs, copy: {}, scenes, vision, cleaned, source, ocr, localized, sceneScope: "all" });
  assert.equal(all.sections.filter((s) => s.type === "feature")[0].image, "scene/feature.png");
  assert.equal(all.sections.find((s) => s.type === "options").image, "loc/d09.png", "all 이어도 치수 도면이 1순위");
});

test("v6: buildLocalizePlan — 이미지 순서 유지, 첫 장 hero(새 타이틀), promo 제외, 삭제 레이어 빼고, 맨 끝 notice·spec", async () => {
  const { buildLocalizePlan } = await import("../../src/main/detail/plan-core.js");
  const source = { images: [{ id: "g01", kind: "gallery" }, { id: "g02", kind: "gallery" }, { id: "d01", kind: "detail" }, { id: "d02", kind: "detail" }, { id: "d03", kind: "detail" }] };
  const localized = { hero: { label: "홈카페 필수템", sub: "조리대가 넓어지는 수납", name: "커피머신 선반" }, images: [
    { id: "d01", promo: false, layers: [{ zh: "抽拉设计", role: "title", x: 10, y: 20, w: 200, h: 40, ko: "슬라이드 서랍", drop: false }, { zh: "特价", role: "price", ko: "", drop: true }] },
    { id: "d02", promo: true, promo_reason: "인증서", layers: [] }, { id: "d03", promo: false, layers: [] }] };
  const files = { g01: "loc/g01.png", d01: "loc/d01.png", d03: "loc/d03.png" };
  const plan = buildLocalizePlan({ source, localized, files, copy: { notice: { title: "확인", items: ["사진 속 소품은 구성품에 포함되지 않습니다."] } }, brief: { product_name_ko: "커피머신 수납 선반", specs: [{ k: "재질", v: "탄소강" }, { k: "스타일", v: "심플" }] } });
  assert.equal(plan.meta.templateId, "localize"); assert.equal(plan.meta.version, 6);
  assert.deepEqual(plan.sections.map((s) => `${s.type}:${s.id || ""}`), ["hero:g01", "image:d01", "image:d03", "notice:", "spec:"]);
  assert.equal(plan.sections[0].name, "커피머신 선반"); assert.equal(plan.sections[0].image, "loc/g01.png");
  assert.deepEqual(plan.sections[1].layers.map((l) => l.ko), ["슬라이드 서랍"], "삭제 레이어(가격) 제외");
  assert.deepEqual(plan.excluded.map((x) => x.id), ["d02"]);
  assert.deepEqual(plan.sections.at(-1).rows, [{ k: "재질", v: "탄소강" }]);
});

test("A1 kind 변경: main/sku/detail 과 구 gallery/option/detail 둘 다 받는다, options 는 SKU 그림+label 1순위(sameAs 중복 제거)", async () => {
  const { planSectionsV5, buildPlanV5 } = await import("../../src/main/detail/plan-core.js");
  const toNew = (k) => ({ gallery: "main", option: "sku" }[k] || k);
  const srcNew = { ...fx.source, images: fx.source.images.map((im) => ({ ...im, kind: toNew(im.kind) })) };
  const a = mk(NOLIM), b = mk({ source: srcNew, ...NOLIM });
  assert.deepEqual(b.sections.map((s) => [s.type, s.image || ""]), a.sections.map((s) => [s.type, s.image || ""]), "새 kind 이름으로도 같은 plan");
  const brief = { product_type: "커피머신 선반", advantages: ["a", "b", "c"], specs: [{ k: "낮은형 크기", v: "13.5cm" }, { k: "높은형 크기", v: "20.5cm" }] };
  const secs = planSectionsV5({ brief });
  const source = { images: [{ id: "m01", kind: "main" }, { id: "s01", kind: "sku", label: "낮은형 화이트", sameAs: "m01" }, { id: "s02", kind: "sku", label: "높은형 화이트" }, { id: "s03", kind: "option", label: "낮은형 블랙", sameAs: "m01" }] };
  const cleaned = ["m01", "s01", "s02", "s03"].map((id) => ({ id, out: `clean/${id}.png` }));
  const plan = buildPlanV5({ sections: secs, copy: {}, source, cleaned, localized: [{ id: "d09", out: "loc/d09.png", dims: true }] });
  const op = plan.sections.find((s) => s.type === "options");
  assert.equal(op.from, "sku"); assert.deepEqual(op.skus.map((x) => x.label), ["낮은형 화이트", "높은형 화이트"], "sameAs 같은 SKU 는 하나만");
  assert.deepEqual(op.images, ["clean/m01.png", "clean/s02.png"], "sameAs 면 그 대표 사진");
  assert.ok(!op.image, "SKU 가 있으면 치수 도면보다 우선");
});

test("강조 예산: hero 1 + 섹션 3개당 1, 페이지 최대 5, 섹션당 1, 제목급만, 숫자(하중>사이즈) 우선, 특수 종류는 hero 만", async () => {
  const { budgetEmph, emphScore } = await import("../../src/main/detail/plan-core.js");
  assert.ok(emphScore("25kg") > emphScore("37~57.5cm") && emphScore("37cm") > emphScore("바로"));
  const L = (zh, ko, emph, extra = {}) => ({ zh, role: "title", ko, emph, rewrite_ok: true, ...extra });
  const secs = [{ type: "hero", name: "당겨 쓰는 수납장", name_emph: [{ text: "당겨 쓰는", kind: "dot" }, { text: "수납장", kind: "color" }] },
    ...Array.from({ length: 9 }, (_, i) => ({ type: "image", id: `d${i}`, layers: [L("x", `문구 ${i} 바로 거뜬히`, [{ text: "바로", kind: "dot" }, { text: "거뜬히", kind: "underline" }])] })),
  ];
  secs[3].layers.push(L("承重25kg", "하중 25kg", [{ text: "25kg", kind: "pill" }]));
  secs[5].layers = [L("37~57.5cm", "폭 37~57.5cm 조절", [{ text: "37~57.5cm", kind: "color" }])];
  secs[7].layers = [{ zh: "无需安装", role: "title", ko: "설치 불필요", icon: true, emph: [{ text: "설치", kind: "bold" }] }, { zh: "标签", role: "label", ko: "라벨 25kg", emph: [{ text: "25kg", kind: "color" }] }];
  const r = budgetEmph(secs, { mode: "sparse", allowSpecial: true });
  assert.equal(r.total, 4, "hero 1 + 9섹션/3 = 3");
  assert.deepEqual(secs[0].name_emph, [{ text: "당겨 쓰는", kind: "dot" }], "hero 는 1개, 특수 종류 허용");
  const all = secs.slice(1).flatMap((s) => s.layers.flatMap((l) => l.emph || []));
  assert.equal(all.length, 3); assert.ok(all.every((e) => ["bold", "color"].includes(e.kind)), "hero 밖은 bold·color 만");
  assert.ok(all.some((e) => e.text === "25kg") && all.some((e) => e.text === "37~57.5cm"), "숫자 우선");
  assert.ok(secs[3].layers.flatMap((l) => l.emph).length === 1, "섹션당 1개");
  assert.ok(!secs[7].layers.some((l) => (l.emph || []).length), "아이콘·라벨은 강조 금지");
});

test("상품 보임(비전 product_visible·bbox·other_brand): hero·feature 는 full 우선, 안 보이면 제외, 다른 브랜드 두드러지면 hero 금지, focus 전달", async () => {
  const { rankByProduct, buildLocalizePlan, planSectionsV5, buildPlanV5 } = await import("../../src/main/detail/plan-core.js");
  const { normalizeVisionItem } = await import("../../src/main/detail/vision.js");
  const n = normalizeVisionItem({ id: "g01", usable: true, score: 5, role: "hero", subject: "product_in_scene", product_visible: "partial", product_bbox: { x: 0.1, y: 0.5, w: 0.4, h: 1.4 }, other_brand_prominent: true });
  assert.deepEqual(n.product_bbox, { x: 0.1, y: 0.5, w: 0.4, h: 1 }); assert.equal(n.other_brand_prominent, true);
  const V = [{ id: "a", product_visible: "partial", product_bbox: { w: 0.3, h: 0.3 } }, { id: "b", product_visible: "none" }, { id: "c", product_visible: "full", other_brand_prominent: true }, { id: "d", product_visible: "partial", product_bbox: { w: 0.8, h: 0.8 } }];
  assert.deepEqual(rankByProduct(V).map((v) => v.id), ["c", "d", "a"]);
  assert.deepEqual(rankByProduct(V, { heroUse: true }).map((v) => v.id), ["d", "a"]);
  const lp = buildLocalizePlan({ source: { images: [{ id: "g01", kind: "main" }, { id: "g02", kind: "main" }, { id: "d01", kind: "detail" }] }, localized: { hero: { name: "x" }, images: [] }, files: { g01: "a.png", g02: "b.png", d01: "c.png" },
    vision: [{ id: "g01", usable: true, product_visible: "partial", product_bbox: { x: 0, y: 0.6, w: 0.3, h: 0.4 }, other_brand_prominent: true }, { id: "g02", usable: true, product_visible: "full", product_bbox: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } }] });
  assert.equal(lp.sections[0].id, "g02", "상품 잘린·타 브랜드 g01 대신 g02 가 hero"); assert.deepEqual(lp.sections[0].focus, { x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  const brief = { product_type: "수납랙", advantages: ["a", "b", "c"] };
  const secs = planSectionsV5({ brief });
  const source = { images: [{ id: "m1", kind: "main" }, { id: "m2", kind: "main" }] };
  const vision = [{ id: "m1", usable: true, score: 5, subject: "product", has_text: false, product_visible: "none" }, { id: "m2", usable: true, score: 4, subject: "product", has_text: false, product_visible: "full", product_bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }];
  const plan = buildPlanV5({ sections: secs, copy: {}, source, vision, cleaned: [{ id: "m1", out: "clean/m1.png" }, { id: "m2", out: "clean/m2.png" }], scenes: { items: [{ section: secs[0].id, file: "scene/h.png", pass: true }] } });
  const f = plan.sections.find((s) => s.type === "feature" && s.image);
  assert.equal(f.image, "clean/m2.png"); assert.deepEqual(f.focus, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  assert.ok(!JSON.stringify(plan.sections).includes("clean/m1.png"), "상품이 안 보이는 사진은 안 씀");
});

test("tidySpecUnits: 斤→kg 환산·중복 kg·남은 한자 정리", async () => {
  const { tidySpecUnits } = await import("../../src/main/detail/plan-core.js");
  const r = tidySpecUnits([{ k: "처리량", v: "약 1시간당 360斤(약 180kg, 제조사 표시 기준)" }, { k: "모터", v: "200W DC" }, { k: "x", v: "纯铜电机" }]);
  assert.equal(r[0].v, "약 1시간당 180kg(제조사 표시 기준)");
  assert.equal(r[1].v, "200W DC");
  assert.equal(r.length, 2);
});
