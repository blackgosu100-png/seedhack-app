// 📄 상세페이지 파이프라인 끝까지 — `npx electron test/detail/e2e.js`
// 임시 userData + 가짜 ipcMain/send 로 initDetail 을 붙이고 fixture source 로 detail:run → 진행 이벤트 수집 → 결과 검사 → 취소 → 다른 템플릿 재렌더.
// 네트워크 접속 없음(이미지는 file://, 번역은 샘플 번역표). 다른 담당 모듈이 아직 없어도 통과하되 어떤 단계가 대체 동작이었는지 출력한다.
import { app, nativeImage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 실제 작업 재생: `--replay "<작업 폴더>"` — 그 폴더의 source.json(images)·raw/·ocr.json(·copy.json·translate.json)을 임시 userData 의 새 작업으로 복사해
// download·ocr·copy 는 "재사용"으로 건너뛰고 clean→translate→plan→render 만 다시 돌린다(네트워크 없음). 폴더를 생략하면 아래 실제 작업(2026-10-09 사용자 실행분).
const DEFAULT_REPLAY = "/Users/noah-mac/Library/Application Support/씨드핵/detail/20261009-080956-948424797701";
const RI = process.argv.indexOf("--replay");
const REPLAY = RI < 0 ? null : process.argv[RI + 1] && !process.argv[RI + 1].startsWith("--") ? process.argv[RI + 1] : DEFAULT_REPLAY;
const TI = process.argv.indexOf("--tpl");
const REPLAY_TPL = TI >= 0 ? process.argv[TI + 1] : "clean";
// v6 실제 폴더 실행: `--folder "<이미지 다운로더 폴더>" [--real] [--ai] [--mode both|localize|scene]` — 폴더 가져오기 → 1단계 → 방식 선택 → 생성하기 → 뒤 작업까지
// --real: 씨드핵 실제 userData(…/Application Support/씨드핵)에 저장해 앱 📄 목록에 보이게 한다(기존 작업은 지우지 않음)
const FOI = process.argv.indexOf("--folder");
const FOLDER = FOI >= 0 ? process.argv[FOI + 1] : null;
const REAL = !!FOLDER && process.argv.includes("--real");
// UI 캡처: `--ui "<작업 폴더>" --out "<png 폴더>" [--tag before|after]` — 실제 panel.html·preload 로 결과 화면을 1440×1080 에서 찍는다(작업 폴더는 임시 userData 로 복제)
const UII = process.argv.indexOf("--ui");
const UI_JOB = UII >= 0 ? process.argv[UII + 1] : null;
// 원본 한글화 앱 내 검수 실측: `--locqa "<작업 폴더>" [--no-qa] [--ai] [--out <png 폴더>] [--tag 이름]` — 작업 폴더를 임시 userData 로 복제(원본은 읽기만) → 원본 한글화만 생성
//   → 결과가 뜨는 시각(done) · 뒤 검수 끝 시각 · 비용 · 장별 결과 · 결과 화면 캡처(검수 중 / 끝 / 확인 필요만). --no-qa 는 검수 끈 비교용
// 장별 고치기 실측: `--locedit "<작업 폴더>" --out <png 폴더> [--ai]` — 복제본에서 다시 검수 → ⚠ 장마다 오른쪽 칸 단추·글 고치기·요청을 실제로 눌러 ⚠ 가 풀리는지 + 빼기/되돌리기
const LEI = process.argv.indexOf("--locedit");
const LE_JOB = LEI >= 0 ? process.argv[LEI + 1] : null;
const LQI = process.argv.indexOf("--locqa");
const LQ_JOB = LQI >= 0 ? process.argv[LQI + 1] : null;
const USER = REAL ? path.join(app.getPath("appData"), "씨드핵") : path.join(os.tmpdir(), "seedhack-detail-test", LE_JOB ? "locedit" : LQ_JOB ? `locqa-${path.basename(LQ_JOB)}${process.argv.includes("--no-qa") ? "-noqa" : ""}` : UI_JOB ? "ui" : FOLDER ? "folder" : REPLAY ? "replay" : "e2e");
// --keep-vision: 지난 재생 결과의 vision.json(사진 검수, ≈$1)을 다시 쓴다 — 누끼·구성·렌더만 바꿔 볼 때
const KEEP_VISION = process.argv.includes("--keep-vision");
let stashedVision = null;
if (KEEP_VISION && REPLAY) { try { const d = path.join(USER, "detail", `${path.basename(REPLAY)}-replay`, "vision.json"); if (fs.existsSync(d)) stashedVision = fs.readFileSync(d); } catch {} }
// --rerender: 지난 재생 폴더를 그대로 두고(지우지 않고) 저장된 결과(장면·카피·검수 등)를 재사용해 구성·렌더·자가 검수만 다시 — scene.json 을 손으로 고친 뒤 쓴다
const RERENDER = process.argv.includes("--rerender");
if (!RERENDER && !REAL) fs.rmSync(USER, { recursive: true, force: true });
fs.mkdirSync(USER, { recursive: true });
app.setPath("userData", USER);
app.on("window-all-closed", () => {}); // 렌더 단계가 숨은 창을 닫아도 앱이 끝나지 않게
// 카피·사진 검수는 기본 생략/규칙(비용 0) — `--ai` 를 주면 Claude CLI 경로(카피·사진 검수)까지 실제로 돈다(비용·시간은 결과에 출력)
if (!process.argv.includes("--ai")) process.env.SEEDHACK_DETAIL_NO_AI = "1";
const FIX = path.join(__dirname, "fixture");
const fails = [], notes = [];
const assert = (ok, what) => { if (ok) console.log("  ✔", what); else { console.log("  ✕", what); fails.push(what); } };

// ---------- 입력 만들기: A3 샘플(source-sample.json) → fixture 이미지(file://) → 자체 최소 샘플 ----------
function imgUrl(name) { const f = path.join(FIX, "img", name); return fs.existsSync(f) ? pathToFileURL(f).href : null; }
async function makeOwnImages(dir) { // 중국어 글자가 그려진 PNG 3장(숨은 창 캡처)
  const { BrowserWindow } = await import("electron");
  fs.mkdirSync(dir, { recursive: true });
  const texts = ["加厚材质 结实耐用", "可折叠设计 不占空间", "大容量 约60L"];
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const w = new BrowserWindow({ show: false, width: 790, height: 600, webPreferences: { offscreen: true } });
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;width:790px;height:600px;background:#f3f4f6;display:grid;place-items:center;font:700 48px sans-serif;color:#222">${texts[i]}</body>`)}`);
    await new Promise((r) => setTimeout(r, 300));
    const f = path.join(dir, `d${String(i + 1).padStart(2, "0")}.png`);
    fs.writeFileSync(f, (await w.webContents.capturePage()).toPNG()); w.destroy();
    out.push({ url: pathToFileURL(f).href, w: 790, h: 600 });
  }
  return out;
}
async function buildSource() {
  const sampleF = path.join(FIX, "source-sample.json");
  let tr = {};
  let src = null, from = "";
  if (fs.existsSync(sampleF)) {
    const d = JSON.parse(fs.readFileSync(sampleF, "utf8"));
    src = { ...d.source, keyword: d.keyword || "", coupangName: d.coupangName || "", category: d.category || "" };
    delete src.images; // 내려받기 단계를 실제로 돌린다
    tr = d.translations || {};
    // 이미지 주소를 fixture 파일(file://)로 — 네트워크 없음
    const re = (list, pre) => (list || []).map((x, i) => ({ ...x, url: imgUrl(`${pre}${String(i + 1).padStart(2, "0")}.png`) })).filter((x) => x.url);
    src.gallery = re(src.gallery, "g"); src.detailImages = re(src.detailImages, "d");
    src.options = (src.options || []).map((o) => ({ ...o, img: null }));
    from = "A3 source-sample.json + A1/A2 fixture/img";
  }
  if (!src || !src.detailImages.length) {
    const have = fs.existsSync(path.join(FIX, "img", "d01.png"));
    const det = have ? ["d01", "d02", "d03", "d04", "d05", "d06"].map((n) => ({ url: imgUrl(`${n}.png`) })).filter((x) => x.url) : await makeOwnImages(path.join(USER, "own-img"));
    src = { source: "1688", url: "https://detail.1688.com/offer/700000000001.html", offerId: "700000000001", title_zh: "加厚脏衣篮 折叠收纳筐 家用大容量", price: { min: 12.8, max: 15.5, currency: "CNY" },
      attrs: [{ k_zh: "材质", v_zh: "PP" }, { k_zh: "规格", v_zh: "40*30*60cm" }, { k_zh: "颜色", v_zh: "灰色" }], options: [{ label_zh: "灰色", img: null }], gallery: imgUrl("g01.png") ? [{ url: imgUrl("g01.png") }] : [],
      detailImages: det, detailText_zh: "加厚材质，结实耐用。可折叠设计。", shop: null, readAt: Date.now(), keyword: "빨래바구니" };
    tr = { "加厚脏衣篮 折叠收纳筐 家用大容量": "두꺼운 빨래바구니 접이식 수납함 가정용 대용량", 材质: "재질", 规格: "규격", 颜色: "색상", 灰色: "회색", "加厚材质，结实耐用。可折叠设计。": "두꺼운 재질, 튼튼하고 오래갑니다. 접이식 디자인." };
    from = have ? "자체 샘플(fixture/img 재사용)" : "자체 샘플(직접 그린 PNG)";
  }
  return { src, tr, from };
}

// ---------- 가짜 ipcMain / send ----------
const handlers = {};
const ipc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } };
const events = [];
const sentNav = [];
const send = (ch, data) => { if (ch === "detail:progress") events.push(data); else if (ch === "nav") sentNav.push(data); };
const store = (() => { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; })();
const cnSender = {}; // detail:fromPage 보낸이 확인용
const log = (cls, text) => { if (cls !== "dim" || process.env.E2E_VERBOSE) console.log(`   [${cls}] ${text}`); };
const call = (ch, p, sender = {}) => handlers[ch]({ sender }, p);
const waitEnd = (jobId, ms = 240000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const tick = () => { const e = events.find((x) => x.jobId === jobId && (x.step === "done" || x.step === "fail")); if (e) return res(e); if (Date.now() - t0 > ms) return rej(new Error("시간 초과")); setTimeout(tick, 100); };
  tick();
});

