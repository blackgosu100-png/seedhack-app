// 📄 상세페이지 ① 추출 — 순수 로직 (Electron 의존 없음, node --test 로 검증)
// cn.cjs 의 readDetailRaw() 가 화면에서 그대로 읽어 보낸 raw 를 CONTRACTS 1절 DetailSource 형식으로 다듬는다:
// 이미지 주소 꼬리 제거 · 프로토콜 보완 · data: 제외 · 아이콘(60px 미만) 제외 · 중복 제거 · 개수 제한 · 가격 숫자화.

export const LIMITS = { attrs: 60, options: 30, gallery: 10, detail: 40, text: 20000, title: 200 };
const MIN_PX = 60; // 이보다 작은 그림은 아이콘·구분선으로 본다

// 알리 계열 CDN(그림 주소에 크기·품질 꼬리를 붙이는 곳)
const CDN_RE = /(^|\.)(alicdn\.com|1688\.com|taobao\.com|tmall\.com|taobaocdn\.com|alibaba\.com|aliimg\.com)$/i;

// 출처 판별: 주소의 호스트로
export function siteOf(url) {
  let host = "";
  try { host = new URL(String(url || "")).hostname.toLowerCase(); } catch { return "other"; }
  if (/(^|\.)1688\.com$/.test(host)) return "1688";
  if (/(^|\.)tmall\.(com|hk)$/.test(host)) return "tmall";
  if (/(^|\.)taobao\.com$/.test(host)) return "taobao";
  return "other";
}
// 내려받을 때 붙이는 Referer (출처별)
export function refererFor(source, url) {
  const s = source || siteOf(url);
  if (s === "1688") return "https://detail.1688.com/";
  if (s === "taobao") return "https://item.taobao.com/";
  if (s === "tmall") return "https://detail.tmall.com/";
  if (s === "coupang") return "https://www.coupang.com/";
  if (s === "naver") return "https://smartstore.naver.com/";
  if (s === "ohou") return "https://store.ohou.se/";
  try { return new URL(String(url || "")).origin + "/"; } catch { return ""; }
}

// 그림 주소 정리: 꼬리(`_sum.jpg` `.webp` `_.webp` `_Q90.jpg` `_400x400q90.jpg` …)·`?x-oss-process=` 제거, `//img.alicdn.com` → https, data:/빈 값 → null
export function cleanImageUrl(input) {
  let u = String(input || "").trim();
  if (!u || /^data:/i.test(u) || /^(javascript|blob|about):/i.test(u)) return null;
  if (u.startsWith("//")) u = "https:" + u;
  if (!/^(https?|file):\/\//i.test(u)) return null;
  // 주소 조각으로 나눠 경로 꼬리만 손본다
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  const cdn = CDN_RE.test(parsed.hostname);
  if (parsed.protocol === "http:" && cdn) parsed.protocol = "https:";
  // 질의: CDN 이면 전부(크기·품질 지시), 아니면 x-oss-process 만 뺀다
  if (cdn) parsed.search = "";
  else if (parsed.searchParams.has("x-oss-process")) { parsed.searchParams.delete("x-oss-process"); if (![...parsed.searchParams.keys()].length) parsed.search = ""; }
  parsed.hash = "";
  // 경로: 첫 진짜 확장자(jpg/jpeg/png/gif/bmp) 뒤에 붙은 것(_sum.jpg, _.webp, .webp, _Q90.jpg_.webp …)을 잘라낸다
  // (가장 앞의 확장자가 진짜 — `b.webp_sum.jpg` 는 webp 원본, `b.jpg_.webp` 는 jpg 원본)
  if (/\.(?:html?|php|aspx?|jsp)$/i.test(parsed.pathname)) return null; // 페이지 주소(빈 src 가 풀린 것)는 그림 아님
  // 1688 썸네일 꼬리: `…-0-cib.310x310.jpg` `….search.jpg` `….summ.jpg` → `…-0-cib.jpg`
  if (cdn) parsed.pathname = parsed.pathname.replace(/\.(?:\d{2,4}x\d{2,4}[a-z0-9]*|search|summ|sum)\.(jpe?g|png|webp)$/i, ".$1");
  const m = parsed.pathname.match(/^(.*?\.(?:jpe?g|png|gif|bmp|webp|avif))(?:[_.].*)?$/i);
  if (m) parsed.pathname = m[1];
  let out = parsed.href;
  if (parsed.protocol === "file:") out = out.replace(/\?$/, "");
  return out;
}

const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n : null; };
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// 아이콘 주소: svg, 알리 tps 아이콘(`…-55-tps-15-14.svg`, `-2-tps-20-20.png` 처럼 크기가 이름에 든 것 중 작은 것)
export function isIconUrl(url) {
  const u = String(url || "");
  if (/\.svg(?:$|[?#])/i.test(u)) return true;
  const t = u.match(/-tps-(\d+)-(\d+)\./i);
  return !!(t && (+t[1] < 120 || +t[2] < 120));
}
const tiny = (w, h) => (w != null && w > 0 && w < MIN_PX) || (h != null && h > 0 && h < MIN_PX) || (w === 1 && h === 1);

// 그림 목록 정리: 주소 정리 → data:/빈 값 제외 → 아이콘 제외 → 중복 제거(첫 것 유지, 순서 유지) → 개수 제한. w/h 는 알면(1보다 클 때) 남긴다
export function normalizeImages(list, limit) {
  const out = [], seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const raw = typeof it === "string" ? { url: it } : it || {};
    const url = cleanImageUrl(raw.url);
    if (!url || seen.has(url) || isIconUrl(url)) continue;
    const w = num(raw.w), h = num(raw.h);
    if (tiny(w, h)) continue;
    seen.add(url);
    const o = { url };
    if (raw.from) o.from = String(raw.from).slice(0, 20);
    if (w > 1) o.w = Math.round(w);
    if (h > 1) o.h = Math.round(h);
    out.push(o);
    if (limit && out.length >= limit) break;
  }
  return out;
}

// 가격: {min,max} 또는 "¥12.80 - 15.50" 같은 글자 → { min, max, currency }
export function normalizePrice(p) {
  let vals = [];
  if (p && typeof p === "object") vals = [p.min, p.max].map(num).filter((n) => n != null && n > 0);
  else if (typeof p === "string" || typeof p === "number") vals = [...String(p).matchAll(/(\d{1,6}(?:\.\d{1,2})?)/g)].map((m) => +m[1]).filter((n) => n > 0 && n < 100000);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), currency: "CNY" };
}

