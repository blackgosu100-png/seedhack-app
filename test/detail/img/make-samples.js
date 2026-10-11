// "중국 상세 이미지" 샘플 생성기 — 오프스크린 BrowserWindow(HTML/CSS)로 그려서 PNG로 저장한다.
// 실행: npx electron test/detail/img/make-samples.js
// 결과: test/detail/fixture/img/g01.png…g03.png, d01.png…d12.png (A1 fixture 이미지를 같은 이름으로 덮어쓴다)
//       test/detail/img/samples.json (각 샘플에 넣은 문장·배경 종류·배경색 — OCR 재현율·지우기 검사용)
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
app.commandLine.appendSwitch("force-device-scale-factor", "1"); // 레티나에서 2배로 찍히지 않게
app.disableHardwareAcceleration();

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "fixture", "img");
const FONT = "'PingFang SC', 'Hiragino Sans GB', 'STHeiti', sans-serif";

// 한 줄 글자: { t:문장, x, y, size, color, weight? }
const line = (t, x, y, size, color = "#222", extra = "") => ({ t, x, y, size, color, extra });

// 샘플 정의. bg: solid | gradient | photo | mixed. texts 는 OCR 재현율 계산용(그림에 실제로 들어간 문장).
const SAMPLES = [
  // ---- 대표 사진(정사각, 글자 없음 또는 사진 위 짧은 글자) ----
  { id: "g01", w: 800, h: 800, bg: "photo", seed: 11, lines: [line("厂家直销", 40, 40, 36, "#fff", "text-shadow:0 2px 6px rgba(0,0,0,.6)")] },
  { id: "g02", w: 800, h: 800, bg: "photo", seed: 23, lines: [] },
  { id: "g03", w: 800, h: 800, bg: "photo", seed: 37, lines: [] },
  // ---- 상세 이미지 ----
  { id: "d01", w: 790, h: 1200, bg: "solid", color: "#ffffff", lines: [
    line("加厚材质 耐用不变形", 60, 80, 48, "#1a1a1a", "font-weight:600"),
    line("大容量 可折叠 轻松收纳", 60, 170, 34, "#444"),
    line("选用优质PP材料 环保无异味", 60, 240, 28, "#666"),
    line("承重可达15kg", 60, 300, 28, "#666"),
    line("家用 宿舍 卫生间 多场景适用", 60, 1080, 30, "#333"),
  ], shapes: [{ x: 120, y: 420, w: 550, h: 560, color: "#d9e4ec", r: 24 }] },
  { id: "d02", w: 790, h: 600, bg: "solid", color: "#f4efe6", lines: [
    line("温馨提示", 60, 60, 44, "#8a4b1f", "font-weight:600"),
    line("由于显示器色差 实物颜色可能略有不同", 60, 150, 28, "#5a4634"),
    line("手工测量 尺寸误差1-2cm属正常现象", 60, 210, 28, "#5a4634"),
    line("请以实物为准 介意者慎拍", 60, 270, 28, "#5a4634"),
  ] },
  { id: "d03", w: 790, h: 1200, bg: "gradient", gradient: "linear-gradient(180deg,#1f3b73 0%,#6fa3d9 100%)", lines: [
    line("产品特点", 60, 70, 46, "#ffffff", "font-weight:600"),
    line("一体成型 结实耐用", 60, 160, 34, "#eef4ff"),
    line("防水防潮 易清洗", 60, 230, 34, "#eef4ff"),
    line("镂空透气 不闷不臭", 60, 300, 34, "#eef4ff"),
    line("提手加固 承重更强", 60, 1080, 32, "#ffffff"),
  ], shapes: [{ x: 160, y: 420, w: 470, h: 560, color: "rgba(255,255,255,.25)", r: 30 }] },
  { id: "d04", w: 790, h: 600, bg: "gradient", gradient: "linear-gradient(90deg,#fde9c9 0%,#f6b26b 100%)", lines: [
    line("多色可选", 60, 60, 46, "#5b2d00", "font-weight:600"),
    line("灰色 米色 蓝色 粉色", 60, 150, 34, "#6b3a0a"),
    line("颜色以实物为准", 60, 480, 28, "#7a4a1a"),
  ], shapes: [{ x: 80, y: 230, w: 140, h: 140, color: "#9aa0a6", r: 70 }, { x: 260, y: 230, w: 140, h: 140, color: "#e8dcc5", r: 70 }, { x: 440, y: 230, w: 140, h: 140, color: "#6fa3d9", r: 70 }, { x: 620, y: 230, w: 140, h: 140, color: "#f4a7b9", r: 70 }] },
  { id: "d05", w: 790, h: 1200, bg: "photo", seed: 5, lines: [
    line("实拍细节展示", 60, 60, 46, "#ffffff", "font-weight:600;text-shadow:0 2px 8px rgba(0,0,0,.7)"),
    line("加粗提手 久提不累", 60, 1080, 34, "#ffffff", "text-shadow:0 2px 8px rgba(0,0,0,.7)"),
  ] },
  { id: "d06", w: 790, h: 600, bg: "photo", seed: 42, lines: [
    line("真材实料 看得见的品质", 60, 60, 40, "#ffffff", "font-weight:600;text-shadow:0 2px 8px rgba(0,0,0,.7)"),
  ] },
  { id: "d07", w: 750, h: 3200, bg: "solid", color: "#ffffff", lines: [
    line("产品尺寸", 50, 80, 46, "#1a1a1a", "font-weight:600"),
    line("产品尺寸 40*30*25cm", 50, 170, 34, "#333"),
    line("折叠后厚度仅5cm", 50, 240, 30, "#555"),
    line("包装清单", 50, 1120, 46, "#1a1a1a", "font-weight:600"),
    line("脏衣篮×1 说明书×1", 50, 1210, 32, "#333"),
    line("注意事项", 50, 2160, 46, "#1a1a1a", "font-weight:600"),
    line("请勿靠近火源 避免暴晒", 50, 2250, 30, "#555"),
    line("请勿放入洗衣机清洗", 50, 2310, 30, "#555"),
    line("儿童请在成人监护下使用", 50, 2370, 30, "#555"),
  ], shapes: [{ x: 100, y: 340, w: 550, h: 700, color: "#e3e8ee", r: 20 }, { x: 100, y: 1320, w: 550, h: 760, color: "#eef1e6", r: 20 }, { x: 100, y: 2480, w: 550, h: 640, color: "#f3e8e8", r: 20 }] },
  { id: "d08", w: 790, h: 1200, bg: "solid", color: "#1c1c1e", lines: [
    line("升级加厚款", 60, 70, 48, "#ffffff", "font-weight:600"),
    line("比普通款厚30%", 60, 160, 34, "#dddddd"),
    line("不易变形 使用寿命更长", 60, 230, 34, "#dddddd"),
    line("支持定制LOGO 欢迎咨询", 60, 1090, 30, "#bbbbbb"),
  ], shapes: [{ x: 140, y: 380, w: 510, h: 600, color: "#2c2c2e", r: 28 }] },
  { id: "d09", w: 790, h: 600, bg: "solid", color: "#eaf6ea", lines: [
    line("包装清单", 60, 60, 44, "#1d5c2a", "font-weight:600"),
    line("本体1个", 60, 160, 32, "#2f5f3a"),
    line("配件包1套", 60, 220, 32, "#2f5f3a"),
    line("合格证1张", 60, 280, 32, "#2f5f3a"),
    line("发货前逐一检查", 60, 480, 28, "#4a6f52"),
  ] },
  { id: "d10", w: 790, h: 1200, bg: "solid", color: "#fff7f0", lines: [
    line("注意事项", 60, 70, 46, "#b23b1f", "font-weight:600"),
    line("本产品为家用 请勿商用", 60, 170, 30, "#5a3a30"),
    line("承重范围内使用 避免超载", 60, 230, 30, "#5a3a30"),
    line("清洗时请使用中性洗涤剂", 60, 290, 30, "#5a3a30"),
    line("长期不用请放置阴凉干燥处", 60, 350, 30, "#5a3a30"),
    line("如有质量问题 七天无理由退换", 60, 1080, 30, "#5a3a30"),
  ], shapes: [{ x: 160, y: 480, w: 470, h: 520, color: "#ffe3d2", r: 24 }] },
  { id: "d11", w: 800, h: 800, bg: "solid", color: "#f2f2f2", lines: [
    line("简约设计", 60, 60, 46, "#222", "font-weight:600"),
    line("百搭各种家居风格", 60, 150, 32, "#555"),
    line("可叠放 不占空间", 60, 700, 32, "#555"),
  ], shapes: [{ x: 200, y: 260, w: 400, h: 400, color: "#cfd8dc", r: 40 }] },
  { id: "d12", w: 790, h: 1200, bg: "mixed", color: "#ffffff", seed: 77, photoRect: { x: 0, y: 500, w: 790, h: 700 }, lines: [
    line("使用场景", 60, 70, 46, "#1a1a1a", "font-weight:600"),
    line("卧室 阳台 浴室 随处可放", 60, 160, 32, "#444"),
    line("实拍图 仅供参考", 60, 1100, 32, "#ffffff", "text-shadow:0 2px 8px rgba(0,0,0,.7)"),
  ] },
];

