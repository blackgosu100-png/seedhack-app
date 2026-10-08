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
    ipcRenderer.send("cp:page", { query, page, items: items.map(({ card, key, revSrc, ...rest }) => rest) });
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
  const cnStyle = document.createElement("style");
  cnStyle.textContent = `.sg-cn-hover{position:fixed;z-index:2147483647;display:none;border:0;border-radius:7px;padding:5px 9px;background:#f97316;color:#fff;font:800 12px -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer}.sg-cn-hover:hover{background:#ea580c}`;
  let hoverImg = null, hideT = null;
  const detailPid = () => pidOf(location.href);
  function productFor(img) {
    const a = img.closest('a[href*="/products/"]');
    const pid = a ? pidOf(a.href) : detailPid();
    if (!pid) return null;
    const card = a ? cardOf(a) : null;
    const name = (img.alt && img.alt.length >= 4 ? img.alt : card ? (card.querySelector('[class*="name"],[class*="title"]')?.textContent || "") : (document.querySelector("h1, h2[class*='title'], [class*='prod-buy-header'] h2")?.textContent || document.title)).trim().slice(0, 120);
    return { pid, vid: a ? vidOf(a.href) : vidOf(location.href), name, price: card ? priceOf(card) : null, img: (img.currentSrc || img.src || "").slice(0, 400) };
  }
  const placeBtn = (img) => {
    const r = img.getBoundingClientRect();
    cnBtn.style.left = `${Math.round(r.left + 6)}px`;
    cnBtn.style.top = `${Math.round(r.bottom - 34)}px`;
    cnBtn.style.display = "block";
  };
  document.addEventListener("mouseover", (e) => {
    const img = e.target.closest && e.target.closest("img");
    if (img && img !== hoverImg) {
      const r = img.getBoundingClientRect();
      if (r.width >= 90 && r.height >= 90 && productFor(img)) { hoverImg = img; clearTimeout(hideT); placeBtn(img); return; }
    }
    if (e.target === cnBtn || img === hoverImg) { clearTimeout(hideT); return; }
    clearTimeout(hideT);
    hideT = setTimeout(() => { cnBtn.style.display = "none"; hoverImg = null; }, 400);
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
  const mountCn = () => { if (!cnBtn.isConnected) (document.body || document.documentElement).appendChild(cnBtn); if (!cnStyle.isConnected) (document.head || document.documentElement).appendChild(cnStyle); };
  mountCn();
  setInterval(mountCn, 1500);
  // 페이지를 열면 화면 순서만 기록(네트워크 요청 없음) — 롤링 노출 자리 분석용. 지표 조회는 버튼을 누를 때만.
  setTimeout(() => { try { const a = scan(false); if (a.length) reportPage(a); } catch {} }, 3000);
  label();
  ipcRenderer.send("cp:log", `쿠팡 지표 버튼 준비 · ${location.pathname}`);
}

const safeStart = () => { try { start(); } catch (e) { ipcRenderer.send("cp:log", `쿠팡 지표 스크립트 오류: ${e && e.message}`); } };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safeStart);
else safeStart();
