// 이미지 가공 순수 로직 — BGRA Buffer + width/height 만 다룬다(Electron 없음, node --test 로 검증).
// 비트맵 형식: { data: Buffer(BGRA, 픽셀당 4바이트), w, h }  (nativeImage.toBitmap() 과 같은 배열)
// 하는 일: 글자 상자 둘레의 배경을 추정하고(단색·그라데이션·사진 판별), 상자를 배경으로 메운다.

// ---- 글자 ----
const CJK = /[㐀-䶿一-鿿豈-﫿　-〿＀-￯]/; // 한자·CJK 기호·전각 기호
export const hasCJK = (text) => CJK.test(String(text || ""));
// 공백을 뺀 글자 중 CJK 비율(0~1). 빈 문자열은 0.
export function cjkRatio(text) {
  const chars = Array.from(String(text || "").replace(/\s+/g, ""));
  if (!chars.length) return 0;
  let n = 0;
  for (const c of chars) if (CJK.test(c)) n++;
  return n / chars.length;
}

// ---- 사각형 ----
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
// 상자를 pad 만큼 키우고 이미지 안으로 자른다. 결과가 비면 w/h 가 0.
export function expandRect(rect, pad = 4, imgW = Infinity, imgH = Infinity) {
  const x0 = clampInt(rect.x - pad, 0, imgW), y0 = clampInt(rect.y - pad, 0, imgH);
  const x1 = clampInt(rect.x + rect.w + pad, 0, imgW), y1 = clampInt(rect.y + rect.h + pad, 0, imgH);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
const near = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
// 겹치거나 gap 픽셀 안에 붙어 있는 상자를 하나로 합친다(이음새 없이 한 번에 메우려고).
// 반환: [{ x, y, w, h, text(공백으로 이음), conf(최소), latin(모두 latin일 때), members:[원래 index…] }]
export function mergeBoxes(boxes, gap = 6) {
  let groups = (boxes || []).map((b, i) => ({ x: b.x, y: b.y, w: b.w, h: b.h, text: String(b.text || ""), conf: b.conf ?? 1, latin: !!b.latin, members: [i] }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (!near(groups[i], groups[j], gap)) continue;
        const a = groups[i], b = groups[j];
        groups[i] = { ...union(a, b), text: `${a.text} ${b.text}`.trim(), conf: Math.min(a.conf, b.conf), latin: a.latin && b.latin, members: a.members.concat(b.members) };
        groups.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return groups.map((g) => ({ ...g, members: g.members.sort((p, q) => p - q) }));
}

// ---- 픽셀 ----
const px = (bm, x, y) => (y * bm.w + x) * 4;
const avg = (list) => { // [[b,g,r],…] → [b,g,r]
  if (!list.length) return null;
  const s = [0, 0, 0];
  for (const c of list) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }
  return [s[0] / list.length, s[1] / list.length, s[2] / list.length];
};
const colorAt = (bm, x, y) => { const i = px(bm, x, y); return [bm.data[i], bm.data[i + 1], bm.data[i + 2]]; };
export const toHex = (c) => "#" + [c[2], c[1], c[0]].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join(""); // [b,g,r] → "#rrggbb"

// 상자 둘레 ring 픽셀로 배경을 추정한다.
// 반환: { color:[b,g,r](둘레 평균), variance(둘레 전체 표준편차), roughness(이웃 픽셀 간 평균 차이), samples,
//         gradient: { left:[행마다 [b,g,r]|null], right:[…], top:[열마다 …], bottom:[…] } }
// - variance 는 전체 둘레의 색 퍼짐(그라데이션이면 커질 수 있다), roughness 는 "울퉁불퉁함"(사진·노이즈면 크다).
export function estimateBackground(bm, rect, ring = 4) {
  const W = bm.w, H = bm.h;
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(W, rect.x + rect.w), y1 = Math.min(H, rect.y + rect.h);
  const left = [], right = [], top = [], bottom = [];
  const all = [];
  let rough = 0, roughN = 0;
  const band = (ax, ay, bx, by) => { // [ax,bx)×[ay,by) 띠의 픽셀을 모으고 이웃 차이를 더한다
    for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) {
      const c = colorAt(bm, x, y);
      all.push(c);
      if (x + 1 < bx) { const d = colorAt(bm, x + 1, y); rough += Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) + Math.abs(c[2] - d[2]); roughN++; }
      if (y + 1 < by) { const d = colorAt(bm, x, y + 1); rough += Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) + Math.abs(c[2] - d[2]); roughN++; }
    }
  };
  const lx0 = Math.max(0, x0 - ring), rx1 = Math.min(W, x1 + ring);
  const ty0 = Math.max(0, y0 - ring), by1 = Math.min(H, y1 + ring);
  if (lx0 < x0) band(lx0, y0, x0, y1);
  if (x1 < rx1) band(x1, y0, rx1, y1);
  if (ty0 < y0) band(lx0, ty0, rx1, y0); // 위·아래 띠는 모서리까지 포함
  if (y1 < by1) band(lx0, y1, rx1, by1);
  for (let y = y0; y < y1; y++) {
    const l = [], r = [];
    for (let x = lx0; x < x0; x++) l.push(colorAt(bm, x, y));
    for (let x = x1; x < rx1; x++) r.push(colorAt(bm, x, y));
    left.push(avg(l)); right.push(avg(r));
  }
  for (let x = x0; x < x1; x++) {
    const t = [], b = [];
    for (let y = ty0; y < y0; y++) t.push(colorAt(bm, x, y));
    for (let y = y1; y < by1; y++) b.push(colorAt(bm, x, y));
    top.push(avg(t)); bottom.push(avg(b));
  }
  const color = avg(all) || [255, 255, 255];
  let v = 0;
  for (const c of all) v += (c[0] - color[0]) ** 2 + (c[1] - color[1]) ** 2 + (c[2] - color[2]) ** 2;
  const variance = all.length ? Math.sqrt(v / all.length / 3) : 0;
  const roughness = roughN ? rough / roughN / 3 : 0;
  // mismatch: 마주보는 띠(위↔아래, 왼쪽↔오른쪽)의 색 차이가 위치마다 얼마나 흔들리는지(채널 평균 표준편차).
  // 단색·그라데이션·색 경계(단차)는 차이가 일정해 ≈0, 대리석·타일 무늬는 열마다 달라 커진다 → 보간하면 세로 줄무늬로 뿌옇게 번지는 배경을 걸러낸다
  const mis = (a, b) => {
    const d = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] && b[i]) d.push([a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]]);
    if (d.length < 4) return 0;
    let s = 0;
    for (let ch = 0; ch < 3; ch++) { const m = d.reduce((x, c) => x + c[ch], 0) / d.length; s += Math.sqrt(d.reduce((x, c) => x + (c[ch] - m) ** 2, 0) / d.length); }
    return s / 3;
  };
  const mismatch = Math.max(mis(top, bottom), mis(left, right));
  return { color, variance, roughness, mismatch, samples: all.length, gradient: { left, right, top, bottom } };
}

// 지울지 말지. 단색·완만한 그라데이션 → "erase", 사진·노이즈·복잡한 무늬 → "keep".
// roughness(이웃 차이)가 작으면 매끈한 배경. variance 는 그라데이션 때문에 어느 정도 허용하되 너무 크면 사진으로 본다.
// mismatch(마주보는 띠의 어긋남)가 크면 둘레는 매끈해 보여도 대리석·타일 같은 저대비 무늬 → 보간하면 줄무늬로 번지므로 keep(사진 위 글자로 두고 한글 띠로 덮는다).
//   실제 1688 상품(948424797701) 기준: 대리석 벽 상자 5~21, 매끈한 그라데이션·단색 상자 0~4.6 → 경계 5.
export const ERASE_RULE = { roughness: 6, variance: 48, mismatch: 5 };
export function decideErase(stats, rule = ERASE_RULE) {
  if (!stats || !stats.samples) return "keep";
  if (stats.roughness > rule.roughness) return "keep";
  if (stats.variance > rule.variance) return "keep";
  if ((stats.mismatch || 0) > (rule.mismatch ?? Infinity)) return "keep";
  return "erase";
}

// 상자 영역을 메운다. mode "interp": 행별로 왼쪽·오른쪽 둘레 색을 선형 보간(그라데이션에 자연스럽다), "solid": 단색.
// stats 가 없으면 estimateBackground 로 계산한다. 반환: 메운 픽셀 수.
export function eraseRect(bm, rect, mode = "interp", stats = null, ring = 4) {
  const W = bm.w, H = bm.h;
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(W, Math.round(rect.x + rect.w)), y1 = Math.min(H, Math.round(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return 0;
  const st = stats || estimateBackground(bm, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, ring);
  const base = st.color;
  const { left, right, top, bottom } = st.gradient;
  let n = 0;
  const span = Math.max(1, x1 - x0 - 1);
  const vspan = Math.max(1, y1 - y0 - 1);
  for (let y = y0; y < y1; y++) {
    const L = left[y - y0], R = right[y - y0];
    for (let x = x0; x < x1; x++) {
      let c;
      if (mode === "solid" || (!L && !R && !top.length)) c = base;
      else {
        // 가로 보간(왼쪽↔오른쪽). 한쪽만 있으면 그 색.
        const t = (x - x0) / span;
        let hcol = null;
        if (L && R) hcol = [L[0] + (R[0] - L[0]) * t, L[1] + (R[1] - L[1]) * t, L[2] + (R[2] - L[2]) * t];
        else hcol = L || R;
        // 세로 보간(위↔아래)도 있으면 섞는다 — 세로 그라데이션·모서리 상자에 자연스럽다
        const T = top[x - x0], B = bottom[x - x0];
        let vcol = null;
        const s = (y - y0) / vspan;
        if (T && B) vcol = [T[0] + (B[0] - T[0]) * s, T[1] + (B[1] - T[1]) * s, T[2] + (B[2] - T[2]) * s];
        else vcol = T || B;
        if (hcol && vcol) {
          // 폭이 넓은 상자(글 한 줄)는 가로 보간이 멀어서 부정확 → 세로 비중을 높인다
          const wh = x1 - x0, hh = y1 - y0;
          const kv = wh / (wh + hh); // 넓을수록 세로 보간 비중↑
          c = [hcol[0] * (1 - kv) + vcol[0] * kv, hcol[1] * (1 - kv) + vcol[1] * kv, hcol[2] * (1 - kv) + vcol[2] * kv];
        } else c = hcol || vcol || base;
      }
      const i = px(bm, x, y);
      bm.data[i] = Math.round(c[0]); bm.data[i + 1] = Math.round(c[1]); bm.data[i + 2] = Math.round(c[2]); bm.data[i + 3] = 255;
      n++;
    }
  }
  return n;
}

// 상자 영역의 평균 색과 기준색의 평균 차이(0~255). 검증용.
export function meanDiff(bm, rect, color) {
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y), x1 = Math.min(bm.w, rect.x + rect.w), y1 = Math.min(bm.h, rect.y + rect.h);
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const c = colorAt(bm, x, y);
    s += (Math.abs(c[0] - color[0]) + Math.abs(c[1] - color[1]) + Math.abs(c[2] - color[2])) / 3;
    n++;
  }
  return n ? s / n : 0;
}

// 글자 상자 목록을 받아 비트맵을 제자리에서 지운다(cleanImage 의 핵심, 순수 함수).
// 반환: { erased, kept, boxesOut:[{ ...box, action:"erased"|"kept", bg:"#rrggbb", onPhoto:bool }] }
export function cleanBitmap(bm, boxes, { pad = 4, ring = 4, gap = 6, rule = ERASE_RULE } = {}) {
  const groups = mergeBoxes(boxes, gap);
  const out = (boxes || []).map((b) => ({ ...b }));
  let erased = 0, kept = 0;
  for (const g of groups) {
    const rect = expandRect(g, pad, bm.w, bm.h);
    if (!rect.w || !rect.h) { for (const i of g.members) { out[i].action = "kept"; out[i].bg = "#ffffff"; out[i].onPhoto = false; kept++; } continue; }
    const st = estimateBackground(bm, rect, ring);
    const decision = decideErase(st, rule);
    const bg = toHex(st.color);
    if (decision === "erase") { eraseRect(bm, rect, "interp", st, ring); erased += g.members.length; }
    else kept += g.members.length;
    for (const i of g.members) { out[i].action = decision === "erase" ? "erased" : "kept"; out[i].bg = bg; out[i].onPhoto = decision !== "erase"; }
  }
  return { erased, kept, boxesOut: out };
}

// 테스트·샘플용: 단색 비트맵 만들기 ([b,g,r])
export function makeBitmap(w, h, color = [255, 255, 255]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = color[0]; data[i * 4 + 1] = color[1]; data[i * 4 + 2] = color[2]; data[i * 4 + 3] = 255; }
  return { data, w, h };
}
export function fillRect(bm, rect, color) {
  for (let y = Math.max(0, rect.y); y < Math.min(bm.h, rect.y + rect.h); y++) for (let x = Math.max(0, rect.x); x < Math.min(bm.w, rect.x + rect.w); x++) {
    const i = px(bm, x, y); bm.data[i] = color[0]; bm.data[i + 1] = color[1]; bm.data[i + 2] = color[2]; bm.data[i + 3] = 255;
  }
}

// ---- 보완 1차: 가장자리 빈 여백 자르기 · 가장자리 글자 띠 자르기 ----
// 한 줄(행 또는 열)이 기준색과 "거의 같은지": tol 을 넘는 픽셀이 전체의 0.5% 이하면 배경으로 본다.
function lineIsBg(bm, isRow, idx, ref, tol) {
  const n = isRow ? bm.w : bm.h;
  let bad = 0;
  const limit = Math.max(1, Math.floor(n * 0.005));
  for (let k = 0; k < n; k++) {
    const i = isRow ? px(bm, k, idx) : px(bm, idx, k);
    const d = (Math.abs(bm.data[i] - ref[0]) + Math.abs(bm.data[i + 1] - ref[1]) + Math.abs(bm.data[i + 2] - ref[2])) / 3;
    if (d > tol) { bad++; if (bad > limit) return false; }
  }
  return true;
}
const lineAvg = (bm, isRow, idx) => { // 행/열 평균색
  const n = isRow ? bm.w : bm.h, s = [0, 0, 0];
  for (let k = 0; k < n; k++) { const i = isRow ? px(bm, k, idx) : px(bm, idx, k); s[0] += bm.data[i]; s[1] += bm.data[i + 1]; s[2] += bm.data[i + 2]; }
  return [s[0] / n, s[1] / n, s[2] / n];
};

// 가장자리(위/아래/좌/우)에서 그 가장자리 평균색과 tol 이내인 행·열을 찾아 잘라낼 사각형을 돌려준다.
// minKeep 픽셀 여백은 남기고, 한 방향 최대 maxCut 비율까지만 자른다. 남는 영역이 너무 작거나(한 변 < 2*minKeep) 자를 게 없으면 trimmed:false.
// 전부 배경(지우고 나니 아무것도 없는 이미지)이면 blank:true 를 함께 준다(자르지는 않는다).
export function findTrimRect(bm, { tol = 10, minKeep = 24, maxCut = 0.6 } = {}) {
  const W = bm.w, H = bm.h;
  const full = { x: 0, y: 0, w: W, h: H, trimmed: false };
  if (!W || !H) return full;
  const scan = (isRow, fromStart) => { // 배경인 줄 수(연속)
    const n = isRow ? H : W, lim = Math.floor(n * maxCut);
    const ref = lineAvg(bm, isRow, fromStart ? 0 : n - 1);
    let c = 0;
    while (c < lim && lineIsBg(bm, isRow, fromStart ? c : n - 1 - c, ref, tol)) c++;
    return Math.max(0, c - minKeep);
  };
  let top = scan(true, true), bottom = scan(true, false), left = scan(false, true), right = scan(false, false);
  const blank = top + minKeep >= Math.floor(H * maxCut) && bottom + minKeep >= Math.floor(H * maxCut); // 위·아래 모두 한계까지 배경 = 내용이 없는 빈 이미지
  if (H - top - bottom < 2 * minKeep) { top = 0; bottom = 0; }
  if (W - left - right < 2 * minKeep) { left = 0; right = 0; }
  if (!top && !bottom && !left && !right) return { ...full, blank };
  return { x: left, y: top, w: W - left - right, h: H - top - bottom, trimmed: true, blank };
}

// kept(onPhoto) 상자가 위쪽 25% 또는 아래쪽 25% 안에만 있으면 그 띠를 잘라낼 범위를 정한다.
// 반환: { bandCut, cutTop(위에서 자를 픽셀), cutBottom(아래에서 자를 픽셀) }. 가운데(25~75%)에 kept 상자가 하나라도 있으면 bandCut:false.
export function bandCutRect(boxesOut, w, h, { zone = 0.25, pad = 6, minRemain = 0.4 } = {}) {
  const kept = (boxesOut || []).filter((b) => b.action === "kept" || b.onPhoto);
  const none = { bandCut: false, cutTop: 0, cutBottom: 0 };
  if (!kept.length || !h) return none;
  const topZone = h * zone, botZone = h * (1 - zone);
  let maxTop = 0, minBottom = h, mid = false;
  for (const b of kept) {
    const y0 = b.y, y1 = b.y + b.h;
    if (y1 <= topZone) maxTop = Math.max(maxTop, y1);
    else if (y0 >= botZone) minBottom = Math.min(minBottom, y0);
    else { mid = true; break; }
  }
  if (mid) return none;
  const cutTop = maxTop ? Math.min(h, Math.round(maxTop + pad)) : 0;
  const cutBottom = minBottom < h ? Math.min(h, Math.round(h - minBottom + pad)) : 0;
  if (h - cutTop - cutBottom < h * minRemain) return none;
  return { bandCut: true, cutTop, cutBottom };
}

