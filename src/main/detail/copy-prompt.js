// 상세페이지 카피 — 지시문·응답 형식(JSON Schema)·입력 글.
// 개발용 Claude CLI(cli.js)와 서버 중계(task:"detail")가 같은 판단을 하도록 여기 한 곳에 둔다.
// 서버 사본: 대시보드 저장소 web/src/lib/signal-detail-copy.mjs (zod). 여기를 바꾸면 그쪽도 같이 바꾼다 — web/test/signal-detail-copy.test.mjs 가 글자 그대로 대조한다.
// Copy 형식은 docs/detail/CONTRACTS.md 6절. 바꾸면 copy.js(rulesCopy·validateCopy)도 같이 맞춘다.

export const COPY_SYSTEM = `당신은 쿠팡 상세페이지 전환 카피라이터입니다. 1688(중국 도매) 상품의 중국어 정보를 읽고, 한국 소비자가 "사고 싶다"고 느끼는 한글 상세페이지 문안을 씁니다.

원칙:
1. 첫 화면(headline·sub)은 상품 설명이 아니라 "고객이 얻는 결과·혜택"을 말합니다. (예: "빨래 더미가 사라지는 한 칸" ○ / "PP 재질 바구니" ×)
2. 구조는 고정입니다 — 공감(pain: 고객의 불편) → 해결(usp: 이 상품이 바꿔 주는 점) → 증거(captions: 상세 이미지마다 그 이미지가 보여 주는 사실, spec: 속성표) → 안심(package_items 구성, notice 주의, faq) → 행동(cta).
3. 숫자·재질·크기·용량·효능은 입력(제목·속성표·상세 글·이미지 OCR 번역)에 있는 것만 씁니다. 입력에 없는 수치·단위·재질을 절대 만들지 않습니다. 모르면 숫자 없이 씁니다.
4. 금지 표현: 최저가, 1위, 최고, 100%, 완치, 치료, 의학적 효능(항균·살균·피부 개선 등 입력에 없는 효과), 다른 쇼핑몰 이름(쿠팡·네이버·타오바오·1688 등), 가격·원·₩·할인율. 과장·비교 광고 금지.
5. 초보도 읽기 쉬운 짧은 문장, 존댓말. 한 줄 18~30자 안에서 끊습니다. 어려운 한자어 대신 쉬운 말.
6. 검색어(keyword)를 name_ko 와 headline 에 자연스럽게 넣습니다. name_ko 는 쿠팡 등록용 상품명(40자 이내, 키워드 + 핵심 특징 + 용도 순, 특수문자·이모지 없이).
7. captions 는 "이미지마다 한 개", 그 이미지의 OCR 번역 내용을 근거로 제목(18자 이내)·설명(2문장 이내)을 씁니다. OCR 글이 없는 이미지는 제목만 간단히(예: "실제 제품 모습") 쓰고 내용을 지어내지 않습니다.
8. usp 의 imageId 는 그 포인트를 가장 잘 보여 주는 입력 이미지 id(d01 같은 형식)만 씁니다. 없으면 null.
9. spec 은 속성표(attrs)의 한글 번역을 소비자가 보기 좋게 정리한 것만(원문에 없는 항목 추가 금지, 도매 전용 항목(최소주문·货号·品牌 등)은 뺌).
10. 캡션(captions.desc)에는 이미지가 보여 주는 "사실"만 씁니다. "실제 제품의 모습을 보여줍니다", "브랜드 로고가 표기된 모습입니다", "실제 체중 테스트 장면이며 위험한 동작은 따라하지 마세요" 같은 무의미한 설명·위험 안내·로고 언급은 금지합니다. 쓸 사실이 없으면 desc 를 빈 문자열로 둡니다.
11. labels: 입력의 [사진 위 짧은 라벨] 목록(사진 위에 남아 한글 띠로 덮을 글자)을 하나씩 자연스러운 짧은 한글로 번역합니다(10자 이내, 명사형). 수량 단위어(个·扇·只·件·套 등)는 "N개" 처럼 수량으로, 색상명·제품명은 한국 소비자가 쓰는 말로. 목록에 없는 라벨은 만들지 않습니다.
12. 중국 판매자의 판매 정책 약속(예: 7일 무조건 교환·반품, 무료배송, 당일 발송, 품질 보증·정품 보증, A/S 기간)은 입력에 있어도 옮기지 않습니다. 배송·교환·반품은 "교환·반품은 쿠팡 정책을 따릅니다", "배송 일정은 주문 화면 안내를 확인해 주세요" 처럼 중립 문장으로만 씁니다.
13. 단위 환산: 斤 = 0.5kg(百斤 = 50kg), 两 = 50g, 米 = m, 厘米 = cm. 환산한 수치는 원문 수치의 환산일 때만 씁니다.
14. 하중·내구·수명 수치("50kg까지 견딥니다" 등)는 반드시 "제조사 제공 기준" 을 앞에 붙여 씁니다. 사람이 매달리는 테스트·체중·몸무게 언급, "두 사람의 무게를 견딘다" 같은 표현은 쓰지 않습니다. 상세 화면 자체를 설명하는 문장("무게 테스트 장면입니다", "따라 하지 마세요")도 금지입니다.
15. 응답은 JSON 만. 모든 글은 한국어.`;

const item = (props, required = Object.keys(props)) => ({ type: "object", additionalProperties: false, required, properties: props });

