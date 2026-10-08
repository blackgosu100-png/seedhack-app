// 1688 옵션(SKU) 가격 판단 — 순수 로직(크롬·Electron 없음, Node로 테스트 가능)
// 결과 목록의 ¥는 "옵션 중 가장 싼 값"이라 부품·차액 같은 낚시 옵션이 섞이면 실제 가격과 다르다.
// → 상품 페이지의 옵션 목록에서 (1) 낚시 옵션을 빼고 (2) 쿠팡 사진과 가장 비슷한 옵션을 고른다.

// 낚시 옵션 단어: 부품·단품·차액·운송비·보증금·링크용 등 "상품 본체가 아닌 것"
const BAIT = /配件|零件|单独|单卖|单个|不含|不包含|补差|差价|运费|邮费|勿拍|定金|订金|链接|样品费|备用|手柄|盖子|滤网单|单滤|单杯|空盒|包装盒|纸箱|说明书|赠品|试用装|专拍|补发|加购|加钱|升级费/;
export const isBait = (label) => BAIT.test(String(label || ""));

// 옵션명 한글 힌트(번역 API 전까지 쓰는 작은 사전). 모르는 글자는 그대로 둔다.
const DICT = [
  ["不锈钢", "스테인리스"], ["智能款", "스마트형"], ["机械款", "기계식"], ["长嘴", "긴주둥이"], ["粗嘴", "굵은주둥이"],
  ["黑色", "검정"], ["白色", "흰색"], ["红色", "빨강"], ["蓝色", "파랑"], ["绿色", "초록"], ["黄色", "노랑"], ["粉色", "분홍"], ["灰色", "회색"], ["棕色", "갈색"], ["米色", "베이지"], ["透明", "투명"], ["银色", "은색"], ["金色", "금색"], ["紫色", "보라"], ["橙色", "주황"],
  ["大号", "대형"], ["中号", "중형"], ["小号", "소형"], ["加大", "특대"], ["加厚", "두꺼운"], ["升级版", "업그레이드"], ["套装", "세트"], ["单个", "단품"], ["一套", "1세트"], ["两件套", "2종세트"], ["三件套", "3종세트"],
  ["滤网", "거름망"], ["滤纸", "필터지"], ["玻璃", "유리"], ["陶瓷", "도자기"], ["木柄", "나무손잡이"], ["塑料", "플라스틱"], ["硅胶", "실리콘"], ["铝合金", "알루미늄"],
  ["款", "타입"], ["黑", "검정"], ["白", "흰"], ["红", "빨강"], ["蓝", "파랑"], ["灰", "회색"], ["粉", "분홍"],
];
export function koHint(label) {
  let s = String(label || "");
  for (const [zh, ko] of DICT) s = s.split(zh).join(ko);
  return s === String(label || "") ? "" : s;
}

export const toNum = (v) => {
  if (v == null || v === "") return null;
  const m = String(v).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// ---- 사진 비교: dHash(9×8 회색조 → 64비트) ----
// gray: 길이 72(9×8)의 밝기 배열. 옆 픽셀보다 밝으면 1.
export function dhashFromGray(gray) {
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(gray[y * 9 + x] < gray[y * 9 + x + 1] ? 1 : 0);
  return bits;
}
export const hamming = (a, b) => a.reduce((s, v, i) => s + (v !== b[i] ? 1 : 0), 0);
// BGRA 비트맵(9×8) → 회색조
export function grayFromBGRA(buf) {
  const g = [];
  for (let i = 0; i + 3 < buf.length && g.length < 72; i += 4) g.push(0.114 * buf[i] + 0.587 * buf[i + 1] + 0.299 * buf[i + 2]);
  return g;
}

// 후보들(사진 해시 포함)을 쿠팡 사진과의 거리순으로 정렬. dist 0=같음, 64=정반대. 보통 ≤10이면 같은 사진, ≥20이면 다른 상품.
export function rankBySimilarity(photoHash, cands) {
  return cands
    .map((c, i) => ({ ...c, i, dist: c.hash && photoHash ? hamming(photoHash, c.hash) : null }))
    .sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
}

// 옵션 목록(이름·가격·거리)에서 "쿠팡 사진과 같은 옵션"의 가격을 정한다.
// 반환: { price, pick(선택 옵션), how(판단 근거), sure(확신), excluded(낚시 옵션 수), alts(대안 상위) }
export function decidePrice(items, { photoHash } = {}) {
  const all = items.map((it, i) => ({ ...it, i, price: toNum(it.price), bait: isBait(it.label) }));
  const live = all.filter((x) => !x.bait && x.price != null && x.price > 0);
  const excluded = all.length - live.length;
  if (!live.length) return { price: null, pick: null, how: "가격 있는 옵션 없음", sure: false, excluded, alts: [] };

  const ranked = photoHash ? rankBySimilarity(photoHash, live) : live.map((x) => ({ ...x, dist: null }));
  const withImg = ranked.filter((x) => x.dist != null);
  if (withImg.length) {
    const best = withImg[0], second = withImg[1];
    const sure = best.dist <= 12 && (!second || second.dist - best.dist >= 4);
    return { price: best.price, pick: best, sure, excluded, alts: withImg.slice(0, 4),
      how: sure ? `사진이 가장 비슷한 옵션 (차이 ${best.dist})` : `사진 비교 애매 (차이 ${best.dist}${second ? `, 다음 ${second.dist}` : ""}) — 옵션을 확인하세요` };
  }
  // 옵션 사진이 없으면: 낚시 제외 후 중앙값(1개 옵션이면 그 값)
  const prices = live.map((x) => x.price).sort((a, b) => a - b);
  const mid = prices[Math.floor(prices.length / 2)];
  const pick = live.find((x) => x.price === mid) || live[0];
  return { price: mid, pick, sure: live.length === 1, excluded, alts: live.slice(0, 4),
    how: live.length === 1 ? "옵션 1개" : `옵션 사진 없음 → 낚시 제외 ${live.length}개 중 중앙값 (범위 ¥${prices[0]}~¥${prices[prices.length - 1]})` };
}
