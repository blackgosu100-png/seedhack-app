// 제휴 키워드 DB(keyword-pipeline이 만든 ~/sellar-data/sellar_YYYY-MM.db) 읽기 — 월검색량·서브키워드 후보
// 파일이 없으면 조용히 빈 값을 돌려준다(검색은 Wing 지표만으로도 동작).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), "sellar-data");
let db = null, month = null, tried = false;

async function open() {
  if (db || tried) return db;
  tried = true;
  try {
    const files = fs.readdirSync(DIR).filter((f) => /^sellar_\d{4}-\d{2}\.db$/.test(f)).sort();
    if (!files.length) return null;
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(path.join(DIR, files.at(-1)), { readOnly: true });
    month = files.at(-1).slice(7, 14);
  } catch { db = null; }
  return db;
}

const row = (r) => r && {
  kw: r.keyword, m1: r.m1, fc: r.m1_fc_rate, price: r.cp_avg_price, mx: r.cp_max_reviews, tot: r.cp_total_reviews,
  rocket: r.cp_rocket, brand: r.is_brand === "O", season: r.seasonality === "있음", peak: r.ly_peak_month, cat: r.category,
};

export async function lookup(keyword) {
  const d = await open();
  if (!d) return { month: null, main: null, subs: [] };
  const kw = String(keyword).replace(/\s+/g, "");
  const main = row(d.prepare("select * from k where keyword = ?").get(kw));
  // 서브키워드: 이 키워드를 포함하는 더 긴 키워드(검색량 순) + 이 키워드에 포함되는 짧은 상위 키워드
  const longer = d.prepare("select * from k where keyword like ? and keyword <> ? and m1 >= 100 order by m1 desc limit 15").all(`%${kw}%`, kw).map(row);
  return { month, main, subs: longer };
}

// ✍ 상품명 짓기: 서브키워드를 더 넓게(40개 · 월검색 30+) + 상위 상품 단어로 만든 조합(고탄력팬티스타킹 / 팬티스타킹고탄력)의 검색량
export async function nameLookup(keyword, words = []) {
  const d = await open();
  if (!d) return { month: null, main: null, subs: [], vol: {} };
  const kw = String(keyword).replace(/\s+/g, "");
  const one = d.prepare("select * from k where keyword = ?");
  const main = row(one.get(kw));
  const subs = d.prepare("select * from k where keyword like ? and keyword <> ? and m1 >= 30 order by m1 desc limit 40").all(`%${kw}%`, kw).map(row);
  const vol = {};
  // 조합(고탄력팬티스타킹) · 겹치는 말 합치기(청소솔 + 변기솔 → 변기청소솔) · 단어 하나(청소솔)
  const keys = (w) => [w + kw, kw + w, w, ...[...Array(Math.max(0, kw.length - 1)).keys()].map((i) => kw.slice(0, i + 1) + w)];
  for (const w of words.slice(0, 60)) for (const k of keys(w)) { if (vol[k]) continue; const r = row(one.get(k)); if (r) vol[k] = { m1: r.m1, mx: r.mx }; }
  return { month, main, subs, vol };
}

// 💡 키워드 추천: keyword-pipeline이 같은 폴더에 복사해 둔 keyword_candidates_YYYY-MM.json(정제·그룹 분류 끝난 후보) 중 최신 달
export function recommend() {
  try {
    const files = fs.readdirSync(DIR).filter((f) => /^keyword_candidates_\d{4}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) return { month: null, keywords: [] };
    const j = JSON.parse(fs.readFileSync(path.join(DIR, files.at(-1)), "utf8"));
    return { month: j.month, keywords: Array.isArray(j.keywords) ? j.keywords : [] };
  } catch (e) { return { month: null, keywords: [], error: e.message }; }
}
