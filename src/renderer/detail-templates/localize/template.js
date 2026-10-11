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
  const rgb = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(x || "").trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hx = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const con = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // 강조색: 레이어 색이 무채색(회색·검정)이면 페이지 포인트색(원본 배너 주황 등)을 쓴다
  function emColorOf(c0, under) {
    const c = rgb(c0); const sat = c ? Math.max(...c) - Math.min(...c) : 0;
    return inkFor(sat < 40 ? (window.__locAccent || "#f08a24") : c0, under);
  }
  function inkFor(color, under) {
    const c = rgb(color), u = rgb(under); if (!c || !u || con(c, u) >= 4.6) return color;
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
    Object.assign(box.style, {
      left: Math.round(l.x * sc) + "px", top: Math.round(l.y * sc) + "px", width: Math.round(l.w * sc) + "px", minHeight: Math.round(l.h * sc) + "px",
      fontSize: Math.round(fs) + "px", color: inkFor(st.color || "#222222", st.bg || st.under || st.fill), fontWeight: String(st.weight || (role === "title" ? 700 : 400)),
      textAlign: st.align || (role === "caption" || role === "title" || pill || role === "badge" ? "center" : "left"),
      justifyContent: (st.align || (role === "caption" || role === "title" || pill || role === "badge" ? "center" : "left")) === "center" ? "center" : (st.align === "right" ? "flex-end" : "flex-start"),
      background: st.bg || st.fill || "transparent", border: st.border || "0", borderRadius: pill ? "999px" : st.radius === "50%" ? "50%" : st.radius != null ? Math.round(Number(st.radius) * sc) + "px" : "0",
      letterSpacing: st.letter != null ? st.letter + "em" : "-0.02em", fontStyle: st.italic ? "italic" : "normal",
    });
    if (st.under || st.bg || st.fill) box.dataset.bg = st.under || st.bg || st.fill;
    if (Number(st.rotate)) { box.style.transform = `rotate(${Number(st.rotate)}deg)`; box.style.transformOrigin = "50% 50%"; } // 사선 글(원본 각도)
    const span = h("span.loc-text", null, lines(l.ko).map((t, k) => [k ? h("br") : null, U().noOrphan(t)]));
    if (fs < 14 && Array.isArray(l.emph)) l = { ...l, emph: l.emph.map((e) => (e.kind === "dot" ? { ...e, kind: "color" } : e)) }; // 작은 라벨: 점 → 색
    box.append(span);
    if (Array.isArray(l.emph) && l.emph.length) { // v7 강조: 색은 원본 포인트색(레이어 accent → 글자색) — 바탕 대비 보정
      box.style.setProperty("--em-color", emColorOf(st.accent || st.color || "#f0962e", st.bg || st.under || st.fill || "#ffffff"));
      U().emphasize(span, l.emph);
    }
    if (role === "title") span.style.fontFamily = "var(--display)";
    box._fs = fs;
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
      const used = new Set();
      for (let a = 0; a < ls.length; a++) {
        if (used.has(a)) continue;
        const block = [ls[a]]; used.add(a);
        for (let b = a + 1; b < ls.length; b++) {
          const p = block[block.length - 1], q = ls[b];
          if (used.has(b) || (q.role || "text") !== (p.role || "text") || q.style.rotate || p.style.radius) continue;
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
      const rw = ls.filter((l) => l.rewrite_ok), blocks = [], inBlock = new Set();
      const sz = (l) => Number(l.style?.size) || l.h * 0.78;
      for (const l of rw) {
        if (inBlock.has(l)) continue;
        const cl = [l];
        for (const q of rw) {
          if (q === l || inBlock.has(q) || cl.includes(q)) continue;
          const p = cl[cl.length - 1];
          const gap = q.y - (p.y + p.h), ov = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
          if (gap >= -4 && gap < Math.max(p.h, q.h) * 1.2 && ov > Math.min(p.w, q.w) * 0.3 && sz(q) >= sz(cl[0]) * 0.5) cl.push(q);
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
          const m = med(g.map(sz)); const grp = g.filter((l) => sz(l) >= m * 0.6 && sz(l) <= m * 1.4);
          if (grp.length < 3) continue;
          const size = med(grp.map(sz)), weight = med(grp.map((l) => Number(l.style?.weight) || 400));
          const cnt = {}; grp.forEach((l) => { const c = l.style?.color; if (c) cnt[c] = (cnt[c] || 0) + 1; }); const color = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
          const gid = Math.random().toString(36).slice(2, 8);
          for (const l of grp) { l.style = { ...l.style, size, weight, ...(color ? { color } : {}) }; l._grp = gid; }
        }
      }
      wrap._blocks = blocks;
      wrap._w = Number(s.w || s.iw) || 0; wrap._n = n; // A3 형식은 iw/ih
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
      const fill = has(s.fill) ? h("div.lh-fill") : null;
      if (fill) fill.style.background = s.fill;
      const wrap = h("div.lh-wrap", { "data-clip": "1" }, has(s.image) ? h("img.lh-img", { src: srcUrl(s.image, base), alt: "", decoding: "async", "data-src": String(s.image), "data-layer": "#hero.image" }) : null, fill, text);
      wrap._zone = s.text_zone || null; // { y0, y1 } 원본 px — 글자를 놓을 여백(없으면 위 26%)
      wrap._w = Number(s.w || s.iw) || 0;
      wrap._band = !!s.band;
      return wrap;
    },
  };

  // 글자 맞춤: 한 줄 상자 폭을 넘으면 글자를 줄이고(최소 70%), 그래도 넘치면 줄바꿈 허용(상자 높이는 늘어남)
  function fitLayer(box) {
    const span = box.querySelector(".loc-text"); if (!span) return;
    const base = box._fs; let f = base;
    box.style.whiteSpace = "nowrap";
    while (span.scrollWidth > box.clientWidth - 2 && f > base * 0.7) { f -= Math.max(0.5, base * 0.03); box.style.fontSize = f.toFixed(1) + "px"; }
    if (span.scrollWidth > box.clientWidth - 2 && box.querySelectorAll("br").length === 0) { // 짧은 한 줄 라벨: 조금만 넓히고(최대 1.15배 — 옆 라벨과 겹치지 않게), 그래도 넘치면 단어 단위 줄바꿈
      const w0 = box.clientWidth, need = Math.min(w0 * 1.15, span.scrollWidth + 8), jc = box.style.justifyContent;
      if (need > w0) { const dx = jc === "center" ? (need - w0) / 2 : jc === "flex-end" ? need - w0 : 0; box.style.left = (parseFloat(box.style.left) - dx) + "px"; box.style.width = need + "px"; }
    }
    if (span.scrollWidth > box.clientWidth - 2) { box.style.whiteSpace = "normal"; box.style.wordBreak = "keep-all"; }
    box.dataset.fit = (f / base).toFixed(2);
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
    blk.append(t); if (em.length) U().emphasize(t, em);
    for (const r of rest) {
      const p = h("div.lb-sub", null, lines(r.ko).map((x, i) => [i ? h("br") : null, U().noOrphan(x)]));
      p.style.fontSize = Math.round(Math.max(22, (r.style?.size || r.h * 0.78) * sc * 0.92)) + "px";
      if (r.style?.color) p.style.color = inkFor(r.style.color, r.style.under || under);
      if (Array.isArray(r.emph)) U().emphasize(p, r.emph);
      blk.append(p);
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
    keepInside(blk, wrap);
  }
  const rgbToHex = (c) => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || ""); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("") : "#efebe5"; };
  const cardAfter = T.after;
  async function after(root, plan) {
    const W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--w")) || 780;
    for (const wrap of root.querySelectorAll(".loc-wrap")) {
      const im = wrap.querySelector("img"); if (!im || !im.naturalWidth) continue;
      const w0 = wrap._w || im.naturalWidth, sc = W / w0;
      wrap.style.height = Math.round(W * im.naturalHeight / im.naturalWidth) + "px";
      const els = (wrap._layers || []).map((l, i) => { const el = layerEl(l, i, sc, `image.${wrap._n}`); el._grp = l._grp; wrap.append(el); fitLayer(el); return el; });
      // 묶음은 글자 맞춤 뒤 가장 작아진 크기로 다 같이(한 묶음 안에서 크기가 달라 보이지 않게)
      const groups = {}; els.forEach((el) => { if (el._grp) (groups[el._grp] ||= []).push(el); });
      for (const g of Object.values(groups)) { const f = Math.min(...g.map((el) => parseFloat(el.style.fontSize))); g.forEach((el) => { el.style.fontSize = f.toFixed(1) + "px"; }); }
      els.forEach((el) => keepInside(el, wrap));
      (wrap._blocks || []).forEach((ls, k) => typeBlock(ls, k, sc, wrap));
    }
    for (const wrap of root.querySelectorAll(".lh-wrap")) {
      const im = wrap.querySelector("img"); const t = wrap.querySelector(".lh-text");
      if (wrap._band) { // 상단 여백이 있는 사진이 없을 때: 글자는 사진 위쪽 단색 띠에(사진과 겹치지 않음)
        wrap.classList.add("band"); wrap.prepend(t);
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
      }
    }
    if (typeof cardAfter === "function") await cardAfter(root, plan); // card 섹션(notice·spec·faq …)·테마 처리
  }

  window.TEMPLATE = Object.assign({}, T, { id: "localize", builders: Object.assign({}, T.builders, builders), after, defaultWidth: 780 });
})();