// 상자 좌표를 잘라낸 사각형 기준으로 옮긴다. 완전히 밖이면 버리고, 걸치면 안쪽만 남긴다.
export function shiftBoxes(boxes, rect) {
  const out = [];
  for (const b of boxes || []) {
    const x0 = Math.max(b.x, rect.x), y0 = Math.max(b.y, rect.y);
    const x1 = Math.min(b.x + b.w, rect.x + rect.w), y1 = Math.min(b.y + b.h, rect.y + rect.h);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue; // 잘려 나간 상자
    out.push({ ...b, x: x0 - rect.x, y: y0 - rect.y, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

// 비트맵에서 사각형만 잘라 새 비트맵으로
export function cropBitmap(bm, rect) {
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const w = Math.max(1, Math.min(bm.w - x0, rect.w)), h = Math.max(1, Math.min(bm.h - y0, rect.h));
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) bm.data.copy(data, y * w * 4, ((y0 + y) * bm.w + x0) * 4, ((y0 + y) * bm.w + x0 + w) * 4);
  return { data, w, h };
}

// 내용 비율: 가장자리(네 변) 평균 배경색과 tol 이상 다른 픽셀의 비율(0~1). step 픽셀 간격으로 띄엄띄엄 세어 빠르다.
// 글자만 있던 이미지를 지우면 ≈0, 사진은 크다 → plan-core 가 "빈 이미지" 를 거르는 데 쓴다.
export function contentRatio(bm, { tol = 14, step = 8 } = {}) {
  const W = bm.w, H = bm.h;
  if (!W || !H) return 0;
  const edges = [lineAvg(bm, true, 0), lineAvg(bm, true, H - 1), lineAvg(bm, false, 0), lineAvg(bm, false, W - 1)];
  const ref = avg(edges);
  let n = 0, diff = 0;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const i = px(bm, x, y);
    const d = (Math.abs(bm.data[i] - ref[0]) + Math.abs(bm.data[i + 1] - ref[1]) + Math.abs(bm.data[i + 2] - ref[2])) / 3;
    if (d >= tol) diff++;
    n++;
  }
  return n ? diff / n : 0;
}

// ---- 상품 셀 지도(productMask) ----
// 격자(grid px) 칸마다 "이미지 테두리 평균색과 뚜렷이 다른(ΔE ≥ tol) 픽셀 비율"을 재어 minFrac 이상이면 상품 칸으로 본다.
// 상세 이미지의 벽·바탕은 테두리 색과 비슷하고(그늘진 벽도 ΔE 40~65 쯤), 상품(검정 프레임·옷·사람)은 크게 다르다(ΔE 100+) → tol 70.
// 반환: { grid, cols, rows, cells: Uint8Array(1=상품), count(상품 칸 수), frac(상품 칸 비율 0~1), rect(상품 칸 경계 사각형, px) | null, ref:[b,g,r] }
// 흰 바탕에 흰 상품처럼 색으로 구분이 안 되면 count 0 — 그때 findPhotoRegion 은 예전 점수(면적×내용)로 고른다.
export function productMask({ w, h, bitmap, grid = 16, tol = 70, minFrac = 0.3, step = 2 } = {}) {
  const none = { grid, cols: 0, rows: 0, cells: new Uint8Array(0), count: 0, frac: 0, rect: null, ref: null };
  if (!w || !h || !bitmap) return none;
  const cols = Math.ceil(w / grid), rows = Math.ceil(h / grid);
  const edge = [];
  for (let x = 0; x < w; x += step) { edge.push(colorAt(bitmap, x, 0)); edge.push(colorAt(bitmap, x, h - 1)); }
  for (let y = 0; y < h; y += step) { edge.push(colorAt(bitmap, 0, y)); edge.push(colorAt(bitmap, w - 1, y)); }
  const ref = avg(edge) || [255, 255, 255];
  const cells = new Uint8Array(cols * rows);
  let count = 0, x0 = cols, y0 = rows, x1 = -1, y1 = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let n = 0, hit = 0;
    for (let y = r * grid; y < Math.min(h, (r + 1) * grid); y += step) for (let x = c * grid; x < Math.min(w, (c + 1) * grid); x += step) {
      const i = px(bitmap, x, y);
      if ((Math.abs(bitmap.data[i] - ref[0]) + Math.abs(bitmap.data[i + 1] - ref[1]) + Math.abs(bitmap.data[i + 2] - ref[2])) / 3 >= tol) hit++;
      n++;
    }
    if (n && hit / n >= minFrac) { cells[r * cols + c] = 1; count++; x0 = Math.min(x0, c); y0 = Math.min(y0, r); x1 = Math.max(x1, c); y1 = Math.max(y1, r); }
  }
  const rect = count ? { x: x0 * grid, y: y0 * grid, w: Math.min(w, (x1 + 1) * grid) - x0 * grid, h: Math.min(h, (y1 + 1) * grid) - y0 * grid } : null;
  return { grid, cols, rows, cells, count, frac: count / (cols * rows), rect, ref };
}

// ---- 재설계: 글자 없는 "사진 영역" 찾기 ----
// 중국 상세 이미지는 한쪽에 큰 글자·장식, 나머지에 제품 사진이 있다. 글자를 지우는 대신 글자 상자가 없는 가장 좋은 직사각형을 찾아 잘라낸다.
// 격자(grid px)에 글자 상자(+pad)를 칠하고, 빈 칸만으로 된 극대 직사각형(히스토그램 방식)을 모두 뽑아
// 점수: 상품 셀(productMask)이 있으면 상품 칸 수 − 0.3 × 그 밖의 칸 수(상품이 있는 쪽을 고르고 벽·빈 바탕은 덜 넣는다),
//       상품 셀이 없으면(흰 바탕 흰 상품 등) 예전처럼 면적 × (0.3 + contentRatio).
// 조건: 면적 ≥ minArea(30%), 가로 ≥ minW(55%)(세로로 긴 이미지는 세로 ≥55%·가로 ≥35% 도 허용), contentRatio ≥ minContent(0.12).
// 상품 셀이 있는데 가장 좋은 후보에 상품 칸이 전체의 productShare(30%) 미만이면(글자 밑에 깔린 상품, 벽만 남는 후보) null — 호출자는 자르지 말고 전체본을 쓴다. 글자 상자가 0개면 상품 점수를 쓰지 않는다(전체).
// product: productMask 결과를 미리 넘기면 다시 재지 않는다(false 면 상품 점수 안 씀).
// 반환: { rect, contentRatio, coverage, product:{ cells(후보 안 상품 칸), total, frac } | null } 또는 null. 글자 상자가 0개면 전체가 후보(장식은 못 걸러도 그대로).
export function findPhotoRegion({ w, h, boxes, bitmap, grid = 16, pad = 6, minArea = 0.3, minW = 0.55, minContent = 0.12, tol = 14, product = null, productShare = 0.3 } = {}) {
  if (!w || !h) return null;
  const cols = Math.ceil(w / grid), rows = Math.ceil(h / grid);
  const prod = product === false ? null : product && product.grid === grid ? product : bitmap ? productMask({ w, h, bitmap, grid }) : null;
  const prodIn = (rect) => { // 후보 안 [상품 칸 수, 전체 칸 수]
    const c0 = Math.floor(rect.x / grid), r0 = Math.floor(rect.y / grid), c1 = Math.min(cols - 1, Math.floor((rect.x + rect.w - 1) / grid)), r1 = Math.min(rows - 1, Math.floor((rect.y + rect.h - 1) / grid));
    let p = 0, n = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { n++; if (prod.cells[r * cols + c]) p++; }
    return [p, n];
  };
  const occ = new Uint8Array(cols * rows);
  for (const b of boxes || []) {
    const x0 = Math.max(0, Math.floor((b.x - pad) / grid)), y0 = Math.max(0, Math.floor((b.y - pad) / grid));
    const x1 = Math.min(cols - 1, Math.floor((b.x + b.w + pad - 1) / grid)), y1 = Math.min(rows - 1, Math.floor((b.y + b.h + pad - 1) / grid));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) occ[y * cols + x] = 1;
  }
  const tall = h > w * 1.3;
  const total = w * h;
  const okSize = (r) => r.w * r.h >= total * minArea && (r.w >= w * minW || (tall && r.h >= h * minW && r.w >= w * 0.35));
  const toPx = (c0, r0, c1, r1) => ({ x: c0 * grid, y: r0 * grid, w: Math.min(w, (c1 + 1) * grid) - c0 * grid, h: Math.min(h, (r1 + 1) * grid) - r0 * grid });
  // 히스토그램 방식으로 극대 직사각형 후보 수집(같은 사각형 중복 제거)
  const seen = new Set();
  const cands = [];
  const hist = new Int32Array(cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) hist[c] = occ[r * cols + c] ? 0 : hist[c] + 1;
    const stack = []; // [col, height]
    for (let c = 0; c <= cols; c++) {
      const cur = c < cols ? hist[c] : 0;
      let start = c;
      while (stack.length && stack[stack.length - 1][1] >= cur) {
        const [sc, sh] = stack.pop();
        start = sc;
        if (sh > 0) {
          const rect = toPx(sc, r - sh + 1, c - 1, r);
          const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
          if (!seen.has(key) && okSize(rect)) { seen.add(key); cands.push(rect); }
        }
      }
      if (cur > 0 && (!stack.length || stack[stack.length - 1][1] < cur)) stack.push([start, cur]);
    }
  }
  if (!cands.length) return null;
  const useProd = !!(prod && prod.count && (boxes || []).length); // 글자 상자가 없으면 전체가 후보(상품 점수로 한쪽을 잘라내지 않는다)
  if (useProd) { // 극대 직사각형은 글자 상자 경계까지 늘어나 빈 벽을 안고 있다 → 후보마다 그 안의 상품 칸 경계(+1칸 여유)로 줄인 사각형도 후보에 넣는다
    for (const rect of [...cands]) {
      const c0 = Math.floor(rect.x / grid), r0 = Math.floor(rect.y / grid), c1 = Math.min(cols - 1, Math.floor((rect.x + rect.w - 1) / grid)), r1 = Math.min(rows - 1, Math.floor((rect.y + rect.h - 1) / grid));
      let pc0 = c1 + 1, pr0 = r1 + 1, pc1 = -1, pr1 = -1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (prod.cells[r * cols + c]) { pc0 = Math.min(pc0, c); pr0 = Math.min(pr0, r); pc1 = Math.max(pc1, c); pr1 = Math.max(pr1, r); }
      if (pc1 < 0) continue;
      const sub = toPx(Math.max(c0, pc0 - 1), Math.max(r0, pr0 - 1), Math.min(c1, pc1 + 1), Math.min(r1, pr1 + 1));
      const key = `${sub.x},${sub.y},${sub.w},${sub.h}`;
      if (!seen.has(key) && okSize(sub)) { seen.add(key); cands.push(sub); }
    }
  }
  let best = null;
  for (const rect of cands) {
    const cr = bitmap ? contentRatio(cropBitmap(bitmap, rect), { tol }) : 1;
    if (cr < minContent) continue;
    let score, pc = 0;
    if (useProd) { const [p, n] = prodIn(rect); pc = p; score = p - 0.3 * (n - p); }
    else score = rect.w * rect.h * (0.3 + cr);
    if (!best || score > best.score) best = { rect, contentRatio: cr, score, pc };
  }
  if (!best) return null;
  if (useProd && best.pc < prod.count * productShare) return null; // 상품 대부분이 후보 밖(글자 밑이거나 너무 납작한 띠) → 자르지 않는다
  return { rect: best.rect, contentRatio: best.contentRatio, coverage: (best.rect.w * best.rect.h) / total, product: prod ? { cells: best.pc, total: prod.count, frac: prod.frac } : null };
}

// 잘라낸 영역 안에 걸쳐 들어온 글자 상자 처리: 가장자리 쪽에 얇게 걸친 상자는 rect 를 그만큼 줄이고, 안쪽 상자는 eraseRect 로 지운다.
// 반환: { rect(줄인 사각형), residual: [안쪽 상자…(원본 좌표)] }
export function settleBoxesInRect(rect, boxes, { pad = 4, edgeFrac = 0.25 } = {}) {
  let r = { ...rect };
  const residual = [];
  for (const b of boxes || []) {
    const ix0 = Math.max(b.x, r.x), iy0 = Math.max(b.y, r.y), ix1 = Math.min(b.x + b.w, r.x + r.w), iy1 = Math.min(b.y + b.h, r.y + r.h);
    if (ix1 - ix0 <= 0 || iy1 - iy0 <= 0) continue;
    const top = b.y < r.y + r.h * edgeFrac, bottom = b.y + b.h > r.y + r.h * (1 - edgeFrac);
    const left = b.x < r.x + r.w * edgeFrac, right = b.x + b.w > r.x + r.w * (1 - edgeFrac);
    // 위/아래 가장자리에 걸친 글 한 줄 → 세로로 줄이기, 좌/우 가장자리 → 가로로 줄이기(줄이는 양이 작은 쪽)
    const cutTop = top ? iy1 + pad - r.y : Infinity, cutBottom = bottom ? r.y + r.h - (iy0 - pad) : Infinity;
    const cutLeft = left ? ix1 + pad - r.x : Infinity, cutRight = right ? r.x + r.w - (ix0 - pad) : Infinity;
    const m = Math.min(cutTop, cutBottom, cutLeft, cutRight);
    if (m === Infinity || m > Math.max(r.w, r.h) * 0.3) { residual.push(b); continue; }
    if (m === cutTop) { r = { x: r.x, y: r.y + m, w: r.w, h: r.h - m }; }
    else if (m === cutBottom) { r = { x: r.x, y: r.y, w: r.w, h: r.h - m }; }
    else if (m === cutLeft) { r = { x: r.x + m, y: r.y, w: r.w - m, h: r.h }; }
    else { r = { x: r.x, y: r.y, w: r.w - m, h: r.h }; }
  }
  return { rect: r, residual };
}

// 질감 비율: step 간격으로 뽑은 픽셀 중 2px 옆/아래와 thr 이상 다른(=경계가 있는) 픽셀 비율. 사진은 크고(≥0.1), 단색 판·완만한 그라데이션·빈 벽은 작다.
export function textureRatio(bm, { step = 4, thr = 12 } = {}) {
  const W = bm.w, H = bm.h;
  if (W < 4 || H < 4) return 0;
  let n = 0, hit = 0;
  for (let y = 0; y < H - 2; y += step) for (let x = 0; x < W - 2; x += step) {
    const i = px(bm, x, y), r = px(bm, x + 2, y), d = px(bm, x, y + 2);
    const dr = (Math.abs(bm.data[i] - bm.data[r]) + Math.abs(bm.data[i + 1] - bm.data[r + 1]) + Math.abs(bm.data[i + 2] - bm.data[r + 2])) / 3;
    const dd = (Math.abs(bm.data[i] - bm.data[d]) + Math.abs(bm.data[i + 1] - bm.data[d + 1]) + Math.abs(bm.data[i + 2] - bm.data[d + 2])) / 3;
    if (dr > thr || dd > thr) hit++;
    n++;
  }
  return n ? hit / n : 0;
}

// 가장자리 "장식 띠" 자르기(trimEdgeBands): 위/아래/좌/우 가장자리에서 안쪽으로 줄(행/열)마다 평균색·균일도를 보며
//  (1) 줄이 거의 단색이거나(픽셀의 uniformFrac 이상이 줄 평균색과 tol 이내) 같은 색 구간이 minRun 비율 이상 이어지고(배지 조각처럼 폭 일부만 차지하는 띠)
//  (2) 가장자리 첫 줄과 색이 비슷하면(sameBand) 띠로 이어 간다. 밑줄·점 같은 얇은 장식(최대 skip 줄)은 건너뛴다.
//  띠가 끝난 뒤 이어지는 영역(next 줄)과 띠 색의 차이(ΔE, 채널 평균 절대차)가 minDelta 이상일 때만 잘라낸다(= 파란 머리띠·흰 바닥 띠처럼 사진과 뚜렷이 다른 띠).
//  한 변 최대 maxFrac × (limitBase 또는 비트맵 크기) — cropPhoto 는 원본 크기를 limitBase 로 준다. 반환 { x, y, w, h, cut:{top,bottom,left,right} }
export function trimEdgeBands(bm, { tol = 14, uniformFrac = 0.85, minRun = 0.3, sameBand = 24, minDelta = 28, skip = 6, maxFrac = 0.2, next = 8, limitBase = null, padUniform = 4, padRun = 16 } = {}) {
  const W = bm.w, H = bm.h;
  const dE = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
  const lineStat = (isRow, idx) => { // { mean, uniform(평균색 tol 이내 비율), run:{frac,color,a,b}(가장 긴 같은 색 구간) }
    const n = isRow ? W : H;
    const m = lineAvg(bm, isRow, idx);
    let ok = 0, best = { len: 0, a: 0, b: 0 }, runA = 0, runLen = 1, pi = isRow ? px(bm, 0, idx) : px(bm, idx, 0);
    for (let k = 0; k < n; k++) {
      const i = isRow ? px(bm, k, idx) : px(bm, idx, k);
      const c = [bm.data[i], bm.data[i + 1], bm.data[i + 2]];
      if (dE(c, m) <= tol) ok++;
      if (k > 0) { if (dE(c, [bm.data[pi], bm.data[pi + 1], bm.data[pi + 2]]) <= 6) runLen++; else { if (runLen > best.len) best = { len: runLen, a: runA, b: k - 1 }; runA = k; runLen = 1; } }
      pi = i;
    }
    if (runLen > best.len) best = { len: runLen, a: runA, b: n - 1 };
    const seg = [];
    for (let k = best.a; k <= best.b; k += 2) { const i = isRow ? px(bm, k, idx) : px(bm, idx, k); seg.push([bm.data[i], bm.data[i + 1], bm.data[i + 2]]); }
    return { mean: m, uniform: ok / n, run: { frac: best.len / n, color: avg(seg) || m, a: best.a, b: best.b } };
  };
  const segAvg = (isRow, idx, a, b) => { const l = []; for (let k = a; k <= b; k += 2) { const i = isRow ? px(bm, k, idx) : px(bm, idx, k); l.push([bm.data[i], bm.data[i + 1], bm.data[i + 2]]); } return avg(l); };
  const scan = (isRow, fromStart) => {
    const n = isRow ? H : W, base = limitBase ? (isRow ? limitBase.h : limitBase.w) : n;
    const lim = Math.min(n - 1, Math.ceil(base * maxFrac));
    const at = (c) => (fromStart ? c : n - 1 - c);
    const first = lineStat(isRow, at(0));
    const byUniform = first.uniform >= uniformFrac, byRun = !byUniform && first.run.frac >= minRun;
    if (!byUniform && !byRun) return 0;
    const ref = byUniform ? first.mean : first.run.color;
    const isBand = (st) => byUniform ? st.uniform >= uniformFrac && dE(st.mean, ref) <= sameBand : st.run.frac >= minRun * 0.8 && dE(st.run.color, ref) <= sameBand;
    let c = 1, last = 1, gap = 0;
    while (c < lim) {
      if (isBand(lineStat(isRow, at(c)))) { last = c + 1; gap = 0; }
      else { gap++; if (gap > skip) break; }
      c++;
    }
    if (last >= lim) return 0; // 한계까지 이어지면 배경이지 띠가 아니다
    // 띠 다음 영역과 색이 뚜렷이 달라야 띠로 인정(배지 조각은 그 구간의 열만 비교)
    const after = [];
    for (let k = last; k < Math.min(n, last + next); k++) after.push(byUniform ? lineAvg(bm, isRow, at(k)) : segAvg(isRow, at(k), first.run.a, first.run.b));
    if (!after.length) return 0;
    if (dE(avg(after), ref) < minDelta) return 0;
    return Math.min(lim, last + (byUniform ? padUniform : padRun)); // 둥근 모서리·그라데이션 가장자리 조각까지 조금 더
  };
  const top = scan(true, true), bottom = scan(true, false), left = scan(false, true), right = scan(false, false);
  if (H - top - bottom < 32 || W - left - right < 32) return { x: 0, y: 0, w: W, h: H, cut: { top: 0, bottom: 0, left: 0, right: 0 } };
  return { x: left, y: top, w: W - left - right, h: H - top - bottom, cut: { top, bottom, left, right } };
}

// ---- v2 누끼 후처리 ----
// 전경 경계(bbox)에 margin 비율 여백을 두고 이미지 안으로 자를 사각형
export function cutoutRect(bbox, w, h, margin = 0.12) {
  const mx = Math.round(bbox.w * margin), my = Math.round(bbox.h * margin);
  return expandRect({ x: bbox.x - mx, y: bbox.y - my, w: bbox.w + mx * 2, h: bbox.h + my * 2 }, 0, w, h);
}
// 누끼를 "제품 단독 컷"으로 써도 되는지. 전경이 너무 작거나(coverage<minCoverage), 전경이 테두리에 닿고 크면(coverage>sceneCoverage = 장면 사진) 안 된다.
// 가늘고 긴 제품(봉·바)은 coverage 가 작아도 bbox 가 크면(≥ thinBbox) 통과(minCoverage/2 까지).
export function judgeCutout(bbox, coverage, w, h, { minCoverage = 0.08, sceneCoverage = 0.6, edge = 2, thinBbox = 0.25 } = {}) {
  if (!bbox || !(bbox.w > 0) || !(bbox.h > 0)) return { cutoutOk: false, reason: "전경 없음" };
  const bboxFrac = (bbox.w * bbox.h) / (w * h);
  if (coverage < minCoverage && !(bboxFrac >= thinBbox && coverage >= minCoverage / 2)) return { cutoutOk: false, reason: `전경이 너무 작음(${(coverage * 100).toFixed(1)}%)` };
  const touches = bbox.x <= edge || bbox.y <= edge || bbox.x + bbox.w >= w - edge || bbox.y + bbox.h >= h - edge;
  if (touches && coverage > sceneCoverage) return { cutoutOk: false, reason: `장면 사진(전경이 테두리에 닿고 ${(coverage * 100).toFixed(0)}%)` };
  return { cutoutOk: true, reason: "" };
}
// 알파 가장자리 페더: 투명 픽셀과 radius 안에 맞닿은 불투명 픽셀의 알파(와 premultiplied 색)를 거리별로 줄인다
export function featherAlpha(bm, radius = 2) {
  if (radius <= 0) return bm;
  const W = bm.w, H = bm.h, d = bm.data;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!a[i]) continue;
    let dist = radius + 1; // 가장 가까운 투명 픽셀까지(체비쇼프 거리)
    for (let r = 1; r <= radius && dist > radius; r++) {
      for (let dy = -r; dy <= r && dist > radius; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || !a[yy * W + xx]) { dist = r; break; }
      }
    }
    if (dist <= radius) {
      const f = dist / (radius + 1); // r=1 → 1/3, r=2 → 2/3
      const p = i * 4;
      d[p] = Math.round(d[p] * f); d[p + 1] = Math.round(d[p + 1] * f); d[p + 2] = Math.round(d[p + 2] * f); d[p + 3] = Math.round(d[p + 3] * f);
    }
  }
  return bm;
}

// ---- 색상 팔레트 ----
const rgbHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join(""); // [r,g,b]
function hsl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const dd = max - min, s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
  let h = max === R ? (G - B) / dd + (G < B ? 6 : 0) : max === G ? (B - R) / dd + 2 : (R - G) / dd + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
