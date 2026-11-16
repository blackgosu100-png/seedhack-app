// "화면만 바로 업데이트" — 친마 통합대시보드처럼 고치면 바로 받는다(설치 파일 155MB 대신 바뀐 파일 몇 개만).
// 올리는 쪽: scripts/hot-publish.mjs(npm run hot) → GitHub blackgosu100-png/coupang-signal-releases 의 hot/manifest.json(+.sig) · hot/files/<sha256>
// 받는 쪽(여기): 켤 때·10분마다 목록 확인 → 서명(Ed25519, hot-key.js 공개키) 검사 → 바뀐 파일만 받아 sha256 검사 → <userData>/hot/<seq>/ 에 새 폴더로 모음
//   → 화면에 "새 버전 · 바로 적용" → 누르면 다시 켜져 boot.js 가 새 폴더 코드로 시작. 켜다가 죽으면 boot.js 가 그 버전을 버린다.
// 설치본이 더 새로우면(src/hot-base.json seq) 받은 것보다 설치본을 쓴다. minShell(package.json seedhackShell)이 높은 버전은 설치 파일 업데이트가 먼저 필요.
import { app, net } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOT_PUBLIC_KEY } from "./hot-key.js";

const REPO = "blackgosu100-png/coupang-signal-releases";
// SEEDHACK_HOT_SRC=file:///…/폴더 또는 http 주소 — 시험용(그 주소의 manifest.json · manifest.sig · files/<sha>)
const SRC = process.env.SEEDHACK_HOT_SRC || "";
const MANIFEST_API = SRC ? `${SRC}/manifest.json` : `https://api.github.com/repos/${REPO}/contents/hot/manifest.json`; // API 는 캐시가 짧다(raw 는 5분)
const SIG_API = SRC ? `${SRC}/manifest.sig` : `https://api.github.com/repos/${REPO}/contents/hot/manifest.sig`;
const BLOB = (sha) => (SRC ? `${SRC}/files/${sha}` : `https://raw.githubusercontent.com/${REPO}/main/hot/files/${sha}`);
const here = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = path.resolve(here, "..", ".."); // 지금 돌고 있는 코드의 뿌리(설치본 앱 폴더 또는 hot/<seq>)
const noop = () => {};

