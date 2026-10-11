import { applyReferenceOrder, refKickers } from "./reference-core.js";
import { normKind } from "./extract-core.js"; // 이미지 kind: main/sku/detail(구 gallery/option/detail) 둘 다 받는다
const nk = (k) => normKind(k);
// ⑦ 구성 — 이미지 분류 + 카피 → PagePlan(CONTRACTS 7절). 순수 함수(파일·electron 없음, node --test 로 검증).
//   buildPlan({ source, ocr, cleaned, copy, templateId, translations?, copyInput?, jobId?, now? }) → plan
//   - source: DetailSource(+images), ocr: OcrResult, cleaned: A2 cleanImage 결과 [{ id, out, boxesOut }], copy: Copy
//   - translations(선택): zh→ko Map/객체 — 사진 위 남긴 글자(kept)를 덮을 한글 띠(overlay) 문구. copyInput(선택)의 texts_zh/texts_ko 쌍에서도 찾는다.
//   이미지 경로는 jobDir 기준 상대경로이며 구분자는 "/"(템플릿이 file:// URL 로 쓰므로 윈도우에서도 "/"가 맞다).
export const SECTION_ORDER = ["hero", "pain", "usp", "feature", "gallery", "spec", "size", "package", "notice", "faq", "cta"];
// v2(기획안 기반 PAS→AIDMA): pain→problem, usp→benefits 로 이름을 바꾸고 agitate/solution/proof/compare/steps/objections/trust 가 추가된다
// editorial(A4 v3) 필드가 카피에 있으면 options/keywords/checkpoint/foryou/point 섹션이 더해지고 feature 는 point 로 바뀐다
export const SECTION_ORDER_V2 = ["hero", "options", "keywords", "problem", "agitate", "solution", "benefits", "checkpoint", "foryou", "point", "feature", "gallery", "proof", "compare", "steps", "spec", "size", "package", "objections", "trust", "notice", "faq", "cta"];

// v3: 기획서 plan_direction(첫 화면→초반→중반→디테일→후반→마지막) 순서 — 첫 화면=hero, 초반=공감·핵심 포인트 앞쪽, 중반=포인트·지시선, 디테일=클로즈업·갤러리·숫자, 후반=사이즈·옵션, 마지막=스펙·주의·FAQ
export const PLAN_PART_SECTIONS = {
  "첫 화면": ["hero", "keywords"], "초반": ["problem", "agitate", "solution", "benefits"], "중반": ["point", "feature", "checkpoint", "foryou", "steps"],
  "디테일": ["gallery", "proof", "compare"], "후반": ["size", "options", "package"], "마지막": ["objections", "trust", "spec", "notice", "faq", "cta"],
};
export const SECTION_ORDER_V3 = Object.values(PLAN_PART_SECTIONS).flat();

// 상품이 보이는 정도(비전): full > partial(bbox 큰 순) > none. 결과가 없으면(옛 비전) 판단하지 않음
export const productFull = (v) => !v || v.product_visible == null || v.product_visible === "full";
export const productShown = (v) => !v || v.product_visible == null || v.product_visible !== "none";
export const bboxArea = (v) => (v?.product_bbox ? (Number(v.product_bbox.w) || 0) * (Number(v.product_bbox.h) || 0) : 0);
// 사진 고르기: full 먼저 → 없으면 partial 중 bbox 큰 것. heroUse 면 다른 브랜드가 눈에 띄는 사진 제외
export function rankByProduct(list = [], { heroUse = false } = {}) {
  const ok = list.filter((v) => productShown(v) && !(heroUse && v?.other_brand_prominent));
  const full = ok.filter(productFull).map((v, i) => ({ v, i })).sort((a, b) => bboxArea(b.v) - bboxArea(a.v) || a.i - b.i).map((x) => x.v); // full 끼리는 상품이 크게 보이는 쪽 먼저(같으면 원래 순서)
  const part = ok.filter((v) => !productFull(v)).sort((a, b) => bboxArea(b) - bboxArea(a));
  return [...full, ...part];
}
// POINT·feature·checkpoint 에 쓸 수 있는가: 상품 전체가 보이고, 다른 브랜드가 두드러지지 않고, 로고가 작게라도 보이지 않음(검사 결과가 없으면 통과)
export const pointGrade = (v) => !v || ((v.product_visible == null || v.product_visible === "full") && !v.other_brand_prominent && v.any_logo_visible !== true);
export const focusOf = (v) => (v?.product_bbox && v.product_bbox.w > 0 ? { ...v.product_bbox } : null);

// 같은 사진 판별 키: 파일 이름에서 _cut/_full/_photo 꼬리를 떼고, 긴 이미지 조각(_01)은 조각 번호까지
export function photoKey(p) {
  const b = String(p || "").replace(/\\/g, "/").split("/").pop().replace(/\.[a-z0-9]+$/i, "").replace(/_(cut|cutout|full|photo)$/i, "");
  const m = b.match(/^(.*?)_(\d{2})$/);
  return m ? { id: m[1], piece: m[2] } : { id: b, piece: null };
}
// 한 사진은 페이지 전체에서 1회만(hero 포함 첫 등장만 남김). 같은 원본의 크롭/누끼도 같은 사진, 긴 이미지의 다른 조각은 다른 사진(원본 전체와는 겹침)
export function dedupePhotos(sections) {
  const used = new Map(); // id → Set(piece|"*")
  const take = (p) => {
    if (!p) return null;
    const { id, piece } = photoKey(p), set = used.get(id) || new Set();
    if (set.has("*") || (piece ? set.has(piece) : set.size > 0)) return null;
    set.add(piece || "*"); used.set(id, set); return p;
  };
  const removed = [];
  // 우선순위: hero → 사진이 주인공인 섹션(point/feature/checkpoint/options/size/package) → 나머지(usp 카드·solution·proof·compare·gallery) — 같은 사진이면 앞 순위가 갖는다
  const RANK = (t) => (t === "hero" ? 0 : ["point", "feature", "checkpoint", "options", "size", "package", "spec"].includes(t) ? 1 : ["usp", "benefits"].includes(t) ? 2 : t === "gallery" ? 3 : 4);
  const order = sections.map((sec, i) => ({ sec: { ...sec }, i })).sort((a, b) => RANK(a.sec.type) - RANK(b.sec.type) || a.i - b.i);
  for (const { sec: s } of order) {
    for (const k of ["image", "image2", "cutout"]) if (s[k]) { if (!take(s[k])) { removed.push({ id: photoKey(s[k]).id, why: "duplicate", section: s.type }); s[k] = null; } }
    for (const k of ["images", "photos"]) if (Array.isArray(s[k])) s[k] = s[k].filter((p) => { const keep = take(p); if (!keep) removed.push({ id: photoKey(p).id, why: "duplicate", section: s.type }); return !!keep; });
    if (Array.isArray(s.items)) s.items = s.items.map((it) => (it && it.image ? (take(it.image) ? it : (removed.push({ id: photoKey(it.image).id, why: "duplicate", section: s.type }), { ...it, image: null })) : it));
  }
  const out = order.sort((a, b) => a.i - b.i).map((o) => o.sec).filter((s) => {
    if ((s.type === "feature" || s.type === "point") && !s.image && !s.textOnly) return false; // 사진이 주인공인 섹션은 사진이 빠지면 뺀다(v5 글만 카드는 유지)
    if (s.type === "gallery" && !(s.images || []).length) return false;
    if (s.type === "checkpoint" && !s.cutout && !s.image) return false; // 지시선은 제품 사진(누끼·v5 사진) 위에서만 의미가 있다
    return true;
  });
  return { sections: out, removed };
}
export const TEMPLATES = ["editorial", "clean", "dark", "pop", "studio", "v2"]; // 기본 editorial(A4 v3)
export const DEFAULT_TEMPLATE = "editorial";
export const CUT_HEIGHT = 1500;   // 긴 이미지 분할 단위(px)
export const LONG_RATIO = 2.5;    // 세로 > 가로 × 2.5 → 긴 이미지
export const MIN_TAIL = 300;      // 마지막 조각이 이보다 작으면 앞 조각에 붙인다
export const MAX_FEATURES = 8;    // feature 섹션 상한(조각 포함) — 넘치면 2열 gallery 로
export const MAX_FEATURES_VISION = 7; // 비전 검수 결과가 있으면 feature 최대 7장(score ≥4 우선, 3은 자리 남을 때만, ≤2 는 feature 아님)
export const MAX_OVERFLOW = 6;    // gallery 로 옮길 수 있는 상세 이미지 수(그 밖은 plan.dropped)
export const MAX_GALLERY_KIND = 4; // 갤러리 사진(hero 제외) 최대 장수
export const MAX_SECTION_IMG_H = 1500; // spec·size 섹션 이미지 세로 상한(렌더 높이) — 길면 image:null(표만)
export const MAX_PAGE_H = 18000;  // 예상 전체 높이 상한(px) — 넘으면 feature 를 뒤에서부터 gallery 로
export const PAGE_W = 780;
export const BLANK_RATIO = 0.06;  // trim.contentRatio(배경 아닌 픽셀 비율)가 이 미만이면 빈 그림으로 본다
export const FLAT_MIN_H = 220;    // 사진 크롭이 이보다 납작하면(세로 < 220px 또는 가로/세로 > 3) usp·gallery·hero 에 쓰지 않는다
export const FLAT_RATIO = 3;
export const FEATURE_MIN_H = 260; // feature 도 너무 납작한 크롭(세로 < 260 또는 가로/세로 > 3.2)은 글만
export const FEATURE_RATIO = 3.2;
export const MIN_COVERAGE = 0.45; // photo.coverage(크롭 면적비)가 이 미만이면 gallery·hero 에 쓰지 않는다(feature 는 허용)
export const MAX_GALLERY = 8;
export const MAX_POINTS_EDITORIAL = 4; // editorial 포인트 최대 4개(카피 benefits 순서)
export const MAX_GALLERY_EDITORIAL = 4;     // gallery 섹션 전체 최대 장수
export const SAME_SCENE_TOL = 0.05; // 크롭 가로·세로가 5% 안에서 같으면 같은 장면으로 보고 하나만
// 스펙 표 이미지(表 머리말이 3개 이상): 어떤 섹션 이미지로도 쓰지 않는다(spec 섹션은 attrs 표만)
export const SPEC_TABLE_RE = /参数|PARAMETER|SPECIFICATION|品牌|品名|规格|材质|型号|颜色|重量|产地|产品名称|净重|毛重|商品特点|适用范围|安装方法|品类|货号|尺寸\s*[：:]|功能/gi;
export const isSpecTable = (texts = []) => count((Array.isArray(texts) ? texts : [texts]).map(S).join("\n"), SPEC_TABLE_RE) >= 3;
// 1~2자 수량 단위어(个·扇·只·件·套 …)는 띠(overlay)에 번역해 넣지 않는다 — "个→개인·扇→팬" 같은 오역 방지
export const BRAND_ROW_RE = /品牌|商标|牌子|brand|상표|브랜드|제조사|제조업체|생산업체|제조원/i; // 스펙 표에서 뺄 공급사 브랜드 행
export const BAD_VISION_CAPTION_RE = /체중|몸무게|매달|두\s*사람의\s*무게|\d+\s*(?:kg|㎏|킬로)|따라\s*하지|위험한|모습(을|이)\s*보여|모습입니다|로고가/; // vision.js BAD_CAPTION_RE 와 같게
export const UNIT_WORD_RE = /^[\d\s.,]*[个扇只件套条张片台把根支副对双块盒袋包卷米组位名层格节段排排]{1,2}$/;

const S = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const hasCJK = (t) => /[一-鿿]/.test(t);
const count = (text, re) => (text.match(re) || []).length;

