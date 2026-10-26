// 원본 한글화 앱 내 검수 하네스 — 실제 작업 폴더를 임시로 복제(원본은 읽기만)해 지금 템플릿으로 다시 그린 뒤 앱과 같은 runLocQa(검수 → 고치기 → 다시 그리기)를 돌린다.
// 실행: npx electron test/detail/loc-qa-harness.js "<작업 폴더>" "<출력 폴더>" [--plan=plan-localize.json] [--no-ai] [--inject] [--max-ms=180000] [--max-usd=0.3]
//   --inject: 일부러 결함을 넣는다 — ① 원 안 글을 원 밖으로(화면) ② 글 두 줄 겹치기(화면) ③ 같은 역할 줄 하나만 1.6배(plan) → 잡히고 고쳐지는지
// 결과: <출력>/summary.json · flagged-<id>.jpg(남은 ⚠ 장 캡처) · 콘솔 표 · 마지막 줄 LOC_QA_OK
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const opt = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const has = (k) => process.argv.includes(`--${k}`);
const BASE = path.join(os.tmpdir(), "seedhack-locqa"); app.setPath("userData", opt("udata") || BASE);
app.on("window-all-closed", () => {});
const [JOB, OUT] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/electron|loc-qa-harness\.js$/.test(a));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const log = (_l, t) => console.log(t);

