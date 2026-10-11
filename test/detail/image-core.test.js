// image-core 단위테스트 — 배경 추정·보간·결정 규칙·상자 병합·CJK 비율 (node --test test/detail/image-core.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateBackground, eraseRect, decideErase, expandRect, mergeBoxes, cjkRatio, hasCJK, cleanBitmap, makeBitmap, fillRect, meanDiff, toHex, findTrimRect, bandCutRect, shiftBoxes, cropBitmap, contentRatio, findPhotoRegion, settleBoxesInRect, trimEdgeBands, textureRatio, productMask, ERASE_RULE } from "../../src/main/detail/image-core.js";

// 가짜 글자: 상자 안에 어두운 점을 흩뿌린다(선 몇 개 + 점)
function drawText(bm, rect, color = [20, 20, 20]) {
  for (let y = rect.y + 4; y < rect.y + rect.h - 4; y += 3) fillRect(bm, { x: rect.x + 3, y, w: rect.w - 6, h: 1 }, color);
  for (let x = rect.x + 3; x < rect.x + rect.w - 3; x += 5) fillRect(bm, { x, y: rect.y + 2, w: 1, h: rect.h - 4 }, color);
}
// 세로 그라데이션 비트맵
function gradientBitmap(w, h, from, to) {
  const bm = makeBitmap(w, h, from);
  for (let y = 0; y < h; y++) { const t = y / (h - 1); fillRect(bm, { x: 0, y, w, h: 1 }, from.map((v, i) => Math.round(v + (to[i] - v) * t))); }
  return bm;
}
// 노이즈(사진 흉내)
function noiseBitmap(w, h, seed = 7) {
  const bm = makeBitmap(w, h);
  let s = seed;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < w * h; i++) { bm.data[i * 4] = r() * 255; bm.data[i * 4 + 1] = r() * 255; bm.data[i * 4 + 2] = r() * 255; bm.data[i * 4 + 3] = 255; }
  return bm;
}

test("cjkRatio / hasCJK", () => {
  assert.equal(cjkRatio("加厚材质"), 1);
  assert.equal(cjkRatio("承重可达15kg"), 4 / 8);
  assert.equal(cjkRatio("40*30*25cm"), 0);
  assert.equal(cjkRatio(""), 0);
  assert.equal(hasCJK("PP材料"), true);
  assert.equal(hasCJK("Model X-200"), false);
});

test("expandRect: 키우고 이미지 안으로 자른다", () => {
  assert.deepEqual(expandRect({ x: 10, y: 10, w: 20, h: 10 }, 4, 100, 100), { x: 6, y: 6, w: 28, h: 18 });
  assert.deepEqual(expandRect({ x: 2, y: 95, w: 20, h: 10 }, 4, 100, 100), { x: 0, y: 91, w: 26, h: 9 });
  assert.equal(expandRect({ x: 200, y: 10, w: 20, h: 10 }, 4, 100, 100).w, 0);
});

test("mergeBoxes: 겹치거나 가까운 상자만 합친다", () => {
  const boxes = [
    { x: 10, y: 10, w: 100, h: 30, text: "加厚", conf: 0.9 },
    { x: 112, y: 12, w: 50, h: 26, text: "材质", conf: 0.8 },  // 2px 떨어짐 → 합침
    { x: 10, y: 100, w: 100, h: 30, text: "大容量", conf: 0.7 }, // 멀다
    { x: 300, y: 100, w: 40, h: 30, text: "15kg", conf: 1, latin: true },
  ];
  const g = mergeBoxes(boxes, 6);
  assert.equal(g.length, 3);
  const first = g.find((x) => x.members.includes(0));
  assert.deepEqual(first.members, [0, 1]);
  assert.equal(first.text, "加厚 材质");
  assert.equal(first.conf, 0.8);
  assert.deepEqual({ x: first.x, y: first.y, w: first.w, h: first.h }, { x: 10, y: 10, w: 152, h: 30 });
  assert.equal(g.find((x) => x.members.includes(3)).latin, true);
  assert.equal(first.latin, false);
  assert.deepEqual(mergeBoxes([]), []);
});

test("estimateBackground: 단색이면 분산·거칠기 0, 색은 배경색", () => {
  const bm = makeBitmap(200, 100, [230, 240, 250]);
  const rect = { x: 20, y: 20, w: 120, h: 30 };
  drawText(bm, rect);
  const st = estimateBackground(bm, expandRect(rect, 4, bm.w, bm.h), 4);
  assert.deepEqual(st.color.map(Math.round), [230, 240, 250]);
  assert.equal(st.variance, 0);
  assert.equal(st.roughness, 0);
  assert.equal(st.gradient.left.length, 38);
  assert.equal(st.gradient.top.length, 128);
  assert.equal(toHex(st.color), "#faf0e6");
  assert.equal(decideErase(st), "erase");
});

test("estimateBackground: 그라데이션은 거칠기 작음 → erase, 노이즈는 → keep", () => {
  const g = gradientBitmap(300, 300, [40, 60, 120], [220, 200, 160]);
  const rect = { x: 30, y: 100, w: 200, h: 40 };
  const sg = estimateBackground(g, expandRect(rect, 4, g.w, g.h), 4);
  assert.ok(sg.roughness < 2, `gradient roughness ${sg.roughness}`);
  assert.equal(decideErase(sg), "erase");
  const n = noiseBitmap(300, 300);
  const sn = estimateBackground(n, expandRect(rect, 4, n.w, n.h), 4);
  assert.ok(sn.roughness > 30, `noise roughness ${sn.roughness}`);
  assert.equal(decideErase(sn), "keep");
  assert.equal(decideErase(null), "keep");
  assert.equal(decideErase({ samples: 0 }), "keep");
});