// k-means(k색) — samples: [[r,g,b],…]. 반환: [{ rgb, weight }] weight 내림차순
export function kmeansPalette(samples, k = 5, iters = 10) {
  if (!samples.length) return [];
  const n = samples.length;
  let centers = [];
  for (let i = 0; i < k; i++) centers.push(samples[Math.floor((i + 0.5) * n / k)].slice()); // 균등 위치 초기값(결정적)
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) { const ce = centers[c]; const dd = (s[0] - ce[0]) ** 2 + (s[1] - ce[1]) ** 2 + (s[2] - ce[2]) ** 2; if (dd < bd) { bd = dd; best = c; } }
      assign[i] = best; sum[best][0] += s[0]; sum[best][1] += s[1]; sum[best][2] += s[2]; sum[best][3]++;
    }
    centers = sum.map((s, c) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[c]));
  }
  const counts = new Array(centers.length).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;
  return centers.map((c, i) => ({ rgb: c.map(Math.round), weight: counts[i] / n })).filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight);
}
// 비트맵(BGRA, 알파 있으면 전경만) → { dominant:[hex×5], accent:hex, bg:hex, dark:bool }
export function paletteFromBitmap(bm, { step = 4, k = 5 } = {}) {
  const samples = [];
  const d = bm.data;
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) { hasAlpha = true; break; }
  for (let y = 0; y < bm.h; y += step) for (let x = 0; x < bm.w; x += step) {
    const p = (y * bm.w + x) * 4, a = d[p + 3];
    if (hasAlpha && a < 200) continue;
    const un = hasAlpha && a < 255 ? 255 / a : 1; // premultiplied 되돌리기
    samples.push([Math.min(255, d[p + 2] * un), Math.min(255, d[p + 1] * un), Math.min(255, d[p] * un)]);
  }
  const cl = kmeansPalette(samples, k);
  if (!cl.length) return { dominant: ["#888888"], accent: "#888888", bg: "#ffffff", dark: false };
  const dominant = cl.map((c) => rgbHex(c.rgb));
  // 채도 높은 색을 accent(너무 적은 비중은 제외), 없으면 가장 많은 색
  const sat = cl.filter((c) => c.weight >= 0.04).map((c) => ({ c, s: hsl(c.rgb)[1] * (1 - Math.abs(hsl(c.rgb)[2] - 0.5) * 1.2) })).sort((a, b) => b.s - a.s);
  const accentC = sat.length && sat[0].s > 0.15 ? sat[0].c.rgb : cl[0].rgb;
  const lum = cl.reduce((s, c) => s + c.weight * (0.299 * c.rgb[0] + 0.587 * c.rgb[1] + 0.114 * c.rgb[2]) / 255, 0);
  const dark = lum < 0.38;
  const [h, s] = hsl(accentC);
  const bg = dark ? rgbHex(hslToRgb(h, Math.min(0.25, s), 0.13)) : rgbHex(hslToRgb(h, Math.min(0.35, s), 0.96)); // 제품 색조를 살짝 띤 배경
  return { dominant, accent: rgbHex(accentC), bg, dark };
}

// 전경 경계(bbox)의 가장자리 25% 띠에 걸친 글자 상자는 그 띠째 bbox 에서 잘라낸다. 가운데 상자는 그대로 둔다(구멍을 내지 않는다).
// - 변마다 필요한 양의 최대값을 한 번에 적용(순서 무관). 여백 pad 는 상자 높이의 절반(8~pad px): 배지 바탕은 글자보다 둥글게 크고, 작은 라벨은 조금만.
// - 아주 작은 상자(폭 < minW 비율이고 높이 < minH 비율 — 치수 숫자 "51" 같은 것)는 무시한다(제품 위 라벨 때문에 제품을 깎지 않게).
// - 다 적용하면 bbox 가 절반 미만이 될 때는 가장 많이 깎는 변부터 포기한다.
// 반환 { bbox, cut: 잘라낸 상자 수 }
export function shrinkBboxByBoxes(bbox, boxes, { zone = 0.25, pad = 36, minKeep = 0.5, minW = 0.15, minH = 0.06 } = {}) {
  const b = bbox;
  const need = { top: 0, bottom: 0, left: 0, right: 0 }, count = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const t of boxes || []) {
    if (t.w < b.w * minW && t.h < b.h * minH) continue;
    const p = Math.max(8, Math.min(pad, Math.round(t.h * 0.5)));
    // 상자를 p 만큼 키워서 겹침을 본다(배지 바탕이 전경 경계 바로 바깥의 글자에서 안쪽으로 둥글게 들어온다 — g10 의 "可折叠")
    const ix0 = Math.max(t.x - p, b.x), iy0 = Math.max(t.y - p, b.y), ix1 = Math.min(t.x + t.w + p, b.x + b.w), iy1 = Math.min(t.y + t.h + p, b.y + b.h);
    if (ix1 <= ix0 || iy1 <= iy0) continue;
    const cy = Math.max(0, Math.min(1, (t.y + t.h / 2 - b.y) / b.h)), cx = Math.max(0, Math.min(1, (t.x + t.w / 2 - b.x) / b.w)); // 경계 밖 상자는 그 변으로
    const opts = [];
    if (cy < zone) opts.push(["top", iy1 - b.y]);
    if (cy > 1 - zone) opts.push(["bottom", b.y + b.h - iy0]);
    if (cx < zone) opts.push(["left", ix1 - b.x]);
    if (cx > 1 - zone) opts.push(["right", b.x + b.w - ix0]);
    if (!opts.length) continue;
    opts.sort((u, v) => u[1] - v[1]);
    const [side, m] = opts[0];
    if (m > need[side]) need[side] = m;
    count[side]++;
  }
  const apply = () => ({ x: b.x + need.left, y: b.y + need.top, w: b.w - need.left - need.right, h: b.h - need.top - need.bottom });
  let nb = apply();
  const sides = ["top", "bottom", "left", "right"];
  while ((nb.w < b.w * minKeep || nb.h < b.h * minKeep) && sides.some((k) => need[k] > 0)) {
    const worst = sides.filter((k) => need[k] > 0).sort((u, v) => need[v] - need[u])[0];
    need[worst] = 0; count[worst] = 0;
    nb = apply();
  }
  return { bbox: nb, cut: count.top + count.bottom + count.left + count.right };
}

// 비트맵에서 rect 바깥 픽셀을 투명하게(premultiplied 라 색도 0). 글자·배지 띠를 잘라낸 뒤 그 영역의 전경을 없앨 때 쓴다.
export function clearOutside(bm, rect) {
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y), x1 = Math.min(bm.w, rect.x + rect.w), y1 = Math.min(bm.h, rect.y + rect.h);
  for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) {
    if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
    const i = (y * bm.w + x) * 4; bm.data[i] = 0; bm.data[i + 1] = 0; bm.data[i + 2] = 0; bm.data[i + 3] = 0;
  }
  return bm;
}

// ---- 생성 이미지 액자 테두리 제거(stripFrame) ----
// 이미지 생성 모델이 사진 둘레에 균일한 흰/단색 여백(액자)을 그려 넣는 경우가 있다.
// 네 변 모두 "거의 단색 줄"이 minBorder px 이상(각 변 maxBorder 비율 이하) 이어지고 네 변 색이 서로 비슷할 때만 액자로 본다.
// 안쪽 사진만 남긴 뒤(inset px 더) 원래 화면비로 맞추려고 중앙 기준으로 다시 자른다. 반환: { x, y, w, h } 또는 null(액자 아님)
export function findFrameRect(bm, { tol = 10, minBorder = 6, maxBorder = 0.15, sameColor = 20, inset = 2 } = {}) {
  const W = bm.w, H = bm.h;
  if (W < 64 || H < 64) return null;
  const side = (isRow, fromStart) => {
    const n = isRow ? H : W, lim = Math.floor(n * maxBorder) + 1;
    const ref = lineAvg(bm, isRow, fromStart ? 0 : n - 1);
    let c = 0;
    while (c < lim && lineIsBg(bm, isRow, fromStart ? c : n - 1 - c, ref, tol)) c++;
    return { c, ref, capped: c >= lim };
  };
  const s = [side(true, true), side(true, false), side(false, true), side(false, false)];
  if (s.some((x) => x.c < minBorder || x.capped)) return null;
  const d = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
  for (let i = 1; i < 4; i++) if (d(s[0].ref, s[i].ref) > sameColor) return null;
  let x = s[2].c + inset, y = s[0].c + inset, w = W - s[2].c - s[3].c - inset * 2, h = H - s[0].c - s[1].c - inset * 2;
  if (w < 32 || h < 32) return null;
  const ratio = W / H;
  if (w / h > ratio) { const nw = Math.round(h * ratio); x += Math.floor((w - nw) / 2); w = nw; }
  else { const nh = Math.round(w / ratio); y += Math.floor((h - nh) / 2); h = nh; }
  return { x, y, w, h };
}

// ---- 생성 장면의 빈 가장자리 정리(fitContentRect) ----
// findTrimRect 로 내용 사각형을 찾고, 잘려 나갈 빈 가장자리가 maxEmpty(30%) 를 넘을 때만 내용 둘레로 다시 자른다.
// 원래 화면비를 유지하려고 내용 사각형을 중심으로 짧은 쪽을 늘린다(이미지 안에서). 늘려도 빈 가장자리가 30% 를 넘으면 자르지 않고 tooSmall(재생성 권장).
// 반환: { rect:{x,y,w,h}|null(자를 필요 없음), emptyFrac(빈 가장자리 비율), contentFrac(내용 사각형 면적 비율), tooSmall(내용이 minContent 미만 → 재생성 권장) }
export function fitContentRect(bm, { tol = 14, minKeep = 8, maxCut = 0.7, maxEmpty = 0.3, minContent = 0.15 } = {}) { // minContent 0.15: 그보다 작으면 잘라도 2.5배 넘게 키워야 해서 재생성
  const W = bm.w, H = bm.h;
  const t = findTrimRect(bm, { tol, minKeep, maxCut });
  const contentFrac = (t.w * t.h) / (W * H);
  const emptyFrac = 1 - contentFrac;
  const tooSmall = contentFrac < minContent;
  if (!t.trimmed || emptyFrac <= maxEmpty) return { rect: null, emptyFrac, contentFrac, tooSmall };
  const R = W / H;
  // (1) 짧은 쪽을 늘려 비율을 맞춰 본다 — 다시 빈 가장자리를 넉넉히 끌어들이면(새 사각형 대비 내용 < 1-maxEmpty) (2) 긴 쪽을 "디테일 무게중심" 기준으로 줄인다
  let { x, y, w, h } = t;
  let gw = w, gh = h;
  if (gw / gh < R) gw = Math.min(W, Math.round(gh * R)); else gh = Math.min(H, Math.round(gw / R));
  if (gw / gh < R - 1e-3) gh = Math.round(gw / R); else if (gw / gh > R + 1e-3) gw = Math.round(gh * R);
  const cx = x + w / 2, cy = y + h / 2;
  // 비율을 맞추려고 늘리면 빈 가장자리가 다시 들어와 소용없는 경우(내용이 가로·세로로 길쭉하게 한쪽에 몰림) — 긴 쪽을 줄이면 제품이 잘리므로
  // 자르지 않고 tooSmall 로 돌려 재생성을 권한다(1차 시도: 디테일 무게중심으로 긴 쪽을 줄였더니 제품이 반쯤 잘림 — 폐기)
  if ((w * h) / (gw * gh) < 1 - maxEmpty) return { rect: null, emptyFrac, contentFrac, tooSmall: true, mode: "regen" };
  x = Math.round(Math.max(0, Math.min(W - gw, cx - gw / 2)));
  y = Math.round(Math.max(0, Math.min(H - gh, cy - gh / 2)));
  return { rect: { x, y, w: gw, h: gh }, emptyFrac, contentFrac, tooSmall, mode: "grow" };
}

// =====================================================================================
// v6 원본 한글화(localize) — 순수 로직: 글자 덩어리 묶기·역할·숫자 판별·글자 스타일·알약 배너 감지
// =====================================================================================
// 숫자·단위만 있는 글(13.5cm, 37-57.5cm, 4.17kg/5.15kg, 25kg, 160人 제외)은 지우지 않고 그대로 둔다(도면 치수)
const NUM_ONLY = /^[\s\d.,\-~～—–*×xX+/:%°±()（）"'′″]*\d[\s\d.,\-~～—–*×xX+/:%°±()（）"'′″]*(mm|cm|m|kg|g|l|ml|L|ML|KG|CM|MM|M|G|cml|w|W|v|V|in|inch)?[\s\d.,\-~～—–*×xX+/:%°±()（）"'′″]*(mm|cm|m|kg|g|l|ml|KG|CM|MM)?\s*$/;
export const isNumberText = (t) => NUM_ONLY.test(String(t || "").trim());
// 판매자 홍보(공장·인증·맞춤제작·반품 배지) 글
export const PROMO_RE = /工厂|厂家|厂房|源头|实力|有限公司|公司|认证|证书|专利|资质|定制|定做|来样|OEM|ODM|一件代发|批发|七天|7天|无理由|退换|包邮|发货|质检|合作伙伴|年交易|行业经验|工厂人员|仓储|生产线|流程/;
export const isPromoText = (t) => PROMO_RE.test(String(t || ""));

// 같은 줄(세로 겹침 ≥ 50%)이고 가로 간격이 글자 높이의 1.2배 이하인 상자를 한 덩어리로. 반환 [{ x,y,w,h, text, members:[i…] }] (위→아래, 왼→오른)
export function groupTextBlocks(boxes, { gapK = 1.2 } = {}) {
  const items = (boxes || []).map((b, i) => ({ ...b, members: [i] })).sort((a, b) => a.y - b.y || a.x - b.x);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < items.length; i++) for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const a = items[i], b = items[j];
      const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ov < 0.5 * Math.min(a.h, b.h)) continue;
      if (Math.max(a.h, b.h) > 1.6 * Math.min(a.h, b.h)) continue; // 글자 크기가 많이 다르면 다른 덩어리
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      if (gap > gapK * Math.max(a.h, b.h)) continue;
      if (isNumberText(a.text) !== isNumberText(b.text)) continue; // 숫자 상자는 따로(그대로 둘 것이라)
      { const ta = String(a.text || "").trim(), tb = String(b.text || "").trim(); let k = 0; while (k < Math.min(ta.length, tb.length) && ta[ta.length - 1 - k] === tb[tb.length - 1 - k]) k++; if (k >= 2 && a.members.length === 1 && b.members.length === 1) continue; } // 끝말이 같은 나란한 라벨(3.2毫米大葱碎 / 4毫米大葱碎)은 각각 따로 — 그릇마다 하나씩인 캡션
      const [l, r] = a.x <= b.x ? [a, b] : [b, a];
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      items[i] = { ...a, x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, text: `${l.text} ${r.text}`, conf: Math.min(a.conf ?? 1, b.conf ?? 1), members: [...a.members, ...b.members] };
      items.splice(j, 1);
      changed = true;
      break outer;
    }
  }
  return items.sort((a, b) => a.y - b.y || a.x - b.x);
}

// 역할: number(숫자만) · promo(홍보) · note(작은 주석·*로 시작) · title(가장 큰 글) · sub(알약 배너/두 번째 크기) · label(짧은 이름표)
export function assignRoles(blocks, { imgH = 1000 } = {}) {
  const H_ = (b) => b.th ?? b.h; // 기울어진 글은 상자 높이가 아니라 글자 두께(th)
  const hs = blocks.filter((b) => !isNumberText(b.text)).map(H_);
  const maxH = Math.max(0, ...hs);
  const med = hs.length ? [...hs].sort((a, b) => a - b)[Math.floor(hs.length / 2)] : 0;
  return blocks.map((b) => {
    const t = String(b.text || "").trim();
    let role;
    if (isNumberText(t)) role = "number";
    else if (isPromoText(t)) role = "promo";
    else if (/^[*※＊]|以上|仅供参考|误差|为准|以实物/.test(t) || (H_(b) < 0.6 * med && H_(b) < 0.025 * imgH)) role = "note";
    else if (H_(b) >= 0.85 * maxH && maxH > 0) role = "title";
    else if (b.pill) role = "sub";
    else if (Array.from(t.replace(/\s/g, "")).length <= 6) role = "label";
    else role = "sub";
    return { ...b, role };
  });
}

// v13 정렬·역할을 배치로(2026-10-13 일반화 검증 — 탄소강 풀아웃 아이콘 표 오른쪽 칸 라벨이 "이미지 오른쪽 절반 → 오른쪽 정렬"로 잡혀 칸 테두리 밖으로 넘친 것)
//  · 한 줄에 나란히 놓인 비슷한 크기의 짧은 글(아이콘 표·칸 라벨, 2개 이상) → 가운데 정렬. 그 줄들이 장에서 가장 큰 글이라 title 이 됐으면 label(제목이 아니라 칸 이름)
//  · 세로로 쌓인 줄(가로 겹침, 줄 간격 < 1.5줄) → 왼쪽 끝·가운데·오른쪽 끝 중 가장 잘 맞는 쪽(흩어짐 < 이미지 폭 3%)
//  · 혼자인 줄은 textStyle 추정 그대로. 기울어진 글·숫자는 건드리지 않는다
// blocks: [{ x,y,w,h, th?, text, role, angle?, style:{ align } }] → 같은 배열(새 객체)
export function inferLayout(blocks, { imgW = 1000 } = {}) {
  const H_ = (b) => b.th ?? b.h, cy = (b) => b.y + b.h / 2;
  const out = blocks.map((b) => ({ ...b, style: { ...(b.style || {}) } }));
  const ok = out.filter((b) => !b.angle && !b.vertical && b.role !== "number" && b.style);
  const short = (b) => Array.from(String(b.text || "").replace(/\s/g, "")).length <= 10;
  const rowOf = new Set();
  for (const a of ok) {
    if (rowOf.has(a) || !short(a)) continue;
    const row = ok.filter((b) => short(b) && Math.abs(cy(b) - cy(a)) < Math.min(H_(a), H_(b)) * 0.5 && Math.max(H_(a), H_(b)) <= Math.min(H_(a), H_(b)) * 1.3);
    // 서로 가로로 떨어져 있어야 한 줄의 여러 칸(같은 줄을 OCR 이 둘로 자른 것은 붙어 있다 — 글자 높이보다 넓게 떨어진 것만)
    const sorted = [...row].sort((p, q) => p.x - q.x), apart = sorted.every((b, i) => !i || b.x - (sorted[i - 1].x + sorted[i - 1].w) > Math.max(H_(b), H_(sorted[i - 1])));
    if (row.length < 2 || !apart) continue;
    for (const b of row) { rowOf.add(b); b.style.align = "center"; if (b.role === "title") b.role = "label"; }
  }
  const used = new Set();
  const sorted = ok.filter((b) => !rowOf.has(b)).sort((p, q) => p.y - q.y);
  for (const a of sorted) {
    if (used.has(a)) continue;
    const st = [a];
    for (const b of sorted) { if (used.has(b) || st.includes(b)) continue; const p = st[st.length - 1]; const ov = Math.min(p.x + p.w, b.x + b.w) - Math.max(p.x, b.x); if (b.y >= p.y && b.y - (p.y + p.h) < Math.max(H_(p), H_(b)) * 1.5 && ov > Math.min(p.w, b.w) * 0.3) st.push(b); }
    if (st.length < 2) continue;
    st.forEach((b) => used.add(b));
    const spread = (f) => { const v = st.map(f); return Math.max(...v) - Math.min(...v); };
    const cand = [["left", spread((b) => b.x)], ["center", spread((b) => b.x + b.w / 2)], ["right", spread((b) => b.x + b.w)]].sort((p, q) => p[1] - q[1]);
    if (cand[0][1] < imgW * 0.03) st.forEach((b) => { b.style.align = cand[0][0]; });
    // 같은 높이(±25%) 줄이 3개 이상 쌓인 목록(사양 칸·설명 줄) → 역할·크기·굵기 하나로(글자 높이 몇 px 차이로 한 줄만 제목·굵게 되던 것 — 탄소강 풀아웃 d11 사양 칸)
    const hs = st.map(H_).sort((p, q) => p - q);
    if (st.length >= 3 && hs[hs.length - 1] <= hs[0] * 1.25) {
      const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1], cnt = {};
      st.forEach((b) => { cnt[b.role] = (cnt[b.role] || 0) + (b.role === "title" ? 0.5 : 1); });
      const role = Object.entries(cnt).sort((p, q) => q[1] - p[1])[0][0];
      const size = med(st.map((b) => Number(b.style.fontSizePx) || Math.round(H_(b) * 0.92))), weight = med(st.map((b) => Number(b.style.fontWeight) || 400));
      st.forEach((b) => { b.role = role; b.style.fontSizePx = size; b.style.fontWeight = weight; b.list = true; });
    }
  }
  return out;
}

const dist3 = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
const pxc = (bm, x, y) => { const i = (y * bm.w + x) * 4; return [bm.data[i], bm.data[i + 1], bm.data[i + 2]]; };
const hexOf = (c) => toHex(c);

