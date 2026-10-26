// 레퍼런스 상세페이지 분석(1단계 POC) — 레퍼런스 이미지(폴더 또는 파일 목록, 나중에 쿠팡 버튼) → reference.json
//   ① 이어 붙여 그리기(숨은 창): 폭 390 으로 세로로 이어 붙여 픽셀 측정(바탕·어두운 띠·정보 판·브랜드 색·글자 색·여백)
//   ② OCR(macOS Vision, 한국어 ko-KR — 무료): 글자 상자 → 정렬(가운데/왼쪽)·제목 크기·표절 가드용 글 줄·근거 주장 후보
//   ③ 비전(Claude CLI, 기본 haiku — Read 로 시트 이미지 보기): 긴 상세를 4열 시트(열 = 원본 2400px)로 잘라 몇 장만 보여 주고
//      모양 판단(키커·띠·사진·강조·아이콘·정보 판·히어로) + 섹션 순서·설득 각도·카피 리듬을 엄격한 JSON 스키마로(자유 CSS 없음)
//   ④ reference-core normalizeTokens 로 custom 테마 손잡이 → reference.json { tokens, sections, copy, avoid, ocr_lines, measured, cost }
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runStructured } from "./cli.js";
import { normalizeTokens, refLinesFromOcr, claimsFromLines, REF_TYPES, TOKEN_ENUM, locateSections, styleFromSections } from "./reference-core.js";

const IMG_RE = /\.(png|jpe?g|webp)$/i;
const SW = 390;          // 측정용 폭
const SHEET_COL_W = 390, SHEET_COL_H = 1200, SHEET_COLS = 4; // 비전 시트: 열 폭 390(원본 780 의 1/2), 열 높이 1200 = 원본 2400px
const noop = () => {};

// 폴더 → 순서 있는 이미지 목록. order.txt(이름 공백 구분) 가 있으면 그 순서, 없으면 숫자 순. 썸네일·전체 합본은 뺀다. *detail_images 하위 폴더가 있으면 그쪽
export function listReferenceFiles(input) {
  if (Array.isArray(input)) return input.filter((f) => IMG_RE.test(f) && fs.existsSync(f));
  let dir = input;
  const sub = fs.readdirSync(dir, { withFileTypes: true }).find((d) => d.isDirectory() && /detail_images|detail$|상세/i.test(d.name));
  if (sub && !fs.readdirSync(dir).some((f) => IMG_RE.test(f) && !/thumb|full_part|합본/i.test(f))) dir = path.join(dir, sub.name);
  const all = fs.readdirSync(dir).filter((f) => IMG_RE.test(f) && !/thumb|thumbnail|full_part|합본|preview/i.test(f));
  const ord = path.join(dir, "order.txt");
  if (fs.existsSync(ord)) {
    const names = fs.readFileSync(ord, "utf8").trim().split(/\s+/);
    return names.map((n) => all.find((f) => f === n || f.replace(IMG_RE, "") === n)).filter(Boolean).map((f) => path.join(dir, f));
  }
  return all.sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((f) => path.join(dir, f));
}

