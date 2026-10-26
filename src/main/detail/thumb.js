// 🖼 쿠팡 썸네일 1단계 — 상세페이지 작업 폴더의 재료로 대표이미지 1장 + 추가이미지 4~6장을 만든다(규정: docs/detail/THUMBNAIL.md).
//   ① 후보: 대표(gallery)·옵션(option) 원본 사진 → 제품 위 글자(치수 표시·라벨) 지우기 → macOS Vision 누끼 → 작은 조각 제거 → 흰 바탕 미리보기
//   ② 고르기(Claude CLI·Read 1회): 대표 후보 판정 · 옵션 구분 라벨 · 치수(원본 글 인용) · 기능/구성품 사진 · 장면 배경 주제
//   ③ 만들기(오프스크린 창 1000×1000): 대표(흰 바탕+바닥 그림자) · 장면(AI 배경만 + 실제 누끼) · 사이즈(누끼+치수선) · 옵션 모음 · 기능 확대 · 구성품
//   ④ 검수: 픽셀(순백 가장자리·잘림·채움·용량) + 비전(Claude CLI·Read 1회 — 실제 사진과 같은 모양·잘림·다른 브랜드 로고·글자·어색함)
// 결과: <작업>/thumb/NN-<kind>.jpg + thumb.json. 원본 폴더의 다른 파일은 건드리지 않는다.
import { BrowserWindow, nativeImage, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ensureCutoutBinary } from "./cutout.js";
import { eraseRect } from "./image-core.js";
import { runStructured, cliAvailable } from "./cli.js";
import { resolveProvider, getVertexToken, vertexUrl, createRegionRouter, DEFAULT_SCENE_REGIONS, DEFAULT_VERTEX_LOCATION } from "./scene.js";
import { costOf } from "./usage-core.js";
import { applyEdit, exportPick, colorHist, histMatch, pickBcut, orderItems, hasIprText, appealOk, pickDetailSections, MAX_EXTRA, heroScore, isDimText, THUMB_SIZE, KINDS, placeProduct, touchesEdge, boxesToErase, pickHero, inspectHero, judgeThumb, summarizeSet, sceneBackgroundPrompt, dimsGrounded, fmtDim, tidyOptionLabel, MAX_BYTES } from "./thumb-core.js";

const noop = () => {};
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const furl = (f) => pathToFileURL(f).href;
const pad2 = (n) => String(n).padStart(2, "0");
const IMG_RE = /\.(jpe?g|png|webp)$/i;

// ---------- 비트맵 ----------
function loadBm(file) { const im = nativeImage.createFromPath(file); if (im.isEmpty()) throw new Error(`이미지를 읽지 못함: ${path.basename(file)}`); const { width: w, height: h } = im.getSize(); return { data: Buffer.from(im.toBitmap()), w, h }; }
const savePng = (bm, out) => { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, nativeImage.createFromBitmap(bm.data, { width: bm.w, height: bm.h }).toPNG()); return out; };

