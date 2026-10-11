// 원본 한글화 하네스 — 실제 1688 상세 이미지 폴더(detail-*.jpg)를 Vision OCR → localizeImage → before/after·layers 저장, 지운 뒤 재OCR 로 남은 중국어 확인.
// 실행: npx electron test/detail/localize-harness.js [폴더] [--no-ai] [--only=01,07]
// 결과: test/detail/img/out/localize/<이름>-before.jpg / -after.png / -layers.json, summary.json, _sheet<n>.png(before|after 나란히)
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(os.homedir(), "Downloads", "일본 커피 머신 스토리지 랙 데스크탑 컵 스토리지 랙 바 캐비닛 워터 바기구 쌓인 풀 아웃 랙 - 阿里巴巴");
const dir = process.argv.find((a, i) => i >= 2 && !a.startsWith("--") && fs.existsSync(a)) || DEFAULT_DIR;
const outDir = path.join(here, "img", "out", "localize");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const log = (_l, t) => console.log(t);

app.whenReady().then(async () => {
  const fails = [];
  try {
    const { ocrImages } = await import("../../src/main/detail/ocr.js");
    const { localizeImage } = await import("../../src/main/detail/localize.js");
    const { loadBitmap, saveBitmap } = await import("../../src/main/detail/image.js");
    const { hasCJK, isNumberText } = await import("../../src/main/detail/image-core.js");
    fs.mkdirSync(outDir, { recursive: true });
    const only = arg("only", "");
    const files = fs.readdirSync(dir).filter((f) => /^detail-\d+\.(jpe?g|png)$/i.test(f)).sort().filter((f) => !only || only.split(",").some((n) => f.includes(`-${n}.`)));
    const items = files.map((f) => ({ id: f.replace(/\.\w+$/, ""), file: path.join(dir, f) }));
    console.log(`입력 ${items.length}장 · ${dir}`);
    const ocr = await ocrImages(items, { provider: "vision", log });
    const rows = [];
    const t0 = Date.now();
    for (const it of items) {
      const o = ocr.images.find((x) => x.id === it.id);
      const out = path.join(outDir, `${it.id}-after.png`);
      fs.copyFileSync(it.file, path.join(outDir, `${it.id}-before${path.extname(it.file)}`));
      const t = Date.now();
      const r = await localizeImage({ file: it.file, ocrBoxes: o?.boxes || [], out, ai: !process.argv.includes("--no-ai"), log });
      fs.writeFileSync(path.join(outDir, `${it.id}-layers.json`), JSON.stringify(r, null, 2));
      rows.push({ id: it.id, ms: Date.now() - t, r, out });
    }
    // 지운 뒤 재OCR: 숫자가 아닌 CJK 상자가 남았는지
    const re = await ocrImages(rows.map((x) => ({ id: x.id, file: x.out })), { provider: "vision", log });
    console.log(`\n| 이미지 | 덩어리 | js | ai | 그대로(숫자) | 역할 | AI(밖 변화) | 남은 중국어 | ms |\n|---|---|---|---|---|---|---|---|---|`);
    let aiCalls = 0, aiOk = 0;
    for (const x of rows) {
      const L = x.r.layers;
      const left = (re.images.find((y) => y.id === x.id)?.boxes || []).filter((b) => hasCJK(b.text) && !isNumberText(b.text));
      x.left = left.map((b) => b.text);
      if (x.r.ai.used) { aiCalls++; if (x.r.ai.accepted) aiOk++; }
      const roles = [...new Set(L.map((l) => l.role))].join(",");
      console.log(`| ${x.id}${x.r.promo ? " (홍보)" : ""} | ${L.length} | ${L.filter((l) => l.erased === "js").length} | ${L.filter((l) => l.erased === "ai").length} | ${L.filter((l) => l.erased === "kept").length} | ${roles} | ${x.r.ai.used ? `${x.r.ai.accepted ? "적용" : "버림"}(${x.r.ai.diff ?? "-"})` : "-"} | ${left.length ? left.map((b) => b.text).join(" / ").slice(0, 40) : "0"} | ${x.ms} |`);
    }
    const sec = (Date.now() - t0) / 1000;
    console.log(`\n총 ${sec.toFixed(1)}초 · AI 호출 ${aiCalls}회(적용 ${aiOk}) ≈ $${(aiCalls * 0.039).toFixed(2)}`);
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ sec, aiCalls, aiOk, rows: rows.map((x) => ({ id: x.id, ms: x.ms, promo: x.r.promo, ai: x.r.ai, left: x.left, layers: x.r.layers.map((l) => ({ zh: l.zh, role: l.role, erased: l.erased, style: l.style })) })) }, null, 2));
    // before|after 나란히 축소 시트(4쌍씩)
    const pairs = rows.map((x) => [loadBitmap(path.join(outDir, fs.readdirSync(outDir).find((f) => f.startsWith(`${x.id}-before`)))), loadBitmap(x.out)]);
    for (let s = 0; s < pairs.length; s += 4) {
      const part = pairs.slice(s, s + 4), tw = 300, gap = 8;
      const hs = part.map(([a]) => Math.round(a.h * (tw / a.w)));
      const W = tw * 2 + gap * 3, Hh = hs.reduce((t, h) => t + h + gap, gap);
      const data = Buffer.alloc(W * Hh * 4, 50); for (let i = 3; i < data.length; i += 4) data[i] = 255;
      let oy = gap;
      part.forEach((pr, k) => { pr.forEach((bm, c) => { const sc = tw / bm.w, th = hs[k], ox = gap + c * (tw + gap);
        for (let y = 0; y < th; y++) for (let xx = 0; xx < tw; xx++) { const si = (Math.min(bm.h - 1, Math.floor(y / sc)) * bm.w + Math.min(bm.w - 1, Math.floor(xx / sc))) * 4, di = ((oy + y) * W + ox + xx) * 4; data[di] = bm.data[si]; data[di + 1] = bm.data[si + 1]; data[di + 2] = bm.data[si + 2]; } }); oy += hs[k] + gap; });
      saveBitmap({ data, w: W, h: Hh }, path.join(outDir, `_sheet${s / 4 + 1}.png`));
    }
    console.log(`결과 → ${outDir}`);
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("LOCALIZE_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK LOCALIZE_OK");
  app.quit();
});
