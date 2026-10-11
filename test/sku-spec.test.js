// 규격 글자 비교(sku-core) · 원가 기준(rank-core) — node --test test/sku-spec.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { specsOf, specText, decidePrice } from "../src/main/sku-core.js";
import { decideCost } from "../src/main/rank-core.js";

const h = Array(64).fill(0);
test("쿠팡 상품명 규격 뽑기 (실제 상품명)", () => {
  assert.equal(specText(specsOf("빨래건조대 접이식 4단 튼튼한 대형 이동식 빨래건조대")), "4단·대형");
  assert.equal(specText(specsOf("이지하임 4켤레 털빠짐없는 편안한 무압박 남녀공용 수면양말 세트")), "4개");
  assert.equal(specText(specsOf("코멧 트임형 빨래바구니 2개입, 아이보리")), "2개·베이지");
  assert.equal(specsOf("휴식숲 스텐 빨래바구니 이동식 철제 와이어 2단 3단 세탁 빨래바구니, 화이트").tier, undefined); // 단수가 여럿이면 모름
  assert.equal(specText(specsOf("米白色 大号")), "대형·베이지");
});
test("사진 같은 옵션은 규격으로 가른다", () => {
  const opts = [{ label: "三层 白色", price: "45", hash: h }, { label: "四层 白色", price: "58", hash: h }, { label: "五层 白色", price: "69", hash: h }, { label: "配件", price: "5", hash: h }];
  const d = decidePrice(opts, { photoHash: h, name: "빨래건조대 4단 대형" });
  assert.equal(d.price, 58); assert.equal(d.sure, true);
  assert.equal(decidePrice(opts, { photoHash: h, name: "빨래건조대 대형" }).sure, false); // 옵션에 규격이 없으면 확인 요청
  assert.equal(decidePrice([{ label: "小号", price: "12" }, { label: "中号", price: "15" }, { label: "大号", price: "19" }], { name: "빨래바구니 대형" }).price, 19);
});
test("원가 기준: 1순위 확인값 → 중간값 → 경고", () => {
  assert.equal(decideCost([{ price: 45, real: true, sure: true }, { price: 52, real: true }, { price: 60, real: true }]).yuan, 45);
  assert.equal(decideCost([{ price: 45, real: true, sure: false }, { price: 52, real: true }, { price: 60, real: true }]).yuan, 52);
  assert.ok(decideCost([{ price: 20, real: true, sure: true }, { price: 52, real: true }, { price: 60, real: true }]).warn);
  assert.equal(decideCost([{ price: 18, real: false }]).sure, false);
});
