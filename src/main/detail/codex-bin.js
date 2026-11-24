// 🧪 GPT 명령줄(codex) 찾기 — 맥: ChatGPT 앱 안·brew·npm / 윈도우: PATH·npm 전역(codex.cmd)·앱 설치 폴더. 없으면 null (의존성 없음, 동기)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
