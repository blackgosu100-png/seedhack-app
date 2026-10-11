// 🧪 약식 가상 초보 테스트 — 실제로 뽑힌 20개 묶음(수강생 2명분)을 가상 초보 3명에게 보여 주고 반응을 받는다 + 허점 찾기 1명.
// 구독(Claude CLI)으로만 돈다. 결과는 tools/out/persona-YYYYMMDD-HHMM.json, 화면에는 요약과 참고 비용.
// 실행: node --no-warnings tools/persona-test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/main/kw-combo.js";
import { runStructured } from "../src/main/detail/cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let spent = 0;
const run = async (o) => { const t = Date.now(); const r = await runStructured({ timeoutMs: 400000, ...o }); spent += r.costUsd || 0; return { ...r, sec: Math.round((Date.now() - t) / 1000) }; };

// ── 1) 수강생 2명분 20개 묶음(사람마다 다른 순서) — 바로 시작 8 · 경쟁 약한 6 · 요즘 뜨는 6, AI 통과만 ──
const r = await scan({ limit: 150 });
const seeded = (seed) => { let x = seed; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); };
function bundle(seed) {
  const rnd = seeded(seed), used = new Set((r.top3 || []).map((k) => k.kw)), out = [];
  const take = (g, n) => {
    const pool = r.groups[g].items.filter((k) => k.ai?.v === "ok" && !used.has(k.kw)).slice(0, 40);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const k of pool.slice(0, n)) { used.add(k.kw); out.push({ ...k, group: g }); }
  };
  take("start", 7); take("weak", 5); take("rising", 5); // 위에 "AI가 고른 3개" + 아래 17개 = 화면과 같은 20개
  return out;
}
const A = bundle(11), B = bundle(97);
const overlap = A.filter((k) => B.some((x) => x.kw === k.kw)).map((k) => k.kw);
const G = { start: "바로 시작하기 좋은", weak: "경쟁이 약한", rising: "요즘 뜨는" };
const PT = { "무인증": "인증 없이 판매 가능", "1688 흔함": "중국에서 쉽게 구함", "1688흔함": "중국에서 쉽게 구함", "소형": "작고 가벼움", "완제품": "그대로 팔면 됨" };
const line = (k, i) => `${i + 1}. ${k.kw} — ${k.ai?.desc || String(k.cat).split(">").slice(-2).join(">")} | 월검색 ${k.m1} | 1등 상품 리뷰 ${k.mx}개(적을수록 들어가기 쉬움) | 평균 ${Math.round(k.price)}원 | ${(k.ai?.tags || []).map((t) => PT[t] || t).join(", ")}`;
const show = (b) => `[AI가 고른 3개]\n${(r.top3 || []).map(line).join("\n")}\n\n[다른 후보 17개 — 펼쳐야 보임]\n${b.map(line).join("\n")}`;
console.log(`묶음 A ${A.length}개 · 묶음 B ${B.length}개 · 겹침 ${overlap.length}개${overlap.length ? ` (${overlap.join(", ")})` : ""}`);

// ── 2) 가상 초보 3명 ──
const PERSONAS = [
  { id: "직장인", model: "sonnet", who: "42세 회사원. 퇴근 후 하루 2시간 부업을 하고 싶다. 온라인 판매는 처음이고 쿠팡은 소비자로만 써 봤다. 첫 사입 예산 100만원. 손해 볼까 봐 겁이 많다." },
  { id: "육아맘", model: "sonnet", who: "34세 육아 중인 엄마. 아이 재우고 집에서 할 일을 찾는다. 예산 50만원. 예쁘고 생활에 쓰는 물건에 관심이 많고, 어려운 용어나 공구·부품 같은 건 잘 모른다." },
  { id: "은퇴준비", model: "haiku", who: "56세 자영업자. 은퇴 후 소득원을 준비한다. 예산 300만원까지 가능. 꼼꼼하고 의심이 많다. 숫자 근거가 없으면 안 믿는다." },
];
const P_SYSTEM = `너는 온라인 판매를 처음 해 보려는 초보 수강생이다. 250만원짜리 4주 쿠팡 판매 강의를 들으며, 강의 프로그램이 "AI가 찾은 내 키워드 20개"를 보여 줬다.
아래 사람이 되어 솔직하게 반응하라. 예의상 칭찬하지 말고, 진짜로 해 볼 마음이 드는지·실망스러운지 그대로 말하라. 각 키워드가 무슨 상품인지 모르면 모른다고 하라.`;
const P_SCHEMA = { type: "object", additionalProperties: false, required: ["first_reaction", "picks", "worst", "unknown", "count_feel", "count_why", "trust", "confusing", "wish"],
  properties: {
    first_reaction: { type: "string", description: "목록을 처음 봤을 때 한두 문장 솔직한 반응" },
    picks: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["kw", "why"], properties: { kw: { type: "string" }, why: { type: "string" } } }, description: "진짜 해 보고 싶은 3개" },
    worst: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["kw", "why"], properties: { kw: { type: "string" }, why: { type: "string" } } }, description: "실망스럽거나 절대 안 할 3개" },
    unknown: { type: "array", items: { type: "string" }, description: "무슨 상품인지 모르겠는 키워드" },
    count_feel: { type: "string", enum: ["너무 적다", "적당하다", "너무 많다"] },
    count_why: { type: "string" },
    trust: { type: "integer", minimum: 1, maximum: 5, description: "이 추천을 믿고 실제 돈을 쓸 마음(1~5)" },
    confusing: { type: "array", items: { type: "string" }, description: "화면 숫자·용어 중 헷갈린 것" },
    wish: { type: "string", description: "이 목록에 바라는 점 한 문장" },
  } };