// 글자 스타일: 상자 안 픽셀을 배경(상자 테두리 줄 평균)과 먼 것 = 글자 획으로 보고 대표색·획 두께·크기를 잰다.
// 반환 { color:"#rrggbb", fontWeight: 400|500|700|800, fontSizePx, align:"left"|"center"|"right", strokeRatio, inkRatio }
export function textStyle(bm, rect, { imgW = bm.w } = {}) {
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(bm.w, Math.round(rect.x + rect.w)), y1 = Math.min(bm.h, Math.round(rect.y + rect.h));
  const edge = [];
  for (let x = x0; x < x1; x++) { edge.push(pxc(bm, x, y0)); edge.push(pxc(bm, x, Math.max(y0, y1 - 1))); }
  for (let y = y0; y < y1; y++) { edge.push(pxc(bm, x0, y)); edge.push(pxc(bm, Math.max(x0, x1 - 1), y)); }
  const bg = avg(edge) || [255, 255, 255];
  const ink = [];
  let inkN = 0, total = 0, runs = [];
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = x0; x < x1; x++) {
      const c = pxc(bm, x, y); total++;
      if (dist3(c, bg) > 60) { ink.push(c); inkN++; run++; } else if (run) { runs.push(run); run = 0; }
    }
    if (run) runs.push(run);
  }
  // 글자색: 잉크 픽셀 중 배경에서 가장 먼 쪽 절반의 평균(안티앨리어싱 가장자리 제외)
  ink.sort((a, b) => dist3(b, bg) - dist3(a, bg));
  const core = ink.slice(0, Math.max(1, Math.floor(ink.length / 2)));
  let color = core.length ? avg(core) : [34, 34, 34], outline = null;
  // 외곽선·그림자 글자(주황 채움 + 두꺼운 검은 테두리, 대파 d17): 잉크가 서로 먼 두 색 무리로 갈리면, 바탕과 맞닿은 비율이 낮은 쪽(안쪽 = 채움)을 글자색으로
  // — 테두리가 더 많아도 테두리는 바깥(바탕 옆)에 있다
  if (ink.length >= 40) {
    let a = ink[0], b = ink[ink.length - 1], A = [], B = [];
    for (let it = 0; it < 8; it++) { A = []; B = []; for (const c of ink) (dist3(c, a) <= dist3(c, b) ? A : B).push(c); if (!A.length || !B.length) break; a = avg(A); b = avg(B); }
    if (A.length && B.length && dist3(a, b) > 80 && Math.min(A.length, B.length) > ink.length * 0.12) {
      const edgeFrac = (m) => { let n = 0, e = 0; for (let y = y0 + 1; y < y1 - 1; y++) for (let x = x0 + 1; x < x1 - 1; x++) { const c = pxc(bm, x, y); if (dist3(c, bg) <= 60 || dist3(c, m) > dist3(c, m === a ? b : a)) continue; n++; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => dist3(pxc(bm, x + dx, y + dy), bg) <= 60)) e++; } return n ? e / n : 1; };
      const chroma = (c) => Math.max(...c) - Math.min(...c);
      outline = null;
      const ea = edgeFrac(a), eb = edgeFrac(b); // v13 둘 다 무채색이고 경계 비율 차이가 작으면(얇은 테두리) 픽셀이 많은 쪽이 채움 — 어두운 판 위 흰 글이 "어두운 글 + 흰 테두리"로 뒤집히던 것(컵홀더 d09)
      color = chroma(a) - chroma(b) > 60 ? a : chroma(b) - chroma(a) > 60 ? b : Math.abs(ea - eb) < 0.15 ? (A.length >= B.length ? a : b) : ea <= eb ? a : b; outline = color === a ? b : a; // 색 있는 채움 + 무채색 테두리면 색 쪽(경계 비율은 반쯤 섞인 가장자리 픽셀 때문에 흔들린다)
    }
  }
  runs.sort((a, b) => a - b);
  const stroke = runs.length ? runs[Math.floor(runs.length / 2)] : 0;
  const h = y1 - y0;
  const strokeRatio = h ? stroke / h : 0;
  const fontWeight = strokeRatio >= 0.14 ? 800 : strokeRatio >= 0.1 ? 700 : strokeRatio >= 0.075 ? 500 : 400;
  const cx = (x0 + x1) / 2;
  const align = Math.abs(cx - imgW / 2) < imgW * 0.06 ? "center" : cx < imgW / 2 ? "left" : "right";
  return { color: hexOf(color), colorBGR: color, ...(outline ? { outline: hexOf(outline) } : {}), bg: hexOf(bg), fontWeight, fontSizePx: Math.round(h * 0.92), align, strokeRatio: +strokeRatio.toFixed(3), inkRatio: total ? +(inkN / total).toFixed(3) : 0 };
}

// 알약 배너·테두리 감지: 글자 상자 위·아래로 나가며 "가로로 길게 같은 색인 줄"(테두리 선 또는 채움 경계)을 찾고, 좌우로도 같은 색 테두리를 찾는다.
// 반환 { pill:bool, rect:{x,y,w,h}(배너 바깥 경계), borderColor:"#…"|null, bgColor:"#…"|null(채움이 바깥 배경과 다르면) }
export function detectPill(bm, rect, { maxPadY = 0.9, maxPadX = 2.5, tol = 40 } = {}) {
  const W = bm.w, H = bm.h;
  const x0 = Math.max(0, Math.round(rect.x)), x1 = Math.min(W - 1, Math.round(rect.x + rect.w)), y0 = Math.max(0, Math.round(rect.y)), y1 = Math.min(H - 1, Math.round(rect.y + rect.h));
  const h = y1 - y0;
  // 알약 안쪽 색 = 글자 상자 테두리 줄의 대표색(상자 모서리 바로 밖은 테두리선에 걸릴 수 있어 쓰지 않는다)
  const edgePx = [];
  for (let x = x0; x <= x1; x += 2) { edgePx.push(pxc(bm, x, y0)); edgePx.push(pxc(bm, x, Math.max(y0, y1 - 1))); }
  for (let y = y0; y <= y1; y += 2) { edgePx.push(pxc(bm, x0, y)); edgePx.push(pxc(bm, x1, y)); }
  const em = avg(edgePx);
  const inner = avg(edgePx.filter((c) => dist3(c, em) < 30)) || em;
  const rowLine = (y) => { // 가운데 60% 구간이 거의 같은 색이고 inner 와 다르면 그 색
    const xs = [], a = x0 + Math.round((x1 - x0) * 0.2), b = x0 + Math.round((x1 - x0) * 0.8);
    for (let x = a; x <= b; x += 2) xs.push(pxc(bm, x, y));
    const m = avg(xs); if (!m) return null;
    const same = xs.filter((c) => dist3(c, m) < 18).length / xs.length;
    return same > 0.85 && dist3(m, inner) > tol ? m : null;
  };
  const scanY = (dir) => { // 글자에서 dir(−1 위, +1 아래)로: 처음 나오는 "다른 색 줄"과 그 줄이 끝나는 곳
    const lim = Math.round(h * maxPadY);
    for (let d = 1; d <= lim; d++) {
      const y = dir < 0 ? y0 - d : y1 + d; if (y < 0 || y >= H) return null;
      const c = rowLine(y);
      if (c) { let e = d; for (; e <= lim + 6; e++) { const yy = dir < 0 ? y0 - e : y1 + e; if (yy < 0 || yy >= H || !(rowLine(yy) && dist3(rowLine(yy), c) < 25)) break; } return e > lim + 6 ? null : { at: d, end: e, color: c }; } // 끝없이 이어지면 테두리가 아니라 바탕
    }
    return null;
  };
  const top = scanY(-1), bot = scanY(1);
  if (!top || !bot || dist3(top.color, bot.color) > 30) return { pill: false, rect: null, borderColor: null, bgColor: null };
  // 좌우: 가운데 줄에서 바깥으로 테두리 색을 만나는 곳
  const cy = Math.round((y0 + y1) / 2), lim = Math.round(h * maxPadX);
  const scanX = (dir) => { for (let d = 1; d <= lim; d++) { const x = dir < 0 ? x0 - d : x1 + d; if (x < 0 || x >= W) return null; if (dist3(pxc(bm, x, cy), top.color) < 30) { let e = d; while (e <= lim + 6) { const xx = dir < 0 ? x0 - e : x1 + e; if (xx < 0 || xx >= W || dist3(pxc(bm, xx, cy), top.color) >= 30) break; e++; } return { at: d, end: e }; } } return null; };
  const left = scanX(-1), right = scanX(1);
  const pad = 3;
  const ry0 = y0 - top.end - pad, ry1 = y1 + bot.end + pad;
  const rx0 = left ? x0 - left.end - pad : x0 - Math.round(h * 0.6), rx1 = right ? x1 + right.end + pad : x1 + Math.round(h * 0.6);
  const outerY = Math.max(0, ry0 - 3);
  const outside = pxc(bm, Math.min(W - 1, Math.max(0, Math.round((rx0 + rx1) / 2))), outerY);
  const filled = dist3(inner, outside) > 20;
  const r = { x: Math.max(0, rx0), y: Math.max(0, ry0), w: Math.min(W, rx1) - Math.max(0, rx0), h: Math.min(H, ry1) - Math.max(0, ry0) };
  const border = top.end - top.at <= Math.max(6, h * 0.25); // 얇으면 테두리선, 두꺼우면 채움 경계
  return { pill: true, rect: r, borderColor: border ? hexOf(top.color) : null, bgColor: filled ? hexOf(inner) : border ? null : hexOf(top.color) };
}

// 둘레 링(rect 바깥 ring px)에서 가장 흔한 색(4단계 양자화)과 그 비율 — "거의 한 색 바탕 + 밑줄·테두리 조금" 판별용
export function ringMode(bm, rect, ring = 4, tol = 8) {
  const W = bm.w, H = bm.h;
  const x0 = Math.max(0, rect.x - ring), y0 = Math.max(0, rect.y - ring), x1 = Math.min(W, rect.x + rect.w + ring), y1 = Math.min(H, rect.y + rect.h + ring);
  const cnt = new Map(), all = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) continue;
    const c = pxc(bm, x, y); all.push(c);
    const k = (c[0] >> 3) * 1024 + (c[1] >> 3) * 32 + (c[2] >> 3);
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  if (!all.length) return { color: [255, 255, 255], frac: 0 };
  let best = null, bn = -1; for (const [k, n] of cnt) if (n > bn) { bn = n; best = k; }
  const seed = [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
  const near = all.filter((c) => dist3(c, seed) <= tol + 6);
  const color = avg(near) || seed;
  // 바탕 자체의 흔들림(사진 벽은 2~6, 인쇄 단색은 0~1)
  let sd = 0; for (const c of near) sd += dist3(c, color) ** 2; sd = near.length ? Math.sqrt(sd / near.length) : 0;
  // 두 번째로 흔한 색(밑줄·테두리선) — 나머지가 한 색이면 "바탕 + 선" 두 색 구성
  const rest = all.filter((c) => dist3(c, seed) > tol + 6);
  let frac2 = 0;
  if (rest.length) { const m2 = avg(rest); frac2 = rest.filter((c) => dist3(c, m2) <= 30).length / all.length; }
  return { color, frac: near.length / all.length, frac2, sd };
}

// 지울 사각형: 글자 상자에서 변마다 pad 까지 넓히되, 바탕(mode)과 뚜렷이 다른 "선"(밑줄·표 테두리·배지 테두리)을 만나면 그 직전에서 멈춘다.
export function safeEraseRect(bm, box, pad, mode) {
  const W = bm.w, H = bm.h;
  const isLine = (cells) => { const far = cells.filter((c) => dist3(c, mode) > 50).length; return far / cells.length > 0.25; };
  const r = { x0: Math.max(0, box.x), y0: Math.max(0, box.y), x1: Math.min(W, box.x + box.w), y1: Math.min(H, box.y + box.h) };
  const row = (y) => { const c = []; for (let x = r.x0; x < r.x1; x += 2) c.push(pxc(bm, x, y)); return c; };
  const col = (x) => { const c = []; for (let y = r.y0; y < r.y1; y += 2) c.push(pxc(bm, x, y)); return c; };
  for (let d = 0; d < pad && r.y0 > 0 && !isLine(row(r.y0 - 1)); d++) r.y0--;
  for (let d = 0; d < pad && r.y1 < H && !isLine(row(r.y1)); d++) r.y1++;
  for (let d = 0; d < pad && r.x0 > 0 && !isLine(col(r.x0 - 1)); d++) r.x0--;
  for (let d = 0; d < pad && r.x1 < W && !isLine(col(r.x1)); d++) r.x1++;
  return { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
}

// 지우기 방식 고르기(localize). 실측(1688 커피머신 수납장 17장): 그래픽 바탕 = 거칠기 0·분산 0, 사진 벽(detail-01) = 거칠기 0.5·분산 10, 밑줄 닿은 제목 = 거칠기 12~20.
//  - "interp": 둘레가 완전히 매끈(거칠기 ≤ 0.2, 분산 ≤ 3 — 단색·인쇄 그라데이션)
//  - "solid": 둘레의 modeFrac(85%) 이상이 한 색(밑줄·테두리선이 조금 닿은 흰 바탕, 원형 배지 안쪽) → 그 색으로
//  - "complex": 그 밖(사진 벽·사선 판 경계·질감) → AI 편집(없으면 JS 대체)
export function eraseMode(stats, { bm = null, rect = null, ring = 4, modeFrac = 0.85, maxRough = 0.2, maxVar = 3, maxModeSd = 2.5 } = {}) {
  if (!stats || !stats.samples) return { mode: "complex" };
  if (stats.roughness <= maxRough && stats.variance <= maxVar) return { mode: "interp" };
  if (bm && rect) {
    const m = ringMode(bm, rect, ring);
    // 바탕이 사진(미세한 결·조명 그라데이션): 단색은 티가 나므로 단색 대신 2차원 보간+페더로 먼저 해 보고(localize 가 이음새 ΔE>6 이면 AI 로), 결이 거칠면(경계가 지나감) 바로 AI
    if (m.sd > maxModeSd) return stats.roughness <= 1.5 ? { mode: "interp", photo: true, sd: +m.sd.toFixed(2) } : { mode: "complex", sd: +m.sd.toFixed(2) };
    if (m.frac >= modeFrac) return { mode: "solid", color: m.color, frac: +m.frac.toFixed(2) };
    if (m.frac >= 0.5 && m.frac + m.frac2 >= 0.95) return { mode: "solid", color: m.color, frac: +m.frac.toFixed(2), line: true }; // 한 색 바탕 + 선(지울 영역은 선 앞에서 멈춘 상태)
  }
  return { mode: "complex" };
}

// ---- localize 순수 도우미(화면비·축소 비교·마스크 붙이기) ----
const ASPECTS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"];
export function nearestAspect(w, h) {
  const r = Math.log(w / h);
  return ASPECTS.map((a) => { const [p, q] = a.split(":").map(Number); return [a, Math.abs(Math.log(p / q) - r)]; }).sort((a, b) => a[1] - b[1])[0][0];
}

// 비트맵 축소(평균) — 픽셀 비교용
function shrink(bm, k) {
  const w = Math.max(1, Math.floor(bm.w / k)), h = Math.max(1, Math.floor(bm.h / k));
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s0 = 0, s1 = 0, s2 = 0, n = 0;
    for (let yy = y * k; yy < Math.min(bm.h, (y + 1) * k); yy++) for (let xx = x * k; xx < Math.min(bm.w, (x + 1) * k); xx++) { const i = (yy * bm.w + xx) * 4; s0 += bm.data[i]; s1 += bm.data[i + 1]; s2 += bm.data[i + 2]; n++; }
    const o = (y * w + x) * 3; out[o] = s0 / n; out[o + 1] = s1 / n; out[o + 2] = s2 / n;
  }
  return { data: out, w, h };
}
// 글자 영역(masks) 밖의 평균 차이(0~255) — 1/8 축소해서(압축·미세한 재렌더 잡음 흡수)
export function diffOutside(a, b, masks, k = 8) {
  const A = shrink(a, k), B = shrink(b, k);
  let s = 0, n = 0;
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
    const px = x * k + k / 2, py = y * k + k / 2;
    if (masks.some((m) => px >= m.x - k && px < m.x + m.w + k && py >= m.y - k && py < m.y + m.h + k)) continue;
    const o = (y * A.w + x) * 3;
    s += (Math.abs(A.data[o] - B.data[o]) + Math.abs(A.data[o + 1] - B.data[o + 1]) + Math.abs(A.data[o + 2] - B.data[o + 2])) / 3; n++;
  }
  return n ? s / n : 0;
}
// 볼록 다각형(시계/반시계 무관) 안쪽까지의 부호 있는 거리(안 = +, 밖 = −)
function polyDist(poly, x, y) {
  let minD = Infinity, sign = 0;
  const n = poly.length / 2;
  let area = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1]; }
  const dir = area >= 0 ? 1 : -1;
  let inside = true;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = poly[i * 2], ay = poly[i * 2 + 1], bx = poly[j * 2], by = poly[j * 2 + 1];
    const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1;
    const cross = (ex * (y - ay) - ey * (x - ax)) / len * dir; // 안쪽이면 +
    if (cross < 0) inside = false;
    minD = Math.min(minD, Math.abs(cross));
  }
  sign = inside ? 1 : -1;
  return sign * minD;
}
// 사각형 꼭짓점(quad 8개)을 중심에서 pad 만큼 바깥으로
export function growQuad(q, pad) {
  const cx = (q[0] + q[2] + q[4] + q[6]) / 4, cy = (q[1] + q[3] + q[5] + q[7]) / 4;
  const out = [];
  for (let i = 0; i < 4; i++) { const dx = q[i * 2] - cx, dy = q[i * 2 + 1] - cy, l = Math.hypot(dx, dy) || 1; out.push(q[i * 2] + (dx / l) * pad * 1.41, q[i * 2 + 1] + (dy / l) * pad * 1.41); }
  return out;
}
// src 의 masks 영역만 dst 로 복사. mask = { x,y,w,h, poly? }(poly 가 있으면 그 다각형 안만).
// AI 결과는 전체 색이 조금 달라질 수 있어(재렌더) → 마스크 바로 바깥 띠(ringPx)에서 원본과의 채널 평균 차이를 구해 붙이는 조각에 더한다(색 맞춤), 가장자리 feather px 섞기.
export function pasteMasks(dst, src, masks, feather = 6, ringPx = 6) {
  for (const m of masks) {
    const inMask = (x, y) => (m.poly ? polyDist(m.poly, x + 0.5, y + 0.5) : Math.min(x - m.x, m.x + m.w - 1 - x, y - m.y, m.y + m.h - 1 - y)); // 안쪽까지 거리(밖이면 음수)
    const x0 = Math.max(0, m.x - ringPx), y0 = Math.max(0, m.y - ringPx), x1 = Math.min(dst.w, m.x + m.w + ringPx), y1 = Math.min(dst.h, m.y + m.h + ringPx);
    // 색 맞춤: 마스크 바깥 ringPx 띠에서 원본 − AI 평균
    const off = [0, 0, 0]; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const d = inMask(x, y); if (d >= 0 || d < -ringPx) continue; const i = (y * dst.w + x) * 4; for (let c = 0; c < 3; c++) off[c] += dst.data[i + c] - src.data[i + c]; n++; }
    if (n) for (let c = 0; c < 3; c++) off[c] = Math.max(-40, Math.min(40, off[c] / n));
    for (let y = Math.max(0, m.y); y < Math.min(dst.h, m.y + m.h); y++) for (let x = Math.max(0, m.x); x < Math.min(dst.w, m.x + m.w); x++) {
      const d = inMask(x, y); if (d < 0) continue;
      const t = feather > 0 ? Math.min(1, (d + 1) / feather) : 1;
      const i = (y * dst.w + x) * 4;
      for (let c = 0; c < 3; c++) dst.data[i + c] = Math.round(Math.max(0, Math.min(255, dst.data[i + c] * (1 - t) + (src.data[i + c] + off[c]) * t)));
      dst.data[i + 3] = 255;
    }
  }
}


