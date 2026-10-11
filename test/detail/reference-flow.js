// 벤치마킹 흐름 하네스(실제 파이프라인) — 실제 작업 폴더를 임시 userData 로 복사(원본 안 건드림) → initDetail(가짜 ipc) → detail:reference
//   npx electron test/detail/reference-flow.js "<작업 폴더>" "<reference.json 또는 레퍼런스 이미지 폴더>" <출력 폴더>
//   → 섹션 순서(레퍼런스 레시피와 비교)·키커·제목 징검다리·표절 가드·근거 주장·숫자 근거·단계별 시간/비용 출력 + <출력>/슬라이스·plan.json·copy.json·report.json · 마지막 줄 FLOW_OK
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [jobSrc, refSrc, outDir] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/electron|reference-flow\.js$/.test(a));
const USER = path.join(os.tmpdir(), "seedhack-reference-flow");
fs.rmSync(USER, { recursive: true, force: true }); fs.mkdirSync(USER, { recursive: true });
app.setPath("userData", USER);
app.on("window-all-closed", () => {});
const handlers = {}, events = [];
const ipc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } };
const store = (() => { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; })();
const logs = [];
const log = (cls, text) => { logs.push(`[${cls}] ${text}`); if (/🧷|🧲|✍️|■|🪨|벤치마킹/.test(text)) console.log(`   ${text}`); };
const send = (ch, d) => { if (ch === "detail:progress") events.push(d); };
const rd = (d, f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); } catch { return null; } };

