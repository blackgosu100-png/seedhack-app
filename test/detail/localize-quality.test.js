// 원본 한글화 v11 품질 단위테스트 — 지우기 방식 결정(단색·그라데이션·결)·딱 떨어지는 채움·AI 붙이기 색 맞춤·잔상 검사·질감 복제·위치 맞춤 + 글자색 고르기·겹침 정리
// node --test test/detail/localize-quality.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { makeBitmap, fillRect, isEraseTarget, isIconGuess, strokeMask, inpaintMask, findShape, decideFill, fillSurface, inkMask, pasteAiPatch, residueCheck, cloneFill, colorFit, alignAi, colorGrid, lineFill } from "../../src/main/detail/image-core.js";

const at = (bm, x, y) => { const i = (y * bm.w + x) * 4; return [bm.data[i], bm.data[i + 1], bm.data[i + 2]]; };
const rand = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// 가짜 글자(획 몇 개)
const drawText = (bm, r, c = [250, 250, 250]) => { for (let y = r.y + 3; y < r.y + r.h - 3; y += 4) fillRect(bm, { x: r.x + 2, y, w: r.w - 4, h: 2 }, c); for (let x = r.x + 2; x < r.x + r.w - 2; x += 7) fillRect(bm, { x, y: r.y + 2, w: 2, h: r.h - 4 }, c); };
// 벽지 결: 바탕색 ± 잡음
const wall = (w, h, base = [120, 90, 80], amp = 14, seed = 3) => { const bm = makeBitmap(w, h, base), r = rand(seed); for (let i = 0; i < w * h; i++) { const n = (r() - 0.5) * amp; for (let k = 0; k < 3; k++) bm.data[i * 4 + k] = Math.max(0, Math.min(255, Math.round(base[k] + n))); } return bm; };
const meanIn = (bm, r) => { const s = [0, 0, 0]; let n = 0; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const c = at(bm, x, y); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++; } return s.map((v) => v / n); };

test("v11 지우기 결정: 평평한 바탕 = solid(스포이드 색), 1차 그라데이션 = gradient, 고른 결 = texture, 사진 = complex", () => {
  const flat = makeBitmap(300, 120, [236, 231, 226]); const r = { x: 60, y: 40, w: 160, h: 36 }; drawText(flat, r, [20, 20, 20]);
  const d1 = decideFill(flat, r); assert.equal(d1.mode, "solid"); assert.deepEqual(d1.color.map(Math.round), [236, 231, 226]);
  const grad = makeBitmap(300, 120); for (let y = 0; y < 120; y++) for (let x = 0; x < 300; x++) { const i = (y * 300 + x) * 4, v = 60 + x * 0.4 + y * 0.6; grad.data[i] = v; grad.data[i + 1] = v + 10; grad.data[i + 2] = v + 20; }
  drawText(grad, r); const d2 = decideFill(grad, r); assert.equal(d2.mode, "gradient"); assert.ok(d2.rmse < 1, `rmse ${d2.rmse}`);
  const tex = wall(300, 160); const rt = { x: 60, y: 60, w: 160, h: 36 }; drawText(tex, rt); assert.equal(decideFill(tex, rt).mode, "texture");
  const photo = wall(300, 160); fillRect(photo, { x: 0, y: 0, w: 140, h: 160 }, [30, 30, 30]); fillRect(photo, { x: 140, y: 0, w: 160, h: 70 }, [200, 210, 220]); drawText(photo, rt);
  assert.equal(decideFill(photo, rt).mode, "complex");
});

