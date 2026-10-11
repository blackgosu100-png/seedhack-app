// 지우기 하네스 — 샘플을 OCR(vision)한 상자로 cleanImage 를 돌려 before/after PNG 를 저장하고 결과를 검사한다.
// 실행: npx electron test/detail/image-harness.js
// 검사(CHECKLIST B-3~B-6): 단색 샘플은 지운 영역 평균 색 차이 ≤ 12/255, 사진 샘플은 전부 kept/onPhoto,
//   그라데이션 샘플은 erased(눈으로 확인용 PNG), 지운 뒤 다시 OCR 해 CJK 상자 수가 원본의 20% 이하(단색 샘플).
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));

const here = path.dirname(fileURLToPath(import.meta.url));
const imgDir = path.join(here, "fixture", "img");
const outDir = path.join(here, "img", "out");
const log = (_lv, text) => console.log(text);
const hexToBGR = (hex) => { const n = parseInt(hex.slice(1), 16); return [n & 255, (n >> 8) & 255, (n >> 16) & 255]; };

app.whenReady().then(async () => {
  const fails = [];
  try {
    const { ocrImages } = await import("../../src/main/detail/ocr.js");
    const { cleanImage, loadBitmap, imageInfo, resizeToWidth, cropRect, autoTrim, cropTextBand } = await import("../../src/main/detail/image.js");
    const { meanDiff, expandRect, hasCJK } = await import("../../src/main/detail/image-core.js");
    const samples = JSON.parse(fs.readFileSync(path.join(here, "img", "samples.json"), "utf8"));
    const ids = Object.keys(samples);
    const images = ids.map((id) => ({ id, file: path.join(imgDir, `${id}.png`), w: samples[id].w, h: samples[id].h }));
    fs.mkdirSync(outDir, { recursive: true });

    const t0 = Date.now();
    const ocr = await ocrImages(images, { provider: "vision", log });
    if (ocr.provider !== "vision") fails.push(`Vision 이 아니라 ${ocr.provider}`);
    const afterList = [];
    const summary = {};
    for (const im of ocr.images) {
      const s = samples[im.id];
      const src = path.join(imgDir, `${im.id}.png`);
      const before = path.join(outDir, `${im.id}-before.png`), after = path.join(outDir, `${im.id}-after.png`);
      fs.copyFileSync(src, before);
      const t = Date.now();
      const r = cleanImage({ file: src, boxes: im.boxes, out: after });
      const ms = Date.now() - t;
      summary[im.id] = { bg: s.bg, boxes: im.boxes.length, erased: r.erased, kept: r.kept, ms };
      console.log(`  ${im.id} ${s.bg} 상자 ${im.boxes.length} → erased ${r.erased} / kept ${r.kept} (${ms}ms) bg ${[...new Set(r.boxesOut.map((b) => b.bg))].join(",")}`);
      if (r.w !== s.w || r.h !== s.h) fails.push(`${im.id} cleanImage 크기 ${r.w}x${r.h} ≠ ${s.w}x${s.h}`);
      if (r.boxesOut.length !== im.boxes.length) fails.push(`${im.id} boxesOut 개수 불일치`);
      for (const b of r.boxesOut) if (!b.action || !b.bg || typeof b.onPhoto !== "boolean") fails.push(`${im.id} boxesOut 필드 누락: ${JSON.stringify(b)}`);
      // 배경 종류별 기대
      if (s.bg === "solid") {
        if (r.kept) fails.push(`${im.id} 단색인데 kept ${r.kept}개`);
        const bm = loadBitmap(after);
        const bg = hexToBGR(s.color);
        for (const b of r.boxesOut) {
          const d = meanDiff(bm, expandRect(b, 4, bm.w, bm.h), bg);
          if (d > 12) fails.push(`${im.id} "${b.text}" 지운 뒤 평균 색 차이 ${d.toFixed(1)} > 12`);
        }
        const dAll = Math.max(...r.boxesOut.map((b) => meanDiff(bm, expandRect(b, 4, bm.w, bm.h), bg)));
        console.log(`     단색 검사: 최대 평균 색 차이 ${dAll.toFixed(2)}/255`);
      } else if (s.bg === "gradient") {
        if (r.kept) fails.push(`${im.id} 그라데이션인데 kept ${r.kept}개`);
      } else if (s.bg === "photo") {
        if (r.erased) fails.push(`${im.id} 사진인데 erased ${r.erased}개`);
        for (const b of r.boxesOut) if (!b.onPhoto || b.action !== "kept") fails.push(`${im.id} 사진 위 글자가 kept/onPhoto 가 아님: ${b.text}`);
      } else if (s.bg === "mixed") {
        const pr = s.photoRect;
        for (const b of r.boxesOut) {
          const onPhoto = b.y + b.h / 2 >= pr.y && b.y + b.h / 2 < pr.y + pr.h;
          if (onPhoto && b.action !== "kept") fails.push(`${im.id} 사진 위 "${b.text}" 가 ${b.action}`);
          if (!onPhoto && b.action !== "erased") fails.push(`${im.id} 단색 위 "${b.text}" 가 ${b.action}`);
        }
      }
      afterList.push({ id: im.id, file: after, w: s.w, h: s.h });
    }
    // ---- 지운 뒤 다시 OCR: 단색 샘플 CJK 상자 수 ≤ 원본 20% ----
    const re = await ocrImages(afterList, { provider: "vision", log });
    let beforeCjk = 0, afterCjk = 0;
    for (const im of re.images) {
      const s = samples[im.id];
      const b0 = ocr.images.find((x) => x.id === im.id).boxes.filter((b) => hasCJK(b.text)).length;
      const b1 = im.boxes.filter((b) => hasCJK(b.text)).length;
      summary[im.id].cjkBefore = b0; summary[im.id].cjkAfter = b1;
      if (s.bg === "solid" || s.bg === "gradient") {
        beforeCjk += b0; afterCjk += b1;
        if (b1 > b0 * 0.2) fails.push(`${im.id} 지운 뒤 CJK 상자 ${b1}개 > 원본 ${b0}개의 20% (${im.boxes.map((b) => b.text).join(" / ")})`);
      }
      console.log(`  재OCR ${im.id}: CJK ${b0} → ${b1}${im.boxes.length ? " · " + im.boxes.map((b) => b.text).join(" / ") : ""}`);
    }
    console.log(`단색·그라데이션 샘플 CJK 상자 ${beforeCjk} → ${afterCjk} (${beforeCjk ? ((afterCjk / beforeCjk) * 100).toFixed(1) : 0}%)`);

    // ---- 보완 1차: 글자 띠 자르기 → 빈 여백 자르기 (after → <id>-trim.png) ----
    const trimSummary = {};
    for (const im of ocr.images) {
      const s = samples[im.id];
      const after = path.join(outDir, `${im.id}-after.png`), trim = path.join(outDir, `${im.id}-trim.png`);
      const c = cleanImage({ file: path.join(imgDir, `${im.id}.png`), boxes: im.boxes, out: after });
      const b = cropTextBand(after, c.boxesOut, trim);
      const t = autoTrim(trim, trim);
      const boxes = t.trimmed ? (await import("../../src/main/detail/image-core.js")).shiftBoxes(b.boxesOut, t.rect) : b.boxesOut;
      const info = imageInfo(trim);
      trimSummary[im.id] = { bandCut: b.bandCut, cutTop: b.cutTop, cutBottom: b.cutBottom, trimmed: t.trimmed, rect: t.rect, w: info.w, h: info.h, kept: boxes.filter((x) => x.action === "kept").length, blank: t.blank, contentRatio: t.contentRatio };
      console.log(`  트림 ${im.id} ${s.w}x${s.h} → 띠 ${b.bandCut ? `위${b.cutTop}/아래${b.cutBottom}` : "없음"} · 여백 ${t.trimmed ? `${t.rect.x},${t.rect.y} ${t.rect.w}x${t.rect.h}` : "없음"} → ${info.w}x${info.h} · 남은 kept ${trimSummary[im.id].kept} · 내용 ${(t.contentRatio * 100).toFixed(1)}%${t.blank ? " (blank)" : ""}`);
      const infoR = imageInfo(trim, { ratio: true });
      if (typeof t.contentRatio !== "number" || Math.abs(infoR.contentRatio - t.contentRatio) > 1e-9) fails.push(`${im.id} contentRatio 불일치 autoTrim ${t.contentRatio} vs imageInfo ${infoR.contentRatio}`);
      // 기대: 글자만 있던 d02/d09 는 blank + 내용 < 3%, 사진은 > 30%
      if (["d02", "d09"].includes(im.id) && !(t.blank && t.contentRatio < 0.03)) fails.push(`${im.id} 빈 이미지 기대: blank=${t.blank} contentRatio=${t.contentRatio}`);
      if (s.bg === "photo" && !(t.contentRatio > 0.3)) fails.push(`${im.id} 사진 contentRatio ${t.contentRatio} ≤ 0.3`);
      if (info.w !== t.w || info.h !== t.h) fails.push(`${im.id} autoTrim 반환 크기 ${t.w}x${t.h} ≠ 파일 ${info.w}x${info.h}`);
      if (t.trimmed && (t.rect.w !== info.w || t.rect.h !== info.h)) fails.push(`${im.id} autoTrim rect 와 결과 크기 불일치`);
      for (const x of boxes) if (x.x < 0 || x.y < 0 || x.x + x.w > info.w || x.y + x.h > info.h) fails.push(`${im.id} 보정된 상자가 이미지 밖: ${JSON.stringify(x)}`);
      // 기대: 사진 위 글자가 위/아래 가장자리에만 있는 d05(위+아래), d06(위), g01(위), d12(아래) 는 띠가 잘리고 kept 0
      if (["d05", "d06", "g01", "d12"].includes(im.id)) { if (!b.bandCut) fails.push(`${im.id} 글자 띠가 안 잘림`); if (trimSummary[im.id].kept) fails.push(`${im.id} 띠를 잘랐는데 kept ${trimSummary[im.id].kept}개 남음`); }
      // 기대: 단색 샘플은 지운 자리 여백이 잘려 세로가 줄어든다(d01 1200 → 도형 560 + 여백 ≤ 620)
      if (im.id === "d01" && !(t.trimmed && info.h <= 620 && info.h >= 560)) fails.push(`d01 여백 자르기 기대 560~620 ≠ ${info.h}`);
      if (im.id === "d07" && !(t.trimmed && info.h < 3200)) fails.push(`d07 긴 이미지 여백이 안 잘림`);
      // 기대: 사진(g02, g03)은 가장자리까지 내용이라 안 잘린다
      if (["g02", "g03"].includes(im.id) && t.trimmed) fails.push(`${im.id} 사진인데 잘림 ${JSON.stringify(t.rect)}`);
    }
    // 재OCR: 트림 결과에도 CJK 가 남지 않는지(단색·그라데이션·띠 잘린 사진)
    const reT = await ocrImages(ocr.images.map((im) => ({ id: im.id, file: path.join(outDir, `${im.id}-trim.png`) })), { provider: "vision", log });
    for (const im of reT.images) {
      const n = im.boxes.filter((b) => hasCJK(b.text)).length;
      trimSummary[im.id].cjkAfterTrim = n;
      if (n) { console.log(`  트림 재OCR ${im.id}: CJK ${n} · ${im.boxes.map((b) => b.text).join(" / ")}`); if (samples[im.id].bg !== "photo" || ["d05", "d06", "g01"].includes(im.id)) fails.push(`${im.id} 트림 뒤에도 CJK ${n}개`); }
    }
    console.log(`트림 뒤 CJK 상자 합계 ${reT.images.reduce((a, im) => a + im.boxes.filter((b) => hasCJK(b.text)).length, 0)}개`);
    fs.writeFileSync(path.join(outDir, "trim-summary.json"), JSON.stringify(trimSummary, null, 2));

    // ---- 보조 API: imageInfo / resizeToWidth / cropRect ----
    const info = imageInfo(path.join(imgDir, "d07.png"));
    if (info.w !== 750 || info.h !== 3200) fails.push(`imageInfo 오류 ${JSON.stringify(info)}`);
    const rs = resizeToWidth(path.join(imgDir, "d01.png"), path.join(outDir, "d01-780.png"), 780);
    const rsInfo = imageInfo(rs.out);
    if (rsInfo.w !== 780 || Math.abs(rsInfo.h - Math.round((1200 * 780) / 790)) > 1) fails.push(`resizeToWidth 오류 ${JSON.stringify(rsInfo)}`);
    const cr = cropRect(path.join(imgDir, "d07.png"), path.join(outDir, "d07-cut1.png"), { x: 0, y: 1500, w: 750, h: 1500 });
    const crInfo = imageInfo(cr.out);
    if (crInfo.w !== 750 || crInfo.h !== 1500) fails.push(`cropRect 오류 ${JSON.stringify(crInfo)}`);
    const cr2 = cropRect(path.join(imgDir, "d07.png"), path.join(outDir, "d07-cut3.png"), { x: 0, y: 3000, w: 750, h: 1500 });
    if (cr2.h !== 200) fails.push(`cropRect 끝 처리 오류 ${JSON.stringify(cr2)}`);
    console.log(`보조 API: imageInfo ${info.w}x${info.h}, resizeToWidth ${rsInfo.w}x${rsInfo.h}, cropRect ${crInfo.w}x${crInfo.h} / ${cr2.w}x${cr2.h}`);
    fs.writeFileSync(path.join(outDir, "clean-summary.json"), JSON.stringify(summary, null, 2));
    console.log(`전체 ${Date.now() - t0}ms · before/after → ${outDir}`);
  } catch (e) {
    fails.push(`예외: ${e?.stack || e}`);
  }
  if (fails.length) { console.log("A2_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK A2_OK");
  app.quit();
});
