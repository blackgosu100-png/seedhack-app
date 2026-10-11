// ⑧ 렌더 — PagePlan(plan.json) 을 HTML 템플릿(780px)에 꽂아 오프스크린 창에서 섹션별로 캡처한다
// 결과: out/01.jpg … (가로 780 · 세로 ≤ 3000 · JPG 88) + out/preview.png(1/4 축소 한 장) + out/page.html + out/figma-manifest.json + out/figma-bundle.json
// 규약: docs/detail/CONTRACTS.md 8절. 템플릿: src/renderer/detail-templates/<id>/index.html (전역 renderPlan(plan, baseUrl))
import { BrowserWindow, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, "../../renderer/detail-templates");
export const WIDTH = 780;            // 쿠팡 상세 이미지 가로(기본)
export const WIDTHS = [780, 860];    // 860 = 네이버·자사몰 옵션(plan.meta.width)
export const DEFAULT_WIDTH = { card: 860 }; // 템플릿별 기본 폭(plan.meta.width 가 있으면 그것)
export const widthOf = (plan, templateId) => (WIDTHS.includes(Number(plan?.meta?.width)) ? Number(plan.meta.width) : (DEFAULT_WIDTH[templateId] || WIDTH));
// plan 이미지 경로 → 실제 파일: jobDir 상대경로가 기본, 절대경로면 그대로(레퍼런스 폴더를 직접 가리키는 샘플)
export const resolveImage = (jobDir, rel) => (path.isAbsolute(rel) ? rel : path.join(jobDir, rel));
export const MAX_SLICE = 3000;       // 슬라이스 한 장 최대 세로
export const MAX_BYTES = 10 * 1024 * 1024; // 슬라이스 한 장 최대 용량
export const JPG_QUALITY = 88;
export const TEMPLATES = [
  { id: "clean", name: "클린", desc: "화이트 바탕 · 초록 포인트 · 둥근 카드 — 생활용품·주방·육아" },
  { id: "dark", name: "다크", desc: "검정·차콜 · 금색 포인트 · 프리미엄 — 전자·가죽·선물" },
  { id: "pop", name: "팝", desc: "밝은 컬러 블록 · 큰 숫자 · 활기 — 잡화·문구·취미" },
  { id: "localize", name: "원본 한글화", desc: "v6 — 원본 상세 이미지를 순서대로 두고 중국어 자리에 같은 느낌의 한글을 얹는다(+ 새 메인컷·주의·스펙 카드, 테마 공유)" },
  { id: "card", name: "카드", desc: "Moast 결과 톤(v5) — 아이보리 · 흰 둥근 카드 · 장면 히어로 + 아이콘 띠 · BEFORE/AFTER · CHECKPOINT · 2×2 활용 · 확대 원 디테일 (860 기본)" },
  { id: "editorial", name: "에디토리얼", desc: "디자이너 실작업 톤(v3) — 꽉 찬 사진 · 영문 세리프 타이틀 · 키워드 표 · 리뷰 · CHECK POINT 지시선 · POINT 알약 라벨" },
  { id: "studio", name: "스튜디오", desc: "제품 사진 팔레트로 색을 맞추는 v2 — 누끼 무대 · 라인 아이콘 · 공감→해법→증거 구조" },
];
// v5 테마: card 레이아웃 엔진 위에 느낌만 바꾸는 CSS(themes/<id>.css). plan.meta.version===5 이고 templateId 가 이 이름(또는 card)이면 card 엔진 + 테마
export const THEMES = [
  { id: "ivory", name: "아이보리", desc: "기본 — 아이보리 배경 · 흰 둥근 카드 · 브라운 포인트 (Moast 톤)" },
  { id: "clean", name: "클린", desc: "흰 배경 · 초록 포인트 · 얇은 선 · 그림자 없는 카드" },
  { id: "dark", name: "다크", desc: "차콜 배경 · 흰 글자 · 금색 포인트 · 짙은 회색 카드" },
  { id: "pop", name: "팝", desc: "밝은 컬러 블록 교대 · 큰 숫자 라벨 · 둥근 알약" },
  { id: "editorial", name: "에디토리얼", desc: "연회색 · 영문 세리프 키커 · 카드 없이 꽉 찬 사진 · 키워드 표" },
  { id: "studio", name: "스튜디오", desc: "제품 팔레트 그라데이션 배경 · 부드러운 그림자 · 라인 아이콘 강조" },
  { id: "commerce", name: "커머스", desc: "쿠팡 레퍼런스 문법 — 브랜드 색 1개 · POINT 키커 알약 · 2줄 제목 둘째 줄 강조 · 흰↔진남 교대 · 용도 격자 · 검정 주의" },
  { id: "branden", name: "브랜든 스타일", desc: "국내 브랜드 미니멀 문법 — 흰 바탕 · 글→사진 교대 · 왼쪽 정렬 짧은 제목 + 2줄 설명 · 꽉 찬 사진 · 연회색 정보 판 · 색·키커·그림자 없음" },
  { id: "custom", name: "내 템플릿(레퍼런스)", desc: "레퍼런스 상세페이지에서 뽑은 손잡이(plan.meta.refTokens) — 색·정렬·여백·키커·띠·사진·강조·정보 판" },
];
export const THEME_IDS = THEMES.map((t) => t.id);
// 템플릿 id → { engine, theme }: v5 plan 은 card 엔진 + 테마, 그 밖은 기존 템플릿 그대로
export function routeTemplate(plan, templateId) {
  const want = templateId || plan?.meta?.templateId;
  // v6 원본 한글화: mode "localize" 이면 localize 엔진(card 테마 공유). templateId 가 테마 이름이면 그 테마
  if (plan?.meta?.mode === "localize" || want === "localize" || plan?.meta?.templateId === "localize") { // 원본 한글화 plan(templateId localize)을 테마 이름으로 다시 그려도 localize 엔진
    const theme = THEME_IDS.includes(plan?.meta?.theme) ? plan.meta.theme : THEME_IDS.includes(want) ? want : "ivory";
    return { engine: "localize", theme };
  }
  if (Number(plan?.meta?.version) === 5 && (want === "card" || THEME_IDS.includes(want))) {
    const theme = THEME_IDS.includes(plan?.meta?.theme) && (want === "card" || !want) ? plan.meta.theme : want === "card" ? (THEME_IDS.includes(plan?.meta?.theme) ? plan.meta.theme : "ivory") : want;
    return { engine: "card", theme };
  }
  if (want === "card") return { engine: "card", theme: THEME_IDS.includes(plan?.meta?.theme) ? plan.meta.theme : "ivory" };
  return { engine: TEMPLATES.some((t) => t.id === want) ? want : (TEMPLATES.some((t) => t.id === plan?.meta?.templateId) ? plan.meta.templateId : "clean"), theme: null };
}
// 기존 TEMPLATES 각 항목에 v5(카드 엔진)에서의 테마 설명을 붙인다(화면 템플릿 고르기용)
for (const t of TEMPLATES) { const th = THEMES.find((x) => x.id === t.id); if (th) t.v5 = th.desc; }
export const templateDir = (id) => path.join(TEMPLATE_DIR, TEMPLATES.some((t) => t.id === id) ? id : "clean");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 오프스크린 창: 화면에 보이지 않고 GPU 없이 그린다. 세로가 모니터보다 커도 되게 enableLargerThanScreen
export function openOffscreen(width = WIDTH, height = 1200, extra = {}) {
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, enableLargerThanScreen: true, frame: false, resizable: true, ...extra,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, webSecurity: true },
  });
  win.webContents.setFrameRate(10);
  return win;
}

