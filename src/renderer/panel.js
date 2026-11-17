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

  // ---------- 🔎 키워드 분석 화면(2026-10-12 대표님 결정) ----------
  //  맨 위 결론 카드(키워드 추천 카드와 같은 모양: 큰 숫자 · 상위 3개 사진 · 틈 · 원가 · 서브키워드 · 주의 하나)
  //  + 상품 표(판매 많은 순 · 썸네일 64px, 올리면 크게 · 판매 기록 없는 상품은 접기). "카드로 보기"면 예전 카드
  //  카테고리 진단은 예전 카드 그대로
  let kwLayout = "table", kwZeroOpen = false, catMoreOpen = false;
  try { kwLayout = localStorage.getItem("kwLayout") === "card" ? "card" : "table"; } catch {}
  const sold = (it) => (it.ex?.sales ?? 0) > 0;
  const priceOf = (it) => it.ex?.price ?? it.price;
  const linkOf = (it) => `https://www.coupang.com/vp/products/${it.pid}${it.vid ? `?vendorItemId=${it.vid}` : ""}`;
  // 큰 금액: 키워드 추천과 같은 표기(1억 3,452만원 / 2,953만원)
  const eok = (n) => { const m = Math.round((n || 0) / 1e4); return m >= 10000 ? `${Math.floor(m / 10000)}억${m % 10000 ? ` ${(m % 10000).toLocaleString("ko-KR")}만` : ""}원` : `${m.toLocaleString("ko-KR")}만원`; };
  function kwSummaryHtml(d) {
    const e = d._e || {}, m = d.db?.main;
    const byRev = d.items.filter(sold).sort((a, b) => (b.rev || 0) - (a.rev || 0));
    const top3 = byRev.slice(0, 3), lead = byRev[0], en = lead?.entry;
    const revSum = d.items.filter(sold).reduce((t, it) => t + (it.reviews || 0), 0);
    const top1 = byRev.reduce((a, b) => (!a || b.ex.sales > a.ex.sales ? b : a), null), big500 = d.items.filter((it) => (it.reviews ?? 0) >= 500).length;
    const inList = lead && window.Listup?.has(lead.pid);
    const gaps = d.items.filter((it) => sold(it) && (it.reviews ?? 0) < 300); // 틈 = 리뷰 300개 미만인데 팔리는 상품(키워드 추천과 같은 기준)
    const gap = gaps.length ? gaps.reduce((a, b) => (b.ex.sales > a.ex.sales ? b : a)) : null;
    const share = e.rev && lead?.rev ? lead.rev / e.rev : 0;
    const warn = m?.brand ? "브랜드 키워드예요 · 브랜드 이름으로 찾는 손님이 많아요"
      : share >= 0.5 ? `1등 상품이 28일 판매액의 ${Math.round(share * 100)}%를 가져가요`
      : m?.season ? `계절 상품이에요${m.peak ? ` · ${m.peak}월에 가장 많이 찾아요` : ""}` : "";
    const chips = m ? [`네이버 월검색 ${won(m.m1)}`, `쿠팡 평균가 ${won(m.price)}원`, `1위 리뷰 ${won(m.mx)}`, `로켓 ${m.rocket != null ? Math.round(m.rocket * 100) + "%" : "-"}`] : [];
    const subs = (d.db?.subs || []).slice(0, 8);
    const tile = (it, j) => `<a class="ks-p ${it === gap ? "gapon" : ""}" href="${esc(linkOf(it))}" target="_blank" title="쿠팡 상품 페이지 열기 · ${esc(it.name)}">
      <span class="ks-im">${it.img ? `<img loading="lazy" src="${esc(imgUrl(it.img))}" alt="">` : ""}<span class="no">${j + 1}위</span>${it === gap ? `<span class="gb" title="리뷰 300개 미만인데 팔리는 상품">틈</span>` : ""}</span>
      <span class="ks-i"><span class="pn">${esc(it.name)}</span><span class="pp">${won(priceOf(it))}원</span>
        <span class="kv"><span>판매</span><b>${won(it.ex.sales)}개</b></span><span class="kv"><span>리뷰</span><span>${it.reviews != null ? won(it.reviews) : "-"}</span></span></span></a>`;
    const layoutBtn = (id, ko) => `<button type="button" data-layout="${id}" aria-pressed="${kwLayout === id}">${ko}</button>`;
    // 왼쪽 = 결론(큰 숫자 한 줄 · 틈 · 시장 · 원가 · 서브 · 주의 · 버튼), 오른쪽 = 판매액 상위 3개 사진(키워드 추천 카드와 같은 크기)
    return `<section class="ks ${top3.length ? "" : "solo"}">
      <div class="ks-main">
        <div class="ks-head"><div class="ks-kw"><b>${esc(d.keyword)}</b>${chips.map((c) => `<span class="ks-chip">${esc(c)}</span>`).join("")}
          ${d.ts ? `<span class="ks-when">${esc(whenTxt(d.ts))} 조회${d.cached ? " · 저장된 결과" : ""} <button type="button" data-refresh title="Wing에서 지금 숫자로 다시 받아요 (Wing 요청 1번)">↻ 새로 조회</button></span>` : ""}</div>
          <div class="ks-lay" role="group" aria-label="상품 보기 방식">${layoutBtn("table", "표로 보기")}${layoutBtn("card", "카드로 보기")}</div></div>
        ${e.n ? `<div class="ks-rev"><span class="lbl">검색 상품 ${won(e.n)}개 · 28일 판매액</span><b>${eok(e.rev)}</b>
          <small>28일 ${won(e.sales)}개 판매 · 리뷰 합 ${won(revSum)}개${d.market ? ` · 잘 팔리는 가격 <b>${won(d.market.lo)}~${won(d.market.hi)}원</b>` : ""}</small></div>
        <div class="ks-rows">
          <div class="ks-row"><span class="k">틈</span>${gap ? `<span class="v">리뷰 <b>${won(gap.reviews)}개</b>짜리 상품도 28일 <b class="hl">${won(gap.ex.sales)}개</b> 판매<small>${esc(gap.name)} · ${won(priceOf(gap))}원</small></span>` : `<span class="v dim">리뷰 300개 미만으로 팔리는 상품은 아직 없어요</span>`}</div>
          ${top1 ? `<div class="ks-row"><span class="k">시장</span><span class="v">1등 하루 <b>${won(Math.round(top1.ex.sales / 28))}개</b> · 리뷰 500개+ 상품 <b>${won(big500)}개</b><small>참고: 1등 하루 50개 · 리뷰 500개+ 상품 3개 이상이면 수요가 검증된 시장</small></span></div>` : ""}
          ${en && en.cut > 0 ? `<div class="ks-row"><span class="k">원가</span><span class="v">${won(en.price)}원에 팔면 → ${en.yuan > 0 ? `<span class="ok">1688 ¥${en.yuan.toFixed(1)} 이하면 OK</span>` : `<span class="no">이 가격대로는 남지 않아요</span>`}<small>판매액 1위(${won(priceOf(lead))}원)보다 ${won(en.cut)}원 싸게 · 광고 ${adsOn ? 10 : 0}% 쓰고도 마진 ${Math.round(Entry.cfg.margin * 100)}%</small></span></div>` : ""}
          ${subs.length ? `<div class="ks-row"><span class="k">서브</span><span class="v ks-subs">${subs.map((s) => `<button type="button" data-kw="${esc(s.kw)}" class="${s.brand ? "brand" : ""}" title="${s.brand ? "브랜드 키워드 · " : ""}이 키워드로 다시 분석">${esc(s.kw)} <small>${won(s.m1)}</small></button>`).join("")}</span></div>` : ""}
        </div>
        ${warn ? `<div class="ks-warn">⚠ ${esc(warn)}</div>` : ""}
        ${lead?.pid ? `<div class="ks-acts"><button type="button" class="ks-go" data-add="${d.items.indexOf(lead)}" data-nav="list" title="판매액 1위 상품을 리스트업에 담고 1688에서 같은 상품을 자동으로 찾아요">${inList ? "★ 리스트업에서 보기" : "🇨🇳 1688 원가 찾기"}</button><span>판매액 1위 상품 기준</span><button type="button" class="ks-name" data-namer="${esc(d.keyword)}" data-tip="✍ 이 키워드로 상품명 후보 3개 만들기">✍ 상품명 짓기</button></div>` : ""}`
        : `<p class="ks-none">이 검색 결과에는 실판매 지표가 있는 상품이 없어요</p>`}
      </div>
      ${e.n && top3.length ? `<div class="ks-prods">${top3.map(tile).join("")}</div>` : ""}
    </section>`;
  }
  // 🚦 카테고리 진단 결론 카드(2026-10-12): 키워드 분석 카드와 같은 모양. 판정(GO/DROP) 글씨 대신 기준별 ○/✕ 칩(참고 지표 · 가독성 매뉴얼 2-6)
  //  판매량은 상위 10개(PB 제외)를 🎯 받아야 나온다 → 받기 전엔 1위 28일 조회 범위를 큰 숫자로, 카드 안에 받기 버튼
  function catSummaryHtml(d) {
    const e = d._e || {}, items = d.items, lead = items[0], pbs = items.filter((it) => !it.pb);
    const exN = items.filter((it) => it.ex?.sales != null).length, need = Math.min(10, pbs.length);
    const prices = items.slice(0, 10).map(priceOf).filter((p) => p > 0).sort((a, b) => a - b);
    const med = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
    const gap = items.find((it) => gapOf(d, it));
    const top3 = items.slice(0, 3), first = pbs[0];
    const inList = first && window.Listup?.has(first.pid);
    const tile = (it) => `<a class="ks-p ${it === gap ? "gapon" : ""}" href="${esc(linkOf(it))}" target="_blank" title="쿠팡 상품 페이지 열기 · ${esc(it.name)}">
      <span class="ks-im">${it.img ? `<img loading="lazy" src="${esc(imgUrl(it.img))}" alt="">` : ""}<span class="no">${it.order}위</span>${it === gap ? `<span class="gb" title="리뷰 300개 미만인데 인기 20위 안">틈</span>` : it.pb ? `<span class="gb pb" title="쿠팡 자체 브랜드">PB</span>` : ""}</span>
      <span class="ks-i"><span class="pn">${esc(it.name)}</span><span class="pp">${won(priceOf(it))}원</span>
        ${it.ex?.sales != null ? `<span class="kv"><span>판매</span><b>${won(it.ex.sales)}개</b></span>` : `<span class="kv"><span>조회</span><span>${viewsTxt(it)}</span></span>`}<span class="kv"><span>리뷰</span><span>${it.reviews != null ? won(it.reviews) : "-"}</span></span></span></a>`;
    const layoutBtn = (id, ko) => `<button type="button" data-layout="${id}" aria-pressed="${kwLayout === id}">${ko}</button>`;
    const chk = (c) => `<span class="ks-chk ${c.pass === true ? "p" : c.pass === false ? "f" : "u"}" title="${esc(c.need)}">${c.pass === true ? "○" : c.pass === false ? "✕" : "?"} ${esc(c.label)}</span>`;
    const passN = (d.checks || []).filter((c) => c.pass === true).length;
    return `<section class="ks">
      <div class="ks-main">
        <div class="ks-head"><div class="ks-kw"><b>${esc(d.name || "카테고리")}</b>${d.path ? `<span class="ks-chip">${esc(d.path.replace(/>/g, " › "))}</span>` : ""}<span class="ks-chip">Wing 인기상품 ${esc(d.date || "")}</span>${d.saved ? `<span class="ks-when">저장된 결과${d.code ? ` <button type="button" data-catrefresh title="Wing에서 지금 인기상품으로 다시 받아요">↻ 새로 진단</button>` : ""}</span>` : ""}<span class="ks-chip">${d.mode === "big" ? "큰 시장 기준" : "틈새 기준"}</span></div>
          <div class="ks-lay" role="group" aria-label="상품 보기 방식">${layoutBtn("table", "표로 보기")}${layoutBtn("card", "카드로 보기")}</div></div>
        ${exN ? `<div class="ks-rev"><span class="lbl">상위 ${won(exN)}개 · 28일 판매액</span><b>${eok(e.rev)}</b>
          <small>28일 ${won(e.sales)}개 판매 · 전체 ${won(d.total)}개 중 상위 ${items.length}개 · 1위 리뷰 ${won(lead?.reviews)}${med ? ` · 상위 10개 중앙 판매가 <b>${won(med)}원</b>` : ""}</small></div>`
        : `<div class="ks-rev"><span class="lbl">1위 상품 28일 조회</span><b>${lead ? `${range(lead)}회` : "-"}</b>
          <small>전체 ${won(d.total)}개 중 상위 ${items.length}개 · 1위 리뷰 ${won(lead?.reviews)}${med ? ` · 상위 10개 중앙 판매가 <b>${won(med)}원</b>` : ""}</small></div>`}
        <div class="ks-rows">
          ${(d.checks || []).length ? `<div class="ks-row"><span class="k">기준</span><span class="v"><span class="ks-chks">${d.checks.map(chk).join("")}</span><small>${d.mode === "big" ? "큰 시장" : "틈새"} 기준 ${d.checks.length}개 중 ${passN}개 통과 · 칩에 마우스를 올리면 기준이 나와요 · 위에서 틈새/큰 시장을 바꿀 수 있어요</small></span></div>` : ""}
          <div class="ks-row"><span class="k">틈</span>${gap ? `<span class="v">리뷰 <b>${won(gap.reviews)}개</b>짜리 상품이 인기 <b class="hl">${gap.order}위</b>${gap.ex?.sales != null ? ` · 28일 <b class="hl">${won(gap.ex.sales)}개</b> 판매` : ` · 28일 조회 ${viewsTxt(gap)}`}<small>${esc(gap.name)} · ${won(priceOf(gap))}원</small></span>` : `<span class="v dim">인기 20위 안에 리뷰 300개 미만 상품이 없어요</span>`}</div>
          <div class="ks-row"><span class="k">판매</span>${exN >= need ? `<span class="v">상위 ${won(exN)}개 28일 판매 <b>${won(e.sales)}개</b>${e.hot ? ` · 전환율 상위 🔥 ${e.hot}개` : ""}<small>PB 제외 · Wing 28일 판매량</small></span>`
            : `<span class="v">${exN ? `${need}개 중 ${exN}개 받음` : "아직 판매량을 모르는 상태예요"} ${busy ? `<small>Wing에서 상위 ${need}개 판매량을 받는 중이에요(4초 간격) · 받는 대로 판매액·전환율·틈 판매량이 채워져요</small>` : `<button type="button" class="ks-exact" data-exact title="자동으로 받다가 멈춘 판매량을 이어서 받아요(4초 간격 · 하루 예산 사용)">↻ 이어서 받기</button><small>받으면 판매액·전환율·틈 판매량이 채워져요</small>`}</span>`}</div>
          <div class="ks-row"><span class="k">원가</span>${d.yuan > 0 ? `<span class="v">${won(d.target)}원에 팔면 → <span class="ok">1688 ¥${d.yuan.toFixed(1)} 이하면 OK</span><small>${d.mode === "big" ? "상위 4개 중 최저가" : "상위 10개 중앙가"} 기준 · ${d.ads ? "광고 함(마진 30%)" : "광고 안 함(마진 20%)"}</small></span>` : `<span class="v"><span class="no">이 가격대로는 남는 원가가 없어요</span>${d.target ? `<small>목표가 ${won(d.target)}원 기준</small>` : ""}</span>`}</div>
        </div>
        ${d.note ? `<div class="ks-warn">⚠ ${esc(d.note)}</div>` : ""}
        ${first?.pid ? `<div class="ks-acts"><button type="button" class="ks-go" data-add="${items.indexOf(first)}" data-nav="list" title="PB를 뺀 인기 1위 상품을 리스트업에 담고 1688에서 같은 상품을 자동으로 찾아요">${inList ? "★ 리스트업에서 보기" : "🇨🇳 1688 원가 찾기"}</button><span>PB 제외 인기 1위 상품 기준</span></div>` : ""}
      </div>
      ${top3.length ? `<div class="ks-prods">${top3.map(tile).join("")}</div>` : ""}
    </section>`;
  }
  // 카테고리 진단도 같은 표·카드(2026-10-12): 순위 = Wing 인기 순위 · 판매량은 🎯 받기 전이면 비고 28일 조회 범위를 보여 줌 · 21위부터 접기
  const CAT_SHOW = 20;
  const splitRows = (d, rows) => (d.kind === "cat"
    ? { on: catMoreOpen ? rows : rows.slice(0, CAT_SHOW), off: rows.slice(CAT_SHOW), open: catMoreOpen, more: (n) => `${CAT_SHOW + 1}위부터 ${n}개 더 보기`, less: "21위부터 접기" }
    : { on: rows.filter(({ it }) => sold(it)), off: rows.filter(({ it }) => !sold(it)), open: kwZeroOpen, more: (n) => `판매 기록 없는 상품 ${n}개 펼치기`, less: "판매 기록 없는 상품 접기" });
  const viewsTxt = (it) => (it.ex?.views != null ? won(it.ex.views) : range(it));
  const gapOf = (d, it) => (it.reviews ?? 1e9) < 300 && (d.kind === "cat" ? it.order <= CAT_SHOW && !it.pb : sold(it)); // 틈: 리뷰 300개 미만인데 팔리는(카테고리는 인기 20위 안) 상품
  function kwTableHtml(d, rows) {
    const isCat = d.kind === "cat", { on, off, open, more, less } = splitRows(d, rows);
    const tr = ({ it, i }, n) => {
      const en = it.entry, bn = window.Listup?.bench?.(it.pid), inList = window.Listup?.has(it.pid);
      const cvrT = it.ex?.views != null ? `28일 조회 ${won(it.ex.views)}${it.rel != null ? ` · 이 검색어 중앙 전환율의 ${it.rel.toFixed(1)}배` : ""}` : "";
      const gap = gapOf(d, it);
      return `<div class="kt-tr ${sold(it) || isCat ? "" : "zero"}">
        <span class="kt-rk" title="${isCat ? "Wing 인기상품 순위" : "28일 판매 순위"}">${isCat ? it.order : sold(it) ? n + 1 : "-"}</span>
        <a class="kt-ph" href="${esc(linkOf(it))}" target="_blank" title="쿠팡 상품 페이지 열기">${it.img ? `<img loading="lazy" src="${esc(imgUrl(it.img))}" alt=""><span class="kt-zoom"><img src="${esc(imgUrl(it.img))}" alt=""></span>` : ""}</a>
        <span class="kt-nm"><a href="${esc(linkOf(it))}" target="_blank" title="${esc(it.name)}">${esc(it.name)}</a>
          <small><b class="kt-pr">${won(priceOf(it))}원</b>${isCat ? "" : `${priceTag(it)} · 쿠팡 검색 ${it.order}번째`}${it.pb ? ` · <span class="kt-pb" title="쿠팡 자체 브랜드 · 실판매 지표가 제공되지 않습니다">쿠팡 PB</span>` : ""}</small></span>
        <span class="kt-n big">${it.ex?.sales != null ? won(it.ex.sales) : "-"}</span>
        <span class="kt-n">${isCat ? viewsTxt(it) : it.rev != null ? eok(it.rev) : "-"}</span>
        <span class="kt-n ${gap ? "gap" : ""}" title="${gap ? "리뷰 300개 미만인데 팔리는 상품(틈)" : ""}">${it.reviews != null ? won(it.reviews) : "-"}</span>
        <span class="kt-n" title="${esc(cvrT)}">${pct(it.cvr)}${it.hot === "hot" ? ` <span class="kt-hot" title="${esc(cvrT)}">🔥</span>` : ""}</span>
        <span class="kt-n kt-cn" title="${en && en.cut > 0 ? `${won(en.price)}원에 팔 때 광고 ${adsOn ? 10 : 0}% 쓰고도 마진 ${Math.round(Entry.cfg.margin * 100)}%가 남는 1688 가격` : ""}">${en && en.cut > 0 ? (en.yuan > 0 ? `<span class="ok">¥${en.yuan.toFixed(1)} 이하</span><small>${won(en.price)}원에 팔 때</small>` : `<span class="no">남지 않음</span>`) : "-"}${bn ? `<small title="같은 원가로 본 경쟁사 월 순이익(추정)">경쟁사 월 ${man(bn.net)}원</small>` : ""}</span>
        ${it.pid ? `<button class="kt-add ${inList ? "in" : ""}" data-add="${i}" type="button" title="${inList ? "리스트업에 담김 · 누르면 리스트업으로" : "리스트업에 담기 · 1688 원가를 자동으로 찾아요"}">${inList ? "★" : "☆"}</button>` : "<span></span>"}
      </div>`;
    };
    const head = `<div class="kt-tr kt-th"><span>순위</span><span></span><span>상품 · 판매가</span><span class="kt-n">28일 판매</span><span class="kt-n">${isCat ? "28일 조회" : "28일 판매액"}</span><span class="kt-n">리뷰</span><span class="kt-n">전환율</span><span class="kt-n">1688 원가 상한</span><span></span></div>`;
    return `<section class="kt">${head}${on.map(tr).join("")}
      ${off.length ? `<button type="button" class="kt-fold" data-fold>${open ? `▾ ${less}` : `▸ ${more(off.length)}`}</button>${open && !isCat ? off.map((r) => tr(r, 0)).join("") : ""}` : ""}</section>`;
  }

  // 카드로 보기(2026-10-12): 표와 같은 숫자·같은 색 규칙을 카드 모양으로 — 사진 크게 · 28일 판매 크게 · 판매/판매액/리뷰/전환율 4칸 · 원가 한 줄 · ☆ 담기
  //  카드마다 반복되던 안내 문장(경쟁사 월 순이익 · ☆ 담으면…, 광고 10%로 판매의…)은 뺐다 — 마우스를 올리면 설명
  function kwCardsHtml(d, rows) {
    const isCat = d.kind === "cat", { on, off, open, more, less } = splitRows(d, rows);
    const card = ({ it, i }, n) => {
      const en = it.entry, bn = window.Listup?.bench?.(it.pid), inList = window.Listup?.has(it.pid);
      const gap = gapOf(d, it);
      const cvrT = it.ex?.views != null ? `28일 조회 ${won(it.ex.views)}${it.rel != null ? ` · 이 검색어 중앙 전환율의 ${it.rel.toFixed(1)}배` : ""}` : "";
      return `<article class="kc ${sold(it) || isCat ? "" : "zero"} ${gap ? "gapon" : ""}">
        <a class="kc-im" href="${esc(linkOf(it))}" target="_blank" title="쿠팡 상품 페이지 열기 · ${esc(it.name)}">${it.img ? `<img loading="lazy" src="${esc(imgUrl(it.img))}" alt="">` : ""}
          <span class="no">${isCat ? `${it.order}위` : sold(it) ? `${n + 1}위` : "-"}</span>${gap ? `<span class="gb" title="리뷰 300개 미만인데 팔리는 상품">틈</span>` : ""}${it.pb ? `<span class="pb" title="쿠팡 자체 브랜드 · 실판매 지표가 제공되지 않습니다">쿠팡 PB</span>` : ""}</a>
        <div class="kc-bd">
          <a class="kc-nm" href="${esc(linkOf(it))}" target="_blank" title="${esc(it.name)}">${esc(it.name)}</a>
          <div class="kc-pr"><b>${won(priceOf(it))}원</b>${isCat ? "" : `${priceTag(it)}<small>쿠팡 검색 ${it.order}번째</small>`}</div>
          <div class="kc-sales">${it.ex?.sales != null || !isCat ? `<span>28일 판매</span><b>${it.ex?.sales != null ? `${won(it.ex.sales)}개` : "-"}</b>` : `<span>28일 조회</span><b class="vw">${range(it)}</b>`}</div>
          <div class="kc-kv"><span>판매액</span><b>${it.rev != null ? eok(it.rev) : "-"}</b><span>리뷰</span><b class="${gap ? "g" : ""}">${it.reviews != null ? won(it.reviews) : "-"}</b>
            <span>전환율</span><b title="${esc(cvrT)}">${pct(it.cvr)}${it.hot === "hot" ? " 🔥" : ""}</b><span>28일 조회</span><b>${viewsTxt(it)}</b></div>
          ${en && en.cut > 0 ? `<div class="kc-cost" title="${won(en.price)}원에 팔 때 광고 ${adsOn ? 10 : 0}% 쓰고도 마진 ${Math.round(Entry.cfg.margin * 100)}%가 남는 1688 가격">${won(en.price)}원에 팔면 → ${en.yuan > 0 ? `<span class="ok">1688 ¥${en.yuan.toFixed(1)} 이하</span>` : `<span class="no">남지 않음</span>`}${bn ? `<small title="같은 원가로 본 경쟁사 월 순이익(추정)">경쟁사 월 순이익 약 ${man(bn.net)}원</small>` : ""}</div>` : ""}
          ${it.pid ? `<button class="kc-add ${inList ? "in" : ""}" data-add="${i}" type="button" title="${inList ? "리스트업에 담김 · 누르면 리스트업으로" : "리스트업에 담기 · 1688 원가를 자동으로 찾아요"}">${inList ? "★ 리스트업에 담김" : "☆ 리스트업 담기"}</button>` : ""}
        </div></article>`;
    };
    return `<div class="kgrid">${on.map(card).join("")}</div>
      ${off.length ? `<button type="button" class="kt-fold kc-fold" data-fold>${open ? `▾ ${less}` : `▸ ${more(off.length)}`}</button>${open && !isCat ? `<div class="kgrid">${off.map((r) => card(r, 0)).join("")}</div>` : ""}` : ""}`;
  }

  // ---------- 시작 화면(2026-10-12): 키워드 추천과 같은 검은 상자 + 아래 최근 기록 카드(누르면 저장본을 Wing 조회 없이 바로) ----------
  let catHist = [];
  const shortN = (n) => (n == null ? "-" : n >= 1e4 ? `${Math.round(n / 1e3) / 10}만` : n >= 1e3 ? `${Math.round(n / 100) / 10}천` : won(n)); // 100000 → 10만, 5000 → 5천
  // 시작 화면 카드를 날짜 구간(오늘 · 어제 · 이번 주 · 이번 달 · 이전)으로 나눠 보여 준다 — 수집함과 같은 구간(2026-10-13)
  //  카드 안 시각은 구간에 맞춰 짧게: 오늘·어제는 "15:41", 그 뒤는 "10/9 14:35"
  const dStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const secOf = (t) => { const today = dStart(Date.now()), day = dStart(t), D = 864e5; return day === today ? "오늘" : day === today - D ? "어제" : today - day < 7 * D ? "이번 주" : today - day < 30 * D ? "이번 달" : "이전"; };
  const shortWhen = (t) => { const d = new Date(t), hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }); const s = secOf(t); return s === "오늘" || s === "어제" ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`; };
  function bySection(list, card) {
    const out = [];
    list.forEach((h) => { const s = secOf(h.ts); if (!out.length || out[out.length - 1].s !== s) out.push({ s, items: [] }); out[out.length - 1].items.push(h); });
    return out.map((g) => `<div class="st-sec ${g.s === "오늘" ? "today" : ""}"><span class="st-sl"><b>${g.s}</b>${g.items.length}개</span><i></i></div><div class="st-g">${g.items.map(card).join("")}</div>`).join("");
  }
  function startCardsHtml() {
    if (pmode === "cat") {
      if (!catHist.length) return "";
      return `<section class="stx"><p class="st-h">🕘 최근 진단한 카테고리 <span>누르면 저장된 결과를 Wing 조회 없이 바로 열어요</span></p>
        ${bySection(catHist.slice(0, 12), (h) => `<button type="button" class="st-c" data-catkey="${esc(h.key)}" title="${esc(`${(h.path || "").replace(/>/g, " › ")} › ${h.name}\n${new Date(h.ts).toLocaleString("ko-KR")} 진단 · 인기상품 ${h.total}개`)}">
          <b>${esc(h.name)}</b><span class="n">${h.pvLo != null ? `${shortN(h.pvLo)}~${shortN(h.pvHi)}회` : `리뷰 ${won(h.reviews)}`}</span><small>${h.pvLo != null ? "1위 상품 28일 조회" : "1위 상품"} · ${esc(shortWhen(h.ts))}</small><small>${esc((h.path || "").split(">").slice(-2).join(" › "))}</small></button>`)}</section>`;
    }
    if (!hist.length) return "";
    return `<section class="stx"><p class="st-h">🕘 최근 검색 <span>누르면 Wing 조회 없이 바로 열려요</span></p>
      ${bySection(hist.slice(0, 12), (h) => `<button type="button" class="st-c" data-hist="${esc(h.kw)}" title="${esc(histTip(h))}">
        <b>${esc(h.kw)}</b><span class="n">${eok(h.rev)}</span><small>28일 판매액 · ${esc(shortWhen(h.ts))}</small></button>`)}
      ${hist.length > 12 ? `<select class="st-more" id="stHistAll" aria-label="전체 검색 기록"><option value="">🕘 전체 ${hist.length}개에서 고르기 ▾</option>${hist.map((h) => `<option value="${esc(h.kw)}">${esc(h.kw)} · ${esc(whenTxt(h.ts))} · 판매 ${won(h.sales)}개</option>`).join("")}</select>` : ""}</section>`;
  }
  // 🕘 최근 진단: 키워드 분석의 최근 검색처럼 진단 칸 아래에 늘 보이는 칩 8개 + 전체 목록 — 누르면 저장된 결과를 Wing 요청 없이 연다(2026-10-13)
  function renderCatHistBar() {
    const el = $("catHistBar"); if (!el) return;
    if (!catHist.length) { el.innerHTML = ""; return; }
    const tip = (h) => `${(h.path || "").replace(/>/g, " › ")} › ${h.name} · ${new Date(h.ts).toLocaleString("ko-KR")} 진단 · 누르면 Wing 요청 없이 저장된 결과를 열어요`;
    el.innerHTML = `<span class="lbl">🕘 최근 진단</span>${catHist.slice(0, 8).map((h) => `<button type="button" data-catkey="${esc(h.key)}" class="${h.key === catData?.key ? "on" : ""}" title="${esc(tip(h))}">${esc(h.name)} <small>${esc(whenTxt(h.ts).split(" ")[0])}</small></button>`).join("")}
      ${catHist.length > 8 ? `<select id="catHistAll" aria-label="전체 진단 기록"><option value="">전체 ${catHist.length}개 ▾</option>${catHist.map((h) => `<option value="${esc(h.key)}">${esc(h.name)} · ${esc(whenTxt(h.ts))}</option>`).join("")}</select>` : ""}`;
  }
  $("catHistBar").addEventListener("click", (e) => { const b = e.target.closest("button[data-catkey]"); if (b) openSavedCat(b.dataset.catkey); });
  $("catHistBar").addEventListener("change", (e) => { if (e.target.id === "catHistAll" && e.target.value) openSavedCat(e.target.value); });
  async function loadCatHist() {
    catHist = (await api.invoke("cat:history").catch(() => [])) || [];
    renderCatHistBar();
    if (pmode === "cat" && !catData) $("grid").innerHTML = startCardsHtml();
  }
  async function openSavedCat(key) {
    const r = await api.invoke("cat:openSaved", key).catch((e) => ({ error: e?.message || String(e) }));
    if (!r || r.error) { log("stop", `✕ ${esc(r?.error || "저장된 진단을 열지 못했어요")}`); return; }
    log("dim", `  저장된 진단 열기 · ${esc(r.name)} (${new Date(r.ts).toLocaleString("ko-KR")}) — Wing 요청 없음`);
    showCat(r, true);
  }

  const SORTS = {
    order: (a, b) => a.it.order - b.it.order,
    sales: (a, b) => (b.it.ex?.sales ?? -1) - (a.it.ex?.sales ?? -1),
    rev: (a, b) => (b.it.rev ?? -1) - (a.it.rev ?? -1),
    cvr: (a, b) => (b.it.cvr ?? -1) - (a.it.cvr ?? -1),
    price: (a, b) => (a.it.ex?.price ?? a.it.price ?? 1e12) - (b.it.ex?.price ?? b.it.price ?? 1e12),
  };
  function renderGrid(d, allOn = true) {
    const kwv = d?.kind === "kw" || d?.kind === "cat"; // 키워드 분석·카테고리 진단 = 결론 카드 + 표/카드
    $("grid").classList.toggle("kwv", kwv || !d); document.body.classList.toggle("kw-sum", d?.kind === "kw"); document.body.classList.toggle("cat-sum", d?.kind === "cat"); // 결론 카드가 위 요약 줄·판정 칸을 대신함
    document.body.classList.toggle("p-empty", !d); // 결과가 없으면 시작 화면(검은 상자 + 최근 기록 카드) — 광고 설정·엑셀·정렬 줄은 숨김
    if (!d) { $("grid").innerHTML = startCardsHtml(); if (pmode === "cat") loadCatHist(); return; }
    const rows = d.items.map((it, i) => ({ it, i })).sort(SORTS[$("sortSel").value] || SORTS.order);
    if (kwv) {
      $("grid").innerHTML = (d.kind === "cat" ? catSummaryHtml(d) : kwSummaryHtml(d)) + (kwLayout === "table" ? kwTableHtml(d, rows) : kwCardsHtml(d, rows));
      return;
    }
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
    if (d) d._e = e; // 결론 카드가 같은 합계를 쓴다
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
    $("bExact").hidden = true; // 카테고리 진단은 판정이 끝나면 판매량을 자동으로 받는다(2026-10-13) — 버튼은 안 보이게, 받기 동작은 이 버튼의 onclick을 그대로 씀
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
  // 윙처럼 1차 → 2차 → 3차 → 4차: 고르면 다음 칸이 채워지고, ▶ 진단을 눌러야 판정
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
    if (n.leaf) $("catGo").focus(); // 말단까지 골라도 바로 조회하지 않음 — ▶ 진단을 눌러야 조회(2026-10-13, 고르는 도중 Wing 요청이 나가지 않게)
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
      $("catLoad").onclick = async () => { $("catLoad").textContent = "불러오는 중… (숨은 Wing 화면에서 인기상품 화면을 엽니다)"; const r = await api.invoke("cat:loadTree").catch(() => null); if (r?.error) $("catLoad").textContent = r.error; };
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
  // 이름 검색에서 고르기: 단계 칸만 채우고 ▶ 진단을 눌러야 조회(2026-10-13)
  function chooseCat(n) {
    if (!n) return;
    catList.hidden = true; catQ.value = ""; catQ.blur();
    syncCascade(n);
    $("catGo").focus();
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
    else if (e.key === "Enter") { e.preventDefault(); chooseCat(catRows[catSel]); return; }
    else if (e.key === "Escape") { catList.hidden = true; return; }
    else return;
    catList.querySelectorAll(".row").forEach((el, i) => el.classList.toggle("on", i === catSel));
    catList.querySelector(".row.on")?.scrollIntoView({ block: "nearest" });
  });
  catList.addEventListener("mousedown", (e) => { const row = e.target.closest(".row"); if (row) { e.preventDefault(); chooseCat(catRows[+row.dataset.i]); } });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".catpick")) catList.hidden = true; });
  api.on("cattree", () => { loadCatTree().then(() => { if (!catList.hidden) renderCatList(); }); });
  loadCatTree();
  loadCatHist(); // 🕘 최근 진단 칩은 처음부터 보이게

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
    name: ["✍ 상품명 짓기", "브랜드 + 타겟키워드 + 서브키워드 · 4~6단어"],
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
    $("ctabs").hidden = v !== "clean" && v !== "cn"; // 쿠팡 검색 · 1688 둘 다 탭 줄(2026-10-13)
    if (v === "clean" || v === "cn") drawTabs(v);
    $("bNewClean").hidden = v !== "clean";
    $("listup").hidden = v !== "list";
    $("collect").hidden = v !== "collect";
    $("siteHint").hidden = v === "list" || v === "collect" || v === "kw" || v === "cat";
    $("detail").hidden = v !== "detail"; if (v === "detail") $("siteHint").hidden = true; // 📄 상세페이지(패널 화면)
    $("reco").hidden = v !== "reco"; if (v === "reco") $("siteHint").hidden = true; // 💡 키워드 추천(패널 화면)
    $("namer").hidden = v !== "name"; if (v === "name") $("siteHint").hidden = true; // ✍ 상품명 짓기(패널 화면)
    $("hintT").textContent = v === "dash" ? "로켓그로스 대시보드를 불러오는 중입니다…" : "화면을 불러오는 중입니다…";
    if ((v === "kw" || v === "cat") && !sortTouched) $("sortSel").value = v === "kw" ? "sales" : "order"; // 키워드 분석은 판매 많은 순이 기본
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
  //  ① 가격: 같은 옵션(vendorItemId)일 때만 · Wing가의 35%~150% 안일 때만(단위가격 오독 방지, 옵션 번호가 정확히 같으면 15%까지) — 아니면 Wing가 + 이유 표시
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
      const low = pg?.vid && it.vid && String(pg.vid) === String(it.vid) ? 0.15 : 0.35; // 옵션 번호가 정확히 같으면 큰 할인(정가 63,800 → 12,800)도 믿는다 — hyoja-core.js pagePrice와 같은 규칙
      const sane = !(wingP > 0) || (pg?.price >= wingP * low && pg?.price <= wingP * 1.5);
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
      // 화면 값이 Wing 값의 20%도 안 되면(Wing 30개 이상일 때) 화면에서 다른 숫자를 읽은 것 — Wing 값을 쓴다(예: "반품 (3)"을 리뷰 3으로 읽음)
      const pageOdd = pg?.reviews != null && it.revWing >= 30 && pg.reviews < it.revWing * 0.2;
      if (pg?.reviews != null && !pageOdd) { it.reviews = pg.reviews; it.rating = pg.rating ?? it.rating; it.revSrc = "page"; c.rev++; }
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
  // saved = 🕘 최근 검색에서 열기: 저장된 결과를 그대로(Wing·쿠팡 화면 요청 없음 · 쿠폰가는 예전에 본 값)
  async function runSearch(keyword, force = false, saved = false, src = "") {
    const kw = String(keyword || "").trim();
    if (!kw) return;
    lateOff?.();
    $("kwInput").value = kw;
    const pages = Number($("kwPages").value) || 1;
    log("sys", `▶ 키워드 검색: <b>${esc(kw)}</b> · ${pages}페이지 (페이지마다 Wing 검색 1회)`);
    prog(0.15);
    $("kwForm").querySelector("button").disabled = true;
    $("kwForm").querySelector("button").textContent = "검색 중…";
    const scan = saved ? null : window.AiScan?.start(kw, pages); // 시그널 스캔(발표 모드) 또는 진행 띠 — 실제 값만 표시 · 🕘 저장된 결과는 연출 없이 바로
    const since = Date.now();
    if (view !== "kw") go("kw");
    const cpOpen = saved ? Promise.resolve(false) : api.invoke("kw:coupang", kw).catch(() => false); // ② 쿠팡 탭에서 같은 검색어 1번(뒤에서) → 카드 가격(쿠폰가)을 수집함에 읽어 둔다
    if (scan) api.invoke("kw:db", kw).then((db) => scan.db(db)).catch(() => scan.db(null));
    const r = await api.invoke("kw:search", { keyword: kw, pages, force, saved, src }).catch((err) => ({ error: err?.message || String(err) }));
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
    if (!saved && r.items.some((it) => it.priceSrc === "wing")) lateCoupon(kw, since); // 쿠팡 화면이 늦게 읽히면(12초 넘게) 도착하는 대로 쿠폰가로 다시 그린다
    const prices = r.items.slice(0, 36).map((it) => it.price ?? it.ex?.price).filter((p) => p > 0); // 1페이지 범위
    kwData = { kind: "kw", keyword: kw, date: new Date().toISOString().slice(0, 10), db: r.db, items: r.items, ts: r.ts || Date.now(), cached: !!r.cached,
      minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null };
    loadHist();
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
  // 🕘 최근 검색: 검색창 아래 최근 8개 칩 + 전체 목록. 누르면 저장된 결과를 Wing 요청 없이 바로 연다(기간 제한 없음, 최근 300개)
  let hist = [];
  const whenTxt = (ts) => { const d = new Date(ts), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    const day = (x) => x.toLocaleDateString("sv-SE"), hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
    return day(d) === day(now) ? `오늘 ${hm}` : day(d) === day(y) ? `어제 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`; };
  const histTip = (h) => `${whenTxt(h.ts)} 조회 · 28일 판매 ${won(h.sales)}개 · 판매액 ${man(h.rev)}원 · 누르면 Wing 요청 없이 저장된 결과를 열어요`;
  function renderHist() {
    const el = $("kwHist"); if (!el) return;
    if (!hist.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="lbl">🕘 최근 검색</span>${hist.slice(0, 8).map((h) => `<button type="button" data-hist="${esc(h.kw)}" class="${h.kw === kwData?.keyword ? "on" : ""}" title="${esc(histTip(h))}">${esc(h.kw)} <small>${esc(whenTxt(h.ts).split(" ")[0])}</small></button>`).join("")}
      ${hist.length > 8 ? `<select id="kwHistAll" aria-label="전체 검색 기록"><option value="">전체 ${hist.length}개 ▾</option>${hist.map((h) => `<option value="${esc(h.kw)}">${esc(h.kw)} · ${esc(whenTxt(h.ts))} · 판매 ${won(h.sales)}개</option>`).join("")}</select>` : ""}`;
  }
  async function loadHist() { hist = await api.invoke("kw:history").catch(() => []) || []; renderHist(); if (pmode === "kw" && !kwData) $("grid").innerHTML = startCardsHtml(); }
  $("kwHist").addEventListener("click", (e) => { const b = e.target.closest("button[data-hist]"); if (b) runSearch(b.dataset.hist, false, true); });
  $("kwHist").addEventListener("change", (e) => { if (e.target.id === "kwHistAll" && e.target.value) runSearch(e.target.value, false, true); });
  loadHist();

  $("kwForm").addEventListener("submit", (e) => { e.preventDefault(); const src = $("kwInput").dataset.src || ""; delete $("kwInput").dataset.src; runSearch($("kwInput").value, false, false, src); });
  $("kwInput").addEventListener("input", () => { delete $("kwInput").dataset.src; }); // 직접 고쳐 쓰면 직접 검색
  $("kwSubs").addEventListener("click", (e) => { const b = e.target.closest("button[data-kw]"); if (b) runSearch(b.dataset.kw); });

  // 카드의 ☆ 리스트업 담기
  $("grid").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-add]");
    const d = cur(); // 키워드 분석 · 카테고리 분석 둘 다
    if (!b || !d) return;
    const it = d.items[+b.dataset.add];
    if (window.Listup?.has(it.pid)) { api.invoke("nav:tab", "list"); return; }
    if (b.dataset.nav) setTimeout(() => api.invoke("nav:tab", b.dataset.nav), 0); // 결론 카드의 🇨🇳 1688 원가 찾기 = 담고 리스트업으로(키워드 추천과 같은 흐름)
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
    if ($("grid").classList.contains("kwv")) renderGrid(d); else refreshCard(+b.dataset.add, true); // 새 표·카드(키워드 분석·카테고리 진단)는 통째로 다시 그림
  });
  $("grid").addEventListener("change", (e) => { if (e.target.id === "stHistAll" && e.target.value) runSearch(e.target.value, false, true); }); // 시작 화면 전체 검색 기록
  // 키워드 분석 결론 카드·표: 서브키워드로 다시 분석 · 판매 없는 상품 펼치기 · 표/카드 보기
  $("grid").addEventListener("click", (e) => {
    const s = e.target.closest("button[data-kw]"); if (s) { runSearch(s.dataset.kw); return; }
    if (e.target.closest("[data-refresh]") && kwData) { runSearch(kwData.keyword, true); return; } // ↻ 새로 조회 = Wing 요청 1번
    const nm = e.target.closest("[data-namer]"); if (nm) { go("name"); window.NameMaker?.open(nm.dataset.namer); return; } // ✍ 상품명 짓기 = 이 키워드로 바로 만들기
    if (e.target.closest("[data-fold]")) { if (cur()?.kind === "cat") catMoreOpen = !catMoreOpen; else kwZeroOpen = !kwZeroOpen; renderGrid(cur()); return; }
    if (e.target.closest("[data-exact]")) { $("bExact").click(); return; }
    const hc = e.target.closest("[data-hist]"); if (hc) { runSearch(hc.dataset.hist, false, true); return; } // 시작 화면 최근 검색 카드
    const ck = e.target.closest("[data-catkey]"); if (ck) { openSavedCat(ck.dataset.catkey); return; } // 시작 화면 최근 진단 카드
    if (e.target.closest("[data-catrefresh]") && catData?.code) { api.invoke("cat:open", { code: catData.code, name: catData.name }); log("sys", `▶ ${esc(catData.name)} 새로 진단 — Wing 응답을 받으면 다시 그립니다`); return; } // 카테고리 결론 카드의 🎯 판매량 받기 = 툴바 버튼과 같음
    const l = e.target.closest("[data-layout]");
    if (l && l.dataset.layout !== kwLayout) { kwLayout = l.dataset.layout; try { localStorage.setItem("kwLayout", kwLayout); } catch {} renderGrid(cur()); }
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
  function showCat(d, saved = false) {
    d.kind = "cat";
    const exByKey = Object.fromEntries((catData?.key === d.key ? catData.items : []).filter((it) => it.ex).map((it) => [key(it), it.ex]));
    d.items.forEach((it) => { if (!it.ex && exByKey[key(it)]) it.ex = exByKey[key(it)]; });
    catData = d;
    if (view === "wing") go("cat"); // Wing 화면을 보는 중에 응답이 오면 판정 화면(본문 전체)으로
    else if (pmode !== "cat" && view !== "kw") setMode("cat");
    clearInterval(revealTimer);
    // 발표 모드: 카테고리 진단 해커 화면(고를 때 띄운 화면이 있으면 이어서, 없으면 새로)
    if (view === "cat" && !saved) { const sc = window.AiScan?.current?.kind === "cat" ? window.AiScan.current : window.AiScan?.diagnose(`${d.path ? d.path + " > " : ""}${d.name}`); sc?.run(d); }
    $("cat").textContent = `Wing 쿠팡 트렌드 · ${d.path ? d.path + " > " : ""}${d.name} · ${d.date}`;
    $("call").className = "call wait"; $("call").textContent = "판정 중…";
    $("tl").className = "tl"; $("chips").innerHTML = ""; $("yuan").textContent = "";
    d._e = enrich(d);
    catMoreOpen = false;
    if (!saved) loadCatHist(); else renderCatHistBar(); // 새로 진단한 카테고리를 최근 목록에 반영 · 다시 연 것은 칩 표시만
    renderGrid(d, false);
    $("insight").innerHTML = ""; $("counts").innerHTML = "";
    $("bExact").disabled = busy; $("bXlsx").disabled = false;
    log("dim", `  기준: ${d.mode === "big" ? "큰 시장(리뷰 500+ 수요 검증)" : "틈새(1위 리뷰 100 미만이 유리)"} · 이미지·리뷰·28일 조회 = Wing 실데이터 · 전체 ${won(d.total)}개 중 상위 ${d.items.length}개`);
    const cards = [...document.querySelectorAll(".card")];
    let i = 0;
    const finish = () => {
      clearInterval(revealTimer);
      setVerdict(d); insight(d);
      if (!saved) autoExact(); // 저장된 진단을 다시 열 때는 Wing 요청 없이 — 비어 있는 판매량은 결론 카드의 "↻ 이어서 받기"로
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
    if (tab === "name") window.NameMaker?.show();
    if (tab === "wing") footStatus();
  });
  api.on("exact:progress", ({ pos, total, status, msg }) => {
    if (window.AiScan?.current?.kind === "exact") window.AiScan.current.progress({ pos, total, status, msg });
    prog(total ? pos / total : 0);
    const cls = /✕|실패|제한|정지|한도|로그인/.test(msg) ? "stop" : status === "done" ? "sys" : /재사용/.test(msg) ? "dim" : "go";
    log(cls, `${status === "done" ? "■" : "↳"} [${pos}/${total}] ${esc(msg)}`);
    if (["done", "stopped", "paused"].includes(status)) {
      busy = false; $("bExact").disabled = !catData; $("bStop").hidden = true;
      if (exactQueued) { exactQueued = false; setTimeout(autoExact, 0); return; } // 이전 카테고리를 멈추고 새 카테고리 받기
      if (catData && pmode === "cat" && $("grid").classList.contains("kwv")) renderGrid(catData); // 결론 카드의 🎯 버튼 다시 켜기
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
    if ($("grid").classList.contains("kwv")) renderGrid(catData); // 새 표·카드: 통째로 다시 그림(결론 카드 숫자도 같이)
    else catData.items.forEach((it, i) => it.ex && refreshCard(i, i === idx));
    const it = catData.items[idx];
  });
  // 자동 업데이트: 새 버전을 다 받으면 버튼 표시
  api.on("update", ({ version }) => { $("bUpdate").hidden = false; $("bUpdate").textContent = `⬆ ${version} 업데이트 · 다시 시작`; });
  // ⬆ 화면만 바로 업데이트(main/hot.js) — 설치 파일 업데이트가 같이 있으면 설치 파일 쪽이 우선
  let hotOnly = false;
  api.on("hot", (h) => { if (!h || (!$("bUpdate").hidden && !hotOnly)) return; hotOnly = true; $("bUpdate").hidden = false; $("bUpdate").textContent = `⬆ 새 버전 ${h.label} · 바로 적용`; $("bUpdate").title = h.notes || "고친 화면을 바로 적용해요(몇 초 뒤 다시 켜짐)"; });
  api.on("update", () => { hotOnly = false; });
  // 🔒 수강생 확인 화면이 위를 덮어 '바로 적용'이 안 보이던 문제(2026-11-17) → 확인 화면 안에도 같은 버튼
  new MutationObserver(() => { const b = $("bUpdate"); ["gUpdate1", "gUpdate2"].forEach((id) => { const g = $(id); if (!g) return; g.hidden = b.hidden; g.textContent = b.textContent; g.disabled = b.disabled; }); })
    .observe($("bUpdate"), { attributes: true, childList: true, characterData: true, subtree: true });
  ["gUpdate1", "gUpdate2"].forEach((id) => $(id)?.addEventListener("click", () => $("bUpdate").click()));
  $("bUpdate").onclick = () => { $("bUpdate").disabled = true; $("bUpdate").textContent = hotOnly ? "적용 중…" : "설치 중…"; api.invoke(hotOnly ? "hot:apply" : "update:install"); };
  const showVer = (v) => { if (!v) return; $("appVer").textContent = `v${v}`; $("gateVer").textContent = `v${v}`; document.querySelector(".side .brand").title = `씨드핵 SEEDHACK v${v} — 매일 한 톨, 시스템처럼.`; };
  api.on("version", showVer);
  api.invoke("app:version").then(showVer);
  // ② 쿠팡 검색 탭 줄 — 같은 클린 세션 안의 여러 탭
  const tabName = (t) => {
    const clean = () => t.title.replace(/\s*[-|:]\s*쿠팡!?.*$/, "").replace(/^쿠팡!?\s*[-|:]?\s*/, "");
    try {
      const u = new URL(t.url);
      if (/\/vp\/products\//.test(u.pathname)) return `🛒 ${clean() || "상품"}`; // 상품 페이지(주소에 검색어 q가 붙어 있어도 상품으로 · 2026-10-13)
      const q = u.searchParams.get("q");
      if (q) return `🔍 ${q}`;
      if (/\/np\/categories\//.test(u.pathname)) return `📂 ${t.title.replace(/\s*[-|:]\s*쿠팡.*$/, "").replace(/^쿠팡!?\s*[-|:]?\s*/, "") || "카테고리"}`;
    } catch {}
    return t.title.replace(/\s*[-|:]\s*쿠팡!?.*$/, "").replace(/^쿠팡!?\s*[-|:]?\s*/, "") || "쿠팡";
  };
  // 1688 탭 이름: 첫 탭은 "🔍 1688 검색"(고정) · 상품 페이지는 🛒 + 제목(뒤의 "-阿里巴巴" 등은 뺌)
  const cnTabName = (t) => {
    if (t.fixed) return "🔍 1688 검색";
    const title = String(t.title || "").replace(/\s*[-_|]\s*(阿里巴巴|1688|淘宝|Alibaba).*$/i, "").trim();
    return /detail\.1688\.com\/offer\//.test(t.url) ? `🛒 ${title || "상품"}` : title || "1688";
  };
  const tabState = {}; // kind(clean·cn) → 마지막으로 받은 탭 목록
  function drawTabs(kind) {
    const st = tabState[kind]; if (!st) { $("ctabs").innerHTML = ""; return; }
    const { tabs, active } = st;
    $("ctabs").innerHTML = tabs.map((t) => `<div class="ctab ${t.id === active ? "on" : ""} ${t.fixed ? "fixed" : ""}" role="tab" aria-selected="${t.id === active}" data-id="${t.id}" title="${esc(t.title)}\n${esc(t.url)}">
      ${t.loading ? `<i class="spin"></i>` : ""}<span>${esc(kind === "cn" ? cnTabName(t) : tabName(t))}</span>${t.fixed ? "" : `<button type="button" class="x" data-close="${t.id}" title="탭 닫기">×</button>`}</div>`).join("") +
      `<button type="button" class="ctab-new" id="ctabNew" title="새 탭 (${kind === "cn" ? "1688" : "쿠팡"} 첫 화면)">+</button>`;
  }
  api.on("ctabs", ({ kind = "clean", tabs, active }) => {
    tabState[kind] = { tabs, active };
    if (view === kind) drawTabs(kind);
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

  // 🔍 작은 사진 크게 보기(2026-10-13): 리스트업·수집함 표의 사진에 마우스를 올리면 옆에 큰 사진
  //  표가 스크롤 상자 안이라 칸 안에 띄우면 잘림 → 화면 위에 떠서 창 안에 맞춰 위치를 잡는다 · 쿠팡 사진은 큰 크기(492)로 불러와 선명하게
  const zoomBox = document.createElement("div");
  zoomBox.className = "img-zoom"; zoomBox.hidden = true; zoomBox.innerHTML = `<img alt="">`;
  document.body.appendChild(zoomBox);
  const zImg = zoomBox.querySelector("img");
  const bigSrc = (src) => String(src).replace("/thumbnails/remote/230x230ex/", "/thumbnails/remote/492x492ex/");
  zImg.addEventListener("error", () => { if (zImg.dataset.small && zImg.src !== zImg.dataset.small) zImg.src = zImg.dataset.small; }); // 큰 사진이 없으면 원래 사진
  const ZOOM_SEL = "#luTable td.thumb img, #coTable td.thumb img";
  document.addEventListener("mouseover", (e) => {
    const im = e.target.closest?.(ZOOM_SEL); if (!im || !im.src) return;
    zImg.dataset.small = im.src; zImg.src = bigSrc(im.src);
    const r = im.getBoundingClientRect(), S = 300, gap = 12;
    let x = r.right + gap; if (x + S > innerWidth - 8) x = Math.max(8, r.left - gap - S);
    const y = Math.min(Math.max(8, r.top + r.height / 2 - S / 2), innerHeight - S - 8);
    zoomBox.style.left = `${x}px`; zoomBox.style.top = `${y}px`; zoomBox.hidden = false;
  });
  document.addEventListener("mouseout", (e) => { if (e.target.closest?.(ZOOM_SEL)) zoomBox.hidden = true; });
  document.addEventListener("scroll", () => { zoomBox.hidden = true; }, true);
  document.addEventListener("mousedown", () => { zoomBox.hidden = true; }, true);

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
    if ($("grid").classList.contains("kwv")) renderGrid(catData); // 결론 카드의 🎯 버튼 끄기
    log("sys", `▶ 정확한 28일 조회·판매량 조회 · ${need.length}개 · Wing 상품 매칭 검색(요청 간격 4초)${b.budget ? ` · 하루 예산 ${b.used}/${b.budget}` : ""}`);
    // 🎤 발표 모드: 판매량 받기 해커 화면(조회 순서 그대로)
    window.AiScan?.exact(need.map((it) => ({ key: key(it), img: it.img, name: it.name, order: it.order, price: it.ex?.price ?? it.price, reviews: it.reviews })), `${catData.path ? catData.path + " > " : ""}${catData.name || ""}`);
    const r = await api.invoke("exact:start", { items: need.map((it) => ({ pid: it.pid, vid: it.vid, iid: it.iid, name: it.name })), catName: catData.name }); // 카테고리 이름으로 키워드 검색 1번 먼저 → 없는 상품만 하나씩
    if (r?.error) { if (window.AiScan?.current?.kind === "exact") window.AiScan.current.fail(r.error); log("stop", `✕ ${esc(r.error)}`); busy = false; $("bExact").disabled = false; $("bStop").hidden = true; }
  };
  $("bStop").onclick = () => { exactQueued = false; api.invoke("exact:stop"); };
  // 카테고리 진단: 판정이 끝나면 상위 10개(PB 제외) 판매량을 바로 받는다 — 키워드 분석·추천처럼 자동. 다른 카테고리를 받는 중이면 멈추고 새 카테고리로
  let exactQueued = false;
  function autoExact() {
    if (!catData) return;
    if (busy) { exactQueued = true; api.invoke("exact:stop"); return; } // 멈춤이 끝나면(exact:progress stopped) 이어서 시작
    $("bExact").onclick();
  }
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
  let sortTouched = false; // 직접 고르기 전에는 키워드 분석 = 판매량순, 카테고리 진단 = 기본 순서
  $("sortSel").onchange = () => { sortTouched = true; renderGrid(cur()); };
  // 키워드 분석: 광고 가정은 한 줄 요약 버튼 뒤로 접는다(누르면 펼침)
  const adFoldLabel = () => { $("adFold").textContent = `⚙ 광고 ${adsOn ? "함" : "안 함"} · 클릭 ${AdModel.cpc}원 · 광고전환 ${Math.round(AdModel.conv * 100)}%`; };
  $("adFold").onclick = () => { const open = document.body.classList.toggle("ad-open"); $("adFold").setAttribute("aria-expanded", String(open)); };

  const press =(on, off) => { $(on).setAttribute("aria-pressed", "true"); $(off).setAttribute("aria-pressed", "false"); };
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
    }).then(() => { window.Listup?.reloadCfg(); window.Collect?.load({ force: true }); });
    press(on ? "adOn" : "adOff", on ? "adOff" : "adOn"); adFoldLabel();
    if (pmode === "kw") { insight(kwData); renderGrid(kwData); }
    setCatSetting({ ads: on });
  };
  const adModelChanged = (patch) => {
    api.invoke("settings:set", patch).then((d) => { if (d) updateCat(d); window.Collect?.load({ force: true }); window.Listup?.reloadCfg(); });
    adFoldLabel();
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
    adFoldLabel();
  });
  adFoldLabel();

  // 리스트업 화면이 담김 상태를 바꾸면 카드 버튼을 다시 그린다
  window.PanelHooks = { onListupChange: () => { const d = cur(); if (d) renderGrid(d); }, log };
  setMode("kw");
  showView("wing");
})();
