// "내 구글 클라우드 연결" 화면용 IPC — 📄 화면 설정 칸(renderer/detail.js)
//   detail:google:get   → { connected, kind, project, keyHint, connectedAt, trial, ai, checks? }
//   detail:google:set   { kind:"apikey", apiKey, project } | { kind:"sa", json(키 파일 내용) } → 저장 후 바로 확인
//   detail:google:test  → 세 가지 확인(글 AI · 이미지 AI · OCR) 결과
//   detail:google:clear → 연결 끊기
//   detail:google:oauth:start → "구글로 연결"(google-oauth.js runSetup) 시작·이어 하기. 진행은 send("google:setup", { id, status, msg, eta, help … })
//   detail:google:oauth:open { what:"trial"|"console" } → 무료 체험 가입·구글 클라우드 화면
// 키는 settings.google 에만 저장하고 화면에는 끝 4자리만 돌려준다. 로그에 남기지 않는다.
import electron from "electron";
import fs from "node:fs";
import path from "node:path";
import { setGoogleConn, connFromSettings, googleAuth, googleError, trialInfo, googleConn } from "./google-conn.js";
import { configured as oauthConfigured } from "./google-oauth.js";

// 아주 작은 PNG(흰 바탕 8×8) — OCR API 가 켜졌는지만 본다
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAAA0ofd8AAAADklEQVR4nGP4/58BHQAAz2YP8RRoLaYAAAAASUVORK5CYII=";