test("v11 채움: solid·gradient 는 페더 없이 딱 떨어지고(사각형 밖 픽셀 그대로) 잔상 검사 통과", () => {
  const bm = makeBitmap(300, 120, [236, 231, 226]); const r = { x: 60, y: 40, w: 160, h: 36 }; drawText(bm, r, [20, 20, 20]);
  const d = decideFill(bm, r); const out = at(bm, 59, 40);
  fillSurface(bm, r, { color: d.color });
  assert.deepEqual(at(bm, 100, 50), [236, 231, 226]); assert.deepEqual(at(bm, 59, 40), out);
  const res = residueCheck(bm, { x: 56, y: 36, w: 168, h: 44 }); assert.ok(res.pass, JSON.stringify(res));
  // 그라데이션: 면 그대로 복원(오차 < 1)
  const g = makeBitmap(300, 120); const ref = makeBitmap(300, 120);
  for (const b of [g, ref]) for (let y = 0; y < 120; y++) for (let x = 0; x < 300; x++) { const i = (y * 300 + x) * 4, v = 60 + x * 0.4 + y * 0.6; b.data[i] = v; b.data[i + 1] = v + 10; b.data[i + 2] = v + 20; }
  drawText(g, r); const dg = decideFill(g, r); fillSurface(g, r, { surface: dg.surface });
  let e = 0, n = 0; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { e += Math.abs(at(g, x, y)[0] - at(ref, x, y)[0]); n++; }
  assert.ok(e / n < 1, `그라데이션 오차 ${(e / n).toFixed(2)}`);
});

test("v11 잔상 검사: 흐린 밝은 상자·남은 글자는 떨어지고, 결을 그대로 옮긴 복제는 통과", () => {
  const r = { x: 80, y: 70, w: 140, h: 34 };
  const box = wall(320, 200); fillRect(box, r, [132, 102, 92]); // 결 없는 약간 밝은 상자(예전 AI·보간 흔적)
  const a = residueCheck(box, r); assert.equal(a.pass, false); assert.match(a.why, /흐림|색 얼룩|단차/);
  const left = wall(320, 200); drawText(left, r); const b = residueCheck(left, r); assert.equal(b.pass, false, "글자가 그대로면 떨어져야");
  const ok = wall(320, 200); drawText(ok, r);
  const ink = inkMask(ok, r, { color: [120, 90, 80], tol: 40, dilate: 2 });
  assert.ok(ink.ink > 0.1 && ink.ink < 0.9, `글자 비율 ${ink.ink}`);
  const c = cloneFill(ok, r, { avoid: [r], mask: ink.mask, bgColor: [120, 90, 80], tol: 40 });
  assert.ok(c.ok, "복제 자리 찾음");
  const res = residueCheck(ok, { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }); assert.ok(res.pass, JSON.stringify(res));
  // 복제 원본 자리에 선(바탕과 다른 픽셀)이 있으면 쓰지 않는다
  const lined = wall(320, 200); drawText(lined, r); for (let y = 0; y < 200; y += 12) fillRect(lined, { x: 0, y, w: 320, h: 2 }, [250, 250, 250]);
  const c2 = cloneFill(lined, r, { avoid: [r], mask: inkMask(lined, r, { color: [120, 90, 80], tol: 40 }).mask, bgColor: [120, 90, 80], tol: 40 });
  assert.equal(c2.ok, false, "깨끗한 조각이 없으면 포기");
});

test("v11 AI 붙이기: 둘레로 채널별 gain·offset 맞춤 → 바뀐 글자 픽셀에만 붙여 사각형 경계가 안 남는다", () => {
  const r = { x: 80, y: 70, w: 140, h: 34 };
  const orig = wall(320, 200); drawText(orig, r);
  const clean = wall(320, 200); // 글자 없는 같은 결
  const ai = { data: Buffer.from(clean.data), w: 320, h: 200 }; // AI 결과: 전체 톤이 0.9배 + 30(재렌더 색 차이)
  for (let i = 0; i < ai.data.length; i += 4) for (let k = 0; k < 3; k++) ai.data[i + k] = Math.round(clean.data[i + k] * 0.9 + 30);
  const cf = colorFit(orig, ai, r, { ring: 8 });
  assert.ok(Math.abs(cf.fit[0].a - 1 / 0.9) < 0.12, `gain ${cf.fit[0].a}`);
  const p = pasteAiPatch(orig, ai, r, { ring: 8 });
  assert.ok(p.coverage > 0.05 && p.coverage < 0.95, `coverage ${p.coverage}`);
  const res = residueCheck(orig, { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }); assert.ok(res.pass, JSON.stringify(res));
  const m = meanIn(orig, r), m0 = meanIn(clean, r); assert.ok(Math.abs(m[0] - m0[0]) < 3, `톤 ${m[0].toFixed(1)} vs ${m0[0].toFixed(1)}`);
  // 색 맞춤 없이 그대로 붙이면 톤이 어긋나 떨어진다(예전 흔적)
  const o2 = wall(320, 200); drawText(o2, r); for (let y = r.y; y < r.y + r.h; y++) ai.data.copy(o2.data, (y * 320 + r.x) * 4, (y * 320 + r.x) * 4, (y * 320 + r.x + r.w) * 4);
  assert.equal(residueCheck(o2, r).pass, false);
});

