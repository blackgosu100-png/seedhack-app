// 원본 한글화 회귀 하네스(v13) — 고정 세트(fixture/localize-set.json: 처음 보는 상품 4 + 튜닝 대조군 3)를 localize-replay.js 로 다시 돌려 지표 표를 만들고, 기준(limits)을 넘으면 실패(종료 코드 1).
// 원본 작업 폴더는 읽기만 한다. 결과: <출력>/<key>/(슬라이스·비교 시트·summary.json) · <출력>/metrics.md · metrics.json
// 실행: node test/detail/localize-regress.js <출력 폴더> [--stage=full|reuse|render] [--only=coffee,glasses] [--prev=<지난 출력 폴더>] [--par=2] [--table-only]
//   full   : 처음부터(지우기 AI + 번역 Claude) — 7개 약 $3~4, 40분 안팎
//   reuse  : 지난 재생의 지운 그림 + 번역 응답 캐시(같은 요청이면 0원)로 번역 규칙·구성·렌더만 다시 — 규칙·템플릿을 고쳤을 때
//   render : plan 그대로 렌더·측정만(템플릿만 고쳤을 때)
//   --prev : 전/후 비교 시트(compare-NN.jpg)와 표의 "전" 열을 지난 출력 폴더 기준으로
//   --table-only : 돌리지 않고 <출력>/*/summary.json 으로 표·판정만
// 지표(페이지에 실제로 들어가는 장만): 글 겹침 · 도형 밖 넘침 · 같은 역할 크기 편차(%) · 열 정렬 편차(px) · 사각형 잔상(지운 상자 변에 원본에 없던 직선 경계) · 잔상 검사(참고 — 오탐 많음)
//   · 남은 한자(완성 슬라이스 중국어 OCR, 한국어 OCR 로 한글인 자리는 뺌) · 대비 부족 · 작은 글(<13px) · 빈 장식 · 직역 · 제외 이미지(사유)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const has = (k) => args.includes(`--${k}`);
const OUT = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(HERE, "out", "localize-regress"));
const SET = JSON.parse(fs.readFileSync(path.join(HERE, "fixture", "localize-set.json"), "utf8"));
const JOBS = path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail");
const STAGE = opt("stage") || "reuse", ONLY = (opt("only") || "").split(",").filter(Boolean), PREV = opt("prev"), PAR = Number(opt("par")) || 2;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const jobs = SET.jobs.filter((j) => !ONLY.length || ONLY.includes(j.key));

function replay(j) {
  const out = path.join(OUT, j.key), cache = path.join(OUT, "..", "tl-cache", j.key);
  const a = ["test/detail/localize-replay.js", path.join(JOBS, j.job), out, `--udata=${path.join(os.tmpdir(), "seedhack-loc-replay", "ud-" + j.key)}`];
  if (j.reOcr) { a.push("--re-ocr"); const prevOcr = PREV && path.join(PREV, j.key, "ocr.json"); if (prevOcr && fs.existsSync(prevOcr) && !fs.existsSync(path.join(out, "ocr.json"))) { fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(prevOcr, path.join(out, "ocr.json")); } } // 같은 OCR 로 비교
  if (STAGE === "render") a.push("--rerender");
  else { a.push("--tl=cli", `--tl-cache=${cache}`); if (STAGE === "reuse") a.push("--reuse-erase"); }
  if (PREV) a.push(`--prev=${path.join(PREV, j.key)}`);
  return new Promise((res) => {
    fs.mkdirSync(out, { recursive: true });
    const logF = fs.createWriteStream(path.join(out, "replay.log"));
    const p = spawn(path.join(REPO, "node_modules", ".bin", "electron"), a, { cwd: REPO });
    p.stdout.pipe(logF); p.stderr.pipe(logF);
    const t = Date.now();
    p.on("close", (code) => { const ok = code === 0 && fs.readFileSync(path.join(out, "replay.log"), "utf8").includes("LOC_REPLAY_OK"); console.log(`${ok ? "✔" : "✘"} ${j.key} ${((Date.now() - t) / 1000).toFixed(0)}초${ok ? "" : " → " + path.join(out, "replay.log")}`); res(ok); });
  });
}

const L0 = SET.limits;
let L = L0; // 상품마다 allow(아는 문제 허용치)를 얹은 기준 — table() 이 바꿔 가며 쓴다
const CHECKS = [ // [지표, 표 머리, 값, 기준 넘음?]
  ["overlaps", "글 겹침", (m) => m.overlaps, (v) => v > L.overlaps],
  ["clipped", "잘린 글", (m) => m.clipped ?? "-", (v) => v != null && v > (L.clipped ?? 0)],
  ["shapeOverflow", "도형 밖", (m) => m.shapeOverflow, (v) => v > L.shapeOverflow],
  ["roleDev", "같은 역할 크기 편차%", (m) => m.roleDev, (v) => v > L.roleDev],
  ["colDev", "열 정렬 편차px", (m) => m.colDev, (v) => v > L.colDev],
  ["rectEdge", "사각형 잔상", (m) => m.rectEdge ?? "-", (v) => v != null && v > L.rectEdge],
  ["residue", "잔상 검사(참고)", (m) => `${m.residueFail}/${m.residueAreas}`, () => false],
  ["chinese", "남은 한자", (m) => m.chinese, (v) => v > L.chinese],
  ["lowContrast", "대비 1.8 미만", (m) => m.lowContrast, (v) => v > L.lowContrast],
  ["lowWcag", "WCAG 미달(참고)", (m) => m.lowWcag ?? "-", () => false],
  ["tiny", "작은 글", (m) => m.tiny, (v) => v > L.tiny],
  ["emptyDeco", "빈 장식", (m) => m.emptyDeco, (v) => v > L.emptyDeco],
  ["literal", "직역", (m) => m.literal, (v) => v > L.literal],
];