// 창 크기를 바꾸고 스크롤한 뒤 새 프레임이 그려질 때까지 기다린다(offscreen 'paint' 이벤트 또는 rAF 두 번)
async function settle(win, scrollY, height, width = WIDTH) {
  const wc = win.webContents;
  const [cw, ch] = win.getContentSize();
  if (cw !== width || ch !== height) win.setContentSize(width, height);
  await wc.executeJavaScript(`(async () => { window.scrollTo(0, ${scrollY}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return window.scrollY; })()`);
  await new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; wc.removeListener("paint", fin); res(); } }; wc.once("paint", fin); setTimeout(fin, 400); });
  await wait(60);
}

// 캡처 → 가로가 정확히 width 인 nativeImage (레티나 등 배율이 다르면 축소 보정)
export async function captureExact(win, rect) {
  let img = await win.webContents.capturePage(rect);
  const sz = img.getSize();
  if (sz.width !== rect.width || sz.height !== rect.height) {
    if (!sz.width || !sz.height) throw new Error(`캡처 결과가 비었습니다 (${sz.width}x${sz.height})`);
    img = img.resize({ width: rect.width, height: rect.height, quality: "best" });
  }
  return img;
}

// 섹션 목록 → 슬라이스 계획: 섹션을 이어 붙이되 한 장 ≤ MAX_SLICE, 섹션 중간에서 자르지 않는다
// 섹션 하나가 MAX_SLICE 를 넘으면 그 섹션만 단독으로 두고 MAX_SLICE 단위로 나눈다
export function planSlices(sections, docHeight, max = MAX_SLICE) {
  const secs = sections.map((s, i) => ({ ...s, end: i + 1 < sections.length ? sections[i + 1].y : docHeight })).filter((s) => s.end > s.y);
  const slices = []; let cur = null;
  for (const s of secs) {
    const len = s.end - s.y;
    if (len > max) { // 큰 섹션: 단독 슬라이스, 필요하면 분할 — 템플릿이 준 블록 경계(breaks) 중 가장 먼 곳에서 자른다(사진 중간 자르기 방지)
      if (cur) { slices.push(cur); cur = null; }
      const breaks = (Array.isArray(s.breaks) ? s.breaks : []).filter((b) => b > s.y && b < s.end);
      for (let y = s.y; y < s.end;) {
        let next = Math.min(y + max, s.end);
        if (next < s.end) { const ok = breaks.filter((b) => b > y + 400 && b <= y + max); if (ok.length) next = ok[ok.length - 1]; }
        slices.push({ y, h: next - y, sections: [s.type] }); y = next;
      }
      continue;
    }
    if (cur && s.end - cur.y <= max) { cur.h = s.end - cur.y; cur.sections.push(s.type); }
    else { if (cur) slices.push(cur); cur = { y: s.y, h: len, sections: [s.type] }; }
  }
  if (cur) slices.push(cur);
  return slices;
}

