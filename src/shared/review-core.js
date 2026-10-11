// 📝 쿠팡 리뷰 분석 — 날짜별 리뷰 수로 "리뷰 작업(가구매) 의심 구간"을 찾고, 그 구간과 이후(실제 고객) 리뷰를 비교한다.
// 순수 함수(네트워크·파일 없음). 판정(GO/DROP)은 내지 않고 "의심 신호"만 보여 준다 — 참고 지표.
// 수집은 최신순 최대 1,500개(셀라리뷰와 같은 한도). 한도에 걸리면 가장 오래된 날짜 이전은 못 보므로 그 근처 급증은 판단에서 뺀다.

export const REVIEW_CAP = 1500;
const DAY = 86400000;

const kstDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
export function toDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    return kstDate(n < 1e12 ? n * 1000 : n);
  }
  const m = String(v).match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}
const dayNum = (d) => Math.round(Date.parse(d + "T00:00:00Z") / DAY);
const numDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const md = (d) => (!d ? "" : d.slice(0, 4) !== String(new Date().getFullYear()) ? `${d.slice(2, 4)}.${+d.slice(5, 7)}.${+d.slice(8, 10)}` : `${+d.slice(5, 7)}/${+d.slice(8, 10)}`); // 올해가 아니면 연도

const EXP_RE = /체험단|제공\s*받아|무상으로\s*제공|협찬|원고료/;
const clean = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// 수집기가 넘긴 리뷰를 한 모양으로 — { id, date, rating, text, photos, opt, exp }
export function normalizeReviews(list) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const date = toDate(r.date ?? r.at);
    let rating = Number(r.rating);
    if (rating > 5) rating = Math.round(rating / 20); // 100점 만점으로 오는 경우
    if (!date || !(rating >= 1 && rating <= 5)) continue;
    const text = clean(r.text);
    // 같은 날 똑같은 빈 5점 리뷰는 흔하므로 리뷰 번호가 있을 때만 중복을 지운다
    const key = r.id ? String(r.id) : `n${out.length}`;
    if (r.id && seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, date, rating, text, photos: Math.max(0, Number(r.photos) || 0), opt: clean(r.opt).slice(0, 120), exp: !!r.exp || EXP_RE.test(text) });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 최신순
}

// 글자 3개 묶음 유사도(같은 원고를 조금씩 바꾼 리뷰 찾기)
const grams = (s) => {
  const t = s.replace(/[^가-힣a-zA-Z0-9]/g, "");
  const g = new Set();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  return g;
};
function similarity(texts) {
  const gs = texts.filter((t) => t.length >= 20).slice(0, 150).map(grams).filter((g) => g.size >= 8);
  if (gs.length < 4) return null;
  let sum = 0;
  for (let i = 0; i < gs.length; i++) {
    let best = 0;
    for (let j = 0; j < gs.length; j++) {
      if (i === j) continue;
      let inter = 0;
      const [a, b] = gs[i].size < gs[j].size ? [gs[i], gs[j]] : [gs[j], gs[i]];
      for (const x of a) if (b.has(x)) inter++;
      const s = inter / (a.size + b.size - inter);
      if (s > best) best = s;
    }
    sum += best;
  }
  return sum / gs.length;
}

function stats(rs, days) {
  const n = rs.length;
  const withText = rs.filter((r) => r.text.length >= 5);
  const ratio = (f) => (n ? rs.filter(f).length / n : null);
  return {
    n, days, perDay: days > 0 ? n / days : null,
    r5: ratio((r) => r.rating === 5),
    low: ratio((r) => r.rating <= 3),
    empty: ratio((r) => r.text.length < 5),
    long: ratio((r) => r.text.length >= 100),
    photo: ratio((r) => r.photos > 0),
    exp: ratio((r) => r.exp),
    avgLen: withText.length ? withText.reduce((s, r) => s + r.text.length, 0) / withText.length : null,
    sim: similarity(withText.map((r) => r.text)),
  };
}

