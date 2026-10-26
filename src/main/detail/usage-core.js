// 이미지 생성 사용량 — 성공한 장만 날짜별로 쌓고(store "imageUsage"), 화면용 요약(오늘·이번 달·예상 비용)을 만든다. 순수 함수(usage-core.test.js).
// 비용은 응답의 토큰 수 × 공개 단가로 낸 "예상"이다. 실제 청구는 Google(AI Studio·Cloud 결제)·OpenAI 콘솔이 기준.
// 단가: USD / 100만 토큰 [입력, 출력]. 모르는 모델은 1장 $0.039(2.5 flash image 1장 값)로 셈.
export const PRICES = [
  [/^gemini-3(\.\d+)?-pro-image/, [2, 120]],
  [/^gemini-3(\.\d+)?-flash-lite-image/, [0.25, 30]],
  [/^gemini-3(\.\d+)?-flash-image/, [0.5, 60]],
  [/^gemini-2\.5-flash-image/, [0.3, 30]],
  [/^gemini-2\.0-flash.*image/, [0.1, 30]],
  [/^gpt-image-1-mini/, [2.5, 8]],
  [/^gpt-image-1/, [10, 40]],
];
export const FALLBACK_USD_PER_IMAGE = 0.039;
export const KRW_PER_USD = 1400;
const KEEP_DAYS = 120;

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// 한 장 값(USD). ev: { model, inTok?, outTok? }
export function costOf({ model = "", inTok = 0, outTok = 0 } = {}) {
  const p = PRICES.find(([re]) => re.test(model))?.[1];
  if (!p || !outTok) return FALLBACK_USD_PER_IMAGE; // 토큰 수를 못 받으면 1장 기본값
  return (inTok * p[0] + outTok * p[1]) / 1e6;
}

// state(이전 기록) + ev(한 장) → 새 state. ev: { provider, model, inTok, outTok }
export function addUsage(state, ev = {}, now = Date.now()) {
  const days = { ...(state?.days || {}) };
  const k = dayKey(now);
  const d = { n: 0, usd: 0, models: {}, ...(days[k] || {}) };
  const model = String(ev.model || "?").slice(0, 60);
  d.n += 1;
  d.usd = Math.round((d.usd + costOf(ev)) * 1e5) / 1e5;
  d.models = { ...d.models, [model]: (d.models[model] || 0) + 1 };
  days[k] = d;
  const cut = dayKey(now - KEEP_DAYS * 864e5);
  for (const key of Object.keys(days)) if (key < cut) delete days[key];
  return { days, provider: ev.provider || state?.provider || "" };
}

// 화면용 요약: 오늘·이번 달 장수·예상 비용, 최근 7일, 이번 달 모델별
export function summarize(state, now = Date.now()) {
  const days = state?.days || {};
  const today = dayKey(now), month = today.slice(0, 7);
  const sum = (keys) => keys.reduce((a, k) => ({ n: a.n + (days[k]?.n || 0), usd: a.usd + (days[k]?.usd || 0) }), { n: 0, usd: 0 });
  const monthKeys = Object.keys(days).filter((k) => k.startsWith(month));
  const models = {};
  for (const k of monthKeys) for (const [m, n] of Object.entries(days[k].models || {})) models[m] = (models[m] || 0) + n;
  const week = Array.from({ length: 7 }, (_, i) => { const k = dayKey(now - (6 - i) * 864e5); return { day: k, n: days[k]?.n || 0, usd: days[k]?.usd || 0 }; });
  const t = sum([today]), m = sum(monthKeys), all = sum(Object.keys(days));
  const won = (usd) => Math.round(usd * KRW_PER_USD);
  return { today: { ...t, krw: won(t.usd) }, month: { ...m, krw: won(m.usd) }, all: { ...all, krw: won(all.usd) }, week, models, provider: state?.provider || "", krwPerUsd: KRW_PER_USD };
}