test("v11 AI 위치 맞춤: 1.5% 늘어나고 밀린 결과를 배율·이동으로 되돌린다", () => {
  const W = 300, H = 400, orig = makeBitmap(W, H, [200, 200, 200]);
  for (let k = 0; k < 9; k++) { fillRect(orig, { x: 20 + k * 30, y: 10, w: 8, h: H - 20 }, [40, 60, 90]); fillRect(orig, { x: 10, y: 30 + k * 40, w: W - 20, h: 6 }, [150, 40, 40]); }
  const ai = makeBitmap(W, H, [200, 200, 200]); const sx = 1.015, tx = 5, sy = 0.99, ty = -4; // ai(x) = orig((x - tx) / sx) 의 반대
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const ox = Math.round(x * sx + tx), oy = Math.round(y * sy + ty); if (ox < 0 || oy < 0 || ox >= W || oy >= H) continue; const i = (y * W + x) * 4, j = (oy * W + ox) * 4; for (let c = 0; c < 3; c++) ai.data[i + c] = orig.data[j + c]; }
  const al = alignAi(orig, ai, []);
  assert.ok(Math.abs(al.sx - sx) < 0.006 && Math.abs(al.tx - tx) < 2.5, `x ${al.sx} ${al.tx}`);
  assert.ok(Math.abs(al.sy - sy) < 0.006 && Math.abs(al.ty - ty) < 2.5, `y ${al.sy} ${al.ty}`);
});

test("v11 결 방향 채움: 세로 줄무늬(커튼)는 세로로만 잇고, 결이 다르면 거절", () => {
  const W = 300, H = 160, cur = makeBitmap(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, v = 80 + 40 * Math.sin(x / 9); cur.data[i] = v; cur.data[i + 1] = v; cur.data[i + 2] = v + 30; }
  const ref = { data: Buffer.from(cur.data), w: W, h: H }, r = { x: 60, y: 60, w: 160, h: 36 }; drawText(cur, r);
  assert.ok(lineFill(cur, r, { dir: "v" }).ok);
  let e = 0, n = 0; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { e += Math.abs(at(cur, x, y)[0] - at(ref, x, y)[0]); n++; }
  assert.ok(e / n < 2, `세로 결 오차 ${(e / n).toFixed(2)}`);
  const c2 = { data: Buffer.from(ref.data), w: W, h: H }; drawText(c2, r);
  assert.equal(lineFill(c2, r, { dir: "h" }).ok, false, "가로로 끌면 줄이 생기니 거절");
  const g = colorGrid(ref, 24); assert.equal(g.c.length, g.cols * g.rows * 6);
});

// ── 템플릿 순수 계산(loc-core.js) ──
const LC = (() => { const ctx = {}; vm.runInNewContext(fs.readFileSync(fileURLToPath(new URL("../../src/renderer/detail-templates/localize/loc-core.js", import.meta.url)), "utf8"), ctx); return ctx.LocCore; })();

