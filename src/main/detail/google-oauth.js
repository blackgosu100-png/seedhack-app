// 🔗 "구글로 연결" — 토스처럼 버튼 하나: 구글 로그인(시스템 브라우저, 데스크톱 OAuth 루프백 + PKCE) → 결제 계정 확인(없으면 무료 체험 가입 화면을 열고 자동 감지)
//   → 프로젝트 만들기(Resource Manager) → 결제 연결(Cloud Billing) → Vertex AI·Cloud Vision 켜기(Service Usage) → 시험 호출 3개. 서비스 계정·키 파일 없이 사용자 토큰으로 부른다.
// 새로 고침 토큰은 OS 보안 저장소(Electron safeStorage: 맥 Keychain·윈도우 DPAPI)로 암호화해 settings.google.rt 에 둔다.
// OAuth 클라이언트(대표님이 만든 "데스크톱 앱")는 google-oauth-config.js. 대표님 할 일: docs/detail/GOOGLE-OAUTH-SETUP.md
// 시험: SEEDHACK_GOOGLE_MOCK=1(정상) · =no-billing-forever · =fail-enable · =deny — 실제 구글 대신 이 파일 안의 가짜 구글(mockFetch)로 단계 전환·감지·오류 화면을 본다.
import crypto from "node:crypto";
import http from "node:http";
import { CLIENT_ID, CLIENT_SECRET } from "./google-oauth-config.js";

export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/cloud-platform"];
export const APIS = ["aiplatform.googleapis.com", "vision.googleapis.com"];
const URL_AUTH = "https://accounts.google.com/o/oauth2/v2/auth", URL_TOKEN = "https://oauth2.googleapis.com/token";
const CRM = "https://cloudresourcemanager.googleapis.com/v3", BILL = "https://cloudbilling.googleapis.com/v1", SU = "https://serviceusage.googleapis.com/v1";
export const TRIAL_URL = (email) => `https://console.cloud.google.com/freetrial${email ? `?authuser=${encodeURIComponent(email)}` : ""}`;

// 단계(화면 하나에 하나) — eta 는 화면의 "약 ○초"
export const STEPS = [
  { id: "login", title: "구글 계정으로 로그인", eta: "약 1분" },
  { id: "billing", title: "무료 체험 확인", eta: "카드 등록 약 2분" },
  { id: "project", title: "AI 작업 공간 만들기", eta: "약 20초" },
  { id: "link", title: "무료 체험 크레딧 연결", eta: "약 5초" },
  { id: "enable", title: "AI 기능 켜기", eta: "약 1분" },
  { id: "test", title: "연결 시험", eta: "약 10초" },
];
const CLOUD = "https://www.googleapis.com/auth/cloud-platform";
// 구글 동의 화면의 권한 체크 칸을 빼고 '계속'을 누르면 토큰은 나오지만 클라우드 권한이 빠진다 → 이후 모든 단계가 "insufficient authentication scopes" 로 막힌다
const hasCloud = (scope) => String(scope || "").split(/\s+/).includes(CLOUD);
const NO_SCOPE = () => Object.assign(new Error("구글 화면에서 권한 체크가 빠졌어요"), { status: 400, noScope: true, help: "[다시 시도]를 누른 뒤, 구글 화면의 체크 칸을 모두 선택(‘모두 선택’)하고 [계속]을 눌러 주세요." });
export const configured = () => !!CLIENT_ID || !!process.env.SEEDHACK_GOOGLE_MOCK;

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export function pkce() { const verifier = b64url(crypto.randomBytes(32)); return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) }; }

// 구글 오류 → 다음에 누를 것 한 줄
export function stepError(step, status, msg = "") {
  const m = String(msg || "");
  if (status === 0 || /fetch failed|ENOTFOUND|ECONN|시간 초과/.test(m)) return "인터넷 연결을 확인하고 [다시 시도]를 눌러 주세요.";
  if (/insufficient authentication scopes/i.test(m)) return "구글 화면에서 권한 체크가 빠졌어요. [끊기] 후 [구글로 연결]을 다시 눌러, 체크 칸을 모두 선택하고 [계속]을 눌러 주세요.";
  if (step === "login" && /access_denied|거절/.test(m)) return "구글 화면에서 '허용'을 눌러야 연결돼요. [다시 시도]를 눌러 주세요.";
  if (/terms of service|ToS|약관/i.test(m)) return "구글 클라우드 약관 동의가 필요해요. [구글 클라우드 열기]에서 동의한 뒤 [다시 시도]를 눌러 주세요.";
  if (/quota|limit/i.test(m) && step === "project") return "만들 수 있는 프로젝트 수가 꽉 찼어요. 구글 클라우드에서 안 쓰는 프로젝트를 지운 뒤 [다시 시도]를 눌러 주세요.";
  if (step === "link" && (status === 403 || /permission/i.test(m))) return "결제 계정에 연결할 권한이 없어요. 무료 체험을 직접 가입한 계정으로 로그인했는지 확인해 주세요.";
  if (status === 429) return "구글이 잠시 바빠요. 1분 뒤 [다시 시도]를 눌러 주세요.";
  return "잠시 뒤 [다시 시도]를 눌러 주세요. 계속 안 되면 화면을 캡처해 운영진에게 보내 주세요.";
}

