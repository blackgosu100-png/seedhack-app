// 샘플 PagePlan 이미지 생성기 — 빨래바구니 느낌의 도형·그라데이션(글자 없음) 을 오프스크린 창에서 그려 PNG 로 저장
// 실행: npx electron test/detail/fixture/img-plan/make-samples.js  → 같은 폴더에 g01.png d01~d04.png g02.png g03.png s01.png
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { openOffscreen, captureExact, closeWindow } from "../../../../src/main/detail/render.js";

// 바구니 한 개: 둥근 통 + 가로 살 + 손잡이 2개 (+ 빨랫감 더미)
const basket = (x, y, w, h, color, { pile = true, lid = false, rot = 0 } = {}) => `
  <div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg)">
    ${pile ? `<div style="position:absolute;left:${w * .12}px;top:-${h * .14}px;width:${w * .3}px;height:${h * .3}px;border-radius:50%;background:#fff"></div>
    <div style="position:absolute;left:${w * .36}px;top:-${h * .2}px;width:${w * .34}px;height:${h * .34}px;border-radius:50%;background:#e8f0ff"></div>
    <div style="position:absolute;left:${w * .6}px;top:-${h * .12}px;width:${w * .28}px;height:${h * .28}px;border-radius:50%;background:#ffe9d6"></div>` : ""}
    <div style="position:absolute;inset:0;background:${color};clip-path:polygon(0 0,100% 0,92% 100%,8% 100%);border-radius:14px"></div>
    <div style="position:absolute;left:6%;right:6%;top:14%;bottom:8%;background:repeating-linear-gradient(180deg, rgba(0,0,0,.16) 0 ${h * .05}px, transparent ${h * .05}px ${h * .11}px);clip-path:polygon(0 0,100% 0,94% 100%,6% 100%)"></div>
    <div style="position:absolute;left:0;right:0;top:0;height:${h * .12}px;background:rgba(255,255,255,.25);border-radius:14px 14px 0 0"></div>
    <div style="position:absolute;left:${w * .14}px;top:${h * .3}px;width:${w * .14}px;height:${h * .08}px;border-radius:999px;background:rgba(0,0,0,.35)"></div>
    <div style="position:absolute;right:${w * .14}px;top:${h * .3}px;width:${w * .14}px;height:${h * .08}px;border-radius:999px;background:rgba(0,0,0,.35)"></div>
    ${lid ? `<div style="position:absolute;left:-2%;right:-2%;top:-4%;height:${h * .1}px;border-radius:999px;background:#5f6b7a"></div>` : ""}
  </div>`;
const page = (w, h, bg, body) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}body{background:${bg};position:relative;font-family:sans-serif}</style></head><body>${body}</body></html>`;
const GRAY = "linear-gradient(180deg,#9aa5b5,#6b7686)", IVORY = "linear-gradient(180deg,#f3ead8,#d9ccb2)";
const dots = (x, y, w, h) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:18px;background:radial-gradient(circle, rgba(0,0,0,.45) 0 9px, transparent 10px) 0 0/48px 48px, #7d8898"></div>`;
const arrow = (x, y, len, vertical) => vertical
  ? `<div style="position:absolute;left:${x}px;top:${y}px;width:4px;height:${len}px;background:#2b3240"></div><div style="position:absolute;left:${x - 8}px;top:${y}px;width:20px;height:4px;background:#2b3240"></div><div style="position:absolute;left:${x - 8}px;top:${y + len - 4}px;width:20px;height:4px;background:#2b3240"></div>`
  : `<div style="position:absolute;left:${x}px;top:${y}px;width:${len}px;height:4px;background:#2b3240"></div><div style="position:absolute;left:${x}px;top:${y - 8}px;width:4px;height:20px;background:#2b3240"></div><div style="position:absolute;left:${x + len - 4}px;top:${y - 8}px;width:4px;height:20px;background:#2b3240"></div>`;

