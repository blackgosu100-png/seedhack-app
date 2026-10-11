// 누끼 하네스 — 실제 작업 폴더(clean/*.png, 없으면 raw/*.jpg)로 cutoutImages 를 전부 돌려 알파 PNG 와 합성 미리보기 시트를 만든다.
// 실행: npx electron test/detail/cutout-harness.js [jobDir] [--clean]   (기본 raw/*.jpg, --clean 이면 clean/*.png)
// 결과: test/detail/img/out/cutout/<id>.png(알파), _white<n>.png / _gray<n>.png(흰·회색 배경 합성, 12장씩 4열, 붉은 칸 = cutoutOk:false), cutout-summary.json
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JOB = path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail", "20261009-080956-948424797701");
const jobDir = process.argv.find((a, i) => i >= 2 && !a.startsWith("--") && fs.existsSync(a)) || DEFAULT_JOB;
const outDir = path.join(here, "img", "out", "cutout");
const log = (_lv, text) => console.log(text);

// 알파(premultiplied BGRA) 비트맵을 단색 배경 위에 합성해 tile 안에 맞춰 늘어놓는다
function sheet(items, bg, tile = 300, cols = 4, gap = 10) {
  const rowsN = Math.ceil(items.length / cols);
  const W = cols * tile + (cols + 1) * gap, H = rowsN * tile + (rowsN + 1) * gap;
  const data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 60; data[i * 4 + 1] = 60; data[i * 4 + 2] = 60; data[i * 4 + 3] = 255; }
  items.forEach((bm, k) => {
    const cx = gap + (k % cols) * (tile + gap), cy = gap + Math.floor(k / cols) * (tile + gap);
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) { const i = ((cy + y) * W + cx + x) * 4; if (bm) { data[i] = bg[0]; data[i + 1] = bg[1]; data[i + 2] = bg[2]; } else { data[i] = 40; data[i + 1] = 40; data[i + 2] = 120; } }
    if (!bm) return;
    const s = Math.min(tile / bm.w, tile / bm.h);
    const tw = Math.max(1, Math.round(bm.w * s)), th = Math.max(1, Math.round(bm.h * s));
    const ox = cx + Math.floor((tile - tw) / 2), oy = cy + Math.floor((tile - th) / 2);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const sx = Math.min(bm.w - 1, Math.floor(x / s)), sy = Math.min(bm.h - 1, Math.floor(y / s));
      const si = (sy * bm.w + sx) * 4, di = ((oy + y) * W + ox + x) * 4, a = bm.data[si + 3] / 255;
      data[di] = Math.round(bm.data[si] + bg[0] * (1 - a)); data[di + 1] = Math.round(bm.data[si + 1] + bg[1] * (1 - a)); data[di + 2] = Math.round(bm.data[si + 2] + bg[2] * (1 - a)); data[di + 3] = 255;
    }
  });
  return { data, w: W, h: H };
}

