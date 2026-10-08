// 💬 1688 판매자 문의 — 순수 판단 로직(화면·네트워크 없음, 시험 가능)
// 질문은 3단계로 나눠 짧게 보낸다. 판매자 답이 오면 다음 단계, 판매자가 수량·가격·결제 등을 되물으면 사람에게 넘긴다.

export const STAGES = [
  "你好！这款产品有现货吗？一箱装多少个？",
  "好的，谢谢！单个包装尺寸是多少？方便发一下实物包装照片吗？",
  "外箱可以用空白箱或者英文箱吗？",
];
export const STAGE_KO = ["재고·박스 입수량", "포장 사이즈·실물 사진", "무지/영문 박스"];
// 질문의 한글 뜻(사용자가 AI가 무슨 말을 보냈는지 알 수 있게)
export const STAGES_KO = [
  "안녕하세요! 이 상품 재고 있나요? 한 박스에 몇 개 들어가나요?",
  "네, 감사합니다! 개별 포장 사이즈는 어떻게 되나요? 실제 포장 사진을 보내 주실 수 있나요?",
  "외박스를 무지 박스나 영문 박스로 해 주실 수 있나요?",
];

export const LIMITS = {
  newSellersPerDay: 15, // 하루에 새로 문의하는 판매자 수
  sendsPerDay: 45, // 하루 전체 전송 수
  minGapMs: 60_000, // 어떤 전송이든 사이에 최소 1분
};

// 판매자가 이런 말을 하면 자동 진행을 멈추고 사람에게 넘긴다(수량·가격·결제·연락처·맞춤 제작·되묻기)
const HANDOFF = [
  [/要多少|需要多少|拿多少|采购量|订多少|买多少|多少(?:个|件|套|只|pcs)?\s*[?？]|数量.{0,4}[?？]/i, "수량을 물어봄"],
  [/报价|价格|单价|多少钱|优惠|便宜/, "가격 이야기"],
  [/付款|付定|拍下|拍了|定金|订金|(?:要|想|现在|直接)下单[吗么嘛]?\s*[?？]|发(?:个)?链接/, "주문·결제 이야기"], // "能下单的少量有货"(주문 가능·재고 있음)은 넘기지 않음
  [/微信|vx|v信|加我|qq|电话|手机|whatsapp/i, "외부 연락처 요청"],
  [/定制|定做|logo|印字|丝印|打样|样品费/i, "맞춤 제작·샘플 이야기"],
  [/没货|无货|缺货|断货|停产|下架/, "재고 없음"],
  [/[?？]\s*$/, "판매자가 질문함"],
];
// 판매자 자동응답(사람이 쓴 답이 아님) — 답으로 치지 않고 계속 기다린다
const AUTO = /自动回复|欢迎光临|欢迎来到|您好[，,]?\s*(?:请问)?有什么可以帮|客服.{0,6}(?:稍后|马上)|稍等|正在为您|(?:离开|不在).{0,4}(?:电脑|座位)|亲[，,]?\s*在的?$/;
// 대화 목록의 시간·시스템 줄
const NOISE = /^(\d{1,2}:\d{2}(:\d{2})?|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}.*|昨天.*|今天.*|星期.|周.|已读|未读|对方正在输入.*|以上是历史消息|查看更多消息|.{0,4}撤回了一条消息|\[图片\]?)$/;

const norm = (s) => String(s || "").replace(/\s+/g, "").trim();

// 채팅 화면 글 줄들 → 우리가 마지막으로 보낸 말 뒤의 판매자 줄들
// (말풍선 좌우를 구분하지 않고, 우리가 보낸 문장과 같은 줄을 기준점으로 삼는다 — 1688 화면 구조가 바뀌어도 버티게)
export function repliesAfter(lines, sentTexts, seller = "") {
  const L = (lines || []).map((x) => String(x || "").trim()).filter(Boolean);
  const mine = (sentTexts || []).map(norm).filter(Boolean);
  if (!mine.length) return { found: false, replies: [] };
  const isMine = (l) => { const n = norm(l); return n.length >= 4 && mine.some((m) => m === n || m.includes(n) || n.includes(m)); };
  let last = -1;
  L.forEach((l, i) => { if (isMine(l)) last = i; });
  if (last < 0) return { found: false, replies: [] };
  // 말풍선 위 "가게이름:직원이름" 머리줄(여러 번 반복되거나 판매자 이름으로 시작) — 답이 아님
  const head = /^[^:：\s]{2,40}[:：][^:：\s]{1,16}$/;
  const count = (l) => L.filter((x) => x === l).length;
  const isHead = (l) => head.test(l) && (count(l) >= 2 || (seller && l.startsWith(seller)));
  const replies = L.slice(last + 1).filter((l) => !isMine(l) && !NOISE.test(l) && !isHead(l) && l.length <= 300);
  return { found: true, replies };
}

