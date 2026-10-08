// 로컬 저장소 (사용자 PC의 앱 데이터 폴더에 JSON으로 보관, 외부 전송 없음)
// MVP 단계라 JSON 파일 하나로 둔다. 제휴 DB를 넣는 단계에서 SQLite로 옮긴다.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const FILE = () => path.join(app.getPath("userData"), "signal-data.json");
let db = null;
let saveTimer = null;

function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch { db = {}; }
  db.snapshots ??= {};   // key("c:코드|정렬") → 최신 스냅샷
  db.exactCache ??= {};  // "pid:vid" → { ts, views, sales, price }
  db.limit ??= {};       // 속도 제한·하루 예산 기록
  db.settings ??= {};    // 판정 설정(틈새/큰 시장, 광고 여부)
  return db;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE()), { recursive: true });
      fs.writeFileSync(FILE(), JSON.stringify(db));
    } catch (e) { console.warn("[store] 저장 실패", e); }
  }, 300);
}

export const store = {
  get: (k) => load()[k],
  set(k, v) { load()[k] = v; save(); },
  putSnapshot(s) { load().snapshots[s.key] = s; save(); },
  latestSnapshot(code) {
    const all = Object.values(load().snapshots).filter((s) => !code || String(s.code) === String(code));
    return all.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] || null;
  },
  putExact(key, ex) {
    const c = load().exactCache;
    c[key] = ex;
    const keys = Object.keys(c);
    if (keys.length > 8000) keys.sort((a, b) => c[a].ts - c[b].ts).slice(0, keys.length - 8000).forEach((k) => delete c[k]);
    save();
  },
  file: FILE,
};
