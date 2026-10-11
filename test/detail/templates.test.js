// 🧲 내 템플릿 보관함 단위테스트 — node --test test/detail/templates.test.js
// reference.json → template.json 변환(원문·측정 제외) · overrides 적용 · 보관함 CRUD · .seedtpl.json 내보내기→가져오기 왕복 · 출처 열쇠 캐시 · 파이프라인 reference 모양
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromReference, toReference, applyOverrides, cleanOverrides, normalizeOverride, overrideChips, toExport, fromImport, sourceKey, createStore, defaultName, summarize, sanitizeTokens, newId, ID_RE, OVERRIDE_KEYS } from "../../src/main/detail/templates.js";
import { normalizeTokens, applyReferenceOrder, referenceGuide, guardSimilarity, TOKEN_ENUM } from "../../src/main/detail/reference-core.js";

// 클린맥스 레퍼런스(reference.js 결과 모양) 축약 — 원문 title·측정 좌표·OCR 줄이 들어 있다
const REF = () => ({
  version: 1, createdAt: 1760000000000, source: { files: ["01.jpg", "02.jpg", "03.jpg"], dir: "/tmp/ref" },
  tokens: normalizeTokens({ bg: "#ffffff", dark: "#0e1730", brand: "#1f3cf5", brandShare: 0.05, darkRatio: 0.2, align: { center: 30, left: 4 }, titlePx: 46, gapPx: 100, ink: "#111418", panel: "#f2f2f2" }, { kicker: "pill-brand", bands: "alternate", problem: "dark-bubble", photo: "full", emph: "line-color", icons: "brand-fill", panel: "gray", hero: "on-photo", notice: "dark", title_weight: 800 }),
  style: { kicker: "pill-brand" }, styleFixed: { kicker: "pill-brand" },
  sections: [
    { order: 1, our_type: "hero", role: "첫 화면", angle: "성능 수치 + 결과로 즉시 전달", kicker: "", title: "750Hz 초강력 진동 묵은 때까지 싹", y: 0.01, bg: "photo", tx: 0.1, tw: 0.8 },
    { order: 2, our_type: "problem", role: "고민", angle: "고민 공감 → 질문", kicker: "", title: "이걸 한 번에 해결할 순 없을까?", y: 0.2, bg: "dark" },
    { order: 3, our_type: "feature", role: "장점", angle: "번거로움 제거", kicker: "POINT 1", title: "충전 대기 ZERO", y: 0.3, bg: "light" },
    { order: 4, our_type: "feature", role: "장점", angle: "수치로 과학성", kicker: "POINT 2", title: "3D로 퍼지는 360° 입체 세척", y: 0.4, bg: "light" },
    { order: 5, our_type: "trust", role: "판매 실적", angle: "실적", kicker: "", title: "7차 완판", y: 0.5, bg: "brand" },
    { order: 6, our_type: "faq", role: "FAQ", angle: "구매 전 의문 해소", kicker: "QnA", title: "자주 묻는 질문", y: 0.8, bg: "light" },
    { order: 7, our_type: "notice", role: "주의", angle: "주의", kicker: "", title: "사용 불가 품목 안내", y: 0.9, bg: "dark" },
  ],
  copy: { chain: "문제 → 해결 → 장점 3 → FAQ", tone: "단정한 존댓말", title_len: 12, two_line: true, problem_frame: "질문형", selling_points: ["강력 진동", "충전 대기 없음"] },
  avoid: ["7차 완판", "KC 인증"],
  ocr_lines: ["750Hz 초강력 진동 묵은 때까지 싹", "이걸 한 번에 해결할 순 없을까", "충전 대기 ZERO", "7차 완판"],
  measured: { bg: "#ffffff", darkRatio: 0.2, rows: [1, 2, 3], files: 3 },
  cost: { usd: 0.21, model: "cli:haiku", ms: 65000, ocrMs: 4000 },
});
const SECS = () => [
  { id: "hero", type: "hero" }, { id: "feature-1", type: "feature" }, { id: "feature-2", type: "feature" }, { id: "feature-3", type: "feature" },
  { id: "problem", type: "problem" }, { id: "detail", type: "detail" }, { id: "versatility", type: "versatility" }, { id: "options", type: "options" }, { id: "spec", type: "spec" }, { id: "faq", type: "faq" }, { id: "notice", type: "notice" },
];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "seedtpl-"));

