// A4 렌더 하네스 — plan-sample.a4.json(A4 손으로 쓴 샘플) 로 템플릿 3종을 렌더해 test/detail/out/<template>/ 에 저장하고 체크리스트 D-1·D-2·D-4·D-6·D-7·D-8 을 코드로 검사
// 실행: npx electron test/detail/render-harness.js  → 마지막 줄 "A4_OK" 또는 실패 사유 (exit 1)
// 네트워크 없음 · 앱 본체 안 띄움 · 임시 userData
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderPlan, TEMPLATES, WIDTH, MAX_SLICE, MAX_BYTES } from "../../src/main/detail/render.js";

app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixture");
const OUT = path.join(__dirname, "out");
const fails = [];
const must = (ok, msg) => { if (!ok) fails.push(msg); return ok; };

// 임시 jobDir: plan 이 가리키는 clean/*.png 자리에 샘플 이미지를 복사
function makeJob(name, imgDir = "img-plan") {
  const jobDir = path.join(app.getPath("userData"), "detail", name);
  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(jobDir, "clean"), { recursive: true });
  for (const f of fs.readdirSync(path.join(FIX, imgDir))) if (/\.(png|jpe?g)$/.test(f)) fs.copyFileSync(path.join(FIX, imgDir, f), path.join(jobDir, "clean", f));
  return jobDir;
}
// 샘플 plan: plan-sample.a4.json (A4 소유). plan-sample.json 은 A3 copy-harness 가 파이프라인 결과로 덮어쓰므로 이름을 나눴다
const loadPlan = () => JSON.parse(fs.readFileSync(path.join(FIX, "plan-sample.a4.json"), "utf8"));

