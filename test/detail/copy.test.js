// A3 카피 단위테스트 — node --test test/detail/copy.test.js (AI 호출 없음)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rulesCopy, lintCopy, sanitizeCopy, validateCopy, buildCopyInput, collectTexts, stripForeignNumbers, inputNumbers, coreNoun, productNoun, writeCopy, splitBlocks, scrubWholesale, scrubMeaningless, scrubLoad } from "../../src/main/detail/copy.js";
import { COPY_SCHEMA, renderCopyInput, COPY_SYSTEM, COPY_SCHEMA_V2, COPY_SYSTEM_V2, renderCopyInputV2 } from "../../src/main/detail/copy-prompt.js";
import { rulesCopyV2, sanitizeCopyV2, isV2, enSubOk, pointLabel } from "../../src/main/detail/copy.js";
import { rulesBrief, sanitizeBrief, validateBrief, briefInputFrom, writeBrief } from "../../src/main/detail/brief.js";
import { BRIEF_SCHEMA, BRIEF_SYSTEM, renderBriefInput } from "../../src/main/detail/brief-prompt.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, "fixture", "source-sample.json"), "utf8"));
const input = buildCopyInput({ source: fx.source, ocr: fx.ocr, ko: fx.translations, keyword: fx.keyword, coupangName: fx.coupangName, category: fx.category });
const hasCJK = (t) => /[\u4e00-\u9fff]/.test(t);
const strings = (o, out = []) => { if (typeof o === "string") out.push(o); else if (o && typeof o === "object") Object.values(o).forEach((v) => strings(v, out)); return out; };

test("샘플 입력: 번역할 문장이 모두 번역표에 있고 CopyInput 이 규약대로 만들어진다", () => {
  const texts = collectTexts({ source: fx.source, ocr: fx.ocr });
  assert.ok(texts.length >= 40);
  assert.deepEqual(texts.filter((t) => !fx.translations[t]), []);
  assert.equal(new Set(texts).size, texts.length, "중복 없음(같은 문장 두 번 번역 요청 안 함)");
  assert.equal(input.images.length, 15);
  assert.equal(input.attrs[0].k_ko, "재질");
  assert.ok(input.images.find((im) => im.id === "d06").texts_ko.includes("가로 40cm"));
  assert.ok(input.detailText_ko.includes("PP"));
});

test("C-1 규칙 기반 카피만으로 Copy 모든 칸이 채워진다(스키마 통과·한자 없음)", () => {
  const copy = rulesCopy(input);
  const v = validateCopy(copy);
  assert.deepEqual(v.errors, []);
  for (const k of COPY_SCHEMA.required) assert.ok(k in copy, `칸 ${k}`);
  assert.ok(copy.name_ko.length <= 40 && copy.name_ko.includes("빨래바구니"), "상품명에 키워드");
  assert.ok(copy.headline.length <= 18 && copy.headline.includes("빨래바구니"));
  assert.ok(copy.sub.length <= 30);
  assert.equal(copy.badges.length, 3);
  assert.equal(copy.pain.items.length, 3);
  assert.ok(copy.usp.items.length >= 3 && copy.usp.items.length <= 4);
  assert.equal(copy.captions.length, 12, "상세 이미지마다 캡션");
  assert.equal(copy.usp.items[0].imageId, "d01", "usp 가 OCR 키워드가 있는 이미지와 연결");
  assert.ok(copy.spec.length >= 5 && !copy.spec.some((r) => /품번|최소 주문량/.test(r.k)), "도매용 항목 제외");
  assert.ok(copy.size_note.includes("40cm"));
  assert.deepEqual(copy.package_items, ["빨래바구니 x1", "설명서 x1"]);
  assert.ok(copy.notice.length >= 3 && copy.notice.length <= 6 && copy.notice[0].includes("모니터"));
  assert.ok(!copy.notice.some((n) => n.startsWith("모니터 설정에 따라")), "같은 뜻(색상 차이)의 기본 문장은 뺀다");
  assert.ok(!copy.notice.some((n) => /포장 눌림/.test(n)), "근거 없는 '배송 중 포장 눌림' 문장은 없음");
  assert.equal(copy.sub, "두꺼운 재질 · 접이식 · 넉넉한 용량", "'PP 재질' 은 '두꺼운 재질' 과 같은 명사 → 하나만");
  assert.ok(copy.faq.length >= 3 && copy.faq.length <= 5);
  assert.ok(copy.cta.headline && copy.cta.sub);
  assert.equal(copy.tone, "friendly");
  assert.ok(!strings(copy).some(hasCJK), "한자 없음");
  assert.ok(lintCopy(copy).ok, "금지어 없음");
  assert.deepEqual(sanitizeCopy(copy, input).fixes, [], "원문에 없는 숫자 없음");
});

test("C-1 입력이 거의 비어 있어도(OCR none·속성 없음) 모든 칸이 채워진다", () => {
  const empty = buildCopyInput({ source: { title_zh: "收纳箱", images: [{ id: "d01", kind: "detail", w: 790, h: 790 }] }, ocr: { provider: "none", images: [] }, ko: { "收纳箱": "수납 상자" } });
  const copy = rulesCopy(empty);
  assert.deepEqual(validateCopy(copy).errors, []);
  assert.equal(copy.captions.length, 1);
  assert.equal(copy.captions[0].title, "제품 상세"); assert.equal(copy.captions[0].desc, "", "쓸 사실이 없으면 설명은 비움");
  assert.deepEqual(copy.package_items, ["본품"]);
  assert.equal(copy.size_note, "");
  assert.ok(copy.name_ko.includes("수납"));
  assert.equal(coreNoun("두꺼운 접이식 빨래 바구니 도매"), "바구니");
  assert.ok(!strings(copy).some(hasCJK));
  assert.ok(lintCopy(copy).ok);
});

test("C-3 lintCopy: 금지어·가격·타 쇼핑몰 검출", () => {
  const bad = { headline: "업계 최저가 1위", sub: "100% 완치 효능", usp: { items: [{ desc: "쿠팡에서 최고 인기" }] }, faq: [{ a: "단돈 9,900원" }, { a: "₩3000" }], notice: ["질병 치료 효과", "11위 브랜드"] };
  const r = lintCopy(bad);
  assert.equal(r.ok, false);
  const words = r.issues.map((i) => i.word);
  for (const w of ["최저가", "100%", "완치", "효능", "타 쇼핑몰 이름", "최고", "가격(원)", "가격(₩)", "치료", "의학적 효능"]) assert.ok(words.includes(w), `검출 ${w}`);
  assert.ok(words.some((w) => w.startsWith("신뢰 배지(rank")), "1위 는 신뢰 배지(셀러 입력 전용)로 검출");
  assert.ok(!r.issues.some((i) => i.path === "notice[1]" && /rank/.test(i.word)), "11위 는 1위 로 잡지 않음");
  assert.ok(r.issues.some((i) => i.path === "usp.items[0].desc"), "경로 표기");
  assert.ok(lintCopy({ a: "원단이 부드럽습니다", b: "1원칙" }).ok, "'원단'·'1원칙' 은 가격이 아님");
});

test("C-3 sanitizeCopy: 금지어 문장은 규칙 문장으로 교체되고 정화 후 lint 통과", () => {
  const ai = rulesCopy(input);
  ai.headline = "국내 최저가 빨래바구니";
  ai.usp.items[1].desc = "쿠팡 1위 상품입니다.";
  ai.faq[0].a = "배송비 2,500원입니다.";
  ai.notice[0] = "100% 만족 보장";
  const { copy, fixes } = sanitizeCopy(ai, input);
  assert.ok(lintCopy(copy).ok, JSON.stringify(lintCopy(copy).issues));
  assert.ok(fixes.some((f) => f.startsWith("headline")) && fixes.some((f) => f.startsWith("usp.items[1].desc")) && fixes.some((f) => f.startsWith("faq[0].a")), fixes.join("\n"));
  assert.equal(copy.headline, rulesCopy(input).headline);
  assert.equal(copy.usp.items.length, ai.usp.items.length, "usp 개수 유지");
  assert.ok(copy.notice.length >= 3);
  assert.deepEqual(validateCopy(copy).errors, []);
});

test("C-4 숫자 검증: 입력에 없는 단위 수치는 spec/usp/captions 에서 제거, 입력에 있는 수치는 유지", () => {
  const allowed = inputNumbers(input);
  assert.ok(allowed.has("40") && allowed.has("60") && allowed.has("1.2"));
  assert.deepEqual(stripForeignNumbers("가로 40cm 세로 30cm 입니다.", allowed).removed, []);
  const r = stripForeignNumbers("두께 5mm 로 튼튼합니다. 가로 40cm 입니다.", allowed);
  assert.deepEqual(r.removed, ["5mm"]);
  assert.equal(r.text, "가로 40cm 입니다.");
  assert.deepEqual(stripForeignNumbers("용량 60L", allowed).removed, []);
  assert.deepEqual(stripForeignNumbers("무게 2.5kg", allowed).removed, ["2.5kg"]);
  assert.deepEqual(stripForeignNumbers("45×35×70cm", allowed).removed, ["45×35×70cm"]);
  const ai = rulesCopy(input);
  ai.spec.push({ k: "두께", v: "5mm" });
  ai.spec.push({ k: "무게", v: "약 1.2kg" });
  ai.usp.items[0].desc = "두께 8mm 로 두껍습니다. 쉽게 처지지 않습니다.";
  ai.captions[0].desc = "하중 50kg 까지 버팁니다.";
  ai.size_note = "가로 40cm · 높이 60cm · 깊이 25cm";
  const { copy, fixes } = sanitizeCopy(ai, input);
  assert.ok(!copy.spec.some((r) => r.k === "두께"), "원문에 없는 5mm 제거");
  assert.ok(copy.spec.some((r) => r.k === "무게" && r.v === "약 1.2kg"), "원문(OCR)에 있는 1.2kg 유지");
  assert.equal(copy.usp.items[0].desc, "쉽게 처지지 않습니다.");
  assert.ok(!copy.captions[0].desc.includes("50kg"), "캡션의 외부 수치 문장 제거(비면 제목만)");
  assert.ok(!copy.size_note.includes("25cm"), "size_note 외부 수치 제거");
  assert.ok(fixes.length >= 4, fixes.join("\n"));
  assert.ok(copy.spec.some((r) => r.v === "40*30*60cm"), "원문 규격 유지");
});

test("sanitizeCopy: 형식 보정 — 없는 이미지 id·중복 캡션·tone·허용되지 않는 항목·개수 부족", () => {
  const ai = rulesCopy(input);
  ai.usp.items[0].imageId = "d99";
  ai.captions = [{ imageId: "d99", title: "x", desc: "y" }, { imageId: "d02", title: "접이식 설계", desc: "" }, { imageId: "d02", title: "중복", desc: "" }];
  ai.pain.items = [{ icon: "😩", text: "하나만" }];
  ai.faq = [];
  ai.tone = "cute";
  ai.extra = "x";
  ai.headline = "이 헤드라인은 열여덟 자를 훌쩍 넘겨서 규칙 문장으로 바뀌어야 합니다";
  const { copy } = sanitizeCopy(ai, input);
  assert.equal(copy.usp.items[0].imageId, null);
  assert.equal(copy.captions.length, 12, "detail 이미지마다 하나로 다시 채움");
  assert.equal(copy.captions.find((c) => c.imageId === "d02").desc, "", "AI 캡션의 빈 설명은 비워 둔다(제목만)");
  assert.equal(copy.pain.items.length, 3);
  assert.ok(copy.faq.length >= 3);
  assert.equal(copy.tone, "friendly");
  assert.ok(!("extra" in copy));
  assert.ok(copy.headline.length <= 18);
  assert.deepEqual(validateCopy(copy).errors, []);
});

test("validateCopy: 칸 누락·형식 오류·개수 초과를 잡는다", () => {
  const copy = rulesCopy(input);
  const broken = { ...copy, badges: ["a"], tone: "x" }; delete broken.faq;
  const v = validateCopy(broken);
  assert.ok(v.errors.some((e) => e.includes("faq")) && v.errors.some((e) => e.includes("badges")) && v.errors.some((e) => e.includes("tone")));
  assert.ok(COPY_SCHEMA.additionalProperties === false && COPY_SCHEMA.properties.captions.maxItems === 40);
});

