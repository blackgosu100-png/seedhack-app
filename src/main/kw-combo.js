// 💡 키워드 추천 — 조건 조합: 제휴 키워드 DB(~/sellar-data/sellar_YYYY-MM.db)에서 바로 거른다.
// 축마다 "적음/많음"을 고르고 2~3개를 겹쳐 본다(예: 로켓그로스 적음 + 해외배송 많음 + 리뷰 적음).
// 기본 정제(쇼핑성·브랜드 아님·쿠팡 총리뷰 300+·월검색 1천+)와 제외 사전은 keyword-pipeline config.json(2026-10-10)과 같은 값.
// 판정은 내지 않는다 — 조건에 맞는 키워드를 기회점수(월검색 ÷ (1위 리뷰+10)) 순으로 보여 줄 뿐.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), "sellar-data");

// 축: 적음(lo) / 많음(hi) 경계 — 화면 버튼에도 같은 숫자를 쓴다
export const AXES = {
  grow:   { ko: "로켓그로스", key: "srocket", lo: 0.2, hi: 0.5, unit: "%" },
  rocket: { ko: "로켓배송",   key: "rocket",  lo: 0.2, hi: 0.5, unit: "%" },
  ov:     { ko: "해외배송",   key: "ov",      lo: 0.1, hi: 0.3, unit: "%" },
  review: { ko: "1위 리뷰",   key: "mx",      lo: 500, hi: 3000, unit: "개" },
  trend:  { ko: "검색 추세",  key: "fc",      lo: -0.2, hi: 0.3, unit: "%", loKo: "지는 중", hiKo: "뜨는 중" },
  price:  { ko: "평균가",     key: "price",   lo: 15000, hi: 50000, unit: "원" },
};

const EX_CAT_PREFIX = ["도서", "식품", "여가/생활편의"];
const EX_CAT_HAS = ["e쿠폰", "상품권", "수집품", "피규어", "만화", "음반", "티켓", "의료기기", "의약", "게임타이틀", "PC게임", "순금", "골드바", "명품", "콘솔게임", "게임기", "DVD", "블루레이", "영화"];
const EX_KW = ["피규어", "굿즈", "포토카드", "포카", "유니폼", "레플리카", "캐릭터", "포켓몬", "산리오", "쿠로미", "시나모롤", "헬로키티", "디즈니", "마블", "원피스", "짱구", "건담", "레고", "미쿠", "고질라", "지브리", "카카오프렌즈", "춘식이", "잔망루피", "하나코", "귀멸", "주술회전", "이심", "유심", "상품권", "쿠폰", "기프티콘", "입장권", "티켓", "숙박", "항공권", "여행", "신점", "사주", "타로", "점집", "렌탈", "대여", "수리", "설치", "이사", "레슨", "학원", "보험", "대출", "중고", "도매", "직구", "안녕자두야", "한교동", "모몽가", "치이카와", "넨도로이드", "이타백", "마인크래프트", "젤다", "닌텐도", "엘든링", "금시세", "골드바", "순금", "돌반지", "제작", "인화", "출력", "인쇄", "듀오링고", "어플", "붉은사막", "포코피아", "발더스게이트", "mts", "5070", "5080", "5090", "4070", "4080", "4090", "수정방", "우량예", "공부가주", "고량주", "백주", "위스키", "와인", "사케", "소주", "맥주", "보드카", "데킬라", "꼬냑", "막걸리", "샴페인", "물벼룩", "구피", "열대어", "사슴벌레", "장수풍뎅이", "금붕어", "햄스터", "다슬기", "새우치어", "생이새우", "앵무새분양", "분양", "베지터", "드래곤볼", "나루토", "슬램덩크"];
const EX_BRAND = ["샤넬", "루이비통", "구찌", "프라다", "에르메스", "디올", "셀린느", "버버리", "몽클레어", "꼼데", "스톤아일랜드", "나이키", "아디다스", "뉴발란스", "휠라", "노스페이스", "스탠리", "다이슨", "애플", "아이폰", "에어팟", "갤럭시", "삼성", "엘지", "lg", "네이버", "카카오", "스타벅스", "이케아", "무인양품", "다이소", "rtx", "클라란스", "트루릴리젼", "마오타이", "샐러드마스터", "오즈모", "dji", "고프로", "플스", "ps5", "닌텐", "eocr"];

