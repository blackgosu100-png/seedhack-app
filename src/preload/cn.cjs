// 📦 1688 화면 도우미 — 리스트업 행에서 🔍1688로 들어왔을 때, 1688 상품 페이지에 "리스트업에 넣기" 상자를 띄운다.
// 사용자가 연 페이지의 글자만 읽고(추가 요청 없음), 가격은 사용자가 확인·수정한 뒤 넣는다. 슬라이드 인증 등은 사람이 직접.
const { ipcRenderer } = require("electron");

// 1688 상품 번호: detail.1688.com/offer/123.html 또는 (해외판 등) 주소의 offerId=123
function offerId() {
  if (location.protocol === "file:") { const t = location.pathname.match(/\/test\/offer\/(\d+)\.html$/); return t ? t[1] : /\/test\/detail\/fixture\/offer\.html$/.test(location.pathname) ? "900000001" : null; } // 자체 점검용 (📄 상세페이지 fixture 는 900000001)
  if (!/(^|\.)1688\.com$/i.test(location.hostname)) return null;
  const m = location.pathname.match(/\/offer\/(\d+)\.html/) || location.search.match(/[?&](?:offerId|offer_id|id)=(\d{6,})/);
  return m ? m[1] : null;
}
function isOffer() { return !!offerId(); }

