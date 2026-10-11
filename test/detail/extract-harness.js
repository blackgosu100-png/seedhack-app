// 📄 상세페이지 ①② 추출·내려받기 하네스:  npx electron test/detail/extract-harness.js
// CONTRACTS 10절: 임시 userData, show:false 창에 preload=cn.cjs(sandbox) 로 fixture 를 file:// 로 연다. 네트워크 접속 없음.
// 흐름: 버튼(#sg-detail-btn) 클릭 → cn.cjs readDetailRaw → ipc detail:fromPage(여기서 받음) → normalizeSource → downloadImages(raw/)
// 체크리스트 A1-1 ~ A1-5 를 코드로 검사해 마지막에 "A1_OK" 또는 실패 사유를 찍는다.
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
app.on("window-all-closed", () => {}); // 창을 닫아도 끝까지 간다(기본은 자동 종료)
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const { normalizeSource } = await import(pathToFileURL(path.join(root, "src/main/detail/extract-core.js")).href);
const { downloadImages } = await import(pathToFileURL(path.join(root, "src/main/detail/extract.js")).href);

const fails = [];
const check = (id, cond, msg) => { console.log(`${cond ? "  ✔" : "  ✕"} ${id} ${msg}`); if (!cond) fails.push(`${id} ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fixture 한 장을 cn.cjs 로 열고 버튼을 눌러 raw 를 받는다
let pending = null;
ipcMain.handle("detail:fromPage", (_e, raw) => { pending?.(raw); return { ok: true, jobId: "test-" + Date.now() }; });
// 기존 cn.cjs 흐름(start/askPill)이 조용히 빠져나가도록 최소 핸들러: 숨은 창 아님 · 리스트업 대상 없음
ipcMain.handle("cn:probeMode", () => false);
ipcMain.handle("cn:target", () => null);
ipcMain.handle("cn:trmode", () => "off");
ipcMain.on("cn:log", (_e, t) => console.log("  cn.cjs:", String(t).slice(0, 200)));
async function readFixture(file) {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload: path.join(root, "src/preload/cn.cjs"), sandbox: true, contextIsolation: true } });
  win.webContents.on("preload-error", (_e, _p, err) => fails.push("preload 오류 " + err.message));
  const got = new Promise((res) => { pending = res; });
  await win.loadFile(path.join(here, "fixture", file));
  // 버튼이 뜰 때까지
  let btn = false;
  for (let i = 0; i < 40 && !btn; i++) { btn = await win.webContents.executeJavaScript(`!!document.getElementById("sg-detail-btn")`); if (!btn) await sleep(100); }
  const geom = await win.webContents.executeJavaScript(`(() => { const b = document.getElementById("sg-detail-btn"); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, right: Math.round(innerWidth - r.right), top: Math.round(r.top) }; })()`);
  if (btn) await win.webContents.executeJavaScript(`document.getElementById("sg-detail-btn").click()`);
  const raw = await Promise.race([got, sleep(30000).then(() => null)]);
  let msg = "";
  for (let i = 0; i < 30 && !/✔|✕/.test(msg); i++) { await sleep(100); msg = await win.webContents.executeJavaScript(`document.querySelector("#sg-detail .msg")?.textContent || ""`); }
  win.destroy();
  return { btn, geom, raw, msg };
}

app.whenReady().then(async () => {
  const jobDir = path.join(app.getPath("userData"), "detail", "harness-" + Date.now());
  const imgDir = path.join(here, "fixture", "img");
  const toUrl = (f) => pathToFileURL(path.join(imgDir, f)).href;

  // ---- A1-5 · A1-1 · A1-3: 1688 흉내 fixture ----
  console.log("▶ fixture/offer.html (1688 흉내)");
  const a = await readFixture("offer.html");
  check("A1-5", a.btn && a.geom?.text.includes("📄 상세페이지 만들기"), `버튼 #sg-detail-btn 표시 (${a.geom?.text || "없음"})`);
  check("A1-5", a.geom && a.geom.top < 80 && a.geom.right < 80, `버튼 위치 오른쪽 위 (top ${a.geom?.top} right ${a.geom?.right})`);
  check("A1-5", !!a.raw, "detail:fromPage 로 raw 받음");
  check("A1-5", /✔ 만들기 시작/.test(a.msg), `응답 문구 "${a.msg}"`);
  if (!a.raw) { finish(); return; }
  console.log(`  raw: 읽은 방식=${a.raw.how} · 제목=${a.raw.title_zh} · 가격=${JSON.stringify(a.raw.price)} · 속성 ${a.raw.attrs.length} · 옵션 ${a.raw.options.length} · 갤러리 ${a.raw.gallery.length} · 상세 ${a.raw.detailImages.length} · 상점=${JSON.stringify(a.raw.shop)}`);
  const s = normalizeSource(a.raw);
  check("A1-1", s.source === "1688" && s.offerId === "900000001", `출처 ${s.source} · offerId ${s.offerId}`);
  check("A1-1", /加厚脏衣篮/.test(s.title_zh) && !/有限公司/.test(s.title_zh), `제목 "${s.title_zh}" (앞쪽 회사명 h1 2개 건너뜀)`);
  check("A1-1", Array.isArray(a.raw.titleCandidates) && a.raw.titleCandidates.length >= 2 && a.raw.titleCandidates[0].from === "offerTitle", `제목 후보 ${a.raw.titleCandidates?.map((c) => c.from + ":" + c.t.slice(0, 12)).join(" | ")}`);
  { const bad = normalizeSource({ ...a.raw, title_zh: "义乌市测试日用品有限公司", shop: null });
    check("A1-1", /加厚脏衣篮/.test(bad.title_zh) && bad.shop?.name === "义乌市测试日用品有限公司", `normalize 안전망: 회사명 제목 → "${bad.title_zh}" · 상점 "${bad.shop?.name}"`); }
  check("A1-1", s.price && s.price.min === 12.8 && s.price.max === 15.5, `가격 ${JSON.stringify(s.price)}`);
  check("A1-1", s.attrs.length >= 5 && s.attrs[0].k_zh === "材质" && s.attrs[0].v_zh === "PP" && !s.attrs.some((x) => !x.k_zh), `속성표 ${s.attrs.length}개 (${s.attrs.slice(0, 3).map((x) => x.k_zh + "=" + x.v_zh).join(", ")} …)`);
  check("A1-1", s.options.length >= 2 && s.options[0].label_zh === "灰色" && s.options[0].img === toUrl("g01.png"), `옵션 ${s.options.length}개 (${s.options.map((o) => o.label_zh).join("/")}) 첫 옵션 그림 꼬리 제거 → ${path.basename(s.options[0]?.img || "")}`);
  check("A1-1", s.gallery.length === 3 && s.gallery.map((g) => path.basename(g.url)).join(",") === "g01.png,g02.png,g03.png", `갤러리 ${s.gallery.length}장 (${s.gallery.map((g) => path.basename(g.url)).join(",")}) — _sum.jpg·?x-oss-process·_.webp 꼬리 제거·중복 제거`);
  const dnames = s.detailImages.map((d) => path.basename(d.url));
  const want = Array.from({ length: 12 }, (_, i) => `d${String(i + 1).padStart(2, "0")}.png`);
  check("A1-1", dnames.join(",") === want.join(","), `상세 이미지 ${s.detailImages.length}장 페이지 순서 (${dnames.join(",")})`);
  check("A1-2", !dnames.includes("tiny.png") && !s.detailImages.some((d) => /^data:/.test(d.url)), "40px 아이콘·data: 구분선 제외");
  check("A1-3", ["d03.png", "d06.png", "d09.png", "d12.png"].every((n) => dnames.includes(n)), "지연 로딩(data-lazyload-src·data-src·data-original) 4장 포함");
  check("A1-3", s.detailImages.find((d) => d.url.endsWith("d12.png"))?.w === 790, `지연 로딩 그림의 w/h 는 속성값(1x1 자리표시 아님): d12 w=${s.detailImages.find((d) => d.url.endsWith("d12.png"))?.w}`);
  check("A1-1", /加厚PP材质/.test(s.detailText_zh) && /温馨提示/.test(s.detailText_zh), `상세 글 ${s.detailText_zh.length}자`);
  check("A1-1", s.shop && /义乌市测试/.test(s.shop.name) && s.shop.years === 5 && s.shop.repeat === 23.5, `상점 ${JSON.stringify(s.shop)}`);

  // ---- A1-4: 내려받기 (file:// 복사 + 가짜 세션으로 동시성·Referer·실패·제한시간·webp 변환 검사) ----
  console.log("▶ downloadImages (fixture → raw/)");
  const prog = [];
  const r1 = await downloadImages(s, jobDir, { onProgress: (p) => prog.push(p), log: (t) => console.log("  log:", t) });
  check("A1-4", r1.ok === 18 && r1.fail === 0, `file:// 18장(갤러리 3 + 상세 12 + 옵션 3) → ok ${r1.ok} fail ${r1.fail}`);
  check("A1-4", s.images.length === 18 && s.images.every((im) => fs.existsSync(im.file) && im.w > 0 && im.h > 0 && im.bytes > 0), `images 배열 ${s.images.length}개 · 파일 존재 · w/h/bytes 기록`);
  check("A1-4", s.images.map((im) => im.id).join(",") === "g01,g02,g03,o01,o02,o03," + want.map((n) => n.replace(".png", "")).join(","), `id 순서 ${s.images.map((im) => im.id).join(",")}`);
  const d07 = s.images.find((im) => im.id === "d07");
  check("A1-4", d07 && d07.w === 750 && d07.h === 3200 && d07.file.endsWith(".png"), `긴 그림 d07 ${d07?.w}x${d07?.h} ${path.basename(d07?.file || "")}`);
  check("A1-4", prog.length === 18 && prog[prog.length - 1].done === 18 && prog[prog.length - 1].total === 18, `onProgress ${prog.length}회 (마지막 ${prog[prog.length - 1]?.done}/${prog[prog.length - 1]?.total})`);

  // 가짜 세션: http 주소를 fixture 파일로 돌려주되 동시 요청 수·Referer 를 기록, 한 장은 404, 한 장은 응답 없음(제한시간), 한 장은 webp
  let inflight = 0, maxInflight = 0; const referers = new Set();
  const fakeSession = { fetch: async (url, opts) => {
    inflight++; maxInflight = Math.max(maxInflight, inflight); referers.add(opts?.headers?.Referer);
    try {
      await sleep(120);
      const name = url.split("/").pop();
      if (name === "missing.jpg") return new Response("nope", { status: 404 });
      if (name === "hang.jpg") await new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(new Error("aborted"))));
      return new Response(fs.readFileSync(path.join(imgDir, name)), { status: 200 });
    } finally { inflight--; }
  } };
  const s2 = { source: "1688", url: "https://detail.1688.com/offer/1.html", gallery: [{ url: "https://cbu01.alicdn.com/x/g01.png" }], options: [],
    detailImages: ["d01.png", "d02.png", "missing.jpg", "hang.jpg", "d05.png", "extra.webp", "d07.png", "d08.png"].map((n) => ({ url: "https://cbu01.alicdn.com/x/" + n })) };
  const t0 = Date.now();
  const r2 = await downloadImages(s2, path.join(jobDir, "fake"), { session: fakeSession, timeoutMs: 700, log: (t) => console.log("  log:", t) });
  check("A1-4", r2.ok === 7 && r2.fail === 2, `실패해도 계속: ok ${r2.ok} fail ${r2.fail} (404 1장 + 제한시간 1장) · ${Date.now() - t0}ms`);
  check("A1-4", maxInflight === 4, `동시 4개 (최대 동시 ${maxInflight})`);
  check("A1-4", referers.size === 1 && referers.has("https://detail.1688.com/"), `Referer ${[...referers].join(",")}`);
  const webp = s2.images.find((im) => im.url.endsWith("extra.webp"));
  check("A1-4", webp && webp.file.endsWith(".png") && webp.w === 640 && webp.h === 480, `webp → png 변환 저장 ${path.basename(webp?.file || "")} ${webp?.w}x${webp?.h}`);
  check("A1-4", s2.images.map((im) => im.id).join(",") === "g01,d01,d02,d05,d06,d07,d08", `못 받은 것은 배열에서 뺌: ${s2.images.map((im) => im.id).join(",")}`);
  const tb = { source: "taobao", url: "https://item.taobao.com/item.htm?id=1", gallery: [], options: [], detailImages: [{ url: "https://img.alicdn.com/x/d01.png" }] };
  referers.clear(); await downloadImages(tb, path.join(jobDir, "fake2"), { session: fakeSession });
  check("A1-4", referers.has("https://item.taobao.com/"), `타오바오 Referer ${[...referers].join(",")}`);

  // ---- 적응형: 상세 컨테이너 class 를 모르는 변형 fixture ----
  console.log("▶ fixture/offer-nodesc.html (컨테이너 없음 → 세로 묶음)");
  const b = await readFixture("offer-nodesc.html");
  const sb = b.raw ? normalizeSource(b.raw) : null;
  check("A1-1", sb && sb.detailImages.map((d) => path.basename(d.url)).join(",") === want.join(","), `적응형 묶음으로 상세 12장 순서대로 (${b.raw?.how}) offerId ${sb?.offerId}`);

  // ---- 1688 신형 갤러리 구조 (실제 782706077987 에서 대표 사진 2장만·옵션에 상점명이 잡히던 문제) ----
  console.log("▶ fixture/offer-new.html (1688 신형 화면)");
  const nw = await readFixture("offer-new.html");
  const sn = nw.raw ? normalizeSource(nw.raw) : null;
  const gnames = sn ? sn.gallery.map((g) => path.basename(g.url)) : [];
  check("A1-1", gnames.join(",") === "g01.png,g02.png,d05.png,g03.png,d04.png,d01.png", `신형 갤러리 ${gnames.length}장 (${gnames.join(",")}) — 스크립트 offerImgList + 썸네일 data-src·data-lazyload-src·배경 그림·크기 꼬리`);
  check("A1-1", sn && !gnames.includes("extra.webp") && !sn.gallery.some((g) => /\.html/.test(g.url)), "동영상 표지·페이지 주소(src=\" \") 제외");
  check("A1-1", sn && sn.options.map((o) => o.label_zh).join("/") === "白色/灰色/绿色" && sn.options.every((o) => o.img && !/\.svg/.test(o.img)), `신형 옵션 ${sn?.options.map((o) => o.label_zh).join("/")} (상점명·svg 아이콘 안 잡힘)`);
  check("A1-1", sn && sn.title_zh === "防尘杯架 桌面收纳 杯子沥水架 家用" && sn.shop?.name === "东莞泽鑫源家居有限公司", `신형 제목 "${sn?.title_zh}" · 상점 ${sn?.shop?.name}`);
  check("A1-1", sn && sn.detailImages.length === 10, `신형 상세 ${sn?.detailImages.length}장`);

  // ---- 대표 사진 2장 미만 → 받은 상세 그림 중 정사각형을 갤러리로 (크기 모르는 상세 그림, 실제 1688 detailUrl 과 같은 상황) ----
  const s4 = { source: "1688", url: "https://detail.1688.com/offer/1.html", options: [], gallery: [{ url: toUrl("g01.png") }],
    detailImages: ["d01.png", "d02.png", "d11.png", "d12.png"].map((n) => ({ url: toUrl(n) })) };
  await downloadImages(s4, path.join(jobDir, "promote"), { log: (t) => console.log("  log:", t) });
  const g4 = s4.images.filter((im) => im.kind === "main");
  check("A1-1", g4.length === 2 && g4[1].id === "g02" && g4[1].from === "d03" && fs.existsSync(g4[1].file) && s4.gallery.length === 2 && s4.gallery[1].from === "detail", `대표 사진 1장 → 정사각형 상세(d11 800x800) 올림: ${g4.map((g) => g.id + (g.from ? "←" + g.from : "")).join(",")} · images 순서 ${s4.images.map((im) => im.id).join(",")}`);

  // ---- 실제 841080065939(Fatkun main 7·SKU 2) 흉내: 옵션은 스크립트 skuProps, 썸네일 끝의 옵션 그림 → main·sku 둘 다 ----
  console.log("▶ fixture/offer-sku.html (옵션 = 스크립트 skuProps, 3분류 main/sku/detail)");
  const ks = await readFixture("offer-sku.html");
  const sk = ks.raw ? normalizeSource(ks.raw) : null;
  check("A1-1", sk && sk.options.map((o) => o.label_zh).join("/") === "拉喇叭款/大号抽拉款" && sk.options.map((o) => path.basename(o.img || "")).join(",") === "d02.png,d06.png", `옵션 ${sk?.options.map((o) => o.label_zh + "=" + path.basename(o.img || "")).join(", ")} (잡동사니 없음)`);
  check("A1-1", sk && sk.gallery.length === 7, `대표 사진 ${sk?.gallery.length}장 (${sk?.gallery.map((g) => path.basename(g.url)).join(",")})`);
  if (sk) {
    await downloadImages(sk, path.join(jobDir, "sku"));
    const cnt = (k) => sk.images.filter((im) => im.kind === k).length;
    const sku = sk.images.filter((im) => im.kind === "sku");
    check("A1-4", cnt("main") === 7 && cnt("sku") === 2 && cnt("detail") === 7 && sk.images.map((im) => im.id[0]).join("") === "gggggggoodddddd" + "d", `3분류 main ${cnt("main")} · sku ${cnt("sku")} · detail ${cnt("detail")} · 순서 ${sk.images.map((im) => im.id).join(",")}`);
    check("A1-4", sku[0]?.label_zh === "拉喇叭款" && sku[0]?.label === "拉喇叭款" && sku[0]?.sameAs === "g06" && sku[1]?.sameAs === "g07", `sku 이름·sameAs: ${sku.map((x) => x.id + "=" + x.label + "~" + x.sameAs).join(", ")}`);
  }

  // ---- 📂 폴더로 만들기: Fatkun 폴더 흉내(임시 폴더에 fixture 그림을 main/SKU/detail 이름으로 복사) ----
  console.log("▶ importFolder (Fatkun 폴더 흉내)");
  const fdir = path.join(app.getPath("userData"), "fatkun", "일본 커피 머신 스토리지 랙 - 阿里巴巴");
  fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir, { recursive: true });
  ["g01", "g02", "g03", "d11", "d04", "d02", "d06"].forEach((n, i) => fs.copyFileSync(path.join(imgDir, n + ".png"), path.join(fdir, `main-0${i + 1}.png`)));
  fs.copyFileSync(path.join(imgDir, "d02.png"), path.join(fdir, "SKU-01-트럼펫을 당겨.png".normalize("NFD")));
  fs.copyFileSync(path.join(imgDir, "d06.png"), path.join(fdir, "SKU-02-대형 사이즈 풀아웃.png"));
  ["d01", "d03", "d05", "d07", "d08", "d09", "d10", "d12", "d01", "d03", "d05"].forEach((n, i) => fs.copyFileSync(path.join(imgDir, n + ".png"), path.join(fdir, `detail-${String(i + 1).padStart(2, "0")}.png`)));
  fs.copyFileSync(path.join(imgDir, "extra.webp"), path.join(fdir, "detail-12.webp"));
  fs.writeFileSync(path.join(fdir, "readme.txt"), "x");
  const { importFolder } = await import(pathToFileURL(path.join(root, "src/main/detail/extract.js")).href);
  const fsrc = await importFolder(fdir, { jobDir: path.join(jobDir, "folder"), log: (t) => console.log("  log:", t) });
  const fc = (k) => (fsrc.images || []).filter((im) => im.kind === k);
  check("A1-1", !fsrc.error && fc("main").length === 7 && fc("sku").length === 2 && fc("detail").length === 12, `폴더 → main ${fc("main").length} · sku ${fc("sku").length} · detail ${fc("detail").length} ${fsrc.error || ""}`);
  check("A1-1", fsrc.title_zh === "일본 커피 머신 스토리지 랙" && fsrc.options.length === 2 && fc("sku")[0]?.label_ko === "트럼펫을 당겨" && fc("sku")[0]?.sameAs === "g06" && fc("sku")[1]?.sameAs === "g07", `폴더 제목 "${fsrc.title_zh}" · 옵션 ${fc("sku").map((x) => x.label + "~" + x.sameAs).join(", ")}`);
  check("A1-1", fc("detail").at(-1)?.file.endsWith("d12.png") && fs.existsSync(fc("detail").at(-1).file) && fc("main").every((im) => im.w > 0 && im.h > 0), `폴더 webp → ${path.basename(fc("detail").at(-1)?.file || "")}, raw/ 복사, w/h 기록`);
  check("A1-1", (await importFolder(path.join(fdir, "없는폴더"))).error?.includes("열 수 없"), "없는 폴더는 { error }");

  // ---- A1-6: 타오바오 흉내 fixture (DOM 규칙만, 실사이트 미검증) ----
  console.log("▶ fixture/offer-taobao.html (타오바오 흉내)");
  const c = await readFixture("offer-taobao.html");
  const sc = c.raw ? normalizeSource(c.raw) : null;
  check("A1-6", sc && sc.source === "taobao" && sc.offerId === "700000001", `출처 ${sc?.source} · id ${sc?.offerId}`);
  check("A1-6", sc && /加厚脏衣篮/.test(sc.title_zh) && sc.price?.min === 28 && sc.price?.max === 35, `제목·가격 ${JSON.stringify(sc?.price)}`);
  check("A1-6", sc && sc.attrs.length >= 5 && sc.attrs.some((x) => x.k_zh === "材质" && x.v_zh === "PP"), `속성표 ${sc?.attrs.length}개 ("名称:值" 분해)`);
  check("A1-6", sc && sc.options.length === 3 && sc.options.map((o) => o.label_zh).join("/") === "灰色/蓝色/米白色" && sc.options[0].img?.endsWith("g01.png"), `옵션 ${sc?.options.map((o) => o.label_zh).join("/")} · _30x30.jpg 꼬리 제거`);
  check("A1-6", sc && sc.gallery.map((g) => path.basename(g.url)).join(",") === "g01.png,g02.png,g03.png", `갤러리 ${sc?.gallery.map((g) => path.basename(g.url)).join(",")} (_400x400.jpg·_50x50.jpg 꼬리 제거·data-src)`);
  check("A1-6", sc && sc.detailImages.length === 10 && sc.detailImages.map((d) => path.basename(d.url)).join(",") === want.slice(0, 10).join(","), `상세 ${sc?.detailImages.length}장 (#J_DivItemDesc, data-ks-lazyload 포함)`);
  check("A1-6", sc && sc.shop?.name === "测试家居旗舰店" && sc.shop.years === 3, `상점 ${JSON.stringify(sc?.shop)}`);

  fs.writeFileSync(path.join(jobDir, "source.json"), JSON.stringify(s, null, 2));
  console.log(`  source.json → ${path.join(jobDir, "source.json")}`);
  finish();
}).catch((e) => { console.error("FAIL", e); process.exitCode = 1; app.quit(); });

function finish() {
  if (fails.length) { console.log("A1_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("A1_OK");
  app.quit();
}