// DB에 브랜드 표시가 빠진 브랜드·상호(방송 시연에서 추천되면 안 됨) — 발견할 때마다 추가
const EX_EXACT = new Set(["마리떼프랑소와키즈", "마리떼프랑소와", "무신사키즈", "제이미케이", "스튜시", "신영와코루", "올라올라", "베리드주니어", "이설한복", "청춘교복", "트루릴리젼",
  "앤드퍼프", "아봉피싱", "마메고마", "던에드워드페인트", "델로나", "멕시코66", "아티산키캡", "100명의위인들", "붐붐키즈", "고멕서스핸들", "바르셀로나바람막이", "포포나무", "우사기", "하치와레", "데스노트", "가방순이", "임밍아웃카드", "융스위치", "sp커넥터"]);
// 초보가 1688에서 들여올 수 없거나(살아 있는 식물·씨앗 = 검역), 로켓그로스로 보내기 어려운 대형 자재, 모바일·서비스 상품
const EX_CAT_NOSRC = ["공기정화식물", "씨앗/모종", "관엽식물", "다육식물", "허브식물", "수경식물", "분재", "식용식물", "넝쿨식물", "천연잔디", "토피어리",
  "DIY자재/용품>목재", "DIY자재/용품>패널", "DIY자재/용품>바닥재", "모바일초대장", "모바일상품권"];
// 상호·사이트 찾기·담배처럼 상품이 아닌 검색
const EX_KW2 = ["간식", "사료", "영양제", "인공눈물", "오후권", "이용권", "액상", "전자담배", "전담", "사이트", "추천", "아울렛", "카드단말기"];
// 화장품(화장품법 — 책임판매업 필요): 미용 소품만 남기고 항상 제외
const EX_COSMETIC = ["스킨케어", "메이크업", "클렌징", "바디케어", "헤어케어", "향수", "네일케어", "남성화장품", "선케어", "마스크/팩", "베이비케어", "헤어스타일링"];

