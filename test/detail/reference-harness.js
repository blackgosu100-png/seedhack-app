// 레퍼런스 분석 하네스 — 레퍼런스 이미지 폴더 → reference.json(+ 비전 시트)
//   npx electron test/detail/reference-harness.js "<레퍼런스 폴더>" <출력 폴더> [--no-vision] [--model=haiku|sonnet] [--reuse=<지난 reference.json>(비전 재사용)]
//   → <출력>/reference.json · sheet-01.jpg … · 마지막 줄 "REF_OK"
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { buildReference } from "../../src/main/detail/reference.js";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-reference"));
app.on("window-all-closed", () => {});
const args = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/electron|reference-harness\.js$/.test(a));
const opt = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3) || null;
app.whenReady().then(async () => {
  try {
    const [input, outDir] = args;
    const ref = await buildReference({ input, outDir, vision: !process.argv.includes("--no-vision"), reuse: opt("reuse") ? JSON.parse(fs.readFileSync(opt("reuse"), "utf8")) : null, model: opt("model") || undefined, log: (c, t) => console.log(t) });
    if (ref.error && !ref.tokens) throw new Error(ref.error);
    console.log("측정:", JSON.stringify(ref.measured));
    console.log("손잡이:", JSON.stringify(ref.tokens));
    console.log("섹션:", (ref.sections || []).map((s) => `${s.order}.${s.our_type}${s.kicker ? `[${s.kicker}]` : ""}${s.bg ? `(${s.bg})` : ""}`).join(" "));
    console.log("보정 style:", JSON.stringify(ref.styleFixed));
    console.log("비용:", JSON.stringify(ref.cost));
    console.log("REF_OK");
    app.exit(0);
  } catch (e) { console.error("REF_FAIL", e?.stack || e); app.exit(1); }
});
