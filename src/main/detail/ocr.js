// OCR — 상세 이미지에서 중국어 글자 상자(x,y,w,h,text)를 찾는다. 규약: docs/detail/CONTRACTS.md 3절
// 제공자: vision(macOS Vision, tools/ocr-mac/ocr.swift 를 첫 실행 때 swiftc 로 컴파일) → server(대시보드 서버 task:"ocr" = Google Cloud Vision, 수강생 윈도우 PC)
//   → tesseract(tesseract.js, 서버를 못 쓸 때 — 중국어 약함) → none(상자 0개, 파이프라인은 계속). SEEDHACK_RELAY=server 면 맥에서도 server
import { app } from "electron";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasCJK } from "./image-core.js";
import { forceServer, relayEnabled, prepImage, callRelay } from "./relay.js";
import { googleConnected, googleAuth, googleError } from "./google-conn.js";
import { visionLines } from "./vision-lines.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SWIFT_SRC = path.join(here, "..", "..", "..", "tools", "ocr-mac", "ocr.swift").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep); // 설치판: asarUnpack 으로 풀어 둔 경로(swiftc 는 asar 안을 못 읽음)
const userData = () => { try { return app.getPath("userData"); } catch { return path.join(os.tmpdir(), "seedhack-detail"); } };
const binDir = () => path.join(userData(), "detail", "bin");
const binPath = () => path.join(binDir(), "ocr-mac");
const tessDir = () => path.join(userData(), "detail", "tessdata");
const noop = () => {};

let swiftcOk = null; // swiftc 사용 가능 여부(한 번만 검사)
export function hasSwiftc() {
  if (swiftcOk != null) return swiftcOk;
  if (process.platform !== "darwin") return (swiftcOk = false);
  if (process.env.SEEDHACK_OCR_NO_SWIFTC) return (swiftcOk = false); // 하네스용: swiftc 없는 상황(윈도우·CLT 미설치) 흉내
  try { execFileSync("xcrun", ["-f", "swiftc"], { stdio: "ignore", timeout: 15000 }); swiftcOk = true; }
  catch { swiftcOk = fs.existsSync("/usr/bin/swiftc"); }
  return swiftcOk;
}
let tessOk = null;
export function hasTesseract() {
  if (tessOk != null) return tessOk;
  try { import.meta.resolve("tesseract.js"); tessOk = true; } catch { tessOk = false; }
  return tessOk;
}

// darwin + (이미 컴파일된 바이너리 또는 swiftc) → vision, 아니면 tesseract.js 가 있으면 tesseract, 둘 다 없으면 none
export function pickProvider() {
  if (["vision", "server", "google", "tesseract"].includes(process.env.SEEDHACK_OCR_PROVIDER)) return process.env.SEEDHACK_OCR_PROVIDER; // 시험용: OCR 만 따로 고정
  if (!forceServer() && process.platform === "darwin" && (fs.existsSync(binPath()) || hasSwiftc())) return "vision";
  if (googleConnected() && !forceServer()) return "google"; // 수강생 구글 클라우드(무료 체험)로 Cloud Vision 직접
  if (relayEnabled()) return "server";
  if (hasTesseract()) return "tesseract";
  return "none";
}

