// 누끼 ONNX 순수 함수(전처리·후처리) — cutout-onnx.js(본체)·cutout-worker.mjs(일꾼)·테스트가 같이 쓴다. Electron 없이 돈다.
// 모델 표: 2026-10-23 비교(씨드핵 작업 12장, mac Vision 대비 IoU 중앙값) — side-session-notes/…/cutout-windows-eval.md
//   birefnet: BiRefNet_lite fp16(MIT) IoU 0.92 · 1장 4~6초(M4) · 메모리 8~9.7GB — 일반 node 에서는 되지만 Electron(ELECTRON_RUN_AS_NODE·utilityProcess) 안에서는
//             큰 할당에서 죽는다(SIGTRAP·코드 5, 맥 16GB 실측) → 설정으로만 켠다(cutoutModel:"birefnet", 실패하면 u2net 으로 자동)
//   u2net:    U²-Net(Apache-2.0)      IoU 0.82 · 0.3초 · 메모리 2.1GB → 기본
export const MODELS = {
  birefnet: { file: "birefnet_lite_fp16.onnx", size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], sigmoid: true, bytes: 114538221,
    sha256: "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402", url: "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx", license: "MIT", memGB: 10 },
  u2net: { file: "u2net.onnx", size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], sigmoid: false, bytes: 175997641,
    sha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491", url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx", license: "Apache-2.0", memGB: 2.5 },
};

// 모델 고르기: 설정(want)이 있으면 그것, 아니면 U²-Net. BiRefNet 은 설정해도 메모리가 모자라면(전체 24GB 미만이고 남은 12GB 미만) U²-Net
export function pickModel({ totalGB, freeGB, want = null } = {}) {
  if (want === "birefnet") return totalGB >= 24 || freeGB >= 12 ? "birefnet" : "u2net";
  return want && MODELS[want] ? want : "u2net";
}

// 이미 S×S 로 줄인 BGRA 비트맵 → NCHW float32 [1,3,S,S] (rembg 와 같게: 최댓값으로 나눈 뒤 (x-mean)/std)
export function makeInputSquare(bgra, S, cfg) {
  const n = S * S;
  let mx = 1e-6;
  for (let i = 0; i < n; i++) { const b = bgra[i * 4], g = bgra[i * 4 + 1], r = bgra[i * 4 + 2]; if (r > mx) mx = r; if (g > mx) mx = g; if (b > mx) mx = b; }
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    t[i] = (bgra[i * 4 + 2] / mx - cfg.mean[0]) / cfg.std[0];
    t[n + i] = (bgra[i * 4 + 1] / mx - cfg.mean[1]) / cfg.std[1];
    t[2 * n + i] = (bgra[i * 4] / mx - cfg.mean[2]) / cfg.std[2];
  }
  return t;
}
// 모델 출력(첫 출력 [1,1,S,S]) → S×S 알파(0~255): 필요하면 sigmoid, 최소~최대로 늘림
export function maskSquare(data, S, cfg) {
  const n = S * S, m = new Float32Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { let v = Number(data[i]); if (cfg.sigmoid) v = 1 / (1 + Math.exp(-v)); m[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo > 1e-6 ? hi - lo : 1, g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = Math.round(((m[i] - lo) / span) * 255);
  return g;
}
// S×S 알파 → w×h (쌍선형)
export function upscaleMask(g, S, w, h) {
  const a = new Uint8Array(w * h), fx = S / w, fy = S / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(S - 1, Math.max(0, (y + 0.5) * fy - 0.5)), y0 = Math.floor(sy), y1 = Math.min(S - 1, y0 + 1), wy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(S - 1, Math.max(0, (x + 0.5) * fx - 0.5)), x0 = Math.floor(sx), x1 = Math.min(S - 1, x0 + 1), wx = sx - x0;
      const v = (g[y0 * S + x0] * (1 - wx) + g[y0 * S + x1] * wx) * (1 - wy) + (g[y1 * S + x0] * (1 - wx) + g[y1 * S + x1] * wx) * wy;
      a[y * w + x] = Math.round(v);
    }
  }
  return a;
}
// 알파 → { bbox, coverage } (cutout-mac 과 같은 규약: 0.5 넘는 픽셀)
export function alphaStats(a, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x] > 127) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX < 0) return { ok: false, bbox: null, coverage: 0, error: "전경을 찾지 못함" };
  return { ok: true, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, coverage: +(n / (w * h)).toFixed(4) };
}
// BGRA 비트맵에 알파를 넣는다(nativeImage 비트맵은 알파 곱한 색 — 색도 같이 곱한다)
export function applyAlpha(bgra, a) {
  const out = Buffer.from(bgra);
  for (let i = 0; i < a.length; i++) { const al = a[i]; out[i * 4] = Math.round((out[i * 4] * al) / 255); out[i * 4 + 1] = Math.round((out[i * 4 + 1] * al) / 255); out[i * 4 + 2] = Math.round((out[i * 4 + 2] * al) / 255); out[i * 4 + 3] = al; }
  return out;
}

// 전경 상자 안 OCR 글자 상자 면적 6% 넘거나 글자 상자 6개 이상 → 글자 위주 이미지
export function textHeavy(bbox, boxes) {
  if (!bbox || !boxes?.length) return false;
  let area = 0, n = 0;
  for (const b of boxes) {
    if (b.latin) continue;
    const w = Math.min(b.x + b.w, bbox.x + bbox.w) - Math.max(b.x, bbox.x), h = Math.min(b.y + b.h, bbox.y + bbox.h) - Math.max(b.y, bbox.y);
    if (w > 0 && h > 0) { area += w * h; n++; }
  }
  return n >= 6 || area / (bbox.w * bbox.h) > 0.06;
}