// 🛡 안전 필터(기본 켜짐, 결과 화면에서 끌 수 있음) — 카테고리·단어 규칙. AI 판별을 붙이면 더 정확해진다
const SAFE = {
  cert: { ko: "인증 필요한 상품 빼기", desc: "전기·어린이·식품에 닿는 주방용품·생활화학",
    cat: ["디지털/가전", "출산/육아", "주방용품>보관/밀폐용기", "주방용품>잔/컵", "주방용품>냄비/솥", "주방용품>식기", "주방용품>일회용품", "주방용품>칼/커팅기구", "주방용품>조리기구", "주방용품>프라이팬",
      "주방용품>제과/제빵용품", "주방용품>커피용품", "주방용품>주전자/티포트", "주방용품>도마", "주방용품>와인용품", "생활용품>세제/세정제", "생활용품>섬유유연제", "생활용품>생리대", "생활용품>성인용기저귀",
      "생활용품>해충퇴치용품", "생활용품>제습/방향/탈취", "공구>전기용품", "공구>전동공구", "공구>용접공구", "공구>예초기", "공구>소형기계", "공구>에어공구", "건강관리용품", "의료용품"],
    kw: ["전기", "충전", "무선", "배터리", "led", "usb", "히터", "전동", "블루투스", "스피커", "조명", "램프", "무드등", "전구", "온열", "가습기", "선풍기", "어린이", "유아", "아기", "키즈", "경보기", "계량기", "소화기", "분배기", "보일러"] },
  big: { ko: "크고 무거운 것 빼기", desc: "가구·대형 자재·오토바이 등 50cm·2kg 넘기 쉬운 것",
    cat: ["서재/사무용가구", "침실가구", "주방가구", "거실가구", "수납가구", "아동/주니어가구", "아웃도어가구", "DIY자재/용품", "카페트/러그", "오토바이/스쿠터"],
    kw: ["매트리스", "침대", "소파", "옷장", "책상", "테이블", "수납장", "런닝머신", "자전거", "텐트", "냉장고", "세탁기", "건조기"] },
  craft: { ko: "각인·재단·설치 필요한 것 빼기", desc: "주문 제작·맞춤 사이즈·시공",
    cat: ["커튼/블라인드"], kw: ["각인", "주문제작", "맞춤", "재단", "시공", "명패", "현판", "트로피", "상패", "싱글패", "이글패", "도장", "판넬", "블라인드", "방충망", "식권", "청첩장", "초대장", "포맥스", "포멕스", "아크릴판", "조인트", "배관", "유골함"] },
  tools: { ko: "공구·부품·산업용 빼기", desc: "공구·배관·측정기·자동차 소모품처럼 초보가 이름부터 낯선 것",
    cat: ["생활/건강>공구", "자동차용품>오일/소모품", "자동차용품>자동차부품", "자동차용품>공구/장비", "산업용품", "DIY자재/용품"],
    kw: ["니플", "피팅", "볼트", "너트", "게이지", "커플링", "베어링", "캘리퍼", "샤프트", "와이퍼", "부품"] },
  apparel: { ko: "사이즈 많은 옷·신발 빼기", desc: "사이즈 옵션이 많아 반품이 잦은 것",
    cat: ["패션의류", "여성신발", "남성신발", "신발용품"], kw: ["운동화", "구두", "부츠", "슬리퍼", "샌들", "원피스", "바지", "자켓", "재킷", "코트", "패딩", "맨투맨", "트레이닝", "가디건", "조끼", "셔츠", "레깅스", "후드", "니트", "도복", "수영복", "점퍼", "스커트"] },
};
export const SAFE_DEF = Object.fromEntries(Object.entries(SAFE).map(([k, v]) => [k, { ko: v.ko, desc: v.desc }]));

