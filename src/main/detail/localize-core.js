// 원본 한글화 v12 순수 규칙(노드 단위테스트: test/detail/localize-core.test.js) — 2026-10-13 대표님 "총체적 난국"(대파 분쇄기 742640871856)
//  1) 넣지 말아야 할 이미지 판정: 구매 유도·쿠폰 / 가격 설명 / 판매 정책(반품·무료 체험·약속) / 구매자 후기 모음 / 중국어 사양표
//  2) 상세페이지 용어집(중→한 의역) + 직역체 검출·고치기 — AI 번역이 시간 초과로 기계번역이 돼도 이 규칙이 남는다
//  3) 히어로 제목: 상품명 수준(기획서 상품명에서 괄호·업소용 같은 머리말을 뺀 짧은 이름)

const S = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// ── 1) 이미지 판정 ──
// 이미지 안 글 줄들(zh)에 이 말이 나오면 그 종류. strong=한 줄만 있어도 이미지 전체 제외, 아니면 글 줄의 40% 이상일 때
export const IMAGE_KINDS = [
  { kind: "price", reason: "가격 설명(플랫폼 가격 안내문)", strong: /价格说明|被比较价格|划线价|吊牌价|专柜价|指导价|一口价|标价|结算页|价格管理规则/ },
  { kind: "buy", reason: "구매 유도·쿠폰(클릭·보조금·지금 구매)", strong: /点击|立即(购买|抢购|下单)|大额补贴|补贴|领券|优惠券|淘金币|红包|限时(抢|秒杀|特惠)|仅限.*(APP|手机端)|加购|收藏(店铺|宝贝)/i },
  { kind: "policy", reason: "판매 정책(반품·무료 체험·보증 약속)", strong: /无理由|退换|包退|包换|退货|免费试(用|机)|\d+\s*天.*试|敢承诺|放心购物|无后顾之忧|售后(无忧|保障)|质保\s*\d+|保修|假一赔|正品保障|顺丰包邮/ },
  { kind: "endorser", reason: "유명인·홍보대사 사진(초상권) — 기본 제외", one: true, strong: /代言人|形象大使|品牌大使|形象代言|明星同款|代言/ }, // v13.2 한 줄만 있어도(세로 "品牌形象代言人" — 슬라이서 d02)
  { kind: "notice", reason: "판매자 공지·안내문(작은 글 문단)", one: true, strong: /商家公告|店铺公告|温馨提示|购买须知|买家须知|注意事项|使用须知|购前必读|特别说明/ }, // v13.2 슬라이서 d03 "商家公告"
  { kind: "review", reason: "구매자·판매자 후기 사진 모음", strong: /真实反馈|买家秀|好评|晒单|客户(反馈|评价)|用户(反馈|评价)|商户.*反馈|回头客/ },
];
// 사양표: 사양 열쇠말이 3줄 이상이고 글 줄이 많으며(≥10) 작은 글(이미지 높이 3.5% 미만)이 대부분 — 표 위에 한글을 얹으면 뭉개진다 → 우리 사양 섹션으로 대체
export const SPEC_KEY_ZH = /参数|规格|产品名称|产品型号|型号|材质|尺寸|重量|净重|毛重|功率|电压|转速|工作时间|包装|容量|产地|颜色|产品优势|功能延伸/;
export function isSpecTable(layers = [], imgH = 1000) {
  const ls = layers.filter((l) => S(l.zh));
  if (ls.length < 10) return false;
  const keys = ls.filter((l) => SPEC_KEY_ZH.test(S(l.zh))).length;
  const small = ls.filter((l) => (Number(l.h) || 0) < imgH * 0.035).length;
  return keys >= 3 && small / ls.length >= 0.6;
}
// v13.2 작은 글이 빽빽한 문단(공지·설명서): 긴 줄(12자 이상)이 8줄 이상이고 그 70% 이상이 작은 글(이미지 높이 3% 미만)
export function isDenseText(layers = [], imgH = 1000) {
  const long = layers.filter((l) => Array.from(S(l.zh).replace(/\s/g, "")).length >= 12);
  return long.length >= 8 && long.filter((l) => (Number(l.h) || 0) < imgH * 0.03).length / long.length >= 0.7;
}
// layers: [{ zh, h, role }] → null | { kind, reason }
// kind: 대표 사진(gallery·main)은 제품 사진 귀퉁이에 무료 배송·체험 배지가 붙는 일이 흔해 판매 정책으로는 빼지 않는다(그 줄만 지운다)
export function classifyLocalizeImage(layers = [], { imgH = 1000, kind = "detail" } = {}) {
  const ls = layers.filter((l) => S(l.zh));
  if (!ls.length) return null;
  const all = ls.map((l) => S(l.zh)).join(" ");
  for (const k of IMAGE_KINDS) {
    if (k.kind === "policy" && /^(gallery|main)$/.test(kind)) continue;
    const hits = ls.filter((l) => k.strong.test(S(l.zh)));
    // 한 줄짜리 배지(대표 사진 귀퉁이 "顺丰包邮" 등)는 그 줄만 지우면 되므로 이미지는 남긴다 — 2줄 이상이거나 글의 40% 이상일 때만 이미지 제외(가격 설명은 1줄이어도)
    if (k.kind === "notice" && ls.length < 6) continue; // 공지는 글 줄이 많은 장만(상품 사진 귀퉁이 "注意事项" 한 줄로 빼지 않게)
    if (hits.length && (k.one || hits.length >= 2 || hits.length / ls.length >= 0.4 || (k.kind === "price" && k.strong.test(all)))) return { kind: k.kind, reason: k.reason };
  }
  if (isSpecTable(ls, imgH)) return { kind: "spec_table", reason: "중국어 사양표(작은 글 격자) — 사양 섹션으로 대체" };
  if (isDenseText(ls, imgH)) return { kind: "dense_text", reason: "작은 글이 빽빽한 안내문 — 줄여 옮기기 어려워 제외" };
  return null;
}