app.whenReady().then(async () => {
  try {
    if (!JOB || !OUT) throw new Error("작업 폴더·출력 폴더가 필요합니다");
    fs.mkdirSync(OUT, { recursive: true });
    const tmp = path.join(BASE, "detail", path.basename(JOB) + "-qa");
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(path.dirname(tmp), { recursive: true });
    execFileSync("cp", ["-Rc", JOB, tmp]); // APFS 복제 — 원본 폴더는 건드리지 않는다
    const planFile = opt("plan") || (fs.existsSync(path.join(tmp, "plan-localize.json")) ? "plan-localize.json" : "plan.json");
    const plan = readJson(path.join(tmp, planFile)); if (!plan?.sections) throw new Error(`${planFile} 없음`);
    const src = readJson(path.join(tmp, "source.json")) || {};
    const rawOf = (id) => { const im = (src.images || []).find((x) => x.id === id); const f = im && path.join(tmp, "raw", path.basename(im.file || "")); return f && fs.existsSync(f) ? f : null; };
    const { renderPlan } = await import("../../src/main/detail/render.js");
    const { runLocQa } = await import("../../src/main/detail/loc-qa.js");
    const cli = has("no-ai") ? null : await import("../../src/main/detail/cli.js");
    const RID = "localize-qa";
    // index.js 와 같은 무대(.render-qa → out/<RID>) 렌더
    const stageOf = () => { const st = path.join(tmp, ".render-qa"); fs.mkdirSync(st, { recursive: true }); for (const sub of fs.readdirSync(tmp).filter((n) => !/^(out|\.render)/.test(n) && fs.statSync(path.join(tmp, n)).isDirectory())) { /* plan 이 가리키는 그림 폴더 전부(localize-*-v12 같은 재생 폴더 포함) */ const s = path.join(tmp, sub), d = path.join(st, sub); if (fs.existsSync(s) && !fs.existsSync(d)) fs.symlinkSync(s, d, "dir"); } fs.rmSync(path.join(st, "out"), { recursive: true, force: true }); return st; };
    const render = async (p) => { const st = stageOf(); const o = await renderPlan({ plan: p, jobDir: st, templateId: "localize" }); const to = path.join(tmp, "out", RID); fs.rmSync(to, { recursive: true, force: true }); fs.renameSync(path.join(st, "out"), to); return { ...o, slices: o.slices.map((s) => ({ ...s, file: s.file.replace(/^out\//, `out/${RID}/`) })) }; };

    // ── 결함 넣기(plan): 같은 역할·같은 높이 두 줄 중 하나를 1.6배 ──
    const injected = [];
    if (has("inject")) {
      for (const s of plan.sections.filter((x) => x.type === "image")) {
        const ls = (s.layers || []).filter((l) => !l.drop && !l.shape && String(l.ko || "").trim() && !Number(l.style?.rotate));
        const pair = ls.flatMap((a) => ls.filter((b) => b !== a && b.role === a.role && Math.abs(a.h - b.h) <= Math.max(a.h, b.h) * 0.08).map((b) => [a, b]))[0];
        if (!pair) continue;
        const l = pair[1], sz = Number(l.style?.size ?? l.style?.fontSizePx) || l.h * 0.78; l.style = { ...(l.style || {}), size: Math.round(sz * 1.6) };
        injected.push({ id: s.id, kind: "roleDev", what: `"${l.ko}" 1.6배` }); break;
      }
    }
    const t0 = Date.now();
    await render(plan);
    const renderMs = Date.now() - t0;
    console.log(`처음 렌더 ${(renderMs / 1000).toFixed(1)}초 · ${planFile}`);
    // ── 결함 넣기(화면 page.html): 원 안 글을 원 밖으로 · 글 두 줄 겹치기 ──
    if (has("inject")) {
      const hf = path.join(tmp, "out", RID, "page.html"); let html = fs.readFileSync(hf, "utf8");
      // jsdom 없이: 숨은 창에서 DOM 을 고쳐 다시 저장
      const { BrowserWindow } = await import("electron");
      const w = new BrowserWindow({ show: false, width: 780, height: 1200, webPreferences: { offscreen: true, webSecurity: false } });
      const tmpH = path.join(os.tmpdir(), `inject-${Date.now()}.html`); fs.writeFileSync(tmpH, html.replace(/<head>/i, `<head><base href="file://${path.join(tmp, "out")}/">`));
      await w.loadFile(tmpH);
      const r = await w.webContents.executeJavaScript(`(() => { const out = [];
        const sh = [...document.querySelectorAll(".loc-layer[data-shape]")].find((e) => e.style.display !== "none");
        if (sh) { sh.style.left = (parseFloat(sh.style.left) + 260) + "px"; out.push({ src: sh.closest(".loc-wrap").querySelector("img").dataset.src, kind: "overflow", what: "원 안 글 → 원 밖(+260px) " + sh.textContent.trim().slice(0, 12) }); }
        for (const wr of document.querySelectorAll(".loc-wrap")) { if (sh && wr.contains(sh)) continue; const ls = [...wr.querySelectorAll(":scope > .loc-layer")].filter((e) => e.style.display !== "none" && !e.dataset.shape); if (ls.length < 2) continue; ls[1].style.top = ls[0].style.top; ls[1].style.left = ls[0].style.left; out.push({ src: wr.querySelector("img").dataset.src, kind: "overlap", what: "두 줄 겹침 " + ls[0].textContent.trim().slice(0, 10) + " / " + ls[1].textContent.trim().slice(0, 10) }); break; }
        return { out, body: document.getElementById("page").outerHTML }; })()`);
      w.destroy(); fs.rmSync(tmpH, { force: true });
      html = html.replace(/<main id="page"[\s\S]*<\/main>/i, () => r.body);
      fs.writeFileSync(hf, html);
      for (const x of r.out) injected.push({ id: plan.sections.find((s) => s.image === x.src)?.id, kind: x.kind, what: x.what });
      console.log("넣은 결함:", injected.map((x) => `${x.id} ${x.kind} ${x.what}`).join(" / "));
    }
    // ── 앱과 같은 검수·수정 ──
    const tl = readJson(path.join(tmp, "localize.json")) || {}, ocr = readJson(path.join(tmp, "ocr.json")) || {};
    const msgs = [];
    const q = await runLocQa({ dir: tmp, renderId: RID, plan, tl, ocr, rawOf, cli, ai: !has("no-ai"), keepShots: true, log, progress: (m) => { if (msgs.at(-1) !== m) { msgs.push(m); console.log(`  [${((Date.now() - t0 - renderMs) / 1000).toFixed(0)}s] ${m}`); } },
      limits: { ...(opt("max-ms") ? { maxMs: Number(opt("max-ms")) } : {}), ...(opt("max-usd") ? { maxUsd: Number(opt("max-usd")) } : {}) }, render });
    // 남은 ⚠ 장 캡처
    const shotDir = path.join(tmp, "out", RID, ".qa");
    for (const [id, s] of Object.entries(q.sections)) if (!s.pass && fs.existsSync(path.join(shotDir, `${id}.jpg`))) fs.copyFileSync(path.join(shotDir, `${id}.jpg`), path.join(OUT, `flagged-${id}.jpg`));
    const kinds = (obj) => Object.values(obj).flat().reduce((m, w) => { const k = String(w).split(/[ "]/)[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
    const firstN = Object.values(q.first).filter((v) => v.length).length;
    const summary = { job: JOB, tmp, planFile, ai: !has("no-ai"), renderMs, qa: { ms: q.ms, costUsd: q.costUsd, aiCalls: q.aiCalls, limitHit: q.limitHit, rerendered: !!q.rendered }, before: { flagged: firstN, kinds: kinds(Object.fromEntries(Object.entries(q.first).map(([k, v]) => [k, v.map((w) => w.replace(/^(.+?)(\s|$).*/, "$1"))]))), list: q.first }, after: { ...q.summary, list: Object.fromEntries(Object.entries(q.sections).filter(([, s]) => !s.pass).map(([id, s]) => [id, s.issues.map((x) => x.why)])) }, fixedIds: Object.entries(q.sections).filter(([, s]) => s.fixed).map(([id]) => id), injected: injected.map((x) => ({ ...x, after: q.sections[x.id] ? { pass: q.sections[x.id].pass, fixed: q.sections[x.id].fixed, first: q.first[x.id] } : null })), steps: q.steps };
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
    console.log(`\n검수 ${q.summary.checked}장 · 처음 걸림 ${firstN}장 → 고침 ${q.summary.fixed}장 · 남은 확인 필요 ${q.summary.flagged}장 · ${(q.ms / 1000).toFixed(0)}초 · $${q.costUsd} (AI ${q.aiCalls}회)${q.limitHit ? ` · 상한(${q.limitHit})` : ""}`);
    for (const [id, v] of Object.entries(q.first)) if (v.length) console.log(`  ${q.sections[id]?.pass ? (q.sections[id].fixed ? "✔ 고침" : "✔ 통과") : "⚠ 남음"} ${id}: ${v.join(" / ")}${!q.sections[id]?.pass ? `  → 지금: ${q.sections[id].issues.map((x) => x.why).join(" / ")}` : ""}`);
    for (const x of summary.injected) console.log(`  넣은 결함 ${x.id} ${x.kind}: 잡힘 ${x.after?.first?.length ? "예" : "아니오"} · ${x.after?.pass ? "고쳐짐" : "남음"}`);
    console.log("고친 내용:", q.steps.slice(0, 20).join(" | "));
    console.log(`결과 → ${OUT}\n임시 → ${tmp}`);
    console.log("LOC_QA_OK"); app.exit(0);
  } catch (e) { console.error("LOC_QA_FAIL", e?.stack || e); app.exit(1); }
});
