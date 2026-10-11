// v6 원본 한글화 — 중국 상세 이미지를 새로 만들지 않고, 원본 그대로 중국어 글자(와 알약 배너)만 지운 뒤 한글 글자 레이어 정보를 돌려준다.
// 제품 크기·모양은 100% 원본. 비용: 단색·그라데이션 배경 글자는 JS 로 지움(0원), 사진·복잡한 배경 위 글자만 Gemini 이미지 편집 1회(장당 약 $0.04).
// AI 편집 결과는 원본과 픽셀 비교 → 글자 영역 밖이 많이 바뀌었으면(제품 변형·구도 이동) 버리고 JS 지우기. 받아들여도 **글자 영역만** 원본 위에 붙인다(나머지 픽셀은 원본 그대로).
//
// localizeImage({ file, ocrBoxes, out, ai?, settings?, env?, log?, fetchImpl? })
//   → { out, w, h, promo:bool, layers:[{ x,y,w,h, zh, role, style:{ color, bgColor, pill, borderColor, fontWeight, fontSizePx, align }, erased:"js"|"ai"|"kept" }], ai:{ used, accepted, diff, ms, error? } }
import { nativeImage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBitmap, saveBitmap } from "./image.js";
import { groupTextBlocks, assignRoles, textStyle, detectPill, expandRect, estimateBackground, eraseMode, ringMode, safeEraseRect, eraseRect, fillPatch, isNumberText, nearestAspect, diffOutside, pasteMasks, growQuad } from "./image-core.js";

const noop = () => {};
// 순수 도우미(화면비·픽셀 비교·붙이기)는 image-core.js 에 있다(Node 단위테스트 가능)
export { nearestAspect, diffOutside, pasteMasks, growQuad } from "./image-core.js";

export const AI_PROMPT = "Remove only the Chinese text and its decorative banner/pill; keep every other pixel identical; do not change the product.";
function aiPrompt(blocks, W, H) {
  const list = blocks.map((b) => `"${b.text}" at about ${Math.round(((b.x + b.w / 2) / W) * 100)}% from left, ${Math.round(((b.y + b.h / 2) / H) * 100)}% from top`).join("; ");
  return `${AI_PROMPT} Text to remove: ${list}. Fill each removed area with the surrounding surface so it looks like the text was never there. Keep the exact same framing, size, perspective and composition — no crop, no zoom, no shift. Keep all numbers and measurements that are not listed. Do not add any new text, logo or object.`;
}

