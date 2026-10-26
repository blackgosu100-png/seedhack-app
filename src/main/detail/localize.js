// v6 원본 한글화 — 중국 상세 이미지를 새로 만들지 않고, 원본 그대로 중국어 글자(와 알약 배너)만 지운 뒤 한글 글자 레이어 정보를 돌려준다.
// 제품 크기·모양은 100% 원본. 비용: 평평한·그라데이션 바탕 글자는 JS 로 지움(0원), 결·사진 위 글자가 있는 장만 Gemini 이미지 편집 1회(장당 약 $0.04).
// v11(2026-10-12 대표님 "총체적 난국" — 흐린 사각형·잔상): 영역마다 둘레 링을 재서
//   solid(스포이드 색, 딱 떨어지게) · gradient(둘레로 맞춘 면) → 페더·흐림 없이 바로 채움
//   texture·complex → 후보(질감 복제 · AI 결과를 글자 모양 마스크에만 + 둘레 색 맞춤 · 보간)를 각각 잔상 검사해 통과한 것 중 우선순위로
//   다 지운 뒤 최종 잔상 검사, 떨어진 영역은 다른 방법으로 다시. 결과는 layer.erase{ method, decide, tried, residue }
// AI 편집 결과는 원본과 픽셀 비교 → 글자 영역 밖이 많이 바뀌었으면(제품 변형·구도 이동) 버린다. 받아들여도 **바뀐 글자 픽셀만** 원본 위에 붙인다.
//
// localizeImage({ file, ocrBoxes, out, ai?, aiModel?, aiOut?, settings?, env?, log?, fetchImpl? })
//   → { out, w, h, promo:bool, layers:[{ x,y,w,h, zh, role, style:{ color, bgColor, pill, borderColor, fontWeight, fontSizePx, align }, erased:"js"|"ai"|"kept", how, erase }], ai:{ used, accepted, diff, ms, model, error? } }
import { nativeImage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBitmap, saveBitmap } from "./image.js";
import { classifyLocalizeImage, priceListOf } from "./localize-core.js";
import { groupTextBlocks, assignRoles, inferLayout, textStyle, detectPill, expandRect, ringMode, safeEraseRect, fillPatch, isNumberText, nearestAspect, diffOutside, decideFill, fillSurface, inkMask, isEraseTarget, isIconGuess, pasteAiPatch, cloneFill, cloneTiles, synthFill, lineFill, dirFill, strokeMask, inpaintMask, growQuad, dilateMask, findShape, shapeClip, findRules, inkColorClip, residueCheck, snapshot, restore, alignAi } from "./image-core.js";

const noop = () => {};
// 순수 도우미(화면비·픽셀 비교·붙이기)는 image-core.js 에 있다(Node 단위테스트 가능)
export { nearestAspect, diffOutside, pasteMasks, growQuad } from "./image-core.js";

export const AI_PROMPT = "Remove only the listed Chinese text; keep every banner, pill, badge, shape, line and every other pixel identical; do not change the product."; // v13 알약·띠는 남긴다(원본 장식 유지 — 알약을 지우면 그 자리가 띠 모양으로 비던 것, 빨래건조대 d16)
function aiPrompt(blocks, W, H) {
  const list = blocks.map((b) => `"${b.text}" at about ${Math.round(((b.x + b.w / 2) / W) * 100)}% from left, ${Math.round(((b.y + b.h / 2) / H) * 100)}% from top`).join("; ");
  return `${AI_PROMPT} Text to remove: ${list}. Fill each removed area with the surrounding surface so it looks like the text was never there. Keep the exact same framing, size, perspective and composition — no crop, no zoom, no shift. Keep all numbers and measurements that are not listed. Do not add any new text, logo or object.`;
}

