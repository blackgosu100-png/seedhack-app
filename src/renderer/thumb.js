// 🖼 쿠팡 썸네일 탭 — 상세페이지 결과 화면 맨 위 [📄 상세페이지 | 🖼 썸네일] 탭.
// 쿠팡 등록 순서 그대로(대표 1 + 추가 1~9 칸) 보여 주고, 칸을 누르면 아래에 크게 + 대표로·빼기·순서.
// 상세페이지가 끝나면 메인(thumb.js auto)이 뒤에서 자동으로 만든다 — 여기서는 실제 진행만 보여 준다(가독성 매뉴얼 2-9).
(() => {
  const api = window.signal;
  const root = document.getElementById("detail");
  if (!root || !api) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fileUrl = (p) => { const parts = String(p).replace(/\\/g, "/").split("/"); return "file://" + (parts[0] === "" ? "" : "/") + parts.map((x) => encodeURIComponent(x).replace(/%3A/gi, ":")).join("/"); }; // 윈도우 C:\… → file:///C:/…
  const KIND = { hero: "흰 바탕 대표", scene_person: "사용 장면(인물)", appeal: "소구점", bcut: "다른 각도", detail: "상세 일부", scene: "사용 장면", size: "사이즈", options: "색상·옵션", feature: "핵심 기능", package: "구성품" };
  const HERO_OK = new Set(["hero", "bcut"]);
  const ST = { ok: ["✔ 통과", "ok"], warn: ["⚠ 확인", "warn"], bad: ["✕ 빠짐", "bad"] };
  const KRW = 1400, MAX_EXTRA = 9;

  const css = document.createElement("style");
  css.textContent = `
  .th-tabs{flex:none;display:inline-flex;gap:2px;margin-left:10px;padding:3px;border-radius:10px;background:#f3f4f6}
  .th-tabs button{height:30px;padding:0 12px;border:0;border-radius:8px;background:none;font:700 13px/1 inherit;color:#6b7280;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
  .th-tabs button.on{background:#fff;color:#111827;box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .th-tabs em{font-style:normal;font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;background:#e5e7eb;color:#4b5563}
  .th-tabs em.run{background:#dcfce7;color:#15803d}
  #detail.th-on #drMeta,#detail.th-on #drTabs,#detail.th-on #drTplPick,#detail.th-on #drSumWrap,#detail.th-on .dt-rbody,#detail.th-on #drExport,
  #detail.th-on #drFigma,#detail.th-on #drHtml,#detail.th-on #drTpl,#detail.th-on #drExpGo,#detail.th-on #drQa,#detail.th-on #drTimes{display:none!important}
  #detail:not(.th-on) #dtThumbView{display:none}
  #dtThumbView{padding:16px 0 40px;color:#1f2937;font-size:14px}
  .th-top{display:flex;align-items:flex-end;gap:28px;flex-wrap:wrap;margin-bottom:18px}
  .th-top .lead{flex:1 1 260px}.th-top h3{font-size:18px;margin:0 0 4px}.th-top small{color:#6b7280;font-size:12px}
  .th-num{display:flex;flex-direction:column;min-width:56px}.th-num b{font-size:26px;font-weight:800;line-height:1.1}.th-num span{font-size:12px;color:#6b7280}
  .th-num.g b{color:#16a34a}.th-num.o b{color:#ea580c}
  .th-acts{display:flex;gap:6px;align-items:center}
  .th-acts button{height:36px;border-radius:9px;border:1px solid #e5e7eb;background:#f7f7f8;padding:0 12px;font:600 13px/1 inherit;cursor:pointer;color:#1f2937}
  .th-acts button.ic{width:36px;padding:0}
  .th-acts button.pri{background:#16a34a;border-color:#16a34a;color:#fff;padding:0 16px}
  .th-strip{display:flex;gap:10px;align-items:flex-end;overflow-x:auto;padding:4px 2px 10px}
  .th-slot{flex:0 0 auto;width:96px;border:2px solid transparent;border-radius:12px;padding:4px;background:none;cursor:pointer;text-align:center}
  .th-slot.main{width:176px}
  .th-slot.on{border-color:#16a34a;background:#f0fdf4}
  .th-slot img{width:100%;aspect-ratio:1;display:block;border-radius:8px;border:1px solid #e5e7eb;background:#fff}
  .th-slot.off img{opacity:.35}
  .th-slot .no{display:block;font-size:12px;font-weight:800;color:#6b7280;margin:6px 0 2px}.th-slot.main .no{color:#15803d;font-size:13px}
  .th-slot .k{display:block;font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .th-slot .empty{width:100%;aspect-ratio:1;border:2px dashed #e5e7eb;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px}
  .th-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:1px}.th-dot.ok{background:#16a34a}.th-dot.warn{background:#ea580c}.th-dot.bad{background:#dc2626}
  .th-sep{width:1px;align-self:stretch;background:#e5e7eb;margin:0 4px}
  .th-pick{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:24px;align-items:start;margin-top:12px;padding-top:16px;border-top:1px solid #eef0f2}
  .th-pick img{width:100%;aspect-ratio:1;border:1px solid #e5e7eb;border-radius:12px;display:block;background:#fff}
  .th-pick h4{font-size:16px;margin:0 0 8px;display:flex;gap:8px;align-items:center}
  .th-chip{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:700}
  .th-chip.ok{background:#dcfce7;color:#15803d}.th-chip.warn{background:#ffedd5;color:#c2410c}.th-chip.bad{background:#fee2e2;color:#b91c1c}
  .th-pick ul{margin:6px 0 14px;padding-left:18px;color:#4b5563;line-height:1.7}
  .th-pick .row{display:flex;gap:8px;flex-wrap:wrap}
  .th-pick .row button{height:36px;border-radius:9px;border:1px solid #e5e7eb;background:#f7f7f8;padding:0 14px;font:600 13px/1 inherit;cursor:pointer}
  .th-pick .row button:disabled{opacity:.4;cursor:default}
  .th-opts{margin-top:22px;border-top:1px solid #eef0f2;padding-top:14px}
  .th-opts summary{cursor:pointer;font-weight:700;list-style:none}
  .th-ogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-top:12px}
  .th-ogrid figure{margin:0}.th-ogrid img{width:100%;aspect-ratio:1;border:1px solid #e5e7eb;border-radius:8px;display:block}
  .th-ogrid figcaption{font-size:12px;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .th-note{color:#6b7280;font-size:12px;margin-top:10px}
  .th-start{margin:24px 0;padding:36px 24px;text-align:center;background:#f9fafb;border-radius:14px}
  .th-start h3{font-size:20px;margin:0 0 6px}.th-start p{color:#6b7280;margin:0 0 18px}
  .th-start button{height:46px;padding:0 26px;font-size:15px;border-radius:12px;border:0;font-weight:700;cursor:pointer;background:#16a34a;color:#fff}
  .th-run{margin:16px 0;padding:24px;border-radius:14px;background:#0b1220;color:#d1fae5;font-family:ui-monospace,Menlo,monospace}
  .th-run b{font-size:20px;color:#4ade80}.th-run .bar{height:8px;border-radius:8px;background:#1f2937;margin:14px 0 10px;overflow:hidden}.th-run .bar i{display:block;height:100%;background:#22c55e;transition:width .4s}
  .th-run small{color:#94a3b8}
  .th-err{margin:12px 0;padding:12px 14px;border-radius:10px;background:#fef2f2;color:#b91c1c}
  .th-auto{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;cursor:pointer;margin-top:12px}
  @media (max-width:760px){.th-pick{grid-template-columns:1fr}}`;
  document.head.appendChild(css);

  let jobId = null, data = null, sel = null, timer = 0, auto = true, tab = "detail", msg = "";
  const job = () => root.dataset.job || jobId;

  // 탭 막대 + 썸네일 칸을 결과 화면에 붙인다(detail.js 가 화면을 다시 그려도 다시 붙음)
  function ensureDom() {
    const res = root.querySelector(".dt-result"); if (!res) return;
    const head = res.querySelector(".dt-rhead");
    if (head && !head.querySelector(".th-tabs")) {
      const t = document.createElement("div"); t.className = "th-tabs"; t.setAttribute("role", "tablist");
      t.innerHTML = `<button type="button" data-tab="detail" role="tab">📄 상세페이지</button><button type="button" data-tab="thumb" role="tab">🖼 썸네일 <em id="thBadge"></em></button>`;
      t.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
      // 맨 위 고정 한 줄 안, 제목 바로 오른쪽(왼쪽 정렬 유지 · 머리줄은 한 줄만 — 매뉴얼 추가 기록 2026-10-10)
      const line = head.querySelector(".dt-rline"), title = line?.querySelector("#drTitle");
      if (title) title.after(t); else if (line) line.prepend(t); else head.prepend(t);
    }
    if (!res.querySelector("#dtThumbView")) {
      const v = document.createElement("div"); v.id = "dtThumbView"; v.addEventListener("click", onClick); v.addEventListener("change", onChange);
      (head || res.firstChild)?.after(v);
    }
    root.querySelector("#drThumb")?.remove(); // 옛 🖼 버튼(이전 판)
    paintTabs();
  }
  function setTab(t) { tab = t; root.classList.toggle("th-on", t === "thumb"); paintTabs(); if (t === "thumb") refresh(); }
  function paintTabs() {
    root.querySelectorAll(".th-tabs [data-tab]").forEach((b) => { b.classList.toggle("on", b.dataset.tab === tab); b.setAttribute("aria-selected", b.dataset.tab === tab); });
    const badge = root.querySelector("#thBadge"); if (!badge) return;
    const r = data || {};
    const cls = r.run?.running ? "run" : "", txt = r.run?.running ? (r.run.waiting ? "곧 시작" : `만드는 중 ${r.run.pct || 0}%`) : r.result ? `${exportCount(r.result)}장` : "";
    if (badge.className !== cls) badge.className = cls;
    if (badge.textContent !== txt) badge.textContent = txt;
    if (badge.hidden !== !txt) badge.hidden = !txt;
  }
  const exportCount = (res) => { const [h, ...rest] = res.items || []; return h ? 1 + Math.min(MAX_EXTRA, rest.filter((x) => !x.excluded && x.status !== "bad").length) : 0; };

  root.addEventListener("dt:result", (e) => { const id = e.detail?.jobId || null; if (id !== jobId) { sel = null; msg = ""; data = null; if (jobId) setTab("detail"); } jobId = id; ensureDom(); refresh(); });
  // detail.js 가 결과 화면을 다시 그려 탭·칸이 사라졌을 때만 다시 붙인다(배지 글자 바뀜에는 반응하지 않게 — 무한 반복 방지)
  new MutationObserver(() => { if (root.querySelector(".dt-result") && (!root.querySelector(".th-tabs") || !root.querySelector("#dtThumbView"))) ensureDom(); }).observe(root, { childList: true, subtree: true });
  api.on?.("detail:changed", (d) => { if (d?.thumb && d.thumb.jobId === job()) refresh(); });
  api.invoke("thumb:settings", {}).then((s) => { auto = s?.thumbAuto !== false; }).catch(() => {});
  ensureDom();

  async function refresh() {
    if (!job()) return;
    const r = await api.invoke("thumb:get", { jobId: job() }).catch((e) => ({ error: String(e) }));
    data = r; paintTabs(); if (tab === "thumb") paint();
    clearTimeout(timer);
    if (r?.run?.running) timer = setTimeout(refresh, tab === "thumb" ? 800 : 3000); // 탭이 닫혀 있어도 배지는 움직인다
  }

  function paint() {
    const view = root.querySelector("#dtThumbView"); if (!view) return;
    const r = data || {};
    if (r.error) { view.innerHTML = `<div class="th-err">${esc(r.error)}</div>`; return; }
    if (r.run?.running) {
      const sec = Math.round((Date.now() - r.run.t0) / 1000);
      view.innerHTML = `<div class="th-run"><b>${esc(r.run.msg || "준비 중")}</b><div class="bar"><i style="width:${Math.max(3, r.run.pct || 0)}%"></i></div><small>${r.run.waiting ? "상세페이지 뒤 검수가 끝나면 이어서 만들어요" : `${r.run.pct || 0}% · ${sec}초 지남 · 제품은 실제 사진 그대로, AI는 배경·인물만`}</small></div>`;
      return;
    }
    const res = r.result;
    const err = r.run?.error ? `<div class="th-err">만들지 못했습니다 · ${esc(r.run.error)}</div>` : "";
    const autoSw = `<label class="th-auto" data-tip="상세페이지가 끝나면 썸네일을 뒤에서 자동으로 만들어요"><input type="checkbox" id="thAuto"${auto ? " checked" : ""}> 상세페이지가 끝나면 자동으로 만들기</label>`;
    if (!res) {
      view.innerHTML = `${err}<div class="th-start"><h3>대표이미지 1장 + 추가이미지 9장</h3><p>흰 바탕 대표 · 사용 장면 · 소구점 · 사이즈 · 옵션별 대표 — 약 4~9분</p><button type="button" data-act="run">▶ 썸네일 만들기</button><br>${autoSw}</div>`;
      return;
    }
    const items = res.items || [], [hero, ...extras] = items;
    const used = extras.filter((x) => !x.excluded && x.status !== "bad");
    const shown = new Set(used.slice(0, MAX_EXTRA).map((x) => x.id));
    const warnN = [hero, ...used.slice(0, MAX_EXTRA)].filter((x) => x?.status === "warn").length;
    const won = Math.round((res.cost?.imageUsd || 0) * KRW);
    const cur = items.find((x) => x.id === sel) || hero;
    const t = Date.parse(res.edited || res.createdAt) || 0;
    const slot = (x, i) => {
      const off = i > 0 && !shown.has(x.id);
      return `<button type="button" class="th-slot${i === 0 ? " main" : ""}${x.id === cur?.id ? " on" : ""}${off ? " off" : ""}" data-pick="${esc(x.id)}" data-tip="${esc(KIND[x.kind] || x.kind)}${(x.issues || []).length ? " · " + esc(x.issues.map((q) => q.why).join(" · ")) : ""}">
        <img src="${fileUrl(x.path)}?t=${t}" alt="" loading="lazy"><span class="no"><i class="th-dot ${off ? "bad" : ST[x.status][1]}"></i>${i === 0 ? "대표" : off ? "빠짐" : `추가 ${[...shown].indexOf(x.id) + 1}`}</span><span class="k">${esc(KIND[x.kind] || x.kind)}</span></button>`;
    };
    const empties = Math.max(0, MAX_EXTRA - shown.size);
    const idx = items.indexOf(cur);
    const om = (res.optionMains || []).filter((o) => o.path);
    view.innerHTML = `${err}
      <div class="th-top"><div class="lead"><h3>${warnN ? `쿠팡에 올릴 준비 · 확인 ${warnN}장` : "쿠팡에 바로 올릴 수 있어요"}</h3><small>${new Date(res.edited || res.createdAt).toLocaleString("ko-KR")}${res.edited ? " 고침" : ""} · 만드는 데 ${Math.round((res.timings?.total || 0) / 1000)}초</small></div>
        <div class="th-num"><b>${1 + Math.min(MAX_EXTRA, used.length)}장</b><span>대표 1 + 추가 ${Math.min(MAX_EXTRA, used.length)}</span></div>
        <div class="th-num ${warnN ? "o" : "g"}"><b>${warnN ? warnN : "✔"}</b><span>${warnN ? "확인 필요" : "모두 통과"}</span></div>
        <div class="th-num"><b>${won.toLocaleString()}원</b><span>이미지 생성</span></div>
        <div class="th-acts"><button type="button" class="pri" data-act="export" data-tip="⬇ 대표 + 추가 + 옵션별 대표를 1000×1000 JPG로 저장">⬇ JPG로 저장</button>
          <button type="button" class="ic" data-act="run" data-tip="↻ 처음부터 다시 만들기(약 4~9분)" aria-label="다시 만들기">↻</button>
          <button type="button" class="ic" data-act="folder" data-tip="📂 썸네일 폴더 열기" aria-label="썸네일 폴더 열기">📂</button></div></div>
      ${msg ? `<div class="th-note">${esc(msg)}</div>` : ""}
      <div class="th-strip" role="list" aria-label="쿠팡 등록 순서">${slot(hero, 0)}<span class="th-sep"></span>${extras.filter((x) => shown.has(x.id)).map((x) => slot(x, 1)).join("")}${Array.from({ length: empties }, () => `<div class="th-slot"><div class="empty">비어 있음</div><span class="no">추가</span></div>`).join("")}${extras.some((x) => !shown.has(x.id)) ? `<span class="th-sep"></span>${extras.filter((x) => !shown.has(x.id)).map((x) => slot(x, 1)).join("")}` : ""}</div>
      ${cur ? `<div class="th-pick"><img src="${fileUrl(cur.path)}?t=${t}" alt="${esc(KIND[cur.kind])}">
        <div><h4>${idx === 0 ? "대표" : shown.has(cur.id) ? `추가 ${[...shown].indexOf(cur.id) + 1}` : "빠짐"} · ${esc(KIND[cur.kind] || cur.kind)} <span class="th-chip ${ST[cur.status][1]}">${ST[cur.status][0]}</span></h4>
          <ul>${(cur.issues || []).length ? cur.issues.map((q) => `<li>${esc(q.why)}</li>`).join("") : `<li>${cur.kind === "hero" || cur.kind === "bcut" ? "흰 바탕 · 글자 없음 · 실제 제품 사진" : cur.kind === "detail" ? "한글 상세페이지에서 잘라 낸 장" : "제품은 실제 사진 그대로"}</li>`}${(cur.labels || []).length ? `<li>넣은 글: ${cur.labels.map(esc).join(" · ")}</li>` : ""}</ul>
          <div class="row">
            ${idx === 0 ? "" : `<button type="button" data-act="hero" ${HERO_OK.has(cur.kind) && cur.status !== "bad" ? "" : "disabled"} data-tip="${HERO_OK.has(cur.kind) ? "⭐ 이 사진을 대표로 — 지금 대표는 추가 1번으로" : "대표는 흰 바탕 사진만 됩니다(쿠팡 기준)"}">⭐ 대표로</button>`}
            ${idx === 0 ? "" : cur.excluded ? `<button type="button" data-act="include" data-tip="↩ 다시 추가이미지에 넣기">↩ 다시 넣기</button>` : `<button type="button" data-act="exclude" data-tip="🙈 추가이미지에서 빼기 — 다음 장이 앞으로 와요" ${cur.status === "bad" ? "disabled" : ""}>🙈 빼기</button>`}
            ${idx > 0 && shown.has(cur.id) ? `<button type="button" data-act="move" data-dir="-1" data-tip="◀ 앞으로" aria-label="앞으로">◀</button><button type="button" data-act="move" data-dir="1" data-tip="▶ 뒤로" aria-label="뒤로">▶</button>` : ""}
          </div>
          ${res.notes?.length ? `<div class="th-note">${res.notes.map(esc).join("<br>")}</div>` : ""}</div></div>` : ""}
      ${om.length ? `<details class="th-opts"><summary>옵션별 대표이미지 ${om.length}장 ▾</summary><div class="th-ogrid">${om.map((o) => `<figure><img src="${fileUrl(o.path)}?t=${t}" alt="" loading="lazy" data-tip="${esc(o.src || o.name || "")}"><figcaption><i class="th-dot ${ST[o.status][1]}"></i>${esc(o.name || o.id)}</figcaption></figure>`).join("")}</div></details>` : ""}
      ${autoSw}`;
  }

  async function onClick(e) {
    const a = e.target.closest("[data-act],[data-pick]"); if (!a || a.disabled) return;
    if (a.dataset.pick) { sel = a.dataset.pick; msg = ""; paint(); return; }
    const act = a.dataset.act;
    if (act === "folder") return api.invoke("thumb:openFolder", { jobId: job() });
    if (act === "run") { a.disabled = true; const r = await api.invoke("thumb:run", { jobId: job() }); if (r?.error) { data = { error: r.error }; paint(); return; } sel = null; msg = ""; return refresh(); }
    if (act === "export") { a.disabled = true; const r = await api.invoke("thumb:export", { jobId: job() }); a.disabled = false; msg = r?.ok ? `✔ ${r.files.length}장 저장 · ${r.dir}` : `저장 실패 · ${r?.error || ""}`; return paint(); }
    if (["hero", "exclude", "include", "move"].includes(act)) {
      const cur = sel || data?.result?.items?.[0]?.id;
      const r = await api.invoke("thumb:update", { jobId: job(), op: act, id: cur, dir: Number(a.dataset.dir || 0) });
      if (r?.error) { msg = r.error; return paint(); }
      data = { ...data, result: r.result }; msg = act === "hero" ? "⭐ 대표를 바꿨어요 — 원래 대표는 추가 1번으로" : ""; paintTabs(); paint();
    }
  }
  async function onChange(e) {
    if (e.target.id !== "thAuto") return;
    const s = await api.invoke("thumb:settings", { thumbAuto: e.target.checked }).catch(() => null);
    auto = s?.thumbAuto !== false;
  }
})();
