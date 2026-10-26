// 원본 한글화 앱 내 자동 검수 — 순수 계산(전자·DOM 없음, 노드 단위테스트: test/detail/loc-qa-core.test.js)
//  · judgeSection: 장별 측정값(화면 DOM · 잔상 · OCR · 직역 · AI 비전) → 문제 목록 [{ kind, why, fix, texts? }]
//  · fixPlan: 문제 → 그 장 plan 고치기(같은 역할 크기 맞춤 · 열 맞춤 · 줄이기 · 테두리 글) — 다시 그리기 전에 적용
//  · 다시 지우기(erase)·문구 다시 쓰기(rewrite)는 loc-qa.js 가 한다(이미지·AI 필요)
// 기준(대표님): 오와 열·여백·폰트 크기·자간·행 높이 일관 · 도형 밖 넘침 금지 · 잔상·빈 장식 0 · 직역 금지
import { LITERAL_RE } from "./localize-core.js";

export const LIMITS = { roleDev: 10, colDev: 6, maxMs: 180000, maxUsd: 0.4, rounds: 2 }; // 같은 역할 크기 편차 % · 열 왼쪽 끝 편차 px(화면) · 시간 · 비용 · 고치기 회차
export const KIND_KO = { overlap: "글 겹침", overflow: "도형 밖 넘침", roleDev: "같은 역할 글 크기 다름", colDev: "줄 왼쪽 끝 안 맞음", contrast: "글자가 잘 안 보임", residue: "지운 자리 얼룩", chinese: "중국어 남음", literal: "어색한 번역", emptyDeco: "빈 장식", ai: "AI 검수 지적" };
// AI 비전 지적 종류 → 고치는 법
export const AI_KINDS = ["align", "spacing", "size", "overflow", "residue", "empty_deco", "translation"];
const AI_FIX = { align: "layout", spacing: "layout", size: "layout", overflow: "layout", residue: "erase", empty_deco: null, translation: "rewrite" };
const AI_KO = { align: "오와 열 안 맞음", spacing: "여백·줄 간격 들쭉날쭉", size: "글 크기 들쭉날쭉", overflow: "글이 도형·그림 밖으로", residue: "지운 자리 얼룩", empty_deco: "빈 장식", translation: "어색한 번역" };

export const norm = (t) => String(t ?? "").replace(/[\s​­]+/g, "");
const short = (t, n = 12) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

// 직역 검출(재생 하네스와 같은 규칙): 직역체 말투 또는 한자가 남은 한글 문구
export function literalOf(texts = []) { return texts.filter((t) => LITERAL_RE.test(String(t || "")) || /[一-鿿]/.test(String(t || ""))); }

// 완성 화면 OCR 상자 → 진짜 남은 중국어만: 한자 2자 이상 연속 · 한글 없음 · 숫자만 아님 · 우리가 얹은 한글 글 상자·남긴 영문 상자와 30% 넘게 겹치지 않음(OCR 이 한글을 한자로 잘못 읽는 것)
export function realChinese(boxes = [], ours = []) {
  const ov = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w <= 0 || h <= 0 ? 0 : (w * h) / Math.max(1, a.w * a.h); };
  return boxes.filter((b) => /[一-鿿]{2,}/.test(String(b.text || "")) && !/[가-힣]/.test(String(b.text || "")) && !ours.some((o) => ov(b, o) > 0.3));
}

/**
 * m: { overlaps:[[a,b]], overflow:[t], roleDev:{pct,a,b}, colDev:{px,a,b}, low:[{text,median,need,shadow}],
 *      residue:[why], chinese:[text], literal:[text], emptyDeco:[why], ai:{ ok, issues:[{kind,what}] } | null }
 * 잔상 검사는 오탐이 있어(밑줄·배지 테두리) AI 비전이 같은 장에서 얼룩을 보지 못했으면 넘어간다. AI 를 못 돌렸으면(ai=null) 그대로 문제.
 */
