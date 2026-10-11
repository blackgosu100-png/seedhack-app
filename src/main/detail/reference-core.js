// 레퍼런스 상세페이지 → 벤치마킹 내 템플릿(1단계 POC) — 순수 함수(전자·AI 호출 없음, node --test 대상)
// 흐름: reference.js 가 레퍼런스 이미지에서 측정값(색·정렬·글자 크기·여백, 픽셀/OCR)과 비전 판단(키커·띠·사진·강조…, 섹션 순서·설득 각도)을 모은다
//   → normalizeTokens: custom 테마 손잡이(plan.meta.refTokens)  → applyReferenceOrder: planSectionsV5 레시피를 레퍼런스 순서로
//   → referenceGuide: 기획서·카피 입력에 붙일 "벤치마킹 가이드"(사실·문장은 가져오지 않음) → guardSimilarity: 카피가 레퍼런스 글과 너무 비슷한 줄 찾기
// 원칙: 레퍼런스의 사진·문장·로고·근거 없는 주장(N차 완판·1위·인증번호·판매량)은 절대 가져오지 않는다. 가져오는 것은 디자인 손잡이·섹션 순서·설득 각도뿐.
const S = (v) => (v == null ? "" : String(v)).trim();

// ── 1. 테마 손잡이 ──
export const TOKEN_ENUM = {
  align: ["center", "left"], kicker: ["none", "pill-dark", "pill-brand", "text"], bands: ["none", "alternate"], problem: ["dark-bubble", "plain", "panel"],
  photo: ["full", "rounded", "card"], emph: ["line-color", "weight", "underline", "none"], icons: ["brand-fill", "light", "text-line", "none"],
  panel: ["lines", "gray", "cards"], hero: ["on-photo", "above"], notice: ["dark", "same"], spacing: ["tight", "normal", "airy"],
};
const HEX = /^#[0-9a-f]{6}$/i;
const hexOk = (x) => (HEX.test(S(x)) ? S(x).toLowerCase() : null);
const rgbOf = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const lumOf = (h) => { if (!hexOk(h)) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = rgbOf(h); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export const satOf = (h) => { if (!hexOk(h)) return 0; const c = rgbOf(h); return (Math.max(...c) - Math.min(...c)) / 255; };
const pick = (k, v, dflt) => (TOKEN_ENUM[k].includes(v) ? v : dflt);

// measured: reference.js measure() 결과 { bg, dark, darkRatio, panel, brand, brandShare, ink, ink2, align:{center,left}, titlePx, gapPx, refW }
// style: 비전 판단(VISION 스키마 style 칸) — 값이 enum 밖이면 측정값·기본값
// 측정값이 있는 칸(색·정렬·크기·여백·띠)은 측정이 우선, 모양 판단(키커·문제 띠·사진·강조·아이콘·정보 판·히어로)은 비전이 우선
export function normalizeTokens(measured = {}, style = {}) {
  const m = measured || {}, v = style || {};
  const bg = hexOk(m.bg) || "#ffffff", darkBg = (lumOf(bg) ?? 1) < 0.25;
  const brandShare = Number(m.brandShare) || 0;
  // 브랜드 색: 측정된 평평한 고채도 색이 충분히 많고(0.3% 이상) 비전도 "없음"이라 하지 않을 때만. 비전이 bands/text 라 했는데 측정이 약하면 측정 색이라도 씀
  let brand = hexOk(m.brand) && satOf(m.brand) >= 0.35 ? hexOk(m.brand) : null;
  if (brand && v.brand_usage === "none" && brandShare < 0.02) brand = null;
  if (brand && !v.brand_usage && brandShare < 0.003) brand = null;
  const darkRatio = Number(m.darkRatio) || 0;
  const align = m.align && (m.align.left || m.align.center) ? (m.align.left > m.align.center * 1.2 ? "left" : "center") : pick("align", v.align, "center");
  const gap = Number(m.gapPx) || 0; // 860 폭 기준 위아래 빈 줄 중앙값
  const spacing = gap ? (gap < 90 ? "tight" : gap < 150 ? "normal" : "airy") : pick("spacing", v.spacing, "normal");
  const photo = pick("photo", v.photo, "full");
  const out = {
    colors: {
      bg, ink: hexOk(m.ink) || (darkBg ? "#f2f2f2" : "#111418"), ink2: hexOk(m.ink2) || (darkBg ? "#c4c6cc" : "#5c6370"),
      brand, dark: hexOk(m.dark) || "#1c1f26", dark2: hexOk(m.dark2) || hexOk(m.dark) || "#1c1f26", panel: hexOk(m.panel) || "#f2f2f2", line: hexOk(m.line) || null, kicker: hexOk(m.kicker) || null,
    },
    align, spacing,
    title_size: Number(m.titlePx) > 0 ? Math.round(Math.max(34, Math.min(56, m.titlePx))) : 44,
    title_weight: [500, 600, 700, 800, 900].includes(Number(v.title_weight)) ? Number(v.title_weight) : 800,
    radius: photo === "full" ? 0 : photo === "card" ? 24 : 14,
    kicker: pick("kicker", v.kicker, "none"),
    bands: (darkRatio >= 0.05 && pick("bands", v.bands, "none") === "alternate") || darkRatio >= 0.18 ? "alternate" : "none",
    problem: pick("problem", v.problem, darkRatio >= 0.1 ? "dark-bubble" : "plain"),
    photo, emph: pick("emph", v.emph, brand ? "line-color" : "weight"),
    icons: pick("icons", v.icons, brand ? "brand-fill" : "text-line"),
    panel: pick("panel", v.panel, "lines"), hero: pick("hero", v.hero, "on-photo"), notice: pick("notice", v.notice, "same"),
  };
  if (out.panel === "lines" && (Number(m.panelRatio) || 0) >= 0.06) out.panel = "gray"; // 연회색 판이 페이지의 6% 이상이면 정보 판은 회색 판
  if (out.hero === "above" && out.icons === "none") out.icons = "text-line"; // 글 → 사진 첫 화면의 짧은 회색 한 줄(특징 낱말) 자리
  // 서로 맞지 않는 조합 정리: 브랜드 색이 없으면 브랜드 색을 쓰는 손잡이는 무채색 대안으로
  if (!brand) { if (out.kicker === "pill-brand") out.kicker = "pill-dark"; if (out.icons === "brand-fill") out.icons = "light"; if (out.emph === "line-color" || out.emph === "underline") out.emph = "weight"; }
  if (out.kicker === "pill-dark" && out.colors.dark) out.colors.kicker = out.colors.kicker || out.colors.dark;
  return out;
}

// ── 1-2. 섹션 자리 재기: 비전이 옮겨 적은 제목 → OCR 상자(전역 y, 측정 폭 기준) → 그 줄들의 바탕(rows[y] = { lum, share, sat }) ──
// sc: OCR 좌표(측정 폭) → rows 좌표 배율. 결과 섹션에 y(0~1 페이지 위치)·bg("dark"|"light"|"photo"|"brand")·tx(제목 왼쪽 x 0~1)·tw 를 붙인다
export function locateSections(sections = [], boxes = [], rows = [], sc = 1) {
  const N = rows.length || 1;
  return sections.map((s) => {
    const t = normKo(s.title); if (t.length < 2) return { ...s };
    let best = null;
    for (let i = 0; i < boxes.length; i++) { // 제목은 여러 상자에 걸칠 수 있어 이웃 2개까지 이어 붙여 비교
      for (let k = 1; k <= 3 && i + k <= boxes.length; k++) {
        const txt = boxes.slice(i, i + k).map((b) => b.text).join(" "), g = grams(txt), tg = grams(t);
        if (!tg.size || !g.size) continue;
        let hit = 0; for (const x of g) if (tg.has(x)) hit++;
        const sc2 = hit / Math.max(1, Math.min(g.size, tg.size)) - (k - 1) * 0.02;
        if (!best || sc2 > best.score) best = { score: sc2, b: boxes[i] };
      }
    }
    if (!best || best.score < 0.5) return { ...s };
    const y0 = Math.max(0, Math.round(best.b.y * sc)), y1 = Math.min(N - 1, Math.round((best.b.y + Math.max(best.b.h, 8)) * sc));
    const pad = Math.round(30 * sc); const seg = rows.slice(Math.max(0, y0 - pad), Math.min(N, y1 + pad));
    const lum = seg.reduce((a, r) => a + r.lum, 0) / Math.max(1, seg.length), share = seg.reduce((a, r) => a + r.share, 0) / Math.max(1, seg.length), sat = seg.reduce((a, r) => a + (r.sat || 0), 0) / Math.max(1, seg.length);
    const bg = share < 0.45 ? "photo" : lum < 0.22 ? (sat > 0.4 ? "brand" : "dark") : sat > 0.4 && lum < 0.6 ? "brand" : "light";
    return { ...s, y: Math.round((y0 / N) * 1000) / 1000, bg, tx: Math.round(best.b.x * 100) / 100, tw: Math.round(best.b.w * 100) / 100 };
  });
}
// 측정한 섹션 자리로 비전 판단을 보정(비전이 놓치기 쉬운 것: 키커 유무·문제 띠·띠 교대·주의 검정·히어로 글 자리)
export function styleFromSections(sections = [], style = {}) {
  const st = { ...(style || {}) }, of = (t) => sections.filter((s) => s.our_type === t && s.bg);
  const latinKickers = sections.filter((s) => kickerWord(s.kicker)).length;
  if (latinKickers < 2) st.kicker = "none"; // 영문 키커가 2개도 없으면 키커 없음
  else if (!st.kicker || st.kicker === "none") st.kicker = "pill-dark";
  const pb = of("problem"); if (pb.length) st.problem = pb.some((s) => s.bg === "dark" || s.bg === "brand") ? "dark-bubble" : st.problem === "dark-bubble" ? "plain" : st.problem;
  const body = sections.filter((s) => ["feature", "before_after", "detail", "options", "compare", "versatility"].includes(s.our_type) && s.bg);
  if (body.length >= 3) { const d = body.filter((s) => s.bg === "dark").length; st.bands = d >= 2 && d <= body.length * 0.7 ? "alternate" : "none"; }
  const nt = of("notice"); if (nt.length) st.notice = nt.some((s) => s.bg === "dark") ? "dark" : "same";
  const hr = of("hero")[0]; if (hr) st.hero = hr.bg === "photo" ? "on-photo" : "above"; // 제목이 평평한 바탕 위 = 사진 밖(위)
  return st;
}

// ── 2. 섹션 순서(레시피) ──
// 비전이 붙이는 레퍼런스 섹션 종류 → 우리 섹션 종류(없으면 null = 우리가 만들 재료가 없는 섹션, 버림)
export const REF_TYPES = ["hero", "problem", "before_after", "checkpoint", "feature", "options", "detail", "versatility", "notice", "spec", "faq", "size", "compare", "steps", "review", "trust", "story", "icons", "cta", "other"];
export const REF_TO_OURS = { hero: "hero", problem: "problem", before_after: "before_after", checkpoint: "checkpoint", feature: "feature", options: "options", detail: "detail", versatility: "versatility", notice: "notice", spec: "spec", faq: "faq", size: "options" };
export const KEEP_ALWAYS = ["hero", "notice", "spec"]; // 레퍼런스에 없어도 남기는 기본 정보
export const MAX_REF_FEATURES = 3; // 카피 스키마가 features 3개 고정
// "POINT 1" → { word: "POINT", numbered: true } · "CHECK POINT" → { word, numbered:false }
export function kickerWord(k) {
  const t = S(k).replace(/\s+/g, " ");
  if (!t || t.length > 20 || /[가-힣]/.test(t)) return null; // 한글 키커(문장 조각)는 쓰지 않는다
  const m = /^(.*?)[\s.]*0?(\d{1,2})$/.exec(t);
  return m && m[1] ? { word: m[1].trim(), numbered: true } : { word: t, numbered: false };
}
// ref.sections → [{ type(우리), role, angle, layout, kicker }] 순서대로, 중복·초과 정리
export function refRecipe(ref = {}) {
  const out = [], dropped = [];
  for (const s of [...(ref.sections || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))) {
    const ours = REF_TO_OURS[s.our_type] || null;
    if (!ours) { dropped.push({ role: S(s.role), our_type: S(s.our_type), why: "우리 재료로 만들 수 없는 섹션" }); continue; }
    const n = out.filter((x) => x.type === ours).length;
    if (ours === "feature" ? n >= MAX_REF_FEATURES : n >= 1) { // 같은 종류 둘째부터: feature 는 3개까지, 나머지는 각도만 앞 섹션에 덧붙임
      const prev = out.filter((x) => x.type === ours).pop();
      if (prev && S(s.angle) && !prev.extra.includes(S(s.angle))) prev.extra.push(S(s.angle));
      dropped.push({ role: S(s.role), our_type: S(s.our_type), why: ours === "feature" ? `feature ${MAX_REF_FEATURES}개 초과 → 앞 feature 각도에 합침` : "같은 종류 반복 → 앞 섹션에 합침" });
      continue;
    }
    out.push({ type: ours, role: S(s.role), angle: S(s.angle), layout: S(s.layout), kicker: kickerWord(s.kicker), extra: [] });
  }
  return { recipe: out, dropped };
}
// planSectionsV5 결과(secs)를 레퍼런스 순서로 다시 줄 세운다. 레퍼런스에 없는 우리 섹션은 KEEP_ALWAYS 만 남기고 뺀다(keepExtra 면 원래 자리 근처에 남김).
// 레퍼런스 섹션 중 우리 재료가 없는 것(우리 secs 에 그 종류가 없음 — 예: 규격 2종이 없어 options 없음)은 건너뛴다.
// → { sections, used:[type], dropped:[{role,why}], extra:[우리 섹션 중 뺀 것] } · 각 섹션에 sec.ref = { role, angle, layout, kicker, extra }
export function applyReferenceOrder(secs = [], ref = {}, { keepExtra = false } = {}) {
  const { recipe, dropped } = refRecipe(ref);
  if (!recipe.length) return { sections: secs, used: [], dropped, removed: [] };
  const pool = secs.map((s) => ({ ...s })), out = [], removed = [];
  const take = (type) => { const i = pool.findIndex((s) => s.type === type); return i < 0 ? null : pool.splice(i, 1)[0]; };
  for (const r of recipe) {
    const s = take(r.type);
    if (!s) { dropped.push({ role: r.role, our_type: r.type, why: "우리 상품에 이 섹션 재료가 없음" }); continue; }
    s.ref = { role: r.role, angle: r.angle, layout: r.layout, kicker: r.kicker, extra: r.extra };
    out.push(s);
  }
  // 레퍼런스 feature 가 우리보다 적으면 남는 우리 feature 는 뺀다(레퍼런스처럼 짧게) — 단 하나도 없으면 1개는 남김
  for (const s of pool) {
    if (KEEP_ALWAYS.includes(s.type) || keepExtra || (s.type === "feature" && !out.some((x) => x.type === "feature"))) {
      // 원래 순서에서 바로 앞 섹션 뒤에 끼운다(없으면 끝)
      const oi = secs.findIndex((x) => x.id === s.id), prevIds = secs.slice(0, oi).map((x) => x.id).reverse();
      const at = prevIds.map((id) => out.findIndex((x) => x.id === id)).find((i) => i >= 0);
      if (s.type === "hero") out.unshift(s); else if (at == null) out.push(s); else out.splice(at + 1, 0, s);
    } else removed.push({ id: s.id, type: s.type });
  }
  // hero 는 항상 맨 앞, 정보 판(notice·spec·faq)은 레퍼런스 순서대로 뒤쪽에 모은다
  const hi = out.findIndex((x) => x.type === "hero"); if (hi > 0) out.unshift(out.splice(hi, 1)[0]);
  return { sections: out, used: out.map((s) => s.type), dropped, removed };
}
// 키커 번호 매기기: 섹션 ref.kicker.word 별로 1, 2, … (numbered 아닌 것은 그대로)
// 같은 종류 섹션 중 키커가 없는 것은 그 종류에서 가장 많이 쓴 낱말로(feature 3개가 POINT 1·2·3 이 되게).
// 개선·신상품·이벤트를 주장하는 낱말(UPGRADE·NEW·BEST·GIFT…)은 우리 근거가 없으므로 쓰지 않는다 → 그 종류의 다른 낱말 또는 기본 키커
export const CLAIM_KICKER = /UPGRADE|NEW|BEST|HOT|SALE|EVENT|GIFT|SPECIAL|LIMITED|PREMIUM|신제품|이벤트/i;
export function refKickers(sections = []) {
  const byType = {};
  for (const s of sections) { const k = s.ref?.kicker; if (k?.word && !CLAIM_KICKER.test(k.word)) (byType[s.type] = byType[s.type] || []).push(k); }
  const top = (t) => { const c = {}; for (const k of byType[t] || []) c[k.word] = (c[k.word] || 0) + 1; const w = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return w ? (byType[t].find((k) => k.word === w[0])) : null; };
  const cnt = {};
  return sections.map((s) => {
    let k = s.ref?.kicker && !CLAIM_KICKER.test(s.ref.kicker.word || "") ? s.ref.kicker : null;
    if (!k && s.ref) k = top(s.type);
    if (!k?.word) return null;
    if (!k.numbered && (byType[s.type] || []).length < 2) return k.word;
    cnt[k.word] = (cnt[k.word] || 0) + 1; return `${k.word} ${cnt[k.word]}`;
  });
}

// ── 3. 벤치마킹 가이드(기획서·카피 입력에 붙이는 글) ──
export const CHAIN_ORDER_TYPES = ["problem", "before_after", "feature", "detail", "versatility"]; // copy.js CHAIN_TYPES 와 같게
export const GUIDE_RULES = [
  "레퍼런스는 같은 카테고리에서 잘 팔리는 상세페이지입니다. 따라 할 것은 '섹션 순서·각 섹션이 고객 마음을 움직이는 각도·문제 제기 방식·제목 길이와 2줄 리듬·말투'뿐입니다.",
  "레퍼런스의 문장·표현·고유 명칭·숫자·인증·판매 실적·순위를 그대로 또는 살짝 바꿔 쓰지 마세요. 사실(수치·재질·기능)은 우리 상품 입력에 있는 것만 씁니다.",
  "각도는 우리 상품의 실제 장점에 맞게 바꿔 적용하세요. 우리 상품에 맞지 않는 각도는 버리고 우리 장점으로 대신합니다.",
];
export function referenceGuide(ref = {}, sections = null) {
  if (!ref || !(ref.sections || []).length) return "";
  const c = ref.copy || {}, L = ["[벤치마킹 가이드 — 같은 카테고리 잘 팔리는 상세페이지의 설득 흐름(사실·문장은 가져오지 말 것)]", ...GUIDE_RULES.map((r) => `- ${r}`)];
  if (S(c.chain)) L.push(`- 레퍼런스 설득 흐름: ${S(c.chain)}`);
  if (S(c.tone)) L.push(`- 말투: ${S(c.tone)}`);
  if (Number(c.title_len) > 0) L.push(`- 제목 길이: 줄당 약 ${Math.round(c.title_len)}자${c.two_line ? " · 2줄 제목(둘째 줄이 결론)" : ""}`);
  if (S(c.problem_frame)) L.push(`- 문제 제기 방식: ${S(c.problem_frame)}`);
  if ((c.selling_points || []).length) L.push(`- 레퍼런스가 파는 각도(우리 장점에 맞게 바꿔 적용): ${(c.selling_points || []).map(S).filter(Boolean).slice(0, 8).join(" / ")}`);
  if ((ref.avoid || []).length) L.push(`- 레퍼런스에 있던 근거 주장(우리는 쓰지 말 것): ${(ref.avoid || []).map(S).filter(Boolean).slice(0, 8).join(" / ")}`);
  if (Array.isArray(sections) && sections.some((s) => s.ref)) {
    L.push("- 섹션별 각도(섹션 목록의 '벤치마킹' 칸): 그 섹션 제목·설명이 이 각도로 고객을 설득하게 쓰세요.");
    const chain = sections.filter((s) => CHAIN_ORDER_TYPES.includes(s.type)).map((s) => (s.type === "problem" ? "problem.question" : s.type === "feature" ? "feature" : `${s.type}.title`));
    if (chain.length >= 2) L.push(`- 소제목 징검다리 순서는 레퍼런스 순서를 따릅니다(지시문의 기본 순서 대신): ${chain.join(" → ")} — features 1·2·3 은 섹션 목록에 나온 순서대로이고, chain_check 도 이 순서로 짭니다. 목록에 없는 섹션(예: ${["checkpoint", "detail", "before_after", "versatility", "problem"].filter((t) => !sections.some((x) => x.type === t)).join("·") || "없음"})의 글은 짧게만 채우세요(화면에 안 나옴).`);
  }
  return L.join("\n");
}

// ── 4. 표절 가드: 글자 3-gram 겹침 ──
// 비교는 한글·영문·숫자만(띄어쓰기·문장부호 무시). 흔한 안내 라벨은 예외.
export const GENERIC_OK = /^(자주묻는질문|구매전확인해주세요|구매전확인|제품정보|상품정보|제품상세정보|사용방법|주의사항|사이즈|제품사이즈|구성품|구성|checkpoint|point\d*|detail|notice|faq|qna|before|after|option|usage)$/i;
export const normKo = (t) => S(t).toLowerCase().replace(/[^가-힣a-z0-9]/g, "");
// 상세페이지에서 누구나 쓰는 말끝·안내 어구 — 겹쳐도 표절이 아님(비교 전에 지운다)
export const COMMON_PHRASES = ["있을수있습니다", "수있습니다", "수있어요", "해주세요", "하세요", "주세요", "얼마나걸리나요", "어떻게하나요", "어떻게되나요", "가능한가요", "필요한가요", "있나요", "되나요", "인가요", "할수있나요", "입니다", "합니다", "습니다", "해요", "에요", "예요", "있습니다", "없습니다", "참고해주세요", "확인해주세요", "다소차이가", "차이가있을", "사용해주세요"];
const stripCommon = (n) => COMMON_PHRASES.reduce((a, p) => a.split(p).join("|"), n);
export function grams(t, n = 3) { const g = new Set(); for (const s of stripCommon(normKo(t)).split("|")) for (let i = 0; i + n <= s.length; i++) g.add(s.slice(i, i + n)); return g; }
export function lcsLen(a, b) { // 가장 긴 공통 부분 문자열 길이(정규화·흔한 말끝 지운 뒤)
  a = stripCommon(normKo(a)); b = stripCommon(normKo(b)); if (!a || !b) return { len: 0, str: "" };
  let best = 0, end = 0; const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) { let diag = 0; for (let j = 1; j <= b.length; j++) { const tmp = prev[j]; prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0; if (prev[j] > best) { best = prev[j]; end = i; } diag = tmp; } }
  return { len: best, str: a.slice(end - best, end) };
}
// line 이 refLines 중 하나와 너무 비슷한가. ours: 우리 상품 사실 글(상품명·스펙) — 거기 있는 낱말이 겹치는 것은 표절이 아님(같은 카테고리 명사)
export const SIM_LIMIT = { containment: 0.6, lcs: 8, minLen: 5 };
export function similarTo(line, refLines = [], { ours = "", limit = SIM_LIMIT } = {}) {
  const t = normKo(line);
  if (t.length < limit.minLen || GENERIC_OK.test(t)) return null;
  const oursN = normKo(ours), g = [...grams(line)].filter((x) => !oursN.includes(x));
  let best = null;
  for (const r of refLines) {
    const rn = normKo(r); if (rn.length < 3 || GENERIC_OK.test(rn)) continue;
    const rg = grams(r); const hit = g.filter((x) => rg.has(x)).length;
    const containment = g.length ? hit / g.length : 0;
    const l = lcsLen(line, r); const lcsOwn = l.str && oursN.includes(l.str);
    const score = Math.max(containment, lcsOwn ? 0 : Math.min(1, l.len / limit.lcs));
    if ((containment >= limit.containment && g.length >= 3) || (!lcsOwn && l.len >= limit.lcs)) { if (!best || score > best.score) best = { score: Math.round(score * 100) / 100, ref: S(r), containment: Math.round(containment * 100) / 100, lcs: l.len, common: l.str }; }
  }
  return best;
}
// 카피(정화 뒤 v5 모양)의 고객에게 보이는 글을 모두 훑어 비슷한 줄 목록 → [{ path, text, ref, score, … }]
const SKIP_KEYS = new Set(["sections", "chain", "chain_check", "similarity", "emph", "name_emph", "kind", "title_lines", "rows", "internal", "claims"]);
export function copyStrings(copy = {}, base = "") {
  const out = [];
  const walk = (o, p) => {
    if (typeof o === "string") { if (S(o)) out.push({ path: p, text: o }); return; }
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    if (o && typeof o === "object") for (const k of Object.keys(o)) if (!SKIP_KEYS.has(k)) walk(o[k], p ? `${p}.${k}` : k);
  };
  walk(copy, base);
  return out;
}
export function guardSimilarity(copy = {}, refLines = [], { ours = "", limit = SIM_LIMIT } = {}) {
  const lines = (refLines || []).map(S).filter((x) => normKo(x).length >= 3);
  const flagged = [];
  let checked = 0;
  for (const it of copyStrings(copy)) {
    const parts = it.text.includes("\n") ? [...it.text.split("\n"), it.text.replace(/\n/g, " ")] : [it.text]; // 2줄 제목은 줄마다 + 이어서(한 줄만 베껴도 잡게)
    for (const part of parts) {
      checked++;
      const hit = similarTo(part, lines, { ours, limit });
      if (hit) { flagged.push({ path: it.path, text: it.text, line: part, ...hit }); break; }
    }
  }
  return { checked, flagged, ok: !flagged.length };
}
// 경로("features[1].title")로 값 읽기·쓰기
export function getPath(o, p) { return p.split(/\.|\[(\d+)\]/).filter((x) => x !== undefined && x !== "").reduce((a, k) => (a == null ? a : a[k]), o); }
export function setPath(o, p, v) { const ks = p.split(/\.|\[(\d+)\]/).filter((x) => x !== undefined && x !== ""); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; return o; }

