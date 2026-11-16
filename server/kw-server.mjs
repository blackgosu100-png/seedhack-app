// 🔑 씨드핵 키워드 서버 (맥미니에서 상시 실행, 2026-11-16)
// 수강생 앱이 키워드 DB 파일(~/sellar-data) 없이 키워드 추천·키워드 분석을 쓰게 한다. 바깥 주소: https://kw.noah-lap.cloud (cloudflared)
// 원칙
//  - 계산은 앱과 같은 코드(src/main/kw-combo.js · kwdb.js)를 그대로 쓴다 → 대표님 앱과 수강생 앱의 숫자가 같다
//  - 키워드 DB 원본은 내주지 않는다: 깔때기는 개수만, 받기는 10개씩, 조회는 1인 하루 한도
//  - 승인된 수강생만: 앱 로그인 토큰(Supabase) 확인 + 대시보드 판매자 승인(/api/license/check) — 앱 auth.js licensed()와 같은 기준
//  - 주소는 나중에 Supabase로 옮길 때도 같게(docs/서버-키워드DB-설계.md 4장) → 앱은 서버 주소 한 줄만 바꾸면 된다
// 실행: node server/kw-server.mjs  (포트 KW_PORT, 기본 4850 · 상태 파일 ~/seedhack-kw-server/state.json)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { scan, draw, famousBrands } from "../src/main/kw-combo.js";
import { lookup, nameLookup } from "../src/main/kwdb.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAILS, DASHBOARD_URL } from "../src/main/auth-config.js";

const PORT = Number(process.env.KW_PORT || 4850);
const DIR = path.join(os.homedir(), "seedhack-kw-server");
const STATE = path.join(DIR, "state.json");
const DRAW_PER = 10, DRAW_DAILY = 10, DRAW_BONUS = 5; // 앱 main.js와 같은 값(10개 × 하루 10번, 다 쓴 뒤 보너스 5번 하루 1번)
const LIMITS = { scan: 300, lookup: 1500, name: 300, brands: 1500 }; // 1인 하루 조회 한도 — 원본을 통째로 긁어 가는 것 방지(정상 사용은 수십~수백 번)

// ── 상태(사람별 받은 기록·하루 횟수·조회 수) — 파일 하나, 바뀔 때마다 저장 ──
fs.mkdirSync(DIR, { recursive: true });
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { state = {}; }
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { const tmp = STATE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, STATE); }, 300); };
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const resetAt = () => { const d = new Date(`${today()}T00:00:00+09:00`); return d.getTime() + 864e5; }; // 다음 한국 자정
function person(uid, email) {
  const p = state[uid] || (state[uid] = { email, draw: { day: "", used: 0, bonus: false, seen: [], history: [] }, calls: { day: "", n: {} } });
  p.email = email;
  if (p.draw.day !== today()) { p.draw.day = today(); p.draw.used = 0; p.draw.bonus = false; }
  if (p.calls.day !== today()) p.calls = { day: today(), n: {} };
  return p;
}
const drawLimit = (d) => DRAW_DAILY + (d.bonus ? DRAW_BONUS : 0);
const drawInfo = (d) => ({ left: Math.max(0, drawLimit(d) - d.used), daily: DRAW_DAILY, per: DRAW_PER, bonus: DRAW_BONUS, bonusUsed: !!d.bonus, resetAt: resetAt(), seenTotal: d.seen.length });
const drawBatches = (hist) => { const m = new Map(); for (const k of hist || []) { if (!k.at) continue; if (!m.has(k.at)) m.set(k.at, []); m.get(k.at).push(k); } return [...m.entries()].sort((a, b) => b[0] - a[0]).slice(0, 30).map(([at, items]) => ({ at, items })); };
function count(p, kind) { const n = (p.calls.n[kind] || 0) + 1; p.calls.n[kind] = n; save(); return n <= LIMITS[kind]; }

// ── 로그인·승인 확인 (10분 기억) ──
const authMemo = new Map(); // 토큰 해시 → { at, user | error }
const vendorMemo = new Map(); // 판매자 ID → { at, status }
async function whoIs(token, vendorId, dev) {
  if (process.env.KW_DEV === "1" && dev) return { uid: `dev:${dev}`, email: `${dev}@dev`, admin: true }; // 시험용(이 컴퓨터에서 KW_DEV=1로 켤 때만) — 바깥 주소로 켤 때는 쓰지 않음
  if (!token) return { error: "로그인이 필요해요", code: 401 };
  const key = crypto.createHash("sha256").update(token).digest("hex");
  let m = authMemo.get(key);
  if (!m || Date.now() - m.at > 10 * 60e3) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }).catch(() => null);
    const u = r?.ok ? await r.json().catch(() => null) : null;
    m = { at: Date.now(), user: u?.id ? u : null };
    authMemo.set(key, m);
    if (authMemo.size > 500) authMemo.delete(authMemo.keys().next().value);
  }
  const u = m.user;
  if (!u) return { error: "로그인이 만료됐어요. 앱에서 다시 로그인해 주세요", code: 401 };
  const email = String(u.email || "").toLowerCase();
  const admin = ADMIN_EMAILS.map((x) => x.toLowerCase()).includes(email);
  const member = admin || (!!u.email_confirmed_at && u.app_metadata?.approval_status === "approved");
  if (!member) return { error: "승인된 회원만 쓸 수 있어요", code: 403 };
  if (!admin) { // 관리자(대표님)는 판매자 승인 확인을 건너뜀
    if (!/^[A-Za-z0-9]{3,20}$/.test(String(vendorId || ""))) return { error: "Wing 로그인이 필요해요", code: 403 };
    let v = vendorMemo.get(vendorId);
    if (!v || Date.now() - v.at > (v.status === "approved" ? 6 * 3600e3 : 10 * 60e3)) {
      const r = await fetch(`${DASHBOARD_URL}/api/license/check?vendor_id=${encodeURIComponent(vendorId)}`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      v = { at: Date.now(), status: j?.status || "error" };
      vendorMemo.set(vendorId, v);
    }
    if (v.status !== "approved") return { error: "승인된 수강생만 쓸 수 있어요", code: 403 };
  }
  return { uid: u.id, email, admin };
}

