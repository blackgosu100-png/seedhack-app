// ▶ 주소로 만들기 — 사이트 주소 가려내기(site-core.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeProductUrl, siteOfText, cnWall, isKoSite } from "../../src/main/detail/site-core.js";
import { offerUrl } from "../../src/main/detail/extract-core.js";

test("1688 은 예전 offerUrl 과 똑같다(상품번호만·주소·offerId)", () => {
  for (const s of ["123456789", "https://detail.1688.com/offer/123456789.html?spm=a", "detail.1688.com/offer/123456789.html", "https://m.1688.com/x?offerId=123456789"]) {
    const r = routeProductUrl(s);
    assert.equal(r.site, "1688"); assert.equal(r.url, offerUrl(s)); assert.equal(r.id, "123456789");
  }
});
test("타오바오·티몰: 여러 주소 모양 → 상품번호 · 표준 주소", () => {
  const cases = [
    ["https://item.taobao.com/item.htm?spm=a21n57&id=712345678901&ns=1", "taobao"],
    ["item.taobao.com/item.htm?id=712345678901", "taobao"],
    ["https://world.taobao.com/item/712345678901.htm", "taobao"],
    ["https://h5.m.taobao.com/awp/core/detail.htm?id=712345678901", "taobao"],
    ["https://a.m.taobao.com/i712345678901.htm", "taobao"],
    ["https://detail.tmall.com/item.htm?abbucket=8&id=712345678901&skuId=1", "tmall"],
    ["https://detail.tmall.hk/hk/item.htm?id=712345678901", "tmall"],
    ["https://chaoshi.detail.tmall.com/item.htm?id=712345678901", "tmall"],
    ["이거 봐 https://item.taobao.com/item.htm?id=712345678901 좋음", "taobao"],
  ];
  for (const [s, site] of cases) {
    const r = routeProductUrl(s);
    assert.equal(r.site, site, s); assert.equal(r.id, "712345678901", s);
    assert.equal(r.url, site === "tmall" ? "https://detail.tmall.com/item.htm?id=712345678901" : "https://item.taobao.com/item.htm?id=712345678901");
  }
  assert.match(routeProductUrl("https://s.taobao.com/search?q=收纳").error, /타오바오·티몰 상품 화면 주소가 아닙니다/);
});
test("쿠팡·네이버·오늘의집", () => {
  assert.deepEqual(routeProductUrl("https://www.coupang.com/vp/products/9516629140?itemId=1&vendorItemId=2&q=x"), { site: "coupang", url: "https://www.coupang.com/vp/products/9516629140?itemId=1&vendorItemId=2", id: "9516629140" });
  assert.equal(routeProductUrl("https://m.coupang.com/vm/products/9516629140").url, "https://www.coupang.com/vp/products/9516629140");
  assert.match(routeProductUrl("https://wing.coupang.com/vp/products/1").error, /Wing/);
  assert.match(routeProductUrl("https://www.coupang.com/np/search?q=x").error, /쿠팡 상품 화면 주소가 아닙니다/);
  assert.deepEqual(routeProductUrl("https://smartstore.naver.com/oneeveryday/products/10202933361?NaPm=ct"), { site: "naver", url: "https://smartstore.naver.com/oneeveryday/products/10202933361", id: "10202933361", store: "oneeveryday" });
  assert.equal(routeProductUrl("m.smartstore.naver.com/abc/products/123456").url, "https://smartstore.naver.com/abc/products/123456");
  assert.equal(routeProductUrl("https://brand.naver.com/lg/products/123456").url, "https://brand.naver.com/lg/products/123456");
  assert.equal(routeProductUrl("https://ohou.se/productions/1026292/selling?affect_type=x").url, "https://store.ohou.se/goods/1026292");
  assert.equal(routeProductUrl("https://store.ohou.se/goods/1026292").id, "1026292");
  assert.match(routeProductUrl("https://www.11st.co.kr/products/1").error, /지원하지 않는 주소.*오늘의집/);
  assert.match(routeProductUrl("").error, /주소를 넣어/);
  assert.ok(isKoSite("naver") && isKoSite("ohou") && isKoSite("coupang") && !isKoSite("taobao") && !isKoSite("1688"));
});
test("사이트 칩(siteOfText)", () => {
  assert.equal(siteOfText("123456789"), "1688");
  assert.equal(siteOfText("https://detail.tmall.com/item.htm?id=1"), "tmall");
  assert.equal(siteOfText("item.taobao.com/x"), "taobao");
  assert.equal(siteOfText("https://www.coupang.com/vp/products/1"), "coupang");
  assert.equal(siteOfText("smartstore.naver.com/a"), "naver");
  assert.equal(siteOfText("ohou.se/productions/1"), "ohou");
  assert.equal(siteOfText("hello"), "");
});
test("타오바오 로그인·슬라이더 화면 가려내기(cnWall)", () => {
  assert.equal(cnWall({ url: "https://login.taobao.com/havanaone/login/login.htm?redirectURL=x" }), "login");
  assert.equal(cnWall({ url: "https://login.tmall.com/?redirectURL=x" }), "login");
  assert.equal(cnWall({ url: "https://item.taobao.com/item.htm?id=1", hasSlider: true }), "slider");
  assert.equal(cnWall({ url: "https://detail.tmall.com/item.htm/_____tmd_____/punish?x5secdata=1" }), "slider");
  assert.equal(cnWall({ url: "https://item.taobao.com/item.htm?id=1", text: "亲，请拖动滑块完成验证 滑动验证" }), "slider");
  assert.equal(cnWall({ url: "https://item.taobao.com/item.htm?id=1", title: "加厚脏衣篮-淘宝网", text: "宝贝详情 参数信息" }), null);
});

