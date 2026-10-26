// 🖼 썸네일 탭 화면 확인 — 실제 detail.css + thumb.js 를 가짜 결과 화면(머리줄·렌더 탭·본문)에 올리고,
// thumb:get/update/settings 는 하네스 결과(thumb.json, 임시 복사본)로 답한다 → 탭 누르기·칸 고르기·대표 바꾸기를 해 보며 캡처.
// 실행: npx electron test/detail/thumb-ui.js <작업 폴더/thumb 또는 하네스 결과 폴더> <저장 폴더>
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const here = path.dirname(fileURLToPath(import.meta.url));
const [resDir0, outDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { applyEdit, summarizeSet } = await import("../../src/main/detail/thumb-core.js");
  const resDir = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-ui-")); fs.cpSync(resDir0, resDir, { recursive: true }); // 원본 결과는 건드리지 않는다
  fs.mkdirSync(outDir, { recursive: true });
  let j = JSON.parse(fs.readFileSync(path.join(resDir, "thumb.json"), "utf8"));
  const view = () => ({ ...j, items: j.items.map((x) => ({ ...x, path: path.join(resDir, path.basename(x.file)) })),
    optionMains: (j.optionMains || []).map((o) => ({ ...o, path: o.file && fs.existsSync(path.join(resDir, "options")) ? fs.readdirSync(path.join(resDir, "options")).map((f) => path.join(resDir, "options", f)).find((f) => path.basename(f) === `${o.id}.jpg` || path.basename(f).startsWith(o.id + "-")) || null : null })) });
  ipcMain.handle("thumb:get", () => ({ run: null, result: view() }));
  ipcMain.handle("thumb:settings", () => ({ thumbAuto: true }));
  ipcMain.handle("thumb:update", (_e, p) => { const n = applyEdit(j.items, p); if (n.error) return n; j = { ...j, items: n, edited: Date.now(), summary: summarizeSet(n) }; return { ok: true, result: view() }; });
  const pre = path.join(os.tmpdir(), "thumb-ui-preload.cjs");
  fs.writeFileSync(pre, `const { contextBridge, ipcRenderer } = require("electron"); contextBridge.exposeInMainWorld("signal", { invoke: (c, d) => ipcRenderer.invoke(c, d), on() {} });`);
  const html = path.join(os.tmpdir(), "thumb-ui.html");
  const R = path.join(here, "../../src/renderer");
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${R}/panel.css"><link rel="stylesheet" href="${R}/detail.css"><body style="margin:0;background:#fff">
  <div id="detail" class="detail dt-mresult"><div class="dt-result" id="dtResult" style="padding:0 20px"><div class="dt-rhead"><div class="dt-rline"><span class="dt-rapp">📄</span><b id="drTitle">${j.product}</b><span class="spacer"></span>
  <div class="dt-racts"><button id="drFolder" class="ic pri wide">📂<span>폴더</span></button><button id="drFigma" class="ic">🎨</button><button id="drHtml" class="ic">🌐</button><button id="drTpl" class="ic">↻</button><button id="drExpGo" class="ic wide">⬇<span>내보내기</span></button><button id="drList" class="ic">☰</button></div></div>
  <div class="dt-rtabs" id="drTabs">렌더 탭 자리</div></div><div class="dt-rbody"><div class="dt-slices" id="drSlices" style="height:300px;background:#f3f4f6">상세페이지 미리보기 자리</div></div></div></div>
  <script src="${R}/thumb.js"></script><script>document.getElementById("detail").dataset.job="x";document.getElementById("detail").dispatchEvent(new CustomEvent("dt:result",{detail:{jobId:"x"}}));</script></body>`);
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { preload: pre, sandbox: false, contextIsolation: true } });
  await win.loadFile(html); await wait(500);
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (name) => { await wait(700); fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG()); console.log("saved", name); };
  await shot("1-detail-tab.png");
  await js(`document.querySelector('.th-tabs [data-tab="thumb"]').click()`); await shot("2-thumb-tab.png");
  const bc = await js(`(document.querySelector('.th-slot[data-pick="bcut"]')||{}).dataset?.pick||""`);
  if (bc) { await js(`document.querySelector('.th-slot[data-pick="bcut"]').click()`); await wait(200); await js(`document.querySelector('[data-act="hero"]').click()`); await shot("3-bcut-to-hero.png"); }
  const sc = await js(`(document.querySelector('.th-slot[data-pick="scene"]')||{}).dataset?.pick||""`);
  if (sc) { await js(`document.querySelector('.th-slot[data-pick="scene"]').click()`); await wait(200); await js(`document.querySelector('[data-act="exclude"]').click()`); await shot("4-scene-excluded.png"); }
  await js(`document.querySelector(".th-opts")&&(document.querySelector(".th-opts").open=true);window.scrollTo(0,99999);document.querySelector("#dtThumbView").scrollIntoView({block:"end"})`); await shot("5-options.png");
  const state = await js(`[...document.querySelectorAll(".th-slot[data-pick]")].map(b=>b.dataset.pick+":"+b.querySelector(".no").textContent).join(" | ")`);
  console.log("strip:", state);
  console.log("detail hidden:", await js(`getComputedStyle(document.querySelector(".dt-rbody")).display`), "figma hidden:", await js(`getComputedStyle(document.getElementById("drFigma")).display`));
  app.quit();
});