// 속성표: [{k_zh,v_zh}] 또는 "名称:值" 글자 → 빈 칸·중복 키 제거, 순서 유지, 최대 60
export function normalizeAttrs(list) {
  const out = [], seen = new Set();
  const push = (k, v) => {
    k = str(k, 40).replace(/[:：]\s*$/, ""); v = str(v, 200);
    if (!k || !v || seen.has(k)) return;
    seen.add(k); out.push({ k_zh: k, v_zh: v });
  };
  if (typeof list === "string") for (const m of list.matchAll(/([^\s:：]{1,20})\s*[:：]\s*([^\n]{1,200})/g)) push(m[1], m[2]);
  else for (const it of Array.isArray(list) ? list : []) { if (it && typeof it === "object") push(it.k_zh ?? it.k, it.v_zh ?? it.v); if (out.length >= LIMITS.attrs) break; }
  return out.slice(0, LIMITS.attrs);
}

const UI_LABEL_RE = /反馈|客服|对比|同款|复制|链接|购买|收藏|分享|举报|合格率|回头率|APP|피드백|고객\s*서비스|비교|복사|링크|구매|공유|신고|적합률|재구매율|상단|›|>/i;
export function normalizeOptions(list) {
  const out = [], seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const label = str(it?.label_zh ?? it?.label, 60);
    const img = cleanImageUrl(it?.img);
    // 안전망(실제 782706077987): 화면 상단·옆 도구줄(상점명·품질 합격률·피드백·고객센터 …)이 옵션으로 잡히던 문제 — 아이콘 그림이 붙었거나 화면 도구 문구면 뺀다
    if (!label || seen.has(label) || isCompanyName(label) || (it?.img && isIconUrl(it.img)) || UI_LABEL_RE.test(label)) continue;
    seen.add(label);
    out.push({ label_zh: label, ...(it?.label_ko ? { label_ko: str(it.label_ko, 60) } : {}), img: img && !isIconUrl(img) ? img : null });
    if (out.length >= LIMITS.options) break;
  }
  return out;
}

export function normalizeShop(s) {
  if (!s || typeof s !== "object") return null;
  const name = str(s.name, 80), years = num(s.years), repeat = num(s.repeat);
  if (!name && years == null && repeat == null) return null;
  return { name, years: years != null ? Math.round(years) : null, repeat: repeat != null ? repeat : null };
}