// v13 가격 붙은 상품 목록(판매자 다른 상품 홍보 — 힙업밴드 d01 "¥5.7 ¥15.8 …"): 가격 표기(¥·￥·元 + 숫자)가 3개 이상. 가격은 OCR 이 영문·숫자 상자로 읽어 위 한자 규칙에 안 걸린다
// texts: 그 이미지 OCR 글 전부(영문 상자 포함) → null | { kind:"price_list", reason }
export function priceListOf(texts = []) {
  const n = texts.map(S).reduce((a, t) => a + (t.match(/[¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*元/g) || []).length, 0);
  return n >= 3 ? { kind: "price_list", reason: `가격 붙은 상품 목록(가격 ${n}개 — 다른 상품 홍보)` } : null;
}

// ── 2) 용어집 · 직역체 ──
// 원문(zh)이 이 말이면 이 한국어로(상세페이지에서 실제 쓰는 말). 앞에서부터 긴 것 우선으로 맞춘다
export const GLOSSARY = [
  ["实拍效果拒绝PS", "보정 없는 실제 사진"], ["效果实拍", "실제 결과"], ["实拍", "실제 사진"],
  ["产品全家福", "구성품 한눈에"], ["全家福", "구성품 한눈에"], ["产品参数", "제품 사양"], ["参数", "제품 사양"],
  ["产品介绍", "제품 소개"], ["细节展示", "디테일"], ["适用场景", "이런 곳에 좋아요"], ["产品优势", "장점"],
  ["基础款", "기본형"], ["旗舰款", "플래그십형"], ["入门款", "입문형"], ["升级款", "업그레이드형"],
  ["后厨小帮手", "주방 도우미"], ["一键启动", "버튼 한 번으로 작동"], ["一键开关", "버튼 한 번 작동"],
  ["大葱", "대파"], ["葱花", "송송 썬 파"], ["葱沫", "다진 파"], ["葱末", "다진 파"], ["葱碎", "다진 파"],
  ["刀盘", "커터 날"], ["进料口", "투입구"], ["出料槽", "배출구"], ["刀组速拆", "날 빠른 분리"],
  ["高温烤漆", "고온 도장"], ["烤漆", "도장"], ["以实物为准", "실물 기준"], ["免安装", "설치 필요 없음"], // v13 처음 보는 상품(컵홀더·풀아웃)
];
// 상세페이지 직역체(기계번역 흔적) → 고치는 말. null = 고칠 말이 없어 그 줄을 뺀다(작은 본문일 때)
export const LITERAL_FIX = [
  [/(실제\s*)?샷\s*효과는\s*PS\s*를\s*거부합니다\.?/g, "보정 없는 실제 사진"],
  [/매개\s*변수/g, "제품 사양"], [/제품군\s*초상화|가족\s*초상화|초상화/g, "구성품 한눈에"],
  [/(상점|가게|집)의\s*진술이\s*우선합니다\.?|진술이\s*우선/g, null],
  [/실제\s*효과\s*샷/g, "실제 결과"], [/리얼\s*샷/g, "실제 사진"], [/파\s*거품|파폼/g, "다진 파"],
  [/모조\s*손으로\s*(자른|썬)/g, "손으로 썬 듯한"], [/모조\s*손(으로)?/g, "손으로 썬 듯한"], [/막다른\s*골목/g, "구석"], [/블랭킹/g, "투입"],
  [/(고온\s*)?베이킹\s*(페인트|바니시|래커)/g, "$1도장"], [/(실제\s*)?(제품|실물)을\s*기준으로\s*(해\s*주세요|하십시오|합니다)\.?/g, "실물 기준이에요"],
  [/당신(의|에게|은|이)\s*/g, ""], // v13 광고 문구에 "당신의 …"(직역 투) — 빼도 뜻이 같다(안경 세척기 "당신의 섬세함을 지켜요")
  [/^다진\s*파\s*([\d.]+\s*mm)$/g, "$1 다진 대파"], [/플래그십\s*모델/g, "플래그십형"], [/기본\s*모델/g, "기본형"], [/커터\s*헤드|커터헤드/g, "커터 날"],
];
export const LITERAL_RE = /거부합니다|매개\s*변수|초상화|진술이 우선|모조 손|파\s*거품|파폼|막다른 골목|블랭킹|휴식 경고|해야 합니다\.$|하십시오\.?$|됩니다\.$|두려워하지 마세요|당신(은|의|에게)|베이킹\s*페인트|기준으로\s*해\s*주세요/;
// zh·ko 한 줄 → { ko, changed, drop, literal(고친 뒤에도 직역체가 남는지) }
// 용어집 통째 바꾸기는 지금 글이 비었거나 기계번역 그대로(mt)거나 직역 흔적이 있을 때만 — AI 가 이미 잘 쓴 말("원터치 스위치")은 건드리지 않는다
export function fixLiteral(zh, ko, { mt = null } = {}) {
  const z = S(zh).replace(/\s/g, ""); let t = S(ko), changed = false;
  const g = GLOSSARY.find(([k]) => z === k);
  if (g && t !== g[1] && (!t || (mt != null && t === S(mt)) || LITERAL_RE.test(t) || LITERAL_FIX.some(([re]) => { const hit = re.test(t); re.lastIndex = 0; return hit; }))) return { ko: g[1], changed: true, drop: false, literal: false };
  // v13 원문에 없는 숫자로 시작하면 뗀다(옆에 남긴 숫자 "2" 옆 단위 글 扇 → "2단" 으로 숫자가 두 번 — 빨래건조대 d04)
  if (!/\d/.test(z) && /^\d+(?:\.\d+)?\s*\S/.test(t)) { t = t.replace(/^\d+(?:\.\d+)?\s*/, ""); changed = true; }
  // 葱 → "양파" 오역(기계번역이 葱을 양파로) — 洋葱(양파)가 아니면 대파
  if (/葱/.test(z) && !/洋葱/.test(z) && /양파/.test(t)) { t = t.replace(/양파/g, "대파"); changed = true; }
  for (const [re, to] of LITERAL_FIX) { if (!re.test(t)) { re.lastIndex = 0; continue; } re.lastIndex = 0; if (to == null) return { ko: "", changed: true, drop: true, literal: false }; t = t.replace(re, to); changed = true; }
  t = t.replace(/\s{2,}/g, " ").trim();
  // 기계번역 존댓말 어미 정리: ~하십시오 → ~하세요, ~됩니다. → ~돼요
  if (/하십시오\.?$/.test(t)) { t = t.replace(/하십시오\.?$/, "하세요"); changed = true; }
  return { ko: t, changed, drop: false, literal: LITERAL_RE.test(t) };
}
// v13 문장 속 직역체만 고친다(용어집 통째 바꾸기·줄 빼기 없음) — 사양 표 값처럼 원문 줄이 없는 글(기획서 사양 "고온 베이킹 페인트")
export function fixLiteralText(ko) { let t = S(ko); for (const [re, to] of LITERAL_FIX) { re.lastIndex = 0; if (to != null && re.test(t)) { re.lastIndex = 0; t = t.replace(re, to); } re.lastIndex = 0; } return t.replace(/\s{2,}/g, " ").trim(); }
// 프롬프트에 붙이는 용어집 줄
export const glossaryPrompt = () => `\n[상세페이지 용어집 — 원문이 이 말이면 이렇게(직역 금지)]\n${GLOSSARY.map(([k, v]) => `${k} → ${v}`).join(" / ")}\n직역체 금지 예: "~를 거부합니다", "매개변수", "제품군 초상화", "~의 진술이 우선합니다", "모조 손", "~하십시오". 葱(대파)은 "양파"가 아니다.\n판매 정책·가격 설명·구매 유도(클릭·보조금·쿠폰)·후기 모음 이미지는 promo=true.`;

// ── 3) 히어로 제목 ──
// 기획서 상품명 "업소용 대파 다지기 분쇄기 (커터헤드 교체형)" → "교체형 대파 다지기"(괄호 속 특징 + 핵심 명사), 14자 이내
export function heroNameFrom(name = "", max = 14) {
  let n = S(name); if (!n) return "";
  const paren = (n.match(/[(（]([^)）]+)[)）]/) || [])[1] || "";
  n = n.replace(/[(（][^)）]*[)）]/g, " ").replace(/^(업소용|상업용|가정용|휴대용|무선)\s+/, "").replace(/\s+/g, " ").trim();
  const words = n.split(" ");
  // 끝의 일반 명사(분쇄기·기계 등)는 앞 말이 충분하면 뺀다("대파 다지기 분쇄기" → "대파 다지기")
  if (words.length >= 3 && /^(분쇄기|기계|기기|머신|제품)$/.test(words.at(-1))) words.pop();
  let core = words.join(" ");
  const feat = S(paren).split(/\s+/).pop().replace(/형$/, "형"); // "커터헤드 교체형" → "교체형"
  if (feat && /형$/.test(feat) && (feat + " " + core).length <= max) core = `${feat} ${core}`;
  if (core.length > max) { const ws = core.split(" "); while (ws.length > 1 && ws.join(" ").length > max) ws.shift(); core = ws.join(" "); } // 길면 앞 수식어부터 뺀다(끝 명사 "세척기"를 살림)
  return core;
}