const answers = [];
for (const [bi, b] of [["A", A], ["B", B]]) {
  for (const p of PERSONAS) {
    const res = await run({ system: P_SYSTEM, schema: P_SCHEMA, model: p.model, text: `[나] ${p.who}\n\n[AI가 찾은 내 키워드 20개] (키워드 | 묶음 | 카테고리 | 월검색 | 1등 상품 리뷰 수 | 평균가 | AI 검수 태그)\n${show(b)}` });
    if (!res.ok) { console.log(`  ✕ ${bi}·${p.id}: ${res.error}`); continue; }
    answers.push({ bundle: bi, persona: p.id, model: p.model, sec: res.sec, cost: res.costUsd, ...res.result });
    console.log(`  ${bi}·${p.id}(${p.model}) ${res.sec}s · 신뢰 ${res.result.trust}/5 · ${res.result.count_feel} · 고른 것: ${res.result.picks.map((x) => x.kw).join(", ")}`);
  }
}

// ── 3) 허점 찾기 1명 ──
const D_SYSTEM = `너는 교육용 소싱 프로그램의 설계를 깨려는 검토자다. 칭찬 없이 실패 지점만 찾는다. 각 항목은 무엇이 어떻게 깨지는지 구체적으로, 심각도와 대응을 함께.`;
const D_SCHEMA = { type: "object", additionalProperties: false, required: ["risks"], properties: { risks: { type: "array", minItems: 3, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["what", "how", "severity", "fix"],
  properties: { what: { type: "string" }, how: { type: "string" }, severity: { type: "string", enum: ["높음", "중간", "낮음"] }, fix: { type: "string" } } } } } };
const design = `[설계]
- 대상: 250만원 4주 강의 수강생(초보 위주, 기수당 약 200명). 라이브커머스 방송에서 시연.
- 키워드 DB(월 1회 제휴 DB, 86만 개)에서 규칙으로 거른 뒤(브랜드·식품·화장품·인증·대형·각인·옷신발 제외) AI가 상위 후보를 "초보가 1688 완제품으로 들여와 팔 수 있나"로 판별(통과/보류/제외).
- 조회할 때마다 처음 보는 키워드 20개(바로 시작 8 · 경쟁 약한 6 · 요즘 뜨는 6), 하루 5번. 수강생마다 다른 순서로 뽑아 겹침을 줄임. 횟수 기록은 각자 PC(서버는 나중).
- 이번 달 AI 통과 키워드는 약 ${Object.values(r.groups).reduce((t, g) => t + g.items.filter((k) => k.ai?.v === "ok").length, 0)}개(상위 150 기준 묶음 합, 중복 포함). 전체 검수 후 약 2,200개 예상.
- 실제로 두 수강생 묶음을 뽑아 보니 20개 중 ${overlap.length}개가 겹쳤다.
[실제 묶음 A]\n${show(A)}`;
const dv = await run({ system: D_SYSTEM, schema: D_SCHEMA, model: "sonnet", text: design });
if (dv.ok) { console.log(`\n허점 찾기 ${dv.sec}s`); dv.result.risks.forEach((x) => console.log(`  [${x.severity}] ${x.what} → ${x.fix}`)); }

const outDir = path.join(HERE, "out"); fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const file = path.join(outDir, `persona-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify({ bundles: { A, B }, overlap, answers, risks: dv.result?.risks || [], spentUsd: spent }, null, 1));
const avg = answers.length ? (answers.reduce((t, a) => t + a.trust, 0) / answers.length).toFixed(1) : "-";
console.log(`\n평균 신뢰 ${avg}/5 · 저장: ${file} · 참고 비용 합 $${spent.toFixed(3)}`);