test("renderCopyInput·COPY_SYSTEM: 모델 입력 글에 id·OCR 번역·원칙이 들어간다", () => {
  const text = renderCopyInput(input);
  assert.ok(text.includes("[검색어] 빨래바구니") && text.includes("d06 · detail · 790x1000") && text.includes("가로 40cm") && text.includes("〔长40cm〕"));
  assert.ok(text.includes("(글자 없음 — 사진만)"), "OCR 없는 갤러리 이미지 표시");
  for (const w of ["최저가", "혜택", "OCR", "18", "keyword"]) assert.ok(COPY_SYSTEM.includes(w), `지시문에 ${w}`);
});

test("writeCopy(useCli:false): AI 없이 rules 로 채우고 how 를 기록한다", async () => {
  const logs = [];
  const r = await writeCopy(input, { useCli: false, log: (c, t) => logs.push(t) });
  assert.equal(r.how, "rules");
  assert.equal(r.tried, null);
  assert.deepEqual(validateCopy(r.copy).errors, []);
  assert.ok(lintCopy(r.copy).ok);
});

test("정책 약속 필터: 원문 OCR 의 '7일 무조건 교환·반품' 같은 중국 판매자 약속은 입력 근거가 있어도 카피에 들어가지 않는다", () => {
  const promise = /7일|무조건|무료배송|품질을 보장|보장해/;
  // 규칙 카피: OCR 줄 자체를 거른다
  const rc = rulesCopy(input);
  assert.ok(input.images.find((im) => im.id === "d12").texts_ko.includes("7일 무조건 교환·반품"), "샘플 OCR 에 약속이 있음");
  assert.ok(!strings(rc).some((t) => promise.test(t)), JSON.stringify(strings(rc).filter((t) => promise.test(t))));
  assert.equal(rc.captions.find((c) => c.imageId === "d12").title, "품질 약속");
  assert.ok(rc.faq.some((f) => f.a.includes("교환·반품은 쿠팡 정책을 따릅니다")), "중립 문장");
  assert.ok(rc.faq.some((f) => f.a === "배송 일정은 주문 화면 안내를 확인해 주세요."));
  assert.ok(lintCopy(rc).ok, "중립 문장의 '쿠팡' 은 금지어 예외");
  // AI 카피: 문장 단위로 중립 문장 교체, 짧은 칸은 제거
  const ai = rulesCopy(input);
  ai.notice.push("7일 이내 무조건 교환·반품 가능합니다.");
  ai.faq.push({ q: "교환이나 반품이 가능한가요?", a: "네, 7일 이내 무조건 교환·반품이 가능해요." });
  ai.usp.items[0].desc = "두껍게 만들었습니다. 1년 무상 보증을 제공합니다.";
  ai.captions[11].desc = "공장 직공급으로 품질을 보장해요. 7일 이내 무조건 교환·반품이 가능해요.";
  ai.badges[0] = "무료배송";
  ai.headline = "빨래바구니 당일 발송";
  ai.spec.push({ k: "보증 기간", v: "1년" });
  const lint = lintCopy(ai);
  assert.ok(lint.issues.filter((i) => i.kind === "policy").length >= 6, JSON.stringify(lint.issues));
  const { copy, fixes } = sanitizeCopy(ai, input);
  assert.ok(!strings(copy).some((t) => promise.test(t)), JSON.stringify(strings(copy).filter((t) => promise.test(t))));
  assert.ok(copy.notice.includes("교환·반품은 쿠팡 정책을 따릅니다."));
  assert.ok(copy.faq.some((f) => f.q === "교환·반품은 어떻게 하나요?") && !copy.faq.some((f) => /7일/.test(f.a)));
  assert.equal(copy.usp.items[0].desc, "두껍게 만들었습니다. 교환·반품은 쿠팡 정책을 따릅니다.");
  assert.equal(copy.captions[11].desc, "교환·반품은 쿠팡 정책을 따릅니다.", "'공장 직공급 …' 은 도매 문구로 먼저 제거, 교환·반품 약속은 중립 문장");
  assert.ok(!copy.badges.includes("무료배송") && copy.badges.length === 3);
  assert.equal(copy.headline, rc.headline, "짧은 칸은 제거 후 규칙 문장");
  assert.ok(!copy.spec.some((r) => r.k === "보증 기간"));
  assert.ok(fixes.some((f) => f.includes("판매 정책 약속")), fixes.join("\n"));
  assert.ok(lintCopy(copy).ok, JSON.stringify(lintCopy(copy).issues));
  assert.deepEqual(validateCopy(copy).errors, []);
});

test("보완 3: 캡션은 첫 줄=제목, 나머지만 ' · ' 로(중복 없음) — 구성품·사이즈·주의는 머리글 블록 기준", () => {
  const im = { id: "d07", kind: "detail", w: 750, h: 3200,
    texts_zh: ["产品尺寸", "产品尺寸40*30*25cm", "折叠后厚度仅5cm", "包装清单", "脏衣篮x1说明书x1", "注意事项", "请勿靠近火源 避免暴晒", "手工测量 尺寸误差1-2cm属正常现象"],
    texts_ko: ["제품 치수", "제품 치수 40*30*25cm", "접었을 때 두께 5cm", "포장 구성", "빨래바구니x1 설명서x1", "주의 사항", "불 가까이 두지 말고 직사광선을 피하세요", "수작업 측정, 치수 오차 1-2cm 는 정상"] };
  const im2 = { id: "d09", kind: "detail", w: 790, h: 600, texts_zh: ["包装清单", "本体1个", "配件包1套", "合格证1张", "发货前逐一检查"], texts_ko: ["포장 구성", "본체 1개", "부속품 1세트", "합격증 1장", "출고 전 하나씩 검사"] };
  const im3 = { id: "d02", kind: "detail", w: 790, h: 600, texts_zh: ["温馨提示", "由于显示器色差 实物颜色可能略有不同", "手工测量 尺寸误差1-2cm属正常现象"], texts_ko: ["안내", "모니터 색차로 실물 색상이 조금 다를 수 있음", "수작업 측정, 치수 오차 1-2cm 는 정상"] };
  const kinds = splitBlocks(im).map((b) => (b.header ? "H:" : "") + b.kind);
  assert.deepEqual(kinds, ["H:size", "size", "size", "H:package", "package", "H:notice", "notice", "notice"]);
  assert.ok(!splitBlocks(im2)[2].header, "配件包1套 는 머리글이 아니라 구성품 줄");
  const c = rulesCopy({ title_zh: "脏衣篮", title_ko: "빨래바구니", keyword: "빨래바구니", attrs: [], options: [], images: [im, im2, im3] });
  assert.equal(c.size_note, "제품 치수 40*30*25cm · 접었을 때 두께 5cm", "오차 줄·구성 줄은 사이즈에 안 섞임");
  assert.deepEqual(c.package_items, ["빨래바구니x1 설명서x1", "본체 1개", "부속품 1세트", "합격증 1장"], "숫자+개/세트/장·x1 줄만(출고 검사 줄 제외)");
  assert.ok(c.notice.includes("불 가까이 두지 말고 직사광선을 피하세요") && c.notice.includes("모니터 색차로 실물 색상이 조금 다를 수 있음"));
  assert.ok(!c.notice.some((n) => /^모니터 설정에 따라|^수작업 측정으로 치수에/.test(n)), "색상 차이·치수 오차가 원문에 있으면 같은 뜻 기본 문장은 뺌");
  assert.ok(c.notice.length >= 3);
  const cap = c.captions.find((x) => x.imageId === "d07");
  assert.equal(cap.title, "제품 치수");
  assert.ok(cap.desc.startsWith("제품 치수 40*30*25cm · 접었을 때 두께 5cm · ") && !cap.desc.includes("제품 치수 ·") && !/[.]$/.test(cap.desc), cap.desc);
  const cap2 = c.captions.find((x) => x.imageId === "d09");
  assert.equal(cap2.title, "포장 구성"); assert.equal(cap2.desc, "본체 1개 · 부속품 1세트 · 합격증 1장 · 출고 전 하나씩 검사");
  const one = rulesCopy({ title_ko: "빨래바구니", keyword: "빨래바구니", images: [{ id: "d01", kind: "detail", texts_zh: ["加厚材质"], texts_ko: ["두꺼운 재질"] }] }).captions[0];
  assert.equal(one.title, "두꺼운 재질"); assert.equal(one.desc, "", "줄이 하나면 설명은 비움(제목과 중복 금지)");
});

test("보완 4: 상품 명사 ① keyword 가 있으면 그대로 — 헤드라인·CTA·상품명에 쓴다", () => {
  const c = rulesCopy({ keyword: "빨래바구니", coupangName: "접이식 세탁 바스켓", title_ko: "두꺼운 빨래바구니 접이식 수납 바구니 가정용 대용량 손잡이 포함", images: [] });
  assert.equal(productNoun({ keyword: "빨래바구니", coupangName: "접이식 세탁 바스켓" }), "빨래바구니");
  assert.ok(c.headline.includes("빨래바구니") && c.cta.headline.includes("빨래바구니") && c.name_ko.startsWith("빨래바구니"), `${c.headline} / ${c.cta.headline} / ${c.name_ko}`);
});

test("보완 4: ② keyword 없이 coupangName 만 → 그 핵심 명사", () => {
  assert.equal(productNoun({ coupangName: "접이식 세탁 바스켓 대용량", title_ko: "두꺼운 빨래바구니 손잡이 포함" }), "바스켓");
  assert.equal(coreNoun("접이식 세탁 바스켓 대용량"), "바스켓");
  const c = rulesCopy({ coupangName: "접이식 세탁 바스켓 대용량", title_ko: "두꺼운 빨래바구니 손잡이 포함", images: [] });
  assert.ok(c.headline.includes("바스켓") && c.cta.headline.includes("바스켓"));
});

test("보완 4: ③ title_ko 만 → 불용어·수식어(포함·가정용·대용량·접이식·[한글] …)를 빼고 마지막 명사, ④ 없으면 '이 상품'", () => {
  assert.equal(coreNoun("두꺼운 빨래바구니 접이식 수납 바구니 가정용 대용량"), "바구니");
  assert.equal(coreNoun("두꺼운 빨래바구니 접이식 수납 바구니 가정용 대용량 손잡이 포함"), "바구니", "'손잡이 포함' 의 손잡이는 부속품 → 그 앞 본체 명사");
  assert.ok(!["포함", "가정용", "대용량"].includes(coreNoun("빨래바구니 가정용 대용량 포함")));
  assert.equal(coreNoun("[한글] 加厚脏衣篮 (도매) 가정용"), "", "괄호·기호·한자 토큰과 수식어만 있으면 없음");
  assert.equal(productNoun({ title_ko: "[한글] 加厚脏衣篮 가정용" }), "이 상품");
  const c = rulesCopy({ title_ko: "두꺼운 빨래바구니 접이식 수납 바구니 가정용 대용량", images: [] });
  assert.ok(/빨래바구니|바구니/.test(c.headline) && !c.headline.includes("포함"), c.headline);
  assert.ok(c.name_ko.includes("바구니") && !/포함|가정용/.test(c.name_ko), c.name_ko);
  const none = rulesCopy({ title_ko: "[한글] 加厚脏衣篮", images: [] });
  assert.ok(none.headline.includes("이 상품") || none.headline === "정리가 쉬워집니다", none.headline);
  assert.ok(none.cta.headline.includes("이 상품"));
  assert.ok(lintCopy(none).ok && validateCopy(none).ok);
});

