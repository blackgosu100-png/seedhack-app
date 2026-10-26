// 🌊 파도타기 — 대표님 소싱 방식: 1688 중국어 제목에서 핵심 키워드를 쪼개 → 타오바오·1688을 판매순으로 다시 훑고
// → 최근 주문이 많은데 처음 보는 상품을 찾아 → 사진으로 국내(쿠팡·11번가 등)에 이미 있는지 구글 렌즈로 확인한다.
// 원칙: 검색 화면은 사람이 키워드를 누를 때만 1페이지 연다(여러 페이지 자동 순회 금지). 화면에 뜬 글자만 읽는다.
import { BrowserWindow, shell } from "electron";
import { askCliJson, cliAvailable } from "./ai-cli.js";

const KW_SYSTEM = `당신은 1688·타오바오 소싱 키워드 전문가입니다. 1688 상품 제목(중국어)에서 같은 종류 상품을 넓게 다시 찾을 "검색 키워드"를 뽑습니다.
- 3~5개. 2~6글자 중국어 상품어 중심(예: U型枕, 护颈枕, 记忆棉颈枕). 브랜드·광고어(爆款, 新款, 跨境, 批发, 代发, 厂家, 包邮)·색상·수량은 빼기.
- 첫 번째는 가장 대표하는 상품어, 나머지는 소재·형태·용도로 좁힌 변형.
- ko는 한국어 뜻(짧게).
반드시 JSON 하나만: {"keywords":[{"zh":"…","ko":"…"}]}`;

// 국내 쇼핑몰(구글 렌즈 결과에서 이름으로 센다). 해외 직구몰(알리·테무)은 국내 판매로 치지 않는다
const KR_SHOPS = [["쿠팡", /쿠팡|coupang/i], ["네이버", /스마트스토어|네이버\s*쇼핑|navershopping|smartstore/i], ["11번가", /11번가|11st/i], ["G마켓", /G마켓|지마켓|gmarket/i], ["옥션", /옥션|auction\.co/i],
  ["SSG", /SSG|이마트몰|신세계몰/], ["오늘의집", /오늘의집|ohou/i], ["롯데ON", /롯데온|롯데ON|lotteon/i], ["GS SHOP", /GS\s*SHOP|gsshop/i], ["CJ온스타일", /CJ온스타일/i], ["무신사", /무신사|musinsa/i], ["지그재그", /지그재그|zigzag/i], ["다이소", /다이소몰|daisomall/i], ["텐바이텐", /텐바이텐|10x10/i]];

