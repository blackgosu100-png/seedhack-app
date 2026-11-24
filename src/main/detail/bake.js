// 🖼 통째 한글화(bake) — 원본 이미지 + 우리 카피(원문→한국어 표)를 이미지 AI 에 주고, 결과를 다시 읽어 검수한다. 규칙·검수는 bake-core.js
// 인증: 수강생 구글 연결(google-conn.js) 또는 개발용 Vertex 자격증명(scene.js resolveProvider). 그 밖(서버 중계·AI Studio 키·OpenAI)은 건너뜀 → 예전 방식.
// 한도: 분당 요청 수가 낮다(동시 4장이면 429, 2026-11-23 실측) → 부르는 쪽에서 동시 2 이하 + 여기서 429 는 기다렸다 다시.
import fs from "node:fs";
import path from "node:path";
import { BAKE_MODEL, bakePrompt, verifyBake } from "./bake-core.js";
import { resolveProvider, getVertexToken, vertexUrl } from "./scene.js";
import { googleAuth } from "./google-conn.js";
import os from "node:os";
import { codexBin, codexImage } from "./codex-bin.js";
export { codexBin };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mimeOf = (f) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");
export const BAKE_USD = 0.134; // 장당 추정(출력 1,120토큰 × $120/100만) — 구글 요금표로 확정 전

// 🧪 내부용: 이 컴퓨터의 ChatGPT 앱에 든 명령줄(codex)로 그린다 — ChatGPT 로그인(구독)을 쓰므로 키가 필요 없다. 맥은 ChatGPT 앱, 윈도우는 codex 설치·로그인 필요(codex-bin.js)
// ✍ GPT 에게 문구까지 맡기는 지시(2026-11-24 실측: 우리 문구표를 그리게만 할 때보다 제목이 짧고 자리에 맞는다). 쓴 문구는 text.json 으로 돌려받아 검수·고치기에 쓴다
export function codexFreePrompt({ brief = null, retry = null } = {}) {
  const name = String(brief?.product_name_ko || "").trim();
  return [`첨부한 그림 in.jpg 는 중국 쇼핑몰 상품 상세페이지의 한 장입니다.${name ? ` 상품은 "${name}" 입니다.` : ""} 한국 쇼핑몰에 올릴 한국어 상세페이지 그림으로 바꿔 주세요.`, "",
    "[문구]",
    "- 중국어를 그대로 옮기지 말고, 한국 쇼핑몰 상세페이지에서 실제로 쓰는 자연스러운 말로 직접 다시 쓰세요. 제목은 짧고 힘 있게, 설명은 읽기 쉽게 줄을 나눕니다.",
    "- 원문에 없는 기능·효과·숫자는 지어내지 않습니다. 숫자와 단위는 원문 그대로 둡니다.",
    "- 판매자 홍보, 가격·할인·배송·환불 약속, 후기, 다른 상품 추천 글은 빼고 그 자리는 배경으로 자연스럽게 메웁니다.",
    "- 영문 상표·모델명은 그대로 둡니다. 한자는 한 글자도 남기지 않습니다.", "",
    "[그림]",
    "- 제품·사진·배경·도형·배치는 원본 그대로 둡니다. 글자만 바꿉니다.",
    "- 글자 색·굵기·크기·정렬은 원본 그 자리 글과 같게 합니다. 글은 원본 글이 있던 자리 안에 넣고, 사진이나 도형을 덮지 않게 합니다.",
    ...(retry ? ["", `앞선 결과에서 고칠 점: ${retry}`] : [])].join("\n");
}

