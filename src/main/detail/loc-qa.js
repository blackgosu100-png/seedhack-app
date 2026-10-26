// 원본 한글화 앱 내 자동 검수·수정(결과를 먼저 보여 준 뒤 뒤에서) — 대표님 조건: 수강생이 기다리는 시간이 늘지 않게, 시간·비용 상한
//  ① 측정: 렌더 결과 page.html 을 숨은 창에 열어 장(이미지 섹션)마다 글 겹침 · 도형 밖 넘침 · 같은 역할 크기 편차 · 열 정렬 편차 · 대비 부족(테두리 글 고려)
//     + 지운 그림 잔상 검사 결과 · 장 캡처 OCR 로 남은 한자 · 직역 · 빈 장식 + AI 비전(haiku, 장 묶음 동시)
//  ② 고치기(걸린 장만, 최대 2회): plan 고치기(크기 맞춤·열 맞춤·줄이기·테두리) / 다시 지우기(localizeImage) / 문구 다시 쓰기(haiku) → 다시 그리기 → 다시 측정
//  ③ 결과: 장별 { pass, issues[], tries, fixed } — 부르는 쪽(index.js)이 result.json·localize.json 에 적는다
// 판정·고치기 계획은 loc-qa-core.js(순수). 지우기·배치 규칙(localize.js·template.js)은 호출만 한다.
import { BrowserWindow, nativeImage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { LITERAL_RE } from "./localize-core.js";
import { LIMITS, AI_KINDS, judgeSection, fixPlan, rewriteTargets, realChinese, literalOf, headline, summarize, norm } from "./loc-qa-core.js";

const noop = () => {};
// 시간 상한: ms 안에 끝나면 결과, 아니면 null(뒤에서 계속 돌아도 결과는 버린다)
const within = (p, ms) => ms <= 0 ? (p.catch(() => {}), Promise.resolve(null)) : Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 화면 측정(장별) — 결과 page.html 을 그대로 연다(템플릿을 다시 돌리지 않음) ──
const MEASURE = (keepBySrc, shapesBySrc) => `(async () => {
  await (document.fonts ? document.fonts.ready : 0);
  await Promise.all([...document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const KEEP = ${JSON.stringify(keepBySrc)}, SHAPES = ${JSON.stringify(shapesBySrc)};
  const nz = (t) => String(t || "").replace(/[\\s\\u200b\\u00ad]+/g, "");
  const vis = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === "none" || cs.visibility === "hidden") return false; } return true; };
  const rectsOf = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return [...rg.getClientRects()].filter((r) => r.width > 2 && r.height > 2); };
  const parse = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s || ""); if (!m) return null; const p = m[1].split(",").map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const con = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const canv = new Map();
  const pix = (img) => { if (canv.has(img)) return canv.get(img); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext("2d"); x.drawImage(img, 0, 0); let d = null; try { d = x.getImageData(0, 0, c.width, c.height).data; } catch (e) {} const v = { d, w: c.width, h: c.height }; canv.set(img, v); return v; };
  const hitR = (a, b, m = 2) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > m && Math.min(a.b, b.b) - Math.max(a.t, b.t) > m;
  const out = [];
  for (const wrap of document.querySelectorAll(".loc-wrap, .lh-wrap")) {
    const hero = wrap.classList.contains("lh-wrap"), img = wrap.querySelector("img"), W = wrap.getBoundingClientRect();
    const src = img ? img.dataset.src || "" : "", sc = img && img.naturalWidth ? W.width / img.naturalWidth : 1;
    const units = [];
    const add = (el, box) => { if (!el || !(el.textContent || "").trim() || !vis(el)) return; const rs = rectsOf(el).map((r) => ({ l: r.left - W.left, t: r.top - W.top, r: r.right - W.left, b: r.bottom - W.top })); if (rs.length) units.push({ el, box, rs, text: el.textContent.replace(/\\s+/g, " ").trim() }); };
    if (hero) wrap.querySelectorAll(".lh-label, .lh-name, .lh-sub, .lh-points span, .lh-badge").forEach((e) => add(e, null));
    else { wrap.querySelectorAll(":scope > .loc-layer").forEach((b) => add(b.querySelector(".loc-text") || b, b)); wrap.querySelectorAll(".loc-block .lb-title, .loc-block .lb-sub").forEach((e) => add(e, null)); }
    // 겹침: 글끼리 + 그림에 남긴 숫자·영문(작은 쪽 넓이 20% 넘게)
    const overlaps = [];
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) { const A = units[i], B = units[j]; if (A.el.contains(B.el) || B.el.contains(A.el)) continue; if (A.rs.some((a) => B.rs.some((b) => hitR(a, b)))) overlaps.push([A.text, B.text]); }
    const keep = hero ? [] : (KEEP[src] || []).map((k) => ({ l: k.x * sc, t: k.y * sc, r: (k.x + k.w) * sc, b: (k.y + k.h) * sc }));
    for (const u of units) for (const k of keep) { const hitK = u.rs.some((a) => { const w = Math.min(a.r, k.r) - Math.max(a.l, k.l), h = Math.min(a.b, k.b) - Math.max(a.t, k.t); return w > 4 && h > 4 && w * h > 0.2 * Math.min((a.r - a.l) * (a.b - a.t), (k.r - k.l) * (k.b - k.t)); }); if (hitK) { overlaps.push([u.text, "그림 속 숫자·영문"]); break; } }
    // 도형 밖 넘침: 템플릿 표시(data-overflow) + plan 의 도형(원본 px)과 직접 비교(원 = 타원 안) + 그림 밖으로 잘림
    const overflow = [];
    const shapes = hero ? [] : (SHAPES[src] || []);
    for (const u of units) {
      if (u.box && u.box.dataset.overflow === "1") { overflow.push(u.text); continue; }
      const sh = shapes.find((s) => s.texts.includes(nz(u.text)));
      if (sh) { const L = sh.x * sc, T = sh.y * sc, R = (sh.x + sh.w) * sc, B = (sh.y + sh.h) * sc, cx = (L + R) / 2, cy = (T + B) / 2, rx = (R - L) / 2, ry = (B - T) / 2;
        const outR = u.rs.some((r) => r.l < L - 3 || r.r > R + 3 || r.t < T - 3 || r.b > B + 3);
        const outC = sh.circle && u.rs.some((r) => [[r.l, r.t], [r.r, r.t], [r.l, r.b], [r.r, r.b]].some(([x, y]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.12));
        if (outR || outC) { overflow.push(u.text); continue; } }
      if (u.rs.some((r) => r.l < -2 || r.r > W.width + 2 || r.t < -2 || r.b > W.height + 2)) overflow.push(u.text);
    }
    // 같은 역할 크기 편차: 같은 역할·원래 높이(min-height) ±12% 줄끼리 글자 크기 비
    let roleDev = { pct: 0 }, colDev = { px: 0 };
    const lay = units.filter((u) => u.box && !u.box.dataset.shape && !/rotate/.test(u.box.style.transform || ""));
    for (const a of lay) for (const b of lay) { if (a === b || a.box.dataset.role !== b.box.dataset.role) continue; const ha = parseFloat(a.box.style.minHeight) || 0, hb = parseFloat(b.box.style.minHeight) || 0; if (!ha || !hb || Math.abs(ha - hb) > Math.max(ha, hb) * 0.12) continue; const p = Math.round((parseFloat(getComputedStyle(a.box).fontSize) / parseFloat(getComputedStyle(b.box).fontSize) - 1) * 100); if (p > roleDev.pct) roleDev = { pct: p, a: a.text, b: b.text }; }
    // 열 정렬 편차: 왼쪽 정렬 줄 중 가로로 50% 넘게 겹치고 왼쪽 끝이 24px 안이며 위아래로 가까운(3줄 안) 줄끼리 글 왼쪽 끝 차이
    const left = lay.filter((u) => u.box.style.justifyContent === "flex-start");
    const bb = (u) => ({ l: Math.min(...u.rs.map((r) => r.l)), r: Math.max(...u.rs.map((r) => r.r)), t: Math.min(...u.rs.map((r) => r.t)), b: Math.max(...u.rs.map((r) => r.b)) });
    for (const a of left) for (const b of left) { if (a === b) continue; const A = bb(a), B = bb(b), ov = Math.min(A.r, B.r) - Math.max(A.l, B.l), h = Math.max(A.b - A.t, B.b - B.t); if (ov < Math.min(A.r - A.l, B.r - B.l) * 0.5 || Math.abs(A.l - B.l) > 24 || Math.max(A.t, B.t) - Math.min(A.b, B.b) > h * 3) continue; const d = Math.round(Math.abs(A.l - B.l)); if (d > colDev.px) colDev = { px: d, a: a.text, b: b.text }; }
    // 대비: 글자색 vs 바로 밑 그림 픽셀(중앙값) · 테두리/그림자 글은 따로 표시
    const low = [];
    for (const u of units) {
      const cs = getComputedStyle(u.el), col = parse(cs.color); if (!col) continue;
      const fsz = parseFloat(cs.fontSize), wt = Number(cs.fontWeight) || 400, need = fsz >= 24 || (fsz >= 19 && wt >= 700) ? 3 : 4.5;
      let bg = null, own = false;
      for (let e = u.el; e && e !== wrap; e = e.parentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b && b.a > 0.6) { bg = [b.c]; own = true; break; } }
      if (!bg) { if (!img || !img.naturalWidth) continue; const P = pix(img); if (!P.d) continue; const ir = img.getBoundingClientRect(), sx = img.naturalWidth / ir.width, sy = img.naturalHeight / ir.height; bg = [];
        for (const r of u.rs) for (let y = r.t; y < r.b; y += 3) for (let x = r.l; x < r.r; x += 3) { const X = Math.floor((x + W.left - ir.left) * sx), Y = Math.floor((y + W.top - ir.top) * sy); if (X < 0 || Y < 0 || X >= P.w || Y >= P.h) continue; const i = (Y * P.w + X) * 4; bg.push([P.d[i], P.d[i + 1], P.d[i + 2]]); }
        if (!bg.length) continue; }
      const cons = bg.map((b) => con(col.c, b)).sort((a, b) => a - b), median = cons[Math.floor(cons.length / 2)];
      let shadow = false; for (let e = u.el; e && e !== wrap; e = e.parentElement) { const ts = getComputedStyle(e).textShadow; if (ts && ts !== "none") { shadow = true; break; } }
      if (median < need) low.push({ text: u.text.slice(0, 40), median: +median.toFixed(2), need, shadow, own, color: col.c });
    }
    out.push({ src, hero, top: Math.round(W.top + scrollY), height: Math.round(W.height), width: Math.round(W.width), iw: img ? img.naturalWidth : 0,
      units: units.map((u) => ({ text: u.text.slice(0, 40), rs: u.rs.map((r) => ({ x: Math.round(r.l), y: Math.round(r.t), w: Math.round(r.r - r.l), h: Math.round(r.b - r.t) })) })),
      overlaps, overflow, roleDev, colDev, low });
  }
  return out;
})()`;

// 장 → plan 섹션 id
function secIdOf(plan, wrap) {
  if (wrap.hero) return (plan.sections || []).find((x) => x.type === "hero")?.id || "hero";
  return (plan.sections || []).find((x) => x.type === "image" && String(x.image || "") === wrap.src)?.id || null;
}

/**
 * page.html 측정 + (only 의 장만) 캡처 → { wraps:[{ id, ...측정 }], shots:{ id: file } }
 * page.html 의 이미지 주소는 out/ 기준(../localize/…) → <base> 로 바로잡는다(재생 하네스와 같음)
 */
export async function measurePage({ dir, renderDir, plan, shotDir = null, only = null, width = 780 }) {
  const html = path.join(dir, renderDir, "page.html");
  if (!fs.existsSync(html)) throw new Error("page.html 없음");
  const keepBySrc = {}, shapesBySrc = {};
  for (const s of plan.sections || []) {
    if (s.type !== "image" || !s.image) continue;
    keepBySrc[s.image] = [...(s.keep || []), ...(s.layers || []).filter((l) => ["number", "dims"].includes(l.role))].filter((k) => isFinite(k.x) && isFinite(k.y)).map((k) => ({ x: k.x, y: k.y, w: k.w, h: k.h }));
    const G = [];
    for (const l of s.layers || []) { if (l.drop || !l.shape || !String(l.ko || "").trim()) continue; const g = G.find((q) => Math.abs(q.x - l.shape.x) < 8 && Math.abs(q.y - l.shape.y) < 8); if (g) g.texts.push(norm(l.ko)); else G.push({ ...l.shape, texts: [norm(l.ko)] }); }
    shapesBySrc[s.image] = G;
  }
  const tmp = path.join(os.tmpdir(), `seedhack-locqa-${process.pid}-${Date.now()}.html`);
  const commonFonts = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../renderer/detail-templates/common/fonts/")).href;
  fs.writeFileSync(tmp, fs.readFileSync(html, "utf8")
    .replace(/url\((["']?)fonts\//g, (m, q) => `url(${q}${commonFonts}`) // base.css 의 제목 글꼴(SCDream)은 템플릿 폴더 기준 상대 경로 — <base> 를 바꾸면 대체 글꼴로 재서 줄 높이·폭이 틀린다
    .replace(/<head>/i, `<head><base href="${pathToFileURL(path.join(dir, "out", "/")).href}">`));
  const win = new BrowserWindow({ show: false, width, height: 1200, useContentSize: true, enableLargerThanScreen: true, frame: false, webPreferences: { offscreen: true, webSecurity: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(10);
  try {
    await win.loadFile(tmp);
    const raw = await win.webContents.executeJavaScript(MEASURE(keepBySrc, shapesBySrc));
    const wraps = raw.map((w) => ({ ...w, id: secIdOf(plan, w) })).filter((w) => w.id);
    const shots = {}, aiShots = {};
    if (shotDir) {
      fs.mkdirSync(shotDir, { recursive: true });
      for (const w of wraps) {
        if (only && !only.has(w.id)) continue;
        const h = Math.max(40, Math.min(3000, w.height));
        win.setContentSize(width, h);
        await win.webContents.executeJavaScript(`(async () => { window.scrollTo(0, ${w.top}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
        await new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; win.webContents.removeListener("paint", fin); res(); } }; win.webContents.once("paint", fin); setTimeout(fin, 400); });
        await wait(60);
        let im = await win.webContents.capturePage({ x: 0, y: 0, width, height: h });
        const sz = im.getSize(); if (sz.width && sz.width !== width) im = im.resize({ width, height: h, quality: "best" });
        const f = path.join(shotDir, `${w.id}.jpg`); fs.writeFileSync(f, im.toJPEG(82)); shots[w.id] = f;
        const fa = path.join(shotDir, `${w.id}.ai.jpg`); fs.writeFileSync(fa, im.resize({ width: 520, quality: "good" }).toJPEG(78)); aiShots[w.id] = fa; // AI 비전용(작게 — 비용)
      }
    }
    return { wraps, shots, aiShots };
  } finally { win.destroy(); try { fs.rmSync(tmp, { force: true }); } catch {} }
}

// ── 빈 장식: 번역에서 뺀 글의 도형(알약·원·띠)인데 화면에 그 안 글이 없고 지운 그림에 도형 색이 그대로(재생 하네스와 같은 규칙) ──
function emptyDecoOf(dir, sec, wrap, dropShapes) {
  if (!dropShapes?.length || !sec.image) return [];
  let bm; try { const im = nativeImage.createFromPath(path.join(dir, sec.image)); const s = im.getSize(); bm = { w: s.width, h: s.height, data: im.toBitmap() }; } catch { return []; }
  if (!bm.w) return [];
  const sc = wrap.iw && wrap.width ? wrap.iw / wrap.width : 1;
  const centers = (wrap.units || []).map((u) => { const r = u.rs; const l = Math.min(...r.map((q) => q.x)), t = Math.min(...r.map((q) => q.y)), rr = Math.max(...r.map((q) => q.x + q.w)), b = Math.max(...r.map((q) => q.y + q.h)); return [((l + rr) / 2) * sc, ((t + b) / 2) * sc]; });
  const keepC = [...(sec.keep || []), ...(sec.layers || []).filter((l) => l.role === "number")].map((k) => [k.x + k.w / 2, k.y + k.h / 2]);
  const out = [];
  for (const sh of dropShapes) {
    const inside = ([x, y]) => x > sh.x && x < sh.x + sh.w && y > sh.y && y < sh.y + sh.h;
    if (centers.some(inside) || keepC.some(inside)) continue;
    const m = /^#?([0-9a-f]{6})$/i.exec(sh.color || ""); if (!m) continue; const v = parseInt(m[1], 16), c = [v >> 16 & 255, v >> 8 & 255, v & 255];
    const near = (x, y, tol) => { const i = (y * bm.w + x) * 4; return Math.abs(bm.data[i + 2] - c[0]) + Math.abs(bm.data[i + 1] - c[1]) + Math.abs(bm.data[i] - c[2]) < tol; };
    let n = 0, hit = 0; for (let y = Math.round(sh.y + sh.h * 0.3); y < sh.y + sh.h * 0.7; y += 2) for (let x = Math.round(sh.x + sh.w * 0.3); x < sh.x + sh.w * 0.7; x += 2) { if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) continue; n++; if (near(x, y, 90)) hit++; }
    let rn = 0, rh = 0; for (let x = Math.round(sh.x - 6); x < sh.x + sh.w + 6; x += 3) for (const y of [Math.round(sh.y - 6), Math.round(sh.y + sh.h + 6)]) { if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) continue; rn++; if (near(x, y, 60)) rh++; }
    if (n && hit / n >= 0.6 && !(rn && rh / rn > 0.6)) out.push(`${sh.circle ? "원" : sh.round ? "알약" : "칸"}`);
  }
  return out;
}

// ── AI 비전 검수: 장 캡처를 haiku 가 Read 로 열어 본다(묶음 5장 · 동시 3) ──
export const AI_SYSTEM = `당신은 쿠팡 상세페이지 최종 검수자입니다. 중국 상세 이미지의 중국어를 지우고 그 자리에 한글을 얹은 이미지(장마다 JPG)를 Read 도구로 한 장씩 열어 봅니다.
보는 것(대표님 기준 — 깔끔함):
- align: 같은 줄·같은 열 글의 왼쪽 끝/가운데가 안 맞음(오와 열)
- spacing: 여백·줄 간격·자간이 들쭉날쭉, 글이 너무 붙거나 벌어짐
- size: 같은 역할 글(제목끼리, 라벨끼리)의 크기·굵기가 다름
- overflow: 글이 원·알약·띠·칸 밖으로 삐져나오거나 이미지 끝에서 잘림, 글끼리 겹침
- residue: 지운 자리에 흐린 사각형·얼룩·중국어 잔상이 보임
- empty_deco: 글 없이 남은 빈 원·알약·띠·말풍선
- translation: 어색한 직역 한국어(기계번역 말투, 뜻이 안 통함)
문제가 아닌 것: 원본 사진 속 제품·영문 로고·숫자·단위, 원래 디자인의 색. 확실히 눈에 띄는 것만 적고 애매하면 ok=true.
text 에는 문제가 있는 한글 문구를 이미지에 보이는 그대로 적습니다(없으면 빈 문자열). what 은 30자 안쪽 한국어.`;
const AI_SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "ok", "issues"], properties: {
  id: { type: "string" }, ok: { type: "boolean" }, issues: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["kind", "what", "text"], properties: { kind: { type: "string", enum: AI_KINDS }, what: { type: "string" }, text: { type: "string" } } } } } } } } };

export async function aiReview({ shots = {}, ids = [], cli, model = "haiku", batch = 6, conc = 4, timeoutMs = 150000, budget = () => true, maxUsd = Infinity, log = noop }) {
  const list = ids.filter((id) => shots[id]);
  if (!list.length) return { byId: {}, costUsd: 0, calls: 0, errors: 0 };
  // 비용: CLI 1회 고정비가 커서(실측 묶음당 $0.05~0.11) 남은 예산으로 부를 수 있는 횟수만큼 묶음을 키운다(장을 빼먹지 않게)
  const nCalls = Math.max(1, Math.min(Math.ceil(list.length / batch), Math.floor(maxUsd / 0.09) || 1));
  batch = Math.ceil(list.length / nCalls);
  const groups = []; for (let i = 0; i < list.length; i += batch) groups.push(list.slice(i, i + batch));
  const byId = {}; let costUsd = 0, calls = 0, errors = 0, next = 0;
  const one = async () => { for (;;) { const g = groups[next++]; if (!g) return; if (!budget() || costUsd >= maxUsd) { errors++; continue; }
    const text = `이미지 ${g.length}장(순서대로 Read 로 열어 보세요):\n${g.map((id) => `${id}  ${shots[id]}`).join("\n")}\n\n장마다 id 를 그대로 적어 items 로 답하세요.`;
    const r = await cli.runStructured({ purpose: "loc-qa", system: AI_SYSTEM, schema: AI_SCHEMA, text, model, timeoutMs, allowedTools: ["Read"] }).catch((e) => ({ error: String(e?.message || e) }));
    calls++;
    if (r?.error) { errors++; log("dim", `  🔍 AI 검수 묶음 실패 · ${String(r.error).slice(0, 80)}`); continue; }
    costUsd += Number(r.costUsd) || 0;
    if (r.usage) log("dim", `  🔍 AI 검수 ${g.length}장 · $${(Number(r.costUsd) || 0).toFixed(3)} · 입력 ${r.usage.input_tokens || 0}+캐시 ${(r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0)} · 출력 ${r.usage.output_tokens || 0}`);
    for (const it of r.result?.items || []) if (g.includes(it.id)) byId[it.id] = { ok: !!it.ok && !(it.issues || []).length, issues: (it.issues || []).filter((x) => AI_KINDS.includes(x.kind)).map((x) => ({ kind: x.kind, what: String(x.what || "").slice(0, 60), text: String(x.text || "").slice(0, 40) })) };
  } };
  await Promise.all(Array.from({ length: Math.min(conc, groups.length) }, one));
  return { byId, costUsd, calls, errors };
}

// ── 문구 다시 쓰기(직역·AI 번역 지적 줄만, haiku 1회) ──
async function rewriteLayers(items, cli, log) {
  if (!items.length) return { map: new Map(), costUsd: 0 };
  const r = await cli.runStructured({ purpose: "loc-qa-rewrite", system: "아래 줄은 모두 검수에서 직역체(기계번역 말투·뜻이 안 통하는 말)로 걸린 한국어 문구입니다. 한국 쇼핑몰 상세페이지에서 실제 쓰는 짧고 자연스러운 말로 반드시 고쳐 씁니다. 숫자·단위·상품 이름은 그대로, 지금보다 길게 쓰지 않습니다. 예: '당신의 ~' → 주어 없이('~에 어울리는'), '~하십시오' → '~하세요', '매개변수' → '사양'. JSON 만.",
    schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "ko"], properties: { n: { type: "integer" }, ko: { type: "string" } } } } } },
    text: items.map((x, n) => `${n}. 지금 "${x.ko}"${x.zh ? ` (원문 ${x.zh})` : ""}${x.why ? ` — 걸린 이유: ${x.why}` : ""}`).join("\n"), model: "haiku", timeoutMs: 90000 }).catch((e) => ({ error: String(e?.message || e) }));
  if (r?.error) { log("dim", `  🔍 문구 다시 쓰기 실패 · ${String(r.error).slice(0, 80)}`); return { map: new Map(), costUsd: 0 }; }
  const map = new Map(); for (const it of r.result?.items || []) { const x = items[it.n]; const ko = String(it.ko || "").trim(); if (x && ko && ko !== x.ko && ko.length <= Math.max(x.ko.length + 2, x.ko.length * 1.2) && !/[一-鿿]/.test(ko)) map.set(x.layer, ko); }
  return { map, costUsd: Number(r.costUsd) || 0 };
}

/**
 * 뒤에서 도는 검수·수정 루프.
 * ctx: { dir, renderId, plan(이 렌더를 그린 plan — 제자리 고침), tl(localize.json), ocr, rawOf(id)→원본 파일, settings,
 *        render(plan) → 새 렌더 결과(out/<renderId> 덮어씀, 실패면 throw), aborted() → true 면 멈춤, progress(msg), log,
 *        cli(runStructured 모듈 — 없으면 AI 비전·다시 쓰기 생략), ai: AI 다시 지우기 허용, limits,
 *        only(Set — 이 장들만: 장별 고치기 화면), prevAi({ id: 지난 AI 판정 } — 이번에 AI 를 안 보면 이어 씀), aiReview:false(AI 비전 건너뜀) }
 * → { sections:{ id: { pass, issues, tries, fixed, why } }, summary, rounds, ms, costUsd, limitHit, rendered(마지막 새 렌더 또는 null), log:[…] }
 */
export async function runLocQa(ctx) {
  const L = { ...LIMITS, ...(ctx.limits || {}) };
  const t0 = Date.now(), log = ctx.log || noop, say = ctx.progress || noop;
  const { dir, renderId, plan } = ctx;
  let cost = 0, aiCalls = 0, limitHit = null, rendered = null;
  const timeLeft = () => L.maxMs - (Date.now() - t0);
  const canWork = () => { if (timeLeft() <= 0) { limitHit ||= "time"; return false; } return !ctx.aborted?.(); }; // 시간 상한: 모든 일
  const okBudget = () => { if (!canWork()) return false; if (cost >= L.maxUsd) { limitHit ||= "cost"; return false; } return true; }; // 비용 상한: AI 쓰는 일만(plan 고치기·다시 그리기는 0원이라 계속)
  const shotDir = path.join(dir, "out", renderId, ".qa");
  const tlImg = (id) => (ctx.tl?.images || []).find((x) => x.id === id) || null;
  const residueOf = (id) => (tlImg(id)?.layers || []).filter((l) => l.erase?.residue && l.erase.residue.pass === false).map((l) => `${l.zh || ""} ${l.erase.residue.why || ""}`.trim());
  const dropShapesOf = (id) => (tlImg(id)?.layers || []).filter((l) => l.drop && l.shape).map((l) => l.shape);
  const secOf = (id) => (plan.sections || []).find((x) => x.id === id);
  const state = {}; // id → { tries, fixed, issues, ai }
  const steps = [];
  let firstIssues = {}, tops = {};

  // 측정 한 번(only: 다시 볼 장 — null 이면 전부). AI 비전은 only 장만 다시
  const measure = async (only, round) => {
    say(round ? `🔍 고친 ${only.size}장 다시 보는 중` : "🔍 글 겹침·넘침·크기·정렬·잔상 재는 중");
    const m = await measurePage({ dir, renderDir: path.join("out", renderId), plan, shotDir, only, width: Number(plan.meta?.width) || 780 });
    const ids = m.wraps.map((w) => w.id).filter((id) => !only || only.has(id));
    // 남은 한자: 장 캡처 OCR(우리가 얹은 글 상자와 겹치는 것은 OCR 오인식으로 뺀다)
    let ocrBy = {};
    try {
      const { ocrImages } = await import("./ocr.js");
      const r = await ocrImages(ids.filter((id) => m.shots[id]).map((id) => ({ id, file: m.shots[id] })), { log: noop });
      for (const im of r.images || []) { const w = m.wraps.find((x) => x.id === im.id); const ours = (w?.units || []).flatMap((u) => u.rs); ocrBy[im.id] = realChinese(im.boxes || [], ours); }
    } catch (e) { log("dim", `  🔍 OCR 건너뜀 (${e?.message || e})`); }
    // AI 비전(동시)
    let aiBy = null;
    if (ctx.cli?.runStructured && ctx.aiReview !== false && okBudget() && (!round || timeLeft() > 50000)) { // 다시 볼 때 시간이 모자라면 AI 는 건너뛰고 지난 AI 판정을 이어 쓴다
      say(`🔍 AI가 ${ids.length}장을 보는 중`);
      const r = await aiReview({ shots: m.aiShots, ids, cli: ctx.cli, model: ctx.settings?.detailLocQaModel || "haiku", budget: okBudget, maxUsd: L.maxUsd * 0.8 - cost, log, timeoutMs: Math.max(20000, Math.min(100000, timeLeft() - (round ? 25000 : 70000))) }); // 시간 상한 안에 고치기·다시 그리기 몫을 남긴다
      cost += r.costUsd; aiCalls += r.calls; aiBy = r.byId;
      if (r.errors && !Object.keys(r.byId).length) aiBy = null;
    }
    for (const id of ids) {
      const w = m.wraps.find((x) => x.id === id), sec = secOf(id);
      const texts = sec?.type === "hero" ? [sec.name, sec.sub, sec.label].filter(Boolean) : (sec?.layers || []).filter((l) => !l.drop).map((l) => l.ko);
      // 대비: 글자색이 원본 글자색(plan)과 같으면 원본 디자인 — 알약·배지 바탕처럼 1.8:1 까지 유지
      const layerOf = (t) => { const k = norm(t); return (sec?.layers || []).find((l) => { const n = norm(l.ko); return n && k && (n === k || n.startsWith(k) || k.startsWith(n)); }); };
      const low = (w.low || []).map((l) => { const c = /^#?([0-9a-f]{6})$/i.exec(String(layerOf(l.text)?.style?.color || "")); if (!c || !l.color) return l; const v = parseInt(c[1], 16), d = Math.abs((v >> 16 & 255) - l.color[0]) + Math.abs((v >> 8 & 255) - l.color[1]) + Math.abs((v & 255) - l.color[2]); return d < 40 ? { ...l, own: true } : l; });
      // AI 번역 지적은 인용한 글이 실제 그 장 문구에 있을 때만(AI 가 한글을 잘못 읽은 것 거르기 — 자가 검수와 같은 규칙)
      const ai0 = aiBy?.[id] || (round ? state[id]?.ai0 || null : ctx.prevAi?.[id] || null); // 이번에 AI 답이 없으면 지난 판정(고친 장도 AI 지적은 남김 — 거짓 "고침" 방지)
      const ai = ai0 && { ...ai0, issues: ai0.issues.filter((x) => x.kind !== "translation" || (x.text && texts.some((t) => { const ws = (v) => String(v || "").replace(/\s+/g, " ").trim(), a = ws(t), b = ws(x.text).replace(/[….]+$/, "").trim(); return a && norm(b).length >= 4 && a.includes(b); })) /* 띄어쓰기까지 같아야 — "힘 안 들이는"을 "힘안들이는"으로 잘못 읽고 띄어쓰기 지적하던 것 */) };
      const met = { overlaps: w.overlaps, overflow: w.overflow, roleDev: w.roleDev, colDev: w.colDev, low,
        residue: sec?.type === "image" && String(sec.image || "").startsWith("localize/") ? residueOf(id) : [],
        chinese: (ocrBy[id] || []).map((b) => b.text), literal: literalOf(texts), emptyDeco: sec?.type === "image" ? emptyDecoOf(dir, sec, w, dropShapesOf(id)) : [],
        ai }; // 그 장 AI 답이 없으면 AI 없이 판정(잔상은 그대로 문제)
      const issues = judgeSection(met, L);
      state[id] = { ...(state[id] || { tries: 0, fixed: false }), issues, chineseBoxes: ocrBy[id] || [], wrap: w, ai0 };
    }
    for (const w of m.wraps) if (state[w.id]) state[w.id].y = w.top; // 화면 목록이 렌더 섹션(y)과 맞출 때 쓴다
    tops = Object.fromEntries(m.wraps.map((w) => [w.id, w.top])); // 장을 빼거나 넣으면 아래 장들의 y 가 바뀐다 — 전부 새로
    return m;
  };

  try {
    await measure(ctx.only || null, 0);
    const first = Object.fromEntries(Object.entries(state).map(([id, s]) => [id, s.issues.length]));
    firstIssues = Object.fromEntries(Object.entries(state).map(([id, s]) => [id, s.issues.map((x) => x.why)]));
    const flagged0 = Object.keys(first).filter((id) => first[id]);
    steps.push(`처음 검수: ${Object.keys(state).length}장 중 ${flagged0.length}장 걸림 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    log("info", `🔍 원본 한글화 검수 · ${Object.keys(state).length}장 중 ${flagged0.length}장 걸림${flagged0.length ? " · " + flagged0.slice(0, 6).map((id) => `${id} ${headline(state[id].issues)}`).join(" / ") : ""}`);

    for (let round = 1; round <= L.rounds; round++) {
      const todo = Object.keys(state).filter((id) => !state[id].reverted && state[id].issues.some((x) => x.fix)); // 되돌린 장은 더 고치지 않는다
      if (!todo.length || !canWork()) break;
      say(`🛠 ${todo.length}장 고치는 중 (${round}회차)`);
      const changed = new Set();
      const snap = Object.fromEntries(todo.map((id) => [id, { sec: JSON.stringify(secOf(id) || null), issues: state[id].issues }])); // 고친 뒤 더 나빠지면 되돌릴 자리
      // ① plan 고치기(크기·열·줄이기·테두리)
      for (const id of todo) { const sec = secOf(id); if (!sec || sec.type !== "image") continue; const d = fixPlan(sec, state[id].issues, state[id].tries); if (d.length) { changed.add(id); steps.push(`${id} ${d.join(" · ")}`); } }
      // ② 문구 다시 쓰기(직역·AI 번역 지적) — 한 번에
      if (ctx.cli?.runStructured && okBudget()) {
        const items = []; for (const id of todo) { const sec = secOf(id); if (!sec || sec.type !== "image") continue; for (const l of rewriteTargets(sec, state[id].issues)) items.push({ id, layer: l, zh: l.zh || "", ko: String(l.ko || ""), why: (String(l.ko || "").match(LITERAL_RE) || [])[0] ? `직역 말투 "${String(l.ko).match(LITERAL_RE)[0]}"` : (state[id].issues.find((x) => x.fix === "rewrite")?.why || "") }); }
        if (items.length) { const r = (await within(rewriteLayers(items.slice(0, 30), ctx.cli, log), timeLeft() - 40000)) || { map: new Map(), costUsd: 0 }; cost += r.costUsd; aiCalls++; for (const it of items) { const ko = r.map.get(it.layer); if (ko) { it.layer.ko_before = it.layer.ko; it.layer.ko = ko; changed.add(it.id); steps.push(`${it.id} "${it.ko}" → "${ko}"`); } } }
      }
      // ③ 다시 지우기(잔상·남은 한자) — 걸린 장만 동시 3장
      const er = todo.filter((id) => state[id].issues.some((x) => x.fix === "erase") && String(secOf(id)?.image || "").startsWith("localize/"));
      if (er.length && okBudget()) {
        const { localizeImage, eraseShapes } = await import("./localize.js");
        let k = 0;
        const one = async () => { for (;;) { const id = er[k++]; if (!id) return; if (!okBudget()) return;
          const out = path.join(dir, "localize", `${id}.png`), st = state[id], sec = secOf(id);
          try {
            let did = false;
            // ① 잔상: 원본부터 다시(AI 허용) + 뺀 글 도형 다시 지움 — AI 없이는 같은 결과라 건너뜀, 장당 한 번만
            if (st.issues.some((x) => x.kind === "residue" || x.ai === "residue") && ctx.ai && !st.reErased) {
              const raw = ctx.rawOf?.(id);
              if (raw) {
                const boxes = ((ctx.ocr?.images || []).find((x) => x.id === id)?.boxes || []).filter((b) => !b.latin);
                const tmp = out.replace(/\.png$/, ".qa-tmp.png");
                const r = await within(localizeImage({ file: raw, ocrBoxes: boxes, out: tmp, ai: true, settings: ctx.settings || {}, log: noop }), timeLeft() - 40000);
                if (!r) { steps.push(`${id} 다시 지우기 시간 초과 — 그대로 둠`); limitHit ||= "time"; continue; } // 늦게 끝난 결과는 쓰지 않는다(아래 tmp 만 남음)
                if (r?.ai?.billed) cost += r.ai.billed * 0.039;
                fs.renameSync(tmp, out);
                const sh = dropShapesOf(id); if (sh.length) { try { eraseShapes(out, sh); } catch {} }
                const tli = tlImg(id); if (tli && r?.layers) { const fails = new Set(r.layers.filter((l) => l.erase?.residue && l.erase.residue.pass === false).map((l) => l.zh)); for (const l of tli.layers || []) if (l.erase?.residue) l.erase = { ...l.erase, residue: { ...l.erase.residue, pass: !fails.has(l.zh) } }; }
                st.reErased = true; did = true; steps.push(`${id} 다시 지움${r?.ai?.used ? " (AI)" : ""}`);
              }
            }
            // ② 남은 한자: 지금 그림에서 그 글만 지운다(캡처 px → 원본 px)
            if (st.chineseBoxes.length) {
              const s = st.wrap.iw && st.wrap.width ? st.wrap.iw / st.wrap.width : 1;
              const boxes = st.chineseBoxes.map((b) => ({ text: b.text, x: Math.round(b.x * s), y: Math.round(b.y * s), w: Math.round(b.w * s), h: Math.round(b.h * s), conf: b.conf ?? 0.9 }));
              const tmp = out.replace(/\.png$/, ".qa-tmp2.png");
              const r = await within(localizeImage({ file: out, ocrBoxes: boxes, out: tmp, ai: !!ctx.ai, settings: ctx.settings || {}, log: noop }), timeLeft() - 40000);
              if (!r) { steps.push(`${id} 남은 중국어 지우기 시간 초과`); limitHit ||= "time"; if (!did) continue; }
              else { if (r?.ai?.billed) cost += r.ai.billed * 0.039; fs.renameSync(tmp, out); }
              did = true; steps.push(`${id} 남은 중국어 ${boxes.length}곳 지움`);
            }
            if (!did) continue;
            changed.add(id);
          } catch (e) { log("dim", `  🔍 ${id} 다시 지우기 실패 (${e?.message || e})`); }
        } };
        say(`🧽 ${er.length}장 다시 지우는 중`);
        await Promise.all(Array.from({ length: Math.min(3, er.length) }, one));
        // 바뀐 지운 그림 → plan 바탕 격자는 렌더가 다시 계산(prepareLocalize)
      }
      for (const id of todo) state[id].tries++;
      if (!changed.size || ctx.aborted?.()) break;
      if (timeLeft() < 20000) { limitHit ||= "time"; break; } // 다시 그리기·재검수 시간이 없으면 멈춤
      say(`🖼 고친 ${changed.size}장 다시 그리는 중`);
      rendered = await ctx.render(plan);
      for (const id of changed) state[id].fixed = true;
      await measure(changed, round);
      // 되돌리기: 고친 뒤 없던 종류의 문제가 새로 생긴 장(예: 일부러 들여 쓴 줄을 열 맞춤으로 당김)은 plan 을 전 상태로 — 원래 문제는 ⚠ 로 남긴다
      const worse = [...changed].filter((id) => { const k0 = new Set(snap[id]?.issues.map((x) => x.kind)); return state[id].issues.some((x) => x.kind !== "ai" && !k0.has(x.kind)); });
      if (worse.length) {
        for (const id of worse) { const i = plan.sections.findIndex((x) => x.id === id), old = JSON.parse(snap[id].sec); if (i >= 0 && old) plan.sections[i] = old; state[id].issues = snap[id].issues; state[id].fixed = false; state[id].reverted = true; steps.push(`${id} 고친 뒤 새 문제 → 되돌림`); }
        if (timeLeft() > 15000) { say("↩ 나빠진 장 되돌려 다시 그리는 중"); rendered = await ctx.render(plan); }
      }
    }
  } catch (e) { if (!limitHit) log("warn", `△ 🔍 검수 중단 (${e?.message || e})`); steps.push(`중단: ${e?.message || e}`); }

  const sections = Object.fromEntries(Object.entries(state).map(([id, s]) => [id, { pass: !s.issues.length, issues: s.issues.map(({ kind, why, fix, ai, texts }) => ({ kind, why, ...(fix ? { fix } : {}), ...(ai ? { ai } : {}), ...(texts?.length ? { texts: texts.map((t) => String(t).slice(0, 40)) } : {}) })), tries: s.tries, fixed: !!s.fixed && !s.issues.length, why: headline(s.issues), y: s.y ?? null,
    ai: s.ai0 || null, // 다음 장별 다시 보기 때 이어 쓸 AI 판정
    box: s.wrap ? { w: s.wrap.width, h: s.wrap.height, units: (s.wrap.units || []).map((u) => { const r = u.rs; const x = Math.min(...r.map((q) => q.x)), y = Math.min(...r.map((q) => q.y)); return { t: u.text, x, y, w: Math.max(...r.map((q) => q.x + q.w)) - x, h: Math.max(...r.map((q) => q.y + q.h)) - y }; }) } : null }]));
  if (!ctx.keepShots) { try { fs.rmSync(shotDir, { recursive: true, force: true }); } catch {} }
  return { sections, first: firstIssues, summary: summarize(sections), tops, ms: Date.now() - t0, costUsd: +cost.toFixed(4), aiCalls, limitHit, rendered, steps };
}
