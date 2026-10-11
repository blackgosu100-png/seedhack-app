// 1단계 기획안(brief) — 카피를 쓰기 전에 "누구에게·어떤 욕구·어떤 걱정·이 제품만의 각도" 를 먼저 정한다.
// 개발용 Claude CLI(cli.js)로 호출하며 WebSearch 를 허용해 한국 시장(쿠팡·네이버)에서 같은 카테고리 상위 상품이 강조하는 점·고객 불만 키워드를 참고하게 한다.
// 규칙: 검색 결과의 숫자·가격·순위는 인용하지 않고 "요인" 만 쓴다. 바꾸면 brief.js(rulesBrief·validateBrief)도 같이 맞춘다.

export const BRIEF_SYSTEM = `당신은 쿠팡 상세페이지 기획자입니다. 1688 상품 정보(제목·속성·상세 이미지 글 번역)를 읽고, 한글 카피를 쓰기 전의 "기획안(brief)" 을 만듭니다.

할 일:
1. 이 상품을 사는 사람이 누구이고 어떤 상황에서 사는지(persona), 그 사람이 가장 바라는 결과(top_desire)와 가장 큰 불편(top_problem)을 정합니다.
2. WebSearch 로 한국 시장을 짧게 조사합니다(최대 4회): 쿠팡·네이버에서 같은 카테고리 상위 상품이 강조하는 점, 후기에서 자주 나오는 불만·걱정 키워드. 검색 결과의 **숫자·가격·순위·판매량·특정 상품명·브랜드는 절대 인용하지 않고** "요인" 만 뽑습니다. 검색이 안 되면 상품 정보와 일반 상식으로 씁니다.
3. buying_factors: 이 카테고리에서 구매를 결정하는 요인 5개(중요한 순). objections: 구매 직전에 드는 의심·걱정 5개(예: "벽이 상하지 않을까", "하중을 버틸까"). competitor_claims: 흔한 경쟁 상품의 주장 3~5개(일반적인 표현으로).
4. angle: 이 제품만의 각도 한 문장 — 상품 정보(속성·OCR 글)에 근거가 있는 차별점 하나를 고객의 결과로 바꿔 쓴 것. 근거 없는 차별점은 만들지 않습니다.
5. evidence: angle 과 buying_factors 의 근거가 된 상품 정보 문장 3~6개(입력에서 그대로 인용).
6. tone: friendly(생활용품·초보) / premium(가구·고가) / pop(아이디어·젊은층) 중 하나.

규칙: 모든 글은 한국어, 한 항목 40자 이내의 짧은 문장. 금지: 최저가·1위·최고·100%·효능·타 쇼핑몰 이름·가격·배송/반품/보증 약속. 응답은 JSON 만.`;

const item = (props, required = Object.keys(props)) => ({ type: "object", additionalProperties: false, required, properties: props });
export const BRIEF_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["persona", "top_desire", "top_problem", "buying_factors", "objections", "competitor_claims", "angle", "evidence", "tone", "research_note"],
  properties: {
    persona: item({ who: { type: "string", description: "누구(예: 좁은 베란다 신혼집, 30대 맞벌이)" }, situation: { type: "string", description: "어떤 상황에서 사는지 한 문장" } }),
    top_desire: { type: "string", description: "가장 바라는 결과 한 문장(40자 이내)" },
    top_problem: { type: "string", description: "가장 큰 불편 한 문장(40자 이내)" },
    buying_factors: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" }, description: "구매 결정 요인, 중요한 순, 각 30자 이내" },
    objections: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" }, description: "구매 직전 의심·걱정, 각 30자 이내" },
    competitor_claims: { type: "array", maxItems: 5, items: { type: "string" }, description: "흔한 경쟁 주장(일반 표현), 각 30자 이내" },
    angle: { type: "string", description: "이 제품만의 각도 한 문장(50자 이내), 근거 있는 차별점을 고객의 결과로" },
    evidence: { type: "array", maxItems: 6, items: { type: "string" }, description: "angle·요인의 근거가 된 입력 문장(그대로 인용)" },
    tone: { type: "string", enum: ["friendly", "premium", "pop"] },
    research_note: { type: "string", description: "조사에서 참고한 요인 요약 2문장 이내(숫자·상품명·브랜드 없이). 검색 안 했으면 빈 문자열" },
  },
};