// ── 주소 ──
// 깔때기: 단계별 개수·빠진 이유만(키워드 목록은 안 줌 — 묶음은 개수만)
const scanOut = (r) => ({ month: r.month, dbTotal: r.dbTotal, final: r.final, steps: r.steps, judged: r.judged, safeDef: r.safeDef, axesDef: r.axesDef,
  groups: Object.fromEntries(Object.entries(r.groups || {}).map(([k, g]) => [k, { count: g.count, items: [] }])), top3: [] });
const ROUTES = {
  "POST /api/signal/kw/scan": async (p, b) => (count(p, "scan") ? scanOut(await scan(b.opts || {})) : limitErr()),
  "GET /api/signal/kw/state": async (p) => ({ ...drawInfo(p.draw), history: p.draw.history.slice(0, 200), batches: drawBatches(p.draw.history) }),
  "POST /api/signal/kw/bonus": async (p) => {
    if (p.draw.bonus) return { error: "bonusUsed", ...drawInfo(p.draw) };
    if (p.draw.used < DRAW_DAILY) return { error: "notYet", ...drawInfo(p.draw) };
    p.draw.bonus = true; save();
    return { ok: true, ...drawInfo(p.draw) };
  },
  "POST /api/signal/kw/draw": async (p, b) => {
    const d = p.draw;
    if (d.used >= drawLimit(d)) return { error: "limit", ...drawInfo(d) };
    const r = await draw({ seen: d.seen, n: DRAW_PER, opts: b.opts || {} });
    if (!r.items.length) return { error: "empty", month: r.month, items: [], ...drawInfo(d) };
    const at = Date.now();
    d.used++; d.seen.push(...r.items.map((k) => k.kw));
    d.history = [...r.items.map((k) => ({ ...k, at })), ...d.history].slice(0, 500);
    save();
    return { ...r, ...drawInfo(d) };
  },
  // 앱에 있던 받은 기록을 처음 연결할 때 한 번 옮긴다(서버 기록이 비어 있을 때만)
  "POST /api/signal/kw/import": async (p, b) => {
    if (p.draw.seen.length || p.draw.history.length) return { ok: false, skipped: true, seenTotal: p.draw.seen.length };
    const seen = (Array.isArray(b.seen) ? b.seen : []).map(String).filter(Boolean).slice(0, 5000);
    const history = (Array.isArray(b.history) ? b.history : []).filter((k) => k && k.kw && k.at).slice(0, 500);
    p.draw.seen = [...new Set(seen)]; p.draw.history = history; save();
    return { ok: true, seenTotal: p.draw.seen.length };
  },
  "GET /api/signal/kw/lookup": async (p, b, q) => (count(p, "lookup") ? lookup(String(q.get("kw") || "").slice(0, 60)) : limitErr()),
  "POST /api/signal/kw/name": async (p, b) => (count(p, "name") ? nameLookup(String(b.keyword || "").slice(0, 60), (Array.isArray(b.words) ? b.words : []).map(String).slice(0, 60)) : limitErr()),
  "POST /api/signal/kw/brands": async (p, b) => (count(p, "brands") ? { famous: [...(await famousBrands((Array.isArray(b.names) ? b.names : []).map(String).slice(0, 100)))] } : limitErr()),
};
const limitErr = () => ({ error: "오늘 조회 한도를 다 썼어요. 내일 다시 쓸 수 있어요", code: 429 });

const send = (res, code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(s); };
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/health") return send(res, 200, { ok: true });
  const fn = ROUTES[`${req.method} ${u.pathname}`];
  if (!fn) return send(res, 404, { error: "없는 주소" });
  let body = {};
  if (req.method === "POST") {
    let raw = "";
    for await (const c of req) { raw += c; if (raw.length > 200e3) return send(res, 413, { error: "요청이 너무 커요" }); }
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { error: "잘못된 요청" }); }
  }
  try {
    const who = await whoIs(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), String(req.headers["x-vendor-id"] || ""), String(req.headers["x-dev-user"] || ""));
    if (who.error) return send(res, who.code, { error: who.error });
    const out = await fn(person(who.uid, who.email), body, u.searchParams);
    send(res, out?.code || 200, out);
    console.log(`${new Date().toISOString()} ${who.email} ${req.method} ${u.pathname} ${out?.code || 200} ${Date.now() - t0}ms`);
  } catch (e) {
    console.error(`${new Date().toISOString()} ${req.method} ${u.pathname} 오류`, e);
    send(res, 500, { error: "서버 오류 — 잠시 뒤 다시 시도해 주세요" });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`🔑 씨드핵 키워드 서버 http://127.0.0.1:${PORT} · 상태 ${STATE}`));