// 알파(premultiplied BGRA) 누끼 → 작은 조각(가장 큰 덩어리의 8% 미만) 지우고 알파 상자로 잘라 저장. 반환 { w, h, parts, bbox(원본 좌표) }
//   thin: 가는 선(치수선·지시선, 칸 1~2개 폭)을 지운다 — 칸 격자를 한 번 깎고(erode) 덩어리를 찾은 뒤 남긴 덩어리만 두 칸 다시 불린다(dilate).
export function tidyCutout(file, out, { minPart = 0.08, alphaMin = 24, thin = false } = {}) {
  const bm = loadBm(file); const { w, h, data } = bm;
  const g = 4, gw = Math.ceil(w / g), gh = Math.ceil(h / g); let cell = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > alphaMin) cell[((y / g) | 0) * gw + ((x / g) | 0)] = 1;
  const full = cell;
  if (thin) { const e = new Uint8Array(gw * gh); for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) { const i = y * gw + x; e[i] = full[i] && full[i - 1] && full[i + 1] && full[i - gw] && full[i + gw] ? 1 : 0; } cell = e; }
  const lab = new Int32Array(gw * gh), sizes = [0]; let n = 0;
  for (let i = 0; i < cell.length; i++) {
    if (!cell[i] || lab[i]) continue;
    n++; let cnt = 0; const st = [i]; lab[i] = n;
    while (st.length) { const j = st.pop(); cnt++; const cx = j % gw, cy = (j / gw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; const k = ny * gw + nx; if (cell[k] && !lab[k]) { lab[k] = n; st.push(k); } } }
    sizes.push(cnt);
  }
  if (!n) return null;
  const big = Math.max(...sizes);
  const keep = new Set(sizes.map((s, i) => (i && s >= big * minPart ? i : 0)).filter(Boolean));
  if (thin) { // 남긴 덩어리를 두 칸 불려 원래 두께로 — 불린 자리 밖(가는 선)은 지운다
    const k2 = new Int32Array(gw * gh); const first = [...keep][0] || 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { if (!keep.has(lab[y * gw + x])) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && full[ny * gw + nx]) k2[ny * gw + nx] = lab[y * gw + x]; } }
    lab.set(k2); if (!keep.size && first) keep.add(first);
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (!data[i + 3]) continue;
    const l = lab[((y / g) | 0) * gw + ((x / g) | 0)];
    if (!keep.has(l)) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
    if (data[i + 3] > alphaMin) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  // 가장자리 흰 띠(원본 흰 배경이 섞인 반투명 픽셀) 줄이기: 반투명 알파를 조여(choke) 어두운 장면 배경에서 테두리가 뜨지 않게
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3]; if (!a || a === 255) continue; const a2 = Math.max(0, Math.min(255, Math.round(((a - 90) * 255) / 165))); const k = a2 / a; data[i] = Math.round(data[i] * k); data[i + 1] = Math.round(data[i + 1] * k); data[i + 2] = Math.round(data[i + 2] * k); data[i + 3] = a2; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, buf = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) data.copy(buf, y * cw * 4, ((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4);
  savePng({ data: buf, w: cw, h: ch }, out);
  return { w: cw, h: ch, parts: keep.size, bbox: { x: x0, y: y0, w: cw, h: ch }, srcW: w, srcH: h };
}
// 누끼 → 흰 바탕 JPG(비전 검수용 미리보기)
function whitePreview(cutFile, out, max = 640) {
  const bm = loadBm(cutFile); const d = bm.data;
  for (let i = 0; i < d.length; i += 4) { const k = 255 - d[i + 3]; d[i] = Math.min(255, d[i] + k); d[i + 1] = Math.min(255, d[i + 1] + k); d[i + 2] = Math.min(255, d[i + 2] + k); d[i + 3] = 255; }
  let im = nativeImage.createFromBitmap(d, { width: bm.w, height: bm.h });
  if (Math.max(bm.w, bm.h) > max) im = im.resize(bm.w >= bm.h ? { width: max, quality: "best" } : { height: max, quality: "best" });
  fs.writeFileSync(out, im.toJPEG(88)); return out;
}

function runCutoutBin(bin, outDir, files) {
  return new Promise((resolve) => execFile(bin, [outDir, ...files], { timeout: 180000, maxBuffer: 64 * 1024 * 1024 }, (err, so) => { try { resolve(JSON.parse(String(so)).images || []); } catch { resolve([]); } }));
}

// ---------- 재료 모으기 ----------
function collectSources(dir) {
  const src = readJson(path.join(dir, "source.json")) || {};
  const ocr = readJson(path.join(dir, "ocr.json"));
  const ocrById = new Map((ocr?.images || []).map((x) => [x.id, x.boxes || []]));
  const fileOf = (im) => { const raw = path.join(dir, "raw", path.basename(String(im.file || ""))); if (im.file && fs.existsSync(raw)) return raw; if (im.file && fs.existsSync(im.file)) return im.file; const g = fs.existsSync(path.join(dir, "raw")) ? fs.readdirSync(path.join(dir, "raw")).find((f) => f.startsWith(im.id + ".")) : null; return g ? path.join(dir, "raw", g) : null; };
  const opts = src.options || [];
  const cands = (src.images || []).filter((im) => im.kind === "gallery" || im.kind === "option").map((im, i) => {
    const file = fileOf(im); if (!file || !IMG_RE.test(file)) return null;
    const oi = im.kind === "option" ? Number(im.id.slice(1)) - 1 : -1;
    return { id: im.id, kind: im.kind, file, w: im.w, h: im.h, label: im.label || opts.filter((o) => o.img)[oi]?.label_ko || opts.filter((o) => o.img)[oi]?.label_zh || "", boxes: ocrById.get(im.id) || [] };
  }).filter(Boolean);
  return { src, cands, ocrById };
}

// ---------- ① 누끼 후보 ----------
async function buildCutouts(dir, tdir, cands, { log = noop } = {}) {
  const bin = await ensureCutoutBinary({ log });
  if (!bin) throw new Error("누끼 도구를 쓸 수 없습니다(macOS 14 이상 필요)");
  const cut0 = path.join(tdir, "work", "cut0"), cut1 = path.join(tdir, "work", "cut1"), fix = path.join(tdir, "work", "fixed"), cutD = path.join(tdir, "work", "cut"), prevD = path.join(tdir, "work", "prev");
  [cut0, cut1, fix, cutD, prevD].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const r0 = await runCutoutBin(bin, cut0, cands.map((c) => c.file));
  // 제품 상자 안의 글자(치수 표시·라벨·상표)를 원본에서 지우고 다시 딴다
  const redo = [];
  for (const c of cands) {
    const r = r0.find((x) => x.file === c.file); if (!r?.ok) continue;
    c.cut0 = r; c.touchesEdge = touchesEdge(r.bbox, r.w, r.h);
    const er = boxesToErase(c.boxes, r.bbox);
    if (!er.length) continue;
    try { const bm = loadBm(c.file); for (const b of er) eraseRect(bm, b, "interp"); const f = path.join(fix, `${c.id}.png`); savePng(bm, f); c.fixed = f; c.erased = er.map((b) => b.text); redo.push(c); } catch (e) { log("dim", `  🖼 ${c.id} 글자 지우기 실패: ${e.message}`); }
  }
  const r1 = redo.length ? await runCutoutBin(bin, cut1, redo.map((c) => c.fixed)) : [];
  const out = [];
  for (const c of cands) {
    const r = c.fixed ? r1.find((x) => x.file === c.fixed) : c.cut0;
    if (!r?.ok || !r.out) continue;
    const t = tidyCutout(r.out, path.join(cutD, `${c.id}.png`));
    if (!t) continue;
    const rec = { ...c, cut: path.join(cutD, `${c.id}.png`), cutW: t.w, cutH: t.h, parts: t.parts, coverage: r.coverage, srcBox: t.bbox, prev: whitePreview(path.join(cutD, `${c.id}.png`), path.join(prevD, `${c.id}.jpg`)) };
    if (c.kind === "option") { const tt = tidyCutout(r.out, path.join(cutD, `${c.id}-thin.png`), { thin: true }); if (tt) rec.thinCut = { cut: path.join(cutD, `${c.id}-thin.png`), cutW: tt.w, cutH: tt.h }; } // 옵션 모음용(치수선 지움)
    out.push(rec);
  }
  log("dim", `  🖼 누끼 후보 ${out.length}/${cands.length}장 (글자 지운 장 ${redo.length})`);
  return out;
}

// ---------- ② 고르기(Claude CLI 1회) ----------
const it = (props) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const PICK_SCHEMA = { type: "object", additionalProperties: false, required: ["candidates", "options", "option_names", "dims", "feature", "package", "scene", "appeal"], properties: {
  option_names: { type: "array", description: "[옵션 이름 전체]의 모든 옵션 id 마다 한국어 이름(14자 이내, 구분되는 말만 — 광고·배송 문구 빼기)", items: it({ id: { type: "string" }, name_ko: { type: "string" } }) },
  appeal: { type: "array", maxItems: 3, description: "구매 소구점 라벨 2~3개(각 12자 이내) — [장점]·[상품 정보]에 있는 용량·구성품·핵심 기능만. 숫자는 원문 그대로. 로켓배송·무료·BEST·1위·최저가 같은 말 금지", items: it({ label_ko: { type: "string" } }) },
  candidates: { type: "array", items: it({ id: { type: "string" }, whole_product: { type: "boolean", description: "제품 전체가 잘림 없이 보이는가" }, single_unit: { type: "boolean", description: "제품 1대(1세트)만 보이는가(같은 제품 여러 대·여러 각도면 false)" }, hands_or_people: { type: "boolean" }, extra_items: { type: "boolean", description: "음식·재료·그릇·다른 물건이 함께 붙어 있는가" }, overlay_text: { type: "boolean", description: "제품 위·옆에 덧그린 글자·치수선·배지가 남아 있는가(제품에 붙은 라벨은 제외)" }, same_product: { type: "boolean", description: "이 상품(대부분의 사진에 나오는 그 제품)과 같은 제품인가" }, view: { type: "string", enum: ["front", "angle", "side", "top", "other"] }, score: { type: "integer", description: "대표이미지로서 1~5" } }) },
  options: { type: "array", maxItems: 6, description: "옵션 사진 중 겉모양이 서로 다른 것만(같아 보이면 하나만). 모두 같아 보이면 빈 배열", items: it({ id: { type: "string" }, label_ko: { type: "string", description: "옵션 이름에서 뽑은 구분 말 10자 이내(예: 단구형, 쌍구형, 화이트). 광고 문구 금지" } }) },
  dims: { type: ["object", "null"], additionalProperties: false, required: ["width", "height", "depth", "unit", "quote"], properties: { width: { type: ["string", "null"], description: "원문 숫자 그대로(범위면 37~57.5, 옵션별이면 13.5/20.5), 단위 빼고" }, height: { type: ["string", "null"] }, depth: { type: ["string", "null"] }, unit: { type: "string", enum: ["cm", "mm"] }, quote: { type: "string", description: "숫자를 가져온 원본 글 그대로" } }, description: "[상품 정보]·사이즈 사진에 적힌 제품 본체 치수. 없으면 null. 지어내지 말 것" },
  feature: { type: ["object", "null"], additionalProperties: false, required: ["id", "label_ko"], properties: { id: { type: "string" }, label_ko: { type: "string", description: "[장점] 중 그 사진이 보여 주는 것 10자 이내" } } },
  package: { type: ["object", "null"], additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
  scene: it({ place_en: { type: "string", description: "실제로 쓰일 한국 장소(영어, 예: a Korean restaurant kitchen)" }, surface_en: { type: "string", description: "제품을 올려 둘 면(영어, 예: a stainless steel prep table)" }, props_en: { type: "array", maxItems: 3, items: { type: "string" }, description: "브랜드 없는 소품 2~3개(영어). 가전·기계 금지" }, situation_en: { type: "string", description: "[타겟]이 이 제품을 쓰는 주 목적이 보이는 순간(영어 한 줄, 예: fresh sliced pork piled on trays ready for a busy shabu-shabu dinner service)" }, person_en: { type: "string", description: "[타겟]과 닮은 실제 소비자 한 명(영어, 예: a Korean restaurant owner in his 40s wearing a white apron). 모델처럼 꾸미지 않은 평범한 사람" } }),
} };
const PICK_SYSTEM = `당신은 쿠팡 썸네일 담당 디자이너입니다. Read 도구로 입력 사진을 **모두 하나씩 열어 본 뒤** 판정합니다. 추측하지 않습니다.
[누끼 후보]는 원본 사진에서 배경을 지운 제품 이미지(흰 바탕)입니다. **candidates 에는 입력 후보를 하나도 빠짐없이 모두** 넣습니다.
same_product 는 [옵션] 사진에 나오는 실제 판매 모델과 같은 제품인지(부품 배치·라벨 위치까지) — 다른 판매자의 비슷한 기계·다른 모델이면 false. 대표이미지는 제품 1대가 잘림 없이, 손·사람·음식·다른 물건 없이 보이는 것이 좋습니다.
[옵션]은 옵션 사진 누끼입니다. 겉모양이 눈에 띄게 다른 것만 고르고, 라벨은 옵션 이름(중국어일 수 있음)에서 구분되는 말만 한국어로 짧게. 가격·배송·광고 문구 금지.
[치수]는 [상품 정보] 글이나 사이즈 사진·[치수 글자]에 실제로 적힌 숫자만 씁니다. [치수 글자]에서 "세로로 쓰인" 숫자는 보통 높이입니다. 사이즈 사진을 열어 치수선이 어느 방향인지 확인하세요. 가로(width)=정면에서 본 폭, 높이(height), 깊이(depth). quote 에 숫자를 가져온 원문을 그대로 적습니다. 확실하지 않으면 null.
[상세 사진] 중 feature 는 글자 없이 핵심 기능·부품을 크게 보여 주는 사진 1장, package 는 구성품(본체+부속)이 한눈에 보이는 사진 1장(없으면 null).
scene 은 이 제품이 실제로 쓰일 장소·면·소품(브랜드·글자 없는 것)과 [타겟]이 쓰는 주 목적 상황·닮은 인물.
appeal 은 썸네일에 얹을 구매 소구점(용량·구성품·핵심 기능) — 원문에 있는 사실만, 쿠팡 엠블럼·로켓배송·무료반품·BEST·1위 같은 말 금지. 응답은 JSON 만.`;

async function pickPlan({ dir, cuts, details, product, allOptions = [], log = noop, model = "sonnet" }) {
  const L = [`[상품] ${product.name}`, product.type ? `[종류] ${product.type}` : "", product.targets?.length ? `[타겟] ${product.targets.slice(0, 4).join(" / ")}` : "", product.adv?.length ? `[장점] ${product.adv.slice(0, 8).join(" / ")}` : "", product.specText ? `[상품 정보] ${product.specText.slice(0, 1200)}` : "", "", "[누끼 후보]"];
  cuts.forEach((c, i) => L.push(`${i + 1}. id=${c.id} · ${c.kind}${c.label ? ` · 옵션 이름: ${c.label.slice(0, 60)}` : ""} · 경로: ${c.prev}`));
  const optIds = cuts.filter((c) => c.kind === "option").map((c) => c.id);
  L.push("", `[옵션] 위 후보 중 ${optIds.length ? optIds.join(", ") : "없음"}`);
  if (allOptions.length) L.push("", "[옵션 이름 전체]", ...allOptions.map((o) => `${o.id}: ${String(o.label || "").slice(0, 70)}`));
  if (product.sizePhoto) L.push("", `[사이즈 사진] ${product.sizePhoto}`);
  const dimHints = cuts.map((c) => { const d = (c.boxes || []).filter((b) => isDimText(b.text)); return d.length ? `${c.id}: ${d.map((b) => `${b.text.trim()}(${Math.abs(Number(b.angle) || 0) > 45 ? "세로로 쓰임" : "가로로 쓰임"})`).join(", ")}` : null; }).filter(Boolean);
  if (dimHints.length) L.push("", "[치수 글자] 원본 사진에 찍힌 치수(OCR)", ...dimHints.slice(0, 8));
  L.push("", `candidates 에 ${cuts.length}개 후보(${cuts.map((c) => c.id).join(", ")}) 모두 판정해 넣으세요.`);
  L.push("", "[상세 사진]"); details.forEach((d, i) => L.push(`${i + 1}. id=${d.id} · ${d.role} · ${d.shows || ""} · 경로: ${d.file}`));
  L.push("", "모든 사진을 열어 본 뒤 JSON 으로 답하세요.");
  log("dim", `  🖼 후보 판정 — 누끼 ${cuts.length}장 · 상세 ${details.length}장 (Claude CLI·${model}·Read)`);
  return runStructured({ purpose: "thumb-pick", system: PICK_SYSTEM, schema: PICK_SCHEMA, text: L.filter((x) => x !== null).join("\n"), model, timeoutMs: 600000, allowedTools: ["Read"] });
}

// ---------- 장면 배경(AI — 제품 없이 배경·소품만) ----------
async function genBackground({ prompt, out, settings = {}, env = process.env, fetchImpl = globalThis.fetch, log = noop }) {
  const prov = resolveProvider({ settings, env });
  if (!prov.key) return { ok: false, error: "이미지 생성 키 없음" };
  if (prov.provider === "openai") return { ok: false, error: "배경 생성은 Gemini·Vertex 만 지원" };
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "1:1" } } };
  const t0 = Date.now();
  const call = async (url, headers) => {
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 120000);
    try { const r = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error(`HTTP ${r.status}: ${String(j?.error?.message || "").slice(0, 120)}`); return j; } finally { clearTimeout(tm); }
  };
  let j = null, err = null, region = null;
  if (prov.provider === "server") { // 수강생 PC: 서버 중계(task:"image")
    const { callRelay } = await import("./relay.js");
    const r = await callRelay("image", { model: prov.model, images: [], prompt, aspect: "1:1" }, { timeoutMs: 200000, log });
    if (r.ok && r.result?.images?.[0]) { const g = r.result.images[0]; j = { candidates: [{ content: { parts: [{ inlineData: { mimeType: g.mime, data: g.b64 } }] } }], usageMetadata: { promptTokenCount: r.usage?.input_tokens || 0, candidatesTokenCount: r.usage?.output_tokens || 0 } }; region = "server"; }
    else err = r.userMessage || r.error;
  } else if (prov.provider === "google") { // 수강생 구글 클라우드 연결
    const { googleAuth } = await import("./google-conn.js");
    try { const a = await googleAuth({ fetchImpl }); for (let k = 0; k < 4 && !j; k++) { try { j = await call(a.vertexUrl(prov.model, "global"), a.headers); region = "google"; } catch (e) { err = String(e.message || e); if (!/429|50[03]/.test(err)) break; await new Promise((r) => setTimeout(r, 15000)); } } }
    catch (e) { err = String(e?.message || e); }
  } else if (prov.provider === "vertex") {
    const t = await getVertexToken(prov.credFile, { fetchImpl });
    const project = prov.project || t.project;
    const router = createRegionRouter({ regions: prov.location !== DEFAULT_VERTEX_LOCATION ? [prov.location] : DEFAULT_SCENE_REGIONS, perRegion: 2, cooldownMs: 20000 });
    for (let a = 0; a < 16 && !j; a++) {
      region = await router.acquire(prov.model); if (!region) break;
      try { j = await call(vertexUrl({ project, location: region, model: prov.model }), { "Content-Type": "application/json", Authorization: `Bearer ${t.token}` }); router.release(region, "ok"); }
      catch (e) { err = String(e.message || e); if (/429/.test(err)) router.release(region, "429"); else if (/404/.test(err)) { router.release(region, "404"); router.markBad(prov.model, region); } else { router.release(region, "err"); if (!/50[03]|abort|fetch failed|ECONNRESET|시간 초과/i.test(err)) break; } } // 시간 초과·끊김은 다음 지역으로
    }
  } else {
    for (let a = 0; a < 3 && !j; a++) { try { j = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(prov.model)}:generateContent`, { "Content-Type": "application/json", "x-goog-api-key": prov.key }); } catch (e) { err = String(e.message || e); if (!/429|50[03]/.test(err)) break; await new Promise((r) => setTimeout(r, 15000)); } }
  }
  const part = (j?.candidates || []).flatMap((c) => c?.content?.parts || []).find((p) => (p.inlineData || p.inline_data)?.data);
  if (!part) return { ok: false, error: err || "응답에 이미지 없음", ms: Date.now() - t0 };
  const d = part.inlineData || part.inline_data;
  fs.writeFileSync(out, Buffer.from(d.data, "base64"));
  const um = j.usageMetadata || {};
  const usd = costOf({ model: prov.model, inTok: Number(um.promptTokenCount) || 0, outTok: Number(um.candidatesTokenCount) || 0 });
  log("dim", `  🖼 장면 배경 생성 ${((Date.now() - t0) / 1000).toFixed(1)}초 · ${prov.provider}${region ? `·${region}` : ""} · $${usd.toFixed(3)}`);
  return { ok: true, file: out, usd, model: prov.model, provider: prov.provider, ms: Date.now() - t0 };
}

// ---------- ③ 그리기(HTML → 1000×1000 캡처) ----------
// 윈도우에는 Apple SD Gothic Neo 가 없어 맑은 고딕으로 바뀌므로, 앱에 든 Pretendard(src/renderer/fonts, OFL)를 그 뒤 순서로 넣는다(맥 결과는 그대로)
const BUNDLED_SANS = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../renderer/fonts/PretendardVariable.woff2")).href;
const BASE_CSS = `@font-face{font-family:"SeedhackSans";font-weight:100 900;src:url("${BUNDLED_SANS}") format("woff2")}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;overflow:hidden;background:#fff;font-family:"Pretendard","Apple SD Gothic Neo","SeedhackSans","Noto Sans KR",sans-serif}
.cv{position:relative;width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;overflow:hidden;background:#fff}.ab{position:absolute}img.p{position:absolute;display:block}
.sh{position:absolute;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,0,0,.30) 0%,rgba(0,0,0,.14) 40%,rgba(0,0,0,0) 70%);filter:blur(5px)}`;
// 바닥 그림자: 제품 바닥 폭의 88%, 높이 = 폭의 7%
// 접지 그림자: 누끼의 열마다 가장 아래 불투명 픽셀(바닥 윤곽)을 따라 진한 띠 + 넓고 연한 띠 → 흐림. 결과는 누끼와 같은 폭, 세로 +12% 의 검정 알파 PNG.
//   사선(3/4) 컷처럼 바닥이 수평이 아니어도 실제로 닿는 윤곽을 따라가서 떠 보이지 않는다.
export function makeContactShadow(cutFile, out, { core = 0.022, soft = 0.07, coreA = 0.55, softA = 0.22 } = {}) {
  const bm = loadBm(cutFile); const { w, h, data } = bm;
  const P = Math.round(w * 0.06), W2 = w + P * 2, H2 = Math.round(h * 1.12), a = new Float32Array(W2 * H2); // 좌우 6% 여백(흐림이 잘리지 않게)
  const tc = Math.max(3, Math.round(h * core)), ts = Math.max(6, Math.round(h * soft));
  for (let x = 0; x < w; x++) {
    let yb = -1; for (let y = h - 1; y >= 0; y--) if (data[(y * w + x) * 4 + 3] > 60) { yb = y; break; }
    if (yb < 0) continue;
    for (let d = -tc; d <= ts; d++) { const y = yb + d; if (y < 0 || y >= H2) continue; const v = d <= tc ? Math.max(coreA * (1 - Math.max(0, d) / (tc + 1)), softA) : softA * (1 - (d - tc) / (ts - tc + 1)); const k = y * W2 + x + P; if (v > a[k]) a[k] = v; }
  }
  const blur = (r) => { // 가로·세로 상자 흐림 1회
    const t = new Float32Array(a.length);
    for (let y = 0; y < H2; y++) { let acc = 0; const o = y * W2; for (let x = 0; x < W2 + r; x++) { if (x < W2) acc += a[o + x]; if (x - 2 * r - 1 >= 0) acc -= a[o + x - 2 * r - 1]; const c = x - r; if (c >= 0 && c < W2) t[o + c] = acc / (2 * r + 1); } }
    for (let x = 0; x < W2; x++) { let acc = 0; for (let y = 0; y < H2 + r; y++) { if (y < H2) acc += t[y * W2 + x]; if (y - 2 * r - 1 >= 0) acc -= t[(y - 2 * r - 1) * W2 + x]; const c = y - r; if (c >= 0 && c < H2) a[c * W2 + x] = acc / (2 * r + 1); } }
  };
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.008)); blur(r); blur(r); blur(r * 2);
  const buf = Buffer.alloc(W2 * H2 * 4);
  for (let i = 0; i < a.length; i++) buf[i * 4 + 3] = Math.round(Math.min(1, a[i]) * 255); // 검정(premultiplied → BGR 0)
  savePng({ data: buf, w: W2, h: H2 }, out);
  return { file: out, padX: P / w, hk: H2 / h };
}
const shadowOf = (cut) => cut.shadow || (cut.shadow = makeContactShadow(cut.cut, cut.cut.replace(/\.png$/, "-shadow.png")));
const shadowHtml = (r, cut, { strength = 1, dx = 0 } = {}) => { const sh = shadowOf(cut); return `<img class="p" src="${furl(sh.file)}" style="left:${Math.round(r.x - r.w * sh.padX + dx)}px;top:${r.y}px;width:${Math.round(r.w * (1 + 2 * sh.padX))}px;height:${Math.round(r.h * sh.hk)}px;opacity:${strength}">`; };

function heroHtml(cut) {
  const r = placeProduct({ w: cut.cutW, h: cut.cutH });
  return { html: `<div class="cv">${shadowHtml(r, cut, { strength: 0.8 })}<img class="p" src="${furl(cut.cut)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div>`, rect: r };
}
function sceneHtml(cut, bg) {
  const r = placeProduct({ w: cut.cutW, h: cut.cutH }, { fill: 0.6 });
  const baseY = THUMB_SIZE * 0.86; r.y = Math.round(baseY - r.h); // 면 위에 세운다(배경 프롬프트: 면이 아래 절반을 채우고 화면 밖까지 이어짐)
  return `<div class="cv"><img class="ab" src="${furl(bg)}" style="left:0;top:0;width:100%;height:100%;object-fit:cover">
  ${shadowHtml(r, cut, { strength: 1, dx: Math.round(r.w * 0.025) })}${shadowHtml(r, cut, { strength: 0.6 })}
  <img class="p" src="${furl(cut.cut)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div>`;
}
function sizeHtml(cut, dims) {
  const r = placeProduct({ w: cut.cutW, h: cut.cutH }, { fill: 0.56, lift: 0.04 });
  if (dims.height != null) r.x -= 110; // 오른쪽에 높이선·글자 자리
  const u = dims.unit || "cm", ln = "#3b3b3b";
  const wLabel = dims.width != null ? `가로 ${fmtDim(dims.width, u)}` : null, hLabel = dims.height != null ? `높이 ${fmtDim(dims.height, u)}` : null, dLabel = dims.depth != null ? fmtDim(dims.depth, u) : null;
  if (hLabel) { // 높이 글자가 오른쪽 끝을 넘지 않게: 글자 폭(글자당 약 25px)만큼 자리를 비우고, 모자라면 제품을 줄인다
    const room = THUMB_SIZE - 36 - (r.x + r.w + 62) - hLabel.length * 25;
    if (room < 0) { r.x = Math.max(36, r.x + room); const over = r.x + r.w + 62 + hLabel.length * 25 - (THUMB_SIZE - 36); if (over > 0) { const k = (r.w - over) / r.w; r.y += Math.round((r.h * (1 - k)) / 2); r.w = Math.round(r.w * k); r.h = Math.round(r.h * k); } }
  }
  const hy = r.y + r.h + 48, vx = r.x + r.w + 48;
  const tick = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ln}" stroke-width="3"/>`;
  const svg = `<svg class="ab" style="left:0;top:0" width="${THUMB_SIZE}" height="${THUMB_SIZE}">
   ${wLabel ? `${tick(r.x, hy, r.x + r.w, hy)}${tick(r.x, hy - 14, r.x, hy + 14)}${tick(r.x + r.w, hy - 14, r.x + r.w, hy + 14)}
     <line x1="${r.x}" y1="${r.y + r.h + 10}" x2="${r.x}" y2="${hy - 16}" stroke="#bbb" stroke-width="2" stroke-dasharray="6 6"/><line x1="${r.x + r.w}" y1="${r.y + r.h + 10}" x2="${r.x + r.w}" y2="${hy - 16}" stroke="#bbb" stroke-width="2" stroke-dasharray="6 6"/>` : ""}
   ${hLabel ? `${tick(vx, r.y, vx, r.y + r.h)}${tick(vx - 14, r.y, vx + 14, r.y)}${tick(vx - 14, r.y + r.h, vx + 14, r.y + r.h)}
     <line x1="${r.x + r.w + 10}" y1="${r.y}" x2="${vx - 16}" y2="${r.y}" stroke="#bbb" stroke-width="2" stroke-dasharray="6 6"/><line x1="${r.x + r.w + 10}" y1="${r.y + r.h}" x2="${vx - 16}" y2="${r.y + r.h}" stroke="#bbb" stroke-width="2" stroke-dasharray="6 6"/>` : ""}</svg>`;
  const lab = (x, y, t, extra = "") => `<div class="ab" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%);background:#fff;padding:2px 12px;font-size:40px;font-weight:800;color:#222;letter-spacing:-.5px;white-space:nowrap;${extra}">${esc(t)}</div>`;
  return `<div class="cv">${shadowHtml(r, cut, { strength: 0.7 })}<img class="p" src="${furl(cut.cut)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${svg}
   ${wLabel ? lab(r.x + r.w / 2, hy, wLabel) : ""}${hLabel ? lab(vx + 14, r.y + r.h / 2, hLabel, "transform:translate(0,-50%)") : ""}
   ${dLabel ? lab(r.x + r.w / 2, hy + 62, `깊이 ${dLabel}`, "font-size:30px;font-weight:700;color:#555") : ""}</div>`;
}
function optionsHtml(items) {
  const n = items.length, cols = n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 24, padO = 40;
  const cw = (THUMB_SIZE - padO * 2 - gap * (cols - 1)) / cols, chh = (THUMB_SIZE - padO * 2 - gap * (rows - 1)) / rows, labH = 64;
  return `<div class="cv">${items.map((c, i) => {
    const cx = padO + (i % cols) * (cw + gap), cy = padO + Math.floor(i / cols) * (chh + gap);
    const r = placeProduct({ w: c.cutW, h: c.cutH }, { size: Math.min(cw, chh - labH), fill: 0.86, lift: 0 });
    const ox = cx + (cw - Math.min(cw, chh - labH)) / 2;
    return `<div class="ab" style="left:${cx}px;top:${cy}px;width:${cw}px;height:${chh}px;background:#f6f6f6;border-radius:24px"></div>
    <img class="p" src="${furl(c.cut)}" style="left:${ox + r.x}px;top:${cy + r.y + 8}px;width:${r.w}px;height:${r.h}px">
    <div class="ab" style="left:${cx}px;top:${cy + chh - labH}px;width:${cw}px;height:${labH - 8}px;display:flex;align-items:center;justify-content:center;font-size:${cols === 2 ? 36 : 30}px;font-weight:800;color:#222;letter-spacing:-.5px">${esc(c.label_ko)}</div>`;
  }).join("")}</div>`;
}
function photoHtml(file, { cover = true, label = "" } = {}) {
  return `<div class="cv"><img class="ab" src="${furl(file)}" style="left:${cover ? 0 : 50}px;top:${cover ? 0 : 50}px;width:${cover ? THUMB_SIZE : THUMB_SIZE - 100}px;height:${cover ? THUMB_SIZE : THUMB_SIZE - 100}px;object-fit:${cover ? "cover" : "contain"}">
  ${label ? `<div class="ab" style="left:40px;top:40px;background:rgba(255,255,255,.94);border-radius:40px;padding:12px 28px;font-size:38px;font-weight:800;color:#222;letter-spacing:-.5px;box-shadow:0 2px 10px rgba(0,0,0,.12)">${esc(label)}</div>` : ""}</div>`;
}