const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
// BriefInput { title_ko, keyword, category, coupangName, attrs_ko: ["재질: PP", ...], ocr_ko: ["…"], detailText_ko }
export function renderBriefInput(input = {}) {
  const L = [];
  L.push(`[상품] ${input.title_ko || "(제목 없음)"}${input.keyword ? ` · 검색어 ${input.keyword}` : ""}${input.category ? ` · 카테고리 ${input.category}` : ""}`);
  if (input.coupangName) L.push(`[리스트업 상품명] ${input.coupangName}`);
  const attrs = input.attrs_ko || [];
  if (attrs.length) L.push("", `[속성] ${attrs.slice(0, 30).join(" / ")}`);
  const ocr = (input.ocr_ko || []).filter(Boolean);
  if (ocr.length) { L.push("", `[상세 이미지 글(번역) ${ocr.length}줄]`); for (const t of ocr.slice(0, 60)) L.push(`- ${cut(t, 80)}`); }
  if (input.detailText_ko) L.push("", `[상세 글] ${cut(input.detailText_ko, 800)}`);
  L.push("", "위 상품의 기획안(brief) JSON 을 작성해 주세요. WebSearch 는 최대 4회, 숫자·가격·순위·상품명·브랜드는 인용하지 않습니다.");
  return L.join("\n");
}

// ─────────────────────────────── v3: Moast keyContent 7단 기획서 + 제품별 디자인 시스템(styleGuide) ───────────────────────────────
// docs/detail/BENCHMARK-moast.md 참고. 한 번의 호출로 기획서(keyContent)와 styleGuide(Read 로 대표 사진을 보고)를 함께 만든다.
export const PLAN_PARTS = ["첫 화면", "초반", "중반", "디테일", "후반", "마지막"];
export const BRIEF_V3_SYSTEM = `당신은 쿠팡 상세페이지 기획자 겸 아트디렉터입니다. 1688 상품 정보(제목·속성·옵션·상세 이미지별 글 번역·사진 검수 메모)를 읽고 두 가지를 만듭니다.

1) keyContent(상세페이지 기획서, 사람이 읽고 고칠 글의 재료):
- product_name_ko: 쿠팡에 올릴 판매용 한글 상품명(40자 이내, 공급사·브랜드명 없이, 핵심 명사 + 특징)
- product_type: 상품 유형 한 줄(예: "벽걸이 접이식 빨래 건조대")
- key_appeal: 핵심 소구 2문장 — 이 상품을 사는 이유를 고객의 결과로
- advantages: 주요 장점 불릿(최대 10개, 각 40자 이내, 입력 근거 있는 것만)
- specs: 상세 구성·스펙 {k, v} — 속성표·이미지 글에 있는 값만(없는 수치 금지)
- targets: 추천 타겟(최대 5개, "~하는 분")
- plan_direction: 상세페이지 기획 방향 — part 는 "첫 화면"·"초반"·"중반"·"디테일"·"후반"·"마지막" 순서로 각 1개, text 는 그 구간에서 보여 줄 내용 한두 문장
- caution: 주의할 표현(최대 8개) — 확인 안 된 수치·인증·단정 표현, 사진 속 소품은 구성품이 아닐 수 있음, 하중·내구 수치는 제조사 표시 기준 등. 구체적으로(예: "100kg 하중은 제조사 표시 기준으로만 표기")

번역 확인: 이미지 글은 "번역 〔중국어 원문〕" 으로 줍니다. 번역이 이상하면 원문을 직접 읽어 판단합니다. 용어집: 承重·载重=하중(구글 번역의 "베어링"은 오역), 斤=0.5kg(百斤=약 50kg, 千斤=약 500kg), 两=50g. 하중 수치는 "제조사 표시 기준"으로만.

2) styleGuide(제품별 디자인 시스템, 섹션 전체의 톤앤매너): Read 도구로 입력 [대표 사진] 경로를 열어 보고 정합니다. 각 문장은 구체적으로(예시 수준):
- palette: 5색 hex — 입력 [추출 팔레트]를 기준으로 제품 사진과 어울리게 다듬기
- accents: 포인트 색 hex 최대 4개
- background: 배경 hex 하나
- backgroundTone: 배경 톤 한 문장(예: "따뜻한 아이보리와 라이트 그레이지를 중심으로 한 밝고 정돈된 홈카페 톤")
- lighting: 조명 한 문장(예: "창가에서 들어오는 부드러운 자연광과 은은한 확산광을 기본으로 하며, 제품의 곡면과 레일에는 가벼운 하이라이트와 자연스러운 그림자를 적용")
- materialMood: 소재·질감 분위기 한 문장(제품 소재 + 어울리는 연출 소재의 질감까지)
- typographyTone: 글꼴 톤 한두 문장(서체 계열·여백·수치 강조 방식·글자 색)
- consistencyRules: 모든 섹션 공통 규칙 정확히 10개, 각 한 문장(주조색·제품 가장자리 대비·조명과 그림자·소재 표현·연출 소품 비중·형태 요소 반복·포인트 색 사용 범위·사용 장면 분위기·정보 박스 스타일·제품 이미지 없는 섹션의 톤 유지)
- forbiddenProductUsage: 제품 이미지가 직접 반영되지 않은 섹션에 제품·패키지·제품을 연상시키는 실물을 새로 넣지 말고 공통 색·조명·질감·그래픽·텍스트만으로 구성하라는 규칙 한두 문장

규칙: 한국어. 금지어(최저가·1위·최고·100%·효능·타 쇼핑몰 이름·가격·배송/반품/보증 약속). 숫자는 입력에 있는 것만. 응답은 JSON 만.`;