export async function checkGoogle({ fetchImpl } = {}) {
  if (!fetchImpl) fetchImpl = process.env.SEEDHACK_GOOGLE_MOCK ? (await import("./google-oauth.js")).createMock(process.env.SEEDHACK_GOOGLE_MOCK) : globalThis.fetch;
  const out = { text: null, image: null, ocr: null };
  let a;
  try { a = await googleAuth({ fetchImpl }); } catch (e) { const m = String(e?.message || e); return { text: { ok: false, msg: m }, image: { ok: false, msg: m }, ocr: { ok: false, msg: m } }; }
  const post = async (url, body) => { const r = await fetchImpl(url, { method: "POST", headers: a.headers, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { r, j }; };
  try { // 글 AI: 가벼운 모델 한 줄(약 ₩0.1). 사라진 모델(404)은 다음 후보로
    const { geminiChain, markGone } = await import("./gemini-text.js");
    for (const m of geminiChain("haiku")) {
      const { r, j } = await post(a.vertexUrl(m, "global"), { contents: [{ role: "user", parts: [{ text: "OK 라고만 답하세요" }] }], generationConfig: { maxOutputTokens: 50 } });
      if (!r.ok) lastCheckRaw = `${m} ${r.status} ${String(j?.error?.message || "").slice(0, 300)}`;
      out.text = r.ok ? { ok: true, msg: "글 AI(Gemini) 연결됨" } : { ok: false, msg: googleError(r.status, j?.error?.message) };
      if (r.status === 404) { markGone(m); continue; }
      break;
    }
  } catch (e) { out.text = { ok: false, msg: `연결 실패: ${String(e?.message || e).slice(0, 80)}` }; }
  try { // 이미지 AI: 토큰 세기(무료)로 모델 접근만 확인
    const { r, j } = await post(a.vertexUrl("gemini-2.5-flash-image", "global", "countTokens"), { contents: [{ role: "user", parts: [{ text: "test" }] }] });
    out.image = r.ok ? { ok: true, msg: "이미지 AI(나노바나나) 연결됨" } : { ok: false, msg: googleError(r.status, j?.error?.message) };
  } catch (e) { out.image = { ok: false, msg: `연결 실패: ${String(e?.message || e).slice(0, 80)}` }; }
  try { // OCR: 작은 그림 한 장(무료 1,000장 안)
    const { r, j } = await post(a.visionUrl, { requests: [{ image: { content: TINY_PNG }, features: [{ type: "TEXT_DETECTION" }] }] });
    out.ocr = r.ok ? { ok: true, msg: "글자 읽기(Cloud Vision) 연결됨" } : { ok: false, msg: googleError(r.status, j?.error?.message) };
  } catch (e) { out.ocr = { ok: false, msg: `연결 실패: ${String(e?.message || e).slice(0, 80)}` }; }
  return out;
}
// 시험 실패의 구글 원문(로그용) — 화면에는 쉬운 말만 나가서 원인을 못 찾는 일을 막는다
export let lastCheckRaw = "";

// 새로 고침 토큰은 OS 보안 저장소로 암호화(맥 Keychain·윈도우 DPAPI). 못 쓰면(리눅스 등) 저장하지 않고 이번 실행에만 둔다
const enc = (t) => { try { return electron.safeStorage.isEncryptionAvailable() ? electron.safeStorage.encryptString(t).toString("base64") : null; } catch { return null; } };
const dec = (b) => { try { return b ? electron.safeStorage.decryptString(Buffer.from(b, "base64")) : ""; } catch { return ""; } };
let memRt = "";

export function initGoogleIpc({ ipcMain, app, store, log = () => {}, send = () => {} }) {
  const saFile = () => path.join(app.getPath("userData"), "detail", "google-sa.json");
  const withRt = (g) => (g?.kind === "oauth" ? { ...g, refreshToken: dec(g.rtEnc) || memRt } : g);
  const load = () => setGoogleConn(connFromSettings(withRt((store.get("settings") || {}).google)));
  load();
  const view = (checks = null) => {
    const g = (store.get("settings") || {}).google || {}, c = googleConn();
    return { connected: !!c && !c.dev, dev: !!c?.dev, kind: g.kind || null, project: g.project || g.projectId || "", keyHint: g.apiKey ? `…${String(g.apiKey).slice(-4)}` : g.saEmail || g.email || "", connectedAt: g.connectedAt || null, trial: trialInfo(g.connectedAt), checks: checks || g.checks || null,
      oauthReady: oauthConfigured(), oauthStep: g.kind === "oauth" && !c ? g.lastStep || null : null };
  };
  const save = (g) => { const st = store.get("settings") || {}; store.set("settings", { ...st, google: g }); load(); };
  ipcMain.handle("detail:google:get", () => view());
  ipcMain.handle("detail:google:set", async (_e, p = {}) => {
    const prev = (store.get("settings") || {}).google || {};
    let g;
    if (p.kind === "apikey") {
      const key = String(p.apiKey || "").trim(), project = String(p.project || "").trim();
      if (!/^AIza[\w-]{30,}$/.test(key)) return { error: "API 키 모양이 아니에요. AIza 로 시작하는 키를 붙여 넣어 주세요." };
      if (project && !/^[a-z][a-z0-9-]{4,61}$/.test(project)) return { error: "프로젝트 ID 모양이 아니에요(영문 소문자·숫자·- 만)." };
      g = { kind: "apikey", apiKey: key, project, connectedAt: prev.connectedAt || Date.now() };
    } else if (p.kind === "sa") {
      let j; try { j = JSON.parse(String(p.json || "")); } catch { return { error: "키 파일(JSON)을 읽지 못했어요." }; }
      if (j.type !== "service_account" || !j.private_key || !j.client_email) return { error: "서비스 계정 키 파일이 아니에요." };
      fs.mkdirSync(path.dirname(saFile()), { recursive: true });
      fs.writeFileSync(saFile(), JSON.stringify(j), { mode: 0o600 });
      g = { kind: "sa", credFile: saFile(), project: j.project_id || "", saEmail: j.client_email.replace(/@.*/, "@…"), connectedAt: prev.connectedAt || Date.now() };
    } else return { error: "연결 방법을 골라 주세요" };
    save(g);
    const checks = await checkGoogle();
    save({ ...g, checks });
    log("info", `🔗 내 구글 클라우드 연결 · ${g.kind} · 글 ${checks.text?.ok ? "✔" : "✕"} · 이미지 ${checks.image?.ok ? "✔" : "✕"} · OCR ${checks.ocr?.ok ? "✔" : "✕"}`);
    return view(checks);
  });
  ipcMain.handle("detail:google:test", async () => { if (!googleConn()) return { ...view(), error: "연결된 구글 클라우드가 없어요" }; const checks = await checkGoogle(); const g = (store.get("settings") || {}).google; if (g) save({ ...g, checks }); return view(checks); });
  // 구글 화면 열기(가입·API 켜기·키 만들기·남은 크레딧) — 프로젝트 ID 가 있으면 그 프로젝트로
  ipcMain.handle("detail:google:open", (_e, p = {}) => {
    const pj = ((store.get("settings") || {}).google || {}).project || "", q = pj ? `?project=${encodeURIComponent(pj)}` : "";
    const URLS = { trial: "https://console.cloud.google.com/freetrial", vertex: `https://console.cloud.google.com/apis/library/aiplatform.googleapis.com${q}`, vision: `https://console.cloud.google.com/apis/library/vision.googleapis.com${q}`,
      keys: `https://console.cloud.google.com/apis/credentials${q}`, sa: `https://console.cloud.google.com/iam-admin/serviceaccounts/create${q}`, credits: `https://console.cloud.google.com/billing/credits${q}` };
    const u = URLS[p.what]; if (!u) return { error: "알 수 없는 화면" };
    electron.shell.openExternal(u); return { ok: true };
  });
  // 📄 탭 열 때·만들기 누를 때: AI 를 쓸 준비가 됐는지(구글 연결 · 맥 로컬 도구 · 준비된 서버 중 하나) — 안 됐으면 화면이 연결 마법사를 띄운다
  ipcMain.handle("detail:ready", async () => {
    const { checkReadiness } = await import("./preflight.js");
    const pf = await checkReadiness({ needOcr: true, needText: true, needImage: true, settings: store.get("settings") || {} }).catch((e) => ({ ok: false, fix: "google", problems: [{ what: "?", msg: String(e?.message || e) }] }));
    const g = (store.get("settings") || {}).google || {};
    return { ok: !!pf.ok, fix: pf.fix || null, headline: pf.headline || "", problems: pf.problems || [], oauthReady: oauthConfigured(), resumeStep: g.kind === "oauth" && !googleConn() ? g.lastStep || (g.refreshToken || g.rtEnc ? "billing" : null) : null };
  });
  // 브라우저에서 할 일이 끝나면(로그인 허용·무료 체험 가입 감지) 씨드핵 창을 앞으로
  const front = () => { try { const w = electron.BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible?.() !== false) || electron.BrowserWindow.getAllWindows()[0]; if (!w) return; if (w.isMinimized()) w.restore(); w.show(); w.focus(); if (process.platform === "darwin") electron.app.focus({ steal: true }); } catch {} };
  // ── 🔗 구글로 연결(토스처럼 한 단계씩) ──
  let running = null, lastLoginUrl = null;
  ipcMain.handle("detail:google:oauth:start", async () => {
    if (running) return { busy: true };
    const go = await import("./google-oauth.js");
    if (!go.configured()) return { error: "구글 연결 준비 중이에요(운영진 설정 필요)" };
    const prev = (store.get("settings") || {}).google || {};
    const saved = prev.kind === "oauth" ? { refreshToken: dec(prev.rtEnc) || memRt, email: prev.email, projectId: prev.projectId, billing: prev.billing, linked: prev.linked, enabled: prev.enabled } : {};
    const persist = (x, extra = {}) => { if (x.refreshToken) memRt = x.refreshToken; const { refreshToken, ...rest } = x; save({ kind: "oauth", ...rest, rtEnc: refreshToken ? enc(refreshToken) : prev.rtEnc || null, connectedAt: prev.connectedAt || Date.now(), ...extra }); };
    running = go.runSetup({ saved, openExternal: (u) => { if (/accounts\.google\.com/.test(u)) lastLoginUrl = u; electron.shell.openExternal(u); }, onStep: (ev) => { send("google:setup", ev); if (ev.status === "done" && (ev.id === "login" || ev.id === "billing")) front(); if (ev.status === "error") log("warn", `△ 🔗 구글 연결 ${ev.id} 단계 실패 · ${ev.error}${ev.id === "test" && lastCheckRaw ? ` · 구글 원문: ${lastCheckRaw}` : ""}`); },
      onSave: (x) => persist(x), test: async () => { load(); return checkGoogle(); } });
    try {
      const r = await running;
      persist(r.saved, { lastStep: r.ok ? null : r.step, ...(r.checks ? { checks: r.checks } : {}) });
      if (r.ok) log("go", `■ 🔗 구글 연결 끝 · ${r.saved.email || ""} · 프로젝트 ${r.saved.projectId}`);
      return { ...view(), result: { ok: r.ok, step: r.step || null, help: r.help || null } };
    } finally { running = null; }
  });
  ipcMain.handle("detail:google:oauth:open", async (_e, p = {}) => {
    const go = await import("./google-oauth.js"), g = (store.get("settings") || {}).google || {};
    if (p.what === "login") { if (lastLoginUrl) electron.shell.openExternal(lastLoginUrl); return { ok: !!lastLoginUrl }; }
    const u = p.what === "trial" ? go.TRIAL_URL(g.email) : `https://console.cloud.google.com/${g.projectId ? `home/dashboard?project=${encodeURIComponent(g.projectId)}` : ""}`;
    electron.shell.openExternal(u); return { ok: true };
  });
  ipcMain.handle("detail:google:clear", () => { memRt = ""; save(null); try { fs.rmSync(saFile(), { force: true }); } catch {} return view(); });
}
