// 이미지 입출력(Electron nativeImage) — 픽셀 로직은 image-core.js 에 있고 여기서는 읽고/쓰고/자르고/줄이기만 한다.
// 규약: docs/detail/CONTRACTS.md 4절
import { nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { cleanBitmap, findTrimRect, bandCutRect, shiftBoxes, cropBitmap, contentRatio, findPhotoRegion, settleBoxesInRect, textureRatio, trimEdgeBands, productMask, cutoutRect, judgeCutout, featherAlpha, paletteFromBitmap, shrinkBboxByBoxes, clearOutside, findFrameRect, fitContentRect } from "./image-core.js";
export { shiftBoxes }; // 잘라낸 만큼 상자 좌표 보정(index.js 가 쓴다)

// 파일 → nativeImage (png/jpg 는 createFromPath, 그 밖(webp 등)은 버퍼로 한 번 더 시도)
function readImage(file) {
  let im = nativeImage.createFromPath(file);
  if (im.isEmpty()) { try { im = nativeImage.createFromBuffer(fs.readFileSync(file)); } catch {} }
  if (im.isEmpty()) throw new Error(`이미지를 읽지 못했습니다: ${file}`);
  return im;
}
const ensureDir = (file) => fs.mkdirSync(path.dirname(file), { recursive: true });
// 확장자에 맞춰 저장(jpg/jpeg → JPEG 품질 90, 나머지 PNG)
function writeImage(im, out) {
  ensureDir(out);
  const ext = path.extname(out).toLowerCase();
  fs.writeFileSync(out, ext === ".jpg" || ext === ".jpeg" ? im.toJPEG(90) : im.toPNG());
}

// 파일 → { data: Buffer(BGRA), w, h }
export function loadBitmap(file) {
  const im = readImage(file);
  const { width: w, height: h } = im.getSize();
  return { data: Buffer.from(im.toBitmap()), w, h }; // toBitmap 은 BGRA(왼쪽 위부터 행 순서)
}
// { data, w, h } → PNG 파일
export function saveBitmap(bitmap, out) {
  const im = nativeImage.createFromBitmap(bitmap.data, { width: bitmap.w, height: bitmap.h });
  writeImage(im, out);
  return out;
}
// { ratio:true } 면 contentRatio(가장자리 배경색과 다른 픽셀 비율)도 함께
export function imageInfo(file, { ratio = false } = {}) {
  if (ratio) { const bm = loadBitmap(file); return { w: bm.w, h: bm.h, contentRatio: contentRatio(bm) }; }
  const { width: w, height: h } = readImage(file).getSize();
  return { w, h };
}
// 가로를 width 로 맞춰 저장(세로는 비율 유지). 원본이 더 작아도 키운다(규약: 780 고정).
export function resizeToWidth(file, out, width = 780) {
  const im = readImage(file);
  const { width: w, height: h } = im.getSize();
  const r = w === width ? im : im.resize({ width, height: Math.max(1, Math.round((h * width) / w)), quality: "best" });
  writeImage(r, out);
  const s = r.getSize();
  return { out, w: s.width, h: s.height };
}
// 사각형 영역만 잘라 저장(이미지 밖은 잘라냄)
export function cropRect(file, out, rect) {
  const im = readImage(file);
  const { width: W, height: H } = im.getSize();
  const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));
  const w = Math.max(1, Math.min(W - x, Math.round(rect.w))), h = Math.max(1, Math.min(H - y, Math.round(rect.h)));
  const c = im.crop({ x, y, width: w, height: h });
  writeImage(c, out);
  return { out, w, h };
}

// 글자 상자를 배경으로 메운 PNG 저장.
// 반환: { out, w, h, erased, kept, boxesOut:[{ ...box, action, bg, onPhoto }] }
export function cleanImage({ file, boxes, out, pad = 4, ring = 4 }) {
  const bm = loadBitmap(file);
  const list = Array.isArray(boxes) ? boxes : [];
  const r = cleanBitmap(bm, list, { pad, ring });
  saveBitmap(bm, out);
  return { out, w: bm.w, h: bm.h, erased: r.erased, kept: r.kept, boxesOut: r.boxesOut };
}

