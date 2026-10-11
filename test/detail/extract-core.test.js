// 📄 상세페이지 ① 추출 — 순수 규칙 테스트:  node --test test/detail/extract-core.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanImageUrl, normalizeImages, normalizePrice, normalizeAttrs, normalizeOptions, normalizeShop, normalizeSource, pickDetailImages, planDownloads, sniffImage, siteOf, refererFor, LIMITS, offerUrl, isCompanyName, stripSiteTail, pickTitle, isIconUrl, fillGallery, normKind, v1Kind, classifyFolderFiles, titleFromFolder, skuLabel } from "../../src/main/detail/extract-core.js";

test("주소 꼬리 제거: _sum.jpg · .webp · _.webp · _Q90 · 크기 꼬리", () => {
  const base = "https://cbu01.alicdn.com/img/ibank/O1CN01abc_!!123-0-cib.jpg";
  assert.equal(cleanImageUrl(base + "_sum.jpg"), base);
  assert.equal(cleanImageUrl(base + ".webp"), base);
  assert.equal(cleanImageUrl(base + "_.webp"), base);
  assert.equal(cleanImageUrl(base + "_Q90.jpg_.webp"), base);
  assert.equal(cleanImageUrl(base + "_400x400q90.jpg"), base);
  assert.equal(cleanImageUrl(base + "_300x300xzq90.jpg_.webp"), base);
  assert.equal(cleanImageUrl(base + "_b.jpg"), base);
  assert.equal(cleanImageUrl("https://img.alicdn.com/imgextra/i1/abc.png_790x790.jpg"), "https://img.alicdn.com/imgextra/i1/abc.png");
  assert.equal(cleanImageUrl(base), base, "꼬리 없는 주소는 그대로");
});

test("?x-oss-process 질의 제거 · CDN 질의 전부 제거 · 다른 호스트는 x-oss-process 만", () => {
  assert.equal(cleanImageUrl("https://cbu01.alicdn.com/a/b.jpg?x-oss-process=image/resize,w_400"), "https://cbu01.alicdn.com/a/b.jpg");
  assert.equal(cleanImageUrl("https://cbu01.alicdn.com/a/b.jpg?__r__=123"), "https://cbu01.alicdn.com/a/b.jpg");
  assert.equal(cleanImageUrl("https://example.com/p/b.jpg?x-oss-process=image/format,webp&v=2"), "https://example.com/p/b.jpg?v=2");
  assert.equal(cleanImageUrl("https://example.com/p/b.jpg?x-oss-process=image/format,webp"), "https://example.com/p/b.jpg");
});

test("프로토콜 보완: //img.alicdn.com → https, http CDN → https, file:// 유지", () => {
  assert.equal(cleanImageUrl("//img.alicdn.com/bao/uploaded/i2/x.jpg_sum.jpg"), "https://img.alicdn.com/bao/uploaded/i2/x.jpg");
  assert.equal(cleanImageUrl("http://cbu01.alicdn.com/x.jpg"), "https://cbu01.alicdn.com/x.jpg");
  assert.equal(cleanImageUrl("http://example.com/x.jpg"), "http://example.com/x.jpg");
  assert.equal(cleanImageUrl("file:///Users/me/test/detail/fixture/img/d01.png"), "file:///Users/me/test/detail/fixture/img/d01.png");
  assert.equal(cleanImageUrl("file:///a/img/d01.png?x-oss-process=image/resize"), "file:///a/img/d01.png");
});

test("data: · 빈 값 · blob: · 상대 경로는 제외", () => {
  assert.equal(cleanImageUrl("data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="), null);
  assert.equal(cleanImageUrl(""), null);
  assert.equal(cleanImageUrl(null), null);
  assert.equal(cleanImageUrl("blob:https://detail.1688.com/abc"), null);
  assert.equal(cleanImageUrl("img/d01.png"), null);
});

test("원본이 webp 인 주소는 꼬리만 자르고 확장자 유지", () => {
  assert.equal(cleanImageUrl("https://cbu01.alicdn.com/a/b.webp_sum.jpg"), "https://cbu01.alicdn.com/a/b.webp");
  assert.equal(cleanImageUrl("https://cbu01.alicdn.com/a/b.webp"), "https://cbu01.alicdn.com/a/b.webp");
});