test("eraseRect(단색): 지운 영역이 배경색과 평균 차이 ≤ 12/255 (사실상 0)", () => {
  const bg = [250, 245, 240];
  const bm = makeBitmap(400, 200, bg);
  const rect = { x: 40, y: 60, w: 300, h: 40 };
  drawText(bm, rect);
  assert.ok(meanDiff(bm, rect, bg) > 20, "글자를 그렸으면 차이가 커야 한다");
  const r = expandRect(rect, 4, bm.w, bm.h);
  const n = eraseRect(bm, r, "interp");
  assert.equal(n, r.w * r.h);
  const d = meanDiff(bm, r, bg);
  assert.ok(d <= 12, `평균 차이 ${d}`);
  assert.equal(d, 0);
  // 단색 모드도 같다
  const bm2 = makeBitmap(400, 200, bg); drawText(bm2, rect); eraseRect(bm2, r, "solid");
  assert.equal(meanDiff(bm2, r, bg), 0);
});

test("eraseRect(그라데이션): 행별 보간이라 원래 그라데이션과 거의 같다", () => {
  const from = [30, 50, 110], to = [200, 190, 170];
  const g = gradientBitmap(400, 400, from, to);
  const ref = gradientBitmap(400, 400, from, to);
  const rect = { x: 40, y: 150, w: 300, h: 50 };
  drawText(g, rect, [255, 255, 255]);
  const r = expandRect(rect, 4, g.w, g.h);
  eraseRect(g, r);
  let s = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const i = (y * g.w + x) * 4;
    s += Math.abs(g.data[i] - ref.data[i]) + Math.abs(g.data[i + 1] - ref.data[i + 1]) + Math.abs(g.data[i + 2] - ref.data[i + 2]); n += 3;
  }
  assert.ok(s / n <= 3, `그라데이션 복원 오차 ${(s / n).toFixed(2)}`);
});

test("eraseRect: 이미지 가장자리에 붙은 상자(왼쪽 둘레 없음)도 메운다", () => {
  const bg = [10, 20, 30];
  const bm = makeBitmap(100, 100, bg);
  const rect = { x: 0, y: 0, w: 50, h: 20 };
  drawText(bm, rect, [200, 200, 200]);
  eraseRect(bm, rect);
  assert.equal(meanDiff(bm, rect, bg), 0);
  assert.equal(eraseRect(bm, { x: 200, y: 0, w: 10, h: 10 }), 0);
});

test("cleanBitmap: 단색 위 글자는 erased, 노이즈 위 글자는 kept/onPhoto", () => {
  const bm = makeBitmap(400, 400, [255, 255, 255]);
  // 아래 절반은 노이즈(사진)
  const nz = noiseBitmap(400, 200, 3);
  nz.data.copy(bm.data, 400 * 200 * 4);
  const top = { x: 40, y: 40, w: 200, h: 30, text: "加厚材质", conf: 0.9 };
  const top2 = { x: 244, y: 42, w: 60, h: 26, text: "耐用", conf: 0.9 }; // top 과 합쳐진다
  const bottom = { x: 40, y: 300, w: 200, h: 30, text: "实拍", conf: 0.9 };
  drawText(bm, top); drawText(bm, top2); drawText(bm, bottom, [255, 255, 255]);
  const r = cleanBitmap(bm, [top, top2, bottom]);
  assert.equal(r.erased, 2);
  assert.equal(r.kept, 1);
  assert.equal(r.boxesOut.length, 3);
  assert.equal(r.boxesOut[0].action, "erased");
  assert.equal(r.boxesOut[0].onPhoto, false);
  assert.equal(r.boxesOut[0].bg, "#ffffff");
  assert.equal(r.boxesOut[1].action, "erased");
  assert.equal(r.boxesOut[2].action, "kept");
  assert.equal(r.boxesOut[2].onPhoto, true);
  assert.equal(r.boxesOut[2].text, "实拍");
  assert.equal(meanDiff(bm, expandRect(top, 4, 400, 400), [255, 255, 255]), 0);
  // 상자가 없으면 아무것도 안 한다
  assert.deepEqual(cleanBitmap(bm, []), { erased: 0, kept: 0, boxesOut: [] });
});

// ---- 보완 1차: 여백 자르기 · 글자 띠 자르기 ----
test("findTrimRect: 가장자리 빈 여백을 minKeep 남기고 자른다, maxCut 넘게는 안 자른다", () => {
  const bm = makeBitmap(400, 1000, [255, 255, 255]);
  fillRect(bm, { x: 100, y: 300, w: 200, h: 200 }, [200, 210, 220]); // 가운데 도형
  const r = findTrimRect(bm, { tol: 10, minKeep: 24, maxCut: 0.6 });
  assert.equal(r.trimmed, true);
  assert.deepEqual({ x: r.x, y: r.y, w: r.w, h: r.h }, { x: 76, y: 276, w: 248, h: 248 });
  // 한 방향 최대 60%: 내용(줄무늬)이 맨 아래에 붙어 있으면 위는 600px 까지만, 아래는 안 자른다
  const bm2 = makeBitmap(400, 1000, [255, 255, 255]);
  for (let x = 0; x < 400; x += 2) fillRect(bm2, { x, y: 950, w: 1, h: 50 }, [0, 0, 0]);
  const r2 = findTrimRect(bm2, { tol: 10, minKeep: 24, maxCut: 0.6 });
  assert.equal(r2.y, 600 - 24);
  assert.equal(r2.h, 1000 - (600 - 24));
  assert.equal(r2.x, 0); assert.equal(r2.w, 400);
  // 가장자리에 붙은 "단색 띠"는 그 가장자리의 배경으로 보고 잘린다(규약: 가장자리 평균색 기준)
  const bm3 = makeBitmap(400, 1000, [255, 255, 255]);
  fillRect(bm3, { x: 0, y: 950, w: 400, h: 50 }, [0, 0, 0]);
  assert.equal(findTrimRect(bm3, { tol: 10, minKeep: 24, maxCut: 0.6 }).h, 1000 - 576 - 26);
  // 아무것도 없으면(전부 배경) 안 자른다 → 남는 영역이 너무 작아지므로 trimmed:false 가 아니라 maxCut 만큼… 양쪽 60% 는 100% 를 넘으므로 전체 유지
  const blank = makeBitmap(300, 300, [250, 250, 250]);
  const r3 = findTrimRect(blank);
  assert.equal(r3.trimmed, false);
  assert.equal(r3.blank, true);
  assert.equal(r.blank, false);
  assert.deepEqual({ x: r3.x, y: r3.y, w: r3.w, h: r3.h }, { x: 0, y: 0, w: 300, h: 300 });
  // 가장자리까지 내용이 차 있으면 안 자른다
  const full = makeBitmap(200, 200, [0, 0, 0]);
  fillRect(full, { x: 0, y: 0, w: 200, h: 1 }, [255, 0, 0]); fillRect(full, { x: 0, y: 199, w: 200, h: 1 }, [255, 0, 0]);
  fillRect(full, { x: 0, y: 0, w: 1, h: 200 }, [255, 0, 0]); fillRect(full, { x: 199, y: 0, w: 1, h: 200 }, [255, 0, 0]);
  assert.equal(findTrimRect(full).trimmed, false);
  // tol 안의 미세한 차이는 배경으로 본다
  const soft = makeBitmap(300, 300, [250, 250, 250]);
  fillRect(soft, { x: 0, y: 0, w: 300, h: 100 }, [245, 246, 247]);
  fillRect(soft, { x: 100, y: 150, w: 100, h: 50 }, [0, 0, 0]);
  const r4 = findTrimRect(soft, { tol: 10, minKeep: 10 });
  assert.equal(r4.y, 140);
});