// 급증 구간: 7일 합이 이전 4주(직전 1주 제외) 하루 평균의 4배+ 이고 7일 10개 이상인 날들의 창을 합친다
// 시작을 찾으면 7일 평균이 "시작 전 기준의 4배" 아래로 내려가거나 정점의 35% 아래로 떨어질 때까지 이어 본다.
// 이미 찾은 급증 구간은 이후 "평소 기준"에서 뺀다(1차 작업이 기준을 끌어올려 2차 작업을 놓치지 않게).
// 2주 안에 다시 몰리면 한 구간으로 합친다.
function findBursts(counts, start, guard) {
  const s7 = (i) => { let s = 0; for (let k = Math.max(0, i - 6); k <= i; k++) s += counts[k]; return s; };
  const used = new Array(counts.length).fill(false);
  const regions = [];
  for (let i = Math.max(6, guard); i < counts.length; i++) { // 한도에 걸렸으면 잘린 지점 근처는 비교 기준이 없다
    if (s7(i) < 10) continue;
    let base = 0, bn = 0;
    for (let k = Math.max(0, i - 35); k <= i - 8; k++) if (!used[k]) { base += counts[k]; bn++; }
    const th = Math.max(1, 4 * (bn ? base / bn : 0) + 0.5);
    if (s7(i) / 7 < th) continue;
    let j = i, peak = s7(i) / 7;
    while (j + 1 < counts.length) {
      const v = s7(j + 1) / 7;
      if (v < th || v < peak * 0.35) break;
      j++;
      if (v > peak) peak = v;
    }
    // 7일 창은 늦게 따라오므로 양 끝을 3일 평균으로 다듬는다
    const c3 = (k) => ((counts[k - 1] || 0) + counts[k] + (counts[k + 1] || 0)) / 3;
    const cut = Math.max(th, peak * 0.35);
    let a = i - 6, z = j;
    while (a < z && (!counts[a] || c3(a) < cut)) a++;
    while (z > a && (!counts[z] || c3(z) < cut)) z--;
    for (let k = a; k <= z; k++) used[k] = true;
    const prev = regions[regions.length - 1];
    if (prev && a - prev.z <= 14) prev.z = z;
    else regions.push({ a, z });
    i = j + 6; // 끝난 뒤 한 주는 기준이 섞이므로 건너뜀
  }
  return regions
    .map((r) => ({ from: numDay(start + r.a), to: numDay(start + r.z), n: counts.slice(r.a, r.z + 1).reduce((s, c) => s + c, 0) }))
    .filter((r) => r.n >= 15);
}

const pct = (v) => (v == null ? "-" : `${Math.round(v * 100)}%`);
const f1 = (v) => (v == null ? "-" : v >= 10 ? Math.round(v).toString() : v.toFixed(1));