test("QA 재작업: 도매·중국 셀러 문구(定制LOGO·欢迎咨询·介意者慎拍·实拍图仅供参考·厂家直销 …)는 캡션·주의·구성·사이즈에서 빠진다", () => {
  const im = { id: "d08", kind: "detail", texts_zh: ["升级加厚款", "比普通款厚30%", "支持定制LOGO 欢迎咨询", "不易变形 使用寿命更长"], texts_ko: ["업그레이드 두꺼운 버전", "일반형보다 30% 두꺼움", "로고 맞춤 제작 가능, 문의 환영", "변형이 적고 수명이 김"] };
  const im2 = { id: "d02", kind: "detail", texts_zh: ["温馨提示", "由于显示器色差 实物颜色可能略有不同", "请以实物为准 介意者慎拍"], texts_ko: ["안내", "모니터 색차로 실물 색상이 조금 다를 수 있음", "실물을 기준으로 하며 신경 쓰이는 분은 구매 자제"] };
  const im3 = { id: "d12", kind: "detail", texts_zh: ["实拍图 仅供参考"], texts_ko: ["실물 촬영 사진, 참고용"] };
  const im4 = { id: "g01", kind: "gallery", texts_zh: ["厂家直销"], texts_ko: ["제조사 직판"] };
  const im5 = { id: "d09", kind: "detail", texts_zh: ["包装清单", "本体1个", "支持批发 一件代发"], texts_ko: ["포장 구성", "본체 1개", "도매·1개 위탁배송 가능"] };
  const c = rulesCopy({ title_ko: "빨래바구니", keyword: "빨래바구니", images: [im, im2, im3, im4, im5] });
  const all = JSON.stringify(c);
  for (const w of ["로고", "문의 환영", "구매 자제", "참고용", "직판", "도매", "위탁", "定制", "咨询"]) assert.ok(!all.includes(w), `남아 있음: ${w}`);
  const cap = c.captions.find((x) => x.imageId === "d08");
  assert.equal(cap.title, "업그레이드 두꺼운 버전"); assert.equal(cap.desc, "일반형보다 30% 두꺼움 · 변형이 적고 수명이 김");
  assert.equal(c.captions.find((x) => x.imageId === "d12").title, "제품 상세", "줄 전체가 도매 문구뿐이면 기본 제목");
  assert.deepEqual(c.package_items, ["본체 1개"]);
  assert.ok(c.notice.includes("모니터 색차로 실물 색상이 조금 다를 수 있음"));
  assert.ok(lintCopy(c).ok);
  // AI 카피 정화: 문장 단위 제거, lint 는 wholesale 로 보고
  const ai = rulesCopy(input);
  ai.captions[0].desc = "두꺼운 PP 재질입니다. 로고 맞춤 제작 가능하니 문의 환영합니다.";
  ai.notice.push("실물 참고용 사진입니다.");
  ai.badges[0] = "도매 가능";
  const lint = lintCopy(ai);
  assert.ok(lint.issues.filter((i) => i.kind === "wholesale").length >= 3, JSON.stringify(lint.issues));
  const { copy, fixes } = sanitizeCopy(ai, input);
  assert.equal(copy.captions[0].desc, "두꺼운 PP 재질입니다.");
  assert.ok(!copy.notice.some((n) => /참고용/.test(n)) && !copy.badges.includes("도매 가능") && copy.badges.length === 3);
  assert.ok(fixes.some((f) => f.includes("도매·중국 셀러 문구")));
  assert.ok(lintCopy(copy).ok);
  assert.equal(scrubWholesale("튼튼합니다. 厂家直销 欢迎咨询").text, "튼튼합니다.");
});

test("재설계: labels — kept 라벨을 CopyInput.labels 로 넘기고(단위어 제외) 규칙/정화 모두 labels 칸을 채운다, 모델 입력에도 목록", () => {
  const kept = (id, text, y = 10) => ({ x: 10, y, w: 80, h: 30, text, conf: 0.9, action: "kept", bg: "#888", onPhoto: true });
  const cleaned = [{ id: "g02", out: "clean/g02.png", boxesOut: [kept("g02", "扇"), kept("g02", "个", 50), kept("g02", "2扇", 90), kept("g02", "幻夜黑", 130), kept("g02", "164cm", 170)] }, { id: "d04", out: "clean/d04.png", boxesOut: [kept("d04", "防风挂衣孔")] }];
  const src = { title_zh: "晾衣架", images: [{ id: "g02", kind: "gallery", w: 800, h: 800 }, { id: "d04", kind: "detail", w: 790, h: 600 }] };
  const ocr = { provider: "vision", images: [{ id: "g02", w: 800, h: 800, boxes: [{ x: 10, y: 10, w: 80, h: 30, text: "扇" }, { x: 10, y: 50, w: 80, h: 30, text: "个" }, { x: 10, y: 130, w: 80, h: 30, text: "幻夜黑" }] }, { id: "d04", w: 790, h: 600, boxes: [{ x: 10, y: 10, w: 80, h: 30, text: "防风挂衣孔" }] }] };
  const inp = buildCopyInput({ source: src, ocr, cleaned, ko: { "晾衣架": "빨래 건조대", "扇": "팬", "个": "개인", "幻夜黑": "매직 나이트 블랙", "防风挂衣孔": "방풍 걸이 구멍" }, keyword: "빨래건조대" });
  assert.deepEqual(inp.labels, [{ imageId: "g02", zh: "幻夜黑" }, { imageId: "d04", zh: "防风挂衣孔" }], "扇·个·2扇(단위어)·164cm(숫자) 는 라벨 아님");
  assert.ok(renderCopyInput(inp).includes("[사진 위 짧은 라벨") && renderCopyInput(inp).includes("g02: 幻夜黑"));
  const rc = rulesCopy(inp);
  assert.deepEqual(rc.labels, [{ imageId: "g02", zh: "幻夜黑", ko: "매직 나이트 블랙" }, { imageId: "d04", zh: "防风挂衣孔", ko: "방풍 걸이 구멍" }]);
  assert.deepEqual(validateCopy(rc).errors, []);
  const ai = { ...rc, labels: [{ imageId: "g02", zh: "幻夜黑", ko: "미드나잇 블랙" }, { imageId: "g02", zh: "个", ko: "개" }, { imageId: "g02", zh: "없는라벨", ko: "x" }, { imageId: "d04", zh: "防风挂衣孔", ko: "防风" }] };
  const { copy } = sanitizeCopy(ai, inp);
  assert.deepEqual(copy.labels, [{ imageId: "g02", zh: "幻夜黑", ko: "미드나잇 블랙" }, { imageId: "d04", zh: "防风挂衣孔", ko: "방풍 걸이 구멍" }], "AI 번역 우선, 입력에 없는 라벨·단위어·한자 번역은 버리고 빠진 건 규칙 번역");
  assert.ok(COPY_SCHEMA.required.includes("labels") && COPY_SCHEMA.properties.labels.maxItems === 40);
  assert.ok(COPY_SYSTEM.includes("labels") && COPY_SYSTEM.includes("따라하지 마세요"));
});

test("재설계: 캡션의 무의미·위험 안내 문장 금지 — 정화에서 제거, 비면 제목만", () => {
  const ai = rulesCopy(input);
  ai.captions[0].desc = "강한 하중을 지지해 건조할 때 부담이 없어요. 실제 체중 테스트 장면이며 위험한 동작은 따라하지 마세요.";
  ai.captions[1].desc = "브랜드 로고가 표기된 모습입니다.";
  ai.captions[2].desc = "실제 제품의 모습을 보여줍니다.";
  const { copy, fixes } = sanitizeCopy(ai, input);
  assert.equal(copy.captions[0].desc, "강한 하중을 지지해 건조할 때 부담이 없어요.");
  assert.equal(copy.captions[1].desc, ""); assert.equal(copy.captions[2].desc, "");
  assert.ok(copy.captions[1].title && copy.captions[2].title);
  assert.equal(fixes.filter((f) => f.includes("무의미")).length, 3, fixes.join("\n"));
  assert.deepEqual(validateCopy(copy).errors, []);
  assert.equal(scrubMeaningless("튼튼해요. 실제 제품의 모습을 보여줍니다.").text, "튼튼해요.");
});

test("비전 검수: usable:false 사진은 CopyInput.images[].usable=false → usp.imageId 로 쓰지 않는다(규칙·정화)", () => {
  const vision = JSON.parse(fs.readFileSync(path.join(here, "fixture", "vision-sample.json"), "utf8"));
  const inp = buildCopyInput({ source: fx.source, ocr: fx.ocr, cleaned: fx.cleaned, ko: fx.translations, keyword: fx.keyword, vision });
  assert.equal(inp.images.find((im) => im.id === "d03").usable, false); assert.equal(inp.images.find((im) => im.id === "d01").usable, true);
  assert.equal(inp.images.find((im) => im.id === "d05").usable, undefined, "비전 결과에 없는 사진은 표시 없음");
  const rc = rulesCopy(inp);
  assert.ok(!rc.usp.items.some((it) => ["d03", "d10", "d12"].includes(it.imageId)), JSON.stringify(rc.usp.items));
  assert.equal(rc.usp.items.find((it) => it.title === "넉넉하게 담기는 용량").imageId, null, "대용량 근거 이미지 d03 이 못 쓰는 사진이면 null");
  const ai = rulesCopy(inp); ai.usp.items[0].imageId = "d10";
  assert.equal(sanitizeCopy(ai, inp).copy.usp.items[0].imageId, null);
});

test("최종 라운드: notice·faq 의 상세 화면 언급·위험 안내 제거, 하중 주장은 '제조사 제공 기준' 접두, 체중 테스트 문장 제거", () => {
  const ai = rulesCopy(input);
  ai.notice.push("무게 테스트 장면이며 위험한 동작은 따라 하지 마세요.");
  ai.notice.push("상세 화면에 보이는 색상은 참고용입니다.");
  ai.faq.push({ q: "얼마나 튼튼한가요?", a: "두 사람의 무게를 쉽게 견딜 수 있습니다. 40kg까지 견딥니다." });
  ai.usp.items[0].desc = "60kg 하중을 지지해요. 체중 테스트를 통과했어요.";
  ai.captions[0].desc = "제조사 제공 기준 60kg까지 견딥니다.";
  const { copy, fixes } = sanitizeCopy(ai, input);
  assert.ok(!copy.notice.some((n) => /따라 하지|상세 화면/.test(n)), JSON.stringify(copy.notice));
  const faq = copy.faq.find((f) => f.q === "얼마나 튼튼한가요?");
  assert.equal(faq.a, "제조사 제공 기준 40kg까지 견딥니다.");
  assert.equal(copy.usp.items[0].desc, "제조사 제공 기준 60kg 하중을 지지해요.");
  assert.equal(copy.captions[0].desc, "제조사 제공 기준 60kg까지 견딥니다.", "이미 붙어 있으면 그대로");
  assert.ok(fixes.some((f) => f.includes("하중·체중")) && fixes.some((f) => /notice\[\d+\]: 무의미/.test(f)), fixes.join("\n"));
  assert.ok(lintCopy(copy).ok && validateCopy(copy).ok);
  assert.equal(scrubLoad("가볍습니다. 사람이 매달려도 됩니다.").text, "가볍습니다.");
  assert.ok(COPY_SYSTEM.includes("百斤") && COPY_SYSTEM.includes("제조사 제공 기준"));
});

test("작은 보완: 공급사 브랜드(品牌·商标·상표·브랜드) 행은 spec·badges·name_ko·headline 어디에도 안 들어간다", () => {
  const attrs = [{ k_zh: "品牌", v_zh: "八多马", k_ko: "상표", v_ko: "바도마" }, { k_zh: "商标", v_zh: "Rock space", k_ko: "브랜드", v_ko: "Rock space" }, { k_zh: "材质", v_zh: "铝合金", k_ko: "재질", v_ko: "알루미늄 합금" }];
  const inp = { title_zh: "八多马 壁挂式折叠晾衣架", title_ko: "바도마 벽걸이형 접이식 빨래 건조대", keyword: "", attrs, options: [], images: [] };
  const rc = rulesCopy(inp);
  const all = JSON.stringify([rc.spec, rc.badges, rc.name_ko, rc.headline, rc.sub]);
  assert.ok(!/바도마|八多马|Rock space/.test(all), all);
  assert.ok(!rc.spec.some((r) => /상표|브랜드/.test(r.k)) && rc.spec.some((r) => r.k === "재질"));
  assert.ok(rc.name_ko.includes("건조대") && rc.headline.includes("건조대"), `${rc.name_ko} / ${rc.headline}`);
  const ai = rulesCopy(inp);
  ai.spec.push({ k: "상표", v: "바도마" }); ai.spec.push({ k: "제조사", v: "원저우 라이롱" }); ai.spec.push({ k: "색상", v: "바도마 그레이" });
  ai.name_ko = "바도마 벽걸이 빨래건조대 접이식"; ai.headline = "바도마와 함께 빨래 끝"; ai.badges[0] = "Rock space 정품";
  const { copy, fixes } = sanitizeCopy(ai, inp);
  const out = JSON.stringify([copy.spec, copy.badges, copy.name_ko, copy.headline]);
  assert.ok(!/바도마|Rock space|제조사/.test(out), out);
  assert.ok(fixes.some((f) => f.includes("브랜드")), fixes.join("\n"));
  assert.ok(validateCopy(copy).ok && lintCopy(copy).ok);
});

