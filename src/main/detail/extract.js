// 📄 상세페이지 ② 내려받기 — DetailSource 의 그림을 jobDir/raw/ 에 저장한다 (CONTRACTS 2절)
// 1688 CDN 은 Referer 없이 받으면 막히므로 1688 화면의 세션(session.fetch)에 출처별 Referer 를 붙인다(main.js hashImageUrl 과 같은 방식).
// 받은 바이트는 nativeImage 로 열어 w/h 를 적고, jpg/png 는 받은 그대로, webp/gif 등은 png 로 바꿔 저장한다. 못 받은 그림은 뺀다(로그만) — 절대 던지지 않는다.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nativeImage, net, BrowserWindow } from "electron";
import { planDownloads, refererFor, sniffImage, fillGallery, normKind, KIND_V1, classifyFolderFiles, titleFromFolder, skuLabel, normalizeSource } from "./extract-core.js";

const CONCURRENCY = 4, TIMEOUT_MS = 15000;

// file:// 는 그냥 복사(fixture·하네스), 그 밖은 세션 fetch(없으면 net.fetch) — 15초 제한
async function fetchBytes(url, { session, referer, timeoutMs }) {
  if (url.startsWith("file://")) return fs.promises.readFile(fileURLToPath(url));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const doFetch = session?.fetch ? session.fetch.bind(session) : net.fetch;
    const r = await doFetch(url, { headers: referer ? { Referer: referer } : {}, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(timer); }
}

// nativeImage 가 못 여는 형식(webp/gif/avif)은 숨은 창의 <canvas> 로 png 로 바꾼다. 창은 한 번만 만들고 끝나면 닫는다.
let decoderWin = null;
async function decodeViaWindow(buf, mime) {
  if (!decoderWin || decoderWin.isDestroyed()) {
    decoderWin = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { sandbox: true, contextIsolation: true } });
    await decoderWin.loadURL("about:blank");
  }
  const dataUrl = await decoderWin.webContents.executeJavaScript(`new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); res(c.toDataURL("image/png")); };
    img.onerror = () => rej(new Error("decode"));
    img.src = ${JSON.stringify(`data:${mime};base64,${buf.toString("base64")}`)};
  })`, true);
  return nativeImage.createFromDataURL(dataUrl);
}
// destroy() 직후 다른 오프스크린 창(⑧ 렌더)을 만들면 렌더러가 죽는 현상(A4 보고) → close() 하고 closed 를 기다린다(render.js closeWindow 와 같은 방식). (A5 보완)
async function closeDecoder() {
  const w = decoderWin; decoderWin = null;
  if (!w || w.isDestroyed()) return;
  await new Promise((res) => { const t = setTimeout(() => { try { w.destroy(); } catch {} res(); }, 1500); w.once("closed", () => { clearTimeout(t); res(); }); try { w.close(); } catch { clearTimeout(t); res(); } });
}

const MIME = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif" };

// 바이트 → { ext, bytes(저장할 것), w, h }
async function decode(buf) {
  const kind = sniffImage(buf);
  let im = nativeImage.createFromBuffer(buf);
  if (im.isEmpty() && kind && kind !== "jpg" && kind !== "png") im = await decodeViaWindow(buf, MIME[kind] || "image/webp");
  if (im.isEmpty()) throw new Error(`그림 형식을 읽지 못함(${kind || "알 수 없음"})`);
  const { width: w, height: h } = im.getSize();
  if (kind === "jpg" || kind === "png") return { ext: kind, bytes: buf, w, h };
  return { ext: "png", bytes: im.toPNG(), w, h }; // webp/gif/bmp/avif → png
}