// 소구점: 누끼 왼쪽 크게 + 오른쪽 라벨 2~3개(원본에 있는 사실만)
function appealHtml(cut, labels) {
  const r = placeProduct({ w: cut.cutW, h: cut.cutH }, { fill: 0.66, lift: 0 }); r.x = Math.round(THUMB_SIZE * 0.36 - r.w / 2); if (r.x < 30) r.x = 30;
  const top = Math.round((THUMB_SIZE - labels.length * 140) / 2);
  return `<div class="cv" style="background:#f7f7f5">${shadowHtml(r, cut, { strength: 0.7 })}<img class="p" src="${furl(cut.cut)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">
  ${labels.map((t, i) => `<div class="ab" style="right:40px;top:${top + i * 140}px;width:380px;min-height:112px;background:#fff;border-radius:22px;box-shadow:0 4px 18px rgba(0,0,0,.08);display:flex;align-items:center;gap:16px;padding:0 24px"><b style="font-size:30px;color:#16a34a;font-weight:900">${pad2(i + 1)}</b><span style="font-size:${t.length > 8 ? 28 : 34}px;font-weight:800;color:#1f2937;letter-spacing:-1px;line-height:1.2;white-space:nowrap">${esc(t)}</span></div>`).join("")}</div>`;
}
// 상세페이지 일부: 이어 붙인 슬라이스(폭 W)에서 섹션 [y, y+h)를 1000×1000 안에. 780보다 길면 위에서 780만, 짧으면 가운데.
function detailCropHtml(slices, W, sec) {
  const k = THUMB_SIZE / W, h = Math.min(sec.h, W), boxH = Math.round(h * k), top = Math.round((THUMB_SIZE - boxH) / 2);
  let y = 0; const imgs = slices.map((sl) => { const t = `<img class="ab" src="${furl(sl.file)}" style="left:0;top:${Math.round(y * k)}px;width:${THUMB_SIZE}px;height:${Math.round(sl.h * k)}px">`; y += sl.h; return t; }).join("");
  return `<div class="cv" style="background:#fff"><div class="ab" style="left:0;top:${top}px;width:${THUMB_SIZE}px;height:${boxH}px;overflow:hidden"><div class="ab" style="left:0;top:${-Math.round(sec.y * k)}px">${imgs}</div></div></div>`;
}
// 지금 상세페이지 렌더(현재 선택) → { slices:[{file,h}], W, sections:[{type,y}], docH }
function currentRender(dir) {
  const r = readJson(path.join(dir, "result.json")); if (!r) return null;
  const c = (r.renders || []).find((x) => x.id === r.current) || (r.renders || []).at(-1) || r;
  const slices = (c.slices || []).map((x) => ({ file: path.join(dir, x.file), h: x.h, w: x.w })).filter((x) => fs.existsSync(x.file) && x.h);
  if (!slices.length) return null;
  const W = c.width || slices[0].w || 780;
  return { slices, W, sections: c.sections || [], docH: slices.reduce((t, x) => t + x.h, 0) };
}