let pool = null, month = null, dbTotal = 0, baseCount = 0, lockCut = [];
async function load() {
  if (pool) return pool;
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^sellar_\d{4}-\d{2}\.db$/.test(f)).sort() : [];
  if (!files.length) return (pool = []);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(DIR, files.at(-1)), { readOnly: true });
  month = files.at(-1).slice(7, 14);
  dbTotal = db.prepare("select count(*) n from k").get().n;
  const rows = db.prepare(`select keyword, category, m1, m1_fc_rate, cp_avg_price, cp_max_reviews, cp_rocket, cp_seller_rocket, cp_overseas, cp_ov_max_reviews, seasonality, season_month
    from k where is_shopping = 'O' and is_brand <> 'O' and cp_total_reviews >= 300 and m1 >= 1000 and cp_avg_price between 3000 and 150000`).all(); // 평균가 3천~15만: 차량·가전 대형 등 초도 50~100개로 못 들어가는 것 제외
  db.close();
  baseCount = rows.length;
  const cats = (c) => String(c || "").split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  // 항상 제외(🔒): 이유별로 센다 — 진행 화면 깔때기에 "무엇이 몇 개 빠졌는지" 그대로 보여 준다
  const why = (r) => {
    const kw = String(r.keyword || "").toLowerCase();
    if (!kw) return "기타";
    if (!/[가-힣]/.test(kw) || EX_BRAND.some((w) => kw.includes(w)) || EX_EXACT.has(r.keyword)) return "브랜드·모델명";
    if (EX_KW.some((w) => kw.includes(w)) || EX_KW2.some((w) => kw.includes(w))) return "캐릭터·서비스·담배";
    const cs = cats(r.category);
    if (!cs.length) return null;
    const live = cs.filter((c) => !(EX_CAT_PREFIX.some((p) => c.startsWith(p)) || EX_CAT_HAS.some((w) => c.includes(w)) || EX_CAT_NOSRC.some((w) => c.includes(w)) || (c.startsWith("화장품/미용") && EX_COSMETIC.some((w) => c.includes(w)))));
    if (live.length) return null;
    const c = cs[0];
    return c.startsWith("식품") ? "식품" : c.startsWith("화장품") ? "화장품" : EX_CAT_NOSRC.some((w) => c.includes(w)) ? "살아 있는 식물·대형 자재" : /의료|의약/.test(c) ? "의약·의료" : "도서·티켓·수집품";
  };
  const cut = {};
  pool = [];
  for (const r of rows) {
    const w = why(r);
    if (w) { cut[w] = (cut[w] || 0) + 1; continue; }
    const cat = cats(r.category)[0] || "", low = String(r.keyword).toLowerCase();
    const flag = (f) => SAFE[f].cat.some((c) => cat.includes(c)) || SAFE[f].kw.some((w) => low.includes(w));
    pool.push({
      kw: r.keyword, cat, m1: r.m1 || 0, fc: r.m1_fc_rate, price: r.cp_avg_price || 0, mx: r.cp_max_reviews || 0,
      rocket: r.cp_rocket || 0, srocket: r.cp_seller_rocket || 0, ov: r.cp_overseas || 0, ovmx: r.cp_ov_max_reviews || 0,
      season: r.seasonality === "있음" ? "있음" : "", seasonMonth: r.season_month && r.season_month !== "없음" ? r.season_month : "",
      safe: { cert: flag("cert"), big: flag("big"), craft: flag("craft"), tools: flag("tools"), apparel: flag("apparel") },
      // 안전·몸에 닿는 분류는 AI가 통과시켜도 "확인 필요"로(가상 초보 테스트 허점: 카스토퍼·코피어싱 통과)
      careful: /안전용품|보호용품|피어싱|헬멧|구명|의료|렌즈/.test(cat) || /피어싱|헬멧|보호대|구명/.test(low),
    });
  }
  lockCut = Object.entries(cut).sort((a, b) => b[1] - a[1]);
  return pool;
}

const pass = (k, axis, side) => {
  const a = AXES[axis]; if (!a || !side) return true;
  const v = k[a.key];
  if (v == null) return false;
  return side === "lo" ? v <= a.lo : v >= a.hi;
};

// cond: { grow:"lo"|"hi"|"", rocket, ov, review, trend, price, noSeason:true, sort:"score"|"m1"|"mx"|"price", limit }
export async function combo(cond = {}) {
  const all = await load();
  const axes = Object.keys(AXES).filter((a) => cond[a] === "lo" || cond[a] === "hi");
  const rows = all.filter((k) => (!cond.noSeason || k.season !== "있음") && axes.every((a) => pass(k, a, cond[a])));
  const score = (k) => k.m1 / (k.mx + 10);
  const key = cond.sort === "m1" ? (k) => -k.m1 : cond.sort === "mx" ? (k) => k.mx : cond.sort === "price" ? (k) => k.price : (k) => -score(k);
  rows.sort((a, b) => key(a) - key(b));
  return { month, total: all.length, count: rows.length, axes, axesDef: AXES, keywords: rows.slice(0, Math.min(500, cond.limit || 300)) };
}