test("bandCutRect: kept 상자가 위/아래 25% 안에만 있을 때만 띠를 자른다", () => {
  const top = { x: 10, y: 40, w: 300, h: 40, action: "kept", onPhoto: true };
  const bottom = { x: 10, y: 1100, w: 300, h: 40, action: "kept", onPhoto: true };
  const midE = { x: 10, y: 600, w: 300, h: 40, action: "erased", onPhoto: false };
  const midK = { x: 10, y: 600, w: 300, h: 40, action: "kept", onPhoto: true };
  assert.deepEqual(bandCutRect([top, midE], 790, 1200), { bandCut: true, cutTop: 86, cutBottom: 0 });
  assert.deepEqual(bandCutRect([bottom], 790, 1200), { bandCut: true, cutTop: 0, cutBottom: 106 });
  assert.deepEqual(bandCutRect([top, bottom], 790, 1200), { bandCut: true, cutTop: 86, cutBottom: 106 });
  assert.equal(bandCutRect([top, midK], 790, 1200).bandCut, false);
  assert.equal(bandCutRect([midE], 790, 1200).bandCut, false);
  assert.equal(bandCutRect([], 790, 1200).bandCut, false);
  // 띠가 너무 두꺼워 남는 게 40% 미만이면 안 자른다
  const thick = [{ x: 0, y: 0, w: 100, h: 290, action: "kept" }, { x: 0, y: 900, w: 100, h: 300, action: "kept" }];
  assert.equal(bandCutRect(thick, 790, 1200).bandCut, true); // 남는 598px = 50% ≥ 40%
  assert.equal(bandCutRect(thick, 790, 1200, { minRemain: 0.6 }).bandCut, false);
});

test("shiftBoxes / cropBitmap: 좌표 보정, 잘려 나간 상자 제거", () => {
  const boxes = [
    { x: 10, y: 40, w: 300, h: 40, text: "a" },   // 잘려 나감
    { x: 10, y: 200, w: 300, h: 40, text: "b" },  // 이동
    { x: 10, y: 80, w: 300, h: 40, text: "c" },   // 걸침 → 안쪽만
  ];
  const r = shiftBoxes(boxes, { x: 0, y: 100, w: 790, h: 1000 });
  assert.equal(r.length, 2);
  assert.deepEqual(r.find((b) => b.text === "b"), { x: 10, y: 100, w: 300, h: 40, text: "b" });
  assert.deepEqual(r.find((b) => b.text === "c"), { x: 10, y: 0, w: 300, h: 20, text: "c" });
  const bm = makeBitmap(100, 100, [1, 2, 3]);
  fillRect(bm, { x: 50, y: 50, w: 50, h: 50 }, [9, 9, 9]);
  const c = cropBitmap(bm, { x: 40, y: 40, w: 60, h: 60 });
  assert.equal(c.w, 60); assert.equal(c.h, 60);
  assert.deepEqual([c.data[0], c.data[1], c.data[2]], [1, 2, 3]);
  const last = (59 * 60 + 59) * 4;
  assert.deepEqual([c.data[last], c.data[last + 1], c.data[last + 2]], [9, 9, 9]);
  assert.equal(c.data[(10 * 60 + 10) * 4], 9); // (50,50) 원본 → (10,10)
  assert.equal(c.data[(9 * 60 + 9) * 4], 1);
});

test("contentRatio: 글자만 있던 빈 바탕(지운 뒤) < 0.03", () => {
  const bm = makeBitmap(790, 600, [230, 239, 244]);
  const rect = { x: 60, y: 60, w: 400, h: 44 };
  drawText(bm, rect);
  assert.ok(contentRatio(bm) > 0.01, "글자가 있으면 0이 아니다");
  eraseRect(bm, expandRect(rect, 4, bm.w, bm.h));
  const r = contentRatio(bm);
  assert.ok(r < 0.03, `빈 바탕 contentRatio ${r}`);
  assert.equal(r, 0);
  // 미세한 색 차이(tol 미만)는 내용으로 치지 않는다
  fillRect(bm, { x: 0, y: 0, w: 790, h: 300 }, [236, 244, 248]);
  assert.ok(contentRatio(bm, { tol: 14 }) < 0.03);
});

test("contentRatio: 사진(노이즈) > 0.3, 가운데 도형도 잡힌다", () => {
  const n = noiseBitmap(400, 400, 9);
  const r = contentRatio(n);
  assert.ok(r > 0.3, `사진 contentRatio ${r}`);
  const bm = makeBitmap(400, 400, [255, 255, 255]);
  fillRect(bm, { x: 100, y: 100, w: 200, h: 200 }, [200, 210, 220]);
  const r2 = contentRatio(bm);
  assert.ok(r2 > 0.2 && r2 < 0.3, `도형 1/4 면적 ≈ 0.25: ${r2}`);
  assert.equal(contentRatio({ data: Buffer.alloc(0), w: 0, h: 0 }), 0);
});

