// ▶ 주소로 만들기 · 화면 캡처:  npx electron test/detail/ko-ui.js "<1단계 끝난 한국 판매처 작업 폴더>" --out=<png 폴더> [--naver=<네이버 상품 주소>]
// 실제 panel.html·panel.cjs 로 ① 주소 칸 사이트 칩 ② 1단계 확인 화면의 권리 안내 ③ (선택) 네이버 로그인 요구 → 「보이는 창으로 열기」 버튼을 찍는다. 작업 폴더는 임시 userData 로 복제.
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const USER = path.join(os.tmpdir(), "seedhack-ko-ui");
fs.rmSync(USER, { recursive: true, force: true }); fs.mkdirSync(path.join(USER, "detail"), { recursive: true });
app.setPath("userData", USER);
app.on("window-all-closed", () => {});
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const JOB = argv.find((a) => !a.startsWith("--") && fs.existsSync(path.join(a, "info.json")));
const OUT = path.resolve(opt("out") || path.join(USER, "shots")); fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const store = (() => { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; })();

app.whenReady().then(async () => {
  const jobId = path.basename(JOB); execFileSync("cp", ["-Rc", JOB, path.join(USER, "detail", jobId)]);
  let win = null;
  const { initDetail } = await import(pathToFileURL(path.join(here, "../../src/main/detail/index.js")).href);
  initDetail({ ipcMain, app, getWin: () => win, store, log: (c, t) => /▶|✕/.test(t) && console.log("  ", t), translate: async (t) => t, getCnSession: () => null, getCnView: () => null, send: (ch, d) => win?.webContents.send(ch, d), showDetail: () => {} });
  win = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true, webPreferences: { preload: path.join(here, "../../src/preload/panel.cjs"), contextIsolation: true } });
  await win.loadFile(path.join(here, "../../src/renderer/panel.html"));
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const shot = async (name) => { const f = path.join(OUT, `${name}.png`); fs.writeFileSync(f, (await win.webContents.capturePage()).toPNG()); console.log("  📸", f); };
  await wait(800);
  await js(`(() => { const b = document.getElementById("tDetail"); b.disabled = false; b.click(); })()`); await wait(1200);
  await js(`(() => { const i = document.getElementById("dtUrl"); i.value = "https://store.ohou.se/goods/4237106"; i.dispatchEvent(new Event("input")); document.getElementById("dtSetup").scrollIntoView(); })()`); await wait(300);
  await shot("1-url-chip");
  if (opt("naver")) {
    const r = await js(`(async () => { const i = document.getElementById("dtUrl"); i.value = ${JSON.stringify(opt("naver"))}; i.dispatchEvent(new Event("input")); document.getElementById("dtUrlGo").click(); for (let k = 0; k < 120; k++) { await new Promise((r) => setTimeout(r, 500)); if (/err|ok/.test(document.getElementById("dtUrlMsg").className)) break; } return { msg: document.getElementById("dtUrlMsg").textContent, vis: !!document.querySelector(".dt-urlvis") }; })()`);
    console.log("  네이버:", JSON.stringify(r)); await shot("2-naver-wall");
  }
  await js(`window.Detail.openInfo(${JSON.stringify(jobId)})`); await wait(1500);
  const st = await js(`({ rights: !document.getElementById("ivRights").hidden, text: document.getElementById("ivRights").innerText, modes: [...document.querySelectorAll("#ivModes [data-mode]")].map((b) => b.dataset.mode) })`);
  console.log("  확인 화면:", JSON.stringify(st));
  await shot("3-info-rights");
  await js(`document.getElementById("ivGo").click()`); await wait(800);
  console.log("  권리 확인 전 생성 →", await js(`document.getElementById("ivErr").innerText`));
  await js(`document.querySelector('#ivRights [data-rights="mine"]').click()`); await wait(600);
  console.log("  내 상품 →", await js(`document.getElementById("ivRights").innerText`), "· info.rightsOk", JSON.parse(fs.readFileSync(path.join(USER, "detail", jobId, "info.json"), "utf8")).rightsOk);
  await shot("4-info-mine");
  app.exit(0);
});
