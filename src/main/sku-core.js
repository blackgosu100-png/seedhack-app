// 1688 옵션(SKU) 가격 판단 — 순수 로직(크롬·Electron 없음, Node로 테스트 가능)
// 결과 목록의 ¥는 "옵션 중 가장 싼 값"이라 부품·차액 같은 낚시 옵션이 섞이면 실제 가격과 다르다.
// → 상품 페이지의 옵션 목록에서 (1) 낚시 옵션을 빼고 (2) 쿠팡 사진과 가장 비슷한 옵션을 고른다.
import { KO_BAIT } from "./ko-norm.js";

// 낚시 옵션 단어: 부품·단품·차액·운송비·보증금·링크용 등 "상품 본체가 아닌 것"
const BAIT = /配件|零件|单独|单卖|单个|不含|不包含|补差|差价|运费|邮费|勿拍|定金|订金|链接|样品费|备用|手柄|盖子|滤网单|单滤|单杯|空盒|包装盒|纸箱|说明书|赠品|试用装|专拍|补发|加购|加钱|升级费/;
export const isBait = (label) => BAIT.test(String(label || "")) || KO_BAIT.test(String(label || "")); // 1688 한국어판 옵션명도

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

// ---- 규격 글자 비교: 사진이 같은 옵션(3단/4단, 대/중/소, 1개/2개입, 길이·용량)을 쿠팡 상품명으로 가른다 ----
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = (v) => (CN_NUM[v] ?? Number(v));
const N = "(\\d+|[一二两三四五六七八九十])";
const RX = {
  tier: new RegExp(N + "\\s*(?:단|층|层|格)", "g"),
  count: new RegExp(N + "\\s*(?:개입|개(?!월)|pcs|p(?![a-z])|족|켤레|매|롤|팩|入|个|件|只|双|套|片|包|卷|条)", "gi"),
  len: /(\d+(?:\.\d+)?)\s*(cm|센치|mm|m(?![la-z])|미터|厘米|公分|米)/gi,
  vol: /(\d+(?:\.\d+)?)\s*(ml|l(?![a-z])|리터|毫升|升)/gi,
};
const SIZE = [[/특대|XXL|XL|加大|特大/i, "XL"], [/대형|大号|大码|大款|(?<![가-힣])대(?![가-힣])/, "L"], [/중형|中号|中码|中款/, "M"], [/소형|小号|小码|迷你|mini/i, "S"]];
const COLOR = [[/베이지|아이보리|ivory|beige|米色|米白|杏/i, "베이지"], [/화이트|흰색|white|白/i, "흰색"], [/블랙|검정|black|黑/i, "검정"], [/그레이|회색|gray|grey|灰/i, "회색"],
  [/브라운|갈색|brown|棕|咖啡/i, "갈색"], [/핑크|분홍|pink|粉/i, "분홍"], [/블루|파랑|네이비|blue|navy|蓝/i, "파랑"], [/그린|초록|민트|green|mint|绿/i, "초록"]];