// 상세 설명 컨테이너를 못 찾을 때의 적응형 규칙(cn.cjs 와 같은 알고리즘):
// 페이지의 모든 그림 중 폭 ≥ minW 인 것을 세로 위치 순으로 늘어놓고, 위아래 간격이 gap 이하이며 가로로 겹치는 "세로로 연속된 묶음" 가운데 가장 긴 것을 고른다.
// candidates: [{ url, w, h, top, left }] (top/left 는 페이지 기준 px)
export function pickDetailImages(candidates, { minW = 400, gap = 300 } = {}) {
  const big = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.url && num(c.w) >= minW && num(c.top) != null)
    .map((c, i) => ({ ...c, w: num(c.w), h: num(c.h) || 0, top: num(c.top), left: num(c.left) || 0, i }))
    .sort((a, b) => a.top - b.top || a.i - b.i);
  let best = [], run = [];
  const overlapX = (a, b) => a.left < b.left + b.w && b.left < a.left + a.w;
  for (const c of big) {
    const prev = run[run.length - 1];
    if (prev && c.top - (prev.top + prev.h) <= gap && overlapX(prev, c)) run.push(c);
    else run = [c];
    if (run.length > best.length) best = run;
  }
  return best.map(({ i, ...c }) => c);
}

// 회사·상점 이름 판별: 상품명 자리에 판매자 회사명이 잡히는 경우(1688 새 화면의 첫 h1 — 2026-10-09 실제 두 건) 걸러내기
// 중국어 원문과 1688 한국어판(유한회사·유한공사 …) 둘 다
export const COMPANY_RE = /(有限责任公司|股份有限公司|有限公司|公司|工厂|厂|商行|贸易|实业|商贸|经营部|旗舰店|专营店|专卖店|유한\s*회사|유한\s*공사|주식\s*회사|회사|공장|상사|무역|상회)$/;
export function isCompanyName(t) { return COMPANY_RE.test(String(t ?? "").replace(/[\s()（）]+$/g, "").trim()); }
// 문서 제목 꼬리 " - 阿里巴巴" 등 제거
export function stripSiteTail(t) { return str(t, 400).replace(/\s*[-—_|｜]\s*(阿里巴巴|1688|淘宝网?|天猫|tmall|taobao|alibaba)[^-—_|｜]*$/i, "").trim(); }
const NAME_ATTR_RE = /^(产品名称|商品名称|品名|产品名|제품명|상품명|품명)$/;
const CATEGORY_ATTR_RE = /^(产品类别|产品类型|品类|类别|제품\s*카테고리|제품\s*유형|카테고리)$/;
// 상품명 고르기: title_zh → titleCandidates → 속성표의 품명 → 속성표의 분류. 회사명은 건너뛰고 첫 회사명은 상점 이름 후보로 돌려준다
export function pickTitle(r, attrs = []) {
  const list = [r.title_zh ?? r.title, ...(Array.isArray(r.titleCandidates) ? r.titleCandidates.map((c) => (typeof c === "string" ? c : c?.t)) : [])]
    .map((t) => stripSiteTail(t).slice(0, LIMITS.title)).filter((t) => t.length >= 2);
  const company = list.find(isCompanyName) || "";
  let title = list.find((t) => !isCompanyName(t)) || "", from = title ? (title === list[0] ? "title" : "candidates") : "";
  if (!title) { const a = attrs.find((x) => NAME_ATTR_RE.test(x.k_zh) && !isCompanyName(x.v_zh)); if (a) { title = a.v_zh; from = "attr:" + a.k_zh; } }
  if (!title) { const a = attrs.find((x) => CATEGORY_ATTR_RE.test(x.k_zh) && !isCompanyName(x.v_zh)); if (a) { title = a.v_zh; from = "attr:" + a.k_zh; } }
  return { title, company, from };
}