// ---- 보완 1차 ----
// 지운 뒤 가장자리의 빈 여백(배경과 거의 같은 행·열)을 잘라낸다. 반환 { out, w, h, rect, trimmed, blank(내용이 전혀 없는 이미지), contentRatio(트림 뒤 내용 비율 0~1) }
export function autoTrim(file, out, opts = {}) {
  const bm = loadBitmap(file);
  const rect = findTrimRect(bm, opts);
  if (!rect.trimmed) { if (path.resolve(file) !== path.resolve(out)) saveBitmap(bm, out); return { out, w: bm.w, h: bm.h, rect: { x: 0, y: 0, w: bm.w, h: bm.h }, trimmed: false, blank: !!rect.blank, contentRatio: contentRatio(bm) }; }
  const c = cropBitmap(bm, rect);
  saveBitmap(c, out);
  return { out, w: c.w, h: c.h, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, trimmed: true, blank: !!rect.blank, contentRatio: contentRatio(c) }; // contentRatio 는 트림 뒤 이미지 기준
}
// kept(사진 위) 상자가 위/아래 가장자리 25% 안에만 있으면 그 글자 띠를 잘라낸다.
// 반환 { out, w, h, bandCut, cutTop, cutBottom, boxesOut(새 좌표, 잘려 나간 상자는 뺌) }
export function cropTextBand(file, boxesOut, out, opts = {}) {
  const bm = loadBitmap(file);
  const band = bandCutRect(boxesOut, bm.w, bm.h, opts);
  if (!band.bandCut) { if (path.resolve(file) !== path.resolve(out)) saveBitmap(bm, out); return { out, w: bm.w, h: bm.h, bandCut: false, cutTop: 0, cutBottom: 0, boxesOut: (boxesOut || []).map((b) => ({ ...b })) }; }
  const rect = { x: 0, y: band.cutTop, w: bm.w, h: bm.h - band.cutTop - band.cutBottom };
  const c = cropBitmap(bm, rect);
  saveBitmap(c, out);
  return { out, w: c.w, h: c.h, bandCut: true, cutTop: band.cutTop, cutBottom: band.cutBottom, boxesOut: shiftBoxes(boxesOut, rect) };
}

// ---- 재설계: 글자 없는 사진 영역만 잘라낸다 ----
// cropPhoto(file, boxes, out, opts) → { out, w, h, rect(원본 좌표), coverage(크롭 면적/원본), contentRatio, texture,
//                                       residual(안에서 지운 상자 수 | 지우지 못해 남긴 상자 목록[{…box, action:"kept", onPhoto:true, bg}](원본 좌표 — 호출자가 한글 띠로 덮는다)),
//                                       cutTop, cutBottom(장식 띠로 잘라낸 px, 원본 기준), product:{ frac(원본의 상품 셀 비율 0~1), count, rect, share(잘라낸 영역이 담은 상품 칸 비율, ok 일 때) }, ok }
// ok=false 면 파일을 만들지 않는다 — 글자만 있는 이미지, 상품이 글자 밑에 깔려 글자 없는 영역엔 벽만 남는 이미지(product 로 알 수 있다), 납작한 조각(h<260 · w/h>3.2), 내용 없는 조각(contentRatio<0.15 · 질감<0.05).
// 순서: productMask(상품 셀) → findPhotoRegion(상품이 있는 글자 없는 영역) → 걸친 상자 정리(settleBoxesInRect, 안쪽은 cleanBitmap: 못 지우면 kept 로 돌려준다) → trimEdgeBands(머리띠·바닥띠) → autoTrim(빈 여백).
export function cropPhoto(file, boxes, out, opts = {}) {
  const bm = loadBitmap(file);
  const list = Array.isArray(boxes) ? boxes : [];
  const prod = productMask({ w: bm.w, h: bm.h, bitmap: bm, grid: opts.grid ?? 16, ...(opts.product || {}) });
  const product = { frac: prod.frac, count: prod.count, rect: prod.rect };
  const none = (extra) => ({ out: null, w: bm.w, h: bm.h, rect: null, coverage: 0, contentRatio: 0, texture: 0, residual: 0, cutTop: 0, cutBottom: 0, product, ok: false, ...extra });
  const { product: _p, ...fopts } = opts;
  const found = findPhotoRegion({ w: bm.w, h: bm.h, boxes: list, bitmap: bm, ...fopts, product: prod });
  if (!found) return none();
  if (found.product?.total) product.share = found.product.cells / found.product.total; // 잘라낸 영역이 담은 상품 칸 비율(0~1) — 면적비(coverage)가 작아도 상품 대부분을 담았으면 갤러리·hero 에 쓸 수 있다
  const { rect, residual } = settleBoxesInRect(found.rect, list);
  let c = cropBitmap(bm, rect);
  const inner = shiftBoxes(residual.map((b, k) => ({ ...b, _k: k })), rect);
  let keptInside = [];
  if (inner.length) { // 안쪽에 남은 상자는 기존 방식(배경 판단 → 보간)으로 지운다. 배경이 무늬라 못 지운 상자는 원본 좌표로 돌려준다
    const r = cleanBitmap(c, inner, {});
    keptInside = r.boxesOut.filter((b) => b.action === "kept").map((b) => ({ ...residual[b._k], action: "kept", onPhoto: true, bg: b.bg }));
  }
  let fin = { x: rect.x, y: rect.y, w: c.w, h: c.h };
  const eb = trimEdgeBands(c, { limitBase: { w: bm.w, h: bm.h }, ...(opts.band || {}) }); // 한 변 최대 원본의 20%(15% 로는 d20 의 150px 머리띠가 경계에 걸려 남는다)
  if (eb.cut.top || eb.cut.bottom || eb.cut.left || eb.cut.right) { c = cropBitmap(c, eb); fin = { x: fin.x + eb.x, y: fin.y + eb.y, w: c.w, h: c.h }; }
  const t = findTrimRect(c, { tol: opts.trimTol ?? 10, minKeep: opts.minKeep ?? 16, maxCut: opts.maxCut ?? 0.6 });
  if (t.trimmed) { c = cropBitmap(c, t); fin = { x: fin.x + t.x, y: fin.y + t.y, w: c.w, h: c.h }; }
  const cr = contentRatio(c), tx = textureRatio(c);
  const base = { rect: fin, coverage: (fin.w * fin.h) / (bm.w * bm.h), contentRatio: cr, texture: tx, residual: keptInside.length ? keptInside : inner.length, cutTop: eb.cut.top, cutBottom: eb.cut.bottom, product };
  const minH = opts.minH ?? 260, maxAspect = opts.maxAspect ?? 3.2;
  if (c.h < minH || c.w / c.h > maxAspect || cr < (opts.minContent ?? 0.15) || tx < (opts.minTexture ?? 0.05) || c.w < 64) return none(base);
  saveBitmap(c, out);
  return { out, w: c.w, h: c.h, ...base, ok: true };
}