// ---- localize JS 메우기 v2: 2차원(Coons) 보간 + 가장자리 페더 + 이음새 ΔE ----
// mode "interp": 네 변 둘레색(행별 좌·우, 열별 위·아래)으로 Coons 면 보간 — 가로·세로 그라데이션이 함께 있어도 자연스럽다.
// mode "solid": color 한 색. 둘 다 사각형 바깥 feather px 까지 같은 모델로 연장해 원본과 섞는다(가장자리 6~10px 페더 — 채움 사각형 윤곽이 안 보이게).
// 반환 { seam: 사각형 둘레(안쪽 1px 채움 vs 바깥 2px 원본) 평균 ΔE, n: 메운 픽셀 수, undo() }
export function fillPatch(bm, rect, { mode = "interp", color = null, stats = null, ring = 4, feather = 8 } = {}) {
  const W = bm.w, H = bm.h;
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(W, Math.round(rect.x + rect.w)), y1 = Math.min(H, Math.round(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return { seam: 0, n: 0, undo() {} };
  const st = stats || estimateBackground(bm, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, ring);
  const base = color || st.color;
  const g = st.gradient;
  const fillArr = (arr) => { // 빈 칸(null)은 가까운 값으로
    const out = arr.slice(); let last = null;
    for (let i = 0; i < out.length; i++) { if (out[i]) last = out[i]; else if (last) out[i] = last; }
    last = null; for (let i = out.length - 1; i >= 0; i--) { if (out[i]) last = out[i]; else out[i] = last || base; }
    return out;
  };
  const L = fillArr(g.left), R = fillArr(g.right), T = fillArr(g.top), B = fillArr(g.bottom);
  const nx = x1 - x0, ny = y1 - y0;
  const cTL = avg([T[0], L[0]]), cTR = avg([T[nx - 1], R[0]]), cBL = avg([B[0], L[ny - 1]]), cBR = avg([B[nx - 1], R[ny - 1]]);
  const model = (x, y) => { // 사각형 밖 좌표는 가장자리로 고정해서 같은 모델 연장
    if (mode === "solid") return base;
    const ix = Math.max(0, Math.min(nx - 1, x - x0)), iy = Math.max(0, Math.min(ny - 1, y - y0));
    const u = nx > 1 ? ix / (nx - 1) : 0.5, v = ny > 1 ? iy / (ny - 1) : 0.5;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const lr = L[iy][c] * (1 - u) + R[iy][c] * u, tb = T[ix][c] * (1 - v) + B[ix][c] * v;
      const bil = cTL[c] * (1 - u) * (1 - v) + cTR[c] * u * (1 - v) + cBL[c] * (1 - u) * v + cBR[c] * u * v;
      out[c] = lr + tb - bil; // Coons 면
    }
    return out;
  };
  // 이음새 ΔE(메우기 전 원본 기준): 안쪽 1px 모델 vs 바깥 2px 원본
  let seam = 0, sn = 0;
  const probe = (xi, yi, xo, yo) => { if (xo < 0 || yo < 0 || xo >= W || yo >= H) return; const m = model(xi, yi), i = (yo * W + xo) * 4; seam += (Math.abs(m[0] - bm.data[i]) + Math.abs(m[1] - bm.data[i + 1]) + Math.abs(m[2] - bm.data[i + 2])) / 3; sn++; };
  for (let x = x0; x < x1; x += 2) { probe(x, y0, x, y0 - 2); probe(x, y1 - 1, x, y1 + 1); }
  for (let y = y0; y < y1; y += 2) { probe(x0, y, x0 - 2, y); probe(x1 - 1, y, x1 + 1, y); }
  // 되돌리기용 백업(페더 띠 포함)
  const fx0 = Math.max(0, x0 - feather), fy0 = Math.max(0, y0 - feather), fx1 = Math.min(W, x1 + feather), fy1 = Math.min(H, y1 + feather);
  const backup = Buffer.alloc((fx1 - fx0) * (fy1 - fy0) * 4);
  for (let y = fy0; y < fy1; y++) bm.data.copy(backup, (y - fy0) * (fx1 - fx0) * 4, (y * W + fx0) * 4, (y * W + fx1) * 4);
  let n = 0;
  for (let y = fy0; y < fy1; y++) for (let x = fx0; x < fx1; x++) {
    const out = Math.max(x0 - x, x - (x1 - 1), y0 - y, y - (y1 - 1), 0); // 사각형 밖으로 몇 px
    const t = out === 0 ? 1 : feather > 0 ? Math.max(0, 1 - out / feather) : 0;
    if (t <= 0) continue;
    const m = model(x, y), i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) bm.data[i + c] = Math.max(0, Math.min(255, Math.round(bm.data[i + c] * (1 - t) + m[c] * t))); // Coons 면은 0~255 를 넘을 수 있다 — 안 자르면 Buffer 가 감싸서 하늘색 얼룩(커피 랙 d07)
    bm.data[i + 3] = 255; n++;
  }
  return { seam: sn ? seam / sn : 0, n, undo() { for (let y = fy0; y < fy1; y++) backup.copy(bm.data, (y * W + fx0) * 4, (y - fy0) * (fx1 - fx0) * 4, (y - fy0 + 1) * (fx1 - fx0) * 4); } };
}


// ─────────── localize v11: 지우기 품질(2026-10-12 대표님 "총체적 난국" — 흐린 사각형·잔상) ───────────
// 원칙: ① 평평한 바탕 = 둘레 스포이드 색으로 딱 떨어지게(페더·흐림 없음) ② 매끈한 그라데이션 = 둘레로 1·2차 면을 맞춰 그대로 채움
//       ③ 그 밖(벽지 결·사진) = 질감 복제(옆 자리 같은 크기 조각) 또는 AI 결과를 "글자 모양 마스크"에만, 둘레에 맞춘 색 보정 후 붙임
//       ④ 지운 뒤 잔상 검사(경계 단차·색 얼룩·흐림·글자 남음) → 떨어지면 다른 방법으로 다시
const lumOf = (d, i) => 0.114 * d[i] + 0.587 * d[i + 1] + 0.299 * d[i + 2]; // BGRA
const inRect = (r, x, y, g = 0) => x >= r.x - g && x < r.x + r.w + g && y >= r.y - g && y < r.y + r.h + g;
const clipRect = (r, W, H) => { const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y)); return { x, y, w: Math.max(0, Math.min(W, Math.round(r.x + r.w)) - x), h: Math.max(0, Math.min(H, Math.round(r.y + r.h)) - y) }; };

// rect 바깥 [gap, gap+ring) 띠 픽셀 [{x,y,c:[b,g,r]}]. skip(x,y) 참이면 뺀다(옆 글자 영역 등)
export function ringPixels(bm, rect, { ring = 6, gap = 1, step = 1, skip = null } = {}) {
  const out = [];
  const x0 = Math.max(0, rect.x - gap - ring), y0 = Math.max(0, rect.y - gap - ring), x1 = Math.min(bm.w, rect.x + rect.w + gap + ring), y1 = Math.min(bm.h, rect.y + rect.h + gap + ring);
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    if (inRect(rect, x, y, gap)) continue;
    if (skip && skip(x, y)) continue;
    const i = (y * bm.w + x) * 4; out.push({ x, y, c: [bm.data[i], bm.data[i + 1], bm.data[i + 2]] });
  }
  return out;
}
// 작은 연립방정식(가우스 소거, n ≤ 6)
function solveLin(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// 둘레 픽셀로 면 맞추기: order 1 = 평면(가로·세로 그라데이션), 2 = 2차(완만한 비네팅). robust: 크게 벗어난 픽셀(옆 글자·선)은 빼고 다시
// 반환 { order, rmse(채널 평균 잔차), inliers(남은 비율), at(x,y)→[b,g,r] }
export function fitSurface(px, rect, { order = 1, robust = true } = {}) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, sx = Math.max(1, rect.w / 2 + 8), sy = Math.max(1, rect.h / 2 + 8);
  const basis = (x, y) => { const u = (x - cx) / sx, v = (y - cy) / sy; return order === 2 ? [1, u, v, u * u, u * v, v * v] : [1, u, v]; };
  const n = order === 2 ? 6 : 3;
  let use = px, coef = null, rmse = Infinity;
  const pred = (cf, x, y) => { const B = basis(x, y); return [0, 1, 2].map((ch) => B.reduce((s, v, k) => s + v * cf[ch][k], 0)); };
  for (let pass = 0; pass < (robust ? 3 : 1); pass++) {
    if (use.length < n * 4) break;
    const A = Array.from({ length: n }, () => new Array(n).fill(0)), bs = [0, 1, 2].map(() => new Array(n).fill(0));
    for (const p of use) { const B = basis(p.x, p.y); for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += B[i] * B[j]; for (let ch = 0; ch < 3; ch++) bs[ch][i] += B[i] * p.c[ch]; } }
    const cf = bs.map((b) => solveLin(A, b)); if (cf.some((c) => !c)) break;
    coef = cf;
    let s = 0; const res = use.map((p) => { const m = pred(cf, p.x, p.y); const e = (Math.abs(m[0] - p.c[0]) + Math.abs(m[1] - p.c[1]) + Math.abs(m[2] - p.c[2])) / 3; s += e * e; return e; });
    rmse = Math.sqrt(s / use.length);
    if (!robust) break;
    const thr = Math.max(5, rmse * 2.5), next = use.filter((_, i) => res[i] <= thr);
    if (next.length === use.length) break;
    use = next;
  }
  return { order, rmse: coef ? +rmse.toFixed(3) : Infinity, inliers: px.length ? use.length / px.length : 0, at: coef ? (x, y) => pred(coef, x, y) : () => [255, 255, 255] };
}
// 둘레 대표색(5비트 양자화 최빈 → 그 근처 평균)·비율·흔들림(sd)·두 번째 색 비율
function dominant(px, tol = 8) {
  const cnt = new Map();
  for (const p of px) { const k = (p.c[0] >> 3) * 1024 + (p.c[1] >> 3) * 32 + (p.c[2] >> 3); cnt.set(k, (cnt.get(k) || 0) + 1); }
  let best = 0, bn = -1; for (const [k, n] of cnt) if (n > bn) { bn = n; best = k; }
  const seed = [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
  const near = px.filter((p) => dist3(p.c, seed) <= tol + 6).map((p) => p.c);
  const color = avg(near) || seed;
  let sd = 0; for (const c of near) sd += dist3(c, color) ** 2; sd = near.length ? Math.sqrt(sd / near.length) : 0;
  const rest = px.filter((p) => dist3(p.c, seed) > tol + 6).map((p) => p.c);
  let frac2 = 0; if (rest.length) { const m2 = avg(rest); frac2 = rest.filter((c) => dist3(c, m2) <= 30).length / px.length; }
  return { color, frac: px.length ? near.length / px.length : 0, sd, frac2 };
}
// 지우기 방식 결정(둘레 링을 잰다):
//  solid    — 둘레의 flatFrac(90%) 이상이 한 색이고 흔들림 ≤ flatSd → 그 색 그대로(스포이드)
//  gradient — 1차(평면) 또는 2차 면이 둘레를 잔차 ≤ maxRmse 로 설명(인쇄 그라데이션·완만한 조명)
//  texture  — 고른 결(벽지·천): 넓은 허용 안에 둘레 85% 이상 + 네 변 평균이 비슷 → 질감 복제 후보(AI 도 함께 비교)
//  complex  — 그 밖(사진·제품 위·무늬) → AI(없으면 복제·보간 중 잔상 검사 통과하는 것)
export function decideFill(bm, rect, { ring = 6, skip = null, flatFrac = 0.9, flatSd = 2.5, maxRmse = 2.2, minInliers = 0.9 } = {}) {
  const step = rect.w * rect.h > 60000 ? 2 : 1;
  const px = ringPixels(bm, rect, { ring, gap: 1, step, skip });
  if (px.length < 24) return { mode: "complex", why: "둘레 부족" };
  const d = dominant(px);
  const base = { frac: +d.frac.toFixed(3), sd: +d.sd.toFixed(2) };
  if (d.frac >= flatFrac && d.sd <= flatSd) return { mode: "solid", color: d.color, ...base };
  base.color = d.color; // texture·complex 도 둘레 대표색(글자 마스크 기준)
  if (d.frac >= 0.5 && d.frac + d.frac2 >= 0.95 && d.sd <= flatSd) return { mode: "solid", color: d.color, line: true, ...base }; // 한 색 바탕 + 선(지울 영역은 선 앞에서 멈춘 상태)
  for (const order of [1, 2]) {
    const s = fitSurface(px, rect, { order });
    if (s.rmse <= maxRmse && s.inliers >= minInliers) return { mode: "gradient", surface: s, rmse: s.rmse, order, ...base };
  }
  const tol = Math.max(20, d.sd * 3.5);
  const fracT = px.filter((p) => dist3(p.c, d.color) <= tol).length / px.length;
  const side = (f) => avg(px.filter(f).map((p) => p.c));
  const sides = [side((p) => p.y < rect.y), side((p) => p.y >= rect.y + rect.h), side((p) => p.x < rect.x), side((p) => p.x >= rect.x + rect.w)].filter(Boolean);
  let spread = 0; for (const a of sides) for (const b of sides) spread = Math.max(spread, dist3(a, b));
  if (fracT >= 0.85 && spread <= 14) return { mode: "texture", color: d.color, tol, spread: +spread.toFixed(1), ...base };
  return { mode: "complex", spread: +spread.toFixed(1), ...base };
}
// 단색·면으로 사각형을 딱 떨어지게 채운다(페더 없음). 반환 { n, undo() }
// clip(x, y): 참인 픽셀만 칠한다(v13 — 원·알약 안 글을 지울 때 도형 밖으로 사각형이 튀어나오지 않게)
export function fillSurface(bm, rect, { color = null, surface = null, clip = null } = {}) {
  const r = clipRect(rect, bm.w, bm.h);
  const backup = snapshot(bm, r);
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (clip && !clip(x, y)) continue;
    const m = surface ? surface.at(x, y) : color, i = (y * bm.w + x) * 4;
    bm.data[i] = Math.round(Math.max(0, Math.min(255, m[0]))); bm.data[i + 1] = Math.round(Math.max(0, Math.min(255, m[1]))); bm.data[i + 2] = Math.round(Math.max(0, Math.min(255, m[2]))); bm.data[i + 3] = 255;
  }
  return { n: r.w * r.h, undo: () => restore(bm, backup) };
}
export function snapshot(bm, rect) {
  const r = clipRect(rect, bm.w, bm.h), buf = Buffer.alloc(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) bm.data.copy(buf, y * r.w * 4, ((r.y + y) * bm.w + r.x) * 4, ((r.y + y) * bm.w + r.x + r.w) * 4);
  return { r, buf };
}
export function restore(bm, { r, buf }) { for (let y = 0; y < r.h; y++) buf.copy(bm.data, ((r.y + y) * bm.w + r.x) * 4, y * r.w * 4, (y + 1) * r.w * 4); }

