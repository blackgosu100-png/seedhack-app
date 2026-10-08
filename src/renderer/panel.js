// 신호등 패널 — 🔎 키워드 검색(쿠팡 지표 + 광고 가능성 + 리스트업 담기) / 🚦 카테고리 인기상품(신호등 판정)
(() => {
  const $ = (id) => document.getElementById(id);
  const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
  const won = (n) => (n == null || !Number.isFinite(+n) ? "-" : Math.round(n).toLocaleString("ko-KR"));
  const man = (n) => (n == null || !Number.isFinite(+n) ? "-" : n >= 1e8 ? (n / 1e8).toFixed(1) + "억" : n >= 1e4 ? Math.round(n / 1e4).toLocaleString("ko-KR") + "만" : won(n));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
  const range = (it) => (it.pvLo == null ? "-" : Math.max(0, it.pvLo) === 0 ? `~${won(it.pvHi)}` : `${won(Math.max(0, it.pvLo))}~${won(it.pvHi)}`);
  const key = (it) => `${it.pid}:${it.vid ?? ""}`;
  const clock = () => new Date().toLocaleTimeString("en-GB");
  const pct = (v, d = 1) => (v == null ? "-" : (v * 100).toFixed(d) + "%");
  const V = { GO: ["go", "GO · 소싱해 볼 만한 시장"], 검토: ["warn", "검토 · 조건부로 볼 만함"], "큰 시장": ["warn", "큰 시장 · 큰 시장 기준으로 보세요"], DROP: ["stop", "DROP · 다른 카테고리를 보세요"] };
  const AD_TXT = { go: "광고 시 여유", warn: "광고 시 빠듯", stop: "광고 시 적자" };
  // 광고 판정 = "광고로 1개 팔 때 드는 광고비(전환당 비용)"와 "1개 남는 돈(마진)" 비교. 카드·수집함·리스트업이 같이 쓴다.
  //  · 클릭비용 기본 145원, 광고 전환 비율 40% = 대표님 실제 광고 11개 캠페인(광고비 997만원·클릭 68,221·판매 1,675) 평균:
  //    평균 클릭비용 약 146원(VAT 포함), 광고 전환율 약 2.5% ≈ 상세페이지 전환율(6~7%)의 40%
  //  · 전환당 광고비 = 클릭비용 ÷ (상품 전환율 × 광고 전환 비율) → 마진의 2/3 이하 🟢, 마진 이하 🟡, 마진 초과 🔴
  const AdModel = window.AdModel = {
    cpc: 145, conv: 0.4,
    cpa(cvr) { return cvr > 0 ? this.cpc / (cvr * this.conv) : null; },
    judge(cpa, unitMargin) { if (cpa == null || unitMargin == null) return null; if (unitMargin <= 0) return "stop"; return cpa <= (unitMargin * 2) / 3 ? "go" : cpa <= unitMargin ? "warn" : "stop"; },
    note() { return `클릭비용 ${this.cpc}원 · 광고 전환 ${Math.round(this.conv * 100)}% 가정`; },
  };
  const api = window.signal;

  let pmode = "kw";          // 패널 모드
  let catData = null, kwData = null;
  let adsOn = true, revealTimer = null, busy = false;
  const cur = () => (pmode === "kw" ? kwData : catData);

  // ---------- 콘솔 ----------
  function log(cls, html) {
    const con = $("con");
    if (cls === "dim" && document.body.classList.contains("present")) return;
    const p = document.createElement("p");
    p.className = cls;
    p.innerHTML = `<span class="t">[${clock()}]</span> ${html}`;
    con.appendChild(p);
    while (con.childElementCount > 300) con.firstChild.remove();
    con.scrollTop = con.scrollHeight;
  }
  const prog = (r) => ($("prog").style.width = `${Math.max(0, Math.min(1, r)) * 100}%`);

  // ---------- 전환율 비교(🔥/❄) · 광고 가능성(최대 ROAS vs 본전 ROAS) ----------
  function enrich(d) {
    if (!d) return null;
    const margin = adsOn ? 0.3 : 0.2, end = 1 / margin;
    const withCvr = d.items.filter((it) => it.ex?.sales != null && it.ex?.views);
    const cvrs = withCvr.map((it) => it.ex.sales / it.ex.views).sort((a, b) => a - b);
    const med = cvrs.length ? (cvrs.length % 2 ? cvrs[(cvrs.length - 1) / 2] : (cvrs[cvrs.length / 2 - 1] + cvrs[cvrs.length / 2]) / 2) : null;
    for (const it of d.items) {
      const price = it.ex?.price ?? it.price;
      it.rev = it.ex?.sales != null && price ? it.ex.sales * price : null; // 28일 판매액
      if (!(it.ex?.sales != null && it.ex?.views)) { Object.assign(it, { cvr: null, rel: null, hot: null, maxRoas: null, endRoas: end, ad: null, cpa: null }); continue; }
      const cvr = it.ex.sales / it.ex.views;
      const rel = med && cvrs.length >= 3 ? cvr / med : null;
      const cpa = AdModel.cpa(cvr), unitM = price ? price * margin : null;
      const maxRoas = price ? (price * cvr * AdModel.conv) / AdModel.cpc : null;
      const beCpc = unitM != null ? unitM * cvr * AdModel.conv : null; // 이 클릭비용보다 비싸면 광고로 1개 팔 때 적자
      Object.assign(it, {
        cvr, rel, hot: rel == null ? null : rel >= 1.4 ? "hot" : rel <= 0.75 ? "cold" : null,
        maxRoas, endRoas: end, beCpc, optCpc: beCpc != null ? beCpc / 2 : null,
        cpa, unitM, ad: adsOn ? AdModel.judge(cpa, unitM) : null,
      });
      if (d.kind === "kw") it.light = it.ad; // 키워드 모드에서는 카드 점 = 광고 판정
    }
    const ads = d.items.filter((it) => it.ad);
    return { med, n: withCvr.length, hot: d.items.filter((it) => it.hot === "hot").length, end, margin,
      adGo: ads.filter((it) => it.ad === "go").length, adWarn: ads.filter((it) => it.ad === "warn").length, adStop: ads.filter((it) => it.ad === "stop").length,
      sales: withCvr.reduce((a, it) => a + it.ex.sales, 0), rev: d.items.reduce((a, it) => a + (it.rev || 0), 0) };
  }

  // ---------- 카드 ----------
  function cardHtml(it, i, d) {
    const ex = it.ex;
    const relTxt = it.rel != null ? ` <span class="rel ${it.hot || ""}">${it.hot === "hot" ? "🔥" : it.hot === "cold" ? "❄" : ""}${it.rel.toFixed(1)}배</span>` : "";
    const adRow = it.ad ? `<div class="ad ${it.ad}" title="전환당 광고비 = 클릭비용 ÷ (전환율 × 광고 전환 비율) · ${AdModel.note()} · 1개 마진 = 판매가 × 목표 마진(원가를 넣으면 리스트업에서 실제 마진으로 다시 판정)">
        <b>${it.ad === "go" ? "🟢" : it.ad === "warn" ? "🟡" : "🔴"} ${AD_TXT[it.ad]}</b>
        <span>1개 팔 때 광고비 약 ${won(it.cpa)}원 · 1개 마진 약 ${won(it.unitM)}원</span>
        <span>클릭당 ${won(it.beCpc)}원보다 비싸면 적자</span></div>` : "";
    const inList = d.kind === "kw" && window.Listup?.has(it.pid);
    const listBtn = d.kind === "kw" ? `<button class="addlist ${inList ? "in" : ""}" data-add="${i}" type="button">${inList ? "★ 리스트업에 담김" : "☆ 리스트업 담기"}</button>` : "";
    const link = `https://www.coupang.com/vp/products/${it.pid}${it.vid ? `?vendorItemId=${it.vid}` : ""}`;
    return `<div class="card" data-k="${esc(key(it))}" data-i="${i}">
      <div class="im">${it.img ? `<img loading="lazy" src="${esc(imgUrl(it.img))}" alt="">` : ""}<span class="rk">${it.order}${d.kind === "kw" ? "" : "위"}</span>${it.pb ? `<span class="pb" title="쿠팡 자체 브랜드 — 실판매 지표가 제공되지 않습니다">쿠팡 PB</span>` : ""}<span class="dot ${it.light || "none"}"></span></div>
      <div class="bd"><a class="nm" href="${esc(link)}" target="_blank" title="${esc(it.name)}">${esc(it.name)}</a>
        <div class="pr">${won(it.ex?.price ?? it.price)}원${priceTag(it)}${it.reviews != null ? `<small>★${it.rating ?? "-"} (${won(it.reviews)})</small>` : ""}</div>
        <div class="mt"><span>28일 판매</span><b class="${ex?.sales != null ? "ex" : ""}">${ex?.sales != null ? won(ex.sales) : "-"}</b>
          <span>판매액</span><b class="${it.rev != null ? "ex" : ""}">${it.rev != null ? man(it.rev) + "원" : "-"}</b>
          <span>28일 조회</span><b class="${ex?.views != null ? "ex" : ""}">${ex?.views != null ? won(ex.views) : range(it)}</b>
          <span>전환율</span><b class="${it.cvr != null ? "ex" : ""}">${pct(it.cvr)}${relTxt}</b></div>${adRow}${listBtn}</div></div>`;
  }

  const SORTS = {
    order: (a, b) => a.it.order - b.it.order,
    sales: (a, b) => (b.it.ex?.sales ?? -1) - (a.it.ex?.sales ?? -1),
    rev: (a, b) => (b.it.rev ?? -1) - (a.it.rev ?? -1),
    cvr: (a, b) => (b.it.cvr ?? -1) - (a.it.cvr ?? -1),
    price: (a, b) => (a.it.ex?.price ?? a.it.price ?? 1e12) - (b.it.ex?.price ?? b.it.price ?? 1e12),
  };
  function renderGrid(d, allOn = true) {
    if (!d) { $("grid").innerHTML = `<div class="empty">${pmode === "kw" ? "키워드를 검색하면<br>쿠팡 상품이 실지표와 함께 카드로 나타납니다." : "Wing에서 카테고리를 고르면<br>실제 인기상품이 여기 카드로 나타납니다."}</div>`; return; }
    const rows = d.items.map((it, i) => ({ it, i })).sort(SORTS[$("sortSel").value] || SORTS.order);
    $("grid").innerHTML = rows.map(({ it, i }) => cardHtml(it, i, d)).join("");
    if (allOn) document.querySelectorAll(".card").forEach((c) => c.classList.add("on"));
  }
  function refreshCard(i, flash) {
    const d = cur();
    const el = document.querySelector(`.card[data-i="${i}"]`);
    if (!d || !el) return;
    el.outerHTML = cardHtml(d.items[i], i, d);
    const nel = document.querySelector(`.card[data-i="${i}"]`);
    nel.classList.add("on");
    if (flash) { nel.classList.add("flash"); setTimeout(() => nel.classList.remove("flash"), 1600); }
  }

  function insight(d) {
    const e = enrich(d);
    if (!d) { $("insight").innerHTML = ""; $("counts").innerHTML = ""; return e; }
    if (d.kind === "kw") {
      $("counts").innerHTML = `<b class="g">🟢${e.adGo}</b> <b class="y">🟡${e.adWarn}</b> <b class="r">🔴${e.adStop}</b>`;
      $("insight").innerHTML = e.n
        ? `<span>상품 ${d.items.length}개 · 실판매 ${e.n}개</span><span>28일 판매 합 <b>${won(e.sales)}</b> · 판매액 <b>${man(e.rev)}원</b></span>
           <span>중앙 전환율 <b>${pct(e.med)}</b> · 🔥 <b>${e.hot}</b></span><span>가격 <b>${won(d.minPrice)}~${won(d.maxPrice)}원</b></span>
           <span>광고 <b class="g">🟢${e.adGo}</b> <b class="y">🟡${e.adWarn}</b> <b class="r">🔴${e.adStop}</b> <small>(목표 마진 ${Math.round(e.margin * 100)}% · ${AdModel.note()})</small></span>`
        : `<span class="dim">이 검색 결과에는 실판매 지표가 있는 상품이 없습니다.</span>`;
    } else {
      const c = { go: 0, warn: 0, stop: 0 };
      d.items.forEach((it) => c[it.light] != null && c[it.light]++);
      $("counts").innerHTML = `<b class="g">●${c.go}</b> <b class="y">●${c.warn}</b> <b class="r">●${c.stop}</b>`;
      $("insight").innerHTML = e && e.n
        ? `<span>실판매 ${e.n}개 · 중앙 전환율 <b>${pct(e.med)}</b></span><span>🔥 전환율 상위 <b>${e.hot}</b></span>
           <span>광고 <b class="g">🟢${e.adGo}</b> <b class="y">🟡${e.adWarn}</b> <b class="r">🔴${e.adStop}</b> <small>(목표 마진 ${Math.round(e.margin * 100)}% · ${AdModel.note()})</small></span>`
        : `<span class="dim">🎯 Wing 28일 판매량을 받으면 전환율 비교(🔥)와 광고 가능성(🟢🟡🔴)이 나옵니다</span>`;
    }
    return e;
  }

  // ---------- 모드 전환 ----------
  function setMode(m) {
    pmode = m;
    $("pmKw").setAttribute("aria-pressed", String(m === "kw"));
    $("pmCat").setAttribute("aria-pressed", String(m === "cat"));
    $("kwBox").hidden = m !== "kw";
    $("catBox").hidden = m !== "cat";
    $("bExact").hidden = m !== "cat";
    $("bExact").disabled = !catData || busy;
    $("bXlsx").disabled = !cur();
    insight(cur());
    renderGrid(cur());
  }
  $("pmKw").onclick = () => go("kw");
  $("pmCat").onclick = () => go("cat");

  // ---------- 화면 전환(왼쪽 사이드바) ----------
  // view: 지금 본문에 보이는 화면. kw·cat은 패널 화면(cat = Wing 화면 + 오른쪽 판정 칸), 나머지는 메인 프로세스의 탭과 같다.
  const VIEWS = {
    kw: ["🔎 키워드 분석", "키워드 하나로 쿠팡 상품의 실판매·쿠폰가·광고 가능성을 한 번에"],
    cat: ["🚦 카테고리 판정", "Wing 쿠팡 트렌드 → 인기상품 검색에서 카테고리를 고르면 오른쪽 칸이 판정합니다"],
    wing: ["🔑 Wing 로그인", "Wing에 로그인해 두면 판매량·조회수를 받아 옵니다"],
    clean: ["🛒 쿠팡 검색", "쿠키 없는 클린 세션 — 개인화 없는 검색 순위"],
    collect: ["📦 수집함", "쿠팡 화면과 키워드 분석에서 본 상품이 자동으로 쌓입니다"],
    list: ["📋 리스트업", "고른 상품의 1688 원가·마진 계산"],
    cn: ["🇨🇳 1688", "이미지 검색 · 상품 페이지에서 리스트업에 넣기"],
    chat: ["💬 판매자 문의", "한글로 묻고 중국어로 보내기 · 답이 오면 다음 질문을 이어 보냄"],
    dash: ["📊 판매 관리", "로켓그로스 대시보드"],
  };
  const DASH = { margin: "📊 마진 대시보드", ads: "🎯 광고 보고서", coupons: "🎟️ 쿠폰 관리", stock: "🏬 재고 조회" };
  const SITE_VIEWS = new Set(["cat", "wing", "clean", "cn", "chat", "dash"]); // 머리줄에 주소창이 보이는 화면
  let view = "wing", dashId = null, sideMin = false;
  try { sideMin = localStorage.getItem("sideMin") === "1"; } catch {}
  // 메인 프로세스에 틀 크기(사이드바 폭 · Wing 오른쪽 칸 폭)를 알린다
  const frame = () => {
    document.body.classList.toggle("side-min", sideMin);
    $("sideFold").textContent = sideMin ? "»" : "«";
    $("sideFold").title = sideMin ? "사이드바 펼치기" : "사이드바 접기";
    const strip = view === "cat" || document.body.classList.contains("locked") ? 400 : 0;
    api.invoke("ui:frame", { side: sideMin ? 64 : 200, strip });
  };
  function showView(v, dash) {
    view = v;
    if (v === "dash" && dash) dashId = dash;
    document.body.dataset.view = v;
    document.body.classList.toggle("site-on", SITE_VIEWS.has(v));
    document.querySelectorAll("#nav .nav-item").forEach((b) => b.classList.toggle("on", b.dataset.view === v && (v !== "dash" || b.dataset.dash === dashId)));
    const [t, d] = VIEWS[v] || ["", ""];
    $("vTitle").textContent = v === "dash" ? DASH[dashId] || t : t;
    $("vDesc").textContent = d;
    $("ctabs").hidden = v !== "clean";
    $("bNewClean").hidden = v !== "clean";
    $("listup").hidden = v !== "list";
    $("collect").hidden = v !== "collect";
    $("siteHint").hidden = v === "list" || v === "collect" || v === "kw";
    $("hintT").textContent = v === "dash" ? "로켓그로스 대시보드를 불러오는 중입니다…" : "화면을 불러오는 중입니다…";
    if (v === "kw" || v === "cat") { if (pmode !== v) setMode(v); }
    frame();
  }
  // 사이드바에서 고른 화면으로: 메인 프로세스 탭을 바꾸고(kw는 사이트 화면을 모두 숨김) 화면을 그린다
  function go(v, dash) {
    const tab = v === "cat" ? "wing" : v === "dash" ? `dash:${dash || dashId || "margin"}` : v;
    showView(v, dash);
    api.invoke("nav:tab", tab);
    if (v === "kw") setTimeout(() => $("kwInput").focus(), 30);
  }
  $("nav").addEventListener("click", (e) => {
    const b = e.target.closest(".nav-item");
    if (b && !b.disabled) go(b.dataset.view, b.dataset.dash);
  });
  $("sideFold").onclick = () => { sideMin = !sideMin; try { localStorage.setItem("sideMin", sideMin ? "1" : "0"); } catch {} frame(); };
  new MutationObserver(frame).observe(document.body, { attributes: true, attributeFilter: ["class"] }); // 잠금이 바뀌면 Wing 오른쪽 칸도
  // 사이드바 아래: Wing 로그인 상태 · 오늘 Wing 검색(하루 예산)
  async function footStatus() {
    const c = await api.invoke("check:status").catch(() => null);
    const b = await api.invoke("budget:get").catch(() => null);
    if (c) {
      $("sWing").className = "st " + (c.wing === "ok" && !c.gate ? "ok" : c.wing === "login" || c.gate ? "bad" : "");
      $("sWingT").textContent = c.gate ? "Wing 조회 정지 중" : c.wing === "ok" ? "Wing 연결됨" : c.wing === "login" ? "Wing 로그인 필요" : "Wing 확인 중";
      $("sWing").title = c.gate ? `${c.gate.reason} · ${new Date(c.gate.until).toLocaleTimeString("ko-KR")}까지` : "Wing 로그인 상태";
    }
    if (b) {
      const used = b.used ?? c?.today ?? 0;
      $("sBudget").innerHTML = b.budget ? `오늘 Wing 검색 <b>${used}</b> / ${b.budget}<div class="bar"><i style="width:${Math.min(100, (used / b.budget) * 100)}%"></i></div>` : `오늘 Wing 검색 <b>${used}</b>회`;
    }
  }
  footStatus();
  setInterval(footStatus, 30000);

  // ---------- 쿠폰가 ----------
  // Wing 상품 매칭 검색의 가격(salePrice)은 쿠폰·즉시할인 적용 전 판매가다. 손님이 실제로 내는 가격은 쿠팡 검색 화면 카드에 있다.
  //  ② 검색할 때 쿠팡 탭에 같은 검색어를 1번 열면 coupang.cjs가 3초 뒤 카드 가격을 수집함에 넣는다(이 검색어의 pos.ts가 새로 생김)
  //  ① 이번 쿠팡 화면에 없던 상품은 예전에 쿠팡 화면에서 본 가격을 쓰고, 그것도 없으면 "쿠폰 전"으로 표시한다
  const CP_WAIT = 12000; // 검색 시작부터 쿠팡 화면 가격을 기다리는 최대 시간
  let cpWaiter = null;
  api.on("collect:changed", () => cpWaiter?.());
  function waitCoupangPage(kw, since, ms) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (rows) => { if (done) return; done = true; cpWaiter = null; clearTimeout(t); resolve(rows || []); };
      const check = async () => {
        const rows = await api.invoke("collect:get").catch(() => null);
        if (rows?.some((r) => r.pos?.[kw]?.ts >= since)) finish(rows);
      };
      cpWaiter = check;
      const t = setTimeout(async () => finish(await api.invoke("collect:get").catch(() => [])), ms);
      check();
    });
  }
  function applyCouponPrices(items, rows, kw, since) {
    const by = new Map((rows || []).map((r) => [String(r.pid), r]));
    const c = { now: 0, seen: 0, none: 0, off: [] };
    for (const it of items) {
      const r = by.get(String(it.pid));
      const seenTs = r?.pos ? Math.max(0, ...Object.values(r.pos).map((p) => p?.ts || 0)) : 0; // 쿠팡 화면에서 본 적 있는 상품만 pos가 있다
      const wingP = it.ex?.price ?? it.price;
      it.listPrice = wingP;
      if (r?.price > 0 && seenTs) {
        const fresh = r.pos?.[kw]?.ts >= since;
        it.price = r.price;
        if (it.ex) it.ex = { ...it.ex, price: r.price };
        it.priceSrc = fresh ? "now" : "seen"; it.priceTs = seenTs;
        fresh ? c.now++ : c.seen++;
        if (wingP > 0 && r.price !== wingP) c.off.push(r.price / wingP - 1);
      } else { it.priceSrc = "wing"; c.none++; }
    }
    return c;
  }
  const priceTag = (it) => {
    if (it.priceSrc === "wing") return ` <small class="ptag nc" title="Wing 판매가 — 쿠폰·즉시할인 적용 전 가격입니다(쿠팡 화면에서 아직 못 본 상품)">쿠폰 전</small>`;
    if (!it.priceSrc) return "";
    const when = it.priceSrc === "seen" ? ` · ${new Date(it.priceTs).toLocaleDateString("ko-KR")} 쿠팡 화면` : " · 방금 쿠팡 화면";
    const was = it.listPrice > 0 && it.listPrice !== it.price ? ` <s>${won(it.listPrice)}</s>` : "";
    return ` <small class="ptag cp" title="손님이 실제로 내는 가격(쿠폰·즉시할인 적용)${when}${it.listPrice ? ` · Wing 판매가 ${won(it.listPrice)}원` : ""}">쿠폰가${it.priceSrc === "seen" ? "·이전" : ""}</small>${was}`;
  };

  // ---------- 🔎 키워드 검색 ----------
  async function runSearch(keyword, force = false) {
    const kw = String(keyword || "").trim();
    if (!kw) return;
    $("kwInput").value = kw;
    const pages = Number($("kwPages").value) || 1;
    log("sys", `▶ 키워드 검색: <b>${esc(kw)}</b> · ${pages}페이지 (페이지마다 Wing 검색 1회)`);
    prog(0.15);
    $("kwForm").querySelector("button").disabled = true;
    $("kwForm").querySelector("button").textContent = "검색 중…";
    const scan = window.AiScan?.start(kw); // 시연용 AI 분석 화면(실제 값만 표시)
    const since = Date.now();
    if (view !== "kw") go("kw");
    const cpOpen = api.invoke("kw:coupang", kw).catch(() => false); // ② 쿠팡 탭에서 같은 검색어 1번(뒤에서) → 카드 가격(쿠폰가)을 수집함에 읽어 둔다
    if (scan) api.invoke("kw:db", kw).then((db) => scan.db(db)).catch(() => scan.db(null));
    const r = await api.invoke("kw:search", { keyword: kw, pages, force }).catch((err) => ({ error: err?.message || String(err) }));
    $("kwForm").querySelector("button").disabled = false;
    $("kwForm").querySelector("button").textContent = "검색";
    prog(1);
    renderStat(kw, r?.db);
    if (!r || r.error) { scan?.fail(r?.error || "검색하지 못했습니다."); log("stop", `✕ ${esc(r?.error || "검색하지 못했습니다.")}`); return; }
    if (r.items.length) {
      scan?.note("sys", "↗ 쿠팡 검색 화면에서 실제 판매가(쿠폰·즉시할인 적용가) 읽는 중", "쿠팡 화면 가격 확인 중");
      const rows = (await cpOpen) ? await waitCoupangPage(kw, since, Math.max(1500, CP_WAIT - (Date.now() - since))) : await api.invoke("collect:get").catch(() => []); // 쿠팡 화면을 못 열었으면 예전에 본 가격만
      const c = applyCouponPrices(r.items, rows, kw, since);
      const avg = c.off.length ? c.off.reduce((a, b) => a + b, 0) / c.off.length : 0;
      const msg = `쿠폰가 반영 ${c.now + c.seen}/${r.items.length}개 (이번 쿠팡 화면 ${c.now} · 예전에 본 가격 ${c.seen})${c.off.length ? ` · Wing 판매가와 다름 ${c.off.length}개, 평균 ${(avg * 100).toFixed(1)}%` : ""}${c.none ? ` · 쿠폰 전 가격 ${c.none}개` : ""}`;
      log(c.now + c.seen ? "go" : "warn", `${c.now + c.seen ? "✔" : "△"} ${msg}`);
      scan?.note(c.now + c.seen ? "go" : "warn", `${c.now + c.seen ? "✔" : "△"} ${esc(msg)}`);
    }
    const prices = r.items.slice(0, 36).map((it) => it.price ?? it.ex?.price).filter((p) => p > 0); // 1페이지 범위
    kwData = { kind: "kw", keyword: kw, date: new Date().toISOString().slice(0, 10), db: r.db, items: r.items,
      minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null };
    if (!r.items.length) { scan?.fail("검색 결과가 없습니다. 다른 표현으로 검색해 보세요."); log("warn", "△ 검색 결과가 없습니다. 다른 표현으로 검색해 보세요."); renderGrid(null); return; }
    if (r.items.every((it) => !it.img)) log("dim", `  (응답에 상품 이미지 필드가 없어 사진 없이 표시합니다 · 필드: ${esc((r.fields || []).slice(0, 12).join(", "))})`);
    const e = insight(kwData);
    renderGrid(kwData, false);
    $("bXlsx").disabled = false;
    if (scan) await scan.analyze(kwData.items, e, { cached: r.cached });
    // 카드가 하나씩 나타나는 연출 + 콘솔
    const order = [...document.querySelectorAll(".card")];
    let i = 0;
    clearInterval(revealTimer);
    const step = () => {
      const el = order[i];
      if (!el) {
        clearInterval(revealTimer);
        kwData.items.filter((it) => it.hot === "hot").slice(0, 5).forEach((it) => log("go", `🔥 전환율 상위 · ${esc(it.name.slice(0, 24))} — 전환율 ${pct(it.cvr)} (중앙 ${pct(e.med)}의 ${it.rel.toFixed(1)}배)`));
        log("sys", `■ '${esc(kw)}' 상품 ${kwData.items.length}개 · 28일 판매 합 ${won(e.sales)} · 판매액 ${man(e.rev)}원 · 광고 🟢${e.adGo} 🟡${e.adWarn} 🔴${e.adStop}${r.cached ? " · 저장된 결과" : ""}`);
        return;
      }
      el.classList.add("on");
      const it = kwData.items[+el.dataset.i];
      if (i < 15) log(it.ad || "dim", `${it.ad === "go" ? "✔" : it.ad === "warn" ? "△" : it.ad === "stop" ? "✕" : "·"} ${esc(it.name.slice(0, 24))} <span class="dim">· 판매 ${won(it.ex?.sales)} · ${man(it.rev)}원 · 전환 ${pct(it.cvr)}</span>`);
      prog((i + 1) / order.length);
      i++;
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { order.forEach((c) => c.classList.add("on")); } else revealTimer = setInterval(step, 90);
  }
  function renderStat(kw, db) {
    const m = db?.main;
    $("kwStat").innerHTML = m
      ? `<span><b>${esc(kw)}</b> 네이버 월검색 <b>${won(m.m1)}</b></span><span>쿠팡 평균가 ${won(m.price)}원</span><span>1위 리뷰 ${won(m.mx)}</span><span>로켓 ${m.rocket != null ? Math.round(m.rocket * 100) + "%" : "-"}</span>${m.brand ? `<span class="warn">브랜드 키워드</span>` : ""}${m.season ? `<span class="warn">계절성 ${m.peak ? m.peak + "월 정점" : ""}</span>` : ""}`
      : db?.month ? `<span class="dim">'${esc(kw)}'는 제휴 키워드 DB(${db.month})에 없습니다. 쿠팡 지표만 표시합니다.</span>` : `<span class="dim">제휴 키워드 DB가 없어 월검색량은 표시하지 않습니다(~/sellar-data).</span>`;
    $("kwSubs").innerHTML = (db?.subs || []).length
      ? `<span class="lbl">서브키워드</span>` + db.subs.slice(0, 12).map((s) => `<button type="button" data-kw="${esc(s.kw)}" class="${s.brand ? "brand" : ""}" title="${s.brand ? "브랜드 키워드" : ""}">${esc(s.kw)} <small>${won(s.m1)}</small></button>`).join("")
      : "";
  }
  $("kwForm").addEventListener("submit", (e) => { e.preventDefault(); runSearch($("kwInput").value); });
  $("kwSubs").addEventListener("click", (e) => { const b = e.target.closest("button[data-kw]"); if (b) runSearch(b.dataset.kw); });

  // 카드의 ☆ 리스트업 담기
  $("grid").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-add]");
    if (!b || !kwData) return;
    const it = kwData.items[+b.dataset.add];
    if (window.Listup?.has(it.pid)) { api.invoke("nav:tab", "list"); return; }
    const sub = (kwData.db?.subs || []).find((s) => !s.brand);
    window.Listup.add({
      keyword: kwData.keyword, kwVol: kwData.db?.main?.m1 ?? null, subKw: sub?.kw || "", subVol: sub?.m1 ?? null,
      subs: (kwData.db?.subs || []).slice(0, 15).map((s) => ({ kw: s.kw, m1: s.m1, brand: s.brand })),
      maxPrice: kwData.maxPrice, minPrice: kwData.minPrice, name: it.name, pid: it.pid,
      benchUrl: `https://www.coupang.com/vp/products/${it.pid}${it.vid ? `?vendorItemId=${it.vid}` : ""}`, img: it.img,
      bSales: it.ex?.sales ?? null, bViews: it.ex?.views ?? null, bCvr: it.cvr, ad: it.ad, maxRoas: it.maxRoas,
      monthly: "", benchMonthly: it.ex?.sales != null ? Math.round((it.ex.sales * 30) / 28) : null, benchPrice: it.price ?? it.ex?.price,
    });
    log("go", `☆ 리스트업에 담음 · ${esc(it.name.slice(0, 26))} — 리스트업에서 위안과 내 예상 월판매량을 넣으세요`);
    refreshCard(+b.dataset.add, true);
  });

  // ---------- 🚦 카테고리 인기상품 (Wing 인기상품 응답) ----------
  function setVerdict(d) {
    const [cls, txt] = V[d.verdict] || ["wait", d.verdict];
    $("tl").className = "tl " + cls;
    $("call").className = "call " + cls;
    $("call").textContent = txt;
    $("chips").innerHTML = d.checks.map((c) => `<span class="${c.pass === true ? "p" : c.pass === false ? "f" : "u"}" title="${esc(c.need)}">${c.pass === true ? "○" : c.pass === false ? "✕" : "?"} ${esc(c.label)}</span>`).join("");
    $("yuan").innerHTML = d.yuan != null && d.yuan > 0
      ? `1688 허용 소싱가 <b>¥${d.yuan.toFixed(1)}</b> 이하 · 목표가 ${won(d.target)}원 · ${d.mode === "big" ? "큰 시장" : "틈새"} · ${d.ads ? "광고 함(30%)" : "광고 안 함(20%)"}`
      : `이 가격대로는 남는 원가가 없습니다`;
  }
  function showCat(d) {
    d.kind = "cat";
    const exByKey = Object.fromEntries((catData?.key === d.key ? catData.items : []).filter((it) => it.ex).map((it) => [key(it), it.ex]));
    d.items.forEach((it) => { if (!it.ex && exByKey[key(it)]) it.ex = exByKey[key(it)]; });
    catData = d;
    if (view === "wing") showView("cat"); // Wing 화면을 보는 중이면 오른쪽 판정 칸을 연다
    else if (pmode !== "cat" && view !== "kw") setMode("cat");
    clearInterval(revealTimer);
    $("cat").textContent = `Wing 쿠팡 트렌드 · ${d.path ? d.path + " > " : ""}${d.name} · ${d.date}`;
    $("call").className = "call wait"; $("call").textContent = "판정 중…";
    $("tl").className = "tl"; $("chips").innerHTML = ""; $("yuan").textContent = "";
    enrich(d);
    renderGrid(d, false);
    $("insight").innerHTML = ""; $("counts").innerHTML = "";
    $("bExact").disabled = busy; $("bXlsx").disabled = false;
    log("dim", `  기준: ${d.mode === "big" ? "큰 시장(리뷰 500+ 수요 검증)" : "틈새(1위 리뷰 100 미만이 유리)"} · 이미지·리뷰·28일 조회 = Wing 실데이터 · 전체 ${won(d.total)}개 중 상위 ${d.items.length}개`);
    const cards = [...document.querySelectorAll(".card")];
    let i = 0;
    const finish = () => {
      clearInterval(revealTimer);
      setVerdict(d); insight(d);
      log(V[d.verdict]?.[0] || "sys", `■ 카테고리 판정: <b>${esc(d.verdict)}</b>${d.yuan > 0 ? ` · 1688 ¥${d.yuan.toFixed(1)} 이하` : ""}${d.note ? ` · ${esc(d.note)}` : ""}`);
    };
    const step = () => {
      const el = cards[i];
      if (!el) return finish();
      el.classList.add("on");
      const it = d.items[+el.dataset.i];
      const mark = it.light === "go" ? "✔" : it.light === "warn" ? "△" : "✕";
      if (i < 12 || it.light === "go") log(it.light, `${mark} ${it.order}위 ${esc(it.name.slice(0, 26))} <span class="dim">· 리뷰 ${won(it.reviews)} · 28일 조회 ${it.ex?.views != null ? won(it.ex.views) : range(it)}</span>`);
      prog((i + 1) / cards.length);
      i++;
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { cards.forEach((c) => c.classList.add("on")); finish(); }
    else revealTimer = setInterval(step, 110);
  }
  function updateCat(d) {
    if (!d || !catData) return;
    const exByKey = Object.fromEntries(catData.items.filter((it) => it.ex).map((it) => [key(it), it.ex]));
    d.kind = "cat";
    d.items.forEach((it) => { if (!it.ex && exByKey[key(it)]) it.ex = exByKey[key(it)]; });
    const same = catData.key === d.key;
    catData = d;
    if (pmode !== "cat") return;
    setVerdict(d); insight(d); renderGrid(d);
    if (same) log(V[d.verdict]?.[0] || "sys", `■ 판정 갱신: <b>${esc(d.verdict)}</b>`);
  }

  // ---------- 메인 프로세스 이벤트 ----------
  api.on("console", ({ cls, text }) => { log(cls, esc(text)); window.AiScan?.current?.console(cls, text); });
  api.on("live", (d) => showCat(d));
  api.on("live:refresh", (d) => updateCat(d));
  api.on("nav", ({ tab, url, dash }) => {
    // 메인 프로세스가 탭을 바꾼 경우(쿠팡 새 탭, 리스트업 → 1688, 잠금 등)에도 화면을 맞춘다. Wing은 판정 칸을 보던 중이면 유지
    const v = tab === "wing" && view === "cat" ? "cat" : tab;
    if (v !== view || (v === "dash" && dash && dash !== dashId)) showView(v, dash);
    if (document.activeElement !== $("url")) $("url").value = url || "";
    if (tab === "list") window.Listup?.render();
    if (tab === "collect") window.Collect?.load();
    if (tab === "wing") footStatus();
  });
  api.on("exact:progress", ({ pos, total, status, msg }) => {
    prog(total ? pos / total : 0);
    const cls = /✕|실패|제한|정지|한도|로그인/.test(msg) ? "stop" : status === "done" ? "sys" : /재사용/.test(msg) ? "dim" : "go";
    log(cls, `${status === "done" ? "■" : "↳"} [${pos}/${total}] ${esc(msg)}`);
    if (["done", "stopped", "paused"].includes(status)) {
      busy = false; $("bExact").disabled = !catData; $("bStop").hidden = true;
      if (status === "done" && catData) {
        const e = enrich(catData);
        catData.items.filter((it) => it.hot === "hot").forEach((it) => log("go", `🔥 전환율 상위 · ${esc(it.name.slice(0, 24))} — 전환율 ${pct(it.cvr)} (중앙 ${pct(e.med)}의 ${it.rel.toFixed(1)}배)`));
        if (e?.n) log("sys", `■ 전환율 비교·광고 가능성: 🔥${e.hot} · 광고 🟢${e.adGo} 🟡${e.adWarn} 🔴${e.adStop} (본전 ROAS ${Math.round(e.end * 100)}%)`);
      }
    }
  });
  api.on("exact:item", ({ key: k, ex }) => {
    if (!catData) return;
    const idx = catData.items.findIndex((it) => key(it) === k);
    if (idx < 0) return;
    catData.items[idx].ex = ex;
    if (pmode !== "cat") return;
    insight(catData);
    catData.items.forEach((it, i) => it.ex && refreshCard(i, i === idx));
    const it = catData.items[idx];
    if (it.ad === "stop") log("stop", `🔴 광고 시 적자 · ${esc(it.name.slice(0, 22))} — 1개당 광고비 약 ${won(it.cpa)}원 > 마진 약 ${won(it.unitM)}원`);
  });
  // 자동 업데이트: 새 버전을 다 받으면 버튼 표시
  api.on("update", ({ version }) => { $("bUpdate").hidden = false; $("bUpdate").textContent = `⬆ ${version} 업데이트 · 다시 시작`; });
  $("bUpdate").onclick = () => { $("bUpdate").disabled = true; $("bUpdate").textContent = "설치 중…"; api.invoke("update:install"); };
  const showVer = (v) => { if (!v) return; $("appVer").textContent = `v${v}`; $("gateVer").textContent = `v${v}`; document.querySelector(".side .brand").title = `씨드핵 SEEDHACK v${v} — 매일 한 톨, 시스템처럼.`; };
  api.on("version", showVer);
  api.invoke("app:version").then(showVer);
  // ② 쿠팡 검색 탭 줄 — 같은 클린 세션 안의 여러 탭
  const tabName = (t) => {
    try {
      const u = new URL(t.url);
      const q = u.searchParams.get("q");
      if (q) return `🔍 ${q}`;
      if (/\/np\/categories\//.test(u.pathname)) return `📂 ${t.title.replace(/\s*[-|:]\s*쿠팡.*$/, "").replace(/^쿠팡!?\s*[-|:]?\s*/, "") || "카테고리"}`;
    } catch {}
    return t.title.replace(/\s*[-|:]\s*쿠팡!?.*$/, "").replace(/^쿠팡!?\s*[-|:]?\s*/, "") || "쿠팡";
  };
  api.on("ctabs", ({ tabs, active }) => {
    $("ctabs").innerHTML = tabs.map((t) => `<div class="ctab ${t.id === active ? "on" : ""}" role="tab" aria-selected="${t.id === active}" data-id="${t.id}" title="${esc(t.title)}\n${esc(t.url)}">
      ${t.loading ? `<i class="spin"></i>` : ""}<span>${esc(tabName(t))}</span><button type="button" class="x" data-close="${t.id}" title="탭 닫기">×</button></div>`).join("") +
      `<button type="button" class="ctab-new" id="ctabNew" title="새 탭 (쿠팡 첫 화면)">+</button>`;
  });
  $("ctabs").addEventListener("click", (e) => {
    const x = e.target.closest("[data-close]");
    if (x) { api.invoke("ctab:close", +x.dataset.close); return; }
    if (e.target.closest("#ctabNew")) { api.invoke("ctab:new"); return; }
    const t = e.target.closest(".ctab");
    if (t) api.invoke("ctab:select", +t.dataset.id);
  });
  // 가운데 버튼 클릭 = 탭 닫기 (브라우저와 같게)
  $("ctabs").addEventListener("auxclick", (e) => { const t = e.target.closest(".ctab"); if (t && e.button === 1) api.invoke("ctab:close", +t.dataset.id); });
  api.on("excel:log", ({ cls, text, p }) => { log(cls, esc(text)); if (p != null) prog(p); });

  // ---------- 버튼 ----------
  // 💬 진행 중인 문의 수 · 직접 확인이 필요하면 주황
  api.on("chat:count", ({ n, handoff }) => { const b = $("chcount"); b.hidden = !n; b.textContent = handoff ? `👤${handoff}` : n; b.classList.toggle("gray", !handoff); b.style.background = handoff ? "#ffb454" : ""; });
  api.invoke("chat:act", { a: "count" });
  $("urlForm").addEventListener("submit", (e) => { e.preventDefault(); api.invoke("nav:go", $("url").value); $("url").blur(); });
  $("url").addEventListener("focus", () => $("url").select());
  $("url").addEventListener("keydown", (e) => { if (e.key === "Escape") $("url").blur(); });
  $("bBack").onclick = () => api.invoke("nav:back");
  $("bReload").onclick = () => api.invoke("nav:reload");
  $("bHome").onclick = () => api.invoke("nav:home");
  $("bNewClean").onclick = () => api.invoke("nav:newClean");
  // 발표 모드: 확대 1.25배 + 기록 창 축소 + 진단·저장값 같은 내부 문구 숨김
  const setPresent = async (on) => {
    document.body.classList.toggle("present", on);
    $("bPresent").setAttribute("aria-pressed", String(on));
    await api.invoke("view:zoom", on ? 1.25 : 1);
    try { localStorage.setItem("present", on ? "1" : "0"); } catch {}
  };
  $("bPresent").onclick = async () => {
    const on = !document.body.classList.contains("present");
    await setPresent(on);
    if (on) precheck();
  };
  // 사전 점검: 시연 직전에 로그인·정지·사용량을 한 줄로
  async function precheck() {
    const c = await api.invoke("check:status");
    const wing = c.wing === "ok" ? "✔ Wing 로그인됨" : c.wing === "login" ? "✕ Wing 로그인 필요 (① 탭)" : "△ Wing 화면 확인 필요";
    const g = c.gate ? `✕ 조회 정지: ${c.gate.reason} (${new Date(c.gate.until).toLocaleTimeString("ko-KR")}까지)` : "✔ 조회 가능";
    log(c.wing === "ok" && !c.gate ? "go" : "stop", `점검 · ${wing} · ${g} · 오늘 조회 ${c.today}건 · 최근 10분 ${c.win10}/60건 · 수집함 ${c.collect}개`);
  }
  try { if (localStorage.getItem("present") === "1") setPresent(true); } catch {}
  $("bJudge").onclick = async () => {
    log("sys", "▶ 지금 보고 있는 카테고리를 판정합니다");
    const d = await api.invoke("live:open");
    if (!d || d.error) return log("stop", `✕ ${esc(d?.error || "데이터를 불러오지 못했습니다.")}`);
    showCat(d);
  };
  $("bExact").onclick = async () => {
    if (!catData || busy) return;
    // 쿠팡 PB(코멧 등)는 판매자 상품 매칭에 지표가 없으므로 빼고, 다음 상품으로 10개를 채운다
    const pbSkip = catData.items.filter((it) => it.pb).slice(0, 20);
    const need = catData.items.filter((it) => !it.pb).slice(0, 10).filter((it) => !it.ex);
    if (pbSkip.length) log("dim", `  쿠팡 PB ${pbSkip.length}개(${esc(pbSkip.slice(0, 3).map((it) => it.brand || it.name.split(" ")[0]).join(", "))}${pbSkip.length > 3 ? " 등" : ""})는 지표가 제공되지 않아 제외하고 다음 상품으로 채웁니다`);
    if (!need.length) return log("sys", "▶ 상위 10개(PB 제외) 모두 정확한 지표가 이미 있습니다.");
    const b = await api.invoke("budget:get");
    busy = true; $("bExact").disabled = true; $("bStop").hidden = false;
    log("sys", `▶ 정확한 28일 조회·판매량 조회 · ${need.length}개 · Wing 상품 매칭 검색(요청 간격 4초)${b.budget ? ` · 하루 예산 ${b.used}/${b.budget}` : ""}`);
    const r = await api.invoke("exact:start", need.map((it) => ({ pid: it.pid, vid: it.vid, iid: it.iid, name: it.name })));
    if (r?.error) { log("stop", `✕ ${esc(r.error)}`); busy = false; $("bExact").disabled = false; $("bStop").hidden = true; }
  };
  $("bStop").onclick = () => api.invoke("exact:stop");
  $("bXlsx").onclick = async () => {
    const d = cur();
    if (!d) return;
    $("bXlsx").disabled = true;
    const payload = d.kind === "kw"
      ? { name: d.keyword, path: "키워드 검색", date: d.date, verdict: "키워드 검색", yuan: null, target: null,
          items: d.items.map((it) => ({ ...it, light: it.ad || "warn" })) }
      : d;
    const r = await api.invoke("excel:save", payload);
    if (r?.cancelled) log("dim", "  저장을 취소했습니다.");
    $("bXlsx").disabled = false;
  };
  $("sortSel").onchange = () => renderGrid(cur());

  const press = (on, off) => { $(on).setAttribute("aria-pressed", "true"); $(off).setAttribute("aria-pressed", "false"); };
  async function setCatSetting(patch) {
    const d = await api.invoke("settings:set", patch);
    if (d) updateCat(d);
  }
  $("mNiche").onclick = () => { press("mNiche", "mBig"); setCatSetting({ mode: "niche" }); };
  $("mBig").onclick = () => { press("mBig", "mNiche"); setCatSetting({ mode: "big" }); };
  const setAds = (on) => {
    adsOn = on;
    // 광고 계획 하나로 카드·수집함·리스트업을 같이 바꾼다 (안 함 = 리스트업 광고비 0%, 목표 마진 20%)
    api.invoke("calc:get").then((c) => {
      const patch = on ? { adRate: c.adRate > 0 ? c.adRate : c.lastAdRate || 0.1 } : { adRate: 0, lastAdRate: c.adRate > 0 ? c.adRate : c.lastAdRate || 0.1 };
      return api.invoke("calc:set", patch);
    }).then(() => { window.Listup?.reloadCfg(); window.Collect?.load(); });
    press(on ? "adOn" : "adOff", on ? "adOff" : "adOn");
    if (pmode === "kw") { insight(kwData); renderGrid(kwData); }
    setCatSetting({ ads: on });
  };
  const adModelChanged = (patch) => {
    api.invoke("settings:set", patch).then((d) => { if (d) updateCat(d); window.Collect?.load(); window.Listup?.reloadCfg(); });
    if (pmode === "kw") { insight(kwData); renderGrid(kwData); }
  };
  $("cpcIn").addEventListener("change", () => {
    const v = Math.max(50, Math.round(+$("cpcIn").value || 145));
    $("cpcIn").value = v; AdModel.cpc = v; adModelChanged({ adCpc: v });
  });
  $("convIn").addEventListener("change", () => {
    const v = Math.min(100, Math.max(5, Math.round(+$("convIn").value || 40)));
    $("convIn").value = v; AdModel.conv = v / 100; adModelChanged({ adConv: v / 100 });
  });
  $("adOn").onclick = () => setAds(true);
  $("adOff").onclick = () => setAds(false);

  api.invoke("settings:get").then((st) => {
    if (st.mode === "big") press("mBig", "mNiche");
    if (st.ads === false) { adsOn = false; press("adOff", "adOn"); }
    if (st.adCpc > 0) AdModel.cpc = st.adCpc;
    if (st.adConv > 0) AdModel.conv = st.adConv;
    $("cpcIn").value = AdModel.cpc; $("convIn").value = Math.round(AdModel.conv * 100);
  });

  // 리스트업 화면이 담김 상태를 바꾸면 카드 버튼을 다시 그린다
  window.PanelHooks = { onListupChange: () => { if (pmode === "kw" && kwData) renderGrid(kwData); }, log };
  setMode("kw");
  showView("wing");
})();