// ── 이미지 분류 (우선순위 notice > package > size > spec)
// 머리글(짧은 첫 줄: 温馨提示·包装清单·产品尺寸·产品参数 …)이 있으면 그 줄이 결정하고, 없으면 글 전체로 우선순위 판정.
// size 는 치수 패턴(숫자*숫자 또는 cm/mm 수치 2개 이상)이 반드시 있어야 한다. notice 로 분류된 이미지는 글만 쓰고 이미지는 버린다.
export const CLASS_RE = {
  notice: /温馨提示|注意|须知|说明(?!书)|误差|友情提示|提示/,
  package: /包装|装箱|配件|清单|套餐内容/,
  size: /尺寸|规格|大小|长度|宽度|高度|直径/,
  spec: /参数|产品信息|基本信息|产品详情/,
};
const DIMS = (t) => /\d+(?:\.\d+)?\s*[*×xX]\s*\d+/.test(t) || count(t, /\d+(?:\.\d+)?\s*(?:cm|mm|厘米|毫米|公分|㎝|㎜)/gi) >= 2;
const PRIORITY = ["notice", "package", "size", "spec"];
export function classifyImage(texts = []) {
  const lines = (Array.isArray(texts) ? texts : [texts]).map(S).filter(Boolean);
  const all = lines.join("\n");
  const header = lines.find((l) => hasCJK(l)); // 첫 중국어 줄이 짧으면 머리글로 본다
  if (header && header.length <= 8) {
    for (const k of PRIORITY) if (CLASS_RE[k].test(header) && (k !== "size" || DIMS(all))) return k;
  }
  for (const k of PRIORITY) if (CLASS_RE[k].test(all) && (k !== "size" || DIMS(all))) return k;
  return null;
}

