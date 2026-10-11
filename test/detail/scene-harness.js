// 장면 생성 하네스 — 실제 화분선반 업체 사진으로 planShots → generateScenes(3컷).
// 실행: npx electron test/detail/scene-harness.js [--n=1] [--provider=gemini|vertex|openai] [--only=hero,point,usage]
//   키: GEMINI_API_KEY(또는 OPENAI_API_KEY) 환경변수, 또는 앱 설정 파일의 geminiKey 는 쓰지 않는다(하네스는 환경변수만).
//   키가 없으면 프롬프트 목록만 test/detail/img/out/scene/shots.json 에 저장하고 "KEY_MISSING" 으로 끝낸다(실패 아님).
// 결과: test/detail/img/out/scene/<shot>-<k>.png, shots.json, scene-result.json
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "img", "out", "scene");
const REF = path.join(os.homedir(), "Library", "CloudStorage", "OneDrive-케이엠인터트레이드", "문서 - bubu", "040_디자인팀", "01 _ 친절한마이쮸", "02 _ 상세페이지", "59 _ 블랙 계단식 화분선반", "01 _ 자료", "업체 사진 자료");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const log = (_l, t) => console.log(t);

const PRODUCT = {
  title_ko: "블랙 계단식 접이식 화분 선반", title_en: "black tiered folding plant shelf", category: "원예 · 화분 선반",
  attrs_ko: [{ k_ko: "재질", v_ko: "스틸(분체 도장)" }, { k_ko: "구조", v_ko: "2~3단 계단식" }, { k_ko: "사이즈", v_ko: "80cm / 100cm" }],
  features: ["접이식 — 다리를 접어 보관", "녹 방지 도장", "튼튼한 스틸 프레임", "계단식 단 구조"],
};