export async function localizeImage({ file, ocrBoxes = [], out, ai = true, settings = {}, env = process.env, log = noop, fetchImpl, maxDiff = 14, minConf = 0.15, maxSeam = 6 } = {}) {
  const bm = loadBitmap(file);
  const W = bm.w, H = bm.h;
  // 기울어진 글(Vision quad): 글자 두께 th = 좌상→좌하 거리, 기울기 angle(도)
  const thOf = (b) => (Array.isArray(b.quad) && b.quad.length === 8 ? Math.round(Math.hypot(b.quad[6] - b.quad[0], b.quad[7] - b.quad[1])) : b.h);
  const boxes = (ocrBoxes || []).filter((b) => b && String(b.text || "").trim() && b.w > 0 && b.h > 0 && (b.conf == null || b.conf >= minConf))
    .map((b) => ({ ...b, th: thOf(b), angle: Math.abs(b.angle || 0) > 3 ? +b.angle : 0 }));
  let blocks = groupTextBlocks(boxes.filter((b) => !b.angle)).concat(boxes.filter((b) => b.angle).map((b, i) => ({ ...b, members: [i] }))); // 기울어진 글은 묶지 않는다
  // 알약·스타일은 지우기 전에 원본에서 잰다(기울어진 글은 알약 감지 안 함)
  blocks = blocks.map((b) => {
    const num = isNumberText(b.text);
    const pill = num || b.angle ? { pill: false } : detectPill(bm, b);
    const st = textStyle(bm, b, { imgW: W });
    if (b.th && b.th !== b.h) st.fontSizePx = Math.round(b.th * 0.92);
    return { ...b, pill: !!pill.pill, pillInfo: pill, style: st };
  });
  blocks = assignRoles(blocks, { imgH: H });
  // 판매자 홍보 이미지(공장·인증·맞춤제작): 상세페이지에서 보통 빼므로 AI 편집에 돈을 쓰지 않는다(JS 로만)
  const textBlocks = blocks.filter((b) => b.role !== "number");
  const promoN = textBlocks.filter((b) => b.role === "promo").length;
  const STRONG = /有限公司|合作伙伴|COOPERATIVE|专利证书|工厂人员|厂房|定制流程|我们的优势/i; // 회사 소개·협력사·인증서 페이지에만 나오는 말
  const promo = textBlocks.length > 0 && (promoN >= 2 || promoN / textBlocks.length >= 0.4 || textBlocks.some((b) => STRONG.test(b.text)));
  if (promo) ai = false;
  const layers = [];
  const aiTodo = [];
  for (const b of blocks) {
    const st = b.style;
    const style = { color: st.color, bgColor: b.pillInfo?.bgColor || null, pill: b.pill, borderColor: b.pillInfo?.borderColor || null, fontWeight: st.fontWeight, fontSizePx: st.fontSizePx, align: st.align, ...(b.angle ? { rotate: b.angle } : {}) };
    // 지울 영역: 알약이면 알약 전체, 아니면 글자 상자를 넓히되 밑줄·테두리선 앞에서 멈춤(선은 살린다)
    const pad = Math.max(4, Math.round((b.th || b.h) * 0.15));
    const area = b.pill && b.pillInfo.rect ? b.pillInfo.rect : b.angle ? expandRect(b, pad, W, H) : safeEraseRect(bm, b, pad, ringMode(bm, expandRect(b, pad, W, H), 6).color);
    const layer = { x: area.x, y: area.y, w: area.w, h: area.h, text_box: { x: b.x, y: b.y, w: b.w, h: b.h }, zh: b.text, role: b.role, style, erased: "kept" };
    if (b.role === "number") { layers.push(layer); continue; } // 치수는 그대로
    const stats = estimateBackground(bm, area, 4);
    const em = b.angle ? { mode: "complex" } : eraseMode(stats, { bm, rect: area }); // 사선 위 글(판 경계가 지나감)은 AI
    layer.how = em.mode; // interp(보간) · solid(바탕색) · complex(AI 대상)
    if (em.mode !== "complex") {
      // JS 메우기: Coons 2차원 보간(또는 바탕 단색) + 가장자리 페더. 선(밑줄·테두리) 쪽으로는 페더하지 않게 선 앞에서 멈춘 영역이라 feather 는 그 안쪽 여유만큼
      const fe = em.line ? 2 : Math.min(10, Math.max(6, Math.round((b.th || b.h) * 0.2)));
      const r = fillPatch(bm, area, { mode: em.mode, color: em.color || null, stats, feather: fe });
      layer.seam = +r.seam.toFixed(2);
      // 사진 바탕(조명 그라데이션·결)에서 둘레와 차이가 크면(채움이 티 남) AI 로. 한 색 바탕(solid)은 바깥 2px 가 배지 테두리·선이라 이음새 값이 의미 없어 검사하지 않는다
      if (em.photo && r.seam > maxSeam && ai) { r.undo(); layer.how = "complex"; aiTodo.push({ b, area, layer }); }
      else layer.erased = "js";
    }
    else aiTodo.push({ b, area, layer });
    layers.push(layer);
  }
  const aiInfo = { used: false, accepted: false, diff: null, ms: 0 };
  if (aiTodo.length) {
    let accepted = false;
    if (ai) {
      aiInfo.used = true;
      const t0 = Date.now();
      try {
        const { generateScenes } = await import("./scene.js");
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-loc-"));
        const res = await generateScenes({ productImages: [file], shots: [{ id: "edit", purpose: "edit", prompt_en: aiPrompt(aiTodo.map((x) => x.b), W, H), aspect: nearestAspect(W, H), fit: false }],
          n: 1, outDir: tmp, settings, env, log, postProcess: null, ...(fetchImpl ? { fetchImpl } : {}) });
        const f = res[0]?.files?.[0];
        if (!f) aiInfo.error = res[0]?.error || "AI 편집 결과 없음";
        else {
          let im = nativeImage.createFromPath(f);
          const sz = im.getSize();
          if (sz.width !== W || sz.height !== H) im = im.resize({ width: W, height: H, quality: "best" });
          const edited = { data: Buffer.from(im.toBitmap()), w: W, h: H };
          const orig = loadBitmap(file);
          // 붙일 영역: 기울어진 글은 글자 네 꼭짓점을 넓힌 다각형(판 경계를 덜 건드리게), 나머지는 지울 사각형 +6px
          const masks = aiTodo.map((x) => (x.b.angle && Array.isArray(x.b.quad) ? { ...expandRect(x.area, 10, W, H), poly: growQuad(x.b.quad, Math.max(8, Math.round((x.b.th || 20) * 0.35))) } : expandRect(x.area, 6, W, H)));
          aiInfo.diff = +diffOutside(orig, edited, masks).toFixed(2);
          if (aiInfo.diff <= maxDiff) { pasteMasks(bm, edited, masks, 4); accepted = true; }
          else aiInfo.error = `글자 영역 밖 변화 ${aiInfo.diff} > ${maxDiff} — 제품 변형·구도 이동으로 보고 버림`;
          aiInfo.region = res[0]?.region || null;
        }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      } catch (e) { aiInfo.error = String(e?.message || e).slice(0, 160); }
      aiInfo.ms = Date.now() - t0;
      aiInfo.accepted = accepted;
    }
    for (const x of aiTodo) {
      if (accepted) x.layer.erased = "ai";
      else { // AI 없음·버림 → JS 로 대체(다수 색 단색 — 보간은 판 경계를 줄무늬로 끌고 온다)
        const st = estimateBackground(bm, x.area, 4); const em = eraseMode(st, { bm, rect: x.area });
        const r = fillPatch(bm, x.area, { mode: em.mode === "solid" ? "solid" : "interp", color: em.mode === "solid" ? em.color : null, stats: st, feather: 8 }); // 사진 바탕이면 보간이 단색보다 덜 티 난다
        x.layer.seam = +r.seam.toFixed(2); x.layer.erased = "js";
      }
    }
  }
  if (out) saveBitmap(bm, out);
  if (aiInfo.used) log("dim", `  🈶 ${path.basename(file)} AI 편집 ${aiInfo.accepted ? "적용" : "버림"}${aiInfo.diff != null ? ` (밖 변화 ${aiInfo.diff})` : ""}${aiInfo.error ? " · " + aiInfo.error : ""}`);
  return { out: out || null, w: W, h: H, promo, layers: layers.map(({ text_box, ...l }) => ({ ...l, textBox: text_box })), ai: aiInfo };
}
