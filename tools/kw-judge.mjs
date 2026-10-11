// 🤖 키워드 AI 판별(월 1회) — 💡 키워드 추천의 세 묶음 상위 후보를 Claude가 "초보가 1688에서 완제품으로 들여와 그대로 팔 수 있는가"로 판별해
// ~/sellar-data/kw_judge_YYYY-MM.json 에 저장한다. 앱(kw-combo.js)은 이 파일을 읽어 부적합을 빼고, 통과 이유를 칩으로 보여 준다.
// 실행: node --no-warnings tools/kw-judge.mjs [그룹마다 상위 개수=150]   (개발 Mac의 Claude CLI 구독 사용 · 이미 판별한 키워드는 건너뜀)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan } from "../src/main/kw-combo.js";
import { runStructured } from "../src/main/detail/cli.js";

const TOP = Number(process.argv[2]) || 150, BATCH = 60;
const ALL = process.argv.includes("--all"); // 묶음 상위만이 아니라 규칙 필터를 통과한 후보 전부(월 1회 전체 검수)
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--sample=")) || "").slice(9)) || 0; // --all 과 함께: 전체 중 무작위 N개만(비율 추정용 약식 검수)
const CONC = Number((process.argv.find((a) => a.startsWith("--conc=")) || "").slice(7)) || 1; // 동시에 보낼 묶음 수
const REFRESH = process.argv.includes("--refresh"); // 설명(desc)·쉬운 상품(easy)이 없는 예전 판별도 다시
const MAX = Number((process.argv.find((a) => a.startsWith("--max=")) || "").slice(6)) || Infinity; // 이번에 새로 판별할 최대 개수(약식 시험용)
let spent = 0, judgedNow = 0, tIn = 0, tOut = 0; // CLI가 알려 주는 참고 비용(구독이라 실제 청구 없음)·토큰
const SYSTEM = `너는 쿠팡 로켓그로스 셀러 교육 강사의 소싱 검수자다. 수강생은 온라인 판매가 처음인 초보이고, 중국 1688에서 "완제품"을 50~100개 사입해 쿠팡에 그대로 등록·판매한다.
각 키워드(쿠팡 검색어)에 대해, 그 검색어로 팔리는 대표 상품을 떠올려 아래 기준으로 판별하라.

통과(ok) = 아래를 모두 만족:
1. 1688에서 무브랜드 완제품으로 바로 살 수 있는 공산품(생활잡화·수납·정리·청소(비전기)·욕실·차량 실내용품·문구·여행 파우치·반려동물 생활잡화(사료·간식 제외)·단순 운동/취미 용품 등)
2. 브랜드명·상호·캐릭터·작품명·연예인·호환 브랜드 키워드가 아님 (예: 융스위치=JUNG, sp커넥터=SP Connect, 키티키링=헬로키티, 망곰, 데스노트)
3. 인증·신고 대상이 아님: 전기·전자·배터리, 어린이제품(만 13세 이하), 식품·식품에 닿는 주방용품, 화장품·의약외품(치약·렌즈용품 등), 의료기기, 소방·계량·가스·자동차 안전부품, 생활화학제품
4. 각인·인쇄·주문제작·재단·시공·설치가 필요 없음 (현수막, 명패, 식권, 판재, 배관, 건축자재 제외)
5. 대략 50cm·2kg 이하이고 잘 깨지거나 새지 않음 (가구·대형 자재·유리·도자기 제외)
6. 사이즈 옵션이 많지 않음 (의류·신발 제외), 살아 있는 동식물 아님, 서비스·행사 용어·지역명·사람 역할이 아님
보류(hold) = 대체로 괜찮지만 확인이 필요(예: 일부 옵션만 가능, 품질 편차 큼)
제외(no) = 하나라도 크게 어긋남

reason: 판별 이유를 15자 안팎 한국어로(예: "캐릭터 IP", "전기제품 KC", "소형 무인증 완제품").
tags: 통과/보류일 때 강점 2~3개(예: "소형", "무인증", "완제품", "옵션 단순", "1688 흔함"). 제외면 빈 배열.
desc: 이 키워드로 팔리는 대표 상품이 무엇인지 초보가 알아듣게 20자 안팎으로(예: "책상 서랍 정리용 칸막이", "낚시줄 매듭 묶는 방법·도구").
easy: 온라인 판매 처음인 일반인(주부·직장인)이 키워드만 보고 무슨 물건인지 바로 아는가 (true/false). 전문 용어·부품명·취미 전문용품이면 false.
모르는 단어는 추측하지 말고 hold로.`;
const SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["kw", "v", "reason", "tags", "desc", "easy"],
  properties: { kw: { type: "string" }, v: { type: "string", enum: ["ok", "hold", "no"] }, reason: { type: "string" }, tags: { type: "array", items: { type: "string" } }, desc: { type: "string" }, easy: { type: "boolean" } } } } } };

