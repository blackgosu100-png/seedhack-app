// v5 섹션 카드 카피 하네스 — 실제 작업 폴더로 Claude CLI 1회 호출(시간·비용 기록)
//   node test/detail/copy-v5-harness.js [jobDir] [--brief <기획서 txt>] [--rules] [--out <결과 json>]
//   기획서: 폴더의 brief.json(v3 keyContent)이 있으면 그것, 없으면 --brief 글(기본: 같은 상품 Moast 원문 test/detail/fixture/moast-keycontent-sample.txt)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCopyInput, writeCopyV5, lintCopy, validateCopy } from "../../src/main/detail/copy.js";
import { COPY_V5_SCHEMA } from "../../src/main/detail/copy-prompt.js";
import { parseBriefText, isBriefV3Like } from "../../src/main/detail/brief.js";
import { planSectionsV5, buildPlanV5 } from "../../src/main/detail/plan-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv.slice(2).find((a) => !a.startsWith("--") && fs.existsSync(path.join(a, "source.json"))) || path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail", "20261009-132404-841080065939");
const bi = process.argv.indexOf("--brief");
const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return d; } };
const source = rd("source.json"), ocr = rd("ocr.json", { images: [] }), cleaned = rd("clean.json", []), tr = rd("translate.json", {}), vision = rd("vision.json"), scene = rd("scene.json"), sg = rd("style.json");
for (const o of ocr.images || []) for (const b of o.boxes || []) if (b.text_ko && !tr[b.text]) tr[b.text] = b.text_ko;
const input = buildCopyInput({ source, ocr, cleaned, ko: tr, keyword: source.keyword || "", vision });
const saved = rd("brief.json");
const brief = saved && isBriefV3Like(saved) ? (saved.keyContent || saved) : parseBriefText(fs.readFileSync(bi > 0 ? process.argv[bi + 1] : path.join(here, "fixture", "moast-keycontent-sample.txt"), "utf8"));
const sections = planSectionsV5({ brief, styleGuide: sg, vision, options: input.options });
console.log(`▶ v5 카피 하네스 · ${dir}\n  기획서 ${saved && isBriefV3Like(saved) ? "폴더 brief.json" : "Moast 원문(같은 상품)"} · 섹션 ${sections.length}개 [${sections.map((s) => s.type).join(" ")}]`);
const r = await writeCopyV5(input, { brief, sections, useCli: !process.argv.includes("--rules"), log: (c, t) => console.log(`[${c}] ${t}`) });
const plan = buildPlanV5({ sections, copy: r.copy, scenes: scene, vision, cleaned, source, jobId: path.basename(dir) });
const v = validateCopy(Object.fromEntries(Object.entries(r.copy).filter(([k]) => !["sections", "chain"].includes(k))), COPY_V5_SCHEMA), lint = lintCopy(r.copy);
console.log(`■ 경로 ${r.how} · ${(r.elapsedMs / 1000).toFixed(1)}초 · 비용 ${r.costUsd != null ? `$${Number(r.costUsd).toFixed(4)}` : "-"}${r.error ? ` · 오류 ${r.error}` : ""} · 스키마 ${v.ok ? "통과" : v.errors.join("; ")} · 금지어 ${lint.issues.length} · 정화 ${r.fixes.length}${r.fixes.length ? "\n  - " + r.fixes.join("\n  - ") : ""}`);
console.log(`  plan: ${plan.sections.map((s) => `${s.type}${s.textOnly ? "(글만)" : s.from ? `(${s.from})` : ""}`).join(" ")}`);
const c = r.copy;
console.log(`  hero: [${c.hero.label}] ${c.hero.category} / ${c.hero.name} / ${c.hero.sub} / 아이콘 ${c.hero.icons.map((i) => i.label).join("·")}`);
console.log(`  before_after: ${c.before_after.sub} / ${c.before_after.title.replace("\n", " ⏎ ")}`);
console.log(`  checkpoint: ${c.checkpoint.title} / ${c.checkpoint.callouts.map((x) => `${x.thin}⏎${x.bold}`).join(" | ")}`);
c.features.forEach((f, i) => console.log(`  feature${i + 1}: ${f.title.replace("\n", " ⏎ ")} — ${f.desc.replace("\n", " ⏎ ")}`));
console.log(`  options: ${c.options.title.replace("\n", " ⏎ ")}`);
console.log(`  detail: ${c.detail.title} / ${c.detail.items.map((x) => `${x.title}: ${x.desc.replace("\n", " ⏎ ")}`).join(" | ")}`);
console.log(`  versatility: ${c.versatility.title.replace("\n", " ⏎ ")} / ${c.versatility.sub} / ${c.versatility.items.map((x) => x.label).join("·")}`);
console.log(`  notice: ${c.notice.title} / ${c.notice.items.join(" | ")}`);
console.log(`  징검다리 ${r.chain.score} (받는 말 ${r.chain.linked}/${r.chain.pairs} · 느슨 ${r.chain.loose} · 끊김 ${r.chain.breaks.join(", ") || "없음"})\n    ${r.chain.line}\n    ${r.chain.links.map((p) => `${p.to}:${p.where}${p.word ? `(${p.word})` : ""}`).join(" ")}${r.raw?.chain_check ? `\n    AI 초안: ${r.raw.chain_check}` : ""}`);
console.log(`  faq: ${c.faq.map((f) => `Q ${f.q} A ${f.a}`).join(" | ")}`);
const oi = process.argv.indexOf("--out");
fs.writeFileSync(oi > 0 ? process.argv[oi + 1] : path.join(here, "fixture", process.argv.includes("--rules") ? "copy-v5-real-sample.rules.json" : "copy-v5-real-sample.json"), JSON.stringify({ dir, brief, sections, copy: r.copy, plan, how: r.how, costUsd: r.costUsd, elapsedMs: r.elapsedMs, fixes: r.fixes, raw: r.raw, chain: r.chain, createdAt: new Date().toISOString() }, null, 2) + "\n");
const ok = v.ok && lint.ok && (process.argv.includes("--rules") || r.how === "cli");
console.log(ok ? "OK v5 카피 하네스" : "FAIL v5 카피 하네스"); if (!ok) process.exitCode = 1;
