// 🧲 내 템플릿 흐름 하네스(실제 파이프라인) — 쿠팡 상품 화면(숨은 창) 🧲 저장 → 보관함 → 템플릿 선택 → 상세페이지 생성. 실행 중인 앱은 건드리지 않는다(임시 userData, 작업 폴더는 복사).
//   npx electron test/detail/template-flow.js "<작업 폴더>" <출력 폴더> --coupang=<쿠팡 상품 주소> | --search=<쿠팡 검색어> | --ref=<레퍼런스 이미지 폴더> [--keep-extra] [--no-generate]
//   → 보관함 template.json · .seedtpl.json 내보내기→가져오기 왕복 · 섹션 순서(레시피 대비) · 표절 가드 · 단계별 시간/비용 · <출력>/슬라이스·report.json · 마지막 줄 FLOW_OK
import { app, BrowserWindow, session } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const flag = (k) => argv.includes(`--${k}`);
const [jobSrc, outDir] = argv.filter((a) => !a.startsWith("--") && !/electron|template-flow\.js$/.test(a));
const USER = path.join(os.tmpdir(), "seedhack-template-flow");
fs.rmSync(USER, { recursive: true, force: true }); fs.mkdirSync(USER, { recursive: true });
app.setPath("userData", USER);
app.on("window-all-closed", () => {});
const handlers = {}, events = [], progress = [];
const ipc = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } };
const store = (() => { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; })();
const logs = [];
const log = (cls, text) => { logs.push(`[${cls}] ${text}`); if (/🧲|🧷|✍️|■|△|벤치마킹|템플릿/.test(text)) console.log(`   ${text}`); };
const send = (ch, d) => { if (ch === "detail:progress") events.push(d); };
const rd = (d, f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = {}; const lap = (k, t) => { T[k] = Date.now() - t; return T[k]; };

// 쿠팡 상품 화면을 숨은 창으로 열어 상세 이미지 주소·상품명·카테고리를 읽는다(coupang.cjs collectDetailImages 와 같은 선택자)
async function readCoupang(url) {
  const ses = session.fromPartition("persist:seedhack-template-flow");
  ses.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36");
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
  // 첫 방문은 홈에서 쿠키를 받은 뒤 간다(새 세션으로 상품 화면을 바로 열면 Access Denied). 막히면 5초 뒤 한 번만 다시
  const denied = async () => /Access Denied|권한이 없습니다|비정상적인 접근/.test(await win.webContents.executeJavaScript("document.title"));
  const go = async (u) => { await win.loadURL(u); await sleep(2000); if (await denied()) { console.log("   △ Access Denied → 5초 뒤 다시"); await sleep(5000); await win.loadURL(u); await sleep(2500); } if (await denied()) throw new Error(`쿠팡이 막음: ${u}`); };
  await win.loadURL("https://www.coupang.com/"); await sleep(2500);
  await go(url);
  if (opt("search")) { // 검색 화면 → 첫 상품(광고 아닌 것)
    const first = await win.webContents.executeJavaScript(`(() => { const a = [...document.querySelectorAll('a[href*="/vp/products/"]')].find((x) => !x.closest('[class*="ad"],[class*="Ad"]') && x.querySelector('img')); return a ? a.href : ""; })()`);
    if (!first) throw new Error("검색 결과에서 상품을 못 찾음");
    console.log(`   🔎 첫 상품: ${first}`);
    await go(first.replace(/[?&](clickEventId|korePlacement|koreSubPlacement|searchId|searchRank|q|sourceType)=[^&]*/g, "").replace(/\?&/, "?"));
  }
  // 상세 영역이 뜨게 아래로 내린다(지연 로딩)
  await win.webContents.executeJavaScript(`(async () => { const s = (ms) => new Promise((r) => setTimeout(r, ms)); const H = () => document.documentElement.scrollHeight; for (let i = 0, y = 0; i < 30 && y < H(); i++) { y += 900; scrollTo(0, y); await s(350); } scrollTo(0, 0); await s(300); })()`, true);
  const r = await win.webContents.executeJavaScript(`(() => {
    const DETAIL_SEL = ".product-detail-content-inside, #productDetail, .prod-detail, [class*='product-detail-content'], [class*='vendor-item-detail'], [class*='detail-content'], #btfTab ~ *";
    const SKIP_SEL = ".prod-image, [class*='prod-image'], [class*='review'], [class*='recommend'], [class*='banner'], header, nav, footer, [class*='adr'], [class*='Ad-']";
    const imgSrc = (im) => (im.currentSrc || im.src || im.dataset.src || im.dataset.imgSrc || im.dataset.lazy || im.getAttribute("data-original") || "").trim();
    const seen = new Set(), out = [];
    const push = (im) => { const u = imgSrc(im).replace(/^\\/\\//, "https://"); if (!/^https:\\/\\/[\\w.-]*coupangcdn\\.com\\//i.test(u) || seen.has(u)) return; const w = im.naturalWidth || im.width || 0, h = im.naturalHeight || im.height || 0; if ((w && w < 300) || (h && h < 100)) return; seen.add(u); out.push(u); };
    const boxes = [...document.querySelectorAll(DETAIL_SEL)].filter((b) => !b.closest(SKIP_SEL));
    for (const b of boxes) for (const im of b.querySelectorAll("img")) push(im);
    if (out.length < 2) for (const im of document.images) { if (im.closest(SKIP_SEL)) continue; const r = im.getBoundingClientRect(); if (r.top + window.scrollY < 900) continue; if ((im.naturalWidth || im.width) < 400) continue; push(im); }
    const name = (document.querySelector("h1, h2[class*='title'], [class*='prod-buy-header'] h2")?.textContent || document.title).replace(/\\s*[-|]\\s*쿠팡!?\\s*$/, "").trim().slice(0, 80);
    const cat = [...document.querySelectorAll("#breadcrumb a, .breadcrumb a, [class*='breadcrumb'] a, [class*='Breadcrumb'] a")].map((a) => a.textContent.trim()).filter((t) => t && !/^홈$|coupang/i.test(t)).slice(-3).join(">");
    return { url: location.href.split("#")[0], name, category: cat, images: out, boxes: boxes.length };
  })()`);
  return { win, ...r };
}

app.whenReady().then(async () => {
  const t0 = Date.now();
  try {
    if (!jobSrc || !fs.existsSync(path.join(jobSrc, "info.json"))) throw new Error("작업 폴더(info.json 있는 detail/<jobId>)를 주세요");
    const id = path.basename(jobSrc) + "-tpl", jobDir = path.join(USER, "detail", id);
    fs.cpSync(jobSrc, jobDir, { recursive: true, filter: (p) => { const rel = path.relative(jobSrc, p); return !(rel === "out" || rel.startsWith("out" + path.sep) || /\.bak-|\.prev|\.v\d/.test(rel)); } });
    const res0 = rd(jobDir, "result.json") || {}; res0.renders = []; fs.writeFileSync(path.join(jobDir, "result.json"), JSON.stringify(res0));
    const { initDetail } = await import(pathToFileURL(path.join(here, "../../src/main/detail/index.js")).href);
    initDetail({ ipcMain: ipc, app, getWin: () => null, store, log, translate: async (t) => t, getCnSession: () => null, getCnView: () => null, send, showDetail: () => {} });
    const TPLS = await import(pathToFileURL(path.join(here, "../../src/main/detail/templates.js")).href);
    const tplRoot = path.join(USER, "templates");

    // ① 🧲 저장: 쿠팡 화면(실제) 또는 레퍼런스 폴더
    let tpl, capture = null;
    const ta = Date.now();
    if (opt("coupang") || opt("search")) {
      const url = opt("coupang") || `https://www.coupang.com/np/search?q=${encodeURIComponent(opt("search"))}`;
      const c = await readCoupang(url);
      console.log(`■ 쿠팡 ${c.name} · ${c.category || "(카테고리 없음)"} · 상세 영역 ${c.boxes}개 · 상세 이미지 ${c.images.length}장`);
      if (c.images.length < 2) throw new Error("상세 이미지를 못 찾음");
      const fakeEvent = { sender: c.win.webContents }; // 실제 버튼과 같이 보낸 화면의 세션으로 받고, 진행은 webContents.send 로 간다
      const r = await handlers["detail:captureReference"](fakeEvent, { url: c.url, name: c.name, category: c.category, images: c.images });
      if (r?.error) throw new Error("🧲 저장 실패: " + r.error);
      capture = { url: c.url, name: c.name, category: c.category, found: c.images.length, saved: r.images, ms: r.ms, usd: r.usd, existing: !!r.existing };
      tpl = r.template; c.win.destroy();
      // 같은 주소 다시 → 재분석 없이 기존 템플릿
      const again = await handlers["detail:captureReference"]({ sender: { getURL: () => c.url, session: null, send: () => {} } }, { url: c.url, name: c.name, category: c.category, images: c.images });
      console.log(`■ 같은 주소 다시 저장 → ${again?.existing ? "기존 템플릿 재사용(분석 없음)" : "?? 다시 분석됨"}`);
    } else {
      const refDir = opt("ref"); if (!refDir || !fs.existsSync(refDir)) throw new Error("--coupang=<주소> / --search=<검색어> / --ref=<레퍼런스 폴더> 중 하나를 주세요");
      const { buildReference } = await import(pathToFileURL(path.join(here, "../../src/main/detail/reference.js")).href);
      const ref = await buildReference({ input: refDir, outDir: path.join(USER, "ref-out"), log });
      if (ref?.error && !ref?.tokens) throw new Error("레퍼런스 분석 실패: " + ref.error);
      const st = TPLS.createStore(tplRoot);
      tpl = st.saveFromReference(ref, { name: "", category: path.basename(refDir).slice(0, 20), source: { kind: "folder", productName: path.basename(refDir), key: TPLS.sourceKey({ dir: refDir }) } });
      capture = { ref: refDir, ms: ref.cost?.ms, usd: ref.cost?.usd };
    }
    lap("capture", ta);
    if (!tpl?.id) throw new Error("템플릿이 만들어지지 않음");
    const tplFile = path.join(tplRoot, tpl.id, "template.json");
    console.log(`■ 보관함 「${tpl.name}」 ${tpl.id} · 섹션 ${(tpl.sections || []).length}개 · 손잡이 ${tpl.tokens.align}/${tpl.tokens.kicker}/${tpl.tokens.bands}/${tpl.tokens.photo} · 강조 ${tpl.tokens.colors?.brand || "없음"} · ${(T.capture / 1000).toFixed(0)}초${capture.usd != null ? ` · $${Number(capture.usd).toFixed(3)}` : ""}`);
    const raw = JSON.stringify(rd(path.dirname(tplFile), "template.json"));
    if (/ocr_lines|measured"/.test(raw)) throw new Error("template.json 에 ocr_lines·measured 가 남아 있음");
    console.log(`  template.json ${Math.round(raw.length / 1024)}KB · 원문(ocr_lines·measured) 없음 ✔ · guard.json 줄 ${(rd(path.dirname(tplFile), "guard.json")?.ocr_lines || []).length}`);

    // ② 목록·내보내기→가져오기 왕복·세부 조정
    const themes = await handlers["detail:themes"]({}, {});
    const mine = themes.filter((t) => t.kind === "mine");
    console.log(`■ detail:themes 기본 ${themes.length - mine.length} + 내 템플릿 ${mine.length} (${mine.map((t) => t.name).join(", ")})`);
    const exp = await handlers["detail:template:export"]({}, { id: tpl.id, file: path.join(USER, "share") });
    const imp = await handlers["detail:template:import"]({}, { file: exp.file });
    if (imp?.error) throw new Error("가져오기 실패: " + imp.error);
    console.log(`■ 내보내기 ${path.basename(exp.file)} ${Math.round(fs.statSync(exp.file).size / 1024)}KB → 가져오기 「${imp.template.name}」 ${imp.template.id} (madeBy ${imp.template.madeBy}) · 토큰 같음 ${JSON.stringify(imp.template.tokens) === JSON.stringify(tpl.tokens) ? "✔" : "✕"}`);
    await handlers["detail:template:remove"]({}, { id: imp.template.id });
    const adj = await handlers["detail:template:set"]({}, { id: tpl.id, overrides: { spacing: "airy" } });
    console.log(`■ 세부 조정 spacing=airy → chips 반영 ${adj.template?.chips?.find((c) => c.key === "spacing")?.value === "airy" ? "✔" : "✕"} · overrides ${JSON.stringify(adj.template?.overrides)}`);
    await handlers["detail:template:set"]({}, { id: tpl.id, overrides: {}, merge: false }); // 원래대로

    // ③ 템플릿 선택 → 생성
    if (flag("no-generate")) { console.log("FLOW_OK (생성 생략)"); app.exit(0); return; }
    const tg = Date.now();
    const r = await handlers["detail:template:use"]({}, { jobId: id, templateId: tpl.id, keepExtra: flag("keep-extra") });
    if (r?.error) throw new Error(r.error);
    const end = await new Promise((res, rej) => { const tick = () => { const e = events.find((x) => x.jobId === id && (x.step === "done" || x.step === "fail")); if (e) return res(e); if (Date.now() - tg > 900000) return rej(new Error("시간 초과")); setTimeout(tick, 200); }; tick(); });
    if (end.step === "fail") throw new Error("파이프라인 실패: " + (end.msg || JSON.stringify(end)));
    lap("generate", tg);
    const ref = rd(path.join(jobDir, "reference"), "reference.json"), secs = rd(jobDir, "sections.json"), copy = rd(jobDir, "copy.json"), plan = rd(jobDir, "plan.json"), result = rd(jobDir, "result.json"), info = rd(jobDir, "info.json");
    const { refRecipe, guardSimilarity, CLAIM_RE } = await import(pathToFileURL(path.join(here, "../../src/main/detail/reference-core.js")).href);
    const recipe = refRecipe(ref).recipe.map((x) => x.type);
    console.log(`\n■ info.templateRef ${info.templateRef} · theme ${info.theme} · reference.json fromTemplate ${ref?.fromTemplate} · keepExtra ${ref?.keepExtra}`);
    console.log(`■ 템플릿 레시피: ${recipe.join(" → ")}`);
    console.log(`■ 우리 섹션:     ${secs.map((s) => s.type).join(" → ")}`);
    console.log(`■ 렌더 plan:     ${plan.sections.map((s) => `${s.type}${s.kicker ? `[${s.kicker}]` : ""}`).join(" → ")} · refTokens ${plan.meta?.refTokens ? "✔" : "✕"}`);
    const ourOrder = secs.map((s) => s.type).filter((t) => recipe.includes(t)), recipeHave = recipe.filter((t) => ourOrder.includes(t));
    const orderOk = JSON.stringify([...new Set(ourOrder)]) === JSON.stringify([...new Set(recipeHave)]);
    console.log(`  순서 일치(재료 있는 섹션만): ${orderOk ? "예" : "아니오"}`);
    const sim = guardSimilarity(copy, ref.ocr_lines || [], {});
    const flat = []; const walk = (o, p) => { if (typeof o === "string") flat.push({ p, t: o }); else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${p}[${i}]`)); else if (o && typeof o === "object") for (const k of Object.keys(o)) if (!["sections", "chain", "similarity", "emph", "name_emph", "title_lines", "chain_check"].includes(k)) walk(o[k], p ? `${p}.${k}` : k); }; walk(copy, "");
    const claimHits = flat.filter((x) => CLAIM_RE.test(x.t));
    console.log(`■ 표절 가드: 파이프라인 ${JSON.stringify(copy.similarity ? { checked: copy.similarity.checked, flagged: copy.similarity.flagged.length, rewritten: copy.similarity.rewritten } : null)} · 재검사 비슷한 줄 ${sim.flagged.length} · 근거 주장 ${claimHits.length}건`);
    for (const f of sim.flagged) console.log(`    · ${f.path}: "${f.line}" ≈ "${f.ref}"`);
    console.log(`  hero: ${copy.hero?.name} / ${copy.hero?.sub}`); (copy.features || []).forEach((f, i) => console.log(`  feature${i + 1}: ${String(f.title).replace("\n", " ⏎ ")}`));
    const rr = (result.renders || []).slice(-1)[0];
    console.log(`\n■ 시간 저장 ${(T.capture / 1000).toFixed(0)}초 + 생성 ${(T.generate / 1000).toFixed(0)}초 = ${((Date.now() - t0) / 1000).toFixed(0)}초 · 비용 저장 $${capture.usd ?? "-"} + 생성 ${JSON.stringify(result.costs || {})} (합 $${result.costUsd ?? "-"}) · 렌더 ${rr?.id} 테마 ${rr?.theme} templateRef ${rr?.templateRef} 슬라이스 ${rr?.slices?.length}`);
    if (outDir && rr) { fs.rmSync(outDir, { recursive: true, force: true }); fs.cpSync(path.join(jobDir, rr.dir), outDir, { recursive: true }); for (const f of ["plan.json", "copy.json", "sections.json"]) fs.copyFileSync(path.join(jobDir, f), path.join(outDir, f)); fs.cpSync(path.dirname(tplFile), path.join(outDir, "template"), { recursive: true }); fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ capture, template: { id: tpl.id, name: tpl.name, sections: tpl.sections, tokens: tpl.tokens }, recipe, sections: secs.map((s) => ({ type: s.type, ref: s.ref || null })), orderOk, similarity: copy.similarity, reSim: sim.flagged, claimHits, costs: result.costs, costUsd: result.costUsd, times: T, totalMs: Date.now() - t0, render: { id: rr.id, theme: rr.theme, templateRef: rr.templateRef, slices: rr.slices?.length } }, null, 2)); console.log(`  → ${outDir}`); }
    fs.writeFileSync(path.join(outDir || USER, "flow.log"), logs.join("\n"));
    console.log("FLOW_OK"); app.exit(0);
  } catch (e) { console.error("FLOW_FAIL", e?.stack || e); try { fs.writeFileSync(path.join(USER, "flow.log"), logs.join("\n")); } catch {} app.exit(1); }
});
