// ✍ 상품명 짓기(name-core) — node --test test/name-core.test.js
// 예시는 강의 2주차 p.9~18(팬티스타킹)·p.7(잘못된 예시) 그대로. 서브키워드 검색량은 제휴 DB 2026-09 값
import test from "node:test";
import assert from "node:assert/strict";
import { countWords, buildPool, defaultPicks, buildNames, checkName } from "../src/shared/name-core.js";

const SUBS = [
  { kw: "압박팬티스타킹", m1: 210, mx: 7387 }, { kw: "고탄력팬티스타킹", m1: 150, mx: 23165 }, { kw: "다이소팬티스타킹", m1: 140 },
  { kw: "비비안팬티스타킹", m1: 130, brand: true }, { kw: "살색팬티스타킹", m1: 70 }, { kw: "팬티스타킹효과", m1: 40 },
];
const ITEMS = [
  { name: "베이스알파에센셜 국내산 학생용 팬티스타킹 20D 10p 벌크형", brand: "베이스알파에센셜" },
  { name: "비비안 고탄력 팬티스타킹 5+5", brand: "비비안" },
  { name: "탐사 학생용 고탄력 20D 팬티스타킹 벌크형 10P", brand: "탐사" },
  { name: "시글락 요즘애들 학생용 80D 팬티스타킹 6P", brand: "" },
];
const pool = buildPool({ keyword: "팬티스타킹", subs: SUBS, items: ITEMS });
const byWord = (w) => pool.find((p) => p.word === w);

test("단어 수: 수량·용량은 빼고 센다(강의 p.12)", () => {
  assert.equal(countWords("제이 고탄력 팬티스타킹 학생 압박 10P").n, 5);
  assert.equal(countWords("코멧 스포츠 컴팩트 쉐이커 보틀, 그레이, 600ml, 1개").n, 5);
  assert.equal(countWords("비비안 고탄력 팬티스타킹 5+5").n, 3);
});

test("서브키워드에서 단어를 뽑고 색상·남의 브랜드·정보 검색어는 따로 둔다", () => {
  assert.equal(byWord("압박").m1, 210);
  assert.equal(byWord("살색").flag, "color");
  assert.equal(byWord("다이소").flag, "brand");
  assert.equal(byWord("비비안").flag, "brand");
  assert.equal(byWord("효과").flag, "junk");
  assert.equal(byWord("효과").pos, "post");
  assert.equal(byWord("학생용").top, 3); // 상위 상품 3개가 씀
});

test("처음 고르는 단어 = 검색량 100+ 또는 상위 상품 3개+ (색상·브랜드 제외)", () => {
  assert.deepEqual(defaultPicks(pool), ["압박", "고탄력", "학생용"]);
});

test("후보 3개: 기본 키워드 → 검색량 큰 조합 순으로 타겟, 브랜드 바로 다음, 5단어 + 수량", () => {
  const names = buildNames({ keyword: "팬티스타킹", brand: "제이", qty: "10P", pool, picks: defaultPicks(pool), main: { m1: 3010, mx: 23143 } });
  assert.deepEqual(names.map((n) => n.name), [
    "제이 팬티스타킹 압박 고탄력 학생용 10P",
    "제이 압박 팬티스타킹 고탄력 학생용 10P",
    "제이 고탄력 팬티스타킹 압박 학생용 10P",
  ]);
  assert.deepEqual(names.map((n) => n.target), ["팬티스타킹", "압박 팬티스타킹", "고탄력 팬티스타킹"]);
  assert.ok(names.every((n) => n.n === 5));
});

test("키워드가 모자라면 특장점 단어로 채운다(강의 p.16)", () => {
  const [n] = buildNames({ keyword: "발가락양말", brand: "코지레이스", qty: "10켤레", feats: "중목 발냄새예방 통기성", pool: [], picks: ["남성"] });
  assert.equal(n.name, "코지레이스 발가락양말 남성 중목 발냄새예방 10켤레");
});

test("검사: 강의의 잘못된 예시(p.7)는 단어 수·색상·특수문자에서 걸린다", () => {
  const cs = checkName("패션파트너 [자체제작] 프리미엄 슬림핏 고탄력 하이서포트 엉덩이 두줄 봉제선 150D 페이크 착시 팬티 스타킹 검정", { keyword: "팬티스타킹", brand: "패션파트너", pool });
  const f = cs.filter((c) => c.pass === false).map((c) => c.key);
  assert.deepEqual(f.sort(), ["color", "len", "pos", "sym"].sort());
});

test("검사: 강의의 후보 상품명(p.15)은 모두 통과", () => {
  const cs = checkName("제이 고탄력 팬티스타킹 학생 압박 10P", { keyword: "팬티스타킹", brand: "제이", pool });
  assert.ok(cs.every((c) => c.pass !== false), cs.filter((c) => c.pass === false).map((c) => c.label).join());
  assert.ok(cs.find((c) => c.key === "vol").label.includes("2개"));
});

test("검사: 다른 브랜드 이름을 넣으면 잡는다", () => {
  const cs = checkName("제이 다이소 팬티스타킹 고탄력", { keyword: "팬티스타킹", brand: "제이", pool });
  assert.equal(cs.find((c) => c.key === "other")?.pass, false);
});

