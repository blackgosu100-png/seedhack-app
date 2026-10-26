// 💬 1688 화면 안에서 실행되는 "읽기 전용" 함수 — chat.js가 이 파일을 글자로 읽어 각 프레임에 넣는다(import 하지 않음).
// 매번 파일에서 다시 읽으므로, 개발 실행 중에는 1688 화면 구조에 맞춰 고치면 앱을 다시 켜지 않아도 바로 반영된다.
// 화면을 바꾸지 않는다(클릭·스크롤·입력 없음). 클릭·입력은 메인이 사람처럼 마우스·키보드로 한다.
function chatDom(kind, arg) {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const mine = (e) => !!e.closest("#sg-chat, #sg-cn-box, #sg-ask, #sg-rank");
  // 그림자 DOM(shadowRoot) 안까지 모두 훑기
  const all = (sel) => {
    const out = [], stack = [document];
    while (stack.length) {
      const root = stack.pop();
      root.querySelectorAll("*").forEach((e) => { if (e.matches(sel)) out.push(e); if (e.shadowRoot) stack.push(e.shadowRoot); });
    }
    return out;
  };

  if (kind === "scan") {
    const inputs = all('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]').filter((e) => vis(e) && !mine(e));
    const input = inputs.sort((a, b) => area(b) - area(a))[0] || null;
    const ir = input && input.getBoundingClientRect();
    const sendBtn = all('button, [role="button"], a, span, div').filter((e) => vis(e) && !mine(e) && e.children.length <= 2 && /^(发送|發送|send|보내기|전송|발송)\s*(\(s\))?$/i.test((e.innerText || "").trim())).pop() || null;
    // 입력칸 위 상품 카드의 "发送链接(링크 보내기)" — 어떤 상품을 묻는지 판매자에게 먼저 보여 준다
    const linkBtn = all('button, [role="button"], a, span, div').filter((e) => vis(e) && !mine(e) && e.children.length <= 2 && /^(发送链接|發送鏈接|发送商品|发送宝贝|링크\s*보내기|링크\s*전송|링크\s*발송|상품\s*보내기)$/.test((e.innerText || "").trim())).pop() || null;
    const blocks = all("div, ul, section, main").filter((e) => vis(e) && !mine(e));
    const above = (e) => { if (!ir) return true; const r = e.getBoundingClientRect(); return r.bottom <= ir.top + 12 && r.right > ir.left + 10 && r.left < ir.right - 10; };
    const txt = (e) => (e.innerText || "").length;
    const msgs = blocks.filter((e) => above(e) && e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).sort((a, b) => txt(b) - txt(a))[0]
      // 대화가 짧아 스크롤이 없으면: 입력칸 위에 있는 칸 중 글이 가장 많은 것(같으면 작은 것)
      || (ir ? blocks.filter((e) => above(e) && e.getBoundingClientRect().width >= ir.width * 0.5).sort((a, b) => (txt(b) - txt(a)) || (area(a) - area(b)))[0] : null) || null;
    const lines = msgs ? (msgs.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(-120) : [];
    const iframes = [...document.querySelectorAll("iframe")].filter(vis).map((f) => ({ src: f.src || "", rect: R(f) }));
    const t = (document.title || "") + " " + (document.body ? document.body.innerText.slice(0, 1500) : "");
    return { url: location.href, title: document.title, vw: innerWidth, vh: innerHeight, input: input ? R(input) : null, inputTag: input ? input.tagName + "." + String(input.className).slice(0, 40) : "",
      inputText: input ? (input.value ?? input.innerText ?? "") : "", send: sendBtn ? R(sendBtn) : null, link: linkBtn ? R(linkBtn) : null, msgs: msgs ? R(msgs) : null, lines, iframes,
      captcha: /安全验证|滑动验证|请拖动滑块|验证码/.test(t), login: /login\.|passport|\/login/.test(location.href) };
  }

  if (kind === "contact") { // 상품 페이지: 판매자 연락 버튼과 회사 이름
    const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== "hidden"; };
    const TXT = /^(旺旺|旺旺在线|旺旺咨询|联系供应商|联系卖家|联系商家|联系客服|在线咨询|立即咨询|咨询|客服|和我联系|联系我们|找商家|问商家|문의|문의하기|판매자\s*문의|고객\s*서비스|고객\s*센터|상담|온라인\s*상담|연락하기|판매자\s*연락|공급업체\s*연락)$/; // 1688 한국어판: "문의" / "고객 서비스"
    const el = [...document.querySelectorAll("a, button, [role=button], span, div")].filter((e) => !mine(e) && e.children.length <= 3 && TXT.test((e.innerText || "").trim())).find(shown)
      || [...document.querySelectorAll('[class*="wangwang" i], [class*="ww-light" i], [class*="contact" i] a, [data-spm*="wangwang" i], a[href*="amos"], a[href*="def_cbu_web_im"]')].find(shown) || null;
    const company = ([...document.querySelectorAll('[class*="company-name" i], [class*="companyName"], [class*="shop-name" i], [class*="shopName"], [class*="seller-name" i]')].map((e) => (e.innerText || "").trim()).find((t) => t && t.length < 60)) || "";
    return { vh: innerHeight, btn: el ? R(el) : null, text: el ? (el.innerText || el.className || "").trim().slice(0, 30) : "", company };
  }

  if (kind === "diag") { // 화면 구조(보이는 요소의 태그·클래스·글자·위치) — 1688 화면이 바뀌었을 때 고치는 근거
    const out = [];
    const walk = (root, depth) => {
      for (const e of root.querySelectorAll("*")) {
        if (out.length >= 700) return;
        if (e.shadowRoot && depth < 4) { out.push(["#shadow-root of " + e.tagName.toLowerCase(), "", "", ""]); walk(e.shadowRoot, depth + 1); }
        const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 40);
        const ia = e.matches("a, button, input, textarea, [contenteditable], [role], iframe, canvas");
        if (!own && !ia) continue;
        const cls = typeof e.className === "string" ? e.className : (e.className && e.className.baseVal) || "";
        out.push([e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + "." + cls.trim().split(/\s+/).slice(0, 3).join("."), own, [r.left, r.top, r.width, r.height].map(Math.round).join(","),
          e.getAttribute("contenteditable") || e.getAttribute("role") || (e.tagName === "IFRAME" ? e.src.slice(0, 160) : "")]);
      }
    };
    walk(document, 0);
    return { url: location.href, title: document.title, vw: innerWidth, vh: innerHeight, els: out };
  }
  // 🌐 동시 번역: 대화 칸의 중국어 말풍선(글이 든 가장 안쪽 블록)을 찾아 번호를 붙여 돌려준다
  // 한글은 화면 장식(CSS ::after)으로만 붙인다 — 페이지 글자(innerText)는 그대로라 답 읽기에 섞이지 않는다
  if (kind === "trscan") {
    const zh = /[\u4e00-\u9fff]/;
    const input = all('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]').filter((e) => vis(e) && !mine(e)).sort((a, b) => area(b) - area(a))[0];
    if (!input) return []; // 입력칸이 없는 프레임(바깥 틀·대화 목록)은 번역하지 않음
    const ir = input.getBoundingClientRect();
    const BLOCK = "div, p, li, pre, section, article, ul, ol, table, tr, td";
    window.__sgTrN = window.__sgTrN || 0;
    const out = [];
    for (const e of all("div, p, pre, li, td")) {
      if (out.length >= 150) break;
      if (!vis(e) || mine(e) || (input && (e === input || e.contains(input) || input.contains(e)))) continue;
      const r = e.getBoundingClientRect();
      if (r.top >= ir.top - 10 && r.left >= ir.left - 40) continue; // 입력칸 영역(입력칸·전송 버튼 줄)만 빼고 대화·대화 목록·판매자 정보 모두
      const t = (e.innerText || "").trim();
      if (!t || t.length > 400 || !zh.test(t) || /^[\d\s:\-\/.年月日]+$/.test(t)) continue;
      if (/^inline/.test(getComputedStyle(e).display)) continue;
      if ([...e.querySelectorAll(BLOCK)].some((d) => zh.test(d.innerText || ""))) continue; // 더 안쪽 블록이 있으면 그쪽을 쓴다
      if (r.right <= ir.left + 5) e.setAttribute("data-sg-list", ""); // 입력칸 왼쪽 = 대화 상대 목록(칸 높이가 고정이라 아래 한글을 붙이면 겹침) — 이미 번역한 칸에도 붙임
      if (e.getAttribute("data-sg-src") === t) continue; // 이미 번역함
      if (!e.dataset.sgTr) e.dataset.sgTr = String(++window.__sgTrN);
      out.push({ id: e.dataset.sgTr, text: t });
    }
    return out;
  }
  // 🌐 1688 사이트(검색 결과·상품 페이지) 번역: 화면에 보이는, 글이 직접 든 가장 안쪽 요소만
  if (kind === "trsite") {
    const zh = /[\u4e00-\u9fff]/;
    window.__sgTrN = window.__sgTrN || 0;
    const out = [];
    for (const e of document.body ? document.body.querySelectorAll("*") : []) {
      if (out.length >= 150) break;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|PATH|CANVAS|IFRAME|IMG)$/i.test(e.tagName) || e.isContentEditable || mine(e)) continue;
      if (e.children.length && [...e.children].some((c) => (c.innerText || "").trim())) continue; // 글 든 자식이 있으면 자식 쪽에서
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < -200 || r.top > innerHeight + 400) continue; // 화면 근처만
      const t = (e.innerText || "").trim();
      if (!t || t.length > 200 || !zh.test(t) || e.getAttribute("data-sg-src") === t) continue;
      if (!e.dataset.sgTr) e.dataset.sgTr = String(++window.__sgTrN);
      e.setAttribute("data-sg-site", "");
      out.push({ id: e.dataset.sgTr, text: t });
    }
    return out;
  }
  if (kind === "trapply") {
    if (document.getElementById("sg-tr-style")?.dataset.v !== "2") { // v2: 대화 상대 목록 규칙 추가 — 예전 규칙이 붙은 화면도 새로 바꿔 끼움
      document.getElementById("sg-tr-style")?.remove();
      const st = document.createElement("style"); st.id = "sg-tr-style"; st.dataset.v = "2";
      // 보기 방식은 <html data-sg-tr-mode="below|replace|off"> (문의 도우미 상자의 🌐 버튼이 바꾼다)
      // replace: 중국어 글자를 0 크기로 숨기고 한글만 보인다(마우스를 올리면 원문 말풍선 도움말). 페이지 글자(innerText)는 그대로라 답 읽기엔 영향 없음
      st.textContent = [
        '[data-sg-ko]::after{content:attr(data-sg-ko);display:block;margin-top:5px;padding-top:4px;border-top:1px dashed rgba(47,111,222,.35);color:#2f6fde;font-size:12.5px;line-height:1.45;white-space:pre-wrap;font-weight:500;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}',
        'html[data-sg-tr-mode="off"] [data-sg-ko]::after{display:none}',
        'html[data-sg-tr-mode="replace"] [data-sg-ko], html[data-sg-tr-mode="replace"] [data-sg-ko] *{font-size:0 !important;line-height:0 !important}',
        'html[data-sg-tr-mode="replace"] [data-sg-ko]::after{font-size:var(--sg-fs,13px) !important;line-height:var(--sg-lh,1.5) !important;margin:0;padding:0;border:0;color:inherit;font-weight:inherit}',
        // 사이트: 줄을 늘리지 않게 — 한글로는 제자리(inline), 아래 한글은 작게
        '[data-sg-site][data-sg-ko]::after{margin-top:1px;padding-top:0;border-top:0;font-size:11px;line-height:1.35;font-weight:400;white-space:normal}',
        'html[data-sg-tr-mode="replace"] [data-sg-site][data-sg-ko]::after{display:inline;white-space:normal}',
        // 대화 상대 목록: "아래 한글"이어도 한 줄 그대로 한글로 바꿔 보여 준다(겹침 방지, 2026-10-13) · 넘치면 … · 마우스를 올리면 중국어
        'html:not([data-sg-tr-mode="off"]) [data-sg-list][data-sg-ko], html:not([data-sg-tr-mode="off"]) [data-sg-list][data-sg-ko] *{font-size:0 !important;line-height:0 !important}',
        'html:not([data-sg-tr-mode="off"]) [data-sg-list][data-sg-ko]::after{display:block;margin:0;padding:0;border:0;color:inherit;font-weight:inherit;font-size:var(--sg-fs,13px) !important;line-height:var(--sg-lh,1.5) !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      ].join("\n");
      (document.head || document.documentElement).appendChild(st);
    }
    const on = arg && arg.on !== false;
    if (arg && arg.mode) document.documentElement.setAttribute("data-sg-tr-mode", arg.mode); // 사이트: 메인이 정한 방식
    document.getElementById("sg-tr-style").disabled = !on;
    // 보기 방식: 도우미 상자는 바깥 페이지에만 있다 → 대화가 안쪽 프레임에 있어도 같은 방식이 되게
    //  ① 도우미가 보내는 postMessage ② 같은 출처면 localStorage ③ 바깥 페이지 html 속성
    const setMode = (m) => { if (!/^(below|replace|off)$/.test(m || "")) return; document.documentElement.setAttribute("data-sg-tr-mode", m); try { localStorage.setItem("sgTrMode", m); } catch (e) {} };
    if (!window.__sgTrListen) {
      window.__sgTrListen = true;
      addEventListener("message", (ev) => { const m = ev.data && ev.data.sgTrMode; if (!m) return; setMode(m); for (const f of document.querySelectorAll("iframe")) { try { f.contentWindow.postMessage({ sgTrMode: m }, "*"); } catch (e) {} } });
    }
    if (!(arg && arg.mode) && !document.documentElement.getAttribute("data-sg-tr-mode")) {
      let m = null;
      try { m = window.top.document.documentElement.getAttribute("data-sg-tr-mode"); } catch (e) {}
      if (!m) try { m = localStorage.getItem("sgTrMode"); } catch (e) {}
      setMode(m || "below");
    }
    let n = 0;
    for (const it of (arg && arg.items) || []) {
      const e = all('[data-sg-tr="' + it.id + '"]')[0];
      if (e && it.ko) {
        if (!e.style.getPropertyValue("--sg-fs")) { const cs = getComputedStyle(e); if (parseFloat(cs.fontSize) > 0) { e.style.setProperty("--sg-fs", cs.fontSize); e.style.setProperty("--sg-lh", cs.lineHeight === "normal" ? "1.4" : cs.lineHeight); } } // 한글로 바꿀 때 원래 글자 크기 유지
        e.setAttribute("data-sg-ko", it.ko); e.setAttribute("data-sg-src", it.text); if (!e.title) e.title = it.text; n++;
      }
    }
    return n;
  }
  return null;
}
