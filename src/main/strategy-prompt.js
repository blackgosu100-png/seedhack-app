// 🧠 판매전략 AI — 지시문·응답 형식·입력 글. 개발 실행은 Claude CLI(detail/cli.js runStructured), 배포판은 서버 중계(task:"strategy", 서버 준비 전).
// 원칙: 앱이 모은 숫자·사실만 근거로 쓴다. 모르는 것(상세페이지 영상 유무, 리뷰 불만 내용 등)은 사실처럼 쓰지 말고 "먼저 확인할 것"으로.
// 가격 제안의 남는 돈은 AI가 계산하지 않고 앱이 다시 계산해서 보여 준다(숫자 신뢰).

export const STRATEGY_SYSTEM = `너는 쿠팡 로켓그로스 셀러의 소싱·판매전략 코치다. 사용자(대표님)의 방식은 이렇다:
경쟁사(벤치마킹 상품)의 판매량과 내 원가로 경쟁사가 얼마나 남기는지 보고, 내가 차별화하거나 판매전략으로 그 시장을 나눠 먹을 수 있으면 초도 50~100개로 들어간다.
쓰는 무기: 가격을 조금 낮추기 · 사은품 · 상세페이지 상단 영상/GIF로 전환율 올리기 · 썸네일 개선으로 클릭율 올리기 · 옵션 구성(세트·1+1) · 초기 광고.

규칙:
1. 입력에 있는 숫자·사실만 근거로 쓴다. 입력에 없는 사실(경쟁사 상세페이지에 영상이 있는지, 리뷰 불만이 무엇인지, 경쟁사 광고비 등)을 지어내지 마라. 그런 것은 check_first(먼저 확인할 것)에 넣는다.
2. 가격 제안(price_won)은 입력의 "남는 돈 계산식"으로 개당 남는 돈이 0보다 크게 남는 범위에서만. 경쟁사 가격보다 조금 낮게(가격대별 체감 할인: 1만원 이하 300~500원, 1~3만원 1,000~2,000원, 그 위 3~6%). 가격을 낮추지 않는 게 낫다면 null.
3. 사은품은 개당 비용(원)을 적고, 그 비용을 빼고도 남는지 why에 적는다. 1688에서 구할 만한 흔한 소품으로.
4. 각 전술(tactics)은 실행할 행동 하나 + 근거(입력 숫자 인용) + 기대 효과. 3~6개. 근거가 약한 것은 넣지 마라.
5. 초도 수량은 50~100개 사이에서, 경쟁사 월판매량·내 원가(투자금)를 근거로.
6. 들어가지 않는 게 낫다고 판단되면 go=false로 하고 이유를 summary에 솔직하게 쓴다.
7. 한국어, 짧고 구체적으로. 과장·광고 문구·이모지 금지.`;

export const STRATEGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["go", "summary", "tactics", "first_order_qty", "check_first", "risks"],
  properties: {
    go: { type: "boolean", description: "들어가 볼 만한가" },
    summary: { type: "string", description: "한두 문장 결론 — 어떤 무기로 어떻게 나눠 먹을지" },
    tactics: {
      type: "array", minItems: 1, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "action", "why", "effect", "price_won", "cost_won"],
        properties: {
          kind: { type: "string", enum: ["가격", "사은품", "상세페이지", "썸네일", "옵션구성", "광고", "기타"] },
          action: { type: "string", description: "할 일 한 줄" },
          why: { type: "string", description: "입력 숫자를 인용한 근거" },
          effect: { type: "string", description: "기대 효과(클릭율·전환율·객단가 등)" },
          price_won: { type: ["number", "null"], description: "가격 전술일 때 제안 판매가(원), 아니면 null" },
          cost_won: { type: ["number", "null"], description: "사은품·옵션 등 추가 비용(원/개), 없으면 null" },
        },
      },
    },
    first_order_qty: { type: "number", description: "초도 수량(50~100)" },
    check_first: { type: "array", items: { type: "string" }, description: "들어가기 전에 쿠팡·1688에서 직접 확인할 것" },
    risks: { type: "array", items: { type: "string" } },
  },
};

const won = (v) => (v == null || !Number.isFinite(+v) ? "모름" : Math.round(+v).toLocaleString("ko-KR") + "원");
const pct = (v) => (v == null || !Number.isFinite(+v) ? "모름" : (+v * 100).toFixed(1) + "%");
// input: listup이 모은 한 행의 사실 + 계산값
export function renderStrategyInput(x) {
  const L = [];
  L.push(`[상품] ${x.name || "-"}`);
  L.push(`대표 키워드: ${x.keyword || "-"}${x.kwVol ? ` (네이버 월검색 ${x.kwVol})` : ""}`);
  L.push(`[경쟁사(벤치마킹) 상품 — 쿠팡 화면·Wing 실측]`);
  L.push(`판매가 ${won(x.benchPrice)} · 28일 판매 ${x.bSales ?? "모름"}개 · 28일 조회 ${x.bViews ?? "모름"} · 전환율 ${pct(x.bCvr)} · 리뷰 ${x.bReviews ?? "모름"}개 · 별점 ${x.bRating ?? "모름"} · 배송 ${x.bShip || "모름"}`);
  if (x.band) L.push(`이 검색어에서 잘 팔리는 가격대 ${won(x.band.lo)}~${won(x.band.hi)} · 판매 상위 중 최저가 ${won(x.band.strongMin)}`);
  if (x.minPrice || x.maxPrice) L.push(`1페이지 가격 범위 ${won(x.minPrice)}~${won(x.maxPrice)}`);
  L.push(`[내 원가 — 1688]`);
  L.push(`1688 ${x.yuan != null ? "¥" + x.yuan : "모름"}${x.cnAuto ? ` (${x.cnAuto.sure ? "옵션가 확인됨" : "추정"}${x.cnAuto.option ? ", 옵션 " + x.cnAuto.option : ""})` : ""} → 원가 ${won(x.cost)} (원가 계수 ${x.fx}원/위안) · 물류(입출고+배송) ${won(x.logi)}${x.dims ? ` · 크기 ${x.dims}mm` : ""}`);
  L.push(`[남는 돈 계산식] 개당 남는 돈 = 판매가 − 원가 ${won(x.cost)} − 물류 ${won(x.logi)} − 판매가×수수료 ${pct(x.fee)} − 판매가×광고비 ${pct(x.adRate)}`);
  L.push(`경쟁사 가격으로 팔 때 개당 남는 돈(광고비 포함) ${won(x.bUnitAd)} · 경쟁사 월 순이익 추정 ${won(x.bNet)} · 경쟁사 ROI 추정 ${pct(x.bRoi)}`);
  L.push(`앱 추천 판매가 ${won(x.recPrice)} → 개당 남는 돈 ${won(x.recUnit)}`);
  if (x.reason) L.push(`대표님 메모(소싱 이유): ${x.reason}`);
  L.push(`[모르는 것] 경쟁사 상세페이지 구성(영상·GIF 유무), 리뷰 불만 내용, 경쟁사 광고비 — 입력에 없으면 확인할 것으로 돌릴 것`);
  return L.join("\n");
}