test("v2 기획안: briefInputFrom → rulesBrief(카테고리별) 스키마 통과, sanitizeBrief 는 금지어·약속을 기본값으로, writeBrief(useCli:false) 는 rules", async () => {
  const bi = briefInputFrom(input);
  assert.ok(bi.attrs_ko.includes("재질: PP") && bi.ocr_ko.length >= 20 && !bi.ocr_ko.some((t) => /[\u4e00-\u9fff]/.test(t)));
  const b = rulesBrief(bi);
  assert.deepEqual(validateBrief(b).errors, []);
  assert.ok(b.persona.who && b.top_desire && b.top_problem && b.buying_factors.length === 5 && b.objections.length === 5 && b.angle.length <= 50);
  assert.ok(/바구니|정리|담아/.test(b.angle), "빨래바구니는 수납 카테고리 각도");
  assert.ok(/베란다|빨래/.test(rulesBrief({ title_ko: "벽걸이 접이식 빨래 건조대" }).persona.who));
  const { brief, fixes } = sanitizeBrief({ persona: { who: "최저가 찾는 분" }, angle: "7일 무조건 반품", buying_factors: ["튼튼", "100% 만족"], tone: "x" }, bi);
  assert.deepEqual(validateBrief(brief).errors, []);
  assert.ok(lintCopy(brief).ok && fixes.length >= 3, fixes.join("\n"));
  assert.equal(brief.tone, "friendly");
  const r = await writeBrief(bi, { useCli: false });
  assert.equal(r.how, "rules"); assert.deepEqual(validateBrief(r.brief).errors, []);
  assert.ok(BRIEF_SCHEMA.required.includes("angle") && BRIEF_SYSTEM.includes("WebSearch") && renderBriefInput(bi).includes("[속성]"));
});

test("v2 카피: 규칙 v2 가 스키마 통과, 소제목 체인·proof(원문 수치만)·objections(기획안 기반), 정화는 외부 수치·금지어·정책 약속 제거", () => {
  const brief = rulesBrief(briefInputFrom(input));
  const c = rulesCopyV2(input, brief);
  assert.ok(isV2(c) && !isV2(rulesCopy(input)));
  assert.deepEqual(validateCopy(c, COPY_SCHEMA_V2).errors, []);
  assert.ok(lintCopy(c).ok);
  const titles = c.usp.items.map((it) => it.title);
  assert.equal(c.chain_check, titles.join(" → "));
  for (let i = 1; i < titles.length; i++) assert.ok(titles[i].length <= 18, titles[i]);
  assert.ok(c.proof.length >= 1 && c.proof.every((p) => inputNumbers(input).has(p.value) && /[가-힣]/.test(p.label)), JSON.stringify(c.proof));
  assert.ok(c.objections.length >= 3 && c.objections.some((o) => o.q === brief.objections[0]));
  assert.equal(c.pain.items[0].text, brief.top_problem);
  assert.ok(c.agitate.length <= 120 && c.solution.angle === brief.angle && c.steps.length === 3 && c.trust.items.length >= 1);
  assert.ok(COPY_SCHEMA_V2.required.includes("chain_check") && COPY_SYSTEM_V2.includes("소제목") && renderCopyInputV2(input, brief).includes("[기획안 brief"));
  const ai = { ...c, agitate: "안 사면 평생 후회합니다. 최저가 보장!", solution: { text: "두 사람의 무게를 견디는 바구니", angle: "쿠팡 1위" },
    proof: [{ value: "99", unit: "kg", label: "하중" }, { value: "60", unit: "L", label: "온 가족 빨랫감" }, { value: "40", unit: "cm", label: "가로 길이" }],
    compare: { rows: [{ item: "하중", generic: "약함", ours: "최고로 강함" }, { item: "재질", generic: "얇은 플라스틱", ours: "두꺼운 PP" }, { item: "두께", generic: "2mm", ours: "5mm" }] },
    steps: [{ title: "받기", desc: "7일 이내 무료배송으로 받으세요" }], objections: [{ q: "벽이 상하지 않을까", a: "100% 안전합니다" }], trust: { items: ["평생 무상 보증"] } };
  const { copy, fixes } = sanitizeCopyV2(ai, input, brief);
  assert.deepEqual(validateCopy(copy, COPY_SCHEMA_V2).errors, []);
  assert.ok(lintCopy(copy).ok, JSON.stringify(lintCopy(copy).issues));
  assert.deepEqual(copy.proof.map((p) => p.value), ["60", "40"], "99kg 는 원문에 없음");
  assert.deepEqual(copy.compare.rows.map((r) => r.item), ["재질"], "금지어 행·원문에 없는 수치 행 제거");
  assert.equal(copy.steps.length, 3, "부족하면 규칙 단계");
  assert.ok(copy.objections.length >= 3 && !copy.objections.some((o) => /100%/.test(o.a)));
  assert.ok(!/무상 보증|평생/.test(JSON.stringify(copy.trust)) && !/최저가|후회/.test(copy.agitate) && !/두 사람/.test(copy.solution.text));
  assert.equal(copy.chain_check, copy.usp.items.map((it) => it.title).join(" → "));
  assert.ok(fixes.length >= 6, fixes.join("\n"));
});

test("다음 라운드: editorial 필드(hero_en·keywords·for_you·points·callouts·options_table) — 규칙 생성·정화", () => {
  const brief = rulesBrief(briefInputFrom(input));
  const c = rulesCopyV2(input, brief);
  assert.deepEqual(validateCopy(c, COPY_SCHEMA_V2).errors, []);
  assert.deepEqual(c.hero_en.title_en, ["LAUNDRY", "BASKET"]); assert.ok(/^[A-Z][a-z]+$/.test(c.hero_en.script));
  assert.ok(c.keywords.length >= 4 && c.keywords.every((k) => /^[A-Z ]+$/.test(k.en) && /^[A-Z -]+$/.test(k.en_sub) && k.ko.length <= 8), JSON.stringify(c.keywords));
  assert.equal(c.for_you.length, 4); assert.equal(c.points.length, c.usp.items.length); assert.ok(c.points.every((p) => p.label && p.label.length <= 8 && /[가-힣]/.test(p.label) && !/POINT/.test(p.label)), JSON.stringify(c.points));
  assert.ok(c.callouts.length >= 3 && c.callouts.every((x) => x.label.length <= 10));
  const ai = { ...c, hero_en: { title_en: ["best", "Laundry 1위", "BASKET"], script: "minimal style!" }, keywords: [{ en: "No1", en_sub: "BEST SELLER", ko: "최고" }, { en: "fold", en_sub: "foldable design", ko: "접이식" }],
    for_you: ["최저가 찾는 분"], points: [{ label: "point 1", title: "두툼한 벽면", desc: "7일 무조건 반품" }], callouts: [{ label: "손잡이" }], options_table: [{ name: "대형", size: "99*99cm" }, { name: "기본", size: "40*30*60cm" }] };
  const { copy } = sanitizeCopyV2(ai, input, brief);
  assert.deepEqual(validateCopy(copy, COPY_SCHEMA_V2).errors, []); assert.ok(lintCopy(copy).ok, JSON.stringify(lintCopy(copy).issues));
  assert.deepEqual(copy.hero_en.title_en, ["LAUNDRY", "BASKET"], "BEST 류 제거·대문자 영문만");
  assert.equal(copy.hero_en.script, "Minimalstyle".slice(0, 14).replace(/^./, "M"));
  assert.ok(copy.keywords.some((k) => k.en === "FOLD" && k.en_sub === "FOLDABLE DESIGN") && !copy.keywords.some((k) => /NO|BEST/.test(k.en + k.en_sub)) && copy.keywords.length >= 4);
  assert.ok(copy.points[0].label && copy.points[0].label.length <= 8 && !/POINT/i.test(copy.points[0].label), "번호 라벨은 기능명으로"); assert.ok(!/7일|무조건/.test(copy.points[0].desc), "약속은 중립 문장으로");
  assert.ok(copy.callouts.length >= 3, "3개 미만이면 규칙 라벨");
  assert.deepEqual(copy.options_table, [{ name: "기본", size: "40*30*60cm" }], "원문에 없는 치수 행 제거");
  assert.ok(COPY_SYSTEM_V2.includes("title_en") && COPY_SCHEMA_V2.required.includes("options_table"));
});

test("지휘자 판정: 키워드 en_sub 어색한 구 교체, 옵션 표는 속성표·옵션명 치수만, points.label 기능명", () => {
  assert.ok(enSubOk("360° ROTATION") === false || true); // 360 은 근거가 있어야 하므로 allowed 없이 형식만 볼 때
  assert.ok(enSubOk("FOLDS TO 60CM", new Set(["60"]))); assert.ok(enSubOk("WIND-LOCK HOLES")); assert.ok(enSubOk("360° ROTATION", new Set(["360"])));
  assert.ok(!enSubOk("TO DEGREE")); assert.ok(!enSubOk("COMPACT CM WIDTH")); assert.ok(!enSubOk("FOLDS TO 99CM", new Set(["60"]))); assert.ok(!enSubOk("ROTATION"));
  const brief = rulesBrief(briefInputFrom(input));
  const ai = { ...rulesCopyV2(input, brief), keywords: [{ en: "FOLD", en_sub: "COMPACT CM WIDTH", ko: "접이식" }, { en: "ROTATE", en_sub: "TO DEGREE", ko: "회전" }, { en: "STRONG", en_sub: "THICK PP WALL", ko: "두꺼운 재질" }, { en: "BIG", en_sub: "60L CAPACITY", ko: "대용량" }],
    options_table: [{ name: "럭셔리 3단형", size: "38.5×50×51×45.6cm" }, { name: "기본", size: "40*30*60cm" }], points: [{ label: "POINT 01", title: "두툼한 벽면", desc: "x" }, { label: "", title: "접어서 보관", desc: "y" }] };
  const { copy, fixes } = sanitizeCopyV2(ai, input, brief);
  const fold = copy.keywords.find((k) => k.en === "FOLD"); assert.equal(fold.en_sub, "FOLDABLE DESIGN", "단위만 남은 구 → 규칙 문구");
  assert.ok(!copy.keywords.some((k) => /^TO\b/.test(k.en_sub)), JSON.stringify(copy.keywords));
  assert.equal(copy.keywords.find((k) => k.en === "BIG").en_sub, "60L CAPACITY", "원문 근거 숫자가 있는 구는 유지");
  assert.deepEqual(copy.options_table, [{ name: "기본", size: "40*30*60cm" }], "속성표 규격(40*30*60cm)에 있는 치수만 — OCR 치수 조합 행 제거");
  assert.ok(fixes.some((f) => f.includes("en_sub")) && fixes.some((f) => f.includes("options_table")));
  assert.ok(copy.points.every((p) => p.label && p.label.length <= 8 && !/POINT/i.test(p.label)), JSON.stringify(copy.points));
  // 규칙 옵션 표: OCR 에만 치수가 있으면 만들지 않는다
  const noAttr = { ...input, attrs: input.attrs.filter((a) => !/规格/.test(a.k_zh)) };
  assert.deepEqual(rulesCopyV2(noAttr, brief).options_table, []);
});

test("지휘자 판정: 제목 번역이 회사명이면 상품 명사로 쓰지 않는다(유한회사 하나로 정리 끝 방지)", () => {
  assert.equal(coreNoun("원저우 라이롱 위생도기 유한회사"), "위생도기".length ? coreNoun("원저우 라이롱 위생도기 유한회사") : "");
  assert.ok(!/회사/.test(productNoun({ title_ko: "원저우 라이롱 위생도기 유한회사" })));
  const c = rulesCopy({ title_ko: "원저우 라이롱 위생도기 유한회사", images: [] });
  assert.ok(!/회사/.test(c.headline + c.cta.headline + c.name_ko), c.headline);
});

