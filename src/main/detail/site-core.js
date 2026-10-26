// 📄 ▶ 주소로 만들기 — 사이트별 주소 가려내기·상품 번호 뽑기 (순수 함수, Electron 의존 없음 — test/detail/site-core.test.js)
// 1688 은 기존 offerUrl 그대로(바이트 동일). 타오바오·티몰은 1688 탭(같은 로그인)에서, 쿠팡은 쿠팡 탭에서, 네이버·오늘의집은 숨은 창에서 읽는다.
import { offerUrl, pickDetailImages } from "./extract-core.js";

export const SITE_NAME = { "1688": "1688", taobao: "타오바오", tmall: "티몰", coupang: "쿠팡", naver: "네이버", ohou: "오늘의집" };
export const SUPPORTED_TEXT = "1688 · 타오바오/티몰 · 쿠팡 · 네이버 스마트스토어 · 오늘의집";
// 한국 판매처 = 이미 한글 페이지(중국어 지우기·번역 안 함) · 대개 다른 판매자의 사진·글(권리 주의)
export const KO_SITES = ["coupang", "naver", "ohou"];
export const isKoSite = (s) => KO_SITES.includes(String(s || ""));

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const withScheme = (s) => (/^https?:\/\//i.test(s) ? s : /^\/\//.test(s) ? "https:" + s : "https://" + s);

// 붙여 넣은 글(주소·상품번호) → { site, url, id } | { error }. 주소가 섞인 글이면 첫 주소를 쓴다
export function routeProductUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return { error: "주소를 넣어 주세요" };
  const one = offerUrl(raw); // 1688(숫자만 = 1688 상품번호) — 예전 그대로
  if (one) return { site: "1688", url: one, id: one.match(/offer\/(\d+)/)[1] };
  const s = (raw.match(/(?:https?:)?\/\/[^\s"'<>]+/i) || raw.match(/(?:[\w-]+\.)+(?:com|hk|se|kr)\/[^\s"'<>]*/i) || [raw])[0];
  const url = withScheme(s), host = hostOf(url);
  let u; try { u = new URL(url); } catch { return { error: notSupported() }; }
  const q = (k) => u.searchParams.get(k) || "";
  // 타오바오·티몰: item.taobao.com/item.htm?id= · detail.tmall.com(.hk) · world/m/h5/a.m 변형 → 상품번호
  if (/(^|\.)(taobao\.com|tmall\.com|tmall\.hk)$/.test(host)) {
    const id = (url.match(/[?&#](?:id|item_id|itemId|itemIds)=(\d{6,})/) || url.match(/\/item\/(\d{6,})\.htm/) || url.match(/\/i(\d{6,})\.htm/) || [])[1];
    if (!id) return { error: "타오바오·티몰 상품 화면 주소가 아닙니다 — 예) https://item.taobao.com/item.htm?id=123456789" };
    const tmall = /tmall\./.test(host);
    return { site: tmall ? "tmall" : "taobao", url: tmall ? `https://detail.tmall.com/item.htm?id=${id}` : `https://item.taobao.com/item.htm?id=${id}`, id };
  }
  // 쿠팡: www/m.coupang.com/vp|vm/products/숫자 (Wing·검색·기획전 주소는 아님)
  if (/(^|\.)coupang\.com$/.test(host)) {
    if (/^wing\./.test(host)) return { error: "Wing 주소가 아니라 쿠팡 상품 화면 주소를 넣어 주세요 — 예) https://www.coupang.com/vp/products/123456" };
    const id = (u.pathname.match(/\/v[pm]\/products\/(\d{3,})/) || [])[1];
    if (!id) return { error: "쿠팡 상품 화면 주소가 아닙니다 — 예) https://www.coupang.com/vp/products/123456" };
    const p = new URLSearchParams(); for (const k of ["itemId", "vendorItemId"]) if (/^\d+$/.test(q(k))) p.set(k, q(k));
    return { site: "coupang", url: `https://www.coupang.com/vp/products/${id}${p.toString() ? "?" + p : ""}`, id };
  }
  // 네이버: smartstore.naver.com/<가게>/products/숫자 · brand.naver.com/<가게>/products/숫자 (m. 포함)
  if (/(^|\.)(smartstore|brand)\.naver\.com$/.test(host)) {
    const m = u.pathname.match(/^\/([\w.-]+)\/products\/(\d{3,})/);
    if (!m) return { error: "네이버 스마트스토어 상품 화면 주소가 아닙니다 — 예) https://smartstore.naver.com/가게이름/products/123456" };
    return { site: "naver", url: `https://${/brand\./.test(host) ? "brand" : "smartstore"}.naver.com/${m[1]}/products/${m[2]}`, id: m[2], store: m[1] };
  }
  // 오늘의집: ohou.se/productions/숫자(/selling) · store.ohou.se/goods/숫자
  if (/(^|\.)ohou\.se$/.test(host)) {
    const id = (u.pathname.match(/\/(?:productions|goods)\/(\d{3,})/) || [])[1];
    if (!id) return { error: "오늘의집 상품 화면 주소가 아닙니다 — 예) https://ohou.se/productions/123456/selling" };
    return { site: "ohou", url: `https://store.ohou.se/goods/${id}`, id };
  }
  return { error: notSupported() };
}
function notSupported() { return `지원하지 않는 주소입니다 — ${SUPPORTED_TEXT} 상품 주소를 넣어 주세요`; }

// 📄 화면 주소 칸의 사이트 칩(주소만 보고 — 상품 화면 주소인지는 routeProductUrl 이 따진다)
export function siteOfText(input) {
  const s = String(input || "").trim();
  if (/^\d{6,20}$/.test(s) || /1688\.com/i.test(s)) return "1688";
  if (/tmall\.(com|hk)/i.test(s)) return "tmall";
  if (/taobao\.com/i.test(s)) return "taobao";
  if (/coupang\.com/i.test(s)) return "coupang";
  if (/(smartstore|brand)\.naver\.com/i.test(s)) return "naver";
  if (/ohou\.se/i.test(s)) return "ohou";
  return "";
}

// 1688 탭(타오바오 화면)에서 executeJavaScript 로 돌리는 상태 읽기 — 결과를 cnWall 에 넣는다
export const CN_WALL_PROBE_JS = `({ url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 2000), hasSlider: !!document.querySelector('#nc_1_wrapper, .nc-container, #baxia-dialog-content, .baxia-dialog, iframe[src*="punish"], iframe[src*="captcha"]') })`;
// 타오바오·티몰 화면 상태(위 CN_WALL_PROBE_JS 결과) → 로그인/슬라이더 인증이면 사유, 아니면 null
export function cnWall({ url = "", title = "", text = "", hasSlider = false } = {}) {
  const h = hostOf(url);
  if (/^(login|passport)\.|(^|\.)login\.(taobao|tmall)\.com$/.test(h) || /\/member\/login|login\.htm/i.test(url)) return "login";
  if (hasSlider || /punish|_____tmd_____|x5sec|captcha|baxia/i.test(url) || /滑动验证|拖动滑块|请按住滑块|验证码|安全验证|访问被拒绝|亲，请登录/.test(String(title) + " " + String(text).slice(0, 2000))) return "slider";
  return null;
}

// ---- 한국 판매처(쿠팡·네이버·오늘의집): 화면에서 모은 것(site-read.js collectPage) → raw(normalizeSource 입력) ----
// 화면 읽기는 그림 주소·크기·위치·구역(gallery/detail)만 모으고, 고르기·정리는 여기서 한다(fixture 로 검증).

// 원본 크기 주소: 쿠팡 썸네일(/thumbnails/remote/<크기>/image/…) → q89(원본), 오늘의집·네이버는 크기 질의(?w=·?type=) 제거
export function cleanKoImageUrl(site, input) {
  let u = String(input || "").trim();
  if (!u || /^(data|blob|javascript):/i.test(u)) return "";
  if (u.startsWith("//")) u = "https:" + u;
  if (!/^https?:\/\//i.test(u)) return "";
  if (/coupangcdn\.com\//i.test(u)) return u.replace(/\/thumbnails\/remote\/[^/]+\/image\//i, "/thumbnails/remote/q89/image/").replace(/[?#].*$/, "");
  if (/(ohousecdn\.com|ohou\.se|ohouse\.com)\//i.test(u)) return u.replace(/[?#].*$/, "");
  if (/pstatic\.net\//i.test(u)) return u.replace(/[?#].*$/, "");
  return u.replace(/#.*$/, "");
}
// 같은 그림 판별 열쇠(크기 꼬리·질의 무시)
export const koImageKey = (site, u) => cleanKoImageUrl(site, u).replace(/^https?:\/\/[^/]+/, "").replace(/\/thumbnails\/remote\/[^/]+\/image\//, "/image/").toLowerCase();
// 화면 장식(로고·배지·배너·공지·아이콘) 그림
export function isKoUiImage(site, url, w = 0, h = 0) {
  const u = String(url || "");
  if (!u || /\.svg(?:$|[?#])/i.test(u)) return true; // gif 는 상세 움짤일 수 있어 크기로만 거른다
  if (/(^|[/_.-])(logo|badge|icon|ico|sprite|btn|button|banner|emoticon|avatar|profile)([/_.-]|$)/i.test(u)) return true;
  if (site === "coupang" && /coupangcdn\.com\/image\/(coupang|cmg)\//i.test(u)) return true; // 로켓배송·직구 배지, 공통 그림
  if (site === "ohou" && /\/(notice|store-feed|pdp-promotion-banner|banners?|static|users\/profile_images)\//i.test(u)) return true; // 오늘의집 공지·기획전 띠
  if (site === "naver" && /(static|ssl)\.pstatic\.net\/(static|sstatic)|\/(banner|event)\//i.test(u)) return true;
  if (w && h && (w < 120 || h < 60)) return true;
  return false;
}
const RIGHTS_KEY_RE = /상호|대표자|사업장|사업자|통신판매|전화|연락처|고객센터|이메일|e-?mail|주소|소재지|반품|교환|배송|보내실|환불|청약|A\/S|AS\s*책임|지연배상|품질보증기준|소비자\s*상담/i;
// 상품정보 제공고시 표 → 상품 사실만(판매자 연락처·주소·배송/반품 규정은 뺀다)
export function cleanKoAttrs(list) {
  const out = [], seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const k = String(it?.k ?? it?.k_zh ?? "").replace(/\s+/g, " ").trim().replace(/[:：]$/, ""), v = String(it?.v ?? it?.v_zh ?? "").replace(/\s+/g, " ").trim();
    if (!k || !v || k.length > 40 || seen.has(k) || RIGHTS_KEY_RE.test(k)) continue;
    if (/^(상품\s*상세\s*참조|상세\s*페이지\s*참조|상세\s*설명\s*참조|해당\s*(사항\s*)?없음|\.|-|없음)$/.test(v)) continue;
    if (/\d{2,4}-\d{3,4}-\d{4}|@[\w-]+\.[a-z]{2,}/i.test(v)) continue; // 전화·메일
    seen.add(k); out.push({ k, v: v.slice(0, 200) });
    if (out.length >= 40) break;
  }
  return out;
}
// 옵션 글: 꼬리 가격 "(12,900 ~ 71,800원)" "(+1,000원)" · 품절 표시 제거
export function cleanKoOption(t) { return String(t || "").replace(/\s+/g, " ").replace(/\s*\(\s*[+\-]?\s*[\d,]+\s*원?(?:\s*~\s*[+\-]?\s*[\d,]+\s*원)?\s*\)\s*$/, "").replace(/\s*\[?품절\]?\s*$/, "").trim().slice(0, 60); }
// 제목 꼬리(" | 쿠팡", " | 오늘의집 쇼핑", " : 네이버 쇼핑", " : 가게이름")와 카테고리 머리("식탁보·러너 > ") 제거
export function cleanKoTitle(t, site) {
  let s = String(t || "").replace(/\s+/g, " ").trim();
  s = s.replace(/\s*[|:]\s*(쿠팡!?|오늘의집(?:\s*쇼핑)?|네이버(?:\s*쇼핑|\s*스마트스토어)?)\s*$/i, "");
  if (site === "naver") s = s.replace(/\s+:\s+[^:]{1,30}$/, "");
  if (site === "ohou") s = s.replace(/^[^>]{1,30}\s>\s/, "");
  s = s.replace(/\s*-\s*[^-]{1,20}\/[^-]{1,20}\s*\|?\s*$/, (m) => (site === "coupang" ? "" : m)); // 쿠팡 문서 제목 "… - 주방수납바구니/바스켓"
  return s.trim().slice(0, 200);
}
const won = (v) => { const n = Number(String(v ?? "").replace(/[^\d]/g, "")); return n >= 100 && n < 1e9 ? n : null; };

// 네이버 스마트스토어 window.__PRELOADED_STATE__ (simpleProductForDetailPage.A · product.A) → 제목·대표 사진·옵션·고시 정보·가격
export function parseNaverState(st) {
  const s = st?.simpleProductForDetailPage?.A || {}, p = st?.product?.A || {};
  const name = String(p.name || s.dispName || s.name || "").trim();
  const gallery = [];
  const imgs = Array.isArray(p.productImages) && p.productImages.length ? p.productImages : null;
  if (imgs) [...imgs].sort((a, b) => (a.imageType === "REPRESENTATIVE" ? -1 : 0) - (b.imageType === "REPRESENTATIVE" ? -1 : 0) || (a.order ?? 0) - (b.order ?? 0)).forEach((i) => i?.url && gallery.push({ url: i.url, w: i.width || 0, h: i.height || 0 }));
  else { if (s.representativeImageUrl) gallery.push({ url: s.representativeImageUrl, w: s.representativeImageWidth || 0, h: s.representativeImageHeight || 0 }); for (const u of s.optionalImageUrls || []) gallery.push({ url: u }); }
  const options = [];
  for (const c of Array.isArray(p.optionCombinations) ? p.optionCombinations : []) { const t = [c.optionName1, c.optionName2, c.optionName3, c.optionName4].filter(Boolean).join(" / "); if (t) options.push(t); }
  if (!options.length) for (const g of Array.isArray(p.options) ? p.options : Array.isArray(s.optionStandards) ? s.optionStandards : []) for (const v of g?.optionItems || g?.values || []) { const t = v?.optionName || v?.name || v?.value; if (t) options.push(String(t)); }
  const attrs = [];
  const notice = p.productInfoProvidedNoticeView?.basic || s.productInfoProvidedNoticeView?.basic;
  const flat = (o) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === "object") flat(v); else attrs.push({ k, v: String(v ?? "") }); } };
  if (notice) flat(notice);
  const ns = p.naverShoppingSearchInfo || s.naverShoppingSearchInfo || {};
  if (ns.brandName) attrs.push({ k: "브랜드", v: ns.brandName });
  if (ns.manufacturerName) attrs.push({ k: "제조사", v: ns.manufacturerName });
  if (ns.modelName) attrs.push({ k: "모델명", v: ns.modelName });
  const cat = p.category?.wholeCategoryName || s.category?.wholeCategoryName || "";
  const price = won(p.discountedSalePrice) || won(s.dispSalePrice) || won(s.salePrice) || won(p.salePrice);
  return { title: name, gallery, options: [...new Set(options)], attrs, category: String(cat).split(">").pop() || "", price, text: s.detailContents?.detailContentText || p.detailContents?.detailContentText || "" };
}
// JSON-LD Product(쿠팡·오늘의집 등 공용) → 제목·대표 사진·가격
export function parseLdProduct(list) {
  const all = []; const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk); if (o["@graph"]) walk(o["@graph"]); all.push(o); };
  walk(list);
  const p = all.find((o) => /Product/i.test(String(o["@type"] || "")));
  if (!p) return null;
  const imgs = (Array.isArray(p.image) ? p.image : p.image ? [p.image] : []).map((x) => (typeof x === "string" ? x : x?.url || x?.contentUrl)).filter(Boolean);
  const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers || {};
  return { title: String(p.name || "").trim(), images: imgs, price: won(offers?.price) || won(offers?.lowPrice) || won(offers?.priceSpecification?.price), brand: typeof p.brand === "string" ? p.brand : p.brand?.name || "", text: String(p.description || "") };
}

// 화면 상태 → 막힘 사유: login(네이버 로그인 요구) · blocked(접속 제한·429) · captcha(보안 확인) · notfound · null
export function koWall(site, { url = "", title = "", text = "" } = {}) {
  const h = hostOf(url), t = String(title || ""), x = String(text || "").slice(0, 3000);
  if (/^nid\.naver\.com$/.test(h) || /^(login|accounts)\./.test(h)) return "login";
  if (/captcha|ncpt\.naver|wcpt|recaptcha/i.test(url) || /보안\s*확인|자동입력\s*방지|로봇이\s*아닙니다|captcha/i.test(t + " " + x.slice(0, 800))) return "captcha";
  if (/Access Denied|사용권한이 없습니다|권한이 제한된 페이지|비정상적인 접근|현재 서비스 접속이 불가|에러페이지|Too Many Requests/i.test(t + " " + x.slice(0, 1500))) return "blocked";
  if (/존재하지 않는|판매(가)? 종료|삭제된 상품|페이지를 찾을 수 없|운영되고 있지 않습니다/.test(t + " " + x.slice(0, 1500))) return "notfound";
  return null;
}
export function koWallMessage(site, wall) {
  const n = SITE_NAME[site] || site;
  if (wall === "notfound") return `${n} 상품 화면이 없습니다(판매 종료·삭제) — 주소를 확인해 주세요`;
  if (site === "coupang") return "쿠팡이 잠시 막았습니다 — 쿠팡 탭에서 상품 화면이 보이는지 확인하고 잠시 뒤 다시 눌러 주세요";
  if (wall === "login") return `${n}가 로그인을 요구합니다 — 「보이는 창으로 열기」에서 한 번 로그인한 뒤 다시 눌러 주세요`;
  return `${n}가 보안 확인을 요구합니다 — 「보이는 창으로 열기」에서 한 번 넘긴 뒤 다시 눌러 주세요`;
}

// collectPage 결과 → raw(normalizeSource 입력, lang:"ko"). page = { url, title, h1, og:{title,image,description}, ld:[…], state, imgs:[{u,w,h,rw,rh,top,left,zone}], attrs:[{k,v}], options:[…], text, coupang:{images,name,category} }
export function buildKoRaw(site, page = {}, { id = "" } = {}) {
  const P = page || {}, ld = parseLdProduct(P.ld || []), nv = site === "naver" && P.state ? parseNaverState(P.state) : null;
  const key = (u) => koImageKey(site, u);
  // 구역: 화면 선택자(zone) + 주소 규칙 — 오늘의집 상세는 /productions/descriptions/, 대표는 위쪽의 /productions/ · 네이버 대표는 위쪽 shop-phinf
  const zoneOf = (x) => {
    if (site === "ohou" && /\/productions\/descriptions\//i.test(x.url)) return "detail";
    if (x.zone) return x.zone;
    if (site === "ohou" && /\/productions\//i.test(x.url) && x.top < 1000) return "gallery";
    if (site === "naver" && /shop-phinf\.pstatic\.net/i.test(x.url) && x.top < 1000 && x.left < 700) return "gallery";
    return "";
  };
  const imgs = (Array.isArray(P.imgs) ? P.imgs : []).map((x) => ({ ...x, url: cleanKoImageUrl(site, x.u || x.url) })).filter((x) => x.url).map((x) => ({ ...x, zone: zoneOf(x) })).filter((x) => !isKoUiImage(site, x.url, x.zone === "gallery" ? 0 : x.w, x.zone === "gallery" ? 0 : x.h)); // 대표 썸네일은 작게 그려져도 원본 주소로 받으니 크기로 거르지 않는다
  // 대표 사진: JSON(네이버 상태·JSON-LD) → 화면 대표 구역 → og:image
  const gallery = [], gseen = new Set();
  const gpush = (u, w, h) => { const url = cleanKoImageUrl(site, u); if (!url || isKoUiImage(site, url) || gseen.has(key(url))) return; gseen.add(key(url)); gallery.push({ url, ...(w > 1 ? { w } : {}), ...(h > 1 ? { h } : {}) }); };
  if (site === "ohou" && P.og?.image) gpush(P.og.image); // 오늘의집 대표 사진 = og:image(돌림 화면은 마지막 장 복제가 앞에 온다)
  (nv?.gallery || []).forEach((g) => gpush(g.url, g.w, g.h));
  (ld?.images || []).forEach((u) => gpush(u));
  imgs.filter((x) => x.zone === "gallery").forEach((x) => gpush(x.url));
  if (!gallery.length && P.og?.image) gpush(P.og.image);
  // 상세: 쿠팡은 🧲 템플릿 저장과 같은 목록(coupang.cjs collectDetailImages) → 화면 상세 구역 → 못 찾으면 세로로 이어진 큰 그림 묶음(pickDetailImages)
  const detail = [], dseen = new Set(gseen);
  const dpush = (u, w, h) => { const url = cleanKoImageUrl(site, u); if (!url || isKoUiImage(site, url, w, h) || dseen.has(key(url))) return; dseen.add(key(url)); detail.push({ url, ...(w > 1 ? { w } : {}), ...(h > 1 ? { h } : {}) }); };
  (P.coupang?.images || []).forEach((u) => dpush(u));
  // 구역(선택자·주소 규칙)에 든 것 + 구역 밖에서 세로로 이어진 큰 그림 묶음(가게가 직접 올린 주소가 달라도 — 오늘의집 common-product-images 등) → 위치 순
  const zoned = imgs.filter((x) => x.zone === "detail");
  const run = pickDetailImages(imgs.filter((x) => !gseen.has(key(x.url)) && !x.zone).map((x) => ({ url: x.url, w: x.rw, h: x.rh, top: x.top, left: x.left, nw: x.w, nh: x.h })), { minW: 500, gap: 400 });
  const runOk = run.length >= 2 || (zoned.length && run.length >= 1 && zoned.some((z) => Math.abs(z.top - run[0].top) < 3000));
  [...zoned.map((x) => ({ url: x.url, nw: x.w, nh: x.h, top: x.top })), ...(runOk ? run : [])].sort((a, b) => a.top - b.top).forEach((x) => dpush(x.url, x.nw, x.nh));
  const how = [zoned.length ? `구역 ${zoned.length}` : "", runOk ? `묶음 ${run.length}` : ""].filter(Boolean).join("+");
  const title = cleanKoTitle(nv?.title || ld?.title || P.og?.title || P.h1 || P.coupang?.name || P.title, site);
  const attrs = cleanKoAttrs([...(nv?.attrs || []), ...(P.attrs || []), ...(ld?.brand ? [{ k: "브랜드", v: ld.brand }] : [])]);
  const options = [...new Set([...(nv?.options || []), ...(P.options || [])].map(cleanKoOption).filter((t) => t && t.length >= 1 && !/^(선택|옵션|추가상품|선택\s*안\s*함)/.test(t)))].slice(0, 30);
  const priceN = nv?.price || ld?.price || won((String(P.og?.description || "").match(/([\d,]{3,})원/) || [])[1]);
  const text = [P.text, nv?.text, ld?.text && !/^쿠팡에서 .* 구매하고/.test(ld.text) ? ld.text : ""].filter(Boolean).join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
  return {
    source: site, lang: "ko", url: P.url || "", offerId: String(id || ""), title_zh: title, title_ko: title,
    price: priceN ? { min: priceN, max: priceN, currency: "KRW" } : null,
    attrs: attrs.map((a) => ({ k_zh: a.k, v_zh: a.v })), options: options.map((t) => ({ label_zh: t, label_ko: t, img: null })),
    gallery, detailImages: detail, detailText_zh: text, category: nv?.category || P.coupang?.category?.split(">").pop() || "", readAt: Date.now(), how: `${SITE_NAME[site]} ${how || "구역 없음"} · 대표 ${gallery.length} · 상세 ${detail.length}`,
  };
}