// ── 5. 레퍼런스 OCR 글 → 비교용 줄 목록(짧은 조각은 이웃과 이어 붙여 문장 단위로도) ──
export function refLinesFromOcr(ocr = {}) {
  const out = [];
  for (const im of ocr.images || []) {
    const bs = (im.boxes || []).filter((b) => /[가-힣]/.test(b.text || ""));
    bs.forEach((b, i) => { out.push(S(b.text)); const nx = bs[i + 1]; if (nx && Math.abs(nx.y - (b.y + b.h)) < b.h * 1.2 && Math.abs(nx.h - b.h) < b.h * 0.35) out.push(`${S(b.text)} ${S(nx.text)}`); });
  }
  return [...new Set(out)];
}
// 근거 없는 주장 찾기(레퍼런스 OCR) — avoid 목록(비전이 놓쳐도)
export const CLAIM_RE = /\d+\s*차\s*완판|완판|누적\s*판매|\d[\d,]*\s*(개|대)\s*판매|판매\s*\d|\d+\s*위|1위|랭킹|연구\s*개발\s*비용|KC\s*(인증|안전)|인증\s*번호|[A-Z]{1,3}\d{2,}[-A-Z0-9]{3,}|실사용\s*후기|만족도\s*\d+|\d+\s*%\s*(만족|재구매)|공식\s*(판매|스토어|온라인)|정품\s*인증|특허/;
export function claimsFromLines(lines = []) { return [...new Set((lines || []).map(S).filter((t) => CLAIM_RE.test(t) && t.length <= 40))].slice(0, 12); }