app.whenReady().then(async () => {
  const fails = [];
  try {
    const { cutoutImages, cutoutFailReason } = await import("../../src/main/detail/cutout.js");
    const { loadBitmap, saveBitmap, palette } = await import("../../src/main/detail/image.js");
    fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
    // 기본은 raw(원본 사진이 온전함). clean/ 은 v1 지우기·트림을 거친 것이라 --clean 을 줄 때만
    let srcDir = path.join(jobDir, process.argv.includes("--clean") ? "clean" : "raw");
    if (!fs.existsSync(srcDir) || !fs.readdirSync(srcDir).some((f) => /\.(png|jpe?g)$/i.test(f))) srcDir = path.join(jobDir, "raw");
    if (!fs.existsSync(srcDir)) srcDir = path.join(here, "fixture", "img");
    const files = fs.readdirSync(srcDir).filter((f) => /\.(png|jpe?g)$/i.test(f) && !/_\d+\.png$/.test(f)).sort();
    console.log(`입력: ${srcDir} (${files.length}장)`);
    // OCR 상자(ocr.json, raw 기준)가 있으면 넘긴다 → 가장자리 배지·글자 띠 제거
    let ocrMap = {};
    try { if (!process.argv.includes("--clean")) for (const im of JSON.parse(fs.readFileSync(path.join(jobDir, "ocr.json"), "utf8")).images || []) ocrMap[im.id] = im.boxes || []; } catch {}
    const items = files.map((f) => { const id = f.replace(/\.\w+$/, ""); return { id, file: path.join(srcDir, f), out: path.join(outDir, id + ".png"), boxes: ocrMap[id] || null }; });
    const t0 = Date.now();
    const progress = [];
    const res = await cutoutImages(items, { log, onProgress: (p) => progress.push(p) });
    console.log(`누끼 ${items.length}장 ${Date.now() - t0}ms${cutoutFailReason() ? " · " + cutoutFailReason() : ""}`);
    if (progress.length !== items.length) fails.push(`onProgress ${progress.length}회 ≠ ${items.length}`);
    console.log(`\n| id | 원본 | ok | cutoutOk | bbox | coverage | 결과 | accent / bg / dark | 글자띠 | 사유 |\n|---|---|---|---|---|---|---|---|---|---|`);
    const tiles = [];
    for (const r of res) {
      const bb = r.bbox ? `${r.bbox.x},${r.bbox.y} ${r.bbox.w}×${r.bbox.h}` : "-";
      console.log(`| ${r.id} | ${r.w}x${r.h} | ${r.ok ? "✅" : "❌"} | ${r.cutoutOk ? "✅" : "❌"} | ${bb} | ${(r.coverage * 100).toFixed(1)}% | ${r.out ? `${r.w}×${r.h}` : "-"} | ${r.palette ? `${r.palette.accent} / ${r.palette.bg} / ${r.palette.dark}` : "-"} | ${r.textCut || 0} | ${r.reason || ""} |`);
      if (r.cutoutOk && !fs.existsSync(r.out)) fails.push(`${r.id} cutoutOk 인데 파일 없음`);
      if (!r.cutoutOk && r.out) fails.push(`${r.id} cutoutOk=false 인데 out 있음`);
      if (r.cutoutOk) { const p = palette(r.out); if (!p.dominant.length || !/^#[0-9a-f]{6}$/.test(p.accent)) fails.push(`${r.id} palette 형식 오류 ${JSON.stringify(p)}`); }
      tiles.push(r.cutoutOk ? loadBitmap(r.out) : null);
    }
    const okN = res.filter((r) => r.cutoutOk).length;
    console.log(`\n${res.length}장 중 제품 단독 컷 ${okN}장 · 결과 → ${outDir}`);
    for (let i = 0; i < tiles.length; i += 12) {
      saveBitmap(sheet(tiles.slice(i, i + 12), [255, 255, 255]), path.join(outDir, `_white${i / 12 + 1}.png`));
      saveBitmap(sheet(tiles.slice(i, i + 12), [200, 200, 200]), path.join(outDir, `_gray${i / 12 + 1}.png`));
    }
    console.log(`미리보기 시트: _white<n>.png / _gray<n>.png (12장씩 4열, 순서 = 표 순서, 붉은 칸 = cutoutOk:false)`);
    if (jobDir === DEFAULT_JOB) {
      for (const id of ["g01", "g05", "g09"]) { const r = res.find((x) => x.id === id); if (!r?.cutoutOk) fails.push(`${id} 제품 단독 사진인데 cutoutOk=false (${r?.reason})`); }
    }
    if (process.platform === "darwin" && !res.some((r) => r.ok)) fails.push("맥인데 누끼가 하나도 안 됨");
    fs.writeFileSync(path.join(outDir, "cutout-summary.json"), JSON.stringify(res, null, 2));
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("CUTOUT_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK CUTOUT_OK");
  app.quit();
});