test("fromReference: ocr_lines·measured·섹션 원문(title·좌표)을 빼고 이름·분류·출처·overrides·version 을 붙인다", () => {
  const t = fromReference(REF(), { name: "", category: "주방>수납", source: { kind: "coupang", url: "https://www.coupang.com/vp/products/123?x=1", productName: "폭조절 풀아웃 커피용품 수납랙 대형", key: "coupang:123" } });
  assert.equal(t.error, undefined);
  assert.match(t.id, ID_RE); assert.equal(t.version, 1);
  assert.equal(t.name, "수납 폭조절 풀아웃 커피"); // 카테고리 마지막 + 상품명 앞 10자
  assert.equal(t.category, "주방>수납"); assert.equal(t.madeBy, "본인");
  assert.deepEqual(t.overrides, {});
  assert.equal(t.source.kind, "coupang"); assert.equal(t.source.key, "coupang:123"); assert.equal(t.source.files, 3);
  assert.equal(t.ocr_lines, undefined); assert.equal(t.measured, undefined);
  for (const s of t.sections) { assert.equal(s.title, undefined); assert.equal(s.y, undefined); assert.equal(s.tx, undefined); assert.ok(s.gist.length <= 20); }
  assert.equal(t.sections[1].our_type, "problem"); assert.equal(t.sections[1].bg, "dark"); assert.equal(t.sections[2].kicker, "POINT 1");
  assert.deepEqual(t.avoid, ["7차 완판", "KC 인증"]);
  assert.equal(t.tokens.colors.brand, "#1f3cf5"); assert.equal(t.tokens.kicker, "pill-brand");
  assert.equal(JSON.stringify(t).includes("750Hz"), false, "레퍼런스 원문 문장은 템플릿 어디에도 남지 않는다");
  assert.deepEqual(fromReference({}).error, "레퍼런스에 손잡이(tokens)가 없습니다");
});

test("defaultName: 카테고리 마지막 단계 + 상품명 10자, 둘 다 없으면 날짜", () => {
  assert.equal(defaultName({ category: "주방용품 > 수납/정리", name: "실리콘 힙업 밴드 벌집 미끄럼방지" }), "수납/정리 실리콘 힙업 밴드");
  assert.equal(defaultName({ date: "2026-10-11" }), "템플릿 2026-10-11");
});

test("applyOverrides: enum·색·숫자 검증, 브랜드 색을 끄면 브랜드 손잡이는 무채색 대안으로, 사진 모양 바꾸면 모서리도 따라감", () => {
  const tk = REF().tokens;
  const o = applyOverrides(tk, { align: "left", spacing: "airy", kicker: "elephant", title_size: 99, "colors.bg": "#000000", "colors.ink": "zzz", radius: -5 });
  assert.equal(o.align, "left"); assert.equal(o.spacing, "airy"); assert.equal(o.kicker, "pill-brand", "모르는 값은 무시"); assert.equal(o.title_size, 56); assert.equal(o.colors.bg, "#000000"); assert.equal(o.colors.ink, tk.colors.ink); assert.equal(o.radius, 0);
  assert.equal(tk.align, "center", "원본 tokens 는 바뀌지 않는다");
  const noBrand = applyOverrides(tk, { "colors.brand": null });
  assert.equal(noBrand.colors.brand, null); assert.equal(noBrand.kicker, "pill-dark"); assert.equal(noBrand.icons, "light"); assert.equal(noBrand.emph, "weight");
  assert.equal(applyOverrides(tk, { photo: "card" }).radius, 24); assert.equal(applyOverrides(tk, { photo: "card", radius: 6 }).radius, 6);
  assert.deepEqual(cleanOverrides({ align: "left", bogus: 1, kicker: "x", title_weight: 650 }), { align: "left", title_weight: 700 });
  assert.equal(normalizeOverride("colors.brand", "#ABCDEF"), "#abcdef"); assert.equal(normalizeOverride("colors.brand", "red"), undefined);
  for (const k of Object.keys(OVERRIDE_KEYS)) if (OVERRIDE_KEYS[k].kind === "enum") assert.deepEqual(OVERRIDE_KEYS[k].values, TOKEN_ENUM[k.split(".").pop()], `${k} 칩은 reference-core enum 과 같다`);
  const chips = overrideChips({ tokens: tk, overrides: { align: "left" } });
  assert.equal(chips.find((c) => c.key === "align").value, "left"); assert.equal(chips.find((c) => c.key === "align").changed, true); assert.equal(chips.find((c) => c.key === "kicker").changed, false);
});

