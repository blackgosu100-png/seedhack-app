// ⑥ 카피 — 전환형 상세페이지 문안(Copy, CONTRACTS 6절).
//   writeCopy(input, { log, model, useCli }) → { copy, how: "cli"|"server"|"rules", costUsd?, error? }
//   AI(개발: Claude CLI / 배포판: 서버 중계)가 없거나 실패하거나 결과가 심하게 어긋나면 규칙 기반(rulesCopy)으로 반드시 채운다.
//   AI 결과도 lintCopy(금지어)·sanitizeCopy(원문에 없는 숫자 제거, 금지어 문장 교체)를 거친 뒤에만 내보낸다.
// 순수 모듈 — electron 을 정적으로 import 하지 않는다(node --test 로 검증).
import { runStructured, cliAvailable } from "./cli.js";
import { COPY_SYSTEM, COPY_SCHEMA, renderCopyInput, COPY_SYSTEM_V2, COPY_SCHEMA_V2, renderCopyInputV2, EDITORIAL_KEYS } from "./copy-prompt.js";
import { normKind } from "./extract-core.js";
import { classifyImage, CLASS_RE, UNIT_WORD_RE, MEANINGLESS_SPEC_KEY, normalizeSizeName, placeFits, placesFrom } from "./plan-core.js";

import { referenceGuide, guardSimilarity, similarTo, getPath, setPath } from "./reference-core.js";
export { cliAvailable };

