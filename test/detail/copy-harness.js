// A3 카피 하네스 — 샘플 입력으로 Claude CLI 를 실제 1회 호출해 스키마·금지어·숫자 검증 결과와 비용·시간을 출력하고
// test/detail/fixture/copy-sample.json(정화된 Copy — A4·A5 가 그대로 쓴다) + copy-sample.meta.json(원본 응답·검증 결과)을 저장한다.
//   node test/detail/copy-harness.js            (모델: SIGNAL_AI_MODEL 또는 sonnet)
//   node test/detail/copy-harness.js --rules      (CLI 없이 규칙 기반만 → copy-sample.rules.json 에 저장)
//   node test/detail/copy-harness.js --from-meta  (CLI 재호출 없이 copy-sample.meta.json 의 AI 원본(raw)을 다시 정화해 copy-sample.json·plan-sample.json 갱신)
//   node test/detail/copy-harness.js --v2 --real  (실제 작업 JSON + brief-real-sample.json 으로 v2 카피 1회 호출 → copy-v2-real-sample.json)
//   DASHBOARD_URL=http://localhost:3000 SIGNAL_VENDOR_ID=A00000000 node test/detail/copy-harness.js --server
//       (배포판 경로: 대시보드 서버 중계 task:"detail" 실제 왕복 1회 → copy-sample.server.json 에 저장. SIGNAL_AI=server 를 켜고 CLI 는 쓰지 않는다.
//        DASHBOARD_URL 을 안 주면 auth-config.js 의 운영 주소, SIGNAL_VENDOR_ID 는 승인된 Wing 판매자ID — 없으면 서버가 403)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCopyInput, writeCopy, lintCopy, validateCopy, sanitizeCopy, sanitizeCopyV2, cliAvailable } from "../../src/main/detail/copy.js";
import { buildPlan } from "../../src/main/detail/plan-core.js";
import { COPY_SCHEMA_V2 } from "../../src/main/detail/copy-prompt.js";
import { realCopyInput } from "./brief-harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixDir = path.join(here, "fixture");
const fx = JSON.parse(fs.readFileSync(path.join(fixDir, "source-sample.json"), "utf8"));
const V2 = process.argv.includes("--v2"), REAL = process.argv.includes("--real");
const input = REAL ? realCopyInput() : buildCopyInput({ source: fx.source, ocr: fx.ocr, ko: fx.translations, keyword: fx.keyword, coupangName: fx.coupangName, category: fx.category });
if (REAL && (!input.title_ko || /[\u4e00-\u9fff]|회사|公司/.test(input.title_ko))) input.title_ko = "벽걸이 접이식 빨래 건조대 (알루미늄 합금)"; // 실제 작업의 제목 번역이 회사명이라 보정
const brief = V2 ? JSON.parse(fs.readFileSync(path.join(fixDir, REAL ? "brief-real-sample.json" : "brief-real-sample.rules.json"), "utf8")) : null;
const rulesOnly = process.argv.includes("--rules");
const fromMeta = process.argv.includes("--from-meta");
const viaServer = process.argv.includes("--server");
if (viaServer) process.env.SIGNAL_AI = "server"; // writeCopy 자동 분기가 서버 중계를 고르게
const model = process.env.SIGNAL_AI_MODEL || "sonnet";
const log = (cls, text) => console.log(`[${cls}] ${text}`);

console.log(`▶ 카피 하네스 · 이미지 ${input.images.length}장 · CLI ${cliAvailable() ? "있음" : "없음"} · 모델 ${model}${rulesOnly ? " · 규칙만" : ""}${viaServer ? ` · 서버 중계 ${process.env.DASHBOARD_URL || "(auth-config 운영 주소)"} · 판매자 ${process.env.SIGNAL_VENDOR_ID || "(없음 → 실패 예상)"}` : ""}`);
const t0 = Date.now();
let r;
if (fromMeta) { // 저장된 AI 원본을 현재 규칙으로 다시 정화(정책 약속 필터 등이 바뀌었을 때)
  const prev = JSON.parse(fs.readFileSync(path.join(fixDir, "copy-sample.meta.json"), "utf8"));
  if (!prev.raw) { console.log("FAIL copy-sample.meta.json 에 raw 가 없습니다 — CLI 호출이 필요합니다"); process.exit(1); }
  const { copy, fixes } = sanitizeCopy(prev.raw, input);
  r = { copy, how: "cli", model: prev.model, costUsd: prev.costUsd, usage: prev.usage, elapsedMs: prev.elapsedMs, fixes, raw: prev.raw, resanitized: true };
} else if (viaServer) r = await writeCopy(input, { log, model, brief, v2: V2 }); // useCli 생략 → SIGNAL_AI=server 로 서버 중계
else r = await writeCopy(input, { log, model, useCli: !rulesOnly && cliAvailable(), brief, v2: V2 });
const elapsedMs = fromMeta ? r.elapsedMs : Date.now() - t0;