async function renderHtml(win, html, stageDir, out) {
  const f = path.join(stageDir, `${path.basename(out, ".jpg")}.html`);
  fs.writeFileSync(f, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${html}</body></html>`);
  await win.loadFile(f);
  await win.webContents.executeJavaScript(`Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
  await new Promise((r) => setTimeout(r, 120));
  let im = await win.webContents.capturePage({ x: 0, y: 0, width: THUMB_SIZE, height: THUMB_SIZE });
  const sz = im.getSize(); if (sz.width !== THUMB_SIZE || sz.height !== THUMB_SIZE) im = im.resize({ width: THUMB_SIZE, height: THUMB_SIZE, quality: "best" });
  let q = 92, buf = im.toJPEG(q); while (buf.length > MAX_BYTES && q > 60) { q -= 8; buf = im.toJPEG(q); }
  fs.writeFileSync(out, buf);
  return { file: out, bytes: buf.length, bm: { data: Buffer.from(im.toBitmap()), w: THUMB_SIZE, h: THUMB_SIZE } };
}

// ---------- ④ 최종 비전 검수(Claude CLI 1회) ----------
const CHECK_SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: it({ id: { type: "string" }, same_product: { type: "boolean", description: "[실제 사진]의 제품과 모양·비율·부품이 같은가(색·각도 차이는 허용)" }, product_cut_off: { type: "boolean" }, other_brand_logo: { type: "boolean", description: "다른 회사 로고·상표가 보이는가" }, coupang_mark: { type: "boolean", description: "쿠팡 엠블럼(BEST·쿠팡추천 등)이나 로켓배송·무료반품·무료배송 문구가 보이는가" }, chinese_text: { type: "boolean", description: "중국어 글자가 보이는가" }, any_text: { type: "boolean", description: "글자가 보이는가(치수 숫자·옵션 라벨 제외, 제품 라벨 포함)" }, looks_natural: { type: "boolean", description: "합성이 자연스러운가(떠 있음·크기 어색·그림자 방향 이상이면 false)" }, note: { type: "string", description: "문제가 있으면 한 줄, 없으면 빈 문자열" } }) } } };
const CHECK_SYSTEM = `당신은 쿠팡 썸네일 검수자입니다. Read 도구로 각 썸네일과 그 [비교 원본]을 모두 열어 본 뒤 판정합니다. 썸네일 속 제품이 비교 원본의 제품과 같은 모양인지(부품 수·비율·형태) 가장 엄격하게 봅니다.
판정 대상은 썸네일뿐입니다 — 비교 원본에 있는 글자·로고·배경은 판정에 넣지 않습니다.
대표 B컷은 비교 원본 첫 장(이 상품의 대표)과 **같은 제품**이어야 합니다 — 각도만 다른 같은 기계면 true, 다른 기계·다른 모델이면 same_product=false. 옵션 모음은 칸마다 다른 옵션이 정상이며, 각 칸이 비교 원본(옵션 사진)과 같은지만 봅니다.
사이즈 썸네일의 치수 숫자, 옵션 모음의 옵션 이름, 기능 사진의 라벨 1개, 소구점 라벨은 글자로 치지 않습니다. 상세 일부는 한글 상세페이지를 자른 것이라 글자가 정상이며(same_product 는 true 로), 글자가 잘렸는지(product_cut_off)·쿠팡 엠블럼/로켓배송/무료반품 문구가 있는지를 봅니다. 응답은 JSON 만.`;
async function finalCheck({ items, product, log = noop, model = "sonnet" }) { // items[].ref = 비교 원본 경로들
  const text = [`[상품] ${product.name}`, "", "[썸네일]", ...items.map((x, i) => `${i + 1}. id=${x.id} · ${KINDS[x.kind].name} · 경로: ${x.file}\n   비교 원본: ${(x.ref || []).join(" , ")}`), "", "모든 사진을 열어 본 뒤 JSON 으로 답하세요."].join("\n");
  log("dim", `  🖼 최종 검수 ${items.length}장 (Claude CLI·${model}·Read)`);
  return runStructured({ purpose: "thumb-check", system: CHECK_SYSTEM, schema: CHECK_SCHEMA, text, model, timeoutMs: 600000, allowedTools: ["Read"] });
}

