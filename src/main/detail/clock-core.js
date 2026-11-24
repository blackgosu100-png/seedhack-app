// ⏱ 스톱워치 — 버튼을 누른 순간부터 완성까지 실제로 걸린 시간을 단계별로 잰다(순수 함수, 전자 없음).
//  진행 이벤트가 올 때마다 "앞 이벤트 ~ 지금"을 앞 이벤트의 칸에 더한다 → 빈틈·겹침 없이 전체 시간이 나뉜다.
//  사람이 기획안을 보느라 멈춘 시간(wait)은 전체에서 뺀다.
export const CLOCK_ROWS = [
  ["read", "상품 화면 읽기", ["read"]],
  ["fetch", "사진 받기 · 글자 찾기", ["extract", "download", "ocr", "clean"]],
  ["plan", "사진 살피기 · 기획안", ["vision", "cutout", "translate", "brief"]],
  ["copy", "문구 쓰기", ["copy", "plan", "review"]],
  ["scene", "장면 사진 만들기", ["scene"]],
  ["localize", "한글화 준비 (글자 지우기)", ["localize"]],
  ["bake", "한글화 그리기 (이미지 AI)", ["bake"]],
  ["render", "조립 · 저장", ["render", "qa", "done"]],
];

export const newClock = (now, readMs = 0) => ({ v: 1, startedAt: now - Math.max(0, readMs), parts: readMs > 0 ? { read: Math.round(readMs) } : {}, key: null, last: now, waitMs: 0, open: true });

// 이벤트 → 칸 이름: extra.clk 가 있으면 그것, 한글화 뒤 작업(bg:"localize")은 localize, 그 밖은 단계 이름
export const clockKey = (step, extra) => (extra && extra.clk) || (extra && extra.bg === "localize" ? "localize" : step);

export function clockTick(c, key, now) {
  if (!c) return c;
  if (c.key) c.parts[c.key] = (c.parts[c.key] || 0) + Math.max(0, now - c.last);
  c.key = key || null; c.last = now;
  return c;
}
// 멈춤(기획안 확인 화면·완료): 지금까지를 닫는다
export const clockStop = (c, now) => clockTick(c, null, now);
// 이어 달리기(확인 화면에서 [생성하기]): 멈춰 있던 시간은 사람 시간으로 따로 둔다
export function clockResume(c, now) { if (!c) return c; c.waitMs = (c.waitMs || 0) + Math.max(0, now - (c.last || now)); c.key = null; c.last = now; return c; }

export function clockSummary(c) {
  if (!c || !c.parts) return null;
  const used = new Set();
  const rows = CLOCK_ROWS.map(([id, label, keys]) => { let ms = 0; for (const k of keys) { if (c.parts[k]) ms += c.parts[k]; used.add(k); } return { id, label, ms }; });
  const rest = Object.entries(c.parts).filter(([k]) => !used.has(k) && k !== "fail").reduce((n, [, v]) => n + v, 0);
  if (rest > 0) rows[rows.length - 1].ms += rest;
  const totalMs = rows.reduce((n, r) => n + r.ms, 0);
  if (!totalMs) return null;
  const top = Math.max(...rows.map((r) => r.ms));
  return { totalMs, waitMs: c.waitMs || 0, startedAt: c.startedAt || null, rows: rows.filter((r) => r.ms >= 1000).map((r) => ({ ...r, pct: Math.round((r.ms / totalMs) * 100), bar: Math.round((r.ms / top) * 100) })) };
}

export function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}분 ${r}초` : `${m}분`;
}