test("v11 글자색: 어두운 사진 위 어두운 글자(hero 1.2:1) → 흰색, 밝은 바탕은 짙은 검정, 충분하면 그대로", () => {
  const navy = [[22, 30, 52], [25, 34, 58], [20, 28, 49]];
  const p = LC.pickInk("#111418", navy, true); assert.equal(p.changed, true); assert.equal(p.color, "#ffffff"); assert.ok(p.con >= 3, `${p.con}`);
  const q = LC.pickInk("#f5f5f5", [[236, 231, 226], [240, 238, 230]], false); assert.equal(q.color, "#111111"); assert.ok(q.con >= 4.5);
  const k = LC.pickInk("#ffffff", navy, false); assert.equal(k.changed, false); assert.equal(k.color, "#ffffff");
  // 얼룩덜룩한 바탕(밝은 칸 섞임)에서 아슬아슬하면 그림자
  // 원본 흰 글자가 중간 파랑 위에서 4.1:1 — 검정도 비슷하면 흰색 그대로 + 그림자(디자인 유지)
  const mid = LC.pickInk("#ffffff", [[106, 122, 160], [105, 121, 159]], false); assert.equal(mid.color, "#ffffff"); assert.ok(mid.shadow && mid.boosted);
  const busy = LC.pickInk("#777777", [[30, 30, 30], [200, 200, 200], [60, 60, 60], [40, 40, 40]], true); assert.ok(busy.shadow, "그림자");
  const g = { cell: 10, cols: 2, rows: 1, c: "000000ffffff" }; assert.equal(JSON.stringify(LC.cellsIn(g, 0, 0, 20, 10)), "[[0,0,0],[255,255,255]]"); assert.equal(JSON.stringify(LC.cellsIn(g, 12, 0, 18, 5)), "[[255,255,255]]"); // vm 영역 배열이라 JSON 으로 비교
});

test("v11 겹침 정리: 줄바꿈으로 길어진 윗글 → 아랫글을 내리고, 같은 줄은 줄이고, 자리가 없으면 줄인다 — 반복하면 겹침 0", () => {
  // 간단한 모형: shrink 는 높이·너비를 0.93 배(위쪽 고정), move 는 이동
  const run = (rects, fixed, H) => { const rs = rects.map((r) => ({ ...r })); let steps = 0; for (; steps < 80; steps++) { const f = LC.nextFix(rs, fixed, H); if (!f) break; if (f.move) { rs[f.move.i].t += f.move.dy; rs[f.move.i].b += f.move.dy; } for (const i of f.shrink || []) { const r = rs[i]; r.b = r.t + (r.b - r.t) * 0.93; r.r = r.l + (r.r - r.l) * 0.93; } if (f.lift) { rs[f.lift.i].t += f.lift.dy; rs[f.lift.i].b += f.lift.dy; } } return { rs, steps }; };
  const noHit = (rs, fixed = []) => rs.every((a, i) => rs.every((b, j) => i === j || !LC.hit(a, b)) && fixed.every((f) => !LC.hit(a, f)));
  // 안경 세척기 d01: "세척으로 / 말끔하게"(두 줄로 늘어남)가 "깊은 오염 제거" 위를 덮음
  const a = run([{ l: 57, t: 101, r: 380, b: 260 }, { l: 46, t: 186, r: 400, b: 280 }, { l: 55, t: 312, r: 470, b: 360 }], [], 1400);
  assert.ok(noHit(a.rs)); assert.ok(a.rs[1].t >= 260, "아랫글을 내림"); assert.ok(a.rs[2].t >= a.rs[1].b, "그 아래도 연쇄로");
  // 같은 줄 옆으로 닿은 라벨 → 줄임
  const b = run([{ l: 10, t: 100, r: 130, b: 130 }, { l: 120, t: 101, r: 240, b: 131 }], [], 400); assert.ok(noHit(b.rs));
  // 이미지 아래 끝: 내릴 자리가 없으면 줄여서 해결
  const c = run([{ l: 10, t: 300, r: 200, b: 380 }, { l: 10, t: 360, r: 200, b: 396 }], [], 400); assert.ok(noHit(c.rs)); assert.ok(c.rs[1].b <= 400);
  // 그림에 남긴 숫자(못 움직임)와 겹치면 글을 내림
  const fx = [{ l: 0, t: 200, r: 300, b: 230 }];
  const d = run([{ l: 20, t: 190, r: 200, b: 220 }], fx, 600); assert.ok(noHit(d.rs, fx));
});