// ── 가짜 구글(시험용) ── 결제 계정은 확인 2번째부터 생김(가입 감지 흉내), 긴 작업(LRO)은 두 번째 확인에서 끝남
export function createMock(kind = "1") {
  const st = { billingChecks: 0, projects: [], ops: {}, enabled: new Set(), linked: null };
  const J = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  return async (url, init = {}) => {
    const u = String(url), body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
    await new Promise((r) => setTimeout(r, 300));
    if (u.startsWith(URL_TOKEN)) return J(200, { access_token: `mock-at-${Date.now()}`, refresh_token: "mock-rt", expires_in: 3600, id_token: `x.${b64url(JSON.stringify({ email: "student@gmail.com" }))}.y` });
    if (u.startsWith(`${BILL}/billingAccounts`)) { st.billingChecks++; return J(200, { billingAccounts: kind === "no-billing-forever" || st.billingChecks < 3 ? [] : [{ name: "billingAccounts/0000-MOCK-0000", open: true, displayName: "무료 체험 결제 계정" }] }); }
    if (u.startsWith(`${CRM}/projects:search`)) return J(200, { projects: st.projects });
    if (u === `${CRM}/projects` && init.method === "POST") { const op = `operations/cp.${Date.now()}`; st.ops[op] = { n: 0, response: { projectId: body.projectId, name: `projects/1234`, displayName: body.displayName } }; st.projects.push({ projectId: body.projectId, labels: body.labels, state: "ACTIVE" }); return J(200, { name: op }); }
    if (u.startsWith(`${CRM}/operations/`) || u.startsWith(`${SU}/operations/`)) { const op = u.replace(/^.*?\/v[13]\//, ""); const o = st.ops[op] || { n: 9 }; o.n++; if (kind === "fail-enable" && op.startsWith("operations/acf")) return J(200, { name: op, done: true, error: { code: 7, message: "Permission denied to enable service" } }); return J(200, o.n >= 2 ? { name: op, done: true, response: o.response || {} } : { name: op, done: false }); }
    if (/\/billingInfo$/.test(u)) { st.linked = body?.billingAccountName; return J(200, { billingEnabled: true, billingAccountName: st.linked }); }
    if (u.includes(":batchEnable")) { const op = `operations/acf.${Date.now()}`; st.ops[op] = { n: 0 }; return J(200, { name: op }); }
    if (/aiplatform\.googleapis\.com/.test(u)) return J(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }], totalTokens: 1 });
    if (/vision\.googleapis\.com/.test(u)) return J(200, { responses: [{}] });
    return J(404, { error: { message: `mock: ${u}` } });
  };
}

