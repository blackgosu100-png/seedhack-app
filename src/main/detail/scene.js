// 장면 이미지 생성 — 제품 사진(누끼 우선)을 한국 생활 장면에 다시 놓는다(레퍼런스: 나노바나나/ChatGPT 로 찍은 사내 상세페이지).
// 공급자: gemini(AI Studio 키, generativelanguage.googleapis.com v1beta generateContent) · vertex(Google Cloud Vertex AI — 신규 $300 크레딧은 여기만 적용,
//   ADC 또는 서비스 계정 JSON 으로 OAuth 토큰을 직접 받는다: googleapis 패키지 없이 refresh_token 교환 / JWT RS256 서명) · openai(gpt-image-1 images/edits, 선택)
// 키: settings.geminiKey 또는 GEMINI_API_KEY / settings.openaiKey 또는 OPENAI_API_KEY. 키가 없으면 즉시 { ok:false, error:"이미지 생성 키 없음" } (파이프라인은 사진 경로로 계속).
// 모델: settings.geminiImageModel(기본 gemini-2.5-flash-image) / settings.openaiImageModel(기본 gpt-image-1).
// Electron 없이도 돈다(fetch·fs 만 사용) — 키는 로그·파일 어디에도 남기지 않는다.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-image";
export const DEFAULT_OPENAI_MODEL = "gpt-image-1";
const noop = () => {};
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || "image/png";
const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

// 공급자·키·모델 고르기. settings.imageProvider 가 없으면 geminiKey → vertexProject(또는 자격증명 파일) → openai 키 순.
export const DEFAULT_VERTEX_LOCATION = "global";
// gemini-2.5-flash-image 가 열린 Vertex 지역(2026-10-09 실측, countTokens 404 여부) — 지역마다 할당량이 따로라 나눠 보내면 429 대기가 사라진다.
// 닫힘: northamerica-northeast1, europe-west2/3/9, asia-*(northeast1·northeast3·southeast1·south1), australia-southeast1, me-central1, southamerica-east1
export const DEFAULT_SCENE_REGIONS = ["global", "us-central1", "us-east1", "us-east4", "us-east5", "us-south1", "us-west1", "us-west4", "europe-west1", "europe-west4", "europe-north1", "europe-central2"];
// 기본 모델 외 모델은 global 에만 열려 있다(실측: gemini-3.1-flash-image · gemini-3.1-flash-lite-image · gemini-3-pro-image 는 global 200, us-central1 404)
export const GLOBAL_ONLY_MODELS = /^gemini-3/;

