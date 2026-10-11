// 🔒 수강생 확인 화면 — ① 대시보드 계정 로그인 → ② Wing 로그인(판매자ID) → ③ 승인 확인. 승인되면 사라진다.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.signal;
  let st = null;

  const STATUS = {
    pending: ["신청이 접수돼 승인을 기다리는 중입니다.", "승인되면 '다시 확인'을 눌러 주세요. 보통 강의 운영진이 확인 후 승인합니다."],
    unregistered: ["이 판매자 계정은 아직 수강생으로 등록되지 않았습니다.", "아래 '라이선스 신청하기'로 신청해 주세요. 판매자ID는 자동으로 입력됩니다."],
    rejected: ["이 판매자 계정은 승인되지 않았습니다.", "강의 운영진에게 문의해 주세요."],
    error: ["승인 상태를 확인하지 못했습니다.", "인터넷 연결을 확인한 뒤 '다시 확인'을 눌러 주세요."],
  };

  function render(s) {
    st = s;
    const locked = s.gate && !s.licensed;
    $("gate").hidden = !locked;
    document.body.classList.toggle("locked", locked);
    ["tKw", "tCat", "tClean", "tCol", "tList", "tCn", "tChat", "tDetail", "tMargin", "tAds", "tCoupons", "tStock"].forEach((id) => ($(id).disabled = locked));
    $("acct").hidden = !s.user;
    if (s.user) $("acct").textContent = `👤 ${s.user.email}${s.user.offline ? " (오프라인)" : ""}`;
    if (!locked) return;
    const step = !s.user ? 1 : !s.user.ok ? 1.5 : !s.vendor.id ? 2 : 3;
    const s1 = Math.floor(step);
    ["gs1", "gs2", "gs3"].forEach((id, i) => { $(id).className = i + 1 < s1 ? "done" : i + 1 === s1 ? "now" : ""; });
    $("gateLogin").hidden = step !== 1;
    $("gateVendor").hidden = step === 1;
    if (step === 1) return;
    $("gvUser").textContent = s.user.email;
    if (step === 1.5) { // 계정은 맞지만 대시보드 회원 승인 전
      const u = s.user;
      $("gvLead").textContent = !u.confirmed ? "이메일 인증이 아직 안 됐습니다." : u.approval === "rejected" ? "이 계정은 회원 승인이 거절되었습니다." : "회원 승인을 기다리는 중입니다.";
      $("gvSub").textContent = !u.confirmed ? "가입할 때 받은 메일에서 인증 링크를 누른 뒤 '다시 확인'을 눌러 주세요." : u.approval === "rejected" ? "강의 운영진에게 문의해 주세요." : "운영진이 대시보드 회원 승인을 하면 '다시 확인'으로 바로 열립니다.";
      $("gvApply").hidden = true;
      return;
    }
    if (step === 2) {
      $("gvLead").textContent = "왼쪽 Wing 화면에서 판매자 계정으로 로그인해 주세요.";
      $("gvSub").textContent = "로그인하면 판매자ID로 수강생 등록 여부를 자동으로 확인합니다. (Wing 비밀번호는 이 프로그램이 저장하거나 보내지 않습니다)";
      $("gvApply").hidden = true;
      return;
    }
    const [lead, sub] = STATUS[s.vendor.status] || STATUS.error;
    $("gvLead").textContent = lead;
    $("gvSub").textContent = `판매자ID ${s.vendor.id} · ${sub}`;
    $("gvApply").hidden = !s.vendor.formUrl;
  }

  $("gateLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("gErr").textContent = "";
    $("gSubmit").disabled = true; $("gSubmit").textContent = "확인 중…";
    const s = await api.invoke("auth:signin", { email: $("gEmail").value, password: $("gPw").value });
    $("gSubmit").disabled = false; $("gSubmit").textContent = "로그인";
    $("gPw").value = "";
    if (s.error) { $("gErr").textContent = s.error; return; }
    render(s);
  });
  $("gvRecheck").addEventListener("click", async () => {
    $("gvRecheck").disabled = true; $("gvRecheck").textContent = "확인 중…";
    render(await api.invoke("auth:recheck"));
    $("gvRecheck").disabled = false; $("gvRecheck").textContent = "다시 확인";
  });
  $("gvApply").addEventListener("click", () => st?.vendor.formUrl && api.invoke("auth:open", st.vendor.formUrl));
  $("gSignup").addEventListener("click", (e) => { e.preventDefault(); st && api.invoke("auth:open", st.signupUrl); });
  $("gReset").addEventListener("click", (e) => { e.preventDefault(); st && api.invoke("auth:open", st.resetUrl); });
  $("gvOut").addEventListener("click", async (e) => { e.preventDefault(); render(await api.invoke("auth:signout")); });
  // 계정 버튼: 두 번 누르면 로그아웃(실수 방지)
  $("acct").addEventListener("click", async () => {
    const b = $("acct");
    if (!b.classList.contains("arm")) { b.classList.add("arm"); const t = b.textContent; b.textContent = "로그아웃하려면 한 번 더"; setTimeout(() => { b.classList.remove("arm"); b.textContent = t; }, 2500); return; }
    b.classList.remove("arm");
    render(await api.invoke("auth:signout"));
  });

  api.on("auth", render);
  api.invoke("auth:state").then(render);
})();