// 절대경로·역슬래시가 섞여 와도 "clean/x.png" 같은 jobDir 상대경로로
export function relPath(p, folderHint = "clean") {
  const s = S(p).replace(/\\/g, "/");
  if (!s) return null;
  const m = s.match(/(?:^|\/)(raw|clean|out)\/([^/]+)$/);
  if (m) return `${m[1]}/${m[2]}`;
  if (!/^(?:[a-zA-Z]:)?\//.test(s) && !s.includes("/")) return `${folderHint}/${s}`;
  return s.split("/").slice(-2).join("/");
}
const isLong = (w, h) => w > 0 && h > w * LONG_RATIO;

// 긴 이미지를 CUT_HEIGHT 단위로 나눈 사각형 목록
export function cutRects(w, h, unit = CUT_HEIGHT) {
  const rects = [];
  for (let y = 0; y < h; y += unit) rects.push({ x: 0, y, w, h: Math.min(unit, h - y) });
  if (rects.length > 1 && rects[rects.length - 1].h < MIN_TAIL) { const tail = rects.pop(); rects[rects.length - 1].h += tail.h; }
  return rects;
}

// limits(선택): { maxFeatures, maxOverflow, maxPageH, maxSectionImgH } — 테스트·템플릿별 조정용
// vision(선택): vision.js reviewPhotos 결과 { items:[{ id, usable, score, role, caption_title, caption_desc, … }] } 또는 그 배열
//   → usable:false 는 어디에도 쓰지 않음(dropped why:"vision"), hero 는 role hero·score 최고, feature 캡션은 vision 캡션 우선, gallery 는 score 순
export function buildPlan({ source = {}, ocr = {}, cleaned = [], copy = {}, templateId = DEFAULT_TEMPLATE, translations = null, copyInput = null, jobId = "", now = Date.now(), limits = {}, vision = null, scenes = null, brief = null } = {}) {
  // scenes(선택): A5 의 AI 장면 사진(scene.json items) [{ id, shot, purpose: hero|point|usage|detail, file, pass, human, score }] — 통과한 것만, hero·point·usp 사진 1순위
  const sceneList = (Array.isArray(scenes) ? scenes : scenes?.items || []).filter((x) => x && x.file && x.pass !== false && x.human !== "reject");
  const bestOfShot = (list) => { const m = new Map(); for (const x of list) { const k = x.shot || x.id; if (!m.has(k) || (Number(x.score) || 0) > (Number(m.get(k).score) || 0)) m.set(k, x); } return [...m.values()]; };
  const heroScene = rankByProduct(bestOfShot(sceneList.filter((x) => x.purpose === "hero")).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)), { heroUse: true })[0] || null;
  const pointScenes = rankByProduct(bestOfShot(sceneList.filter((x) => ["point", "usage", "detail"].includes(x.purpose))));
  const LIM = { maxFeatures: MAX_FEATURES, maxOverflow: MAX_OVERFLOW, maxPageH: MAX_PAGE_H, maxSectionImgH: MAX_SECTION_IMG_H, ...limits };
  const visionById = new Map((Array.isArray(vision) ? vision : vision?.items || []).filter((v) => v && v.id).map((v) => [S(v.id), v]));
  const vis = (im) => visionById.get(im?.id) || null;
  const visionBad = (im) => { const v = vis(im); return !!v && (v.usable === false || v.role === "skip" || (v.has_text && v.text_pos === "center")); }; // 가운데 글자가 남은 사진도 못 씀
  const vScore = (im) => Number(vis(im)?.score) || 0;
  const images = (source.images || []).filter((im) => im && im.id);
  const ocrById = new Map((ocr.images || []).map((im) => [im.id, im]));
  const cleanById = new Map((cleaned || []).map((c) => [c.id, c]));
  // 사진 모드: A5 가 clean 단계에 rec.photo = { file, w, h, rect, contentRatio } | null(글자 없는 제품 사진 영역만 잘라낸 것)을 기록하면
  //   섹션 이미지는 photo 가 있는 이미지만 쓴다. photo 키가 하나도 없는 옛 결과(fixture 등)는 지운 전체본(out)을 그대로 쓴다
  const strictPhoto = (cleaned || []).some((c) => c && "photo" in c);
  const photoOf = (im) => { const c = cleanById.get(im.id); return c?.photo?.file ? c.photo : null; };
  // 크기는 사진 크롭 → 지운 이미지(A2 가 여백·글자 띠를 잘라냈을 수 있음) → 원본·OCR 순
  const dims = (im) => { const ph = photoOf(im), c = cleanById.get(im.id); return { w: Number(ph?.w || c?.w || im.w || ocrById.get(im.id)?.w || 0), h: Number(ph?.h || c?.h || im.h || ocrById.get(im.id)?.h || 0) }; };
  const imgPath = (im) => { const ph = photoOf(im); return ph ? relPath(ph.file, "clean") : cleanById.get(im.id)?.out ? relPath(cleanById.get(im.id).out, "clean") : im.file ? relPath(im.file, "raw") : null; };
  const hasPhoto = (im) => !strictPhoto || !!photoOf(im); // 섹션 이미지로 쓸 수 있는가
  // A2 의 제품 누끼 rec.cutout = { file, w, h, ok } — 비전 검수가 product_only(상품 본체 단독)라고 한 사진의 ok 누끼만 쓴다(전경 분리가 사람·세탁기·글자 상자까지 따 오므로)
  //   → hero 1순위(스튜디오 배경), solution/proof·compare·size 에 우선. 조건이 안 맞으면 사진(photo)을 쓴다
  const cutoutOf = (im) => { const c = cleanById.get(im.id)?.cutout; return c && c.ok !== false && c.file && vis(im)?.product_only === true ? c : null; };
  const cutoutPath = (im) => (cutoutOf(im) ? relPath(cutoutOf(im).file, "clean") : null);
  const flat = (im) => { const { w, h } = dims(im); return h < FLAT_MIN_H || (h > 0 && w / h > FLAT_RATIO); }; // 납작한 크롭 → usp·gallery·hero 금지
  const flatFeature = (im) => { const { w, h } = dims(im); return strictPhoto && !!photoOf(im) && (h < FEATURE_MIN_H || (h > 0 && w / h > FEATURE_RATIO)); }; // feature 도 못 쓰는 납작 크롭 → 글만
  const lowCoverage = (im) => { const c = photoOf(im)?.coverage; return c != null && Number(c) < MIN_COVERAGE; }; // 크롭이 원본의 작은 부분뿐(또는 자르지 못해 쓴 전체본의 상품 비율이 낮음) → gallery·hero·usp 금지(feature 만)
  // 상자 좌표는 지운 이미지 기준(boxesOut, 잘린 띠만큼 옮겨져 있음). 없으면 OCR 원본 상자. 사진 크롭이 있으면 크롭 안의 상자만, 크롭 기준 좌표로
  const boxesOf = (im) => {
    const c = cleanById.get(im.id), all = c?.boxesOut?.length ? c.boxesOut : (ocrById.get(im.id)?.boxes || []);
    const r = photoOf(im)?.rect; if (!r) return all;
    return all.filter((b) => b.x + b.w > r.x && b.x < r.x + r.w && b.y + b.h > r.y && b.y < r.y + r.h).map((b) => ({ ...b, x: b.x - r.x, y: b.y - r.y }));
  };
  const zhTexts = (im) => (ocrById.get(im.id)?.boxes || []).map((b) => S(b.text)).filter(Boolean);
  const specTable = (im) => isSpecTable(zhTexts(im));
  const keptCJK = (im) => boxesOf(im).filter((b) => b.action === "kept" && hasCJK(S(b.text))).length; // 사진 위에 남은 중국어 상자 수
  // 글자만 있던 이미지(지우면 빈 바탕: trim.blank) 또는 내용 픽셀 비율이 너무 낮은 이미지(trim.contentRatio < BLANK_RATIO) → 이미지로는 안 쓰고 글만. 긴 이미지는 원본 기준으로 조각 전부 제외
  const isBlank = (im) => { const t = cleanById.get(im.id)?.trim; return !!t && (t.blank === true || (t.contentRatio != null && Number(t.contentRatio) < BLANK_RATIO)); };
  const dropped = []; // [{ id, why: "blank"|"kept"|"overflow" }]
  // 번역 찾기: translations → copyInput 쌍 → OCR 상자의 text_ko(A5 가 채움) → (CJK 아니면 그대로)
  const pairs = new Map();
  for (const im of copyInput?.images || []) (im.texts_zh || []).forEach((zh, i) => { if (S(im.texts_ko?.[i])) pairs.set(S(zh), S(im.texts_ko[i])); });
  for (const im of ocr.images || []) for (const b of im.boxes || []) if (S(b.text_ko) && !pairs.has(S(b.text))) pairs.set(S(b.text), S(b.text_ko));
  const ko = (zh) => { zh = S(zh); const t = translations instanceof Map ? translations.get(zh) : translations?.[zh]; return S(t) || pairs.get(zh) || (hasCJK(zh) ? "" : zh); };
  // 띠(overlay)·칩 글자: Copy.labels(AI 가 번역한 짧은 라벨) → 번역표/구글 순. 1~2자 수량 단위어는 넣지 않는다
  const labels = new Map((copy.labels || []).filter((l) => S(l?.ko) && !hasCJK(S(l.ko))).map((l) => [`${S(l.imageId)}|${S(l.zh)}`, S(l.ko)]));
  const labelKo = (imageId, zh) => { zh = S(zh); if (!zh || UNIT_WORD_RE.test(zh)) return ""; return labels.get(`${imageId}|${zh}`) || labels.get(`|${zh}`) || ko(zh); };
  const capById = new Map((copy.captions || []).map((c) => [c.imageId, c]));
  const koTextOf = (im) => [...zhTexts(im).map((t) => ko(t)), S(capById.get(im.id)?.title), S(capById.get(im.id)?.desc)].filter(Boolean).join(" ");
  const clsOf = (im) => classifyImage(zhTexts(im));

  // ── hero: 갤러리 첫 장. 사진 위에 중국어 상자(kept)가 남은 이미지는 피하고, 전부 남았으면 상자가 가장 적은 것.
  //    갤러리가 없으면 (분류되지 않은) 상세 이미지 중 가장 정사각형에 가까운 것 — 같은 kept 규칙
  const gallery = images.filter((im) => nk(im.kind) === "main");
  const pickHero = (cands, order) => { if (!cands.length) return null; const clean = cands.filter((im) => keptCJK(im) === 0); return clean.length ? [...clean].sort(order)[0] : [...cands].sort((a, b) => keptCJK(a) - keptCJK(b) || order(a, b))[0]; };
  // 강한 사진: 비전 결과가 없으면 그대로 통과, 있으면 score≥4 이고 제품이 보이는 사진(subject product/product_in_scene)만
  const isStrong = (im) => !!im && (!visionById.size || !vis(im) ? true : vScore(im) >= 4 && ["product", "product_in_scene"].includes(vis(im)?.subject) && !visionBad(im));
  const isPerson = (im) => vis(im)?.subject === "person"; // 사람이 주인공인 사진: usp·point·hero 금지(갤러리만)
  const galleryOnlyV = (im) => isPerson(im) || vis(im)?.role === "detail"; // 같은 구도 클로즈업(role detail)도 갤러리로만
  const heroOk = (im) => !isBlank(im) && hasPhoto(im) && !flat(im) && !lowCoverage(im) && !specTable(im) && !visionBad(im) && !isPerson(im) && productShown(vis(im)) && !vis(im)?.other_brand_prominent;
  // 비전 결과가 있으면 role hero 우선, 그다음 score 높은 순(갤러리 먼저)
  const heroOrder = (a, b) => (!!cutoutOf(b)) - (!!cutoutOf(a)) || (productFull(vis(b)) - productFull(vis(a))) || (bboxArea(vis(b)) - bboxArea(vis(a))) || (vis(b)?.role === "hero") - (vis(a)?.role === "hero") || vScore(b) - vScore(a); // 누끼 → role hero → score
  let hero = pickHero(gallery.filter(heroOk), visionById.size || cleaned.some((c) => c?.cutout) ? heroOrder : () => 0);
  if (!hero && visionById.size) hero = pickHero(images.filter((im) => nk(im.kind) === "detail" && heroOk(im) && !isLong(dims(im).w, dims(im).h) && vis(im)?.role === "hero"), heroOrder);
  if (!hero) {
    const cands = images.filter((im) => nk(im.kind) === "detail" && heroOk(im) && !isLong(dims(im).w, dims(im).h));
    const plain = cands.filter((im) => !clsOf(im));
    const squareness = (im) => Math.abs(dims(im).w / (dims(im).h || 1) - 1);
    hero = pickHero(plain.length ? plain : cands, (a, b) => squareness(a) - squareness(b));
  }

  // ── 상세 이미지(+hero 가 아닌 갤러리 중 중국어가 남은 것) → 조각 단위로 분류: notice 는 글만, size/package/spec 첫 장은 섹션 이미지, 나머지는 feature 후보
  const cuts = [];
  const cutOut = new Map(); // id → 첫 조각 경로(usp.image·gallery 매핑용)
  const picked = { size: null, package: null, spec: null };
  const overlayOf = (im, boxes, rect) => boxes.filter((b) => b.action === "kept" && hasCJK(S(b.text)) && (!rect || (b.y >= rect.y && b.y < rect.y + rect.h)))
    .map((b) => { if (UNIT_WORD_RE.test(S(b.text))) return null; const text = labelKo(im.id, b.text) || S(capById.get(im.id)?.title) || ""; return text ? { x: b.x, y: b.y - (rect?.y || 0), w: b.w, h: b.h, text } : null; }).filter(Boolean);
  const features = [];
  const pieceInfo = (im, rect, k, n) => { // 한 조각(또는 한 장)의 글·캡션
    const boxes = boxesOf(im).filter((b) => !rect || (b.y >= rect.y && b.y < rect.y + rect.h));
    const zh = boxes.map((b) => S(b.text)).filter(Boolean), inside = zh.filter((t) => hasCJK(t) && !UNIT_WORD_RE.test(t)).map((t) => labelKo(im.id, t)).filter(Boolean);
    const v = vis(im), vBad = v && BAD_VISION_CAPTION_RE.test(`${v.caption_title || ""} ${v.caption_desc || ""}`); // 저장된 비전 결과(재생 모드)에 체중·하중 캡션이 남아 있으면 쓰지 않는다
    const cap = v && !vBad && S(v.caption_title) ? { title: S(v.caption_title), desc: S(v.caption_desc) || S(capById.get(im.id)?.desc) } : (capById.get(im.id) || {}); // 비전 캡션(사진에 보이는 것 근거) 우선
    const first = k === 0;
    return { boxes, zh, title: (first && S(cap.title)) || inside[0] || "", desc: (first && S(cap.desc)) || inside.slice(first && S(cap.title) ? 0 : 1).join(" · "), overlay: overlayOf(im, boxes, rect), kept: boxes.filter((b) => b.action === "kept" && hasCJK(S(b.text))).length, part: k + 1, parts: n };
  };
  const galleryOnly = [];
  const consider = (im, pathOut, w, h, info) => { // 조각 분류 → 섹션 이미지 / feature / 버림(notice·blank)
    const cls = classifyImage(info.zh.length ? info.zh : zhTexts(im)) || (["size", "package"].includes(vis(im)?.role) && info.parts <= 1 ? vis(im).role : null); // 비전 role 은 글 분류가 없을 때의 힌트
    if (cls === "notice") return; // 주의 문구 이미지는 글(notice 섹션)로만
    if (cls === "spec" || specTable(im)) { if (!picked.spec) picked.spec = { image: null, w: 0, h: 0, overlay: [], imageId: im.id, specTable: true }; if (!dropped.some((d) => d.id === im.id)) dropped.push({ id: im.id, why: "spec-table" }); return; } // 스펙 표 이미지는 글(attrs 표)만
    if (isBlank(im)) { if (cls && !picked[cls]) picked[cls] = { image: null, w: 0, h: 0, overlay: [], imageId: im.id, blank: true }; return; } // 빈 바탕 → 글만
    if (cls && !picked[cls] && h <= LIM.maxSectionImgH && info.kept === 0) { picked[cls] = { image: pathOut, w, h, overlay: info.overlay, imageId: im.id }; return; }
    if (cls && !picked[cls]) picked[cls] = { image: null, w: 0, h: 0, overlay: [], imageId: im.id, longImage: im.id }; // 길거나 중국어가 남은 표 → 표만(image:null)
    if (cls) return; // 두 번째 사이즈 표 등은 쓰지 않는다
    if (galleryOnlyV(im) || (vis(im) && vis(im).product_visible === "none")) { if (!galleryOnly.includes(im.id)) galleryOnly.push(im.id); return; } // 상품이 안 보이는 사진은 point/feature 금지 // 사람 사진·클로즈업은 point 로 쓰지 않고 갤러리 후보로
    features.push({ type: "feature", image: pathOut, w, h, title: info.title, desc: info.desc, overlay: info.overlay, imageId: im.id, kept: info.kept, ...(info.parts <= 1 && focusOf(vis(im)) ? { focus: focusOf(vis(im)) } : {}), ...(info.parts > 1 ? { part: info.part, parts: info.parts } : {}) });
  };
  const pool = [...images.filter((im) => nk(im.kind) === "detail" && im !== hero), ...gallery.filter((im) => im !== hero && (keptCJK(im) > 0 || isBlank(im) || !hasPhoto(im) || specTable(im) || visionBad(im)))];
  for (const im of pool) if (isBlank(im)) dropped.push({ id: im.id, why: "blank" });
  for (const im of pool) {
    const { w, h } = dims(im), src = imgPath(im);
    if (!src) continue;
    if (visionBad(im)) { dropped.push({ id: im.id, why: "vision" }); continue; } // 비전 검수에서 못 쓴다고 판정
    if (!hasPhoto(im)) { // 사진 영역이 없는 이미지(글자·표·아이콘뿐) → 글만, 이미지는 버림
      const cls = classifyImage(zhTexts(im));
      if (cls && cls !== "notice" && !picked[cls]) picked[cls] = { image: null, w: 0, h: 0, overlay: [], imageId: im.id, noPhoto: true };
      if (!isBlank(im)) dropped.push({ id: im.id, why: "no-photo" });
      continue;
    }
    if (specTable(im) && !isLong(w, h)) { if (!picked.spec) picked.spec = { image: null, w: 0, h: 0, overlay: [], imageId: im.id, specTable: true }; dropped.push({ id: im.id, why: "spec-table" }); continue; }
    if (flatFeature(im)) { dropped.push({ id: im.id, why: "flat" }); continue; } // 띠처럼 납작한 크롭은 feature 로도 못 씀 → 글만
    if (isBlank(im)) { // 빈 그림: 조각도 만들지 않고(usp 매핑도 없음) 표 종류만 기록해 글만 쓴다
      const cls = classifyImage(zhTexts(im));
      if (cls && cls !== "notice" && !picked[cls]) picked[cls] = { image: null, w: 0, h: 0, overlay: [], imageId: im.id, blank: true };
      continue;
    }
    if (isLong(w, h)) {
      const rects = cutRects(w, h);
      rects.forEach((rect, k) => {
        const out = `clean/${im.id}_${String(k + 1).padStart(2, "0")}.png`;
        cuts.push({ src, out, rect });
        if (k === 0) cutOut.set(im.id, out);
        consider(im, out, rect.w, rect.h, pieceInfo(im, rect, k, rects.length));
      });
    } else consider(im, src, w, h, pieceInfo(im, null, 0, 1));
  }
  const pathFor = (id) => { const im = images.find((x) => x.id === id); return im && !isBlank(im) && hasPhoto(im) && !specTable(im) && !visionBad(im) ? cutOut.get(id) || imgPath(im) : null; };
  // usp 카드 이미지: AI 가 고른 id 의 사진이 없거나 납작하면, usp 제목의 명사가 OCR 번역·캡션에 있는 다른 사진 이미지로 대체. 없으면 null(글만)
  const uspOk = (im) => !!im && !isPerson(im) && hasPhoto(im) && !isBlank(im) && !flat(im) && !lowCoverage(im) && !specTable(im) && !visionBad(im) && keptCJK(im) === 0 && nk(im.kind) !== "sku"; // usp 카드는 overlay 가 없으니 중국어가 남은 사진도 제외. coverage 낮은(상품이 작은 전체본) 그림도 제외
  // taken: hero·feature 로 이미 크게 쓰는 사진 id — 한 사진은 1회만이므로 카드에는 다른 사진을 고른다
  const uspImage = (it, taken = new Set(), usedHere = new Set()) => {
    const free = (x) => !taken.has(x.id) && !usedHere.has(x.id);
    const own = images.find((x) => x.id === it?.imageId);
    if (uspOk(own) && free(own)) { usedHere.add(own.id); return pathFor(own.id); }
    const toks = S(it?.title).split(/[\s·,/()]+/).map((t) => t.replace(/[^가-힣a-zA-Z0-9]/g, "")).filter((t) => /[가-힣]{2,}|[a-zA-Z0-9]{3,}/.test(t));
    if (!toks.length) return null;
    const best = images.filter((x) => uspOk(x) && x !== hero && free(x)).map((x) => ({ x, n: toks.filter((t) => koTextOf(x).includes(t)).length })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0];
    if (best) usedHere.add(best.x.id);
    return best ? pathFor(best.x.id) : null;
  };

  // ── feature 상한: 근거가 강한 순(usp 가 가리키는 이미지 > OCR 문장 수 > kept 상자) 으로 고르고 페이지 순서는 유지. 넘치면 gallery 후보
  const uspIds = new Set((copy.usp?.items || []).map((it) => it?.imageId).filter(Boolean));
  const evidence = (id) => (uspIds.has(id) ? 10 : 0) + zhTexts({ id }).length * 2 + keptCJK({ id }) + vScore({ id }) * 2;
  const featIds = [...new Set(features.map((f) => f.imageId))];
  const ranked = featIds.map((id, i) => ({ id, i, score: evidence(id) })).sort((a, b) => b.score - a.score || a.i - b.i);
  const keep = new Set(); let pieces = 0;
  const cap = visionById.size ? Math.min(LIM.maxFeatures, MAX_FEATURES_VISION) : LIM.maxFeatures;
  // 비전 결과가 있으면 score ≥4 먼저, 3은 자리가 남을 때만, ≤2(또는 결과 없음 0)는 feature 로 쓰지 않는다
  const order = visionById.size ? [...ranked].sort((a, b) => (vScore({ id: b.id }) >= 4) - (vScore({ id: a.id }) >= 4) || b.score - a.score || a.i - b.i).filter((r) => vScore({ id: r.id }) >= 3) : ranked;
  for (const r of order) { const n = features.filter((f) => f.imageId === r.id).length; if (pieces + n <= cap) { keep.add(r.id); pieces += n; } }
  const overflow = [...featIds.filter((id) => !keep.has(id)), ...galleryOnly].sort((a, b) => images.findIndex((x) => x.id === a) - images.findIndex((x) => x.id === b)); // 페이지 순서
  let featureSecs = features.filter((f) => keep.has(f.imageId));

  // ── 섹션 조립(순서 고정) → 빈 섹션 제거. 갤러리에는 중국어가 남은(kept)·빈 바탕(blank) 이미지를 넣지 않는다(overlay 불가) → 그런 이미지는 버림(dropped)
  const sec = (pk) => (pk ? { image: pk.image, w: pk.w, h: pk.h, ...(pk.longImage ? { longImage: pk.longImage } : {}), ...(pk.blank || pk.noPhoto ? { blankImage: pk.imageId } : {}) } : { image: null });
  const assemble = (feats, overflowIds) => {
    const sections = [];
    sections.push({ type: "hero", image: hero ? imgPath(hero) : null, headline: S(copy.headline), sub: S(copy.sub), badges: (copy.badges || []).map(S).filter(Boolean).slice(0, 3), overlay: hero ? overlayOf(hero, boxesOf(hero)) : [] });
    const pain = (copy.pain?.items || []).filter((it) => S(it?.text)).map((it) => ({ icon: S(it.icon), text: S(it.text) }));
    if (pain.length) sections.push({ type: "pain", title: S(copy.pain?.title), items: pain });
    const taken = new Set([hero?.id, ...feats.map((f) => f.imageId), ...overflowIds].filter(Boolean)), usedHere = new Set(); // 넘친 상세 사진은 갤러리 몫
    const usp = (copy.usp?.items || []).filter((it) => S(it?.title)).map((it) => ({ title: S(it.title), desc: S(it.desc), image: uspImage(it, taken, usedHere) }));
    const uspSec = usp.length ? { type: "usp", title: S(copy.usp?.title), items: usp } : null;
    if (uspSec) sections.push(uspSec);
    sections.push(...feats.map(({ kept, ...f }) => f));
    const galleryOk = (im) => im !== hero && keptCJK(im) === 0 && !isBlank(im) && hasPhoto(im) && !flat(im) && !lowCoverage(im) && !specTable(im) && !visionBad(im);
    // 같은 장면 중복: 사진 모드에서 상세(d) 크롭이 갤러리(g) 크롭과 거의 같은 크기·비율이면 같은 장면으로 보고 갤러리 것만 남긴다
    const galleryPicked = (visionById.size ? [...gallery].sort((a, b) => vScore(b) - vScore(a)) : gallery).filter(galleryOk).slice(0, MAX_GALLERY_KIND); // 비전 결과가 있으면 score 순
    const seen = strictPhoto ? galleryPicked.map(dims) : [];
    const sameScene = (im) => { const { w, h } = dims(im); return seen.some((o) => Math.abs(o.w - w) / (o.w || 1) <= SAME_SCENE_TOL && Math.abs(o.h - h) / (o.h || 1) <= SAME_SCENE_TOL); };
    const galleryImgs = galleryPicked.map(imgPath).filter(Boolean);
    const extraImgs = overflowIds.map((id) => images.find((x) => x.id === id)).filter((im) => galleryOk(im) && !sameScene(im));
    const extra = (visionById.size ? extraImgs.sort((a, b) => vScore(b) - vScore(a)) : extraImgs).slice(0, LIM.maxOverflow).map((im) => pathFor(im.id)).filter(Boolean); // 긴 이미지는 첫 조각(비전 있으면 score 순)
    if (galleryImgs.length || extra.length) sections.push({ type: "gallery", images: [...galleryImgs, ...extra].slice(0, MAX_GALLERY), cols: 2 });
    const rows = (copy.spec || []).filter((r) => S(r?.k) && S(r?.v) && !BRAND_ROW_RE.test(S(r.k))).map((r) => ({ k: S(r.k), v: S(r.v) })); // 공급사 브랜드 행은 표에 안 넣는다
    if (rows.length) sections.push({ type: "spec", rows, image: null }); // 스펙 섹션은 attrs 표만(표 이미지는 쓰지 않음)
    if (picked.size?.image || S(copy.size_note)) sections.push({ type: "size", ...sec(picked.size), note: S(copy.size_note), overlay: picked.size?.overlay || [] });
    const pkg = (copy.package_items || []).map(S).filter(Boolean);
    if (pkg.length || picked.package?.image) sections.push({ type: "package", items: pkg, ...sec(picked.package) });
    const notice = (copy.notice || []).map(S).filter(Boolean);
    if (notice.length) sections.push({ type: "notice", items: notice });
    const faq = (copy.faq || []).filter((f) => S(f?.q) && S(f?.a)).map((f) => ({ q: S(f.q), a: S(f.a) }));
    if (faq.length) sections.push({ type: "faq", items: faq });
    if (S(copy.cta?.headline)) sections.push({ type: "cta", headline: S(copy.cta.headline), sub: S(copy.cta?.sub), image: null });
    // usp 카드 이미지가 비면: 비전 검수에서 쓸 수 있다고 한(score ≥3, scene/detail 포함) 사진 중 아직 어느 섹션에도 안 쓰인 것을 하나씩 배정
    // AI 장면 사진(검수 통과): hero → feature(point) 사진 → 남으면 usp 빈 카드 순으로 1순위. 섹션에 scene:true 표시
    if (sceneList.length) {
      const hs = sections.find((x) => x.type === "hero");
      if (hs && heroScene) { hs.image = heroScene.file; hs.scene = true; hs.overlay = []; }
      const rest = [...pointScenes];
      for (const sec of sections) { if (!rest.length) break; if (sec.type === "feature" && sec.image) { const sc = rest.shift(); sec.image = sc.file; sec.scene = true; sec.overlay = []; sec.sceneId = sc.id; if (S(sc.title_ko) && !S(sec.title)) sec.title = S(sc.title_ko); } }
      if (uspSec) for (const it of uspSec.items) { if (!rest.length) break; if (!it.image) { it.image = rest.shift().file; it.scene = true; } }
    }
    if (uspSec && visionById.size) {
      const used = new Set(sections.flatMap((s) => [s.image, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean));
      const spare = images.filter((im) => uspOk(im) && im !== hero && vScore(im) >= 3 && !used.has(pathFor(im.id))).sort((a, b) => vScore(b) - vScore(a));
      for (const it of uspSec.items) if (!it.image && spare.length) { it.image = pathFor(spare.shift().id); }
    }
    return sections;
  };
  // ── v2: 기획안 기반 구조로 바꾼다(pain→problem, usp→benefits + agitate/solution/proof/compare/steps/objections/trust). 누끼 이미지는 proof·compare·size 에
  const isV2 = !!copy && ("agitate" in copy || "solution" in copy || "objections" in copy);
  const isEditorial = isV2 && !!(copy.keywords || copy.hero_en || copy.points || copy.for_you || copy.options_table);
  const toV2 = (secs) => {
    if (!isV2) return secs;
    const cut = images.filter((im) => cutoutOf(im) && !isBlank(im) && !visionBad(im)).sort((a, b) => (b === hero) - (a === hero) || vScore(b) - vScore(a));
    const cutPaths = cut.map(cutoutPath).filter(Boolean);
    const by = Object.fromEntries(secs.map((x) => [x.type, x]));
    // hero: product_only 누끼가 있으면 누끼(스튜디오 배경), editorial 이면 영문 타이틀·필기체
    if (by.hero) {
      by.hero = { ...by.hero, image: by.hero.scene ? by.hero.image : (hero && cutoutPath(hero)) || by.hero.image }; // AI 장면이 있으면 장면 우선
      if (isEditorial) { const en = (copy.hero_en?.title_en || []).map(S).filter(Boolean); if (en.length) by.hero.title_en = en; if (S(copy.hero_en?.script)) by.hero.script = S(copy.hero_en.script); }
    }
    // checkpoint: 지시선 좌표는 비전이 누끼 위에 준 callout_points, 라벨은 카피 callouts 우선(순서대로) → 없으면 비전 부품 이름
    const cpImg = cut.find((im) => (vis(im)?.callout_points || []).length >= 3);
    const callouts = cpImg ? vis(cpImg).callout_points.slice(0, 5).map((pt, i) => ({ label: S(copy.callouts?.[i]?.label) || S(pt.label), x: Math.min(1, Math.max(0, Number(pt.x) || 0)), y: Math.min(1, Math.max(0, Number(pt.y) || 0)) })).filter((c) => c.label) : [];
    const featSecs = secs.filter((x) => x.type === "feature");
    const out = [];
    // v3 기획서가 있으면 plan_direction 구간 순서로(구간 안 순서는 PLAN_PART_SECTIONS)
    const ORDER = Array.isArray(brief?.plan_direction) && brief.plan_direction.length ? SECTION_ORDER_V3 : SECTION_ORDER_V2;
    for (const t of ORDER) {
      if (t === "options") { const rows = (copy.options_table || []).filter((r) => S(r?.name) || S(r?.size)).map((r) => ({ name: S(r.name), size: S(r.size) })); if (isEditorial && rows.length) { const oc = cut.find((im) => im !== hero && im !== cpImg); out.push({ type: "options", label: `[${S(copy.name_ko)}]`, headline: S(copy.sub), options_table: rows, notes: [], cutout: oc ? cutoutPath(oc) : null, cutout_bbox: null }); } continue; } // checkpoint·hero 와 다른 누끼
      if (t === "keywords") { const items = (copy.keywords || []).filter((k) => S(k?.en) && S(k?.ko)).map((k) => ({ en: S(k.en), en_sub: S(k.en_sub), ko: S(k.ko) })); if (isEditorial && items.length) out.push({ type: "keywords", items }); continue; }
      if (t === "checkpoint") { if (isEditorial && cpImg && callouts.length >= 3) out.push({ type: "checkpoint", title: "CHECK POINT", cutout: cutoutPath(cpImg), cutout_bbox: null, callouts }); continue; }
      if (t === "foryou") { const items = (copy.for_you || []).map(S).filter(Boolean); if (isEditorial && items.length) out.push({ type: "foryou", title: "FOR\nYOU.", items }); continue; }
      if (t === "point") {
        // feature 사진이 모자라면 아직 안 쓴 AI 장면 사진으로 카피 points 를 마저 채운다(장면 1순위)
        if (isEditorial) { const usedS = new Set(secs.flatMap((x) => [x.image, ...(x.items || []).map((i) => i?.image)]).filter(Boolean)); const spareS = pointScenes.filter((sc) => !usedS.has(sc.file) || secs.some((x) => x.type === "usp" && (x.items || []).some((i) => i.image === sc.file))); const featFiles = new Set(featSecs.map((f) => f.image));
          for (let i = featSecs.length; i < (copy.points || []).length; i++) { const sc = spareS.find((x) => !featFiles.has(x.file)); if (!sc) break; featFiles.add(sc.file); featSecs.push({ type: "feature", image: sc.file, title: "", desc: "", overlay: [], imageId: sc.id, scene: true }); } }
        // editorial: 포인트 사진은 장면 생성본 > 비전 score≥4 이고 제품이 보이는(subject product/product_in_scene) 사진만, 최대 4개
        if (isEditorial) { const strongIds = (f) => f.scene || isStrong(images.find((x) => x.id === f.imageId)); const keep = featSecs.filter(strongIds).slice(0, Math.min(MAX_POINTS_EDITORIAL, Math.max(1, (copy.points || []).length || MAX_POINTS_EDITORIAL))); featSecs.length = 0; featSecs.push(...keep); }
        if (isEditorial && featSecs.length) featSecs.forEach((f, i) => { const pt = copy.points?.[i] || {}; out.push({ type: "point", no: i + 1, label: S(pt.label) || S(copy.keywords?.[i]?.ko) || `POINT ${String(i + 1).padStart(2, "0")}`, image: f.image, title: S(pt.title) || f.title, desc: S(pt.desc) || f.desc, overlay: f.overlay, imageId: f.imageId, w: f.w, h: f.h, ...(f.scene ? { scene: true } : {}) }); }); continue; }
      if (t === "feature") { if (!isEditorial || !featSecs.length) out.push(...featSecs); continue; }
      if (t === "gallery") { if (by.gallery) { const imgs = isEditorial ? by.gallery.images.filter((p) => { const k = photoKey(p); return isStrong(images.find((x) => x.id === k.id)); }).slice(0, MAX_GALLERY_EDITORIAL) : by.gallery.images; if (imgs.length) out.push({ ...by.gallery, images: imgs }); } continue; }
      if (t === "problem") { if (by.pain) out.push({ ...by.pain, type: "problem" }); continue; }
      if (t === "benefits") { if (by.usp) out.push({ ...by.usp, type: "benefits", chain_check: S(copy.chain_check) }); continue; }
      if (t === "feature") { out.push(...secs.filter((x) => x.type === "feature")); continue; }
      if (t === "agitate") { if (S(copy.agitate)) out.push({ type: "agitate", text: S(copy.agitate) }); continue; }
      if (t === "solution") { if (S(copy.solution?.text)) out.push({ type: "solution", text: S(copy.solution.text), angle: S(copy.solution?.angle), image: cutPaths[0] || null }); continue; }
      if (t === "proof") { const items = (copy.proof || []).filter((p) => S(p?.value) && S(p?.unit)).map((p) => ({ value: S(p.value), unit: S(p.unit), label: S(p.label) })); if (items.length) out.push({ type: "proof", items, image: cutPaths[0] || null }); continue; }
      if (t === "compare") { const rows = (copy.compare?.rows || []).filter((r) => S(r?.item) && S(r?.ours)).map((r) => ({ item: S(r.item), generic: S(r.generic), ours: S(r.ours) })); if (rows.length) out.push({ type: "compare", rows, image: cutPaths[1] || cutPaths[0] || null }); continue; }
      if (t === "steps") { const items = (copy.steps || []).filter((x) => S(x?.title)).map((x) => ({ title: S(x.title), desc: S(x.desc) })); if (items.length) out.push({ type: "steps", items }); continue; }
      if (t === "objections") { const items = (copy.objections || []).filter((o) => S(o?.q) && S(o?.a)).map((o) => ({ q: S(o.q), a: S(o.a) })); if (items.length) out.push({ type: "objections", items }); continue; }
      if (t === "trust") { const items = (copy.trust?.items || []).map(S).filter(Boolean); if (items.length) out.push({ type: "trust", items }); continue; }
      if (t === "size") { if (by.size) out.push({ ...by.size, image: cutPaths.find((p) => p) || null, overlay: [] }); continue; } // v2: 사이즈 섹션 이미지는 상품 단독 누끼(product_only)만, 없으면 글만
      if (by[t]) out.push(by[t]);
    }
    return out;
  };
  let sections = toV2(assemble(featureSecs, overflow));
  // ── 길이 조정: 예상 높이가 MAX_PAGE_H 를 넘으면 feature 를 뒤에서부터 gallery(중국어가 남았으면 버림)로 옮긴다
  while (estimateHeight({ sections }) > LIM.maxPageH && featureSecs.length) {
    const lastId = featureSecs[featureSecs.length - 1].imageId;
    featureSecs = featureSecs.filter((f) => f.imageId !== lastId);
    overflow.push(lastId); overflow.sort((a, b) => featIds.indexOf(a) - featIds.indexOf(b)); // 페이지 순서 유지
    sections = toV2(assemble(featureSecs, overflow));
  }
  const galleryOkId = (id) => { const im = images.find((x) => x.id === id); return im && keptCJK(im) === 0 && !flat(im) && !lowCoverage(im) && !visionBad(im); };
  // ── 한 사진은 페이지 전체에서 1회만(같은 원본의 크롭·누끼 포함)
  let duplicates = [];
  { const d = dedupePhotos(sections); sections = d.sections; duplicates = d.removed; } // 중복으로 뺀 자리(사진은 다른 섹션에 쓰였으므로 dropped 아님)
  const toGallery = overflow.filter(galleryOkId).slice(0, LIM.maxOverflow);
  for (const id of overflow) if (!toGallery.includes(id)) { const im = images.find((x) => x.id === id); dropped.push({ id, why: keptCJK(im) > 0 ? "kept" : flat(im) ? "flat" : "overflow" }); }
  // gallery 로 간 긴 이미지는 첫 조각만, 버린 이미지는 자르지 않는다. 섹션 이미지로 쓰인 조각은 남긴다
  const usedOut = new Set(sections.flatMap((s) => [s.image, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean));
  const cutsOut = cuts.filter((c) => usedOut.has(c.out));

  return {
    meta: { ...(Array.isArray(brief?.plan_direction) ? { plan_direction: brief.plan_direction } : {}), jobId: S(jobId || source.jobId), templateId: TEMPLATES.includes(templateId) ? templateId : DEFAULT_TEMPLATE, width: 780, createdAt: now, version: isV2 ? 2 : 1 },
    product: { name_ko: S(copy.name_ko), keyword: S(copyInput?.keyword || source.keyword) },
    ...(sceneList.length ? { scenes: sceneList.map((x) => ({ id: x.id, file: x.file, purpose: x.purpose })) } : {}),
    sections, cuts: cutsOut, dropped, duplicates, estimatedHeight: estimateHeight({ sections }),
  };
}

// 섹션 타입별 대략 높이(px, 가로 780 기준) — 템플릿(A4)과 맞춘 추정치. 슬라이스 합이 20,000px 을 넘지 않게 하는 용도
export function estimateHeight(plan) {
  let total = 0;
  const imgH = (s) => (s?.image && s.w > 0 && s.h > 0 ? Math.round(s.h * (PAGE_W / s.w)) : 0);
  for (const s of plan?.sections || []) {
    switch (s.type) {
      case "hero": total += 1000; break;
      case "pain": total += 700; break;
      case "usp": total += 900 + 600 * (s.items || []).filter((it) => it.image).length; break;
      case "feature": total += imgH(s) + 260; break;
      case "gallery": total += Math.ceil((s.images || []).length / (s.cols || 2)) * 520; break;
      case "spec": total += 120 + 70 * (s.rows || []).length + imgH(s); break;
      case "size": total += imgH(s) + 200; break;
      case "package": total += 400; break;
      case "notice": total += 500; break;
      case "faq": total += 220 * (s.items || []).length; break;
      case "cta": total += 600; break;
      case "problem": total += 700; break;
      case "agitate": total += 400; break;
      case "solution": total += 500 + (s.image ? 500 : 0); break;
      case "benefits": total += 900 + 600 * (s.items || []).filter((it) => it.image).length; break;
      case "proof": total += 500 + (s.image ? 500 : 0); break;
      case "compare": total += 200 + 90 * (s.rows || []).length + (s.image ? 400 : 0); break;
      case "steps": total += 200 + 220 * (s.items || []).length; break;
      case "objections": total += 220 * (s.items || []).length; break;
      case "trust": total += 150 + 110 * (s.items || []).length; break;
      default: total += 300;
    }
  }
  return total;
}

// ─────────────────────────────── v5: 섹션 목록 먼저 → 섹션마다 장면 1장 + 짧은 글 (Moast 2단계 구조, card 템플릿) ───────────────────────────────
// planSectionsV5 → [{ id, type, part, shot:{ type, needs, textZone }, copy:{…필드 자리} }] (기획 방향 6구간 순서)
// buildPlanV5 → card 템플릿 PagePlan(meta.version 5). 섹션 사진 = 그 섹션용 생성 장면 → 없으면 비전 상위 사진 → 없으면 글만 카드(textOnly, 제품 그림 없음)
const PLACE_WORDS = ["홈카페", "오피스 탕비실", "주방", "탕비실", "사무실", "데스크", "책상", "바 카운터", "베란다", "발코니", "욕실", "세탁실", "거실", "침실", "드레스룸", "현관", "원룸", "캠핑", "차량", "아이방", "작업실", "카페", "매장", "신발장", "다용도실"];
const PLACE_DEFAULTS = [[/주방|커피|조리|식기|토스터|홈카페/, ["홈카페", "오피스 탕비실", "데스크", "바 카운터"]], [/빨래|건조|세탁|옷걸이/, ["베란다", "욕실", "세탁실", "원룸"]], [/화분|식물|선반/, ["거실 창가", "베란다", "현관", "작업실"]], [/수납|정리|바구니/, ["드레스룸", "거실", "아이방", "다용도실"]]];
// 상품에 어울리지 않는 장소(주방 수납장에 욕실·침실 등)
export const PLACE_UNFIT = [
  [/주방|커피|홈카페|조리|토스터|식기|양념|컵|원두|전자레인지|밥솥/, /욕실|화장실|침실|드레스룸|현관|신발장|세탁실|베란다|발코니|아이방|차량|캠핑/],
  [/빨래|건조대|세탁|옷걸이|행거/, /주방|탕비실|카페|홈카페|바 카운터|데스크|책상|사무실|매장/],
  [/욕실|샤워|수건|세면/, /주방|탕비실|카페|홈카페|바 카운터|데스크|책상|사무실|침실/],
];
export function placeFits(place, brief = {}) {
  const key = `${S(brief.product_type)} ${S(brief.product_name_ko)} ${S(brief.key_appeal)}`;
  const rule = PLACE_UNFIT.find(([re]) => re.test(key));
  return !rule || !rule[1].test(S(place));
}
export function placesFrom(brief = {}, n = 4) {
  const txt = [brief.key_appeal, brief.product_type, ...(brief.advantages || []), ...(brief.targets || []), ...((brief.plan_direction || []).map((p) => p.text))].map(S).join(" ");
  const SAME = [["데스크", "책상"], ["베란다", "발코니"], ["카페", "홈카페"]];
  const found = PLACE_WORDS.filter((w) => txt.includes(w)).filter((w, _, arr) => !SAME.some(([a, b]) => w === b && arr.includes(a)) && !(w === "카페" && arr.includes("홈카페"))); // 같은 뜻 장소는 하나만
  const def = (PLACE_DEFAULTS.find(([re]) => re.test(txt))?.[1]) || ["거실", "주방", "사무실", "원룸"];
  return [...new Set([...found, ...def])].filter((p) => placeFits(p, brief)).slice(0, n);
}
// 규격 옵션 2종 이상(스펙의 "낮은형: 높이 …" 같은 줄 또는 options 이름에 치수)
export const normalizeSizeName = (k) => SIZE_NAME(k);
const SIZE_NAME = (k) => S(k).replace(/\s*(크기|사이즈|규격|치수)$/, "").replace(/\s*(타입|버전|모델)$/, " 스타일").replace(/^하이|^높은/, "높은").replace(/^짧은|^로우|^낮은/, "낮은").replace(/\s*스타일$/, "형").replace(/\s+형$/, "형");
const DIM = /\d+(?:\.\d+)?\s*(?:cm|mm|㎝|㎜)|\d+(?:\.\d+)?\s*[x×*]\s*\d+/i;
// 규격 2종 이상: 기획서 스펙(키에 형·스타일·규격·사이즈·크기·款) → SKU 옵션 이름 → 이미지별 글(번역)의 "OO형 … 치수" 줄
export function sizeOptionsFrom(brief = {}, options = [], texts = []) {
  const rows = [];
  const push = (name, size) => { name = SIZE_NAME(name); if (name && size && !rows.some((r) => r.name === name)) rows.push({ name, size: S(size) }); };
  for (const sp of brief.specs || []) if (/형$|형\s|스타일|규격|사이즈|크기|款|옵션/.test(S(sp.k)) && DIM.test(S(sp.v)) && !/무게|하중|중량/.test(S(sp.k))) push(sp.k, sp.v);
  for (const o of options || []) { const l = S(o.label_ko || o.label || o); const d = l.match(new RegExp(`${DIM.source}.*`, "i")); if (d) push(l.slice(0, d.index).trim() || l, d[0]); }
  for (const t of texts || []) { const m = S(t).match(/([가-힣A-Za-z]{1,6}(?:형|타입|款|型))\s*[:：]?\s*(.*)/); if (m && DIM.test(m[2])) push(m[1], m[2]); }
  return rows.length >= 2 ? rows.slice(0, 4) : [];
}
// texts: 이미지별 OCR 번역 줄(규격 찾기용), prev: 이전 섹션 목록(같은 타입·순번이면 id 유지 — 이미 만든 장면 파일이 섹션 id 에 묶여 있으므로)
// ── 스펙 행 정리(사실 오류 방지): 판매에 의미 없는 중국식 속성 키 제외, 색상 행은 SKU 옵션·대표 사진 색과 맞춰 본다
export const MEANINGLESS_SPEC_KEY = /^(스타일|디자인\s*스타일|적용\s*(인원|대상|장면|연령|계절|공간)|출처|원산지|수입\s*(여부)?|크로스보더|국경\s*간|모델|품번|패턴|유행|트렌드|대상\s*성별|성별|판매\s*(지역|단위)|가공\s*(방식|여부)|전용\s*여부|공급\s*유형|상품\s*유형|제품\s*카테고리|카테고리|브랜드|상표|품명|제품명)$/;
const COLOR_FAMILY = [["white", /흰|화이트|백색|하얀|아이보리|미색|白|米白/i], ["black", /검은|검정|블랙|흑색|黑|차콜|다크\s*그레이/i], ["gray", /회색|그레이|灰/i], ["wood", /원목|우드|나무색|木/i]];
const colorFamily = (t) => (COLOR_FAMILY.find(([, re]) => re.test(S(t))) || [null])[0];
const lumOf = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(S(hex)); if (!m) return null; const n = parseInt(m[1], 16); return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; };
// 대표 사진의 제품 색: 비전 shows 투표(쓸 수 있는 사진) → 팔레트 dark 표시 → 없으면 null
export function productColorFamily({ vision = null, palette = null } = {}) {
  const votes = {};
  for (const v of (Array.isArray(vision) ? vision : vision?.items || [])) if (v && v.usable !== false) { const f = colorFamily(v.shows); if (f) votes[f] = (votes[f] || 0) + 1 + ((Number(v.score) || 0) >= 4 ? 1 : 0); }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 2) return best[0];
  // 제품(누끼) 팔레트: dark 표시 또는 상위 3색 평균 밝기로 흰/검정만 판단(애매하면 null)
  if (palette?.dark === true) return "black";
  const ls = (palette?.dominant || []).slice(0, 3).map(lumOf).filter((x) => x != null);
  if (ls.length) { const avg = ls.reduce((a, b) => a + b, 0) / ls.length; if (avg > 0.78) return "white"; if (avg < 0.25) return "black"; }
  return null;
}
export function cleanSpecRows(rows = [], { options = [], vision = null, palette = null } = {}) {
  const cautions = [];
  const colorOpts = [...new Set((options || []).map((o) => S(o.label_ko || o.label || o)).filter((l) => colorFamily(l)).map(colorFamily))];
  const prodColor = productColorFamily({ vision, palette });
  const out = [];
  for (const r of rows || []) {
    const k = S(r.k), v = S(r.v);
    if (!k || !v || MEANINGLESS_SPEC_KEY.test(k) || BRAND_ROW_RE.test(k)) continue;
    if (/^(짧은|하이|로우|높은|낮은)\s*스타일\s*(크기|사이즈)?$/.test(k)) { out.push({ k: `${normalizeSizeName(k)} 크기`, v }); continue; } // "짧은 스타일 크기" → "낮은형 크기"
    if (/색상|컬러|颜色|색깔/.test(k)) {
      if (colorOpts.length >= 2) { out.push({ k, v: "옵션 선택" }); continue; }
      const f = colorFamily(v);
      if (f && prodColor && f !== prodColor && !(f === "gray" || prodColor === "gray")) { cautions.push(`속성표 색상(${v})이 대표 사진 색과 달라 표기하지 않음 — 실제 색상은 사진·옵션으로 확인`); continue; }
    }
    out.push({ k, v });
  }
  return { rows: out, cautions };
}

