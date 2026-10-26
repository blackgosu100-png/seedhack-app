// 누끼(전경 분리) — macOS Vision VNGenerateForegroundInstanceMaskRequest (tools/cutout-mac/cutout.swift) 로 제품만 남긴 알파 PNG 를 만든다.
// ocr.js 와 같은 패턴: 첫 실행 때 swiftc 로 <userData>/detail/bin/cutout-mac 컴파일(소스가 더 새로우면 다시). 실패하면 ok:false 로 돌려주고 파이프라인은 계속.
// 맥이 아니면(수강생 윈도우) cutout-onnx.js(BiRefNet/U²-Net, 앱 안에서). SEEDHACK_RELAY=server 또는 SEEDHACK_CUTOUT=onnx 면 맥에서도 ONNX(윈도우 흉내).
import { app } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasSwiftc } from "./ocr.js";
import { finishCutout } from "./image.js";
import { textHeavy } from "./cutout-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SWIFT_SRC = path.join(here, "..", "..", "..", "tools", "cutout-mac", "cutout.swift");
const userData = () => { try { return app.getPath("userData"); } catch { return path.join(os.tmpdir(), "seedhack-detail"); } };
const binPath = () => path.join(userData(), "detail", "bin", "cutout-mac");
const noop = () => {};

let bin = null, fail = null;
export const cutoutFailReason = () => fail;
// 바이너리 준비(없거나 소스가 더 새로우면 컴파일). 실패하면 null + 한국어 사유.
export async function ensureCutoutBinary({ log = noop } = {}) {
  if (bin) return bin;
  if (fail) return null;
  if (process.platform !== "darwin") { fail = "macOS 가 아니어서 누끼(Vision)를 쓸 수 없습니다 — 사진을 그대로 씁니다"; return null; }
  const b = binPath();
  let fresh = false;
  try { const bs = fs.statSync(b), ss = fs.statSync(SWIFT_SRC); fresh = bs.mtimeMs >= ss.mtimeMs && bs.size > 0; } catch {}
  if (fresh) return (bin = b);
  if (!fs.existsSync(SWIFT_SRC)) { fail = `누끼 도구 소스가 없습니다: ${SWIFT_SRC}`; log("dim", `  ✂️ ${fail}`); return null; }
  if (!hasSwiftc()) { fail = "swiftc 가 없어 누끼 도구를 만들 수 없습니다(`xcode-select --install`). 사진을 그대로 씁니다."; log("dim", `  ✂️ ${fail}`); return null; }
  fs.mkdirSync(path.dirname(b), { recursive: true });
  log("dim", "  ✂️ 누끼 도구 컴파일 중(처음 한 번) … swiftc -O cutout.swift");
  const t0 = Date.now();
  const r = await new Promise((resolve) => execFile("swiftc", ["-O", SWIFT_SRC, "-o", b], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, (err, _so, se) => resolve({ err, se: String(se || "") })));
  if (r.err || !fs.existsSync(b)) {
    fail = `누끼 도구 컴파일 실패(${(r.se || r.err?.message || "").trim().split("\n")[0].slice(0, 160)}) — 사진을 그대로 씁니다`;
    log("dim", `  ✂️ ${fail}`);
    return null;
  }
  log("dim", `  ✂️ 누끼 도구 준비 완료 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  return (bin = b);
}

function run(b, outDir, files) {
  return new Promise((resolve, reject) => {
    execFile(b, [outDir, ...files], { timeout: 180000, maxBuffer: 64 * 1024 * 1024 }, (err, so, se) => {
      if (err) return reject(new Error(`cutout-mac 실행 실패: ${(String(se || "") || err.message).trim().slice(0, 200)}`));
      try { resolve(JSON.parse(String(so)).images || []); } catch (e) { reject(new Error(`cutout-mac 출력 해석 실패: ${e.message}`)); }
    });
  });
}

// items: [{ id, file, out, boxes? }] → [{ id, out, w, h, bbox, coverage, ok, cutoutOk, reason, rect, palette?, textCut }]  boxes = OCR 글자 상자(있으면 가장자리 배지·글자 띠를 잘라냄)
//  out: 후처리(여백 12% 자르기·가장자리 페더)까지 끝난 알파 PNG. ok=false(전경 없음/도구 없음)면 out 없음.
//  cutoutOk=false 는 "누끼는 됐지만 제품 단독 컷으로 쓰기엔 부적절"(전경이 너무 작거나 장면 사진) — 이때는 사진을 그대로 쓴다.
const useOnnx = () => process.platform !== "darwin" || process.env.SEEDHACK_CUTOUT === "onnx" || process.env.SEEDHACK_RELAY === "server";
export async function cutoutImages(items, { onProgress = noop, log = noop, margin = 0.12, feather = 2, settings = {} } = {}) {
  const list = (items || []).filter((it) => it && it.file && it.out);
  const total = list.length;
  let onnx = null;
  if (useOnnx()) { try { onnx = await import("./cutout-onnx.js"); if (!onnx.hasOnnx()) { onnx = null; fail = "누끼 도구(onnxruntime)가 없어 사진을 그대로 씁니다"; } } catch (e) { onnx = null; fail = `누끼 도구를 불러오지 못함(${String(e?.message || e).slice(0, 80)}) — 사진을 그대로 씁니다`; } }
  const b = onnx ? "onnx" : useOnnx() ? null : await ensureCutoutBinary({ log });
  const out = [];
  if (!b) {
    list.forEach((it, i) => { out.push({ id: it.id, out: null, w: 0, h: 0, bbox: null, coverage: 0, ok: false, cutoutOk: false, reason: fail }); onProgress({ done: i + 1, total, id: it.id }); });
    return out;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seedhack-cutout-"));
  const CHUNK = onnx ? 4 : 6; // ONNX 는 묶음마다 일꾼(모델 적재)을 새로 띄운다 — 큰 모델 메모리를 묶음 사이에 돌려준다
  let done = 0, okN = 0;
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    let res = [];
    try { res = onnx ? await onnx.cutoutOnnx(part.map((p, k) => ({ id: p.id, file: p.file, out: path.join(tmp, `${i + k}.png`) })), { log, settings }) : await run(b, tmp, part.map((p) => p.file)); }
    catch (e) { log("dim", `  ✂️ 누끼 실패(${part.map((p) => p.id).join(",")}): ${e.message}`); }
    for (const it of part) {
      const r = res.find((x) => x.file === it.file);
      let rec = { id: it.id, out: null, w: r?.w || 0, h: r?.h || 0, bbox: r?.ok ? r.bbox : null, coverage: r?.coverage || 0, ok: false, cutoutOk: false, reason: r?.error || "결과 없음" };
      if (r?.ok && r.out && onnx && textHeavy(r.bbox, it.boxes)) rec.reason = "글자가 많은 이미지(인포그래픽) — 사진 그대로"; // U²-Net 은 글자 띠·표까지 전경으로 딴다(mac Vision 은 이런 장을 거절)
      else if (r?.ok && r.out) {
        try {
          const f = finishCutout(r.out, it.out, { bbox: r.bbox, coverage: r.coverage, margin, feather, boxes: it.boxes || null });
          rec = { id: it.id, out: f.cutoutOk ? it.out : null, w: f.w, h: f.h, bbox: r.bbox, coverage: r.coverage, ok: true, cutoutOk: f.cutoutOk, reason: f.reason, rect: f.rect, palette: f.palette, textCut: f.textCut || 0 };
          if (f.cutoutOk) okN++;
        } catch (e) { rec.reason = `후처리 실패: ${e?.message || e}`; }
      }
      out.push(rec);
      done++;
      onProgress({ done, total, id: it.id, cutoutOk: rec.cutoutOk });
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  log("dim", `  ✂️ 누끼 ${total}장 → 제품 단독 컷 ${okN}장`);
  return out;
}
