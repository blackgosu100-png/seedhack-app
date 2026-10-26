// 원본 한글화 장별 고치기(결과 화면 오른쪽 칸) — 수강생이 ⚠ 장을 단추 한두 번으로 끝내게
//  단추 4개: autofix(그 장만 다시 자동 고치기) · drop(이 장 빼기) · plain(한글 빼고 그림만) · tidy(줄·크기 맞추기)
//  세부: text(줄마다 문구·크기·굵게·정렬·빼기, AI 0) · request(이 장에 요청 → AI 가 줄 수정안) · undo(그 장 이전 상태로)
//  모든 고치기는 plan 을 바꾸고 → 전체 다시 그리기(같은 탭, 약 5초) → 그 장만 다시 검수(runLocQa only). 이전 상태는 장마다 쌓아 둔다(그림 바꾸면 그림도 보관)
// 기록: <작업>/.loc-edit/<렌더 id>/history.json { stack:{ id:[{ kind, sec, img?, index? }] }, removed:[{ id, name }] }
import fs from "node:fs";
import path from "node:path";
import { runLocQa, measurePage } from "./loc-qa.js";
import { fixPlan, norm } from "./loc-qa-core.js";

const noop = () => {};
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const MAX_HIST = 20;
export const ACTIONS = ["autofix", "drop", "plain", "tidy", "text", "request", "undo"];
const ALIGN = ["left", "center", "right"];

export const histDirOf = (dir, rid) => path.join(dir, ".loc-edit", rid);
export function loadHist(dir, rid) { return readJson(path.join(histDirOf(dir, rid), "history.json")) || { stack: {}, removed: [] }; }
function saveHist(dir, rid, H) { const d = histDirOf(dir, rid); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "history.json"), JSON.stringify(H)); }

// 화면에 줄 목록: plan 레이어(뺀 줄 포함 — 다시 살릴 수 있게) · 지금 크기·굵기·정렬
const sizeOf = (l) => Math.round(Number(l?.style?.size ?? l?.style?.fontSizePx) || (Number(l?.h) || 0) * 0.78);
export function sectionView(plan, id, H = { stack: {}, removed: [] }) {
  const sec = (plan.sections || []).find((x) => x.id === id);
  if (!sec) return null;
  const layers = sec.type === "image" ? (sec.layers || []).map((l, i) => ({ i, ko: String(l.ko || ""), role: l.role || "", size: sizeOf(l), weight: Number(l.style?.weight ?? l.style?.fontWeight) || (l.role === "title" ? 700 : 400), align: l.style?.align || "", drop: !!l.drop, plain: !!l.qaPlain, shape: l.shape ? (l.shape.circle ? "원" : l.shape.round || l.shape.pill ? "알약" : "칸") : "" }))
    .filter((l) => l.ko.trim() && !["number", "dims", "price", "logo"].includes(l.role)) : [];
  return { id, type: sec.type, image: sec.image || null, iw: sec.iw || null, layers, canUndo: !!(H.stack[id] || []).length, removed: H.removed || [] };
}

// 문구 고치기 한 줄 적용(AI 0) — 값은 안전한 범위로
function applyPatch(l, p) {
  if (!l || !p) return false;
  let ch = false; const st = { ...(l.style || {}) };
  if (typeof p.ko === "string") { const ko = p.ko.replace(/\s+$/g, "").slice(0, 120); if (ko && ko !== l.ko) { l.ko_before ??= l.ko; l.ko = ko; ch = true; } }
  if (p.size != null && isFinite(p.size)) { const v = Math.max(8, Math.min(160, Math.round(Number(p.size) * 10) / 10)); if (v !== sizeOf(l)) { st.size = v; ch = true; } }
  if (p.weight != null) { const v = [400, 500, 700, 800].includes(Number(p.weight)) ? Number(p.weight) : null; if (v) { st.weight = v; ch = true; } }
  if (ALIGN.includes(p.align)) { st.align = p.align; ch = true; }
  if (p.dx || p.dy) { const dx = Math.max(-300, Math.min(300, Number(p.dx) || 0)), dy = Math.max(-300, Math.min(300, Number(p.dy) || 0)); l.x += dx; l.y += dy; if (l.textBox) l.textBox = { ...l.textBox, x: l.textBox.x + dx, y: l.textBox.y + dy }; ch = true; }
  if (typeof p.drop === "boolean" && p.drop !== !!l.drop) { l.drop = p.drop; if (!p.drop) delete l.qaPlain; ch = true; }
  if (ch) l.style = st;
  return ch;
}