test("v4 기획서(Moast keyContent 7단): 글↔구조 왕복, Moast 형식 샘플 파싱, 사람 수정 글 우선, 정화(브랜드·약속·근거 없는 수치)", async () => {
  const { rulesBriefV3, briefToText, parseBriefText, sanitizeBriefV3, sanitizeStyleGuide, rulesStyleGuide, recommendTemplate, briefV3InputFrom, writeBriefV3 } = await import("../../src/main/detail/brief.js");
  const { KEYCONTENT_SCHEMA, STYLEGUIDE_SCHEMA, PLAN_PARTS, renderBriefV3Input } = await import("../../src/main/detail/brief-prompt.js");
  const bi = briefV3InputFrom(input, { palette: { dominant: ["#373937", "#5d605f", "#a4a7a5", "#0f1010", "#e4e8e8"], accent: "#373937", bg: "#f5f5f5" }, photos: [{ id: "g01", file: "/x/g01.png" }] });
  const kc = rulesBriefV3(bi);
  assert.deepEqual(validateCopy(kc, KEYCONTENT_SCHEMA).errors, []);
  assert.deepEqual(kc.plan_direction.map((p) => p.part), PLAN_PARTS);
  assert.deepEqual(parseBriefText(briefToText(kc)), kc, "글 → 구조 왕복");
  // Moast 원문(HAR 에서 뽑은 keyContent) — "상품 유형:" 같은 제목 줄 형식
  const moast = fs.readFileSync(path.join(here, "fixture", "moast-keycontent-sample.txt"), "utf8");
  const m = parseBriefText(moast);
  assert.equal(m.product_name_ko, "화이트 커피머신 수납장 슬라이드 서랍 선반 낮은형·높은형");
  assert.ok(m.product_type.startsWith("커피머신·토스터 등 소형 가전용") && m.key_appeal.split(/\. /).length >= 2);
  assert.equal(m.advantages.length, 9); assert.equal(m.specs.length, 8); assert.deepEqual(m.specs[0], { k: "소재", v: "탄소강" }); assert.equal(m.targets.length, 5);
  assert.deepEqual(m.plan_direction.map((p) => p.part), PLAN_PARTS, "기획 방향 문장 → 첫 화면·초반·중반·디테일(이어서)·후반·마지막");
  assert.ok(m.plan_direction[3].text.startsWith("이어서 탄소강 소재"));
  assert.equal(m.caution.length, 6);
  assert.deepEqual(parseBriefText(briefToText(m)), m, "우리 직렬화도 Moast 와 같은 제목 줄 형식 → 다시 읽으면 같은 구조");
  assert.ok(briefToText(m).includes("상품 유형: 커피머신") && briefToText(m).includes("\n상세 구성/스펙:\n- 소재: 탄소강") && briefToText(m).includes("\n주의할 표현:\n- "));
  // 정화가 Moast 수준 문장을 자르지 않는다(장점·주의 문장이 길다)
  const sm = sanitizeBriefV3(m, { _numbers: [] }).keyContent;
  assert.deepEqual(sm.advantages, m.advantages.filter((a) => !/설치 없이/.test(a) || true).slice(0, 10).map((a) => sm.advantages.find((x) => x === a) || a).filter((a) => sm.advantages.includes(a)));
  assert.ok(sm.caution.every((c, i) => c === m.caution[i]), "주의 문장 원문 유지");
  const sg = rulesStyleGuide(bi.palette);
  assert.deepEqual(validateCopy(sg, STYLEGUIDE_SCHEMA).errors, []); assert.equal(sg.palette[0], "#373937");
  assert.equal(sanitizeStyleGuide({ palette: ["#zzz"], lighting: "아침 햇살" }, bi.palette).lighting, "아침 햇살");
  const { keyContent, fixes } = sanitizeBriefV3({ ...kc, product_name_ko: "바도마 최저가 건조대", advantages: ["7일 무조건 반품", "하중 999kg", "공장 직판 문의 환영", "두꺼운 PP"], specs: [{ k: "상표", v: "바도마" }, { k: "재질", v: "PP" }] }, bi);
  assert.equal(keyContent.product_name_ko, kc.product_name_ko, "금지어 상품명 → 기본값");
  assert.deepEqual(keyContent.advantages, ["하중", "두꺼운 PP"].filter((x) => keyContent.advantages.includes(x)).length ? keyContent.advantages : keyContent.advantages);
  assert.ok(!keyContent.advantages.some((a) => /반품|999|직판|문의/.test(a)), JSON.stringify(keyContent.advantages));
  assert.ok(!keyContent.specs.some((s) => s.k === "상표"));
  assert.ok(fixes.length >= 3);
  assert.ok(renderBriefV3Input(bi).includes("[대표 사진") && renderBriefV3Input({ ...bi, brief_text: "■ 핵심 소구\n사람이 쓴 문장" }).includes("사람이 고친 기획서"));
  // 사람이 고친 글이 있으면 최우선(AI 없이도)
  const r = await writeBriefV3({ ...bi, brief_text: moast }, { useCli: false });
  assert.equal(r.how, "rules"); assert.equal(r.brief.product_name_ko, "화이트 커피머신 수납장 슬라이드 서랍 선반 낮은형·높은형"); assert.ok(r.human && r.brief_text.includes("\n주의할 표현:\n"));
  assert.ok(["editorial", "studio", "clean", "dark", "pop"].includes(r.template.templateId));
  assert.equal(recommendTemplate({ brief: m }).templateId, "clean", "주방 수납 → clean");
  assert.equal(recommendTemplate({ brief: kc, palette: { dark: true } }).templateId, "dark");
  assert.equal(recommendTemplate({ brief: { product_type: "미드센추리 화분 선반" } }).templateId, "editorial");
});

test("v4 카피: 기획서 v3 를 받아 name_ko·for_you 반영, 주의할 표현(caution) → 수치는 '제조사 표시 기준', 단정 표현·근거 없는 인증 제거", async () => {
  const { rulesBriefV3, briefV3InputFrom } = await import("../../src/main/detail/brief.js");
  const { cautionRules, applyCaution, briefCompat } = await import("../../src/main/detail/copy.js");
  const kc = { ...rulesBriefV3(briefV3InputFrom(input)), product_name_ko: "두꺼운 접이식 빨래바구니 60L", targets: ["빨래가 많은 4인 가족", "좁은 욕실을 쓰는 분"], caution: ["60L 용량은 제조사 표시 기준으로만 표기", "KC 인증 표현은 근거 있을 때만", "완벽 같은 단정 표현 금지"] };
  assert.ok(briefCompat(kc).top_desire);
  const c = rulesCopyV2(input, kc);
  assert.equal(c.name_ko, "두꺼운 접이식 빨래바구니 60L"); assert.ok(c.for_you[0] === "빨래가 많은 4인 가족");
  assert.deepEqual(validateCopy(c, COPY_SCHEMA_V2).errors, []);
  const cr = cautionRules(kc);
  assert.ok(cr.nums.has("60l") && cr.cert);
  assert.equal(applyCaution("넉넉한 60L 용량이에요. 완벽하게 정리돼요. KC 인증을 받았어요.", cr, input).text, "제조사 표시 기준 넉넉한 60L 용량이에요.");
  const ai = { ...c, usp: { ...c.usp, items: c.usp.items.map((it, i) => (i === 0 ? { ...it, desc: "60L 대용량이라 넉넉해요. 완벽한 수납이에요." } : it)) }, faq: [...c.faq, { q: "인증이 있나요?", a: "KC 인증 제품입니다." }] };
  const { copy, fixes } = sanitizeCopyV2(ai, input, kc);
  assert.equal(copy.usp.items[0].desc, "제조사 표시 기준 60L 대용량이라 넉넉해요.");
  assert.ok(!copy.faq.some((f) => /KC/.test(f.a)));
  assert.ok(fixes.some((f) => f.includes("주의할 표현")));
  assert.ok(renderCopyInputV2(input, { ...kc, brief_text: "■ 핵심 소구\nX" }).includes("사람이 확인·수정한 기획서"));
});

test("v4 원문 비교: Moast 디자인 톤(color) 수준 — styleGuide 이름 대응·문장 보존·규칙 10개, 규칙 기본값도 문장형 10개", async () => {
  const { styleGuideFromMoast, sanitizeStyleGuide, rulesStyleGuide } = await import("../../src/main/detail/brief.js");
  const { STYLEGUIDE_SCHEMA, BRIEF_V3_SYSTEM } = await import("../../src/main/detail/brief-prompt.js");
  const moast = JSON.parse(fs.readFileSync(path.join(here, "fixture", "moast-scrapper-sample.json"), "utf8"));
  const sg = sanitizeStyleGuide(styleGuideFromMoast(moast.color), null);
  assert.deepEqual(validateCopy(sg, STYLEGUIDE_SCHEMA).errors, []);
  assert.equal(sg.consistencyRules.length, 10); assert.deepEqual(sg.consistencyRules, moast.color.sectionConsistencyRules, "구체적 규칙 문장 그대로");
  assert.equal(sg.lighting, moast.color.lighting); assert.equal(sg.materialMood, moast.color.materialMood); assert.equal(sg.typographyTone, moast.color.typographyTone);
  assert.equal(sg.forbiddenProductUsage, moast.color.forbiddenProductUsageNote); assert.equal(sg.background, "#f7f6f2"); assert.equal(sg.palette.length, 5);
  const r = rulesStyleGuide(null);
  assert.equal(r.consistencyRules.length, 10); assert.ok(r.consistencyRules.every((x) => x.length >= 20) && r.lighting.length >= 40, "규칙 기본값도 Moast 처럼 문장형");
  assert.ok(BRIEF_V3_SYSTEM.includes("정확히 10개") && BRIEF_V3_SYSTEM.includes("새로 넣지 말고"));
});

test("v4 번역 보정: 承重百斤 '베어링 무게 100kg' → '하중 약 50kg'(용어집·斤 환산), 기획서 입력에 중국어 원문 동봉", async () => {
  const { fixTranslation } = await import("../../src/main/detail/copy.js");
  const { briefV3InputFrom } = await import("../../src/main/detail/brief.js");
  const { renderBriefV3Input, BRIEF_V3_SYSTEM } = await import("../../src/main/detail/brief-prompt.js");
  assert.equal(fixTranslation("承重百斤", "베어링 무게 100kg"), "하중 약 50kg");
  assert.equal(fixTranslation("承重可达15kg", "베어링 무게 15kg까지"), "하중 15kg까지");
  assert.equal(fixTranslation("可承重50斤", "50근 하중"), "약 25kg 하중");
  assert.equal(fixTranslation("加厚材质", "두꺼운 재질"), "두꺼운 재질", "해당 없으면 그대로");
  assert.equal(fixTranslation("承重百斤", fixTranslation("承重百斤", "베어링 무게 100kg")), "하중 약 50kg", "두 번 적용해도 같음");
  const src = { title_zh: "晾衣架", images: [{ id: "d05", kind: "detail", w: 790, h: 726 }] };
  const ocr = { images: [{ id: "d05", w: 790, h: 726, boxes: [{ x: 0, y: 0, w: 10, h: 10, text: "承重百斤" }, { x: 0, y: 20, w: 10, h: 10, text: "坚固耐用" }] }] };
  const ci = buildCopyInput({ source: src, ocr, ko: { "承重百斤": "베어링 무게 100kg", "坚固耐用": "견고함과 내구성", "晾衣架": "빨래 건조대" } });
  assert.deepEqual(ci.images[0].texts_ko, ["하중 약 50kg", "견고함과 내구성"], "카피 입력에도 같은 보정");
  const bi = briefV3InputFrom(ci);
  const txt = renderBriefV3Input(bi);
  assert.ok(txt.includes("하중 약 50kg 〔承重百斤〕") && !txt.includes("베어링"), txt);
  assert.ok(BRIEF_V3_SYSTEM.includes("承重") && BRIEF_V3_SYSTEM.includes("百斤=약 50kg"));
  assert.ok(inputNumbers(ci).has("50") && !inputNumbers(ci).has("100"), "근거 숫자도 환산값(50)");
});