const SCHEMA = V2 ? COPY_SCHEMA_V2 : undefined;
const rawValid = r.raw ? validateCopy(r.raw, SCHEMA) : null;
const rawLint = r.raw ? lintCopy(r.raw) : null;
const rawFixes = r.raw ? (V2 ? sanitizeCopyV2(r.raw, input, brief) : sanitizeCopy(r.raw, input)).fixes : [];
const finalValid = validateCopy(r.copy, SCHEMA), finalLint = lintCopy(r.copy);
const plan = REAL ? buildPlan({ source: JSON.parse(fs.readFileSync(path.join(fixDir, "real-948424797701", "source.json"), "utf8")), ocr: JSON.parse(fs.readFileSync(path.join(fixDir, "real-948424797701", "ocr.json"), "utf8")), cleaned: JSON.parse(fs.readFileSync(path.join(fixDir, "real-948424797701", "clean.json"), "utf8")), copy: r.copy, copyInput: input, jobId: "real" })
  : buildPlan({ source: fx.source, ocr: fx.ocr, cleaned: fx.cleaned, copy: r.copy, templateId: "clean", translations: fx.translations, copyInput: input, jobId: "sample" });
if (V2) console.log(`  소제목 체인: ${r.copy.chain_check}\n  proof: ${JSON.stringify(r.copy.proof)}\n  compare: ${JSON.stringify(r.copy.compare?.rows)}\n  objections: ${(r.copy.objections || []).map((o) => o.q).join(" / ")}`);

console.log(`■ 경로 ${r.how}${r.resanitized ? " (저장된 원본 재정화)" : ""}${r.tried ? ` (시도: ${r.tried})` : ""} · 모델 ${r.model || "-"} · ${(elapsedMs / 1000).toFixed(1)}초 · 비용 ${r.costUsd != null ? `$${Number(r.costUsd).toFixed(4)}` : "-"}${r.error ? ` · 오류: ${r.error}` : ""}`);
if (r.usage) console.log(`  토큰 입력 ${(r.usage.input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0)} (캐시 생성 ${r.usage.cache_creation_input_tokens ?? 0} · 캐시 읽기 ${r.usage.cache_read_input_tokens ?? 0}) / 출력 ${r.usage.output_tokens ?? "-"}`);
if (rawValid) console.log(`  AI 원본: 스키마 ${rawValid.ok ? "통과" : "오류 " + rawValid.errors.join("; ")} · 금지어·정책 약속 ${rawLint.issues.length}건${rawLint.issues.length ? " " + JSON.stringify(rawLint.issues.map((i) => `${i.path} ${i.word}`)) : ""} · 정화 ${rawFixes.length}건${rawFixes.length ? "\n    - " + rawFixes.join("\n    - ") : ""}`);
console.log(`  최종: 스키마 ${finalValid.ok ? "통과" : "오류 " + finalValid.errors.join("; ")} · 금지어 ${finalLint.issues.length}건 · 섹션 ${plan.sections.length}개 [${plan.sections.map((s) => s.type).join(" ")}] · cuts ${plan.cuts.length}`);

const base = V2 && REAL ? "copy-v2-real-sample" : V2 ? "copy-v2-sample" : "copy-sample";
const stem = rulesOnly ? `${base}.rules` : viaServer ? `${base}.server` : base; // 규칙판·서버판·v2 는 다른 이름으로 — CLI 결과를 덮어쓰지 않게
fs.writeFileSync(path.join(fixDir, `${stem}.json`), JSON.stringify(r.copy, null, 2) + "\n");
fs.writeFileSync(path.join(fixDir, `${stem}.meta.json`), JSON.stringify({ how: r.how, tried: r.tried ?? null, model: r.model || null, costUsd: r.costUsd ?? null, usage: r.usage || null, elapsedMs, error: r.error || null,
  rawValid, rawLint, fixes: rawFixes, finalValid, finalLint, raw: r.raw || null, estimatedHeight: plan.estimatedHeight, dropped: plan.dropped, createdAt: new Date().toISOString() }, null, 2) + "\n");
const planName = `plan-${stem.replace(/^copy-/, "")}.json`; // plan-sample.json / plan-sample.rules.json / plan-v2-real-sample.json …
fs.writeFileSync(path.join(fixDir, planName), JSON.stringify(plan, null, 2) + "\n");
console.log(`  저장: ${path.join(fixDir, `${stem}.json`)}, ${stem}.meta.json, ${planName}`);
const ok = finalValid.ok && finalLint.ok && (rulesOnly || r.how === (viaServer ? "server" : "cli"));
console.log(ok ? "OK 카피 하네스" : "FAIL 카피 하네스");
if (!ok) process.exitCode = 1;
