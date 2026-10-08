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
