// 카드 템플릿(v5) — Moast 결과 톤 재현(같은 상품 "화이트 커피머신 수납 선반" 9섹션 비교)
// 아이보리 배경 · 섹션 사이 넉넉한 여백 · 장면 사진 + 상단 중앙 글자 4줄 히어로 + 아이콘 4개 띠 · BEFORE/AFTER 알약
// CHECKPOINT 지시선(가는 선 + 점, 라벨 2줄) · 흰 둥근 카드(사진 + 짧은 가로선 + 굵은 2줄 제목 + 2줄 설명) · 2×2 활용 · 확대 원 디테일 + 주의 박스
// 글꼴 Pretendard 굵기 대비(제목 800 / 본문 400). 색은 plan.meta.styleGuide(배경·글자·포인트) → CSS 변수
(function () {
  "use strict";
  const U = () => window.SeedhackRender.util;
  const lines = (v) => (Array.isArray(v) ? v : String(v == null ? "" : v).split(/\n/)).map((t) => String(t).trim()).filter(Boolean);
  const br = (arr) => arr.map((t, i) => [i ? U().h("br") : null, t]);
  const ml = (tag, v, layer) => { const l = lines(v); return l.length ? U().h(tag, { "data-layer": layer }, br(l)) : null; };
  const img = (src, base, cls, layer) => { const { h, has, srcUrl } = U(); return has(src) ? h("img" + (cls ? "." + cls : ""), { src: srcUrl(src, base), alt: "", decoding: "async", "data-src": String(src), "data-layer": layer }) : null; };
  // plan 형식 두 가지 모두 허용: image 또는 images[0]
  const first = (s) => (typeof s.image === "string" && s.image.trim() ? s.image : (Array.isArray(s.images) ? s.images.find((x) => typeof x === "string" && x.trim()) : null) || s.cutout || null);
  // 아이콘 키가 없으면 문구로 추정(없으면 번호)
  const guessIcon = (t) => { t = String(t || "");
    const R = [[/슬라이드|레일|당기|서랍/, "slide"], [/2단|분류|층|겹|쌓/, "layers"], [/설치|조립|나사|완제품/, "noassembly"], [/방진|방습|먼지|습기|물|녹|코팅|방수/, "drop"],
      [/하중|튼튼|탄소강|철제|스틸|견고/, "steel"], [/높이|규격|사이즈|크기/, "sizes"], [/폭|조절|맞춤|늘려/, "ruler"], [/미끄럼|패드|매트/, "pad"], [/가드|난간/, "guard"], [/배송/, "delivery"], [/공간|수납/, "box"], [/세척|청소/, "wash"]];
    for (const [re, k] of R) if (re.test(t)) return k; return null; };
  const deco = () => U().h("div.deco-line", null, U().h("i"));

  // v7 히어로 메인 줄: 굵기 대비(가는 300 ↔ 굵은 900) + 강조 1개. emph 가 없으면 마지막 단어를 굵게. vlines 면 양옆 세로선
  function heroName(s) {
    const { h } = U();
    const t = String(s.name || s.headline || "");
    const el = h("h1.headline.hero-name" + (s.vlines ? ".vlines" : ""), { text: t, "data-layer": "#hero.name" });
    const em = Array.isArray(s.name_emph) && s.name_emph.length ? s.name_emph : Array.isArray(s.emph) && s.emph.length ? s.emph : []; // plan 에 emph 가 없으면 자동 강조 없음
    if (em.length) U().emphasize(el, em);
    return el;
  }
  // ----- v8 신뢰·판매 실적 블록(수강생이 선택해 넣는 실제 데이터만 — 비면 섹션 생략) -----
  const val = (x) => (x == null ? "" : String(x).trim());
  const claimIcon = (t) => (/완판|판매/.test(t) ? "star" : /위|랭킹|순위/.test(t) ? "tag" : /인증|KC|특허/.test(t) ? "shield" : /공식|정품/.test(t) ? "check" : /만족|후기|리뷰/.test(t) ? "heart" : "check");
  const trustBuilders = {
    // trust_badges: { title?, items[{ icon?, title, desc? }] } 3~4개
    trust_badges(s) {
      const { h, nonEmpty } = U();
      const items = nonEmpty((s.items || []).map((it) => (typeof it === "string" ? { title: it, icon: claimIcon(it) } : it)), (it) => it && val(it.title)).slice(0, 4); // A3 형식: 문자열 배열
      if (!items.length) return null;
      const I = window.SeedhackIcons;
      return [val(s.title) ? ml("h2.sec-title", s.title, "#trust_badges.title") : null,
        h("div.tb-row", { "data-n": items.length }, items.map((it, i) => h("div.tb-item", null,
          h("div.tb-ic", null, I && I.has(it.icon) ? I.svg(it.icon) : h("span", { text: "✓" })),
          h("div.tb-title", { text: it.title, "data-layer": `#trust_badges.${i + 1}.title` }),
          val(it.desc) ? h("div.tb-desc.cap", { text: it.desc, "data-layer": `#trust_badges.${i + 1}.desc` }) : null)))];
    },
    // sold_out_banner: { big("7차"), word("완판"), sub?, lines?[] , badge?{ big, small } , image? }
    sold_out_banner(s, base) {
      const { h } = U();
      if (val(s.text) && !val(s.big) && !val(s.word)) { const m = /^(\S+)\s+(.+)$/.exec(val(s.text)); s = { ...s, ...(m ? { big: m[1], word: m[2] } : { word: val(s.text) }) }; } // A3 형식 {text:"7차 완판"}
      if (!val(s.big) && !val(s.word)) return null;
      return [h("div.so-head", null, val(s.big) ? h("span.so-big", { text: s.big, "data-layer": "#sold_out.big" }) : null, val(s.word) ? h("span.so-word", { text: s.word, "data-layer": "#sold_out.word" }) : null),
        val(s.sub) ? h("p.so-sub", { text: s.sub, "data-layer": "#sold_out.sub" }) : null,
        Array.isArray(s.lines) && s.lines.length ? h("h3.so-lines", null, br(s.lines.map(val).filter(Boolean))) : null,
        val(s.image) ? h("div.so-photo", { "data-clip": "1" }, img(s.image, base, null, "#sold_out.image"), s.badge && val(s.badge.big) ? h("div.so-badge", null, h("b", { text: s.badge.big }), val(s.badge.small) ? h("span.cap", { text: s.badge.small }) : null) : null)
          : (s.badge && val(s.badge.big) ? h("div.so-badge.static", null, h("b", { text: s.badge.big }), val(s.badge.small) ? h("span.cap", { text: s.badge.small }) : null) : null)];
    },
    // rank_badge: { label("쿠팡 ○○ 카테고리"), rank("1위"), period?("2026.09 기준"), source? }
    rank_badge(s) {
      const { h } = U();
      if (val(s.text) && !val(s.rank)) { const m = /^(.*?)\s*(\S*\d+\s*위)\s*$/.exec(val(s.text)); s = { ...s, ...(m ? { label: m[1], rank: m[2] } : { rank: val(s.text) }) }; } // A3 형식 {text:"○○ 카테고리 1위"}
      if (!val(s.rank)) return null;
      return h("div.rk-box", null, h("div.rk-circle", null, h("span.rk-label.cap", { text: val(s.label) }), h("b.rk-rank", { text: s.rank, "data-layer": "#rank.rank" })),
        val(s.period) || val(s.source) ? h("p.rk-src.cap", { text: [val(s.period), val(s.source)].filter(Boolean).join(" · ") }) : null);
    },
    // rnd_cost: { question?, lines?[], pill("연구 개발 비용 2억"), image? } — 어두운 띠 + 말풍선 꼬리 뒤 강조 알약
    rnd_cost(s, base) {
      const { h } = U();
      if (val(s.text) && !val(s.pill)) s = { ...s, pill: val(s.text) }; // A3 형식 {text}
      if (!val(s.pill)) return null;
      return [val(s.question) ? h("div.rc-q", null, ml("h2.rc-qt", s.question, "#rnd.question")) : null,
        h("div.rc-body", null, Array.isArray(s.lines) && s.lines.length ? h("p.rc-lines", null, br(s.lines.map(val).filter(Boolean))) : null,
          h("div.rc-pill", { text: s.pill, "data-layer": "#rnd.pill" }), val(s.image) ? h("div.rc-photo", { "data-clip": "1" }, img(s.image, base, null, "#rnd.image")) : null)];
    },
    // cert: { title?, items[{ name("KC 인증"), no("B052R792-3008"), image? }] }
    cert(s, base) {
      const { h, nonEmpty } = U();
      const items = nonEmpty(s.items, (it) => it && val(it.name)).slice(0, 4); // 번호 없는 인증도 허용
      if (!items.length) return null;
      return [val(s.title) ? ml("h2.sec-title", s.title, "#cert.title") : null,
        h("div.ct-row", null, items.map((it, i) => h("div.ct-card", null, val(it.image) ? h("div.ct-ph", { "data-clip": "1" }, img(it.image, base, null, `#cert.${i + 1}.image`)) : null,
          h("div.ct-text", null, h("b", { text: it.name, "data-layer": `#cert.${i + 1}.name` }), val(it.no) ? h("span", { text: it.no, "data-layer": `#cert.${i + 1}.no` }) : null))))];
    },
    // official_store: { mark("정품"), brand?, title("○○ 공식 스토어"), desc? }
    official_store(s) {
      const { h } = U();
      if (val(s.text) && !val(s.title)) s = { ...s, title: val(s.text) }; // A3 형식 {text}
      if (!val(s.title)) return null;
      return h("div.os-card", null, h("div.os-mark", null, val(s.brand) ? h("span.os-brand.cap", { text: s.brand }) : null, h("b", { text: val(s.mark) || "정품" })),
        h("div.os-text", null, h("h3", { text: s.title, "data-layer": "#official.title" }), val(s.desc) ? h("p.cap", { text: s.desc, "data-layer": "#official.desc" }) : null));
    },
    // review_stat: { value("4.9" / "100%"), unit?, label("실사용 후기"), title?, sub?, image? }
    review_stat(s, base) {
      const { h } = U();
      if (!val(s.value) && (val(s.satisfaction) || val(s.count))) { // A3 형식 {count, satisfaction}
        s = val(s.satisfaction) ? { ...s, value: val(s.satisfaction), unit: "%", label: "구매 만족도", sub: s.sub || (val(s.count) ? `실사용 후기 ${val(s.count)}건` : "") }
          : { ...s, value: val(s.count), unit: "건", label: "실사용 후기" };
      }
      if (!val(s.value)) return null;
      return [val(s.title) ? ml("h2.sec-title", s.title, "#review_stat.title") : null, val(s.sub) ? h("p.rs-sub", { text: s.sub }) : null,
        h("div.rs-stage", null, val(s.image) ? h("div.rs-photo", { "data-clip": "1" }, img(s.image, base, null, "#review_stat.image")) : null,
          h("div.rs-badge", null, h("b", { text: val(s.value) + val(s.unit), "data-layer": "#review_stat.value" }), val(s.label) ? h("span.cap", { text: s.label, "data-layer": "#review_stat.label" }) : null))];
    },
  };
  const builders = Object.assign(trustBuilders, {
    // v8 문제 제기: { question, sub } → 어두운 띠 + 말풍선 꼬리(테마 CSS). items 가 있으면 공통 problem(v2 목록)으로
    problem(s, base, n, plan) {
      const { h, has } = U();
      if (Array.isArray(s.items) && s.items.length) return window.SeedhackRender.coreBuild.problem(s, base, n, plan);
      if (!has(s.question) && !has(s.title)) return null;
      return h("div.pb-box", null, has(s.sub) ? h("p.pb-sub", { text: s.sub, "data-layer": "#problem.sub" }) : null,
        ml("h2.pb-q", s.question || s.title, "#problem.question"));
    },
    // 히어로: 장면 사진 꽉 차게 + 상단 중앙 글자 4줄(라벨 / 보조문 / 제품군명 / 굵은 제품명) + 하단 아이콘 4개 띠
    hero(s, base) {
      const { h, has, nonEmpty } = U();
      s = { ...s, image: first(s) };
      if (!has(s.image) && !has(s.name) && !has(s.headline)) return null;
      const icons = nonEmpty(s.icons, (it) => it && (has(it.text) || has(it.label))).slice(0, 4).map((it) => ({ icon: it.icon || guessIcon(it.text || it.label), text: it.text || it.label }));
      const I = window.SeedhackIcons;
      return [h("div.hero-scene", { "data-clip": "1", "data-layer": "#hero.image" }, img(s.image, base, "hero-img", "#hero.image"),
          h("div.hero-text", { "data-bg": s.bg || "#efebe4" },
            has(s.label) ? h("div.hero-label.cap", { text: s.label, "data-layer": "#hero.label" }) : null,
            has(s.sub) ? h("p.hero-sub", { text: s.sub, "data-layer": "#hero.sub" }) : null,
            has(s.category) ? h("div.hero-cat", { text: s.category, "data-layer": "#hero.category" }) : null,
            heroName(s))),
        icons.length ? h("div.icon-band", { "data-n": icons.length }, icons.map((it, i) => h("div.ib-item", null,
          I && I.has(it.icon) ? h("div.ib-ic", null, I.svg(it.icon)) : h("div.ib-ic.num", { text: String(i + 1) }),
          ml("p.ib-text.cap", it.text, `#hero.icon.${i + 1}`)))) : null];
    },
    // 비포/애프터: 사진 하단에 BEFORE(회색)·AFTER(노랑) 알약, 아래 보조문 + 굵은 제목 가운데
    before_after(s, base) {
      const { h, has, nonEmpty } = U();
      const ims = nonEmpty(Array.isArray(s.images) && s.images.length ? s.images : [s.image], has);
      if (!ims.length && !has(s.title)) return null;
      if (ims.length >= 2) s = { ...s, before_x: s.before_x || 0.25, after_x: s.after_x || 0.75 };
      return [ims.length ? h("div.ba-photo" + (ims.length >= 2 ? ".two" : ""), { "data-clip": "1" }, ims.slice(0, 2).map((p, i) => img(p, base, "ba-img", `#before_after.image${ims.length > 1 ? "." + (i + 1) : ""}`)),
          h("span.pill.before.cap", { text: s.before_label || "BEFORE", style: `left:${Math.round((Number(s.before_x) || 0.25) * 100)}%` }),
          h("span.pill.after.cap", { text: s.after_label || "AFTER", style: `left:${Math.round((Number(s.after_x) || 0.72) * 100)}%` })) : null,
        h("div.ba-text", null, has(s.sub) ? h("p.ba-sub", { text: s.sub, "data-layer": "#before_after.sub" }) : null,
          ml("h2.ba-title", s.title, "#before_after.title"))];
    },
    // CHECKPOINT: 갈색 작은 대문자 + 굵은 2줄 제목 + 장면 위 지시선(라벨 2줄: 위 가는 글씨 / 아래 굵은 키워드)
    checkpoint(s, base) {
      const { h, has, nonEmpty } = U();
      const src = first(s);
      if (!has(src)) return null;
      const photo = h("div.cp-photo", { "data-clip": "1" }, img(src, base, "cp-img", "#checkpoint.image"));
      // 라벨 형식: {label_small,label_bold} · {thin,bold} · {label:"위\n아래"}. x,y(0~1) 가 없으면 제품 상자 둘레에 자동 배치(after)
      photo._callouts = nonEmpty(s.callouts, (c) => c && (has(c.label_bold) || has(c.label_small) || has(c.label) || has(c.bold))).slice(0, 6).map((c) => {
        const parts = String(c.label || "").split(/\n/);
        return { label_small: c.label_small || c.thin || (parts.length > 1 ? parts[0] : ""), label_bold: c.label_bold || c.bold || (parts.length > 1 ? parts.slice(1).join(" ") : parts[0]),
          x: Number(c.x), y: Number(c.y), auto: !(isFinite(c.x) && isFinite(c.y) && c.x !== null && c.y !== null) };
      });
      photo._bbox = s.bbox || s.cutout_bbox || null;
      return [h("div.cp-head", null, h("div.kicker.cap", { text: s.kicker || "CHECKPOINT" }), ml("h2.cp-title", s.title, "#checkpoint.title")), photo];
    },
    // 기능 카드: 흰 둥근 카드 안에 사진(들) + 짧은 가로선 + 굵은 2줄 제목 + 2줄 설명. images[] 가 2장이면 위아래로
    feature(s, base, n) {
      const { h, has, nonEmpty } = U();
      const ims = nonEmpty(s.images && s.images.length ? s.images : [s.image], has).slice(0, 2);
      if (!ims.length && !has(s.title)) return null;
      const L = `#feature.${n}`;
      return h("div.card", null, ims.length ? h("div.card-photos", { "data-n": ims.length }, ims.map((p, i) => h("div.card-ph", { "data-clip": "1" }, img(p, base, null, `${L}.image${ims.length > 1 ? "." + (i + 1) : ""}`)))) : null,
        h("div.card-text", null, deco(), ml("h3.card-title", s.title, `${L}.title`), ml("p.card-desc", s.desc, `${L}.desc`)));
    },
    // 규격·옵션: { image, title, rows[{name,size}] } 또는 editorial 형식 { label, headline, options_table[{name,size}], notes[], cutout }
    options(s, base) {
      const { h, has, nonEmpty } = U();
      const rows = nonEmpty(s.rows || s.options_table, (r) => r && (has(r.name) || has(r.k))).slice(0, 8);
      const src = first(s), title = s.title || s.headline;
      if (!rows.length && !has(src) && !has(title)) return null;
      const notes = nonEmpty(s.notes, has).slice(0, 3);
      return h("div.card.opt-card", null,
        has(src) ? h("div.card-ph", { "data-clip": "1" }, img(src, base, null, "#options.image")) : null,
        h("div.card-text", null, has(s.label) ? h("div.kicker.cap", { text: s.label, "data-layer": "#options.label" }) : deco(), ml("h3.card-title", title, "#options.title"),
          rows.length ? h("table.opt-rows", null, h("tbody", null, rows.map((r, i) => h("tr", null, h("th", { text: r.name || r.k, "data-layer": `#options.${i + 1}.name` }), h("td", { text: r.size || r.v || "", "data-layer": `#options.${i + 1}.size` }))))) : null,
          notes.length ? h("div.opt-notes", null, notes.map((t, i) => h("p.cap", { text: t, "data-layer": `#options.note.${i + 1}` }))) : null));
    },
    // 2장 카드형: 위아래 사진 2장 + 각각 제목/설명
    feature2(s, base, n) {
      const { h, has, nonEmpty } = U();
      const items = nonEmpty(s.items, (it) => it && (has(it.title) || has(it.image))).slice(0, 2);
      if (!items.length) return null;
      return h("div.card.card2", null, items.map((it, i) => h("div.c2-item", null,
        has(it.image) ? h("div.card-ph", { "data-clip": "1" }, img(it.image, base, null, `#feature2.${n}.${i + 1}.image`)) : null,
        h("div.card-text", null, ml("h3.card-title", it.title, `#feature2.${n}.${i + 1}.title`), ml("p.card-desc", it.desc, `#feature2.${n}.${i + 1}.desc`)))));
    },
    // 활용 장면: 굵은 갈색 제목 + 보조문 + 2×2 둥근 사진 + 사진 아래 가운데 라벨
    versatility(s, base) {
      const { h, has, nonEmpty } = U();
      let items = nonEmpty(s.items, (it) => it && has(it.image)).slice(0, 4);
      const extra = nonEmpty(Array.isArray(s.images) ? s.images : [], has);
      if (!items.length && extra.length >= 2) items = extra.slice(0, 4).map((p, i) => ({ image: p, label: (s.items || [])[i]?.label || "" }));
      if (!items.length) { // 사진 1장 + 라벨들
        const one = first(s); const labels = nonEmpty(s.items, (it) => it && has(it.label)).slice(0, 6);
        if (!has(one)) return null;
        return [h("div.vs-head", null, ml("h2.vs-title", s.title, "#versatility.title"), has(s.sub) ? h("p.vs-sub", { text: s.sub, "data-layer": "#versatility.sub" }) : null),
          h("div.vs-one", { "data-clip": "1" }, img(one, base, null, "#versatility.image")),
          labels.length ? h("div.vs-chips", null, labels.map((it, i) => h("span.vs-chip", { text: it.label, "data-layer": `#versatility.${i + 1}.label` }))) : null];
      }
      return [h("div.vs-head", null, ml("h2.vs-title", s.title, "#versatility.title"), has(s.sub) ? h("p.vs-sub", { text: s.sub, "data-layer": "#versatility.sub" }) : null),
        h("div.vs-grid", null, items.map((it, i) => h("figure.vs-item", null, h("div.vs-ph", { "data-clip": "1" }, img(it.image, base, null, `#versatility.${i + 1}.image`)),
          has(it.label) ? h("figcaption.vs-label", { text: it.label, "data-layer": `#versatility.${i + 1}.label` }) : null)))];
    },
    // 디테일·가드: 위 안내 2줄 + 가운데 제품 + 확대 원 3개(점선 원 강조, 점선 연결) + 주의/특징 박스
    detail(s, base, n) {
      const { h, has, nonEmpty } = U();
      const hasZoomXY = (s.zooms || []).some((z) => z && isFinite(z.x) && isFinite(z.y));
      if (!hasZoomXY) { // A3 v5 형식: { title, images[], items[{title, desc, image}] } → 사진 + 제목·설명 묶음 카드
        const ims = nonEmpty([...(Array.isArray(s.images) ? s.images : []), s.image], has);
        const its = nonEmpty(s.items, (it) => it && (has(it.title) || has(it.desc)));
        const k = Math.max(ims.length, its.length);
        if (!k) return null;
        const pairs = Array.from({ length: Math.min(4, k) }, (_, i) => ({ image: (its[i] && its[i].image) || ims[i] || null, title: its[i]?.title || "", desc: its[i]?.desc || "" }));
        return [has(s.title) || has(s.sub) ? h("div.dt-head", null, ml("h2.vs-title", s.title, "#detail.title"), has(s.sub) ? ml("p.vs-sub", s.sub, "#detail.sub") : null) : null,
          h("div.card.card2", null, pairs.map((it, i) => h("div.c2-item", null,
            has(it.image) ? h("div.card-ph", { "data-clip": "1" }, img(it.image, base, null, `#detail.${i + 1}.image`)) : null,
            has(it.title) || has(it.desc) ? h("div.card-text", null, ml("h3.card-title", it.title, `#detail.${i + 1}.title`), ml("p.card-desc", it.desc, `#detail.${i + 1}.desc`)) : null)))];
      }
      if (!has(s.image) && !(s.zooms || []).length) return null;
      const zooms = nonEmpty(s.zooms, (z) => z && (has(z.image) || has(s.image))).slice(0, 3);
      const notes = nonEmpty(s.notes, (x) => x && has(x.title)).slice(0, 2);
      const stage = h("div.dt-stage", null, has(s.image) ? h("div.dt-main", null, img(s.image, base, "dt-img", "#detail.image")) : null);
      stage._zooms = zooms.map((z, i) => ({ ...z, src: z.image || s.image, i }));
      stage._notes = notes;
      stage._base = base;
      return [ml("p.dt-sub", s.sub, "#detail.sub"), stage];
    },
  });

  // 지시선 배치(CHECKPOINT): 점이 왼쪽 절반이면 라벨을 왼쪽에(오른쪽 정렬), 오른쪽이면 오른쪽에. 같은 쪽 라벨이 겹치면 아래로 민다
  // 제품 상자 기준 자르기: 제품이 사진 가로의 60% 이상 차지하도록(원본 1.5배 상한) 이미지를 키워 위치를 정한다
  function cropToSubject(photo, W) {
    const im = photo.querySelector("img"); if (!im || !im.naturalWidth) return null;
    const nw = im.naturalWidth, nh = im.naturalHeight;
    let b = photo._bbox;
    if (Array.isArray(b) && b.length === 4) b = { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] };
    else if (b && b.w > 1) b = { x: b.x / nw, y: b.y / nh, w: b.w / nw, h: b.h / nh }; // 픽셀 단위 bbox
    b = b || (window.__subjectBoxes || {})[im.dataset.src] || null;
    const pw = W;
    if (!b) { const ph = Math.max(Math.round(W * 0.6), Math.min(1100, Math.round(W * nh / nw))); photo.style.height = ph + "px"; return { sc: Math.max(pw / nw, ph / nh), ox: (pw - nw * Math.max(pw / nw, ph / nh)) / 2, oy: (ph - nh * Math.max(pw / nw, ph / nh)) / 2, nw, nh, b: null }; }
    // 보일 가로 폭(원본 픽셀): 제품 폭 / 0.65, 단 원본 1.5배 넘게 키우지 않게 W/1.5 이상, 원본 폭 이하
    let cw = Math.min(nw, Math.max(b.w * nw / 0.65, pw / 1.5));
    const sc = pw / cw;
    // 높이: 제품 높이 + 위아래 여백(지시선 라벨 자리) — 사진 비율 안에서, 화면 기준 폭×0.75 ~ 1100
    let ch = Math.min(nh, Math.max(b.h * nh / 0.5, (pw * 0.95) / sc)); // 제품 위아래로 지시선 라벨 자리(제품 높이의 2배, 최소 폭×0.95)
    const ph = Math.min(1100, Math.round(ch * sc)); ch = ph / sc;
    const cx = (b.x + b.w / 2) * nw, cy = (b.y + b.h / 2) * nh;
    const x0 = Math.max(0, Math.min(nw - cw, cx - cw / 2)), y0 = Math.max(0, Math.min(nh - ch, cy - ch / 2));
    photo.style.height = ph + "px";
    Object.assign(im.style, { position: "absolute", width: Math.round(nw * sc) + "px", height: Math.round(nh * sc) + "px", left: Math.round(-x0 * sc) + "px", top: Math.round(-y0 * sc) + "px", objectFit: "fill", maxWidth: "none", maxHeight: "none" });
    return { sc, ox: -x0 * sc, oy: -y0 * sc, nw, nh, b };
  }
  function placeCallouts(photo, W) {
    const im = photo.querySelector("img"); if (!im || !im.naturalWidth) return;
    const g = cropToSubject(photo, W) || {};
    const pw = photo.clientWidth, ph = photo.clientHeight;
    const dw = im.naturalWidth * g.sc, dh = im.naturalHeight * g.sc, ox = g.ox, oy = g.oy;
    // 좌표가 없는 지시선: 제품 상자 둘레(안쪽 18%)에 왼쪽 위·오른쪽 위·왼쪽 아래·오른쪽 아래·가운데 아래 순으로 둔다(정확한 부위는 A2 vision 좌표가 있을 때만)
    const bb = g.b || { x: 0.3, y: 0.35, w: 0.4, h: 0.4 };
    const AUTO = [[0.18, 0.2], [0.82, 0.22], [0.15, 0.62], [0.85, 0.66], [0.55, 0.9], [0.4, 0.4]];
    let ai = 0;
    for (const c of photo._callouts) if (c.auto) { const [ax, ay] = AUTO[ai++ % AUTO.length]; c.x = bb.x + ax * bb.w; c.y = bb.y + ay * bb.h; }
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "cp-lines"); svg.setAttribute("width", pw); svg.setAttribute("height", ph);
    const items = photo._callouts.map((c, i) => ({ c, i, x: ox + c.x * dw, y: oy + c.y * dh }));
    // 라벨 폭을 먼저 재서 쪽을 정한다: 점이 왼쪽 절반이면 왼쪽, 단 왼쪽에 라벨 자리가 없으면(가장자리 점) 오른쪽으로
    const probe = document.createElement("div"); probe.className = "cp-label"; photo.append(probe);
    for (const p of items) {
      probe.innerHTML = ""; const a1 = document.createElement("span"); a1.className = "cl-small"; a1.textContent = p.c.label_small || ""; const a2 = document.createElement("span"); a2.className = "cl-bold"; a2.textContent = p.c.label_bold || p.c.label || "";
      probe.append(a1, a2); const lw = probe.offsetWidth;
      p.side = p.x < pw / 2 ? "L" : "R"; p.lw0 = lw; // 라벨은 점과 같은 쪽 가장자리(선이 엇갈리지 않게)
    }
    probe.remove();
    const placed = []; // 이미 놓인 라벨 사각형(양쪽 공통) — 서로 겹치지 않게
    const hit = (r) => placed.find((q) => r.x < q.x + q.w + 10 && q.x < r.x + r.w + 10 && r.y < q.y + q.h + 10 && q.y < r.y + r.h + 10);
    for (const side of ["L", "R"]) {
      const g = items.filter((p) => p.side === side).sort((a, b) => a.y - b.y);
      let lastBottom = -1e9;
      for (const p of g) {
        const el = document.createElement("div"); el.className = "cp-label" + (side === "L" ? " left" : " right");
        if (p.c.label_small) { const sm = document.createElement("span"); sm.className = "cl-small cap"; sm.textContent = p.c.label_small; sm.dataset.layer = `#checkpoint.${p.i + 1}.label_small`; el.append(sm); }
        const bd = document.createElement("span"); bd.className = "cl-bold"; bd.textContent = p.c.label_bold || p.c.label || ""; bd.dataset.layer = `#checkpoint.${p.i + 1}.label_bold`; el.append(bd);
        photo.append(el);
        const lw = el.offsetWidth, lh = el.offsetHeight, GAP = 70;
        // 가로 자리: 사진 가장자리 쪽(Moast 처럼 라벨은 바깥, 선이 제품으로 들어간다). 점과 너무 가까우면 점 바깥쪽으로
        let lx = side === "L" ? Math.max(24, Math.min(p.x - GAP - lw, 40)) : Math.min(pw - 24 - lw, Math.max(p.x + GAP, pw - 40 - lw));
        // 세로 자리: 같은 쪽 라벨들을 점 높이 순서대로 고르게 나눈 칸에(점이 한데 몰려 있어도 라벨은 퍼진다)
        const gi = g.indexOf(p), top0 = Math.max(24, Math.min(...g.map((q) => q.y)) - ph * 0.45), span = Math.max(lh * g.length + 14 * g.length, ph - 16 - top0);
        let ly = g.length === 1 ? p.y - lh / 2 : top0 + (span - lh) * (gi / (g.length - 1));
        ly = Math.max(16, ly); if (ly < lastBottom + 14) ly = lastBottom + 14; ly = Math.min(ly, ph - lh - 16);
        // 라벨이 자기 점을 덮으면(점이 가장자리 가까이) 점 아래(자리 없으면 위)로 옮긴다
        if (p.x > lx - 10 && p.x < lx + lw + 10 && p.y > ly - 10 && p.y < ly + lh + 10) ly = p.y + 46 + lh <= ph - 8 ? p.y + 46 : Math.max(8, p.y - 46 - lh);
        // 다른 쪽 라벨과 겹치면 아래로, 바닥에 닿으면 위로 옮긴다
        for (let guard = 0; guard < 20; guard++) { const q = hit({ x: lx, y: ly, w: lw, h: lh }); if (!q) break; const down = q.y + q.h + 12; ly = down + lh <= ph - 8 ? down : Math.max(8, q.y - lh - 12); }
        placed.push({ x: lx, y: ly, w: lw, h: lh });
        lastBottom = ly + lh;
        el.style.left = lx + "px"; el.style.top = ly + "px";
        const line = document.createElementNS(NS, "path"); line.setAttribute("class", "cp-line");
        const inside = p.x > lx - 20 && p.x < lx + lw + 20; // 점이 라벨 가로 범위 안 → 라벨 위/아래에서 세로로
        if (inside) {
          const ax = Math.max(lx + 14, Math.min(lx + lw - 14, p.x)), ay = p.y > ly + lh / 2 ? ly + lh + 6 : ly - 6;
          line.setAttribute("d", `M${ax} ${ay} L${ax} ${(ay + p.y) / 2} L${p.x} ${p.y}`);
        } else {
          const ax = side === "L" ? lx + lw + 10 : lx - 10, ay = ly + lh / 2;
          const mx = side === "L" ? Math.min(p.x - 18, ax + 26) : Math.max(p.x + 18, ax - 26);
          line.setAttribute("d", `M${ax} ${ay} L${mx} ${ay} L${p.x} ${p.y}`);
        }
        svg.append(line);
        const dot = document.createElementNS(NS, "circle"); dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); dot.setAttribute("r", 4.5); dot.setAttribute("class", "cp-dot"); svg.append(dot);
      }
    }
    photo.append(svg);
  }

  // 디테일 배치: 가운데 제품, 확대 원은 왼쪽 2·오른쪽 1(또는 번갈아), 점선으로 제품 위 점과 연결. 주의 박스는 빈 쪽에
  function layoutDetail(stage, W) {
    const { h, srcUrl } = U();
    const main = stage.querySelector(".dt-main img");
    const sw = stage.clientWidth, R = 122; // 원 반지름
    const zooms = stage._zooms || [], notes = stage._notes || [];
    const left = zooms.filter((_, i) => i % 3 !== 2), right = zooms.filter((_, i) => i % 3 === 2);
    const mr = main ? main.getBoundingClientRect() : null, sr = stage.getBoundingClientRect();
    const mx = mr ? mr.left - sr.left : sw / 2, my = mr ? mr.top - sr.top : 0, mw = mr ? mr.width : 0, mh = mr ? mr.height : 0;
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "dt-lines");
    const place = (z, cx, cy) => {
      const c = h("div.zoom", { "data-layer": `#detail.zoom.${z.i + 1}`, "data-src": String(z.src || "") });
      const zm = Number(z.zoom) || 2.4, fx = isFinite(z.fx) ? z.fx : z.x, fy = isFinite(z.fy) ? z.fy : z.y; // 원 안에 보일 지점(원본 비율)
      c.style.cssText = `left:${cx - R}px;top:${cy - R}px;width:${2 * R}px;height:${2 * R}px;background-image:url("${srcUrl(z.src, stage._base)}");background-size:${zm * 100}% auto;background-position:${(fx || 0.5) * 100}% ${(fy || 0.5) * 100}%`;
      c.append(h("i.ring"));
      stage.append(c);
      if (mr && isFinite(z.x) && isFinite(z.y)) { // 제품 위 점과 점선
        const px = mx + z.x * mw, py = my + z.y * mh, ex = cx + (px > cx ? R : -R) * 0.92, ey = cy;
        const l = document.createElementNS(NS, "path"); l.setAttribute("class", "dt-line"); l.setAttribute("d", `M${ex} ${ey} L${(ex + px) / 2} ${ey} L${(ex + px) / 2} ${py} L${px} ${py}`); svg.append(l);
        const d = document.createElementNS(NS, "circle"); d.setAttribute("cx", px); d.setAttribute("cy", py); d.setAttribute("r", 5); d.setAttribute("class", "dt-dot"); svg.append(d);
      }
      if (z.label) { const lb = h("div.zoom-label.cap", { text: z.label }); lb.style.left = (cx - R) + "px"; lb.style.top = (cy + R + 10) + "px"; lb.style.width = 2 * R + "px"; stage.append(lb); }
    };
    const H = stage.clientHeight;
    // 왼쪽 원은 위쪽 두 자리(아래는 두 번째 박스 자리), 오른쪽 원은 아래쪽(위는 첫 박스 자리)
    left.forEach((z, k) => place(z, 24 + R, left.length === 1 ? H * 0.3 : H * (k ? 0.56 : 0.2)));
    right.forEach((z) => place(z, sw - 24 - R, H * 0.66));
    // 주의·특징 박스: 오른쪽 위, (두 번째는) 왼쪽 아래
    notes.forEach((nt, i) => {
      const box = h("div.dt-note" + (i ? ".bottom-left" : ".top-right"), null, h("h3.dt-note-title", { text: nt.title, "data-layer": `#detail.note.${i + 1}.title` }), ...(lines(nt.desc).length ? [ml("p.dt-note-desc.cap", nt.desc, `#detail.note.${i + 1}.desc`)] : []));
      stage.append(box);
    });
    svg.setAttribute("width", sw); svg.setAttribute("height", H); stage.prepend(svg);
  }

  // ----- commerce 테마(쿠팡 레퍼런스 문법): 브랜드 색 1개 · 키커 알약 · 2줄 제목 둘째 줄 브랜드 색 · 흰↔진남 교대 -----
  function commerceSetup(root, plan) {
    const sg = plan?.meta?.styleGuide || {}, pal = plan?.meta?.palette || {};
    const rgb = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(x || "").trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const con = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const sat = (c) => (Math.max(...c) - Math.min(...c)) / 255;
    // 브랜드 색: styleGuide accent / accents / palette 중 채도 0.35 이상 첫 색, 없으면 로열 블루
    const cands = [sg.accent, ...(Array.isArray(sg.accents) ? sg.accents : []), pal.accent, ...(Array.isArray(pal.dominant) ? pal.dominant : [])].map(rgb).filter(Boolean);
    let brand = cands.find((c) => sat(c) >= 0.35) || rgb("#1f3cf5");
    const W = [255, 255, 255], NAVY = rgb("#2c2f36"); // 어두운 바탕 중 가장 밝은 것(문제 제기 띠) 기준
    let ink = brand; for (let t = 0; con(ink, W) < 4.6 && t < 1; t += 0.05) ink = brand.map((v) => v * (1 - t));              // 흰 바탕 글자용
    let light = brand; for (let t = 0; con(light, NAVY) < 4.6 && t < 1; t += 0.05) light = brand.map((v) => v + (255 - v) * t); // 진남 바탕 글자용
    const st = document.documentElement.style;
    st.setProperty("--cm-brand", hex(brand)); st.setProperty("--cm-ink", hex(ink)); st.setProperty("--cm-light", hex(light));
    st.setProperty("--cm-on-brand", con(W, brand) >= 4.5 ? "#ffffff" : "#0e1730");
    // 히어로 사진 위 글자: 사진 바탕색과 4.6:1 이 안 되면 브랜드 색을 더 어둡게(그래도 안 되면 검정)
    const ht = root.querySelector(".hero-text"), hb = ht && rgb(ht.dataset.bg);
    if (ht && hb) { let hi2 = ink; for (let t = 0; con(hi2, hb) < 4.6 && t < 1; t += 0.05) hi2 = ink.map((v) => v * (1 - t)); ht.style.setProperty("--cm-ink", hex(hi2)); }
    // 2줄 제목의 둘째 줄을 브랜드 색으로(plan emph 가 없을 때의 기본 강조 — 섹션당 1개)
    for (const t of root.querySelectorAll(".card-title, .ba-title, .cp-title, .vs-title, .hero-name, .cta-head")) {
      if (t.querySelector(".em")) continue;
      const br = t.querySelector("br"); if (!br) continue;
      const span = document.createElement("span"); span.className = "cm-line2";
      while (br.nextSibling) span.append(br.nextSibling);
      t.append(span);
    }
    // 섹션 명도 교대: 흰 ↔ 진남(feature 계열은 번갈아), 문제 제기(before_after 머리)는 어둡게, 주의는 검정, FAQ 연회색
    let k = 0;
    for (const sec of root.querySelectorAll("section[data-sec]")) {
      const t = sec.dataset.sec;
      if (t === "feature" || t === "feature2" || t === "options" || t === "detail") sec.dataset.cm = k++ % 2 ? "navy" : "white";
      else if (t === "notice") sec.dataset.cm = "black";
      else if (t === "faq") sec.dataset.cm = "gray";
      else sec.dataset.cm = "white";
    }
    for (const c of root.querySelectorAll(".notice .checks .chk")) c.textContent = "×";
    for (const im of root.querySelectorAll(".card-ph img")) if (im.naturalWidth) { im.style.maxWidth = Math.round(im.naturalWidth * 1.5) + "px"; im.style.margin = "0 auto"; im.parentElement.style.background = "transparent"; } // 원본 1.5배 상한(카드 여백이 없어 넓어진 만큼) // 주의 목록은 × 표시
    // 키커 알약 숫자: POINT 01 → POINT 1
    for (const kk of root.querySelectorAll(".en-kicker")) kk.textContent = kk.textContent.replace(/POINT 0?(\d+)/, "POINT $1");
  }
  // ----- branden 테마(국내 브랜드 미니멀 레퍼런스): 흰 바탕 · 글→사진 교대 · 왼쪽 정렬 — 글이 사진 위에 얹히지 않게 순서만 바꾼다 -----
  function brandenSetup(root, W, opt = { hero: true, detail: true }) {
    const hero = root.querySelector("section.hero"), hs = hero && hero.querySelector(".hero-scene");
    if (hs && opt.hero) {
      const t = hs.querySelector(".hero-text"), band = hero.querySelector(".icon-band"), hi = hs.querySelector("img");
      if (t) hero.insertBefore(t, hs); if (band && opt.band !== false) hero.insertBefore(band, hs); // 제목 3줄 → 회색 한 줄(아이콘 띠 글자) → 사진
      if (band) for (const b of band.querySelectorAll(".ib-text br")) b.replaceWith(" "); // 2줄 라벨 → 한 줄
      const textH = (t ? t.offsetHeight : 0) + (band ? band.offsetHeight : 0), ratio = hi && hi.naturalWidth ? hi.naturalHeight / hi.naturalWidth : 1;
      hs.style.height = Math.max(Math.round(W * 0.55), Math.min(1098 - Math.ceil(textH), Math.round(W * ratio))) + "px"; // 히어로 전체 ≤ 1100
    }
    // 디테일: 사진이 항목보다 적으면 사진은 위에 꽉 차게, 글(라벨 + 2줄)은 아래 2열 / 모두 있으면 2×2 사진 격자
    if (opt.detail) for (const card of root.querySelectorAll(".detail .card2")) {
      const its = [...card.querySelectorAll(":scope > .c2-item")], ph = its.filter((it) => it.querySelector(".card-ph"));
      if (ph.length === its.length && its.length >= 2) { card.classList.add("bd-grid"); continue; }
      for (const it of ph) card.parentNode.insertBefore(it.querySelector(".card-ph"), card);
      card.classList.add("bd-texts");
    }
    // 한 줄 라벨 목록(아이콘 띠·활용 칩)이 줄바꿈되면 새 줄 첫 항목의 구분선(|)은 뺀다
    for (const row of root.querySelectorAll(".hero .icon-band, .vs-chips")) { let top = null; for (const it of row.children) { it.classList.toggle("bd-wrap", top !== null && it.offsetTop > top + 4); top = it.offsetTop; } }
  }
  // ----- custom 테마(레퍼런스 자동 템플릿): plan.meta.refTokens → CSS 변수 --rf-* + body data-rf-* (themes/custom.css) -----
  const RF_ENUM = { align: ["center", "left"], kicker: ["none", "pill-dark", "pill-brand", "text"], bands: ["none", "alternate"], problem: ["dark-bubble", "plain", "panel"], photo: ["full", "rounded", "card"],
    emph: ["line-color", "weight", "underline", "none"], icons: ["brand-fill", "light", "text-line", "none"], panel: ["lines", "gray", "cards"], hero: ["on-photo", "above"], notice: ["dark", "same"] };
  const refTokens = (plan) => plan?.meta?.refTokens || {};
  function customSetup(root, plan, W) {
    const tk = refTokens(plan), c = tk.colors || {};
    const rgb = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(x || "").trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const hex = (v) => "#" + v.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
    const lum = (v) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]); };
    const con = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const toward = (v, to, bg) => { let o = v; for (let t = 0; con(o, bg) < 4.6 && t <= 1; t += 0.05) o = v.map((x, i) => x + (to[i] - x) * t); return o; }; // 대비 4.6:1 될 때까지 검정/흰색 쪽으로
    const bg = rgb(c.bg) || [255, 255, 255], dark = rgb(c.dark) || [28, 31, 38], K = [0, 0, 0], Wt = [255, 255, 255];
    const ink = toward(rgb(c.ink) || [17, 20, 24], K, bg), ink2 = toward(rgb(c.ink2) || [92, 99, 112], lum(bg) > 0.4 ? K : Wt, bg);
    const brand = rgb(c.brand) || ink;
    const st = document.documentElement.style, set = (k, v) => st.setProperty(k, v);
    set("--rf-bg", hex(bg)); set("--rf-ink", hex(ink)); set("--rf-ink2", hex(ink2)); set("--rf-brand", hex(brand));
    set("--rf-brand-ink", hex(toward(brand, lum(bg) > 0.4 ? K : Wt, bg))); set("--rf-brand-light", hex(toward(brand, Wt, dark)));
    set("--rf-on-brand", con(Wt, brand) >= 4.5 ? "#ffffff" : "#111418");
    set("--rf-dark", hex(dark)); set("--rf-dark2", hex(rgb(c.dark2) || dark)); set("--rf-on-dark", "#ffffff"); set("--rf-on-dark2", hex(toward([201, 204, 211], Wt, dark)));
    if (rgb(c.panel)) set("--rf-panel", c.panel); if (rgb(c.line)) set("--rf-line", c.line); if (rgb(c.kicker)) set("--rf-kicker-bg", c.kicker);
    const sp = { tight: [56, 40], normal: [88, 46], airy: [136, 66] }[tk.spacing] || [88, 46];
    set("--rf-pad-y", sp[0] + "px"); set("--rf-pad-x", (tk.align === "left" ? sp[1] : Math.min(sp[1], 46)) + "px");
    if (isFinite(tk.title_size)) set("--rf-title", Math.max(34, Math.min(56, Math.round(tk.title_size))) + "px");
    if (isFinite(tk.title_weight)) set("--rf-title-w", String(Math.max(500, Math.min(900, Math.round(tk.title_weight / 100) * 100))));
    if (isFinite(tk.radius)) set("--rf-radius", Math.max(0, Math.min(36, Math.round(tk.radius))) + "px");
    for (const [k, list] of Object.entries(RF_ENUM)) document.body.dataset["rf" + k[0].toUpperCase() + k.slice(1)] = list.includes(tk[k]) ? tk[k] : list[0];
    // 2줄 제목 둘째 줄 = 강조 줄(commerce 와 같은 방식)
    if (tk.emph !== "none") for (const t of root.querySelectorAll(".card-title, .ba-title, .cp-title, .vs-title, .hero-name, .cta-head")) {
      if (t.querySelector(".em")) continue; const b = t.querySelector("br"); if (!b) continue;
      const span = document.createElement("span"); span.className = "cm-line2"; while (b.nextSibling) span.append(b.nextSibling); t.append(span);
    }
    // 명도 교대: feature 계열만 번갈아 어둡게
    let k = 0;
    for (const sec of root.querySelectorAll("section[data-sec]")) {
      const t = sec.dataset.sec;
      if (tk.bands === "alternate" && ["feature", "feature2", "options", "detail"].includes(t)) sec.dataset.rf = k++ % 2 ? "dark" : "light";
      else sec.dataset.rf = "light";
    }
    if (tk.notice === "dark") for (const ch of root.querySelectorAll(".notice .checks .chk")) ch.textContent = "×";
    for (const kk of root.querySelectorAll(".en-kicker")) kk.textContent = kk.textContent.replace(/POINT 0?(\d+)/, "POINT $1");
    // 글 → 사진 히어로·꽉 찬 사진 디테일은 branden 과 같은 재배치(글이 사진 위에 얹히지 않게)
    if (tk.hero === "above" || tk.photo === "full") brandenSetup(root, W, { hero: tk.hero === "above", detail: tk.photo === "full", band: tk.icons === "text-line" }); // 아이콘 띠가 색 띠면 사진 아래 그대로
  }
  async function after(root, plan) {
    const W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--w")) || 860;
    // 스타일 가이드(제품별 디자인 시스템) → CSS 변수
    const sg = plan?.meta?.styleGuide || {}, pal = plan?.meta?.palette || {};
    const st = document.documentElement.style, theme = document.body.dataset.theme || "ivory";
    // 제품 스타일 가이드 색은 ivory(기본)에서만 그대로 쓴다 — 다른 테마는 테마 색이 우선(대비 보장)
    if (theme === "ivory") {
      if (sg.background || pal.bg) st.setProperty("--c-bg", sg.background || pal.bg);
      if (sg.text) st.setProperty("--c-ink", sg.text);
      if (sg.accent && /^#[0-9a-f]{6}$/i.test(sg.accent)) st.setProperty("--c-brown", sg.accent);
      if (sg.highlight) st.setProperty("--c-yellow", sg.highlight);
    }
    if (theme === "studio") { // 팔레트 그라데이션 배경
      const d = Array.isArray(pal.dominant) ? pal.dominant : [];
      if (d[0]) st.setProperty("--s-grad-a", d[0]); if (d[1]) st.setProperty("--s-grad-b", d[1]);
    }
    // 섹션 상단 작은 영문 키커(editorial 등 테마가 보이게 한다)
    const KICK = { trust_badges: "TRUST", cert: "CERTIFIED", review_stat: "REVIEW", before_after: "BEFORE & AFTER", checkpoint: "CHECK POINT", versatility: "STYLING", detail: "DETAIL", options: "OPTION", spec: "INFORMATION", notice: "NOTICE", faq: "Q & A", package: "PACKAGE", size: "SIZE" };
    let fn = 0;
    for (const sec of root.querySelectorAll("section[data-sec]")) {
      const t = sec.dataset.sec; let k = t === "feature" || t === "feature2" ? `POINT ${String(++fn).padStart(2, "0")}` : KICK[t];
      if (sec._plan && U().has(sec._plan.kicker)) k = String(sec._plan.kicker); // plan 이 준 키커(POINT 1 / Difference 1 …)
      if (k) { const e = U().h("div.en-kicker.deco", { text: k }); sec.prepend(e); }
    }
    // 히어로: 사진 위쪽이 밝은 벽이면 글자를 사진 위에. 세로 사진은 꽉 차게(2:3, ≤ 1100-띠), 정사각·가로 사진은 아래에 두고 위를 벽색으로 늘린다
    const hero = root.querySelector("section.hero"), hs = hero && hero.querySelector(".hero-scene"), hi = hs && hs.querySelector("img");
    if (theme === "branden") brandenSetup(root, W); // 글을 사진 밖(위)으로 — 아래 사진 위 글자 맞춤은 건너뜀
    const textAbove = theme === "branden" || (theme === "custom" && refTokens(plan).hero === "above"); // 히어로 글이 사진 밖(위)
    if (theme === "custom") customSetup(root, plan, W);
    if (hs && !textAbove) {
      const band = hero.querySelector(".icon-band"), bandH = band ? band.offsetHeight : 0;
      const boxH = Math.min(Math.round(W * 1.5), 1100 - bandH);
      hs.style.height = boxH + "px";
      if (hi && hi.naturalWidth) {
        const ratio = hi.naturalHeight / hi.naturalWidth;
        if (ratio < 1.3) { // 정사각·가로: 아래쪽에 두고 위는 벽색 + 부드러운 이음
          hs.classList.add("extend");
          const ih = Math.min(Math.round(boxH * 0.68), Math.round(hi.naturalHeight * 1.5)), iw = Math.round(ih / ratio);
          Object.assign(hi.style, { width: Math.min(iw, W) + "px", height: ih + "px" });
          const bg = (window.__edgeColors || {})[hi.dataset.src + "#top"] || U().edgeColor(hi) || "#efebe4";
          hs.style.background = bg;
          const t = hs.querySelector(".hero-text"); if (t) { t.dataset.bg = toHex(bg); pickInk(t, toHex(bg)); }
        }
      }
    }
    // CHECKPOINT 사진 높이 = 폭 × 사진 비율(4:3 → 0.75, 1:1 → 1, 2:3 → 1.5), 상한 1100 · 하한 폭×0.6 — 지시선은 그 뒤에 배치
    // 비포/애프터 사진(1장): 자르지 않고 사진 비율대로 높이 = 폭 × h/w (상한 1000)
    for (const p of root.querySelectorAll(".ba-photo:not(.two)")) {
      const im = p.querySelector("img"); if (!im || !im.naturalWidth) continue;
      const hh = Math.min(1000, Math.round(W * im.naturalHeight / im.naturalWidth));
      p.style.height = hh + "px";
      Object.assign(im.style, { width: "100%", height: hh + "px", maxHeight: "none", objectFit: "cover", objectPosition: "50% 50%" });
    }
    // 히어로 글자는 사진 상단 여백(높이 35%) 안에만: 넘치면 글자 크기를 함께 줄인다(최소 60%), 그래도 넘치면 위 여백을 줄인다
    if (hs && !textAbove) {
      const t = hs.querySelector(".hero-text");
      if (t) {
        const lim = hs.clientHeight * 0.35, kids = [...t.children];
        const base = kids.map((k) => parseFloat(getComputedStyle(k).fontSize));
        let sc = 1;
        while (t.offsetTop + t.offsetHeight > lim && sc > 0.6) { sc -= 0.04; kids.forEach((k, i) => { k.style.fontSize = Math.max(22, Math.round(base[i] * sc)) + "px"; }); }
        if (t.offsetTop + t.offsetHeight > lim) t.style.top = Math.max(16, lim - t.offsetHeight) + "px";
        t.dataset.fit = String(+sc.toFixed(2));
      }
    }
    if (document.body.dataset.theme === "commerce") commerceSetup(root, plan);
    // 제품이 잘리지 않게: 잘리는(cover) 사진은 제품 상자(bbox)가 보이는 쪽으로 위치를 잡는다. bbox 가 없으면 아래쪽 기준(상단 빈 벽을 덜어냄)
    const SB = Object.assign({}, window.__subjectBoxes || {});
    for (const sp of plan?.sections || []) { // plan 의 focus(제품 상자, 0~1)가 추정보다 우선
      const f = sp && sp.focus; if (!f || !isFinite(f.y) || !isFinite(f.h)) continue;
      for (const v of [sp.image, ...(Array.isArray(sp.images) ? sp.images : [])]) if (typeof v === "string") SB[v] = { x: +f.x || 0, y: +f.y, w: +f.w || 1, h: +f.h };
    }
    const placeY = (img, boxH, opts = {}) => {
      if (!img || !img.naturalWidth) return;
      const bw = img.clientWidth || W, dh = bw * img.naturalHeight / img.naturalWidth;
      if (dh <= boxH + 1) return;
      const b = SB[img.dataset.src];
      let off;
      if (b) {
        const top = b.y * dh, bot = (b.y + b.h) * dh, pad = 24;
        const need = bot + pad - boxH;                       // 이만큼은 위를 잘라야 제품 아래 끝이 보인다
        const allow = top - (opts.textTop ? boxH * 0.38 : pad); // 이보다 더 자르면 제품 위 끝(히어로는 글자 자리 아래)이 잘린다
        off = need <= allow ? Math.max(need, Math.min(allow, opts.textTop ? allow : need)) : need; // 둘 다 안 되면 제품 아래 끝 우선
      } else off = dh - boxH;                              // 아래쪽 기준
      off = Math.max(0, Math.min(dh - boxH, off));
      img.style.objectPosition = `50% ${((off / (dh - boxH)) * 100).toFixed(1)}%`;
    };
    if (hs && hi && !hs.classList.contains("extend")) placeY(hi, hs.clientHeight, { textTop: !textAbove });
    for (const im of root.querySelectorAll(".card-ph img")) if (im.naturalWidth) { const box = im.getBoundingClientRect().height; if (getComputedStyle(im).objectFit === "cover") placeY(im, box); }
    for (const p of root.querySelectorAll(".cp-photo")) { if (p._callouts?.length) placeCallouts(p, W); else cropToSubject(p, W); }
    for (const st2 of root.querySelectorAll(".dt-stage")) layoutDetail(st2, W);
  }
  // 사진 톤에 맞는 글자색: 기본 다크 그레이 → 대비 4.5 미만이면 더 짙게 → 그래도 안 되면 흰색
  function pickInk(el, bgHex) {
    const rgb = (x) => { const n = parseInt(String(x).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const con = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    if (!/^#[0-9a-f]{6}$/i.test(bgHex)) return;
    const ink = ["#3a3634", "#26221f", "#161412", "#ffffff"].find((c) => con(c, bgHex) >= 4.6) || "#ffffff";
    el.style.setProperty("--hero-ink", ink);
  }
  const toHex = (c) => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || ""); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("") : String(c || ""); };

  window.TEMPLATE = { id: "card", noEmoji: true, defaultWidth: 860, builders, after,
    labels: { spec: "제품 정보", notice: "구매 전 확인해 주세요", faq: "자주 묻는 질문", size: "사이즈", package: "구성" } };
  // 테마: plan.meta.theme → themes/<theme>.css 를 붙인 뒤 그린다(레이아웃·섹션·사진은 같고 느낌만 바뀜)
  const THEMES = ["ivory", "clean", "dark", "pop", "editorial", "studio", "commerce", "branden", "custom"];
  async function loadTheme(theme) {
    document.body.dataset.theme = theme;
    const old = document.getElementById("theme-css"); if (old) old.remove();
    if (theme === "ivory") return; // 기본(style.css)
    const link = document.createElement("link"); link.id = "theme-css"; link.rel = "stylesheet"; link.href = `../card/themes/${theme}.css`; // card·localize 둘 다 같은 테마 파일
    await new Promise((res) => { link.onload = res; link.onerror = res; document.head.append(link); });
  }
  window.renderPlan = async (plan, baseUrl) => {
    const m = plan?.meta || {};
    const theme = THEMES.includes(m.theme) ? m.theme : THEMES.includes(m.templateId) ? m.templateId : "ivory";
    await loadTheme(theme);
    return window.SeedhackRender.render(plan, baseUrl);
  };
})();