// 구조화 출력 JSON Schema (CLI --json-schema 용). 길이 제한은 모델이 설명으로 지키고, 앱이 validateCopy/sanitizeCopy 로 다시 확인한다.
export const COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name_ko", "headline", "sub", "badges", "pain", "usp", "captions", "spec", "size_note", "package_items", "notice", "faq", "cta", "tone", "labels"],
  properties: {
    name_ko: { type: "string", description: "쿠팡 등록용 상품명. 40자 이내, 검색어 포함, 특수문자 없이" },
    headline: { type: "string", description: "첫 화면 한 줄. 18자 이내. 고객이 얻는 결과·혜택 중심" },
    sub: { type: "string", description: "첫 화면 보조 한 줄. 30자 이내" },
    badges: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" }, description: "첫 화면 배지 3개. 각 10자 이내. 원문 근거가 있는 특징만(무료배송·가격 금지)" },
    pain: item({
      title: { type: "string", description: "공감 섹션 제목(예: 이런 적 있으시죠?)" },
      items: { type: "array", minItems: 3, maxItems: 3, items: item({ icon: { type: "string", description: "이모지 1개" }, text: { type: "string", description: "고객의 불편 한 문장, 30자 이내" } }) },
    }),
    usp: item({
      title: { type: "string", description: "해결 섹션 제목(예: 그래서 이렇게 만들었습니다)" },
      items: { type: "array", minItems: 3, maxItems: 4, items: item({
        title: { type: "string", description: "핵심 포인트 제목, 14자 이내" },
        desc: { type: "string", description: "설명 1~2문장, 60자 이내, 입력에 있는 사실만" },
        imageId: { type: ["string", "null"], description: "이 포인트를 보여 주는 입력 이미지 id(d03 등). 없으면 null" },
      }) },
    }),
    captions: { type: "array", maxItems: 40, items: item({
      imageId: { type: "string", description: "입력 이미지 id" },
      title: { type: "string", description: "이미지 제목, 18자 이내" },
      desc: { type: "string", description: "이미지 설명, 2문장 이내. 그 이미지의 OCR 번역 내용 근거" },
    }), description: "상세(detail) 이미지마다 한 개씩, 입력 순서대로" },
    spec: { type: "array", maxItems: 12, items: item({ k: { type: "string" }, v: { type: "string" } }), description: "속성표 한글 정리. 원문에 있는 것만" },
    size_note: { type: "string", description: "사이즈 안내 한 줄(입력에 치수가 있을 때만, 없으면 빈 문자열)" },
    package_items: { type: "array", maxItems: 6, items: { type: "string" }, description: "구성품. 입력에 근거가 있을 때만, 없으면 ['본품']" },
    notice: { type: "array", maxItems: 6, items: { type: "string" }, description: "주의·안내 문장(색상 차이, 측정 오차, 배송 등)" },
    faq: { type: "array", minItems: 3, maxItems: 5, items: item({ q: { type: "string" }, a: { type: "string", description: "답변 2문장 이내, 입력에 있는 사실만" } }) },
    cta: item({ headline: { type: "string", description: "마지막 행동 유도 한 줄, 20자 이내" }, sub: { type: "string", description: "보조 한 줄, 30자 이내" } }),
    tone: { type: "string", enum: ["friendly", "premium", "pop"], description: "이 상품에 어울리는 말투" },
    labels: { type: "array", maxItems: 40, items: item({ imageId: { type: "string" }, zh: { type: "string", description: "입력 라벨 원문 그대로" }, ko: { type: "string", description: "짧은 한글 번역(10자 이내)" } }), description: "입력 [사진 위 짧은 라벨] 목록의 번역. 입력에 없으면 빈 배열" },
  },
};

const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

// CopyInput(CONTRACTS 6절) → 모델이 읽기 쉬운 글. 이미지는 id 와 함께 OCR 원문·번역을 나란히 보여 준다.
export function renderCopyInput(input = {}) {
  const L = [];
  L.push(`[검색어] ${input.keyword || "(없음)"}`);
  if (input.coupangName) L.push(`[리스트업 상품명] ${input.coupangName}`);
  if (input.category) L.push(`[카테고리] ${input.category}`);
  L.push(`[원문 제목] ${input.title_zh || "(없음)"}`);
  L.push(`[제목 번역] ${input.title_ko || "(없음)"}`);
  L.push("");
  const attrs = input.attrs || [];
  L.push(`[속성표] (${attrs.length}개)`);
  for (const a of attrs) L.push(`- ${a.k_ko || a.k_zh}: ${a.v_ko || a.v_zh}${a.k_ko && a.k_zh ? `  (원문 ${a.k_zh}: ${a.v_zh})` : ""}`);
  const opts = input.options || [];
  if (opts.length) L.push("", `[옵션] ${opts.map((o) => o.label_ko || o.label_zh).filter(Boolean).join(" / ")}`);
  if (input.detailText_ko) L.push("", `[상세 글 번역(요약)] ${cut(input.detailText_ko, 1500)}`);
  L.push("", `[이미지별 OCR 번역] (id · 종류 · 크기)`);
  for (const im of input.images || []) {
    const ko = (im.texts_ko || []).filter(Boolean), zh = (im.texts_zh || []).filter(Boolean);
    L.push(`${im.id} · ${im.kind || "detail"} · ${im.w || "?"}x${im.h || "?"}`);
    if (!ko.length && !zh.length) { L.push("   (글자 없음 — 사진만)"); continue; }
    const n = Math.max(ko.length, zh.length);
    for (let i = 0; i < Math.min(n, 30); i++) L.push(`   - ${cut(ko[i] || "", 120)}${zh[i] ? `  〔${cut(zh[i], 60)}〕` : ""}`);
  }
  const labels = input.labels || [];
  if (labels.length) { L.push("", `[사진 위 짧은 라벨 — labels 로 번역] (${labels.length}개)`); for (const l of labels.slice(0, 40)) L.push(`   - ${l.imageId}: ${l.zh}`); }
  L.push("", "위 정보만 근거로 Copy JSON 을 작성해 주세요. captions 는 detail 이미지마다 한 개씩 id 순서대로.");
  return L.join("\n");
}

