// ▶ 주소로 만들기 · 한국 판매처 실페이지 하네스:  npx electron test/detail/site-harness.js "<상품 주소>" --out=<폴더> [--save-fixture=<이름>] [--home]
// 임시 userData(앱 데이터는 건드리지 않음)·숨은 창(persist:detail-web 과 같은 UA·힌트)으로 한 번 열어 → collectPage → buildKoRaw → normalizeSource → downloadImages
// → <out>/page.json(화면에서 모은 것) · source.json · raw/ 그림 · contact.png(대표/상세 나눔 확인용 한 장). --home: 쿠팡처럼 홈을 먼저 한 번 연다(쿠팡 2번 접속).
// --save-fixture: page.json 을 test/detail/fixture/sites/<이름>.json 으로(단위 테스트 재료). 마지막 줄 SITE_OK / SITE_WALL / SITE_FAIL
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USER = path.join(os.tmpdir(), "seedhack-site-harness");
app.setPath("userData", USER);
app.on("window-all-closed", () => {});
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..", "..");
const opt = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const url0 = process.argv.slice(2).find((a) => !a.startsWith("--") && /[./]/.test(a) && !/site-harness\.js$/.test(a));
const out = path.resolve(opt("out") || path.join(USER, "out"));
const imp = (f) => import(pathToFileURL(path.join(root, "src/main/detail", f)).href);
const { routeProductUrl, buildKoRaw, koWallMessage } = await imp("site-core.js");
const { normalizeSource } = await imp("extract-core.js");
const { downloadImages } = await imp("extract.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { webSession, readFrom } = await imp("site-read.js");
  const rt = routeProductUrl(url0);
  if (rt.error) { console.log("✕", rt.error); app.exit(1); return; }
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  console.log(`▶ ${rt.site} ${rt.url}`);
  const ses = webSession(), t0 = Date.now();
  if (opt("page")) return finish(rt, JSON.parse(fs.readFileSync(opt("page"), "utf8")).page, ses); // 저장한 화면(fixture)으로 — 접속 없이 고르기·내려받기만
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.setAudioMuted(true);
  const load = async (u, ref) => { const done = new Promise((res) => { const t = setTimeout(res, 25000); win.webContents.once("did-stop-loading", () => { clearTimeout(t); res(); }); }); try { await win.loadURL(u, ref ? { httpReferrer: ref } : {}); } catch {} await done; await sleep(2000); };
  if (process.argv.includes("--home")) await load(new URL(rt.url).origin + "/");
  await load(rt.url, process.argv.includes("--home") ? new URL(rt.url).origin + "/" : "");
  const r = await readFrom(win.webContents, rt.site).catch((e) => ({ error: String(e?.message || e) }));
  fs.writeFileSync(path.join(out, "shot.png"), (await win.webContents.capturePage()).toPNG());
  win.destroy();
  if (r.wall || r.error) { console.log(`  막힘: ${r.wall || r.error} · ${r.state?.url || ""} · ${r.state?.title || ""}\n  앱 안내: ${koWallMessage(rt.site, r.wall)}`); console.log("SITE_WALL"); app.exit(2); return; }
  return finish(rt, r.page, ses, t0);
});
async function finish(rt, page, ses, t0 = Date.now()) {
  console.log(`  읽기 ${((Date.now() - t0) / 1000).toFixed(1)}초 · 그림 ${page.imgs.length}개 · 표 ${page.attrs.length}칸 · 옵션 ${page.options.length} · 더보기 ${page.clicked ? "누름" : "없음"} · 높이 ${page.height}`);
  fs.writeFileSync(path.join(out, "page.json"), JSON.stringify(page, null, 1));
  if (opt("save-fixture")) { const f = path.join(here, "fixture", "sites", `${opt("save-fixture")}.json`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ site: rt.site, id: rt.id, savedAt: new Date().toISOString().slice(0, 10), page }, null, 1)); console.log(`  fixture 저장 ${path.relative(root, f)}`); }
  const raw = buildKoRaw(rt.site, page, { id: rt.id });
  const src = normalizeSource(raw);
  console.log(`  ${raw.how}\n  제목 ${src.title_ko}\n  가격 ${JSON.stringify(src.price)} · 속성 ${src.attrs.length} ${src.attrs.slice(0, 4).map((a) => `${a.k_ko}=${a.v_ko}`).join(" / ")}\n  옵션 ${src.options.length} ${src.options.slice(0, 4).map((o) => o.label_ko).join(" / ")}\n  대표 ${src.gallery.length} · 상세 ${src.detailImages.length} · 글 ${src.detailText_ko.length}자`);
  const dl = await downloadImages(src, out, { session: ses, kinds: "v2" });
  fs.writeFileSync(path.join(out, "source.json"), JSON.stringify(src, null, 1));
  const byK = (k) => src.images.filter((im) => im.kind === k);
  console.log(`  내려받기 성공 ${dl.ok} · 실패 ${dl.fail} · 대표 ${byK("main").length} · 상세 ${byK("detail").length}`);
  // 대조표: 대표/상세 줄을 나눠 작게
  const cell = (im) => `<figure><img src="${pathToFileURL(im.file).href}"><figcaption>${im.id} ${im.w}×${im.h}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><style>body{font:12px sans-serif;margin:10px;background:#fff} h3{margin:8px 0} .g{display:flex;flex-wrap:wrap;gap:6px} figure{margin:0;width:150px} img{width:150px;height:150px;object-fit:contain;background:#eee;display:block} figcaption{font-size:10px;color:#555}</style>
    <h3>${rt.site} · ${src.title_ko.replace(/</g, "&lt;")}</h3><h3>대표(main) ${byK("main").length}</h3><div class="g">${byK("main").map(cell).join("")}</div><h3>상세(detail) ${byK("detail").length}</h3><div class="g">${byK("detail").map(cell).join("")}</div>`;
  fs.writeFileSync(path.join(out, "contact.html"), html);
  const cw = new BrowserWindow({ show: false, width: 1000, height: 400, webPreferences: { sandbox: true } });
  await cw.loadFile(path.join(out, "contact.html")); await sleep(800);
  const H = await cw.webContents.executeJavaScript("document.documentElement.scrollHeight"); cw.setContentSize(1000, Math.min(4000, H)); await sleep(500);
  fs.writeFileSync(path.join(out, "contact.png"), (await cw.webContents.capturePage()).toPNG()); cw.destroy();
  const ok = src.gallery.length >= 1 && src.detailImages.length >= 2 && dl.ok >= 3 && !!src.title_ko;
  console.log(`  결과 ${out}\n${ok ? "SITE_OK" : "SITE_FAIL"}`);
  app.exit(ok ? 0 : 1);
}
