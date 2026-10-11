// ♻️ 작업 폴더 재정화·재구성 — AI 재호출 없이 copy.json 을 현재 규칙(sanitizeCopy/V2)으로 다시 정화하고 plan.json 을 다시 짠다.
//   node test/detail/copy-resanitize.js <jobDir> [--dry]
//   읽는 것: source.json ocr.json clean.json translate.json copy.json (+ brief.json vision.json scene.json 있으면) / plan.json(templateId·jobId 유지)
//   쓰는 것: copy.json plan.json (원본은 copy.prev.json plan.prev.json 으로 한 번만 보관). --dry 면 쓰지 않고 요약만.
import fs from "node:fs";
import path from "node:path";
import { buildCopyInput, sanitizeCopy, sanitizeCopyV2, isV2, lintCopy, validateCopy } from "../../src/main/detail/copy.js";
import { COPY_SCHEMA_V2, COPY_SCHEMA } from "../../src/main/detail/copy-prompt.js";
import { buildPlan, photoKey } from "../../src/main/detail/plan-core.js";

export function resanitizeJob(dir, { write = true, log = console.log } = {}) {
  const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return d; } };
  const source = rd("source.json"), ocr = rd("ocr.json", { images: [] }), cleaned = rd("clean.json", []), tr = rd("translate.json", {}), copy0 = rd("copy.json"), plan0 = rd("plan.json", {});
  if (!source || !copy0) throw new Error("source.json·copy.json 이 필요합니다");
  const brief = rd("brief.json"), vision = rd("vision.json"), scene = rd("scene.json");
  for (const o of ocr.images || []) for (const b of o.boxes || []) if (b.text_ko && !tr[b.text]) tr[b.text] = b.text_ko;
  const input = buildCopyInput({ source, ocr, cleaned, ko: tr, keyword: source.keyword || "", coupangName: source.coupangName || "", category: source.category || "", vision });
  if (source.title_ko) input.title_ko = source.title_ko;
  const v2 = isV2(copy0);
  const { copy, fixes } = v2 ? sanitizeCopyV2(copy0, input, brief?.brief || brief) : sanitizeCopy(copy0, input);
  const plan = buildPlan({ source, ocr, cleaned, copy, copyInput: input, vision, scenes: scene, templateId: plan0?.meta?.templateId, jobId: plan0?.meta?.jobId || path.basename(dir) });
  const imgs = plan.sections.flatMap((s) => [s.image, s.cutout, ...(s.images || []), ...(s.items || []).map((i) => i?.image)]).filter(Boolean).map((p) => { const k = photoKey(p); return k.id + (k.piece ? `_${k.piece}` : ""); });
  const summary = { v2, fixes: fixes.length, valid: validateCopy(copy, v2 ? COPY_SCHEMA_V2 : COPY_SCHEMA).ok, lint: lintCopy(copy).ok, sections: plan.sections.map((s) => s.type), duplicatePhotos: imgs.length - new Set(imgs).size, dropped: plan.dropped.length, scenes: plan.sections.filter((s) => s.scene).length };
  if (write) {
    if (!fs.existsSync(path.join(dir, "copy.prev.json"))) fs.copyFileSync(path.join(dir, "copy.json"), path.join(dir, "copy.prev.json"));
    if (fs.existsSync(path.join(dir, "plan.json")) && !fs.existsSync(path.join(dir, "plan.prev.json"))) fs.copyFileSync(path.join(dir, "plan.json"), path.join(dir, "plan.prev.json"));
    fs.writeFileSync(path.join(dir, "copy.json"), JSON.stringify(copy, null, 2));
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  }
  log(`♻️ 재정화 ${dir}\n  ${JSON.stringify(summary)}${fixes.length ? "\n  - " + fixes.slice(0, 20).join("\n  - ") : ""}`);
  return { copy, plan, fixes, summary };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])) && !process.argv.includes("--v5") && !process.argv.includes("--localize")) {
  const dir = process.argv[2];
  if (!dir) { console.log("사용법: node test/detail/copy-resanitize.js <jobDir> [--dry]"); process.exit(1); }
  const r = resanitizeJob(path.resolve(dir), { write: !process.argv.includes("--dry") });
  const ok = r.summary.valid && r.summary.lint && r.summary.duplicatePhotos === 0;
  console.log(ok ? "OK 재정화" : "FAIL 재정화"); if (!ok) process.exitCode = 1;
}