test("normalizeImages: 중복 제거(첫 것·순서 유지) · 60px 미만·1x1 제외 · 개수 제한 · w/h 유지", () => {
  const base = "https://cbu01.alicdn.com/img/";
  const list = [
    { url: base + "a.jpg_sum.jpg", w: 790, h: 1200 },
    { url: base + "a.jpg.webp" },                 // 같은 원본 → 중복
    { url: base + "icon.png", w: 40, h: 40 },     // 아이콘
    { url: base + "spacer.gif", w: 1, h: 1 },     // 1x1
    { url: "data:image/png;base64,xx", w: 790, h: 600 },
    { url: base + "b.jpg", w: 0, h: 0 },          // 크기 모름 → 유지, w/h 없음
    "//img.alicdn.com/c.jpg_.webp",
  ];
  const out = normalizeImages(list, 10);
  assert.deepEqual(out, [{ url: base + "a.jpg", w: 790, h: 1200 }, { url: base + "b.jpg" }, { url: "https://img.alicdn.com/c.jpg" }]);
  const many = Array.from({ length: 50 }, (_, i) => ({ url: `${base}${i}.jpg` }));
  assert.equal(normalizeImages(many, LIMITS.detail).length, 40);
  assert.equal(normalizeImages(many, LIMITS.gallery).length, 10);
});

test("가격 숫자화: 객체·글자·구간·없음", () => {
  assert.deepEqual(normalizePrice({ min: "15.50", max: 12.8 }), { min: 12.8, max: 15.5, currency: "CNY" });
  assert.deepEqual(normalizePrice("¥12.80 - 15.50"), { min: 12.8, max: 15.5, currency: "CNY" });
  assert.deepEqual(normalizePrice("9.9"), { min: 9.9, max: 9.9, currency: "CNY" });
  assert.equal(normalizePrice(null), null);
  assert.equal(normalizePrice({ min: "", max: "" }), null);
  assert.equal(normalizePrice("면세"), null);
});

test("속성표: k/v 정리 · 빈 칸·중복 키 제거 · 글자 패턴 분해 · 최대 60", () => {
  const out = normalizeAttrs([{ k_zh: " 材质 ", v_zh: "PP " }, { k_zh: "材质", v_zh: "다시" }, { k_zh: "", v_zh: "x" }, { k_zh: "颜色:", v_zh: "" }, { k: "产地", v: "浙江" }]);
  assert.deepEqual(out, [{ k_zh: "材质", v_zh: "PP" }, { k_zh: "产地", v_zh: "浙江" }]);
  assert.deepEqual(normalizeAttrs("材质:PP\n颜色：灰色 品牌: 无"), [{ k_zh: "材质", v_zh: "PP" }, { k_zh: "颜色", v_zh: "灰色 品牌: 无" }]);
  const many = Array.from({ length: 80 }, (_, i) => ({ k_zh: "k" + i, v_zh: "v" + i }));
  assert.equal(normalizeAttrs(many).length, 60);
});

test("옵션: 라벨 중복 제거 · 그림 주소 정리 · 최대 30", () => {
  const out = normalizeOptions([{ label_zh: "灰色", img: "//cbu01.alicdn.com/o.jpg_sum.jpg" }, { label_zh: "灰色", img: "" }, { label: "蓝色", img: "data:x" }, { label_zh: "" }]);
  assert.deepEqual(out, [{ label_zh: "灰色", img: "https://cbu01.alicdn.com/o.jpg" }, { label_zh: "蓝色", img: null }]);
  assert.equal(normalizeOptions(Array.from({ length: 40 }, (_, i) => ({ label_zh: "o" + i }))).length, 30);
});

test("상점 정보: 숫자화, 아무것도 없으면 null", () => {
  assert.deepEqual(normalizeShop({ name: "义乌市测试", years: "5年", repeat: "23.5%" }), { name: "义乌市测试", years: 5, repeat: 23.5 });
  assert.equal(normalizeShop({}), null);
  assert.equal(normalizeShop(null), null);
});

