// 테마 재생 하네스 — 실제 작업 폴더의 plan.json 을 임시 폴더로 복사해 지정 테마로 다시 그린다(원본 폴더는 건드리지 않음)
// 실행: npx electron test/detail/theme-replay.js "<작업 폴더>" <출력 폴더> branden [commerce …]
//   → <출력 폴더>/<테마>/01.jpg … + preview.png · 마지막 줄 "REPLAY_OK" (점검 문제는 목록으로)
//   --ref=<reference.json> : 레퍼런스 손잡이(tokens)를 plan.meta.refTokens 로 넣는다(custom 테마용) · --plan=<plan.json> : 작업 폴더 사진 + 다른 plan(레퍼런스 흐름 결과)
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { renderPlan } from "../../src/main/detail/render.js";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-theme-replay"));
const [jobSrc, outRoot, ...themes] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/electron|theme-replay\.js$/.test(a));
const opt = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3) || null;
const REF = opt("ref"), PLAN = opt("plan");

app.whenReady().then(async () => {
  try {
    const isPlan = /\.json$/i.test(jobSrc || ""); // fixture plan 파일이면 빈 작업 폴더 + fixture/img-plan 사진(clean/)
    if (!jobSrc || !fs.existsSync(isPlan ? jobSrc : path.join(jobSrc, "plan.json"))) throw new Error("작업 폴더(plan.json) 를 찾지 못했습니다: " + jobSrc);
    const jobDir = path.join(app.getPath("userData"), "detail", path.basename(jobSrc, ".json"));
    fs.rmSync(jobDir, { recursive: true, force: true });
    if (isPlan) { fs.mkdirSync(path.join(jobDir, "clean"), { recursive: true }); const IMG = path.join(path.dirname(new URL(import.meta.url).pathname), "fixture", "img-plan"); for (const f of fs.readdirSync(IMG)) fs.copyFileSync(path.join(IMG, f), path.join(jobDir, "clean", f)); }
    // out·백업 폴더는 빼고 복사(용량 절약)
    else fs.cpSync(jobSrc, jobDir, { recursive: true, filter: (p) => { const rel = path.relative(jobSrc, p); return !(rel === "out" || rel.startsWith("out" + path.sep) || /\.bak-/.test(rel)); } });
    const plan = JSON.parse(fs.readFileSync(PLAN || (isPlan ? jobSrc : path.join(jobDir, "plan.json")), "utf8"));
    if (REF) { const ref = JSON.parse(fs.readFileSync(REF, "utf8")); plan.meta = { ...(plan.meta || {}), refTokens: ref.tokens || ref }; }
    if (isPlan) plan.meta = { ...(plan.meta || {}), version: 5 }; // card 엔진(v5)으로
    for (const th of themes.length ? themes : ["branden"]) {
      const t0 = Date.now();
      const r = await renderPlan({ plan: { ...plan, meta: { ...(plan.meta || {}), theme: th } }, jobDir, templateId: th, log: () => {} });
      const dest = path.join(outRoot, th);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.join(jobDir, "out"), dest, { recursive: true });
      console.log(`[${th}] ${Date.now() - t0}ms · 엔진 ${r.template}/${r.theme} · 슬라이스 ${r.slices.length}장 · 전체 ${r.totalHeight}px · 섹션 ${r.sections.map((s) => `${s.type}:${s.h}`).join(" ")}`);
      console.log(`[${th}] 점검: 본문 최소 ${r.check.minBody}px · 헤드라인 ${r.check.minHead}px · 캡션 ${r.check.minCap}px · 최소 대비 ${r.check.minContrast}:1 · 문제 ${r.check.issues.length}개 · 콘솔 오류 ${r.consoleErrors.length}개`);
      for (const i of [...r.check.issues, ...r.consoleErrors]) console.log("    ! " + i);
    }
    console.log("REPLAY_OK");
    app.exit(0);
  } catch (e) { console.error("REPLAY_FAIL", e?.stack || e); app.exit(1); }
});
