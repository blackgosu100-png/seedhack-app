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
  const V = { GO: ["go", "GO · 진입해 볼 만한 시장"], 검토: ["warn", "HOLD · 조건부로 볼 만함"], "큰 시장": ["warn", "HOLD · 큰 시장 기준으로 보세요"], DROP: ["stop", "DROP · 다른 카테고리를 보세요"] };
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
      it.entry = window.Entry?.forItem(price, { ad: adsOn ? 0.1 : 0 }) || null; // 🎯 추천 판매가 · 1688 허용 위안
      if (!(it.ex?.sales != null && it.ex?.views)) { Object.assign(it, { cvr: null, rel: null, hot: null, maxRoas: null, endRoas: end, ad: null, adOld: null, sig: null, adShare: null, cpa: null }); continue; }
      const cvr = it.ex.sales / it.ex.views;
      const rel = med && cvrs.length >= 3 ? cvr / med : null;
      const cpa = AdModel.cpa(cvr), unitM = price ? price * margin : null;
      const maxRoas = price ? (price * cvr * AdModel.conv) / AdModel.cpc : null;
      const beCpc = unitM != null ? unitM * cvr * AdModel.conv : null; // 이 클릭비용보다 비싸면 광고로 1개 팔 때 적자
      Object.assign(it, {
        cvr, rel, hot: rel == null ? null : rel >= 1.4 ? "hot" : rel <= 0.75 ? "cold" : null,
        maxRoas, endRoas: end, beCpc, optCpc: beCpc != null ? beCpc / 2 : null,
        cpa, unitM, adOld: adsOn ? AdModel.judge(cpa, unitM) : null,
        adShare: cpa ? (price * (adsOn ? 0.1 : 0)) / cpa : null, // 광고비 = 매출 10%로 만들 수 있는 판매 비중(나머지는 자연 검색)
      });
      it.ad = null; // 판정(GO/HOLD/DROP)은 두지 않는다 — 지표는 참고용, 결정은 원가를 넣은 순이익·ROI와 사람이 한다(대표님 방식)
      if (d.kind === "kw") it.light = null;
    }
    const ads = d.items.filter((it) => it.ad);
    d.market = window.Entry?.market(d.items.map((it) => ({ price: it.ex?.price ?? it.price, sales: it.ex?.sales }))) || null;
    return { med, n: withCvr.length, hot: d.items.filter((it) => it.hot === "hot").length, end, margin,
      adGo: ads.filter((it) => it.ad === "go").length, adWarn: ads.filter((it) => it.ad === "warn").length, adStop: ads.filter((it) => it.ad === "stop").length,
      sales: withCvr.reduce((a, it) => a + it.ex.sales, 0), rev: d.items.reduce((a, it) => a + (it.rev || 0), 0) };
  }

  // ---------- 카드 ----------
  function cardHtml(it, i, d) {
    const ex = it.ex;
    const relTxt = it.rel != null ? ` <span class="rel ${it.hot || ""}">전환 ${it.rel.toFixed(1)}×</span>` : "";
    // 참고: 경쟁사가 한 달에 남기는 돈(원가를 알면) · 광고비 10%로 만들 수 있는 판매 비중
    const bn = window.Listup?.bench?.(it.pid);
    const adRow = it.ex?.sales != null ? `<div class="ad ref" title="${esc(`경쟁사 월 순이익 = (경쟁사 판매가 − 원가 − 물류비 − 수수료) × 월판매량 − 광고비 ${adsOn ? 10 : 0}% · 같은 원가로 본 추정치(참고용)\n${AdModel.note()}`)}">
        ${bn ? `<b>경쟁사 월 순이익 약 ${man(bn.net)}원</b><span>개당 ${won(bn.unit)}원 · ROI ${pct(bn.roi)} · 1688 ¥${bn.yuan}${bn.auto && !bn.auto.sure ? " (추정)" : ""} 기준</span>`
          : window.Listup?.has(it.pid) ? `<b class="dim">경쟁사 월 순이익 · 1688 원가 찾는 중</b>` : `<b class="dim">경쟁사 월 순이익 · ☆ 담으면 원가를 찾아 계산</b>`}
        ${adsOn && it.adShare != null ? `<span class="dim">광고 10%로 판매의 ${Math.min(100, Math.round(it.adShare * 100))}%까지 · 나머지는 자연 검색</span>` : ""}</div>` : "";
    const en = it.entry, mk = d.kind === "kw" ? d.market : null; // 가격대는 같은 상품끼리 겨루는 키워드 검색에서만
    const enRow = en && en.cut > 0 ? `<div class="en ${en.yuan > 0 ? "" : "no"}" title="이 상품보다 ${won(en.cut)}원 싸게(가격대별 체감 할인${en.crossed ? " · 가격 경계 넘김" : ""}) 팔고 수수료 ${Math.round(Entry.cfg.fee * 1000) / 10}% · 광고 ${adsOn ? 10 : 0}% · 마진 ${Math.round(Entry.cfg.margin * 100)}% · 물류 ${won(Entry.cfg.logi)}원(극소형 가정)을 남기는 1688 가격 · 원가 계수 ${Entry.cfg.fx}원/위안${mk ? ` · 이 검색어 잘 팔리는 가격대 ${won(mk.lo)}~${won(mk.hi)}원` : ""}">
        <b>추천가 ${won(en.price)}원 <small>−${won(en.cut)}</small></b>
        <span>${en.yuan > 0 ? `1688 <b>¥${en.yuan.toFixed(1)}</b> 이하로 사 오면 OK` : "이 가격대로는 남지 않아요"}${mk && (en.price < mk.lo || en.price > mk.hi) ? " · 잘 팔리는 가격대 밖" : ""}</span></div>` : "";
    const inList = window.Listup?.has(it.pid);
    const listBtn = it.pid ? `<button class="addlist ${inList ? "in" : ""}" data-add="${i}" type="button">${inList ? "★ 리스트업에 담김" : "☆ 리스트업 담기"}</button>` : "";
    const link = `https://www.coupang.com/vp/products/${it.pid}${it.vid ? `?vendorItemId=${it.vid}` : ""}`;
    return `<div class="card" data-k="${esc(key(it))}" data-i="${i}">
      <div class="im">${it.img ? `<img loading="lazy" src="${esc(imgUrl(it.img))}" alt="">` : ""}<span class="rk">${it.order}${d.kind === "kw" ? "" : "위"}</span>${it.pb ? `<span class="pb" title="쿠팡 자체 브랜드 — 실판매 지표가 제공되지 않습니다">쿠팡 PB</span>` : ""}<span class="dot ${it.light || "none"}"></span></div>
      <div class="bd"><a class="nm" href="${esc(link)}" target="_blank" title="${esc(it.name)}">${esc(it.name)}</a>
        <div class="pr"><span class="cpv ${it.priceSrc === "now" || it.priceSrc === "seen" ? "cp" : ""}">${won(it.ex?.price ?? it.price)}원</span>${priceTag(it)}${it.reviews != null ? `<small class="rv ${it.revSrc === "page" ? "cp" : ""}" title="${it.revSrc === "page" ? `쿠팡 화면 리뷰 수${it.revWing != null && it.revWing !== it.reviews ? ` · Wing ${won(it.revWing)}` : ""}` : "Wing 리뷰 수 — 쿠팡 화면에서 아직 못 읽음"}"><i>★</i>${it.rating ?? "-"} <u>(${won(it.reviews)})</u>${it.revSrc === "wing" ? " W" : ""}</small>` : ""}</div>
        <div class="mt"><span>28일 판매</span><b class="${ex?.sales != null ? "ex" : ""}">${ex?.sales != null ? won(ex.sales) : "-"}</b>
          <span>판매액</span><b class="${it.rev != null ? "ex" : ""}">${it.rev != null ? man(it.rev) + "원" : "-"}</b>
          <span>28일 조회</span><b class="${ex?.views != null ? "ex" : ""}">${ex?.views != null ? won(ex.views) : range(it)}</b>
          <span>전환율</span><b class="${it.cvr != null ? "ex" : ""}">${pct(it.cvr)}${relTxt}</b></div>${enRow}${adRow}${listBtn}</div></div>`;
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
      $("counts").innerHTML = "";
      $("insight").innerHTML = e.n
        ? `<span>상품 ${d.items.length}개 · 실판매 ${e.n}개</span><span>28일 판매 합 <b>${won(e.sales)}</b> · 판매액 <b>${man(e.rev)}원</b></span>
           <span>중앙 전환율 <b>${pct(e.med)}</b> · 🔥 <b>${e.hot}</b></span><span>가격 <b>${won(d.minPrice)}~${won(d.maxPrice)}원</b></span>${d.market ? `<span>🎯 잘 팔리는 가격대 <b>${won(d.market.lo)}~${won(d.market.hi)}원</b> · 판매 상위 중 최저 <b>${won(d.market.strongMin)}원</b></span>` : ""}`
        : `<span class="dim">이 검색 결과에는 실판매 지표가 있는 상품이 없습니다.</span>`;
    } else {
      const c = { go: 0, warn: 0, stop: 0 };
      d.items.forEach((it) => c[it.light] != null && c[it.light]++);
      $("counts").innerHTML = `<b class="g">●${c.go}</b> <b class="y">●${c.warn}</b> <b class="r">●${c.stop}</b>`;
      $("insight").innerHTML = e && e.n
        ? `<span>실판매 ${e.n}개 · 중앙 전환율 <b>${pct(e.med)}</b></span><span>🔥 전환율 상위 <b>${e.hot}</b></span>`
        : `<span class="dim">🎯 Wing 28일 판매량을 받으면 전환율 비교가 나옵니다</span>`;
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

  // ---------- 대시보드에서 카테고리 고르기 ----------
  // Wing 화면을 직접 뒤지지 않아도 되게: 저장된 카테고리 목록에서 검색 → 고르면 Wing이 그 카테고리를 열고 응답이 오면 판정
  let catTree = null, catSel = -1, catRows = [], catKids = null, catByCode = null;
  const catQ = $("catQ"), catList = $("catList");
  const L = [1, 2, 3, 4].map((n) => $(`catL${n}`));
  async function loadCatTree() {
    const t = await api.invoke("cat:tree"); catTree = t?.nodes || null;
    if (catTree) {
      catKids = new Map(); catByCode = new Map();
      for (const n of catTree) { catByCode.set(n.code, n); const k = n.parent || "ROOT"; if (!catKids.has(k)) catKids.set(k, []); catKids.get(k).push(n); }
      fillLevel(0, "ROOT");
    } else { L.forEach((s, i) => { s.innerHTML = `<option value="">${i + 1}차</option>`; s.disabled = true; }); L[0].innerHTML = `<option value="">카테고리 목록 없음 — 검색창을 눌러 불러오기</option>`; L[0].disabled = false; }
    return catTree;
  }
  // 윙처럼 1차 → 2차 → 3차 → 4차: 고르면 다음 칸이 채워지고, 말단이면 바로 판정
  function fillLevel(i, parentCode) {
    const kids = (catKids?.get(parentCode) || []).slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const sel = L[i]; if (!sel) return;
    sel.innerHTML = `<option value="">${i + 1}차 (${kids.length})</option>` + kids.map((n) => `<option value="${n.code}">${esc(n.name)}${n.leaf ? "" : " ›"}</option>`).join("");
    sel.disabled = !kids.length;
    for (let j = i + 1; j < 4; j++) { L[j].innerHTML = `<option value="">${j + 1}차</option>`; L[j].disabled = true; }
    $("catGo").disabled = true;
  }
  function selectedNode() { for (let i = 3; i >= 0; i--) if (L[i].value) return catByCode.get(L[i].value); return null; }
  L.forEach((sel, i) => sel.addEventListener("change", () => {
    const n = catByCode?.get(sel.value);
    if (!n) { fillLevel(i + 1, "__none__"); return; }
    fillLevel(i + 1, n.code);
    $("catGo").disabled = false;
    if (n.leaf) pickCat(n); // 말단이면 바로 판정
  }));
  $("catGo").onclick = () => pickCat(selectedNode());
  function syncCascade(n) { // 검색으로 고른 카테고리를 단계 칸에도 반영
    const chain = []; let c = n; while (c) { chain.unshift(c); c = c.parent ? catByCode.get(c.parent) : null; }
    fillLevel(0, "ROOT");
    chain.forEach((node, i) => { if (L[i]) { L[i].value = node.code; fillLevel(i + 1, node.code); } });
    $("catGo").disabled = false;
  }
  function recentCodes() { try { return (catData ? [String(catData.code)] : []); } catch { return []; } }
  function renderCatList() {
    const q = catQ.value.trim();
    if (!catTree) {
      catList.innerHTML = `<div class="hint">카테고리 목록이 아직 없습니다. Wing에 로그인한 뒤 한 번만 불러오면 됩니다.<br><button type="button" id="catLoad">카테고리 목록 불러오기</button></div>`;
      catList.hidden = false;
      $("catLoad").onclick = async () => { $("catLoad").textContent = "불러오는 중… (Wing 인기상품 화면을 엽니다)"; await api.invoke("cat:loadTree"); };
      return;
    }
    if (!q) { catList.hidden = true; return; }
    const terms = q.split(/\s+/).filter(Boolean);
    catRows = catTree.filter((n) => terms.every((t) => n.path.includes(t)))
      .sort((a, b) => (b.leaf - a.leaf) || (a.name.length - b.name.length) || a.path.localeCompare(b.path, "ko")).slice(0, 40);
    catSel = catRows.length ? 0 : -1;
    catList.innerHTML = catRows.length ? catRows.map((n, i) => `<div class="row ${i === catSel ? "on" : ""}" data-i="${i}"><b>${esc(n.name)}</b><span class="p">${esc(n.path.split(">").slice(0, -1).join(" › "))}</span><span class="d">${n.leaf ? "말단" : `${n.depth}차`}</span></div>`).join("")
      : `<div class="hint">'${esc(q)}'에 맞는 카테고리가 없습니다</div>`;
    catList.hidden = false;
  }
  async function pickCat(n) {
    if (!n) return;
    catList.hidden = true; catQ.value = ""; catQ.blur();
    if (catByCode && L.every((s, i) => !s.value || catByCode.get(s.value)?.code !== n.code)) syncCascade(n);
    $("cat").textContent = `${n.path.replace(/>/g, " › ")} · 불러오는 중…`;
    $("call").className = "call wait"; $("call").textContent = "Wing 응답 대기";
    window.AiScan?.diagnose(n.path); // 발표 모드면 진단 해커 화면(Wing 응답을 기다리는 동안부터)
    const r = await api.invoke("cat:open", { code: n.code, name: n.name });
    if (r?.error) { $("cat").textContent = r.error; if (window.AiScan?.current?.kind === "cat") window.AiScan.current.fail(r.error); }
  }
  catQ.addEventListener("input", renderCatList);
  catQ.addEventListener("focus", () => { if (catTree && catQ.value.trim()) renderCatList(); else if (!catTree) renderCatList(); });
  catQ.addEventListener("keydown", (e) => {
    if (catList.hidden || !catRows.length) { if (e.key === "Escape") catList.hidden = true; return; }
    if (e.key === "ArrowDown") { catSel = Math.min(catRows.length - 1, catSel + 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { catSel = Math.max(0, catSel - 1); e.preventDefault(); }
    else if (e.key === "Enter") { pickCat(catRows[catSel]); return; }
    else if (e.key === "Escape") { catList.hidden = true; return; }
    else return;
    catList.querySelectorAll(".row").forEach((el, i) => el.classList.toggle("on", i === catSel));
    catList.querySelector(".row.on")?.scrollIntoView({ block: "nearest" });
  });
  catList.addEventListener("mousedown", (e) => { const row = e.target.closest(".row"); if (row) { e.preventDefault(); pickCat(catRows[+row.dataset.i]); } });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".catpick")) catList.hidden = true; });
  api.on("cattree", () => { loadCatTree().then(() => { if (!catList.hidden) renderCatList(); }); });
  loadCatTree();

  // ---------- 화면 전환(왼쪽 사이드바) ----------
  // view: 지금 본문에 보이는 화면. kw·cat은 패널 화면(cat = Wing 화면 + 오른쪽 판정 칸), 나머지는 메인 프로세스의 탭과 같다.
  const VIEWS = {
    reco: ["💡 키워드 추천", "로켓그로스가 적거나 해외배송이 많은 키워드 · 고르면 바로 분석"],
    kw: ["🔎 키워드 분석", "키워드 하나로 쿠팡 상품의 실판매·쿠폰가·광고 가능성을 한 번에"],
    cat: ["🚦 카테고리 진단", "1차 → 4차를 고르면 Wing 인기상품으로 바로 진단합니다 · 말단을 고르면 자동 실행"],
    wing: ["🔑 Wing 로그인", "Wing에 로그인해 두면 판매량·조회수를 받아 옵니다"],
    clean: ["🛒 쿠팡 검색", "쿠키 없는 클린 세션 — 개인화 없는 검색 순위"],
    collect: ["📦 수집함", "쿠팡 화면과 키워드 분석에서 본 상품이 자동으로 쌓입니다"],
    list: ["📋 리스트업", "고른 상품의 1688 원가·마진 계산"],
    cn: ["🇨🇳 1688", "이미지 검색 · 상품 페이지에서 리스트업에 넣기"],
    chat: ["💬 판매자 문의", "한글로 묻고 중국어로 보내기 · 답이 오면 다음 질문을 이어 보냄"],
    detail: ["📄 상세페이지", "1688 상세 이미지 → 한글 상세페이지 자동 생성 · 피그마 내보내기"],
    dash: ["📊 판매 관리", "로켓그로스 대시보드"],
  };
  const DASH = { margin: "📊 마진 대시보드", ads: "🎯 광고 보고서", coupons: "🎟️ 쿠폰 관리", stock: "🏬 재고 조회" };
  const SITE_VIEWS = new Set(["wing", "clean", "cn", "chat", "dash"]); // 머리줄에 주소창이 보이는 화면 (cat 은 키워드 분석처럼 패널 전체)
  let view = "wing", dashId = null, sideMin = false;
  try { sideMin = localStorage.getItem("sideMin") === "1"; } catch {}
  // 메인 프로세스에 틀 크기(사이드바 폭 · Wing 오른쪽 칸 폭)를 알린다
  const frame = () => {
    document.body.classList.toggle("side-min", sideMin);
    $("sideFold").textContent = sideMin ? "»" : "«";
    $("sideFold").title = sideMin ? "사이드바 펼치기" : "사이드바 접기";
    const strip = document.body.classList.contains("locked") ? 400 : 0; // 카테고리 판정은 이제 본문 전체(오른쪽 칸 없음)
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
    $("siteHint").hidden = v === "list" || v === "collect" || v === "kw" || v === "cat";
    $("detail").hidden = v !== "detail"; if (v === "detail") $("siteHint").hidden = true; // 📄 상세페이지(패널 화면)
    $("reco").hidden = v !== "reco"; if (v === "reco") $("siteHint").hidden = true; // 💡 키워드 추천(패널 화면)
    $("hintT").textContent = v === "dash" ? "로켓그로스 대시보드를 불러오는 중입니다…" : "화면을 불러오는 중입니다…";
    if (v === "kw" || v === "cat") { if (pmode !== v) setMode(v); }
    // 키워드 분석: 엑셀 저장·개수를 툴바 한 줄로 올린다(버튼 하나뿐인 줄을 없애 상품 카드를 위로). 다른 화면에선 원래 자리
    // 카테고리 진단도 같게 — 🎯 Wing 판매량 받기·중지 버튼까지 툴바로
    if (v === "kw") $("bLog").before($("counts"), $("bXlsx"));
    else if (v === "cat") $("bLog").before($("counts"), $("bExact"), $("bStop"), $("bXlsx"));
    else document.querySelector(".acts").append($("bExact"), $("bStop"), $("bXlsx"), $("counts"));
    frame();
  }
  // 사이드바에서 고른 화면으로: 메인 프로세스 탭을 바꾸고(kw는 사이트 화면을 모두 숨김) 화면을 그린다
  function go(v, dash) {
    const tab = v === "dash" ? `dash:${dash || dashId || "margin"}` : v; // cat 은 메인에 "cat" 으로 — 사이트 화면을 모두 숨긴다
    showView(v, dash);
    api.invoke("nav:tab", tab);
    if (v === "kw") setTimeout(() => $("kwInput").focus(), 30);
  }
  // 📜 기록: 키워드 분석에선 진행 기록 칸을 접어 두고 필요할 때만 펼친다
  $("bLog").onclick = () => { const on = document.body.classList.toggle("log-open"); $("bLog").setAttribute("aria-pressed", String(on)); if (on) $("con").scrollTop = $("con").scrollHeight; };
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
  // 검색 뒤 1분 동안: 쿠팡 탭이 이 검색어 화면을 늦게 읽어 오면 "쿠폰 전" 카드만 쿠폰가로 바꾸고 다시 계산·그리기
  let lateOff = null;
  function lateCoupon(kw, since) {
    lateOff?.();
    let alive = true;
    const t = setTimeout(() => (alive = false), 60000);
    const check = async () => {
      if (!alive || kwData?.keyword !== kw) return;
      const rows = await api.invoke("collect:get").catch(() => null);
      if (!rows?.some((r) => r.pos?.[kw]?.ts >= since)) return;
      const before = kwData.items.filter((it) => it.priceSrc === "wing").length;
      const c = applyCouponPrices(kwData.items, rows, kw, since); // 다시 적용해도 Wing 원값(listPrice·revWing)은 보존된다
      if (c.none >= before) return;
      const prices = kwData.items.slice(0, 36).map((it) => it.price ?? it.ex?.price).filter((p) => p > 0);
      kwData.minPrice = prices.length ? Math.min(...prices) : null; kwData.maxPrice = prices.length ? Math.max(...prices) : null;
      insight(kwData); renderGrid(kwData);
      log("go", `✔ 쿠팡 화면이 늦게 도착 — 쿠폰가 ${before - c.none}개 더 반영하고 다시 계산했습니다${c.off.length ? ` (Wing 판매가와 다름 ${c.off.length}개)` : ""}`);
      if (!kwData.items.some((it) => it.priceSrc === "wing")) lateOff();
    };
    const mine = () => check();
    if (!cpWaiter) cpWaiter = mine; // 새 검색이 cpWaiter를 쓰는 중이면 끼어들지 않는다
    lateOff = () => { alive = false; clearTimeout(t); if (cpWaiter === mine) cpWaiter = null; lateOff = null; };
  }
  // 쿠팡 화면 값 적용 — 화면에서 "직접 읽은 값"(collect.page)만 쓴다. 규칙:
  //  ① 가격: 같은 옵션(vendorItemId)일 때만 · Wing가의 35%~150% 안일 때만(단위가격 오독 방지) — 아니면 Wing가 + 이유 표시
  //  ② 리뷰·별점: 화면에서 읽었으면 화면 값(손님이 보는 숫자), 못 읽었으면 Wing 값 + "Wing" 표시
  //  ③ 매 검색마다 Wing 값·화면 값·카드 글을 나란히 파일로 남긴다(정확도 대조용)
  function applyCouponPrices(items, rows, kw, since) {
    const by = new Map((rows || []).map((r) => [String(r.pid), r]));
    const c = { now: 0, seen: 0, none: 0, off: [], vid: 0, odd: 0, rev: 0 };
    const diag = [];
    for (const it of items) {
      const r = by.get(String(it.pid)), pg = r?.page || null;
      const wingP = it.listPrice ?? it.ex?.price ?? it.price;
      it.listPrice = wingP;
      if (it.revWing === undefined) { it.revWing = it.reviews ?? null; it.rateWing = it.rating ?? null; }
      const sameVid = !pg?.vid || !it.vid || String(pg.vid) === String(it.vid);
      const sane = !(wingP > 0) || (pg?.price >= wingP * 0.35 && pg?.price <= wingP * 1.5);
      let used = "wing";
      if (pg?.price > 0 && sameVid && sane) {
        const fresh = pg.ts >= since && pg.q === kw;
        it.price = pg.price;
        if (it.ex) it.ex = { ...it.ex, price: pg.price };
        it.priceSrc = fresh ? "now" : "seen"; it.priceTs = pg.ts;
        fresh ? c.now++ : c.seen++; used = it.priceSrc;
        if (wingP > 0 && pg.price !== wingP) c.off.push(pg.price / wingP - 1);
      } else {
        it.priceSrc = pg?.price > 0 && !sameVid ? "vid" : pg?.price > 0 && !sane ? "odd" : "wing";
        it.pagePrice = pg?.price ?? null;
        it.priceSrc === "vid" ? c.vid++ : it.priceSrc === "odd" ? c.odd++ : c.none++;
      }
      if (pg?.reviews != null) { it.reviews = pg.reviews; it.rating = pg.rating ?? it.rating; it.revSrc = "page"; c.rev++; }
      else { it.reviews = it.revWing; it.revSrc = "wing"; }
      diag.push({ order: it.order, pid: it.pid, wingVid: it.vid || "", pageVid: pg?.vid || "", name: String(it.name || "").slice(0, 40),
        wingPrice: wingP ?? null, pagePrice: pg?.price ?? null, usedPrice: it.price ?? null, priceSrc: it.priceSrc,
        wingReviews: it.revWing, pageReviews: pg?.reviews ?? null, revSrc: it.revSrc, pageRead: pg?.ts ? new Date(pg.ts).toLocaleString("ko-KR") : null, pageQuery: pg?.q || "", raw: pg?.raw || "" });
    }
    api.invoke("diag:save", { kw, rows: diag }).catch(() => {});
    return c;
  }
  const priceTag = (it) => {
    if (it.priceSrc === "wing") return ` <small class="ptag nc" title="Wing 판매가 — 쿠폰·즉시할인 적용 전 가격입니다(쿠팡 화면에서 아직 못 본 상품)">쿠폰 전</small>`;
    if (it.priceSrc === "vid") return ` <small class="ptag nc" title="쿠팡 화면에는 이 상품의 다른 옵션(${won(it.pagePrice)}원)이 떠 있어 Wing 판매가를 씁니다">옵션 다름</small>`;
    if (it.priceSrc === "odd") return ` <small class="ptag nc" title="쿠팡 화면에서 읽은 ${won(it.pagePrice)}원이 Wing 판매가와 너무 달라(단위가격 등 오독 의심) Wing 판매가를 씁니다">확인 필요</small>`;
    if (!it.priceSrc) return "";
    const when = it.priceSrc === "seen" ? ` · ${new Date(it.priceTs).toLocaleDateString("ko-KR")} 쿠팡 화면` : " · 방금 쿠팡 화면";
    const was = it.listPrice > 0 && it.listPrice !== it.price ? ` <s>${won(it.listPrice)}</s>` : "";
    return ` <small class="ptag cp" title="손님이 실제로 내는 가격(쿠폰·즉시할인 적용)${when}${it.listPrice ? ` · Wing 판매가 ${won(it.listPrice)}원` : ""}">쿠폰가${it.priceSrc === "seen" ? "·이전" : ""}</small>${was}`;
  };

  // ---------- 🔎 키워드 검색 ----------
  async function runSearch(keyword, force = false) {
    const kw = String(keyword || "").trim();
    if (!kw) return;
    lateOff?.();
    $("kwInput").value = kw;
    const pages = Number($("kwPages").value) || 1;
    log("sys", `▶ 키워드 검색: <b>${esc(kw)}</b> · ${pages}페이지 (페이지마다 Wing 검색 1회)`);
    prog(0.15);
    $("kwForm").querySelector("button").disabled = true;
    $("kwForm").querySelector("button").textContent = "검색 중…";
    const scan = window.AiScan?.start(kw, pages); // 시그널 스캔(발표 모드) 또는 진행 띠 — 실제 값만 표시
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
      const msg = `쿠폰가 반영 ${c.now + c.seen}/${r.items.length}개 (이번 쿠팡 화면 ${c.now} · 예전에 본 가격 ${c.seen})${c.off.length ? ` · Wing 판매가와 다름 ${c.off.length}개, 평균 ${(avg * 100).toFixed(1)}%` : ""}${c.none ? ` · 쿠폰 전 가격 ${c.none}개` : ""}${c.vid ? ` · 화면엔 다른 옵션 ${c.vid}개` : ""}${c.odd ? ` · 가격 오독 의심 ${c.odd}개` : ""} · 리뷰 화면값 ${c.rev}/${r.items.length}`;
      log(c.now + c.seen ? "go" : "warn", `${c.now + c.seen ? "✔" : "△"} ${msg}`);
      scan?.note(c.now + c.seen ? "go" : "warn", `${c.now + c.seen ? "✔" : "△"} ${esc(msg)}`);
    }
    if (r.items.some((it) => it.priceSrc === "wing")) lateCoupon(kw, since); // 쿠팡 화면이 늦게 읽히면(12초 넘게) 도착하는 대로 쿠폰가로 다시 그린다
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
        log("sys", `■ '${esc(kw)}' 상품 ${kwData.items.length}개 · 28일 판매 합 ${won(e.sales)} · 판매액 ${man(e.rev)}원${r.cached ? " · 저장된 결과" : ""}`);
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
    const d = cur(); // 키워드 분석 · 카테고리 분석 둘 다
    if (!b || !d) return;
    const it = d.items[+b.dataset.add];
    if (window.Listup?.has(it.pid)) { api.invoke("nav:tab", "list"); return; }
    const isKw = d.kind === "kw";
    const sub = isKw ? (d.db?.subs || []).find((s) => !s.brand) : null;
    const cps = isKw ? null : d.items.slice(0, 36).map((x) => x.ex?.price ?? x.price).filter((p) => p > 0); // 카테고리: 1페이지(상위 36개) 가격 범위
    const row = window.Listup.add({
      keyword: isKw ? d.keyword : `📂 ${d.name || "카테고리"}`, kwVol: isKw ? d.db?.main?.m1 ?? null : null, subKw: sub?.kw || "", subVol: sub?.m1 ?? null,
      subs: isKw ? (d.db?.subs || []).slice(0, 15).map((s) => ({ kw: s.kw, m1: s.m1, brand: s.brand })) : [],
      maxPrice: isKw ? d.maxPrice : cps.length ? Math.max(...cps) : null, minPrice: isKw ? d.minPrice : cps.length ? Math.min(...cps) : null, name: it.name, pid: it.pid,
      benchUrl: `https://www.coupang.com/vp/products/${it.pid}${it.vid ? `?vendorItemId=${it.vid}` : ""}`, img: it.img,
      bSales: it.ex?.sales ?? null, bViews: it.ex?.views ?? null, bCvr: it.cvr, ad: it.adOld, maxRoas: it.maxRoas,
      monthly: "", benchMonthly: it.ex?.sales != null ? Math.round((it.ex.sales * 30) / 28) : null, benchPrice: it.price ?? it.ex?.price, bReviews: it.reviews ?? null, bRating: it.rating ?? null, bShip: it.ex?.ship || it.ship || "", band: isKw && d.market ? { lo: d.market.lo, hi: d.market.hi, strongMin: d.market.strongMin } : null,
      recPrice: it.entry?.cut > 0 ? it.entry.price : null, recYuan: it.entry?.yuan > 0 ? Math.round(it.entry.yuan * 10) / 10 : null,
    });
    window.Listup.queue1688?.(row); // 🎯 담으면 1688 자동 조사(이미지 검색 → 옵션가 → AI → 원가) — 끝나면 위안 칸 채움 + 알림
    log("go", `☆ 리스트업에 담음 · ${esc(it.name.slice(0, 26))} — 1688 원가는 자동으로 찾아 위안 칸에 넣습니다`);
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
    if (view === "wing") go("cat"); // Wing 화면을 보는 중에 응답이 오면 판정 화면(본문 전체)으로
    else if (pmode !== "cat" && view !== "kw") setMode("cat");
    clearInterval(revealTimer);
    // 발표 모드: 카테고리 진단 해커 화면(고를 때 띄운 화면이 있으면 이어서, 없으면 새로)
    if (view === "cat") { const sc = window.AiScan?.current?.kind === "cat" ? window.AiScan.current : window.AiScan?.diagnose(`${d.path ? d.path + " > " : ""}${d.name}`); sc?.run(d); }
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
      log(V[d.verdict]?.[0] || "sys", `■ 카테고리 진단: <b>${esc(d.verdict)}</b>${d.yuan > 0 ? ` · 1688 ¥${d.yuan.toFixed(1)} 이하` : ""}${d.note ? ` · ${esc(d.note)}` : ""}`);
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
    if (same) log(V[d.verdict]?.[0] || "sys", `■ 진단 갱신: <b>${esc(d.verdict)}</b>`);
  }

  // ---------- 메인 프로세스 이벤트 ----------
  api.on("console", ({ cls, text }) => { log(cls, esc(text)); window.AiScan?.current?.console(cls, text); });
  api.on("live", (d) => showCat(d));
  api.on("live:refresh", (d) => updateCat(d));
  api.on("nav", ({ tab, url, dash }) => {
    // 메인 프로세스가 탭을 바꾼 경우(쿠팡 새 탭, 리스트업 → 1688, 잠금 등)에도 화면을 맞춘다. Wing은 판정 칸을 보던 중이면 유지
    const v = tab;
    if (v !== view || (v === "dash" && dash && dash !== dashId)) showView(v, dash);
    if (document.activeElement !== $("url")) $("url").value = url || "";
    if (tab === "list") window.Listup?.render();
    if (tab === "collect") window.Collect?.load();
    if (tab === "detail") window.Detail?.show();
    if (tab === "reco") window.Reco?.show();
    if (tab === "wing") footStatus();
  });
  api.on("exact:progress", ({ pos, total, status, msg }) => {
    if (window.AiScan?.current?.kind === "exact") window.AiScan.current.progress({ pos, total, status, msg });
    prog(total ? pos / total : 0);
    const cls = /✕|실패|제한|정지|한도|로그인/.test(msg) ? "stop" : status === "done" ? "sys" : /재사용/.test(msg) ? "dim" : "go";
    log(cls, `${status === "done" ? "■" : "↳"} [${pos}/${total}] ${esc(msg)}`);
    if (["done", "stopped", "paused"].includes(status)) {
      busy = false; $("bExact").disabled = !catData; $("bStop").hidden = true;
      if (status === "done" && catData) {
        const e = enrich(catData);
        catData.items.filter((it) => it.hot === "hot").forEach((it) => log("go", `🔥 전환율 상위 · ${esc(it.name.slice(0, 24))} — 전환율 ${pct(it.cvr)} (중앙 ${pct(e.med)}의 ${it.rel.toFixed(1)}배)`));
        if (e?.n) log("sys", `■ 전환율 비교·광고 가능성: 🔥${e.hot} (본전 ROAS ${Math.round(e.end * 100)}%)`);
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
    if (window.AiScan?.current?.kind === "exact") window.AiScan.current.item({ ...catData.items[idx], key: k }); // 전환율·시그널 계산 뒤 해커 화면에 도장
    catData.items.forEach((it, i) => it.ex && refreshCard(i, i === idx));
    const it = catData.items[idx];
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
  // 해커 스타일(구 발표 모드)이 기본: 분석할 때 전체 화면 AI 연출. 확대(줌)는 쓰지 않는다 — 2026-10-09 사용자 결정
  document.body.classList.add("present");
  // 사전 점검: 시연 직전에 로그인·정지·사용량을 한 줄로
  async function precheck() {
    const c = await api.invoke("check:status");
    const wing = c.wing === "ok" ? "✔ Wing 로그인됨" : c.wing === "login" ? "✕ Wing 로그인 필요 (① 탭)" : "△ Wing 화면 확인 필요";
    const g = c.gate ? `✕ 조회 정지: ${c.gate.reason} (${new Date(c.gate.until).toLocaleTimeString("ko-KR")}까지)` : "✔ 조회 가능";
    log(c.wing === "ok" && !c.gate ? "go" : "stop", `점검 · ${wing} · ${g} · 오늘 조회 ${c.today}건 · 최근 10분 ${c.win10}/60건 · 수집함 ${c.collect}개`);
  }
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
    // 🎤 발표 모드: 판매량 받기 해커 화면(조회 순서 그대로)
    window.AiScan?.exact(need.map((it) => ({ key: key(it), img: it.img, name: it.name, order: it.order, price: it.ex?.price ?? it.price, reviews: it.reviews })), `${catData.path ? catData.path + " > " : ""}${catData.name || ""}`);
    const r = await api.invoke("exact:start", need.map((it) => ({ pid: it.pid, vid: it.vid, iid: it.iid, name: it.name })));
    if (r?.error) { if (window.AiScan?.current?.kind === "exact") window.AiScan.current.fail(r.error); log("stop", `✕ ${esc(r.error)}`); busy = false; $("bExact").disabled = false; $("bStop").hidden = true; }
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
  window.PanelHooks = { onListupChange: () => { const d = cur(); if (d) renderGrid(d); }, log };
  setMode("kw");
  showView("wing");
})();