const hotRoot = () => path.join(app.getPath("userData"), "hot");
const stateF = () => path.join(hotRoot(), "state.json");
const readState = () => { try { return JSON.parse(fs.readFileSync(stateF(), "utf8")); } catch { return {}; } };
const writeState = (s) => { fs.mkdirSync(hotRoot(), { recursive: true }); fs.writeFileSync(stateF(), JSON.stringify(s, null, 1)); };
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export const runningSeq = () => Number(process.env.SEEDHACK_HOT_SEQ || 0) || baseSeq();
export function baseSeq() { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(new URL("../boot.js", import.meta.url))), "hot-base.json"), "utf8")).seq || 0; } catch { return 0; } }
function shellLevel() { // 설치본 package.json 의 seedhackShell(하네스처럼 앱 폴더가 다르면 지금 코드 뿌리의 것)
  for (const d of [app.getAppPath(), codeRoot]) { try { const v = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")).seedhackShell; if (v) return v; } catch {} }
  return 0;
}

// 화면이 다 떴을 때 main.js 가 부른다 — 이 버전으로 잘 켜졌다
export function markGood() {
  const seq = Number(process.env.SEEDHACK_HOT_SEQ || 0); if (!seq) return;
  const s = readState(); s.good = seq; s.trying = null; writeState(s);
  // 오래된 폴더 정리(지금 것·바로 전 것만 남김)
  try { const keep = new Set([s.current?.dir, s.prev?.dir].filter(Boolean).map((d) => path.basename(d))); for (const d of fs.readdirSync(hotRoot())) if (/^\d+$/.test(d) && !keep.has(d)) fs.rmSync(path.join(hotRoot(), d), { recursive: true, force: true }); } catch {}
}

// 시험용 file:// 주소는 파일로 읽는다
const readLocal = (url) => { try { return fs.readFileSync(fileURLToPath(url)); } catch { return null; } };
async function fetchApi(url) {
  if (url.startsWith("file:")) return readLocal(url);
  const r = await net.fetch(`${url}?t=${Date.now()}`, { headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "seedhack" }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`목록 확인 실패 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
export function verifyManifest(buf, sigB64, pub = HOT_PUBLIC_KEY) {
  if (!pub || !sigB64) return false;
  try { return crypto.verify(null, buf, crypto.createPublicKey(pub), Buffer.from(String(sigB64).trim(), "base64")); } catch { return false; }
}

// 이미 가진 파일(지금 코드·설치본)에서 같은 sha 를 찾는다 — 바뀐 파일만 받기 위해
function localCopy(rel, sha) {
  for (const root of [codeRoot, app.getAppPath()]) {
    const f = path.join(root, rel);
    try { const b = fs.readFileSync(f); if (sha256(b) === sha) return b; } catch {}
  }
  return null;
}

let busy = false, ready = null; // ready = { seq, label, notes }
export const hotReady = () => ready;

// 목록 확인 → 새 버전이면 받아 두고 { seq, label, notes, files, downloaded } 반환. 없으면 null
export async function checkHot({ log = noop } = {}) {
  if (busy) return null;
  busy = true;
  try {
    const mBuf = await fetchApi(MANIFEST_API);
    if (!mBuf) return null;
    const sig = (await fetchApi(SIG_API))?.toString("utf8");
    if (!verifyManifest(mBuf, sig)) { log("dim", "  ⬆ 화면 업데이트 목록 서명이 맞지 않음(올리는 중이거나 위조) — 다음에 다시 확인"); return null; }
    const m = JSON.parse(mBuf.toString("utf8"));
    const s = readState();
    if (!(m.seq > runningSeq()) || (s.bad || []).includes(m.seq) || (ready && ready.seq >= m.seq)) return null;
    if ((m.minShell || 0) > shellLevel()) { log("dim", `  ⬆ 화면 업데이트 ${m.label} 은 설치 파일 업데이트가 먼저 필요해요`); return null; }
    if (s.current?.seq === m.seq && fs.existsSync(path.join(s.current.dir, ".ok"))) { ready = { seq: m.seq, label: m.label, notes: m.notes || "" }; return ready; } // 이미 받아 둠
    const dir = path.join(hotRoot(), String(m.seq)), tmp = `${dir}.part`;
    fs.rmSync(tmp, { recursive: true, force: true });
    let got = 0, bytes = 0;
    for (const f of m.files || []) {
      if (!/^(src|tools)\//.test(f.p) || f.p.includes("..")) throw new Error(`이상한 파일 경로: ${f.p}`);
      let b = localCopy(f.p, f.sha);
      if (!b) {
        if (BLOB(f.sha).startsWith("file:")) { b = readLocal(BLOB(f.sha)); if (!b) throw new Error(`파일 받기 실패: ${f.p}`); }
        else {
          const r = await net.fetch(BLOB(f.sha), { cache: "no-store" });
          if (!r.ok) throw new Error(`파일 받기 실패 ${r.status}: ${f.p}`);
          b = Buffer.from(await r.arrayBuffer());
        }
        if (sha256(b) !== f.sha) throw new Error(`파일 확인 값이 다름: ${f.p}`);
        got++; bytes += b.length;
      }
      const out = path.join(tmp, f.p);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, b);
    }
    fs.writeFileSync(path.join(tmp, ".ok"), String(m.seq));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    writeState({ ...s, prev: s.current?.seq !== m.seq ? s.current || null : s.prev || null, current: { seq: m.seq, label: m.label, dir, minShell: m.minShell || 0 }, trying: null });
    ready = { seq: m.seq, label: m.label, notes: m.notes || "", downloaded: got, bytes };
    log("go", `■ 화면 업데이트 ${m.label} 받음 (바뀐 파일 ${got}개 · ${(bytes / 1e6).toFixed(1)}MB) — 위쪽 '바로 적용'을 누르면 다시 켜져요`);
    return ready;
  } catch (e) { log("dim", `  ⬆ 화면 업데이트 확인 실패: ${String(e?.message || e).slice(0, 120)}`); return null; }
  finally { busy = false; }
}

// 바로 적용: 다시 켠다(boot.js 가 새 폴더 코드로 시작)
export function applyHot() { app.relaunch(); app.exit(0); }

// 켤 때 한 번(20초 뒤) + 10분마다
export function startHot({ log = noop, onReady = noop } = {}) {
  if (process.env.SEEDHACK_NO_HOT === "1" || (!app.isPackaged && process.env.SEEDHACK_HOT !== "1")) return;
  const tick = async () => { const r = await checkHot({ log }); if (r) onReady(r); };
  setTimeout(tick, 20000);
  setInterval(tick, 10 * 60 * 1000);
}
