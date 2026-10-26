// ▶ 주소로 만들기 · 한국 판매처 끝까지 하네스:  npx electron test/detail/ko-flow.js "<오늘의집·네이버 상품 주소>" [--page=<fixture.json>] [--generate] [--ref]
// 임시 userData(앱 데이터는 건드리지 않음)에서 실제 index.js 흐름: detail:fromUrl(숨은 창 1번) 또는 --page(저장한 화면, 접속 없음) → 1단계(prepare)
// → 확인 화면 값(koSource·만들기 방식·권리) → 권리 확인 없이 생성하면 막히는지 → --generate: rightsOk 후 detail:confirm → 렌더까지 · --ref: 🧲 레퍼런스로 저장(AI 비용)
// SEEDHACK_DETAIL_NO_AI=1 이면 AI 단계(사진 검수·기획·카피) 없이 흐름만. 마지막 줄 KOFLOW_OK
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USER = path.join(os.tmpdir(), "seedhack-ko-flow");
fs.rmSync(USER, { recursive: true, force: true }); fs.mkdirSync(USER, { recursive: true });
app.setPath("userData", USER);
app.on("window-all-closed", () => {});
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; }, flag = (k) => argv.includes(`--${k}`);
const url = argv.find((a) => !a.startsWith("--") && /[./]/.test(a) && !/ko-flow\.js$/.test(a));
const handlers = {}, events = [];
const ipc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; }, removeListener: () => {} };
const store = (() => { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; })();
const log = (cls, text) => { if (/▶|■|✕|△|📄 |🧲/.test(text)) console.log(`   ${String(text).slice(0, 200)}`); };
const send = (ch, d) => { if (ch === "detail:progress") events.push(d); };
const rd = (d, f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); } catch { return null; } };
const fails = [], check = (id, c, m) => { console.log(`${c ? "  ✔" : "  ✕"} ${id} ${m}`); if (!c) fails.push(`${id} ${m}`); };
const waitDone = (jobId, since, ms = 900000) => new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { const e = events.slice(since).find((x) => x.jobId === jobId && (x.step === "done" || x.step === "fail")); if (e) return res(e); if (Date.now() - t0 > ms) return rej(new Error("시간 초과")); setTimeout(tick, 500); }; tick(); });

app.whenReady().then(async () => {
  const t0 = Date.now();
  try {
    const { initDetail } = await import(pathToFileURL(path.join(here, "../../src/main/detail/index.js")).href);
    initDetail({ ipcMain: ipc, app, getWin: () => null, store, log, translate: async (t) => t, getCnSession: () => null, getCnView: () => null, send, showDetail: () => {} });
    let jobId;
    if (opt("page")) { // 저장한 화면으로(접속 없음): buildKoRaw → detail:prepare
      const { buildKoRaw } = await import(pathToFileURL(path.join(here, "../../src/main/detail/site-core.js")).href);
      const f = JSON.parse(fs.readFileSync(opt("page"), "utf8"));
      const r = await handlers["detail:prepare"]({}, { source: { ...buildKoRaw(f.site, f.page, { id: f.id }), _raw: true } });
      if (r?.error) throw new Error(r.error); jobId = r.jobId;
    } else {
      const r = await handlers["detail:fromUrl"]({}, { url });
      console.log(`■ fromUrl → ${JSON.stringify(r).slice(0, 200)}`);
      if (r?.error) throw new Error(r.error); jobId = r.jobId;
    }
    const e1 = await waitDone(jobId, 0);
    const dir = path.join(USER, "detail", jobId);
    if (e1.step === "fail") throw new Error("1단계 실패: " + e1.msg);
    const src = rd(dir, "source.json"), ocr = rd(dir, "ocr.json"), clean = rd(dir, "clean.json") || [], tr = rd(dir, "translate.json") || {};
    console.log(`■ 1단계 ${((Date.now() - t0) / 1000).toFixed(0)}초 · ${src.source} · ${src.title_ko} · 이미지 ${src.images.length}장 · OCR ${ocr.provider} 글상자 ${ocr.images.reduce((n, x) => n + (x.boxes?.length || 0), 0)}개`);
    check("K-1", src.lang === "ko" && src.title_ko && src.attrs.every((a) => a.k_ko && a.v_ko), "source.json lang ko · _ko 칸 채움");
    check("K-2", clean.every((c) => !c.erased), `한글 지우기 없음 (지운 글자 ${clean.reduce((n, c) => n + (c.erased || 0), 0)}개)`);
    check("K-3", Object.keys(tr).length === 0, `번역 요청 없음 (${Object.keys(tr).length}문장)`);
    const ko = ocr.images.flatMap((o) => o.boxes || []).map((b) => b.text_ko).filter(Boolean);
    console.log(`  OCR 한글 예: ${ko.slice(0, 6).join(" / ")}`);
    const info = await handlers["detail:info:get"]({}, { jobId });
    check("K-4", info.koSource === src.source && info.mode === "scene" && !info.modes.localize && !info.modes.both, `확인 화면: koSource ${info.koSource} · 방식 ${info.mode} · 고를 수 있는 방식 ${Object.keys(info.modes).join(",")}`);
    console.log(`  대표 ${info.gallery.length}(사용 ${info.gallery.filter((x) => !x.excluded).length}) · 상세 ${info.detail.length}(사용 ${info.detail.filter((x) => !x.excluded).length}) · 상품명 ${info.product_name_ko}`);
    console.log(`  기획서 앞부분: ${String(info.brief_text || "").replace(/\s+/g, " ").slice(0, 240)}`);
    const blocked = await handlers["detail:confirm"]({}, { jobId });
    check("K-5", /내 상품 사진이에요/.test(blocked?.error || ""), `권리 확인 전 생성 → 막힘 (${blocked?.error || "막히지 않음"})`);
    if (flag("ref")) { const r = await handlers["detail:refFromJob"]({ sender: { send: () => {} } }, { jobId }); check("K-7", r?.ok && r.template?.id, `🧲 레퍼런스로 저장 → ${r?.error || r.template?.name} · 상세 ${r?.images}장 · $${r?.usd}`); }
    if (flag("generate")) {
      await handlers["detail:info:set"]({}, { jobId, patch: { rightsOk: true } });
      const n0 = events.length, tg = Date.now();
      const c = await handlers["detail:confirm"]({}, { jobId }); if (c?.error) throw new Error("생성 시작 실패: " + c.error);
      const e2 = await waitDone(jobId, n0);
      if (e2.step === "fail") throw new Error("2단계 실패: " + e2.msg);
      const res = rd(dir, "result.json"), plan = rd(dir, "plan.json");
      check("K-6", (res.renders || []).length >= 1 && !(res.renders || []).some((x) => x.templateId === "localize"), `2단계 ${((Date.now() - tg) / 1000).toFixed(0)}초 · 렌더 ${(res.renders || []).map((x) => `${x.templateId}:${x.sliceCount}조각`).join(", ")} · 섹션 ${plan?.sections?.length}`);
      console.log(`  미리보기 ${path.join(dir, res.preview || "")}`);
    }
  } catch (e) { fails.push(String(e?.message || e)); console.log("  ✕", e?.message || e); }
  console.log(fails.length ? `KOFLOW_FAIL ${fails.length}건\n - ${fails.join("\n - ")}` : "KOFLOW_OK");
  app.exit(fails.length ? 1 : 0);
});
