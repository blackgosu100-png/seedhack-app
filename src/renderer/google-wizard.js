// 🔗 구글 연결 마법사 — 📄 상세페이지 탭에 들어오면 저절로(연결 안 된 사람만), 탭 본문 자리에 한 화면 한 단계.
//   앱 로그인 → Wing 연결 때(onboard.js)와 같은 손가락 안내로 다음에 누를 곳을 짚고, 끝나면 하려던 일(주소로 만들기 등)로 돌아간다.
//   main/detail/google-oauth.js runSetup 진행("google:setup")을 그린다. OAuth 클라이언트가 아직 없으면 같은 틀로 "키 파일로 연결"을 안내(막다른 길 없음).
//   window.SeedGoogle.ensure(next): 준비됐으면 next() 바로, 아니면 마법사 → 연결 끝나면 next()
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STEPS = [
    ["login", "구글 계정으로 로그인"], ["billing", "무료 체험 확인"], ["project", "AI 작업 공간 만들기"],
    ["link", "무료 크레딧 연결"], ["enable", "AI 기능 켜기"], ["test", "연결 시험"],
  ];
  const idx = (id) => STEPS.findIndex((x) => x[0] === id);
  let box = null, cur = null, ready = null, pending = null, dismissed = false, mode = "oauth";
  const host = () => $("detail") && !$("detail").hidden ? $("detail") : document.body;

  // ── 틀 ──
  function open() {
    if (box) return;
    box = document.createElement("div");
    box.className = `gw${host() === document.body ? "" : " gw-inline"}`;
    box.innerHTML = `<div class="gw-card" role="dialog" aria-label="구글 연결"><button class="gw-x" type="button" aria-label="닫기" data-tip="나중에 할게요">✕</button>
      <div class="gw-dots"></div><div class="gw-body"></div></div><div class="gw-hand" aria-hidden="true" hidden>👈</div>`;
    host().appendChild(box);
    box.querySelector(".gw-x").onclick = later;
  }
  function close() { box?.remove(); box = null; api.invoke("detail:google:get").then(paintMain).catch(() => {}); }
  function later() { dismissed = true; pending = null; close(); }
  const dots = (i, err) => `${STEPS.map((_, k) => `<i class="${k < i ? "done" : k === i ? (err ? "err" : "now") : ""}"></i>`).join("")}`;
  // 손가락: 주 버튼 오른쪽에서 왼쪽을 가리킨다(onboard.js 와 같은 톤 — 아래 "나중에" 글을 가리지 않게)
  function pointTo(sel) {
    const h = box?.querySelector(".gw-hand"); if (!h) return;
    const b = sel && box.querySelector(sel);
    if (!b) { h.hidden = true; return; }
    h.hidden = false;
    const place = () => { if (!box) return; const r = b.getBoundingClientRect(), o = box.getBoundingClientRect(); h.style.left = `${r.right - o.left + 8}px`; h.style.top = `${r.top - o.top + r.height / 2 - 17}px`; };
    place(); setTimeout(place, 400);
  }
  function render(html, { step = -1, err = false, point = null } = {}) {
    open();
    box.querySelector(".gw-dots").innerHTML = step >= 0 ? dots(step, err) : "";
    box.querySelector(".gw-body").innerHTML = html;
    box.querySelectorAll("[data-a]").forEach((b) => { b.onclick = () => act(b.dataset.a, b); });
    pointTo(point);
  }

  // ── 화면들 ──
  const UNVERIFIED = `<div class="gw-warn"><div class="gw-warn-pic"><b>Google에서 확인하지 않은 앱</b><span>이 앱은 Google에서 확인하지 않았습니다…</span><u>고급</u><em>씨드핵(으)로 이동(안전하지 않음)</em></div>
    <p>이 화면이 보이면 <b>고급</b> → <b>씨드핵(으)로 이동</b>을 눌러 주세요<br><small>구글 검증 신청 중이라 잠깐 보이는 화면이에요</small></p></div>`;
  function intro() {
    if (mode === "keyfile") return keyIntro();
    const resume = !!ready?.resumeStep;
    render(`<div class="gw-hero">🔗</div><h2>상세페이지 AI 를 쓰려면<br>구글 연결이 필요해요</h2>
      <p class="gw-lead">내 구글 무료 체험으로 AI 를 써요<br><b>90일 · $300(약 42만 원)</b> 무료</p>
      <ul class="gw-mini"><li>① 구글 로그인</li><li>② (처음이면) 카드 등록 — 자동 결제 없음</li><li>③ 나머지는 자동</li></ul>
      <button class="gw-go" type="button" data-a="start">🔗 ${resume ? "이어서 연결하기" : "구글로 연결"}</button><button class="gw-later" type="button" data-a="later">나중에 할게요</button>`, { point: ".gw-go" });
  }
  function draw() {
    if (!cur) return intro();
    const i = Math.max(0, idx(cur.id)), s = STEPS[i];
    if (cur.final === "ok") {
      return render(`<div class="gw-big ok">✔</div><h2>연결 끝!</h2><p class="gw-lead">이제 내 구글 무료 체험으로<br>상세페이지 AI 를 써요</p>
        <ul class="gw-checks">${checksHtml(cur.checks)}</ul><p class="gw-wait">${pending ? "하던 상세페이지 만들기로 돌아가요…" : "잠시 뒤 닫혀요"}</p>`, { step: STEPS.length });
    }
    if (cur.status === "error") {
      return render(`<div class="gw-big err">!</div><h2>${esc(s[1])}에서 멈췄어요</h2><p class="gw-help">${esc(cur.help || "잠시 뒤 다시 시도해 주세요.")}</p>
        ${cur.checks ? `<ul class="gw-checks">${checksHtml(cur.checks)}</ul>` : ""}
        <button class="gw-go" type="button" data-a="start">다시 시도</button>${/약관|권한|프로젝트 수/.test(cur.help || "") ? `<button class="gw-sub" type="button" data-a="console">구글 클라우드 열기</button>` : ""}
        <button class="gw-later" type="button" data-a="later">나중에 할게요</button><details class="gw-why"><summary>자세히</summary><code>${esc(cur.error || "")}</code></details>`, { step: i, err: true, point: ".gw-go" });
    }
    if (cur.id === "login" && cur.status === "wait") {
      return render(`<div class="gw-step">1 / ${STEPS.length}</div><h2>브라우저에서<br>구글 계정을 고르고 [허용]</h2>
        <p class="gw-lead">방금 열린 브라우저 창에서 해 주세요<br>끝나면 씨드핵이 저절로 앞으로 와요</p>${UNVERIFIED}
        <p class="gw-wait"><span class="gw-spin"></span>기다리는 중 · ${esc(cur.eta || "")}</p><button class="gw-sub" type="button" data-a="reopen">브라우저가 안 열렸어요 — 다시 열기</button>`, { step: 0 });
    }
    if (cur.id === "billing" && cur.status === "wait") {
      return render(`<div class="gw-big card"><svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#2563eb" stroke-width="1.8"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/></svg></div>
        <h2>카드만 등록하면 끝나요</h2><p class="gw-lead">본인 확인용이에요<br><b>무료 체험이 끝나도 자동으로 결제되지 않아요</b></p>
        <ol class="gw-howto"><li>열린 구글 화면에서 나라 <b>대한민국</b> · 계정 유형 <b>개인</b></li><li>카드 정보를 넣고 <b>무료로 시작하기</b></li></ol>
        <button class="gw-go" type="button" data-a="trial">가입 화면 다시 열기</button>
        <p class="gw-wait"><span class="gw-spin"></span>가입이 끝나면 저절로 다음으로 넘어가요 · ${esc(cur.eta || "")}</p>`, { step: 1 });
    }
    render(`<div class="gw-step">${i + 1} / ${STEPS.length}</div><h2>${esc(s[1])}</h2><p class="gw-lead">${esc(cur.msg || "")}</p>
      <div class="gw-ring"><span class="gw-spin big"></span></div><p class="gw-eta">${esc(cur.eta || "")} · 자동으로 해요</p>`, { step: i });
  }
  const checksHtml = (c) => ["text", "image", "ocr"].map((k) => c?.[k] ? `<li class="${c[k].ok ? "ok" : "bad"}">${c[k].ok ? "✔" : "✕"} ${esc(c[k].msg)}</li>` : "").join("");

  // OAuth 클라이언트 준비 전: 같은 틀로 "키 파일로 연결"(GOOGLE-TRIAL-GUIDE.md 고급)
  function keyIntro(errMsg = "", checks = null) {
    render(`<div class="gw-hero">🔑</div><h2>지금은 키 파일로<br>구글을 연결해요</h2><p class="gw-lead">버튼 하나 연결은 준비 중이에요 · 약 10분</p>
      <ol class="gw-keys">
        <li><b>무료 체험 가입</b> <button class="gw-chip" type="button" data-a="k-trial">열기</button></li>
        <li><b>AI 기능 2개 [사용]</b> <button class="gw-chip" type="button" data-a="k-vertex">Vertex AI</button><button class="gw-chip" type="button" data-a="k-vision">Cloud Vision</button></li>
        <li><b>서비스 계정 → 키(JSON) 만들기</b> <button class="gw-chip" type="button" data-a="k-sa">열기</button><small>역할: Vertex AI 사용자</small></li>
      </ol>
      <label class="gw-drop" data-tip="내려받은 키 파일(.json)을 끌어다 놓거나 눌러서 고르기"><input type="file" accept=".json,application/json" hidden><b>④ 키 파일을 여기에 끌어다 놓기</b><span>또는 눌러서 고르기</span></label>
      ${errMsg ? `<p class="gw-help bad">${esc(errMsg)}</p>` : ""}${checks ? `<ul class="gw-checks">${checksHtml(checks)}</ul>` : ""}
      <button class="gw-later" type="button" data-a="later">나중에 할게요</button>`, { point: ".gw-drop" });
    const drop = box.querySelector(".gw-drop"), inp = drop.querySelector("input");
    const use = async (f) => { if (!f) return; drop.classList.add("busy"); drop.querySelector("b").textContent = "연결 확인 중…"; const g = await api.invoke("detail:google:set", { kind: "sa", json: await f.text() }).catch((e) => ({ error: String(e) }));
      if (g?.connected && g.checks && Object.values(g.checks).every((c) => c?.ok)) { cur = { final: "ok", checks: g.checks, id: "test" }; draw(); finish(); }
      else keyIntro(g?.error || "연결 시험에서 안 된 것이 있어요. 아래 ✕ 줄을 확인해 주세요.", g?.checks || null); };
    inp.onchange = () => use(inp.files?.[0]);
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); use(e.dataTransfer.files?.[0]); });
  }

  // ── 동작 ──
  async function act(a) {
    if (a === "later") return later();
    if (a === "start") return start();
    if (a === "trial") return api.invoke("detail:google:oauth:open", { what: "trial" });
    if (a === "reopen") return api.invoke("detail:google:oauth:open", { what: "login" });
    if (a === "console") return api.invoke("detail:google:oauth:open", { what: "console" });
    const K = { "k-trial": "trial", "k-vertex": "vertex", "k-vision": "vision", "k-sa": "sa" };
    if (K[a]) return api.invoke("detail:google:open", { what: K[a] });
  }
  async function start() {
    cur = { id: "login", status: "now" }; draw();
    const r = await api.invoke("detail:google:oauth:start").catch((e) => ({ error: String(e) }));
    if (r?.busy) return;
    if (r?.error) { cur = { id: "login", status: "error", help: r.error }; draw(); return; }
    if (r?.result?.ok) { cur = { ...cur, final: "ok", checks: r.checks }; draw(); finish(); }
    paintMain(r);
  }
  function finish() { // 연결 끝 → 잠깐 보여 주고 하던 일로
    ready = { ok: true };
    const next = pending; pending = null;
    setTimeout(() => { close(); try { next?.(); } catch {} }, next ? 1600 : 2200);
  }
  api.on("google:setup", (ev) => { if (!box) return; cur = { ...ev }; draw(); });

  async function check() { ready = await api.invoke("detail:ready").catch(() => null); mode = ready && !ready.oauthReady ? "keyfile" : "oauth"; return ready; }
  // 탭에 들어올 때: 준비 안 됐고 "나중에"를 안 눌렀으면 저절로
  async function maybeAuto() {
    if (box || dismissed || document.body.classList.contains("locked")) return;
    const r = await check();
    if (r && !r.ok && r.fix === "google") { cur = null; intro(); }
  }
  // 만들기 누를 때: 준비 안 됐으면 마법사(연결 끝나면 next)
  async function ensure(next) {
    const r = ready?.ok ? ready : await check();
    if (!r || r.ok || r.fix !== "google") { next?.(); return true; } // 서버 준비 중(wait) 등은 사전 점검이 안내
    pending = next || null; cur = null; intro(); return false;
  }
  window.SeedGoogle = { ensure, maybeAuto, open: () => { cur = null; check().then(intro); } };
  api.on("nav", (n) => { if (n?.tab === "detail") setTimeout(maybeAuto, 300); });

  // 설정 칸의 큰 버튼(고급 사용자용으로 그대로 둠)
  function paintMain(g) {
    const b = $("dtGcOAuth"), n = $("dtGcOAuthNote"); if (!b || !g) return;
    b.disabled = false;
    b.textContent = g.connected ? "🔗 다시 연결" : "🔗 구글로 연결";
    n.textContent = g.connected ? `연결됨 · ${g.keyHint || ""}` : "버튼 → 구글 로그인 → (처음이면) 카드 등록. 나머지는 자동이에요";
  }
  $("dtGcOAuth")?.addEventListener("click", () => { dismissed = false; window.SeedGoogle.open(); });
  api.invoke("detail:google:get").then(paintMain).catch(() => {});
})();
