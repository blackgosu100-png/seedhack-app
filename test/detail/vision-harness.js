// 👁 비전 검수 하네스 — 실제 작업 폴더의 clean/*.png 8장으로 Claude CLI(Read 도구) 를 1회 호출해 결과 JSON·비용을 저장한다.
//   node test/detail/vision-harness.js [작업폴더] [장수]   (기본: 씨드핵 userData 의 20261009-080956-948424797701, 8장)
//   결과: test/detail/fixture/vision-real-sample.json (A5 재생 모드·plan-core 테스트용)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewPhotos, normalizeVisionItem, VISION_ROLES } from "../../src/main/detail/vision.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail", "20261009-080956-948424797701");
const n = Number(process.argv[3] || 8);
const src = JSON.parse(fs.readFileSync(path.join(dir, "source.json"), "utf8"));
const ids = ["g01", "g02", "g04", "d05", "d09", "d13", "d17", "d21", "g06", "d11"].filter((id) => fs.existsSync(path.join(dir, "clean", `${id}.png`))).slice(0, n);
const items = ids.map((id) => { const im = src.images.find((x) => x.id === id) || {}; return { id, file: path.join(dir, "clean", `${id}.png`), kind: im.kind || (id.startsWith("g") ? "gallery" : "detail"), w: im.w, h: im.h }; });
const product = { title_ko: src.title_ko || "벽걸이 접이식 빨래 건조대", keyword: src.keyword || "빨래건조대", attrs_ko: (src.attrs || []).slice(0, 8).map((a) => `${a.k_ko || a.k_zh}: ${a.v_ko || a.v_zh}`) };
console.log(`▶ 비전 검수 하네스 · ${items.length}장 · ${dir}`);
const log = (cls, text) => console.log(`[${cls}] ${text}`);
const r = await reviewPhotos({ items, product, log });
console.log(`■ ok=${r.ok} · 호출 ${r.calls}회 · ${(r.elapsedMs / 1000).toFixed(1)}초 · $${r.costUsd.toFixed(4)}${r.error ? ` · 오류 ${r.error}` : ""}`);
let bad = 0;
for (const it of r.items) {
  const okShape = typeof it.usable === "boolean" && it.score >= 1 && it.score <= 5 && VISION_ROLES.includes(it.role) && typeof it.shows === "string";
  if (!okShape) bad++;
  console.log(`  ${it.id} · ${it.usable ? "✔" : "✕"} ${it.score}점 · ${it.role} · 글자${it.has_text ? "○" : "×"} 로고${it.has_logo ? "○" : "×"} · ${it.shows} | ${it.caption_title} — ${it.caption_desc}`);
}
fs.writeFileSync(path.join(here, "fixture", "vision-real-sample.json"), JSON.stringify({ dir, product, items: r.items, costUsd: r.costUsd, elapsedMs: r.elapsedMs, calls: r.calls, error: r.error || null, createdAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`  저장: ${path.join(here, "fixture", "vision-real-sample.json")}`);
void normalizeVisionItem;
const ok = r.ok && bad === 0 && r.items.length === items.length;
console.log(ok ? "OK 비전 검수 하네스" : `FAIL 비전 검수 하네스 (형식 오류 ${bad}, 응답 ${r.items.length}/${items.length})`);
if (!ok) process.exitCode = 1;