// ---- v5: 섹션별 장면(실제 앱 실행 폴더 841080065939 — 화이트 슬라이딩 서랍 수납장) ----
// 실행: npx electron test/detail/scene-harness.js --v5 [--only=hero,ba,cp,f1,vs-1,vs-2] [--hero-model=gemini-3-pro-image-preview] [--round=2]
const V5_JOB = path.join(os.homedir(), "Library", "Application Support", "씨드핵", "detail", "20261009-132404-841080065939");
async function runV5() {
  const fails = [];
  try {
    const { planSectionShots } = await import("../../src/main/detail/scene-prompt.js");
    const { generateScenes, resolveProvider } = await import("../../src/main/detail/scene.js");
    const src = JSON.parse(fs.readFileSync(path.join(V5_JOB, "source.json"), "utf8"));
    const brief = JSON.parse(fs.readFileSync(path.join(V5_JOB, "brief.json"), "utf8"));
    const product = { title_ko: "슬라이딩 서랍 데스크 수납장", title_en: "white two-tier metal storage cabinet with a sliding pull-out drawer and a top rail", category: "주방 수납 · 데스크 수납",
      attrs_ko: (src.attrs || []).slice(0, 12).map((a) => ({ k_ko: a.k_ko || a.k_zh, v_ko: a.v_ko || a.v_zh })), features: brief.buying_factors || [] };
    const sections = [
      { id: "hero", type: "hero", copy: { title: "커피머신 아래 빈 공간을 넉넉한 수납공간으로" }, needs: "주방 조리대 위, 수납장 위에 커피머신" },
      { id: "ba", type: "before_after", needs: "캡슐·티백·소품이 흩어진 조리대 → 수납장 서랍에 정리" },
      { id: "cp", type: "checkpoint" },
      { id: "f1", type: "feature", copy: { title: "부드러운 슬라이딩 서랍" }, needs: "손으로 서랍을 당겨 여는 순간" },
      { id: "vs", type: "versatility" },
    ];
    const outV5 = path.join(here, "img", "out", "scene-v5", `round${arg("round", "1")}`);
    fs.mkdirSync(outV5, { recursive: true });
    const only = arg("only", "hero,ba,cp,f1,vs-1,vs-2").split(",");
    const shots = planSectionShots({ sections, product, brief }).filter((s) => only.includes(s.id));
    for (const s of shots) { if (s.type === "hero") { s.n = Number(arg("hero-n", 1)); const hm = arg("hero-model", ""); if (hm) s.model = hm; } }
    fs.writeFileSync(path.join(outV5, "shots.json"), JSON.stringify(shots, null, 2));
    const prov = resolveProvider({ provider: arg("provider") });
    console.log(`v5 ${shots.length}컷 · ${prov.provider}/${prov.model} · 프로젝트 ${prov.project || "-"}`);
    if (!prov.key) { console.log("KEY_MISSING"); return; }
    const inputs = ["g05.jpg", "g01.jpg"].map((f) => path.join(V5_JOB, "raw", f)).filter((f) => fs.existsSync(f));
    const t0 = Date.now();
    const res = await generateScenes({ productImages: inputs, shots, outDir: outV5, log, provider: arg("provider"), n: 1, concurrency: Number(arg("conc", 2)) });
    const sec = (Date.now() - t0) / 1000;
    const nImg = res.reduce((t, r) => t + r.files.length, 0);
    fs.writeFileSync(path.join(outV5, "result.json"), JSON.stringify({ res, sec, nImg }, null, 2));
    console.log(`생성 ${nImg}장 · ${sec.toFixed(1)}초`);
    for (const r of res) console.log(`  ${r.id} ${r.ok ? r.files.map((f) => path.basename(f)).join(",") : "실패 · " + r.error} · ${r.model} · ${(r.ms / 1000).toFixed(1)}초${r.modelNote ? " · " + r.modelNote : ""}`);
    if (!nImg) fails.push(`생성 0장: ${res[0]?.error}`);
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("SCENE_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK SCENE_V5_OK");
}

// ---- 속도 측정: 재생 폴더의 섹션(sections.json) 전부를 generateSectionScenes 로(다지역·동시 6) ----
// 실행: npx electron test/detail/scene-harness.js --bench [재생 폴더]
const BENCH_JOB = path.join(os.tmpdir(), "seedhack-detail-test", "replay", "detail", "20261009-132404-841080065939-replay");
async function runBench() {
  const fails = [];
  try {
    const dir = process.argv.find((a, i) => i >= 2 && !a.startsWith("--") && fs.existsSync(path.join(a, "sections.json"))) || BENCH_JOB;
    const { generateSectionScenes, resolveProvider } = await import("../../src/main/detail/scene.js");
    const { planSectionShots } = await import("../../src/main/detail/scene-prompt.js");
    const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return d; } };
    const sections = (rd("sections.json", []) || []).filter((x) => x.shot);
    const src = rd("source.json", {}), brief = rd("brief.json", {}), cleaned = rd("clean.json", []), style = rd("style.json", null);
    const cut = cleaned.filter((c) => c.cutout?.file).map((c) => path.join(dir, c.cutout.file));
    const photos = cleaned.filter((c) => c?.photo?.file).map((c) => path.join(dir, c.photo.file));
    const productImages = (cut.length ? cut : photos).filter((f) => fs.existsSync(f)).slice(0, 2);
    const product = { title_ko: src.title_ko || "", category: src.category || "", attrs_ko: (src.attrs || []).map((a) => ({ k_ko: a.k_ko, v_ko: a.v_ko })), features: (brief.advantages || brief.buying_factors || []).slice(0, 8) };
    const shots = planSectionShots({ sections, product, brief, styleGuide: style?.styleGuide || style || null });
    const prov = resolveProvider({});
    console.log(`측정: 섹션 ${sections.length}개 → 컷 ${shots.length}개(장 ${shots.reduce((t, s) => t + (s.n || 1), 0)}) · 입력 ${productImages.length}장 · ${prov.provider}`);
    if (!prov.key) { console.log("KEY_MISSING"); return; }
    const out = path.join(here, "img", "out", "scene-bench", String(Date.now()));
    const t0 = Date.now();
    const res = await generateSectionScenes({ sections, product, brief, styleGuide: style?.styleGuide || style || null, productImages, outDir: out, settings: {}, log });
    const sec = (Date.now() - t0) / 1000;
    const nImg = res.reduce((t, r) => t + r.files.length, 0), want = shots.reduce((t, s) => t + (s.n || 1), 0);
    console.log(`\n총 ${sec.toFixed(1)}초 · 성공 ${nImg}/${want}장 · 429 ${res.stats?.total429 ?? "-"}회`);
    console.log("지역별:", JSON.stringify(res.stats?.regions || {}));
    for (const r of res) console.log(`  ${r.id} ${r.ok ? "✅" : "❌"} ${(r.ms / 1000).toFixed(1)}초 · ${r.region || "-"}${r.error ? " · " + r.error.slice(0, 60) : ""}`);
    fs.writeFileSync(path.join(out, "bench.json"), JSON.stringify({ sec, nImg, want, stats: res.stats, res }, null, 2));
    if (!nImg) fails.push("생성 0장");
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("SCENE_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK SCENE_BENCH_OK");
}

