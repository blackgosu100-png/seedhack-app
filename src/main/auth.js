// 수강생 확인: ① 로켓그로스 대시보드 계정 로그인(Supabase 이메일·비밀번호) + ② Wing 판매자ID(sc_vid)가 승인(vendors)됐는지.
// 둘 다 통과해야 조회 기능이 열린다. 로그인 유지용 토큰은 OS 보안 저장소(safeStorage)로 암호화해 보관.
import { app, net, session, safeStorage } from "electron";
import { store } from "./store.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DASHBOARD_URL, ADMIN_EMAILS } from "./auth-config.js";

const GRACE = 3 * 24 * 60 * 60 * 1000;       // 승인 확인 후 인터넷이 끊겨도 쓸 수 있는 기간
const RECHECK = 6 * 60 * 60 * 1000;           // 승인 상태 다시 확인 주기
// 개발용 실행(npm start)에는 잠금을 걸지 않는다. 잠금 화면을 시험할 때만 SIGNAL_GATE=1
export const GATE_ON = app.isPackaged || process.env.SIGNAL_GATE === "1";

let user = null;     // { id, email, approval, confirmed }
let access = null;   // { token, exp }
let vendor = { id: null, status: null, formUrl: null, ts: 0 };

const enc = (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString("base64") : Buffer.from(s).toString("base64"));
const dec = (s) => { try { const b = Buffer.from(s, "base64"); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString(); } catch { return null; } };

async function token(body, grant) {
  const r = await net.fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST", headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String(j.error_description || j.msg || j.error || r.status);
    throw new Error(/invalid login|invalid_grant|credentials/i.test(m) ? "이메일 또는 비밀번호가 맞지 않습니다." : /not confirmed/i.test(m) ? "이메일 인증이 아직 안 됐습니다. 받은 메일함을 확인해 주세요." : `로그인 실패 (${m})`);
  }
  // 대시보드 회원 승인(app_metadata.approval_status) — 대시보드 canUseDashboard와 같은 기준
  const st = j.user?.app_metadata?.approval_status;
  user = {
    id: j.user?.id, email: j.user?.email,
    approval: st === "approved" || st === "rejected" ? st : "pending",
    confirmed: !!(j.user?.email_confirmed_at || j.user?.confirmed_at),
  };
  access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  store.set("auth", { email: user.email, approval: user.approval, confirmed: user.confirmed, rt: enc(j.refresh_token), vendor: store.get("auth")?.vendor || null, ts: Date.now() });
  return user;
}

export async function signIn(email, password) {
  return token({ email: String(email || "").trim(), password: String(password || "") }, "password");
}

// 저장된 로그인으로 다시 들어가기(앱 시작 시). 인터넷이 안 되면 마지막 승인 기록으로 GRACE 기간 동안 허용.
export async function restore() {
  const a = store.get("auth");
  const rt = a?.rt && dec(a.rt);
  if (!rt) return false;
  try { await token({ refresh_token: rt }, "refresh_token"); return true; }
  catch (e) {
    if (/로그인 실패 \((4\d\d)/.test(e.message) || /맞지 않/.test(e.message)) { store.set("auth", null); return false; }
    // 오프라인: 마지막으로 확인한 회원 승인 상태를 GRACE 기간 동안 사용
    const fresh = a.ts && Date.now() - a.ts < GRACE;
    user = { id: null, email: a.email, offline: true, approval: fresh ? a.approval : "pending", confirmed: !!a.confirmed };
    return true;
  }
}

export function signOut() {
  user = null; access = null;
  store.set("auth", null);
}

// Wing 로그인 세션의 판매자ID(sc_vid 쿠키)
export async function wingVendorId() {
  const cs = await session.fromPartition("persist:wing").cookies.get({ name: "sc_vid" }).catch(() => []);
  return cs.find((c) => /coupang\.com$/.test(c.domain.replace(/^\./, "")))?.value || cs[0]?.value || null;
}

// 대시보드 서버에 승인 여부 확인 (비밀 키는 서버에만 있음)
export async function checkVendor(force = false) {
  const id = await wingVendorId();
  if (!id) { vendor = { id: null, status: null, formUrl: null, ts: 0 }; return vendor; }
  if (!force && vendor.id === id && vendor.status === "approved" && Date.now() - vendor.ts < RECHECK) return vendor;
  try {
    const r = await net.fetch(`${DASHBOARD_URL}/api/license/check?vendor_id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const j = await r.json();
    if (j.status === "error") throw new Error(j.message || "확인 실패");
    vendor = { id, status: j.status, formUrl: j.form_url || null, ts: Date.now() };
    const a = store.get("auth");
    if (a) store.set("auth", { ...a, vendor: { id, status: j.status, ts: vendor.ts } });
  } catch {
    // 인터넷 문제: 같은 판매자ID가 GRACE 안에 승인된 기록이 있으면 그대로 허용
    const last = store.get("auth")?.vendor;
    vendor = last && last.id === id && last.status === "approved" && Date.now() - last.ts < GRACE
      ? { id, status: "approved", formUrl: null, ts: last.ts, offline: true }
      : { id, status: "error", formUrl: null, ts: Date.now() };
  }
  return vendor;
}

const isAdmin = (email) => ADMIN_EMAILS.includes(String(email || "").toLowerCase());
export const memberOk = () => !!user && (isAdmin(user.email) || (user.confirmed && user.approval === "approved"));
export const licensed = () => !GATE_ON || (memberOk() && vendor.status === "approved");

export function state() {
  return {
    gate: GATE_ON, licensed: licensed(),
    user: user ? { email: user.email, offline: !!user.offline, approval: user.approval, confirmed: user.confirmed, ok: memberOk() } : null,
    vendor: { id: vendor.id, status: vendor.status, formUrl: vendor.formUrl, offline: !!vendor.offline },
    signupUrl: `${DASHBOARD_URL}/signup?utm=app`, resetUrl: `${DASHBOARD_URL}/login`,
  };
}