app.whenReady().then(async () => {
  try {
    const id = path.basename(jobSrc) + "-ref";
    const jobDir = path.join(USER, "detail", id);
    fs.cpSync(jobSrc, jobDir, { recursive: true, filter: (p) => { const rel = path.relative(jobSrc, p); return !(rel === "out" || rel.startsWith("out" + path.sep) || /\.bak-|\.prev/.test(rel)); } });
    const res0 = rd(jobDir, "result.json") || {}; res0.renders = []; fs.writeFileSync(path.join(jobDir, "result.json"), JSON.stringify(res0));
    const { initDetail } = await import(pathToFileURL(path.join(here, "../../src/main/detail/index.js")).href);
    initDetail({ ipcMain: ipc, app, getWin: () => null, store, log, translate: async (t) => t, getCnSession: () => null, getCnView: () => null, send, showDetail: () => {} });
    const t0 = Date.now();
    const r = await handlers["detail:reference"]({}, { jobId: id, reference: refSrc });
    if (r?.error) throw new Error(r.error);
    const end = await new Promise((res, rej) => { const tick = () => { const e = events.find((x) => x.jobId === id && (x.step === "done" || x.step === "fail")); if (e) return res(e); if (Date.now() - t0 > 900000) return rej(new Error("시간 초과")); setTimeout(tick, 200); }; tick(); });
    if (end.step === "fail") throw new Error("파이프라인 실패: " + (end.msg || JSON.stringify(end)));
    const ref = rd(path.join(jobDir, "reference"), "reference.json"), secs = rd(jobDir, "sections.json"), copy = rd(jobDir, "copy.json"), plan = rd(jobDir, "plan.json"), result = rd(jobDir, "result.json");
    const { refRecipe, guardSimilarity, CLAIM_RE } = await import(pathToFileURL(path.join(here, "../../src/main/detail/reference-core.js")).href);
    const recipe = refRecipe(ref).recipe.map((x) => x.type);
    console.log(`\n■ 레퍼런스 레시피(우리 종류로): ${recipe.join(" → ")}`);
    console.log(`■ 우리 섹션(sections.json):   ${secs.map((s) => s.type).join(" → ")}`);
    console.log(`■ 렌더 plan:                  ${plan.sections.map((s) => `${s.type}${s.kicker ? `[${s.kicker}]` : ""}`).join(" → ")}`);
    const ourOrder = secs.map((s) => s.type).filter((t) => recipe.includes(t)), recipeHave = recipe.filter((t) => ourOrder.includes(t));
    const orderOk = JSON.stringify([...new Set(ourOrder)]) === JSON.stringify([...new Set(recipeHave)]);
    console.log(`  순서 일치(재료 있는 섹션만): ${orderOk ? "예" : "아니오"}`);
    for (const s of secs) if (s.ref) console.log(`  - ${s.type.padEnd(12)} 각도: ${s.ref.angle}`);
    // 카피 글 모음 + 검사
    const flat = [];
    const walk = (o, p) => { if (typeof o === "string") flat.push({ p, t: o }); else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${p}[${i}]`)); else if (o && typeof o === "object") for (const k of Object.keys(o)) if (!["sections", "chain", "similarity", "emph", "name_emph", "title_lines", "chain_check"].includes(k)) walk(o[k], p ? `${p}.${k}` : k); };
    walk(copy, "");
    const claimHits = flat.filter((x) => CLAIM_RE.test(x.t));
    const avoidHits = flat.filter((x) => (ref.avoid || []).some((a) => a.length >= 3 && x.t.includes(a)));
    const evidence = [JSON.stringify(rd(jobDir, "brief.json") || {}), JSON.stringify(rd(jobDir, "ocr.json") || {}), JSON.stringify(rd(jobDir, "source.json") || {}), JSON.stringify(rd(jobDir, "translate.json") || {})].join(" ");
    const nums = flat.flatMap((x) => (x.t.match(/\d+(?:\.\d+)?\s*(?:cm|mm|kg|g|개|단|층|%|L|ml)/gi) || []).map((n) => ({ p: x.p, n })));
    const refNums = new Set((ref.ocr_lines || []).flatMap((l) => l.match(/\d+(?:\.\d+)?/g) || []));
    const numsOk = nums.filter((x) => { const d = x.n.match(/\d+(?:\.\d+)?/)[0]; return evidence.includes(d); });
    const sim = guardSimilarity(copy, ref.ocr_lines || [], {});
    console.log(`\n■ 카피 글 ${flat.length}개 · 숫자 ${nums.length}개 중 우리 입력 근거 있음 ${numsOk.length}개${nums.length - numsOk.length ? ` · 근거 없음: ${nums.filter((x) => !numsOk.includes(x)).map((x) => `${x.p}=${x.n}`).join(", ")}` : ""}`);
    console.log(`■ 근거 주장(완판·1위·인증…) ${claimHits.length}건${claimHits.length ? ": " + claimHits.map((x) => `${x.p}="${x.t}"`).join(" / ") : ""} · 레퍼런스 avoid 문구 ${avoidHits.length}건`);
    console.log(`■ 표절 가드(파이프라인 기록): ${JSON.stringify(copy.similarity ? { checked: copy.similarity.checked, flagged: copy.similarity.flagged.length, rewritten: copy.similarity.rewritten, fallback: copy.similarity.fallback, final: copy.similarity.final.length } : null)} · 최종 재검사 비슷한 줄 ${sim.flagged.length}`);
    for (const f of copy.similarity?.flagged || []) console.log(`    · ${f.path}: "${f.line}" ≈ "${f.ref}" (${f.score})`);
    for (const f of sim.flagged) console.log(`    · (재검사·사실 제외 없음) ${f.path}: "${f.line}" ≈ "${f.ref}" (${f.score}, 공통 "${f.common}")`);
    console.log(`■ 징검다리 ${copy.chain?.score} · ${copy.chain?.line}`);
    const c = copy;
    console.log(`  hero: ${c.hero?.label} / ${c.hero?.category} / ${c.hero?.name} / ${c.hero?.sub} / ${(c.hero?.icons || []).map((i) => i.label).join("·")}`);
    console.log(`  problem: ${c.problem?.sub} / ${c.problem?.question}`);
    console.log(`  before_after: ${c.before_after?.sub} / ${String(c.before_after?.title || "").replace("\n", " ⏎ ")}`);
    (c.features || []).forEach((f, i) => console.log(`  feature${i + 1}: ${String(f.title).replace("\n", " ⏎ ")} — ${String(f.desc).replace("\n", " ⏎ ")}`));
    console.log(`  detail: ${c.detail?.title} · versatility: ${String(c.versatility?.title || "").replace("\n", " ⏎ ")} / ${(c.versatility?.items || []).map((x) => x.label).join("·")}`);
    console.log(`  faq: ${(c.faq || []).map((f) => f.q).join(" | ")}`);
    // 시간·비용
    const steps = {}; for (const e of events.filter((x) => x.jobId === id)) steps[e.step] = e.msg;
    console.log(`\n■ 시간 ${((Date.now() - t0) / 1000).toFixed(1)}초 · 비용 ${JSON.stringify(result.costs || {})} · 합계 $${result.costUsd ?? "-"}`);
    const rr = (result.renders || []).slice(-1)[0];
    if (outDir && rr) { fs.rmSync(outDir, { recursive: true, force: true }); fs.cpSync(path.join(jobDir, rr.dir), outDir, { recursive: true }); for (const f of ["plan.json", "copy.json", "sections.json"]) fs.copyFileSync(path.join(jobDir, f), path.join(outDir, f)); fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ recipe, sections: secs.map((s) => ({ type: s.type, id: s.id, ref: s.ref || null })), dropped: secs.refDropped, plan: plan.sections.map((s) => ({ type: s.type, kicker: s.kicker })), orderOk, similarity: copy.similarity, claimHits, avoidHits, nums, numsOk: numsOk.length, chain: copy.chain, costs: result.costs, costUsd: result.costUsd, ms: Date.now() - t0, theme: rr.theme }, null, 2)); console.log(`  → ${outDir} (테마 ${rr.theme}, 슬라이스 ${rr.slices?.length})`); }
    fs.writeFileSync(path.join(outDir || USER, "flow.log"), logs.join("\n"));
    console.log("FLOW_OK"); app.exit(0);
  } catch (e) { console.error("FLOW_FAIL", e?.stack || e); fs.writeFileSync(path.join(USER, "flow.log"), logs.join("\n")); app.exit(1); }
});