// reference(선택): reference.json — 섹션 순서를 레퍼런스대로(reference-core applyReferenceOrder), 섹션마다 sec.ref{ role, angle, layout, kicker }
export function planSectionsV5({ brief = {}, styleGuide = null, vision = null, options = [], texts = [], prev = null, productPalette = null, reference = null } = {}) {
  const adv = (brief.advantages || []).map(S).filter(Boolean);
  const pd = Object.fromEntries((brief.plan_direction || []).map((p) => [p.part, S(p.text)]));
  const zone = (z) => z; // top|bottom|left|right|none — 글자 얹을 여백
  const secs = [];
  const add = (type, part, shot, copy = {}) => secs.push({ id: `v5-${String(secs.length + 1).padStart(2, "0")}-${type}`, type, part, shot: shot ? { ...shot, type: shot.type || type, needs: S(shot.needs), textZone: zone(shot.textZone || "none") } : null, copy });
  add("hero", "첫 화면", { needs: pd["첫 화면"] || `${S(brief.product_type)}을(를) 실제 공간에 둔 대표 장면, 제품이 크게`, textZone: "top" }, { label: "", sub: "", category: "", name: "", icons: [] });
  add("problem", "초반", null, { question: "", sub: "" }); // 문제 제기: 질문 한 줄(어두운 섹션) → 다음 섹션이 해결
  add("before_after", "초반", { type: "before_after", needs: `정리 전(어수선) vs 사용 후(정돈) 같은 공간 두 컷 — ${S(pd["초반"])}`, textZone: "top" }, { sub: "", title: "" });
  add("checkpoint", "중반", { type: "product_studio", needs: "제품 단독 정면 3/4, 부품이 잘 보이게(지시선 자리 여백)", textZone: "none" }, { title: "", callouts: [] });
  adv.slice(0, 3).forEach((a, i) => add("feature", "중반", { needs: `이 장점을 보여 주는 장면: ${a}`, textZone: "bottom" }, { title: "", desc: "", advantage: a }));
  for (let i = adv.length; i < 3; i++) add("feature", "중반", { needs: "제품을 실제로 쓰는 손 클로즈업", textZone: "bottom" }, { title: "", desc: "" });
  const sizes = sizeOptionsFrom(brief, options, texts);
  if (sizes.length) add("options", "후반", { type: "options_side_by_side", needs: `규격 ${sizes.map((r) => r.name).join("·")}를 같은 배경에 나란히`, textZone: "top" }, { title: "", rows: sizes });
  add("detail", "디테일", { type: "detail_macro", needs: pd["디테일"] || "소재 마감·부품 매크로 클로즈업 2컷", textZone: "bottom" }, { title: "", items: [] });
  { const pl = placesFrom(brief); add("versatility", "후반", { type: "versatility_grid", needs: `활용 장소 4곳: ${pl.join(" / ")}`, textZone: "top", places: pl }, { title: "", sub: "", items: pl.map((p) => ({ label: p })) }); }
  // 제품 색 판단용 팔레트: A2 누끼 팔레트(styleGuide.productPalette 또는 palette 인자) — styleGuide.palette 는 배경 톤이 섞여 쓰지 않는다
  const spec = cleanSpecRows(brief.specs || [], { options, vision, palette: productPalette || styleGuide?.productPalette || null });
  add("notice", "마지막", null, { title: "", items: [], internal: spec.cautions }); // 색상 불일치 등은 내부 메모(고객 문구 아님) → plan.internalNotes
  add("spec", "마지막", null, { rows: spec.rows });
  if (secs.length < 12) add("faq", "마지막", null, { items: [] }); // 9~11개 — 규격 비교가 있으면 FAQ 는 뺀다(주의·스펙으로 충분)
  if (styleGuide?.forbiddenProductUsage) for (const s of secs) if (s.shot) s.shot.rule = S(styleGuide.forbiddenProductUsage);
  void vision;
  if (Array.isArray(prev?.sections || prev)) { // 같은 타입의 k번째 섹션은 이전 id 를 그대로(새로 생긴 섹션은 v5-<type>)
    const old = prev.sections || prev, cnt = {};
    for (const sec of secs) { const k = (cnt[sec.type] = (cnt[sec.type] || 0) + 1); const o = old.filter((x) => x.type === sec.type)[k - 1]; sec.id = o ? o.id : `v5-${sec.type}${k > 1 ? `-${k}` : ""}`; }
  }
  if (reference?.sections?.length) { const r = applyReferenceOrder(secs, reference, { keepExtra: !!reference.keepExtra }); r.sections.refDropped = r.dropped; r.sections.refRemoved = r.removed; return r.sections; } // 벤치마킹: 레퍼런스 순서·각도
  return secs;
}

