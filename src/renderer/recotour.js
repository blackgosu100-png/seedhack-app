// 🎓 키워드 추천 따라 하기 — 모바일 게임 첫 판 안내처럼 화면을 어둡게 하고 "지금 누를 곳"만 밝힌다(2026-11-17 대표님 요청 · 모의 수업·1:1 컨설팅용)
//  흐름: 시작 카드 → ① 기준 고르기(처음이에요/팔아봤어요 직접 누름) → ② AI 소싱 시작(직접 누름) → 해커 화면 동안 숨음
//        → ③ 결과 읽기(이번에 받은 10개 · 월매출 · 꼬리표 · 틈 · 시장 · 원가, "다음"으로 넘김)
//        → ④ 직접 해 보기(🔎 키워드 분석 눌러 보고 돌아오기 · 🇨🇳 1688 원가 찾기 눌러 리스트업 보기) → 축하
//  처음 키워드 추천을 열 때 한 번 자동으로 묻고, 그 뒤엔 시작 화면의 🎓 사용법 따라 하기 버튼으로 다시 본다(이 PC 기억)
//  화면을 바꾸지 않는다: reco.js 가 그린 요소(data-slot · data-f · data-r)를 찾아 짚기만 한다. 요소가 없으면 그 단계는 건너뜀
(() => {
  const KEY = "recoTour";
  const seen = () => { try { return !!localStorage.getItem(KEY); } catch { return true; } };
  const mark = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
  const q = (s) => document.querySelector(s);
  const vis = (el) => !!el && el.offsetParent !== null && el.getClientRects().length > 0;
  const view = () => document.body.dataset.view;
  const scanning = () => !!q(".sc"); // AI 해커 화면(aiscan.js)이 덮고 있는 동안
  const slot0 = (s) => q(`#reco [data-slot="0"] ${s}`);

  // 꼬리표 사전 — reco.js / kw-entry.js 의 꼬리표 id 와 같은 이름
  const FLAGS = [
    ["entry", "🚪 진입 쉬움", "로켓배송이 적고 리뷰가 적어 처음 들어가기 좋은 키워드"],
    ["timing", "지금 진입 권장", "작년엔 1~3달 뒤에 검색이 가장 많았어요 → 지금 준비하면 딱 맞아요"],
    ["growth", "검증된 시장", "로켓그로스 판매자가 많아 이미 팔리는 시장 · 더 좋은 상품으로 차별화하면 들어갈 수 있어요"],
    ["dominant", "한 상품이 장악", "1등 상품 하나가 비슷한 키워드를 다 차지 · 그 상품보다 확실히 나아야 해요"],
    ["mixed", "상품 섞임", "네이버·쿠팡 평균가가 크게 달라요 · 서로 다른 상품이 섞인 키워드라 내 상품과 맞는지 확인"],
    ["nofc", "예측 불가", "표본이 적어 다음 달 검색량을 알 수 없어요"],
    ["suspect", "예측 의심", "예상 상승률을 믿기 어려워요"],
  ];
  const flagGloss = (el) => {
    const has = new Set([...(el?.querySelectorAll("[data-f]") || [])].map((x) => x.dataset.f));
    const on = FLAGS.filter(([id]) => has.has(id)), off = FLAGS.filter(([id]) => !has.has(id) && ["growth", "dominant", "timing", "mixed"].includes(id));
    return `${on.map(([, ko, d]) => `<div class="rt-g on"><b>${ko}</b><span>${d}</span></div>`).join("")}
      ${off.map(([, ko, d]) => `<div class="rt-g"><b>${ko}</b><span>${d}</span></div>`).join("")}
      <small>꼬리표에 마우스를 올리면 그 키워드의 이유가 나와요</small>`;
  };
  const firstFlag = (id) => [...document.querySelectorAll(`#reco [data-f="${id}"]`)].find(vis);

  let ctx = {};
  // mode: next = "다음"으로 넘김(짚은 곳 누르기 막음) · click = 짚은 곳을 직접 눌러야 넘어감 · free = 화면을 어둡게 하지 않고 짚기만 · wait = 숨고 조건 기다림
  const STEPS = [
    { id: "mode", stage: 0, view: "reco", mode: "click", click: ".rc-seg [data-mode]", target: () => q("#reco .rc-seg"),
      title: "① 나에게 맞는 기준 고르기",
      msg: () => `<b>처음이에요</b> — 경쟁이 약해 처음 들어가기 쉬운 키워드<br><b>팔아봤어요</b> — 이미 잘 팔리는 시장에서 빈자리 찾기<br>👆 둘 중 하나를 눌러 보세요` },
    { id: "go", stage: 1, view: "reco", mode: "click", click: "#rcGo:not(.off), #rcPast, #rcBonus",
      target: () => { const g = q("#rcGo"); return g && !g.classList.contains("off") ? g : q("#rcBonus") || q("#rcPast"); },
      title: "② AI 소싱 시작",
      msg: () => (q("#rcGo")?.classList.contains("off") ? `오늘 받을 횟수를 다 썼어요<br>👆 이 버튼으로 결과를 열어 연습해요`
        : `누르면 AI가 쿠팡 키워드 DB를 걸러<br><b>처음 보는 키워드 10개</b>를 골라 줘요<br>👆 눌러 보세요`) },
    { id: "wait", stage: 1, view: "reco", mode: "wait",
      ready: () => !scanning() && (slot0(".rp-acts") || q('#reco [data-slot="0"].rp-card p.dim') || q("#reco .rc-grid") || q("#reco .rc-empty")) },
    { id: "empty", stage: 2, view: "reco", mode: "next", when: () => !!q("#reco .rc-empty"), target: () => q("#reco .rc-empty"),
      title: "받을 키워드가 없어요", msg: () => `⚙ 조건 바꾸기에서 예산·필터를 넓힌 뒤 다시 받아 보세요`, last: true },
    { id: "wing", stage: 2, view: "reco", mode: "next", when: () => !slot0(".rp-acts"), target: () => q("#tWing"),
      title: "Wing 로그인이 필요해요", msg: () => `쿠팡 실판매(월매출·틈)는 Wing에서 불러와요<br>왼쪽 <b>Wing 로그인</b>에서 로그인한 뒤 다시 해 보세요`, last: true },
    { id: "head", stage: 2, view: "reco", mode: "next", target: () => q("#reco .rp-head h2"),
      title: "③ 이번에 받은 키워드 10개",
      msg: () => `위 3개는 큰 카드, 4위부터는 줄로 보여요<br><b>🚪 진입 쉬움</b> 키워드가 맨 앞에 와요<br>숫자는 쿠팡에서 하나씩 불러와 채워져요` },
    { id: "rev", stage: 2, view: "reco", mode: "next", target: () => slot0(".rp-rev"),
      title: "시장 크기 = 월매출",
      msg: () => `이 키워드로 검색해서 가장 많이 팔린<br><b>상위 10개 상품의 한 달 매출 합</b>이에요<br>클수록 사는 사람이 많다는 뜻` },
    { id: "flags", stage: 2, view: "reco", mode: "next", target: () => slot0(".rp-fl") || [...document.querySelectorAll("#reco .rp-top3 .rp-fl")].find(vis),
      title: "꼬리표 읽는 법", wide: true, msg: (el) => flagGloss(el) },
    { id: "growth", stage: 2, view: "reco", mode: "next", target: () => firstFlag("growth"),
      title: "실제 예시 · 검증된 시장",
      msg: () => `로켓그로스 판매자가 절반 넘는 키워드예요<br>= 이미 팔리는 게 확인된 시장<br>1688에서 <b>더 좋은 상품</b>을 찾아 차별화하면 들어갈 수 있어요` },
    { id: "dominant", stage: 2, view: "reco", mode: "next", target: () => firstFlag("dominant"),
      title: "실제 예시 · 한 상품이 장악",
      msg: () => `비슷한 키워드 여러 개에서 1등이 <b>같은 상품</b>이에요<br>그 상품 리뷰를 보고 내가 확실히 더 나은 점이 있을 때만 들어가요` },
    { id: "gap", stage: 2, view: "reco", mode: "next", target: () => slot0(".rp-row.top"),
      title: "틈 = 새로 들어가도 팔린다는 증거",
      msg: (el) => `${el?.querySelector(".rp-gap") ? "" : "이 키워드는 아직 틈 상품이 없어요<br>"}리뷰 <b>300개도 안 되는</b> 상품이 28일 동안 팔린 개수예요<br>리뷰 적은 새 상품도 팔리면 나도 들어갈 수 있어요<br>사진 칸의 <b>틈</b> 표시도 같은 뜻` },
    { id: "market", stage: 2, view: "reco", mode: "next", target: () => slot0('[data-r="market"]'),
      title: "시장 (팔아봤어요 기준)",
      msg: () => `1등 상품이 <b>하루에 몇 개</b> 파는지, 리뷰 500개 넘는 상품이 몇 개인지예요<br>1등 하루 50개 · 리뷰 500개+ 상품 3개 이상이면 수요가 검증된 시장` },
    { id: "cost", stage: 2, view: "reco", mode: "next", target: () => slot0('[data-r="cost"]'),
      title: "원가 기준선",
      msg: () => `이 가격에 팔 때 1688에서 <b>이 위안 이하</b>로 찾으면<br>광고비 10%를 쓰고도 마진 20%가 남아요<br>1688에서 고를 때 이 숫자보다 싼지 보면 돼요` },
    { id: "kw", stage: 3, view: "reco", mode: "click", skip: true, click: '#reco [data-slot="0"] .rp-acts button[data-kw]', target: () => slot0(".rp-acts button[data-kw]"),
      onClick: () => { ctx.didKw = true; },
      title: "④ 직접 해 보기 · 🔎 키워드 분석",
      msg: () => `이 키워드의 쿠팡 상품 <b>전체</b>와 쿠폰가를<br>한 번 더 자세히 봐요<br>👆 눌러 보세요` },
    { id: "kwback", stage: 3, view: "kw", mode: "free", when: () => ctx.didKw, click: "#tReco", target: () => q("#tReco"),
      title: "키워드 분석 화면이에요",
      msg: () => `상품이 다 뜨면 판매량·리뷰·가격을 훑어보세요<br>다 봤으면 👆 <b>키워드 추천</b>을 눌러 돌아와요` },
    { id: "c1688", stage: 3, view: "reco", mode: "click", skip: true, click: '#reco [data-slot="0"] .rp-acts button[data-src]', target: () => slot0(".rp-acts button[data-src]"),
      onClick: () => { ctx.didList = true; },
      title: "④ 직접 해 보기 · 🇨🇳 1688 원가 찾기",
      msg: () => `1위 상품을 <b>리스트업</b>에 담고<br>1688에서 같은 상품을 자동으로 찾아요<br>👆 눌러 보세요` },
    { id: "list", stage: 3, view: "list", viewWait: 5000, mode: "free", when: () => ctx.didList, target: () => q("#tList"),
      title: "리스트업에 담겼어요",
      msg: () => `1688에서 같은 상품을 찾으면<br>원가·마진이 이 표에 자동으로 채워져요<br>상품을 바꾸고 싶으면 행의 🔍1688 버튼을 눌러요` },
  ];
  const STAGES = ["기준 고르기", "AI 소싱", "결과 읽기", "직접 해 보기"];

  // ── 화면 조각: 어둡게(구멍 둘레 4장) · 빛나는 고리 · 손가락 · 말풍선 · 기다림 띠 ──
  const mk = (cls, html = "") => { const el = document.createElement("div"); el.className = cls; el.innerHTML = html; el.hidden = true; document.body.appendChild(el); return el; };
  const shades = [0, 1, 2, 3].map(() => mk("rt-shade"));
  const cap = mk("rt-cap"); // "다음" 단계: 짚은 곳을 실수로 누르지 않게 덮는 투명 판
  const ring = mk("rt-ring");
  const hand = mk("rt-hand", "👆");
  const bub = mk("rt-bub");
  const pill = mk("rt-pill", `<i></i><span>AI가 고르고, 쿠팡에서 실판매를 불러오는 중이에요 · 첫 카드가 뜨면 이어서 알려 드려요</span><button type="button" data-rt="quit">그만 보기</button>`);
  const modal = mk("rt-modal");
  const hideAll = () => [...shades, cap, ring, hand, bub, pill].forEach((e) => (e.hidden = true));

  let on = false, idx = 0, stepAt = 0, scrolled = false, lastKey = "";
  const step = () => STEPS[idx];

  const mapHtml = (now) => `<div class="rt-map">${STAGES.map((t, i) => `<div class="rt-node ${i < now ? "done" : i === now ? "now" : ""}"><i>${i + 1}</i><small>${t}</small></div>`).join('<span class="rt-line"></span>')}</div>`;

  function intro() {
    modal.innerHTML = `<div class="rt-card"><span class="rt-kick">🎓 처음 오셨나요?</span><b>키워드 추천, 1분 따라 하기</b>
      <p>손가락이 짚는 곳을 <b>직접 눌러 보며</b> 배워요<br>꼬리표·틈·원가가 무슨 뜻인지도 하나씩 알려 드려요</p>${mapHtml(-1)}
      <div class="rt-btns"><button type="button" class="rt-pri" data-rt="start">시작하기 ▶</button><button type="button" class="rt-sec" data-rt="later">다음에 할게요</button></div></div>`;
    modal.hidden = false;
  }
  function outro(text) {
    hideAll();
    modal.innerHTML = `<div class="rt-card done"><div class="rt-burst">${Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * 360 / 14}deg;--d:${(i % 3) * 0.08}s"></i>`).join("")}</div>
      <span class="rt-kick">🎉 다 해 봤어요!</span><b>이제 혼자서도 할 수 있어요</b><p>${text}</p>${mapHtml(4)}
      <div class="rt-btns"><button type="button" class="rt-pri" data-rt="close">좋아요</button></div></div>`;
    modal.hidden = false;
  }
  function start(from = 0) {
    on = true; ctx = {}; modal.hidden = true;
    idx = from; enter();
  }
  function stop(done = true) {
    on = false; hideAll(); if (done) mark("done");
  }
  function enter() {
    stepAt = Date.now(); scrolled = false; lastKey = "";
    // 조건(when)이 안 맞는 단계는 건너뜀
    while (idx < STEPS.length && STEPS[idx].when && !STEPS[idx].when()) idx++;
    if (idx >= STEPS.length) { stop(); outro("더 받고 싶으면 <b>🎁 10개 더 받기</b>를 눌러요<br>시작 화면의 <b>🎓 사용법 따라 하기</b>로 언제든 다시 볼 수 있어요"); return; }
    tick();
  }
  function next() { if (step()?.last) { stop(); return; } idx++; enter(); }

  // 말풍선·손가락 자리: 아래 → 위 → 오른쪽 순으로 자리가 있는 쪽
  function place(el, s) {
    const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight, pad = 6;
    const hole = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
    const dim = s.mode === "next" || s.mode === "click";
    const box = [[0, 0, W, Math.max(0, hole.t)], [0, hole.b, W, Math.max(0, H - hole.b)], [0, hole.t, Math.max(0, hole.l), hole.b - hole.t], [hole.r, hole.t, Math.max(0, W - hole.r), hole.b - hole.t]];
    shades.forEach((sh, i) => { sh.hidden = !dim; const [x, y, w, h] = box[i]; Object.assign(sh.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }); });
    cap.hidden = s.mode !== "next";
    Object.assign(cap.style, { left: `${hole.l}px`, top: `${hole.t}px`, width: `${hole.r - hole.l}px`, height: `${hole.b - hole.t}px` });
    ring.hidden = false;
    Object.assign(ring.style, { left: `${hole.l}px`, top: `${hole.t}px`, width: `${hole.r - hole.l}px`, height: `${hole.b - hole.t}px` });
    const bw = bub.offsetWidth || 320, bh = bub.offsetHeight || 160;
    let side = H - hole.b > bh + 60 ? "below" : hole.t > bh + 60 ? "above" : "right";
    if (r.right < 260 && W - hole.r > bw + 70) side = "right"; // 왼쪽 메뉴를 짚을 땐 오른쪽에
    hand.hidden = false; bub.hidden = false; hand.className = `rt-hand ${side}`;
    const cx = Math.min(Math.max(r.left + r.width / 2, 40), W - 40);
    if (side === "right") {
      hand.textContent = "👈";
      Object.assign(hand.style, { left: `${hole.r + 6}px`, top: `${r.top + r.height / 2 - 20}px` });
      Object.assign(bub.style, { left: `${Math.min(hole.r + 56, W - bw - 12)}px`, top: `${Math.min(Math.max(r.top + r.height / 2 - bh / 2, 12), H - bh - 12)}px` });
    } else {
      hand.textContent = side === "below" ? "👆" : "👇";
      Object.assign(hand.style, { left: `${cx - 20}px`, top: `${side === "below" ? hole.b + 2 : hole.t - 44}px` });
      const bl = Math.min(Math.max(cx - bw / 2, 12), W - bw - 12);
      Object.assign(bub.style, { left: `${bl}px`, top: `${side === "below" ? hole.b + 46 : hole.t - 46 - bh}px` });
    }
  }
  function bubHtml(s, el) {
    const n = ctx.n || 1;
    const acts = s.id === "list" ? `<button type="button" class="rt-pri" data-rt="next">끝내기 🎉</button>`
      : s.mode === "next" ? `<button type="button" class="rt-pri" data-rt="next">${s.last ? "알겠어요" : "다음 ▶"}</button>`
      : s.skip ? `<button type="button" class="rt-sec" data-rt="next">이번엔 건너뛰기</button>` : "";
    return `<div class="rt-top"><span class="rt-st">${STAGES[s.stage]} · ${n}</span><button type="button" class="rt-x" data-rt="quit" title="따라 하기 그만 보기">✕</button></div>
      <b class="rt-t">${s.title}</b><div class="rt-m">${s.msg(el)}</div>${acts ? `<div class="rt-btns">${acts}</div>` : ""}`;
  }

  function tick() {
    if (!on) return;
    const s = step(); if (!s) return;
    if (s.view && view() !== s.view && s.viewWait && Date.now() - stepAt > s.viewWait) { next(); return; }
    if (scanning() || (s.view && view() !== s.view)) { hideAll(); if (s.mode === "wait" && !scanning()) pill.hidden = false; return; }
    if (s.mode === "wait") {
      hideAll(); pill.hidden = false;
      if (s.ready()) { setTimeout(() => { if (on && step() === s) next(); }, 700); pill.hidden = true; s.mode = "wait-done"; } // 첫 카드가 그려지고 자리 잡을 틈
      return;
    }
    if (s.mode === "wait-done") return;
    const el = s.target();
    if (!vis(el)) { hideAll(); if (Date.now() - stepAt > 800) next(); return; } // 이번 결과에 없는 칸 → 건너뜀
    pill.hidden = true;
    if (!scrolled) { scrolled = true; el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    const key = `${idx}|${s.msg(el)}`;
    if (key !== lastKey) { if (!lastKey) ctx.n = (ctx.n || 0) + 1; lastKey = key; bub.className = `rt-bub${s.wide ? " wide" : ""}`; bub.innerHTML = bubHtml(s, el); }
    place(el, s);
  }
  setInterval(tick, 200);
  addEventListener("resize", tick);

  // 짚은 곳을 직접 누르면 넘어감(앱 쪽 동작이 먼저 돌게 한 박자 늦게)
  document.addEventListener("click", (e) => {
    const r = e.target.closest?.("[data-rt]");
    if (r) {
      const a = r.dataset.rt;
      if (a === "start") start(q("#rcGo") ? 0 : STEPS.findIndex((x) => x.id === "head"));
      else if (a === "later") { modal.hidden = true; mark("later"); }
      else if (a === "close") modal.hidden = true;
      else if (a === "quit") stop();
      else if (a === "next") next();
      return;
    }
    if (!on) return;
    const s = step();
    if (s?.click && e.target.closest?.(s.click)) { s.onClick?.(); const cur = idx; setTimeout(() => { if (on && idx === cur) next(); }, 60); }
  }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !scanning() && (on || !modal.hidden)) { modal.hidden = true; stop(); } });

  // 다시 시작할 때 기다림 단계 상태를 되돌린다
  const resetWait = () => STEPS.forEach((x) => { if (x.mode === "wait-done") x.mode = "wait"; });
  document.addEventListener("click", (e) => { if (e.target.closest?.("#rcTour")) { resetWait(); stop(false); intro(); } }, true);

  // 처음 키워드 추천을 열면 한 번 묻는다(로그인 안내 중엔 묻지 않음)
  addEventListener("reco:shown", () => {
    if (on || seen() || !modal.hidden) return;
    if (document.body.classList.contains("onb-login") || document.body.classList.contains("onb-wing")) return;
    setTimeout(() => { if (!on && view() === "reco" && modal.hidden && !seen()) { resetWait(); intro(); } }, 400);
  });
  window.RecoTour = { start: () => { resetWait(); intro(); } };
})();