test("쿠팡 자동완성·연관검색어(2026-10-12 실제 응답)에서 앞뒤 단어를 뽑고, 끝이 같은 연관검색어(압박스타킹)도 쓴다", () => {
  const cp = {
    auto: ["검정 팬티스타킹", "고탄력 팬티스타킹", "살색 팬티스타킹", "빅사이즈 팬티스타킹", "압박 팬티스타킹", "여성 팬티스타킹 살색", "팬티스타킹 10매"],
    related: ["고탄력팬티스타킹", "스타킹", "검정스타킹", "여성스타킹", "압박스타킹"],
    deep: { 학생: ["학생용 팬티스타킹", "학생 살색 팬티스타킹"] },
  };
  const p = buildPool({ keyword: "팬티스타킹", cp, vol: { 학생용팬티스타킹: { m1: 90, mx: 18539 } } });
  const w = (x) => p.find((e) => e.word === x);
  assert.equal(w("고탄력").cp, 2);
  assert.equal(w("압박").cp, 2);
  assert.equal(w("여성").cp, 2);
  assert.equal(w("살색").flag, "color");
  assert.equal(w("살색").pos, "pre");
  assert.equal(w("학생용").m1, 90);
  assert.equal(w("학생").cp, 1);
  assert.ok(!p.some((e) => /10매|스타킹/.test(e.word)));
  assert.deepEqual(defaultPicks(p), ["학생용", "고탄력", "압박", "여성"]);
});

test("연관검색어 2단계(변기솔 → 화장실변기솔 화면의 연관검색어)도 단어 후보에 넣는다", () => {
  const cp = {
    auto: [], deep: {},
    related: ["화장실변기솔", "변기청소솔", "욕실변기솔"],
    related2: { 화장실변기솔: ["스텐변기솔", "스테인레스변기솔", "욕실청소도구"], 욕실변기솔: ["스텐변기솔", "무타공변기솔"] },
  };
  const p = buildPool({ keyword: "변기솔", cp });
  const w = (x) => p.find((e) => e.word === x);
  assert.equal(w("스텐").cp, 2);
  assert.ok(w("스텐").src.includes("related2"));
  assert.equal(w("무타공").pos, "pre");
  assert.equal(w("스테인레스").cp, 1);
  assert.ok(!w("욕실청소도구")); // 내 키워드(변기솔)와 끝이 다른 검색어는 단어로 쓰지 않는다
});

test("쿠팡 검색어의 쉼표·순위 조각(',' · '1위')은 단어로 쓰지 않는다", () => {
  const p = buildPool({ keyword: "변기솔", cp: { auto: ["변기솔 , 실리콘", "1위 변기솔"], related: [], deep: {} } });
  assert.deepEqual(p.map((e) => e.word), ["실리콘"]);
});

test("겹치는 말은 합친 검색어(청소솔 → 변기청소솔), 없으면 단어 하나 검색량(단독)을 붙인다 — 제휴 DB 2026-09 값", () => {
  const items = ["리빙공감 벽걸이형 변기솔 청소솔 브러쉬 세트", "위슬러 화장실 청소솔 변기솔 브러쉬", "크린메이트 변기솔 청소솔 브러쉬"].map((name) => ({ name, brand: "" }));
  const p = buildPool({ keyword: "변기솔", items, vol: { 변기청소솔: { m1: 2690 }, 청소솔: { m1: 4800 }, 브러쉬: { m1: 14840 } } });
  const w = (x) => p.find((e) => e.word === x);
  assert.equal(w("청소솔").m1, 2690);
  assert.equal(w("청소솔").merged, "변기청소솔");
  assert.equal(w("브러쉬").m1, null);
  assert.equal(w("브러쉬").solo, 14840);
  const names = buildNames({ keyword: "변기솔", brand: "제이", pool: p, picks: ["청소솔", "브러쉬"], main: { m1: 4680 } });
  assert.equal(names.length, 1); // 합친 말은 타겟 후보로 쓰지 않는다
  assert.equal(names[0].name, "제이 변기솔 청소솔 브러쉬");
});

test("검색량 DB가 없는 PC(윈도우 수강생): 쿠팡 자동완성에 많이 나온 조합으로 후보 3개", () => {
  const cp = { auto: ["고탄력 팬티스타킹", "압박 팬티스타킹", "학생용 팬티스타킹"], related: ["고탄력팬티스타킹", "압박스타킹"], deep: { 학생용: ["학생용 팬티스타킹"] } };
  const pool = buildPool({ keyword: "팬티스타킹", cp });
  const names = buildNames({ keyword: "팬티스타킹", brand: "제이", qty: "10P", pool, picks: defaultPicks(pool) });
  assert.equal(names.length, 3);
  assert.ok(names.every((n) => n.m1 == null));
  assert.deepEqual(names.map((n) => n.target), ["팬티스타킹", "학생용 팬티스타킹", "고탄력 팬티스타킹"]); // 둘 다 쿠팡 검색어에 2번
  assert.ok(names.slice(1).every((n) => n.cp === 2));
});