// ─────────────────────────────── v2: 기획안(brief) 기반 PAS→AIDMA 구조 ───────────────────────────────
// 섹션: hero(욕구 중심) → problem(공감 3 = pain) → agitate(문제 심화) → solution(핵심 해결+angle) → benefits(핵심 포인트 3~4 = usp, 소제목 체인)
//        → proof(숫자 하이라이트 3) → compare(일반 vs 이 제품) → steps(사용 3단계) → objections(반론→해소) → trust(신뢰) → faq → cta
// JSON 키는 v1 과 호환: problem 은 pain 칸, benefits 는 usp 칸에 쓴다(템플릿 v1 도 그대로 읽을 수 있게).
export const COPY_SYSTEM_V2 = COPY_SYSTEM.replace(/^1\. 첫 화면.*$/m, `1. 첫 화면(headline·sub)은 기획안의 top_desire(고객이 가장 바라는 결과)를 그 사람의 말로 씁니다. 기능 나열("PP 재질 접이식 바구니") 금지, 결과("빨래 더미가 사라지는 한 칸")로.`) + `

v2 구조(기획안 brief 를 반드시 반영):
A. pain(=problem): brief.top_problem·persona 를 바탕으로 고객이 겪는 불편 3개(각 30자 이내, 같은 상황을 다른 각도로).
B. agitate: 그 불편이 쌓이면 어떻게 되는지 1~2문장(120자 이내). 과장·공포·건강 위협 금지, 일상적인 손해(시간·공간·기분)만.
C. solution: text = 핵심 해결 한 문장(60자 이내), angle = brief.angle 을 고객의 말로 다듬은 한 문장(50자 이내).
D. usp(=benefits): 핵심 포인트 3~4개. **소제목(title, 18자 이내)은 앞 소제목의 마지막 단어·개념을 받아 이어지게** 써서, 소제목만 모아 읽어도 한 문단이 되게 합니다(예: "접으면 사라지는 건조대" → "사라진 자리에 생기는 여유" → "여유를 지켜 주는 튼튼한 하중" → "하중을 버티는 두꺼운 알루미늄"). desc 는 60자 이내, 입력 근거가 있는 사실만. chain_check 에는 소제목들을 "→" 로 이은 한 줄을 씁니다.
E. proof: 숫자 하이라이트 3개 — 속성표·OCR 번역·상세 글에 있는 수치만(value 숫자, unit 단위, label 그 숫자가 고객에게 뜻하는 것 20자 이내). 근거 수치가 3개 미만이면 있는 만큼만. 하중 수치는 label 에 "제조사 제공 기준".
F. compare: 일반 제품 vs 이 제품 표 3~4행(item 비교 항목 12자, generic 일반 제품 20자, ours 이 제품 20자). 근거(입력 사실) 있는 항목만, 경쟁 상품을 깎아내리는 표현 금지. 근거가 없으면 rows 를 빈 배열로.
G. steps: 사용·설치 3단계(title 14자, desc 40자). 입력에 설치·사용법 근거가 있으면 그것을, 없으면 "받기 → 펼치기/놓기 → 쓰기" 수준의 일반 단계.
H. objections: brief.objections 에서 3~5개를 골라 q(걱정 그대로, 30자)·a(해소, 60자, 입력 사실 근거. 근거 없으면 "확인해 드립니다/문의 주세요" 로).
I. trust: 후기가 없을 때 믿음을 주는 항목 3~4개(각 40자): 소재·검수·구성·문의 안내. 과장·보증 약속 금지.
J. cta: headline 20자, sub 30자. 손실 회피 한 줄("지금 정리하면 이번 주말이 편해집니다")은 허용, "지금 안 사면 손해/마감 임박" 같은 압박 금지.
K. captions·spec·size_note·package_items·notice·faq·labels·badges·name_ko 규칙은 v1 과 같습니다. 글자 수 상한: 소제목 ≤18자, 설명 ≤60자.

editorial(잡지형 템플릿) 필드:
L. hero_en: title_en = 제품 정체성을 나타내는 영문 대문자 단어 2~3개(줄마다 한 단어, 예: ["BLACK","PLANT","SHELF"]), script = 분위기를 주는 영문 수식어 한 단어(필기체로 씀, 예: "Midcentury", "Minimal"). 브랜드·과장(BEST, NO.1) 금지.
M. keywords 4~5개: en(영문 대문자 한 단어), en_sub(영문 대문자 2~3단어의 자연스러운 명사구, 예: "360° ROTATION", "FOLDS TO 60CM", "WIND-LOCK HOLES" — 전치사로 시작하거나 숫자 없이 단위만 쓰지 않음, 숫자는 원문 근거만), ko(한글 8자 이내). 입력 근거가 있는 특징만.
N. for_you 4개: "이런 분께 추천" 목록(각 24자 이내, "~하는 분" 꼴). 기획안 persona·buying_factors 기반.
O. points: usp 와 같은 순서로 3~6개(label = 그 포인트의 기능명 한글 8자 이내 예: "접이식", "360° 회전" — "POINT 01" 같은 번호 금지, title ≤14자, desc 2줄 분량 ≤40자). feature 사진 순서에 맞춰 붙습니다.
P. callouts 4~5개: 제품 사진 위 지시선 라벨(label ≤10자, 부품·특징 이름 "접이 관절"·"두꺼운 프레임"). 좌표는 사진 검수에서 정하므로 라벨만.
Q. options_table: 속성표의 규격·사이즈(规格·尺寸·크기) 값이나 옵션 이름에 치수가 함께 있을 때만 {name 옵션 이름, size 치수} 행으로. 상세 이미지(OCR)의 치수 라벨을 조합해 만들지 않습니다. 없으면 빈 배열(사이즈는 size_note 문장으로).`;