export async function bakeAuth({ settings = {}, fetchImpl = globalThis.fetch } = {}) {
  if (process.env.SEEDHACK_BAKE === "off") return null;
  if ((process.env.SEEDHACK_BAKE_ENGINE || settings.bakeEngine) === "codex") { const bin = codexBin(); if (bin) return { engine: "codex", bin }; }
  const p = resolveProvider({ settings });
  if (p.provider === "google") { const a = await googleAuth({ fetchImpl }); return { url: a.vertexUrl(BAKE_MODEL, "global"), headers: a.headers }; }
  if (p.provider === "vertex" && p.key) { const t = await getVertexToken(p.credFile, { fetchImpl }); const project = p.project || t.project; if (!project) return null; return { url: vertexUrl({ project, location: "global", model: BAKE_MODEL }), headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.token}`, "x-goog-user-project": project } }; }
  return null;
}

async function callOnce(auth, file, prompt, { fetchImpl = globalThis.fetch, timeoutMs = 180000, wantText = false } = {}) {
  if (auth.engine === "codex") return codexImage({ bin: auth.bin, images: [file], prompt, wantText });
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: mimeOf(file), data: fs.readFileSync(file).toString("base64") } }, { text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { imageSize: "2K" }, maxOutputTokens: 32768 } });
  for (let k = 0; k < 7; k++) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), timeoutMs);
    let r, j;
    try { r = await fetchImpl(auth.url, { method: "POST", headers: auth.headers, body, signal: ac.signal }); j = await r.json().catch(() => ({})); }
    catch (e) { clearTimeout(tm); if (k >= 2) return { error: e?.name === "AbortError" ? "시간 초과" : String(e?.message || e).slice(0, 100) }; await sleep(4000); continue; }
    clearTimeout(tm);
    if (r.status === 429 || r.status >= 500) { await sleep(Math.min(45000, 12000 + k * 8000)); continue; } // 분당 한도 — 기다렸다 다시
    if (!r.ok) return { error: `${r.status} ${String(j?.error?.message || "").slice(0, 160)}`, status: r.status };
    const p = (j?.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data);
    if (p) return { b64: p.inlineData.data, mime: p.inlineData.mimeType || "image/png", tokens: j?.usageMetadata?.candidatesTokenCount || 0 };
    return { error: `그림 없음(${j?.candidates?.[0]?.finishReason || "?"})` };
  }
  return { error: "구글 분당 한도(429)로 계속 밀림" };
}

// 글 밖 영역이 원본과 얼마나 다른지(밝기 차이 평균 0~255) — 제품·배경을 다시 그려 버린 장을 걸러 낸다. boxes: 원본 좌표의 글 상자
async function driftOf(file0, file1, boxes = [], w0 = 0, h0 = 0) {
  try {
    const { nativeImage } = await import("electron");
    const W = 96, a0 = nativeImage.createFromPath(file0), a1 = nativeImage.createFromPath(file1);
    if (a0.isEmpty() || a1.isEmpty()) return null;
    const s0 = a0.getSize(), H = Math.max(8, Math.round(W * s0.height / s0.width));
    const b0 = a0.resize({ width: W, height: H, quality: "good" }).toBitmap(), b1 = a1.resize({ width: W, height: H, quality: "good" }).toBitmap();
    const sx = W / (w0 || s0.width), sy = H / (h0 || s0.height), mask = new Uint8Array(W * H);
    for (const b of boxes) { const x0 = Math.max(0, Math.floor((b.x - b.h * 0.6) * sx)), x1 = Math.min(W, Math.ceil((b.x + b.w * 1.9 + b.h * 0.6) * sx)), y0 = Math.max(0, Math.floor((b.y - b.h * 0.8) * sy)), y1 = Math.min(H, Math.ceil((b.y + b.h * 1.8) * sy)); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1; } // 한글이 원문보다 길어 옆·아래로 늘어나는 만큼 넉넉히
    let sum = 0, n = 0;
    for (let i = 0; i < W * H; i++) { if (mask[i]) continue; const k = i * 4; sum += Math.abs((b0[k] + b0[k + 1] + b0[k + 2]) - (b1[k] + b1[k + 1] + b1[k + 2])) / 3; n++; }
    return n > W * H * 0.08 ? sum / n : null; // 글이 거의 다 덮은 장은 재지 않는다
  } catch { return null; }
}

// 한 장: 그리기 → (ocr 가 있으면) 다시 읽어 검수 → 떨어지면 고칠 점을 붙여 한 번 더. → { ok, out, tries, verdict, usd } | { ok:false, why }
export async function bakeImage({ file, layers = [], boxes = [], w = 0, h = 0, out, auth, ocr = null, log = () => {}, fetchImpl, id = "", free = false, brief = null } = {}) {
  if (!auth) return { ok: false, why: "이미지 AI 연결 없음", tries: 0, usd: 0 };
  let retry = null, last = null, usd = 0;
  const fr = !!free && auth.engine === "codex"; // ✍ 문구까지 GPT 가 쓴다(처음 만들 때만 — 사람이 문구를 고쳐 다시 그릴 때는 고친 문구표대로)
  for (let t = 1; t <= 2; t++) {
    const r = await callOnce(auth, file, fr ? codexFreePrompt({ brief, retry }) : bakePrompt(layers, { retry }), { fetchImpl, wantText: fr });
    if (fr && !r.error) { if (r.texts?.length) layers = r.texts; else { last = { ok: false, why: "문구표 없음" }; retry = "text.json 을 저장하지 않았습니다. 반드시 저장하세요."; continue; } }
    if (r.error) { last = { ok: false, why: r.error }; if (r.status && r.status < 500 && r.status !== 429) break; continue; }
    usd += auth.engine === "codex" ? 0 : BAKE_USD; // GPT 명령줄은 ChatGPT 구독으로 그린다(장당 과금 없음)
    const tmp = out.replace(/\.png$/i, `.try${t}.png`); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(tmp, Buffer.from(r.b64, "base64"));
    let seenText = null, size = null;
    try { const { nativeImage } = await import("electron"); const s = nativeImage.createFromPath(tmp).getSize(); if (s.width) size = s; } catch {}
    if (ocr) { try { const o = await ocr([{ id: id || "bake", file: tmp }]); seenText = ((o?.images || [])[0]?.boxes || []).map((b) => b.text).join(" "); } catch (e) { log("dim", `  🖼 ${id} 검수용 글자 읽기 실패 (${String(e?.message || e).slice(0, 60)})`); } }
    const drift = await driftOf(file, tmp, boxes, w, h);
    const v = seenText == null ? { ok: true, unverified: true, drift } : verifyBake({ layers, seenText, ratio0: w && h ? w / h : 1, ratio1: size ? size.width / size.height : (w && h ? w / h : 1), drift });
    if (seenText == null && drift != null && drift > 18) { v.ok = false; v.fails = [{ k: "drift", why: "제품·사진·배경이 원본과 달라졌습니다. 글자 외에는 원본 그대로 두세요." }]; }
    last = { ok: v.ok, verdict: v, tries: t, size };
    if (v.ok) { fs.renameSync(tmp, out); return { ok: true, out, tries: t, verdict: v, usd, size, ...(fr ? { layers } : {}) }; }
    retry = (v.fails || []).map((f) => f.why).join(" "); last.why = (v.fails || []).map((f) => f.k).join("·");
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
  return { ok: false, why: last?.why || "실패", verdict: last?.verdict || null, tries: last?.tries || 0, usd };
}

// 검수용 글자 읽기: 한글·숫자는 한국어 인식으로, 남은 한자는 중국어 인식으로(맥 Vision 은 언어를 정해 줘야 한다 — 한국어 인식만 하면 남은 한자를 놓치고, 중국어 인식만 하면 한글을 한자로 잘못 읽는다).
//   중국어 인식 상자 중 한글 상자와 겹치는 것은 오인식으로 버린다. 구글 OCR(윈도우)은 언어를 스스로 가려 한 번이면 된다.
export function makeBakeOcr(ocrImages, { provider, log = () => {} } = {}) {
  const hangul = (t) => /[가-힣]/.test(String(t || "")), han = (t) => /[一-鿿]/.test(String(t || ""));
  const over = (a, b) => { const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); return x * y / Math.max(1, Math.min(a.w * a.h, b.w * b.h)); };
  return async (items) => {
    const ko = await ocrImages(items, { provider, langs: "ko-KR,en-US", log });
    if ((ko?.provider || provider) !== "vision") return ko;
    const zh = await ocrImages(items, { provider, log });
    return { ...ko, images: (ko.images || []).map((im) => { const kb = (im.boxes || []).filter((b) => hangul(b.text) || /\d/.test(b.text)); const zb = ((zh.images || []).find((x) => x.id === im.id)?.boxes || []).filter((b) => han(b.text) && !kb.some((k) => over(k, b) > 0.3)); return { ...im, boxes: [...(im.boxes || []).filter((b) => !han(b.text)), ...zb] }; }) };
  };
}