const SIZE_KO = { XL: "특대", L: "대형", M: "중형", S: "소형" };
// 글자 → { tier, count, size, len:[cm], vol:[ml] } (없는 항목은 빠짐)
export function specsOf(text) {
  const t = String(text || ""), o = {};
  // 한 이름에 서로 다른 값이 여럿이면("2단 3단") 모르는 것으로 본다
  const first = (rx) => { const v = [...new Set([...t.matchAll(rx)].map((m) => num(m[1])))]; return v.length === 1 ? v[0] : null; };
  const tier = first(RX.tier); if (tier) o.tier = tier;
  const count = first(RX.count); if (count) o.count = count;
  for (const [rx, v] of SIZE) if (rx.test(t)) { o.size = v; break; }
  let rest = t; const cols = new Set(); // 긴 이름부터 지워 가며("米白" 안의 "白"을 흰색으로 또 세지 않게)
  for (const [rx, v] of COLOR) { const g = new RegExp(rx.source, "gi"); if (g.test(rest)) { cols.add(v); rest = rest.replace(g, " "); } }
  if (cols.size === 1) o.color = [...cols][0];
  const lens = [...t.matchAll(RX.len)].map((m) => { const v = +m[1], u = m[2].toLowerCase(); return u === "mm" ? v / 10 : /^(m|미터|米)$/.test(u) ? v * 100 : v; }).filter((v) => v > 0);
  if (lens.length) o.len = lens;
  const vols = [...t.matchAll(RX.vol)].map((m) => { const v = +m[1], u = m[2].toLowerCase(); return /^(l|리터|升)$/.test(u) ? v * 1000 : v; }).filter((v) => v > 0);
  if (vols.length) o.vol = vols;
  return o;
}
export const specText = (s) => [s.tier && `${s.tier}단`, s.size && SIZE_KO[s.size], s.count && `${s.count}개`, s.len && `${s.len[0]}cm`, s.vol && `${s.vol[0]}ml`, s.color].filter(Boolean).join("·");
const near = (a, b) => a.some((x) => b.some((y) => Math.abs(x - y) <= Math.max(x, y) * 0.05));
// 쿠팡 규격(want)과 옵션 이름 규격(have)이 겹치는 항목마다 맞으면 +2, 다르면 −2. 겹치는 항목이 없으면 0
export function specScore(want, have) {
  let s = 0;
  for (const k of ["tier", "count", "size", "color"]) if (want[k] != null && have[k] != null) s += want[k] === have[k] ? 2 : -2;
  for (const k of ["len", "vol"]) if (want[k] && have[k]) s += near(want[k], have[k]) ? 2 : -1;
  return s;
}
// 사진 거리순 목록에서 "사진이 거의 같은 무리"(최고 거리 +4 이내)만 규격 점수로 다시 줄 세운다. 1단계 옵션 버튼에도 쓴다
export function specRerank(ranked, name, tie = 4) {
  const want = specsOf(name);
  if (!Object.keys(want).length || ranked.length < 2) return ranked;
  const d0 = ranked[0].dist;
  const inTie = (x) => d0 == null ? x.dist == null : x.dist != null && x.dist <= d0 + tie;
  const head = ranked.filter(inTie).map((x) => ({ ...x, spec: specScore(want, specsOf(x.label)) }));
  if (!head.some((x) => x.spec !== 0)) return ranked;
  head.sort((a, b) => b.spec - a.spec || (a.dist ?? 99) - (b.dist ?? 99));
  return [...head, ...ranked.filter((x) => !inTie(x))];
}