// ---- 한국 판매처: 실제 화면에서 모은 것(fixture/sites/*.json)으로 고르기·정리 검사 ----
import fs from "node:fs";
import { buildKoRaw, cleanKoImageUrl, cleanKoOption, cleanKoAttrs, koWall, parseNaverState } from "../../src/main/detail/site-core.js";
import { normalizeSource } from "../../src/main/detail/extract-core.js";
const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixture/sites/${n}.json`, import.meta.url), "utf8"));
const built = (n) => { const f = fx(n); return normalizeSource(buildKoRaw(f.site, f.page, { id: f.id })); };

test("원본 크기 주소: 쿠팡 q89 · 오늘의집/네이버 크기 질의 제거", () => {
  assert.equal(cleanKoImageUrl("coupang", "//thumbnail7.coupangcdn.com/thumbnails/remote/48x48ex/image/vendor_inventory/3b02/a.PNG"), "https://thumbnail7.coupangcdn.com/thumbnails/remote/q89/image/vendor_inventory/3b02/a.PNG");
  assert.equal(cleanKoImageUrl("ohou", "https://prs.ohousecdn.com/apne2/any/uploads/productions/v1-1.jpg?w=72&h=72&c=c"), "https://prs.ohousecdn.com/apne2/any/uploads/productions/v1-1.jpg");
  assert.equal(cleanKoImageUrl("naver", "https://shop-phinf.pstatic.net/2021/a.jpg?type=w860"), "https://shop-phinf.pstatic.net/2021/a.jpg");
  assert.equal(cleanKoImageUrl("naver", "data:image/png;base64,xx"), "");
});
test("옵션 꼬리 가격·고시 표의 판매자 연락처 제거", () => {
  assert.equal(cleanKoOption("양면-1 (그린+그레이) (12,900 ~ 71,800원)"), "양면-1 (그린+그레이)");
  assert.equal(cleanKoOption("대형 (+3,000원)"), "대형");
  const a = cleanKoAttrs([{ k: "품명 및 모델명", v: "수납함" }, { k: "A/S 책임자와 전화번호", v: "070-1234-5678" }, { k: "제조국", v: "중국" }, { k: "E-mail", v: "a@b.com" }, { k: "제조자", v: "상품상세참조" }, { k: "판매원", v: "문의 010-1111-2222" }, { k: "배송비", v: "3,000원" }]);
  assert.deepEqual(a.map((x) => x.k), ["품명 및 모델명", "제조국"]);
});
test("막힘 화면 가려내기(koWall)", () => {
  assert.equal(koWall("naver", { url: "https://nid.naver.com/nidlogin.login?url=x", title: "NAVER 로그인" }), "login");
  assert.equal(koWall("naver", { url: "https://smartstore.naver.com/a/products/1", title: "[에러] 에러페이지 - 시스템오류", text: "현재 서비스 접속이 불가합니다." }), "blocked");
  assert.equal(koWall("coupang", { url: "https://www.coupang.com/vp/products/1", title: "Access Denied" }), "blocked");
  assert.equal(koWall("ohou", { url: "https://store.ohou.se/goods/1", title: "보안 확인", text: "자동입력 방지" }), "captcha");
  assert.equal(koWall("naver", { url: "https://brand.naver.com/x", title: "현재 운영되고 있지 않습니다." }), "notfound");
  assert.equal(koWall("ohou", { url: "https://store.ohou.se/goods/1", title: "식탁보 | 오늘의집 쇼핑", text: "상품정보 리뷰 문의" }), null);
});
test("오늘의집 1026292(실페이지): 대표 = og 먼저 · 상세 = descriptions · 공지·기획전 띠·추천 상품 없음", () => {
  const s = built("ohou-1026292"), f = fx("ohou-1026292");
  assert.equal(s.source, "ohou"); assert.equal(s.lang, "ko");
  assert.equal(s.title_ko, "항균 방수 가죽 식탁보 테이블보 식탁 테이블 매트 커버");
  assert.deepEqual(s.price, { min: 12900, max: 12900, currency: "KRW" });
  assert.match(s.gallery[0].url, /v1-415995895439360\.jpg$/);
  assert.ok(s.gallery.length >= 5 && s.gallery.every((g) => /\/productions\//.test(g.url) && !/descriptions|\?/.test(g.url)));
  assert.equal(s.detailImages.length, 40); // LIMITS.detail
  assert.ok(s.detailImages.every((d) => /\/productions\/descriptions\//.test(d.url)), "상세는 descriptions 만");
  const all = [...s.gallery, ...s.detailImages].map((x) => x.url);
  assert.equal(new Set(all).size, all.length, "대표·상세 겹침 없음");
  assert.ok(!all.some((u) => /notice|promotion-banner|store-feed|profile|card|community/.test(u)), "공지·띠·리뷰 사진 없음");
  assert.ok(s.options.length >= 16 && s.options.every((o) => !/원\)$/.test(o.label_ko)));
  assert.ok(s.attrs.some((a) => a.k_ko === "제조국 또는 원산지" && a.v_ko === "중국") && !s.attrs.some((a) => /전화|상호|대표자/.test(a.k_ko)));
  assert.ok(f.page.imgs.length > 60);
});
test("오늘의집 4237106(실페이지): 가게 자체 이미지 주소(common-product-images)도 상세로, 리뷰 사진은 빼기", () => {
  const s = built("ohou-4237106");
  assert.equal(s.gallery.length, 5);
  assert.ok(s.detailImages.length >= 17 && s.detailImages.some((d) => /common-product-images/.test(d.url)));
  assert.ok(!s.detailImages.some((d) => /content\/community|video-service|pdp-promotion/.test(d.url)));
  assert.equal(s.options.map((o) => o.label_ko).join(","), "사계절_코코아 브라운,사계절_포그 그레이,사계절_모스 올리브");
});
test("쿠팡 9516629140(실페이지 1회 저장본): 대표 5장 q89 · 상세 3장 · 필수 표기 정보", () => {
  const s = built("coupang-9516629140");
  assert.equal(s.title_ko, "수코리아 수납 정리함 수납 화장품 펜트리 바구니 수납함");
  assert.equal(s.gallery.length, 5); assert.ok(s.gallery.every((g) => /\/remote\/q89\/image\/vendor_inventory\//.test(g.url)));
  assert.equal(s.detailImages.length, 3); assert.ok(s.detailImages.every((d) => /q89\/image\/vendor_inventory/.test(d.url)));
  assert.deepEqual(s.attrs.map((a) => a.k_ko), ["품명 및 모델명", "제조국(원산지)", "제조자(수입자)"]);
  assert.equal(s.price.currency, "KRW");
});
test("네이버 __PRELOADED_STATE__(웹 아카이브 실제 2건): 제목·대표·가격·브랜드", () => {
  const a = parseNaverState(fx("naver-5394757993").page.state);
  assert.equal(a.title, "현대 무점착 창문시트지 유리시트지 사생활보호 필름 (버티컬브라인드)");
  assert.equal(a.gallery.length, 9); assert.match(a.gallery[0].url, /shop-phinf\.pstatic\.net/);
  assert.equal(a.price, 2800); assert.equal(a.category, "유리용시트지");
  assert.ok(a.attrs.some((x) => x.k === "브랜드" && x.v === "현대"));
  const b = built("naver-4479907303");
  assert.equal(b.title_ko, "더블버블 검볼 디스펜서 츄잉껌 35g"); assert.equal(b.gallery.length, 1); assert.deepEqual(b.price, { min: 1950, max: 1950, currency: "KRW" });
  assert.ok(!b.attrs.some((x) => /전화|반품|배송|상품상세참조/.test(x.k_ko + x.v_ko)), "고시 정보의 '상품상세참조'·배송/반품 규정은 뺀다");
});
