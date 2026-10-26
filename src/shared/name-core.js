// ✍ 상품명 짓기 — 존버셀러제이 2주차 강의(상품등록 p.4~26) 공식을 그대로 옮긴 계산. 화면·DB 없이 순수 함수만.
//  공식: [브랜드] [타겟키워드] [서브키워드…] (+수량) · 브랜드 포함 4~6단어(추천 5) · 수량/용량(10P, 500ml)은 단어 수에서 뺀다
//  · 타겟키워드 = 소비자가 더 많이 찾는 키워드 → 브랜드 바로 다음
//  · 색상은 옵션명으로 자동 노출되니 상품명에서 뺀다 · 특장점만 나열하지 않는다 · 쓸 키워드가 모자라면 특장점 단어로 채운다
//  · 자동완성에 떴다고 다 넣지 않는다(p.23~25 함정) → 단어마다 실제 월검색량을 같이 보여 준다
//  판정(좋다/나쁘다)은 내지 않는다 — 후보와 참고 숫자만(가독성 매뉴얼 2-6)

export const COLORS = ["블랙", "검정", "검정색", "검은색", "화이트", "흰색", "하얀색", "살색", "베이지", "네이비", "그레이", "회색", "차콜", "핑크", "분홍", "레드", "빨강", "빨간색", "블루", "파랑", "파란색",
  "그린", "초록", "녹색", "옐로우", "노랑", "노란색", "퍼플", "보라", "보라색", "브라운", "갈색", "아이보리", "카키", "민트", "실버", "골드", "커피색", "와인", "버건디", "오렌지", "주황", "크림", "연핑크", "스카이블루", "멀티컬러", "혼합색상"];
// 상품명에 넣으면 안 되는 남의 이름(상호·브랜드·판매처). 제휴 DB의 브랜드 표시가 빠진 것까지 — 발견할 때마다 추가
export const BRANDS = ["다이소", "쿠팡", "이마트", "노브랜드", "올리브영", "무인양품", "코스트코", "이케아", "샤넬", "루이비통", "구찌", "프라다", "에르메스", "디올", "셀린느", "버버리", "고야드", "미우미우", "보테가", "보테가베네타",
  "나이키", "아디다스", "뉴발란스", "휠라", "노스페이스", "스탠리", "다이슨", "애플", "삼성", "엘지", "비비안", "타비오", "마뗑킴", "스타벅스", "탐사", "코멧", "곰곰", "홈플래닛", "베이스알파", "베이스알파에센셜"];
// 상품이 아니라 정보를 찾는 검색(효과·후기·사용법…) — 상품명 단어로 쓰지 않는다
export const JUNK = ["효과", "추천", "후기", "디시", "가격", "사용법", "만들기", "착용법", "단점", "장점", "차이", "뜻", "세탁", "세탁법", "코디", "브랜드", "사이트", "파는곳", "매장", "순위", "비교", "정리", "구매", "할인", "쿠폰", "최저가", "중고", "도매", "직구", "렌탈"];