// ---------- 전체 ----------
// dir: 상세페이지 작업 폴더. onStep({ step, msg, pct }) — 실제 진행만. 반환 thumb.json 내용
export async function makeThumbs({ dir, settings = {}, env = process.env, log = noop, onStep = noop, model = "sonnet", checkModel = "sonnet", noScene = false } = {}) {
  const T0 = Date.now(), timings = {}, cost = { claudeUsd: 0, imageUsd: 0 };
  const lap = (k, t) => (timings[k] = Date.now() - t);
  const tdir = path.join(dir, "thumb");
  fs.rmSync(path.join(tdir, "work"), { recursive: true, force: true });
  for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir) : []) if (/^\d\d-.*\.jpg$/.test(f)) fs.rmSync(path.join(tdir, f), { force: true });
  fs.mkdirSync(path.join(tdir, "work", "stage"), { recursive: true });
  if (!cliAvailable()) throw new Error("Claude CLI가 없습니다 — 썸네일 판정·검수에 필요");
  const brief = readJson(path.join(dir, "brief.json")) || {}, info = readJson(path.join(dir, "info.json")) || {}, vision = readJson(path.join(dir, "vision.json")) || { items: [] };
  const { src, cands, ocrById } = collectSources(dir);
  const specText = [info.brief_text || "", ...(src.attrs || []).map((a) => `${a.k_ko || a.k_zh}: ${a.v_ko || a.v_zh}`)].join("\n").replace(/\n{2,}/g, "\n");
  const product = { name: info.product_name_ko || brief.product_name_ko || src.coupangName || src.title_ko || src.title_zh || "", type: brief.product_type || "", adv: brief.advantages || brief.buying_factors || [], targets: brief.targets || [], specText };

  onStep({ step: "cutout", msg: `제품 사진 ${cands.length}장 누끼 따는 중`, pct: 5 });
  let t = Date.now();
  let cuts = await buildCutouts(dir, tdir, cands, { log }); lap("cutout", t);
  const allOptCuts = cuts.filter((c) => c.kind === "option"); // 옵션별 대표이미지는 판정 수와 상관없이 전부
  { const op = cuts.filter((c) => c.kind === "option"); if (op.length > 8) { const keep = new Set(Array.from({ length: 8 }, (_, i) => op[Math.round((i * (op.length - 1)) / 7)].id)); cuts = cuts.filter((c) => c.kind !== "option" || keep.has(c.id)); } } // 옵션이 많으면 고르게 8장만 판정(비용·누락 방지)
  if (!cuts.length) throw new Error("누끼를 딸 수 있는 대표·옵션 사진이 없습니다");

  // 상세 사진 후보(기능·구성품): 비전 검수에서 쓸 수 있고 글자 없는 사진
  const cleanOf = (id) => ["", "_full"].map((s) => path.join(dir, "clean", `${id}${s}.png`)).find((f) => fs.existsSync(f));
  const details = (vision.items || []).filter((v) => v.usable && !v.has_text && !v.any_logo_visible && ["detail", "feature", "package", "scene"].includes(v.role) && v.subject !== "infographic")
    .map((v) => ({ id: v.id, role: v.role, shows: v.shows, file: cleanOf(v.id) })).filter((d) => d.file).slice(0, 12);
  const sizeV = (vision.items || []).find((v) => v.role === "size");
  const dimCand = cands.map((c) => ({ c, n: (c.boxes || []).filter((b) => isDimText(b.text)).length })).sort((a, b) => b.n - a.n)[0];
  const sizePhoto = (sizeV && cleanOf(sizeV.id)) || (dimCand?.n >= 2 ? dimCand.c.file : null); // 사이즈 사진이 없으면 치수 글자가 가장 많은 원본(옵션 사진의 치수선)
  // 치수 근거: 상품 정보 글 + 대표·옵션·사이즈 사진에 찍힌 글자(OCR) — 여기 없는 숫자는 쓰지 않는다
  const groundText = [specText, ...cands.map((c) => c.id), sizeV?.id].filter(Boolean).map((x) => (x === specText ? x : (ocrById.get(x) || []).map((b) => b.text).join(" "))).join("\n");

  onStep({ step: "pick", msg: `대표이미지 후보 ${cuts.length}장 고르는 중`, pct: 20 });
  t = Date.now();
  const pk = await pickPlan({ dir, cuts, details, product: { ...product, sizePhoto }, allOptions: cands.filter((c) => c.kind === "option"), log, model }); lap("pick", t);
  if (pk.error) throw new Error(`후보 판정 실패: ${pk.error}`);
  cost.claudeUsd += Number(pk.costUsd) || 0;
  const plan = pk.result;
  const vById = new Map((plan.candidates || []).map((v) => [v.id, v]));
  for (const c of cuts) c.v = vById.get(c.id) || null;
  const hero = pickHero(cuts);
  if (!hero) throw new Error("대표이미지로 쓸 수 있는 사진이 없습니다(제품 전체가 손·물건 없이 보이는 사진 없음)");
  log("go", `■ 대표 후보 → ${hero.id}${hero.erased?.length ? ` (제품 위 글자 ${hero.erased.length}곳 지움: ${hero.erased.slice(0, 4).join(", ")})` : ""}`);

  // 장면 배경(병렬로 먼저 시작)
  // 장면 2장: ① 주 목적 상황(사람 없음) ② 타겟과 닮은 인물이 뒤에서 일하는 장면 — 둘 다 제품 자리는 비우고 실제 누끼를 얹는다
  const sc = plan.scene || {};
  const bgJobs = [
    { id: "scene", file: path.join(tdir, "work", "scene-bg.png"), prompt: sceneBackgroundPrompt({ place: sc.place_en, surface: sc.surface_en, props: sc.props_en, situation: sc.situation_en }) },
    ...(sc.person_en ? [{ id: "scene_person", file: path.join(tdir, "work", "scene-person-bg.png"), prompt: sceneBackgroundPrompt({ place: sc.place_en, surface: sc.surface_en, props: (sc.props_en || []).slice(0, 2), situation: sc.situation_en, person: sc.person_en }) }] : []),
  ];
  t = Date.now();
  const bgPs = bgJobs.map((b) => (noScene ? Promise.resolve({ ok: false, error: "건너뜀" }) : genBackground({ prompt: b.prompt, out: b.file, settings, env, log }).catch((e) => ({ ok: false, error: String(e.message || e) }))));

  onStep({ step: "render", msg: "대표이미지·사이즈·옵션 그리는 중", pct: 40 });
  const win = new BrowserWindow({ show: false, width: THUMB_SIZE, height: THUMB_SIZE, useContentSize: true, frame: false, enableLargerThanScreen: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(10);
  const stage = path.join(tdir, "work", "stage");
  const items = []; let n = 0;
  const outName = (kind) => path.join(tdir, `${pad2(++n)}-${kind}.jpg`);
  const notes = [], optionMains = [];
  try {
    const t1 = Date.now();
    const h = heroHtml(hero);
    const hr = await renderHtml(win, h.html, stage, outName("hero"));
    items.push({ id: "hero", kind: "hero", file: hr.file, bytes: hr.bytes, pixel: inspectHero(hr.bm), from: [hero.id], erased: hero.erased || [] });

    // 사이즈: 원본 글에 있는 숫자만
    const dims = plan.dims;
    if (dims && (dims.width != null || dims.height != null) && dimsGrounded(dims, groundText)) {
      const r = await renderHtml(win, sizeHtml(hero, dims), stage, outName("size"));
      items.push({ id: "size", kind: "size", file: r.file, bytes: r.bytes, from: [hero.id], dims });
    } else notes.push(dims ? `사이즈: 치수 숫자가 원본 글에서 확인되지 않아 뺐습니다(${dims.quote || "-"})` : "사이즈: 원본에 치수가 없어 뺐습니다");

    // 옵션 모음: 겉모양이 다른 옵션 2~6개
    const opts = (plan.options || []).map((o) => { const c = cuts.find((x) => x.id === o.id && x.kind === "option" && x.v?.whole_product !== false); return c ? { ...c, ...(c.thinCut || {}), label_ko: tidyOptionLabel(o.label_ko) } : null; }).filter((o) => o?.cut && o.label_ko);
    if (opts.length >= 2) { const r = await renderHtml(win, optionsHtml(opts.slice(0, 6)), stage, outName("options")); items.push({ id: "options", kind: "options", file: r.file, bytes: r.bytes, from: opts.map((o) => o.id), labels: opts.map((o) => o.label_ko) }); }
    else notes.push("옵션: 겉모양이 다른 옵션이 2개 미만이라 뺐습니다");

    // 기능 확대·구성품: 실제 상세 사진
    const fd = plan.feature && details.find((d) => d.id === plan.feature.id && d.role !== "scene"); // 기능 확대는 부품·기능 사진만(사용 장면 사진 제외)
    if (fd) { const r = await renderHtml(win, photoHtml(fd.file, { cover: true, label: tidyOptionLabel(plan.feature.label_ko) }), stage, outName("feature")); items.push({ id: "feature", kind: "feature", file: r.file, bytes: r.bytes, from: [fd.id], label: plan.feature.label_ko }); }
    const pd = plan.package && details.find((d) => d.id === plan.package.id && d.id !== fd?.id && d.role === "package"); // 사진 검수에서 구성품(package)으로 본 사진만
    if (pd) { const r = await renderHtml(win, photoHtml(pd.file, { cover: false }), stage, outName("package")); items.push({ id: "package", kind: "package", file: r.file, bytes: r.bytes, from: [pd.id] }); }
    timings.render = Date.now() - t1;

    // 소구점(용량·구성품·핵심 기능) — 원문 근거 있는 라벨만, IPR 문구 금지
    const appeal = (plan.appeal || []).map((a) => String(a.label_ko || "").trim()).filter((l) => appealOk(l, `${specText}\n${product.adv.join("\n")}`));
    if (appeal.length >= 2) { const r = await renderHtml(win, appealHtml(hero, appeal.slice(0, 3)), stage, outName("appeal")); items.push({ id: "appeal", kind: "appeal", file: r.file, bytes: r.bytes, from: [hero.id], labels: appeal.slice(0, 3) }); }
    else notes.push("소구점: 원문 근거가 있는 라벨이 2개 미만이라 뺐습니다");

    // 대표 B컷: 대표 다음으로 좋은 다른 사진(각도·모습이 다른 것)
    { const hh = colorHist(loadBm(hero.cut)); for (const c of cuts) c.match = Math.round(histMatch(hh, colorHist(loadBm(c.cut))) * 100) / 100; }
    const bc = pickBcut(cuts, hero);
    if (bc) { const r = await renderHtml(win, heroHtml(bc.thinCut ? { ...bc, ...bc.thinCut } : bc).html, stage, outName("bcut")); items.push({ id: "bcut", kind: "bcut", file: r.file, bytes: r.bytes, pixel: inspectHero(r.bm), from: [bc.id] }); }

    onStep({ step: "scene", msg: "사용 장면 배경 만드는 중(AI는 배경·인물만)", pct: 55 });
    const bgs = await Promise.all(bgPs); timings.sceneBg = Date.now() - t;
    for (const [i, bg] of bgs.entries()) {
      const job = bgJobs[i];
      if (!bg.ok) { notes.push(`${KINDS[job.id].name}: 배경 생성 실패(${bg.error})`); continue; }
      cost.imageUsd += bg.usd || 0;
      const r = await renderHtml(win, sceneHtml(hero, bg.file), stage, path.join(tdir, "work", `${job.id}.jpg`));
      items.push({ id: job.id, kind: job.id, file: r.file, bytes: r.bytes, from: [hero.id], bg: path.relative(dir, bg.file), prompt: job.prompt });
    }

    // 추가이미지 9장 채우기: 모자라면 한글 상세페이지를 1000×1000 으로 잘라 넣는다
    const need = MAX_EXTRA - items.filter((x) => x.kind !== "hero").length;
    const cr = need > 0 ? currentRender(dir) : null;
    if (need > 0 && !cr) notes.push(`추가이미지 ${MAX_EXTRA - need}장 — 상세페이지 결과가 없어 9장을 채우지 못했습니다`);
    if (cr) for (const sec of pickDetailSections(cr.sections, cr.docH, need + 4)) { // 검수에서 빠질 장을 생각해 4장 더 — 통과한 것만 남긴다
      const r = await renderHtml(win, detailCropHtml(cr.slices, cr.W, sec), stage, outName(`detail${sec.i}`));
      items.push({ id: `detail${sec.i}`, kind: "detail", file: r.file, bytes: r.bytes, from: [`section${sec.i}`], section: { type: sec.type, y: sec.y, h: sec.h } });
    }

    // 옵션별 대표이미지(SKU 마다 한 장, 흰 바탕 규정형)
    onStep({ step: "options", msg: `옵션별 대표이미지 ${allOptCuts.length}장 그리는 중`, pct: 65 });
    const names = new Map((plan.option_names || []).map((o) => [o.id, String(o.name_ko || "").trim()]));
    fs.rmSync(path.join(tdir, "options"), { recursive: true, force: true }); fs.mkdirSync(path.join(tdir, "options"), { recursive: true });
    for (const c of allOptCuts) {
      const nm = names.get(c.id) || c.label;
      if (c.v && (c.v.whole_product === false || c.v.hands_or_people)) { optionMains.push({ id: c.id, name: nm, src: c.label, status: "bad", issues: [{ level: "bad", why: c.v.hands_or_people ? "손·사람이 함께 있음" : "제품이 잘림" }] }); continue; }
      const r = await renderHtml(win, heroHtml(c.thinCut ? { ...c, ...c.thinCut } : c).html, stage, path.join(tdir, "options", `${c.id}.jpg`));
      const j = judgeThumb("hero", { pixel: inspectHero(r.bm), bytes: r.bytes });
      if (hasIprText(nm)) j.issues.push({ level: "warn", why: "옵션 이름에 광고·배송 문구" });
      optionMains.push({ id: c.id, name: nm, src: c.label, file: path.relative(dir, r.file), issues: j.issues, status: j.issues.some((x) => x.level === "bad") ? "bad" : j.issues.length ? "warn" : "ok" });
    }
  } finally { try { win.destroy(); } catch {} }
  // 순서: 대표 → 연출(인물·장면) → 소구점 → 정보 → B컷 → 상세 일부, 추가이미지 최대 9장. 파일 번호를 그 순서로 다시 매긴다
  { const ord = orderItems(items, Infinity); items.length = 0; items.push(...ord); }

  onStep({ step: "check", msg: `${items.length}장 검수 중(실제 제품과 같은 모양인지)`, pct: 75 });
  t = Date.now();
  // 비교 원본: 대표·장면·사이즈 = 대표 누끼(흰 바탕) · 옵션 = 쓴 옵션 누끼들 · 기능·구성품 = 그 사진
  const prevOf = (id) => cuts.find((c) => c.id === id)?.prev;
  for (const x of items) x.ref = x.kind === "bcut" ? [hero.prev, ...x.from.map(prevOf)].filter(Boolean) : x.kind === "options" ? x.from.map(prevOf).filter(Boolean) : ["feature", "package"].includes(x.kind) ? x.from.map((id) => details.find((d) => d.id === id)?.file).filter(Boolean) : x.kind === "detail" ? [] : [hero.prev];
  const ck = await finalCheck({ items, product, log, model: checkModel }); lap("check", t);
  if (ck.error) notes.push(`최종 검수 실패: ${ck.error}`); else cost.claudeUsd += Number(ck.costUsd) || 0;
  const vcById = new Map((ck.result?.items || []).map((x) => [x.id, x]));
  for (const x of items) {
    const vc = vcById.get(x.id) || null;
    Object.assign(x, judgeThumb(x.kind, { pixel: x.pixel, vc, bytes: x.bytes }), { vc });
    if ((x.labels || []).concat(x.label || []).some(hasIprText)) { x.issues.push({ level: "bad", why: "IPR·광고 문구" }); x.status = "bad"; }
    if (!vc) x.issues.push({ level: "warn", why: "비전 검수 결과 없음" }), x.status = x.status === "ok" ? "warn" : x.status;
  }
  // 채우기용(상세 일부·B컷)은 검수에서 빠진 장을 버리고, 추가이미지 9장까지만 남긴 뒤 파일 번호를 그 순서로 다시 매긴다
  { const keep = orderItems(items.filter((x) => !((x.kind === "detail" || x.kind === "bcut") && x.status === "bad"))); for (const x of items) if (!keep.includes(x)) fs.rmSync(x.file, { force: true }); items.length = 0; items.push(...keep); }
  items.forEach((x, i) => { const want = path.join(tdir, `${pad2(i + 1)}-${x.kind}.jpg.tmp`); fs.renameSync(x.file, want); x.file = want; });
  items.forEach((x, i) => { const want = path.join(tdir, `${pad2(i + 1)}-${x.kind}.jpg`); fs.renameSync(x.file, want); x.file = want; });
  for (const x of items) { delete x.pixel?.box; x.file = path.relative(dir, x.file); x.ref = (x.ref || []).map((f) => path.relative(dir, f)); }
  // 옵션별 대표이미지도 대표 규정(글자·로고·잘림) 비전 검수 — 가벼운 모델 1회
  const om = optionMains.filter((o) => o.file);
  if (om.length) {
    onStep({ step: "check", msg: `옵션별 대표이미지 ${om.length}장 검수 중`, pct: 90 });
    t = Date.now();
    const oc = await finalCheck({ items: om.map((o) => ({ id: o.id, kind: "hero", file: path.join(dir, o.file), ref: [cuts.find((c) => c.id === o.id)?.prev || allOptCuts.find((c) => c.id === o.id)?.prev].filter(Boolean) })), product, log, model: "haiku" }); lap("optionCheck", t);
    if (oc.error) notes.push(`옵션 대표 검수 실패: ${oc.error}`); else cost.claudeUsd += Number(oc.costUsd) || 0;
    const byId = new Map((oc.result?.items || []).map((x) => [x.id, x]));
    for (const o of om) { const vc = byId.get(o.id); if (!vc) continue; const j = judgeThumb("hero", { vc }); o.issues.push(...j.issues); o.vc = vc; o.status = o.issues.some((x) => x.level === "bad") ? "bad" : o.issues.length ? "warn" : "ok"; }
  }
  const sum = summarizeSet(items);
  const out = { version: 2, optionMains, createdAt: new Date().toISOString(), product: product.name, hero: { id: hero.id, kind: hero.kind, file: path.relative(dir, hero.file), erased: hero.erased || [] }, items, summary: sum, notes,
    candidates: cuts.map((c) => ({ id: c.id, kind: c.kind, v: c.v, match: c.match, touchesEdge: !!c.touchesEdge, coverage: c.coverage, cut: path.relative(dir, c.cut), erased: c.erased || [] })),
    plan: { options: plan.options, option_names: plan.option_names, appeal: plan.appeal, dims: plan.dims, feature: plan.feature, package: plan.package, scene: plan.scene },
    cost: { ...cost, totalUsd: cost.claudeUsd + cost.imageUsd }, timings: { ...timings, total: Date.now() - T0 } };
  writeJson(path.join(tdir, "thumb.json"), out);
  onStep({ step: "done", msg: `완료 · ${items.length}장`, pct: 100 });
  log("go", `■ 썸네일 ${items.length}장 · 통과 ${sum.pass} · 확인 ${sum.warn} · 빼기 ${sum.bad} · ${((Date.now() - T0) / 1000).toFixed(0)}초 · $${out.cost.totalUsd.toFixed(3)}`);
  return out;
}

// 결과 읽기(화면용 절대경로 포함)
export function readThumbs(dir) {
  const j = readJson(path.join(dir, "thumb", "thumb.json"));
  if (!j) return null;
  return { ...j, items: (j.items || []).map((x) => ({ ...x, path: path.join(dir, x.file) })), optionMains: (j.optionMains || []).map((o) => ({ ...o, path: o.file ? path.join(dir, o.file) : null })) };
}
// 내보내기: 빼기(bad) 아닌 장을 thumb/export/ 에 01_대표이미지.jpg … 로 복사(1000×1000 JPG 그대로)
export function exportThumbs(dir, { ids = null } = {}) {
  const j = readThumbs(dir); if (!j) return { error: "만든 썸네일이 없습니다" };
  const outDir = path.join(dir, "thumb", "export"); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  const pick = ids ? j.items.filter((x) => ids.includes(x.id)) : exportPick(j.items); // 화면 순서 그대로 · 0번 = 대표
  const files = pick.map((x, i) => { const f = path.join(outDir, `${pad2(i + 1)}_${i === 0 ? "대표이미지" : `추가_${KINDS[x.kind].name.replace(/[·\s()]/g, "")}`}.jpg`); fs.copyFileSync(x.path, f); return f; });
  const om = (j.optionMains || []).filter((o) => o.path && o.status !== "bad");
  if (om.length) { const od = path.join(outDir, "옵션별_대표이미지"); fs.mkdirSync(od, { recursive: true }); om.forEach((o, i) => { const f = path.join(od, `${pad2(i + 1)}_${String(o.name || o.id).replace(/[\\/:*?"<>|]/g, "").slice(0, 30)}.jpg`); fs.copyFileSync(o.path, f); files.push(f); }); }
  return { ok: true, dir: outDir, files };
}

// ---------- IPC ----------
export function initThumb({ ipcMain, app, store, log = noop, send = noop }) {
  const autoOn = () => (store?.get?.("settings") || {}).thumbAuto !== false; // 기본 켬
  const root = () => path.join(app.getPath("userData"), "detail");
  const dirOf = (jobId) => { const id = String(jobId || ""); if (!/^[\w.-]+$/.test(id)) return null; const d = path.join(root(), id); return fs.existsSync(d) ? d : null; };
  const runs = new Map(); // jobId → { step, msg, pct, error, t0 }
  ipcMain.handle("thumb:get", (_e, p = {}) => { const d = dirOf(p.jobId); if (!d) return { error: "작업 폴더가 없습니다" }; return { run: runs.get(p.jobId) || null, result: readThumbs(d) }; });
  const run = (p = {}) => {
    const d = dirOf(p.jobId); if (!d) return { error: "작업 폴더가 없습니다" };
    if (runs.get(p.jobId)?.running) return { ok: true, already: true };
    const st = { running: true, step: "start", msg: "시작", pct: 0, t0: Date.now() }; runs.set(p.jobId, st);
    makeThumbs({ dir: d, settings: store?.get?.("settings") || {}, log: (lv, m) => log?.(lv, m), onStep: (s) => Object.assign(st, s) })
      .then(() => { st.running = false; st.done = true; send("detail:changed", { thumb: { jobId: p.jobId, status: "done" } }); })
      .catch((e) => { st.running = false; st.error = String(e?.message || e); log?.("dim", `  🖼 썸네일 실패: ${st.error}`); send("detail:changed", { thumb: { jobId: p.jobId, status: "failed" } }); });
    return { ok: true };
  };
  ipcMain.handle("thumb:run", (_e, p = {}) => run(p));
  // 화면에서 고치기: 대표 바꾸기 · 빼기/넣기 · 순서 — thumb.json 에 바로 저장
  ipcMain.handle("thumb:update", (_e, p = {}) => {
    const d = dirOf(p.jobId); if (!d) return { error: "작업 폴더가 없습니다" };
    const f = path.join(d, "thumb", "thumb.json"); const j = readJson(f); if (!j) return { error: "만든 썸네일이 없습니다" };
    const next = applyEdit(j.items, { op: p.op, id: p.id, dir: p.dir });
    if (next.error) return next;
    j.items = next; j.edited = Date.now(); j.summary = { ...summarizeSet(next), recommended: next[0]?.id || null };
    writeJson(f, j);
    return { ok: true, result: readThumbs(d) };
  });
  ipcMain.handle("thumb:settings", (_e, p = {}) => {
    if (typeof p.thumbAuto === "boolean") store?.set?.("settings", { ...(store.get("settings") || {}), thumbAuto: p.thumbAuto });
    return { thumbAuto: autoOn() };
  });
  ipcMain.handle("thumb:export", (_e, p = {}) => { const d = dirOf(p.jobId); if (!d) return { error: "작업 폴더가 없습니다" }; const r = exportThumbs(d, { ids: Array.isArray(p.ids) ? p.ids : null }); if (r.ok && p.open !== false) shell.openPath(r.dir); return r; });
  ipcMain.handle("thumb:openFolder", (_e, p = {}) => { const d = dirOf(p.jobId); if (!d) return { error: "작업 폴더가 없습니다" }; shell.openPath(path.join(d, "thumb")); return { ok: true }; });
  // 상세페이지가 끝나면 자동으로(index.js afterDone 이 뒤 검수가 끝난 뒤 부른다). 이미 만든 썸네일이 있거나 스위치를 껐으면 안 한다.
  //  busy(): 상세페이지 쪽이 아직 돌면 true — 끝날 때까지 기다렸다 시작(Claude CLI 를 동시에 쓰지 않게)
  return {
    auto(jobId, { busy = () => false } = {}) {
      const d = dirOf(jobId); if (!d || !autoOn()) return false;
      if (fs.existsSync(path.join(d, "thumb", "thumb.json")) || runs.get(jobId)?.running) return false;
      runs.set(jobId, { running: true, waiting: true, step: "wait", msg: "상세페이지 검수가 끝나면 바로 시작해요", pct: 0, t0: Date.now() });
      const go = (k = 0) => { if (busy() && k < 180) return setTimeout(() => go(k + 1), 5000); runs.delete(jobId); log?.("sys", `▶ 🖼 썸네일 자동 만들기 · ${jobId}`); run({ jobId }); };
      go(); return true;
    },
  };
}