// v5(섹션 카드) 폴더 재구성 — AI 장면 재생성 없이: 섹션 목록 다시(이전 id 유지) → 카피 재정화 → (선택) 체크포인트 장면 지시선 좌표 비전 1회 → plan
//   node test/detail/copy-resanitize.js <jobDir> --v5 [--locate] [--dry]
export async function resanitizeJobV5(dir, { write = true, locate = false, log = console.log } = {}) {
  const { planSectionsV5, buildPlanV5 } = await import("../../src/main/detail/plan-core.js");
  const { sanitizeCopyV5, attachV5 } = await import("../../src/main/detail/copy.js");
  const { recommendTemplate } = await import("../../src/main/detail/brief.js");
  const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return d; } };
  const source = rd("source.json"), ocr = rd("ocr.json", { images: [] }), cleaned = rd("clean.json", []), tr = rd("translate.json", {}), copy0 = rd("copy.json"), plan0 = rd("plan.json", {});
  const brief = rd("brief.json") || {}, vision = rd("vision.json"), scene = rd("scene.json"), style = rd("style.json"), prev = rd("sections.json");
  for (const o of ocr.images || []) for (const b of o.boxes || []) if (b.text_ko && !tr[b.text]) tr[b.text] = b.text_ko;
  const input = buildCopyInput({ source, ocr, cleaned, ko: tr, keyword: source.keyword || "", vision });
  const kc = brief.keyContent || brief;
  const texts = (input.images || []).flatMap((im) => im.texts_ko || []);
  const sections = planSectionsV5({ brief: kc, styleGuide: style?.styleGuide || style, vision, options: input.options, texts, prev, productPalette: rd("cutout.json")?.palette || null });
  const { copy: c5, fixes } = sanitizeCopyV5(copy0, input, kc, sections);
  const copy = attachV5(c5, sections);
  let calloutPoints = null, locateInfo = null;
  const cp = sections.find((s) => s.type === "checkpoint");
  const cpScene = (scene?.items || []).filter((x) => (x.section || x.sectionId) === cp?.id && x.pass !== false && x.human !== "reject" && x.file).sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  if (locate && cpScene && !cpScene.callout_points) {
    const { locateCallouts } = await import("../../src/main/detail/vision.js");
    const labels = (copy.sections[cp.id]?.callouts || []).map((x) => x.bold || x.label);
    const r = await locateCallouts({ file: path.join(dir, cpScene.file), labels, product: { title_ko: kc.product_name_ko }, log });
    locateInfo = { ok: r.ok, n: r.points?.length || 0, costUsd: r.costUsd ?? null, elapsedMs: r.elapsedMs, error: r.error || null };
    if (r.ok) { calloutPoints = { [cp.id]: r.points }; cpScene.callout_points = r.points; }
  }
  const tpl = recommendTemplate({ brief: kc, styleGuide: style?.styleGuide || style, v5: true });
  // A2 누끼 bbox(px) → 0~1 제품 영역(지시선 검사용)
  const productBoxes = {}; const cut = rd("cutout.json");
  for (const it of cut?.items || []) { const im = (source.images || []).find((x) => x.id === it.id); const W = im?.w || it.w, H = im?.h || it.h; if (it.bbox && W && H) productBoxes[it.id] = { x: it.bbox.x / W, y: it.bbox.y / H, w: it.bbox.w / W, h: it.bbox.h / H }; }
  const plan = buildPlanV5({ sections, copy, scenes: scene, vision, cleaned, source, jobId: plan0?.meta?.jobId || path.basename(dir), templateId: tpl.templateId, calloutPoints, productBoxes });
  plan.meta = { ...(plan0.meta || {}), ...plan.meta, templateWhy: tpl.why };
  const summary = { sections: plan.sections.map((s) => `${s.type}${s.textOnly ? "(글만)" : s.from ? `(${s.from})` : ""}`), callouts: plan.sections.find((s) => s.type === "checkpoint")?.callouts?.length || 0, options: plan.sections.find((s) => s.type === "options")?.rows?.map((r) => r.name) || [], template: tpl, fixes: fixes.length, locate: locateInfo };
  if (write) {
    for (const f of ["copy.json", "plan.json", "sections.json", "scene.json"]) if (fs.existsSync(path.join(dir, f)) && !fs.existsSync(path.join(dir, f.replace(".json", ".prev.json")))) fs.copyFileSync(path.join(dir, f), path.join(dir, f.replace(".json", ".prev.json")));
    fs.writeFileSync(path.join(dir, "copy.json"), JSON.stringify(copy, null, 2));
    fs.writeFileSync(path.join(dir, "sections.json"), JSON.stringify(prev?.sections ? { ...prev, sections } : sections, null, 2));
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
    if (scene && calloutPoints) fs.writeFileSync(path.join(dir, "scene.json"), JSON.stringify(scene, null, 2)); // 좌표를 장면 검수 결과에 남겨 다음 재구성 때 다시 묻지 않는다
  }
  log(`♻️ v5 재구성 ${dir}\n  ${JSON.stringify(summary)}${fixes.length ? "\n  - " + fixes.join("\n  - ") : ""}`);
  return { plan, copy, sections, summary };
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])) && process.argv.includes("--v5")) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const r = await resanitizeJobV5(path.resolve(dir), { write: !process.argv.includes("--dry"), locate: process.argv.includes("--locate") });
  console.log(r.summary.sections.length ? "OK v5 재구성" : "FAIL v5 재구성");
}

