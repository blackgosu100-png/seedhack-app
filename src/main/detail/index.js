// 📄 상세페이지 자동 생성 — 오케스트레이터(A5)
// 1688 상품 페이지(또는 저장된 DetailSource) → ① 추출 → ② 내려받기 → ③ OCR → ④ 글자 지우기 → ⑤ 번역 → ⑥ 카피 → ⑦ 구성 → ⑧ 렌더 → ⑨ 완료
// 각 단계 모듈(A1~A4)은 동적으로 불러온다. 모듈이 아직 없거나 함수가 없으면 "대체 동작"으로 그 단계를 건너뛰어 끝까지 간다:
//   extract-core 없음 → 가벼운 자체 정리 / extract 없음 → 자체 내려받기(세션 fetch·file 복사)
//   ocr 없음 → 상자 0개(provider none) / image 없음 → 원본을 PNG로 복사·nativeImage 로 자르기
//   copy 없음 → 제목·속성만으로 최소 카피 / plan-core 없음 → 최소 구성 / render 없음 → 숨은 창에서 자체 HTML 렌더
// 작업 폴더: userData/detail/<jobId>/{raw,clean,out}/ + source.json ocr.json copy.json plan.json result.json
import electron from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { offerUrl } from "./extract-core.js"; // 📄 주소 칸 입력 → 1688 상품 주소(순수 함수, extract-core.test.js)
import { routeProductUrl, cnWall, CN_WALL_PROBE_JS, SITE_NAME, isKoSite, buildKoRaw, koWallMessage } from "./site-core.js"; // ▶ 주소로 만들기: 1688·타오바오/티몰·쿠팡·네이버·오늘의집 주소 가려내기(site-core.test.js)
import { codexBin, codexLimit, clearCodexLimit, codexPing } from "./codex-bin.js";
import { setTextEngine } from "./cli.js"; // 🧪 GPT 명령줄 그리기(있을 때만 선택 칸이 보인다)
import { newClock, clockKey, clockTick, clockStop, clockResume, clockSummary, fmtDur } from "./clock-core.js"; // ⏱ 버튼 누른 순간~완성까지 단계별 실제 시간(clock-core.test.js)
import { addUsage, summarize as summarizeUsage } from "./usage-core.js"; // 🎨 이미지 생성 사용량(usage-core.test.js)
import { createStore as createTemplateStore, themeAsTemplate, overrideChips, sourceKey as templateSourceKey, defaultName as templateDefaultName, newId as templateNewId } from "./templates.js"; // 🧲 내 템플릿 보관함(2단계, templates.test.js)

const { nativeImage, shell, BrowserWindow } = electron;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// v2(2026-10-09): cutout(제품 누끼+팔레트) · brief(기획안) · review(사람 확인, 옵션) · qa(AI 자가 검수 루프) 추가 — 14단계
export const STEPS = ["extract", "download", "ocr", "clean", "vision", "cutout", "translate", "brief", "copy", "scene", "plan", "review", "render", "qa", "done"]; // v3: scene(AI 장면 사진, 키 있을 때)
// 단계별 진행률 구간(%) — 단계 안의 이미지 단위 진행은 이 구간 안에서 비례, 전체는 단조 증가만 허용
const RANGE = { extract: [0, 3], download: [3, 17], ocr: [17, 30], clean: [30, 38], vision: [38, 46], cutout: [46, 50], translate: [50, 52], brief: [52, 56], copy: [56, 61], scene: [61, 72], plan: [72, 74], review: [74, 76], render: [76, 88], qa: [88, 99], done: [100, 100] };
const STEP_KO = { extract: "상품 정보 읽기", download: "이미지 내려받기", ocr: "중국어 글자 찾기", clean: "사진 영역 자르기", vision: "사진 검수", cutout: "제품 누끼", scene: "AI 장면 사진", translate: "한글 번역", brief: "기획안", review: "확인", qa: "AI 자가 검수", copy: "카피 작성", plan: "페이지 구성", render: "렌더링", done: "완료" };
// v5(card) 테마 — 같은 섹션·장면·카피를 색·질감만 바꿔 그린다(A4 card 엔진 테마). colors = 미니 미리보기 [바탕, 카드, 포인트]
// 판매 실적·신뢰 배지(선택형) — 막지 않고 수강생이 켜서 넣는다. 켠 항목만 plan 에 반영(A3 선택형 섹션과 같은 type 이름)
export const CLAIMS = [
  { type: "sold_out_banner", label: "N차 완판", ph: "예: □차 완판 (□ = 오른쪽 숫자)", valuePh: "숫자", unit: "" },
  { type: "rank_badge", label: "카테고리 1위", ph: "예: 주방수납 카테고리 □위", valuePh: "순위", unit: "" },
  { type: "review_stat", label: "실사용 후기 수·만족도", ph: "예: 구매 만족도 98%", valuePh: "후기 수", unit: "건" },
  { type: "cert", label: "인증명·번호", ph: "예: KC 안전인증", valuePh: "인증번호", unit: "" },
  { type: "rnd_cost", label: "연구 개발비", ph: "예: 연구 개발비 □억 원 투자", valuePh: "숫자", unit: "" },
  { type: "official_store", label: "공식 판매처", ph: "예: 브랜드 공식 판매처", valuePh: "", unit: "" },
  { type: "trust_badges", label: "신뢰 배지 묶음", ph: "예: 국내 검수 · 무료 교환 · 빠른 배송", valuePh: "", unit: "" },
];
const claimTypes = new Set(CLAIMS.map((c) => c.type));
const cleanClaims = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => claimTypes.has(k)).map(([k, v]) => [k, { on: !!v?.on, text: String(v?.text || "").slice(0, 80), value: String(v?.value ?? "").slice(0, 40), ...(Array.isArray(v?.options) ? { options: v.options.map(String).slice(0, 5) } : {}) }]));
// 문구의 □ 칸을 숫자 칸 값으로 채운다. □ 가 남으면(실제 값 없음) 그 항목은 넣지 않는다 — 빈 틀이 페이지에 찍히지 않게
const fillBox = (text, value) => { let t = String(text || "").trim(), v = String(value || "").trim(); if (/□/.test(t) && v) t = t.replace(/□+/, v); else if (!t && v) t = v; return /□/.test(t) ? "" : t; };
// 화면 입력(info.claims, 켠 것만) → A3 claims 원본 { sold_out, rank, rnd_cost, cert[], official_store, review_stat{count,satisfaction}, trust_badges[] }
function toA3Claims(claims) {
  const on = (k) => (claims?.[k]?.on ? claims[k] : null), raw = {};
  if (on("sold_out_banner")) raw.sold_out = fillBox(on("sold_out_banner").text, on("sold_out_banner").value);
  if (on("rank_badge")) raw.rank = fillBox(on("rank_badge").text, on("rank_badge").value);
  if (on("rnd_cost")) raw.rnd_cost = fillBox(on("rnd_cost").text, on("rnd_cost").value);
  if (on("cert")) { const c = on("cert"); const name = String(c.text || "").replace(/\(?\s*인증번호[^)]*\)?/, "").trim(); if (name && !/□/.test(name)) raw.cert = [{ name, no: /□/.test(c.value) ? "" : String(c.value || "").trim() }]; }
  if (on("official_store")) raw.official_store = fillBox(on("official_store").text, on("official_store").value);
  if (on("review_stat")) { const r = on("review_stat"), t = String(r.text || ""); const count = String(r.value || "").trim() || (t.match(/([\d,.]+\s*[만천]?)\s*건/) || [])[1] || ""; const sat = (t.match(/만족도\s*([\d.]+)/) || [])[1] || ""; if (count || sat) raw.review_stat = { count, satisfaction: sat }; }
  if (on("trust_badges")) raw.trust_badges = String(on("trust_badges").text || "").split(/[·,，|/]/).map((x) => x.trim()).filter((x) => x && !/□/.test(x)).slice(0, 4);
  return raw;
}
// 켠 항목 → plan 섹션(선택형). 문구가 비면 넣지 않는다
const claimSections = (claims) => CLAIMS.filter((c) => claims?.[c.type]?.on && fillBox(claims[c.type].text, claims[c.type].value)).map((c) => ({ type: c.type, id: `claim-${c.type}`, claim: true, label: c.label, text: fillBox(claims[c.type].text, claims[c.type].value), value: claims[c.type].value, ...(c.type === "trust_badges" ? { items: String(claims[c.type].text || "").split(/[·,，|\/]/).map((x) => x.trim()).filter((x) => x && !/□/.test(x)).slice(0, 6) } : {}) }));
// 문구 예시(숫자 칸 비움) — A3 suggestClaims 가 없을 때
function suggestClaimsLite(brief = {}) {
  const cat = String(brief?.category || brief?.product_name_ko || brief?.persona?.who || "").split(/\s+/).slice(0, 2).join(" ") || "카테고리";
  return { sold_out_banner: { text: "누적 □차 완판", value: "" }, rank_badge: { text: `${cat} 판매 1위`, value: "" }, review_stat: { text: "실사용 후기 □건 · 만족도 □점", value: "" }, cert: { text: "□□ 인증 완료 (인증번호 □)", value: "" }, rnd_cost: { text: "연구 개발비 □원 투자", value: "" }, official_store: { text: "브랜드 공식 판매처", value: "" }, trust_badges: { text: "국내 검수 · 무료 교환 · 빠른 배송", value: "" } };
}
export const THEMES = [
  { id: "ivory", name: "아이보리", desc: "Moast 결과 톤 · 아이보리 바탕 · 흰 둥근 카드", colors: ["#f7f6f2", "#ffffff", "#8a5a3c"] },
  { id: "clean", name: "화이트 클린", desc: "흰 바탕 · 초록 포인트 · 깔끔", colors: ["#ffffff", "#f5f6f8", "#16a34a"] },
  { id: "dark", name: "다크", desc: "차콜 바탕 · 금빛 포인트 · 프리미엄", colors: ["#141414", "#232323", "#d4a24c"] },
  { id: "pop", name: "팝", desc: "밝은 컬러 블록 · 둥근 카드 · 활기", colors: ["#fff7ed", "#ffffff", "#f97316"] },
  { id: "editorial", name: "에디토리얼", desc: "잡지형 · 세리프 타이틀 · 넓은 여백", colors: ["#f4f1ec", "#ffffff", "#1f1f1f"] },
  { id: "studio", name: "스튜디오", desc: "제품 색 팔레트 · 무광 무대", colors: ["#eeeae4", "#ffffff", "#5b6b7a"] },
  { id: "commerce", name: "커머스", desc: "쿠팡 레퍼런스 · 브랜드 색 1개 · 흰↔진남 교대", colors: ["#ffffff", "#0e1730", "#1f3cf5"] },
  { id: "branden", name: "브랜든 스타일", desc: "흰 바탕 · 글→사진 교대 · 왼쪽 정렬 · 여백 넓은 미니멀", colors: ["#ffffff", "#111111", "#f2f2f2"] },
];
// custom = 레퍼런스 자동 템플릿(목록에는 안 보이고 레퍼런스가 있을 때만)
const isTheme = (t) => THEMES.some((x) => x.id === t) || t === "custom";
export const TEMPLATES = [
  { id: "clean", name: "화이트 클린", desc: "흰 바탕 · 큰 사진 · 깔끔한 글 — 생활용품·주방·수납" },
  { id: "dark", name: "다크 프리미엄", desc: "검은 바탕 · 금빛 포인트 — 전자·가죽·고급 선물" },
  { id: "pop", name: "컬러 팝", desc: "밝은 색 블록 · 둥근 카드 — 키즈·반려·레저" },
  { id: "localize", name: "원본 한글화(v6)", desc: "1688 원본 이미지를 살리고 중국어만 한글로 — 빠르고 저렴, 실제 사진·크기 정확" },
  { id: "card", name: "카드(v5)", desc: "아이보리 · 흰 둥근 카드 · 섹션마다 생성 장면 + 짧은 글 — Moast 결과 톤" },
  { id: "editorial", name: "에디토리얼", desc: "디자이너 실작업 톤 — 꽉 찬 사진 · 영문 타이틀 · 키워드 표 · CHECK POINT · POINT 라벨" },
  { id: "studio", name: "스튜디오", desc: "누끼 제품 + 상품 색 팔레트 · 잡지 레이아웃 — v2 기본" },
];
const WIDTH = 780;
const CJK = /[一-鿿]/;

