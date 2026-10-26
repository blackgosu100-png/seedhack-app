// 💡 키워드 추천 — "🔍 AI 소싱 시작" 버튼 하나. 묻는 것 없이 시작하고, 고르는 것은 전부 결과를 본 뒤에 한다(초보·경험자 같은 화면).
// 흐름: 시작 화면(큰 버튼 + 분석 규모) → 해커 화면(깔때기: 단계별 실제 개수·빠진 이유) → 결과(세 묶음) + 위쪽 조절 줄
//  · 조절 줄: 예산 칩 · 안전 필터 칩(기본 켜짐, 끄면 경험자용) · 🔒 항상 제외 · 경쟁 조건 ▾ · 계절 상품
//  · 마지막 설정을 기억한다(이 PC 화면 편의용). 계산은 메인(kw-combo.js scan), 판정(GO/DROP)은 내지 않는다 — 참고 지표만
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = (n) => Math.round(n || 0).toLocaleString("ko-KR");
  const man = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}만` : won(n));
  const pct = (r) => `${Math.round((r || 0) * 100)}%`;
  const SHOW = 8;
  // 월매출 표시: 4억 9,681만원 / 2,953만원
  const eok = (n) => { const m = Math.round((n || 0) / 1e4); return m >= 10000 ? `${Math.floor(m / 10000)}억${m % 10000 ? ` ${(m % 10000).toLocaleString("ko-KR")}만` : ""}원` : `${m.toLocaleString("ko-KR")}만원`; };
  const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
  const imgUrl = (s) => (!s ? "" : /^https?:/.test(s) ? s : IMG + s);

  const BUDGETS = [[0, "전체"], [500000, "50만원"], [1000000, "100만원"], [3000000, "300만원"], [10000000, "1,000만원+"]];
  const GROUPS = [
    { id: "start", ic: "🚀", ko: "바로 시작하기 좋은 상품", why: "1등 리뷰 1,000개 이하 · 평균 4만원 이하라 원가 부담이 적어요" },
    { id: "weak", ic: "📍", ko: "경쟁이 약한 상품", why: "빠른배송 판매자 20% 이하 · 1등 리뷰 500개 이하 · 평균 6만원 이하인 빈자리예요" },
    { id: "rising", ic: "📈", ko: "요즘 뜨는 상품", why: "다음 달 검색이 30% 넘게 늘 것으로 보이고, 1등 리뷰 3,000개 이하라 아직 꽉 차지 않았어요" },
  ];
  const ORDER = ["grow", "rocket", "ov", "review", "trend", "price"];
  const PLAIN = { grow: "빠른배송 판매자", rocket: "쿠팡 직접 판매", ov: "해외배송 상품", review: "1등 상품 리뷰 수", trend: "검색 추세", price: "평균 가격" };
  let AX = {}, SAFE = {};

  // 기억하는 설정(실패해도 기본값으로 동작)
  const DEF = { budget: 0, safe: { cert: true, big: true, craft: true, tools: true, apparel: true }, noSeason: true, cond: {}, mode: "easy" }; // tools: 메인(kw-combo SAFE)과 같은 5개 — 빠져 있으면 칩은 꺼진 듯 보이는데 실제로는 빠지고 있었음
  // 🧭 추천 기준(B안, 2026-10-12): 처음이에요 = 경쟁 약한 곳 · 팔아봤어요 = 이미 팔리는 시장의 빈자리. 마지막에 고른 쪽을 기억(opt.mode)
  const MODES = {
    easy: { ko: "처음이에요", qty: 80, h: "내 첫 상품, AI가 찾아드려요" },
    pro: { ko: "팔아봤어요", qty: 300, h: "잘 팔리는 시장에서 빈자리를 찾아드려요" },
  };
  const md = () => MODES[opt.mode] || MODES.easy;
  const proGot = () => got?.items?.[0]?.mode === "pro"; // 지금 보고 있는 묶음이 팔아봤어요로 받은 것인지(지난 묶음도 그때 기준으로 보여 줌)
  let opt = (() => { try { const o = JSON.parse(localStorage.getItem("recoOpt") || "null"); return o ? { ...DEF, ...o, safe: { ...DEF.safe, ...(o.safe || {}) }, cond: o.cond || {} } : structuredClone(DEF); } catch { return structuredClone(DEF); } })();
  const keep = () => { try { localStorage.setItem("recoOpt", JSON.stringify(opt)); } catch {} };

  // 🏆 효자상품: 키워드마다 Wing 검색 1번 → 판매액 상위 5개. 받은 순서대로 도착하는 대로 채운다
  const hy = new Map(); let hyRun = 0, hyDone = 0, hyTotal = 0, hyMs = [], cpDone = 0, cpTotal = 0;
  function hyHtml(kw) {
    const h = hy.get(kw);
    if (!h) return `<div class="hy-wait"><i></i>쿠팡 실판매 불러오는 중…</div>`;
    if (h.error) return `<div class="hy-err">${esc(/로그인|WING/.test(h.error) ? "Wing 로그인이 필요해요 (① Wing 탭)" : h.error)}</div>`;
    if (!h.items.length) return `<div class="hy-err">쿠팡 실판매 지표가 있는 상품이 없어요</div>`;
    return `<div class="hy-sum"><b>효자상품 ${h.items.length}개</b> · 28일 판매 <b>${won(h.top.sales)}</b>개 · 판매액 <b>${man(h.top.rev)}원</b></div>
      <ol class="hy-list">${h.items.map((x) => `<li><span class="nm" title="${esc(x.name)}">${esc(x.name)}</span><span>${won(x.price)}원</span><span>리뷰 ${won(x.reviews)}</span><b>${won(x.sales)}개</b></li>`).join("")}</ol>`;
  }
  function hyProg() {
    const el = $("rpProg"); if (!el) return;
    const done = !hyTotal || hyDone >= hyTotal;
    const avg = hyMs.length ? hyMs.reduce((a, b) => a + b, 0) / hyMs.length : 5000;
    el.innerHTML = `<span>쿠팡 실판매 조회</span><div class="bar"><i style="width:${hyTotal ? Math.round((hyDone / hyTotal) * 100) : 100}%"></i></div><b>${hyDone}/${hyTotal}</b>
      <span>${done && cpDone < cpTotal ? `쿠폰가 확인 중 ${cpDone}/${cpTotal} · 쿠팡 화면에서 실제 판매가를 읽어 카드 숫자를 고쳐요` : done ? "완료 · 정렬 버튼으로 월매출·판매량·리뷰 수 순으로 볼 수 있어요" : `약 ${Math.max(1, Math.round(((hyTotal - hyDone) * Math.max(avg, 4000)) / 1000))}초 남음 · 추천순으로 채우는 중`}</span>`;
  }
  async function startHyoja(items, saved = false) {
    const run = ++hyRun; hyDone = 0; hyTotal = items.length; hyMs = [];
    for (const k of items) {
      if (run !== hyRun) return; // 새로 받으면 이전 조회는 중단
      if (!hy.has(k.kw) || hy.get(k.kw).error) {
        const r = await api.invoke("kw:hyoja", { keyword: k.kw, top: 5, saved }).catch((e) => ({ error: e?.message || String(e) }));
        hy.set(k.kw, r);
        if (r && !r.cached && r.ms) hyMs.push(r.ms);
        if (r?.error && /한도|정지|제한|로그인/.test(r.error)) { hyDone = hyTotal; items.forEach((x) => { if (!hy.has(x.kw)) hy.set(x.kw, { error: r.error }); }); hyProg(); if (started) render(true); return; }
      }
      hyDone++;
      fillSlot(k, items.indexOf(k));
      hyProg();
    }
    if (run === hyRun && started) {
      if (proGot() && sortBy.key === "reco") { sortBy = { key: "gap", dir: -1 }; open4.clear(); render(true); } // 팔아봤어요: 다 채워지면 틈 판매량 순으로 한 번 다시 줄 세움
      else { const sb = root.querySelector(".rp-sort"); if (sb) sb.outerHTML = sortBar(false); else render(); } // 다 채워지면 정렬 버튼만 풀기(자리는 그대로)
    }
    if (run === hyRun) couponPass(items, run); // 기다리지 않음 — 카드가 뜨면 바로 다른 버튼을 쓸 수 있게
  }
  // ② 카드가 다 뜬 뒤: 키워드마다 쿠팡 검색 화면을 1번 열어 쿠폰가로 숫자를 고친다(키워드당 약 4~10초) — 자리는 그대로, 숫자만 바뀜
  async function couponPass(items, run) {
    const todo = items.filter((k) => { const h = hy.get(k.kw); return h?.items?.length && !h.cp; });
    cpDone = 0; cpTotal = todo.length; hyProg();
    for (const k of todo) {
      if (run !== hyRun) return;
      const r = await api.invoke("kw:hyojaCp", { keyword: k.kw, top: 5 }).catch(() => null);
      if (run !== hyRun) return;
      cpDone++;
      if (r && !r.error && r.items) { hy.set(k.kw, r); refreshSlot(k, items); }
      hyProg();
    }
  }
  function refreshSlot(k, items) {
    const list = hyTotal && hyDone < hyTotal ? items : ordered(items), i = list.indexOf(k);
    fillSlot(k, i);
    if (i >= 3 && open4.has(k.kw)) { const el = root.querySelector(`[data-slot="${i}"]`), nx = el?.nextElementSibling; if (nx?.classList.contains("rp-exp")) nx.outerHTML = expHtml(k, i + 1); }
  }

  // ── 받은 10개: 쿠팡 실판매(월매출·상위 상품·틈) + 1688 기준가. 다 채워질 때까지는 받은 순서대로 한 줄씩 채운다 ──
  const money = (h) => { const e = h?.price > 0 ? window.Entry?.forItem(h.price) : null; if (!e || !(e.yuan > 0)) return null; return { price: e.price, yuan: Math.floor(e.yuan), margin: Math.round((e.price * window.Entry.cfg.margin) / 100) * 100 }; };
  // 주의는 데이터로 확인된 것만, 카드당 하나
  const warnOf = (h) => (h.medical ? "판매 상위에 의료기기 신고 상품이 있어요 — 같은 효과를 내세우려면 인증이 필요해요"
    : h.brandShare >= 0.5 ? `월매출의 ${pct(h.brandShare)}가 유명 브랜드(${(h.brandTop || []).join("·")}) 상품이에요`
    : h.top1Share >= 0.5 ? `1등 상품이 월매출의 ${pct(h.top1Share)}를 가져가요` : "");
  const descOf = (k) => (k.ai?.desc ? `<small>${esc(k.ai.desc)}</small>` : "");
  const cpUrl = (x) => `https://www.coupang.com/vp/products/${encodeURIComponent(x.pid)}${x.vid ? `?vendorItemId=${encodeURIComponent(x.vid)}` : ""}`; // 앱 안 쿠팡 탭(새 탭)으로 열림 — main setWindowOpenHandler
  const tile = (x, i, gi) => `<a class="rp-p ${i === gi ? "gapon" : ""}" href="${esc(cpUrl(x))}" target="_blank" title="쿠팡 상품 페이지 열기 — ${esc(x.name)}"><img src="${esc(imgUrl(x.img))}" alt="" loading="lazy"><span class="no">${i + 1}위</span>${x.famous ? `<span class="gapb br" title="키워드 DB에서 브랜드 이름으로 많이 검색되는 브랜드 — 리뷰가 적어도 이름값으로 팔려서 틈으로 보지 않아요">브랜드</span>` : i === gi ? `<span class="gapb" title="리뷰 300개 미만인데 팔리는 상품">틈</span>` : ""}
    <div class="i"><div class="pn" title="${esc(x.name)}">${esc(x.name)}</div><div class="pp">${won(x.price)}원${x.priceSrc === "vid" ? `<small class="nc" title="쿠팡 검색 화면에는 이 상품의 다른 옵션(${won(x.pagePrice)}원)이 떠 있어요. 옵션마다 가격이 달라 Wing 판매가(쿠폰·즉시할인 전)를 썼어요">옵션 다름</small>` : x.priceSrc === "odd" ? `<small class="nc" title="쿠팡 화면에서 읽은 ${won(x.pagePrice)}원이 Wing 판매가와 너무 달라(단위가격 오독 의심) Wing 판매가(쿠폰·즉시할인 전)를 썼어요">확인 필요</small>` : x.priceSrc && x.priceSrc !== "page" && x.priceSrc !== "detail" ? `<small class="nc" title="이 검색어의 쿠팡 화면을 읽지 못해 Wing 판매가(쿠폰·즉시할인 전)를 썼어요">쿠폰 전</small>` : x.listPrice > x.price ? `<s title="Wing 판매가(할인 전)${x.priceSrc === "detail" ? " · 이 옵션의 쿠팡 상품 페이지에서 읽은 가격" : ""}">${won(x.listPrice)}</s>` : ""}</div><div class="kv"><span>판매</span><b>${won(x.sales)}개</b></div><div class="kv"><span>리뷰</span><span>${won(x.reviews)}</span></div></div><span class="go">↗</span></a>`;
  function bigCard(k, i) {
    const h = hy.get(k.kw), m = money(h), w = warnOf(h), g = h.gap;
    const top3 = h.items.slice(0, 3), gi = g ? top3.findIndex((x) => String(x.pid) === String(g.pid) && String(x.vid) === String(g.vid)) : -1;
    const dropT = (h.drop || []).map((d) => `${d.name} (${won(d.sales)}개)`).join("\n");
    return `<article class="rp-card ${i === 0 ? "win" : ""}" style="--i:${i}">
      <span class="rp-src">쿠팡 실판매</span>
      <div><span class="rp-rk">${i + 1}</span><div class="rp-name">${esc(k.kw)}</div>${k.ai?.desc ? `<div class="rp-desc">${esc(k.ai.desc)}</div>` : ""}</div>
      <div class="rp-rev"><span class="lbl">상위 ${h.n}개 상품 월매출</span><b>${eok(h.total.rev)}</b><small>최근 28일 ${won(h.total.sales)}개 판매 · 리뷰 합 ${won(metric(k, "reviews"))}개${h.drop?.length ? ` · <u title="${esc(dropT)}">검색어와 다른 상품 ${h.drop.length}개 뺌</u>` : ""}</small></div>
      <div class="rp-prods">${top3.map((x, j) => tile(x, j, gi)).join("")}</div>
      <div class="rp-rows">
        <div class="rp-row top"><span class="k">틈</span>${g ? `<a class="v rp-gap" href="${esc(cpUrl(g))}" target="_blank" title="쿠팡 상품 페이지 열기"><img src="${esc(imgUrl(g.img))}" alt="">
          <span>리뷰 <b>${won(g.reviews)}개</b>짜리 상품도 28일 <b class="hl">${won(g.sales)}개</b> 판매<small>${gi >= 0 ? `<span class="rkt" data-flash="${gi}" title="위 사진 칸 보기">${gi + 1}위 상품</span>` : ""}${esc(g.name)} · ${won(g.price)}원 ↗</small></span></a>` : `<span class="v dim">${h.gapBrandOnly ? "리뷰 적은데 팔리는 상품은 유명 브랜드뿐이에요" : "리뷰 300개 미만으로 팔리는 상품은 아직 없어요"}</span>`}</div>
        ${k.mode === "pro" && h.top1Sales != null ? `<div class="rp-row"><span class="k">시장</span><span class="v">1등 하루 <b>${won(Math.round(h.top1Sales / 28))}개</b> · 리뷰 500개+ 상품 <b>${won(h.big500)}개</b><small>참고: 1등 하루 50개 · 리뷰 500개+ 상품 3개 이상이면 수요가 검증된 시장</small></span></div>` : ""}
        ${m ? `<div class="rp-row"><span class="k">원가</span><span class="v">${won(m.price)}원에 팔면 → <span class="ok">1688 ¥${m.yuan} 이하면 OK</span><small>광고 10% 쓰고도 개당 약 ${won(m.margin)}원 남음</small></span></div>` : ""}
      </div>
      ${w ? `<div class="rp-warn">⚠ ${esc(w)}</div>` : ""}
      <div class="rp-acts"><button type="button" class="pri" data-src="${esc(k.kw)}" title="1위 상품을 리스트업에 담고 1688에서 같은 상품을 자동으로 찾아요">🇨🇳 1688 원가 찾기</button><button type="button" class="sec" data-kw="${esc(k.kw)}" title="키워드 분석 화면에서 쿠팡 상품 전체·쿠폰가를 다시 조회해요">🔎 키워드 분석</button></div>
    </article>`;
  }
  function row(k, n) {
    const h = hy.get(k.kw), t = h?.items?.[0], m = money(h);
    if (!t) return `<div class="rp-li"><span class="n">${n}</span><span class="ph"></span><span class="t">${esc(k.kw)}${descOf(k)}</span><span class="dim all">${esc(h?.error ? (/로그인|WING/.test(h.error) ? "Wing 로그인이 필요해요 (① Wing 탭)" : "쿠팡 실판매를 못 불러왔어요") : "판매 지표가 있는 상품이 없어요")}</span><button type="button" class="sec" data-kw="${esc(k.kw)}">🔎 자세히</button></div>`;
    const w = h.medical ? "의료기기 상품 있음" : h.brandShare >= 0.5 ? `브랜드 비중 ${pct(h.brandShare)}` : h.top1Share >= 0.5 ? `1등 쏠림 ${pct(h.top1Share)}` : "";
    return `<div class="rp-li can" data-row="${esc(k.kw)}" data-n="${n}"><span class="n">${n}</span><img src="${esc(imgUrl(t.img))}" alt="" loading="lazy"><span class="t">${esc(k.kw)}${descOf(k)}${w ? `<small class="w" title="${esc(warnOf(h))}">⚠ ${esc(w)}</small>` : ""}</span>
      <span class="c4"><b>${eok(h.total.rev)}</b><small>월매출</small></span>
      ${k.mode === "pro" && h.top1Sales != null
        ? `<span class="c5">1등 하루 <b>${won(Math.round(h.top1Sales / 28))}개</b> · 리뷰 500개+ ${won(h.big500)}개<small>${h.gap ? `틈 28일 ${won(h.gap.sales)}개 판매` : "틈 없음"}</small></span>`
        : `<span class="c5">판매 <b>${won(h.total.sales)}개</b> · 리뷰 ${won(metric(k, "reviews"))}<small>상위 ${h.n}개 합</small></span>`}
      <span class="c6">${m ? `${won(m.price)}원 → <span class="ok">¥${m.yuan} 이하</span><small>1688 기준가</small>` : "-"}</span>
      <button type="button" class="sec rp-expb">${open4.has(k.kw) ? "접기 ▴" : "펼쳐 보기 ▾"}</button></div>${open4.has(k.kw) ? expHtml(k, n) : ""}`;
  }
  // 4위부터: 줄을 누르면 그 아래에 1~3위와 같은 카드를 펼친다(키워드 분석·해커 화면으로 넘어가지 않음)
  const open4 = new Set();
  const expHtml = (k, n) => `<div class="rp-exp">${bigCard(k, n - 1)}</div>`;
  function toggleRow(el) {
    const kw = el.dataset.row, k = (got?.items || []).find((x) => x.kw === kw); if (!k) return;
    const nx = el.nextElementSibling, b = el.querySelector(".rp-expb");
    if (open4.has(kw)) { open4.delete(kw); if (nx?.classList.contains("rp-exp")) nx.remove(); if (b) b.textContent = "펼쳐 보기 ▾"; }
    else { open4.add(kw); el.insertAdjacentHTML("afterend", expHtml(k, +el.dataset.n)); if (b) b.textContent = "접기 ▴"; }
  }
  const waitRow = (k, n) => `<div class="rp-li wait"><span class="n">${n}</span><span class="ph sk"></span><span class="t">${esc(k.kw)}${descOf(k)}</span><span class="c4"><i class="sk" style="width:80px"></i></span><span class="c5"><i class="sk" style="width:130px"></i></span><span class="c6"><i class="sk" style="width:100px"></i></span><span class="dim">조회 중</span></div>`;
  const listHead = () => `<div class="rp-li head"><span>#</span><span></span><span>키워드</span><span class="c4">월매출 (상위 10개)</span><span class="c5">${proGot() ? "1등 하루 판매 · 리뷰 500개+ 상품" : "판매 · 리뷰 (상위 10개 합)"}</span><span class="c6">원가</span><span></span></div>`;
  const skelCard = (i) => `<article class="rp-card skel" style="--i:${i}"><div><span class="rp-rk">${i + 1}</span><div class="rp-name"><i class="sk" style="width:60%;height:18px"></i></div></div>
    <div class="rp-rev"><span class="lbl">월매출</span><i class="sk" style="width:120px;height:22px"></i></div>
    <div class="rp-prods">${[0, 1, 2].map(() => `<div class="rp-p"><i class="sk" style="display:block;width:100%;height:auto;aspect-ratio:1/1;border-radius:0"></i><div class="i"><i class="sk" style="width:80%"></i></div></div>`).join("")}</div>
    <div class="rp-rows"><i class="sk" style="width:90%"></i><i class="sk" style="width:70%"></i></div></article>`;
  // 🔮 조회 전 예상 순서: 평균가 × 1등 상품 리뷰 수(키워드 DB). 대표님 실데이터 82개 기준 실제 월매출 순위와 상관 0.74, 위 3개 적중 75%
  //  (네이버 검색량 × 평균가는 0.18) → 이 순서로 조회해서 1번 카드부터 차례로 채우면, 다 채운 뒤 바뀌는 자리가 적다
  const predict = (items) => [...items].sort((a, b) => (b.price || 0) * (b.mx || 1) - (a.price || 0) * (a.mx || 1));
  const withSlot = (html, i) => html.replace(/^(\s*<(?:article|div))/, `$1 data-slot="${i}"`);
  const errCard = (k, i) => `<article class="rp-card" style="--i:${i}"><div><span class="rp-rk">${i + 1}</span><div class="rp-name">${esc(k.kw)}</div>${k.ai?.desc ? `<div class="rp-desc">${esc(k.ai.desc)}</div>` : ""}</div><p class="dim">${esc(hy.get(k.kw)?.error ? "쿠팡 실판매를 못 불러왔어요" : "판매 지표가 있는 상품이 없어요")}</p></article>`;
  const slotHtml = (k, i) => withSlot(i < 3 ? (!hy.has(k.kw) ? skelCard(i) : hy.get(k.kw)?.items?.length ? bigCard(k, i) : errCard(k, i)) : hy.has(k.kw) ? row(k, i + 1) : waitRow(k, i + 1), i);
  function fillSlot(k, i) {
    const el = root.querySelector(`[data-slot="${i}"]`); if (!el || i < 0) return;
    el.outerHTML = slotHtml(k, i);
  }
  // 정렬: 추천순(기본, 예상 순서 그대로 — 다 채운 뒤에도 다시 줄 세우지 않음) · 월매출 · 판매량 · 리뷰 수(모두 판매액 상위 10개 합). 같은 버튼을 다시 누르면 오름·내림 전환
  const SORTS_BASE = [["reco", "추천순"], ["rev", "월매출"], ["sales", "판매량"], ["reviews", "리뷰 수"]];
  const sorts = () => (proGot() ? [["gap", "틈 판매"], ...SORTS_BASE] : SORTS_BASE); // 팔아봤어요: 리뷰 300개 미만 상품 중 가장 많이 판 상품의 28일 판매량
  const SORT_DIR = { rev: -1, sales: -1, reviews: 1, gap: -1 }; // 처음 누를 때: 매출·판매·틈은 많은 순, 리뷰는 적은 순(들어가기 쉬운 순)
  let sortBy = { key: "reco", dir: -1 };
  const metric = (k, key) => { const h = hy.get(k.kw); if (!h?.items?.length) return null; if (key === "gap") return h.gap?.sales ?? 0; return key === "reviews" ? h.total.reviews ?? h.items.reduce((s, x) => s + (x.reviews || 0), 0) : h.total[key]; };
  function sortBar(loading) {
    return `<div class="rp-sort"><span>정렬</span>${sorts().map(([key, ko]) => { const on = sortBy.key === key, arrow = on && key !== "reco" ? (sortBy.dir < 0 ? " ↓" : " ↑") : "";
      return `<button type="button" data-sort="${key}" class="${on ? "on" : ""}" ${loading ? "disabled" : ""} title="${key === "reco" ? "조회 전에 예상한 순서(평균가 × 1등 상품 리뷰 수)" : key === "gap" ? "리뷰 300개 미만 상품 중 가장 많이 판 상품의 28일 판매량 · 새로 들어가도 팔리는지 · 다시 누르면 순서 바꾸기" : `판매액 상위 10개 상품의 ${ko} 합계 · 다시 누르면 순서 바꾸기`}">${ko}${arrow}</button>`; }).join("")}
      ${loading ? `<small>다 채워지면 정렬할 수 있어요</small>` : ""}</div>`;
  }
  function ordered(items) {
    if (sortBy.key === "reco") return items;
    const ok = items.filter((k) => metric(k, sortBy.key) != null), bad = items.filter((k) => metric(k, sortBy.key) == null);
    return [...ok.sort((a, b) => (metric(a, sortBy.key) - metric(b, sortBy.key)) * sortBy.dir), ...bad];
  }
  function pickHtml(items) {
    const loading = hyTotal && hyDone < hyTotal;
    if (!loading && !items.some((k) => hy.get(k.kw)?.items?.length)) return `<div class="rc-grid">${items.map((k, i) => card({ ...k }, i, false, true)).join("")}</div>`; // Wing 조회 실패 → 키워드 DB 지표 카드
    const list = loading ? items : ordered(items);
    return `${sortBar(loading)}<div class="rp-top3">${list.slice(0, 3).map((k, i) => slotHtml(k, i)).join("")}</div>
      ${list.length > 3 ? `<p class="rp-h">다른 후보 ${list.length - 3}개${loading ? " · 예상 순서대로 채워요" : ""}</p><div class="rp-list" id="rpList">${listHead()}${list.slice(3).map((k, i) => slotHtml(k, i + 3)).join("")}</div>` : ""}`;
  }
  // 🇨🇳 1688 원가 찾기: 1위 상품을 리스트업에 담고(추천가는 그 상품 가격 기준) 1688 자동 조사 줄에 넣는다 — 키워드 분석 ☆ 담기와 같은 흐름
  function add1688(kw) {
    const h = hy.get(kw), it = h?.items?.[0];
    if (!it || !window.Listup) return;
    if (window.Listup.has(it.pid)) { api.invoke("nav:tab", "list"); return; }
    const k = (got?.items || []).find((x) => x.kw === kw), e = window.Entry?.forItem(it.price);
    const r = window.Listup.add({ keyword: kw, kwVol: k?.m1 ?? null, name: it.name, pid: it.pid,
      benchUrl: `https://www.coupang.com/vp/products/${it.pid}${it.vid ? `?vendorItemId=${it.vid}` : ""}`, img: it.img,
      bSales: it.sales, monthly: "", benchMonthly: Math.round((it.sales * 30) / 28), benchPrice: it.price, bReviews: it.reviews ?? null,
      recPrice: e?.cut > 0 ? e.price : null, recYuan: e?.yuan > 0 ? Math.round(e.yuan * 10) / 10 : null });
    window.Listup.queue1688?.(r);
    api.invoke("nav:tab", "list");
  }
  let got = null, dstate = null, drawMsg = ""; // 이번에 받은 키워드 · 오늘 남은 횟수·지금까지 받은 목록(메인 store)
  let optOpen = false; // ⚙ 조건 바꾸기 펼침(다시 그려도 유지)
  // 횟수를 다 썼을 때: 언제 다시 열리는지(다음 자정까지 남은 시간) + 하루 1번 🎁 보너스 5번
  const untilTxt = (at) => { const m = Math.max(1, Math.round((at - Date.now()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? `${m % 60}분 ` : ""}뒤` : `${m}분 뒤`; };
  const resetTxt = () => dstate?.resetAt ? `내일 0시에 다시 ${dstate.daily ?? 10}번 열려요 (${untilTxt(dstate.resetAt)})` : "내일 다시 열려요";
  const exhausted = () => !!dstate && dstate.left <= 0;
  const bonusHtml = () => exhausted() && !dstate.bonusUsed ? `<button type="button" class="rc-bonus" id="rcBonus" title="오늘 1번만 · 바로 ${dstate.bonus ?? 5}번 더 받을 수 있어요">🎁 보너스 ${dstate.bonus ?? 5}번 더 받기</button>` : "";
  const limitHtml = () => exhausted() ? `<p class="rc-limit" id="rcLimit">오늘 ${dstate.daily ?? 10}번${dstate.bonusUsed ? ` + 보너스 ${dstate.bonus ?? 5}번` : ""}을 다 썼어요 · ${resetTxt()}${dstate.bonusUsed ? "" : " · 지난 결과는 횟수 없이 다시 볼 수 있어요"}</p>${bonusHtml()}` : "";
  let foundAt = 0; // 마지막으로 "AI 소싱"을 돌린 시각
  let res = null, started = false, open = { all: false, start: false, weak: false, rising: false }, condOpen = false, busy = false;
  const root = $("reco");
  root.innerHTML = `<div class="rc-scroll" id="rcScroll"><div id="rcBody"></div></div>`;

  // ── 시작 화면: 큰 버튼 하나 + 분석 규모(실제 숫자) ──
  function startHtml() {
    const lock = res?.steps?.find((s) => s.key === "lock");
    const pro = opt.mode === "pro";
    return `<div class="rc-home">
      <div class="rc-hero">
        <span class="rc-kick">SEEDHACK · AI 소싱</span>
        <div class="rc-seg" role="group" aria-label="추천 기준">${Object.entries(MODES).map(([id, m]) => `<button type="button" data-mode="${id}" aria-pressed="${opt.mode === id}">${m.ko}</button>`).join("")}</div>
        <h3>${md().h}</h3>
        <p>${pro ? `1등 상품 리뷰가 1,000개 넘는, 이미 팔리는 게 확인된 시장만 골라요<br>카드에서 1등 하루 판매량과 리뷰 적은 새 상품도 팔리는지 바로 보여 줘요`
          : `쿠팡 키워드 <b>${won(res?.dbTotal)}</b>개에서 팔리는 것만 남기고,<br>브랜드·식품·화장품·인증품처럼 초보가 못 파는 것은 AI가 걸러 냅니다`}</p>
        <button type="button" class="rc-bigbtn${exhausted() ? " off" : ""}" id="rcGo">${exhausted() ? "오늘 횟수를 다 썼어요" : `🔍 AI 소싱 시작${dstate ? ` · 오늘 ${dstate.left}번 남음` : ""}`}</button>
        ${limitHtml()}
        <small>한 번에 처음 보는 키워드 10개 · 하루 ${dstate?.daily ?? 10}번 · ${pro ? "원가는 300개 들여오는 기준" : "예산·필터는 결과를 본 뒤에 바꿀 수 있어요"} · 고른 쪽을 기억해요</small>
        ${dstate?.batches?.length ? `<button type="button" class="rc-past" id="rcPast" title="받기 횟수를 쓰지 않고 마지막으로 받은 키워드를 다시 봐요">🕘 지난 결과 보기 · ${esc(whenTxt(dstate.batches[0].at))}</button>` : ""}
      </div>
      <div class="rc-scale">
        <div><b>${won(res?.dbTotal)}</b><span>쿠팡 키워드 DB</span></div>
        <div><b>${won(res?.steps?.[1]?.count)}</b><span>실제로 팔리는 것</span></div>
        <div><b>${won(lock?.count)}</b><span>누구나 팔 수 있는 것</span></div>
        <div><b>${res?.judged ? won(res.judged) : "-"}</b><span>AI가 검수한 키워드</span></div>
      </div>
    </div>`;
  }

  // ── 결과: 조절 줄 + 깔때기 요약 + 세 묶음 ──
  function controlsHtml() {
    const lockCuts = (res.steps.find((s) => s.key === "lock")?.cuts || []).map(([w]) => w).join(" · ");
    return `<div class="rc-ctl">
      <div class="rc-row rc-top"><span class="rc-when">${foundAt ? `${new Date(foundAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}에 찾은 결과` : ""}</span><span class="rc-when">지금까지 받은 키워드 ${won(dstate?.seenTotal || 0)}개 · 오늘 ${dstate?.left ?? 0}번 남음</span></div>
      <div class="rc-row"><span class="rc-lbl">기준</span>${Object.entries(MODES).map(([id, m]) => `<button type="button" class="rc-chip ${opt.mode === id ? "on" : ""}" data-mode="${id}" title="${id === "pro" ? "이미 팔리는 시장(1등 리뷰 1,000개+)에서 빈자리 찾기" : "경쟁이 약해 처음 들어가기 쉬운 곳 찾기"}">${m.ko}</button>`).join("")}</div>
      <div class="rc-row"><span class="rc-lbl">예산</span>${BUDGETS.map(([v, l]) => `<button type="button" class="rc-chip ${opt.budget === v ? "on" : ""}" data-budget="${v}">${l}</button>`).join("")}
        <span class="rc-hint" title="1688 원가를 아직 모르므로, 평균가에서 수수료·광고 10%·마진 20%·물류를 빼고 남는 최대 원가 × ${md().qty}개로 계산">원가 × ${md().qty}개 기준</span></div>
      <div class="rc-row"><span class="rc-lbl">안전 필터</span>${Object.entries(SAFE).map(([k, d]) => `<button type="button" class="rc-chip safe ${opt.safe[k] ? "on" : ""}" data-safe="${k}" title="${esc(d.desc)} — 누르면 ${opt.safe[k] ? "끄고 포함" : "다시 빼기"}">${opt.safe[k] ? "✓ " : ""}${esc(d.ko)}</button>`).join("")}
        <span class="rc-chip lock" title="${esc(lockCuts)}">🔒 브랜드·식품·화장품·의약·식물 항상 제외</span></div>
      <div class="rc-row"><button type="button" class="rc-more" id="rcCondT">${condOpen ? "▴" : "▾"} 경쟁 조건${Object.keys(opt.cond).length ? ` · ${Object.keys(opt.cond).length}개 선택` : ""}</button>
        <label class="rc-chk"><input type="checkbox" id="rcSeason" ${opt.noSeason ? "checked" : ""}> 계절 상품 빼기</label>
        ${JSON.stringify({ ...opt, mode: DEF.mode }) !== JSON.stringify(DEF) ? `<button type="button" class="rc-more" id="rcReset">↺ 기본값</button>` : ""}</div>
      ${condOpen ? `<div class="rc-cond">${ORDER.map((id) => { const a = AX[id]; if (!a) return ""; const lo = id === "trend" ? "지는 중" : "적음", hi = id === "trend" ? "뜨는 중" : "많음";
        return `<div class="rc-axis"><span>${esc(PLAIN[id])}</span>${[["", "상관없음"], ["lo", lo], ["hi", hi]].map(([s, l]) => `<button type="button" data-ax="${id}" data-side="${s}" aria-pressed="${(opt.cond[id] || "") === s}">${l}</button>`).join("")}</div>`; }).join("")}</div>` : ""}
    </div>`;
  }
  function funnelHtml() {
    return `<div class="rc-funnel">${res.steps.map((s, i) => `${i ? `<i>›</i>` : ""}<div class="${i === res.steps.length - 1 ? "last" : ""}" title="${esc((s.cuts || []).filter(([, n]) => n).map(([w, n]) => `${String(w).trim()} ${won(n)}`).join("\n") || s.note || "")}"><b>${won(s.count)}</b><span>${esc(s.label)}</span></div>`).join("")}</div>`;
  }
  // AI 태그를 초보 말로(가상 초보 테스트: "무인증·1688 흔함이 암호 같다")
  const PLAIN_TAG = { "무인증": "인증 없이 판매 가능", "1688 흔함": "중국에서 쉽게 구함", "1688흔함": "중국에서 쉽게 구함", "소형": "작고 가벼움", "완제품": "그대로 팔면 됨", "옵션 단순": "옵션 단순", "옵션단순": "옵션 단순" };
  const plainTag = (t) => PLAIN_TAG[String(t).trim()] || t;
  // 왜 이 키워드인지 한 줄 — 숫자로만(지어내지 않음)
  const whyLine = (k) => {
    if (k.mode === "pro") return `1등 상품 리뷰 ${won(k.mx)}개 · 이미 팔리는 게 확인된 시장이에요`;
    const a = [];
    if (k.m1 >= 3000 && k.mx <= 300) a.push("찾는 사람은 많은데 1등 상품 리뷰가 적어 들어갈 틈이 있어요");
    else if (k.mx <= 300) a.push("1등 상품 리뷰가 적어 처음 들어가기 쉬워요");
    else if (k.m1 >= 10000) a.push("한 달 검색이 많아 수요가 확실해요");
    if ((k.fc ?? 0) >= 0.3) a.push(`다음 달 검색이 ${pct(k.fc)} 늘 것으로 보여요`);
    if (k.srocket <= 0.1) a.push("빠른배송 판매자가 거의 없어요");
    return a.slice(0, 2).join(" · ") || "검색량에 비해 경쟁이 약한 편이에요";
  };
  function card(k, i, top, big) {
    const path = String(k.cat || "").split(">");
    const ai = k.ai;
    const aiChip = !ai ? `<span class="chip dim" title="이번 달 AI 검수 대상 밖">AI 검수 전</span>`
      : ai.v === "hold" ? `<span class="chip o" title="AI: 확인 필요">확인 필요 · ${esc(ai.reason)}</span>`
      : (ai.tags || []).slice(0, 3).map((t) => `<span class="chip g" title="AI 검수: ${esc(ai.reason)}">${esc(plainTag(t))}</span>`).join("");
    return `<div class="rc-card ${top ? "top" : ""} ${big ? "big" : ""}" style="--i:${Math.min(i, 40)}">
      <div class="rc-kw">${big && k.tier ? `<span class="rc-rank t${k.tier}">${TIER[k.tier]}</span>` : ""}<b>${esc(k.kw)}</b></div>
      ${ai?.desc ? `<div class="rc-desc2">${esc(ai.desc)}</div>` : `<div class="rc-cat" title="${esc(path.join(" › "))}">${esc(path.slice(-2).join(" › "))}</div>`}
      ${big ? `<div class="rc-why">💡 ${esc(whyLine(k))}</div>` : ""}
      <div class="rc-num"><b>${won(k.m1)}</b><small>월검색</small></div>
      <div class="rc-chips">${aiChip}</div>
      <div class="rc-chips sub"><span class="chip" title="검색 1등 상품의 리뷰 수 — 적을수록 들어가기 쉬워요">1등 리뷰 ${won(k.mx)}</span><span class="chip">평균 ${man(k.price)}원</span><span class="chip" title="로켓그로스 비중">빠른배송 판매자 ${pct(k.srocket)}</span>${k.fc != null && Math.abs(k.fc) >= 0.3 ? `<span class="chip">다음 달 ${k.fc >= 0 ? "+" : "−"}${pct(Math.abs(k.fc))}</span>` : ""}</div>
      ${big ? `<div class="rc-hy" data-hy="${esc(k.kw)}">${hyHtml(k.kw)}</div>` : ""}
      <button class="pri" type="button" data-kw="${esc(k.kw)}">🔎 키워드 분석으로 자세히</button>
    </div>`;
  }
  // 결과: 이번에 받은 10개(크게, 설명·이유 한 줄) + "10개 더 받기(오늘 n번 남음)" + 지금까지 받은 키워드(접기)
  const TIER = { A: "경쟁 약함", B: "해볼 만함", C: "익숙한 상품", L: "큰 시장", M: "검증된 시장" };
  function resultHtml() {
    const items = got?.items || [], bs = dstate?.batches || [];
    const left = dstate?.left ?? 0, latest = !bs.length || got?.at === bs[0].at || !got?.at;
    const pick = bs.length > 1 || (bs.length && !latest) ? `<label class="rp-past">🕘 <select id="rpBatch">${bs.map((b) => `<option value="${b.at}" ${b.at === got?.at ? "selected" : ""}>${esc(whenTxt(b.at))} · ${esc(b.items[0]?.kw || "")} 외 ${b.items.length - 1}개</option>`).join("")}</select></label>` : "";
    return `<div class="rp-head"><div><h2>${latest ? "이번에 받은" : `${esc(whenTxt(got.at))}에 받은`} 키워드 ${items.length}개 <em>오늘 ${left}번 더 받을 수 있어요</em></h2><p>${proGot() ? "팔아봤어요 기준 · 다 채워지면 틈 판매 순" : "추천순"} · 쿠팡 실판매(판매액 상위 10개 상품)로 시장 크기와 리뷰 적은 상품도 팔리는지 함께 봐요${pick ? " · 지난 결과는 횟수를 쓰지 않고 다시 볼 수 있어요" : ""}</p>${pick}</div>
        <div class="rp-btns"><div class="rp-seg" role="group" aria-label="다음에 받을 기준" title="다음에 받을 키워드의 기준 · 지금 보는 결과는 그대로예요">${Object.entries(MODES).map(([id, m]) => `<button type="button" data-mode="${id}" aria-pressed="${opt.mode === id}">${m.ko}</button>`).join("")}</div><button type="button" class="rp-again" id="rcAgain" ${left ? "" : "disabled"} title="${left ? `오늘 ${left}번 남음` : resetTxt()}">${left ? "🎁 10개 더 받기" : "오늘 횟수를 다 썼어요"}</button>${left ? "" : bonusHtml()}</div></div>${left ? "" : limitHtml()}
      ${items.length ? `<div class="rp-prog" id="rpProg"></div>${pickHtml(items)}
      <div class="rp-foot">· 월매출·판매량·리뷰 수 = 이 키워드 검색 상품 중 판매액 상위 10개의 최근 28일 판매량 × 판매가 · 판매량 · 리뷰 수 합계 (검색어와 다른 상품은 빼고 계산)<br>
        · 추천순 = 조회 전에 예상한 순서(평균가 × 1등 상품 리뷰 수 — 실제 월매출 순위와 대체로 비슷)<br>
        · 사진의 <b>틈</b> 표시 = 리뷰 300개 미만인데 많이 팔린 상품 (새로 들어가도 팔린다는 증거)<br>
        ${proGot() ? `· 틈 판매 = 그 틈 상품의 최근 28일 판매량 · 1등 하루 = 가장 많이 판 상품의 28일 판매 ÷ 28 · 리뷰 500개+ 상품 = Wing 검색 결과 기준 개수<br>` : ""}
        · 원가 = 추천가로 팔 때 1688에서 이 가격 이하로 찾으면 광고비 10%를 쓰고도 마진 20%가 남는다는 뜻</div>` : `<p class="rc-empty">${esc(drawMsg || "받을 키워드가 없어요. 조건을 넓혀 보세요.")}</p>`}
      <details class="rp-opt" id="rpOpt" ${optOpen ? "open" : ""}><summary><b>⚙ 조건 바꾸기</b><span>예산 · 안전 필터 · 경쟁 조건 — 다음에 받을 키워드부터 적용돼요</span></summary>
        ${controlsHtml()}<div class="rc-sum"><div class="rc-big"><b id="rcFinal">${won(res.final)}</b><span>조건에 맞는 키워드</span></div>${funnelHtml()}</div></details>
      <p class="rc-note">검색량·리뷰는 제휴 키워드 DB(${esc(res.month)}) 기준 참고 지표입니다. <b>🔎 쿠팡 실판매 보기</b>로 실제 판매량을 꼭 확인하세요.</p>`;
  }

  const whenTxt = (at) => { const d = new Date(at), now = new Date(), hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
    const day = (x) => x.toLocaleDateString("sv-SE"), y = new Date(now); y.setDate(now.getDate() - 1);
    return day(d) === day(now) ? `오늘 ${hm}` : day(d) === day(y) ? `어제 ${hm}` : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`; };
  // 지난 결과 다시 열기: 받기 횟수를 쓰지 않음 · 카드 숫자는 저장본(없으면 7일 저장된 Wing 결과, 그것도 없으면 Wing 조회)
  function restore(b) {
    if (!b) return;
    got = { items: predict(b.items), at: b.at }; started = true; foundAt = b.at; open4.clear(); sortBy = { key: "reco", dir: -1 };
    $("rcScroll").scrollTop = 0;
    const p = startHyoja(got.items, true);
    render(true);
    return p;
  }
  function render(cascade) {
    $("rcBody").innerHTML = !started || !res ? (res ? startHtml() : `<p class="rc-empty">키워드 DB 불러오는 중…</p>`) : resultHtml();
    hyProg();
    // "rc-cascade": panel.css의 .cascade(카테고리 1~4차 칸, 가운데 정렬)와 이름이 겹쳐 3초 동안 화면 폭이 줄던 문제(2026-10-12) → 이름 분리
    if (cascade) { root.classList.add("rc-cascade"); setTimeout(() => root.classList.remove("rc-cascade"), 3000); root.querySelectorAll(".rc-card.top").forEach((c) => c.classList.add("flash")); }
  }
  async function load() {
    const r = await api.invoke("kw:scan", { budget: opt.budget, safe: opt.safe, noSeason: opt.noSeason, cond: opt.cond, qty: md().qty }).catch(() => null);
    if (r) { res = r; AX = r.axesDef || AX; SAFE = r.safeDef || SAFE; }
    return r;
  }
  // 조절: 다시 계산 → 숫자가 바뀌는 게 보이게(개수 굴리기) + 결과가 차례로
  async function refine() {
    if (busy) return;
    busy = true; keep();
    const prev = res?.final || 0;
    await load();
    busy = false;
    render(true);
    const el = $("rcFinal"), to = res?.final || 0;
    if (el && prev !== to) { const t0 = performance.now(); const tick = (now) => { const f = Math.min(1, (now - t0) / 600); el.textContent = won(prev + (to - prev) * f); if (f < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  }
  async function bonus() { // 🎁 보너스 5번(하루 1번) → 바로 한 번 받기
    const b = $("rcBonus"); if (b) { b.disabled = true; b.textContent = "🎁 보너스 채우는 중…"; }
    const r = await api.invoke("kw:drawBonus").catch((e) => ({ error: e?.message || String(e) }));
    dstate = await api.invoke("kw:drawState").catch(() => dstate);
    if (!r?.ok) { drawMsg = r?.error === "bonusUsed" ? "오늘 보너스는 이미 받았어요." : r?.error || "보너스를 받지 못했어요."; render(true); return; }
    go();
  }
  async function go() {
    if (exhausted()) { dstate = await api.invoke("kw:drawState").catch(() => dstate); render(true); const el = $("rcLimit"); if (el) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); el.scrollIntoView({ block: "nearest" }); } return; }
    const sc = window.AiScan?.reco(res?.month || "");
    const r = await load();
    if (!r) { sc?.fail("키워드 DB를 읽지 못했습니다"); return; }
    const d = await api.invoke("kw:draw", { budget: opt.budget, safe: opt.safe, noSeason: opt.noSeason, cond: opt.cond, qty: md().qty, mode: opt.mode }).catch((e) => ({ error: e?.message || String(e) }));
    if (d?.left != null) dstate = { ...(dstate || {}), ...d };
    drawMsg = d?.error === "limit" ? `오늘 받을 수 있는 횟수를 다 썼어요. ${resetTxt()}` : d?.error === "empty" ? "조건에 맞는 새 키워드를 다 받았어요. 필터를 넓혀 보세요." : d?.error || "";
    got = d && !d.error ? { ...d, items: predict(d.items || []), at: null } : { items: [] }; sortBy = { key: "reco", dir: -1 };
    open4.clear();
    dstate = await api.invoke("kw:drawState").catch(() => dstate);
    if (got.items.length && dstate?.batches?.[0]) got.at = dstate.batches[0].at; // 방금 받은 묶음 = 가장 최근 묶음
    const hyP = startHyoja(got.items); // 해커 화면이 도는 동안 미리 조회 시작
    if (sc) await sc.run({ ...r, final: got.items.length, groups: { ...r.groups, start: { count: got.items.length, items: got.items } } });
    started = true; foundAt = Date.now(); open = { all: false, start: false, weak: false, rising: false };
    $("rcScroll").scrollTop = 0;
    render(true);
    hyProg();
    await hyP;
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#rcGo") || t.closest("#rcAgain")) { go(); return; }
    if (t.closest("#rcPast")) { restore(dstate?.batches?.[0]); return; }
    if (t.closest("#rcBonus")) { bonus(); return; }
    const so = t.closest("button[data-sort]");
    if (so && !so.disabled) { const key = so.dataset.sort; sortBy = sortBy.key === key && key !== "reco" ? { key, dir: -sortBy.dir } : { key, dir: SORT_DIR[key] ?? -1 }; open4.clear(); render(true); return; }
    const fl = t.closest("[data-flash]");
    if (fl) { e.preventDefault(); const p = fl.closest(".rp-card")?.querySelectorAll(".rp-p")[+fl.dataset.flash]; if (p) { p.classList.remove("fl"); void p.offsetWidth; p.classList.add("fl"); } return; }
    const rw = t.closest(".rp-li.can"); if (rw && !t.closest("button:not(.rp-expb)")) { toggleRow(rw); return; } // 카드가 차례로 다시 떠오르는 연출(발표용)
    const b = t.closest("[data-budget]"); if (b) { opt.budget = +b.dataset.budget; refine(); return; }
    const s = t.closest("[data-safe]"); if (s) { opt.safe[s.dataset.safe] = !opt.safe[s.dataset.safe]; refine(); return; }
    const ax = t.closest("[data-ax]"); if (ax) { if (ax.dataset.side) opt.cond[ax.dataset.ax] = ax.dataset.side; else delete opt.cond[ax.dataset.ax]; refine(); return; }
    if (t.closest("#rcCondT")) { condOpen = !condOpen; render(); return; }
    if (t.closest("#rcReset")) { opt = { ...structuredClone(DEF), mode: opt.mode }; refine(); return; } // 기준(처음이에요/팔아봤어요)은 기본값으로 되돌리지 않음
    const mo = t.closest("[data-mode]"); if (mo) { if (opt.mode !== mo.dataset.mode) { opt.mode = mo.dataset.mode; refine(); } return; }
    const o = t.closest("[data-open]"); if (o) { open[o.dataset.open] = !open[o.dataset.open]; render(); return; }
    const src = t.closest("button[data-src]"); if (src) { add1688(src.dataset.src); return; }
    const k = t.closest("button[data-kw]");
    if (k) { $("kwInput").value = k.dataset.kw; $("kwInput").dataset.src = "reco"; $("tKw").click(); $("kwForm").requestSubmit(); } // src=reco: 키워드 분석 최근 검색에 남기지 않음(2026-10-13 대표님 결정) // 🔎 키워드 분석으로 넘겨 쿠팡 실판매·쿠폰가 확인
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "rcSeason") { opt.noSeason = e.target.checked; refine(); }
    if (e.target.id === "rpBatch") restore((dstate?.batches || []).find((b) => String(b.at) === e.target.value));
  });

  root.addEventListener("toggle", (e) => { if (e.target.id === "rpOpt") optOpen = e.target.open; }, true);

  window.Reco = {
    // 앱을 켜면 시작 화면(기준 고르기)부터. 이번 실행에서 조회한 결과는 다른 탭에 다녀와도 그대로(started) — 2026-10-12 대표님 결정
    //  지난 결과는 시작 화면의 🕘 버튼으로 횟수 없이 다시 연다
    async show() {
      if (!res) { render(); await load(); }
      dstate = await api.invoke("kw:drawState").catch(() => dstate);
      render();
    },
  };
})();
