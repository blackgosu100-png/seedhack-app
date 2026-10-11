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
  const DEF = { budget: 0, safe: { cert: true, big: true, craft: true, apparel: true }, noSeason: true, cond: {} };
  let opt = (() => { try { const o = JSON.parse(localStorage.getItem("recoOpt") || "null"); return o ? { ...DEF, ...o, safe: { ...DEF.safe, ...(o.safe || {}) }, cond: o.cond || {} } : structuredClone(DEF); } catch { return structuredClone(DEF); } })();
  const keep = () => { try { localStorage.setItem("recoOpt", JSON.stringify(opt)); } catch {} };

  // 🏆 효자상품: 키워드마다 Wing 검색 1번 → 판매액 상위 5개. 받은 순서대로 도착하는 대로 채운다
  const hy = new Map(); let hyRun = 0, hyDone = 0, hyTotal = 0, hyMs = [];
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
      <span>${done ? "완료 · 월매출 순으로 정렬했어요" : `약 ${Math.max(1, Math.round(((hyTotal - hyDone) * Math.max(avg, 4000)) / 1000))}초 남음 · 다 채워지면 월매출 순으로 정렬해요`}</span>`;
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
      const el = $("rpList");
      if (el) el.innerHTML = LIST_HEAD + waitRows(items);
      hyProg();
    }
    if (run === hyRun && started) render(true); // 다 채워지면 월매출 순으로 다시 줄 세우기(위 3개 크게)
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
    <div class="i"><div class="pn" title="${esc(x.name)}">${esc(x.name)}</div><div class="pp">${won(x.price)}원</div><div class="kv"><span>판매</span><b>${won(x.sales)}개</b></div><div class="kv"><span>리뷰</span><span>${won(x.reviews)}</span></div></div><span class="go">↗</span></a>`;
  function bigCard(k, i) {
    const h = hy.get(k.kw), m = money(h), w = warnOf(h), g = h.gap;
    const top3 = h.items.slice(0, 3), gi = g ? top3.findIndex((x) => String(x.pid) === String(g.pid) && String(x.vid) === String(g.vid)) : -1;
    const dropT = (h.drop || []).map((d) => `${d.name} (${won(d.sales)}개)`).join("\n");
    return `<article class="rp-card ${i === 0 ? "win" : ""}" style="--i:${i}">
      <span class="rp-src">쿠팡 실판매</span>
      <div><span class="rp-rk">${i + 1}</span><div class="rp-name">${esc(k.kw)}</div>${k.ai?.desc ? `<div class="rp-desc">${esc(k.ai.desc)}</div>` : ""}</div>
      <div class="rp-rev"><span class="lbl">월매출</span><b>${eok(h.total.rev)}</b><small>상품 ${h.n}개 · 최근 28일 ${won(h.total.sales)}개 판매${h.drop?.length ? ` · <u title="${esc(dropT)}">검색어와 다른 상품 ${h.drop.length}개 뺌</u>` : ""}</small></div>
      <div class="rp-prods">${top3.map((x, j) => tile(x, j, gi)).join("")}</div>
      <div class="rp-rows">
        <div class="rp-row top"><span class="k">틈</span>${g ? `<a class="v rp-gap" href="${esc(cpUrl(g))}" target="_blank" title="쿠팡 상품 페이지 열기"><img src="${esc(imgUrl(g.img))}" alt="">
          <span>리뷰 <b>${won(g.reviews)}개</b>짜리 상품도 28일 <b class="hl">${won(g.sales)}개</b> 판매<small>${gi >= 0 ? `<span class="rkt" data-flash="${gi}" title="위 사진 칸 보기">${gi + 1}위 상품</span>` : ""}${esc(g.name)} · ${won(g.price)}원 ↗</small></span></a>` : `<span class="v dim">${h.gapBrandOnly ? "리뷰 적은데 팔리는 상품은 유명 브랜드뿐이에요" : "리뷰 300개 미만으로 팔리는 상품은 아직 없어요"}</span>`}</div>
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
      <span class="c5">판매 <b>${won(t.sales)}개</b> · 리뷰 ${won(t.reviews)}<small>1위 상품</small></span>
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
  const waitRows = (items) => items.map((k, i) => (hy.has(k.kw) ? row(k, i + 1) : `<div class="rp-li wait"><span class="n">${i + 1}</span><span class="ph sk"></span><span class="t">${esc(k.kw)}${descOf(k)}</span><span class="c4"><i class="sk" style="width:80px"></i></span><span class="c5"><i class="sk" style="width:130px"></i></span><span class="c6"><i class="sk" style="width:100px"></i></span><span class="dim">조회 중</span></div>`)).join("");
  const LIST_HEAD = `<div class="rp-li head"><span>#</span><span></span><span>키워드</span><span class="c4">월매출</span><span class="c5">1위 상품</span><span class="c6">원가</span><span></span></div>`;
  const skelCard = (i) => `<article class="rp-card skel" style="--i:${i}"><div><span class="rp-rk">${i + 1}</span><div class="rp-name"><i class="sk" style="width:60%;height:18px"></i></div></div>
    <div class="rp-rev"><span class="lbl">월매출</span><i class="sk" style="width:120px;height:22px"></i></div>
    <div class="rp-prods">${[0, 1, 2].map(() => `<div class="rp-p"><i class="sk" style="display:block;width:100%;height:auto;aspect-ratio:1/1;border-radius:0"></i><div class="i"><i class="sk" style="width:80%"></i></div></div>`).join("")}</div>
    <div class="rp-rows"><i class="sk" style="width:90%"></i><i class="sk" style="width:70%"></i></div></article>`;
  function pickHtml(items) {
    if (hyTotal && hyDone < hyTotal) return `<div class="rp-top3">${[0, 1, 2].map(skelCard).join("")}</div>
      <p class="rp-h">받은 키워드 ${items.length}개 · 불러오는 대로 채워요</p><div class="rp-list" id="rpList">${LIST_HEAD}${waitRows(items)}</div>`;
    const ok = items.filter((k) => hy.get(k.kw)?.items?.length);
    if (!ok.length) return `<div class="rc-grid">${items.map((k, i) => card({ ...k }, i, false, true)).join("")}</div>`; // Wing 조회 실패 → 키워드 DB 지표 카드
    // 월매출 순 · 의료기기 상품이 상위인 키워드는 위 3개에서 뺀다
    const rank = [...ok].sort((a, b) => hy.get(a.kw).medical - hy.get(b.kw).medical || hy.get(b.kw).total.rev - hy.get(a.kw).total.rev);
    const rest = [...rank.slice(3), ...items.filter((k) => !ok.includes(k))];
    return `<div class="rp-top3">${rank.slice(0, 3).map(bigCard).join("")}</div>
      ${rest.length ? `<p class="rp-h">다른 후보 ${rest.length}개</p><div class="rp-list">${LIST_HEAD}${rest.map((k, i) => row(k, i + 4)).join("")}</div>` : ""}`;
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
  let foundAt = 0; // 마지막으로 "AI 소싱"을 돌린 시각
  let res = null, started = false, open = { all: false, start: false, weak: false, rising: false }, condOpen = false, busy = false;
  const root = $("reco");
  root.innerHTML = `<div class="rc-scroll" id="rcScroll"><div id="rcBody"></div></div>`;

  // ── 시작 화면: 큰 버튼 하나 + 분석 규모(실제 숫자) ──
  function startHtml() {
    const lock = res?.steps?.find((s) => s.key === "lock");
    return `<div class="rc-home">
      <div class="rc-hero">
        <span class="rc-kick">SEEDHACK · AI 소싱</span>
        <h3>내 첫 상품, AI가 찾아드려요</h3>
        <p>쿠팡 키워드 <b>${won(res?.dbTotal)}</b>개에서 팔리는 것만 남기고,<br>브랜드·식품·화장품·인증품처럼 초보가 못 파는 것은 AI가 걸러 냅니다</p>
        <button type="button" class="rc-bigbtn" id="rcGo">🔍 AI 소싱 시작${dstate ? ` · 오늘 ${dstate.left}번 남음` : ""}</button>
        <small>한 번에 처음 보는 키워드 10개 · 하루 ${dstate?.daily ?? 10}번 · 예산·필터는 결과를 본 뒤에 바꿀 수 있어요</small>
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
      <div class="rc-row"><span class="rc-lbl">예산</span>${BUDGETS.map(([v, l]) => `<button type="button" class="rc-chip ${opt.budget === v ? "on" : ""}" data-budget="${v}">${l}</button>`).join("")}
        <span class="rc-hint" title="1688 원가를 아직 모르므로, 평균가에서 수수료·광고 10%·마진 20%·물류를 빼고 남는 최대 원가 × 80개로 계산">원가 × 80개 기준</span></div>
      <div class="rc-row"><span class="rc-lbl">안전 필터</span>${Object.entries(SAFE).map(([k, d]) => `<button type="button" class="rc-chip safe ${opt.safe[k] ? "on" : ""}" data-safe="${k}" title="${esc(d.desc)} — 누르면 ${opt.safe[k] ? "끄고 포함" : "다시 빼기"}">${opt.safe[k] ? "✓ " : ""}${esc(d.ko)}</button>`).join("")}
        <span class="rc-chip lock" title="${esc(lockCuts)}">🔒 브랜드·식품·화장품·의약·식물 항상 제외</span></div>
      <div class="rc-row"><button type="button" class="rc-more" id="rcCondT">${condOpen ? "▴" : "▾"} 경쟁 조건${Object.keys(opt.cond).length ? ` · ${Object.keys(opt.cond).length}개 선택` : ""}</button>
        <label class="rc-chk"><input type="checkbox" id="rcSeason" ${opt.noSeason ? "checked" : ""}> 계절 상품 빼기</label>
        ${JSON.stringify(opt) !== JSON.stringify(DEF) ? `<button type="button" class="rc-more" id="rcReset">↺ 기본값</button>` : ""}</div>
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
  const TIER = { A: "경쟁 약함", B: "해볼 만함", C: "익숙한 상품" };
  function resultHtml() {
    const items = got?.items || [], bs = dstate?.batches || [];
    const left = dstate?.left ?? 0, latest = !bs.length || got?.at === bs[0].at || !got?.at;
    const pick = bs.length > 1 || (bs.length && !latest) ? `<label class="rp-past">🕘 <select id="rpBatch">${bs.map((b) => `<option value="${b.at}" ${b.at === got?.at ? "selected" : ""}>${esc(whenTxt(b.at))} · ${esc(b.items[0]?.kw || "")} 외 ${b.items.length - 1}개</option>`).join("")}</select></label>` : "";
    return `<div class="rp-head"><div><h2>${latest ? "이번에 받은" : `${esc(whenTxt(got.at))}에 받은`} 키워드 ${items.length}개 <em>오늘 ${left}번 더 받을 수 있어요</em></h2><p>쿠팡 월매출이 큰 순서 · 리뷰 적은 상품도 팔리는지 함께 봐요${pick ? " · 지난 결과는 횟수를 쓰지 않고 다시 볼 수 있어요" : ""}</p>${pick}</div>
        <div class="rp-btns"><button type="button" class="sec" id="rcReplay">▶ 연출 다시 보기</button><button type="button" class="rp-again" id="rcAgain" ${left ? "" : "disabled"} title="${left ? `오늘 ${left}번 남음` : "내일 다시 열려요"}">${left ? "🎁 10개 더 받기" : "오늘 횟수를 다 썼어요"}</button></div></div>
      ${items.length ? `<div class="rp-prog" id="rpProg"></div>${pickHtml(items)}
      <div class="rp-foot">· 월매출 = 이 키워드로 검색되는 상품들의 최근 28일 판매량 × 판매가 합계 (검색어와 다른 상품은 빼고 계산)<br>
        · 사진의 <b>틈</b> 표시 = 리뷰 300개 미만인데 많이 팔린 상품 (새로 들어가도 팔린다는 증거)<br>
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
    got = { items: b.items, at: b.at }; started = true; foundAt = b.at; open4.clear();
    $("rcScroll").scrollTop = 0;
    const p = startHyoja(b.items, true);
    render(true);
    return p;
  }
  function render(cascade) {
    $("rcBody").innerHTML = !started || !res ? (res ? startHtml() : `<p class="rc-empty">키워드 DB 불러오는 중…</p>`) : resultHtml();
    hyProg();
    if (cascade) { root.classList.add("cascade"); setTimeout(() => root.classList.remove("cascade"), 3000); root.querySelectorAll(".rc-card.top").forEach((c) => c.classList.add("flash")); }
  }
  async function load() {
    const r = await api.invoke("kw:scan", { budget: opt.budget, safe: opt.safe, noSeason: opt.noSeason, cond: opt.cond }).catch(() => null);
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
  async function go() {
    if (dstate && dstate.left <= 0) return;
    const sc = window.AiScan?.reco(res?.month || "");
    const r = await load();
    if (!r) { sc?.fail("키워드 DB를 읽지 못했습니다"); return; }
    const d = await api.invoke("kw:draw", { budget: opt.budget, safe: opt.safe, noSeason: opt.noSeason, cond: opt.cond }).catch((e) => ({ error: e?.message || String(e) }));
    drawMsg = d?.error === "limit" ? "오늘 받을 수 있는 횟수를 다 썼어요. 내일 다시 열려요." : d?.error === "empty" ? "조건에 맞는 새 키워드를 다 받았어요. 필터를 넓혀 보세요." : d?.error || "";
    got = d && !d.error ? { ...d, at: null } : { items: [] };
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
    if (t.closest("#rcReplay")) { render(true); return; }
    const fl = t.closest("[data-flash]");
    if (fl) { e.preventDefault(); const p = fl.closest(".rp-card")?.querySelectorAll(".rp-p")[+fl.dataset.flash]; if (p) { p.classList.remove("fl"); void p.offsetWidth; p.classList.add("fl"); } return; }
    const rw = t.closest(".rp-li.can"); if (rw && !t.closest("button:not(.rp-expb)")) { toggleRow(rw); return; } // 카드가 차례로 다시 떠오르는 연출(발표용)
    const b = t.closest("[data-budget]"); if (b) { opt.budget = +b.dataset.budget; refine(); return; }
    const s = t.closest("[data-safe]"); if (s) { opt.safe[s.dataset.safe] = !opt.safe[s.dataset.safe]; refine(); return; }
    const ax = t.closest("[data-ax]"); if (ax) { if (ax.dataset.side) opt.cond[ax.dataset.ax] = ax.dataset.side; else delete opt.cond[ax.dataset.ax]; refine(); return; }
    if (t.closest("#rcCondT")) { condOpen = !condOpen; render(); return; }
    if (t.closest("#rcReset")) { opt = structuredClone(DEF); refine(); return; }
    const o = t.closest("[data-open]"); if (o) { open[o.dataset.open] = !open[o.dataset.open]; render(); return; }
    const src = t.closest("button[data-src]"); if (src) { add1688(src.dataset.src); return; }
    const k = t.closest("button[data-kw]");
    if (k) { $("kwInput").value = k.dataset.kw; $("tKw").click(); $("kwForm").requestSubmit(); } // 🔎 키워드 분석으로 넘겨 쿠팡 실판매·쿠폰가 확인
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "rcSeason") { opt.noSeason = e.target.checked; refine(); }
    if (e.target.id === "rpBatch") restore((dstate?.batches || []).find((b) => String(b.at) === e.target.value));
  });

  root.addEventListener("toggle", (e) => { if (e.target.id === "rpOpt") optOpen = e.target.open; }, true);

  window.Reco = {
    // 조회한 적이 없으면 버튼 하나뿐인 시작 화면, 조회한 결과가 있으면 다른 탭에 다녀와도 그 결과 그대로(다시 조회는 위쪽 버튼)
    async show() {
      if (!res) { render(); await load(); }
      dstate = await api.invoke("kw:drawState").catch(() => dstate);
      if (!started && dstate?.batches?.length) { restore(dstate.batches[0]); return; } // 껐다 켜도 마지막으로 받은 10개를 그대로
      render();
    },
  };
})();
