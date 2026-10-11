// 📄 fixture 자리표시 그림 만들기:  npx electron test/detail/fixture/make-placeholders.js
// 1688 실제 그림은 쓰지 않는다. 숨은 창의 <canvas> 로 단색/그라데이션 배경 + 간단한 도형을 그려 test/detail/fixture/img/ 에 저장한다.
// 이름은 CONTRACTS 10절대로 g01…g03.png, d01…d12.png — A2 가 나중에 "중국어 글자가 그려진" 진짜 샘플로 같은 이름을 덮어쓴다.
// 덧붙여 내려받기 검증용 extra.webp(webp→png 변환), tiny.png(40x40 아이콘 제외 규칙) 도 만든다.
// 이미 있는 파일(A2 의 진짜 샘플)은 건너뛴다 — 덮어쓰려면 `--force`.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "img");

// [이름, 가로, 세로, 바탕색1, 바탕색2(그라데이션, 없으면 단색), 도형색]
const SPECS = [
  ["g01", 800, 800, "#f3f4f6", null, "#3ddc84"],
  ["g02", 800, 800, "#e0f2fe", "#bae6fd", "#0ea5e9"],
  ["g03", 800, 800, "#fef3c7", null, "#f59e0b"],
  ["d01", 790, 600, "#ffffff", null, "#1f2937"],
  ["d02", 790, 1200, "#f8fafc", "#e2e8f0", "#334155"],
  ["d03", 750, 3200, "#fff7ed", "#ffedd5", "#ea580c"], // 긴 그림 1장
  ["d04", 800, 800, "#ecfdf5", null, "#059669"],
  ["d05", 790, 1000, "#eef2ff", "#e0e7ff", "#4f46e5"],
  ["d06", 790, 700, "#fdf2f8", null, "#db2777"],
  ["d07", 790, 1500, "#f0fdfa", "#ccfbf1", "#0d9488"],
  ["d08", 790, 900, "#fafaf9", null, "#57534e"],
  ["d09", 790, 1100, "#fefce8", "#fef9c3", "#ca8a04"],
  ["d10", 790, 650, "#f5f3ff", null, "#7c3aed"],
  ["d11", 790, 1300, "#fff1f2", "#ffe4e6", "#e11d48"],
  ["d12", 790, 800, "#f1f5f9", null, "#0f172a"],
  ["tiny", 40, 40, "#cccccc", null, "#999999", "png"],
  ["extra", 640, 480, "#dbeafe", "#bfdbfe", "#2563eb", "webp"],
];

const DRAW = `(spec) => {
  const [name, w, h, c1, c2, fg, fmt] = spec;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (c2) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; } else g.fillStyle = c1;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.strokeStyle = fg; g.lineWidth = Math.max(2, Math.round(w / 120));
  const m = Math.round(Math.min(w, h) * 0.12);
  // 도형: 둥근 네모 테두리 + 원 + 세로로 긴 그림은 구간마다 가로줄
  g.strokeRect(m, m, w - 2 * m, Math.min(h, w) - 2 * m);
  g.beginPath(); g.arc(w / 2, Math.min(h, w) / 2, Math.min(w, h) * 0.18, 0, Math.PI * 2); g.fill();
  for (let y = w; y < h - m; y += Math.round(w * 0.9)) { g.fillRect(m, y, w - 2 * m, Math.max(4, Math.round(w / 60))); g.beginPath(); g.arc(w / 2, y + w * 0.4, w * 0.14, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = fg; g.font = "bold " + Math.max(14, Math.round(w / 14)) + "px sans-serif"; g.textAlign = "center";
  g.fillText(name + " " + w + "x" + h, w / 2, h - m / 2); // 자리표시 표시(영문·숫자만)
  return c.toDataURL(fmt === "webp" ? "image/webp" : "image/png", 0.9);
}`;

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL("about:blank");
  const force = process.argv.includes("--force");
  let n = 0, skipped = 0;
  for (const spec of SPECS) {
    const want = path.join(outDir, `${spec[0]}.${spec[6] === "webp" ? "webp" : "png"}`);
    if (!force && fs.existsSync(want)) { skipped++; continue; }
    const dataUrl = await win.webContents.executeJavaScript(`(${DRAW})(${JSON.stringify(spec)})`, true);
    const m = dataUrl.match(/^data:image\/(png|webp);base64,(.+)$/);
    if (!m) { console.log("FAIL", spec[0], dataUrl.slice(0, 40)); process.exitCode = 1; continue; }
    const file = path.join(outDir, `${spec[0]}.${m[1]}`);
    fs.writeFileSync(file, Buffer.from(m[2], "base64"));
    n++;
    console.log(`${path.basename(file)} ${spec[1]}x${spec[2]} ${fs.statSync(file).size}B`);
  }
  console.log(`OK 자리표시 그림 ${n}장 만듦 · ${skipped}장 이미 있어 건너뜀 → ${outDir}`);
  app.quit();
}).catch((e) => { console.error("FAIL", e); process.exitCode = 1; app.quit(); });