test("출처 판별 · Referer", () => {
  assert.equal(siteOf("https://detail.1688.com/offer/123.html"), "1688");
  assert.equal(siteOf("https://item.taobao.com/item.htm?id=1"), "taobao");
  assert.equal(siteOf("https://detail.tmall.com/item.htm?id=1"), "tmall");
  assert.equal(siteOf("file:///a/offer.html"), "other");
  assert.equal(refererFor("1688"), "https://detail.1688.com/");
  assert.equal(refererFor("taobao"), "https://item.taobao.com/");
  assert.equal(refererFor("tmall"), "https://detail.tmall.com/");
  assert.equal(refererFor("other", "https://example.com/p/1"), "https://example.com/");
});

test("pickDetailImages: 폭 ≥ 400 세로 연속 묶음 중 가장 긴 것(페이지 순서)", () => {
  const c = [
    { url: "g1", w: 400, h: 400, top: 0, left: 0 },      // 갤러리 1장(아래 옵션 썸네일과 끊김)
    { url: "o1", w: 60, h: 60, top: 420, left: 0 },
    { url: "o2", w: 60, h: 60, top: 420, left: 70 },
    { url: "side", w: 500, h: 300, top: 1000, left: 900 }, // 오른쪽 광고(가로로 안 겹침)
    { url: "d1", w: 790, h: 600, top: 1000, left: 0 },
    { url: "d2", w: 790, h: 1200, top: 1600, left: 0 },
    { url: "d3", w: 750, h: 3200, top: 2850, left: 20 },
    { url: "d4", w: 790, h: 800, top: 6100, left: 0 },
    { url: "rec", w: 790, h: 300, top: 8000, left: 0 },   // 추천 상품(간격 큼)
  ];
  assert.deepEqual(pickDetailImages(c).map((x) => x.url), ["d1", "d2", "d3", "d4"]);
  assert.deepEqual(pickDetailImages([]), []);
});

test("normalizeSource: 전체 묶음", () => {
  const s = normalizeSource({
    url: "https://detail.1688.com/offer/900000001.html", offerId: 900000001, title_zh: "  加厚脏衣篮\n折叠 ", price: { min: "15.5", max: "12.8" },
    attrs: [{ k_zh: "材质", v_zh: "PP" }], options: [{ label_zh: "灰色", img: "//cbu01.alicdn.com/o.jpg_sum.jpg" }],
    gallery: ["https://cbu01.alicdn.com/g1.jpg_sum.jpg", "https://cbu01.alicdn.com/g1.jpg"], detailImages: [{ url: "data:x" }, { url: "https://cbu01.alicdn.com/d1.jpg_.webp", w: 790, h: 1200 }],
    detailText_zh: "a \t b\r\n\n\n\nc", shop: { name: "x", years: 3 }, readAt: 1,
  });
  assert.equal(s.source, "1688"); assert.equal(s.offerId, "900000001"); assert.equal(s.title_zh, "加厚脏衣篮 折叠");
  assert.deepEqual(s.price, { min: 12.8, max: 15.5, currency: "CNY" });
  assert.deepEqual(s.gallery, [{ url: "https://cbu01.alicdn.com/g1.jpg" }]);
  assert.deepEqual(s.detailImages, [{ url: "https://cbu01.alicdn.com/d1.jpg", w: 790, h: 1200 }]);
  assert.equal(s.detailText_zh, "a b\n\nc"); assert.equal(s.readAt, 1); assert.deepEqual(s.shop, { name: "x", years: 3, repeat: null });
  const e = normalizeSource(null);
  assert.equal(e.source, "other"); assert.equal(e.price, null); assert.deepEqual(e.detailImages, []); assert.ok(e.readAt > 0);
});

test("planDownloads: 페이지 순서(대표→옵션→상세) · v2/v1 이름 · 옵션 이름·sameAs", () => {
  const src = { gallery: [{ url: "g" }, { url: "s1" }], detailImages: [{ url: "d", w: 1, h: 2 }, { url: "d2" }], options: [{ label_zh: "a", img: null }, { label_zh: "拉喇叭款", label_ko: "트럼펫 당김", img: "s1" }, { label_zh: "대형 사이즈", img: "s2" }] };
  const list = planDownloads(src);
  assert.deepEqual(list.map((x) => x.id + ":" + x.kind), ["g01:main", "g02:main", "o01:sku", "o02:sku", "d01:detail", "d02:detail"]);
  assert.deepEqual([list[2].label_zh, list[2].label_ko, list[2].label, list[2].sameAs], ["拉喇叭款", "트럼펫 당김", "트럼펫 당김", "g02"]);
  assert.deepEqual([list[3].label_zh, list[3].label_ko, list[3].sameAs], ["", "대형 사이즈", undefined], "한글만 있는 원문은 번역 칸으로");
  assert.deepEqual(planDownloads(src, { kinds: "v1" }).map((x) => x.kind), ["gallery", "gallery", "option", "option", "detail", "detail"]);
});