// 가격 읽기: ① ¥/￥가 붙은 숫자 ② 숫자만 든 가격 칸(price-text 등) 순서로 찾고, 가장 작은 값(수량 구간이면 대량 구매가)을 쓴다.
// "2-99件"처럼 뒤에 件·个·套·起·pcs가 붙은 수량 숫자는 가격이 아니므로 뺀다. 못 찾으면 빈칸(직접 입력).
function readPrice() {
  const yen = [], bare = [];
  const ok = (v) => v > 0 && v < 100000;
  const priceEls = [...document.querySelectorAll('[class*="price" i], [class*="Price"]')].filter((el) => el.children.length <= 6);
  priceEls.forEach((el) => {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 80) return;
    for (const m of t.matchAll(/[¥￥]\s*(\d{1,6}(?:\.\d{1,2})?)/g)) if (ok(+m[1])) yen.push(+m[1]);
    if (el.children.length === 0 && /^\d{1,6}(?:\.\d{1,2})?$/.test(t) && ok(+t)) bare.push(+t); // 숫자만 든 가격 칸
  });
  if (!yen.length && !bare.length) {
    const body = String(document.body?.innerText || "").slice(0, 8000);
    for (const m of body.matchAll(/[¥￥]\s*(\d{1,6}(?:\.\d{1,2})?)(?!\s*(?:件|个|套|起|pcs|개|세트|부터))/gi)) if (ok(+m[1])) yen.push(+m[1]);
  }
  const all = yen.length ? yen : bare;
  return all.length ? Math.min(...all) : null;
}
function readTitle() {
  // 1688 새 화면은 판매자 회사명 h1 이 상품명보다 먼저 나온다 → 회사명을 걸러 내는 상세 제목 읽기를 먼저 쓰고, 없으면 예전 방식
  try { const t = readDetailTitle()?.title; if (t) return String(t).replace(/\s+/g, " ").trim().slice(0, 120); } catch {}
  const h = document.querySelector('h1, [class*="title-text" i], [class*="offer-title" i], [class*="detail-title" i]');
  return (h?.textContent || document.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

// ---- 스스로 다시 찾기 (적응형 셀렉터) ----
// 1688이 class 이름을 바꿔도 멈추지 않게: 요소마다 ① 알고 있는 셀렉터 ② 태그·속성 ③ 글자 ④ class 조각 ⑤ 조상 class ⑥ 사진 포함 여부를 함께 기억해 두고,
// ①이 비면 ②~⑥으로 점수를 매겨 가장 비슷한 요소를 고른다. (Scrapling의 "Smart Element Tracking" 발상을 우리 코드에 옮긴 것)
const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const SPECS = {
  // 첫 화면 사진 검색 입력칸
  fileInput: { css: 'input.image-file-reader-wrapper, input.beacon-upload-input, input[type="file"][accept*="image"], input[type="file"][accept*=".jpg"], input[type="file"][accept*=".png"]',
    tag: "input", attr: { type: "file" }, accept: /jpg|jpeg|png|image/i, near: /以图搜款|图片搜索|搜图|上传图片|이미지\s*검색|사진\s*업로드|이미지\s*업로드|image/i, cls: /image|upload|file|search/i, needVisible: false },
  // 사진 올린 뒤 뜨는 "搜索图片" 확인 버튼
  confirm: { css: '.copy-image-container .search-btn, [class*="copy-image"] [class*="search-btn"], [class*="image-search-panel__confirm"] button, [class*="image-search-panel"] button.beacon-btn--primary',
    tag: "button,div,span,a", text: /^(搜索图片|搜索|以图搜款|确认|确定|이미지\s*검색|사진\s*검색|검색|확인)$/, cls: /search|btn|confirm|submit/i, within: /copy-image|image-search|upload|paste/i },
  // 상품 페이지 1단계 옵션 버튼(사진 + 이름)
  level1: { css: ".module-od-sku-selection .sku-filter-button", many: true, tag: "button,div,li", hasImg: true, cls: /sku|filter|prop|spec/i, within: /sku|prop|spec/i, textMax: 40, minCount: 2, innermost: true },
  // 상품 페이지 가격 행(옵션명 · ¥가격 · 库存)
  item: { css: ".module-od-sku-selection .expand-view-item", many: true, tag: "div,li,tr", text: /[¥￥]\s*\d/, textAlso: /库存|起批|可售|재고|도매|판매\s*가능|구매\s*가능/, within: /sku|prop|spec|price/i, textMax: 120, innermost: true },
  // 결과 목록 카드(상품명 · ¥ · 回头率 · 회사)
  card: { css: '[class*="searchOfferWrapper"]', many: true, tag: "div,li,a", text: /[¥￥]\s*\d/, textAlso: /回头率|件|年|재구매|구매|판매|년/, cls: /offer|card|item|wrapper/i, textMax: 600, innermost: true, minCount: 5 },
};
const adaptiveLogged = new Set();
function scoreEl(e, sp) {
  let sc = 0;
  const cls = String(e.className || "");
  const txt = (e.textContent || "").replace(/\s+/g, " ").trim();
  if (sp.attr) for (const [k, v] of Object.entries(sp.attr)) { if ((e.getAttribute(k) || "") !== v) return -1; sc += 3; }
  if (sp.accept && !sp.accept.test(e.getAttribute("accept") || "")) sc -= 1; else if (sp.accept) sc += 2;
  if (sp.textMax && txt.length > sp.textMax) return -1;
  if (sp.text) { if (!sp.text.test(txt)) return -1; sc += 3; }
  if (sp.textAlso && sp.textAlso.test(txt)) sc += 1;
  if (sp.cls && sp.cls.test(cls)) sc += 2;
  if (sp.hasImg) { if (!e.querySelector("img")) return -1; sc += 2; }
  if (sp.within) { let p = e.parentElement, hit = false; for (let d = 0; p && d < 8; d++, p = p.parentElement) if (sp.within.test(String(p.className || ""))) { hit = true; break; } if (hit) sc += 2; }
  if (sp.near) { const around = (e.parentElement?.parentElement?.textContent || e.parentElement?.textContent || "").slice(0, 300); if (sp.near.test(around)) sc += 2; }
  if (sp.needVisible !== false) sc += vis(e) ? 1 : -2;
  return sc;
}
function findAdaptive(name) {
  const sp = SPECS[name];
  const direct = [...document.querySelectorAll(sp.css)];
  if (direct.length >= (sp.minCount || 1)) return sp.many ? direct : direct[0];
  // 셀렉터가 비었다 → 비슷한 요소 찾기
  const cands = [...document.querySelectorAll(sp.tag)].map((e) => ({ e, sc: scoreEl(e, sp) })).filter((x) => x.sc >= 3);
  if (!cands.length) return sp.many ? [] : null;
  let picked;
  if (sp.many) {
    let els = cands.sort((a, b) => b.sc - a.sc).map((x) => x.e);
    if (sp.innermost) els = els.filter((e) => !els.some((o) => o !== e && e.contains(o))); // 안쪽 것만(카드/행 단위)
    if (els.length < (sp.minCount || 1)) return [];
    picked = els;
  } else picked = cands.sort((a, b) => b.sc - a.sc)[0].e;
  if (!adaptiveLogged.has(name)) {
    adaptiveLogged.add(name);
    const sample = sp.many ? picked[0] : picked;
    ipcRenderer.send("cn:log", `1688 화면이 바뀌어 '${name}' 요소를 다시 찾았습니다 → ${sample.tagName.toLowerCase()}.${String(sample.className || "").split(/\s+/)[0].slice(0, 40)}${sp.many ? ` (${picked.length}개)` : ""}`);
  }
  return picked;
}
const priceOf = (t) => (String(t || "").match(/[¥￥]\s*\d+(?:\.\d+)?/) || [""])[0].replace(/\s+/g, "");

// ---- 옵션(SKU) 읽기 ----
// 1단계(규격/색상 버튼, 사진 있음): .sku-filter-button  ·  가격 목록(선택된 1단계의 하위): .expand-view-item  — 이름이 바뀌면 findAdaptive 가 대신 찾는다
const imgSrc = (el) => { const i = el?.querySelector("img"); return i ? (i.currentSrc || i.src || "") : ""; };
function readLevel1() {
  return findAdaptive("level1").map((b, i) => ({
    i, label: (b.querySelector(".label-name, [class*='label' i], [class*='name' i]")?.textContent || b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
    img: imgSrc(b), active: b.classList.contains("active") || /\bactive\b|selected|checked/i.test(String(b.className)) || b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-pressed") === "true", el: b,
  }));
}
function readItems() {
  return findAdaptive("item").map((r, i) => {
    const labelEl = r.querySelector(".item-label, [class*='label' i], [class*='name' i], [title]");
    const full = (r.textContent || "").replace(/\s+/g, " ").trim();
    const price = (r.querySelector(".item-price-stock")?.textContent || "").trim() || priceOf(full);
    const label = (labelEl?.getAttribute("title") || labelEl?.textContent || full.split(/[¥￥]/)[0]).replace(/\s+/g, " ").trim().slice(0, 80);
    return { i, label, price, img: imgSrc(r) };
  }).filter((x) => x.label || x.price);
}
const pick = (arr) => arr.map(({ el, ...x }) => x); // IPC로 보낼 때 DOM 요소 제외
// 1688 보안 인증(슬라이더) 화면인지. 프로그램이 풀지 않는다 — 사람이 1688 탭에서 밀어야 한다.
const isCaptcha = () => /보안 인증|安全验证|滑动验证|验证码/.test(document.title || "") || /슬라이더를 드래그|滑动验证|请拖动滑块|拖动滑块|_____tmd_____|punish/i.test((document.body?.innerText || "").slice(0, 2000) + location.href);

// 상세 설명 글: 페이지 안의 detailUrl(itemcdn)에서 받아 글자만 남김. 그림으로 된 상세는 못 읽는다(빈 글).
async function readDetailText() {
  const scripts = [...document.scripts].map((s) => s.textContent || "").join("\n");
  const m = scripts.match(/"detailUrl"\s*:\s*"(https?:\\?\/\\?\/itemcdn[^"]+)"/);
  if (!m) return "";
  try {
    const r = await fetch(m[1].replace(/\\\//g, "/"), { credentials: "omit" });
    const t = await r.text();
    const inner = (t.match(/"content"\s*:\s*"([\s\S]*)"\s*}\s*;?\s*$/) || [])[1] || t;
    const html = inner.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\\"/g, '"').replace(/\\\//g, "/");
    return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").slice(0, 20000);
  } catch { return ""; }
}
const readAttrText = () => [...document.querySelectorAll('[class*="attribute" i]')].map((e) => (e.innerText || "")).join(" ").replace(/\s+/g, " ").slice(0, 4000);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 숨은 창(진짜 가격 확인): 상자 없이 옵션 가격만 읽어서 보고
async function probeOffer() {
  const id = offerId();
  const report = (r) => ipcRenderer.send("cn:probeResult", { offerId: id, ...r });
  if (isCaptcha()) return report({ price: null, how: "보안 인증", captcha: true });
  try {
    const level1 = await waitFor(() => { const l = readLevel1(); return l.length ? l : null; }, 5000) || [];
    let prefix = "";
    if (level1.length) {
      const r1 = await ipcRenderer.invoke("cn:sku", { stage: "level1", entries: pick(level1).map(({ i, label, img }) => ({ i, label, img })) });
      const best = r1?.ranked?.[0];
      if (best && r1.hasPhoto && best.dist != null) { const btn = level1[best.i]?.el; if (btn && !btn.classList.contains("active")) { btn.click(); await sleep(700); } prefix = best.label; }
      else prefix = (level1.find((x) => x.active) || level1[0]).label;
    }
    const items = await waitFor(() => { const l = readItems(); return l.length ? l : null; }, 5000) || [];
    if (!items.length) { const p = readPrice(); return report({ price: p, how: p != null ? "옵션 목록 없음 — 화면 가격" : "가격 없음", sure: false }); }
    const r2 = await ipcRenderer.invoke("cn:sku", { stage: "items", entries: pick(items) });
    const d = r2?.decision || {};
    const options = (r2?.ranked || []).slice(0, 10).map((x) => ({ label: (prefix ? prefix + " › " : "") + x.label, price: x.price, dist: x.dist ?? null, bait: !!x.bait }));
    report({ price: d.price ?? null, pick: d.pick ? { ...d.pick, label: (prefix ? prefix + " › " : "") + d.pick.label } : null, how: d.how || "", sure: !!d.sure, excluded: d.excluded || 0, options });
  } catch (e) { report({ price: null, how: "오류: " + (e?.message || e) }); }
}

async function start() {
  if (!isOffer() || document.getElementById("sg-cn-box")) return;
  if (await ipcRenderer.invoke("cn:probeMode")) return probeOffer();
  const target = await ipcRenderer.invoke("cn:target");
  if (!target) return; // 리스트업에서 들어온 게 아니면 아무것도 하지 않음

  // 상자: 가격 하나 · 옵션 한 줄 · 📦 한 줄 · 버튼 하나. 근거는 마우스를 올리면(title) 보인다.
  const style = document.createElement("style");
  style.textContent = `
  #sg-cn-box{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:300px;background:#0b0f14;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.4);font:13px/1.45 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
  #sg-cn-box .n{font-size:11.5px;color:#9fb3c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #sg-cn-box .price{display:flex;align-items:baseline;gap:8px;margin:6px 0 2px}
  #sg-cn-box .price input{width:120px;font:800 26px ui-monospace,Menlo,Consolas,monospace;color:#fff;background:transparent;border:0;border-bottom:1px solid #2b3a4c;padding:0 4px;outline:none}
  #sg-cn-box .price input:focus{border-color:#3ddc84}
  #sg-cn-box .price .cur{font-size:18px;font-weight:800;color:#9fb3c8}
  #sg-cn-box .price .warn{font-size:12px;color:#ffb454;margin-left:auto;cursor:help}
  #sg-cn-box .opt{font-size:12px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #sg-cn-box .opt .more{color:#7c9cff;cursor:pointer;margin-left:6px;white-space:nowrap}
  #sg-cn-box .alts{display:none;gap:6px;margin:8px 0 2px;flex-wrap:wrap;max-height:230px;overflow-y:auto} #sg-cn-box .alts.open{display:flex}
  #sg-cn-box .alt{width:62px;border:1px solid #2b3a4c;border-radius:8px;padding:3px;cursor:pointer;background:#05070a;text-align:center;font-size:10.5px;line-height:1.25;color:#cbd5e1}
  #sg-cn-box .alt img{width:54px;height:54px;object-fit:cover;border-radius:5px;display:block;margin:0 auto 2px;background:#111}
  #sg-cn-box .alt.on{border-color:#3ddc84;box-shadow:0 0 0 1px #3ddc84 inset} #sg-cn-box .alt .p{color:#fff;font-weight:700}
  #sg-cn-box .spec{font-size:12px;color:#cbd5e1;margin:8px 0 2px;cursor:help} #sg-cn-box .spec:empty{display:none} #sg-cn-box .spec .dim{color:#6b7f95}
  #sg-cn-box button.go{margin-top:10px;width:100%;border:0;border-radius:10px;padding:11px;background:#3ddc84;color:#06240f;font-weight:800;font-size:14px;cursor:pointer}
  #sg-cn-box .h{margin-top:6px;font-size:11.5px;color:#9fb3c8;min-height:1em} #sg-cn-box .ok{color:#3ddc84;font-weight:700}`;
  document.documentElement.appendChild(style);

  const box = document.createElement("div");
  box.id = "sg-cn-box";
  box.innerHTML = `<div class="n"><span style="font-family:ui-monospace,Menlo,Consolas,monospace;color:#3ddc84;font-weight:800">SEEDHACK</span> · <span class="nm"></span></div>
    <div class="price"><span class="cur">¥</span><input type="number" step="0.01" min="0" inputmode="decimal" placeholder="> 읽는 중"><span class="warn" hidden>⚠ 옵션 확인</span></div>
    <div class="opt"></div>
    <div class="alts"></div>
    <div class="spec"></div>
    <button type="button" class="go">리스트업에 넣기</button>
    <div class="h"></div>`;
  box.querySelector(".n .nm").textContent = target.name || "리스트업 상품";
  box.querySelector(".n").title = target.name || "";
  const input = box.querySelector("input"), optEl = box.querySelector(".opt"), altsEl = box.querySelector(".alts"), warnEl = box.querySelector(".warn"), specEl = box.querySelector(".spec");
  const setOpt = (label, ko, why) => { optEl.innerHTML = `<span title="${esc(why || "")}">${esc(ko || label || "")}</span>`; if (altsEl.children.length > 1) optEl.insertAdjacentHTML("beforeend", `<span class="more">다른 옵션 ▾</span>`); optEl.querySelector(".more")?.addEventListener("click", () => altsEl.classList.toggle("open")); };

  box.querySelector("button.go").addEventListener("click", async () => {
    const url = `https://detail.1688.com/offer/${offerId()}.html`;
    const r = await ipcRenderer.invoke("cn:pick", { url, yuan: input.value, title: readTitle(), option: box.dataset.option || "", specs: box.__specs || null });
    box.querySelector(".h").innerHTML = r?.ok ? `<span class="ok">✔ 넣었습니다</span>` : String(r?.error || "넣지 못했습니다");
  });
  const mount = () => { if (!box.isConnected) (document.body || document.documentElement).appendChild(box); if (!style.isConnected) document.documentElement.appendChild(style); };
  mount();
  setInterval(mount, 1500);

  // 📦 크기·무게·박스: 한 줄. 근거는 title 로.
  const loadSpecs = async () => {
    const [text, attrText] = [await readDetailText(), readAttrText()];
    const s = await ipcRenderer.invoke("cn:specs", { text, attrText, optionLabel: box.dataset.option || "" });
    if (!s?.found) { specEl.innerHTML = `<span class="dim">📦 크기·무게 없음 — 리스트업에서 입력</span>`; specEl.title = text ? "상세 글에 크기·무게가 없습니다" : "상세가 그림이라 읽을 수 없습니다"; box.__specs = null; return; }
    box.__specs = s;
    const cm = s.dims ? s.dims.split("x").map((v) => (v / 10).toFixed(1).replace(/\.0$/, "")).join("×") + "cm" : null;
    const kg = s.g != null ? (s.g >= 1000 ? (s.g / 1000).toFixed(2).replace(/\.?0+$/, "") + "kg" : s.g + "g") : null;
    specEl.innerHTML = `📦 ${[cm, kg, s.cartonQty ? s.cartonQty + "/박스" : null].filter(Boolean).join(" · ")}${s.ambiguous ? ` <span style="color:#ffb454">⚠</span>` : ""}`;
    specEl.title = `상세에서 읽음 (${s.dimsFrom || ""}): ${s.source.join(" · ")}${s.ambiguous ? "\n⚠ 변형별 값이 섞여 있어 확인 필요" : ""}\n넣기 때 리스트업 크기·무게 칸에 자동 입력`;
  };
  const showAlts = (alts, chosenI, prefix) => {
    altsEl.innerHTML = alts.map((a) => `<div class="alt ${a.i === chosenI ? "on" : ""}" data-i="${a.i}" data-price="${a.price ?? ""}" data-label="${esc(a.label)}" data-ko="${esc(a.ko || "")}" title="${esc(a.label)}${a.dist != null ? ` · 사진 차이 ${a.dist}` : ""}">
      ${a.img ? `<img src="${esc(a.img)}" alt="">` : ""}<span class="p">${a.price != null ? "¥" + a.price : "-"}</span></div>`).join("");
    altsEl.querySelectorAll(".alt").forEach((el) => el.addEventListener("click", () => {
      altsEl.querySelectorAll(".alt").forEach((x) => x.classList.toggle("on", x === el));
      if (el.dataset.price) input.value = el.dataset.price;
      box.dataset.option = (prefix ? prefix + " › " : "") + el.dataset.label;
      setOpt(el.dataset.label, el.dataset.ko, "직접 고른 옵션");
      if (el.dataset.price) ipcRenderer.send("cn:optPick", { offerId: offerId(), price: Number(el.dataset.price), label: box.dataset.option });
      loadSpecs();
    }));
  };

  try {
    // 1) 1단계 옵션(사진 버튼): 쿠팡 사진과 가장 비슷한 것을 골라 누른다
    let level1 = await waitFor(() => { const l = readLevel1(); return l.length ? l : null; }, 4000) || [];
    let prefix = "", why = "";
    if (level1.length) {
      const r1 = await ipcRenderer.invoke("cn:sku", { stage: "level1", entries: pick(level1).map(({ i, label, img }) => ({ i, label, img })) });
      const best = r1?.ranked?.[0];
      if (best && r1.hasPhoto && best.dist != null) {
        const btn = level1[best.i]?.el;
        if (btn && !btn.classList.contains("active")) { btn.click(); await sleep(700); }
        prefix = best.label; why = `1단계 옵션 ${best.label} (사진 차이 ${best.dist})`;
        if (best.dist > 14) warnEl.hidden = false;
      } else { prefix = (level1.find((x) => x.active) || level1[0]).label; why = `1단계 옵션 ${prefix} (사진 비교 못 함)`; warnEl.hidden = false; }
    }
    // 2) 가격 목록: 낚시 옵션 제외 후 사진과 같은 옵션의 가격
    const items = await waitFor(() => { const l = readItems(); return l.length ? l : null; }, 4000) || [];
    if (!items.length) {
      const p = readPrice(); if (p != null) input.value = p;
      setOpt("", "옵션 목록 없음", "화면의 가격을 넣었습니다 — 옵션별 가격을 직접 확인하세요"); warnEl.hidden = false;
      return loadSpecs();
    }
    const r2 = await ipcRenderer.invoke("cn:sku", { stage: "items", entries: pick(items) });
    const d = r2?.decision;
    if (d?.price != null) {
      input.value = d.price;
      box.dataset.option = (prefix ? prefix + " › " : "") + (d.pick?.label || "");
      showAlts(d.alts.map((a) => ({ ...a, img: items[a.i]?.img || "" })), d.pick?.i, prefix);
      setOpt(d.pick?.label, d.pick?.ko, `${why ? why + " · " : ""}${d.how}${d.excluded ? ` · 낚시 옵션 ${d.excluded}개 제외` : ""}`);
      if (!d.sure) { warnEl.hidden = false; warnEl.title = d.how; altsEl.classList.add("open"); }
    } else { setOpt("", "가격 있는 옵션 없음", d?.excluded ? `낚시 옵션 ${d.excluded}개 제외` : ""); warnEl.hidden = false; }
    loadSpecs();
  } catch (e) {
    setOpt("", "옵션 읽기 오류", String(e?.message || e)); warnEl.hidden = false;
    const p = readPrice(); if (p != null && !input.value) input.value = p;
  }
}

// ---- 1688 첫 화면: 리스트업에서 넘어온 사진을 이미지 검색 칸에 올리고 "이미지 검색"을 누른다 ----
// (사람이 카메라 아이콘에 사진을 끌어다 놓는 것과 같은 동작. 슬라이드 인증 등은 사람이 직접)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 12000) { for (let t = 0; t < ms; t += 300) { const v = fn(); if (v) return v; await sleep(300); } return null; }
const SEARCH_RE = /이미지\s*검색|图片搜索|以图搜|搜图|拍立淘|image\s*search/i;
// 1688 첫 화면의 사진 검색 칸 (2026-10 기준 "以图搜款" 버튼 안의 input.image-file-reader-wrapper, accept=".jpg,.jpeg,…")
const FILE_INPUT = SPECS.fileInput.css;
// 사진을 넣으면 뜨는 "帮你找同款 / 已上传1张图片" 패널의 "搜索图片" 버튼 (구버전 image-search-panel 도 함께)
const CONFIRM = SPECS.confirm.css;
async function autoImageSearch() {
  if (/offer|search|youyuan/i.test(location.pathname)) return;
  if (!/(^|\.)1688\.com$/i.test(location.hostname)) {
    // 로그인·인증 화면(login.taobao.com 등)으로 넘어간 경우: 사람이 처리하면 1688로 돌아왔을 때 이어서 검색한다
    if (/taobao\.com|login|passport/i.test(location.host + location.pathname) && (await ipcRenderer.invoke("cn:pending"))) ipcRenderer.send("cn:log", "1688 로그인/인증 화면입니다 — 직접 처리하시면 첫 화면으로 돌아왔을 때 이미지 검색을 이어서 시작합니다 (10분 안)");
    return;
  }
  const pend = await ipcRenderer.invoke("cn:pending");
  if (!pend) return;
  const scan = await sgScanStart(0, "1688 이미지 검색 칸 찾는 중"); // 🎤 발표 모드면 해커 화면
  const log = (t) => { ipcRenderer.send("cn:log", t); scan?.log(t); };
  log(`사진 받음 · 이미지 검색 칸 찾는 중 (${location.host}${location.pathname})`);
  document.documentElement.setAttribute("data-sg-tr-hold", ""); { const st = document.getElementById("sg-tr-style"); if (st) st.disabled = true; } setTimeout(() => document.documentElement.removeAttribute("data-sg-tr-hold"), 60000); // 사진 올리고 검색 누르는 동안 🌐 번역을 쉰다(번역이 칸을 찌그러뜨려 버튼이 안 눌리는 일 방지). 결과 화면으로 넘어가면 자동으로 풀린다
  // 로그아웃 상태면 1688이 사진 업로드를 조용히 거부한다(0건·썸네일 깨짐) → 올리지 않고 로그인 안내. 사진은 남겨 두어 로그인 뒤 첫 화면으로 돌아오면 자동으로 이어진다
  // (2026-10-09: 앱 이름이 씨드핵으로 바뀌며 데이터 폴더가 옮겨져 1688 로그인이 풀린 채 검색이 계속 실패했음)
  await sleep(1200); // 머리글(로그인/닉네임)이 그려질 시간
  const loggedOut = [...document.querySelectorAll("a, button, span, div")].some((e) => {
    const t = (e.textContent || "").trim();
    if (!/^(로그인|登录|请登录|亲，请登录)$/.test(t)) return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < 200;
  });
  if (loggedOut) {
    scan?.fail("1688 로그인 필요");
    log("1688에 로그인돼 있지 않습니다 — 이 화면 오른쪽 위 '로그인'으로 로그인하면 이미지 검색이 자동으로 이어집니다 (10분 안)");
    if (!document.getElementById("sg-login")) {
      const el = document.createElement("div");
      el.id = "sg-login";
      el.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#ffb454;color:#1f1300;font:700 14px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)";
      el.textContent = "1688 로그인이 필요합니다 — 오른쪽 위 '로그인'을 눌러 로그인하면 이미지 검색이 자동으로 이어집니다";
      (document.body || document.documentElement).appendChild(el);
    }
    return;
  }
  let input = await waitFor(() => findAdaptive("fileInput"), 15000);
  if (!input) {
    // 검색 칸이 바로 없는 화면이면 "이미지 검색/以图搜款" 버튼을 눌러 연 뒤 다시 찾는다
    const vis = (e) => e && e.getBoundingClientRect().width > 0;
    const opener = [...document.querySelectorAll("button, [role=button], span, div")].find((e) => vis(e) && e.children.length <= 2 && SEARCH_RE.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 12)
      || [...document.querySelectorAll('[class*="search-input__image"], [class*="camera" i]')].find(vis);
    opener?.click();
    input = await waitFor(() => findAdaptive("fileInput"), 4000);
  }
  if (!input) { scan?.fail("1688 이미지 검색 칸을 못 찾았습니다"); ipcRenderer.invoke("cn:pendingDone"); log("이미지 검색 칸을 못 찾았습니다 — 검색창 카메라 아이콘(以图搜款)에서 Ctrl+V로 붙여 넣어 주세요"); return; }
  log("검색 칸 찾음 · 사진 올리는 중"); scan?.step(0, "쿠팡 사진 올리는 중");
  // 사진을 넣기 전에 보이던 것들을 적어 둔다 → 넣은 뒤 "새로 나타난" 버튼만 사진 검색 버튼 후보로 본다(1688 화면 디자인·클래스 이름이 달라도 통함)
  const preShown = new WeakSet([...document.querySelectorAll('button, [role="button"], a, div, span')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }));
  const bytes = Uint8Array.from(atob(pend.b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "coupang.jpg", { type: pend.type || "image/jpeg" }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(1200); // 미리보기 패널 대기
  // ---- 검색 버튼 누르기 (2026-11-17 다시 씀) ----
  // 1688 첫 화면이 두 가지다: 예전(사진 넣으면 "帮你找同款" 상자 · .search-btn)과 새 디자인(home/2026 · 숨은 상자 .cgf-image-search-panel 의 __confirm-btn).
  // 예전 코드는 "비슷한 버튼 찾기"가 검색창의 일반 '搜索' 버튼을 잡을 수 있었고(눌러도 아무 일 없음), 숨은 상자는 못 찾았다.
  // → 사진 상자 안의 버튼만 후보로 삼고, 업로드가 끝나(버튼이 켜질 때)까지 기다리며, 코드 클릭·진짜 클릭을 번갈아 25초 동안 시도한다.
  const PANEL = '[class*="copy-image"], [class*="image-search-panel"], [class*="image-search-popover"], [class*="imageSearchPanel"], [class*="img-search-panel"]';
  const BTN_TXT = /^(搜索图片|搜图|搜索|搜同款|找同款|以图搜款|确认|确定|이미지\s*검색|사진\s*검색|이미지로\s*검색|검색|찾기|찾다|확인|search)$/i;
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const candidates = () => {
    const set = new Set(document.querySelectorAll(CONFIRM));
    for (const pn of document.querySelectorAll(PANEL)) for (const e of pn.querySelectorAll('button, [role="button"], a, div, span')) {
      const orig = e.getAttribute("data-sg-zh") || ""; // 🌐 번역이 덮어쓴 경우 원문
      if (e.children.length <= 2 && (BTN_TXT.test((e.textContent || "").trim()) || BTN_TXT.test(orig.trim()) || /confirm-btn|search-btn/i.test(String(e.className)))) set.add(e);
    }
    // 디자인을 몰라도: 사진을 넣은 뒤 새로 나타난, 글자가 "搜索图片/搜索/找同款…"인 것
    const fresh = [...document.querySelectorAll('button, [role="button"], a, div, span')].filter((e) => !preShown.has(e) && shown(e) && e.children.length <= 2 && !e.closest("#sg-scan, #sg-rank, #sg-ask, #sg-wave")
      && (BTN_TXT.test((e.textContent || "").trim()) || BTN_TXT.test((e.getAttribute("data-sg-zh") || e.getAttribute("data-sg-src") || "").trim())));
    const inner = fresh.filter((e) => !fresh.some((o) => o !== e && e.contains(o))); // 가장 안쪽 것만
    return [...new Set([...[...set].filter((e) => e.closest(PANEL)), ...inner])].filter((e) => !/remove|upload-btn|close/i.test(String(e.className)) && e.type !== "file")
      .sort((a, b) => Number(shown(b)) - Number(shown(a)) || Number(b.tagName === "BUTTON") - Number(a.tagName === "BUTTON") || Number(/confirm|search-btn/i.test(String(b.className))) - Number(/confirm|search-btn/i.test(String(a.className))));
  };
  // 꺼진 버튼을 감싼 칸·그 안 글자도 "꺼짐"으로 본다(업로드 중에 겉 칸을 눌러 봐야 소용없음)
  const off = (e) => { const b = e.closest("button") || e.querySelector?.("button") || e; return b.disabled || e.disabled || b.getAttribute("aria-disabled") === "true" || /disabled|loading/i.test(String(b.className) + " " + String(e.className)); };
  const realClick = async (el) => {
    el.scrollIntoView({ block: "center", inline: "center" }); await sleep(200);
    const r = el.getBoundingClientRect(), cover = document.getElementById("sg-scan");
    if (cover) cover.style.pointerEvents = "none";
    const ok = await ipcRenderer.invoke("cn:realClick", { x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => false);
    await sleep(300); if (cover) cover.style.pointerEvents = "";
    return ok;
  };
  const blocker = () => {
    if (isCaptcha()) return "보안 인증(슬라이더)";
    const fr = [...document.querySelectorAll("iframe")].filter((f) => { const r = f.getBoundingClientRect(); return r.width > 150 && r.height > 100; }).map((f) => f.src || "");
    if (fr.some((x) => /punish|captcha|nocaptcha|_____tmd_____|baxia|x5sec/i.test(x)) || document.querySelector('[id*="nc_"][id*="wrapper" i], .nc-container, [class*="baxia" i]')) return "보안 인증(슬라이더)";
    if (fr.some((x) => /login|passport|havanaone/i.test(x))) return "로그인 창";
    return "";
  };
  let left = false; addEventListener("pagehide", () => { left = true; }, { once: true });
  scan?.step(1, "1688 이미지 검색 · 결과 화면 여는 중");
  const tried = []; let lastDiag = "", lastNew = "";
  for (let n = 0, t0 = Date.now(); Date.now() - t0 < 25000 && !left; n++) {
    if (!(await ipcRenderer.invoke("cn:target"))) { scan?.close?.(); return; } // 그사이 ✕ 검색 취소
    if (blocker()) break;
    let cs = candidates();
    if (!cs.length && Date.now() - t0 > 6000) { const fb = findAdaptive("confirm"); if (fb && shown(fb) && !preShown.has(fb)) cs = [fb]; } // 예전 방식 — 단, 원래 있던 버튼(검색창의 일반 검색 버튼)은 누르지 않는다
    if (!cs.length) lastNew = [...document.querySelectorAll('button, [role="button"], a, div, span')].filter((e) => !preShown.has(e) && shown(e) && !e.children.length && !e.closest("#sg-scan") && (e.textContent || "").trim().length > 0 && (e.textContent || "").trim().length < 14).slice(0, 8).map((e) => `"${(e.textContent || "").trim()}"·${String(e.className).split(/\s+/)[0].slice(0, 24)}`).join(" ");
    const ready = cs.filter((e) => !off(e));
    lastDiag = `후보 ${cs.length}개(켜진 것 ${ready.length}) ${cs.slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/).slice(-1)[0].slice(0, 30)}${shown(e) ? "" : "[숨음]"}${off(e) ? "[꺼짐]" : ""}`).join(", ")}`;
    if (!ready.length) { await sleep(800); continue; } // 업로드가 끝나 버튼이 켜질 때까지
    const el = ready[n % ready.length], how = shown(el) && n % 2 === 1 ? "진짜" : "코드";
    if (how === "진짜") { if (!(await realClick(el))) el.click(); } else el.click();
    tried.push(how);
    if (n === 0) log("사진으로 이미지 검색을 시작했습니다 — 결과 화면에서 상품을 열면 '리스트업에 넣기' 상자가 뜹니다");
    else log(`결과 화면이 안 열려 검색 버튼을 다시 누릅니다 (${how} 클릭 · ${lastDiag})`);
    if (await waitFor(() => left, 3000)) return;
  }
  if (left) return;
  document.documentElement.removeAttribute("data-sg-tr-hold");
  const why = blocker();
  const msg = why ? `1688 ${why}이 떠서 검색이 멈췄습니다 — 직접 처리한 뒤 이미지 검색 버튼을 눌러 주세요` : "1688 검색 결과 화면이 열리지 않았습니다 — 화면의 이미지 검색 버튼을 직접 눌러 주세요(사진은 올라가 있음)";
  const frames = [...document.querySelectorAll("iframe")].filter((f) => f.getBoundingClientRect().width > 150).map((f) => (f.src || "").replace(/\?.*/, "").slice(0, 80));
  log(`${msg} · 진단: ${lastDiag || "버튼 후보 없음"} · 시도 ${tried.join(">") || "없음"} · 큰 iframe=${[...document.querySelectorAll("iframe")].filter((f) => f.getBoundingClientRect().width > 150).map((f) => (f.src || "").replace(/\?.*/, "").slice(0, 60)).join(", ") || "없음"}`);
  scan?.close?.();
  if (!document.getElementById("sg-stuck")) {
    const el = document.createElement("div");
    el.id = "sg-stuck";
    el.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#ffb454;color:#1f1300;font:700 14px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)";
    el.textContent = msg;
    const dg = document.createElement("div"); dg.style.cssText = "font:400 11px ui-monospace,Menlo,Consolas,monospace;opacity:.75;margin-top:4px"; dg.textContent = `${lastDiag || "버튼 후보 없음"} · 시도 ${tried.join(">") || "없음"} · 새로 뜬 글자 ${lastNew || "없음"} · 사진칸 ${String(input.className).slice(0, 30) || "?"} < ${String(input.parentElement?.className || "").slice(0, 30)}`; el.appendChild(dg);
    (document.body || document.documentElement).appendChild(el);
  }
}

// ---- 이미지 검색 결과 페이지: 판매자 추천 TOP 패널 ----
const isResults = () => /(^|\.)1688\.com$/i.test(location.hostname) && /pc-image-search|youyuan|tab=imageSearch/i.test(location.pathname + location.search);
// 카드의 상품 번호: 카드 안 실제 상품 링크(detail.1688.com/offer/번호.html, …offerId=번호)에서 먼저 읽는다.
// HTML 전체에서 "offerId" 근처 숫자를 찾으면 사진 번호(imageId, 19자리) 같은 다른 숫자를 잡아 "상품 열기"가 1688 '없는 상품' 화면으로 갔다(2026-10-10)
const OFFER_RE = /(?:\/offer\/|[?&](?:offerId|offer_id|offerid)=)(\d{9,14})(?!\d)/;
const cardEl = new Map(); // 상품 번호 → 카드 요소(주소를 못 만들면 카드를 직접 눌러 1688이 열게 한다)
const cardHref = new Map(); // 상품 번호 → 카드의 실제 링크(번호를 못 읽은 광고 카드는 이 링크로 연다)
function cardLink(c) {
  const as = [...(c.matches("a[href]") ? [c] : []), ...c.querySelectorAll("a[href]"), ...(c.closest("a[href]") ? [c.closest("a[href]")] : [])];
  for (const a of as) { const m = String(a.href).match(OFFER_RE); if (m) return { id: m[1], href: a.href }; }
  const a = as.find((x) => /^https?:/.test(x.href) && /1688\.com/.test(x.href));
  return a ? { id: "", href: a.href } : null;
}
function readCards() {
  return findAdaptive("card").map((c) => {
    const link = cardLink(c);
    // 2026-10 카드: 링크·offerId 글자 없이 data-renderkey 맨 끝 '_' 조각에만 상품 번호가 있다(클릭은 1688 스크립트가 처리)
    const rkv = c.getAttribute("data-renderkey") || c.querySelector("[data-renderkey]")?.getAttribute("data-renderkey") || "";
    const rkId = rkv.split("_").reverse().find((x) => /^\d{9,14}$/.test(x)); // 예) 1_0_normal_b2b-2218…_948412843950 · 1_1_fm_b2b-2221…c741_1027228533979 · 1_3_fm_qingdaoxinhan_678916537775
    const rk = rkId ? [0, rkId] : null;
    const m = link?.id ? [0, link.id] : rk || c.outerHTML.match(/"offerId"\s*:\s*\\?"?(\d{9,14})(?!\d)/) || c.outerHTML.match(/offerId[^\d]{0,24}(\d{9,14})(?!\d)/);
    if (m && link?.href) cardHref.set(String(m[1]), link.href);
    if (m) cardEl.set(String(m[1]), c);
    if (!m && !readCards.diag) { // 상품 번호를 못 읽은 카드 — 1688 카드 구조가 바뀐 것. 고칠 근거를 한 번 남긴다
      readCards.diag = true;
      const h = c.outerHTML, nums = [...h.matchAll(/\d{9,}/g)].slice(0, 8).map((x) => `${h.slice(Math.max(0, x.index - 40), x.index).replace(/\s+/g, " ")}⟨${x[0]}⟩`);
      const hrefs = [...c.querySelectorAll("a[href]")].slice(0, 4).map((a) => a.href.slice(0, 160));
      const attrs = [...c.querySelectorAll("*")].flatMap((e) => [...e.attributes].filter((a) => /offer|item|id|href|click|spm|data-/i.test(a.name)).map((a) => `${a.name}=${String(a.value).slice(0, 60)}`)).slice(0, 25);
      ipcRenderer.send("cn:log", `진단: 카드 상품 번호 못 읽음 · renderkey=${(c.getAttribute("data-renderkey") || c.querySelector("[data-renderkey]")?.getAttribute("data-renderkey") || "없음").slice(0, 160)} · 태그 ${c.tagName.toLowerCase()}.${String(c.className).slice(0, 40)} · 부모링크 ${c.closest("a[href]")?.href?.slice(0, 120) || "없음"} · 링크 ${hrefs.join(" , ") || "없음"} · 숫자 ${nums.join(" | ") || "없음"} · 속성 ${attrs.join(" ; ")}`);
    }
    return { offerId: m ? m[1] : "", lines: (c.innerText || "").split("\n"), img: (c.querySelector("img")?.currentSrc || c.querySelector("img")?.src || "").slice(0, 300) };
  }).filter((c) => c.lines.length > 3);
}
const fmt = (n) => (n == null ? "-" : n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + "만" : String(n));
const VD = { green: "🟢", yellow: "🟡", red: "🔴", candidate: "⚪", low: "·", exclude: "✕" };
// 결과 보드(SEEDHACK 소싱 보드): 해커 화면이 끝나면 오른쪽에서 들어온다. 데이터·버튼 흐름은 그대로(딸깍 = 진짜 옵션가 → AI)
const RB = { green: ["g", "GO"], yellow: ["y", "HOLD"], red: ["r", "DROP"], candidate: ["c", "PICK"], low: ["n", "LOW"], exclude: ["n", "OUT"] };
function renderRank(panel, r) {
  const body = panel.querySelector(".body"), st = panel.querySelector(".st"), btn = panel.querySelector("button.go");
  const busy = r.probing || r.aiBusy;
  // 딸깍: 가격 확인 → AI 순서로 자동 진행
  if (panel.__want && !r.probing && !r.aiBusy && !r.ai) { panel.__want = false; ipcRenderer.invoke("cn:ai"); }
  if (busy && !panel.__t0) panel.__t0 = Date.now();
  if (!busy) panel.__t0 = 0;
  btn.disabled = busy || !r.top.length;
  btn.innerHTML = r.probing ? `<span class="mono">&gt; 진짜 옵션가 확인 ${3 - r.probeLeft + 1}/3</span><i class="cur"></i> <small class="bt"></small>`
    : r.aiBusy ? `<span class="mono">&gt; AI 판단 중</span><i class="cur"></i> <small class="bt"></small>`
    : r.ai && !r.ai.error ? "↻ 다시 추천" : `▶ 딸깍 추천 <small>진짜 옵션가 3개 확인 → AI 판단</small>`;
  st.textContent = r.mismatch ? "⚠ 쿠팡 상품과 닮은 결과가 없습니다 — 사진 검색이 빗나갔어요. 결과 화면 위 작은 사진 중 상품 전체가 담긴 것을 눌러 다시 찾아 주세요" : r.captcha ? "✕ 1688 보안 인증 필요 — 1688 탭에서 슬라이더를 밀고 다시 누르세요" : r.ai?.error ? `✕ AI 추천 실패 · ${r.ai.error}` : "";
  st.title = r.ai?.skipped || "";
  st.hidden = !st.textContent;
  // 진행 단계: 이미지 검색 · 판매자 점수 · 진짜 옵션가 · AI 판단
  const known = Math.min(3, r.top.slice(0, 3).filter((x) => x.realPrice != null).length);
  const aiDone = r.ai && !r.ai.error && r.ai.picks?.length;
  const steps = [["이미지 검색", "done"], ["판매자 점수", "done"], [`진짜 옵션가 ${known}/3`, r.probing ? "on" : known ? "done" : ""], ["AI 판단", r.aiBusy ? "on" : aiDone ? "done" : ""]];
  panel.querySelector(".pipe").innerHTML = steps.map(([t, c]) => `<span class="${c}">${c === "done" ? "✓" : c === "on" ? "◉" : "○"} ${esc(t)}</span>`).join("<em>›</em>");
  // 숫자: 후보 · 허용가 · 중앙가 · 제외
  const odd = r.allow != null && (r.allow > 1500 || (panel.__price || 0) > 500000); // 판매가 읽기 오류(예: ₩1,980,000)로 허용가가 비정상
  panel.querySelector(".nums").innerHTML = `<div><span>CANDIDATES</span><b>${r.total}</b></div><div class="${odd ? "bad" : ""}"><span>ALLOW 허용가</span><b>${r.allow ? "¥" + r.allow.toFixed(1) : "-"}</b></div><div><span>MEDIAN 중앙가</span><b>${r.medianPrice != null ? "¥" + r.medianPrice : "-"}</b></div><div><span>OUT 제외</span><b>${r.excluded ?? 0}</b></div>${r.cost ? `<div class="${r.cost.warn ? "bad" : ""}" title="${esc([r.cost.how, r.cost.range ? `확인된 옵션가 ¥${r.cost.range[0]}~¥${r.cost.range[1]}` : "", r.cost.warn || ""].filter(Boolean).join("\n"))}"><span>COST 원가 기준${r.cost.sure ? "" : " · 추정"}</span><b>¥${r.cost.yuan}${r.cost.warn ? " ⚠" : ""}</b></div>` : ""}`;
  panel.querySelector(".warn").hidden = !odd;
  // AI 판단 박스: 진행 중 · 결과(한 줄 조언·제외 이유) · 추천 0개
  const aiBox = panel.querySelector(".ai");
  if (r.aiBusy) {
    aiBox.className = "ai busy"; aiBox.hidden = false;
    aiBox.innerHTML = `<div class="k">AI 판단 중<i class="bt"></i></div><p>&gt; Claude에 후보 ${Math.min(15, r.total)}개 · 진짜 옵션가 ${known}개 보내는 중<i class="cur"></i></p><small>같은 상품인지 · 허용가 이하인지 · 믿을 만한 판매자인지 봅니다 (보통 1~2분)</small>`;
  } else if (r.ai && !r.ai.error) {
    const n = r.ai.picks?.length || 0, sig = JSON.stringify([n, r.ai.ts]);
    aiBox.className = "ai" + (n ? "" : " none") + (panel.__aiSig !== sig ? " flash" : ""); aiBox.hidden = false; panel.__aiSig = sig;
    aiBox.innerHTML = `<div class="k">${n ? `AI 판단 완료 · 추천 ${n}개` : "AI 판단 완료 · 추천할 후보 없음"}<i>${esc(String(r.ai.model || "").replace(/^cli:/, ""))}</i></div><p>${esc(r.ai.summary || (n ? "아래 순서대로 샘플을 비교해 보세요" : "조건에 맞는 판매자를 찾지 못했습니다"))}</p>${r.ai.skipped ? `<small>제외: ${esc(r.ai.skipped)}</small>` : ""}`;
  } else aiBox.hidden = true;
  if (!panel.__img) panel.__img = new Map(readCards().map((c) => [c.offerId, c.img])); // AI가 상위 8개 밖을 고르면 사진은 결과 화면에서
  // 카드: AI 결과가 있으면 AI 추천 3개, 없으면 점수 상위 3개
  const ai = aiDone ? r.ai.picks : null;
  const list = ai ? ai.map((p) => { const c = r.top.find((x) => x.offerId === p.offerId) || {}; return { ...c, ...p, title: p.title_ko || p.title || c.title, reason: p.reason_ko, risk: p.risk_ko, verdict: p.verdict, price: p.price ?? c.realPrice ?? c.price, real: c.realPrice != null, sure: c.realPrice != null && !!c.priceSure }; })
    : r.top.slice(0, 3).map((x) => ({ ...x, price: x.realPrice ?? x.price, real: x.realPrice != null, sure: x.realPrice != null && !!x.priceSure, reason: x.realPrice != null ? (x.option?.ko || x.option?.label || "") : "" }));
  list.forEach((x) => { if (!x.img) x.img = panel.__img.get(x.offerId) || ""; });
  // 내용이 바뀌면(옵션가 확인·AI 결과) 카드를 다시 띄우고 반짝인다
  const sigNow = JSON.stringify(list.map((x) => [x.offerId, x.price, x.verdict, !!ai]));
  const changed = panel.__drawn && panel.__sig !== sigNow; panel.__sig = sigNow;
  const first = !panel.__drawn || changed; panel.__drawn = true;
  body.innerHTML = list.map((x, i) => {
    const [cls, label] = RB[x.verdict] || ["n", "—"];
    const ratio = r.allow && x.price != null && !odd ? x.price / r.allow : null;
    return `<div class="card ${cls}${first ? " in" : ""}${changed ? " flash" : ""}" style="${first ? `animation-delay:${0.15 + i * 0.1}s` : ""}" title="${esc([x.company, (x.notes || []).join(" · "), x.priceHow, ai ? "" : `규칙 ${x.score}/${x.max}점`].filter(Boolean).join("\n"))}">
      <div class="im">${x.img ? `<img src="${esc(x.img)}" alt="">` : ""}<b class="no">${i + 1}</b><b class="sg ${cls}">${ai ? `AI ${i + 1}·` : ""}${label}</b></div>
      <div class="bd">
        <div class="ttl">${esc(x.title || "")}${x.same_product ? `<span class="same ${x.same_product}">${{ yes: "같은 상품", likely: "거의 같음", no: "다른 상품" }[x.same_product] || ""}</span>` : ""}</div>
        <div class="pr"><b>${x.price != null ? "¥" + x.price : "-"}</b><span class="${x.real && x.sure ? "ok" : "est"}" title="${esc(x.priceHow || "")}">${x.real ? (x.sure ? "진짜 옵션가" : "옵션 애매 · 상품 열어 확인") : "목록 최저가 · 확인 전"}</span></div>
        ${ratio != null ? `<div class="bar ${ratio <= 1 ? "ok" : "over"}"><i style="width:${Math.min(100, ratio * 100)}%"></i><span>허용 ¥${r.allow.toFixed(1)}의 ${Math.round(ratio * 100)}%</span></div>` : ""}
        <div class="chips"><span>월 판매 <b>${fmt(x.sales)}</b></span><span>재구매 <b>${x.repeat != null ? x.repeat + "%" : "-"}</b></span><span>업력 <b>${x.years != null ? x.years + "년" : "-"}</b></span>${x.moq ? `<span>최소 <b>${x.moq}</b></span>` : ""}${!ai && x.score != null ? `<span>점수 <b>${x.score}</b></span>` : ""}</div>
        ${ai && x.optionLabel ? `<div class="opt">옵션: ${esc(x.optionLabel)}</div>` : ""}
        ${x.reason ? `<div class="rs${ai ? " big" : ""}">${esc(x.reason)}</div>` : ""}${x.risk ? `<div class="rk">⚠ ${esc(x.risk)}</div>` : ""}
        ${!x.real ? `<button type="button" class="open probe1" data-id="${x.offerId}" title="이 상품만 진짜 옵션가 확인(1초 안팎)" style="margin-right:6px">옵션가 확인</button>` : ""}<button type="button" class="open" data-id="${x.offerId}">상품 열기 ›</button>
      </div></div>`;
  }).join("") || `<div class="empty">후보 없음</div>`;
  body.querySelectorAll("button.probe1").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopImmediatePropagation(); b.disabled = true; b.textContent = "⏳ 확인 중…";
    const r = await ipcRenderer.invoke("cn:probeOne", b.dataset.id).catch((err) => ({ error: /No handler/.test(String(err)) ? "앱을 다시 켜야 합니다" : String(err) }));
    if (r?.error) { b.disabled = false; b.textContent = "✕ " + String(r.error).slice(0, 24); }
  }, true));
  body.querySelectorAll("button.open:not(.probe1)").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.id, href = cardHref.get(id);
    const url = /^\d{9,14}$/.test(id) ? `https://detail.1688.com/offer/${id}.html` : href || "";
    ipcRenderer.send("cn:log", `상품 열기 · 번호 ${id || "없음"} → ${url.slice(0, 120) || "주소 없음"}`);
    if (url) location.href = url;
    else if (cardEl.get(id)?.isConnected) cardEl.get(id).click(); // 1688이 직접 상품을 연다(새 창 → 같은 화면)
  }));
}
async function rankPanel() {
  if (!isResults() || document.getElementById("sg-rank")) return;
  const target = await ipcRenderer.invoke("cn:target");
  if (!target) return;
  // 앱이 "전체 사진" 뜻으로 주소에 붙인 region=0,360,0,360 을 1688이 더 이상 받지 않는다(썸네일 깨짐·0건 — 2026-10-08 확인)
  // → 결과를 기다리지 않고 바로 region 없이 다시 연다(1688 기본 = 물체 자동 선택). 올바른 영역 형식을 알아내면 main.js의 region 지정을 그 형식으로 고칠 것
  const u = new URL(location.href), noRegionKey = "sg-noregion:" + (u.searchParams.get("imageId") || u.searchParams.get("imageAddress") || "");
  // 전체 사진으로 검색: 1688 영역 형식은 region=왼쪽,오른쪽,위,아래 "올린 사진의 픽셀" 기준(2026-10-11 확인: 물체 조각을 고르면 region=30,191,73,209).
  // 1688은 기본으로 사진 속 물체 하나만 잘라 찾아(목베개 사진 → 목 아래 조각, 빨래건조대 → 기둥) 엉뚱한 상품이 나온다 → 처음 열릴 때 한 번 전체 사진 영역으로 다시 연다.
  // (사람이 결과 화면에서 다른 조각을 고르면 region이 붙어 있으므로 건드리지 않는다)
  const fullKey = "sg-fullregion:" + (u.searchParams.get("imageId") || "");
  if (!u.searchParams.has("region") && u.searchParams.get("imageId") && !sessionStorage.getItem(fullKey)) {
    const pend0 = await ipcRenderer.invoke("cn:pending");
    if (pend0?.b64) {
      const im = new Image(); im.src = `data:${pend0.type || "image/jpeg"};base64,${pend0.b64}`;
      try { await im.decode(); } catch {}
      if (im.naturalWidth > 10 && im.naturalHeight > 10) {
        sessionStorage.setItem(fullKey, "1");
        u.searchParams.set("region", `0,${im.naturalWidth},0,${im.naturalHeight}`);
        ipcRenderer.send("cn:log", `전체 사진으로 다시 검색 (region=0,${im.naturalWidth},0,${im.naturalHeight} · 1688이 고른 물체 조각 대신)`);
        location.replace(u.href);
        return;
      }
    }
  }
  if (u.searchParams.get("region") === "0,360,0,360" && !sessionStorage.getItem(noRegionKey)) {
    sessionStorage.setItem(noRegionKey, "1");
    u.searchParams.delete("region");
    ipcRenderer.send("cn:log", "검색 영역(region) 지정을 빼고 다시 엽니다");
    location.replace(u.href);
    return;
  }
  const scan = await sgScanStart(2, "1688 후보 카드 읽는 중"); // 🎤 발표 모드면 해커 화면
  let cards = await waitFor(() => { const c = readCards(); return c.length >= 5 ? c : null; }, 15000);
  const pend = await ipcRenderer.invoke("cn:pending");
  const retryKey = "sg-retry:" + (pend?.ts || "");
  if (!cards && pend && !sessionStorage.getItem(retryKey)) {
    // 첫 화면에서 올린 사진을 1688이 못 받은 경우(썸네일 깨짐·0건) — 사람이 결과 화면의 '上传图片'에 직접 올리면 되므로 같은 칸에 한 번 더 올린다
    sessionStorage.setItem(retryKey, "1"); // 재시도는 한 번만 — 사진은 남겨 둬야 새 결과 화면에서도 "전체 사진" 영역을 다시 붙인다(비우면 1688이 물체 하나만 골라 엉뚱한 결과)
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    const input = inputs.find((i) => /上传图片|사진\s*업로드|이미지\s*업로드|업로드/.test(i.closest("div")?.parentElement?.textContent || "")) || inputs.find((i) => i.matches(FILE_INPUT)) || inputs[0];
    if (input) {
      ipcRenderer.send("cn:log", `결과 없음 → 결과 화면의 사진 칸에 다시 올립니다 (${String(input.className).slice(0, 40) || "input"})`);
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(pend.b64), (c) => c.charCodeAt(0))], "coupang.jpg", { type: pend.type || "image/jpeg" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1500);
      findAdaptive("confirm")?.click(); // 확인 패널이 뜨는 화면이면 눌러 준다(없으면 바로 검색됨)
      // 다시 올린 사진도 "전체 사진"으로: 화면이 새로 열리지 않고 주소만 바뀌면(물체 하나 자동 선택) 여기서 영역을 붙여 다시 연다
      const before = new URL(location.href).searchParams.get("imageId");
      const moved = await waitFor(() => { const v = new URL(location.href); return v.searchParams.get("imageId") && v.searchParams.get("imageId") !== before && !v.searchParams.has("region") ? v : null; }, 6000);
      if (moved) {
        const im = new Image(); im.src = `data:${pend.type || "image/jpeg"};base64,${pend.b64}`; try { await im.decode(); } catch {}
        if (im.naturalWidth > 10) { sessionStorage.setItem("sg-fullregion:" + moved.searchParams.get("imageId"), "1"); moved.searchParams.set("region", `0,${im.naturalWidth},0,${im.naturalHeight}`); ipcRenderer.send("cn:log", `다시 올린 사진도 전체 사진으로 검색 (region=0,${im.naturalWidth},0,${im.naturalHeight})`); location.replace(moved.href); return; }
      }
      cards = await waitFor(() => { const c = readCards(); return c.length >= 5 ? c : null; }, 20000);
      ipcRenderer.send("cn:log", cards ? `다시 올리기로 후보 ${cards.length}개 찾음` : "다시 올려도 결과가 없습니다");
    } else ipcRenderer.send("cn:log", "결과 화면에서 사진 칸을 못 찾았습니다");
  } else if (pend) ipcRenderer.invoke("cn:pendingDone");
  if (!cards) {
    ipcRenderer.send("cn:noResult", "1688 이미지 검색 결과 없음");
    scan?.fail("1688 결과가 없습니다 — 1688 첫 화면(🏠)에서 보안 인증(슬라이더)이 있는지 확인해 주세요");
    // 결과가 비었고("空空如也") 올린 사진이 깨져 있으면 1688이 사진을 받지 않은 것 — 보안 인증 상태에서 흔함
    const empty = /空空如也|没有找到|暂无|결과가\s*없|찾을\s*수\s*없|비어\s*있/.test(document.body?.innerText || "");
    const img = document.querySelector('img[class*="searchImg"]');
    const broken = img && (!img.complete || img.naturalWidth === 0);
    if (empty || broken) {
      ipcRenderer.send("cn:log", `결과 없음 (${empty ? "빈 결과" : ""}${broken ? " 사진 깨짐" : ""}) — 1688이 사진을 받지 않았습니다. 1688 첫 화면(🏠)에서 보안 인증(슬라이더)이 있는지 확인한 뒤 다시 🔍1688`);
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#ffb454;color:#1f1300;font:700 14px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)";
      el.textContent = "1688이 사진을 받지 않았습니다 — 1688 첫 화면(🏠)에서 보안 인증(슬라이더)을 확인하고 다시 🔍1688을 눌러 주세요";
      (document.body || document.documentElement).appendChild(el);
    }
    return;
  }
  if (scan) await scan.cards(cards);
  const style = document.createElement("style");
  style.textContent = `
  #sg-rank{--n:#3ddc84;--a:#ffc94d;--r:#ff5d5d;--c:#7fe3ff;--dk:#5f8a72;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    position:fixed;top:0;right:0;bottom:0;z-index:2147483646;width:440px;display:flex;flex-direction:column;background:#04070a;color:#d8e6dc;border-left:1px solid #1d4a33;
    box-shadow:-20px 0 60px rgba(0,0,0,.45),-1px 0 18px rgba(61,220,132,.25);font:13px/1.45 -apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif;animation:sgIn .45s cubic-bezier(.2,.9,.25,1)}
  #sg-rank::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(61,220,132,.04) 1px,transparent 1px) 0 0/36px 36px,linear-gradient(90deg,rgba(61,220,132,.04) 1px,transparent 1px) 0 0/36px 36px}
  #sg-rank>*{position:relative}
  #sg-rank .mono{font-family:var(--mono)}
  #sg-rank .hd{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #10221a}
  #sg-rank .hd b{font:800 14px var(--mono);letter-spacing:.08em;color:#fff}#sg-rank .hd b span{color:var(--n)}
  #sg-rank .hd small{font:11px var(--mono);letter-spacing:.14em;color:var(--dk)}
  #sg-rank .hd .x{margin-left:auto;background:none;border:0;color:#7a9a88;font-size:18px;cursor:pointer}
  #sg-rank .cur{display:inline-block;width:.55em;height:1em;vertical-align:-2px;margin-left:3px;background:var(--n);animation:sgBl .8s steps(1) infinite}
  #sg-rank .src{display:flex;gap:12px;align-items:center;padding:14px 18px 10px}
  #sg-rank .src .ph{width:58px;height:58px;flex:none;border-radius:10px;overflow:hidden;background:#fff;border:2px solid #1d4a33}#sg-rank .src .ph img{width:100%;height:100%;object-fit:contain}
  #sg-rank .src .t{min-width:0}#sg-rank .src .t span{display:block;font:10.5px var(--mono);letter-spacing:.14em;color:var(--dk)}
  #sg-rank .src .t b{display:block;font-size:14px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#sg-rank .src .t i{font-style:normal;font-size:12px;color:#9fc3ad}
  #sg-rank .warn{margin:0 18px 8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,93,93,.5);background:rgba(255,93,93,.08);color:#ff9b9b;font-size:12px}
  #sg-rank .pipe{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding:4px 18px 10px;font:11.5px var(--mono)}
  #sg-rank .pipe span{color:#4c6b5a}#sg-rank .pipe span.done{color:var(--n)}#sg-rank .pipe span.on{color:var(--c);animation:sgBl 1s infinite}#sg-rank .pipe em{font-style:normal;color:#2b3a32}
  #sg-rank .nums{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:0 18px 12px}
  #sg-rank .nums div{border:1px solid #12251b;border-radius:8px;padding:6px 8px;background:rgba(61,220,132,.03)}
  #sg-rank .nums span{display:block;font:9.5px var(--mono);letter-spacing:.08em;color:var(--dk);white-space:nowrap}#sg-rank .nums b{font:700 16px var(--mono);color:#eafff2}
  #sg-rank .nums .bad{border-color:rgba(255,93,93,.5)}#sg-rank .nums .bad b{color:#ff8a8a}
  #sg-rank .body{flex:1;min-height:0;overflow:auto;padding:0 18px 10px;display:grid;gap:10px;align-content:start}
  #sg-rank .card{display:grid;grid-template-columns:96px 1fr;gap:12px;border:1px solid #1a2e24;border-radius:12px;padding:10px;background:#08110c}
  #sg-rank .card.in{animation:sgUp .4s cubic-bezier(.2,.9,.25,1) backwards}
  #sg-rank .card.g{border-color:rgba(61,220,132,.6);box-shadow:0 0 18px rgba(61,220,132,.15)}#sg-rank .card.c{border-color:rgba(127,227,255,.45)}#sg-rank .card.y{border-color:rgba(255,201,77,.5)}#sg-rank .card.r{border-color:rgba(255,93,93,.45)}
  #sg-rank .im{position:relative;width:96px;height:96px;border-radius:9px;overflow:hidden;background:#fff}#sg-rank .im img{width:100%;height:100%;object-fit:cover}
  #sg-rank .im .no{position:absolute;left:5px;top:5px;font:800 11px var(--mono);color:#fff;background:rgba(4,7,10,.8);padding:0 6px;border-radius:5px}
  #sg-rank .im .sg{position:absolute;left:5px;bottom:5px;font:800 10.5px var(--mono);letter-spacing:.05em;padding:1px 6px;border-radius:5px;color:#04210f;background:var(--n)}
  #sg-rank .im .sg.c{background:var(--c)}#sg-rank .im .sg.y{background:var(--a)}#sg-rank .im .sg.r{background:var(--r);color:#fff}#sg-rank .im .sg.n{background:#3a4a42;color:#cfe}
  #sg-rank .bd{min-width:0}
  #sg-rank .ttl{font-weight:700;color:#fff;font-size:13px;line-height:1.35;max-height:2.7em;overflow:hidden}
  #sg-rank .pr{display:flex;align-items:baseline;gap:8px;margin-top:3px}#sg-rank .pr b{font:800 20px var(--mono);color:var(--n)}
  #sg-rank .pr span{font-size:10.5px;padding:0 6px;border-radius:4px}#sg-rank .pr .ok{color:var(--n);background:rgba(61,220,132,.12)}#sg-rank .pr .est{color:var(--a);background:rgba(255,201,77,.12)}
  #sg-rank .bar{position:relative;height:16px;margin-top:5px;border-radius:5px;background:#0e1c15;overflow:hidden}
  #sg-rank .bar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,rgba(61,220,132,.35),rgba(61,220,132,.7));animation:sgBar .8s ease-out backwards}
  #sg-rank .bar.over i{background:linear-gradient(90deg,rgba(255,93,93,.3),rgba(255,93,93,.7))}
  #sg-rank .bar span{position:relative;font:10.5px/16px var(--mono);padding-left:6px;color:#eafff2}
  #sg-rank .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}#sg-rank .chips span{font-size:11px;color:#8fb3a0;border:1px solid #1a2e24;border-radius:99px;padding:0 7px}#sg-rank .chips b{color:#eafff2}
  #sg-rank .rs{font-size:12px;color:#cbd5e1;margin-top:5px}#sg-rank .rk{font-size:11.5px;color:var(--a);margin-top:2px}
  #sg-rank button.open{margin-top:7px;border:1px solid #1d4a33;border-radius:7px;padding:5px 10px;background:transparent;color:#bfe8cf;cursor:pointer;font-size:12px}
  #sg-rank button.open:hover{border-color:var(--n);color:#fff}
  #sg-rank .empty{color:#7a9a88;padding:30px 0;text-align:center}
  #sg-rank .st{margin:0 18px 6px;font-size:12px;color:#9fc3ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
  #sg-rank .foot{padding:12px 18px 16px;border-top:1px solid #10221a;background:rgba(4,7,10,.92)}
  #sg-rank button.go{width:100%;border:0;border-radius:11px;padding:13px;background:var(--n);color:#04210f;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 0 24px rgba(61,220,132,.35)}
  #sg-rank button.go small{display:block;font-weight:600;font-size:11px;opacity:.75;margin-top:1px}
  #sg-rank button.go:disabled{background:#0e1c15;color:var(--c);cursor:default;box-shadow:inset 0 0 0 1px rgba(127,227,255,.35);font-size:13.5px}
  #sg-rank button.go:disabled small{display:inline;margin-left:6px;color:#7a9a88}
  #sg-rank .ai{margin:0 18px 10px;padding:12px 14px;border-radius:12px;border:1px solid rgba(127,227,255,.4);background:linear-gradient(135deg,rgba(127,227,255,.08),rgba(61,220,132,.06));animation:sgUp .4s cubic-bezier(.2,.9,.25,1)}
  #sg-rank .ai .k{display:flex;justify-content:space-between;font:10.5px var(--mono);letter-spacing:.14em;color:var(--c)}
  #sg-rank .ai .k i{font-style:normal;color:var(--dk);letter-spacing:0}
  #sg-rank .ai p{margin:6px 0 0;font-size:14.5px;font-weight:700;color:#fff;line-height:1.45}
  #sg-rank .ai small{display:block;margin-top:4px;font-size:12px;color:#9fc3ad}
  #sg-rank .ai.busy{border-color:rgba(127,227,255,.6)}#sg-rank .ai.busy p{font:600 13px var(--mono);color:var(--c)}
  #sg-rank .ai.none{border-color:rgba(255,201,77,.5);background:rgba(255,201,77,.06)}#sg-rank .ai.none .k{color:var(--a)}
  #sg-rank .ai.flash,#sg-rank .card.flash{animation:sgFl 1.2s ease-out}
  #sg-rank .same{font-size:10.5px;font-weight:700;padding:0 6px;border-radius:4px;margin-left:4px}
  #sg-rank .same.yes{color:var(--n);background:rgba(61,220,132,.14)}#sg-rank .same.likely{color:var(--c);background:rgba(127,227,255,.12)}#sg-rank .same.no{color:var(--r);background:rgba(255,93,93,.12)}
  #sg-rank .opt{font-size:11.5px;color:var(--c);margin-top:3px}
  #sg-rank .rs.big{font-size:13px;color:#eafff2;border-left:2px solid var(--c);padding-left:8px;margin-top:6px}
  @keyframes sgFl{0%{box-shadow:0 0 0 2px var(--c),0 0 30px rgba(127,227,255,.6)}100%{box-shadow:none}}
  @keyframes sgIn{from{transform:translateX(105%)}}@keyframes sgUp{from{opacity:0;transform:translateY(18px) scale(.97)}}@keyframes sgBl{50%{opacity:.3}}@keyframes sgBar{from{width:0}}`;
  document.documentElement.appendChild(style);
  const panel = document.createElement("div");
  panel.id = "sg-rank";
  const srcImg = (() => { try { return sessionStorage.getItem("sg-src") || ""; } catch { return ""; } })();
  panel.__price = target.price || 0;
  panel.innerHTML = `<div class="hd"><b>SEED<span>HACK</span></b><small>1688 TRACE RESULT</small><button type="button" class="x" title="닫기">✕</button></div>
    <div class="src"><div class="ph">${srcImg ? `<img src="${srcImg}" alt="">` : ""}</div><div class="t"><span>MY PRODUCT · 쿠팡</span><b>${esc(target.name || "")}</b><i>${target.price ? `쿠팡 판매가 ₩${Number(target.price).toLocaleString("ko-KR")}` : "쿠팡 판매가 없음"}${target.allow ? ` · 허용 소싱가 ¥${Number(target.allow).toFixed(1)}` : ""}</i></div></div>
    <div class="warn" hidden>⚠ 허용 소싱가가 비정상적으로 큽니다 — 리스트업에서 이 상품의 판매가(₩${target.price ? Number(target.price).toLocaleString("ko-KR") : "-"})를 확인해 주세요</div>
    <div class="pipe"></div><div class="nums"></div><div class="st" hidden></div><div class="ai" hidden></div><div class="body"></div>
    <div class="foot"><button type="button" class="go" disabled>▶ 딸깍 추천</button></div>`;
  (document.body || document.documentElement).appendChild(panel);
  setInterval(() => { if (!panel.__t0) return; const s = `${((Date.now() - panel.__t0) / 1000).toFixed(1)}s`; panel.querySelectorAll(".bt").forEach((t) => (t.textContent = s)); }, 100); // 진행 중 경과 시간
  // ✕ = 숨기기(지우지 않음): 보드가 ✕ 자리의 "🎯 추천 보기" 버튼으로 줄어든다. 버튼은 끌어서 옮길 수 있고 마지막 자리를 기억한다.
  // 숨겨 둔 동안에도 옵션가·AI 결과는 계속 갱신된다
  const POS_KEY = "sg-rank-open-pos";
  const reopen = document.createElement("button");
  reopen.type = "button"; reopen.id = "sg-rank-open"; reopen.textContent = "🎯 추천 보기"; reopen.title = "추천 보드 다시 열기 · 끌어서 옮길 수 있어요";
  reopen.style.cssText = "position:fixed;z-index:2147483647;display:none;border:0;border-radius:12px;padding:10px 16px;background:#0b0f14;color:#3ddc84;font:800 14px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:grab;touch-action:none;user-select:none;transition:transform .18s ease";
  (document.body || document.documentElement).appendChild(reopen);
  const clampPos = (x, y) => [Math.max(4, Math.min(innerWidth - reopen.offsetWidth - 4, x)), Math.max(4, Math.min(innerHeight - reopen.offsetHeight - 4, y))];
  const placeAt = (x, y) => { const [cx, cy] = clampPos(x, y); reopen.style.left = cx + "px"; reopen.style.top = cy + "px"; reopen.style.right = "auto"; reopen.style.bottom = "auto"; };
  panel.querySelector(".x").addEventListener("click", () => {
    const xr = panel.querySelector(".x").getBoundingClientRect();
    panel.style.display = "none"; reopen.style.display = "block";
    let saved = null; try { saved = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch {}
    if (saved && Number.isFinite(saved.x)) placeAt(saved.x, saved.y);
    else placeAt(xr.right - reopen.offsetWidth, xr.top); // 처음엔 ✕ 자리로 줄어든 것처럼
    reopen.style.transform = "scale(1.12)"; setTimeout(() => (reopen.style.transform = ""), 180);
  });
  // 끌어서 옮기기(5px 넘게 움직이면 끌기, 아니면 누르기)
  let drag = null;
  reopen.addEventListener("pointerdown", (e) => { const r = reopen.getBoundingClientRect(); drag = { sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false }; reopen.setPointerCapture(e.pointerId); reopen.style.cursor = "grabbing"; });
  reopen.addEventListener("pointermove", (e) => { if (!drag) return; if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return; drag.moved = true; placeAt(e.clientX - drag.ox, e.clientY - drag.oy); });
  reopen.addEventListener("pointerup", () => {
    if (!drag) return; const moved = drag.moved; drag = null; reopen.style.cursor = "grab";
    if (moved) { const r = reopen.getBoundingClientRect(); try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch {} return; }
    panel.style.display = ""; reopen.style.display = "none";
  });
  reopen.addEventListener("click", (e) => { if (e.detail === 0) { panel.style.display = ""; reopen.style.display = "none"; } }); // 키보드(Enter)로 열기
  addEventListener("resize", () => { if (reopen.style.display === "block") { const r = reopen.getBoundingClientRect(); placeAt(r.left, r.top); } });
  panel.querySelector("button.go").addEventListener("click", async () => {
    // 가격 확인이 필요하면 먼저 하고(끝나면 AI 자동), 아니면 바로 AI
    panel.__want = true;
    const r = await ipcRenderer.invoke("cn:probe");
    if (r?.nothing || r?.error) { panel.__want = false; ipcRenderer.invoke("cn:ai"); }
  });
  ipcRenderer.on("cn:rankUpdate", (_e, r) => renderRank(panel, r));
  const r = await ipcRenderer.invoke("cn:rank", { cards });
  if (r?.error) { scan?.fail(r.error); panel.querySelector(".st").textContent = r.error; return; }
  if (scan) await scan.rank(r, cards); // 판매자 점수로 도장 → 추천 후보 → 닫히면 추천 패널이 보인다
  renderRank(panel, r);
  // 🎯 담기 자동 조사: 사람이 딸깍을 누른 것처럼 옵션가 확인 → AI까지 이어 간다(끝나면 main이 리스트업에 원가를 넣는다)
  if (target.auto && r.top?.length) {
    panel.__want = true;
    const pr = await ipcRenderer.invoke("cn:probe");
    if (pr?.nothing || pr?.error) { panel.__want = false; ipcRenderer.invoke("cn:ai"); }
  }
}