export function initWave({ ipcMain, store, log, getCnView, fromCn, getTarget }) {
  let ctx = null; // { titleZh, img, name, cost, keywords, at }
  const seen = new Map(Object.entries(store.get("waveSeen") || {})); // 상품 번호 → 처음 본 시각
  let saveT = null;
  const saveSeen = () => { clearTimeout(saveT); saveT = setTimeout(() => { const e = [...seen.entries()].slice(-20000); store.set("waveSeen", Object.fromEntries(e)); }, 1500); };

  // 출발 상품(1688 상품 화면)에서 시작: 핵심 키워드 뽑기
  ipcMain.handle("wave:start", async (e, p = {}) => {
    if (!fromCn(e)) return { error: "1688 화면에서만 됩니다" };
    const titleZh = String(p.titleZh || "").replace(/\s*[-—_|].*阿里巴巴.*$/, "").trim().slice(0, 120);
    if (!titleZh) return { error: "상품 제목을 못 읽었습니다" };
    const t = getTarget() || {};
    ctx = { titleZh, img: String(p.img || "").slice(0, 400), name: t.name || "", cost: Number(p.cost) || null, keywords: [], at: Date.now(), from: String(p.url || "").slice(0, 300) };
    log("sys", `▶ 🌊 파도타기 · ${titleZh.slice(0, 40)} — 핵심 키워드 뽑는 중`);
    const t0 = Date.now();
    let kws = [];
    if (cliAvailable()) {
      const r = await askCliJson({ system: KW_SYSTEM, text: `1688 제목: ${titleZh}${t.name ? `\n쿠팡 상품명(참고): ${t.name}` : ""}` });
      if (r.ok) kws = (r.result?.keywords || []).map((k) => ({ zh: String(k.zh || "").trim().slice(0, 16), ko: String(k.ko || "").trim().slice(0, 20) })).filter((k) => /[一-鿿]/.test(k.zh)).slice(0, 5);
      else log("dim", `  🌊 AI 키워드 실패: ${r.error}`);
    }
    if (!kws.length) kws = [{ zh: titleZh.replace(/[^一-鿿A-Za-z]/g, "").slice(0, 6), ko: "제목 앞부분" }]; // AI 없을 때: 직접 입력으로 고치게
    ctx.keywords = kws;
    log("go", `■ 🌊 핵심 키워드 ${kws.length}개 (${((Date.now() - t0) / 1000).toFixed(1)}초) · ${kws.map((k) => `${k.zh}(${k.ko})`).join(" · ")}`);
    return { ok: true, ctx };
  });
  ipcMain.handle("wave:ctx", (e) => (fromCn(e) ? ctx : null));
  ipcMain.handle("wave:addKeyword", (e, zh) => {
    if (!fromCn(e) || !ctx) return null;
    const k = String(zh || "").trim().slice(0, 16);
    if (k && !ctx.keywords.some((x) => x.zh === k)) ctx.keywords.push({ zh: k, ko: "직접 입력" });
    return ctx;
  });

  // 키워드 → 판매순 검색 화면 1페이지를 1688 탭에 연다
  ipcMain.handle("wave:open", (e, p = {}) => {
    if (!fromCn(e)) return { error: "1688 화면에서만 됩니다" };
    const kw = String(p.kw || "").trim().slice(0, 30);
    if (!kw) return { error: "키워드가 없습니다" };
    const url = p.site === "1688"
      ? `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}&charset=utf8&sortType=va_rmdarkgmv`
      : `https://s.taobao.com/search?q=${encodeURIComponent(kw)}&sort=sale-desc`;
    if (ctx) ctx.lastKw = kw, ctx.lastSite = p.site === "1688" ? "1688" : "taobao";
    log("sys", `▶ 🌊 ${p.site === "1688" ? "1688" : "타오바오"} 판매순 · ${kw}`);
    getCnView()?.webContents.loadURL(url);
    return { ok: true };
  });

  // 처음 보는 상품인지: 받은 번호 중 전에 본 적 없는 것을 돌려주고, 모두 "봤음"으로 남긴다
  // "새로 등장": 같은 키워드·같은 사이트를 전에 훑었을 때 없던 상품. 처음 훑는 키워드면 지금 목록을 기준으로 남기기만 한다
  const kwSeen = store.get("waveKwSeen") || {}; // "site:키워드" → { ids: [...], at }
  let kwT = null;
  ipcMain.handle("wave:seen", (e, p = {}) => {
    if (!fromCn(e)) return { first: true, fresh: [] };
    const key = `${p.site || ""}:${String(p.kw || "").slice(0, 30)}`;
    const ids = (Array.isArray(p.ids) ? p.ids : []).map(String).filter((x) => /^\d{6,15}$/.test(x)).slice(0, 200);
    const rec = kwSeen[key], first = !rec;
    const had = new Set(rec?.ids || []);
    const fresh = first ? [] : ids.filter((id) => !had.has(id));
    kwSeen[key] = { ids: [...new Set([...(rec?.ids || []), ...ids])].slice(-600), at: rec?.at || Date.now(), last: Date.now() };
    ids.forEach((id) => seen.has(id) || seen.set(id, Date.now())); saveSeen();
    clearTimeout(kwT); kwT = setTimeout(() => store.set("waveKwSeen", Object.fromEntries(Object.entries(kwSeen).sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).slice(0, 300))), 1500);
    return { first, fresh, since: rec?.at || null };
  });

  // 🔍 사진으로 국내 확인: 구글 렌즈(사진 주소로 열기) 결과 글자에서 국내 쇼핑몰 이름을 센다. 한 번에 하나씩, 4초 간격
  let lensQ = Promise.resolve(), lensWin = null;
  const lensOnce = (img) => new Promise((resolve) => {
    if (!lensWin || lensWin.isDestroyed()) lensWin = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: "persist:lens", contextIsolation: true, sandbox: true } });
    const wc = lensWin.webContents;
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(to); resolve(v); } };
    const to = setTimeout(() => finish({ error: "구글 렌즈 시간 초과" }), 25000);
    wc.loadURL(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(img)}&hl=ko`).catch(() => {});
    const read = async (tries) => {
      try {
        const txt = await wc.executeJavaScript(`(document.body && document.body.innerText || "").slice(0, 40000)`, true);
        // 결과 하나 = 링크 하나(/goto?url=…). 결과마다 출처 글자를 한 번만 센다(예전엔 "쿠팡" 글자 횟수라 57처럼 부풀었음). 블로그·카페 글은 판매처가 아님
        const items = await wc.executeJavaScript(`(() => { const s = new Set(), o = []; for (const a of document.querySelectorAll('a[href^="/goto?url="]')) { const h = a.getAttribute("href"); if (s.has(h)) continue; s.add(h); o.push({ t: (a.innerText || "").replace(/\\s+/g, " ").slice(0, 300), u: a.href }); } return o; })()`, true).catch(() => []);
        if (/비정상적인 트래픽|unusual traffic|로봇이 아닙니다|not a robot/i.test(txt)) return finish({ error: "구글 보안 확인(로봇 확인)이 떴습니다 — 잠시 뒤 다시" });
        if (!/시각적으로 일치|정확히 일치|Visual matches|Exact matches/.test(txt) && tries > 0) return setTimeout(() => read(tries - 1), 1500);
        const cnt = new Map();
        const first = new Map(); // 쇼핑몰 → 대표 결과 1개 주소(구글 이동 링크) — 칩을 누르면 연다
        for (const { t, u } of items) { if (/블로그|blog|카페|cafe|인스타|instagram|유튜브|youtube/i.test(t) && !/스마트스토어|smartstore/i.test(t)) continue; const hit = KR_SHOPS.find(([, re]) => re.test(t)); if (hit) { cnt.set(hit[0], (cnt.get(hit[0]) || 0) + 1); if (!first.has(hit[0]) && /^https:\/\/www\.google\.[a-z.]+\/goto\?url=/.test(u)) first.set(hit[0], u); } }
        const shops = [...cnt.entries()].map(([name, n]) => ({ name, n, url: first.get(name) || "" })).sort((a, b) => b.n - a.n);
        finish({ ok: true, shops, total: shops.reduce((a, s) => a + s.n, 0), results: items.length });
      } catch (err) { finish({ error: String(err?.message || err).slice(0, 120) }); }
    };
    wc.once("did-finish-load", () => setTimeout(() => read(8), 2500));
  });
  // 국내 쇼핑몰 칩 → 대표 결과 1개를 평소 쓰는 브라우저에서 연다(구글 이동 링크만 허용)
  ipcMain.handle("wave:ext", (e, url) => { if (fromCn(e) && /^https:\/\/www\.google\.[a-z.]+\/goto\?url=/.test(String(url))) shell.openExternal(String(url)); });
  ipcMain.handle("wave:lens", (e, p = {}) => {
    if (!fromCn(e)) return { error: "1688 화면에서만 됩니다" };
    const img = String(p.img || "").replace(/^\/\//, "https://").replace(/(\.(jpg|jpeg|png))_.*$/i, "$1");
    if (!/^https:\/\//.test(img)) return { error: "사진 주소가 없습니다" };
    const job = lensQ.then(() => lensOnce(img));
    lensQ = job.then(() => new Promise((r) => setTimeout(r, 4000)), () => {});
    return job.then((r) => { if (r.ok) log("dim", `  🌊 국내 확인 · ${p.id || ""} → ${r.shops.map((s) => `${s.name} ${s.n}`).join(" · ") || "국내 일치 없음"}`); return r; });
  });
}