export async function localizeImage({ file, ocrBoxes = [], keepBoxes = [], out, ai = true, ocrCheck = true, imgKind = "detail", aiModel = null, aiOut = null, settings = {}, env = process.env, log = noop, fetchImpl, maxDiff = 14, minConf = 0.15 } = {}) {
  const bm = loadBitmap(file);
  const W = bm.w, H = bm.h;
  const orig = { data: Buffer.from(bm.data), w: W, h: H }; // 지우기 전 원본(글자 마스크·AI 비교·다시 시도용)
  // 기울어진 글(Vision quad): 글자 두께 th = 좌상→좌하 거리, 기울기 angle(도)
  const thOf = (b) => (b.vertical ? b.w : Array.isArray(b.quad) && b.quad.length === 8 ? Math.round(Math.hypot(b.quad[6] - b.quad[0], b.quad[7] - b.quad[1])) : b.h);
  // 한자가 든 글만(숫자 치수는 아래에서 "number" 로 남김) — 영문·기호만 있는 장식 글은 묶지도 지우지도 않는다
  const boxes = (ocrBoxes || []).filter((b) => b && String(b.text || "").trim() && b.w > 0 && b.h > 0 && (b.conf == null || b.conf >= minConf) && (isEraseTarget(b.text) || isNumberText(b.text)) && !isIconGuess(b))
    .map((b) => ({ ...b, th: thOf(b), angle: Math.abs(b.angle || 0) > 3 ? +b.angle : 0 }));
  let blocks = groupTextBlocks(boxes.filter((b) => !b.angle && !b.vertical && !b.seam)).concat(boxes.filter((b) => b.angle || b.vertical || b.seam).map((b, i) => ({ ...b, members: [i] }))); // 기울어진 글·세로쓰기(v13.2)는 묶지 않는다
  // 알약·스타일은 지우기 전에 원본에서 잰다(기울어진 글은 알약 감지 안 함)
  blocks = blocks.map((b) => {
    const num = isNumberText(b.text);
    let pill = num || b.angle || b.vertical ? { pill: false } : detectPill(bm, b);
    const st = textStyle(bm, b, { imgW: W });
    if (!pill.pill && !num && !b.angle && !b.vertical) { // v13 색을 채운 알약(카드 위 흰 알약 — 테두리선이 없어 detectPill 이 못 찾음): 글 바로 둘레 색의 닫힌 둥근 도형
      const inner = innerMode(bm, b, [st.colorBGR, hexBGR(st.outline)]), sh = inner && findShape(bm, expandRect(b, 1, W, H), inner, { pad: Math.round(b.h * 1.6) });
      if (sh && (sh.round || sh.rect.w >= sh.rect.h * 2) && sh.n >= sh.rect.w * sh.rect.h * 0.35 && sh.rect.x > 2 && sh.rect.y > 2 && sh.rect.x + sh.rect.w < W - 2 && sh.rect.y + sh.rect.h < H - 2 && sh.rect.h <= b.h * 2.6 && sh.rect.w <= b.w + b.h * 4 && sh.rect.w >= b.w * 0.95 && sh.rect.h >= b.h) pill = { pill: true, rect: sh.rect, bgColor: toHexBGR(inner), borderColor: null, filled: true };
    }
    if (b.th && b.th !== b.h) st.fontSizePx = Math.round(b.th * 0.92);
    return { ...b, pill: !!pill.pill, pillInfo: pill, style: st };
  });
  blocks = inferLayout(assignRoles(blocks, { imgH: H }), { imgW: W }); // v13 정렬·칸 라벨은 배치로(줄에 나란한 칸 → 가운데, 세로 묶음 → 맞는 끝)
  // 판매자 홍보 이미지(공장·인증·맞춤제작): 상세페이지에서 보통 빼므로 AI 편집에 돈을 쓰지 않는다(JS 로만)
  const textBlocks = blocks.filter((b) => b.role !== "number");
  const promoN = textBlocks.filter((b) => b.role === "promo").length;
  const STRONG = /有限公司|合作伙伴|COOPERATIVE|专利证书|工厂人员|厂房|定制流程|我们的优势/i; // 회사 소개·협력사·인증서 페이지에만 나오는 말
  const promo = textBlocks.length > 0 && (promoN >= 2 || promoN / textBlocks.length >= 0.4 || textBlocks.some((b) => STRONG.test(b.text)));
  if (promo) ai = false;
  // v12: 상세페이지에서 뺄 이미지(구매 유도·가격 설명·판매 정책·후기·중국어 사양표)는 AI 지우기에 돈을 쓰지 않는다
  const skipCls = classifyLocalizeImage(boxes.map((b) => ({ zh: b.text, h: b.th || b.h })), { imgH: H, kind: imgKind });
  if (skipCls) ai = false;
  // 영역: 알약이면 알약 전체, 아니면 글자 상자를 넓히되 밑줄·테두리선 앞에서 멈춤(선은 살린다)
  const items = blocks.map((b) => {
    const st = b.style;
    const style = { ...(b.vertical ? { vertical: true } : {}), color: st.color, bgColor: b.pillInfo?.bgColor || null, pill: b.pill, borderColor: b.pillInfo?.borderColor || null, fontWeight: st.fontWeight, fontSizePx: st.fontSizePx, align: st.align, ...(st.outline ? { outline: st.outline } : {}), ...(b.angle ? { rotate: b.angle } : {}) };
    const pad = Math.max(4, Math.round((b.th || b.h) * 0.15));
    if (!b.angle && !b.vertical && !b.pill && st.colorBGR) { const e = extendTruncated(bm, b, st.colorBGR, [...boxes, ...(keepBoxes || [])]); if (e) { b = { ...b, x: e.x, w: e.w }; b.extended = true; } } // OCR 가 줄 끝 글자를 빠뜨린 경우(대파 d09 "费") — 같은 줄 바로 옆 같은 색 획까지 지울 영역에
    // v13 알약은 남기고 그 안 글만 지운다(알약 안쪽으로 줄인 사각형) — 한글은 알약(layer.shape) 안에 맞춘다(도형 밖 금지). 예전엔 알약째 지우고 새로 그려 결 바탕 위에 띠 자국이 남았다
    const pr = b.pill && b.pillInfo.rect ? { ...b.pillInfo.rect } : null;
    let area = b.angle ? expandRect(b, pad, W, H) : safeEraseRect(bm, b, pad, ringMode(bm, expandRect(b, pad, W, H), 6).color);
    if (pr) { const ix = Math.max(2, Math.round(pr.h * 0.12)), x0 = Math.max(area.x, pr.x + ix), y0 = Math.max(area.y, pr.y + ix), x1 = Math.min(area.x + area.w, pr.x + pr.w - ix), y1 = Math.min(area.y + area.h, pr.y + pr.h - ix); if (x1 - x0 > 4 && y1 - y0 > 4) area = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; Object.assign(style, { pill: false, bgColor: null, borderColor: null }); }
    return { b, area, pillRect: pr, layer: { x: area.x, y: area.y, w: area.w, h: area.h, text_box: { x: b.x, y: b.y, w: b.w, h: b.h }, zh: b.text, role: b.role, style, erased: "kept", ...(b.seam != null ? { seam: b.seam } : {}) } };
  });
  // v13 나란한 알약끼리 영역이 겹치면(알약 찾기가 옆 알약 테두리까지 한 덩어리로 잡음 — 컵홀더 d10 "客厅收纳·卧室收纳·餐厅收纳") 두 글 사이 가운데에서 나눈다
  for (const p of items) for (const q of items) {
    if (p === q || !p.pillRect || !q.pillRect || p.b.x >= q.b.x) continue;
    const a = p.pillRect, c = q.pillRect; if (Math.min(a.x + a.w, c.x + c.w) <= Math.max(a.x, c.x) || Math.min(a.y + a.h, c.y + c.h) <= Math.max(a.y, c.y)) continue;
    const mid = Math.round((p.b.x + p.b.w + q.b.x) / 2); a.w = Math.max(p.b.x + p.b.w - a.x + 2, mid - 2 - a.x); const r = c.x + c.w; c.x = Math.min(q.b.x - 2, mid + 2); c.w = r - c.x;
  }
  items.forEach((x) => { if (!x.pillRect) return; x.pillInner = innerMode(bm, x.b, [x.b.style?.colorBGR, hexBGR(x.b.style?.outline)]); x.layer.shape = { ...x.pillRect, color: toHexBGR(x.pillInner), round: true, circle: false, pill: true }; });
  const areas = items.map((x) => x.area);
  const done = new Set(); // 이미 지운 영역(그 자리는 이웃 둘레로 써도 된다)
  const skipOf = (k) => (x, y) => areas.some((a, j) => j !== k && x >= a.x - 2 && x < a.x + a.w + 2 && y >= a.y - 2 && y < a.y + a.h + 2); // 다른 글자 영역은 둘레 재기에서 뺀다
  const checkRect = (a) => expandRect(a, 4, W, H); // 붙이기 페더(2px)까지 포함해 검사
  const check = (k) => residueCheck(bm, checkRect(areas[k]), { skip: skipOf(k), strict: items[k].d?.mode === "texture" });
  const badness = (r) => r.edge + Math.max(0, r.tone - r.toneMax) + (/흐림/.test(r.why) ? 6 : 0) + (/잔상/.test(r.why) ? 12 : 0) + (/조각 얼룩/.test(r.why) ? 4 + 3 * (r.blkIn || 0) : 0);
  // 1) 평평한·그라데이션 바탕 → 바로 채움(0원)
  const todo = [];
  items.forEach((x, k) => {
    const { b, area, layer } = x;
    if (b.role === "number") return; // 치수는 그대로
    const d = x.pillInner ? { mode: "solid", color: x.pillInner, frac: 1, sd: 0, pill: true } /* v13 알약 안 글: 알약 안쪽 색으로(둘레 링은 알약 테두리에 걸려 색이 틀어진다 — 컵홀더 d10) */ : b.angle ? { mode: "complex", color: ringMode(orig, area, 6).color } : decideFill(orig, area, { skip: skipOf(k) });
    if (!d.color) d.color = ringMode(orig, area, 6).color; // 둘레가 다른 글로 다 덮여 잴 수 없을 때(대표 사진 비교표 등) // 사선 위 글(판 경계가 지나감)은 AI 후보
    x.d = d;
    layer.how = d.mode === "solid" ? "solid" : d.mode === "gradient" ? "interp" : "complex"; // copy.rewriteOk 가 읽는 예전 이름(solid·interp·complex)
    layer.erase = { method: null, decide: { mode: d.mode, frac: d.frac, sd: d.sd, ...(d.rmse != null ? { rmse: d.rmse, order: d.order } : {}), ...(d.spread != null ? { spread: d.spread } : {}) } };
    if (d.mode === "solid" || d.mode === "gradient") {
      const fill = d.mode === "solid" ? { color: d.color } : { surface: d.surface };
      const sClip = b.pill ? null : shapeClip(orig, area, d.color); // v13 원·띠 테두리에 닿은 글: 도형 안만 칠함
      const hex2bgr = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const v = parseInt(m[1], 16); return [v & 255, (v >> 8) & 255, v >> 16]; };
      const cClip = b.pill || !b.style?.colorBGR ? null : inkColorClip(orig, d.mode === "solid" ? () => d.color : (x, y) => d.surface.at(x, y), [b.style.colorBGR, hex2bgr(b.style.outline)]); // v13 글자색 픽셀만(옆 장식은 남김)
      const clip = sClip && cClip ? (x, y) => sClip(x, y) && cClip(x, y) : sClip || cClip;
      fillSurface(bm, area, { ...fill, ...(clip ? { clip } : {}) });
      if (cClip) { x.inkClip = { fill, sClip }; layer.erase.clip = sClip ? "shape+ink" : "ink"; } else if (sClip) layer.erase.clip = "shape"; // 글이 남으면 아래(remainOf 정의 뒤)에서 사각형 전체로
      layer.erase.method = d.mode; layer.erased = "js"; done.add(k);
    }
    else todo.push(k);
  });
  let aiBm = null; // AI 편집 결과(받아들인 경우만)
  // 후보 만들기: 각 후보는 apply() 가 bm 을 바꾸고 undo 를 돌려준다(원본 상태에서 시작)
  const candidates = (k) => {
    const { b, area, d } = items[k];
    const th = b.th || b.h;
    const tol = Math.max(24, (d.sd || 4) * 4);
    // 글자 획 + 옅은 그림자(9px 평균 밝기가 바탕과 4 넘게 다른 곳 — 결 바탕에서 제목 그림자가 글자 모양 얼룩으로 남던 것, d01 실측) + 여유
    const ink = inkMask(orig, area, { color: d.color, tol, dilate: Math.max(b.style?.outline ? 4 : 2, Math.round(th * (b.style?.outline ? 0.16 : 0.08))), /* v13 테두리·그림자 글자는 획 둘레도(테두리 자국이 글자 모양으로 남던 것 — 빨래건조대 d16) */ soft: d.mode === "texture" ? 9 : 0, softTol: 4 }).mask;
    // v13 결 복제·합성도 글자색 픽셀만 바꾼다(글 옆 주황 타원을 직선으로 자르던 것 — 컵홀더 d07): 글자 마스크 ∩ 바탕↔글자색 선분 위 픽셀
    if (!b.angle && b.style?.colorBGR && d.color) { const hx = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const v = parseInt(m[1], 16); return [v & 255, (v >> 8) & 255, v >> 16]; }; const cc = inkColorClip(orig, () => d.color, [b.style.colorBGR, hx(b.style.outline)], 60), r0 = (() => { const x = Math.max(0, Math.round(area.x)), y = Math.max(0, Math.round(area.y)); return { x, y, w: Math.max(0, Math.min(W, Math.round(area.x + area.w)) - x), h: Math.max(0, Math.min(H, Math.round(area.y + area.h)) - y) }; })(); let kept = 0, tot = 0; const m2 = new Uint8Array(ink.length); for (let y = 0; y < r0.h; y++) for (let x = 0; x < r0.w; x++) { const j = y * r0.w + x; if (!ink[j]) continue; tot++; if (cc(r0.x + x, r0.y + y)) { m2[j] = 1; kept++; } } if (tot && kept / tot >= 0.5) { const dl = dilateMask(m2, r0.w, r0.h, 1); ink.set(dl.map((v, j) => (v && ink[j] ? 1 : 0))); } } // 글자색 추정이 빗나가면(절반 넘게 빠짐) 그대로
    const list = [];
    if (aiBm) list.push({ method: "ai", apply: () => pasteAiPatch(bm, aiBm, area, { skip: skipOf(k), ink, near: b.pill ? 0 : Math.max(4, Math.round(th * 0.2)) }) }); // v13 알약이 아니면 글자 획 근처만
    const tex = d.mode !== "complex"; // 조각 복제·결 합성은 고른 결 바탕에서만(사선 판·사진 위에 쓰면 모자이크처럼 깨진다 — 커피 랙 d07 실측)
    if (tex) list.push({ method: "clone", apply: () => { const r = cloneFill(bm, area, { avoid: areas, mask: ink, bgColor: d.color, tol: tol + 6 }); return r.ok ? r : null; } });
    if (tex) list.push({ method: "synth", apply: () => { const r = synthFill(bm, area, { avoid: areas, ringAvoid: areas.filter((a, j) => j !== k && !done.has(j)), mask: ink, bgColor: d.color, tol: tol + 6 }); return r.ok ? r : null; } }); // 큰 글자: 밝기는 둘레 면 + 결만 옆 조각에서
    if (tex) list.push({ method: "tiles", apply: () => { const r = cloneTiles(bm, area, { avoid: areas, mask: ink, bgColor: d.color, tol: tol + 6 }); return r.ok ? r : null; } }); // 큰 글자: 칸으로 나눠 복제
    list.push({ method: "vlines", apply: () => { const r = lineFill(bm, area, { dir: "v", skip: skipOf(k), mask: ink }); return r.ok ? r : null; } }); // 세로 결(커튼 주름)
    list.push({ method: "hlines", apply: () => { const r = lineFill(bm, area, { dir: "h", skip: skipOf(k), mask: ink }); return r.ok ? r : null; } }); // 가로 결
    { // 획 인페인팅: 글자색 획(+2px)만 바깥→안으로 주변 픽셀로 메움 — 사각형을 칠하지 않아 판 모서리·그라데이션이 원본 그대로(기울어진 글은 네 꼭짓점 안만)
      const tc = b.style?.colorBGR, poly = b.angle && Array.isArray(b.quad) ? growQuad(b.quad, Math.max(10, Math.round(th * 0.6))) : null;
      if (tc) list.push({ method: "inpaint", apply: () => { const sm = strokeMask(orig, area, { textColor: tc, tol: 70, dilate: 2, poly, ...(d.mode === "complex" ? { localThr: 22, win: 9 } : {}) });
        if (d.mode === "complex") { const sc = strokeMask(orig, area, { textColor: tc, tol: 40, dilate: 0, poly }), weak = strokeMask(orig, area, { textColor: tc, dilate: 0, poly, localThr: 8, win: 9 }), add = new Uint8Array(sm.mask.length); for (let i = 0; i < add.length; i++) if (sc.mask[i] && weak.mask[i]) add[i] = 1; const ad = dilateMask(add, sm.rect.w, sm.rect.h, 2); for (let i = 0; i < ad.length; i++) if (ad[i]) sm.mask[i] = 1; } /* 판 모서리 그림자 옆 획은 주변 대비가 약해 글자색으로도 잡는다 */ const sh = inkMask(orig, area, { color: d.color, tol: 9999, dilate: 0, soft: d.mode === "texture" ? 9 : 0, softTol: 4 }).mask; for (let i = 0; i < sm.mask.length; i++) if (sh[i] && !poly) sm.mask[i] = 1; return inpaintMask(bm, area, sm.mask); } });
    }
    list.push({ method: "dir", apply: () => { const r = dirFill(bm, area, { mask: ink, angle: b.angle || 0 }); return r.ok ? r : null; } }); // 글줄 방향으로 양끝 바탕을 이음(사선 판·띠)
    list.push({ method: "interp", apply: () => { const r = fillPatch(bm, area, { mode: "interp", feather: 4 }); return r; } }); // 마지막 대안(보간 + 얇은 페더)
    return list;
  };
  // 글자 남음: 원본 글자 획 자리(글자색에 가깝고 바탕색과 먼 픽셀)가 지운 뒤에도 바탕보다 글자색에 가까우면 안 지워진 것(AI 가 글을 남기거나 흐리게 다시 그린 경우 — d13 가죽 바탕에서 실측)
  const remainOf = (k) => (items[k].d?.mode === "complex" && items[k].b.style?.colorBGR ? remainLocal(k) : remainColor(k));
  // 사진·판 위(complex): 글자색 추정이 바탕과 섞여 빗나가므로 "주변보다 뚜렷이 어두운/밝은 획"이 지운 뒤에도 같은 자리에 남은 비율로(커피 랙 d07 실측: 색 기준은 판 색을 글자로 오인해 93%)
  const remainLocal = (k) => {
    const { area, b } = items[k], o = strokeMask(orig, area, { textColor: b.style.colorBGR, dilate: 0, localThr: 28 }), c = strokeMask(bm, area, { textColor: b.style.colorBGR, dilate: 0, localThr: 28 });
    let n = 0, same = 0; for (let i = 0; i < o.mask.length; i++) if (o.mask[i]) { n++; if (c.mask[i]) same++; }
    return n >= 20 ? same / n : 0;
  };
  // v13 새 얼룩: 지운 뒤 "주변보다 뚜렷이 어둡거나 밝은 획"이 원본에 없던 자리에 생긴 비율(원본 획 수 대비) — 획 인페인팅이 남은 글자 가장자리 색을 안으로 번져
  //   갈색 덩어리를 만들던 것(탄소강 풀아웃 d07 기울어진 층 라벨). 0.15 넘으면 그 결과는 쓰지 않는다
  const newInk = (k) => {
    const { area, b } = items[k], tc = b.style?.colorBGR; if (!tc) return 0;
    const poly = b.angle && Array.isArray(b.quad) ? growQuad(b.quad, Math.max(6, Math.round((b.th || b.h) * 0.3))) : null;
    const o = strokeMask(orig, area, { textColor: tc, dilate: 2, localThr: 28, poly }), c = strokeMask(bm, area, { textColor: tc, dilate: 0, localThr: 28, poly });
    // 글자와 반대 밝기의 새 자국(어두운 글 자리에 생긴 밝은 줄무늬 — 컵홀더 d07)도 센다: 반대 극성 마스크를 원본·지금 둘 다
    const inv = (lum3(tc) > 128 ? [0, 0, 0] : [255, 255, 255]), oi = strokeMask(orig, area, { textColor: inv, dilate: 2, localThr: 28, poly }), ci = strokeMask(bm, area, { textColor: inv, dilate: 0, localThr: 28, poly });
    let n = 0, fresh = 0; for (let i = 0; i < o.mask.length; i++) { if (o.mask[i]) n++; else if (c.mask[i] || (ci.mask[i] && !oi.mask[i])) fresh++; }
    if (n < 20) return 0;
    if (poly) return fresh / n;
    // 곧은 글: 큰 글자는 획이 많아 비율이 작게 나온다 → 둘레 바탕의 원래 "도드라진 점" 밀도와도 비교(복제가 컵 조각을 옮겨 온 것 — 컵홀더 d03)
    const ringR = expandRect(area, Math.max(8, Math.round((b.th || b.h) * 0.6)), W, H), rm = strokeMask(orig, ringR, { textColor: tc, dilate: 0, localThr: 28 });
    let rn = 0, rh = 0; for (let y = 0; y < rm.rect.h; y++) for (let x = 0; x < rm.rect.w; x++) { const X = rm.rect.x + x, Y = rm.rect.y + y; if (X >= area.x && X < area.x + area.w && Y >= area.y && Y < area.y + area.h) continue; rn++; if (rm.mask[y * rm.rect.w + x]) rh++; }
    const dens = fresh / Math.max(1, o.mask.length), ringD = rn ? rh / rn : 0;
    return dens > Math.max(0.012, ringD * 2.5) ? Math.max(fresh / n, 0.16) : fresh / n;
  };
  // v13 새 사각형 경계: 지운 상자 네 변을 따라 안(2px)·밖(3px) 밝기 차이가 원본보다 뚜렷이 커진 변이 있으면(중앙값 +10, 60% 이상 +8) — 흐린·어두운 사각형(대파 d18 결 합성)
  const lumAt = (b0, x, y) => { const i = (y * W + x) * 4; return 0.114 * b0.data[i] + 0.587 * b0.data[i + 1] + 0.299 * b0.data[i + 2]; };
  const rectEdge = (k) => {
    const a = areas[k], inOther = (x, y) => areas.some((o, j) => j !== k && x >= o.x - 2 && x < o.x + o.w + 2 && y >= o.y - 2 && y < o.y + o.h + 2) || (keepBoxes || []).some((o) => x >= o.x - 2 && x < o.x + o.w + 2 && y >= o.y - 2 && y < o.y + o.h + 2); // 남기는 영문·숫자 옆 변은 비교하지 않는다
    const sides = [[(t) => [a.x + t, a.y + 2], (t) => [a.x + t, a.y - 3], a.w], [(t) => [a.x + t, a.y + a.h - 3], (t) => [a.x + t, a.y + a.h + 2], a.w], [(t) => [a.x + 2, a.y + t], (t) => [a.x - 3, a.y + t], a.h], [(t) => [a.x + a.w - 3, a.y + t], (t) => [a.x + a.w + 2, a.y + t], a.h]];
    let worst = 0;
    for (const [inn, out, len] of sides) { const ds = []; for (let t = 2; t < len - 2; t += 2) { const [ix, iy] = inn(t).map(Math.round), [ox, oy] = out(t).map(Math.round); if (ox < 0 || oy < 0 || ox >= W || oy >= H || ix < 0 || iy < 0 || ix >= W || iy >= H || inOther(ox, oy)) continue; ds.push(Math.abs(lumAt(bm, ix, iy) - lumAt(bm, ox, oy)) - Math.abs(lumAt(orig, ix, iy) - lumAt(orig, ox, oy))); } if (ds.length < 8) continue; ds.sort((p, q) => p - q); const med = ds[ds.length >> 1]; if (med > 10 && ds.filter((d) => d > 8).length / ds.length >= 0.6) worst = Math.max(worst, med); }
    return worst;
  };
  const remainColor = (k) => { // 글자 획 = 글자 상자 안에서 원본 글자색(textStyle)에 가깝고 둘레 바탕색과는 먼 픽셀(사진·도형 무늬는 빼고 글자만)
    const { b, d } = items[k], tc = b.style?.colorBGR; if (!tc) return 0;
    const r = { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), w: Math.min(W, Math.round(b.x + b.w)) - Math.max(0, Math.round(b.x)), h: Math.min(H, Math.round(b.y + b.h)) - Math.max(0, Math.round(b.y)) };
    const near = (i, c, t) => Math.abs(orig.data[i] - c[0]) + Math.abs(orig.data[i + 1] - c[1]) + Math.abs(orig.data[i + 2] - c[2]) < t * 3;
    let n = 0, same = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = (y * W + x) * 4; if (!near(i, tc, 40) || (d?.color && near(i, d.color, 50))) continue; n++; const dt = Math.abs(bm.data[i] - tc[0]) + Math.abs(bm.data[i + 1] - tc[1]) + Math.abs(bm.data[i + 2] - tc[2]), db = d?.color ? Math.abs(bm.data[i] - d.color[0]) + Math.abs(bm.data[i + 1] - d.color[1]) + Math.abs(bm.data[i + 2] - d.color[2]) : 999; if (dt < db) same++; } // 지금도 바탕보다 글자색에 가까우면 남은 것(AI 가 글을 다시 그려 픽셀이 조금 달라도 잡힌다)
    return n >= 20 ? same / n : 0;
  };
  // v13 글자색 픽셀만 칠한 단색·면 채움에 글이 남았으면(글자색 추정이 빗나감) 사각형 전체로 다시
  items.forEach((x, k) => { if (!x.inkClip || remainOf(k) <= 0.3) return; fillSurface(bm, areas[k], { ...x.inkClip.fill, ...(x.inkClip.sClip ? { clip: x.inkClip.sClip } : {}) }); x.layer.erase.clip = x.inkClip.sClip ? "shape" : "full"; });
  // 2) 기울어진 글은 획 인페인팅, 결 있는 바탕(texture)은 복제로 해 보고 잔상 검사를 통과하면 끝(0원) — 남은 것(사진·복잡·복제 실패)만 AI 로
  const jsDone = new Set();
  for (const k of todo) { // 기울어진 글: 획 인페인팅이 글자를 다 지우면 AI 없이 끝(판 모서리를 건드리지 않는다)
    if (!items[k].b.angle) continue;
    const base = snapshot(bm, expandRect(areas[k], 6, W, H)), c = candidates(k).find((c) => c.method === "inpaint");
    if (c && c.apply() && remainOf(k) <= 0.3 && newInk(k) <= 0.15) { jsDone.add(k); done.add(k); Object.assign(items[k].layer.erase, { method: "inpaint", tried: [{ method: "inpaint", pass: true }] }); items[k].layer.erased = "js"; }
    else restore(bm, base);
  }
  for (const k of todo) {
    if (items[k].d.mode !== "texture") continue;
    const base = snapshot(bm, expandRect(areas[k], 6, W, H)); // 지금 상태(겹친 이웃 글이 이미 지워졌으면 그대로 — 원본으로 되돌리면 이웃 글이 다시 살아난다, 커피 랙 d07 실측)
    for (const c of candidates(k).filter((c) => ["clone", "synth", "tiles"].includes(c.method))) {
      restore(bm, base);
      const r = c.apply(); if (!r) continue;
      const res = check(k);
      if (res.pass && remainOf(k) <= 0.3 && newInk(k) <= 0.15 && !rectEdge(k)) { jsDone.add(k); items[k].layer.erase.method = c.method; items[k].layer.erase.tried = [{ method: c.method, pass: true, bad: +badness(res).toFixed(2), ...(r.score != null ? { score: r.score } : {}) }]; items[k].layer.erased = "js"; done.add(k); break; }
      restore(bm, base);
    }
  }
  const aiTodo = todo.filter((k) => !jsDone.has(k));
  // 3) 결·사진 위 글자 → AI 편집 1회(장 전체, 글자만 지워 달라고) — 붙이는 건 아래 후보 비교에서
  const aiInfo = { used: false, accepted: false, diff: null, ms: 0, calls: 0, model: aiModel || null };
  const callAi = async (ks) => { // 장 전체 AI 편집 1회 → 원본 크기·위치로 맞춘 비트맵(글자 밖이 많이 바뀌면 null)
    aiInfo.used = true; aiInfo.calls++;
    const t0 = Date.now(); let out = null;
    try {
      const { generateScenes } = await import("./scene.js");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-loc-"));
      const res = await generateScenes({ productImages: [file], shots: [{ id: "edit", purpose: "edit", prompt_en: aiPrompt(ks.map((k) => items[k].b), W, H), aspect: nearestAspect(W, H), fit: false, ...(aiModel ? { model: aiModel } : {}) }],
        n: 1, outDir: tmp, settings, env, log, postProcess: null, ...(fetchImpl ? { fetchImpl } : {}) });
      const f = res[0]?.files?.[0];
      if (!f) aiInfo.error = res[0]?.error || "AI 편집 결과 없음";
      else {
        aiInfo.billed = (aiInfo.billed || 0) + 1; // 실제로 이미지를 받은 횟수(청구 기준 — 토큰 실패·429 는 청구 안 됨)
        let im = nativeImage.createFromPath(f);
        const sz = im.getSize(); aiInfo.size = `${sz.width}x${sz.height}`;
        if (sz.width !== W || sz.height !== H) im = im.resize({ width: W, height: H, quality: "best" });
        let edited = { data: Buffer.from(im.toBitmap()), w: W, h: H };
        const masks = ks.map((k) => expandRect(areas[k], 6, W, H));
        // 위치 맞춤: 모델 출력 화면비가 원본과 조금 달라 늘리면 밀린다 → 글자 밖 밝기 단면으로 배율·이동을 찾아 다시 그림(맞춘 쪽이 더 비슷할 때만)
        const d0 = diffOutside(orig, edited, masks), al = alignAi(orig, edited, masks), d1 = diffOutside(orig, al.bm, masks);
        if (d1 < d0) { edited = al.bm; aiInfo.align = { sx: al.sx, tx: al.tx, sy: al.sy, ty: al.ty, diff0: +d0.toFixed(2) }; }
        if (aiOut) saveBitmap(edited, aiInfo.calls > 1 ? aiOut.replace(/(\.\w+)$/, `-${aiInfo.calls}$1`) : aiOut); // 점검용: AI 가 돌려준 장 전체(원본 크기·위치로 맞춘 것)
        aiInfo.diff = +Math.min(d0, d1).toFixed(2);
        // v13 붙이는 건 글자 획 근처뿐이라 장 전체가 아니라 지울 영역 둘레 띠(24px)만으로도 판정 — 먼 곳(위쪽 아이콘 칸 등)이 밀려 통째 버리던 것(힙업밴드 d04)
        const ringDiff = () => { let sum = 0, n = 0; for (const m of masks) { const R = expandRect(m, 24, W, H); for (let y = R.y; y < R.y + R.h; y += 2) for (let x = R.x; x < R.x + R.w; x += 2) { if (masks.some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h)) continue; const i = (y * W + x) * 4; sum += (Math.abs(orig.data[i] - edited.data[i]) + Math.abs(orig.data[i + 1] - edited.data[i + 1]) + Math.abs(orig.data[i + 2] - edited.data[i + 2])) / 3; n++; } } return n ? sum / n : Infinity; };
        if (aiInfo.diff > maxDiff) aiInfo.ringDiff = +ringDiff().toFixed(2);
        if (aiInfo.diff <= maxDiff || aiInfo.ringDiff <= maxDiff) { out = edited; aiInfo.accepted = true; aiInfo.error = undefined; }
        else aiInfo.error = `글자 영역 밖 변화 ${aiInfo.diff} > ${maxDiff} — 제품 변형·구도 이동으로 보고 버림`;
        aiInfo.region = res[0]?.region || null; aiInfo.modelNote = res[0]?.modelNote || null;
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    } catch (e) { aiInfo.error = String(e?.message || e).slice(0, 160); }
    aiInfo.ms += Date.now() - t0;
    return out;
  };
  if (aiTodo.length && ai) aiBm = await callAi(aiTodo);
  // 고르는 규칙(실측 2026-10-12 안경 세척기 20장):
  //  texture(벽지·천 결) — 잔상 검사를 통과한 복제(clone → tiles: 진짜 결을 옮긴다) → AI → 결 방향 채움 → 보간
  //  complex(사진·커튼·제품 위) — 장 전체 비교를 통과한 AI 를 믿는다(칸 비교 "색 얼룩"은 주름·조명이 있는 사진에서 자주 헛짚음).
  //    단 AI 가 글자를 못 지웠거나(글자 잔상) 크게 뭉갰거나(결 0.3 미만) 경계가 뚜렷하면(단차 > 15) 버리고 나머지 중 통과한 것 → 덜 나쁜 것
  //  AI 가 없거나 버린 장 — 통과한 것 우선, 없으면 방법 순서(결 방향 채움 → 조각 복제 → 보간) 중 덜 나쁜 것
  const PREF = { texture: ["clone", "synth", "tiles", "ai", "inpaint", "vlines", "hlines", "dir", "interp"], complex: ["ai", "inpaint", "dir", "vlines", "hlines", "interp"], angled: ["inpaint", "ai", "dir", "interp"] };
  PREF.solid = PREF.gradient = PREF.texture;
  const aiBroken = (t) => /잔상|새 얼룩/.test(t.why || "") || (t.hf != null && t.outG >= 3 && t.hf < 0.3) || (t.edge != null && t.edge > 15);
  const choose = (k, mode) => { // 후보를 하나씩 해 보고 잔상 검사 → 규칙대로 하나 고른다
    const tried = [], base = snapshot(bm, expandRect(areas[k], 6, W, H)); // 시작 상태(원본이 아니라 지금 — 겹친 이웃 글 지운 것 유지)
    for (const c of candidates(k)) {
      restore(bm, base);
      const r = c.apply(); if (!r) { tried.push({ method: c.method, ok: false }); continue; }
      const res = check(k), rem = remainOf(k), fresh = ["inpaint", "ai", "clone", "synth", "tiles"].includes(c.method) ? newInk(k) : 0;
      if (rem > 0.3) { res.pass = false; res.why = [res.why, `글자 잔상 ${Math.round(rem * 100)}%`].filter(Boolean).join(" · "); }
      if (fresh > 0.15) { res.pass = false; res.why = [res.why, `새 얼룩 ${Math.round(fresh * 100)}%`].filter(Boolean).join(" · "); }
      const re = items[k].b.angle ? 0 : rectEdge(k); if (re) { res.pass = false; res.why = [res.why, `사각형 경계 +${Math.round(re)}`].filter(Boolean).join(" · "); res.edge = Math.max(res.edge || 0, re); }
      tried.push({ method: c.method, pass: res.pass, bad: +badness(res).toFixed(2), edge: res.edge, hf: res.hf, outG: res.outG, why: res.why || undefined, ...(r.coverage != null ? { coverage: r.coverage } : {}), ...(r.score != null ? { score: r.score } : {}) });
      restore(bm, base);
    }
    const pref = PREF[mode] || PREF.complex, ord = (a, b) => pref.indexOf(a.method) - pref.indexOf(b.method);
    const done = tried.filter((t) => t.bad != null);
    const ai0 = done.find((t) => t.method === "ai");
    let pick = null;
    // 기울어진 글(판·띠 모서리를 가로지름): 사각형 검사는 판 경계 때문에 늘 떨어지므로, 글자가 남지 않은 획 인페인팅을 먼저(커피 랙 d07 — 사각형 채우기가 판 밖으로 튀어나온 네모를 남기던 것)
    const ip = done.find((t) => t.method === "inpaint");
    if (items[k].b.angle && ip && !/잔상|새 얼룩/.test(ip.why || "")) pick = ip;
    if (!pick && mode === "complex" && ai0 && !aiBroken(ai0)) pick = ai0;
    if (!pick) pick = done.filter((t) => t.pass && !(t.method === "ai" && aiBroken(t))).sort(ord)[0];
    if (!pick) pick = done.filter((t) => !(t.method === "ai" && aiBroken(t))).sort((a, b) => a.bad - b.bad)[0] || done.sort((a, b) => a.bad - b.bad)[0];
    if (pick) candidates(k).find((c) => c.method === pick.method).apply();
    return { pick: pick?.method || null, tried: tried.map(({ edge, hf, outG, ...t }) => t) };
  };
  const runChoose = (ks) => { for (const k of ks) {
    const { layer, d } = items[k];
    const r = choose(k, d.mode);
    layer.erase.method = r.pick; layer.erase.tried = r.tried;
    layer.erased = r.pick === "ai" ? "ai" : r.pick ? "js" : "kept"; if (r.pick) done.add(k);
  } };
  runChoose(aiTodo);
  // AI 다시 1회: AI 가 버려졌거나(구도 이동) 글자를 남긴 영역이 있으면 그 글만 다시 부탁한다(장당 최대 2회 — v12 비용 실측: 3회까지 허용하니 47장에 $2.4)
  for (let round = 0; round < 1 && ai && aiTodo.length && !/키|key|자격|credential|인증|권한/i.test(aiInfo.error || ""); round++) {
    const again = aiTodo.filter((k) => { const t = items[k].layer.erase.tried || [], a0 = t.find((x) => x.method === "ai"); return !aiBm ? true : !!(a0 && /잔상/.test(a0.why || "")); }); // 다시 부탁은 AI 가 버려졌거나 글자를 남겼을 때만(비용: 장당 최대 2회) // 사진 위 글인데 AI 를 못 쓴 영역도
    if (again.length && (!aiBm || again.some((k) => items[k].d.mode === "complex"))) {
      const second = await callAi(again);
      if (second) { aiBm = second; aiInfo.retry = again.length; runChoose(again); }
    } else break;
  }
  // 4) 최종 잔상 검사(모두 지운 뒤 그림에서) — 떨어진 단색·면 채움은 다른 방법으로 다시
  const checkAll = (k) => { const res = check(k), rem = remainOf(k); if (rem > 0.3) { res.pass = false; res.why = [res.why, `글자 잔상 ${Math.round(rem * 100)}%`].filter(Boolean).join(" · "); } return res; };
  items.forEach((x, k) => {
    if (!x.layer.erase) return;
    let res = checkAll(k);
    // 단색·면 채움은 만든 방식상 정확하다 — 검사 실패는 대개 검사 사각형에 걸린 밑줄·테두리(오탐)라 글자가 남았을 때만 다시(커피 랙 d11 제목: 밑줄 때문에 다시 해서 흐린 얼룩이 생겼던 것)
    const re0 = ["solid", "gradient"].includes(x.layer.erase.method) && !x.pillInner ? rectEdge(k) : 0; if (re0) res.edge = Math.max(res.edge || 0, re0); // v13 평평한 채움이 사각형 경계를 만들었으면(그라데이션 바탕) 다른 방법도 비교
    if (!res.pass && ["solid", "gradient"].includes(x.layer.erase.method) && (remainOf(k) > 0.3 || re0 > 15)) {
      const keep = snapshot(bm, checkRect(areas[k]));
      const r = choose(k, x.d.mode);
      const res2 = checkAll(k);
      if (badness(res2) < badness(res)) { x.layer.erase.retry = { from: x.layer.erase.method, tried: r.tried }; x.layer.erase.method = r.pick; x.layer.erased = r.pick === "ai" ? "ai" : "js"; res = res2; }
      else { restore(bm, keep); x.layer.erase.retry = { from: x.layer.erase.method, tried: r.tried, kept: true }; }
    }
    if (remainOf(k) > 0.3 && x.layer.erase.method !== "interp") { // 마지막 안전장치: 중국어가 남는 것보다는 보간 자국이 낫다(위에 한글이 얹힌다)
      fillPatch(bm, areas[k], { mode: "interp", feather: 4 }); x.layer.erase.fallback = `${x.layer.erase.method}→interp(글자 남음)`; x.layer.erase.method = "interp"; x.layer.erased = "js"; res = checkAll(k);
    }
    x.layer.erase.residue = { pass: res.pass, edge: res.edge, tone: res.tone, hf: res.hf, ...(res.why ? { why: res.why } : {}) };
  });
  // 5) 다시 읽기 검사(v11.1): 지운 그림을 OCR 로 다시 읽어 한자가 아직 보이는 영역은 AI 를 빼고 다시 고른다(AI 가 글자를 옅게 다시 그려 남기는 경우 — 안경 세척기 d07·d09 실측).
  //    한 번 더 읽어도 남으면 보간으로 덮는다(중국어가 남는 것보다 낫다 — 위에 한글이 얹힌다)
  if (ocrCheck && out && items.some((x) => x.layer.erase)) {
    const reread = async () => { try { saveBitmap(bm, out); const { ocrFile } = await import("./ocr.js"); return (await ocrFile(out, { log: noop })).boxes || []; } catch { return null; } };
    const hanIn = (bx) => items.map((x, k) => k).filter((k) => items[k].layer.erase?.method && bx.some((b) => isEraseTarget(b.text) && !isIconGuess(b) && b.x < areas[k].x + areas[k].w && areas[k].x < b.x + b.w && b.y < areas[k].y + areas[k].h && areas[k].y < b.y + b.h));
    let bx = await reread(), left = bx ? hanIn(bx) : [];
    if (left.length) {
      for (const k of left) { const x = items[k]; const save = aiBm; aiBm = null; const r = choose(k, x.d.mode); aiBm = save; x.layer.erase.reread = { from: x.layer.erase.method, to: r.pick }; x.layer.erase.method = r.pick; x.layer.erased = r.pick ? "js" : "kept"; }
      bx = await reread(); const still = bx ? hanIn(bx) : [];
      for (const k of still) { fillPatch(bm, areas[k], { mode: "interp", feather: 4 }); items[k].layer.erase.reread = { ...(items[k].layer.erase.reread || {}), still: true }; items[k].layer.erase.method = "interp"; }
      for (const k of left) { const res = checkAll(k); items[k].layer.erase.residue = { pass: res.pass, edge: res.edge, tone: res.tone, hf: res.hf, ...(res.why ? { why: res.why } : {}) }; }
    }
    aiInfo.reread = left.length;
    // v12.1 OCR 이 처음에 못 읽은 한자 조각(다른 글 사이에 반쯤 걸친 글자 — 대파 분쇄기 d09 "賈"): 다시 읽기에서 영역 밖 한자 상자가 나오면 획만 메운다
    const bx2 = left.length ? await reread() : bx;
    const nearArea = (b) => areas.some((a) => Math.abs((b.y + b.h / 2) - (a.y + a.h / 2)) < a.h * 0.6 && b.x < a.x + a.w + a.h * 1.5 && a.x - a.h * 1.5 < b.x + b.w); // 같은 줄 바로 옆(잘려 남은 글자 — 대파 d09 "费")
    const stray = (bx2 || []).filter((b) => isEraseTarget(b.text) && (!isIconGuess(b) || nearArea(b)) && !areas.some((a) => b.x < a.x + a.w && a.x < b.x + b.w && b.y < a.y + a.h && a.y < b.y + b.h));
    for (const b of stray) { const r = expandRect(b, 3, W, H), st = textStyle(bm, b, { imgW: W }); const sm = strokeMask(bm, r, { textColor: st.colorBGR, dilate: 2, localThr: 20, win: 9 }); inpaintMask(bm, r, sm.mask); }
    aiInfo.stray = stray.length;
  }
  // v12 장식 도형: 글이 알약·배지 같은 닫힌 색 도형 안에 있었으면 기록 — 번역에서 그 글을 빼면 빈 장식이 남으므로 eraseShapes 가 도형째 지운다
  // 원·띠·칸 같은 도형이면 템플릿이 그 안(원은 내접 사각형)에 글을 맞추고 같은 도형 안 줄들을 함께 배치한다. 도형이 이미지 폭의 90%를 넘거나 글 영역의 12배를 넘으면 바탕으로 본다
  items.forEach((x, k) => { if (!x.layer.erase || !x.d?.color || x.b.angle || x.pillRect) return; const sh = findShape(orig, areas[k], x.d.color) || findShape(orig, areas[k], x.d.color, { tol: 10 }); if (!sh) return; /* 어두운 칸 위 어두운 바탕처럼 색이 가까우면 좁은 허용으로 한 번 더 */ const A = areas[k].w * areas[k].h, R = sh.rect.w * sh.rect.h; if (R <= A * 12 && sh.rect.w <= W * 0.95 && sh.rect.w >= areas[k].w * 0.6 && sh.n >= R * 0.4) x.layer.shape = { ...sh.rect, color: toHexBGR(x.d.color), round: sh.round, circle: sh.round && Math.abs(sh.rect.w - sh.rect.h) < Math.max(sh.rect.w, sh.rect.h) * 0.15 }; });
  const layers = items.map((x) => x.layer);
  if (out) saveBitmap(bm, out);
  const cnt = layers.reduce((m, l) => { if (l.erase?.method) m[l.erase.method] = (m[l.erase.method] || 0) + 1; return m; }, {});
  const fails = layers.filter((l) => l.erase && !l.erase.residue?.pass).length;
  log("dim", `  🈚 ${path.basename(file)} 지우기 ${Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(" · ") || "없음"}${fails ? ` · 잔상 의심 ${fails}` : ""}${aiInfo.used ? ` · AI ${aiInfo.accepted ? "적용" : "버림"}${aiInfo.diff != null ? `(밖 변화 ${aiInfo.diff})` : ""}${aiInfo.error ? " " + aiInfo.error : ""}` : ""}`);
  return { out: out || null, w: W, h: H, promo, layers: layers.map(({ text_box, ...l }) => ({ ...l, textBox: text_box })), ai: aiInfo };
}