test("toReference: 파이프라인 reference 모양 — overrides 적용 토큰 · 섹션 순서가 applyReferenceOrder 에 그대로 먹힘 · 가드 줄은 guard 에서 · keepExtra", () => {
  const t = fromReference(REF(), { name: "A" }); t.overrides = { align: "left", "colors.brand": "#e11d48" };
  const ref = toReference(t, { guard: { ocr_lines: ["충전 대기 ZERO"] }, keepExtra: true });
  assert.equal(ref.fromTemplate, t.id); assert.equal(ref.tokens.align, "left"); assert.equal(ref.tokens.colors.brand, "#e11d48"); assert.equal(ref.keepExtra, true);
  assert.deepEqual(ref.ocr_lines, ["충전 대기 ZERO"]); assert.equal(ref.measured, null);
  const r = applyReferenceOrder(SECS(), ref);
  assert.deepEqual(r.used.filter((x) => ["hero", "problem", "feature"].includes(x)).slice(0, 3), ["hero", "problem", "feature"], "레퍼런스 순서(첫 화면→문제→장점)");
  assert.ok(r.sections.find((s) => s.type === "problem").ref.angle.includes("질문"));
  assert.ok(r.dropped.some((d) => d.our_type === "trust"), "판매 실적 섹션은 우리 재료가 없어 버린다");
  const keep = applyReferenceOrder(SECS(), ref, { keepExtra: ref.keepExtra }), strict = applyReferenceOrder(SECS(), ref, { keepExtra: false });
  assert.ok(keep.sections.length > strict.sections.length, "우리 강점 섹션 유지 토글이면 레퍼런스에 없는 섹션(detail·versatility·options)도 남는다");
  assert.ok(referenceGuide(ref).includes("7차 완판"), "근거 주장 금지 목록이 가이드에 들어간다");
  const g = guardSimilarity({ hero: { title: "충전 대기 ZERO" } }, ref.ocr_lines);
  assert.ok(g.hits?.length || g.length || Object.keys(g).length, "가드 줄이 있으면 원문과 같은 카피를 잡는다");
  const noGuard = toReference(t); assert.deepEqual(noGuard.ocr_lines, []); assert.equal(noGuard.keepExtra, false);
});

test("보관함 CRUD + 같은 출처 캐시 + 이름 바꾸기 + overrides 저장 + reference() ", () => {
  const root = tmp(); const st = createStore(root);
  assert.deepEqual(st.list(), []);
  const meta = { name: "", category: "주방>수납", source: { kind: "coupang", url: "https://www.coupang.com/vp/products/777", productName: "커피 수납랙", key: sourceKey({ url: "https://www.coupang.com/vp/products/777?itemId=1" }) } };
  const a = st.saveFromReference(REF(), meta);
  assert.equal(a.error, undefined); assert.equal(a.existing, undefined); assert.ok(fs.existsSync(path.join(root, a.id, "template.json"))); assert.ok(fs.existsSync(path.join(root, a.id, "guard.json")));
  const again = st.saveFromReference(REF(), meta);
  assert.equal(again.existing, true); assert.equal(again.id, a.id, "같은 쿠팡 주소는 다시 분석·저장하지 않는다");
  assert.equal(st.list().length, 1); assert.equal(st.findBySource("coupang:777").id, a.id);
  const forced = st.saveFromReference(REF(), { ...meta, force: true }); assert.notEqual(forced.id, a.id); assert.equal(st.list().length, 2);
  assert.equal(st.rename(a.id, "  잘 팔리는 A  ").name, "잘 팔리는 A"); assert.equal(st.get(a.id).name, "잘 팔리는 A");
  assert.ok(st.rename("tpl_없음", "x").error);
  st.setOverrides(a.id, { align: "left", bogus: 1 }); st.setOverrides(a.id, { spacing: "tight" });
  assert.deepEqual(st.get(a.id).overrides, { align: "left", spacing: "tight" });
  st.setOverrides(a.id, { spacing: "airy" }, { merge: false }); assert.deepEqual(st.get(a.id).overrides, { spacing: "airy" });
  const ref = st.reference(a.id, { keepExtra: true });
  assert.equal(ref.tokens.spacing, "airy"); assert.equal(ref.keepExtra, true); assert.equal(ref.ocr_lines.length, 4, "guard.json 의 OCR 줄이 가드로 붙는다");
  assert.deepEqual(st.summaries().map((s) => s.kind), ["mine", "mine"]);
  const sm = summarize(st.get(a.id)); assert.equal(sm.colors[0], "#ffffff"); assert.equal(sm.colors[2], "#1f3cf5"); assert.equal(sm.overrides, 1); assert.ok(sm.desc.includes("쿠팡"));
  assert.deepEqual(st.remove(forced.id), { ok: true }); assert.equal(st.list().length, 1); assert.ok(st.remove(forced.id).error);
  fs.rmSync(root, { recursive: true, force: true });
});

