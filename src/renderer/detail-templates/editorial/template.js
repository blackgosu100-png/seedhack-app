// 에디토리얼 템플릿(v3) — 사내 디자이너 실작업(친절한마이쮸 "블랙 계단식 화분선반") 톤 재현
// 꽉 찬 사진(카드·테두리·그림자 없음) · 연회색 단일 톤 · 영문 세리프 대형 타이틀 · 필기체 소제목 · 키워드 표 · 리뷰(진짜 데이터만)
// CHECK POINT(누끼 + 지시선) · FOR YOU. · POINT 알약 라벨 + `*` 제목 + 2줄 설명 · 사진 2분할 · 세로 갤러리
// 공통 로직은 ../common/render-core.js (builders 로 섹션을 더하고, after 로 지시선·타이틀 맞춤을 한다)
(function () {
  "use strict";
  const U = () => window.SeedhackRender.util;
  const lines = (v) => (Array.isArray(v) ? v : String(v == null ? "" : v).split(/\n/)).map((t) => String(t).trim()).filter(Boolean);
  const pad2 = (n) => String(n).padStart(2, "0");
  const rgbHex = (c) => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || ""); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("") : String(c || ""); };
  // 꽉 찬 사진 한 장(카드 없음). 사진이 없으면 null
  const full = (src, base, layer, cls) => { const { pic, has } = U(); return has(src) ? pic(src, base, "full" + (cls ? "." + cls : ""), layer) : null; };
  // 사진 2분할(2장 미만이면 1장 꽉 차게)
  const split = (arr, base, layerPrefix) => {
    const { nonEmpty, has, h } = U();
    const ps = nonEmpty(arr, has).slice(0, 2);
    if (!ps.length) return null;
    if (ps.length === 1) return full(ps[0], base, `${layerPrefix}.1.image`);
    return h("div.split2", null, ps.map((p, i) => U().pic(p, base, "half", `${layerPrefix}.${i + 1}.image`)));
  };
  // 누끼: bbox(제품이 차지하는 비율 [x0,y0,x1,y1]) 가 있으면 그 부분만 보이게 잘라 제품을 크게
  const cutoutBox = (src, bbox, base, layer, maxW) => {
    const { h, has, srcUrl } = U();
    if (!has(src)) return null;
    const img = h("img.cut", { src: srcUrl(src, base), alt: "", decoding: "async", "data-src": String(src), "data-layer": layer });
    const box = h("div.cut-box", { "data-clip": "1" }, img); // 일부러 잘라 보이는 상자(자체 점검의 잘림 검사 제외)
    box._bbox = Array.isArray(bbox) && bbox.length === 4 ? bbox.map(Number) : [0, 0, 1, 1];
    box._maxW = maxW;
    return box;
  };
  // 누끼 상자 배치(after): bbox 영역이 maxW 폭으로 보이게 이미지 크기·위치를 정한다(원본 1.5배 상한)
  function layoutCut(box) {
    const img = box.querySelector("img"); if (!img || !img.naturalWidth) return;
    const [x0, y0, x1, y1] = box._bbox, bw = Math.max(0.05, x1 - x0), bh = Math.max(0.05, y1 - y0);
    const avail = Math.min(box._maxW || 660, box.parentElement.clientWidth);
    let imgW = Math.min(avail / bw, img.naturalWidth * 1.5), imgH = imgW * img.naturalHeight / img.naturalWidth;
    box.style.width = Math.round(imgW * bw) + "px"; box.style.height = Math.round(imgH * bh) + "px";
    Object.assign(img.style, { width: Math.round(imgW) + "px", height: Math.round(imgH) + "px", maxWidth: "none", maxHeight: "none", marginLeft: Math.round(-x0 * imgW) + "px", marginTop: Math.round(-y0 * imgH) + "px" });
    box._geo = { imgW, imgH, x0, y0 };
  }

  const builders = {
    // 히어로: 꽉 찬 사진 위에 필기체 소제목 + 영문 세리프 3줄 + 세로 가는 선 + 한글 감성 2줄
    hero(s, base) {
      const { h, has, srcUrl } = U();
      const title = lines(s.title_en);
      if (!has(s.image) && !title.length && !has(s.headline)) return null;
      // 영문 타이틀이 없으면(v1·v2 plan) 한글 헤드라인을 큰 제목으로, 보조문을 감성 줄로
      const koHead = !title.length && has(s.headline) ? lines(s.headline) : [];
      const ko = title.length ? lines(s.headline || s.sub) : lines(s.sub);
      const photo = has(s.image) ? h("div.hero-photo", { "data-layer": "#hero.image", "data-clip": "1" }, h("img", { src: srcUrl(s.image, base), alt: "", decoding: "async", "data-src": String(s.image), "data-layer": "#hero.image" })) : null;
      const copy = h("div.hero-copy", { "data-bg": s.bg || "#ececec" },
        has(s.script) ? h("div.script.deco", { text: s.script, "data-layer": "#hero.script" }) : null,
        title.length ? h("h1.headline.serif", { "data-layer": "#hero.title_en" }, title.map((t, i) => [i ? h("br") : null, t])) : null,
        koHead.length ? h("h1.headline.ko-head", { "data-layer": "#hero.headline" }, koHead.map((t, i) => [i ? h("br") : null, t])) : null,
        ko.length ? h("div.vline") : null,
        ko.length ? h("p.sub", { "data-layer": "#hero.headline" }, ko.map((t, i) => [i ? h("br") : null, t])) : null);
      return [photo, copy];
    },
    // 옵션·사이즈 표 + 누끼 + 안내 2줄
    options(s, base) {
      const { h, has, nonEmpty } = U();
      const rows = nonEmpty(s.options_table, (r) => r && has(r.name)).slice(0, 8);
      const head = lines(s.headline);
      if (!rows.length && !head.length && !has(s.cutout) && !has(s.image)) return null;
      const notes = nonEmpty(s.notes, has).slice(0, 3);
      return [has(s.label) ? h("div.opt-label.cap", { text: s.label, "data-layer": "#options.label" }) : null,
        head.length ? h("h2.opt-head", { "data-layer": "#options.headline" }, head.map((t, i) => [i ? h("br") : null, t])) : null,
        rows.length ? h("table.opt-table", null, h("tbody", null, rows.map((r, i) => h("tr", null,
          h("th", { text: r.name, "data-layer": `#options.${i + 1}.name` }), h("td", { text: r.size || "", "data-layer": `#options.${i + 1}.size` }))))) : null,
        notes.length ? h("div.opt-notes", null, notes.map((t, i) => h("p.cap", { text: t, "data-layer": `#options.note.${i + 1}` }))) : null,
        has(s.cutout) || has(s.image) ? h("div.cut-wrap.opt-cut", null, cutoutBox(s.cutout || s.image, s.cutout_bbox, base, "#options.cutout", 660)) : null];
    },
    // 키워드 표: 큰 영문(가는 글꼴) + 오른쪽 작은 영문 · 한글, 가는 구분선
    keywords(s) {
      const { h, has, nonEmpty } = U();
      const items = nonEmpty(s.items || s.keywords, (k) => k && has(k.en)).slice(0, 6);
      if (!items.length) return null;
      return h("div.kw-table", null, items.map((k, i) => h("div.kw-row", null,
        h("div.kw-en.deco", { text: String(k.en).toUpperCase(), "data-layer": `#keywords.${i + 1}.en` }),
        h("div.kw-right", null,
          has(k.en_sub) ? h("div.kw-sub.deco", { text: String(k.en_sub).toUpperCase(), "data-layer": `#keywords.${i + 1}.en_sub` }) : null,
          has(k.ko) ? h("div.kw-ko", { text: k.ko, "data-layer": `#keywords.${i + 1}.ko` }) : null))));
    },
    // 리뷰(사회적 증거): 진짜 데이터가 있을 때만. 어두운 배경 · 큰 별점 · 사진 4열 · 카드 2열(핵심 구절 노란 형광)
    reviews(s, base) {
      const { h, has, nonEmpty, pic } = U();
      const photos = nonEmpty(s.photos, has).slice(0, 16);
      const cards = nonEmpty(s.cards, (c) => c && has(c.text)).slice(0, 8);
      if (!photos.length && !cards.length) return null; // 데이터 없으면 섹션 생략(가짜 리뷰 금지)
      const mark = (text, hl) => { // 핵심 구절 형광 강조
        const parts = [String(text)];
        for (const q of nonEmpty(hl, has)) {
          for (let i = 0; i < parts.length; i++) {
            if (typeof parts[i] !== "string") continue;
            const at = parts[i].indexOf(q); if (at < 0) continue;
            parts.splice(i, 1, parts[i].slice(0, at), h("mark.hl", { text: q }), parts[i].slice(at + q.length)); break;
          }
        }
        return parts.filter((p) => p !== "");
      };
      return [h("div.rv-head", null,
          has(s.rating) ? h("div.rv-score", null, h("span.rv-num", { text: String(s.rating), "data-layer": "#reviews.rating" }), has(s.count_label) ? h("span.rv-count.cap", { text: s.count_label, "data-layer": "#reviews.count_label" }) : null) : null,
          h("h2.rv-title", { text: s.title || "압도적인 리뷰.", "data-layer": "#reviews.title" })),
        photos.length ? h("div.rv-grid", null, photos.map((p, i) => pic(p, base, "rv-ph", `#reviews.photo.${i + 1}`))) : null,
        cards.length ? h("div.rv-cards", null, cards.map((c, i) => h("div.rv-card", null,
          h("div.rv-stars", { text: "★".repeat(Math.max(1, Math.min(5, Number(c.stars) || 5))) }),
          h("p.rv-text", { "data-layer": `#reviews.${i + 1}.text` }, mark(c.text, c.highlight)),
          h("div.rv-foot.deco", null, h("span", { text: c.user || "" }), h("span", { text: c.date || "" }))))) : null];
    },
    // CHECK POINT: 누끼 + 지시선(점·선·라벨, x/y 는 누끼 이미지 기준 0~1)
    checkpoint(s, base) {
      const { h, has, nonEmpty } = U();
      if (!has(s.cutout) && !has(s.image)) return null;
      const box = cutoutBox(s.cutout || s.image, s.cutout_bbox, base, "#checkpoint.cutout", 640);
      box._callouts = nonEmpty(s.callouts, (c) => c && has(c.label) && isFinite(c.x) && isFinite(c.y)).slice(0, 6);
      return [h("h2.serif.cp-title", { text: s.title || "CHECK POINT", "data-layer": "#checkpoint.title" }), h("div.cp-stage", null, box)];
    },
    // FOR YOU.: 영문 세리프 대형 + ▶ 4줄
    foryou(s) {
      const { h, has, nonEmpty } = U();
      const items = nonEmpty(s.items, has).slice(0, 5);
      if (!items.length) return null;
      const t = lines(s.title || "FOR\nYOU.");
      return h("div.fy", null, h("h2.serif.fy-title", { "data-layer": "#foryou.title" }, t.map((x, i) => [i ? h("br") : null, x])),
        h("ul.fy-list", null, items.map((x, i) => h("li", null, h("span.fy-arrow.deco", { text: "▶" }), h("span", { text: x, "data-layer": `#foryou.${i + 1}` })))));
    },
    // POINT 0N: 알약 라벨 → 꽉 찬 사진 → * 제목 + 2줄 설명 → 사진 2분할 → (사진)
    point(s, base, n) {
      const { h, has } = U();
      if (!has(s.image) && !has(s.title)) return null;
      const no = Number(s.no) || n, L = `#point.${no}`;
      // 오른쪽 이름: label(기능명). 없거나 "POINT 01" 같은 번호뿐이면 제목 앞부분(≤8자, 단어 단위)
      const shortTitle = (t) => { t = String(t || "").trim(); if (t.length <= 8) return t; const w = t.split(/\s+/); let o = ""; for (const x of w) { if ((o ? o + " " + x : x).length > 8) break; o = o ? o + " " + x : x; } return o || t.slice(0, 8); };
      const name = has(s.label) && !/^\s*point\.?\s*\d+\s*$/i.test(s.label) ? s.label : shortTitle(s.title);
      const pill = h("div.pill", null, h("span.pill-no.cap", { text: `POINT. ${pad2(no)}`, "data-layer": `${L}.no` }), h("span.pill-name.cap", { text: name, "data-layer": `${L}.label` }));
      const desc = lines(s.desc).slice(0, 3);
      const textBlock = has(s.title) ? h("div.pt-text", null, h("div.ast", { text: "*" }), h("h3.pt-title", { text: s.title, "data-layer": `${L}.title` }),
        desc.length ? h("p.pt-desc", { "data-layer": `${L}.desc` }, desc.map((t, i) => [i ? h("br") : null, t])) : null) : null;
      const photo = full(s.image, base, `${L}.image`);
      const order = s.text_first ? [pill, textBlock, photo] : [pill, photo, textBlock];
      return [...order, split(s.photos, base, `${L}.photos`), full(s.image2, base, `${L}.image2`)];
    },
    // 갤러리: 알약 라벨 + 세로 사진 나열
    gallery(s, base, n) {
      const { h, has, nonEmpty } = U();
      const imgs = nonEmpty(s.images, has).slice(0, 10);
      if (!imgs.length) return null;
      const no = Number(s.no) || 0;
      return [h("div.pill", null, h("span.pill-no.cap", { text: no ? `POINT. ${pad2(no)}` : "GALLERY" }), h("span.pill-name.cap", { text: s.label || "갤러리", "data-layer": "#gallery.label" })),
        h("div.stack", null, imgs.map((p, i) => full(p, base, `#gallery.${i + 1}.image`)))];
    },
  };

  // 후처리: 타이틀 맞춤, 누끼 배치, 지시선, 리뷰 다음 섹션 위쪽 물방울 모양 이음
  async function after(root, plan) {
    const W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--w")) || 780;
    // 톤: meta.tone("light"|"charcoal") 우선, 없으면 palette.dark 면 차콜
    // 톤: meta.tone === "charcoal" 일 때만 차콜. palette.dark(제품이 어둡다)는 톤을 바꾸지 않는다 — 레퍼런스처럼 검정 제품은 연회색 바탕
    const tone = plan?.meta?.tone === "charcoal" ? "charcoal" : "light";
    document.body.dataset.tone = tone;
    // 히어로 사진 높이: 사진 비율대로, 최대 1100(한 장 안)
    const hp = root.querySelector(".hero-photo img");
    if (hp && hp.naturalWidth) {
      const sec = root.querySelector("section.hero"), ratio = hp.naturalHeight / hp.naturalWidth;
      const fullH = Math.round(W * ratio);
      // 세로로 긴 사진은 디자이너처럼 "배경을 늘려" 위쪽에 글 자리를 만든다: 사진을 오른쪽 아래에 두고(높이 86%) 왼쪽·위 가장자리를 배경색으로 녹인다
      if (fullH > 1000 && sec.querySelector(".hero-copy")) {
        sec.style.height = "1100px";
        const ih = Math.round(1100 * 0.73), iw = Math.round(ih / ratio);
        if (iw < W) {
          sec.classList.add("extend");
          Object.assign(hp.style, { width: iw + "px", height: ih + "px" });
          const bg = (window.__edgeColors || {})[hp.dataset.src + "#top"] || window.SeedhackRender.util.edgeColor(hp) || "#ebebeb";
          sec.style.background = bg; sec.querySelector(".hero-copy").dataset.bg = rgbHex(bg);
        }
      } else sec.style.height = Math.min(1100, fullH) + "px";
    }
    // 영문 타이틀이 너무 길면 폭의 70% 안에 들어올 때까지 글자를 줄인다
    for (const t of root.querySelectorAll("h1.headline.serif, .fy-title")) {
      let fs = parseFloat(getComputedStyle(t).fontSize);
      const lim = t.classList.contains("fy-title") ? 220 : W * 0.72;
      const widest = () => { const r = document.createRange(); r.selectNodeContents(t); return Math.max(...[...r.getClientRects()].map((x) => x.width)); };
      while (widest() > lim && fs > 44) { fs -= 4; t.style.fontSize = fs + "px"; }
    }
    for (const box of root.querySelectorAll(".cut-box")) layoutCut(box);
    for (const box of root.querySelectorAll(".cp-stage .cut-box")) placeCallouts(box, W);
    // 리뷰 섹션 다음 섹션: 위쪽에 어두운 물방울(이음) 장식
    const rv = root.querySelector("section.reviews");
    if (rv && rv.nextElementSibling) {
      const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "drip"); svg.setAttribute("viewBox", "0 0 100 10"); svg.setAttribute("preserveAspectRatio", "none");
      const p = document.createElementNS(NS, "path"); p.setAttribute("d", "M30 0 C42 0 45 3 50 9 C55 3 58 0 70 0 Z"); svg.append(p);
      rv.nextElementSibling.classList.add("after-dark"); rv.nextElementSibling.prepend(svg);
    }
  }

  // 지시선: 위쪽 절반의 점은 라벨을 누끼 위로, 아래쪽 절반은 아래로. 가로로 겹치면 층(tier)을 바꿔 엇갈리게
  function placeCallouts(box, W) {
    const g = box._geo, cs = box._callouts || [];
    if (!g || !cs.length) return;
    const stage = box.parentElement;
    const NS = "http://www.w3.org/2000/svg";
    const bw = box.offsetWidth, bh = box.offsetHeight, TIER = 104, GAP = 56;
    const pts = cs.map((c, i) => ({ c, i, x: (c.x - g.x0) * g.imgW, y: (c.y - g.y0) * g.imgH, top: c.side ? c.side !== "bottom" : c.y < (g.y0 + (bh / g.imgH) / 2) })); // side 로 위/아래 지정 가능
    // 라벨 먼저 만들어 폭을 잰다
    for (const p of pts) {
      const el = document.createElement("div"); el.className = "cp-label";
      String(p.c.label).split(/\n/).forEach((t, k) => { if (k) el.append(document.createElement("br")); el.append(t); });
      el.dataset.layer = `#checkpoint.${p.i + 1}.label`;
      stage.append(el); p.el = el; p.w = el.offsetWidth; p.h = el.offsetHeight;
    }
    const boxLeft = box.offsetLeft;
    const maxTier = { top: 0, bottom: 0 };
    for (const side of ["top", "bottom"]) {
      const group = pts.filter((p) => p.top === (side === "top")).sort((a, b) => a.x - b.x);
      const placed = [];
      for (const p of group) {
        const cx = Math.max(p.w / 2 + 24, Math.min(W - p.w / 2 - 24, boxLeft + p.x));
        let tier = 0;
        while (placed.some((q) => q.tier === tier && Math.abs(q.cx - cx) < (q.w + p.w) / 2 + 28)) tier++;
        p.cx = cx; p.tier = tier; placed.push(p); maxTier[side] = Math.max(maxTier[side], tier);
      }
    }
    // 무대 위아래 여백 = 라벨 층 수만큼
    const labelH = Math.max(...pts.map((p) => p.h), 60);
    const padTop = pts.some((p) => p.top) ? GAP + labelH + maxTier.top * TIER + 24 : 24;
    const padBot = pts.some((p) => !p.top) ? GAP + labelH + maxTier.bottom * TIER + 24 : 24;
    stage.style.paddingTop = padTop + "px"; stage.style.paddingBottom = padBot + "px";
    const top0 = box.offsetTop; // 패딩 적용 후 다시 잰다
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "cp-lines");
    svg.setAttribute("width", stage.clientWidth); svg.setAttribute("height", stage.clientHeight);
    for (const p of pts) {
      const dx = boxLeft + p.x, dy = top0 + p.y;
      let ly;
      if (p.top) { ly = top0 - GAP - p.tier * TIER - p.h; p.el.style.top = ly + "px"; }
      else { ly = top0 + bh + GAP + p.tier * TIER; p.el.style.top = ly + "px"; }
      p.el.style.left = (p.cx - p.w / 2) + "px";
      const lx = Math.max(p.cx - p.w / 2 + 12, Math.min(p.cx + p.w / 2 - 12, dx)); // 선은 점 바로 위/아래로(라벨 폭 안)
      const y2 = p.top ? ly + p.h + 14 : ly - 14;
      const line = document.createElementNS(NS, "path");
      line.setAttribute("d", Math.abs(lx - dx) < 1 ? `M${dx} ${dy} L${dx} ${y2}` : `M${dx} ${dy} L${dx} ${(dy + y2) / 2} L${lx} ${(dy + y2) / 2} L${lx} ${y2}`);
      line.setAttribute("class", "cp-line"); svg.append(line);
      const dot = document.createElementNS(NS, "circle"); dot.setAttribute("cx", dx); dot.setAttribute("cy", dy); dot.setAttribute("r", 5); dot.setAttribute("class", "cp-dot"); svg.append(dot);
    }
    stage.prepend(svg);
  }

  window.TEMPLATE = { id: "editorial", noEmoji: true, builders, after,
    labels: { gallery: "갤러리", spec: "제품 정보", size: "사이즈", package: "구성", notice: "NOTICE", faq: "Q&A" } };
  window.renderPlan = (plan, baseUrl) => window.SeedhackRender.render(plan, baseUrl);
})();
