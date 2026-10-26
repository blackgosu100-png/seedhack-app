// 1단계 기획안 — writeBrief(input, { log, model, useCli, webSearch }) → { brief, how: "cli"|"rules", costUsd, elapsedMs, error? }
//   input: { title_ko, keyword, category, coupangName, attrs_ko[], ocr_ko[], detailText_ko } (briefInputFrom(copyInput) 으로 CopyInput 에서 만들 수 있다)
//   CLI 없음/실패/형식 오류 → rulesBrief(규칙 기본 기획안). 검색(WebSearch)은 webSearch:false 로 끌 수 있다.
import { runStructured, cliAvailable } from "./cli.js";
import { BRIEF_SYSTEM, BRIEF_SCHEMA, renderBriefInput } from "./brief-prompt.js";
import { validateCopy, lintCopy, bannedIn, policyKind } from "./copy.js";

const S = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = S(s); return s.length <= n ? s : s.slice(0, n).replace(/[\s,·:(]+[^\s,·:(]*$/, "").trim() || s.slice(0, n); };
const uniq = (a) => [...new Set(a)];

// CopyInput(copy.js buildCopyInput) → BriefInput
export function briefInputFrom(copyInput = {}) {
  return {
    title_ko: S(copyInput.title_ko), keyword: S(copyInput.keyword), category: S(copyInput.category), coupangName: S(copyInput.coupangName),
    attrs_ko: (copyInput.attrs || []).map((a) => `${S(a.k_ko || a.k_zh)}: ${S(a.v_ko || a.v_zh)}`).filter((t) => t !== ": "),
    ocr_ko: uniq((copyInput.images || []).flatMap((im) => im.texts_ko || []).map(S).filter((t) => t && !/[一-鿿]/.test(t))),
    detailText_ko: S(copyInput.detailText_ko),
  };
}

// 카테고리별 기본 기획안(검색·AI 없이) — 상품군 키워드로 고른다
const CATEGORY_BRIEFS = [
  { re: /바구니|수납|정리|박스|상자|선반|서랍|바스켓|빨래통|세탁물/, who: "물건이 자꾸 쌓이는 1~2인 가구·가정", situation: "정리할 자리가 없어 어수선할 때", desire: "한눈에 보이게 깔끔하게 정리하고 싶다", problem: "둘 곳이 없고 꺼낼 때 뒤섞인다",
    factors: ["크기·용량이 맞는가", "튼튼한가", "접거나 쌓을 수 있는가", "세척이 쉬운가", "디자인이 어울리는가"], objections: ["생각보다 작지 않을까", "금방 찌그러지지 않을까", "냄새가 나지 않을까", "색이 사진과 같을까", "세척이 번거롭지 않을까"],
    claims: ["대용량", "튼튼한 재질", "접이식", "다양한 색상"], angle: "두껍고 튼튼하게 만들어 가득 담아도 모양이 흐트러지지 않습니다" },
  { re: /건조대|옷걸이|행거|빨래\s*건조|세탁/, who: "베란다·세탁실이 좁은 가정", situation: "빨래 널 자리가 부족해 매번 고민할 때", desire: "좁은 공간에서도 빨래를 한 번에 널고 싶다", problem: "건조대가 자리를 차지하고 바람에 옷이 날아간다",
    factors: ["설치·사용이 쉬운가", "접어 두면 자리를 안 차지하는가", "무거운 빨래를 버티는가", "녹슬지 않는 재질인가", "구성품이 넉넉한가"], objections: ["벽이 상하지 않을까", "하중을 버틸까", "설치가 어렵지 않을까", "녹슬지 않을까", "사진과 같을까"],
    claims: ["넉넉한 하중", "간편 설치", "접이식 공간 절약", "녹 방지 재질"], angle: "쓸 때만 펼치고 접어 두면 사라져 좁은 베란다에서도 빨래를 한 번에 넙니다" },
  { re: /주방|식기|컵|냄비|도마|조리|그릇|수저/, who: "매일 요리하는 가정", situation: "조리·설거지가 번거로울 때", desire: "빠르고 깔끔하게 요리와 뒷정리를 끝내고 싶다", problem: "도구가 불편하고 세척이 번거롭다",
    factors: ["세척이 쉬운가", "안전한 재질인가", "크기가 적당한가", "내구성", "보관이 쉬운가"], objections: ["재질이 안전할까", "금방 망가지지 않을까", "크기가 맞을까", "세척이 번거롭지 않을까", "냄새가 배지 않을까"],
    claims: ["안전 재질", "쉬운 세척", "튼튼함", "깔끔한 디자인"], angle: "매일 쓰는 도구라 세척과 보관이 편하도록 만들었습니다" },
];
const DEFAULT_BRIEF = { who: "실용적인 생활용품을 찾는 가정", situation: "지금 쓰는 물건이 불편해 바꾸려 할 때", desire: "매일 쓰기 편하고 오래 가는 제품을 갖고 싶다", problem: "싸게 샀다가 금방 망가져 다시 사게 된다",
  factors: ["사용이 편한가", "튼튼한가", "크기·구성이 맞는가", "관리가 쉬운가", "디자인이 어울리는가"], objections: ["사진과 같을까", "금방 망가지지 않을까", "크기가 맞을까", "냄새·재질이 괜찮을까", "설명대로 쓰기 쉬울까"],
  claims: ["튼튼한 재질", "간편한 사용", "깔끔한 디자인"], angle: "매일 쓰는 물건이라 편한 쓰임새를 먼저 생각해 만들었습니다" };

export function rulesBrief(input = {}) {
  const key = `${input.keyword || ""} ${input.title_ko || ""} ${input.category || ""} ${input.coupangName || ""}`;
  const c = CATEGORY_BRIEFS.find((b) => b.re.test(key)) || DEFAULT_BRIEF;
  const evidence = uniq([...(input.attrs_ko || []).slice(0, 3), ...(input.ocr_ko || []).filter((t) => t.length >= 6).slice(0, 3)]).map((t) => clip(t, 60));
  return {
    persona: { who: c.who, situation: c.situation }, top_desire: c.desire, top_problem: c.problem,
    buying_factors: c.factors.slice(0, 5), objections: c.objections.slice(0, 5), competitor_claims: c.claims.slice(0, 5),
    angle: clip(c.angle, 50),
    evidence, tone: /가구|프리미엄|고급/.test(key) ? "premium" : "friendly", research_note: "",
  };
}

export function validateBrief(brief) { return validateCopy(brief, BRIEF_SCHEMA); }

// 금지어·정책 약속·길이 보정. 빈 칸은 규칙 기본값으로
export function sanitizeBrief(brief, input = {}) {
  const r = rulesBrief(input), fixes = [];
  const txt = (v, path, n, fb) => { let t = clip(v, n); if (t && (bannedIn(t).length || policyKind(t))) { fixes.push(`${path}: 금지어/정책 약속 → 기본값`); t = ""; } return t || S(fb); };
  const arr = (v, path, n, max, min, fb) => { const a = uniq((Array.isArray(v) ? v : []).map((x, i) => txt(x, `${path}[${i}]`, n, "")).filter(Boolean)); for (const f of fb) if (a.length < min && !a.includes(f)) a.push(f); return a.slice(0, max); };
  const b = brief && typeof brief === "object" ? brief : {};
  return { brief: {
    persona: { who: txt(b.persona?.who, "persona.who", 40, r.persona.who), situation: txt(b.persona?.situation, "persona.situation", 60, r.persona.situation) },
    top_desire: txt(b.top_desire, "top_desire", 50, r.top_desire), top_problem: txt(b.top_problem, "top_problem", 50, r.top_problem),
    buying_factors: arr(b.buying_factors, "buying_factors", 40, 5, 3, r.buying_factors), objections: arr(b.objections, "objections", 40, 5, 3, r.objections),
    competitor_claims: arr(b.competitor_claims, "competitor_claims", 40, 5, 0, r.competitor_claims),
    angle: txt(b.angle, "angle", 60, r.angle), evidence: arr(b.evidence, "evidence", 80, 6, 0, r.evidence),
    tone: ["friendly", "premium", "pop"].includes(b.tone) ? b.tone : r.tone, research_note: txt(b.research_note, "research_note", 160, ""),
  }, fixes };
}

export async function writeBrief(input, { log = () => {}, model = process.env.SIGNAL_AI_MODEL || "sonnet", useCli, timeoutMs = 300000, webSearch = true } = {}) {
  const t0 = Date.now();
  const wantCli = useCli === true || (useCli == null && cliAvailable());
  let ai = null, error;
  if (wantCli) {
    log("dim", `  🧭 기획안 요청 (Claude CLI·${model}${webSearch ? "·WebSearch" : ""})`);
    ai = await runStructured({ purpose: "brief", system: BRIEF_SYSTEM, schema: BRIEF_SCHEMA, text: renderBriefInput(input), model, timeoutMs, allowedTools: webSearch ? ["WebSearch"] : null });
    if (ai?.error) { error = ai.error; log("dim", `  🧭 기획안 실패 → 규칙 기본 기획안 · ${error}`); }
  }
  const elapsedMs = Date.now() - t0;
  if (ai?.ok) {
    const v = validateBrief(ai.result);
    const fatal = v.errors.filter((e) => /없음|이어야 하는데/.test(e));
    if (fatal.length) { error = `기획안 형식 오류: ${fatal.slice(0, 3).join("; ")}`; log("dim", `  🧭 ${error} → 규칙 기본 기획안`); }
    else {
      const { brief, fixes } = sanitizeBrief(ai.result, input);
      if (!lintCopy(brief).ok) { error = "기획안에 금지어가 남음"; }
      else {
        log("go", `■ 기획안 완성 (${ai.model}) · ${(elapsedMs / 1000).toFixed(1)}초${ai.costUsd != null ? ` · $${Number(ai.costUsd).toFixed(3)}` : ""} · 각도: ${brief.angle}`);
        return { brief, how: "cli", model: ai.model, costUsd: ai.costUsd ?? null, usage: ai.usage || null, elapsedMs, fixes, raw: ai.result };
      }
    }
  }
  return { brief: rulesBrief(input), how: "rules", tried: ai ? "cli" : null, error, model: ai?.model, costUsd: ai?.costUsd ?? null, elapsedMs, fixes: [] };
}

// ─────────────────────────────── v3: Moast keyContent 7단 + styleGuide ───────────────────────────────
import { BRIEF_V3_SYSTEM, BRIEF_V3_SCHEMA, KEYCONTENT_SCHEMA, STYLEGUIDE_SCHEMA, PLAN_PARTS, renderBriefV3Input } from "./brief-prompt.js";
import { fixTranslation as _fixTr, productNoun as _productNoun, inputNumbers as _inputNumbers, stripForeignNumbers as _strip, scrubPolicy as _scrubPolicy, scrubWholesale as _scrubWholesale } from "./copy.js";

const HEXRE = /^#[0-9a-f]{6}$/i;
const hex = (v, fb) => (HEXRE.test(S(v)) ? S(v).toLowerCase() : fb);

// CopyInput + vision + palette → BriefV3Input
export function briefV3InputFrom(copyInput = {}, { vision = null, palette = null, photos = [], brief_text = "" } = {}) {
  const vById = new Map((Array.isArray(vision) ? vision : vision?.items || []).map((v) => [v.id, v]));
  return {
    title_zh: S(copyInput.title_zh), title_ko: S(copyInput.title_ko), keyword: S(copyInput.keyword),
    attrs_ko: (copyInput.attrs || []).map((a) => `${S(a.k_ko || a.k_zh)}: ${S(a.v_ko || a.v_zh)}`),
    options_ko: (copyInput.options || []).map((o) => S(o.label_ko || o.label_zh)).filter(Boolean),
    // 이미지 글: 번역(용어집·斤 환산 보정) + 중국어 원문을 같이 넘겨 모델이 직접 확인하게
    images: (copyInput.images || []).map((im) => { const pairs = (im.texts_ko || []).map((ko, k) => ({ zh: S(im.texts_zh?.[k]), ko: _fixTr(im.texts_zh?.[k], ko) })).filter((p) => p.ko && !/[\u4e00-\u9fff]/.test(p.ko)); return { id: im.id, kind: im.kind, texts_ko: pairs.map((p) => p.ko), texts_zh: pairs.map((p) => p.zh), shows: vById.get(im.id)?.usable === false ? "" : S(vById.get(im.id)?.shows) }; }),
    palette, photos, brief_text: S(brief_text) ? String(brief_text) : "",
    _numbers: [..._inputNumbers(copyInput)],
  };
}

// 규칙 기본 기획서(AI 없이) — 기존 rulesBrief(카테고리) + 속성 스펙
export function rulesBriefV3(input = {}) {
  const b = rulesBrief({ title_ko: input.title_ko, keyword: input.keyword, attrs_ko: input.attrs_ko, ocr_ko: (input.images || []).flatMap((i) => i.texts_ko || []) });
  const noun = _productNoun({ keyword: input.keyword, title_ko: input.title_ko });
  const specs = (input.attrs_ko || []).map((t) => { const [k, ...v] = String(t).split(":"); return { k: S(k), v: S(v.join(":")) }; })
    .filter((r) => r.k && r.v && !/[一-鿿]/.test(r.k + r.v) && !/상표|브랜드|품번|최소|주문|재고|공급|원산지/.test(r.k)).slice(0, 12);
  return {
    product_name_ko: clip(`${noun === "이 상품" ? "" : noun} ${b.buying_factors[1] ? "" : ""}`.trim() || noun, 40),
    product_type: clip(noun, 30), key_appeal: clip(`${b.top_desire}. ${b.angle}`, 120),
    advantages: uniq([b.angle, ...b.competitor_claims]).slice(0, 6), specs, targets: [b.persona.who, ...b.objections.slice(0, 0)].filter(Boolean).slice(0, 5),
    plan_direction: [
      { part: "첫 화면", text: `${b.top_desire} — 대표 사진과 한 줄 혜택` }, { part: "초반", text: `${b.top_problem} 공감 후 핵심 장점 2~3개` },
      { part: "중반", text: "기능별 포인트를 사진과 함께" }, { part: "디테일", text: "소재·이음새·부품 클로즈업" },
      { part: "후반", text: "사이즈·옵션 안내" }, { part: "마지막", text: "스펙·구성·주의사항·FAQ" }],
    caution: ["확인되지 않은 하중·내구 수치는 제조사 표시 기준으로만 표기", "인증·특허 표현은 원문 근거가 있을 때만", "사진 속 소품은 구성품이 아닐 수 있음", "완벽·영구·절대 같은 단정 표현 금지"],
  };
}
export function rulesStyleGuide(palette = null) {
  const dom = (palette?.dominant || []).filter((h) => HEXRE.test(h));
  const pal = [...dom, "#1f2937", "#6b7280", "#d1d5db", "#f3f4f6", "#ffffff"].slice(0, 5);
  return { palette: pal, accents: [hex(palette?.accent, pal[0])], background: hex(palette?.bg, "#f5f5f5"),
    backgroundTone: "밝은 라이트 그레이를 중심으로 제품이 돋보이는 정돈된 단색 톤", lighting: "창가에서 들어오는 부드러운 자연광과 은은한 확산광을 기본으로, 제품 가장자리에 가벼운 하이라이트와 짧고 옅은 그림자", materialMood: "제품 소재의 질감이 그대로 보이는 사실적이고 깔끔한 생활 공간 무드",
    typographyTone: "여백이 넉넉한 미니멀 산세리프 중심의 단정한 스타일. 핵심 기능과 수치는 짧고 명확하게, 본문은 부드러운 다크 그레이",
    consistencyRules: ["모든 섹션은 같은 밝은 배경 톤을 주조색으로 쓰고 강한 원색·과도한 고대비 배경은 피한다.", "제품 가장자리에는 은은한 그림자와 충분한 명도 차이를 둬 배경에 묻히지 않게 한다.", "조명은 부드러운 자연광 또는 확산광으로 통일하고 그림자는 짧고 부드럽게 처리한다.",
      "제품 소재는 실제 질감대로 표현하고 과도한 반사나 플라스틱 같은 광택을 쓰지 않는다.", "연출 소품은 보조 요소로만 쓰고 제품보다 눈에 띄지 않게 한다.", "포인트 색은 팔레트의 포인트 범위 안에서 기능 강조·아이콘에만 쓴다.",
      "스펙·기능 정보는 같은 텍스트 색·얇은 구분선·같은 정보 박스 스타일로 통일한다.", "사진은 테두리 없이 꽉 차게 쓰고 글자는 사진 밖 여백에 둔다.", "사용 장면 섹션도 밝고 정돈된 분위기를 유지하고 배경 소품은 최소화한다.", "제품 이미지가 없는 섹션도 같은 배경·조명·질감·톤앤매너를 유지한다."],
    forbiddenProductUsage: "제품 사진이 없는 섹션에 제품을 새로 그려 넣지 않는다. 입력 사진과 다른 모양의 제품을 만들지 않는다." };
}

// 기획서 → 사람이 읽고 고치는 글(Moast 와 같은 제목·불릿)
export function briefToText(kc = {}) {
  const L = [`상품명: ${kc.product_name_ko || ""}`, "", `상품 유형: ${kc.product_type || ""}`, "", `핵심 소구: ${kc.key_appeal || ""}`, "", "주요 장점:"];
  for (const a of kc.advantages || []) L.push(`- ${a}`);
  L.push("", "상세 구성/스펙:"); for (const s of kc.specs || []) L.push(`- ${s.k}: ${s.v}`);
  L.push("", "추천 타겟:"); for (const t of kc.targets || []) L.push(`- ${t}`);
  L.push("", "상세페이지 기획 방향:"); for (const p of kc.plan_direction || []) L.push(`- ${p.part}: ${p.text}`);
  L.push("", "주의할 표현:"); for (const c of kc.caution || []) L.push(`- ${c}`);
  return L.join("\n");
}
// 사람이 고친 글 → 구조(제목 순서·불릿이 조금 달라도 읽는다)
export function parseBriefText(text = "") {
  const kc = { product_name_ko: "", product_type: "", key_appeal: "", advantages: [], specs: [], targets: [], plan_direction: [], caution: [] };
  const HEAD = [[/^(상품\s*유형|제품\s*유형)/, "product_type"], [/^(핵심\s*소구|소구\s*포인트)/, "key_appeal"], [/^(주요\s*장점|장점)/, "advantages"], [/^(상세\s*구성|구성\s*[\/·]?\s*스펙|스펙|사양)/, "specs"],
    [/^(추천\s*타겟|타겟|추천\s*대상)/, "targets"], [/^(상세페이지\s*기획\s*방향|기획\s*방향)/, "plan_direction"], [/^(주의할\s*표현|주의)/, "caution"]];
  // 기획 방향 불릿 → 구간(문장 속 "첫 화면/초반부/중반부/이어서·디테일/후반부/마지막")
  const partOf = (t, idx) => { const m = [[/첫\s*화면/, "첫 화면"], [/초반/, "초반"], [/중반/, "중반"], [/디테일|이어서|확대/, "디테일"], [/후반/, "후반"], [/마지막|끝으로/, "마지막"]].find(([re]) => re.test(t)); return m ? m[1] : PLAN_PARTS[Math.min(idx, 5)]; };
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const name = line.match(/^(?:상품명|제품명)\s*[:：]\s*(.+)$/); if (name) { kc.product_name_ko = S(name[1]); continue; }
    const bare = line.replace(/^(?:■|#+|\d+[.)])\s*/, "").replace(/^\[|\]$/g, "");
    const hk = !/^[-•*·]/.test(line) && HEAD.find(([re]) => re.test(bare));
    if (hk) { cur = hk[1]; const rest = bare.replace(hk[0], "").replace(/^[^:：]*[:：]\s*/, (m) => (/[:：]/.test(m) ? "" : m)).trim(); const inline = bare.includes(":") || bare.includes("：") ? S(bare.split(/[:：]/).slice(1).join(":")) : ""; if (inline) addTo(cur, inline); void rest; continue; }
    if (!cur) continue;
    addTo(cur, line.replace(/^[-•*·]\s*/, ""));
  }
  function addTo(k, body) {
    body = S(body); if (!body) return;
    if (k === "product_type" || k === "key_appeal") kc[k] = S(`${kc[k]} ${body}`);
    else if (k === "specs") { const m = body.match(/^([^:：]{1,24})[:：]\s*(.+)$/); if (m) kc.specs.push({ k: S(m[1]), v: S(m[2]) }); }
    else if (k === "plan_direction") { const m = body.match(/^(첫 화면|초반|중반|디테일|후반|마지막)\s*[:：]\s*(.+)$/); kc.plan_direction.push(m ? { part: m[1], text: S(m[2]) } : { part: partOf(body, kc.plan_direction.length), text: body }); }
    else kc[k].push(body);
  }
  return kc;
}

// 정화: 금지어·정책 약속·도매 문구·근거 없는 수치(specs 는 입력 수치만)·길이
export function sanitizeBriefV3(kc = {}, input = {}) {
  const r = rulesBriefV3(input), fixes = [];
  const allowed = new Set(input._numbers || []);
  const t = (v, path, n, fb = "") => { let s = clip(v, n); if (!s) return fb; if (bannedIn(s).length) { fixes.push(`${path}: 금지어 → 제거`); return fb; } const p = _scrubPolicy(s, { short: true }); if (p.hits.length) { fixes.push(`${path}: 정책 약속 → 제거`); s = p.text; } const w = _scrubWholesale(s); if (w.hits) s = w.text; if (allowed.size) { const x = _strip(s, allowed); if (x.removed.length) { fixes.push(`${path}: 원문에 없는 수치(${x.removed.join(",")}) 제거`); s = x.text; } } return s || fb; };
  const arr = (v, path, n, max) => uniq((Array.isArray(v) ? v : []).map((x, i) => t(x, `${path}[${i}]`, n)).filter(Boolean)).slice(0, max);
  const out = {
    product_name_ko: t(kc.product_name_ko, "product_name_ko", 40, r.product_name_ko), product_type: t(kc.product_type, "product_type", 40, r.product_type), key_appeal: t(kc.key_appeal, "key_appeal", 220, r.key_appeal),
    advantages: arr(kc.advantages, "advantages", 90, 10), targets: arr(kc.targets, "targets", 60, 5),
    specs: (Array.isArray(kc.specs) ? kc.specs : []).map((s, i) => ({ k: t(s?.k, `specs[${i}].k`, 20), v: t(s?.v, `specs[${i}].v`, 80) })).filter((s) => s.k && s.v && !/상표|브랜드|品牌/.test(s.k)).slice(0, 20),
    plan_direction: PLAN_PARTS.map((part) => { const p = (kc.plan_direction || []).find((x) => S(x?.part) === part); return { part, text: p ? t(p.text, `plan_direction.${part}`, 200) : "" }; }).map((p, i) => (p.text ? p : r.plan_direction[i])),
    caution: uniq((Array.isArray(kc.caution) ? kc.caution : []).map((c) => clip(c, 160)).filter(Boolean)).slice(0, 8),
  };
  for (const k of ["advantages", "targets", "specs", "caution"]) if (!out[k].length) out[k] = r[k];
  return { keyContent: out, fixes };
}
export function sanitizeStyleGuide(sg = {}, palette = null) {
  const r = rulesStyleGuide(palette);
  const pal = (Array.isArray(sg.palette) ? sg.palette : []).map((h) => hex(h, null)).filter(Boolean);
  const acc = (Array.isArray(sg.accents) ? sg.accents : []).map((h) => hex(h, null)).filter(Boolean).slice(0, 4);
  const rules10 = uniq((Array.isArray(sg.consistencyRules) ? sg.consistencyRules : []).map((x) => clip(x, 120)).filter(Boolean)).slice(0, 10);
  return { palette: pal.length === 5 ? pal : r.palette, accents: acc.length ? acc : r.accents,
    background: hex(sg.background, r.background), backgroundTone: clip(sg.backgroundTone, 160) || r.backgroundTone, lighting: clip(sg.lighting, 200) || r.lighting, materialMood: clip(sg.materialMood, 200) || r.materialMood,
    typographyTone: clip(sg.typographyTone, 200) || r.typographyTone, consistencyRules: rules10.length ? rules10 : r.consistencyRules,
    forbiddenProductUsage: clip(sg.forbiddenProductUsage, 300) || r.forbiddenProductUsage };
}

// Moast scrapper color 객체 → 우리 styleGuide 이름
export function styleGuideFromMoast(color = {}) {
  return { palette: (color.colorPalette || []).map((h) => S(h).toLowerCase()), accents: (color.accentColors || []).map((h) => S(h).toLowerCase()), background: S(color.backgroundColor).toLowerCase(),
    backgroundTone: S(color.backgroundTone), lighting: S(color.lighting), materialMood: S(color.materialMood), typographyTone: S(color.typographyTone),
    consistencyRules: (color.sectionConsistencyRules || []).map(S), forbiddenProductUsage: S(color.forbiddenProductUsageNote) };
}

// 템플릿 추천: 톤·배경 밝기·카테고리 → editorial/studio/clean/dark/pop
// v5(섹션 카드 구조)이면 기본 card — pop 은 아동·반려·컬러 소구가 상품 유형·타겟에 **명시**될 때만
export function recommendTemplate({ brief = null, styleGuide = null, palette = null, v5 = false } = {}) {
  const kc = brief?.keyContent || brief || {};
  const explicitPop = /아동|유아|키즈|어린이|아기|반려|강아지|고양이|펫|컬러풀|파스텔/.test(`${S(kc.product_type)} ${(kc.targets || []).join(" ")}`);
  if (v5) return explicitPop ? { templateId: "pop", why: "아동·반려·컬러 소구가 명시됨" } : { templateId: "card", why: "섹션 카드 구조(v5) 기본" };
  const txt = `${kc.product_type || ""} ${kc.key_appeal || ""} ${(kc.advantages || []).join(" ")} ${styleGuide?.materialMood || ""} ${styleGuide?.backgroundTone || ""}`;
  const lum = (h) => { const m = HEXRE.test(h || "") ? h.slice(1).match(/../g).map((x) => parseInt(x, 16)) : null; return m ? (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 : 0.9; };
  const bg = styleGuide?.background || palette?.bg;
  if (palette?.dark || lum(bg) < 0.35 || /프리미엄|고급|가죽|원목|무광 블랙|럭셔리/.test(txt)) return { templateId: "dark", why: "어두운 배경·고급 소재 톤" };
  // 상품 유형을 먼저 본다(장점 글의 "인테리어" 같은 말보다 카테고리가 우선)
  const CAT = [[/^$/, "pop", ""], [/주방|욕실|위생|세척|조리|커피|식기/, "clean", "주방·욕실·위생 상품 → 화이트 클린"],
    [/인테리어|미드센추리|화분|가구|감성|모던|원목|조명/, "editorial", "인테리어·공간 연출 상품 → 잡지형"], [/수납|정리/, "clean", "정리·수납 상품 → 화이트 클린"]];
  if (explicitPop) return { templateId: "pop", why: "아동·반려·컬러 소구가 명시됨" };
  for (const t of [S(kc.product_type), txt]) { const hit = CAT.slice(1).find(([re]) => re.test(t)); if (hit) return { templateId: hit[1], why: hit[2] }; }
  return { templateId: "editorial", why: "기본(사진 중심 잡지형)" };
}

// 1회 호출: keyContent + styleGuide. photos 가 있으면 Read 허용, webSearch 기본 끔
export async function writeBriefV3(input, { log = () => {}, model = process.env.SIGNAL_AI_MODEL || "sonnet", useCli, timeoutMs = 300000, webSearch = false } = {}) {
  const t0 = Date.now();
  const wantCli = useCli === true || (useCli == null && cliAvailable());
  const tools = [...((input.photos || []).length ? ["Read"] : []), ...(webSearch ? ["WebSearch"] : [])];
  let ai = null, error;
  // 사람이 고친 기획서가 있으면 그것을 최우선(구조로 파싱해 기본값으로 쓰고, AI 는 styleGuide·빈 칸만 채운다)
  const human = S(input.brief_text) ? parseBriefText(input.brief_text) : null;
  if (wantCli) {
    log("dim", `  🧭 기획서·디자인 톤 요청 (Claude CLI·${model}${tools.length ? "·" + tools.join("+") : ""})`);
    ai = await runStructured({ purpose: "brief-v3", system: BRIEF_V3_SYSTEM, schema: BRIEF_V3_SCHEMA, text: renderBriefV3Input(input), model, timeoutMs, allowedTools: tools.length ? tools : null });
    if (ai?.error) { error = ai.error; log("dim", `  🧭 기획서 실패 → 규칙 기본 · ${error}`); }
  }
  const elapsedMs = Date.now() - t0;
  const src = ai?.ok ? ai.result : {};
  const merged = human ? { ...src.keyContent, ...Object.fromEntries(Object.entries(human).filter(([, v]) => (Array.isArray(v) ? v.length : S(v)))) } : src.keyContent;
  const { keyContent, fixes } = sanitizeBriefV3(merged || {}, input);
  const styleGuide = sanitizeStyleGuide(src.styleGuide || {}, input.palette);
  const how = ai?.ok ? "cli" : "rules";
  if (ai?.ok) log("go", `■ 기획서·디자인 톤 완성 (${ai.model}) · ${(elapsedMs / 1000).toFixed(1)}초${ai.costUsd != null ? ` · $${Number(ai.costUsd).toFixed(3)}` : ""}`);
  return { brief: keyContent, styleGuide, brief_text: briefToText(keyContent), human: !!human, how, model: ai?.model, costUsd: ai?.costUsd ?? null, usage: ai?.usage || null, elapsedMs, fixes, error, raw: ai?.result || null, template: recommendTemplate({ brief: keyContent, styleGuide, palette: input.palette }) };
}
export { KEYCONTENT_SCHEMA, STYLEGUIDE_SCHEMA };
export const isBriefV3Like = (b) => !!b && (b.keyContent != null || b.key_appeal != null || Array.isArray(b.plan_direction));
