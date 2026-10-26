// 원본 한글화(v11) 순수 계산 — 템플릿(window.LocCore)과 노드 단위테스트(test/detail/localize-quality.test.js)가 같이 쓴다. DOM 없음.
//  · 대비: WCAG 상대 휘도·대비비, 바탕 격자(bgGrid: 24px 칸 평균색 "rrggbb…") 에서 사각형 밑 칸들, 글자색 고르기 pickInk
//  · 겹침: 글 상자 사각형들 → 다음에 할 한 가지(nextFix: 아래 글 내리기 / 줄이기) — 템플릿이 적용하고 다시 재서 0 이 될 때까지
(function (root) {
  "use strict";
  const rgb = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(x || "").trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hx = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const con = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // 원본 px 사각형과 겹치는 격자 칸 색들 [[r,g,b]…]
  function cellsIn(g, x0, y0, x1, y1) {
    if (!g || !g.c) return [];
    const out = [], c0 = Math.max(0, Math.floor(x0 / g.cell)), c1 = Math.min(g.cols - 1, Math.floor((x1 - 1) / g.cell)), r0 = Math.max(0, Math.floor(y0 / g.cell)), r1 = Math.min(g.rows - 1, Math.floor((y1 - 1) / g.cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = (r * g.cols + c) * 6; out.push(rgb(g.c.slice(k, k + 6))); }
    return out.filter(Boolean);
  }
  // 칸 흔들림(colorGrid s) — 없으면 0
  function sdIn(g, x0, y0, x1, y1) {
    if (!g || !g.s) return [];
    const out = [], c0 = Math.max(0, Math.floor(x0 / g.cell)), c1 = Math.min(g.cols - 1, Math.floor((x1 - 1) / g.cell)), r0 = Math.max(0, Math.floor(y0 / g.cell)), r1 = Math.min(g.rows - 1, Math.floor((y1 - 1) / g.cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(parseInt(g.s[r * g.cols + c], 36) || 0);
    return out;
  }
  // 넓혀도 되는 빈 바탕인가: x 열(원본 px)의 칸들이 글자 밑 바탕(base 색·흔들림 baseSd)과 색이 비슷하고(합 차 < 45) 흔들림이 크지 않다(≤ baseSd + 6)
  function calmAt(g, x, y0, y1, base, baseSd = 0) {
    const cs = cellsIn(g, x, y0, x + 1, y1), ss = sdIn(g, x, y0, x + 1, y1);
    return cs.every((c) => Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]) < 45) && ss.every((v) => v <= baseSd + 6);
  }
  const q10 = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length * 0.1)] : 99; };
  const medianCell = (cells) => { if (!cells.length) return null; const b = [...cells].sort((x, y) => lum(x) - lum(y)); return b[Math.floor(b.length / 2)]; };
  // 글자색 고르기: 원본 글자색이 바탕 칸들(하위 10%) 대비 need(큰 글 3:1 · 작은 글 4.5:1) 이상이면 그대로.
  // 아니면 흰색·짙은 검정 중 더 잘 보이는 쪽, 그래도 아슬아슬하거나 바탕이 얼룩덜룩하면 옅은 그림자. 반환 { color, shadow, con, changed, from? }
  function pickInk(color, cells, large) {
    const need = large ? 3 : 4.5, c0 = rgb(color);
    if (!cells || !cells.length || !c0) return { color, shadow: null, con: null, changed: false };
    const score = (c) => q10(cells.map((u) => con(c, u)));
    const s0 = score(c0);
    if (s0 >= need) return { color, shadow: null, con: +s0.toFixed(2), changed: false };
    const sw = score([255, 255, 255]), sk = score([17, 17, 17]), white = sw >= sk, best = white ? sw : sk;
    const ls = cells.map(lum), spread = Math.max(...ls) - Math.min(...ls);
    // 흰·검정도 기준에 못 미치고 원본 색이 그 나은 쪽과 거의 같으면(0.5 이내) 원본 디자인 색을 지키고 그림자로 보강 — 파란 바탕 흰 라벨이 검정으로 뒤집히지 않게
    if (best < need && s0 >= best - 0.5) return { color, shadow: lum(c0) > 0.4 ? "0 1px 3px rgba(0,0,0,.55), 0 0 8px rgba(0,0,0,.3)" : "0 0 6px rgba(255,255,255,.75)", con: +s0.toFixed(2), changed: false, boosted: true };
    const shadow = best < need + 0.6 || spread > 0.25 ? (white ? "0 1px 3px rgba(0,0,0,.55), 0 0 8px rgba(0,0,0,.3)" : "0 0 6px rgba(255,255,255,.75)") : null;
    return { color: white ? "#ffffff" : "#111111", shadow, con: +best.toFixed(2), changed: true, from: color };
  }
  // 사각형 {l,t,r,b} 겹침(1px 넘게)
  const hit = (a, b, m = 1, mv = m) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > m && Math.min(a.b, b.b) - Math.max(a.t, b.t) > mv;
  const touch = (a, b) => hit(a, b, 1, -2); // v13.2 위아래로 2px 안쪽까지 붙은 것도 겹침(두 줄이 맞닿아 보이던 것 — 슬라이서 d28)
  // 겹침 정리 한 걸음: rects(움직일 수 있는 글 상자) · fixed(그림에 남긴 숫자 — 못 움직임) · H(이미지 높이)
  //  → null(겹침 없음) | { move:{i,dy} } 위아래로 겹치면 아래 글을 내림 | { shrink:[i…] } 같은 줄(옆으로 닿음)이거나 내릴 자리가 없으면 줄임(+ lift: 위 글을 조금 올림)
  function nextFix(rects, fixed = [], H = Infinity) {
    let pair = null;
    for (let i = 0; i < rects.length && !pair; i++) {
      for (let j = 0; j < rects.length; j++) if (i !== j && touch(rects[i], rects[j]) && (rects[i].t < rects[j].t || (rects[i].t === rects[j].t && i < j))) { pair = { a: i, b: j }; break; }
      if (!pair) for (const f of fixed) if (hit(rects[i], f)) { pair = { a: -1, b: i, f }; break; }
    }
    if (!pair) return null;
    const A = pair.a >= 0 ? rects[pair.a] : pair.f, B = rects[pair.b], hA = A.b - A.t, hB = B.b - B.t;
    if (pair.a >= 0 && Math.abs(B.t - A.t) < Math.min(hA, hB) * 0.5) return { shrink: [pair.a, pair.b], why: "같은 줄" };
    if (pair.a < 0 && B.t < A.t) return { shrink: [pair.b], why: "남긴 숫자 위에 걸침" };
    const dy = A.b + Math.max(4, hB * 0.12) - B.t;
    if (B.b + dy <= H - 4) return { move: { i: pair.b, dy }, why: "아래 글 내림" };
    const out = { shrink: pair.a >= 0 ? [pair.a, pair.b] : [pair.b], why: "아래 자리 없음" };
    if (pair.a >= 0 && A.t > 4) out.lift = { i: pair.a, dy: -Math.min(dy, A.t - 4) / 2 };
    return out;
  }
  root.LocCore = { rgb, hx, lum, con, cellsIn, sdIn, calmAt, medianCell, pickInk, hit, nextFix };
})(typeof window !== "undefined" ? window : globalThis);
