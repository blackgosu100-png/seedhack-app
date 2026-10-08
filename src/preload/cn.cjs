// 📦 1688 화면 도우미 — 리스트업 행에서 🔍1688로 들어왔을 때, 1688 상품 페이지에 "리스트업에 넣기" 상자를 띄운다.
// 사용자가 연 페이지의 글자만 읽고(추가 요청 없음), 가격은 사용자가 확인·수정한 뒤 넣는다. 슬라이드 인증 등은 사람이 직접.
const { ipcRenderer } = require("electron");

// 1688 상품 번호: detail.1688.com/offer/123.html 또는 (해외판 등) 주소의 offerId=123
function offerId() {
  if (location.protocol === "file:") { const t = location.pathname.match(/\/test\/offer\/(\d+)\.html$/); return t ? t[1] : null; } // 자체 점검용
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
    for (const m of body.matchAll(/[¥￥]\s*(\d{1,6}(?:\.\d{1,2})?)(?!\s*(?:件|个|套|起|pcs))/gi)) if (ok(+m[1])) yen.push(+m[1]);
  }
  const all = yen.length ? yen : bare;
  return all.length ? Math.min(...all) : null;
}
function readTitle() {
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
    tag: "input", attr: { type: "file" }, accept: /jpg|jpeg|png|image/i, near: /以图搜款|图片搜索|搜图|上传图片|image/i, cls: /image|upload|file|search/i, needVisible: false },
  // 사진 올린 뒤 뜨는 "搜索图片" 확인 버튼
  confirm: { css: '.copy-image-container .search-btn, [class*="copy-image"] [class*="search-btn"], [class*="image-search-panel__confirm"] button, [class*="image-search-panel"] button.beacon-btn--primary',
    tag: "button,div,span,a", text: /^(搜索图片|搜索|以图搜款|确认|确定)$/, cls: /search|btn|confirm|submit/i, within: /copy-image|image-search|upload|paste/i },
  // 상품 페이지 1단계 옵션 버튼(사진 + 이름)
  level1: { css: ".module-od-sku-selection .sku-filter-button", many: true, tag: "button,div,li", hasImg: true, cls: /sku|filter|prop|spec/i, within: /sku|prop|spec/i, textMax: 40, minCount: 2, innermost: true },
  // 상품 페이지 가격 행(옵션명 · ¥가격 · 库存)
  item: { css: ".module-od-sku-selection .expand-view-item", many: true, tag: "div,li,tr", text: /[¥￥]\s*\d/, textAlso: /库存|起批|可售/, within: /sku|prop|spec|price/i, textMax: 120, innermost: true },
  // 결과 목록 카드(상품명 · ¥ · 回头率 · 회사)
  card: { css: '[class*="searchOfferWrapper"]', many: true, tag: "div,li,a", text: /[¥￥]\s*\d/, textAlso: /回头率|件|年/, cls: /offer|card|item|wrapper/i, textMax: 600, innermost: true, minCount: 5 },
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
  #sg-cn-box .alts{display:none;gap:6px;margin:8px 0 2px;flex-wrap:wrap} #sg-cn-box .alts.open{display:flex}
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
  const log = (t) => ipcRenderer.send("cn:log", t);
  log(`사진 받음 · 이미지 검색 칸 찾는 중 (${location.host}${location.pathname})`);
  let input = await waitFor(() => findAdaptive("fileInput"), 15000);
  if (!input) {
    // 검색 칸이 바로 없는 화면이면 "이미지 검색/以图搜款" 버튼을 눌러 연 뒤 다시 찾는다
    const vis = (e) => e && e.getBoundingClientRect().width > 0;
    const opener = [...document.querySelectorAll("button, [role=button], span, div")].find((e) => vis(e) && e.children.length <= 2 && SEARCH_RE.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 12)
      || [...document.querySelectorAll('[class*="search-input__image"], [class*="camera" i]')].find(vis);
    opener?.click();
    input = await waitFor(() => findAdaptive("fileInput"), 4000);
  }
  if (!input) { ipcRenderer.invoke("cn:pendingDone"); log("이미지 검색 칸을 못 찾았습니다 — 검색창 카메라 아이콘(以图搜款)에서 Ctrl+V로 붙여 넣어 주세요"); return; }
  log("검색 칸 찾음 · 사진 올리는 중");
  const bytes = Uint8Array.from(atob(pend.b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "coupang.jpg", { type: pend.type || "image/jpeg" }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(1500); // 미리보기 패널 대기
  const btn = await waitFor(() => { const b = findAdaptive("confirm"); return b && b.getBoundingClientRect().width > 0 ? b : null; }, 8000);
  if (!btn) {
    const cands = [...document.querySelectorAll("button, [role=button], [class*='search' i] span, [class*='camera' i], [class*='image' i]")]
      .filter((e) => e.getBoundingClientRect().width > 0 && (e.textContent || "").trim().length < 16).slice(0, 25)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/)[0].slice(0, 28)}="${(e.textContent || "").trim()}"`);
    log(`진단: 패널=${!!document.querySelector('[class*="copy-image"], [class*="image-search-panel"]')} · 후보 ${cands.join(" | ")}`.slice(0, 900));
    log("사진은 올렸지만 검색 버튼을 못 찾았습니다 — 화면의 '搜索图片(이미지 검색)'을 눌러 주세요"); return;
  }
  btn.click(); // 결과는 새 창(//s.1688.com/youyuan/…)으로 열리고, 앱이 같은 화면에 띄운다
  // 사진은 아직 비우지 않는다 — 결과 화면에서 1688이 사진을 못 받았으면(썸네일 깨짐·0건) 결과 화면의 '上传图片'에 한 번 더 올린다(rankPanel)
  log("사진으로 이미지 검색을 시작했습니다 — 결과 화면에서 상품을 열면 '리스트업에 넣기' 상자가 뜹니다");
}

// ---- 이미지 검색 결과 페이지: 판매자 추천 TOP 패널 ----
const isResults = () => /(^|\.)1688\.com$/i.test(location.hostname) && /pc-image-search|youyuan/i.test(location.pathname + location.search);
function readCards() {
  return findAdaptive("card").map((c) => {
    const m = c.outerHTML.match(/"offerId"\s*:\s*\\?"?(\d{9,})/) || c.outerHTML.match(/offerId[^\d]{0,24}(\d{9,})/);
    return { offerId: m ? m[1] : "", lines: (c.innerText || "").split("\n"), img: (c.querySelector("img")?.currentSrc || c.querySelector("img")?.src || "").slice(0, 300) };
  }).filter((c) => c.lines.length > 3);
}
const fmt = (n) => (n == null ? "-" : n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + "만" : String(n));
const VD = { green: "🟢", yellow: "🟡", red: "🔴", candidate: "⚪", low: "·", exclude: "✕" };
function renderRank(panel, r) {
  const body = panel.querySelector(".body"), st = panel.querySelector(".st"), btn = panel.querySelector("button.go");
  const need = r.top.slice(0, 5).filter((x) => x.realPrice == null).length;
  const busy = r.probing || r.aiBusy;
  // 딸깍: 가격 확인 → AI 순서로 자동 진행
  if (panel.__want && !r.probing && !r.aiBusy && !r.ai) { panel.__want = false; ipcRenderer.invoke("cn:ai"); }
  btn.disabled = busy || !r.top.length;
  btn.textContent = r.probing ? `> 옵션가 확인 ${5 - r.probeLeft + 1}/5 ▌` : r.aiBusy ? "> AI 판단 중 ▌" : r.ai && !r.ai.error ? "↻ 다시 추천" : "▶ 딸깍 추천";
  st.textContent = r.captcha ? "✕ 1688 보안 인증 필요 — 1688 탭에서 슬라이더를 밀고 다시 누르세요" : r.ai?.error ? `✕ ${r.ai.error}` : r.ai?.summary ? r.ai.summary : `후보 ${r.total}개${r.allow ? ` · 허용 ¥${r.allow.toFixed(1)}` : ""}`;
  st.title = r.ai?.skipped || "";

  // AI 결과가 있으면 AI 추천 3개, 없으면 규칙 상위 3개
  const ai = r.ai && !r.ai.error && r.ai.picks?.length ? r.ai.picks : null;
  const list = ai ? ai.map((p) => { const c = r.top.find((x) => x.offerId === p.offerId) || {}; return { ...c, ...p, title: p.title_ko || p.title, reason: p.reason_ko, risk: p.risk_ko, verdict: p.verdict, price: p.price ?? c.realPrice ?? c.price }; })
    : r.top.slice(0, 3).map((x) => ({ ...x, title: x.title, price: x.realPrice ?? x.price, reason: x.realPrice != null ? (x.option?.ko || x.option?.label || "") : "가격 확인 전 (목록 최저가)" }));
  body.innerHTML = list.map((x) => `
    <div class="card v-${x.verdict}" title="${esc([x.company, (x.notes || []).join(" · "), x.priceHow, ai ? "" : `규칙 ${x.score}/${x.max}점`].filter(Boolean).join("\n"))}">
      <div class="r1"><span class="vd">${VD[x.verdict] || "⚪"}</span><span class="ttl">${esc(x.title)}</span><span class="pr">${x.price != null ? "¥" + x.price : "-"}</span></div>
      <div class="r2">월 ${fmt(x.sales)} · 재구매 ${x.repeat != null ? x.repeat + "%" : "-"} · ${x.years != null ? x.years + "년" : "-"}${x.moq ? ` · 최소 ${x.moq}` : ""}</div>
      ${x.reason ? `<div class="r3">${esc(x.reason)}</div>` : ""}${x.risk ? `<div class="r4">⚠ ${esc(x.risk)}</div>` : ""}
      <button type="button" class="open" data-id="${x.offerId}">열기</button>
    </div>`).join("") || `<div class="r2">후보 없음</div>`;
  body.querySelectorAll("button.open").forEach((b) => b.addEventListener("click", () => { location.href = `https://detail.1688.com/offer/${b.dataset.id}.html`; }));
}
async function rankPanel() {
  if (!isResults() || document.getElementById("sg-rank")) return;
  const target = await ipcRenderer.invoke("cn:target");
  if (!target) return;
  // 앱이 "전체 사진" 뜻으로 주소에 붙인 region=0,360,0,360 을 1688이 더 이상 받지 않는다(썸네일 깨짐·0건 — 2026-10-08 확인)
  // → 결과를 기다리지 않고 바로 region 없이 다시 연다(1688 기본 = 물체 자동 선택). 올바른 영역 형식을 알아내면 main.js의 region 지정을 그 형식으로 고칠 것
  const u = new URL(location.href), noRegionKey = "sg-noregion:" + (u.searchParams.get("imageId") || u.searchParams.get("imageAddress") || "");
  if (u.searchParams.get("region") === "0,360,0,360" && !sessionStorage.getItem(noRegionKey)) {
    sessionStorage.setItem(noRegionKey, "1");
    u.searchParams.delete("region");
    ipcRenderer.send("cn:log", "검색 영역(region) 지정을 빼고 다시 엽니다");
    location.replace(u.href);
    return;
  }
  let cards = await waitFor(() => { const c = readCards(); return c.length >= 5 ? c : null; }, 15000);
  const pend = await ipcRenderer.invoke("cn:pending");
  if (!cards && pend) {
    // 첫 화면에서 올린 사진을 1688이 못 받은 경우(썸네일 깨짐·0건) — 사람이 결과 화면의 '上传图片'에 직접 올리면 되므로 같은 칸에 한 번 더 올린다
    ipcRenderer.invoke("cn:pendingDone"); // 재시도는 한 번만
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    const input = inputs.find((i) => /上传图片/.test(i.closest("div")?.parentElement?.textContent || "")) || inputs.find((i) => i.matches(FILE_INPUT)) || inputs[0];
    if (input) {
      ipcRenderer.send("cn:log", `결과 없음 → 결과 화면의 사진 칸에 다시 올립니다 (${String(input.className).slice(0, 40) || "input"})`);
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(pend.b64), (c) => c.charCodeAt(0))], "coupang.jpg", { type: pend.type || "image/jpeg" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1500);
      findAdaptive("confirm")?.click(); // 확인 패널이 뜨는 화면이면 눌러 준다(없으면 바로 검색됨)
      cards = await waitFor(() => { const c = readCards(); return c.length >= 5 ? c : null; }, 20000);
      ipcRenderer.send("cn:log", cards ? `다시 올리기로 후보 ${cards.length}개 찾음` : "다시 올려도 결과가 없습니다");
    } else ipcRenderer.send("cn:log", "결과 화면에서 사진 칸을 못 찾았습니다");
  } else if (pend) ipcRenderer.invoke("cn:pendingDone");
  if (!cards) {
    // 결과가 비었고("空空如也") 올린 사진이 깨져 있으면 1688이 사진을 받지 않은 것 — 보안 인증 상태에서 흔함
    const empty = /空空如也|没有找到|暂无/.test(document.body?.innerText || "");
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
  const style = document.createElement("style");
  style.textContent = `
  #sg-rank{position:fixed;right:14px;top:70px;z-index:2147483647;width:320px;max-height:calc(100vh - 90px);overflow:auto;background:#0b0f14;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.4);font:13px/1.45 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
  #sg-rank .hd{display:flex;justify-content:space-between;align-items:center} #sg-rank .hd b{font-size:15px} #sg-rank .mono{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em}
  #sg-rank button.go:disabled{font-family:ui-monospace,Menlo,Consolas,monospace}
  #sg-rank .hd .x{background:none;border:0;color:#9fb3c8;font-size:16px;cursor:pointer;padding:0 4px}
  #sg-rank button.go{width:100%;border:0;border-radius:10px;padding:11px;background:#3ddc84;color:#06240f;font-weight:800;font-size:14px;cursor:pointer;margin:10px 0 8px}
  #sg-rank button.go:disabled{background:#2b3a4c;color:#9fb3c8;cursor:default}
  #sg-rank .st{font-size:12px;color:#9fb3c8;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
  #sg-rank .card{border:1px solid #2b3a4c;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#05070a;cursor:help}
  #sg-rank .card.v-green{border-color:#3ddc84} #sg-rank .card.v-yellow{border-color:#ffb454} #sg-rank .card.v-red{border-color:#ff6b6b}
  #sg-rank .r1{display:flex;align-items:baseline;gap:6px} #sg-rank .vd{font-size:15px}
  #sg-rank .ttl{flex:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #sg-rank .pr{font-weight:800;font-size:16px;color:#3ddc84}
  #sg-rank .r2{font-size:11.5px;color:#9fb3c8;margin-top:2px} #sg-rank .r3{font-size:12px;color:#cbd5e1;margin-top:4px} #sg-rank .r4{font-size:11.5px;color:#ffb454;margin-top:2px}
  #sg-rank button.open{margin-top:8px;width:100%;border:1px solid #2b3a4c;border-radius:8px;padding:7px;background:#0b0f14;color:#fff;cursor:pointer;font-size:12.5px}
  #sg-rank button.open:hover{border-color:#3ddc84}`;
  document.documentElement.appendChild(style);
  const panel = document.createElement("div");
  panel.id = "sg-rank";
  panel.innerHTML = `<div class="hd"><b class="mono">SEED<span style="color:#3ddc84">HACK</span> <span style="font-weight:400;color:#9fb3c8">추천</span></b><button type="button" class="x" title="닫기">✕</button></div>
    <button type="button" class="go" disabled>▶ 딸깍 추천</button><div class="st">> 후보 스캔 중 ▌</div><div class="body"></div>`;
  (document.body || document.documentElement).appendChild(panel);
  panel.querySelector(".x").addEventListener("click", () => panel.remove());
  panel.querySelector("button.go").addEventListener("click", async () => {
    // 가격 확인이 필요하면 먼저 하고(끝나면 AI 자동), 아니면 바로 AI
    panel.__want = true;
    const r = await ipcRenderer.invoke("cn:probe");
    if (r?.nothing || r?.error) { panel.__want = false; ipcRenderer.invoke("cn:ai"); }
  });
  ipcRenderer.on("cn:rankUpdate", (_e, r) => renderRank(panel, r));
  const r = await ipcRenderer.invoke("cn:rank", { cards });
  if (r?.error) { panel.querySelector(".st").textContent = r.error; return; }
  renderRank(panel, r);
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
    + `<button type="button" class="tr" style="${b};background:#0b0f14;color:#7cb3ff" title="1688 화면 번역 — 누를 때마다: 한글로 → 중국어 아래 한글 → 끄기 (마우스를 올리면 중국어 원문)">🌐</button>`;
  (document.body || document.documentElement).appendChild(el);
  const boxBtn = el.querySelector(".box");
  ipcRenderer.on("chat:count", (_e, n) => { boxBtn.hidden = !n; boxBtn.querySelector(".n").textContent = n || ""; });
  boxBtn.addEventListener("click", () => ipcRenderer.invoke("chat:act", { a: "show" }));
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
const safeStart = () => { captchaNotice(); askPill().catch(() => {}); start().catch(() => {}); rankPanel().catch((e) => ipcRenderer.send("cn:log", `추천 패널 오류: ${e && e.message}`)); autoImageSearch().catch((e) => ipcRenderer.send("cn:log", `자동 이미지 검색 오류: ${e && e.message}`)); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safeStart);
else safeStart();
