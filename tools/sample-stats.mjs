// 📊 무작위 표본(kw-judge --all --sample=N) 판별 결과로 전체 비율·등급별 개수를 추정하고, "한 번에 몇 개 × 하루 몇 번"이 며칠 버티는지 계산
// 실행: node --no-warnings tools/sample-stats.mjs [표본=700]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan } from "../src/main/kw-combo.js";

const SAMPLE = Number(process.argv[2]) || 700;
const r = await scan({ full: true, aiJudge: false }); // AI 판정 전 후보 전체(규칙 필터·계절 제외까지)
const J = JSON.parse(fs.readFileSync(path.join(os.homedir(), "sellar-data", `kw_judge_${r.month}.json`), "utf8"));
const keys = JSON.parse(fs.readFileSync(path.join(os.homedir(), "sellar-data", `kw_sample_${r.month}.json`), "utf8")); // kw-judge가 남긴 표본 목록
const byKw = new Map(r.all.map((k) => [k.kw, k]));
const smp = keys.slice(0, SAMPLE).map((kw) => byKw.get(kw)).filter((k) => k && J[k.kw]);
const N = r.all.length, n = smp.length;
const share = (f) => smp.filter(f).length / n;
const ci = (p) => 1.96 * Math.sqrt((p * (1 - p)) / n); // 95% 오차 범위
const row = (label, f) => { const p = share(f); return { label, pct: (p * 100).toFixed(1), err: (ci(p) * 100).toFixed(1), est: Math.round(p * N) }; };
const ok = (k) => J[k.kw].v === "ok", easy = (k) => J[k.kw].easy === true;
const good = (k) => ok(k) && easy(k) && k.m1 >= 3000 && k.mx <= 1000;
const rows = [
  row("AI 통과", ok), row("확인 필요(보류)", (k) => J[k.kw].v === "hold"), row("AI 제외", (k) => J[k.kw].v === "no"),
  row("통과 + 이름만 들어도 아는 상품", (k) => ok(k) && easy(k)),
  row("좋은 키워드(통과·쉬움·월검색 3천↑·1등 리뷰 1,000↓)", good),
  row("  └ 상급(월검색 1만↑·1등 리뷰 300↓)", (k) => good(k) && k.m1 >= 10000 && k.mx <= 300),
];
console.log(`[${r.month}] 후보 전체 ${N.toLocaleString()}개 · 판별된 표본 ${n}개`);
for (const x of rows) console.log(`  ${x.label}: ${x.pct}% (±${x.err}) → 전체 약 ${x.est.toLocaleString()}개`);

// 며칠 버티나: ① 수강생 한 명 혼자 ② 200명이 같은 풀을 나눠 쓰고 한 키워드 최대 3명
const G = rows[4].est, OKE = rows[3].est;
const plans = [[10, 5], [20, 5], [10, 3], [20, 3]];
console.log(`\n좋은 키워드 ${G.toLocaleString()}개 · 통과+쉬움 ${OKE.toLocaleString()}개 기준 (매일 다 쓴다고 가정)`);
for (const [per, times] of plans) {
  const day = per * times;
  const solo = (G / day).toFixed(1), cohort = ((G * 3) / 200 / day).toFixed(1), cohortAll = ((OKE * 3) / 200 / day).toFixed(1);
  console.log(`  ${per}개 × 하루 ${times}번(하루 ${day}개): 혼자 ${solo}일 · 200명·키워드당 3명 → 좋은 것만 ${cohort}일 / 통과+쉬움까지 ${cohortAll}일`);
}
console.log(`\n표본 예시(좋은 키워드): ${smp.filter(good).slice(0, 15).map((k) => `${k.kw}(${J[k.kw].desc})`).join(" · ")}`);
console.log(`표본 예시(AI 제외 이유 상위): ${Object.entries(smp.filter((k) => J[k.kw].v === "no").reduce((m, k) => ((m[J[k.kw].reason] = (m[J[k.kw].reason] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, c]) => `${w} ${c}`).join(" · ")}`);
