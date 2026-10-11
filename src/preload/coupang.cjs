// 쿠팡 화면(클린 세션)에 "쿠팡 지표"를 붙이는 스크립트 — 로켓그로스 확장의 coupang_overlay.js를 앱용으로 옮김.
// 격리된 영역에서 실행되어 쿠팡 페이지 스크립트는 이 코드를 볼 수 없다. 조회는 버튼을 누를 때만, 앱(메인 프로세스)이 Wing에서 한다.
const { ipcRenderer } = require("electron");

const BLOCK_RE = /사용권한이 없습니다|권한이 제한된 페이지|비정상적인 접근|Access Denied|자동입력 방지/i;

function start() {
  const testPage = location.protocol === "file:" && /fake-coupang/.test(location.pathname); // 자체 테스트용 가짜 쿠팡 화면
  if (!testPage && (!/(^|\.)coupang\.com$/i.test(location.hostname) || /^wing\./.test(location.hostname))) return;
  if (document.querySelector(".sg-cp-button")) return;

  const results = new Map(); // key -> {state, data}
  const queued = new Set();
  let paused = false, done = 0, total = 0, busy = 0;

  const fmt = (v) => (v == null || !Number.isFinite(+v) ? "-" : Math.round(v).toLocaleString("ko-KR"));
  const man = (v) => (v == null ? "-" : v >= 1e8 ? (v / 1e8).toFixed(1) + "억" : v >= 1e4 ? Math.round(v / 1e4).toLocaleString("ko-KR") + "만" : fmt(v));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const style = document.createElement("style");
  style.textContent = `
  .sg-cp-button{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:2147483647;border:0;border-radius:9px;background:#0b0f14;color:#fff;font:700 12.5px/1.3 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:11px 13px;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer;max-width:170px;text-align:left}
  .sg-cp-button b{color:#3ddc84}
  .sg-cp-button[disabled]{opacity:.75;cursor:wait}
  .sg-cp{position:absolute;right:6px;top:6px;z-index:2147483646;min-width:132px;max-width:190px;border-radius:7px;background:rgba(11,15,20,.88);color:#fff;font:700 11.5px/1.4 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:6px 8px;box-shadow:0 6px 18px rgba(0,0,0,.28);pointer-events:none;text-align:left}
  .sg-cp .t{font-size:10.5px;color:#9fb3c8;margin-bottom:2px}
  .sg-cp .r{display:flex;justify-content:space-between;gap:10px;white-space:nowrap}
  .sg-cp .r span{color:#9fb3c8;font-weight:600}
  .sg-cp .cv{color:#3ddc84;font-weight:800;margin-top:1px}
  .sg-cp.err{background:rgba(127,29,29,.9)}
  .sg-cp.wait .t{color:#ffcc4d}
  .sg-cp.pb{background:rgba(71,85,105,.85)}`;

  // ---- 상품 카드 찾기 (확장과 같은 규칙: /products/ 링크 → 이미지가 있는 카드 상자) ----
  const pidOf = (url) => (String(url).match(/\/(?:vp\/|vm\/)?products\/(\d+)/) || [])[1] || "";
  const vidOf = (url) => (String(url).match(/[?&]vendorItemId=(\d+)/) || [])[1] || "";
  const iidOf = (url) => (String(url).match(/[?&]itemId=(\d+)/) || [])[1] || "";
  const big = (el) => { const r = el.getBoundingClientRect(); return r.width > 120 && r.height > 130 && r.width < 680 && r.height < 900; };
  function cardOf(a) {
    let n = a;
    for (let i = 0; i < 7 && n && n !== document.body; i++) {
      const img = n.querySelector && n.querySelector("img");
      if (img && big(n)) { const ir = img.getBoundingClientRect(); if (ir.width >= 48 && ir.height >= 48) return n; }
      n = n.parentElement;
    }
    return a.closest("li") || null;
  }
  // 상품 화면 판매가: 위쪽 구매 칸에서 "3,900원"처럼 생긴 글자 중 가장 큰 글씨(할인 전 가격·적립금보다 판매가 글씨가 크다)
  function pagePrice() {
    let best = null;
    for (const el of document.querySelectorAll("strong, span, div, em")) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || "").replace(/\s+/g, "");
      const m = t.match(/^(\d{1,3}(?:,\d{3})+|\d{3,7})원$/); if (!m) continue;
      const r = el.getBoundingClientRect(); if (!r.width || r.top > 900 || r.top < 0) continue;
      if (getComputedStyle(el).textDecorationLine.includes("line-through")) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0, v = Number(m[1].replace(/,/g, ""));
      if (v >= 100 && (!best || fs > best.fs)) best = { v, fs };
    }
    return best ? best.v : null;
  }
  function priceOf(card) {
    const lines = String(card.innerText || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let best = null, bestScore = -1e9;
    lines.forEach((line, i) => {
      if (/최대|적립|도착|배송|로켓|리뷰|상품평|모레|내일|오늘/.test(line)) return;
      const m = line.match(/[\d,]{3,}\s*원/g);
      if (!m) return;
      let s = 10;
      if (/\d\s*[a-zA-Z가-힣]*\s*당(?:\s|\)|[\d,])/.test(line)) s -= 60; // 단위가격
      if (/^\d{1,3}%$/.test(lines[i - 1] || "")) s += 40;
      if (/쿠폰|와우|할인가|판매가/.test(line)) s += 35;
      const v = Math.min(...m.map((x) => +x.replace(/[^\d]/g, "")));
      if (s > bestScore || (s === bestScore && i > -1)) { best = v; bestScore = s; }
    });
    return best;
  }
  // 추천 영역(본 검색 목록이 아님): "최근 다른 고객이 많이 구매한 상품", "한정시간 특가", "이 상품을 검색한 다른 분들이 함께 본 상품"
  // → 제목 글자를 찾아, 그 제목을 품은 가장 작은 상품 묶음(서로 다른 상품 3개 이상, 40개 이하)의 상품 링크를 제외한다.
  const WIDGET_RE = /다른\s*고객이?\s*많이\s*구매|한정\s*시간|함께\s*본\s*상품|검색한\s*다른\s*분/;
  const MAIN_MAX = 60; // 본 목록은 한 페이지 4개 × 15줄
  function widgetLinks() {
    const set = new Set();
    let heads = 0;
    document.querySelectorAll("h1,h2,h3,h4,h5,strong,b,p,span,div,em,dt").forEach((el) => {
      if (el.children.length > 3 || el.closest('a[href*="/products/"]')) return; // 상품 카드 안의 배지 글자는 제외
      const t = (el.textContent || "").trim();
      if (!t || t.length > 40 || !WIDGET_RE.test(t)) return;
      heads++;
      for (let box = el.parentElement, i = 0; i < 10 && box && box !== document.body; i++, box = box.parentElement) {
        const links = [...box.querySelectorAll('a[href*="/products/"]')];
        const n = new Set(links.map((a) => pidOf(a.href))).size;
        if (n >= 3) { if (n <= 40) links.forEach((a) => set.add(a)); break; }
      }
    });
    return { set, heads };
  }
  let lastWidget = "";
  function scan(near = true) {
    const seen = new Set(), all = [];
    const { set: skip, heads } = widgetLinks();
    document.querySelectorAll('a[href*="/products/"]').forEach((a) => {
      if (skip.has(a)) return;
      const pid = pidOf(a.href);
      if (!pid) return;
      const card = cardOf(a);
      if (!card || seen.has(card)) return; // 링크가 카드 전체를 감싸는 구조도 있어 카드 안 주소 검사는 하지 않는다
      if ([...card.querySelectorAll('a[href*="/products/"]')].some((x) => skip.has(x))) return;
      const r = card.getBoundingClientRect();
      if (r.width === 0) return;
      seen.add(card);
      const img = card.querySelector("img");
      const name = (img && img.alt && img.alt.length >= 4 ? img.alt : (card.querySelector('[class*="name"],[class*="title"]')?.textContent || "")).trim().slice(0, 120);
      const text = String(card.innerText || "");
      all.push({
        key: `${pid}:${vidOf(a.href)}`, pid, vid: vidOf(a.href), iid: iidOf(a.href), name, price: priceOf(card), card,
        img: img ? (img.currentSrc || img.src || "").slice(0, 400) : "",
        adSlot: /(^|\n)\s*(광고|AD)\s*(\n|$)/.test(text) || !!card.querySelector('[class*="ad-badge"],[class*="AdMark"],[data-adsplatform]'),
        ...(() => { const r = reviewsOf(card, text, name); return { reviews: r.n, revSrc: r.src }; })(), rating: ratingOf(card),
        ...shipOf(card, text),
      });
    });
    const main = all.slice(0, MAIN_MAX); // 본 목록 위에서부터 60개
    // 화면 순서대로 노출 순위 — 전체 순위(rank)와 광고 칸을 뺀 순위(organic)
    let org = 0;
    main.forEach((it, i) => { it.rank = i + 1; it.organic = it.adSlot ? null : ++org; });
    const msg = `본 목록 ${main.length}개${all.length > MAIN_MAX ? ` (그 아래 ${all.length - MAIN_MAX}개 제외)` : ""} · 추천 영역 ${heads}곳 상품 ${skip.size}개 제외`;
    if (msg !== lastWidget) { lastWidget = msg; ipcRenderer.send("cp:log", msg); }
    return near ? main.filter((it) => { const b = it.card.getBoundingClientRect(); return b.bottom >= 0 && b.top <= innerHeight * 3; }) : main;
  }
  // 리뷰 수: ① 리뷰/평점 "개수" 칸 → ② 별점 옆 괄호 숫자 → ③ 카드 글에서 상품명을 뺀 뒤 마지막 "(숫자)".
  // 예전에는 카드 글 전체의 첫 "(숫자)"를 써서, 상품명·옵션의 "(3)" 같은 숫자를 리뷰로 잘못 읽을 수 있었다.
  const cls = (e) => String(e.className && e.className.baseVal != null ? e.className.baseVal : e.className || "");
  const numIn = (t) => { const m = String(t || "").match(/\(?\s*(\d[\d,]*)\s*\)?/); return m ? +m[1].replace(/,/g, "") : null; };
  function reviewsOf(card, text, name) {
    const countEl = [...card.querySelectorAll("*")].find((e) => /((rating|review)[-_]?(total[-_]?)?count|count[-_]?(rating|review)|ratingTotal|reviewCnt)/i.test(cls(e)) && /\d/.test(e.textContent));
    if (countEl) return { n: numIn(countEl.textContent), src: `칸 ${cls(countEl).slice(0, 40)}` };
    const star = [...card.querySelectorAll("*")].find((e) => /(star|rating)/i.test(cls(e)));
    if (star) {
      let host = star.parentElement;
      for (let i = 0; i < 3 && host && host !== card; i++, host = host.parentElement) {
        const m = String(host.textContent).match(/\((\d[\d,]*)\)/);
        if (m) return { n: +m[1].replace(/,/g, ""), src: `별점 옆 ${cls(host).slice(0, 30)}` };
      }
    }
    let t = String(text || "");
    if (name) t = t.split(name).join(" ");
    const all = [...t.matchAll(/\((\d[\d,]*)\)/g)].map((m) => +m[1].replace(/,/g, ""));
    return { n: all.length ? all[all.length - 1] : null, src: all.length ? `글 마지막 괄호 [${all.join(",")}]` : "없음" };
  }
  // 배송 유형(화면 기준): 배지 그림의 alt·주소·글자 + 도착 예정일. Wing 조회값(deliveryType)이 있으면 그쪽이 우선(메인에서).
  const DAY = 864e5;
  function arrivalDays(text) {
    if (/오늘\s*\(?.?\)?\s*(도착|출발)|새벽\s*도착/.test(text)) return 0;
    if (/내일\s*\(?.?\)?\s*(새벽\s*)?도착/.test(text)) return 1;
    if (/모레\s*\(?.?\)?\s*(새벽\s*)?도착/.test(text)) return 2;
    const m = text.match(/(\d{1,2})\/(\d{1,2})\s*\(?[월화수목금토일]?\)?\s*(새벽\s*)?도착/);
    if (m) {
      const now = new Date(), y = now.getFullYear();
      let d = new Date(y, +m[1] - 1, +m[2]);
      if (d - now < -30 * DAY) d = new Date(y + 1, +m[1] - 1, +m[2]); // 연말→연초
      return Math.max(0, Math.round((d - new Date(y, now.getMonth(), now.getDate())) / DAY));
    }
    return null;
  }
  function shipOf(card, text) {
    const marks = [...card.querySelectorAll("img")].map((i) => `${i.alt || ""} ${i.getAttribute("src") || ""}`).join(" ") + " " + [...card.querySelectorAll("[class]")].map(cls).join(" ");
    const all = marks + " " + text;
    const days = arrivalDays(text);
    let ship = "일반배송";
    if (/로켓직구|해외\s*배송|해외직구|global|jikgu/i.test(all)) ship = "해외배송";
    else if (/판매자\s*로켓|rocket[-_]?merchant|merchant[-_]?rocket|seller[-_]?rocket/i.test(all)) ship = "판매자로켓";
    else if (/로켓\s*(배송|프레시|와우)|rocket[-_]?(delivery|wow|fresh)|logo[-_]?rocket|badge[-_]?rocket/i.test(all) || /img[^ ]*rocket/i.test(marks)) ship = "로켓배송";
    else if (days != null && days >= 5) ship = "해외배송";
    return { ship, shipDays: days, rocket: ship === "로켓배송" || ship === "판매자로켓" };
  }
  function ratingOf(card) {
    const el = card.querySelector('[class*="rating"] [style*="width"],[class*="star"] [style*="width"]');
    const w = el && parseFloat(el.style.width);
    if (w > 0 && w <= 100) return Math.round((w / 20) * 10) / 10;
    const t = card.querySelector('[class*="rating"] em,[class*="rating"] span');
    const v = t && parseFloat(t.textContent);
    return v > 0 && v <= 5 ? v : null;
  }
  // 검색 화면이면 화면에 있는 카드 정보를 수집함에 보낸다(지표 조회와 별개, 네트워크 요청 없음)
  // 검색 결과면 검색어, 카테고리 페이지면 "📂 카테고리명"을 순위 기준으로 쓴다
  function pageQuery(u) {
    const q = u.searchParams.get("q") || u.searchParams.get("query") || "";
    if (q) return q.trim();
    if (/\/products\//.test(u.pathname)) { // 상품 상세: 키워드 분석·검색 결과에서 넘어온 검색어
      try { const ref = new URL(document.referrer); const rq = ref.searchParams.get("q") || ref.searchParams.get("query") || ""; if (rq) return rq.trim(); } catch {}
      try { const sq = sessionStorage.getItem("sg-last-q"); if (sq) return sq; } catch {}
      return "";
    }
    try { sessionStorage.setItem("sg-last-q", q); } catch {}
    const cat = u.pathname.match(/\/np\/categories\/(\d+)/);
    if (!cat) return "";
    const crumb = [...document.querySelectorAll('[class*="breadcrumb"] a, [class*="breadcrumb"] li, [class*="Breadcrumb"] a')].map((e) => e.textContent.trim()).filter((t) => t && t !== "쿠팡 홈" && t !== "홈");
    const title = (document.querySelector('h1, h2[class*="title"], [class*="category-title"], [class*="CategoryTitle"]')?.textContent || "").trim();
    const fromDoc = document.title.replace(/\s*[-|:]\s*쿠팡.*$/, "").replace(/^쿠팡!?\s*[-|:]?\s*/, "").trim();
    const name = crumb.at(-1) || (title.length <= 30 ? title : "") || fromDoc || `카테고리 ${cat[1]}`;
    return `📂 ${name.slice(0, 30)}`;
  }
  function reportPage(items) {
    const u = new URL(location.href);
    const query = pageQuery(u);
    if (!query) return;
    const page = +(u.searchParams.get("page") || 1);
    const per = +(u.searchParams.get("listSize") || 0) || items.length; // 2페이지부터는 앞 페이지 개수만큼 더해 전체 순위로
    items.forEach((it) => { it.rank += (page - 1) * per; if (it.organic) it.organic += (page - 1) * per; });
    // raw: 카드 글 앞부분(가격·리뷰를 어디서 읽었는지 나중에 대조하는 근거)
    ipcRenderer.send("cp:page", { query, page, items: items.map(({ card, key, ...rest }) => ({ ...rest, raw: String(card.innerText || "").split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" | ").slice(0, 300) })) });
    items.slice(0, 10).forEach((it) => ipcRenderer.send("cp:log", `리뷰 진단 ${it.rank}위 ${it.name.slice(0, 14)} → ${it.reviews ?? "-"} (${it.revSrc})`));
    // 구조 덤프(2·3위만): 카드 글 줄과 별점/리뷰 관련 요소 — 리뷰 칸을 정확히 찾기 위한 임시 진단
    const cardsNow = scan(false);
    cardsNow.slice(1, 3).forEach((it) => {
      ipcRenderer.send("cp:log", `구조 ${it.rank}위 글: ${String(it.card.innerText).split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" | ").slice(0, 400)}`);
      ipcRenderer.send("cp:log", `구조 ${it.rank}위 배송: ${it.ship}${it.shipDays != null ? ` ${it.shipDays}일` : ""} · 그림: ${[...it.card.querySelectorAll("img")].map((i) => (i.alt || "") + "~" + String(i.getAttribute("src") || "").split("/").pop().slice(0, 30)).slice(0, 6).join(" , ")}`);
      [...it.card.querySelectorAll("*")].filter((e) => /(star|rating|review|Rating|Review|Star)/.test(cls(e)) || e.getAttribute("aria-label")).slice(0, 8)
        .forEach((e) => ipcRenderer.send("cp:log", `구조 ${it.rank}위 요소: <${e.tagName.toLowerCase()} class="${cls(e).slice(0, 60)}"${e.getAttribute("aria-label") ? ` aria="${e.getAttribute("aria-label")}"` : ""}${e.getAttribute("style") ? ` style="${e.getAttribute("style").slice(0, 40)}"` : ""}> 글="${e.textContent.trim().slice(0, 40)}"`));
    });
  }

  // 카드를 못 찾았을 때 화면 구조를 앱 콘솔에 남긴다(상품 정보·개인정보 없이 태그·크기만)
  function diagnose() {
    const as = [...document.querySelectorAll('a[href*="/products/"]')];
    ipcRenderer.send("cp:log", `진단: 상품 링크 ${as.length}개 · 화면 높이 ${innerHeight}`);
    as.slice(0, 2).forEach((a, i) => {
      const chain = [];
      let n = a;
      for (let k = 0; k < 7 && n && n !== document.body; k++, n = n.parentElement) {
        const r = n.getBoundingClientRect(), img = n.querySelector && n.querySelector("img"), ir = img && img.getBoundingClientRect();
        chain.push(`${n.tagName.toLowerCase()}.${String(n.className || "").split(/\s+/)[0].slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)}${img ? ` img ${Math.round(ir.width)}x${Math.round(ir.height)}` : ""}`);
      }
      ipcRenderer.send("cp:log", `진단 링크${i + 1}: ${a.getAttribute("href").slice(0, 40)} → ${chain.join(" ‹ ")}`);
    });
  }

  // ---- 표시 ----
  function box(card) {
    if (getComputedStyle(card).position === "static") card.style.position = "relative";
    let b = card.querySelector(":scope > .sg-cp");
    if (!b) { b = document.createElement("div"); b.className = "sg-cp"; card.appendChild(b); }
    return b;
  }
  function paint(item, state, d) {
    const b = box(item.card);
    b.className = "sg-cp" + (state === "err" ? " err" : state === "wait" ? " wait" : state === "pb" ? " pb" : "");
    if (state === "wait") { b.innerHTML = `<div class="t">조회 대기 · 4초 간격</div>`; return; }
    if (state === "pb") { b.innerHTML = `<div class="t">쿠팡 PB</div><div>판매자 지표 없음</div>`; return; }
    if (state === "err") { b.innerHTML = `<div class="t">조회 실패</div><div>${esc(d.error)}</div>`; return; }
    const ex = d.ex, price = ex.price ?? item.price;
    const cvr = ex.views ? (ex.sales / ex.views) * 100 : null;
    const age = ex.ts ? Math.floor((Date.now() - ex.ts) / 864e5) : 0;
    b.innerHTML = `<div class="t">쿠팡 지표 · 최근 28일${age >= 1 ? ` · ${age}일 전 값` : ""}</div>
      <div class="r"><span>판매가</span>${fmt(price)}원</div>
      <div class="r"><span>판매량</span>${fmt(ex.sales)}</div>
      <div class="r"><span>판매액</span>${ex.sales != null && price ? man(ex.sales * price) + "원" : "-"}</div>
      <div class="r"><span>조회수</span>${fmt(ex.views)}</div>
      <div class="cv">전환율 ${cvr == null ? "-" : cvr.toFixed(2) + "%"}</div>`;
  }
  let stopReq = false, waitUntil = 0, runTotal = 0, runDone = 0;
  const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));
  function label() {
    if (busy) {
      btn.disabled = false;
      if (waitUntil > Date.now()) { btn.innerHTML = `⏸ 10분 한도 대기 · ${mins(waitUntil - Date.now())}분 뒤 자동 계속<br><small>${runDone}/${runTotal} · 누르면 멈춤</small>`; return; }
      const left = runTotal - runDone;
      btn.innerHTML = `⏹ 멈추기 · <b>${runDone}/${runTotal}</b><br><small>남은 ${left}개 · 최대 약 ${mins(left * 4200)}분 (저장값·PB는 즉시)</small>`;
      return;
    }
    if (paused) { btn.disabled = false; btn.innerHTML = `⏸ 조회 정지<br><small>${esc(paused)}</small>`; return; }
    btn.disabled = false;
    btn.innerHTML = total ? `📊 이 페이지 다시 보기<br><small>${done}개 완료 · 새 카드만 조회</small>` : `📊 이 페이지 쿠팡 지표<br><small>판매량·조회수·전환율 · 페이지 전체</small>`;
  }

  async function runOne(item) {
    const r = await ipcRenderer.invoke("cp:metric", { pid: item.pid, vid: item.vid, iid: item.iid, name: item.name, price: item.price, img: item.img });
    if (r && r.soft) return r; // 10분 한도: 실패 처리하지 않고 기다렸다가 같은 상품부터 다시
    queued.delete(item.key);
    done++; runDone++;
    if (r && r.ex) { results.set(item.key, { state: "ok", data: r }); paint(item, "ok", r); }
    else if (r && r.pb) { results.set(item.key, { state: "pb", data: r }); paint(item, "pb", r); }
    else {
      results.set(item.key, { state: "err", data: r || { error: "응답 없음" } });
      paint(item, "err", r || { error: "응답 없음" });
      if (r && (r.paused || r.auth)) { paused = r.error; paint(item, "pb", { error: r.error }); item.card.querySelector(".sg-cp").innerHTML = `<div class="t">${r.auth ? "Wing 로그인 필요" : "조회 정지"}</div><div>${esc(r.error)}</div>`; }
    }
    label();
    return r;
  }

  // 검색어 한 번 요청으로 여러 상품 지표를 먼저 받는다(요청 수는 그대로, 받는 양을 늘림). 검색어당 한 번만 시도.
  const batchTried = new Set();
  async function batch(all) {
    const query = pageQuery(new URL(location.href));
    if (!query || query.startsWith("📂") || batchTried.has(query)) return;
    batchTried.add(query);
    btn.disabled = true; btn.innerHTML = `검색어로 한 번에 받는 중…<br><small>'${esc(query)}'</small>`;
    const r = await ipcRenderer.invoke("cp:batch", { query, pids: all.map((it) => it.pid) });
    let n = 0;
    all.forEach((it) => {
      const ex = r?.hits?.[it.pid];
      if (!ex || results.get(it.key)?.state === "ok") return;
      const d = { ex, cached: r.cached };
      results.set(it.key, { state: "ok", data: d }); paint(it, "ok", d); n++;
    });
    done += n; total += n;
    if (r?.paused || r?.auth) { paused = r.error; }
  }

  async function onClick() {
    if (busy) { stopReq = true; btn.innerHTML = "멈추는 중…"; return; } // 진행 중에 누르면 멈춤
    if (BLOCK_RE.test(String(document.body?.innerText || "").slice(0, 8000))) { paused = "쿠팡 접근 제한 화면 — 조회하지 않습니다"; label(); return; }
    paused = false; stopReq = false;
    const all = scan(false);
    reportPage(all); // 순위·가격은 페이지 전체 카드 기준
    await batch(all);
    if (paused) { label(); return; }
    // 페이지 전체를 위에서부터(화면 순서) — 이미 받은 카드는 다시 그리고, 새 카드만 조회
    const items = scan(false);
    items.forEach((it) => { const c = results.get(it.key); if (c && (c.state === "ok" || c.state === "pb")) paint(it, c.state, c.data); });
    const todo = items.filter((it) => !queued.has(it.key) && (!results.has(it.key) || results.get(it.key).state === "err"));
    if (!todo.length) {
      if (!items.length) diagnose();
      btn.innerHTML = items.length ? "이 페이지는 모두 조회했습니다<br><small>다음 페이지로 넘겨 보세요</small>" : "상품 카드를 찾지 못했습니다<br><small>앱 콘솔에 구조를 기록했습니다</small>";
      setTimeout(label, 2500); return;
    }
    todo.forEach((it) => { queued.add(it.key); paint(it, "wait"); });
    total += todo.length; runTotal = todo.length; runDone = 0; busy++; label();
    const tick = setInterval(label, 15000);
    try {
      for (let i = 0; i < todo.length; i++) {
        const it = todo[i];
        if (stopReq || paused) {
          todo.slice(i).forEach((x) => { queued.delete(x.key); paint(x, "pb", {}); x.card.querySelector(".sg-cp").innerHTML = `<div class="t">조회 안 함</div><div>${stopReq ? "멈춤 — 다시 누르면 이어서" : "정지 상태"}</div>`; });
          break;
        }
        const r = await runOne(it);
        if (r && r.soft) {
          // 10분 60건 한도: 자리가 날 때까지 기다렸다가 같은 상품부터 이어서(멈춤 버튼은 그대로 동작)
          waitUntil = r.until || Date.now() + 60000; label();
          while (Date.now() < waitUntil && !stopReq) await new Promise((res) => setTimeout(res, 1000));
          waitUntil = 0; i--; label();
        }
      }
    } finally {
      clearInterval(tick); busy--; label();
    }
  }

  const btn = document.createElement("button");
  btn.className = "sg-cp-button";
  btn.type = "button";
  btn.addEventListener("click", onClick);
  // 쿠팡 화면이 다시 그려지면서 버튼·스타일을 지울 수 있어 주기적으로 다시 붙인다
  const mount = () => {
    const host = document.body || document.documentElement;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    if (!btn.isConnected) host.appendChild(btn);
  };
  mount();
  setInterval(mount, 1500);

  // ---- 사진 위 🔍 1688 (알리프라이스·1688 확장처럼) ----
  // 상품 사진에 마우스를 올리면 사진 왼쪽 아래에 버튼(왼쪽 위 쿠팡 순위·오른쪽 위 지표 상자를 가리지 않게).
  // 누르면 리스트업에 담고 1688 이미지 검색까지 한 번에.
  const cnBtn = document.createElement("button");
  cnBtn.type = "button";
  cnBtn.className = "sg-cn-hover";
  cnBtn.textContent = "🔍 1688";
  cnBtn.title = "이 상품을 리스트업에 담고 1688에서 같은 상품 찾기";
  const pickBtn = document.createElement("button");
  pickBtn.type = "button"; pickBtn.className = "sg-cn-hover sg-pick"; pickBtn.textContent = "📦 담기"; pickBtn.title = "이 상품을 수집함에 담기";
  const cnStyle = document.createElement("style");
  cnStyle.textContent = `.sg-cn-hover{position:fixed;z-index:2147483647;display:none;border:0;border-radius:7px;padding:5px 9px;background:#f97316;color:#fff;font:800 12px -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer}.sg-cn-hover:hover{background:#ea580c}.sg-pick{background:#16a34a}.sg-pick:hover{background:#15803d}`;
  let hoverImg = null, hideT = null;
  const detailPid = () => pidOf(location.href);
  function productFor(img) {
    const dp = detailPid();
    const a = dp ? null : img.closest('a[href*="/products/"]'); // 상품 상세 페이지에서는 그 페이지 상품으로(연관 상품 링크에 걸리지 않게)
    const pid = a ? pidOf(a.href) : dp;
    if (!pid) return null;
    const card = a ? cardOf(a) : null;
    // 쿠팡 사진 alt가 "Product image" 같은 공통 글자로 바뀌어(2026-10) 상품명으로 쓰면 안 된다 → 카드 제목 / 상품 화면 h1
    const alt = (img.alt || "").trim(), altOk = alt.length >= 4 && !/^(product\s*image|상품\s*(대표\s*)?이미지|image|이미지|thumbnail)$/i.test(alt);
    const pageName = () => (document.querySelector("h1, h2[class*='title'], [class*='prod-buy-header'] h2")?.textContent || document.title.replace(/\s*[-|]\s*쿠팡!?\s*$/, ""));
    const name = (card ? (card.querySelector('[class*="name"],[class*="title"]')?.textContent || (altOk ? alt : "")) : altOk && a ? alt : pageName()).trim().slice(0, 120);
    return { pid, vid: a ? vidOf(a.href) : vidOf(location.href), name, price: card ? priceOf(card) : !a ? pagePrice() : null, img: (img.currentSrc || img.src || "").slice(0, 400) };
  }
  const placeBtn = (img) => {
    if (detailPid()) return; // 상세 페이지는 detailMount 가 오른쪽 아래에 고정 — 여기서 위치를 또 주면 네 방향이 다 고정돼 버튼이 늘어난다
    const r = img.getBoundingClientRect();
    [pickBtn, cnBtn].forEach((b) => { b.style.right = ""; b.style.bottom = ""; b.style.fontSize = ""; b.style.padding = ""; });
    pickBtn.style.left = `${Math.round(r.left + 6)}px`;
    pickBtn.style.top = `${Math.round(r.bottom - 34)}px`;
    pickBtn.style.display = "block";
    cnBtn.style.left = `${Math.round(r.left + 6 + pickBtn.offsetWidth + 6)}px`; // 📦 담기 오른쪽에 🔍1688
    cnBtn.style.top = `${Math.round(r.bottom - 34)}px`;
    cnBtn.style.display = "block";
  };
  document.addEventListener("mouseover", (e) => {
    const img = e.target.closest && e.target.closest("img");
    if (img && img !== hoverImg) {
      const r = img.getBoundingClientRect();
      if (r.width >= 90 && r.height >= 90 && productFor(img)) { hoverImg = img; clearTimeout(hideT); placeBtn(img); return; }
    }
    if (e.target === cnBtn || e.target === pickBtn || img === hoverImg) { clearTimeout(hideT); return; }
    clearTimeout(hideT);
    if (detailPid()) return; // 상품 상세 페이지에서는 버튼을 늘 보여 둔다(사진 위 확대 층 때문에 마우스가 사진에 안 닿음)
    hideT = setTimeout(() => { cnBtn.style.display = "none"; pickBtn.style.display = "none"; hoverImg = null; }, 400);
  }, true);
  addEventListener("scroll", () => { if (hoverImg && cnBtn.style.display === "block") placeBtn(hoverImg); }, true);
  cnBtn.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    const p = hoverImg && productFor(hoverImg);
    if (!p) { cnBtn.textContent = "✕ 상품 못 읽음"; setTimeout(() => (cnBtn.textContent = "🔍 1688"), 2500); ipcRenderer.send("cp:log", `🔍1688 눌렀지만 상품을 못 읽음 · ${location.pathname} · 사진 ${hoverImg ? (hoverImg.currentSrc || hoverImg.src || "").slice(-40) : "없음"}`); return; }
    cnBtn.textContent = "여는 중…";
    ipcRenderer.send("cp:log", `🔍1688 클릭 · ${String(p.name || "").slice(0, 30)} · pid ${p.pid || "?"}`);
    const u = new URL(location.href);
    const r = await ipcRenderer.invoke("cp:to1688", { ...p, query: pageQuery(u) || "" });
    cnBtn.textContent = r?.error ? "✕ " + r.error.slice(0, 18) : "🔍 1688";
    setTimeout(() => (cnBtn.textContent = "🔍 1688"), 2500);
  }, true);
  pickBtn.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    const p = hoverImg && productFor(hoverImg);
    if (!p) { pickBtn.textContent = "✕ 상품 못 읽음"; setTimeout(() => (pickBtn.textContent = "📦 담기"), 2000); return; }
    const r = await ipcRenderer.invoke("cp:pick", { ...p, query: pageQuery(new URL(location.href)) || "" });
    pickBtn.textContent = r?.ok ? `✔ 담김 (${r.count})` : "✕ " + String(r?.error || "").slice(0, 14);
    setTimeout(() => (pickBtn.textContent = "📦 담기"), 2000);
  }, true);
  // 상품 상세 페이지: 가장 큰 사진을 대상으로 잡고 오른쪽 아래에 고정
  const detailMount = () => {
    if (!detailPid()) return;
    if (!hoverImg || !hoverImg.isConnected) {
      const imgs = [...document.querySelectorAll("img")].map((i) => ({ i, r: i.getBoundingClientRect() })).filter((x) => x.r.width >= 150 && x.r.height >= 150).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
      hoverImg = imgs[0]?.i || document.querySelector("img") || null;
    }
    [pickBtn, cnBtn].forEach((b) => { b.style.left = "auto"; b.style.top = "auto"; b.style.width = "auto"; b.style.height = "auto"; b.style.display = "block"; b.style.bottom = "90px"; b.style.fontSize = "13px"; b.style.padding = "8px 12px"; });
    pickBtn.style.right = "20px"; cnBtn.style.right = `${20 + pickBtn.offsetWidth + 8}px`;
  };
  const mountCn = () => { if (!pickBtn.isConnected) (document.body || document.documentElement).appendChild(pickBtn); if (!cnBtn.isConnected) (document.body || document.documentElement).appendChild(cnBtn); detailMount(); if (!cnStyle.isConnected) (document.head || document.documentElement).appendChild(cnStyle); };
  mountCn();
  setInterval(mountCn, 1500);
  // ---- 📝 리뷰 분석 (상품 상세 화면) ----
  // 쿠팡 리뷰를 최신순으로 최대 1,500개(셀라리뷰와 같은 한도) 받아 앱(메인)이 급증 구간·의심 신호를 계산 → 여기서 그린다.
  // 요청은 이 화면과 같은 주소(쿠팡)에서, 동시에 3개까지·사이 0.15~0.35초 쉼. 막히면 바로 멈추고 받은 만큼만 분석.
  const REV_CAP = 1500, REV_MAX = 3000; // 기본 1,500개 · "나머지 더 받기"로 3,000개까지
  const RATE_KEYS = ["rating", "ratingScore", "reviewRating", "score", "star", "starRating"];
  const DATE_KEYS = ["reviewAt", "createdAt", "reviewDate", "regDate", "createdDate", "registeredAt", "writtenAt", "date"];
  const pick = (o, ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return undefined; };
  const isRev = (o) => o && typeof o === "object" && pick(o, RATE_KEYS) != null && pick(o, DATE_KEYS) != null;
  function findList(j) { // 응답 모양을 모르므로 "별점·날짜가 있는 객체 배열"을 찾는다
    const q = [[j, 0]];
    while (q.length) {
      const [o, d] = q.shift();
      if (!o || typeof o !== "object" || d > 6) continue;
      if (Array.isArray(o)) { if (o.length && isRev(o[0])) return o; o.slice(0, 3).forEach((x) => q.push([x, d + 1])); continue; }
      Object.values(o).forEach((v) => q.push([v, d + 1]));
    }
    return null;
  }
  function findNum(j, keys) {
    const q = [[j, 0]];
    while (q.length) {
      const [o, d] = q.shift();
      if (!o || typeof o !== "object" || Array.isArray(o) || d > 4) continue;
      for (const k of keys) if (Number.isFinite(+o[k]) && +o[k] > 0) return +o[k];
      Object.values(o).forEach((v) => q.push([v, d + 1]));
    }
    return null;
  }
  const mapRev = (o) => ({
    id: pick(o, ["reviewId", "id"]), at: pick(o, DATE_KEYS), rating: +pick(o, RATE_KEYS),
    text: String(pick(o, ["content", "reviewContent", "contents", "text", "body", "comment"]) ?? "").slice(0, 600),
    photos: [].concat(pick(o, ["attachments", "images", "reviewImages", "photos", "imageList", "attachedImages"]) || []).length,
    opt: String(pick(o, ["itemName", "optionName", "vendorItemName", "productName", "option"]) ?? "").slice(0, 120),
    exp: Object.keys(o).some((k) => /experience|trial|sponsor|vine|incentive|adventurer/i.test(k) && o[k] === true),
  });
  class Blocked extends Error {}
  async function getText(u, json) {
    const r = await fetch(u, { credentials: "include", headers: { accept: json ? "application/json, text/plain, */*" : "text/html, */*" } });
    const t = await r.text();
    if (r.status === 403 || r.status === 429 || (BLOCK_RE.test(t.slice(0, 4000)) && !/^\s*[{[]/.test(t))) throw new Blocked(`쿠팡이 잠시 막음(${r.status})`);
    if (!r.ok) throw new Error(`응답 ${r.status}`);
    return t;
  }
  const SRC = {
    json: {
      url: (pid, p, q = {}) => `/next-api/review?productId=${pid}&page=${p}&size=10&sortBy=${q.sort || "DATE_DESC"}&ratingSummary=true&ratings=${q.rating || ""}&market=`,
      async page(pid, p, q) {
        let j; try { j = JSON.parse(await getText(this.url(pid, p, q), true)); } catch (e) { if (e instanceof Blocked) throw e; return null; }
        const list = findList(j);
        if (!list) return { items: [], raw: j };
        return { items: list.map(mapRev), total: findNum(j, ["totalCount", "totalElements", "reviewCount", "ratingCount", "total"]), pages: findNum(j, ["totalPage", "totalPages", "lastPage"]), raw: j, rawItem: list[0] };
      },
    },
    html: { // 예전 상품평 화면 조각
      url: (pid, p, q = {}) => `/vp/product/reviews?productId=${pid}&page=${p}&size=10&sortBy=${q.sort || "DATE_DESC"}&ratings=${q.rating || ""}&q=&viRoleCode=3&ratingSummary=true`,
      async page(pid, p, q) {
        const doc = new DOMParser().parseFromString(await getText(this.url(pid, p, q), false), "text/html");
        const arts = [...doc.querySelectorAll("article.sdp-review__article__list, article[class*='review__article']")];
        const tx = (el, s) => (el.querySelector(s)?.textContent || "").trim();
        const items = arts.map((a) => ({
          at: tx(a, "[class*='reg-date']"), rating: +(a.querySelector("[data-rating]")?.getAttribute("data-rating") || 0),
          text: tx(a, "[class*='review__content']").slice(0, 600), photos: a.querySelectorAll("[class*='attachment'] img").length,
          opt: tx(a, "[class*='product-info__name']").slice(0, 120), exp: /체험단/.test(a.textContent || ""),
        }));
        const total = +(tx(doc, "[class*='total-star__info-count']").replace(/[^\d]/g, "")) || null;
        return { items, total, raw: null, rawItem: arts[0] ? arts[0].outerHTML.slice(0, 800) : null };
      },
    },
  };
  const pageTotal = () => { const m = (document.body?.innerText || "").match(/([\d,]{2,})\s*개\s*(?:상품평|리뷰)/); return m ? +m[1].replace(/,/g, "") : null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 쿠팡은 최신순으로 150페이지(1,500개)까지만 준다(2026-10-10 옷걸이 1,989개로 확인). 그 너머 오래된 리뷰를 다른 길로 찾는다:
  // ① 오래된 순 — 되면 빈틈없이 채움(complete) ② 안 되면 1~4점별·베스트 순으로 일부만(partial: 분석 차트엔 안 섞고 "가장 오래된 리뷰"만 씀)
  async function collectOlder(pid, src, have, total, cap, onProg, isStop) {
    const seen = new Set(have.map((r) => String(r.id)));
    const oldestHave = have.reduce((m, r) => (String(r.at) < String(m) ? r.at : m), have[0]?.at);
    const want = Math.min(cap, total || cap) - have.length;
    const out = [], tried = [];
    const take = (items) => { const fresh = items.filter((x) => x.id != null && !seen.has(String(x.id))); fresh.forEach((x) => { seen.add(String(x.id)); out.push(x); }); return fresh.length; };
    const prog = (last) => onProg(have.length + out.length, have.length + want, last);
    // ① 오래된 순
    let asc = 0;
    for (let p = 1; p <= 150 && !isStop() && out.length < want; p++) {
      await sleep(300 + Math.random() * 300);
      const r = await SRC[src].page(pid, p, { sort: "DATE_ASC" });
      if (!r || !r.items.length) break;
      if (p === 1 && !(String(r.items[0].at) < String(oldestHave))) break; // 오래된 순을 무시하고 최신순을 줌
      const n = take(r.items); asc += n; prog(r.items[r.items.length - 1]);
      if (!n) break; // 이미 받은 구간과 만남
    }
    tried.push(`오래된 순 +${asc}`);
    if (asc) return { items: out, complete: true, tried };
    // ② 별점별(1~4점) · 베스트 순 — 일부만
    const rated = (n) => have.filter((r) => Math.round(+r.rating) === n).length;
    for (const st of [1, 2, 3, 4].map((n) => ({ name: `${n}점`, q: { rating: n }, from: Math.max(1, Math.floor(rated(n) / 10)) })).concat([{ name: "베스트 순", q: { sort: "ORDER_SCORE_ASC" }, from: 1 }])) {
      let got = 0, dry = 0;
      for (let p = st.from; p <= 150 && !isStop(); p++) {
        await sleep(300 + Math.random() * 300);
        const r = await SRC[src].page(pid, p, st.q);
        if (!r || !r.items.length) break;
        const n = take(r.items); got += n; prog(r.items[r.items.length - 1]);
        dry = n ? 0 : dry + 1;
        if (dry >= 5) break;
      }
      tried.push(`${st.name} +${got}`);
      if (isStop()) break;
    }
    return { items: out, complete: false, tried };
  }

  // prev가 있으면 "나머지 더 받기": 이미 받은 페이지 다음부터 cap까지, 더 천천히(동시 2개·0.3~0.6초 쉼)
  async function collectReviews(pid, onProg, isStop, prev = null, cap = REV_CAP) {
    const t0 = Date.now();
    let src, first = null, note = "", size, total, pages, sample, start;
    if (prev) {
      ({ src, size, total, sample } = prev); pages = sample?.pages || null;
      start = Math.floor(prev.reviews.length / size) + 1;
    } else {
      src = "json";
      try { first = await SRC.json.page(pid, 1); } catch (e) { if (e instanceof Blocked) throw e; note = e.message; }
      if (!first || !first.items.length) { src = "html"; first = await SRC.html.page(pid, 1); }
      if (!first.items.length) throw new Error(`리뷰를 읽지 못했습니다${note ? " · " + note : ""}`);
      size = first.items.length; total = first.total || pageTotal(); pages = first.pages; start = 2;
      sample = { src, size, total, pages, topKeys: first.raw && typeof first.raw === "object" ? Object.keys(first.raw).slice(0, 20) : null, item: first.rawItem && typeof first.rawItem === "object" ? JSON.stringify(first.rawItem).slice(0, 1500) : first.rawItem };
    }
    const target = Math.min(cap, total || cap);
    let last = Math.ceil(target / size);
    if (pages) last = Math.min(last, pages);
    const got = new Map();
    if (first) got.set(1, first.items);
    const base = prev ? prev.reviews.length : 0;
    let count = base + (first ? first.items.length : 0), next = start, stopAt = Infinity, blocked = "";
    onProg(count, target, first ? first.items[first.items.length - 1] : prev.reviews[prev.reviews.length - 1]);
    const worker = async () => {
      while (!isStop() && !blocked) {
        const p = next++;
        if (p > last || p > stopAt) return;
        await sleep(prev ? 300 + Math.random() * 300 : 150 + Math.random() * 200);
        try {
          const r = await SRC[src].page(pid, p);
          if (!r || !r.items.length) { stopAt = Math.min(stopAt, p - 1); return; }
          got.set(p, r.items); count += r.items.length;
          onProg(count, target, r.items[r.items.length - 1]);
        } catch (e) { if (e instanceof Blocked) blocked = e.message; else { stopAt = Math.min(stopAt, p - 1); note = e.message; } return; }
      }
    };
    await Promise.all(prev ? [worker(), worker()] : [worker(), worker(), worker()]);
    const reviews = prev ? prev.reviews.slice() : [];
    for (let p = prev ? start : 1; got.has(p); p++) reviews.push(...got.get(p)); // 빠진 페이지 뒤는 버림(최신순이 끊기지 않게)
    let added = reviews.length - base, tried = null, partial = 0;
    if (prev && !blocked && !isStop() && total && reviews.length < Math.min(cap, total)) {
      try {
        const o = await collectOlder(pid, src, reviews, total, cap, onProg, isStop);
        tried = o.tried.join(" · ");
        if (o.complete) reviews.push(...o.items);
        else { reviews.push(...o.items.map((x) => ({ ...x, partial: true }))); partial = o.items.length; }
        added += o.items.length;
      } catch (e) { if (e instanceof Blocked) blocked = e.message; else note = e.message; }
    }
    if (prev && !added && !blocked) note = note || "쿠팡이 더 이상 주지 않음";
    return { reviews: reviews.slice(0, cap), total, src, size, ms: (prev?.ms || 0) + Date.now() - t0, blocked, note, sample, added, partial, tried, stopped: isStop() };
  }

  const revStyle = document.createElement("style");
  revStyle.textContent = `
  .sg-rv-btn{position:fixed;right:18px;top:calc(50% + 46px);z-index:2147483647;border:0;border-radius:9px;background:#1e1b4b;color:#fff;font:800 12.5px -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:10px 13px;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer}
  .sg-rv-btn:hover{background:#312e81}
  .sg-rv-hbtn{top:calc(50% + 92px);background:#fff;color:#1e1b4b;border:1px solid #c7d2fe;font-size:12px;padding:7px 12px}.sg-rv-hbtn:hover{background:#eef2ff}
  .sg-tpl-btn{top:calc(50% + 134px);background:#0f766e}.sg-tpl-btn:hover{background:#115e59}
  .sg-rv .tplform{display:flex;gap:8px;align-items:center;margin:12px 0 6px;flex-wrap:wrap}.sg-rv .tplform label{color:#9fb3c8;font-size:12px}.sg-rv .tplform input{flex:1;min-width:220px;background:#111827;border:1px solid #334155;border-radius:8px;color:#e6edf3;padding:8px 10px;font:600 13px -apple-system,"Apple SD Gothic Neo",sans-serif}
  .sg-rv .tplform .go{background:#0f766e;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:800;cursor:pointer}.sg-rv .tplform .go:disabled{opacity:.5;cursor:default}
  .sg-rv .tplnote{color:#9fb3c8;font-size:12px;margin:6px 0 0}.sg-rv .tplnote b{color:#e6edf3}
  .sg-rv-bg{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,12,.62);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:28px 12px}
  .sg-rv{width:min(940px,100%);background:#0b0f14;color:#e6edf3;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);font:13px/1.55 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:20px 22px}
  .sg-rv h3{margin:0 0 2px;font-size:16px}.sg-rv .sub{color:#9fb3c8;font-size:12px}
  .sg-rv .x{float:right;border:0;background:#1f2937;color:#e6edf3;border-radius:7px;padding:5px 10px;cursor:pointer;font-weight:700;margin-left:6px}
  .sg-rv .bar{height:8px;background:#1f2937;border-radius:5px;overflow:hidden;margin:12px 0 6px}.sg-rv .bar i{display:block;height:100%;background:linear-gradient(90deg,#6366f1,#3ddc84);transition:width .25s}
  .sg-rv .tick{font:12px ui-monospace,Menlo,monospace;color:#7dd3fc;height:108px;overflow:hidden;white-space:nowrap}
  .sg-rv .tick div{overflow:hidden;text-overflow:ellipsis;opacity:.9}
  .sg-rv.res{background:#fff;color:#18181b;font-size:14px}
  .sg-rv.res .sub{color:#71717a}.sg-rv.res .x{background:#f4f4f5;color:#18181b}
  .sg-rv .hero{border-radius:12px;padding:16px 18px;margin:14px 0 10px;background:#f0fdf4;border:1px solid #bbf7d0}
  .sg-rv .hero.warn{background:#fef2f2;border-color:#fecaca}
  .sg-rv .hero .k{font-size:13px;font-weight:700;color:#15803d}.sg-rv .hero.warn .k{color:#b91c1c}
  .sg-rv .hero .big{font-size:24px;font-weight:800;margin:2px 0 8px;letter-spacing:-.3px}
  .sg-rv .chips span{display:inline-block;margin:0 6px 4px 0;padding:3px 9px;border-radius:99px;background:#fff;border:1px solid #fecaca;color:#b91c1c;font-size:12.5px;font-weight:700}
  .sg-rv .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
  .sg-rv .kpi{border:1px solid #e4e4e7;border-radius:10px;padding:10px 12px}.sg-rv .kpi small{color:#71717a;font-size:12px}.sg-rv .kpi b{display:block;font:800 22px ui-monospace,Menlo,monospace;margin-top:2px}
  .sg-rv .note{background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:7px 11px;border-radius:8px;margin:0 0 10px;font-size:12.5px}
  .sg-rv .box{border:1px solid #e4e4e7;border-radius:10px;padding:12px 14px;margin-top:10px}
  .sg-rv .box h4{margin:0 0 8px;font-size:14px}.sg-rv .box h4 small{color:#71717a;font-weight:500;margin-left:4px}
  .sg-rv details.box summary{cursor:pointer;font-weight:700;font-size:14px}.sg-rv details.box[open] summary{margin-bottom:8px}
  .sg-rv .sig{margin:3px 0;font-size:13px}.sg-rv .sig.on{color:#b91c1c}.sg-rv .sig.off{color:#a1a1aa}
  .sg-rv table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}.sg-rv td,.sg-rv th{padding:6px 8px;border-bottom:1px solid #f4f4f5;text-align:right;font-variant-numeric:tabular-nums}.sg-rv th{color:#71717a;font-weight:600}.sg-rv td:first-child,.sg-rv th:first-child{text-align:left;color:#71717a}
  .sg-rv th.hot,.sg-rv td.hot{background:#fef2f2}
  .sg-rv .opt{display:flex;gap:8px;align-items:center;margin:4px 0;font-size:13px}.sg-rv .opt span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sg-rv .opt b{display:block;height:8px;background:#16a34a;border-radius:4px}
  .sg-rv .low{border-top:1px solid #f4f4f5;padding:7px 0;font-size:13.5px}.sg-rv .low em{color:#d97706;font-style:normal;margin-right:8px;font-size:12px}
  .sg-rv svg text{fill:#71717a;font-size:10px}
  .sg-rv .hist{margin-top:12px}.sg-rv .hist td{vertical-align:middle;text-align:left;color:#18181b}.sg-rv .hist td:first-child{max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#18181b}.sg-rv .hist a{color:#18181b;text-decoration:none;font-weight:700}.sg-rv .hist a:hover{text-decoration:underline}.sg-rv .hist small{color:#71717a}.sg-rv .hist small.up{color:#16a34a;font-weight:700}.sg-rv .hist td:last-child{white-space:nowrap}.sg-rv .hist .x{float:none}
  .sg-rv .chip{display:inline-block;padding:2px 8px;border-radius:99px;background:#fef2f2;color:#b91c1c;font-size:12px;font-weight:700}.sg-rv .chip.ok{background:#f0fdf4;color:#15803d}
  .sg-rv .chd{display:flex;align-items:center;gap:10px;margin-bottom:6px}.sg-rv .chd h4{margin:0;flex:1}
  .sg-rv .seg{display:inline-flex;background:#f4f4f5;border-radius:8px;padding:2px}.sg-rv .seg button{border:0;background:none;padding:4px 11px;border-radius:6px;font:600 12.5px -apple-system,"Apple SD Gothic Neo",sans-serif;color:#52525b;cursor:pointer}.sg-rv .seg button.on{background:#18181b;color:#fff}
  .sg-rv svg .hit:hover{fill:rgba(24,24,27,.08)}
  .sg-rv .tip{position:fixed;z-index:2147483647;pointer-events:none;background:#18181b;color:#fff;border-radius:7px;padding:5px 9px;font:700 12.5px -apple-system,"Apple SD Gothic Neo",sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);display:none;white-space:nowrap}
  .sg-rv svg text{fill:#9fb3c8;font-size:10px}`;
  const revBtn = document.createElement("button");
  revBtn.type = "button"; revBtn.className = "sg-rv-btn"; revBtn.textContent = "📝 리뷰 분석";
  revBtn.title = "리뷰를 최신순 최대 1,500개 받아 날짜별 흐름·리뷰 작업 의심 구간을 봅니다";
  const onDetail = () => !testPage && /\/vp\/products\/\d+/.test(location.pathname);
  // 상품 화면에서도 조회 없이 기록을 볼 수 있게 — 분석 버튼 아래 작은 "기록" 버튼
  const histBtn = document.createElement("button");
  histBtn.type = "button"; histBtn.className = "sg-rv-btn sg-rv-hbtn"; histBtn.textContent = "📂 리뷰 기록";
  histBtn.title = "지금까지 조회한 리뷰 분석 결과 보기 (쿠팡에 다시 묻지 않음)";

  const pctS = (v) => (v == null ? "-" : `${Math.round(v * 100)}%`);
  const f1 = (v) => (v == null ? "-" : v >= 10 ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(1));
  const mdS = (d) => (!d ? "" : d.slice(0, 4) !== String(new Date().getFullYear()) ? `${d.slice(2, 4)}.${+d.slice(5, 7)}.${+d.slice(8, 10)}` : `${+d.slice(5, 7)}/${+d.slice(8, 10)}`); // 올해가 아니면 연도
  // 차트: 기간 range(365 · 730 · "all"=첫 리뷰부터) × 단위 unit("day" · "week" · "month"). 의심 구간 막대는 빨강.
  function chartSvg(a, range = "all", unit = "day") {
    const W = 880, H = 220, L = 34, B = 22, T = 22;
    const iso = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
    const dn = (d) => Math.round(Date.parse(d + "T00:00:00Z") / 864e5);
    const end = dn(a.today), first = dn(a.firstDate);
    const start = range === "all" ? first - 2 : Math.max(first - 2, end - range + 1);
    const map = new Map(a.daily);
    const keyOf = (n) => { const d = iso(n); if (unit === "month") return d.slice(0, 7); if (unit === "week") { const wd = (new Date(n * 864e5).getUTCDay() + 6) % 7; return iso(n - wd); } return d; };
    const buckets = [];
    for (let n = start; n <= end; n++) {
      const k = keyOf(n);
      let bk = buckets[buckets.length - 1];
      if (!bk || bk.k !== k) buckets.push((bk = { k, from: n, to: n, v: 0 }));
      bk.to = n; bk.v += map.get(iso(n)) || 0;
    }
    const inBurst = (bk) => a.burst && bk.to >= dn(a.burst.from) && bk.from <= dn(a.burst.to);
    const raw = Math.max(4, ...buckets.map((b) => b.v)), mag = 10 ** Math.floor(Math.log10(raw / 4)), stp = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m * 4 >= raw) || raw / 4;
    const max = Math.max(4, stp * 4), bw = (W - L - 6) / buckets.length, y = (v) => T + (H - T - B) * (1 - v / max);
    const xi = (n) => L + ((n - start) / (end - start + 1)) * (W - L - 6);
    const lab = (bk) => unit === "month" ? `${bk.k.slice(0, 4)}년 ${+bk.k.slice(5, 7)}월` : unit === "week" ? `${iso(bk.from).slice(2).replace(/-/g, ".")} 주` : `${iso(bk.from).slice(0, 4)}. ${+iso(bk.from).slice(5, 7)}. ${+iso(bk.from).slice(8, 10)}.`;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
    for (let k = 0; k <= 4; k++) { const v = +((max * k) / 4).toFixed(1); s += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#f4f4f5"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`; }
    if (a.burst && dn(a.burst.to) >= start) { const bx = xi(Math.max(start, dn(a.burst.from))); s += `<rect x="${bx}" y="${T}" width="${Math.max(3, xi(dn(a.burst.to) + 1) - bx)}" height="${H - T - B}" fill="rgba(239,68,68,.10)"/><text x="${bx}" y="${T - 8}" style="fill:#dc2626;font-weight:700">의심 구간</text>`; }
    buckets.forEach((bk, i) => { s += `<rect class="hit" data-d="${lab(bk)}" data-v="${bk.v}" x="${(L + i * bw).toFixed(1)}" y="${T}" width="${Math.max(1, bw).toFixed(1)}" height="${H - T - B}" fill="transparent"/>`; });
    buckets.forEach((bk, i) => { if (bk.v) s += `<rect pointer-events="none" x="${(L + i * bw).toFixed(1)}" y="${y(bk.v).toFixed(1)}" width="${Math.max(1, bw - (bw > 4 ? 1 : 0.3)).toFixed(1)}" height="${(H - B - y(bk.v)).toFixed(1)}" fill="${inBurst(bk) ? "#ef4444" : "#16a34a"}"/>`; });
    if (a.capped && first >= start) { const cx = xi(first); s += `<line x1="${cx}" x2="${cx}" y1="${T}" y2="${H - B}" stroke="#d97706" stroke-dasharray="4 3"/><text x="${cx + 4}" y="${T - 8}" style="fill:#b45309;font-weight:700">여기부터 받음</text>`; }
    // 아래 날짜: 기간이 길면 몇 달 건너 표시, 1월엔 연도
    const months = (end - start) / 30, stepM = months > 30 ? 6 : months > 15 ? 3 : months > 8 ? 2 : 1;
    for (let n = start; n <= end; n++) { const d = iso(n); if (d.endsWith("-01") && (+d.slice(5, 7) - 1) % stepM === 0) s += `<text x="${xi(n)}" y="${H - 6}">${d.slice(5, 7) === "01" || n - start < 32 ? `${d.slice(2, 4)}.${+d.slice(5, 7)}` : `${+d.slice(5, 7)}월`}</text>`; }
    return s + `<line x1="${L}" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="#d4d4d8"/></svg>`;
  }
  function segTable(a) {
    const cols = a.burst ? [["작업 전", a.seg.pre, ""], ["의심 구간", a.seg.burst, "hot"], ["이후", a.seg.post, ""]] : [["전체", a.seg.all, ""]];
    const rows = [["기간", (s, i) => (a.burst ? [`${mdS(a.firstDate)}~`, `${mdS(a.burst.from)}~${mdS(a.burst.to)}`, `~${mdS(a.today)}`][i] : `${mdS(a.firstDate)}~${mdS(a.today)}`) + ` (${s.days}일)`],
      ["리뷰 수", (s) => s.n.toLocaleString("ko-KR")], ["하루 평균", (s) => f1(s.perDay)], ["5점", (s) => pctS(s.r5)], ["1~3점", (s) => pctS(s.low)],
      ["내용 없음", (s) => pctS(s.empty)], ["100자+ 긴 글", (s) => pctS(s.long)], ["평균 글자 수", (s) => f1(s.avgLen)], ["사진", (s) => pctS(s.photo)], ["체험단·제공", (s) => pctS(s.exp)]];
    return `<table><tr><th></th>${cols.map(([h, , c]) => `<th class="${c}">${h}</th>`).join("")}</tr>${rows.map(([h, f]) => `<tr><td>${h}</td>${cols.map(([, s, c], i) => `<td class="${c}">${s && s.n ? esc(f(s, i)) : "-"}</td>`).join("")}</tr>`).join("")}</table>`;
  }
  function renderResult(box, a, meta) {
    box.classList.add("res");
    const sig = a.signals.filter((s) => s.key !== "burst");
    const on = sig.filter((s) => s.on);
    const num = (v) => Number(v).toLocaleString("ko-KR");
    const hero = a.burst
      ? `<div class="hero warn"><div class="k">리뷰 작업 의심 구간 · 신호 ${on.length}/${sig.length} (참고)</div>
          <div class="big">${mdS(a.burst.from)}~${mdS(a.burst.to)} · 리뷰 ${num(a.burst.n)}개 (${pctS(a.burst.n / a.got)})</div>
          <div class="chips">${on.map((s) => `<span>${esc(s.chip)}</span>`).join("") || `<span style="border-color:#e4e4e7;color:#71717a">다른 신호 없음</span>`}</div></div>`
      : `<div class="hero"><div class="k">급증 구간 없음</div><div class="big">${a.capped ? "꾸준히 팔리는 흐름" : "리뷰가 고르게 쌓임"}</div></div>`;
    const more = !meta.again && a.total && a.total > a.got + (a.older?.n || 0) && a.got < REV_MAX ? Math.min(a.total, REV_MAX) - a.got - (a.older?.n || 0) : 0;
    const here = meta.pid === detailPid();
    box.innerHTML = `<button class="x" data-close>닫기</button><button class="x" data-hist>조회 기록</button><button class="x" data-xlsx="${esc(meta.pid)}">엑셀 저장</button>${here ? `<button class="x" data-again>다시 받기</button>` : ""}${more && here ? `<button class="x" data-more style="background:#16a34a;color:#fff">나머지 ${num(more)}개 더 받기</button>` : ""}
      <h3>📝 리뷰 분석</h3><div class="sub">${esc(meta.name)}${meta.saved ? ` · 저장된 결과 (${new Date(meta.saved).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 조회)` : ""}</div>
      ${hero}
      <div class="kpis">
        <div class="kpi"><small>받은 리뷰</small><b>${num(a.got)}</b></div>
        <div class="kpi"><small>최근 30일 하루${a.burst ? " (의심 구간 제외)" : ""}</small><b>${f1(a.recent.perDay)}개</b></div>
        ${a.capped ? `<div class="kpi"><small>1~3점 비율</small><b>${pctS((a.seg.all || a.seg.post).low)}</b></div>` : `<div class="kpi"><small>첫 1~3점 리뷰</small><b>${a.firstLow ? mdS(a.firstLow) : "없음"}</b></div>`}
      </div>
      ${a.older ? `<div class="note">가장 오래된 리뷰 <b>${esc(a.older.oldest)}</b> · 판매 시작 무렵. 1,500개 너머는 쿠팡이 최신순으로 주지 않아 1~4점·베스트 리뷰 ${num(a.older.n)}개만 더 찾았습니다(차트에는 안 넣음).</div>` : ""}
      ${a.capped ? `<div class="note">전체 ${a.total ? num(a.total) + "개 중 " : ""}최신 ${num(a.got)}개만 봤습니다. ${mdS(a.firstDate)} 이전은 차트에 없습니다.</div>` : ""}
      ${meta.blocked ? `<div class="note">${/더 이상/.test(meta.blocked) ? "쿠팡이 더 오래된 리뷰는 주지 않습니다." : "쿠팡이 중간에 막아서 받은 만큼만 분석했습니다."}</div>` : ""}
      <div class="box"><div class="chd"><h4>날짜별 리뷰 수</h4><div class="seg" data-g="range"><button data-v="365">1년</button><button data-v="730">2년</button><button data-v="all" class="on">전체</button></div><div class="seg" data-g="unit"><button data-v="day" class="on">일</button><button data-v="week">주</button><button data-v="month">월</button></div></div><div class="chart">${chartSvg(a)}</div></div>
      ${a.lowSamples.length ? `<div class="box"><h4>실제 고객 불만<small>최근 1~3점 · 차별화 포인트 후보</small></h4>${a.lowSamples.slice(0, 4).map((r) => `<div class="low"><em>★${r.rating} · ${mdS(r.date)}</em>${esc(r.text)}</div>`).join("")}</div>` : ""}
      <details class="box"><summary>자세히 보기 · 구간 비교${a.options.length > 1 ? " · 옵션 비율" : ""}</summary>
        ${a.burst ? sig.map((s) => `<div class="sig ${s.on ? "on" : "off"}">${s.on ? "●" : "○"} ${esc(s.text)}</div>`).join("") : ""}
        ${segTable(a)}
        ${a.options.length > 1 ? `<h4 style="margin:14px 0 6px">옵션별 리뷰 비율<small>판매 비율 참고</small></h4>${a.options.map((o) => `<div class="opt"><span title="${esc(o.name)}">${esc(o.name)}</span><div style="width:160px"><b style="width:${Math.max(2, o.share * 100)}%"></b></div><em style="width:44px;text-align:right;font-style:normal">${pctS(o.share)}</em></div>`).join("")}` : ""}
        <div class="sub" style="margin-top:8px">${esc(a.firstDate)} ~ ${esc(a.lastDate)} · ${Math.round(meta.ms / 1000)}초</div>
      </details><div class="tip"></div>`;
    const tip = box.querySelector(".tip");
    const chart = box.querySelector(".chart"), opt = { range: "all", unit: "day" };
    chart.addEventListener("mousemove", (e) => {
      const r = e.target.closest && e.target.closest(".hit");
      if (!r) { tip.style.display = "none"; return; }
      tip.textContent = `${r.dataset.d} · 리뷰 ${r.dataset.v}개`; tip.style.display = "block"; tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 34}px`;
    });
    chart.addEventListener("mouseleave", () => { tip.style.display = "none"; });
    box.querySelectorAll(".chd .seg button").forEach((bt) => bt.addEventListener("click", () => {
      const g = bt.parentElement.dataset.g;
      opt[g] = g === "range" && bt.dataset.v !== "all" ? +bt.dataset.v : bt.dataset.v;
      bt.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === bt));
      chart.innerHTML = chartSvg(a, opt.range, opt.unit);
    }));
  }
  let revOpen = null;
  // 결과·기록 창 공통 틀: 닫기 · 조회 기록 · 엑셀 저장 · 기록에서 결과 열기
  function overlay(onClose) {
    const bg = document.createElement("div"); bg.className = "sg-rv-bg";
    const box = document.createElement("div"); box.className = "sg-rv"; bg.appendChild(box);
    revOpen = bg;
    const close = () => { onClose?.(); bg.remove(); revOpen = null; };
    bg.addEventListener("click", async (e) => {
      const t = e.target;
      if (t === bg || t.closest("[data-close]")) return close();
      if (t.closest("[data-hist]")) { onClose?.(); return showHistory(box); }
      const xb = t.closest("[data-xlsx]");
      if (xb) {
        const old = xb.textContent; xb.textContent = "저장 중…"; xb.disabled = true;
        const r = await ipcRenderer.invoke("cp:reviews:xlsx", xb.dataset.xlsx);
        xb.textContent = r?.path ? "✓ 저장됨" : r?.cancelled ? old : `✕ ${r?.error || "실패"}`; xb.disabled = false;
        setTimeout(() => (xb.textContent = old), 2500);
        return;
      }
      const ob = t.closest("[data-open]");
      if (ob) {
        const a = await ipcRenderer.invoke("cp:reviews:get", ob.dataset.open);
        if (!a?.ok) { ob.textContent = `✕ ${a?.error || "못 엶"}`; return; }
        box.className = "sg-rv";
        renderResult(box, a, { pid: ob.dataset.open, name: a.saved.name, ms: a.saved.ms || 0, saved: a.saved.ts, again: true });
      }
    });
    document.documentElement.appendChild(bg);
    return { bg, box, close };
  }
  async function showHistory(box) {
    box.className = "sg-rv res";
    box.innerHTML = `<button class="x" data-close>닫기</button><h3>📝 리뷰 조회 기록</h3><div class="sub">불러오는 중…</div>`;
    const list = await ipcRenderer.invoke("cp:reviews:list");
    const num = (v) => (v == null ? "-" : Number(v).toLocaleString("ko-KR"));
    const when = (ts) => new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    box.innerHTML = `<button class="x" data-close>닫기</button><h3>📝 리뷰 조회 기록</h3><div class="sub">${list.length ? `상품 ${list.length}개 · 결과 보기는 쿠팡에 다시 묻지 않습니다` : "아직 조회한 상품이 없습니다"}</div>
      ${list.length ? `<table class="hist"><tr><th>상품</th><th>조회</th><th>리뷰</th><th>의심 구간</th><th></th></tr>${list.map((x) => `<tr>
        <td title="${esc(x.name)}"><a href="https://www.coupang.com/vp/products/${esc(x.pid)}">${esc(x.name || x.pid)}</a></td>
        <td>${when(x.ts)}${x.runs > 1 ? `<br><small>${x.runs}번째</small>` : ""}</td>
        <td>${num(x.total ?? x.got)}${x.prevTotal != null && x.total > x.prevTotal ? `<br><small class="up">+${num(x.total - x.prevTotal)}</small>` : ""}</td>
        <td>${x.burst ? `<span class="chip">${mdS(x.burst.from)}~${mdS(x.burst.to)} · 신호 ${x.suspect}</span>` : `<span class="chip ok">없음</span>`}</td>
        <td><button class="x" data-open="${esc(x.pid)}">결과 보기</button><button class="x" data-xlsx="${esc(x.pid)}">엑셀</button></td></tr>`).join("")}</table>` : ""}`;
  }
  async function openHistory() { if (revOpen) return; const { box } = overlay(); showHistory(box); }

  let lastRun = null; // { pid, r } — "나머지 더 받기"가 이어서 받을 기준
  async function openReviews(prev = null) {
    const pid = detailPid();
    if (prev && prev.pid !== pid) prev = null;
    if (!pid || revOpen) return;
    const name = (document.querySelector("h1, h2[class*='title'], [class*='prod-buy-header'] h2")?.textContent || document.title).trim().slice(0, 80);
    let stop = false;
    const { bg, box, close } = overlay(() => { stop = true; });
    bg.addEventListener("click", (e) => { if (e.target.closest("[data-again]")) { close(); openReviews(); } else if (e.target.closest("[data-more]")) { const lr = lastRun; close(); openReviews(lr); } });
    box.innerHTML = `<button class="x" data-close>멈추고 닫기</button><h3>📝 리뷰 읽는 중 · ${esc(name)}</h3><div class="sub" data-s>${prev ? "이어서 받는 중…" : "첫 페이지 받는 중…"}</div><div class="bar"><i style="width:2%"></i></div><div class="tick"></div>`;
    document.documentElement.appendChild(bg);
    ipcRenderer.send("cp:log", `📝 리뷰 분석 시작 · ${name.slice(0, 30)} · pid ${pid}`);
    const tick = box.querySelector(".tick"), sEl = box.querySelector("[data-s]"), bar = box.querySelector(".bar i");
    try {
      const r = await collectReviews(pid, (n, target, last) => {
        if (stop) return;
        sEl.textContent = `리뷰 ${n.toLocaleString("ko-KR")} / ${target.toLocaleString("ko-KR")}개 · ${String(last?.at ?? "").length > 9 ? new Date(+last.at || last.at).toLocaleDateString("ko-KR") : String(last?.at || "")}까지`;
        bar.style.width = `${Math.min(100, (n / target) * 100)}%`;
        const line = document.createElement("div");
        line.textContent = `${"★".repeat(Math.max(0, Math.min(5, +last?.rating || 0)))} ${String(last?.text || "(내용 없음)").replace(/\s+/g, " ").slice(0, 90)}`;
        tick.prepend(line); while (tick.children.length > 6) tick.lastChild.remove();
      }, () => stop, prev?.r || null, prev ? REV_MAX : REV_CAP);
      if (stop) return;
      lastRun = { pid, r };
      if (r.tried) ipcRenderer.send("cp:log", `📝 1,500개 너머 찾기 · ${r.tried}`);
      ipcRenderer.send("cp:log", `📝 리뷰 수집 ${r.reviews.length}개 · ${r.src} · ${Math.round(r.ms / 1000)}초${r.blocked ? " · " + r.blocked : ""}${r.note ? " · " + r.note : ""} · 응답 키 ${(r.sample.topKeys || []).join(",")}`);
      sEl.textContent = `${r.reviews.length.toLocaleString("ko-KR")}개 받음 — 분석 중…`;
      const a = await ipcRenderer.invoke("cp:reviews", { pid, name, total: r.total, reviews: r.reviews, src: r.src, ms: r.ms, sample: r.sample });
      if (stop) return;
      if (!a?.ok) { sEl.textContent = `✕ ${a?.error || "분석 실패"}`; return; }
      renderResult(box, a, { pid, name, ms: r.ms, again: !!prev, blocked: r.blocked || (prev && !r.added && r.note ? r.note : "") });
    } catch (e) {
      if (stop) return;
      sEl.textContent = `✕ ${e.message || e}`;
      ipcRenderer.send("cp:log", `📝 리뷰 분석 실패 · ${e.message || e}`);
    }
  }
  revBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (onDetail()) openReviews(); else openHistory(); }, true);

  // ---- 🧲 템플릿으로 저장 (상품 상세 화면) ----
  // 이 상세페이지의 구조(섹션 순서·색·정렬·키커·설득 흐름)만 뽑아 📄 상세페이지 "내 템플릿" 보관함에 넣는다. 문장·사진은 복사하지 않는다(앱의 guardSimilarity).
  // 여기서는 상세 이미지 주소만 모아 보낸다(내려받기·분석은 앱 메인 detail:captureReference — 같은 쿠팡 세션으로 받음). 진행은 detail:captureProgress 로 돌아온다.
  const tplBtn = document.createElement("button");
  tplBtn.type = "button"; tplBtn.className = "sg-rv-btn sg-tpl-btn"; tplBtn.textContent = "🧲 템플릿으로 저장";
  tplBtn.title = "이 상세페이지의 구조(섹션 순서·색·정렬·설득 흐름)를 내 템플릿으로 보관 — 📄 상세페이지 화면에서 골라 씁니다. 문장·사진은 가져오지 않습니다";
  const DETAIL_SEL = ".product-detail-content-inside, #productDetail, .prod-detail, [class*='product-detail-content'], [class*='vendor-item-detail'], [class*='detail-content'], #btfTab ~ *";
  const SKIP_SEL = ".prod-image, [class*='prod-image'], [class*='review'], [class*='recommend'], [class*='banner'], header, nav, footer, [class*='adr'], [class*='Ad-']";
  const imgSrc = (im) => (im.currentSrc || im.src || im.dataset.src || im.dataset.imgSrc || im.dataset.lazy || im.getAttribute("data-original") || "").trim();
  function collectDetailImages() {
    const seen = new Set(), out = [];
    const push = (im) => { const u = imgSrc(im).replace(/^\/\//, "https://"); if (!/^https:\/\/[\w.-]*coupangcdn\.com\//i.test(u) || seen.has(u)) return; const w = im.naturalWidth || im.width || 0, h = im.naturalHeight || im.height || 0; if ((w && w < 300) || (h && h < 100)) return; seen.add(u); out.push(u); };
    const boxes = [...document.querySelectorAll(DETAIL_SEL)].filter((b) => !b.closest(SKIP_SEL));
    for (const b of boxes) for (const im of b.querySelectorAll("img")) push(im);
    if (out.length < 2) { // 상세 영역을 못 찾으면: 화면 아래쪽(첫 화면 아래)의 큰 그림만
      for (const im of document.images) { if (im.closest(SKIP_SEL)) continue; const r = im.getBoundingClientRect(); if (r.top + window.scrollY < 900) continue; if ((im.naturalWidth || im.width) < 400) continue; push(im); }
    }
    return out;
  }
  const pageCategory = () => [...document.querySelectorAll("#breadcrumb a, .breadcrumb a, [class*='breadcrumb'] a, [class*='Breadcrumb'] a")].map((a) => a.textContent.trim()).filter((t) => t && !/^홈$|coupang/i.test(t)).slice(-3).join(">");
  const pageName = () => (document.querySelector("h1, h2[class*='title'], [class*='prod-buy-header'] h2")?.textContent || document.title).replace(/\s*[-|]\s*쿠팡!?\s*$/, "").trim().slice(0, 80);
  const tplDefaultName = (cat, name) => { const c = String(cat || "").split(/\s*[>›]\s*/).filter(Boolean).pop() || ""; const n = String(name || "").replace(/\s+/g, " ").slice(0, 10).trim(); return [c, n].filter(Boolean).join(" ") || "내 템플릿"; };
  let tplProg = null;
  ipcRenderer.on("detail:captureProgress", (_e, p) => { try { tplProg?.(p || {}); } catch {} });
  async function openTemplateCapture() {
    const pid = detailPid(); if (!pid || revOpen) return;
    let stop = false;
    const name = pageName(), cat = pageCategory();
    const { box } = overlay(() => { stop = true; tplProg = null; });
    const draw = () => {
      const imgs = collectDetailImages();
      box.innerHTML = `<button class="x" data-close>닫기</button><h3>🧲 템플릿으로 저장</h3><div class="sub">${esc(name)}${cat ? ` · ${esc(cat)}` : ""}</div>
        <p class="tplnote">이 상세페이지의 <b>구조</b>(섹션 순서 · 색 · 정렬 · 키커 · 설득 흐름)만 뽑아 📄 상세페이지의 <b>내 템플릿</b>에 넣습니다. 문장·사진은 가져오지 않아요(내 상품 글로 다시 씁니다).</p>
        <div class="tick">상세 이미지 <b>${imgs.length}</b>장 찾음${imgs.length < 2 ? " — 화면을 아래로 내려 상세 이미지가 뜨게 한 뒤 「다시 찾기」" : ""}</div>
        <div class="tplform"><label>이름</label><input class="sg-tpl-name" value="${esc(tplDefaultName(cat, name))}" maxlength="40" spellcheck="false"><button type="button" class="x" data-rescan>다시 찾기</button><button type="button" class="go" data-go ${imgs.length < 2 ? "disabled" : ""}>🧲 저장 시작</button></div>
        <p class="tplnote">분석은 1~5분 · 약 $0.15~0.4(haiku). 같은 상품은 다시 분석하지 않습니다.</p>`;
      box.dataset.n = String(imgs.length); box.__imgs = imgs;
    };
    draw();
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-rescan]")) { e.preventDefault(); draw(); return; }
      const go = e.target.closest("[data-go]"); if (!go) return;
      e.preventDefault(); go.disabled = true;
      const tplName = box.querySelector(".sg-tpl-name")?.value.trim() || tplDefaultName(cat, name);
      const imgs = box.__imgs || [];
      box.innerHTML = `<button class="x" data-close>닫고 계속 진행</button><h3>🧲 템플릿 만드는 중 · ${esc(tplName)}</h3><div class="sub" data-s>상세 이미지 ${imgs.length}장 받는 중…</div><div class="bar"><i style="width:2%"></i></div><div class="tick"></div>`;
      const sEl = box.querySelector("[data-s]"), bar = box.querySelector(".bar i"), tick = box.querySelector(".tick");
      const line = (t) => { const d = document.createElement("div"); d.textContent = t; tick.prepend(d); while (tick.children.length > 6) tick.lastChild.remove(); };
      tplProg = (p) => { if (stop) return; const base = p.step === "download" ? 0 : 30, span = p.step === "download" ? 30 : 65; bar.style.width = `${Math.min(97, base + span * (Number(p.frac) || 0))}%`; if (p.msg) { sEl.textContent = p.msg; line(p.msg); } };
      ipcRenderer.send("cp:log", `🧲 템플릿 저장 시작 · ${name.slice(0, 30)} · 상세 ${imgs.length}장`);
      let r; try { r = await ipcRenderer.invoke("detail:captureReference", { url: location.href.split("#")[0], name, category: cat, tplName, images: imgs }); } catch (err) { r = { error: err?.message || String(err) }; }
      tplProg = null; if (stop) return;
      if (r?.error) { sEl.textContent = `✕ ${r.error}`; bar.style.width = "0%"; return; }
      bar.style.width = "100%";
      const t = r.template || {};
      sEl.innerHTML = r.existing ? `이미 보관함에 있어요 · <b>${esc(t.name)}</b> (다시 분석하지 않음)` : `✔ 보관함에 저장 · <b>${esc(t.name)}</b> · 섹션 ${(t.sections || []).length}개 · ${Math.round((r.ms || 0) / 1000)}초${r.usd != null ? ` · $${Number(r.usd).toFixed(2)}` : ""}`;
      line("📄 상세페이지 화면 → 확인 화면 「디자인 스타일」에서 이 템플릿을 고르면 그 구조로 만듭니다.");
    });
  }
  tplBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openTemplateCapture(); }, true);
  const mountRev = () => {
    if (!revStyle.isConnected) (document.head || document.documentElement).appendChild(revStyle);
    const want = onDetail() ? "📝 리뷰 분석" : "📝 리뷰 기록";
    if (testPage) { if (revBtn.isConnected) revBtn.remove(); return; }
    if (revBtn.textContent !== want) revBtn.textContent = want;
    if (!revBtn.isConnected) (document.body || document.documentElement).appendChild(revBtn);
    if (onDetail()) { if (!histBtn.isConnected) (document.body || document.documentElement).appendChild(histBtn); if (!tplBtn.isConnected) (document.body || document.documentElement).appendChild(tplBtn); }
    else { if (histBtn.isConnected) histBtn.remove(); if (tplBtn.isConnected) tplBtn.remove(); }
  };
  histBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openHistory(); }, true);
  mountRev();
  setInterval(mountRev, 1500);
  // 페이지를 열면 화면 순서만 기록(네트워크 요청 없음) — 롤링 노출 자리 분석용. 지표 조회는 버튼을 누를 때만.
  setTimeout(() => { try { const a = scan(false); if (a.length) reportPage(a); } catch {} }, 3000);
  label();
  ipcRenderer.send("cp:log", `쿠팡 지표 버튼 준비 · ${location.pathname}`);
}

const safeStart = () => { try { start(); } catch (e) { ipcRenderer.send("cp:log", `쿠팡 지표 스크립트 오류: ${e && e.message}`); } };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safeStart);
else safeStart();