// ---- Vision(macOS) ----
let visionBin = null;   // 준비된 바이너리 경로
let visionFail = null;  // 컴파일 실패 사유(한국어) — 한 번 실패하면 다시 시도하지 않는다
// 바이너리가 없거나 소스가 더 새로우면 swiftc 로 컴파일. 실패하면 null 과 함께 한국어 안내를 로그에 남긴다.
export async function ensureVisionBinary({ log = noop } = {}) {
  if (visionBin) return visionBin;
  if (visionFail) return null;
  if (process.platform !== "darwin") { visionFail = "macOS 가 아니어서 Vision OCR 을 쓸 수 없습니다"; return null; }
  const bin = binPath();
  let fresh = false;
  try {
    const bs = fs.statSync(bin), ss = fs.statSync(SWIFT_SRC);
    fresh = bs.mtimeMs >= ss.mtimeMs && bs.size > 0;
  } catch {}
  if (fresh) return (visionBin = bin);
  if (!fs.existsSync(SWIFT_SRC)) { visionFail = `OCR 소스가 없습니다: ${SWIFT_SRC}`; log("dim", `  🔎 ${visionFail}`); return null; }
  if (!hasSwiftc()) {
    visionFail = "swiftc 가 없어 macOS Vision OCR 을 만들 수 없습니다. 터미널에서 `xcode-select --install` 로 Xcode 명령줄 도구를 설치해 주세요. 그동안은 tesseract OCR 로 대신합니다.";
    log("dim", `  🔎 ${visionFail}`);
    return null;
  }
  fs.mkdirSync(binDir(), { recursive: true });
  log("dim", `  🔎 Vision OCR 도구 컴파일 중(처음 한 번) … swiftc -O ocr.swift`);
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    execFile("swiftc", ["-O", SWIFT_SRC, "-o", bin], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, (err, _so, se) => resolve({ err, se: String(se || "") }));
  });
  if (r.err || !fs.existsSync(bin)) {
    visionFail = `Vision OCR 도구 컴파일에 실패했습니다(${(r.se || r.err?.message || "").trim().split("\n")[0].slice(0, 160)}). Xcode 명령줄 도구(xcode-select --install)를 확인해 주세요. tesseract OCR 로 대신합니다.`;
    log("dim", `  🔎 ${visionFail}`);
    return null;
  }
  log("dim", `  🔎 Vision OCR 도구 준비 완료 (${((Date.now() - t0) / 1000).toFixed(1)}초) → ${bin}`);
  return (visionBin = bin);
}
export const visionFailReason = () => visionFail;

// 바이너리 실행: 파일 여러 개 → [{ file, w, h, boxes, error? }]
function runVision(bin, files, langs = null) {
  return new Promise((resolve, reject) => {
    execFile(bin, files, { timeout: 120000, maxBuffer: 64 * 1024 * 1024, ...(langs ? { env: { ...process.env, SEEDHACK_OCR_LANGS: langs } } : {}) }, (err, so, se) => {
      if (err) return reject(new Error(`ocr-mac 실행 실패: ${(String(se || "") || err.message).trim().slice(0, 200)}`));
      try { resolve(JSON.parse(String(so)).images || []); } catch (e) { reject(new Error(`ocr-mac 출력 해석 실패: ${e.message}`)); }
    });
  });
}

// ---- tesseract.js ----
let tessWorker = null; // 워커 1개 재사용
let tessFail = null;
async function getTessWorker({ log = noop } = {}) {
  if (tessWorker) return tessWorker;
  if (tessFail) throw new Error(tessFail);
  let mod;
  try { mod = await import("tesseract.js"); } catch (e) { tessFail = `tesseract.js 가 설치되어 있지 않습니다: ${e?.message || e}`; throw new Error(tessFail); }
  const dir = tessDir();
  fs.mkdirSync(dir, { recursive: true });
  const cached = fs.existsSync(path.join(dir, "chi_sim.traineddata")) && fs.existsSync(path.join(dir, "eng.traineddata"));
  log("dim", `  🔎 tesseract OCR 준비 중${cached ? "" : " — 중국어 언어 데이터를 처음 한 번 내려받습니다(약 10~20MB)"} …`);
  try {
    const w = await mod.createWorker("chi_sim+eng", 1, { cachePath: dir, gzip: true, logger: noop, errorHandler: noop });
    await w.setParameters({ preserve_interword_spaces: "1" });
    tessWorker = w;
    return w;
  } catch (e) {
    tessFail = `tesseract OCR 을 준비하지 못했습니다(${String(e?.message || e).slice(0, 120)}) — 언어 데이터 내려받기에 네트워크가 필요합니다`;
    throw new Error(tessFail);
  }
}
export async function closeTesseract() {
  if (tessWorker) { try { await tessWorker.terminate(); } catch {} tessWorker = null; }
}
async function runTesseract(file, opts) {
  const w = await getTessWorker(opts);
  const { data } = await w.recognize(file, {}, { blocks: true, text: false });
  const boxes = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const text = String(l.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const bb = l.bbox;
    boxes.push({ x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0, text, conf: Math.round((l.confidence || 0) * 10) / 1000 });
  }
  return boxes;
}