// source: DetailSource(normalizeSource 결과). 끝나면 source.images 를 채워 돌려준다.
// 반환 { ok: n, fail: n } · onProgress({ done, total, id, file? })
// kinds: "v2"(기본, kind = main|sku|detail) | "v1"(gallery|option|detail — 예전 이름으로 거르는 모듈용). sku 항목엔 label_zh/label_ko/label, 대표 사진과 같은 그림이면 sameAs
export async function downloadImages(source, jobDir, { session = null, onProgress = null, log = null, concurrency = CONCURRENCY, timeoutMs = TIMEOUT_MS, kinds = "v2" } = {}) {
  const say = (t) => { try { log && log(t); } catch {} };
  const rawDir = path.join(jobDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const list = planDownloads(source, { kinds });
  const total = list.length, results = new Array(total).fill(null);
  let done = 0, ok = 0, fail = 0, next = 0;
  const referer = refererFor(source?.source, source?.url);

  const one = async (i) => {
    const it = list[i];
    try {
      const buf = await fetchBytes(it.url, { session, referer, timeoutMs });
      if (!buf?.length) throw new Error("빈 응답");
      const { ext, bytes, w, h } = await decode(buf);
      const file = path.join(rawDir, `${it.id}.${ext}`);
      await fs.promises.writeFile(file, bytes);
      const { id, kind, url, w: _w, h: _h, ...extra } = it; // extra: label_zh/label_ko/label/sameAs/from
      results[i] = { id, kind, url, file, w, h, bytes: bytes.length, ...extra };
      ok++;
    } catch (e) {
      fail++;
      say(`그림 못 받음 ${it.id} (${String(e?.message || e).slice(0, 80)}) ${it.url.slice(0, 120)}`);
    }
    done++;
    try { onProgress && onProgress({ done, total, id: it.id, file: results[i]?.file }); } catch {}
  };
  const worker = async () => { while (next < total) { const i = next++; await one(i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, worker));
  await closeDecoder();
  source.images = results.filter(Boolean);
  promoteGallery(source, rawDir, say, kinds);
  say(`그림 내려받기: ${ok}장 성공 · ${fail}장 실패 (${total}장 중)`);
  return { ok, fail };
}

// 받은 대표 사진이 2장 미만이면, 받은 상세 그림 중 정사각형에 가까운 것(제품 단독 컷 후보)을 갤러리로 올린다.
// 상세 HTML 의 그림은 크기를 모를 때가 많아 normalizeSource 단계에서는 못 하고, 받은 뒤 실제 w/h 로 한다. 파일은 g0N 으로 복사(상세 쪽은 그대로).
function promoteGallery(source, rawDir, say, kinds = "v2") {
  const imgs = source.images || [];
  const gal = imgs.filter((im) => normKind(im.kind) === "main");
  if (gal.length >= 2) return;
  const picked = fillGallery(gal.map((g) => ({ url: g.url, w: g.w, h: g.h })), imgs.filter((im) => normKind(im.kind) === "detail").map((d) => ({ url: d.url, w: d.w, h: d.h }))).slice(gal.length);
  if (!picked.length) return;
  const pad = (n) => String(n).padStart(2, "0");
  let n = Math.max(0, ...gal.map((g) => +g.id.slice(1) || 0));
  const add = [];
  for (const p of picked) {
    const d = imgs.find((im) => normKind(im.kind) === "detail" && im.url === p.url);
    if (!d) continue;
    const id = "g" + pad(++n), file = path.join(rawDir, id + path.extname(d.file));
    try { fs.copyFileSync(d.file, file); } catch { n--; continue; }
    add.push({ id, kind: kinds === "v1" ? "gallery" : "main", url: d.url, file, w: d.w, h: d.h, bytes: d.bytes, from: d.id });
    if (!(source.gallery || []).some((g) => g.url === d.url)) (source.gallery ||= []).push({ url: d.url, w: d.w, h: d.h, from: "detail" });
  }
  if (!add.length) return;
  const at = imgs.findIndex((im) => normKind(im.kind) !== "main");
  imgs.splice(at < 0 ? imgs.length : at, 0, ...add);
  say(`대표 사진이 ${gal.length}장뿐이라 상세 그림 중 정사각형 ${add.length}장(${add.map((a) => a.from).join(",")})을 대표 사진으로 올렸습니다`);
}

// ---- 📂 폴더로 만들기: 이미지 다운로더(Fatkun 등)로 받은 폴더를 그대로 DetailSource 로 ----
// 파일 이름 접두어로 분류(main-01 / SKU-01-옵션명 / detail-01). 폴더 이름(“… - 阿里巴巴”)이 상품명. 1688 접속 없음.
// jobDir 을 주면 raw/ 에 g01·o01·d01 이름으로 복사(webp·gif 는 png 로), 안 주면 원본 파일을 그대로 가리킨다.
// 반환: DetailSource (+ images 채움, source "folder"→"other", folder 경로). 그림이 하나도 없으면 { error }
export async function importFolder(dir, { jobDir = null, log = null, kinds = "v2" } = {}) {
  const say = (t) => { try { log && log(t); } catch {} };
  let names;
  try { names = await fs.promises.readdir(dir); } catch (e) { return { error: `폴더를 열 수 없습니다: ${e.message}` }; }
  const c = classifyFolderFiles(names);
  if (!c.main.length && !c.sku.length && !c.detail.length) {
    // 접두어가 하나도 없는 폴더: 그림 전부를 이름 순서대로 상세로 본다(정사각형은 아래 fillGallery 로 대표 사진 보충)
    c.detail = c.other.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((name, i) => ({ name, n: i + 1, label: "" }));
    c.other = [];
  }
  if (c.other.length) say(`폴더에서 분류 못 한 그림 ${c.other.length}장은 뺐습니다: ${c.other.slice(0, 5).join(", ")}`);
  const rawDir = jobDir ? path.join(jobDir, "raw") : null;
  if (rawDir) fs.mkdirSync(rawDir, { recursive: true });
  const pad = (n) => String(n).padStart(2, "0");
  const K = (k) => (kinds === "v1" ? KIND_V1[k] : k);
  const images = [], fail = [];
  const take = async (kind, prefix, list) => {
    let i = 0;
    for (const it of list) {
      const src = path.join(dir, it.name), id = prefix + pad(++i);
      try {
        const buf = await fs.promises.readFile(src);
        const { ext, bytes, w, h } = await decode(buf);
        let file = src;
        if (rawDir) { file = path.join(rawDir, `${id}.${ext}`); await fs.promises.writeFile(file, bytes); }
        else if (!/\.(jpe?g|png)$/i.test(src)) { file = path.join(os.tmpdir(), `seedhack-import-${process.pid}-${id}.${ext}`); await fs.promises.writeFile(file, bytes); }
        const rec = { id, kind: K(kind), url: pathToFileURL(src).href, file, w, h, bytes: bytes.length, name: it.name };
        if (kind === "sku") Object.assign(rec, skuLabel({ label_zh: it.label }));
        images.push(rec);
      } catch (e) { fail.push(it.name); say(`그림을 읽지 못함 ${it.name} (${String(e?.message || e).slice(0, 60)})`); }
    }
  };
  await take("main", "g", c.main); await take("sku", "o", c.sku); await take("detail", "d", c.detail);
  await closeDecoder();
  if (!images.length) return { error: "폴더에 쓸 수 있는 그림이 없습니다 (main-01.jpg · SKU-01-옵션명.jpg · detail-01.jpg 형식)" };
  // 옵션 그림이 대표 사진과 같은 파일이면 sameAs (Fatkun 은 1688 신형 화면에서 옵션 그림을 대표 사진 끝에도 넣는다)
  const sig = (im) => `${im.bytes}:${im.w}x${im.h}`;
  for (const s of images.filter((im) => normKind(im.kind) === "sku")) {
    const m = images.find((im) => normKind(im.kind) === "main" && sig(im) === sig(s) && fs.readFileSync(im.file).equals(fs.readFileSync(s.file)));
    if (m) s.sameAs = m.id;
  }
  const by = (k) => images.filter((im) => normKind(im.kind) === k);
  const source = normalizeSource({
    source: "other", url: pathToFileURL(dir).href, offerId: "", title_zh: titleFromFolder(path.basename(dir)),
    gallery: by("main").map((im) => ({ url: im.url, w: im.w, h: im.h })),
    options: by("sku").map((im) => ({ label_zh: im.label_zh || im.label, label_ko: im.label_ko, img: im.url })),
    detailImages: by("detail").map((im) => ({ url: im.url, w: im.w, h: im.h })),
    attrs: [], detailText_zh: "", shop: null, readAt: Date.now(),
  });
  // 폴더 이름이 한글(번역된 화면에서 받은 것)이면 title_ko 로도
  if (/[\uac00-\ud7a3]/.test(source.title_zh) && !/[\u4e00-\u9fff]/.test(source.title_zh)) source.title_ko = source.title_zh;
  source.folder = dir;
  source.images = images;
  if (by("main").length < 2) { if (rawDir) promoteGallery(source, rawDir, say, kinds); }
  say(`폴더에서 읽음: 대표 ${by("main").length} · 옵션 ${by("sku").length} · 상세 ${by("detail").length}${fail.length ? ` · 실패 ${fail.length}` : ""}`);
  return source;
}

// ---- 🛍 타오바오 참고 사진 합치기 (BENCHMARK-TEMPLATE-PLAN 2장 2순위) ----
// main.js tb:saveReviews 가 저장한 userData/taobao-reviews/<itemId>/review-NN.(jpg|png) 를 상세 재료로 붙인다 — 참고용·사용자 선택:
//   · 다른 판매자·구매자 사진이라 기본은 제외(확인 화면에서 켜서 쓴다, info.included), label "타오바오 참고", refOnly:true, from:"taobao"
//   · kind 는 detail 뿐(옵션·사이즈 섹션은 실사진만 — kind option 으로는 절대 넣지 않는다, 메모리 detail-real-image-first)
// 폴더 찾기: info.taobaoId → source.taobaoId → (source.source 가 taobao/tmall 이면 source.offerId). 없으면 null
export function taobaoPhotoDir(root, { source = {}, info = {} } = {}) {
  if (!root) return null;
  const ids = [info?.taobaoId, source?.taobaoId, /^(taobao|tmall)$/.test(String(source?.source || "")) ? source?.offerId : ""].map((x) => String(x || "").replace(/[^\w-]/g, "").slice(0, 30)).filter(Boolean);
  for (const id of ids) { const d = path.join(root, id); try { if (fs.statSync(d).isDirectory()) return d; } catch {} }
  return null;
}
export function listTaobaoPhotos(dir, { max = 12 } = {}) {
  let names = []; try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((f) => /^review-\d+\.(png|jpe?g|webp)$/i.test(f)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).slice(0, max).map((f) => path.join(dir, f));
}
// source.images 끝에 tNN 로 붙인다(raw/ 에 복사). 이미 붙어 있으면(from taobao) 건너뛴다 → { added, dir, skipped }
export async function mergeTaobaoPhotos(source, jobDir, { root = "", info = {}, log = null, kinds = "v2", max = 12 } = {}) {
  const say = (t) => { try { log && log(t); } catch {} };
  const dir = taobaoPhotoDir(root, { source, info }); if (!dir) return { added: 0, dir: null, skipped: "no-folder" };
  const imgs = Array.isArray(source.images) ? source.images : (source.images = []);
  if (imgs.some((im) => im?.from === "taobao")) return { added: 0, dir, skipped: "already" };
  const files = listTaobaoPhotos(dir, { max }); if (!files.length) return { added: 0, dir, skipped: "empty" };
  const rawDir = path.join(jobDir, "raw"); fs.mkdirSync(rawDir, { recursive: true });
  let n = 0;
  for (const f of files) {
    try {
      const buf = await fs.promises.readFile(f); const { ext, bytes, w, h } = await decode(buf);
      if (w < 300 || h < 300) continue; // 작은 썸네일은 재료가 못 된다
      const id = `t${String(++n).padStart(2, "0")}`, file = path.join(rawDir, `${id}.${ext}`);
      await fs.promises.writeFile(file, bytes);
      imgs.push({ id, kind: kinds === "v1" ? KIND_V1.detail : "detail", url: pathToFileURL(f).href, file, w, h, bytes: bytes.length, from: "taobao", refOnly: true, label_ko: "타오바오 참고", label: "타오바오 참고" });
    } catch (e) { say(`타오바오 사진을 읽지 못함 ${path.basename(f)} (${String(e?.message || e).slice(0, 60)})`); }
  }
  await closeDecoder();
  if (n) say(`🛍 타오바오 참고 사진 ${n}장 합침(기본 제외 — 확인 화면에서 켜서 씀) · ${dir}`);
  return { added: n, dir };
}