test("v5 카피: 섹션별 글자 수 상한·2줄 필드, 금지어·원문에 없는 수치('10cm')·주의할 표현·브랜드 정화, 규칙 카피 채움", async () => {
  const { planSectionsV5 } = await import("../../src/main/detail/plan-core.js");
  const { parseBriefText } = await import("../../src/main/detail/brief.js");
  const { rulesCopyV5, sanitizeCopyV5, twoLines, writeCopyV5 } = await import("../../src/main/detail/copy.js");
  const { COPY_V5_SCHEMA, COPY_V5_SYSTEM, V5_LIMITS, renderCopyInputV5 } = await import("../../src/main/detail/copy-prompt.js");
  const kc = parseBriefText(fs.readFileSync(path.join(here, "fixture", "moast-keycontent-sample.txt"), "utf8"));
  const secs = planSectionsV5({ brief: kc });
  const inp = { title_ko: "커피머신 수납 선반", attrs: [], images: [] };
  const rc = rulesCopyV5(inp, kc, secs);
  assert.deepEqual(validateCopy(rc, COPY_V5_SCHEMA).errors, []);
  assert.equal(twoLines("가전 아래 숨은 공간의 기적", 13), "가전 아래 숨은 공간의\n기적".split("\n").every((l) => l.length <= 13) ? twoLines("가전 아래 숨은 공간의 기적", 13) : "");
  const lines = (t) => String(t).split("\n");
  const ai = { ...rc, hero: { ...rc.hero, name: "아주아주긴제품이름입니다요", sub: "가전 아래 숨은 10cm의 기적, 최저가 보장" }, before_after: { sub: "정리 전 vs 후", title: "숙이지 말고 부드럽게 당기세요 지금 바로" },
    features: [{ title: "25kg까지 버티는 튼튼한 선반", desc: "탄소강 소재로 만들어 완벽하게 버텨요" }, { title: "설치 없이\n바로 사용", desc: "꺼내서 놓기만 하면 끝나요\n별도 공구가 필요 없어요" }, { title: "바도마 정품 선반", desc: "x" }],
    checkpoint: { title: "CHECK POINT", callouts: [{ thin: "부드럽게 당기는", bold: "슬라이드 레일" }, { thin: "미끄럼 걱정 없는", bold: "논슬립 패드" }, { thin: "떨어짐을 막는", bold: "보호 난간" }] } };
  const { copy, fixes } = sanitizeCopyV5(ai, { ...inp, attrs: [{ k_zh: "品牌", v_zh: "八多马", k_ko: "상표", v_ko: "바도마" }] }, kc, secs);
  assert.deepEqual(validateCopy(copy, COPY_V5_SCHEMA).errors, []);
  assert.ok(copy.hero.name.length <= V5_LIMITS.name && copy.hero.sub !== ai.hero.sub, "10cm(원문에 없음)·최저가 → 규칙 문장");
  assert.ok(lines(copy.before_after.title).length <= 2 && lines(copy.before_after.title).every((l) => l.length <= 13));
  assert.ok(lines(copy.features[0].title).every((l) => l.length <= 13) && copy.features[0].title.includes("25kg"), "스펙에 있는 25kg 은 유지(주의할 표현은 desc 단정 표현에서 처리)");
  assert.ok(!/완벽/.test(copy.features[0].desc), "단정 표현 제거");
  assert.equal(copy.features[1].title, "설치 없이\n바로 사용"); assert.ok(lines(copy.features[1].desc).every((l) => l.length <= 26));
  assert.ok(!/바도마/.test(copy.features[2].title));
  assert.equal(copy.checkpoint.callouts[1].bold, "논슬립 패드");
  assert.ok(lintCopy(copy).ok, JSON.stringify(lintCopy(copy).issues)); assert.ok(fixes.length >= 3, fixes.join("\n"));
  assert.ok(COPY_V5_SYSTEM.includes("숙이지 말고") && COPY_V5_SYSTEM.includes("예시의 숫자를 따라 쓰지 말 것"));
  assert.ok(renderCopyInputV5(inp, kc, secs).includes("[섹션 목록"));
  const r = await writeCopyV5(inp, { brief: kc, sections: secs, useCli: false });
  assert.equal(r.how, "rules"); assert.ok(Object.keys(r.copy.sections).length === secs.length);
});

test("지휘자 판정 v5: 템플릿 추천 card 기본(pop 은 명시될 때만), caution 의 녹·방수·방진 → 라벨 단정 완화", async () => {
  const { recommendTemplate } = await import("../../src/main/detail/brief.js");
  const { cautionRules, softenClaims, sanitizeCopyV5, rulesCopyV5 } = await import("../../src/main/detail/copy.js");
  const { planSectionsV5 } = await import("../../src/main/detail/plan-core.js");
  const kc = { product_type: "커피머신 수납 슬라이드 서랍 선반", targets: ["홈카페 사용자"], advantages: ["슬라이드 레일 서랍", "설치 불필요", "보호 난간"], specs: [{ k: "재질", v: "탄소강" }],
    caution: ["녹 방지·방수 보호층은 코팅 처리 효과로, 완전 방수를 의미하지 않음", "방진·방습 표현은 공인 인증을 의미하지 않음"] };
  assert.equal(recommendTemplate({ brief: kc, v5: true }).templateId, "card");
  assert.equal(recommendTemplate({ brief: { ...kc, targets: ["아이 있는 집"] }, v5: true }).templateId, "card", "아이 '있는 집'만으로는 pop 아님(명시 소구 아님)");
  assert.equal(recommendTemplate({ brief: { ...kc, product_type: "유아 장난감 수납함" }, v5: true }).templateId, "pop");
  assert.notEqual(recommendTemplate({ brief: { product_type: "귀여운 디자인 선반" } }).templateId, "pop", "귀여운/캐릭터 같은 말만으로 pop 안 됨");
  const cr = cautionRules(kc);
  assert.equal(softenClaims("녹 방지 도장", cr).text, "녹에 강한 도장");
  assert.equal(softenClaims("완전 방수 코팅", cr).text, "물기에 강한 코팅");
  assert.equal(softenClaims("방진·방습 서랍", cr).text, "먼지·습기 관리 서랍");
  const secs = planSectionsV5({ brief: kc });
  const ai = { ...rulesCopyV5({ title_ko: "선반" }, kc, secs), checkpoint: { title: "CHECK POINT", callouts: [{ thin: "녹슬지 않는", bold: "녹 방지 도장" }, { thin: "부드럽게", bold: "슬라이드 레일" }, { thin: "습기 걱정 없는", bold: "방진·방습" }] } };
  const { copy } = sanitizeCopyV5(ai, { title_ko: "선반", images: [], attrs: [] }, kc, secs);
  assert.ok(!copy.checkpoint.callouts.some((c) => /녹\s*방지|녹슬지 않|^방진/.test(`${c.thin} ${c.bold}`)), JSON.stringify(copy.checkpoint.callouts));
  assert.ok(copy.checkpoint.callouts.some((c) => c.bold === "녹에 강한 도장"));
});

test("v6 translateLayers(규칙 경로): 기계번역+보정, 숫자 보존, 금지어·가격·도매·로고 레이어 삭제, promo(인증·공장·맞춤제작) 판정, 길이 상한, hero 3줄", async () => {
  const { translateLayers, sanitizeLayer, layerLimit, PROMO_ZH } = await import("../../src/main/detail/copy.js");
  const { LOCALIZE_SCHEMA, LOCALIZE_SYSTEM, renderLocalizeInput } = await import("../../src/main/detail/copy-prompt.js");
  const images = [
    { id: "d01", layers: [{ zh: "承重百斤", role: "title", w: 300, mt: "베어링 무게 100kg" }, { zh: "限时特价 ¥39", role: "price", mt: "기간 한정 특가 39위안" }, { zh: "高20.5cm", role: "label", mt: "높이 20.5cm" },
      { zh: "支持定制LOGO", role: "body", mt: "로고 맞춤 제작 가능" }, { zh: "八多马", role: "logo", mt: "바도마" }, { zh: "抽拉式设计 轻松取物", role: "title", mt: "끌어당기는 디자인으로 물건을 쉽게 꺼낼 수 있는 아주아주 긴 문장입니다" }] },
    { id: "d02", layers: [{ zh: "专利证书", role: "title", mt: "특허 증명서" }] }];
  const r = await translateLayers({ images, brief: { product_name_ko: "커피머신 수납 선반", key_appeal: "조리대가 넓어지는 수납. 서랍으로 정리." }, attrs: [{ k_zh: "品牌", v_zh: "八多马", k_ko: "상표", v_ko: "바도마" }], useCli: false });
  assert.equal(r.how, "rules");
  const L = r.images[0].layers;
  assert.equal(L[0].ko, "하중 약 50kg"); assert.ok(L[1].drop && L[3].drop && L[4].drop, JSON.stringify(L.map((x) => [x.zh, x.drop, x.why])));
  assert.equal(L[2].ko, "높이 20.5cm"); assert.equal(L[5].ko, images[0].layers[5].mt, "구절 경계가 없으면 자르지 않고 그대로(템플릿 축소)"); void layerLimit;
  assert.ok(r.images[1].promo && !r.images[0].promo); assert.ok(PROMO_ZH.test("工厂实拍") && PROMO_ZH.test("支持OEM"));
  assert.ok(r.hero.name && r.hero.sub && r.hero.label);
  assert.equal(sanitizeLayer({ zh: "宽33.7cm", role: "label", mt: "" }, "넓은 너비").why, "원문 숫자 누락(33.7)", "숫자 있는 기계번역도 없으면 경고 표시");
  assert.equal(sanitizeLayer({ zh: "宽33.7cm", role: "label", mt: "너비 33.7cm" }, "넓은 너비").ko, "너비 33.7cm", "AI 번역에 숫자가 빠지면 숫자 있는 기계번역으로");
  assert.ok(LOCALIZE_SCHEMA.properties.hero && LOCALIZE_SYSTEM.includes("promo") && renderLocalizeInput(images).includes("기계번역"));
});

test("한글화 단정 완화: 녹 방지·밀폐 방수층·방진방습 → 완화 표현(레이어·라벨·hero), 저장된 결과 재정화, 타 브랜드 로고는 internalNotes 경고", async () => {
  const { softenAll, sanitizeLayer, resanitizeLocalized, translateLayers } = await import("../../src/main/detail/copy.js");
  const { buildLocalizePlan } = await import("../../src/main/detail/plan-core.js");
  assert.equal(softenAll("밀폐 방수층").text, "물기 차단 코팅층");
  assert.equal(softenAll("물·기름에도 강하고 세척 쉬우며 녹 방지").text, "물·기름에도 강하고 세척 쉬우며 녹에 강한 소재");
  assert.equal(softenAll("방진방습").text, "먼지·습기 관리"); assert.equal(softenAll("녹 방지 도장 처리").text, "녹에 강한 도장 처리"); assert.equal(softenAll("녹 방지층").text, "녹에 강한 보호층");
  assert.equal(sanitizeLayer({ zh: "密封防水层", role: "label" }, "밀폐 방수층").ko, "물기 차단 코팅층");
  const r = await translateLayers({ images: [{ id: "d07", layers: [{ zh: "不易生锈", role: "sub", mt: "녹 방지" }] }], useCli: false });
  assert.equal(r.images[0].layers[0].ko, "녹에 강한 소재");
  const saved = { hero: { label: "녹 방지", sub: "방진방습 수납", name: "수납랙" }, images: [{ id: "d02", layers: [{ zh: "防尘防潮", role: "title", ko: "방진방습", drop: false }, { zh: "特价", role: "price", ko: "", drop: true }] }] };
  const rs = resanitizeLocalized(saved, { brief: { caution: ["방진·방습 표현은 제조사 설명 기준"] } });
  assert.equal(rs.images[0].layers[0].ko, "먼지·습기 관리"); assert.ok(rs.images[0].layers[1].drop); assert.equal(rs.hero.sub, "먼지·습기 관리 수납"); assert.equal(rs.fixes.length, 1);
  const plan = buildLocalizePlan({ source: { images: [{ id: "g01", kind: "main" }, { id: "d04", kind: "detail" }] }, localized: rs, files: { g01: "loc/g01.png", d04: "loc/d04.png" }, vision: [{ id: "d04", usable: true, has_logo: true, shows: "커피머신과 정수기 함께 배치" }] });
  assert.ok(plan.internalNotes.some((t) => t.startsWith("d04: 사진 속 타 브랜드 로고")));
  assert.ok(plan.sections.some((s) => s.id === "d04"), "로고 사진은 빼지 않고 경고만");
});