// 마스크(rect 기준 Uint8Array) 를 r px 넓힌다(정사각 팽창, 가로·세로 분리)
export function dilateMask(m, w, h, r) {
  if (r <= 0) return m;
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; if (x - last <= r) t[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= r) o[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; } }
  return o;
}
// 글자 모양 마스크: rect 안에서 바탕 예측(bgAt 또는 color)과 tol 넘게 다른 픽셀(글자 획·그림자·외곽선) → dilate px 넓힘
// soft(px): 옅은 그림자·번짐도 잡는다 — soft×soft 상자 평균 밝기가 바탕보다 softTol 넘게 다르면 글자 쪽(결 잡음은 평균에서 사라지고 넓은 그림자만 남는다)
export function inkMask(bm, rect, { color = null, bgAt = null, tol = 24, dilate = 2, soft = 0, softTol = 4 } = {}) {
  const r = clipRect(rect, bm.w, bm.h), m = new Uint8Array(r.w * r.h);
  let n = 0;
  const dl = soft ? new Float32Array(r.w * r.h) : null;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const i = ((r.y + y) * bm.w + r.x + x) * 4, c = [bm.data[i], bm.data[i + 1], bm.data[i + 2]], b = bgAt ? bgAt(r.x + x, r.y + y) : color;
    if (dist3(c, b) > tol) { m[y * r.w + x] = 1; n++; }
    if (dl) dl[y * r.w + x] = lumOf(bm.data, i) - (0.114 * b[0] + 0.587 * b[1] + 0.299 * b[2]);
  }
  if (dl) { // 적분 영상으로 상자 평균
    const I = new Float64Array((r.w + 1) * (r.h + 1));
    for (let y = 0; y < r.h; y++) { let row = 0; for (let x = 0; x < r.w; x++) { row += dl[y * r.w + x]; I[(y + 1) * (r.w + 1) + x + 1] = I[y * (r.w + 1) + x + 1] + row; } }
    const h = Math.max(1, Math.floor(soft / 2));
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const x0 = Math.max(0, x - h), x1 = Math.min(r.w, x + h + 1), y0 = Math.max(0, y - h), y1 = Math.min(r.h, y + h + 1);
      const sum = I[y1 * (r.w + 1) + x1] - I[y0 * (r.w + 1) + x1] - I[y1 * (r.w + 1) + x0] + I[y0 * (r.w + 1) + x0];
      if (Math.abs(sum / ((x1 - x0) * (y1 - y0))) > softTol) m[y * r.w + x] = 1;
    }
  }
  return { rect: r, mask: dilateMask(m, r.w, r.h, dilate), ink: n / Math.max(1, r.w * r.h) };
}
// 마스크 → 붙이기 가중치(마스크 안 1, 바깥 f px 에 걸쳐 1→0). rect 를 f 만큼 넓힌 영역 기준
export function maskWeights(mask, rect, f = 2, W = Infinity, H = Infinity) {
  const R = clipRect({ x: rect.x - f, y: rect.y - f, w: rect.w + f * 2, h: rect.h + f * 2 }, W, H);
  const big = new Uint8Array(R.w * R.h);
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) if (mask[y * rect.w + x]) { const X = rect.x + x - R.x, Y = rect.y + y - R.y; if (X >= 0 && Y >= 0 && X < R.w && Y < R.h) big[Y * R.w + X] = 1; }
  const wt = new Float32Array(R.w * R.h);
  for (let i = 0; i < big.length; i++) if (big[i]) wt[i] = 1;
  let cur = big;
  for (let d = 1; d <= f; d++) { const nx = dilateMask(cur, R.w, R.h, 1); const v = 1 - d / (f + 1); for (let i = 0; i < nx.length; i++) if (nx[i] && !wt[i]) wt[i] = v; cur = nx; }
  return { rect: R, w: wt };
}
// 색 맞춤 계수: 둘레 띠(rect 바깥 ring px, skip 제외)에서 dst ≈ a·src + b (채널별 최소제곱, a 0.75~1.33)
export function colorFit(dst, src, rect, { ring = 8, skip = null } = {}) {
  const px = ringPixels(dst, rect, { ring, gap: 2, step: rect.w * rect.h > 60000 ? 2 : 1, skip });
  const fit = [0, 1, 2].map(() => ({ a: 1, b: 0 }));
  if (px.length < 16) return { fit, n: px.length, rms: null };
  let rms = 0;
  for (let ch = 0; ch < 3; ch++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = px.length;
    for (const p of px) { const i = (p.y * src.w + p.x) * 4, x = src.data[i + ch], y = p.c[ch]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const vx = sxx / n - (sx / n) ** 2, cxy = sxy / n - (sx / n) * (sy / n);
    let a = vx > 4 ? cxy / vx : 1; a = Math.max(0.75, Math.min(1.33, a));
    const b = sy / n - a * (sx / n);
    fit[ch] = { a, b };
    for (const p of px) { const i = (p.y * src.w + p.x) * 4; rms += (a * src.data[i + ch] + b - p.c[ch]) ** 2; }
  }
  return { fit, n: px.length, rms: +Math.sqrt(rms / (px.length * 3)).toFixed(2) };
}
// 가중치 붙이기: dst = dst·(1−w) + (a·src(x+dx,y+dy) + b)·w
export function pasteWeighted(dst, src, { rect, w }, fit = null, dx = 0, dy = 0) {
  const F = fit || [0, 1, 2].map(() => ({ a: 1, b: 0 }));
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    const t = w[y * rect.w + x]; if (!t) continue;
    const X = rect.x + x, Y = rect.y + y, sX = X + dx, sY = Y + dy;
    if (sX < 0 || sY < 0 || sX >= src.w || sY >= src.h) continue;
    const i = (Y * dst.w + X) * 4, j = (sY * src.w + sX) * 4;
    for (let c = 0; c < 3; c++) dst.data[i + c] = Math.round(Math.max(0, Math.min(255, dst.data[i + c] * (1 - t) + (F[c].a * src.data[j + c] + F[c].b) * t)));
    dst.data[i + 3] = 255;
  }
}
// AI 결과 붙이기(v11): ① 둘레 띠로 채널별 gain·offset 맞춤 ② 붙일 곳 = 원본과 (보정한) AI 가 다른 픽셀(= AI 가 지운 글자·그림자) ∪ 글자 마스크, 조금 넓힘
// ③ 마스크 가장자리만 f px 부드럽게. 반환 { fit, coverage(영역 중 바뀐 비율), undo }
// near(px): ink 를 주면 바뀐 픽셀도 글자 획에서 이 거리 안만 붙인다(v13 — AI 가 벽 결을 뭉개거나 글 옆 장식(주황 곡선)까지 지운 것을 영역 사각형째 붙여
//   흐린 사각형·잘린 장식이 남던 것, 컵홀더 d03). 0 이면 예전처럼 바뀐 픽셀 전부
export function pasteAiPatch(dst, ai, area, { ring = 8, skip = null, diffTol = 22, dilate = 3, feather = 2, ink = null, near = 0 } = {}) {
  const r = clipRect(area, dst.w, dst.h);
  const cf = colorFit(dst, ai, r, { ring, skip });
  const m = new Uint8Array(r.w * r.h); let n = 0;
  const zone = ink && near ? dilateMask(ink, r.w, r.h, near) : null;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const i = ((r.y + y) * dst.w + r.x + x) * 4; let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(dst.data[i + c] - (cf.fit[c].a * ai.data[i + c] + cf.fit[c].b));
    if ((d / 3 > diffTol && (!zone || zone[y * r.w + x])) || (ink && ink[y * r.w + x])) { m[y * r.w + x] = 1; n++; }
  }
  const mk = dilateMask(m, r.w, r.h, dilate);
  const wts = maskWeights(mk, r, feather, dst.w, dst.h);
  const back = snapshot(dst, wts.rect);
  pasteWeighted(dst, ai, wts, cf.fit);
  return { fit: cf, coverage: +(n / Math.max(1, r.w * r.h)).toFixed(3), undo: () => restore(dst, back) };
}
// 질감 복제: 같은 크기 조각을 위·아래·옆에서 찾아(둘레 띠가 가장 닮은 곳, 다른 글자 영역은 피함) 글자 마스크에만 붙인다(평균 색 차이 보정).
// avoid: 피할 사각형들(모든 글자 영역). 반환 { ok, score, dx, dy, undo }
// bgColor·tol 을 주면 가져올 조각 안에 바탕과 다른 픽셀(선·아이콘·글자)이 1.5% 넘게 있는 자리는 쓰지 않는다
// ringAvoid: 둘레 비교에서 뺄 사각형(기본 avoid — 조각 복제는 자기 영역 안 칸의 둘레도 쓰도록 다른 글 영역만 넘긴다)
// meanAt(x,y): 이 자리에 있어야 할 바탕 평균색(둘레 면) — 주면 가져온 조각의 평균을 그 색에 맞춘다(칸 복제: 조명 기울기 때문에 칸마다 밝기가 달라 보이는 것 방지)
export function cloneFill(bm, rect, { avoid = [], ringAvoid = null, mask = null, feather = 2, ring = 4, maxCand = 900, bgColor = null, tol = 28, emptyRingOk = false, meanAt = null } = {}) {
  const r = clipRect(rect, bm.w, bm.h);
  if (!r.w || !r.h) return { ok: false };
  const ra = ringAvoid || avoid;
  const T = ringPixels(bm, r, { ring, gap: 1, step: r.w * r.h > 40000 ? 3 : 2, skip: (x, y) => ra.some((a) => a !== rect && inRect(a, x, y, 1)) });
  if (T.length < 12 && !(emptyRingOk && bgColor)) return { ok: false }; // 조각(칸) 복제의 안쪽 칸은 둘레가 다 글 영역 — 바탕색 깨끗한 가까운 조각이면 된다
  const sy = Math.max(2, Math.round(r.h / 3)), sx = Math.max(3, Math.round(r.w / 8));
  const cands = [];
  const ry = Math.max(r.h * 4, 160), rx = Math.max(r.w * 2, 160); // 작은 조각도 160px 안은 찾아본다
  for (let dy = -ry; dy <= ry; dy += sy) for (let dx = -rx; dx <= rx; dx += sx) {
    if (Math.abs(dx) < r.w + ring * 2 && Math.abs(dy) < r.h + ring * 2) continue; // 자기 자신과 겹침
    const S = { x: r.x + dx - ring - 1, y: r.y + dy - ring - 1, w: r.w + ring * 2 + 2, h: r.h + ring * 2 + 2 };
    if (S.x < 0 || S.y < 0 || S.x + S.w > bm.w || S.y + S.h > bm.h) continue;
    if (avoid.some((a) => a.x < S.x + S.w + 2 && S.x < a.x + a.w + 2 && a.y < S.y + S.h + 2 && S.y < a.y + a.h + 2)) continue;
    cands.push({ dx, dy, d: Math.abs(dx) + Math.abs(dy) });
  }
  if (!cands.length) return { ok: false };
  cands.sort((a, b) => a.d - b.d);
  let best = null;
  const cs = r.w * r.h > 20000 ? 3 : 2;
  const dirty = (c) => { if (!bgColor) return false; let n = 0, bad = 0; for (let y = r.y; y < r.y + r.h; y += cs) for (let x = r.x; x < r.x + r.w; x += cs) { const i = ((y + c.dy) * bm.w + x + c.dx) * 4; n++; if (dist3([bm.data[i], bm.data[i + 1], bm.data[i + 2]], bgColor) > tol) bad++; } return bad / n > 0.015; };
  for (const c of cands.slice(0, maxCand)) {
    if (dirty(c)) continue;
    const off = [0, 0, 0]; let s = 0;
    for (const p of T) { const i = ((p.y + c.dy) * bm.w + p.x + c.dx) * 4; for (let ch = 0; ch < 3; ch++) off[ch] += p.c[ch] - bm.data[i + ch]; }
    for (let ch = 0; ch < 3; ch++) off[ch] /= Math.max(1, T.length);
    for (const p of T) { const i = ((p.y + c.dy) * bm.w + p.x + c.dx) * 4; s += (Math.abs(p.c[0] - bm.data[i] - off[0]) + Math.abs(p.c[1] - bm.data[i + 1] - off[1]) + Math.abs(p.c[2] - bm.data[i + 2] - off[2])) / 3; }
    const score = s / Math.max(1, T.length) + (Math.abs(off[0]) + Math.abs(off[1]) + Math.abs(off[2])) / 3 * 0.3 + c.d / Math.max(r.w, r.h) * 0.15; // 가까울수록 조금 유리
    if (!best || score < best.score) best = { ...c, off, score };
  }
  if (!best) return { ok: false };
  if (meanAt) { // 밝기 맞춤: 이 칸 안 글자 아닌 픽셀(원래 바탕)이 충분하면 그 자리의 원본 ↔ 가져올 조각 같은 자리 평균 차이로(국소 얼룩까지 맞음), 모자라면 둘레 면 예측으로
    const a = [0, 0, 0], b = [0, 0, 0]; let n = 0, tot = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { tot++; if (mask && mask[(y - r.y) * r.w + (x - r.x)]) continue; const i = (y * bm.w + x) * 4, j = ((y + best.dy) * bm.w + x + best.dx) * 4; for (let c = 0; c < 3; c++) { a[c] += bm.data[i + c]; b[c] += bm.data[j + c]; } n++; }
    if (mask && n >= Math.max(30, tot * 0.15)) best.off = a.map((v, c) => (v - b[c]) / n);
    else {
      const want = meanAt(r.x + r.w / 2, r.y + r.h / 2), m = [0, 0, 0]; let k = 0;
      for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) { const i = ((y + best.dy) * bm.w + x + best.dx) * 4; m[0] += bm.data[i]; m[1] += bm.data[i + 1]; m[2] += bm.data[i + 2]; k++; }
      if (k) best.off = want.map((v, c) => v - m[c] / k);
    }
  }
  const mk = mask || new Uint8Array(r.w * r.h).fill(1);
  const wts = maskWeights(mk, r, feather, bm.w, bm.h);
  const src = { data: Buffer.from(bm.data), w: bm.w, h: bm.h }; // 복사본에서 읽는다
  const back = snapshot(bm, wts.rect);
  pasteWeighted(bm, src, wts, best.off.map((b) => ({ a: 1, b })), best.dx, best.dy);
  return { ok: true, score: +best.score.toFixed(2), dx: best.dx, dy: best.dy, undo: () => restore(bm, back) };
}
// 잔상 검사(지운 뒤 최종 그림에서): 눈에 보이는 사각형·얼룩·흐림·남은 글자를 수치로.
//  edge  — 사각형 경계 안쪽 1~3px 와 바깥 1~3px 평균색 차이(8px 구간마다, 상위 10%) − 바깥끼리 자연 차이  → 단차(밝은/어두운 상자)
//  tone  — 안쪽을 칸으로 나눠 둘레 면(평면) 예측과의 최대 차이 → 색 얼룩(허용 = 6 + 0.5·둘레 잔차)
//  hf    — 안쪽 결(밝기 기울기 중앙값) ÷ 둘레 결: 둘레가 결 있는데 안이 매끈하면(< 0.6) 흐림, 훨씬 거칠면 글자 잔상
// strict: 결 있는 바탕(복제 후보) — 칸 평균이 아주 정확하므로 색 얼룩 허용을 좁힌다
export function residueCheck(bm, rect, { ring = 10, skip = null, strict = false } = {}) {
  const r = clipRect(rect, bm.w, bm.h), W = bm.w, H = bm.h, d = bm.data;
  if (r.w < 4 || r.h < 4) return { pass: true, edge: 0, tone: 0, hf: 1, why: "" };
  const g = (x, y) => { if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return null; const i = (y * W + x) * 4; return Math.abs(lumOf(d, i + 4) - lumOf(d, i - 4)) + Math.abs(lumOf(d, i + W * 4) - lumOf(d, i - W * 4)); };
  const med = (a) => { if (!a.length) return 0; const b = Float32Array.from(a).sort(); return b[Math.floor(b.length / 2)]; };
  const gIn = [], gOut = [];
  const st = r.w * r.h > 40000 ? 2 : 1;
  for (let y = r.y + 2; y < r.y + r.h - 2; y += st) for (let x = r.x + 2; x < r.x + r.w - 2; x += st) { const v = g(x, y); if (v != null) gIn.push(v); }
  const ringPx = ringPixels(bm, r, { ring, gap: 2, step: st, skip });
  for (const p of ringPx) { const v = g(p.x, p.y); if (v != null) gOut.push(v); }
  const inG = med(gIn), outG = med(gOut), hf = +((inG + 0.5) / (outG + 0.5)).toFixed(2);
  // 경계 단차
  const meanBand = (x0, y0, x1, y1) => { let s0 = 0, s1 = 0, s2 = 0, n = 0; for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) { if (skip && skip(x, y)) continue; const i = (y * W + x) * 4; s0 += d[i]; s1 += d[i + 1]; s2 += d[i + 2]; n++; } return n >= 4 ? [s0 / n, s1 / n, s2 / n] : null; };
  const steps = [], nat = [], L = 8;
  const side = (horiz, pos, dirOut) => { // horiz: 위/아래 변(pos = y 경계), dirOut = −1(위·왼) / +1(아래·오른)
    const len = horiz ? r.w : r.h, o = horiz ? r.x : r.y;
    for (let k = 0; k + L <= len; k += L) {
      const a = o + k, b = a + L;
      const band = (d0, d1) => (horiz ? (dirOut < 0 ? meanBand(a, pos - d1, b, pos - d0) : meanBand(a, pos + d0, b, pos + d1)) : (dirOut < 0 ? meanBand(pos - d1, a, pos - d0, b) : meanBand(pos + d0, a, pos + d1, b)));
      const inner = horiz ? (dirOut < 0 ? meanBand(a, pos + 1, b, pos + 4) : meanBand(a, pos - 4, b, pos - 1)) : (dirOut < 0 ? meanBand(pos + 1, a, pos + 4, b) : meanBand(pos - 4, a, pos - 1, b));
      const out1 = band(1, 4), out2 = band(4, 7);
      if (inner && out1) steps.push(dist3(inner, out1));
      if (out1 && out2) nat.push(dist3(out1, out2));
    }
  };
  side(true, r.y, -1); side(true, r.y + r.h, 1); side(false, r.x, -1); side(false, r.x + r.w, 1);
  const p90 = (a) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length * 0.9)]; };
  const edge = +Math.max(0, p90(steps) - p90(nat)).toFixed(2);
  // 색 얼룩: 안쪽 칸 평균을 세 가지 "있을 법한 바탕"과 비교해 가장 잘 맞는 것으로 판단 — 평면(그라데이션) · 세로 결(칸 위·아래 둘레 직선 보간, 커튼 주름) · 가로 결(왼·오른 둘레)
  //   셋 다 안 맞으면(밝은/어두운 상자·남은 글자) 색 얼룩
  let tone = 0, tonThr = 99;
  const cs = Math.max(8, Math.min(24, Math.round(r.h / 2)));
  const cells = [];
  for (let cy = r.y; cy < r.y + r.h; cy += cs) for (let cx = r.x; cx < r.x + r.w; cx += cs) { const x1 = Math.min(r.x + r.w, cx + cs), y1 = Math.min(r.y + r.h, cy + cs), m = meanBand(cx, cy, x1, y1); if (m) cells.push({ cx, cy, x1, y1, m }); }
  const preds = [];
  if (ringPx.length >= 24) { const s = fitSurface(ringPx, r, { order: 1 }); preds.push({ thr: strict ? 4.5 + 0.25 * Math.min(20, s.rmse) : 6 + 0.5 * Math.min(20, s.rmse), at: (c) => s.at((c.cx + c.x1) / 2, (c.cy + c.y1) / 2) }); } // 칸 평균은 픽셀 잡음을 거의 지우므로 둘레 잔차는 조금만 봐준다
  // 둘레가 다른 글자 영역(skip)이면 그 너머(최대 글 높이 3배)까지 가서 잰다 — 위치(pos)도 함께 돌려 직선 보간
  const far = (f) => { for (let d = 2; d <= Math.max(12, r.h * 3); d += 5) { const m = f(d); if (m) return { m, d }; } return null; };
  const lerpAt = (a, b, pa, pb, p) => (a && b ? a.m.map((v, i) => v + (b.m[i] - v) * ((p - pa) / Math.max(1, pb - pa))) : a ? a.m : b ? b.m : null);
  preds.push({ thr: 8, at: (c) => { const a = far((d) => meanBand(c.cx, r.y - d - 5, c.x1, r.y - d)), b = far((d) => meanBand(c.cx, r.y + r.h + d, c.x1, r.y + r.h + d + 5)); return lerpAt(a, b, r.y - (a?.d || 0) - 2.5, r.y + r.h + (b?.d || 0) + 2.5, (c.cy + c.y1) / 2); } });
  preds.push({ thr: 8, at: (c) => { const a = far((d) => meanBand(r.x - d - 5, c.cy, r.x - d, c.y1)), b = far((d) => meanBand(r.x + r.w + d, c.cy, r.x + r.w + d + 5, c.y1)); return lerpAt(a, b, r.x - (a?.d || 0) - 2.5, r.x + r.w + (b?.d || 0) + 2.5, (c.cx + c.x1) / 2); } });
  let bestGap = Infinity;
  for (const p of preds) {
    let dev = 0, ok = cells.length > 0;
    for (const c of cells) { const q = p.at(c); if (!q) { ok = false; break; } dev = Math.max(dev, dist3(c.m, q)); }
    if (ok && dev - p.thr < bestGap) { bestGap = dev - p.thr; tone = dev; tonThr = p.thr; }
  }
  tone = +tone.toFixed(2);
  // 조각 얼룩(blk): 12px 칸 평균 밝기의 흔들림(둘레 면 기울기를 뺀 것)을 안쪽과 바깥 띠에서 비교 — 칸 복제·AI 조각의 밝기가 칸마다 달라 "옅은 사각형"이 보이는 것.
  //  결 있는 바탕(strict)에서만 본다(사진은 원래 얼룩덜룩) — 2026-10-12 d01 제목 자리: 64px 칸 복제 1.47·2.32(눈에 보임), 결 합성 0.31·0.22
  let blk = 0, blkIn = 0, blkOut = 0;
  if (ringPx.length >= 24) {
    const sf = fitSurface(ringPx, r, { order: 1 }), c2 = 12, E = 24, ins = [], outs = [];
    const lumAt = (c) => 0.114 * c[0] + 0.587 * c[1] + 0.299 * c[2];
    for (let cy = r.y - E; cy < r.y + r.h + E; cy += c2) for (let cx = r.x - E; cx < r.x + r.w + E; cx += c2) {
      const x1 = cx + c2, y1 = cy + c2, inside = cx >= r.x && cy >= r.y && x1 <= r.x + r.w && y1 <= r.y + r.h, outside = x1 <= r.x || cx >= r.x + r.w || y1 <= r.y || cy >= r.y + r.h;
      if (!inside && !outside) continue;
      const m = meanBand(cx, cy, x1, y1); if (!m) continue;
      if (outside && skip) { let sk = 0; for (let y = cy; y < y1; y += 4) for (let x = cx; x < x1; x += 4) if (skip(x, y)) sk++; if (sk) continue; }
      (inside ? ins : outs).push(lumAt(m) - lumAt(sf.at(cx + c2 / 2, cy + c2 / 2)));
    }
    const sd = (a) => { if (a.length < 4) return null; const md = (b) => { const q = [...b].sort((x, y) => x - y); return q[Math.floor(q.length / 2)]; }; const m0 = md(a); return 1.4826 * md(a.map((v) => Math.abs(v - m0))); }; // 중앙값 절대편차(바깥의 선·커튼 칸 같은 튀는 칸에 흔들리지 않게)
    const si = sd(ins), so = sd(outs);
    if (si != null && so != null) { blkIn = +si.toFixed(2); blkOut = +so.toFixed(2); blk = +(si - so).toFixed(2); }
  }
  const why = [];
  if (strict && blkIn > 1.0 && blkIn > blkOut * 0.6) why.push(`조각 얼룩 ${blkIn}/${blkOut}`); // 실측: 칸 복제 얼룩 1.5~2.3, 결 합성·같은 조각 복제 0.2~0.9(바깥 띠는 선·커튼이 섞여 크게 나와 0.6배만 비교)
  if (edge > 5) why.push(`경계 단차 ${edge}`);
  if (tone > tonThr) why.push(`색 얼룩 ${tone}`);
  if (outG >= 3 && hf < 0.6) why.push(`흐림 ${hf}`);
  if (inG > outG * 2.5 + 4) why.push(`글자 잔상 ${hf}`);
  return { pass: !why.length, edge, tone, toneMax: +tonThr.toFixed(1), hf, outG: +outG.toFixed(2), blkIn, blkOut, why: why.join(" · ") };
}
// 바탕색 격자(렌더 때 글자 밑 실제 바탕 대비·글 상자 넓히기 판단용): cell px 칸마다 평균색 → { cell, cols, rows, c: "rrggbb…"(칸마다 6자리) }
// s: 칸마다 밝기 흔들림(표준편차, 0~35 → base36 한 글자) — 글자·제품 윤곽이 있는 칸은 커서 "빈 바탕"이 아니다
export function colorGrid(bm, cell = 24) {
  const cols = Math.ceil(bm.w / cell), rows = Math.ceil(bm.h / cell);
  let c = "", sd = "";
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    let s0 = 0, s1 = 0, s2 = 0, n = 0, l1 = 0, l2 = 0;
    for (let y = gy * cell; y < Math.min(bm.h, (gy + 1) * cell); y += 2) for (let x = gx * cell; x < Math.min(bm.w, (gx + 1) * cell); x += 2) { const i = (y * bm.w + x) * 4; s0 += bm.data[i]; s1 += bm.data[i + 1]; s2 += bm.data[i + 2]; const L = lumOf(bm.data, i); l1 += L; l2 += L * L; n++; }
    c += toHex(n ? [s0 / n, s1 / n, s2 / n] : [255, 255, 255]).slice(1);
    sd += Math.min(35, Math.round(n ? Math.sqrt(Math.max(0, l2 / n - (l1 / n) ** 2)) : 0)).toString(36);
  }
  return { cell, cols, rows, c, s: sd };
}
// 조각 나눠 복제: 큰 글자 영역은 같은 크기의 깨끗한 조각을 찾기 어렵다 → 글자 높이 정도의 칸으로 나눠 칸마다 cloneFill(글자 마스크가 있는 칸만)
export function cloneTiles(bm, rect, { avoid = [], mask = null, bgColor = null, tol = 28, tile = 0, feather = 2 } = {}) {
  const r = clipRect(rect, bm.w, bm.h); if (!r.w || !r.h) return { ok: false };
  if (!tile && r.h > 32) { const a = cloneTiles(bm, rect, { avoid, mask, bgColor, tol, tile: Math.min(64, r.h), feather }); if (a.ok) return a; return cloneTiles(bm, rect, { avoid, mask, bgColor, tol, tile: 32, feather }); } // 큰 칸이 안 되면 작은 칸(32px)으로
  const ts = tile || Math.max(24, Math.min(64, r.h));
  const back = snapshot(bm, expandRect(r, feather + 1, bm.w, bm.h));
  const others = avoid.filter((a) => a !== rect);
  const rp = ringPixels(bm, r, { ring: 8, gap: 2, step: 2, skip: (x, y) => others.some((a) => inRect(a, x, y, 1)) }), sf = rp.length >= 24 ? fitSurface(rp, r, { order: 1 }) : null; // 칸마다 맞출 바탕 밝기(조명 기울기)
  let n = 0, miss = 0, score = 0;
  for (let y = r.y; y < r.y + r.h; y += ts) for (let x = r.x; x < r.x + r.w; x += ts) {
    const t = { x, y, w: Math.min(ts, r.x + r.w - x), h: Math.min(ts, r.y + r.h - y) };
    let sub = null;
    if (mask) { sub = new Uint8Array(t.w * t.h); let any = 0; for (let yy = 0; yy < t.h; yy++) for (let xx = 0; xx < t.w; xx++) { const v = mask[(t.y - r.y + yy) * r.w + (t.x - r.x + xx)]; sub[yy * t.w + xx] = v; any |= v; } if (!any) continue; }
    const c = cloneFill(bm, t, { avoid: [...others, rect], mask: sub, bgColor, tol, feather, maxCand: 600, emptyRingOk: true, meanAt: sf ? (x, y) => sf.at(x, y) : null });
    if (c.ok) { n++; score += c.score; } else miss++;
  }
  if (!n || miss) { restore(bm, back); return { ok: false, miss }; } // 한 칸이라도 못 찾으면 쓰지 않는다(글자 일부가 남는다)
  return { ok: true, tiles: n, score: +(score / n).toFixed(2), undo: () => restore(bm, back) };
}
// 결 방향 채움: 세로 결(커튼 주름·세로 줄)은 열마다 위·아래 둘레를, 가로 결은 행마다 왼·오른 둘레를 직선 보간 — 결을 가로지르는 흐림이 없다.
// 둘레가 다른 글자 영역(skip)이면 그 너머까지 가서 잰다. mask 가 있으면 글자 픽셀에만(가장자리 feather px)
export function lineFill(bm, rect, { dir = "v", skip = null, band = 3, mask = null, feather = 2 } = {}) {
  const r = clipRect(rect, bm.w, bm.h), W = bm.w, H = bm.h; if (!r.w || !r.h) return { ok: false };
  const at = (x, y) => { const i = (y * W + x) * 4; return [bm.data[i], bm.data[i + 1], bm.data[i + 2]]; };
  const side = (fixed, from, step, lim) => { // fixed: 열(세로) 또는 행(가로) 위치, from 에서 step 방향으로 skip 밖 첫 band 줄 평균
    let p = from; while (p >= 0 && p < lim && skip && (dir === "v" ? skip(fixed, p) : skip(p, fixed))) p += step;
    const got = []; for (let k = 0; k < band && p >= 0 && p < lim; k++, p += step) got.push(dir === "v" ? at(fixed, p) : at(p, fixed));
    return got.length ? avg(got) : null;
  };
  const len = dir === "v" ? r.w : r.h, span = dir === "v" ? r.h : r.w;
  const A = [], B = [];
  for (let k = 0; k < len; k++) { const f = (dir === "v" ? r.x : r.y) + k; A.push(side(f, (dir === "v" ? r.y : r.x) - 2, -1, dir === "v" ? H : W)); B.push(side(f, (dir === "v" ? r.y + r.h : r.x + r.w) + 1, 1, dir === "v" ? H : W)); }
  if (A.filter(Boolean).length + B.filter(Boolean).length < len) return { ok: false };
  // 결 방향 확인: 양쪽 둘레 단면이 서로 닮아야(같은 줄무늬가 위·아래로 이어짐) 하고 단면에 무늬가 있어야 한다 — 아니면 이 방향으로 끌면 줄이 생긴다
  if (len >= 12) {
    const la = A.map((c) => (c ? 0.114 * c[0] + 0.587 * c[1] + 0.299 * c[2] : null)), lb = B.map((c) => (c ? 0.114 * c[0] + 0.587 * c[1] + 0.299 * c[2] : null));
    const idx = la.map((_, i) => i).filter((i) => la[i] != null && lb[i] != null);
    if (idx.length < 8) return { ok: false, why: "한쪽 둘레 없음" };
    const ma = idx.reduce((t, i) => t + la[i], 0) / idx.length, mb = idx.reduce((t, i) => t + lb[i], 0) / idx.length;
    let sab = 0, saa = 0, sbb = 0; for (const i of idx) { sab += (la[i] - ma) * (lb[i] - mb); saa += (la[i] - ma) ** 2; sbb += (lb[i] - mb) ** 2; }
    const sdA = Math.sqrt(saa / idx.length), sdB = Math.sqrt(sbb / idx.length), corr = saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
    if (Math.max(sdA, sdB) >= 4 && corr < 0.6) return { ok: false, why: `결 방향 아님(상관 ${corr.toFixed(2)})` };
  }
  // 가로지르는 쪽 둘레(세로 채움이면 왼·오른 열, 가로 채움이면 위·아래 행)는 양 끝 직선 보간으로 설명돼야 한다 — 줄무늬를 가로질러 끌면 번진다
  {
    const cross = []; // [위치, 밝기] 들
    for (let s = 0; s < span; s += 2) { const p = (dir === "v" ? r.y : r.x) + s; for (const q of dir === "v" ? [r.x - 3, r.x + r.w + 2] : [r.y - 3, r.y + r.h + 2]) { const x = dir === "v" ? q : p, y = dir === "v" ? p : q; if (x < 0 || y < 0 || x >= W || y >= H || (skip && skip(x, y))) continue; const c = at(x, y); cross.push([s, q, 0.114 * c[0] + 0.587 * c[1] + 0.299 * c[2]]); } }
    for (const q of new Set(cross.map((c) => c[1]))) {
      const line = cross.filter((c) => c[1] === q); if (line.length < 6) continue;
      const a = line[0][2], b = line[line.length - 1][2], s0 = line[0][0], s1 = line[line.length - 1][0] || 1;
      const rmse = Math.sqrt(line.reduce((t, c) => t + (c[2] - (a + (b - a) * (c[0] - s0) / Math.max(1, s1 - s0))) ** 2, 0) / line.length);
      if (rmse > 10) return { ok: false, why: `가로지르는 결(잔차 ${rmse.toFixed(1)})` };
    }
  }
  const src = { data: Buffer.alloc(W * H * 4), w: W, h: H }; // 채움 그림(마스크 붙이기용)
  for (let k = 0; k < len; k++) {
    const a = A[k] || B[k], b = B[k] || A[k]; if (!a) continue;
    for (let s = 0; s < span; s++) { const t = span > 1 ? s / (span - 1) : 0.5, x = dir === "v" ? r.x + k : r.x + s, y = dir === "v" ? r.y + s : r.y + k, i = (y * W + x) * 4; for (let c = 0; c < 3; c++) src.data[i + c] = Math.round(a[c] * (1 - t) + b[c] * t); src.data[i + 3] = 255; }
  }
  const mk = mask || new Uint8Array(r.w * r.h).fill(1);
  const wts = maskWeights(mk, r, feather, W, H);
  for (let y = 0; y < wts.rect.h; y++) for (let x = 0; x < wts.rect.w; x++) if (!inRect(r, wts.rect.x + x, wts.rect.y + y)) wts.w[y * wts.rect.w + x] = 0; // 채움 그림은 사각형 안만
  const back = snapshot(bm, wts.rect);
  pasteWeighted(bm, src, wts);
  return { ok: true, undo: () => restore(bm, back) };
}
// AI 결과 위치 맞춤: 이미지 모델은 화면비를 자기 크기(예: 768×1376)로 바꿔 돌려줘서, 원본 크기로 늘리면 1% 안팎 늘어나고 밀린다(가장자리에서 5~10px)
// → 글자 영역 밖의 가로·세로 밝기 단면(열 평균·행 평균)을 맞춰 축마다 배율·이동을 찾고(1차원 탐색) 그대로 다시 그린다(양선형).
// 반환 { bm, sx, tx, sy, ty } — ai(원본 크기로 늘린 것) 의 (x−tx)/sx 를 원본 x 자리에 놓는다
export function alignAi(orig, ai, masks = [], { maxScale = 0.04, maxShift = 24 } = {}) {
  const W = orig.w, H = orig.h;
  const inMask = (x, y) => masks.some((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
  const prof = (bm, axis) => { // axis "x": 열마다 평균 밝기, "y": 행마다
    const n = axis === "x" ? W : H, s = new Float64Array(n), c = new Float64Array(n);
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { if (inMask(x, y)) continue; const v = lumOf(bm.data, (y * W + x) * 4), k = axis === "x" ? x : y; s[k] += v; c[k]++; }
    const out = []; for (let k = 0; k < n; k++) out.push(c[k] ? s[k] / c[k] : null);
    for (let k = 0; k < n; k++) if (out[k] == null) out[k] = out[k - 1] ?? out.find((v) => v != null) ?? 0;
    return out;
  };
  const fit1 = (po, pa) => {
    const n = po.length, at = (p, u) => { if (u < 0 || u > n - 1) return null; const i = Math.floor(u), f = u - i; return p[i] * (1 - f) + p[Math.min(n - 1, i + 1)] * f; };
    const cost = (s, t) => { let e = 0, m = 0; for (let x = 0; x < n; x += 2) { const v = at(pa, (x - t) / s); if (v == null) continue; e += Math.abs(po[x] - v); m++; } return m > n * 0.3 ? e / m : Infinity; };
    let best = { s: 1, t: 0, e: cost(1, 0) };
    for (let s = 1 - maxScale; s <= 1 + maxScale + 1e-9; s += 0.004) for (let t = -maxShift; t <= maxShift; t += 2) { const e = cost(s, t); if (e < best.e) best = { s, t, e }; }
    const c0 = best; // 미세 조정
    for (let s = c0.s - 0.004; s <= c0.s + 0.004 + 1e-9; s += 0.001) for (let t = c0.t - 2; t <= c0.t + 2; t += 0.5) { const e = cost(s, t); if (e < best.e) best = { s, t, e }; }
    return { ...best, e0: cost(1, 0) };
  };
  const fx = fit1(prof(orig, "x"), prof(ai, "x")), fy = fit1(prof(orig, "y"), prof(ai, "y"));
  const out = { data: Buffer.alloc(W * H * 4), w: W, h: H };
  for (let y = 0; y < H; y++) {
    const v = Math.max(0, Math.min(H - 1, (y - fy.t) / fy.s)), y0 = Math.floor(v), y1 = Math.min(H - 1, y0 + 1), b = v - y0;
    for (let x = 0; x < W; x++) {
      const u = Math.max(0, Math.min(W - 1, (x - fx.t) / fx.s)), x0 = Math.floor(u), x1 = Math.min(W - 1, x0 + 1), a = u - x0, o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.round((ai.data[(y0 * W + x0) * 4 + c] * (1 - a) + ai.data[(y0 * W + x1) * 4 + c] * a) * (1 - b) + (ai.data[(y1 * W + x0) * 4 + c] * (1 - a) + ai.data[(y1 * W + x1) * 4 + c] * a) * b);
      out.data[o + 3] = 255;
    }
  }
  return { bm: out, sx: +fx.s.toFixed(4), tx: +fx.t.toFixed(1), sy: +fy.s.toFixed(4), ty: +fy.t.toFixed(1) };
}
// 결 합성(synth): 큰 제목 자리처럼 같은 크기 깨끗한 조각이 없을 때 — 밝기는 둘레로 맞춘 매끈한 면(2차, 다른 글 영역 제외)에서, 결(잔무늬)만 가까운 깨끗한 조각에서 가져와 더한다.
// 칸 복제처럼 칸마다 밝기가 달라 사각형이 보이는 일이 없다(2026-10-12 안경 세척기 d01 제목 실측). 반환 { ok, undo }
// ringAvoid: 둘레 재기에서 뺄 영역(아직 안 지운 다른 글 — 이미 지운 윗줄 자리는 바탕으로 써도 된다)
export function synthFill(bm, rect, { avoid = [], ringAvoid = null, mask = null, bgColor = null, tol = 28, feather = 2, ring = 8, blur = 3 } = {}) {
  const r = clipRect(rect, bm.w, bm.h); if (!r.w || !r.h || !bgColor) return { ok: false };
  const others = ringAvoid || avoid.filter((a) => a !== rect);
  const px = ringPixels(bm, r, { ring, gap: 2, step: 2, skip: (x, y) => others.some((a) => inRect(a, x, y, 1)) });
  if (px.length < 40) return { ok: false };
  // 둘레가 세 변 이상 있어야 면을 믿는다(위·아래가 다 다른 글이면 좌우만으로 2차 면을 맞추다 엉뚱하게 밝아진다 — d07 모래 실측)
  const sides = [px.some((p) => p.y < r.y), px.some((p) => p.y >= r.y + r.h), px.some((p) => p.x < r.x), px.some((p) => p.x >= r.x + r.w)].filter(Boolean).length;
  if (sides < 3) return { ok: false, why: "둘레 부족" };
  let low = fitSurface(px, r, { order: 2 }); const l1 = fitSurface(px, r, { order: 1 }); if (!(low.rmse < Infinity) || l1.rmse <= low.rmse + 0.2) low = l1;
  { // 면이 둘레 밝기 범위를 벗어나면(외삽 폭주) 포기
    const L = px.map((p) => lumOf([p.c[0], p.c[1], p.c[2]], 0)).sort((a, b) => a - b), lo = L[Math.floor(L.length * 0.05)] - 8, hi = L[Math.floor(L.length * 0.95)] + 8;
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1], [r.x + r.w / 2, r.y + r.h / 2]]) { const m = low.at(x, y), v = 0.114 * m[0] + 0.587 * m[1] + 0.299 * m[2]; if (v < lo || v > hi) return { ok: false, why: "면 범위 밖" }; }
  }
  // 결 조각: 가까운 깨끗한 사각형(최대 160×96px)
  const sw = Math.min(r.w, 160), sh = Math.min(r.h, 96), W = bm.w, H = bm.h; // 넓은 조각일수록 거울 반복이 덜 보인다
  let src = null;
  // 깨끗한 조각: 다른 글 영역과 안 겹치고, 잔무늬보다 뚜렷한 선·점(5×5 주변 평균과 밝기 차 > 40)이 거의 없을 것 — 바탕색과의 차이로 거르면 모래 물결·조명 얼룩까지 걸러져 조각을 못 찾는다(d07 실측)
  const clean = (sx, sy) => { if (sx < 0 || sy < 0 || sx + sw > W || sy + sh > H) return false; if (avoid.some((a) => a.x < sx + sw + 3 && sx < a.x + a.w + 3 && a.y < sy + sh + 3 && sy < a.y + a.h + 3)) return false; let n = 0, bad = 0; for (let y = sy + 2; y < sy + sh - 2; y += 2) for (let x = sx + 2; x < sx + sw - 2; x += 2) { let m = 0; for (let yy = -2; yy <= 2; yy += 2) for (let xx = -2; xx <= 2; xx += 2) m += lumOf(bm.data, ((y + yy) * W + x + xx) * 4); n++; if (Math.abs(lumOf(bm.data, (y * W + x) * 4) - m / 9) > 40) bad++; } return n > 0 && bad / n <= 0.005; };
  const cands = []; for (let dy = -320; dy <= 320; dy += 16) for (let dx = -320; dx <= 320; dx += 16) cands.push([r.x + dx, r.y + dy, Math.abs(dx) + Math.abs(dy)]);
  cands.sort((a, b) => a[2] - b[2]);
  for (const [sx, sy] of cands) if (clean(sx, sy)) { src = { x: sx, y: sy }; break; }
  if (!src) return { ok: false };
  // 조각의 고주파(원 − blur×2+1 상자 평균)
  const hf = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0; for (let yy = Math.max(0, y - blur); yy <= Math.min(sh - 1, y + blur); yy++) for (let xx = Math.max(0, x - blur); xx <= Math.min(sw - 1, x + blur); xx++) { s += bm.data[((src.y + yy) * W + src.x + xx) * 4 + c]; n++; }
    hf[(y * sw + x) * 3 + c] = bm.data[((src.y + y) * W + src.x + x) * 4 + c] - s / n;
  }
  { let q = 0; for (let i = 0; i < hf.length; i++) q += hf[i] * hf[i]; const lim = 2.5 * Math.sqrt(q / hf.length) + 1; for (let i = 0; i < hf.length; i++) hf[i] = Math.max(-lim, Math.min(lim, hf[i])); } // 튀는 점은 잘라 결만
  const mir = (v, n) => { const p = v % (2 * n); return p < n ? p : 2 * n - 1 - p; }; // 거울 반복(이음새 없게)
  const out = { data: Buffer.alloc(W * H * 4), w: W, h: H };
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const m = low.at(x, y), k = (mir(y - r.y, sh) * sw + mir(x - r.x, sw)) * 3, o = (y * W + x) * 4; for (let c = 0; c < 3; c++) out.data[o + c] = Math.max(0, Math.min(255, Math.round(m[c] + hf[k + c]))); out.data[o + 3] = 255; }
  const mk = mask || new Uint8Array(r.w * r.h).fill(1);
  const wts = maskWeights(mk, r, feather, W, H);
  for (let y = 0; y < wts.rect.h; y++) for (let x = 0; x < wts.rect.w; x++) if (!inRect(r, wts.rect.x + x, wts.rect.y + y)) wts.w[y * wts.rect.w + x] = 0;
  const back = snapshot(bm, wts.rect);
  pasteWeighted(bm, out, wts);
  return { ok: true, src, rmse: low.rmse, undo: () => restore(bm, back) };
}

