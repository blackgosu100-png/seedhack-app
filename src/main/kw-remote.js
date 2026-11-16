// 🔑 키워드 서버에 묻기 (2026-11-16) — 수강생 앱엔 키워드 DB 파일(~/sellar-data)이 없으므로 맥미니 키워드 서버(server/kw-server.mjs)에 묻는다
// 어디서 읽을지(store "kwSource"): auto(기본) = 이 PC에 키워드 DB 파일이 있으면 로컬, 없으면 서버 · server = 늘 서버 · local = 늘 로컬
// 서버 주소는 나중에 Supabase로 옮겨도 경로가 같다(docs/서버-키워드DB-설계.md) → KW_SERVER 한 줄만 바꾸면 된다
import { net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { store } from "./store.js";
import { accessToken, wingVendorId } from "./auth.js";

export const KW_SERVER = process.env.KW_SERVER || "https://kw.noah-lap.cloud";
export const hasLocalDb = () => { try { return fs.readdirSync(path.join(os.homedir(), "sellar-data")).some((f) => /^sellar_\d{4}-\d{2}\.db$/.test(f)); } catch { return false; } };
export function kwSource() {
  const s = store.get("kwSource") || "auto";
  return s === "server" || s === "local" ? s : hasLocalDb() ? "local" : "server";
}
export const useServer = () => kwSource() === "server";

async function call(method, p, body) {
  const token = await accessToken().catch(() => null);
  const vendor = await wingVendorId().catch(() => null);
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await net.fetch(`${KW_SERVER}${p}`, { method, signal: c.signal, cache: "no-store",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(vendor ? { "x-vendor-id": String(vendor) } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => null);
    if (!j) return { error: `키워드 서버 응답 오류 (${r.status})` };
    return j;
  } catch (e) {
    return { error: e.name === "AbortError" ? "키워드 서버가 응답하지 않아요 — 잠시 뒤 다시 시도해 주세요" : "키워드 서버에 연결하지 못했어요 — 잠시 뒤 다시 시도해 주세요" };
  } finally { clearTimeout(t); }
}

// 키워드 추천 깔때기: 실패하면 던진다(화면은 "키워드 DB를 읽지 못했습니다"로)
export async function rScan(opts) { const r = await call("POST", "/api/signal/kw/scan", { opts }); if (r.error) throw new Error(r.error); return r; }
// 받기·기록·보너스: 서버가 횟수를 센다. 처음 서버로 연결할 때 이 PC의 받은 기록을 한 번 옮긴다
async function importOnce() {
  if (store.get("kwImported")) return;
  const st = store.get("recoDraw");
  if (st?.seen?.length) { const r = await call("POST", "/api/signal/kw/import", { seen: st.seen, history: st.history || [] }); if (r.error) return; }
  store.set("kwImported", true);
}
export async function rDraw(opts) { await importOnce(); return call("POST", "/api/signal/kw/draw", { opts }); }
export async function rState() { await importOnce(); const r = await call("GET", "/api/signal/kw/state"); return r.error ? { left: 0, daily: 10, per: 10, bonus: 5, history: [], batches: [], error: r.error } : r; }
export const rBonus = () => call("POST", "/api/signal/kw/bonus", {});
// 키워드 분석·상품명·브랜드: 실패해도 화면은 Wing 숫자만으로 계속(지금 DB 파일이 없을 때와 같은 빈 값)
const memo = new Map(); // 같은 키워드는 하루 동안 다시 묻지 않음
const remember = async (key, fn) => { const m = memo.get(key); if (m && Date.now() - m.at < 864e5) return m.v; const v = await fn(); if (!v?.error) { memo.set(key, { at: Date.now(), v }); if (memo.size > 2000) memo.delete(memo.keys().next().value); } return v; };
export async function rLookup(kw) { const r = await remember(`l:${kw}`, () => call("GET", `/api/signal/kw/lookup?kw=${encodeURIComponent(kw)}`)); return r.error ? { month: null, main: null, subs: [] } : r; }
export async function rName(keyword, words) { const r = await call("POST", "/api/signal/kw/name", { keyword, words }); return r.error ? { month: null, main: null, subs: [], vol: {} } : r; }
export async function rBrands(names) { const r = await call("POST", "/api/signal/kw/brands", { names }); return new Set(r.error ? [] : r.famous || []); }
