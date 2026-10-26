// 원본 한글화 v13 일반 규칙 단위테스트 — 처음 보는 상품(빨래건조대·컵홀더·힙업밴드) 검증에서 나온 규칙 (node --test test/detail/localize-general.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferLayout, shapeClip, findRules, inkColorClip, fillSurface, makeBitmap, fillRect } from "../../src/main/detail/image-core.js";

const blk = (x, y, w, h, text, role = "label", align = "left") => ({ x, y, w, h, text, role, style: { align, fontSizePx: Math.round(h * 0.92), fontWeight: 400 } });

test("inferLayout: 한 줄에 나란한 칸 라벨 → 가운데 정렬, 가장 큰 글이어도 title 이 아니라 label", () => {
  const out = inferLayout([blk(60, 300, 90, 30, "碳钢烤漆", "title", "left"), blk(220, 300, 110, 30, "大容量抽屉", "title", "center"), blk(390, 300, 90, 30, "防尘防潮", "title", "right")], { imgW: 520 });
  assert.deepEqual(out.map((b) => b.style.align), ["center", "center", "center"]);
  assert.deepEqual(out.map((b) => b.role), ["label", "label", "label"]);
});

test("inferLayout: 같은 높이 목록 3줄 이상 → 왼쪽 끝 정렬 + 역할·크기·굵기 하나로(한 줄만 title·굵게 되던 것)", () => {
  const ls = [blk(120, 150, 300, 30, "产品名称:桌面可抽拉收纳盒", "sub"), blk(120, 195, 210, 31, "产品材质: 碳钢材质", "sub"), blk(120, 240, 210, 34, "表面处理: 高温烤漆", "title"), blk(120, 285, 280, 30, "产品重量: 4.17kg/5.15kg", "sub")];
  ls[2].style.fontWeight = 700;
  const out = inferLayout(ls, { imgW: 520 });
  assert.ok(out.every((b) => b.style.align === "left"));
  assert.ok(out.every((b) => b.role === "sub"));
  assert.equal(new Set(out.map((b) => b.style.fontSizePx)).size, 1);
  assert.equal(new Set(out.map((b) => b.style.fontWeight)).size, 1);
});

test("inferLayout: 혼자인 줄·기울어진 글은 그대로", () => {
  const out = inferLayout([{ ...blk(300, 100, 150, 40, "单独一行", "title", "right") }, { ...blk(50, 600, 150, 30, "高温烤漆层"), angle: 22 }], { imgW: 520 });
  assert.equal(out[0].style.align, "right");
  assert.equal(out[1].style.align, "left");
});

test("shapeClip: 원 테두리에 닿은 글의 지울 사각형은 원 안만 칠한다(흰 막대가 원 밖으로 튀어나오지 않게)", () => {
  const bm = makeBitmap(200, 200, [150, 160, 170]);
  const cx = 100, cy = 100, R = 50;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) { const d = Math.hypot(x - cx, y - cy); if (d < R) fillRect(bm, { x, y, w: 1, h: 1 }, [255, 255, 255]); else if (d < R + 3) fillRect(bm, { x, y, w: 1, h: 1 }, [60, 160, 240]); }
  const area = { x: 44, y: 90, w: 112, h: 20 }; // 원 지름(100)보다 넓다
  const clip = shapeClip(bm, area, [255, 255, 255]);
  assert.ok(clip, "원 안 판정 함수");
  assert.equal(clip(100, 100), true);
  assert.equal(clip(46, 100), false); // 원 테두리 밖
  fillSurface(bm, area, { color: [255, 255, 255], clip });
  const at = (x, y) => Array.from(bm.data.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3));
  assert.deepEqual(at(150, 100), [60, 160, 240]); // 테두리 그대로
  assert.deepEqual(at(45, 100), [150, 160, 170]); // 바깥 바탕 그대로
});

test("findRules: 제목 밑줄 같은 가는 가로 선은 찾고, 계단 경계(위·아래 색이 다른 면)는 선이 아니다", () => {
  const bm = makeBitmap(300, 200, [255, 255, 255]);
  fillRect(bm, { x: 30, y: 60, w: 160, h: 3 }, [10, 10, 10]); // 밑줄
  fillRect(bm, { x: 0, y: 140, w: 300, h: 60 }, [120, 120, 120]); // 아래 면(경계 = 계단)
  const r = findRules(bm);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].y - 60) <= 1 && r[0].w >= 150 && r[0].h <= 4);
});

test("inkColorClip: 바탕↔글자색 사이 픽셀만 참 — 글 옆 주황 장식·이미 바탕인 픽셀은 칠하지 않는다", () => {
  const bm = makeBitmap(20, 4, [230, 230, 230]);
  fillRect(bm, { x: 0, y: 0, w: 5, h: 4 }, [20, 20, 20]); // 글자 획
  fillRect(bm, { x: 5, y: 0, w: 5, h: 4 }, [125, 125, 125]); // 가장자리 번짐(중간색)
  fillRect(bm, { x: 10, y: 0, w: 5, h: 4 }, [60, 140, 245]); // 주황 장식(BGR)
  const clip = inkColorClip(bm, () => [230, 230, 230], [[20, 20, 20]]);
  assert.equal(clip(1, 1), true);
  assert.equal(clip(6, 1), true);
  assert.equal(clip(11, 1), false);
  assert.equal(clip(17, 1), false); // 이미 바탕색인 픽셀은 건드리지 않는다(그라데이션 바탕을 한 색으로 누르지 않게)
});