const QTY = /^(\d+(\.\d+)?(p|P|개|개입|장|매|매입|켤레|족|ml|mL|ML|l|L|g|kg|KG|cm|mm|m|M|입|세트|set|SET|팩|롤|ea|EA|구|단|종|박스|병|캔|포|봉|정|알|인용|인치|호|D|w|W|mAh)|\d+\s*[+xX×*]\s*\d+|[xX×]\d+|\d+(\.\d+)?)$/;
export const isQty = (t) => QTY.test(String(t).replace(/,/g, ""));
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
const clean = (s) => String(s || "").replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, " ").replace(/[,/|·★☆♥!?~#]+/g, " ").replace(/\s+/g, " ").trim();

// 단어 수: 띄어쓰기 기준, 수량·용량 표기는 뺀다(강의 p.12). 쉼표 뒤는 쿠팡이 붙이는 옵션명(", 그레이, 1개")이라 세지 않는다(p.21)
export function countWords(name) {
  const toks = clean(String(name || "").split(",")[0]).split(" ").filter(Boolean);
  const qty = toks.filter(isQty), words = toks.filter((t) => !isQty(t));
  return { n: words.length, words, qty, chars: String(name || "").length };
}

const isColor = (w) => COLORS.includes(w) || COLORS.some((c) => c.length >= 2 && w === c + "색");
const isBrandWord = (w, extra) => BRANDS.includes(w) || extra.has(norm(w));

// 단어 후보 모으기
//  subs: 제휴 DB의 "이 키워드를 포함하는 더 긴 키워드"({ kw, m1, mx, brand })  → 고탄력팬티스타킹 → "고탄력"(앞)
//  items: 이 키워드의 쿠팡 상위 상품({ name, brand, sales }) → 판매 많은 상품들이 공통으로 쓰는 단어
//  vol: { "고탄력팬티스타킹": { m1, mx } } — 상위 상품 단어로 만든 조합 키워드의 검색량(메인에서 DB로 채움)
//  cp: 쿠팡에서 읽은 { auto: 자동완성[], related: 연관검색어[], related2: { 연관검색어: 그 화면의 연관검색어[] }, deep: { 파생단어: 자동완성[] } } — 단어마다 몇 번 나왔는지(cp)와 어디서 나왔는지(src)
export function buildPool({ keyword, subs = [], items = [], vol = {}, cp = null }) {
  const base = norm(keyword);
  const brandSet = new Set(items.map((it) => norm(it.brand)).filter((b) => b.length >= 2));
  const map = new Map();
  const put = (word, patch) => {
    const k = norm(word);
    if (!k || k === base) return;
    const cur = map.get(k) || { word, pos: "pre", m1: null, mx: null, top: 0, cp: 0, flag: null, src: [] };
    map.set(k, { ...cur, ...patch, src: [...new Set([...cur.src, ...(patch.src || [])])] });
  };
  const flagOf = (w) => (isBrandWord(w, brandSet) ? "brand" : isColor(w) ? "color" : JUNK.includes(w) ? "junk" : null);
  // ⓪ 쿠팡 자동완성·연관검색어·파생 자동완성: 내 키워드 앞뒤에 붙은 단어. 내 키워드가 없으면 끝부분이 같은 것(압박스타킹 → 압박)
  if (cp) {
    const tail = (k) => { for (let n = Math.min(k.length, base.length); n >= 2; n--) if (k.endsWith(base.slice(-n))) return n; return 0; };
    const take = (phrase, src) => {
      const k = norm(phrase);
      let i = k.indexOf(base), len = base.length;
      if (i < 0) { const n = tail(k); if (!n || n === k.length) return; i = k.length - n; len = n; }
      // 띄어쓰기 단위로 나누고, 내 키워드 부분만 잘라 낸다(여성 팬티스타킹 살색 → 여성(앞) · 살색(뒤) / 고탄력팬티스타킹 → 고탄력(앞))
      const words = [];
      let at = 0;
      for (const t of String(phrase).trim().split(/\s+/)) {
        const n = norm(t), s = at, e = at + n.length; at = e;
        if (e <= i) words.push([t, "pre"]);
        else if (s >= i + len) words.push([t, "post"]);
        else { if (s < i) words.push([n.slice(0, i - s), "pre"]); if (e > i + len) words.push([n.slice(i + len - s), "post"]); }
      }
      words.forEach(([w, pos]) => {
        if (isQty(w) || !/[가-힣a-z0-9]/i.test(w) || /^\d+위$/.test(w) || base.includes(norm(w))) return; // 쉼표·"1위" 같은 조각은 단어가 아님
        const cur = map.get(norm(w));
        put(w, { pos: cur?.pos || pos, cp: (cur?.cp || 0) + 1, flag: cur?.flag || flagOf(w), src: [src] });
      });
    };
    (cp.auto || []).forEach((p) => take(p, "auto"));
    (cp.related || []).forEach((p) => take(p, "related"));
    Object.values(cp.deep || {}).flat().forEach((p) => take(p, "deep"));
    Object.values(cp.related2 || {}).flat().forEach((p) => take(p, "related2"));
  }
  // ① 제휴 DB 서브키워드(검색량 있는 실제 검색어)
  for (const s of subs) {
    const k = norm(s.kw), i = k.indexOf(base);
    if (i < 0) continue;
    const pre = k.slice(0, i), post = k.slice(i + base.length);
    if (pre && post) continue; // 앞뒤 둘 다 붙은 긴 조합은 건너뜀
    const word = pre || post;
    const flag = s.brand || isBrandWord(word, brandSet) ? "brand" : isColor(word) ? "color" : JUNK.includes(word) ? "junk" : null;
    put(word, { word, pos: pre ? "pre" : "post", m1: s.m1 ?? null, mx: s.mx ?? null, flag, src: ["db"] });
  }
  // ② 쿠팡 상위 판매 상품명에 반복되는 단어(2개 상품 이상)
  const ranked = items.filter((it) => it?.name).slice(0, 20);
  const seen = new Map(), firstOnly = new Map();
  ranked.forEach((it) => {
    const toks = clean(it.name).split(" ").filter(Boolean);
    const used = new Set();
    toks.forEach((t, j) => {
      let w = t;
      const k = norm(t);
      if (k.includes(base) && k !== base) w = k.replace(base, ""); // 고탄력팬티스타킹 → 고탄력
      const nk = norm(w);
      if (!nk || nk.length < 2 || isQty(w) || base.includes(nk) || used.has(nk)) return;
      used.add(nk);
      seen.set(nk, { word: w, n: (seen.get(nk)?.n || 0) + 1 });
      firstOnly.set(nk, (firstOnly.get(nk) ?? true) && j === 0); // 늘 맨 앞에만 나오면 그 가게 브랜드일 가능성이 크다
    });
  });
  for (const [k, { word, n }] of seen) {
    if (n < 2) continue;
    const v = vol[norm(word) + base] || vol[base + norm(word)] || null;
    const pos = vol[norm(word) + base] ? "pre" : vol[base + norm(word)] ? "post" : map.get(k)?.pos || "pre";
    const prev = map.get(k); // 쿠팡 검색어·DB에 이미 나온 단어는 "맨 앞에만 나오면 브랜드" 짐작을 쓰지 않는다
    const flag = prev ? prev.flag : isBrandWord(word, brandSet) || firstOnly.get(k) ? "brand" : isColor(word) ? "color" : JUNK.includes(word) ? "junk" : null;
    put(word, { top: n, pos, flag, ...(map.get(k)?.m1 == null && v ? { m1: v.m1 ?? null, mx: v.mx ?? null } : {}), src: ["top"] });
  }
  for (const p of map.values()) { // 검색량 붙이기: ① 조합(고탄력팬티스타킹) ② 끝말이 같으면 합친 말(청소솔 → 변기청소솔) ③ 단어 하나(solo, 참고만)
    const w = norm(p.word);
    if (p.m1 == null) {
      const v = vol[p.pos === "post" ? base + w : w + base];
      if (v) Object.assign(p, { m1: v.m1 ?? null, mx: v.mx ?? null });
    }
    if (p.m1 == null && w.length >= 2 && w.slice(-1) === base.slice(-1)) {
      for (let k = base.length - 1; k >= 1; k--) {
        const v = vol[base.slice(0, k) + w];
        if (v) { Object.assign(p, { m1: v.m1 ?? null, mx: v.mx ?? null, merged: base.slice(0, k) + w }); break; }
      }
    }
    if (vol[w] && p.m1 == null) p.solo = vol[w].m1 ?? null;
  }
  return [...map.values()].sort((a, b) => (b.m1 ?? -1) - (a.m1 ?? -1) || b.cp - a.cp || b.top - a.top);
}

// 처음 고를 단어(최대 4개, 나머지는 사람이 고른다): 근거가 많은 단어부터
//  월검색 100+ · 파생 자동완성으로 다시 확인됨(강의 p.11) · 쿠팡 검색어에 2번+ · 상위 상품 3개+ · 쿠팡 검색어와 상위 상품 양쪽에 나옴
export const pickScore = (p) => (p.flag ? 0 : ((p.m1 ?? 0) >= 100 ? 2 : 0) + (p.src.includes("deep") ? (p.m1 != null || p.top ? 2 : 1) : 0) + (p.cp >= 2 ? 1 : 0) + (p.top >= 3 ? 1 : 0) + (p.cp && p.top >= 2 ? 1 : 0));
export function defaultPicks(pool, max = 4) {
  const out = [];
  for (const { p } of pool.map((p, i) => ({ p, i, s: pickScore(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i)) {
    if (out.length >= max) break;
    if (!out.some((w) => w.includes(p.word) || p.word.includes(w))) out.push(p.word); // 학생용을 골랐으면 학생은 빼기
  }
  return out;
}

const phrase = (p, keyword) => (p.pos === "post" ? `${keyword} ${p.word}` : `${p.word} ${keyword}`);

// 후보 상품명 3개(강의 p.15: 타겟키워드를 무엇으로 잡느냐에 따라 후보 3개)
//  ① 기본 키워드를 타겟으로 ② ③ 고른 단어 중 검색량 큰 조합을 타겟으로. 나머지 고른 단어를 서브로 채워 5단어(브랜드 포함)
export function buildNames({ keyword, brand = "", qty = "", feats = "", pool = [], picks = [], main = null, size = 5 }) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];
  const chosen = picks.map((w) => pool.find((p) => p.word === w) || { word: w, pos: "pre", m1: null, mx: null, top: 0 });
  const featWords = clean(feats).split(" ").filter((w) => w && !isQty(w));
  const targets = [{ phrase: kw, used: null, m1: main?.m1 ?? null, mx: main?.mx ?? null }];
  // 타겟 2·3번: 검색량 큰 조합 → 검색량을 모르면(검색량 DB가 없는 PC) 쿠팡 자동완성·연관검색어에 많이 나온 조합(강의 p.9: 자동완성 = 소비자가 실제로 찾는 말)
  //  합친 말(변기청소솔)은 타겟 문구로 못 만들어서 서브로만
  const ok = chosen.filter((p) => !p.merged);
  [...ok.filter((p) => p.m1 != null).sort((a, b) => b.m1 - a.m1), ...ok.filter((p) => p.m1 == null && p.cp).sort((a, b) => b.cp - a.cp || b.top - a.top)].slice(0, 2)
    .forEach((p) => targets.push({ phrase: phrase(p, kw), used: p.word, m1: p.m1, mx: p.mx, cp: p.cp || 0 }));
  const b = clean(brand);
  return targets.map((t) => {
    const words = [...(b ? [b] : []), ...t.phrase.split(" ")];
    const subs = [...chosen.filter((p) => p.word !== t.used).map((p) => p.word), ...featWords];
    for (const w of subs) {
      if (countWords(words.join(" ")).n >= size) break;
      if (!words.some((x) => norm(x) === norm(w))) words.push(w);
    }
    const name = [...words, ...(qty ? [String(qty).trim()] : [])].join(" ");
    return { name, target: t.phrase, n: countWords(name).n, m1: t.m1, mx: t.mx, cp: t.cp || 0, feat: featWords.filter((w) => words.includes(w)) };
  });
}

// 내 상품명 검사 — 강의 기준별로 ○/✕/참고. pass: true(맞음) · false(고칠 것) · null(참고)
export function checkName(name, { keyword = "", brand = "", pool = [] } = {}) {
  const raw = String(name || "").trim();
  if (!raw) return [];
  const { n, words, chars } = countWords(raw);
  const base = norm(keyword), b = norm(brand);
  const out = [];
  out.push({ key: "len", label: `${n}단어`, pass: n >= 4 && n <= 6, why: n < 4 ? "짧아요 · 브랜드 포함 4~6단어를 추천해요" : n > 6 ? "길어요 · 쿠팡 PB 평균은 5.1단어예요" : "브랜드 포함 4~6단어 · 수량·용량은 빼고 셉니다" });
  if (base) {
    const has = norm(raw).includes(base);
    out.push({ key: "kw", label: "키워드 포함", pass: has, why: has ? `'${keyword}'가 들어 있어요` : `'${keyword}'가 상품명에 없어요 · 검색어가 그대로 있어야 노란 매칭에 유리해요` });
  }
  if (b) {
    const first = norm(words[0]) === b;
    out.push({ key: "brand", label: "브랜드 맨 앞", pass: first, why: first ? "브랜드 → 타겟키워드 순서" : "브랜드명을 맨 앞에 두세요" });
  }
  if (base) {
    const start = b && norm(words[0]) === b ? 1 : 0;
    const at = words.findIndex((w, i) => i >= start && norm(words.slice(i, i + 3).join("")).includes(base));
    const near = at >= start && at - start <= 1;
    out.push({ key: "pos", label: "타겟키워드 앞쪽", pass: at < 0 ? false : near, why: near ? "브랜드 바로 다음에 타겟키워드가 있어요" : "타겟키워드는 브랜드 바로 다음에 두세요" });
  }
  const colors = words.filter(isColor);
  out.push({ key: "color", label: colors.length ? `색상 ${colors.join("·")}` : "색상 없음", pass: !colors.length, why: colors.length ? "색상은 옵션명으로 자동 노출돼요 · 상품명에서 빼세요" : "색상은 옵션명으로 보여 주는 게 맞아요" });
  const dup = words.filter((w, i) => words.findIndex((x) => norm(x) === norm(w)) !== i);
  out.push({ key: "dup", label: dup.length ? `반복 ${[...new Set(dup)].join("·")}` : "반복 없음", pass: !dup.length, why: dup.length ? "같은 단어를 두 번 쓸 필요 없어요" : "같은 단어 반복 없음" });
  const sym = /[\[\]【】★☆♥!~#]/.test(raw);
  out.push({ key: "sym", label: sym ? "특수문자 있음" : "특수문자 없음", pass: !sym, why: sym ? "[자체제작]·★ 같은 꾸밈은 쿠팡이 상품명을 바꿀 수 있어요" : "꾸밈 기호 없음" });
  const others = words.filter((w) => norm(w) !== b && (BRANDS.includes(w) || pool.some((p) => p.flag === "brand" && norm(p.word) === norm(w))));
  if (others.length) out.push({ key: "other", label: `남의 브랜드 ${others.join("·")}`, pass: false, why: "다른 브랜드 이름은 넣지 마세요" });
  out.push({ key: "chars", label: `${chars}/100자`, pass: chars <= 100, why: chars <= 100 ? "Wing 노출상품명 100자 이내" : "Wing 노출상품명은 100자까지예요" });
  const hits = pool.filter((p) => p.m1 != null && !p.flag && words.some((w) => norm(w) === norm(p.word)));
  out.push({ key: "vol", label: hits.length ? `검색되는 단어 ${hits.length}개` : "검색되는 단어 없음", pass: null, why: hits.length ? hits.map((p) => `${p.word} (${phrase(p, keyword).replace(/\s/g, "")} 월 ${p.m1.toLocaleString("ko-KR")})`).join(" · ") : "고른 단어 중 검색량이 확인된 조합이 없어요" });
  return out;
}