// ---- 서버(Google Cloud Vision) ----
// 한 장씩 보낸다(긴 상세 이미지는 장당 수백 KB). 보낸 크기 기준 좌표를 원래 크기로 되돌린다. 한도·로그인 실패면 남은 장은 부르지 않는다.
async function runServerOcr(im, langs, direct = false) {
  let p = null;
  for (const [side, q] of [[4000, 90], [3000, 85], [2200, 80]]) { p = await prepImage(im.file, { maxSide: side, quality: q }); if (p.b64.length <= 3_400_000) break; }
  let res;
  if (direct) { // 수강생 구글: vision.googleapis.com 직접
    const a = await googleAuth();
    const hints = String(langs || "zh-Hans,en").split(",").map((x) => x.trim().split("-")[0]).filter(Boolean);
    const rr = await fetch(a.visionUrl, { method: "POST", headers: a.headers, body: JSON.stringify({ requests: [{ image: { content: p.b64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }], imageContext: { languageHints: hints } }] }) });
    const j = await rr.json().catch(() => ({}));
    if (!rr.ok) { const e = new Error(googleError(rr.status, j?.error?.message)); if (rr.status === 403 || rr.status === 400) e.code = "approval"; throw e; }
    const one = j.responses?.[0] || {}, pg = one.fullTextAnnotation?.pages?.[0];
    res = { w: pg?.width || 0, h: pg?.height || 0, boxes: one.error ? [] : visionLines(one.fullTextAnnotation), ...(one.error ? { error: String(one.error.message || "").slice(0, 120) } : {}) };
  } else {
    const r = await callRelay("ocr", { images: [{ id: im.id, mime: p.mime, b64: p.b64 }], langs: langs || "zh-Hans,en" }, { timeoutMs: 90000 });
    if (!r.ok) { const e = new Error(r.userMessage || r.error); e.code = r.code; throw e; }
    res = r.result?.images?.[0] || {};
  }
  const k = p.scale > 0 && p.scale < 1 ? 1 / p.scale : 1;
  const sc = (v) => Math.round(v * k);
  const boxes = (res.boxes || []).map((b) => ({ ...b, x: sc(b.x), y: sc(b.y), w: sc(b.w), h: sc(b.h), ...(Array.isArray(b.quad) ? { quad: b.quad.map(sc) } : {}) }));
  return { w: res.w ? sc(res.w) : im.w || 0, h: res.h ? sc(res.h) : im.h || 0, boxes, error: res.error };
}

// ---- 공통 ----
// 상자 마무리: 공백 정리, 빈 상자 제거, CJK 없는 상자는 latin:true, 너무 낮은 신뢰도 제거
function finishBoxes(boxes) {
  const out = [];
  for (const b of boxes || []) {
    const text = String(b.text || "").trim();
    if (!text || !(b.w > 0) || !(b.h > 0)) continue;
    if (b.conf != null && b.conf < 0.15) continue;
    const o = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), text, conf: b.conf == null ? 1 : Math.round(b.conf * 1000) / 1000 };
    if (Array.isArray(b.quad) && b.quad.length === 8) { o.quad = b.quad; o.angle = b.angle ?? 0; } // Vision: 기울어진 글의 네 꼭짓점·기울기(도)
    if (b.vertical) o.vertical = true; // 서버(Cloud Vision)가 읽은 세로쓰기 줄
    if (!hasCJK(text)) o.latin = true;
    out.push(o);
  }
  return out;
}

// 이미지 크기(픽셀) — Vision 은 결과에 들어오고, tesseract 는 nativeImage 로 읽는다
async function sizeOf(file) {
  try { const { nativeImage } = await import("electron"); const s = nativeImage.createFromPath(file).getSize(); return { w: s.width, h: s.height }; } catch { return { w: 0, h: 0 }; }
}

// 파일 하나 → { w, h, boxes, provider }
export async function ocrFile(file, { provider, log = noop } = {}) {
  const r = await ocrImages([{ id: path.basename(file), file }], { provider, log });
  const im = r.images[0] || { w: 0, h: 0, boxes: [] };
  return { w: im.w, h: im.h, boxes: im.boxes, provider: r.provider };
}