// 🔍 AI 소싱(버튼 하나): 깔때기 단계별 실제 개수 + 빠진 이유 → 세 묶음 결과. 조절(예산·안전 필터·경쟁 조건)은 결과 화면에서
//  opts: { budget: 원(0=전체), qty: 들여올 개수(기본 80), safe: {cert,big,craft,apparel: true=빼기}, noSeason, cond: {grow:"lo"…} }
//  예산: 1688 원가를 아직 모르므로 "평균가에서 수수료·광고 10%·마진 20%·물류 2,200원을 빼고 남는 최대 원가 × 개수"로 거른다
const COST = { fee: 0.1188, ad: 0.1, margin: 0.2, logi: 2200 };
export const maxCost = (price) => price * (1 - COST.fee - COST.ad - COST.margin) - COST.logi;
// 🤖 AI 판별 결과(tools/kw-judge.mjs가 월 1회 만듦) — { 키워드: { v: ok|hold|no, reason, tags } }
let judge = {}, judgeKey = "";
function loadJudge() { // 파일이 바뀌면(월간 판별을 다시 돌리면) 다시 읽는다
  const f = path.join(DIR, `kw_judge_${month}.json`);
  let key = "";
  try { const st = fs.statSync(f); key = `${f}:${st.mtimeMs}`; } catch { return (judge = {}); }
  if (key !== judgeKey) { try { judge = JSON.parse(fs.readFileSync(f, "utf8")); judgeKey = key; } catch { judge = {}; } }
  return judge;
}
export async function scan(opts = {}) {
  const all = await load();
  const J = opts.aiJudge === false ? {} : loadJudge();
  const steps = [
    { key: "db", label: "쿠팡 키워드 DB", count: dbTotal },
    { key: "base", label: "실제로 팔리는 것", count: baseCount, note: "쇼핑 검색 · 쿠팡 리뷰 300+ · 월검색 1천+ · 평균가 3천~15만원" },
    { key: "lock", label: "누구나 팔 수 있는 것", count: all.length, cuts: lockCut, locked: true },
  ];
  let list = all;
  const safe = { cert: true, big: true, craft: true, tools: true, apparel: true, ...(opts.safe || {}) };
  const sc = [];
  for (const f of Object.keys(SAFE)) {
    if (!safe[f]) continue;
    const before = list.length;
    list = list.filter((k) => !k.safe[f]);
    sc.push([SAFE[f].ko.replace(/ 빼기$/, ""), before - list.length]);
  }
  if (opts.noSeason !== false) { const b = list.length; list = list.filter((k) => k.season !== "있음"); sc.push(["계절 상품", b - list.length]); }
  steps.push({ key: "safe", label: "초보도 들여올 수 있는 것", count: list.length, cuts: sc });
  if (Object.keys(J).length) { // AI가 상품을 떠올려 본 판별: 부적합(no)은 빼고, 이유를 센다
    const b = list.length, why = {};
    list = list.filter((k) => { const j = J[k.kw]; if (j?.v === "no") { why[j.reason] = (why[j.reason] || 0) + 1; return false; } return true; });
    const top = Object.entries(why).sort((x, y) => y[1] - x[1]);
    steps.push({ key: "ai", label: "AI 검수 통과", count: list.length, cuts: [["AI가 초보 부적합으로 판별", b - list.length], ...top.slice(0, 4).map(([r, n]) => [`  · ${r}`, n])] });
  }
  const qty = opts.qty > 0 ? opts.qty : 80;
  { // 마진이 남는 가격대 + 예산
    const b = list.length;
    list = list.filter((k) => maxCost(k.price) > 0 && (!(opts.budget > 0) || maxCost(k.price) * qty <= opts.budget));
    steps.push({ key: "budget", label: opts.budget > 0 ? `예산 ${Math.round(opts.budget / 10000).toLocaleString("ko-KR")}만원 안` : "마진이 남는 가격대", count: list.length,
      cuts: [[opts.budget > 0 ? `원가 × ${qty}개가 예산 초과·판매가가 너무 낮음` : "판매가가 너무 낮아 마진 못 남김", b - list.length]] });
  }
  const axes = Object.keys(AXES).filter((a) => opts.cond?.[a] === "lo" || opts.cond?.[a] === "hi");
  if (axes.length) {
    const b = list.length;
    list = list.filter((k) => axes.every((a) => pass(k, a, opts.cond[a])));
    steps.push({ key: "cond", label: "고른 경쟁 조건", count: list.length, cuts: [["조건에 안 맞음", b - list.length]] });
  }
  const score = (k) => k.m1 / (k.mx + 10);
  // 묶음 안 순서: AI 통과(ok) → AI 검수 전 → AI 확인 필요(hold). 같은 칸에서는 원래 순서(기회점수·추세)
  const aiOf = (k) => { const j = J[k.kw]; if (j?.v === "ok" && k.careful) return { ...j, v: "hold", reason: "안전·몸에 닿는 품목 — 인증 확인 필요" }; return j; };
  const tier = (k) => (aiOf(k)?.v === "ok" ? 0 : aiOf(k)?.v === "hold" ? 2 : 1);
  const pick = (f, sort, n = opts.limit || 60) => { const r = list.filter(f).sort((a, b) => tier(a) - tier(b) || sort(a, b)); return { count: r.length, items: r.slice(0, n).map((k) => (J[k.kw] ? { ...k, ai: aiOf(k) } : k)) }; };
  return {
    month, dbTotal, final: list.length, steps, judged: Object.keys(J).length,
    ...(opts.full ? { all: list } : {}), // 전체 검수용(tools/kw-judge.mjs --all): 필터를 통과한 후보 전부
    safeDef: SAFE_DEF, axesDef: AXES, // 화면의 안전 필터 칩·경쟁 조건 버튼 정의(주석 안에 들어가 있어 화면에 안 나오던 것, 2026-10-12 수정)
    top3: (() => { // AI가 고른 3개: 묶음마다 AI 통과 1위부터, 겹치지 않게
      const out = [], seen = new Set();
      const g = { start: list.filter((k) => k.mx <= 1000 && k.price <= 40000), weak: list.filter((k) => k.srocket <= 0.2 && k.mx <= 500 && k.price <= 60000), rising: list.filter((k) => (k.fc ?? 0) >= 0.3 && k.mx <= 3000 && k.price <= 60000) };
      for (const [id, arr] of [["start", g.start], ["weak", g.weak], ["rising", g.rising], ["start", g.start], ["weak", g.weak]]) {
        if (out.length >= 3) break;
        const k = arr.filter((x) => aiOf(x)?.v === "ok" && aiOf(x)?.easy !== false && !seen.has(x.kw)).sort((a, b) => score(b) - score(a))[0]; // 이름만 듣고 아는 상품만
        if (k) { seen.add(k.kw); out.push({ ...k, ai: aiOf(k), group: id }); }
      }
      return out;
    })(),
    groups: {
      start: pick((k) => k.mx <= 1000 && k.price <= 40000, (a, b) => score(b) - score(a)),
      weak: pick((k) => k.srocket <= 0.2 && k.mx <= 500 && k.price <= 60000, (a, b) => score(b) - score(a)),
      rising: pick((k) => (k.fc ?? 0) >= 0.3 && k.mx <= 3000 && k.price <= 60000, (a, b) => (b.fc ?? 0) - (a.fc ?? 0)), // 1등 리뷰 3,000개 넘으면 "뜨는"이 아니라 이미 꽉 찬 시장
    },
  };
}