// ---- 재설계: 사진 영역 잘라내기 ----
// 일부 영역에 노이즈 사진을 깐 비트맵
function withPhoto(w, h, bg, rect, seed = 3) {
  const bm = makeBitmap(w, h, bg);
  const n = noiseBitmap(rect.w, rect.h, seed);
  for (let y = 0; y < rect.h; y++) n.data.copy(bm.data, ((rect.y + y) * w + rect.x) * 4, y * rect.w * 4, (y + 1) * rect.w * 4);
  return bm;
}
test("findPhotoRegion: 위 글자 + 아래 사진 → 아래 사진 영역", () => {
  const bm = withPhoto(400, 600, [255, 255, 255], { x: 0, y: 300, w: 400, h: 300 });
  const boxes = [{ x: 30, y: 40, w: 300, h: 50, text: "加厚材质" }, { x: 30, y: 120, w: 200, h: 30, text: "耐用" }];
  const r = findPhotoRegion({ w: 400, h: 600, boxes, bitmap: bm });
  assert.ok(r, "영역을 찾아야 한다");
  assert.ok(r.rect.y >= 150 + 6 - 16 && r.rect.y <= 304, `y ${r.rect.y}`); // 글자 아래부터
  assert.equal(r.rect.x, 0); assert.equal(r.rect.w, 400);
  assert.ok(r.rect.y + r.rect.h === 600, "아래 끝까지");
  assert.ok(r.contentRatio > 0.3 && r.coverage >= 0.3, `content ${r.contentRatio} coverage ${r.coverage}`);
  // 안쪽으로 걸친 상자 처리: 가장자리에 걸친 한 줄은 rect 를 줄인다
  const st = settleBoxesInRect(r.rect, [{ x: 10, y: r.rect.y - 10, w: 200, h: 30 }]);
  assert.ok(st.rect.y >= r.rect.y + 20 - 10 && st.residual.length === 0, JSON.stringify(st));
});
test("findPhotoRegion: 왼쪽 글자 + 오른쪽 사진 → 오른쪽 영역(가로 ≥55%)", () => {
  const bm = withPhoto(600, 400, [240, 240, 240], { x: 220, y: 0, w: 380, h: 400 }, 5);
  const boxes = [{ x: 20, y: 40, w: 160, h: 40, text: "产品特点" }, { x: 20, y: 200, w: 150, h: 30, text: "防水防潮" }, { x: 20, y: 340, w: 120, h: 30, text: "易清洗" }];
  const r = findPhotoRegion({ w: 600, h: 400, boxes, bitmap: bm });
  assert.ok(r, "영역을 찾아야 한다");
  assert.ok(r.rect.x >= 180 && r.rect.x <= 224, `x ${r.rect.x}`);
  assert.ok(r.rect.w >= 600 * 0.55 && r.rect.x + r.rect.w === 600, `w ${r.rect.w}`);
  assert.equal(r.rect.h, 400);
  assert.ok(r.contentRatio > 0.3);
});
test("findPhotoRegion: 글자만 있는 이미지 → null, 상자 없고 내용 없으면 null, 상자 없고 사진이면 전체", () => {
  const bm = makeBitmap(790, 700, [250, 250, 250]);
  const boxes = []; // 줄 간격 60px 로 전체에 글자
  for (let y = 40; y < 680; y += 60) boxes.push({ x: 60, y, w: 500, h: 36, text: "产品参数" });
  assert.equal(findPhotoRegion({ w: 790, h: 700, boxes, bitmap: bm }), null);
  assert.equal(findPhotoRegion({ w: 790, h: 700, boxes: [], bitmap: bm }), null); // 빈 바탕: contentRatio 0
  const photo = noiseBitmap(400, 300, 8);
  const r = findPhotoRegion({ w: 400, h: 300, boxes: [], bitmap: photo });
  assert.deepEqual(r.rect, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(r.coverage, 1);
  assert.ok(textureRatio(photo) > 0.3 && textureRatio(makeBitmap(100, 100, [9, 9, 9])) === 0);
});
test("trimEdgeBands: 단색 머리띠·밑줄 있는 띠·배지 조각은 잘리고, 흰 배경 전체는 안 잘린다", () => {
  // 위 40px 파란 띠(가운데 흰 밑줄 2px 포함) + 아래 사진
  const bm = withPhoto(400, 400, [160, 80, 30], { x: 0, y: 40, w: 400, h: 360 }, 4);
  fillRect(bm, { x: 150, y: 20, w: 100, h: 2 }, [255, 255, 255]);
  const r = trimEdgeBands(bm, { limitBase: { w: 400, h: 400 } });
  assert.ok(r.cut.top >= 40 && r.cut.top <= 48, `top ${r.cut.top}`);
  assert.equal(r.cut.bottom, 0); assert.equal(r.cut.left, 0); assert.equal(r.cut.right, 0);
  assert.equal(r.y, r.cut.top); assert.equal(r.h, 400 - r.cut.top);
  // 아래 오른쪽 1/3 폭만 차지하는 빨간 배지 조각(20px)
  const b2 = withPhoto(600, 400, [0, 0, 0], { x: 0, y: 0, w: 600, h: 400 }, 6);
  fillRect(b2, { x: 380, y: 380, w: 220, h: 20 }, [40, 40, 230]);
  const r2 = trimEdgeBands(b2, { limitBase: { w: 600, h: 400 } });
  assert.ok(r2.cut.bottom >= 20 && r2.cut.bottom <= 40, `bottom ${r2.cut.bottom}`);
  // 흰 배경 위 작은 제품: 한계까지 배경이 이어지므로 띠가 아니다
  const w = makeBitmap(400, 400, [255, 255, 255]);
  fillRect(w, { x: 150, y: 150, w: 100, h: 100 }, [30, 30, 30]);
  assert.deepEqual(trimEdgeBands(w).cut, { top: 0, bottom: 0, left: 0, right: 0 });
  // 띠 뒤 영역과 색이 비슷하면(ΔE 작음) 안 자른다
  const same = makeBitmap(300, 300, [100, 100, 100]);
  const nz = noiseBitmap(300, 260, 2); for (let i = 0; i < nz.data.length; i += 4) { nz.data[i] = 90 + nz.data[i] * 0.08; nz.data[i + 1] = 90 + nz.data[i + 1] * 0.08; nz.data[i + 2] = 90 + nz.data[i + 2] * 0.08; }
  nz.data.copy(same.data, 300 * 40 * 4);
  assert.equal(trimEdgeBands(same).cut.top, 0);
});

// ---- 보완(2026-10-09 저녁): 무늬 배경은 지우지 않고(kept+onPhoto) 한글 띠로 덮는다 · 사진 영역은 상품이 있는 쪽을 고른다 ----
// 대리석·타일 같은 저대비 무늬: 둘레는 매끈해 보이지만(roughness·variance 작음) 위·아래 띠가 열마다 다르게 어긋난다(mismatch 큼)
function marbleBitmap(w, h, base = [200, 200, 200], amp = 14) {
  const bm = makeBitmap(w, h, base);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = amp * Math.sin(x / 23) * Math.cos(y / 17) + (amp * 0.6) * Math.sin((x + y) / 31);
    const i = (y * w + x) * 4; bm.data[i] = base[0] + d; bm.data[i + 1] = base[1] + d; bm.data[i + 2] = base[2] + d;
  }
  return bm;
}
test("decideErase: 대리석 무늬(둘레 매끈·마주보는 띠 어긋남) → keep(onPhoto), 색 경계(단차)·그라데이션은 여전히 erase", () => {
  const m = marbleBitmap(400, 300);
  const rect = { x: 60, y: 120, w: 240, h: 48 };
  drawText(m, rect);
  const st = estimateBackground(m, expandRect(rect, 4, m.w, m.h), 4);
  assert.ok(st.roughness < ERASE_RULE.roughness && st.variance < ERASE_RULE.variance, `둘레는 매끈해 보인다 r${st.roughness.toFixed(1)} v${st.variance.toFixed(1)}`);
  assert.ok(st.mismatch > ERASE_RULE.mismatch, `mismatch ${st.mismatch.toFixed(1)} > ${ERASE_RULE.mismatch}`);
  assert.equal(decideErase(st), "keep");
  const r = cleanBitmap(m, [{ ...rect, text: "升级挂杆" }], {});
  assert.equal(r.kept, 1); assert.equal(r.erased, 0);
  assert.equal(r.boxesOut[0].action, "kept"); assert.equal(r.boxesOut[0].onPhoto, true);
  // 왼쪽 회색 · 오른쪽 파랑 단차를 가로지르는 상자: 위·아래 띠의 차이가 일정 → mismatch ≈ 0 → erase(단차는 보간이 그대로 살린다)
  const step = makeBitmap(400, 300, [200, 200, 200]); fillRect(step, { x: 200, y: 0, w: 200, h: 300 }, [200, 180, 170]);
  drawText(step, rect);
  const ss = estimateBackground(step, expandRect(rect, 4, step.w, step.h), 4);
  assert.ok(ss.mismatch < 1, `step mismatch ${ss.mismatch.toFixed(2)}`);
  assert.equal(decideErase(ss), "erase");
  const g = gradientBitmap(400, 300, [40, 60, 120], [220, 200, 160]); drawText(g, rect);
  const sg = estimateBackground(g, expandRect(rect, 4, g.w, g.h), 4);
  assert.ok(sg.mismatch < 1, `gradient mismatch ${sg.mismatch.toFixed(2)}`);
  assert.equal(decideErase(sg), "erase");
  assert.equal(decideErase({ samples: 10, roughness: 0, variance: 0, mismatch: 5.1 }), "keep");
  assert.equal(decideErase({ samples: 10, roughness: 0, variance: 0 }), "erase", "mismatch 가 없는 옛 통계는 그대로");
});