test("sniffImage: jpg/png/gif/webp", () => {
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpg");
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), "png");
  assert.equal(sniffImage(Buffer.from("GIF89a      ")), "gif");
  assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(sniffImage(Buffer.from("hello world!")), "");
});

test("offerUrl: 주소·상품번호·offerId 쿼리를 1688 상품 주소로, 그 밖은 null", () => {
  const want = "https://detail.1688.com/offer/948424797701.html";
  assert.equal(offerUrl("https://detail.1688.com/offer/948424797701.html?offerId=948424797701&spm=1688global.home/2025.recommendpart.73"), want);
  assert.equal(offerUrl("detail.1688.com/offer/948424797701.html"), want);
  assert.equal(offerUrl("  948424797701 "), want);
  assert.equal(offerUrl("https://m.1688.com/offer/948424797701.html"), want);
  assert.equal(offerUrl("https://detail.1688.com/some/page?offerId=948424797701"), want);
  assert.equal(offerUrl("https://item.taobao.com/item.htm?id=123456789"), null);
  assert.equal(offerUrl("https://s.1688.com/selloffer/offer_search.htm?keywords=x"), null);
  assert.equal(offerUrl(""), null);
  assert.equal(offerUrl(null), null);
});

test("회사명 판별: 중국어·1688 한국어판", () => {
  for (const t of ["温州莱龙卫浴有限公司", "东莞中正家具有限公司", "义乌市测试日用品厂", "广州某某商行", "深圳某某贸易", "某某实业", "测试家居旗舰店", "원저우 라이롱 위생도기 유한회사", "동관 중징 가구 유한공사", "某某有限公司 ", "某某有限公司（）"]) assert.equal(isCompanyName(t), true, t);
  for (const t of ["加厚脏衣篮 折叠收纳筐 家用洗衣篮", "벽걸이형 접이식 빨래건조대", "工厂直销 收纳盒", "公司年会礼品 保温杯", "", null]) assert.equal(isCompanyName(t), false, String(t));
});

test("문서 제목 꼬리 제거", () => {
  assert.equal(stripSiteTail("加厚脏衣篮 折叠收纳筐 - 阿里巴巴"), "加厚脏衣篮 折叠收纳筐");
  assert.equal(stripSiteTail("加厚脏衣篮-淘宝网"), "加厚脏衣篮");
  assert.equal(stripSiteTail("加厚脏衣篮 | 1688.com"), "加厚脏衣篮");
  assert.equal(stripSiteTail("加厚脏衣篮"), "加厚脏衣篮");
});

test("상품명 자리에 회사명: 다음 후보로 · 회사명은 상점 이름으로", () => {
  const s = normalizeSource({ url: "https://detail.1688.com/offer/1.html", title_zh: "温州莱龙卫浴有限公司",
    titleCandidates: [{ t: "温州莱龙卫浴有限公司", from: "h1" }, { t: "壁挂式折叠晾衣架 铝合金 - 阿里巴巴", from: "document.title" }], shop: null });
  assert.equal(s.title_zh, "壁挂式折叠晾衣架 铝合金");
  assert.deepEqual(s.shop, { name: "温州莱龙卫浴有限公司", years: null, repeat: null });
  // 상점 이름이 이미 있으면 덮지 않고 연차·회두율 유지
  const s2 = normalizeSource({ title_zh: "东莞中正家具有限公司", titleCandidates: ["东莞中正家具有限公司", "碳钢桌面抽拉收纳盒"], shop: { name: "东莞中正家具有限公司", years: 4, repeat: 42 } });
  assert.equal(s2.title_zh, "碳钢桌面抽拉收纳盒"); assert.deepEqual(s2.shop, { name: "东莞中正家具有限公司", years: 4, repeat: 42 });
  // 상점 이름 없음 + 연차만 → 이름 채움
  const s3 = normalizeSource({ title_zh: "东莞中正家具有限公司", shop: { name: "", years: 4, repeat: 42 }, titleCandidates: ["碳钢收纳盒"] });
  assert.deepEqual(s3.shop, { name: "东莞中正家具有限公司", years: 4, repeat: 42 });
});