// ---- v2 누끼 ----
// cutout-mac 이 만든 알파 PNG 를 다듬어 저장: bbox 로 여백 margin 두고 자르기 → 가장자리 페더 → 제품 단독 컷 판정(judgeCutout) → 팔레트
// 반환 { out, w, h, rect(원본 좌표의 잘라낸 사각형), cutoutOk, reason, palette }. cutoutOk=false 면 파일을 만들지 않는다.
// boxes(OCR 글자 상자)를 주면 전경 경계의 위/아래/좌/우 가장자리 25% 안에 걸친 글자·배지는 그 띠째 잘라낸다(제품 위에 얹힌 배지가 누끼에 딸려 오는 것 방지).
export function finishCutout(file, out, { bbox, coverage, margin = 0.12, feather = 2, boxes = null } = {}) {
  const bm = loadBitmap(file);
  const j = judgeCutout(bbox, coverage, bm.w, bm.h);
  if (!j.cutoutOk) return { out: null, w: bm.w, h: bm.h, rect: null, cutoutOk: false, reason: j.reason, palette: null, textCut: 0 };
  const sb = boxes?.length ? shrinkBboxByBoxes(bbox, boxes) : { bbox, cut: 0 };
  const rect = cutoutRect(sb.bbox, bm.w, bm.h, margin);
  let c = cropBitmap(bm, rect);
  if (sb.cut) clearOutside(c, { x: sb.bbox.x - rect.x, y: sb.bbox.y - rect.y, w: sb.bbox.w, h: sb.bbox.h }); // 잘라낸 띠 쪽 전경(배지·글자)은 투명하게
  c = featherAlpha(c, feather);
  saveBitmap(c, out);
  return { out, w: c.w, h: c.h, rect, cutoutOk: true, reason: "", palette: paletteFromBitmap(c), textCut: sb.cut };
}
// 파일 → { dominant:[hex…5], accent, bg, dark } (알파 PNG 면 전경 픽셀만)
export function palette(file) {
  return paletteFromBitmap(loadBitmap(file));
}

// 생성 이미지의 액자 테두리 제거 — 액자가 있으면 안쪽만 원래 화면비로 잘라 out(기본 같은 파일)에 저장. 반환 { stripped, rect, w, h }
export function stripFrame(file, out = file, opts = {}) {
  const bm = loadBitmap(file);
  const rect = findFrameRect(bm, opts);
  if (!rect) { if (path.resolve(out) !== path.resolve(file)) saveBitmap(bm, out); return { stripped: false, rect: null, w: bm.w, h: bm.h }; }
  const c = cropBitmap(bm, rect);
  saveBitmap(c, out);
  return { stripped: true, rect, w: c.w, h: c.h };
}

// 생성 장면의 빈 가장자리(30% 초과)를 잘라 원래 화면비로 맞춘다. 반환 { fitted, tooSmall, rect, emptyFrac, contentFrac, w, h }
export function fitContent(file, out = file, opts = {}) {
  const bm = loadBitmap(file);
  const r = fitContentRect(bm, opts);
  if (!r.rect) { if (path.resolve(out) !== path.resolve(file)) saveBitmap(bm, out); return { fitted: false, ...r, w: bm.w, h: bm.h }; }
  const c = cropBitmap(bm, r.rect);
  saveBitmap(c, out);
  return { fitted: true, ...r, w: c.w, h: c.h };
}