// 사진 좌·우 가장자리에 걸친(잘린) 물체를 빼고 저장 → { w, h, cut } | null. 열마다 바탕(네 귀퉁이 평균)과 다른 픽셀 비율, 가장자리 6px 안에 내용이 있으면
// 안쪽으로 가며 내용 없는 열이 연속 gap 이상 나오는 곳에서 자른다(가운데 제품은 살린다)
export function trimCutEdges(file, out, { tol = 30, gap = 12 } = {}) {
  const bm = loadBitmap(file), W = bm.w, H = bm.h, d = bm.data;
  const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  let bg; { const cnt = new Map(); for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) { const c = px(x, y), k = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4); cnt.set(k, (cnt.get(k) || 0) + 1); } let bk = 0, bn = -1; for (const [k, n] of cnt) if (n > bn) { bn = n; bk = k; } bg = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8]; } // 바탕 = 가장 흔한 색(귀퉁이는 둥근 카드·띠가 걸려 믿을 수 없다)
  const col = (x) => { let n = 0; for (let y = 0; y < H; y += 2) { const c = px(x, y); if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > tol * 3) n++; } return n / (H / 2); };
  const busy = Array.from({ length: W }, (_, x) => col(x) > 0.06); // 위·아래 끝의 카드 모서리·띠 몇 줄은 무시
  const cut = (from, step) => { if (![0, 1, 2, 3, 4, 5].some((k) => busy[from + step * k])) return null; let run = 0; for (let x = from; x >= 0 && x < W; x += step) { if (!busy[x]) { run++; if (run >= gap) return x - step * Math.floor(gap / 2); } else run = 0; } return null; };
  const r = cut(W - 1, -1), l = cut(0, 1);
  let x0 = 0, x1 = W, y0 = 0, y1 = H; const why = [];
  if (r != null && r > W * 0.4) { x1 = r; why.push("오른쪽"); }
  if (l != null && l < W * 0.6 && l < x1 - W * 0.3) { x0 = l; why.push("왼쪽"); }
  // 위·아래 끝 몇 줄에 걸친 띠·카드 모서리(아래 알약 윗변, 둥근 카드 귀퉁이)도 뺀다
  const rowBusy = (y) => { let n = 0; for (let x = x0; x < x1; x += 2) { const c = px(x, y); if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > tol * 3) n++; } return n / ((x1 - x0) / 2); };
  for (let k = 0; k < Math.min(24, H * 0.06); k++) if (rowBusy(H - 1 - k) > 0.15) y1 = H - 1 - k;
  for (let k = 0; k < Math.min(24, H * 0.06); k++) { const y = k; let n = 0; for (let x = x0; x < Math.min(x1, x0 + 30); x++) { const c = px(x, y); if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > tol * 3) n++; } if (n > 2) y0 = y + 1; }
  if (y1 < H) why.push("아래 띠"); if (y0 > 0) why.push("위 귀퉁이");
  if (!why.length) return null;
  const ow = x1 - x0, oh = y1 - y0, outBm = { data: Buffer.alloc(ow * oh * 4), w: ow, h: oh };
  for (let y = 0; y < oh; y++) d.copy(outBm.data, y * ow * 4, ((y + y0) * W + x0) * 4, ((y + y0) * W + x1) * 4);
  saveBitmap(outBm, out);
  return { w: ow, h: oh, cut: why.join("·") };
}
// 줄 끝 잘린 글자 찾기: 글 상자 왼쪽·오른쪽 1.2글자 폭 띠에서 글자색(±60)에 가까운 픽셀이 2% 넘게 있고 그 픽셀이 다른 글 상자 밖이면, 그 픽셀 끝까지 넓힌 { x, w }
export function extendTruncated(bm, b, color, others = []) {
  const h = b.th || b.h, reach = Math.round(h * 1.2), W = bm.w;
  const inOther = (x, y) => others.some((o) => o !== b && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
  const scan = (x0, x1) => { let n = 0, tot = 0, lo = Infinity, hi = -1; for (let y = Math.max(0, b.y); y < Math.min(bm.h, b.y + b.h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) { tot++; const i = (y * W + x) * 4; if (Math.abs(bm.data[i] - color[0]) + Math.abs(bm.data[i + 1] - color[1]) + Math.abs(bm.data[i + 2] - color[2]) < 60 * 3 / 2 && !inOther(x, y)) { n++; lo = Math.min(lo, x); hi = Math.max(hi, x); } } return tot && n / tot > 0.02 ? { lo, hi } : null; };
  let x0 = b.x, x1 = b.x + b.w;
  // v13 같은 색 획이 글줄 위·아래로 더 이어지면(옆의 큰 숫자 "5" — 빨래건조대 d04 "5个") 잘린 글자가 아니라 다른 글이다 → 넓히지 않는다
  const tall = (r) => { if (!r) return false; let n = 0, tot = 0; for (const y of [Math.round(b.y - h * 0.35), Math.round(b.y + b.h + h * 0.35)]) { if (y < 0 || y >= bm.h) continue; for (let x = Math.max(0, r.lo); x <= Math.min(W - 1, r.hi); x++) { tot++; const i = (y * W + x) * 4; if (Math.abs(bm.data[i] - color[0]) + Math.abs(bm.data[i + 1] - color[1]) + Math.abs(bm.data[i + 2] - color[2]) < 60 * 3 / 2) n++; } } return tot > 0 && n / tot > 0.08; };
  let L = scan(b.x - reach, b.x - 1), R = scan(b.x + b.w + 1, b.x + b.w + reach);
  if (tall(L)) L = null; if (tall(R)) R = null;
  if (L && b.x - L.hi < h * 0.6) x0 = L.lo - 2;
  if (R && R.lo - (b.x + b.w) < h * 0.6) x1 = R.hi + 3;
  return x0 < b.x || x1 > b.x + b.w ? { x: Math.max(0, x0), w: Math.min(W, x1) - Math.max(0, x0) } : null;
}
const hexBGR = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const v = parseInt(m[1], 16); return [v & 255, (v >> 8) & 255, v >> 16]; };
const lum3 = (c) => 0.114 * c[0] + 0.587 * c[1] + 0.299 * c[2]; // BGR
// v13 글자 상자 안의 가장 흔한 색(4비트 양자화 칸 평균, BGR) — 알약·배지 안쪽 색. 글자 획은 보통 상자의 절반이 안 되므로 바탕이 이긴다
function innerMode(bm, r, not = []) {
  const ex = not.filter(Boolean), far = (i) => ex.every((c) => Math.abs(bm.data[i] - c[0]) + Math.abs(bm.data[i + 1] - c[1]) + Math.abs(bm.data[i + 2] - c[2]) > 90); // 글자·테두리 색 픽셀은 뺀다(굵은 흰 글이 상자의 절반을 넘어 흰색을 알약 색으로 잡던 것 — 대파 d06)
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y)), x1 = Math.min(bm.w, Math.round(r.x + r.w)), y1 = Math.min(bm.h, Math.round(r.y + r.h)), cnt = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * bm.w + x) * 4; if (!far(i)) continue; const k = (bm.data[i] >> 4) * 256 + (bm.data[i + 1] >> 4) * 16 + (bm.data[i + 2] >> 4); const c = cnt.get(k) || [0, 0, 0, 0]; c[0] += bm.data[i]; c[1] += bm.data[i + 1]; c[2] += bm.data[i + 2]; c[3]++; cnt.set(k, c); }
  let best = null; for (const c of cnt.values()) if (!best || c[3] > best[3]) best = c;
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : null;
}
const toHexBGR = (c) => "#" + [c[2], c[1], c[0]].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
// v12 빈 장식 지우기: 번역에서 뺀 글이 들어 있던 알약·배지 도형을 바깥 바탕으로 메운다(파일을 고쳐 씀). shapes: [{ x,y,w,h, color:"#rrggbb" }] → 지운 개수
export function eraseShapes(file, shapes = []) {
  if (!shapes.length) return 0;
  const bm = loadBitmap(file); let n = 0;
  for (const s of shapes) {
    const m = /^#?([0-9a-f]{6})$/i.exec(s.color || ""); if (!m) continue; const v = parseInt(m[1], 16), bgr = [v & 255, (v >> 8) & 255, v >> 16];
    const sh = findShape(bm, { x: s.x + s.w * 0.25, y: s.y + s.h * 0.25, w: Math.max(2, s.w * 0.5), h: Math.max(2, s.h * 0.5) }, bgr, { pad: Math.max(s.w, s.h) }); if (!sh) continue;
    const pad = 3, R = { x: sh.rect.x - pad, y: sh.rect.y - pad, w: sh.rect.w + pad * 2, h: sh.rect.h + pad * 2 }, big = new Uint8Array(R.w * R.h);
    for (let y = 0; y < sh.rect.h; y++) for (let x = 0; x < sh.rect.w; x++) if (sh.mask[y * sh.rect.w + x]) big[(y + pad) * R.w + x + pad] = 1;
    if (inpaintMask(bm, R, dilateMask(big, R.w, R.h, 2), { radius: 5, maxPx: 200000 }).ok) n++; // 가장자리 안티앨리어싱까지 2px
  }
  if (n) saveBitmap(bm, file);
  return n;
}
// 렌더 전 plan 마무리(index.js · 재생 하네스 공용): 번역 안 된(한자만 남은) 레이어 빼기 · 이미지 원래 크기(iw·ih)
// ocr 를 주면 그림에 그대로 남는 글(영문 장식 "Ultrasonic Wave" 등, OCR latin 상자)을 sec.keep 으로 — 템플릿이 한글 상자를 넓히거나 내릴 때 덮지 않는다
export function finishLocalizePlan(lplan, dir, { log = noop, ocr = null, minPx = 14 } = {}) {
  // v13 가격 붙은 상품 목록 이미지는 뺀다(사람이 확인 화면에서 켠 장은 둔다)
  if (ocr?.images) { const keep = []; for (const sec of lplan.sections) { const o = sec.type === "image" && sec.id && !sec.human ? ocr.images.find((x) => x.id === sec.id) : null, pl = o ? priceListOf((o.boxes || []).map((b) => b.text)) : null; if (pl) { (lplan.excluded ||= []).push({ id: sec.id, why: pl.reason, kind: pl.kind }); log("dim", `  🈚 ${sec.id} 제외 — ${pl.reason}`); } else keep.push(sec); } lplan.sections = keep; }
  if (ocr?.images) lplan.sections.forEach((sec) => { if (sec.type !== "image" || !sec.id) return; const o = ocr.images.find((x) => x.id === sec.id); const keep = (o?.boxes || []).filter((b) => (b.latin || !isEraseTarget(b.text) || isIconGuess(b)) && b.w > 0 && b.h > 0).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })); if (keep.length) sec.keep = keep; });
  // v13.2 이미지 경계에 반만 걸친 글(보이는 높이 60% 미만)은 지우기만 하고 한글은 얹지 않는다(나머지 반이 있는 장이 한글을 맡는다)
  lplan.sections.forEach((sec) => { if (Array.isArray(sec.layers)) sec.layers = sec.layers.filter((l) => !(l.seam != null && l.seam < 0.6)); });
  let cjkDrop = 0;
  lplan.sections.forEach((sec) => { if (Array.isArray(sec.layers)) sec.layers = sec.layers.filter((l) => { const bad = /[一-鿿]/.test(String(l.ko || "")) && !/[가-힣]/.test(String(l.ko || "")); if (bad) cjkDrop++; return !bad; }); });
  if (cjkDrop) log("dim", `  🈚 번역 안 된 글 ${cjkDrop}줄은 지운 채로 둠`);
  lplan.sections.forEach((sec) => { if (sec.image) { try { const sz = nativeImage.createFromPath(path.join(dir, sec.image)).getSize(); sec.iw = sz.width; sec.ih = sz.height; } catch {} } });
  // v13 그림에 남은 가로 선(밑줄·구분선)도 남기는 장애물(keep, rule:true) — 글을 넓히거나 내릴 때 덮지 않고, 선을 사이에 둔 줄은 한 글 묶음으로 합치지 않는다
  lplan.sections.forEach((sec) => { if (sec.type !== "image" || !sec.image || !Array.isArray(sec.layers) || !sec.layers.length) return; try { const rules = findRules(loadBitmap(path.join(dir, sec.image))); if (rules.length) sec.keep = [...(sec.keep || []), ...rules.slice(0, 40).map((r) => ({ ...r, rule: true }))]; } catch {} });
  // v12.1 히어로 자른 사진(photo_crop)의 좌·우 끝에 걸쳐 잘린 제품은 빼고 온전한 제품만: 바탕과 다른 열(content)이 가장자리에 닿으면 그 앞 빈 열 구간에서 자른다
  lplan.sections.filter((x) => x.type === "hero" && x.from === "photo_crop" && x.image).forEach((h) => { try { const r = trimCutEdges(path.join(dir, h.image), path.join(dir, "localize", `hero-${h.id}.png`)); if (r) { h.image = `localize/hero-${h.id}.png`; h.iw = r.w; h.ih = r.h; h.trimmed = r.cut; log("dim", `  🈚 히어로 사진 가장자리 잘린 제품 뺌(${r.cut})`); } } catch {} });
  // v12 읽기 힘든 작은 글: 페이지 폭(780)에 맞춘 글자 크기가 minPx 미만이면 넣지 않는다(지운 자리는 그대로 — 작은 주석·셀 글은 없어도 된다). 알약·배지(빈 장식이 남음)는 남긴다
  let small = 0; const W0 = Number(lplan.meta?.width) || 780;
  lplan.sections.forEach((sec) => { if (sec.type !== "image" || !Array.isArray(sec.layers) || !sec.iw) return; const sc = W0 / sec.iw; sec.layers = sec.layers.filter((l) => { const st = l.style || {}, sz = Number(st.size || st.fontSizePx) || (Number(l.h) || 0) * 0.78; const deco = st.pill || st.radius || st.bg || st.bgColor || ["badge", "pill"].includes(l.role); if (!deco && sz * sc < minPx) { small++; return false; } return true; }); });
  lplan.smallDropped = small;
  if (small) log("dim", `  🈚 읽기 힘든 작은 글(${minPx}px 미만) ${small}줄은 넣지 않음`);
  return lplan;
}