test("후보가 모두 회사명이면 속성표 품명 → 분류, 그것도 없으면 빈칸", () => {
  assert.equal(normalizeSource({ title_zh: "某某有限公司", attrs: [{ k_zh: "材质", v_zh: "PP" }, { k_zh: "品名", v_zh: "脏衣篮" }] }).title_zh, "脏衣篮");
  assert.equal(normalizeSource({ title_zh: "원저우 라이롱 위생도기 유한회사", attrs: [{ k_zh: "제품 카테고리", v_zh: "옷걸이" }] }).title_zh, "옷걸이");
  assert.equal(normalizeSource({ title_zh: "某某有限公司" }).title_zh, "");
  assert.equal(pickTitle({ title_zh: "加厚脏衣篮" }).from, "title");
});

test("1688 썸네일 꼬리(.310x310.jpg·.search.jpg·.summ.jpg) 제거 · 페이지 주소 제외", () => {
  const b = "https://cbu01.alicdn.com/img/ibank/O1CN01Rp5uYS1J53XzO3cm0_!!2212507230976-0-cib";
  assert.equal(cleanImageUrl(b + ".310x310.jpg"), b + ".jpg");
  assert.equal(cleanImageUrl(b + ".220x220xz.jpg"), b + ".jpg");
  assert.equal(cleanImageUrl(b + ".search.jpg"), b + ".jpg");
  assert.equal(cleanImageUrl(b + ".summ.jpg"), b + ".jpg");
  assert.equal(cleanImageUrl(b + ".jpg_.webp"), b + ".jpg");
  assert.equal(cleanImageUrl("https://detail.1688.com/offer/782706077987.html"), null);
  assert.equal(cleanImageUrl("file:///a/test/detail/fixture/offer.html"), null);
});

test("아이콘 주소: svg · 작은 tps", () => {
  assert.equal(isIconUrl("https://img.alicdn.com/imgextra/i4/O1CN01DqZtmR1MFXa1N8MmN_!!6000000001405-55-tps-15-14.svg"), true);
  assert.equal(isIconUrl("https://img.alicdn.com/imgextra/i2/O1CN01x_!!6000000006464-2-tps-20-20.png"), true);
  assert.equal(isIconUrl("https://img.alicdn.com/imgextra/i2/O1CN01x_!!6000000006464-2-tps-750-400.png"), false);
  assert.equal(isIconUrl("https://cbu01.alicdn.com/img/ibank/O1CN01Rp5uYS-0-cib.jpg"), false);
});

test("실제 782706077987 형태: 갤러리 페이지 주소 제외 · 옵션 상점명·svg 아이콘 제외", () => {
  const s = normalizeSource({ url: "https://detail.1688.com/offer/782706077987.html", title_zh: "防尘杯架",
    gallery: [{ url: "https://cbu01.alicdn.com/img/ibank/O1CN01Rp5uYS1J53XzO3cm0_!!2212507230976-0-cib.jpg", w: 800, h: 800 }, { url: "https://detail.1688.com/offer/782706077987.html" }],
    options: [{ label_zh: "동관 Zexinyuan 홈 가구 유한 회사", img: "https://img.alicdn.com/imgextra/i4/O1CN01Dq_!!6000000001405-55-tps-15-14.svg" },
      { label_zh: "白色", img: "https://cbu01.alicdn.com/img/ibank/o1.jpg_sum.jpg" }, { label_zh: "피드백", img: "https://img.alicdn.com/imgextra/x-55-tps-17-17.svg" }] });
  assert.deepEqual(s.gallery.map((g) => g.url), ["https://cbu01.alicdn.com/img/ibank/O1CN01Rp5uYS1J53XzO3cm0_!!2212507230976-0-cib.jpg"]);
  assert.deepEqual(s.options, [{ label_zh: "白色", img: "https://cbu01.alicdn.com/img/ibank/o1.jpg" }]);
  const s2 = normalizeSource({ options: [{ label_zh: "익명으로 구매1개", img: "https://cbu01.alicdn.com/img/ibank/2020/a.jpg" }, { label_zh: "동일 모델 비교›" }, { label_zh: "고객 서비스APP1688 AIBUY링크 복사상단" }, { label_zh: "品质合格率" }, { label_zh: "大号 40cm" }, { label_zh: "灰色" }] });
  assert.deepEqual(s2.options.map((o) => o.label_zh), ["大号 40cm", "灰色"]);
});