// ─────────────────────────────── 공통 도구 ───────────────────────────────
const S = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const hasCJK = (t) => /[一-鿿]/.test(t);
const clip = (s, n) => { s = S(s); return s.length <= n ? s : s.slice(0, n).replace(/[\s,·:(]+[^\s,·:(]*$/, "").trim() || s.slice(0, n); }; // 단어 중간에서 자르지 않게
const uniq = (a) => [...new Set(a)];
const uniqBy = (a, key) => { const seen = new Set(); return a.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
// 제목용 자르기: 글자 수를 넘으면 쉼표·가운뎃점 같은 구분자 앞에서 끊는다(의미가 뒤집히지 않게 — "변형 없음"이 "변형"으로 잘리면 안 됨)
const clipTitle = (s, n) => { s = S(s); if (s.length <= n) return s; const head = s.slice(0, n + 1); const m = Math.max(head.lastIndexOf(","), head.lastIndexOf("，"), head.lastIndexOf("·"), head.lastIndexOf("|"), head.lastIndexOf("/")); return m >= 4 ? s.slice(0, m).trim() : clip(s, n); };

// ─────────────────────────────── 번역 준비 (A5 가 translate.js 에 넘길 문장 모으기) ───────────────────────────────
// source(DetailSource+images) + ocr → 번역이 필요한 중국어 문장 목록(중복 없음). 같은 문장은 한 번만 — translate.js 캐시와 합쳐 C-6.
export function collectTexts({ source = {}, ocr = {} } = {}) {
  const out = [];
  out.push(source.title_zh);
  for (const a of source.attrs || []) out.push(a.k_zh, a.v_zh);
  for (const o of source.options || []) out.push(o.label_zh);
  for (const im of ocr.images || []) for (const b of im.boxes || []) if (!b.latin && hasCJK(S(b.text))) out.push(b.text);
  // 상세 글은 문장 단위(≤500자)로 쪼갠다 — translate.js 는 600자 넘는 글을 버린다
  for (const part of splitText(source.detailText_zh)) out.push(part);
  return uniq(out.map(S).filter((t) => t && hasCJK(t)));
}
export function splitText(text, max = 500) {
  const t = S(text); if (!t) return [];
  const parts = []; let cur = "";
  for (const seg of t.split(/(?<=[。！？!?；;\n])/)) {
    if ((cur + seg).length > max && cur) { parts.push(cur.trim()); cur = ""; }
    cur += seg;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.flatMap((p) => (p.length <= max ? [p] : p.match(new RegExp(`.{1,${max}}`, "g")) || []));
}

// ko: Map/객체(zh→ko) 또는 배열 쌍 — 번역 결과를 CopyInput 으로 묶는다
// cleaned(선택): A2 cleanImage 결과 — 사진 위에 남은(kept) 중국어 상자를 labels(짧은 라벨, AI 가 번역)로 넘긴다
// 번역 보정(용어집·단위): 承重=하중(구글이 "베어링"으로 오역), 斤=0.5kg(百斤=50kg, 千斤=500kg), 两=50g
const JIN_NUM = { 百: 100, 千: 1000, 十: 10, 两: 2, 二: 2, 三: 3, 五: 5 };
export function fixTranslation(zh = "", ko = "") {
  let t = S(ko); const z = S(zh);
  if (!t || !z) return t;
  // 규격 용어집: 矮款·低款 → 낮은형, 高款 → 높은형 (한글화·카드 모두 같은 표기)
  if (/矮款|低款|矮版|矮型/.test(z)) t = t.replace(/낮은\s*(타입|스타일|버전|모델)|짧은\s*(형|타입|스타일)|로우\s*(형|타입)/g, "낮은형");
  if (/高款|高版|高型|加高款/.test(z)) t = t.replace(/높은\s*(타입|스타일|버전|모델)|하이\s*(형|타입|스타일)|키\s*큰\s*(형|타입)/g, "높은형");
  if (/承重|载重|负重|承受/.test(z)) t = t.replace(/베어링\s*(무게|하중|중량)?|무게\s*지지력|부하\s*용량/g, "하중").replace(/하중\s+하중/g, "하중");
  for (const m of z.matchAll(/(\d+(?:\.\d+)?|[百千十两二三五])\s*斤/g)) {
    const n = /\d/.test(m[1]) ? Number(m[1]) : JIN_NUM[m[1]]; if (!n) continue;
    const kg = String(Math.round(n * 0.5 * 10) / 10);
    const re = new RegExp(`(약\\s*)?${n}\\s*(kg|킬로그램|킬로|근|斤)`, "i");
    if (new RegExp(`(^|[^\\d.])${kg.replace(".", "\\.")}\\s*kg`, "i").test(t)) continue; // 이미 보정됨(두 번 적용해도 같게) · v13 AI 가 이미 kg 로 바꾼 것("50kg까지 거뜬")에 "(약 50kg)"를 또 붙이던 것
    t = re.test(t) ? t.replace(re, `약 ${kg}kg`) : `${t} (약 ${kg}kg)`;
  }
  for (const m of z.matchAll(/(\d+)\s*两(?!件|个)/g)) { const g = Number(m[1]) * 50; const re = new RegExp(`${m[1]}\\s*(냥|량|两)`); if (re.test(t)) t = t.replace(re, `약 ${g}g`); }
  return t;
}

// vision(선택): vision.js reviewPhotos 결과 — usable:false 인 이미지는 images[].usable=false (usp 가 가리키지 않게)
export function buildCopyInput({ source = {}, ocr = {}, cleaned = [], ko = {}, keyword = "", coupangName = "", category = "", vision = null } = {}) {
  const visionById = new Map((Array.isArray(vision) ? vision : vision?.items || []).filter((v) => v && v.id).map((v) => [S(v.id), v]));
  const lookup = ko instanceof Map ? (t) => ko.get(S(t)) || "" : (t) => ko?.[S(t)] || "";
  const tr = (t) => (hasCJK(S(t)) ? lookup(t) : S(t)); // 숫자·영문만이면 그대로
  const ocrById = new Map((ocr.images || []).map((im) => [im.id, im]));
  const images = (source.images || []).map((im) => {
    const boxes = (ocrById.get(im.id)?.boxes || []).map((b) => S(b.text)).filter(Boolean);
    const v = visionById.get(im.id);
    return { id: im.id, kind: im.kind || "detail", w: im.w ?? ocrById.get(im.id)?.w ?? null, h: im.h ?? ocrById.get(im.id)?.h ?? null,
      texts_zh: boxes, texts_ko: boxes.map((t) => fixTranslation(t, tr(t) || "")), ...(v ? { usable: v.usable !== false && v.role !== "skip" } : {}) };
  });
  const labels = uniqBy((cleaned || []).flatMap((c) => (c.boxesOut || []).filter((b) => b.action === "kept" && hasCJK(S(b.text)) && !UNIT_WORD_RE.test(S(b.text))).map((b) => ({ imageId: c.id, zh: S(b.text) }))), (l) => `${l.imageId}|${l.zh}`).slice(0, 40);
  return {
    labels,
    title_zh: S(source.title_zh), title_ko: tr(source.title_zh) || "",
    attrs: (source.attrs || []).map((a) => ({ k_zh: S(a.k_zh), v_zh: S(a.v_zh), k_ko: tr(a.k_zh) || "", v_ko: tr(a.v_zh) || "" })),
    options: (source.options || []).map((o) => ({ label_zh: S(o.label_zh), label_ko: tr(o.label_zh) || "" })),
    detailText_ko: splitText(source.detailText_zh).map((p) => tr(p)).filter(Boolean).join("\n"),
    images, keyword: S(keyword), coupangName: S(coupangName), category: S(category),
  };
}

// ─────────────────────────────── 규칙 기반 카피 ───────────────────────────────
// 원문(제목·속성·OCR)에서 찾은 특징만 쓴다. 숫자는 원문 문장을 그대로 옮길 때만 들어간다.
const FEATURES = [
  { re: /加厚|加粗|厚实|加固/, badge: "두꺼운 재질", title: "두껍고 튼튼하게", desc: "두껍게 만들어 쉽게 처지거나 찢어지지 않습니다." },
  { re: /折叠|可折|可收|收起/, badge: "접이식", title: "안 쓸 땐 접어서", desc: "쓰지 않을 때는 접어 두면 자리를 거의 차지하지 않습니다." },
  { re: /大容量|超大|容量大|特大|加大/, badge: "넉넉한 용량", title: "넉넉하게 담기는 용량", desc: "한 번에 넉넉히 담을 수 있어 자주 비우지 않아도 됩니다." },
  { re: /防水|防潮|防渗/, badge: "방수 처리", title: "물기에도 걱정 없이", desc: "물기가 닿아도 쉽게 상하지 않도록 방수 처리했습니다.", noun: "방수" },
  { re: /手提|提手|把手|提带|拎/, badge: "손잡이", title: "들고 옮기기 쉽게", desc: "손잡이가 있어 들고 옮기기 편합니다." },
  { re: /透气|网眼|镂空|网格/, badge: "통기성", title: "막히지 않는 통기성", desc: "공기가 통하는 구조라 습기와 냄새가 덜 찹니다." },
  { re: /耐用|结实|牢固|承重|不易变形/, badge: "튼튼한 구조", title: "오래 쓰는 튼튼함", desc: "튼튼하게 만들어 오래 써도 모양이 잘 변하지 않습니다." },
  { re: /轻便|便携|轻巧|轻量/, badge: "가벼운 무게", title: "가볍게 들고 다니기", desc: "가벼워서 누구나 부담 없이 옮길 수 있습니다." },
  { re: /无味|无异味|不刺鼻/, badge: "냄새 없는 소재", title: "냄새 걱정 없이", desc: "자극적인 냄새가 나지 않는 소재를 썼습니다." },
  { re: /易清洗|可水洗|可清洗|好清洁|易清洁/, badge: "쉬운 세척", title: "물로 쓱 닦기만", desc: "더러워지면 물로 간단히 씻어 쓸 수 있습니다." },
  { re: /多色|多款|颜色可选|多种颜色/, badge: "다양한 색상", title: "취향대로 고르는 색상", desc: "공간 분위기에 맞춰 색상을 고를 수 있습니다." },
  { re: /简约|时尚|北欧|美观|高颜值/, badge: "깔끔한 디자인", title: "어디에 두어도 깔끔하게", desc: "군더더기 없는 디자인이라 거실·욕실 어디에 두어도 어울립니다." },
  { re: /防滑/, badge: "미끄럼 방지", title: "미끄러지지 않게", desc: "바닥이 미끄러지지 않도록 처리했습니다." },
  { re: /带盖|盖子|翻盖/, badge: "뚜껑 포함", title: "뚜껑으로 깔끔하게", desc: "뚜껑을 덮어 두면 안이 보이지 않아 깔끔합니다." },
  { re: /分类|分格|双格|两格|三格|隔层/, badge: "분리 수납", title: "나눠서 담는 칸", desc: "칸이 나뉘어 있어 종류별로 나눠 담을 수 있습니다." },
  { re: /静音|无声/, badge: "조용한 사용", title: "소음 없이 조용하게", desc: "사용할 때 거슬리는 소리가 나지 않습니다." },
  { re: /可拆|拆卸|可拆洗/, badge: "분리 가능", title: "분리해서 관리", desc: "분리할 수 있어 세척과 보관이 편합니다." },
];
const FALLBACK_FEATURES = [
  { badge: "꼼꼼한 마감", title: "꼼꼼하게 마감", desc: "이음새와 모서리까지 꼼꼼하게 마감했습니다.", noun: "마감" },
  { badge: "간편한 사용", title: "누구나 바로 사용", desc: "복잡한 조립 없이 받자마자 바로 쓸 수 있습니다.", noun: "사용" },
  { badge: "실용적인 디자인", title: "쓰임새를 먼저 생각한 설계", desc: "매일 쓰는 물건이라 쓰임새를 먼저 생각해 만들었습니다.", noun: "설계" },
];
// v2 소제목 체인용 명사: 특징의 badge 마지막 낱말(두꺼운 재질→재질, 접이식→접이식, 넉넉한 용량→용량 …)
const featureNoun = (f) => f.noun || S(f.badge).split(/\s+/).pop();
const PAIN_SETS = [
  { re: /빨래|세탁|바구니|수납|정리|보관|박스|상자|선반|행거|옷장|서랍|바스켓/, items: [
    { icon: "😩", text: "쌓이는 물건, 둘 곳이 없어 늘 어수선하죠" }, { icon: "😫", text: "꺼낼 때마다 뒤섞여 찾느라 시간이 걸리죠" }, { icon: "😔", text: "손님 오면 급히 치우느라 진땀 나죠" } ] },
  { re: /주방|식기|컵|냄비|도마|조리|그릇|수저|식탁/, items: [
    { icon: "😩", text: "조리할 때마다 도구 찾느라 번거롭죠" }, { icon: "😫", text: "물때와 얼룩이 남아 설거지가 두 번 일이죠" }, { icon: "😔", text: "싸구려는 금방 망가져 다시 사게 되죠" } ] },
  { re: /욕실|샤워|수건|비누|칫솔|화장실|세면/, items: [
    { icon: "😩", text: "물기 때문에 금방 곰팡이가 피죠" }, { icon: "😫", text: "좁은 욕실, 둘 곳이 마땅치 않죠" }, { icon: "😔", text: "녹슬고 끈적여 자주 바꾸게 되죠" } ] },
];
const PAIN_DEFAULT = [
  { icon: "😩", text: "쓸 때마다 불편해도 참고 쓰셨죠" }, { icon: "😫", text: "자리만 차지하고 정리는 안 되죠" }, { icon: "😔", text: "금방 망가져 또 사게 되죠" } ];
// ── 판매 정책 약속 필터 ──
// 중국 판매자 원문(OCR·상세글)의 "7天无理由退换·包邮·质量保证" 같은 배송·반품·보증 약속은 한국 셀러가 지킬 약속이 아니다.
// 입력에 근거가 있어도(근거 규칙의 예외) 카피에 옮기지 않고 한국 셀러용 중립 문장으로 바꾼다.
export const NEUTRAL = {
  return: "교환·반품은 쿠팡 정책을 따릅니다.",
  shipping: "배송 일정은 주문 화면 안내를 확인해 주세요.",
  warranty: "품질 관련 문의는 판매자에게 남겨 주세요.",
};
export const NEUTRAL_FAQ = {
  return: { q: "교환·반품은 어떻게 하나요?", a: "교환·반품은 쿠팡 정책을 따릅니다. 수령 후 이상이 있으면 사진과 함께 문의해 주세요." },
  shipping: { q: "배송은 얼마나 걸리나요?", a: "배송 일정은 주문 화면 안내를 확인해 주세요." },
  warranty: { q: "품질에 문제가 있으면 어떻게 하나요?", a: "품질 관련 문의는 판매자에게 남겨 주세요. 수령 후 이상이 있으면 사진과 함께 문의해 주세요." },
};
const NEUTRAL_SET = new Set([...Object.values(NEUTRAL), ...Object.values(NEUTRAL_FAQ).flatMap((f) => [f.q, ...f.a.split(/(?<=[.!?])\s+/)])]);
const POLICY = [ // 순서 중요: 품질 보증은 warranty 로 먼저
  [/품질\s*(?:을|를)?\s*(?:보증|보장)|정품|정식\s*(?:수입|인증)|공식\s*(?:수입|인증)|제조사\s*보증/, "warranty", "품질·정품 보증"],
  [/교환|반품|환불|무상|보증|보장|A\/?S(?![a-z])|애프터\s*서비스/i, "return", "교환·반품·보증"],
  [/무료\s*배송|무배|당일\s*(?:배송|발송|출고)|익일\s*(?:배송|발송|출고)|로켓|빠른\s*(?:배송|발송)|\d+\s*(?:일|시간|주|영업일)\s*(?:이내|안에|내|만에|안)?\s*(?:배송|발송|도착|출고)|(?:배송|발송|도착)\s*\d+\s*(?:일|시간)/, "shipping", "배송 기간·무료배송"],
];
const SENT = /(?<=[.!?。])\s+|\n/;
export function policyKind(sentence) {
  const t = S(sentence);
  if (!t || NEUTRAL_SET.has(t)) return null;
  const hit = POLICY.find(([re]) => re.test(t));
  return hit ? hit[1] : null;
}
// 글 → 정책 약속 문장을 중립 문장으로(short 면 제거) · { text, hits: ["return", ...] }
export function scrubPolicy(text, { short = false } = {}) {
  const hits = [], out = [];
  for (const sent of S(text).split(SENT)) {
    const k = policyKind(sent);
    if (!k) { if (sent.trim()) out.push(sent.trim()); continue; }
    hits.push(k);
    if (!short && !out.includes(NEUTRAL[k])) out.push(NEUTRAL[k]);
  }
  return { text: out.join(" ").trim(), hits };
}
// 도매·중국 셀러 문구(로고 맞춤 제작·문의 환영·도매·위탁·실물 참고·공장 직판 …)는 소비자 상세페이지에 옮기지 않는다 — 원문(zh)·번역(ko) 양쪽으로 본다
export const WHOLESALE_LINE = /定制\s*LOGO|LOGO\s*定制|支持定制|可定制|欢迎咨询|欢迎订购|咨询客服|联系客服|批发|代发|一件代发|起批|混批|介意者慎拍|仅供参考|实拍图仅供参考|厂家直销|厂家直供|工厂直供|源头工厂|诚信通|旺旺|微信|QQ|电话|热线|淘宝|阿里|1688|로고\s*(맞춤|제작|커스텀)|맞춤\s*제작|커스텀\s*가능|문의\s*환영|상담\s*환영|주문\s*환영|도매|위탁|대량\s*주문|실물\s*참고|참고용|참고만|제조사\s*직판|공장\s*직판|공장\s*직공급|직거래|고객센터로|왕왕|위챗/i;
const isWholesale = (t) => WHOLESALE_LINE.test(S(t));
const noPolicy = (lines) => lines.filter((t) => !policyKind(t) && !isWholesale(t)); // 규칙 카피용: 원문 줄에서 약속 줄·도매 문구 줄을 뺀다
// 캡션의 무의미한 설명·위험 안내·로고 언급 문장(실제 제품의 모습을 보여줍니다 / 위험한 동작은 따라하지 마세요 / 브랜드 로고가 표기된 모습입니다 …)
export const MEANINGLESS_RE = /모습(을|이)\s*보여|모습입니다|모습이에요|모습을 확인|따라\s*하지|모방하지\s*마|위험한\s*(동작|행동)|로고가\s*(표기|보이|새겨|들어)|로고를\s*(확인|볼)|장면입니다|장면이며|장면이|테스트\s*장면|무게\s*테스트|체중\s*테스트|상세\s*화면에|참고\s*이미지|이미지입니다|사진입니다|보여\s*줍니다|보여\s*드립니다|확인할 수 있어요$|확인해 보세요$/;
// 하중·내구 주장: 사람이 매달리는 테스트·체중 언급은 제거, "N kg 까지 견딥니다" 류는 "제조사 제공 기준" 접두가 없으면 붙인다
export const LOAD_TEST_RE = /두\s*사람의\s*무게|체중|몸무게|사람이\s*매달|매달려|올라타|올라서도/;
export const LOAD_CLAIM_RE = /\d+(?:[.,]\d+)?\s*(?:kg|㎏|킬로|근|톤|t)\s*(?:까지|의|를|을|도|이상|정도|급)?\s*[^.!?]*?(?:견디|견딜|견딥|견뎌|지지|버티|버틸|버팁|버텨|하중|지탱|받쳐|받칠|받칩|감당)|(?:하중|내하중|내구성|수명)[^.!?]*?\d+(?:[.,]\d+)?\s*(?:kg|㎏|킬로|년|배|회)/;
export function scrubLoad(text) {
  let hits = 0;
  const out = S(text).split(SENT).filter((t) => t.trim()).filter((t) => { if (LOAD_TEST_RE.test(t)) { hits++; return false; } return true; })
    .map((t) => { if (LOAD_CLAIM_RE.test(t) && !/제조사\s*제공\s*기준/.test(t)) { hits++; return `제조사 제공 기준 ${t}`; } return t; });
  return { text: out.join(" ").trim(), hits };
}
export function scrubMeaningless(text) {
  const parts = S(text).split(SENT), kept = parts.filter((t) => t.trim() && !MEANINGLESS_RE.test(t));
  return { text: kept.join(" ").trim(), hits: parts.filter((t) => t.trim()).length - kept.length };
}
// 글에서 도매 문구 문장을 지운다(대체 문장 없음) → { text, hits }
export function scrubWholesale(text) {
  const parts = S(text).split(SENT), kept = parts.filter((t) => t.trim() && !isWholesale(t));
  return { text: kept.join(" ").trim(), hits: parts.length - kept.length - parts.filter((t) => !t.trim()).length };
}
const NOTICE_DEFAULT = [
  "모니터 설정에 따라 실제 색상과 다르게 보일 수 있습니다.",
  "수작업 측정으로 치수에 약간의 오차가 있을 수 있습니다.",
  "수령 후 이상이 있으면 사진과 함께 문의해 주세요.",
  NEUTRAL.return,
];
// 상품 명사 뽑기 — 불용어(수식어·판매 문구)와 "용/형/식/제/급" 으로 끝나는 수식어를 빼고, 1688 상품명 번역은 보통 마지막 명사가 본체이므로 뒤에서부터 고른다
const STOP_WORDS = /^(포함|가정용|대용량|접이식|신형|세트|무료|배송|정품|업소용|휴대용|다용도|고급|신상|신품|인기|추천|국내|당일|특가|증정|도매|批发|핫|판매|공장|직영|한정|수량|대량|제조|제조사|직판|용|형|및|과|와|의|등|스타일|새로운|가정|두꺼운|얇은|튼튼한|심플|북유럽풍|북유럽|가성비|프리미엄|초경량|경량|대형|소형|중형|미니|초대형|신제품|할인|이벤트|사은품|택배|당일발송|빠른|최신|한국|해외|직구|수입|중국|남녀공용|남성|여성|아동|성인)$/;
const MODIFIER_TAIL = /(용|형|식|제|급)$/; // 가정용·접이식·원목제·고급 … 수식어 꼬리
const COMPANY_RE = /(유한회사|회사|공사|상사|상회|무역|공장|그룹|유한|주식|기업|공업|실업|과기|科技|有限|公司)$/; // 공급사 회사명(제목 번역이 회사명인 경우)
const INCLUDED = /^(포함|증정|제공|추가|별매)$/; // "손잡이 포함" 의 손잡이처럼 뒤에 포함/증정이 오는 낱말은 부속품 → 본체 아님
const nounTokens = (text) => { const raw = S(text).split(/\s+/); return raw
  .filter((t, i) => /^[가-힣]{2,6}$/.test(t) && !INCLUDED.test(raw[i + 1] || "")) // 괄호·기호·숫자·영문이 섞인 토큰("[한글]" 등)은 제외
  .filter((t) => !STOP_WORDS.test(t) && !MODIFIER_TAIL.test(t) && !COMPANY_RE.test(t)); };
// 중국 공급사 브랜드(品牌·商标·상표·브랜드·제조사)는 셀러가 자기 브랜드로 팔므로 spec·badges·name_ko·headline 어디에도 넣지 않는다
export const BRAND_KEY = /品牌|商标|牌子|brand|상표|브랜드|제조사|제조업체|생산업체|厂家|生产商|供应商|제조원/i;
const WHOLESALE_KEY = /货号|品牌|商标|牌子|brand|起订|起批|是否|跨境|库存|加工|供应|批发|定制|货源|发货|代发|SKU|编号|주문량|최소|브랜드|상표|제조사|품번|모델명|재고|공급/i;
const brandValues = (input) => uniq((input.attrs || []).filter((a) => BRAND_KEY.test(`${a.k_zh} ${a.k_ko}`)).flatMap((a) => [a.v_zh, a.v_ko]).map(S).filter((v) => v.length >= 2));
const stripBrand = (text, brands) => { const t0 = String(text ?? ""); if (!brands.some((b) => t0.includes(b))) return t0.trim(); return brands.reduce((t, b) => t.split(b).join(" "), t0).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"); };
export function coreNoun(text = "") { const toks = nounTokens(text); return toks.length ? toks[toks.length - 1] : ""; }
// ① 검색어 → ② 리스트업 상품명의 핵심 명사 → ③ 제목 번역의 마지막 명사 → ④ "이 상품"
export function productNoun(input = {}) { return S(input.keyword) || coreNoun(input.coupangName) || coreNoun(input.title_ko) || "이 상품"; }
const okoLines = (im) => (im?.texts_ko || []).map((t, i) => ({ ko: S(t), zh: S(im.texts_zh?.[i]) })).filter((l) => l.ko && !policyKind(l.ko) && !isWholesale(l.ko) && !isWholesale(l.zh)).map((l) => l.ko);
// 이미지 한 장의 OCR 줄을 머리글 기준 블록으로 — [{ zh, ko, kind: notice|package|size|spec|null, header: bool, imageKind }]
// 머리글 = 8자 이하의 짧은 줄이 종류 키워드에 걸릴 때. 머리글이 없는 줄은 이미지 전체 분류(imageKind)를 따른다
export function splitBlocks(im = {}) {
  const zhs = (im.texts_zh || []).map(S), kos = (im.texts_ko || []).map(S);
  const imageKind = classifyImage(zhs);
  let cur = null;
  return zhs.map((zh, i) => {
    const isHeader = hasCJK(zh) && zh.length <= 8 && !/\d/.test(zh) && Object.keys(CLASS_RE).some((k) => CLASS_RE[k].test(zh));
    if (isHeader) cur = ["notice", "package", "size", "spec"].find((k) => CLASS_RE[k].test(zh)) || null;
    return { zh, ko: kos[i] || "", kind: cur, header: isHeader, imageKind, wholesale: isWholesale(zh) || isWholesale(kos[i] || "") };
  });
}
const zhOf = (im) => (im?.texts_zh || []).join(" ");

export function rulesCopy(input = {}) {
  const images = input.images || [];
  const details = images.filter((im) => normKind(im.kind || "detail") === "detail"); // main/sku/detail(구 gallery/option/detail)
  const brands = brandValues(input);
  const kw = stripBrand(productNoun(input), brands) || "이 상품"; // 헤드라인·CTA·상품명이 모두 이 명사를 쓴다(공급사 브랜드명 제외)
  // 상품명 앞머리: 검색어가 있으면 검색어, 없으면 제목 번역에서 군더더기(도매·신상 등)를 뺀 앞부분
  const nameLead = stripBrand(S(input.keyword) || (kw !== "이 상품" && S(input.title_ko) ? clip(uniq([...nounTokens(input.title_ko).filter((t) => t !== kw && !brands.includes(t)), kw]).join(" "), 20) : kw), brands) || kw;
  const hay = [input.title_zh, ...(input.attrs || []).filter((a) => !BRAND_KEY.test(`${a.k_zh} ${a.k_ko}`)).flatMap((a) => [a.k_zh, a.v_zh]), ...images.map(zhOf)].map(S).join(" ");
  // 특징: 원문에 있는 키워드만 → 어느 이미지가 보여 주는지도 찾는다
  const feats = FEATURES.filter((f) => f.re.test(hay)).map((f) => ({ ...f, imageId: details.find((im) => im.usable !== false && f.re.test(zhOf(im)))?.id || null })); // 비전이 못 쓴다고 한 사진은 가리키지 않음
  for (const f of FALLBACK_FEATURES) if (feats.length < 3) feats.push({ ...f, imageId: null });
  const badges = feats.slice(0, 3).map((f) => f.badge);
  const painSet = PAIN_SETS.find((p) => p.re.test(`${kw} ${input.title_ko || ""} ${input.category || ""}`))?.items || PAIN_DEFAULT;
  const material = (input.attrs || []).find((a) => /材质|材料|재질|소재/.test(`${a.k_zh} ${a.k_ko}`));
  const matKo = material ? S(material.v_ko || material.v_zh) : "";
  // 속성표 → 스펙 (도매용 항목 제외)
  const spec = (input.attrs || []).filter((a) => !WHOLESALE_KEY.test(`${a.k_zh} ${a.k_ko}`) && S(a.v_ko || a.v_zh))
    .map((a) => ({ k: S(a.k_ko || a.k_zh), v: S(a.v_ko || a.v_zh) })).filter((r) => r.k && r.v && !hasCJK(r.k) && !hasCJK(r.v) && !policyKind(`${r.k} ${r.v}`) && !MEANINGLESS_SPEC_KEY.test(r.k)).slice(0, 12);
  // 이미지 분류 키워드로 사이즈·구성·주의 문장 찾기
  // OCR 줄을 머리글(温馨提示·包装清单·产品尺寸·产品参数 …) 기준 블록으로 나눠 종류별로 쓴다(한 이미지에 치수+구성+주의가 섞여 있어도 섞이지 않게)
  const blocks = images.flatMap((im) => splitBlocks(im)).filter((b) => !b.wholesale); // 도매·중국 셀러 문구 줄은 어디에도 안 쓴다
  const linesOf = (kind) => noPolicy(uniq(blocks.filter((b) => b.kind === kind && !b.header).map((b) => b.ko).filter(Boolean)));
  const DIM_LINE = /\d+(?:\.\d+)?\s*[*×xX]\s*\d+|\d+(?:\.\d+)?\s*(cm|mm|㎝|㎜|厘米|毫米|센티|밀리)/i;
  const sizeLines = linesOf("size").filter((t) => DIM_LINE.test(t) && !/误差|오차/.test(t));
  const sizeAttr = (input.attrs || []).find((a) => /尺寸|规格|大小|크기|사이즈|규격/.test(`${a.k_zh} ${a.k_ko}`) && S(a.v_ko || a.v_zh));
  const size_note = sizeLines.length ? clip(sizeLines.slice(0, 3).join(" · "), 80) : sizeAttr ? clip(`${S(sizeAttr.k_ko || sizeAttr.k_zh)}: ${S(sizeAttr.v_ko || sizeAttr.v_zh)}`, 80) : "";
  // 구성품: package 블록(또는 package 로 분류된 이미지)의 "숫자+个/套/张/件·x1" 줄과 清单 아래 줄만. 치수·주의 줄은 뺀다
  const COUNT = /\d+\s*(?:个|套|张|件|只|条|本|副|对|双|包|袋|块|片|개|세트|장|매|권|쌍)|[x×X]\s*\d+/;
  const NOTICE_LINE = /请勿|注意|避免|切勿|不要|误差|주의|마세요|오차/;
  const pkgLines = blocks.filter((b) => !b.header && (b.kind === "package" || (b.kind == null && b.imageKind === "package")) && !DIM_LINE.test(b.zh) && !NOTICE_LINE.test(b.zh) && !NOTICE_LINE.test(b.ko));
  const counted = pkgLines.filter((b) => COUNT.test(b.zh) || COUNT.test(b.ko));
  const package_items = noPolicy(uniq((counted.length ? counted : pkgLines).map((b) => b.ko).filter(Boolean))).map((t) => clip(t, 24)).slice(0, 6);
  // 주의 문장: notice 블록 줄 + 기본 문장(같은 뜻이 이미 있으면 기본 문장은 뺌 — 색상 차이·치수 오차)
  const noticeRaw = blocks.filter((b) => b.kind === "notice" && !b.header);
  const noticeLines = noPolicy(uniq(noticeRaw.map((b) => b.ko).filter(Boolean))).map((t) => clip(t, 60));
  const noticeZh = noticeRaw.map((b) => `${b.zh} ${b.ko}`).join(" ");
  const covered = (def) => (/색상|모니터/.test(def) && /色差|显示器|颜色|색상|색차|모니터/.test(noticeZh)) || (/측정|오차|치수/.test(def) && /误差|测量|尺寸|오차|측정|치수/.test(noticeZh));
  const notice = uniq([...noticeLines.slice(0, 3), ...NOTICE_DEFAULT.filter((d) => !covered(d))]).slice(0, 6);
  // 이미지 캡션: OCR 번역 첫 줄 = 제목, 나머지 줄만 " · " 로 이어 설명(마침표 없음, 제목과 겹치는 줄 제외)
  const captions = details.map((im) => {
    const ko = okoLines(im);
    if (!ko.length) return { imageId: im.id, title: "제품 상세", desc: "" }; // 쓸 사실이 없으면 설명은 비운다(무의미한 문장 금지)
    const title = clipTitle(ko[0], 20);
    const rest = uniq(ko.slice(1).filter((t) => t !== title && t !== ko[0]));
    return { imageId: im.id, title, desc: clip(rest.join(" · "), 80) };
  });
  const headline = pick([`${kw} 하나로 정리 끝`, `${kw}로 더 편해지는 하루`, `${kw}, 고민 끝`], 18) || "정리가 쉬워집니다";
  const subItems = [...badges, ...(matKo ? [`${matKo} 재질`] : [])].filter((t, i, arr) => arr.findIndex((x) => lastWord(x) === lastWord(t)) === i); // "두꺼운 재질 · PP 재질" 처럼 같은 명사는 하나만
  const sub = clip(subItems.join(" · "), 30) || "매일 쓰는 물건, 편하게 고르세요";
  const faq = [
    { ...NEUTRAL_FAQ.shipping },
    matKo ? { q: "재질이 무엇인가요?", a: `${matKo} 재질입니다. 자세한 내용은 상세 스펙을 참고해 주세요.` }
          : { q: "크기는 어떻게 확인하나요?", a: "상세 이미지의 사이즈 안내를 참고해 주세요. 측정 방법에 따라 약간의 오차가 있을 수 있습니다." },
    { ...NEUTRAL_FAQ.return },
  ];
  const optLabels = (input.options || []).map((o) => S(o.label_ko || o.label_zh)).filter((t) => t && !hasCJK(t));
  if (optLabels.length > 1) faq.push({ q: "옵션은 어떻게 고르나요?", a: `${clip(optLabels.slice(0, 6).join(", "), 50)} 중에서 골라 주문해 주세요.` });
  return {
    name_ko: clip(uniq([nameLead, ...badges, ...(matKo ? [matKo] : [])]).join(" "), 40),
    headline, sub, badges,
    pain: { title: "이런 적 있으시죠?", items: painSet.map((p) => ({ ...p })) },
    usp: { title: "그래서 이렇게 만들었습니다", items: feats.slice(0, 4).map((f) => ({ title: f.title, desc: f.desc, imageId: f.imageId })) },
    captions, spec, size_note,
    package_items: package_items.length ? package_items : ["본품"],
    notice, faq,
    cta: { headline: clip(`${kw}, 오늘부터 바꿔 보세요`, 20), sub: "장바구니에 담고 편해지는 하루를 만나 보세요" },
    tone: "friendly",
    // 사진 위 짧은 라벨: 규칙 경로는 구글 번역(이미지 OCR 번역 쌍)을 그대로 쓰되 수량 단위어는 뺀다
    labels: (input.labels || []).map((l) => { const im = images.find((x) => x.id === l.imageId); const i = (im?.texts_zh || []).indexOf(l.zh); const ko = i >= 0 ? S(im.texts_ko[i]) : ""; return ko && !hasCJK(ko) && !UNIT_WORD_RE.test(l.zh) ? { imageId: l.imageId, zh: l.zh, ko: clip(ko, 20) } : null; }).filter(Boolean).slice(0, 40),
  };
}
const pick = (cands, max) => cands.find((c) => c.length <= max) || "";
const lastWord = (t) => { const w = S(t).split(/\s+/); return w[w.length - 1] || ""; };

// ─────────────────────────────── 금지어 검사 ───────────────────────────────
const BANNED = [
  [/최저가/, "최저가"], [/최고/, "최고"], [/100\s*%/, "100%"], [/완치/, "완치"], [/치료/, "치료"], [/효능/, "효능"], [/의학적|의학|질병|염증|피부\s*개선|다이어트/, "의학적 효능"],
  [/쿠팡|네이버|스마트스토어|지마켓|G마켓|11번가|옥션|알리익스프레스|테무|타오바오|1688|티몬|위메프|아마존/i, "타 쇼핑몰 이름"],
  [/(?<![가-힣\w])\d[\d,.]*\s*원(?![단칙래인자형목산장천두유리])/, "가격(원)"], [/₩\s*\d|\d\s*₩/, "가격(₩)"], [/\d+\s*%\s*(할인|세일|OFF)/i, "할인율"],
];
// ── 신뢰 배지(claims): 완판·순위·개발비·인증·후기·공식 판매처 — 금지가 아니라 **셀러가 1단계 확인 화면에서 입력한 값만** 쓰는 기능.
//    AI 가 스스로 지어내면 안 되므로 AI 글에서는 계속 걸러낸다(bannedIn 이 "신뢰 배지(셀러 입력 전용)" 으로 보고). 셀러 값은 plan 의 claim 섹션·hero 배지로 앱이 직접 넣는다.
export const CLAIM_RULES = [
  [/완판|매진\s*행렬|누적\s*판매|판매\s*량\s*\d|\d+\s*만\s*개\s*판매/, "sold_out"], [/(?<!\d)1\s*위|\d+\s*위\s*(달성|기록)|랭킹\s*\d/, "rank"],
  [/연구\s*개발\s*(비|비용)|개발\s*비\s*\d|R&D\s*\d/i, "rnd_cost"], [/인증\s*번호|KC\s*인증|인증\s*획득|특허\s*(획득|등록|출원|번호)/i, "cert"],
  [/(실사용|구매)?\s*후기\s*\d|만족도\s*\d|100\s*%\s*(실사용|후기|리얼)|실사용\s*후기\s*100/, "review_stat"], [/공식\s*(판매처|인증\s*점|스토어)/, "official_store"],
];
export function claimIn(text) { const t = S(text); return CLAIM_RULES.filter(([re]) => re.test(t)).map(([, k]) => k); }
function walkStrings(obj, fn, path = "") {
  if (typeof obj === "string") return fn(obj, path);
  if (Array.isArray(obj)) obj.forEach((v, i) => walkStrings(v, fn, `${path}[${i}]`));
  else if (obj && typeof obj === "object") for (const k of Object.keys(obj)) walkStrings(obj[k], fn, path ? `${path}.${k}` : k);
}
// 중립 문장(교환·반품은 쿠팡 정책을 따릅니다 등)은 금지어 검사에서 뺀다 — "쿠팡" 금지는 타 쇼핑몰·비교 광고를 막기 위한 것
const dropNeutral = (text) => S(text).split(SENT).filter((t) => !NEUTRAL_SET.has(t.trim())).join(" ");
export function bannedIn(text) { const t = dropNeutral(text); return [...BANNED.filter(([re]) => re.test(t)).map(([, w]) => w), ...claimIn(t).map((k) => `신뢰 배지(${k}, 셀러 입력 전용)`)]; } // AI 가 지어낸 신뢰 배지 문구도 막는다
// claims 값 정리(셀러 입력): { sold_out:"7차 완판", rank:{category,rank}|"…", rnd_cost:"2억", cert:[{name,no}], official_store:true|"…", review_stat:{count, satisfaction}, trust_badges:[] }
export function normalizeClaims(c = {}) {
  const t = (v, n = 30) => clip(S(v), n);
  const rank = typeof c.rank === "string" ? t(c.rank) : c.rank?.category && c.rank?.rank ? t(`${S(c.rank.category)} ${S(c.rank.rank)}위`) : "";
  const certs = (Array.isArray(c.cert) ? c.cert : c.cert ? [c.cert] : []).map((x) => (typeof x === "string" ? { name: t(x, 40), no: "" } : { name: t(x?.name, 40), no: t(x?.no, 40) })).filter((x) => x.name);
  const rv = c.review_stat || {}; const review = rv.count || rv.satisfaction ? { count: S(rv.count).replace(/[^\d,만천]/g, ""), satisfaction: S(rv.satisfaction).replace(/[^\d.]/g, "") } : null;
  const official = c.official_store === true ? "공식 판매처" : t(c.official_store || "");
  const out = { sold_out: t(c.sold_out), rank, rnd_cost: t(c.rnd_cost), cert: certs, official_store: official, review_stat: review };
  const auto = [out.sold_out, rank, certs[0]?.name, official, review?.satisfaction ? `만족도 ${review.satisfaction}%` : review?.count ? `후기 ${review.count}건` : ""].filter(Boolean);
  out.trust_badges = (Array.isArray(c.trust_badges) && c.trust_badges.length ? c.trust_badges.map((x) => t(x, 16)) : auto).filter(Boolean).slice(0, 4);
  out.any = !!(out.sold_out || rank || out.rnd_cost || certs.length || official || review || out.trust_badges.length);
  return out;
}
// 수강생 입력 도우미: 문구 틀만(숫자·순위·번호 칸은 □ 로 비워 둠) — AI 가 사실을 만들지 않는다
export function suggestClaims(brief = {}) {
  const cat = clip(S(brief.product_type).split(/[·,\s]/).filter(Boolean).slice(-2).join(" ") || "카테고리", 14);
  return {
    sold_out: ["□차 완판", "누적 판매 □만 개", "□일 만에 완판"],
    rank: [`${cat} 카테고리 □위`, `쿠팡 □□ 카테고리 □위`].map((x) => x.replace(/쿠팡\s*/, "")),
    rnd_cost: ["연구 개발비 □억 원 투자", "□년 연구 개발"],
    cert: ["KC 인증 (인증번호 □□□□-□□□□)", "특허 등록 (제 □□-□□□□□□□호)"],
    official_store: ["공식 판매처", "□□ 공식 스토어"],
    review_stat: ["실사용 후기 □건", "구매 만족도 □%"],
    trust_badges: ["□차 완판", `${cat} □위`, "KC 인증", "만족도 □%"],
    note: "□ 칸은 실제 자료가 있을 때만 채워 주세요. 비워 두면 그 섹션은 페이지에 넣지 않습니다.",
  };
}
// 셀러 신뢰 값을 카피에 자연스럽게: hero 라벨(완판·순위 우선), 문제 제기 보조문 아래 배지 줄 — AI 정화 뒤에 앱이 직접 넣는다
export function applyClaims(copy = {}, claims = null) {
  const c = normalizeClaims(claims || {});
  if (!c.any) return copy;
  const out = { ...copy };
  const top = c.sold_out || c.rank || c.trust_badges[0];
  if (out.hero && top) out.hero = { ...out.hero, label: clip(top, 12), badges: c.trust_badges };
  if (out.problem && (c.review_stat?.count || c.sold_out)) out.problem = { ...out.problem, proof: c.review_stat?.count ? `이미 ${c.review_stat.count}명이 고른 해결책` : `${c.sold_out}, 이유가 있어요` };
  out.claims = c;
  return out;
}
export function lintCopy(copy) {
  const issues = [];
  walkStrings(copy, (text, path) => {
    for (const w of bannedIn(text)) issues.push({ path, word: w, kind: "banned", text: clip(text, 60) });
    for (const k of uniq(scrubPolicy(text).hits)) issues.push({ path, word: `판매 정책 약속(${POLICY.find((p) => p[1] === k)[2]})`, kind: "policy", text: clip(text, 60) });
    if (scrubWholesale(text).hits) issues.push({ path, word: "도매·중국 셀러 문구", kind: "wholesale", text: clip(text, 60) });
  });
  return { ok: issues.length === 0, issues };
}

// ─────────────────────────────── 숫자 검증 (원문에 없는 수치 제거) ───────────────────────────────
const NUM = /\d+(?:[.,]\d+)?/g;
const UNIT = "(?:cm|mm|m|km|kg|g|mg|ml|l|리터|㎝|㎜|㎏|ℓ|인치|inch|개|장|매|년|개월|일|시간|분|초|도|℃|°|w|v|mah|ah|단|칸|층|인용|인분|배|회|겹|p|pcs|세트|종|색|가지|kgf|lb|oz|평|호|px)";
const NUM_UNIT = new RegExp(`(\\d+(?:[.,]\\d+)?(?:\\s*[x×*~\\-]\\s*\\d+(?:[.,]\\d+)?)*)\\s*${UNIT}(?![a-zA-Z가-힣])`, "gi");
const norm = (n) => String(parseFloat(String(n).replace(/,/g, "")));
// 입력의 "글" 칸에 나오는 숫자만 모은다(이미지 id·주소·크기 w/h 는 근거가 아니므로 뺀다)
export function inputTexts(input = {}) {
  return [input.title_zh, input.title_ko, input.detailText_ko, input.keyword, input.coupangName, input.category,
    ...(input.attrs || []).flatMap((a) => [a.k_zh, a.v_zh, a.k_ko, a.v_ko]), ...(input.options || []).flatMap((o) => [o.label_zh, o.label_ko]),
    ...(input.images || []).flatMap((im) => [...(im.texts_zh || []), ...(im.texts_ko || [])])].map(S).filter(Boolean);
}
export function inputNumbers(input = {}) {
  const set = new Set();
  for (const t of inputTexts(input)) for (const m of t.match(NUM) || []) set.add(norm(m));
  return set;
}
// 글에서 "단위 붙은 수치" 중 입력에 없는 것 → 그 문장을 지운다. 돌려주는 값: { text, removed: [] }
export function stripForeignNumbers(text, allowed) {
  const removed = [];
  const sentences = S(text).split(/(?<=[.!?。])\s+|\n/);
  const kept = sentences.filter((s) => {
    let bad = false;
    for (const m of s.matchAll(NUM_UNIT)) if ((m[1].match(NUM) || []).some((n) => !allowed.has(norm(n)))) { bad = true; removed.push(m[0]); }
    return !bad;
  });
  return { text: kept.join(" ").trim(), removed };
}

// ─────────────────────────────── 형식 검증 (JSON Schema 부분집합) ───────────────────────────────
export function validateCopy(copy, schema = COPY_SCHEMA) {
  const errors = [];
  const check = (v, sc, path) => {
    const types = Array.isArray(sc.type) ? sc.type : [sc.type];
    const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    const tOk = types.some((x) => x === t || (x === "integer" && Number.isInteger(v)));
    if (!tOk) return errors.push(`${path || "(root)"}: ${types.join("|")} 이어야 하는데 ${t}`);
    if (sc.enum && !sc.enum.includes(v)) errors.push(`${path}: ${sc.enum.join("|")} 중 하나여야 함`);
    if (t === "object") {
      for (const k of sc.required || []) if (!(k in v)) errors.push(`${path ? path + "." : ""}${k}: 없음`);
      for (const k of Object.keys(v)) {
        if (sc.properties?.[k]) check(v[k], sc.properties[k], path ? `${path}.${k}` : k);
        else if (sc.additionalProperties === false) errors.push(`${path ? path + "." : ""}${k}: 허용되지 않는 항목`);
      }
    }
    if (t === "array") {
      if (sc.minItems != null && v.length < sc.minItems) errors.push(`${path}: 최소 ${sc.minItems}개`);
      if (sc.maxItems != null && v.length > sc.maxItems) errors.push(`${path}: 최대 ${sc.maxItems}개`);
      if (sc.items) v.forEach((x, i) => check(x, sc.items, `${path}[${i}]`));
    }
  };
  check(copy, schema, "");
  return { ok: errors.length === 0, errors };
}

// ─────────────────────────────── 정화: 금지어 문장 교체 + 외부 숫자 제거 + 길이·개수 보정 ───────────────────────────────
// → { copy, fixes: ["usp.items[1].desc: 금지어(최고) → 규칙 문장", ...] }
export function sanitizeCopy(copy, input = {}, { schema = COPY_SCHEMA } = {}) {
  const rules = rulesCopy(input);
  const allowed = inputNumbers(input);
  const fixes = [];
  const imageIds = new Set((input.images || []).map((im) => im.id));
  const usableIds = new Set((input.images || []).filter((im) => im.usable !== false).map((im) => im.id)); // usp 는 쓸 수 있는 사진만
  const c = JSON.parse(JSON.stringify(copy || {}));
  // 글 한 칸 정화: 금지어 → 대체문, 외부 숫자 → 문장 제거. 빈 문자열이 되면 대체문(없으면 "")
  const clean = (text, path, fallback = "", { short = false } = {}) => {
    let t = S(text);
    const bad = bannedIn(t);
    if (bad.length) { fixes.push(`${path}: 금지어(${bad.join(",")}) → 규칙 문장`); t = S(fallback); }
    const r = stripForeignNumbers(t, allowed);
    if (r.removed.length) { fixes.push(`${path}: 원문에 없는 수치(${r.removed.join(",")}) 문장 제거`); t = r.text || S(fallback); if (stripForeignNumbers(t, allowed).removed.length) t = ""; }
    const ws = scrubWholesale(t); // 도매·중국 셀러 문구 문장 제거(대체 없음) → 비면 대체문
    if (ws.hits) { fixes.push(`${path}: 도매·중국 셀러 문구 → 제거`); t = ws.text || scrubWholesale(S(fallback)).text; }
    if (!short) { // 긴 칸: 상세 화면 자체·위험 안내 문장 제거, 하중 주장은 "제조사 제공 기준" 접두·체중 테스트 문장 제거
      const mr = scrubMeaningless(t); if (mr.hits) { fixes.push(`${path}: 무의미·위험 안내 문장 ${mr.hits}개 제거`); t = mr.text; }
      const lr = scrubLoad(t); if (lr.hits) { fixes.push(`${path}: 하중·체중 문장 보정 ${lr.hits}건`); t = lr.text; }
    }
    const pf = scrubPolicy(t, { short }); // 판매 정책 약속(입력 근거가 있어도) → 중립 문장 / 짧은 칸은 제거
    if (pf.hits.length) { fixes.push(`${path}: 판매 정책 약속(${uniq(pf.hits).join(",")}) → ${short ? "제거" : "중립 문장"}`); t = pf.text || scrubPolicy(S(fallback), { short }).text; }
    return t;
  };
  const SHORT = { short: true };
  const brands = brandValues(input);
  const noBrand = (text, path) => { const t = stripBrand(text, brands); if (t !== S(text)) fixes.push(`${path}: 공급사 브랜드명 제거`); return t; };
  c.name_ko = clip(noBrand(clean(c.name_ko, "name_ko", rules.name_ko, SHORT), "name_ko"), 40) || rules.name_ko;
  c.headline = noBrand(clean(c.headline, "headline", rules.headline, SHORT), "headline"); if (!c.headline || c.headline.length > 24) { if (c.headline) fixes.push("headline: 24자 초과 → 규칙 문장"); c.headline = rules.headline; }
  c.sub = clean(c.sub, "sub", rules.sub, SHORT); if (!c.sub || c.sub.length > 36) { if (c.sub) fixes.push("sub: 36자 초과 → 규칙 문장"); c.sub = rules.sub; }
  c.badges = uniq((Array.isArray(c.badges) ? c.badges : []).map((b, i) => clip(noBrand(clean(b, `badges[${i}]`, "", SHORT), `badges[${i}]`), 12)).filter(Boolean));
  for (const b of rules.badges) if (c.badges.length < 3 && !c.badges.includes(b)) c.badges.push(b);
  c.badges = c.badges.slice(0, 3);
  // pain
  c.pain = c.pain && typeof c.pain === "object" ? c.pain : {};
  c.pain.title = clean(c.pain.title, "pain.title", rules.pain.title) || rules.pain.title;
  c.pain.items = (Array.isArray(c.pain.items) ? c.pain.items : []).map((it, i) => ({ icon: S(it?.icon) || "😩", text: clean(it?.text, `pain.items[${i}].text`, rules.pain.items[i]?.text) })).filter((it) => it.text);
  for (const it of rules.pain.items) if (c.pain.items.length < 3) c.pain.items.push({ ...it });
  c.pain.items = c.pain.items.slice(0, 3);
  // usp
  c.usp = c.usp && typeof c.usp === "object" ? c.usp : {};
  c.usp.title = clean(c.usp.title, "usp.title", rules.usp.title) || rules.usp.title;
  c.usp.items = (Array.isArray(c.usp.items) ? c.usp.items : []).map((it, i) => ({
    title: clip(clean(it?.title, `usp.items[${i}].title`, rules.usp.items[i]?.title, SHORT), 20), desc: clip(clean(it?.desc, `usp.items[${i}].desc`, rules.usp.items[i]?.desc), 80),
    imageId: typeof it?.imageId === "string" && usableIds.has(it.imageId) ? it.imageId : null,
  })).filter((it) => it.title && it.desc);
  for (const it of rules.usp.items) if (c.usp.items.length < 3 && !c.usp.items.some((x) => x.title === it.title)) c.usp.items.push({ ...it });
  c.usp.items = c.usp.items.slice(0, 4);
  // captions: detail 이미지마다 하나, 없는 이미지 id 는 버림
  const capById = new Map();
  for (const [i, cp] of (Array.isArray(c.captions) ? c.captions : []).entries()) {
    if (!imageIds.has(cp?.imageId) || capById.has(cp.imageId)) { fixes.push(`captions[${i}]: 없는/중복 이미지 id → 제거`); continue; }
    capById.set(cp.imageId, { imageId: cp.imageId, title: clip(clean(cp.title, `captions[${i}].title`, "", SHORT), 20), desc: clip(clean(cp.desc, `captions[${i}].desc`), 100) });
  }
  c.captions = rules.captions.map((rc) => { const cp = capById.get(rc.imageId); return cp && cp.title ? { ...cp } : rc; }) // AI 캡션의 설명이 비면(무의미 문장 제거 포함) 제목만 — 규칙 설명으로 메우지 않는다
    .map((cp, i) => { const r = scrubMeaningless(cp.desc); if (r.hits) fixes.push(`captions[${i}].desc: 무의미·위험 안내 문장 ${r.hits}개 제거`); return { ...cp, desc: r.text }; }); // 비면 제목만
  // spec: 원문 attrs 에 없는 값·외부 숫자·금지어가 있는 줄은 버림
  const attrVals = new Set((input.attrs || []).flatMap((a) => [a.v_ko, a.v_zh].map(S)));
  c.spec = (Array.isArray(c.spec) ? c.spec : []).map((r, i) => {
    const k = clip(S(r?.k), 20), v = S(r?.v);
    if (!k || !v) return null;
    if (bannedIn(k + " " + v).length) { fixes.push(`spec[${i}]: 금지어 → 제거`); return null; }
    if (stripForeignNumbers(v, allowed).removed.length) { fixes.push(`spec[${i}] ${k}: 원문에 없는 수치(${v}) → 제거`); return null; }
    if (WHOLESALE_KEY.test(k)) { fixes.push(`spec[${i}] ${k}: 도매용·공급사 브랜드 항목 → 제거`); return null; }
    if (brands.some((b) => v.includes(b))) { fixes.push(`spec[${i}] ${k}: 공급사 브랜드명 → 제거`); return null; }
    if (policyKind(`${k} ${v}`)) { fixes.push(`spec[${i}] ${k}: 판매 정책 약속 → 제거`); return null; }
    if (MEANINGLESS_SPEC_KEY.test(k)) { fixes.push(`spec[${i}] ${k}: 판매에 의미 없는 속성 → 제거`); return null; }
    return { k, v: clip(v, 60) };
  }).filter(Boolean).slice(0, 12);
  if (!c.spec.length) c.spec = rules.spec;
  void attrVals;
  c.size_note = clip(clean(c.size_note, "size_note", rules.size_note), 100);
  c.package_items = uniq((Array.isArray(c.package_items) ? c.package_items : []).map((t, i) => clip(clean(t, `package_items[${i}]`), 30)).filter(Boolean)).slice(0, 6);
  if (!c.package_items.length) c.package_items = rules.package_items;
  c.notice = uniq((Array.isArray(c.notice) ? c.notice : []).map((t, i) => clip(clean(t, `notice[${i}]`), 80)).filter(Boolean));
  for (const n of rules.notice) if (c.notice.length < 3 && !c.notice.includes(n)) c.notice.push(n);
  { const neutral = c.notice.filter((t) => NEUTRAL_SET.has(t)), rest = c.notice.filter((t) => !NEUTRAL_SET.has(t)); c.notice = [...rest.slice(0, 6 - neutral.length), ...neutral]; } // 중립 문장은 6개 상한에 밀려나지 않게
  c.faq = (Array.isArray(c.faq) ? c.faq : []).map((f, i) => {
    const qk = policyKind(f?.q), ak = qk || scrubPolicy(S(f?.a)).hits[0];
    if (ak && !NEUTRAL_SET.has(S(f?.q))) { fixes.push(`faq[${i}]: 판매 정책 약속(${ak}) → 중립 Q/A`); return { ...NEUTRAL_FAQ[ak] }; }
    return { q: clip(clean(f?.q, `faq[${i}].q`, "", SHORT), 50), a: clip(clean(f?.a, `faq[${i}].a`, rules.faq[i]?.a), 120) };
  }).filter((f) => f.q && f.a).filter((f, i, arr) => arr.findIndex((x) => x.q === f.q) === i);
  for (const f of rules.faq) if (c.faq.length < 3 && !c.faq.some((x) => x.q === f.q)) c.faq.push({ ...f });
  c.faq = c.faq.slice(0, 5);
  c.cta = c.cta && typeof c.cta === "object" ? c.cta : {};
  c.cta = { headline: clip(clean(c.cta.headline, "cta.headline", rules.cta.headline, SHORT), 24) || rules.cta.headline, sub: clip(clean(c.cta.sub, "cta.sub", rules.cta.sub, SHORT), 36) || rules.cta.sub };
  if (!["friendly", "premium", "pop"].includes(c.tone)) c.tone = "friendly";
  // labels: 입력 라벨에 있는 것만, 한글 번역이 있는 것만, 수량 단위어 제외
  const want = new Map((input.labels || []).map((l) => [`${l.imageId}|${l.zh}`, l]));
  c.labels = uniqBy((Array.isArray(c.labels) ? c.labels : []).filter((l) => l && want.has(`${S(l.imageId)}|${S(l.zh)}`) && S(l.ko) && !hasCJK(S(l.ko)) && !UNIT_WORD_RE.test(S(l.zh)) && !bannedIn(S(l.ko)).length)
    .map((l) => ({ imageId: S(l.imageId), zh: S(l.zh), ko: clip(S(l.ko), 20) })), (l) => `${l.imageId}|${l.zh}`).slice(0, 40);
  for (const rl of rules.labels) if (c.labels.length < 40 && !c.labels.some((l) => l.imageId === rl.imageId && l.zh === rl.zh)) c.labels.push(rl); // AI 가 빠뜨린 라벨은 규칙(구글) 번역
  for (const k of Object.keys(c)) if (!(k in schema.properties)) { delete c[k]; fixes.push(`${k}: 허용되지 않는 항목 → 제거`); }
  return { copy: c, fixes };
}

// ─────────────────────────────── v2 (기획안 기반) 규칙·정화 ───────────────────────────────
export const isV2 = (copy) => !!copy && typeof copy === "object" && ("agitate" in copy || "solution" in copy || "objections" in copy);
const linkWord = (title) => { const w = S(title).replace(/[^가-힣a-zA-Z0-9\s]/g, "").split(/\s+/).filter(Boolean); return w[w.length - 1] || ""; };
// 규칙 v2: v1 규칙 카피 + 기획안으로 problem/agitate/solution/benefits 체인/proof/compare/steps/objections/trust 를 채운다
export function rulesCopyV2(input = {}, briefIn = null) {
  const brief = briefCompat(briefIn);
  const base = rulesCopy(input);
  const b = brief || {};
  const kw = productNoun(input);
  const allowed = inputNumbers(input);
  // problem: 기획안의 top_problem 을 첫 항목으로
  if (S(b.top_problem)) base.pain.items = [{ icon: "😩", text: clip(b.top_problem, 30) }, ...base.pain.items.filter((it) => it.text !== S(b.top_problem))].slice(0, 3);
  // 헤드라인: 기획안의 top_desire 를 "…하기" 꼴로(18자 안에 들어올 때만), 아니면 v1 규칙 헤드라인
  if (S(b.top_desire)) { const h = S(b.top_desire).replace(/(하)고\s*싶(다|어요)$/, "$1기").replace(/\s*싶(다|어요)$/, "").trim(); if (h.length >= 6 && h.length <= 18) base.headline = h; }
  // benefits 체인: 소제목 i 는 앞 특징의 명사를 받아 "…에 더해 …까지" 로 잇는다(소제목만 모아 읽어도 한 문단이 되게)
  const feats = base.usp.items.map((it) => { const f = [...FEATURES, ...FALLBACK_FEATURES].find((x) => x.title === it.title); return { ...it, noun: f ? featureNoun(f) : linkWord(it.title) }; });
  for (let i = 1; i < feats.length; i++) { const prev = feats[i - 1].noun; if (prev && !feats[i].title.includes(prev)) feats[i].title = clip(`${prev}에 더해 ${feats[i].noun}까지`, 18); }
  base.usp.items = feats.map(({ noun, ...it }) => it);
  const items = base.usp.items;
  // proof: 속성·OCR 번역의 "숫자+단위" 중 한글 설명이 붙은 것 3개(치수 묶음·한자 줄·숫자뿐인 줄 제외)
  const proof = [];
  const SINGLE = new RegExp(`(?<![\\d*×x])(\\d+(?:[.,]\\d+)?)\\s*${UNIT}(?![a-zA-Z가-힣*×x])`, "gi");
  for (const t of inputTexts(input)) { if (hasCJK(t)) continue; for (const m of t.matchAll(SINGLE)) { const v = norm(m[1]); const label = clip(t.replace(m[0], "").replace(/[.。:：,·]+$/, "").replace(/\s+/g, " ").trim(), 20); if (proof.length < 3 && allowed.has(v) && (label.match(/[가-힣]/g) || []).length >= 2 && !proof.some((p) => p.value === v)) proof.push({ value: v, unit: S(m[0]).replace(m[1], "").trim(), label }); } }
  const steps = [{ title: "받자마자 꺼내기", desc: "포장을 풀고 구성품을 확인해 주세요." }, { title: "펼치거나 놓기", desc: "쓸 자리에 펼치거나 놓아 주세요." }, { title: "바로 쓰기", desc: "별도 조립 없이 바로 쓰실 수 있어요." }];
  const objections = (b.objections || []).slice(0, 5).map((q) => ({ q: clip(q, 30), a: "상세 이미지와 스펙에서 확인하실 수 있어요. 궁금한 점은 문의 주세요." }));
  while (objections.length < 3) objections.push({ q: ["사진과 같을까요?", "금방 망가지지 않을까요?", "크기가 맞을까요?"][objections.length], a: "상세 이미지와 스펙에서 확인하실 수 있어요. 궁금한 점은 문의 주세요." });
  const mat = base.spec.find((r) => /재질/.test(r.k))?.v;
  const trust = { items: uniq([mat ? `${mat} 재질로 꼼꼼하게 만들었습니다.` : "", "출고 전 하나씩 검수합니다.", base.package_items.length ? `구성: ${base.package_items.join(", ")}` : "", "궁금한 점은 판매자 문의로 바로 답해 드립니다."].filter(Boolean)).slice(0, 4) };
  if (isBriefV3(briefIn) && S(briefIn.product_name_ko)) base.name_ko = clip(briefIn.product_name_ko, 40);
  const ed = rulesEditorial(input, base, brief); if (isBriefV3(briefIn) && (briefIn.targets || []).length) ed.for_you = uniq([...briefIn.targets.map((t) => clip(t, 24)), ...ed.for_you]).slice(0, 4);
  return { ...base, agitate: clip(`${S(b.top_problem || base.pain.items[0].text).replace(/[.!?]$/, "")}. 그대로 두면 시간과 공간이 조금씩 새어 나갑니다.`, 120),
    solution: { text: clip(`${kw}로 그 불편을 한 번에 정리해 보세요.`, 60), angle: clip(S(b.angle) || "매일 쓰는 물건이라 쓰임새를 먼저 생각해 만들었습니다.", 50) },
    chain_check: items.map((it) => it.title).join(" → "), proof, compare: { rows: [] }, steps, objections, trust, ...ed };
}
// ── v3 기획서(keyContent) → v2 규칙이 쓰는 brief 모양으로
export const isBriefV3 = (b) => !!b && (b.key_appeal != null || Array.isArray(b.plan_direction) || b.brief_text != null);
export function briefCompat(b) {
  if (!isBriefV3(b)) return b;
  const sents = S(b.key_appeal).split(/(?<=[.!?。])\s+/).filter(Boolean);
  return { persona: { who: S(b.targets?.[0]), situation: "" }, top_desire: S(sents[0]).replace(/[.!?]$/, ""), top_problem: "", buying_factors: (b.advantages || []).slice(0, 5),
    objections: [], competitor_claims: [], angle: S(sents[1] || sents[0]), evidence: [], tone: "friendly", targets: b.targets || [], caution: b.caution || [] };
}
// 주의할 표현 → 정화 규칙: 그 항목에 나온 "숫자+단위"는 "제조사 표시 기준"을 붙이거나(이미 있으면 그대로), 단정 표현(완벽·영구·절대·무조건·평생·100%)은 그 문장 제거, 인증·특허 언급은 원문 근거 없으면 제거
const ABSOLUTE_RE = /완벽|영구|절대|무조건|평생|반영구|100\s*%|완전\s*(차단|방지|무)/;
export function cautionRules(brief) {
  const items = (brief?.caution || []).map(S);
  const nums = new Set(); for (const c of items.filter((x) => /하중|내하중|무게|중량|kg|㎏|내구|수명|견디|버티|용량|제조사\s*(표시|제공)\s*기준/.test(x))) for (const m of c.matchAll(/(\d+(?:\.\d+)?)\s*(kg|㎏|g|cm|mm|m|l|ml|년|개월|회|°|도|w|v)/gi)) nums.add(`${norm(m[1])}${m[2].toLowerCase()}`);
  // 성능 단정 완화: 주의 항목이 녹·방청·방수·방진·방습을 "보장 아님/인증 아님"으로 다루면, 짧은 라벨의 그 표현을 완화한 말로
  const soft = [];
  if (items.some((c) => /녹|방청/.test(c))) soft.push([/녹\s*(방지|안\s*슴|슬지\s*않[는아]?|걱정\s*없)/g, "녹에 강한 도장"]);
  if (items.some((c) => /방수/.test(c))) soft.push([/완전\s*방수|방수(?!\s*보호)/g, "물기에 강한"]);
  if (items.some((c) => /방진|방습/.test(c))) soft.push([/방진\s*[·,]?\s*방습|방진|방습/g, "먼지·습기 관리"]);
  return { nums, soft, cert: items.some((c) => /인증|특허|KC|시험|성적서/.test(c)), absolute: items.some((c) => /단정|완벽|영구|절대/.test(c)) || items.length > 0 };
}
// 성능 단정 완화 전체 사전(한글화 레이어에 항상 적용 — 원본 이미지 문구는 공급사 주장이라 근거 확인이 안 됨)
export const SOFT_ALL = [
  [/밀폐\s*방수\s*층|(?<![가-힣])방수\s*층/g, "물기 차단 코팅층"], [/녹\s*(방지|막는|방청)\s*(보호)?\s*층/g, "녹에 강한 보호층"], [/녹\s*방지\s*$/g, "녹에 강한 소재"], [/녹(이)?\s*슬지\s*않아요/g, "녹에 강해요"], [/녹(이)?\s*슬지\s*않습니다/g, "녹에 강합니다"], [/녹(이)?\s*슬지\s*않(음|고)?\s*$/g, "녹에 강한 소재"],
  [/녹\s*(방지|안\s*슴|슬지\s*않[는은]?|걱정\s*(없|X))/g, "녹에 강한"], [/(?<![가-힣])방청\s*(보호)?\s*층/g, "녹에 강한 보호층"], [/(?<![가-힣])방청(?![가-힣])/g, "녹에 강한"],
  // 낱말 경계: "주방수납"의 "방수", "방습제" 처럼 다른 낱말 안에 든 글자는 바꾸지 않는다(앞이 한글이면 건너뜀)
  [/완전\s*방수|(?<![가-힣])방수(?!\s*보호|[가-힣]*(납|첩|선|구|기|제))/g, "물기에 강한"],
  [/(?<![가-힣])방진\s*[·,]?\s*방습(?![가-힣]*제)|(?<![가-힣])방진(?![가-힣])|(?<![가-힣])방습(?![가-힣])/g, "먼지·습기 관리"], [/완벽\s*(차단|밀폐)/g, "꼼꼼한 $1"], [/절대\s*(안|없)/g, "잘 $1"],
];
// 치환 뒤 어색함 검사: 바꾼 말 바로 뒤에 띄어쓰기 없이 한글이 붙음("물기에 강한납"), 같은 말 반복
const SOFT_WORDS = "(물기에 강한|먼지·습기 관리|녹에 강한 보호층|녹에 강한|녹에 강해요|녹에 강합니다|물기 차단 코팅층)";
export const AWKWARD_RE = new RegExp(`${SOFT_WORDS}(?=[가-힣])(?!(은|는|이|가|을|를|과|와|의|도|에|로|으로|이에요|입니다|해요|하고|하며|한))|[가-힣]${SOFT_WORDS}|(물기에 강한|먼지·습기 관리)\\s*\\4|강한(요|아요|습니다)`);
export function softenAll(text) {
  const src = String(text ?? "");
  let t = src, hits = 0;
  for (const [re, to] of SOFT_ALL) t = t.replace(re, (...m) => { hits++; return to.replace("$1", m[1] || ""); });
  t = t.replace(/녹에 강한\s*도장\s*도장/g, "녹에 강한 도장").replace(/\s+/g, " ").trim();
  if (hits && AWKWARD_RE.test(t)) return { text: src.replace(/\s+/g, " ").trim(), hits: 0, awkward: true }; // 어색하면 바꾸지 않은 원문(호출하는 쪽이 대체문을 정한다)
  return { text: t, hits };
}
export function softenClaims(text, rules) { let t = String(text ?? ""), hits = 0; for (const [re, to] of rules?.soft || []) t = t.replace(re, () => { hits++; return to; }); return { text: t.replace(/녹에 강한 도장\s*도장/g, "녹에 강한 도장"), hits }; }
export function applyCaution(text, rules, input = {}) {
  if (!rules) return { text: S(text), hits: 0 };
  let hits = 0;
  const srcText = inputTexts(input).join(" ");
  const out = S(text).split(SENT).filter((t) => t.trim()).filter((t) => {
    if (rules.absolute && ABSOLUTE_RE.test(t)) { hits++; return false; }
    if (rules.cert && /인증|특허|KC\s*인증|시험\s*성적/.test(t) && !/인증|特许|专利|认证|KC/.test(srcText)) { hits++; return false; }
    return true;
  }).map((t) => {
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(kg|㎏|g|cm|mm|m|l|ml|년|개월|회|°|도|w|v)(?![a-z])/gi)) if (rules.nums.has(`${norm(m[1])}${m[2].toLowerCase()}`) && !/제조사\s*(표시|제공)\s*기준/.test(t)) { hits++; return `제조사 표시 기준 ${t}`; }
    return t;
  });
  return { text: out.join(" ").trim(), hits };
}

// ── editorial 필드(규칙): 특징 → 영문 키워드, 상품 명사 → 영문 타이틀, 속성 규격 → 옵션 표
const EN_FEATURE = [
  [/두꺼운|튼튼|두껍/, "STRONG", "THICK MATERIAL"], [/접이|접어/, "FOLDING", "FOLDABLE DESIGN"], [/용량|넉넉/, "LARGE", "BIG CAPACITY"], [/방수|물기/, "DRY", "WATER RESISTANT"],
  [/손잡이|들고/, "CARRY", "EASY HANDLE"], [/통기|메쉬/, "AIR", "BREATHABLE MESH"], [/구조|오래/, "STABLE", "STURDY BUILD"], [/가벼/, "LIGHT", "LIGHTWEIGHT BODY"],
  [/냄새/, "CLEAN", "ODOR FREE"], [/세척|씻/, "WASH", "EASY CLEANING"], [/색상/, "COLOR", "MULTI COLOR"], [/디자인|깔끔/, "MINIMAL", "SIMPLE DESIGN"],
  [/미끄럼/, "GRIP", "ANTI SLIP"], [/뚜껑/, "COVER", "WITH LID"], [/분리 수납|칸/, "SORT", "DIVIDED STORAGE"], [/조용|소음/, "QUIET", "SILENT USE"], [/분리/, "EASY", "DETACHABLE PARTS"],
  [/마감/, "FINISH", "FINE FINISH"], [/사용/, "EASY", "EASY TO USE"], [/설계|쓰임새/, "SMART", "PRACTICAL DESIGN"], [/회전/, "ROTATE", "FREE ROTATION"], [/알루미늄/, "ALUMINUM", "RUST FREE FRAME"],
];
const EN_NOUN = [[/건조대/, ["DRYING", "RACK"]], [/빨래바구니|바구니|바스켓/, ["LAUNDRY", "BASKET"]], [/선반/, ["SHELF"]], [/수납|정리|박스|상자/, ["STORAGE", "BOX"]], [/옷걸이|행거/, ["HANGER"]], [/화분/, ["PLANT", "STAND"]], [/주방|조리/, ["KITCHEN", "TOOL"]], [/욕실/, ["BATH", "ITEM"]]];
// 포인트 라벨 = 기능명(한글 8자 이내): 키워드 한글 → 소제목에서 명사만
export function pointLabel(title, kwKo) {
  const k = S(kwKo); if (k && k.length <= 8 && !/[\u4e00-\u9fff]/.test(k)) return k;
  const words = S(title).replace(/[^가-힣a-zA-Z0-9° ]/g, " ").split(/\s+/).filter((w) => w && !/^(그리고|에|더해|까지|하게|없이|으로|로)$/.test(w));
  let out = ""; for (const w of words) { if ((out + (out ? " " : "") + w).length > 8) break; out += (out ? " " : "") + w; }
  return out || "핵심 기능";
}
// 영문 키워드 보조구: 2~3단어 자연스러운 명사구인지(전치사로 시작·단위만 남음·숫자 근거 없음 → 불합격)
const EN_PREP = /^(TO|OF|FOR|IN|ON|AT|WITH|BY|FROM|AND|OR|THE|A|AN)\b/;
const EN_UNIT = /\b(CM|MM|M|KG|G|L|ML|DEGREE|DEGREES|INCH|PCS|°)\b/;
export function enSubOk(sub, allowed = null) {
  const t = S(sub); if (!t) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4 || EN_PREP.test(t)) return false;
  const nums = t.match(/\d+(?:\.\d+)?/g) || [];
  if (EN_UNIT.test(t.replace(/\d+(?:\.\d+)?\s*(CM|MM|KG|G|L|ML|°)/g, "")) ) return false; // 숫자 없이 단위만 남은 구("COMPACT CM WIDTH")
  if (allowed && nums.some((n) => !allowed.has(String(parseFloat(n))))) return false;
  return true;
}
export function rulesEditorial(input = {}, base = {}, brief = null) {
  const key = `${input.keyword || ""} ${input.coupangName || ""} ${input.title_ko || ""}`;
  const title_en = (EN_NOUN.find(([re]) => re.test(key))?.[1] || ["DAILY", "ESSENTIAL"]).slice(0, 3);
  const keywords = [];
  for (const b of [...(base.badges || []), ...(base.usp?.items || []).map((u) => u.title), "꼼꼼한 마감", "간편한 사용", "실용적인 설계"]) {
    const hit = EN_FEATURE.find(([re]) => re.test(b));
    if (hit && !keywords.some((k) => k.en === hit[1]) && keywords.length < 5) keywords.push({ en: hit[1], en_sub: hit[2], ko: clip(S(b).replace(/[,.!]/g, ""), 8) });
  }
  const b = brief || {};
  const desireFor = S(b.top_desire).replace(/(고\s*)?싶(다|어요)$/, "").replace(/\s+$/, "");
  const for_you = uniq([S(b.persona?.who) ? clip(`${S(b.persona.who)}`, 24) : "", desireFor ? clip(`${desireFor}고 싶은 분`, 24) : "", "튼튼하고 오래 쓸 물건을 찾는 분", "깔끔한 정리를 좋아하는 분", "설치가 간편한 걸 원하는 분"].filter(Boolean)).slice(0, 4);
  const points = (base.usp?.items || []).map((u, i) => ({ label: pointLabel(u.title, keywords[i]?.ko), title: clip(u.title, 14), desc: clip(u.desc, 40) })).slice(0, 6);
  const callouts = uniq((base.badges || []).concat((base.usp?.items || []).map((u) => u.title))).map((t) => ({ label: clip(t, 10) })).slice(0, 5);
  // 옵션 표: 규격·사이즈 속성 값이 여러 개면 행으로(구분자 / , 、)
  const sizeAttr = (input.attrs || []).find((a) => /规格|尺寸|大小|규격|사이즈|크기/.test(`${a.k_zh} ${a.k_ko}`));
  const vals = sizeAttr ? S(sizeAttr.v_ko || sizeAttr.v_zh).split(/[\/,，、;；]+/).map(S).filter((v) => v && !/[\u4e00-\u9fff]/.test(v)) : [];
  const optRows = (input.options || []).map((o) => S(o.label_ko || o.label_zh)).filter((l) => /\d/.test(l) && !/[\u4e00-\u9fff]/.test(l));
  const rows = (vals.length > 1 ? vals : optRows.length > 1 ? optRows : []).map((v) => { const m = v.match(/\d+(?:\.\d+)?\s*(?:[*×xX]\s*\d+(?:\.\d+)?\s*)*(?:cm|mm|m|㎝)?/i); return { name: clip(v.replace(m?.[0] || "", "").trim() || v, 16), size: m ? S(m[0]) : "" }; }).slice(0, 8);
  return { hero_en: { title_en, script: base.tone === "premium" ? "Premium" : base.tone === "pop" ? "Lovely" : "Minimal" }, keywords, for_you, points, callouts, options_table: rows };
}

// v2 정화: v1 정화 + v2 칸(금지어·외부 숫자·정책 약속·길이). proof 의 value 는 입력 수치만, compare 는 근거 없는 수치 행 제거
export function sanitizeCopyV2(copy, input = {}, briefIn = null) {
  const brief = briefCompat(briefIn);
  const v1 = sanitizeCopy(copy, input, { schema: COPY_SCHEMA_V2 });
  const c = v1.copy, fixes = v1.fixes, rules = rulesCopyV2(input, brief), allowed = inputNumbers(input);
  const src = copy || {};
  const txt = (v, path, n, fb, short = false) => { let t = clip(S(v), n); const bad = bannedIn(t); if (bad.length) { fixes.push(`${path}: 금지어(${bad.join(",")}) → 규칙 문장`); t = S(fb); } const r = stripForeignNumbers(t, allowed); if (r.removed.length) { fixes.push(`${path}: 원문에 없는 수치(${r.removed.join(",")}) 제거`); t = r.text || S(fb); } const w = scrubWholesale(t); if (w.hits) t = w.text; if (!short) { const m = scrubMeaningless(t); if (m.hits) t = m.text; const l = scrubLoad(t); if (l.hits) { fixes.push(`${path}: 하중·체중 문장 보정`); t = l.text; } } const pf = scrubPolicy(t, { short }); if (pf.hits.length) { fixes.push(`${path}: 판매 정책 약속 → ${short ? "제거" : "중립 문장"}`); t = pf.text || S(fb); } return t || S(fb); };
  c.agitate = txt(src.agitate, "agitate", 120, rules.agitate);
  c.solution = { text: txt(src.solution?.text, "solution.text", 60, rules.solution.text), angle: txt(src.solution?.angle, "solution.angle", 50, rules.solution.angle, true) };
  c.chain_check = c.usp.items.map((it) => it.title).join(" → ");
  c.proof = (Array.isArray(src.proof) ? src.proof : []).map((p, i) => { const v = norm(S(p?.value).replace(/[^\d.,]/g, "") || "x"); if (!allowed.has(v)) { fixes.push(`proof[${i}]: 원문에 없는 수치(${S(p?.value)}) → 제거`); return null; } const unit = clip(S(p?.unit).replace(/[^a-zA-Z가-힣%°㎝㎜㎏ℓ]/g, ""), 6); const label = txt(p?.label, `proof[${i}].label`, 20, "", true); return unit && label ? { value: v, unit, label } : null; }).filter(Boolean).slice(0, 3);
  if (!c.proof.length) c.proof = rules.proof;
  c.compare = { rows: (Array.isArray(src.compare?.rows) ? src.compare.rows : []).map((r, i) => { const item = txt(r?.item, `compare.rows[${i}].item`, 14, "", true), generic = txt(r?.generic, `compare.rows[${i}].generic`, 20, "", true), ours = txt(r?.ours, `compare.rows[${i}].ours`, 20, "", true); return item && generic && ours ? { item, generic, ours } : null; }).filter(Boolean).slice(0, 4) };
  c.steps = (Array.isArray(src.steps) ? src.steps : []).map((st, i) => ({ title: txt(st?.title, `steps[${i}].title`, 14, "", true), desc: txt(st?.desc, `steps[${i}].desc`, 40, "") })).filter((st) => st.title && st.desc).slice(0, 3);
  if (c.steps.length < 3) c.steps = rules.steps;
  c.objections = (Array.isArray(src.objections) ? src.objections : []).map((o, i) => ({ q: txt(o?.q, `objections[${i}].q`, 30, "", true), a: txt(o?.a, `objections[${i}].a`, 60, rules.objections[i]?.a) })).filter((o) => o.q && o.a).filter((o, i, arr) => arr.findIndex((x) => x.q === o.q) === i).slice(0, 5);
  for (const o of rules.objections) if (c.objections.length < 3 && !c.objections.some((x) => x.q === o.q)) c.objections.push(o);
  c.trust = { items: uniq((Array.isArray(src.trust?.items) ? src.trust.items : []).map((t, i) => txt(t, `trust.items[${i}]`, 40, "")).filter(Boolean)).slice(0, 4) };
  if (!c.trust.items.length) c.trust = rules.trust;
  // editorial 칸: 영문은 대문자 A-Z 만, 한글 칸은 같은 정화, 숫자는 입력 근거만. 비거나 부족하면 규칙
  const EN = (t, n) => S(t).toUpperCase().replace(/[^A-Z\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  const BAD_EN = /\bBEST\b|NO\s*1|\bTOP\b|\bNUMBER ONE\b|\bCHEAP/;
  const te = (Array.isArray(src.hero_en?.title_en) ? src.hero_en.title_en : []).map((t) => EN(t, 12)).filter((t) => t && !BAD_EN.test(t)).slice(0, 3);
  const script = S(src.hero_en?.script).replace(/[^A-Za-z]/g, "").slice(0, 14);
  c.hero_en = { title_en: te.length ? te : rules.hero_en.title_en, script: script ? script[0].toUpperCase() + script.slice(1).toLowerCase() : rules.hero_en.script };
  const EN_SUB = (t) => S(t).toUpperCase().replace(/[^A-Z0-9°\s.-]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
  const subFor = (k) => { const hit = EN_FEATURE.find(([re]) => re.test(k.ko)) || EN_FEATURE.find(([, en]) => en === k.en); return hit ? hit[2] : ""; };
  c.keywords = (Array.isArray(src.keywords) ? src.keywords : []).map((k, i) => ({ en: EN(k?.en, 12), en_sub: EN_SUB(k?.en_sub), ko: txt(k?.ko, `keywords[${i}].ko`, 8, "", true) }))
    .map((k, i) => { if (enSubOk(k.en_sub, allowed)) return k; const sub = subFor(k); fixes.push(`keywords[${i}].en_sub: 어색한 영문(${k.en_sub || "빈 값"}) → ${sub || "제거"}`); return sub ? { ...k, en_sub: sub } : null; })
    .filter((k) => k && k.en && k.ko && !BAD_EN.test(`${k.en} ${k.en_sub}`)).slice(0, 5);
  for (const k of rules.keywords) if (c.keywords.length < 4 && !c.keywords.some((x) => x.en === k.en)) c.keywords.push(k);
  c.for_you = uniq((Array.isArray(src.for_you) ? src.for_you : []).map((t, i) => txt(t, `for_you[${i}]`, 24, "", true)).filter(Boolean)).slice(0, 4);
  for (const t of rules.for_you) if (c.for_you.length < 4 && !c.for_you.includes(t)) c.for_you.push(t);
  c.points = (Array.isArray(src.points) ? src.points : []).map((pt, i) => { const title = txt(pt?.title, `points[${i}].title`, 14, "", true); const raw = txt(pt?.label, `points[${i}].label`, 8, "", true); return { label: raw && !/^point\s*\d*$/i.test(raw) && /[가-힣]/.test(raw) ? raw : pointLabel(title, c.keywords?.[i]?.ko), title, desc: txt(pt?.desc, `points[${i}].desc`, 40, "") }; }).filter((pt) => pt.title).slice(0, 6);
  if (!c.points.length) c.points = rules.points;
  c.callouts = uniq((Array.isArray(src.callouts) ? src.callouts : []).map((x, i) => txt(x?.label, `callouts[${i}].label`, 10, "", true)).filter(Boolean)).map((label) => ({ label })).slice(0, 5);
  if (c.callouts.length < 3) c.callouts = rules.callouts;
  // 옵션 표: 속성표(规格·尺寸)나 SKU 옵션 이름에 있는 치수만 — OCR 이미지 치수 라벨을 조합한 행은 버린다
  const optNums = new Set(); for (const t of [...(input.attrs || []).flatMap((a) => [a.v_zh, a.v_ko]), ...(input.options || []).flatMap((o) => [o.label_zh, o.label_ko])]) for (const m of S(t).match(NUM) || []) optNums.add(norm(m));
  c.options_table = (Array.isArray(src.options_table) ? src.options_table : []).map((r, i) => { const name = txt(r?.name, `options_table[${i}].name`, 16, "", true), size = S(r?.size).slice(0, 30); const nums = size.match(NUM) || []; if (!nums.length || nums.some((n) => !optNums.has(norm(n)))) { fixes.push(`options_table[${i}]: 속성표·옵션명에 없는 치수(${size || "없음"}) → 제거`); return null; } return { name, size }; }).filter(Boolean).slice(0, 8);
  if (!c.options_table.length) c.options_table = rules.options_table; // 규칙도 속성표·옵션명만 쓴다(없으면 빈 배열 → 사이즈 문장만)
  // 기획서의 주의할 표현(v3 caution) — 긴 글 칸 전체에 적용
  if (isBriefV3(briefIn) && (briefIn.caution || []).length) {
    const cr = cautionRules(briefIn);
    const fix = (t, path) => { const r = applyCaution(t, cr, input); if (r.hits) fixes.push(`${path}: 주의할 표현 ${r.hits}건 반영`); return r.hits ? r.text : t; }; // 다 지워지면 빈 값(아래에서 빈 항목 제거)
    c.agitate = fix(c.agitate, "agitate") || rules.agitate; c.solution.text = fix(c.solution.text, "solution.text") || rules.solution.text;
    c.usp.items.forEach((it, i) => { it.desc = fix(it.desc, `usp.items[${i}].desc`); });
    c.captions.forEach((cp, i) => { cp.desc = applyCaution(cp.desc, cr, input).text; });
    c.faq.forEach((f, i) => { f.a = fix(f.a, `faq[${i}].a`); }); c.faq = c.faq.filter((f) => f.a); for (const f of rules.faq) if (c.faq.length < 3 && !c.faq.some((x) => x.q === f.q)) c.faq.push({ ...f }); c.notice = c.notice.map((n, i) => fix(n, `notice[${i}]`)).filter(Boolean);
    c.objections.forEach((o, i) => { o.a = fix(o.a, `objections[${i}].a`) || "상세 이미지와 스펙에서 확인하실 수 있어요. 궁금한 점은 문의 주세요."; }); c.trust.items = c.trust.items.map((t, i) => fix(t, `trust.items[${i}]`)).filter(Boolean);
    c.points.forEach((pt, i) => { pt.desc = fix(pt.desc, `points[${i}].desc`); });
    c.proof.forEach((p) => { if (cr.nums.has(`${p.value}${S(p.unit).toLowerCase()}`) && !/제조사/.test(p.label)) p.label = clip(`제조사 표시 기준 ${p.label}`, 20); });
    if (S(briefIn.product_name_ko) && !bannedIn(briefIn.product_name_ko).length) c.name_ko = clip(briefIn.product_name_ko, 40);
  }
  for (const k of Object.keys(c)) if (!(k in COPY_SCHEMA_V2.properties)) delete c[k];
  return { copy: c, fixes };
}

// ─────────────────────────────── 배포판: 서버 중계 ───────────────────────────────
// cn:ai(main.js)와 같은 body 형태로 DASHBOARD_URL/api/signal/ai 에 task:"detail" 을 보낸다.
// 서버(대시보드 web/src/app/api/signal/ai/route.js, 지시문·형식은 web/src/lib/signal-detail-copy.mjs = copy-prompt.js 사본)가
// { ok, result(Copy JSON), model, used, limit, usage } 를 돌려준다. 금지어·숫자 정화는 받은 뒤 여기서(sanitizeCopy) 한다.
// 하네스(node, electron 없음)에서도 돌도록: DASHBOARD_URL·SIGNAL_VENDOR_ID 환경변수가 있으면 그것을 쓰고, electron net 이 없으면 전역 fetch 를 쓴다.
async function viaServer(input) {
  try {
    const el = await import("electron").catch(() => null);
    const DASHBOARD_URL = process.env.DASHBOARD_URL || (await import("../auth-config.js")).DASHBOARD_URL;
    const vendorId = process.env.SIGNAL_VENDOR_ID || (el?.session ? await (await import("../auth.js")).wingVendorId() : null);
    if (!vendorId) return { error: "Wing에 로그인되어 있어야 AI 카피를 쓸 수 있습니다 (① Wing 탭)" };
    const doFetch = el?.net?.fetch ? el.net.fetch.bind(el.net) : globalThis.fetch;
    const r = await doFetch(`${DASHBOARD_URL}/api/signal/ai`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor_id: vendorId, task: "detail", input }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) return { error: j?.error || `서버 응답 ${r.status}` };
    if (!j.result || typeof j.result !== "object") return { error: "서버 응답에 카피가 없습니다" };
    return { ok: true, result: j.result, model: j.model || "server", costUsd: j.costUsd ?? null, usage: j.usage || null, used: j.used ?? null, limit: j.limit ?? null };
  } catch (e) { return { error: `서버 중계 실패: ${e?.message || e}` }; }
}
async function isPackaged() { try { const el = await import("electron"); return !!el?.app?.isPackaged; } catch { return false; } }

// ─────────────────────────────── 진입점 ───────────────────────────────
// useCli 를 주면 그대로(테스트·하네스), 안 주면 cn:ai 와 같은 분기: 개발 실행+CLI 있음 → cli / 배포판 또는 SIGNAL_AI=server → server / 그 밖 → rules
// v2: { brief } 를 주면(또는 v2:true) 기획안 기반 PAS→AIDMA 구조(COPY_SCHEMA_V2)로 쓴다
export async function writeCopy(input, { log = () => {}, model = process.env.SIGNAL_AI_MODEL || "sonnet", useCli, timeoutMs = 180000, brief = null, v2 = !!brief } = {}) {
  const t0 = Date.now();
  let how = "rules", ai = null, error;
  const SYS = v2 ? COPY_SYSTEM_V2 : COPY_SYSTEM, SCHEMA = v2 ? COPY_SCHEMA_V2 : COPY_SCHEMA, TEXT = v2 ? renderCopyInputV2(input, brief) : renderCopyInput(input);
  const rulesFn = v2 ? (i) => rulesCopyV2(i, brief) : rulesCopy, sanitizeFn = v2 ? (c, i) => sanitizeCopyV2(c, i, brief) : sanitizeCopy, validateFn = v2 ? (c) => validateCopy(c, COPY_SCHEMA_V2) : validateCopy;
  // useCli === true → CLI, false → 규칙만, 생략 → 자동(개발 실행+CLI 있음 → cli / 배포판·SIGNAL_AI=server → server / 그 밖 → rules)
  const auto = useCli == null;
  const wantServer = auto && (process.env.SIGNAL_AI === "server" || (await isPackaged()));
  const wantCli = useCli === true || (auto && !wantServer && cliAvailable());
  if (wantCli) {
    how = "cli";
    log("dim", `  ✍️ AI 카피 요청 (Claude CLI·${model}${v2 ? "·v2 기획안" : ""}) · 이미지 ${(input.images || []).length}장`);
    ai = await runStructured({ purpose: "copy-v2", system: SYS, schema: SCHEMA, text: TEXT, model, timeoutMs });
  } else if (wantServer) {
    how = "server";
    log("dim", "  ✍️ AI 카피 요청 (서버 중계)");
    ai = await viaServer(input);
  }
  const elapsedMs = Date.now() - t0;
  if (ai?.error) { error = ai.error; log("dim", `  ✍️ AI 카피 실패 → 규칙 기반으로 대체 · ${error}`); }
  if (ai?.ok) {
    const v = validateFn(ai.result);
    const lint = lintCopy(ai.result);
    const fatal = v.errors.filter((e) => /없음|이어야 하는데/.test(e) && !/^labels/.test(e) && !EDITORIAL_KEYS.some((k) => e.startsWith(k))); // editorial 칸 누락도 규칙으로 채움 // 칸이 빠지거나 형식이 다르면 심각(labels 누락은 규칙 번역으로 채움)
    if (fatal.length) error = `AI 결과 형식 오류: ${fatal.slice(0, 3).join("; ")}`;
    else if (lint.issues.filter((i) => i.kind === "banned").length > 8) error = `AI 결과 금지어 과다(${lint.issues.length}건)`;
    if (!error) {
      const { copy, fixes } = sanitizeFn(ai.result, input);
      const after = lintCopy(copy);
      if (!after.ok) error = `정화 후에도 금지어 남음: ${after.issues.map((i) => i.word).join(",")}`;
      else {
        if (fixes.length) log("dim", `  ✍️ AI 카피 정화 ${fixes.length}건 · ${fixes.slice(0, 3).join(" / ")}`);
        log("go", `■ AI 카피 완성 (${ai.model || how}) · ${(elapsedMs / 1000).toFixed(1)}초${ai.costUsd != null ? ` · $${Number(ai.costUsd).toFixed(3)}` : ""}`);
        return { copy, how, model: ai.model, costUsd: ai.costUsd ?? null, usage: ai.usage || null, elapsedMs, fixes, raw: ai.result };
      }
    }
    log("dim", `  ✍️ AI 카피 사용 불가 → 규칙 기반으로 대체 · ${error}`);
  }
  const copy = rulesFn(input);
  // how 는 실제로 쓴 경로(rules). 어떤 AI 경로를 시도했다가 내려왔는지는 tried 에, 사유는 error 에 남긴다
  return { copy, how: "rules", tried: ai ? how : null, error, model: ai?.model, costUsd: ai?.costUsd ?? null, elapsedMs, fixes: [] };
}

// ─────────────────────────────── v5: 섹션 카드 카피 ───────────────────────────────
import { COPY_V5_SYSTEM, COPY_V5_SCHEMA, V5_LIMITS, renderCopyInputV5 } from "./copy-prompt.js";
// 2줄 필드: "1줄\n2줄" 로 맞춘다(한 줄이면 띄어쓰기 기준으로 반 나눔), 줄마다 상한
export function twoLines(text, perLine) {
  let lines = String(text || "").split(/\n/).map(S).filter(Boolean);
  if (lines.length === 2 && (lines[0].length <= 2 || lines[1].length <= 2)) lines = [lines.join(" ")]; // "폭 / 조절 37~57.5cm" 같은 어색한 줄바꿈은 다시 나눈다
  if (lines.length === 1 && lines[0].length > perLine) { const w = lines[0].split(" "); let a = ""; while (w.length && (a + " " + w[0]).trim().length <= perLine) a = (a + " " + w.shift()).trim(); lines = [a, w.join(" ")].filter(Boolean); }
  return lines.slice(0, 2).map((l) => clip(l, perLine)).join("\n");
}
// 장점 문장 → 짧은 키워드(특징 사전 → 조사·동사형을 뺀 명사 2개 이내)
const PARTICLE = /(이나|나|을|를|이|가|은|는|으로|로|에서|에|의|과|와|도|만|까지)$/;
const VERBISH = /(는|은|며|고|게|여|겨|해|함|음|다|요|된|한|할|러|서|지|니|면|듯|있음|없이)$/;
export function kwOfSentence(a) {
  const hit = FEATURES.find((f) => f.re.test(a)); if (hit) return hit.badge;
  const toks = S(a).replace(/[(),.·]/g, " ").split(/\s+/).filter((t) => !/(하는|되는|있는|없는|하고|하며|해서|하게|당겨|꺼내|사용하)/.test(t)).map((t) => t.replace(PARTICLE, "")).filter((t) => /^[가-힣a-zA-Z0-9]{2,8}$/.test(t) && !VERBISH.test(t) && !/^(별도|바로|다양한|여러|상단|하단|두|가지|등|위|아래|사용|가능|구조|공간)$/.test(t));
  for (let i = 0; i + 1 < toks.length; i++) if ((toks[i] + " " + toks[i + 1]).length <= 8) return `${toks[i]} ${toks[i + 1]}`;
  return toks[0] || clip(a, 8);
}
// 내부 작업 지시·메모 말투(고객에게 보이면 안 됨)
export const INTERNAL_TONE = /표기하지|노출하지|표현하지|사용하지\s*않|기재하지|표기\s*(할\s*것|해야)|로만\s*표기|확인\s*(후|필요|해야)|임의로|단정하지|금지$|않음$|필요$|의미하지\s*않음|해야\s*합니다$|하지\s*않습니다$|피하고|대표\s*사진\s*색/;
// 기획서 주의할 표현(내부 메모) → 고객 안내문으로 바꿀 수 있는 것만
export function customerNotice(caution = []) {
  const out = [];
  const t = (caution || []).map(S).join(" ");
  if (/소품|구성품/.test(t)) out.push("사진 속 소품은 구성품에 포함되지 않습니다.");
  if (/하중|kg/.test(t)) out.push("표시 하중은 제조사 표시 기준이며 사용 환경에 따라 달라질 수 있습니다.");
  if (/치수|수작업|측정|오차/.test(t)) out.push("치수는 측정 방법에 따라 약간의 오차가 있을 수 있습니다.");
  if (/방수|녹|방청|코팅/.test(t)) out.push("코팅 처리로 물기에 강하지만 완전 방수는 아닙니다.");
  if (/색상|색감/.test(t)) out.push("모니터 설정에 따라 실제 색상과 다르게 보일 수 있습니다.");
  return out;
}
// title_lines([줄1, 줄2]) → "줄1\n줄2"(줄당 상한), 문자열이면 twoLines
export function linesOf(v, per) { if (Array.isArray(v)) { const a = v.map(S).filter(Boolean).slice(0, 2).map((l) => clip(l, per)); return a.join("\n"); } return twoLines(v, per); }
// 기본 강조: 둘째 줄 전체(line), 첫 줄에 숫자 구절이 있으면 그 구절(color)
export function defaultLineEmph(title) { const ls = String(title || "").split("\n").map(S).filter(Boolean); const num = String(title || "").replace(/\n/g, " ").match(/\d+(?:[.~\-]\d+)*(?:\.\d+)?\s*(?:cm|mm|kg|g|L|ml|°|도|단|층)/i); if (num && !(ls[1] || "").includes(num[0].trim())) return [{ text: num[0].trim(), kind: "color" }]; return ls.length === 2 ? [{ text: ls[1], kind: "line" }] : num ? [{ text: num[0].trim(), kind: "color" }] : []; }
// ── 소제목 징검다리 점검(AI 호출 없음): 큰 제목만 순서대로 읽을 때 앞 제목의 낱말을 받아 시작하는지 ──
// 대상: problem.question → before_after → feature×3 → detail → versatility (checkpoint·options·notice 는 안내 라벨이라 제외)
export const CHAIN_TYPES = ["problem", "before_after", "feature", "detail", "versatility"];
export function chainTitles(copy = {}, sections = []) {
  const secs = sections.length ? sections.filter((s) => CHAIN_TYPES.includes(s.type)) : ["problem", "before_after", "feature", "feature", "feature", "detail", "versatility"].map((type) => ({ type }));
  let fi = 0;
  return secs.map((s) => { const k = s.type === "feature" ? `feature${++fi}` : s.type; const t = s.type === "problem" ? copy.problem?.question : s.type === "feature" ? copy.features?.[fi - 1]?.title : copy[s.type]?.title; return { key: k, title: String(t || "").trim() }; }).filter((x) => x.title);
}
export const chainLine = (items = []) => items.map((x) => S(String(x.title ?? x).replace(/\n/g, " "))).join(" → ");
const CHAIN_STOP = /^(하는|있는|없는|되는|바로|정말|이제|그냥|더욱|모두|함께|한번|그대로|이렇게|어디|어디든|언제|매일|지금|한결|훨씬|이런|그런|우리|나만|모든|가장|더는)$/;
const CHAIN_STOP1 = /^[더딱쏙꼭잘또다한두세이그저및수것등때안위속곳데걸건좀늘참왜뭐]$/;
const chainToks = (t) => String(t || "").replace(/\n/g, " ").split(/[^가-힣A-Za-z0-9.~%°]+/).map((w) => w.replace(/[.~]+$/, "")).filter(Boolean).map((w) => { const b = /[가-힣]{2,}$/.test(w) ? w.replace(PARTICLE, "") : w; return b.length >= 2 ? b : w; }).filter(Boolean);
// 앞 제목에서 받을 수 있는 말: 낱말(조사 뗌) + 3자 이상 낱말의 앞 2자(사과레몬맛→사과) + 4자 이상 합성어의 끝 2자(틈새공간→공간) + 숫자
export function chainStems(text) {
  const out = new Set();
  for (const w of chainToks(text)) {
    if (w.length >= 2 && !CHAIN_STOP.test(w)) out.add(w);
    if (/^[가-힣]{3,}/.test(w) && !CHAIN_STOP.test(w.slice(0, 2))) out.add(w.slice(0, 2));
    if (/^[가-힣]{4,}$/.test(w) && !VERBISH.test(w.slice(-2)) && !CHAIN_STOP.test(w.slice(-2))) out.add(w.slice(-2));
    const num = w.match(/\d+(?:[.~\-]\d+)*/); if (num && num[0].length >= 2) out.add(num[0]);
  }
  return [...out];
}
// 받는 말 자리: 2줄 제목은 첫 줄, 한 줄 제목은 앞쪽 절반 어절
export function chainHead(title) { const ls = String(title || "").split("\n").map(S).filter(Boolean); if (ls.length >= 2) return { head: ls[0], tail: ls.slice(1).join(" ") }; const w = (ls[0] || "").split(" "); const n = Math.ceil(w.length / 2); return { head: w.slice(0, n).join(" "), tail: w.slice(n).join(" ") }; }
// → { word, where: "head"(받는 말 자리) | "tail"(뒤쪽에서만 이어짐) } 또는 null
export function chainLink(prev, cur) {
  const stems = chainStems(prev).sort((a, b) => b.length - a.length), { head, tail } = chainHead(cur);
  const ends = new Set(chainToks(prev).filter((w) => /^[가-힣]{2,}$/.test(w)).flatMap((w) => [w[0], w.slice(-1)])); // 사과레몬맛 → "맛", 폭조절 → "폭"
  const one = (part) => stems.find((s) => part.includes(s)) || chainToks(part).find((w) => w.length === 1 && /[가-힣]/.test(w) && !CHAIN_STOP1.test(w) && ends.has(w)); // 한 글자 명사(앞 낱말의 첫·끝 글자)
  const h = one(head); if (h) return { word: h, where: "head" };
  const t = tail && one(tail); return t ? { word: t, where: "tail" } : null;
}
// 점수: 받는 말 자리에서 이어지면 1, 뒤쪽에서만 이어지면 0.5, 끊기면 0 — 평균(0~1). 자동 고쳐 쓰기 없음(QA 표시용)
export function chainScore(items = []) {
  const ts = items.map((x, i) => (typeof x === "string" ? { key: String(i + 1), title: x } : x)).filter((x) => S(x.title));
  const pairs = [];
  for (let i = 1; i < ts.length; i++) { const l = chainLink(ts[i - 1].title, ts[i].title); pairs.push({ from: ts[i - 1].key, to: ts[i].key, word: l?.word || "", where: l?.where || "break" }); }
  const sum = pairs.reduce((n, p) => n + (p.where === "head" ? 1 : p.where === "tail" ? 0.5 : 0), 0);
  const score = pairs.length ? Math.round((sum / pairs.length) * 100) / 100 : 1;
  return { score, linked: pairs.filter((p) => p.where === "head").length, loose: pairs.filter((p) => p.where === "tail").length, pairs: pairs.length, breaks: pairs.filter((p) => p.where === "break").map((p) => `${p.from}→${p.to}`), links: pairs, line: chainLine(ts), weak: pairs.length > 0 && score < 0.5 };
}
// v5 규칙 카피(AI 없이) — 기획서(keyContent)·섹션 목록으로 채운다
export function rulesCopyV5(input = {}, brief = {}, sections = []) {
  const L = V5_LIMITS;
  const noun = productNoun({ keyword: input.keyword, coupangName: brief.product_name_ko, title_ko: input.title_ko });
  const adv = (brief.advantages || []).map(S);
  const feats = sections.filter((s) => s.type === "feature");
  const kws = adv.map(kwOfSentence);
  const short = (a) => S(a).replace(/[.。]$/, "");
  const out = {
    name_ko: clip(brief.product_name_ko || noun, 40),
    hero: { label: "NEW ITEM", category: clip(S(brief.product_type).split(/[·,]|\s겸\s/)[0], L.category), name: (() => { const w = nounTokens(brief.product_type || input.title_ko || ""); const two = w.slice(-2).join(" "); return clip(two.length <= L.name ? two : noun, L.name); })(), sub: clip(S(brief.key_appeal).split(/[.。]/)[0], L.sub),
      icons: [...new Set([...kws, "간편 사용", "깔끔한 정리", "튼튼한 구조", "실용 디자인"])].slice(0, 4).map((x) => ({ label: clip(x, L.label) })) },
    problem: { sub: clip(S(brief.key_appeal).split(/[.。]/)[0] ? "매일 쓰는 공간, 늘 아쉬웠죠" : "매일 쓰는 공간, 늘 아쉬웠죠", L.sub), question: "이걸 한 번에 해결할 순 없을까?" },
    before_after: { sub: "쓰기 전과 후, 이렇게 달라져요", title: twoLines(`어수선했던 공간이\n한결 정돈돼요`, L.titleLine) },
    checkpoint: { title: "CHECK POINT", callouts: adv.slice(0, 5).map((a, i) => ({ thin: clip(short(a).split(/[,]/)[0], L.calloutThin), bold: clip(kws[i] || "", L.calloutBold) })).filter((c) => c.bold).slice(0, 5) },
    features: [0, 1, 2].map((i) => ({ title: twoLines(short(adv[i] || "매일 쓰기 편하게").replace(/(으로|로)\s/, "$1\n"), L.titleLine), desc: twoLines(short(adv[i] || "사용 장면을 사진으로 확인해 보세요"), L.descLine) })),
    options: { title: twoLines("공간에 맞춰\n골라 쓰세요", L.titleLine) },
    detail: { title: "디테일", items: [{ title: "소재 마감", desc: twoLines((brief.specs || []).find((s) => /소재|재질|표면/.test(s.k))?.v || "꼼꼼한 마감", L.descLine) }, { title: "부품 디테일", desc: twoLines("손이 닿는 곳까지\n매끄럽게 다듬었어요", L.descLine) }] },
    versatility: { title: twoLines("어디에 두어도\n잘 어울려요", L.titleLine), sub: "공간에 맞게 활용해 보세요", items: (sections.find((s) => s.type === "versatility")?.copy.items || []).slice(0, 4).map((x) => ({ label: clip(x.label, L.placeLabel) })) },
    notice: { title: "구매 전 확인해 주세요", items: uniq([...customerNotice(brief.caution), ...NOTICE_DEFAULT]).slice(0, 5) },
    faq: [{ ...NEUTRAL_FAQ.shipping }, { ...NEUTRAL_FAQ.return }, { q: "설치가 필요한가요?", a: "상세 이미지의 사용 방법을 확인해 주세요. 궁금한 점은 문의 주세요." }],
  };
  out.hero.name_emph = []; out.before_after.emph = defaultLineEmph(out.before_after.title); out.before_after.title_lines = out.before_after.title.split("\n");
  out.features.forEach((f) => { f.emph = defaultLineEmph(f.title); f.title_lines = f.title.split("\n"); });
  out.versatility.items = out.versatility.items.map((x) => ({ ...x, desc: x.desc || clip(`${x.label}에서도 깔끔하게`, 18) }));
  while (out.versatility.items.length < 4) out.versatility.items.push({ label: ["거실", "주방", "사무실", "원룸"][out.versatility.items.length], desc: "어디든 깔끔하게" });
  out.versatility.items = out.versatility.items.map((x) => ({ ...x, desc: x.desc || clip(`${x.label}에서도 깔끔하게`, 18) }));
  while (out.checkpoint.callouts.length < 3) out.checkpoint.callouts.push({ thin: "꼼꼼한 마감", bold: ["튼튼한 구조", "간편 사용", "깔끔한 정리"][out.checkpoint.callouts.length] });
  out.chain_check = chainLine(chainTitles(out, sections));
  return out;
}
// v5 정화: 필드별 글자 수, 금지어·정책 약속·도매 문구·근거 없는 수치·주의할 표현·브랜드
export function sanitizeCopyV5(copy = {}, input = {}, brief = {}, sections = []) {
  const L = V5_LIMITS, rules = rulesCopyV5(input, brief, sections), fixes = [];
  const allowed = new Set([...inputNumbers(input), ...((brief.specs || []).flatMap((s) => (S(s.v).match(NUM) || []).map(norm)))]);
  const cr = (brief.caution || []).length ? cautionRules(brief) : null;
  const brands = brandValues(input);
  const clean = (v, path, fb, n, two = false) => {
    let t = String(v ?? "").split("\n").map(S).join("\n").trim();
    if (!t) return fb;
    const flat = t.replace(/\n/g, " ");
    if (bannedIn(flat).length) { fixes.push(`${path}: 금지어 → 규칙`); return fb; }
    if (policyKind(flat) || scrubWholesale(flat).hits) { fixes.push(`${path}: 약속·도매 문구 → 규칙`); return fb; }
    const nums = flat.match(NUM_UNIT) || []; if (nums.some((m) => (m.match(NUM) || []).some((x) => !allowed.has(norm(x))))) { fixes.push(`${path}: 원문에 없는 수치(${nums.join(",")}) → 규칙`); return fb; }
    // 예전 정화가 하중이 아닌 수치(폭·치수)에 붙인 "제조사 표시 기준" 접두는 뗀다
    if (/^제조사\s*표시\s*기준\s+/.test(t) && !/(kg|㎏|하중|무게|용량|L\b)/i.test(t)) { t = t.replace(/^제조사\s*표시\s*기준\s+/, "").replace(/\n/g, " "); fixes.push(`${path}: 하중 아닌 수치의 '제조사 표시 기준' 접두 제거`); }
    if (cr) { const r = applyCaution(t.replace(/\n/g, " "), cr, input); if (r.hits) { fixes.push(`${path}: 주의할 표현 반영`); if (!r.text) return fb; t = r.text; } const sf = softenClaims(t, cr); if (sf.hits) { fixes.push(`${path}: 성능 단정 완화`); t = sf.text; } }
    if (MEANINGLESS_RE.test(flat) || LOAD_TEST_RE.test(flat)) { fixes.push(`${path}: 무의미·체중 문장 → 규칙`); return fb; }
    t = stripBrand(t, brands);
    return two ? twoLines(t, n) : clip(t.replace(/\n/g, " "), n);
  };
  const c = copy || {};
  const out = {
    name_ko: clean(c.name_ko, "name_ko", rules.name_ko, 40),
    hero: { label: clean(c.hero?.label, "hero.label", rules.hero.label, L.label), category: clean(c.hero?.category, "hero.category", rules.hero.category, L.category), name: clean(c.hero?.name, "hero.name", rules.hero.name, L.name), sub: clean(c.hero?.sub, "hero.sub", rules.hero.sub, L.sub),
      icons: [0, 1, 2, 3].map((i) => ({ label: clean(c.hero?.icons?.[i]?.label, `hero.icons[${i}]`, rules.hero.icons[i].label, L.label) })) },
    problem: { question: (() => { const q = clean(c.problem?.question, "problem.question", rules.problem.question, 24); return /[?？]$/.test(q) ? q : `${q.replace(/[.!]$/, "")}?`; })(), sub: clean(c.problem?.sub, "problem.sub", rules.problem.sub, L.sub) },
    before_after: { sub: clean(c.before_after?.sub, "before_after.sub", rules.before_after.sub, L.sub), title: clean(linesOf(c.before_after?.title_lines || c.before_after?.title, L.titleLine), "before_after.title", rules.before_after.title, L.titleLine, true) },
    checkpoint: { title: clean(c.checkpoint?.title, "checkpoint.title", rules.checkpoint.title, L.titleLine), callouts: (Array.isArray(c.checkpoint?.callouts) ? c.checkpoint.callouts : []).map((x, i) => ({ thin: clean(x?.thin, `checkpoint.callouts[${i}].thin`, "", L.calloutThin), bold: clean(x?.bold, `checkpoint.callouts[${i}].bold`, "", L.calloutBold) })).filter((x) => x.bold).slice(0, 5) },
    features: [0, 1, 2].map((i) => ({ title: clean(linesOf(c.features?.[i]?.title_lines || c.features?.[i]?.title, L.titleLine), `features[${i}].title`, rules.features[i].title, L.titleLine, true), desc: clean(c.features?.[i]?.desc, `features[${i}].desc`, rules.features[i].desc, L.descLine, true) })),
    options: { title: clean(c.options?.title, "options.title", rules.options.title, L.titleLine, true) },
    detail: { title: clean(c.detail?.title, "detail.title", rules.detail.title, L.titleLine), items: [0, 1].map((i) => ({ title: clean(c.detail?.items?.[i]?.title, `detail.items[${i}].title`, rules.detail.items[i].title, L.titleLine), desc: clean(c.detail?.items?.[i]?.desc, `detail.items[${i}].desc`, rules.detail.items[i].desc, L.descLine, true) })) },
    versatility: { title: clean(c.versatility?.title, "versatility.title", rules.versatility.title, L.titleLine, true), sub: clean(c.versatility?.sub, "versatility.sub", rules.versatility.sub, L.sub), items: [0, 1, 2, 3].map((i) => ({ label: clean(c.versatility?.items?.[i]?.label, `versatility.items[${i}]`, rules.versatility.items[i].label, L.placeLabel), desc: clean(c.versatility?.items?.[i]?.desc, `versatility.items[${i}].desc`, rules.versatility.items[i].desc || "", 18) })) },
    notice: { title: clean(c.notice?.title, "notice.title", rules.notice.title, L.titleLine), items: uniq((Array.isArray(c.notice?.items) ? c.notice.items : []).map((x, i) => { const p = scrubPolicy(S(x)); const t = clip(p.hits.length ? p.text : S(x), 60); if (INTERNAL_TONE.test(t)) { fixes.push(`notice.items[${i}]: 내부 메모 말투 → 제거`); return ""; } return t; }).filter((x) => x && !bannedIn(x).length)).slice(0, 5) },
    faq: (Array.isArray(c.faq) ? c.faq : []).map((f, i) => ({ q: clean(f?.q, `faq[${i}].q`, "", 26), a: clean(f?.a, `faq[${i}].a`, "", 60) })).filter((f) => f.q && f.a).slice(0, 4),
  };
  if (out.checkpoint.callouts.length < 3) out.checkpoint.callouts = rules.checkpoint.callouts;
  // 강조: AI 가 준 것(글 안에 그대로 있는 것만) → 없으면 규칙 자동 강조
  out.hero.name_emph = cleanEmph(c.hero?.name_emph, out.hero.name);
  // v8 강조: 제목 안에서만, 둘째 줄 전체(line) 또는 숫자 구절(color) 1개 — 없으면 기본(둘째 줄)
  out.before_after.emph = cleanEmph(c.before_after?.emph, out.before_after.title); if (!out.before_after.emph.length) out.before_after.emph = defaultLineEmph(out.before_after.title);
  out.features.forEach((f, i) => { f.emph = cleanEmph(c.features?.[i]?.emph, f.title); if (!f.emph.length) f.emph = defaultLineEmph(f.title); f.title_lines = f.title.split("\n"); });
  out.before_after.title_lines = out.before_after.title.split("\n");
  for (const n of rules.notice.items) if (out.notice.items.length < 3 && !out.notice.items.includes(n)) out.notice.items.push(n);
  // 활용 장소: 상품에 어울리지 않는 장소는 기획서 기반 후보로 교체
  const cand = placesFrom(brief, 8).filter((p) => !out.versatility.items.some((x) => x.label === p));
  out.versatility.items = out.versatility.items.map((x, i) => { if (placeFits(x.label, brief)) return x; const rep = cand.shift(); fixes.push(`versatility.items[${i}]: 상품에 안 맞는 장소(${x.label}) → ${rep || "제거"}`); return rep ? { label: clip(rep, L.placeLabel) } : null; }).filter(Boolean);
  for (const p of cand) if (out.versatility.items.length < 4) out.versatility.items.push({ label: clip(p, L.placeLabel) });
  // 규격 이름 통일(섹션 표 이름 기준: 짧은형→낮은형, 하이형→높은형)
  const sizeNames = (sections.find((x) => x.type === "options")?.copy?.rows || []).map((r) => r.name);
  if (sizeNames.length) { const fixName = (t) => String(t).replace(/(짧은|로우|하이)\s?형/g, (w) => { const n = normalizeSizeName(w.replace(/\s/g, "").replace(/형$/, " 스타일")); return sizeNames.includes(n) ? n : w; }); const walk = (o) => { for (const k of Object.keys(o)) { if (typeof o[k] === "string") o[k] = fixName(o[k]); else if (o[k] && typeof o[k] === "object") walk(o[k]); } }; walk(out); }
  if (out.faq.length < 3) out.faq = rules.faq;
  out.chain_check = chainLine(chainTitles(out, sections)); // 정화 뒤 실제 제목으로 다시 잇는다(AI 초안은 raw 에 남음)
  return { copy: out, fixes };
}
// 규칙 자동 강조: 숫자+단위 → color, 없으면 핵심 이점 낱말(특징 사전·키워드) → dot (AI 강조가 없을 때)
export function autoEmph(text, { kind } = {}) {
  const t = S(String(text || "").replace(/\n/g, " "));
  const num = t.match(/\d+(?:[.~\-]\d+)*(?:\.\d+)?\s*(?:cm|mm|kg|g|L|ml|°|도|단|층|개|가지)/i);
  if (num) return [{ text: num[0].trim(), kind: kind || "color" }];
  const hit = FEATURES.find((f) => f.re.test(t)); const cand = [hit?.badge, ...String(text || "").split(/[\n,·]/).map((x) => kwOfSentence(x))].filter(Boolean);
  for (const c of cand) { const w = S(c).split(/\s+/).find((x) => x.length >= 2 && t.includes(x)); if (w) return [{ text: w, kind: kind || "dot" }]; }
  return [];
}
// 섹션 id 에 글을 붙인다(buildPlanV5 가 읽는 모양)
export function attachV5(copy = {}, sections = []) {
  const map = {}; let fi = 0;
  for (const s of sections) {
    if (s.type === "hero") map[s.id] = { ...copy.hero };
    else if (s.type === "before_after") map[s.id] = { ...copy.before_after };
    else if (s.type === "problem") map[s.id] = { ...(copy.problem || {}) };
    else if (s.type === "checkpoint") map[s.id] = { title: copy.checkpoint?.title, callouts: (copy.checkpoint?.callouts || []).map((c) => ({ label: `${c.thin}\n${c.bold}`, thin: c.thin, bold: c.bold })) };
    else if (s.type === "feature") map[s.id] = { ...(copy.features?.[fi++] || {}) };
    else if (s.type === "options") { const names = (s.copy?.rows || []).map((r) => r.name); const title = String(copy.options?.title || "").replace(/[가-힣A-Za-z]{1,4}\s?형/g, (w) => { const n = normalizeSizeName(w.replace(/\s/g, "").replace(/형$/, " 스타일")); return names.includes(n) ? n : names.includes(w) ? w : (/^(짧은|로우|하이|높은|낮은)/.test(w) ? n : w); }); map[s.id] = { title, rows: s.copy?.rows || [] }; } // 제목의 규격 이름을 표 이름과 맞춤(짧은형→낮은형)
    else if (s.type === "detail") map[s.id] = { ...copy.detail };
    else if (s.type === "versatility") { map[s.id] = { ...copy.versatility }; const pl = (copy.versatility?.items || []).map((x) => x.label).filter(Boolean); if (s.shot && pl.length) { s.shot.places = pl; s.shot.needs = `활용 장소 4곳: ${pl.join(" / ")}`; } } // 카피가 고른 장소를 장면 레시피로 그대로 전달
    else if (s.type === "notice") map[s.id] = { ...copy.notice };
    else if (s.type === "faq") map[s.id] = { items: copy.faq || [] };
    else if (s.type === "spec") map[s.id] = { rows: s.copy?.rows || [] };
  }
  return { ...copy, sections: map };
}
// reference(선택): reference.json — 벤치마킹 가이드를 입력에 붙이고, 쓴 뒤 레퍼런스 OCR 글과 3-gram 겹침 검사(guardSimilarity) → 너무 비슷한 줄은 한 번 고쳐 쓰기(haiku) → 그래도 비슷하면 규칙 문구
export async function writeCopyV5(input, { brief = {}, sections = [], claims = null, reference = null, log = () => {}, model = process.env.SIGNAL_AI_MODEL || "sonnet", useCli, timeoutMs = 240000 } = {}) {
  const t0 = Date.now();
  const wantCli = useCli === true || (useCli == null && cliAvailable());
  const guide = reference ? referenceGuide(reference, sections) : "";
  let ai = null, error;
  if (wantCli) {
    log("dim", `  ✍️ 섹션 카드 카피 요청 (Claude CLI·${model}) · 섹션 ${sections.length}개${guide ? " · 벤치마킹 가이드" : ""}`);
    ai = await runStructured({ purpose: "copy-v5", system: COPY_V5_SYSTEM, schema: COPY_V5_SCHEMA, text: renderCopyInputV5(input, brief, sections, guide), model, timeoutMs });
    if (ai?.error) { error = ai.error; log("dim", `  ✍️ v5 카피 실패 → 규칙 · ${error}`); }
  }
  let { copy, fixes } = ai?.ok ? sanitizeCopyV5(ai.result, input, brief, sections) : { copy: rulesCopyV5(input, brief, sections), fixes: [] };
  let similarity = null, rewriteCost = null;
  if (reference) { const g = await guardCopySimilarity(copy, reference, { input, brief, sections, log, useCli: wantCli && ai?.ok }); copy = g.copy; similarity = g.report; rewriteCost = g.costUsd; fixes = [...fixes, ...g.fixes]; }
  const chain = chainScore(chainTitles(copy, sections)); // 소제목 징검다리 점검(결과만 기록, 고쳐 쓰지 않음)
  if (chain.pairs) log("dim", `  🪨 소제목 징검다리 ${chain.score} (받는 말 ${chain.linked}/${chain.pairs}${chain.loose ? ` · 느슨 ${chain.loose}` : ""}${chain.breaks.length ? ` · 끊김 ${chain.breaks.join(", ")}` : ""})`);
  const elapsedMs = Date.now() - t0;
  const costUsd = ai?.costUsd != null || rewriteCost != null ? (Number(ai?.costUsd) || 0) + (Number(rewriteCost) || 0) : null;
  if (ai?.ok) log("go", `■ 섹션 카드 카피 완성 (${ai.model}) · ${(elapsedMs / 1000).toFixed(1)}초${costUsd != null ? ` · $${Number(costUsd).toFixed(3)}` : ""}`);
  return { copy: { ...attachV5(applyClaims(copy, claims), sections), chain, ...(similarity ? { similarity } : {}) }, how: ai?.ok ? "cli" : "rules", model: ai?.model, costUsd, usage: ai?.usage || null, elapsedMs, fixes, error, raw: ai?.result || null, chain, similarity };
}
// 표절 가드: 정화된 v5 카피(attach 전) → { copy, report{ checked, flagged[], rewritten, fallback, final[] }, fixes, costUsd }
export const SIM_REWRITE_SYSTEM = `당신은 쿠팡 상세페이지 카피 교정자입니다. 아래 문구들이 다른 회사 상세페이지(레퍼런스)의 문장과 너무 비슷합니다. 우리 상품 사실만으로, 같은 역할(제목·설명)과 비슷한 길이로 완전히 새로 씁니다.
규칙: 레퍼런스 문장의 낱말 순서·어구를 피하고 다른 표현을 씁니다. 숫자·재질·기능은 우리 상품 입력에 있는 것만. 줄바꿈(\n)이 있던 문구는 똑같이 2줄. 글자 수는 원래 문구 이하. 금지: 최저가·1위·최고·100%·완판·인증 번호. 응답은 JSON 만.`;
export const SIM_REWRITE_SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "text"], properties: { path: { type: "string" }, text: { type: "string" } } } } } };
// 고쳐 쓰기도 규칙 문구도 레퍼런스와 겹칠 때 쓰는 예비 문구(경로 → 후보)
export const SIM_SPARE = { "problem.question": ["매번 이렇게 불편해야 할까요?", "더 간단한 방법은 없을까요?", "이 공간, 더 잘 쓸 수 없을까요?"], "problem.sub": ["쓸 때마다 아쉬웠던 그 순간", "늘 같은 자리에서 생기는 불편"], "before_after.sub": ["바꾸기 전과 후를 비교해 보세요"] };
export async function guardCopySimilarity(copy, reference, { input = {}, brief = {}, sections = [], log = () => {}, useCli = true, model = "haiku" } = {}) {
  const refLines = reference.ocr_lines || [];
  const ours = [brief.product_name_ko, brief.product_type, brief.key_appeal, ...(brief.advantages || []), ...(brief.specs || []).map((x) => `${x.k} ${x.v}`), input.title_ko, input.keyword].map(S).join(" ");
  const first = guardSimilarity(copy, refLines, { ours });
  const report = { checked: first.checked, flagged: first.flagged.map(({ path, line, ref, score, containment, lcs }) => ({ path, line, ref, score, containment, lcs })), rewritten: 0, fallback: 0, final: [] };
  const fixes = []; let costUsd = null, out = copy;
  if (!first.flagged.length) { log("dim", `  🧷 표절 가드 통과 · ${first.checked}줄 검사 · 레퍼런스 ${refLines.length}줄`); return { copy, report, fixes, costUsd }; }
  log("dim", `  🧷 표절 가드: 레퍼런스와 비슷한 ${first.flagged.length}줄 → 고쳐 쓰기 · ${first.flagged.map((f) => `${f.path}≈"${f.ref}"`).slice(0, 4).join(" / ")}`);
  out = JSON.parse(JSON.stringify(copy));
  if (useCli) {
    const text = [`[우리 상품 사실] ${ours.slice(0, 900)}`, "", "[고칠 문구 — path 그대로 돌려주세요]", ...first.flagged.map((f) => `- path=${f.path} · 지금: ${JSON.stringify(f.text)} · 비슷한 레퍼런스 문장: ${JSON.stringify(f.ref)}`)].join("\n");
    const r = await runStructured({ purpose: "sim-rewrite", system: SIM_REWRITE_SYSTEM, schema: SIM_REWRITE_SCHEMA, text, model, timeoutMs: 120000 });
    if (r?.ok) { costUsd = r.costUsd ?? null; for (const it of r.result.items || []) if (first.flagged.some((f) => f.path === it.path) && S(it.text)) { setPath(out, it.path, String(it.text)); report.rewritten++; } }
    else log("dim", `  🧷 고쳐 쓰기 실패 → 규칙 문구 · ${r?.error || ""}`);
  }
  // 고친 글도 기존 정화(글자 수·금지어·근거 없는 수치) 다시 — title_lines 는 title 에서 다시 만든다
  for (const f of out.features || []) delete f.title_lines; if (out.before_after) delete out.before_after.title_lines;
  const again = sanitizeCopyV5(out, input, brief, sections); out = again.copy;
  const rules = rulesCopyV5(input, brief, sections);
  const second = guardSimilarity(out, refLines, { ours });
  for (const f of second.flagged) { // 규칙 문구 → (그것도 비슷하면) 예비 문구 → 비움(섹션 생략)
    const cands = [getPath(rules, f.path), ...(SIM_SPARE[f.path.replace(/\[\d+\]/g, "[]")] || [])].filter((x) => typeof x === "string" && x);
    const fb = cands.find((x) => !similarTo(x.replace(/\n/g, " "), refLines, { ours })) ?? "";
    setPath(out, f.path, fb); report.fallback++; fixes.push(`${f.path}: 레퍼런스와 비슷함(${f.score}) → ${fb ? "규칙·예비 문구" : "비움"}`);
  }
  if (second.flagged.length) { for (const f of out.features || []) f.title_lines = String(f.title || "").split("\n"); if (out.before_after) out.before_after.title_lines = String(out.before_after.title || "").split("\n"); }
  report.final = guardSimilarity(out, refLines, { ours }).flagged.map(({ path, line, ref, score }) => ({ path, line, ref, score }));
  fixes.push(...first.flagged.map((f) => `${f.path}: 레퍼런스와 비슷함(${f.score}, "${f.ref}") → 고쳐 씀`));
  log("dim", `  🧷 표절 가드 결과 · 고쳐 씀 ${report.rewritten} · 규칙 대체 ${report.fallback} · 남은 비슷한 줄 ${report.final.length}`);
  return { copy: out, report, fixes, costUsd };
}