// 숨은 창에 이미지를 폭 W 로 세로 이어 붙여 놓는다 → { win, total, offsets:[{file, y, h, w0, h0}] }
async function stackWindow(files, W, viewH) {
  const { BrowserWindow } = await import("electron");
  const win = new BrowserWindow({ show: false, width: W, height: viewH, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true, webSecurity: false } });
  const html = `<html><body style="margin:0;background:#fff;overflow:hidden"><div id="r" style="width:${W}px">${files.map((f) => `<img src="${pathToFileURL(f).href}" style="display:block;width:${W}px">`).join("")}</div></body></html>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await win.webContents.executeJavaScript(`Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r})))`);
  const info = await win.webContents.executeJavaScript(`({ total: document.getElementById("r").scrollHeight, imgs: [...document.images].map(i=>({ y: i.offsetTop, h: i.offsetHeight, w0: i.naturalWidth, h0: i.naturalHeight })) })`);
  return { win, total: info.total, offsets: info.imgs.map((x, i) => ({ file: files[i], ...x })) };
}
async function captureAt(win, y, H) {
  await win.webContents.executeJavaScript(`document.getElementById("r").style.transform="translateY(-${y}px)"`);
  await new Promise((r) => setTimeout(r, 160));
  return win.webContents.capturePage();
}

// ① 픽셀 측정 — 행마다 최빈색(채널 4비트 양자화)과 비율 → 평평한 줄(바탕)·어두운 띠, 평평한 고채도 픽셀 → 브랜드 색
export function measurePixels(rows, W, ocrBoxes = []) {
  // rows: { data(Uint8 BGRA), height } 묶음 배열(위→아래)
  const q = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); // 채널 5비트(연회색 판 #f2 와 흰 #fc 를 가르게)
  const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const rowMode = []; const binSum = new Map(); // bin → [r,g,b,n]
  const addBin = (k, r, g, b) => { const v = binSum.get(k) || [0, 0, 0, 0]; v[0] += r; v[1] += g; v[2] += b; v[3]++; binSum.set(k, v); };
  const hueBins = new Array(36).fill(0), hueCol = Array.from({ length: 36 }, () => new Map());
  let satTotal = 0, pixTotal = 0;
  const x0 = Math.round(W * 0.04), x1 = Math.round(W * 0.96);
  const inkPix = new Map(), ink2Pix = new Map();
  let gy = 0;
  const boxesByRow = ocrBoxes; // 전역 y(측정 폭 기준) 상자 [{x,y,w,h,small}]
  for (const chunk of rows) {
    const d = chunk.data;
    for (let y = 0; y < chunk.height; y++, gy++) {
      const hist = new Map();
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4, b = d[i], g = d[i + 1], r = d[i + 2];
        const k = q(r, g, b); hist.set(k, (hist.get(k) || 0) + 1);
        pixTotal++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / 255 : 0;
        if (sat >= 0.4 && mx >= 70 && x + 1 < W && y + 1 < chunk.height) { // 평평한(옆·아래와 같은) 고채도 픽셀만 — 사진 질감은 빠진다
          const j = i + 4, k2 = i + W * 4;
          if (Math.abs(d[j] - b) + Math.abs(d[j + 1] - g) + Math.abs(d[j + 2] - r) < 24 && Math.abs(d[k2] - b) + Math.abs(d[k2 + 1] - g) + Math.abs(d[k2 + 2] - r) < 24) {
            satTotal++;
            let hue; const c = mx - mn; if (mx === r) hue = ((g - b) / c) % 6; else if (mx === g) hue = (b - r) / c + 2; else hue = (r - g) / c + 4; hue = Math.floor(((hue * 60 + 360) % 360) / 10);
            hueBins[hue]++; const kk = q(r, g, b); const m = hueCol[hue]; const v = m.get(kk) || [0, 0, 0, 0]; v[0] += r; v[1] += g; v[2] += b; v[3]++; m.set(kk, v);
          }
        }
      }
      let best = 0, bk = 0; for (const [k, n] of hist) if (n > best) { best = n; bk = k; }
      rowMode.push({ k: bk, share: best / (x1 - x0) });
      // 모드 색 실제 평균(대표 몇 픽셀)
      for (let x = x0; x < x1; x += 7) { const i = (y * W + x) * 4; const k = q(d[i + 2], d[i + 1], d[i]); if (k === bk) addBin(k, d[i + 2], d[i + 1], d[i]); }
      // 글자 색: OCR 상자 안의 어두운/중간 픽셀
      for (const bx of boxesByRow) {
        if (gy < bx.y || gy >= bx.y + bx.h) continue;
        for (let x = Math.max(0, bx.x); x < Math.min(W, bx.x + bx.w); x++) {
          const i = (y * W + x) * 4, r = d[i + 2], g = d[i + 1], b = d[i]; const L = lum(r, g, b), k = q(r, g, b);
          const tgt = bx.small ? ink2Pix : inkPix;
          if ((bx.small ? L > 0.2 && L < 0.62 : L < 0.4) && (Math.max(r, g, b) - Math.min(r, g, b)) < 60) { const v = tgt.get(k) || [0, 0, 0, 0]; v[0] += r; v[1] += g; v[2] += b; v[3]++; tgt.set(k, v); }
        }
      }
    }
  }
  const hexOf = (v) => "#" + [v[0] / v[3], v[1] / v[3], v[2] / v[3]].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  const colorOfBin = (k) => { const v = binSum.get(k); return v && v[3] ? hexOf(v) : null; };
  const binLum = (k) => lum((k >> 10) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4);
  const N = rowMode.length;
  // 바탕: 평평한 줄(최빈색 90%+) 중 가장 많은 밝은 색
  const flatCnt = new Map(); for (const r of rowMode) if (r.share >= 0.85) flatCnt.set(r.k, (flatCnt.get(r.k) || 0) + 1);
  const flatSorted = [...flatCnt.entries()].sort((a, b) => b[1] - a[1]);
  const bgBin = (flatSorted.find(([k]) => binLum(k) > 0.5) || flatSorted[0] || [0xfff])[0];
  // 어두운 띠: 최빈색 비율 60%+ 이고 어두운 줄(브랜드 색 띠처럼 채도 높은 색은 제외). 그라데이션(진남 띠)은 줄마다 칸이 달라 칸 대신 무리(무채색/색 있는 어둠)로 모은다
  const binSat = (k) => { const c = [(k >> 10), (k >> 5) & 31, k & 31]; return (Math.max(...c) - Math.min(...c)) / 31; };
  const darkRows = rowMode.filter((r) => r.share >= 0.6 && binLum(r.k) < 0.2 && binSat(r.k) < 0.55);
  const grp = { neutral: [], tinted: [] }; for (const r of darkRows) grp[binSat(r.k) >= 0.13 ? "tinted" : "neutral"].push(r.k);
  const avgBins = (ks) => { const a = [0, 0, 0, 0]; for (const k of ks) { const v = binSum.get(k); if (v && v[3]) { a[0] += v[0] / v[3]; a[1] += v[1] / v[3]; a[2] += v[2] / v[3]; a[3]++; } } return a[3] ? hexOf(a) : null; };
  const darkMain = grp.tinted.length > grp.neutral.length * 0.6 ? "tinted" : "neutral";
  // 정보 판: 바탕이 아닌 평평한 밝은 무채색 줄(2% 이상)
  const semi = new Map(); for (const r of rowMode) if (r.share >= 0.5) semi.set(r.k, (semi.get(r.k) || 0) + 1);
  const panelBin = [...semi.entries()].sort((a, b) => b[1] - a[1]).find(([k, n]) => k !== bgBin && binLum(k) > 0.75 && n >= N * 0.02 && Math.abs(binLum(k) - binLum(bgBin)) > 0.02 && binSat(k) <= 0.07);
  // 여백: 바탕색 평평한 줄이 이어진 길이(측정 폭 기준) — 12px(780 기준) 이상인 것의 중앙값을 860 폭으로
  const runs = []; let run = 0; for (const r of rowMode) { if (r.share >= 0.985 && r.k === bgBin) run++; else { if (run) runs.push(run); run = 0; } } if (run) runs.push(run);
  const toRef = 780 / W, to860 = 860 / W;
  const big = runs.filter((n) => n * toRef >= 24).sort((a, b) => a - b);
  const gap = big.length ? big[Math.floor(big.length * 0.75)] * to860 : 0; // 블록 사이 여백(작은 줄 간격은 아래 75% 안에 묻힌다)
  const gapP = [0.5, 0.6, 0.75, 0.85, 0.9].map((q) => (big.length ? Math.round(big[Math.floor(big.length * q)] * to860) : 0));
  // 브랜드: 평평한 고채도 픽셀 색상환(10도 칸, 이웃 칸 합)에서 가장 많은 칸
  let bh = -1, bs = 0; for (let h = 0; h < 36; h++) { const s = hueBins[(h + 35) % 36] + hueBins[h] + hueBins[(h + 1) % 36]; if (s > bs) { bs = s; bh = h; } }
  let brand = null; if (bh >= 0 && bs) { let bv = null; for (const hh of [(bh + 35) % 36, bh, (bh + 1) % 36]) for (const v of hueCol[hh].values()) if (!bv || v[3] > bv[3]) bv = v; brand = bv ? hexOf(bv) : null; }
  const topOf = (m) => { let bv = null; for (const v of m.values()) if (!bv || v[3] > bv[3]) bv = v; return bv && bv[3] > 30 ? hexOf(bv) : null; };
  return {
    darkTop: [`tinted ${avgBins(grp.tinted)}:${(grp.tinted.length / N).toFixed(3)}`, `neutral ${avgBins(grp.neutral)}:${(grp.neutral.length / N).toFixed(3)}`],
    bg: colorOfBin(bgBin), dark: avgBins(grp[darkMain]), darkAlt: avgBins(grp[darkMain === "tinted" ? "neutral" : "tinted"]), darkRatio: Math.round((darkRows.length / Math.max(1, N)) * 1000) / 1000,
    panel: panelBin ? colorOfBin(panelBin[0]) : null, panelRatio: panelBin ? Math.round((panelBin[1] / N) * 1000) / 1000 : 0,
    brand, brandShare: Math.round((bs / Math.max(1, pixTotal)) * 10000) / 10000, satShare: Math.round((satTotal / Math.max(1, pixTotal)) * 10000) / 10000,
    _rows: rowMode.map((r) => ({ lum: Math.round(binLum(r.k) * 100) / 100, share: Math.round(r.share * 100) / 100, sat: Math.round(binSat(r.k) * 100) / 100 })),
    ink: topOf(inkPix), ink2: (() => { const t = topOf(ink2Pix); let n = 0, top = 0; for (const v of ink2Pix.values()) { n += v[3]; top = Math.max(top, v[3]); } return t && top >= n * 0.05 ? t : null; })(), gapPx: Math.round(gap), gapP, rows: N,
  };
}

// ② OCR 상자 → 정렬·제목 크기(860 폭 기준)
export function measureText(ocr, offsets, W) {
  const boxes = [];
  for (const im of ocr.images || []) {
    const o = offsets.find((x) => x.file === im.id); if (!o || !im.w) continue;
    const s = W / im.w;
    for (const b of im.boxes || []) if (/[가-힣A-Za-z0-9]/.test(b.text || "")) boxes.push({ x: b.x * s, y: o.y + b.y * s, w: b.w * s, h: b.h * s, rel: { x: b.x / im.w, w: b.w / im.w, h: b.h / im.w }, text: b.text, ko: /[가-힣]/.test(b.text) });
  }
  const txt = boxes.filter((b) => b.ko && b.rel.h >= 0.02 && b.rel.w < 0.92 && b.rel.w > 0.08);
  let center = 0, left = 0;
  for (const b of txt) { const cx = b.rel.x + b.rel.w / 2; if (Math.abs(cx - 0.5) < 0.05 && b.rel.x > 0.06) center++; else if (b.rel.x < 0.16 && cx < 0.45) left++; }
  const hs = boxes.filter((b) => b.ko).map((b) => b.rel.h).sort((a, b) => a - b);
  const p = (q) => (hs.length ? hs[Math.min(hs.length - 1, Math.floor(hs.length * q))] : 0);
  const med = p(0.5);
  return {
    align: { center, left }, titlePx: Math.round(p(0.7) * 860 * 0.95), bodyPx: Math.round(med * 860 * 0.82), hp: [0.5, 0.7, 0.8, 0.9, 0.95].map((q) => Math.round(p(q) * 860)),
    boxes: boxes.filter((b) => b.ko).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), small: b.rel.h <= med })),
  };
}

// ③ 비전 지시문·스키마(모양은 enum 으로만 — 자유 CSS 금지)
export const REF_VISION_SYSTEM = `당신은 쿠팡 상세페이지 아트디렉터 겸 카피 기획자입니다. 다른 회사의 잘 팔리는 상세페이지(레퍼런스)를 보고, 우리 상품 상세페이지를 같은 문법으로 만들기 위한 "디자인 손잡이"와 "설득 흐름"만 뽑습니다.
입력: 레퍼런스를 위에서 아래로 이어 붙여 4열로 자른 시트 이미지(열 번호 1,2,3… 순서 = 읽는 순서, 한 열이 끝나면 다음 열 맨 위로 이어짐)와 열별 OCR 글.
반드시 시트 파일을 모두 Read 로 열어 본 뒤 답합니다.
뽑을 것:
1) style: 주어진 선택지 중 가장 가까운 것 하나씩.
 - kicker: 섹션 머리의 작은 영문 라벨(POINT 1 등) 모양 — 없음 none / 어두운 알약 pill-dark / 브랜드 색 알약 pill-brand / 글자만 text
 - bands: 섹션 배경이 흰 ↔ 어두운 색으로 번갈아 바뀌는가(alternate) 아니면 대부분 한 색(none)
 - problem: 문제 제기(고객 고민) 부분 — 어두운 띠 + 말풍선 꼬리 dark-bubble / 바탕 그대로 글만 plain / 연한 판 panel
 - photo: 사진 — 가로 꽉 차게 full / 여백 안 둥근 모서리 rounded / 흰 카드 안 card
 - emph: 2줄 제목 강조 — 둘째 줄을 브랜드 색 line-color / 굵기만 weight / 형광 밑줄 underline / 없음 none
 - icons: 첫 화면 아래 특징 아이콘 띠 — 브랜드 색 바탕 brand-fill / 연한 바탕 light / 아이콘 없이 글자 한 줄 text-line / 없음 none
 - panel: 스펙·FAQ·주의 영역 — 가는 선 표 lines / 연회색 판 gray / 흰 카드 cards
 - hero: 첫 화면 글이 사진 위에 얹힘 on-photo / 사진 위쪽 바깥(글 → 사진) above
 - notice: 주의사항이 검정 섹션 dark / 바탕 그대로 same
 - brand_usage: 강조 색(브랜드 색)을 쓰는 곳 — 없음 none / 글자 강조에만 text / 띠·배지 면적까지 bands
 - align(center/left), spacing(tight/normal/airy: 블록 사이 여백), title_weight(600~900)