// 옵션 목록(이름·가격·거리)에서 "쿠팡 사진과 같은 옵션"의 가격을 정한다.
// 반환: { price, pick(선택 옵션), how(판단 근거), sure(확신), excluded(낚시 옵션 수), alts(대안 상위) }
// 쿠팡 상품이 "세트"(볼+트랙처럼 여러 개 구성)인데 옵션에 단품(볼만)과 구성품(볼+트랙)이 섞여 있으면, 단품 최저가가 뽑혀
// 원가가 반값으로 잡힌다(2026-10-11 마사지볼: 단품 ¥1.5 vs 볼+트랙 ¥3.5). → 구성 옵션이 있으면 그 안에서만 고른다.
const SET_NAME = /세트|\bset\b|\+|구성|패키지|키트|트랙|받침|보드/i;
const COMBO_OPT = /\+|＋|套|组合|带|含|配|세트|구성|트랙|轨道|底座|받침/;
export function decidePrice(items, opts = {}) {
  const r = decidePriceCore(items, opts);
  // 옵션 상자에서 다른 옵션으로 바꿀 수 있게 가격 있는 옵션은 모두 보여 준다(예전엔 상위 4개만 → 나머지 옵션을 못 골랐음)
  const all = items.map((it, i) => ({ ...it, i, price: toNum(it.price), bait: isBait(it.label) })).filter((x) => x.price != null && x.price > 0);
  const alts = [...(r.alts || []), ...all.filter((x) => !(r.alts || []).some((a) => a.i === x.i))].slice(0, 16);
  return { ...r, alts };
}
function decidePriceCore(items, { photoHash, name = "" } = {}) {
  const all = items.map((it, i) => ({ ...it, i, price: toNum(it.price), bait: isBait(it.label) }));
  let live = all.filter((x) => !x.bait && x.price != null && x.price > 0);
  let setNote = "";
  if (SET_NAME.test(name) && live.length > 1) {
    const combo = live.filter((x) => COMBO_OPT.test(String(x.label || "")));
    if (combo.length && combo.length < live.length) { setNote = ` · 쿠팡이 세트라 구성 옵션 ${combo.length}개만 비교(단품 ${live.length - combo.length}개 제외)`; live = combo; }
  }
  if (setNote) { const r = decideLive(all, live, { photoHash, name }); return { ...r, how: r.how + setNote, sure: false }; }
  return decideLive(all, live, { photoHash, name });
}
function decideLive(all, live, { photoHash, name = "" } = {}) {
  const excluded = all.length - live.length;
  if (!live.length) return { price: null, pick: null, how: "가격 있는 옵션 없음", sure: false, excluded, alts: [] };

  const ranked = photoHash ? rankBySimilarity(photoHash, live) : live.map((x) => ({ ...x, dist: null }));
  const withImg = ranked.filter((x) => x.dist != null);
  const want = specsOf(name), wantTxt = specText(want);
  if (withImg.length) {
    // 사진이 거의 같은 옵션이 여러 개면(3단/4단처럼 사진만 같은 규격) 쿠팡 상품명의 규격으로 고른다
    const tie = withImg.filter((x) => x.dist <= withImg[0].dist + 4);
    if (tie.length > 1 && wantTxt) {
      const sc = tie.map((x) => ({ ...x, spec: specScore(want, specsOf(x.label)) })).sort((a, b) => b.spec - a.spec || a.dist - b.dist);
      if (sc[0].spec > 0) {
        const sure = sc[0].dist <= 12 && sc[0].spec > sc[1].spec;
        return { price: sc[0].price, pick: sc[0], sure, excluded, spec: wantTxt, alts: [...sc, ...withImg.filter((x) => !tie.includes(x))].slice(0, 6),
          how: sure ? `사진 같은 옵션 ${tie.length}개 중 규격 일치 (${wantTxt})` : `사진 같은 옵션 ${tie.length}개 · 규격(${wantTxt})이 맞는 옵션이 여러 개 — 옵션을 확인하세요` };
      }
      if (sc.every((x) => x.spec === 0)) {
        const best = withImg[0];
        return { price: best.price, pick: best, sure: false, excluded, spec: wantTxt, alts: withImg.slice(0, 6),
          how: `사진 같은 옵션 ${tie.length}개 · 옵션 이름에 규격(${wantTxt})이 없어 못 가름 — 옵션을 확인하세요` };
      }
    }
    const best = withImg[0], second = withImg[1];
    const sure = best.dist <= 12 && (!second || second.dist - best.dist >= 4);
    return { price: best.price, pick: best, sure, excluded, alts: withImg.slice(0, 4),
      how: sure ? `사진이 가장 비슷한 옵션 (차이 ${best.dist})` : `사진 비교 애매 (차이 ${best.dist}${second ? `, 다음 ${second.dist}` : ""}) — 옵션을 확인하세요` };
  }
  // 옵션 사진이 없으면: 규격 글자가 맞는 옵션 → 없으면 낚시 제외 후 중앙값(1개 옵션이면 그 값)
  if (wantTxt && live.length > 1) {
    const sc = live.map((x) => ({ ...x, dist: null, spec: specScore(want, specsOf(x.label)) })).sort((a, b) => b.spec - a.spec);
    if (sc[0].spec > 0) {
      const sure = sc[0].spec > sc[1].spec;
      return { price: sc[0].price, pick: sc[0], sure, excluded, spec: wantTxt, alts: sc.slice(0, 6),
        how: sure ? `규격 일치 옵션 (${wantTxt})` : `규격(${wantTxt})이 맞는 옵션이 여러 개 — 옵션을 확인하세요` };
    }
  }
  const prices = live.map((x) => x.price).sort((a, b) => a - b);
  const mid = prices[Math.floor(prices.length / 2)];
  const pick = live.find((x) => x.price === mid) || live[0];
  return { price: mid, pick, sure: live.length === 1, excluded, alts: live.slice(0, 4),
    how: live.length === 1 ? "옵션 1개" : `옵션 사진 없음 → 낚시 제외 ${live.length}개 중 중앙값 (범위 ¥${prices[0]}~¥${prices[prices.length - 1]})` };
}
