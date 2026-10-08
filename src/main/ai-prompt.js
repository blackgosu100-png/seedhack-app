// AI 추천 지시문·입력 글·응답 형식 — 서버 중계(web/src/app/api/signal/ai/route.js)와 같은 내용.
// 바꾸면 양쪽을 같이 바꾼다. (앱의 개발용 CLI 경로와 서버 경로가 같은 판단을 하도록)

export const SYSTEM = `당신은 쿠팡 로켓그로스 셀러를 위한 1688 소싱 전문가입니다. 초보 셀러가 1688에서 "같은 상품을, 믿을 만한 판매자에게, 남는 가격으로" 사 오도록 후보를 고릅니다.

판단 기준(중요한 순서):
1. 같은 상품인가 — 쿠팡 상품명과 1688 상품명·옵션명을 비교해 본체가 같은지 본다. 부품(손잡이·뚜껑·거름망 단품), 차액·운송비 링크, 세트 구성이 다른 것은 같은 상품이 아니다.
2. 가격 — "허용 소싱가" 이하여야 마진이 남는다. 옵션 정보가 있으면 쿠팡 사진과 같은 옵션(사진 차이 dist가 작을수록 비슷, 12 이하면 거의 같은 사진)의 가격을 쓴다. 목록의 최저가는 미끼일 수 있으니 옵션가를 우선한다.
3. 판매자 신뢰 — 재구매율(回头率) 높을수록, 월판매 많을수록, 입점 연차 길수록 좋다. 최소주문이 크면 초보에게 불리하다. 운송비가 상품가에 비해 크면 소량 샘플 때 손해.
4. 사진·상세가 충실한 판매자를 선호한다(정보가 있을 때만).

규칙:
- 숫자는 입력에 있는 것만 인용한다. 새 숫자를 만들지 않는다.
- 후보와 옵션은 번호로만 가리킨다.
- 같은 회사는 한 번만 추천한다.
- 한국어로, 초보가 이해할 수 있게 짧고 구체적으로 쓴다.`;

// 구조화 출력 JSON Schema (CLI --json-schema 용. 서버는 zod로 같은 형식)
export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks", "skipped_ko", "summary_ko"],
  properties: {
    picks: {
      type: "array", maxItems: 3, description: "추천 순서대로 최대 3개",
      items: {
        type: "object", additionalProperties: false,
        required: ["candidate", "verdict", "option", "title_ko", "reason_ko", "risk_ko", "same_product"],
        properties: {
          candidate: { type: "integer", description: "후보 번호(입력의 n). 반드시 입력에 있는 번호만" },
          verdict: { type: "string", enum: ["green", "yellow", "red"], description: "green=샘플 후보, yellow=비교 대상, red=보류" },
          option: { type: ["integer", "null"], description: "그 후보의 옵션 번호(입력 options의 n). 옵션 정보가 없으면 null" },
          title_ko: { type: "string", description: "상품명 한국어 번역(40자 이내)" },
          reason_ko: { type: "string", description: "추천 이유 한국어 2문장 이내, 입력에 있는 숫자만 인용" },
          risk_ko: { type: "string", description: "주의할 점 한국어 1문장. 없으면 빈 문자열" },
          same_product: { type: "string", enum: ["yes", "likely", "no"], description: "쿠팡 상품과 같은 상품인지" },
        },
      },
    },
    skipped_ko: { type: "string", description: "상위 후보 중 제외한 것이 있으면 이유를 한국어 1~2문장으로. 없으면 빈 문자열" },
    summary_ko: { type: "string", description: "초보 셀러에게 주는 한 줄 조언(60자 이내)" },
  },
};

// 앱이 읽은 데이터를 모델이 읽기 쉬운 글로 (후보 번호 n, 옵션 번호 n)
export function renderInput(input) {
  const t = input.target || {};
  const lines = [];
  lines.push(`[쿠팡 상품] ${t.name || "(이름 없음)"}${t.price ? ` · 쿠팡 판매가 ${t.price}원` : ""}`);
  lines.push(`[허용 소싱가] ${t.allow != null ? `¥${Number(t.allow).toFixed(1)} 이하여야 목표 마진이 남음` : "없음(판매가 미입력) — 목록 중앙가 ¥" + (input.medianPrice ?? "-") + " 대비로 판단"}`);
  lines.push("");
  lines.push("[1688 후보] (앱의 규칙 점수 순. 숫자: 목록가=옵션 중 최저가(미끼 가능), 월판매=최근 30일 거래 건, 재구매=回头率)");
  for (const c of input.cards || []) {
    lines.push(`n=${c.n} | ${c.title} | 목록가 ¥${c.price ?? "-"} | 운송비 ¥${c.shipping ?? "-"} | 월판매 ${c.sales ?? "-"} | 최소주문 ${c.moq ?? "-"}개 | 재구매 ${c.repeat != null ? c.repeat + "%" : "-"} | 입점 ${c.years ?? "-"}년 | 노출 ${c.rank}위 | 배지 ${(c.badges || []).join(",") || "-"} | 규칙점수 ${c.score}/${c.max} | 회사 ${c.company}`);
    if (c.realPrice != null) lines.push(`   ↳ 앱이 확인한 옵션가 ¥${c.realPrice}${c.option ? ` (옵션 "${c.option}")` : ""}${c.priceHow ? ` · ${c.priceHow}` : ""}`);
    if (c.options?.length) lines.push(`   ↳ 옵션: ` + c.options.map((o) => `n=${o.n} "${o.label}" ¥${o.price ?? "-"}${o.dist != null ? ` dist=${o.dist}` : ""}${o.bait ? " [부품/차액 의심]" : ""}`).join(" ; "));
  }
  lines.push("");
  lines.push("위 후보 중 초보 셀러에게 추천할 판매자 최대 3개를 골라 주세요.");
  return lines.join("\n");
}