// ─────────────────────────────── v6: 원본 한글화 — 이미지 레이어 번역(Claude 1회) ───────────────────────────────
import { LOCALIZE_SYSTEM, LOCALIZE_SCHEMA, renderLocalizeInput, EMPH_KINDS } from "./copy-prompt.js";
import { classifyLocalizeImage, fixLiteral, glossaryPrompt, heroNameFrom } from "./localize-core.js"; // v12: 넣지 말 이미지 판정 · 용어집 · 직역체 고치기 · 히어로 상품명
// 다시 써도 되는 자리인가: 단색·보간으로 지운 자리(solid·interp), 띠(pill) 위 글자 = true / 사진 위(complex·ai 로 지움)·도면 라벨 = false
export function rewriteOk(ly = {}) {
  if (typeof ly.rewrite_ok === "boolean") return ly.rewrite_ok;
  if (ly.style?.pill) return true;
  if (["complex", "ai"].includes(ly.how) || ly.erased === "ai") return false;
  if (ly.role === "label" && ly.how !== "solid") return false;
  return ["solid", "interp"].includes(ly.how) || ["title", "sub", "body", "note"].includes(ly.role);
}
// 강조: ko 안에 그대로 있는 글자만, 종류는 정해진 것만, 최대 2개
// v8 강조: 최대 1개, kind line(그 글의 한 줄 전체) | color(핵심 숫자 구절). 예전 종류(bold·dot…)는 line/color 로 바꾼다
export function cleanEmph(emph, ko) {
  const lines = String(ko || "").split("\n").map(S).filter(Boolean);
  return (Array.isArray(emph) ? emph : []).map((e) => { const text = S(e?.text); let kind = EMPH_KINDS.includes(e?.kind) ? e.kind : null; if (!kind) kind = lines.includes(text) && lines.length > 1 ? "line" : "color"; if (kind === "line" && !lines.includes(text)) kind = "color"; return { text, kind }; })
    .filter((e) => e.text && S(String(ko).replace(/\n/g, " ")).includes(e.text)).slice(0, 1);
}
export const PROMO_ZH = /证书|专利|认证|资质|质检|检测报告|工厂|厂房|车间|生产线|流水线|实力|合作(伙伴|客户|品牌)|客户案例|定制|OEM|ODM|来图|来样|代工|加工厂|欢迎(咨询|洽谈)|批发|一件代发/i;
const ROLE_FACTOR = { title: 1.3, label: 1.3, badge: 1.3, body: 1.6, price: 1.3, logo: 1 };
// 끝맺지 못한 구절 끝(잘린 흔적): 조사·어미 중간, "걱정"·"때"로 끝남
export const DANGLING_END = /(걱정|때|때도|때에|도|은|는|을|를|의|와|과|에|에서|으로|로|하는|있는|없는|되는|하고|하며|하여|할|될)$/;
// 아이콘 라벨(짧은 원문 ≤6자): 다시 쓰는 자리여도 명사형으로 원문 길이×1.5 이내(공백·가운뎃점 제외) — 넘치면 용어집·명사 추리기
export const ICON_GLOSSARY = { 碳钢烤漆: "탄소강 도장", 大容量抽屉: "대용량 서랍", 防尘防潮: "먼지·습기 관리", 承重能力强: "튼튼한 하중", 无需安装: "설치 불필요", 免安装: "설치 불필요", 多场景适用: "어디든 활용", 防滑: "미끄럼 방지", 抽拉: "슬라이드", 可叠加: "쌓아서 활용", 易清洁: "쉬운 세척", 大容量: "대용량", 加高护栏: "높은 가드레일", 圆润把手: "둥근 손잡이", 稳固: "튼튼한 구조", 耐用: "오래 쓰는" };
const bareLen = (t) => S(t).replace(/[\s·.,]/g, "").length;
// 아이콘 라벨: 짧은 원문(≤6자, 숫자 없음) + 같은 이미지에 짧은 레이어가 3개 이상인 묶음(ly.icon 표시, translateLayers·재정화가 계산) — 큰 제목은 제외
export const isIconLabel = (ly) => { const n = bareLen(ly.zh); return ly.icon === true || (ly.icon == null && false) ? n > 0 && n <= 6 && !/\d/.test(S(ly.zh)) : false; };
export function markIconLayers(layers = []) {
  const short = layers.filter((l) => { const n = bareLen(l.zh); return n > 0 && n <= 6 && !/\d/.test(S(l.zh)) && l.role !== "label"; });
  if (short.length < 3) return layers.map((l) => ({ ...l, icon: false }));
  const fs = short.map((l) => Number(l.style?.fontSizePx) || 0).filter(Boolean).sort((a, b) => a - b);
  const med = fs.length ? fs[Math.floor(fs.length / 2)] : 0;
  return layers.map((l) => ({ ...l, icon: short.includes(l) && (!med || !(Number(l.style?.fontSizePx) > med * 1.25)) }));
}
export function iconLabel(ly, ko) {
  const n = bareLen(ly.zh), lim = Math.max(4, Math.ceil(n * 1.5));
  if (bareLen(ko) <= lim) return ko;
  const g = ICON_GLOSSARY[S(ly.zh).replace(/\s/g, "")]; if (g) return g;
  // 명사형 추리기: 어미·조사 떼고 앞에서부터 상한까지
  const words = S(ko).replace(/(해요|돼요|에요|이에요|어요|아요|습니다|해|요)$/g, "").split(/\s+/).filter((w) => !/(하는|되는|있는|없는|하고|하며|해서|하게|으로|로)$/.test(w)).map((w) => w.replace(/(을|를|이|가|은|는|도|에|의)$/, ""));
  let out = ""; for (const w of words) { const nx = out ? `${out} ${w}` : w; if (bareLen(nx) > lim) break; out = nx; }
  return out || ko;
}
export function layerLimit(ly) { const n = S(ly.zh).length || 4; const f = ROLE_FACTOR[ly.role] || 1.5; const lim = Math.max(4, Math.ceil(n * f)); return ["label", "badge"].includes(ly.role) ? Math.min(lim, 8) : lim; }
// 한 레이어 정화: 금지어·약속·도매/브랜드 → 삭제(""), 길이 상한, 원문 숫자 보존(없으면 기계번역/원문 숫자로 보충)
export function sanitizeLayer(ly, ko, brands = [], cr = null) {
  const zh = S(ly.zh);
  let t = fixTranslation(zh, S(ko));
  let softened = false; { const sf = softenAll(t); t = sf.text; softened = sf.hits > 0; if (sf.awkward && /(?<![가-힣])(방수|방진|방습)|녹\s*방지/.test(t)) return { ko: "", drop: true, why: "단정 표현 완화 실패(어색)" }; } // 성능 단정 완화(녹 방지·방수층·방진방습 …) — 라벨(층 이름)도 같은 규칙
  if (cr) { const r = applyCaution(t, cr, {}); if (r.hits) t = r.text; }
  if (!t) return { ko: "", drop: true, why: "빈 번역" };
  if (ly.role === "price" || /[¥￥]|元|价格|特价|优惠|折/.test(zh)) return { ko: "", drop: true, why: "가격·할인" };
  if (bannedIn(t).length) return { ko: "", drop: true, why: `금지어(${bannedIn(t).join(",")})` };
  if (policyKind(t)) return { ko: "", drop: true, why: "판매 정책 약속" };
  if (isWholesale(t) || WHOLESALE_LINE.test(zh)) return { ko: "", drop: true, why: "도매·중국 셀러 문구" };
  if (ly.role === "logo" || brands.some((b) => b && (t.includes(b) || zh.includes(b)))) return { ko: "", drop: true, why: "로고·공급사 브랜드" };
  const zhNums = (zh.match(/\d+(?:\.\d+)?/g) || []);
  const missing = zhNums.filter((n) => !t.includes(n));
  if (missing.length && !/[百千]斤|\d+\s*斤/.test(zh)) { const mt = softenAll(fixTranslation(zh, S(ly.mt))).text; if (mt && missing.every((n) => mt.includes(n))) t = mt; else return { ko: t, drop: false, why: `원문 숫자 누락(${missing.join(",")})`, warn: true }; }
  // 이전에 잘려 저장된 문장(뒷구절이 "…걱정", "…때도", "…을" 처럼 끝맺지 못함) → 마지막 구절을 떼고 완결된 앞부분만
  { const m = t.match(/^(.*\S)\s*[,，]\s*([^,，]+)$/); if (m && DANGLING_END.test(m[2].trim()) && m[1].length >= 4) t = m[1].trim(); }
  if (isIconLabel(ly) && !/\d/.test(t)) { const il = iconLabel(ly, t); if (il !== t) t = il; } // 숫자 든 문구(斤 환산 등)는 줄이지 않는다 // 아이콘 라벨은 rewrite_ok 여도 짧은 명사형
  // 길이: 자르지 않는다(템플릿이 상자에 맞게 글자를 줄임). 상한×1.5 를 넘을 때만 규칙 요약 — 앞쪽 완결된 구절(쉼표·가운뎃점·| 기준)만 남김
  const lim = layerLimit(ly);
  if (!softened && ly.rewrite_ok !== true && t.length > lim * 1.5) { // 다시 쓰는 자리(rewrite_ok)는 길이 자유
    const parts = t.split(/\s*(?:[,，、|·]|\s-\s)\s*/).map(S).filter(Boolean);
    let out = "";
    for (const p of parts) { const next = out ? `${out}, ${p}` : p; if (next.length > lim * 1.5 && out) break; out = next; }
    const lost = (t.match(/\d+(?:\.\d+)?\s*[a-zA-Z°%]*/g) || []).some((n) => !out.includes(n.trim()));
    if (out && out.length < t.length && !lost) t = out;
  }
  return { ko: t, drop: false };
}
// images: [{ id, kind, w, h, layers:[{ id?, zh, role, w, mt? }] }] → { images:[{ id, promo, promo_reason, layers:[{ ...layer, ko, drop, why? }] }], hero, how, costUsd, elapsedMs, fixes }
// aiCache(폴더, 재생·회귀 하네스 전용): 같은 요청(system·text·model)이면 지난 AI 응답을 다시 씀 — 규칙만 고쳐 다시 돌릴 때 번역 비용 0. 앱은 쓰지 않는다
async function runStructuredCached(args, aiCache) {
  if (!aiCache) return runStructured(args);
  const [{ default: fs }, { default: path }, { createHash }] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
  const f = path.join(aiCache, createHash("sha1").update(JSON.stringify([args.system, args.text, args.model])).digest("hex") + ".json");
  try { return { ...JSON.parse(fs.readFileSync(f, "utf8")), costUsd: 0, cached: true }; } catch {}
  const r = await runStructured(args);
  if (r?.ok) { fs.mkdirSync(aiCache, { recursive: true }); fs.writeFileSync(f, JSON.stringify(r)); }
  return r;
}
export async function translateLayers({ images = [], brief = null, attrs = [], claims = null, log = () => {}, model = process.env.SIGNAL_AI_MODEL || "sonnet", useCli, timeoutMs = 420000, aiCache = null } = {}) { // v12: 묶음당 7분(47장·3묶음 실측 225~300초)
  const t0 = Date.now();
  const brands = brandValues({ attrs });
  const cr = (brief?.caution || []).length ? cautionRules(brief) : null;
  const wantCli = useCli === true || (useCli == null && cliAvailable());
  let ai = null, error;
  const list = images.filter((im) => (im.layers || []).length);
  if (wantCli && list.length) {
    // 장이 많으면(쿠팡형 40장+) 한 번에 보내면 5분 넘게 걸리고 시간 초과로 통째 기계번역이 될 수 있다 → 최대 3묶음으로 나눠 동시에(대표 사진이 든 첫 묶음이 hero 를 정한다)
    const chunks = []; { const tot = list.reduce((a, im) => a + im.layers.length, 0), per = Math.max(120, Math.ceil(tot / 3)); let cur = [], n = 0; for (const im of list) { if (cur.length && n + im.layers.length > per) { chunks.push(cur); cur = []; n = 0; } cur.push(im); n += im.layers.length; } if (cur.length) chunks.push(cur); } // 최대 3묶음 정도(묶음마다 고정 비용이 붙어 잘게 나누면 비싸다)
    log("dim", `  🈚 이미지 글 한글화 요청 (Claude CLI·${model}) · ${list.length}장 · 레이어 ${list.reduce((a, im) => a + im.layers.length, 0)}개${chunks.length > 1 ? ` · ${chunks.length}묶음 동시` : ""}`);
    const runCh = (ch, tm) => runStructuredCached({ purpose: "localize", system: LOCALIZE_SYSTEM, schema: LOCALIZE_SCHEMA, text: renderLocalizeInput(ch.map((im) => ({ ...im, layers: im.layers.map((ly) => ({ ...ly, rewrite_ok: rewriteOk(ly) })) })), brief) + glossaryPrompt(), model, timeoutMs: tm }, aiCache).catch((e) => ({ error: String(e?.message || e) }));
    const rs = await Promise.all(chunks.map((ch) => runCh(ch, timeoutMs)));
    // v12: 시간 초과·실패한 묶음은 반으로 나눠 한 번 더(시간 1.5배) — 기계번역 대체가 생기지 않게(2026-10-13 대파 분쇄기 47장: 4묶음 중 1묶음이 300초 초과)
    for (let k = 0; k < rs.length; k++) { if (rs[k]?.ok || chunks[k].length < 2) continue; const h = Math.ceil(chunks[k].length / 2); log("dim", `  🈚 한글화 묶음 ${k + 1} 실패(${String(rs[k]?.error || "").slice(0, 40)}) → 둘로 나눠 다시`); const [a, b] = await Promise.all([runCh(chunks[k].slice(0, h), timeoutMs * 1.5), runCh(chunks[k].slice(h), timeoutMs * 1.5)]); if (a?.ok || b?.ok) rs[k] = { ok: true, model: (a?.ok ? a : b).model, costUsd: (Number(a?.costUsd) || 0) + (Number(b?.costUsd) || 0), result: { images: [...(a?.ok ? a.result?.images || [] : []), ...(b?.ok ? b.result?.images || [] : [])], hero: (a?.ok ? a : b).result?.hero || {} } }; }
    const oks = rs.filter((r) => r?.ok);
    ai = oks.length ? { ok: true, model: oks[0].model, costUsd: oks.some((r) => r.costUsd != null) ? oks.reduce((a, r) => a + (Number(r.costUsd) || 0), 0) : null, result: { images: oks.flatMap((r) => r.result?.images || []), hero: (rs[0]?.ok ? rs[0] : oks[0]).result?.hero || {} } } : { error: rs.find((r) => r?.error)?.error || "응답 없음" };
    if (oks.length < rs.length) log("dim", `  🈚 한글화 ${rs.length - oks.length}/${rs.length}묶음 실패 → 그 장은 기계번역 · ${rs.find((r) => r?.error)?.error || ""}`);
    if (ai?.error) { error = ai.error; log("dim", `  🈚 한글화 실패 → 기계번역 · ${error}`); }
  }
  const byId = new Map((ai?.ok ? ai.result.images || [] : []).map((x) => [S(x.id), x]));
  const fixes = [];
  const out = images.map((im0) => {
    const im = { ...im0, layers: markIconLayers(im0.layers || []) };
    const r = byId.get(im.id);
    // 규칙 promo: 인증·공장 같은 제목이 있거나, 홍보 문구 레이어가 절반 이상(맞춤제작 한 줄만 있으면 그 레이어만 지운다)
    const ls = im.layers || [];
    const hitN = ls.filter((l) => PROMO_ZH.test(S(l.zh))).length;
    const promoRule = ls.some((l) => ["title", "badge"].includes(l.role) && /证书|专利|认证|资质|工厂|厂房|车间|生产线|流水线|合作(伙伴|客户|品牌)/.test(S(l.zh))) || (ls.length > 0 && hitN >= Math.max(1, Math.ceil(ls.length / 2)));
    const cls = classifyLocalizeImage(ls.map((l) => ({ zh: l.zh, role: l.role, h: l.textBox?.h || l.text_box?.h || l.h })), { imgH: im.h || 1000, kind: im.kind || "detail" }); // 글자 높이(OCR 상자, 지울 영역 아님) // v12: 구매 유도·가격 설명·판매 정책·후기 모음·중국어 사양표
    const promo = !!(r?.promo || promoRule || cls);
    const layers = (im.layers || []).map((ly, i) => {
      const aiL = (r?.layers || []).find((x) => x.idx === i);
      const aiKo = aiL?.ko;
      const rw = rewriteOk(ly);
      let s = sanitizeLayer({ ...ly, rewrite_ok: rw }, aiKo != null ? aiKo : ly.mt, brands, cr);
      if (aiL && aiL.natural === false && !s.drop) { const mt = /[가-힣]/.test(S(ly.mt)) ? sanitizeLayer(ly, ly.mt, brands, cr) : null; fixes.push(`${im.id}#${i} 어색 자가판정 → ${mt && !mt.drop ? "기계번역 기본 문구" : "그대로(대체 없음)"}`); if (mt && !mt.drop) s = mt; }
      if (!s.drop) { const fl = fixLiteral(ly.zh, s.ko, { mt: ly.mt }); if (fl.changed) { fixes.push(`${im.id}#${i} 직역 "${s.ko}" → ${fl.drop ? "삭제" : `"${fl.ko}"`}`); s = fl.drop ? { ko: "", drop: true, why: "직역(고칠 말 없음)" } : { ...s, ko: fl.ko }; } if (!s.drop && fl.literal) s = { ...s, literal: true }; } // v12 용어집·직역체
      if (s.drop || s.warn) fixes.push(`${im.id}#${i} ${S(ly.zh).slice(0, 12)}: ${s.why}`);
      const emph = s.drop ? [] : cleanEmph(aiL?.emph, s.ko);
      return { ...ly, rewrite_ok: rw, ko: s.ko, drop: s.drop, emph, ...(aiL && "natural" in aiL ? { natural: !!aiL.natural } : {}), ...(s.why ? { why: s.why } : {}), ...(aiKo != null ? { ko_ai: S(aiKo), emph_ai: aiL?.emph || [] } : {}) }; // ko_ai: AI 원문(재정화 때 이걸로 다시)
    });
    return { id: im.id, promo, promo_reason: promo ? (cls?.reason || S(r?.promo_reason) || (promoRule ? "인증·공장·맞춤제작 홍보 문구" : "")) : "", ...(cls ? { promo_kind: cls.kind } : {}), layers };
  });
  // v12 직역체 다시 쓰기: 고친 뒤에도 직역 흔적이 남은 줄만 모아 짧은 요청 1회(실패하면 그대로 — 아래 렌더 전 검사가 작은 줄은 뺀다)
  const lit = []; out.forEach((im) => im.layers.forEach((ly, i) => { if (ly.literal && !ly.drop) lit.push({ im, i, ly }); }));
  if (lit.length && wantCli) {
    try {
      const r2 = await runStructuredCached({ purpose: "localize-rewrite", system: "중국 상세 이미지 문구의 한국어 번역 중 직역체(기계번역 말투)만 한국 쇼핑몰에서 실제 쓰는 짧고 자연스러운 말로 고쳐 씁니다. 숫자·단위는 그대로, 원문보다 길게 쓰지 않습니다. JSON 만.", schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "ko"], properties: { n: { type: "integer" }, ko: { type: "string" } } } } } },
        text: lit.map((x, n) => `${n}. 원문 ${S(x.ly.zh)} → 지금 "${x.ly.ko}"`).join("\n") + glossaryPrompt(), model, timeoutMs: 120000 }, aiCache);
      for (const it of r2?.ok ? r2.result?.items || [] : []) { const x = lit[it.n]; if (!x || !S(it.ko)) continue; const sv = sanitizeLayer(x.ly, it.ko, brands, cr); if (!sv.drop) { fixes.push(`${x.im.id}#${x.i} 직역 다시 쓰기 "${x.ly.ko}" → "${sv.ko}"`); x.im.layers[x.i] = { ...x.ly, ko: sv.ko, literal: false, ko_literal: x.ly.ko }; } }
    } catch (e) { log("dim", `  🈚 직역 다시 쓰기 실패 (${String(e?.message || e).slice(0, 80)})`); }
  }
  const h = ai?.ok ? ai.result.hero || {} : {};
  const noun = productNoun({ coupangName: brief?.product_name_ko, title_ko: brief?.product_type || "" });
  const heroFix = (v, n, fb) => { const sf = softenAll(S(v)); const t = sf.text; return t && !sf.awkward && !bannedIn(t).length && !policyKind(t) ? clip(t, n) : fb; }; // 치환이 어색하면 기본 라벨
  const hero = { label: heroFix(h.label, 10, "NEW ITEM"), sub: heroFix(h.sub, 22, clip(S(brief?.key_appeal).split(/[.。]/)[0], 22)), name: heroFix(h.name, 14, heroNameFrom(brief?.product_name_ko) || clip(noun, 14)) };
  hero.name_emph = cleanEmph(h.name_emph, hero.name).slice(0, 1);
  { const cc = normalizeClaims(claims || {}); const top = cc.sold_out || cc.rank || cc.trust_badges[0]; if (top) { hero.label = clip(top, 12); hero.badges = cc.trust_badges; } } // 셀러 신뢰 값은 hero 머리글로
  const elapsedMs = Date.now() - t0;
  if (ai?.ok) log("go", `■ 이미지 글 한글화 완성 (${ai.model}) · ${(elapsedMs / 1000).toFixed(1)}초${ai.costUsd != null ? ` · $${Number(ai.costUsd).toFixed(3)}` : ""} · 제외 권고 ${out.filter((x) => x.promo).length}장`);
  return { images: out, hero, how: ai?.ok ? "cli" : "rules", model: ai?.model, costUsd: ai?.costUsd ?? null, elapsedMs, fixes, error };
}