// 한 번 렌더하고 결과 폴더를 test/detail/out/<tag>/ 로 복사한 뒤 공통 검사
async function renderOne(tag, plan, templateId, { longText = false, imgDir } = {}) {
  const jobDir = makeJob(tag, imgDir);
  const t0 = Date.now();
  const r = await renderPlan({ plan, jobDir, templateId, onProgress: (p) => process.stdout.write(`  [${tag}] ${p.msg}\n`), log: (c, m) => console.log(`  (${c}) ${m}`) });
  const dest = path.join(OUT, tag);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(jobDir, "out"), dest, { recursive: true });
  const H = r.totalHeight, secs = r.sections;
  console.log(`[${tag}] ${Date.now() - t0}ms · 슬라이스 ${r.slices.length}장 · 전체 ${H}px · 섹션 ${secs.map((s) => `${s.type}:${s.h}`).join(" ")}`);
  console.log(`[${tag}] 점검: 폭 ${r.check.bodyWidth} · 본문 최소 ${r.check.minBody}px · 헤드라인 ${r.check.minHead}px · 캡션 ${r.check.minCap}px · 최소 대비 ${r.check.minContrast}:1 · 문제 ${r.check.issues.length}개`);
  for (const i of r.check.issues) console.log(`    ! ${i}`);
  // D-1: 슬라이스 jpg 존재
  must(r.slices.length >= 1 && r.slices.every((s) => fs.existsSync(path.join(jobDir, s.file))), `${tag} D-1 슬라이스 파일 없음`);
  // D-2: 폭 780, 세로 ≤ 3000, ≤ 10MB, JPG, 전체 6,000~20,000
  for (const s of r.slices) {
    const buf = fs.readFileSync(path.join(jobDir, s.file));
    must(buf[0] === 0xff && buf[1] === 0xd8, `${tag} D-2 ${s.file} JPG 아님`);
    const EW = r.width || WIDTH; // 기대 폭(780 기본, plan.meta.width 860 옵션)
    must(s.w === EW && s.h <= MAX_SLICE && s.h > 0, `${tag} D-2 ${s.file} 크기 ${s.w}x${s.h}`);
    must(buf.length <= MAX_BYTES, `${tag} D-2 ${s.file} ${buf.length} bytes > 10MB`);
    // 실제 JPG 헤더에서 가로·세로 읽기(SOF0/SOF2)
    const dim = jpgSize(buf);
    must(dim && dim.w === EW && dim.h === s.h, `${tag} D-2 ${s.file} 실제 픽셀 ${dim?.w}x${dim?.h} ≠ ${EW}x${s.h}`);
  }
  const sum = r.slices.reduce((n, s) => n + s.h, 0);
  must(sum === H, `${tag} D-2 슬라이스 합 ${sum} ≠ 전체 ${H}`);
  if (!longText) must(H >= 6000 && H <= 20000, `${tag} D-2 전체 세로 ${H} (6,000~20,000 밖)`);
  // D-3: 글자 크기·대비
  must(r.check.minBody >= 24 && r.check.minHead >= 40 && r.check.minCap >= 22, `${tag} D-3 글자 크기 본문 ${r.check.minBody} 헤드라인 ${r.check.minHead} 캡션 ${r.check.minCap}`);
  must(r.check.minContrast >= 4.5, `${tag} D-3 명도 대비 ${r.check.minContrast}:1 < 4.5`);
  must(r.check.bodyWidth === (r.width || WIDTH), `${tag} D-2 문서 폭 ${r.check.bodyWidth}`);
  // D-4: hero 한 장(첫 슬라이스) 안에 있고 세로 ≤ 1100
  const hero = secs.find((s) => s.type === "hero");
  must(hero && hero.h <= 1100, `${tag} D-4 hero 세로 ${hero?.h} > 1100`);
  must(r.slices[0].sections[0] === "hero", `${tag} D-4 hero 가 첫 슬라이스가 아님`);
  const heroLayers = r.sections && JSON.parse(fs.readFileSync(path.join(jobDir, "out/figma-manifest.json"), "utf8")).sections.find((s) => s.type === "hero").layers;
  if (/^v8-trust/.test(tag)) must(heroLayers["#hero.image"], `${tag} D-4 hero 사진 누락`);
  else if (templateId === "localize")
    must(heroLayers["#hero.image"] && heroLayers["#hero.name"], `${tag} D-4 localize hero 구성 누락`);
  else if (templateId === "card")
    must(heroLayers["#hero.image"] && heroLayers["#hero.name"], `${tag} D-4 card hero 구성(사진·제품명) 누락`);
  else if (templateId === "editorial") // 에디토리얼 히어로는 디자이너 레퍼런스대로 배지 대신 영문 타이틀·필기체·한글 2줄
    must(heroLayers["#hero.image"] && (heroLayers["#hero.title_en"] || heroLayers["#hero.headline"]), `${tag} D-4 editorial hero 구성(사진·타이틀) 누락`);
  else must(heroLayers["#hero.image"] && heroLayers["#hero.headline"] && heroLayers["#hero.sub"] && heroLayers["#hero.badge.3"], `${tag} D-4 hero 구성(사진·헤드라인·보조문·배지3) 누락`);
  // D-5/D-6: 넘침·잘림·말줄임·1.5배 확대 없음 (check.issues)
  // A3 파이프라인 plan 은 fixture 에 잘린 이미지(cuts) 파일이 없어 "이미지 파일 없음" 이 정상 — 그것만 허용
  if (tag === "pipeline-clean") r.check.issues = r.check.issues.filter((x) => !x.startsWith("이미지 파일 없음"));
  must(r.check.issues.length === 0, `${tag} D-6 넘침/잘림/대비 문제: ${r.check.issues.slice(0, 3).join(" | ")}`);
  must(r.consoleErrors.length === 0, `${tag} 콘솔 오류: ${r.consoleErrors.slice(0, 2).join(" | ")}`);
  // D-7: preview.png · page.html
  must(fs.existsSync(path.join(jobDir, r.preview)) && fs.readFileSync(path.join(jobDir, r.preview)).subarray(1, 4).toString() === "PNG", `${tag} D-7 preview.png 없음`);
  const pageHtml = fs.existsSync(path.join(jobDir, r.html)) ? fs.readFileSync(path.join(jobDir, r.html), "utf8") : "";
  must(pageHtml.includes('data-sec="hero"') && (/^v[35678]/.test(tag) || pageHtml.includes("../clean/")) && !pageHtml.includes("file://" + jobDir), `${tag} D-7 page.html 내용 이상`);
  // D-8: figma-manifest.json + figma-bundle.json(base64)
  try {
    const m = JSON.parse(fs.readFileSync(path.join(jobDir, r.figmaManifest), "utf8"));
    must((m.template === templateId || m.theme === templateId) && m.width === (r.width || WIDTH) && m.sections.length === secs.length && m.assets.length >= 1, `${tag} D-8 manifest 내용 이상`);
    const b = JSON.parse(fs.readFileSync(path.join(jobDir, r.figmaBundle), "utf8"));
    must(b.manifest && b.images && m.assets.every((a) => b.images[a]?.base64?.length > 100 && b.images[a].w > 0), `${tag} D-8 bundle 이미지 base64 누락`);
  } catch (e) { must(false, `${tag} D-8 JSON 파싱 실패 ${e.message}`); }
  return r;
}