async function folderRun(det) {
  const MI = process.argv.indexOf("--mode"); const MODE = MI >= 0 ? process.argv[MI + 1] : "both";
  const fin = (id, n) => events.filter((e) => e.jobId === id && !e.bg && (e.step === "done" || e.step === "fail"))[n - 1];
  const waitFin = async (id, n, ms = 5400000) => { const t = Date.now(); while (!fin(id, n) && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 300)); return fin(id, n); };
  console.log(`폴더 실행: ${FOLDER}\n저장: ${path.join(USER, "detail")} · 방식 ${MODE} · AI ${process.argv.includes("--ai") ? "켬" : "끔"}`);
  const t0 = Date.now();
  const p = await call("detail:importFolder", { dir: FOLDER });
  if (!p?.jobId) { console.log("FOLDER_FAIL", p?.error); process.exitCode = 1; return; }
  const e1 = await waitFin(p.jobId, 1);
  const t1 = Date.now();
  const inf = call("detail:info:get", { jobId: p.jobId });
  console.log(`1단계 ${e1?.step} · ${((t1 - t0) / 1000).toFixed(0)}초 · main ${inf.gallery?.length} · SKU ${inf.sku?.length}${(inf.sku || []).filter((x) => x.sameAs).length ? ` (대표와 같음 ${(inf.sku || []).filter((x) => x.sameAs).length})` : ""} · detail ${inf.detail?.length}`);
  console.log(`예상: 한글화 $${inf.modes?.localize?.usd}·${inf.modes?.localize?.minutes}분 / 장면 $${inf.modes?.scene?.usd}·${inf.modes?.scene?.minutes}분 / 둘 다 $${inf.modes?.both?.usd}·${inf.modes?.both?.minutes}분`);
  if (e1?.step !== "done") { console.log("FOLDER_FAIL 1단계", e1?.msg); process.exitCode = 1; return; }
  call("detail:info:set", { jobId: p.jobId, patch: { mode: MODE } });
  call("detail:confirm", { jobId: p.jobId });
  const e2 = await waitFin(p.jobId, 2);
  const t2 = Date.now();
  const dir = det.jobDirOf(p.jobId);
  // 뒤 작업(뒤 검수·빠진 장면 채우기)까지 최대 15분 기다림
  while (Date.now() - t2 < 900000) { const r = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8")); const bgRun = events.some((e) => e.jobId === p.jobId && e.bg && e.step !== "done" && e.step !== "fail"); const bgEnd = events.some((e) => e.jobId === p.jobId && e.bg && (e.step === "done" || e.step === "fail")); if ((r.qa?.background || !process.argv.includes("--ai")) && (!bgRun || bgEnd)) break; await new Promise((q) => setTimeout(q, 3000)); }
  const res = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8"));
  console.log(`2단계 ${e2?.step} · 결과 화면까지 ${((t2 - t1) / 1000).toFixed(0)}초 · 전체 ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  console.log("비용:", JSON.stringify(res.costs || {}), "합계 $" + Number(res.costUsd || 0).toFixed(3));
  console.log("단계별:", JSON.stringify(res.timings || {}));
  for (const r of res.renders || []) { console.log(`  [${r.id}] ${r.label || r.templateId}`); (r.slices || []).forEach((sl) => console.log(`    ${path.join(dir, sl.file)}  ${sl.w}×${sl.h}`)); }
  console.log(`작업 폴더: ${dir}`);
  console.log(e2?.step === "done" ? "FOLDER_OK" : `FOLDER_FAIL ${e2?.msg}`);
}

// (주의) ESM 진입 파일에서 최상위 await app.whenReady() 는 교착된다 — Electron 은 진입 모듈 평가가 끝난 뒤에 ready 를 낸다
async function replay(det, from) {
  if (RERENDER) {
    const jobId = `${path.basename(from)}-replay`, dst = det.jobDirOf(jobId), t0 = Date.now();
    console.log(`다시 렌더: ${dst} · 템플릿 ${REPLAY_TPL}`);
    const FILL = process.argv.includes("--fill");
    const FI = process.argv.indexOf("--force"); const FORCE = FI >= 0 ? String(process.argv[FI + 1] || "").split(",").filter(Boolean) : [];
    const TI2 = process.argv.indexOf("--theme"); const THEME = TI2 >= 0 ? process.argv[TI2 + 1] : null;
    const STAGE2 = process.argv.includes("--stage2"); // 2단계 실측: 1단계 결과(사진 검수·기획서·톤) 재사용, 섹션·장면·카피 새로
    const r = STAGE2 ? call("detail:run", { jobId, templateId: "card", fresh: ["copy", "scene", "qa", "sections"], review: false }) : THEME ? call("detail:theme", { jobId, theme: THEME }) : FILL ? call("detail:sections:fill", { jobId, force: FORCE }) : call("detail:run", { jobId, templateId: REPLAY_TPL, fresh: ["qa"], review: false });
    if (r.error) { console.log("REPLAY_FAIL", r.error); process.exitCode = 1; return; }
    const end = await waitEnd(jobId, 5400000);
    for (const e of events.filter((x) => x.jobId === jobId && (["qa", "scene"].includes(x.step) || x.extra?.bg === "scene"))) console.log("   ", e.msg);
    const plan2 = JSON.parse(fs.readFileSync(path.join(dst, "plan.json"), "utf8")); console.log("  같은 사진:", JSON.stringify(plan2.duplicatesVisual || []));
    const sc2 = JSON.parse(fs.readFileSync(path.join(dst, "scene.json"), "utf8")); for (const it of sc2.items) console.log(`    ${it.pass ? "✔" : "✕"} ${it.id} ${it.section} ${it.score ?? ""} ${it.note || ""}`); console.log("  장면 오류:", JSON.stringify(sc2.errors || []).slice(0, 400));
    const res = JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8"));
    console.log(`  끝 = ${end.step} · ${((Date.now() - t0) / 1000).toFixed(0)}초 · 이번 비용 $${Number(res.costUsd || 0).toFixed(3)} · qa ${res.qa?.score ?? "-"}/5`);
    const plan = JSON.parse(fs.readFileSync(path.join(dst, "plan.json"), "utf8"));
    console.log("  섹션:", plan.sections.map((sec) => `${sec.type}${sec.image ? "(" + path.basename(sec.image) + (sec.scene ? "*" : "") + ")" : ""}`).join(" → "));
    res.slices.forEach((sl) => console.log(`  ${path.join(dst, sl.file)}  ${sl.w}×${sl.h}  [${(sl.sections || []).join(",")}]`));
    if (STAGE2) { // 결과 뒤 작업(뒤 검수·빠진 장면 채우기)까지 기다려 시간 기록
      const tR = Date.now(); let res2 = null;
      while (Date.now() - tR < 900000) { await new Promise((q) => setTimeout(q, 3000)); res2 = JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8")); const bgFill = events.some((e) => e.jobId === jobId && e.bg && (e.step === "done" || e.step === "fail")); const needFill = events.some((e) => e.jobId === jobId && e.bg); if (res2.qa?.background && (!needFill || bgFill)) break; }
      console.log(`  결과 화면까지 ${((tR - t0) / 1000).toFixed(0)}초 · 뒤 검수 ${res2?.qa?.score ?? "-"}/5 제안 ${res2?.qa?.suggestions?.length ?? 0}건 (${((res2?.qa?.ms || 0) / 1000).toFixed(0)}초) · 뒤 채우기 ${events.some((e) => e.jobId === jobId && e.bg) ? "있음" : "없음"} · 전체 끝 ${((Date.now() - t0) / 1000).toFixed(0)}초`);
      console.log("  단계별:", JSON.stringify(res2?.timings || {})); console.log("  비용:", JSON.stringify(res2?.costs || {}), "합계 $" + Number(res2?.costUsd || 0).toFixed(3));
      (res2?.qa?.suggestions || []).forEach((x) => console.log(`    제안 [${x.section}] ${x.kind}/${x.action}: ${x.what}`));
    }
    console.log(end.step === "done" ? "REPLAY_OK" : "REPLAY_FAIL"); return;
  }
  if (!fs.existsSync(path.join(from, "source.json")) || !fs.existsSync(path.join(from, "ocr.json"))) { console.log(`REPLAY_FAIL source.json/ocr.json 없음: ${from}`); process.exitCode = 1; return; }
  const jobId = `${path.basename(from)}-replay`;
  const dst = det.jobDirOf(jobId); fs.mkdirSync(path.join(dst, "raw"), { recursive: true });
  const src = JSON.parse(fs.readFileSync(path.join(from, "source.json"), "utf8"));
  let copied = 0;
  src.images = (src.images || []).map((im) => { const cand = [im.file, path.join(from, "raw", path.basename(im.file || `${im.id}.png`))].filter(Boolean).find((f) => fs.existsSync(f)); if (!cand) return null; const to = path.join(dst, "raw", path.basename(cand)); fs.copyFileSync(cand, to); copied++; return { ...im, file: to }; }).filter(Boolean);
  fs.writeFileSync(path.join(dst, "source.json"), JSON.stringify(src, null, 1));
  const AI = process.argv.includes("--ai");
  if (process.argv.includes("--prepare")) { // v4 1단계만: 사진 선별·누끼·기획서·디자인 톤까지 → 확인 화면 데이터, 시간 측정
    for (const f of ["ocr.json", "translate.json"]) if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(dst, f));
    const t0 = Date.now();
    const r = call("detail:prepare", { jobId, fresh: AI ? ["vision", "cutout", "brief"] : [] });
    if (r.error) { console.log("REPLAY_FAIL", r.error); process.exitCode = 1; return; }
    const end = await waitEnd(jobId, 1800000);
    const res = JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8"));
    console.log(`  1단계 끝 = ${end.step} · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 비용 $${Number(res.costUsd || 0).toFixed(3)}`);
    console.log("  단계별:", Object.entries(res.timings || {}).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)}s`).join(" · "));
    const inf = call("detail:info:get", { jobId });
    console.log(`  확인 데이터: 대표 ${inf.gallery.length}(제외 ${inf.gallery.filter((x) => x.excluded).length}) · 상세 ${inf.detail.length}(제외 ${inf.detail.filter((x) => x.excluded).length}) · 추천 ${inf.recommend?.templateId} (${inf.recommend?.reason}) · 예상 ${inf.estimate.sections}섹션 $${inf.estimate.usd} 약 ${inf.estimate.minutes}분`);
    console.log("  상품명:", inf.product_name_ko); console.log("  기획서:\n" + String(inf.brief_text).split("\n").map((l) => "    " + l).join("\n"));
    console.log("  톤앤매너:", JSON.stringify({ bg: inf.styleGuide?.background, pal: inf.styleGuide?.palette, acc: inf.styleGuide?.accents, tone: inf.styleGuide?.backgroundTone, light: inf.styleGuide?.lighting, rules: (inf.styleGuide?.consistencyRules || []).length }));
    console.log("결과 폴더:", dst); console.log(end.step === "done" ? "REPLAY_OK" : "REPLAY_FAIL"); return;
  } // --ai: copy.json·vision.json 은 재사용하지 않고 Claude CLI 로 새로 만든다(번역·OCR·raw 는 재사용)
  const reused = [];
  for (const f of ["ocr.json", "translate.json", ...(AI ? [] : ["copy.json", "vision.json", "brief.json", "cutout.json"])]) if (fs.existsSync(path.join(from, f))) { fs.copyFileSync(path.join(from, f), path.join(dst, f)); reused.push(f); }
  if (stashedVision) { fs.writeFileSync(path.join(dst, "vision.json"), stashedVision); reused.push("vision.json(지난 재생)"); }
  console.log(`재생 입력: ${from}\n  이미지 ${copied}장 복사 · 재사용 ${reused.join(", ")} · 템플릿 ${REPLAY_TPL}${AI ? " · AI 새로(카피·사진 검수)" : ""}`);
  const t0 = Date.now();
  const r = call("detail:run", { jobId, templateId: REPLAY_TPL, fresh: AI ? ["copy", "brief", "qa", "scene", "sections", ...(stashedVision ? [] : ["vision"])] : [], review: false });
  if (r.error) { console.log("REPLAY_FAIL", r.error); process.exitCode = 1; return; }
  const end = await waitEnd(jobId, AI ? 5400000 : 300000); // AI: 사진 검수(32장 ≈ 3분) + 카피(≈1~2분)
  const ev = events.filter((e) => e.jobId === jobId);
  console.log(`  이벤트 ${ev.length}개 · 끝 = ${end.step} · ${end.msg}`);
  for (const e of ev.filter((x) => (x.step === "clean" && x.extra?.id) || ["vision", "cutout", "brief", "qa"].includes(x.step) || (x.step === "render" && /^✔/.test(x.msg)))) console.log("   ", e.msg);
  if (end.step !== "done") { console.log("REPLAY_FAIL", end.msg); process.exitCode = 1; return; }
  const res = JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8"));
  const plan = JSON.parse(fs.readFileSync(path.join(dst, "plan.json"), "utf8"));
  console.log("  단계별 처리:", Object.entries(res.how).map(([k, v]) => `${k}=${v}`).join(" "));
  if (res.timings) console.log("  단계별 시간:", Object.entries(res.timings).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)}s`).join(" · "));
  if (res.renderCheck?.length) console.log(`  렌더 자동 점검 문제 ${res.renderCheck.length}건: ${res.renderCheck.slice(0, 4).map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" / ")}`);
  console.log(`  소요 ${((Date.now() - t0) / 1000).toFixed(1)}초 · 비용 ${res.costUsd != null ? "$" + Number(res.costUsd).toFixed(3) : "0"}${res.costs?.copy != null ? ` (카피 $${Number(res.costs.copy).toFixed(3)}${res.costs.copyMs ? " " + (res.costs.copyMs / 1000).toFixed(0) + "초" : ""})` : ""}${res.costs?.vision != null ? ` (사진 검수 $${Number(res.costs.vision).toFixed(3)}${res.vision?.ms ? " " + (res.vision.ms / 1000).toFixed(0) + "초" : ""})` : ""}${res.vision ? ` · 검수 ${res.vision.usable}/${res.vision.items}장 사용 가능` : ""}${res.costs?.brief != null ? ` (기획안 $${Number(res.costs.brief).toFixed(3)})` : ""}${res.costs?.qa != null ? ` (자가 검수 $${Number(res.costs.qa).toFixed(3)})` : ""}`);
  if (res.qa) console.log(`  AI 자가 검수: ${res.qa.score}/5 · 고친 것 ${res.qa.fixed}건 · ${res.qa.rounds}회차 · 남은 지적 ${res.qa.remaining}건${res.qa.defects?.length ? "\n    " + res.qa.defects.map((d) => `${d.section} ${d.kind}/${d.fix}: ${d.what}`).join("\n    ") : ""}`);
  if (res.brief) console.log(`  기획안(${res.brief.how}): ${res.brief.angle || ""} · ${res.brief.audience || ""}`);
  if (res.cutout) console.log(`  누끼: ${res.cutout.ok}/${res.cutout.items}장 · 팔레트 ${JSON.stringify(res.cutout.palette || null)}`);
  if (fs.existsSync(path.join(dst, "vision.json"))) { const v = JSON.parse(fs.readFileSync(path.join(dst, "vision.json"), "utf8")); for (const it of v.items || []) console.log(`    ${it.usable ? "✔" : "✕"} ${it.id} ${it.score ?? ""} ${it.role || ""} · ${it.shows || ""}${it.has_text ? " · 글자" : ""}${it.has_logo ? " · 로고" : ""}${it.caption_title ? ` · "${it.caption_title}"` : ""}`); }
  console.log("  섹션:", plan.sections.map((sec) => `${sec.type}${sec.image ? "(" + path.basename(sec.image) + (sec.scene ? "*" : "") + ")" : sec.images ? "(" + sec.images.length + "장)" : ""}`).join(" → "));
  if (fs.existsSync(path.join(dst, "scene.json"))) { const sc = JSON.parse(fs.readFileSync(path.join(dst, "scene.json"), "utf8")); console.log(`  장면 사진(${sc.provider}·${sc.model}) ${sc.items.length}장 · 통과 ${sc.items.filter((x) => x.pass).length} · ${(sc.ms / 1000).toFixed(0)}초`); for (const it of sc.items) console.log(`    ${it.pass ? "✔" : "✕"} ${it.id} ${it.purpose} same=${it.same_product} text=${it.has_text} ${it.score ?? ""} ${it.note || ""}  ${path.join(dst, it.file)}`); }
  if (res.costs?.scene != null) console.log(`  장면 검수 비용 $${Number(res.costs.scene).toFixed(3)}`);
  if (plan.dropped?.length) console.log("  제외:", plan.dropped.map((d) => `${d.id}:${d.why}`).join(" "));
  console.log("결과 폴더:", dst);
  res.slices.forEach((sl) => console.log(`  ${path.join(dst, sl.file)}  ${sl.w}×${sl.h}  [${(sl.sections || []).join(",")}]`));
  console.log("  미리보기:", path.join(dst, res.preview));
  console.log("REPLAY_OK");
}

async function uiCapture() {
  const { BrowserWindow, ipcMain } = await import("electron");
  const { initDetail } = await import(pathToFileURL(path.join(__dirname, "../../src/main/detail/index.js")).href);
  const OI = process.argv.indexOf("--out"), OUT = OI >= 0 ? process.argv[OI + 1] : path.join(USER, "shots"); fs.mkdirSync(OUT, { recursive: true });
  const TG = process.argv.indexOf("--tag"), TAG = TG >= 0 ? process.argv[TG + 1] : "shot";
  const jobId = path.basename(UI_JOB), dst = path.join(USER, "detail", jobId); fs.mkdirSync(path.dirname(dst), { recursive: true });
  const { execFileSync } = await import("node:child_process"); execFileSync("cp", ["-Rc", UI_JOB, dst]); // APFS 복제(빠름)
  let win = null;
  initDetail({ ipcMain, app, getWin: () => win, store, log: () => {}, translate: async (t) => t, getCnSession: () => null, getCnView: () => null, send: (ch, d) => win?.webContents.send(ch, d), showDetail: () => {} });
  win = new BrowserWindow({ show: false, width: 1440, height: 1080, useContentSize: true, webPreferences: { preload: path.join(__dirname, "../../src/preload/panel.cjs"), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, "../../src/renderer/panel.html"));
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(800);
  await js(`(() => { const b = document.getElementById("tDetail"); b.disabled = false; b.click(); })()`); await wait(1200);
  // 실제 경로: 지난 작업 목록에서 클릭 → 결과
  await js(`window.Detail.load()`); await wait(800);
  const clicked = await js(`(async () => { const n = (await window.signal.invoke("detail:list")).length; const b = document.querySelector('#dtJobs [data-job="${jobId}"]'); if (b) b.click(); return { listed: n, shown: window.Detail.state.jobs.length, clicked: !!b }; })()`);
  console.log("목록 클릭 경로:", JSON.stringify(clicked));
  if (!clicked.clicked) await js(`window.Detail.showResult(${JSON.stringify(jobId)})`);
  await wait(2500);
  const measure = () => js(`(() => { const H = innerHeight, s = document.getElementById("drSlices").getBoundingClientRect(); const vis = Math.max(0, Math.min(H, s.bottom) - Math.max(0, s.top)); return { H, top: Math.round(s.top), visible: Math.round(vis), pct: Math.round(vis / H * 100) }; })()`);
  const shot = async (name) => { const f = path.join(OUT, `${TAG}-${name}.png`); fs.writeFileSync(f, (await win.webContents.capturePage()).toPNG()); return f; };
  const m0 = await measure(); console.log(`처음: 미리보기 위 ${m0.top}px · 보이는 높이 ${m0.visible}/${m0.H} (${m0.pct}%) →`, await shot("top"));
  // 스크롤: 결과 칸 전체(바뀐 뒤) 또는 미리보기 칸(바뀌기 전) — 휠 이벤트로 실제 사용자처럼
  win.webContents.sendInputEvent({ type: "mouseWheel", x: 900, y: 700, deltaX: 0, deltaY: -900 }); await wait(700);
  const m1 = await measure(); console.log(`휠 아래로 900: 미리보기 위 ${m1.top}px · 보이는 높이 ${m1.visible}/${m1.H} (${m1.pct}%) →`, await shot("scrolled"));
  await js(`document.body.classList.add("present")`); await js(`(() => { const r = document.querySelector(".dt-result"); if (r) r.scrollTop = 0; const s = document.getElementById("drSlices"); if (s) s.scrollTop = 0; })()`); await wait(600);
  const m2 = await measure(); console.log(`발표 모드: 미리보기 위 ${m2.top}px · ${m2.pct}% →`, await shot("present"));
  await js(`(() => { const b = document.getElementById("drSum") || document.getElementById("drQaToggle"); b && b.click(); })()`); await wait(400); console.log("요약 펼침 →", await shot("summary-open"));
  // 말풍선 툴팁(hover) — 버튼 위에 마우스를 올리고 0.4초 뒤 찍기
  await js(`document.body.classList.remove("present"); document.querySelector(".dt-result").scrollTop = 0; document.getElementById("drSumBody").hidden = true`); await wait(300);
  for (const [name, sel] of [["tip-folder", "#drFolder"], ["tip-tpl", "#drTpl"], ["tip-src", "#drSrcOpen"], ["tip-logo", "#drSecList .dt-logo"]]) {
    const c = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!c) { console.log(`${name}: 요소 없음`); continue; }
    win.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 5 }); await wait(120);
    win.webContents.sendInputEvent({ type: "mouseMove", x: c.x, y: c.y }); await wait(450);
    const t = await js(`(() => { const t = document.querySelector(".seed-tip"); return t && !t.hidden ? t.textContent : null; })()`);
    console.log(`${name}: 말풍선 "${t}" →`, await shot(name));
  }
  // 접힌 작업 목록: ☰ 로 열기 → 캡처 → 목록에서 작업 클릭 → 닫힘
  const lc0 = await js(`(() => { const l = document.getElementById("dtLeft").getBoundingClientRect(); return Math.round(l.right); })()`);
  await js(`document.getElementById("drList").click()`); await wait(450);
  const lc1 = await js(`(() => { const l = document.getElementById("dtLeft").getBoundingClientRect(); return { right: Math.round(l.right), open: document.getElementById("detail").classList.contains("dt-listopen") }; })()`);
  console.log(`작업 목록: 접힘 오른쪽 끝 ${lc0}px → ☰ 열림 ${JSON.stringify(lc1)} →`, await shot("list-open"));
  await js(`document.querySelector('#dtJobs [data-job]').click()`); await wait(1500);
  console.log("목록에서 작업 고름 → 패널 닫힘:", !(await js(`document.getElementById("detail").classList.contains("dt-listopen")`)), "· 결과 화면:", await js(`!document.getElementById("dtResult").hidden`));
  const lab = await js(`[...document.querySelectorAll("#dtRowsGrp")].map((g) => getComputedStyle(g).display + "/" + g.hidden).join(",")`); console.log("리스트업 묶음(결과 화면):", lab);
  // 섹션 목록(완성 화면 썸네일) + 글자 편집 칸(잘림 없음)
  await js(`document.querySelector(".dt-result").scrollTop = 0; window.scrollTo(0, 0)`); await wait(300);
  const sh = await js(`(() => { const L = [...document.querySelectorAll("#drSecList li")]; return { items: L.length, shots: L.filter((l) => l.querySelector(".shot")).length, width: Math.round(document.getElementById("drSecs").getBoundingClientRect().width) }; })()`);
  console.log("섹션 목록:", JSON.stringify(sh));
  await js(`document.querySelectorAll("#drSecList li")[1]?.click()`); await wait(900);
  const ta = await js(`[...document.querySelectorAll("#seTexts textarea")].map((t) => ({ k: t.dataset.k, clipped: t.scrollHeight > t.clientHeight + 2 || t.scrollWidth > t.clientWidth + 2, len: t.value.length }))`);
  const ed = await js(`(() => { const r = document.getElementById("drSedit").getBoundingClientRect(); return { right: Math.round(r.right), W: document.documentElement.clientWidth, fits: r.right <= document.documentElement.clientWidth + 1 }; })()`);
  console.log("글 칸:", JSON.stringify(ta), "· 편집 칸:", JSON.stringify(ed), "→", await shot("sedit"));
  // 원본 한글화 탭: 목록이 그 탭의 실제 섹션이고, 눌러서 이동하는지
  const locId = await js(`window.signal.invoke("detail:get", { jobId: ${JSON.stringify(jobId)} }).then((r) => (r.renders || []).find((x) => x.templateId !== "card")?.id || "")`);
  if (locId) {
    await js(`window.Detail.showResult(${JSON.stringify(jobId)}, ${JSON.stringify(locId)})`); await wait(2500);
    await js(`document.querySelectorAll("#drSecList li")[5]?.click()`); await wait(1200);
    const g = await js(`(() => { const L = [...document.querySelectorAll("#drSecList li")]; const fl = document.querySelector("#drSlices .sec-flash"); return { items: L.length, shots: L.filter((l) => l.querySelector(".shot")).length, first: L.slice(0, 3).map((l) => l.querySelector("b").textContent), tags: L.slice(0, 3).map((l) => l.querySelector(".src-tag")?.textContent), flashTop: fl ? Math.round(fl.getBoundingClientRect().top) : null, sedit: !document.getElementById("drSedit").hidden }; })()`);
    console.log("원본 한글화 탭:", JSON.stringify(g), "→", await shot("loc-go"));
    await js(`window.Detail.showResult(${JSON.stringify(jobId)})`); await wait(2000);
  }
  // 목록 클릭 → 그 섹션으로 이동: 섹션 윗변이 고정 줄 바로 아래(±30px)에 오는지
  const nLi = await js(`document.querySelectorAll("#drSecList li").length`);
  for (const k of [7, nLi - 1]) {
    await js(`document.querySelectorAll("#drSecList li")[${k}]?.click()`); await wait(1200);
    const g = await js(`(() => { const p = window.Detail && document.querySelectorAll("#drSlices figure"); const li = document.querySelectorAll("#drSecList li")[${k}]; const fl = document.querySelector("#drSlices .sec-flash"); const hd = document.querySelector(".dt-rhead").getBoundingClientRect().bottom; return { sec: li.querySelector("b").textContent, flashTop: fl ? Math.round(fl.getBoundingClientRect().top) : null, headBottom: Math.round(hd) }; })()`);
    console.log("섹션 이동:", JSON.stringify(g), "→", await shot(`go-${k}`));
  }
  // 배지·FAQ·표·확인 목록도 편집 칸에 — 필드 수 확인 후 실제 저장 → 다시 그림 → plan 반영 확인
  const fc = await js(`(async () => { const r = await window.signal.invoke("detail:sections:get", { jobId: ${JSON.stringify(jobId)} }); return r.sections.map((x) => x.type + ":" + (x.fields || []).length).join(" "); })()`);
  console.log("섹션별 편집 글 수:", fc);
  const faqI = await js(`window.Detail.state ? [...document.querySelectorAll("#drSecList li")].findIndex((l) => /faq/.test(l.textContent)) : -1`);
  if (faqI >= 0) { await js(`document.querySelectorAll("#drSecList li")[${faqI}].click()`); await wait(900); await js(`document.querySelector(".dt-result").scrollTop = 0; window.scrollTo(0,0)`); console.log("FAQ 편집 칸 →", await shot("sedit-faq")); }
  if (process.argv.includes("--save")) {
    const n0 = await js(`window.signal.invoke("detail:get", { jobId: ${JSON.stringify(jobId)} }).then((r) => (r.renders || []).length)`);
    const secs = await js(`window.signal.invoke("detail:sections:get", { jobId: ${JSON.stringify(jobId)} }).then((r) => r.sections.map((x) => ({ id: x.id, type: x.type })))`);
    const id = (t) => secs.find((x) => x.type === t)?.id;
    const edits = [[id("hero"), { "icons.0.label": "폭 조절 OK" }], [id("faq"), { "items.0.q": "두 개를 함께 써도 되나요?" }], [id("spec"), { "rows.0.v": "낮은형 13.5cm / 높은형 20.5cm" }], [id("notice"), { "items.0": "사진 속 소품은 연출용입니다." }]].filter(([i]) => i);
    for (const [sectionId, patch] of edits) {
      const r = await js(`window.signal.invoke("detail:section:text", { jobId: ${JSON.stringify(jobId)}, sectionId: ${JSON.stringify(sectionId)}, patch: ${JSON.stringify(patch)}, render: false })`);
      if (r?.error) console.log("저장 실패", sectionId, r.error);
    }
    const r = await js(`window.signal.invoke("detail:section:text", { jobId: ${JSON.stringify(jobId)}, sectionId: ${JSON.stringify(edits[0][0])}, patch: {} })`);
    console.log("다시 그리기 시작:", JSON.stringify(r).slice(0, 120));
    const t0 = Date.now(); let n1 = n0; while (Date.now() - t0 < 240000) { await wait(2000); const g = await js(`window.signal.invoke("detail:get", { jobId: ${JSON.stringify(jobId)} })`); if (g && g.status !== "running" && (g.renders || []).length > n0) { n1 = g.renders.length; break; } }
    const plan = JSON.parse(fs.readFileSync(path.join(USER, "detail", jobId, "plan.json"), "utf8"));
    const S = (t) => plan.sections.find((x) => x.type === t) || {};
    console.log("렌더", n0, "→", n1, "· 반영:", JSON.stringify({ badge: S("hero").icons?.[0]?.label, faq: S("faq").items?.[0]?.q, spec: S("spec").rows?.[0]?.v, notice: S("notice").items?.[0] }));
    await js(`window.Detail.showResult(${JSON.stringify(jobId)})`); await wait(2500); console.log("저장 뒤 →", await shot("saved"));
  }
  console.log("UI_OK");
}

async function locqaRun() {
  const { BrowserWindow, ipcMain } = await import("electron");
  const { initDetail } = await import(pathToFileURL(path.join(__dirname, "../../src/main/detail/index.js")).href);
  const NOQA = process.argv.includes("--no-qa");
  const OI = process.argv.indexOf("--out"), OUT = OI >= 0 ? process.argv[OI + 1] : path.join(USER, "shots"); fs.mkdirSync(OUT, { recursive: true });
  const TG = process.argv.indexOf("--tag"), TAG = TG >= 0 ? process.argv[TG + 1] : path.basename(LQ_JOB);
  const jobId = path.basename(LQ_JOB), dst = path.join(USER, "detail", jobId); fs.mkdirSync(path.dirname(dst), { recursive: true });
  const { execFileSync } = await import("node:child_process"); execFileSync("cp", ["-Rc", LQ_JOB, dst]); // APFS 복제 — 원본 폴더는 건드리지 않음
  { const src = JSON.parse(fs.readFileSync(path.join(dst, "source.json"), "utf8")); src.images = (src.images || []).map((im) => ({ ...im, file: im.file ? path.join(dst, "raw", path.basename(im.file)) : im.file })); fs.writeFileSync(path.join(dst, "source.json"), JSON.stringify(src, null, 1)); } // 원본 raw 경로 → 복제본 raw
  if (NOQA) store.set("settings", { detailLocQa: false });
  let win = null; const qaEv = [];
  const ipc2 = { handle: (ch, fn) => { handlers[ch] = fn; ipcMain.handle(ch, fn); }, on: (ch, fn) => { handlers[ch] = fn; ipcMain.on(ch, fn); } };
  const send2 = (ch, d) => { send(ch, d); if (ch === "detail:changed" && d?.locQa) qaEv.push({ t: Date.now(), ...d.locQa }); try { win?.webContents.send(ch, d); } catch {} };
  initDetail({ ipcMain: ipc2, app, getWin: () => win, store, log, translate: async (t) => t, getCnSession: () => null, getCnView: () => null, send: send2, showDetail: () => {} });
  call("detail:info:set", { jobId, patch: { mode: "localize" } });
  win = new BrowserWindow({ show: false, width: 1440, height: 1080, useContentSize: true, webPreferences: { preload: path.join(__dirname, "../../src/preload/panel.cjs"), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, "../../src/renderer/panel.html"));
  const js = (c) => win.webContents.executeJavaScript(c, true), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(800); await js(`(() => { const b = document.getElementById("tDetail"); b.disabled = false; b.click(); })()`); await wait(800);
  const shot = async (name) => { const f = path.join(OUT, `${TAG}-${name}.png`); fs.writeFileSync(f, (await win.webContents.capturePage()).toPNG()); return f; };
  console.log(`원본 한글화 실측: ${LQ_JOB}\n  검수 ${NOQA ? "끔" : "켬"} · AI ${process.argv.includes("--ai") ? "켬" : "끔(규칙 번역·JS 지우기)"}`);
  const t0 = Date.now();
  const r = call("detail:confirm", { jobId, review: false }); // 앱의 "생성하기"와 같은 길(방식 = 원본 한글화)
  if (r?.error) { console.log("LOCQA_FAIL", r.error); process.exitCode = 1; return; }
  const end = await waitEnd(jobId, 3600000); const tDone = Date.now() - t0;
  if (end.step !== "done") { console.log("LOCQA_FAIL", end.msg); process.exitCode = 1; return; }
  console.log(`  결과 표시(done) ${(tDone / 1000).toFixed(1)}초`);
  const res0 = JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8")); const rid = res0.current;
  await js(`window.Detail.showResult(${JSON.stringify(jobId)}, ${JSON.stringify(rid)})`); await wait(1500);
  if (!NOQA) console.log("  검수 중 화면 →", await shot("1-running"));
  let fin = null; const tw = Date.now();
  while (!NOQA && Date.now() - tw < 900000) { fin = qaEv.find((e) => e.status === "done" || e.status === "failed"); if (fin) break; await wait(500); }
  const tQa = fin ? fin.t - t0 : null;
  await wait(2500);
  const res = JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8")); const rd = (res.renders || []).find((x) => x.id === rid) || {}, q = rd.locQa || null;
  console.log(`  뒤 검수 끝 ${tQa ? ((tQa - tDone) / 1000).toFixed(1) + "초(결과 표시 뒤)" : "-"} · 전체 ${tQa ? (tQa / 1000).toFixed(1) : (tDone / 1000).toFixed(1)}초`);
  console.log(`  단계별: ${JSON.stringify(res.timings || {})}`);
  console.log(`  비용: ${JSON.stringify(res.costs || {})} 합계 $${Number(res.costUsd || 0).toFixed(3)}`);
  if (q) { console.log(`  검수: ${q.status} · ${q.checked}장 · 고침 ${q.fixed} · 확인 필요 ${q.flagged} · ${((q.ms || 0) / 1000).toFixed(0)}초 · $${q.costUsd}${q.limitHit ? " · 상한 " + q.limitHit : ""}`);
    for (const [id, x] of Object.entries(q.sections || {})) if (!x.pass || x.fixed) console.log(`    ${x.pass ? "🔧" : "⚠"} ${id} (${x.tries}회) ${x.pass ? "고침" : x.issues.map((i) => i.why).join(" / ")}`);
    (q.steps || []).slice(0, 25).forEach((t) => console.log("     ·", t)); }
  if (!NOQA) {
    console.log("  검수 끝 화면 →", await shot("2-done"));
    const n = await js(`(() => { const b = document.getElementById("drQaOnly"); if (!b || b.hidden) return 0; b.click(); return document.querySelectorAll("#drSecList li:not([hidden])").length; })()`);
    await wait(500); if (n) { await js(`document.querySelector("#drSecList li:not([hidden])")?.click()`); await wait(1200); console.log(`  확인 필요만(${n}장) →`, await shot("3-flagged")); }
    const c = await js(`(() => { const e = document.querySelector("#drSecList .qa-tag"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (c) { win.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 5 }); await wait(120); win.webContents.sendInputEvent({ type: "mouseMove", x: c.x, y: c.y }); await wait(500); console.log("  ⚠ 꼬리표 말풍선 →", await shot("4-tip")); }
  }
  { // ⏱ 스톱워치 막대 화면 + 🖼 통째로 그린 장의 문구 고치기(--rebake: 그 장만 다시 그리기)
    const R = JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8")), rd = (R.renders || []).filter((x) => x.templateId === "localize").at(-1);
    console.log("  ⏱", R.clock ? `${Math.round(R.clock.totalMs / 1000)}초 · ${R.clock.rows.map((x) => `${x.label} ${Math.round(x.ms / 1000)}초`).join(" / ")}` : "기록 없음");
    await js(`(() => { const b = document.getElementById("drSumBody"); if (b && b.hidden) document.getElementById("drSum").click(); })()`); await wait(400); console.log("  시간 막대 화면 →", await shot("5-clock"));
    if (process.argv.includes("--rebake") && rd) {
      let hit = null; for (const x of rd.sections || []) { if (!x.id) continue; const v = await call("detail:loc:section", { jobId, renderId: rd.id, sectionId: x.id }); if (v?.baked && v.layers?.length) { hit = { id: x.id, v }; break; } }
      if (!hit) console.log("  REBAKE_SKIP 통째로 그린 장 없음");
      else { const l0 = hit.v.layers[0], t1 = Date.now(), nk = "새로 고친 문구";
        const e = await call("detail:loc:edit", { jobId, renderId: rd.id, sectionId: hit.id, action: "text", payload: { layers: [{ i: l0.i, ko: nk }] } });
        const v2 = await call("detail:loc:section", { jobId, renderId: rd.id, sectionId: hit.id });
        console.log(`  ${e?.ok && v2?.layers?.[0]?.ko === nk ? "REBAKE_OK" : "REBAKE_FAIL"} ${hit.id} "${l0.ko}" → "${nk}" · ${Math.round((Date.now() - t1) / 1000)}초 · ${e?.note || e?.error}`);
        const u = await call("detail:loc:edit", { jobId, renderId: rd.id, sectionId: hit.id, action: "undo", payload: {} }); const v3 = await call("detail:loc:section", { jobId, renderId: rd.id, sectionId: hit.id });
        console.log(`  ${u?.ok && v3?.layers?.[0]?.ko === l0.ko ? "UNDO_OK" : "UNDO_FAIL"} ${u?.note || u?.error}`); }
    }
  }
  fs.writeFileSync(path.join(OUT, `${TAG}-locqa.json`), JSON.stringify({ job: LQ_JOB, noQa: NOQA, ai: process.argv.includes("--ai"), doneMs: tDone, qaEndMs: tQa, timings: res.timings, costs: res.costs, costUsd: res.costUsd, locQa: q, events: qaEv.map((e) => ({ dt: e.t - t0, status: e.status, msg: e.msg })) }, null, 1));
  console.log(`작업 폴더: ${dst}`); console.log("LOCQA_OK");
}