// sections: planSectionsV5 결과, copy: copy.js v5 결과(섹션 id → 글), scenes: 장면 생성 결과(items[{ section|sectionId|purpose, file, pass, human }])
// 체크포인트 라벨(카피) ↔ 비전 지점(callout_points[{x,y,part|label}]) 매칭: 부품 이름이 겹치면 그 점, 아니면 남은 점을 순서대로
export function matchCallouts(callouts = [], points = []) {
  const pts = (points || []).map((p) => ({ x: Math.min(1, Math.max(0, Number(p.x) || 0)), y: Math.min(1, Math.max(0, Number(p.y) || 0)), part: S(p.part || p.label) }));
  const used = new Set();
  const score = (a, b) => { a = S(a).replace(/\s/g, ""); b = S(b).replace(/\s/g, ""); if (!a || !b) return 0; if (a.includes(b) || b.includes(a)) return 10; let n = 0; for (let i = 0; i + 1 < b.length; i++) if (a.includes(b.slice(i, i + 2))) n++; return n; };
  const out = callouts.map((c) => {
    const key = `${S(c.bold)} ${S(c.label)}`;
    let best = -1, bs = 0; pts.forEach((p, i) => { if (used.has(i)) return; const sc = score(key, p.part); if (sc > bs) { bs = sc; best = i; } });
    if (best >= 0) { used.add(best); return { ...c, x: pts[best].x, y: pts[best].y, part: pts[best].part }; }
    return { ...c };
  });
  // 이름이 안 맞는 라벨은 남은 점에 억지로 붙이지 않는다 — 그 점의 실제 부품 이름(비전)을 라벨로 쓴다(지시선이 엉뚱한 곳을 가리키지 않게)
  const rest = pts.map((p, k) => ({ p, k })).filter(({ k }) => !used.has(k));
  const matched = out.filter((c) => c.x != null);
  for (const { p } of rest) matched.push({ label: p.part, thin: "", bold: p.part, x: p.x, y: p.y, part: p.part, fromVision: true });
  return matched;
}
// 지시선 점이 제품 영역 밖이면: 가장자리에서 snap 이내면 안쪽으로 당기고, 더 멀면 버린다(빈 배경을 가리키지 않게)
export function fitCalloutsToBox(callouts = [], box = null, { snap = 0.06, inset = 0.01 } = {}) {
  if (!box || !(box.w > 0) || !(box.h > 0)) return callouts;
  const x0 = box.x + inset, x1 = box.x + box.w - inset, y0 = box.y + inset, y1 = box.y + box.h - inset;
  return callouts.map((c) => {
    const dx = c.x < x0 ? x0 - c.x : c.x > x1 ? c.x - x1 : 0, dy = c.y < y0 ? y0 - c.y : c.y > y1 ? c.y - y1 : 0;
    if (!dx && !dy) return c;
    if (dx <= snap && dy <= snap) return { ...c, x: Math.min(x1, Math.max(x0, c.x)), y: Math.min(y1, Math.max(y0, c.y)), snapped: true };
    return null;
  }).filter(Boolean);
}
// calloutPoints(선택): { [섹션 id 또는 장면 파일]: [{x,y,part}] } — 체크포인트 장면에 대한 비전 결과
// sceneScope: "mood"(기본) = 생성 장면은 연출 섹션(hero·before_after·versatility)에만, "all" = 모든 섹션 1순위
// localized: A2 localizeImage 결과 [{ id, out, dims? }] — options·size 는 치수 숫자가 있는 실제 도면·옵션 이미지(한글화본)가 1순위
// ocr: 치수 이미지 판정용(localized[].dims 가 없을 때)
export const MOOD_SECTIONS = ["hero", "before_after", "versatility"];
export function buildPlanV5({ sections = [], copy = {}, scenes = null, vision = null, cleaned = [], source = {}, jobId = "", now = Date.now(), templateId = "card", calloutPoints = null, sceneScope = "mood", localized = null, ocr = null, claims = null, productBoxes = null } = {}) {
  const S2 = (v) => (v == null ? "" : String(v)).trim();
  const vItems = (Array.isArray(vision) ? vision : vision?.items || []);
  const cleanById = new Map((cleaned || []).map((c) => [c.id, c]));
  const photoPath = (id) => { const c = cleanById.get(id); return c?.photo?.file ? relPath(c.photo.file) : c?.out ? relPath(c.out) : null; };
  const goodV0 = vItems.filter((v) => v.usable !== false && v.role !== "skip" && (Number(v.score) || 0) >= 4 && ["product", "product_in_scene"].includes(v.subject) && !(v.has_text && v.text_pos === "center") && (!cleanById.size || photoPath(v.id)))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const goodV = rankByProduct(goodV0); // 상품이 잘리지 않고 보이는 사진 먼저(없으면 크게 보이는 부분 사진), 안 보이면 제외
  const vById5 = new Map(vItems.map((v) => [v.id, v]));
  const allScenes = (Array.isArray(scenes) ? scenes : scenes?.items || []).filter((x) => x && x.file);
  const CHECK_KEYS = ["product_visible", "product_bbox", "other_brand_prominent", "any_logo_visible", "callout_points"];
  // 같은 파일의 다른 항목(재검수로 id 가 달라진 경우)에 있는 검수 결과를 빌려 온다
  const sceneItems = allScenes.filter((x) => x.pass !== false && x.human !== "reject").map((x) => { const latest = x.any_logo_visible == null ? allScenes.find((y) => y !== x && y.file === x.file && y.any_logo_visible != null) : null; // 같은 파일의 최신 검수(로고 검사까지 한 것)를 우선
    if (latest) { const add = {}; for (const k of CHECK_KEYS) if (latest[k] != null) add[k] = latest[k]; return { ...x, ...add }; }
    const add = {}; for (const k of CHECK_KEYS) if (x[k] == null) { const twin = allScenes.find((y) => y !== x && y.file === x.file && y[k] != null); if (twin) add[k] = twin[k]; } return Object.keys(add).length ? { ...x, ...add } : x; });
  const usedVision = new Set();
  // 치수가 그려진 실제 이미지(한글화본) — options·size 1순위
  const ocrById = new Map((ocr?.images || []).map((o) => [o.id, o]));
  const dimCount = (id) => (ocrById.get(id)?.boxes || []).reduce((n, b) => n + ((S(b.text_ko || b.text).match(/\d+(?:\.\d+)?\s*(?:cm|mm|㎝|㎜|厘米)/gi) || []).length), 0);
  const locList = (Array.isArray(localized) ? localized : localized?.images || []).filter((x) => x && x.id && (x.out || x.file) && !x.promo);
  const dimImages = locList.filter((x) => x.dims === true || (x.dims == null && dimCount(x.id) >= 2)).map((x) => ({ id: x.id, path: relPath(x.out || x.file) }));
  const usedLoc = new Set();
  // SKU 그림(+label): 같은 대표 사진(sameAs)을 가리키는 것은 하나만 — options 섹션 1순위
  const skuSeen = new Set();
  const skus = (source.images || []).filter((im) => nk(im.kind) === "sku").filter((im) => { const k = im.sameAs || im.id; if (skuSeen.has(k)) return false; skuSeen.add(k); return true; })
    .map((im) => ({ id: im.id, label: S(im.label || im.label_ko || im.label_zh), image: photoPath(im.sameAs || im.id) || photoPath(im.id) || (im.file ? relPath(im.file, "raw") : null) })).filter((x) => x.image && x.label);
  // 실제 제품 썸네일(main=gallery, 글자 없음, 제품 단독) — checkpoint·feature 후보
  const srcKind = new Map((source.images || []).map((im) => [im.id, im.kind]));
  const mainThumbs = rankByProduct(vItems.filter((v) => nk(srcKind.get(v.id)) === "main" && v.usable !== false && !v.has_text && v.subject === "product" && photoPath(v.id) && pointGrade(v)).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)));
  const internalNotes = []; // 확인 화면·로그 전용(고객 문구 아님)
  const out = [];
  const byId = (id) => copy?.sections?.[id] || copy?.[id] || {};
  for (const sec of sections) {
    const c = { ...(sec.copy || {}), ...byId(sec.id) };
    // 생성 장면도 같은 규칙: 상품이 안 보이면 제외, hero 는 다른 브랜드가 두드러지면 제외, full 먼저(장면 검수에 product_visible 이 없으면 판단 안 함)
    const sc = rankByProduct(sceneItems.filter((x) => (x.section || x.sectionId) === sec.id).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)), { heroUse: sec.type === "hero" });
    let image = null, images = [], from = null;
    if (sec.shot) {
      // 생성 장면은 연출 섹션에만(정확성). 단 feature 는 장면 검수에서 상품 전체·무브랜드·무로고로 확인된 장면이면 1순위
      const verifiedScene = ["feature", "detail"].includes(sec.type) ? sc.find((x) => x.product_visible === "full" && x.other_brand_prominent === false && x.any_logo_visible === false && x.human !== "logo") : null;
      const sceneOk = sceneScope === "all" || MOOD_SECTIONS.includes(sec.type);
      if (verifiedScene && !sceneOk) { if (sec.type === "detail") images = [verifiedScene.file]; else image = verifiedScene.file; from = "scene"; const f = focusOf(verifiedScene); if (f) c.focus = f; }
      if (sec.type === "options" && skus.length >= 2) { images = skus.slice(0, 4).map((x) => x.image); c.skus = skus.slice(0, 4).map((x) => ({ id: x.id, label: x.label, image: x.image })); from = "sku"; }
      if (["options", "size"].includes(sec.type) && !images.length) { const d = dimImages.find((x) => !usedLoc.has(x.id)); if (d) { usedLoc.add(d.id); image = d.path; from = "localized"; } }
      if (!image && sceneOk) {
        if (sec.type === "detail" || sec.type === "before_after") { images = sc.slice(0, 2).map((x) => x.file); if (images.length) from = "scene"; }
        else if (sc[0]) { image = sc[0].file; from = "scene"; const f = focusOf(sc[0]); if (f) c.focus = f; }
      }
      if (!image && !images.length && ["checkpoint", "feature"].includes(sec.type)) { const t = mainThumbs.find((v) => !usedVision.has(v.id)); if (t) { usedVision.add(t.id); image = photoPath(t.id); from = "main"; sec._picked = t.id; } }
      if (!image && !images.length && sec.type !== "before_after") { // 비전 상위 사진(같은 사진 두 번 안 씀). before_after 는 같은 공간 두 컷이 필요해 기존 사진으로 대체하지 않는다
        const want = sec.type === "detail" ? 2 : 1;
        const pool = sec.type === "hero" ? rankByProduct(goodV, { heroUse: true }) : goodV;
        const pick = pool.filter((v) => !usedVision.has(v.id) && (sec.type !== "checkpoint" || v.subject === "product") && (!["hero", "feature", "checkpoint"].includes(sec.type) || (productShown(v) && pointGrade(v))) && (sec.type !== "hero" || !v.any_logo_visible)).slice(0, want);
        pick.forEach((v) => usedVision.add(v.id)); if (pick[0]) sec._picked = pick[0].id;
        const paths = pick.map((v) => photoPath(v.id)).filter(Boolean);
        if (sec.type === "detail") images = paths; else image = paths[0] || null;
        if (paths.length) from = "photo";
      }
    }
    if (image && sec._picked && vById5.get(sec._picked)) { const f = focusOf(vById5.get(sec._picked)); if (f) c.focus = f; } // 상품 영역 → A4 object-position
    const textOnly = !!sec.shot && !image && !images.length; // 사진 없는 섹션 → 글만 카드(제품 그림 생성 금지)
    if (sec.type === "checkpoint" && image) { // 지시선 좌표: 장면/사진에 대한 비전 지점과 라벨 매칭(좌표 없는 라벨은 뺀다)
      const vPts = calloutPoints?.[sec.id] || calloutPoints?.[image] || sc[0]?.callout_points || vItems.find((v) => photoPath(v.id) === image)?.callout_points || [];
      // 제품 영역: A2 누끼 bbox(productBoxes) → 비전 product_bbox → 장면 bbox
      const pid = sec._picked || vItems.find((v) => photoPath(v.id) === image)?.id;
      const box = (pid && productBoxes?.[pid]) || vById5.get(pid)?.product_bbox || sc[0]?.product_bbox || null;
      const m = fitCalloutsToBox(matchCallouts(c.callouts || [], vPts), box);
      if (m.length < (c.callouts || []).length) internalNotes.push(`${sec.id}: 제품 영역 밖 지시선 ${(c.callouts || []).length - m.length}개 제외`);
      c.callouts = m.length >= 3 ? m : [];
    }
    if (sec.type === "checkpoint" && (!image || !(c.callouts || []).length)) { if (sec._picked) usedVision.delete(sec._picked); delete sec._picked; continue; } // 지시선은 제품 사진 위, 좌표가 있을 때만(못 쓰면 사진을 다른 섹션에 돌려준다)
    delete sec._picked;
    if (sec.type === "spec" && !(c.rows || []).length) continue;
    if (sec.type === "problem" && !S2(c.question)) continue;
    if (["notice", "faq"].includes(sec.type) && !(c.items || []).length) { for (const n of sec.copy?.internal || []) if (!internalNotes.includes(n)) internalNotes.push(n); continue; }
    const base = { type: sec.type, id: sec.id, part: sec.part, ...(image ? { image } : {}), ...(images.length ? { images } : {}), ...(from ? { from } : {}), ...(textOnly ? { textOnly: true } : {}) };
    if (sec.type === "detail") { base.title = S2(c.title); base.items = (c.items || []).map((it, i) => ({ ...it, image: images[i] || null })); }
    else Object.assign(base, Object.fromEntries(Object.entries(c).filter(([k]) => !["advantage", "extra", "internal"].includes(k))));
    for (const n of sec.copy?.internal || []) if (!internalNotes.includes(n)) internalNotes.push(n);
    delete base.internal;
    if (sec.type === "spec") { base.rows = byId(sec.id).rows_edit || sec.copy?.rows || base.rows; delete base.rows_edit; } // 스펙 표: 셀러가 고친 행 → 정리된 행 → 카피
    out.push(base);
  }
  // 섹션 키커(알약): POINT n / CHECK POINT / Difference n / UPGRADE n / OPTION / DETAIL / USAGE
  let pn = 0, dn = 0, un = 0;
  const refK = refKickers(sections.filter((sec) => out.some((o) => o.id === sec.id))); const refKById = new Map(sections.filter((sec) => out.some((o) => o.id === sec.id)).map((sec, i) => [sec.id, refK[i]]));
  for (const s of out) {
    if (refKById.get(s.id)) { s.kicker = refKById.get(s.id); continue; } // 벤치마킹: 레퍼런스 키커 낱말(POINT n / Difference n …)
    const t = `${S2(s.title)} ${(s.title_lines || []).join(" ")}`;
    if (s.type === "feature") s.kicker = /업그레이드|신형|개선/.test(t) ? `UPGRADE ${++un}` : `POINT ${++pn}`;
    else if (s.type === "checkpoint") s.kicker = "CHECK POINT";
    else if (s.type === "before_after") s.kicker = `Difference ${++dn}`;
    else if (s.type === "options") s.kicker = "OPTION";
    else if (s.type === "detail") s.kicker = "DETAIL";
    else if (s.type === "versatility") s.kicker = "USAGE";
  }
  // 한 사진 1회(장면·사진 모두)
  const d = dedupePhotos(out);
  d.sections = insertClaimSections(d.sections, claims || copy?.claims || null); // 셀러가 입력한 신뢰 배지만(없으면 생략)
  const emphasis = budgetEmph(d.sections); // 강조 예산
  if (copy?.chain?.pairs && (copy.chain.weak || copy.chain.breaks?.length)) internalNotes.push(`소제목 징검다리 ${copy.chain.score}${copy.chain.breaks?.length ? ` · 끊김 ${copy.chain.breaks.join(", ")}` : ""} — 제목만 이어 읽기: ${copy.chain.line}`); // QA 표시용(고쳐 쓰지 않음)
  return { meta: { jobId: S2(jobId || source.jobId), templateId, width: 780, createdAt: now, version: 5 }, product: { name_ko: S2(copy?.name_ko) }, internalNotes, emphasis: emphasis.list, sections: d.sections, duplicates: d.removed, estimatedHeight: d.sections.length * 1300 };
}


