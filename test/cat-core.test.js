// 📂 리스트업 카테고리 자동 찾기(cat-core) — node --test test/cat-core.test.js
// 분류 이름·경로는 2026-11-23 앱에 저장된 실제 Wing 카테고리 목록에서 옮겨 온 것
import test from "node:test";
import assert from "node:assert/strict";
import { rgCat, catOfWingItem, codesOfWingItem, pathOfCodes, buildIndex, guessFromTree, findCat } from "../src/main/cat-core.js";

const CATS = ["뷰티 > 스킨케어", "패션의류잡화", "뷰티(기타)", "출산/유아동", "식품", "주방용품", "생활용품", "가구/홈데코", "가전/디지털", "스포츠/레져", "자동차용품", "도서", "문구/오피스", "완구/취미", "반려/애완용품"];
const n = (code, path) => ({ code, name: path.split(">").at(-1), path, depth: path.split(">").length });
const TREE = [
  n("1", "가구/홈데코>침구>담요"), n("2", "스포츠/레져>캠핑>침낭/매트/해먹>베개/담요"), n("3", "반려/애완용품>강아지/고양이 겸용>하우스/침대/방석>담요/이불"),
  n("4", "테마관>유기농/친환경 전문관>출산/유아동>유아동침구>유아블랭킷/담요"), n("64463", "생활용품>세탁용품>빨래건조대"), n("6", "생활용품>세탁용품"),
  n("7", "문구/오피스>문구/학용품>노트/다이어리/캘린더>노트"), n("8", "뷰티>스킨>스킨/토너"), n("9", "뷰티>헤어>샴푸"),
];
const idx = buildIndex(TREE);

test("쿠팡 분류 경로 → 리스트업 카테고리 선택지", () => {
  assert.equal(rgCat("ROOT>생활용품>세탁용품>빨래건조대", CATS), "생활용품");
  assert.equal(rgCat("뷰티>스킨>스킨/토너", CATS), "뷰티 > 스킨케어");
  assert.equal(rgCat("뷰티>헤어>샴푸", CATS), "뷰티(기타)");
  assert.equal(rgCat("테마관>유기농", CATS), "");
  assert.equal(rgCat("", CATS), "");
});

test("Wing 응답 상품에서 분류 읽기(경로 글 · 번호)", () => {
  assert.equal(catOfWingItem({ displayCategoryInfos: [{ categoryHierarchy: "ROOT>생활용품>세탁용품>빨래건조대" }] }), "생활용품>세탁용품>빨래건조대");
  assert.equal(catOfWingItem({ displayCategoryInfo: [{ categoryHierarchy: "생활용품>세탁용품>빨래건조대" }] }), "생활용품>세탁용품>빨래건조대");
  assert.equal(catOfWingItem({ displayCategoryInfo: { leafCategoryCode: 64463 }, productName: "A>B" }), "");
  const codes = codesOfWingItem({ displayCategoryInfo: [{ leafCategoryCode: 64463, rootCategoryCode: 6 }], categoryId: 999 });
  assert.equal(codes, "#64463"); // 번호는 3자리부터만(짧은 숫자는 분류 번호가 아닐 수 있다)
  assert.equal(pathOfCodes(codes, new Map(TREE.map((x) => [x.code, x.path]))), "생활용품>세탁용품>빨래건조대");
});

test("카테고리 목록에서 이름으로 찾기(추정)", () => {
  assert.equal(guessFromTree(idx, { keyword: "빨래건조대" }, CATS).cat, "생활용품");
  assert.equal(guessFromTree(idx, { keyword: "담요" }, CATS).path, "가구/홈데코>침구>담요"); // 여러 대분류에 있으면 이름이 통째로 같고 얕은 것 · 테마관은 뺀다
  assert.equal(guessFromTree(idx, { keyword: "캠핑옷걸이", name: "설봉이네상점 접이식 빨래 건조대 휴대용 여행 캠핑" }, CATS).cat, "생활용품"); // 상품명의 "빨래 건조대"
  assert.equal(guessFromTree(idx, { keyword: "없는말", name: "아무 상품" }, CATS), null);
});

test("한 행 찾기: 진단에서 받은 분류가 가장 먼저", () => {
  const src = { idx, byPid: new Map([["111", "주방용품>주방수납/정리>기타수납/정리용품"]]), bySnapName: new Map([["욕실수납/정리", "생활용품>욕실용품>욕실수납/정리"]]), wingCat: (p) => (p === "222" ? "문구/오피스>문구/학용품" : "") };
  assert.deepEqual([findCat({ pid: "111", keyword: "담요" }, src, CATS).cat, findCat({ pid: "111", keyword: "담요" }, src, CATS).sure], ["주방용품", true]);
  assert.equal(findCat({ pid: 222, keyword: "담요" }, src, CATS).cat, "문구/오피스");
  assert.equal(findCat({ pid: "9", keyword: "📂 욕실수납/정리" }, src, CATS).cat, "생활용품");
  const g = findCat({ pid: "9", keyword: "담요" }, src, CATS);
  assert.deepEqual([g.cat, g.sure], ["가구/홈데코", false]);
  assert.equal(findCat({ pid: "9", keyword: "없는말", name: "" }, src, CATS), null);
});
