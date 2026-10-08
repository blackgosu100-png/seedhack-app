// 💬 1688 판매자 문의 도우미
// 상품 페이지의 판매자 연락(旺旺) 버튼을 사람처럼 마우스로 눌러 채팅창을 열고, 질문을 3단계로 나눠 보낸다.
// 판매자 답은 채팅 화면 글자만 읽어 확인하고(추가 요청 없음), 답이 오면 다음 단계를 이어 묻는다.
// 판매자가 수량·가격·결제 등을 되물으면 멈추고 사람에게 넘긴다. 하루 한도·전송 간격을 지킨다.
import { WebContentsView, app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as human from "./human.js";
import { initTranslate } from "./translate.js";
import { pathToFileURL } from "node:url";
import * as core0 from "./inquiry-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
// 문의 규칙(inquiry-core.js): 개발 실행 중에는 파일이 바뀌면 다시 읽는다 — 규칙을 고쳐도 앱을 다시 켜지 않아도 됨
let C = core0, coreVer = 0;
const CORE_FILE = path.join(__dirname, "inquiry-core.js");
async function refreshCore(log) {
  if (app.isPackaged) return;
  try { const v = fs.statSync(CORE_FILE).mtimeMs; if (v !== coreVer) { if (coreVer) { C = await import(pathToFileURL(CORE_FILE).href + "?v=" + v); log?.("dim", "  💬 문의 규칙을 다시 읽었습니다"); } coreVer = v; } } catch (e) { log?.("dim", `  💬 문의 규칙 읽기 실패: ${e?.message || e}`); }
}
const FAST = process.env.SIGNAL_CHAT_FAST === "1" && !app.isPackaged; // 개발 시험용: 긴 대기·간격 생략

const IM_HOME = "https://air.1688.com/app/ocms-fusion-components-1688/def_cbu_web_im/index.html";
export const isImUrl = (u) => /def_cbu_web_im|[/.]im\.1688\.com|amos\.(?:alicdn|1688)\.com|webww|wangwang|\/ww\/|im\.alibaba/i.test(String(u || ""));

// ---- 화면 읽기: chat-dom.js를 매번 파일에서 읽어 프레임에 넣는다(개발 중 고치면 재시작 없이 반영) ----
const DOM_FILE = path.join(__dirname, "chat-dom.js");
const domJs = (kind, arg) => `(${fs.readFileSync(DOM_FILE, "utf8").trim()}\n)(${JSON.stringify(kind)}, ${JSON.stringify(arg ?? null)})`;
// 프레임이 응답하지 않아도(로딩 중·멈춘 광고 프레임 등) 기다리다 멈추지 않게 3초 제한
const run = (frame, kind, ms = 3000, arg) => Promise.race([frame.executeJavaScript(domJs(kind, arg)), sleep(ms).then(() => { throw new Error("응답 없음"); })]);

// 채팅 주소의 touid=cnalichn<판매자 아이디> → 실제 대화 상대 이름(상품 페이지의 회사 이름 칸은 다른 가게가 잡힐 수 있음)
const sellerOf = (u) => { try { return decodeURIComponent(new URL(u).searchParams.get("touid") || "").replace(/^cnalichn/, "").slice(0, 40); } catch { return ""; } };
const sameDoc = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname === y.pathname; } catch { return false; } };

