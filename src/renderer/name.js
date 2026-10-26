// ✍ 상품명 짓기 — 존버셀러제이 2주차 강의 공식(브랜드 + 타겟키워드 + 서브키워드 · 4~6단어)
// 흐름: 시작 화면(키워드·브랜드·수량 + 큰 버튼) → 결과(후보 상품명 3개 크게 · 단어 고르기 · 내 상품명 검사 · 상위 상품명 접기)
//  · 단어를 누르면 후보가 바로 바뀐다 · 결과는 다른 탭에 다녀와도 그대로 · 브랜드는 기억(이 PC 화면 편의용)
//  · 계산은 메인(name:build / name:check → shared/name-core.js). 판정은 내지 않는다 — 참고 숫자만
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = (n) => Math.round(n || 0).toLocaleString("ko-KR");
  const man = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만` : won(n));
  const root = $("namer");
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const read = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };

  let st = { keyword: "", brand: read("nameBrand"), qty: "", feats: "", data: null, picks: null, mine: "", busy: false, err: "", touched: false, cpRun: "", cpErr: "" };
  const SRC = { auto: "쿠팡 자동완성", related: "쿠팡 연관검색어", related2: "연관검색어 2단계", deep: "파생 자동완성", db: "네이버 검색량", top: "상위 상품명" };

  // 타겟키워드를 쿠팡 검색 화면처럼 노란색으로
  const mark = (name, target) => {
    const i = name.indexOf(target);
    return i < 0 ? esc(name) : `${esc(name.slice(0, i))}<mark>${esc(target)}</mark>${esc(name.slice(i + target.length))}`;
  };

  function formHtml(compact) {
    return `<form class="nm-form ${compact ? "compact" : ""}" id="nmForm">
      <label class="kw"><span>대표 키워드</span><input id="nmKw" type="search" required placeholder="예: 팬티스타킹" value="${esc(st.keyword)}" autocomplete="off" spellcheck="false"></label>
      <label><span>브랜드</span><input id="nmBrand" type="text" placeholder="예: 제이" value="${esc(st.brand)}" autocomplete="off" spellcheck="false"></label>
      <label class="sm"><span>수량·구성</span><input id="nmQty" type="text" placeholder="예: 10P" value="${esc(st.qty)}" autocomplete="off"></label>
      <label class="ft"><span>특장점 단어 <small>키워드가 모자랄 때</small></span><input id="nmFeats" type="text" placeholder="예: 발냄새예방 통기성" value="${esc(st.feats)}" autocomplete="off"></label>
      <button class="nm-go" type="submit" ${st.busy ? "disabled" : ""}>${compact ? "↻ 다시 만들기" : "✍ 상품명 만들기"}</button>
    </form>`;
  }

  function startHtml() {
    return `<div class="nm-start">
      <b>검색되는 상품명, 3개 후보로 만들어 드려요</b>
      <span>키워드 하나만 넣으면 됩니다. 브랜드와 수량은 있으면 넣어 주세요.</span>
      ${formHtml(false)}
      <ul class="nm-rule">
        <li><b>브랜드 + 타겟키워드 + 서브키워드</b><span>소비자가 실제로 찾는 단어 순서대로</span></li>
        <li><b>4~6단어</b><span>쿠팡 PB 평균 5.1단어 · 수량은 빼고 셈</span></li>
        <li><b>색상은 빼기</b><span>옵션명으로 자동 노출돼요</span></li>
      </ul>
      ${st.err ? `<p class="nm-err">${esc(st.err)}</p>` : ""}
    </div>`;
  }

  function candHtml(c, i) {
    return `<div class="nm-cand ${i === 0 ? "first" : ""}">
      <div class="nm-name"><span class="no">${i + 1}</span><b>${mark(c.name, c.target)}</b>
        <button type="button" class="nm-copy" data-copy="${esc(c.name)}" data-tip="📋 이 상품명 복사" aria-label="상품명 복사">📋<span>복사</span></button></div>
      <div class="nm-meta"><span class="chip">${c.n}단어</span><span class="chip t">타겟 ${esc(c.target)}</span>
        ${c.m1 != null ? `<span class="chip g">월검색 ${won(c.m1)}</span>` : c.cp ? `<span class="chip g">쿠팡 검색어 ${c.cp}번</span>` : `<span class="chip o">검색량 모름</span>`}
        ${c.mx != null ? `<span class="chip">1위 리뷰 ${man(c.mx)}</span>` : ""}
        ${c.feat?.length ? `<span class="chip">특장점 ${esc(c.feat.join("·"))}</span>` : ""}</div>
    </div>`;
  }

  function wordsHtml(d) {
    const ok = d.pool.filter((p) => !p.flag), off = d.pool.filter((p) => p.flag);
    const chip = (p) => {
      const on = st.picks.includes(p.word);
      const tip = [p.m1 != null ? `'${p.merged || (p.pos === "post" ? d.keyword + p.word : p.word + d.keyword)}' 네이버 월검색 ${won(p.m1)}` : p.solo != null ? `'${p.word}' 단어 하나로 월검색 ${won(p.solo)} · 내 키워드와 붙인 검색어는 없어요` : "검색량이 확인되지 않은 단어", p.cp ? `쿠팡 검색어에 ${p.cp}번` : "", p.top ? `상위 상품 ${p.top}개가 씀` : "", `출처: ${p.src.map((x) => SRC[x] || x).join("·")}`].filter(Boolean).join(" · ");
      return `<button type="button" class="nm-w ${on ? "on" : ""}" data-w="${esc(p.word)}" aria-pressed="${on}" data-tip="${esc(tip)}">
        ${on ? "✓ " : ""}${p.cp ? `<em>쿠팡</em>` : ""}${esc(p.word)}${p.m1 != null ? ` <small>월 ${man(p.m1)}</small>` : p.solo != null ? ` <small class="solo">단독 ${man(p.solo)}</small>` : ""}${p.top ? ` <i>상위 ${p.top}</i>` : ""}</button>`;
    };
    const grp = (f, ko) => { const xs = off.filter((p) => p.flag === f); return xs.length ? `<span><b>${ko}</b> ${xs.slice(0, 8).map((p) => esc(p.word)).join(" · ")}</span>` : ""; };
    return `<section class="nm-box">
      <div class="nm-h"><b>내 상품에 맞는 단어 고르기</b><span>누르면 위 후보가 바로 바뀌어요 · <b>월</b> = 단어+키워드 네이버 월검색 · <b>단독</b> = 단어 하나 검색량 · <b>상위</b> = 잘 팔리는 상품 중 이 단어를 쓴 개수 · <em class="nm-cpb">쿠팡</em> = 쿠팡 검색어에 나온 단어</span></div>
      ${cpHtml(d)}
      ${ok.length ? `<div class="nm-ws">${ok.slice(0, 30).map(chip).join("")}</div>` : `<p class="nm-dim">이 키워드로 찾은 단어가 없어요 · 특장점 단어를 넣어 주세요</p>`}
      ${off.length ? `<div class="nm-off">${grp("color", "색상 · 옵션명으로")}${grp("brand", "남의 브랜드")}${grp("junk", "정보 검색어")}</div>` : ""}
      ${d.items.length ? "" : `<div class="nm-more"><button type="button" class="sec" id="nmTop" ${st.busy ? "disabled" : ""} data-tip="Wing 키워드 검색 1번 · 하루 예산 사용">🔎 쿠팡 상위 상품 단어도 보기</button><span>잘 팔리는 상품들이 공통으로 쓰는 단어를 더해요</span></div>`}
    </section>`;
  }

  // 쿠팡 자동완성·연관검색어 상태 줄 + 원본 목록(접기)
  function cpHtml(d) {
    if (st.cpRun === d.keyword) return `<div class="nm-cp run"><i></i>쿠팡 자동완성·연관검색어 읽는 중… <small>숨은 쿠팡 화면 최대 4번 · 20초 안팎</small></div>`;
    if (!d.cp) return `<div class="nm-cp">${st.cpErr ? `<span class="bad">${esc(st.cpErr)}</span>` : "쿠팡 자동완성·연관검색어를 아직 안 읽었어요"} <button type="button" class="sec" data-cp>🛒 쿠팡에서 읽기</button></div>`;
    const deepN = Object.values(d.cp.deep || {}).flat().length, r2N = Object.values(d.cp.related2 || {}).flat().length;
    const list = (ko, xs) => (xs.length ? `<div><b>${ko}</b> ${xs.map(esc).join(" · ")}</div>` : "");
    return `<details class="nm-cp"><summary>쿠팡 자동완성 <b>${d.cp.auto.length}</b> · 연관검색어 <b>${d.cp.related.length}</b> · 2단계 <b>${r2N}</b> · 파생 <b>${deepN}</b> 읽음 <small>${new Date(d.cp.ts).toLocaleDateString("ko-KR")}</small>
        <button type="button" class="nm-re" data-cp="force" data-tip="↻ 쿠팡에서 다시 읽기 (숨은 쿠팡 화면 1번)" aria-label="쿠팡에서 다시 읽기">↻</button></summary>
      <div class="nm-cpl">${list("자동완성", d.cp.auto)}${list("연관검색어", d.cp.related)}${Object.entries(d.cp.related2 || {}).filter(([, xs]) => xs.length).map(([k, xs]) => list(`'${k}' 화면 연관검색어`, xs)).join("")}${Object.entries(d.cp.deep || {}).filter(([, xs]) => xs.length).map(([k, xs]) => list(`'${k}' 자동완성`, xs)).join("")}</div></details>`;
  }

  // 쿠팡 단어를 읽고 다시 계산 — 사람이 단어를 아직 안 건드렸으면 처음 고르는 단어도 새로 정한다
  async function readCoupang(force = false) {
    const kw = st.keyword; if (!kw || st.cpRun) return;
    st.cpRun = kw; st.cpErr = ""; render();
    const r = await api.invoke("name:coupang", { keyword: kw, force }).catch((e) => ({ error: e?.message || String(e) }));
    st.cpRun = "";
    if (kw !== st.keyword) return;
    if (r?.error) { st.cpErr = r.error; return render(); }
    build({ keepPicks: st.touched });
  }

  function checkHtml() {
    return `<section class="nm-box">
      <div class="nm-h"><b>내 상품명 검사</b><span>지금 쓰는 상품명을 붙여 넣어 보세요</span></div>
      <input id="nmMine" class="nm-mine" type="text" placeholder="예: 제이 고탄력 팬티스타킹 학생 압박 10P" value="${esc(st.mine)}" autocomplete="off" spellcheck="false">
      <div class="nm-chks" id="nmChks"></div>
    </section>`;
  }

  function topHtml(d) {
    if (!d.items.length) return "";
    return `<details class="nm-box nm-fold"><summary><b>쿠팡 상위 상품 상품명 ${d.items.length}개</b><span>판매 많은 순 · 단어 수 비교용${d.ts ? ` · ${new Date(d.ts).toLocaleDateString("ko-KR")} 조회` : ""}</span></summary>
      <ol class="nm-top">${d.items.map((it) => { const n = it.name.trim().split(/\s+/).length; return `<li><span class="nm-tn" title="${esc(it.name)}">${esc(it.name)}</span><span class="chip ${n > 7 ? "o" : ""}">${n}단어</span><span>${it.sales != null ? `28일 ${won(it.sales)}개` : "-"}</span></li>`; }).join("")}</ol>
    </details>`;
  }

  function render() {
    const d = st.data;
    if (!d) { root.innerHTML = startHtml(); bindForm(); setTimeout(() => $("nmKw")?.focus(), 30); return; }
    const first = d.names[0];
    root.innerHTML = `<div class="nm-bar">${formHtml(true)}</div>
      <div class="nm-scroll">
        ${st.err ? `<p class="nm-err">${esc(st.err)}</p>` : ""}
        <section class="nm-box nm-res">
          <div class="nm-h"><b>후보 상품명 ${d.names.length}개</b><span>노란 글자 = 타겟키워드 · 타겟마다 쿠팡에서 검색해 경쟁을 비교해 보세요</span>
            <span class="nm-src">${d.main ? `'${esc(d.keyword)}' 월검색 <b>${won(d.main.m1)}</b>` : d.month ? "검색량 DB에 없는 키워드" : "이 PC엔 검색량 DB가 없어요 · 쿠팡 검색어로 만들었어요"}${d.month ? ` · 제휴 DB ${esc(d.month)}` : ""}</span></div>
          ${d.names.map(candHtml).join("")}
          ${!st.brand ? `<p class="nm-hint">브랜드를 넣으면 맨 앞에 붙여 드려요</p>` : ""}
          ${first && first.n < 4 ? `<p class="nm-hint">단어가 ${first.n}개뿐이에요 · 아래에서 단어를 더 고르거나 특장점 단어를 넣어 주세요</p>` : ""}
        </section>
        ${wordsHtml(d)}
        ${checkHtml()}
        ${topHtml(d)}
      </div>`;
    bindForm();
    renderChecks();
  }

  async function renderChecks() {
    const box = $("nmChks"); if (!box) return;
    if (!st.mine.trim()) { box.innerHTML = ""; return; }
    const cs = await api.invoke("name:check", { name: st.mine, keyword: st.keyword, brand: st.brand }).catch(() => []);
    if (!$("nmChks")) return;
    $("nmChks").innerHTML = cs.map((c) => `<span class="nm-chk ${c.pass === true ? "p" : c.pass === false ? "f" : "u"}" data-tip="${esc(c.why)}">${c.pass === true ? "○" : c.pass === false ? "✕" : "·"} ${esc(c.label)}</span>`).join("")
      + (cs.some((c) => c.pass === false) ? `<p class="nm-why">${cs.filter((c) => c.pass === false).map((c) => esc(c.why)).join("<br>")}</p>` : "");
  }

  function readForm() {
    st.keyword = ($("nmKw")?.value || "").trim();
    st.brand = ($("nmBrand")?.value || "").trim();
    st.qty = ($("nmQty")?.value || "").trim();
    st.feats = ($("nmFeats")?.value || "").trim();
    keep("nameBrand", st.brand);
  }

  async function build({ fresh = false, keepPicks = false } = {}) {
    if (!st.keyword) return;
    st.busy = true; st.err = "";
    const r = await api.invoke("name:build", { keyword: st.keyword, brand: st.brand, qty: st.qty, feats: st.feats, picks: keepPicks ? st.picks : null, fresh }).catch((e) => ({ error: e?.message || String(e) }));
    st.busy = false;
    if (r?.error) { st.err = /No handler registered/.test(r.error) ? "앱을 완전히 끈 뒤(⌘Q) 다시 켜 주세요 · 새 기능이 아직 적용되지 않았어요" : r.error; if (!st.data) return render(); }
    else { st.data = r; st.picks = r.picks; }
    render();
    if (st.data && !st.data.cp && !st.cpErr && !st.cpRun) readCoupang(); // 처음 만들 때 한 번 자동으로
  }

  let lastKw = "";
  function bindForm() {
    const f = $("nmForm"); if (!f) return;
    f.onsubmit = (e) => { e.preventDefault(); readForm(); const same = st.keyword === lastKw; lastKw = st.keyword; if (!same) { st.touched = false; st.cpErr = ""; } build({ keepPicks: same && !!st.data }); };
  }

  root.addEventListener("click", async (e) => {
    const w = e.target.closest("[data-w]");
    if (w) {
      const word = w.dataset.w;
      st.picks = st.picks.includes(word) ? st.picks.filter((x) => x !== word) : [...st.picks, word]; st.touched = true;
      readForm();
      return build({ keepPicks: true });
    }
    const cpb = e.target.closest("[data-cp]");
    if (cpb) { e.preventDefault(); return readCoupang(cpb.dataset.cp === "force"); }
    const c = e.target.closest("[data-copy]");
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); const s = c.querySelector("span"); if (s) { s.textContent = "복사됨"; setTimeout(() => (s.textContent = "복사"), 1500); } } catch {}
      return;
    }
    if (e.target.closest("#nmTop")) {
      st.busy = true; render();
      const r = await api.invoke("kw:search", { keyword: st.keyword, pages: 1 }).catch((err) => ({ error: err?.message || String(err) }));
      st.busy = false;
      if (r?.error) { st.err = /로그인|WING/i.test(r.error) ? "Wing 로그인이 필요해요 (왼쪽 🔑 Wing 로그인)" : r.error; render(); return; }
      return build({ fresh: true, keepPicks: false });
    }
  });
  let tm = 0;
  root.addEventListener("input", (e) => {
    if (e.target.id !== "nmMine") return;
    st.mine = e.target.value;
    clearTimeout(tm); tm = setTimeout(renderChecks, 200);
  });

  window.NameMaker = {
    show() { if (!root.innerHTML) render(); },
    // 🔎 키워드 분석에서 넘어올 때: 키워드를 채우고 바로 만든다
    open(keyword) { st.keyword = String(keyword || "").trim(); st.data = null; st.picks = null; st.err = ""; st.touched = false; st.cpErr = ""; lastKw = st.keyword; render(); if (st.keyword) build(); },
  };
})();
