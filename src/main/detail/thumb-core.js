// 🖼 쿠팡 썸네일(대표이미지·추가이미지) — 순수 함수(thumb-core.test.js). 규정 근거: docs/detail/THUMBNAIL.md
// 원칙: 제품 모양은 절대 AI 로 만들지 않는다 — 실제 사진에서 딴 누끼만 합성하고, AI 는 배경·소품만.
export const THUMB_SIZE = 1000;          // 쿠팡 권장 실무 크기(공식: 정사각형 500~5000px)
export const MIN_PX = 500, MAX_PX = 5000; // 쿠팡 Open API images 규격
export const MAX_BYTES = 3 * 1024 * 1024; // 3MB 이하
export const MAX_EXTRA = 9;              // 추가이미지(DETAIL) 최대 9장
export const HERO_FILL = 0.85;           // 대표이미지: 제품 긴 변이 화면의 85%(업계 관행 — 공식 수치 아님)
export const HERO_FILL_RANGE = [0.75, 0.92];
export const EDGE_MARGIN = 0.03;         // 제품이 가장자리에 닿지 않게(3%)

export const KINDS = {
  hero: { name: "대표이미지", short: "대표" },
  scene_person: { name: "사용 장면(인물)", short: "인물" },
  scene: { name: "사용 장면", short: "장면" },
  appeal: { name: "소구점", short: "소구" },
  size: { name: "사이즈", short: "사이즈" },
  options: { name: "색상·옵션", short: "옵션" },
  feature: { name: "핵심 기능", short: "기능" },
  package: { name: "구성품", short: "구성" },
  bcut: { name: "대표 B컷", short: "B컷" },
  detail: { name: "상세 일부", short: "상세" },
  option_main: { name: "옵션 대표", short: "옵션" },
};
// 추가이미지 순서(강의: 연출·착용샷 먼저 → 소구점 → 정보 → B컷 → 상세페이지 자르기로 9장 채우기)
export const EXTRA_ORDER = ["scene_person", "scene", "appeal", "size", "options", "feature", "package", "bcut", "detail"];
export function orderItems(items = [], max = MAX_EXTRA) {
  const hero = items.filter((x) => x.kind === "hero").slice(0, 1);
  const rest = items.filter((x) => x.kind !== "hero").sort((a, b) => EXTRA_ORDER.indexOf(a.kind) - EXTRA_ORDER.indexOf(b.kind));
  return [...hero, ...rest.slice(0, max)];
}