function captchaNotice() {
  if (!isCaptcha() || document.getElementById("sg-captcha")) return;
  ipcRenderer.invoke("cn:probeMode").then((probe) => { if (probe) return; ipcRenderer.send("cn:captcha"); });
  const el = document.createElement("div");
  el.id = "sg-captcha";
  el.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#ffb454;color:#1f1300;font:700 14px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)";
  el.textContent = "1688 보안 인증 — 아래 슬라이더를 직접 밀어 주세요. 끝나면 자동으로 이어집니다.";
  (document.body || document.documentElement).appendChild(el);
}

// ---- 💬 판매자 문의: 상품 페이지 왼쪽 아래 버튼. 누르면 앱이 판매자 연락(旺旺) 버튼을 사람처럼 눌러 채팅을 열고 질문을 3단계로 나눠 보낸다 ----
async function askPill() {
  if (document.getElementById("sg-ask") || !/(^|\.)1688\.com$/i.test(location.hostname)) return;
  if (await ipcRenderer.invoke("cn:probeMode")) return;
  const el = document.createElement("div");
  el.id = "sg-ask";
  el.style.cssText = "position:fixed;left:18px;bottom:18px;z-index:2147483647;display:flex;gap:6px;font:700 13px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";
  const b = "border:0;border-radius:10px;padding:10px 14px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);font:inherit";
  el.innerHTML = (isOffer() ? `<button type="button" class="ask" style="${b};background:#3ddc84;color:#06240f" title="판매자에게 재고·박스 입수량 → 포장 사이즈·사진 → 무지/영문 박스 순서로 나눠서 묻습니다. 판매자가 수량·가격을 되물으면 멈추고 알려 드립니다.">💬 AI 문의</button>` : "")
    + `<button type="button" class="box" style="${b};background:#0b0f14;color:#fff" hidden>문의함 <span class="n"></span></button>`
    + `<button type="button" class="tr" style="${b};background:#0b0f14;color:#7cb3ff" title="1688 화면 번역 — 누를 때마다: 한글로 → 중국어 아래 한글 → 끄기 (마우스를 올리면 중국어 원문)">🌐</button>`
    + (isOffer() ? `<button type="button" class="wave" style="${b};background:#0b0f14;color:#3ddc84" title="파도타기 — 이 상품 중국어 제목에서 핵심 키워드를 뽑아 타오바오·1688을 판매순으로 다시 훑고, 처음 보는 상품을 사진으로 국내 확인">🌊 파도타기</button>` : "")
    + `<button type="button" class="tb" style="${b};background:#ff5000;color:#fff" title="같은 쿠팡 사진으로 타오바오에서 같은 상품 찾기 — 직접 촬영한 판매자 상세·구매자 리뷰 사진을 참고 자료로">🛍 타오바오</button>`;
  (document.body || document.documentElement).appendChild(el);
  const boxBtn = el.querySelector(".box");
  ipcRenderer.on("chat:count", (_e, n) => { boxBtn.hidden = !n; boxBtn.querySelector(".n").textContent = n || ""; });
  boxBtn.addEventListener("click", () => ipcRenderer.invoke("chat:act", { a: "show" }));
  el.querySelector(".wave")?.addEventListener("click", (e) => waveStart(e.currentTarget));
  el.querySelector(".tb")?.addEventListener("click", async (e) => {
    const r = await ipcRenderer.invoke("tb:search");
    if (r?.error) { e.currentTarget.textContent = "✕ " + r.error.slice(0, 30); setTimeout(() => { e.currentTarget.textContent = "🛍 타오바오"; }, 4000); }
  });
  const trBtn = el.querySelector(".tr"), TRK = { replace: "🌐 한글로", below: "🌐 아래 한글", off: "🌐 번역 끔" };
  ipcRenderer.invoke("cn:trmode", false).then((m) => { trBtn.textContent = TRK[m] || "🌐"; }).catch(() => {});
  trBtn.addEventListener("click", async () => {
    const m = await ipcRenderer.invoke("cn:trmode", true);
    trBtn.textContent = TRK[m] || "🌐";
    document.documentElement.setAttribute("data-sg-tr-mode", m); // 바로 반영(다음 번역은 2.5초 안에)
  });
  el.querySelector(".ask")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = "⏳ 채팅 여는 중…";
    const r = await ipcRenderer.invoke("chat:inquire", { offerId: offerId(), title: readTitle() });
    btn.disabled = false; btn.textContent = r?.error ? `✕ ${r.error}` : r?.already ? "💬 이미 문의 중" : "✔ 1단계 보냄";
    setTimeout(() => { btn.textContent = "💬 AI 문의"; }, 6000);
  });
  ipcRenderer.invoke("chat:act", { a: "count" });
}
// 1688이 없는 상품 번호를 받으면 첫 화면(…spm=…notfound)으로 돌려보낸다 → 조용히 첫 화면이 뜨지 않게 알린다
function notFoundNotice() {
  if (!/(^|\.)1688\.com$/i.test(location.hostname) || !/notfound/i.test(location.search) || document.getElementById("sg-nf")) return;
  ipcRenderer.send("cn:log", `1688이 '없는 상품' 화면으로 돌려보냈습니다 (${document.referrer.slice(0, 120) || "이전 주소 모름"}) — 판매 종료됐거나 상품 번호를 잘못 읽은 것`);
  const el = document.createElement("div");
  el.id = "sg-nf";
  el.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#ffb454;color:#1f1300;font:700 14px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)";
  el.textContent = "1688에서 이 상품을 찾을 수 없다고 합니다(판매 종료 또는 번호 오류) — ← 뒤로 가서 다른 후보를 열어 주세요";
  (document.body || document.documentElement).appendChild(el);
  setTimeout(() => el.remove(), 12000);
}
// ---- 🛍 타오바오: 같은 쿠팡 사진으로 "搜同款(사진 검색)" ----
// 타오바오 첫 화면·검색 화면의 사진 칸(.image-search-context-inner-tip-wrapper input[type=file])에 사진을 넣으면 "按图片搜索 / 搜索" 상자가 뜬다 → 搜索.
// 결과는 새 창(s.taobao.com/search?imgSearchOrigin=…)으로 열리고 앱이 같은 화면에 띄운다. 그 화면에서 결과가 없으면(사진이 안 넘어옴) 그 화면 사진 칸에 한 번 더 올린다.
const isTb = () => /(^|\.)(taobao|tmall)\.com$/i.test(location.hostname);
const sgBand = (id, text, ms = 0) => {
  if (document.getElementById(id)) return;
  const el = document.createElement("div");
  el.id = id;
  el.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#ffb454;color:#1f1300;font:700 14px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:80vw";
  el.textContent = text;
  (document.body || document.documentElement).appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
};
const tbItems = () => [...document.querySelectorAll('a[href*="item.taobao.com/item.htm"], a[href*="detail.tmall.com/item.htm"], a[href*="//item.taobao.com"], a[href*="//detail.tmall.com"]')].filter((a) => a.getBoundingClientRect().width > 60);
async function tbUpload(pend, log) {
  const input = await waitFor(() => document.querySelector(".image-search-context-inner-tip-wrapper input[type=file]") || document.querySelector('[class*="image-search" i] input[type=file]') || document.querySelector("input[type=file]"), 10000);
  if (!input) { log("사진 칸을 못 찾았습니다"); return false; }
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(pend.b64), (c) => c.charCodeAt(0))], "coupang.jpg", { type: pend.type || "image/jpeg" }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const btn = await waitFor(() => {
    const w = document.querySelector('[class*="image-search-context-wrapper"]') || document;
    const b = w.querySelector(".upload-button-active, .upload-button") || [...w.querySelectorAll("button, div, span, a")].filter((e) => (e.innerText || "").trim() === "搜索" && e.getBoundingClientRect().width > 0).pop();
    return b && b.getBoundingClientRect().width > 0 ? b : null;
  }, 10000);
  if (!btn) { log("사진은 넣었지만 '搜索' 버튼을 못 찾았습니다"); return false; }
  btn.click();
  log("사진 검색 버튼을 눌렀습니다");
  return true;
}
async function taobaoAuto() {
  if (!isTb() || !/^(www\.|s\.)?taobao\.com$/i.test(location.hostname)) return;
  const pend = await ipcRenderer.invoke("tb:pending");
  if (!pend) return;
  const log = (t) => ipcRenderer.send("tb:log", t);
  await sleep(1500);
  // 로그인 여부를 화면 글자로 짐작하지 않는다(로그인돼 있어도 "登录" 글자가 남아 있어 잘못 막았음, 2026-10-13).
  // 일단 검색하고, 결과가 없을 때만 로그인·보안 인증을 안내한다.
  if (/^s\.taobao\.com$/i.test(location.hostname)) {
    try { log(`진단 결과화면: opener=${!!window.opener} name=${String(window.name || "").slice(0, 80)} ref=${document.referrer.slice(0, 80)} ss=[${Object.keys(sessionStorage).slice(0, 12).join(",")}] ls=[${Object.keys(localStorage).filter((k) => /img|image|pic|search|pai/i.test(k)).slice(0, 12).join(",")}]`); } catch {}
    if (await waitFor(() => tbItems().length >= 3, 8000)) { ipcRenderer.invoke("tb:pendingDone"); log(`타오바오 결과 ${tbItems().length}개 — 상품을 열어 상세·리뷰를 보세요`); sgBand("sg-tb-ok", "🛍 타오바오 같은 상품 결과입니다 — 상품을 열고 '📷 리뷰 사진 모으기'를 누르면 리뷰 사진을 모읍니다", 9000); return; }
    const key = "sg-tb-retry:" + pend.ts;
    if (sessionStorage.getItem(key)) { ipcRenderer.invoke("tb:pendingDone"); log("다시 올려도 결과가 없습니다"); sgBand("sg-tb-none", "타오바오 사진 검색 결과가 없습니다 — 타오바오 로그인이 풀렸거나 보안 인증(슬라이더)이 떠 있을 수 있어요. 확인한 뒤 화면의 '搜同款'에 사진을 올려 주세요"); return; }
    sessionStorage.setItem(key, "1");
    log("결과가 없어 이 화면 사진 칸에 다시 올립니다");
    await tbUpload(pend, log);
    if (await waitFor(() => tbItems().length >= 3, 15000)) { ipcRenderer.invoke("tb:pendingDone"); log(`타오바오 결과 ${tbItems().length}개`); }
    return;
  }
  log("타오바오 첫 화면 · 사진 올리는 중");
  await tbUpload(pend, log);
}