// 지울 글인가: 한자(중국어)가 한 글자라도 있어야 한다. 영문·숫자·기호만 있는 글(곡선 영문 장식 "OMNIBEARING" 을 OCR 이 "O4NIBEARIN。" 로 읽은 것 등)은 디자인 장식이라 그대로 둔다
// (2026-10-12 안경 세척기 d02: 끝의 "。" 때문에 latin 이 아니라고 보고 지워 흐린 얼룩이 남았다)
export const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
export const isEraseTarget = (t) => HAN_RE.test(String(t || ""));
// 한 글자 + 낮은 확신(< 0.5)은 그림 아이콘을 글자로 잘못 읽은 것(빗 아이콘 → "甲", 원형 아이콘 → "圓")이 많다 — 지우면 아이콘이 사라진다(안경 세척기 d10 실측). 확신 1 인 큰 한 글자("净")는 지운다
export const isIconGuess = (b) => { const t = String(b?.text || "").replace(/\s/g, ""); return Array.from(t).length === 1 && b?.conf != null && b.conf < 0.5; };
// 글 방향 채움(dir): 글자 마스크의 픽셀마다 글 기울기 방향(angle°)으로 양쪽을 걸어 나가 마스크 밖 첫 픽셀 색 두 개를 거리로 보간.
// 사선 판·띠(커피 랙 d07 층 라벨)처럼 바탕 무늬가 글줄과 나란할 때 판 경계를 흐리지 않는다. 가장자리는 feather 로 섞음. 반환 { ok, undo }
export function dirFill(bm, rect, { mask = null, angle = 0, feather = 2, maxRun = 400 } = {}) {
  const r = clipRect(rect, bm.w, bm.h); if (!r.w || !r.h || !mask) return { ok: false };
  const W = bm.w, H = bm.h, th = (angle * Math.PI) / 180, dx = Math.cos(th), dy = Math.sin(th);
  const inM = (x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && mask[(y - r.y) * r.w + (x - r.x)];
  const src = { data: Buffer.from(bm.data), w: W, h: H };
  const walk = (x, y, sgn) => { for (let t = 1; t <= maxRun; t++) { const X = Math.round(x + dx * t * sgn), Y = Math.round(y + dy * t * sgn); if (X < 0 || Y < 0 || X >= W || Y >= H) return null; if (!inM(X, Y)) { const i = (Y * W + X) * 4; return { t, c: [bm.data[i], bm.data[i + 1], bm.data[i + 2]] }; } } return null; };
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (!inM(x, y)) continue;
    const a = walk(x, y, -1), b = walk(x, y, 1); if (!a && !b) continue;
    const o = (y * W + x) * 4, c = a && b ? a.c.map((v, k) => (v * b.t + b.c[k] * a.t) / (a.t + b.t)) : (a || b).c;
    for (let k = 0; k < 3; k++) src.data[o + k] = Math.round(c[k]); n++;
  }
  if (!n) return { ok: false };
  const wts = maskWeights(mask, r, feather, W, H);
  const back = snapshot(bm, wts.rect);
  pasteWeighted(bm, src, wts);
  return { ok: true, undo: () => restore(bm, back) };
}
// 획 마스크: 글자색(textColor)에 가까운 픽셀(+ 안티앨리어싱 반쯤 섞인 것) → dilate px 팽창. poly(기울어진 글 네 꼭짓점)를 주면 그 안만(판 모서리 선을 글자로 잡지 않게)
// localThr 를 주면 색 대신 "주변(15px 평균)보다 그만큼 어둡거나(글자가 어두우면)/밝은" 픽셀 — 그라데이션 판 위에선 글자색 추정이 판 색과 섞여 빗나가므로(커피 랙 d07 실측) 이 방식을 쓴다
export function strokeMask(bm, rect, { textColor, tol = 60, dilate = 2, poly = null, localThr = 0, win = 7 } = {}) {
  const r = clipRect(rect, bm.w, bm.h), m = new Uint8Array(r.w * r.h); let n = 0;
  let L = null, I = null, dark = true;
  if (localThr) {
    L = new Float32Array(r.w * r.h); let s = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const v = lumOf(bm.data, ((r.y + y) * bm.w + r.x + x) * 4); L[y * r.w + x] = v; s += v; }
    dark = 0.114 * textColor[0] + 0.587 * textColor[1] + 0.299 * textColor[2] < s / L.length;
    I = new Float64Array((r.w + 1) * (r.h + 1));
    for (let y = 0; y < r.h; y++) { let row = 0; for (let x = 0; x < r.w; x++) { row += L[y * r.w + x]; I[(y + 1) * (r.w + 1) + x + 1] = I[y * (r.w + 1) + x + 1] + row; } }
  }
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (poly && polyDist(poly, r.x + x + 0.5, r.y + y + 0.5) < 0) continue;
    const i = ((r.y + y) * bm.w + r.x + x) * 4;
    let hit;
    if (L) { const x0 = Math.max(0, x - win), x1 = Math.min(r.w, x + win + 1), y0 = Math.max(0, y - win), y1 = Math.min(r.h, y + win + 1); const mean = (I[y1 * (r.w + 1) + x1] - I[y0 * (r.w + 1) + x1] - I[y1 * (r.w + 1) + x0] + I[y0 * (r.w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); const dv = mean - L[y * r.w + x]; hit = dark ? dv > localThr : -dv > localThr; }
    else hit = dist3([bm.data[i], bm.data[i + 1], bm.data[i + 2]], textColor) <= tol;
    if (hit) { m[y * r.w + x] = 1; n++; }
  }
  return { rect: r, mask: dilateMask(m, r.w, r.h, dilate), ink: n / Math.max(1, r.w * r.h) };
}
// 획 인페인팅(Telea 식 바깥→안 순서 채움, 순수 JS): 마스크 픽셀만, 경계에서 가까운 순서로 반지름 radius 안의 아는 이웃을 거리 가중 평균.
// 판 경계를 넘어 끌어오지 않게: 이웃 색들의 중앙값에서 먼 이웃(다른 판)은 가중치를 크게 낮춘다(σ = sigma). 사각형을 칠하지 않으므로 바탕 모양이 원본 그대로 남는다.
export function inpaintMask(bm, rect, mask, { radius = 4, sigma = 18, maxPx = 60000 } = {}) {
  const r = clipRect(rect, bm.w, bm.h), W = bm.w, N = r.w * r.h;
  const unknown = new Uint8Array(N); let left = 0;
  for (let i = 0; i < N; i++) if (mask[i]) { unknown[i] = 1; left++; }
  if (!left || left > maxPx) return { ok: false };
  // 바깥(아는 픽셀)에서 가까운 순서: 다중 시작 BFS 한 번(O(N)) — 그 순서대로 채우면 Telea 의 바깥→안 진행과 같다
  const order = [], seen = new Uint8Array(N), q = [];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const i = y * r.w + x; if (!unknown[i]) continue; let edge = x === 0 || y === 0 || x === r.w - 1 || y === r.h - 1; for (let d = 0; d < 4 && !edge; d++) { const X = x + [1, -1, 0, 0][d], Y = y + [0, 0, 1, -1][d]; if (!unknown[Y * r.w + X]) edge = true; } if (edge) { seen[i] = 1; q.push(i); } }
  for (let h = 0; h < q.length; h++) { const i = q[h]; order.push(i); const x = i % r.w, y = (i / r.w) | 0; for (let d = 0; d < 4; d++) { const X = x + [1, -1, 0, 0][d], Y = y + [0, 0, 1, -1][d]; if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue; const j = Y * r.w + X; if (unknown[j] && !seen[j]) { seen[j] = 1; q.push(j); } } }
  const back = snapshot(bm, r);
  const known = new Uint8Array(N); for (let i = 0; i < N; i++) known[i] = unknown[i] ? 0 : 1;
  const nb = [];
  for (const i of order) {
    const x = i % r.w, y = (i / r.w) | 0; nb.length = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy; if (!d2 || d2 > radius * radius) continue;
      const X = x + dx, Y = y + dy, gx = r.x + X, gy = r.y + Y; if (gx < 0 || gy < 0 || gx >= W || gy >= bm.h) continue;
      if (X >= 0 && Y >= 0 && X < r.w && Y < r.h && !known[Y * r.w + X]) continue;
      const k = (gy * W + gx) * 4; nb.push(bm.data[k], bm.data[k + 1], bm.data[k + 2], d2);
    }
    if (!nb.length) continue;
    const m = nb.length / 4, med = [0, 1, 2].map((c) => { const a = []; for (let t = 0; t < m; t++) a.push(nb[t * 4 + c]); a.sort((p, q) => p - q); return a[a.length >> 1]; });
    let s0 = 0, s1 = 0, s2 = 0, ws = 0;
    for (let t = 0; t < m; t++) { const c0 = nb[t * 4], c1 = nb[t * 4 + 1], c2 = nb[t * 4 + 2], dc = (Math.abs(c0 - med[0]) + Math.abs(c1 - med[1]) + Math.abs(c2 - med[2])) / 3, w = Math.exp(-(dc * dc) / (2 * sigma * sigma)) / nb[t * 4 + 3]; s0 += c0 * w; s1 += c1 * w; s2 += c2 * w; ws += w; }
    const o = ((r.y + y) * W + r.x + x) * 4; bm.data[o] = Math.round(s0 / ws); bm.data[o + 1] = Math.round(s1 / ws); bm.data[o + 2] = Math.round(s2 / ws); bm.data[o + 3] = 255; known[i] = 1;
  }
  return { ok: true, undo: () => restore(bm, back) };
}
// 장식 도형 찾기(v12): 글자가 알약·배지 같은 닫힌 색 도형 안에 있는지 — seed(글 영역) 안의 도형 색(color) 픽셀에서 같은 색으로 번져 나가
// limit(글 영역 + pad) 경계에 닿지 않으면 닫힌 도형. 반환 null | { rect(도형 상자), mask(rect 기준), n }
// v13 글자색 픽셀만: 바탕색(bgAt(x,y))↔글자색·테두리색 사이 선분에 가까운 픽셀(글자 획·가장자리 번짐)만 참 — 단색 채움이 글 옆 장식(주황 곡선·타원)을
//   직선으로 자르던 것(컵홀더 d09·d10). 색은 비트맵 순서(BGR) 그대로 [b,g,r]
export function inkColorClip(bm, bgAt, inks = [], tol = 40) {
  const segD = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; const t = L ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L)) : 0; return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t); };
  const cs = inks.filter(Boolean);
  // 바탕색에 이미 가까운 픽셀(≤ 12)은 칠하지 않는다 — 그라데이션 바탕을 한 색으로 눌러 사각형이 보이던 것(대파 d18)
  return (x, y) => { const i = (y * bm.w + x) * 4, p = [bm.data[i], bm.data[i + 1], bm.data[i + 2]], bg = bgAt(x, y), d0 = Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]); if (d0 <= 12) return false; if (d0 <= tol) return true; for (let a = 0; a < cs.length; a++) { if (segD(p, bg, cs[a]) <= tol) return true; for (let b = a + 1; b < cs.length; b++) if (segD(p, cs[a], cs[b]) <= tol) return true; } return false; };
}
// v13 그림에 남은 가로 선(제목 밑줄·구분선) 찾기 → [{ x,y,w,h }] — 템플릿이 장애물로 써서 글이 선을 덮지 않게(탄소강 풀아웃 d07: 커진 제목이 본문을 밑줄 위로 밀어 취소선처럼 보이던 것)
// 줄마다: 위·아래 off px 떨어진 픽셀보다 같은 쪽으로 thr 넘게 어둡거나 밝은 픽셀(가는 선 — 계단 모양 경계는 한쪽만 달라 빠진다)이 gap 이하로 끊기며 minLen 이상 이어지면 선. 붙은 줄은 하나로(두께 ≤ off)
export function findRules(bm, { minLen = 0, thr = 35, off = 6, gap = 3 } = {}) {
  const W = bm.w, H = bm.h, need = minLen || Math.round(W * 0.18), L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = lumOf(bm.data, i * 4);
  const segs = [];
  for (let y = off; y < H - off; y++) {
    let run0 = -1, last = -10;
    const flush = () => { if (run0 >= 0 && last - run0 + 1 >= need) segs.push({ x: run0, y, w: last - run0 + 1, h: 1 }); run0 = -1; };
    for (let x = 0; x < W; x++) {
      const v = L[y * W + x], a = v - L[(y - off) * W + x], b = v - L[(y + off) * W + x];
      if ((a > thr && b > thr) || (a < -thr && b < -thr)) { if (run0 < 0 || x - last > gap) { flush(); run0 = x; } last = x; }
    }
    if (run0 >= 0) { last = Math.min(last, W - 1); flush(); }
  }
  const out = [];
  for (const sg of segs) { const r = out.find((o) => sg.y <= o.y + o.h + 1 && Math.min(o.x + o.w, sg.x + sg.w) - Math.max(o.x, sg.x) > Math.min(o.w, sg.w) * 0.5); if (r) { const x0 = Math.min(r.x, sg.x), x1 = Math.max(r.x + r.w, sg.x + sg.w); r.x = x0; r.w = x1 - x0; r.h = sg.y - r.y + 1; } else out.push({ ...sg }); }
  return out.filter((r) => r.h <= off + 2);
}
// v13 지울 사각형이 그 글을 담은 닫힌 도형(원·알약·띠) 밖으로 나가면 도형 안만 칠하는 판정 함수 → (x,y)=>bool | null(도형 없음·사각형이 도형 안)
// 2026-10-13 탄소강 풀아웃 d04 "承重25kg": 글이 원 테두리에 닿아 지울 사각형이 원 밖까지 → 흰 막대가 원 테두리를 끊고 튀어나옴
export function shapeClip(bm, area, color, { maxRatio = 12 } = {}) {
  const sh = findShape(bm, area, color) || findShape(bm, area, color, { tol: 10 });
  if (!sh) return null;
  const R = sh.rect, A = area.w * area.h;
  if (R.w * R.h > A * maxRatio || R.w >= bm.w * 0.95) return null; // 너무 크면 바탕
  const out = area.x < R.x - 1 || area.y < R.y - 1 || area.x + area.w > R.x + R.w + 1 || area.y + area.h > R.y + R.h + 1;
  if (!out) return null;
  return (x, y) => x >= R.x && y >= R.y && x < R.x + R.w && y < R.y + R.h && sh.mask[(y - R.y) * R.w + (x - R.x)] === 1;
}
export function findShape(bm, seed, color, { tol = 26, pad = 0 } = {}) {
  const p = pad || Math.max(60, Math.round(seed.h * 2.5));
  const px0 = Math.max(p, seed.w); // 띠는 옆으로 길다 — 가로 한계는 글 폭만큼 더
  const L = clipRect({ x: seed.x - px0, y: seed.y - p, w: seed.w + px0 * 2, h: seed.h + p * 2 }, bm.w, bm.h), W = bm.w;
  const inL = (x, y) => x >= L.x && y >= L.y && x < L.x + L.w && y < L.y + L.h;
  const near = (x, y) => { const i = (y * W + x) * 4; return dist3([bm.data[i], bm.data[i + 1], bm.data[i + 2]], color) <= tol; };
  const seen = new Uint8Array(L.w * L.h), q = [];
  const S0 = clipRect(seed, bm.w, bm.h);
  for (let y = S0.y; y < S0.y + S0.h; y++) for (let x = S0.x; x < S0.x + S0.w; x++) if (near(x, y)) { const k = (y - L.y) * L.w + (x - L.x); if (!seen[k]) { seen[k] = 1; q.push(k); } }
  if (q.length < 20) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = L.x + (k % L.w), y = L.y + ((k / L.w) | 0);
    const atImg = x === 0 || y === 0 || x === bm.w - 1 || y === bm.h - 1; // 이미지 끝에 붙은 띠(하단 주황 바 등)는 닫힌 도형으로 본다
    if ((x === L.x || y === L.y || x === L.x + L.w - 1 || y === L.y + L.h - 1) && !atImg) return null; // 한계에 닿음 = 바탕(열린 영역)
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (!inL(X, Y)) continue; const j = (Y - L.y) * L.w + (X - L.x); if (seen[j] || !near(X, Y)) continue; seen[j] = 1; q.push(j); }
  }
  const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, mask = new Uint8Array(rect.w * rect.h);
  for (const k of q) { const x = L.x + (k % L.w), y = L.y + ((k / L.w) | 0); mask[(y - rect.y) * rect.w + (x - rect.x)] = 1; }
  // 도형 안 구멍(지운 글 자리·아이콘)도 채운다: 줄마다 처음~끝 사이
  for (let y = 0; y < rect.h; y++) { let a = -1, b = -1; for (let x = 0; x < rect.w; x++) if (mask[y * rect.w + x]) { if (a < 0) a = x; b = x; } for (let x = a; x >= 0 && x <= b; x++) mask[y * rect.w + x] = 1; }
  const at = (fx, fy) => mask[Math.min(rect.h - 1, Math.round(rect.h * fy)) * rect.w + Math.min(rect.w - 1, Math.round(rect.w * fx))];
  const round = [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]].every(([a, b]) => !at(a, b)); // 네 귀퉁이가 비면 원·알약(둥근 도형)
  return { rect, mask, n: q.length, round };
}