// ─────────────────────────────── v6: 원본 한글화 모드 plan (localize 템플릿) ───────────────────────────────
// localized: copy.translateLayers 결과 { images:[{ id, promo, layers }], hero } + A2 localizeImage 파일(images[].out 또는 files[id])
// → { meta:{ version:6, templateId:"localize" }, sections:[ hero{image,label,sub,name}, image{id,image,layers}…(원래 순서, promo 제외), notice{items}, spec{rows} ], excluded:[{id,why}] }
export function buildLocalizePlan({ source = {}, localized = {}, copy = null, brief = null, cleaned = [], files = null, vision = null, jobId = "", now = Date.now(), options = [], claims = null } = {}) {
  const cleanById = new Map((cleaned || []).map((c) => [c.id, c]));
  const locById = new Map((localized.images || []).map((x) => [x.id, x]));
  const fileOf = (id) => { const f = files?.[id] || locById.get(id)?.out || locById.get(id)?.file; if (f) return relPath(f); const c = cleanById.get(id); return c?.out ? relPath(c.out) : null; };
  // hero 사진: 대표(main) 중 상품이 잘리지 않고 다른 브랜드가 두드러지지 않는 것(비전) → 없으면 첫 대표
  const vMap0 = new Map((Array.isArray(vision) ? vision : vision?.items || []).map((v) => [v.id, v]));
  const mains = (source.images || []).filter((im) => nk(im.kind) === "main");
  const heroPick = rankByProduct(mains.map((im) => ({ ...(vMap0.get(im.id) || {}), id: im.id })).filter((v) => v.usable !== false), { heroUse: true })[0];
  const order = [...(heroPick ? mains.filter((im) => im.id === heroPick.id) : mains.slice(0, 1)), ...(source.images || []).filter((im) => nk(im.kind) === "detail")];
  const excluded = [], sections = [];
  const vBad = new Set((Array.isArray(vision) ? vision : vision?.items || []).filter((v) => v.usable === false).map((v) => v.id));
  let heroDone = false;
  for (const im of order) {
    const loc = locById.get(im.id) || {};
    if (loc.promo) { excluded.push({ id: im.id, why: `홍보 이미지(${S(loc.promo_reason) || "인증·공장·맞춤제작"})` }); continue; }
    const img = fileOf(im.id); if (!img) { excluded.push({ id: im.id, why: "파일 없음" }); continue; }
    const layers = (loc.layers || []).filter((l) => !l.drop && S(l.ko)).map((l) => ({ ...(l.box || {}), x: l.x, y: l.y, w: l.w, h: l.h, role: l.role, ko: S(l.ko), emph: l.emph || [], rewrite_ok: l.rewrite_ok !== false, icon: l.icon === true, ...(l.style ? { style: l.style } : {}), ...(l.textBox ? { textBox: l.textBox } : {}) }));
    if (!heroDone && !vBad.has(im.id)) { heroDone = true; const f = focusOf(vMap0.get(im.id)); sections.push({ type: "hero", id: im.id, image: img, ...(localized.hero || {}), ...(f ? { focus: f } : {}) }); continue; }
    sections.push({ type: "image", id: im.id, image: img, layers });
  }
  const notice = (copy?.notice?.items || copy?.notice || []).map ? (Array.isArray(copy?.notice) ? copy.notice : copy?.notice?.items || []) : [];
  const spec = cleanSpecRows(brief?.specs || copy?.spec || [], { options, vision });
  if (notice.length) sections.push({ type: "notice", title: S(copy?.notice?.title) || "구매 전 확인해 주세요", items: notice.map(S).filter(Boolean) });
  if (spec.rows.length) sections.push({ type: "spec", rows: spec.rows });
  // 사진 속 타 브랜드 로고(가전 등)는 원본 사진 일부라 지우지 않지만, 확인 화면에 경고로 남긴다
  const vMap = new Map((Array.isArray(vision) ? vision : vision?.items || []).map((v) => [v.id, v]));
  const logoNotes = sections.filter((x) => x.id && vMap.get(x.id)?.has_logo).map((x) => `${x.id}: 사진 속 타 브랜드 로고 노출 가능(${S(vMap.get(x.id).shows) || "확인 필요"}) — 사람 확인 후 사용`);
  if (claims) { const h = sections.find((x) => x.type === "hero"); const top = S(claims.sold_out) || S(claims.rank) || (claims.trust_badges || [])[0]; if (h && top) { h.label = top; h.badges = claims.trust_badges || []; } }
  const withClaims = insertClaimSections(sections, claims); if (withClaims !== sections) sections.splice(0, sections.length, ...withClaims);
  const emphasis = budgetEmph(sections); // 강조 예산
  return { meta: { jobId: S(jobId || source.jobId), templateId: "localize", width: 780, createdAt: now, version: 6 }, product: { name_ko: S(brief?.product_name_ko || copy?.name_ko) }, sections, excluded, emphasis: emphasis.list, internalNotes: [...spec.cautions, ...logoNotes] };
}