2) sections: 위→아래 섹션 순서. 섹션마다 our_type(가장 가까운 종류), role(이 섹션이 하는 일 한 줄), layout(배치 한 줄 — 예 "키커 알약 → 2줄 제목 → 사진 2분할"), kicker(보이는 영문 라벨 그대로, 없으면 ""), title(보이는 큰 제목 그대로 — 표절 검사용), angle(이 섹션이 고객을 설득하는 각도를 상품과 무관한 일반 표현으로: 예 "눈으로 보이는 전후 차이로 효과 증명", "일상 속 귀찮음 공감 → 질문으로 전환").
 our_type 기준: hero 첫 화면 / problem 고객 고민·질문 / before_after 전후 비교·차이 / checkpoint 제품 부위별 지시선 / feature 장점 하나(POINT) / options 규격·옵션 비교 / detail 소재·부품 클로즈업 / versatility 활용 장소·용도 격자 / size 사이즈 도면 / compare 구형 vs 신형 / steps 사용 방법 순서 / review 후기 / trust 인증·판매 실적·공식 스토어 / story 브랜드 이야기 / icons 아이콘 띠만 / notice 주의사항 / spec 제품 정보 표 / faq 자주 묻는 질문 / cta 구매 유도 / other
3) copy: title_len(제목 한 줄 평균 글자 수), two_line(2줄 제목이 기본인가), tone(말투 한 줄), kicker_words(키커 단어들), problem_frame(문제 제기 방식 일반화 — 예 "고민 4개 나열 → '한 번에 해결할 순 없을까?' 질문"), selling_points(파는 각도 4~8개, 상품과 무관한 일반 표현), chain(큰 제목만 이어 읽은 설득 흐름을 "공감 → 질문 → 해결 제품 → 차이 증명 → …" 처럼 일반화).
4) avoid: 레퍼런스에 있는 근거 주장 문구(판매 실적·순위·인증 번호·연구비·후기 수·공식 판매처 등) 그대로.
규칙: angle·selling_points·problem_frame·chain 에는 레퍼런스 상품 이름·고유 수치·고유 표현을 넣지 말고 어떤 상품에도 적용할 수 있게 일반화합니다. 응답은 JSON 만.`;
const o = (props, req = Object.keys(props)) => ({ type: "object", additionalProperties: false, required: req, properties: props });
const en = (k) => ({ type: "string", enum: TOKEN_ENUM[k] });
const str = { type: "string" };
export const REF_VISION_SCHEMA = o({
  style: o({ align: en("align"), spacing: en("spacing"), title_weight: { type: "integer", enum: [600, 700, 800, 900] }, kicker: en("kicker"), bands: en("bands"), problem: en("problem"), photo: en("photo"), emph: en("emph"), icons: en("icons"), panel: en("panel"), hero: en("hero"), notice: en("notice"), brand_usage: { type: "string", enum: ["none", "text", "bands"] } }),
  sections: { type: "array", minItems: 3, maxItems: 40, items: o({ order: { type: "integer" }, our_type: { type: "string", enum: REF_TYPES }, role: str, layout: str, kicker: str, title: str, angle: str }) },
  copy: o({ title_len: { type: "number" }, two_line: { type: "boolean" }, tone: str, kicker_words: { type: "array", maxItems: 8, items: str }, problem_frame: str, selling_points: { type: "array", minItems: 2, maxItems: 8, items: str }, chain: str }),
  avoid: { type: "array", maxItems: 16, items: str },
});

// 비전 시트 만들기: 이어 붙인 페이지를 열 높이 SHEET_COL_H 로 잘라 4열씩 한 장(열 위에 번호) → [{ file, cols:[{ n, y0, y1 }] }]
async function makeSheets(files, outDir) {
  const { BrowserWindow } = await import("electron");
  const st = await stackWindow(files, SHEET_COL_W, SHEET_COL_H);
  const total = st.total; st.win.destroy();
  const nCols = Math.ceil(total / SHEET_COL_H), sheets = [];
  const W = SHEET_COLS * (SHEET_COL_W + 10), H = SHEET_COL_H + 28;
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true, webSecurity: false } });
  const imgs = files.map((f) => `<img src="${pathToFileURL(f).href}" style="display:block;width:${SHEET_COL_W}px">`).join("");
  for (let s = 0; s * SHEET_COLS < nCols; s++) {
    const cols = [];
    for (let c = 0; c < SHEET_COLS && s * SHEET_COLS + c < nCols; c++) { const n = s * SHEET_COLS + c; cols.push({ n: n + 1, y0: n * SHEET_COL_H, y1: Math.min(total, (n + 1) * SHEET_COL_H) }); }
    const html = `<html><body style="margin:0;background:#777;display:flex;gap:10px;font:700 20px -apple-system">${cols.map((c) => `<div style="width:${SHEET_COL_W}px"><div style="height:28px;line-height:28px;background:#111;color:#ff0;padding-left:8px">${c.n}</div><div style="height:${SHEET_COL_H}px;overflow:hidden;background:#fff"><div style="transform:translateY(-${c.y0}px)">${imgs}</div></div></div>`).join("")}</body></html>`;
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await win.webContents.executeJavaScript(`Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r})))`);
    await new Promise((r) => setTimeout(r, 200));
    const f = path.join(outDir, `sheet-${String(s + 1).padStart(2, "0")}.jpg`);
    fs.writeFileSync(f, (await win.webContents.capturePage()).toJPEG(82));
    sheets.push({ file: f, cols });
  }
  win.destroy();
  return { sheets, total };
}

// 본체: files(순서) → reference.json 쓰기. model 기본 haiku(비용). vision:false 면 측정값만(무료)
// reuse: 지난 reference.json(비전 결과 재사용 — 측정·보정만 다시, 비용 0)
export async function buildReference({ input, outDir, model = process.env.SEEDHACK_REF_MODEL || "haiku", vision = true, reuse = null, log = noop, timeoutMs = 420000 } = {}) {
  const t0 = Date.now(), times = {}, files = listReferenceFiles(input);
  if (!files.length) return { error: "레퍼런스 이미지가 없습니다" };
  fs.mkdirSync(outDir, { recursive: true });
  log("dim", `  🧲 레퍼런스 ${files.length}장 분석 시작`);
  // ② OCR(한국어) — 무료
  let ta = Date.now();
  const { ocrImages } = await import("./ocr.js");
  const ocr = await ocrImages(files.map((f) => ({ id: f, file: f })), { langs: "ko-KR,en-US", log });
  times.ocrMs = Date.now() - ta;
  // ① 측정: 폭 SW 로 이어 붙여 2000px 씩 캡처
  ta = Date.now();
  const st = await stackWindow(files, SW, 2000);
  const text = measureText(ocr, st.offsets, SW);
  const chunks = [];
  for (let y = 0; y < st.total; y += 2000) { const im = await captureAt(st.win, y, 2000); const sz = im.getSize(); const h = Math.min(sz.height, st.total - y); const bm = im.toBitmap(); const w = sz.width; chunks.push({ data: bm, height: h, w }); }
  st.win.destroy();
  if (chunks[0] && chunks[0].w !== SW) log("dim", `  🧲 캡처 폭 ${chunks[0].w} ≠ ${SW} (배율) — 측정은 캡처 폭 기준`);
  const MW = chunks[0]?.w || SW, sc = MW / SW;
  const px = measurePixels(chunks, MW, text.boxes.map((b) => ({ ...b, x: Math.round(b.x * sc), y: Math.round(b.y * sc), w: Math.round(b.w * sc), h: Math.round(b.h * sc) })));
  times.measureMs = Date.now() - ta;
  const measured = { ...px, align: text.align, titlePx: text.titlePx, bodyPx: text.bodyPx, hp: text.hp, darkTop: px.darkTop, refHeight780: Math.round(st.total * 780 / SW), files: files.length };
  const lines = refLinesFromOcr({ images: ocr.images });
  // ③ 비전
  let v = null, cost = null, error = null;
  if (reuse?.sections?.length) { v = { style: reuse.style, sections: reuse.sections.map(({ y, bg, tx, tw, ...x }) => x), copy: reuse.copy, avoid: reuse.avoid }; cost = reuse.cost?.usd ?? null; times.visionMs = reuse.cost?.visionMs ?? null; log("dim", "  🧲 비전 결과 재사용"); }
  else if (vision) {
    ta = Date.now();
    const { sheets } = await makeSheets(files, outDir);
    times.sheetMs = Date.now() - ta; ta = Date.now();
    // 열별 OCR 글(시트 열 y 범위, 시트 폭 기준 = SW 와 같은 390)
    const allBoxes = []; for (const im of ocr.images) { const of = st.offsets.find((x) => x.file === im.id); if (!of || !im.w) continue; const s = SW / im.w; for (const b of im.boxes || []) if (/[가-힣A-Za-z]/.test(b.text)) allBoxes.push({ y: of.y + b.y * s, text: b.text }); }
    const L = [`레퍼런스 상세페이지 시트 ${sheets.length}장(총 ${sheets.reduce((n, s) => n + s.cols.length, 0)}열). 모두 Read 로 열어 보세요:`];
    for (const s of sheets) L.push(`- ${s.file} (열 ${s.cols.map((c) => c.n).join(",")})`);
    L.push("", "[열별 OCR 글(위→아래)]");
    for (const s of sheets) for (const c of s.cols) L.push(`열 ${c.n}: ${allBoxes.filter((b) => b.y >= c.y0 && b.y < c.y1).map((b) => b.text).join(" | ").slice(0, 700)}`);
    L.push("", `[측정값(참고)] 바탕 ${px.bg} · 어두운 띠 비율 ${px.darkRatio} · 브랜드 후보 ${px.brand}(${px.brandShare}) · 글 정렬 가운데 ${text.align.center}/왼쪽 ${text.align.left}`);
    const r = await runStructured({ purpose: "ref-vision", system: REF_VISION_SYSTEM, schema: REF_VISION_SCHEMA, text: L.join("\n"), model, timeoutMs, allowedTools: ["Read"] });
    times.visionMs = Date.now() - ta;
    if (r?.ok) { v = r.result; cost = r.costUsd ?? null; } else { error = r?.error || "비전 결과 없음"; log("warn", `△ 🧲 레퍼런스 비전 실패 → 측정값만 (${error})`); }
  }
  // 섹션 제목을 OCR 상자에서 찾아 그 자리 바탕(어두운 띠·사진 위·밝은 바탕)을 잰다 → 비전 판단 보정(sectionsWithBg / styleFromSections)
  const rows = px._rows; delete px._rows; delete measured._rows;
  const gb = []; for (const im of ocr.images) { const of = st.offsets.find((x) => x.file === im.id); if (!of || !im.w) continue; const s = SW / im.w; for (const b of im.boxes || []) if (/[가-힣A-Za-z]/.test(b.text)) gb.push({ y: of.y + b.y * s, h: b.h * s, x: b.x / im.w, w: b.w / im.w, text: b.text }); }
  const sections = locateSections(v?.sections || [], gb, rows, sc);
  const style = styleFromSections(sections, v?.style || {});
  const tokens = normalizeTokens(measured, style);
  const avoid = [...new Set([...(v?.avoid || []), ...claimsFromLines(lines)])].slice(0, 16);
  const ref = { version: 1, createdAt: Date.now(), source: { files: files.map((f) => path.basename(f)), dir: path.dirname(files[0]) }, tokens, style: v?.style || null, styleFixed: style, sections, copy: v?.copy || {}, avoid, ocr_lines: lines, measured,
    cost: { usd: cost, model: vision ? `cli:${model}` : null, ms: Date.now() - t0, ...times }, error };
  fs.writeFileSync(path.join(outDir, "reference.json"), JSON.stringify(ref, null, 2));
  log("go", `■ 레퍼런스 분석 · ${((Date.now() - t0) / 1000).toFixed(1)}초${cost != null ? ` · $${Number(cost).toFixed(3)}` : ""} · 섹션 ${ref.sections.length}개 · 손잡이 ${tokens.align}/${tokens.kicker}/${tokens.bands}/${tokens.photo}`);
  return ref;
}