// 대표 사진이 2장 미만이면: 상세 이미지 중 정사각형에 가까운(가로세로 비 0.85~1.18, 폭 ≥ 400) 것 = 흰 배경 제품 단독 컷일 가능성이 큰 것을
// 페이지 순서대로 갤러리 후보로 올린다(최대 5장까지 채움, `from: "detail"` 표시 — 상세 목록에서는 빼지 않는다). 크기를 모르는 상세 그림은 쓰지 않는다.
export function fillGallery(gallery, detailImages, { min = 2, upTo = 5 } = {}) {
  const out = [...(gallery || [])];
  if (out.length >= min) return out;
  const have = new Set(out.map((g) => g.url));
  for (const d of detailImages || []) {
    if (out.length >= upTo) break;
    if (have.has(d.url) || !(d.w >= 400 && d.h > 0)) continue;
    const r = d.w / d.h;
    if (r < 0.85 || r > 1.18) continue;
    have.add(d.url);
    out.push({ url: d.url, w: d.w, h: d.h, from: "detail" });
  }
  return out;
}

// raw(cn.cjs readDetailRaw 결과) → DetailSource
export function normalizeSource(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const url = str(r.url, 500);
  const source = ["1688", "taobao", "tmall", "other", ...KO_SOURCES].includes(r.source) ? r.source : siteOf(url);
  const attrs = normalizeAttrs(r.attrs);
  const t = pickTitle(r, attrs);
  let shop = normalizeShop(r.shop);
  if (t.company && !shop?.name) shop = { name: t.company.slice(0, 80), years: shop?.years ?? null, repeat: shop?.repeat ?? null }; // 회사명은 상점 이름으로 옮긴다
  const out = {
    source,
    url,
    offerId: str(r.offerId, 40),
    title_zh: t.title,
    price: normalizePrice(r.price ?? r.priceText),
    attrs,
    options: normalizeOptions(r.options),
    ...(() => { const detailImages = normalizeImages(r.detailImages, LIMITS.detail); return { gallery: fillGallery(normalizeImages(r.gallery, LIMITS.gallery), detailImages), detailImages }; })(),
    detailText_zh: String(r.detailText_zh ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, LIMITS.text),
    shop,
    readAt: num(r.readAt) || Date.now(),
  };
  return r.lang === "ko" || KO_SOURCES.includes(source) ? koSource(out, r) : out;
}
// 한국 판매처(쿠팡·네이버·오늘의집 — site-core.buildKoRaw): 이미 한글이라 _ko 칸을 원문으로 채운다(번역·중국어 지우기 안 함). 가격은 원(KRW)
export const KO_SOURCES = ["coupang", "naver", "ohou"];
function koSource(out, r) {
  const won = (v) => { const n = num(v); return n != null && n >= 100 && n < 1e9 ? Math.round(n) : null; };
  const p = r.price && typeof r.price === "object" ? [won(r.price.min), won(r.price.max)].filter((n) => n != null) : [];
  return {
    ...out, lang: "ko", title_ko: out.title_zh,
    price: p.length ? { min: Math.min(...p), max: Math.max(...p), currency: "KRW" } : null,
    attrs: out.attrs.map((a) => ({ ...a, k_ko: a.k_zh, v_ko: a.v_zh })),
    options: out.options.map((o) => ({ ...o, label_ko: o.label_ko || o.label_zh })),
    detailText_ko: out.detailText_zh,
    ...(r.category ? { category: str(r.category, 40) } : {}),
  };
}

// 그림 분류 이름: v2 = main(대표 사진·썸네일) | sku(옵션 그림) | detail(상세) — Fatkun 같은 다운로더와 같은 3분류.
// v1(예전 이름) = gallery | option | detail. 다른 모듈이 아직 v1 로 거르므로 둘 다 받아들이는 normKind/v1Kind 를 쓴다.
export const KIND_V1 = { main: "gallery", sku: "option", detail: "detail" };
export function normKind(k) { return k === "gallery" ? "main" : k === "option" ? "sku" : k === "main" || k === "sku" ? k : "detail"; }
export function v1Kind(k) { return KIND_V1[normKind(k)]; }
const hasHangul = (t) => /[\uac00-\ud7a3]/.test(t || "");
// 옵션 이름: 원문(중국어)·번역(한글) 둘 다 남긴다. label 은 보여 줄 이름(한글 있으면 한글)
export function skuLabel(o) {
  const zh = str(o?.label_zh ?? o?.label, 60), ko = str(o?.label_ko, 60);
  // 1688 한국어판 화면처럼 "원문" 칸에 한글이 들어오면 번역 칸으로 옮긴다
  if (zh && !ko && hasHangul(zh) && !/[\u4e00-\u9fff]/.test(zh)) return { label_zh: "", label_ko: zh, label: zh };
  return { label_zh: zh, label_ko: ko, label: ko || zh };
}