// IPR(쿠팡 지식재산권) 금지 문구 — 쿠팡 엠블럼(BEST·쿠팡추천)·로켓배송·무료반품 등(강의 2주차 p.43) + 우리 기준 광고 문구
export const IPR_RE = /로켓\s*(배송|프레시|와우|직구|그로스)?|무료\s*(반품|배송|교환)|쿠팡\s*(추천|랭킹|pick|초이스|단독)|coupang|rocket|\bbest\b|베스트|1\s*위|최저가|무료/i;
export const hasIprText = (t) => IPR_RE.test(String(t || ""));
// 소구점 라벨: 12자 이내, IPR·광고 문구 금지, 라벨 속 숫자는 원본 글에 있어야
export function appealOk(label, sourceText = "") {
  const t = String(label || "").trim();
  if (!t || t.length > 14 || hasIprText(t)) return false;
  const nums = t.match(/\d+(?:\.\d+)?/g) || [];
  const src = String(sourceText || "").replace(/,/g, "");
  return nums.every((n) => new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}(?!\\d|\\.\\d)`).test(src));
}

// 상세페이지 섹션 → 1000×1000 으로 자를 섹션 고르기(780 폭 기준 높이). 머리·스펙·주의·FAQ 는 빼고, 너무 낮은 띠도 뺀다.
export const DETAIL_SKIP = new Set(["hero", "spec", "notice", "faq", "problem", "cta", "intro", "outro"]);
export function pickDetailSections(sections = [], docH = 0, need = 0, { minH = 380 } = {}) {
  if (need <= 0) return [];
  const rows = sections.map((s, i) => ({ ...s, i, h: (sections[i + 1]?.y ?? docH) - s.y })).filter((s) => !DETAIL_SKIP.has(s.type) && s.h >= minH);
  if (rows.length <= need) return rows;
  return Array.from({ length: need }, (_, k) => rows[Math.round((k * (rows.length - 1)) / Math.max(1, need - 1))]).filter((v, i, a) => a.indexOf(v) === i); // 고르게 퍼뜨린다
}

// 누끼 알파 상자(w,h) → 1000×1000 캔버스에 그릴 자리. fill = 긴 변 비율, 세로가 길면 위아래, 가로가 길면 좌우가 fill.
// 그림자 자리 때문에 살짝 위로(lift) — 바닥 그림자가 잘리지 않게.
export function placeProduct({ w, h }, { size = THUMB_SIZE, fill = HERO_FILL, lift = 0.02, maxH = null } = {}) {
  if (!(w > 0 && h > 0)) return null;
  let k = (size * fill) / Math.max(w, h);
  if (maxH && h * k > size * maxH) k = (size * maxH) / h;
  const dw = Math.round(w * k), dh = Math.round(h * k);
  const x = Math.round((size - dw) / 2), y = Math.round((size - dh) / 2 - size * lift);
  return { x, y: Math.max(Math.round(size * EDGE_MARGIN), y), w: dw, h: dh, k };
}

// 원본 사진 속 제품 상자가 사진 가장자리에 닿아 있으면(원본에서 이미 잘린 제품) true
export function touchesEdge(bbox, w, h, tol = 2) {
  if (!bbox || !w || !h) return false;
  return bbox.x <= tol || bbox.y <= tol || bbox.x + bbox.w >= w - tol || bbox.y + bbox.h >= h - tol;
}

// 제품 위·주변에 그려 넣은 치수 표시(예: "10.5cm", "38CM", "27.5 cm") — 대표이미지 원본에서 지운다
export const DIM_TEXT_RE = /^\s*\d+(?:\.\d+)?\s*(?:cm|mm|m|CM|MM|㎝|㎜|inch|in|")\s*$/;
export const isDimText = (t) => DIM_TEXT_RE.test(String(t || ""));
// OCR 상자 중 제품 상자 안(또는 걸친) 것 → 지울 상자(치수 표시 + 제품 위 글자). pad 만큼 넓힌다.
export function boxesToErase(boxes = [], productBox, { pad = 3, all = true } = {}) {
  if (!productBox) return [];
  const inside = (b) => b.x + b.w > productBox.x && b.x < productBox.x + productBox.w && b.y + b.h > productBox.y && b.y < productBox.y + productBox.h;
  return (boxes || []).filter((b) => b && b.w > 0 && b.h > 0 && inside(b) && (all || isDimText(b.text)))
    .map((b) => ({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2, text: String(b.text || ""), dim: isDimText(b.text) }));
}

// 치수 글 → 숫자 목록. "38×27.5×27.5cm", "38*27.5*27.5 cm", "가로 30cm 세로 20cm" 등. 원본 글자에 있던 숫자만 돌려준다.
export function parseDims(text = "") {
  const s = String(text || "");
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(?:cm|mm|㎝|㎜)?\s*[×xX*＊]\s*(\d+(?:\.\d+)?)(?:\s*(?:cm|mm|㎝|㎜)?\s*[×xX*＊]\s*(\d+(?:\.\d+)?))?\s*(cm|mm|㎝|㎜|CM|MM)?/g;
  let m;
  while ((m = re.exec(s))) {
    const nums = [m[1], m[2], m[3]].filter(Boolean).map(Number);
    const unit = /mm|㎜/i.test(m[4] || "") ? "mm" : "cm";
    if (nums.every((n) => n > 0 && n < 10000)) out.push({ nums, unit, quote: m[0].trim() });
  }
  return out;
}
// 모델이 고른 치수(숫자)가 원본 글에 실제로 있는지 — 근거 없는 숫자 금지
export function dimsGrounded(dims, sourceText = "") {
  const s = String(sourceText || "").replace(/,/g, "");
  // 값은 숫자 또는 원문 그대로의 글("37~57.5", "13.5/20.5") — 그 안의 숫자가 모두 원본에 있어야 한다
  const vals = [dims?.width, dims?.height, dims?.depth].filter((v) => v != null && v !== "").flatMap((v) => String(v).match(/\d+(?:\.\d+)?/g) || ["NaN"]);
  if (!vals.length) return false;
  return vals.every((v) => new RegExp(`(^|[^\\d.])${String(Number(v)).replace(".", "\\.")}(?:\\.0)?(?!\\d|\\.\\d)`).test(s));
}
export const fmtDim = (v, unit = "cm") => { const t = String(v).replace(/\s+/g, "").replace(/~/g, "~"); return /[a-z㎝㎜]$/i.test(t) ? t : `${t}${unit}`; };

// 옵션 라벨: 중국어·광고 문구 정리 후 10자 이내(모델이 준 한국어 라벨을 다듬기만)
export function tidyOptionLabel(s = "") {
  let t = String(s || "").replace(/[【】\[\]()（）]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/(무료\s*배송|당일\s*발송|최저가|1위|최고|정품|특가|할인|사은품|증정)/g, "").trim();
  return t.length > 12 ? t.slice(0, 12) : t;
}

// 대표이미지 후보 순위: 누끼가 되고, 원본에서 안 잘리고, 손·사람·다른 물건·덧그린 글자 없는 단일 제품 정면/사선
// c: { id, kind, coverage, touchesEdge, v: 비전 판정 { whole_product, single_unit, hands_or_people, extra_items, overlay_text, same_product, view, score } }
export function heroScore(c) {
  const v = c.v || {};
  if (!v.whole_product || v.hands_or_people || c.touchesEdge || v.same_product === false) return -1;
  let s = (Number(v.score) || 3) * 10;
  if (v.single_unit) s += 15;
  if (!v.extra_items) s += 10;
  if (!v.overlay_text) s += 6;
  if (v.view === "angle") s += 4; // 사선(3/4) 컷이 입체감이 있어 썸네일에 유리
  if (c.kind === "gallery") s += 2;
  if (c.coverage < 0.05) s -= 20;
  return s;
}
export function pickHero(cands = []) {
  const rows = cands.map((c) => ({ c, s: heroScore(c) })).filter((r) => r.s >= 0).sort((a, b) => b.s - a.s);
  return rows[0]?.c || null;
}

// 누끼 색 분포(불투명 픽셀, RGB 4단계씩 64칸, premultiplied BGRA) — 다른 제품(끼워 넣은 타이머·다른 기계)을 걸러 내는 보조 신호
export function colorHist({ data }, step = 4) {
  const H = new Float64Array(64); let n = 0;
  for (let i = 0; i < data.length; i += 4 * step) { const a = data[i + 3]; if (a < 200) continue; const b = (data[i] * 255) / a, g = (data[i + 1] * 255) / a, r = (data[i + 2] * 255) / a; H[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)]++; n++; }
  if (n) for (let k = 0; k < 64; k++) H[k] /= n;
  return H;
}
export const histMatch = (a, b) => { let s = 0; for (let k = 0; k < 64; k++) s += Math.min(a[k], b[k]); return s; };
export const BCUT_MIN_MATCH = 0.55;
// 대표 B컷 후보: 옵션(SKU) 사진만 — 대표 갤러리에는 끼워 넣은 다른 상품(타이머·다른 기계)이 섞여 비전 판정도 틀린다(2026-10-13 실측)
export function pickBcut(cands = [], hero, { minMatch = BCUT_MIN_MATCH } = {}) {
  return cands.filter((c) => c.id !== hero?.id && c.kind === "option" && c.v?.single_unit && c.v?.same_product !== false && !c.v?.hands_or_people && !c.v?.overlay_text && (c.match ?? 0) >= minMatch) // 치수선·글자가 남은 옵션 사진은 B컷으로 쓰지 않는다
    .map((c) => ({ c, s: heroScore(c) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.c || null;
}

// 비트맵 검사(BGRA, 1000×1000) — 대표이미지 규정 자동 검수
//  · 테두리 1px 링이 순백(>=250)인가 · 제품(흰색이 아닌 픽셀) 상자가 가장자리 여백 안인가 · 채움 비율
export function inspectHero(bm, { white = 250, size = THUMB_SIZE } = {}) {
  const { data, w, h } = bm;
  const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  let nonWhiteEdge = 0, edgeN = 0;
  for (let x = 0; x < w; x += 2) for (const y of [0, h - 1]) { edgeN++; if (px(x, y).some((v) => v < white)) nonWhiteEdge++; }
  for (let y = 0; y < h; y += 2) for (const x of [0, w - 1]) { edgeN++; if (px(x, y).some((v) => v < white)) nonWhiteEdge++; }
  // 제품 상자: 아주 연한 그림자(>=235)는 빼고 본다
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const c = px(x, y); if (c.some((v) => v < 235)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const box = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const fill = box ? Math.max(box.w / w, box.h / h) : 0;
  const m = Math.round(Math.min(w, h) * 0.01);
  const clipped = !!box && (box.x <= m || box.y <= m || box.x + box.w >= w - m || box.y + box.h >= h - m);
  const issues = [];
  if (w !== h) issues.push({ level: "bad", why: "정사각형이 아님" });
  if (w < MIN_PX || w > MAX_PX) issues.push({ level: "bad", why: `크기 ${w}px — 500~5000px 밖` });
  if (nonWhiteEdge / Math.max(1, edgeN) > 0.01) issues.push({ level: "bad", why: "가장자리가 순백이 아님" });
  if (!box) issues.push({ level: "bad", why: "제품이 보이지 않음" });
  if (clipped) issues.push({ level: "bad", why: "제품이 가장자리에 닿음(잘림 의심)" });
  if (box && fill < HERO_FILL_RANGE[0]) issues.push({ level: "warn", why: `제품이 작음(${Math.round(fill * 100)}%)` });
  if (box && fill > HERO_FILL_RANGE[1]) issues.push({ level: "warn", why: `제품이 너무 꽉 참(${Math.round(fill * 100)}%)` });
  return { box, fill: Math.round(fill * 1000) / 1000, edgeWhite: 1 - nonWhiteEdge / Math.max(1, edgeN), clipped, issues, size: { w, h } };
}

// 최종 비전 검수 결과 + 픽셀 검수 → 장마다 판정(통과/확인 필요/빼기)
// vc: { same_product, product_cut_off, other_brand_logo, any_text, looks_natural, note }
export function judgeThumb(kind, { pixel = null, vc = null, bytes = 0 } = {}) {
  const issues = [...(pixel?.issues || [])];
  if (bytes > MAX_BYTES) issues.push({ level: "bad", why: `용량 ${(bytes / 1048576).toFixed(1)}MB — 3MB 초과` });
  if (vc) {
    if (vc.same_product === false) issues.push({ level: "bad", why: "실제 제품과 모양이 다름" });
    if (vc.product_cut_off) issues.push({ level: kind === "feature" ? "warn" : "bad", why: "제품이 잘림" });
    if (vc.other_brand_logo) issues.push({ level: "bad", why: "다른 브랜드 로고" });
    if (vc.coupang_mark) issues.push({ level: "bad", why: "쿠팡 엠블럼·로켓배송·무료반품 문구(IPR)" });
    if (vc.chinese_text && kind !== "hero") issues.push({ level: "warn", why: "중국어 글자가 보임" });
    if (vc.any_text && kind === "hero") issues.push({ level: "warn", why: "글자가 보임(제품 라벨 포함)" });
    if (vc.looks_natural === false && (kind === "scene" || kind === "scene_person")) issues.push({ level: "warn", why: "합성이 어색함" });
  }
  const bad = issues.some((x) => x.level === "bad"), warn = issues.some((x) => x.level === "warn");
  return { status: bad ? "bad" : warn ? "warn" : "ok", issues };
}

// 결과 묶음 → 화면용 요약(추천 1장 + 나머지)
export function summarizeSet(items = []) {
  const ok = items.filter((x) => x.status !== "bad");
  const hero = items.find((x) => x.kind === "hero") || null;
  return { total: items.length, pass: items.filter((x) => x.status === "ok").length, warn: items.filter((x) => x.status === "warn").length, bad: items.filter((x) => x.status === "bad").length,
    recommended: hero && hero.status !== "bad" ? hero.id : ok[0]?.id || null };
}

// 장면 배경 프롬프트(제품은 그리지 않음 — 빈 자리만). place/surface/props 는 영어 짧은 말.
export function sceneBackgroundPrompt({ place = "a bright modern Korean kitchen", surface = "a light stone countertop", props = [], mood = "", person = "", situation = "" } = {}) {
  const pr = (props || []).filter(Boolean).slice(0, 3).join(", ");
  return [
    `Photorealistic product-photography background plate: ${surface} in ${place}.`,
    `Close framing: the flat surface fills the entire bottom half of the frame and continues past the bottom edge — the front edge of the surface is NOT visible. Camera slightly above the surface looking forward, 50mm lens, gentle depth of field.`,
    `Leave a large EMPTY clear area in the center of the surface — nothing placed there; a product will be composited later.`,
    situation ? `The scene shows the moment of use: ${situation}.` : "",
    person ? `In the background behind the surface, slightly out of focus: ${person}, naturally busy with work, face turned away or partly hidden, hands not near the empty center area.` : "",
    pr ? `Only a few small props near the left and right edges or softly blurred in the background: ${pr}.` : "Very few props, softly blurred in the background.",
    `Soft natural window daylight from the left, clean and airy${mood ? `, ${mood}` : ""}.`,
    `Absolutely no text, no letters, no logos, no brand names, no labels, no packaging, no appliances or machines${person ? "" : ", no people, no hands"}. Square 1:1 composition.`,
  ].filter(Boolean).join(" ");
}

// ---- 화면에서 고치기(쿠팡 등록 순서 그대로: 0번 = 대표, 1~9번 = 추가) ----
export const HERO_OK_KINDS = new Set(["hero", "bcut"]); // 대표 칸에는 흰 바탕 규정형만(쿠팡 공식: 순백 배경·글자 없음)
// op: { op:"hero"|"exclude"|"include"|"move", id, dir? } → 새 items(원본 안 바꿈) 또는 { error }
export function applyEdit(items = [], { op, id, dir = 0 } = {}) {
  const list = items.map((x) => ({ ...x }));
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return { error: "그 사진이 없습니다" };
  if (op === "hero") {
    if (!HERO_OK_KINDS.has(list[i].kind)) return { error: "대표는 흰 바탕 사진만 됩니다(쿠팡 기준)" };
    if (list[i].status === "bad") return { error: "검수에서 빠진 사진은 대표로 쓸 수 없습니다" };
    const [x] = list.splice(i, 1); x.excluded = false; list.unshift(x); // 원래 대표는 추가 1번으로 밀린다
    return list;
  }
  if (op === "exclude" || op === "include") {
    if (i === 0 && op === "exclude") return { error: "대표는 뺄 수 없습니다 — 다른 사진을 대표로 바꾸세요" };
    list[i].excluded = op === "exclude";
    return list;
  }
  if (op === "move") {
    const d = Math.sign(Number(dir) || 0); let j = i + d;
    while (j >= 1 && j < list.length && (list[j].excluded || list[j].status === "bad")) j += d; // 화면에 보이는(쓰는) 이웃과 바꾼다
    if (!d || i === 0 || j < 1 || j >= list.length) return list; // 대표 자리는 "대표로"로만 바꾼다
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  }
  return { error: `모르는 동작: ${op}` };
}
// 내보낼 장: 대표 + 추가(빠짐·검수 빼기 제외) 최대 9장
export function exportPick(items = [], max = MAX_EXTRA) {
  const [hero, ...rest] = items;
  if (!hero) return [];
  return [hero, ...rest.filter((x) => !x.excluded && x.status !== "bad").slice(0, max)];
}