// images: [{ id, file, w?, h? }] → { provider, images:[{ id, w, h, boxes }] }
// onProgress({ done, total, id }) 를 이미지마다 부른다. 실패한 이미지는 상자 0개로 두고 계속한다.
// langs: Vision 인식 언어("ko-KR,en-US" — 레퍼런스 한국어 상세). 없으면 중국어 기본
export async function ocrImages(images, { onProgress = noop, log = noop, provider, langs = null } = {}) {
  const list = (images || []).filter((im) => im && im.file);
  const total = list.length;
  let prov = provider || pickProvider();
  let bin = null;
  if (prov === "vision") {
    bin = await ensureVisionBinary({ log });
    if (!bin) prov = hasTesseract() ? "tesseract" : "none";
  }
  if (prov === "server" && !relayEnabled()) prov = hasTesseract() ? "tesseract" : "none";
  if (prov === "tesseract") {
    try { await getTessWorker({ log }); } catch (e) { log("dim", `  🔎 ${e.message} → OCR 없이 계속합니다`); prov = "none"; }
  }
  const out = [];
  let done = 0, failedN = 0, lastErr = null; // 서버·구글 OCR 이 실패한 장 수(index.js 가 대부분 실패면 멈춘다)
  if (prov === "vision") {
    const CHUNK = 6; // 몇 장씩 묶어 한 번에(프로세스 실행 비용↓, 진행 표시는 묶음마다)
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK);
      let res = [];
      try { res = await runVision(bin, part.map((p) => p.file), langs); }
      catch (e) { log("dim", `  🔎 Vision OCR 실패(${part.map((p) => p.id).join(",")}): ${e.message}`); }
      for (const im of part) {
        const r = res.find((x) => x.file === im.file) || res.shift?.() || null;
        if (r?.error) log("dim", `  🔎 ${im.id}: ${r.error}`);
        out.push({ id: im.id, w: r?.w || im.w || 0, h: r?.h || im.h || 0, boxes: finishBoxes(r?.boxes) });
        done++;
        onProgress({ done, total, id: im.id });
      }
    }
  } else if (prov === "server" || prov === "google") {
    const direct = prov === "google";
    let stop = null, i = 0; failedN = 0;
    const one = async () => {
      while (i < list.length) {
        const im = list[i++];
        let r = null;
        if (!stop) { try { r = await runServerOcr(im, langs, direct); } catch (e) { failedN++; lastErr = String(e?.message || e).slice(0, 160); log("dim", `  🔎 서버 OCR 실패(${im.id}): ${lastErr.slice(0, 120)}`); if (["login", "approval", "wing", "pages", "daily", "global", "unsupported"].includes(e.code)) stop = e.message; } }
        else failedN++;
        if (r?.error) log("dim", `  🔎 ${im.id}: ${r.error}`);
        const s = r?.w ? { w: r.w, h: r.h } : im.w && im.h ? { w: im.w, h: im.h } : await sizeOf(im.file);
        out.push({ id: im.id, w: s.w, h: s.h, boxes: finishBoxes(r?.boxes) });
        done++;
        onProgress({ done, total, id: im.id });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, list.length || 1) }, one)); // 동시 4장
    out.sort((a, b) => list.findIndex((x) => x.id === a.id) - list.findIndex((x) => x.id === b.id));
    prov = direct ? "gcv-direct" : "gcv";
  } else if (prov === "tesseract") {
    for (const im of list) {
      let boxes = [];
      try { boxes = await runTesseract(im.file, { log }); } catch (e) { log("dim", `  🔎 tesseract 실패(${im.id}): ${String(e?.message || e).slice(0, 120)}`); }
      const s = im.w && im.h ? { w: im.w, h: im.h } : await sizeOf(im.file);
      out.push({ id: im.id, w: s.w, h: s.h, boxes: finishBoxes(boxes) });
      done++;
      onProgress({ done, total, id: im.id });
    }
  } else {
    for (const im of list) {
      const s = im.w && im.h ? { w: im.w, h: im.h } : await sizeOf(im.file);
      out.push({ id: im.id, w: s.w, h: s.h, boxes: [] });
      done++;
      onProgress({ done, total, id: im.id });
    }
  }
  const nBox = out.reduce((s, im) => s + im.boxes.length, 0);
  log("dim", `  🔎 OCR(${prov}) ${total}장 → 글자 상자 ${nBox}개${failedN ? ` · 실패 ${failedN}장` : ""}`);
  return { provider: prov, images: out, failed: failedN, error: lastErr };
}