// 상품(어두운 물체)을 깐 비트맵: 테두리 색과 ΔE ≥ 70 이라 productMask 가 상품 칸으로 본다
function withProduct(w, h, bg, rect, seed = 3) {
  const bm = makeBitmap(w, h, bg);
  const n = noiseBitmap(rect.w, rect.h, seed);
  for (let i = 0; i < n.data.length; i += 4) { n.data[i] *= 0.35; n.data[i + 1] *= 0.35; n.data[i + 2] *= 0.35; }
  for (let y = 0; y < rect.h; y++) n.data.copy(bm.data, ((rect.y + y) * w + rect.x) * 4, y * rect.w * 4, (y + 1) * rect.w * 4);
  return bm;
}
test("productMask: 테두리 색과 뚜렷이 다른 칸만 상품, 흰 바탕만이면 0", () => {
  const bm = withProduct(400, 800, [230, 230, 230], { x: 0, y: 560, w: 400, h: 240 });
  const pm = productMask({ w: 400, h: 800, bitmap: bm });
  assert.equal(pm.cols, 25); assert.equal(pm.rows, 50);
  assert.ok(pm.count >= 25 * 14 && pm.count <= 25 * 16, `상품 칸 ${pm.count}`);
  assert.ok(pm.frac > 0.25 && pm.frac < 0.35, `frac ${pm.frac}`);
  assert.ok(pm.rect.y >= 544 && pm.rect.y + pm.rect.h === 800, JSON.stringify(pm.rect));
  assert.equal(productMask({ w: 200, h: 200, bitmap: makeBitmap(200, 200, [250, 250, 250]) }).count, 0);
  assert.equal(productMask({ w: 0, h: 0 }).count, 0);
});
test("findPhotoRegion: 위 글자 + 가운데 빈 벽 + 아래 상품 → 벽이 아니라 상품이 있는 아래 영역", () => {
  const bm = withProduct(400, 800, [230, 230, 230], { x: 0, y: 560, w: 400, h: 240 });
  const boxes = [{ x: 30, y: 40, w: 300, h: 50, text: "加厚材质" }, { x: 30, y: 110, w: 200, h: 30, text: "耐用" }];
  const r = findPhotoRegion({ w: 400, h: 800, boxes, bitmap: bm });
  assert.ok(r, "영역을 찾아야 한다");
  assert.ok(r.rect.y >= 528 && r.rect.y <= 560, `벽을 빼고 상품부터: y ${r.rect.y}`);
  assert.equal(r.rect.y + r.rect.h, 800); assert.equal(r.rect.w, 400);
  assert.ok(r.product && r.product.cells >= r.product.total * 0.9, JSON.stringify(r.product));
  // 상품 셀을 못 재면(흰 바탕 흰 상품) 예전처럼 면적 × 내용: 글자 아래 전체
  const plain = withPhoto(400, 800, [230, 230, 230], { x: 0, y: 560, w: 400, h: 240 }, 9);
  const r2 = findPhotoRegion({ w: 400, h: 800, boxes, bitmap: plain, product: false });
  assert.ok(r2 && r2.rect.y <= 160 && r2.rect.y + r2.rect.h === 800, JSON.stringify(r2?.rect));
});
test("findPhotoRegion: 상품이 글자 밑에 깔려 글자 없는 영역엔 빈 바탕뿐이면 null(자르지 않는다) · 상자 0개면 상품 위치와 상관없이 전체", () => {
  const bm = withProduct(400, 600, [230, 230, 230], { x: 0, y: 0, w: 400, h: 400 }, 4);
  const boxes = []; for (let y = 10; y < 380; y += 60) boxes.push({ x: 10, y, w: 380, h: 40, text: "产品参数" });
  // 아래 200px(33%)은 글자 없는 후보지만 상품 칸이 0 → 전체 상품 칸의 30% 미만 → null
  assert.equal(findPhotoRegion({ w: 400, h: 600, boxes, bitmap: bm }), null);
  const left = withProduct(400, 400, [230, 230, 230], { x: 0, y: 0, w: 200, h: 400 }, 5);
  const r = findPhotoRegion({ w: 400, h: 400, boxes: [], bitmap: left });
  assert.deepEqual(r.rect, { x: 0, y: 0, w: 400, h: 400 });
});

