// 📦 수집함 — 쿠팡 화면·키워드 검색에서 본 상품을 필터로 다시 보고, 골라서 리스트업으로 보낸다.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = (v) => (v == null || !Number.isFinite(+v) ? "" : Math.round(v).toLocaleString("ko-KR"));
  const man = (v) => (v == null ? "" : v >= 1e8 ? (v / 1e8).toFixed(1) + "억" : v >= 1e4 ? Math.round(v / 1e4).toLocaleString("ko-KR") + "만" : won(v));
  const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
  const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
  const AD = { go: "GO · 광고해도 남음", warn: "HOLD · 광고 시 빠듯", stop: "DROP · 광고 시 적자" };
  const SHIPC = { 로켓배송: "rk", 판매자로켓: "mr", 일반배송: "nm", 해외배송: "gl" };
  let MARGIN = 0.3, ADS = true; // 패널의 "광고 할 거예요/안 해요" 설정을 따른다. 클릭비용·광고 전환은 패널의 AdModel

  let items = [], view = [], sel = new Set(), sort = { k: "when", dir: -1 }, loaded = false; // 기본: 최근 담은 순
  let pageLog = [], lastFq = null;

  // 광고 판정은 패널과 같은 식: 최대 ROAS(판매가×전환율÷예상 클릭비용) vs 본전 ROAS(1÷목표 마진)
  // 순위: 검색어 필터가 있으면 그 검색어에서의 위치, 없으면 쿠팡 화면에서 본 가장 최근 위치
  function posOf(o, q) {
    if (!o.pos) return null;
    if (q) return o.pos[q] || null;
    return Object.values(o.pos).filter((p) => p.rank != null).sort((a, b) => b.ts - a.ts)[0] || null;
  }
  function derive(o) {
    const price = o.price ?? o.ex?.price; // 쿠팡 화면 가격(쿠폰·할인 반영) 우선, 없으면 Wing 판매가
    const sales = o.ex?.sales ?? null, views = o.ex?.views ?? null;
    const cvr = sales != null && views ? sales / views : null;
    // 전환당 광고비(1개 팔 때 광고비) vs 1개 마진(판매가 × 목표 마진 — 원가를 모르는 단계라 가정)
    const AM = window.AdModel;
    const cpa = AM.cpa(cvr), unitM = price ? price * MARGIN : null;
    const maxRoas = cvr != null && price ? (price * cvr * AM.conv) / AM.cpc : null;
    return { ...o, p: price, sales, views, cvr, rev: sales != null && price ? sales * price : null, maxRoas, cpa, unitM,
      when: o.picked || o.seen || o.first || null, // 담은(본) 시각 — 직접 담은 상품은 picked 우선
      ad: ADS ? AM.judge(cpa, unitM) : null,
      rank: null, organic: null, adSlot: false,
      // 배송: Wing 조회값(판매자로켓/로켓배송) 우선, 없으면 화면 판단
      shipT: o.ex?.ship || o.ship || null, shipSrc: o.ex?.ship ? "wing" : "page" };
  }

  const COLS = [
    ["sel", "", 34], ["img", "", 52], ["name", "상품명", 260], ["query", "검색어", 110], ["when", "담은 날", 96], ["rank", "노출 순위", 66], ["organic", "실제 순위", 66], ["ri", "순위 대비 판매", 96], ["p", "판매가", 82],
    ["reviews", "리뷰", 66], ["sales", "28일 판매", 82], ["rev", "판매액", 82], ["views", "28일 조회", 82], ["cvr", "전환율", 66],
    ["ad", "광고 판정", 84], ["shipT", "배송", 84], ["seen", "지표 받은 날", 86],
  ];
  const SORTABLE = new Set(["ri", "name", "query", "when", "rank", "organic", "p", "reviews", "sales", "rev", "views", "cvr", "ad", "seen"]);

  function head() {
    $("coHead").innerHTML = `<tr>${COLS.map(([k, h, w]) => {
      if (k === "sel") return `<th class="no" style="width:${w}px"><input type="checkbox" id="coAll" title="보이는 상품 모두 선택"></th>`;
      const arrow = sort.k === k ? (sort.dir < 0 ? " ▼" : " ▲") : "";
      return `<th style="min-width:${w}px" class="${SORTABLE.has(k) ? "sortable" : ""}" data-k="${k}">${h}${arrow}</th>`;
    }).join("")}</tr>`;
  }

  // 🔥 순위 대비 판매(상품성 지수): 상단 노출은 원래 많이 팔리므로, 같은 검색어 안에서
  // "그 순위라면 이 정도 팔린다"는 기대값(로그-로그 추세선)을 구해 실제 판매와 비교한다.
  // 1.5배 이상 = 순위는 낮은데 잘 팔리는 숨은 강자. 같은 검색어에 순위·판매가 있는 상품이 5개 이상일 때만 계산.
  // 로그-로그 추세선: 순위(r)가 내려갈수록 값(v)이 얼마나 줄어드는지 → 기대값 함수
  function fit(pts) {
    const xs = pts.map(([r]) => Math.log(r)), ys = pts.map(([, v]) => Math.log(v));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const b = sxx ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx : 0;
    const a = my - b * mx;
    return (r) => Math.exp(a + b * Math.log(r));
  }
  // 👀 끼워넣기 노출(추정): 순위에 비해 조회수가 기대치의 30% 미만인 상품.
  // 쿠팡이 신규·시험 상품을 중간중간 끼워 노출하는 자리로 보인다. 시장·관여도에 따라 자리가 달라 고정 순위(10·15·20·25등) 대신 이렇게 판정.
  // 실데이터(욕실수납)에서 이런 상품은 상품번호가 오래된 경우도 많아 "최근 등록"은 조건이 아니라 참고 표시로만 쓴다.
  function rankIndex(list) {
    const groups = {};
    list.forEach((o) => {
      o.ri = null; o.vi = null; o.rookie = false;
      const r = o.organic || o.rank;
      if (o.rankQ && r > 0 && !o.pb) (groups[o.rankQ] ||= []).push([o, r]);
    });
    Object.values(groups).forEach((g) => {
      const pids = g.map(([o]) => Number(o.pid)).sort((a, b) => a - b);
      const newness = (o) => pids.findIndex((p) => p >= Number(o.pid)) / Math.max(1, pids.length - 1);
      const withV = g.filter(([o]) => o.views > 0);
      if (withV.length >= 5) {
        const ev = fit(withV.map(([o, r]) => [r, o.views]));
        withV.forEach(([o, r]) => { o.vi = o.views / ev(r); o.rookie = o.vi < 0.3; o.recent = newness(o) >= 0.7; });
      }
      // 순위 대비 판매: 신규 노출 상품은 기준선에서 빼고 그린다(기준선을 흐리지 않게)
      const base = g.filter(([o]) => o.sales > 0 && !o.rookie);
      if (base.length < 5) return;
      const es = fit(base.map(([o, r]) => [r, o.sales]));
      g.forEach(([o, r]) => { if (o.sales > 0) { o.ri = o.sales / es(r); o.riN = base.length; } });
    });
  }
  // 검색어·카테고리를 고르면 "그 화면에 보인 순서 그대로" 한 칸씩(광고 칸 포함, 같은 상품 두 번 노출도 각각) 만든다.
  // 기록된 화면(pageLog)이 없으면(예전 데이터) 상품별로 저장된 순위로 대신한다.
  function slotRows(fq) {
    const snaps = {};
    pageLog.filter((e) => e.q === fq).forEach((e) => { if (!snaps[e.page] || snaps[e.page].ts < e.ts) snaps[e.page] = e; });
    const pages = Object.values(snaps).sort((a, b) => a.page - b.page);
    if (!pages.length) return null;
    const byPid = Object.fromEntries(items.map((o) => [o.pid, o]));
    const rows = [];
    let organic = 0;
    pages.forEach((snap) => {
      snap.pids.forEach((pid, i) => {
        const rank = rows.length + 1;
        const isAd = !!(snap.adf && snap.adf[i]);
        const base = byPid[pid] || { pid, name: "", queries: [fq] };
        rows.push({ ...base, rank, organic: isAd ? null : ++organic, adSlot: isAd, rankQ: fq, slot: true, snapTs: snap.ts });
      });
    });
    return rows;
  }
  function filtered() {
    const fq = $("fQuery").value;
    if (fq !== lastFq) { sort = fq ? { k: "rank", dir: 1 } : { k: "when", dir: -1 }; lastFq = fq; } // 검색어를 고르면 순위 순서, 전체면 최근 담은 순이 기본
    const slots = fq ? slotRows(fq) : null;
    let list = slots;
    if (!slots) {
      items.forEach((o) => { const p = posOf(o, fq); o.rank = p?.rank ?? null; o.organic = p?.organic ?? null; o.adSlot = !!p?.ad; o.rankQ = p ? Object.keys(o.pos).find((k) => o.pos[k] === p) : ""; });
      list = items;
    }
    rankIndex(list);
    $("coMode").textContent = slots ? `화면 순서 그대로 ${slots.length}칸 (${new Date(Math.max(...slots.map((r) => r.snapTs))).toLocaleString("ko-KR")} 기준) · 지표 없는 칸·PB도 표시` : "";
    const q = fq, s = +$("fSales").value || 0, cv = (+$("fCvr").value || 0) / 100;
    const pmin = +$("fPmin").value || 0, pmax = +$("fPmax").value || Infinity, rv = $("fRev").value === "" ? Infinity : +$("fRev").value;
    const ad = $("fAd").value, needM = $("fMetric").checked, noAd = $("fNoAd").checked, noPb = $("fNoPb").checked, onlyPicked = $("fPicked").checked;
    return list.filter((o) => {
      if (onlyPicked && !o.picked) return false;
      if (!slots && q && !(o.queries || []).includes(q)) return false;
      if (!slots && needM && o.sales == null && !o.picked) return false; // 직접 담은 상품은 지표가 없어도 보인다
      if (s && (o.sales ?? -1) < s) return false;
      if (cv && (o.cvr ?? -1) < cv) return false;
      if ((pmin || pmax !== Infinity) && (o.p == null || o.p < pmin || o.p > pmax)) return false;
      if (rv !== Infinity && (o.reviews == null || o.reviews > rv)) return false;
      if (ad === "go" && o.ad !== "go") return false;
      if (ad === "gw" && !(o.ad === "go" || o.ad === "warn")) return false;
      if (noAd && o.adSlot) return false;
      if (!slots && noPb && o.pb) return false; // 순위 보기에서는 PB 칸도 그대로(PB 표시) — 순서가 끊기지 않게
      if ($("fHidden").checked && !(o.ri >= 1.5)) return false;
      const sh = $("fShip").value;
      if (sh === "rocket" && !(o.shipT === "로켓배송" || o.shipT === "판매자로켓")) return false;
      if (sh && sh !== "rocket" && o.shipT !== sh) return false;
      const rk = $("fRookie").value;
      if (rk === "hide" && o.rookie) return false;
      if (rk === "only" && !o.rookie) return false;
      if (rk === "recent" && !(o.rookie && o.recent)) return false;
      return true;
    });
  }
  const ADRANK = { go: 3, warn: 2, stop: 1 };
  function sorted(list) {
    const { k, dir } = sort;
    const val = (o) => (k === "ad" ? ADRANK[o.ad] ?? 0 : k === "name" || k === "query" ? String(o[k] || "") : k === "seen" ? o.ex?.ts ?? null : o[k]);
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; if (y == null) return -1; // 값 없는 상품은 항상 아래
      return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * dir;
    });
  }

  function rowHtml(o) {
    const link = `https://www.coupang.com/vp/products/${o.pid}${o.vid ? `?vendorItemId=${o.vid}` : ""}`;
    const ts = o.ex?.ts;
    const days = ts ? Math.floor((Date.now() - ts) / 864e5) : null;
    const pbTag = o.pb ? `<span class="tag pb">PB</span>` : "";
    const adTag = "";
    const newTag = o.rookie ? `<span class="tag rookie${o.recent ? " recent" : ""}" title="이 순위라면 보통 조회 약 ${won(o.views / o.vi)}인데 실제 ${won(o.views)}(${Math.round(o.vi * 100)}%) — 쿠팡이 중간에 끼워 노출한 자리로 추정${o.recent ? " · 같은 화면에서 최근 등록 쪽 상품" : ""}">👀 끼워넣기${o.recent ? " · 최근" : ""}</span>` : "";
    // (최근 등록 끼워넣기는 rookie recent 클래스로 더 진하게)
    return `<tr data-pid="${esc(o.pid)}" class="${sel.has(o.pid) ? "sel" : ""}">
      <td class="no"><input type="checkbox" data-pid="${esc(o.pid)}" ${sel.has(o.pid) ? "checked" : ""}></td>
      <td class="thumb">${o.img ? `<img loading="lazy" src="${esc(imgUrl(o.img))}" alt="">` : ""}</td>
      <td class="nm"><a href="${esc(link)}" target="_blank" title="${esc(o.name)}">${esc(o.name || `상품 ${o.pid} (정보 없음)`)}</a> ${pbTag}${adTag}${newTag}</td>
      <td title="${esc((o.queries || []).join(", "))}">${esc(o.query || "")}${(o.queries || []).length > 1 ? ` <small>+${o.queries.length - 1}</small>` : ""}</td>
      <td class="when" title="${o.when ? new Date(o.when).toLocaleString("ko-KR") : ""}${o.picked ? " · 📦 담기로 직접 담음" : ""}">${o.picked ? `<span class="pk">📌</span>` : ""}${whenText(o.when)}</td>
      <td class="num rk" title="${o.rank ? `'${esc(o.rankQ)}' 화면에서 위에서 ${o.rank}번째 (광고 포함)` : "쿠팡 화면에서 본 순위 없음"}">${o.rank ?? ""}</td>
      <td class="num rk" title="${o.adSlot ? "광고 칸 — 실제 순위에서 제외" : o.organic ? `광고를 뺀 실제 순위 ${o.organic}위` : ""}">${o.adSlot ? `<span class="tag adslot">AD</span>` : o.organic ?? ""}</td>
      <td class="num ${o.ri >= 1.5 ? "good strong" : o.ri != null && o.ri < 0.67 ? "muted" : ""}" title="${o.ri != null ? `같은 검색어 ${o.riN}개 상품의 '순위별 판매 추세'로 보면 이 순위의 기대 판매는 약 ${won(o.sales / o.ri)}개 — 실제 ${won(o.sales)}개` : "같은 검색어에서 순위·판매가 있는 상품이 5개 이상 모이면 계산됩니다"}">${o.ri == null ? "" : `${o.ri >= 1.5 ? "🔥 " : ""}${o.ri.toFixed(1)}배`}</td>
      <td class="num ${o.page?.price != null && o.p === o.page.price ? "cpt" : ""}" title="${o.page?.price != null && o.p === o.page.price ? "쿠팡 화면 가격(쿠폰·즉시할인 적용)" : "Wing 판매가 — 쿠팡 화면에서 아직 못 읽음"}">${won(o.p)}</td>
      <td class="num ${o.page?.reviews != null ? "cpt-r" : ""}" title="${o.page?.reviews != null ? "쿠팡 화면 리뷰 수" : "Wing 리뷰 수"}">${won(o.reviews)}</td>
      <td class="num strong">${won(o.sales)}</td>
      <td class="num">${man(o.rev)}</td>
      <td class="num">${won(o.views)}</td>
      <td class="num ${o.cvr != null && o.cvr >= 0.08 ? "good" : ""}">${o.cvr == null ? "" : (o.cvr * 100).toFixed(1) + "%"}</td>
      <td class="adj ${o.ad || ""}" title="${o.ad ? `1개 팔 때 광고비 약 ${won(o.cpa)}원 · 1개 마진 약 ${won(o.unitM)}원(판매가×${Math.round(MARGIN * 100)}% 가정) · ${window.AdModel.note()}` : ADS ? "" : "광고 안 함으로 설정됨"}">${o.ad ? AD[o.ad] : !ADS && o.cvr != null ? `<span class="muted">광고 안 함</span>` : ""}</td>
      <td class="c" title="${o.shipSrc === "wing" ? "Wing 조회값(정확)" : o.shipT ? `쿠팡 화면 배지·도착일로 판단${o.shipDays != null ? ` · 도착까지 ${o.shipDays}일` : ""}` : ""}">${o.shipT ? `<span class="tag ship ${SHIPC[o.shipT]}">${o.shipT}</span>` : ""}</td>
      <td class="num ${days != null && days >= 7 ? "bad" : "muted"}" title="${ts ? new Date(ts).toLocaleString("ko-KR") : "지표를 아직 받지 않음"}">${days == null ? "" : days === 0 ? "오늘" : `${days}일 전`}</td></tr>`;
  }

  // 날짜 표시·묶음 (맥 다운로드처럼): 오늘 14:32 · 어제 · 이번 주 요일 · 그 전은 날짜
  const DAY = 864e5;
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function whenText(t) {
    if (!t) return "";
    const d = new Date(t), today = dayStart(Date.now()), day = dayStart(t);
    const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (day === today) return `오늘 ${hm}`;
    if (day === today - DAY) return `어제 ${hm}`;
    if (today - day < 7 * DAY) return `${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]}요일 ${hm}`;
    return `${d.getMonth() + 1}/${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? `/${String(d.getFullYear()).slice(2)}` : ""}`;
  }
  function dayGroup(t) {
    if (!t) return "날짜 없음";
    const today = dayStart(Date.now()), day = dayStart(t);
    return day === today ? "오늘" : day === today - DAY ? "어제" : today - day < 7 * DAY ? "이번 주" : today - day < 30 * DAY ? "이번 달" : "이전";
  }
  function render() {
    view = sorted(filtered());
    head();
    if (sort.k === "when") { // 최근순일 때만 날짜 묶음 줄을 끼운다
      let last = null, html = "";
      for (const o of view) {
        const g = dayGroup(o.when);
        if (g !== last) { const n = view.filter((x) => dayGroup(x.when) === g).length; html += `<tr class="day"><td colspan="${COLS.length}"><b>${g}</b>${n}개</td></tr>`; last = g; }
        html += rowHtml(o);
      }
      $("coBody").innerHTML = html;
    } else $("coBody").innerHTML = view.map(rowHtml).join("");
    $("coEmpty").hidden = items.length > 0;
    $("coTable").hidden = items.length === 0;
    $("coFilter").hidden = items.length === 0;
    const withM = items.filter((o) => o.sales != null).length;
    $("coInfo").textContent = items.length ? `전체 ${items.length}개 (지표 ${withM}개) · 표시 ${view.length}개${sel.size ? ` · 선택 ${sel.size}개` : ""}` : "";
    $("coAdd").disabled = !sel.size; $("coDel").disabled = !sel.size;
    $("coAdd").textContent = sel.size ? `☆ 선택 ${sel.size}개 리스트업 담기` : "☆ 선택 상품 리스트업 담기";
    const all = $("coAll");
    if (all) all.checked = view.length > 0 && view.every((o) => sel.has(o.pid));
  }

  function fillQueries() {
    const counts = {}, latest = {};
    items.forEach((o) => (o.queries || []).forEach((q) => { counts[q] = (counts[q] || 0) + 1; latest[q] = Math.max(latest[q] || 0, o.when || 0); }));
    const cur = $("fQuery").value;
    // 최근에 담은 검색어가 위로
    $("fQuery").innerHTML = `<option value="">전체</option>` + Object.entries(counts).sort((a, b) => (latest[b[0]] || 0) - (latest[a[0]] || 0)).map(([q, n]) => `<option value="${esc(q)}">${esc(q)} (${n})</option>`).join("");
    $("fQuery").value = counts[cur] ? cur : "";
  }

  async function load() {
    const st = await api.invoke("settings:get");
    MARGIN = st.ads === false ? 0.2 : 0.3; ADS = st.ads !== false;
    items = (await api.invoke("collect:get")).map(derive);
    pageLog = (await api.invoke("collect:pagelog")) || [];
    loaded = true;
    const valid = new Set(items.map((o) => o.pid));
    sel = new Set([...sel].filter((p) => valid.has(p)));
    fillQueries();
    render();
    $("ccount").textContent = items.length;
  }

  // ----- 이벤트 -----
  $("coFilter").addEventListener("input", render);
  $("fReset").addEventListener("click", () => {
    ["fSales", "fCvr", "fPmin", "fPmax", "fRev"].forEach((id) => ($(id).value = ""));
    $("fQuery").value = ""; $("fAd").value = ""; $("fMetric").checked = true; $("fPicked").checked = false; $("fNoAd").checked = false; $("fNoPb").checked = true; $("fHidden").checked = false; $("fRookie").value = ""; $("fShip").value = ""; lastFq = null;
    render();
  });
  $("coHead").addEventListener("click", (e) => {
    if (e.target.id === "coAll") {
      view.forEach((o) => (e.target.checked ? sel.add(o.pid) : sel.delete(o.pid)));
      return render();
    }
    const th = e.target.closest("th[data-k]");
    if (!th || !SORTABLE.has(th.dataset.k)) return;
    const k = th.dataset.k;
    sort = { k, dir: sort.k === k ? -sort.dir : k === "name" || k === "query" || k === "rank" || k === "p" ? 1 : -1 }; // when 은 최근순(-1)이 기본
    render();
  });
  let lastIdx = null;
  $("coBody").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-pid]");
    if (!tr) return;
    const idx = view.findIndex((o) => o.pid === tr.dataset.pid);
    // Shift+클릭 = 범위 선택 (엑셀처럼)
    if (e.shiftKey && lastIdx != null) {
      const [a, b] = [Math.min(lastIdx, idx), Math.max(lastIdx, idx)];
      for (let i = a; i <= b; i++) sel.add(view[i].pid);
    } else if (sel.has(tr.dataset.pid)) sel.delete(tr.dataset.pid);
    else sel.add(tr.dataset.pid);
    lastIdx = idx;
    render();
  });
  $("coXlsx").addEventListener("click", async () => {
    if (!view.length) return;
    const rows = view.map((o) => ({ pid: o.pid, name: o.name, query: $("fQuery").value || o.query || "", rank: o.rank, organic: o.organic, adSlot: o.adSlot,
      price: o.p, reviews: o.reviews, rocket: o.rocket, ship: o.shipT, pb: o.pb, sales: o.sales, rev: o.rev, views: o.views, cvr: o.cvr, ad: o.ad, cpa: o.cpa,
      ts: o.ex?.ts || null, img: o.img, url: `https://www.coupang.com/vp/products/${o.pid}${o.vid ? `?vendorItemId=${o.vid}` : ""}` }));
    $("coXlsx").disabled = true;
    const r = await api.invoke("collect:export", { rows, cpc: window.AdModel.cpc, conv: window.AdModel.conv, margin: MARGIN, ads: ADS });
    $("coXlsx").disabled = false;
    if (r?.path) window.PanelHooks?.log("go", `■ 수집함 엑셀 저장: ${esc(r.path)} (${rows.length}개)`);
  });
  $("coDel").addEventListener("click", async () => {
    const b = $("coDel");
    if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = `${sel.size}개 삭제?`; setTimeout(() => { b.classList.remove("arm"); render(); }, 2500); return; }
    b.classList.remove("arm");
    await api.invoke("collect:remove", [...sel]);
    sel.clear();
    await load();
  });
  $("coAdd").addEventListener("click", async () => {
    const picked = items.filter((o) => sel.has(o.pid));
    const dbCache = {};
    let added = 0, skipped = 0;
    const px = window.AiScan?.pick(picked.length, $("fQuery").value || ""); // 🎤 발표 모드: 담기 해커 화면(실제 처리에 맞춰 한 개씩)
    for (const o of picked) {
      if (window.Listup?.has(o.pid)) { skipped++; await px?.item(o, { skip: true }); continue; }
      const q = $("fQuery").value || o.query || "";
      if (q && !q.startsWith("📂") && !dbCache[q]) dbCache[q] = await api.invoke("kw:db", q); // 카테고리는 키워드 DB 조회 안 함
      const db = dbCache[q] || {};
      // 1페이지 최고/최저가: 같은 검색어 1페이지에서 본 상품들의 실제 가격
      const page1 = items.filter((x) => x.pos?.[q]?.page === 1 && Date.now() - x.pos[q].ts < 3 * 864e5 && x.p);
      const prices = page1.map((x) => x.p);
      const sub = (db.subs || []).find((s) => !s.brand);
      const en = window.Entry?.forItem(o.p); // 🎯 추천 판매가(경쟁사보다 체감 할인)
      const row = window.Listup.add({
        keyword: q, kwVol: db.main?.m1 ?? null, subKw: sub?.kw || "", subVol: sub?.m1 ?? null,
        subs: (db.subs || []).slice(0, 15).map((s) => ({ kw: s.kw, m1: s.m1, brand: s.brand })),
        maxPrice: prices.length ? Math.max(...prices) : null, minPrice: prices.length ? Math.min(...prices) : null,
        name: o.name, pid: o.pid, img: o.img, benchUrl: `https://www.coupang.com/vp/products/${o.pid}${o.vid ? `?vendorItemId=${o.vid}` : ""}`,
        bSales: o.sales, bViews: o.views, bCvr: o.cvr, ad: o.ad, maxRoas: o.maxRoas, cpa: o.cpa,
        monthly: "", benchMonthly: o.sales != null ? Math.round((o.sales * 30) / 28) : null, benchPrice: o.p, recPrice: en?.cut > 0 ? en.price : null, bReviews: o.reviews ?? null, bRating: o.rating ?? null, bShip: o.shipT || "",
      });
      window.Listup.queue1688?.(row); // 🎯 1688 자동 조사 줄에(하나씩 차례로)
      added++;
      await px?.item(o, { db, minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null });
    }
    if (px) await px.finish({ added, skipped });
    window.PanelHooks?.log("go", `☆ 수집함 → 리스트업 ${added}개 담음${skipped ? ` · 이미 담긴 ${skipped}개 제외` : ""}`);
    sel.clear();
    render();
    window.PanelHooks?.onListupChange();
    if (added) api.invoke("nav:tab", "list");
  });

  // 새로 모이면 배지 갱신, 수집함을 보고 있으면 표도 갱신(1초 묶음)
  let t = null;
  api.on("collect:changed", ({ count }) => {
    $("ccount").textContent = count;
    if ($("collect").hidden) return;
    clearTimeout(t); t = setTimeout(load, 1000);
  });

  window.Collect = { load };
  api.invoke("collect:get").then((r) => ($("ccount").textContent = r.length));
})();