function table() {
  const rows = [], fails = [], all = {};
  for (const j of jobs) {
    const s = readJson(path.join(OUT, j.key, "summary.json")), m = s?.after?.metrics, b = (PREV ? readJson(path.join(PREV, j.key, "summary.json"))?.after?.metrics : null) || s?.before?.metrics;
    if (!m) { rows.push(`| ${j.name} | 결과 없음 |`); fails.push(`${j.key}: 결과 없음`); continue; }
    L = { ...L0, ...Object.fromEntries(Object.entries(j.allow || {}).map(([k, v]) => [k, v.max])) };
    all[j.key] = { name: j.name, allow: j.allow || null, tuned: !!j.tuned, metrics: m, before: b || null, ai: s.after.ai, translate: s.translate ? { how: s.translate.how, costUsd: s.translate.costUsd } : null };
    const cells = CHECKS.map(([k, , val, bad]) => { const v = val(m), x = bad(typeof v === "string" ? null : v, m); if (x) fails.push(`${j.key} ${k}=${v}`); const bv = b ? val(b) : null; return `${bv != null && String(bv) !== String(v) ? `${bv}→` : ""}${v}${x ? " ✘" : ""}`; });
    rows.push(`| ${j.name}${j.tuned ? "" : " ★"} | ${m.pages} | ${cells.join(" | ")} | ${m.excluded.length} |`);
  }
  L = L0;
  const head = `| 상품(★ 처음 보는 상품) | 페이지 장 | ${CHECKS.map((c) => c[1]).join(" | ")} | 제외 |\n|${"---|".repeat(CHECKS.length + 3)}`;
  const lim = `기준: 겹침(맞닿음 포함) ≤${L.overlaps} · 잘린 글 ≤${L.clipped ?? 0} · 도형 밖 ≤${L.shapeOverflow} · 크기 편차 ≤${L.roleDev}% · 열 편차 ≤${L.colDev}px · 사각형 잔상 ≤${L.rectEdge} · 한자 ≤${L.chinese} · 대비 1.8:1 미만 ≤${L.lowContrast} · 작은 글 ≤${L.tiny} · 빈 장식 ≤${L.emptyDeco} · 직역 ≤${L.literal}`;
  const excl = jobs.map((j) => all[j.key] ? `- ${j.name}: ${all[j.key].metrics.excluded.join(" / ") || "없음"}` : null).filter(Boolean).join("\n");
  const detail = jobs.map((j) => { const m = all[j.key]?.metrics; if (!m) return null; const ls = Object.entries(m.lists).filter(([, v]) => v.length).map(([k, v]) => `  - ${k}: ${v.slice(0, 12).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" | ")}${v.length > 12 ? ` … 외 ${v.length - 12}` : ""}`); return ls.length ? `- ${j.name}\n${ls.join("\n")}` : null; }).filter(Boolean).join("\n");
  const known = jobs.flatMap((j) => Object.entries(j.allow || {}).map(([k, v]) => `- ${j.name} · ${k} ≤ ${v.max}: ${v.why}`)).join("\n");
  const md = `# 원본 한글화 회귀 지표 (${new Date().toISOString().slice(0, 16).replace("T", " ")} · stage ${STAGE})\n\n${head}\n${rows.join("\n")}\n\n${lim}\n\n## 아는 문제(허용치)\n${known || "없음"}\n\n## 제외 이미지와 사유\n${excl}\n\n## 항목별 목록\n${detail || "없음"}\n\n## 판정\n${fails.length ? fails.map((f) => `- ✘ ${f}`).join("\n") : "- 통과"}\n`;
  fs.writeFileSync(path.join(OUT, "metrics.md"), md);
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ at: Date.now(), stage: STAGE, limits: L, jobs: all, fails }, null, 1));
  console.log(md);
  return fails;
}

if (!has("table-only")) {
  fs.mkdirSync(OUT, { recursive: true });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PAR, jobs.length) }, async () => { for (;;) { const j = jobs[next++]; if (!j) return; await replay(j); } }));
}
const fails = table();
console.log(fails.length ? `LOC_REGRESS_FAIL ${fails.length}` : "LOC_REGRESS_OK");
process.exit(fails.length ? 1 : 0);