export const COPY_SCHEMA_V2 = {
  type: "object", additionalProperties: false,
  required: [...COPY_SCHEMA.required, "agitate", "solution", "chain_check", "proof", "compare", "steps", "objections", "trust", "hero_en", "keywords", "for_you", "points", "callouts", "options_table"],
  properties: {
    ...COPY_SCHEMA.properties,
    pain: { ...COPY_SCHEMA.properties.pain, description: "problem 섹션: 기획안의 top_problem·persona 기반 불편 3개" },
    usp: { ...COPY_SCHEMA.properties.usp, description: "benefits 섹션: 소제목이 앞 소제목을 받아 이어지는 핵심 포인트 3~4개" },
    agitate: { type: "string", description: "문제 심화 1~2문장(120자 이내), 과장·공포 금지" },
    solution: item({ text: { type: "string", description: "핵심 해결 한 문장(60자 이내)" }, angle: { type: "string", description: "이 제품만의 각도 한 문장(50자 이내)" } }),
    chain_check: { type: "string", description: "usp 소제목들을 → 로 이은 한 줄(읽어서 한 문단이 되는지 확인용)" },
    proof: { type: "array", maxItems: 3, items: item({ value: { type: "string", description: "숫자만(예: 60, 1.2)" }, unit: { type: "string", description: "단위(L, kg, cm, 개 …)" }, label: { type: "string", description: "고객에게 뜻하는 것 20자 이내" } }), description: "입력 근거 수치만. 없으면 빈 배열" },
    compare: item({ rows: { type: "array", maxItems: 4, items: item({ item: { type: "string" }, generic: { type: "string" }, ours: { type: "string" } }) } }),
    steps: { type: "array", maxItems: 3, items: item({ title: { type: "string", description: "14자 이내" }, desc: { type: "string", description: "40자 이내" } }) },
    objections: { type: "array", minItems: 3, maxItems: 5, items: item({ q: { type: "string", description: "걱정 그대로 30자 이내" }, a: { type: "string", description: "해소 60자 이내, 입력 사실 근거" } }) },
    trust: item({ items: { type: "array", maxItems: 4, items: { type: "string" }, description: "소재·검수·구성·문의 안내, 각 40자 이내" } }),
    hero_en: item({ title_en: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" }, description: "영문 대문자 단어 2~3개" }, script: { type: "string", description: "영문 수식어 한 단어(필기체)" } }),
    keywords: { type: "array", minItems: 4, maxItems: 5, items: item({ en: { type: "string" }, en_sub: { type: "string" }, ko: { type: "string" } }) },
    for_you: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
    points: { type: "array", maxItems: 6, items: item({ label: { type: "string" }, title: { type: "string", description: "14자 이내" }, desc: { type: "string", description: "40자 이내" } }) },
    callouts: { type: "array", maxItems: 5, items: item({ label: { type: "string", description: "10자 이내" } }) },
    options_table: { type: "array", maxItems: 8, items: item({ name: { type: "string" }, size: { type: "string" } }), description: "규격·사이즈 옵션(입력에 있는 것만), 없으면 빈 배열" },
  },
};
export const EDITORIAL_KEYS = ["hero_en", "keywords", "for_you", "points", "callouts", "options_table"];

// v2 입력 글: v1 입력 + 기획안
export function renderCopyInputV2(input = {}, brief = null) {
  const L = [renderCopyInput(input)];
  if (brief && (brief.key_appeal || brief.plan_direction || brief.brief_text)) { // v3 기획서(Moast keyContent 7단)
    if (brief.brief_text) L.push("", "[사람이 확인·수정한 기획서 — 최우선, 이 내용과 다르게 쓰지 말 것]", String(brief.brief_text));
    L.push("", "[기획서 keyContent]");
    if (brief.product_name_ko) L.push(`- 판매용 상품명: ${brief.product_name_ko} (name_ko 는 이것을 기준으로)`);
    L.push(`- 상품 유형: ${brief.product_type || ""}`, `- 핵심 소구: ${brief.key_appeal || ""}`);
    if (brief.advantages?.length) L.push(`- 주요 장점: ${brief.advantages.join(" / ")}`);
    if (brief.targets?.length) L.push(`- 추천 타겟(for_you 로): ${brief.targets.join(" / ")}`);
    if (brief.plan_direction?.length) L.push(`- 기획 방향(이 순서로 내용을 배치): ${brief.plan_direction.map((p) => `${p.part}=${p.text}`).join(" → ")}`);
    if (brief.caution?.length) L.push(`- 주의할 표현(반드시 지킬 것): ${brief.caution.join(" / ")}`);
    L.push("", "v2 구조(pain=problem, agitate, solution, usp=benefits 소제목 체인, proof, compare, steps, objections, trust, faq, cta)로 Copy JSON 을 작성해 주세요. 기획 방향의 순서와 주의할 표현을 지킵니다.");
    return L.join("\n");
  }
  if (brief) {
    L.push("", "[기획안 brief — 반드시 반영]");
    L.push(`- 누구·상황: ${brief.persona?.who || ""} / ${brief.persona?.situation || ""}`);
    L.push(`- 가장 바라는 결과(top_desire): ${brief.top_desire || ""}`);
    L.push(`- 가장 큰 불편(top_problem): ${brief.top_problem || ""}`);
    L.push(`- 구매 결정 요인: ${(brief.buying_factors || []).join(" / ")}`);
    L.push(`- 구매 직전 걱정(objections 로 해소): ${(brief.objections || []).join(" / ")}`);
    if (brief.competitor_claims?.length) L.push(`- 흔한 경쟁 주장(같은 말 반복 금지, 다른 각도로): ${brief.competitor_claims.join(" / ")}`);
    L.push(`- 이 제품만의 각도(angle): ${brief.angle || ""}`);
    if (brief.evidence?.length) L.push(`- 근거 문장: ${brief.evidence.join(" | ")}`);
    L.push(`- 말투: ${brief.tone || "friendly"}`);
  }
  L.push("", "v2 구조(pain=problem, agitate, solution, usp=benefits 소제목 체인, proof, compare, steps, objections, trust, faq, cta)로 Copy JSON 을 작성해 주세요.");
  return L.join("\n");
}

// ─────────────────────────────── v5: 섹션 카드 카피(Moast 2단계 톤, card 템플릿) ───────────────────────────────
// 섹션 목록(plan-core planSectionsV5)이 먼저 정해지고, 섹션마다 짧은 글만 쓴다. 줄바꿈은 "\n"(2줄 필드는 정확히 1번).
export const V5_LIMITS = { name: 10, category: 14, sub: 26, label: 8, titleLine: 13, descLine: 26, calloutThin: 12, calloutBold: 10, placeLabel: 8 };
export const COPY_V5_SYSTEM = `당신은 쿠팡 상세페이지 카피라이터입니다. 섹션 목록이 이미 정해져 있고, 섹션마다 사진 한 장 위·아래에 얹을 짧은 글만 씁니다.

톤(참고): "가전 아래 숨은 공간의 기적", "숙이지 말고 부드럽게 당기세요" — 짧고 리듬 있게, 고객이 얻는 장면을 그리는 말. 기능 나열·과장 금지.
글자 수(반드시 지킴, 넘으면 잘림):
- hero: label(작은 머리글 ≤8자), category(상품 분류 ≤14자), name(제품 이름 ≤10자), sub(한 줄 혜택 ≤26자), icons 4개 label(≤8자, 특징 키워드)
- before_after: sub(≤26자), title_lines 2줄(줄당 ≤13자)
- checkpoint: title(≤13자), callouts 3~5개 {thin(가는 설명 ≤12자), bold(굵은 키워드 ≤10자)} — 제품 부품·특징
- features 3개(입력 장점 순서대로): title_lines 2줄(줄당 ≤13자), desc 2줄(줄당 ≤26자)
- options: title 2줄(줄당 ≤13자) — 규격 비교 안내
- detail: title(≤13자), items 2개 {title(≤13자), desc 2줄(줄당 ≤26자)} — 소재·부품 클로즈업
- versatility: title 2줄(줄당 ≤13자), sub(≤26자), items 4개 label(장소 이름 ≤8자) — 이 상품이 실제로 쓰일 장소만(기획서 타겟·기획 방향 기반, 입력 장소 목록에서 고르기). 주방·홈카페 상품에 욕실·침실 같은 어울리지 않는 장소 금지. 이 장소가 그대로 장면 사진으로 만들어진다.
- notice: title(≤13자), items 3~5개(각 ≤40자) — 고객에게 보이는 안내문만, "~입니다/~해 주세요/~있을 수 있습니다" 꼴(예: "사진 속 소품은 구성품에 포함되지 않습니다."). "~로만 표기", "노출하지 않음", "확인 필요" 같은 내부 작업 지시·메모 금지. 규격 이름은 섹션 목록 표기(예: 낮은형·높은형) 그대로.
- faq 3~4개 {q ≤26자, a ≤60자}
- 제목은 title_lines 2줄: 줄1 = 상황·기능, 줄2 = 이점이나 숫자 결론(예: ["3D로 퍼지는", "360° 입체 세척"], ["숙이지 말고", "부드럽게 당기세요"]). 줄당 ≤13자.
소제목 징검다리(가장 중요): 고객은 대제목→소제목→설명을 차례로 읽지 않고, 큰 제목만 징검다리처럼 건너뛰며 읽다가 걸리는 곳에서만 설명을 읽습니다. 그래서 problem.question → before_after → features 1·2·3 → detail.title → versatility 제목만 순서대로 읽어도 한 이야기로 흘러야 합니다.
- 각 제목의 첫 줄은 바로 앞 제목의 낱말·개념을 받아 시작하는 "받는 말"(보이지 않는 "그런데" 역할), 둘째 줄은 그 섹션의 진짜 주제(장점·숫자 결론).
- 좋은 예(다른 상품, 잇는 방식만 참고): ["사과 8알 대신", "식이섬유 15g을 쉽게"] → ["더 쉽게 마시도록", "새콤달콤 사과레몬맛"](받는 말 '더 쉽게') → ["중독되는 맛 뒤에", "식이섬유가 무려 7가지"](받는 말 '맛') → ["7가지의 비밀은", "유기농 과일채소 47종"] → ["과일 씻기보다 짧은", "단 10초면 충분해요"]
- 약한 예: "고함량 식이섬유 15g가 듬뿍!" / "어디에서도 본 적 없는 총 7종 식이섬유!" — 서로 모르는 독립 제목, 건너뛰며 읽으면 이야기가 끊김.
- 받는 말은 같은 낱말 반복이 아니어도 됩니다(새콤달콤 → 맛, 좁은 틈 → 남는 자리). 잇는 힘은 낱말이 아니라 논리: 질문 → 답, 장점 → 그 덕분에 생기는 다음 장점("더 쉽게"), 결과 → 이유("~의 비밀은", "~을 버티는"), 범위 넓히기("~뿐 아니라"). 확인법: "앞 제목, 그래서/그런데 이 제목"을 말로 해서 사람이 실제로 할 법한 말이면 합격.
- 억지 연결 금지: 낱말만 붙이고 뜻이 안 통하는 것(X "넓어진 공간처럼 / 37cm 폭조절", X "수납 속 규격과 소재", X "꼼꼼한 소재로 / 어디서든 활용 가능"). 앞 제목 끝 낱말을 기계적으로 되받는 끝말잇기도 금지(X "…37cm로 꽉" → "꽉 채워주는 폭", X "…맞춘 조절" → "맞춘 서랍은") — 받는 말은 앞 제목의 핵심 개념(주제·결과)을 받습니다. 명사만 쌓은 전보체도 금지(X "안쪽은 탄소강 두 규격", X "커피용품 넉넉 수납"). 이렇게 될 바에는 자연스러운 한국어가 우선 — 그 한 쌍만 독립 제목으로 둡니다. 뒤쪽 이음 요령: detail.title(한 줄)은 앞 장점의 이유(다른 상품 예: "가벼움의 비밀은 알루미늄"), versatility 는 범위 넓히기(예: "베란다뿐 아니라 / 거실에서도 깔끔하게"). 글자 수·강조·숫자 규칙은 그대로.
- chain_check: 먼저 이 제목들을 " → " 로 이은 한 줄(제목의 두 줄은 띄어쓰기로 붙임)을 짜서 한 문단처럼 소리 내어 읽히는지 확인하고, 각 섹션 제목은 그 줄과 똑같이 씁니다.
- problem: 문제 제기는 공감 나열 대신 질문 한 줄(question ≤24자, 예 "이걸 한 번에 해결할 순 없을까?") — 뒤 섹션이 해결한다.
- versatility.items: label(장소·용도 ≤8자) + desc(한 줄 설명 ≤18자).
- 강조(섹션당 최대 1개): kind "line" = 둘째 줄 전체(text 는 그 줄 그대로), kind "color" = 핵심 숫자 구절 1개. 점·밑줄·기울기 같은 장식 없음.
- 신뢰 배지 문구(완판·누적 판매·순위·연구 개발비·인증 번호·실사용 후기 수·공식 판매처)는 직접 쓰지 않는다 — 셀러가 입력한 값이 있으면 앱이 배지·섹션으로 따로 넣는다. 수치·순위·인증 번호를 지어내지 말 것.
규칙: 숫자·재질·크기는 입력(기획서 스펙·이미지 글)에 있는 것만(예시의 숫자를 따라 쓰지 말 것). 금지: 최저가·1위·최고·100%·완치·효능·타 쇼핑몰 이름·가격·배송/반품/보증 약속·공급사 브랜드. 기획서의 "주의할 표현"을 지킵니다(하중 수치는 "제조사 표시 기준"). 한국어 존댓말. 응답은 JSON 만.`;
const i5 = (props, required = Object.keys(props)) => ({ type: "object", additionalProperties: false, required, properties: props });
const str = { type: "string" };
export const COPY_V5_SCHEMA = i5({
  name_ko: { type: "string", description: "쿠팡 등록용 상품명 40자 이내" },
  chain_check: { type: "string", description: "소제목 징검다리 초안: problem.question → before_after → features 1·2·3 → detail.title → versatility 제목을 → 로 이은 한 줄(먼저 짜고 각 섹션 제목을 이와 똑같이)" },
  hero: i5({ label: str, category: str, name: str, sub: str, icons: { type: "array", minItems: 4, maxItems: 4, items: i5({ label: str }) }, name_emph: { type: "array", maxItems: 1, items: i5({ text: str, kind: { type: "string", enum: ["line", "color"] } }) } }),
  problem: i5({ question: { type: "string", description: "문제 제기 질문 한 줄 ≤24자(예: 이걸 한 번에 해결할 순 없을까?)" }, sub: { type: "string", description: "질문 위 짧은 상황 한 줄 ≤26자" } }),
  before_after: i5({ sub: str, title_lines: { type: "array", minItems: 2, maxItems: 2, items: str }, title: { type: "string", description: "(앱이 채움: 줄1\\n줄2)" }, emph: { type: "array", maxItems: 1, items: i5({ text: str, kind: { type: "string", enum: ["line", "color"] } }) } }, ["sub", "title_lines", "emph"]),
  checkpoint: i5({ title: str, callouts: { type: "array", minItems: 3, maxItems: 5, items: i5({ thin: str, bold: str }) } }),
  features: { type: "array", minItems: 3, maxItems: 3, items: i5({ title_lines: { type: "array", minItems: 2, maxItems: 2, items: str, description: "2줄 제목: 줄1 상황·기능, 줄2 이점/숫자 결론(줄당 ≤13자)" }, desc: str, title: { type: "string", description: "(앱이 채움: 줄1\\n줄2)" }, emph: { type: "array", maxItems: 1, items: i5({ text: str, kind: { type: "string", enum: ["line", "color"] } }) } }, ["title_lines", "desc", "emph"]) },
  options: i5({ title: str }),
  detail: i5({ title: str, items: { type: "array", minItems: 2, maxItems: 2, items: i5({ title: str, desc: str }) } }),
  versatility: i5({ title: str, sub: str, items: { type: "array", minItems: 4, maxItems: 4, items: i5({ label: { type: "string", description: "장소·용도 ≤8자" }, desc: { type: "string", description: "한 줄 설명 ≤18자" } }) } }),
  notice: i5({ title: str, items: { type: "array", minItems: 3, maxItems: 5, items: str } }),
  faq: { type: "array", minItems: 3, maxItems: 4, items: i5({ q: str, a: str }) },
});
// sections: planSectionsV5 결과, brief: 기획서 v3(keyContent), input: CopyInput(이미지 글)
// guide(선택): 벤치마킹 가이드 글(reference-core referenceGuide) — 섹션 목록의 '벤치마킹' 칸(sec.ref.angle)과 함께
export function renderCopyInputV5(input = {}, brief = {}, sections = [], guide = "") {
  const L = [];
  L.push(`[상품] ${brief.product_name_ko || input.title_ko || ""} · 유형 ${brief.product_type || ""}`);
  if (brief.key_appeal) L.push(`[핵심 소구] ${brief.key_appeal}`);
  if (brief.advantages?.length) L.push("[주요 장점 — features 는 이 순서의 상위 3개]", ...brief.advantages.map((a, i) => `${i + 1}. ${a}`));
  if (brief.specs?.length) L.push(`[스펙(근거 수치는 여기와 이미지 글에만)] ${brief.specs.map((s) => `${s.k}: ${s.v}`).join(" / ")}`);
  if (brief.targets?.length) L.push(`[추천 타겟] ${brief.targets.join(" / ")}`);
  if (brief.caution?.length) L.push("[주의할 표현 — 반드시 지킬 것]", ...brief.caution.map((c) => `- ${c}`));
  const imgs = (input.images || []).map((im) => `${im.id}: ${(im.texts_ko || []).filter(Boolean).slice(0, 6).join(" | ")}`).filter((t) => !/: $/.test(t));
  if (imgs.length) L.push("[이미지 글(번역)]", ...imgs.slice(0, 20));
  L.push("", "[섹션 목록(이 순서·이 섹션만)]");
  for (const s of sections) L.push(`- ${s.type}${s.shot ? ` · 사진: ${s.shot.needs}` : ""}${s.copy?.advantage ? ` · 장점: ${s.copy.advantage}` : ""}${s.type === "versatility" ? ` · 장소: ${(s.copy.items || []).map((x) => x.label).join("/")}` : ""}${s.type === "options" ? ` · 규격: ${(s.copy.rows || []).map((r) => `${r.name} ${r.size}`).join(" / ")}` : ""}${s.ref?.angle ? ` · 벤치마킹: ${s.ref.angle}${(s.ref.extra || []).length ? ` (+ ${s.ref.extra.slice(0, 2).join(" / ")})` : ""}` : ""}`);
  if (guide) L.push("", guide);
  L.push("", "chain_check(소제목 징검다리)를 먼저 짠 뒤 섹션별 글을 JSON 으로 작성해 주세요.");
  return L.join("\n");
}

// ─────────────────────────────── v6: 원본 한글화(이미지 레이어 번역) ───────────────────────────────
export const LOCALIZE_SYSTEM = `당신은 쿠팡 상세페이지 카피라이터입니다. 중국 1688 상세 이미지의 글자 레이어를 한국 쇼핑몰 문구로 **다시 씁니다(번역이 아니라 카피라이팅)**. 레이어마다 원문 zh, 역할 role, 상자 폭 w px, **한 줄 최대 글자 수(max)**, rewrite_ok(자유롭게 다시 써도 되는 자리인지), 기계번역 mt 가 주어집니다.

글자 수가 가장 먼저입니다
- 문구는 원본 글자가 있던 **그 자리에 그 크기로** 얹힙니다. 한 줄이 max 를 넘으면 글씨가 작아지거나 그림 밖으로 넘쳐 상세페이지가 망가집니다.
- 그러니 **max 안에서 끝나는 문구를 처음부터 새로 짓습니다.** 긴 번역문을 쓰고 줄이는 게 아니라, 그 글자 수로 가장 힘 있는 말을 고릅니다(조사·군말·"~할 수 있습니다" 빼기, 명사형·짧은 구어체).
  예(max 9): 足够快 才真省力 → "빠른 속도로 힘들이지 않고 간편하게"(X, 17자) → "빨라야 진짜 편하다"(O, 8자)
  예(max 7): 一机多用 省时省力 → "한 대로 다 썰어요"(O)
- 글자 수는 공백을 빼고 셉니다. 2줄이 허락된 자리("2줄 가능")는 줄마다 max 안.
- 숫자가 든 문구(용량·속도·무게·시간)는 **절대 지우지 않습니다.** 600斤/1小时 → "시간당 300kg"처럼 단위만 바꿔 짧게.

원칙
- 원문의 뜻(기능·숫자·단위)은 지키되, 한국 쇼핑몰에서 실제로 쓰는 자연스러운 말로. 직역·한자어 나열·명사 붙여쓰기 금지.
  직역 금지 예: 承重能力强 → "강력 하중"(X) "무거운 가전도 거뜬히"(O) / 无需安装 收到即用 → "설치 불필요"(X) "받자마자 바로 쓰세요"(O) / 多场景适用 → "다양한 공간 활용"(X) "주방·사무실 어디든 잘 어울려요"(O) / 防尘防潮 → "방진방습"(X) "먼지·습기 걱정 덜어요"(O) / 桌面分层可抽拉收纳盒 → "데스크탑 다단 풀아웃 수납함"(X) "당겨 쓰는 2단 수납 서랍"(O) / 圆润把手 → "둥근 손잡이"(O, 짧은 라벨은 그대로 정확하게)
- rewrite_ok=true(단색 배경·띠 위 글자, 글자를 지운 자리에 새로 얹는 문구): 어순·표현 자유(글자 수는 max 안), 과감하게 생동감 있게 다시 쓰고 강조할 곳을 고른다.
  rewrite_ok=false(사진 속 라벨·도면 치수 라벨): 짧고 정확하게, 원문 길이(원문 글자 수×1.3) 안에서.
  아이콘 라벨(원문 6자 이하 짧은 말): rewrite_ok 여도 **명사형, 원문 글자 수×1.3 이내**(예: 无需安装 → "설치 불필요", 多场景适用 → "어디든 활용", 防尘防潮 → "먼지·습기 관리").
- 숫자·단위 그대로(13.5cm, 25kg, 37~57.5cm). 斤=0.5kg(百斤=약 50kg), 承重=하중. 규격 이름: 矮款=낮은형, 高款=높은형(다른 표기 금지). 하중 수치는 "제조사 표시 기준"이 기본.
- 단정 금지: 방수·방청·녹 방지·방진방습 같은 성능 단정 대신 "물기에 강한", "녹에 강한", "먼지·습기 걱정 덜어요".
- 지울 레이어(ko 를 빈 문자열): 가격·할인·최저가·1위·최고·100%·효능, 배송/반품/보증 약속, 도매·맞춤제작·문의 환영·공장 직판·공급사 브랜드/로고/연락처.
- 문장을 중간에서 끊지 않는다("…때도", "…걱정"으로 끝나지 않게). 길면 같은 뜻의 짧은 완결 문장으로.
- 제목(title·sub, rewrite_ok)은 필요하면 2줄로("줄1\n줄2", 줄1 = 상황·기능, 줄2 = 이점/숫자 결론, 예 "숙이지 말고\n부드럽게 당기세요").
- emph(문구당 최대 1개): kind "line" = 둘째 줄 전체(text 는 그 줄 그대로) 또는 kind "color" = 핵심 숫자 구절 1개. 아이콘·작은 라벨·본문에는 강조하지 않는다. 점·밑줄·기울기 장식 없음.
- 신뢰 배지 문구(완판·순위·개발비·인증 번호·후기 수·공식 판매처)는 쓰지 않는다(셀러 입력값은 앱이 넣음).
- natural: 이 한 줄이 한국 쇼핑몰에서 실제로 쓰는 자연스러운 말인지 스스로 점검(true/false). 어색하면 고쳐 쓰고 true 로.
- promo: 이미지가 인증서·특허증·공장/생산라인·협력사·맞춤제작(OEM/ODM) 홍보이면 true 와 이유 — 상세페이지에서 뺀다.
- hero(첫 화면 새 타이틀 3줄, 의역 카피): label(작은 머리글 ≤10자, 예 "홈카페 정리템"), sub(중간 보조 ≤22자, 예 "커피머신 아래 숨은 공간까지"), name(크게 메인 ≤14자, 예 "당겨 쓰는 커피 수납장"), name_emph(최대 1곳 {text, kind: line|color}).
응답은 JSON 만.`;
const i6 = (props, required = Object.keys(props)) => ({ type: "object", additionalProperties: false, required, properties: props });
export const EMPH_KINDS = ["line", "color"]; // v8: 둘째 줄 전체(line) 또는 핵심 숫자 구절(color) — 장식(점·밑줄·기울기)은 테마가 허용할 때만
export const EMPH_KINDS_LEGACY = ["bold", "underline", "dot", "pill", "slant"];
const EMPH = { type: "array", maxItems: 2, items: i6({ text: { type: "string" }, kind: { type: "string", enum: EMPH_KINDS } }) };
export const LOCALIZE_SCHEMA = i6({
  images: { type: "array", items: i6({ id: { type: "string" }, promo: { type: "boolean" }, promo_reason: { type: "string" }, layers: { type: "array", items: i6({ idx: { type: "integer" }, ko: { type: "string" }, emph: EMPH, natural: { type: "boolean" } }) } }) },
  hero: i6({ label: { type: "string" }, sub: { type: "string" }, name: { type: "string" }, name_emph: { type: "array", maxItems: 1, items: EMPH.items } }),
});
// 한 줄에 들어가는 한글 글자 수(공백 제외): 한자와 한글은 같은 크기에서 폭이 거의 같다 → 원문 글자 수가 기준.
//   글씨를 15% 줄이거나 상자를 조금 넓힐 여유로 ×1.25(올림), 아주 짧은 말(≤3자)은 +1. 영문·숫자는 반 글자로 센다.
export const visLen = (t) => Array.from(String(t || "").replace(/\s/g, "")).reduce((n, c) => n + (/[\x00-\x7f]/.test(c) ? 0.55 : 1), 0);
export function koBudget(ly = {}) { const z = visLen(String(ly.zh || "").split("\n").sort((a, b) => visLen(b) - visLen(a))[0]); return Math.max(2, Math.ceil(z <= 3 ? z + 1 : z * 1.25)); }
export const twoLineOk = (ly = {}) => ly.rewrite_ok !== false && ["title", "sub"].includes(ly.role) && !/\n/.test(String(ly.zh || "")) && visLen(ly.zh) >= 6;
export const koOver = (ly = {}, ko = "") => { const m = koBudget(ly), lines = String(ko || "").split("\n"); return lines.length > (twoLineOk(ly) ? 2 : Math.max(1, String(ly.zh || "").split("\n").length)) || Math.max(...lines.map(visLen)) > m * 1.15 + 0.5; };
export function renderLocalizeInput(images = [], brief = null) {
  const L = [];
  if (brief) L.push(`[기획서] 상품명 ${brief.product_name_ko || ""} · 유형 ${brief.product_type || ""} · 핵심 소구 ${String(brief.key_appeal || "").slice(0, 160)}`, "");
  for (const im of images) {
    L.push(`[${im.id}] (${im.kind || "detail"} ${im.w || "?"}x${im.h || "?"})`);
    (im.layers || []).forEach((ly, i) => L.push(`  ${i}. ${ly.role || "body"} · 폭 ${ly.w || "?"}px · max ${koBudget(ly)}자${twoLineOk(ly) ? "(2줄 가능)" : ""} · rewrite_ok=${ly.rewrite_ok !== false} · ${ly.zh}${ly.mt && /[가-힣]/.test(ly.mt) ? `  → 기계번역: ${ly.mt}` : ""}`));
  }
  L.push("", "이미지마다 layers[idx] 의 한국어 카피(ko)·강조(emph)·자연스러움(natural)과 promo 판정, 그리고 hero 3줄을 JSON 으로.");
  return L.join("\n");
}