// 건조대(v2 샘플): 가로 봉 + 양옆 프레임 + A자 다리. 투명 배경이면 누끼 흉내
const rack = (x, y, w, h, { folded = false, color = "#b9c2cc", bar = "#d9dee5", dark = "#6b7686" } = {}) => {
  if (folded) return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${h / 2}px;background:linear-gradient(180deg,${bar},${color} 60%,${dark});box-shadow:inset 0 -6px 0 rgba(0,0,0,.15)"></div>
    <div style="position:absolute;left:${x + 20}px;top:${y + h * .25}px;width:${w - 40}px;height:${h * .18}px;border-radius:999px;background:rgba(255,255,255,.55)"></div>`;
  const bars = []; const n = 7;
  for (let i = 0; i < n; i++) bars.push(`<div style="position:absolute;left:${x + 40}px;top:${y + 30 + i * (h * .42 / (n - 1))}px;width:${w - 80}px;height:14px;border-radius:7px;background:linear-gradient(180deg,${bar},${color})"></div>`);
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:36px;height:${h * .5}px;border-radius:10px;background:linear-gradient(90deg,${color},${dark})"></div>
    <div style="position:absolute;left:${x + w - 36}px;top:${y}px;width:36px;height:${h * .5}px;border-radius:10px;background:linear-gradient(90deg,${dark},${color})"></div>
    ${bars.join("")}
    <div style="position:absolute;left:${x + 10}px;top:${y + h * .48}px;width:24px;height:${h * .52}px;border-radius:8px;background:${dark};transform:rotate(14deg);transform-origin:top center"></div>
    <div style="position:absolute;left:${x + w - 34}px;top:${y + h * .48}px;width:24px;height:${h * .52}px;border-radius:8px;background:${dark};transform:rotate(-14deg);transform-origin:top center"></div>
    <div style="position:absolute;left:${x + 60}px;top:${y + h * .48}px;width:24px;height:${h * .52}px;border-radius:8px;background:${color};transform:rotate(-14deg);transform-origin:top center"></div>
    <div style="position:absolute;left:${x + w - 84}px;top:${y + h * .48}px;width:24px;height:${h * .52}px;border-radius:8px;background:${color};transform:rotate(14deg);transform-origin:top center"></div>
    <div style="position:absolute;left:${x + 120}px;top:${y + 60}px;width:120px;height:160px;border-radius:12px;background:#ffe9d6;opacity:.95"></div>
    <div style="position:absolute;left:${x + 280}px;top:${y + 60}px;width:140px;height:190px;border-radius:12px;background:#e8f0ff;opacity:.95"></div>
    <div style="position:absolute;left:${x + 460}px;top:${y + 60}px;width:110px;height:150px;border-radius:12px;background:#ffffff;opacity:.95"></div>`;
};
const SAMPLES = {
  // v2 누끼(투명 배경): 펼친 건조대 · 접은 건조대 · 작은 컷
  "g01_cut.png": [900, 760, "transparent", rack(80, 60, 740, 640), { transparent: true }],
  "d01_cut.png": [900, 320, "transparent", rack(60, 120, 780, 90, { folded: true }), { transparent: true }],
  "d02_cut.png": [700, 600, "transparent", rack(60, 40, 580, 520), { transparent: true }],
  // v2 사진(배경 있는 건조대)
  "r01.png": [800, 800, "radial-gradient(circle at 50% 30%, #ffffff, #e6ebf1 70%)", rack(70, 120, 660, 580) + `<div style="position:absolute;left:100px;top:700px;width:600px;height:50px;border-radius:50%;background:rgba(0,0,0,.14);filter:blur(12px)"></div>`],
  "r02.png": [790, 1000, "linear-gradient(180deg,#f7f8fa,#dfe4ec)", rack(70, 160, 650, 560) + rack(90, 840, 610, 70, { folded: true })],
  "r03.png": [790, 1000, "linear-gradient(180deg,#eef2f7,#cfd6e0)", `<div style="position:absolute;left:95px;top:120px;width:600px;height:600px;border-radius:50%;background:linear-gradient(180deg,#d9dee5,#9aa5b5);box-shadow:0 30px 60px rgba(0,0,0,.18)"></div><div style="position:absolute;left:215px;top:380px;width:360px;height:40px;border-radius:20px;background:#6b7686"></div><div style="position:absolute;left:215px;top:300px;width:360px;height:40px;border-radius:20px;background:#6b7686"></div>`],
  // 정사각 대표 사진: 밝은 배경 위 회색 바구니 + 빨랫감
  "g01.png": [800, 800, "radial-gradient(circle at 50% 30%, #ffffff, #e9edf3 70%)", basket(160, 260, 480, 400, GRAY) + `<div style="position:absolute;left:120px;top:640px;width:560px;height:60px;border-radius:50%;background:rgba(0,0,0,.12);filter:blur(12px)"></div>`],
  // 상세 1: 접은 모습(납작) vs 펼친 모습
  "d01.png": [790, 1200, "linear-gradient(180deg,#f7f8fa,#dfe4ec)", basket(140, 220, 510, 420, GRAY) + `<div style="position:absolute;left:150px;top:860px;width:490px;height:70px;border-radius:12px;background:${GRAY};clip-path:polygon(0 0,100% 0,96% 100%,4% 100%)"></div><div style="position:absolute;left:150px;top:950px;width:490px;height:30px;border-radius:50%;background:rgba(0,0,0,.14);filter:blur(10px)"></div>`],
  // 상세 2: 손잡이 클로즈업 (큰 원 안에 손잡이 형태)
  "d02.png": [790, 1200, "linear-gradient(180deg,#eef2f7,#cfd6e0)", `<div style="position:absolute;left:95px;top:200px;width:600px;height:600px;border-radius:50%;background:${GRAY};box-shadow:0 30px 60px rgba(0,0,0,.18)"></div><div style="position:absolute;left:235px;top:430px;width:320px;height:120px;border-radius:999px;background:#2f3744"></div><div style="position:absolute;left:265px;top:460px;width:260px;height:60px;border-radius:999px;background:#9aa5b5"></div>` + basket(230, 900, 330, 220, IVORY, { pile: false })],
  // 상세 3: 통풍 구멍 패턴
  "d03.png": [790, 1200, "linear-gradient(180deg,#f8f9fb,#e3e8ef)", dots(95, 180, 600, 520) + basket(180, 820, 430, 300, GRAY, { pile: false })],
  // 상세 4: 두꺼운 소재(단면 층) + 바구니
  "d04.png": [790, 1200, "linear-gradient(180deg,#fdfcf8,#e8e2d2)", `<div style="position:absolute;left:95px;top:160px;width:600px;height:120px;border-radius:20px;background:linear-gradient(180deg,#b5bfcc 0 40px,#7d8898 40px 80px,#4d5665 80px)"></div>` + basket(150, 460, 490, 400, IVORY) + `<div style="position:absolute;left:120px;top:1000px;width:550px;height:50px;border-radius:50%;background:rgba(0,0,0,.12);filter:blur(12px)"></div>`],
  // 갤러리: 색상 2가지
  "g02.png": [800, 800, "radial-gradient(circle at 50% 30%, #ffffff, #efe9dc 70%)", basket(160, 260, 480, 400, IVORY)],
  "g03.png": [800, 800, "radial-gradient(circle at 50% 30%, #ffffff, #e1e7ef 70%)", basket(160, 260, 480, 400, GRAY, { pile: false, lid: true })],
  // 사이즈 표: 바구니 실루엣 + 치수선(글자 없음)
  "s01.png": [790, 1000, "#ffffff", basket(200, 250, 400, 360, GRAY, { pile: false }) + arrow(200, 680, 400, false) + arrow(660, 250, 360, true) + arrow(200, 160, 400, false) + `<div style="position:absolute;left:0;top:0;width:790px;height:1000px;background:repeating-linear-gradient(90deg, rgba(0,0,0,.05) 0 1px, transparent 1px 50px), repeating-linear-gradient(180deg, rgba(0,0,0,.05) 0 1px, transparent 1px 50px)"></div>`],
};

// 주의: ESM 진입 파일에서 top-level `await app.whenReady()` 는 ready 가 영영 오지 않는다(모듈 로딩이 끝나야 ready) → then 으로
app.whenReady().then(async () => {
  const winO = openOffscreen(800, 800), winT = openOffscreen(800, 800, { transparent: true, backgroundColor: "#00000000" }); // 투명 창은 누끼용
  for (const [name, [w, h, bg, body, o]] of Object.entries(SAMPLES)) {
    const win = o && o.transparent ? winT : winO; // eslint-disable-line no-shadow
    win.setContentSize(w, h);
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page(w, h, bg, body)));
    await new Promise((r) => setTimeout(r, 250));
    const img = await captureExact(win, { x: 0, y: 0, width: w, height: h });
    fs.writeFileSync(path.join(__dirname, name), img.toPNG());
    console.log("샘플", name, `${w}x${h}`);
  }
  await closeWindow(winO); await closeWindow(winT);
  console.log("OK 샘플 이미지", Object.keys(SAMPLES).length, "장");
  app.quit();
}).catch((e) => { console.error("실패", e); process.exitCode = 1; app.quit(); });
