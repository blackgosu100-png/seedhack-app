// 원본 한글화 v12 규칙 단위테스트 — 넣지 말 이미지 판정 · 용어집/직역체 · 히어로 상품명 (node --test test/detail/localize-core.test.js)
// 예시는 2026-10-13 대파 분쇄기(742640871856) 실제 OCR 문구
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLocalizeImage, isSpecTable, fixLiteral, heroNameFrom, glossaryPrompt } from "../../src/main/detail/localize-core.js";

const L = (arr, h = 40) => arr.map((zh) => ({ zh, h }));

test("v12 이미지 판정: 구매 유도·판매 정책·후기·가격 설명은 빼고, 대표 사진 귀퉁이 배지 하나로는 빼지 않는다", () => {
  assert.equal(classifyLocalizeImage(L(["币淘金币", "点击享大额补贴", "立即购买", "*优惠仅限手机端淘宝APP有效"]), { imgH: 450 })?.kind, "buy");
  assert.equal(classifyLocalizeImage(L(["因为有底气！所以敢承诺！", "放心购物 无后顾之忧", "效果不够好", "01", "退", "30天免费试机服务", "好不好你说了算！"]), { imgH: 1055 })?.kind, "policy");
  assert.equal(classifyLocalizeImage(L(["众多商户真实反馈", "AONDw"], 80), { imgH: 1034 })?.kind, "review");
  assert.equal(classifyLocalizeImage(L(["价格说明：", "被比较价格", "商品的专柜价、吊牌价、厂家建议零售价", "家的表述为准。"]), { imgH: 1446 })?.kind, "price");
  // 대표 사진: 제품 + "顺丰包邮"·"免费试用厂家直销" 배지 → 사진은 남김(그 줄만 지움)
  assert.equal(classifyLocalizeImage(L(["大葱切碎机", "高转速不出水", "顺丰包邮", "免费试用厂家直销"], 110), { imgH: 1440, kind: "gallery" }), null);
  // 보통 기능 소개는 통과
  assert.equal(classifyLocalizeImage(L(["双进料口设计", "• 量大用大进料口", "• 量小用小进料口"]), { imgH: 900 }), null);
});

test("v12 사양표 판정: 사양 열쇠말 3개 이상 + 작은 글 대부분 + 글 줄 10개 이상", () => {
  const spec = ["基础款", "参数", "产品名称", "基础款 多功能切菜机", "产品型号", "JS-418A-2", "工作时间", "可连续工作约30分钟", "额定功率", "200W直流电机", "净重/毛重", "3.75KG /4.75KG", "额定电压", "220V-50Hz"].map((zh, i) => ({ zh, h: i < 2 ? 50 : 22 }));
  assert.equal(isSpecTable(spec, 800), true);
  assert.equal(classifyLocalizeImage(spec, { imgH: 800 })?.kind, "spec_table");
  assert.equal(isSpecTable(L(["你是否也有这些烦恼？", "卖相太差", "又慢又累", "伤到手好疼", "人力成本高", "粗细大小不均匀", "手工效率太低", "一不留神易伤手", "员工越来越多", "难登大雅之堂"], 25), 575), false, "고민 나열은 표가 아니다");
});

test("v12 용어집·직역체: 대표님이 짚은 직역을 고치고, 고칠 말이 없으면 뺀다", () => {
  assert.equal(fixLiteral("实拍效果拒绝PS", "실제 샷 효과는 PS를 거부합니다.").ko, "보정 없는 실제 사진");
  assert.equal(fixLiteral("参数", "매개변수").ko, "제품 사양");
  assert.equal(fixLiteral("产品全家福", "제품군 초상화").ko, "구성품 한눈에");
  assert.equal(fixLiteral("家的表述为准。", "집의 진술이 우선합니다").drop, true);
  assert.equal(fixLiteral("高效切葱后厨小帮手", "양파를 자르는 효율적인 주방 도우미").ko, "대파를 자르는 효율적인 주방 도우미"); // 葱 ≠ 양파
  assert.equal(fixLiteral("洋葱切丝", "양파 채썰기").changed, false);
  assert.equal(fixLiteral("双进料口设计", "투입구가 두 개라 편해요").changed, false, "자연스러운 문구는 그대로");
  assert.equal(fixLiteral("x", "두려워하지 마세요").literal, true, "직역 흔적 표시(다시 쓰기 대상)");
  assert.equal(fixLiteral("x", "당신의 아름다움에").ko, "아름다움에", "v13: 당신의 → 뺌(다시 쓰기 없이 규칙으로)");
  assert.match(glossaryPrompt(), /实拍效果拒绝PS → 보정 없는 실제 사진/);
});

test("v12 히어로 상품명: 기획서 상품명에서 머리말·괄호를 정리해 크게 쓸 짧은 이름", () => {
  assert.equal(heroNameFrom("업소용 대파 다지기 분쇄기 (커터헤드 교체형)"), "교체형 대파 다지기");
  assert.equal(heroNameFrom("무선 휴대용 고주파 진동 안경 세척기"), "고주파 진동 안경 세척기"); // 길면 앞 수식어부터 빼고 끝 명사는 살림
  assert.equal(heroNameFrom(""), "");
});
