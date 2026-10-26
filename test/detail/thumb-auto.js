// 🖼 썸네일 자동 만들기 시험 — 실제 작업 폴더를 임시 userData 로 복사하고 initThumb 의 auto() 를 "상세페이지 바쁨" 상태에서 부른다.
//   ① 바쁜 동안 기다림 표시(waiting) ② 한가해지면 시작 ③ 끝나면 detail:changed {thumb} 알림 ④ 이미 있으면 다시 안 함 ⑤ 스위치 끄면 안 함
// 실행: npx electron test/detail/thumb-auto.js <jobId>   (결과: 임시 폴더 경로를 마지막 줄에 출력)
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-auto-"));
app.setPath("userData", tmpUser);
app.on("window-all-closed", () => {});
const jobId = process.argv.slice(2).find((a) => /^\d{8}-/.test(a));
const SRC = path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail", jobId);
const NEED = ["result.json", "out", "source.json", "ocr.json", "vision.json", "brief.json", "info.json", "style.json", "cutout.json", "raw", "clean"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(`${c ? "✔" : "✕"} ${m}`); if (!c) process.exitCode = 1; };

app.whenReady().then(async () => {
  const dir = path.join(tmpUser, "detail", jobId); fs.mkdirSync(dir, { recursive: true });
  for (const f of NEED) { const s = path.join(SRC, f); if (fs.existsSync(s)) fs.cpSync(s, path.join(dir, f), { recursive: true }); }
  const h = {}; const ipcMain = { handle: (ch, fn) => (h[ch] = fn) };
  let settings = {}; const store = { get: (k) => (k === "settings" ? settings : null), set: (k, v) => { if (k === "settings") settings = v; } };
  const sent = []; const send = (ch, d) => sent.push([ch, d]);
  const { initThumb } = await import("../../src/main/detail/thumb.js");
  const hook = initThumb({ ipcMain, app, store, log: (_l, m) => console.log(m), send });
  ok((await h["thumb:settings"](null, {})).thumbAuto === true, "스위치 기본 켬");
  await h["thumb:settings"](null, { thumbAuto: false });
  ok(hook.auto(jobId) === false, "스위치를 끄면 자동으로 안 만듦");
  await h["thumb:settings"](null, { thumbAuto: true });
  let busy = true; setTimeout(() => (busy = false), 12000);
  const t0 = Date.now();
  ok(hook.auto(jobId, { busy: () => busy }) === true, "상세페이지 끝 → 자동 예약");
  const g1 = await h["thumb:get"](null, { jobId });
  ok(g1.run?.waiting === true, `뒤 검수 중엔 기다림 표시 · "${g1.run?.msg}"`);
  let last = "";
  for (;;) { const g = await h["thumb:get"](null, { jobId }); if (g.run?.msg !== last) { last = g.run?.msg; console.log(`  [${Math.round((Date.now() - t0) / 1000)}초] ${g.run?.waiting ? "기다림" : `${g.run?.pct}%`} ${last}`); } if (!g.run?.running) break; await wait(1000); }
  const g = await h["thumb:get"](null, { jobId });
  ok(!g.run?.error && !!g.result, `완성 · ${g.result?.items?.length}장 · 오류 ${g.run?.error || "없음"}`);
  ok(sent.some(([ch, d]) => ch === "detail:changed" && d?.thumb?.jobId === jobId && d.thumb.status === "done"), "끝나면 화면에 알림(detail:changed)");
  ok(hook.auto(jobId) === false, "이미 만든 썸네일이 있으면 다시 안 만듦");
  const u = await h["thumb:update"](null, { jobId, op: "exclude", id: g.result.items[1].id });
  ok(u.ok && u.result.items[1].excluded === true, "화면에서 빼기 → thumb.json 저장");
  const e = await h["thumb:export"](null, { jobId, open: false });
  ok(e.ok && e.files.some((f) => /01_대표이미지\.jpg$/.test(f)), `내보내기 ${e.files?.length}장`);
  console.log(JSON.stringify({ items: g.result.items.map((x) => `${x.kind}:${x.status}`), options: (g.result.optionMains || []).map((o) => `${o.name}:${o.status}`), cost: g.result.cost, timings: g.result.timings }));
  console.log(`RESULT_DIR ${path.join(dir, "thumb")}`);
  app.quit();
});