// ── v13.2 세로쓰기 글 찾기(가로 OCR 이 못 읽는 위→아래로 쌓인 글자 — 슬라이서 d16 "一切成片", d02 "品牌形象代言人") ──
// verticalColumns(bm, boxes) → [{ x,y,w,h, cells:[{x,y,w,h}] }]
//  1) 잉크 = 15px 평균 밝기보다 thr 넘게 다른 픽셀(이미 읽은 OCR 상자 둘레는 뺌) → 3px 팽창 뒤 연결 덩어리
//  2) 글자 크기 덩어리(가로 10~90px, 세로 2~90px 또는 가늘고 긴 덩어리)를 가운데 x 가 맞고(열 폭 30% 안) 세로로 이어진(간격 < 열 폭) 것끼리 한 열
//  3) 열 = 높이 ≥ 폭 2.5배, 덩어리 ≥ 3, 양옆 띠가 평평(사진 위 무늬가 아님)
//  4) 글자 칸 = 열 안 가로 투영의 빈 줄로 자르고, 위아래로 붙은 조각(二·三 같은 획)은 높이가 열 폭 1.15배 안이면 한 칸으로
export function verticalColumns(bm, boxes = [], { thr = 40, minChars = 3 } = {}) {
  const W = bm.w, H = bm.h, L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = lumOf(bm.data, i * 4);
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += L[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  const mean = (x, y, r) => { const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1); return (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
  const known = new Uint8Array(W * H); for (const b of boxes) { const x0 = Math.max(0, Math.round(b.x - 4)), y0 = Math.max(0, Math.round(b.y - 4)), x1 = Math.min(W, Math.round(b.x + b.w + 4)), y1 = Math.min(H, Math.round(b.y + b.h + 4)); for (let y = y0; y < y1; y++) known.fill(1, y * W + x0, y * W + x1); }
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!known[i] && Math.abs(L[i] - mean(x, y, 7)) > thr) ink[i] = 1; }
  const dl = dilateMask(ink, W, H, 3), lab = new Int32Array(W * H), comps = [];
  for (let s = 0; s < W * H; s++) { if (!dl[s] || lab[s]) continue; const q = [s]; lab[s] = comps.length + 1; let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (q.length > 40000) break;
      for (const d of [1, -1, W, -W]) { const j = k + d; if (j < 0 || j >= W * H || lab[j] || !dl[j] || (d === 1 && x === W - 1) || (d === -1 && x === 0)) continue; lab[j] = comps.length + 1; q.push(j); } }
    comps.push({ x: x0 + 3, y: y0 + 3, w: x1 - x0 + 1 - 6, h: y1 - y0 + 1 - 6, n }); }
  const ch = comps.filter((c) => c.w >= 10 && c.w <= 90 && c.h >= 2 && (c.h <= 90 || c.h >= c.w * 2)); // 세로로 붙은 글자들은 한 덩어리(가늘고 긴)로 잡히기도 한다
  ch.sort((a, b) => a.y - b.y);
  const used = new Set(), cols = [];
  for (const a of ch) {
    if (used.has(a)) continue;
    const col = [a]; let cx = a.x + a.w / 2, cw = a.w;
    for (const b of ch) { if (used.has(b) || col.includes(b) || b.y < a.y) continue; const last = col[col.length - 1], bw = Math.max(cw, b.w); if (Math.abs(b.x + b.w / 2 - cx) < bw * 0.3 && b.y - (last.y + last.h) < bw * 1.0 && b.y - (last.y + last.h) > -2) { col.push(b); cw = Math.max(cw, b.w); cx = col.reduce((s, c) => s + c.x + c.w / 2, 0) / col.length; } }
    const x0 = Math.min(...col.map((c) => c.x)), x1 = Math.max(...col.map((c) => c.x + c.w)), y0 = Math.min(...col.map((c) => c.y)), y1 = Math.max(...col.map((c) => c.y + c.h)), cwid = x1 - x0;
    if (y1 - y0 < cwid * 2.5) continue; // 글자 수는 아래 칸 나누기로 센다(붙은 글자는 한 덩어리)
    // 양옆 띠(열 폭만큼)가 평평해야 — 사진 속 세로 무늬 제외
    let busy = 0, tot = 0; for (let y = y0; y < y1; y += 2) for (const x of [x0 - Math.round(cwid * 0.6), x1 + Math.round(cwid * 0.6)]) { if (x < 0 || x >= W) continue; tot++; if (Math.abs(L[y * W + x] - mean(x, y, 7)) > thr * 0.6) busy++; }
    if (tot && busy / tot > 0.12) continue;
    col.forEach((c) => used.add(c));
    // 글자 칸: 가로 투영으로 자르고 조각 합치기
    const prof = []; for (let y = y0; y < y1; y++) { let n = 0; for (let x = x0; x < x1; x++) n += ink[y * W + x]; prof.push(n); }
    const segs = []; let st = -1; prof.forEach((n, i) => { if (n && st < 0) st = i; if (!n && st >= 0) { segs.push([st, i]); st = -1; } }); if (st >= 0) segs.push([st, prof.length]);
    let cells = []; for (const sg of segs) { const last = cells[cells.length - 1]; if (last && sg[1] - last[0] <= cwid * 1.15 && sg[0] - last[1] <= cwid * 0.45) last[1] = sg[1]; else cells.push([...sg]); }
    // 글자 사이가 거의 붙어 빈 줄이 없으면: 글자 높이 ≈ 열 폭으로 글자 수를 어림해 가장 잉크가 적은 줄에서 자른다
    const n = Math.max(1, Math.round((y1 - y0) / (cwid * 0.9)));
    if (cells.length < n) { const pitch = (y1 - y0) / n, cuts = [0]; for (let k = 1; k < n; k++) { const c0 = Math.round(k * pitch), r = Math.round(pitch * 0.25); let best = c0; for (let t = c0 - r; t <= c0 + r; t++) if (t > 0 && t < prof.length && prof[t] < prof[best]) best = t; cuts.push(best); } cuts.push(prof.length); cells = cuts.slice(1).map((c, k) => [cuts[k], c]); }
    if (cells.length < minChars) continue;
    cols.push({ x: x0, y: y0, w: cwid, h: y1 - y0, cells: cells.map(([a2, b2]) => ({ x: x0, y: y0 + a2, w: cwid, h: b2 - a2 })) });
  }
  return cols;
}
// 세로 열을 가로 줄로 다시 놓은 비트맵(가로 OCR 용): 칸마다 정사각형(열 폭 + 여백)에 가운데로, 바탕은 열 둘레 최빈색. 반환 { bm, cellAt: [{ x0, x1 }] (새 그림의 칸 가로 범위) }
export function restackColumn(bm, col, { gap = 0.25, margin = 0.6 } = {}) {
  const S = Math.round(Math.max(col.w, ...col.cells.map((c) => c.h)) * 1.15), G = Math.round(S * gap), M = Math.round(S * margin);
  const bg = ringMode(bm, col, 4).color || [255, 255, 255];
  const w = M * 2 + col.cells.length * S + (col.cells.length - 1) * G, h = S + M * 2, out = makeBitmap(w, h, bg);
  col.cells.forEach((c, k) => { const ox = M + k * (S + G) + Math.round((S - c.w) / 2), oy = M + Math.round((S - c.h) / 2);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const sx = c.x + x, sy = c.y + y; if (sx < 0 || sy < 0 || sx >= bm.w || sy >= bm.h) continue; const si = (sy * bm.w + sx) * 4, di = ((oy + y) * w + ox + x) * 4; out.data[di] = bm.data[si]; out.data[di + 1] = bm.data[si + 1]; out.data[di + 2] = bm.data[si + 2]; out.data[di + 3] = 255; } });
  return { bm: out, cellAt: col.cells.map((c, k) => ({ x0: M + k * (S + G), x1: M + k * (S + G) + S })) };
}