test("fillGallery: 2장 미만이면 정사각형 상세 그림을 올림(최대 5) · 크기 모르면 안 씀", () => {
  const det = [{ url: "a", w: 750, h: 1058 }, { url: "b", w: 750, h: 734 }, { url: "c" }, { url: "d", w: 800, h: 800 }, { url: "e", w: 300, h: 300 }, { url: "f", w: 790, h: 760 }, { url: "g", w: 800, h: 820 }, { url: "h", w: 800, h: 800 }];
  assert.deepEqual(fillGallery([{ url: "g0", w: 800, h: 800 }], det).map((x) => x.url + (x.from ? ":" + x.from : "")), ["g0", "b:detail", "d:detail", "f:detail", "g:detail"]);
  assert.equal(fillGallery([{ url: "1" }, { url: "2" }], det).length, 2, "2장 이상이면 그대로");
  assert.deepEqual(fillGallery([], [{ url: "c" }]), []);
  const s = normalizeSource({ gallery: [], detailImages: [{ url: "https://cbu01.alicdn.com/x/d1.jpg", w: 800, h: 800 }, { url: "https://cbu01.alicdn.com/x/d2.jpg", w: 790, h: 1200 }] });
  assert.deepEqual(s.gallery, [{ url: "https://cbu01.alicdn.com/x/d1.jpg", w: 800, h: 800, from: "detail" }]);
  assert.equal(s.detailImages.length, 2, "상세 목록에서는 빼지 않음");
});

test("normKind/v1Kind: 예전 이름과 새 이름 양쪽", () => {
  assert.deepEqual(["gallery", "option", "detail", "main", "sku", undefined].map(normKind), ["main", "sku", "detail", "main", "sku", "detail"]);
  assert.deepEqual(["main", "sku", "detail", "gallery"].map(v1Kind), ["gallery", "option", "detail", "gallery"]);
});

test("classifyFolderFiles: Fatkun 폴더(main/SKU/detail 접두어, 번호 순, 옵션명)", () => {
  const names = ["detail-10.jpg", "detail-02.jpg", "main-01.jpg", "SKU-02-대형 사이즈 풀아웃.jpg", "SKU-01-트럼펫을 당겨.jpg", "main-07.jpg", "readme.txt", ".DS_Store", "detail-01.jpg", "photo.jpg", "主图3.png", "详情_5.webp"];
  const c = classifyFolderFiles(names);
  assert.deepEqual(c.main.map((x) => x.name), ["main-01.jpg", "主图3.png", "main-07.jpg"]);
  assert.deepEqual(c.sku.map((x) => [x.n, x.label]), [[1, "트럼펫을 당겨"], [2, "대형 사이즈 풀아웃"]]);
  assert.deepEqual(c.detail.map((x) => x.name), ["detail-01.jpg", "detail-02.jpg", "详情_5.webp", "detail-10.jpg"]);
  assert.deepEqual(c.other, ["photo.jpg"]);
  // macOS 파일 이름(NFD 한글)도
  assert.equal(classifyFolderFiles(["SKU-01-트럼펫을 당겨.jpg".normalize("NFD")]).sku[0].label, "트럼펫을 당겨");
  assert.equal(titleFromFolder("일본 커피 머신 스토리지 랙 데스크탑 컵 스토리지 랙 - 阿里巴巴"), "일본 커피 머신 스토리지 랙 데스크탑 컵 스토리지 랙");
  assert.deepEqual(skuLabel({ label_zh: "拉喇叭款" }), { label_zh: "拉喇叭款", label_ko: "", label: "拉喇叭款" });
});