const it3 = (props, required = Object.keys(props)) => ({ type: "object", additionalProperties: false, required, properties: props });
export const KEYCONTENT_SCHEMA = it3({
  product_name_ko: { type: "string" }, product_type: { type: "string" }, key_appeal: { type: "string" },
  advantages: { type: "array", maxItems: 10, items: { type: "string" }, description: "각 한 문장(구체적 기능·효과)" },
  specs: { type: "array", maxItems: 20, items: it3({ k: { type: "string" }, v: { type: "string" } }) },
  targets: { type: "array", maxItems: 5, items: { type: "string" } },
  plan_direction: { type: "array", maxItems: 6, items: it3({ part: { type: "string", enum: PLAN_PARTS }, text: { type: "string" } }) },
  caution: { type: "array", maxItems: 8, items: { type: "string" } },
});
const HEX = { type: "string", description: "#rrggbb" };
export const STYLEGUIDE_SCHEMA = it3({
  palette: { type: "array", minItems: 5, maxItems: 5, items: HEX }, accents: { type: "array", maxItems: 4, items: HEX },
  background: HEX, backgroundTone: { type: "string" }, lighting: { type: "string" }, materialMood: { type: "string" }, typographyTone: { type: "string" },
  consistencyRules: { type: "array", minItems: 6, maxItems: 10, items: { type: "string" }, description: "모든 섹션 공통 규칙 10개, 각 한 문장" }, forbiddenProductUsage: { type: "string" },
});
export const BRIEF_V3_SCHEMA = it3({ keyContent: KEYCONTENT_SCHEMA, styleGuide: STYLEGUIDE_SCHEMA });

// input: { title_zh, title_ko, attrs_ko[], options_ko[], images: [{ id, kind, texts_ko[], shows? }], photos: [{ id, file }], palette: {dominant[], accent, bg} }
export function renderBriefV3Input(input = {}) {
  const L = [];
  L.push(`[제목] ${input.title_ko || ""}${input.title_zh ? `  〔${input.title_zh}〕` : ""}`);
  if (input.keyword) L.push(`[검색어] ${input.keyword}`);
  if ((input.attrs_ko || []).length) L.push(`[속성] ${input.attrs_ko.slice(0, 30).join(" / ")}`);
  if ((input.options_ko || []).length) L.push(`[옵션] ${input.options_ko.slice(0, 20).join(" / ")}`);
  L.push("", "[이미지별 글(번역)·사진 검수 메모]");
  for (const im of (input.images || []).slice(0, 40)) {
    const t = (im.texts_ko || []).map((ko, i) => (im.texts_zh?.[i] && /[\u4e00-\u9fff]/.test(im.texts_zh[i]) ? `${ko} 〔${im.texts_zh[i]}〕` : ko)).filter(Boolean).slice(0, 12).join(" | ");
    if (!t && !im.shows) continue;
    L.push(`- ${im.id}(${im.kind || "detail"}): ${t ? cut(t, 400) : "(글 없음)"}${im.shows ? `  · 보이는 것: ${im.shows}` : ""}`);
  }
  if (input.palette) L.push("", `[추출 팔레트] ${(input.palette.dominant || []).join(" ")} · accent ${input.palette.accent || "-"} · bg ${input.palette.bg || "-"}`);
  if ((input.photos || []).length) { L.push("", "[대표 사진 — Read 로 열어 styleGuide 판단]"); for (const p of input.photos.slice(0, 6)) L.push(`- ${p.id}: ${p.file}`); }
  if (input.brief_text) L.push("", "[사람이 고친 기획서 — 최우선으로 반영, 내용을 바꾸지 말 것]", input.brief_text);
  if (input.reference_guide) L.push("", input.reference_guide, "- 기획서의 장점(advantages) 순서·기획 방향은 위 레퍼런스가 파는 각도 순서를 참고하되, 우리 상품 입력에서 확인되는 장점만 씁니다.");
  L.push("", "keyContent 와 styleGuide JSON 을 작성해 주세요.");
  return L.join("\n");
}