test("v11 지울 글 판정: 한자가 있어야 지운다 — 곡선 영문 장식(OCR 이 \"O4NIBEARIN。\" 로 읽음)·영문·숫자는 그대로", () => {
  assert.equal(isEraseTarget("O4NIBEARIN。"), false); // 안경 세척기 d02 회귀: 끝의 "。" 때문에 지워져 얼룩이 남았던 것
  assert.equal(isEraseTarget("Ultrasonic Wave"), false); assert.equal(isEraseTarget("360°"), false); assert.equal(isEraseTarget("（ ）"), false);
  assert.equal(isIconGuess({ text: "甲", conf: 0.3 }), true); assert.equal(isIconGuess({ text: "净", conf: 1 }), false); assert.equal(isIconGuess({ text: "梳子", conf: 0.3 }), false); // d10 빗 아이콘을 "甲" 로 읽음
  assert.equal(isEraseTarget("全方位净化"), true); assert.equal(isEraseTarget("HOLD住更多好物"), true); assert.equal(isEraseTarget("26S净澈牙套"), true);
});

test("v11.1 획 인페인팅: 기울어진 판 경계를 가로지르는 글 — 글자 획만 메우고 판 경계는 원본 그대로(사각형 자국 없음)", () => {
  const W = 260, H = 160, mk = () => { const b = makeBitmap(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, top = y < 80 - x * 0.35; const v = top ? 200 + y * 0.2 : 120 + y * 0.3; b.data[i] = v - 60; b.data[i + 1] = v - 20; b.data[i + 2] = v; } return b; }; // 위 판(밝은 주황) / 아래 판(짙은 주황), 사선 경계
  const ref = mk(), bm = mk(), area = { x: 40, y: 20, w: 180, h: 100 };
  for (let k = 0; k < 6; k++) fillRect(bm, { x: 55 + k * 26, y: 40 + k * 4, w: 4, h: 40 }, [40, 50, 60]); // 세로 획들(일부는 경계를 가로지름)
  const m = strokeMask(bm, area, { textColor: [40, 50, 60], dilate: 1, localThr: 22, win: 9 });
  assert.ok(inpaintMask(bm, area, m.mask).ok);
  let worst = 0; for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) { const i = (y * W + x) * 4, near = Math.abs(y - (80 - x * 0.35)) < 3; if (!near) worst = Math.max(worst, Math.abs(bm.data[i + 2] - ref.data[i + 2])); }
  assert.ok(worst < 12, `경계에서 떨어진 곳 최대 오차 ${worst}`);
  let out = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if ((x < area.x || x >= area.x + area.w || y < area.y || y >= area.y + area.h) && bm.data[i] !== ref.data[i]) out++; }
  assert.equal(out, 0, "영역 밖은 그대로");
});

test("v12.1 도형 찾기: 원 배지(귀퉁이 빔 → round·circle 판단은 localize), 이미지 아래 끝에 붙은 띠도 닫힌 도형, 열린 바탕은 null", () => {
  const W = 400, H = 300, bm = makeBitmap(W, H, [240, 240, 240]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if ((x - 300) ** 2 + (y - 80) ** 2 < 50 * 50) { const i = (y * W + x) * 4; bm.data[i] = 30; bm.data[i + 1] = 30; bm.data[i + 2] = 200; } } // 빨간 원(BGR)
  fillRect(bm, { x: 0, y: 250, w: W, h: 50 }, [40, 140, 240]); // 아래 끝 주황 띠
  fillRect(bm, { x: 285, y: 70, w: 30, h: 20 }, [255, 255, 255]); // 원 안 흰 글자
  const c = findShape(bm, { x: 280, y: 65, w: 40, h: 30 }, [30, 30, 200]);
  assert.ok(c && c.round, "원"); assert.ok(Math.abs(c.rect.w - 100) <= 3 && Math.abs(c.rect.h - 100) <= 3, JSON.stringify(c?.rect));
  const b = findShape(bm, { x: 50, y: 260, w: 300, h: 30 }, [40, 140, 240]);
  assert.ok(b && !b.round && b.rect.w === W, "아래 띠");
  assert.equal(findShape(bm, { x: 40, y: 40, w: 60, h: 20 }, [240, 240, 240]), null, "열린 바탕");
});