// reviews: normalizeReviews 결과(또는 원본) · total: 쿠팡이 알려 준 전체 리뷰 수 · today: 'YYYY-MM-DD'(시험용)
export function analyzeReviews({ reviews, total = null, cap = REVIEW_CAP, today = kstDate(Date.now()) }) {
  // partial: 1,500개 너머에서 별점별·베스트 순으로 일부만 찾은 리뷰 — 날짜 흐름이 치우치므로 차트·비교엔 안 넣고 "가장 오래된 리뷰"만 쓴다
  const part = normalizeReviews((reviews || []).filter((r) => r && r.partial));
  const rs = normalizeReviews((reviews || []).filter((r) => r && !r.partial));
  if (!rs.length) return { ok: false, error: "리뷰가 없습니다", total };
  const firstDate = rs[rs.length - 1].date, lastDate = rs[0].date;
  // 전체 수를 알면 그것과 비교(더 받기로 전부 받으면 한도 아님), 모르면 받은 수가 한도에 닿았는지로
  const capped = total != null ? total > rs.length * 1.02 + 2 : rs.length >= cap * 0.98;
  const start = dayNum(firstDate), end = Math.max(dayNum(today), dayNum(lastDate));
  const counts = new Array(end - start + 1).fill(0);
  rs.forEach((r) => counts[dayNum(r.date) - start]++);
  const guard = capped ? 35 : 0;

  const bursts = findBursts(counts, start, guard);
  const main = bursts.slice().sort((a, b) => b.n - a.n)[0] || null;

  const inRange = (r, a, z) => r.date >= a && r.date <= z;
  const span = (a, z) => (a && z && z >= a ? dayNum(z) - dayNum(a) + 1 : 0);
  let seg;
  if (main) {
    const pre = rs.filter((r) => r.date < main.from), mid = rs.filter((r) => inRange(r, main.from, main.to)), post = rs.filter((r) => r.date > main.to);
    seg = {
      pre: stats(pre, span(firstDate, numDay(dayNum(main.from) - 1))),
      burst: stats(mid, span(main.from, main.to)),
      post: stats(post, span(numDay(dayNum(main.to) + 1), numDay(end))),
    };
  } else seg = { all: stats(rs, end - start + 1) };

  const lowAll = rs.filter((r) => r.rating <= 3);
  const firstLow = lowAll.length ? lowAll[lowAll.length - 1].date : null;
  const last30 = rs.filter((r) => dayNum(r.date) > end - 30 && !(main && inRange(r, main.from, main.to)));
  const last30Days = Math.min(30, end - Math.max(start, main && dayNum(main.to) > end - 30 ? dayNum(main.to) + 1 : start) + 1);

  // 의심 신호 — 판정이 아니라 체크리스트
  const signals = [];
  if (main) {
    const b = seg.burst, p = seg.post, pr = seg.pre;
    signals.push({ key: "burst", on: true, text: `${md(main.from)}~${md(main.to)} ${b.days}일 동안 리뷰 ${main.n}개(받은 리뷰의 ${pct(main.n / rs.length)}) — 그전 하루 ${f1(pr.perDay ?? 0)}개 → 이 기간 하루 ${f1(b.perDay)}개` });
    signals.push({ key: "r5", chip: `5점 ${pct(b.r5)}`, on: b.r5 >= 0.9 && (p.n < 10 || p.r5 <= b.r5 - 0.1), text: `이 기간 5점 ${pct(b.r5)}${p.n >= 10 ? ` · 이후 ${pct(p.r5)}` : ""}` });
    signals.push({ key: "low", chip: `1~3점 ${pct(b.low)}`, on: b.low <= 0.05 && p.n >= 10 && p.low >= Math.max(0.08, b.low * 3), text: `1~3점 이 기간 ${pct(b.low)}${p.n >= 10 ? ` · 이후 ${pct(p.low)}` : ""}${firstLow ? ` · 첫 1~3점 ${md(firstLow)}` : ""}` });
    // 실제 세척기 데이터: 작업 구간은 100자+ 긴 글 57%, 이후 실제 고객은 17%(빈 리뷰 75%) — 빈 리뷰가 아니라 긴 글이 신호
    signals.push({ key: "long", chip: `긴 리뷰 ${pct(b.long)}`, on: b.long >= 0.35 && (p.n < 10 || b.long >= p.long + 0.2), text: `100자 넘는 긴 리뷰 이 기간 ${pct(b.long)}${p.n >= 10 ? ` · 이후 ${pct(p.long)}` : ""} (판매자가 다듬은 원고일수록 높음)` });
    signals.push({ key: "sim", chip: "비슷한 글 반복", on: b.sim != null && b.sim >= 0.22 && (p.sim == null || b.sim >= p.sim + 0.07), text: `글 비슷한 정도 이 기간 ${b.sim == null ? "-" : b.sim.toFixed(2)}${p.sim != null ? ` · 이후 ${p.sim.toFixed(2)}` : ""} (같은 원고를 고쳐 쓴 글일수록 높음)` });
    signals.push({ key: "exp", chip: `체험단 ${pct(b.exp)}`, on: b.exp >= 0.2, text: `체험단·제공 표기 이 기간 ${pct(b.exp)}` });
  }
  const notes = [];
  if (capped) notes.push(`최신 ${rs.length.toLocaleString("ko-KR")}개만 받았습니다${total ? `(전체 ${Number(total).toLocaleString("ko-KR")}개)` : ""} — ${md(firstDate)} 이전은 보이지 않고, 이 날짜 근처 5주는 급증 판단에서 뺐습니다.`);
  if (!main) notes.push(capped ? "받은 기간 안에서는 갑자기 몰린 구간이 없습니다 — 꾸준히 팔리는 모양." : "갑자기 몰린 구간이 없습니다.");

  const optCount = {};
  rs.forEach((r) => { if (r.opt) optCount[r.opt] = (optCount[r.opt] || 0) + 1; });
  const options = Object.entries(optCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n, share: n / rs.length }));
  const lowSamples = lowAll.filter((r) => r.text.length >= 8).slice(0, 6).map((r) => ({ date: r.date, rating: r.rating, text: r.text.slice(0, 220), opt: r.opt }));

  return {
    ok: true, total, got: rs.length, older: part.length ? { n: part.length, oldest: part[part.length - 1].date } : null, capped, firstDate, lastDate, today: numDay(end),
    daily: counts.map((c, i) => [numDay(start + i), c]).filter(([, c], i, a) => c || i === a.length - 1 || i === 0),
    bursts, burst: main, seg, firstLow,
    recent: { days: Math.max(1, last30Days), n: last30.length, perDay: last30.length / Math.max(1, last30Days) },
    signals, suspect: signals.filter((s) => s.on && s.key !== "burst").length, notes, options, lowSamples,
  };
}