async function call(fetchImpl, url, { token, method = "GET", body, project } = {}) {
  let r;
  try { r = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(project ? { "x-goog-user-project": project } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch (e) { const err = new Error(String(e?.message || e)); err.status = 0; throw err; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(j?.error?.message || `HTTP ${r.status}`); err.status = r.status; throw err; }
  return j;
}
async function waitOp(fetchImpl, base, op, token, { tries = 40, every = 3000, sleep } = {}) {
  for (let i = 0; i < tries; i++) {
    const j = await call(fetchImpl, `${base}/${op}`, { token });
    if (j.done) { if (j.error) { const e = new Error(j.error.message || "작업 실패"); e.status = 400; throw e; } return j.response || {}; }
    await sleep(every);
  }
  const e = new Error("시간 초과"); e.status = 0; throw e;
}

// 로그인: 127.0.0.1 에 잠깐 귀를 열고(구글이 돌려보내는 곳) 시스템 브라우저로 동의 화면을 연다
export async function login({ openExternal, fetchImpl, mock = null, timeoutMs = 5 * 60 * 1000 } = {}) {
  const { verifier, challenge } = pkce(), state = b64url(crypto.randomBytes(12));
  let deliver, fail;
  const got = new Promise((res, rej) => { deliver = res; fail = rej; });
  let server = null, redirectUri = "http://127.0.0.1:1/cb";
  if (!mock) {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/cb") { res.writeHead(404); return res.end(); }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>씨드핵</title><body style="font:18px sans-serif;display:grid;place-items:center;height:90vh"><div style="text-align:center"><div style="font-size:48px">${ok ? "✅" : "⚠️"}</div><p>${ok ? "연결됐어요. 씨드핵으로 돌아가 주세요." : "연결하지 못했어요. 씨드핵에서 다시 시도해 주세요."}</p></div>`);
      if (u.searchParams.get("error")) fail(Object.assign(new Error(u.searchParams.get("error")), { status: 400 }));
      else if (ok) deliver(u.searchParams.get("code"));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    redirectUri = `http://127.0.0.1:${server.address().port}/cb`;
  }
  const authUrl = `${URL_AUTH}?${new URLSearchParams({ client_id: CLIENT_ID || "mock", redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "), code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent select_account" })}`;
  if (mock) setTimeout(() => (mock === "deny" ? fail(Object.assign(new Error("access_denied"), { status: 400 })) : deliver("mock-code")), 1500);
  else openExternal(authUrl);
  const timer = setTimeout(() => fail(Object.assign(new Error("시간 초과"), { status: 0 })), timeoutMs);
  try {
    const code = await got;
    const r = await fetchImpl(URL_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: CLIENT_ID || "mock", client_secret: CLIENT_SECRET || "", redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw Object.assign(new Error(j.error_description || j.error || "토큰 받기 실패"), { status: r.status || 400 });
    if (!mock && !hasCloud(j.scope)) throw NO_SCOPE();
    let email = ""; try { email = JSON.parse(Buffer.from(String(j.id_token).split(".")[1], "base64").toString("utf8")).email || ""; } catch {}
    return { accessToken: j.access_token, refreshToken: j.refresh_token || "", expiresAt: Date.now() + (j.expires_in || 3600) * 1000, email, authUrl };
  } finally { clearTimeout(timer); try { server?.close(); } catch {} }
}

export async function refreshAccess(refreshToken, { fetchImpl } = {}) {
  const r = await fetchImpl(URL_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: refreshToken, client_id: CLIENT_ID || "mock", client_secret: CLIENT_SECRET || "", grant_type: "refresh_token" }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error(j.error === "invalid_grant" ? "구글 연결이 끊겼어요. [구글로 연결]을 다시 눌러 주세요." : `토큰 새로 받기 실패 (${r.status})`), { status: r.status });
  return { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000, scopeOk: !j.scope || hasCloud(j.scope) };
}

// 열린 결제 계정(무료 체험 포함) — 없으면 null
export async function findBilling(token, { fetchImpl } = {}) {
  const j = await call(fetchImpl, `${BILL}/billingAccounts`, { token });
  return (j.billingAccounts || []).find((b) => b.open) || null;
}
// 이미 만든 씨드핵 프로젝트(라벨 seedhack=1)가 있으면 그걸, 없으면 새로
export async function ensureProject(token, { fetchImpl, sleep } = {}) {
  const found = await call(fetchImpl, `${CRM}/projects:search?query=${encodeURIComponent("labels.seedhack:1 state:ACTIVE")}`, { token });
  const ex = (found.projects || []).find((p) => p.state === "ACTIVE" || !p.state);
  if (ex) return ex.projectId;
  const projectId = `seedhack-${crypto.randomBytes(3).toString("hex")}`;
  const op = await call(fetchImpl, `${CRM}/projects`, { token, method: "POST", body: { projectId, displayName: "SeedHack AI", labels: { seedhack: "1" } } });
  await waitOp(fetchImpl, CRM, op.name, token, { sleep });
  return projectId;
}
export async function linkBilling(token, projectId, billingName, { fetchImpl } = {}) {
  return call(fetchImpl, `${BILL}/projects/${encodeURIComponent(projectId)}/billingInfo`, { token, method: "PUT", body: { billingAccountName: billingName } });
}
export async function enableApis(token, projectId, { fetchImpl, sleep } = {}) {
  const op = await call(fetchImpl, `${SU}/projects/${encodeURIComponent(projectId)}/services:batchEnable`, { token, method: "POST", body: { serviceIds: APIS } });
  if (op?.name && !op.done) await waitOp(fetchImpl, SU, op.name, token, { sleep, every: 4000, tries: 45 });
}

// 전체 흐름. 이어 하기: saved = { refreshToken, email, projectId, billing, linked, enabled } — 끝난 단계는 건너뛴다
// onStep({ id, status:"now"|"wait"|"done"|"error", msg, eta, error, help, actions })
export async function runSetup({ saved = {}, openExternal = () => {}, onStep = () => {}, onSave = () => {}, fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), billingPollMs = 5000, billingWaitMs = 20 * 60 * 1000, test = null } = {}) {
  const mock = process.env.SEEDHACK_GOOGLE_MOCK || null;
  fetchImpl ||= mock ? createMock(mock) : globalThis.fetch;
  const s = { ...saved };
  let cur = "login";
  const step = (id, status, extra = {}) => { cur = id; onStep({ id, status, eta: STEPS.find((x) => x.id === id)?.eta, ...extra }); };
  try {
    let at;
    if (s.refreshToken) {
      step("login", "now", { msg: "저장된 구글 연결을 확인하는 중" });
      const r = await refreshAccess(s.refreshToken, { fetchImpl });
      if (r.scopeOk) at = r.accessToken; else s.refreshToken = ""; // 권한이 빠진 예전 연결 → 로그인부터 다시
    }
    if (!at) {
      step("login", "wait", { msg: "브라우저에서 구글 계정을 고르고, 체크 칸을 모두 선택한 뒤 [계속]을 눌러 주세요", sub: "‘모두 선택’에 체크해야 AI 를 쓸 수 있어요" });
      const r = await login({ openExternal, fetchImpl, mock });
      at = r.accessToken; Object.assign(s, { refreshToken: r.refreshToken, email: r.email }); onSave(s);
    }
    step("login", "done", { msg: s.email || "로그인됨" });
    if (!s.billing) {
      step("billing", "now", { msg: "무료 체험(결제 계정)을 확인하는 중" });
      let b = await findBilling(at, { fetchImpl });
      if (!b) {
        step("billing", "wait", { msg: "카드만 등록하면 끝나요", sub: "본인 확인용이에요 · 무료 체험이 끝나도 자동 결제되지 않아요", actions: ["openTrial"] });
        openExternal(TRIAL_URL(s.email));
        const t0 = Date.now();
        while (!b && Date.now() - t0 < billingWaitMs) { await sleep(billingPollMs); b = await findBilling(at, { fetchImpl }); }
        if (!b) throw Object.assign(new Error("무료 체험 가입이 확인되지 않음"), { status: 408, help: "무료 체험 가입을 마친 뒤 [다시 시도]를 눌러 주세요." });
      }
      s.billing = b.name; onSave(s);
    }
    step("billing", "done", { msg: "무료 체험 확인됨" });
    if (!s.projectId) { step("project", "now", { msg: "내 구글 클라우드에 씨드핵 전용 공간을 만드는 중" }); s.projectId = await ensureProject(at, { fetchImpl, sleep }); onSave(s); }
    step("project", "done", { msg: s.projectId });
    if (!s.linked) { step("link", "now", { msg: "무료 체험 크레딧을 연결하는 중" }); await linkBilling(at, s.projectId, s.billing, { fetchImpl }); s.linked = true; onSave(s); }
    step("link", "done");
    if (!s.enabled) { step("enable", "now", { msg: "글 AI·이미지 AI·글자 읽기 기능을 켜는 중" }); await enableApis(at, s.projectId, { fetchImpl, sleep }); s.enabled = true; onSave(s); }
    step("enable", "done");
    step("test", "now", { msg: "글 AI · 이미지 AI · 글자 읽기를 시험하는 중" });
    // 새로 만든 프로젝트는 권한·기능이 퍼지는 데 1~3분 걸려 처음엔 403 이 난다 → 20초 간격으로 최대 3분 다시 시험
    let checks = test ? await test(s) : null;
    const bad = (c) => c && Object.values(c).some((x) => x && !x.ok);
    for (let i = 0; i < 9 && bad(checks); i++) { step("test", "now", { msg: `새로 켠 AI 기능이 열리기를 기다리는 중 (${i + 1}/9)`, sub: "처음 연결할 때만 1~3분 걸려요" }); await sleep(20000); checks = await test(s); }
    if (checks && Object.values(checks).some((c) => c && !c.ok)) throw Object.assign(new Error(Object.values(checks).filter((c) => !c.ok).map((c) => c.msg).join(" · ")), { status: 400, checks, help: "새로 켠 기능은 1~2분 뒤에 열려요. 잠시 뒤 [다시 시도]를 눌러 주세요." });
    step("test", "done", { checks });
    return { ok: true, saved: s, checks };
  } catch (e) {
    const help = e.help || stepError(cur, e.status, e.message);
    step(cur, "error", { error: String(e.message || e).slice(0, 200), help, checks: e.checks || null });
    return { ok: false, saved: s, step: cur, error: e.message, help };
  }
}