// ─────────────────────────────── 강조 예산 (조잡함 방지) ───────────────────────────────
// hero 1개 + 섹션 3개당 최대 1개, 페이지 전체 최대 5개. 섹션당 1개, 제목급 글자에만(아이콘·작은 라벨·본문·사진 위 라벨 금지).
// 우선순위: 하중(kg) > 사이즈(cm·mm) > 다른 숫자 > 대표 이점. 종류는 bold·color 만, 특수(dot·underline·slant·pill)는 hero 에서만(페이지 0~1회).
export const EMPH_MAX_PAGE = 5;
const SPECIAL_KINDS = ["dot", "underline", "slant", "pill"];
export function emphScore(text, ctx = "") { const t = S(text), c = S(ctx); if (/\d\s*(kg|㎏)/i.test(t) && /무게|중량|제품\s*무게/.test(c)) return 2; if (/\d\s*(kg|㎏)/i.test(t)) return 5; if (/\d\s*(cm|mm|㎝|㎜)/i.test(t)) return 4; if (/\d/.test(t)) return 3; return 1; }
const plainKind = (e) => (/\d/.test(S(e.text)) ? "color" : "bold");
// mode "v8"(기본): 섹션당 최대 1개(비율 제한 없음), 종류는 line(둘째 줄 전체)·color(숫자 구절)만, 장식은 allowSpecial 일 때만
// mode "sparse": 예전 예산(hero 1 + 섹션 3개당 1, 페이지 최대 5)
export function budgetEmph(sections = [], { mode = "v8", allowSpecial = false } = {}) {
  const cand = [];
  let order = 0;
  const heroIdx = sections.findIndex((s) => s.type === "hero");
  const lineOf = (txt, e) => { const ls = String(txt || "").split("\n").map(S).filter(Boolean); return ls.includes(S(e.text)) && ls.length > 1; };
  // 장식(dot·underline…)은 hero 에서만(테마 허용 시)
  const kindOf = (e, txt, isHero = false) => { if (allowSpecial && isHero && SPECIAL_KINDS.includes(e.kind)) return e.kind; if (e.kind === "line" && lineOf(txt, e)) return "line"; if (lineOf(txt, e)) return "line"; return /\d/.test(S(e.text)) || e.kind === "color" ? "color" : (mode === "v8" ? "color" : plainKind(e)); };
  sections.forEach((s, si) => {
    if (si === heroIdx) return;
    const pushArr = (arr, setter, titleText, ctx = "") => { for (const e of arr || []) if (S(e?.text) && (!titleText || S(String(titleText).replace(/\n/g, " ")).includes(S(e.text)))) cand.push({ si, e, setter, txt: titleText || ctx, score: emphScore(e.text, ctx || titleText) + (e.kind === "line" ? 0.5 : 0), order: order++ }); };
    if (Array.isArray(s.emph)) pushArr(s.emph, (v) => { s.emph = v; }, s.title || (s.title_lines || []).join("\n"));
    for (const l of s.layers || []) {
      const titleGrade = ["title", "sub"].includes(l.role) && l.icon !== true && l.rewrite_ok !== false && !/[:：]/.test(S(l.ko));
      if (!titleGrade) { if ((l.emph || []).length) l.emph = []; continue; }
      pushArr(l.emph, (v) => { l.emph = v; }, null, l.ko);
    }
  });
  for (const s of sections) { if (s !== sections[heroIdx] && Array.isArray(s.emph)) s.emph = []; for (const l of s.layers || []) l.emph = []; }
  const others = sections.filter((_, i) => i !== heroIdx).length;
  const hero = sections[heroIdx];
  let used = 0;
  if (hero) { const h = (hero.name_emph || []).filter((e) => S(e?.text))[0]; hero.name_emph = h ? [{ text: S(h.text), kind: kindOf(h, hero.name, true) }] : []; used += hero.name_emph.length; }
  const budget = mode === "sparse" ? Math.min(EMPH_MAX_PAGE - used, Math.floor(others / 3)) : others;
  const seen = new Set(), picked = [], usedText = new Set((hero?.name_emph || []).map((e) => S(e.text)));
  for (const c of cand.sort((a, b) => b.score - a.score || a.order - b.order)) { if (picked.length >= budget) break; if (seen.has(c.si) || usedText.has(S(c.e.text))) continue; seen.add(c.si); usedText.add(S(c.e.text)); picked.push(c); } // 섹션당 1개, 같은 말 두 번 금지
  for (const c of picked.sort((a, b) => a.order - b.order)) { c.kind = kindOf(c.e, c.txt); c.setter([{ text: S(c.e.text), kind: c.kind }]); }
  return { total: used + picked.length, list: [...(hero?.name_emph || []).map((e) => ({ where: "hero", ...e })), ...picked.map((c) => ({ where: sections[c.si].id || sections[c.si].type, text: S(c.e.text), kind: c.kind }))] };
}