// 내려받을 그림 목록(id 부여, 페이지 순서 = 대표 사진 → 옵션 → 상세): main g01…, sku o01…, detail d01…
// kinds: "v2"(기본, main/sku/detail) | "v1"(gallery/option/detail). 옵션 그림이 대표 사진과 같은 주소면 sameAs 로 표시(1688 신형은 옵션 그림이 썸네일 끝에도 붙는다)
export function planDownloads(source, { kinds = "v2" } = {}) {
  const pad = (n) => String(n).padStart(2, "0");
  const K = (k) => (kinds === "v1" ? KIND_V1[k] : k);
  const list = [];
  const mainIdByUrl = new Map();
  (source?.gallery || []).forEach((g, i) => { const id = "g" + pad(i + 1); mainIdByUrl.set(g.url, id); list.push({ id, kind: K("main"), url: g.url, w: g.w, h: g.h, ...(g.from ? { from: g.from } : {}) }); });
  let o = 0;
  (source?.options || []).forEach((op) => { if (!op.img) return; const id = "o" + pad(++o); list.push({ id, kind: K("sku"), url: op.img, ...skuLabel(op), ...(mainIdByUrl.has(op.img) ? { sameAs: mainIdByUrl.get(op.img) } : {}) }); });
  (source?.detailImages || []).forEach((d, i) => list.push({ id: "d" + pad(i + 1), kind: K("detail"), url: d.url, w: d.w, h: d.h }));
  return list;
}

// ---- 다운로드 폴더 그대로 쓰기 (Fatkun 등): 파일 이름 접두어로 분류 ----
// main-01.jpg / SKU-01-옵션명.jpg / detail-01.jpg (그 밖에 主图·sku·详情·옵션·상세·gallery·option·g01·o01·d01 도)
const FOLDER_RULES = [
  ["main", /^(?:main|主图|主圖|gallery|thumb|대표|썸네일|g(?=\d))[\s_-]*(\d+)?[\s_-]*(.*)$/i],
  ["sku", /^(?:sku|option|规格|颜色|옵션|o(?=\d))[\s_-]*(\d+)?[\s_-]*(.*)$/i],
  ["detail", /^(?:detail|desc|详情|詳情|상세|d(?=\d))[\s_-]*(\d+)?[\s_-]*(.*)$/i],
];
const IMG_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
// names: 파일 이름 목록 → { main:[{name,n,label}], sku:[...], detail:[...], other:[name] } (번호 순)
export function classifyFolderFiles(names) {
  const out = { main: [], sku: [], detail: [], other: [] };
  for (const name of Array.isArray(names) ? names : []) {
    if (!IMG_EXT_RE.test(name) || name.startsWith(".")) continue;
    const base = name.normalize("NFC").replace(IMG_EXT_RE, "");
    const hit = FOLDER_RULES.find(([, re]) => re.test(base));
    if (!hit) { out.other.push(name); continue; }
    const m = base.match(hit[1]);
    out[hit[0]].push({ name, n: m[1] != null ? +m[1] : null, label: str(m[2], 60) });
  }
  for (const k of ["main", "sku", "detail"]) out[k].sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || a.name.localeCompare(b.name));
  return out;
}
// 폴더 이름 → 상품명: "… - 阿里巴巴" 꼬리 제거
export function titleFromFolder(dirName) { return stripSiteTail(String(dirName || "").normalize("NFC")); }

// 받은 바이트의 형식(앞머리) — jpg/png 은 그대로 저장, 나머지는 png 로 바꿔 저장
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return "";
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "avif";
  return "";
}

// 📄 화면 주소 칸 입력 → 1688 상품 주소. "https://detail.1688.com/offer/123.html?spm=…", "detail.1688.com/offer/123.html", "…?offerId=123", 숫자만(상품번호) 모두 받는다.
// 그 밖(타오바오·검색 결과·빈 값)은 null — 상품 정보는 1688 화면에서 직접 읽으므로 상품 화면 주소여야 한다.
export function offerUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^\d{6,20}$/.test(s)) return `https://detail.1688.com/offer/${s}.html`;
  const m = s.match(/(?:^|\/\/)(?:[\w-]+\.)*1688\.com\/offer\/(\d{6,20})\.html/i) || s.match(/1688\.com\/.*[?&]offerId=(\d{6,20})/i);
  return m ? `https://detail.1688.com/offer/${m[1]}.html` : null;
}
