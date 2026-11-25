// 씨드핵 상세페이지 템플릿 — 공통 렌더 로직 (clean / dark / pop 세 템플릿이 같이 쓴다)
// PagePlan(CONTRACTS 7절).sections → <section data-sec="hero"> … DOM을 그리고, 이미지가 전부 decode 되면 body.dataset.ready="1"
// file:// 로 열리므로 module 이 아닌 일반 script 로 둔다(크롬은 file:// 에서 module 을 막는다)
(function () {
  "use strict";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const text = (v) => (v == null ? "" : String(v)).trim();
  const has = (v) => text(v).length > 0;
  // 템플릿별 옵션(template.js 가 window.TEMPLATE 로 둔다) — 없으면 기본값
  const opt = () => Object.assign({
    id: "clean",
    num: (i) => String(i + 1).padStart(2, "0"),      // usp 번호 표기
    labels: { gallery: "더 자세히 보기", spec: "제품 정보", size: "사이즈 안내", package: "구성품", notice: "배송 · 교환 · 주의사항", faq: "자주 묻는 질문",
      benefits: "이렇게 다릅니다", proof: "숫자로 보는 차이", compare: "일반 제품과 비교하면", steps: "사용은 이렇게", objections: "이런 점이 걱정되시나요?", trust: "믿고 고르셔도 됩니다" },
    heroImageFirst: false,                             // hero 에서 사진을 글 위에 둘지
    noEmoji: false,                                    // true 면 이모지 대신 라인 아이콘(없으면 번호)
    usePalette: false,                                 // true 면 plan.meta.palette 로 색을 맞춘다(스튜디오)
  }, window.TEMPLATE || {}, { labels: Object.assign({ gallery: "더 자세히 보기", spec: "제품 정보", size: "사이즈 안내", package: "구성품", notice: "배송 · 교환 · 주의사항", faq: "자주 묻는 질문",
    benefits: "이렇게 다릅니다", proof: "숫자로 보는 차이", compare: "일반 제품과 비교하면", steps: "사용은 이렇게", objections: "이런 점이 걱정되시나요?", trust: "믿고 고르셔도 됩니다" }, (window.TEMPLATE || {}).labels || {}) }); // 템플릿이 일부 라벨만 줘도 나머지는 기본값

  // 작은 DOM 도우미: h("div.card", { cls }, ...children)
  function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name || "div");
    if (classes.length) el.className = classes.join(" ");
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("data-")) el.dataset[k.slice(5)] = v;
      else el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return el;
  }

  // 이미지 상자: jobDir 상대경로 → baseUrl + 경로. 원본보다 1.5배 넘게 키우지 않도록 decode 뒤에 maxWidth/maxHeight 를 건다
  // 이미지 주소: jobDir 상대경로는 baseUrl 기준, 절대경로(/… · C:\…)·file:// 는 그대로 파일 주소로(레퍼런스 폴더를 직접 가리키는 샘플용)
  function srcUrl(src, base) {
    const t = text(src);
    if (/^(file|data|https?):/i.test(t)) return t;
    if (/^\//.test(t) || /^[a-z]:[\\/]/i.test(t)) return "file://" + (t.startsWith("/") ? "" : "/") + encodeURI(t.replace(/\\/g, "/")).replace(/#/g, "%23").replace(/\?/g, "%3F");
    return base + t.replace(/^\.?\//, "");
  }
  function pic(src, base, cls, layer) {
    if (!has(src)) return null;
    const img = h("img", { src: srcUrl(src, base), alt: "", decoding: "async", "data-src": text(src), "data-layer": layer || null });
    return h("div.pic" + (cls ? "." + cls : ""), null, img);
  }
  // 사진 위 중국어가 있던 자리(overlay) → 반투명 띠에 한글. 좌표는 원본 픽셀 기준이라 표시 배율로 환산한다
  function placeOverlays(wrap, overlays) {
    const img = $("img", wrap);
    if (!img || !img.naturalWidth) return;
    const r = img.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const s = r.width / img.naturalWidth, ox = r.left - wr.left, oy = r.top - wr.top;
    overlays.forEach((o, i) => {
      if (!has(o.text)) return;
      const band = h("div.ov", { text: text(o.text), "data-layer": wrap.dataset.layer ? `${wrap.dataset.layer}.overlay.${i + 1}` : null });
      const w = Math.max(160, Math.min(r.width, (o.w || 300) * s + 24));
      let x = ox + (o.x || 0) * s - 12; x = Math.max(ox, Math.min(x, ox + r.width - w));
      band.style.left = x + "px"; band.style.top = Math.max(oy, oy + (o.y || 0) * s - 8) + "px"; band.style.width = w + "px";
      band.style.minHeight = Math.max(44, (o.h || 40) * s + 16) + "px";
      wrap.append(band);
      // 띠가 사진 아래로 삐져나오면 안쪽으로 올린다
      const br = band.getBoundingClientRect();
      if (br.bottom > r.bottom) band.style.top = Math.max(oy, oy + r.height - br.height) + "px";
    });
  }

  // 사진 가장자리 20px 평균색: canvas 로 재고(file:// 는 보안 때문에 막힐 수 있음) 안 되면 main 이 nativeImage 로 재서 넘긴 window.__edgeColors 를 쓴다
  function edgeColor(img) {
    try {
      const w = img.naturalWidth, h = img.naturalHeight, b = Math.max(1, Math.min(20, Math.floor(Math.min(w, h) / 4)));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      let r = 0, g = 0, bl = 0, n = 0;
      const add = (x, y, cw, ch) => { const d = ctx.getImageData(x, y, cw, ch).data; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; } };
      add(0, 0, w, b); add(0, h - b, w, b); add(0, b, b, Math.max(0, h - 2 * b)); add(w - b, b, b, Math.max(0, h - 2 * b));
      if (n) return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(bl / n)})`;
    } catch {}
    return (window.__edgeColors || {})[img.dataset.src] || null;
  }
  // 사진 상자를 사진 비율에 맞춘다(최대 폭·높이 안에서, 원본 1.5배 상한) → 좌우 흰 띠(letterbox)가 생기지 않는다. 상자 배경은 가장자리색
  function fitPic(wrap, maxW, maxH) {
    const img = wrap && wrap.querySelector("img");
    if (!img || !img.naturalWidth || wrap.classList.contains("stage")) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    let w = Math.min(maxW, maxH * ratio, img.naturalWidth * 1.5), h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    wrap.style.width = Math.round(w) + "px"; wrap.style.height = Math.round(h) + "px";
    img.style.width = "100%"; img.style.height = "100%"; img.style.maxWidth = "none"; img.style.maxHeight = "none"; img.style.objectFit = "cover";
    const bg = wrap.dataset.edge || (wrap.dataset.edge = edgeColor(img) || "");
    if (bg) wrap.style.background = bg;
  }
  // ----- 팔레트(plan.meta.palette, A2 가 제품 사진에서 추출) → CSS 변수. 글자 대비는 4.5:1 이상이 되도록 자동 보정 -----
  const hex2rgb = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(x || "").trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgb2hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
  const WHITE = [255, 255, 255], BLACK = [16, 18, 22];
  // 글자색으로 쓸 수 있게 흰 배경 대비 ≥ 4.5 가 될 때까지 어둡게
  const asInk = (c, bg = WHITE, min = 4.5) => { let out = c, t = 0; while (contrast(out, bg) < min && t < 1) { t += 0.05; out = mix(c, BLACK, t); } return out; };
  const asDeep = (c, min = 7) => { let out = mix(c, BLACK, 0.55), t = 0.55; while (contrast(WHITE, out) < min && t < 1) { t += 0.05; out = mix(c, BLACK, t); } return out; };
  function applyPalette(pal) {
    const st = document.documentElement.style;
    const dom = hex2rgb(pal && pal.dominant && pal.dominant[0]) || hex2rgb(pal && pal.accent) || hex2rgb("#5a6b80");
    const acc = hex2rgb(pal && pal.accent) || dom;
    const accInk = asInk(acc), deep = asDeep(dom);
    st.setProperty("--p-dom", rgb2hex(dom));
    st.setProperty("--p-accent", rgb2hex(accInk));                  // 글자·선용(흰 바탕 4.5:1 이상)
    st.setProperty("--p-accent-fill", rgb2hex(acc));                // 면용(위에 올라가는 글자색은 --p-on-accent)
    st.setProperty("--p-on-accent", contrast(WHITE, acc) >= 4.5 ? "#ffffff" : rgb2hex(BLACK));
    st.setProperty("--p-tint", rgb2hex(mix(dom, WHITE, 0.90)));     // 섹션 교대 배경(연한 톤)
    st.setProperty("--p-tint2", rgb2hex(mix(dom, WHITE, 0.78)));
    st.setProperty("--p-deep", rgb2hex(deep));                      // 짙은 배경(흰 글자 7:1 이상)
    st.setProperty("--p-deep2", rgb2hex(mix(deep, BLACK, 0.35)));
    st.setProperty("--p-line", rgb2hex(mix(dom, WHITE, 0.7)));
    // 제품이 어두우면(금속·검정) 밝은 무대, 밝은 제품이면 짙은 무대
    const productDark = pal && typeof pal.dark === "boolean" ? pal.dark : lum(dom) < 0.25;
    document.body.dataset.productDark = productDark ? "1" : "0";
    document.body.dataset.stage = productDark ? "light" : "dark";
  }
  // 누끼(cutout) 가 있으면 스튜디오 무대(팔레트 그라데이션 + 소재 질감 + 부드러운 그림자) 위에 올리고, 없으면 사진을 둥근 카드로
  function media(sec, base, cls, layer) {
    if (has(sec.cutout)) {
      const img = h("img.cut", { src: srcUrl(sec.cutout, base), alt: "", decoding: "async", "data-src": text(sec.cutout), "data-layer": layer ? layer.replace(/\.image$/, ".cutout") : null });
      return h("div.stage" + (cls ? "." + cls : ""), { "data-layer": layer || null, "data-src": has(sec.image) ? text(sec.image) : null }, h("div.stage-tex"), h("div.stage-shadow"), img);
    }
    return pic(sec.image, base, cls, layer);
  }
  // 아이콘 칸: icon 키가 라인 아이콘이면 SVG, 이모지면(noEmoji 아닐 때) 그대로, 아니면 번호
  function iconSlot(icon, i, cls) {
    const I = window.SeedhackIcons;
    if (I && I.has(icon)) return h("div.ic" + (cls ? "." + cls : ""), null, I.svg(icon));
    if (has(icon) && !opt().noEmoji && !/^[a-z_-]+$/i.test(text(icon))) return h("div.ic.emoji" + (cls ? "." + cls : ""), { text: text(icon) });
    return h("div.ic.num" + (cls ? "." + cls : ""), { text: String(i + 1).padStart(2, "0") });
  }
  // 치수선(SVG): 누끼/사진 상자 안 이미지 위치에 맞춰 가로·세로 선과 숫자를 그린다. dims = { w, h, d } 또는 { open, folded }
  function drawDims(wrap, dims) {
    const img = $("img", wrap); if (!img) return;
    const wr = wrap.getBoundingClientRect(), r = img.getBoundingClientRect();
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "dims"); svg.setAttribute("width", Math.round(wr.width)); svg.setAttribute("height", Math.round(wr.height));
    const el = (n, a, t) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (t != null) e.textContent = t; svg.append(e); return e; };
    const x0 = r.left - wr.left, y0 = r.top - wr.top, w = r.width, hh = r.height;
    const line = (x1, y1, x2, y2) => el("line", { x1, y1, x2, y2, class: "dl" });
    const label = (x, y, t, anchor) => { const g = el("text", { x, y, class: "dt", "text-anchor": anchor || "middle" }, t); return g; };
    const vals = [];
    if (has(dims.w)) { const y = Math.min(wr.height - 30, y0 + hh + 28); line(x0, y, x0 + w, y); line(x0, y - 10, x0, y + 10); line(x0 + w, y - 10, x0 + w, y + 10); label(x0 + w / 2, y + 34, text(dims.w)); vals.push(["w", dims.w]); }
    let hLabel = null, hx = 0;
    if (has(dims.h)) { const x = Math.min(wr.width - 24, x0 + w + 28); hx = x; line(x, y0, x, y0 + hh); line(x - 10, y0, x + 10, y0); line(x - 10, y0 + hh, x + 10, y0 + hh); hLabel = label(x + 18, y0 + hh / 2 + 8, text(dims.h), "start"); vals.push(["h", dims.h]); }
    const chips = []; if (has(dims.d)) chips.push("깊이 " + text(dims.d)); if (has(dims.open)) chips.push("펼침 " + text(dims.open)); if (has(dims.folded)) chips.push("접힘 " + text(dims.folded));
    wrap.append(svg);
    if (hLabel) { try { if (hx + 14 + hLabel.getComputedTextLength() > wr.width - 8) { hLabel.setAttribute("x", hx - 14); hLabel.setAttribute("text-anchor", "end"); } } catch {} } // 오른쪽에 자리가 없으면 선 왼쪽에
    if (chips.length) wrap.append(h("div.dim-chips", null, chips.map((c, i) => h("span.dim-chip", { text: c, "data-layer": `#size.dims.${i + 1}` }))));
    for (const [k, v] of vals) wrap.append(h("span.sr", { text: text(v), "data-layer": `#size.dims.${k}`, style: "position:absolute;left:-9999px" }));
  }
  // ----- v7 강조: emph [{ text, kind: color|bold|underline|dot|pill|slant|grad }] → 글자 안에서 그 구절을 찾아 span 으로 감싼다 -----
  const EM_KINDS = new Set(["color", "bold", "underline", "dot", "pill", "slant", "grad", "line"]);
  function emphasize(el, emph) {
    const list = (Array.isArray(emph) ? emph : []).filter((e) => e && String(e.text || "").trim()).map((e) => ({ text: String(e.text).trim(), kind: EM_KINDS.has(e.kind) ? e.kind : "color" }));
    if (!el || !list.length) return 0;
    let hit = 0;
    for (const e of list) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node, done = false;
      while (!done && (node = walker.nextNode())) {
        if (node.parentElement.closest(".em")) continue;
        const at = node.textContent.indexOf(e.text); if (at < 0) continue;
        const after = node.splitText(at); after.splitText(e.text.length);
        const span = document.createElement("span"); span.className = `em em-${e.kind}`;
        if (e.kind === "dot") { for (const ch of e.text) { const c = document.createElement("span"); c.className = ch.trim() ? "em-dot" : ""; c.textContent = ch; span.append(c); } span.className = "em em-dots"; }
        else span.textContent = e.text;
        after.replaceWith(span);
        if (e.kind === "bold") el.classList.add("has-em-bold");
        if (e.kind === "dot") el.classList.add("has-em-dot");
        hit++; done = true;
      }
    }
    return hit;
  }
  // 외톨이 줄 방지: 3어절 이상이면 마지막 띄어쓰기를 붙는 공백(nbsp)으로 → 마지막 줄이 한 어절만 남지 않는다
  const noOrphan = (t) => { t = String(t == null ? "" : t); const parts = t.split(" "); return parts.length >= 3 && parts[parts.length - 1].length <= 6 ? parts.slice(0, -1).join(" ") + "\u00a0" + parts[parts.length - 1] : t; };
  function fixOrphans(root) {
    for (const el of root.querySelectorAll("h1, h2, h3, p, .card-title, .card-desc, .lb-title, .lb-sub, .loc-text")) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let last = null, n; while ((n = walker.nextNode())) if (n.textContent.trim()) last = n;
      if (last && !last.parentElement.closest(".em")) last.textContent = noOrphan(last.textContent);
    }
  }
  // 작은 글자(14px 미만)의 점 강조는 지저분하므로 색 강조로 바꾼다
  function dotToColor(root) {
    for (const d of root.querySelectorAll(".em-dots")) if (parseFloat(getComputedStyle(d).fontSize) < 14) { d.className = "em em-color"; d.textContent = d.textContent; }
  }
  // 섹션·항목에 달린 emph 를 그 섹션의 제목류 글자에 적용(카드·기존 템플릿 공통). 이미 강조된 곳은 건너뛴다
  function applySectionEmph(secEl, s) {
    const all = [...(Array.isArray(s.emph) ? s.emph : []), ...(Array.isArray(s.items) ? s.items.flatMap((it) => (it && Array.isArray(it.emph) ? it.emph : [])) : [])];
    if (!all.length) return;
    const targets = secEl.querySelectorAll("h1, h2, h3, .sub, .hero-sub, .ba-sub, .card-desc, p, .lh-sub, .cl-bold");
    for (const e of all) for (const t of targets) if (emphasize(t, [e])) break;
  }
  const L = (k) => opt().labels[k] || "";
  const nonEmpty = (arr, f) => (Array.isArray(arr) ? arr : []).filter(f);

  // ----- 섹션 빌더: 돌려주는 값이 null 이면 그 섹션은 그리지 않는다 -----
  const build = {
    hero(s, base) {
      const badges = nonEmpty(s.badges, has).slice(0, 3);
      if (!has(s.headline) && !has(s.image)) return null;
      const top = h("div.hero-top", null,
        has(s.eyebrow) ? h("div.eyebrow", { text: text(s.eyebrow) }) : null,
        has(s.headline) ? h("h1.headline", { text: text(s.headline), "data-layer": "#hero.headline" }) : null,
        has(s.sub) ? h("p.sub", { text: text(s.sub), "data-layer": "#hero.sub" }) : null,
        badges.length ? h("ul.badges", null, badges.map((b, i) => h("li.badge", { text: text(b), "data-layer": `#hero.badge.${i + 1}` }))) : null);
      const p = media(s, base, "hero-pic", "#hero.image");
      return opt().heroImageFirst ? [p, top] : [top, p];
    },
    pain(s, base) {
      const items = nonEmpty(s.items, (it) => it && has(it.text)).slice(0, 6);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || "이런 적 있으시죠?", "data-layer": "#pain.title" }),
        h("div.cards", null, items.map((it, i) => h("div.card.pain-card", null,
          iconSlot(it.icon, i, "icon"),
          h("p", { text: text(it.text), "data-layer": `#pain.${i + 1}.text` }))))];
    },
    usp(s, base) {
      const items = nonEmpty(s.items, (it) => it && (has(it.title) || has(it.desc))).slice(0, 6);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || "그래서 이렇게 만들었습니다", "data-layer": "#usp.title" }),
        items.map((it, i) => {
          const p = media(it, base, "usp-pic", `#usp.${i + 1}.image`);
          return h("div.usp-item" + (p ? ".with-pic" : "") + (i % 2 ? ".alt" : ""), null,
            h("div.usp-body", null,
              h("div.num", { text: opt().num(i) }),
              has(it.title) ? h("h3", { text: text(it.title), "data-layer": `#usp.${i + 1}.title` }) : null,
              has(it.desc) ? h("p", { text: text(it.desc), "data-layer": `#usp.${i + 1}.desc` }) : null),
            p);
        })];
    },
    feature(s, base, n) {
      if (!has(s.image) && !has(s.title) && !has(s.desc)) return null;
      const p = pic(s.image, base, "feature-pic", `#feature.${n}.image`);
      if (p) { p.dataset.layer = `#feature.${n}`; p.classList.add("overlayed"); p._overlays = nonEmpty(s.overlay, (o) => o && has(o.text)); }
      const cap = (has(s.title) || has(s.desc)) ? h("div.cap-box", null,
        has(s.title) ? h("h3", { text: text(s.title), "data-layer": `#feature.${n}.title` }) : null,
        has(s.desc) ? h("p.cap", { text: text(s.desc), "data-layer": `#feature.${n}.desc` }) : null) : null;
      return [p, cap];
    },
    gallery(s, base) {
      const imgs = nonEmpty(s.images, has).slice(0, 12);
      if (!imgs.length) return null;
      return [h("h2.sec-title", { text: L("gallery") }), h("div.grid2", null, imgs.map((src, i) => pic(src, base, "gal-pic", `#gallery.${i + 1}.image`)))];
    },
    spec(s, base) {
      const rows = nonEmpty(s.rows, (r) => r && has(r.k) && has(r.v)).slice(0, 40);
      if (!rows.length) return null;
      return [h("h2.sec-title", { text: L("spec") }),
        pic(s.image, base, "spec-pic", "#spec.image"),
        h("table.spec", null, h("tbody", null, rows.map((r, i) => h("tr", null,
          h("th", { text: text(r.k), "data-layer": `#spec.${i + 1}.k` }), h("td", { text: text(r.v), "data-layer": `#spec.${i + 1}.v` })))))];
    },
    size(s, base) {
      const dims = s.dims && typeof s.dims === "object" ? s.dims : null;
      if (!has(s.image) && !has(s.cutout) && !has(s.note) && !dims) return null;
      const m = media(s, base, "size-pic", "#size.image");
      if (m && dims) { m.classList.add("with-dims"); m._dims = dims; }
      return [h("h2.sec-title", { text: L("size") }), m,
        has(s.note) ? h("p.note", { text: text(s.note), "data-layer": "#size.note" }) : null];
    },
    package(s, base) {
      const items = nonEmpty(s.items, has).slice(0, 12);
      if (!items.length && !has(s.image)) return null;
      return [h("h2.sec-title", { text: L("package") }), pic(s.image, base, "pkg-pic", "#package.image"),
        items.length ? h("ul.chips", null, items.map((t, i) => h("li.chip", { text: text(t), "data-layer": `#package.${i + 1}` }))) : null];
    },
    notice(s) {
      const items = nonEmpty(s.items, has).slice(0, 12);
      if (!items.length) return null;
      const tag = (t) => /배송|출고|도착|택배|발송/.test(t) ? "배송" : /교환|반품|불량|A\/?S|보증|환불/i.test(t) ? "AS" : "주의";
      return [h("h2.sec-title", { text: L("notice") }),
        h("ul.checks", null, items.map((t, i) => h("li", null, h("span.chk", { text: "✓" }), h("span.tag", { text: tag(t) }), h("span.txt", { text: text(t), "data-layer": `#notice.${i + 1}` }))))];
    },
    faq(s) {
      const items = nonEmpty(s.items, (it) => it && has(it.q) && has(it.a)).slice(0, 8);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: L("faq") }),
        items.map((it, i) => h("div.faq-card", null,
          h("div.q", null, h("span.qa", { text: "Q" }), h("span", { text: text(it.q), "data-layer": `#faq.${i + 1}.q` })),
          h("div.a", null, h("span.qa", { text: "A" }), h("span", { text: text(it.a), "data-layer": `#faq.${i + 1}.a` }))))];
    },
    cta(s, base) {
      if (!has(s.headline) && !has(s.sub)) return null;
      return [media(s, base, "cta-pic", "#cta.image"),
        has(s.headline) ? h("h2.cta-head", { text: text(s.headline), "data-layer": "#cta.headline" }) : null,
        has(s.sub) ? h("p.sub", { text: text(s.sub), "data-layer": "#cta.sub" }) : null];
    },
    // ----- v2 섹션(스튜디오 구조: problem → agitate → solution → benefits → proof → compare → steps → objections → trust) -----
    problem(s, base) {
      const items = nonEmpty(s.items, (it) => it && has(it.text)).slice(0, 4);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || "이런 적 있으시죠?", "data-layer": "#problem.title" }),
        h("div.problem-list", null, items.map((it, i) => h("div.problem-item", null, iconSlot(it.icon, i), h("p", { text: text(it.text), "data-layer": `#problem.${i + 1}.text` }))))];
    },
    agitate(s) {
      const lines = nonEmpty(Array.isArray(s.lines) ? s.lines : [s.headline, s.sub], has).slice(0, 3);
      if (!lines.length) return null;
      return h("div.agitate-box", null, lines.map((t, i) => h(i === 0 ? "h2.agitate-main" : "p.agitate-sub", { text: text(t), "data-layer": `#agitate.${i + 1}` })));
    },
    solution(s, base) {
      if (!has(s.headline) && !has(s.image) && !has(s.cutout)) return null;
      return [has(s.eyebrow) ? h("div.eyebrow", { text: text(s.eyebrow) }) : null,
        has(s.headline) ? h("h2.solution-head", { text: text(s.headline), "data-layer": "#solution.headline" }) : null,
        has(s.sub) ? h("p.solution-sub", { text: text(s.sub), "data-layer": "#solution.sub" }) : null,
        media(s, base, "solution-pic", "#solution.image")];
    },
    benefits(s, base) {
      const items = nonEmpty(s.items, (it) => it && (has(it.title) || has(it.desc))).slice(0, 6);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || L("benefits"), "data-layer": "#benefits.title" }),
        items.map((it, i) => {
          const m = media(it, base, "benefit-pic", `#benefits.${i + 1}.image`);
          return h("div.benefit" + (m ? ".with-pic" : "") + (i % 2 ? ".alt" : ""), null,
            h("div.benefit-body", null,
              has(it.icon) && window.SeedhackIcons && window.SeedhackIcons.has(it.icon) ? h("div.ic", null, window.SeedhackIcons.svg(it.icon)) : null,
              has(it.title) ? h("h3", { text: text(it.title), "data-layer": `#benefits.${i + 1}.title` }) : null,
              has(it.desc) ? h("p", { text: text(it.desc), "data-layer": `#benefits.${i + 1}.desc` }) : null),
            m);
        })];
    },
    proof(s) {
      const items = nonEmpty(s.items, (it) => it && has(it.value)).slice(0, 4);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || L("proof"), "data-layer": "#proof.title" }),
        h("div.proof-grid", null, items.map((it, i) => h("div.proof-item", null,
          h("div.proof-num", null, h("span.val", { text: text(it.value), "data-layer": `#proof.${i + 1}.value` }), has(it.unit) ? h("span.unit", { text: text(it.unit), "data-layer": `#proof.${i + 1}.unit` }) : null),
          has(it.label) ? h("div.proof-label", { text: text(it.label), "data-layer": `#proof.${i + 1}.label` }) : null,
          has(it.desc) ? h("p.proof-desc.cap", { text: text(it.desc), "data-layer": `#proof.${i + 1}.desc` }) : null)))];
    },
    compare(s) {
      const rows = nonEmpty(s.rows, (r) => r && has(r.k)).slice(0, 10);
      if (!rows.length) return null;
      const lab = Object.assign({ a: "일반 제품", b: "이 제품" }, s.labels || {});
      const cell = (v, good, layer) => {
        const t = text(v), yes = v === true || /^(o|○|◯|yes|가능|있음)$/i.test(t), no = v === false || /^(x|✕|×|no|불가|없음)$/i.test(t);
        if (yes || no) return h("td" + (yes ? ".yes" : ".no") + (good ? ".good" : ""), null, h("span.mark", { text: yes ? "○" : "✕" }), h("span.sr", { text: yes ? "가능" : "불가", "data-layer": layer, style: "position:absolute;left:-9999px" }));
        return h("td" + (good ? ".good" : ""), { text: t, "data-layer": layer });
      };
      return [h("h2.sec-title", { text: text(s.title) || L("compare"), "data-layer": "#compare.title" }),
        h("table.compare", null,
          h("thead", null, h("tr", null, h("th"), h("th", { text: lab.a }), h("th.good", { text: lab.b }))),
          h("tbody", null, rows.map((r, i) => h("tr", null, h("th", { text: text(r.k), "data-layer": `#compare.${i + 1}.k` }), cell(r.a, false, `#compare.${i + 1}.a`), cell(r.b, true, `#compare.${i + 1}.b`)))))];
    },
    steps(s, base) {
      const items = nonEmpty(s.items, (it) => it && (has(it.title) || has(it.desc))).slice(0, 4);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || L("steps"), "data-layer": "#steps.title" }),
        h("div.steps-row", { "data-count": items.length }, items.map((it, i) => h("div.step", null,
          media(it, base, "step-pic", `#steps.${i + 1}.image`),
          h("div.step-num", { text: String(i + 1) }),
          has(it.title) ? h("h3", { text: text(it.title), "data-layer": `#steps.${i + 1}.title` }) : null,
          has(it.desc) ? h("p.cap", { text: text(it.desc), "data-layer": `#steps.${i + 1}.desc` }) : null)))];
    },
    objections(s) {
      const items = nonEmpty(s.items, (it) => it && has(it.q) && has(it.a)).slice(0, 6);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || L("objections"), "data-layer": "#objections.title" }),
        items.map((it, i) => h("div.objection", null,
          h("div.ob-q", null, h("span.ob-tag", { text: "걱정" }), h("p", { text: text(it.q), "data-layer": `#objections.${i + 1}.q` })),
          h("div.ob-a", null, h("span.ob-tag.ok", { text: "해소" }), h("p", { text: text(it.a), "data-layer": `#objections.${i + 1}.a` }))))];
    },
    trust(s) {
      const items = nonEmpty(s.items, (it) => it && has(it.title)).slice(0, 6);
      if (!items.length) return null;
      return [h("h2.sec-title", { text: text(s.title) || L("trust"), "data-layer": "#trust.title" }),
        h("div.trust-grid", null, items.map((it, i) => h("div.trust-item", null, iconSlot(it.icon, i),
          h("h3", { text: text(it.title), "data-layer": `#trust.${i + 1}.title` }),
          has(it.desc) ? h("p.cap", { text: text(it.desc), "data-layer": `#trust.${i + 1}.desc` }) : null)))];
    },
  };

  // 이미지 decode 를 전부 기다린다(깨진 이미지는 상자째 지운다)
  async function waitImages(root) {
    const imgs = [...root.querySelectorAll("img")];
    await Promise.all(imgs.map(async (img) => {
      try { if (!img.complete) await new Promise((res, rej) => { img.onload = res; img.onerror = rej; }); await img.decode(); }
      catch { img.closest(".pic")?.remove(); }
    }));
    // 1.5배 상한: 원본이 작으면 카드 안에서 작게(가운데) 보이고 여백이 남는다
    for (const img of root.querySelectorAll(".pic img")) {
      if (!img.naturalWidth) continue;
      // CSS 변수로 상한만 알려 준다(base.css 가 max-width: min(100%, var(--cap-w)) 식으로 쓴다 → 스타일시트의 다른 상한을 깨지 않음)
      img.style.setProperty("--cap-w", Math.round(img.naturalWidth * 1.5) + "px");
      img.style.setProperty("--cap-h", Math.round(img.naturalHeight * 1.5) + "px");
    }
    try { await document.fonts.ready; } catch {}
  }

  async function render(plan, baseUrl) {
    window.__plan = plan; // 자체 점검(그려지지 않은 이미지 찾기)용
    const base = (baseUrl || "").replace(/\/?$/, "/");
    document.body.dataset.ready = "";
    const root = $("#page") || document.body.appendChild(h("main#page"));
    root.innerHTML = "";
    if (plan?.product?.name_ko) document.title = plan.product.name_ko;
    // 폭: 780(쿠팡) 기본, 860(네이버·자사몰) 옵션 — meta.width
    const W = [780, 860].includes(Number(plan?.meta?.width)) ? Number(plan.meta.width) : (opt().defaultWidth || 780); // 카드 템플릿은 860 기본
    document.documentElement.style.setProperty("--w", W + "px");
    document.body.dataset.width = String(W);
    const B = Object.assign({}, build, opt().builders || {}); // 템플릿이 섹션 builder 를 더하거나 바꿀 수 있다(editorial)
    if (opt().usePalette) applyPalette(plan && plan.meta && plan.meta.palette);
    else document.body.dataset.stage = "dark"; // 팔레트를 안 쓰는 템플릿: 누끼 무대는 기본 짙은 톤(치수선 흰색)
    const count = {};
    for (const s of (plan && Array.isArray(plan.sections) ? plan.sections : [])) {
      const type = text(s && s.type);
      if (!B[type]) continue;
      count[type] = (count[type] || 0) + 1;
      if (Array.isArray(s.title_lines) && s.title_lines.length) s.title = s.title_lines.join("\n"); // v8: 2줄 제목
      const kids = B[type](s, base, count[type], plan);
      const flat = kids == null ? [] : [kids].flat(Infinity).filter(Boolean);
      if (!flat.length) continue; // 빈 섹션은 그리지 않는다
      const secEl = h(`section.sec.${type}`, { "data-sec": type, "data-n": count[type], ...(s.id ? { "data-id": String(s.id) } : {}) }, flat);
      secEl._plan = s;
      root.append(secEl);
    }
    await waitImages(root);
    for (const wrap of root.querySelectorAll(".pic.overlayed")) if (wrap._overlays?.length) placeOverlays(wrap, wrap._overlays);
    // hero 사진 상자: 사진 비율대로(정사각이면 정사각 카드) 가운데. 한 장(≤1100px) 안에 사진·헤드라인·보조문·배지가 다 들어가야 하므로 글이 길면 상자를 줄인다(최소 280px)
    const hero = root.querySelector("section.hero"), heroPic = hero && hero.querySelector(".hero-pic");
    if (heroPic && heroPic.classList.contains("stage")) { // 누끼 무대: 높이만 조절(배경 그라데이션 유지)
      const over = hero.getBoundingClientRect().height - 1080;
      if (over > 0) heroPic.style.height = Math.max(320, heroPic.offsetHeight - over) + "px";
    } else if (heroPic) {
      const maxW = heroPic.parentElement.clientWidth - parseFloat(getComputedStyle(hero).paddingLeft) * 2;
      let maxH = 720; fitPic(heroPic, maxW, maxH); // 정사각 사진이면 가로폭(692) 꽉 찬 정사각 카드, 세로 긴 사진은 최대 720px
      const over = hero.getBoundingClientRect().height - 1080;
      if (over > 0) { maxH = Math.max(280, heroPic.offsetHeight - over); fitPic(heroPic, maxW, maxH); }
    }
    // usp 사진: 최대 300×320, 사진 비율대로 줄여 빈 여백이 남지 않게
    for (const wrap of root.querySelectorAll(".pic.usp-pic, .pic.benefit-pic")) fitPic(wrap, 300, 320);
    // 치수선
    for (const wrap of root.querySelectorAll(".with-dims")) if (wrap._dims) drawDims(wrap, wrap._dims);
    // 섹션 배경 톤 교대(흰 ↔ 연한 팔레트 톤) — 고정 톤(agitate·cta·solution) 은 건너뛴다
    let tone = 0;
    for (const sec of root.querySelectorAll("section[data-sec]")) {
      if (/^(agitate|cta|solution|hero)$/.test(sec.dataset.sec)) { sec.dataset.tone = "fixed"; continue; }
      sec.dataset.tone = tone++ % 2 ? "b" : "a";
    }
    // v7 강조는 템플릿 후처리 전에(지시선·글자 맞춤이 강조된 폭으로 잰다). localize 레이어는 템플릿이 직접 처리
    for (const secEl of root.querySelectorAll("section[data-sec]")) if (secEl._plan) applySectionEmph(secEl, secEl._plan);
    fixOrphans(root);
    try { await document.fonts.load('900 40px "SCDream"'); await document.fonts.load('300 40px "SCDream"'); await document.fonts.ready; } catch {}
    if (typeof opt().after === "function") await opt().after(root, plan); // 템플릿 후처리(지시선 배치 등)
    dotToColor(root);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.body.dataset.ready = "1";
    return sections();
  }

  // 섹션 위치 목록(문서 좌표) — main 이 슬라이스 계획을 세울 때 쓴다
  function sections() {
    return [...document.querySelectorAll("section[data-sec]")].map((el) => {
      const r = el.getBoundingClientRect();
      // 섹션이 3000px 를 넘어 나눠야 할 때 사진·글 중간이 아니라 블록 경계에서 자르도록 후보 위치(문서 좌표)를 함께 준다
      const breaks = [...el.querySelectorAll(":scope > *, :scope > .stack > *")].map((c) => Math.round(c.getBoundingClientRect().top + window.scrollY)).filter((y) => y > r.top + window.scrollY + 1);
      return { type: el.dataset.sec, id: el.dataset.id || null, n: Number(el.dataset.n || 1), y: Math.round(r.top + window.scrollY), h: Math.round(r.height), w: Math.round(r.width), breaks: [...new Set(breaks)].sort((a, b) => a - b) };
    });
  }
  // 피그마 레이어 값 목록: data-layer 가 붙은 글/이미지 → { "#hero.headline": "…", "#hero.image": "clean/g01.png" }
  function layers() {
    const out = [];
    for (const sec of document.querySelectorAll("section[data-sec]")) {
      const map = {};
      for (const el of sec.querySelectorAll("[data-layer]")) {
        if (el.tagName === "IMG") map[el.dataset.layer] = el.dataset.src;
        else if (el.classList.contains("stage")) { if (el.dataset.src) map[el.dataset.layer] = el.dataset.src; }
        else if (el.classList.contains("pic")) continue;
        else map[el.dataset.layer] = el.textContent;
      }
      out.push({ type: sec.dataset.sec, n: Number(sec.dataset.n || 1), layers: map });
    }
    return out;
  }

  // ----- 자체 점검(하네스용): 넘침·잘림, 글자 크기, 명도 대비 -----
  function parseRgb(s) { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s || ""); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; }
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  function bgOf(el) {
    // 사진 위 글자: 템플릿이 data-bg="#rrggbb"(그 자리 사진 톤) 를 적어 두면 그 색으로 잰다
    const decl = el.closest("[data-bg]");
    if (decl) { // 단, 글자와 data-bg 사이에 자기 배경(알약 강조 등)이 있으면 그 배경으로 잰다
      let own = false; for (let e = el; e && e !== decl; e = e.parentElement) { const c = parseRgb(getComputedStyle(e).backgroundColor); if (c && c[3] >= 0.5) { own = true; break; } }
      if (!own) { const c = hex2rgb(decl.dataset.bg); if (c) return c; }
    } // 뒤에 깔린 색: 투명하면 부모로 올라간다. 반투명 띠(.ov)는 띠 색 자체로 본다(사진 위라 정확히는 못 잰다)
    let e = el; const stack = [];
    while (e && e !== document.documentElement) {
      const c = parseRgb(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
      e = e.parentElement;
    }
    if (!stack.length) return [255, 255, 255];
    let out = stack.pop().slice(0, 3);
    while (stack.length) { const c = stack.pop(); out = out.map((v, i) => Math.round(c[i] * c[3] + v * (1 - c[3]))); }
    return out;
  }
  function check() {
    const W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--w")) || 780;
    const issues = []; let minBody = 999, minHead = 999, minCap = 999, minContrast = 99;
    const walker = document.createTreeWalker(document.querySelector("#page") || document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement, cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
      if (el.closest(".deco")) { // 영문 장식 글(키워드 표 작은 영문 등): 글자 크기 기준 제외, 대비만 본다
        const fgd = parseRgb(cs.color); if (fgd) { const c = contrast(fgd, bgOf(el)); minContrast = Math.min(minContrast, c); if (c < 4.5) issues.push(`대비 ${c.toFixed(2)}:1 < 4.5 — "${node.textContent.trim().slice(0, 20)}"`); }
        continue;
      }
      const role = el.closest("h1.headline") ? "head" : el.closest(".em-pill, .cap, .badge, .eyebrow, .ov, .tag, .num, .qa, .chk, .dim-chip, .ob-tag, .step-num, thead, .unit, .ic") ? "cap" : "body";
      if (role === "head") minHead = Math.min(minHead, fs); else if (role === "cap") minCap = Math.min(minCap, fs); else minBody = Math.min(minBody, fs);
      if (el.closest(".sr")) continue; // 피그마 레이어 값용 숨김 글(화면 밖)
      const inSvg = !!el.closest("svg");
      const fg = parseRgb(inSvg ? cs.fill : cs.color); if (fg) { const c = contrast(fg, bgOf(el)); minContrast = Math.min(minContrast, c); if (c < 4.5) issues.push(`대비 ${c.toFixed(2)}:1 < 4.5 — "${node.textContent.trim().slice(0, 20)}"`); }
      const range = document.createRange(); range.selectNodeContents(node);
      for (const r of inSvg ? [] : range.getClientRects()) { // SVG 글자는 Range rect 가 부정확 → 배치 때 길이를 재서 넣는다
        if (r.right > W + 0.5 || r.left < -0.5) issues.push(`가로 넘침 — "${node.textContent.trim().slice(0, 20)}"`);
        const sec = el.closest("section"); const sr = sec.getBoundingClientRect();
        if (r.bottom > sr.bottom + 0.5 || r.top < sr.top - 0.5) issues.push(`섹션 밖으로 나감 — "${node.textContent.trim().slice(0, 20)}"`);
      }
    }
    for (const el of document.querySelectorAll("#page *")) {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === "ellipsis") issues.push(`말줄임 사용 — ${el.className}`);
      if ((cs.overflowY === "hidden" || cs.overflowX === "hidden") && !el.classList.contains("pic") && !el.hasAttribute("data-clip") && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) issues.push(`overflow:hidden 안에서 잘림 — ${el.className}`);
      if (el.tagName === "IMG" && el.naturalWidth && el.getBoundingClientRect().width > el.naturalWidth * 1.5 + 1) issues.push(`이미지 1.5배 초과 확대 — ${el.dataset.src}`);
    }
    const body = document.body.getBoundingClientRect();
    if (document.documentElement.scrollWidth > W) issues.push(`문서 가로 스크롤 ${document.documentElement.scrollWidth}`);
    // plan 에 이미지가 있는데 화면에 하나도 안 그려진 섹션(필드 이름 불일치·이미지 로드 실패) → 문제로
    try {
      const drawn = new Set([...document.querySelectorAll("#page [data-src]")].map((e) => e.dataset.src).filter(Boolean));
      const cnt = {};
      for (const sec of (window.__plan?.sections || [])) {
        const t = String(sec?.type || ""); cnt[t] = (cnt[t] || 0) + 1;
        const want = new Set([sec.image, sec.cutout, sec.image2, ...(Array.isArray(sec.images) ? sec.images : []), ...(Array.isArray(sec.photos) ? sec.photos : []),
          ...(Array.isArray(sec.items) ? sec.items.map((x) => x && x.image) : []), ...(Array.isArray(sec.zooms) ? sec.zooms.map((x) => x && x.image) : [])].filter((v) => typeof v === "string" && v.trim()));
        if (!want.size) continue;
        const el = document.querySelector(`section[data-sec="${t}"][data-n="${cnt[t]}"]`);
        if (!el) { const miss = new Set(window.__missingFiles || []); issues.push([...want].every((v) => miss.has(v)) ? `이미지 파일 없음 — ${t}#${cnt[t]} 섹션 빠짐` : `이미지 안 그려짐 — ${t}#${cnt[t]} 섹션이 통째로 빠짐(plan 이미지 ${want.size}장)`); continue; }
        if (![...want].some((v) => drawn.has(v))) {
          const miss = new Set(window.__missingFiles || []);
          issues.push([...want].every((v) => miss.has(v)) ? `이미지 파일 없음 — ${t}#${cnt[t]}(${[...want].join(", ").slice(0, 80)})` : `이미지 안 그려짐 — ${t}#${cnt[t]}(plan 이미지 ${want.size}장 중 0장)`);
        }
      }
    } catch (e) { issues.push("이미지 점검 오류 " + e.message); }
    return { width: W, bodyWidth: Math.round(body.width), minBody, minHead, minCap, minContrast: +minContrast.toFixed(2), issues: [...new Set(issues)] };
  }

  window.SeedhackRender = { coreBuild: build, render, sections, layers, check, util: { h, pic, media, srcUrl, has, text, nonEmpty, iconSlot, fitPic, edgeColor, emphasize, noOrphan } };
  if (!window.renderPlan) window.renderPlan = render;
})();