export function judgeSection(m = {}, lim = LIMITS) {
  const out = [];
  for (const [a, b] of m.overlaps || []) out.push({ kind: "overlap", why: `글 겹침 "${short(a)}" · "${short(b)}"`, fix: "layout", texts: [a, b] });
  for (const t of m.overflow || []) out.push({ kind: "overflow", why: `도형 밖으로 넘침 "${short(t)}"`, fix: "layout", texts: [t] });
  if ((m.roleDev?.pct || 0) > lim.roleDev) out.push({ kind: "roleDev", why: `같은 역할 글 크기 ${m.roleDev.pct}% 차이`, fix: "layout", texts: [m.roleDev.a, m.roleDev.b].filter(Boolean) });
  if ((m.colDev?.px || 0) > lim.colDev) out.push({ kind: "colDev", why: `줄 왼쪽 끝 ${m.colDev.px}px 어긋남`, fix: "layout", texts: [m.colDev.a, m.colDev.b].filter(Boolean) });
  // 대비: 알약·배지처럼 글 상자 자체 바탕(원본 디자인 색 — 주황 알약 흰 글 2.2:1 등)은 1.8:1 까지 원본 색 유지, 그림자·테두리 글은 2:1 까지 봐준다
  for (const l of m.low || []) { const bad = l.own ? l.median < 1.8 : l.shadow ? l.median < Math.min(2, l.need * 0.6) : l.median < l.need; if (bad) out.push({ kind: "contrast", why: `잘 안 보임 "${short(l.text)}" ${l.median}:1`, fix: "ink", texts: [l.text] }); }
  const aiSaw = (k) => (m.ai?.issues || []).some((x) => x.kind === k);
  if ((m.residue || []).length && (!m.ai || aiSaw("residue"))) out.push({ kind: "residue", why: `지운 자리 얼룩 ${m.residue.length}곳`, fix: "erase" });
  for (const t of m.chinese || []) out.push({ kind: "chinese", why: `중국어 남음 "${short(t, 8)}"`, fix: "erase", texts: [t] });
  for (const t of m.literal || []) out.push({ kind: "literal", why: `어색한 번역 "${short(t)}"`, fix: "rewrite", texts: [t] });
  for (const w of m.emptyDeco || []) out.push({ kind: "emptyDeco", why: `빈 장식 ${w}`, fix: null });
  for (const x of m.ai?.issues || []) {
    if (x.kind === "residue" && (m.residue || []).length) continue; // 위 잔상과 같은 것
    const dup = out.some((o) => (AI_FIX[x.kind] === "layout" && o.fix === "layout") || (x.kind === "translation" && o.kind === "literal"));
    if (dup) continue;
    out.push({ kind: "ai", ai: x.kind, why: `${AI_KO[x.kind] || "AI 지적"}${x.text ? ` "${short(x.text)}"` : ""} · ${short(x.what, 20)}`, fix: AI_FIX[x.kind] ?? null, texts: x.text ? [x.text] : [] });
  }
  return out;
}

// 레이어 원래 글자 크기(원본 px)
const osz = (l) => Number(l?.style?.size ?? l?.style?.fontSizePx) || (Number(l?.h) || 0) * 0.78;
// 글 → 레이어: 화면 글(줄바꿈·강조 포함)이 레이어 문구와 같거나, 한쪽이 다른 쪽 앞부분(잘린 인용 "…")일 때만 — 짧은 줄이 긴 인용 속에 우연히 든 것은 아님
const findLayers = (sec, texts) => { const ks = (texts || []).map((t) => norm(t).replace(/[….]+$/, "")).filter(Boolean); return (sec.layers || []).filter((l) => !l.drop && ks.some((k) => { const n = norm(l.ko); return n && (n === k || (k.length >= 2 && (n.startsWith(k) || (k.startsWith(n) && n.length >= k.length * 0.6)))); })); };

/**
 * 한 장(section)의 plan 을 문제에 맞게 고친다(제자리 수정). tries = 이 장의 지금까지 고친 회차(0부터).
 * 반환 [고친 것 설명] — 빈 배열이면 plan 으로 고칠 수 있는 것이 없음
 *  · 같은 역할 크기 다름 → 같은 역할·원래 크기 ±25% 줄을 가장 작은 크기로
 *  · 열 안 맞음 → 가로로 겹치고 왼쪽 끝이 가까운 왼쪽 정렬 줄을 같은 x 로
 *  · 겹침·넘침 → 걸린 줄 15%(두 번째는 25%) 줄이기 + 같은 역할 크기 맞춤
 *  · 대비 → 글자 테두리(st.outline) — 밝은 글은 어두운 테두리, 어두운 글은 밝은 테두리
 */