// JPG 헤더에서 크기 읽기
function jpgSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// 긴 문장 fixture: 헤드라인 60자, 캡션 300자, 배지·FAQ 도 길게 → 잘림 없이 줄바꿈되는지
function longPlan() {
  const p = loadPlan();
  const hero = p.sections.find((s) => s.type === "hero");
  hero.headline = "빨랫감이 산더미처럼 쌓여도 한 번에 옮기고 접어서 세탁기 옆 좁은 틈에 세워 두는 접이식 대용량 빨래바구니입니다"; // 60자
  hero.sub = "접으면 납작하게 접히고 펼치면 40L가 들어가는 바구니라서 원룸·오피스텔·세탁실이 좁은 집에서도 자리 걱정 없이 쓸 수 있습니다";
  hero.badges = ["접이식이라 세탁기 옆 좁은 틈에도 들어가요", "40L 대용량이라 가족 빨래도 한 번에", "물빨래 가능해서 위생적으로 관리"];
  const cap = "옆면 전체에 고르게 뚫린 통풍 구멍이 바구니 안 공기를 순환시켜 젖은 수건이나 운동복을 잠시 두어도 꿉꿉한 냄새가 덜 배고, 욕실처럼 습한 곳에 두어도 바닥 물기가 쉽게 마릅니다. ".repeat(3).trim(); // 약 300자
  for (const s of p.sections) {
    if (s.type === "feature") { s.desc = cap; s.title = "옆면 전체 통풍 구조로 젖은 빨랫감을 잠시 두어도 냄새가 덜 배는 구조입니다"; s.overlay = [{ x: 60, y: 80, w: 680, h: 56, text: "옆면 전체에 고르게 뚫린 통풍 구멍으로 공기가 순환됩니다" }]; }
    if (s.type === "usp") for (const it of s.items) { it.title = "손잡이 일체형이라 젖은 수건을 가득 담아도 손잡이가 빠지거나 찢어지지 않습니다"; it.desc = cap; }
    if (s.type === "pain") for (const it of s.items) it.text = "빨래를 옮기다 양말 한 짝이 복도에 떨어지고 세탁기 옆에는 바구니 둘 자리가 없어서 늘 바닥에 빨랫감이 쌓여 있어요";
    if (s.type === "spec") s.rows.push({ k: "아주 긴 항목 이름이 들어오는 경우의 줄바꿈 확인용 항목", v: "PP(폴리프로필렌) 소재에 통풍 구멍이 있고 접이식이며 손잡이가 일체형인 40L 빨래바구니, 그레이와 아이보리 두 가지 색상" });
    if (s.type === "faq") for (const it of s.items) it.a = cap;
    if (s.type === "cta") { s.headline = "오늘 세탁실이 조금 더 가벼워지도록, 접이식 대용량 빨래바구니로 빨랫감 정리를 시작해 보세요"; s.sub = cap; }
    if (s.type === "notice") s.items.push("아주긴단어테스트" + "가".repeat(60)); // 띄어쓰기 없는 긴 글자도 잘리지 않고 줄바꿈
  }
  return p;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = {};
  for (const t of TEMPLATES) results[t.id] = await renderOne(t.id, loadPlan(), t.id);
  // 긴 문장 fixture (템플릿 3종 모두)
  for (const t of TEMPLATES) results["long-" + t.id] = await renderOne("long-" + t.id, longPlan(), t.id, { longText: true });
  // 빈 섹션 fixture: items 0 인 섹션은 그리지 않는다 (D-6)
  {
    const p = loadPlan();
    p.sections = p.sections.map((s) => s.type === "pain" ? { type: "pain", title: "x", items: [] } : s.type === "faq" ? { type: "faq", items: [] } : s.type === "gallery" ? { type: "gallery", images: [] } : s);
    const r = await renderOne("empty-clean", p, "clean", { longText: true });
    const types = r.sections.map((s) => s.type);
    must(!types.includes("pain") && !types.includes("faq") && !types.includes("gallery"), `empty D-6 빈 섹션이 그려짐: ${types.join(",")}`);
  }
  // v2(스튜디오) 샘플: 팔레트·누끼·새 섹션(problem/agitate/solution/benefits/proof/compare/steps/objections/trust/size dims) — studio + clean(기존 템플릿도 v2 섹션을 그릴 수 있는지)
  const v2 = () => JSON.parse(fs.readFileSync(path.join(FIX, "plan-v2-sample.json"), "utf8"));
  results["v2-studio"] = await renderOne("v2-studio", v2(), "studio");
  results["v2-clean"] = await renderOne("v2-clean", v2(), "clean");
  {
    const r = results["v2-studio"], types = r.sections.map((s) => s.type);
    must(["problem", "agitate", "solution", "benefits", "proof", "compare", "steps", "objections", "trust", "size"].every((t) => types.includes(t)), `v2 섹션 누락: ${types.join(",")}`);
    const m = JSON.parse(fs.readFileSync(path.join(OUT, "v2-studio", "figma-manifest.json"), "utf8"));
    must(m.assets.some((a) => /_cut\.png$/.test(a)), "v2 manifest 에 누끼 자산 없음");
    const html = fs.readFileSync(path.join(OUT, "v2-studio", "page.html"), "utf8");
    must(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html.replace(/[○✕✓]/g, "")), "v2 studio 에 이모지가 남아 있음");
    must(html.includes("<svg"), "v2 studio 라인 아이콘(svg) 없음");
  }
  // v3(에디토리얼) 샘플: 레퍼런스 폴더 사진을 절대경로로 참조 — 폴더가 없는 PC 에서는 건너뜀
  {
    const p3 = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v3-editorial.json"), "utf8"));
    const firstImg = p3.sections.find((x) => x.image)?.image;
    if (firstImg && fs.existsSync(firstImg)) {
      const r = await renderOne("v3-editorial", p3, "editorial");
      const types = r.sections.map((x) => x.type);
      must(["hero", "options", "keywords", "reviews", "checkpoint", "foryou", "point", "gallery"].every((t) => types.includes(t)), `v3 섹션 누락: ${types.join(",")}`);
      const html = fs.readFileSync(path.join(OUT, "v3-editorial", "page.html"), "utf8");
      must((html.match(/class="cp-label"/g) || []).length === 5 && html.includes("cp-lines"), "v3 CHECK POINT 지시선 5개 아님");
      must(html.includes('class="hl"'), "v3 리뷰 형광 강조 없음");
      // 리뷰 데이터가 없으면 섹션 생략
      const p3b = JSON.parse(JSON.stringify(p3)); p3b.sections = p3b.sections.map((x) => x.type === "reviews" ? { type: "reviews", rating: "4.8", photos: [], cards: [] } : x);
      const p3c = { ...p3b, meta: { ...p3b.meta, width: 860 } };
      const r2 = await renderOne("v3-editorial-860", p3c, "editorial");
      must(r2.width === 860 && !r2.sections.some((x) => x.type === "reviews"), `v3 860 폭/리뷰 생략 실패 (폭 ${r2.width})`);
    } else console.log("  (v3 레퍼런스 사진 폴더가 없어 건너뜀)");
  }
  // v5(카드) 샘플: Moast 결과와 같은 상품(841080065939) 사진을 작업 폴더에서 절대경로로 — 없으면 건너뜀
  {
    const p5 = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v5-card.json"), "utf8"));
    if (fs.existsSync(p5.sections[0].image)) {
      const r = await renderOne("v5-card", p5, "card");
      const types = r.sections.map((x) => x.type);
      must(r.width === 860, `v5 card 기본 폭 860 아님 (${r.width})`);
      must(["hero", "before_after", "checkpoint", "feature", "feature2", "versatility", "detail"].every((t) => types.includes(t)), `v5 섹션 누락: ${types.join(",")}`);
      const html = fs.readFileSync(path.join(OUT, "v5-card", "page.html"), "utf8");
      must((html.match(/class="cp-label/g) || []).length === 5, "v5 CHECKPOINT 지시선 5개 아님");
      must((html.match(/class="zoom"/g) || []).length === 3, "v5 확대 원 3개 아님");
      const p5b = { ...p5, meta: { ...p5.meta, width: 780 } };
      const r2 = await renderOne("v5-card-780", p5b, "card");
      must(r2.width === 780, "v5 card 780 옵션 실패");
    } else console.log("  (v5 샘플 사진 폴더가 없어 건너뜀)");
  }
  // v6(원본 한글화) 샘플: 원본 폴더 이미지를 절대경로로(레이어 좌표는 손으로) — 없으면 건너뜀
  {
    const p6 = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v6-localize.json"), "utf8"));
    if (fs.existsSync(p6.sections[0].image)) {
      const r = await renderOne("v6-localize", p6, "localize", { longText: true });
      must(r.template === "localize", `v6 localize 엔진 아님 (${r.template})`);
      const html = fs.readFileSync(path.join(OUT, "v6-localize", "page.html"), "utf8");
      must((html.match(/class="loc-layer/g) || []).length >= 20 && !html.includes(">13.5cm<"), "v6 레이어 수 이상 또는 number 레이어가 그려짐");
    } else console.log("  (v6 원본 폴더가 없어 건너뜀)");
  }
  // v7 타이포 강조: v6·v5 샘플에 emph·rewrite_ok 를 넣어 렌더(A3 가 넣을 형식) — 강조 span 이 생기는지, 문제 0 인지
  {
    const p6 = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v6-localize.json"), "utf8"));
    const p5 = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v5-card.json"), "utf8"));
    if (fs.existsSync(p6.sections[0].image) && fs.existsSync(p5.sections[0].image)) {
      const KINDS = ["color", "underline", "slant", "dot", "pill", "bold"];
      let k = 0;
      for (const sec of p6.sections) {
        if (sec.type === "hero") { sec.vlines = true; continue; }
        const ls = (sec.layers || []).filter((l) => !l.drop && l.ko);
        const titles = ls.filter((l) => l.role === "title");
        if (titles.length >= 2 && titles[0].y < 200) { titles.forEach((l) => { l.rewrite_ok = true; }); titles[0].emph = [{ text: String(titles[0].ko).split(/\s+/)[0], kind: KINDS[k++ % KINDS.length] }]; }
        else if (titles[0]) titles[0].emph = [{ text: String(titles[0].ko).split(/[\s,]+/).filter(Boolean).slice(-1)[0], kind: KINDS[k++ % KINDS.length] }];
      }
      const r6 = await renderOne("v7-localize", p6, "localize", { longText: true });
      for (const sec of p5.sections) {
        if (sec.type === "hero") { sec.vlines = true; continue; }
        const t = String(sec.title || "").split(/\n/)[0]; if (t) sec.emph = [{ text: t.split(/\s+/).slice(-1)[0], kind: KINDS[k++ % KINDS.length] }];
      }
      const r5 = await renderOne("v7-card", p5, "card");
      for (const tag of ["v7-localize", "v7-card"]) {
        const html = fs.readFileSync(path.join(OUT, tag, "page.html"), "utf8");
        must((html.match(/class="em em-/g) || []).length >= 4, `${tag} 강조 span 부족`);
        must(html.includes("SCDream"), `${tag} 에스코어드림 글꼴 없음`);
      }
      must(fs.readFileSync(path.join(OUT, "v7-localize", "page.html"), "utf8").includes("loc-block"), "v7 rewrite_ok 타이포 블록 없음");
    } else console.log("  (v7 샘플 사진 없음 — 건너뜀)");
  }
  // v8 신뢰·판매 실적 블록(샘플 전용 가짜 값) — commerce·ivory 두 테마, 블록 7종이 그려지는지
  {
    const p8 = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v8-trust.json"), "utf8"));
    if (fs.existsSync(p8.sections[0].image)) {
      for (const th of ["commerce", "ivory"]) {
        const r = await renderOne("v8-trust-" + th, { ...p8, meta: { ...p8.meta, templateId: th } }, th, { longText: true });
        const types = r.sections.map((x) => x.type);
        must(["trust_badges", "rnd_cost", "sold_out_banner", "rank_badge", "cert", "official_store", "review_stat"].every((t) => types.includes(t)), `v8 ${th} 신뢰 블록 누락: ${types.join(",")}`);
      }
      // localize 에서도 신뢰 블록·hero 배지
      const p6 = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v6-localize.json"), "utf8"));
      const claim = p8.sections.filter((x) => /^(sold_out_banner|rank_badge|trust_badges|rnd_cost|cert|official_store|review_stat)$/.test(x.type));
      p6.sections[0].badges = ["예시 배지 A", "예시 배지 B"];
      p6.sections.splice(1, 0, ...claim);
      const rl = await renderOne("v8-trust-localize", { ...p6, meta: { ...p6.meta, theme: "commerce" } }, "localize", { longText: true });
      must(claim.every((c) => rl.sections.some((x) => x.type === c.type)), `v8 localize 신뢰 블록 누락: ${rl.sections.map((x) => x.type).join(",")}`);
      must(fs.readFileSync(path.join(OUT, "v8-trust-localize", "page.html"), "utf8").includes("lh-badge"), "v8 localize hero 배지 없음");
      // A3 형식(plan-core.claimSections) 그대로도 그려지는지
      const a3 = [{ type: "sold_out_banner", text: "예시 7차 완판" }, { type: "rank_badge", text: "예시 카테고리 1위" }, { type: "trust_badges", items: ["예시 A", "예시 B", "예시 C"] },
        { type: "rnd_cost", text: "예시 개발비 ○억" }, { type: "cert", items: [{ name: "예시 인증", no: "" }] }, { type: "review_stat", count: "120", satisfaction: "98" }, { type: "official_store", text: "예시 공식 판매처" }];
      const p6b = JSON.parse(fs.readFileSync(path.join(FIX, "plan-v6-localize.json"), "utf8")); p6b.sections.splice(1, 0, ...a3);
      const ra3 = await renderOne("v8-trust-a3", { ...p6b, meta: { ...p6b.meta, theme: "commerce" } }, "localize", { longText: true });
      must(a3.every((c) => ra3.sections.some((x) => x.type === c.type)), `v8 A3 형식 신뢰 블록 누락: ${ra3.sections.map((x) => x.type).join(",")}`);
      // 데이터 없으면 생략
      const p8b = { ...p8, sections: p8.sections.map((x) => (/^(trust_badges|cert)$/.test(x.type) ? { type: x.type, items: [] } : x.type === "rnd_cost" ? { type: "rnd_cost" } : x)) };
      const r2 = await renderOne("v8-trust-empty", { ...p8b, meta: { ...p8b.meta, templateId: "commerce" } }, "commerce", { longText: true });
      must(!r2.sections.some((x) => /^(trust_badges|cert|rnd_cost)$/.test(x.type)), "v8 빈 신뢰 블록이 그려짐");
    }
  }
  // A3 파이프라인이 만든 plan-sample.json 이 있으면 그것도 렌더(이미지는 A2 fixture/img 의 자리표시 샘플, 없는 이미지는 건너뜀) — 통합 증거용
  if (fs.existsSync(path.join(FIX, "plan-sample.json")) && fs.existsSync(path.join(FIX, "img"))) {
    const p = JSON.parse(fs.readFileSync(path.join(FIX, "plan-sample.json"), "utf8"));
    await renderOne("pipeline-clean", p, "clean", { longText: true, imgDir: "img" });
  }
  // 세 템플릿이 서로 다른지(첫 슬라이스 픽셀 다름)
  const first = ["clean", "dark", "pop"].map((id) => fs.readFileSync(path.join(OUT, id, "01.jpg")));
  must(!first[0].equals(first[1]) && !first[1].equals(first[2]), "템플릿 3종 결과가 같음");

  console.log("\n미리보기:", [...TEMPLATES.map((t) => t.id), "v2-studio", "v3-editorial", "v5-card", "v6-localize", "v7-card", "v7-localize", "v8-trust-commerce"].map((id) => path.join(OUT, id, "preview.png")).join("\n           "));
  if (fails.length) { console.log("\nA4_FAIL"); for (const f of fails) console.log(" ✗", f); process.exitCode = 1; }
  else console.log("\nA4_OK");
  app.quit();
}).catch((e) => { console.error("하네스 오류", e); process.exitCode = 1; app.quit(); });