const file0 = (m) => path.join(os.homedir(), "sellar-data", `kw_judge_${m}.json`);
let r = await scan({});
const file = file0(r.month);
const done = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
// 부적합을 빼면 아래 후보가 올라오므로, 각 묶음 상위 TOP개가 모두 판별될 때까지 몇 번 반복
for (let round = 1; round <= 5; round++) {
  r = await scan({ limit: TOP, full: ALL });
  const want = new Map();
  if (ALL && SAMPLE) { // 무작위 표본: AI 판정과 무관한 후보 전체에서 고정 씨앗으로 섞어 앞 N개 → 목록을 파일로 남겨 통계(sample-stats.mjs)가 그대로 씀
    const sfile = path.join(os.homedir(), "sellar-data", `kw_sample_${r.month}.json`);
    let keys = fs.existsSync(sfile) ? JSON.parse(fs.readFileSync(sfile, "utf8")) : null;
    if (!keys || keys.length !== SAMPLE) {
      const arr = [...(await scan({ full: true, aiJudge: false })).all]; let x = 20261010;
      for (let i = arr.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) % 2147483648; const j = x % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      keys = arr.slice(0, SAMPLE).map((k) => k.kw);
      fs.writeFileSync(sfile, JSON.stringify(keys));
    }
    const byKw = new Map((await scan({ full: true, aiJudge: false })).all.map((k) => [k.kw, k]));
    for (const kw of keys) if (byKw.has(kw)) want.set(kw, byKw.get(kw));
  } else if (ALL) for (const k of r.all) want.set(k.kw, k);
  else for (const g of Object.values(r.groups)) for (const k of g.items.slice(0, TOP)) want.set(k.kw, k);
  const todo = [...want.values()].filter((k) => !done[k.kw] || (REFRESH && done[k.kw].desc == null)).slice(0, Math.max(0, MAX - judgedNow));
  console.log(`[${r.month}] ${round}바퀴 · 후보 ${want.size}개 · 판별 필요 ${todo.length}개`);
  if (!todo.length || (ALL && SAMPLE && round > 1)) break;
  const parts = []; for (let i = 0; i < todo.length; i += BATCH) parts.push(todo.slice(i, i + BATCH));
  let nextPart = 0;
  const worker = async () => {
    while (nextPart < parts.length) {
      const part = parts[nextPart++];
      const text = part.map((k) => `${k.kw}\t${k.cat}\t평균 ${Math.round(k.price)}원`).join("\n");
      const t = Date.now();
      const res = await runStructured({ system: SYSTEM, schema: SCHEMA, text: `키워드\t카테고리\t평균가\n${text}`, model: process.env.SIGNAL_AI_MODEL || "sonnet", timeoutMs: 600000 });
      if (!res.ok) { console.log(`  ✕ 실패: ${res.error}`); continue; }
      for (const x of res.result.items) if (want.has(x.kw)) done[x.kw] = { v: x.v, reason: x.reason, tags: x.tags || [], desc: x.desc || "", easy: !!x.easy };
      fs.writeFileSync(file, JSON.stringify(done, null, 1));
      const c = (v) => res.result.items.filter((x) => x.v === v).length;
      spent += res.costUsd || 0; judgedNow += part.length; tIn += (res.usage?.input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0); tOut += res.usage?.output_tokens || 0;
      console.log(`  ${judgedNow}/${todo.length} · ${((Date.now() - t) / 1000).toFixed(0)}s · 통과 ${c("ok")} 보류 ${c("hold")} 제외 ${c("no")} · 누적 참고 비용 $${spent.toFixed(2)}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
}
console.log(`저장: ${file} (${Object.keys(done).length}개) · 이번 판별 ${judgedNow}개 · 참고 비용 합 $${spent.toFixed(3)} · 입력 ${tIn.toLocaleString()} / 출력 ${tOut.toLocaleString()} 토큰`);