// ---- v2 누끼 후처리·팔레트 (image-core 만, 알파 비트맵은 직접 만든다) ----
test("v2 누끼: judgeCutout / cutoutRect / shrinkBboxByBoxes", async () => {
  const { judgeCutout, cutoutRect, shrinkBboxByBoxes } = await import("../../src/main/detail/image-core.js");
  assert.equal(judgeCutout({ x: 100, y: 100, w: 400, h: 400 }, 0.3, 800, 800).cutoutOk, true);
  assert.equal(judgeCutout(null, 0.3, 800, 800).cutoutOk, false);
  assert.match(judgeCutout({ x: 100, y: 100, w: 100, h: 100 }, 0.02, 800, 800).reason, /너무 작음/);
  assert.equal(judgeCutout({ x: 14, y: 236, w: 772, h: 329 }, 0.067, 800, 800).cutoutOk, true); // 가늘고 긴 봉(g05)
  assert.match(judgeCutout({ x: 0, y: 0, w: 790, h: 588 }, 0.64, 790, 588).reason, /장면 사진/);
  assert.equal(judgeCutout({ x: 0, y: 0, w: 600, h: 652 }, 0.55, 790, 652).cutoutOk, true); // 테두리에 닿아도 60% 이하면 제품
  assert.deepEqual(cutoutRect({ x: 100, y: 100, w: 200, h: 100 }, 800, 800, 0.12), { x: 76, y: 88, w: 248, h: 124 });
  assert.deepEqual(cutoutRect({ x: 0, y: 0, w: 200, h: 100 }, 150, 150, 0.12), { x: 0, y: 0, w: 150, h: 112 });
  const bb = { x: 50, y: 100, w: 700, h: 600 };
  const r = shrinkBboxByBoxes(bb, [{ x: 60, y: 650, w: 400, h: 40 }, { x: 300, y: 350, w: 200, h: 30 }]);
  assert.equal(r.cut, 1); // 아래 띠만(한가운데 상자는 그대로 — 구멍을 내지 않는다). pad = 높이 절반(20)
  assert.deepEqual(r.bbox, { x: 50, y: 100, w: 700, h: 530 });
  const r2 = shrinkBboxByBoxes(bb, [{ x: 60, y: 110, w: 400, h: 40 }, { x: 60, y: 650, w: 400, h: 40 }]);
  assert.deepEqual(r2.bbox, { x: 50, y: 170, w: 700, h: 460 }); // 위·아래 동시에
  assert.equal(shrinkBboxByBoxes(bb, [{ x: 300, y: 110, w: 30, h: 20 }]).cut, 0); // 작은 라벨("51")은 무시
  assert.equal(shrinkBboxByBoxes(bb, [{ x: 0, y: 100, w: 800, h: 500 }]).cut, 0); // 절반 넘게 잘리면 포기
});
test("v2 누끼: featherAlpha 가장자리만 줄이고 안쪽은 그대로, clearOutside", async () => {
  const { featherAlpha, clearOutside } = await import("../../src/main/detail/image-core.js");
  const bm = makeBitmap(40, 40, [0, 0, 0]);
  for (let i = 0; i < 40 * 40; i++) bm.data[i * 4 + 3] = 0;
  fillRect(bm, { x: 10, y: 10, w: 20, h: 20 }, [200, 200, 200]); // 알파 255
  featherAlpha(bm, 2);
  const a = (x, y) => bm.data[(y * 40 + x) * 4 + 3];
  assert.equal(a(20, 20), 255);
  assert.equal(a(10, 20), 85); // 1px 링 → 1/3
  assert.equal(a(11, 20), 170); // 2px 링 → 2/3
  assert.equal(a(12, 20), 255);
  assert.equal(bm.data[(20 * 40 + 10) * 4], 67); // premultiplied 색도 같이
  clearOutside(bm, { x: 15, y: 0, w: 100, h: 100 });
  assert.equal(a(12, 20), 0); assert.equal(a(20, 20), 255);
});
test("v2 팔레트: kmeansPalette / paletteFromBitmap(전경만, accent 는 채도 높은 색)", async () => {
  const { kmeansPalette, paletteFromBitmap } = await import("../../src/main/detail/image-core.js");
  const samples = [];
  for (let i = 0; i < 300; i++) samples.push([250, 250, 250]);
  for (let i = 0; i < 100; i++) samples.push([30, 30, 30]);
  for (let i = 0; i < 50; i++) samples.push([220, 20, 40]);
  const cl = kmeansPalette(samples, 5);
  assert.ok(cl.length >= 3 && cl[0].weight > 0.6, JSON.stringify(cl));
  assert.deepEqual(cl[0].rgb, [250, 250, 250]);
  // 알파 비트맵: 바깥은 투명(검정), 전경은 회색 + 빨간 띠
  const bm = makeBitmap(200, 200, [0, 0, 0]);
  for (let i = 0; i < 200 * 200; i++) bm.data[i * 4 + 3] = 0;
  fillRect(bm, { x: 40, y: 40, w: 120, h: 120 }, [180, 180, 180]);
  fillRect(bm, { x: 40, y: 40, w: 120, h: 20 }, [40, 20, 220]); // BGR → 빨강
  const p = paletteFromBitmap(bm, { step: 2 });
  assert.equal(p.dominant[0], "#b4b4b4");
  assert.equal(p.accent, "#dc1428");
  assert.equal(p.dark, false);
  assert.match(p.bg, /^#[0-9a-f]{6}$/);
  const darkBm = makeBitmap(50, 50, [20, 20, 20]);
  assert.equal(paletteFromBitmap(darkBm).dark, true);
  assert.equal(paletteFromBitmap({ data: Buffer.alloc(0), w: 0, h: 0 }).dominant.length, 1);
});

// ---- v6 원본 한글화(localize) 순수 로직 ----
test("localize: 숫자 판별·홍보·덩어리 묶기·역할", async () => {
  const c = await import("../../src/main/detail/image-core.js");
  for (const t of ["13.5cm", "37-57.5cm", "4.17kg/5.15kg", "20.5cml", "0060", "33.7 cm"]) assert.equal(c.isNumberText(t), true, t);
  for (const t of ["承重25kg", "矮款", "160人", "产品重量：4.17kg"]) assert.equal(c.isNumberText(t), false, t);
  assert.equal(c.isPromoText("东莞市中景家具有限公司"), true); assert.equal(c.isPromoText("来样定制"), true); assert.equal(c.isPromoText("防尘防潮"), false);
  const g = c.groupTextBlocks([{ x: 10, y: 10, w: 100, h: 40, text: "抽拉滑轨" }, { x: 120, y: 12, w: 90, h: 38, text: "防尘防潮" }, { x: 10, y: 100, w: 60, h: 20, text: "13.5cm" }, { x: 80, y: 100, w: 60, h: 20, text: "矮款" }]);
  assert.equal(g.length, 3);
  assert.equal(g[0].text, "抽拉滑轨 防尘防潮"); assert.deepEqual(g[0].members.sort(), [0, 1]);
  const roles = c.assignRoles([{ text: "桌面分层可抽拉收纳盒", h: 60 }, { text: "抽拉滑轨|防尘防潮|分层置物", h: 40, pill: true }, { text: "矮款", h: 40 }, { text: "13.5cm", h: 30 }, { text: "*以上数据为人工测量", h: 14 }, { text: "东莞市中景家具有限公司", h: 30 }, { text: "高温烤漆层", h: 120, th: 50 }], { imgH: 1400 });
  assert.deepEqual(roles.map((r) => r.role), ["title", "sub", "label", "number", "note", "promo", "label"]);
});

test("localize: 글자 스타일(색·굵기·크기·정렬)·알약 배너 감지", async () => {
  const c = await import("../../src/main/detail/image-core.js");
  // 흰 바탕 위 주황 테두리 알약(테두리 2px) 안에 주황 굵은 글자
  const bm = makeBitmap(600, 300, [235, 230, 225]); // 바깥 벽(BGR)
  fillRect(bm, { x: 100, y: 100, w: 400, h: 70 }, [255, 255, 255]); // 알약 채움(흰)
  for (const [x, y, w, h] of [[100, 100, 400, 2], [100, 168, 400, 2], [100, 100, 2, 70], [498, 100, 2, 70]]) fillRect(bm, { x, y, w, h }, [25, 160, 250]); // 주황 테두리
  const box = { x: 150, y: 115, w: 300, h: 40 };
  for (let x = 152; x < 448; x += 12) fillRect(bm, { x, y: 117, w: 6, h: 36 }, [25, 160, 250]); // 굵은 획(6px)
  const st = c.textStyle(bm, box, { imgW: 600 });
  assert.equal(st.color, "#faa019"); assert.ok(st.fontWeight >= 700, `weight ${st.fontWeight} stroke ${st.strokeRatio}`); assert.equal(st.align, "center"); assert.equal(st.fontSizePx, 37);
  const p = c.detectPill(bm, box);
  assert.equal(p.pill, true); assert.equal(p.borderColor, "#faa019");
  assert.ok(p.rect.x <= 100 && p.rect.x + p.rect.w >= 500 && p.rect.y <= 100 && p.rect.y + p.rect.h >= 170, JSON.stringify(p.rect));
  assert.equal(p.bgColor, "#ffffff"); // 채움이 바깥 벽과 다르다
  // 알약 없는 글(흰 바탕) → pill false
  const plain = makeBitmap(400, 200, [255, 255, 255]); drawText(plain, { x: 100, y: 80, w: 200, h: 30 });
  assert.equal(c.detectPill(plain, { x: 100, y: 80, w: 200, h: 30 }).pill, false);
  // 꽉 찬 색 띠 위 글(바탕이 끝없이 이어짐)도 알약 아님
  const band = makeBitmap(400, 200, [255, 255, 255]); fillRect(band, { x: 100, y: 80, w: 200, h: 30 }, [30, 30, 30]);
  assert.equal(c.detectPill(band, { x: 100, y: 80, w: 200, h: 30 }).pill, false);
});

test("localize: 지우기 방식 — 단색 interp, 밑줄 닿은 흰 바탕 solid(선은 살림), 사진 결 complex", async () => {
  const c = await import("../../src/main/detail/image-core.js");
  // 흰 바탕 + 글자 + 바로 아래 검은 밑줄(3px)
  const bm = makeBitmap(500, 200, [255, 255, 255]);
  const box = { x: 50, y: 40, w: 300, h: 50 };
  drawText(bm, box);
  fillRect(bm, { x: 40, y: 96, w: 320, h: 3 }, [10, 10, 10]);
  const area = c.safeEraseRect(bm, box, 10, [255, 255, 255]);
  assert.ok(area.y + area.h <= 96, `밑줄 앞에서 멈춤 ${JSON.stringify(area)}`); assert.equal(area.y, 30);
  const em = c.eraseMode(estimateBackground(bm, area, 4), { bm, rect: area });
  assert.equal(em.mode, "solid"); assert.deepEqual(em.color.map(Math.round), [255, 255, 255]);
  // 완전 단색 → interp
  const flat = makeBitmap(300, 120, [240, 240, 240]); drawText(flat, { x: 50, y: 30, w: 200, h: 40 });
  const fa = expandRect({ x: 50, y: 30, w: 200, h: 40 }, 6, 300, 120);
  assert.equal(c.eraseMode(estimateBackground(flat, fa, 4), { bm: flat, rect: fa }).mode, "interp");
  // 사진 결(미세 노이즈 ±6) → complex
  const wall = makeBitmap(300, 120, [200, 205, 210]);
  let s = 5; for (let i = 0; i < 300 * 120; i++) { s = (s * 1664525 + 1013904223) >>> 0; const n = ((s / 4294967296) - 0.5) * 12; for (let k = 0; k < 3; k++) wall.data[i * 4 + k] = Math.round(wall.data[i * 4 + k] + n); }
  drawText(wall, { x: 50, y: 30, w: 200, h: 40 });
  assert.equal(c.eraseMode(estimateBackground(wall, fa, 4), { bm: wall, rect: fa }).mode, "complex");
});

test("localize: AI 편집 붙이기 — 화면비·바깥 변화·색 맞춤 붙이기·다각형", async () => {
  const c = await import("../../src/main/detail/image-core.js");
  assert.equal(c.nearestAspect(790, 1222), "2:3"); assert.equal(c.nearestAspect(790, 602), "4:3"); assert.equal(c.nearestAspect(800, 800), "1:1");
  const orig = makeBitmap(160, 160, [100, 100, 100]);
  const ai = makeBitmap(160, 160, [110, 110, 110]); // AI 결과는 전체가 +10 밝아짐(재렌더)
  fillRect(ai, { x: 40, y: 40, w: 40, h: 40 }, [200, 200, 200]); // 글자 영역에서 바뀐 부분
  assert.ok(Math.abs(c.diffOutside(orig, ai, [{ x: 40, y: 40, w: 40, h: 40 }]) - 10) < 0.5);
  const moved = makeBitmap(160, 160, [100, 100, 100]); fillRect(moved, { x: 100, y: 100, w: 60, h: 60 }, [250, 250, 250]); // 글자 밖이 크게 바뀜(제품 변형)
  assert.ok(c.diffOutside(orig, moved, [{ x: 40, y: 40, w: 40, h: 40 }]) > 14);
  const dst = makeBitmap(160, 160, [100, 100, 100]);
  c.pasteMasks(dst, ai, [{ x: 40, y: 40, w: 40, h: 40 }], 1, 6);
  const at = (b, x, y) => b.data[(y * 160 + x) * 4];
  assert.equal(at(dst, 60, 60), 190); // 200 − 색 맞춤 10
  assert.equal(at(dst, 20, 20), 100); // 마스크 밖은 원본 그대로
  // 기울어진 다각형 마스크: 안쪽만 바뀐다
  const q = c.growQuad([60, 90, 100, 70, 105, 80, 65, 100], 0);
  assert.equal(q.length, 8);
  const d2 = makeBitmap(160, 160, [100, 100, 100]);
  c.pasteMasks(d2, ai, [{ x: 55, y: 65, w: 55, h: 40, poly: q }], 1, 4);
  assert.notEqual(at(d2, 82, 85), 100); assert.equal(at(d2, 58, 68), 100);
});

test("localize: fillPatch — 2차원 그라데이션을 Coons 보간으로 복원, 페더 띠, 이음새 ΔE, undo", async () => {
  const c = await import("../../src/main/detail/image-core.js");
  // 가로·세로가 함께 변하는 그라데이션(조명 얼룩 흉내)
  const W = 300, H = 200;
  const mk = () => { const b = makeBitmap(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, v = 120 + x * 0.3 + y * 0.25; b.data[i] = v; b.data[i + 1] = v - 10; b.data[i + 2] = v - 20; } return b; };
  const ref = mk(), bm = mk();
  const rect = { x: 80, y: 60, w: 140, h: 70 };
  drawText(bm, { x: 90, y: 70, w: 120, h: 50 });
  const r = c.fillPatch(bm, rect, { mode: "interp", feather: 8 });
  let s = 0, n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const i = (y * W + x) * 4; s += Math.abs(bm.data[i] - ref.data[i]); n++; }
  assert.ok(s / n < 1.5, `2차원 그라데이션 복원 오차 ${(s / n).toFixed(2)}`);
  assert.ok(r.seam < 2, `seam ${r.seam}`);
  assert.ok(r.n > rect.w * rect.h, "페더 띠까지 칠함");
  // 단색으로 채우면 2차원 그라데이션 위에서는 이음새가 크다(→ AI 로 넘길 근거)
  const bm2 = mk(); drawText(bm2, { x: 90, y: 70, w: 120, h: 50 });
  const r2 = c.fillPatch(bm2, rect, { mode: "solid", color: [150, 140, 130], feather: 0 });
  assert.ok(r2.seam > 6, `solid seam ${r2.seam}`);
  // undo 하면 원래대로(글자 포함)
  const before = Buffer.from(bm2.data); r2.undo();
  const orig = mk(); drawText(orig, { x: 90, y: 70, w: 120, h: 50 });
  assert.equal(Buffer.compare(bm2.data, orig.data), 0); assert.notEqual(Buffer.compare(before, orig.data), 0);
});
