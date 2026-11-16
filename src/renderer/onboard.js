// 🔰 첫 실행 안내 — 모바일 게임 튜토리얼처럼 "지금 누를 곳"을 손가락·말풍선으로 짚어 준다.
//   ① 앱 로그인: 사이트 화면을 숨기고 로그인 카드만 창 가운데(body.onb-login) — 이메일 → 비밀번호 → 로그인 버튼 순서로 손가락이 옮겨 간다
//   ② Wing 로그인: Wing 화면이 나타나고 둘레가 빛나며(body.onb-wing), 오른쪽 칸 손가락이 왼쪽 Wing 을 가리킨다. 단계 글은 Wing 주소로(main "onb:wing")
//   ③ 확인 끝: "준비 끝!" 축하 화면 2.5초 → 원래 화면
// 상태는 gate.js 와 같은 auth 상태를 받는다. main 에는 ui:onboard {phase} 로 화면 배치(사이트 숨김·테두리 자리)를 알린다.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  const body = document.body;
  let phase = null, wingStep = "loading", sawLock = false;

  // 손가락 + 말풍선(한 벌을 옮겨 다닌다)
  const coach = document.createElement("div");
  coach.className = "onb-coach"; coach.hidden = true;
  coach.innerHTML = `<div class="onb-hand" aria-hidden="true">👈</div><div class="onb-bubble"><b class="onb-step"></b><span class="onb-msg"></span></div>`;
  document.body.appendChild(coach);
  const ring = document.createElement("div"); ring.className = "onb-ring"; ring.hidden = true; document.body.appendChild(ring);

  // 단계 표시(게임 지도처럼 동그라미 3개를 선으로 잇기) — 로그인 카드 맨 위
  const map = document.createElement("div");
  map.className = "onb-map";
  map.innerHTML = ["앱 로그인", "Wing 연결", "확인 끝"].map((t, i) => `<div class="onb-node" data-i="${i}"><i>${i + 1}</i><small>${t}</small></div>`).join('<span class="onb-line"></span>');
  const card = document.querySelector(".gate-card");
  card?.insertBefore(map, card.querySelector(".gate-steps"));

  // 오른쪽 칸(Wing 단계) 안내
  const wingGuide = document.createElement("div");
  wingGuide.className = "onb-wing"; wingGuide.hidden = true;
  wingGuide.innerHTML = `<div class="onb-point" aria-hidden="true">👈</div><p class="onb-wt"></p><p class="onb-ws"></p>`;
  $("gateVendor")?.prepend(wingGuide);

  const frameEl = document.createElement("div"); frameEl.className = "onb-frame"; frameEl.hidden = true; document.body.appendChild(frameEl);
  function placeFrame() {
    frameEl.hidden = phase !== "wing";
    if (frameEl.hidden) return;
    const st = document.querySelector(".stage")?.getBoundingClientRect(), pn = $("panel")?.getBoundingClientRect();
    if (!st) return;
    const right = pn && pn.width ? pn.left : st.right;
    Object.assign(frameEl.style, { left: `${st.left + 2}px`, top: `${st.top + 2}px`, width: `${Math.max(0, right - st.left - 4)}px`, height: `${Math.max(0, st.height - 4)}px` });
  }
  setInterval(placeFrame, 400);
  const setMap = (n) => map.querySelectorAll(".onb-node").forEach((el, i) => { el.className = `onb-node${i < n ? " done" : i === n ? " now" : ""}`; });

  // 손가락을 target 에 붙인다(아래쪽에서 위로 가리킴). 말풍선은 target 위
  function pointAt(target, step, msg) {
    if (!target || target.offsetParent === null) { coach.hidden = true; ring.hidden = true; return; }
    coach.querySelector(".onb-step").textContent = step;
    coach.querySelector(".onb-msg").textContent = msg;
    coach.hidden = false; ring.hidden = false;
    cur = target; place();
  }
  // 칸 오른쪽 바깥에 👈 + 말풍선(자리가 모자라면 칸 아래). 카드 등장 애니메이션·창 크기 변화 뒤에도 맞게 계속 다시 잰다
  let cur = null;
  function place() {
    if (!cur || coach.hidden) return;
    const r = cur.getBoundingClientRect(), wide = window.innerWidth - r.right > 280;
    coach.classList.toggle("below", !wide);
    coach.style.left = `${Math.round(wide ? r.right + 14 : r.left + r.width / 2)}px`;
    coach.style.top = `${Math.round(wide ? r.top + r.height / 2 : r.bottom + 8)}px`;
    Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  }
  setInterval(() => { if (phase === "login") place(); }, 250);

  function loginCoach() {
    if (phase !== "login" || $("gateLogin").hidden) { coach.hidden = true; ring.hidden = true; return; }
    const em = $("gEmail"), pw = $("gPw"), btn = $("gSubmit");
    if (!em.value.includes("@")) pointAt(em, "1단계", "대시보드에 가입한 이메일을 넣어요");
    else if (!pw.value) pointAt(pw, "1단계", "비밀번호를 넣어요");
    else pointAt(btn, "1단계", "로그인을 눌러요");
  }

  const WING_TEXT = {
    loading: ["왼쪽에 쿠팡 Wing 화면이 열리고 있어요", "잠시만 기다려 주세요"],
    login: ["왼쪽 Wing 화면에서 로그인해요", "쿠팡 판매자(Wing) 아이디·비밀번호를 넣고 로그인을 눌러요. 비밀번호는 이 프로그램이 저장하거나 보내지 않아요."],
    verify: ["휴대폰 인증번호를 넣어요", "쿠팡이 보낸 문자·카카오톡의 인증번호를 왼쪽 화면에 넣어요"],
    ok: ["✔ Wing 연결됐어요", "판매자ID로 수강생 확인 중이에요…"],
  };
  function wingCoach(s) {
    const show = phase === "wing" && !!s?.user && s.user.ok && !s.vendor?.id;
    wingGuide.hidden = !show;
    if (!show) return;
    const [t, sub] = WING_TEXT[wingStep] || WING_TEXT.loading;
    wingGuide.querySelector(".onb-wt").textContent = t;
    wingGuide.querySelector(".onb-ws").textContent = sub;
    wingGuide.classList.toggle("ok", wingStep === "ok");
  }

  function celebrate() {
    const el = document.createElement("div");
    el.className = "onb-done";
    el.innerHTML = `<div class="onb-done-card"><div class="onb-burst">${Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * 360 / 14}deg;--d:${(i % 3) * 0.08}s"></i>`).join("")}</div><b>준비 끝!</b><p>이제 왼쪽 메뉴 <b>🔎 키워드 분석</b>부터 시작해 보세요</p></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("out"), 2300);
    setTimeout(() => el.remove(), 2800);
  }

  function render(s) {
    if (!s) return;
    const locked = s.gate && !s.licensed;
    const next = !locked ? null : !s.user || !s.user.ok ? "login" : "wing";
    if (locked) sawLock = true;
    if (next !== phase) {
      const was = phase;
      phase = next;
      body.classList.toggle("onb-login", phase === "login");
      body.classList.toggle("onb-wing", phase === "wing");
      api.invoke("ui:onboard", { phase }); placeFrame();
      if (!phase && was && sawLock) celebrate();
    }
    setMap(!s.user || !s.user.ok ? 0 : !s.vendor?.id ? 1 : s.licensed ? 3 : 2);
    if (phase === "login") loginCoach(); else { coach.hidden = true; ring.hidden = true; }
    wingCoach(s);
    lastState = s;
  }
  let lastState = null;

  ["input", "focus"].forEach((ev) => ["gEmail", "gPw"].forEach((id) => $(id)?.addEventListener(ev, loginCoach)));
  window.addEventListener("resize", () => { if (phase === "login") loginCoach(); });
  // 로그인 카드가 바뀌는(오류 글·단계 전환) 뒤에도 자리를 다시 잡는다
  new MutationObserver(() => { if (phase === "login") loginCoach(); }).observe($("gate"), { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  api.on("onb:wing", (m) => { wingStep = m?.step || "loading"; wingCoach(lastState); });
  api.on("auth", render);
  api.invoke("auth:state").then(render);
})();