const pad = (n) => String(n).padStart(2, "0");
// 사람이 확인 화면에서 뺀 사진은 이번 생성에서만 photo=null — 저장할 때는 원래 사진 정보를 되돌린다(나중에 다시 포함할 수 있게)
const cleanedForSave = (list) => (list || []).map((c) => (c?.userExcluded ? (({ userExcluded, _photo, ...rest }) => ({ ...rest, photo: _photo }))(c) : c));
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const rand6 = () => Math.random().toString(36).slice(2, 8);
const readJson = (f, dflt = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1));
const exists = (f) => { try { return fs.existsSync(f); } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 조각 안쪽에 길게 비어 있는 가로 띠(배경색 행이 maxGap 넘게 이어짐)를 maxGap 로 줄인다 — 긴 상세 이미지에서 잘라낸 조각이
// "그림 둘 사이 큰 흰 여백"으로 남는 것을 막는다(QA F-6). 가장자리 여백은 autoTrim 이 맡고, 이 함수는 안쪽만 본다. 반환 { from, to } (세로 px)
function squeezeGaps(file, { maxGap = 72, tol = 14 } = {}) {
  const im = nativeImage.createFromPath(file);
  if (im.isEmpty()) return null;
  const { width: w, height: h } = im.getSize();
  const bm = im.toBitmap(); // BGRA, scale 1
  if (bm.length < w * h * 4 || h < maxGap * 2) return null;
  const px = (x, y) => { const i = (y * w + x) * 4; return [bm[i], bm[i + 1], bm[i + 2]]; };
  const bg = px(0, 0).map((v, k) => Math.round((v + px(w - 1, 0)[k] + px(0, h - 1)[k] + px(w - 1, h - 1)[k]) / 4)); // 네 모서리 평균 = 배경색
  const blankRow = (y) => { for (let x = 0; x < w; x += 3) { const c = px(x, y); if (Math.abs(c[0] - bg[0]) > tol || Math.abs(c[1] - bg[1]) > tol || Math.abs(c[2] - bg[2]) > tol) return false; } return true; };
  const keep = []; let run = 0;
  for (let y = 0; y < h; y++) { if (blankRow(y)) { run++; if (run <= maxGap) keep.push(y); } else { run = 0; keep.push(y); } }
  if (keep.length === h) return { from: h, to: h };
  const out = Buffer.allocUnsafe(w * keep.length * 4);
  keep.forEach((y, k) => bm.copy(out, k * w * 4, y * w * 4, (y + 1) * w * 4));
  fs.writeFileSync(file, nativeImage.createFromBitmap(out, { width: w, height: keep.length }).toPNG());
  return { from: h, to: keep.length };
}

// 다른 담당 모듈을 동적으로 — 없거나 깨져 있으면 null(대체 동작)
async function mod(name, log) {
  const file = path.join(__dirname, `${name}.js`);
  if (!exists(file)) return null;
  try { return await import(pathToFileURL(file).href); }
  catch (e) { log?.("dim", `  📄 ${name}.js 불러오기 실패 → 대체 동작 (${e?.message || e})`); return null; }
}

export function initDetail({ ipcMain, app, getWin, store, log, translate, getCnSession, getCnView, send, showDetail, openCn, openCoupang }) {
  const ROOT = () => path.join(app.getPath("userData"), "detail");
  const TPL = createTemplateStore(path.join(app.getPath("userData"), "templates")); // 🧲 내 템플릿 보관함 userData/templates/<id>/template.json
  const themeList = () => [...THEMES.map(themeAsTemplate), ...TPL.summaries()]; // 기본 테마 + 내 템플릿(화면 테마 목록)
  const isMine = (id) => TPL.has(id);
  const jobDirOf = (jobId) => path.join(ROOT(), jobId);
  let cur = null; // 지금 도는 작업 { jobId, dir, status, step, pct, t0, cancelled, title, templateId, events }
  const changed = () => send("detail:changed", { count: listJobs().length, running: cur ? cur.jobId : null });

  // ---------- 진행 이벤트 ----------
  function emit(job, step, msg, extra = null, frac = 0) {
    const [lo, hi] = RANGE[step] || [job.pct, job.pct];
    const want = step === "fail" ? job.pct : lo + (hi - lo) * Math.min(1, Math.max(0, frac));
    job.pct = Math.max(job.pct, Math.round(want * 10) / 10);
    job.step = step;
    const ev = { ...(job.bg ? { bg: true } : {}), jobId: job.jobId, step, stepIndex: Math.max(0, STEPS.indexOf(step)), steps: STEPS.length, pct: job.pct, msg, extra: extra || null, ts: Date.now() };
    job.events.push(ev); if (job.events.length > 400) job.events.shift();
    if (STEPS.includes(step)) { job.timings ||= {}; const t = (job.timings[step] ||= { start: ev.ts, end: ev.ts }); t.end = ev.ts; } // 단계별 실측(첫 이벤트~마지막 이벤트)
    if (job.clock) clockTick(job.clock, clockKey(step, extra), ev.ts); // ⏱ 앞 이벤트~지금을 앞 이벤트 칸에
    send("detail:progress", ev);
  }
  const clockSnap = (job) => (job.clock ? clockSummary(clockStop(JSON.parse(JSON.stringify(job.clock)), Date.now())) : null);
  const check = (job) => { if (job.cancelled) throw Object.assign(new Error("취소됨"), { cancelled: true });
    if (job.gpt) { const lm = codexLimit(); if (lm && lm.at >= (job.gptT0 || 0)) throw Object.assign(new Error(`${lm.msg}. 그때 다시 만들거나, 아래 '만드는 AI'를 구글로 바꿔 주세요`), { gptLimit: true }); } }; // 🚦 GPT 한도: 조용히 예전 방식으로 넘어가지 않고 멈춘다

  // ---------- AI 자가 검수: 완성 슬라이스를 Claude CLI(Read)가 보고 점수·결함을 돌려준다 (vision.js 와 같은 방식) ----------
  const QA_SYSTEM = `당신은 쿠팡 상세페이지 최종 검수자입니다. 완성된 상세페이지 이미지(out/01.jpg…)를 Read 도구로 한 장씩 직접 열어 보고, 셀러가 손대지 않고 그대로 올릴 수 있는지 판정합니다.
점수(score, 1~5): 5=그대로 올려도 됨, 4=사소한 아쉬움, 3=한두 군데 고쳐야 함, 2=여러 군데 문제, 1=쓸 수 없음.
결함(defects)은 실제로 보이는 것만 적습니다. kind: text(중국어·깨진 글자·오타), image(빈 벽·얼룩·납작한 조각·제품이 안 보이는 사진·반복 사진), layout(겹침·잘림·과한 여백), copy(사진과 맞지 않는 캡션·식상하거나 어색한 문장·근거 없는 숫자/효능·금지어), fact(원문에 없는 주장).
fix 는 가장 알맞은 하나: swap_image(그 섹션 사진을 다른 사진으로), drop_section(섹션 삭제), rewrite(그 섹션 글만 다시), rerender(레이아웃만 다시).
section 은 입력의 섹션 목록 id(s01, s02 …)로 적습니다. 결함이 없으면 defects 를 빈 배열로.`;
  const QA_SCHEMA = { type: "object", additionalProperties: false, required: ["score", "defects"], properties: {
    score: { type: "integer", minimum: 1, maximum: 5 }, summary: { type: "string", maxLength: 200 },
    defects: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["slice", "section", "kind", "what", "fix"], properties: {
      slice: { type: "string", maxLength: 20 }, section: { type: "string", maxLength: 10 }, kind: { type: "string", enum: ["text", "image", "layout", "copy", "fact"] }, what: { type: "string", maxLength: 120 }, fix: { type: "string", enum: ["swap_image", "drop_section", "rewrite", "rerender"] } } } } } };
  async function qaReview({ slices, plan, copy, dir, title, evidence = "" }) {
    const cli = await mod("cli", log);
    if (!cli?.runStructured) return { error: "cli.js 없음" };
    const secList = plan.sections.map((s) => `${s.id} ${s.type}${s.image ? ` 사진=${path.basename(s.image)}` : ""}${s.title || s.headline ? ` "${String(s.title || s.headline).slice(0, 30)}"` : ""}`).join("\n");
    const text = `상품: ${title}\n\n이미지 파일(순서대로 Read 로 열어 보세요):\n${slices.map((s) => `${path.basename(s.file)}  ${path.join(dir, s.file)}  (섹션: ${(s.sections || []).join(",")})`).join("\n")}\n\n섹션 목록(id 순서 = 페이지 위→아래):\n${secList}\n\n원문 근거(이 안에 있는 숫자·주장은 결함이 아닙니다 — 여기 없는 수치·효능만 fact 로 지적):\n상품명 "${title}"\n스펙: ${(copy?.spec || []).slice(0, 14).map((r) => `${r.k}=${r.v}`).join(", ")}\n${evidence}`;
    const qm = (store.get("settings") || {}).detailQaModel || process.env.SEEDHACK_QA_MODEL || "haiku"; // 속도: 자가 검수 기본 haiku(실측 sonnet 1회 ≈175초)
    const r = await cli.runStructured({ purpose: "render-qa", system: QA_SYSTEM, schema: QA_SCHEMA, text, model: qm, timeoutMs: 420000, allowedTools: ["Read"] });
    if (r?.error) return { error: r.error };
    const res = r.result || {};
    let defects = (Array.isArray(res.defects) ? res.defects : []).filter((d) => d && d.kind && d.fix).map((d) => ({ slice: String(d.slice || "").slice(0, 20), section: String(d.section || "").slice(0, 10), kind: d.kind, what: String(d.what || "").slice(0, 120), fix: d.fix }));
    // 오탐 거르기: "오타 '고은…'" 처럼 인용한 틀린 글자가 실제 카피·구성 어디에도 없으면 검수 모델이 그림을 잘못 읽은 것 → 버림(실측: haiku 가 맞는 글자를 오타로 지적)
    const hay = JSON.stringify(copy || {}) + JSON.stringify(plan.sections || []);
    const dropped = [];
    defects = defects.filter((d) => { if (d.kind !== "text" && d.kind !== "copy") return true; const q = (d.what.match(/['"‘“]([^'"’”]{2,30})['"’”]/) || [])[1]; if (q && /오타|오탈자|문법|잘못/.test(d.what) && !hay.includes(q.trim())) { dropped.push(d.what); return false; } return true; });
    if (dropped.length) log("dim", `  📄 자가 검수 오탐 ${dropped.length}건 버림(인용한 글자가 실제 카피에 없음) · ${dropped.slice(0, 3).join(" / ")}`);
    return { ok: true, score: Math.min(5, Math.max(1, Number(res.score) || 1)), summary: String(res.summary || "").slice(0, 200), defects, costUsd: r.costUsd ?? null, model: r.model };
  }

  // ---------- v4: 7단 기획서 · 디자인 톤앤매너 · 템플릿 추천 · 확인 화면 데이터 ----------
  const mods0 = {}; mod("scene", log).then((m) => { mods0.scene = m; }).catch(() => {}); mod("localize-core", log).then((m) => { mods0.localizeCore = m; }).catch(() => {}); // 확인 화면 예상 비용 계산용(장면 생성 키 여부)
  const pickFn = (mods, names) => { for (const m of [mods.brief, mods.style, mods.planCore, mods.copy]) for (const n of names) if (m && typeof m[n] === "function") return m[n].bind(m); return null; };
  const uniqS = (a) => [...new Set(a.map((x) => String(x || "").trim()).filter(Boolean))];
  function productNameOf({ src, title_ko, brief }) { return String(src.coupangName || (brief?.product_name_ko) || title_ko || "").slice(0, 60); }
  // Moast keyContent 형식(상품 유형 / 핵심 소구 / 주요 장점 / 상세 구성·스펙 / 추천 타겟 / 상세페이지 기획 방향 / 주의할 표현) — A3 가 brief_text 를 주면 그대로, 아니면 기획안 JSON 으로 조립
  // 벤치마킹 레퍼런스 불러오기: info.reference 가 reference.json 이면 그대로, 이미지 폴더면 reference.js 로 분석(OCR 무료 + 비전 haiku 1회) → reference/reference.json 에 보관(같은 원본이면 재사용)
  async function jobReference(job, dir, mods) {
    const info = readJson(path.join(dir, "info.json")) || {}, keepExtra = !!info.refKeepExtra;
    const saved = path.join(dir, "reference", "reference.json"), cached = readJson(saved);
    // 🧲 내 템플릿(info.templateRef): 보관함에서 reference 모양으로(overrides 적용 + 가드 줄) — 분석 없음·비용 0. overrides·토글이 바뀌면 다시 쓴다
    if (info.templateRef) {
      const t = TPL.get(info.templateRef);
      if (!t) { emit(job, "brief", "△ 고른 템플릿이 보관함에 없어요 → 기본 구성으로", null, 1); return null; }
      const key = `tpl:${t.id}:${JSON.stringify(t.overrides || {})}:${keepExtra ? 1 : 0}`;
      if (cached?.tokens && cached.srcKey === key) return cached;
      const r = { ...TPL.reference(t.id, { keepExtra }), srcKey: key };
      fs.mkdirSync(path.dirname(saved), { recursive: true }); writeJson(saved, r);
      emit(job, "brief", `✔ 내 템플릿 「${t.name}」 · 섹션 ${(r.sections || []).length}개 · ${r.tokens.align === "left" ? "왼쪽 정렬" : "가운데 정렬"}${r.tokens.colors?.brand ? ` · 강조 색 ${r.tokens.colors.brand}` : ""}${keepExtra ? " · 우리 강점 섹션 유지" : ""}`, null, 1);
      return r;
    }
    const src = info.reference; if (!src) return null;
    if (cached?.tokens && cached.srcKey === `${src}:${keepExtra ? 1 : 0}`) return cached;
    try {
      let r = /\.json$/i.test(src) ? readJson(src) : null;
      if (!r && exists(src) && mods.reference?.buildReference) {
        emit(job, "brief", "🧲 레퍼런스 상세페이지를 읽는 중 (글자·색·섹션 순서·설득 흐름)", null, 0.1);
        r = await mods.reference.buildReference({ input: src, outDir: path.join(dir, "reference"), log });
        if (r?.cost?.usd != null) { job.costs.reference = r.cost.usd; job.costUsd = (job.costUsd || 0) + r.cost.usd; }
      }
      if (!r?.tokens) { emit(job, "brief", "△ 레퍼런스를 읽지 못했어요 → 기본 구성으로", null, 1); return null; }
      const out = { ...r, keepExtra, srcKey: `${src}:${keepExtra ? 1 : 0}` };
      fs.mkdirSync(path.dirname(saved), { recursive: true }); writeJson(saved, out);
      emit(job, "brief", `✔ 레퍼런스 · 섹션 ${(r.sections || []).length}개 · ${r.tokens.align === "left" ? "왼쪽 정렬" : "가운데 정렬"}${r.tokens.colors?.brand ? ` · 강조 색 ${r.tokens.colors.brand}` : ""}`, null, 1);
      return out;
    } catch (e) { log("warn", `△ 📄 레퍼런스 오류 (${e?.message || e})`); return null; }
  }
  async function makeBriefText(mods, brief, ctx) {
    const body = (t) => String(t || "").replace(/^[■\s]*(상품명|상품 유형|핵심 소구|주요 장점|상세 구성·스펙|추천 타겟|상세페이지 기획 방향|주의할 표현)\s*:?/gm, "").replace(/[-\s]/g, "").length;
    if (brief?.brief_text && body(brief.brief_text) > 40) return String(brief.brief_text);
    if (brief?.key_appeal || brief?.plan_direction) { const fn = pickFn(mods, ["briefToText"]); if (fn) { try { const t = await fn(brief); if (body(t) > 40) return String(t); } catch {} } }
    const { attrs, title_ko, ocr } = ctx, b = brief || {};
    const cat = attrs.find((a) => /(카테고리|품목|제품|유형)/.test(a.k_ko))?.v_ko || title_ko || "";
    const ocrKo = uniqS(ocr.images.flatMap((o) => (o.boxes || []).map((x) => x.text_ko)).filter((t) => t && !CJK.test(t) && t.length >= 4)).slice(0, 12);
    const merits = uniqS([...(b.buying_factors || []), ...(b.evidence || [])]).slice(0, 6);
    const lines = [
      `상품 유형: ${cat}`, `핵심 소구: ${b.angle || b.top_desire || ""}`, `주요 장점:`, ...(merits.length ? merits : ocrKo.slice(0, 5)).map((x) => `- ${x}`),
      `상세 구성·스펙:`, ...attrs.slice(0, 12).map((a) => `- ${a.k_ko}: ${a.v_ko}`),
      `추천 타겟: ${[b.persona?.who, b.persona?.situation].filter(Boolean).join(" — ")}`,
      `상세페이지 기획 방향:`, `- 첫 화면: ${b.angle || title_ko}`, `- 초반: ${b.top_problem || "고객의 불편 공감"}`, `- 중반: 핵심 장점 ${Math.min(4, merits.length || 3)}가지를 사진과 함께`, `- 디테일: 소재·구조·사용 장면 확대`, `- 후반: 걱정 해소(${(b.objections || []).slice(0, 3).join(" · ")})`, `- 마지막: 구성·스펙·주의사항 정리`,
      `주의할 표현:`, `- 원문에서 확인되지 않은 수치·인증·효능 단정 금지`, `- 이미지 속 소품은 구성품이 아닐 수 있음`, ...((b.competitor_claims || []).length ? [`- 경쟁 상품의 흔한 주장(${b.competitor_claims.slice(0, 3).join(", ")})을 그대로 따라 하지 않기`] : []),
    ];
    return lines.join("\n");
  }
  // 제품별 디자인 시스템 — A3 가 만들면 그대로, 아니면 누끼 팔레트로 기본값
  async function makeStyleGuide(mods, ctx) {
    const pal0 = ctx.cutout?.palette || ctx.cleaned.find((c) => c.cutout?.palette)?.cutout.palette || null;
    if (mods.brief?.rulesStyleGuide) { try { return { ...mods.brief.rulesStyleGuide(pal0), how: "rules" }; } catch {} } // A3 이름(palette·accents·background·consistencyRules·forbiddenProductUsage)
    const pal = ctx.cutout?.palette || ctx.cleaned.find((c) => c.cutout?.palette)?.cutout.palette || null;
    const dom = (pal?.dominant || ["#2b2b2b", "#6b6b6b", "#bdbdbd", "#e9e9e9", "#ffffff"]).slice(0, 5);
    return { palette: dom, accents: uniqS([pal?.accent, dom[0], dom[1]]).slice(0, 4), background: "#f6f6f4",
      backgroundTone: "밝은 웜그레이 바탕에 제품이 또렷하게 보이는 미니멀 톤", lighting: "창으로 들어오는 부드러운 자연광, 옅은 그림자", materialMood: "무광 금속·매트한 표면의 깔끔한 질감", typographyTone: "굵은 고딕 제목 + 가는 본문, 영문 세리프 포인트",
      consistencyRules: ["모든 섹션 배경은 같은 바탕색 계열", "제품 사진은 같은 조명 방향(왼쪽 위 자연광)", "강조색은 포인트 1색만", "사진 모서리 둥글기 통일", "제목 크기·간격 통일", "소품은 제품 용도에 맞는 것만 최소로", "글자 없는 깨끗한 사진", "그림자 강도 통일", "섹션마다 여백 같은 비율", "중국어·로고·워터마크 없음"],
      forbiddenProductUsage: "제품 사진이 없는 섹션에 제품을 새로 그려 넣지 말 것(원본과 다른 모양이 됨)", how: "palette" };
  }
  async function makeRecommend(mods, ctx, styleGuide) {
    const fn = pickFn(mods, ["recommendTemplate"]);
    if (fn) { try { const r = await fn({ ...ctx, styleGuide }); if (r?.templateId) return r; if (typeof r === "string") return { templateId: r, reason: "" }; } catch {} }
    const t = `${ctx.title_ko} ${ctx.category} ${ctx.attrs.map((a) => a.v_ko).join(" ")}`;
    if (/(아기|유아|키즈|어린이|반려|강아지|고양이|장난감|캠핑|레저)/.test(t)) return { templateId: "pop", reason: "키즈·반려·레저 상품이라 밝은 색 블록이 잘 맞아요" };
    if (/(가죽|시계|향수|위스키|전자|이어폰|프리미엄|선물)/.test(t) || styleGuide?.dark) return { templateId: "dark", reason: "고급감·전자 계열이라 다크 톤이 어울려요" };
    if (ctx.cleaned.some((c) => c.cutout?.ok)) return { templateId: "editorial", reason: "깨끗한 제품 단독 컷이 있어 꽉 찬 사진·영문 타이틀 레이아웃이 잘 살아요" };
    return { templateId: "editorial", reason: "생활용품 기본 — 사진이 주인공인 에디토리얼 레이아웃" };
  }
  const styleLine = (sg) => ({
    en: `Style: background ${sg.backgroundColor || ""} (${sg.backgroundTone || ""}); lighting: ${sg.lighting || ""}; material mood: ${sg.materialMood || ""}. ${sg.forbiddenProductUsageNote ? "Do not add any extra product that is not in the input photo." : ""}`.replace(/\s+/g, " ").trim(),
    ko: `스타일: 배경 ${sg.backgroundColor || ""}(${sg.backgroundTone || ""}), 조명: ${sg.lighting || ""}, 소재감: ${sg.materialMood || ""}. ${sg.forbiddenProductUsageNote || ""}`.trim(),
  });
  // 확인 화면 데이터
  function infoGet(id) {
    const dir = jobDirOf(id); const info = readJson(path.join(dir, "info.json")); if (!info) return { error: "상품 정보가 아직 없습니다" };
    const src = readJson(path.join(dir, "source.json")) || {}, cleaned = readJson(path.join(dir, "clean.json")) || [], vision = readJson(path.join(dir, "vision.json")), ocr = readJson(path.join(dir, "ocr.json")) || { images: [] };
    const exc = new Set(info.excluded || []), inc = new Set(info.included || []);
    const items = (src.images || []).map((im) => {
      const c = cleaned.find((x) => x.id === im.id), v = vision?.items?.find((x) => x.id === im.id);
      const o0 = ocr.images.find((x) => x.id === im.id), cls = o0 && mods0.localizeCore?.classifyLocalizeImage ? mods0.localizeCore.classifyLocalizeImage((o0.boxes || []).filter((b) => !b.latin).map((b) => ({ zh: b.text, h: b.h })), { imgH: o0.h || im.h || 1000, kind: im.kind }) : null; // v12 판매 정책·가격 설명·후기·사양표
      const aiOut = !c?.photo?.file ? "사진 없음(글자만)" : v && (v.usable === false || v.role === "skip") ? (v.shows || "AI 제외") : im.refOnly ? "타오바오 참고 사진(다른 판매자·구매자 사진, 권리 주의) — 쓰려면 눌러서 포함" : cls ? `${cls.reason} — 쓰려면 눌러서 포함` : "";
      const excluded = exc.has(im.id) ? true : inc.has(im.id) ? false : !!aiOut;
      const o = ocr.images.find((x) => x.id === im.id);
      const texts = Array.isArray(info.texts?.[im.id]) ? info.texts[im.id] : uniqS((o?.boxes || []).filter((b) => !b.latin).map((b) => b.text_ko || b.text));
      const logo = info.logos?.[im.id] != null ? !!info.logos[im.id] : !!(v?.any_logo_visible ?? v?.has_logo);
      return { logo, logoHuman: info.logos?.[im.id] != null, sameAs: im.sameAs || null, label: im.label_ko || im.label_zh || im.label || "", id: im.id, kind: im.kind, path: im.file, photo: c?.photo?.file ? path.join(dir, c.photo.file) : "", excluded, aiExcluded: !!aiOut, why: aiOut, score: v?.score ?? null, texts, edited: !!info.texts?.[im.id] };
    });
    const usable = items.filter((x) => !x.excluded).length;
    const st = store.get("settings") || {};
    let sceneOn = false; try { sceneOn = !!(mods0.scene?.resolveProvider && mods0.scene.resolveProvider({ settings: { geminiKey: st.geminiKey || "", geminiImageModel: st.geminiImageModel || "" } })?.key); } catch {}
    const sections = Math.min(24, 12 + Math.min(6, Math.ceil(usable / 4)));
    const usd = 0.32 + 0.16 + (sceneOn ? 6 * Number(st.detailSceneN || 1) * 0.039 + 0.12 : 0);
    const minutes = sceneOn ? 5 : 4;
    const nLoc = items.filter((x) => x.kind !== "option" && !x.excluded).length;
    const modes = { localize: { usd: Math.round((0.13 + nLoc * 0.4 * 0.039) * 100) / 100, minutes: Math.max(2, Math.ceil(nLoc / 8)), /* 실측(커피 랙 24장): 번역 $0.13 + 사진 위 글 AI 지우기 7장×$0.039, 약 3분 */ label: "원본 한글화" }, scene: { usd: Math.round(usd * 100) / 100, minutes, label: "AI 장면 연출" } };
    modes.both = { usd: Math.round((modes.localize.usd + modes.scene.usd) * 100) / 100, minutes: modes.scene.minutes + 1, label: "둘 다" };
    const tplSel = info.templateRef ? TPL.get(info.templateRef) : null; // 🧲 고른 내 템플릿(세부 조정 칩 포함)
    const ko = src.lang === "ko"; // 한국 판매처: 원본 한글화·둘 다 없음 · 권리 확인(rightsOk) 전에는 생성하지 않음
    if (ko) { delete modes.localize; delete modes.both; }
    return { ...info, claims: cleanClaims(info.claims), claimTypes: CLAIMS, mode: ko ? "scene" : info.mode || "both", modes, koSource: ko ? src.source : "", rightsOk: !!info.rightsOk, themes: themeList(), templateRef: tplSel ? tplSel.id : "", templateChips: tplSel ? overrideChips(tplSel) : null, refKeepExtra: !!info.refKeepExtra, dir, url: info.url || src.url || "", gallery: items.filter((x) => x.kind === "gallery" || x.kind === "main"), sku: items.filter((x) => x.kind === "option" || x.kind === "sku"), detail: items.filter((x) => !["gallery", "main", "option", "sku"].includes(x.kind)), templates: TEMPLATES, estimate: { sections, usd: Math.round(usd * 100) / 100, minutes, sceneOn } };
  }
  function infoSet(id, patch) {
    const dir = jobDirOf(id); const info = readJson(path.join(dir, "info.json")); if (!info) return { error: "상품 정보가 아직 없습니다" };
    const out = { ...info };
    if (typeof patch.product_name_ko === "string") out.product_name_ko = patch.product_name_ko.slice(0, 80);
    if (typeof patch.brief_text === "string") out.brief_text = patch.brief_text.slice(0, 6000);
    if (typeof patch.templateId === "string" && TEMPLATES.some((t) => t.id === patch.templateId)) out.templateId = patch.templateId;
    if (typeof patch.theme === "string" && THEMES.some((t) => t.id === patch.theme)) { out.theme = patch.theme; delete out.templateRef; } // 기본 테마를 고르면 내 템플릿 선택은 풀린다
    if (typeof patch.theme === "string" && isMine(patch.theme)) patch = { ...patch, templateRef: patch.theme }; // 테마 자리에 내 템플릿 id 가 와도 된다
    if (typeof patch.templateRef === "string") { if (patch.templateRef && isMine(patch.templateRef)) { out.templateRef = patch.templateRef; out.theme = "custom"; delete out.reference; } else if (!patch.templateRef) { delete out.templateRef; if (out.theme === "custom" && !out.reference) out.theme = "ivory"; } }
    if (typeof patch.refKeepExtra === "boolean") out.refKeepExtra = patch.refKeepExtra;
    if (typeof patch.taobaoId === "string") out.taobaoId = patch.taobaoId.replace(/[^\w-]/g, "").slice(0, 30); // 🛍 타오바오 참고 사진 폴더 id(userData/taobao-reviews/<id>) // 레퍼런스 그대로(false) / 우리 강점 섹션 유지(true)
    if (["localize", "scene", "both"].includes(patch.mode)) out.mode = patch.mode;
    if (typeof patch.rightsOk === "boolean") out.rightsOk = patch.rightsOk; // 한국 판매처: "내 상품 사진이에요" 확인
    if (patch.logos && typeof patch.logos === "object") out.logos = { ...(out.logos || {}), ...Object.fromEntries(Object.entries(patch.logos).map(([k, v]) => [String(k), !!v])) };
    if (patch.claims && typeof patch.claims === "object") out.claims = cleanClaims({ ...(out.claims || {}), ...Object.fromEntries(Object.entries(patch.claims).map(([k, v]) => [k, { ...(out.claims?.[k] || {}), ...(v || {}) }])) });
    if (Array.isArray(patch.excluded)) out.excluded = patch.excluded.map(String).slice(0, 80);
    if (Array.isArray(patch.included)) out.included = patch.included.map(String).slice(0, 80);
    if (patch.texts && typeof patch.texts === "object") out.texts = { ...(out.texts || {}), ...Object.fromEntries(Object.entries(patch.texts).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map((x) => String(x || "").slice(0, 200))])) };
    if (patch.styleGuide && typeof patch.styleGuide === "object") { out.styleGuide = { ...(out.styleGuide || {}), ...patch.styleGuide }; out.styleGuideEdited = true; }
    writeJson(path.join(dir, "info.json"), out);
    return { ok: true };
  }

  // ---------- v5: 섹션별 장면 생성 · 검수 · 1회 재생성 · 섹션 다시 만들기 ----------
  const recordImageUsage = (ev) => store.set("imageUsage", addUsage(store.get("imageUsage"), ev)); // 받은 이미지 1장마다
  const sceneSettingsNow = () => { const st = store.get("settings") || {}; try { setTextEngine(st.detailBakeEngine === "codex" ? "codex" : ""); } catch {} /* 🧪 GPT 를 고르면 글 AI 도 GPT 명령줄로 */ return { geminiKey: st.geminiKey || "", geminiImageModel: st.geminiImageModel || "", openaiKey: st.openaiKey || "", bakeEngine: st.detailBakeEngine || "", openaiImageModel: st.openaiImageModel || "", vertexProject: st.vertexProject || "", sceneConcurrency: st.detailSceneConcurrency || 6, /* A2 다지역 라우터(지역당 2) — 동시 6 */ sceneModelHero: st.detailSceneModelHero || "" }; };
  // 생성본을 원본 제품 사진과 대조(Claude CLI·Read): same_product · has_text · score — 통과 = 같은 제품·글자 없음·3점 이상
  // 배경 소품의 흐릿한·작은 글자(포장지·패턴)는 허용 — 브랜드 로고·상표는 불가
  const smallTextOk = (m) => m.has_text && (Number(m.score) || 0) >= 4 && /(흐릿|작은|미세|포장지|패턴|희미)/.test(m.note || "") && !/(로고|브랜드|상표|DELL|애플|Apple|Cuisinart|Nespresso|네스프레소)/i.test(m.note || "");
  async function verifyScenes(mods, made, productImages, dir, job) {
    if (process.env.SEEDHACK_DETAIL_NO_AI || !mods.cli?.runStructured || !mods.cli?.cliAvailable?.()) { made.forEach((m) => { m.pass = false; m.note = "검수 불가(CLI 없음) — 쓰지 않음"; }); return; }
    // 속도: 16장씩 묶어 동시에, 모델 기본 haiku(설정 detailSceneCheckModel) — 원본 제품 사진과 대조
    const sys = `당신은 상세페이지 사진 검수자입니다. 원본 제품 사진과 AI 가 생성한 장면 사진들을 Read 로 열어 비교합니다. 생성 사진마다: same_product(제품의 형태·색·구조가 원본과 같은가 — 봉·레일·선반 개수, 관절·힌지 위치, 고리·구멍 배열, 다리·브래킷·손잡이 모양을 하나하나 대조해 하나라도 다르거나 제품이 둘로 늘었거나 다른 물건이면 false. 제품이 안 나오는 장면이면 true), has_text(글자·로고·워터마크가 있는가), has_logo(브랜드 로고·상표가 보이는가), score(1~5, 상세페이지에 바로 쓸 만한가), note(한 줄, 다르면 무엇이 다른지·글자가 어디에 있는지).`;
    const schema = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "same_product", "has_text", "score"], properties: { id: { type: "string" }, same_product: { type: "boolean" }, has_text: { type: "boolean" }, has_logo: { type: "boolean" }, score: { type: "integer", minimum: 1, maximum: 5 }, note: { type: "string", maxLength: 100 } } } } } };
    const model = (store.get("settings") || {}).detailSceneCheckModel || process.env.SEEDHACK_SCENE_CHECK_MODEL || "haiku";
    const chunks = []; for (let i = 0; i < made.length; i += 16) chunks.push(made.slice(i, i + 16));
    await Promise.all(chunks.map(async (part) => {
      const text = `원본 제품 사진:\n${productImages.map((f) => `  ${f}`).join("\n")}\n\n생성 사진(id · 파일 · 섹션):\n${part.map((m) => `  ${m.id}  ${path.join(dir, m.file)}  (${m.type || m.purpose || ""})`).join("\n")}`;
      const rv = await mods.cli.runStructured({ purpose: "scene-check", system: sys, schema, text, model, timeoutMs: 300000, allowedTools: ["Read"] });
      if (!rv?.ok) { log("warn", `△ 📄 생성 사진 검수 실패 → 쓰지 않음 (${rv?.error || "결과 없음"})`); part.forEach((m) => { m.pass = false; }); return; }
      for (const it of rv.result.items || []) { const m = part.find((x) => x.id === it.id); if (m) { m.same_product = !!it.same_product; m.has_text = !!it.has_text; m.has_logo = !!it.has_logo; m.score = it.score; m.note = it.note || ""; m.pass = m.same_product && !m.has_text && !m.has_logo && it.score >= 3; if (!m.pass && m.same_product && !m.has_logo && smallTextOk(m)) { m.pass = true; m.note += " (작은 글자 허용)"; } } }
      if (rv.costUsd != null && job) { job.costs.sceneCheck = (job.costs.sceneCheck || 0) + rv.costUsd; job.costUsd = (job.costUsd || 0) + rv.costUsd; }
    }));
  }
  async function runSceneV5({ job, dir, mods, sections, brief, vision, cleaned, images, src, title_ko, attrs, how, reuse, fresh, emit, sEmitFn }) {
    const prev = reuse && !fresh.includes("scene") ? readJson(path.join(dir, "scene.json")) : null;
    const regen = job.regen;
    if (prev?.items && !regen?.scene && !regen?.fill) { how.scene = "reuse"; return prev; }
    const ss = sceneSettingsNow();
    const prov = mods.scene?.resolveProvider ? mods.scene.resolveProvider({ settings: ss }) : { key: "" };
    if (!prov?.key) { how.scene = "no-key"; return prev || null; }
    if (process.env.SEEDHACK_DETAIL_NO_AI) { how.scene = "skip"; return prev || null; }
    if (!mods.scene?.generateSectionScenes) { how.scene = "skip"; return prev || null; }
    const visOk = (id) => { const v = vision?.items?.find((x) => x.id === id); return !v || (v.usable !== false && v.role !== "skip"); };
    const byScore = (a, b) => (vision?.items?.find((x) => x.id === b.id)?.score || 0) - (vision?.items?.find((x) => x.id === a.id)?.score || 0);
    const cut = cleaned.filter((c) => c.cutout?.file).map((c) => path.join(dir, c.cutout.file));
    const photos = cleaned.filter((c) => c?.photo?.file && visOk(c.id)).sort(byScore).map((c) => path.join(dir, c.photo.file));
    // 장면 입력: 누끼+사진 후보 → A2 pickSceneInputs(다른 브랜드가 두드러진 사진·잘린 사진·쓸 수 없는 사진 제외, 누끼 → 제품 단독 → 점수순 2장). 모두 걸리면 예전 방식
    let productImages = (cut.length ? cut : photos).slice(0, 2);
    if (mods.scene?.pickSceneInputs) { try { const cands = cleaned.flatMap((c) => [c.cutout?.file && path.join(dir, c.cutout.file), c.photo?.file && path.join(dir, c.photo.file)].filter(Boolean)); const picked = mods.scene.pickSceneInputs(cands.map((f) => ({ file: f })), vision, { max: 2 }); if (picked.length) productImages = picked; } catch (e) { log("dim", `  🎨 장면 입력 고르기 실패 → 기존 목록 (${e?.message || e})`); } }
    log("dim", `  🎨 장면 입력: ${productImages.map((f) => path.basename(f)).join(", ")}`);
    const product = { title_ko, category: src.category || "", keyword: src.keyword || "", attrs_ko: attrs.map((a) => ({ k_ko: a.k_ko, v_ko: a.v_ko })), features: (brief?.advantages || brief?.buying_factors || []).slice(0, 8) };
    const outS = path.join(dir, "scene"); fs.mkdirSync(outS, { recursive: true });
    const t0s = Date.now();
    // 대상 섹션: 다시 만들기면 그 섹션만(요청문을 장면 메모에 덧붙임), 아니면 장면이 필요한 섹션 전부
    let target = sections.filter((x) => x.shot);
    if (regen?.scene) target = target.filter((x) => x.id === regen.sectionId).map((x) => ({ ...x, shot: { ...x.shot, needs: `${x.shot.needs || ""} · 수정 요청: ${regen.request || ""}`.trim() } }));
    if (regen?.fill) { // 빠진 섹션만: 통과한 장면이 없는 섹션 + 중복 사진 섹션(regen.dupSections) · versatility 는 장면이 4장 모자라면 다시
      const ok = (id) => (prev?.items || []).filter((x) => x.section === id && x.pass && exists(path.join(dir, x.file)));
      const distinct = (id) => new Set(ok(id).map((x) => x.file)).size;
      const force = new Set(regen.force || []); // 강제 재생성: 섹션 id 또는 type
      const need = (x) => force.has(x.id) || force.has(x.type) || (x.type === "versatility" ? distinct(x.id) < 4 : !distinct(x.id)) || (regen.dupSections || []).includes(x.id); // 디테일 장면은 레시피상 1장(A2) — 2컷은 A2 레시피 몫
      target = target.filter(need);
      log("sys", `▶ 📄 빠진 섹션 장면만 생성 · ${target.map((x) => x.id).join(", ") || "없음"}`);
    }
    if (!target.length) { how.scene = "skip"; return prev || null; }
    const genFor = async (secs, round) => {
      let done = 0;
      const res = await mods.scene.generateSectionScenes({ sections: secs, product, brief: brief || {}, styleGuide: job.styleGuide || null, productImages, outDir: outS, settings: ss, log, onUsage: recordImageUsage,
        onProgress: ({ id }) => { done++; sEmitFn(`섹션 장면 ${done}/${secs.length}${round ? " (다시)" : ""} · ${id || ""}`, { done, total: secs.length }); } });
      const out = [];
      for (const r of res || []) (r.files || []).forEach((f, k) => { const rel = path.relative(dir, f).replace(/\\/g, "/"); out.push({ id: `${path.basename(f, path.extname(f))}${round ? "_r" : ""}`, section: r.sectionId, type: r.type, file: rel, pass: false }); emit(job, job.step, `🎨 ${r.sectionId} 장면 완성`, { bg: "scene", sceneThumb: f, sectionId: r.sectionId }, 0); });
      return { out, errors: (res || []).filter((r) => r.error).map((r) => `${r.sectionId}: ${r.error}`) };
    };
    let { out: made, errors } = await genFor(target, 0);
    await verifyScenes(mods, made, productImages, dir, job);
    // 검수 실패 섹션은 1회 다시(실패 사유를 요청문으로)
    const passN = (id) => made.filter((m) => m.section === id && m.pass).length;
    const failedSecs = target.filter((x) => passN(x.id) < (x.type === "versatility" ? 4 : x.type === "detail" ? 2 : 1)); // 활용 4·디테일 2 를 다 못 채우면 그 섹션 다시
    if (failedSecs.length && !job.cancelled) {
      const retry = failedSecs.map((x) => { const why = made.find((m) => m.section === x.id)?.note || ""; return { ...x, shot: { ...x.shot, needs: `${x.shot.needs || ""} · 앞 시도 문제: ${why} — 입력 사진의 제품과 모양·개수를 정확히 똑같이, 배경 가전·모니터·포장에도 글자·로고·라벨 없이 민무늬로` } }; });
      const r2 = await genFor(retry, 1); await verifyScenes(mods, r2.out, productImages, dir, job); made = [...made, ...r2.out]; errors = [...errors, ...r2.errors];
    }
    let items = made;
    if (regen?.scene && prev?.items) items = [...prev.items.filter((x) => x.section !== regen.sectionId), ...made]; // 다른 섹션은 그대로
    if (regen?.fill && prev?.items) { const redo = new Set(target.map((x) => x.id)); const forced = new Set(target.filter((x) => (regen.force || []).includes(x.id) || (regen.force || []).includes(x.type)).map((x) => x.id)); const newFiles = new Set(made.map((m) => m.file));
      items = [...prev.items.filter((x) => !newFiles.has(x.file) && !forced.has(x.section) && (!redo.has(x.section) || (x.pass && !(regen.dupSections || []).includes(x.section)))), ...made]; } // 강제 재생성 섹션은 옛 장면을 버린다
    const scene = { provider: prov.provider, model: prov.model, items, inputs: productImages.map((f) => path.relative(dir, f)), ms: Date.now() - t0s, createdAt: Date.now(), errors };
    writeJson(path.join(dir, "scene.json"), scene); how.scene = "scene-v5";
    log("go", `■ 섹션 장면 ${made.length}장 · 통과 ${made.filter((x) => x.pass).length} · ${((Date.now() - t0s) / 1000).toFixed(0)}초`);
    return scene;
  }

  // 같은 사진이 페이지에 2번 이상(파일이 달라도 거의 같은 그림) → 뒤 섹션에서 빼고 plan.duplicatesVisual 에 기록. 지각 해시(9×8 dHash) 해밍 거리 ≤ 6
  function dhashOf(file) { try { const im = nativeImage.createFromPath(file); if (im.isEmpty()) return null; const b = im.resize({ width: 9, height: 8, quality: "good" }).toBitmap(); let bits = ""; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (y * 9 + x) * 4, j = (y * 9 + x + 1) * 4; const g1 = b[i] + b[i + 1] + b[i + 2], g2 = b[j] + b[j + 1] + b[j + 2]; bits += g1 > g2 ? "1" : "0"; } return bits; } catch { return null; } }
  const ham = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  // 활용(4장면)·디테일(2컷) 섹션: 검수 통과한 그 섹션 장면들을 항목 사진으로(구성은 사진 1장만 넣는 경우가 있다)
  function fillItemScenes(plan, scene) {
    const ok = (id) => [...new Set((scene?.items || []).filter((x) => x.section === id && x.pass && x.human !== "reject").map((x) => x.file))];
    for (const sec of plan.sections) {
      if (Array.isArray(sec.images)) sec.images = [...new Set(sec.images)];
      if (Array.isArray(sec.items)) { const used = new Set(); sec.items.forEach((it) => { if (it?.image) { if (used.has(it.image)) it.image = null; else used.add(it.image); } }); }
      if (!["versatility", "detail"].includes(sec.type) || !Array.isArray(sec.items)) continue;
      const files = ok(sec.id); if (!files.length) continue;
      if (sec.type === "versatility") { // 파일 이름의 장소 번호(…-versatility-K-n.png)대로 — 라벨과 장면 장소가 맞게
        const byPlace = {}; files.forEach((f) => { const k = Number((path.basename(f).match(/versatility-(\d+)-/) || [])[1]); if (k && !byPlace[k]) byPlace[k] = f; });
        sec.items.forEach((it, i) => { if (it && typeof it === "object") it.image = byPlace[i + 1] || null; });
        if (sec.image && !Object.values(byPlace).includes(sec.image)) sec.image = byPlace[1] || sec.image;
        continue;
      }
      sec.items.forEach((it, i) => { if (it && typeof it === "object" && !it.image && files[i]) it.image = files[i]; });
      if (sec.type === "detail" && (!sec.images || sec.images.length < files.length)) sec.images = files.slice(0, 2);
    }
  }
  function dedupeVisual(plan, dir) {
    const seen = [], dups = [];
    const check = (sec, f, drop) => { if (seen.some((x) => x.file === f && x.section === sec.id)) return true; /* 같은 섹션이 같은 파일을 사진·항목으로 두 번 가리키는 건 중복 아님 */ const h = dhashOf(path.join(dir, f)); if (!h) return true; const hit = seen.find((x) => ham(x.h, h) <= 6 && !(x.file === f && x.section === sec.id)); if (hit) { dups.push({ section: sec.id, type: sec.type, file: f, same: hit.file, sameSection: hit.section }); drop(); return false; } seen.push({ h, file: f, section: sec.id }); return true; };
    for (const sec of plan.sections) {
      if (sec.image) check(sec, sec.image, () => { delete sec.image; if (!sec.images?.length) sec.textOnly = true; });
      if (Array.isArray(sec.images)) sec.images = sec.images.filter((f) => check(sec, f, () => {}));
      if (Array.isArray(sec.items)) sec.items.forEach((it) => { if (it?.image) check(sec, it.image, () => { it.image = null; }); });
    }
    plan.duplicatesVisual = dups;
    if (dups.length) log("warn", `△ 📄 같은 사진 ${dups.length}건(페이지에서 2번 이상) → 뒤 섹션에서 뺌 · ${dups.map((d) => `${d.type}:${path.basename(d.file)}≈${path.basename(d.same)}`).join(", ")}`);
    return dups;
  }

  const isV5Job = (id) => { const d = jobDirOf(id); return exists(path.join(d, "sections.json")) || readJson(path.join(d, "plan.json"))?.meta?.version === 5; };

  // ---------- 렌더 내역(템플릿별 보관) ----------
  // 새 렌더 폴더 이름: 템플릿 id → 이미 있으면 id-2, id-3 …
  function allocRenderId(dir, tid) {
    const used = new Set([...(readJson(path.join(dir, "result.json"))?.renders || []).map((r) => r.id), ...(exists(path.join(dir, "out")) ? fs.readdirSync(path.join(dir, "out")).filter((f) => { try { return fs.statSync(path.join(dir, "out", f)).isDirectory(); } catch { return false; } }) : [])]);
    let id = tid, k = 1; while (used.has(id)) id = `${tid}-${++k}`;
    return id;
  }
  // 무대(.render/): 작업 폴더의 그림 폴더를 링크(윈도우는 junction)해 렌더러가 jobDir 기준 상대경로(clean/…)를 그대로 읽게 한다
  function prepareStage(dir, name = ".render") { // 뒤 검수(원본 한글화)는 ".render-qa" — 새 작업의 무대와 겹치지 않게
    const stage = path.join(dir, name); fs.mkdirSync(stage, { recursive: true });
    for (const sub of ["clean", "scene", "raw", "cutout", "localize"]) {
      const src = path.join(dir, sub), dst = path.join(stage, sub);
      if (!exists(src)) continue;
      try { const st = fs.lstatSync(dst); if (st.isSymbolicLink()) continue; fs.rmSync(dst, { recursive: true, force: true }); } catch {}
      try { fs.symlinkSync(src, dst, process.platform === "win32" ? "junction" : "dir"); } catch (e) { log("dim", `  📄 링크 실패 ${sub} → 복사 (${e?.message || e})`); fs.cpSync(src, dst, { recursive: true }); }
    }
    fs.rmSync(path.join(stage, "out"), { recursive: true, force: true });
    return stage;
  }
  // 무대 out/ → 작업 out/<id>/ 로 옮기고 결과 경로를 "out/<id>/…" 로 고친다
  function moveRender(dir, stage, rid, out) {
    const from = path.join(stage, "out"), to = path.join(dir, "out", rid);
    fs.rmSync(to, { recursive: true, force: true }); fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
    const fix = (f) => (typeof f === "string" ? f.replace(/^out\//, `out/${rid}/`) : f);
    return { ...out, slices: (out.slices || []).map((sl) => ({ ...sl, file: fix(sl.file) })), preview: fix(out.preview), html: fix(out.html), figmaManifest: fix(out.figmaManifest), figmaBundle: fix(out.figmaBundle || "out/figma-bundle.json") };
  }
  // 옛 결과(out/ 바로 아래 파일) → renders[0] (파일은 옮기지 않고 dir:"out")
  function migrateRenders(r) {
    if (!r || Array.isArray(r.renders) || !r.slices?.length) return r || {};
    const id = "out";
    return { ...r, renders: [{ id, templateId: r.templateId || "clean", createdAt: r.finishedAt || r.createdAt || 0, dir: "out", slices: r.slices, preview: r.preview, html: r.html, figmaManifest: r.figmaManifest, figmaBundle: r.figmaBundle, qa: r.qa?.score ?? null, sliceCount: r.slices.length, legacy: true }], current: id };
  }
  const renderOf = (r, rid) => (r?.renders || []).find((x) => x.id === (rid || r.current)) || (r?.renders || []).slice(-1)[0] || null;

  // ---------- 원본 한글화 앱 내 검수(뒤에서): 측정 → 걸린 장만 고치기·다시 그리기(같은 탭 갱신) → 장별 결과 ----------
  //   시간 상한 detailLocQaMaxMs(기본 3분) · 비용 상한 detailLocQaMaxUsd(기본 $0.30) — 넘으면 멈추고 남은 장은 ⚠
  const locQaRuns = new Map(); // jobId → { renderId, msg, t0 }
  let thumbHook = null; // 🖼 thumb.js initThumb 반환 { auto }
  const qaRuns = new Set(); // 뒤 검수(qaReview) 중인 jobId — 🖼 썸네일 자동 만들기가 끝나길 기다린다
  // 한글화 렌더를 같은 탭(out/<rid>)에 다시 그린다 — 새 작업 무대(.render)와 겹치지 않게 .render-qa
  async function renderLocInto(dir, plan, rid) { const stage = prepareStage(dir, ".render-qa"); const rm = await mod("render", log); try { const o = await rm.renderPlan({ plan, jobDir: stage, templateId: "localize" }); return moveRender(dir, stage, rid, o); } finally { fs.rmSync(path.join(stage, "out"), { recursive: true, force: true }); } }
  const qaPlanFile = (dir, rid) => path.join(dir, `qa-plan-${rid}.json`); // 이 렌더를 그린 plan(뒤 검수·장별 고치기가 이어서 고친다)
  async function runLocQaBg(jobId, c) {
    const dir = c.dir, t0 = Date.now();
    const sett = store.get("settings") || {}, noAi = !!process.env.SEEDHACK_DETAIL_NO_AI;
    const patchRender = (fn) => { const res = readJson(path.join(dir, "result.json")); const x = (res?.renders || []).find((r) => r.id === c.renderId); if (!x) return null; fn(x, res); writeJson(path.join(dir, "result.json"), res); return res; };
    let lastSent = 0;
    const progress = (msg) => { const r = locQaRuns.get(jobId); if (r) r.msg = msg; if (Date.now() - lastSent < 400) return; lastSent = Date.now(); send("detail:changed", { locQa: { jobId, renderId: c.renderId, status: "running", msg } }); };
    locQaRuns.set(jobId, { renderId: c.renderId, msg: "🔍 검수 중…", t0 });
    patchRender((x) => { x.locQa = { status: "running", startedAt: t0 }; x.planFile = c.planFile; });
    writeJson(qaPlanFile(dir, c.renderId), c.plan);
    send("detail:changed", { locQa: { jobId, renderId: c.renderId, status: "running", msg: "🔍 검수 중…" } });
    let out = null;
    try {
      const lq = await mod("loc-qa", log); if (!lq?.runLocQa) throw new Error("loc-qa.js 없음");
      const cli = noAi ? null : await mod("cli", log);
      const tl = readJson(path.join(dir, "localize.json")) || {}, ocr = readJson(path.join(dir, "ocr.json")) || {};
      const aborted = () => (cur?.jobId === jobId && (["localize", "both"].includes(cur.mode) || cur.templateId === "localize")) || !exists(path.join(dir, "out", c.renderId)); // 같은 작업을 다시 한글화하면 멈춤(빠진 장면 채우기·테마 렌더는 그대로 둠)
      out = await lq.runLocQa({ dir, renderId: c.renderId, plan: c.plan, tl, ocr, rawOf: (id) => c.raw?.[id] || null, settings: { ...sceneSettingsNow(), detailLocQaModel: sett.detailLocQaModel }, ai: !noAi, cli: cli?.cliAvailable?.() ? cli : null,
        limits: { ...(Number(sett.detailLocQaMaxMs) > 0 ? { maxMs: Number(sett.detailLocQaMaxMs) } : {}), ...(Number(sett.detailLocQaMaxUsd) >= 0 && sett.detailLocQaMaxUsd != null ? { maxUsd: Number(sett.detailLocQaMaxUsd) } : {}) },
        aborted, progress, log,
        render: async (plan) => { if (aborted()) throw new Error("새 작업이 시작돼 멈춤"); return renderLocInto(dir, plan, c.renderId); } });
      if (aborted() && !out.rendered) { log("dim", "  🔍 검수 멈춤(새 작업)"); }
      const S = out.summary, nFixed = S.fixed;
      const res = patchRender((x, res) => {
        const rr = out.rendered; if (rr) Object.assign(x, { slices: rr.slices, preview: rr.preview, html: rr.html, figmaManifest: rr.figmaManifest, figmaBundle: rr.figmaBundle || x.figmaBundle, sliceCount: rr.slices.length, sections: (rr.sections || []).map((q) => ({ type: q.type, id: q.id || null, y: q.y, h: q.h ?? null })), qaAt: Date.now() });
        if (rr && res.current === c.renderId) Object.assign(res, { slices: rr.slices, preview: rr.preview, html: rr.html });
        for (const [id, q] of Object.entries(out.sections)) { if (out.tops && id in out.tops) q.y = out.tops[id]; else if (out.tops && Object.keys(out.tops).length) delete out.sections[id]; } // 마지막으로 그린 화면 기준 위치
        x.locQa = { status: "done", ms: out.ms, costUsd: out.costUsd, limitHit: out.limitHit, checked: Object.keys(out.sections).length, flagged: Object.values(out.sections).filter((q) => !q.pass).length, fixed: nFixed, sections: out.sections, steps: out.steps.slice(0, 60), at: Date.now() };
        if (out.costUsd) { res.costs = { ...(res.costs || {}), locQa: +((res.costs?.locQa || 0) + out.costUsd).toFixed(4) }; res.costUsd = +((res.costUsd || 0) + out.costUsd).toFixed(4); }
        res.timings = { ...(res.timings || {}), locQaBackground: out.ms };
      });
      writeJson(qaPlanFile(dir, c.renderId), c.plan);
      if (out.rendered) writeJson(path.join(dir, c.planFile), c.plan); // 고친 plan(크기·열·문구) — 다음에 다시 그려도 유지
      { const tl2 = readJson(path.join(dir, "localize.json")); if (tl2) { tl2.qa = { renderId: c.renderId, at: Date.now(), sections: Object.fromEntries(Object.entries(out.sections).map(([id, s]) => [id, { pass: s.pass, issues: s.issues, tries: s.tries }])) }; writeJson(path.join(dir, "localize.json"), tl2); } }
      log("go", `■ 🔍 원본 한글화 검수 ${S.checked}장 · 고침 ${nFixed}장 · 확인 필요 ${S.flagged}장 · ${(out.ms / 1000).toFixed(0)}초 · $${out.costUsd.toFixed(3)}${out.limitHit ? ` · ${out.limitHit === "time" ? "시간" : "비용"} 상한에서 멈춤` : ""}`);
      if (res) send("detail:changed", { locQa: { jobId, renderId: c.renderId, status: "done", fixed: nFixed, flagged: S.flagged, rerendered: !!out.rendered } });
    } catch (e) {
      log("dim", `  🔍 원본 한글화 검수 오류 · ${e?.message || e}`);
      patchRender((x) => { x.locQa = { status: "failed", error: String(e?.message || e).slice(0, 120), ms: Date.now() - t0 }; });
      send("detail:changed", { locQa: { jobId, renderId: c.renderId, status: "failed" } });
    } finally { locQaRuns.delete(jobId); }
    return out;
  }

  // ---------- 원본 한글화 장별 고치기(결과 화면 오른쪽 칸 — loc-edit.js) ----------
  const locEditBusy = new Map(); // jobId → { renderId, sectionId, action, msg }
  function locPlanOf(dir, rid) {
    const res = readJson(path.join(dir, "result.json")) || {}, rd = (res.renders || []).find((x) => x.id === rid);
    if (!rd || rd.templateId !== "localize") return { error: "원본 한글화 렌더가 아닙니다" };
    const pf = rd.planFile || (rd.id === res.current && res.templateId === "localize" && !rd.label ? "plan.json" : exists(path.join(dir, "plan-localize.json")) ? "plan-localize.json" : "plan.json");
    const plan = readJson(qaPlanFile(dir, rid)) || readJson(path.join(dir, pf));
    return plan?.sections ? { res, rd, plan, planFile: pf } : { error: "이 렌더의 구성(plan)을 찾지 못했습니다" };
  }
  async function locSectionGet(jobId, renderId, sectionId) {
    const dir = jobDirOf(jobId), L = locPlanOf(dir, renderId); if (L.error) return L;
    const le = await mod("loc-edit", log); const v = le?.sectionView(L.plan, sectionId, le.loadHist(dir, renderId));
    if (!v) return { error: "그 장을 찾지 못했습니다", removed: le?.loadHist(dir, renderId).removed || [] };
    return { ...v, qa: L.rd.locQa?.sections?.[sectionId] || null, busy: locEditBusy.get(jobId) || null };
  }
  async function locSectionEdit(jobId, renderId, sectionId, action, payload) {
    if (!jobId || !renderId) return { error: "작업이 없습니다" };
    if (locEditBusy.has(jobId)) return { error: "다른 고치기가 진행 중이에요 — 끝난 뒤 눌러 주세요" };
    if (locQaRuns.has(jobId)) return { error: "자동 검수가 끝난 뒤 눌러 주세요" };
    if (cur?.jobId === jobId) return { error: "상세페이지를 만드는 중이에요 — 끝난 뒤 눌러 주세요" };
    const dir = jobDirOf(jobId), L = locPlanOf(dir, renderId); if (L.error) return L;
    const le = await mod("loc-edit", log); if (!le?.locEdit) return { error: "loc-edit.js 없음" };
    const sett = store.get("settings") || {}, noAi = !!process.env.SEEDHACK_DETAIL_NO_AI, t0 = Date.now();
    const st = { renderId, sectionId, action, msg: "시작", t0 }; locEditBusy.set(jobId, st);
    const progress = (msg) => { st.msg = msg; send("detail:changed", { locEdit: { jobId, renderId, sectionId, status: "running", msg, t0 } }); };
    progress("시작");
    try {
      const cli = noAi ? null : await mod("cli", log);
      const src = readJson(path.join(dir, "source.json")) || {};
      const rawOf = (id) => { const im = (src.images || []).find((x) => x.id === id); const f = im && [im.file, path.join(dir, "raw", path.basename(im.file || ""))].find((q) => q && exists(q)); return f || null; };
      const prevAi = Object.fromEntries(Object.entries(L.rd.locQa?.sections || {}).map(([id, q]) => [id, q.ai || null]));
      const r = await le.locEdit({ dir, renderId, plan: L.plan, tl: readJson(path.join(dir, "localize.json")) || {}, ocr: readJson(path.join(dir, "ocr.json")) || {}, rawOf, cli: cli?.cliAvailable?.() ? cli : null, ai: !noAi,
        settings: { ...sceneSettingsNow(), detailLocQaModel: sett.detailLocQaModel, detailLocEditModel: sett.detailLocEditModel }, prevAi, issues: L.rd.locQa?.sections?.[sectionId]?.issues || [], action, sectionId, payload: payload || {}, log, progress,
        rebake: async (sec, say) => { // 🖼 통째로 그린 장: 고친 문구표로 그 장만 다시 그린다(검수 포함). 통과하면 같은 파일을 바꿔 끼운다
          const bk = await import("./bake.js"), auth = await bk.bakeAuth({ settings: sceneSettingsNow() }).catch(() => null); if (!auth) throw new Error("이미지 AI 연결이 없어 다시 그릴 수 없어요");
          const file = rawOf(sec.id); if (!file) throw new Error("원본 그림을 찾지 못했어요");
          const o = ((readJson(path.join(dir, "ocr.json")) || {}).images || []).find((x) => x.id === sec.id), om = await mod("ocr", log);
          say?.("🖼 이 장을 다시 그리는 중 (30초 안팎)");
          const r = await bk.bakeImage({ file, layers: sec.bake.layers, boxes: (o?.boxes || []).filter((b) => !b.latin), w: o?.w, h: o?.h, out: path.join(dir, sec.image), auth, ocr: om?.ocrImages ? bk.makeBakeOcr(om.ocrImages, { log }) : null, log, id: sec.id });
          if (!r.ok) throw new Error(`다시 그린 그림이 검수에서 떨어졌어요(${r.why}) — 문구를 조금 바꿔 다시 눌러 주세요`);
          sec.baked = { tries: r.tries, ...(r.verdict || {}), edited: true }; if (r.size) { sec.iw = r.size.width; sec.ih = r.size.height; }
          return { costUsd: r.usd || 0 };
        },
        render: (plan) => renderLocInto(dir, plan, renderId) });
      writeJson(qaPlanFile(dir, renderId), L.plan); writeJson(path.join(dir, L.planFile), L.plan); // 다음에 다시 그려도 유지
      const res = readJson(path.join(dir, "result.json")) || {}; const x = (res.renders || []).find((q) => q.id === renderId);
      if (x) {
        const rr = r.rendered; if (rr) { Object.assign(x, { slices: rr.slices, preview: rr.preview, html: rr.html, figmaManifest: rr.figmaManifest, figmaBundle: rr.figmaBundle || x.figmaBundle, sliceCount: rr.slices.length, sections: (rr.sections || []).map((q) => ({ type: q.type, id: q.id || null, y: q.y, h: q.h ?? null })), qaAt: Date.now() }); if (res.current === renderId) Object.assign(res, { slices: rr.slices, preview: rr.preview, html: rr.html }); }
        const lq = x.locQa ||= { status: "done", sections: {} }; lq.sections ||= {};
        if (r.section) lq.sections[sectionId] = { ...r.section, edited: true, fixed: !!(r.section.pass && !(lq.sections[sectionId]?.pass)) || !!lq.sections[sectionId]?.fixed };
        else if (action === "drop") delete lq.sections[sectionId];
        if (r.tops) for (const id of Object.keys(lq.sections)) { if (id in r.tops) lq.sections[id].y = r.tops[id]; else delete lq.sections[id]; } // 다시 그리면 아래 장 위치가 바뀌고, 대표 사진에 합쳐진 장은 따로 없다 — 목록 꼬리표가 엉뚱한 장에 붙지 않게
        lq.removed = r.removed; lq.flagged = Object.values(lq.sections).filter((q) => !q.pass).length; lq.checked = Object.keys(lq.sections).length;
        lq.edits = [...(lq.edits || []), { at: Date.now(), id: sectionId, action, ms: r.ms, costUsd: r.costUsd, note: r.note }].slice(-50);
        if (r.costUsd) { res.costs = { ...(res.costs || {}), locEdit: +((res.costs?.locEdit || 0) + r.costUsd).toFixed(4) }; res.costUsd = +((res.costUsd || 0) + r.costUsd).toFixed(4); }
        writeJson(path.join(dir, "result.json"), res);
      }
      log("go", `■ ✏️ ${sectionId} ${action} · ${r.note} · ${(r.ms / 1000).toFixed(0)}초${r.costUsd ? ` · $${r.costUsd.toFixed(3)}` : ""} · ${r.section ? (r.section.pass ? "✔ 통과" : `⚠ ${r.section.why}`) : "뺌"}`);
      const out = { ok: true, note: r.note, ms: r.ms, costUsd: r.costUsd, pass: r.section ? r.section.pass : null, why: r.section?.why || "", canUndo: r.canUndo };
      send("detail:changed", { locEdit: { jobId, renderId, sectionId, status: "done", ...out } });
      return out;
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 160);
      log("warn", `△ ✏️ ${sectionId} ${action} 실패 · ${msg}`);
      send("detail:changed", { locEdit: { jobId, renderId, sectionId, status: "failed", error: msg } });
      return { error: msg };
    } finally { locEditBusy.delete(jobId); }
  }

  // ---------- 결과 뒤 작업: 백그라운드 자가 검수(제안만) · 빠진 섹션 자동 채우기(1회) ----------
  async function afterDone(job) {
    if (job.qaCtx) {
      const c = job.qaCtx; job.qaCtx = null;
      qaRuns.add(job.jobId);
      (async () => {
        const t0q = Date.now();
        try {
          const r = await qaReview({ slices: c.slices, plan: c.plan, copy: c.copy, dir: c.dir, title: c.title, evidence: c.evidence });
          if (r?.error) { log("dim", `  📄 뒤 검수 실패 · ${r.error}`); return; }
          const sugg = r.defects.map((d, i) => ({ i, ...d, action: d.fix === "rewrite" ? "rewrite" : d.fix === "drop_section" ? "drop" : "regen" }));
          const res = readJson(path.join(c.dir, "result.json")) || {};
          res.qa = { score: r.score, suggestions: sugg, remaining: sugg.length, renderId: c.renderId, ms: Date.now() - t0q, background: true, costUsd: r.costUsd ?? null };
          if (r.costUsd != null) { res.costs = { ...(res.costs || {}), qa: r.costUsd }; res.costUsd = (res.costUsd || 0) + r.costUsd; }
          if (res.timings) res.timings.qaBackground = Date.now() - t0q;
          (res.renders || []).forEach((x) => { if (x.id === c.renderId) x.qa = r.score; });
          writeJson(path.join(c.dir, "result.json"), res); writeJson(path.join(c.dir, "qa.json"), { score: r.score, defects: r.defects, background: true });
          log("go", `■ 📄 AI 검수(뒤) ${r.score}/5 · 제안 ${sugg.length}건 · ${((Date.now() - t0q) / 1000).toFixed(0)}초`);
          send("detail:changed", { count: listJobs().length, running: cur ? cur.jobId : null, qa: { jobId: job.jobId, score: r.score, n: sugg.length } });
        } catch (e) { log("dim", `  📄 뒤 검수 오류 · ${e?.message || e}`); }
      })().finally(() => qaRuns.delete(job.jobId));
    }
    if (job.locQaCtx) { const c = job.locQaCtx; job.locQaCtx = null; runLocQaBg(job.jobId, c); }
    if (job.fillLater?.length) {
      const ids = job.fillLater; job.fillLater = null;
      const tryStart = (k = 0) => { if (cur) { if (k < 120) setTimeout(() => tryStart(k + 1), 2000); return; }
        log("sys", `▶ 📄 빠진 섹션 장면을 뒤에서 채웁니다 · ${ids.join(", ")}`);
        start({ jobId: job.jobId, templateId: "card", theme: job.theme || null, reuse: true, phase: "generate", skipQa: true, bg: true, regen: { fill: true, dupSections: [], label: "빠진 장면 자동 채움" } }); };
      setTimeout(tryStart, 500);
    }
    if (!job.bg) thumbHook?.auto?.(job.jobId, { busy: () => !!cur || qaRuns.has(job.jobId) || locQaRuns.has(job.jobId) }); // 🖼 썸네일 자동(스위치 기본 켬 · 이미 있으면 안 함)
  }
  // AI 검수 제안 반영: 그 섹션 다시 만들기(장면) · 글 다시 쓰기 · 섹션 빼기
  function applySuggestion(jobId, i) {
    const dir = jobDirOf(jobId), res = readJson(path.join(dir, "result.json")) || {};
    const sg = (res.qa?.suggestions || []).find((x) => x.i === Number(i)); if (!sg) return { error: "그 제안이 없습니다" };
    const plan = readJson(path.join(dir, "plan.json")) || {}; const sec = (plan.sections || []).find((x) => x.id === sg.section) || null;
    if (!sec) return { error: `섹션(${sg.section})을 찾지 못했습니다` };
    res.qa.suggestions = res.qa.suggestions.map((x) => (x.i === sg.i ? { ...x, applied: Date.now() } : x)); writeJson(path.join(dir, "result.json"), res);
    if (sg.action === "drop") { let secs = readJson(path.join(dir, "sections.json")); if (secs && !Array.isArray(secs)) secs = secs.sections; writeJson(path.join(dir, "sections.json"), (secs || []).filter((x) => x.id !== sec.id || x.type === "hero")); return start({ jobId, templateId: "card", reuse: true, phase: "generate", skipQa: true, regen: { label: `${sec.id} 빼기(검수 제안)` } }); }
    return start({ jobId, templateId: "card", reuse: true, fresh: sg.action === "rewrite" ? ["copy"] : [], phase: "generate", skipQa: true, regen: { sectionId: sec.id, request: sg.what, scene: sg.action === "regen", rewrite: sg.action === "rewrite", label: `${sec.id} 검수 반영` } });
  }

  // 이미지 다운로더(Fatkun 등) 폴더 → DetailSource: main-*=대표, SKU-*=옵션, detail-*=상세(파일 이름 순), 그 밖 이미지는 상세 뒤에
  function importFolderLite(folder) {
    const IMG = /\.(jpe?g|png|webp|gif)$/i;
    const files = fs.readdirSync(folder).filter((f) => IMG.test(f) && !f.startsWith("."));
    const num = (f) => Number((f.match(/(\d+)/) || [])[1] || 0);
    const by = (re) => files.filter((f) => re.test(f)).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
    const main = by(/^main[-_ ]/i), sku = by(/^sku[-_ ]/i), det = by(/^detail[-_ ]/i);
    const rest = files.filter((f) => !main.includes(f) && !sku.includes(f) && !det.includes(f)).sort();
    const u = (f) => pathToFileURL(path.join(folder, f)).href;
    const name = path.basename(folder).replace(/\s*-\s*(阿里巴巴|1688|淘宝|天猫).*$/, "").trim();
    const offer = (name.match(/(\d{9,})/) || [])[1] || "";
    return { source: "1688", url: offer ? `https://detail.1688.com/offer/${offer}.html` : "", offerId: offer, title_zh: name, title_ko: /[가-힣]/.test(name) ? name : "", price: null, attrs: [],
      options: sku.map((f) => ({ label_zh: f.replace(/^sku[-_ ]*/i, "").replace(IMG, ""), img: u(f) })), gallery: main.map((f) => ({ url: u(f) })), detailImages: [...det, ...rest].map((f) => ({ url: u(f) })), detailText_zh: "", shop: null, readAt: Date.now(), importedFrom: folder };
  }

  // ---------- 작업 목록 ----------
  function listJobs() {
    const root = ROOT();
    if (!exists(root)) return [];
    const out = [];
    for (const id of fs.readdirSync(root)) {
      const dir = path.join(root, id);
      if (id === "bin" || id === "tessdata" || !fs.statSync(dir).isDirectory()) continue;
      const r = readJson(path.join(dir, "result.json"));
      const s = r ? null : readJson(path.join(dir, "source.json"));
      if (!r && !s) continue;
      const running = cur && cur.jobId === id;
      out.push({
        jobId: id, title: readJson(path.join(dir, "copy.json"))?.name_ko || r?.title || s?.title_ko || s?.title_zh || id, createdAt: r?.createdAt || s?.readAt || 0, finishedAt: r?.finishedAt || 0,
        status: running ? "running" : r?.status || "incomplete", templateId: r?.templateId || "clean", url: r?.url || s?.url || "",
        preview: r?.preview ? path.join(dir, r.preview) : "", sliceCount: r?.slices?.length || 0, renderCount: r?.renders?.length || (r?.slices?.length ? 1 : 0), imageCount: r?.counts?.images ?? s?.images?.length ?? 0, how: r?.how || null,
      });
    }
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
  }

  // ---------- 가벼운 자체 정리(extract-core 없을 때) ----------
  function liteNormalize(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    const url = String(s.url || "");
    const offerId = String(s.offerId || (url.match(/offer\/(\d+)\.html/) || [])[1] || "");
    const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
    const seen = new Set();
    const imgs = (a, n) => arr(a, n).map((x) => (typeof x === "string" ? { url: x } : x || {})).filter((x) => x.url && !/^data:/.test(x.url) && !seen.has(x.url) && seen.add(x.url));
    return {
      source: s.source || (/1688\.com/.test(url) ? "1688" : /taobao\.com/.test(url) ? "taobao" : /tmall\.com/.test(url) ? "tmall" : "other"),
      url, offerId, title_zh: String(s.title_zh || s.title || "").slice(0, 300), title_ko: s.title_ko || "", price: s.price || null,
      attrs: arr(s.attrs, 60), options: arr(s.options, 30), gallery: imgs(s.gallery, 10), detailImages: imgs(s.detailImages, 40),
      detailText_zh: String(s.detailText_zh || "").slice(0, 20000), detailText_ko: s.detailText_ko || "", shop: s.shop || null, readAt: s.readAt || Date.now(),
      keyword: s.keyword || "", coupangName: s.coupangName || "", category: s.category || "", rowId: s.rowId ?? null, ...(Array.isArray(s.images) ? { images: s.images } : {}),
      ...(s.lang ? { lang: String(s.lang) } : {}), // "ko" = 한국 판매처(쿠팡·네이버·오늘의집) — 번역·중국어 지우기·원본 한글화 없음
    };
  }

  // ---------- 이미지 내려받기(자체) — file:// · 절대경로 · http(s) ----------
  async function fetchOne(url, session) {
    if (/^file:/.test(url)) return fs.readFileSync(fileURLToPath(url));
    if (path.isAbsolute(url) && exists(url)) return fs.readFileSync(url);
    const ref = /taobao|tmall/.test(url) ? "https://item.taobao.com/" : "https://detail.1688.com/";
    const ses = session || electron.session.defaultSession;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await ses.fetch(url, { headers: { Referer: ref, Accept: "image/webp,image/*,*/*;q=0.8" }, signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  }
  // 받은 바이트 → raw/<id>.(jpg|png) 저장. webp 등은 nativeImage로 png 변환
  function saveImage(buf, dir, id) {
    const im = nativeImage.createFromBuffer(buf);
    if (im.isEmpty()) throw new Error("그림 해석 실패");
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8, isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const ext = isJpg ? "jpg" : "png";
    const file = path.join(dir, `${id}.${ext}`);
    fs.writeFileSync(file, isJpg || isPng ? buf : im.toPNG());
    const { width: w, height: h } = im.getSize();
    return { file, w, h, bytes: fs.statSync(file).size };
  }
  async function downloadLite(source, jobDir, { session, onProgress, only }) {
    const rawDir = path.join(jobDir, "raw"); fs.mkdirSync(rawDir, { recursive: true });
    const plan = [];
    source.gallery.forEach((g, i) => plan.push({ id: `g${pad(i + 1)}`, kind: "gallery", url: g.url, w: g.w, h: g.h }));
    source.detailImages.forEach((d, i) => plan.push({ id: `d${pad(i + 1)}`, kind: "detail", url: d.url, w: d.w, h: d.h }));
    source.options.forEach((o, i) => o?.img && plan.push({ id: `o${pad(i + 1)}`, kind: "option", url: o.img }));
    const todo = only ? plan.filter(only) : plan;
    const images = []; let done = 0, ok = 0, fail = 0;
    const worker = async () => {
      for (;;) {
        const it = todo.shift(); if (!it) return;
        try { const r = await fetchOne(it.url, session); const s = saveImage(r, rawDir, it.id); images.push({ id: it.id, kind: it.kind, url: it.url, ...s }); ok++; }
        catch (e) { fail++; log("dim", `  📄 이미지 실패 ${it.id} · ${e?.message || e}`); }
        done++; onProgress?.({ done, total: plan.length, id: it.id });
      }
    };
    await Promise.all([0, 1, 2, 3].map(worker));
    images.sort((a, b) => a.id.localeCompare(b.id));
    return { images, ok, fail, total: plan.length };
  }

  // ---------- 자체 렌더(render.js 없을 때): 간단한 HTML을 숨은 창에 띄워 780px 조각으로 캡처 ----------
  async function renderLite({ plan, jobDir, onProgress }) {
    const outDir = path.join(jobDir, "out"); fs.mkdirSync(outDir, { recursive: true });
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const img = (p) => (p ? `<img src="../${esc(p)}">` : "");
    const T = { clean: ["#fff", "#111", "#16a34a"], dark: ["#0b0f14", "#f3f4f6", "#f5c451"], pop: ["#fff7ed", "#1f2937", "#f97316"] }[plan.meta?.templateId] || ["#fff", "#111", "#16a34a"];
    const sec = (s) => {
      switch (s.type) {
        case "image": return `<section data-sec="image" class="limg">${img(s.image)}${(s.layers || []).map((l) => s.iw ? `<span class="ly ${esc(l.role || "")}" style="left:${(l.x / s.iw * 100).toFixed(2)}%;top:${(l.y / s.ih * 100).toFixed(2)}%;width:${(l.w / s.iw * 100).toFixed(2)}%;font-size:${Math.max(14, Math.min(44, Math.round(l.h * 780 / s.iw * 0.78)))}px">${esc(l.ko)}</span>` : "").join("")}</section>`;
        case "hero": return `<section data-sec="hero" class="hero">${img(s.image)}<h1>${esc(s.headline || s.name || "")}</h1><p>${esc(s.sub)}</p><div class="badges">${(s.badges || []).map((b) => `<span>${esc(b)}</span>`).join("")}</div></section>`;
        case "pain": case "notice": case "package": return s.items?.length ? `<section data-sec="${s.type}"><h2>${esc(s.title || { notice: "구매 전 확인해 주세요", package: "구성품" }[s.type])}</h2><ul>${s.items.map((i) => `<li>${esc(typeof i === "string" ? i : `${i.icon || ""} ${i.text || ""}`)}</li>`).join("")}</ul></section>` : "";
        case "usp": return s.items?.length ? `<section data-sec="usp"><h2>${esc(s.title)}</h2>${s.items.map((i) => `<div class="usp">${img(i.image)}<h3>${esc(i.title)}</h3><p>${esc(i.desc)}</p></div>`).join("")}</section>` : "";
        case "feature": case "size": return `<section data-sec="${s.type}">${img(s.image)}${s.title ? `<h3>${esc(s.title)}</h3>` : ""}<p>${esc(s.desc || s.note || "")}</p></section>`;
        case "gallery": return s.images?.length ? `<section data-sec="gallery">${s.images.map(img).join("")}</section>` : "";
        case "spec": return s.rows?.length ? `<section data-sec="spec"><h2>제품 정보</h2><table>${s.rows.map((r) => `<tr><th>${esc(r.k)}</th><td>${esc(r.v)}</td></tr>`).join("")}</table></section>` : "";
        case "faq": return s.items?.length ? `<section data-sec="faq"><h2>자주 묻는 질문</h2>${s.items.map((i) => `<p><b>Q. ${esc(i.q)}</b><br>A. ${esc(i.a)}</p>`).join("")}</section>` : "";
        case "cta": return `<section data-sec="cta" class="cta"><h2>${esc(s.headline)}</h2><p>${esc(s.sub)}</p></section>`;
        default: return "";
      }
    };
    const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><style>
      html,body{margin:0;background:${T[0]};color:${T[1]};font:26px/1.5 "Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;width:${WIDTH}px;overflow-x:hidden}
      section{padding:48px 40px;border-bottom:1px solid rgba(128,128,128,.15)} img{display:block;width:100%;height:auto;border-radius:12px;margin:0 auto 20px}
      h1{font-size:44px;line-height:1.25;margin:16px 0 8px;word-break:keep-all} h2{font-size:36px;margin:0 0 20px;color:${T[2]}} h3{font-size:30px;margin:8px 0}
      p{margin:6px 0;font-size:26px} ul{padding-left:28px} li{margin:8px 0} .badges span{display:inline-block;margin:10px 8px 0 0;padding:8px 18px;border:2px solid ${T[2]};border-radius:99px;font-size:22px;font-weight:700}
      table{width:100%;border-collapse:collapse;font-size:24px} th,td{padding:12px 10px;border-bottom:1px solid rgba(128,128,128,.25);text-align:left;vertical-align:top} th{width:30%;color:${T[2]}}
      .limg{position:relative;padding:0}.limg img{border-radius:0;margin:0}.limg .ly{position:absolute;display:block;font-weight:700;line-height:1.2;color:#222;text-align:left;word-break:keep-all}
      .cta{text-align:center;background:${T[2]};color:#fff} .cta h2{color:#fff} .usp{margin-bottom:28px}
    </style><body>${plan.sections.map(sec).join("")}</body></html>`;
    const htmlFile = path.join(outDir, "page.html"); fs.writeFileSync(htmlFile, html);
    const win = new BrowserWindow({ show: false, width: WIDTH, height: 1000, webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false } });
    try {
      win.webContents.setAudioMuted(true);
      await win.loadFile(htmlFile);
      await sleep(300); // 이미지 디코드 대기
      const total = Math.max(100, Math.ceil(await win.webContents.executeJavaScript("document.documentElement.scrollHeight")));
      const CH = 3000; const slices = []; let y = 0, i = 0;
      while (y < total) {
        check(cur || { cancelled: false });
        const h = Math.min(CH, total - y);
        win.setContentSize(WIDTH, h);
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${y}); document.documentElement.scrollTop=${y};`);
        await sleep(120);
        const shot = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: h });
        const sz = shot.getSize();
        const fixed = sz.width === WIDTH ? shot : shot.resize({ width: WIDTH }); // 고해상도 화면이면 2배로 찍힌다 → 780으로
        const file = `out/${pad(++i)}.jpg`;
        fs.writeFileSync(path.join(jobDir, file), fixed.toJPEG(88));
        slices.push({ file, w: WIDTH, h: fixed.getSize().height, sections: [] });
        y += h;
        onProgress?.({ done: Math.min(y, total), total, id: file });
      }
      // 미리보기: 1/4 축소 한 장
      await win.webContents.setZoomFactor(0.25);
      const ph = Math.min(3000, Math.ceil(total / 4));
      win.setContentSize(Math.ceil(WIDTH / 4), ph);
      await win.webContents.executeJavaScript("window.scrollTo(0,0)");
      await sleep(150);
      const pv = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, "preview.png"), (pv.getSize().width === Math.ceil(WIDTH / 4) ? pv : pv.resize({ width: Math.ceil(WIDTH / 4) })).toPNG());
      // 피그마 묶음: 레이어 이름 → 값, 이미지는 base64
      const sections = plan.sections.map((s) => {
        const layers = {};
        const put = (k, v) => { if (v != null && v !== "") layers[`#${s.type}.${k}`] = v; };
        put("image", s.image); put("headline", s.headline); put("sub", s.sub); put("title", s.title); put("desc", s.desc); put("note", s.note);
        (s.badges || []).forEach((b, i) => put(`badge${i + 1}`, b));
        (s.items || []).forEach((it, i) => { if (typeof it === "string") put(`item${i + 1}`, it); else { put(`item${i + 1}.title`, it.title || it.q); put(`item${i + 1}.desc`, it.desc || it.a || it.text); put(`item${i + 1}.image`, it.image); } });
        (s.images || []).forEach((im, i) => put(`image${i + 1}`, im));
        (s.rows || []).forEach((r, i) => { put(`row${i + 1}.k`, r.k); put(`row${i + 1}.v`, r.v); });
        return { type: s.type, layers };
      });
      const assets = [...new Set(sections.flatMap((s) => Object.values(s.layers)).filter((v) => /^clean\//.test(String(v))))];
      const manifest = { template: plan.meta?.templateId || "clean", width: WIDTH, sections, assets };
      writeJson(path.join(outDir, "figma-manifest.json"), manifest);
      const images = {};
      for (const a of assets) { const f = path.join(jobDir, a); if (exists(f)) images[a] = `data:image/${/\.jpe?g$/i.test(a) ? "jpeg" : "png"};base64,${fs.readFileSync(f).toString("base64")}`; }
      writeJson(path.join(outDir, "figma-bundle.json"), { ...manifest, images });
      return { slices, preview: "out/preview.png", html: "out/page.html", figmaManifest: "out/figma-manifest.json", figmaBundle: "out/figma-bundle.json" };
    } finally { try { win.destroy(); } catch {} }
  }

  // ---------- 파이프라인 ----------
  async function pipeline(job, { source, reuse, fresh = [] }) {
    // v4 2단계 흐름: job.phase = "prepare"(1단계: 수집·분석·기획 → "상품 정보 확인"에서 멈춤) | "generate"(2단계: 사람이 고친 info.json 으로 생성) | undefined(한 번에 끝까지)
    const { dir } = job; fs.mkdirSync(dir, { recursive: true });
    const mods = { core: await mod("extract-core", log), extract: await mod("extract", log), ocr: await mod("ocr", log), image: await mod("image", log), copy: await mod("copy", log), planCore: await mod("plan-core", log), render: await mod("render", log), vision: await mod("vision", log), cutout: await mod("cutout", log), brief: await mod("brief", log), cli: await mod("cli", log), scene: await mod("scene", log), scenePrompt: await mod("scene-prompt", log), localize: await mod("localize", log), reference: await mod("reference", log), referenceCore: await mod("reference-core", log) };
    job.costs = {};
    let relay = null; try { relay = await import("./relay.js"); relay.setRelayJob(job.jobId); relay.clearRelayNotice(); } catch {} // 서버 AI: 하루 상세페이지 수는 작업 ID 로 센다
    // 🚦 사전 점검: OCR·글 AI·이미지 AI 가 실제로 되는지 — 안 되면 만들기 전에 멈춘다(조용한 대체 금지, preflight.js)
    job.aiFails = []; job.ocrUse = null;
    const aiRun = !process.env.SEEDHACK_DETAIL_NO_AI && !job.regen && (!reuse || fresh.length > 0 || !!job.phase);
    if (aiRun) {
      const srcLang = (source || readJson(path.join(dir, "source.json")) || {}).lang;
      const hasOcr = reuse && !fresh.includes("ocr") && exists(path.join(dir, "ocr.json"));
      const pf = await (await import("./preflight.js")).checkReadiness({ needOcr: srcLang !== "ko" && !hasOcr, needText: true, needImage: job.phase === "prepare" || ["localize", "both", "scene"].includes(job.mode), settings: { ...(store.get("settings") || {}), ...sceneSettingsNow() } });
      job.ocrUse = pf.ocrUse || null;
      if (!pf.ok) { const e = new Error(`${pf.headline} — ${pf.problems.map((x) => x.msg).join(" · ")}`); e.preflight = { headline: pf.headline, problems: pf.problems, fix: pf.fix, tesseractOk: pf.tesseractOk }; throw e; }
      job.gpt = (store.get("settings") || {}).detailBakeEngine === "codex" && !!codexBin(); job.gptT0 = Date.now();
      if (job.gpt) { clearCodexLimit(); const pg = await codexPing(codexBin()); if (!pg.ok) throw new Error(`GPT 로 만들 수 없어요 — ${pg.why}. 그때 다시 만들거나, 아래 '만드는 AI'를 구글로 바꿔 주세요`); log("dim", "  🧪 만드는 AI: GPT(이 컴퓨터의 ChatGPT 로그인)"); }
      if (job.ocrUse === "tesseract") log("warn", "△ 📄 글자 읽기는 낮은 품질 OCR(tesseract)로 진행해요 — 중국어·세로쓰기를 놓칠 수 있어요");
    }
    { const st0 = store.get("settings") || {}; try { job.sceneOn = !!(mods.scene?.resolveProvider && mods.scene.resolveProvider({ settings: { geminiKey: st0.geminiKey || "", openaiKey: st0.openaiKey || "", geminiImageModel: st0.geminiImageModel || "" } })?.key); } catch { job.sceneOn = false; } }
    const how = {}; // 단계별 실제/대체 기록
    const t0 = Date.now();

    // ① 추출(정리)
    check(job);
    let src = reuse ? readJson(path.join(dir, "source.json")) : null;
    if (!src) {
      emit(job, "extract", "상품 정보를 정리하는 중", null, 0.2);
      src = source;
      how.extract = reuse ? "reuse" : source?._raw ? (mods.core?.normalizeSource ? "extract-core" : "lite") : "given";
      if (source?._raw) { const { _raw, ...raw } = source; src = mods.core?.normalizeSource ? mods.core.normalizeSource(raw) : liteNormalize(raw); }
      src = { ...liteNormalize(src), ...(src.images ? { images: src.images } : {}) };
      writeJson(path.join(dir, "source.json"), src);
    } else how.extract = "reuse";
    // 작업 제목: 판매자 이름(shop.name)은 쓰지 않는다 — 1688 화면에서 상품명 대신 상호가 title 로 읽히는 경우가 있다(copy.name_ko 가 나오면 그걸로 바꾼다)
    const notShop = (t) => { const v = String(t || "").trim(); return v && v !== String(src.shop?.name || "").trim() ? v : ""; };
    job.title = notShop(src.title_ko) || src.coupangName || notShop(src.title_zh) || job.jobId;
    emit(job, "extract", `✔ 상품 정보 · ${job.title.slice(0, 40)} · 대표 ${src.gallery.length}장 · 상세 ${src.detailImages.length}장 · 속성 ${src.attrs.length}개`, { gallery: src.gallery.length, detail: src.detailImages.length, options: src.options.length, title: job.title }, 1);

    // ② 내려받기
    check(job);
    let images = Array.isArray(src.images) ? src.images.filter((im) => im?.file && exists(im.file)) : [];
    const files = () => images.map((im) => ({ id: im.id, kind: im.kind, file: im.file, w: im.w, h: im.h }));
    if (reuse && images.length) { how.download = "reuse"; emit(job, "download", `✔ 이미지 ${images.length}장 재사용`, { done: images.length, total: images.length, files: files() }, 1); }
    else {
      emit(job, "download", "이미지를 내려받는 중", { done: 0, total: src.gallery.length + src.detailImages.length }, 0);
      const session = isKoSite(src.source) ? (await import("./site-read.js")).webSession() : getCnSession?.() || electron.session.defaultSession; // 한국 판매처: 숨은 창과 같은 세션(UA·Referer)
      const onProgress = ({ done, total, id }) => emit(job, "download", `↓ ${id} 받음 (${done}/${total}장)`, { done, total, id }, total ? done / total : 0);
      const isLocal = (u) => /^file:/.test(String(u)) || path.isAbsolute(String(u));
      const hasRemote = [...src.gallery, ...src.detailImages].some((x) => !isLocal(x.url));
      const useA1 = !!mods.extract?.downloadImages; // A1 은 file:// 도 읽고 webp/gif 는 숨은 창으로 png 변환 — 있으면 항상 A1
      if (useA1) {
        try { await mods.extract.downloadImages(src, dir, { session, onProgress, kinds: "v1" }); /* index.js·plan-core 는 gallery/option/detail 이름을 쓴다 */ images = Array.isArray(src.images) ? src.images : []; how.download = "extract"; }
        catch (e) { log("dim", `  📄 downloadImages 실패 → 자체 내려받기 (${e?.message || e})`); images = []; }
      }
      if (!images.length) {
        const r = await downloadLite(src, dir, { session, onProgress });
        images = r.images; how.download = useA1 ? "lite" : how.download || "lite";
      }
      // file:// 로만 된 fixture 등은 A1 결과에 빠질 수 있다 → 빠진 것만 자체로 보충
      const got = new Set(images.map((x) => x.url));
      const missing = [...src.gallery, ...src.detailImages].filter((x) => isLocal(x.url) && !got.has(x.url));
      if (missing.length) { const r = await downloadLite(src, dir, { session, onProgress, only: (it) => isLocal(it.url) && !got.has(it.url) }); images = [...images, ...r.images].sort((a, b) => a.id.localeCompare(b.id)); }
      src.images = images.map((im) => ({ ...im, file: path.isAbsolute(im.file) ? im.file : path.join(dir, im.file) }));
      images = src.images;
      // 🛍 타오바오 참고 사진(userData/taobao-reviews/<id>/) 을 재료로 합친다 — 참고용·기본 제외(확인 화면에서 켜서 씀), 옵션·사이즈 섹션엔 안 들어감
      if (mods.extract?.mergeTaobaoPhotos) { try { const r = await mods.extract.mergeTaobaoPhotos(src, dir, { root: path.join(app.getPath("userData"), "taobao-reviews"), info: readJson(path.join(dir, "info.json")) || {}, log: (t) => log("dim", `  🛍 ${t}`), kinds: "v1" }); if (r?.added) { images = src.images; emit(job, "download", `🛍 타오바오 참고 사진 ${r.added}장 합침 — 기본 제외, 확인 화면에서 켜서 씀`, null, 1); } } catch (e) { log("dim", `  🛍 타오바오 사진 합치기 실패 (${e?.message || e})`); } }
      writeJson(path.join(dir, "source.json"), src);
      if (!images.length) throw new Error("이미지를 한 장도 받지 못했습니다 — 1688 화면이 열려 있는지, 상품 페이지가 맞는지 확인해 주세요");
      emit(job, "download", `✔ 이미지 ${images.length}장 받음`, { done: images.length, total: images.length, files: files() }, 1);
    }

    // ③ OCR
    check(job);
    let ocr = reuse ? readJson(path.join(dir, "ocr.json")) : null;
    if (ocr) { how.ocr = "reuse"; emit(job, "ocr", `✔ OCR 결과 재사용 (${ocr.provider})`, { done: images.length, total: images.length }, 1); }
    else {
      emit(job, "ocr", src.lang === "ko" ? "이미지 속 한글을 읽는 중 (지우지 않고 정보로만 씀)" : "이미지 속 중국어 글자를 찾는 중", { done: 0, total: images.length }, 0);
      var ocrFailed = 0, ocrErr = null; // eslint-disable-line no-var
      if (mods.ocr?.ocrImages) {
        try {
          // 6장씩(A2 Vision 묶음 크기와 같음) 돌려 묶음이 끝날 때마다 이미지별 실제 상자 개수로 진행 표시
          const CH = 6;
          for (let i = 0; i < images.length; i += CH) {
            check(job);
            const r = await mods.ocr.ocrImages(images.slice(i, i + CH), { onProgress: () => {}, log, ...(src.lang === "ko" ? { langs: "ko-KR,en-US" } : {}), ...(job.ocrUse ? { provider: job.ocrUse } : {}) });
            if (!ocr) ocr = { provider: r?.provider || "none", images: [] };
            ocrFailed += r?.failed || 0; if (r?.error) ocrErr = r.error;
            if (src.lang !== "ko" && r?.provider === "vision") { try { const { augmentOcr } = await import("./ocr-plus.js"); for (const [k, o] of (r.images || []).entries()) { const im = images[i + k]; if (im?.file) o.boxes = (await augmentOcr({ file: im.file, boxes: o.boxes || [], log })).boxes; } } catch (e) { log("dim", `  🔎 OCR 보강 건너뜀 (${e?.message || e})`); } } // v13.2 큰 숫자 배지 안 작은 한자 · 세로쓰기 글을 한 번 더 읽음
            (r?.images || []).forEach((o, k) => { ocr.images.push(o); const n = i + k + 1, nb = o.boxes?.length || 0; emit(job, "ocr", `字 ${o.id} · 글자 상자 ${nb}개 (${n}/${images.length})`, { done: n, total: images.length, id: o.id, boxes: nb }, n / images.length); });
          }
          how.ocr = ocr?.provider || "ocr";
        } catch (e) { log("warn", `△ 📄 OCR 실패 → 글자 상자 없이 진행 (${e?.message || e})`); ocr = null; }
      }
      if (!ocr) {
        ocr = { provider: "none", images: images.map((im) => ({ id: im.id, w: im.w, h: im.h, boxes: [] })) }; how.ocr = how.ocr || "none";
        for (let i = 0; i < images.length; i++) { emit(job, "ocr", `字 ${images[i].id} · OCR 없음 → 상자 0개 (${i + 1}/${images.length})`, { done: i + 1, total: images.length, id: images[i].id, boxes: 0 }, (i + 1) / images.length); }
      }
      if (src.lang !== "ko" && ["vision", "gcv", "gcv-direct"].includes(ocr.provider)) { try { const { augmentSeams } = await import("./ocr-plus.js"); await augmentSeams(ocr.images.map((o) => ({ id: o.id, file: images.find((im) => im.id === o.id)?.file, boxes: o.boxes || (o.boxes = []) })), { log }); } catch {} } // v13.2 이미지 경계에 걸친 글
      const nb = ocr.images.reduce((n, x) => n + (x.boxes?.length || 0), 0);
      { // 🚦 OCR 이 대부분 실패했거나(서버·구글) 글자를 하나도 못 찾았으면 결과를 만들지 않고 멈춘다 — 중국어가 그대로 남은 "완성"을 막는다
        const bad = (await import("./preflight.js")).judgeOcr({ total: images.length, failed: ocrFailed, boxes: nb, lang: src.lang, remote: ["gcv", "gcv-direct", "none", "server", "google"].includes(ocr.provider) });
        if (bad) { const gcm = await import("./google-conn.js"); const e = new Error(`${bad}${ocrErr ? ` — ${ocrErr}` : ""}`); e.preflight = { headline: "글자 읽기(OCR)에 실패해서 멈췄어요", problems: [{ what: "ocr", msg: bad }], fix: gcm.googleConnected() ? "wait" : "google", tesseractOk: mods.ocr?.hasTesseract?.() && job.ocrUse !== "tesseract" }; throw e; }
      }
      writeJson(path.join(dir, "ocr.json"), ocr);
      emit(job, "ocr", `✔ 글자 상자 ${nb}개 (${ocr.provider})`, { done: images.length, total: images.length, boxes: nb }, 1);
    }

    // ④ 지우기
    check(job);
    const cleanDir = path.join(dir, "clean"); fs.mkdirSync(cleanDir, { recursive: true });
    let cleaned = reuse ? readJson(path.join(dir, "clean.json")) : null;
    if (cleaned?.length && cleaned.every((c) => exists(path.join(dir, c.file)))) { how.clean = "reuse"; emit(job, "clean", `✔ 지운 이미지 ${cleaned.length}장 재사용`, { done: cleaned.length, total: cleaned.length }, 1); }
    else {
      // 재설계(2026-10-09 아침): 글자를 "지운" 그림은 빈 벽·얼룩이 남아 쓸 수 없었다 → 글자 없는 제품 사진 영역만 잘라낸(cropPhoto) 그림을 섹션에 쓴다.
      //  (a) 상자 0개 → 그대로 = 사진 전체  (b) 상자 있음 → cropPhoto(사진 영역) 를 clean/<id>.png 에, 기존 지우기 경로 결과는 clean/<id>_full.png(폴백·갤러리용)
      //  cropPhoto 가 ok=false(글자만 있는 이미지) 면 rec.photo=null — plan-core 는 photo 가 있는 그림만 섹션에 쓴다. image.js 에 cropPhoto 가 없으면 예전 경로 그대로.
      const hasCrop = typeof mods.image?.cropPhoto === "function";
      emit(job, "clean", hasCrop ? "글자 없는 제품 사진 영역을 잘라내는 중" : "중국어 글자를 배경색으로 지우는 중", { done: 0, total: images.length }, 0);
      cleaned = []; let erasedAll = 0, photoN = 0, textOnlyN = 0;
      const copyPng = (from, to) => { const ni = nativeImage.createFromPath(from); if (ni.isEmpty()) fs.copyFileSync(from, to); else fs.writeFileSync(to, ni.toPNG()); };
      const fullRect = (w, h) => ({ rect: { x: 0, y: 0, w, h }, bandCut: false, blank: false, contentRatio: null });
      // 기존 경로: 지우기 → 사진 위 글자 띠 자르기 → 가장자리 여백 자르기 → outFile. 반환 { w,h,erased,kept,boxesOut,trim }
      const cleanFull = async (im, boxes, outFile) => {
        const r = await mods.image.cleanImage({ file: im.file, boxes, out: outFile });
        const full = { w: r.w || im.w, h: r.h || im.h, erased: r.erased || 0, kept: r.kept || 0, boxesOut: r.boxesOut || [], trim: null };
        try {
          let bandCut = false, boxesOut = full.boxesOut;
          if (full.kept && mods.image.cropTextBand) { const b = mods.image.cropTextBand(outFile, boxesOut, outFile); if (b.bandCut) { bandCut = true; boxesOut = b.boxesOut; full.w = b.w; full.h = b.h; } }
          let rect = { x: 0, y: 0, w: full.w, h: full.h }, t = null;
          if (mods.image.autoTrim) { t = mods.image.autoTrim(outFile, outFile); if (t.trimmed) { rect = t.rect; boxesOut = mods.image.shiftBoxes(boxesOut, rect); full.w = t.w; full.h = t.h; } }
          full.boxesOut = boxesOut; full.kept = boxesOut.filter((x) => x.action === "kept").length;
          full.trim = { rect, bandCut, blank: !!t?.blank, contentRatio: Number.isFinite(t?.contentRatio) ? t.contentRatio : null };
        } catch (e) { log("dim", `  📄 여백 자르기 실패 ${im.id} → 지운 그대로 (${e?.message || e})`); }
        full.trim ??= fullRect(full.w, full.h);
        return full;
      };
      for (let i = 0; i < images.length; i++) {
        check(job);
        const im = images[i], o = ocr.images.find((x) => x.id === im.id), boxes = src.lang === "ko" ? [] : o?.boxes || []; // 한국 판매처: 한글은 지우지 않는다(사진 전체 → 사진 검수가 글 많은 그림을 거름)
        const rel = `clean/${im.id}.png`, relFull = `clean/${im.id}_full.png`, out = path.join(dir, rel), outFull = path.join(dir, relFull);
        let rec = null, msg = "";
        if (!boxes.length) { // (a) 글자 없음 → 사진 전체
          copyPng(im.file, out);
          rec = { id: im.id, kind: im.kind, file: rel, out: rel, w: im.w, h: im.h, erased: 0, kept: 0, boxesOut: [], trim: fullRect(im.w, im.h), photo: { file: rel, w: im.w, h: im.h, rect: { x: 0, y: 0, w: im.w, h: im.h }, contentRatio: null }, full: null };
          photoN++; msg = `🖼 ${im.id} · 글자 없음 → 사진 그대로 ${im.w}×${im.h}`;
        } else if (mods.image?.cleanImage) { // (b) 글자 있음
          let full = null, photo = null, residual = [], c = null;
          try { full = await cleanFull(im, boxes, hasCrop ? outFull : out); how.clean = how.clean || "image"; }
          catch (e) { log("dim", `  📄 cleanImage 실패 ${im.id} → 원본 복사 (${e?.message || e})`); }
          if (hasCrop) {
            try {
              // A2 확정 API: cropPhoto(file, boxes, out, { minH }) → { ok, w, h, rect, coverage, contentRatio, texture, residual(안에서 지운 상자 수 | 못 지워 남긴 상자 목록), cutTop, cutBottom, product:{ frac } }
              // minH 220: 기본 260 이면 d05·d20 같은 쓸 만한 사진이 걸러진다 — 최종 판정은 사진 검수(vision)가 한다
              c = await mods.image.cropPhoto(im.file, boxes, out, { minH: 220 });
              if (c?.ok) {
                // coverage: 크롭 면적비와 "상품 칸을 담은 비율(product.share)" 중 큰 쪽 — 상품에 딱 맞게 자른 크롭은 면적비가 작아도 갤러리·hero 에 쓸 수 있게
                photo = { file: rel, w: c.w, h: c.h, rect: c.rect, contentRatio: Number.isFinite(c.contentRatio) ? c.contentRatio : null, coverage: Math.max(c.coverage ?? 0, c.product?.share ?? 0) || null, areaCoverage: c.coverage ?? null, texture: c.texture ?? null, residual: Array.isArray(c.residual) ? c.residual.length : c.residual ?? 0, cutTop: c.cutTop ?? 0, cutBottom: c.cutBottom ?? 0, product: c.product?.frac ?? null };
                residual = Array.isArray(c.residual) ? c.residual.map((b) => ({ ...b, action: "kept", onPhoto: true })) : []; // 숫자(지운 개수)면 사진 안에 남은 상자는 없다. 목록이면 무늬 배경이라 못 지운 상자(원본 좌표) → 한글 띠로 덮는다
              }
            } catch (e) { log("dim", `  📄 cropPhoto 실패 ${im.id} → 지운 그림 사용 (${e?.message || e})`); }
            // 글자 없는 영역을 못 잘랐지만 상품이 분명히 있는 그림(상품 셀 ≥ 10%: 글자 밑에 깔렸거나 너무 납작한 띠) → 자르지 말고 지운 전체본을 사진으로 쓴다.
            //   단 글자를 전부 지운 그림만(kept 0) — 무늬 벽이라 못 지운 글자가 남은 전체본은 벽과 한글 띠뿐이라 쓰지 않는다(사진 없음으로 둔다).
            //   coverage 에 상품 셀 비율을 넣어 plan-core 가 gallery·hero·usp(벽만 보이는 칸)에는 안 쓰고 feature 에만 쓰게 한다.
            if (!photo && full && full.kept === 0 && Number(c?.product?.frac) >= 0.1) {
              photo = { file: relFull, w: full.w, h: full.h, rect: { x: 0, y: 0, w: full.w, h: full.h }, contentRatio: full.trim?.contentRatio ?? null, coverage: c.product.frac, texture: null, residual: 0, cutTop: 0, cutBottom: 0, product: c.product.frac, fallback: "full" };
              residual = [];
            }
          }
          if (!full) { copyPng(im.file, hasCrop ? outFull : out); full = { w: im.w, h: im.h, erased: 0, kept: boxes.length, boxesOut: boxes.map((b) => ({ ...b, action: "kept", onPhoto: false })), trim: fullRect(im.w, im.h) }; }
          const mainRel = photo ? photo.file : hasCrop ? relFull : rel, main = photo || full; // out/file: 사진이 있으면 사진(잘라낸 것 또는 전체본), 없으면 지운 전체(_full)
          rec = { id: im.id, kind: im.kind, file: mainRel, out: mainRel, w: main.w, h: main.h, erased: full.erased, kept: photo ? residual.length : full.kept, boxesOut: photo ? residual : full.boxesOut, trim: full.trim,
            photo: hasCrop ? photo : null, full: hasCrop ? { file: relFull, w: full.w, h: full.h, erased: full.erased, kept: full.kept, boxesOut: full.boxesOut, trim: full.trim } : null };
          if (photo?.fallback) { photoN++; msg = `🖼 ${im.id} · 글자 없는 영역이 없어 전체본 사용 ${photo.w}×${photo.h} (상품 ${Math.round(photo.coverage * 100)}%)`; }
          else if (photo) { photoN++; msg = `🖼 ${im.id} · 사진 영역 잘라냄 ${photo.w}×${photo.h}`; }
          else if (hasCrop) { textOnlyN++; msg = `✂ ${im.id} · 글자만 있는 이미지(사진 없음)`; }
          else msg = `🧹 ${im.id} · 지움 ${rec.erased} · 남김 ${rec.kept}`;
        } else { // image.js 없음 → 원본 복사(대체 동작)
          copyPng(im.file, out);
          rec = { id: im.id, kind: im.kind, file: rel, out: rel, w: im.w, h: im.h, erased: 0, kept: boxes.length, boxesOut: boxes.map((b) => ({ ...b, action: "kept", onPhoto: false })), trim: fullRect(im.w, im.h), photo: null, full: null };
          how.clean = "copy"; msg = `🧹 ${im.id} · 지우기 모듈 없음 → 원본 복사`;
        }
        erasedAll += rec.erased;
        cleaned.push(rec);
        emit(job, "clean", `${msg} (${i + 1}/${images.length})`, { done: i + 1, total: images.length, id: im.id, erased: rec.erased, kept: rec.kept, photo: !!rec.photo, thumb: path.join(dir, rec.out) }, (i + 1) / images.length);
      }
      how.clean = how.clean || "copy";
      writeJson(path.join(dir, "clean.json"), cleanedForSave(cleaned));
      emit(job, "clean", hasCrop ? `✔ 사진 ${photoN}장 · 글자만 ${textOnlyN}장 · 글자 ${erasedAll}개 지움 (${cleaned.length}장)` : `✔ 글자 ${erasedAll}개 지움 · ${cleaned.length}장`, { done: cleaned.length, total: cleaned.length, erased: erasedAll, photo: photoN, textOnly: textOnlyN }, 1);
    }

    // ④-2 사진 검수(vision) — Claude CLI 가 사진을 직접 보고 쓸 수 있는지·무엇이 보이는지·캡션·역할을 판정(A3 vision.js). photo 가 있는 이미지만. CLI 없음/실패/AI 끔 → 건너뜀(skip)
    check(job);
    const photoItems = cleaned.filter((c) => c?.photo?.file).map((c) => ({ id: c.id, file: path.join(dir, c.photo.file), kind: c.kind, w: c.photo.w, h: c.photo.h }));
    let vision = reuse && !fresh.includes("vision") ? readJson(path.join(dir, "vision.json")) : null;
    if (vision?.items) { how.vision = "reuse"; emit(job, "vision", `✔ 사진 검수 결과 재사용 (${vision.items.length}장)`, { done: photoItems.length, total: photoItems.length }, 1); }
    else if (!photoItems.length) { vision = null; how.vision = "skip"; emit(job, "vision", "검수할 사진이 없어 건너뜀", null, 1); }
    else if (process.env.SEEDHACK_DETAIL_NO_AI) { vision = null; how.vision = "skip"; emit(job, "vision", "AI 없이 진행 — 사진 검수 생략", null, 1); }
    else if (!mods.vision?.reviewPhotos) { vision = null; how.vision = "skip"; emit(job, "vision", "사진 검수 모듈 없음 — 생략", null, 1); }
    else {
      emit(job, "vision", `AI가 사진 ${photoItems.length}장을 직접 보는 중`, { done: 0, total: photoItems.length }, 0.05);
      const tv = Date.now();
      try {
        // 속도: 16장 묶음을 동시에(Promise.all) · 모델은 설정 detailVisionModel(기본 haiku) · 장면 생성이 켜져 있으면 quick(usable/score 위주)
        const vst = store.get("settings") || {};
        const vModel = vst.detailVisionModel || process.env.SEEDHACK_VISION_MODEL || "haiku";
        const vProduct = { title_zh: src.title_zh, title_ko: src.title_ko || src.coupangName || "", keyword: src.keyword || "", coupangName: src.coupangName || "", category: src.category || "", attrs_ko: src.attrs.slice(0, 20).map((a) => `${a.k_ko || a.k_zh}: ${a.v_ko || a.v_zh}`) };
        const VB = Number(vst.detailVisionBatch || 8); const chunks = []; for (let i = 0; i < photoItems.length; i += VB) chunks.push(photoItems.slice(i, i + VB)); // 8장씩 동시(실측 16장 묶음 ≈109초 → 묶음을 작게)
        let vDone = 0;
        const parts = await Promise.all(chunks.map((part) => mods.vision.reviewPhotos({ items: part, product: vProduct, log, model: vModel, quick: !!job.sceneOn, onProgress: () => {} })
          .then((x) => { vDone += part.length; emit(job, "vision", `👁 사진 ${vDone}/${photoItems.length}장 검수됨 (${vModel} · ${chunks.length}묶음 동시)`, { done: vDone, total: photoItems.length }, Math.min(0.95, vDone / photoItems.length)); return x; })));
        const r = { ok: parts.some((x) => x?.ok), items: parts.flatMap((x) => x?.items || []), costUsd: parts.reduce((n, x) => n + (Number(x?.costUsd) || 0), 0), error: parts.find((x) => x?.error)?.error || null, how: `cli:${vModel}` };
        if (r?.ok && Array.isArray(r.items)) {
          vision = { items: r.items, costUsd: r.costUsd ?? null, model: r.model || null, ms: Date.now() - tv, createdAt: Date.now() };
          how.vision = r.how || "cli"; if (r.costUsd != null) { job.costs.vision = r.costUsd; job.costUsd = (job.costUsd || 0) + r.costUsd; }
          writeJson(path.join(dir, "vision.json"), vision);
          const usable = r.items.filter((x) => x.usable).length;
          emit(job, "vision", `✔ 사진 검수 · 쓸 수 있음 ${usable}/${r.items.length}장 · 글자 ${r.items.filter((x) => x.has_text).length} · 로고 ${r.items.filter((x) => x.has_logo).length} · ${((Date.now() - tv) / 1000).toFixed(1)}초${r.costUsd != null ? ` · $${Number(r.costUsd).toFixed(3)}` : ""}`, { done: r.items.length, total: r.items.length, usable }, 1);
        } else { vision = null; job.aiFails.push("사진 검수"); how.vision = "skip"; log("warn", `△ 📄 사진 검수 실패 → 생략 (${r?.error || "결과 없음"})`); emit(job, "vision", `△ 사진 검수 실패 → 생략 · ${r?.error || "결과 없음"}`, null, 1); }
      } catch (e) { vision = null; job.aiFails.push("사진 검수"); how.vision = "skip"; log("warn", `△ 📄 사진 검수 오류 → 생략 (${e?.message || e})`); emit(job, "vision", `△ 사진 검수 오류 → 생략 · ${e?.message || e}`, null, 1); }
    }

    // ④-3 사진 가장자리 글자 잘라내기 — vision 이 has_text + text_pos(top/bottom/left/right) 로 알려 준 사진은 그 가장자리 22% 를 잘라내고 여백을 다시 정리한다.
    //   잘라낸 뒤 세로 220px 미만이면 사진으로 쓰지 않는다(photo=null, dropped why:"text-edge"). center 는 그대로 두고 plan-core 가 제외한다.
    const textEdgeDropped = [];
    if (vision?.items?.length) {
      let cut = 0;
      for (const v of vision.items) {
        const pos = String(v?.text_pos || "").toLowerCase();
        if (!v?.has_text || !["top", "bottom", "left", "right"].includes(pos)) continue;
        const rec = cleaned.find((c) => c.id === v.id && c.photo?.file);
        if (!rec) continue;
        const f = path.join(dir, rec.photo.file);
        try {
          const { w, h } = rec.photo;
          const dx = Math.round(w * 0.22), dy = Math.round(h * 0.22);
          const r = pos === "top" ? { x: 0, y: dy, w, h: h - dy } : pos === "bottom" ? { x: 0, y: 0, w, h: h - dy } : pos === "left" ? { x: dx, y: 0, w: w - dx, h } : { x: 0, y: 0, w: w - dx, h };
          let nw = r.w, nh = r.h;
          if (mods.image?.cropRect) { const c = mods.image.cropRect(f, f, r); nw = c.w || r.w; nh = c.h || r.h; }
          else { const ni = nativeImage.createFromPath(f); if (ni.isEmpty()) throw new Error("그림 해석 실패"); fs.writeFileSync(f, ni.crop({ x: r.x, y: r.y, width: r.w, height: r.h }).toPNG()); }
          if (mods.image?.autoTrim) { const t = mods.image.autoTrim(f, f); nw = t.w || nw; nh = t.h || nh; }
          rec.photo = { ...rec.photo, w: nw, h: nh, rect: { x: rec.photo.rect.x + r.x, y: rec.photo.rect.y + r.y, w: nw, h: nh }, textEdgeCut: pos };
          rec.w = nw; rec.h = nh; cut++;
          if (nh < 220) { rec.photo = null; rec.out = rec.file = rec.full?.file || rec.file; textEdgeDropped.push({ id: rec.id, why: "text-edge" }); log("dim", `  📄 ${rec.id} 가장자리 글자(${pos}) 잘라낸 뒤 ${nw}×${nh} → 사진으로 안 씀`); }
          else log("dim", `  📄 ${rec.id} 가장자리 글자(${pos}) 22% 잘라냄 → ${nw}×${nh}`);
        } catch (e) { log("dim", `  📄 가장자리 글자 자르기 실패 ${rec.id} (${e?.message || e})`); }
      }
      if (cut) { writeJson(path.join(dir, "clean.json"), cleanedForSave(cleaned)); emit(job, "vision", `✂ 가장자리 글자 ${cut}장 잘라냄${textEdgeDropped.length ? ` · ${textEdgeDropped.length}장은 너무 작아 제외` : ""}`, { cut, dropped: textEdgeDropped.length }, 1); }
    }

    // v4: 사람이 확인 화면에서 고친 값(info.json) — 사진 포함/제외를 vision 결과에 덮는다
    const info = job.phase === "generate" ? readJson(path.join(dir, "info.json")) : null;
    if (info && vision?.items) {
      const exc = new Set(info.excluded || []), inc = new Set(info.included || []);
      vision.items.forEach((v) => { if (exc.has(v.id)) { v.usable = false; v.role = "skip"; v.human = "excluded"; } else if (inc.has(v.id)) { v.usable = true; if (v.role === "skip") v.role = "detail"; v.human = "included"; } });
    }
    if (info?.excluded?.length) { const exc = new Set(info.excluded); cleaned = cleaned.map((c) => (exc.has(c.id) ? { ...c, photo: null, userExcluded: true, _photo: c.photo } : c)); } // 사진 검수가 없어도 사람이 뺀 사진은 섹션에 안 쓴다(clean.json 은 그대로)

    // ④-4 제품 누끼(cutout) + 색 팔레트 — A2 cutout.js: cutoutImages(items, opts) → { items:[{ id, file, w, h, ok }] } · palette(files|items) → { primary, accent, bg, … }
    //   vision 이 쓸 수 있다고 한 사진(없으면 photo 전부)만 넘긴다. 모듈 없음/실패 → skip(템플릿은 누끼 없이 사진으로 그린다)
    check(job);
    const visionOk = (id) => { const v = vision?.items?.find((x) => x.id === id); return !v || (v.usable !== false && v.role !== "skip"); };
    let cutout = reuse && !fresh.includes("cutout") ? readJson(path.join(dir, "cutout.json")) : null;
    // 대상: vision 이 product_only(상품 본체 단독 사진)라고 한 이미지만 — 사람·가구·소품이 있으면 전경 분리가 그것까지 따 오므로(비용·오탐 절감). 입력은 raw 원본 + OCR 상자(원본 좌표)
    const cutItems = cleaned.filter((c) => c?.photo?.file && vision?.items?.find((x) => x.id === c.id)?.product_only === true).map((c) => { const im = images.find((x) => x.id === c.id); return { id: c.id, file: im?.file || path.join(dir, c.photo.file), kind: c.kind, w: im?.w || c.w, h: im?.h || c.h }; });
    if (cutout?.items) { how.cutout = "reuse"; emit(job, "cutout", `✔ 누끼 ${cutout.items.filter((x) => x.ok && x.file).length}장 재사용`, { done: cutout.items.length, total: cutout.items.length }, 1); }
    else if (!cutItems.length) { cutout = null; how.cutout = "skip"; emit(job, "cutout", vision ? "상품 단독 사진이 없어 누끼 건너뜀" : "사진 검수 없음 — 누끼 건너뜀", null, 1); }
    else if (!mods.cutout?.cutoutImages) { cutout = null; how.cutout = "skip"; emit(job, "cutout", "누끼 모듈 없음 — 사진 그대로 사용", null, 1); }
    else {
      emit(job, "cutout", `제품 누끼를 따는 중 (${cutItems.length}장)`, { done: 0, total: cutItems.length }, 0.05);
      try {
        // A2 API: items [{ id, file, out, boxes? }] → [{ id, out(알파 PNG, cutoutOk 일 때만), w, h, bbox, coverage, ok, cutoutOk, reason, rect, palette?, textCut }]
        const reqItems = cutItems.map((it) => ({ ...it, out: path.join(cleanDir, `${it.id}_cut.png`), boxes: ocr.images.find((o) => o.id === it.id)?.boxes || [] }));
        const r = await mods.cutout.cutoutImages(reqItems, { log, onProgress: ({ done, total, id, cutoutOk }) => emit(job, "cutout", `✂ ${id || ""} ${cutoutOk ? "제품 단독 컷" : "누끼 생략(장면 사진)"} (${done}/${total}장)`, { done, total, id }, total ? Math.min(0.9, done / total) : 0.5) });
        const items = (Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : []).map((x) => ({ id: x.id, file: x.out ? path.relative(dir, x.out).replace(/\\/g, "/") : null, w: x.w || 0, h: x.h || 0, ok: !!(x.cutoutOk && x.out), bbox: x.bbox || null, coverage: x.coverage ?? null, reason: x.reason || "", palette: x.palette || null, textCut: x.textCut || 0 }));
        let palette = r?.palette || null;
        if (!palette && typeof mods.cutout.palette === "function") { try { palette = await mods.cutout.palette(items.filter((x) => x.ok).map((x) => path.join(dir, x.file)), { jobDir: dir, log }); } catch (e) { log("dim", `  📄 팔레트 실패 (${e?.message || e})`); } }
        if (!palette) { const hero = items.find((x) => x.ok && x.palette) || items.find((x) => x.palette); palette = hero?.palette || null; } // 모듈 팔레트가 없으면 첫 누끼의 색
        cutout = { items, palette: palette || null, how: "cutout", createdAt: Date.now() };
        how.cutout = "cutout"; writeJson(path.join(dir, "cutout.json"), cutout);
        const okN = cutout.items.filter((x) => x.ok && x.file).length;
        emit(job, "cutout", `✔ 누끼 ${okN}/${cutItems.length}장${palette ? ` · 팔레트 ${[palette.primary, palette.accent].filter(Boolean).join(" ")}` : ""}`, { done: cutItems.length, total: cutItems.length, ok: okN, palette }, 1);
      } catch (e) { cutout = null; how.cutout = "skip"; log("warn", `△ 📄 누끼 실패 → 사진 그대로 (${e?.message || e})`); emit(job, "cutout", `△ 누끼 실패 → 사진 그대로 · ${e?.message || e}`, null, 1); }
    }

    // A3 plan-core 규약: cleaned[].cutout = { file, w, h, ok } (ok 인 이미지는 hero·증거·비교·사이즈에 우선)
    cleaned.forEach((c) => { const it = cutout?.items?.find((x) => x.id === c.id && x.ok && x.file); c.cutout = it ? { file: it.file, w: it.w, h: it.h, bbox: it.bbox || null, palette: it.palette || null, ok: true, coverage: it.coverage ?? null } : null; });
    if (cutout) writeJson(path.join(dir, "clean.json"), cleanedForSave(cleaned));

    // ⑤ 번역 — 제목·속성·옵션·OCR 글을 모아 한 번에(캐시는 translate.js 가 관리). 이미 _ko 가 있으면 그대로
    check(job);
    emit(job, "translate", "한글로 번역하는 중", null, 0.05);
    const trMap = new Map(Object.entries(readJson(path.join(dir, "translate.json"), {})));
    const want = new Set();
    const need = (t) => { const s = String(t || "").trim(); if (s && CJK.test(s) && !trMap.has(s)) want.add(s); };
    if (!src.title_ko) need(src.title_zh);
    src.attrs.forEach((a) => { if (!a.k_ko) need(a.k_zh); if (!a.v_ko) need(a.v_zh); });
    src.options.forEach((o) => { if (!o.label_ko) need(o.label_zh); });
    ocr.images.forEach((o) => (o.boxes || []).forEach((b) => { if (!b.latin && !b.text_ko) need(b.text); }));
    if (!src.detailText_ko && src.detailText_zh) src.detailText_zh.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 80).forEach(need);
    const todo = [...want].slice(0, 400);
    if (todo.length && typeof translate === "function") {
      how.translate = "translate";
      for (let i = 0; i < todo.length; i += 40) {
        check(job);
        const part = todo.slice(i, i + 40);
        try { const kos = await translate(part); part.forEach((t, k) => kos?.[k] && trMap.set(t, kos[k])); }
        catch (e) { log("dim", `  📄 번역 실패 → 원문 유지 (${e?.message || e})`); how.translate = "failed"; break; }
        emit(job, "translate", `🌐 ${Math.min(i + 40, todo.length)}/${todo.length} 문장`, { done: Math.min(i + 40, todo.length), total: todo.length }, Math.min(1, (i + 40) / todo.length));
      }
    } else how.translate = todo.length ? "none" : "skip";
    writeJson(path.join(dir, "translate.json"), Object.fromEntries(trMap));
    const ko = (t) => trMap.get(String(t || "").trim()) || "";
    // 제목이 회사 이름(…유한회사/有限公司/商行/厂)으로 읽힌 경우(실사이트 추출 오류 실측) → 카피·헤드라인에 회사명이 들어가지 않게 상품군 속성값·키워드로 대신
    const SHOP_RE = /(유한회사|유한공사|주식회사|有限公司|有限责任|商行|贸易|工厂|厂$|公司$|상행|무역)/;
    let title_ko = src.title_ko || ko(src.title_zh) || src.title_zh;
    if (SHOP_RE.test(title_ko) || SHOP_RE.test(src.title_zh || "")) {
      const cat = src.attrs.map((a) => ({ k: a.k_ko || ko(a.k_zh) || a.k_zh, v: a.v_ko || ko(a.v_zh) || a.v_zh })).find((a) => /(카테고리|품목|제품|产品|类别|品名|名称)/.test(a.k))?.v || "";
      const alt = String(src.coupangName || src.keyword || [cat, ...src.attrs.slice(0, 6).map((a) => a.v_ko || ko(a.v_zh) || "").filter((v) => v && v.length <= 8 && !/\d/.test(v))].filter(Boolean).slice(0, 3).join(" ")).trim();
      log("warn", `△ 📄 상품 제목이 회사 이름으로 읽혔습니다("${String(title_ko).slice(0, 30)}") → "${alt || "(빈 제목)"}"로 대신합니다`);
      title_ko = /^[\d\s.]+$/.test(alt) ? String(src.keyword || "") : alt;
    }
    if (info?.product_name_ko) { src.coupangName = String(info.product_name_ko).slice(0, 80); title_ko = src.coupangName; } // v4: 확인 화면에서 고친 상품명
    job.title = src.coupangName || notShop(title_ko) || job.title; // 작업 제목은 한글로(목록·완료 로그) — 판매자 이름은 제외
    const attrs = src.attrs.map((a) => ({ ...a, k_ko: a.k_ko || ko(a.k_zh) || a.k_zh, v_ko: a.v_ko || ko(a.v_zh) || a.v_zh }));
    const options = src.options.map((o) => ({ ...o, label_ko: o.label_ko || ko(o.label_zh) || o.label_zh }));
    let ocrDirty = false;
    ocr.images.forEach((o) => (o.boxes || []).forEach((b) => { if (!b.text_ko) { b.text_ko = b.latin ? b.text : ko(b.text) || b.text; ocrDirty = true; } }));
    const detailText_ko = src.detailText_ko || src.detailText_zh.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => ko(l) || l).join("\n");
    if (ocrDirty) writeJson(path.join(dir, "ocr.json"), ocr);
    emit(job, "translate", `✔ 번역 ${trMap.size}문장 · ${title_ko.slice(0, 30)}`, { done: trMap.size, total: trMap.size, title_ko }, 1);

    // ⑤-0 AI 장면 사진을 백그라운드로 시작 — 기획안·카피와 동시에 돈다. 진행 메시지는 지금 단계 이름으로 흘려 보낸다(단계 순서 유지)
    let scene = null;
    const sst = store.get("settings") || {};
    const sEmit = (msg, extra = null, frac = 0) => emit(job, job.sceneDone ? "scene" : job.step, `🎨 ${String(msg).replace(/^🎨\s*/, "")}`, { ...(extra || {}), bg: "scene" }, job.step === "scene" ? frac : 0);
    const runScene = async () => {
    // AI 장면 사진(scene, v3) — 이미지 생성 키(settings.geminiKey)가 있을 때만: 누끼(없으면 vision 점수 최고 사진) 1~3장 → planShots → generateScenes(n:2)
      //   → 생성본을 Claude CLI(Read)로 다시 검수(제품 형태가 원본과 같은지 same_product · 글자 없음) → 통과본만 plan 의 hero·point 사진 1순위. 키는 로그·json 어디에도 남기지 않는다
      const sceneSettings = (() => { const st = store.get("settings") || {}; return { geminiKey: st.geminiKey || "", geminiImageModel: st.geminiImageModel || "", openaiKey: st.openaiKey || "", bakeEngine: st.detailBakeEngine || "", openaiImageModel: st.openaiImageModel || "" }; })();
      const sceneProv = mods.scene?.resolveProvider ? mods.scene.resolveProvider({ settings: sceneSettings }) : { key: sceneSettings.geminiKey || process.env.GEMINI_API_KEY || "", provider: "gemini", model: sceneSettings.geminiImageModel || "gemini-2.5-flash-image" };
      scene = reuse && !fresh.includes("scene") ? readJson(path.join(dir, "scene.json")) : null;
      if (scene?.items) { how.scene = "reuse"; sEmit(`✔ AI 장면 사진 재사용 (통과 ${scene.items.filter((x) => x.pass).length}장)`, null, 1); }
      else if (process.env.SEEDHACK_DETAIL_NO_AI) { scene = null; how.scene = "skip"; sEmit("AI 없이 진행 — 장면 사진 생략"); }
    else if (!sceneProv?.key) { scene = null; how.scene = "no-key"; sEmit("이미지 생성 키를 넣으면 AI 장면 사진을 만듭니다 (📄 화면 설정 → 이미지 생성 키)", { noKey: true }, 1); }
      else if (!mods.scene?.generateScenes || !mods.scenePrompt?.planShots) { scene = null; how.scene = "skip"; sEmit("장면 생성 모듈 없음 — 생략", null, 1); }
      else {
        const ts = Date.now();
        const byScore = (a, b) => (vision?.items?.find((x) => x.id === b.id)?.score || 0) - (vision?.items?.find((x) => x.id === a.id)?.score || 0);
        const cutFiles = cleaned.filter((c) => c.cutout?.file).map((c) => path.join(dir, c.cutout.file));
        const photoFiles = cleaned.filter((c) => c?.photo?.file && visionOk(c.id)).sort(byScore).map((c) => path.join(dir, c.photo.file));
        const productImages = (cutFiles.length ? cutFiles : photoFiles).slice(0, 2); // 누끼(product_only) 없으면 vision 점수 최고 제품 사진 2장
        const product = { title_ko: src.title_ko || src.coupangName || "", keyword: src.keyword || "", category: src.category || "", attrs: src.attrs, detailText_ko: src.detailText_ko || "", ocr_ko: ocr.images.flatMap((o) => (o.boxes || []).map((b) => b.text_ko || "")).filter(Boolean).slice(0, 40) };
        // 기능: 기획안 주장 + 카피 혜택/포인트 제목 + 속성 — planShots 가 기능별 point 컷을 만든다
        product.features = [...new Set([...attrs.map((a) => `${a.k_ko} ${a.v_ko}`), ...(vision?.items || []).filter((x) => x.usable).map((x) => x.shows), ...product.ocr_ko.slice(0, 20)].map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 24); // 기획안·카피와 동시에 돌므로 속성·사진 설명·이미지 속 글로
        product.attrs_ko = attrs.map((a) => ({ k_ko: a.k_ko, v_ko: a.v_ko }));
        const sg = job.styleGuide || readJson(path.join(dir, "info.json"))?.styleGuide || readJson(path.join(dir, "style.json")) || null;
        const shots = (mods.scenePrompt.planShots({ product, brief: { avoid: "다른 모양의 제품, 봉 개수·관절·고리 개수 변경" }, styleGuide: sg }) || []).slice(0, Number(sst.detailSceneShots || 6)); // styleGuide → A3 styleRule(조명·소재·배경 톤·일관성 규칙·제품 새로 그리지 않기) // v4: 제품별 디자인 시스템(배경·조명·소재·일관성 규칙·제품 새로 그리지 않기)을 모든 컷에
        const outS = path.join(dir, "scene");
        sEmit(`AI 장면 사진 생성 시작 (${sceneProv.provider} · ${shots.length}컷 × ${Math.max(1, Math.min(2, Number(sst.detailSceneN || 1)))}장 · 기획안·카피와 동시에)`, { done: 0, total: shots.length * 2 }, 0.05);
        try {
          // 컷마다 n장(설정 detailSceneN, 기본 1) · 동시 detailSceneConcurrency(기본 2) · 같은 일꾼의 컷 사이 SCENE_GAP_MS(기본 8초) — 429 재시도는 scene.js 가 한다
          const gen = []; const GAP = Number(process.env.SCENE_GAP_MS || 8000), N = Math.max(1, Math.min(2, Number(sst.detailSceneN || 1))), CONC = Math.max(1, Math.min(4, Number(sst.detailSceneConcurrency || 2)));
          let nextShot = 0, madeN = 0;
          const worker = async (w) => {
            for (let first = true; ; first = false) {
              const si = nextShot++; if (si >= shots.length) return;
              if (job.cancelled) return;
              if (!first) await sleep(GAP);
              const one = await mods.scene.generateScenes({ productImages, shots: [shots[si]], aspect: "4:5", n: N, outDir: outS, log, settings: sceneSettings, onUsage: recordImageUsage, onProgress: () => {} });
              const got = Array.isArray(one) ? one : one?.items || []; gen.push(...got); madeN += got.reduce((n, g) => n + (g.files?.length || 0), 0);
              sEmit(`🎨 ${shots[si].id} ${shots[si].title_ko || ""} 완성 (${madeN}/${shots.length * N}장)`, { done: madeN, total: shots.length * N, id: shots[si].id }, 0);
            }
          };
          await Promise.all(Array.from({ length: Math.min(CONC, shots.length) }, (_, w) => worker(w)));
          gen.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          const made = (Array.isArray(gen) ? gen : gen?.items || []).flatMap((g) => (g.files || []).map((f, k) => ({ id: `${g.id}_${k + 1}`, shot: g.id, purpose: g.purpose, file: path.relative(dir, f).replace(/\\/g, "/"), pass: false, same_product: null, has_text: null, score: null })));
          const errs = (Array.isArray(gen) ? gen : gen?.items || []).filter((g) => g.error).map((g) => g.error);
          if (!made.length) { scene = null; how.scene = "failed"; sEmit(`△ 장면 생성 실패 → 사진 경로로 계속 · ${errs[0] || "결과 없음"}`, null, 1); }
          else {
            // 생성본 검수: 제품 형태가 원본과 같은가(same_product), 글자가 없는가 — Claude CLI 가 원본·생성본을 Read 로 비교
            sEmit(`생성 ${made.length}장 · 제품 모양이 원본과 같은지 검수 중`, { done: made.length, total: made.length }, 0.7);
            if (!process.env.SEEDHACK_DETAIL_NO_AI && mods.cli?.runStructured && mods.cli?.cliAvailable?.()) {
              const sys = `당신은 상세페이지 사진 검수자입니다. 원본 제품 사진과 AI 가 생성한 장면 사진들을 Read 로 열어 비교합니다. 생성 사진마다: same_product(제품의 형태·색·구조가 원본과 같은가 — 봉·레일 개수, 관절·힌지 위치, 고리·구멍 배열, 브래킷 모양을 원본과 하나하나 대조해 하나라도 다르거나 제품이 둘로 늘었거나 다른 물건이면 false), has_text(글자·로고·워터마크가 있는가), score(1~5, 상세페이지에 바로 쓸 만한가), note(한 줄).`;
              const schema = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "same_product", "has_text", "score"], properties: { id: { type: "string" }, same_product: { type: "boolean" }, has_text: { type: "boolean" }, score: { type: "integer", minimum: 1, maximum: 5 }, note: { type: "string", maxLength: 80 } } } } } };
              const text = `원본 제품 사진:\n${productImages.map((f) => `  ${f}`).join("\n")}\n\n생성 사진(id · 파일):\n${made.map((m) => `  ${m.id}  ${path.join(dir, m.file)}  (${m.purpose})`).join("\n")}`;
              const rv = await mods.cli.runStructured({ purpose: "scene-check", system: sys, schema, text, model: process.env.SIGNAL_AI_MODEL || "sonnet", timeoutMs: 300000, allowedTools: ["Read"] });
              if (rv?.ok) { for (const it of rv.result.items || []) { const m = made.find((x) => x.id === it.id); if (m) { m.same_product = !!it.same_product; m.has_text = !!it.has_text; m.score = it.score; m.note = it.note || ""; m.pass = m.same_product && !m.has_text && it.score >= 3; } } if (rv.costUsd != null) { job.costs.scene = (job.costs.scene || 0) + rv.costUsd; job.costUsd = (job.costUsd || 0) + rv.costUsd; } }
              else log("warn", `△ 📄 생성 사진 검수 실패 → 생성본을 쓰지 않음 (${rv?.error || "결과 없음"})`);
            } else log("dim", "  📄 생성 사진 검수(CLI) 없음 → 생성본을 쓰지 않음");
            scene = { provider: sceneProv.provider, model: sceneProv.model, shots: shots.map((x) => ({ id: x.id, purpose: x.purpose, title_ko: x.title_ko })), items: made, inputs: productImages.map((f) => path.relative(dir, f)), ms: Date.now() - ts, createdAt: Date.now() };
            how.scene = "scene"; writeJson(path.join(dir, "scene.json"), scene);
            sEmit(`✔ AI 장면 사진 ${made.length}장 생성 · 통과 ${made.filter((x) => x.pass).length}장 (제품 모양 같음·글자 없음) · ${((Date.now() - ts) / 1000).toFixed(0)}초`, { made: made.length, pass: made.filter((x) => x.pass).length }, 1);
          }
        } catch (e) { scene = null; how.scene = "failed"; log("warn", `△ 📄 장면 생성 오류 → 사진 경로로 계속 (${String(e?.message || e).slice(0, 120)})`); sEmit(`△ 장면 생성 오류 → 사진 경로로 계속`, null, 1); }
      }

    };
    const scenePromise = job.phase === "prepare" || job.v5 || job.mode === "localize" ? null : runScene().catch((e) => { scene = null; how.scene = "failed"; log("warn", `△ 📄 장면 단계 오류 (${String(e?.message || e).slice(0, 120)})`); }).finally(() => { job.sceneDone = true; });

    // ⑤-2 기획안(brief) — A3 brief.js writeBrief({ source, ocr, cleaned, vision, cutout, keyword, coupangName, category, log }) → { ok, brief, how, costUsd }
    //   "누구에게·무엇을·왜" 와 섹션 뼈대를 먼저 정하고 카피가 그 위에 쓴다. CLI 없음/AI 끔/실패 → skip
    check(job);
    let brief = reuse && !fresh.includes("brief") ? readJson(path.join(dir, "brief.json")) : null;
    const copyInput = {
      title_zh: src.title_zh, title_ko, attrs, options: options.map((o) => ({ label_zh: o.label_zh, label_ko: o.label_ko })), detailText_ko,
      images: images.map((im) => { const o = ocr.images.find((x) => x.id === im.id); const bx = (o?.boxes || []).filter((b) => !b.latin); return { id: im.id, kind: im.kind, w: im.w, h: im.h, texts_zh: bx.map((b) => b.text), texts_ko: bx.map((b) => b.text_ko) }; }),
      keyword: src.keyword || "", coupangName: src.coupangName || "", category: src.category || "",
      vision: vision || null, // A3 규약: AI 사진 검수 결과(items[{id,usable,shows,caption_title,caption_desc,role}])
      cutout: cutout || null, palette: cutout?.palette || null, // v2: 누끼·팔레트 (brief 는 기획안 단계 뒤에 넣는다)
    };
    if (mods.copy?.buildCopyInput) { // A3 확정 API: buildCopyInput({ source, ocr, cleaned, ko, keyword, coupangName, category, vision }) — vision usable:false 는 usp 가 가리키지 않게
      try { const built = mods.copy.buildCopyInput({ source: { ...src, title_ko, attrs, options, detailText_ko }, ocr, cleaned, ko: Object.fromEntries(trMap), keyword: src.keyword || "", coupangName: src.coupangName || "", category: src.category || "", vision: vision || null }); if (built && typeof built === "object") Object.assign(copyInput, built, { vision: vision || null, cutout: cutout || null, palette: cutout?.palette || null }); }
      catch (e) { log("dim", `  📄 buildCopyInput 실패 → 자체 입력 (${e?.message || e})`); }
    }
    // 벤치마킹 레퍼런스(info.reference: reference.json 경로 또는 레퍼런스 이미지 폴더) → 작업 폴더 reference/reference.json (v5 만)
    const reference = job.v5 ? await jobReference(job, dir, mods) : null;
    // A3 API: writeBrief(briefInputFrom(copyInput), { log, model, useCli, webSearch }) → { brief, how:"cli"|"rules", costUsd }
    const briefInput = mods.brief?.briefInputFrom ? mods.brief.briefInputFrom(copyInput) : { title_ko, keyword: src.keyword || "", category: src.category || "", coupangName: src.coupangName || "", attrs_ko: attrs.map((a) => `${a.k_ko}: ${a.v_ko}`), ocr_ko: [], detailText_ko };
    if (brief && (brief.brief || brief.audience || brief.sections || brief.angle || brief.key_appeal || brief.plan_direction)) { how.brief = "reuse"; emit(job, "brief", "✔ 기획안 재사용", null, 1); job.styleGuide3 = readJson(path.join(dir, "style.json")); }
    else if (mods.brief?.writeBriefV3) {
      // v4: 7단 기획서(keyContent)+디자인 톤앤매너(styleGuide)+추천 템플릿을 한 번에(A3 writeBriefV3) — AI 없으면 규칙 기본
      emit(job, "brief", "기획서·디자인 톤앤매너를 쓰는 중 (상품 유형·핵심 소구·기획 방향·주의할 표현)", null, 0.1);
      const tb = Date.now();
      try {
        const photos = cleaned.filter((c) => c?.photo?.file && visionOk(c.id)).sort((a, b) => (vision?.items?.find((x) => x.id === b.id)?.score || 0) - (vision?.items?.find((x) => x.id === a.id)?.score || 0)).slice(0, 4).map((c) => path.join(dir, c.photo.file));
        const v3in = mods.brief.briefV3InputFrom ? mods.brief.briefV3InputFrom(copyInput, { vision, palette: cutout?.palette || null, photos, brief_text: "" }) : { ...briefInput, photos };
        if (reference && mods.referenceCore?.referenceGuide) v3in.reference_guide = mods.referenceCore.referenceGuide(reference); // 벤치마킹: 장점 순서·각도·문제 제기 방식(사실은 우리 것만)
        const r = await mods.brief.writeBriefV3(v3in, { log, ...(process.env.SEEDHACK_DETAIL_NO_AI ? { useCli: false } : {}) });
        if (r?.brief) {
          brief = { ...r.brief, brief_text: r.brief_text || "" }; how.brief = r.how || "cli"; job.costs.briefMs = Date.now() - tb;
          if (r.costUsd != null) { job.costs.brief = r.costUsd; job.costUsd = (job.costUsd || 0) + r.costUsd; }
          job.styleGuide3 = r.styleGuide || null; job.recommend3 = r.template || null;
          writeJson(path.join(dir, "brief.json"), brief); if (r.styleGuide) writeJson(path.join(dir, "style.json"), r.styleGuide);
          emit(job, "brief", `✔ 기획서 · ${String(brief.key_appeal || brief.angle || "").slice(0, 40)} (${how.brief}) · ${((Date.now() - tb) / 1000).toFixed(1)}초${r.costUsd != null ? ` · $${Number(r.costUsd).toFixed(3)}` : ""}`, { how: how.brief }, 1);
        } else { brief = null; job.aiFails.push("기획"); how.brief = "skip"; emit(job, "brief", `△ 기획서 실패 → 생략 · ${r?.error || "결과 없음"}`, null, 1); }
      } catch (e) { brief = null; job.aiFails.push("기획"); how.brief = "skip"; log("warn", `△ 📄 기획서 오류 → 생략 (${e?.message || e})`); emit(job, "brief", `△ 기획서 오류 → 생략 · ${e?.message || e}`, null, 1); }
    }
    else if (process.env.SEEDHACK_DETAIL_NO_AI) { brief = null; how.brief = "skip"; emit(job, "brief", "AI 없이 진행 — 기획안 생략", null, 1); }
    else if (!mods.brief?.writeBrief) { brief = null; how.brief = "skip"; emit(job, "brief", "기획안 모듈 없음 — 생략", null, 1); }
    else {
      emit(job, "brief", "기획안을 쓰는 중 (누구에게·무엇을·왜 · 섹션 뼈대)", null, 0.1);
      const tb = Date.now();
      try {
        const r = await mods.brief.writeBrief(briefInput, { log });
        const got = r?.brief || (r?.ok && r?.result) || null;
        if (got && typeof got === "object") { brief = got; how.brief = r?.how || "cli"; job.costs.briefMs = Date.now() - tb; if (r?.costUsd != null) { job.costs.brief = r.costUsd; job.costUsd = (job.costUsd || 0) + r.costUsd; } writeJson(path.join(dir, "brief.json"), brief); emit(job, "brief", `✔ 기획안 · ${String(brief.angle || brief.headline || brief.audience || "").slice(0, 40)} · ${((Date.now() - tb) / 1000).toFixed(1)}초${r?.costUsd != null ? ` · $${Number(r.costUsd).toFixed(3)}` : ""}`, { how: how.brief }, 1); }
        else { brief = null; job.aiFails.push("기획"); how.brief = "skip"; log("warn", `△ 📄 기획안 실패 → 생략 (${r?.error || "결과 없음"})`); emit(job, "brief", `△ 기획안 실패 → 생략 · ${r?.error || "결과 없음"}`, null, 1); }
      } catch (e) { brief = null; job.aiFails.push("기획"); how.brief = "skip"; log("warn", `△ 📄 기획안 오류 → 생략 (${e?.message || e})`); emit(job, "brief", `△ 기획안 오류 → 생략 · ${e?.message || e}`, null, 1); }
    }

    // v4 1단계 끝: 7단 기획서(brief_text)·디자인 톤앤매너(styleGuide)·추천 템플릿을 만들고 "상품 정보를 가져왔어요" 확인 화면에서 멈춘다
    if (job.phase === "prepare") {
      check(job);
      const prevInfo = readJson(path.join(dir, "info.json")) || {};
      const ctx = { src, title_ko, attrs, options, detailText_ko, ocr, cleaned, vision, cutout, brief, keyword: src.keyword || "", category: src.category || "" };
      const brief_text = await makeBriefText(mods, brief, ctx);
      const styleGuide = job.styleGuide3 || await makeStyleGuide(mods, ctx);
      const rec = job.recommend3?.templateId ? { templateId: job.recommend3.templateId, reason: job.recommend3.why || job.recommend3.reason || "" } : await makeRecommend(mods, ctx, styleGuide);
      const nextInfo = { ...prevInfo, jobId: job.jobId, url: src.url || "", product_name_ko: fresh.includes("brief") && prevInfo.product_name_ko ? prevInfo.product_name_ko : (prevInfo.product_name_ko || productNameOf(ctx)),
        brief_text: fresh.includes("brief") || !prevInfo.brief_text ? brief_text : prevInfo.brief_text, styleGuide: prevInfo.styleGuideEdited ? prevInfo.styleGuide : styleGuide,
        templateId: prevInfo.templateId || (mods.planCore?.buildPlanV5 ? "card" : rec.templateId), mode: prevInfo.mode || (src.lang === "ko" ? "scene" : "both"), recommend: rec, excluded: prevInfo.excluded || [], included: prevInfo.included || [], texts: prevInfo.texts || {}, preparedAt: Date.now(), how: { brief: how.brief, vision: how.vision, cutout: how.cutout } };
      writeJson(path.join(dir, "info.json"), nextInfo);
      const prevR = readJson(path.join(dir, "result.json")) || {};
      writeJson(path.join(dir, "result.json"), { ...prevR, jobId: job.jobId, status: prevR.renders?.length ? prevR.status || "done" : "prepared", prepared: true, title: job.title, url: src.url, templateId: nextInfo.templateId, createdAt: job.createdAt, preparedAt: Date.now(), prepareMs: Date.now() - t0, costUsd: prevR.renders?.length ? prevR.costUsd : job.costUsd ?? null, costs: job.costs, timings: Object.fromEntries(Object.entries(job.timings || {}).map(([k, v]) => [k, v.end - v.start])) });
      if (job.autoGo && !job.cancelled) { emit(job, "brief", `✔ 기획안 완성 · ${((Date.now() - t0) / 1000).toFixed(1)}초 — 이어서 상세페이지를 만듭니다`, { autoGo: true }, 1); return { prepared: true, auto: true, title: job.title, durationMs: Date.now() - t0 }; }
      emit(job, "done", `■ 상품 정보를 가져왔어요 · ${((Date.now() - t0) / 1000).toFixed(1)}초 — 확인하고 '상세페이지 생성하기'를 누르세요`, { prepared: true, durationMs: Date.now() - t0 }, 1);
      return { prepared: true, title: job.title, durationMs: Date.now() - t0 };
    }
    if (info?.brief_text) {
      const txt = String(info.brief_text).slice(0, 6000);
      let parsed = null; try { parsed = mods.brief?.parseBriefText ? mods.brief.parseBriefText(txt) : null; } catch {}
      const keep = parsed ? Object.fromEntries(Object.entries(parsed).filter(([, v]) => (Array.isArray(v) ? v.length : String(v || "").trim()))) : {};
      brief = { ...(brief || {}), ...keep, brief_text: txt, edited: true };
    }
    if (info?.texts && typeof info.texts === "object") (copyInput.images || []).forEach((im) => { const t = info.texts[im.id]; if (Array.isArray(t)) im.texts_ko = t.map((x) => String(x || "").slice(0, 200)).filter(Boolean); });
    job.styleGuide = info?.styleGuide || job.styleGuide3 || readJson(path.join(dir, "style.json")) || null;

    // 근거 없는 수치 가드(오류를 막는 장치): 카피의 모든 글에서 원문(속성·OCR·상세 글)에 없는 "숫자+단위" 문장을 지운다 — A3 inputNumbers/stripForeignNumbers 재사용
    const evidenceInput = { ...copyInput, brief: null };
    const allowedNums = mods.copy?.inputNumbers ? mods.copy.inputNumbers(evidenceInput) : null;
    const guardNumbers = (obj, removed = [], keyPath = "") => {
      if (!allowedNums || !mods.copy?.stripForeignNumbers) return removed;
      if (Array.isArray(obj)) { obj.forEach((v, i) => { if (typeof v === "string") { const r = mods.copy.stripForeignNumbers(v, allowedNums); if (r.removed.length) { removed.push(...r.removed.map((x) => `${keyPath}[${i}] ${x}`)); obj[i] = r.text || v.replace(/\d[\d.,]*\s*(kg|g|mm|cm|m|개|장|L|ml|%|도|년|시간|분|배|℃)/g, "").trim(); } } else if (v && typeof v === "object") guardNumbers(v, removed, `${keyPath}[${i}]`); }); return removed; }
      if (obj && typeof obj === "object") for (const k of Object.keys(obj)) { const v = obj[k]; if (typeof v === "string") { const r = mods.copy.stripForeignNumbers(v, allowedNums); if (r.removed.length) { removed.push(...r.removed.map((x) => `${keyPath}.${k} ${x}`)); obj[k] = r.text || v.replace(/\d[\d.,]*\s*(kg|g|mm|cm|m|개|장|L|ml|%|도|년|시간|분|배|℃)/g, "").trim(); } } else if (v && typeof v === "object") guardNumbers(v, removed, `${keyPath}.${k}`); }
      return removed;
    };
    const ocrKo = [...new Set(ocr.images.flatMap((o) => (o.boxes || []).map((b) => b.text_ko || "")).filter((t) => t && !CJK.test(t)))].slice(0, 80);
    const qaEvidence = `속성: ${attrs.slice(0, 30).map((a) => `${a.k_ko}=${a.v_ko}`).join(", ")}\n이미지 속 글(OCR 번역): ${ocrKo.join(" | ")}\n상세 글: ${String(detailText_ko || "").slice(0, 600)}`;

    // v5: 섹션 레시피(A3 planSectionsV5) → 섹션별 장면 생성(A2 generateSectionScenes)을 카피와 동시에
    let sectionsV5 = null, v5ScenePromise = null;
    if (job.v5 && mods.planCore?.planSectionsV5) {
      sectionsV5 = reuse && !fresh.includes("sections") ? readJson(path.join(dir, "sections.json")) : null;
      if (sectionsV5 && !Array.isArray(sectionsV5) && Array.isArray(sectionsV5.sections)) sectionsV5 = sectionsV5.sections; // copy-resanitize 가 { sections } 로 쓸 때
      if (!Array.isArray(sectionsV5) || !sectionsV5.length) { const prevSecs = readJson(path.join(dir, "sections.json")); sectionsV5 = mods.planCore.planSectionsV5({ brief: brief || {}, styleGuide: job.styleGuide, vision, options, productPalette: cutout?.palette || readJson(path.join(dir, "cutout.json"))?.palette || null, reference, prev: reference && Array.isArray(prevSecs) ? prevSecs : null }); if (reference) emit(job, "brief", `🧲 벤치마킹 순서 · ${sectionsV5.map((x) => x.type).join("→")}${(sectionsV5.refDropped || []).length ? ` · 레퍼런스 섹션 ${sectionsV5.refDropped.length}개는 재료 없음` : ""}`, null, 1); writeJson(path.join(dir, "sections.json"), sectionsV5); } // 레퍼런스가 있으면 지난 섹션 id(장면 파일)를 이어 받는다
      v5ScenePromise = runSceneV5({ job, dir, mods, sections: sectionsV5, brief, vision, cleaned, images, src, title_ko, attrs, how, reuse, fresh, emit, sEmitFn: (msg, extra) => emit(job, job.step, `🎨 ${msg}`, { ...(extra || {}), bg: "scene" }, 0) })
        .then((r) => { scene = r; }).catch((e) => { log("warn", `△ 📄 섹션 장면 오류 (${String(e?.message || e).slice(0, 140)})`); how.scene = "failed"; });
    }

    // 원본 한글화 앞부분(글자 지우기·레이어 번역)은 카피·장면과 상관없어 "둘 다" 모드면 카피·장면 생성과 동시에 미리 돌린다(렌더 단계에서 몇 분씩 기다리던 것)
    const locPrepFn = async () => {
      const tl0 = Date.now();
      emit(job, job.step, "🈚 원본 이미지 한글화 중 (글자 지우기 → 한글 레이어)", { bg: "localize" }, 0);
      const locDir = path.join(dir, "localize"); fs.mkdirSync(locDir, { recursive: true });
      const targets = images.filter((im) => im.kind !== "option" || true);
      const files = {}, layersById = {}, locAi = { used: 0, accepted: 0 };
      // A2 레이어 → 원래 OCR 기계번역(text_ko) 이어 붙이기(같은 글 상자 안에 든 것)
      const mtOf = (boxes, l) => boxes.filter((b) => b.text_ko && b.x >= l.x - 4 && b.y >= l.y - 4 && b.x + b.w <= l.x + l.w + 4 && b.y + b.h <= l.y + l.h + 4).map((b) => b.text_ko).join(" ");
      // A2 style{color,bgColor,pill,borderColor,fontWeight,fontSizePx,align} → localize 템플릿 style{color,weight,size,align,bg,border,radius}
      const tplStyle = (st) => st ? { color: st.color || undefined, weight: st.fontWeight || undefined, size: st.fontSizePx || undefined, align: st.align || undefined, ...(st.bgColor ? { bg: st.bgColor } : {}), ...(st.borderColor ? { border: `2px solid ${st.borderColor}` } : {}), ...(st.pill ? { radius: "pill" } : {}), ...(st.rotate ? { rotate: st.rotate } : {}) } : undefined;
      let next = 0;
      const one = async () => { for (;;) { const im = targets[next++]; if (!im) return;
        const o = ocr.images.find((x) => x.id === im.id), boxes = (o?.boxes || []).filter((b) => !b.latin);
        const out = path.join(locDir, `${im.id}.png`);
        try {
          const locFn = mods.localize?.localizeImage || mods.image?.localizeImage;
          if (locFn && boxes.length) { const r = await locFn({ file: im.file, ocrBoxes: boxes, keepBoxes: (o?.boxes || []).filter((b) => b.latin), /* v13 남기는 영문·숫자는 넓혀 지우지 않음 */ boxes, out, w: im.w, h: im.h, imgKind: im.kind, ai: !process.env.SEEDHACK_DETAIL_NO_AI && !/^(gallery|main)$/.test(im.kind), /* 대표 사진은 hero 로 한 장만 쓰므로 AI 는 고른 뒤 그 장만(아래) */ settings: sceneSettingsNow(), log }); files[im.id] = r?.out || out; layersById[im.id] = r?.layers ? r.layers.map((l) => ({ ...l, mt: mtOf(boxes, l) })) : null; if (r?.ai?.used) { locAi.used += r.ai.billed || 0; locAi.tried = (locAi.tried || 0) + (r.ai.calls || 1); if (r.ai.accepted) locAi.accepted++; } /* v11: 장당 AI 최대 2회(다시 1회) */ }
          else { const c = cleaned.find((x) => x.id === im.id); files[im.id] = path.join(dir, c?.full?.file || c?.out || ""); if (!c) files[im.id] = im.file; }
        } catch (e) { log("dim", `  🈚 ${im.id} 지우기 실패 → 지운 전체본 (${e?.message || e})`); const c = cleaned.find((x) => x.id === im.id); files[im.id] = c ? path.join(dir, c.full?.file || c.out) : im.file; }
        if (!layersById[im.id]) layersById[im.id] = boxes.map((b) => ({ zh: b.text, mt: b.text_ko || "", x: b.x, y: b.y, w: b.w, h: b.h, role: b.h >= 40 ? "title" : "body" }));
      } };
      await Promise.all(Array.from({ length: Math.min(Math.max(1, Number((store.get("settings") || {}).detailLocalizeConcurrency) || 8), targets.length || 1) }, one)); // 동시 8장(사진 위 글자 AI 지우기는 다지역 라우터가 나눠 받는다)
      let tl = { images: targets.map((im) => ({ id: im.id, promo: false, layers: (layersById[im.id] || []).map((l) => ({ ...l, ko: l.mt || "", drop: !l.mt })) })), hero: {} };
      if (mods.copy?.translateLayers) { try { const r = await mods.copy.translateLayers({ images: targets.map((im) => ({ id: im.id, kind: im.kind, w: im.w, h: im.h, layers: layersById[im.id] || [] })), brief: brief || null, attrs, log, ...(process.env.SEEDHACK_DETAIL_NO_AI ? { useCli: false } : {}) }); if (r?.images) { tl = r; if (r.how === "rules" && !process.env.SEEDHACK_DETAIL_NO_AI) job.aiFails.push("번역"); if (r.costUsd != null) { job.costs.localize = (job.costs.localize || 0) + r.costUsd; job.costUsd = (job.costUsd || 0) + r.costUsd; } } } catch (e) { log("warn", `△ 📄 한글화 번역 실패 → 기계번역 (${e?.message || e})`); } }
      (tl.images || []).forEach((x) => (x.layers || []).forEach((l) => { if (l.style && !l.box) l.box = { style: tplStyle(l.style) }; }));
      if (mods.localize?.eraseShapes) { let ns = 0; for (const x of tl.images || []) { const sh = (x.layers || []).filter((l) => l.drop && l.shape).map((l) => l.shape); if (sh.length && files[x.id] && !x.promo) { try { ns += mods.localize.eraseShapes(files[x.id], sh); } catch {} } } if (ns) log("dim", `  🈚 글을 뺀 알약·배지 ${ns}개는 도형째 지움(빈 장식 없음)`); } // v12
      if (locAi.used) log("info", `🈚 사진 위 글자 AI 지우기 ${locAi.used}장 · 적용 ${locAi.accepted}장 (장당 약 $0.04)`);
      if (locAi.used) { const c = locAi.used * 0.039; job.costs.localize = (job.costs.localize || 0) + c; job.costUsd = (job.costUsd || 0) + c; }
      writeJson(path.join(dir, "localize.json"), { ...tl, ai: locAi, files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, path.relative(dir, f)])) });
      const relFiles = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, path.relative(dir, f).replace(/\\/g, "/")]));
      return { tl0, targets, files, layersById, locAi, tl, relFiles };
    };
    const locPrepP = job.mode === "both" && !job.regen && job.phase !== "prepare" ? locPrepFn().catch((e) => ({ error: e })) : null;
    // ⑥ 카피 — v2: brief 가 있으면 writeCopy 가 기획안 기반(PAS→AIDMA) 구조로 쓴다 · v5: 섹션 카드 카피(writeCopyV5)
    check(job);
    copyInput.brief = brief || null;
    let copy = reuse && !fresh.includes("copy") ? readJson(path.join(dir, "copy.json")) : null;
    if (job.mode === "localize" && !copy) { copy = readJson(path.join(dir, "copy.json")) || { notice: [] }; how.copy = "skip"; emit(job, "copy", "원본 한글화 — 섹션 카피는 쓰지 않음", null, 1); }
    if (copy) { how.copy = "reuse"; emit(job, "copy", "✔ 카피 재사용", null, 1); }
    else {
      emit(job, "copy", "전환형 카피를 쓰는 중 (헤드라인·핵심포인트·FAQ)", null, 0.1);
      if (job.v5 && sectionsV5 && mods.copy?.writeCopyV5) {
        const tc = Date.now();
        const prevCopy = job.regen?.rewrite ? readJson(path.join(dir, "copy.json")) : null;
        const secsForCopy = job.regen?.rewrite ? sectionsV5.map((x) => (x.id === job.regen.sectionId ? { ...x, copy: { ...(x.copy || {}), request: job.regen.request } } : x)) : sectionsV5;
        try {
          // 속도: 카피 입력을 줄인다 — 기획서는 카피에 쓰는 칸만(장점 6·스펙 14·기획 방향 한 줄씩), 이미지 글은 장당 3줄·최대 20장
          const briefLite = brief ? { product_name_ko: brief.product_name_ko, product_type: brief.product_type, key_appeal: brief.key_appeal, advantages: (brief.advantages || []).slice(0, 6), specs: (brief.specs || []).slice(0, 14), targets: (brief.targets || []).slice(0, 3), caution: (brief.caution || []).slice(0, 8), plan_direction: (brief.plan_direction || []).map((x) => ({ part: x.part, text: String(x.text || "").slice(0, 80) })), places: brief.places } : {};
          const copyInputLite = { ...copyInput, images: (copyInput.images || []).filter((im) => im.texts_ko?.length).slice(0, 20).map((im) => ({ ...im, texts_zh: [], texts_ko: (im.texts_ko || []).slice(0, 6) })), detailText_ko: String(copyInput.detailText_ko || "").slice(0, 400) };
          const r = await mods.copy.writeCopyV5(copyInputLite, { brief: briefLite, sections: secsForCopy, reference, log, timeoutMs: 360000, ...(process.env.SEEDHACK_DETAIL_NO_AI ? { useCli: false } : {}) });
          copy = r?.copy || null; how.copy = r?.how || "copy"; job.costs.copyMs = Date.now() - tc; if (how.copy === "rules" && !process.env.SEEDHACK_DETAIL_NO_AI) job.aiFails.push("카피");
          if (r?.costUsd != null) { job.costs.copy = r.costUsd; job.costUsd = (job.costUsd || 0) + r.costUsd; }
          if (copy && prevCopy?.sections && job.regen?.sectionId) copy = { ...prevCopy, sections: { ...prevCopy.sections, [job.regen.sectionId]: copy.sections?.[job.regen.sectionId] || prevCopy.sections[job.regen.sectionId] } }; // 다시 쓰기는 그 섹션만
        }
        catch (e) { log("warn", `△ 📄 v5 카피 실패 (${e?.message || e})`); copy = null; }
      } else if (mods.copy?.writeCopy) {
        const tc = Date.now();
        try { const r = await mods.copy.writeCopy(copyInput, { log, vision: vision || null, brief: brief || null, timeoutMs: 360000, ...(process.env.SEEDHACK_DETAIL_NO_AI ? { useCli: false } : {}) }); /* v2 카피 스키마가 커서 180초 기본값으로는 시간 초과 → 규칙 카피로 떨어졌다(실측) */ copy = r?.copy || null; how.copy = r?.how || "copy"; job.costs.copyMs = Date.now() - tc; if (r?.costUsd != null) { job.costs.copy = r.costUsd; job.costUsd = (job.costUsd || 0) + r.costUsd; } }
        catch (e) { log("warn", `△ 📄 카피 작성 실패 → 최소 카피 (${e?.message || e})`); copy = null; }
      }
      if (!copy) {
        how.copy = "lite";
        const spec = attrs.slice(0, 12).map((a) => ({ k: a.k_ko, v: a.v_ko }));
        copy = {
          name_ko: (src.coupangName || title_ko).slice(0, 40), headline: title_ko.slice(0, 18), sub: spec.length ? spec.slice(0, 2).map((s) => `${s.k} ${s.v}`).join(" · ").slice(0, 30) : "",
          badges: spec.slice(0, 3).map((s) => `${s.v}`.slice(0, 10)).filter(Boolean), pain: { title: "", items: [] }, usp: { title: "", items: [] },
          captions: copyInput.images.filter((im) => im.kind === "detail").map((im) => ({ imageId: im.id, title: (im.texts_ko[0] || "").slice(0, 30), desc: im.texts_ko.slice(1, 3).join(" ").slice(0, 80) })),
          spec, size_note: "", package_items: [], notice: [], faq: [], cta: { headline: title_ko.slice(0, 24), sub: "상세 정보를 확인하고 선택해 주세요" }, tone: "friendly",
        };
      }
      const rm = guardNumbers(copy);
      if (rm.length) { log("dim", `  📄 근거 없는 수치 ${rm.length}건 제거 · ${rm.slice(0, 5).join(" / ")}`); job.costs.numbersRemoved = (job.costs.numbersRemoved || 0) + rm.length; }
      writeJson(path.join(dir, "copy.json"), copy);
      emit(job, "copy", `✔ 카피 완성 (${how.copy}) · "${String(copy.headline || "").slice(0, 24)}"${rm.length ? ` · 근거 없는 수치 ${rm.length}건 제거` : ""}`, { how: how.copy, headline: copy.headline, numbersRemoved: rm.length }, 1);
    }

    job.title = (info?.product_name_ko ? String(info.product_name_ko).trim() : "") || String(copy?.name_ko || "").trim() || src.coupangName || notShop(title_ko) || notShop(src.title_zh) || job.title; // result.json·📄 목록 제목은 카피의 상품명으로

    // ④-5 AI 장면 사진 — 번역 직후 백그라운드로 시작한 것(scenePromise)을 여기서 기다린다(기획안·카피와 동시에 돌았다)
    check(job);
    if (scenePromise) { if (!job.sceneDone) emit(job, "scene", "AI 장면 사진 마무리 기다리는 중", null, 0.1); await scenePromise; }
    if (v5ScenePromise) { emit(job, "scene", "섹션 장면 마무리 기다리는 중", null, 0.1); await v5ScenePromise; }
    emit(job, "scene", scene?.items ? `✔ AI 장면 사진 ${scene.items.length}장 · 통과 ${scene.items.filter((x) => x.pass).length}장` : how.scene === "no-key" ? "이미지 생성 키를 넣으면 AI 장면 사진을 만듭니다 (📄 화면 설정 → 이미지 생성 키)" : `장면 사진 없음 (${how.scene || "skip"})`, scene?.items ? { made: scene.items.length, pass: scene.items.filter((x) => x.pass).length } : { noKey: how.scene === "no-key" }, 1);

    // 판매 실적·신뢰 배지: info.json 의 켠 항목만(재렌더 때도 info.json 에서 다시 읽어 유지). A3 가 이미 넣었으면 문구만 맞추고, 없으면 히어로 바로 뒤에 넣는다
    // A3 형식 claims(켠 것만, 끈 배지 묶음은 자동 생성 막음)
    const a3Claims = () => { const cl = readJson(path.join(dir, "info.json"))?.claims; const raw = toA3Claims(cl); if (!Object.values(raw).some((v) => (Array.isArray(v) ? v.length : v))) return null; let c = raw; try { if (mods.copy?.normalizeClaims) c = mods.copy.normalizeClaims(raw); } catch {} if (!cl?.trust_badges?.on) c = { ...c, trust_badges: [] }; return c; };
    const applyClaims = (plan) => {
      const cl = readJson(path.join(dir, "info.json"))?.claims;
      const want = claimSections(cl), a3 = a3Claims();
      plan.sections = (plan.sections || []).filter((x) => !claimTypes.has(x.type) || want.some((w) => w.type === x.type)); // 끈 항목은 빼기
      plan.sections.forEach((x) => { if (claimTypes.has(x.type)) x.claim = true; });
      if (!plan.sections.some((x) => claimTypes.has(x.type)) && want.length) { // A3 가 넣지 않았으면: A3 위치 규칙(insertClaimSections) → 없으면 히어로 뒤
        if (a3 && mods.planCore?.insertClaimSections) { plan.sections = mods.planCore.insertClaimSections(plan.sections, a3); plan.sections.forEach((x) => { if (claimTypes.has(x.type)) x.claim = true; }); }
        else { const hi = plan.sections.findIndex((x) => x.type === "hero"); plan.sections.splice(hi >= 0 ? hi + 1 : 0, 0, ...want); }
      }
      if (want.length) log("dim", `  📄 판매 실적·신뢰 배지 ${want.length}개 반영: ${want.map((w) => w.label).join(", ")}`);
    };
    // v6 원본 한글화: OCR 글 상자 → (A2 localizeImage 로 글자 지운 원본, 없으면 지운 전체본) → A3 translateLayers(한글 레이어) → A3 buildLocalizePlan → localize 템플릿
    const runLocalize = async () => {
      const pr = locPrepP ? await locPrepP : await locPrepFn(); if (pr?.error) throw pr.error;
      const { tl0, targets, files, layersById, locAi, tl, relFiles } = pr;
      let lplan = null;
      if (mods.planCore?.buildLocalizePlan) { try { lplan = mods.planCore.buildLocalizePlan({ source: { ...src, images }, localized: tl, copy, brief, cleaned, files: relFiles, vision, jobId: job.jobId, options, claims: a3Claims() }); } catch (e) { log("warn", `△ 📄 한글화 구성 실패 (${e?.message || e})`); } }
      if (!lplan) lplan = { meta: { jobId: job.jobId, templateId: "localize", width: WIDTH, version: 6 }, sections: targets.map((im) => ({ type: "image", id: im.id, image: relFiles[im.id], layers: ((tl.images || []).find((x) => x.id === im.id)?.layers || []).filter((l) => !l.drop && l.ko).map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, role: l.role, ko: l.ko, style: l.box?.style })) })) };
      // 번역이 안 된(한자만 남은) 레이어 빼기 · 이미지 원래 크기(iw·ih) — localize.js finishLocalizePlan(재생 하네스와 같은 코드)
      { // hero 로 고른 대표 사진에 JS 로 깨끗이 못 지운 글이 남았으면 그 장만 AI 로 다시(대표 사진 전부에 AI 를 쓰지 않는다 — v11 비용 절감)
        const hs = lplan.sections.find((x) => x.type === "hero" && x.id), hid = hs?.id, him = hid && targets.find((im) => im.id === hid);
        const left = (layersById[hid] || []).some((l) => l.erase && (l.erase.residue?.pass === false || !["solid", "gradient", "clone", "synth", "tiles"].includes(l.erase.method)));
        const locFn = mods.localize?.localizeImage;
        if (him && left && locFn && !process.env.SEEDHACK_DETAIL_NO_AI && hs.image === relFiles[hid]) {
          try { const o = ocr.images.find((x) => x.id === hid), r = await locFn({ file: him.file, ocrBoxes: (o?.boxes || []).filter((b) => !b.latin), keepBoxes: (o?.boxes || []).filter((b) => b.latin), out: files[hid], ai: true, settings: sceneSettingsNow(), log }); if (r?.ai?.used) { const c = (r.ai.billed || 0) * 0.039; locAi.used += r.ai.billed || 0; job.costs.localize = (job.costs.localize || 0) + c; job.costUsd = (job.costUsd || 0) + c; } } catch (e) { log("dim", `  🈚 hero ${hid} AI 다시 지우기 실패 (${e?.message || e})`); }
        }
      }
      if (mods.localize?.finishLocalizePlan) mods.localize.finishLocalizePlan(lplan, dir, { log, ocr });
      { // v11 지우기 방식·잔상 의심 집계(로그·결과 화면 점검용)
        const ls = (tl.images || []).flatMap((x) => x.layers || []).filter((l) => l.erase);
        const by = ls.reduce((m, l) => { const k = l.erase.method || "없음"; m[k] = (m[k] || 0) + 1; return m; }, {});
        job.localizeErase = { by, residueFail: ls.filter((l) => l.erase.residue && !l.erase.residue.pass).length, areas: ls.length };
        log("dim", `  🈚 지우기 ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(" · ")} · 잔상 의심 ${job.localizeErase.residueFail}/${ls.length}`);
      }
      // 🖼 통째 한글화(bake, 2026-11-23): 글이 든 장은 원본 + 우리 문구표를 이미지 AI 에 주어 한글로 다시 그린다 → 다시 읽어 검수 → 통과한 장은 그 그림을 그대로 쓰고(얹는 글 없음),
      //   떨어진 장만 예전 방식(지운 그림 + 얹는 글) 그대로. 설정 detailBake=false 또는 SEEDHACK_BAKE=off 로 끈다. 분당 한도가 낮아 동시 2장.
      if (!process.env.SEEDHACK_DETAIL_NO_AI && (store.get("settings") || {}).detailBake !== false) {
        try {
          const bk = await import("./bake.js"), auth = await bk.bakeAuth({ settings: sceneSettingsNow() }).catch(() => null);
          const secs = lplan.sections.filter((x) => x.type === "image" && x.id && (x.layers || []).length && targets.some((im) => im.id === x.id));
          if (auth && secs.length) {
            const tb0 = Date.now(), vOcr = mods.ocr?.ocrImages ? bk.makeBakeOcr(mods.ocr.ocrImages, { provider: job.ocrUse || undefined, log }) : null;
            let nx = 0, okN = 0, done = 0, usd = 0; const failed = [];
            // ✍ 장 단위 편집: 줄마다 옮긴 문구를 그림 한 장 단위로 묶어 다시 쓴다(문단 → 제목 + 3줄, 제목 다시 짓기). 설정 detailBakeEdit=false 로 끈다
            const lyOf = (id) => ((tl.images || []).find((x) => x.id === id)?.layers || []).filter((l) => String(l.zh || "").trim());
            let edited = new Map();
            const gptCopy = auth.engine === "codex"; // ✍ GPT 명령줄: 문구까지 GPT 가 쓴다 → 우리 쪽 장 단위 다듬기는 건너뛴다
            if (!gptCopy && mods.copy?.editForBake && (store.get("settings") || {}).detailBakeEdit !== false) {
              emit(job, job.step, `✍ 장마다 문구를 다듬는 중 · ${secs.length}장`, { bg: "localize", clk: "copy" }, 0);
              const ed = await mods.copy.editForBake({ images: secs.map((sec) => { const im = targets.find((x) => x.id === sec.id); return { id: sec.id, w: im?.w, h: im?.h, layers: lyOf(sec.id) }; }), brief: brief || null, log }).catch((e) => { log("dim", `  ✍ 장 단위 편집 실패 → 줄 단위 문구 그대로 (${String(e?.message || e).slice(0, 80)})`); return null; });
              if (ed?.byId) edited = ed.byId; if (ed?.costUsd) { job.costs.localize = (job.costs.localize || 0) + ed.costUsd; job.costUsd = (job.costUsd || 0) + ed.costUsd; }
              job.localizeEdit = { images: edited.size, blocks: ed?.used || 0, rejected: (ed?.rejected || []).length };
            }
            emit(job, job.step, `🖼 이미지 AI 로 한글화 그리는 중 · ${secs.length}장 (${gptCopy ? "GPT · 장당 1분 안팎" : "장당 30초 안팎"})`, { bg: "localize", clk: "bake" }, 0);
            const worker = async () => { for (;;) { const sec = secs[nx++]; if (!sec) return; check(job);
              const im = targets.find((x) => x.id === sec.id), o = ocr.images.find((x) => x.id === sec.id); let tlL = edited.get(sec.id) || lyOf(sec.id);
              const out = path.join(dir, "localize", `${sec.id}-bake.png`);
              const r = await bk.bakeImage({ file: im.file, layers: tlL, boxes: (o?.boxes || []).filter((b) => !b.latin), w: im.w || o?.w, h: im.h || o?.h, out, auth, ocr: vOcr, log, id: sec.id, free: gptCopy, brief: brief || null }).catch((e) => ({ ok: false, why: String(e?.message || e).slice(0, 80), usd: 0 }));
              usd += r.usd || 0; done++; check(job); if (r.ok && r.layers?.length) tlL = r.layers; // GPT 가 쓴 문구표(고치기·다시 그리기에 쓴다)
              if (r.ok) { okN++; sec.overlay = { image: sec.image, layers: sec.layers, iw: sec.iw, ih: sec.ih }; sec.image = path.relative(dir, out).split(path.sep).join("/"); sec.layers = []; sec.baked = { tries: r.tries, ...(r.verdict || {}) }; sec.bake = { layers: tlL.map((l) => ({ zh: String(l.zh || ""), ko: String(l.ko || ""), drop: !!l.drop || !String(l.ko || "").trim(), role: l.role || "", ...(l.block ? { block: l.block } : {}), ...(l.head ? { head: true } : {}) })) }; if (edited.has(sec.id)) sec.bakeCopy = tlL.filter((l) => l.block).map((l) => ({ idxs: l.block, ko: l.ko, head: !!l.head })); if (r.size) { sec.iw = r.size.width; sec.ih = r.size.height; } }
              else { failed.push(`${sec.id}(${r.why})`); sec.bakeFail = r.why; }
              emit(job, job.step, `🖼 한글화 그리기 ${done}/${secs.length}${r.ok ? "" : ` · ${sec.id} 검수 탈락 → 예전 방식`}`, { bg: "localize", clk: "bake" }, 0);
            } };
            await Promise.all(Array.from({ length: Math.min(2, secs.length) }, worker));
            if (usd) { job.costs.localize = (job.costs.localize || 0) + usd; job.costUsd = (job.costUsd || 0) + usd; }
            job.localizeBake = { total: secs.length, ok: okN, failed, usd: +usd.toFixed(2), ms: Date.now() - tb0 };
            log(okN === secs.length ? "go" : "info", `🖼 통째 한글화 ${okN}/${secs.length}장 · ${((Date.now() - tb0) / 1000).toFixed(0)}초 · 약 $${usd.toFixed(2)}${failed.length ? ` · 예전 방식으로: ${failed.join(", ")}` : ""}`);
          } else if (!auth) log("dim", "  🖼 통째 한글화 건너뜀(구글 이미지 AI 연결 없음) → 예전 방식");
        } catch (e) { if (e?.cancelled || e?.gptLimit) throw e; log("warn", `△ 🖼 통째 한글화 오류 → 예전 방식 (${String(e?.message || e).slice(0, 120)})`); }
      }
      job.timings ||= {}; job.localizeMs = Date.now() - tl0;
      emit(job, job.step, `🈚 원본 한글화 구성 · 이미지 ${lplan.sections.filter((x) => x.image).length}장 · 제외 ${(lplan.excluded || []).length}장 · ${((Date.now() - tl0) / 1000).toFixed(0)}초`, { bg: "localize" }, 0);
      return lplan;
    };
    const localizePlan = job.mode === "localize" ? await runLocalize() : null;

    // ⑦ 구성 + 긴 이미지 자르기 — makePlan(): qa 루프가 카피를 다시 쓰면 같은 절차로 다시 짠다
    check(job);
    emit(job, "plan", "페이지 구성을 짜는 중", null, 0.1);
    // "로고 있음" 사람 표시(info.logos[id] · scene.json item.human="logo") — 그 사진은 hero·POINT·feature·checkpoint 에 쓰지 않는다(AI 호출 없이 재구성)
    const LOGO_BLOCK = new Set(["hero", "point", "feature", "checkpoint"]);
    const logoView = () => {
      const lg = readJson(path.join(dir, "info.json"))?.logos || {};
      const on = new Set(Object.keys(lg).filter((k) => lg[k] === true)), off = new Set(Object.keys(lg).filter((k) => lg[k] === false));
      const vis = vision?.items ? { ...vision, items: vision.items.map((v) => (on.has(v.id) ? { ...v, any_logo_visible: true, has_logo: true, human: "logo" } : off.has(v.id) ? { ...v, any_logo_visible: false, has_logo: false } : v)) } : vision;
      const typeOf = new Map((sectionsV5 || []).map((x) => [x.id, x.type]));
      const sceneFiles = new Set((scene?.items || []).filter((x) => x.human === "logo").map((x) => x.file));
      const sc = scene?.items ? { ...scene, items: scene.items.filter((x) => !(x.human === "logo" && LOGO_BLOCK.has(typeOf.get(x.section) || ""))).map((x) => (x.human === "logo" ? { ...x, any_logo_visible: true } : x)) } : scene;
      const bad = (f) => { if (!f) return false; if (sceneFiles.has(f)) return true; const m = path.basename(String(f)).match(/^([a-z]\d+)(?:[_.-]|$)/i); return !!(m && on.has(m[1])); };
      return { vis, sc, bad, n: on.size + sceneFiles.size };
    };
    const makePlan = async () => {
    const LV = logoView();
    let plan = null;
    if (localizePlan) { plan = JSON.parse(JSON.stringify(localizePlan)); how.plan = "localize"; plan.meta = { ...(plan.meta || {}), jobId: job.jobId, templateId: "localize", width: plan.meta?.width || WIDTH }; plan.sections.forEach((sec, i) => { sec.id = sec.id || `l${pad(i + 1)}`; }); applyClaims(plan); return plan; }
    if (job.v5 && sectionsV5 && mods.planCore?.buildPlanV5) {
      try { plan = mods.planCore.buildPlanV5({ sections: sectionsV5, copy, scenes: LV.sc || null, vision: LV.vis, cleaned, source: src, jobId: job.jobId, templateId: job.templateId, claims: a3Claims() }); how.plan = "plan-v5"; fillItemScenes(plan, LV.sc); dedupeVisual(plan, dir); }
      catch (e) { log("warn", `△ 📄 v5 구성 실패 → 기존 구성 (${e?.message || e})`); plan = null; }
    }
    if (!plan) {
    if (mods.planCore?.buildPlan) {
      try { plan = mods.planCore.buildPlan({ source: { ...src, title_ko, attrs, options }, ocr, cleaned, copy, vision: LV.vis || null, brief: brief || null, cutout: cutout || null, palette: cutout?.palette || null, scenes: LV.sc || null, templateId: job.templateId }); how.plan = "plan-core"; } // scenes: plan-core 가 hero→point→usp 에 배치(A3)
      catch (e) { log("warn", `△ 📄 구성 실패 → 최소 구성 (${e?.message || e})`); plan = null; }
    }
    if (!plan) {
      how.plan = "lite";
      const byId = (id) => cleaned.find((c) => c.id === id);
      const gal = cleaned.filter((c) => c.kind === "gallery"), det = cleaned.filter((c) => c.kind === "detail");
      const hero = gal[0] || det[0];
      const cuts = [];
      const cap = (id) => copy.captions?.find((c) => c.imageId === id) || {};
      const features = det.filter((d) => d !== hero).flatMap((d) => {
        if (d.h > d.w * 2.5) { // 긴 이미지는 1500px 단위로
          const parts = [];
          for (let y = 0, k = 1; y < d.h; y += 1500, k++) { const out = `clean/${d.id}_${k}.png`; cuts.push({ src: d.file, out, rect: { x: 0, y, w: d.w, h: Math.min(1500, d.h - y) } }); parts.push({ type: "feature", image: out, title: k === 1 ? cap(d.id).title || "" : "", desc: k === 1 ? cap(d.id).desc || "" : "", overlay: [] }); }
          return parts;
        }
        return [{ type: "feature", image: d.file, title: cap(d.id).title || "", desc: cap(d.id).desc || "", overlay: (d.boxesOut || []).filter((b) => b.onPhoto).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, text: b.text_ko || "" })) }];
      });
      plan = { meta: { jobId: job.jobId, templateId: job.templateId, width: WIDTH, createdAt: Date.now() }, product: { name_ko: copy.name_ko, keyword: src.keyword || "" }, cuts,
        sections: [
          hero ? { type: "hero", image: hero.file, headline: copy.headline, sub: copy.sub, badges: copy.badges || [] } : null,
          copy.pain?.items?.length ? { type: "pain", title: copy.pain.title, items: copy.pain.items } : null,
          copy.usp?.items?.length ? { type: "usp", title: copy.usp.title, items: copy.usp.items.map((u) => ({ ...u, image: u.imageId ? byId(u.imageId)?.file || null : null })) } : null,
          ...features,
          gal.length > 1 ? { type: "gallery", images: gal.slice(1).map((g) => g.file) } : null,
          copy.spec?.length ? { type: "spec", rows: copy.spec, image: null } : null,
          copy.package_items?.length ? { type: "package", items: copy.package_items, image: null } : null,
          copy.notice?.length ? { type: "notice", items: copy.notice } : null,
          copy.faq?.length ? { type: "faq", items: copy.faq } : null,
          { type: "cta", headline: copy.cta?.headline || copy.headline, sub: copy.cta?.sub || "", image: null },
        ].filter(Boolean) };
    }
    }
    plan.meta = { ...(plan.meta || {}), jobId: job.jobId, templateId: job.templateId, width: plan.meta?.width || WIDTH, ...(job.v5 && job.theme ? { theme: job.theme } : {}) };
    if (job.v5 && job.theme === "custom") { const rt = (reference || readJson(path.join(dir, "reference", "reference.json")))?.tokens; if (rt) plan.meta.refTokens = rt; } // 벤치마킹 손잡이 → custom 테마
    applyClaims(plan);
    // 로고 표시한 사진이 막힌 섹션에 남았으면 빼기(마지막 안전망)
    if (LV.n) { let k = 0; for (const sec of plan.sections || []) { if (!LOGO_BLOCK.has(sec.type)) continue; if (LV.bad(sec.image)) { sec.image = null; sec.from = "logo-removed"; k++; } if (Array.isArray(sec.images)) { const n0 = sec.images.length; sec.images = sec.images.filter((f) => !LV.bad(f)); k += n0 - sec.images.length; } } log("dim", `  📄 로고 있음 표시 ${LV.n}장 — hero·POINT·feature·checkpoint 에서 제외${k ? ` (구성 뒤 ${k}곳 추가로 뺌)` : ""}`); }
    if (textEdgeDropped.length) { plan.dropped = Array.isArray(plan.dropped) ? plan.dropped : []; textEdgeDropped.forEach((d) => { if (!plan.dropped.some((x) => x.id === d.id)) plan.dropped.push(d); }); }
    for (const c of plan.cuts || []) {
      check(job);
      const srcF = path.isAbsolute(c.src) ? c.src : path.join(dir, c.src), outF = path.join(dir, c.out);
      try {
        if (mods.image?.cropRect) await mods.image.cropRect(srcF, outF, c.rect);
        else { const ni = nativeImage.createFromPath(srcF); if (ni.isEmpty()) throw new Error("그림 해석 실패"); fs.writeFileSync(outF, ni.crop({ x: c.rect.x, y: c.rect.y, width: c.rect.w, height: c.rect.h }).toPNG()); }
      } catch (e) { log("dim", `  📄 자르기 실패 ${c.out} (${e?.message || e})`); continue; }
      // 조각의 빈 여백을 줄이고(autoTrim, 파일 덮어쓰기 — 템플릿은 실제 파일 크기로 그린다) 내용 비율을 잰다
      let ratio = null;
      try {
        if (mods.image?.autoTrim) mods.image.autoTrim(outF, outF); // 가장자리 여백
        const sq = squeezeGaps(outF); if (sq && sq.to < sq.from) c.squeezed = sq; // 안쪽 긴 빈 띠
        if (mods.image?.autoTrim) ratio = mods.image.autoTrim(outF, outF)?.contentRatio ?? null; // 띠를 줄인 뒤 다시 가장자리 정리 + 내용 비율
        if (ratio == null && mods.image?.imageInfo) ratio = mods.image.imageInfo(outF, { ratio: true })?.contentRatio ?? null;
      } catch (e) { log("dim", `  📄 조각 여백 자르기 실패 ${c.out} (${e?.message || e})`); }
      c.contentRatio = Number.isFinite(ratio) ? ratio : null;
    }
    // 거의 빈 조각(contentRatio < 0.06 — 긴 이미지의 여백·머리글만 남은 부분)은 섹션에서 뺀다 (QA F-6: 구성품 섹션에 흰 판)
    const BLANK_CUT = 0.06;
    const blankCuts = new Set((plan.cuts || []).filter((c) => c.contentRatio != null && c.contentRatio < BLANK_CUT).map((c) => c.out));
    if (blankCuts.size) {
      plan.dropped = Array.isArray(plan.dropped) ? plan.dropped : [];
      const isBlank = (p) => !!p && blankCuts.has(String(p).replace(/\\/g, "/"));
      const markDrop = (p) => { const id = path.basename(String(p), path.extname(String(p))); if (!plan.dropped.some((d) => d.id === id)) plan.dropped.push({ id, why: "blank-cut" }); };
      plan.sections = plan.sections.filter((sec) => {
        if (sec.type === "feature" && isBlank(sec.image)) { markDrop(sec.image); return false; } // 그림이 전부인 섹션은 통째로
        if (["size", "package", "spec", "hero", "cta", "usp"].includes(sec.type) && isBlank(sec.image)) { markDrop(sec.image); sec.image = null; } // 글은 남기고 그림만
        if (Array.isArray(sec.items)) sec.items.forEach((it) => { if (it && typeof it === "object" && isBlank(it.image)) { markDrop(it.image); it.image = null; } });
        if (sec.type === "gallery" && Array.isArray(sec.images)) { sec.images.filter(isBlank).forEach(markDrop); sec.images = sec.images.filter((p) => !isBlank(p)); if (!sec.images.length) return false; }
        return true;
      });
      log("dim", `  📄 빈 조각 ${blankCuts.size}개 제외 · ${[...blankCuts].join(", ")}`);
    }
    { // 팔레트: hero 로 뽑힌 이미지의 누끼 palette → 없으면 누끼 중 첫 번째 → 없으면 null(템플릿 기본색)
      const heroSec = plan.sections.find((sec) => sec.type === "hero");
      const heroId = heroSec?.image ? path.basename(String(heroSec.image)).replace(/(_cut|_full)?\.\w+$/, "") : null;
      const heroPal = heroId ? cleaned.find((c) => c.id === heroId)?.cutout?.palette : null;
      plan.meta.palette = heroPal || cleaned.find((c) => c.cutout?.palette)?.cutout.palette || null;
      if (job.styleGuide) { plan.meta.styleGuide = job.styleGuide; const sg = job.styleGuide; const pal = sg.palette || sg.colorPalette, acc = sg.accents || sg.accentColors, bg = sg.background || sg.backgroundColor; if (bg || pal?.length) plan.meta.palette = { ...(plan.meta.palette || {}), dominant: pal?.length ? pal : plan.meta.palette?.dominant, accent: acc?.[0] || plan.meta.palette?.accent, bg: bg || plan.meta.palette?.bg }; }
    }
    if (cutout?.items?.length && !plan.cutouts) plan.cutouts = cutout.items.filter((x) => x.ok && x.file).map((x) => ({ id: x.id, file: x.file, w: x.w, h: x.h }));
    plan.sections.forEach((sec, i) => { sec.id = sec.id || `s${pad(i + 1)}`; }); // qa 결함이 가리킬 섹션 id
    plan.sections.forEach((sec) => { if (sec.image && /^scene\//.test(String(sec.image))) sec.scene = true; }); // 결과 화면 "AI 생성 이미지 확인" 안내용
    return plan;
    };
    let plan = await makePlan();
    writeJson(path.join(dir, "plan.json"), plan);
    emit(job, "plan", `✔ 섹션 ${plan.sections.length}개 · 자른 이미지 ${plan.cuts?.length || 0}개 · 템플릿 ${job.templateId}`, { sections: plan.sections.map((s) => s.type), cuts: plan.cuts?.length || 0 }, 1);

    // ⑦-2 확인(review) — 사람 손 30초: 패널이 plan 을 보여 주고(detail:plan:get) 사진 교체·헤드라인 편집(detail:plan:set) 뒤 "이대로 렌더"(detail:continue).
    //   job.review 가 꺼져 있으면(e2e·발표 모드 자동) 바로 지나간다. 기다리는 동안 취소는 그대로 된다.
    check(job);
    job.cleaned = cleaned; job.vision = vision || null; job.copy = copy;
    if (job.review) {
      emit(job, "review", "구성 확인 — 사진 교체·헤드라인 수정 뒤 '이대로 렌더'를 눌러 주세요", { waiting: true, sections: plan.sections.map((s) => ({ id: s.id, type: s.type, image: s.image || null })) }, 0.2);
      await new Promise((res, rej) => { job.continueWaiter = res; const t = setInterval(() => { if (job.cancelled) { clearInterval(t); job.continueWaiter = null; rej(Object.assign(new Error("취소됨"), { cancelled: true })); } }, 300); job.continueTimer = t; });
      clearInterval(job.continueTimer); job.continueWaiter = null;
      const edited = readJson(path.join(dir, "plan.json"));
      if (edited?.sections?.length) plan = edited;
      emit(job, "review", "✔ 확인 완료 — 렌더로 넘어갑니다", { waiting: false }, 1);
    } else emit(job, "review", job.reviewSkipped || "확인 단계 건너뜀(자동)", null, 1);

    // ⑧ 렌더 — 렌더마다 out/<템플릿>/ (같은 템플릿을 또 그리면 out/<템플릿>-2/ …)에 보관하고 result.json renders[] 에 쌓는다(덮어쓰지 않음)
    //   render.js·renderLite 는 <jobDir>/out 에 쓰므로, 작업 폴더의 그림 폴더(clean·scene·raw·cutout)를 링크한 무대(.render/)를 jobDir 로 넘겨 그리고 out/<id>/ 로 옮긴다.
    //   qa 루프가 다시 그릴 때는 같은 id 를 덮어쓴다(검수 반영본 = 그 렌더). 실패하면 이전 렌더들은 그대로.
    const onR = ({ done, total, id, msg }) => emit(job, "render", /[가-힣]/.test(msg || "") ? msg : `🖼 ${msg || id || "그리는 중"} (${done}/${total}장)`, { done, total, id }, total ? Math.max(0.05, Math.min(0.98, done / total)) : 0.5);
    const renderId = allocRenderId(dir, job.v5 && job.theme ? `card-${job.theme}` : job.templateId);
    job.renderId = renderId;
    const tplReady = (id) => exists(path.join(__dirname, "../../renderer/detail-templates", id, "index.html"));
    const renderNow = (label = "") => renderInto(plan, job.templateId, renderId, label);
    const renderInto = async (plan, tplId, renderId, label = "") => {
      check(job);
      emit(job, "render", `${tplId} 템플릿으로 그리는 중${label}`, null, 0.05);
      const stage = prepareStage(dir);
      let out = null;
      try {
        if (mods.render?.renderPlan) {
          if (job.theme) plan.meta = { ...(plan.meta || {}), theme: job.theme };
          if (tplId === "localize" && !tplReady("localize")) out = null; // A4 localize 템플릿이 아직 없으면 자체 렌더
          else try { out = await mods.render.renderPlan({ plan, jobDir: stage, templateId: tplId, theme: tplId === "card" ? job.theme || undefined : undefined, onProgress: onR }); how.render = "render"; }
          catch (e) { if (e?.cancelled) throw e; log("warn", `△ 📄 템플릿 렌더 실패 → 자체 렌더 (${e?.message || e})`); out = null; }
        }
        if (!out?.slices?.length) { out = await renderLite({ plan, jobDir: stage, onProgress: onR }); how.render = "lite"; }
      } catch (e) {
        fs.rmSync(path.join(stage, "out"), { recursive: true, force: true });
        if (e?.cancelled) throw e;
        throw Object.assign(new Error(`렌더 실패 · ${e?.message || e}`), { keepPrev: true });
      }
      out = moveRender(dir, stage, renderId, out);
      job.renderIssues = Array.isArray(out?.check?.issues) ? out.check.issues.slice(0, 30) : [];
      emit(job, "render", `✔ 이미지 ${out.slices.length}장 · 세로 합 ${out.slices.reduce((n, s) => n + (s.h || 0), 0).toLocaleString("ko-KR")}px · out/${renderId}${label}`, { done: out.slices.length, total: out.slices.length, renderId }, 1);
      return out;
    };
    let rendered = await renderNow();
    // "둘 다": AI 장면 렌더 뒤에 원본 한글화 렌더를 하나 더(새 렌더 탭)
    let extraRender = null;
    if (job.mode === "both" && !job.regen) {
      try { const lp = await runLocalize(); applyClaims(lp); writeJson(path.join(dir, "plan-localize.json"), lp); const rid2 = allocRenderId(dir, "localize"); const r2 = await renderInto(lp, "localize", rid2, " (원본 한글화)"); extraRender = { id: rid2, rendered: r2, plan: lp }; }
      catch (e) { if (e?.cancelled) throw e; log("warn", `△ 📄 원본 한글화 렌더 실패 (${e?.message || e})`); }
    }
    // 원본 한글화 앱 내 검수 — 결과를 먼저 보여 주고 뒤에서(afterDone) 검수·수정(loc-qa.js). 끄기: 설정 detailLocQa=false
    { const lr = extraRender ? { id: extraRender.id, plan: extraRender.plan, planFile: "plan-localize.json" } : job.templateId === "localize" && localizePlan ? { id: job.renderId, plan, planFile: "plan.json" } : null;
      if (lr && (store.get("settings") || {}).detailLocQa !== false && process.env.SEEDHACK_LOCQA !== "0") job.locQaCtx = { dir, renderId: lr.id, plan: JSON.parse(JSON.stringify(lr.plan)), planFile: lr.planFile, raw: Object.fromEntries(images.map((im) => [im.id, im.file])) }; }

    // ⑧-2 AI 자가 검수(qa) — 완성 슬라이스를 Claude CLI 가 Read 로 직접 보고 점수(1~5)·결함을 돌려준다 → 사진 교체/섹션 삭제/카피 재작성 → 재렌더 → 다시 검수. 최대 2회, 4점 이상이면 멈춤
    check(job);
    let qa = null;
    const usedImages = () => new Set(plan.sections.flatMap((sec) => [sec.image, ...(sec.images || []), ...((sec.items || []).map((it) => it?.image))]).filter(Boolean).map((p) => String(p).replace(/\\/g, "/")));
    const spareImages = () => { const used = usedImages(); return cleaned.filter((c) => c?.photo?.file && visionOk(c.id) && !used.has(c.photo.file)).sort((a, b) => (vision?.items?.find((x) => x.id === b.id)?.score || 0) - (vision?.items?.find((x) => x.id === a.id)?.score || 0)); };
    const qaLater = job.v5 && !process.env.SEEDHACK_DETAIL_NO_AI && !job.skipQa && (store.get("settings") || {}).detailQaInline !== true;
    if (qaLater) { how.qa = "background"; emit(job, "qa", "결과를 먼저 보여 드리고 AI 자가 검수는 뒤에서 합니다", null, 1);
      job.qaCtx = { slices: rendered.slices, plan, copy, dir, title: job.title, evidence: qaEvidence, renderId: job.renderId }; }
    else if (job.mode === "localize" || plan.meta?.templateId === "localize") { how.qa = "locqa"; emit(job, "qa", "결과를 먼저 보여 드리고 원본 한글화 검수는 뒤에서 합니다", null, 1); } // 카드용 자가 검수(사진 교체·카피 다시)는 한글화에 맞지 않고 결과를 ~3분 늦췄다 → 뒤 검수(loc-qa.js)가 대신
    else if (process.env.SEEDHACK_DETAIL_NO_AI || job.skipQa) { how.qa = "skip"; emit(job, "qa", job.skipQa ? "고친 섹션만 다시 그림 — 자가 검수 생략" : "AI 없이 진행 — 자가 검수 생략", null, 1); }
    else if (!mods.cli?.runStructured || !mods.cli?.cliAvailable?.()) { how.qa = "skip"; emit(job, "qa", "Claude CLI 없음 — 자가 검수 생략", null, 1); }
    else {
      const rounds = []; let fixedTotal = 0;
      let best = null;
      for (let round = 0; round < 2; round++) { // 속도: 1회 검수, 3점 이하일 때만 고쳐서 2회차
        check(job);
        emit(job, "qa", `AI가 완성본 ${rendered.slices.length}장을 검수하는 중 (${round + 1}회차)`, { round: round + 1, done: 0, total: rendered.slices.length }, 0.05 + round * 0.3);
        const tq = Date.now();
        const ri = (job.renderIssues || []).map((x) => (typeof x === "string" ? x : [x.section || x.sec || "", x.kind || x.type || "", x.msg || x.what || x.message || JSON.stringify(x)].filter(Boolean).join(" "))).slice(0, 15);
        const r = await qaReview({ slices: rendered.slices, plan, copy, dir, title: job.title, evidence: qaEvidence + (ri.length ? `\n\n렌더 자동 점검(대비·글자 크기 등)에서 나온 문제 — 보이면 layout 결함으로 포함:\n${ri.join("\n")}` : "") });
        if (r?.error) { log("warn", `△ 📄 자가 검수 실패 → 중단 (${r.error})`); emit(job, "qa", `△ 자가 검수 실패 · ${r.error}`, null, 1); how.qa = rounds.length ? "cli" : "skip"; break; }
        if (r.costUsd != null) { job.costs.qa = (job.costs.qa || 0) + r.costUsd; job.costUsd = (job.costUsd || 0) + r.costUsd; }
        const rec = { round: round + 1, score: r.score, defects: r.defects, ms: Date.now() - tq, costUsd: r.costUsd ?? null, fixes: [] };
        rounds.push(rec); how.qa = "cli";
        if (!best || r.score > best.score) best = { score: r.score, defects: r.defects, copy: JSON.parse(JSON.stringify(copy)), plan: JSON.parse(JSON.stringify(plan)), round: round + 1 };
        emit(job, "qa", `👁 ${round + 1}회차 점수 ${r.score}/5 · 결함 ${r.defects.length}건${r.defects.length ? " · " + r.defects.slice(0, 3).map((d) => `${d.section || d.slice || ""} ${d.kind}: ${String(d.what).slice(0, 30)}`).join(" / ") : ""}`, { round: round + 1, score: r.score, defects: r.defects.length }, 0.25 + round * 0.3);
        if (r.score >= 4 || !r.defects.length || round === 1) break;
        // 고치기
        let needCopy = false, changed = 0;
        const byId = (id) => plan.sections.findIndex((sec) => sec.id === id || sec.type === id);
        for (const d of r.defects) {
          const i = byId(String(d.section || "")); const sec = plan.sections[i];
          if (d.fix === "drop_section" && sec && sec.type !== "hero" && sec.type !== "cta") { plan.sections.splice(i, 1); rec.fixes.push(`${d.section} 섹션 삭제`); changed++; }
          else if (d.fix === "swap_image" && sec) {
            const alt = spareImages()[0];
            if (alt) { if (sec.image) sec.image = alt.photo.file; else if (Array.isArray(sec.images) && sec.images.length) sec.images[0] = alt.photo.file; rec.fixes.push(`${d.section} 사진 → ${alt.id}`); changed++; }
            else if (sec.type === "feature" || sec.type === "gallery") { plan.sections.splice(i, 1); rec.fixes.push(`${d.section} 대체 사진 없음 → 섹션 삭제`); changed++; }
            else if (sec.image) { sec.image = null; rec.fixes.push(`${d.section} 사진 뺌`); changed++; }
          }
          else if (d.fix === "rewrite") needCopy = true;
          else if (d.fix === "rerender") changed++;
        }
        if (needCopy && mods.copy?.writeCopy) {
          emit(job, "qa", `✍ 카피 다시 쓰는 중 (검수 지적 ${r.defects.filter((d) => d.fix === "rewrite").length}건 반영)`, null, 0.3 + round * 0.3);
          try {
            const fb = r.defects.filter((d) => d.fix === "rewrite").map((d) => `[${d.section || d.slice}] ${d.what}`);
            const rc = job.v5 && mods.copy?.writeCopyV5 ? await mods.copy.writeCopyV5({ ...copyInput, feedback: fb, previous: copy }, { brief: brief || {}, sections: sectionsV5, log, timeoutMs: 360000 }) : await mods.copy.writeCopy({ ...copyInput, feedback: fb, previous: copy }, { log, vision: vision || null, brief: brief || null, timeoutMs: 360000, only: [...new Set(r.defects.filter((d) => d.fix === "rewrite").map((d) => plan.sections.find((sec) => sec.id === d.section)?.type || d.section))], feedback: fb });
            if (rc?.copy && rc.how === "rules" && how.copy !== "rules") { log("warn", "△ 📄 카피 재작성이 규칙 카피로 떨어져 버림(원래 AI 카피 유지)"); }
            else if (rc?.copy) { copy = rc.copy; const rm2 = guardNumbers(copy); if (rm2.length) rec.fixes.push(`근거 없는 수치 ${rm2.length}건 제거`); writeJson(path.join(dir, "copy.json"), copy); if (rc.costUsd != null) { job.costs.copy = (job.costs.copy || 0) + rc.costUsd; job.costUsd = (job.costUsd || 0) + rc.costUsd; } const kept = plan; plan = await makePlan(); // 카피가 바뀌면 구성 다시 — 앞에서 지운 섹션·바꾼 사진은 유지
              const removed = new Set(rounds.flatMap((x) => x.fixes).filter((f) => /섹션 삭제/.test(f)).map((f) => f.split(" ")[0]));
              plan.sections = plan.sections.filter((sec) => !removed.has(sec.id));
              kept.sections.forEach((ks) => { const ns = plan.sections.find((sec) => sec.id === ks.id); if (ns && ks.image && ns.image && ks.image !== ns.image) ns.image = ks.image; });
              rec.fixes.push(`카피 재작성 ${fb.length}건`); changed++; }
          } catch (e) { log("dim", `  📄 카피 재작성 실패 (${e?.message || e})`); }
        }
        if (!needCopy && r.defects.some((d) => d.kind === "fact")) { const rm3 = guardNumbers(copy); if (rm3.length) { rec.fixes.push(`근거 없는 수치 ${rm3.length}건 제거`); writeJson(path.join(dir, "copy.json"), copy); plan = await makePlan(); changed++; } }
        fixedTotal += rec.fixes.length;
        if (!changed) break;
        writeJson(path.join(dir, "plan.json"), plan);
        rendered = await renderNow(` (검수 반영 ${round + 1})`);
      }
      if (best && rounds.length && rounds[rounds.length - 1].score < best.score) { // 고친 판이 더 나쁘면 가장 좋았던 판으로 되돌린다
        copy = best.copy; plan = best.plan; writeJson(path.join(dir, "copy.json"), copy); writeJson(path.join(dir, "plan.json"), plan);
        emit(job, "qa", `↩ ${best.round}회차 판(${best.score}/5)이 더 좋아 되돌림`, null, 0.9);
        rendered = await renderNow(" (가장 좋은 판으로 되돌림)");
        rounds.push({ round: rounds.length + 1, score: best.score, defects: best.defects, reverted: best.round, fixes: [] });
      }
      if (rounds.length) {
        const last = rounds[rounds.length - 1];
        qa = { score: last.score, defects: last.defects, rounds, fixed: fixedTotal, passed: last.score >= 4 };
        writeJson(path.join(dir, "qa.json"), qa);
        emit(job, "qa", `✔ AI 검수 ${last.score}/5 · 고친 것 ${fixedTotal}건 · ${rounds.length}회차${last.defects.length ? ` · 남은 지적 ${last.defects.length}건` : ""}`, { score: last.score, fixed: fixedTotal, rounds: rounds.length, remaining: last.defects.length }, 1);
      }
    }

    if (job.v5 && sectionsV5 && !job.regen?.fill && how.scene && !["no-key", "skip", "reuse"].includes(how.scene)) {
      const passSec = new Set((scene?.items || []).filter((x) => x.pass).map((x) => x.section));
      job.fillLater = sectionsV5.filter((x) => x.shot && !passSec.has(x.id)).map((x) => x.id);
    }
    // ⑨ 완료
    const result = {
      jobId: job.jobId, status: "done", title: job.title, url: src.url, offerId: src.offerId, templateId: job.templateId, createdAt: job.createdAt, finishedAt: Date.now(), durationMs: Date.now() - t0,
      slices: rendered.slices, preview: rendered.preview, html: rendered.html, figmaManifest: rendered.figmaManifest, figmaBundle: rendered.figmaBundle || "out/figma-bundle.json",
      counts: { images: images.length, boxes: ocr.images.reduce((n, x) => n + (x.boxes?.length || 0), 0), erased: cleaned.reduce((n, c) => n + (c.erased || 0), 0), sections: plan.sections.length, translated: trMap.size },
      how, costUsd: job.costUsd ?? null, costs: job.costs || {}, vision: vision ? { items: vision.items.length, usable: vision.items.filter((x) => x.usable).length, ms: vision.ms ?? null } : null, rowId: src.rowId ?? null,
      timings: (() => { const st = STEPS.filter((k) => job.timings?.[k]).map((k) => [k, job.timings[k].start]); const now = Date.now(); return { ...Object.fromEntries(st.map(([k, t], i) => [k, (st[i + 1]?.[1] ?? now) - t])), ...(scene?.ms && how.scene !== "reuse" ? { sceneGen: scene.ms } : {}), total: now - t0 }; })(), // 단계 시작~다음 단계 시작(ms) · sceneGen = 장면 생성 실제 시간(기획·카피와 겹침)
      renderCheck: job.renderIssues?.length ? job.renderIssues : [],
      qa: qa ? { score: qa.score, fixed: qa.fixed, rounds: qa.rounds.length, remaining: qa.defects.length, passed: qa.passed, defects: qa.defects.slice(0, 10) } : null,
      brief: brief ? { how: how.brief, angle: brief.angle || brief.headline || "", audience: brief.audience || "" } : null,
      scene: scene ? { provider: scene.provider, model: scene.model, made: scene.items.length, passed: scene.items.filter((x) => x.pass).length, used: plan.sections.filter((sec) => sec.scene).length } : (how.scene === "no-key" ? { noKey: true } : null), cutout: cutout ? { items: cutout.items.length, ok: cutout.items.filter((x) => x.ok && x.file).length, palette: cutout.palette || null } : null,
      ...((relay?.relayNotice?.() || job.aiFails?.length) ? { aiNotice: [job.aiFails?.length ? `AI 연결 문제로 ${[...new Set(job.aiFails)].join("·")}을(를) AI 없이 만들었어요 — 품질이 낮을 수 있어요` : "", relay?.relayNotice?.() || ""].filter(Boolean).join(" · ") } : {}),
    };
    if (result.aiNotice) log("warn", `△ 📄 ${result.aiNotice}`);
    { // 렌더 내역: 이전 result.json 의 renders(또는 옛 out/ 바로 아래 결과)를 이어받아 이번 렌더를 덧붙인다
      const prevR = migrateRenders(readJson(path.join(dir, "result.json")) || {});
      if (!qa && prevR.qa?.background) result.qa = prevR.qa; // 뒤 작업(빠진 장면 채우기·테마)이 앞 렌더의 뒤 검수 결과를 지우지 않게
      const entry = { theme: job.theme || null, templateRef: job.theme === "custom" ? readJson(path.join(dir, "info.json"))?.templateRef || null : null, sections: Array.isArray(rendered.sections) ? rendered.sections.map((x) => ({ type: x.type, id: x.id || null, y: x.y, h: x.h ?? null })) : [], width: rendered.width || plan.meta?.width || WIDTH, label: job.regen?.label || "", id: job.renderId, templateId: job.templateId, createdAt: Date.now(), dir: `out/${job.renderId}`, slices: rendered.slices, preview: rendered.preview, html: rendered.html, figmaManifest: rendered.figmaManifest, figmaBundle: rendered.figmaBundle || `out/${job.renderId}/figma-bundle.json`, qa: qa ? qa.score : null, sliceCount: rendered.slices.length };
      result.renders = [...(prevR.renders || []).filter((x) => x.id !== entry.id), entry];
      if (extraRender) { const r2 = extraRender.rendered; result.renders = [...result.renders.filter((x) => x.id !== extraRender.id), { id: extraRender.id, templateId: "localize", mode: "localize", createdAt: Date.now(), dir: `out/${extraRender.id}`, slices: r2.slices, preview: r2.preview, html: r2.html, figmaManifest: r2.figmaManifest, figmaBundle: r2.figmaBundle, sliceCount: r2.slices.length, qa: null, sections: (r2.sections || []).map((x) => ({ type: x.type, id: x.id || null, y: x.y })), width: r2.width || WIDTH, label: "원본 한글화" }]; }
      entry.mode = job.mode || null;
      result.current = entry.id;
      result.clock = clockSnap(job) || prevR.clock || null; // ⏱ 처음 만들 때 잰 시간(다시 렌더·테마 바꾸기는 예전 기록을 그대로 둔다)
      if (job.clock && result.clock) log("info", `⏱ 실제 걸린 시간 ${fmtDur(result.clock.totalMs)} — ${result.clock.rows.slice().sort((a, b) => b.ms - a.ms).slice(0, 4).map((x) => `${x.label} ${fmtDur(x.ms)}`).join(" · ")}`);
    }
    writeJson(path.join(dir, "result.json"), result);
    emit(job, "done", `■ 상세페이지 완성 · ${rendered.slices.length}장 · ${((Date.now() - t0) / 1000).toFixed(1)}초`, { durationMs: Date.now() - t0, slices: rendered.slices.length, dir, timings: result.timings, clock: result.clock || null }, 1);
    return result;
  }

  // ---------- 작업 시작/취소 ----------
  // reference: 벤치마킹 레퍼런스(reference.json 경로 또는 이미지 폴더) — info.json 에 적고 테마 custom · 섹션·카피는 새로(장면은 섹션 id 를 이어 받아 재사용)
  // templateRef: 🧲 내 템플릿 id — info.json 에 적고 테마 custom(보관함 토큰·섹션 순서·각도) · 섹션·카피는 새로. keepExtra: 우리 강점 섹션 유지 토글(생략하면 info 값 그대로)
  let pageReadT0 = 0; // ⏱ 주소로 만들기: 버튼 누른 시각(상품 화면을 여는·읽는 시간을 잰다)
  let planFirstNext = false; // 다음 새 작업 한 번만: 기획안 확인 화면에서 멈춘다
  function start({ source, jobId, templateId, reuse, fresh = [], review, phase, regen = null, skipQa = false, theme = null, bg = false, mode = null, reference = null, templateRef = null, keepExtra = null, auto = false, readMs = 0 }) {
    sceneSettingsNow(); // 🧪 만드는 AI 설정(GPT)을 글 AI 에도 반영
    if (jobId && reference) { const f = path.join(jobDirOf(jobId), "info.json"); const inf = readJson(f) || {}; delete inf.templateRef; writeJson(f, { ...inf, reference: String(reference), theme: "custom", ...(typeof keepExtra === "boolean" ? { refKeepExtra: keepExtra } : {}) }); theme = "custom"; fresh = [...new Set([...fresh, "sections", "copy"])]; }
    if (jobId && templateRef) { if (!isMine(templateRef)) return { error: "그 템플릿이 보관함에 없습니다" }; const f = path.join(jobDirOf(jobId), "info.json"); const inf = readJson(f) || {}; delete inf.reference; writeJson(f, { ...inf, templateRef: String(templateRef), theme: "custom", ...(typeof keepExtra === "boolean" ? { refKeepExtra: keepExtra } : {}) }); theme = "custom"; fresh = [...new Set([...fresh, "sections", "copy"])]; }
    // 가드: v5 작업(sections.json 이 있거나 plan v5)에서 다른 템플릿을 고르면 옛 v1 구성으로 다시 짜지 않고 card 엔진 테마만 바꾼다
    if (jobId && reuse && templateId && templateId !== "card" && isV5Job(jobId)) {
      if (!theme) theme = THEMES.some((t) => t.id === templateId) ? templateId : "ivory";
      templateId = "card"; skipQa = true; fresh = fresh.filter((f) => !["copy", "scene", "sections", "brief", "vision"].includes(f));
      regen = regen || { theme: true, label: `테마 ${theme}` };
    }
    if (cur) return { error: "이미 상세페이지를 만드는 중입니다 — 끝나거나 취소한 뒤 다시 눌러 주세요", jobId: cur.jobId };
    let tid = TEMPLATES.some((t) => t.id === templateId) ? templateId : "clean";
    let id = jobId || `${stamp()}-${String(source?.offerId || "").replace(/\D/g, "") || rand6()}`;
    if (!jobId && exists(jobDirOf(id))) id += `-${rand6()}`; // 같은 초에 같은 상품을 두 번 → 폴더 충돌 방지
    const job = { jobId: id, dir: jobDirOf(id), status: "running", step: "extract", pct: 0, t0: Date.now(), createdAt: reuse ? readJson(path.join(jobDirOf(id), "result.json"))?.createdAt || Date.now() : Date.now(), cancelled: false, title: "", templateId: tid, events: [], costUsd: null, costs: {} };
    // 확인(review) 단계: 요청값 > 설정(detailReview, 기본 켬). 패널 창이 없으면(하네스) 끈다
    const st = store.get("settings") || {};
    job.phase = phase || undefined;
    // 한 번에 만들기(기본): 새 상품의 1단계(수집·분석·기획)가 끝나면 확인 화면에서 멈추지 않고 바로 2단계(생성)로 잇는다.
    //   멈추는 경우: "기획안 먼저 보고 만들기"를 누름(planFirstNext) · 한국 판매처(권리 확인을 먼저 받는다) · 다시 분석(jobId) · 설정 detailOneShot=false
    //   화면에서 시작한 길(주소·1688 탭 버튼·폴더)만 auto 를 준다 — detail:prepare(두 단계 API)는 예전처럼 멈춘다
    job.autoGo = auto === true && phase === "prepare" && !!source && !reuse && source.lang !== "ko" && st.detailOneShot !== false;
    job.theme = theme && isTheme(theme) ? theme : (tid === "card" ? (readJson(path.join(jobDirOf(id), "info.json"))?.theme || null) : null);
    { const inf0 = readJson(path.join(jobDirOf(id), "info.json")) || {}; job.mode = mode || (phase === "generate" && !regen ? inf0.mode : null) || (tid === "localize" ? "localize" : tid === "card" ? "scene" : null); }
    if (source?.lang === "ko" || readJson(path.join(jobDirOf(id), "source.json"))?.lang === "ko") { if (["localize", "both"].includes(job.mode)) job.mode = "scene"; if (tid === "localize") tid = job.templateId = "card"; } // 한국 판매처(이미 한글): 원본 한글화 없음
    if (job.mode === "localize") tid = job.templateId = "localize"; // 원본 한글화만. scene·both 는 고른 템플릿 그대로(card=v5, 그 밖=v1) — both 면 한글화 렌더를 하나 더
    job.v5 = tid === "card"; // v5: 섹션 레시피 → 섹션별 장면 생성 → 섹션 카드 카피 → card 렌더
    job.regen = regen || null; job.skipQa = !!skipQa; job.bg = !!bg; // bg: 결과 화면을 가리지 않는 뒤 작업(진행 이벤트에 bg 표시)
    job.review = phase === "prepare" ? false : typeof review === "boolean" ? review : st.detailReview === true; // v4: 렌더 직전 확인은 기본 끔(1단계 확인으로 대체)
    if (job.review && !getWin?.()) { job.review = false; job.reviewSkipped = "확인 단계 건너뜀(화면 없음)"; }
    // ⏱ 스톱워치: 새 상품이면 새로 시작(화면 읽은 시간 포함), 기획안 뒤 생성이면 이어 달린다(확인 화면에서 머문 시간은 뺀다)
    const ckFile = path.join(jobDirOf(id), "clock.json");
    if (!reuse) job.clock = newClock(Date.now(), readMs);
    else if (phase === "generate" && !regen && !bg) { const c0 = readJson(ckFile); if (c0?.open && c0.parts) job.clock = clockResume(c0, Date.now()); }
    cur = job;
    log("sys", `▶ 📄 상세페이지 ${reuse ? "다시 렌더" : "만들기"} · ${id} · 템플릿 ${tid}`);
    changed();
    let chain = false;
    (async () => {
      try {
        const r = await pipeline(job, { source, reuse, fresh });
        job.status = "done";
        if (r?.prepared && r.auto) { job.status = "prepared"; chain = true; log("go", `■ 📄 기획안 준비 · ${String(r.title || "").slice(0, 30)} · ${(r.durationMs / 1000).toFixed(1)}초 — 한 번에 만들기: 바로 생성`); return; }
        if (r?.prepared) { job.status = "prepared"; log("go", `■ 📄 상품 정보 준비 · ${String(r.title || "").slice(0, 30)} · ${(r.durationMs / 1000).toFixed(1)}초 — 확인 화면에서 생성하기`); return; }
        log("go", `■ 📄 상세페이지 완성 · ${r.title.slice(0, 30)} · ${r.slices.length}장 · ${(r.durationMs / 1000).toFixed(1)}초 · ${path.join(job.dir, "out")}`);
      } catch (e) {
        const cancelled = !!e?.cancelled || job.cancelled;
        job.status = cancelled ? "cancelled" : "failed";
        const why = cancelled ? "취소했습니다" : String(e?.message || e || "알 수 없는 오류");
        const failedStep = job.step; // emit("fail") 이 job.step 을 덮기 전에
        // 재렌더(reuse) 중 실패·취소: 이전 완료 결과(out/·result.json)가 복원돼 있으면 그대로 두고 사유만 기록
        const prev = readJson(path.join(job.dir, "result.json")) || {};
        const keep = !!(reuse && prev.status === "done" && (prev.renders?.length || exists(path.join(job.dir, prev.preview || "out/preview.png"))));
        if (keep) job.status = "done";
        try {
          if (keep) writeJson(path.join(job.dir, "result.json"), { ...prev, lastError: cancelled ? "취소" : why, lastErrorAt: Date.now() });
          else writeJson(path.join(job.dir, "result.json"), { ...prev, jobId: job.jobId, status: job.status, title: job.title || prev.title || job.jobId, templateId: job.templateId, createdAt: job.createdAt, finishedAt: Date.now(), error: cancelled ? "" : why, failedAt: failedStep });
        } catch {}
        const tail = keep ? ` — 이전 결과(${prev.templateId} 템플릿)는 그대로 둡니다` : "";
        emit(job, "fail", cancelled ? `✕ 취소됨${tail}` : `✕ ${STEP_KO[failedStep] || failedStep} 단계 실패 · ${why}${tail}`, { cancelled, failedStep, status: job.status, keepPrev: keep, ...(e?.preflight ? { preflight: e.preflight } : {}) }, 0);
        log(cancelled ? "dim" : "stop", cancelled ? `  📄 상세페이지 취소 · ${job.jobId}` : `✕ 📄 상세페이지 실패 (${STEP_KO[failedStep] || failedStep}) · ${why}`);
      } finally {
        if (job.clock) { try { clockStop(job.clock, Date.now()); if (phase !== "prepare" && job.status === "done") job.clock.open = false; writeJson(ckFile, job.clock); } catch {} }
        if (cur === job) cur = null;
        if (chain) { // 한 번에 만들기: 확인 화면의 [상세페이지 생성하기]와 같은 2단계를 바로 시작(같은 작업 번호 → 진행 화면이 이어진다)
          const info = readJson(path.join(job.dir, "info.json")) || {};
          const g = start({ jobId: id, templateId: info.templateId, theme: info.theme || null, reuse: true, fresh: ["copy", "scene", "qa", "sections"], phase: "generate" });
          if (g?.error) { log("warn", `△ 📄 바로 생성 시작 실패 → 확인 화면으로 · ${g.error}`); emit(job, "done", "■ 상품 정보를 가져왔어요 — 확인하고 '상세페이지 생성하기'를 누르세요", { prepared: true }, 1); changed(); }
          return;
        }
        changed();
        if (job.status === "done") afterDone(job);
      }
    })();
    return { jobId: id };
  }
  function cancel(jobId) {
    if (!cur || (jobId && cur.jobId !== jobId)) return { ok: false, error: "진행 중인 작업이 없습니다" };
    cur.cancelled = true;
    return { ok: true, jobId: cur.jobId };
  }
  const running = () => (cur ? { jobId: cur.jobId, status: "running", step: cur.step, stepIndex: STEPS.indexOf(cur.step), steps: STEPS.length, pct: cur.pct, title: cur.title, templateId: cur.templateId, t0: cur.t0, events: cur.events.slice(-60), waiting: !!cur.continueWaiter } : null);
  function get(jobId, renderId) {
    if (!jobId) return running();
    if (cur?.jobId === jobId) return running();
    const dir = jobDirOf(jobId);
    let r = readJson(path.join(dir, "result.json"));
    if (!r) return { error: "작업을 찾을 수 없습니다" };
    if (!Array.isArray(r.renders) && r.slices?.length) { r = migrateRenders(r); writeJson(path.join(dir, "result.json"), r); } // 첫 읽기 때 옛 결과를 renders[0] 으로
    const sel = renderOf(r, renderId);
    if (sel) r = { ...r, current: sel.id, templateId: sel.templateId, slices: sel.slices, preview: sel.preview, html: sel.html, figmaBundle: sel.figmaBundle, figmaManifest: sel.figmaManifest };
    r.renders = (r.renders || []).map((x) => ({ ...x, previewPath: x.preview ? path.join(dir, x.preview) : "", ...(x.locQa?.status === "running" ? { locQa: locQaRuns.get(jobId)?.renderId === x.id ? { ...x.locQa, msg: locQaRuns.get(jobId).msg } : { ...x.locQa, status: "stopped" } } : {}) })); // 앱을 껐다 켜서 끊긴 검수는 "stopped"
    return { ...r, dir, previewPath: r.preview ? path.join(dir, r.preview) : "", slicePaths: (r.slices || []).map((s) => path.join(dir, s.file)), htmlPath: r.html ? path.join(dir, r.html) : "", figmaPath: r.figmaBundle ? path.join(dir, r.figmaBundle) : "" };
  }
  function templates() {
    const tplRoot = path.join(__dirname, "../../renderer/detail-templates");
    return TEMPLATES.map((t) => ({ ...t, thumb: t.id, ready: exists(path.join(tplRoot, t.id, "index.html")) }));
  }

  // ---------- IPC ----------
  mod("google-ipc", log).then((m) => m?.initGoogleIpc?.({ ipcMain, app, store, log, send })); // 🔗 내 구글 클라우드 연결(수강생 무료 체험 → Gemini·Vision)
  mod("thumb", log).then((m) => { thumbHook = m?.initThumb?.({ ipcMain, app, store, log, send }) || null; }); // 🖼 쿠팡 썸네일(thumb:get·run·update·export) + 상세페이지 끝나면 자동
  ipcMain.handle("detail:list", () => listJobs());
  ipcMain.handle("detail:templates", () => [...templates(), ...TPL.summaries().map((t) => ({ ...t, ready: true }))]); // v1 템플릿 + 🧲 내 템플릿(kind "mine")
  // 벤치마킹(1단계 POC): { jobId, reference(reference.json 경로 또는 레퍼런스 이미지 폴더) } → 섹션 순서·카피 각도·custom 테마로 다시 생성
  ipcMain.handle("detail:reference", (_e, p = {}) => {
    const id = String(p.jobId || ""); if (!id || !exists(path.join(jobDirOf(id), "info.json"))) return { error: "먼저 상품 정보를 가져와야 합니다" };
    if (!p.reference || !exists(String(p.reference))) return { error: "레퍼런스(이미지 폴더 또는 reference.json)를 찾지 못했습니다" };
    return start({ jobId: id, templateId: "card", reuse: true, phase: "generate", skipQa: true, reference: String(p.reference), regen: { label: "벤치마킹 템플릿" } });
  });
  ipcMain.handle("detail:themes", () => themeList()); // 기본 테마(kind theme) + 내 템플릿(kind mine)
  ipcMain.handle("detail:qa:apply", (_e, p = {}) => applySuggestion(String(p.jobId || ""), p.i));
  ipcMain.handle("detail:loc:recheck", async (_e, p = {}) => { // 이 렌더 전체 다시 검수(하네스·지난 결과용 — 화면 단추 없음)
    const jobId = String(p.jobId || ""), rid = String(p.renderId || ""), dir = jobDirOf(jobId), L = locPlanOf(dir, rid); if (L.error) return L;
    if (locQaRuns.has(jobId) || locEditBusy.has(jobId)) return { error: "검수·고치기가 진행 중이에요" };
    const src = readJson(path.join(dir, "source.json")) || {};
    const out = await runLocQaBg(jobId, { dir, renderId: rid, plan: L.plan, planFile: L.planFile, raw: Object.fromEntries((src.images || []).map((im) => [im.id, [im.file, path.join(dir, "raw", path.basename(im.file || ""))].find((q) => q && exists(q)) || null])) });
    return out ? { ok: true, summary: out.summary, ms: out.ms, costUsd: out.costUsd } : { error: "검수 실패" };
  });
  ipcMain.handle("detail:loc:section", (_e, p = {}) => locSectionGet(String(p.jobId || ""), String(p.renderId || ""), String(p.sectionId || "")));
  ipcMain.handle("detail:loc:edit", (_e, p = {}) => locSectionEdit(String(p.jobId || ""), String(p.renderId || ""), String(p.sectionId || ""), String(p.action || ""), p.payload));
  // v5: 테마만 바꿔 다시 그림(구성·장면·카피 그대로, AI 호출 0) → 새 렌더 탭
  ipcMain.handle("detail:theme", (_e, p = {}) => {
    const id = String(p.jobId || ""); if (!isV5Job(id)) return { error: "v5(카드) 결과에서만 테마를 바꿀 수 있습니다" };
    if (isMine(p.theme)) return start({ jobId: id, templateId: "card", reuse: true, phase: "generate", skipQa: true, templateRef: String(p.theme), keepExtra: typeof p.keepExtra === "boolean" ? p.keepExtra : null, regen: { label: `🧲 ${TPL.get(p.theme)?.name || "내 템플릿"}` } }); // 내 템플릿: 섹션 순서·카피 각도까지 → 섹션·카피 새로
    const th = THEMES.some((t) => t.id === p.theme) ? p.theme : null; if (!th) return { error: "없는 테마입니다" };
    return start({ jobId: id, templateId: "card", theme: th, reuse: true, phase: "generate", skipQa: true, regen: { theme: true, label: `테마 ${th}` } });
  });
  // ---- 🧲 내 템플릿 보관함 ----
  ipcMain.handle("detail:template:list", () => TPL.summaries());
  ipcMain.handle("detail:template:get", (_e, p = {}) => { const t = TPL.get(String(p.id || "")); return t ? { ...t, chips: overrideChips(t) } : { error: "템플릿이 없습니다" }; });
  // 이름·분류·overrides(세부 조정) 저장. jobId 를 주고 그 작업이 이 템플릿을 쓰는 custom 결과면 손잡이만 바꿔 다시 그린다(AI 0)
  ipcMain.handle("detail:template:set", (_e, p = {}) => {
    const id = String(p.id || ""); if (!isMine(id)) return { error: "템플릿이 없습니다" };
    let t = TPL.get(id);
    if (p.overrides && typeof p.overrides === "object") t = TPL.setOverrides(id, p.overrides, { merge: p.merge !== false });
    if (typeof p.name === "string" || typeof p.category === "string") t = TPL.update(id, { name: p.name, category: p.category });
    if (t?.error) return t;
    send("detail:changed", { templates: true });
    const jobId = String(p.jobId || "");
    if (jobId && p.rerender && isV5Job(jobId) && readJson(path.join(jobDirOf(jobId), "info.json"))?.templateRef === id) return { ...start({ jobId, templateId: "card", theme: "custom", reuse: true, phase: "generate", skipQa: true, regen: { theme: true, label: `🧲 세부 조정 · ${t.name}` } }), template: { ...t, chips: overrideChips(t) } };
    return { ok: true, template: { ...t, chips: overrideChips(t) } };
  });
  ipcMain.handle("detail:template:remove", (_e, p = {}) => { const r = TPL.remove(String(p.id || "")); if (!r.error) send("detail:changed", { templates: true }); return r; });
  ipcMain.handle("detail:template:export", async (_e, p = {}) => {
    const t = TPL.get(String(p.id || "")); if (!t) return { error: "템플릿이 없습니다" };
    let file = String(p.file || "");
    if (!file) { const r = await electron.dialog.showSaveDialog(getWin?.() || undefined, { title: "템플릿 내보내기 (.seedtpl.json — 카톡·강의 자료로 주고받기)", defaultPath: path.join(app.getPath("downloads"), `${t.name.replace(/[\\/:*?"<>|]/g, "_")}.seedtpl.json`), filters: [{ name: "씨드핵 템플릿", extensions: ["json"] }] }); if (r.canceled || !r.filePath) return { cancelled: true }; file = r.filePath; }
    const r = TPL.exportTo(t.id, file); if (!r.error) log("go", `■ 🧲 템플릿 내보내기 · ${t.name} · ${r.file}`); return r;
  });
  ipcMain.handle("detail:template:import", async (_e, p = {}) => {
    let file = String(p.file || "");
    if (!file) { const r = await electron.dialog.showOpenDialog(getWin?.() || undefined, { title: "템플릿 가져오기 (.seedtpl.json)", properties: ["openFile"], filters: [{ name: "씨드핵 템플릿", extensions: ["json"] }] }); if (r.canceled || !r.filePaths?.[0]) return { cancelled: true }; file = r.filePaths[0]; }
    const t = TPL.importFrom(file); if (t.error) return t;
    log("go", `■ 🧲 템플릿 가져오기 · ${t.name}`); send("detail:changed", { templates: true });
    return { ok: true, template: { ...t, chips: overrideChips(t) } };
  });
  // 내 템플릿으로 다시 생성: { jobId, templateId, keepExtra } (detail:reference 와 같은 흐름 — custom 테마 + 섹션 순서·각도 + 가드)
  ipcMain.handle("detail:template:use", (_e, p = {}) => {
    const id = String(p.jobId || ""); if (!id || !exists(path.join(jobDirOf(id), "info.json"))) return { error: "먼저 상품 정보를 가져와야 합니다" };
    if (!isMine(p.templateId)) return { error: "그 템플릿이 보관함에 없습니다" };
    return start({ jobId: id, templateId: "card", reuse: true, phase: "generate", skipQa: true, templateRef: String(p.templateId), keepExtra: typeof p.keepExtra === "boolean" ? p.keepExtra : null, regen: { label: `🧲 ${TPL.get(p.templateId)?.name || "내 템플릿"}` } });
  });
  // 🧲 쿠팡 화면 버튼: { url, name, category, images:[주소] } → 상세 이미지 내려받기(보낸 화면의 세션) → reference.buildReference → 보관함. 진행은 보낸 화면으로(detail:captureProgress)
  let capturing = null;
  ipcMain.handle("detail:captureReference", async (e, p = {}) => {
    const senderUrl = (() => { try { return e.sender.getURL(); } catch { return ""; } })();
    if (!/^https:\/\/([\w-]+\.)*coupang\.com\//.test(senderUrl)) return { error: "쿠팡 상품 화면에서만 됩니다" };
    const url = String(p.url || senderUrl).split("#")[0], key = templateSourceKey({ url });
    const dup = TPL.findBySource(key); if (dup && !p.force) return { ok: true, existing: true, template: { ...TPL.get(dup.id), chips: null } };
    if (capturing) return { error: "이미 템플릿을 만드는 중입니다 — 끝난 뒤 다시 눌러 주세요" };
    const urls = [...new Set((Array.isArray(p.images) ? p.images : []).map((u) => String(u || "").trim().replace(/^\/\//, "https://")).filter((u) => /^https:\/\/[\w.-]*coupangcdn\.com\//i.test(u)))].slice(0, 60);
    if (urls.length < 2) return { error: "상세 이미지를 찾지 못했어요 — 상품 화면을 아래로 한 번 내려(상세 이미지가 뜨게) 다시 눌러 주세요" };
    const prog = (step, msg, frac = 0) => { try { e.sender.send("detail:captureProgress", { step, msg, frac }); } catch {} };
    const name = String(p.name || "").slice(0, 80), category = String(p.category || "").slice(0, 40);
    const tplName = String(p.tplName || "").slice(0, 40) || templateDefaultName({ category, name });
    const id = templateNewId(), refDir = path.join(TPL.dirOf(id), "ref");
    capturing = id; const t0 = Date.now();
    try {
      fs.mkdirSync(refDir, { recursive: true });
      const ses = e.sender.session; let ok = 0;
      for (const [i, u] of urls.entries()) {
        try {
          const r = await ses.fetch(u, { headers: { Referer: "https://www.coupang.com/" } }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = Buffer.from(await r.arrayBuffer()); const im = nativeImage.createFromBuffer(buf); const sz = im.isEmpty() ? null : im.getSize();
          const ext = /png/i.test(r.headers.get("content-type") || "") ? "png" : /webp/i.test(r.headers.get("content-type") || "") || /^RIFF/.test(buf.subarray(0, 4).toString("latin1")) ? "webp" : "jpg";
          if (sz ? sz.width < 300 || sz.height < 120 : ext !== "webp" || buf.length < 20000) continue; // 아이콘·배너 조각은 뺀다(webp 는 nativeImage 가 못 열어 크기 대신 용량으로)
          fs.writeFileSync(path.join(refDir, `${String(i + 1).padStart(2, "0")}.${ext}`), buf); ok++;
        } catch (err) { log("dim", `  🧲 상세 이미지 못 받음 ${u.slice(0, 80)} (${err?.message || err})`); }
        prog("download", `상세 이미지 ${ok}/${urls.length}장 받는 중`, (i + 1) / urls.length);
      }
      if (ok < 2) return { error: "상세 이미지를 받지 못했어요(쿠팡이 막았거나 이미지가 없음)" };
      const refMod = await mod("reference", log); if (!refMod?.buildReference) return { error: "레퍼런스 분석 모듈이 없습니다" };
      prog("analyze", `🧲 ${ok}장 분석 중 — 글자·색·섹션 순서·설득 흐름 (1~5분)`, 0.05);
      const ref = await refMod.buildReference({ input: refDir, outDir: TPL.dirOf(id), log: (cls, text) => { log(cls, text); if (/🧲/.test(String(text))) prog("analyze", String(text).replace(/^\s*🧲\s*/, "").slice(0, 80), 0.5); } });
      if (ref?.error && !ref?.tokens) return { error: ref.error };
      const tpl = TPL.saveFromReference(ref, { id, name: tplName, category, source: { kind: "coupang", url, productName: name, key, capturedAt: new Date().toISOString().slice(0, 10) } });
      if (tpl.error) return tpl;
      const usd = ref.cost?.usd; log("go", `■ 🧲 템플릿 저장 · 「${tpl.name}」 · 상세 ${ok}장 · 섹션 ${(tpl.sections || []).length}개 · ${((Date.now() - t0) / 1000).toFixed(0)}초${usd != null ? ` · $${Number(usd).toFixed(3)}` : ""} · ${TPL.dirOf(id)}`);
      send("detail:changed", { templates: true });
      return { ok: true, template: { ...tpl, chips: null }, images: ok, ms: Date.now() - t0, usd: usd ?? null };
    } catch (err) { log("warn", `△ 🧲 템플릿 저장 실패 (${err?.message || err})`); return { error: String(err?.message || err) }; }
    finally { capturing = null; if (!TPL.has(id)) try { fs.rmSync(TPL.dirOf(id), { recursive: true, force: true }); } catch {} }
  });
  ipcMain.handle("detail:get", (_e, p) => get(p?.jobId, p?.renderId));
  ipcMain.handle("detail:cancel", (_e, p) => cancel(p?.jobId));
  ipcMain.handle("detail:run", (_e, p = {}) => {
    if (p.jobId && !p.source) return start({ jobId: p.jobId, templateId: p.templateId, reuse: true, fresh: Array.isArray(p.fresh) ? p.fresh : [], review: p.review }); // fresh: ["copy","vision"] 이면 그 결과는 다시 만든다
    if (!p.source || typeof p.source !== "object") return { error: "상품 정보(source)가 없습니다 — 1688 상품 화면에서 📄 버튼을 눌러 주세요" };
    return start({ source: { ...p.source, rowId: p.rowId ?? p.source.rowId ?? null }, templateId: p.templateId, review: p.review });
  });
  ipcMain.handle("detail:rerender", (_e, p = {}) => {
    if (!p.jobId || !exists(path.join(jobDirOf(p.jobId), "plan.json"))) return { error: "다시 그릴 작업(plan.json)이 없습니다" };
    return start({ jobId: p.jobId, templateId: p.templateId, reuse: true, review: p.review });
  });
  // ---- 확인(review) 화면용: 구성 보기/고치기/계속 ----
  ipcMain.handle("detail:plan:get", (_e, p = {}) => {
    const id = String(p.jobId || cur?.jobId || ""); if (!id) return { error: "작업이 없습니다" };
    const dir = jobDirOf(id); const plan = readJson(path.join(dir, "plan.json")); if (!plan) return { error: "구성(plan.json)이 아직 없습니다" };
    const cleaned = (cur?.jobId === id && cur.cleaned) || readJson(path.join(dir, "clean.json")) || [];
    const vision = (cur?.jobId === id && cur.vision) || readJson(path.join(dir, "vision.json")) || null;
    const vi = (cid) => vision?.items?.find((x) => x.id === cid) || null;
    const photos = cleaned.filter((c) => c?.photo?.file).map((c) => { const v = vi(c.id); return { id: c.id, file: c.photo.file, path: path.join(dir, c.photo.file), w: c.photo.w, h: c.photo.h, usable: !v || (v.usable !== false && v.role !== "skip"), score: v?.score ?? null, role: v?.role || null, shows: v?.shows || "" }; });
    const srcUrl = readJson(path.join(dir, "source.json"))?.url || "";
    return { jobId: id, dir, plan, photos, url: srcUrl, waiting: !!(cur?.jobId === id && cur.continueWaiter), templateId: plan.meta?.templateId || cur?.templateId || "clean" };
  });
  ipcMain.handle("detail:plan:set", (_e, p = {}) => {
    const id = String(p.jobId || cur?.jobId || ""); if (!id) return { error: "작업이 없습니다" };
    const dir = jobDirOf(id); const plan = readJson(path.join(dir, "plan.json")); if (!plan) return { error: "구성(plan.json)이 없습니다" };
    const inc = p.plan; if (!inc || !Array.isArray(inc.sections)) return { error: "sections 배열이 필요합니다" };
    const allowed = new Set([...(readJson(path.join(dir, "clean.json")) || []).flatMap((c) => [c.photo?.file, c.full?.file, c.out, c.file]).filter(Boolean), ...plan.sections.flatMap((s) => [s.image, ...(s.images || [])]).filter(Boolean)]);
    const clean = (v) => (typeof v === "string" ? v.slice(0, 300) : v);
    plan.sections = inc.sections.slice(0, 40).map((sec) => { const base = plan.sections.find((o) => o.id === sec.id) || {}; const out = { ...base, ...sec }; // 글은 자유, 사진 경로는 이 작업 안의 파일만
      if (out.image && !allowed.has(String(out.image))) out.image = base.image || null; if (Array.isArray(out.images)) out.images = out.images.filter((f) => allowed.has(String(f)));
      ["headline", "sub", "title", "desc", "note"].forEach((k) => { if (k in out) out[k] = clean(out[k]); }); return out; });
    writeJson(path.join(dir, "plan.json"), plan);
    return { ok: true, sections: plan.sections.length };
  });
  ipcMain.handle("detail:imageUsage", () => summarizeUsage(store.get("imageUsage")));
  // 실제 청구 화면(공급자별 고정 주소만 연다)
  ipcMain.handle("detail:openBilling", () => {
    let pv = null; try { pv = mods0.scene?.resolveProvider ? mods0.scene.resolveProvider({ settings: sceneSettingsNow() }) : null; } catch {}
    const url = pv?.provider === "vertex" ? `https://console.cloud.google.com/billing/linkedaccount${pv.project ? `?project=${encodeURIComponent(pv.project)}` : ""}` : pv?.provider === "openai" ? "https://platform.openai.com/usage" : "https://aistudio.google.com/usage";
    shell.openExternal(url); return { ok: true };
  });
  ipcMain.handle("detail:continue", (_e, p = {}) => {
    const id = String(p.jobId || cur?.jobId || "");
    if (!cur || cur.jobId !== id || !cur.continueWaiter) return { error: "확인을 기다리는 작업이 없습니다" };
    cur.continueWaiter(); return { ok: true };
  });
  ipcMain.handle("detail:settings", (_e, patch) => {
    if (patch && typeof patch === "object") {
      const next = { ...(store.get("settings") || {}) };
      if (typeof patch.detailReview === "boolean") next.detailReview = patch.detailReview;
      if (typeof patch.detailPresentAuto === "boolean") next.detailPresentAuto = patch.detailPresentAuto;
      if (typeof patch.detailAllowTesseract === "boolean") next.detailAllowTesseract = patch.detailAllowTesseract; // 🚦 사용자가 고른 낮은 품질 OCR
      if (typeof patch.geminiKey === "string") { const k = patch.geminiKey.trim(); if (k) next.geminiKey = k.slice(0, 200); else delete next.geminiKey; } // 키는 저장만, 돌려주지도 로그하지도 않는다
      if (typeof patch.openaiKey === "string") { const k = patch.openaiKey.trim(); if (k) next.openaiKey = k.slice(0, 300); else delete next.openaiKey; } // GPT 그리기(선택) — 저장만, 돌려주지도 로그하지도 않는다
      if (typeof patch.detailBakeEngine === "string") { if (patch.detailBakeEngine === "codex") next.detailBakeEngine = "codex"; else delete next.detailBakeEngine; } // 🧪 내부용: 한글화 그리기를 이 컴퓨터의 GPT 명령줄로
      if (typeof patch.geminiImageModel === "string") { const m = patch.geminiImageModel.trim().slice(0, 60); if (m) next.geminiImageModel = m; else delete next.geminiImageModel; }
      store.set("settings", next);
    }
    const st = store.get("settings") || {};
    const codexReady = !!codexBin(); sceneSettingsNow();
    let imageGen = { provider: "", connected: false, project: "" };
    try { const pv = mods0.scene?.resolveProvider ? mods0.scene.resolveProvider({ settings: sceneSettingsNow() }) : null; if (pv) imageGen = { provider: pv.provider, connected: !!pv.key, project: pv.project || "", model: pv.model || "" }; } catch {}
    return { imageGen, detailReview: st.detailReview === true, detailPresentAuto: st.detailPresentAuto !== false, detailTemplate: st.detailTemplate || "clean", bakeEngine: st.detailBakeEngine === "codex" && codexReady ? "codex" : "", codexReady, hasOpenaiKey: !!st.openaiKey, openaiKeyHint: st.openaiKey ? `…${String(st.openaiKey).slice(-4)}` : "", hasGeminiKey: !!(st.geminiKey || process.env.GEMINI_API_KEY), geminiKeyHint: st.geminiKey ? `…${String(st.geminiKey).slice(-4)}` : "", geminiImageModel: st.geminiImageModel || "gemini-2.5-flash-image" };
  });
  // 1688 상품 화면(cn.cjs)에서 온 요청만: raw → 정리 → 실행 → 패널을 📄 화면으로
  ipcMain.handle("detail:fromPage", (e, raw) => {
    const cn = getCnView?.();
    if (!cn || e.sender !== cn.webContents) return { error: "1688 상품 화면에서만 됩니다" };
    if (!raw || typeof raw !== "object") return { error: "상품 정보를 읽지 못했습니다" };
    const r = start({ source: { ...raw, _raw: true }, templateId: raw.templateId || (store.get("settings") || {}).detailTemplate || "clean", phase: "prepare", auto: !planFirstNext, readMs: pageReadT0 && Date.now() - pageReadT0 < 180000 ? Date.now() - pageReadT0 : 0 });
    planFirstNext = false; pageReadT0 = 0;
    if (r.error) return r;
    if (showDetail) showDetail(); else send("nav", { tab: "detail", url: "📄 상세페이지" });
    return { ok: true, jobId: r.jobId };
  });
  // 📄 화면의 주소 칸(또는 리스트업 선택) → 1688 탭에서 그 주소를 열고 → cn.cjs 에 "읽어서 detail:fromPage 로 보내라"고 시킨다.
  // 상품 정보는 여전히 1688 화면에서 직접 읽으므로(추가 요청 없음) 흐름은 📄 버튼과 같다. 로그인·보안 인증이 뜨면 1688 탭이 보이는 채로 멈추고 사유를 돌려준다.
  // 쿠팡·네이버·오늘의집(한국 판매처) 주소 → 화면 한 번 열어 읽기 → buildKoRaw(lang "ko") → 1단계(prepare). 확인 화면에서 권리 선택(내 상품 / 🧲 레퍼런스)
  //  쿠팡: 쿠팡 탭(사람이 보는 화면)에서 한 번 열고 읽는다 — 상세 이미지는 🧲 템플릿 저장과 같은 coupang.cjs collectDetailImages 로. 자동 반복 요청 없음
  //  네이버·오늘의집: 숨은 창(persist:detail-web). 로그인·보안 확인이 뜨면 needVisible → 📄 화면의 「보이는 창으로 열기」(같은 세션)
  let koReading = false;
  const koSameProduct = (u, rt) => { const r = routeProductUrl(u); return r.site === rt.site && r.id === rt.id; };
  function coupangDetailImages(wc) { // coupang.cjs(detail:collectCoupang) 가 🧲 와 같은 규칙으로 모은 상세 이미지 주소 — 3초 안에 답 없으면 null
    return new Promise((res) => {
      const t = setTimeout(() => { ipcMain.removeListener("detail:collectCoupangDone", on); res(null); }, 3000);
      const on = (e, r) => { if (e.sender !== wc) return; clearTimeout(t); ipcMain.removeListener("detail:collectCoupangDone", on); res(r || null); };
      ipcMain.on("detail:collectCoupangDone", on); wc.send("detail:collectCoupang");
    });
  }
  async function fromKoSite(rt, p = {}) {
    if (cur) return { error: "이미 상세페이지를 만드는 중입니다 — 끝나거나 취소한 뒤 다시 눌러 주세요", jobId: cur.jobId };
    if (koReading || pageReadWaiter) return { error: "앞의 주소를 아직 읽는 중입니다" };
    koReading = true; const name = SITE_NAME[rt.site], t0 = Date.now();
    try {
      const SR = await import("./site-read.js");
      log("sys", `▶ 📄 주소로 만들기 · ${rt.url} · ${name} 화면에서 읽는 중`);
      let r;
      if (rt.site === "coupang") {
        if (!openCoupang) return { error: "쿠팡 탭을 열 수 없습니다" };
        const wc = openCoupang(rt.url); if (!wc) return { error: "쿠팡 탭을 열지 못했습니다" };
        await SR.waitLoad(wc); await sleep(2500);
        if (wc.isDestroyed()) return { error: "쿠팡 탭이 닫혔습니다" };
        r = await SR.readFrom(wc, "coupang");
        if (r.page) r.page.coupang = await coupangDetailImages(wc).catch(() => null);
      } else {
        const vw = SR.visibleWebContents(); // 「보이는 창」에 그 상품이 떠 있으면(로그인 직후) 그 화면을 읽는다
        r = vw && koSameProduct(vw.getURL(), rt) ? await SR.readFrom(vw, rt.site) : await SR.readHidden({ site: rt.site, url: rt.url, log: (t) => log("dim", t) });
      }
      if (r.wall) { const error = koWallMessage(rt.site, r.wall); log("stop", `✕ 📄 주소로 만들기 · ${error} (${String(r.state?.url || "").slice(0, 80)})`); return { error, wall: r.wall, needVisible: rt.site !== "coupang" && r.wall !== "notfound", site: rt.site, url: rt.url }; }
      const raw = buildKoRaw(rt.site, r.page, { id: rt.id });
      log("dim", `  📄 ${raw.how} · ${String(raw.title_ko).slice(0, 40)} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
      if (!raw.gallery.length && raw.detailImages.length < 2) return { error: `${name} 화면에서 상품 사진을 찾지 못했습니다 — 상품 화면 주소가 맞는지 확인해 주세요`, needVisible: rt.site !== "coupang", site: rt.site, url: rt.url };
      // 한국 판매처는 항상 2단계(1단계 확인 화면에서 권리 선택을 먼저 받는다)
      const res = start({ source: { ...raw, _raw: true, rowId: p.rowId ?? null }, templateId: TEMPLATES.some((t) => t.id === p.templateId) ? p.templateId : (store.get("settings") || {}).detailTemplate || "clean", phase: "prepare" });
      if (res.error) return res;
      if (showDetail) showDetail(); else send("nav", { tab: "detail", url: "📄 상세페이지" });
      return { ok: true, jobId: res.jobId, site: rt.site };
    } catch (e) { const error = `${name} 화면을 읽지 못했습니다 (${String(e?.message || e).slice(0, 100)})`; log("stop", `✕ 📄 주소로 만들기 · ${error}`); return { error, needVisible: rt.site !== "coupang", site: rt.site, url: rt.url }; }
    finally { koReading = false; }
  }
  // 「보이는 창으로 열기」: 네이버·오늘의집 — 같은 세션(persist:detail-web)으로 사람이 로그인·보안 확인을 넘긴다
  ipcMain.handle("detail:openVisible", async (_e, p = {}) => {
    const rt = routeProductUrl(p.url); if (rt.error || !["naver", "ohou"].includes(rt.site)) return { error: rt.error || "네이버·오늘의집 주소만 보이는 창으로 엽니다" };
    (await import("./site-read.js")).openVisible(rt.url); return { ok: true };
  });
  // 🧲 확인 화면 → 레퍼런스(템플릿)로 저장: 다른 판매자 상품이면 재료로 쓰지 않고, 받은 상세 이미지를 🧲 보관함 분석으로 보낸다(detail:captureReference 와 같은 분석·저장)
  ipcMain.handle("detail:refFromJob", async (e, p = {}) => {
    const jid = String(p.jobId || ""), dir = jobDirOf(jid), src = readJson(path.join(dir, "source.json"));
    if (!jid || !src) return { error: "작업이 없습니다" };
    const files = (src.images || []).filter((im) => !["gallery", "main", "option", "sku"].includes(im.kind) && !im.refOnly && im.file && exists(im.file)).map((im) => im.file).slice(0, 60);
    if (files.length < 2) return { error: "상세 이미지가 2장 미만이라 레퍼런스로 저장할 수 없어요" };
    const key = templateSourceKey({ url: src.url });
    const dup = TPL.findBySource(key); if (dup && !p.force) return { ok: true, existing: true, template: { ...TPL.get(dup.id), chips: null } };
    if (capturing) return { error: "이미 템플릿을 만드는 중입니다 — 끝난 뒤 다시 눌러 주세요" };
    const id = templateNewId(), refDir = path.join(TPL.dirOf(id), "ref"), t0 = Date.now();
    const name = String(src.title_ko || src.title_zh || "").slice(0, 80), category = String(src.category || "").slice(0, 40);
    const tplName = String(p.tplName || "").slice(0, 40) || templateDefaultName({ category, name });
    const prog = (step, msg, frac = 0) => { try { e.sender.send("detail:captureProgress", { step, msg, frac, jobId: jid }); } catch {} };
    capturing = id;
    try {
      fs.mkdirSync(refDir, { recursive: true });
      files.forEach((f, i) => fs.copyFileSync(f, path.join(refDir, `${String(i + 1).padStart(2, "0")}${path.extname(f)}`)));
      const refMod = await mod("reference", log); if (!refMod?.buildReference) return { error: "레퍼런스 분석 모듈이 없습니다" };
      log("sys", `▶ 🧲 레퍼런스로 저장 · ${SITE_NAME[src.source] || src.source} · ${name.slice(0, 30)} · 상세 ${files.length}장`);
      prog("analyze", `🧲 ${files.length}장 분석 중 — 섹션 순서·색·설득 흐름 (1~5분)`, 0.05);
      const ref = await refMod.buildReference({ input: refDir, outDir: TPL.dirOf(id), log: (cls, text) => { log(cls, text); if (/🧲/.test(String(text))) prog("analyze", String(text).replace(/^\s*🧲\s*/, "").slice(0, 80), 0.5); } });
      if (ref?.error && !ref?.tokens) return { error: ref.error };
      const tpl = TPL.saveFromReference(ref, { id, name: tplName, category, source: { kind: src.source, url: src.url, productName: name, key, capturedAt: new Date().toISOString().slice(0, 10) } });
      if (tpl.error) return tpl;
      const usd = ref.cost?.usd; log("go", `■ 🧲 레퍼런스 저장 · 「${tpl.name}」 · 상세 ${files.length}장 · ${((Date.now() - t0) / 1000).toFixed(0)}초${usd != null ? ` · $${Number(usd).toFixed(3)}` : ""}`);
      send("detail:changed", { templates: true });
      return { ok: true, template: { ...tpl, chips: null }, images: files.length, ms: Date.now() - t0, usd: usd ?? null };
    } catch (err) { log("warn", `△ 🧲 레퍼런스 저장 실패 (${err?.message || err})`); return { error: String(err?.message || err) }; }
    finally { capturing = null; if (!TPL.has(id)) try { fs.rmSync(TPL.dirOf(id), { recursive: true, force: true }); } catch {} }
  });
  let pageReadWaiter = null;
  ipcMain.on("detail:readPageDone", (e, r) => { const cn = getCnView?.(); if (cn && e.sender === cn.webContents && pageReadWaiter) pageReadWaiter(r || { error: "읽기 결과가 없습니다" }); });
  ipcMain.handle("detail:fromUrl", async (_e, p = {}) => {
    pageReadT0 = Date.now();
    planFirstNext = !!p.planFirst; // 주소 칸 아래 "기획안 먼저 보고 만들기"
    // 주소 가려내기(site-core): 1688(예전 그대로) · 타오바오/티몰(같은 1688 탭·같은 로그인에서 읽기) · 쿠팡/네이버/오늘의집(fromKoSite)
    const rt = routeProductUrl(p.url);
    if (rt.error) return { error: rt.error };
    if (!["1688", "taobao", "tmall"].includes(rt.site)) return fromKoSite(rt, p);
    const url = rt.url, tb = rt.site !== "1688", tabName = tb ? `${SITE_NAME[rt.site]} 화면(🇨🇳 1688 탭)` : "1688 탭";
    if (cur) return { error: "이미 상세페이지를 만드는 중입니다 — 끝나거나 취소한 뒤 다시 눌러 주세요", jobId: cur.jobId };
    if (!openCn) return { error: "1688 탭을 열 수 없습니다" };
    if (pageReadWaiter) return { error: "앞의 주소를 아직 읽는 중입니다" };
    openCn(url);
    const cn = getCnView?.();
    if (!cn) return { error: "1688 탭을 열지 못했습니다" };
    const wc = cn.webContents;
    log("sys", `▶ 📄 주소로 만들기 · ${url} · ${tabName}에서 읽는 중`);
    // 페이지 로드 끝(또는 25초) → 1.5초 숨 고르기(지연 로딩 이미지) → 읽기 요청(45초 안에 답 없으면 포기)
    await new Promise((res) => { let done = false; const fin = () => { if (done) return; done = true; wc.removeListener("did-stop-loading", fin); clearTimeout(t); res(); }; const t = setTimeout(fin, 25000); wc.on("did-stop-loading", fin); });
    await sleep(tb ? 3000 : 1500); // 타오바오·티몰 새 화면(React)은 내용이 늦게 그려진다
    if (wc.isDestroyed()) return { error: "1688 탭이 닫혔습니다" };
    if (tb) { // 로그인·슬라이더 인증 화면이면 읽지 않고 사람에게 넘긴다(탭은 보이는 채로)
      const st = await wc.executeJavaScript(CN_WALL_PROBE_JS, true).catch(() => null);
      const wall = st && cnWall(st);
      if (wall) { const error = `${SITE_NAME[rt.site]} 탭에서 로그인·인증을 넘긴 뒤 다시 눌러 주세요${wall === "slider" ? " (슬라이더 인증)" : " (로그인 필요)"}`; log("stop", `✕ 📄 주소로 만들기 · ${error}`); return { error, wall }; }
    }
    const r = await new Promise((res) => {
      const t = setTimeout(() => res({ error: tb ? `${SITE_NAME[rt.site]} 화면에서 상품 정보를 읽지 못했습니다(시간 초과) — 1688 탭에 상품 화면이 떠 있는지 확인하고 오른쪽 위 📄 버튼을 눌러 주세요` : "1688 화면에서 상품 정보를 읽지 못했습니다(시간 초과) — 1688 탭에서 상품 화면이 맞는지 확인하고 📄 버튼을 눌러 주세요" }), tb ? 75000 : 45000);
      pageReadWaiter = (v) => { clearTimeout(t); res(v); };
      wc.send("detail:readPage", { templateId: TEMPLATES.some((t) => t.id === p.templateId) ? p.templateId : (store.get("settings") || {}).detailTemplate || "clean", rowId: p.rowId ?? null, ...(tb ? { site: rt.site } : {}) });
    });
    pageReadWaiter = null;
    if (tb && /상품 화면이 아닙니다/.test(r?.error || "")) r.error = `${SITE_NAME[rt.site]} 상품 화면이 아닙니다 — 타오바오 탭에서 로그인·인증을 넘긴 뒤 다시 눌러 주세요`;
    if (r?.error) log("stop", `✕ 📄 주소로 만들기 실패 · ${r.error}`);
    return r;
  });
  ipcMain.handle("detail:open", async (_e, p = {}) => {
    const dir = jobDirOf(String(p.jobId || "")); if (!p.jobId || !exists(dir)) return { error: "작업 폴더가 없습니다" };
    const r0 = migrateRenders(readJson(path.join(dir, "result.json")) || {});
    const r = renderOf(r0, p.renderId) || r0;
    const what = p.what || "folder";
    const rdir = r.dir || "out";
    const f = what === "preview" ? path.join(dir, r.preview || `${rdir}/preview.png`) : what === "figma" ? path.join(dir, r.figmaBundle || `${rdir}/figma-bundle.json`) : what === "html" ? path.join(dir, r.html || `${rdir}/page.html`) : path.join(dir, rdir);
    if (!exists(f)) return { error: "파일이 아직 없습니다" };
    if (what === "folder") shell.openPath(f); else if (what === "figma") shell.showItemInFolder(f); else await shell.openPath(f);
    return { ok: true, path: f };
  });
  // ---- v4 2단계 흐름 ----
  // 1단계: source(새 상품) 또는 jobId(다시 분석: fresh 예 ["brief"] = ✦ AI 정보추출, ["vision","cutout","brief"] = 다시 가져오기)
  ipcMain.handle("detail:prepare", (_e, p = {}) => {
    if (p.jobId && !p.source) return start({ jobId: p.jobId, templateId: p.templateId, reuse: true, fresh: Array.isArray(p.fresh) ? p.fresh : [], phase: "prepare" });
    if (!p.source || typeof p.source !== "object") return { error: "상품 정보(source)가 없습니다 — 1688 상품 화면에서 📄 버튼을 눌러 주세요" };
    return start({ source: { ...p.source, rowId: p.rowId ?? p.source.rowId ?? null }, templateId: p.templateId, phase: "prepare" });
  });
  // 폴더로 만들기: 이미지 다운로더 폴더(main-·SKU-·detail- 파일 이름)를 골라 1단계 시작 — A1 importFolder, 없으면 자체 읽기
  ipcMain.handle("detail:importFolder", async (_e, p = {}) => {
    let folder = String(p.dir || "");
    if (!folder) { const w = getWin?.(); const r = await electron.dialog.showOpenDialog(w || undefined, { title: "상품 이미지 폴더 고르기 (main-·SKU-·detail- 파일)", properties: ["openDirectory"] }); if (r.canceled || !r.filePaths?.[0]) return { cancelled: true }; folder = r.filePaths[0]; }
    if (!exists(folder)) return { error: "폴더가 없습니다" };
    const ex = await mod("extract", log), core = await mod("extract-core", log);
    let source = null;
    try { const fn = ex?.importFolder || core?.importFolder; if (fn) { source = await fn(folder, { log: (t) => log("dim", `  📂 ${t}`), kinds: "v1" }); if (source?.error) { log("warn", `△ 📄 ${source.error}`); source = null; } } } catch (e) { log("warn", `△ 📄 폴더 가져오기(A1) 실패 → 자체 읽기 (${e?.message || e})`); }
    if (!source) source = importFolderLite(folder);
    if (!source || !((source.gallery || []).length + (source.detailImages || []).length)) return { error: "폴더에서 상품 이미지(main-·SKU-·detail-)를 찾지 못했습니다" };
    return start({ source: { ...source, rowId: p.rowId ?? null }, templateId: "card", phase: "prepare", auto: !!p.oneShot });
  });
  ipcMain.handle("detail:info:get", (_e, p = {}) => infoGet(String(p.jobId || "")));
  ipcMain.handle("detail:info:set", (_e, p = {}) => infoSet(String(p.jobId || ""), p.patch || {}));
  // 판매 실적·신뢰 문구 예시(A3 suggestClaims, 숫자 칸은 비워 둔다 — 실제 사실은 사용자가 채움)
  ipcMain.handle("detail:claims:suggest", async (_e, p = {}) => {
    const dir = jobDirOf(String(p.jobId || "")); const info = readJson(path.join(dir, "info.json")) || {};
    const brief = readJson(path.join(dir, "brief.json")) || { product_name_ko: info.product_name_ko || "" };
    let items = null, how = "lite";
    try { const cp = await mod("copy", log), pc = await mod("plan-core", log); const fn = cp?.suggestClaims || pc?.suggestClaims; if (fn) { const r = await fn(brief, { info }); const KEY = { sold_out: "sold_out_banner", rank: "rank_badge" }; items = {}; for (const [k0, v] of Object.entries(r || {})) { const k = KEY[k0] || k0; if (!claimTypes.has(k)) continue; const opts = (Array.isArray(v) ? v : [v]).map((x) => String(typeof x === "string" ? x : x?.text || "")).filter(Boolean); if (!opts.length) continue; items[k] = { text: k === "trust_badges" ? opts.join(" · ") : opts[0], value: "", options: k === "trust_badges" ? [] : opts }; } how = "A3"; if (r?.note) items._note = r.note; } } catch (e) { log("dim", `  📄 문구 예시(A3) 실패 → 기본 틀 (${e?.message || e})`); }
    if (!items || !Object.keys(items).length) items = suggestClaimsLite(brief);
    const note = items._note || "□ 칸은 실제 자료가 있을 때만 채워 주세요. 비워 두면 그 항목은 넣지 않습니다."; delete items._note;
    return { items, how, note };
  });
  // 2단계: 고친 값과 함께 생성(장면·카피·구성·렌더·검수) — 1단계 결과(사진 검수·누끼·기획안·번역)는 재사용
  ipcMain.handle("detail:confirm", (_e, p = {}) => {
    const id = String(p.jobId || ""); if (!id || !exists(path.join(jobDirOf(id), "info.json"))) return { error: "먼저 상품 정보를 가져와야 합니다" };
    if (p.edits) { const r = infoSet(id, p.edits); if (r.error) return r; }
    const info = readJson(path.join(jobDirOf(id), "info.json")) || {};
    if (readJson(path.join(jobDirOf(id), "source.json"))?.lang === "ko" && !info.rightsOk) return { error: "위 안내에서 「내 상품 사진이에요」를 먼저 눌러 주세요 — 다른 판매자 상품이면 🧲 레퍼런스로 저장하세요" };
    return start({ jobId: id, templateId: p.templateId || info.templateId, theme: info.theme || null, reuse: true, fresh: ["copy", "scene", "qa", "sections"], phase: "generate", review: p.review });
  });

  // ---- v5 편집: 섹션 목록 · 다시 만들기 · 글자 고치기 · 순서/삭제 · 내보내기 ----
  // 섹션 사진의 로고 상태: 장면이면 scene.json(human·any_logo_visible·has_logo), 원본 사진이면 info.logos → vision
  function logoOf(dir, rel, scene) {
    if (!rel) return false;
    const it = (scene?.items || []).find((x) => x.file === rel);
    if (it) return it.human === "logo" ? true : it.human === "nologo" ? false : !!(it.any_logo_visible ?? it.has_logo);
    const m = path.basename(rel).match(/^([a-z]\d+)(?:[_.-]|$)/i); if (!m) return false;
    const info = readJson(path.join(dir, "info.json")) || {}; if (info.logos?.[m[1]] != null) return !!info.logos[m[1]];
    const v = readJson(path.join(dir, "vision.json"))?.items?.find((x) => x.id === m[1]); return !!(v?.any_logo_visible ?? v?.has_logo);
  }
  // "로고 있음" 토글(결과 화면 섹션 사진) → scene.json 또는 info.logos 에 사람 표시 → AI 없이 재구성·재렌더
  ipcMain.handle("detail:logo:set", (_e, p = {}) => {
    const id = String(p.jobId || ""), dir = jobDirOf(id), on = !!p.on;
    let rel = String(p.file || ""); if (path.isAbsolute(rel)) rel = path.relative(dir, rel); rel = rel.replace(/\\/g, "/");
    const scene = readJson(path.join(dir, "scene.json"));
    const hit = (scene?.items || []).filter((x) => x.file === rel);
    if (hit.length) { hit.forEach((x) => { x.human = on ? "logo" : "nologo"; x.any_logo_visible = on; }); writeJson(path.join(dir, "scene.json"), scene); }
    else { const m = path.basename(rel).match(/^([a-z]\d+)(?:[_.-]|$)/i) || (p.imageId ? [0, String(p.imageId)] : null); if (!m) return { error: "어느 사진인지 알 수 없습니다" }; const r = infoSet(id, { logos: { [m[1]]: on } }); if (r?.error) return r; }
    if (p.render === false) return { ok: true };
    const res = readJson(path.join(dir, "result.json")) || {};
    if (!exists(path.join(dir, "plan.json"))) return { ok: true }; // 아직 1단계(확인 화면) — 생성 때 반영
    return start({ jobId: id, templateId: res.templateId || "card", theme: themeOfView(res, p.renderId), reuse: true, phase: "generate", skipQa: true, regen: { label: on ? "로고 사진 빼기" : "로고 표시 해제" } });
  });
  // 지금 보고 있는 렌더의 테마(글자 수정·섹션 다시 만들기 등에서 테마가 기본값으로 돌아가지 않게)
  const themeOfView = (res, renderId) => { const r = (res?.renders || []).find((x) => x.id === (renderId || res?.current)); return r?.theme || (r && THEMES.some((t) => t.id === r.templateId) ? r.templateId : null) || res?.theme || null; };
  // 편집 칸에 보일 글 전부: 문장 + 배지·지시선·목록·표·FAQ (path 는 "icons.0.label" 처럼 plan 섹션 안의 위치)
  const EDIT_STR = [["label", "작은 머리말"], ["category", "분류"], ["question", "질문"], ["headline", "큰 제목"], ["name", "상품명"], ["title", "제목"], ["sub", "보조 문구"], ["desc", "설명"]];
  const EDIT_ITEM = [["label", "이름"], ["title", "제목"], ["name", "이름"], ["text", "내용"], ["desc", "설명"], ["q", "질문"], ["a", "답"], ["k", "항목"], ["v", "내용"], ["thin", "작은 글"], ["bold", "굵은 글"]];
  const EDIT_ARR = { icons: "배지", callouts: "지시선", items: "", rows: "표" };
  function editFieldsOf(sec) {
    const out = [];
    for (const [k, lab] of EDIT_STR) if (typeof sec[k] === "string") out.push({ path: k, label: lab, value: sec[k] });
    for (const [a, an] of Object.entries(EDIT_ARR)) {
      if (!Array.isArray(sec[a])) continue;
      const nm = an || { notice: "확인", faq: "FAQ", versatility: "장소", detail: "규격", problem: "항목" }[sec.type] || "항목";
      sec[a].forEach((it, i) => {
        const g = `${nm} ${i + 1}`;
        if (typeof it === "string") return out.push({ path: `${a}.${i}`, label: g, value: it, group: g });
        if (!it || typeof it !== "object") return;
        for (const [k, kl] of EDIT_ITEM) if (typeof it[k] === "string" && !(a === "callouts" && k === "label" && (it.thin != null || it.bold != null))) out.push({ path: `${a}.${i}.${k}`, label: kl, value: it[k], group: g });
      });
    }
    return out;
  }
  ipcMain.handle("detail:sections:get", (_e, p = {}) => {
    const dir = jobDirOf(String(p.jobId || "")); const plan = readJson(path.join(dir, "plan.json")); if (!plan) return { error: "구성이 없습니다" };
    const scene = readJson(path.join(dir, "scene.json"));
    return { jobId: p.jobId, dir, templateId: plan.meta?.templateId, v5: plan.meta?.version === 5, sections: plan.sections.map((sec) => ({ id: sec.id, type: sec.type, part: sec.part || "", image: sec.image ? path.join(dir, sec.image) : (sec.images?.[0] ? path.join(dir, sec.images[0]) : ""), from: sec.from || "",
      texts: Object.fromEntries(["label", "category", "name", "sub", "title", "desc", "headline"].filter((k) => typeof sec[k] === "string").map((k) => [k, sec[k]])), fields: editFieldsOf(sec), scene: (scene?.items || []).filter((x) => x.section === sec.id).map((x) => ({ file: path.join(dir, x.file), pass: x.pass, note: x.note || "" })),
      rel: sec.image || sec.images?.[0] || "", logo: logoOf(dir, sec.image || sec.images?.[0] || "", scene) })) };
  });
  // 그 섹션 장면만 요청문과 함께 다시 생성(+원하면 글도) → 새 렌더 탭
  ipcMain.handle("detail:section:regen", (_e, p = {}) => {
    const id = String(p.jobId || ""); if (!exists(path.join(jobDirOf(id), "sections.json"))) return { error: "v5(카드) 결과에서만 섹션을 다시 만들 수 있습니다" };
    const info = readJson(path.join(jobDirOf(id), "info.json")) || {}, res = readJson(path.join(jobDirOf(id), "result.json")) || {};
    return start({ jobId: id, templateId: res.templateId || info.templateId || "card", theme: themeOfView(res, p.renderId), reuse: true, fresh: p.rewrite ? ["copy"] : [], phase: "generate", skipQa: true, regen: { sectionId: String(p.sectionId || ""), request: String(p.request || "").slice(0, 300), scene: p.scene !== false, rewrite: !!p.rewrite, label: `${p.sectionId} 다시` } });
  });
  // 빠진 섹션 장면만 추가 생성(429·검수 실패·중복 사진 섹션) → 검수 → 구성 → 새 렌더
  ipcMain.handle("detail:sections:fill", (_e, p = {}) => {
    const id = String(p.jobId || ""), dir = jobDirOf(id); if (!exists(path.join(dir, "sections.json"))) return { error: "v5(카드) 결과에서만 됩니다" };
    const plan = readJson(path.join(dir, "plan.json")) || {}, res = readJson(path.join(dir, "result.json")) || {};
    const probe = JSON.parse(JSON.stringify(plan.sections ? plan : { sections: [] })); const d0 = dedupeVisual(probe, dir); // 지금 구성에서 같은 사진을 쓰는 섹션
    // 장면이 아닌 사진(중국 원본)으로 채워진 장면 섹션도 대상: from:"photo"
    const photoFilled = (plan.sections || []).filter((x) => x.from === "photo" && ["options", "detail", "versatility", "feature", "before_after"].includes(x.type)).map((x) => x.id);
    const dupSections = [...new Set([...d0.map((d) => d.section), ...photoFilled, ...(p.dupSections || [])])];
    const force = Array.isArray(p.force) ? p.force.map(String) : [];
    return start({ jobId: id, templateId: res.templateId || "card", theme: themeOfView(res, p.renderId), reuse: true, phase: "generate", skipQa: true, regen: { fill: true, dupSections, force, label: force.length ? `다시 생성: ${force.join("·")}` : "빠진 장면 채움" } });
  });
  // 글자 바로 고치기(AI 호출 없음): copy.json 의 그 섹션 글을 바꾸고 다시 그림
  ipcMain.handle("detail:section:text", (_e, p = {}) => {
    const id = String(p.jobId || ""), dir = jobDirOf(id); const copy = readJson(path.join(dir, "copy.json")); if (!copy) return { error: "카피가 없습니다" };
    // 문장은 그대로, 배열(배지·목록·표·FAQ·지시선)은 지금 그려진 plan 섹션의 배열을 복사해 고친 뒤 통째로 copy 에 둔다
    const planSec = (readJson(path.join(dir, "plan.json"))?.sections || []).find((x) => x.id === p.sectionId) || {};
    const patch = {};
    for (const [k, v] of Object.entries(p.patch || {})) {
      if (typeof v !== "string") continue; const val = v.slice(0, 400);
      if (/^(label|category|name|sub|title|desc|headline|question)$/.test(k)) { patch[k] = val; continue; }
      const m = k.match(/^(icons|callouts|items|rows)\.(\d+)(?:\.(label|title|name|text|desc|q|a|k|v|thin|bold))?$/); if (!m) continue;
      const arr = patch[m[1]] || (patch[m[1]] = JSON.parse(JSON.stringify(Array.isArray(planSec[m[1]]) ? planSec[m[1]] : [])));
      const i = +m[2]; if (i >= arr.length) continue;
      if (!m[3]) { if (typeof arr[i] === "string") arr[i] = val; continue; }
      if (!arr[i] || typeof arr[i] !== "object") continue;
      arr[i][m[3]] = val;
      if (m[1] === "callouts" && (m[3] === "thin" || m[3] === "bold")) arr[i].label = [arr[i].thin, arr[i].bold].filter(Boolean).join("\n"); // 지시선 라벨 = 작은 글 + 굵은 글
    }
    if (patch.items) for (const it of patch.items) if (it && typeof it === "object" && "image" in it) delete it.image; // 규격 사진은 구성 때 다시 붙는다
    if (planSec.type === "spec" && patch.rows) { patch.rows_edit = patch.rows; delete patch.rows; } // 스펙 표는 정리된 행이 카피보다 우선이라 따로 둔다
    copy.sections = copy.sections || {}; copy.sections[p.sectionId] = { ...(copy.sections[p.sectionId] || {}), ...patch };
    writeJson(path.join(dir, "copy.json"), copy);
    if (p.render === false) return { ok: true };
    const res = readJson(path.join(dir, "result.json")) || {};
    return start({ jobId: id, templateId: res.templateId || "card", theme: themeOfView(res, p.renderId), reuse: true, phase: "generate", skipQa: true, regen: { label: "글자 수정" } });
  });
  // 섹션 순서 바꾸기·삭제 → 다시 그림
  ipcMain.handle("detail:sections:set", (_e, p = {}) => {
    const id = String(p.jobId || ""), dir = jobDirOf(id); let secs = readJson(path.join(dir, "sections.json")); if (secs && !Array.isArray(secs) && Array.isArray(secs.sections)) secs = secs.sections; if (!Array.isArray(secs)) return { error: "v5(카드) 결과에서만 됩니다" };
    const removed = new Set((p.removed || []).map(String)); const order = (p.order || []).map(String);
    let next = secs.filter((x) => !removed.has(x.id) || x.type === "hero");
    if (order.length) next.sort((a, b) => (order.indexOf(a.id) < 0 ? 999 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 999 : order.indexOf(b.id)));
    writeJson(path.join(dir, "sections.json"), next);
    if (p.render === false) return { ok: true, sections: next.length };
    const res = readJson(path.join(dir, "result.json")) || {};
    return start({ jobId: id, templateId: res.templateId || "card", theme: themeOfView(res, p.renderId), reuse: true, phase: "generate", skipQa: true, regen: { label: "순서·삭제" } });
  });
  // 내보내기: 780/860px · JPG/PNG · 한 장/섹션별 → out/<렌더>/export-…/ 폴더
  ipcMain.handle("detail:export", async (_e, p = {}) => {
    const dir = jobDirOf(String(p.jobId || "")); const r0 = migrateRenders(readJson(path.join(dir, "result.json")) || {}); const r = renderOf(r0, p.renderId);
    if (!r?.slices?.length) return { error: "내보낼 렌더가 없습니다" };
    const W = [780, 860].includes(Number(p.width)) ? Number(p.width) : 780, fmt = p.format === "png" ? "png" : "jpg", mode = p.mode === "sections" ? "sections" : "single";
    const outDir = path.join(dir, r.dir || "out", `export-${W}-${fmt}-${mode}`); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
    // 슬라이스를 이어 붙인 전체 비트맵(가로 W)
    const imgs = r.slices.map((sl) => { let im = nativeImage.createFromPath(path.join(dir, sl.file)); const sz = im.getSize(); if (sz.width !== W) im = im.resize({ width: W, height: Math.round(sz.height * W / sz.width), quality: "best" }); return im; });
    const H = imgs.reduce((n, im) => n + im.getSize().height, 0);
    const buf = Buffer.alloc(W * H * 4); let y = 0;
    for (const im of imgs) { const b = im.toBitmap(); const h = im.getSize().height; b.copy(buf, y * W * 4, 0, Math.min(b.length, W * h * 4)); y += h; }
    const enc = (im) => (fmt === "png" ? im.toPNG() : im.toJPEG(92));
    const files = [];
    if (mode === "single") { const im = nativeImage.createFromBitmap(buf, { width: W, height: H }); const f = path.join(outDir, `detail-${W}.${fmt}`); fs.writeFileSync(f, enc(im)); files.push(f); }
    else {
      const srcW = r.width || r.slices[0].w || W, k = W / srcW;
      const secs = (r.sections || []).map((x, i, a) => ({ ...x, end: a[i + 1]?.y ?? Math.round(H / k) })).filter((x) => x.end > x.y);
      if (!secs.length) return { error: "섹션 위치 정보가 없는 렌더입니다 — 한 장으로 내보내세요" };
      secs.forEach((x, i) => { const y0 = Math.round(x.y * k), h = Math.min(H - y0, Math.round((x.end - x.y) * k)); if (h <= 0) return; const part = Buffer.from(buf.subarray(y0 * W * 4, (y0 + h) * W * 4)); const im = nativeImage.createFromBitmap(part, { width: W, height: h }); const f = path.join(outDir, `${pad(i + 1)}-${x.type}.${fmt}`); fs.writeFileSync(f, enc(im)); files.push(f); });
    }
    if (p.open !== false) shell.openPath(outDir);
    return { ok: true, dir: outDir, files: files.map((f) => path.relative(dir, f)), width: W, format: fmt, mode };
  });

  // 렌더 하나 지우기(화면에서 두 번 눌러 확인) — 옛 out/ 바로 아래 결과는 그 파일들만 지운다
  ipcMain.handle("detail:renderDelete", (_e, p = {}) => {
    const dir = jobDirOf(String(p.jobId || "")); if (!p.jobId || !exists(dir)) return { error: "작업 폴더가 없습니다" };
    if (cur?.jobId === p.jobId) return { error: "만드는 중인 작업은 지울 수 없습니다" };
    const r = migrateRenders(readJson(path.join(dir, "result.json")) || {});
    const t = (r.renders || []).find((x) => x.id === p.renderId); if (!t) return { error: "그 렌더가 없습니다" };
    if (t.dir === "out") [...(t.slices || []).map((x) => x.file), t.preview, t.html, t.figmaManifest, t.figmaBundle].filter(Boolean).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
    else if (/^out\/[\w.-]+$/.test(t.dir)) fs.rmSync(path.join(dir, t.dir), { recursive: true, force: true });
    r.renders = r.renders.filter((x) => x.id !== t.id);
    const last = r.renders.slice(-1)[0] || null;
    if (r.current === t.id) { r.current = last?.id || null; if (last) Object.assign(r, { templateId: last.templateId, slices: last.slices, preview: last.preview, html: last.html, figmaBundle: last.figmaBundle, figmaManifest: last.figmaManifest }); else Object.assign(r, { slices: [], preview: null }); }
    writeJson(path.join(dir, "result.json"), r); changed();
    return { ok: true, renders: r.renders.length, current: r.current };
  });
  // 원본 1688 주소를 앱의 🇨🇳 1688 탭으로 연다 (main.js 의 openCn 경로 재사용)
  ipcMain.handle("detail:openSource", (_e, p = {}) => {
    let url = String(p.url || "");
    if (!url && p.jobId) { const dir = jobDirOf(String(p.jobId)); url = readJson(path.join(dir, "result.json"))?.url || readJson(path.join(dir, "source.json"))?.url || ""; }
    { const rt = routeProductUrl(url); if (rt.site === "coupang" && openCoupang) { openCoupang(rt.url); return { ok: true, url }; } if (rt.site === "naver" || rt.site === "ohou") return import("./site-read.js").then((m) => { m.openVisible(rt.url); return { ok: true, url }; }); } // 한국 판매처 원본: 쿠팡 탭 / 보이는 창
    if (!/^https?:\/\/([\w-]+\.)*(1688|taobao|tmall)\.com\//.test(url)) return { error: "원본 주소가 없습니다" };
    if (!openCn) return { error: "1688 탭을 열 수 없습니다" };
    openCn(url); return { ok: true, url };
  });
  ipcMain.handle("detail:setTemplate", (_e, id) => { store.set("settings", { ...(store.get("settings") || {}), detailTemplate: TEMPLATES.some((t) => t.id === id) ? id : "clean" }); return true; });

  return { start, cancel, get, list: listJobs, templates, running, STEPS, TEMPLATES, jobDirOf };
}
