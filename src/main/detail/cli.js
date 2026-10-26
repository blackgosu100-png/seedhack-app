// 상세페이지용 범용 Claude CLI 러너 — src/main/ai-cli.js(추천 전용)를 그대로 본떠 "지시문·스키마·입력 글"을 바꿔 끼울 수 있게 했다.
// ai-cli.js 는 건드리지 않는다. 이 PC 에 Claude CLI 가 있으면(대표님 맥) CLI 로, 없으면(수강생 윈도우 PC) 같은 인자로 서버 중계(relay.js → task:"claude").
//   SIGNAL_AI_MODEL=haiku|sonnet|opus (상세페이지 카피 기본 sonnet — 글 품질이 중요) · SEEDHACK_RELAY=server 면 CLI 가 있어도 서버로
//   purpose: 서버가 받는 용도 이름(대시보드 signal-relay.mjs CLAUDE_PURPOSES) — 기록·화이트리스트용
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { relayStructured, forceServer, relayEnabled } from "./relay.js";
import { geminiStructured } from "./gemini-text.js";
import { googleConnected } from "./google-conn.js";

const CANDIDATES = [process.env.CLAUDE_CLI, path.join(os.homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].filter(Boolean);
export function cliPath() { return CANDIDATES.find((p) => existsSync(p)) || null; }
const localCli = () => !forceServer() && !!cliPath();
// 어떤 AI 로 부를지: SEEDHACK_AI=claude|gemini|server 가 있으면 그것. 없으면 로컬 Claude CLI → claude, 수강생 구글 연결 → gemini, 그 밖 → server(대표님 서버 중계)
export function aiProvider() {
  const want = process.env.SEEDHACK_AI;
  if (want === "gemini" && googleConnected()) return "gemini";
  if (want === "server" && relayEnabled()) return "server";
  if (want === "claude" && cliPath()) return "claude";
  if (localCli()) return "claude";
  if (googleConnected() && !forceServer()) return "gemini";
  return relayEnabled() ? "server" : null;
}
// AI 를 쓸 수 있는지(로컬 CLI · 구글 연결 · 서버 중계). 호출하는 쪽은 이것만 보고 AI 단계를 켠다
export const cliAvailable = () => !!aiProvider();
export const usesRelay = () => aiProvider() === "server";
// 구글 연결이 있어도 서버(Claude)로 보낼 용도. SEEDHACK_RELAY_PURPOSES=localize,localize-rewrite 처럼 바꿈(빈 값이면 모두 Gemini)
const RELAY_PURPOSES = new Set((process.env.SEEDHACK_RELAY_PURPOSES ?? "localize,localize-rewrite").split(",").map((x) => x.trim()).filter(Boolean));

// 구조화 출력 1회 호출.
//   system: 지시문, schema: JSON Schema(additionalProperties:false), text: 입력 글(stdin), model: haiku|sonnet|opus
//   allowedTools: ["Read"] 처럼 주면 그 도구만 자동 허용(--allowedTools) — 사진을 Read 로 열어 보는 비전 검수용. 없으면 도구 없이(--tools "")
// → { ok, result, model, usage, costUsd } 또는 { error }
export function runStructured({ system, schema, text, model = process.env.SIGNAL_AI_MODEL || "sonnet", timeoutMs = 180000, allowedTools = null, purpose = "other", log } = {}) {
  let prov = aiProvider();
  // 번역(원본 한글화)만은 수강생 구글이어도 서버 중계(Claude) — 2026-10-23 비교: 두 심판이 같은 쪽을 고른 줄 Claude 37 : Gemini 19 (카피·기획·검수는 비슷)
  if (prov === "gemini" && RELAY_PURPOSES.has(purpose) && relayEnabled() && process.env.SEEDHACK_AI !== "gemini") prov = "server";
  if (prov === "gemini") { // 수강생 구글: 결제·권한 문제(무료 체험 끝 등)면 서버 중계로 한 번 더
    return geminiStructured({ system, schema, text, model, allowedTools, log, timeoutMs: Math.max(timeoutMs, 180000) }).then((r) =>
      r?.error && [401, 403].includes(r.status) && relayEnabled() && !process.env.SEEDHACK_AI ? relayStructured({ system, schema, text, model, allowedTools, purpose, log, timeoutMs: Math.min(Math.max(timeoutMs, 120000), 310000) }) : r);
  }
  if (prov !== "claude") {
    if (prov !== "server") return Promise.resolve({ error: "Claude CLI가 없습니다 (~/.local/bin/claude)" });
    return relayStructured({ system, schema, text, model, allowedTools, purpose, log, timeoutMs: Math.min(Math.max(timeoutMs, 120000), 310000) });
  }
  const bin = cliPath();
  if (!bin) return Promise.resolve({ error: "Claude CLI가 없습니다 (~/.local/bin/claude)" });
  if (!system || !schema) return Promise.resolve({ error: "지시문(system)과 스키마(schema)가 필요합니다" });
  const tools = Array.isArray(allowedTools) && allowedTools.length ? ["--allowedTools", allowedTools.join(",")] : ["--tools", ""];
  const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--system-prompt", system,
    ...tools, "--no-session-persistence", "--model", model]; // --bare 는 로그인 정보를 안 읽어서 쓰지 않음 (ai-cli.js 와 동일)
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const env = { ...process.env }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; // Claude Code 안에서 켠 앱이어도 "중첩 실행"으로 보이지 않게
    let child;
    try { child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env }); }
    catch (e) { return finish({ error: `CLI 실행 실패: ${e.message}` }); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ error: `CLI 응답 시간 초과 (${timeoutMs / 1000}초)` }); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); finish({ error: `CLI 실행 실패: ${e.message}` }); });
    child.on("close", () => {
      clearTimeout(timer);
      let j = null;
      try { j = JSON.parse(out); } catch { return finish({ error: `CLI 출력 해석 실패: ${(out || err).slice(0, 200)}` }); }
      if (j?.is_error) return finish({ error: /authenticate|OAuth|expired|login/i.test(j.result || "") ? "Claude CLI 로그인이 필요합니다 — 터미널에서 claude 실행 후 /login" : String(j.result || "CLI 오류").slice(0, 200) });
      // structured_output 우선, 없으면 result 문자열(```json … ```)을 JSON으로 풀어 본다
      let result = j?.structured_output ?? null;
      if (!result && typeof j?.result === "string") { try { result = JSON.parse(j.result.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch {} }
      if (!result || typeof result !== "object") return finish({ error: "CLI 응답에 구조화 결과가 없습니다" });
      finish({ ok: true, result, model: `cli:${model}`, usage: j.usage || null, costUsd: j.total_cost_usd ?? null });
    });
    child.stdin.on("error", () => {}); // 자식이 먼저 닫혀도 EPIPE로 죽지 않게
    child.stdin.end(String(text ?? ""));
  });
}
