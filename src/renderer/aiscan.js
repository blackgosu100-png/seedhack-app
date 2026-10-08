// 🔎 키워드 검색 "AI 분석 화면" — 시연용 연출(ANDERSON 스타일).
// 숫자·로그는 실제 값만 쓴다: 대기 중엔 실제 경과 시간·Wing 진행 로그·네이버 월검색량, 응답이 오면 받은 상품을 빠르게 훑으며 보여 준다.
//   const s = AiScan.start(keyword); s.db(db); ...; await s.analyze(items, e); 또는 s.fail(msg)
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = (n) => (n == null || !Number.isFinite(+n) ? "-" : Math.round(n).toLocaleString("ko-KR"));
  const man = (n) => (n == null || !Number.isFinite(+n) ? "-" : n >= 1e8 ? (n / 1e8).toFixed(1) + "억" : n >= 1e4 ? Math.round(n / 1e4).toLocaleString("ko-KR") + "만" : won(n));
  const pct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");
  const clock = () => new Date().toLocaleTimeString("en-GB");
  const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
  const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
  const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const AD = { go: "🟢", warn: "🟡", stop: "🔴" };
  const STEPS_B = ["판매 지표 수집 중", "전환율 비교 중", "광고 수익성 판정 중", "꿀통 상품 매칭 중"];
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cur = null;

  function start(keyword) {
    cur?.close(true);
    // 발표 모드가 아니면 위쪽 진행 띠만(짧고 조용하게), 발표 모드면 앱 창 전체를 덮는 AI 분석 화면
    if (!document.body.classList.contains("present")) return startBar(keyword);
    if (reduce()) return null;
    const panel = document.body;
    const root = document.createElement("div");
    root.className = "ais full";
    root.innerHTML = `<div class="ais-in">
      <div class="ais-engine"><b></b>AI SOURCING ENGINE</div>
      <div class="ais-chip"><b></b>${esc(keyword)}</div>
      <div class="ais-title">쿠팡 키워드 DB 분석 중<span class="dots">...</span></div>
      <div class="ais-sub"><span>키워드 DB 조회 중…</span></div>
      <div class="ais-prow"><span class="ais-found">검색된 상품: <b>0</b>개</span><span class="ais-pct">0%</span></div>
      <div class="ais-bar"><i></i></div>
      <div class="ais-stats">
        <div data-k="vol"><span>SEARCH VOL</span><strong>-</strong><small>네이버 월검색</small></div>
        <div data-k="prod"><span>PRODUCTS</span><strong>0</strong><small>분석한 상품</small></div>
        <div data-k="sales"><span>SALES 28D</span><strong>0</strong><small>28일 판매 합</small></div>
      </div>
      <div class="ais-thumbs"></div>
      <div class="ais-term"><div class="ais-th"><i></i><i></i><i></i>AI Sourcing Engine · Coupang Wing</div><div class="ais-log"></div>
        <div class="ais-live"><span class="sp">⠋</span><span class="m">엔진 준비 중</span><span class="ms">0.00s</span></div></div>
      <button class="ais-skip" type="button">건너뛰기 ›</button></div>`;
    panel.appendChild(root);
    const q = (s) => root.querySelector(s);
    const logEl = q(".ais-log"), liveM = q(".ais-live .m"), liveMs = q(".ais-live .ms"), liveSp = q(".ais-live .sp");
    const stat = Object.fromEntries([...root.querySelectorAll("[data-k]")].map((d) => [d.dataset.k, { box: d, el: d.querySelector("strong"), shown: 0, target: null }]));

    const st = { phase: "A", t0: performance.now(), tLive: performance.now(), pct: 0, base: 0, bTarget: null, skip: false, closed: false, found: 0 };
    const line = (cls, html) => {
      const p = document.createElement("p");
      p.className = cls || "";
      p.innerHTML = `<span class="t">[${clock()}]</span> ${html}`;
      logEl.appendChild(p);
      while (logEl.childElementCount > 14) logEl.firstChild.remove();
    };
    const live = (text) => { liveM.textContent = text; st.tLive = performance.now(); };
    const sub = (text) => { const s = q(".ais-sub"); if (s.textContent !== text) s.innerHTML = `<span>${esc(text)}</span>`; };
    const set = (k, v) => { stat[k].target = v; };
    const found = (n) => { st.found = n; q(".ais-found b").textContent = won(n); };

    // 매 프레임: 점(...)·스피너·경과 시간·진행률·숫자 카운트업
    let raf;
    const frame = (now) => {
      if (st.closed) return;
      q(".dots").textContent = ".".repeat(3 - (Math.floor(now / 450) % 3));
      liveSp.textContent = SPIN[Math.floor(now / 80) % SPIN.length];
      liveMs.textContent = ((now - st.tLive) / 1000).toFixed(2) + "s";
      // 대기(A): 실제 응답 전이라 55%까지만 시간에 따라 천천히 / 분석(B): 훑은 상품 비율
      const target = st.phase === "A" ? Math.max(st.base, 55 * (1 - Math.exp(-(now - st.t0) / 3500))) : st.bTarget;
      st.pct += (target - st.pct) * 0.12;
      q(".ais-pct").textContent = Math.floor(st.pct) + "%";
      q(".ais-bar i").style.width = st.pct + "%";
      for (const k in stat) {
        const s = stat[k];
        if (s.target == null) continue;
        const d = s.target - s.shown;
        if (d) { s.shown = Math.abs(d) < 1 ? s.target : s.shown + Math.sign(d) * Math.max(1, Math.abs(d) * 0.14); s.el.textContent = won(s.shown); s.box.classList.add("tick"); }
        else s.box.classList.remove("tick");
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    line("sys", "AI Sourcing Engine 시작 · 키워드 <b>" + esc(keyword) + "</b>");
    live("키워드 DB 연결 중");

    const ctl = {
      // 제휴 키워드 DB(네이버 월검색·서브키워드)
      db(db) {
        if (st.closed) return;
        const m = db?.main;
        if (m?.m1 != null) { set("vol", m.m1); line("go", `✔ 네이버 월검색 ${won(m.m1)} · 서브키워드 후보 ${db.subs?.length || 0}개`); }
        else line("", "· 제휴 키워드 DB에 없는 키워드 — 쿠팡 지표로 분석합니다");
        (db?.subs || []).filter((s) => !s.brand).slice(0, 4).forEach((s) => line("", `  ↳ 서브키워드 ${esc(s.kw)} <span class="t">${won(s.m1)}</span>`));
        sub("Wing 상품 매칭 검색 중…");
        live("Wing 상품 매칭 검색 응답 대기");
      },
      // 화면 쪽에서 알려 주는 진행(쿠폰가 확인 등)
      note(cls, html, liveText) {
        if (st.closed) return;
        line(cls, html);
        if (liveText) { live(liveText); sub(liveText + "…"); }
      },
      // 메인 프로세스 진행 로그(실제 이벤트) — 쿠팡 화면 진단 로그(dim)는 빼고
      console(cls, text) {
        if (st.closed || st.phase !== "A" || cls === "dim") return;
        line(cls, esc(text));
        const m = /✔ (\d+)페이지 · 상품 (\d+)개/.exec(text);
        if (m) { found(st.found + +m[2]); st.base = Math.min(55, st.pct + 12); live(`${m[1]}페이지 판매 지표 수신 · 다음 단계 준비`); }
        else if (/↗/.test(text)) live(text.replace(/^↗\s*/, "") + " · 응답 대기");
        else if (/재사용/.test(text)) { st.base = 50; live("저장된 결과 불러오는 중"); }
      },
      // 받은 상품을 빠르게 훑기 → 완료 화면 → 사라짐
      analyze(items, e, { cached } = {}) {
        if (st.closed) return Promise.resolve();
        st.phase = "B";
        st.bTarget = st.pct;
        if (!st.found) found(items.length);
        set("prod", 0); stat.prod.shown = 0;
        set("sales", 0); stat.sales.shown = 0;
        line("go", `✔ 상품 ${items.length}개 지표 수신${cached ? " (저장된 결과)" : ""} · 분석 시작`);
        const n = items.length, per = Math.max(28, Math.min(110, 2600 / Math.max(1, n)));
        const start = st.pct;
        let i = 0, sales = 0;
        const thumbs = q(".ais-thumbs");
        return new Promise((resolve) => {
          const step = () => {
            if (st.closed) return resolve();
            if (st.skip || i >= n) return done(resolve);
            const it = items[i];
            sales += it.ex?.sales || 0;
            set("prod", i + 1); set("sales", sales);
            st.bTarget = start + (100 - start) * ((i + 1) / n);
            sub(STEPS_B[Math.min(STEPS_B.length - 1, Math.floor((i / n) * STEPS_B.length))] + "…");
            const name = esc((it.name || "").slice(0, 20));
            live(`분석 #${i + 1}/${n} ${it.name?.slice(0, 22) || ""}`);
            line(it.ad || "", `${it.hot === "hot" ? "🔥" : AD[it.ad] || "·"} ${name} <span class="t">판매 ${won(it.ex?.sales)} · 전환 ${pct(it.cvr)}${it.rev ? " · " + man(it.rev) + "원" : ""}</span>`);
            const u = imgUrl(it.img);
            const th = u ? Object.assign(document.createElement("img"), { src: u, alt: "" }) : Object.assign(document.createElement("div"), { className: "ph" });
            if (it.ad) th.classList.add(it.ad);
            thumbs.appendChild(th);
            while (thumbs.childElementCount > 9) thumbs.firstChild.remove();
            i++;
            setTimeout(step, per);
          };
          step();
        });

        function done(resolve) {
          st.bTarget = 100; st.pct = 100;
          q(".ais-pct").textContent = "100%"; q(".ais-bar i").style.width = "100%";
          const good = (e?.hot || 0) + (e?.adGo || 0);
          const box = document.createElement("div");
          box.className = "ais-done";
          box.innerHTML = `<div class="ais-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
            <h3>${good ? "분석 완료! 꿀통 상품을 찾았습니다" : "분석 완료!"}</h3>
            <p>'${esc(keyword)}' 상품 ${n}개 · 28일 판매 ${won(e?.sales)}개 · 판매액 ${man(e?.rev)}원</p>
            <div class="chips2">${e?.hot ? `<span>🔥 전환율 상위 ${e.hot}</span>` : ""}<span>🟢 광고 여유 ${e?.adGo ?? 0}</span><span>🟡 빠듯 ${e?.adWarn ?? 0}</span><span>🔴 적자 ${e?.adStop ?? 0}</span></div>
            <small>클릭하면 바로 결과로</small>`;
          root.appendChild(box);
          sparks(box);
          const fin = () => { clearTimeout(t); ctl.close(); setTimeout(resolve, 300); };
          const t = setTimeout(fin, st.skip ? 0 : 1700);
          box.onclick = fin;
        }
      },
      fail(msg) {
        if (st.closed) return;
        const box = document.createElement("div");
        box.className = "ais-done fail";
        box.innerHTML = `<div class="ais-check"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></div>
          <h3>분석 중단</h3><p>${esc(msg || "검색하지 못했습니다.")}</p><small>클릭하면 닫힙니다</small>`;
        root.appendChild(box);
        const t = setTimeout(() => ctl.close(), 4000);
        box.onclick = () => { clearTimeout(t); ctl.close(); };
      },
      close(now) {
        if (st.closed) return;
        st.closed = true; cancelAnimationFrame(raf);
        if (cur === ctl) cur = null;
        if (now) return root.remove();
        root.classList.add("out");
        setTimeout(() => root.remove(), 350);
      },
    };
    q(".ais-skip").onclick = () => { if (st.phase === "B") st.skip = true; else ctl.close(); };
    cur = ctl;
    return ctl;
  }

  // 완료 순간 초록 불꽃
  function sparks(box) {
    const cols = ["#3ddc84", "#a6ffcf", "#5ccfe6", "#ffcc4d"];
    const r = box.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2 - 60;
    for (let k = 0; k < 26; k++) {
      const s = document.createElement("i");
      s.className = "ais-spark";
      s.style.cssText = `left:${cx}px;top:${cy}px;background:${cols[k % cols.length]}`;
      box.appendChild(s);
      const a = (k / 26) * Math.PI * 2, d = 70 + Math.random() * 90;
      s.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(.3)`, opacity: 0 }],
        { duration: 700 + Math.random() * 400, easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" });
    }
  }

  // ── 발표 모드가 아닐 때: 패널 위쪽 진행 띠 (키워드 DB → Wing 판매 지표 → 쿠팡 쿠폰가 → 광고 판정) ──
  function startBar(keyword) {
    const bar = document.getElementById("runbar");
    if (!bar) return null;
    const STEPS = ["키워드 DB", "Wing 판매 지표", "쿠팡 쿠폰가", "광고 판정"];
    const stepsEl = document.getElementById("rbSteps"), msEl = document.getElementById("rbMs"), spEl = document.getElementById("rbSpin"), prEl = document.getElementById("rbProg");
    stepsEl.innerHTML = STEPS.map((t, i) => `${i ? "<em>›</em>" : ""}<i>${esc(t)}</i>`).join("");
    const chips = [...stepsEl.querySelectorAll("i")];
    const st = { k: -1, closed: false, t0: performance.now() };
    const set = (k, cls = "on") => {
      st.k = k;
      chips.forEach((c, i) => { c.className = i < k ? "done" : i === k ? cls : ""; });
      prEl.style.width = `${((k + (cls === "done" ? 1 : 0.5)) / STEPS.length) * 100}%`;
    };
    bar.hidden = false;
    set(0);
    let raf;
    const tick = (now) => {
      if (st.closed) return;
      spEl.textContent = SPIN[Math.floor(now / 80) % SPIN.length];
      msEl.textContent = ((now - st.t0) / 1000).toFixed(2) + "s";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const ctl = {
      db() { if (st.k < 1) set(1); },
      console(_cls, text) { if (/✔ \d+페이지/.test(text) && st.k < 1) set(1); },
      note(cls, _html, liveText) {
        if (liveText && /쿠팡/.test(liveText)) set(2);
        else if (cls === "go" || cls === "warn") set(2, "done");
      },
      analyze() {
        if (st.closed) return Promise.resolve();
        set(3);
        return new Promise((resolve) => setTimeout(() => { set(3, "done"); chips.forEach((c) => (c.className = "done")); prEl.style.width = "100%"; setTimeout(() => ctl.close(), 700); resolve(); }, 350));
      },
      fail(msg) {
        if (st.closed) return;
        set(Math.max(0, st.k), "fail");
        chips[Math.max(0, st.k)].title = msg || "";
        setTimeout(() => ctl.close(), 3000);
      },
      close() {
        if (st.closed) return;
        st.closed = true; cancelAnimationFrame(raf);
        bar.hidden = true; prEl.style.width = "0";
        if (cur === ctl) cur = null;
      },
    };
    cur = ctl;
    return ctl;
  }

  window.AiScan = { start, get current() { return cur; } };
})();