export const isAuto = (t) => AUTO.test(String(t || ""));

export function handoffReason(text) {
  for (const [re, why] of HANDOFF) if (re.test(String(text || ""))) return why;
  return null;
}

// 판매자 답에서 숫자 정보 뽑기(한글 요약용)
export function extractInfo(texts, prev = {}) {
  const t = (texts || []).join("\n");
  const info = { ...prev };
  const carton = t.match(/(?:一箱|每箱|一件|整箱|外箱|装箱)[^\d\n]{0,6}(\d{1,5})\s*(?:个|只|件|套|pcs|PCS)?/) || t.match(/(\d{1,5})\s*(?:个|只|件|套|pcs)\s*[\/／]?\s*(?:一)?箱/i);
  if (carton) info.carton = +carton[1];
  const size = t.match(/(\d{1,3}(?:\.\d)?)\s*[*xX×]\s*(\d{1,3}(?:\.\d)?)\s*(?:[*xX×]\s*(\d{1,3}(?:\.\d)?))?\s*(cm|CM|厘米|mm|MM|毫米)?/);
  if (size) info.size = [size[1], size[2], size[3]].filter(Boolean).join("×") + (/mm|毫米/i.test(size[4] || "") ? "mm" : "cm");
  const wt = t.match(/(\d{1,5}(?:\.\d{1,2})?)\s*(kg|KG|公斤|千克|g|G|克)(?![a-z])/);
  if (wt) info.weight = wt[1] + (/kg|公斤|千克/i.test(wt[2]) ? "kg" : "g");
  if (/单个发|单只发|单件发|一个一个发|不装箱|没有外箱|没外箱/.test(t)) info.single = true; // 박스 없이 낱개 발송
  if (/有现货|现货|有货|有的/.test(t)) info.stock = "있음";
  if (/没货|无货|缺货|断货/.test(t)) info.stock = "없음";
  if (/空白|中性|英文/.test(t)) {
    if (/不(?:可以|行|能)|没有|不支持|不做/.test(t.split("\n").filter((l) => /空白|中性|英文/.test(l)).join(""))) info.blankBox = "불가";
    else if (/可以|行|能|没问题|支持|OK|ok|有/.test(t)) info.blankBox = "가능";
  }
  return info;
}

// 다음에 할 일: { action: "send"|"wait"|"handoff"|"done", text?, reason }
// q = { stage: 지금까지 보낸 단계 수, replies: [{text, afterStage}] }
export function nextAction(q) {
  const sent = q.stage || 0;
  if (sent === 0) return { action: "send", text: STAGES[0], reason: "첫 질문" };
  const fresh = (q.replies || []).filter((r) => r.afterStage === sent).map((r) => r.text);
  const human = fresh.filter((t) => !isAuto(t));
  if (!human.length) return { action: "wait", reason: fresh.length ? "자동응답만 옴 — 사람 답 기다림" : "답 기다림" };
  const why = human.map(handoffReason).find(Boolean);
  if (why) return { action: "handoff", reason: why };
  if (sent >= STAGES.length) return { action: "done", reason: "3단계 질문 모두 답 받음" };
  return { action: "send", text: STAGES[sent], reason: `${sent}단계 답 받음` };
}

// 하루 한도: log = [{ts, kind:"send"|"new"}]
export function canSend(log, now = Date.now(), { isNew = false } = {}) {
  const day = (log || []).filter((x) => now - x.ts < 864e5);
  const last = day.reduce((m, x) => Math.max(m, x.ts), 0);
  if (now - last < LIMITS.minGapMs) return { ok: false, why: "직전 전송과 1분 간격", waitMs: LIMITS.minGapMs - (now - last) };
  if (day.filter((x) => x.kind === "send").length >= LIMITS.sendsPerDay) return { ok: false, why: `오늘 전송 한도 ${LIMITS.sendsPerDay}회` };
  if (isNew && day.filter((x) => x.kind === "new").length >= LIMITS.newSellersPerDay) return { ok: false, why: `오늘 새 판매자 한도 ${LIMITS.newSellersPerDay}곳` };
  return { ok: true };
}
