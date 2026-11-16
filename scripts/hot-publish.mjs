// ⬆ 화면만 바로 업데이트 올리기 — `npm run hot -- "고친 내용 한 줄"`
// src/**·tools/{ocr-mac,cutout-mac}/** 를 목록(manifest)으로 만들고, 바뀐 파일만 GitHub(blackgosu100-png/coupang-signal-releases)의 hot/files/<sha256> 에 올린 뒤
// 대표님 비밀 열쇠(~/.seedhack/hot-key.pem)로 서명한 hot/manifest.json · hot/manifest.sig 를 마지막에 올린다(받는 쪽 src/main/hot.js 가 서명을 확인).
//   처음 한 번: `node scripts/hot-publish.mjs --init-key` → 비밀 열쇠 만들고 공개 열쇠를 src/main/hot-key.js 에 적는다(그 뒤 설치 파일을 한 번 새로 만들어야 받는 쪽이 이 열쇠를 안다)
//   `--dry` : 올리지 않고 목록·바뀐 파일만 보여 줌
// 설치 파일을 바꿔야 하는 변경(package.json 의 dependencies·Electron·boot.js)은 여기로 못 보낸다 — seedhackShell 숫자를 올리고 설치 파일로 배포.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "blackgosu100-png/coupang-signal-releases";
const KEY = path.join(os.homedir(), ".seedhack", "hot-key.pem");
const args = process.argv.slice(2), DRY = args.includes("--dry");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

if (args.includes("--init-key")) {
  if (fs.existsSync(KEY)) { console.log(`이미 열쇠가 있어요: ${KEY}`); process.exit(0); }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(KEY), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const pub = publicKey.export({ type: "spki", format: "pem" });
  fs.writeFileSync(path.join(ROOT, "src/main/hot-key.js"), `// ⬆ 화면만 바로 업데이트 서명 확인용 공개 열쇠(공개해도 되는 값). 비밀 열쇠는 대표님 맥 ~/.seedhack/hot-key.pem 에만 있다 — scripts/hot-publish.mjs --init-key 가 만든다\nexport const HOT_PUBLIC_KEY = ${JSON.stringify(pub)};\n`);
  console.log(`■ 열쇠를 만들었어요\n  비밀 열쇠: ${KEY} (다른 곳에 올리거나 보내지 마세요)\n  공개 열쇠: src/main/hot-key.js`);
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = ["src", "tools/ocr-mac", "tools/cutout-mac"].flatMap((d) => walk(path.join(ROOT, d))).map((f) => {
  const b = fs.readFileSync(f); return { p: path.relative(ROOT, f).split(path.sep).join("/"), sha: sha256(b), size: b.length, f };
}).filter((x) => x.p !== "src/hot-base.json");
const now = new Date(), pad = (n) => String(n).padStart(2, "0");
const seq = Math.floor(now.getTime() / 1000);
const label = `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const notes = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out").join(" ").slice(0, 200);
const manifest = { seq, label, notes, minShell: pkg.seedhackShell || 0, appVersion: pkg.version, createdAt: now.toISOString(), files: files.map(({ p, sha, size }) => ({ p, sha, size })) };

// --out <폴더>: GitHub 대신 그 폴더에 manifest.json · manifest.sig · files/<sha> 로 쓴다(시험용)
const OI = args.indexOf("--out"), OUT = OI >= 0 ? args[OI + 1] : null;
if (OUT) {
  if (!fs.existsSync(KEY)) { console.log("✕ 서명 열쇠가 없어요"); process.exit(1); }
  fs.mkdirSync(path.join(OUT, "files"), { recursive: true });
  for (const x of files) fs.writeFileSync(path.join(OUT, "files", x.sha), fs.readFileSync(x.f));
  const mBuf = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(OUT, "manifest.json"), mBuf);
  fs.writeFileSync(path.join(OUT, "manifest.sig"), crypto.sign(null, mBuf, crypto.createPrivateKey(fs.readFileSync(KEY))).toString("base64"));
  console.log(`■ 폴더에 씀 ${OUT} · ${label} · 파일 ${files.length}개`);
  process.exit(0);
}
const gh = (a, input) => execFileSync("gh", a, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
// 이미 올라간 파일(sha) 목록
let have = new Set();
try { have = new Set(JSON.parse(gh(["api", `repos/${REPO}/contents/hot/files`, "--jq", "[.[].name]"]))); } catch { /* 처음 */ }
const todo = [...new Map(files.filter((x) => !have.has(x.sha)).map((x) => [x.sha, x])).values()];
console.log(`화면 업데이트 ${label} · 파일 ${files.length}개 중 새로 올릴 것 ${todo.length}개 (${(todo.reduce((s, x) => s + x.size, 0) / 1e6).toFixed(1)}MB)${notes ? ` · "${notes}"` : ""}`);
if (DRY) { todo.slice(0, 30).forEach((x) => console.log("  +", x.p)); process.exit(0); }
if (!fs.existsSync(KEY)) { console.log(`✕ 서명 열쇠가 없어요 — 먼저 node scripts/hot-publish.mjs --init-key`); process.exit(1); }

const put = (repoPath, buf, msg) => {
  let sha = null; try { sha = gh(["api", `repos/${REPO}/contents/${repoPath}`, "--jq", ".sha"]).trim(); } catch {}
  const body = JSON.stringify({ message: msg, content: buf.toString("base64"), ...(sha ? { sha } : {}) });
  gh(["api", "-X", "PUT", `repos/${REPO}/contents/${repoPath}`, "--input", "-"], body);
};
let n = 0;
for (const x of todo) { put(`hot/files/${x.sha}`, fs.readFileSync(x.f), `hot ${label}: ${x.p}`); if (++n % 10 === 0) console.log(`  … ${n}/${todo.length}`); }
const mBuf = Buffer.from(JSON.stringify(manifest));
const sig = crypto.sign(null, mBuf, crypto.createPrivateKey(fs.readFileSync(KEY))).toString("base64");
put("hot/manifest.sig", Buffer.from(sig), `hot ${label}: 서명`); // 서명 먼저, 목록은 마지막(받는 쪽은 목록 기준으로 움직인다)
put("hot/manifest.json", mBuf, `hot ${label}: 목록`);
console.log(`■ 올림 — 켜져 있는 앱은 10분 안에(새로 켜면 20초 뒤) "⬆ 새 버전 ${label} · 바로 적용" 버튼이 떠요`);
