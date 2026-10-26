// 원본 한글화 품질 재생 하네스(v11) — 실제 작업 폴더를 임시로 복사해 (OCR·번역은 재사용) 지우기 → plan → 렌더를 다시 돌리고 전/후를 숫자·비교 시트로 남긴다.
// 원본 작업 폴더는 읽기만 한다(쓰지 않음).
// 실행: npx electron test/detail/localize-replay.js "<작업 폴더>" "<출력 폴더>" [--no-ai] [--model=gemini-3-pro-image] [--only=d01,d04] [--old-only] [--no-ocr]
//   [--tl=cli|rules] 번역 새로 · [--old=<translate-result.json>] 지난 번역 재사용 · [--reuse-erase] 지난 재생 지운 그림 재사용 · [--rerender] 렌더만 · [--conc=N]
//   [--tl-cache=<폴더>] 같은 번역 요청이면 지난 Claude 응답 재사용 · [--udata=<폴더>] 동시 재생용 userData
//   [--re-ocr] OCR 을 지금 코드로 다시(+ 큰 숫자·세로쓰기 보강, --no-ocr-plus 로 끔)(결과는 <출력>/ocr.json 에 두고 다음에 재사용 — 기울기 quad 가 없던 예전 작업용)
//   [--prev=<지난 출력 폴더>] 전 = 지난 재생 슬라이스(after-*.jpg) — localize.json 이 없던 작업(처음 한글화)도 처음부터 재생한다
// 결과: <출력>/compare-NN.jpg(전|후 슬라이스) · erase-<id>.jpg(원본|전|후 지운 그림) · summary.json(after.metrics = 회귀 지표) · 표(콘솔) · 마지막 줄 LOC_REPLAY_OK
import { app, BrowserWindow, nativeImage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const opt = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const BASE = path.join(os.tmpdir(), "seedhack-loc-replay"); // 임시 작업 복사본 자리(재생끼리 이어 씀)
app.setPath("userData", opt("udata") || BASE); // --udata=<폴더>: 여러 작업을 동시에 재생할 때 프로세스마다 다른 userData
app.on("window-all-closed", () => {});
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/electron|localize-replay\.js$/.test(a));
const [JOB, OUT] = pos;
const has = (k) => process.argv.includes(`--${k}`);
const ONLY = (opt("only") || "").split(",").filter(Boolean);
const MODEL = opt("model");
const log = (_l, t) => console.log(t);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// ── 결과 화면(page.html) 측정: 글 상자 겹침 · 글자/바탕 대비 ──
const MEASURE = `(async () => {
  await (document.fonts ? document.fonts.ready : 0);
  await Promise.all([...document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const units = [];
  const add = (el, kind) => { if (el && (el.textContent || "").trim()) units.push({ el, kind }); };
  document.querySelectorAll(".loc-layer").forEach((b) => add(b.querySelector(".loc-text") || b, "layer"));
  document.querySelectorAll(".loc-block .lb-title, .loc-block .lb-sub").forEach((e) => add(e, "block"));
  document.querySelectorAll(".lh-text .lh-label, .lh-text .lh-name, .lh-text .lh-sub, .lh-text .lh-points span, .lh-text .lh-badge").forEach((e) => add(e, "hero"));
  const rectsOf = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return [...rg.getClientRects()].filter((r) => r.width > 2 && r.height > 2).map((r) => ({ l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY })); };
  units.forEach((u) => { u.rects = rectsOf(u.el); u.text = u.el.textContent.trim().slice(0, 24); });
  const overlaps = [];
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const A = units[i], B = units[j]; if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    // v13.2 맞닿음도 겹침으로: 가로로 10px 넘게 겹치고 세로 틈이 1px 미만(빨간 띠 위 두 줄이 붙어 보이던 것 — 슬라이서 d23). 글자 줄 상자는 글자보다 약간 커서 2px 이내 겹침은 붙음으로 센다
    let hit = false; for (const a of A.rects) for (const b of B.rects) { const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t); if ((w > 2 && h > 2) || (w > 10 && h > -1)) hit = true; }
    if (hit) overlaps.push(A.text + " ⨯ " + B.text);
  }
  // 대비: 글자색 vs 바로 아래 그림 픽셀(중앙값 색 · 하위 10% 대비)
  const canv = new Map();
  const pix = (img) => { if (canv.has(img)) return canv.get(img); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext("2d"); x.drawImage(img, 0, 0); let d = null; try { d = x.getImageData(0, 0, c.width, c.height).data; } catch (e) {} const v = { d, w: c.width, h: c.height }; canv.set(img, v); return v; };
  const parse = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s || ""); if (!m) return null; const p = m[1].split(",").map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const con = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const low = []; let measured = 0;
  for (const u of units) {
    const cs = getComputedStyle(u.el), col = parse(cs.color); if (!col || !u.rects.length) continue;
    const fsz = parseFloat(cs.fontSize), wt = Number(cs.fontWeight) || 400, need = fsz >= 24 || (fsz >= 19 && wt >= 700) ? 3 : 4.5;
    let bg = null;
    for (let e = u.el; e && !e.classList?.contains("loc-wrap") && !e.classList?.contains("lh-wrap"); e = e.parentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b && b.a > 0.6) { bg = [b.c]; break; } }
    if (!bg) {
      const wrap = u.el.closest(".loc-wrap, .lh-wrap"), img = wrap && wrap.querySelector("img"); if (!img || !img.naturalWidth) continue;
      const P = pix(img); if (!P.d) continue; const ir = img.getBoundingClientRect(), sx = img.naturalWidth / ir.width, sy = img.naturalHeight / ir.height, ox = ir.left + scrollX, oy = ir.top + scrollY;
      bg = [];
      for (const r of u.rects) for (let y = r.t; y < r.b; y += 3) for (let x = r.l; x < r.r; x += 3) { const X = Math.floor((x - ox) * sx), Y = Math.floor((y - oy) * sy); if (X < 0 || Y < 0 || X >= P.w || Y >= P.h) continue; const i = (Y * P.w + X) * 4; bg.push([P.d[i], P.d[i + 1], P.d[i + 2]]); }
      if (!bg.length) continue;
    }
    measured++;
    const cons = bg.map((b) => con(col.c, b)).sort((a, b) => a - b);
    const median = cons[Math.floor(cons.length / 2)], p10 = cons[Math.floor(cons.length * 0.1)];
    const shadow = cs.textShadow && cs.textShadow !== "none";
    if (median < need) low.push({ text: u.text, median: +median.toFixed(2), p10: +p10.toFixed(2), need, shadow, color: cs.color, size: fsz });
  }
  const rep = document.getElementById("page")?.dataset.locReport || null;
  // v13.2 잘린 글: 글 줄이 자기 그림(.loc-wrap / .lh-wrap) 밖으로 3px 넘게 나가 잘린 것(아래로 밀려 잘리던 것 — 검사가 놓쳤던 경우)
  const clipped = units.filter((u) => { const w = u.el.closest(".loc-wrap, .lh-wrap"); if (!w || !u.rects.length) return false; const r = w.getBoundingClientRect(), R = { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY }; return u.rects.some((q) => q.t < R.t - 3 || q.b > R.b + 3 || q.l < R.l - 3 || q.r > R.r + 3); }).map((u) => u.text);
  // 너무 작은 글(화면 13px 미만) · 장마다 보이는 글 줄의 가운데(원본 px — 빈 장식 검사용)
  const tiny = units.filter((u) => u.rects.length && parseFloat(getComputedStyle(u.el).fontSize) < 13).map((u) => u.text + " " + parseFloat(getComputedStyle(u.el).fontSize).toFixed(1) + "px");
  const wraps = [...document.querySelectorAll(".loc-wrap")].map((w) => { const img = w.querySelector("img"); if (!img || !img.naturalWidth) return null; const ir = img.getBoundingClientRect(), s = img.naturalWidth / ir.width;
    const centers = units.filter((u) => w.contains(u.el) && u.rects.length).map((u) => { const r = u.rects; const l = Math.min(...r.map((q) => q.l)), t = Math.min(...r.map((q) => q.t)), rr = Math.max(...r.map((q) => q.r)), b = Math.max(...r.map((q) => q.b)); return [((l + rr) / 2 - ir.left - scrollX) * s, ((t + b) / 2 - ir.top - scrollY) * s]; });
    return { src: img.dataset.src, centers }; }).filter(Boolean);
  return { units: units.length, measured, overlaps, low, tiny, wraps, clipped, report: rep ? JSON.parse(rep) : null };
})()`;
// baseDir: page.html 의 ../ 상대 경로 기준(렌더 때 out/ 에 쓰고 out/<id>/ 로 옮겨지므로 <base> 로 바로잡는다)
async function measurePage(html, baseDir) {
  if (!fs.existsSync(html)) return null;
  const tmpHtml = path.join(app.getPath("userData"), `measure-${Date.now()}.html`);
  fs.mkdirSync(path.dirname(tmpHtml), { recursive: true });
  // 템플릿 글꼴(제목용 SCDream 등)은 page.html 안에서 템플릿 폴더 기준 상대 주소(url("fonts/…"))라 <base> 를 바꾸면 못 읽어 다른 글꼴로 재게 된다 → 절대 주소로(렌더 때와 같은 글자 폭·줄 높이)
  const fontsUrl = pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), "../../src/renderer/detail-templates/common/fonts/")).href; // base.css 의 url("fonts/…") 기준 폴더
  fs.writeFileSync(tmpHtml, fs.readFileSync(html, "utf8").replace(/url\((["']?)fonts\//g, `url($1${fontsUrl}`).replace(/<head>/i, `<head><base href="${pathToFileURL(path.join(baseDir, "/")).href}">`));
  const win = new BrowserWindow({ show: false, width: 780, height: 1200, webPreferences: { offscreen: true, webSecurity: false, contextIsolation: true, sandbox: true } });
  try { await win.loadFile(tmpHtml); return await win.webContents.executeJavaScript(MEASURE); }
  finally { win.destroy(); }
}

// 비교 시트: 여러 비트맵을 가로로 나란히(각 colW 폭으로 축소)
function sideBySide(bms, colW, out) {
  const gap = 12, hs = bms.map((b) => (b ? Math.round(b.h * (colW / b.w)) : 0)), H = Math.max(...hs) + gap * 2, W = bms.length * (colW + gap) + gap;
  const data = Buffer.alloc(W * H * 4, 40); for (let i = 3; i < data.length; i += 4) data[i] = 255;
  bms.forEach((bm, k) => { if (!bm) return; const sc = colW / bm.w, ox = gap + k * (colW + gap);
    for (let y = 0; y < hs[k]; y++) for (let x = 0; x < colW; x++) { const si = (Math.min(bm.h - 1, Math.floor(y / sc)) * bm.w + Math.min(bm.w - 1, Math.floor(x / sc))) * 4, di = ((gap + y) * W + ox + x) * 4; data[di] = bm.data[si]; data[di + 1] = bm.data[si + 1]; data[di + 2] = bm.data[si + 2]; } });
  fs.writeFileSync(out, nativeImage.createFromBitmap(data, { width: W, height: H }).toJPEG(90));
}

app.whenReady().then(async () => {
  try {
    if (!JOB || !OUT || !fs.existsSync(path.join(JOB, "ocr.json"))) throw new Error("작업 폴더(ocr.json)·출력 폴더가 필요합니다");
    fs.mkdirSync(OUT, { recursive: true });
    const { loadBitmap } = await import("../../src/main/detail/image.js");
    const core = await import("../../src/main/detail/image-core.js");
    const srcJson = readJson(path.join(JOB, "source.json"));
    const rawOf = (id) => { const f = fs.readdirSync(path.join(JOB, "raw")).find((n) => n.replace(/\.\w+$/, "") === id); return f ? path.join(JOB, "raw", f) : null; };
    // OCR: 작업 폴더 것 · --re-ocr 면 지금 코드로 다시 읽음(<출력>/ocr.json 재사용). 기계번역(text_ko)은 예전 OCR 의 같은 글/겹친 상자에서 이어 받는다
    let ocr = readJson(path.join(JOB, "ocr.json"));
    if (has("re-ocr")) {
      const cached = readJson(path.join(OUT, "ocr.json"));
      if (cached) ocr = cached;
      else {
        const { ocrImages } = await import("../../src/main/detail/ocr.js");
        const tr = readJson(path.join(JOB, "translate.json")) || {};
        const r = await ocrImages(ocr.images.map((o) => ({ id: o.id, file: rawOf(o.id) })).filter((x) => x.file), { log: () => {} });
        if (!has("no-ocr-plus")) { const { augmentOcr } = await import("../../src/main/detail/ocr-plus.js"); for (const o of r.images) { const f = rawOf(o.id); if (f) o.boxes = (await augmentOcr({ file: f, boxes: o.boxes || [], log })).boxes; } const { augmentSeams } = await import("../../src/main/detail/ocr-plus.js"); await augmentSeams(r.images.map((o) => ({ id: o.id, file: rawOf(o.id), boxes: o.boxes || (o.boxes = []) })), { log }); } // 앱과 같은 OCR 보강(--no-ocr-plus 로 끔)
        const oldBy = new Map(ocr.images.map((o) => [o.id, o.boxes || []]));
        for (const im of r.images) for (const b of im.boxes || []) { const ob = oldBy.get(im.id) || []; const same = ob.find((o) => o.text === b.text) || ob.find((o) => Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x) > Math.min(o.w, b.w) * 0.5 && Math.min(o.y + o.h, b.y + b.h) - Math.max(o.y, b.y) > Math.min(o.h, b.h) * 0.5); b.text_ko = b.latin ? b.text : tr[String(b.text).trim()] || same?.text_ko || ""; }
        ocr = { provider: r.provider, images: r.images, reOcr: Date.now() };
        fs.writeFileSync(path.join(OUT, "ocr.json"), JSON.stringify(ocr));
      }
    }
    // 예전 한글화(localize.json)가 없는 작업(처음 한글화): 원본 이미지 순서대로 빈 레이어로 시작 → 번역은 --tl 로 새로
    const firstTime = !fs.existsSync(path.join(JOB, "localize.json"));
    const oldLoc = readJson(opt("old") || path.join(JOB, "localize.json")) || { images: (srcJson?.images || ocr.images).map((im) => ({ id: im.id, layers: [] })) }; // --old=<translate-result.json>: 지난 재생 번역을 이어 붙임
    const ids = (oldLoc.images || []).map((x) => x.id).filter((id) => !ONLY.length || ONLY.includes(id));
    const residueOf = (bm, layers) => { // 지운 영역마다 잔상 검사(같은 함수로 전/후 비교)
      const areas = layers.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
      return layers.map((l, k) => { if (l.erased === "kept") return null; const a = core.expandRect(areas[k], 8, bm.w, bm.h); return { id: l.zh, ...core.residueCheck(bm, a, { skip: (x, y) => areas.some((b, j) => j !== k && x >= b.x - 2 && x < b.x + b.w + 2 && y >= b.y - 2 && y < b.y + b.h + 2) }) }; }).filter(Boolean);
    };
    const summary = { job: JOB, model: MODEL || "기본", ai: !has("no-ai"), before: {}, after: {}, images: [] };
    // ── 전: 예전 지운 그림 잔상 + 예전 결과 화면 ──
    const PREV = opt("prev"), prevSum = PREV ? readJson(path.join(PREV, "summary.json")) : null;
    const oldRes = {};
    if (!firstTime && !PREV) for (const id of ids) { const f = path.join(JOB, "localize", `${id}.png`); const im = (oldLoc.images || []).find((x) => x.id === id); if (!fs.existsSync(f) || !im) continue; oldRes[id] = residueOf(loadBitmap(f), im.layers || []); }
    const oldFails = Object.values(oldRes).flat().filter((r) => !r.pass);
    summary.before.residue = { areas: Object.values(oldRes).flat().length, fails: oldFails.length, list: Object.entries(oldRes).flatMap(([id, rs]) => rs.filter((r) => !r.pass).map((r) => `${id} ${r.id} — ${r.why}`)) };
    summary.before.methods = Object.values(oldLoc.images || []).flatMap((x) => x.layers || []).reduce((m, l) => { m[l.erased + "/" + (l.how || "-")] = (m[l.erased + "/" + (l.how || "-")] || 0) + 1; return m; }, {});
    // 예전 한글화 렌더: --render=<id> 또는 result.json 의 마지막 localize 렌더(없으면 out/localize)
    const RID = opt("render") || ((readJson(path.join(JOB, "result.json"))?.renders || []).filter((x) => x.templateId === "localize" && !/commerce|card/.test(x.id)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).at(-1)?.id) || "localize";
    const oldOut = path.join(JOB, "out", RID); summary.oldRender = RID;
    const oldPage = path.join(oldOut, "page.html");
    const mOld = firstTime || PREV ? null : await measurePage(oldPage, path.join(JOB, "out"));
    summary.before.dom = mOld && { units: mOld.units, measured: mOld.measured, overlaps: mOld.overlaps.length, low: mOld.low.length, overlapList: mOld.overlaps, lowList: mOld.low };
    if (prevSum) { summary.before = prevSum.after; summary.oldRender = `prev:${PREV}`; }
    console.log(firstTime && !prevSum ? "전: 예전 한글화 없음(처음 한글화 — 처음부터 재생)" : `전: 지운 영역 ${summary.before.residue?.areas}개 중 잔상 검사 실패 ${summary.before.residue?.fails} · 화면 글 ${summary.before.dom?.units} · 겹침 ${summary.before.dom?.overlaps} · 대비 부족 ${summary.before.dom?.low}`);
    if (has("old-only")) { fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1)); console.log("LOC_REPLAY_OK"); app.exit(0); return; }

    // ── 후: 임시 복사본에서 다시 지우기 → plan → 렌더 ──
    const tmp = path.join(BASE, "detail", path.basename(JOB) + "-v11");
    const RER = has("rerender"); // --rerender: 지난 재생의 지운 그림·plan 을 그대로 두고 렌더·측정만 다시(템플릿만 고쳤을 때)
    const REUSE = has("reuse-erase"); // --reuse-erase: 지난 재생의 지운 그림은 그대로 쓰고 번역·구성·렌더만 다시(번역·규칙만 고쳤을 때 — AI 지우기 비용 0)
    if (!RER && !REUSE) fs.rmSync(tmp, { recursive: true, force: true });
    if (!RER && !REUSE) fs.cpSync(JOB, tmp, { recursive: true, filter: (p) => { const rel = path.relative(JOB, p); return !/^(out|\.render|scene|localize)(\/|$)/.test(rel); } });
    fs.mkdirSync(path.join(tmp, "localize"), { recursive: true });
    const { localizeImage, finishLocalizePlan } = await import("../../src/main/detail/localize.js");
    const { fixLiteral } = await import("../../src/main/detail/localize-core.js");
    const { buildLocalizePlan } = await import("../../src/main/detail/plan-core.js");
    const { renderPlan } = await import("../../src/main/detail/render.js");
    const settings = MODEL ? { geminiImageModel: MODEL, vertexImageModel: MODEL } : {};
    const newImages = [], t0 = Date.now(); let aiCalls = 0, aiOk = 0, aiMs = 0;
    const doIds = (oldLoc.images || []).map((x) => x.id);
    let plan, eraseSec, shapesById = {};
    if (RER) { const st = readJson(path.join(tmp, "replay-state.json")); newImages.push(...st.newImages); summary.images = st.images; aiCalls = st.aiCalls; aiOk = st.aiOk; aiMs = st.aiMs; eraseSec = st.eraseSec; shapesById = st.shapesById || {}; plan = readJson(path.join(tmp, "plan-localize.json")); }
    else {
    const results = {};
    let nextI = 0;
    const st0 = REUSE ? readJson(path.join(tmp, "replay-state.json")) : null;
    if (st0) { summary.images = st0.images; aiCalls = st0.aiCalls; aiOk = st0.aiOk; aiMs = st0.aiMs; for (const im of st0.newImages) if (!ONLY.includes(im.id)) results[im.id] = im; nextI = ONLY.length ? 0 : Infinity; } // --only 와 함께면 그 장만 다시 지움
    const mapTl = (old, rl, boxes) => { const used = new Set(); return rl.map((l) => { const cand = (old.layers || []).map((o, k) => ({ o, k, d: o.zh === l.zh ? Math.abs((o.textBox?.x ?? o.x) - l.textBox.x) + Math.abs((o.textBox?.y ?? o.y) - l.textBox.y) : Infinity })).filter((c) => !used.has(c.k) && c.d < 60).sort((a, b) => a.d - b.d)[0];
        if (!cand) { const mt = (boxes.filter((b) => b.text_ko && b.x >= l.x - 4 && b.y >= l.y - 4 && b.x + b.w <= l.x + l.w + 4 && b.y + b.h <= l.y + l.h + 4).map((b) => b.text_ko).join(" ")); return mt ? { ...l, mt, ko: fixLiteral(l.zh, mt).ko, drop: false } : { ...l, ko: "", drop: true }; } /* 묶음이 바뀐 줄: 기계번역 + 용어집 */ used.add(cand.k); const o = cand.o; const fl = o.drop ? null : fixLiteral(l.zh, o.ko || "", { mt: o.mt }); /* 저장된 번역에도 지금 용어집·직역 규칙(번역 함수가 하는 것과 같게, 비용 0) */ return { ...l, mt: o.mt, icon: o.icon, rewrite_ok: o.rewrite_ok, ko: fl ? fl.ko : o.ko, drop: o.drop || !!fl?.drop, emph: o.emph, natural: o.natural }; }); }; // 번역(ko·강조·뺌)을 예전 결과에서 같은 글(zh)·가까운 상자로 이어 붙인다(--old·예전 localize.json)
    const worker = async () => { for (;;) { if (nextI >= doIds.length) return; const id = doIds[nextI++]; if (!id) return; if (results[id]) continue;
      const old = oldLoc.images.find((x) => x.id === id);
      const file = rawOf(id); if (!file) { results[id] = (old); continue; }
      if (ONLY.length && !ONLY.includes(id) && !st0) { const rel = oldLoc.files?.[id]; if (rel && fs.existsSync(path.join(JOB, rel))) { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.copyFileSync(path.join(JOB, rel), path.join(tmp, rel)); } results[id] = (old); continue; }
      const boxes = ((ocr.images || []).find((x) => x.id === id)?.boxes || []).filter((b) => !b.latin);
      const out = path.join(tmp, "localize", `${id}.png`);
      const t = Date.now();
      const kind = (srcJson?.images || []).find((x) => x.id === id)?.kind || "";
      const r = await localizeImage({ file: path.join(tmp, "raw", path.basename(file)), ocrBoxes: boxes, keepBoxes: ((ocr.images || []).find((x) => x.id === id)?.boxes || []).filter((b) => b.latin), out, imgKind: kind, ai: !has("no-ai") && !/^(gallery|main)$/.test(kind), settings, log }); // index.js 와 같게: 대표 사진은 hero 로 고른 장만 AI(아래)
      if (r.ai.used) { aiCalls += r.ai.billed || 0; aiMs += r.ai.ms; if (r.ai.accepted) aiOk++; } // 청구된(이미지 받은) 횟수만
      // 번역(ko·강조·뺌)은 예전 결과에서 같은 글(zh)·가까운 상자로 이어 붙인다
      const layers = mapTl(old, r.layers, boxes);
      results[id] = ({ ...old, layers });
      summary.images.push({ id, ms: Date.now() - t, ai: r.ai, methods: r.layers.reduce((m, l) => { const k = l.erase?.method || l.erased; m[k] = (m[k] || 0) + 1; return m; }, {}), fails: r.layers.filter((l) => l.erase && !l.erase.residue?.pass).map((l) => `${l.zh} — ${l.erase.residue?.why}`) });
      console.log(`  ${id} ${Date.now() - t}ms ${JSON.stringify(summary.images.at(-1).methods)}${r.ai.used ? ` AI ${r.ai.accepted ? "적용" : "버림"} ${r.ai.ms}ms${r.ai.error ? " " + r.ai.error : ""}` : ""}${summary.images.at(-1).fails.length ? " 잔상 " + summary.images.at(-1).fails.join(" / ") : ""}`);
    } };
    await Promise.all(Array.from({ length: Number(opt("conc")) || 8 }, () => worker())); // index.js 와 같은 동시 8장(--conc=N)
    if (st0 && opt("old")) for (const id of doIds) { const o = oldLoc.images.find((x) => x.id === id), cur = results[id]; if (!o || !cur || (ONLY.length && ONLY.includes(id))) continue; const bx = ((ocr.images || []).find((x) => x.id === id)?.boxes || []).filter((b) => !b.latin); results[id] = { ...o, layers: mapTl(o, cur.layers || [], bx) }; } // 다시 안 지운 장도 지난 번역을 이어 붙임
    doIds.forEach((id) => newImages.push(results[id]));
    eraseSec = st0 ? st0.eraseSec : (Date.now() - t0) / 1000;
    // 지운 그림 원본 보관(localize-erased/): --reuse-erase 때 여기서 되살린 뒤 도형 지우기를 새 번역 기준으로 다시 한다(지난 재생의 도형 지우기가 남지 않게)
    { const ed = path.join(tmp, "localize-erased"); if (st0 && fs.existsSync(ed)) { for (const f of fs.readdirSync(ed)) { const id = f.replace(/\.png$/, ""); if (ONLY.includes(id)) fs.copyFileSync(path.join(tmp, "localize", f), path.join(ed, f)); else fs.copyFileSync(path.join(ed, f), path.join(tmp, "localize", f)); } } /* --only 로 방금 다시 지운 장은 새 것을 보관 */ else { fs.mkdirSync(ed, { recursive: true }); for (const f of fs.readdirSync(path.join(tmp, "localize")).filter((f) => /^[^-]+\.png$/.test(f))) fs.copyFileSync(path.join(tmp, "localize", f), path.join(ed, f)); } }
    if (!st0) fs.writeFileSync(path.join(tmp, "replay-state.json"), JSON.stringify({ newImages, images: summary.images, aiCalls, aiOk, aiMs, eraseSec })); // 번역 전에 한 번 저장(번역에서 죽어도 --reuse-erase 로 이어 감)
    let tl = { ...oldLoc, images: newImages };
    const TL = opt("tl"); // --tl=cli: 번역(translateLayers)을 Claude CLI 로 새로 · --tl=rules: 규칙(기계번역+용어집)으로 새로 · 생략: 예전 번역을 이어 붙임
    if (TL) {
      const { translateLayers } = await import("../../src/main/detail/copy.js");
      const t1 = Date.now();
      const r = await translateLayers({ images: newImages.map((im) => ({ id: im.id, kind: (srcJson?.images || []).find((x) => x.id === im.id)?.kind || "detail", w: (ocr.images || []).find((x) => x.id === im.id)?.w, h: (ocr.images || []).find((x) => x.id === im.id)?.h, layers: (im.layers || []).map((l) => ({ ...l, mt: l.mt || "" })) })), brief: readJson(path.join(JOB, "brief.json")), log, useCli: TL === "cli", aiCache: opt("tl-cache") }); // --tl-cache=<폴더>: 같은 요청이면 지난 AI 응답 재사용(규칙만 고쳤을 때 번역 비용 0)
      tl = { ...oldLoc, ...r, images: r.images.map((x) => ({ ...newImages.find((y) => y.id === x.id), ...x })) };
      fs.writeFileSync(path.join(OUT, "translate-result.json"), JSON.stringify({ ...r, images: r.images.map((x) => ({ ...x, layers: x.layers.map(({ zh, ko, drop, emph, x: lx, y, textBox, promo, rewrite_ok, icon, natural, mt }) => ({ zh, ko, drop, emph, x: lx, y, textBox, rewrite_ok, icon, natural, mt })) })) })); // 다음 재생에서 --old=<이 파일> 로 번역 재사용(비용 0)
      summary.translate = { how: r.how, error: r.error || null, ms: Date.now() - t1, costUsd: r.costUsd, fixes: r.fixes, hero: r.hero };
      { const { eraseShapes } = await import("../../src/main/detail/localize.js"); let ns = 0; for (const x of tl.images) { const sh = (x.layers || []).filter((l) => l.drop && l.shape).map((l) => l.shape); const f = path.join(tmp, "localize", `${x.id}.png`); if (sh.length && !x.promo && fs.existsSync(f)) ns += eraseShapes(f, sh); } summary.shapesErased = ns; } // index.js 와 같게: 뺀 글의 알약·배지 지움
      console.log(`번역 ${r.how} ${((Date.now() - t1) / 1000).toFixed(0)}초${r.error ? " · " + r.error : ""} · 제외 ${r.images.filter((x) => x.promo).map((x) => `${x.id}(${x.promo_kind || "promo"})`).join(" ")}`);
    }
    if (!TL && opt("old")) { const { eraseShapes } = await import("../../src/main/detail/localize.js"); let ns = 0; for (const x of tl.images) { const sh = (x.layers || []).filter((l) => l.drop && l.shape).map((l) => l.shape); const f = path.join(tmp, "localize", `${x.id}.png`); if (sh.length && !x.promo && fs.existsSync(f)) ns += eraseShapes(f, sh); } summary.shapesErased = ns; }
    const src = readJson(path.join(tmp, "source.json"));
    const files = Object.fromEntries(doIds.map((id) => [id, fs.existsSync(path.join(tmp, "localize", `${id}.png`)) ? `localize/${id}.png` : oldLoc.files?.[id]]).filter(([, f]) => f));
    plan = buildLocalizePlan({ source: src, localized: tl, copy: readJson(path.join(tmp, "copy.json")), brief: readJson(path.join(tmp, "brief.json")), cleaned: (() => { const c = readJson(path.join(tmp, "clean.json")); return Array.isArray(c) ? c : c?.images || []; })(), files, vision: readJson(path.join(tmp, "vision.json")), jobId: path.basename(tmp) });
    const oldPlan = readJson(path.join(JOB, "plan-localize.json"));
    const oh = oldPlan?.sections?.find((s) => s.type === "hero"), nh = plan.sections.find((s) => s.type === "hero");
    if (oh && nh && !TL && !opt("old")) Object.assign(nh, { label: oh.label, name: oh.name, sub: oh.sub, name_emph: oh.name_emph, points: oh.points, badges: oh.badges }); // 히어로 문구는 예전 그대로(같은 글로 비교)
    { // hero 대표 사진에 남은 글이 있으면 그 장만 AI 로 다시(index.js 와 같은 규칙)
      const hs = plan.sections.find((x) => x.type === "hero" && x.id), hid = hs?.id, im = newImages.find((x) => x.id === hid);
      const left = (im?.layers || []).some((l) => l.erase && (l.erase.residue?.pass === false || !["solid", "gradient", "clone", "synth", "tiles"].includes(l.erase.method)));
      if (st0?.heroRedo && st0.heroRedo === hid) summary.heroRedo = hid; // 지난 재생에서 이미 다시 지움(localize-erased 에 들어 있음 — AI 비용 다시 안 씀)
      else if (hid && left && !has("no-ai") && hs.image === `localize/${hid}.png`) { const r = await localizeImage({ file: path.join(tmp, "raw", path.basename(rawOf(hid))), ocrBoxes: ((ocr.images || []).find((x) => x.id === hid)?.boxes || []).filter((b) => !b.latin), keepBoxes: ((ocr.images || []).find((x) => x.id === hid)?.boxes || []).filter((b) => b.latin), out: path.join(tmp, "localize", `${hid}.png`), ai: true, settings, log }); if (r.ai.used) { aiCalls += r.ai.calls || 1; aiMs += r.ai.ms; } summary.heroRedo = hid; fs.copyFileSync(path.join(tmp, "localize", `${hid}.png`), path.join(tmp, "localize-erased", `${hid}.png`)); }
    }
    plan = finishLocalizePlan(plan, tmp, { ocr });
    fs.writeFileSync(path.join(tmp, "plan-localize.json"), JSON.stringify(plan, null, 1));
    shapesById = Object.fromEntries((tl.images || []).map((x) => [x.id, (x.layers || []).filter((l) => l.shape).map((l) => l.shape)]));
    fs.writeFileSync(path.join(tmp, "replay-state.json"), JSON.stringify({ newImages, images: summary.images, aiCalls, aiOk, aiMs, eraseSec, heroRedo: summary.heroRedo || null, shapesById }));
    }
    const tr = Date.now();
    const rr = await renderPlan({ plan, jobDir: tmp, templateId: "localize", log: () => {} });
    console.log(`렌더 ${Date.now() - tr}ms · 슬라이스 ${rr.slices.length} · 점검 문제 ${rr.check.issues.length}`);
    const mNew = await measurePage(path.join(tmp, "out", "page.html"), path.join(tmp, "out"));
    summary.after.dom = mNew && { units: mNew.units, measured: mNew.measured, overlaps: mNew.overlaps.length, low: mNew.low.length, overlapList: mNew.overlaps, lowList: mNew.low, report: mNew.report };
    // 새 지운 그림 잔상(같은 함수) + 글자 영역 밖 픽셀 변화
    const newRes = {}, rectEdges = {}; let outsideChanged = 0, outsideMax = 0;
    // 사각형 잔상(새 직선 경계): 지운 영역 네 변을 따라 안(2px 안)·밖(3px 밖) 밝기 차이가 원본보다 뚜렷이 커진 변(길이 60% 이상에서 +8, 중앙값 +10) — 흐린 사각형·잘린 장식이 남은 자리
    const lumA = (b, x, y) => { const i = (y * b.w + x) * 4; return 0.114 * b.data[i] + 0.587 * b.data[i + 1] + 0.299 * b.data[i + 2]; };
    const newEdge = (raw, bm, l, all, keeps = []) => {
      const W = bm.w, H = bm.h, others = [...all.filter((o) => o !== l && o.erased !== "kept"), ...keeps]; // 남기는 영문·숫자(OCR latin) 옆 변도 비교하지 않는다
      const inOther = (x, y) => others.some((o) => x >= o.x - 2 && x < o.x + o.w + 2 && y >= o.y - 2 && y < o.y + o.h + 2);
      const sides = [["위", (t) => [l.x + t, l.y + 2], (t) => [l.x + t, l.y - 3], l.w], ["아래", (t) => [l.x + t, l.y + l.h - 3], (t) => [l.x + t, l.y + l.h + 2], l.w], ["왼쪽", (t) => [l.x + 2, l.y + t], (t) => [l.x - 3, l.y + t], l.h], ["오른쪽", (t) => [l.x + l.w - 3, l.y + t], (t) => [l.x + l.w + 2, l.y + t], l.h]];
      for (const [nm, inn, out, len] of sides) {
        const ds = [];
        for (let t = 2; t < len - 2; t += 2) { const [ix, iy] = inn(t).map(Math.round), [ox, oy] = out(t).map(Math.round); if (ox < 0 || oy < 0 || ox >= W || oy >= H || ix < 0 || iy < 0 || ix >= W || iy >= H || inOther(ox, oy)) continue; ds.push(Math.abs(lumA(bm, ix, iy) - lumA(bm, ox, oy)) - Math.abs(lumA(raw, ix, iy) - lumA(raw, ox, oy))); }
        if (ds.length < 8) continue; ds.sort((a, b) => a - b);
        if (ds[ds.length >> 1] > 10 && ds.filter((d) => d > 8).length / ds.length >= 0.6) return `${nm} 변 +${ds[ds.length >> 1].toFixed(0)}`;
      }
      return null;
    };
    for (const im of newImages) {
      if (ONLY.length && !ONLY.includes(im.id)) continue;
      const f = path.join(tmp, "localize", `${im.id}.png`); if (!fs.existsSync(f)) continue;
      const bm = loadBitmap(f); newRes[im.id] = residueOf(bm, im.layers || []);
      const raw = loadBitmap(rawOf(im.id));
      rectEdges[im.id] = (im.layers || []).filter((l) => l.erased !== "kept").map((l) => { const e = newEdge(raw, bm, l, im.layers, ((ocr.images || []).find((x) => x.id === im.id)?.boxes || []).filter((b) => b.latin)); return e ? `${l.zh} ${e}` : null; }).filter(Boolean);
      const areas = (im.layers || []).map((l) => ({ x: l.x - 4, y: l.y - 4, w: l.w + 8, h: l.h + 8 }));
      for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) { if (areas.some((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h)) continue; const i = (y * bm.w + x) * 4, d = Math.max(Math.abs(bm.data[i] - raw.data[i]), Math.abs(bm.data[i + 1] - raw.data[i + 1]), Math.abs(bm.data[i + 2] - raw.data[i + 2])); if (d > 3) outsideChanged++; outsideMax = Math.max(outsideMax, d); }
      const oldF = path.join(JOB, "localize", `${im.id}.png`);
      sideBySide([raw, fs.existsSync(oldF) ? loadBitmap(oldF) : null, bm], 520, path.join(OUT, `erase-${im.id}.jpg`));
    }
    const newFails = Object.values(newRes).flat().filter((r) => !r.pass);
    summary.after.residue = { areas: Object.values(newRes).flat().length, fails: newFails.length, list: Object.entries(newRes).flatMap(([id, rs]) => rs.filter((r) => !r.pass).map((r) => `${id} ${r.id} — ${r.why}`)) };
    summary.after.methods = newImages.filter((im) => !ONLY.length || ONLY.includes(im.id)).flatMap((x) => x.layers || []).reduce((m, l) => { const k = l.erase?.method || l.erased; m[k] = (m[k] || 0) + 1; return m; }, {});
    summary.after.outsidePixelsChanged = outsideChanged; summary.after.outsideMaxDiff = outsideMax;
    summary.after.ai = { calls: aiCalls, accepted: aiOk, ms: aiMs, usd: +(aiCalls * (/pro/.test(MODEL || "") ? 0.134 : 0.039)).toFixed(3) };
    summary.after.eraseSec = +eraseSec.toFixed(1);
    // 슬라이스 전|후 시트
    const oldDir = PREV || oldOut, oldSl = !fs.existsSync(oldDir) ? [] : PREV ? fs.readdirSync(PREV).filter((f) => /^after-\d+\.jpg$/.test(f)).sort() : fs.readdirSync(oldOut).filter((f) => /^\d+\.jpg$/.test(f)).sort();
    for (const f of fs.readdirSync(OUT).filter((f) => /^(after|compare)-\d+\.jpg$/.test(f))) fs.rmSync(path.join(OUT, f)); // 지난 재생 슬라이스가 섞이지 않게
    const newSl = fs.readdirSync(path.join(tmp, "out")).filter((f) => /^\d+\.jpg$/.test(f)).sort();
    for (let i = 0; i < Math.max(oldSl.length, newSl.length); i++) sideBySide([oldSl[i] ? loadBitmap(path.join(oldDir, oldSl[i])) : null, newSl[i] ? loadBitmap(path.join(tmp, "out", newSl[i])) : null], 780, path.join(OUT, `compare-${String(i + 1).padStart(2, "0")}.jpg`));
    for (const f of newSl) fs.copyFileSync(path.join(tmp, "out", f), path.join(OUT, `after-${f}`));
    // 남은 중국어(완성 슬라이스 OCR)
    if (!has("no-ocr")) {
      const { ocrImages } = await import("../../src/main/detail/ocr.js");
      // 중국어 OCR 이 한글을 한자로 잘못 읽는 일이 많다(卧仝呇仝州 …) → 같은 슬라이스를 한국어로도 읽어, 그 자리가 한글로 읽히면 뺀다
      const cnt = async (dir, list) => { const files = list.map((f) => ({ id: f, file: path.join(dir, f) })), r = await ocrImages(files, { provider: "vision", log: () => {} }), rk = await ocrImages(files, { provider: "vision", langs: "ko-KR,en-US", log: () => {} });
        return r.images.flatMap((x) => { const kb = (rk.images.find((y) => y.id === x.id)?.boxes || []).filter((b) => /[가-힣]/.test(b.text)); return (x.boxes || []).filter((b) => core.hasCJK(b.text) && !core.isNumberText(b.text) && core.cjkRatio(b.text) > 0.5 && /[一-鿿]/.test(b.text) && !/[가-힣]/.test(b.text) && !core.isIconGuess(b) /* 한 글자·낮은 확신 = 아이콘 오인식(앱 규칙과 같게) */ && !kb.some((k) => Math.min(k.x + k.w, b.x + b.w) - Math.max(k.x, b.x) > Math.min(k.w, b.w) * 0.4 && Math.min(k.y + k.h, b.y + b.h) - Math.max(k.y, b.y) > Math.min(k.h, b.h) * 0.4)).map((b) => `${x.id}:${b.text}`); }); };
      if (!PREV && oldSl.length) summary.before.chinese = await cnt(oldOut, oldSl);
      summary.after.chinese = await cnt(path.join(tmp, "out"), newSl);
    }
    // ── 회귀 지표(페이지에 실제로 들어가는 장만) ──
    {
      const { LITERAL_RE } = await import("../../src/main/detail/localize-core.js");
      const pageIds = new Set(plan.sections.filter((x) => x.id && String(x.image || "").startsWith(`localize/${x.id}`)).map((x) => x.id));
      const rectPage = Object.entries(rectEdges).filter(([id]) => pageIds.has(id)).flatMap(([id, rs]) => rs.map((r) => `${id} ${r}`));
      const resPage = Object.entries(newRes).filter(([id]) => pageIds.has(id)).flatMap(([id, rs]) => rs.filter((r) => !r.pass).map((r) => `${id} ${r.id} — ${r.why}`));
      const texts = plan.sections.flatMap((x) => [...(x.layers || []).map((l) => ({ id: x.id, t: l.ko })), ...(x.type === "hero" ? [x.name, x.sub, x.label].filter(Boolean).map((t) => ({ id: "hero", t })) : [])]);
      const literal = texts.filter((x) => LITERAL_RE.test(String(x.t || "")) || /[一-鿿]/.test(String(x.t || ""))).map((x) => `${x.id}: ${x.t}`);
      // 빈 장식: 글이 들어 있던 도형(알약·원·띠)인데 화면에 그 안 글이 하나도 없고, 지운 그림에 도형 색이 그대로 남은 것
      const emptyDeco = [];
      const iou = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w <= 0 || h <= 0 ? 0 : (w * h) / Math.min(a.w * a.h, b.w * b.h); };
      for (const sec of plan.sections.filter((x) => x.type === "image" && pageIds.has(x.id))) {
        const shs = []; for (const sh of shapesById[sec.id] || []) if (!shs.some((q) => iou(q, sh) > 0.7)) shs.push(sh);
        if (!shs.length) continue;
        const wr = (mNew?.wraps || []).find((w) => w.src === sec.image), cs = wr?.centers || [];
        const keepC = [...(sec.keep || []), ...(newImages.find((x) => x.id === sec.id)?.layers || []).filter((l) => l.role === "number")].map((k) => [k.x + k.w / 2, k.y + k.h / 2]);
        const bm = loadBitmap(path.join(tmp, sec.image));
        for (const sh of shs) {
          const inside = ([x, y]) => x > sh.x && x < sh.x + sh.w && y > sh.y && y < sh.y + sh.h;
          if (cs.some(inside) || keepC.some(inside)) continue;
          const m = /^#?([0-9a-f]{6})$/i.exec(sh.color || ""); if (!m) continue; const v = parseInt(m[1], 16), c = [v >> 16 & 255, v >> 8 & 255, v & 255];
          let n = 0, hit = 0; for (let y = Math.round(sh.y + sh.h * 0.3); y < sh.y + sh.h * 0.7; y += 2) for (let x = Math.round(sh.x + sh.w * 0.3); x < sh.x + sh.w * 0.7; x += 2) { if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) continue; const i = (y * bm.w + x) * 4; n++; if (Math.abs(bm.data[i + 2] - c[0]) + Math.abs(bm.data[i + 1] - c[1]) + Math.abs(bm.data[i] - c[2]) < 90) hit++; }
          // 도형 색이 둘레 바탕과 같으면(칸 = 바탕) 장식이 아니다
          let rn = 0, rh = 0; for (let x = Math.round(sh.x - 6); x < sh.x + sh.w + 6; x += 3) for (const y of [Math.round(sh.y - 6), Math.round(sh.y + sh.h + 6)]) { if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) continue; const i = (y * bm.w + x) * 4; rn++; if (Math.abs(bm.data[i + 2] - c[0]) + Math.abs(bm.data[i + 1] - c[1]) + Math.abs(bm.data[i] - c[2]) < 60) rh++; }
          if (n && hit / n >= 0.6 && !(rn && rh / rn > 0.6)) emptyDeco.push(`${sec.id} ${sh.circle ? "원" : sh.round ? "알약" : "칸"} ${Math.round(sh.x)},${Math.round(sh.y)} ${Math.round(sh.w)}×${Math.round(sh.h)}`);
        }
      }
      const rp = mNew?.report || {};
      summary.after.metrics = {
        pages: pageIds.size, overlaps: mNew?.overlaps.length ?? null, clipped: mNew?.clipped?.length ?? null, shapeOverflow: rp.shapeOverflow ?? null, roleDev: rp.roleDev ?? null, colDev: rp.colDev ?? null,
        rectEdge: rectPage.length, residueFail: resPage.length, residueAreas: Object.entries(newRes).filter(([id]) => pageIds.has(id)).flatMap(([, rs]) => rs).length, chinese: summary.after.chinese?.length ?? null, lowContrast: mNew ? mNew.low.filter((x) => x.median < 1.8).length : null, lowWcag: mNew?.low.length ?? null, // 원본 글자색 유지(주황 띠 흰 글 ≈ 2.2:1)가 규칙이라 기준은 "읽기 힘듦"(1.8:1 미만), WCAG 3·4.5 미달 수는 참고
        inkChanged: rp.inkChanged ?? null, tiny: mNew?.tiny.length ?? null, smallDropped: plan.smallDropped ?? null, emptyDeco: emptyDeco.length, literal: literal.length,
        excluded: (plan.excluded || []).map((x) => `${x.id} ${x.kind || ""} ${x.why}`.trim()),
        lists: { overlaps: mNew?.overlaps || [], clipped: mNew?.clipped || [], rectEdge: rectPage, residue: resPage, chinese: summary.after.chinese || [], low: mNew?.low || [], tiny: mNew?.tiny || [], emptyDeco, literal },
      };
    }
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
    const B = summary.before, A = summary.after;
    console.log(`\n| 항목 | 전 | 후 |\n|---|---|---|`);
    console.log(`| 잔상 검사 실패(지운 영역) | ${B.residue ? `${B.residue.fails}/${B.residue.areas}` : "-"} | ${A.residue.fails}/${A.residue.areas} |`);
    console.log(`| 글 겹침(화면) | ${B.dom?.overlaps ?? "-"} | ${A.dom?.overlaps ?? "-"} |`);
    console.log(`| 대비 부족(화면) | ${B.dom?.low ?? "-"} | ${A.dom?.low ?? "-"} |`);
    console.log(`| 남은 중국어(OCR) | ${B.chinese?.length ?? "-"} | ${A.chinese?.length ?? "-"} |`);
    console.log(`지우기 방식(후): ${JSON.stringify(A.methods)} · AI ${A.ai.calls}회(적용 ${A.ai.accepted}) ${(A.ai.ms / 1000).toFixed(0)}초 ≈ $${A.ai.usd} · 지우기 전체 ${A.eraseSec}초 · 글자 영역 밖 바뀐 픽셀 ${outsideChanged}(최대 ${outsideMax})`);
    { const M = A.metrics; console.log(`지표(페이지 ${M.pages}장): 겹침 ${M.overlaps} · 도형 밖 ${M.shapeOverflow} · 같은 역할 크기 편차 ${M.roleDev}% · 열 정렬 편차 ${M.colDev}px · 사각형 잔상 ${M.rectEdge} · 잔상 검사 ${M.residueFail}/${M.residueAreas} · 한자 ${M.chinese} · 대비 부족 ${M.lowContrast} · 작은 글 ${M.tiny} · 빈 장식 ${M.emptyDeco} · 직역 ${M.literal} · 제외 ${M.excluded.length}`); }
    console.log(`결과 → ${OUT}\n임시 작업 → ${tmp}`);
    console.log("LOC_REPLAY_OK");
    app.exit(0);
  } catch (e) { console.error("LOC_REPLAY_FAIL", e?.stack || e); app.exit(1); }
});
