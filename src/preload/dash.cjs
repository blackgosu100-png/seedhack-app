// 📊 마진 대시보드 화면용 — 크롬 확장 bridge.js 역할(확장 없이 앱에서 Wing 정산 받기, 2026-10-13)
// 대시보드(legacy.html, iframe 안)는 확장과 postMessage로 대화한다. 이 스크립트가 확장인 척 대답하고 실제 일은 메인(dash-ext.js)이 한다.
// 대시보드 주소인지는 메인이 보낸 쪽 프레임 주소로 확인한다(다른 사이트 프레임의 요청은 메인이 거절).
const { ipcRenderer } = require("electron");

const post = (data) => window.postMessage({ __from: "rocketg-extension", ...data }, "*");

// 메인 → 화면: 진행 기록·진행률(확장 bridge.js가 background 메시지를 넘기던 것과 같은 모양)
ipcRenderer.on("dash:ext-event", (_e, m) => post(m));

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const d = event.data || {};
  if (d.__rocketg_ping__) { post({ __pong__: true, extensionId: "seedhack-app" }); return; } // 확장 설치 감지
  if (d.__to === "rocketg-extension" && d.requestId) {
    ipcRenderer.invoke("dash:ext", d.message || {})
      .then((resp) => post({ type: "response", requestId: d.requestId, ok: !!resp?.ok, response: resp || null, msg: resp?.msg || "" }))
      .catch((e) => post({ type: "response", requestId: d.requestId, ok: false, response: { ok: false, msg: String(e?.message || e) }, msg: String(e?.message || e) }));
  }
});
// 확장이 페이지를 열 때 알리던 신호 — 대시보드가 ping을 보내기 전에도 준비됨을 알 수 있게
window.addEventListener("DOMContentLoaded", () => post({ __ready__: true, extensionId: "seedhack-app" }));
