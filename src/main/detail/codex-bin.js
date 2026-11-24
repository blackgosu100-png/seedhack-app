// 🧪 GPT 명령줄(codex) 찾기 — 맥: ChatGPT 앱 안·brew·npm / 윈도우: PATH·npm 전역(codex.cmd)·앱 설치 폴더. 없으면 null (의존성 없음, 동기)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const isFile = (f) => { try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };
export function codexCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const P = platform === "win32" ? path.win32 : path.posix, win = platform === "win32";
  const names = win ? ["codex.exe", "codex.cmd"] : ["codex"];
  const dirs = String(env.PATH || env.Path || "").split(win ? ";" : ":").filter(Boolean);
  const fixed = win
    ? [env.APPDATA && P.join(env.APPDATA, "npm", "codex.cmd"), env.LOCALAPPDATA && P.join(env.LOCALAPPDATA, "Programs", "ChatGPT", "resources", "codex.exe"), env.LOCALAPPDATA && P.join(env.LOCALAPPDATA, "Programs", "Codex", "resources", "codex.exe"), env.LOCALAPPDATA && P.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe"), P.join(home, ".codex", "bin", "codex.exe")]
    : ["/Applications/ChatGPT.app/Contents/Resources/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex", P.join(home, ".local/bin/codex"), P.join(home, ".npm-global/bin/codex")];
  return [env.SEEDHACK_CODEX_BIN, ...fixed, ...dirs.flatMap((d) => names.map((n) => P.join(d, n)))].filter(Boolean);
}
export function codexBin(o = {}) { return codexCandidates(o).find(o.isFile || isFile) || null; }
// 실행 방법: 윈도우의 .cmd 는 셸을 거쳐야 한다 → 인자를 따옴표로 감싼다. 문구(프롬프트)는 인자가 아니라 표준 입력으로 준다(줄바꿈·따옴표가 셸에서 깨지지 않게)
export function codexSpawnPlan(bin, args, { platform = process.platform } = {}) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(bin)) { const q = (s) => `"${String(s).replace(/"/g, "")}"`; return { cmd: q(bin), args: args.map(q), opts: { shell: true, windowsHide: true } }; }
  return { cmd: bin, args, opts: { windowsHide: true } };
}

// 🚦 ChatGPT 사용 한도: 한 번 걸리면 그 뒤 호출도 전부 실패한다 → 기억해 두고 작업을 멈추게 한다(조용히 예전 방식으로 넘어가지 않게)
let limit = null;
export const codexLimit = () => limit;
export const clearCodexLimit = () => { limit = null; };
const errMsgs = (buf) => [...String(buf || "").matchAll(/"type":"error","message":"((?:[^"\\\\]|\\\\.)*)"/g)].map((m) => m[1]).join(" ");
export function codexFailWhy(text, code) { // codex 가 남긴 오류 글 → 쉬운 말. 한도면 limit 에 기억
  const t = String(text || "");
  if (/usage limit|rate limit|quota/i.test(t)) { const at = (t.match(/try again at ([^."\\]+)/i) || [])[1]; limit = { msg: `ChatGPT 사용 한도를 다 썼어요${at ? ` — ${at.trim()} 이후에 다시 돼요` : ""}`, at: Date.now() }; return limit.msg; }
  if (/not logged in|login required|401|unauthorized/i.test(t)) return "ChatGPT 로그인이 필요해요";
  return `GPT 가 결과를 주지 않았어요(종료 ${code})${t ? ` ${t.slice(0, 80)}` : ""}`;
}
// 만들기 전에 한 번: GPT 가 지금 답하는지(한도·로그인) — 5초쯤
export function codexPing(bin, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let dir; try { dir = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-cxp-")); } catch { return resolve({ ok: true }); }
    const done = (v) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} resolve(v); };
    const pl = codexSpawnPlan(bin, ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "-C", dir, "--json", "-"]);
    let ch, buf = "", err = "", fin = false; try { ch = spawn(pl.cmd, pl.args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], ...pl.opts }); } catch (e) { return done({ ok: false, why: `GPT 명령줄 실행 실패 ${String(e?.message || e).slice(0, 80)}` }); }
    const tm = setTimeout(() => { if (fin) return; fin = true; try { ch.kill("SIGKILL"); } catch {} done({ ok: true, slow: true }); }, timeoutMs);
    ch.stdout.on("data", (d) => { if (buf.length < 2e5) buf += d; }); ch.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
    ch.on("error", (e) => { if (fin) return; fin = true; clearTimeout(tm); done({ ok: false, why: `GPT 명령줄 실행 실패 ${String(e?.message || e).slice(0, 80)}` }); });
    ch.on("close", (code) => { if (fin) return; fin = true; clearTimeout(tm); const em = errMsgs(buf); if (code === 0 && !em) return done({ ok: true }); done({ ok: false, why: codexFailWhy(em || err, code) }); });
    ch.stdin.on("error", () => {}); ch.stdin.end("OK 라고만 답하세요. 도구는 쓰지 않습니다.", "utf8");
  });
}