// 🎁 한 번 조회할 때 처음 보는 키워드 n개를 등급을 섞어 뽑는다(같은 사람에겐 다시 안 보여 줌, 매번 무작위라 수강생끼리도 묶음이 다름)
//  등급: A = 1등 리뷰 1,000↓·월검색 1천↑ / B = 1등 리뷰 3,000↓·월검색 1천↑ / C = 나머지 AI 통과·이름만 들어도 아는 상품
//  비율(10개 기준) A 2 · B 4 · C 4 — 모자라면 다음 등급에서 채운다. 등급 안에서는 기회점수가 높을수록 잘 뽑힌다(가중 무작위)
export async function draw({ seen = [], n = 10, opts = {} } = {}) {
  const r = await scan({ ...opts, full: true });
  const J = loadJudge(), seenSet = new Set(seen);
  if (opts.mode === "pro") return drawPro(r, J, seenSet, n);
  const pool = r.all.filter((k) => J[k.kw]?.v === "ok" && J[k.kw]?.easy === true && !k.careful);
  const tierOf = (k) => (k.m1 >= 1000 && k.mx <= 1000 ? "A" : k.m1 >= 1000 && k.mx <= 3000 ? "B" : "C");
  const fresh = pool.filter((k) => !seenSet.has(k.kw));
  const byTier = { A: [], B: [], C: [] };
  for (const k of fresh) byTier[tierOf(k)].push(k);
  const want = { A: Math.round(n * 0.2), B: Math.round(n * 0.4) }; want.C = n - want.A - want.B;
  const pickW = (arr, m) => { // 가중 무작위(점수의 제곱근) m개
    const a = arr.map((k) => ({ k, w: Math.sqrt(k.m1 / (k.mx + 10)) + 0.05 })), out = [];
    while (out.length < m && a.length) { let t = a.reduce((s, x) => s + x.w, 0) * Math.random(), i = 0; while (i < a.length - 1 && (t -= a[i].w) > 0) i++; out.push(a.splice(i, 1)[0].k); }
    return out;
  };
  const out = [];
  let carry = 0;
  for (const t of ["A", "B", "C"]) { const got = pickW(byTier[t], want[t] + carry); carry = want[t] + carry - got.length; out.push(...got.map((k) => ({ ...k, ai: J[k.kw], tier: t }))); }
  if (out.length < n) { const left = fresh.filter((k) => !out.some((o) => o.kw === k.kw)); out.push(...pickW(left, n - out.length).map((k) => ({ ...k, ai: J[k.kw], tier: tierOf(k) }))); }
  const order = { A: 0, B: 1, C: 2 };
  out.sort((a, b) => order[a.tier] - order[b.tier] || b.m1 / (b.mx + 10) - a.m1 / (a.mx + 10));
  return { month: r.month, items: out, pool: pool.length, fresh: fresh.length - out.length, tiers: { A: byTier.A.length, B: byTier.B.length, C: byTier.C.length } };
}