// 다지역 라운드로빈 라우터: 지역당 동시 perRegion 개, 429 면 그 지역을 cooldownMs 동안 쉬게 하고 즉시 다음 지역으로.
// 모든 지역이 쉬는 중일 때만 가장 빨리 풀리는 지역까지 짧게 기다린다. 모델이 그 지역에 없으면(404) 그 (모델, 지역)만 뺀다.
export function createRegionRouter({ regions = DEFAULT_SCENE_REGIONS, perRegion = 2, cooldownMs = 20000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const st = new Map(regions.map((r) => [r, { inflight: 0, coolUntil: 0, ok: 0, e429: 0 }]));
  const badPair = new Set(); // `${model}@${region}`
  let rr = 0;
  const usable = (model) => regions.filter((r) => !badPair.has(`${model}@${r}`) && !(GLOBAL_ONLY_MODELS.test(model) && r !== "global"));
  return {
    regions, stats: () => Object.fromEntries([...st].map(([r, v]) => [r, { ok: v.ok, e429: v.e429 }])),
    total429: () => [...st.values()].reduce((t, v) => t + v.e429, 0),
    available: (model) => usable(model).length > 0,
    // 지역 하나를 빌린다(없으면 기다림). 모델이 열린 지역이 하나도 없으면 null.
    async acquire(model) {
      for (;;) {
        const list = usable(model);
        if (!list.length) return null;
        const t = now();
        let pick = null;
        for (let i = 0; i < list.length; i++) {
          const r = list[(rr + i) % list.length], v = st.get(r);
          if (v.coolUntil <= t && v.inflight < perRegion && (!pick || v.inflight < st.get(pick).inflight)) pick = r;
        }
        if (pick) { rr = (list.indexOf(pick) + 1) % list.length; st.get(pick).inflight++; return pick; }
        const soon = Math.min(...list.map((r) => st.get(r).coolUntil).filter((c) => c > t));
        await sleep(Number.isFinite(soon) ? Math.min(Math.max(soon - t, 50), 5000) : 100); // 모두 쉬는 중 → 가장 빨리 풀리는 지역까지(최대 5초씩)
      }
    },
    release(region, outcome) { // outcome: "ok" | "429" | "404" | "err"
      const v = st.get(region); if (!v) return;
      v.inflight = Math.max(0, v.inflight - 1);
      if (outcome === "ok") v.ok++;
      if (outcome === "429") { v.e429++; v.coolUntil = now() + cooldownMs; }
    },
    markBad(model, region) { badPair.add(`${model}@${region}`); },
  };
}
export function resolveProvider({ provider, settings = {}, env = process.env } = {}) {
  const gKey = settings.geminiKey || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  const oKey = settings.openaiKey || env.OPENAI_API_KEY || "";
  // 앱을 Dock에서 켜면 GOOGLE_CLOUD_PROJECT 환경변수가 없다 → gcloud 로그인 파일의 quota_project_id 를 프로젝트로 쓴다
  const adcFile = settings.vertexCredentials || env.GOOGLE_APPLICATION_CREDENTIALS || path.join(env.HOME || os.homedir(), ".config", "gcloud", "application_default_credentials.json");
  let adcProject = "";
  try { if (fs.existsSync(adcFile)) { const j = JSON.parse(fs.readFileSync(adcFile, "utf8")); adcProject = j.quota_project_id || j.project_id || ""; } } catch {}
  const vProject = settings.vertexProject || env.GOOGLE_CLOUD_PROJECT || adcProject || "";
  const want = provider || settings.imageProvider || (gKey ? "gemini" : vProject || settings.vertexCredentials ? "vertex" : oKey ? "openai" : "gemini");
  if (want === "openai") return { provider: "openai", key: oKey, model: settings.openaiImageModel || DEFAULT_OPENAI_MODEL };
  if (want === "vertex") {
    const credFile = settings.vertexCredentials || env.GOOGLE_APPLICATION_CREDENTIALS || path.join(env.HOME || os.homedir(), ".config", "gcloud", "application_default_credentials.json");
    return { provider: "vertex", key: fs.existsSync(credFile) ? "adc" : "", credFile, project: vProject, location: settings.vertexLocation || env.GOOGLE_CLOUD_LOCATION || DEFAULT_VERTEX_LOCATION,
      model: settings.vertexImageModel || settings.geminiImageModel || DEFAULT_GEMINI_MODEL };
  }
  return { provider: "gemini", key: gKey, model: settings.geminiImageModel || DEFAULT_GEMINI_MODEL };
}

// ---- Vertex AI OAuth 토큰(googleapis 없이) ----
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const tokenCache = new Map(); // credFile → { token, exp }
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
// 서비스 계정 JWT(RS256) 만들기 — 순수 함수(테스트용으로 내보냄)
export function signServiceJwt(cred, nowSec = Math.floor(Date.now() / 1000)) {
  const header = { alg: "RS256", typ: "JWT", ...(cred.private_key_id ? { kid: cred.private_key_id } : {}) };
  const claim = { iss: cred.client_email, scope: SCOPE, aud: cred.token_uri || "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(cred.private_key);
  return `${unsigned}.${b64url(sig)}`;
}
// 자격증명 파일 → { token, project? }. authorized_user(gcloud ADC) 는 refresh_token 교환, service_account 는 JWT 교환.
export async function getVertexToken(credFile, { fetchImpl = globalThis.fetch, timeoutMs = 20000, now = Date.now } = {}) {
  const c = tokenCache.get(credFile);
  if (c && c.exp - 60000 > now()) return { token: c.token, project: c.project };
  let cred;
  try { cred = JSON.parse(fs.readFileSync(credFile, "utf8")); } catch (e) { throw new Error(`Vertex 자격증명 파일을 읽지 못함(${path.basename(credFile)}) — \`gcloud auth application-default login\` 을 먼저 해 주세요`); }
  let body;
  if (cred.type === "service_account") body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signServiceJwt(cred, Math.floor(now() / 1000)) });
  else if (cred.type === "authorized_user" && cred.refresh_token) body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: cred.refresh_token, client_id: cred.client_id, client_secret: cred.client_secret });
  else throw new Error(`지원하지 않는 자격증명 종류: ${cred.type || "알 수 없음"}`);
  const url = cred.type === "service_account" ? cred.token_uri || "https://oauth2.googleapis.com/token" : "https://oauth2.googleapis.com/token";
  const j = await fetchJson(fetchImpl, url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }, timeoutMs)
    .catch((e) => { throw new Error(`Vertex 토큰 발급 실패: ${safeErr(e)}`); });
  if (!j?.access_token) throw new Error("Vertex 토큰 발급 실패: access_token 없음");
  const project = cred.project_id || cred.quota_project_id || "";
  tokenCache.set(credFile, { token: j.access_token, exp: now() + (Number(j.expires_in) || 3600) * 1000, project });
  return { token: j.access_token, project };
}
export const clearVertexTokenCache = () => tokenCache.clear();
// 엔드포인트(global 은 지역 접두어가 없다)
export function vertexUrl({ project, location = DEFAULT_VERTEX_LOCATION, model }) {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

// 기본 후처리: 액자 테두리 제거(image.js stripFrame — Electron nativeImage 가 있을 때만, 없으면 그대로 둔다)
let imageMod;
// 기본 후처리: ① 액자 테두리 제거(stripFrame) ② shot.fit 이면 빈 가장자리 30% 초과 시 잘라 원래 비율로(fitContent). Electron nativeImage 가 없으면 그대로 둔다.
// 반환 { stripped, fitted, tooSmall, w, h } — tooSmall(내용이 30% 미만) 이면 generateScenes 가 그 장을 1회 다시 만든다.
async function defaultPostProcess(file, shot = {}) {
  if (imageMod === undefined) { try { const m = await import("./image.js"); imageMod = typeof m.stripFrame === "function" ? m : null; } catch { imageMod = null; } }
  if (!imageMod) return null;
  const out = {};
  try { Object.assign(out, imageMod.stripFrame(file, file)); } catch {}
  if (shot.fit && imageMod.fitContent) { try { const f = imageMod.fitContent(file, file); out.fitted = f.fitted; out.tooSmall = f.tooSmall; out.emptyFrac = f.emptyFrac; out.w = f.w; out.h = f.h; } catch {} }
  return out;
}

// 사람에게 보여 줄 오류(키·주소는 숨긴다)
const safeErr = (e) => String(e?.message || e).replace(/key=[^&\s]+/g, "key=***").replace(/(AIza|sk-|ya29\.|1\/\/)[\w.\-]{10,}/g, "***").replace(/Bearer\s+\S+/g, "Bearer ***").slice(0, 240);

async function fetchJson(fetchImpl, url, init, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { ...init, signal: ac.signal });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${j?.error?.message || text.slice(0, 200)}`);
    return j;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`시간 초과(${Math.round(timeoutMs / 1000)}초)`);
    throw e;
  } finally { clearTimeout(t); }
}

// ---- Gemini(나노바나나) ----
// 한 번 호출에 이미지 1장. 반환 [{ mime, b64 }]
// vertex 를 주면 Vertex AI 엔드포인트 + Bearer 토큰(요청 본문은 같은 generateContent 형식, Vertex 는 camelCase inlineData)
async function geminiOnce({ key, model, images, prompt, aspect, fetchImpl, timeoutMs, vertex = null }) {
  const parts = images.map((f) => { const d = fs.readFileSync(f).toString("base64"); return vertex ? { inlineData: { mimeType: mimeOf(f), data: d } } : { inline_data: { mime_type: mimeOf(f), data: d } }; });
  parts.push({ text: prompt });
  const body = { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: aspect ? { aspectRatio: aspect } : undefined } };
  const url = vertex ? vertexUrl({ project: vertex.project, location: vertex.location, model }) : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = vertex ? { "Content-Type": "application/json", Authorization: `Bearer ${vertex.token}` } : { "Content-Type": "application/json", "x-goog-api-key": key };
  const j = await fetchJson(fetchImpl, url, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
  const out = [];
  for (const c of j?.candidates || []) for (const p of c?.content?.parts || []) {
    const d = p.inlineData || p.inline_data;
    if (d?.data) out.push({ mime: d.mimeType || d.mime_type || "image/png", b64: d.data });
  }
  if (!out.length) {
    const why = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || "이미지 없음";
    throw new Error(`Gemini 응답에 이미지가 없음(${why})`);
  }
  return out;
}

// ---- OpenAI(gpt-image-1, images/edits) ----
const OPENAI_SIZE = { "1:1": "1024x1024", "4:5": "1024x1536", "3:4": "1024x1536", "2:3": "1024x1536", "16:9": "1536x1024", "3:2": "1536x1024" };
async function openaiBatch({ key, model, images, prompt, aspect, n, fetchImpl, timeoutMs }) {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", prompt);
  fd.append("n", String(n));
  fd.append("size", OPENAI_SIZE[aspect] || "1024x1024");
  for (const f of images) fd.append("image[]", new Blob([fs.readFileSync(f)], { type: mimeOf(f) }), path.basename(f));
  const j = await fetchJson(fetchImpl, "https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd }, timeoutMs);
  const out = (j?.data || []).filter((d) => d.b64_json).map((d) => ({ mime: "image/png", b64: d.b64_json }));
  if (!out.length) throw new Error("OpenAI 응답에 이미지가 없음");
  return out;
}

// 화면비 문장(모델이 imageConfig 를 무시해도 따르게)
const aspectLine = (aspect) => ({ "4:5": "Vertical 4:5 composition.", "3:4": "Vertical 3:4 composition.", "1:1": "Square 1:1 composition." }[aspect] || "");

// productImages: 제품 사진 절대경로 1~3장(누끼 우선), shots: planShots() 결과, n: 컷마다 몇 장
// 반환: [{ id, purpose, files:[...], ok, error }]  — 컷마다 성공한 장만 files 에. 전부 실패해도 throw 하지 않는다.
// postProcess(file): 저장 직후 후처리(기본 = 액자 테두리 제거 stripFrame). null 이면 안 함.
export async function generateScenes({ productImages = [], shots = [], aspect = "4:5", n = 2, outDir, log = noop, onProgress = noop,
  provider, settings = {}, env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 120000, lang = "en", postProcess = defaultPostProcess, retryDelays = [15000, 35000, 60000], // 새 GCP 프로젝트는 분당 한도가 낮아(2~3회) 429 가 잦다
  concurrency = 1, regions = null, perRegion = 2, regionCooldownMs = 20000, maxAttempts = 24, sleep } = {}) {
  // 컷마다 s.aspect / s.n / s.model(예: hero 만 상위 모델) 로 덮어쓸 수 있다. 상위 모델이 없으면(404) 기본 모델로 대체하고 사유를 남긴다.
  const prov = resolveProvider({ provider, settings, env });
  const imgs = (productImages || []).filter((f) => f && fs.existsSync(f)).slice(0, 3);
  const fail = (error) => (shots || []).map((s) => ({ id: s.id, purpose: s.purpose, files: [], ok: false, error }));
  if (!prov.key) { log("dim", "  🎨 이미지 생성 키 없음 → 장면 생성을 건너뜁니다(사진 경로로 계속)"); return fail(prov.provider === "vertex" ? "이미지 생성 키 없음(Vertex 자격증명 파일 없음 — gcloud auth application-default login)" : "이미지 생성 키 없음"); }
  if (!imgs.length) return fail("제품 사진 없음");
  if (!outDir) return fail("출력 폴더 없음");
  let vertex = null;
  if (prov.provider === "vertex") {
    try {
      const t = await getVertexToken(prov.credFile, { fetchImpl });
      vertex = { token: t.token, project: prov.project || t.project, location: prov.location };
      if (!vertex.project) return fail("Vertex 프로젝트 ID 없음(settings.vertexProject)");
    } catch (e) { log("dim", `  🎨 ${safeErr(e)}`); return fail(safeErr(e)); }
  }
  // Vertex: 지역 목록 — regions 인자 → settings.sceneRegions → (지역을 직접 지정했으면 그 지역만) → 기본 다지역
  const router = vertex ? createRegionRouter({ regions: regions || (Array.isArray(settings.sceneRegions) && settings.sceneRegions.length ? settings.sceneRegions : (prov.location !== DEFAULT_VERTEX_LOCATION ? [prov.location] : DEFAULT_SCENE_REGIONS)),
    perRegion, cooldownMs: regionCooldownMs, ...(sleep ? { sleep } : {}) }) : null;
  fs.mkdirSync(outDir, { recursive: true });
  const nOf = (s) => Math.max(1, s.n || n);
  const total = shots.reduce((t, s) => t + nOf(s), 0);
  let done = 0, framed = 0, regenerated = 0, abort = null;
  const badModels = new Set(); // 이번 실행에서 없는 것으로 확인된 모델
  const results = new Array(shots.length);
  log("dim", `  🎨 장면 생성 ${shots.length}컷 · ${total}장 (${prov.provider} · ${prov.model}${router ? ` · 지역 ${router.regions.length}곳 × ${perRegion}` : ""}${concurrency > 1 ? ` · 동시 ${concurrency}` : ""})`);
  const runShot = async (s) => {
    const sAspect = s.aspect || aspect, sn = nOf(s);
    let model = s.model && !badModels.has(s.model) ? s.model : prov.model;
    const prompt = `${lang === "ko" ? s.prompt_ko : s.prompt_en || s.prompt_ko} ${aspectLine(sAspect)}`.trim();
    const files = [];
    let error = null, modelNote = null, usedRegion = null;
    const t0 = Date.now();
    try {
      const genOne = async () => { // 반환 {mime,b64} 또는 null(error 에 사유)
        if (router) { // Vertex: 다지역 라운드로빈 — 429 면 대기 없이 다음 지역
          for (let a = 0; a < maxAttempts; a++) {
            if (abort) return null;
            if (!router.available(model)) { // 상위 모델이 열린 지역이 없음 → 기본 모델로
              if (model === prov.model) { error = error || "모델이 열린 지역 없음"; return null; }
              badModels.add(model); modelNote = `${model} 사용 불가(${(error || "열린 지역 없음").slice(0, 60)}) → ${prov.model}`; log("dim", `  🎨 ${s.id} ${modelNote}`); model = prov.model;
            }
            const region = await router.acquire(model);
            if (!region) continue;
            try {
              const g = (await geminiOnce({ key: prov.key, model, images: imgs, prompt, aspect: sAspect, fetchImpl, timeoutMs, vertex: { ...vertex, location: region } }))[0];
              router.release(region, "ok"); error = null; usedRegion = region; return g;
            } catch (e) {
              error = safeErr(e);
              if (/HTTP 429/.test(error)) { router.release(region, "429"); continue; }
              if (/HTTP 404|NOT_FOUND/i.test(error)) { router.release(region, "404"); router.markBad(model, region); continue; }
              router.release(region, "err");
              if (/HTTP (500|503)/.test(error)) continue;
              return null; // 401/403·응답에 이미지 없음 등
            }
          }
          return null;
        }
        for (let a = 0; ; a++) { // gemini(AI Studio) 키: 한 엔드포인트 — 429/5xx 는 잠깐 쉬었다 다시
          try { const g = (await geminiOnce({ key: prov.key, model, images: imgs, prompt, aspect: sAspect, fetchImpl, timeoutMs, vertex }))[0]; error = null; return g; }
          catch (e) {
            error = safeErr(e);
            if (model !== prov.model && /HTTP 404|NOT_FOUND|not found|is not supported/i.test(error)) { // 상위 모델 없음 → 기본 모델로
              badModels.add(model); modelNote = `${model} 사용 불가(${error.slice(0, 60)}) → ${prov.model}`; log("dim", `  🎨 ${s.id} ${modelNote}`); model = prov.model; a = -1; continue;
            }
            if (/HTTP (429|500|503)/.test(error) && a < retryDelays.length) { log("dim", `  🎨 ${s.id} ${error.slice(0, 40)} → ${Math.round(retryDelays[a] / 1000)}초 뒤 다시`); await new Promise((r) => setTimeout(r, retryDelays[a])); continue; }
            return null;
          }
        }
      };
      const save = async (g, k) => {
        const f = path.join(outDir, `${s.id}-${k + 1}${EXT[g.mime] || ".png"}`);
        fs.writeFileSync(f, Buffer.from(g.b64, "base64"));
        const pr = postProcess ? await postProcess(f, s) : null;
        if (pr?.stripped) { framed++; log("dim", `  🎨 ${path.basename(f)} 액자 테두리 제거 → ${pr.w}×${pr.h}`); }
        if (pr?.fitted) log("dim", `  🎨 ${path.basename(f)} 빈 가장자리 ${Math.round((pr.emptyFrac || 0) * 100)}% 잘라 맞춤 → ${pr.w}×${pr.h}`);
        return { f, pr };
      };
      if (prov.provider === "openai") { const gs = await openaiBatch({ key: prov.key, model: prov.model, images: imgs, prompt, aspect: sAspect, n: sn, fetchImpl, timeoutMs }); for (const [k, g] of gs.slice(0, sn).entries()) files.push((await save(g, k)).f); }
      else for (let k = 0; k < sn; k++) {
        if (abort) break;
        const g = await genOne();
        if (g) {
          let { f, pr } = await save(g, k);
          if (pr?.tooSmall && s.fit) { // 제품·장면이 화면의 30% 도 안 되면 1회 다시
            log("dim", `  🎨 ${path.basename(f)} 내용이 너무 작음(${Math.round((1 - (pr.emptyFrac || 0)) * 100)}%) → 1회 다시 생성`);
            regenerated++;
            const g2 = await genOne();
            if (g2) ({ f } = await save(g2, k));
          }
          files.push(f);
        }
        done++; onProgress({ done, total, id: s.id, k });
        if (error && /HTTP 4(01|03)/.test(error)) break;
      }
      if (prov.provider === "openai") { done += sn; onProgress({ done, total, id: s.id }); }
    } catch (e) { error = safeErr(e); if (prov.provider === "openai") { done += sn; onProgress({ done, total, id: s.id }); } }
    const ms = Date.now() - t0;
    log("dim", `  🎨 ${s.id} ${s.purpose} → ${files.length}/${sn}장 (${(ms / 1000).toFixed(1)}초 · ${model}${usedRegion ? ` · ${usedRegion}` : ""})${files.length ? "" : " · " + (error || "")}`);
    if (!files.length && /HTTP 4(01|03)|API key|PERMISSION_DENIED/i.test(error || "")) abort = error; // 키가 틀렸으면 나머지 컷도 같은 결과 → 끝
    return { id: s.id, purpose: s.purpose, files, ok: files.length > 0, error: files.length ? null : error || "생성 실패", model, ms, ...(usedRegion ? { region: usedRegion } : {}), ...(modelNote ? { modelNote } : {}) };
  };
  let next = 0;
  const worker = async () => {
    while (next < shots.length) {
      const i = next++;
      const s = shots[i];
      results[i] = abort ? { id: s.id, purpose: s.purpose, files: [], ok: false, error: abort } : await runShot(s);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, shots.length)) }, worker));
  if (router) { results.stats = { regions: router.stats(), total429: router.total429() }; log("dim", `  🎨 지역별 성공 ${Object.entries(router.stats()).filter(([, v]) => v.ok || v.e429).map(([r, v]) => `${r} ${v.ok}${v.e429 ? `(429×${v.e429})` : ""}`).join(" · ")}`); }
  return results;
}

// ---- 장면 입력 사진 고르기 ----
// candidates: [{ id?, file, cutout?:bool }] (id 가 없으면 파일 이름 앞의 g01·d05 등), vision: { items:[{ id, subject, product_only, product_visible, other_brand_prominent, usable, score }] }
// ① 제외: other_brand_prominent=true(다른 브랜드 가전이 두드러짐) · product_visible 이 full 이 아님(잘림·일부) · usable=false
// ② 순서: 누끼 → product_only 또는 subject "product" → 그 외(점수 높은 순). 반환 파일 경로 max 개.
export function pickSceneInputs(candidates = [], vision = null, { max = 2 } = {}) {
  const vById = new Map((vision?.items || []).map((v) => [v.id, v]));
  const idOf = (c) => c.id || (path.basename(String(c.file || "")).match(/^([a-z]\d+)/i) || [])[1] || "";
  const rows = (candidates || []).filter((c) => c && c.file).map((c) => {
    const v = vById.get(idOf(c));
    const cut = c.cutout ?? /_cut\.png$/i.test(c.file);
    return { file: c.file, v, cut };
  }).filter(({ v }) => !v || (!v.other_brand_prominent && (v.product_visible == null || v.product_visible === "full") && v.usable !== false));
  const rank = (r) => (r.cut ? 0 : r.v && (r.v.product_only || r.v.subject === "product") ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (b.v?.score || 0) - (a.v?.score || 0));
  return [...new Set(rows.map((r) => r.file))].slice(0, max);
}

// ---- v5: 섹션별 장면 생성 ----
// sections → planSectionShots(scene-prompt.js) → 컷마다 화면비·장수·모델 → generateScenes. hero 만 settings.sceneModelHero(예: gemini-3-pro-image-preview) 선택 가능.
// 반환: [{ id, sectionId, type, purpose, files, ok, error, model, ms, aspect }]
// vision 을 주면 productImages 를 pickSceneInputs 로 다시 거른다(다른 브랜드 두드러진 사진·잘린 사진 제외, 누끼 → 제품 단독 → 그 외).
export async function generateSectionScenes({ sections = [], product = {}, brief = {}, styleGuide = null, productImages = [], outDir, settings = {}, concurrency, vision = null, ...rest } = {}) {
  const { planSectionShots } = await import("./scene-prompt.js");
  if (vision) {
    const picked = pickSceneInputs(productImages.map((f) => ({ file: f })), vision, { max: 2 });
    if (picked.length) productImages = picked;
    else if (rest.log) rest.log("dim", "  🎨 입력 사진이 모두 제외 조건(다른 브랜드·잘림)에 걸려 원래 목록을 씁니다");
  }
  const shots = planSectionShots({ sections, product, brief, styleGuide });
  const heroModel = settings.sceneModelHero || "";
  for (const s of shots) if (s.type === "hero" && heroModel) s.model = heroModel;
  const res = await generateScenes({ ...rest, productImages, shots, outDir, settings, n: 1, concurrency: concurrency ?? (Number(settings.sceneConcurrency) || 6) });
  const out = res.map((r, i) => ({ ...r, sectionId: shots[i].sectionId, type: shots[i].type, aspect: shots[i].aspect }));
  if (res.stats) out.stats = res.stats; // 지역별 성공·429 횟수
  return out;
}
