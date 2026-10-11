// 🧭 기획안 하네스 — 실제 작업 JSON(real-948424797701)으로 Claude CLI(WebSearch 허용) 를 1회 호출해 brief 를 저장한다.
//   node test/detail/brief-harness.js            → test/detail/fixture/brief-real-sample.json (+ .meta.json)
//   node test/detail/brief-harness.js --rules    → 규칙 기본 기획안만(brief-real-sample.rules.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { buildCopyInput } from "../../src/main/detail/copy.js";
import { writeBrief, briefInputFrom, validateBrief } from "../../src/main/detail/brief.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(here, "fixture", "real-948424797701");
export function realCopyInput() {
  const src = JSON.parse(fs.readFileSync(path.join(R, "source.json"), "utf8")), ocr = JSON.parse(fs.readFileSync(path.join(R, "ocr.json"), "utf8"));
  const tr = JSON.parse(fs.readFileSync(path.join(R, "translate.json"), "utf8"));
  for (const o of ocr.images) for (const b of o.boxes || []) if (b.text_ko && !tr[b.text]) tr[b.text] = b.text_ko;
  const vision = fs.existsSync(path.join(here, "fixture", "vision-real-sample.json")) ? JSON.parse(fs.readFileSync(path.join(here, "fixture", "vision-real-sample.json"), "utf8")) : null;
  return buildCopyInput({ source: { ...src, title_ko: undefined }, ocr, ko: tr, keyword: src.keyword || "벽걸이 빨래건조대", coupangName: src.coupangName || "", category: src.category || "", vision });
}
// v3: 실제 작업 폴더(jobDir)로 기획서(keyContent)+styleGuide 1회 호출 — node test/detail/brief-harness.js --v3 [jobDir] [--search]
async function runV3() {
  const { writeBriefV3, briefV3InputFrom } = await import("../../src/main/detail/brief.js");
  const dir = process.argv.find((a, i) => i > 1 && !a.startsWith("--") && fs.existsSync(path.join(a, "source.json"))) || path.join(os.tmpdir(), "seedhack-detail-test", "replay", "detail", "20261009-080956-948424797701-replay");
  const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return d; } };
  const source = rd("source.json"), ocr = rd("ocr.json", { images: [] }), cleaned = rd("clean.json", []), tr = rd("translate.json", {}), vision = rd("vision.json"), cut = rd("cutout.json");
  for (const o of ocr.images || []) for (const b of o.boxes || []) if (b.text_ko && !tr[b.text]) tr[b.text] = b.text_ko;
  const input = buildCopyInput({ source, ocr, cleaned, ko: tr, keyword: source.keyword || "", vision });
  if (!input.title_ko || /회사|公司/.test(input.title_ko)) input.title_ko = source.title_ko && !/회사/.test(source.title_ko) ? source.title_ko : "벽걸이 접이식 빨래 건조대";
  const vItems = (vision?.items || vision || []).filter((v) => v.usable !== false).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4);
  const photos = vItems.map((v) => { const c = cleaned.find((x) => x.id === v.id); const f = c?.photo?.file || c?.out || `clean/${v.id}.png`; return { id: v.id, file: path.join(dir, f) }; }).filter((p) => fs.existsSync(p.file));
  const bi = briefV3InputFrom(input, { vision, palette: cut?.palette || null, photos });
  console.log(`▶ 기획서 v3 하네스 · ${dir}
  속성 ${bi.attrs_ko.length} · 이미지 글 ${bi.images.filter((i) => i.texts_ko.length).length}장 · 대표 사진 ${photos.length} · 팔레트 ${(bi.palette?.dominant || []).join(" ")}`);
  const r = await writeBriefV3(bi, { log: (c, t) => console.log(`[${c}] ${t}`), webSearch: process.argv.includes("--search") });
  console.log(`■ 경로 ${r.how} · ${(r.elapsedMs / 1000).toFixed(1)}초 · 비용 ${r.costUsd != null ? `$${Number(r.costUsd).toFixed(4)}` : "-"}${r.error ? ` · 오류 ${r.error}` : ""} · 템플릿 추천 ${r.template.templateId}(${r.template.why})`);
  console.log(r.brief_text); console.log("styleGuide", JSON.stringify(r.styleGuide, null, 1));
  fs.writeFileSync(path.join(here, "fixture", "brief-v3-real-sample.json"), JSON.stringify({ dir, brief: r.brief, styleGuide: r.styleGuide, brief_text: r.brief_text, template: r.template, how: r.how, costUsd: r.costUsd, elapsedMs: r.elapsedMs, fixes: r.fixes, error: r.error || null, raw: r.raw, createdAt: new Date().toISOString() }, null, 2) + "\n");
  fs.writeFileSync(path.join(here, "fixture", "brief-v3-real-sample.txt"), r.brief_text + "\n");
  const ok = r.how === "cli";
  console.log(ok ? "OK 기획서 v3 하네스" : "FAIL 기획서 v3 하네스"); if (!ok) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--v3")) await runV3();
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rulesOnly = process.argv.includes("--rules");
  const input = realCopyInput();
  const bi = briefInputFrom(input);
  if (!bi.title_ko || /[一-鿿]/.test(bi.title_ko)) bi.title_ko = "벽걸이 접이식 빨래 건조대 (알루미늄 합금)"; // 실제 작업의 제목 번역이 회사명이라 보정
  console.log(`▶ 기획안 하네스 · 속성 ${bi.attrs_ko.length} · OCR ${bi.ocr_ko.length}줄 · ${bi.title_ko}`);
  const t0 = Date.now();
  const r = await writeBrief(bi, { log: (c, t) => console.log(`[${c}] ${t}`), useCli: !rulesOnly });
  console.log(`■ 경로 ${r.how}${r.tried ? ` (시도: ${r.tried})` : ""} · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 비용 ${r.costUsd != null ? `$${Number(r.costUsd).toFixed(4)}` : "-"}${r.error ? ` · 오류: ${r.error}` : ""}`);
  console.log(JSON.stringify(r.brief, null, 2));
  const v = validateBrief(r.brief);
  const stem = rulesOnly ? "brief-real-sample.rules" : "brief-real-sample";
  fs.writeFileSync(path.join(here, "fixture", `${stem}.json`), JSON.stringify(r.brief, null, 2) + "\n");
  fs.writeFileSync(path.join(here, "fixture", `${stem}.meta.json`), JSON.stringify({ how: r.how, model: r.model || null, costUsd: r.costUsd ?? null, usage: r.usage || null, elapsedMs: r.elapsedMs, error: r.error || null, fixes: r.fixes || [], raw: r.raw || null, input: bi, createdAt: new Date().toISOString() }, null, 2) + "\n");
  const ok = v.ok && (rulesOnly || r.how === "cli");
  console.log(ok ? "OK 기획안 하네스" : `FAIL 기획안 하네스 ${v.errors.join("; ")}`);
  if (!ok) process.exitCode = 1;
}