// v6 한글화 결과 재정화 — AI 재호출 없이 localize.json(번역) 정화 → plan-localize.json 다시 구성
//   node test/detail/copy-resanitize.js <jobDir> --localize [--dry]
export async function resanitizeLocalizeJob(dir, { write = true, log = console.log } = {}) {
  const { resanitizeLocalized } = await import("../../src/main/detail/copy.js");
  const { buildLocalizePlan } = await import("../../src/main/detail/plan-core.js");
  const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return d; } };
  const source = rd("source.json"), loc = rd("localize.prev.json") || rd("localize.json"), brief = rd("brief.json"), copy = rd("copy.json"), cleaned = rd("clean.json", []), vision = rd("vision.json"), plan0 = rd("plan-localize.json", {});
  if (!loc) throw new Error("localize.json 이 없습니다");
  const attrs = (source.attrs || []).map((a) => ({ ...a }));
  const r = resanitizeLocalized(loc, { brief: brief?.keyContent || brief, attrs }); // 원본(localize.prev.json, 없으면 localize.json)에서 다시 — 여러 번 돌려도 같은 결과
  const plan = buildLocalizePlan({ source, localized: r, copy, brief: brief?.keyContent || brief, cleaned, files: loc.files || null, vision, jobId: plan0?.meta?.jobId || path.basename(dir), options: source.options || [] });
  if (write) {
    for (const f of ["localize.json", "plan-localize.json"]) if (fs.existsSync(path.join(dir, f)) && !fs.existsSync(path.join(dir, f.replace(".json", ".prev.json")))) fs.copyFileSync(path.join(dir, f), path.join(dir, f.replace(".json", ".prev.json")));
    const { fixes, ...keep } = r;
    fs.writeFileSync(path.join(dir, "localize.json"), JSON.stringify({ ...keep, fixes: [...(loc.fixes || []), ...fixes] }, null, 2));
    fs.writeFileSync(path.join(dir, "plan-localize.json"), JSON.stringify(plan, null, 2));
  }
  log(`♻️ 한글화 재정화 ${dir}\n  바뀐 레이어 ${r.fixes.length}개${r.fixes.length ? "\n  - " + r.fixes.join("\n  - ") : ""}\n  섹션 ${plan.sections.length} · 제외 ${plan.excluded.length} · 내부 메모 ${plan.internalNotes.length}${plan.internalNotes.length ? "\n  ! " + plan.internalNotes.join("\n  ! ") : ""}`);
  return { plan, localized: r };
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])) && process.argv.includes("--localize")) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
  await resanitizeLocalizeJob(path.resolve(dir), { write: !process.argv.includes("--dry") });
  console.log("OK 한글화 재정화");
}
