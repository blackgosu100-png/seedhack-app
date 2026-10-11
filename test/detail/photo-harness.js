// 사진 영역 잘라내기 하네스 — 실제 작업 폴더(raw/*.jpg + ocr.json)로 cropPhoto 를 전부 돌려 결과 PNG 와 표를 낸다.
// 실행: npx electron test/detail/photo-harness.js [jobDir]
//   기본 jobDir: ~/Library/Application Support/씨드핵/detail/20261009-080956-948424797701 (실제 1688 상품, 32장)
//   없으면 test/detail/fixture/img + Vision OCR 로 대신한다.
// 결과: test/detail/img/out/photo/<id>.png, _sheet<n>.png(한눈 보기용 축소 모음), photo-summary.json
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JOB = path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail", "20261009-080956-948424797701");
const jobDir = process.argv.find((a, i) => i >= 2 && !a.startsWith("--") && fs.existsSync(a)) || DEFAULT_JOB;
const outDir = path.join(here, "img", "out", "photo");
const log = (_lv, text) => console.log(text);

// 축소 모음(contact sheet): 결과들을 tile px 안에 맞춰(최근접) 4열로 늘어놓는다 — 사람이 한 번에 훑어보기용
function sheet(items, tile = 300, cols = 4, gap = 10) {
  const rowsN = Math.ceil(items.length / cols);
  const W = cols * tile + (cols + 1) * gap, H = rowsN * tile + (rowsN + 1) * gap;
  const data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 60; data[i * 4 + 1] = 60; data[i * 4 + 2] = 60; data[i * 4 + 3] = 255; }
  items.forEach((bm, k) => {
    const cx = gap + (k % cols) * (tile + gap), cy = gap + Math.floor(k / cols) * (tile + gap);
    if (!bm) { for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) { const i = ((cy + y) * W + cx + x) * 4; data[i] = 40; data[i + 1] = 40; data[i + 2] = 120; } return; } // 실패 = 붉은 칸
    const s = Math.min(tile / bm.w, tile / bm.h);
    const tw = Math.max(1, Math.round(bm.w * s)), th = Math.max(1, Math.round(bm.h * s));
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const sx = Math.min(bm.w - 1, Math.floor(x / s)), sy = Math.min(bm.h - 1, Math.floor(y / s));
      const si = (sy * bm.w + sx) * 4, di = ((cy + y) * W + cx + x) * 4;
      data[di] = bm.data[si]; data[di + 1] = bm.data[si + 1]; data[di + 2] = bm.data[si + 2]; data[di + 3] = 255;
    }
  });
  return { data, w: W, h: H };
}

app.whenReady().then(async () => {
  const fails = [];
  try {
    const { cropPhoto, loadBitmap, saveBitmap } = await import("../../src/main/detail/image.js");
    const { ocrImages } = await import("../../src/main/detail/ocr.js");
    fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
    let ocr, rawDir;
    if (fs.existsSync(path.join(jobDir, "ocr.json")) && fs.existsSync(path.join(jobDir, "raw"))) {
      ocr = JSON.parse(fs.readFileSync(path.join(jobDir, "ocr.json"), "utf8")); rawDir = path.join(jobDir, "raw");
      console.log(`작업 폴더: ${jobDir} (OCR ${ocr.provider}, ${ocr.images.length}장)`);
    } else {
      rawDir = path.join(here, "fixture", "img");
      const ids = fs.readdirSync(rawDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => f.replace(/\.\w+$/, "")).sort();
      ocr = await ocrImages(ids.map((id) => ({ id, file: path.join(rawDir, fs.readdirSync(rawDir).find((f) => f.startsWith(id + ".")) )})), { provider: "vision", log });
      console.log(`fixture 샘플 ${ids.length}장 (Vision OCR)`);
    }
    const files = fs.readdirSync(rawDir);
    const rows = [];
    const sheets = [];
    const t0 = Date.now();
    for (const im of ocr.images) {
      const fn = files.find((f) => f.replace(/\.\w+$/, "") === im.id);
      if (!fn) { console.log(`  ${im.id}: raw 파일 없음`); continue; }
      const file = path.join(rawDir, fn), out = path.join(outDir, `${im.id}.png`);
      const t = Date.now();
      let r;
      try { r = cropPhoto(file, im.boxes || [], out); } catch (e) { fails.push(`${im.id} cropPhoto 예외: ${e?.message || e}`); continue; }
      const ms = Date.now() - t;
      const row = { id: im.id, src: `${im.w}x${im.h}`, boxes: (im.boxes || []).length, ok: r.ok, rect: r.rect, w: r.w, h: r.h, coverage: r.coverage, contentRatio: r.contentRatio, texture: r.texture, residual: r.residual, cutTop: r.cutTop, cutBottom: r.cutBottom, ms };
      rows.push(row);
      sheets.push(r.ok ? loadBitmap(out) : null);
      if (r.ok && !fs.existsSync(out)) fails.push(`${im.id} ok 인데 파일 없음`);
      if (!r.ok && fs.existsSync(out)) fails.push(`${im.id} ok=false 인데 파일 있음`);
    }
    console.log(`\n| id | 원본 | 상자 | ok | rect(x,y w×h) | 결과 | 면적비 | 내용 | 질감 | 띠(위/아래) | 잔여 | ms |\n|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of rows) console.log(`| ${r.id} | ${r.src} | ${r.boxes} | ${r.ok ? "✅" : "❌"} | ${r.rect ? `${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h}` : "-"} | ${r.ok ? `${r.w}×${r.h}` : "-"} | ${(r.coverage * 100).toFixed(0)}% | ${(r.contentRatio * 100).toFixed(0)}% | ${((r.texture || 0) * 100).toFixed(1)}% | ${r.cutTop}/${r.cutBottom} | ${r.residual} | ${r.ms} |`);
    const okN = rows.filter((r) => r.ok).length;
    console.log(`\n${rows.length}장 중 ok ${okN}장 · ${Date.now() - t0}ms · 결과 → ${outDir}`);
    // 글자만 있는 이미지는 ok=false 여야 한다(실제 폴더 기준 d14·d17·d21·d22)
    if (jobDir === DEFAULT_JOB) for (const id of ["d17", "d21", "d22"]) { const r = rows.find((x) => x.id === id); if (r?.ok) fails.push(`${id} 글자만 있는 이미지인데 ok=true (${JSON.stringify(r.rect)})`); }
    for (let i = 0; i < sheets.length; i += 12) saveBitmap(sheet(sheets.slice(i, i + 12)), path.join(outDir, `_sheet${i / 12 + 1}.png`));
    console.log(`축소 모음: ${Math.ceil(sheets.length / 12)}장 (_sheet<n>.png, 12장씩 4열, 순서 = 표 순서, 붉은 칸 = ok:false)`);
    fs.writeFileSync(path.join(outDir, "photo-summary.json"), JSON.stringify(rows, null, 2));
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("PHOTO_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK PHOTO_OK");
  app.quit();
});