// 같은 가로의 비트맵을 세로로 이어 붙인다(미리보기 한 장 만들기)
function stackImages(images) {
  const w = images[0].getSize().width;
  const bufs = images.map((im) => im.toBitmap());
  const h = images.reduce((n, im) => n + im.getSize().height, 0);
  return nativeImage.createFromBitmap(Buffer.concat(bufs), { width: w, height: h });
}

const mimeOf = (f) => ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" })[path.extname(f).toLowerCase()] || "application/octet-stream";

/**
 * renderPlan({ plan, jobDir, templateId, onProgress, log })
 *  → { slices:[{file,w,h,bytes,sections}], preview, html, figmaManifest, figmaBundle, totalHeight, sections, check }
 * 이미지 경로는 jobDir 기준 상대경로(plan 그대로). 결과 파일 경로도 jobDir 기준 상대경로("out/01.jpg").
 */
export async function renderPlan({ plan, jobDir, templateId, onProgress, log } = {}) {
  if (!plan || !Array.isArray(plan.sections)) throw new Error("plan.sections 가 없습니다");
  if (!jobDir) throw new Error("jobDir 가 없습니다");
  const say = (m) => { try { if (typeof log === "function") log("detail", m); } catch {} };
  const prog = (done, total, msg) => { try { onProgress?.({ step: "render", done, total, msg }); } catch {} };
  const route = routeTemplate(plan, templateId);
  const tid = route.engine, theme = route.theme;
  if (theme) plan = { ...plan, meta: { ...(plan.meta || {}), theme } }; // card 엔진이 읽는 테마
  let prepNote = null;
  if (tid === "card") { const r = preferFullImages(plan, jobDir); plan = r.plan; if (r.notes.length) { prepNote = `잘린 사진 → 전체본 ${r.notes.length}장 (${r.notes.join(", ")})`; say(prepNote); } }
  if (tid === "localize") { const r = prepareLocalize(plan, jobDir); plan = r.plan; prepNote = r.note; say(`원본 한글화: ${r.note}`); }
  const tdir = templateDir(tid);
  const outDir = path.join(jobDir, "out");
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^\d+\.jpg$/.test(f)) fs.rmSync(path.join(outDir, f), { force: true }); // 이전 슬라이스 정리
  const baseUrl = pathToFileURL(path.join(jobDir, "/")).href; // 끝에 / 가 붙은 jobDir 주소

  const W = widthOf(plan, tid);
  const win = openOffscreen(W);
  const wc = win.webContents;
  const errors = [];
  wc.on("console-message", (e) => { if (e.level === "error" || e.level === 3) errors.push(e.message || String(e)); });
  try {
    prog(0, 1, `템플릿 '${tid}' 여는 중`);
    await win.loadFile(path.join(tdir, "index.html"));
    // 사진 가장자리 평균색(사진 상자 배경용) — 화면 쪽 canvas 가 file:// 보안으로 막힐 때의 대비
    const edgeColors = edgeColorsOf(plan, jobDir);
    const subjectBoxes = subjectBoxesOf(plan, jobDir);
    // plan 이 가리키는데 디스크에 없는 이미지(자체 점검이 "파일 없음"과 "그리지 못함"을 나눠 알린다)
    const missingFiles = [...new Set(JSON.stringify(plan.sections).match(/"[^"]+\.(?:png|jpe?g|webp|gif)"/gi) || [])].map((q) => JSON.parse(q)).filter((v) => !/^(https?|data):/i.test(v) && !fs.existsSync(resolveImage(jobDir, v))); // checkpoint 사진의 제품 영역(빈 벽이 크면 제품 기준으로 자르기)
    // 템플릿의 renderPlan 실행 → ready 대기 (이미지 decode 포함)
    const sections = await wc.executeJavaScript(`(async () => {
      const t0 = Date.now();
      window.__edgeColors = ${JSON.stringify(edgeColors)};
      window.__subjectBoxes = ${JSON.stringify(subjectBoxes)};
      window.__missingFiles = ${JSON.stringify(missingFiles)};
      await window.renderPlan(${JSON.stringify(plan)}, ${JSON.stringify(baseUrl)});
      while (document.body.dataset.ready !== "1" && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 50));
      return window.SeedhackRender.sections();
    })()`);
    if (!sections.length) throw new Error("그릴 섹션이 없습니다(모든 섹션이 비어 있음)");
    const docHeight = await wc.executeJavaScript("Math.round(document.documentElement.scrollHeight)");
    const check = await wc.executeJavaScript("window.SeedhackRender.check()");
    const layers = await wc.executeJavaScript("window.SeedhackRender.layers()");
    const slicesPlan = planSlices(sections, docHeight);
    say(`렌더: 템플릿 ${tid} · 섹션 ${sections.length}개 · 전체 ${docHeight}px · 슬라이스 ${slicesPlan.length}장`);

    // 슬라이스 캡처
    const slices = [], thumbs = [];
    for (let i = 0; i < slicesPlan.length; i++) {
      const s = slicesPlan[i];
      prog(i, slicesPlan.length, `${i + 1}/${slicesPlan.length} 장 캡처 중 (${s.sections.join("·")})`);
      await settle(win, s.y, s.h, W);
      const img = await captureExact(win, { x: 0, y: 0, width: W, height: s.h });
      let q = JPG_QUALITY, jpg = img.toJPEG(q);
      while (jpg.length > MAX_BYTES && q > 40) { q -= 10; jpg = img.toJPEG(q); } // 10MB 상한(실제로는 1~2MB 수준)
      const name = String(i + 1).padStart(2, "0") + ".jpg";
      fs.writeFileSync(path.join(outDir, name), jpg);
      slices.push({ file: path.posix.join("out", name), w: W, h: s.h, bytes: jpg.length, quality: q, sections: s.sections });
      thumbs.push(img.resize({ width: Math.round(W / 4), quality: "good" }));
    }
    // 미리보기: 전체를 1/4 로 축소한 한 장
    const preview = stackImages(thumbs);
    fs.writeFileSync(path.join(outDir, "preview.png"), preview.toPNG());

    // page.html: 그려진 DOM + 템플릿 CSS 를 한 파일로(이미지는 ../ 상대경로 → 브라우저로 바로 열어 볼 수 있다)
    const bodyHtml = await wc.executeJavaScript("document.getElementById('page').outerHTML");
    const fontsDir = pathToFileURL(path.join(TEMPLATE_DIR, "../fonts/")).href;
    const css = [
      fs.readFileSync(path.join(TEMPLATE_DIR, "../fonts.css"), "utf8").replace(/url\("fonts\//g, `url("${fontsDir}`),
      fs.readFileSync(path.join(TEMPLATE_DIR, "common/base.css"), "utf8"),
      tid === "localize" ? fs.readFileSync(path.join(TEMPLATE_DIR, "card", "style.css"), "utf8") : "", // localize 는 card 스타일 위에
      fs.readFileSync(path.join(tdir, "style.css"), "utf8"),
      theme && theme !== "ivory" && fs.existsSync(path.join(TEMPLATE_DIR, "card", "themes", theme + ".css")) ? fs.readFileSync(path.join(TEMPLATE_DIR, "card", "themes", theme + ".css"), "utf8") : "",
    ].join("\n");
    const html = `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(plan.product?.name_ko || "상세페이지")}</title>\n<style>\n${css}\n</style></head>\n<body data-template="${tid}"${theme ? ` data-theme="${theme}"` : ""} data-ready="1">\n${bodyHtml.split(baseUrl).join("../")}\n</body></html>\n`;
    fs.writeFileSync(path.join(outDir, "page.html"), html);

    // 피그마: manifest(레이어 이름 → 값) + bundle(manifest + 이미지 base64)
    const assets = [...new Set(layers.flatMap((s) => Object.values(s.layers)).filter((v) => typeof v === "string" && /\.(png|jpe?g|webp|gif)$/i.test(v) && fs.existsSync(resolveImage(jobDir, v))))];
    const manifest = { template: tid, theme: theme || undefined, width: W, product: plan.product || {}, sections: layers.map((s) => ({ type: s.type, n: s.n, layers: s.layers })), assets, slices: slices.map((s) => s.file) };
    fs.writeFileSync(path.join(outDir, "figma-manifest.json"), JSON.stringify(manifest, null, 2));
    const images = {};
    for (const a of assets) {
      const file = resolveImage(jobDir, a);
      let buf = fs.readFileSync(file), mime = mimeOf(file);
      let w = 0, h = 0; try { ({ width: w, height: h } = nativeImage.createFromBuffer(buf).getSize()); } catch {}
      // 묶음이 너무 커지지 않게: 가로 1600 넘는 사진·1.5MB 넘는 JPG 는 1600 폭 JPG(88) 로 줄여 넣는다(투명 PNG 는 그대로)
      try {
        const im = nativeImage.createFromBuffer(buf);
        if (mime !== "image/png" && (w > 1600 || buf.length > 1.5 * 1024 * 1024)) { const r = w > 1600 ? im.resize({ width: 1600, quality: "best" }) : im; buf = r.toJPEG(88); ({ width: w, height: h } = r.getSize()); mime = "image/jpeg"; }
        else if (mime === "image/png" && w > 1600) { const r = im.resize({ width: 1600, quality: "best" }); buf = r.toPNG(); ({ width: w, height: h } = r.getSize()); }
      } catch {}
      images[a] = { mime, w, h, base64: buf.toString("base64") };
    }
    fs.writeFileSync(path.join(outDir, "figma-bundle.json"), JSON.stringify({ version: 1, app: "seedhack", createdAt: Date.now(), manifest, images }));
    prog(slicesPlan.length, slicesPlan.length, "렌더 완료");
    say(`렌더 완료: ${slices.length}장, 미리보기·page.html·피그마 묶음 저장 (${outDir})`);
    return { template: tid, theme, slices, preview: "out/preview.png", html: "out/page.html", figmaManifest: "out/figma-manifest.json", figmaBundle: "out/figma-bundle.json",
      width: W, totalHeight: docHeight, sections, check, consoleErrors: errors, ...(prepNote ? { prepare: prepNote } : {}) };
  } finally {
    await closeWindow(win);
  }
}

// plan 이 가리키는 이미지마다 가장자리 20px 평균색 → { "clean/g01.png": "rgb(r, g, b)" }
// 사진 속 제품 영역 추정(0~1 비율 {x,y,w,h}): 가장자리 세기(가로·세로 밝기 차) 지도에서
// 화면 폭 대부분을 가로지르는 줄(벽·바닥 경계선)은 빼고, 남은 경계 화소의 4~96% 분위 범위를 제품 상자로 본다.
// 우선순위: plan 섹션의 bbox/cutout_bbox(있으면 템플릿이 직접 사용) > 이 추정. 대상: checkpoint 섹션 사진만(비용 절약)
export function subjectBox(file) {
  const img = nativeImage.createFromPath(file);
  let { width: w, height: h } = img.getSize(); if (!w || !h) return null;
  const S = Math.min(1, 320 / Math.max(w, h)), sw = Math.max(8, Math.round(w * S)), sh = Math.max(8, Math.round(h * S));
  const bmp = (S < 1 ? img.resize({ width: sw, height: sh, quality: "good" }) : img).toBitmap();
  const L = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) L[i] = 0.114 * bmp[i * 4] + 0.587 * bmp[i * 4 + 1] + 0.299 * bmp[i * 4 + 2]; // BGRA
  const E = new Uint8Array(sw * sh), T = 30; // 벽·바닥의 은은한 그림자 경계는 빼고 제품 윤곽만
  const rowCnt = new Uint32Array(sh);
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
    const i = y * sw + x, g = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + sw] - L[i - sw]);
    if (g > T) { E[i] = 1; rowCnt[y]++; }
  }
  const xs = [], ys = [];
  for (let y = 1; y < sh - 1; y++) {
    if (rowCnt[y] > sw * 0.7) continue; // 벽·바닥 경계 같은 긴 가로줄
    for (let x = 1; x < sw - 1; x++) if (E[y * sw + x]) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 40) return null;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (arr, t) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * t)))];
  const x0 = q(xs, 0.04) / sw, x1 = q(xs, 0.96) / sw, y0 = q(ys, 0.03) / sh, y1 = q(ys, 0.97) / sh;
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return null;
  return { x: +x0.toFixed(4), y: +y0.toFixed(4), w: +(x1 - x0).toFixed(4), h: +(y1 - y0).toFixed(4) };
}
export function subjectBoxesOf(plan, jobDir) {
  const out = {};
  for (const s of plan.sections || []) {
    if (!/^(checkpoint|before_after|hero|feature|feature2|options|detail|versatility)$/.test(s.type)) continue; // 제품이 잘리지 않게 위치를 잡을 사진들
    for (const v of [s.image, s.cutout, ...(Array.isArray(s.images) ? s.images : []), ...(Array.isArray(s.items) ? s.items.map((it) => it && it.image) : [])]) {
      if (typeof v !== "string" || !/\.(png|jpe?g|webp)$/i.test(v) || out[v]) continue;
      try { const b = subjectBox(resolveImage(jobDir, v)); if (b) out[v] = b; } catch {}
    }
  }
  return out;
}

// 사진 위쪽 frac(30%) 의 "복잡도": 가장자리 세기 화소 비율(지운 글자 자리 상자 exclude 는 빼고). 낮을수록 글자 여백으로 쓸 만하다
export function topBusy(file, { frac = 0.3, exclude = [] } = {}) {
  const img = nativeImage.createFromPath(file);
  const { width: w, height: h } = img.getSize(); if (!w || !h) return 1;
  const S = Math.min(1, 320 / w), sw = Math.round(w * S), sh = Math.max(8, Math.round(h * frac * S)), fullH = Math.round(h * S);
  const bmp = img.resize({ width: sw, height: fullH, quality: "good" }).toBitmap();
  const L = (x, y) => { const i = (y * sw + x) * 4; return 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]; };
  const ex = exclude.map((b) => ({ x0: b.x * S - 2, y0: b.y * S - 2, x1: (b.x + b.w) * S + 2, y1: (b.y + b.h) * S + 2 }));
  let e = 0, n = 0;
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
    if (ex.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) continue;
    n++; if (Math.abs(L(x + 1, y) - L(x - 1, y)) + Math.abs(L(x, y + 1) - L(x, y - 1)) > 30) e++;
  }
  return n ? e / n : 1;
}
// 원본 한글화 plan 손질(렌더 직전, plan 파일은 바꾸지 않음):
//  hero 사진 위쪽이 복잡하면(제품이 위까지 차 있음) → 앞쪽 image 섹션 중 "글자가 위 30% 안에만 있고 위쪽이 깨끗한" 것(배너 지운 상세 첫 장)을 hero 사진으로 쓰고 그 섹션은 뺀다(중복 금지).
//  그런 사진이 없으면 hero.band = true(글자를 사진 위 단색 띠에).
export const BUSY_MAX = 0.06;
// 레이어 뒤 바탕색(under)이 없으면 지운 이미지에서 글자 상자 안·둘레 평균으로 잰다(글자색 대비 보정·자체 점검용)
function fillUnder(sec, jobDir) {
  if (sec.type !== "image" || !sec.image || !Array.isArray(sec.layers) || !sec.layers.some((l) => l && !(l.style && (l.style.under || l.style.bg || l.style.fill)))) return sec;
  let img; try { img = nativeImage.createFromPath(resolveImage(jobDir, sec.image)); } catch { return sec; }
  const { width: W, height: H } = img.getSize(); if (!W) return sec;
  const bmp = img.toBitmap(), hex = (v) => "#" + v.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  const avg = (x, y, w, h) => { let r = 0, g = 0, b = 0, n = 0; const add = (px, py) => { if (px < 0 || py < 0 || px >= W || py >= H) return; const i = (py * W + px) * 4; b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2]; n++; };
    for (let k = Math.round(x); k < x + w; k += 2) { add(k, Math.round(y + h / 2)); add(k, Math.round(y + 3)); add(k, Math.round(y + h - 3)); } return n ? hex([r / n, g / n, b / n]) : null; };
  return { ...sec, layers: sec.layers.map((l) => (!l || (l.style && (l.style.under || l.style.bg || l.style.fill)) ? l : { ...l, style: { ...(l.style || {}), under: avg(l.x, l.y, l.w, l.h) || "#ffffff" } })) };
}
export function prepareLocalize(plan, jobDir) {
  const secs = (plan.sections || []).map((s) => fillUnder({ ...s }, jobDir));
  plan = { ...plan, sections: secs };
  const hi = secs.findIndex((s) => s.type === "hero"); if (hi < 0) return { plan, note: "hero 없음" };
  const hero = secs[hi];
  const busy = (rel, ex) => { try { return topBusy(resolveImage(jobDir, rel), { exclude: ex || [] }); } catch { return 1; } };
  const hb = hero.image ? busy(hero.image) : 1;
  if (hero.image && hb <= BUSY_MAX && !hero.text_zone) return { plan, note: `hero 사진 위쪽 깨끗(${hb.toFixed(3)})` };
  if (hero.text_zone) return { plan, note: "hero text_zone 지정됨" };
  for (let i = 0; i < Math.min(secs.length, hi + 5); i++) {
    const s = secs[i]; if (s.type !== "image" || !s.image) continue;
    let ih = Number(s.h || s.ih) || 0, iw = Number(s.w || s.iw) || 0; const ls = (s.layers || []).filter((l) => l && !l.drop);
    if (!ih) { try { const sz = nativeImage.createFromPath(resolveImage(jobDir, s.image)).getSize(); ih = sz.height; iw = sz.width; } catch {} } // 크기 없으면 파일에서
    if (!ih || !ls.length || ls.some((l) => l.y + l.h > ih * 0.3)) continue; // 글자가 위 30% 안에만 있는 장(배너형)
    const zoneB = Math.max(...ls.map((l) => l.y + l.h)) + 24;
    let b; try { b = topBusy(resolveImage(jobDir, s.image), { frac: Math.min(0.32, zoneB / ih), exclude: ls }); } catch { b = 1; } // 새 타이틀이 들어갈 띠(원래 글자 자리 + 24px)만 본다
    if (b > BUSY_MAX) continue;
    const pill = ls.find((l) => l.style && (l.style.radius === "pill" || l.style.border));
    const nh = { ...hero, image: s.image, w: iw || undefined, h: ih, text_zone: { y0: 0, y1: Math.max(...ls.map((l) => l.y + l.h)) + 24 },
      points: hero.points || (pill ? String(pill.ko || "").split(/\s*[|│]\s*/).filter(Boolean).slice(0, 3) : undefined),
      accent: hero.accent || (pill?.style?.border ? (/#[0-9a-f]{6}/i.exec(pill.style.border) || [])[0] : undefined) || (ls[0].style && ls[0].style.color) };
    try { // 새 타이틀 바탕색(대비 점검·글자색 보정용) = 글자 띠 평균
      const im = nativeImage.createFromPath(resolveImage(jobDir, s.image)), { width: W2 } = im.getSize(), bm = im.toBitmap();
      let r = 0, g = 0, bb = 0, n = 0; for (let y = 4; y < zoneB; y += 6) for (let x = 0; x < W2; x += 6) { const k = (y * W2 + x) * 4; bb += bm[k]; g += bm[k + 1]; r += bm[k + 2]; n++; }
      if (n) nh.bg = "#" + [r / n, g / n, bb / n].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    } catch {}
    if (nh.bg && !nh.fill) nh.fill = nh.bg; // 원래 글자를 지운 자리(평평한 덮개 흔적)를 새 타이틀 띠로 부드럽게 덮는다(아래로 흐려짐)
    secs[hi] = nh; secs.splice(i, 1);
    return { plan: { ...plan, sections: secs }, note: `hero 사진 교체: ${hero.image || "-"}(위쪽 복잡도 ${hb.toFixed(3)}) → ${s.image}(${b.toFixed(3)}), 그 섹션은 뺌` };
  }
  secs[hi] = { ...hero, band: true };
  return { plan: { ...plan, sections: secs }, note: `hero 위쪽이 복잡(${hb.toFixed(3)})하고 대체 사진 없음 → 글자를 단색 띠에` };
}

// 잘린 사진 대신 전체본: clean/<id>.png 의 제품이 아래 끝에 닿아 잘려 있고(제품 상자 아래 ≥ 90% — 추정 상자는 4~96% 분위라 아래 끝이 잘린 사진은 0.9 이상) clean/<id>_full.png 가 있으면 전체본으로 바꾼다
export function preferFullImages(plan, jobDir) {
  const notes = [];
  const swap = (v) => {
    if (typeof v !== "string" || !/^clean\/[^/]+\.png$/.test(v) || /_full\.png$/.test(v)) return v;
    const full = v.replace(/\.png$/, "_full.png");
    if (!fs.existsSync(resolveImage(jobDir, full))) return v;
    try { const b = subjectBox(resolveImage(jobDir, v)); if (b && b.y + b.h >= 0.9) { notes.push(`${v}→${full}`); return full; } } catch {}
    return v;
  };
  const sections = (plan.sections || []).map((s) => {
    if (!/^(hero|feature|feature2|options|detail|checkpoint)$/.test(s.type) || s.focus) return s; // plan 이 제품 위치(focus)를 준 사진은 그대로
    const o = { ...s };
    if (o.image) o.image = swap(o.image);
    if (Array.isArray(o.images)) o.images = o.images.map(swap);
    if (Array.isArray(o.items)) o.items = o.items.map((it) => (it && it.image ? { ...it, image: swap(it.image) } : it));
    return o;
  });
  return { plan: { ...plan, sections }, notes };
}

export function edgeColorsOf(plan, jobDir) {
  const out = {};
  const files = new Set();
  for (const s of plan.sections || []) {
    for (const v of [s.image, ...(Array.isArray(s.images) ? s.images : []), ...(Array.isArray(s.items) ? s.items.map((it) => it && it.image) : [])])
      if (typeof v === "string" && /\.(png|jpe?g|webp|gif)$/i.test(v)) files.add(v);
  }
  for (const rel of files) {
    try {
      const img = nativeImage.createFromPath(resolveImage(jobDir, rel));
      const { width: w, height: h } = img.getSize(); if (!w || !h) continue;
      const bmp = img.toBitmap(), b = Math.max(1, Math.min(20, Math.floor(Math.min(w, h) / 4)));
      let r = 0, g = 0, bl = 0, n = 0;
      const px = (x, y) => { const i = (y * w + x) * 4; bl += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2]; n++; }; // BGRA
      for (let y = 0; y < h; y++) {
        const edgeRow = y < b || y >= h - b;
        for (let x = 0; x < w; x++) if (edgeRow || x < b || x >= w - b) px(x, y);
      }
      if (n) out[rel] = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(bl / n)})`;
      { // 위쪽 왼편 띠(위 20줄 · 왼쪽 60%) 평균 — 에디토리얼 히어로가 "배경 늘리기" 색으로 쓴다
        let r2 = 0, g2 = 0, b2 = 0, n2 = 0;
        for (let y = 0; y < Math.min(20, h); y++) for (let x = 0; x < Math.floor(w * 0.6); x++) { const i = (y * w + x) * 4; b2 += bmp[i]; g2 += bmp[i + 1]; r2 += bmp[i + 2]; n2++; }
        if (n2) out[rel + "#top"] = `rgb(${Math.round(r2 / n2)}, ${Math.round(g2 / n2)}, ${Math.round(b2 / n2)})`;
      }
    } catch {}
  }
  return out;
}

// 창 닫기: destroy() 로 바로 지우면 다음 오프스크린 창의 렌더러가 죽는다(ERR_FAILED) → close() 후 'closed' 를 기다린다
export async function closeWindow(win) {
  if (!win || win.isDestroyed()) return;
  await new Promise((res) => { const t = setTimeout(() => { try { win.destroy(); } catch {} res(); }, 1500); win.once("closed", () => { clearTimeout(t); res(); }); try { win.close(); } catch { clearTimeout(t); res(); } });
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