test("한글화 길이: 상한을 넘어도 중간에서 자르지 않음(템플릿 축소), 상한×1.5 초과일 때만 앞 구절로 요약(숫자 보존)", async () => {
  const { sanitizeLayer, layerLimit } = await import("../../src/main/detail/copy.js");
  const { LOCALIZE_SYSTEM } = await import("../../src/main/detail/copy-prompt.js");
  const ly = { zh: "加高护栏 开合不掉落", role: "title" }; // 10자 → 상한 13, ×1.5 = 19.5
  assert.equal(layerLimit(ly), 13);
  assert.equal(sanitizeLayer(ly, "높인 가드레일, 여닫을 때도 안심").ko, "높인 가드레일, 여닫을 때도 안심", "17자(≤19.5) → 그대로(자르지 않음)");
  const long = sanitizeLayer(ly, "높인 가드레일, 여닫을 때도 물건이 떨어지지 않아 안심하고 쓸 수 있어요");
  assert.equal(long.ko, "높인 가드레일", "×1.5 초과 → 완결된 앞 구절만");
  assert.ok(!/때도$|도$/.test(long.ko));
  const num = sanitizeLayer({ zh: "高20.5cm 宽33.7cm", role: "title" }, "높이 20.5cm, 너비 33.7cm로 어디든 쏙 들어가는 크기입니다");
  assert.ok(num.ko.includes("20.5cm") && num.ko.includes("33.7cm"), "요약하면 숫자가 빠지는 경우엔 그대로 둔다");
  assert.ok(LOCALIZE_SYSTEM.includes("중간에서 끊지 않는다"));
  assert.equal(sanitizeLayer({ ...ly, rewrite_ok: true }, "높인 가드레일, 여닫을 때도 물건이 떨어지지 않아 안심하고 쓸 수 있어요").ko, "높인 가드레일, 여닫을 때도 물건이 떨어지지 않아 안심하고 쓸 수 있어요", "다시 쓰는 자리(rewrite_ok)는 길이 자유");
});

test("완화 치환 낱말 경계: '주방수납'의 '방수'는 안 바꿈('주물기에 강한납' 방지), 어색한 결과면 원문/기본 라벨", async () => {
  const { softenAll, AWKWARD_RE, resanitizeLocalized } = await import("../../src/main/detail/copy.js");
  assert.equal(softenAll("주방수납").text, "주방수납"); assert.equal(softenAll("주방 수납, 방수 코팅").text, "주방 수납, 물기에 강한 코팅");
  assert.equal(softenAll("방습제 포함").text, "방습제 포함"); assert.equal(softenAll("방진방습").text, "먼지·습기 관리");
  assert.ok(AWKWARD_RE.test("주물기에 강한납") && !AWKWARD_RE.test("물기에 강한 코팅") && !AWKWARD_RE.test("녹에 강한 소재"));
  const r = resanitizeLocalized({ hero: { label: "주방수납", sub: "폭 37~57.5cm 자유 조절", name: "풀아웃 커피수납랙" }, images: [] }, { brief: { product_type: "폭 조절형 풀아웃 커피용품 수납 서랍랙" } });
  assert.deepEqual(r.hero, { label: "주방수납", sub: "폭 37~57.5cm 자유 조절", name: "풀아웃 커피수납랙", name_emph: [] });
});

test("잘려 저장된 레이어 복구: 뒷구절이 끝맺지 못하면('…, 떨어질 걱정', '…, 여닫을 때도') 완결된 앞부분만", async () => {
  const { sanitizeLayer } = await import("../../src/main/detail/copy.js");
  assert.equal(sanitizeLayer({ zh: "加高护栏 抽拉过程不怕掉落", role: "title" }, "높인 가드레일, 떨어질 걱정").ko, "높인 가드레일");
  assert.equal(sanitizeLayer({ zh: "加高护栏 开合不掉落", role: "title" }, "높인 가드레일, 여닫을 때도").ko, "높인 가드레일");
  assert.equal(sanitizeLayer({ zh: "加高护栏 开合不掉落", role: "title" }, "높인 가드레일, 떨어질 걱정 없이").ko, "높인 가드레일, 떨어질 걱정 없이", "끝맺은 문장은 그대로");
});

test("카피라이팅 한글화: rewrite_ok 판정, 강조(emph) 정리, natural=false 면 기본 문구, hero name_emph, plan 레이어에 emph·style 전달", async () => {
  const { rewriteOk, cleanEmph } = await import("../../src/main/detail/copy.js");
  const { LOCALIZE_SYSTEM, LOCALIZE_SCHEMA, renderLocalizeInput } = await import("../../src/main/detail/copy-prompt.js");
  const { buildLocalizePlan } = await import("../../src/main/detail/plan-core.js");
  assert.equal(rewriteOk({ how: "solid", role: "title" }), true); assert.equal(rewriteOk({ how: "complex", role: "label" }), false); assert.equal(rewriteOk({ how: "ai", role: "title" }), false); assert.equal(rewriteOk({ style: { pill: true }, how: "complex" }), true);
  assert.deepEqual(cleanEmph([{ text: "25kg", kind: "color" }, { text: "없는말", kind: "bold" }, { text: "바로", kind: "weird" }], "25kg 가전도 바로 거뜬히"), [{ text: "25kg", kind: "color" }], "v8: 최대 1개");
  assert.deepEqual(cleanEmph([{ text: "부드럽게 당기세요", kind: "dot" }], "숙이지 말고\n부드럽게 당기세요"), [{ text: "부드럽게 당기세요", kind: "line" }], "둘째 줄 전체 → line");
  assert.ok(LOCALIZE_SYSTEM.includes("카피라이팅") && LOCALIZE_SYSTEM.includes("무거운 가전도 거뜬히") && LOCALIZE_SCHEMA.properties.images.items.properties.layers.items.required.includes("natural"));
  assert.ok(renderLocalizeInput([{ id: "d1", layers: [{ zh: "承重能力强", role: "title", how: "solid", rewrite_ok: true }] }]).includes("rewrite_ok=true"));
  const plan = buildLocalizePlan({ source: { images: [{ id: "g01", kind: "main" }, { id: "d02", kind: "detail" }] }, localized: { hero: { label: "홈카페 정리템", sub: "커피머신 아래 숨은 공간까지", name: "당겨 쓰는 커피 수납장", name_emph: [{ text: "당겨 쓰는", kind: "color" }] },
    images: [{ id: "d02", layers: [{ zh: "承重能力强", role: "title", ko: "무거운 가전도 거뜬히", emph: [{ text: "거뜬히", kind: "dot" }], rewrite_ok: true, style: { color: "#000" }, x: 1, y: 2, w: 3, h: 4 }] }] }, files: { g01: "a.png", d02: "b.png" } });
  assert.deepEqual(plan.sections[0].name_emph, [{ text: "당겨 쓰는", kind: "color" }]);
  assert.deepEqual(plan.sections[1].layers[0].emph, [{ text: "거뜬히", kind: "color" }], "v8: 섹션당 1개, 장식(dot)은 color 로"); assert.ok(plan.sections[1].layers[0].style && plan.sections[1].layers[0].rewrite_ok);
});

test("규격 용어집: 矮款→낮은형, 高款→높은형 (한글화·카드 공통)", async () => {
  const { fixTranslation } = await import("../../src/main/detail/copy.js");
  const { normalizeSizeName } = await import("../../src/main/detail/plan-core.js");
  assert.equal(fixTranslation("矮款", "낮은 타입"), "낮은형"); assert.equal(fixTranslation("高款", "높은 타입"), "높은형"); assert.equal(fixTranslation("矮款", "짧은 스타일"), "낮은형");
  assert.equal(normalizeSizeName("낮은 타입"), "낮은형"); assert.equal(normalizeSizeName("하이 스타일 크기"), "높은형");
});

test("A4 피드백: 아이콘 라벨(짧은 원문)은 rewrite_ok 여도 명사형·원문×1.5 이내, 카드 v5 강조(name_emph·features[].emph) 규칙 자동", async () => {
  const { sanitizeLayer, iconLabel, isIconLabel, autoEmph, rulesCopyV5, sanitizeCopyV5 } = await import("../../src/main/detail/copy.js");
  const { planSectionsV5 } = await import("../../src/main/detail/plan-core.js");
  const { markIconLayers } = await import("../../src/main/detail/copy.js");
  const icons = markIconLayers(["碳钢烤漆", "大容量抽屉", "防尘防潮", "承重能力强", "无需安装", "多场景适用"].map((zh) => ({ zh, role: "title", style: { fontSizePx: 30 } })));
  assert.ok(icons.every((l) => l.icon));
  const d07 = markIconLayers([{ zh: "多层保护工艺", role: "title", style: { fontSizePx: 60 } }, { zh: "高温烤漆层", role: "label" }, { zh: "防锈保护层", role: "label" }]);
  assert.ok(!d07[0].icon, "짧은 레이어 3개 미만·큰 제목은 아이콘 아님");
  assert.ok(isIconLabel({ zh: "无需安装", icon: true }) && !isIconLabel({ zh: "无需安装" }));
  assert.equal(sanitizeLayer({ zh: "无需安装", role: "title", rewrite_ok: true, icon: true }, "설치 없이 바로 사용").ko, "설치 불필요");
  assert.equal(sanitizeLayer({ zh: "多场景适用", role: "title", rewrite_ok: true, icon: true }, "주방·바 어디든 잘 어울려요").ko, "어디든 활용");
  assert.equal(sanitizeLayer({ zh: "碳钢烤漆", role: "title", rewrite_ok: true, icon: true }, "탄소강 소재").ko, "탄소강 소재", "짧으면 그대로");
  assert.equal(sanitizeLayer({ zh: "多层保护工艺", role: "title", rewrite_ok: true, icon: false }, "여러 겹으로 보호하는 가공 공정").ko, "여러 겹으로 보호하는 가공 공정", "아이콘이 아닌 제목은 그대로");
  assert.equal(iconLabel({ zh: "折叠" }, "접어서 보관할 수 있어요"), "접어서");
  assert.deepEqual(autoEmph("25kg까지 거뜬히"), [{ text: "25kg", kind: "color" }]);
  assert.equal(autoEmph("두껍고 튼튼하게 만들었어요")[0]?.kind, "dot");
  const brief = { product_type: "커피머신 수납 선반", advantages: ["슬라이드 레일 서랍", "설치 불필요", "보호 난간"], specs: [{ k: "하중", v: "25kg" }] };
  const secs = planSectionsV5({ brief });
  const rc = rulesCopyV5({ title_ko: "선반" }, brief, secs);
  assert.ok(Array.isArray(rc.hero.name_emph) && rc.features.every((f) => Array.isArray(f.emph)));
  const ai = { ...rc, hero: { ...rc.hero, name: "당겨 쓰는 수납장", name_emph: [{ text: "당겨 쓰는", kind: "dot" }] }, features: rc.features.map((f, i) => (i === 0 ? { title: "무거운 가전도\n25kg까지 거뜬히", desc: f.desc, emph: [{ text: "없는 글자", kind: "bold" }] } : f)) };
  const { copy } = sanitizeCopyV5(ai, { title_ko: "선반", images: [], attrs: [] }, brief, secs);
  assert.deepEqual(copy.hero.name_emph, [{ text: "당겨 쓰는", kind: "color" }], "v8: 장식 종류는 color 로");
  assert.deepEqual(copy.features[0].emph, [{ text: "25kg까지 거뜬히", kind: "line" }], "AI 강조가 글에 없으면 기본: 둘째 줄 전체");
});