// 저장된 한글화 결과(localize.json)를 AI 재호출 없이 현재 규칙으로 다시 정화(ko 를 AI 출력으로 보고)
export function resanitizeLocalized(localized = {}, { brief = null, attrs = [] } = {}) {
  const brands = brandValues({ attrs });
  const cr = (brief?.caution || []).length ? cautionRules(brief) : null;
  const fixes = [];
  const images = (localized.images || []).map((im) => ({ ...im, layers: markIconLayers(im.layers || []).map((ly, i) => {
    const base = S(ly.ko_ai) || S(ly.ko);
    if (ly.drop && !base) return ly;
    let s = sanitizeLayer({ ...ly, rewrite_ok: rewriteOk(ly) }, base || ly.mt, brands, cr);
    if (!s.drop) { const fl = fixLiteral(ly.zh, s.ko, { mt: ly.mt }); if (fl.changed) s = fl.drop ? { ko: "", drop: true, why: "직역(고칠 말 없음)" } : { ...s, ko: fl.ko }; } // v12 용어집·직역체
    if (s.ko !== S(ly.ko) || s.drop !== !!ly.drop) fixes.push(`${im.id}#${i} "${S(ly.ko)}" → ${s.drop ? `삭제(${s.why})` : `"${s.ko}"`}`);
    return { ...ly, ko: s.ko, drop: s.drop, emph: s.drop ? [] : cleanEmph(ly.emph_ai || ly.emph, s.ko), ...(s.why ? { why: s.why } : {}) };
  }) }));
  const heroFb = { label: clip(S(brief?.product_type).split(/[·,\s]/).filter(Boolean).slice(-2).join(" ") || "NEW ITEM", 8), sub: clip(S(brief?.key_appeal).split(/[.。]/)[0], 22), name: clip(S(brief?.product_name_ko), 12) };
  const hero = Object.fromEntries(Object.entries(localized.hero || {}).filter(([k]) => k !== "name_emph").map(([k, v]) => { const sf = softenAll(v); const bad = sf.awkward || AWKWARD_RE.test(sf.text) || /[가-힣](?:물기에 강한|먼지·습기)/.test(sf.text); if (bad) fixes.push(`hero.${k} "${S(v)}" → 기본 라벨`); return [k, bad ? heroFb[k] || S(v) : sf.text]; }));
  hero.name_emph = cleanEmph(localized.hero?.name_emph, hero.name || "").slice(0, 1);
  return { ...localized, images, hero, fixes };
}