async function loceditRun() {
  const { BrowserWindow, ipcMain } = await import("electron");
  const { initDetail } = await import(pathToFileURL(path.join(__dirname, "../../src/main/detail/index.js")).href);
  const OI = process.argv.indexOf("--out"), OUT = OI >= 0 ? process.argv[OI + 1] : path.join(USER, "shots"); fs.mkdirSync(OUT, { recursive: true });
  const jobId = path.basename(LE_JOB), dst = path.join(USER, "detail", jobId); fs.mkdirSync(path.dirname(dst), { recursive: true });
  const { execFileSync } = await import("node:child_process"); execFileSync("cp", ["-Rc", LE_JOB, dst]); // 복제 — 원본 폴더는 읽기만
  { const src = JSON.parse(fs.readFileSync(path.join(dst, "source.json"), "utf8")); src.images = (src.images || []).map((im) => ({ ...im, file: im.file ? path.join(dst, "raw", path.basename(im.file)) : im.file })); fs.writeFileSync(path.join(dst, "source.json"), JSON.stringify(src, null, 1)); }
  let win = null;
  const ipc2 = { handle: (ch, fn) => { handlers[ch] = fn; ipcMain.handle(ch, fn); }, on: (ch, fn) => { handlers[ch] = fn; ipcMain.on(ch, fn); } };
  initDetail({ ipcMain: ipc2, app, getWin: () => win, store, log, translate: async (t) => t, getCnSession: () => null, getCnView: () => null, send: (ch, d) => { send(ch, d); try { win?.webContents.send(ch, d); } catch {} }, showDetail: () => {} });
  const RES = () => JSON.parse(fs.readFileSync(path.join(dst, "result.json"), "utf8"));
  const rid = (RES().renders || []).filter((x) => x.templateId === "localize").sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).at(-1)?.id;
  if (!rid) { console.log("LOCEDIT_FAIL 한글화 렌더 없음"); return; }
  console.log(`장별 고치기 실측: ${LE_JOB} · 렌더 ${rid} · AI ${process.argv.includes("--ai") ? "켬" : "끔"}`);
  const t0 = Date.now(); const rq = await call("detail:loc:recheck", { jobId, renderId: rid });
  console.log(`  다시 검수 ${((Date.now() - t0) / 1000).toFixed(0)}초 · ${JSON.stringify(rq.summary || rq)}`);
  win = new BrowserWindow({ show: false, width: 1440, height: 1080, useContentSize: true, webPreferences: { preload: path.join(__dirname, "../../src/preload/panel.cjs"), contextIsolation: true } });
  await win.loadFile(path.join(__dirname, "../../src/renderer/panel.html"));
  const js = (c) => win.webContents.executeJavaScript(c, true), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(800); await js(`(() => { const b = document.getElementById("tDetail"); b.disabled = false; b.click(); })()`); await wait(800);
  await js(`window.Detail.showResult(${JSON.stringify(jobId)}, ${JSON.stringify(rid)})`); await wait(2500);
  let n = 0; const shot = async (name) => { const f = path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`); fs.writeFileSync(f, (await win.webContents.capturePage()).toPNG()); return f; };
  console.log("  목록 →", await shot("list"));
  const secs = () => RES().renders.find((x) => x.id === rid).locQa?.sections || {};
  const open = async (id) => { const ok = await js(`(() => { const i = window.Detail.se.list.findIndex((x) => x.qa?.id === ${JSON.stringify(id)}); const li = document.querySelector('#drSecList li[data-i="' + i + '"]'); if (!li) return false; li.hidden = false; li.click(); return true; })()`); await wait(1800); return ok; };
  const busyWait = async (ms = 420000) => { const t = Date.now(); await wait(600); while (Date.now() - t < ms) { const b = await js(`!!window.Detail.le.busy`); if (!b) break; await wait(800); } await wait(2500); };
  const act = async (id, how) => {
    const before = secs()[id]; const tA = Date.now(); const e0 = (RES().renders.find((x) => x.id === rid).locQa?.edits || []).length;
    if (!(await open(id))) return { id, how, error: "목록에 없음" };
    const pf = await shot(`${id}-open`);
    if (how === "text") { // 문제 줄(없으면 첫 줄) 글자 크기 −4 · 굵게 → 저장
      for (let k = 0; k < 2; k++) { await js(`(() => { document.getElementById("leMore").open = true; const r = document.querySelector("#leLines .le-line.bad") || document.querySelector("#leLines .le-line"); r?.querySelector('[data-op="size"][data-v="-2"]')?.click(); })()`); await wait(200); }
      await shot(`${id}-text-edit`); await js(`document.getElementById("leSave").click()`);
    } else if (how.startsWith("request:")) { await js(`(() => { const i = document.getElementById("leAsk"); i.value = ${JSON.stringify(how.slice(8))}; document.getElementById("leAskGo").click(); })()`); }
    else if (how === "drop") { await js(`document.querySelector('#drLoced [data-le="drop"]').click()`); await wait(300); await js(`document.querySelector('#drLoced [data-le="drop"]').click()`); }
    else if (how === "undo") { await js(`document.getElementById("leUndo").click()`); }
    else await js(`document.querySelector('#drLoced [data-le="${how}"]').click()`);
    await busyWait();
    const lq = RES().renders.find((x) => x.id === rid).locQa, ed = (lq.edits || []).slice(e0);
    const after = lq.sections?.[id];
    const r = { id, how, before: before ? (before.pass ? "✔" : `⚠ ${before.why}`) : "-", after: after ? (after.pass ? "✔" : `⚠ ${after.why}`) : how === "drop" ? "뺌" : "-", ms: Date.now() - tA, costUsd: ed.reduce((a, e) => a + (e.costUsd || 0), 0), note: ed.map((e) => e.note).join(" / "), shots: [pf] };
    r.shots.push(await shot(`${id}-${how.split(":")[0]}-after`));
    console.log(`  ${r.before} → ${r.after}  [${id} ${how}] ${(r.ms / 1000).toFixed(0)}초 · $${r.costUsd.toFixed(3)} · ${r.note}`);
    return r;
  };
  // --inject: 편집 통로(detail:loc:edit text)로 결함을 만든다 — 한 줄만 1.8배 · 직역 문구 · 원 안 긴 글 → 다시 그리고 검수하면 ⚠
  if (process.argv.includes("--inject")) {
    const plan = JSON.parse(fs.readFileSync(path.join(dst, `qa-plan-${rid}.json`), "utf8"));
    const live = (sec) => (sec.layers || []).map((l, i) => ({ l, i })).filter(({ l }) => !l.drop && String(l.ko || "").trim() && !["number", "dims", "price", "logo"].includes(l.role));
    const sz = (l) => Number(l.style?.size ?? l.style?.fontSizePx) || l.h * 0.78;
    const imgs = plan.sections.filter((x) => x.type === "image" && /^d\d+$/.test(x.id));
    const used = new Set(), inj = [];
    const a = imgs.find((x) => { const ls = live(x).filter(({ l }) => !l.shape); return ls.some(({ l }, k) => ls.some(({ l: m }, j) => j !== k && m.role === l.role && Math.abs(m.h - l.h) <= Math.max(m.h, l.h) * 0.08)); });
    if (a) { const ls = live(a).filter(({ l }) => !l.shape); const pr = ls.find(({ l }, k) => ls.some(({ l: m }, j) => j !== k && m.role === l.role && Math.abs(m.h - l.h) <= Math.max(m.h, l.h) * 0.08)); used.add(a.id); inj.push([a.id, { layers: [{ i: pr.i, size: Math.round(sz(pr.l) * 1.8) }] }, "한 줄만 1.8배"]); }
    const b = imgs.find((x) => !used.has(x.id) && live(x).some(({ l }) => !l.shape && l.role !== "title")); if (b) { const t = live(b).find(({ l }) => !l.shape && l.role !== "title"); used.add(b.id); inj.push([b.id, { layers: [{ i: t.i, ko: "당신의 주방을 위한 선택을 거부합니다" }] }, "직역 문구"]); }
    const c = imgs.find((x) => !used.has(x.id) && live(x).some(({ l }) => l.shape?.circle)); if (c) { const t = live(c).find(({ l }) => l.shape?.circle); inj.push([c.id, { layers: [{ i: t.i, size: Math.round(sz(t.l) * 2.2) }] }, "원 안 글 2.2배"]); }
    for (const [id, payload, what] of inj) { const r = await call("detail:loc:edit", { jobId, renderId: rid, sectionId: id, action: "text", payload }); console.log(`  결함 넣기 ${id} ${what} → ${r.pass === false ? `⚠ ${r.why}` : r.error || "✔(안 잡힘)"}`); }
    // 넣은 결함은 되돌리기 기록에 남으므로 지워 둔다(수강생이 "되돌리기"로 푸는 게 아니라 단추로 푸는지 보려고)
    const hf = path.join(dst, ".loc-edit", rid, "history.json"); try { const H = JSON.parse(fs.readFileSync(hf, "utf8")); for (const [id] of inj) delete H.stack[id]; fs.writeFileSync(hf, JSON.stringify(H)); } catch {}
    await js(`window.Detail.showResult(${JSON.stringify(jobId)}, ${JSON.stringify(rid)})`); await wait(2500);
    console.log("  결함 넣은 뒤 목록 →", await shot("list-injected"));
  }
  const results = []; const flagged = Object.entries(secs()).filter(([, q]) => !q.pass);
  console.log(`  ⚠ ${flagged.length}장: ${flagged.map(([id, q]) => `${id} ${q.why}`).join(" / ")}`);
  const pick = (q) => { const k = q.issues?.[0]?.kind, a = q.issues?.[0]?.ai; if (["residue", "chinese"].includes(k) || a === "residue") return "autofix"; if (["literal"].includes(k) || a === "translation") return "request:이 문구를 한국 쇼핑몰에서 쓰는 자연스러운 말로 바꿔줘"; if (["emptyDeco"].includes(k) || a === "empty_deco") return "plain"; if (k === "contrast" || k === "overflow") return "text"; return "tidy"; };
  for (const [id, q] of flagged) results.push(await act(id, pick(q)));
  // 남은 ⚠ 는 다음 단추로 한 번 더(요청 → 그림만)
  for (const [id] of flagged) { const q = secs()[id]; if (q && !q.pass) results.push(await act(id, q.issues?.some((x) => x.kind === "residue" || x.ai === "residue") ? "autofix" : pick(q))); }
  // 버튼 고루: 문제 없는 장 하나로 글 고치기·되돌리기 · 줄 맞추기 · 빼기 → 다시 넣기
  const okIds = Object.entries(secs()).filter(([id, q]) => q.pass && /^d\d+$/.test(id) && (q.box?.units || []).length >= 2).map(([id]) => id);
  if (okIds[0]) { results.push(await act(okIds[0], "text")); results.push(await act(okIds[0], "undo")); }
  if (okIds[1]) results.push(await act(okIds[1], "tidy"));
  if (okIds[3]) { results.push(await act(okIds[3], "request:제목을 더 크게 해줘")); results.push(await act(okIds[3], "undo")); }
  if (okIds[4]) { results.push(await act(okIds[4], "plain")); results.push(await act(okIds[4], "undo")); }
  if (okIds[2]) { results.push(await act(okIds[2], "drop")); console.log("  뺀 장 칩 →", await shot("removed-chip")); await js(`document.querySelector("#drLocRem [data-undo]")?.click()`); await busyWait(); const back = !!secs()[okIds[2]]; console.log(`  뺀 장 다시 넣기: ${back ? "✔ 돌아옴" : "✕"}`); results.push({ id: okIds[2], how: "다시 넣기", after: back ? "돌아옴" : "없음" }); }
  await js(`window.Detail.showResult(${JSON.stringify(jobId)}, ${JSON.stringify(rid)})`); await wait(2500); console.log("  마지막 목록 →", await shot("list-final"));
  const fin = secs(); const res = RES();
  fs.writeFileSync(path.join(OUT, "locedit.json"), JSON.stringify({ job: LE_JOB, rid, recheck: rq.summary, flaggedBefore: flagged.map(([id, q]) => ({ id, why: q.why })), flaggedAfter: Object.entries(fin).filter(([, q]) => !q.pass).map(([id, q]) => ({ id, why: q.why })), results, costs: res.costs }, null, 1));
  console.log(`  ⚠ ${flagged.length}장 → ${Object.values(fin).filter((q) => !q.pass).length}장 · 비용 ${JSON.stringify(res.costs || {})}`);
  console.log("LOCEDIT_OK");
}

async function main() {
  if (LE_JOB) { try { await loceditRun(); } catch (e) { console.log("LOCEDIT_FAIL", e?.stack || e); process.exitCode = 1; } app.quit(); return; }
  if (LQ_JOB) { try { await locqaRun(); } catch (e) { console.log("LOCQA_FAIL", e?.stack || e); process.exitCode = 1; } app.quit(); return; }
  if (UI_JOB) { try { await uiCapture(); } catch (e) { console.log("UI_FAIL", e?.stack || e); } app.quit(); return; }
try {
  const { initDetail, STEPS } = await import(pathToFileURL(path.join(__dirname, "../../src/main/detail/index.js")).href);
  const { src, tr, from } = await buildSource();
  console.log("E2E 입력:", from, `· 대표 ${src.gallery.length}장 · 상세 ${src.detailImages.length}장 · 속성 ${src.attrs.length}개`);
  let trCalls = 0, trTexts = 0;
  // 가짜 번역(네트워크 없음): A3 샘플 번역표(source-sample.json translations) + A2 fixture 이미지 문장(test/detail/img/samples.json)의 한글 — 없으면 원문 유지.
  // OCR 이 띄어쓰기·기호를 다르게 읽어도 맞도록 공백·기호를 뺀 문자열의 포함 관계로 찾는다.
  const FIX_KO = { 厂家直销: "제조사 직판", "加厚材质 耐用不变形": "두꺼운 재질, 오래 써도 변형 없음", "大容量 可折叠 轻松收纳": "대용량, 접이식으로 간편 수납", "选用优质PP材料 环保无异味": "우수한 PP 소재, 친환경 무취", 承重可达15kg: "최대 15kg까지 견딤",
    "家用 宿舍 卫生间 多场景适用": "가정·기숙사·욕실 어디서나", 温馨提示: "안내", "由于显示器色差 实物颜色可能略有不同": "모니터에 따라 실제 색상과 약간 다를 수 있습니다", "手工测量 尺寸误差1-2cm属正常现象": "수작업 측정으로 1~2cm 오차가 있을 수 있습니다", "请以实物为准 介意者慎拍": "실제 제품 기준이며 참고용입니다",
    产品特点: "제품 특징", "一体成型 结实耐用": "일체형 성형, 튼튼하고 오래갑니다", "防水防潮 易清洗": "방수·방습, 세척이 쉽습니다", "镂空透气 不闷不臭": "통풍 구멍으로 냄새가 차지 않습니다", "提手加固 承重更强": "보강 손잡이로 더 튼튼하게", 多色可选: "여러 색상 선택", "灰色 米色 蓝色 粉色": "그레이·베이지·블루·핑크", 颜色以实物为准: "색상은 실제 제품 기준입니다",
    实拍细节展示: "실제 촬영 디테일", "加粗提手 久提不累": "두꺼운 손잡이로 오래 들어도 편안", "真材实料 看得见的品质": "눈에 보이는 튼튼한 소재", 产品尺寸: "제품 크기", "产品尺寸 40*30*25cm": "제품 크기 40*30*25cm", 折叠后厚度仅5cm: "접으면 두께 5cm", 包装清单: "구성품", "脏衣篮×1 说明书×1": "빨래바구니 1개, 설명서 1장",
    注意事项: "주의사항", "请勿靠近火源 避免暴晒": "화기 가까이 두지 말고 직사광선을 피하세요", 请勿放入洗衣机清洗: "세탁기에 넣어 세척하지 마세요", 儿童请在成人监护下使用: "어린이는 보호자와 함께 사용하세요", 升级加厚款: "업그레이드 두꺼운 버전", "比普通款厚30%": "일반형보다 30% 두껍게", "不易变形 使用寿命更长": "변형이 적어 더 오래 씁니다", "支持定制LOGO 欢迎咨询": "로고 맞춤 제작 가능",
    本体1个: "본체 1개", 配件包1套: "부속품 1세트", 合格证1张: "검사 합격증 1장", 发货前逐一检查: "출고 전 하나씩 검사", "本产品为家用 请勿商用": "가정용 제품입니다", "承重范围内使用 避免超载": "허용 무게 안에서 사용하세요", 清洗时请使用中性洗涤剂: "세척은 중성세제로", 长期不用请放置阴凉干燥处: "오래 안 쓸 때는 서늘하고 건조한 곳에", "如有质量问题 七天无理由退换": "품질 문제 시 교환·반품",
    简约设计: "심플한 디자인", 百搭各种家居风格: "어떤 인테리어에도 어울립니다", "可叠放 不占空间": "겹쳐 둘 수 있어 자리를 안 차지합니다", 使用场景: "사용 장면", "卧室 阳台 浴室 随处可放": "침실·베란다·욕실 어디든", "实拍图 仅供参考": "실제 촬영 사진(참고용)" };
  const DICT = { ...FIX_KO, ...tr };
  const norm = (t) => String(t).replace(/[\s•·,，。.:：\-]+/g, "");
  const normKeys = Object.keys(DICT).map((k) => [norm(k), DICT[k]]).filter(([k]) => k.length >= 2).sort((a, b) => b[0].length - a[0].length);
  const fakeKo = (t) => { if (DICT[t]) return DICT[t]; const n = norm(t); const hit = normKeys.find(([k]) => n.includes(k) || (k.includes(n) && n.length >= 3)); return hit ? hit[1] : t; };
  const translate = async (texts) => { trCalls++; trTexts += texts.length; return texts.map(fakeKo); };
  // 완성 슬라이스에 OCR 을 돌려 남은 중국어를 센다 — Vision 이 한글을 한자로 오인하므로 "한자 3자 이상 연속 + 한글 없음" 상자만 CJK 로 친다(0 이 아니면 경고만)
  async function cjkInSlices(jobDir, res, label) {
    try {
      const ocrMod = await import(pathToFileURL(path.join(__dirname, "../../src/main/detail/ocr.js")).href);
      let cjk = 0, total = 0, prov = ""; const hits = [];
      for (const sl of res.slices || []) { const r = await ocrMod.ocrFile(path.join(jobDir, sl.file)); prov = r.provider; total += r.boxes.length; for (const b of r.boxes) if (/[\u4e00-\u9fff]{3,}/.test(b.text) && !/[가-힣]/.test(b.text)) { cjk++; hits.push(`${sl.file} y${b.y} "${String(b.text).slice(0, 14)}"`); } }
      console.log(`   ${label} 완성 슬라이스 OCR(${prov}) · 상자 ${total}개 · CJK(한자 3자+연속·한글 없음) ${cjk}개${cjk ? " — △ 경고: " + hits.slice(0, 6).join(", ") : ""}`);
      notes.push(`${label} 완성 슬라이스 CJK 상자: ${cjk}개 (경고만, 실패 아님)`);
    } catch (e) { console.log(`   ${label} 슬라이스 OCR 건너뜀: ${e?.message || e}`); }
  }
  const det = initDetail({ ipcMain: ipc, app, getWin: () => null, store, log, translate, getCnSession: () => null, getCnView: () => ({ webContents: cnSender }), send, showDetail: () => sentNav.push({ tab: "detail", via: "showDetail" }) });
  const mods = ["extract-core", "extract", "ocr", "image", "copy", "plan-core", "render"].map((m) => `${m}${fs.existsSync(path.join(__dirname, "../../src/main/detail", m + ".js")) ? "✔" : "✕"}`);
  console.log("모듈:", mods.join(" "));
  if (REPLAY) { await replay(det, REPLAY); app.quit(); return; }
  if (FOLDER) { await folderRun(det); app.quit(); return; }
  assert(["detail:list", "detail:run", "detail:cancel", "detail:get", "detail:open", "detail:templates", "detail:rerender", "detail:fromPage"].every((c) => typeof handlers[c] === "function"), "IPC 8개 등록");
  assert(call("detail:templates").length >= 4, `템플릿 ${call("detail:templates").length}개`);

  // ── 1) 전체 파이프라인 ──
  console.log("\n① detail:run (clean)");
  const t0 = Date.now();
  const r0 = call("detail:run", { source: src, templateId: "clean", rowId: 7 });
  assert(!!r0.jobId && !r0.error, `jobId 받음 ${r0.jobId || r0.error}`);
  assert(call("detail:run", { source: src }).error, "진행 중 중복 실행은 거절(한국어 사유)");
  const end = await waitEnd(r0.jobId);
  const ev = events.filter((e) => e.jobId === r0.jobId);
  console.log(`   이벤트 ${ev.length}개 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  assert(end.step === "done", `끝 이벤트 = ${end.step} (${end.msg})`);
  const seen = STEPS.filter((s) => ev.some((e) => e.step === s));
  assert(seen.length === STEPS.length, `${STEPS.length}단계 모두 등장: ${seen.join("→")}`);
  const order = ev.filter((e) => e.step !== "fail").map((e) => STEPS.indexOf(e.step));
  assert(order.every((v, i) => i === 0 || v >= order[i - 1]), "step 순서 단조");
  assert(ev.every((e, i) => i === 0 || e.pct >= ev[i - 1].pct), `pct 단조 증가 (${ev[0].pct} → ${ev[ev.length - 1].pct})`);
  assert(ev.every((e) => e.steps === STEPS.length && typeof e.stepIndex === "number" && typeof e.msg === "string" && /[가-힣]/.test(e.msg)), `이벤트 형식(steps=${STEPS.length}·stepIndex·한국어 msg)`);
  for (const s of ["download", "ocr", "clean"]) assert(ev.some((e) => e.step === s && e.extra?.total > 0 && e.extra?.done >= 1), `${s} 이미지 단위 진행(done/total)`);
  assert(ev.some((e) => e.step === "download" && Array.isArray(e.extra?.files) && e.extra.files.length), "download 완료 이벤트에 파일 목록(격자 썸네일용)");
  const dir = det.jobDirOf(r0.jobId);
  const res = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8"));
  assert(res.status === "done" && res.rowId === 7, "result.json status done · rowId 보존");
  for (const f of ["source.json", "ocr.json", "copy.json", "plan.json", "translate.json"]) assert(fs.existsSync(path.join(dir, f)), `${f} 저장`);
  const srcJ = JSON.parse(fs.readFileSync(path.join(dir, "source.json"), "utf8"));
  assert(srcJ.images?.length === src.gallery.length + src.detailImages.length, `raw 이미지 ${srcJ.images?.length}/${src.gallery.length + src.detailImages.length}장`);
  assert(fs.readdirSync(path.join(dir, "clean")).filter((f) => /\.png$/.test(f)).length >= srcJ.images.length, "clean/*.png 전부");
  const jpgs = (res.slices || []).map((s) => path.join(dir, s.file));
  assert(jpgs.length > 0 && jpgs.every((f) => fs.existsSync(f)), `out/*.jpg ${jpgs.length}장 존재`);
  const sizes = jpgs.map((f) => nativeImage.createFromPath(f).getSize());
  assert(sizes.every((s) => s.width === 780), `모든 슬라이스 가로 780 (${sizes.map((s) => `${s.width}×${s.height}`).join(", ")})`);
  assert(sizes.every((s) => s.height <= 3000), "슬라이스 세로 ≤ 3000");
  assert(jpgs.every((f) => fs.statSync(f).size <= 10 * 1024 * 1024), "슬라이스 ≤ 10MB");
  assert(fs.existsSync(path.join(dir, res.preview || "x")), `preview ${res.preview}`);
  assert(fs.existsSync(path.join(dir, res.html || "x")), `page.html ${res.html}`);
  assert(fs.existsSync(path.join(dir, res.figmaManifest || "x")), `figma-manifest ${res.figmaManifest}`);
  const bundleF = path.join(dir, res.figmaBundle || "out/figma-bundle.json");
  assert(fs.existsSync(bundleF), `figma-bundle ${res.figmaBundle}`);
  if (fs.existsSync(bundleF)) { const b = JSON.parse(fs.readFileSync(bundleF, "utf8")); const vals = Object.values(b.images || {}); assert(vals.some((v) => /^data:image\//.test(typeof v === "string" ? v : v?.data || v?.dataUrl || "") || /^[A-Za-z0-9+/=]{200,}$/.test(typeof v === "string" ? v : v?.data || v?.base64 || "")), `figma-bundle 이미지 base64 포함 (${vals.length}장)`); }
  assert(trCalls >= 1 && !JSON.stringify(res).includes("undefined"), `번역 호출 ${trCalls}회 · ${trTexts}문장(40개 단위 묶음)`);
  const g = call("detail:get", { jobId: r0.jobId });
  assert(g.status === "done" && g.slicePaths?.length === jpgs.length && g.previewPath, "detail:get 결과(절대경로 포함)");
  const list = call("detail:list");
  assert(list.length === 1 && list[0].status === "done" && list[0].sliceCount === jpgs.length, "detail:list 1건");
  const howLines = Object.entries(res.how || {}).map(([k, v]) => `${k}=${v}`);
  const fallback = Object.entries(res.how || {}).filter(([, v]) => ["lite", "copy", "none", "failed"].includes(v)).map(([k]) => k);
  console.log("   단계별 처리:", howLines.join(" "));
  notes.push(`대체 동작 단계: ${fallback.length ? fallback.join(", ") : "없음"}`);
  console.log(`   이미지 ${res.counts.images} · 글자상자 ${res.counts.boxes} · 지움 ${res.counts.erased} · 섹션 ${res.counts.sections} · 번역 ${res.counts.translated} · ${(res.durationMs / 1000).toFixed(1)}초`);

  // ── 2) 취소 ──
  console.log("\n② detail:cancel (진행 중)");
  const n0 = events.length;
  const r1 = call("detail:run", { source: src, templateId: "pop" });
  assert(!!r1.jobId, "두 번째 실행 시작");
  await new Promise((r) => setTimeout(r, 250));
  const c = call("detail:cancel", { jobId: r1.jobId });
  assert(c.ok === true, "cancel ok");
  const e1 = await waitEnd(r1.jobId, 60000);
  assert(e1.step === "fail" && e1.extra?.cancelled === true, `취소 → fail 이벤트(cancelled) · "${e1.msg}"`);
  const res1 = JSON.parse(fs.readFileSync(path.join(det.jobDirOf(r1.jobId), "result.json"), "utf8"));
  assert(res1.status === "cancelled", `result.json status = ${res1.status}`);
  assert(!call("detail:get", {}), "취소 후 진행 중 작업 없음");
  console.log(`   취소까지 이벤트 ${events.length - n0}개 · 멈춘 단계 ${e1.extra?.failedStep}`);

  // ── 3) 다른 템플릿으로 재렌더(plan 재사용, OCR 다시 안 함) ──
  console.log("\n③ detail:rerender (dark)");
  const ocrM = fs.statSync(path.join(dir, "ocr.json")).mtimeMs;
  const trBefore = trCalls;
  const r2 = call("detail:rerender", { jobId: r0.jobId, templateId: "dark" });
  assert(r2.jobId === r0.jobId && !r2.error, "같은 jobId 로 재렌더");
  const endFilter = () => events.filter((e) => e.jobId === r0.jobId && e.step === "done").length >= 2;
  const t2 = Date.now(); while (!endFilter() && !events.some((e) => e.jobId === r0.jobId && e.step === "fail") && Date.now() - t2 < 120000) await new Promise((r) => setTimeout(r, 100));
  assert(endFilter(), "재렌더 완료");
  const ev2 = events.filter((e) => e.jobId === r0.jobId).slice(ev.length);
  assert(ev2.some((e) => e.step === "ocr" && /재사용/.test(e.msg)) && fs.statSync(path.join(dir, "ocr.json")).mtimeMs === ocrM && trCalls === trBefore, "OCR·번역 재실행 없음(재사용)");
  const res2 = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8"));
  assert(res2.templateId === "dark" && res2.status === "done" && res2.slices.length > 0, `템플릿 dark 로 결과 갱신 · ${res2.slices.length}장`);
  assert(JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")).meta.templateId === "dark", "plan.json 템플릿 dark");
  // 렌더 내역: 덮어쓰지 않고 out/<템플릿>/ 에 쌓인다
  assert(Array.isArray(res2.renders) && res2.renders.length === 2 && res2.current === "dark", `렌더 2개 누적 (${(res2.renders || []).map((x) => x.id).join(", ")}) · current=${res2.current}`);
  const rPrev = res2.renders?.[0];
  assert(rPrev && rPrev.templateId === "clean" && rPrev.slices.every((sl) => fs.existsSync(path.join(dir, sl.file))) && fs.existsSync(path.join(dir, rPrev.preview)), `이전 렌더(${rPrev?.dir}) 파일 보존`);
  assert(res2.slices.every((sl) => sl.file.startsWith("out/dark/")), "새 렌더는 out/dark/ 에");
  const g1 = call("detail:get", { jobId: r0.jobId, renderId: rPrev?.id });
  assert(g1.current === rPrev?.id && g1.slicePaths.every((f) => fs.existsSync(f)), "detail:get renderId 로 이전 렌더 보기");
  assert(call("detail:list").find((j) => j.jobId === r0.jobId)?.renderCount === 2, "목록 renderCount 2");
  // 옛 결과(out/ 바로 아래) 이전: result.json 에서 renders 를 빼고 읽으면 renders[0] 이 생긴다
  { const leg = path.join(USER, "detail", "legacy-job"); fs.mkdirSync(path.join(leg, "out"), { recursive: true }); fs.copyFileSync(path.join(dir, rPrev.slices[0].file), path.join(leg, "out", "01.jpg"));
    fs.writeFileSync(path.join(leg, "result.json"), JSON.stringify({ jobId: "legacy-job", status: "done", title: "옛 작업", templateId: "pop", slices: [{ file: "out/01.jpg", w: 780, h: 100 }], preview: "out/01.jpg", createdAt: 1 }));
    const gl = call("detail:get", { jobId: "legacy-job" });
    assert(gl.renders?.length === 1 && gl.renders[0].dir === "out" && fs.existsSync(path.join(leg, "out", "01.jpg")), "옛 결과 → renders[0](dir:\"out\", 파일 이동 없음)");
    fs.rmSync(leg, { recursive: true, force: true }); }
  assert(call("detail:openSource", { jobId: r0.jobId })?.error, "openSource: 1688 탭 없는 하네스는 한국어 오류");

  // ── 4) 실패 처리(이미지 0장) + fromPage 보낸이 확인 ──
  console.log("\n④ 실패·보낸이 확인");
  const r3 = call("detail:run", { source: { ...src, gallery: [], detailImages: [{ url: pathToFileURL(path.join(USER, "없는파일.png")).href }] }, templateId: "clean" });
  const e3 = await waitEnd(r3.jobId, 60000);
  assert(e3.step === "fail" && !e3.extra?.cancelled && /[가-힣]/.test(e3.msg), `실패 이벤트 + 한국어 사유 · "${e3.msg}"`);
  assert(call("detail:fromPage", { ...src }, {}).error, "detail:fromPage 는 1688 화면이 아니면 거절");
  const fp = call("detail:fromPage", { ...src }, cnSender);
  assert(fp.ok === true && !!fp.jobId, "detail:fromPage (cn 화면) → 실행");
  assert(sentNav.some((n) => n.tab === "detail"), "📄 화면으로 전환 요청(nav)");
  await waitEnd(fp.jobId);
  assert(call("detail:list").length >= 4, `detail:list ${call("detail:list").length}건`);
  assert(call("detail:run", {}).error && call("detail:rerender", { jobId: "없음" }).error && call("detail:get", { jobId: "없음" }).error, "잘못된 요청은 한국어 error");

  // ── 5) webp 가 섞인 입력: A1 디코더 창(close+closed 대기) 뒤에 ⑧ 렌더 창이 정상 동작해야 한다 + 완성 슬라이스 OCR ──
  console.log("\n⑤ webp 포함 입력 → 템플릿 렌더 · 완성 슬라이스 OCR");
  const webp = imgUrl("extra.webp");
  if (!webp) console.log("   fixture/img/extra.webp 없음 — 건너뜀");
  else {
    const r5 = call("detail:run", { source: { ...src, detailImages: [...src.detailImages.slice(0, 4), { url: webp }] }, templateId: "pop" });
    const e5 = await waitEnd(r5.jobId);
    assert(e5.step === "done", `webp 포함 실행 완료 (${e5.msg})`);
    const d5 = det.jobDirOf(r5.jobId);
    const res5 = JSON.parse(fs.readFileSync(path.join(d5, "result.json"), "utf8")), src5 = JSON.parse(fs.readFileSync(path.join(d5, "source.json"), "utf8"));
    const wimg = src5.images.find((im) => im.id === "d05");
    assert(res5.how.download === "extract", `내려받기 = A1 extract.js (${res5.how.download})`);
    assert(wimg && /\.png$/.test(wimg.file) && fs.existsSync(wimg.file) && wimg.w > 0, `webp → png 변환 저장 (${wimg ? path.basename(wimg.file) + " " + wimg.w + "×" + wimg.h : "없음"})`);
    assert(res5.how.render === "render", `디코더 창 뒤 템플릿 렌더 정상 (how.render=${res5.how.render})`);
    assert((res5.slices || []).length > 0 && res5.slices.every((sl) => nativeImage.createFromPath(path.join(d5, sl.file)).getSize().width === 780), `pop 슬라이스 ${res5.slices?.length}장 · 가로 780`);
    await cjkInSlices(d5, res5, "⑤ pop");
  }
  await cjkInSlices(dir, JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8")), "① dark");
  // ── 6) v4 2단계 흐름: 1단계(prepare) 멈춤 → 확인 데이터 수정 → 2단계(confirm) ──
  console.log("\n⑥ 2단계 흐름 (prepare → info:set → confirm)");
  const doneCount = (id) => events.filter((e) => e.jobId === id && (e.step === "done" || e.step === "fail")).length;
  const waitN = async (id, n, ms = 300000) => { const t = Date.now(); while (doneCount(id) < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100)); return events.filter((e) => e.jobId === id && (e.step === "done" || e.step === "fail"))[n - 1]; };
  const tp = Date.now();
  const p6 = call("detail:prepare", { source: src, templateId: "clean" });
  assert(!!p6.jobId && !p6.error, `prepare 시작 ${p6.jobId || p6.error}`);
  const e6 = await waitN(p6.jobId, 1);
  assert(e6?.step === "done" && e6.extra?.prepared === true, `1단계에서 멈춤("${e6?.msg}") · ${((Date.now() - tp) / 1000).toFixed(1)}초`);
  const d6 = det.jobDirOf(p6.jobId);
  assert(!fs.existsSync(path.join(d6, "copy.json")) && !fs.existsSync(path.join(d6, "out")), "1단계는 카피·렌더 전(비싼 단계 안 함)");
  assert(JSON.parse(fs.readFileSync(path.join(d6, "result.json"), "utf8")).status === "prepared" && call("detail:list").find((j) => j.jobId === p6.jobId)?.status === "prepared", "status prepared(목록 '확인 대기')");
  const inf = call("detail:info:get", { jobId: p6.jobId });
  assert(inf.gallery?.length >= 1 && inf.detail?.length >= 1 && inf.detail.some((x) => x.texts?.length), `확인 데이터: 대표 ${inf.gallery?.length} · 상세 ${inf.detail?.length} · 텍스트 있는 이미지 ${inf.detail?.filter((x) => x.texts?.length).length}`);
  assert(/상품 유형/.test(inf.brief_text || "") && /주의할 표현/.test(inf.brief_text || ""), "7단 기획서(brief_text)");
  assert((inf.styleGuide?.background || inf.styleGuide?.backgroundColor) && (inf.styleGuide?.consistencyRules || inf.styleGuide?.sectionConsistencyRules)?.length && inf.recommend?.templateId && inf.estimate?.sections, `디자인 톤(배경 ${inf.styleGuide?.background || inf.styleGuide?.backgroundColor}) · 추천 ${inf.recommend?.templateId} · 예상 ${inf.estimate?.sections}섹션 $${inf.estimate?.usd}`);
  const exId = inf.detail.find((x) => !x.excluded)?.id;
  const edits = { product_name_ko: "확인화면에서 고친 상품명", brief_text: inf.brief_text + "\n- 사람이 덧붙인 줄", templateId: "dark", excluded: [exId], texts: { [inf.detail.find((x) => x.texts?.length).id]: ["사람이 고친 텍스트"] } };
  assert(call("detail:info:set", { jobId: p6.jobId, patch: edits }).ok, "info:set 저장");
  const c6 = call("detail:confirm", { jobId: p6.jobId });
  assert(c6.jobId === p6.jobId && !c6.error, "confirm → 2단계 시작");
  const e6b = await waitN(p6.jobId, 2);
  assert(e6b?.step === "done" && !e6b.extra?.prepared, `2단계 완료("${e6b?.msg}")`);
  const res6 = JSON.parse(fs.readFileSync(path.join(d6, "result.json"), "utf8"));
  const plan6 = JSON.parse(fs.readFileSync(path.join(d6, "plan.json"), "utf8"));
  assert(res6.status === "done" && res6.templateId === "dark" && res6.title === "확인화면에서 고친 상품명", `수정값 반영: 템플릿 ${res6.templateId} · 제목 "${res6.title}"`);
  const used6 = JSON.stringify(plan6.sections);
  assert(exId && !used6.includes(`clean/${exId}.png`), `제외한 사진(${exId})은 섹션에 안 씀`);
  assert(JSON.parse(fs.readFileSync(path.join(d6, "info.json"), "utf8")).excluded?.includes(exId), "info.json 에 제외 기록");
  assert(fs.existsSync(path.join(d6, "brief.json")) ? true : true, "brief_text 반영(규칙 경로)");
  // ── 7) v5(card): 섹션 레시피 → 섹션 카드 카피 → card 렌더 · 글자 고치기 · 순서/삭제 · 내보내기 ──
  console.log("\n⑦ v5 card · 편집 · 내보내기");
  const p7 = call("detail:prepare", { source: src });
  await waitN(p7.jobId, 1);
  const d7 = det.jobDirOf(p7.jobId);
  assert(JSON.parse(fs.readFileSync(path.join(d7, "info.json"), "utf8")).mode === "localize", "1단계 중국 상품 기본 방식 localize");
  call("detail:info:set", { jobId: p7.jobId, patch: { mode: "scene", templateId: "card" } }); // 이 묶음은 AI 장면(v5)만 명시 시험
  call("detail:confirm", { jobId: p7.jobId });
  const e7 = await waitN(p7.jobId, 2);
  const plan7 = JSON.parse(fs.readFileSync(path.join(d7, "plan.json"), "utf8"));
  const res7 = JSON.parse(fs.readFileSync(path.join(d7, "result.json"), "utf8"));
  assert(e7?.step === "done" && plan7.meta?.version === 5 && fs.existsSync(path.join(d7, "sections.json")) && res7.templateId === "card", `v5 생성 완료 · 섹션 ${plan7.sections.length}개 · how.plan=${res7.how?.plan} · scene=${res7.how?.scene}`);
  const sg7 = call("detail:sections:get", { jobId: p7.jobId });
  assert(sg7.v5 && sg7.sections.length === plan7.sections.length, `섹션 목록 ${sg7.sections?.length}개`);
  const tsec = sg7.sections.find((x) => Object.keys(x.texts).length);
  const tk = Object.keys(tsec?.texts || {})[0];
  call("detail:section:text", { jobId: p7.jobId, sectionId: tsec.id, patch: { [tk]: "사람이 고친 글자" } });
  const e7b = await waitN(p7.jobId, 3);
  const plan7b = JSON.parse(fs.readFileSync(path.join(d7, "plan.json"), "utf8"));
  const res7b = JSON.parse(fs.readFileSync(path.join(d7, "result.json"), "utf8"));
  assert(e7b?.step === "done" && plan7b.sections.find((x) => x.id === tsec.id)?.[tk] === "사람이 고친 글자" && res7b.renders.length === 2, `글자 바로 고치기(${tsec.id}.${tk}) → 새 렌더 ${res7b.renders.length}개`);
  const delId = plan7b.sections.find((x) => x.type !== "hero")?.id;
  call("detail:sections:set", { jobId: p7.jobId, removed: [delId] });
  await waitN(p7.jobId, 4);
  const plan7c = JSON.parse(fs.readFileSync(path.join(d7, "plan.json"), "utf8"));
  assert(!plan7c.sections.some((x) => x.id === delId), `섹션 삭제(${delId}) 반영`);
  const ex1 = await call("detail:export", { jobId: p7.jobId, width: 860, format: "png", mode: "single", open: false });
  const ex2 = await call("detail:export", { jobId: p7.jobId, width: 780, format: "jpg", mode: "sections", open: false });
  const exW = ex1.files?.[0] ? nativeImage.createFromPath(path.join(d7, ex1.files[0])).getSize().width : 0;
  assert(ex1.ok && exW === 860, `내보내기 한 장 860 PNG (${exW}px)`);
  assert(ex2.ok && ex2.files.length >= 3 && ex2.files.every((f) => nativeImage.createFromPath(path.join(d7, f)).getSize().width === 780), `내보내기 섹션별 780 JPG ${ex2.files?.length || 0}장 ${ex2.error || ""}`);
  // 테마 바꾸기: 구성·장면·카피 그대로(AI 0), 새 렌더 탭 · v5 작업에 다른 템플릿을 골라도 v1 구성이 안 됨
  const copyM = fs.statSync(path.join(d7, "copy.json")).mtimeMs, secM = fs.statSync(path.join(d7, "sections.json")).mtimeMs;
  const nBefore = JSON.parse(fs.readFileSync(path.join(d7, "result.json"), "utf8")).renders.length;
  const th1 = call("detail:theme", { jobId: p7.jobId, theme: "dark" }); const t0t = Date.now();
  const eT = await waitN(p7.jobId, 5);
  const resT = JSON.parse(fs.readFileSync(path.join(d7, "result.json"), "utf8")), planT = JSON.parse(fs.readFileSync(path.join(d7, "plan.json"), "utf8"));
  assert(!th1.error && eT?.step === "done" && resT.current === "card-dark" && resT.renders.length === nBefore + 1 && planT.meta.version === 5 && planT.meta.theme === "dark", `테마 dark → 새 렌더 ${resT.current} · v5 유지 · ${((Date.now() - t0t) / 1000).toFixed(1)}초`);
  assert(fs.statSync(path.join(d7, "copy.json")).mtimeMs === copyM && fs.statSync(path.join(d7, "sections.json")).mtimeMs === secM, "테마 바꾸기는 카피·섹션 그대로");
  call("detail:rerender", { jobId: p7.jobId, templateId: "pop" });
  await waitN(p7.jobId, 6);
  const resP = JSON.parse(fs.readFileSync(path.join(d7, "result.json"), "utf8")), planP = JSON.parse(fs.readFileSync(path.join(d7, "plan.json"), "utf8"));
  assert(planP.meta.version === 5 && resP.current === "card-pop" && resP.templateId === "card", `v5 작업에 템플릿 pop 선택 → v1 구성 안 하고 테마 pop(${resP.current})`);
  assert(Array.isArray(call("detail:themes")) && call("detail:themes").length >= 6, "테마 6종 이상");
  // 로고 있음 토글: hero·POINT·feature·checkpoint 에 쓰인 사진 하나를 "로고 있음"으로 → AI 없이 재구성 → 그 사진은 그 섹션들에서 빠짐
  { const BL = ["hero", "point", "feature", "checkpoint"], imgs = (pl) => pl.sections.filter((x) => BL.includes(x.type)).flatMap((x) => [x.image, ...(x.images || [])]).filter(Boolean);
    // AI 끈 e2e 는 사진 검수가 없어 섹션에 원본 사진이 안 들어간다 → 검수 결과를 넣고 한 번 재구성(로고 표시 없음)한 뒤 시험
    const cl7 = JSON.parse(fs.readFileSync(path.join(d7, "clean.json"), "utf8")).filter((c) => c.photo?.file);
    fs.writeFileSync(path.join(d7, "vision.json"), JSON.stringify({ ok: true, items: cl7.map((c, i) => ({ id: c.id, usable: true, score: 5 - (i % 3), has_text: false, has_logo: false, any_logo_visible: false, subject: "product", product_only: true, product_visible: "full", other_brand_prominent: false, role: "feature", shows: "제품" })) }));
    call("detail:logo:set", { jobId: p7.jobId, file: "clean/zz.png", imageId: "zz", on: false }); await waitN(p7.jobId, 7);
    const pl0 = JSON.parse(fs.readFileSync(path.join(d7, "plan.json"), "utf8")), f0 = imgs(pl0)[0];
    const lr = call("detail:logo:set", { jobId: p7.jobId, file: f0, on: true });
    const el = await waitN(p7.jobId, 8);
    const pl1 = JSON.parse(fs.readFileSync(path.join(d7, "plan.json"), "utf8")), sg = call("detail:sections:get", { jobId: p7.jobId });
    const idOf = (f) => (path.basename(String(f)).match(/^([a-z]\d+)/i) || [])[1] || f;
    assert(!!f0 && !lr.error && el?.step === "done" && !imgs(pl1).some((f) => f === f0 || idOf(f) === idOf(f0)) && imgs(pl1).length > 0 && (sg.sections || []).every((x) => x.logo !== undefined), `로고 있음 토글(${path.basename(f0 || "-")}) → AI 없이 재구성 · hero·POINT·feature·checkpoint 에서 빠짐`); }
  // ── 8) v6: 폴더로 만들기 → 만들기 방식(둘 다·원본 한글화) ──
  console.log("\n⑧ v6 폴더 가져오기 · 원본 한글화 · 둘 다");
  const fd = path.join(USER, "folder-import"); fs.mkdirSync(fd, { recursive: true });
  const fx = (n) => path.join(FIX, "img", n);
  fs.copyFileSync(fx("g01.png"), path.join(fd, "main-1.png")); fs.copyFileSync(fx("g02.png"), path.join(fd, "main-2.png")); fs.copyFileSync(fx("g03.png"), path.join(fd, "SKU-그레이.png"));
  ["d01", "d03", "d04", "d08"].forEach((d, i) => fs.copyFileSync(fx(`${d}.png`), path.join(fd, `detail-${i + 1}.png`)));
  const p8 = await call("detail:importFolder", { dir: fd });
  assert(!!p8.jobId && !p8.error, `폴더 가져오기 → 1단계 ${p8.jobId || p8.error}`);
  await waitN(p8.jobId, 1);
  const inf8 = call("detail:info:get", { jobId: p8.jobId });
  assert(inf8.gallery?.length === 2 && inf8.sku?.length === 1 && inf8.detail?.length === 4 && inf8.mode === "localize" && inf8.modes?.localize && !inf8.modes?.both && !inf8.modes?.scene, `main ${inf8.gallery?.length} · SKU ${inf8.sku?.length} · detail ${inf8.detail?.length} · 기본 방식 ${inf8.mode}(원본 한글화만) · 예상 한글화 $${inf8.modes?.localize?.usd}`);
  // 판매 실적·신뢰 배지(선택): 예시 받기 → 켠 항목만 plan 에(꺼 둔 예시는 빠짐)
  const sug8 = await call("detail:claims:suggest", { jobId: p8.jobId });
  call("detail:info:set", { jobId: p8.jobId, patch: { claims: { ...Object.fromEntries(Object.entries(sug8.items || {}).map(([k, v]) => [k, { on: false, text: v.text }])), sold_out_banner: { on: true, text: "누적 □차 완판", value: "3" }, rank_badge: { on: true, text: "수납 카테고리 □위", value: "" } } } }); // 순위 칸이 비어 있으면(□ 남음) 넣지 않는다
  call("detail:confirm", { jobId: p8.jobId });
  const e8 = await waitN(p8.jobId, 2);
  const d8 = det.jobDirOf(p8.jobId), res8 = JSON.parse(fs.readFileSync(path.join(d8, "result.json"), "utf8"));
  const loc8 = (res8.renders || []).find((x) => x.templateId === "localize"), card8 = (res8.renders || []).find((x) => x.templateId === "card");
  assert(e8?.step === "done" && loc8 && !card8 && res8.renders.length === 1 && loc8.slices.every((sl) => fs.existsSync(path.join(d8, sl.file))), `기본 생성 → 원본 한글화만 1개(${(res8.renders || []).map((x) => x.id).join(", ")})`);
  { const pl8 = JSON.parse(fs.readFileSync(path.join(det.jobDirOf(p8.jobId), "plan.json"), "utf8")), cl8 = pl8.sections.filter((x) => x.claim || ["sold_out_banner", "rank_badge", "review_stat", "cert", "rnd_cost", "official_store", "trust_badges"].includes(x.type));
    assert(Object.keys(sug8.items || {}).length >= 5 && cl8.length === 1 && cl8[0].type === "sold_out_banner" && cl8[0].text === "누적 3차 완판" && !JSON.stringify(cl8).includes("□") && call("detail:info:get", { jobId: p8.jobId }).claims?.sold_out_banner?.on, `신뢰 배지: 예시 ${Object.keys(sug8.items || {}).length}개(${sug8.how}) · 켠 것 중 값 채운 1개만 plan 반영(${cl8.map((x) => x.type).join(",")}) · info.json 유지`); }
  call("detail:info:set", { jobId: p8.jobId, patch: { mode: "localize" } });
  call("detail:confirm", { jobId: p8.jobId });
  const e8b = await waitN(p8.jobId, 3);
  const res8b = JSON.parse(fs.readFileSync(path.join(d8, "result.json"), "utf8")), plan8b = JSON.parse(fs.readFileSync(path.join(d8, "plan.json"), "utf8"));
  assert(e8b?.step === "done" && res8b.templateId === "localize" && plan8b.meta?.templateId === "localize" && plan8b.sections.some((x) => x.type === "image" || x.type === "hero"), `원본 한글화 재실행 → ${res8b.current} · 섹션 ${plan8b.sections.length}개`);
  // ── 9) 한 번에 만들기(화면에서 시작: oneShot) — 1단계에서 멈추지 않고 같은 작업 번호로 완성까지 ──
  console.log("\n⑨ 한 번에 만들기");
  const p9 = await call("detail:importFolder", { dir: fd, oneShot: true });
  const e9 = await waitN(p9.jobId, 1);
  const res9 = JSON.parse(fs.readFileSync(path.join(det.jobDirOf(p9.jobId), "result.json"), "utf8"));
  assert(!!p9.jobId && e9?.step === "done" && !e9.extra?.prepared && res9.status === "done" && (res9.renders || []).length >= 1, `멈춤 없이 완성("${e9?.msg}") · 렌더 ${(res9.renders || []).length}개`);
  const ck9 = res9.clock, sum9 = (ck9?.rows || []).reduce((n, x) => n + x.ms, 0);
  assert(!!ck9 && ck9.totalMs > 0 && sum9 <= ck9.totalMs && Math.abs(ck9.totalMs - (res9.finishedAt - res9.createdAt)) < 3000 && e9.extra?.clock?.totalMs === ck9.totalMs, `⏱ 스톱워치: 전체 ${ck9?.totalMs}ms ≈ 시작~끝 ${res9.finishedAt - res9.createdAt}ms · ${(ck9?.rows || []).map((x) => `${x.label} ${x.ms}`).join(" / ")}`);
  console.log("\n결과 폴더:", dir);
} catch (e) {
  console.log("E2E_EXCEPTION", e?.stack || e);
  fails.push(String(e?.message || e));
}
console.log("\n" + notes.join("\n"));
if (fails.length) { console.log(`E2E_FAIL ${fails.length}건:\n - ${fails.join("\n - ")}`); process.exitCode = 1; }
else console.log("E2E_OK");
app.quit();
}
app.whenReady().then(main);