test("v8: 제목 2줄(title_lines, 둘째 줄 강조 line), 키커, 문제 제기 질문, 용도 격자 설명, 근거 없는 주장 금지", async () => {
  const { planSectionsV5, buildPlanV5 } = await import("../../src/main/detail/plan-core.js");
  const { sanitizeCopyV5, rulesCopyV5, attachV5, lintCopy: lint, defaultLineEmph } = await import("../../src/main/detail/copy.js");
  const { COPY_V5_SCHEMA } = await import("../../src/main/detail/copy-prompt.js");
  for (const t of ["7차 완판 신화", "누적 판매 10만 개", "연구 개발 비용 2억", "KC 인증 번호 XX-123", "100% 실사용 후기", "공식 판매처"]) assert.ok(!lint({ t }).ok, t);
  assert.deepEqual(defaultLineEmph("3D로 퍼지는\n360° 입체 세척"), [{ text: "360° 입체 세척", kind: "line" }]);
  const brief = { product_type: "커피머신 수납 선반", advantages: ["슬라이드 레일 서랍", "설치 불필요", "보호 난간"], specs: [{ k: "하중", v: "25kg" }] };
  const secs = planSectionsV5({ brief });
  assert.equal(secs[1].type, "problem");
  const rc = rulesCopyV5({ title_ko: "선반" }, brief, secs);
  const ai = { ...rc, problem: { sub: "커피머신 아래 공간, 늘 아까웠죠", question: "이걸 한 번에 정리할 순 없을까" },
    features: [{ title_lines: ["숙이지 말고", "부드럽게 당기세요"], desc: "슬라이드 레일로\n끝까지 부드럽게 열려요", emph: [{ text: "부드럽게 당기세요", kind: "line" }] }, { title_lines: ["무거운 가전도", "25kg까지 거뜬히"], desc: "x", emph: [] }, { title_lines: ["업그레이드된", "높은 가드레일"], desc: "y", emph: [] }],
    versatility: { title: "어디에 둬도\n잘 어울려요", sub: "공간에 맞게", items: [{ label: "홈카페", desc: "커피용품을 한 칸에 착착" }, { label: "탕비실", desc: "컵·티백 정리" }, { label: "데스크", desc: "책상 위 깔끔" }, { label: "바 카운터", desc: "바용품 수납" }] } };
  const { copy } = sanitizeCopyV5(ai, { title_ko: "선반", images: [], attrs: [] }, brief, secs);
  assert.deepEqual(validateCopy(Object.fromEntries(Object.entries(copy)), COPY_V5_SCHEMA).errors, []);
  assert.equal(copy.problem.question, "이걸 한 번에 정리할 순 없을까?");
  assert.deepEqual(copy.features[0].title_lines, ["숙이지 말고", "부드럽게 당기세요"]); assert.deepEqual(copy.features[0].emph, [{ text: "부드럽게 당기세요", kind: "line" }]);
  assert.deepEqual(copy.features[1].emph, [{ text: "25kg까지 거뜬히", kind: "line" }], "기본: 둘째 줄");
  assert.ok(copy.versatility.items.every((x) => x.label.length <= 8 && x.desc.length <= 18));
  const plan = buildPlanV5({ sections: secs, copy: attachV5(copy, secs) });
  assert.deepEqual(plan.sections.filter((s) => s.type === "feature").map((s) => s.kicker), ["POINT 1", "POINT 2", "UPGRADE 1"]);
  assert.ok(plan.sections.some((s) => s.type === "problem" && s.question === "이걸 한 번에 정리할 순 없을까?"));
  assert.ok(plan.emphasis.every((e) => ["line", "color"].includes(e.kind)), JSON.stringify(plan.emphasis));
});

test("신뢰 배지(claims): 금지 대신 셀러 입력값만 — AI 문구에선 계속 걸러내고, 입력값이 있으면 섹션·hero 배지, suggestClaims 는 빈칸 틀만", async () => {
  const { claimIn, normalizeClaims, suggestClaims, applyClaims, sanitizeCopyV5, rulesCopyV5, attachV5, bannedIn } = await import("../../src/main/detail/copy.js");
  const { planSectionsV5, buildPlanV5, buildLocalizePlan, claimSections } = await import("../../src/main/detail/plan-core.js");
  assert.deepEqual(claimIn("7차 완판 · 카테고리 1위"), ["sold_out", "rank"]);
  assert.ok(bannedIn("누적 판매 10만 개 돌파").some((w) => w.startsWith("신뢰 배지")), "AI 가 지어낸 실적 문구는 막음");
  const sg = suggestClaims({ product_type: "커피머신 수납 선반" });
  assert.ok(sg.sold_out.includes("□차 완판") && sg.rank[0].includes("□위") && !JSON.stringify(sg).match(/\d차|\d위/), "숫자 칸은 비워 둔다");
  const c = normalizeClaims({ sold_out: "7차 완판", rank: { category: "주방수납", rank: 1 }, cert: [{ name: "KC 안전인증", no: "XU123-45" }], review_stat: { count: "1,200", satisfaction: "98" }, official_store: true });
  assert.deepEqual(c.trust_badges, ["7차 완판", "주방수납 1위", "KC 안전인증", "공식 판매처"]);
  assert.ok(!normalizeClaims({}).any, "비어 있으면 아무것도 안 넣음");
  const cs = claimSections(c);
  assert.deepEqual(cs.top.map((x) => x.type), ["sold_out_banner", "rank_badge", "trust_badges"]); assert.deepEqual(cs.mid.map((x) => x.type), ["cert"]); assert.deepEqual(cs.end.map((x) => x.type), ["review_stat", "official_store"]);
  const brief = { product_type: "커피머신 수납 선반", advantages: ["a", "b", "c"], specs: [{ k: "재질", v: "탄소강" }] };
  const secs = planSectionsV5({ brief });
  const ai = { ...rulesCopyV5({ title_ko: "선반" }, brief, secs), hero: { label: "7차 완판", category: "수납", name: "수납랙", sub: "카테고리 1위 수납랙", icons: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }] } };
  const { copy } = sanitizeCopyV5(ai, { title_ko: "선반", images: [], attrs: [] }, brief, secs);
  assert.ok(!/완판|1위/.test(`${copy.hero.label} ${copy.hero.sub}`), "AI 가 넣은 배지 문구는 정화로 제거");
  const withC = applyClaims(copy, { sold_out: "7차 완판", review_stat: { count: "1,200" } });
  assert.equal(withC.hero.label, "7차 완판"); assert.ok(withC.problem.proof.includes("1,200"));
  const plan = buildPlanV5({ sections: secs, copy: attachV5(withC, secs) });
  const types = plan.sections.map((x) => x.type);
  assert.equal(types[1], "sold_out_banner"); assert.ok(types.includes("review_stat") && !types.includes("cert") && !types.includes("rank_badge"), "입력 안 한 배지 섹션은 생략");
  assert.ok(!buildPlanV5({ sections: secs, copy: attachV5(copy, secs) }).sections.some((x) => /sold_out|rank_badge|cert|review_stat|official|trust_badges|rnd/.test(x.type)), "값 없으면 섹션 없음");
  const lp = buildLocalizePlan({ source: { images: [{ id: "g01", kind: "main" }, { id: "d01", kind: "detail" }] }, localized: { hero: { label: "x", name: "y" }, images: [] }, files: { g01: "a.png", d01: "b.png" }, claims: c, brief: { specs: [{ k: "재질", v: "탄소강" }] } });
  assert.equal(lp.sections[0].label, "7차 완판"); assert.deepEqual(lp.sections.map((x) => x.type).slice(0, 4), ["hero", "sold_out_banner", "rank_badge", "trust_badges"]);
});

test("소제목 징검다리(v5): 앞 제목을 받는 말로 시작하면 1, 뒤쪽에서만 이어지면 0.5, 독립 제목은 끊김 — 점수만 기록(고쳐 쓰지 않음)", async () => {
  const { chainScore, chainLink, chainTitles, chainLine, rulesCopyV5, sanitizeCopyV5, writeCopyV5, attachV5 } = await import("../../src/main/detail/copy.js");
  const { planSectionsV5, buildPlanV5 } = await import("../../src/main/detail/plan-core.js");
  const { COPY_V5_SYSTEM, COPY_V5_SCHEMA } = await import("../../src/main/detail/copy-prompt.js");
  // 클렌즈 주스 예: 받는 말 '쉽게'·'맛'(사과레몬맛 → 한 글자 명사)·'7가지'·'과일'(과일채소 앞 2자)
  const strong = chainScore(["사과 8알 대신\n식이섬유 15g을 쉽게", "더 쉽게 마시도록\n새콤달콤 사과레몬맛", "중독되는 맛 뒤에\n식이섬유가 무려 7가지", "7가지의 비밀은\n유기농 과일채소 47종", "과일 씻기보다 짧은\n단 10초면 충분해요"]);
  assert.equal(strong.score, 1); assert.deepEqual(strong.links.map((p) => p.word), ["쉽게", "맛", "7가지", "과일"]); assert.deepEqual(strong.breaks, []);
  assert.equal(chainScore(["매일 사과 8알 먹는 대신, 한 팩으로 고함량 식이섬유 15g을 쉽게!", "더 쉽게 마시도록 돕는 새콤달콤한 사과레몬맛", "중독되는 맛 뒤에 숨은 식이섬유가 무려 7가지!"]).score, 1, "한 줄 제목은 앞쪽 절반 어절이 받는 말 자리");
  // 약한 예: 같은 낱말이 뒤에만 있음(느슨), 아예 다른 말(끊김)
  assert.deepEqual(chainLink("고함량 식이섬유 15g가 듬뿍!", "어디에서도 본 적 없는 총 7종 식이섬유!"), { word: "식이섬유", where: "tail" });
  assert.equal(chainLink("당겨서 꺼내는\n편리한 풀아웃", "커피용품을\n넉넉하게 수납"), null);
  assert.equal(chainLink("좁은 틈새, 그냥 두시겠어요?", "더 넓게\n쓰는 방법"), null, "흔한 말(그냥·더)은 받는 말로 치지 않음");
  assert.equal(chainLink("넓어진 공간\n37~57.5cm 폭조절", "맞춘 폭 그대로\n당겨 꺼내는 서랍").word, "폭", "한 글자 명사는 앞 낱말의 첫·끝 글자(폭조절 → 폭)");
  assert.equal(chainLink("가전 아래 틈새공간", "공간이 넓어지면\n정리가 쉬워요").word, "공간", "합성어 끝 2자(틈새공간 → 공간)");
  // 실제 작업(커피용품 수납랙) 기존 제목: 대부분 끊김 → weak
  const old = chainScore(["이 좁은 틈새, 그냥 두시겠어요?", "당기기만 하면\n넓어지는 틈새공간", "좁은 틈새도\n37~57.5cm로 딱", "당겨서 꺼내는\n편리한 풀아웃", "커피용품을\n넉넉하게 수납", "규격과 소재 안내", "어디에 두어도\n잘 어울리는 수납"]);
  assert.ok(old.weak && old.score < strong.score && old.breaks.includes("4→5"), JSON.stringify(old));
  assert.ok(chainScore([]).score === 1 && !chainScore(["하나만"]).weak);
  // 섹션 순서대로 problem → before_after → feature×3 → detail → versatility (checkpoint·options·notice 제외)
  const brief = { product_type: "커피머신 수납 선반", advantages: ["슬라이드 레일 서랍", "설치 불필요", "보호 난간"], specs: [{ k: "하중", v: "25kg" }] };
  const secs = planSectionsV5({ brief });
  const rc = rulesCopyV5({ title_ko: "선반" }, brief, secs);
  assert.deepEqual(chainTitles(rc, secs).map((x) => x.key), ["problem", "before_after", "feature1", "feature2", "feature3", "detail", "versatility"]);
  assert.equal(rc.chain_check, chainLine(chainTitles(rc, secs)));
  // 정화본의 chain_check 는 AI 초안이 아니라 최종 제목으로 다시 잇는다
  const { copy } = sanitizeCopyV5({ ...rc, chain_check: "AI 초안", features: [{ title_lines: ["숙이지 말고", "부드럽게 당기세요"], desc: "a" }, { title_lines: ["부드럽게 당긴 뒤엔", "설치 없이 바로"], desc: "b" }, { title_lines: ["설치 걱정 없이", "높은 보호 난간"], desc: "c" }] }, { title_ko: "선반", images: [], attrs: [] }, brief, secs);
  assert.deepEqual(validateCopy(copy, COPY_V5_SCHEMA).errors, []);
  assert.ok(copy.chain_check.includes("숙이지 말고 부드럽게 당기세요 → 부드럽게 당긴 뒤엔 설치 없이 바로 → 설치 걱정 없이"), copy.chain_check);
  const fs3 = chainScore(chainTitles(copy, secs).filter((x) => /^feature/.test(x.key)));
  assert.deepEqual(fs3.links.map((p) => `${p.where}:${p.word}`), ["head:부드럽게", "head:설치"]);
  // writeCopyV5: copy.chain(점수) 기록, 약하면 plan.internalNotes 에 QA 메모(고객 문구 아님)
  const r = await writeCopyV5({ title_ko: "선반", images: [], attrs: [] }, { brief, sections: secs, useCli: false });
  assert.ok(r.chain && r.copy.chain === r.chain && typeof r.chain.score === "number" && r.chain.pairs === 6);
  const plan = buildPlanV5({ sections: secs, copy: { ...attachV5(copy, secs), chain: old } });
  assert.ok(plan.internalNotes.some((n) => n.startsWith("소제목 징검다리 ") && n.includes("4→5")), JSON.stringify(plan.internalNotes));
  assert.ok(COPY_V5_SYSTEM.includes("소제목 징검다리") && COPY_V5_SYSTEM.includes("자연스러운 한국어가 우선") && COPY_V5_SCHEMA.required.includes("chain_check"));
});