// ---- 실제 작업 폴더의 일부 섹션 장면만 새 규칙으로 다시 만들고 A3 reviewScenes 로 검수해 scene.json 갱신 ----
// 실행: npx electron test/detail/scene-harness.js --regen-job=<작업 폴더> [--types=hero,before_after,versatility]
async function runRegenJob() {
  const fails = [];
  try {
    const dir = arg("regen-job");
    const types = arg("types", "hero,before_after,versatility").split(",");
    const rd = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return d; } };
    const { generateSectionScenes, pickSceneInputs } = await import("../../src/main/detail/scene.js");
    const { reviewScenes } = await import("../../src/main/detail/vision.js");
    const sections = (rd("sections.json", []) || []).filter((x) => x.shot && types.includes(x.type));
    const src = rd("source.json", {}), brief = rd("brief.json", {}), cleaned = rd("clean.json", []), style = rd("style.json", null), vision = rd("vision.json", null), copy = rd("copy.json", {});
    const cands = [];
    for (const c of cleaned) { if (c.cutout?.file) cands.push({ id: c.id, file: path.join(dir, c.cutout.file), cutout: true }); if (c.photo?.file) cands.push({ id: c.id, file: path.join(dir, c.photo.file) }); }
    const inputs = pickSceneInputs(cands, vision, { max: 2 });
    console.log(`섹션 ${sections.map((x) => x.id).join(", ")} · 입력 ${inputs.map((f) => path.relative(dir, f)).join(", ")}`);
    const product = { title_ko: copy.name_ko || src.title_ko || "", category: src.category || "", attrs_ko: (src.attrs || []).map((a) => ({ k_ko: a.k_ko, v_ko: a.v_ko })), features: (brief.advantages || brief.buying_factors || []).slice(0, 8) };
    const outS = path.join(dir, "scene");
    // 백업: scene.json·덮어쓸 장면 파일
    const stamp = Date.now();
    fs.copyFileSync(path.join(dir, "scene.json"), path.join(dir, `scene.prev-a2-${stamp}.json`));
    const bak = path.join(outS, `prev-a2-${stamp}`); fs.mkdirSync(bak, { recursive: true });
    for (const f of fs.readdirSync(outS)) if (sections.some((x) => f.startsWith(x.id + "-"))) fs.copyFileSync(path.join(outS, f), path.join(bak, f));
    const t0 = Date.now();
    // --shot-ids=v5-01-hero,v5-08-versatility-4 : 그 컷만(재시도). 파일 이름이 겹치지 않게 -r 접미사
    let res;
    const only = arg("shot-ids", "");
    if (only) {
      const { planSectionShots } = await import("../../src/main/detail/scene-prompt.js");
      const { generateScenes } = await import("../../src/main/detail/scene.js");
      const heroN = Number(arg("hero-n", 0)); // --hero-n=2: hero 를 몇 장(기본: 재시도는 1장)
      const shots = planSectionShots({ sections, product, brief, styleGuide: style }).filter((x) => only.split(",").includes(x.id)).map((x) => ({ ...x, id: `${x.id}-r${stamp % 1000}`, ...(x.type === "hero" && heroN ? { n: heroN } : {}) }));
      const r0 = await generateScenes({ productImages: inputs, shots, outDir: outS, settings: {}, log, n: 1, concurrency: 6 });
      res = r0.map((r, i) => ({ ...r, sectionId: shots[i].sectionId, type: shots[i].type })); res.stats = r0.stats;
    } else res = await generateSectionScenes({ sections, product, brief, styleGuide: style, productImages: inputs, outDir: outS, settings: {}, log });
    const genSec = (Date.now() - t0) / 1000;
    const made = [];
    for (const r of res) r.files.forEach((f) => made.push({ id: path.basename(f, path.extname(f)), section: r.sectionId, type: r.type, file: path.relative(dir, f).replace(/\\/g, "/"), pass: false }));
    console.log(`생성 ${made.length}장 · ${genSec.toFixed(1)}초 · 429 ${res.stats?.total429 ?? "-"}회`);
    const t1 = Date.now();
    const rv = await reviewScenes({ items: made.map((m) => ({ id: m.id, file: path.join(dir, m.file) })), product, log });
    const revSec = (Date.now() - t1) / 1000;
    if (!rv.ok) fails.push(`검수 실패: ${rv.error}`);
    for (const m of made) { const it = (rv.items || []).find((x) => x.id === m.id); if (it) { Object.assign(m, { product_visible: it.product_visible, product_bbox: it.product_bbox, other_brand_prominent: it.other_brand_prominent, note: it.note }); m.pass = it.product_visible === "full" && !it.other_brand_prominent; m.reviewedBy = "reviewScenes"; } }
    const scene = rd("scene.json", { items: [] });
    const replace = arg("replace", ""); // --shot-ids 재시도일 때: 바꿀 기존 항목 id(쉼표). 없으면 섹션 전체 교체
    const keep = only ? (scene.items || []).filter((x) => !replace.split(",").includes(x.id)) : (scene.items || []).filter((x) => !sections.some((s) => s.id === x.section));
    scene.items = [...keep, ...made];
    scene.inputs = inputs.map((f) => path.relative(dir, f).replace(/\\/g, "/"));
    scene.regenA2 = { at: stamp, sections: sections.map((x) => x.id), genSec, revSec, reviewCostUsd: rv.costUsd ?? null, images: made.length, genCostUsd: +(made.length * 0.039).toFixed(3), backup: path.relative(dir, bak) };
    fs.writeFileSync(path.join(dir, "scene.json"), JSON.stringify(scene, null, 2));
    for (const m of made) console.log(`  ${m.id} ${m.pass ? "✅" : "❌"} visible=${m.product_visible} otherBrand=${m.other_brand_prominent} · ${m.note || ""}`);
    console.log(`검수 ${revSec.toFixed(1)}초 · 검수 비용 $${rv.costUsd ?? "-"} · 생성 비용 ≈ $${(made.length * 0.039).toFixed(2)}`);
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("SCENE_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log("OK SCENE_REGEN_OK");
}