// 🧭 팔아봤어요(2026-10-12 대표님 결정): 1등 리뷰 1,000개 이상 = 이미 팔리는 게 확인된 시장만. 이름만 듣고 아는 상품(easy)일 필요는 없음
//  등급: L = 1등 리뷰 5,000~50,000(큰 시장) / M = 1,000~5,000(검증된 시장) · 반반 · 등급 안에서는 시장 크기(평균가 × 1등 리뷰)가 클수록 잘 뽑힌다
//  카드가 채워지면 Wing 실판매로 1등 하루 판매 · 리뷰 500개+ 상품 수 · 틈을 보여 주고, 틈 판매량 순으로 다시 줄 세운다(reco.js)
function drawPro(r, J, seenSet, n) {
  const pool = r.all.filter((k) => J[k.kw]?.v === "ok" && k.mx >= 1000 && k.mx <= 50000); // 1등 리뷰 5만 넘는 곳(뚫어뻥 16만)은 사실상 못 들어감
  const tierOf = (k) => (k.mx >= 5000 ? "L" : "M");
  const fresh = pool.filter((k) => !seenSet.has(k.kw));
  const byTier = { L: [], M: [] };
  for (const k of fresh) byTier[tierOf(k)].push(k);
  const pickW = (arr, m) => { // 가중 무작위(시장 크기의 제곱근) m개
    const a = arr.map((k) => ({ k, w: Math.sqrt((k.price || 0) * k.mx) + 1 })), out = [];
    while (out.length < m && a.length) { let t = a.reduce((s, x) => s + x.w, 0) * Math.random(), i = 0; while (i < a.length - 1 && (t -= a[i].w) > 0) i++; out.push(a.splice(i, 1)[0].k); }
    return out;
  };
  const want = { L: Math.round(n / 2) }; want.M = n - want.L;
  const out = [];
  let carry = 0;
  for (const t of ["L", "M"]) { const got = pickW(byTier[t], want[t] + carry); carry = want[t] + carry - got.length; out.push(...got.map((k) => ({ ...k, ai: J[k.kw], tier: t, mode: "pro" }))); }
  if (out.length < n) { const left = byTier.L.filter((k) => !out.some((o) => o.kw === k.kw)); out.push(...pickW(left, n - out.length).map((k) => ({ ...k, ai: J[k.kw], tier: "L", mode: "pro" }))); }
  out.sort((a, b) => (b.price || 0) * b.mx - (a.price || 0) * a.mx);
  return { month: r.month, items: out, pool: pool.length, fresh: fresh.length - out.length, tiers: { L: byTier.L.length, M: byTier.M.length } };
}

