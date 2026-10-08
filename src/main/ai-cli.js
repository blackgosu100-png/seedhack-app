// 개발용 AI 경로: 이 Mac에 설치된 Claude Code CLI(구독)로 추천을 받는다.
// 수강생 배포판에서는 쓰지 않는다(서버 중계 사용). 개발 실행(npm start)에서 CLI가 있으면 자동으로 이 경로를 쓴다.
//   SIGNAL_AI=server 로 강제하면 개발 실행에서도 서버 중계를 쓴다. SIGNAL_AI_MODEL=haiku|sonnet|opus (기본 haiku)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { SYSTEM, RESULT_SCHEMA, renderInput } from "./ai-prompt.js";

const CANDIDATES = [process.env.CLAUDE_CLI, path.join(os.homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].filter(Boolean);
export function cliPath() { return CANDIDATES.find((p) => existsSync(p)) || null; }
export const cliAvailable = () => !!cliPath();

// → { ok, result, model, usage } 또는 { error }
export function recommendViaCli(input, { model = process.env.SIGNAL_AI_MODEL || "haiku", timeoutMs = 180000 } = {}) { // CLI는 Claude Code를 거쳐 1~2분 걸린다
  const bin = cliPath();
  if (!bin) return Promise.resolve({ error: "Claude CLI가 없습니다 (~/.local/bin/claude)" });
  const text = renderInput(input);
  const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(RESULT_SCHEMA), "--system-prompt", SYSTEM,
    "--tools", "", "--no-session-persistence", "--model", model]; // --bare 는 로그인 정보를 안 읽어서 쓰지 않음
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const env = { ...process.env }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; // Claude Code 안에서 켠 앱이어도 "중첩 실행"으로 보이지 않게
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env });
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ error: `CLI 응답 시간 초과 (${timeoutMs / 1000}초)` }); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); finish({ error: `CLI 실행 실패: ${e.message}` }); });
    child.on("close", () => {
      clearTimeout(timer);
      let j = null;
      try { j = JSON.parse(out); } catch { return finish({ error: `CLI 출력 해석 실패: ${(out || err).slice(0, 200)}` }); }
      if (j?.is_error) return finish({ error: /authenticate|OAuth|expired|login/i.test(j.result || "") ? "Claude CLI 로그인이 필요합니다 — 터미널에서 claude 실행 후 /login" : String(j.result || "CLI 오류").slice(0, 200) });
      let result = j?.structured_output ?? null;
      if (!result && typeof j?.result === "string") { try { result = JSON.parse(j.result.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch {} }
      if (!result || !Array.isArray(result.picks)) return finish({ error: "CLI 응답에 추천 결과가 없습니다" });
      finish({ ok: true, result, model: `cli:${model}`, usage: j.usage || null, costUsd: j.total_cost_usd ?? null });
    });
    child.stdin.end(text);
  });
}