// "이 장에 요청" — 장 캡처(Read) + 줄 목록 + 요청 → AI 가 고칠 줄만 patches 로
const REQ_SYSTEM = `당신은 쿠팡 상세페이지 한 장(중국어를 지우고 한글을 얹은 이미지)의 한글 글 배치를 고치는 디자이너입니다. Read 로 이미지를 열어 보고, 사용자의 요청대로 고칠 줄만 patches 로 답합니다.
쓸 수 있는 값(좌표·크기는 원본 이미지 px): ko(문구) · size(글자 크기) · weight(400/700/800) · align(left/center/right) · drop(true = 그 줄 빼기, false = 뺀 줄 살리기) · dx·dy(위치 이동, ±300).
요청과 상관없는 줄은 건드리지 않습니다. 검수에서 걸린 것이 함께 오면 그것도 같이 풉니다("당신"·"~하십시오" 같은 직역 말투는 쓰지 않음). 원·알약 안 글이 넘치면 size 를 줄이거나 문구를 짧게. 문구는 한국 쇼핑몰 말투로 짧게, 숫자·단위는 그대로. note 에 무엇을 바꿨는지 한 줄(쉬운 말).`;
const REQ_SCHEMA = { type: "object", additionalProperties: false, required: ["patches", "note"], properties: { note: { type: "string" }, patches: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["i"], properties: {
  i: { type: "integer" }, ko: { type: "string" }, size: { type: "number" }, weight: { type: "integer" }, align: { type: "string", enum: ALIGN }, drop: { type: "boolean" }, dx: { type: "number" }, dy: { type: "number" } } } } } };

/**
 * ctx: { dir, renderId, plan(제자리 수정), tl, ocr, rawOf, cli, settings, ai, render(plan)→새 렌더, prevAi({id: ai}), action, sectionId, payload, log, progress }
 * → { section(그 장 새 검수 결과 | null=뺌), tops(장마다 새 y), rendered, costUsd, ms, note, removed, canUndo }
 */