// ---- 📷 타오바오·티몰 상품 화면: 리뷰 사진 모으기 ----
// 리뷰(评价) 칸을 열고 누르면 화면에 뜬 구매자 사진과 글을 모아 번역해 보여 준다. 누를 때마다 더 읽은 리뷰가 쌓인다.
// 저장은 고른 사진만. 다른 판매자·구매자 사진은 권리가 그 사람에게 있으니 상세페이지에는 참고(구도·장면)로 쓰는 것을 기본으로.
const tbReviews = new Map(); // 사진 주소 → { url, zh }
const bigImg = (u) => String(u || "").replace(/^\/\//, "https://").replace(/_(\d+x\d+|\.webp|q\d+)[^/]*$/i, "").replace(/\.(jpg|jpeg|png)_.*$/i, ".$1");
function readTbReviews() {
  const roots = [...document.querySelectorAll('[class*="comment" i], [class*="review" i], [class*="rate" i], [class*="Comment"], [class*="Review"], [class*="Rate"]')].filter((e) => !e.closest("#sg-tb-rv") && e.getBoundingClientRect().height > 40);
  let added = 0;
  for (const r of roots) for (const img of r.querySelectorAll("img")) {
    const u = img.currentSrc || img.src || img.getAttribute("data-src") || "";
    if (!/alicdn|taobaocdn|tbcdn/.test(u) || /avatar|head|icon|logo|\.gif/i.test(u)) continue;
    const box = img.getBoundingClientRect(); if (box.width < 40 || box.height < 40) continue;
    const url = bigImg(u); if (tbReviews.has(url)) continue;
    const block = img.closest('[class*="item" i], [class*="Item"], li') || img.parentElement;
    const zh = (block?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300);
    tbReviews.set(url, { url, zh }); added++;
  }
  return added;
}
async function reviewPill() {
  if (!isTb() || !/item\.htm/i.test(location.pathname) || document.getElementById("sg-tb-rv-pill")) return;
  const pill = document.createElement("button");
  pill.id = "sg-tb-rv-pill"; pill.type = "button";
  pill.style.cssText = "position:fixed;left:18px;bottom:18px;z-index:2147483647;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);background:#ff5000;color:#fff;font:700 13px -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";
  pill.textContent = "📷 리뷰 사진 모으기";
  pill.title = "리뷰(评价) 칸을 열고 누르세요 — 화면에 뜬 구매자 사진·글을 모읍니다. 더 내려서 다시 누르면 쌓입니다";
  (document.body || document.documentElement).appendChild(pill);
  pill.addEventListener("click", async () => {
    const n = readTbReviews();
    ipcRenderer.send("tb:log", `리뷰 사진 ${n}장 새로 읽음 (모두 ${tbReviews.size}장) · ${location.pathname}`);
    if (!tbReviews.size) { sgBand("sg-tb-rv0", "리뷰 사진을 못 찾았습니다 — 상품 화면의 '评价(리뷰)'를 열어 사진 리뷰가 보이게 한 뒤 다시 눌러 주세요", 8000); return; }
    showReviewBox();
  });
}
async function showReviewBox() {
  document.getElementById("sg-tb-rv")?.remove();
  const list = [...tbReviews.values()];
  const box = document.createElement("div");
  box.id = "sg-tb-rv";
  box.style.cssText = "position:fixed;left:14px;top:70px;bottom:70px;width:380px;z-index:2147483647;background:#0b0f14;color:#fff;border-radius:14px;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.4);font:13px/1.45 -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;display:flex;flex-direction:column";
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">📷 리뷰 사진 ${list.length}장</b><button type="button" class="x" style="background:none;border:0;color:#9fb3c8;font-size:16px;cursor:pointer">✕</button></div>
    <div style="font-size:12px;color:#ffb454;margin:6px 0 8px">다른 판매자·구매자 사진은 권리가 그 사람에게 있습니다 — 상세페이지에는 구도·장면 참고용으로 쓰는 것을 권합니다</div>
    <div class="g" style="flex:1;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
    <button type="button" class="sv" style="margin-top:10px;border:0;border-radius:10px;padding:11px;background:#3ddc84;color:#06240f;font-weight:800;cursor:pointer">고른 사진 저장 (폴더 열기)</button>`;
  (document.body || document.documentElement).appendChild(box);
  box.querySelector(".x").addEventListener("click", () => box.remove());
  const g = box.querySelector(".g");
  g.innerHTML = list.map((x, i) => `<label style="display:block;background:#05070a;border:1px solid #2b3a4c;border-radius:10px;padding:6px;cursor:pointer">
      <input type="checkbox" data-i="${i}" checked style="float:right"><img src="${esc(x.url)}" referrerpolicy="no-referrer" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px">
      <div class="t" data-i="${i}" style="font-size:11.5px;color:#cbd5e1;margin-top:4px;max-height:5.8em;overflow:hidden">${esc(x.ko || x.zh || "")}</div></label>`).join("");
  // 리뷰 글 한글 번역(저장해 둔 번역 재사용)
  const need = list.map((x, i) => [x, i]).filter(([x]) => x.zh && !x.ko);
  if (need.length) ipcRenderer.invoke("tb:translate", need.map(([x]) => x.zh)).then((ko) => need.forEach(([x, i], j) => { if (ko[j]) { x.ko = ko[j]; const t = g.querySelector(`.t[data-i="${i}"]`); if (t) t.textContent = ko[j]; } })).catch(() => {});
  box.querySelector(".sv").addEventListener("click", async (e) => {
    const items = [...g.querySelectorAll("input:checked")].map((c) => list[+c.dataset.i]).map((x) => ({ url: x.url, zh: x.zh, ko: x.ko || "" }));
    if (!items.length) return;
    e.currentTarget.disabled = true; e.currentTarget.textContent = `저장 중… (${items.length}장)`;
    const id = (location.search.match(/[?&](?:id|item_id|itemId)=(\d{6,})/) || [])[1] || "item";
    const r = await ipcRenderer.invoke("tb:saveReviews", { itemId: id, url: location.href.split("#")[0], title: document.title, items });
    e.currentTarget.textContent = r?.error ? "✕ " + r.error : `✓ ${r.saved}장 저장 — 폴더가 열렸습니다`;
    e.currentTarget.disabled = false;
  });
}

// 진단: 이미지 검색 결과 화면 주소(영역 region 등)가 어떻게 바뀌는지 남긴다 — 1688이 받는 "전체 사진" 영역 형식을 찾기 위함
function logResultsUrl() {
  if (!/pc-image-search|youyuan|tab=imageSearch/i.test(location.pathname + location.search)) return;
  let last = "";
  const tick = () => { if (location.href !== last) { last = location.href; ipcRenderer.send("cn:log", `진단 결과주소: ${location.href.replace(/^https:\/\/[^/]+/, "").slice(0, 600)}`); } };
  tick(); setInterval(tick, 1000);
}
// ---- 🌊 파도타기 ----
// 1688 상품 화면 🌊 → 핵심 키워드(AI) 고르기 → 타오바오/1688 판매순 1페이지 → 오른쪽 "파도타기 보드":
// 최근 주문 많은 순 · 처음 봄 · 최근 등록 추정(상품 번호가 큰 쪽) · 사진으로 국내 확인(구글 렌즈, 위 6개 자동)
const WAVE_CSS = `
#sg-wave{position:fixed;right:14px;top:14px;bottom:14px;width:420px;z-index:2147483646;background:#fff;color:#18181b;border:1px solid #e4e4e7;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);font:14px/1.45 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;display:flex;flex-direction:column;overflow:hidden}
#sg-wave .hd{padding:14px 16px 10px;border-bottom:1px solid #f4f4f5}
#sg-wave .hd .t{display:flex;justify-content:space-between;align-items:center} #sg-wave .hd b{font-size:17px}
#sg-wave .x{background:none;border:0;font-size:18px;color:#71717a;cursor:pointer;padding:4px 8px}
#sg-wave .sub{font-size:12px;color:#71717a;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sg-wave .kws{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
#sg-wave .kw{border:1px solid #d4d4d8;background:#fff;border-radius:16px;padding:5px 11px;cursor:pointer;font-size:13px;color:#3f3f46}
#sg-wave .kw.on{background:#16a34a;border-color:#16a34a;color:#fff;font-weight:700} #sg-wave .kw small{opacity:.75;margin-left:4px}
#sg-wave .site{display:flex;gap:6px;margin-top:8px;align-items:center;font-size:12px;color:#52525b}
#sg-wave .site button{border:1px solid #d4d4d8;background:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:13px}
#sg-wave .site button.on{background:#18181b;color:#fff;border-color:#18181b;font-weight:700}
#sg-wave .nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:10px 16px}
#sg-wave .num{border:1px solid #e4e4e7;border-radius:12px;padding:8px 10px} #sg-wave .num span{font-size:11.5px;color:#52525b} #sg-wave .num b{display:block;font:900 22px/1.2 ui-monospace,Menlo,monospace}
#sg-wave .num.g{background:#f0fdf4;border-color:#86efac} #sg-wave .num.g b{color:#15803d}
#sg-wave .flt{display:flex;gap:6px;padding:0 16px 8px} #sg-wave .flt button{border:1px solid #d4d4d8;background:#fff;border-radius:14px;padding:4px 10px;font-size:12.5px;cursor:pointer} #sg-wave .flt button.on{background:#18181b;color:#fff;border-color:#18181b}
#sg-wave .list{flex:1;overflow:auto;padding:0 16px 16px;display:flex;flex-direction:column;gap:10px}
#sg-wave .card{display:flex;gap:10px;border:1px solid #e4e4e7;border-radius:12px;padding:10px}
#sg-wave .card img{width:84px;height:84px;object-fit:cover;border-radius:8px;background:#f4f4f5;flex:none}
#sg-wave .card .b{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
#sg-wave .card .tt{font-weight:700;font-size:13.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#sg-wave .card .zh{font-size:11.5px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sg-wave .card .pr{display:flex;gap:8px;align-items:baseline} #sg-wave .card .pr b{font:900 18px ui-monospace,Menlo,monospace} #sg-wave .card .pr span{font-size:12.5px;color:#3f3f46}
#sg-wave .bd{display:flex;gap:4px;flex-wrap:wrap} #sg-wave .bd i{font-style:normal;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;background:#18181b;color:#fff} #sg-wave .bd i.o{background:#fff;color:#18181b;border:1px solid #d4d4d8}
#sg-wave .kr{font-size:12px;color:#52525b;display:flex;gap:4px;flex-wrap:wrap;align-items:center}
#sg-wave .kr em{font-style:normal;padding:1px 7px;border-radius:6px;background:#f4f4f5;color:#52525b} #sg-wave .kr em.few{background:#dcfce7;color:#166534;font-weight:700} #sg-wave .kr .ok{color:#15803d;font-weight:700}
#sg-wave .act{display:flex;gap:6px;margin-top:2px} #sg-wave .act button{flex:1;border:1px solid #d4d4d8;background:#fff;border-radius:8px;padding:6px 4px;font-size:12.5px;cursor:pointer;color:#3f3f46}
#sg-wave .foot{font-size:11.5px;color:#71717a;padding:8px 16px;border-top:1px solid #f4f4f5}
#sg-wave .empty{color:#71717a;font-size:13px;padding:20px 0;text-align:center}`;
const shopChip = (sh, cls) => `<em class="${cls}" ${sh.url ? `data-url="${esc(sh.url)}" role="button" tabindex="0" title="${esc(sh.name)} 대표 상품 열기" style="cursor:pointer;text-decoration:underline;text-underline-offset:2px"` : ""}>${esc(sh.name)} ${sh.n}건</em>`;
const waveIsSearch = () => (/^s\.1688\.com$/i.test(location.hostname) && /offer_search/i.test(location.pathname)) || (/^s\.taobao\.com$/i.test(location.hostname) && /[?&]q=/.test(location.search) && !/imgSearchOrigin/.test(location.search));
const num = (s) => { const m = String(s || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(万|w)?/i); return m ? Math.round(Number(m[1]) * (m[2] ? 10000 : 1)) : null; };
// 상품 화면 → 키워드 뽑기 → 고르기 상자
async function waveStart(btn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳ 키워드 뽑는 중…";
  const img = document.querySelector('meta[property="og:image"]')?.content || [...document.images].filter((i) => i.naturalWidth >= 300).sort((a, b) => b.naturalWidth - a.naturalWidth)[0]?.src || "";
  // 앱을 다시 켜기 전(메인에 파도타기가 없을 때)이나 AI 오류면 멈춰 있지 말고 이유를 보여 준다
  const r = await ipcRenderer.invoke("wave:start", { titleZh: document.title, img, url: location.href, cost: readPrice() })
    .catch((e) => ({ error: /No handler/.test(String(e)) ? "앱을 한 번 다시 켜야 파도타기가 동작합니다 (Cmd+Q 후 다시 실행)" : String(e?.message || e).slice(0, 80) }));
  btn.disabled = false; btn.textContent = old;
  if (r?.error) { sgBand("sg-wave-err", "🌊 " + r.error, 6000); return; }
  waveChooser(r.ctx);
}
function waveChooser(ctx) {
  document.getElementById("sg-wave")?.remove();
  if (!document.getElementById("sg-wave-css")) { const st = document.createElement("style"); st.id = "sg-wave-css"; st.textContent = WAVE_CSS; document.documentElement.appendChild(st); }
  const box = document.createElement("div"); box.id = "sg-wave"; box.style.bottom = "auto";
  let site = ctx.lastSite || "taobao";
  const draw = () => {
    box.innerHTML = `<div class="hd"><div class="t"><b>🌊 파도타기</b><button type="button" class="x" aria-label="닫기">✕</button></div>
      <div class="sub">${esc(ctx.titleZh)}</div>
      <div class="kws">${ctx.keywords.map((k) => `<button type="button" class="kw" data-kw="${esc(k.zh)}">${esc(k.zh)}<small>${esc(k.ko)}</small></button>`).join("")}<button type="button" class="kw add">+ 직접 입력</button></div>
      <div class="site">어디서 · <button type="button" data-s="taobao" class="${site === "taobao" ? "on" : ""}">타오바오</button><button type="button" data-s="1688" class="${site === "1688" ? "on" : ""}">1688</button> · 키워드를 누르면 판매순으로 엽니다</div></div>`;
    box.querySelector(".x").onclick = () => box.remove();
    box.querySelectorAll(".site button").forEach((b) => (b.onclick = () => { site = b.dataset.s; draw(); }));
    box.querySelectorAll(".kw[data-kw]").forEach((b) => (b.onclick = () => ipcRenderer.invoke("wave:open", { kw: b.dataset.kw, site })));
    box.querySelector(".kw.add").onclick = async () => { const k = prompt("중국어 키워드를 넣어 주세요 (예: 记忆棉颈枕)"); if (!k) return; const c = await ipcRenderer.invoke("wave:addKeyword", k); if (c) { ctx = c; draw(); } };
  };
  draw();
  (document.body || document.documentElement).appendChild(box);
}
// 검색 결과 카드 읽기 (1688: data-renderkey 끝 번호 · 타오바오: 상품 링크의 id=)
function waveCards() {
  const out = new Map();
  if (/1688\.com$/i.test(location.hostname)) {
    for (const c of document.querySelectorAll("[data-renderkey]")) {
      const id = (c.getAttribute("data-renderkey") || "").split("_").reverse().find((x) => /^\d{9,14}$/.test(x)); if (!id || out.has(id)) continue;
      const lines = (c.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean), j = lines.join(" ");
      const jn = j.replace(/(\d),(\d{3})/g, "$1$2"); // 1,400 → 1400 (앱 🌐 번역이 켜져 있으면 "600개 이상의 항목"처럼 한국어로 바뀐다)
      const pm = j.match(/[¥￥]\s*(\d+)(?:\s*(\.\d+))?/), sm = jn.match(/(\d+(?:\.\d+)?)\s*(万)?\+?\s*件(?!\s*起)/) || jn.match(/(\d+(?:\.\d+)?)\s*(만)?\s*개\s*이상(?!\s*(?:구매|주문))/);
      out.set(id, { id, site: "1688", title: lines[0] || "", price: pm ? Number(pm[1] + (pm[2] || "")) : null, orders: sm ? Math.round(Number(sm[1]) * (sm[2] ? 10000 : 1)) : null,
        img: (c.querySelector("img")?.currentSrc || c.querySelector("img")?.src || "").replace(/_\d+x\d+.*$/, ""), url: `https://detail.1688.com/offer/${id}.html` });
    }
  } else {
    for (const a of document.querySelectorAll('a[href*="item.taobao.com/item.htm"], a[href*="detail.tmall.com/item.htm"], a[href*="item.htm?id="]')) {
      const id = (a.href.match(/[?&]id=(\d{6,15})/) || [])[1]; if (!id || out.has(id)) continue;
      let c = a; for (let k = 0; k < 6 && c.parentElement && !(c.querySelector("img") && /[¥￥]/.test(c.innerText || "")); k++) c = c.parentElement;
      const lines = (c.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean), j = lines.join(" ");
      if (!/[¥￥]/.test(j)) continue;
      const pm = j.match(/[¥￥]\s*(\d+)(?:\s*(\.\d+))?/);
      const jn = j.replace(/(\d),(\d{3})/g, "$1$2");
      const sm = jn.match(/(\d+(?:\.\d+)?)\s*(万)?\+?\s*人(?:付款|收货|购买)/) || jn.match(/已售\s*(\d+(?:\.\d+)?)\s*(万)?\+?/) || jn.match(/(\d+(?:\.\d+)?)\s*(万|만)?\+?\s*(?:명|인)\s*(?:이\s*)?(?:결제|구매|수령|구입)/) || jn.match(/(?:판매|구매)\s*(\d+(?:\.\d+)?)\s*(만)?\+?/) || jn.match(/(\d+(?:\.\d+)?)\s*(万)?\+?\s*(?:件|笔)/);
      const title = lines.filter((l) => /[一-鿿]/.test(l) && l.length >= 8).sort((x, y) => y.length - x.length)[0] || lines[0] || "";
      out.set(id, { id, site: "taobao", title, price: pm ? Number(pm[1] + (pm[2] || "")) : null, orders: sm ? Math.round(Number(sm[1]) * (sm[2] ? 10000 : 1)) : null,
        img: (c.querySelector("img")?.currentSrc || c.querySelector("img")?.src || "").replace(/^\/\//, "https://"), url: a.href.split("#")[0] });
    }
  }
  return [...out.values()];
}
async function waveBoard() {
  if (!waveIsSearch() || document.getElementById("sg-wave")) return;
  const ctx = await ipcRenderer.invoke("wave:ctx"); if (!ctx) return;
  if (!document.getElementById("sg-wave-css")) { const st = document.createElement("style"); st.id = "sg-wave-css"; st.textContent = WAVE_CSS; document.documentElement.appendChild(st); }
  const site = /1688/.test(location.hostname) ? "1688" : "taobao";
  const kw = decodeURIComponent((location.search.match(/[?&](?:q|keywords)=([^&]+)/) || [])[1] || "").replace(/\+/g, " ");
  const box = document.createElement("div"); box.id = "sg-wave";
  (document.body || document.documentElement).appendChild(box);
  const S = { cards: [], fresh: new Set(), kr: new Map(), tr: new Map(), onlyNew: false, onlyKr: false, first: false, since: null };
  const log = (t) => ipcRenderer.send("cn:log", "🌊 " + t);
  const read = async () => {
    const got = waveCards();
    if (!got.length) {
      const anchors = document.querySelectorAll('a[href*="item"]').length;
      log(`결과 카드를 못 읽음 · ${location.host} · 상품링크 ${anchors}개 · 글자 ${(document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 160)}`);
    }
    const ids = got.map((c) => c.id).filter((id) => !S.cards.some((x) => x.id === id));
    const sr = await ipcRenderer.invoke("wave:seen", { site, kw, ids }); (sr?.fresh || []).forEach((id) => S.fresh.add(id)); if (S.cards.length === 0) { S.first = !!sr?.first; S.since = sr?.since || null; }
    const all = [...S.cards, ...got.filter((c) => ids.includes(c.id))];
    const sortedIds = all.map((c) => BigInt(c.id)).sort((a, b) => (a < b ? -1 : 1)), cut = sortedIds[Math.floor(sortedIds.length * 0.8)] ?? null;
    S.cards = all.map((c) => ({ ...c, recent: cut != null && BigInt(c.id) >= cut })).sort((a, b) => (b.orders ?? -1) - (a.orders ?? -1));
    const need = S.cards.filter((c) => !S.tr.has(c.id) && /[一-鿿]/.test(c.title)).slice(0, 40);
    if (need.length) ipcRenderer.invoke("tb:translate", need.map((c) => c.title)).then((ko) => { need.forEach((c, i) => ko[i] && S.tr.set(c.id, ko[i])); draw(); }).catch(() => {});
    draw();
  };
  const lens = async (c) => {
    if (S.kr.has(c.id)) return; S.kr.set(c.id, { busy: true }); draw();
    const r = await ipcRenderer.invoke("wave:lens", { img: c.img, id: c.id });
    S.kr.set(c.id, r?.ok ? r : { error: r?.error || "실패" }); draw();
  };
  const draw = () => {
    const krDone = [...S.kr.values()].filter((x) => x.ok), few = krDone.filter((x) => x.total <= 3).length;
    // 처음 봄: 처음 검색한 키워드면 없음. 다시 조회했는데 대부분(60% 넘게)이 처음이면 의미 없으니 숨김
    const newCount = S.cards.filter((c) => S.fresh.has(c.id)).length, showNew = !S.first && newCount > 0 && newCount <= S.cards.length * 0.6;
    const list = S.cards.filter((c) => (!S.onlyNew || !showNew || S.fresh.has(c.id)) && (!S.onlyKr || (S.kr.get(c.id)?.ok && S.kr.get(c.id).total <= 3)));
    box.innerHTML = `<div class="hd"><div class="t"><b>🌊 파도타기 · ${site === "1688" ? "1688" : "타오바오"} 판매순</b><button type="button" class="x" aria-label="닫기">✕</button></div>
      <div class="sub">키워드 ${esc(kw)} · 출발 ${esc(ctx.name || ctx.titleZh)}</div>
      <div class="kws">${ctx.keywords.map((k) => `<button type="button" class="kw ${k.zh === kw ? "on" : ""}" data-kw="${esc(k.zh)}" title="${esc(k.ko)}">${esc(k.zh)}<small>${esc(k.ko)}</small></button>`).join("")}</div>
      <div class="site">다른 곳에서 · <button type="button" data-s="${site === "1688" ? "taobao" : "1688"}">${site === "1688" ? "타오바오" : "1688"}로 같은 키워드</button><button type="button" class="re" title="아래로 내려 더 나온 상품까지 다시 읽기">↻ 다시 읽기</button></div></div>
      <div class="nums"><div class="num"><span>찾은 후보</span><b>${S.cards.length}</b></div><div class="num"><span>처음 봄</span><b>${showNew ? newCount : "-"}</b></div><div class="num g"><span>국내 거의 없음</span><b>${few}<small style="font-size:12px;color:#52525b">/${krDone.length}</small></b></div></div>
      <div class="flt">${showNew ? `<button type="button" class="fn ${S.onlyNew ? "on" : ""}">처음 본 것만</button>` : ""}<button type="button" class="fk ${S.onlyKr ? "on" : ""}">국내 적은 것만</button></div>
      <div class="list">${list.map((c) => { const k = S.kr.get(c.id); return `<div class="card" data-id="${c.id}"><img src="${esc(c.img)}" alt="" referrerpolicy="no-referrer"><div class="b">
        <div class="bd">${showNew && S.fresh.has(c.id) ? "<i>처음 봄</i>" : ""}${c.recent ? '<i class="o">최근 등록 추정</i>' : ""}</div>
        <div class="tt">${esc(S.tr.get(c.id) || c.title)}</div>${S.tr.get(c.id) ? `<div class="zh">${esc(c.title)}</div>` : ""}
        <div class="pr"><b>${c.price != null ? "¥" + c.price : "-"}</b><span>${c.orders != null ? `최근 ${c.orders.toLocaleString()}건 주문` : "주문 수 없음"}</span></div>
        <div class="kr">${!k ? `<button type="button" class="lens" style="border:1px solid #d4d4d8;background:#fff;border-radius:8px;padding:3px 8px;font-size:12px;cursor:pointer">📷 국내 확인</button>` : k.busy ? "⏳ 사진으로 국내 확인 중…" : k.error ? `<span style="color:#ea580c">✕ ${esc(k.error)}</span>` : k.total <= 3 ? `<span class="ok">국내 거의 없음</span>${k.shops.map((s) => shopChip(s, "few")).join("")}` : `<span>국내 판매 ${k.total}건</span> ${k.shops.slice(0, 4).map((s) => shopChip(s, "")).join("")}`}</div>
        <div class="act"><button type="button" class="open">상품 열기</button></div></div></div>`; }).join("") || `<div class="empty">${S.cards.length ? "조건에 맞는 상품이 없습니다" : "결과 카드를 읽는 중…"}</div>`}</div>
      <div class="foot">참고 지표 · 국내 판매는 사진을 구글 렌즈로 찾은 한국 쇼핑몰 결과 수 · 쇼핑몰 이름을 누르면 대표 상품이 열립니다</div>`;
    box.querySelector(".x").onclick = () => box.remove();
    box.querySelectorAll(".kw[data-kw]").forEach((b) => (b.onclick = () => ipcRenderer.invoke("wave:open", { kw: b.dataset.kw, site })));
    box.querySelector(".site button[data-s]").onclick = (e) => ipcRenderer.invoke("wave:open", { kw, site: e.currentTarget.dataset.s });
    box.querySelector(".re").onclick = () => read();
    box.querySelectorAll("em[data-url]").forEach((el) => (el.onclick = () => ipcRenderer.invoke("wave:ext", el.dataset.url)));
    box.querySelector(".fn").onclick = () => { S.onlyNew = !S.onlyNew; draw(); };
    box.querySelector(".fk").onclick = () => { S.onlyKr = !S.onlyKr; draw(); };
    box.querySelectorAll(".card").forEach((el) => {
      const c = S.cards.find((x) => x.id === el.dataset.id);
      el.querySelector(".lens")?.addEventListener("click", () => lens(c));
      el.querySelector(".open").onclick = () => { location.href = c.url; };
    });
  };
  draw();
  await sleep(2500); await read();
  setTimeout(read, 5000); // 늦게 그려지는 카드까지
  // 주문 많은 위 6개는 자동으로 국내 확인(한 번에 하나씩)
  for (const c of S.cards.slice(0, 6)) { if (!box.isConnected) break; await lens(c); }
}

const safeStart = () => { waveBoard().catch((e) => ipcRenderer.send("cn:log", `🌊 보드 오류: ${e && e.message}`)); logResultsUrl(); taobaoAuto().catch((e) => ipcRenderer.send("tb:log", `자동 사진 검색 오류: ${e && e.message}`)); reviewPill().catch(() => {}); notFoundNotice(); captchaNotice(); askPill().catch(() => {}); start().catch(() => {}); rankPanel().catch((e) => ipcRenderer.send("cn:log", `추천 패널 오류: ${e && e.message}`)); autoImageSearch().catch((e) => ipcRenderer.send("cn:log", `자동 이미지 검색 오류: ${e && e.message}`)); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safeStart);
else safeStart();

// ---- 📄 상세페이지 만들기: 상품 페이지(1688·타오바오·티몰)의 제목·가격·속성표·옵션·갤러리·상세 이미지를 읽어 main(detail:fromPage)으로 보낸다 ----
// 화면 DOM 만 읽는다(1688에 추가 요청 없음 — 상세 글·그림은 기존 readDetailText 와 같은 detailUrl 한 번만). 다듬기(꼬리 제거·중복·개수 제한)는 main 의 extract-core.js 가 한다.
const DETAIL_FIXTURE_RE = /\/test\/detail\/fixture\/offer[\w-]*\.html$/;
const txt1 = (s) => String(s || "").replace(/\s+/g, " ").trim();
const absUrl = (u) => { try { return new URL(String(u || "").trim(), location.href).href; } catch { return ""; } };
const isPageUrl = (u) => { const a = String(u || "").split("#")[0], b = location.href.split("#")[0]; return !a || a === b || /\.html?(?:[?#]|$)/i.test(a); };
function detailSite() {
  if (location.protocol === "file:") return document.querySelector('meta[name="sg-source"]')?.content || "1688";
  const h = location.hostname;
  if (/(^|\.)1688\.com$/i.test(h)) return "1688";
  if (/(^|\.)tmall\.(com|hk)$/i.test(h)) return "tmall";
  if (/(^|\.)taobao\.com$/i.test(h)) return "taobao";
  return "other";
}
// 상품 번호: 1688 은 offerId(), 타오바오·티몰은 item.htm?id=…, fixture 는 meta(sg-offer-id) 또는 900000001
function detailProductId() {
  if (location.protocol === "file:") return DETAIL_FIXTURE_RE.test(location.pathname) ? (document.querySelector('meta[name="sg-offer-id"]')?.content || offerId() || "900000001") : null;
  const s = detailSite();
  if (s === "1688") return offerId();
  if ((s === "taobao" || s === "tmall") && /\/item\.htm/i.test(location.pathname)) { const m = location.search.match(/[?&](?:id|item_id|itemId)=(\d{6,})/); return m ? m[1] : null; }
  return null;
}
const isProductPage = () => !!detailProductId();
const inOurUi = (el) => !!el.closest("#sg-detail, #sg-cn-box, #sg-rank, #sg-ask, #sg-captcha");

// 그림 한 장의 주소·크기. 지연 로딩 속성(data-lazyload-src 등)이 있으면 그것이 진짜 주소(src 는 1x1 자리표시일 때가 많다)
const LAZY_ATTRS = ["data-lazyload-src", "data-lazy-src", "data-src", "data-original", "data-ks-lazyload", "data-imgsrc"];
function imgInfo(img) {
  let url = "", lazy = false;
  for (const a of LAZY_ATTRS) { const v = img.getAttribute(a); if (v && !/^data:/i.test(v)) { url = absUrl(v); lazy = true; break; } }
  if (!url) { const s = img.currentSrc || img.getAttribute("src") || ""; if (!/^data:/i.test(s)) url = absUrl(s); }
  if (!url || isPageUrl(url)) return null; // src=" "·"#" 같은 빈 주소는 페이지 주소로 풀린다 → 그림 아님
  if (!lazy && img.complete && img.naturalWidth === 1 && img.naturalHeight === 1) return null; // 진짜 1x1 간격 그림
  let w = 0, h = 0;
  if (!lazy && img.naturalWidth > 1) { w = img.naturalWidth; h = img.naturalHeight; }
  else {
    // 안 읽힌 그림: width/height 속성, 지연 로딩이면 그려진 크기(60px 이상일 때만 — 썸네일로 작게 그려진 큰 원본을 아이콘으로 오해하지 않게)
    w = +img.getAttribute("width") || 0; h = +img.getAttribute("height") || 0;
    if (!w && lazy && img.isConnected) { const r = img.getBoundingClientRect(); if (r.width >= 60) { w = Math.round(r.width); h = Math.round(r.height); } }
  }
  return w ? { url, w, h } : { url };
}
const imgsIn = (root) => [...root.querySelectorAll("img")].filter((i) => !inOurUi(i)).map(imgInfo).filter(Boolean);

// 긴 페이지의 지연 로딩 깨우기: 300ms 간격으로 최대 20단계 아래로 내려갔다가 맨 위로
async function wakeLazy() {
  const H = () => document.documentElement.scrollHeight, step = Math.max(600, innerHeight);
  for (let i = 0, y = 0; i < 20 && y < H(); i++) { y += step; scrollTo(0, y); await sleep(300); }
  scrollTo(0, 0); await sleep(200);
}

// 상세 설명 컨테이너: ① 알려진 id/class ② class 에 desc/description ③ 못 찾으면 null(적응형 묶음으로)
const DESC_KNOWN = '#detail-description, .desc-lazyload-container, #J_DivItemDesc, #description, [class*="desc-lazyload" i], [class*="detail-desc" i], [class*="offer-description" i], [class*="detail-description" i], [class*="desc-root" i], [class*="descV" i], [id*="description" i]';
const DESC_LOOSE = '[class*="description" i], [class*="desc" i], [id*="desc" i], [class*="detail" i][class*="content" i]';
function findDescContainer() {
  const depth = (e) => { let d = 0; for (let p = e; p; p = p.parentElement) d++; return d; };
  const best = (els, min) => {
    const c = els.filter((e) => e !== document.body && e !== document.documentElement && !inOurUi(e)).map((e) => ({ e, n: e.querySelectorAll("img").length })).filter((x) => x.n >= min);
    c.sort((a, b) => b.n - a.n || depth(b.e) - depth(a.e)); // 그림 많은 것, 같으면 안쪽 것
    return c[0]?.e || null;
  };
  return best([...document.querySelectorAll(DESC_KNOWN)], 1) || best([...document.querySelectorAll(DESC_LOOSE)], 3);
}
// 적응형: 페이지의 그림 중 폭 ≥ 400 인 것을 세로 순으로 보고, 위아래 간격 ≤ 300px 이고 가로로 겹치는 "연속 묶음" 가운데 가장 긴 것 (extract-core.pickDetailImages 와 같은 규칙)
function pickRunImages(minW = 400, gap = 300) {
  const cands = [];
  for (const img of document.images) {
    if (inOurUi(img)) continue;
    const info = imgInfo(img); if (!info) continue;
    const r = img.getBoundingClientRect(); // 위치·간격은 화면에 그려진 크기로, 보고하는 w/h 는 원본 크기(알면)로
    if (r.width < minW) continue;
    cands.push({ info, rw: r.width, rh: r.height, top: Math.round(r.top + scrollY), left: Math.round(r.left + scrollX) });
  }
  cands.sort((a, b) => a.top - b.top);
  let best = [], run = [];
  for (const c of cands) {
    const p = run[run.length - 1];
    if (p && c.top - (p.top + p.rh) <= gap && p.left < c.left + c.rw && c.left < p.left + p.rw) run.push(c); else run = [c];
    if (run.length > best.length) best = run;
  }
  return best.map((c) => c.info);
}
// 페이지 안 script 의 detailUrl(itemcdn) HTML — readDetailText 와 같은 한 번의 요청. 없으면 "".
async function fetchDetailHtml() {
  const scripts = [...document.scripts].map((s) => s.textContent || "").join("\n");
  const m = scripts.match(/"detailUrl"\s*:\s*"(https?:\\?\/\\?\/itemcdn[^"]+)"/);
  if (!m) return "";
  try {
    const t = await (await fetch(m[1].replace(/\\\//g, "/"), { credentials: "omit" })).text();
    const inner = (t.match(/"content"\s*:\s*"([\s\S]*)"\s*}\s*;?\s*$/) || [])[1] || t;
    return inner.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\\"/g, '"').replace(/\\\//g, "/");
  } catch { return ""; }
}
const htmlToText = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 20000);

// 갤러리(대표 사진): 메인 이미지 영역 + 썸네일 ul 의 그림. 옵션·상세 영역 안의 것은 뺀다
const GALLERY_SEL = '[class*="detail-gallery" i], [class*="gallery" i], [class*="main-image" i], [class*="mainPic" i], [class*="PicGallery" i], [class*="preview" i], [class*="thumb" i], [class*="img-list" i], [class*="imgList" i], [class*="pic-list" i], [class*="turn-wrapper" i], [class*="carousel" i], [class*="swiper" i], #J_UlThumb, [class*="tb-pic" i], [class*="booth" i], [class*="imgTag" i]';
const VIDEO_RE = /video|vod|play-?btn|player|cloudvideo|\.mp4/i;
// 동영상 표지(첫 썸네일이 동영상인 경우가 많다): 조상·자신의 class 나 주소에 video/play 가 있으면 뺀다
const isVideoThumb = (el, url) => {
  if (VIDEO_RE.test(url || "")) return true;
  for (let p = el, d = 0; p && d < 4; p = p.parentElement, d++) if (VIDEO_RE.test(String(p.className || "") + " " + (p.id || ""))) return true;
  const item = el.closest("li, [class*='item' i]"); // 썸네일 한 칸 안에 재생 아이콘·video 가 있으면 동영상 표지
  return !!(item && item.querySelector('video, [class*="play" i], [class*="video" i]'));
};
// 배경 그림(div style=background-image) 썸네일
const bgUrl = (el) => { const m = String(el.getAttribute("style") || "").match(/background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)/i); return m ? absUrl(m[1]) : ""; };
// 페이지 스크립트 JSON 의 대표 사진 목록(1688: offerImgList / images[].fullPathImageURI·originalImageURI, 타오바오: auctionImages)
function galleryFromScripts() {
  const text = [...document.scripts].map((s) => s.textContent || "").join("\n").slice(0, 3000000);
  const out = [];
  const unq = (u) => { try { return JSON.parse(`"${u}"`); } catch { return u; } };
  for (const key of ["offerImgList", "auctionImages", "imageList", "imgList"]) {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]{0,6000})\\]`));
    if (m) for (const u of m[1].matchAll(/"((?:https?:)?\\?\/\\?\/[^"]+|[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)) out.push(absUrl(unq(u[1])));
    if (out.length) break;
  }
  if (!out.length) for (const m of text.matchAll(/"(?:fullPathImageURI|originalImageURI)"\s*:\s*"([^"]+)"/g)) out.push(absUrl(unq(m[1])));
  return [...new Set(out)].filter((u) => u && !VIDEO_RE.test(u) && !isPageUrl(u)).slice(0, 20).map((url) => ({ url, from: "script" }));
}
function readGallery(desc) {
  const out = [], seen = new Set();
  const key = (u) => u.replace(/[?#].*$/, "").replace(/(\.(?:jpe?g|png|webp))(?:[._].*)$/i, "$1").replace(/\.(?:\d{2,4}x\d{2,4}\w*|search|summ|sum)\.(jpe?g|png)$/i, ".$1"); // 크기 꼬리 다른 같은 그림
  const push = (x) => { if (!x?.url || isPageUrl(x.url)) return; const k = key(x.url); if (seen.has(k)) return; seen.add(k); out.push(x); };
  galleryFromScripts().forEach(push);
  for (const root of document.querySelectorAll(GALLERY_SEL)) {
    if (inOurUi(root) || (desc && (desc.contains(root) || root.contains(desc))) || root.closest('[class*="sku" i], [class*="recommend" i], [class*="shop" i], [class*="company" i]')) continue;
    for (const el of [root, ...root.querySelectorAll('img, [style*="background"]')]) { // 썸네일 순서 그대로(그림·배경 그림 섞여도)
      if (inOurUi(el)) continue;
      if (el.tagName === "IMG") { const x = imgInfo(el); if (x && !isVideoThumb(el, x.url)) push(x); }
      else { const u = bgUrl(el); if (u && !isVideoThumb(el, u)) push({ url: u }); }
    }
  }
  return out.slice(0, 20);
}
// 페이지 스크립트 JSON 에서 "key": 다음의 [ … ] / { … } 를 괄호 짝 맞춰 잘라 JSON 으로 읽는다(문자열 안 괄호는 건너뜀)
function jsonAfterKey(text, key) {
  const out = [];
  const re = new RegExp(`"${key}"\\s*:\\s*([\\[{])`, "g");
  let m;
  while ((m = re.exec(text)) && out.length < 3) {
    let i = m.index + m[0].length - 1, depth = 0, inStr = false;
    for (let j = i; j < text.length && j < i + 400000; j++) {
      const ch = text[j];
      if (inStr) { if (ch === "\\") j++; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") { if (--depth === 0) { try { out.push(JSON.parse(text.slice(i, j + 1))); } catch {} break; } }
    }
  }
  return out;
}
// 옵션(SKU) 그림·이름: 1688 = skuProps[{prop, value:[{name, imageUrl}]}], 타오바오·티몰 = skuBase.props[{name, values:[{name, image}]}]
// 그림 있는 속성(색상·款式 등)을 먼저 — Fatkun 이 "SKU-01-옵션명" 으로 받는 것과 같은 목록. 화면 DOM 이 바뀌어도 데이터는 그대로라 가장 믿을 만하다
function skuFromScripts() {
  const text = [...document.scripts].map((s) => s.textContent || "").join("\n").slice(0, 3000000);
  const props = [];
  for (const arr of jsonAfterKey(text, "skuProps")) if (Array.isArray(arr)) for (const p of arr) props.push({ prop: txt1(p?.prop || p?.name), values: (p?.value || p?.values || []).map((v) => ({ label_zh: txt1(v?.name || v?.value), img: v?.imageUrl || v?.image || v?.imgUrl || "" })) });
  if (!props.length) for (const base of jsonAfterKey(text, "skuBase")) for (const p of base?.props || []) props.push({ prop: txt1(p?.name), values: (p?.values || []).map((v) => ({ label_zh: txt1(v?.name), img: v?.image || "" })) });
  if (!props.length) return [];
  const best = props.find((p) => p.values.some((v) => v.img)) || props[0];
  return best.values.filter((v) => v.label_zh).map((v) => ({ label_zh: v.label_zh.slice(0, 60), img: v.img ? absUrl(v.img) : "", prop: best.prop, from: "script" }));
}
// 옵션(1단계): 1688 은 기존 readLevel1() 재사용, 타오바오·티몰은 J_TSaleProp / skuItem 먼저. 상세·갤러리 영역 안의 것과 이름 없는 것은 뺀다
function readOptions(desc) {
  const bad = (el) => !el || inOurUi(el) || (desc && desc.contains(el)) || !!el.closest(GALLERY_SEL);
  const fromTaobao = () => [...document.querySelectorAll('ul.J_TSaleProp li, [class*="J_TSaleProp" i] li, [class*="skuItem" i] [class*="valueItem" i], [class*="SkuContent" i] [class*="valueItem" i], ul[class*="sku" i] li')].filter((e) => !bad(e))
    .map((e) => ({ label_zh: txt1(e.getAttribute("title") || e.querySelector("[title]")?.getAttribute("title") || e.textContent).slice(0, 60), img: imgInfo(e.querySelector("img") || document.createElement("img"))?.url || "" }));
  // 1688: 알려진 옵션 버튼(구형 sku-filter-button, 신형 prop-item/sku-item) → 없으면 기존 readLevel1()(적응형). 옵션 영역(sku/prop/spec) 밖의 것은 뺀다(상점명·아이콘이 잡히던 문제)
  const inSku = (el) => { for (let p = el, d = 0; p && d < 10; p = p.parentElement, d++) if (/sku|prop|spec|selection/i.test(String(p.className || "") + " " + (p.id || ""))) return true; return false; };
  const known1688 = () => [...document.querySelectorAll('.module-od-sku-selection .sku-filter-button, [class*="sku-selection" i] [class*="prop-item" i], [class*="sku-prop" i] [class*="prop-item" i], [class*="sku-item-wrapper" i], [class*="sku-props" i] [class*="item" i]:not([class*="item" i] [class*="item" i])')].filter((e) => !bad(e))
    .map((e) => ({ label_zh: txt1(e.querySelector('[class*="name" i], [class*="label" i], [title]')?.textContent || e.getAttribute("title") || e.textContent).slice(0, 60), img: imgInfo(e.querySelector("img") || document.createElement("img"))?.url || bgUrl(e.querySelector('[style*="background"]') || e) || "" }));
  const from1688 = () => { const k = known1688(); if (k.length) return k; try { return readLevel1().filter((x) => !bad(x.el) && inSku(x.el)).map(({ label, img }) => ({ label_zh: label, img: img ? absUrl(img) : "" })); } catch { return []; } };
  const tb = detailSite() === "taobao" || detailSite() === "tmall";
  const fromScript = skuFromScripts();
  if (fromScript.length) return fromScript;
  const list = (tb ? fromTaobao() : from1688());
  return (list.length ? list : tb ? from1688() : fromTaobao()).filter((o) => o.label_zh && o.label_zh.length <= 40);
}
// 속성표 k/v: ① 표(tr 의 칸 짝) ② dt/dd ③ class 에 name/key/label + value 짝인 항목 ④ "名称:值" 글자 분해
function readAttrs() {
  const out = [], seen = new Set();
  const push = (k, v) => { k = txt1(k).replace(/[:：]\s*$/, ""); v = txt1(v); if (!k || !v || k.length > 40 || seen.has(k)) return; seen.add(k); out.push({ k_zh: k, v_zh: v.slice(0, 200) }); };
  const roots = [...document.querySelectorAll('[class*="attribute" i], [class*="offer-attr" i], #J_AttrUL, .attributes-list, [class*="attrs" i], [class*="props" i], [class*="ParamsInfo" i]')].filter((e) => !inOurUi(e));
  for (const root of roots.filter((r) => !roots.some((o) => o !== r && o.contains(r)))) {
    const n0 = out.length;
    // 타오바오·티몰 새 화면(参数信息): 항목 = Title + SubTitle. 강조 칸(emphasis)은 큰 글씨가 값·작은 글씨가 이름, 일반 칸은 Title=이름·SubTitle=값
    for (const it of root.querySelectorAll('[class*="ParamsInfoItem" i]')) { const ch = [...it.children], t = ch.find((c) => /ItemTitle/i.test(String(c.className))), s = ch.find((c) => /SubTitle/i.test(String(c.className))); if (t && s) { if (/emphasis/i.test(String(it.className))) push(s.textContent, t.textContent); else push(t.textContent, s.textContent); } }
    if (out.length > n0) continue;
    for (const tr of root.querySelectorAll("tr")) { const c = [...tr.children].map((x) => txt1(x.textContent)); for (let i = 0; i + 1 < c.length; i += 2) push(c[i], c[i + 1]); }
    if (out.length > n0) continue;
    for (const dt of root.querySelectorAll("dt")) { const dd = dt.nextElementSibling; if (dd?.tagName === "DD") push(dt.textContent, dd.textContent); }
    if (out.length > n0) continue;
    const items = [...root.querySelectorAll("*")].filter((e) => e.children.length >= 2 && e.children.length <= 4 && [...e.children].some((c) => /name|key|label|title/i.test(String(c.className))) && [...e.children].some((c) => /value|val\b|content/i.test(String(c.className))));
    for (const it of items) push([...it.children].find((c) => /name|key|label|title/i.test(String(c.className))).textContent, [...it.children].find((c) => /value|val\b|content/i.test(String(c.className))).textContent);
    if (out.length > n0) continue;
    for (const line of String(root.innerText || root.textContent || "").split("\n")) { const m = line.match(/^\s*([^:：]{1,20}?)\s*[:：]\s*(.+?)\s*$/); if (m) push(m[1], m[2]); }
  }
  return out;
}
// 가격 구간: ¥ 붙은 숫자(가격 칸) 전부 → min/max. 없으면 숫자만 든 가격 칸(price-text, tb-rmb-num) → 기존 readPrice()
function readPriceRange() {
  const vals = [], ok = (v) => v > 0 && v < 100000;
  for (const el of document.querySelectorAll('[class*="price" i], [class*="Price"]')) {
    if (el.children.length > 6 || inOurUi(el)) continue;
    const t = txt1(el.textContent); if (!t || t.length > 80) continue;
    for (const m of t.matchAll(/[¥￥]\s*(\d{1,6}(?:\.\d{1,2})?)/g)) if (ok(+m[1])) vals.push(+m[1]);
    if (el.children.length === 0 && /^\d{1,6}(?:\.\d{1,2})?$/.test(t) && ok(+t)) vals.push(+t);
  }
  if (!vals.length) for (const el of document.querySelectorAll('[class*="rmb-num" i], [class*="priceText" i]')) { const n = parseFloat(txt1(el.textContent)); if (ok(n)) vals.push(n); }
  if (!vals.length) { const p = readPrice(); if (p != null) vals.push(p); }
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals), currency: "CNY" } : null;
}
// 상점: 이름·연차(n年)·回头率 — 있으면
function readShop() {
  const nameEl = [...document.querySelectorAll('[class*="company-name" i], [class*="companyName" i], [class*="shop-name" i], [class*="shopName" i], [class*="seller-name" i], [class*="supplier-name" i], [class*="slogo-shopname" i]')].find((e) => !inOurUi(e) && txt1(e.textContent));
  const area = [...document.querySelectorAll('[class*="shop" i], [class*="company" i], [class*="supplier" i], [class*="seller" i], [class*="winport" i]')].filter((e) => !inOurUi(e)).map((e) => e.innerText || "").join("\n").slice(0, 4000);
  const years = (area.match(/(\d{1,2})\s*[年년]/) || [])[1], repeat = (area.match(/(?:回头率|재\s*구매\s*율?)[^\d]{0,8}(\d{1,3}(?:\.\d+)?)\s*%/) || [])[1]; // 1688 한국어판도
  const name = txt1(nameEl?.textContent).slice(0, 80);
  return name || years || repeat ? { name, years: years ? +years : null, repeat: repeat ? +repeat : null } : null;
}

// 상품명: 1688 새 화면은 첫 h1 이 판매자 회사명인 경우가 있다(温州莱龙卫浴有限公司 등 — 2026-10-09 실제 두 건).
// 후보를 여러 곳에서 모아 회사명처럼 보이는 것은 빼고 첫 번째를 쓴다. 순서: 스크립트 JSON subject/offerTitle → 상점 영역 밖 h1·제목 class → og:title → 문서 제목(꼬리 제거) → 스크립트 "title" → 그 밖의 title class
const COMPANY_RE = /(有限责任公司|股份有限公司|有限公司|公司|工厂|厂|商行|贸易|实业|商贸|经营部|旗舰店|专营店|专卖店|유한\s*회사|유한\s*공사|주식\s*회사|회사|공장|상사|무역|상회)\s*$/;
const isCompanyName = (t) => COMPANY_RE.test(String(t || "").replace(/[\s()（）]+$/g, ""));
const SHOP_AREA_RE = /shop|company|seller|store|supplier|winport|enterprise|factory/i;
const inShopArea = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) if (SHOP_AREA_RE.test(String(p.className || "") + " " + (p.id || ""))) return true; return false; };
const stripSiteTail = (t) => txt1(t).replace(/\s*[-—_|｜]\s*(阿里巴巴|1688|淘宝网?|天猫|tmall|taobao|alibaba)[^-—_|｜]*$/i, "").trim();
function readTitleCandidates() {
  const out = [], seen = new Set();
  const tb = /^(taobao|tmall)$/.test(detailSite()); // 타오바오·티몰: 검색칸 문구(按图片搜索 등)가 상품명으로 잡히던 문제(2026-10-12 실제 1건) → 새 화면 mainTitle 먼저, 화면 도구 문구는 뺀다
  const add = (t, from) => { t = txt1(t).slice(0, 200); if (t.length < 4 || seen.has(t) || (tb && /^(按图片搜索|图片搜索|以图搜[款图]|搜索|搜同款|找同款|找相似|淘宝网|天猫|登录|首页|宝贝详情|商品详情)$/.test(t))) return; seen.add(t); out.push({ t, from, company: isCompanyName(t) }); };
  const scripts = [...document.scripts].map((s) => s.textContent || "").join("\n").slice(0, 2000000);
  const fromJson = (key) => { for (const m of scripts.matchAll(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){4,200})"`, "g"))) { try { add(JSON.parse(`"${m[1]}"`), key); } catch {} } };
  fromJson("subject"); fromJson("offerTitle");
  const fromEls = (sel, from) => { for (const el of document.querySelectorAll(sel)) { if (inOurUi(el) || inShopArea(el) || el.closest("head") || el.children.length > 3) continue; add(el.getAttribute("data-title") || el.textContent, from); } };
  if (tb) { fromEls('[class*="mainTitle" i], [class*="ItemTitle" i] h1, .tb-main-title', "mainTitle"); add(stripSiteTail(document.title), "document.title"); }
  fromEls('h1, [class*="title-text" i], [class*="offer-title" i], [class*="detail-title" i], [class*="main-title" i], [class*="item-title" i]', "h1");
  add(document.querySelector('meta[property="og:title"]')?.content, "og:title");
  add(stripSiteTail(document.title), "document.title");
  fromJson("title");
  fromEls('[class*="title" i]', "title-class"); // 마지막 수단(섹션 제목 등이 섞일 수 있음)
  return out;
}
function readDetailTitle() {
  const c = readTitleCandidates();
  return { title: (c.find((x) => !x.company) || { t: "" }).t, candidates: c.slice(0, 12).map(({ t, from }) => ({ t, from })) };
}

// CONTRACTS 1절 DetailSource 의 raw (브라우저에서 바로 읽은 것)
// 타오바오·티몰 새 화면: 상세 설명은 화면 아래에 닿아야 불러오고, 불러온 뒤 페이지가 더 길어진다 → 높이가 4번 연속 그대로일 때까지 천천히(최대 약 30초)
async function wakeLazyLong() {
  const step = Math.max(600, innerHeight);
  for (let i = 0, y = 0, lastH = 0, still = 0; i < 80 && still < 4; i++) {
    y += step; scrollTo(0, y); await sleep(350);
    const H = document.documentElement.scrollHeight;
    if (y + innerHeight >= H) { still = H === lastH ? still + 1 : 0; lastH = H; y = Math.max(0, H - innerHeight - step); }
  }
  scrollTo(0, 0); await sleep(200);
}
async function readDetailRaw() {
  if (/^(taobao|tmall)$/.test(detailSite()) && location.protocol !== "file:") await wakeLazyLong(); else await wakeLazy();
  const desc = findDescContainer();
  let detailImages = desc ? imgsIn(desc) : [];
  let detailText_zh = desc ? String(desc.innerText || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 20000) : "";
  let how = desc ? `컨테이너 ${desc.tagName.toLowerCase()}${desc.id ? "#" + desc.id : ""}.${String(desc.className || "").split(/\s+/)[0].slice(0, 40)}` : "컨테이너 없음";
  if (detailImages.length < 3) { const run = pickRunImages(); if (run.length > detailImages.length) { detailImages = run; how = `적응형 묶음 ${run.length}장`; } }
  const html = await fetchDetailHtml();
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgs = [...doc.images].map(imgInfo).filter(Boolean);
    if (imgs.length > detailImages.length) { detailImages = imgs; how = `detailUrl ${imgs.length}장`; }
    const t = htmlToText(html); if (t.length > detailText_zh.length) detailText_zh = t;
  }
  const site = detailSite();
  const id = detailProductId();
  const url = location.protocol === "file:" ? location.href : site === "1688" ? `https://detail.1688.com/offer/${id}.html` : location.href.split("#")[0];
  const tt = readDetailTitle();
  return { source: site, url, offerId: id, title_zh: tt.title, titleCandidates: tt.candidates, price: readPriceRange(), attrs: readAttrs(), options: readOptions(desc), gallery: readGallery(desc), detailImages, detailText_zh, shop: readShop(), readAt: Date.now(), how };
}

// 오른쪽 위 떠 있는 버튼(#sg-detail-btn). 기존 #sg-cn-box(오른쪽 아래)·#sg-ask(왼쪽 아래)와 겹치지 않는다
async function detailButton() {
  if (!isProductPage() || document.getElementById("sg-detail")) return;
  if (await ipcRenderer.invoke("cn:probeMode").catch(() => false)) return; // 숨은 창(가격 확인)에는 띄우지 않음
  const style = document.createElement("style");
  style.textContent = `
  #sg-detail{position:fixed;right:18px;top:16px;z-index:2147483647;width:236px;font:13px/1.45 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;text-align:right}
  #sg-detail-btn{border:0;border-radius:10px;padding:10px 14px;background:#0b0f14;color:#fff;font:inherit;font-weight:800;font-size:13.5px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3)}
  #sg-detail-btn:hover{background:#17212b} #sg-detail-btn:disabled{color:#9fb3c8;cursor:default;font-family:ui-monospace,Menlo,Consolas,monospace}
  #sg-detail .msg{margin-top:6px;font-size:12px;color:#fff;background:rgba(11,15,20,.92);border-radius:8px;padding:6px 10px;display:inline-block;max-width:236px;text-align:left} #sg-detail .msg:empty{display:none}
  #sg-detail .msg.ok{color:#3ddc84;font-weight:700} #sg-detail .msg.err{color:#ffb454}`;
  const wrap = document.createElement("div");
  wrap.id = "sg-detail";
  wrap.innerHTML = `<button type="button" id="sg-detail-btn" title="이 상품의 제목·속성표·옵션·대표 사진·상세 이미지를 읽어 한글 상세페이지를 만듭니다. 진행은 📄 상세페이지 화면에서.">📄 상세페이지 만들기</button><div class="msg"></div>`;
  const btn = wrap.querySelector("#sg-detail-btn"), msg = wrap.querySelector(".msg");
  const say = (t, cls) => { msg.textContent = t; msg.className = "msg" + (cls ? " " + cls : ""); };
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "> 읽는 중 ▌"; say("");
    try {
      const raw = await readDetailRaw();
      say(`상세 ${raw.detailImages.length}장 · 대표 ${raw.gallery.length}장 · 속성 ${raw.attrs.length}개 읽음 — 보내는 중`);
      const r = await ipcRenderer.invoke("detail:fromPage", raw);
      if (r?.ok) say("✔ 만들기 시작 — 📄 상세페이지 화면에서 진행을 보세요", "ok");
      else say(String(r?.error || "만들지 못했습니다"), "err");
    } catch (e) { say("✕ " + String(e?.message || e).replace(/^Error invoking remote method '[^']+': /, "").slice(0, 160), "err"); }
    btn.disabled = false; btn.textContent = "📄 상세페이지 만들기";
  });
  const mount = () => { if (!wrap.isConnected) (document.body || document.documentElement).appendChild(wrap); if (!style.isConnected) document.documentElement.appendChild(style); };
  mount();
  setInterval(mount, 1500);
}
const detailStart = () => detailButton().catch((e) => ipcRenderer.send("cn:log", `상세페이지 버튼 오류: ${e && e.message}`));
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", detailStart);
else detailStart();
// 📄 화면의 주소 칸에서 온 요청(detail:fromUrl → 메인이 이 화면을 열고 보냄): 📄 버튼을 누른 것과 똑같이 읽어서 detail:fromPage 로 보낸다
ipcRenderer.on("detail:readPage", async (_e, p) => {
  const reply = (r) => ipcRenderer.send("detail:readPageDone", r);
  const say = (t, cls) => { const m = document.querySelector("#sg-detail .msg"); if (m) { m.textContent = t; m.className = "msg" + (cls ? " " + cls : ""); } };
  try {
    if (!isProductPage()) return reply({ error: "1688 상품 화면이 아닙니다 — 로그인·보안 인증이 떠 있으면 1688 탭에서 넘긴 뒤 그 화면의 📄 버튼을 눌러 주세요" });
    say("📄 화면 요청 — 읽는 중");
    const raw = await readDetailRaw();
    raw.templateId = p?.templateId; raw.rowId = p?.rowId ?? null;
    say(`상세 ${raw.detailImages.length}장 · 대표 ${raw.gallery.length}장 · 속성 ${raw.attrs.length}개 읽음 — 보내는 중`);
    const r = await ipcRenderer.invoke("detail:fromPage", raw);
    say(r?.ok ? "✔ 만들기 시작 — 📄 상세페이지 화면에서 진행을 보세요" : String(r?.error || "만들지 못했습니다"), r?.ok ? "ok" : "err");
    reply(r);
  } catch (e) { const msg = String(e?.message || e).replace(/^Error invoking remote method '[^']+': /, "").slice(0, 160); say("✕ " + msg, "err"); reply({ error: msg }); }
});

// ---- 🎤 발표 모드: 1688 이미지 검색 해커 화면 (씨드핵 시그널 스캔과 같은 모양) ----
// 1688 화면 안에 띄운다(앱 화면보다 1688 화면이 위에 그려지므로). Shadow DOM으로 1688 디자인과 섞이지 않게.
// 첫 화면: 사진 지문(실제 사진 바이트) · 업로드 → 검색 / 결과 화면: 후보 수집(실제 카드 사진) → 판매자 평가(실제 점수) → 추천 후보
// 숫자·도장은 실제 값만: 사진 바이트·후보 카드·앱이 매긴 점수와 판정
async function sgPresent() { try { return !!(await ipcRenderer.invoke("cn:present")); } catch { return false; } }
const SG_ST = { green: ["g", "GO"], yellow: ["y", "HOLD"], red: ["r", "DROP"], candidate: ["c", "PICK"], low: ["n", "LOW"], exclude: ["n", "OUT"] };
const SG_CSS = `
:host{all:initial}
.sc{--neon:#3ddc84;--amber:#ffc94d;--red:#ff5d5d;--cyan:#7fe3ff;--dk:#4f7f62;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif;
  position:fixed;inset:0;background:#04070a;color:#d8e6dc;font:13px/1.5 var(--mono);overflow:hidden;animation:f .2s}
.sc.out{animation:o .38s forwards}
.sc::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(61,220,132,.045) 1px,transparent 1px) 0 0/44px 44px,linear-gradient(90deg,rgba(61,220,132,.045) 1px,transparent 1px) 0 0/44px 44px}
.sc::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:6;background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px),radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,.65))}
.top{position:relative;z-index:2;height:56px;display:flex;align-items:center;gap:22px;padding:0 26px;border-bottom:1px solid #10221a}
.logo{font:800 15px var(--mono);color:#fff;letter-spacing:.08em}.logo b{color:var(--neon)}
.cur{display:inline-block;width:.6em;height:1.05em;vertical-align:-2px;background:var(--neon);margin-left:2px;animation:bl .9s steps(1) infinite}
.cmd{flex:1;min-width:0;color:#5f9c78;white-space:nowrap;overflow:hidden}.cmd .kw{color:#fff}.cmd .fl{color:var(--cyan)}.cmd .p{color:var(--neon)}
.live{color:#5f9c78;font-size:12px;letter-spacing:.08em}.live b{color:#ff6b6b}
.body{position:relative;z-index:1;display:grid;grid-template-columns:300px minmax(0,1fr) 280px;gap:26px;height:calc(100% - 56px - 42px);padding:22px 26px}
.src{display:flex;flex-direction:column;gap:12px;min-height:0}
.lbl{font-size:10.5px;letter-spacing:.14em;color:var(--dk)}
.photo{position:relative;aspect-ratio:1;border-radius:14px;overflow:hidden;background:#fff;border:2px solid #1d4a33;box-shadow:0 0 30px rgba(61,220,132,.2)}
.photo img{width:100%;height:100%;object-fit:contain;display:block}
.photo .laser{position:absolute;left:0;right:0;height:3px;top:0;background:var(--neon);box-shadow:0 0 18px 4px rgba(61,220,132,.7);animation:lz 1.6s ease-in-out infinite alternate}
.photo i{position:absolute;width:26px;height:26px;border:3px solid var(--neon)}.photo i:nth-of-type(1){left:8px;top:8px;border-right:0;border-bottom:0}.photo i:nth-of-type(2){right:8px;top:8px;border-left:0;border-bottom:0}.photo i:nth-of-type(3){left:8px;bottom:8px;border-right:0;border-top:0}.photo i:nth-of-type(4){right:8px;bottom:8px;border-left:0;border-top:0}
.hex{flex:1;min-height:0;border:1px solid #10221a;border-radius:10px;padding:8px 10px;font-size:11px;line-height:1.55;color:#3f7a58;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;-webkit-mask-image:linear-gradient(180deg,transparent,#000 40%)}
.hex p{margin:0;white-space:nowrap}.hex p b{color:#6fbf8e;font-weight:400}
.mid{display:flex;flex-direction:column;gap:14px;min-width:0;min-height:0}
.stages{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.stg span{display:flex;justify-content:space-between;font-size:12px;color:#3f6650}.stg span em{font-style:normal;font-family:var(--sans);font-size:11px}
.stg i{display:block;height:4px;margin-top:6px;border-radius:99px;background:#0e1c15;overflow:hidden;position:relative}.stg i b{position:absolute;inset:0 auto 0 0;width:0;background:var(--neon);box-shadow:0 0 10px var(--neon)}
.stg.on span{color:#fff}.stg.done span{color:var(--neon)}
.reel{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:18px;border:1px solid #10221a;border-radius:14px;background:rgba(6,12,9,.6);padding:22px;overflow:hidden}
.focus{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center}
.fim{width:clamp(140px,24vh,230px);aspect-ratio:1;border-radius:16px;overflow:hidden;background:#0b1410;border:3px solid #1d4a33;display:grid;place-items:center;position:relative}
.fim img{width:100%;height:100%;object-fit:contain;background:#fff}
.fim:empty::before{content:"";position:absolute;inset:24%;border-radius:50%;border:3px solid rgba(61,220,132,.15);border-top-color:var(--neon);border-right-color:var(--neon);animation:sp .7s linear infinite}
.fim.sw{animation:sw .14s ease-out}.fim.g{border-color:var(--neon);box-shadow:0 0 28px rgba(61,220,132,.45)}.fim.y{border-color:var(--amber)}.fim.r{border-color:var(--red)}.fim.c{border-color:var(--cyan)}
.fbd{min-width:0;position:relative}
.fno{font-size:12px;letter-spacing:.14em;color:var(--dk);min-height:1em}
.fnm{font:800 clamp(18px,2.8vh,26px) var(--sans);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:4px 0 10px;padding-right:140px}
.fmt{display:flex;flex-wrap:wrap;gap:4px 24px;font-size:12.5px;color:var(--dk)}.fmt b{display:block;font-size:clamp(17px,2.4vh,22px);color:#eafff2}.fmt b.cy{color:var(--cyan)}
.stamp{position:absolute;right:0;top:0;font:800 clamp(24px,4vh,36px) var(--mono);letter-spacing:.06em;padding:3px 14px;border:3px solid;border-radius:10px;transform:rotate(-8deg);opacity:0}
.stamp.on{animation:st .18s cubic-bezier(.2,1.6,.4,1) forwards}
.stamp.g{color:var(--neon)}.stamp.y{color:var(--amber)}.stamp.r{color:#ff6b6b}.stamp.c{color:var(--cyan)}.stamp.n{color:#4f5f56}
.film{height:80px;display:flex;gap:10px;justify-content:flex-end;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 25%)}
.film div{flex:none;width:80px;height:80px;border-radius:10px;overflow:hidden;background:#fff;border:2px solid #1d4a33;animation:fm .22s ease-out;position:relative}
.film div img{width:100%;height:100%;object-fit:contain}
.film div.g{border-color:var(--neon)}.film div.y{border-color:var(--amber)}.film div.r{border-color:var(--red);opacity:.6}.film div.c{border-color:var(--cyan)}.film div.n{opacity:.5}
.ticker{font-size:14px;color:#bfe8cf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:22px}.ticker .p,.ticker .g{color:var(--neon)}.ticker .d{color:var(--dk)}.ticker .y{color:var(--amber)}.ticker .r{color:#ff6b6b}.ticker .c{color:var(--cyan)}
.ticker::after{content:"";display:inline-block;width:.55em;height:1em;vertical-align:-2px;margin-left:3px;background:var(--neon);animation:bl .8s steps(1) infinite}
.right{display:flex;flex-direction:column;gap:12px;min-height:0}
.st2{border:1px solid #12251b;background:rgba(61,220,132,.025);border-radius:10px;padding:12px 14px}
.st2 span{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.14em;color:var(--dk)}.st2 span em{font-style:normal;font-family:var(--sans);letter-spacing:0;font-size:11px}
.st2 strong{display:block;margin-top:4px;font-size:26px;color:#eafff2}
.st2.big{border-color:#1e4a33;background:rgba(61,220,132,.06)}.st2.big strong{font-size:42px;color:var(--neon);text-shadow:0 0 22px rgba(61,220,132,.55)}
.log{flex:1;min-height:0;border:1px solid #10221a;border-radius:10px;padding:8px 12px;font-size:11.5px;line-height:1.7;color:#5f9c78;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;-webkit-mask-image:linear-gradient(180deg,transparent,#000 45%)}
.log p{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.log .g{color:var(--neon)}.log .y{color:var(--amber)}.log .c{color:var(--cyan)}
.foot{position:relative;z-index:2;height:42px;display:flex;align-items:center;gap:16px;padding:0 26px;border-top:1px solid #10221a;font-size:12px;color:#3f6650}.foot b{color:#bfe8cf;font-weight:600}.foot .sp{flex:1}
.foot button{background:none;border:0;color:#3f6650;font:12px var(--mono);cursor:pointer}.foot button:hover{color:#fff}
.top .cancel{margin-left:14px;background:#1f1407;border:1px solid #b45309;color:#ffb454;border-radius:8px;padding:6px 12px;font:700 13px -apple-system,"Apple SD Gothic Neo",sans-serif;cursor:pointer}.top .cancel:hover{background:#b45309;color:#fff}
.fin{position:absolute;inset:0;z-index:5;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(4,7,10,.93);text-align:center;cursor:pointer}
.fin.on{display:flex;animation:f .25s}
.fin .k{font-size:12px;letter-spacing:.2em;color:var(--dk)}
.fin h3{margin:0;font:800 44px var(--sans);color:#fff}.fin h3 b{color:var(--neon);text-shadow:0 0 24px rgba(61,220,132,.6)}.fin.fail h3{color:#ff6b6b}
.fin p{margin:0;font:14px var(--sans);color:#7fbf98}
.picks{display:flex;gap:14px;margin-top:24px}
.pick{width:160px;border:1px solid #1e4a33;background:#08120d;border-radius:12px;overflow:hidden;text-align:left;font-family:var(--sans)}
.pick .im{height:110px;background:#fff;position:relative}.pick .im img{width:100%;height:100%;object-fit:contain}
.pick .im b{position:absolute;left:8px;top:8px;font:800 11px var(--mono);color:#04210f;background:var(--neon);padding:1px 7px;border-radius:5px}.pick .im b.c{background:var(--cyan)}.pick .im b.y{background:var(--amber)}
.pick .bd{padding:9px 11px 11px}.pick .nm{font-size:12.5px;font-weight:600;color:#eafff2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pick .mt{margin-top:3px;font:12px var(--mono);color:#7fbf98}.pick .mt b{color:var(--neon)}
.slogan{margin-top:26px;font-size:12px;letter-spacing:.12em;color:#3f6650}
@keyframes f{from{opacity:0}}@keyframes o{to{opacity:0;transform:scale(1.02)}}@keyframes bl{50%{opacity:.3}}@keyframes lz{to{top:calc(100% - 3px)}}@keyframes sp{to{transform:rotate(360deg)}}
@keyframes sw{from{transform:translateY(14px) scale(.94);opacity:.3;filter:blur(3px)}}@keyframes st{from{opacity:0;transform:rotate(-8deg) scale(1.8)}to{opacity:1;transform:rotate(-8deg) scale(1)}}@keyframes fm{from{transform:translateX(60px);opacity:0}}`;
function sgScan({ name, photo, stage = 0, wait = "" }) {
  const host = document.createElement("div");
  host.id = "sg-scan";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
  const sh = host.attachShadow({ mode: "open" });
  const STG = [["업로드", "사진 지문"], ["검색", "1688 이미지 검색"], ["수집", "후보 상품"], ["평가", "판매자 점수"]];
  const plain = `seedhack ~ trace "${name}" --site 1688`;
  sh.innerHTML = `<style>${SG_CSS}</style><div class="sc">
    <div class="top"><span class="logo">SEED<b>HACK</b><span class="cur"></span></span><span class="cmd"></span><span class="live"><b>● LIVE</b> <span class="clk"></span></span><button type="button" class="cancel" title="이 검색을 멈추고 1688 첫 화면으로">✕ 검색 취소</button></div>
    <div class="body">
      <div class="src"><div class="lbl">SOURCE · 쿠팡 상품 사진</div><div class="photo">${photo ? `<img src="${photo}" alt="">` : ""}<div class="laser"></div><i></i><i></i><i></i><i></i></div><div class="lbl">IMAGE FINGERPRINT</div><div class="hex"></div></div>
      <div class="mid">
        <div class="stages">${STG.map(([a, b], i) => `<div class="stg"><span>0${i + 1} ${a}<em>${b}</em></span><i><b></b></i></div>`).join("")}</div>
        <div class="reel"><div class="focus"><div class="fim"></div><div class="fbd"><div class="fno"></div><div class="fnm">${esc(stage < 2 ? "1688 이미지 검색 준비" : "1688 후보 상품 수집 중")}</div><div class="fmt"></div><div class="stamp"></div></div></div><div class="film"></div></div>
        <div class="ticker"></div>
      </div>
      <div class="right">
        <div class="st2" data-k="n"><span>CANDIDATES<em>1688 후보</em></span><strong>-</strong></div>
        <div class="st2" data-k="allow"><span>ALLOW<em>허용 소싱가</em></span><strong>-</strong></div>
        <div class="st2 big" data-k="pick"><span>PICK<em>추천 후보</em></span><strong>-</strong></div>
        <div class="log"></div>
      </div>
    </div>
    <div class="foot"><span>ELAPSED <b class="ms">00.00s</b></span><span class="sp"></span><button type="button" class="skip">ESC 건너뛰기 ›</button></div>
    <div class="fin"><div class="k"></div><h3></h3><p></p><div class="picks"></div><div class="slogan">SEEDHACK_ · 매일 한 톨, 시스템처럼.</div></div>
  </div>`;
  (document.body || document.documentElement).appendChild(host);
  const q = (s) => sh.querySelector(s);
  const S = { stage, sp: 0, tl: performance.now(), t0: performance.now(), wait, phase: "A", skip: false, closed: false };
  const stg = [...sh.querySelectorAll(".stg")];
  const setStat = (k, v) => (q(`[data-k="${k}"] strong`).textContent = v);
  // 사진 지문: 실제 사진 바이트를 16바이트씩 흘려 보낸다
  let bytes = null;
  try { if (photo) bytes = Uint8Array.from(atob(photo.split(",")[1] || ""), (c) => c.charCodeAt(0)); } catch {}
  let off = 0;
  const hexTick = setInterval(() => {
    if (!bytes?.length) return;
    const row = [...bytes.slice(off, off + 16)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const p = document.createElement("p"); p.innerHTML = `<b>${off.toString(16).padStart(6, "0")}</b>  ${row}`;
    q(".hex").appendChild(p); while (q(".hex").childElementCount > 40) q(".hex").firstChild.remove();
    off = off + 16 >= Math.min(bytes.length, 65536) ? 0 : off + 16;
  }, 45);
  (async () => { for (let c = 2; c <= plain.length && !S.closed; c += 4) { q(".cmd").textContent = plain.slice(0, c); await sleep(10); }
    if (!S.closed) q(".cmd").innerHTML = `<span class="p">seedhack</span> ~ trace <span class="kw">"${esc(name)}"</span> <span class="fl">--site 1688</span><span class="cur"></span>`; })();
  let raf;
  const frame = (now) => {
    if (S.closed) return;
    q(".clk").textContent = new Date().toLocaleTimeString("en-GB");
    q(".ms").textContent = ((now - S.t0) / 1000).toFixed(2).padStart(5, "0") + "s";
    if (S.phase === "A") {
      S.sp = Math.min(0.9, (now - S.tl) / 6000);
      q(".ticker").innerHTML = `<span class="p">&gt;</span> ${STG[S.stage][0]} <span class="d">·</span> ${esc(S.wait)} <span class="d">${((now - S.tl) / 1000).toFixed(2)}s</span>`;
    }
    stg.forEach((x, j) => { x.className = "stg" + (j < S.stage ? " done" : j === S.stage ? " on" : ""); x.querySelector("b").style.width = (j < S.stage ? 100 : j === S.stage ? S.sp * 100 : 0) + "%"; });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const onKey = (e) => { if (e.key === "Escape") S.skip = true; };
  addEventListener("keydown", onKey, true);
  q(".skip").onclick = () => { if (S.phase === "B") S.skip = true; else api.close(); };
  q(".cancel").onclick = () => { S.closed = false; api.close(); ipcRenderer.invoke("cn:cancel").catch(() => {}); };
  const w = (ms) => (S.skip ? Promise.resolve() : sleep(ms));
  const reel = ({ img, cls, no, nm, meta, stamp }) => {
    const im = q(".fim"); im.innerHTML = img ? `<img src="${esc(img)}" alt="">` : ""; im.className = "fim " + cls; void im.offsetWidth; im.classList.add("sw");
    q(".fno").textContent = no; q(".fnm").textContent = nm || ""; q(".fmt").innerHTML = meta;
    const st = q(".stamp"); st.textContent = stamp; st.className = "stamp " + cls; void st.offsetWidth; st.classList.add("on");
    const th = document.createElement("div"); th.className = cls; th.innerHTML = img ? `<img src="${esc(img)}" alt="">` : ""; q(".film").appendChild(th);
    while (q(".film").childElementCount > 14) q(".film").firstChild.remove();
  };
  const titleOf = (lines) => (lines || []).map((l) => l.trim()).filter((l) => /[一-鿿가-힣]/.test(l) && l.length >= 6).sort((a, b) => b.length - a.length)[0] || "";
  const priceOf = (lines) => { const m = (lines || []).join(" ").match(/[¥￥]\s*(\d+(?:\.\d+)?)/); return m ? m[1] : null; };
  const api = {
    log(t, cls = "") { const p = document.createElement("p"); p.className = cls; p.textContent = t; q(".log").appendChild(p); while (q(".log").childElementCount > 24) q(".log").firstChild.remove(); },
    step(k, wait) { S.stage = k; S.tl = performance.now(); if (wait) S.wait = wait; },
    // 결과 화면의 후보 카드(실제 사진)를 휘리릭 훑는다
    async cards(cards) {
      S.phase = "B"; S.stage = 2; setStat("n", cards.length);
      api.log(`✔ 1688 후보 ${cards.length}개`, "g");
      const per = Math.max(16, Math.min(45, 1500 / Math.max(1, cards.length)));
      for (let i = 0; i < cards.length && !S.closed; i++) {
        const c = cards[i]; S.sp = (i + 1) / cards.length;
        if (!S.skip) {
          reel({ img: c.img, cls: "", no: `#${String(i + 1).padStart(2, "0")} / ${cards.length}`, nm: titleOf(c.lines), meta: `<span>목록가<b>${priceOf(c.lines) ? "¥" + priceOf(c.lines) : "-"}</b></span>`, stamp: "SCAN" });
          q(".ticker").innerHTML = `<span class="p">&gt;</span> 수집 <span class="d">#${String(i + 1).padStart(2, "0")}</span> ${esc(titleOf(c.lines).slice(0, 40))}`;
        }
        await w(i < 4 ? 100 : per);
      }
    },
    // 앱이 매긴 판매자 점수(상위 8개)로 도장을 찍고 → 추천 후보 → 닫기
    async rank(r, cards) {
      if (S.closed || !r?.top) return api.close();
      S.phase = "B"; S.stage = 3; S.sp = 0;
      if (r.allow) setStat("allow", "¥" + r.allow.toFixed(1));
      const imgOf = (x) => x.img || cards.find((c) => c.offerId === x.offerId)?.img || "";
      let pick = 0;
      for (let i = 0; i < r.top.length && !S.closed; i++) {
        const x = r.top[i], [cls, label] = SG_ST[x.verdict] || ["n", "—"], price = x.realPrice ?? x.price;
        if (cls === "g" || cls === "c") { pick++; setStat("pick", pick); }
        S.sp = (i + 1) / r.top.length;
        reel({ img: imgOf(x), cls, no: `${i + 1}위 · ${x.score}/${x.max}점`, nm: x.title, stamp: label,
          meta: `<span>가격<b class="cy">${price != null ? "¥" + price : "-"}</b></span><span>월 판매<b>${x.sales ?? "-"}</b></span><span>재구매<b>${x.repeat != null ? x.repeat + "%" : "-"}</b></span><span>업력<b>${x.years != null ? x.years + "년" : "-"}</b></span>` });
        q(".ticker").innerHTML = `<span class="p">&gt;</span> 평가 <span class="d">${i + 1}위</span> ${esc((x.title || "").slice(0, 36))} <span class="d">· ${x.score}점 →</span> <span class="${cls}">${label}</span>`;
        api.log(`${label.padEnd(4)} ${x.score}점 · ${(x.title || "").slice(0, 14)}`, cls === "g" ? "g" : cls === "c" ? "c" : cls === "y" ? "y" : "");
        await w(i < 3 ? 260 : 160);
      }
      setStat("pick", pick);
      await w(300);
      const top = r.top.filter((x) => ["green", "candidate", "yellow"].includes(x.verdict)).slice(0, 5);
      const d = q(".fin");
      q(".fin .k").textContent = "TRACE COMPLETE";
      q(".fin h3").innerHTML = pick ? `<b>추천 후보 ${pick}개</b> 포착` : "추천 후보 없음";
      q(".fin p").textContent = `1688 후보 ${r.total}개 중 · ${r.allow ? `허용 소싱가 ¥${r.allow.toFixed(1)}` : "허용 소싱가 없음(리스트업 판매가 필요)"} · ▶ 딸깍 추천으로 진짜 가격·AI 판단`;
      q(".picks").innerHTML = top.map((x) => { const [cls, label] = SG_ST[x.verdict] || ["n", "—"]; const im = imgOf(x); return `<div class="pick"><div class="im">${im ? `<img src="${esc(im)}" alt="">` : ""}<b class="${cls}">${label}</b></div><div class="bd"><div class="nm">${esc(x.title)}</div><div class="mt">${(x.realPrice ?? x.price) != null ? "¥" + (x.realPrice ?? x.price) : "-"} · <b>${x.score}점</b></div><div class="mt">월 ${x.sales ?? "-"} · 재구매 ${x.repeat != null ? x.repeat + "%" : "-"}</div></div></div>`; }).join("");
      d.classList.add("on");
      await new Promise((res) => { const t = setTimeout(res, S.skip ? 400 : 2600); d.onclick = () => { clearTimeout(t); res(); }; });
      api.close();
    },
    fail(msg) {
      if (S.closed) return;
      S.phase = "C";
      const d = q(".fin"); q(".fin .k").textContent = "TRACE STOPPED"; q(".fin h3").textContent = "추적 중단"; q(".fin p").textContent = msg || "";
      d.classList.add("on", "fail");
      const t = setTimeout(() => api.close(), 5000); d.onclick = () => { clearTimeout(t); api.close(); };
    },
    close() {
      if (S.closed) return;
      S.closed = true; cancelAnimationFrame(raf); clearInterval(hexTick); removeEventListener("keydown", onKey, true);
      q(".sc").classList.add("out"); setTimeout(() => host.remove(), 380);
    },
  };
  return api;
}
async function sgScanStart(stage, wait) {
  if (!(await sgPresent())) return null;
  const [t, pend] = await Promise.all([ipcRenderer.invoke("cn:target").catch(() => null), ipcRenderer.invoke("cn:pending").catch(() => null)]);
  const photo = pend?.b64 ? `data:${pend.type || "image/jpeg"};base64,${pend.b64}` : "";
  try { if (photo && photo.length < 1500000) sessionStorage.setItem("sg-src", photo); } catch {} // 결과 보드의 "내 상품" 사진
  if (!photo) { try { const p = sessionStorage.getItem("sg-src"); if (p) return sgScan({ name: t?.name || "쿠팡 상품", photo: p, stage, wait }); } catch {} }
  return sgScan({ name: t?.name || "쿠팡 상품", photo, stage, wait });
}
