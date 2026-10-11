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
  const color = core.length ? avg(core) : [34, 34, 34];
  runs.sort((a, b) => a - b);
  const stroke = runs.length ? runs[Math.floor(runs.length / 2)] : 0;
  const h = y1 - y0;
  const strokeRatio = h ? stroke / h : 0;
  const fontWeight = strokeRatio >= 0.14 ? 800 : strokeRatio >= 0.1 ? 700 : strokeRatio >= 0.075 ? 500 : 400;
  const cx = (x0 + x1) / 2;
  const align = Math.abs(cx - imgW / 2) < imgW * 0.06 ? "center" : cx < imgW / 2 ? "left" : "right";
  return { color: hexOf(color), colorBGR: color, bg: hexOf(bg), fontWeight, fontSizePx: Math.round(h * 0.92), align, strokeRatio: +strokeRatio.toFixed(3), inkRatio: total ? +(inkN / total).toFixed(3) : 0 };
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
    for (let c = 0; c < 3; c++) bm.data[i + c] = Math.round(bm.data[i + c] * (1 - t) + m[c] * t);
    bm.data[i + 3] = 255; n++;
  }
  return { seam: sn ? seam / sn : 0, n, undo() { for (let y = fy0; y < fy1; y++) backup.copy(bm.data, (y * W + fx0) * 4, (y - fy0) * (fx1 - fx0) * 4, (y - fy0 + 1) * (fx1 - fx0) * 4); } };
}
