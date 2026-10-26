// 누끼 — 맥이 아닌 PC(수강생 윈도우)용. onnxruntime-node + BiRefNet_lite/U²-Net 을 따로 띄운 Node 프로세스(cutout-worker.mjs)에서 돌린다.
// 모델 파일은 설치본에 넣지 않고 처음 쓸 때 <userData>/detail/models/ 에 내려받아 sha256 을 확인한다(cutout-core.js MODELS 의 주소·해시).
//   SEEDHACK_ONNX_MODELS=<폴더> — 이미 받아 둔 모델 폴더(개발·시험) · SEEDHACK_CUTOUT_MODEL=birefnet|u2net — 모델 강제
// 큰 모델이 실패(메모리 부족으로 일꾼이 죽음 등)하면 남은 장은 U²-Net 으로 다시 한다. 둘 다 안 되면 { ok:false } — 파이프라인은 사진 그대로 계속.
import { app, nativeImage, net } from "electron";
import { fork } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, pickModel, upscaleMask, alphaStats, applyAlpha } from "./cutout-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const noop = () => {};
const modelsDir = () => process.env.SEEDHACK_ONNX_MODELS || path.join(app.getPath("userData"), "detail", "models");

export function hasOnnx() { try { import.meta.resolve("onnxruntime-node"); return true; } catch { return false; } }
export function chooseModel(settings = {}) {
  return pickModel({ totalGB: os.totalmem() / 2 ** 30, freeGB: os.freemem() / 2 ** 30, want: process.env.SEEDHACK_CUTOUT_MODEL || settings.cutoutModel || null });
}

