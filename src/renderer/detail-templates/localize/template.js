// 원본 한글화 모드(v6) — 원본 상세 이미지를 순서대로 깔고(중국어는 A2 가 지운 loc/*.png), 글자 레이어를 원래 자리에 같은 느낌의 HTML 한글로 얹는다
// card 템플릿(테마 6종 공유)을 그대로 불러온 뒤 섹션 builder 를 더한다: image(원본 + 레이어), hero(첫 장 위 새 한글 타이틀)
// 레이어 좌표·크기는 원본 이미지 픽셀 기준 → 화면 축척(W / w)으로 환산. role "number"(치수 숫자 등)는 원본 그대로 두고 그리지 않는다
(function () {
  "use strict";
  const U = () => window.SeedhackRender.util;
  const T = window.TEMPLATE; // card 가 만든 설정
  const lines = (v) => (Array.isArray(v) ? v : String(v == null ? "" : v).split(/\n/)).map((t) => String(t).trim()).filter(Boolean);
  // A2 형식 style{fontSizePx,fontWeight,bgColor,borderColor,pill} 도 템플릿 형식{size,weight,bg,border,radius}으로 맞춘다(A3 가 그대로 넘기는 경우)
  function normStyle(l) {
    const st = { ...(l.style || {}) };
    if (st.size == null && st.fontSizePx != null) st.size = st.fontSizePx;
    if (st.weight == null && st.fontWeight != null) st.weight = st.fontWeight;
    if (st.bg == null && st.bgColor) st.bg = st.bgColor;
    if (st.border == null && st.borderColor) st.border = `2px solid ${st.borderColor}`;
    if (st.radius == null && st.pill) st.radius = "pill";
    if (l.role === "title") st.weight = Math.max(700, Number(st.weight) || 0); // A2 가 한 단계 낮게 추정
    return { ...l, style: st };
  }
  const SKIP = new Set(["number", "dims", "price", "logo"]); // 원본 그대로 두는 숫자·도면 치수, 지워야 하는 가격·로고는 그리지 않는다
  const px = (v) => (v == null || v === "" ? null : Number(v));

  // 대비 보정: 원본 글자색이 바탕과 4.5:1 미만이면 색상(색조)은 두고 어둡게(바탕이 밝을 때) 또는 밝게(바탕이 어두울 때) 조금씩 옮긴다
  const { rgb, hx, lum, con, cellsIn, medianCell, pickInk, nextFix } = window.LocCore; // 순수 계산(대비·격자·겹침 판단)은 loc-core.js(노드 단위테스트)
  // 강조색: 레이어 색이 무채색(회색·검정)이면 페이지 포인트색(원본 배너 주황 등)을 쓴다
  function emColorOf(c0, under) {
    const c = rgb(c0); const sat = c ? Math.max(...c) - Math.min(...c) : 0;
    return inkFor(sat < 40 ? (window.__locAccent || "#f08a24") : c0, under);
  }
  // min: 원본 글자색은 디자이너가 고른 색이라 그 바탕에서 이 대비 이상이면 그대로(v12.1 — 주황 띠 흰 글자가 회색으로 바뀌던 것). 기본 4.6(새로 정하는 강조색 등)
  function inkFor(color, under, min = 4.6) {
    const c = rgb(color), u = rgb(under); if (!c || !u || con(c, u) >= min) return color;
    const target = lum(u) > 0.35 ? [0, 0, 0] : [255, 255, 255];
    for (let t = 0.05; t <= 1; t += 0.05) { const m = c.map((v, i) => v * (1 - t) + target[i] * t); if (con(m, u) >= 4.6) return hx(m); }
    return hx(target);
  }
  // 레이어 하나 → 절대 위치 상자. style: { color, weight, size(원본 px), align, bg, border, radius("50%"|px|"pill"), fill(지우지 못한 원본 위 임시 덮개색), under(글자 뒤 배경색: 대비 점검용), italic, letter }
  function layerEl(l, i, sc, sec) {
    const { h } = U();
    const st = l.style || {};
    const role = l.role || "text";
    const box = h("div.loc-layer.deco.role-" + role, { "data-layer": `#${sec}.layer.${i + 1}`, "data-role": role });
    const fs = (px(st.size) || l.h * 0.78) * sc;
    const pill = st.radius === "pill" || role === "pill" || (role === "badge" && st.radius == null && l.w > l.h * 1.6);
    if (role === "badge" && !st.bg && !st.fill) { st.bg = "#ffffff"; st.border = st.border || "2px solid #f0962e"; st.color = st.color || "#8f4507"; if (st.radius == null && !pill) st.radius = "50%"; }
    if (pill || st.bg) { st.align = "center"; box.classList.add("is-boxed"); } // v13 알약·배지·바탕 상자 안 글은 가운데 + 안쪽 여백(오른쪽 정렬로 테두리에 닿던 것 — 컵홀더 d05 "머그컵 6개")
    Object.assign(box.style, {
      left: Math.round(l.x * sc) + "px", top: Math.round(l.y * sc) + "px", width: Math.round(l.w * sc) + "px", minHeight: Math.round(l.h * sc) + "px",
      fontSize: Math.round(fs) + "px", color: inkFor(st.color || "#222222", st.bg || st.under || st.fill, 1.5), fontWeight: String(st.weight || (role === "title" ? 700 : 400)),
      textAlign: st.align || (role === "caption" || role === "title" || pill || role === "badge" ? "center" : "left"),
      justifyContent: (st.align || (role === "caption" || role === "title" || pill || role === "badge" ? "center" : "left")) === "center" ? "center" : (st.align === "right" ? "flex-end" : "flex-start"),
      background: st.bg || st.fill || "transparent", border: st.border || "0", borderRadius: pill ? "999px" : st.radius === "50%" ? "50%" : st.radius != null ? Math.round(Number(st.radius) * sc) + "px" : "0",
      letterSpacing: st.letter != null ? st.letter + "em" : "-0.02em", fontStyle: st.italic ? "italic" : "normal",
    });
    if (st.under || st.bg || st.fill) box.dataset.bg = st.under || st.bg || st.fill;
    if (st.outline) box.style.textShadow = `0 0 2px ${st.outline}, 0 0 3px ${st.outline}, 0 1px 2px ${st.outline}`; // 원본이 테두리 글자면 같은 색 테두리
    if (st.vertical) { Object.assign(box.style, { writingMode: "vertical-rl", textOrientation: "upright", height: Math.round(l.h * sc) + "px", minHeight: "0px", justifyContent: "center", textAlign: "center", letterSpacing: "0.02em", lineHeight: "1.05" }); box.dataset.vertical = "1"; } // v13.2 세로쓰기 원문 → 한글도 세로로(위→아래, 글자 세움)
    if (Number(st.rotate)) { box.style.transform = `rotate(${Number(st.rotate)}deg)`; box.style.transformOrigin = "50% 50%"; } // 사선 글(원본 각도)
    const span = h("span.loc-text", null, lines(l.ko).map((t, k) => [k ? h("br") : null, U().noOrphan(t)]));
    if (fs < 14 && Array.isArray(l.emph)) l = { ...l, emph: l.emph.map((e) => (e.kind === "dot" ? { ...e, kind: "color" } : e)) }; // 작은 라벨: 점 → 색
    box.append(span);
    if (Array.isArray(l.emph) && l.emph.length) { // v7 강조: 색은 원본 포인트색(레이어 accent → 글자색) — 바탕 대비 보정
      box.style.setProperty("--em-color", emColorOf(st.accent || st.color || "#f0962e", st.bg || st.under || st.fill || "#ffffff"));
      U().emphasize(span, l.emph);
    }
    if (role === "title") span.style.fontFamily = "var(--display)";
    box._fs = fs; box._l = l; box._sc = sc;
    return box;
  }

  const builders = {
    // 원본 상세 이미지 한 장 + 한글 레이어
    image(s, base, n) {
      const { h, has, srcUrl } = U();
      if (!has(s.image)) return null;
      const wrap = h("div.loc-wrap", { "data-clip": "1" }, h("img.loc-img", { src: srcUrl(s.image, base), alt: "", decoding: "async", "data-src": String(s.image), "data-layer": `#image.${n}.image` }));
      wrap._layers = (Array.isArray(s.layers) ? s.layers : []).filter((l) => l && !SKIP.has(l.role) && !l.drop && String(l.ko || "").trim() && isFinite(l.x) && isFinite(l.y) && isFinite(l.w) && isFinite(l.h));
      // 같은 덩어리(세로로 붙어 있고 가로로 겹치는 같은 역할 줄들)는 같은 정렬로: 첫 줄(원본) 정렬을 따르고, 왼쪽 정렬이면 왼쪽 끝을, 가운데면 가운데를 맞춘다
      const ls = wrap._layers.map(normStyle).sort((a, b) => a.y - b.y);
      // v13 두 줄 사이에 그림에 남은 가로 선(밑줄·구분선, keep.rule)이 있으면 같은 덩어리·글 묶음으로 합치지 않는다
      const rules = (Array.isArray(s.keep) ? s.keep : []).filter((k) => k && k.rule);
      const ruleBetween = (p, q) => { const [a, b] = p.y <= q.y ? [p, q] : [q, p]; return rules.some((r) => r.y >= a.y + a.h * 0.6 && r.y + r.h <= b.y + b.h * 0.4 && Math.min(r.x + r.w, a.x + a.w, b.x + b.w) - Math.max(r.x, a.x, b.x) > 0); };
      const used = new Set();
      for (let a = 0; a < ls.length; a++) {
        if (used.has(a)) continue;
        const block = [ls[a]]; used.add(a);
        for (let b = a + 1; b < ls.length; b++) {
          const p = block[block.length - 1], q = ls[b];
          if (used.has(b) || (q.role || "text") !== (p.role || "text") || q.style.rotate || p.style.radius || ruleBetween(p, q)) continue;
          const near = q.y - (p.y + p.h) < Math.max(p.h, q.h) * 0.9, overlap = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > Math.min(p.w, q.w) * 0.3;
          if (near && overlap) { block.push(q); used.add(b); }
        }
        if (block.length < 2) continue;
        const al = block[0].style.align || "left";
        const x0 = Math.min(...block.map((l) => l.x)), x1 = Math.max(...block.map((l) => l.x + l.w));
        for (const l of block) { l.style.align = al; l.x = x0; l.w = x1 - x0; } // 덩어리 전체 폭을 같이 쓰고 정렬만 원본대로
      }
      // v7: rewrite_ok(지운 자리에 새로 디자인해도 되는) 레이어들은 원래 상자 대신 그 영역 안의 타이포 블록(제목 + 보조)으로
      // 묶음: 세로로 붙어 있고(간격 < 1.2줄) 가로로 겹치며 글자 크기가 비슷한(≥50%) rewrite_ok 줄 2~3개만 한 블록. 나머지는 원래 자리 레이어(강조는 그대로)
      const rw = ls.filter((l) => l.rewrite_ok && !l.shape && !l.style?.vertical), blocks = [], inBlock = new Set(); // 원·띠·칸 안 글은 도형 맞춤(shapeFit)으로
      const sz = (l) => Number(l.style?.size) || l.h * 0.78;
      for (const l of rw) {
        if (inBlock.has(l)) continue;
        const cl = [l];
        for (const q of rw) {
          if (q === l || inBlock.has(q) || cl.includes(q)) continue;
          const p = cl[cl.length - 1];
          const gap = q.y - (p.y + p.h), ov = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
          if (gap >= -4 && gap < Math.max(p.h, q.h) * 1.2 && ov > Math.min(p.w, q.w) * 0.3 && sz(q) >= sz(cl[0]) * 0.5 && !ruleBetween(p, q)) cl.push(q);
        }
        if (cl.length >= 2 && cl.length <= 3) { blocks.push(cl); cl.forEach((x) => inBlock.add(x)); }
      }
      wrap._layers = ls.filter((l) => !inBlock.has(l));
      // 같은 묶음(같은 역할·비슷한 크기 ±40%·3개 이상, 예: 아이콘 표 라벨)은 크기·굵기·색을 대표값(중앙값·최빈값)으로 통일 — A2 추정값이 줄마다 달라 들쭉날쭉한 것 방지
      {
        const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
        const byRole = {};
        for (const l of wrap._layers) if (!l.style?.rotate && !(l.style?.radius)) (byRole[l.role || "text"] ||= []).push(l);
        for (const g of Object.values(byRole)) {
          if (g.length < 3) continue;
          const m = med(g.map(sz)); const grp = g.filter((l) => sz(l) >= m * 0.9 && sz(l) <= m * 1.1); // v12.1: ±15%(제목·설명이 한 묶음이 되어 크기·색이 같아지던 것)
          if (grp.length < 3) continue;
          const size = med(grp.map(sz)), weight = med(grp.map((l) => Number(l.style?.weight) || 400));
          const cnt = {}; grp.forEach((l) => { const c = l.style?.color; if (c) cnt[c] = (cnt[c] || 0) + 1; }); const color = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
          const gid = Math.random().toString(36).slice(2, 8);
          const oneColor = grp.every((l) => { const a = rgb(l.style?.color), b = rgb(color); return a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60; }); // 색이 원래 다른 줄(노란 제목·회색 설명)은 색을 맞추지 않는다
          for (const l of grp) { l.style = { ...l.style, size, weight, ...(color && oneColor ? { color } : {}) }; l._grp = gid; }
        }
      }
      wrap._blocks = blocks;
      wrap._w = Number(s.w || s.iw) || 0; wrap._n = n; // A3 형식은 iw/ih
      wrap._grid = s.bgGrid || null; // v11 바탕 격자(대비·넓히기)
      wrap._fixed = (Array.isArray(s.layers) ? s.layers : []).filter((l) => l && SKIP.has(l.role) && isFinite(l.x) && isFinite(l.y)).map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h })) // 그림에 남아 있는 숫자·치수(한글이 덮으면 안 됨)
        .concat((Array.isArray(s.keep) ? s.keep : []).filter((k) => k && isFinite(k.x) && isFinite(k.y))); // 남기는 영문 장식 글(OCR latin)
      return wrap;
    },
    // 메인컷: 첫 상세 이미지(배너 지운 것) 위 상단 여백에 새 한글 타이틀 — 라벨 / 큰 제품명 / 보조문 알약(원래 배너의 주황 포인트 유지)
    hero(s, base) {
      const { h, has, srcUrl, nonEmpty } = U();
      if (!has(s.image) && !has(s.name)) return null;
      const accent = s.accent || "#f08a24";
      window.__locAccent = accent; // 강조 기본색(원본 배너 포인트색) — 무채색 레이어의 강조에 쓴다
      const subs = nonEmpty(Array.isArray(s.points) ? s.points : [], has).slice(0, 3);
      const text = h("div.lh-text", { "data-bg": s.bg || "#ece7e2" },
        has(s.label) ? h("div.lh-label.cap", { text: s.label, "data-layer": "#hero.label" }) : null,
        (() => { const n = h("h1.headline.lh-name" + (s.vlines ? ".vlines" : ""), { "data-layer": "#hero.name" }, lines(s.name || s.headline).map((t, k) => [k ? h("br") : null, t]));
          const nm = String(s.name || s.headline || "").trim(); const em = Array.isArray(s.name_emph) && s.name_emph.length ? s.name_emph : Array.isArray(s.emph) && s.emph.length ? s.emph : [];
          if (em.length) U().emphasize(n, em); return n; })(),
        has(s.sub) ? h("p.lh-sub", { text: s.sub, "data-layer": "#hero.sub" }) : null,
        (() => { const bd = nonEmpty(Array.isArray(s.badges) ? s.badges : [], (b) => b && (typeof b === "string" ? has(b) : has(b.text || b.label))).slice(0, 4); // 신뢰 배지(셀러 입력)
          return bd.length ? h("div.lh-badges", null, bd.map((b, i) => h("span.lh-badge.cap", { text: typeof b === "string" ? b : (b.text || b.label), "data-layer": `#hero.badge.${i + 1}` }))) : null; })(),
        subs.length ? h("div.lh-points", null, subs.map((t, i) => [i ? h("i.lh-sep") : null, h("span.cap", { text: t, "data-layer": `#hero.point.${i + 1}` })])) : null);
      text.style.setProperty("--lh-accent", accent);
      if (s.accent_ink) text.style.setProperty("--lh-accent-ink", s.accent_ink);
      // 배너를 아직 못 지운 원본(임시): fill 색 띠로 여백 자리를 덮는다(A2 의 loc/ 이미지가 오면 필요 없음)
      const fill = has(s.fill) ? h("div.lh-fill" + (s.fill_full ? ".full" : "")) : null; // full: 평평한 띠 전체를 덮음(양옆 흐림 없음 — 띠 끝 영문 장식이 비치지 않게)
      if (fill) fill.style.background = s.fill;
      const wrap = h("div.lh-wrap", { "data-clip": "1" }, has(s.image) ? h("img.lh-img", { src: srcUrl(s.image, base), alt: "", decoding: "async", "data-src": String(s.image), "data-layer": "#hero.image" }) : null, fill, text);
      wrap._zone = s.text_zone || null; // { y0, y1 } 원본 px — 글자를 놓을 여백(없으면 위 26%)
      wrap._w = Number(s.w || s.iw) || 0;
      wrap._band = !!s.band;
      wrap._grid = s.bgGrid || null;
      return wrap;
    },
  };

  // 글자 맞춤(v11): 한 줄이 상자 폭을 넘으면 ① 옆 빈 바탕(격자 색이 글자 밑 바탕과 비슷하고 다른 글이 없는 곳)으로 상자를 넓히고
  // ② 그래도 넘치면 글자를 줄이고(최소 75%) ③ 그래도 넘치면 단어 단위 줄바꿈(최대 2줄, 넘으면 더 줄임 — 최소 60%). 늘어난 높이는 겹침 정리가 아래 글을 민다
  function roomOf(box, wrap, others) { // 이 상자를 가로로 넓힐 수 있는 범위(화면 px) [left, right]
    const l = box._l, sc = box._sc, g = wrap._grid, W = wrap.clientWidth, pad = 12;
    const y0 = l.y, y1 = l.y + l.h;
    const blockers = others.filter((o) => o !== l && o.y < y1 + 4 && o.y + o.h > y0 - 4);
    let L = pad / sc, R = (W - pad) / sc;
    // 옆 글과는 사이 빈칸의 가운데까지만(양쪽이 같이 넓혀도 맞닿지 않게) · 그림에 남긴 글(fixed)은 바로 앞까지
    for (const o of blockers) { const fx = o._fixed; if (o.x + o.w <= l.x) L = Math.max(L, fx ? o.x + o.w + 8 : (o.x + o.w + l.x) / 2 + 6); else if (o.x >= l.x + l.w) R = Math.min(R, fx ? o.x - 8 : (l.x + l.w + o.x) / 2 - 6); }
    if (g) { // 격자: 글자 밑 바탕 중앙값과 색이 많이 다른 칸(제품·사진 경계)을 만나면 멈춘다
      // 글자 밑 바탕의 흔들림은 원본 글자 때문에 크다 → 상자 바로 옆(양쪽 한 칸) 흔들림을 기준으로
      const base = medianCell(cellsIn(g, l.x, y0, l.x + l.w, y1)), side = [...window.LocCore.sdIn(g, l.x - g.cell, y0, l.x, y1), ...window.LocCore.sdIn(g, l.x + l.w, y0, l.x + l.w + g.cell, y1)].sort((a, b) => a - b), baseSd = side.length ? side[Math.floor(side.length / 2)] : 0;
      const near = (x) => window.LocCore.calmAt(g, x, y0, y1, base, baseSd);
      // v13: 바탕이 바뀌는 칸(테두리선·사진 경계)에서 멈출 때는 글자 크기 1/3 만큼 띄운다(칸 테두리에 글자가 닿던 것 — 탄소강 풀아웃 아이콘 표)
      const gap = Math.max(6, (Number(l.style?.size) || l.h * 0.78) * 0.35);
      if (base) { let x = l.x; while (x - g.cell >= L && near(x - g.cell)) x -= g.cell; if (x - g.cell >= L) x = Math.min(l.x, x + gap); L = Math.max(L, x); x = l.x + l.w; while (x + g.cell <= R && near(x)) x += g.cell; if (x + g.cell <= R) x = Math.max(l.x + l.w, x - gap); R = Math.min(R, x); }
    }
    return [Math.min(l.x, L) * sc, Math.max(l.x + l.w, R) * sc];
  }
  function fitLayer(box, wrap, others) {
    const span = box.querySelector(".loc-text"); if (!span) return;
    const base = box._fs; let f = base;
    box.style.whiteSpace = "nowrap";
    const inner = () => { const cs = getComputedStyle(box); return box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); };
    const over = () => span.scrollWidth > inner() - 2; // 안쪽 여백은 빼고 잰다
    if (box._l.shape) { box.dataset.fit = "1.00"; return; } // 도형 안 글은 shapeFit 이 맞춘다
    if (box._l.style?.vertical) { box.style.whiteSpace = "nowrap"; while (span.getBoundingClientRect().height > box.clientHeight - 2 && f > base * 0.55) { f -= Math.max(0.5, base * 0.03); box.style.fontSize = f.toFixed(1) + "px"; } box.dataset.fit = (f / base).toFixed(2); return; } // 세로쓰기: 열 높이에 맞춰 줄임
    if (over() && !Number(box._l.style?.rotate)) { // ① 넓히기
      const [L, R] = roomOf(box, wrap, others), jc = box.style.justifyContent, left = parseFloat(box.style.left), w0 = box.clientWidth, need = span.scrollWidth + (box.clientWidth - inner()) + 10;
      let nl = left, nw = Math.min(need, R - L);
      if (nw > w0) {
        if (jc === "center") { const c = left + w0 / 2; nw = Math.max(w0, Math.min(nw, 2 * Math.min(c - L, R - c))); nl = c - nw / 2; } // v13 가운데 글은 가운데를 지킨다(아이콘 밑 라벨이 옆으로 밀리지 않게) — 모자라면 아래에서 줄이기·줄바꿈
        else if (jc === "flex-end") { nl = left + w0 - nw; if (nl < L) { nl = L; } }
        else { if (left + nw > R) nl = Math.max(L, R - nw); }
        box.style.left = nl + "px"; box.style.width = nw + "px"; box.dataset.widen = (nw / w0).toFixed(2);
      }
    }
    while (over() && f > base * 0.75) { f -= Math.max(0.5, base * 0.03); box.style.fontSize = f.toFixed(1) + "px"; } // ② 줄이기
    if (over()) { // ③ 줄바꿈(최대 2줄)
      box.style.whiteSpace = "normal"; box.style.wordBreak = "keep-all";
      const lh = () => parseFloat(getComputedStyle(span).lineHeight) || f * 1.18;
      while (span.offsetHeight > lh() * 2.3 && f > base * 0.6) { f -= Math.max(0.5, base * 0.03); box.style.fontSize = f.toFixed(1) + "px"; }
      // v13.2 두 줄이 그림 아래 끝을 넘으면(안쪽으로 옮기기가 위 줄 위로 밀어 올린다 — 슬라이서 d11 빨간 띠) 한 줄로 더 줄인다(13px·원래의 50%까지)
      if (parseFloat(box.style.top) + box.offsetHeight > wrap.clientHeight - 4) { box.style.whiteSpace = "nowrap"; while (over() && f > Math.max(13, base * 0.5)) { f -= Math.max(0.5, base * 0.03); box.style.fontSize = f.toFixed(1) + "px"; } }
    }
    box.dataset.fit = (f / base).toFixed(2);
  }
  // 겹침 정리(v11): 글 상자끼리(그리고 그림에 남긴 숫자와) 겹치면 — 같은 줄(옆으로 닿음)이면 둘 다 조금 줄이고, 위아래면 아래 글을 내린다(이미지 아래 끝을 넘으면 둘 다 줄임). 겹침 0 이 될 때까지
  function unitsOf(wrap) {
    const us = [];
    for (const el of wrap.querySelectorAll(":scope > .loc-layer")) {
      const span = el.querySelector(".loc-text"), cs = getComputedStyle(el), boxy = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0; // 알약·배지는 상자째로
      us.push({ el, rect: () => rel(boxy ? el : span || el, wrap), move: (d) => { el.style.top = (parseFloat(el.style.top) + d) + "px"; }, shrink: (k) => { el.style.fontSize = Math.max(14, (el._fs || 20) * 0.6, parseFloat(el.style.fontSize) * k).toFixed(1) + "px"; } }); // v13 겹침 정리로 줄여도 14px·원래의 60% 밑으로는 안 내린다(12px 알약 글 — 컵홀더 d10)
    }
    for (const el of wrap.querySelectorAll(":scope > .loc-block")) us.push({ el, rect: () => { const rs = [...el.querySelectorAll(".lb-title, .lb-sub")].map((e) => rel(e, wrap, true)); return rs.length ? { l: Math.min(...rs.map((q) => q.l)), t: Math.min(...rs.map((q) => q.t)), r: Math.max(...rs.map((q) => q.r)), b: Math.max(...rs.map((q) => q.b)) } : rel(el, wrap); }, /* 블록 상자 폭은 고정이라 실제 글 줄 상자로 */ move: (d) => { el.style.top = (parseFloat(el.style.top) + d) + "px"; }, shrink: (k) => el.querySelectorAll(".lb-title, .lb-sub").forEach((e) => { e.style.fontSize = Math.max(12, parseFloat(e.style.fontSize) * k).toFixed(1) + "px"; }) });
    return us;
  }
  function rel(el, wrap, text = false) { // 글자 실제 줄 상자들의 합(래퍼 기준) — 회전한 상자는 테두리 상자
    const wr = wrap.getBoundingClientRect(); let r;
    if (text || el.classList.contains("loc-text")) { const rg = document.createRange(); rg.selectNodeContents(el); const rs = [...rg.getClientRects()].filter((q) => q.width > 1 && q.height > 1); r = rs.length ? { left: Math.min(...rs.map((q) => q.left)), top: Math.min(...rs.map((q) => q.top)), right: Math.max(...rs.map((q) => q.right)), bottom: Math.max(...rs.map((q) => q.bottom)) } : el.getBoundingClientRect(); }
    else r = el.getBoundingClientRect();
    return { l: r.left - wr.left, t: r.top - wr.top, r: r.right - wr.left, b: r.bottom - wr.top };
  }
  const hit = (a, b) => window.LocCore.hit(a, b);
  function countOverlaps(us, fixed) { let n = 0; const rs = us.map((u) => u.rect()); for (let i = 0; i < rs.length; i++) { for (let j = i + 1; j < rs.length; j++) if (hit(rs[i], rs[j])) n++; for (const f of fixed) if (hit(rs[i], f)) n++; } return n; }
  function resolveOverlaps(wrap, us, fixed) { // 판단은 LocCore.nextFix(사각형만 보고 한 걸음), 여기서는 적용하고 다시 잰다(글자 크기가 바뀌면 줄바꿈이 달라지므로)
    const H = wrap.clientHeight, st = { moved: 0, shrunk: 0 };
    for (let it = 0; it < 80; it++) {
      const f = nextFix(us.map((u) => u.rect()), fixed, H); if (!f) break;
      if (f.move && us[f.move.i].el._locked) { const o = us.findIndex((u, i) => i !== f.move.i && !u.el._locked && window.LocCore.hit(u.rect(), us[f.move.i].rect())); if (o >= 0) us[o].shrink(0.93); else us[f.move.i].shrink(0.93); st.shrunk++; continue; } // 도형 안 글은 자리를 지킨다
      if (f.move) { us[f.move.i].move(f.move.dy); st.moved++; }
      for (const i of f.shrink || []) us[i].shrink(0.93);
      if (f.lift) us[f.lift.i].move(f.lift.dy);
      if (f.shrink?.length) st.shrunk++;
    }
    return st;
  }
  // 글자색: 최종 위치 밑 바탕 칸들로 다시 고른다(pickInk) — 바뀐 상자는 data-ink 에 기록
  function inkUnder(el, wrap, sc, large) {
    const g = wrap._grid; if (!g) return null;
    const r = rel(el.querySelector(".loc-text") || el, wrap), cells = cellsIn(g, r.l / sc, r.t / sc, r.r / sc, r.b / sc);
    if (!cells.length) return null;
    const own = !/rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(el).backgroundColor); if (own) return null; // 알약·배지: 자기 배경색 기준(inkFor 가 이미 맞춤)
    const cs = getComputedStyle(el), mc0 = medianCell(cells), oc = rgb(el._l?.style?.color);
    if (oc && mc0 && con(oc, mc0) >= 1.5) { el.dataset.bg = hx(mc0); return { color: el._l.style.color, con: +con(oc, mc0).toFixed(2), changed: false, kept: true }; } // 원본 글자색 유지(원래 자리 바탕 그대로)
    const p = pickInk(rgbToHex(cs.color), cells, large);
    const mc = medianCell(cells); if (mc) el.dataset.bg = hx(mc);
    if (p.changed) { el.style.color = p.color; el.dataset.ink = `${p.from}→${p.color} ${p.con}:1`; el.style.setProperty("--em-color", emColorOf(el.style.getPropertyValue("--em-color") || "#f0962e", p.color === "#ffffff" ? "#111111" : "#ffffff")); }
    if (p.shadow) el.style.textShadow = p.shadow;
    return p;
  }

  // 같은 역할 크기 맞춤: 도형 밖 글 중 역할이 같고 원래 크기가 ±25% 안인 줄끼리 → 가장 작은 크기·가장 흔한 굵기
  function roleUnify(els) {
    const vis = els.filter((e) => !e._l.shape && e.style.display !== "none");
    const osz = (e) => Number(e._l.style?.size) || e._l.h * 0.78, used = new Set(), rot = (e) => Math.round(Number(e._l.style?.rotate) || 0);
    for (const a of vis) {
      if (used.has(a)) continue; // v13 기울어진 글(사선 판 층 라벨)도 같은 각도끼리 묶는다(4개 층 라벨이 두 크기로 갈리던 것 — 탄소강 풀아웃 d07)
      const cl = vis.filter((b) => !used.has(b) && (b._l.role || "text") === (a._l.role || "text") && !!b._l.style?.vertical === !!a._l.style?.vertical /* v13.2 세로쓰기와 가로 글은 따로 */ && Math.abs(rot(b) - rot(a)) <= 3 && Math.abs(osz(b) - osz(a)) <= Math.max(osz(a), osz(b)) * 0.12);
      if (cl.length < 2) continue; cl.forEach((b) => used.add(b));
      const f = Math.min(...cl.map((b) => parseFloat(b.style.fontSize))), ws = cl.map((b) => Number(b.style.fontWeight) || 400).sort((x, y) => x - y), w = ws[ws.length >> 1];
      cl.forEach((b) => { b.style.fontSize = f.toFixed(1) + "px"; b.style.fontWeight = String(w); });
    }
  }
  // 페이지 크기 체계: 제목급(title)·부제(sub) 글 크기를 장을 넘어 3단계 안으로 — 12% 안의 크기들은 그 묶음의 가장 작은 값으로(줄이기만 하므로 넘침·겹침이 생기지 않는다)
  function pageScale(root) {
    const out = {};
    for (const role of ["title", "sub", "label"]) {
      const es = [...root.querySelectorAll(".loc-layer.role-" + role)].filter((e) => e.style.display !== "none" && !e.dataset.shape && !e.dataset.vertical);
      const fs = es.map((e) => parseFloat(e.style.fontSize)).sort((a, b) => b - a), lv = [];
      for (const f of fs) { const l = lv[lv.length - 1]; if (l && f >= l.max * 0.88) l.min = f; else lv.push({ max: f, min: f }); }
      es.forEach((e) => { const f = parseFloat(e.style.fontSize), l = lv.find((x) => f <= x.max && f >= x.min); if (l && f > l.min) e.style.fontSize = l.min.toFixed(1) + "px"; });
      out[role] = lv.length;
    }
    return out;
  }
  // 검사 숫자: 같은 장·같은 역할·원래 비슷한 크기 줄의 최종 크기 편차(최대/최소 − 1, %), 같은 열 왼쪽 정렬 줄들의 왼쪽 끝 편차(px)
  function layoutMetrics(root) {
    let roleDev = 0, colDev = 0, colWorst = null, roleWorst = null;
    for (const wrap of root.querySelectorAll(".loc-wrap")) {
      const es = [...wrap.querySelectorAll(":scope > .loc-layer")].filter((e) => e.style.display !== "none" && e._l && !e.dataset.shape);
      const osz = (e) => Number(e._l.style?.size) || e._l.h * 0.78, rot = (e) => Math.round(Number(e._l.style?.rotate) || 0);
      for (const a of es) for (const b of es) if (a !== b && (a._l.role || "") === (b._l.role || "") && !!a._l.style?.vertical === !!b._l.style?.vertical && Math.abs(rot(a) - rot(b)) <= 3 && Math.abs(osz(a) - osz(b)) <= Math.max(osz(a), osz(b)) * 0.12) roleDev = Math.max(roleDev, parseFloat(a.style.fontSize) / parseFloat(b.style.fontSize) - 1);
      const left = es.filter((e) => e.style.justifyContent === "flex-start" && !rot(e));
      // v13 같은 열 = 바로 위아래로 붙은 줄(사이 ≤ 1.2줄 높이)만 — 멀리 떨어진 판 위 라벨끼리 비교하던 오탐(컵홀더 d09)
      for (const a of left) for (const b of left) { if (a === b) continue; const ov = Math.min(a._l.x + a._l.w, b._l.x + b._l.w) - Math.max(a._l.x, b._l.x); if (ov < Math.min(a._l.w, b._l.w) * 0.5 || Math.abs(a._l.x - b._l.x) > 30) continue; const [p, q] = a._l.y <= b._l.y ? [a._l, b._l] : [b._l, a._l]; if (q.y - (p.y + p.h) > Math.max(p.h, q.h) * 1.2) continue; const dv = Math.abs(rel(a.querySelector(".loc-text"), wrap).l - rel(b.querySelector(".loc-text"), wrap).l); if (dv > colDev) { colDev = dv; colWorst = `${a.textContent.slice(0, 14)} / ${b.textContent.slice(0, 14)}`; } }
    }
    return { roleDev: Math.round(roleDev * 100), colDev: Math.round(colDev), colWorst };
  }
  // 도형 맞춤(v12.1): 원·알약·띠·칸(localize 가 찾은 layer.shape) 안의 글은 도형 내부 사각형(원 = 내접 사각형)에 가운데로, 줄마다 한 줄로 줄여 맞추고,
  // 같은 도형 안 줄들은 위→아래 차례로(줄 간격 0.25em), 높이가 넘치면 함께 줄이고 그래도 넘치면 아래 줄부터 뺀다.
  // 같은 모양이 가로로 반복되는 도형들(4칸 고민·원 배지 여러 개)은 줄 번호마다 같은 글 크기·굵기, 같은 세로 위치로 맞춘다. 반환 { groups, overflow(도형 밖으로 나간 줄 수) }
  function shapeFit(els, wrap, sc) {
    // 같은 도형: 줄마다 찾은 도형 상자가 조금씩 달라도(씨앗 위치 차이) 서로 70% 넘게 겹치면 하나 — 합집합의 공통 부분을 도형으로
    const G = [];
    const iou = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); if (w <= 0 || h <= 0) return 0; return (w * h) / Math.min(a.w * a.h, b.w * b.h); };
    for (const el of els) { const s = el._l.shape; if (!s || Number(el._l.style?.rotate)) continue; const g = G.find((x) => iou(x.s, s) > 0.7); if (g) { const x0 = Math.max(g.s.x, s.x), y0 = Math.max(g.s.y, s.y), x1 = Math.min(g.s.x + g.s.w, s.x + s.w), y1 = Math.min(g.s.y + g.s.h, s.y + s.h); g.s = { ...g.s, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; g.els.push(el); } else G.push({ s: { ...s }, els: [el] }); }
    for (const el of els) { if (Number(el._l.style?.rotate)) continue; const L = el._l.textBox || el._l, span = G.filter((x) => Math.min(L.x + L.w, x.s.x + x.s.w) - Math.max(L.x, x.s.x) > x.s.w * 0.3 && L.y < x.s.y + x.s.h && L.y + L.h > x.s.y); if (span.length >= 2) { el.style.display = "none"; el.dataset.dropped = "span"; G.forEach((g) => { g.els = g.els.filter((e) => e !== el); }); } }
    for (let i = G.length - 1; i >= 0; i--) if (!G[i].els.length) G.splice(i, 1); // 두 칸 이상에 걸친 줄 = OCR 이 칸을 넘어 묶은 것 → 뺀다
    for (const el of els) { if (el._l.shape || Number(el._l.style?.rotate) || el.dataset.dropped) continue; const cx = el._l.x + el._l.w / 2, cy = el._l.y + el._l.h / 2, g = G.find((x) => cx > x.s.x && cx < x.s.x + x.s.w && cy > x.s.y && cy < x.s.y + x.s.h); if (g) { g.els.push(el); el._l = { ...el._l, shape: g.s }; } } // 도형을 못 찾은 줄도 가운데가 도형 안이면 그 도형에
    const inner = (s) => { if (s.circle) { const side = Math.min(s.w, s.h) * 0.72; return { l: (s.x + s.w / 2 - side / 2) * sc, t: (s.y + s.h / 2 - side / 2) * sc, w: side * sc, h: side * sc }; } const px = s.round ? s.h * 0.35 : s.w * 0.05, py = s.round ? s.h * 0.1 : s.h * 0.08; return { l: (s.x + px) * sc, t: (s.y + py) * sc, w: (s.w - px * 2) * sc, h: (s.h - py * 2) * sc }; };
    // v13 왼쪽 정렬 목록(사양 칸 등, 줄 2개 이상이 모두 left)은 도형 안에서도 왼쪽 정렬 — 원래 왼쪽 끝에서 시작(가운데로 모으던 것 — 탄소강 풀아웃 d11)
    const boxOf = (g) => { const R = inner(g.s); const left = g.els.length >= 2 && !g.s.circle && g.els.every((e) => (e._l.style?.align || "left") === "left"); if (!left) return { ...R, al: "center" }; const x = Math.max(R.l, Math.min(...g.els.map((e) => e._l.x)) * sc); return { l: x, t: R.t, w: R.l + R.w - x, h: R.h, al: "left" }; };
    const layout = (g, fs, topMode) => { // fs: 줄별 글자 크기, 반환 블록 높이
      const R = boxOf(g); let y = 0; const hs = [];
      g.els.forEach((e, i) => { if (e.style.display === "none") { hs.push(0); return; } e.style.fontSize = fs[i].toFixed(1) + "px"; e.style.whiteSpace = e._wrap ? "normal" : "nowrap"; e.style.left = R.l + "px"; e.style.width = R.w + "px"; e.style.minHeight = "0px"; e.style.justifyContent = R.al === "left" ? "flex-start" : "center"; e.style.textAlign = R.al; e.style.padding = "0"; e.style.lineHeight = "1.2"; hs.push(e.offsetHeight); });
      const gap = (i) => (i ? Math.round(fs[i] * 0.25) : 0), H = hs.reduce((a, h, i) => a + h + (h ? gap(i) : 0), 0);
      const top = topMode === "center" || g.s.round ? R.t + (R.h - H) / 2 : Math.min(Math.max(R.t, g.els[0]._l.y * sc), R.t + R.h - H);
      g.els.forEach((e, i) => { if (!hs[i]) return; y += gap(i); e.style.top = (top + y) + "px"; y += hs[i]; });
      return H;
    };
    // v13.2 한 줄로 줄이다 14px·원래의 70% 밑으로 가야 하면 두 줄로(도형 안 부제가 11.6px 로 줄던 것 — 슬라이서 d16)
    const fitW = (e, R, f0, min) => { let f = f0; e.style.fontSize = f + "px"; e.style.whiteSpace = "nowrap"; e._wrap = false; const sp = e.querySelector(".loc-text"), floor = Math.max(min, 14, f0 * 0.7); while (sp && sp.scrollWidth > R.w - 2 && f > floor) { f -= Math.max(0.5, f0 * 0.03); e.style.fontSize = f.toFixed(1) + "px"; } if (sp && sp.scrollWidth > R.w - 2) { e._wrap = true; e.style.whiteSpace = "normal"; e.style.wordBreak = "keep-all"; } return f; };
    for (const g of G) {
      g.els.sort((a, b) => a._l.y - b._l.y); const R = boxOf(g);
      g.els.forEach((e) => { e._locked = true; e.dataset.shape = g.s.circle ? "circle" : g.s.round ? "pill" : "rect"; e.style.left = R.l + "px"; e.style.width = R.w + "px"; });
      let fs = g.els.map((e) => { const f0 = parseFloat(e.style.fontSize); return fitW(e, R, f0, Math.max(11, f0 * 0.55)); });
      let H = layout(g, fs);
      if (H > R.h && g.els.some((e) => e._wrap)) { fs = g.els.map((e, i) => { if (!e._wrap) return fs[i]; const f0 = parseFloat(e.style.fontSize); let f = f0; e._wrap = false; e.style.whiteSpace = "nowrap"; const sp = e.querySelector(".loc-text"); while (sp && sp.scrollWidth > R.w - 2 && f > 13) { f -= Math.max(0.5, f0 * 0.03); e.style.fontSize = f.toFixed(1) + "px"; } return f; }); H = layout(g, fs); } // v13.2 두 줄이 도형에 안 들어가면 한 줄로 더 줄인다(빨간 띠 제목이 두 줄로 띠 위로 넘치던 것 — 슬라이서 d11)
      for (let k = 0; k < 12 && H > R.h; k++) { fs = fs.map((f) => Math.max(13, f * 0.94)); H = layout(g, fs); } // v13.2 13px 밑으로는 안 줄이고(작은 글 금지) 넘치면 아래 줄부터 뺀다
      for (let i = g.els.length - 1; H > R.h && i > 0; i--) { g.els[i].style.display = "none"; g.els[i].dataset.dropped = "shape"; H = layout(g, fs); }
      { const osz = (e) => Number(e._l.style?.size) || e._l.h * 0.78; g.els.forEach((a, i) => { const same = g.els.map((b, j) => j).filter((j) => Math.abs(osz(g.els[j]) - osz(a)) <= Math.max(osz(a), osz(g.els[j])) * 0.08 && (g.els[j]._l.role || "") === (a._l.role || "")); const m = Math.min(...same.map((j) => fs[j])); same.forEach((j) => { fs[j] = m; }); }); H = layout(g, fs); } // 도형 안 비슷한 크기 줄(설명 두 줄 등)은 같은 크기
      g.fs = fs; g.H = H;
    }
    // 반복 도형 맞춤: 줄 수·도형 크기(±20%)가 같은 도형들 → 줄 번호마다 가장 작은 글 크기·같은 굵기, 같은 세로 자리
    const used = new Set();
    for (const g of G) {
      if (used.has(g)) continue;
      const cl = G.filter((h) => !used.has(h) && h.els.length === g.els.length && Math.abs(h.s.w - g.s.w) <= g.s.w * 0.2 && Math.abs(h.s.h - g.s.h) <= g.s.h * 0.2);
      if (cl.length < 2) continue; cl.forEach((h) => used.add(h));
      const fs = g.fs.map((_, i) => Math.min(...cl.map((h) => h.fs[i])));
      const wt = g.els.map((_, i) => { const ws = cl.map((h) => Number(h.els[i].style.fontWeight) || 400).sort((a, b) => a - b); return ws[ws.length >> 1]; });
      cl.forEach((h) => { h.els.forEach((e, i) => { e.style.fontWeight = String(wt[i]); }); h.H = layout(h, fs, "center"); h.fs = fs; });
    }
    // 검사: 글 줄 상자가 도형 내부 사각형 밖으로 2px 넘게 나가면 넘침
    let overflow = 0;
    for (const g of G) { const R = inner(g.s); for (const e of g.els) { if (e.style.display === "none") continue; const r = rel(e.querySelector(".loc-text") || e, wrap); if (r.l < R.l - 2 || r.r > R.l + R.w + 2 || r.t < R.t - 2 || r.b > R.t + R.h + 2) { overflow++; e.dataset.overflow = "1"; } } }
    return { groups: G.length, overflow };
  }
  // 세로 묶음 맞추기: 같은 열(가로 겹침 ≥ 60%)에 줄 간격이 좁게(< 0.8줄) 쌓인 작은 글(원본 40px 미만) 2줄 이상 = 칸 하나.
  // 그 칸 영역(원래 줄들 합집합, 아래 12% 여유) 안에 줄들을 위에서부터 차례로 놓고, 넘치면 같이 6%씩 줄이고(최소 12px·원래의 70%) 그래도 넘치면 아래 줄부터 뺀다
  function stackFit(els, wrap, sc) {
    const cand = els.filter((el) => !el._l.shape && !Number(el._l.style?.rotate) && !el._l.style?.vertical && (Number(el._l.style?.size) || el._l.h) < 40 && !el._l.style?.radius && !el._l.style?.bg).sort((a, b) => a._l.y - b._l.y);
    const used = new Set();
    for (const a of cand) {
      if (used.has(a)) continue;
      const st = [a];
      for (const b of cand) { if (used.has(b) || st.includes(b)) continue; const p = st[st.length - 1]._l, q = b._l; const ov = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x); if (ov >= Math.min(p.w, q.w) * 0.6 && q.y - (p.y + p.h) < Math.max(p.h, q.h) * 0.8 && q.y >= p.y) st.push(b); }
      if (st.length < 2) continue;
      st.forEach((e) => used.add(e));
      const x0 = Math.min(...st.map((e) => e._l.x)), x1 = Math.max(...st.map((e) => e._l.x + e._l.w)), y0 = Math.min(...st.map((e) => e._l.y)), y1 = Math.max(...st.map((e) => e._l.y + e._l.h));
      const l0 = st.every((e) => e.style.justifyContent === "flex-start") ? Math.min(x0 * sc, ...st.map((e) => parseFloat(e.style.left))) : x0 * sc; // v13 앞 단계에서 맞춘 왼쪽 끝(넓히느라 왼쪽으로 옮긴 제목과 같은 열)을 지킨다 — 원래 x 로 되돌려 열이 어긋나던 것(안경 세척기 d06)
      const R = { l: l0, t: y0 * sc, w: x1 * sc - l0, h: (y1 - y0) * sc * 1.12 };
      const f0 = st.map((e) => parseFloat(e.style.fontSize));
      const place = () => { let y = R.t; for (const e of st) { if (e.style.display === "none") continue; e.style.left = R.l + "px"; e.style.width = R.w + "px"; e.style.top = y + "px"; e.style.minHeight = "0px"; e.style.whiteSpace = "nowrap"; const span = e.querySelector(".loc-text"); while (span && span.scrollWidth > R.w - 2 && parseFloat(e.style.fontSize) > 12) e.style.fontSize = (parseFloat(e.style.fontSize) * 0.94).toFixed(1) + "px"; y += e.offsetHeight + 2; } return y - R.t; };
      let k = 1, H = place();
      while (H > R.h && k > 0.7) { k *= 0.94; st.forEach((e, i) => { e.style.fontSize = Math.max(12, f0[i] * k).toFixed(1) + "px"; }); H = place(); }
      for (let i = st.length - 1; H > R.h && i > 0; i--) { st[i].style.display = "none"; st[i].dataset.dropped = "stack"; H = place(); }
      st.forEach((e) => { e.dataset.stack = "1"; });
    }
  }
  // 회전한 글 등이 이미지 밖으로 나가면 안쪽으로 옮기고, 그래도 넘치면 글자를 줄인다(잘림 방지)
  function keepInside(el, wrap) {
    const span = el.querySelector(".loc-text") || el;
    for (let k = 0; k < 12; k++) {
      const r = span.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const over = Math.max(0, r.right - (wr.right - 6)), under = Math.max(0, (wr.left + 6) - r.left);
      const overY = Math.max(0, r.bottom - (wr.bottom - 4)), underY = Math.max(0, (wr.top + 4) - r.top);
      if (!over && !under && !overY && !underY) return;
      el.style.left = (parseFloat(el.style.left) - over + under) + "px"; el.style.top = (parseFloat(el.style.top) - overY + underY) + "px";
      const r2 = span.getBoundingClientRect(); // 옮겨도 폭이 이미지보다 크면 축소
      if (r2.width > wr.width - 12 || r2.height > wr.height - 8) el.style.fontSize = (parseFloat(el.style.fontSize) * 0.94).toFixed(1) + "px";
    }
  }
  // 타이포 블록: 영역(레이어들 합집합) 안에 제목(에스코어드림·굵기 대비·강조) + 보조문(Pretendard) — 원본 정렬·색감 유지, 넘치면 함께 축소
  function typeBlock(ls, k, sc, wrap) {
    const { h } = U();
    const x0 = Math.min(...ls.map((l) => l.x)), y0 = Math.min(...ls.map((l) => l.y)), x1 = Math.max(...ls.map((l) => l.x + l.w)), y1 = Math.max(...ls.map((l) => l.y + l.h));
    const sorted = [...ls].sort((a, b) => (b.style?.size || b.h) - (a.style?.size || a.h) || a.y - b.y);
    const head = sorted[0], rest = ls.filter((l) => l !== head).sort((a, b) => a.y - b.y);
    const st = head.style || {}, under = st.under || st.bg || st.fill || "#ffffff";
    const align = st.align || "left", color = inkFor(st.color || "#111111", under);
    const blk = h("div.loc-block.deco" + (head.vlines ? ".vlines" : ""), { "data-bg": under, "data-layer": `#image.${wrap._n}.block.${k + 1}` });
    Object.assign(blk.style, { left: Math.round(x0 * sc) + "px", top: Math.round(y0 * sc) + "px", width: Math.round((x1 - x0) * sc) + "px", textAlign: align, color });
    blk.style.setProperty("--em-color", emColorOf(head.accent || st.accent || st.color || "#f0962e", under));
    const hs = (st.size || head.h * 0.78) * sc;
    const t = h("div.lb-title", null, lines(head.ko).map((x, i) => [i ? h("br") : null, U().noOrphan(x)]));
    t.style.fontSize = Math.round(Math.max(30, hs)) + "px";
    const em = Array.isArray(head.emph) && head.emph.length ? head.emph : []; // plan 에 emph 가 없으면 자동 강조 없음
    if (em.length) U().emphasize(t, em); t._l = head;
    // v13 원래 줄 순서대로(위의 작은 머리말이 제목 아래로 내려가지 않게 — 힙업밴드 d03 "엄선 소재 밴드")
    for (const r of [...ls].sort((a, b) => a.y - b.y)) {
      if (r === head) { blk.append(t); continue; }
      const p = h("div.lb-sub", null, lines(r.ko).map((x, i) => [i ? h("br") : null, U().noOrphan(x)]));
      p.style.fontSize = Math.round(Math.max(22, (r.style?.size || r.h * 0.78) * sc * 0.92)) + "px";
      if (r.style?.color) p.style.color = inkFor(r.style.color, r.style.under || under);
      if (Array.isArray(r.emph)) U().emphasize(p, r.emph);
      p._l = r; blk.append(p);
    }
    wrap.append(blk);
    // 줄마다 한 줄 유지(원본 줄 수)를 먼저 시도: 폭을 넘으면 그 줄만 줄이고(최소 75%), 그래도 넘치면 줄바꿈
    for (const e of blk.querySelectorAll(".lb-title, .lb-sub")) {
      e.style.whiteSpace = "nowrap"; const f0 = parseFloat(e.style.fontSize); let f = f0;
      while (e.scrollWidth > blk.clientWidth - 2 && f > f0 * 0.75) { f -= f0 * 0.03; e.style.fontSize = f.toFixed(1) + "px"; }
      if (e.scrollWidth > blk.clientWidth - 2) e.style.whiteSpace = "normal";
    }
    const lim = (y1 - y0) * sc * 1.12 + 8; // 영역보다 12% 까지만
    for (let i = 0; i < 14 && blk.offsetHeight > lim; i++) blk.querySelectorAll(".lb-title, .lb-sub").forEach((e) => { e.style.fontSize = Math.max(e.classList.contains("lb-title") ? 26 : 22, parseFloat(e.style.fontSize) * 0.94).toFixed(1) + "px"; });
    // v13 줄마다 원래 줄의 세로 가운데에 맞춘다(흐름보다 위로는 안 올림) — 위로 몰아 쌓아 원래 큰 제목 자리가 지운 바탕째 비던 것
    for (const e of blk.querySelectorAll(".lb-title, .lb-sub")) { if (!e._l) continue; const want = (e._l.y + e._l.h / 2 - y0) * sc - e.offsetHeight / 2, d = want - e.offsetTop; if (d > 2) e.style.marginTop = (parseFloat(getComputedStyle(e).marginTop) + d).toFixed(1) + "px"; }
    keepInside(blk, wrap);
  }
  const rgbToHex = (c) => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || ""); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("") : "#efebe5"; };
  const cardAfter = T.after;
  async function after(root, plan) {
    try { if (document.fonts) await document.fonts.ready; } catch {} // 글꼴이 늦게 오면 폭을 잘못 재서 넘친다(재기 전에 기다림)
    const W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--w")) || 780;
    const report = { shapeOverflow: 0, shapeGroups: 0, roleDev: 0, colDev: 0, overlapBefore: 0, overlapAfter: 0, moved: 0, shrunk: 0, inkChanged: 0, lowInk: 0, hero: null }; // 자체 점검(page.html 의 #page data-loc-report)
    for (const wrap of root.querySelectorAll(".loc-wrap")) {
      const im = wrap.querySelector("img"); if (!im || !im.naturalWidth) continue;
      const w0 = wrap._w || im.naturalWidth, sc = W / w0;
      wrap.style.height = Math.round(W * im.naturalHeight / im.naturalWidth) + "px";
      const all = wrap._layers || [];
      const els = all.map((l, i) => { const el = layerEl(l, i, sc, `image.${wrap._n}`); el._grp = l._grp; wrap.append(el); return el; });
      try { void document.body.offsetHeight; if (document.fonts) { await document.fonts.load(`700 40px ${getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "sans-serif"}`).catch(() => {}); await document.fonts.ready; } } catch {} // 제목 글꼴(--display)은 쓰일 때 내려받기 시작 → 붙인 뒤 기다렸다 잰다(안 그러면 폭을 작게 재서 넘침)
      els.forEach((el) => fitLayer(el, wrap, [...all, ...(wrap._fixed || []).map((f) => ({ ...f, _fixed: true }))]));
      // 묶음은 글자 맞춤 뒤 가장 작아진 크기로 다 같이(한 묶음 안에서 크기가 달라 보이지 않게)
      const groups = {}; els.forEach((el) => { if (el._grp) (groups[el._grp] ||= []).push(el); });
      for (const g of Object.values(groups)) { const f = Math.min(...g.map((el) => parseFloat(el.style.fontSize))); g.forEach((el) => { el.style.fontSize = f.toFixed(1) + "px"; }); }
      // 같은 덩어리(세로로 붙은 같은 역할·비슷한 크기 줄)의 제목 줄은 같은 크기로 — 한 줄만 줄어 들쭉날쭉해 보이지 않게
      const stack = []; els.filter((el) => !el._grp && !Number(el._l.style?.rotate) && !el._l.style?.vertical).sort((a, b) => a._l.y - b._l.y).forEach((el) => { const p = stack.at(-1)?.at(-1); const l = el._l, q = p?._l; if (q && l.role === q.role && l.y - (q.y + q.h) < Math.max(l.h, q.h) * 0.9 && Math.abs((Number(l.style?.size) || l.h) - (Number(q.style?.size) || q.h)) <= Math.max(Number(l.style?.size) || l.h, Number(q.style?.size) || q.h) * 0.25) stack.at(-1).push(el); else stack.push([el]); });
      for (const g of stack) if (g.length > 1 && ["title", "sub"].includes(g[0]._l.role)) { const f = Math.min(...g.map((el) => parseFloat(el.style.fontSize))); g.forEach((el) => { el.style.fontSize = f.toFixed(1) + "px"; }); }
      // 세로로 붙은 줄들(역할 무관)은 정렬 기준선을 맞춘다 — 넓히기로 한 줄만 왼쪽으로 밀려 들쭉날쭉해 보이지 않게(왼쪽 정렬 = 왼쪽 끝, 가운데 = 가운데)
      { const ss = []; els.filter((el) => !Number(el._l.style?.rotate) && !el._l.style?.vertical).sort((a, b) => a._l.y - b._l.y).forEach((el) => { const q = ss.at(-1)?.at(-1)?._l, l = el._l; if (q && l.y - (q.y + q.h) < Math.max(l.h, q.h) * 0.9 && Math.abs(l.x - q.x) < Math.max(24, q.w * 0.15) && el.style.justifyContent === ss.at(-1).at(-1).style.justifyContent) ss.at(-1).push(el); else ss.push([el]); });
        // 같은 덩어리 안에서 원래 크기가 비슷한(±30%) 이웃 줄은 같은 크기로(넓히기 덕에 한 줄만 커져 위계가 뒤집히지 않게)
        const osz = (el) => Number(el._l.style?.size) || el._l.h * 0.78;
        for (const g of ss) { let run = [g[0]]; const flush = () => { if (run.length > 1) { const f = Math.min(...run.map((el) => parseFloat(el.style.fontSize))); run.forEach((el) => { el.style.fontSize = f.toFixed(1) + "px"; }); } };
          for (let i = 1; i < g.length; i++) { const a = osz(g[i - 1]), b = osz(g[i]); if (Math.max(a, b) <= Math.min(a, b) * 1.3) run.push(g[i]); else { flush(); run = [g[i]]; } } flush(); }
        for (const g of ss) if (g.length > 1 && g[0].style.justifyContent === "flex-start") { const x = Math.min(...g.map((el) => parseFloat(el.style.left))); g.forEach((el) => { const d = parseFloat(el.style.left) - x; if (d > 0) { el.style.left = x + "px"; el.style.width = (parseFloat(el.style.width) + d) + "px"; } }); } }
      els.forEach((el) => keepInside(el, wrap));
      { // v13.2 안쪽으로 옮기기(keepInside)가 한 줄만 왼쪽으로 밀면 세로 묶음 왼쪽 끝을 다시 맞춘다(슬라이서 d22 제목 두 줄 50px 어긋남)
        const ss = []; els.filter((el) => !Number(el._l.style?.rotate) && !el._l.style?.vertical && el.style.justifyContent === "flex-start").sort((a, b) => a._l.y - b._l.y).forEach((el) => { const q = ss.at(-1)?.at(-1)?._l, l = el._l; if (q && l.y - (q.y + q.h) < Math.max(l.h, q.h) * 0.9 && Math.abs(l.x - q.x) < Math.max(24, q.w * 0.15)) ss.at(-1).push(el); else ss.push([el]); });
        for (const g of ss) if (g.length > 1) { const x = Math.min(...g.map((el) => parseFloat(el.style.left))); g.forEach((el) => { const d = parseFloat(el.style.left) - x; if (d > 0) { el.style.left = x + "px"; el.style.width = (parseFloat(el.style.width) + d) + "px"; } }); }
      }
      roleUnify(els); // v12.1 같은 장 같은 역할·비슷한 원래 크기(±25%) 줄은 같은 크기·굵기(작은 쪽으로)
      stackFit(els, wrap, sc);
      const sf = shapeFit(els, wrap, sc); report.shapeOverflow += sf.overflow; report.shapeGroups += sf.groups; // v12.1 칸 안 세로 묶음(고민 4칸 등): 원래 묶음 영역 안에 위→아래로, 넘치면 함께 줄이고 그래도 넘치면 아래 줄부터 생략
      (wrap._blocks || []).forEach((ls, k) => typeBlock(ls, k, sc, wrap));
      const fixed = (wrap._fixed || []).map((f) => ({ l: f.x * sc, t: f.y * sc, r: (f.x + f.w) * sc, b: (f.y + f.h) * sc }));
      const us = unitsOf(wrap), before = countOverlaps(us, fixed), st = resolveOverlaps(wrap, us, fixed); roleUnify(els); /* 겹침 정리로 한 줄만 줄었으면 같은 역할 줄도 같이(줄이기만 — 새 겹침 없음) */ const afterN = countOverlaps(us, fixed);
      let low = 0, changed = 0;
      for (const el of [...els, ...wrap.querySelectorAll(":scope > .loc-block .lb-title, :scope > .loc-block .lb-sub")]) { const cs0 = getComputedStyle(el), fz = parseFloat(cs0.fontSize), wt = Number(cs0.fontWeight) || 400; const p = inkUnder(el, wrap, sc, fz >= 24 || (fz >= 19 && wt >= 700)); if (p?.changed) changed++; if (p && p.con != null && p.con < (fz >= 24 || (fz >= 19 && wt >= 700) ? 3 : 4.5)) low++; } // v12: 타이포 블록 줄도 실제 바탕으로 색 점검
      Object.assign(wrap.dataset, { overlap0: before, overlap: afterN, moved: st.moved, shrunk: st.shrunk, inkChanged: changed, lowInk: low });
      report.overlapBefore += before; report.overlapAfter += afterN; report.moved += st.moved; report.shrunk += st.shrunk; report.inkChanged += changed; report.lowInk += low;
    }
    for (const wrap of root.querySelectorAll(".lh-wrap")) {
      const im = wrap.querySelector("img"); const t = wrap.querySelector(".lh-text");
      if (wrap._band) { // 상단 여백이 있는 사진이 없을 때: 글자는 사진 위쪽 단색 띠에(사진과 겹치지 않음)
        wrap.classList.add("band"); wrap.prepend(t);
        { const nm = t.querySelector(".lh-name"); if (nm) { nm.style.whiteSpace = "nowrap"; let f = parseFloat(getComputedStyle(nm).fontSize); while (nm.scrollWidth > t.clientWidth - 80 && f > 40) { f -= 2; nm.style.fontSize = f + "px"; } if (nm.scrollWidth > t.clientWidth - 80) nm.style.whiteSpace = "normal"; } } // v12 상품명은 한 줄로 크게(넘치면 40px 까지 줄이고 그래도 넘치면 줄바꿈)
        const bg = (window.__edgeColors || {})[im?.dataset.src + "#top"] || "#efebe5";
        t.style.background = bg; t.dataset.bg = /^#/.test(bg) ? bg : rgbToHex(bg);
        const bh = t.dataset.bg; t.style.setProperty("--lh-accent-ink", inkFor(getComputedStyle(t).getPropertyValue("--lh-accent-ink").trim() || "#8f4507", bh));
        t.querySelectorAll(".lh-label, .lh-sub").forEach((e) => { e.style.color = inkFor("#3d3632", bh); });
        if (im && im.naturalWidth) { const H = Math.round(W * im.naturalHeight / im.naturalWidth); im.style.height = Math.min(H, Math.max(400, 1100 - t.offsetHeight)) + "px"; im.style.objectFit = "cover"; }
        continue;
      }
      if (im && im.naturalWidth) {
        const w0 = wrap._w || im.naturalWidth, sc = W / w0, H = Math.round(W * im.naturalHeight / im.naturalWidth);
        wrap.style.height = Math.min(1100, H) + "px"; // 히어로 ≤ 1100 (아래를 자름)
        const z = wrap._zone || { y0: 0, y1: im.naturalHeight * 0.26 };
        { const bh = t.dataset.bg; if (bh) { t.style.setProperty("--lh-accent-ink", inkFor(getComputedStyle(t).getPropertyValue("--lh-accent-ink").trim() || "#8f4507", bh)); t.querySelectorAll(".lh-label, .lh-sub").forEach((e) => { e.style.color = inkFor("#3d3632", bh); }); } }
        t.style.top = Math.round(z.y0 * sc + 24) + "px";
        const fl = wrap.querySelector(".lh-fill"); if (fl) Object.assign(fl.style, { top: Math.round(z.y0 * sc) + "px", height: Math.round((z.y1 - z.y0) * sc) + "px" });
        // 여백 안에 들어올 때까지 글자 축소(최소 65%)
        const lim = z.y1 * sc - 8, kids = [...t.children], base = kids.map((k) => parseFloat(getComputedStyle(k).fontSize));
        // 줄이는 하한: 제품명(헤드라인) 40 · 보조문 24 · 라벨/알약 22 — 그래도 넘치면 글자 상자를 위로 올린다
        const floor = (k) => (k.classList.contains("lh-name") ? 40 : k.classList.contains("lh-sub") ? 24 : 22);
        let f = 1; while (t.offsetTop + t.offsetHeight > lim && f > 0.65) { f -= 0.04; kids.forEach((k, i) => { k.style.fontSize = Math.max(floor(k), Math.round(base[i] * f)) + "px"; (k.classList.contains("lh-points") ? [...k.querySelectorAll("span")] : []).concat([]).forEach((sp) => { sp.style.fontSize = Math.max(22, Math.round(24 * f)) + "px"; }); }); }
        if (t.offsetTop + t.offsetHeight > lim) t.style.top = Math.max(12, lim - t.offsetHeight) + "px";
        // v11 대비: 예전엔 바탕을 밝은 베이지(#ece7e2)로 가정해 어두운 사진 위에 어두운 글자가 깔렸다(안경 세척기 hero 1.2:1)
        // → 글자 줄마다 실제 사진(격자) 밑 색으로 흰색/짙은 검정·그림자를 고르고, 강조색도 그 바탕에 맞춘다
        if (wrap._grid && !fl) {
          const hs = []; let mc = null;
          for (const k of t.querySelectorAll(".lh-label, .lh-name, .lh-sub")) {
            const r = rel(k, wrap), cells = cellsIn(wrap._grid, r.l / sc, r.t / sc, r.r / sc, r.b / sc); if (!cells.length) continue;
            const fz = parseFloat(getComputedStyle(k).fontSize), wt = Number(getComputedStyle(k).fontWeight) || 400, p = pickInk(rgbToHex(getComputedStyle(k).color), cells, fz >= 24 || (fz >= 19 && wt >= 700));
            if (p.changed) { k.style.color = p.color; k.dataset.ink = `${p.from}→${p.color} ${p.con}:1`; }
            if (p.shadow) k.style.textShadow = p.shadow;
            if (k.classList.contains("lh-name")) { mc = medianCell(cells); if (p.changed) k.style.setProperty("--em-color", inkFor(getComputedStyle(t).getPropertyValue("--lh-accent").trim() || "#f08a24", hx(mc))); }
            hs.push({ cls: k.className.split(" ")[0], con: p.con, changed: p.changed });
          }
          if (mc) t.dataset.bg = hx(mc);
          report.hero = hs;
        }
      }
    }
    report.levels = pageScale(root);
    // v13.2 쪽 단위 크기 맞춤(pageScale)으로 글이 줄면 가운데 맞춤 상자 안에서 글이 다시 가운데로 와 위아래 줄이 맞닿을 수 있다 → 한 번 더 겹침 정리
    for (const wrap of root.querySelectorAll(".loc-wrap")) { const im = wrap.querySelector("img"); if (!im || !im.naturalWidth) continue; const sc = W / (wrap._w || im.naturalWidth), fixed = (wrap._fixed || []).map((f) => ({ l: f.x * sc, t: f.y * sc, r: (f.x + f.w) * sc, b: (f.y + f.h) * sc })), us = unitsOf(wrap), st2 = resolveOverlaps(wrap, us, fixed); report.moved += st2.moved; report.shrunk += st2.shrunk; }
    Object.assign(report, layoutMetrics(root));
    if (typeof cardAfter === "function") await cardAfter(root, plan); // card 섹션(notice·spec·faq …)·테마 처리
    const pg = document.getElementById("page"); if (pg) pg.dataset.locReport = JSON.stringify(report);
  }

  window.TEMPLATE = Object.assign({}, T, { id: "localize", builders: Object.assign({}, T.builders, builders), after, defaultWidth: 780 });
})();
