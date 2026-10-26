// ▶ 주소로 만들기 · 타오바오/티몰 하네스:  npx electron test/detail/taobao-harness.js [--live=<타오바오·티몰 상품 주소>] [--out=<폴더>]
// ① fixture/offer-taobao-new.html(새 화면 흉내)을 cn.cjs 로 열고 detail:readPage(📄 주소 칸과 같은 요청) → raw → normalizeSource 검사
// ② --live: 실제 상품 주소를 새(로그인 없는) 임시 세션으로 한 번 연다 → 로그인·슬라이더 화면을 cnWall 로 가려내는지(앱 사용자 세션·데이터는 건드리지 않음)
// 마지막 줄 TAOBAO_OK 또는 실패 사유.
import { app, BrowserWindow, ipcMain, session } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USER = path.join(os.tmpdir(), "seedhack-taobao-harness");
fs.rmSync(USER, { recursive: true, force: true }); app.setPath("userData", USER);
app.on("window-all-closed", () => {});
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..", "..");
const opt = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const { normalizeSource } = await import(pathToFileURL(path.join(root, "src/main/detail/extract-core.js")).href);
const { routeProductUrl, cnWall, CN_WALL_PROBE_JS } = await import(pathToFileURL(path.join(root, "src/main/detail/site-core.js")).href);
const fails = [], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, cond, msg) => { console.log(`${cond ? "  ✔" : "  ✕"} ${id} ${msg}`); if (!cond) fails.push(`${id} ${msg}`); };

let waiter = null;
ipcMain.handle("detail:fromPage", (_e, raw) => { waiter?.({ raw }); return { ok: true, jobId: "harness" }; });
ipcMain.on("detail:readPageDone", (_e, r) => waiter?.({ done: r }));
for (const ch of ["cn:probeMode", "cn:target", "cn:pending", "tb:pending", "cn:present"]) ipcMain.handle(ch, () => (ch === "cn:trmode" ? "off" : null));
ipcMain.handle("cn:trmode", () => "off");
for (const ch of ["cn:log", "tb:log"]) ipcMain.on(ch, () => {});

async function readPage(win, p = {}) {
  const got = new Promise((res) => { const acc = {}; waiter = (v) => { Object.assign(acc, v); if (acc.done) res(acc); }; });
  win.webContents.send("detail:readPage", { templateId: "clean", rowId: null, ...p });
  return Promise.race([got, sleep(90000).then(() => ({ done: { error: "시간 초과" } }))]);
}

app.whenReady().then(async () => {
  console.log("▶ ① fixture/offer-taobao-new.html (티몰 새 화면 흉내)");
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload: path.join(root, "src/preload/cn.cjs"), sandbox: true, contextIsolation: true } });
  await win.loadFile(path.join(here, "fixture", "offer-taobao-new.html")); await sleep(800);
  const r = await readPage(win, { site: "tmall" });
  check("T-1", !!r.raw && r.done?.ok, `readPage 응답 ${JSON.stringify(r.done).slice(0, 120)}`);
  if (r.raw) {
    const s = normalizeSource(r.raw);
    console.log(`  raw: 방식=${r.raw.how} · 제목=${r.raw.title_zh} · 후보=${(r.raw.titleCandidates || []).slice(0, 3).map((c) => c.t).join(" | ")}`);
    check("T-2", s.title_zh === "加厚脏衣篮 折叠收纳筐 家用洗衣篮", `상품명 = mainTitle (검색칸 "按图片搜索" 아님): ${s.title_zh}`);
    check("T-3", s.source === "tmall" && s.offerId === "988732283056", `출처 ${s.source} · 번호 ${s.offerId}`);
    const a = Object.fromEntries(s.attrs.map((x) => [x.k_zh, x.v_zh]));
    check("T-4", a["材质"] === "PP" && a["容量"] === "66L" && a["品牌"] === "无" && a["尺寸"] === "40*30*55cm", `参数信息 → 속성 ${s.attrs.length}개 ${JSON.stringify(a)}`);
    check("T-5", s.options.map((o) => o.label_zh).join(",") === "灰色,蓝色,米白色" && s.options.every((o) => o.img), `옵션 ${s.options.map((o) => o.label_zh).join(",")}`);
    check("T-6", s.gallery.length === 3, `대표 ${s.gallery.length}장 ${s.gallery.map((g) => path.basename(g.url)).join(",")}`);
    check("T-7", s.detailImages.length === 4 && s.detailImages.every((d) => /\/d0[1-4]\.png$/.test(d.url)), `상세 ${s.detailImages.length}장`);
    check("T-8", s.price?.min === 28, `가격 ${JSON.stringify(s.price)}`);
  }
  win.destroy();

  const live = opt("live");
  if (live) {
    const rt = routeProductUrl(live);
    console.log(`▶ ② 실제 페이지(로그인 없는 새 세션) ${rt.url}`);
    const ses = session.fromPartition(`taobao-harness-${Date.now()}`);
    const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, preload: path.join(root, "src/preload/cn.cjs"), sandbox: true, contextIsolation: true } });
    try { await w.loadURL(rt.url); } catch {}
    await sleep(5000);
    const st = await w.webContents.executeJavaScript(CN_WALL_PROBE_JS, true).catch(() => null);
    const wall = st && cnWall(st);
    console.log(`  도착 ${String(st?.url).slice(0, 120)} · 제목 ${st?.title} · 판정 ${wall || "상품 화면"}`);
    const out = opt("out"); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "taobao-live.png"), (await w.webContents.capturePage()).toPNG()); }
    if (wall) check("L-1", true, `로그인 없는 세션 → "${wall}" 화면을 가려냄 (앱에서는 "타오바오 탭에서 로그인·인증을 넘긴 뒤 다시 눌러 주세요")`);
    else { const rr = await readPage(w, { site: rt.site }); const s = rr.raw ? normalizeSource(rr.raw) : null; console.log(`  읽음: ${s ? `제목 ${s.title_zh} · 대표 ${s.gallery.length} · 옵션 ${s.options.length} · 속성 ${s.attrs.length} · 상세 ${s.detailImages.length}` : JSON.stringify(rr.done)}`); check("L-1", !!s && s.detailImages.length > 0, "로그인 없이 상품 화면이 열림 → 읽기"); }
    w.destroy();
  }
  console.log(fails.length ? `TAOBAO_FAIL ${fails.length}건\n - ${fails.join("\n - ")}` : "TAOBAO_OK");
  app.exit(fails.length ? 1 : 0);
});