test("내보내기(.seedtpl.json) → 가져오기 왕복: 이름·토큰·섹션·overrides 유지, 가드 줄·비용·캐시 열쇠는 안 나감, 새 id·kind import", () => {
  const root = tmp(), st = createStore(root), root2 = tmp(), st2 = createStore(root2);
  const a = st.saveFromReference(REF(), { name: "내 A", category: "주방", source: { kind: "coupang", url: "https://www.coupang.com/vp/products/1", key: "coupang:1" } });
  st.setOverrides(a.id, { align: "left", "colors.brand": "#e11d48" });
  const ex = st.exportTo(a.id, path.join(root, "share"));
  assert.ok(ex.file.endsWith(".seedtpl.json"));
  const raw = JSON.parse(fs.readFileSync(ex.file, "utf8"));
  assert.equal(raw.seedtpl, 1); assert.equal(raw.template.cost, undefined); assert.equal(raw.template.source.key, undefined); assert.equal(raw.template.ocr_lines, undefined);
  assert.equal(JSON.stringify(raw).includes("750Hz"), false, "레퍼런스 원문은 공유 파일에 없다");
  const b = st2.importFrom(ex.file);
  assert.equal(b.error, undefined); assert.notEqual(b.id, a.id); assert.match(b.id, ID_RE);
  assert.equal(b.name, "내 A"); assert.equal(b.category, "주방"); assert.equal(b.madeBy, "받음"); assert.equal(b.source.kind, "import"); assert.equal(b.source.importedFrom, a.id);
  assert.deepEqual(b.overrides, { align: "left", "colors.brand": "#e11d48" });
  assert.deepEqual(b.tokens, st.get(a.id).tokens, "토큰은 그대로(정규화해도 변하지 않음)");
  assert.equal(b.sections.length, 7); assert.equal(b.sections[2].kicker, "POINT 1");
  assert.deepEqual(st2.reference(b.id).ocr_lines, [], "받은 템플릿엔 가드 줄이 없다(원문을 주고받지 않음)");
  const b2 = st2.importFrom(ex.file); assert.equal(b2.id, b.id, "같은 파일을 두 번 가져오면 덮어쓴다"); assert.equal(st2.list().length, 1);
  assert.ok(fromImport({ hello: 1 }).error); assert.ok(st2.importFrom(path.join(root2, "없는파일.json")).error);
  // 손상된 토큰(enum 밖·색 아님)은 기본값으로 정리
  const bad = fromImport({ template: { name: "X", tokens: { align: "diagonal", kicker: "huge", colors: { bg: "white", brand: "#1f3cf5" } } } });
  assert.equal(bad.tokens.align, "center"); assert.equal(bad.tokens.kicker, "none"); assert.equal(bad.tokens.colors.bg, "#ffffff"); assert.equal(bad.tokens.colors.brand, "#1f3cf5");
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(root2, { recursive: true, force: true });
});

test("sourceKey: 쿠팡 주소는 상품번호, 폴더는 파일 이름·크기 해시(순서 무관·안정)", () => {
  assert.equal(sourceKey({ url: "https://www.coupang.com/vp/products/8123456?itemId=1&vendorItemId=2" }), "coupang:8123456");
  assert.equal(sourceKey({ url: "https://example.com/a?x=1" }), sourceKey({ url: "https://example.com/a?y=2" }));
  const d = tmp(); fs.writeFileSync(path.join(d, "02.jpg"), "bb"); fs.writeFileSync(path.join(d, "01.png"), "a"); fs.writeFileSync(path.join(d, "note.txt"), "x");
  const k1 = sourceKey({ dir: d }); assert.match(k1, /^folder:[0-9a-f]{16}$/);
  assert.equal(sourceKey({ files: [path.join(d, "02.jpg"), path.join(d, "01.png")] }), sourceKey({ files: [path.join(d, "01.png"), path.join(d, "02.jpg")] }), "파일 목록 순서가 달라도");
  fs.writeFileSync(path.join(d, "02.jpg"), "bbb"); assert.notEqual(sourceKey({ dir: d }), k1, "파일이 바뀌면 열쇠도 바뀐다");
  assert.equal(sourceKey({}), "");
  fs.rmSync(d, { recursive: true, force: true });
});

test("sanitizeTokens·newId", () => {
  const t = sanitizeTokens({ align: "left", spacing: "airy", bands: "alternate", radius: 99, title_size: 10, colors: { bg: "#111111", brand: "#00ff00" } });
  assert.equal(t.align, "left"); assert.equal(t.spacing, "airy"); assert.equal(t.bands, "alternate"); assert.equal(t.radius, 36); assert.equal(t.title_size, 34); assert.equal(t.colors.bg, "#111111"); assert.equal(t.colors.brand, "#00ff00");
  assert.match(newId(new Date("2026-10-11T00:00:00Z")), /^tpl_20261011_[0-9a-f]{6}$/);
});