// ─────────────────────────────── 신뢰 배지 섹션(셀러 입력값만) ───────────────────────────────
// claims: copy.normalizeClaims 결과(또는 원본). 값이 비면 그 섹션은 넣지 않는다. 위치: 완판·순위·배지 = hero 뒤, 개발비·인증 = 스펙 앞, 공식 판매처·후기 = 주의/FAQ 앞
export function claimSections(claims = null) {
  const c = claims || {};
  const top = [], mid = [], end = [];
  if (S(c.sold_out)) top.push({ type: "sold_out_banner", text: S(c.sold_out) });
  if (S(c.rank)) top.push({ type: "rank_badge", text: S(c.rank) });
  if ((c.trust_badges || []).length >= 3) top.push({ type: "trust_badges", items: c.trust_badges.slice(0, 4) });
  if (S(c.rnd_cost)) mid.push({ type: "rnd_cost", text: S(c.rnd_cost) });
  if ((c.cert || []).length) mid.push({ type: "cert", items: c.cert.map((x) => ({ name: S(x.name), no: S(x.no) })) });
  if (c.review_stat && (c.review_stat.count || c.review_stat.satisfaction)) end.push({ type: "review_stat", count: S(c.review_stat.count), satisfaction: S(c.review_stat.satisfaction) });
  if (S(c.official_store)) end.push({ type: "official_store", text: S(c.official_store) });
  return { top, mid, end };
}
export function insertClaimSections(sections = [], claims = null) {
  const { top, mid, end } = claimSections(claims);
  if (!top.length && !mid.length && !end.length) return sections;
  const out = [...sections];
  const hi = out.findIndex((s) => s.type === "hero"); out.splice(hi + 1, 0, ...top);
  let mi = out.findIndex((s) => s.type === "spec"); if (mi < 0) mi = out.findIndex((s) => ["notice", "faq"].includes(s.type)); if (mi < 0) mi = out.length; out.splice(mi, 0, ...mid);
  let ei = out.findIndex((s) => ["notice", "faq", "cta"].includes(s.type)); if (ei < 0) ei = out.length; out.splice(ei, 0, ...end);
  return out;
}