const sha256File = (f) => new Promise((res, rej) => { const h = crypto.createHash("sha256"); fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });
const verified = new Set();
// 모델 파일 준비(없으면 내려받기 → sha256 확인). → 파일 경로 또는 throw(한국어)
export async function ensureModel(key, { log = noop } = {}) {
  const m = MODELS[key], dir = modelsDir(), f = path.join(dir, m.file);
  if (verified.has(f)) return f;
  if (fs.existsSync(f) && fs.statSync(f).size === m.bytes && (await sha256File(f)) === m.sha256) { verified.add(f); return f; }
  fs.mkdirSync(dir, { recursive: true });
  const part = `${f}.part`, t0 = Date.now();
  log("dim", `  ✂️ 누끼 모델 내려받는 중(처음 한 번, ${Math.round(m.bytes / 1e6)}MB) …`);
  const r = await (net?.fetch ? net.fetch(m.url) : fetch(m.url));
  if (!r.ok || !r.body) throw new Error(`누끼 모델을 내려받지 못했어요(${r.status}). 인터넷 연결을 확인해 주세요.`);
  const ws = fs.createWriteStream(part);
  const reader = r.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (!ws.write(Buffer.from(value))) await new Promise((res) => ws.once("drain", res)); }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
  const got = await sha256File(part);
  if (got !== m.sha256) { try { fs.rmSync(part, { force: true }); } catch {} throw new Error("누끼 모델 파일이 손상됐어요(확인 값 불일치). 다시 해 주세요."); }
  fs.renameSync(part, f);
  log("dim", `  ✂️ 누끼 모델 준비 완료 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  verified.add(f);
  return f;
}

// 일꾼 1개: start → run(bgra) 여러 번 → stop
function startWorker(file, cfg) {
  const child = fork(path.join(here, "cutout-worker.mjs"), [], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, serialization: "advanced",
    stdio: process.env.SEEDHACK_CUTOUT_DEBUG ? "inherit" : ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const waits = new Map(); let seq = 0, dead = null, loaded;
  const fail = (why) => { dead = why; for (const w of waits.values()) w.reject(new Error(why)); waits.clear(); };
  child.on("exit", (code, sig) => fail(`누끼 일꾼이 멈춤(${sig || `코드 ${code}`}) — 메모리 부족일 수 있음`));
  child.on("error", (e) => fail(`누끼 일꾼을 띄우지 못함: ${e.message}`));
  child.on("message", (m) => {
    if (m?.type === "loaded") loaded.resolve();
    else if (m?.type === "error" && m.id == null) loaded.reject(new Error(m.error));
    const w = waits.get(m?.id); if (!w) return; waits.delete(m.id);
    m.type === "mask" ? w.resolve(m.mask) : w.reject(new Error(m.error || "누끼 실패"));
  });
  const ready = new Promise((resolve, reject) => { loaded = { resolve, reject }; });
  child.send({ type: "load", file, cfg });
  return {
    ready: Promise.race([ready, new Promise((_, rej) => child.once("exit", () => rej(new Error(dead || "일꾼 종료"))))]),
    run(bgra, S, timeoutMs = 120000) {
      if (dead) return Promise.reject(new Error(dead));
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { waits.delete(id); reject(new Error("누끼 시간 초과")); }, timeoutMs);
        waits.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
        child.send({ type: "run", id, bgra, S });
      });
    },
    stop() { try { child.kill(); } catch {} },
  };
}

// items: [{ id, file, out(임시 알파 PNG 경로) }] → [{ id, ok, out, w, h, bbox, coverage, error? }] — cutout-mac 출력과 같은 모양
export async function cutoutOnnx(items, { log = noop, onEach = noop, settings = {} } = {}) {
  let key = chooseModel(settings);
  const res = [];
  let worker = null, cfg = null;
  const open = async (k) => {
    cfg = MODELS[k];
    const f = await ensureModel(k, { log });
    worker = startWorker(f, cfg);
    await worker.ready;
    log("dim", `  ✂️ 누끼(${k} · ONNX · 메모리 ${Math.round(os.totalmem() / 2 ** 30)}GB PC)`);
  };
  try { await open(key); }
  catch (e) {
    worker?.stop(); worker = null;
    if (key !== "u2net") { log("dim", `  ✂️ ${key} 준비 실패(${String(e.message).slice(0, 80)}) → u2net`); key = "u2net"; try { await open(key); } catch (e2) { return items.map((it) => ({ id: it.id, ok: false, error: e2.message })); } }
    else return items.map((it) => ({ id: it.id, ok: false, error: e.message }));
  }
  try {
    for (const it of items) {
      let rec = { id: it.id, file: it.file, ok: false, error: "결과 없음" };
      try {
        const im = nativeImage.createFromPath(it.file);
        if (im.isEmpty()) throw new Error("이미지를 읽지 못함");
        const { width: w, height: h } = im.getSize();
        const S = cfg.size;
        const sq = Buffer.from(im.resize({ width: S, height: S, quality: "best" }).toBitmap());
        let mask;
        try { mask = await worker.run(new Uint8Array(sq), S); }
        catch (e) { // 큰 모델이 죽으면 U²-Net 으로 바꿔 이 장부터 다시
          if (key === "u2net") throw e;
          log("dim", `  ✂️ ${key} 실패(${String(e.message).slice(0, 60)}) → u2net 으로 계속`);
          worker.stop(); key = "u2net"; await open(key);
          const sq2 = Buffer.from(im.resize({ width: cfg.size, height: cfg.size, quality: "best" }).toBitmap());
          mask = await worker.run(new Uint8Array(sq2), cfg.size);
        }
        const a = upscaleMask(mask, cfg.size, w, h), st = alphaStats(a, w, h);
        if (st.ok) {
          const out = nativeImage.createFromBitmap(applyAlpha(im.toBitmap(), a), { width: w, height: h });
          fs.writeFileSync(it.out, out.toPNG());
          rec = { id: it.id, file: it.file, ok: true, out: it.out, w, h, bbox: st.bbox, coverage: st.coverage, model: key };
        } else rec = { id: it.id, file: it.file, ok: false, w, h, error: st.error, model: key };
      } catch (e) { rec.error = String(e?.message || e).slice(0, 160); }
      res.push(rec); onEach(rec);
    }
  } finally { worker?.stop(); }
  return res;
}