app.whenReady().then(async () => {
  if (arg("regen-job")) { await runRegenJob(); app.quit(); return; }
  if (process.argv.includes("--bench")) { await runBench(); app.quit(); return; }
  if (process.argv.includes("--v5")) { await runV5(); app.quit(); return; }
  const fails = [];
  let status = "OK";
  try {
    const { planShots } = await import("../../src/main/detail/scene-prompt.js");
    const { generateScenes, resolveProvider } = await import("../../src/main/detail/scene.js");
    fs.mkdirSync(outDir, { recursive: true });
    const shots = planShots({ product: PRODUCT });
    fs.writeFileSync(path.join(outDir, "shots.json"), JSON.stringify(shots, null, 2));
    console.log(`planShots ${shots.length}컷:`);
    for (const s of shots) console.log(`  ${s.id} [${s.purpose}] ${s.title_ko}\n     KO: ${s.prompt_ko.split(". ")[0]}\n     EN: ${s.prompt_en.split(". ")[0]}`);
    const prov = resolveProvider({ provider: arg("provider") });
    if (!prov.key) {
      status = "KEY_MISSING";
      console.log(`\n이미지 생성 키 없음(GEMINI_API_KEY / OPENAI_API_KEY) → 프롬프트만 저장: ${path.join(outDir, "shots.json")}`);
    } else {
      // 제품 사진: 누끼(cutout-mac)가 되면 누끼 우선, 아니면 업체 사진 그대로 — 계단 2단 정면(1.jpg)·접힌 모습(4.jpg)
      const srcs = ["1.jpg", "4.jpg"].map((f) => path.join(REF, f)).filter((f) => fs.existsSync(f));
      if (!srcs.length) throw new Error(`업체 사진이 없습니다: ${REF}`);
      let inputs = srcs;
      try {
        const { cutoutImages } = await import("../../src/main/detail/cutout.js");
        const cut = await cutoutImages(srcs.map((f, i) => ({ id: `p${i + 1}`, file: f, out: path.join(outDir, `input-p${i + 1}.png`) })), { log });
        const ok = cut.filter((c) => c.cutoutOk).map((c) => c.out);
        if (ok.length) inputs = ok;
      } catch (e) { console.log(`  누끼 생략: ${e.message}`); }
      console.log(`\n입력 사진 ${inputs.length}장: ${inputs.map((f) => path.basename(f)).join(", ")} · ${prov.provider}/${prov.model}`);
      // --only=usage,hero 처럼 일부 컷만(재시도·비용 절약). 기본 hero·point·usage 3컷
      const only = arg("only", "hero,point,usage").split(",");
      const pick = only.map((p) => shots.find((s) => s.purpose === p || s.id === p)).filter(Boolean);
      const t0 = Date.now();
      const res = await generateScenes({ productImages: inputs, shots: pick, aspect: "4:5", n: Number(arg("n", 1)), outDir, log, provider: arg("provider") });
      fs.writeFileSync(path.join(outDir, "scene-result.json"), JSON.stringify(res, null, 2));
      console.log(`생성 ${Date.now() - t0}ms`);
      for (const r of res) console.log(`  ${r.id} ${r.purpose}: ${r.ok ? r.files.map((f) => path.basename(f)).join(", ") : "실패 · " + r.error}`);
      if (!res.some((r) => r.ok)) fails.push(`생성 0장: ${res[0]?.error}`);
    }
  } catch (e) { fails.push(`예외: ${e?.stack || e}`); }
  if (fails.length) { console.log("SCENE_FAIL\n - " + fails.join("\n - ")); process.exitCode = 1; }
  else console.log(status === "KEY_MISSING" ? "KEY_MISSING" : "OK SCENE_OK");
  app.quit();
});
