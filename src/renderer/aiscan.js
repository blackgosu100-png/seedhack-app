// 🔎 진행 화면 — 씨드핵 "시그널 스캔"
//  · 발표 모드: 앱 창 전체를 덮는 해커 화면. 큰 상품 카드가 휘리릭 넘어가며 GO/HOLD/DROP 도장, 아래 필름 띠, 바닥 미니맵, 왼쪽 신호등, 오른쪽 숫자
//     - 키워드 분석: AiScan.start(keyword, pages) → db · console · note · analyze(items, e) · fail
//     - 카테고리 진단: AiScan.diagnose(path) → run(d) · fail   (d = Wing 인기상품 판정 결과: items · checks · verdict · yuan …)
//  · 평소(키워드 분석): 위쪽 진행 띠(스캔 › 검증 › 계산 › 포착)만. 카테고리 진단은 평소엔 화면 연출 없이 오른쪽 칸 그대로
// 숫자·로그·도장은 실제 값만 쓴다: 대기 중엔 실제 경과 시간·Wing 진행 로그, 응답이 오면 받은 상품을 빠르게 훑으며 보여 준다.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = (n) => (n == null || !Number.isFinite(+n) ? "-" : Math.round(n).toLocaleString("ko-KR"));
  const man = (n) => (n == null || !Number.isFinite(+n) ? "-" : n >= 1e8 ? (n / 1e8).toFixed(1) + "억" : n >= 1e4 ? Math.round(n / 1e4).toLocaleString("ko-KR") + "만" : won(n));
  const pct = (v) => (v == null || !Number.isFinite(+v) ? "-" : (v * 100).toFixed(1) + "%");
  const clock = () => new Date().toLocaleTimeString("en-GB");
  const IMG = "https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/";
  const imgUrl = (p) => (!p ? "" : /^https?:/.test(p) ? p : IMG + String(p).replace(/^\//, ""));
  const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const SG = { go: "g", warn: "y", stop: "r" }, SN = { go: "GO", warn: "HOLD", stop: "DROP" };
  const VN = { g: "GO", y: "HOLD", r: "DROP" };
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const present = () => document.body.classList.contains("present");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let cur = null;

  // ── 공통 화면 틀: 명령어 줄 · 신호등 · 4단계 · 사진 릴 · 필름 · 미니맵 · 한 줄 · 오른쪽 숫자 4개 · 기록 · 결과 ──
  // stats: [[key, LABEL, 설명, 숫자 모양(fn), big?]]
  function shell({ cmdPlain, cmdHtml, stages, stats, waiting, focusName }) {
    const root = document.createElement("div");
    root.className = "sc";
    root.innerHTML = `
      <div class="sc-top"><span class="sc-logo">SEED<b>HACK</b><i></i></span><span class="sc-cmd"></span><span class="sc-live"><b>LIVE</b><span class="sc-clock"></span></span></div>
      <div class="sc-body">
        <div class="sc-left"><div class="lamp"><i></i><i></i><i></i></div><div class="sc-verdict"><span>MARKET SIGNAL</span><strong>···</strong></div></div>
        <div class="sc-mid">
          <div class="stages">${stages.map(([n, s], i) => `<div class="stg"><span>0${i + 1} ${esc(n)}<em>${esc(s)}</em></span><i><b></b></i></div>`).join("")}</div>
          <div class="reel">
            <div class="focus"><div class="f-im"></div><div class="f-bd"><div class="f-no"></div><div class="f-nm">${esc(focusName)}</div><div class="f-mt"></div><div class="stamp"></div></div></div>
            <div class="film"></div>
            <div class="checks" hidden></div>
          </div>
          <div class="mini"></div>
          <div class="ticker"></div>
        </div>
        <div class="sc-right">
          ${stats.map(([k, l, s, , big]) => `<div class="st2 ${big ? "big" : ""}" data-k="${k}"><span>${esc(l)}<em>${esc(s)}</em></span><strong>-</strong></div>`).join("")}
          <div class="minilog"></div>
        </div>
      </div>
      <div class="sc-foot"><span>ELAPSED <b class="sc-ms">00.00s</b></span><span>ITEMS <b class="sc-n">0</b></span><span class="sp"></span><button type="button" class="sc-skip">ESC 건너뛰기 ›</button></div>
      <div class="sc-done"><div class="kick"></div><h3></h3><p></p><div class="chips2"></div><div class="picks"></div><div class="slogan">SEEDHACK_ · 매일 한 톨, 시스템처럼.</div></div>`;
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    const stg = [...root.querySelectorAll(".stg")], lamps = [...q(".lamp").children];
    const fmt = Object.fromEntries(stats.map(([k, , , f]) => [k, f || won]));
    const statEl = Object.fromEntries([...root.querySelectorAll("[data-k]")].map((d) => [d.dataset.k, d]));
    const S = {
      root, q, t0: performance.now(), tl: performance.now(), stage: 0, sp: 0, chase: true, phase: "A", skip: false, closed: false, waiting,
      stats: Object.fromEntries(stats.map(([k]) => [k, [0, null]])), onClose: null,
    };
    S.log = (cls, text) => {
      const p = document.createElement("p"); p.className = cls || ""; p.textContent = text;
      q(".minilog").appendChild(p);
      while (q(".minilog").childElementCount > 24) q(".minilog").firstChild.remove();
    };
    S.ticker = (html) => (q(".ticker").innerHTML = html);
    S.set = (k, v) => { const s = S.stats[k]; if (!s) return; s[1] = v; if (s[0] === v) statEl[k].querySelector("strong").textContent = fmt[k](v); };
    S.wait = (ms) => (S.skip ? Promise.resolve() : sleep(ms));
    S.cells = (n) => { const m = q(".mini"); m.innerHTML = ""; for (let i = 0; i < n; i++) { const c = document.createElement("i"); c.className = "cell live"; m.appendChild(c); } q(".sc-n").textContent = n; return [...m.children]; };
    S.addCells = (n) => { const m = q(".mini"); for (let i = 0; i < n; i++) { const c = document.createElement("i"); c.className = "cell live"; m.appendChild(c); } };
    // 큰 카드 한 장 넘기기 + 도장 + 필름 띠
    // glyph: 사진이 없는 항목(키워드 등)은 📦 대신 이 글자를 크게
    S.reel = ({ img, sig, no, name, meta, stamp, light = true, glyph = "" }) => {
      const u = imgUrl(img), im = q(".f-im"), st = q(".stamp"), ph = glyph ? `<span class="kwg">${esc(glyph)}</span>` : "📦";
      if (light) {
        im.innerHTML = u ? `<img src="${esc(u)}" alt="">` : ph;
        im.className = "f-im " + sig; void im.offsetWidth; im.classList.add("swap");
        q(".f-no").textContent = no; q(".f-nm").textContent = name || ""; q(".f-mt").innerHTML = meta;
        st.textContent = stamp; st.className = "stamp " + sig; void st.offsetWidth; st.classList.add("on");
        const th = document.createElement("div"); th.className = sig; th.innerHTML = `${u ? `<img src="${esc(u)}" alt="">` : ph}<i>${esc(stamp)}</i>`;
        q(".film").appendChild(th);
        while (q(".film").childElementCount > 14) q(".film").firstChild.remove();
      }
    };
    S.lamp = (vc, label) => {
      S.chase = false;
      lamps.forEach((l, j) => (l.className = ["r", "y", "g"][j] === vc ? vc : ""));
      q(".sc-verdict strong").className = vc; q(".sc-verdict strong").textContent = label ?? VN[vc] ?? "—";
    };
    // 결과 화면: 큰 글씨 + 칩 + 카드 5개(큰 사진 자리에서 떠오름). 클릭·시간이 지나면 닫힘
    S.done = async ({ kick, title, sub, chips = [], picks = [], fail = false, hold = 2400 }) => {
      const done = q(".sc-done");
      q(".sc-done .kick").textContent = kick; q(".sc-done h3").innerHTML = title; q(".sc-done p").textContent = sub;
      q(".chips2").innerHTML = chips.map(([cls, t]) => `<span class="${cls}">${esc(t)}</span>`).join("");
      q(".picks").innerHTML = picks.map((p) => { const u = imgUrl(p.img); return `<div class="pick"><div class="im">${u ? `<img src="${esc(u)}" alt="">` : p.glyph ? `<span class="kwg">${esc(p.glyph)}</span>` : "📦"}<b class="${p.sig || "g"}">${esc(p.badge || "GO")}</b></div><div class="bd"><div class="nm">${esc(p.name)}</div><div class="mt">${p.l1}</div><div class="mt">${p.l2}</div></div></div>`; }).join("");
      const from = q(".f-im").getBoundingClientRect();
      done.classList.toggle("fail", fail);
      done.classList.add("on");
      [...q(".picks").children].forEach((p, j) => {
        const to = p.getBoundingClientRect();
        p.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(.6)`, opacity: 0 }, { transform: "none", opacity: 1 }],
          { duration: 420, delay: j * 60, easing: "cubic-bezier(.2,.9,.25,1)", fill: "backwards" });
      });
      await new Promise((resolve) => { const t = setTimeout(resolve, S.skip ? 400 : hold); done.onclick = () => { clearTimeout(t); resolve(); }; });
      S.close();
      await sleep(350);
    };
    S.close = (now) => {
      if (S.closed) return;
      S.closed = true; cancelAnimationFrame(raf);
      removeEventListener("keydown", onKey);
      S.onClose?.();
      if (now) return root.remove();
      root.classList.add("out");
      setTimeout(() => root.remove(), 380);
    };
    // 명령어 한 줄(빠르게)
    (async () => {
      for (let c = 2; c <= cmdPlain.length && !S.closed; c += 4) { q(".sc-cmd").textContent = cmdPlain.slice(0, c); await sleep(10); }
      if (!S.closed) q(".sc-cmd").innerHTML = cmdHtml + '<span class="cur"></span>';
    })();
    let raf;
    const frame = (now) => {
      if (S.closed) return;
      q(".sc-clock").textContent = clock();
      q(".sc-ms").textContent = ((now - S.t0) / 1000).toFixed(2).padStart(5, "0") + "s";
      if (S.chase) lamps.forEach((l, j) => (l.className = Math.floor(now / 90) % 3 === j ? ["r", "y", "g"][j] : ""));
      // 응답 대기(실제 기다리는 시간): 단계 막대가 90%까지 시간에 따라 천천히, 아래 줄에 경과 시간
      if (S.phase === "A") {
        if (!S.fixed) S.sp = Math.min(0.9, (now - S.tl) / 5000);
        const tm = S.until ? `${Math.max(0, (S.until - now) / 1000).toFixed(1)}s 남음` : `${((now - S.tl) / 1000).toFixed(2)}s`; // until: 카운트다운(요청 간격 대기)
        S.ticker(`<span class="p">&gt;</span> ${esc(stages[S.stage]?.[0] || "")} <span class="d">·</span> ${esc(S.waiting)} <span class="d">${SPIN[Math.floor(now / 80) % SPIN.length]} ${tm}</span>`);
      }
      for (const k in S.stats) {
        const s = S.stats[k];
        if (s[1] == null) continue;
        const d = s[1] - s[0];
        if (d) { s[0] = Math.abs(d) < 0.05 ? s[1] : s[0] + d * 0.2; statEl[k].querySelector("strong").textContent = fmt[k](Math.abs(s[1] - s[0]) < 0.05 ? s[1] : s[0]); statEl[k].classList.add("tick"); }
        else statEl[k].classList.remove("tick");
      }
      stg.forEach((x, j) => { x.className = "stg" + (j < S.stage ? " done" : j === S.stage ? " on" : ""); x.querySelector("b").style.width = (j < S.stage ? 100 : j === S.stage ? S.sp * 100 : 0) + "%"; });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onKey = (e) => { if (e.key === "Escape") S.skip = true; };
    addEventListener("keydown", onKey);
    q(".sc-skip").onclick = () => { if (S.phase === "B") S.skip = true; else S.close(); };
    return S;
  }

  // ── 🔎 키워드 분석 ──
  function start(keyword, pages = 1) {
    cur?.close(true);
    if (!present()) return startBar(keyword);
    if (reduce()) return null;
    const S = shell({
      cmdPlain: `seedhack ~ scan "${keyword}" --pages ${pages} --coupon`,
      cmdHtml: `<span class="p">seedhack</span> ~ scan <span class="kw">"${esc(keyword)}"</span> <span class="fl">--pages ${pages} --coupon</span>`,
      stages: [["스캔", "검색량 · Wing"], ["검증", "판매 · 전환"], ["계산", "쿠폰가 · 마진"], ["포착", "시그널"]],
      stats: [["vol", "SEARCH", "네이버 월검색"], ["rev", "MARKET 28D", "28일 판매액", man], ["cp", "COUPON", "쿠폰가 확인"], ["go", "SALES 28D", "28일 판매 개수", won, true]],
      waiting: "Wing 상품 매칭 응답 대기", focusName: "Wing 상품 매칭 연결 중",
    });
    let found = 0;
    S.set("rev", 0); S.set("cp", 0); S.set("go", 0);
    S.log("c", `> scan "${keyword}"`);
    const ctl = {
      kind: "kw",
      db(db) {
        if (S.closed) return;
        const m = db?.main;
        if (m?.m1 != null) { S.set("vol", m.m1); S.log("g", `✔ 네이버 월검색 ${won(m.m1)} · 연관 키워드 ${db.subs?.length || 0}`); }
        else S.log("", "· 제휴 키워드 DB에 없는 키워드 — 쿠팡 지표로 스캔");
      },
      // 메인 프로세스 진행 로그(실제 이벤트) — 쿠팡 화면 진단 로그(dim)는 빼고
      console(cls, text) {
        if (S.closed || S.phase !== "A" || cls === "dim") return;
        S.log(cls === "go" ? "g" : cls === "sys" ? "c" : cls === "warn" ? "y" : "w", text);
        const m = /✔ (\d+)페이지 · 상품 (\d+)개/.exec(text);
        if (m) { found += +m[2]; S.q(".sc-n").textContent = found; S.addCells(+m[2]); S.stage = 1; S.tl = performance.now(); S.waiting = `Wing ${m[1]}페이지 판매 지표 수신`; S.q(".f-nm").textContent = `상품 ${found}개 수신`; }
        else if (/↗/.test(text)) S.waiting = text.replace(/^↗\s*/, "") + " · 응답 대기";
        else if (/재사용/.test(text)) S.waiting = "저장된 결과 불러오는 중";
      },
      // 화면 쪽 진행(쿠폰가 확인 등)
      note(cls, html, liveText) {
        if (S.closed) return;
        const text = String(html).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
        S.log(cls === "go" ? "g" : cls === "warn" ? "y" : "c", text);
        if (liveText) { S.stage = 2; S.tl = performance.now(); S.waiting = liveText; S.q(".f-nm").textContent = "쿠팡 화면에서 쿠폰가 확인 중"; }
        const m = /쿠폰가 반영 (\d+)\//.exec(text);
        if (m) S.set("cp", +m[1]);
      },
      // 받은 상품을 휘리릭 훑기 → 신호등 판정 → GO 상위 5개 → 사라짐
      async analyze(items, e) {
        if (S.closed) return;
        S.phase = "B";
        const N = items.length, cells = S.cells(N);
        const per = Math.max(18, Math.min(60, 2400 / Math.max(1, N)));
        let rev = 0, go = 0, cp = 0;
        for (let k = 0; k < N && !S.closed; k++) {
          const it = items[k], sg = SG[it.ad] || "n", f = k / N, price = it.ex?.price ?? it.price;
          S.stage = f < 0.34 ? 1 : f < 0.67 ? 2 : 3;
          S.sp = S.stage === 1 ? f / 0.34 : S.stage === 2 ? (f - 0.34) / 0.33 : (f - 0.67) / 0.33;
          rev += it.rev || 0; S.set("rev", rev);
          if (it.priceSrc === "now" || it.priceSrc === "seen") { cp++; if (cp > (S.stats.cp[1] || 0)) S.set("cp", cp); }
          go += it.ex?.sales || 0; S.set("go", go); // 판정(GO)은 두지 않음 — 28일 판매 개수 합
          S.reel({ light: !S.skip || k === N - 1, img: it.img, sig: sg, no: `#${String(k + 1).padStart(2, "0")} / ${N}`, name: it.name, stamp: SN[it.ad] || "—",
            meta: `<span>${it.priceSrc === "wing" ? "판매가" : "쿠폰가"}<b class="${it.priceSrc === "wing" ? "" : "cp"}">₩${won(price)}</b></span><span>28일 판매<b>${won(it.ex?.sales)}</b></span><span>전환<b>${pct(it.cvr)}</b></span>` });
          if (!S.skip) {
            S.ticker(`<span class="p">&gt;</span> ${["스캔", "검증", "계산", "포착"][S.stage]} <span class="d">#${String(k + 1).padStart(2, "0")}</span> ${esc((it.name || "").slice(0, 40))} <span class="d">→</span> <span class="${sg}">${SN[it.ad] || "지표 없음"}</span>`);
            if (k % 6 === 0) S.log(sg === "g" ? "g" : sg === "y" ? "y" : "w", `${(SN[it.ad] || "—").padEnd(4)} ${(it.name || "").slice(0, 12)} · ₩${won(price)} · 전환 ${pct(it.cvr)}`);
          }
          cells[k].className = "cell " + sg;
          await S.wait(k < 6 ? 110 : per); // 처음 몇 개는 읽히게, 그다음은 휘리릭
        }
        if (S.closed) return;
        // 시장 시그널: 지표가 있는 상품 중 GO 비율
        S.stage = 4;
        S.lamp("");
        S.log("g", `■ 28일 판매 ${won(go)}개 · 판매액 ${man(e?.rev)}원`);
        S.ticker(`<span class="g">■</span> 분석 완료 <span class="d">· 28일 판매 ${won(go)}개 · 지표는 참고용, 원가를 넣어 순이익으로 판단</span>`);
        await S.wait(350);
        const top = items.filter((it) => it.rev).sort((a, b) => (b.rev || 0) - (a.rev || 0)).slice(0, 5);
        await S.done({
          kick: "SCAN COMPLETE",
          title: `<b>판매액 상위 ${top.length}개</b>`,
          sub: `'${keyword}' 상품 ${N}개 · 28일 판매액 ${man(e?.rev)}원 · 쿠폰가 기준 — ☆ 담으면 1688 원가로 경쟁사 순이익 계산`,
          picks: top.map((it) => ({ img: it.img, name: it.name, l1: `₩${won(it.ex?.price ?? it.price)} · <b>${man(it.rev)}</b>`, l2: `전환 ${pct(it.cvr)} · 판매 ${won(it.ex?.sales)}` })),
        });
      },
      fail(msg) { failScreen(S, "SCAN STOPPED", "스캔 중단", msg); },
      close(now) { S.close(now); },
    };
    S.onClose = () => { if (cur === ctl) cur = null; };
    cur = ctl;
    return ctl;
  }

  // ── 🚦 카테고리 진단 (발표 모드만) ──
  // 고르는 순간 diagnose(path)로 띄워 Wing 응답을 기다리고, 판정 결과가 오면 run(d)
  function diagnose(path) {
    if (!present() || reduce()) return null;
    if (cur?.kind === "cat" && !cur.started) { cur.retitle(path); return cur; }
    cur?.close(true);
    const label = String(path || "카테고리").replace(/\s*>\s*/g, " › ");
    const short = label.split(" › ").slice(-2).join(" › ");
    const mk = (p) => ({
      cmdPlain: `seedhack ~ diagnose "${p}" --top 60`,
      cmdHtml: `<span class="p">seedhack</span> ~ diagnose <span class="kw">"${esc(p)}"</span> <span class="fl">--top 60</span>`,
    });
    const S = shell({
      ...mk(short),
      stages: [["수집", "Wing 인기상품"], ["경쟁", "리뷰 · 순위"], ["수요", "28일 조회"], ["진단", "기준 체크"]],
      stats: [["total", "CATEGORY", "전체 상품"], ["open", "LOW REVIEW", "리뷰 100 미만"], ["target", "TARGET", "목표 판매가", (v) => "₩" + won(v)], ["yuan", "SOURCING", "1688 허용 소싱가", (v) => "¥" + (Math.round(v * 10) / 10).toFixed(1), true]],
      waiting: "Wing 인기상품 응답 대기", focusName: label,
    });
    S.log("c", `> diagnose "${label}"`);
    // Wing 응답이 오지 않으면(로그인 풀림·차단 등) 30초 뒤 안내하고 닫는다
    setTimeout(() => { if (!ctl.started && !S.closed) ctl.fail("Wing 인기상품 응답이 없습니다 — Wing 로그인 상태를 확인해 주세요"); }, 30000);
    const ctl = {
      kind: "cat", started: false,
      retitle(p) { const l = String(p || "").replace(/\s*>\s*/g, " › "); S.q(".f-nm").textContent = l; S.log("c", `> diagnose "${l}"`); },
      async run(d) {
        if (S.closed) return;
        ctl.started = true; S.phase = "B";
        const items = d.items || [], N = items.length, cells = S.cells(N);
        S.set("total", d.total || N); S.set("open", 0);
        S.log("g", `✔ Wing 인기상품 ${won(d.total)}개 중 상위 ${N}개 · ${d.mode === "big" ? "큰 시장 기준" : "틈새 기준"}`);
        const per = Math.max(18, Math.min(55, 2100 / Math.max(1, N)));
        let open = 0;
        for (let k = 0; k < N && !S.closed; k++) {
          const it = items[k], sg = SG[it.light] || "n", f = k / N;
          S.stage = f < 0.5 ? 1 : 2; S.sp = S.stage === 1 ? f / 0.5 : (f - 0.5) / 0.5;
          if ((it.reviews ?? 0) < 100) { open++; S.set("open", open); }
          const views = it.ex?.views != null ? won(it.ex.views) : it.pvHi != null ? `~${won(it.pvHi)}` : "-";
          S.reel({ light: !S.skip || k === N - 1, img: it.img, sig: sg, no: `${it.order}위 / ${N}`, name: it.name, stamp: SN[it.light] || "—",
            meta: `<span>판매가<b>₩${won(it.price)}</b></span><span>리뷰<b>${won(it.reviews)}</b></span><span>28일 조회<b>${views}</b></span>` });
          if (!S.skip) {
            S.ticker(`<span class="p">&gt;</span> ${S.stage === 1 ? "경쟁" : "수요"} <span class="d">${it.order}위</span> ${esc((it.name || "").slice(0, 40))} <span class="d">· 리뷰 ${won(it.reviews)} →</span> <span class="${sg}">${SN[it.light] || "—"}</span>`);
            if (k % 8 === 0) S.log(sg === "g" ? "g" : sg === "y" ? "y" : "w", `${String(it.order).padStart(2, " ")}위 리뷰 ${won(it.reviews)} · ${(it.name || "").slice(0, 12)}`);
          }
          cells[k].className = "cell " + sg;
          await S.wait(k < 5 ? 110 : per);
        }
        if (S.closed) return;
        // 기준 체크: 한 줄씩 PASS / FAIL
        S.stage = 3; S.sp = 0;
        const box = S.q(".checks"), checks = d.checks || [];
        S.q(".focus").hidden = true; S.q(".film").hidden = true; box.hidden = false;
        for (let i = 0; i < checks.length && !S.closed; i++) {
          const c = checks[i], r = c.pass === true ? ["g", "PASS"] : c.pass === false ? ["r", "FAIL"] : ["n", "N/A"];
          const row = document.createElement("div"); row.className = "ck " + r[0];
          row.innerHTML = `<b>[${r[1]}]</b><span>${esc(c.label)}</span><em>${esc(c.need || "")}</em>`;
          box.appendChild(row);
          S.sp = (i + 1) / checks.length;
          S.ticker(`<span class="p">&gt;</span> 진단 <span class="d">${i + 1}/${checks.length}</span> ${esc(c.label)} <span class="${r[0]}">${r[1]}</span>`);
          S.log(r[0] === "g" ? "g" : r[0] === "r" ? "y" : "w", `[${r[1]}] ${c.label}`);
          await S.wait(260);
        }
        if (S.closed) return;
        S.stage = 4;
        if (d.target) S.set("target", d.target);
        if (d.yuan > 0) S.set("yuan", d.yuan);
        const vc = { GO: "g", 검토: "y", "큰 시장": "y", DROP: "r" }[d.verdict] || "y";
        S.lamp(vc);
        const pass = checks.filter((c) => c.pass === true).length;
        S.ticker(`<span class="g">■</span> 시장 시그널 <span class="${vc}">${VN[vc]}</span> <span class="d">· 기준 ${pass}/${checks.length} 통과${d.yuan > 0 ? ` · 1688 ¥${d.yuan.toFixed(1)} 이하` : ""}</span>`);
        await S.wait(500);
        const picks = items.filter((it) => it.light === "go").slice(0, 5);
        await S.done({
          kick: "DIAGNOSIS COMPLETE",
          title: `시장 시그널 <b class="${vc}">${VN[vc]}</b>`,
          sub: `${label} · 기준 ${pass}/${checks.length} 통과 · ${d.yuan > 0 ? `1688 허용 소싱가 ¥${d.yuan.toFixed(1)} 이하 · 목표가 ₩${won(d.target)}` : "이 가격대로는 남는 원가가 없습니다"}`,
          chips: checks.map((c) => [c.pass === true ? "g" : c.pass === false ? "r" : "n", `${c.pass === true ? "✓" : c.pass === false ? "✕" : "?"} ${c.label}`]),
          picks: picks.map((it) => ({ img: it.img, name: it.name, badge: `${it.order}위`, l1: `₩${won(it.price)} · 리뷰 <b>${won(it.reviews)}</b>`, l2: `28일 조회 ${it.ex?.views != null ? won(it.ex.views) : it.pvHi != null ? "~" + won(it.pvHi) : "-"}` })),
          hold: 3000,
        });
      },
      fail(msg) { failScreen(S, "DIAGNOSIS STOPPED", "진단 중단", msg); },
      close(now) { S.close(now); },
    };
    S.onClose = () => { if (cur === ctl) cur = null; };
    cur = ctl;
    return ctl;
  }

  // ── 🎯 Wing 판매량 받기 (발표 모드만) ──
  // list: 조회할 상품(이 순서로 조회) [{key, img, name, order, price, reviews}], label: 카테고리 이름
  // 진행: progress({pos,total,status,msg}) — "↗ 조회 시작" · "✔/✕/재사용 끝" · done/stopped/paused, item(it) — 받은 지표가 반영된 상품(ad·cvr 계산 후)
  function exact(list, label = "") {
    if (!present() || reduce() || !list?.length) return null;
    cur?.close(true);
    const N = list.length, name = String(label || "카테고리").replace(/\s*>\s*/g, " › ").split(" › ").slice(-2).join(" › ");
    const S = shell({
      cmdPlain: `seedhack ~ pull --wing --sales28d "${name}" --top ${N}`,
      cmdHtml: `<span class="p">seedhack</span> ~ pull <span class="fl">--wing --sales28d</span> <span class="kw">"${esc(name)}"</span> <span class="fl">--top ${N}</span>`,
      stages: [["대기열", "상위 상품"], ["Wing 조회", "28일 판매 · 조회"], ["전환율", "판매 ÷ 조회"], ["시그널", "광고해도 남는가"]],
      stats: [["got", "RECEIVED", "받은 상품"], ["sales", "SALES 28D", "28일 판매 합"], ["cvr", "CVR", "평균 전환율", (v) => (v * 100).toFixed(1) + "%"], ["go", "HOT CVR", "전환율 상위 상품", won, true]],
      waiting: "Wing 연결 · 요청 간격 4초", focusName: `상위 ${N}개 판매량 받기`,
    });
    const cells = S.cells(N), idx = new Map(list.map((x, i) => [x.key, i])), got = new Map();
    S.set("got", 0); S.set("sales", 0); S.set("go", 0);
    S.fixed = true; S.stage = 0; S.sp = 0;
    S.log("c", `> pull "${name}" · ${N}개 · 요청 간격 4초(쿠팡 보안)`);
    const film = (it, sg, stamp) => {
      const th = document.createElement("div"); const u = imgUrl(it.img); th.className = sg; th.innerHTML = `${u ? `<img src="${esc(u)}" alt="">` : "📦"}<i>${esc(stamp)}</i>`;
      S.q(".film").appendChild(th); while (S.q(".film").childElementCount > 14) S.q(".film").firstChild.remove();
    };
    const show = (it, sg, stamp, meta, no) => {
      const u = imgUrl(it.img), im = S.q(".f-im"), st = S.q(".stamp");
      im.innerHTML = u ? `<img src="${esc(u)}" alt="">` : "📦"; im.className = "f-im " + sg; void im.offsetWidth; im.classList.add("swap");
      S.q(".f-no").textContent = no; S.q(".f-nm").textContent = it.name || ""; S.q(".f-mt").innerHTML = meta;
      st.textContent = stamp; st.className = "stamp " + sg; void st.offsetWidth; st.classList.add("on");
    };
    const totals = () => {
      const v = [...got.values()];
      const sales = v.reduce((a, x) => a + (x.ex?.sales || 0), 0), views = v.reduce((a, x) => a + (x.ex?.views || 0), 0);
      S.set("got", got.size); S.set("sales", sales); if (views) S.set("cvr", sales / views);
      S.set("go", v.filter((x) => x.hot === "hot").length);
    };
    const ctl = {
      kind: "exact",
      progress({ pos, total, status, msg }) {
        if (S.closed) return;
        const m = String(msg || "");
        if (status === "done") return ctl.finish();
        if (status === "stopped" || status === "paused") return failScreen(S, "PULL STOPPED", status === "stopped" ? "판매량 받기 중지" : "판매량 받기 일시 정지", m);
        if (/^↗/.test(m)) { // 조회 시작: 이 상품 사진에 QUERY 도장, 실제 응답 대기 시간이 흐른다
          const it = list[pos] || {};
          S.stage = 1; S.sp = pos / N; S.phase = "A"; S.until = 0; S.tl = performance.now(); S.waiting = `Wing 상품 매칭 조회 #${it.order ?? pos + 1}위 · 응답 대기`;
          if (cells[pos]) cells[pos].className = "cell live q";
          show(it, "c", "QUERY", `<span>판매가<b>₩${won(it.price)}</b></span><span>리뷰<b>${won(it.reviews)}</b></span><span>28일 판매<b>…</b></span>`, `${it.order ?? pos + 1}위 · ${pos + 1} / ${N}`);
          S.log("c", `↗ ${it.order ?? pos + 1}위 ${(it.name || "").slice(0, 16)}`);
        } else if (/^✔|^✕|재사용/.test(m)) { // 한 개 끝: 다음 요청까지 4초 카운트다운
          S.sp = pos / N;
          if (/^✕/.test(m)) { const i = pos - 1; if (cells[i]) cells[i].className = "cell r"; S.log("y", m.slice(0, 40)); }
          if (pos < total) { S.phase = "A"; S.until = performance.now() + (/재사용/.test(m) ? 300 : 4000); S.waiting = /재사용/.test(m) ? "최근 조회값 재사용" : "다음 요청까지 · 쿠팡 보안 간격"; }
        }
      },
      // 받은 지표(전환율·시그널 계산 후)
      item(it) {
        if (S.closed || !it) return;
        const i = idx.get(it.key ?? "");
        if (i == null) return;
        got.set(it.key, it); totals();
        const sg = SG[it.ad] || "n", stamp = SN[it.ad] || "—";
        if (cells[i]) cells[i].className = "cell " + sg;
        show(it, sg, stamp, `<span>28일 판매<b>${won(it.ex?.sales)}</b></span><span>28일 조회<b>${won(it.ex?.views)}</b></span><span>전환<b class="cp">${pct(it.cvr)}</b></span>`, `${it.order ?? i + 1}위 · ${i + 1} / ${N}`);
        film(it, sg, stamp);
        S.log(sg === "g" ? "g" : sg === "y" ? "y" : "w", `${stamp.padEnd(4)} ${it.order ?? i + 1}위 판매 ${won(it.ex?.sales)} · 전환 ${pct(it.cvr)}`);
      },
      async finish() {
        if (S.closed || ctl.done) return;
        ctl.done = true; S.phase = "B"; S.stage = 4; S.until = 0;
        const v = [...got.values()], go = v.filter((x) => x.ad === "go").length, judged = v.filter((x) => x.ad).length;
        const share = judged ? go / judged : 0, vc = !judged ? "" : share >= 0.3 ? "g" : share >= 0.15 ? "y" : "r";
        S.lamp(vc);
        const sales = v.reduce((a, x) => a + (x.ex?.sales || 0), 0);
        S.ticker(`<span class="g">■</span> 판매량 ${got.size}/${N}개 수신 <span class="d">·</span> GO 시그널 <span class="${vc}">${go}개</span>`);
        await S.wait(400);
        const top = v.slice().sort((a, b) => (b.ex?.sales || 0) - (a.ex?.sales || 0)).slice(0, 5);
        await S.done({
          kick: "PULL COMPLETE",
          title: `<b>판매량 ${got.size}개</b> 수신 · GO ${go}`,
          sub: `${name} · 상위 ${N}개 28일 판매 합 ${won(sales)}개 · Wing 실데이터`,
          picks: top.map((it) => ({ img: it.img, name: it.name, sig: SG[it.ad] || "n", badge: SN[it.ad] || `${it.order}위`, l1: `판매 <b>${won(it.ex?.sales)}</b> · 전환 ${pct(it.cvr)}`, l2: `${it.order}위 · 조회 ${won(it.ex?.views)}` })),
        });
      },
      fail(msg) { failScreen(S, "PULL STOPPED", "판매량 받기 중단", msg); },
      close(now) { S.close(now); },
    };
    S.onClose = () => { if (cur === ctl) cur = null; };
    cur = ctl;
    return ctl;
  }

  // ── 📋 리스트업 엑셀 저장 (발표 모드만) ──
  // rows: [{name, img, keyword, yuan, price, margin, rate, sig: go|warn|stop|"", note}] — 리스트업 화면이 계산한 값 그대로
  // 저장 위치를 고르는 동안 시작 → saved(path) 면 실제로 저장된 행을 훑고 완료, cancel() 이면 조용히 닫힘
  function sheet(rows) {
    if (!present() || reduce() || !rows?.length) return null;
    cur?.close(true);
    const fin = (v) => (v != null && Number.isFinite(+v) ? +v : null);
    rows = rows.map((r) => ({ ...r, yuan: fin(r.yuan), price: fin(r.price), margin: fin(r.margin), rate: fin(r.rate) }));
    const N = rows.length, COLS = 27;
    const S = shell({
      cmdPlain: `seedhack ~ export --listup --rows ${N} --cols ${COLS} --xlsx`,
      cmdHtml: `<span class="p">seedhack</span> ~ export <span class="fl">--listup --rows ${N} --cols ${COLS}</span> <span class="kw">--xlsx</span>`,
      stages: [["저장 위치", "파일 이름"], ["엑셀 생성", "수식 · 서식"], ["행 기록", `${N}행 × ${COLS}열`], ["완료", "Finder"]],
      stats: [["rows", "ROWS", "저장한 상품"], ["rate", "MARGIN", "평균 마진율", (v) => (v * 100).toFixed(1) + "%"], ["profit", "PROFIT", "1개 마진 합", (v) => "₩" + won(v)], ["go", "GO", "남는 상품", won, true]],
      waiting: "저장할 곳을 고르세요", focusName: `리스트업 ${N}개 상품 → 엑셀`,
    });
    S.set("rows", 0); S.set("go", 0); S.set("profit", 0);
    S.log("c", `> export listup · ${N}개 상품 · 대표님 양식 ${COLS}열`);
    const ctl = {
      kind: "sheet",
      cancel() { if (!S.closed) { S.log("y", "저장 취소"); S.close(); } },
      async saved(path) {
        if (S.closed) return;
        const file = String(path || "").split(/[\\/]/).pop();
        S.stage = 1; S.sp = 1; S.log("g", `✔ 엑셀 생성 · ${file}`);
        await S.wait(250);
        S.phase = "B"; S.stage = 2; S.sp = 0;
        const cells = S.cells(N);
        let go = 0, profit = 0, rs = 0, rn = 0;
        for (let i = 0; i < N && !S.closed; i++) {
          const r = rows[i], sg = SG[r.sig] || "n", stamp = SN[r.sig] || "—";
          S.sp = (i + 1) / N;
          if (r.sig === "go") go++;
          if (r.margin != null) profit += r.margin;
          if (r.rate != null) { rs += r.rate; rn++; }
          S.set("rows", i + 1); S.set("go", go); S.set("profit", profit); if (rn) S.set("rate", rs / rn);
          S.reel({ light: !S.skip || i === N - 1, img: r.img, sig: sg, no: `ROW ${String(i + 2).padStart(3, "0")} · ${i + 1} / ${N}`, name: r.name || r.keyword || "", stamp,
            meta: `<span>위안<b class="cp">${r.yuan != null ? "¥" + r.yuan : "-"}</b></span><span>판매가<b>₩${won(r.price)}</b></span><span>마진<b>${r.margin != null ? "₩" + won(r.margin) : "-"}</b></span><span>마진율<b>${pct(r.rate)}</b></span>` });
          if (!S.skip) {
            S.ticker(`<span class="p">&gt;</span> 행 기록 <span class="d">ROW ${i + 2}</span> ${esc((r.name || "").slice(0, 34))} <span class="d">· A~AA ${COLS}칸 →</span> <span class="${sg}">${stamp}</span>`);
            S.log(sg === "g" ? "g" : sg === "y" ? "y" : "w", `ROW ${i + 2} ${(r.name || "").slice(0, 14)} · ${r.note || ""}`.slice(0, 60));
          }
          cells[i].className = "cell " + sg;
          await S.wait(i < 4 ? 140 : Math.max(40, Math.min(110, 1600 / N)));
        }
        if (S.closed) return;
        S.stage = 4;
        const share = N ? go / N : 0, vc = share >= 0.5 ? "g" : share >= 0.2 ? "y" : "r";
        S.lamp(vc);
        S.ticker(`<span class="g">■</span> 저장 완료 <span class="d">·</span> ${esc(file)} <span class="d">· ${N}행 × ${COLS}열</span>`);
        await S.wait(350);
        const top = rows.filter((r) => r.margin != null).sort((a, b) => (b.margin || 0) - (a.margin || 0)).slice(0, 5);
        await S.done({
          kick: "EXPORT COMPLETE",
          title: `<b>${N}행 × ${COLS}열</b> 저장`,
          sub: `${file} · GO ${go}개 · 계산 칸은 엑셀 수식 그대로 · Finder에서 열렸습니다`,
          picks: top.map((r) => ({ img: r.img, name: r.name, sig: SG[r.sig] || "n", badge: SN[r.sig] || "—", l1: `마진 <b>₩${won(r.margin)}</b> · ${pct(r.rate)}`, l2: `¥${r.yuan ?? "-"} → ₩${won(r.price)}` })),
        });
      },
      fail(msg) { failScreen(S, "EXPORT STOPPED", "엑셀 저장 실패", msg); },
      close(now) { S.close(now); },
    };
    S.onClose = () => { if (cur === ctl) cur = null; };
    cur = ctl;
    return ctl;
  }

  // ── 📦 수집함 → 리스트업 담기 (발표 모드만) ──
  // 상품 하나씩 실제 처리(키워드 DB · 1페이지 가격 · 리스트업 행 추가)에 맞춰 item(o, info)을 부르고, 끝나면 finish({added, skipped})
  function pick(total, query = "") {
    if (!present() || reduce() || !total) return null;
    cur?.close(true);
    const q = String(query || "").trim();
    const S = shell({
      cmdPlain: `seedhack ~ pick --from collect --to listup --items ${total}${q ? ` "${q}"` : ""}`,
      cmdHtml: `<span class="p">seedhack</span> ~ pick <span class="fl">--from collect --to listup --items ${total}</span>${q ? ` <span class="kw">"${esc(q)}"</span>` : ""}`,
      stages: [["선택", "수집함"], ["키워드 DB", "검색량 · 서브키워드"], ["가격 범위", "1페이지 최저·최고"], ["리스트업", "행 추가"]],
      stats: [["picked", "PICKED", "고른 상품"], ["sales", "SALES 28D", "28일 판매 합"], ["vol", "SEARCH", "키워드 월검색"], ["added", "ADDED", "리스트업에 담김", won, true]],
      waiting: "고른 상품 정리 중", focusName: `수집함 ${total}개 → 리스트업`,
    });
    const cells = S.cells(total);
    S.set("picked", total); S.set("sales", 0); S.set("added", 0);
    S.log("c", `> pick ${total}개 → 리스트업`);
    S.phase = "B"; S.stage = 1;
    let i = 0, sales = 0, added = 0;
    const done = [];
    const ctl = {
      kind: "pick",
      async item(o, info = {}) {
        if (S.closed || !o) return;
        const k = i++;
        S.sp = (k + 1) / total; S.stage = info.skip ? S.stage : k / total < 0.34 ? 1 : k / total < 0.67 ? 2 : 3;
        sales += o.sales || 0; S.set("sales", sales);
        if (info.db?.main?.m1 != null) S.set("vol", info.db.main.m1);
        const sg = info.skip ? "n" : SG[o.ad] || "c", stamp = info.skip ? "SKIP" : "ADDED";
        if (!info.skip) { added++; S.set("added", added); done.push(o); }
        S.reel({ light: !S.skip || k === total - 1, img: o.img, sig: sg, no: `${k + 1} / ${total}${o.query ? ` · ${o.query}` : ""}`, name: o.name, stamp,
          meta: `<span>판매가<b>₩${won(o.p ?? o.price)}</b></span><span>28일 판매<b>${won(o.sales)}</b></span><span>전환<b>${pct(o.cvr)}</b></span>${info.minPrice != null ? `<span>1페이지 가격<b class="cp">₩${won(info.minPrice)}~${won(info.maxPrice)}</b></span>` : ""}` });
        if (!S.skip) {
          S.ticker(`<span class="p">&gt;</span> ${["", "키워드 DB", "가격 범위", "리스트업"][S.stage] || "리스트업"} <span class="d">${k + 1}/${total}</span> ${esc((o.name || "").slice(0, 34))} <span class="d">→</span> <span class="${info.skip ? "n" : "g"}">${info.skip ? "이미 담김" : "행 추가"}</span>`);
          S.log(info.skip ? "w" : "g", `${info.skip ? "SKIP " : "+ ROW"} ${(o.name || "").slice(0, 14)}${info.db?.main?.m1 != null ? ` · 월검색 ${won(info.db.main.m1)}` : ""}`);
        }
        if (cells[k]) cells[k].className = "cell " + sg;
        await S.wait(k < 4 ? 160 : Math.max(50, Math.min(120, 1800 / total)));
      },
      async finish({ added: a = added, skipped = 0 } = {}) {
        if (S.closed) return;
        S.stage = 4; S.lamp(a ? "g" : "y", a ? "ADD" : "SKIP");
        S.ticker(`<span class="g">■</span> 리스트업에 ${a}개 담김${skipped ? ` <span class="d">· 이미 담긴 ${skipped}개 제외</span>` : ""}`);
        await S.wait(300);
        await S.done({
          kick: "PICK COMPLETE",
          title: a ? `<b>리스트업에 ${a}개</b> 담김` : "새로 담긴 상품 없음",
          sub: `${skipped ? `이미 담긴 ${skipped}개 제외 · ` : ""}이제 리스트업에서 1688 위안만 넣으면 마진이 계산됩니다`,
          picks: done.slice().sort((x, y) => (y.sales || 0) - (x.sales || 0)).slice(0, 5).map((o) => ({ img: o.img, name: o.name, sig: SG[o.ad] || "c", badge: SN[o.ad] || "ADD", l1: `판매 <b>${won(o.sales)}</b> · 전환 ${pct(o.cvr)}`, l2: `₩${won(o.p ?? o.price)}` })),
          hold: 2000,
        });
      },
      fail(msg) { failScreen(S, "PICK STOPPED", "담기 중단", msg); },
      close(now) { S.close(now); },
    };
    S.onClose = () => { if (cur === ctl) cur = null; };
    cur = ctl;
    return ctl;
  }

  // ── 💡 키워드 추천: 버튼을 누르면 키워드 DB를 불러와(실제 대기) 그룹별로 걸러진 후보를 휘리릭 훑고 → 상위 5개 ──
  //  ctl.run({ month, total, count, label, list }) — label = 고른 조건 조합, list = 조건에 맞는 추천순 상위(최대 40)
  // ── 💡 키워드 추천(AI 소싱): 깔때기를 단계마다 실제 개수로 보여 주고(무엇이 몇 개 빠졌는지) → 남은 후보를 훑고 → 상위 5개 ──
  //  ctl.run(res) — res = kw:scan 응답 { month, dbTotal, final, steps:[{label,count,cuts}], groups:{start,weak,rising} }
  function reco(dbLabel = "") {
    if (!present() || reduce()) return null;
    cur?.close(true);
    const S = shell({
      cmdPlain: `seedhack ~ source --db ${dbLabel || "latest"} --safe on --ai-check`,
      cmdHtml: `<span class="p">seedhack</span> ~ source <span class="fl">--db ${esc(dbLabel || "latest")} --safe on --ai-check</span>`,
      stages: [["키워드 DB", "팔리는 것만"], ["항상 제외", "브랜드·식품·화장품"], ["안전 필터", "인증·대형·각인·옷"], ["AI 검수", "초보가 들여올 수 있나"]],
      stats: [["all", "KEYWORDS", "쿠팡 키워드 DB"], ["left", "LEFT", "남은 키워드"], ["cut", "FILTERED", "걸러낸 키워드"], ["final", "PICKED", "따라 해 볼 키워드", won, true]],
      waiting: "키워드 DB 불러오는 중", focusName: "AI 소싱",
    });
    S.log("c", "> source: 쿠팡 키워드 DB 읽는 중");
    const ctl = {
      kind: "reco",
      async run(res) {
        if (S.closed) return;
        const steps = res.steps || [];
        S.set("all", res.dbTotal || 0); S.set("left", res.dbTotal || 0); S.set("cut", 0); S.set("final", 0);
        S.phase = "B";
        // ① 깔때기: 단계마다 남은 개수가 줄고, 빠진 이유가 기록에 찍힌다(전부 실제 값)
        const stageOf = { base: 0, lock: 1, safe: 2, ai: 3, budget: 3, cond: 3 };
        for (const st of steps.slice(1)) {
          if (S.closed) return;
          S.stage = stageOf[st.key] ?? 3; S.sp = 1;
          S.set("left", st.count); S.set("cut", (res.dbTotal || 0) - st.count);
          S.ticker(`<span class="p">&gt;</span> ${esc(st.label)} <span class="d">→</span> <span class="g">${won(st.count)}개</span>`);
          S.log("g", `■ ${st.label} ${won(st.count)}`);
          for (const [why, n] of (st.cuts || []).slice(0, 6)) if (n) { S.log("w", `  − ${String(why).trim()} ${won(n)}`); await S.wait(110); }
          await S.wait(420);
        }
        // ② 남은 후보 훑기(바로 시작하기 좋은 묶음 상위)
        const list = (res.groups?.start?.items || []).slice(0, 30), N = list.length;
        if (!N) { failScreen(S, "SOURCE EMPTY", "조건에 맞는 키워드가 없습니다", "결과 화면에서 예산이나 필터를 넓혀 보세요"); return; }
        const cells = S.cells(N);
        for (let k = 0; k < N && !S.closed; k++) {
          const x = list[k], sg = k < 5 ? "g" : "c", path = String(x.cat || "").split(">").slice(-2).join(" › ");
          S.reel({ light: !S.skip || k === N - 1, img: "", glyph: x.kw, sig: sg, no: `#${String(k + 1).padStart(2, "0")} / ${N} · ${path}`, name: x.kw, stamp: k < 5 ? `TOP ${k + 1}` : x.ai?.v === "ok" ? "AI OK" : "SCAN",
            meta: `<span>월검색<b>${won(x.m1)}</b></span><span>1등 리뷰<b>${won(x.mx)}</b></span><span>평균가<b>₩${won(x.price)}</b></span>${x.ai?.tags?.length ? `<span>AI<b>${esc(x.ai.tags.slice(0, 2).join(" · "))}</b></span>` : ""}` });
          if (!S.skip) S.ticker(`<span class="p">&gt;</span> 포착 <span class="d">#${String(k + 1).padStart(2, "0")}</span> ${esc(x.kw)} <span class="d">→ 월검색 ${won(x.m1)} · 1등 리뷰 ${won(x.mx)}${x.ai?.reason ? ` · ${esc(x.ai.reason)}` : ""}</span>`);
          S.set("final", Math.round(((k + 1) / N) * (res.final || 0)));
          cells[k].className = "cell " + sg;
          await S.wait(k < 5 ? 280 : Math.max(40, Math.min(90, 1600 / N)));
        }
        if (S.closed) return;
        S.set("final", res.final || 0); S.stage = 4; S.lamp("g", "TOP 5");
        const g = res.groups || {};
        await S.done({
          kick: "SOURCING COMPLETE",
          title: `따라 해 볼 키워드 <b>${won(res.final)}개</b>`,
          sub: `${won(res.dbTotal)}개 중 · 바로 시작 ${won(g.start?.count)} · 경쟁 약한 ${won(g.weak?.count)} · 요즘 뜨는 ${won(g.rising?.count)}`,
          picks: list.slice(0, 5).map((x, j) => ({ img: "", glyph: x.kw, name: x.kw, sig: "g", badge: `TOP ${j + 1}`, l1: `월검색 <b>${won(x.m1)}</b>`, l2: `1등 리뷰 ${won(x.mx)} · ₩${won(x.price)}` })),
          hold: 2800,
        });
      },
      fail(msg) { failScreen(S, "SOURCE STOPPED", "AI 소싱 중단", msg); },
      close(now) { S.close(now); },
    };
    S.onClose = () => { if (cur === ctl) cur = null; };
    cur = ctl;
    return ctl;
  }

  function failScreen(S, kick, title, msg) {
    if (S.closed) return;
    S.phase = "C";
    S.lamp("r", "STOP");
    S.ticker(`<span class="r">■</span> ${esc(title)} <span class="d">·</span> ${esc(msg || "")}`);
    const done = S.q(".sc-done");
    S.q(".sc-done .kick").textContent = kick; S.q(".sc-done h3").textContent = title; S.q(".sc-done p").textContent = msg || "";
    done.classList.add("on", "fail");
    const t = setTimeout(() => S.close(), 4000);
    done.onclick = () => { clearTimeout(t); S.close(); };
  }

  // ── 발표 모드가 아닐 때: 키워드 분석 위쪽 진행 띠 (스캔 › 검증 › 계산 › 포착) ──
  function startBar(keyword) {
    const bar = document.getElementById("runbar");
    if (!bar) return null;
    const STEPS = ["스캔", "검증", "계산", "포착"];
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
      kind: "bar",
      db() {},
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

  window.AiScan = { start, diagnose, exact, sheet, pick, reco, get current() { return cur; } };
})();