// ── 그림 1장 만들기: 입력 그림(들) + 지시 → { b64, mime, texts? } | { error }. ChatGPT 로그인(구독)으로 그린다
const CODEX_TAIL = `

[작업 방법]
- 첨부한 그림 in.jpg 가 원본입니다. 반드시 이미지 생성 도구로 위 지시대로 고친 그림 1장을 만드세요. 셸 명령·코드·글꼴로 직접 그리지 않습니다.
- 그림의 가로세로 비율은 원본과 같게 합니다.
- 만든 그림을 현재 폴더에 out.png 로 저장하고, 마지막에 DONE 이라고만 답하세요. 다른 파일은 만들거나 고치지 않습니다.`;
const CODEX_TEXT_TAIL = `
- 그림에 쓴 문구를 현재 폴더 text.json 에 [{"zh":"원문","ko":"그림에 쓴 한국어(줄바꿈은 \\n)"}] 모양으로 저장하세요. 뺀 글은 "ko":"" 로 적습니다. 이 파일은 만들어도 됩니다.`;
export function codexImage({ bin, images = [], prompt = "", wantText = false, tail = CODEX_TAIL, timeoutMs = 420000 } = {}) {
  const auth = { bin };
  return new Promise((resolve) => {
    let dir; try { dir = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-cx-")); images.forEach((f, n) => fs.copyFileSync(f, path.join(dir, n ? `in${n + 1}.jpg` : "in.jpg"))); } catch (e) { return resolve({ error: `임시 폴더 실패 ${String(e?.message || e).slice(0, 60)}` }); }
    const done = (v) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} resolve(v); };
    let buf = "", err = "", fin = false;
    const pl = codexSpawnPlan(auth.bin, ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "workspace-write", "-C", dir, ...images.flatMap((_, n) => ["-i", path.join(dir, n ? `in${n + 1}.jpg` : "in.jpg")]), "--json", "-"]);
    let ch; try { ch = spawn(pl.cmd, pl.args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], ...pl.opts }); } catch (e) { return done({ error: `GPT 명령줄 실행 실패 ${String(e?.message || e).slice(0, 80)}` }); }
    ch.stdin.on("error", () => {}); ch.stdin.end(prompt + tail + (wantText ? CODEX_TEXT_TAIL : ""), "utf8");
    const tm = setTimeout(() => { if (fin) return; fin = true; try { if (process.platform === "win32" && ch.pid) spawn("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { windowsHide: true }); else ch.kill("SIGKILL"); } catch {} done({ error: "시간 초과" }); }, timeoutMs);
    ch.stdout.on("data", (d) => { if (buf.length < 4e6) buf += d; }); ch.stderr.on("data", (d) => { if (err.length < 4000) err += d; });
    ch.on("error", (e) => { if (fin) return; fin = true; clearTimeout(tm); done({ error: `GPT 명령줄 실행 실패 ${String(e?.message || e).slice(0, 80)}` }); });
    ch.on("close", (code) => {
      if (fin) return; fin = true; clearTimeout(tm);
      let f = path.join(dir, "out.png");
      if (!fs.existsSync(f)) { // 저장을 빠뜨렸으면 codex 가 만든 그림 폴더에서 찾는다
        const tid = (buf.match(/"thread_id":"([0-9a-f-]+)"/) || [])[1], gd = tid && path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "generated_images", tid);
        try { const fs2 = fs.readdirSync(gd).filter((x) => /\.png$/i.test(x)).map((x) => path.join(gd, x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); if (fs2[0]) f = fs2[0]; } catch {}
      }
      if (!fs.existsSync(f)) return done({ error: codexFailWhy(errMsgs(buf) || err, code) });
      let texts = null; if (wantText) { try { const a = JSON.parse(fs.readFileSync(path.join(dir, "text.json"), "utf8")); if (Array.isArray(a)) texts = a.filter((x) => x && typeof x.zh === "string").map((x) => ({ zh: String(x.zh).slice(0, 300), ko: String(x.ko || "").slice(0, 300), drop: !String(x.ko || "").trim(), role: "" })).slice(0, 80); } catch {} }
      try { done({ b64: fs.readFileSync(f).toString("base64"), mime: "image/png", tokens: 0, texts }); } catch (e) { done({ error: String(e?.message || e).slice(0, 80) }); }
    });
  });
}

// 🎨 장면 사진용 꼬리말(제품 사진을 보고 새 장면 1장)
export const codexSceneTail = (aspect = "4:5") => `

[작업 방법]
- 첨부한 사진(in.jpg, in2.jpg …)은 제품 사진입니다. 제품의 모양·색·비율·로고는 사진과 똑같이 유지하세요.
- 반드시 이미지 생성 도구로 위 지시의 그림 1장을 만드세요. 셸 명령·코드로 직접 그리지 않습니다.
- 그림의 가로:세로 비율은 ${aspect} 입니다.
- 만든 그림을 현재 폴더에 out.png 로 저장하고, 마지막에 DONE 이라고만 답하세요. 다른 파일은 만들거나 고치지 않습니다.`;

// ── 글 AI: 지시문 + JSON 스키마 + 입력 글 → { ok, result } | { error }. 스키마는 지시문에 넣고 마지막 답(JSON)을 읽는다
export function codexStructured({ bin, system, schema, text, timeoutMs = 240000, readFiles = false } = {}) {
  return new Promise((resolve) => {
    let dir; try { dir = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-cxt-")); } catch (e) { return resolve({ error: `임시 폴더 실패 ${String(e?.message || e).slice(0, 60)}` }); }
    const done = (v) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} resolve(v); };
    const last = path.join(dir, "last.txt");
    const prompt = `${system}\n\n[출력 형식]\n- 아래 JSON Schema 에 맞는 JSON 하나만 답하세요. 설명·코드블록 표시 없이 JSON 만 씁니다.\n- ${readFiles ? "입력에 적힌 파일 경로의 그림은 직접 열어 보고 판단하세요. 파일을 만들거나 고치지 않습니다." : "도구·셸 명령을 쓰지 말고 바로 답하세요."}\n${JSON.stringify(schema)}\n\n[입력]\n${String(text ?? "")}`;
    const pl = codexSpawnPlan(bin, ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "-C", dir, "-o", last, "--json", "-"]);
    let ch, err = "", buf = "", fin = false; try { ch = spawn(pl.cmd, pl.args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], ...pl.opts }); } catch (e) { return done({ error: `GPT 명령줄 실행 실패 ${String(e?.message || e).slice(0, 80)}` }); }
    const tm = setTimeout(() => { if (fin) return; fin = true; try { if (process.platform === "win32" && ch.pid) spawn("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { windowsHide: true }); else ch.kill("SIGKILL"); } catch {} done({ error: `GPT 응답 시간 초과 (${timeoutMs / 1000}초)` }); }, timeoutMs);
    ch.stderr.on("data", (d) => { if (err.length < 4000) err += d; }); ch.stdout.on("data", (d) => { if (buf.length < 2e6) buf += d; });
    ch.on("error", (e) => { if (fin) return; fin = true; clearTimeout(tm); done({ error: `GPT 명령줄 실행 실패 ${String(e?.message || e).slice(0, 80)}` }); });
    ch.on("close", (code) => {
      if (fin) return; fin = true; clearTimeout(tm);
      let s = ""; try { s = fs.readFileSync(last, "utf8"); } catch {}
      let result = null; try { result = JSON.parse(s.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a >= 0 && b > a) { try { result = JSON.parse(s.slice(a, b + 1)); } catch {} } }
      if (!result || typeof result !== "object") return done({ error: codexFailWhy(errMsgs(buf) || err, code) });
      done({ ok: true, result, model: "codex", usage: null, costUsd: 0 });
    });
    ch.stdin.on("error", () => {}); ch.stdin.end(prompt, "utf8");
  });
}