export async function locEdit(ctx) {
  const { dir, renderId, plan, action, sectionId: id, payload = {} } = ctx;
  const log = ctx.log || noop, say = ctx.progress || noop, t0 = Date.now();
  if (!ACTIONS.includes(action)) throw new Error("모르는 고치기입니다");
  const H = loadHist(dir, renderId), hd = histDirOf(dir, renderId); fs.mkdirSync(hd, { recursive: true });
  const idx = () => (plan.sections || []).findIndex((x) => x.id === id);
  let sec = plan.sections[idx()] || null;
  if (!sec && action !== "undo") throw new Error("그 장을 찾지 못했습니다");
  const imgPath = () => (sec?.image && String(sec.image).startsWith("localize/") ? path.join(dir, sec.image) : null);
  const keepImg = () => { const f = imgPath(); if (!f || !fs.existsSync(f)) return null; const b = path.join(hd, `${id}-${Date.now()}.png`); fs.copyFileSync(f, b); return path.basename(b); };
  const push = (e) => { const st = (H.stack[id] ||= []); st.push(e); while (st.length > MAX_HIST) { const old = st.shift(); if (old.img) try { fs.rmSync(path.join(hd, old.img), { force: true }); } catch {} } };
  let cost = 0, note = "", recheck = true, aiReview = false, prevAi = ctx.prevAi || {};
  const keepImageAi = () => { const a = prevAi[id]; prevAi = { ...prevAi, [id]: a ? { ...a, issues: (a.issues || []).filter((x) => ["residue", "empty_deco"].includes(x.kind)) } : null }; }; // 사람이 글·배치를 직접 정했으면 AI 의 글·배치 지적은 내려놓고 그림 지적(얼룩·빈 장식)만 남긴다

  if (action === "undo") {
    const e = (H.stack[id] || []).pop(); if (!e) throw new Error("되돌릴 것이 없어요");
    if (e.kind === "drop") { plan.sections.splice(Math.min(e.index, plan.sections.length), 0, JSON.parse(e.sec)); H.removed = (H.removed || []).filter((r) => r.id !== id); }
    else { const i = idx(); if (i >= 0) plan.sections[i] = JSON.parse(e.sec); }
    sec = plan.sections[idx()];
    if (e.img) { const f = imgPath(); if (f) fs.copyFileSync(path.join(hd, e.img), f); try { fs.rmSync(path.join(hd, e.img), { force: true }); } catch {} }
    note = e.kind === "drop" ? "뺀 장을 다시 넣었어요" : "이전 상태로 되돌렸어요";
    if (e.prevAi !== undefined) prevAi = { ...prevAi, [id]: e.prevAi };
  } else if (action === "drop") {
    push({ kind: "drop", index: idx(), sec: JSON.stringify(sec), prevAi: prevAi[id] ?? null });
    plan.sections.splice(idx(), 1);
    (H.removed ||= []).push({ id, name: payload.name || id });
    note = "이 장을 뺐어요"; recheck = false;
  } else {
    push({ kind: action, sec: JSON.stringify(sec), img: ["plain", "autofix", "request"].includes(action) ? keepImg() : null, prevAi: prevAi[id] ?? null });
    if (action === "plain") { // 한글 빼고 그림만: 글을 모두 빼고, 글이 들어 있던 알약·원은 바탕으로 메운다(빈 장식이 남지 않게)
      const shapes = [];
      for (const l of sec.layers || []) if (!l.drop && String(l.ko || "").trim()) { l.drop = true; l.qaPlain = true; if (l.shape) shapes.push(l.shape); }
      if (shapes.length && imgPath()) { try { const { eraseShapes } = await import("./localize.js"); eraseShapes(imgPath(), shapes); } catch (e) { log("dim", `  ✏️ 도형 지우기 실패 (${e?.message || e})`); } }
      note = "한글 글을 빼고 지운 그림만 남겼어요"; keepImageAi();
    } else if (action === "tidy") {
      const d = fixPlan(sec, [{ kind: "roleDev", fix: "layout", texts: [] }], 0);
      note = d.length ? `줄·크기 맞춤 — ${d.join(" · ")}` : "이미 맞춰져 있어요"; keepImageAi();
    } else if (action === "text") {
      let n = 0; for (const p of payload.layers || []) if (applyPatch(sec.layers?.[p.i], p)) n++;
      note = n ? `${n}줄 고쳤어요` : "바뀐 줄이 없어요"; keepImageAi();
    } else if (action === "request") {
      const ask = String(payload.text || "").trim().slice(0, 200); if (!ask) throw new Error("요청을 적어 주세요");
      if (!ctx.cli?.runStructured) throw new Error("AI 를 쓸 수 없어요(Claude 연결 확인)");
      say("📷 이 장을 AI 에게 보여 주는 중");
      const m = await measurePage({ dir, renderDir: path.join("out", renderId), plan, shotDir: path.join(hd, "shot"), only: new Set([id]), width: Number(plan.meta?.width) || 780 });
      const shot = m.shots[id]; if (!shot) throw new Error("이 장 화면을 찍지 못했어요");
      const sc = sec.iw && m.wraps[0]?.width ? (sec.iw / (m.wraps.find((w) => w.id === id)?.width || sec.iw)) : 1;
      const lines = (sec.layers || []).map((l, i) => ({ l, i })).filter(({ l }) => String(l.ko || "").trim() && !["number", "dims", "price", "logo"].includes(l.role))
        .map(({ l, i }) => `${i}. [${l.role || "글"}${l.drop ? " · 뺀 줄" : ""}${l.shape ? (l.shape.circle ? " · 원 안" : " · 알약/칸 안") : ""}] "${l.ko}" x${Math.round(l.x)} y${Math.round(l.y)} w${Math.round(l.w)} h${Math.round(l.h)} 크기${sizeOf(l)} 굵기${l.style?.weight ?? l.style?.fontWeight ?? "-"} 정렬${l.style?.align || "-"}${l.shape ? ` 도형 x${Math.round(l.shape.x)} y${Math.round(l.shape.y)} w${Math.round(l.shape.w)} h${Math.round(l.shape.h)}` : ""}`);
      say("🤖 AI 가 고칠 방법을 찾는 중");
      const r = await ctx.cli.runStructured({ purpose: "loc-edit", system: REQ_SYSTEM, schema: REQ_SCHEMA, model: ctx.settings?.detailLocEditModel || "haiku", /* 실측 sonnet 1회 $0.37 — 기본 haiku */ timeoutMs: 150000, allowedTools: ["Read"],
        text: `요청: ${ask}\n\n이미지(Read 로 열기): ${shot}\n화면 1px = 원본 ${sc.toFixed(2)}px · 원본 크기 ${sec.iw || "?"}×${sec.ih || "?"}\n\n글 줄(번호. [역할] "문구" 위치·크기):\n${lines.join("\n")}${(ctx.issues || []).length ? `\n\n검수에서 걸린 것(함께 풀어 주세요): ${ctx.issues.map((x) => x.why).join(" / ")}` : ""}` });
      if (r?.error) throw new Error(`AI 요청 실패 · ${r.error}`);
      cost += Number(r.costUsd) || 0;
      let n = 0; for (const p of r.result?.patches || []) if (applyPatch(sec.layers?.[p.i], p)) n++;
      note = n ? `${String(r.result?.note || "").slice(0, 80) || `${n}줄 고쳤어요`}` : `AI 가 바꿀 줄을 찾지 못했어요${r.result?.note ? ` — ${String(r.result.note).slice(0, 60)}` : ""}`;
      aiReview = true; // 요청 뒤에는 AI 도 다시 본다(⚠ 가 풀리는지)
    }
  }
  if (action === "autofix") { // 그 장만 다시 자동 고치기: 검수 → 고치기(재배치·다시 지우기·다시 쓰기) 최대 2회 → 다시 검수
    say("🔧 이 장을 다시 고치는 중");
    const q = await runLocQa({ ...ctx, only: new Set([id]), prevAi: {}, aiReview: true, limits: { maxMs: 150000, maxUsd: 0.25, rounds: 2 }, progress: say, log });
    const rendered = q.rendered || await ctx.render(plan);
    saveHist(dir, renderId, H);
    const s = q.sections[id] || null;
    return { section: s, tops: q.tops, rendered, costUsd: q.costUsd, ms: Date.now() - t0, note: q.steps.slice(1).join(" · ") || (s?.pass ? "문제 없어요" : "자동으로는 더 못 고쳤어요 — 아래 글 고치기·요청을 써 보세요"), removed: H.removed || [], canUndo: !!(H.stack[id] || []).length };
  }
  say("🖼 다시 그리는 중");
  const rendered = await ctx.render(plan);
  saveHist(dir, renderId, H);
  say(recheck ? "🔍 이 장 다시 검수하는 중" : "🔍 장 위치 맞추는 중");
  const q = await runLocQa({ ...ctx, only: new Set(recheck ? [id] : []), prevAi, aiReview, limits: { maxMs: 90000, maxUsd: 0.15, rounds: 0 }, progress: noop, log });
  cost += q.costUsd;
  return { section: recheck ? q.sections[id] || null : null, tops: q.tops, rendered, costUsd: +cost.toFixed(4), ms: Date.now() - t0, note, removed: H.removed || [], canUndo: !!(H.stack[id] || []).length };
}

// 화면 글 상자 → plan 줄 번호(미리보기에서 글을 누르면 그 줄로)
export function unitToLayer(sec, text) { const k = norm(text); return (sec?.layers || []).findIndex((l) => { const n = norm(l.ko); return n && k && (n === k || n.startsWith(k) || k.startsWith(n)); }); }