// 사진 흉내: 알록달록 노이즈 + 도형(캔버스). seed 로 모양을 고정한다.
const photoScript = `
function rnd(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function drawPhoto(canvas, seed){
  const c = canvas.getContext('2d'); const W = canvas.width, H = canvas.height; const r = rnd(seed);
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'hsl(' + (r()*360|0) + ',60%,45%)'); g.addColorStop(1, 'hsl(' + (r()*360|0) + ',70%,30%)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) { c.fillStyle = 'hsla(' + (r()*360|0) + ',' + (50+r()*40|0) + '%,' + (35+r()*45|0) + '%,' + (0.5+r()*0.5) + ')';
    const x = r()*W, y = r()*H, w = 40 + r()*260, h = 40 + r()*260;
    if (r() < 0.5) { c.beginPath(); c.ellipse(x, y, w/2, h/2, r()*3, 0, Math.PI*2); c.fill(); } else { c.fillRect(x, y, w, h); } }
  const img = c.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 90; d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i+1] = Math.max(0, Math.min(255, d[i+1] + n)); d[i+2] = Math.max(0, Math.min(255, d[i+2] + n)); }
  c.putImageData(img, 0, 0);
}`;

function html(s) {
  const lines = s.lines.map((l) => `<div class="t" style="left:${l.x}px;top:${l.y}px;font-size:${l.size}px;color:${l.color};${l.extra || ""}">${l.t}</div>`).join("");
  const shapes = (s.shapes || []).map((r) => `<div class="s" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${r.color};border-radius:${r.r || 0}px"></div>`).join("");
  let bg = "";
  if (s.bg === "solid") bg = `background:${s.color};`;
  else if (s.bg === "gradient") bg = `background:${s.gradient};`;
  else if (s.bg === "mixed") bg = `background:${s.color};`;
  let canvas = "";
  if (s.bg === "photo") canvas = `<canvas id="p" width="${s.w}" height="${s.h}" style="position:absolute;left:0;top:0"></canvas>`;
  if (s.bg === "mixed") { const p = s.photoRect; canvas = `<canvas id="p" width="${p.w}" height="${p.h}" style="position:absolute;left:${p.x}px;top:${p.y}px"></canvas>`; }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${s.w}px;height:${s.h}px;overflow:hidden;${bg}}
    body{position:relative;font-family:${FONT};}
    .t{position:absolute;white-space:nowrap;line-height:1.3;letter-spacing:1px}
    .s{position:absolute}
  </style></head><body>${canvas}${shapes}${lines}
  <script>${photoScript}; const cv = document.getElementById('p'); if (cv) drawPhoto(cv, ${s.seed || 1});
  document.fonts.ready.then(() => { document.body.dataset.ready = '1'; });</script></body></html>`;
}

let win = null; // 창 하나를 재사용(창을 샘플마다 새로 만들면 두 번째 로드부터 ERR_FAILED)
async function render(s) {
  if (!win) win = new BrowserWindow({ show: false, width: s.w, height: s.h, useContentSize: true, frame: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.setContentSize(s.w, s.h);
  const tmp = path.join(app.getPath("userData"), `sample-${s.id}.html`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, html(s));
  await win.loadFile(tmp);
  for (let i = 0; i < 50; i++) { // 글꼴 준비 대기
    const ok = await win.webContents.executeJavaScript("document.body.dataset.ready === '1'");
    if (ok) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 200)); // 마지막 페인트
  let im = await win.webContents.capturePage({ x: 0, y: 0, width: s.w, height: s.h });
  const sz = im.getSize();
  if (sz.width !== s.w || sz.height !== s.h) im = im.resize({ width: s.w, height: s.h, quality: "best" });
  try { fs.unlinkSync(tmp); } catch {}
  return im.toPNG();
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const meta = {};
    for (const s of SAMPLES) {
      const png = await render(s);
      const file = path.join(outDir, `${s.id}.png`);
      fs.writeFileSync(file, png);
      meta[s.id] = { w: s.w, h: s.h, bg: s.bg, color: s.color || null, photoRect: s.photoRect || null, texts: s.lines.map((l) => l.t) };
      console.log(`  ${s.id}.png ${s.w}x${s.h} ${s.bg} 문장 ${s.lines.length}개 (${png.length} bytes)`);
    }
    fs.writeFileSync(path.join(here, "samples.json"), JSON.stringify(meta, null, 2));
    console.log(`OK 샘플 ${SAMPLES.length}장 → ${outDir}, samples.json 기록`);
    if (win) win.destroy();
  } catch (e) {
    console.error("샘플 생성 실패:", e?.stack || e);
    process.exitCode = 1;
  }
  app.quit();
});