// 🧪 실판매 약식 수집용 키워드 30개: "경쟁 약함"(월검색 1천↑·1등 리뷰 1,000↓, 기회점수 순) 15 + "큰 시장"(월검색 1만↑·1등 리뷰 5,000↓, 검색×가격 순) 15
export async function salesPlanPick() {
  const r = await scan({ full: true });
  const J = loadJudge();
  const P = r.all.filter((k) => J[k.kw]?.v === "ok" && J[k.kw]?.easy === true && !k.careful);
  const weak = P.filter((k) => k.m1 >= 1000 && k.mx <= 1000).sort((a, b) => b.m1 / (b.mx + 10) - a.m1 / (a.mx + 10)).slice(0, 15);
  let big = P.filter((k) => k.m1 >= 10000 && k.mx <= 5000).sort((a, b) => b.m1 * b.price - a.m1 * a.price);
  if (big.length < 15) big = [...big, ...P.filter((k) => k.m1 >= 5000 && !big.includes(k) && !weak.includes(k)).sort((a, b) => b.m1 * b.price - a.m1 * a.price)];
  const pick = (k, g) => ({ kw: k.kw, group: g, m1: k.m1, mx: k.mx, price: Math.round(k.price), desc: J[k.kw]?.desc || "" });
  const seen = new Set(weak.map((k) => k.kw));
  return [...weak.map((k) => pick(k, "경쟁 약함")), ...big.filter((k) => !seen.has(k.kw)).slice(0, 15).map((k) => pick(k, "큰 시장"))];
}

// 🏷 유명 브랜드 판별(효자상품 "틈"에서 빼기용): 브랜드 이름으로 시작하는 브랜드 키워드(is_brand)의 월검색 합이 1만 이상
//  = 사람들이 브랜드 이름으로 찾아서 사는 브랜드(나이키·마인드브릿지·지프…). 작은 판매자 상호(젠핏·베네피온)는 DB에 없거나 검색이 적어 안 걸림
//  리뷰가 적어도 이름값으로 팔리므로 "새로 들어가도 팔린다"는 증거가 못 된다(2026-10-11 대표님 지적: 헬스장가방 나이키, 소가죽벨트 마인드브릿지)
export const FAMOUS_M1 = 10000;
let brandDb = null; const brandMemo = new Map();
export async function famousBrands(names = []) {
  const out = new Set();
  const list = [...new Set(names.map((s) => String(s || "").trim().toLowerCase()).filter((s) => s.length >= 2 && !/^브랜드\s*없음$|^없음$|^기타$/.test(s)))];
  if (!list.length) return out;
  if (!brandDb) {
    const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^sellar_\d{4}-\d{2}\.db$/.test(f)).sort() : [];
    if (!files.length) return out;
    const { DatabaseSync } = await import("node:sqlite");
    brandDb = new DatabaseSync(path.join(DIR, files.at(-1)), { readOnly: true });
  }
  const q = brandDb.prepare("select coalesce(sum(m1), 0) s from k where keyword >= ? and keyword < ? and is_brand = 'O'"); // 앞부분 일치(색인 사용)
  for (const b of list) {
    if (!brandMemo.has(b)) brandMemo.set(b, q.get(b, b + "￿").s);
    if (brandMemo.get(b) >= FAMOUS_M1) out.add(b);
  }
  return out;
}