export function initChat({ getWin, getCnView, layout, log, store, setShown, sendPanel = () => {}, isShown = () => false, isCnShown = () => false }) {
  const tr = initTranslate({ store, log });
  const trOn = () => (store.get("settings") || {}).chatTr !== false;
  // 🌐 동시 번역: 채팅 화면을 보고 있는 동안 2.5초마다 새 중국어 말풍선을 번역해 아래에 한글을 붙인다
  setTimeout(async function trLoop() {
    try {
      if (view && isShown() && !view.webContents.isDestroyed()) {
        for (const f of view.webContents.mainFrame.framesInSubtree) {
          let items = [];
          try { items = (trOn() && (await run(f, "trscan"))) || []; } catch { continue; }
          const kos = items.length ? await tr.translate(items.map((x) => x.text)) : [];
          await run(f, "trapply", 3000, { on: trOn(), items: items.map((x, i) => ({ ...x, ko: kos[i] })).filter((x) => x.ko) }).catch(() => {});
        }
      }
    } catch {}
    setTimeout(trLoop, 2500);
  }, 3000);
  // 🌐 1688 사이트(⑤ 탭) 번역: 보고 있는 동안 2.5초마다 화면 근처의 새 중국어를 번역 (방식: 한글로 / 아래 한글 / 끔)
  const siteMode = () => (store.get("settings") || {}).siteTr || "replace";
  setTimeout(async function siteLoop() {
    try {
      const cn = getCnView();
      if (cn && isCnShown() && !cn.webContents.isDestroyed() && /1688\.com/i.test(cn.webContents.getURL())) {
        const f = cn.webContents.mainFrame, mode = siteMode();
        const items = mode === "off" ? [] : ((await run(f, "trsite", 4000).catch(() => [])) || []);
        const kos = items.length ? await tr.translate(items.map((x) => x.text)) : [];
        await run(f, "trapply", 3000, { on: true, mode, items: items.map((x, i) => ({ ...x, ko: kos[i] })).filter((x) => x.ko) }).catch(() => {});
      }
    } catch {}
    setTimeout(siteLoop, 2500);
  }, 4000);
  let view = null, busy = false, tickTimer = null, openWaiter = null;
  const list = () => store.get("inquiries") || [];
  const save = (arr) => { store.set("inquiries", arr.slice(0, 200)); push(); };
  const upd = (id, patch) => { const arr = list(); const q = arr.find((x) => x.id === id); if (q) Object.assign(q, patch, { updatedAt: Date.now() }); save(arr); return q; };
  const sendLog = () => (store.get("chatLog") || []).filter((x) => Date.now() - x.ts < 864e5);
  const addLog = (kind) => store.set("chatLog", [...sendLog(), { ts: Date.now(), kind }]);
  const auto = () => (store.get("settings") || {}).chatAuto !== false;
  // 앱이 꺼지거나 멈춰 중간 상태로 남은 문의 → 다시 시도할 수 있게
  { const arr = list(); let n = 0; arr.forEach((q) => { if (["opening", "sending"].includes(q.status)) { q.status = q.stage ? "waiting" : "error"; q.reason = "중간에 멈춤 — 다시 시도하세요"; n++; } }); if (n) store.set("inquiries", arr); }

  const STATUS_KO = { opening: "채팅 여는 중", waiting: "답 기다림", sending: "보내는 중", handoff: "👤 직접 확인", done: "✅ 완료", error: "✕ 오류", paused: "⏸ 멈춤" };
  function state() {
    return {
      auto: auto(), busy, tr: trOn(), trEngine: tr.engine(),
      today: { sends: sendLog().filter((x) => x.kind === "send").length, sellers: sendLog().filter((x) => x.kind === "new").length },
      items: list().map((q) => ({ id: q.id, offerId: q.offerId, title: q.title, company: q.company, stage: q.stage, total: C.STAGES.length, status: q.status, statusKo: STATUS_KO[q.status] || q.status,
        reason: q.reason || "", info: q.info || {}, lastReply: (q.replies || []).slice(-1)[0]?.text || "", replies: (q.replies || []).map((r) => r.text).slice(-12), nextKo: C.STAGE_KO[q.stage] || "",
        asked: (q.sent || []).map((x) => ({ zh: x.text, ko: (C.STAGES_KO || [])[C.STAGES.indexOf(x.text)] || "" })), nextZh: C.STAGES[q.stage] || "", nextKoFull: (C.STAGES_KO || [])[q.stage] || "" })),
    };
  }
  const push = () => { if (view && !view.webContents.isDestroyed()) view.webContents.send("chat:state", state()); const n = list().filter((q) => !["done", "error"].includes(q.status)).length; getCnView()?.webContents.send("chat:count", n); sendPanel("chat:count", { n, handoff: list().filter((q) => q.status === "handoff").length }); };

  function ensureView() {
    if (view) return view;
    view = new WebContentsView({ webPreferences: { partition: "persist:1688", contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "../preload/chat.cjs") } });
    getWin().contentView.addChildView(view);
    const [w, h] = getWin().getContentSize();
    view.setBounds({ x: 0, y: 56, width: Math.max(600, w - 480), height: Math.max(400, h - 56) }); // 숨기기 전에 크기부터(숨긴 채 처음 크기를 받으면 0×0)
    view.webContents.setWindowOpenHandler(({ url }) => { log("dim", `  💬 채팅 화면 새 창 → 같은 화면 (${String(url).slice(0, 120)})`); if (/^https?:/i.test(url)) view.webContents.loadURL(url); return { action: "deny" }; });
    view.webContents.on("did-finish-load", push);
    layout();
    return view;
  }

  // 모든 프레임을 읽어 입력칸이 있는 프레임 기준으로 좌표를 맞춘다
  async function scan(wc) {
    const frames = wc.mainFrame.framesInSubtree;
    const res = [];
    for (const f of frames) { try { const r = await run(f, "scan"); if (r) res.push({ f, r }); } catch {} }
    const off = (f) => {
      let ox = 0, oy = 0, cur = f;
      while (cur.parent) {
        const p = res.find((x) => x.f === cur.parent);
        const ifr = p?.r.iframes.find((i) => i.src && sameDoc(i.src, cur.url));
        if (!ifr) return null;
        ox += ifr.rect.x; oy += ifr.rect.y; cur = cur.parent;
      }
      return { ox, oy };
    };
    const sh = (r, o) => (r ? { ...r, x: r.x + o.ox, y: r.y + o.oy } : null);
    const best = res.filter((x) => x.r.input).map((x) => ({ ...x, o: off(x.f) })).filter((x) => x.o).sort((a, b) => b.r.input.w * b.r.input.h - a.r.input.w * a.r.input.h)[0];
    const flags = { captcha: res.some((x) => x.r.captcha), login: res.some((x) => x.r.login), frames: res.map((x) => `${x.r.url.replace(/\?.*/, "").slice(-60)} ${x.r.vw}×${x.r.vh}${x.r.input ? " 입력칸" : ""}${x.r.send ? " 发送" : ""} 줄${x.r.lines.length}`), total: frames.length };
    if (!best) return { ...flags, input: null, lines: res.flatMap((x) => x.r.lines) };
    return { ...flags, input: sh(best.r.input, best.o), send: sh(best.r.send, best.o), msgs: sh(best.r.msgs, best.o), lines: best.r.lines, inputText: best.r.inputText, inputTag: best.r.inputTag, link: sh(best.r.link, best.o) };
  }
  async function waitScan(wc, ms) {
    let s = null;
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(1500)) {
      s = await scan(wc).catch((e) => ({ err: e?.message || String(e) }));
      if (s?.input || s?.captcha || s?.login) return s;
    }
    log("dim", `  💬 채팅 화면 읽기: 프레임 ${s?.total ?? "?"}개 중 읽힘 ${s?.frames?.length ?? 0} · ${(s?.frames || []).join(" | ").slice(0, 400)}${s?.err ? " · 오류 " + s.err : ""}`);
    return null;
  }

  async function diag(wc, kind) {
    try {
      const frames = [];
      for (const f of wc.mainFrame.framesInSubtree) { try { frames.push(await run(f, "diag", 5000)); } catch (e) { frames.push({ url: f.url, error: String(e?.message || e) }); } }
      const file = path.join(app.getPath("userData"), `chat-diag-${kind}.json`);
      fs.writeFileSync(file, JSON.stringify({ ts: new Date().toISOString(), kind, frames }, null, 1));
      log("dim", `  💬 진단 저장: ${file}`);
    } catch (e) { log("dim", `  💬 진단 저장 실패: ${e?.message || e}`); }
  }

  const fail = (q, why, status = "error") => { upd(q.id, { status, reason: why }); log("stop", `✕ 💬 ${q.title.slice(0, 20)} · ${why}`); };

  // 한 단계 보내기: 입력칸 클릭 → 한 글자씩 → 확인 → 发送 클릭(없으면 Enter) → 화면에 올라왔는지 확인
  async function sendStage(q, s) {
    const a = C.nextAction(q);
    if (a.action !== "send") return false;
    const c = C.canSend(FAST ? [] : store.get("chatLog"), Date.now(), { isNew: q.stage === 0 });
    if (!c.ok) {
      if (c.waitMs && c.waitMs < 150_000) await sleep(c.waitMs + rnd(3000, 15000));
      else { upd(q.id, { status: "waiting", reason: `보류: ${c.why}` }); log("sys", `⏸ 💬 ${c.why} — 내일 이어서`); return false; }
    }
    const wc = view.webContents;
    upd(q.id, { status: "sending", reason: `${q.stage + 1}단계 · ${C.STAGE_KO[q.stage]}` });
    if (s.inputText && s.inputText.trim()) { fail(q, "입력칸에 이미 글이 있음(직접 쓰는 중?) — 건드리지 않음", "handoff"); return false; }
    // 첫 질문 전: 상품 카드(发送链接)를 먼저 보내 어떤 상품인지 알린다
    if (q.stage === 0 && s.link) {
      await human.click(wc, s.link);
      log("sys", "▶ 💬 상품 링크 카드 보냄(发送链接)");
      await human.pause(1800, 3500);
      s = (await scan(wc)) || s;
      if (!s.input) { fail(q, "링크 카드를 보낸 뒤 입력칸을 못 찾음"); return false; }
    } else if (q.stage === 0) log("dim", "  💬 상품 링크 카드(发送链接)가 화면에 없어 질문만 보냅니다");
    await human.click(wc, s.input);
    await human.pause(400, 1100);
    await human.typeText(wc, a.text);
    await human.pause(700, 1900);
    const s2 = await scan(wc);
    const norm = (t) => String(t || "").replace(/\s+/g, "");
    if (!norm(s2?.inputText).includes(norm(a.text).slice(0, 6))) { await diag(wc, "im"); fail(q, "입력칸에 글이 안 들어감 — 진단 파일 저장함"); return false; }
    if (s2.send) await human.click(wc, s2.send); else await human.pressEnter(wc);
    await human.pause(1800, 3200);
    const s3 = await scan(wc);
    const shown = (s3?.lines || []).some((l) => norm(l).includes(norm(a.text).slice(0, 8)));
    const left = norm(s3?.inputText);
    if (left && left.includes(norm(a.text).slice(0, 6))) { await diag(wc, "im"); fail(q, "전송이 안 됨(입력칸에 글이 남아 있음) — 진단 파일 저장함"); return false; }
    const n = q.stage + 1;
    const sent = [...(q.sent || []), { stage: n, text: a.text, ts: Date.now() }];
    addLog("send"); if (n === 1) addLog("new");
    upd(q.id, { stage: n, sent, status: "waiting", reason: shown ? "" : "보냄(화면 확인 못 함)", lastSentAt: Date.now() });
    if (!shown) diag(wc, "im");
    log("go", `■ 💬 ${q.title.slice(0, 20)} · ${n}단계 보냄: ${a.text}`);
    return true;
  }

  // ① 상품 페이지에서 시작
  async function inquire({ offerId, title, company }) {
    await refreshCore(log);
    const cn = getCnView();
    if (!cn) return { error: "1688 화면이 없습니다" };
    if (busy) return { error: "다른 문의를 처리 중입니다 — 잠시 후 다시" };
    const old = list().find((q) => q.offerId === offerId && q.status !== "error");
    if (old) { show(true); return { ok: true, already: true }; }
    const c = C.canSend(FAST ? [] : store.get("chatLog"), Date.now(), { isNew: true });
    if (!c.ok && !c.waitMs) return { error: c.why };
    const q = { id: `${offerId}-${Date.now()}`, offerId, title: String(title || "").slice(0, 80) || offerId, company: company || "", stage: 0, status: "opening", sent: [], replies: [], info: {}, createdAt: Date.now() };
    save([q, ...list().filter((x) => x.offerId !== offerId)]);
    busy = true; push();
    try {
      const r = await run(cn.webContents.mainFrame, "contact");
      if (r.company && !q.company) upd(q.id, { company: r.company });
      if (!r.btn) { await diag(cn.webContents, "offer"); fail(q, "상품 페이지에서 판매자 연락(旺旺) 버튼을 못 찾음 — 진단 파일 저장함"); return { error: "연락 버튼을 못 찾았습니다" }; }
      await human.pause(500, 1200);
      // 버튼이 화면 밖이면 마우스 휠로 굴려서 보이게(페이지를 코드로 스크롤하지 않음)
      let r2 = r;
      for (let i = 0; i < 12 && (r2.btn.y < 60 || r2.btn.y + r2.btn.h > r2.vh - 40); i++) {
        const want = r2.btn.y + r2.btn.h / 2 - r2.vh / 2;
        await human.wheel(cn.webContents, Math.max(-600, Math.min(600, want)), { x: 400, y: Math.round(r2.vh / 2) });
        await human.pause(300, 700);
        r2 = await run(cn.webContents.mainFrame, "contact");
        if (!r2.btn) break;
      }
      const opened = new Promise((res) => { openWaiter = res; setTimeout(() => res(null), 15000); });
      await human.click(cn.webContents, r2.btn || r.btn);
      log("sys", `▶ 💬 판매자 연락 버튼 클릭 (${r.text || "?"})`);
      const url = await opened; openWaiter = null;
      if (!url) { await diag(cn.webContents, "offer-after-click"); fail(q, "채팅창이 열리지 않음 — 버튼이 PC용 旺旺 프로그램을 열려고 했을 수 있음. 진단 파일 저장함"); return { error: "채팅창이 열리지 않았습니다" }; }
      upd(q.id, { chatUrl: url, ...(sellerOf(url) ? { company: sellerOf(url) } : {}) });
      ensureView().webContents.loadURL(url);
      show(true);
      log("sys", "▶ 💬 채팅창 여는 중 · 입력칸 찾는 중(최대 30초)");
      const s = await waitScan(view.webContents, 30000);
      await diag(view.webContents, "im");
      if (s?.input) log("dim", `  💬 입력칸 찾음 ${s.inputTag || ""} · 发送 버튼 ${s.send ? "있음" : "없음(Enter로 전송)"} · 대화 줄 ${s.lines.length}`);
      if (!s) { fail(q, "채팅 입력칸을 못 찾음 — 진단 파일 저장함"); return { error: "채팅 입력칸을 못 찾았습니다" }; }
      if (s.captcha || s.login) { fail(q, "1688 로그인·보안 인증 필요 — 직접 처리 후 ▶ 다시", "handoff"); return { error: "로그인·인증 필요" }; }
      await (FAST ? human.pause(300, 600) : human.pause(2500, 6000)); // 채팅창 둘러보는 시간
      await sendStage(list().find((x) => x.id === q.id), s);
      return { ok: true };
    } catch (e) { fail(q, `오류: ${e?.message || e}`); return { error: String(e?.message || e) }; }
    finally { busy = false; openWaiter = null; push(); schedule(); }
  }

  // ② 답 확인 → 다음 단계 (한 번에 판매자 한 곳만)
  async function checkOne(q) {
    ensureView();
    const wc = view.webContents;
    upd(q.id, { lastCheck: Date.now() });
    const touid = (u) => { try { return new URL(u).searchParams.get("touid") || u; } catch { return u; } };
    if (touid(wc.getURL()) !== touid(q.chatUrl)) { wc.loadURL(q.chatUrl); await sleep(rnd(3000, 6000)); }
    const s = await waitScan(wc, 25000);
    if (!s?.input) { log("dim", `  💬 ${q.title.slice(0, 16)} · 채팅 화면을 못 읽음`); return; }
    if (s.captcha || s.login) { fail(q, "1688 로그인·보안 인증 필요 — 💬 화면에서 직접 처리", "handoff"); return; }
    const r = C.repliesAfter(s.lines, (q.sent || []).map((x) => x.text), q.company || "");
    if (!r.found) { upd(q.id, { reason: "화면에서 보낸 질문을 못 찾음" }); diag(wc, "im"); return; }
    const known = (q.replies || []).filter((x) => x.afterStage === q.stage).length;
    const fresh = r.replies.slice(known).map((text) => ({ text, afterStage: q.stage, ts: Date.now() }));
    const replies = [...(q.replies || []), ...fresh];
    const info = C.extractInfo(replies.map((x) => x.text), q.info);
    const cur = upd(q.id, { replies, info });
    if (fresh.length) log("sys", `▶ 💬 ${q.title.slice(0, 20)} · 판매자 답: ${fresh.map((x) => x.text).join(" / ").slice(0, 120)}`);
    const a = C.nextAction(cur);
    if (a.action === "wait") {
      if (Date.now() - (q.lastSentAt || 0) > 864e5) fail(q, "24시간 답 없음", "handoff");
      else upd(q.id, { reason: a.reason });
      return;
    }
    if (a.action === "handoff") { fail(q, `${a.reason} — 💬 화면에서 직접 답해 주세요`, "handoff"); return; }
    if (a.action === "done") { upd(q.id, { status: "done", reason: a.reason }); log("go", `■ 💬 ${q.title.slice(0, 20)} · 질문 완료 ${JSON.stringify(info)}`); return; }
    await (FAST ? human.pause(500, 900) : human.pause(25_000, 80_000)); // 답 읽고 쓰는 시간
    const s2 = await scan(wc);
    if (s2?.input) await sendStage(list().find((x) => x.id === q.id), s2);
  }

  async function tick() {
    tickTimer = null;
    await refreshCore(log);
    if (!auto() || busy) return schedule();
    const due = list().filter((q) => q.status === "waiting" && q.chatUrl && Date.now() - (q.lastCheck || 0) > 180_000).sort((a, b) => (a.lastCheck || 0) - (b.lastCheck || 0))[0];
    if (due) {
      busy = true; push();
      try { await checkOne(due); } catch (e) { log("dim", `  💬 확인 오류: ${e?.message || e}`); }
      busy = false; push();
    }
    schedule();
  }
  function schedule() {
    if (tickTimer) return;
    if (!list().some((q) => q.status === "waiting")) return;
    tickTimer = setTimeout(tick, rnd(90_000, 180_000)); // 1.5~3분마다 한 곳씩
  }

  function show(v) {
    if (v) ensureView();
    if (v && view && !view.webContents.getURL()) { const q = list().find((x) => x.chatUrl); view.webContents.loadURL(q ? q.chatUrl : IM_HOME); } // 문의가 없으면 1688 채팅 첫 화면(대화 목록)
    setShown(!!v && !!view);
    push();
  }

  // 1688 화면에서 새 창으로 채팅이 열릴 때(main.js의 새 창 처리에서 부름)
  function opened(url) {
    if (openWaiter) { openWaiter(url); return true; }
    ensureView().webContents.loadURL(url); show(true); return true;
  }

  return {
    view: () => view, isImUrl, opened, show, push, schedule, inquire,
    siteMode, cycleSiteMode() { const st = store.get("settings") || {}; const next = { replace: "below", below: "off", off: "replace" }[siteMode()]; store.set("settings", { ...st, siteTr: next }); return next; },
    toggleTr() { const st = store.get("settings") || {}; store.set("settings", { ...st, chatTr: !trOn() }); push(); },
    translate: (texts) => tr.translate(texts),
    toggleAuto() { const st = store.get("settings") || {}; store.set("settings", { ...st, chatAuto: !auto() }); log("sys", `💬 자동 이어 묻기 ${auto() ? "켬" : "끔"}`); push(); schedule(); },
    remove(id) { save(list().filter((q) => q.id !== id)); },
    resume(id) { const q = list().find((x) => x.id === id); if (!q) return; upd(id, { status: "waiting", reason: "", lastCheck: 0, replies: (q.replies || []).filter((r) => r.afterStage !== q.stage) }); schedule(); }, // 이번 단계 답은 화면에서 새 규칙으로 다시 읽는다
    pauseOne(id) { upd(id, { status: "paused", reason: "직접 멈춤" }); },
    openOne(id) { const q = list().find((x) => x.id === id); if (q?.chatUrl && !busy) { ensureView().webContents.loadURL(q.chatUrl); show(true); } },
    state, waitingOpen: () => !!openWaiter,
    async checkNow(id) { await refreshCore(log); const q = list().find((x) => x.id === id); if (!q || busy) return; busy = true; try { await checkOne(q); } finally { busy = false; push(); } },
  };
}
