// 💬 1688 채팅 화면 위 "문의 도우미" 상자 — 판매자별 진행 단계·받은 답(한글 요약)·직접 확인 필요 표시
// 상자는 보여 주기만 한다. 채팅 입력·전송은 메인이 사람처럼 마우스·키보드로 한다(상자는 그동안 클릭이 통과되게 흐려짐).
const { ipcRenderer } = require("electron");
if (window.top === window) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let box = null, open = true, last = null;
  const CSS = `
  #sg-chat{box-sizing:border-box;position:fixed;right:12px;top:12px;z-index:2147483647;width:340px;max-height:calc(100vh - 24px);overflow:auto;resize:both;min-width:260px;min-height:90px;max-width:calc(100vw - 20px);background:#0b0f14;color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.4);font:12.5px/1.45 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
  #sg-chat.busy{pointer-events:none;opacity:.45} #sg-chat.min{width:auto;padding:8px 12px} #sg-chat.min .bd{display:none}
  #sg-chat .hd{display:flex;align-items:center;gap:6px;cursor:move;user-select:none;margin:-4px -4px 0;padding:4px} #sg-chat .hd b{font-size:14px;flex:1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #sg-chat.min{resize:none;min-height:0} #sg-chat .grip{color:#4b5d72;font-size:12px;letter-spacing:-2px}
  #sg-chat button{border:1px solid #2b3a4c;border-radius:8px;background:#0b0f14;color:#fff;cursor:pointer;font-size:11.5px;padding:4px 8px}
  #sg-chat button.on{border-color:#3ddc84;color:#3ddc84}
  #sg-chat .sub{color:#9fb3c8;font-size:11.5px;margin:6px 0 8px}
  #sg-chat .it{border:1px solid #2b3a4c;border-radius:10px;padding:8px 10px;margin-bottom:7px;background:#05070a}
  #sg-chat .it.handoff{border-color:#ffb454} #sg-chat .it.done{border-color:#3ddc84} #sg-chat .it.error{border-color:#ff6b6b}
  #sg-chat .t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #sg-chat .st{color:#9fb3c8;font-size:11.5px} #sg-chat .why{color:#ffb454;font-size:11.5px}
  #sg-chat .inf{color:#3ddc84;font-size:12px;margin-top:3px} #sg-chat .rp{color:#cbd5e1;font-size:11.5px;margin-top:3px;cursor:help;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #sg-chat .acts{display:flex;gap:5px;margin-top:6px}
  #sg-chat details.ask{margin-top:4px;font-size:11.5px} #sg-chat details.ask summary{cursor:pointer;color:#9fb3c8}
  #sg-chat .zh{color:#cbd5e1;margin-top:4px} #sg-chat .ko{color:#7cb3ff} #sg-chat .nx{color:#9fb3c8;font-size:11.5px;margin-top:3px}`;
  const trMode = () => { try { return localStorage.getItem("sgTrMode") || "below"; } catch { return "below"; } };
  const applyMode = () => { // 미리 불러올 때는 html이 아직 없을 수 있음 · 안쪽 프레임(대화가 든 곳)에도 알린다
    document.documentElement?.setAttribute("data-sg-tr-mode", trMode());
    for (const f of document.querySelectorAll("iframe")) { try { f.contentWindow.postMessage({ sgTrMode: trMode() }, "*"); } catch {} }
  };
  applyMode(); setInterval(applyMode, 2000); // 페이지가 html 속성을 지워도 다시
  // 위치·크기: 머리줄을 끌어 옮기고, 오른쪽 아래 모서리로 크기 조절 — 이 PC에 기억
  const KEY = "sgChatBox";
  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const keep = (patch) => { try { localStorage.setItem(KEY, JSON.stringify({ ...(saved() || {}), ...patch })); } catch {} };
  function placeBox() {
    const b = saved(); if (!b) return;
    const W = innerWidth, H = innerHeight;
    if (b.w) box.style.width = Math.min(b.w, W - 20) + "px";
    if (b.h) { box.style.height = Math.min(b.h, H - 20) + "px"; box.style.maxHeight = "none"; }
    if (b.x != null) { box.style.left = Math.max(0, Math.min(b.x, W - 120)) + "px"; box.style.top = Math.max(0, Math.min(b.y, H - 40)) + "px"; box.style.right = "auto"; }
  }
  function dragBox() {
    box.addEventListener("mousedown", (e) => {
      if (!e.target.closest(".hd") || e.target.closest("button")) return;
      const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        const x = Math.max(0, Math.min(ev.clientX - dx, innerWidth - 120)), y = Math.max(0, Math.min(ev.clientY - dy, innerHeight - 40));
        Object.assign(box.style, { left: x + "px", top: y + "px", right: "auto" });
      };
      const up = () => { removeEventListener("mousemove", move, true); removeEventListener("mouseup", up, true); const r2 = box.getBoundingClientRect(); keep({ x: Math.round(r2.left), y: Math.round(r2.top) }); };
      addEventListener("mousemove", move, true); addEventListener("mouseup", up, true);
      e.preventDefault();
    });
    // 크기 조절(오른쪽 아래 모서리 손잡이): 사용자가 끌어서 크기가 바뀐 경우에만 저장
    let before = null;
    box.addEventListener("mousedown", () => { const r = box.getBoundingClientRect(); before = { w: r.width, h: r.height }; }, true);
    addEventListener("mouseup", () => {
      if (!before || !open) return;
      const r = box.getBoundingClientRect();
      if (Math.abs(r.width - before.w) > 2 || Math.abs(r.height - before.h) > 2) { keep({ w: Math.round(r.width), h: Math.round(r.height) }); box.style.maxHeight = "none"; }
      before = null;
    }, true);
  }
  const dots = (q) => Array.from({ length: q.total }, (_, i) => (i < q.stage ? "●" : "○")).join("");
  const infoKo = (f) => [f.stock ? `재고 ${f.stock}` : "", f.carton ? `박스 ${f.carton}개` : f.single ? "외박스 없음(낱개 발송)" : "", f.size ? `크기 ${f.size}` : "", f.weight ? `무게 ${f.weight}` : "", f.blankBox ? `무지/영문 박스 ${f.blankBox}` : ""].filter(Boolean).join(" · ");
  function render(s) {
    last = s;
    if (!box) {
      const st = document.createElement("style"); st.textContent = CSS; document.documentElement.appendChild(st);
      box = document.createElement("div"); box.id = "sg-chat";
      placeBox(); dragBox();
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-a]"); if (!b) return;
        const a = b.dataset.a, id = b.dataset.id;
        if (a === "min") { open = !open; render(last); return; }
        if (a === "trmode") { // 아래 한글 → 한글로 바꾸기 → 끄기 → … (이 PC에 기억)
          const next = { below: "replace", replace: "off", off: "below" }[trMode()];
          try { localStorage.setItem("sgTrMode", next); } catch {}
          applyMode();
          if (next !== "off" && last && !last.tr) ipcRenderer.invoke("chat:act", { a: "tr" }); // 예전에 끈 번역 다시 켜기
          render(last); return;
        }
        ipcRenderer.invoke("chat:act", { a, id });
      });
    }
    if (!box.isConnected) (document.body || document.documentElement).appendChild(box);
    box.classList.toggle("busy", !!s.busy); box.classList.toggle("min", !open);
    if (!open) box.style.height = ""; else if (saved()?.h && !box.style.height) placeBox();
    box.innerHTML = `<div class="hd" title="끌어서 옮기기 · 오른쪽 아래 모서리를 끌면 크기 조절"><span class="grip">⋮⋮</span><b data-a="min">💬 문의 도우미 ${s.busy ? "⏳" : ""}</b>
      <button data-a="auto" class="${s.auto ? "on" : ""}" title="판매자 답이 오면 다음 질문을 자동으로 이어서 보냅니다">${s.auto ? "자동 ON" : "자동 OFF"}</button>
      <button data-a="trmode" class="${trMode() !== "off" ? "on" : ""}" title="누를 때마다: 중국어 아래 한글 → 한글로 바꾸기(마우스를 올리면 중국어) → 번역 끄기 · ${esc(s.trEngine)}">🌐 ${{ below: "아래 한글", replace: "한글로", off: "번역 끔" }[trMode()]}</button>
      <button data-a="back" title="1688 상품 화면으로">← 1688</button></div>
      <div class="bd"><div class="sub">오늘 보낸 메시지 ${s.today.sends} · 새 판매자 ${s.today.sellers}곳 · 1.5~3분마다 한 곳씩 답 확인</div>
      ${s.items.map((q) => `<div class="it ${q.status}">
        <div class="t" title="${esc(q.title)}">${esc(q.company || q.title)}</div>
        <div class="st">${dots(q)} ${esc(q.statusKo)}${q.status === "waiting" && q.nextKo ? ` · 다음: ${esc(q.nextKo)}` : ""}</div>
        ${q.reason ? `<div class="why">${esc(q.reason)}</div>` : ""}
        ${q.asked.length ? `<details class="ask"><summary>AI가 보낸 말 ${q.asked.length}개</summary>${q.asked.map((a) => `<div class="zh">${esc(a.zh)}</div><div class="ko">${esc(a.ko)}</div>`).join("")}</details>` : ""}
        ${q.status === "waiting" && q.nextZh ? `<div class="nx" title="${esc(q.nextZh)}">다음에 보낼 말: ${esc(q.nextKoFull || q.nextZh)}</div>` : ""}
        ${infoKo(q.info) ? `<div class="inf">${esc(infoKo(q.info))}</div>` : ""}
        ${q.lastReply ? `<div class="rp" title="${esc(q.replies.join("\n"))}">💬 ${esc(q.lastReply)}</div>` : ""}
        <div class="acts"><button data-a="open" data-id="${q.id}">대화 보기</button>
        ${["handoff", "paused", "error"].includes(q.status) ? `<button data-a="resume" data-id="${q.id}" title="다시 자동으로 이어 묻기">▶ 이어서</button>` : q.status === "waiting" ? `<button data-a="check" data-id="${q.id}" title="답이 왔는지 지금 확인(자동으로도 1.5~3분마다 확인)">🔄 지금 확인</button><button data-a="pause" data-id="${q.id}">⏸ 멈춤</button>` : ""}
        <button data-a="remove" data-id="${q.id}" title="목록에서 지우기(대화는 1688에 남음)">✕</button></div>
      </div>`).join("") || `<div class="sub">아직 문의가 없습니다 — 1688 상품 페이지의 '💬 AI 문의'를 누르세요</div>`}</div>`;
  }
  ipcRenderer.on("chat:state", (_e, s) => render(s));
  const boot = () => ipcRenderer.invoke("chat:state").then(render).catch(() => {});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  setInterval(() => { if (box && !box.isConnected && last) render(last); }, 1500);
}