export function fixPlan(sec, issues = [], tries = 0) {
  const done = [];
  if (!sec || !Array.isArray(sec.layers)) return done;
  const live = sec.layers.filter((l) => !l.drop && String(l.ko || "").trim());
  const layout = issues.filter((x) => x.fix === "layout");
  if (layout.length) {
    // 줄이기: 겹침·넘침에 걸린 줄
    const f = tries ? 0.75 : 0.85;
    const hit = new Set(); for (const x of layout.filter((x) => ["overlap", "overflow", "ai"].includes(x.kind))) for (const l of findLayers(sec, x.texts)) hit.add(l);
    for (const l of hit) { const s = osz(l); if (!s) continue; l.style = { ...(l.style || {}), size: Math.max(8, Math.round(s * f * 10) / 10) }; l.qaFit = (l.qaFit || 0) + 1; }
    if (hit.size) done.push(`${hit.size}줄 ${Math.round((1 - f) * 100)}% 줄임`);
    // 같은 역할 크기 맞춤: 같은 역할·원래 글 상자 높이 ±12%(화면 측정과 같은 묶음) 줄은 가장 작은 크기로
    const byRole = {}; for (const l of live) if (!Number(l.style?.rotate) && !l.shape) (byRole[l.role || "text"] ||= []).push(l);
    let unified = 0;
    for (const g of Object.values(byRole)) {
      // 이웃끼리 높이 ±12% 면 한 묶음(이어지는 사슬도 한 묶음 — 37·41·42px 줄은 모두 같은 라벨)
      const s = [...g].sort((a, b) => (Number(a.h) || 0) - (Number(b.h) || 0));
      for (let i = 0; i < s.length;) { let j = i + 1; while (j < s.length && (Number(s[j].h) || 0) <= (Number(s[j - 1].h) || 0) * 1.12) j++; const run = s.slice(i, j); if (run.length > 1) { const v = Math.min(...run.map(osz)); for (const l of run) if (Math.abs(osz(l) - v) > 0.05) { l.style = { ...(l.style || {}), size: v }; unified++; } } i = j; }
    }
    if (unified) done.push(`같은 역할 ${unified}줄 크기 맞춤`);
    // 열 맞춤: 실제로 왼쪽 정렬로 그려지는 줄(템플릿 규칙: 정렬 없으면 제목·캡션·알약·배지는 가운데) 중 가로 50% 넘게 겹치고 왼쪽 끝 차이 ≤ 30px(원본)
    //  → 같은 x, 폭은 묶음 오른쪽 끝까지(템플릿이 넘친 줄만 왼쪽으로 넓혀 다시 어긋나지 않게)
    const effLeft = (l) => (l.style?.align || (["caption", "title", "pill", "badge"].includes(l.role) ? "center" : "left")) === "left";
    const lefts = live.filter((l) => effLeft(l) && !l.shape && !Number(l.style?.rotate)).sort((a, b) => a.x - b.x);
    let snapped = 0; const seen = new Set();
    for (const a of lefts) {
      if (seen.has(a)) continue;
      const g = [a]; for (const b of lefts) { if (b === a || seen.has(b)) continue; const ov = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); if (ov >= Math.min(a.w, b.w) * 0.5 && b.x - a.x <= 30) g.push(b); }
      if (g.length < 2) continue;
      const x0 = Math.min(...g.map((l) => l.x)), x1 = Math.max(...g.map((l) => l.x + l.w));
      for (const l of g) { seen.add(l); if (l.x !== x0 || l.x + l.w !== x1) { l.x = x0; l.w = x1 - x0; snapped++; } }
    }
    if (snapped) done.push(`${snapped}줄 왼쪽 끝 맞춤`);
  }
  for (const x of issues.filter((x) => x.fix === "ink")) for (const l of findLayers(sec, x.texts)) {
    const c = /^#?([0-9a-f]{6})$/i.exec(String(l.style?.color || "")); const v = c ? parseInt(c[1], 16) : 0x222222; const lum = (0.299 * (v >> 16 & 255) + 0.587 * (v >> 8 & 255) + 0.114 * (v & 255)) / 255;
    l.style = { ...(l.style || {}), outline: lum > 0.5 ? "rgba(0,0,0,.7)" : "rgba(255,255,255,.9)" }; done.push(`"${short(l.ko, 8)}" 테두리`);
  }
  return done;
}

// 다시 쓸 줄: 직역·AI 번역 지적에 걸린 레이어
export function rewriteTargets(sec, issues = []) {
  const ts = issues.filter((x) => x.fix === "rewrite").flatMap((x) => x.texts || []);
  const ls = ts.length ? findLayers(sec, ts) : []; // 어느 글인지 모르면 다시 쓰지 않는다(⚠ 로 남김)
  return [...new Set(ls)];
}

// 장별 결과 → 화면에 보일 한 줄(가장 중요한 문제 하나)
const ORDER = ["chinese", "overflow", "overlap", "residue", "emptyDeco", "contrast", "literal", "roleDev", "colDev", "ai"];
export function headline(issues = []) { const s = [...issues].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)); return s[0]?.why || ""; }

// 전체 요약
export function summarize(sections = {}) {
  const v = Object.values(sections);
  return { checked: v.length, flagged: v.filter((x) => !x.pass).length, fixed: v.filter((x) => x.pass && x.fixed).length };
}
