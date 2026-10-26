// 🖼 썸네일 하네스 — 실제 상세페이지 작업 폴더를 임시로 복사해(원본 수정 금지) makeThumbs 를 돌리고 결과를 모은다.
// 실행: npx electron test/detail/thumb-harness.js <jobId> [<jobId> …] [--out=<결과 폴더>] [--no-scene]
//   이미지 생성: Vertex ADC(gcloud auth application-default login) 또는 GEMINI_API_KEY. 판정·검수: Claude CLI.
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
app.on("window-all-closed", () => {}); // 오프스크린 창을 닫아도 하네스가 끝나지 않게
const args = process.argv.slice(2).filter((a) => !a.startsWith("-") && /^\d{8}-/.test(a));
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const SRC = path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail");
const OUT = opt("out") || path.join(os.tmpdir(), "seedhack-thumb-out");
const NEED = ["result.json", "out", "source.json", "ocr.json", "vision.json", "brief.json", "info.json", "style.json", "cutout.json", "raw", "clean"];

app.whenReady().then(async () => {
  const { makeThumbs } = await import("../../src/main/detail/thumb.js");
  const report = [];
  for (const jobId of args) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `thumb-${jobId}-`));
    for (const f of NEED) { const s = path.join(SRC, jobId, f); if (fs.existsSync(s)) fs.cpSync(s, path.join(tmp, f), { recursive: true }); }
    console.log(`\n=== ${jobId} → ${tmp}`);
    try {
      const r = await makeThumbs({ dir: tmp, env: process.env, noScene: process.argv.includes("--no-scene"), log: (_l, m) => console.log(m), onStep: (s) => console.log(`  [${s.pct}%] ${s.msg}`) });
      const od = path.join(OUT, `${jobId}`); fs.rmSync(od, { recursive: true, force: true }); fs.mkdirSync(od, { recursive: true });
      for (const x of r.items) fs.copyFileSync(path.join(tmp, x.file), path.join(od, path.basename(x.file)));
      if ((r.optionMains || []).some((o) => o.file)) { fs.mkdirSync(path.join(od, "options"), { recursive: true }); for (const o of r.optionMains) if (o.file) fs.copyFileSync(path.join(tmp, o.file), path.join(od, "options", `${o.id}-${String(o.name || "").replace(/[\\/:*?"<>|]/g, "").slice(0, 24)}.jpg`)); }
      for (const c of r.candidates) if (c.id === r.hero.id) fs.copyFileSync(path.join(tmp, c.cut), path.join(od, `cutout-${c.id}.png`));
      fs.copyFileSync(path.join(tmp, r.hero.file), path.join(od, `원본-${path.basename(r.hero.file)}`));
      fs.writeFileSync(path.join(od, "thumb.json"), JSON.stringify(r, null, 1));
      report.push({ jobId, product: r.product, n: r.items.length, summary: r.summary, items: r.items.map((x) => `${x.kind}:${x.status}${x.issues.length ? `(${x.issues.map((i) => i.why).join("/")})` : ""}`), options: (r.optionMains || []).map((o) => `${o.id}:${o.name}:${o.status}`), notes: r.notes, cost: r.cost, timings: r.timings });
      console.log(JSON.stringify(report.at(-1), null, 1));
    } catch (e) { console.log(`실패: ${e.stack || e}`); report.push({ jobId, error: String(e.message || e) }); }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  app.quit();
});
