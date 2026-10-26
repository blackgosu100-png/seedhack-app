// 장면 생성 단위테스트 — planShots 형식, 키 없음 경로, Gemini 응답 처리(가짜 fetch) (node --test test/detail/scene.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planShots, pickPlace, pickFeatures, RULE_EN, RULE_KO } from "../../src/main/detail/scene-prompt.js";
import { generateScenes, resolveProvider } from "../../src/main/detail/scene.js";

// 이 맥에는 실제 gcloud 로그인 파일(~/.config/gcloud/…)이 있어 resolveProvider 가 Vertex 를 자동 선택한다 → 테스트는 빈 임시 HOME 을 쓴다
const NOHOME = { HOME: fs.mkdtempSync(path.join(os.tmpdir(), "scene-nohome-")) };
const PLANT = { title_ko: "블랙 계단식 접이식 화분 선반", category: "원예·화분 선반", attrs_ko: [{ k_ko: "재질", v_ko: "스틸 분체 도장" }, { k_ko: "내하중", v_ko: "단당 30kg" }], features: ["접이식", "녹 방지", "3단 계단 구조"] };

test("planShots: 6~8컷, 필수 필드, hero 첫 컷, 공통 규칙 포함", () => {
  const shots = planShots({ product: PLANT });
  assert.ok(shots.length >= 6 && shots.length <= 8, `컷 수 ${shots.length}`);
  assert.equal(shots[0].purpose, "hero");
  const ids = new Set();
  for (const s of shots) {
    assert.match(s.id, /^s\d{2}$/); ids.add(s.id);
    assert.ok(["hero", "point", "usage", "detail", "storage"].includes(s.purpose), s.purpose);
    assert.ok(s.title_ko && s.prompt_ko && s.prompt_en);
    assert.ok(s.prompt_en.includes(RULE_EN) && s.prompt_ko.includes(RULE_KO), "공통 규칙");
    assert.ok(/no text/i.test(s.prompt_en));
  }
  assert.equal(ids.size, shots.length);
  assert.ok(shots.some((s) => s.purpose === "usage") && shots.some((s) => s.purpose === "detail"));
  assert.ok(shots.filter((s) => s.purpose === "point").length >= 2);
  // 화분 선반 → 베란다, 접이식 → storage 컷, 녹 방지 → 물방울, 하중 → 무거운 물건, 계단 → 단마다
  assert.equal(pickPlace(PLANT).key, "plant");
  assert.ok(shots.some((s) => s.purpose === "storage" && /lean/i.test(s.prompt_en)));
  assert.ok(shots.some((s) => s.feature === "water" && /droplet/i.test(s.prompt_en)));
  assert.ok(shots.some((s) => s.feature === "load"));
  assert.ok(shots.every((s) => /veranda/i.test(s.prompt_en) || s.purpose === "detail" || s.purpose === "hero"));
});

test("planShots: 정보가 거의 없어도 6컷(대체 point), brief.place·avoid 반영", () => {
  const s = planShots({ product: {} });
  assert.ok(s.length >= 6 && s.length <= 8, `${s.length}`);
  assert.ok(s.filter((x) => x.purpose === "point").length >= 2);
  assert.ok(!s.some((x) => x.purpose === "storage"));
  const s2 = planShots({ product: { title_ko: "주방 양념통 선반" }, brief: { avoid: "사람 얼굴", avoid_en: "human faces" } });
  assert.equal(pickPlace({ title_ko: "주방 양념통 선반" }).key, "kitchen");
  assert.ok(s2.every((x) => x.prompt_en.endsWith("Avoid: human faces.")));
  const s3 = planShots({ product: PLANT, brief: { place: "원룸 창가", place_en: "a studio apartment window" } });
  assert.ok(s3.some((x) => x.prompt_en.includes("a studio apartment window")));
  assert.deepEqual(pickFeatures({ features: ["높이 조절", "공구 없이 조립", "통풍", "미끄럼 방지", "방수"] }, 4).map((f) => f.key), ["water", "adjust", "easy", "air"]);
});

test("키 없음 → 즉시 ok:false '이미지 생성 키 없음' (네트워크 호출 없음)", async () => {
  let called = 0;
  const shots = planShots({ product: PLANT }).slice(0, 3);
  const r = await generateScenes({ productImages: ["/nope.png"], shots, outDir: os.tmpdir(), env: NOHOME, settings: {}, fetchImpl: () => { called++; } });
  assert.equal(called, 0);
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => !x.ok && x.error === "이미지 생성 키 없음" && x.files.length === 0));
  assert.deepEqual(resolveProvider({ env: NOHOME }), { provider: "gemini", key: "", model: "gemini-2.5-flash-image" });
  // 임시 HOME 에 ADC(quota_project_id) 가 있으면 Vertex·프로젝트 자동 감지
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scene-adc-"));
  fs.mkdirSync(path.join(home, ".config", "gcloud"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "gcloud", "application_default_credentials.json"), JSON.stringify({ type: "authorized_user", quota_project_id: "auto-proj" }));
  const auto = resolveProvider({ env: { HOME: home } });
  assert.equal(auto.provider, "vertex"); assert.equal(auto.project, "auto-proj"); assert.equal(auto.key, "adc");
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(resolveProvider({ env: { ...NOHOME, OPENAI_API_KEY: "x" } }).provider, "openai");
  assert.equal(resolveProvider({ env: { ...NOHOME, GEMINI_API_KEY: "g" }, settings: { geminiImageModel: "m2" } }).model, "m2");
});

test("Gemini 경로(가짜 fetch): 요청 형식, 이미지 저장, 실패 컷은 ok:false, 401 이면 나머지 중단·키 숨김", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-test-"));
  const src = path.join(dir, "p.png"); fs.writeFileSync(src, Buffer.from([137, 80, 78, 71]));
  const png = Buffer.from("fakepng").toString("base64");
  const seen = [];
  let call = 0;
  const fetchImpl = async (url, init) => {
    seen.push({ url, init }); call++;
    if (call === 3) return { ok: true, text: async () => JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [{ text: "no" }] } }] }) };
    return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: png } }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1290 } }) };
  };
  const shots = planShots({ product: PLANT }).slice(0, 2);
  const prog = [], usage = [];
  const r = await generateScenes({ productImages: [src], shots, n: 2, outDir: path.join(dir, "out"), env: { GEMINI_API_KEY: "AIzaTESTKEY1234567890" }, fetchImpl, onProgress: (p) => prog.push(p), onUsage: (u) => usage.push(u) });
  assert.equal(seen.length, 4);
  assert.equal(usage.length, 3); // 받은 장만(IMAGE_SAFETY 1번은 빠짐)
  assert.deepEqual(usage[0], { provider: "gemini", model: "gemini-2.5-flash-image", inTok: 300, outTok: 1290 });
  assert.match(seen[0].url, /v1beta\/models\/gemini-2\.5-flash-image:generateContent$/);
  assert.equal(seen[0].init.headers["x-goog-api-key"], "AIzaTESTKEY1234567890");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.contents[0].parts[0].inline_data.mime_type, "image/png");
  assert.ok(body.contents[0].parts[1].text.includes("Vertical 4:5"));
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "4:5");
  assert.equal(r[0].files.length, 2); assert.equal(r[0].ok, true);
  assert.equal(fs.readFileSync(r[0].files[0], "utf8"), "fakepng");
  assert.equal(r[1].files.length, 1); assert.equal(r[1].ok, true); // 3번째 호출(IMAGE_SAFETY)만 빠짐
  assert.equal(prog.length, 4); assert.equal(prog.at(-1).done, 4);
  // 401 → 첫 컷에서 끝, 나머지는 같은 오류, 키는 오류 문구에 안 남음
  let c2 = 0;
  const bad = async () => { c2++; return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "API key not valid AIzaTESTKEY1234567890" } }) }; };
  const r2 = await generateScenes({ productImages: [src], shots: planShots({ product: PLANT }), n: 2, outDir: path.join(dir, "out2"), env: { GEMINI_API_KEY: "AIzaTESTKEY1234567890" }, fetchImpl: bad });
  assert.equal(c2, 1);
  assert.ok(r2.every((x) => !x.ok && /401/.test(x.error) && !x.error.includes("AIzaTESTKEY")));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- Vertex AI(Google Cloud $300 크레딧) — 가짜 fetch 만, 실제 호출 없음 ----
import crypto from "node:crypto";
import { getVertexToken, signServiceJwt, vertexUrl, clearVertexTokenCache } from "../../src/main/detail/scene.js";

test("Vertex: 공급자 선택·엔드포인트(global/지역)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-"));
  const cf = path.join(dir, "adc.json"); fs.writeFileSync(cf, "{}");
  const v = resolveProvider({ env: NOHOME, settings: { vertexProject: "my-proj", vertexCredentials: cf } });
  assert.equal(v.provider, "vertex"); assert.equal(v.key, "adc"); assert.equal(v.location, "global"); assert.equal(v.model, "gemini-2.5-flash-image");
  assert.equal(resolveProvider({ env: NOHOME, settings: { geminiKey: "g", vertexProject: "p" } }).provider, "gemini"); // geminiKey 우선
  assert.equal(resolveProvider({ env: NOHOME, settings: { geminiKey: "g", vertexProject: "p", imageProvider: "vertex", vertexCredentials: cf } }).provider, "vertex");
  assert.equal(resolveProvider({ env: { HOME: dir }, settings: { vertexProject: "p" } }).key, ""); // ADC 파일 없음
  assert.equal(vertexUrl({ project: "my-proj", location: "global", model: "m" }), "https://aiplatform.googleapis.com/v1/projects/my-proj/locations/global/publishers/google/models/m:generateContent");
  assert.equal(vertexUrl({ project: "p", location: "us-central1", model: "m" }), "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/m:generateContent");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Vertex: ADC refresh_token 교환 → Bearer 요청 형식(camelCase inlineData), 토큰 캐시, 401 중단·토큰 숨김", async () => {
  clearVertexTokenCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-"));
  const cf = path.join(dir, "adc.json");
  fs.writeFileSync(cf, JSON.stringify({ type: "authorized_user", client_id: "cid", client_secret: "csec", refresh_token: "1//REFRESHTOKENabcdef", quota_project_id: "quota-proj" }));
  const src = path.join(dir, "p.png"); fs.writeFileSync(src, Buffer.from([1, 2, 3]));
  const png = Buffer.from("vxpng").toString("base64");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return { ok: true, text: async () => JSON.stringify({ access_token: "ya29.ACCESSTOKENxyz123456", expires_in: 3599 }) };
    return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) };
  };
  const shots = planShots({ product: PLANT }).slice(0, 2);
  const r = await generateScenes({ productImages: [src], shots, n: 1, outDir: path.join(dir, "out"), env: NOHOME, settings: { imageProvider: "vertex", vertexCredentials: cf, vertexLocation: "us-central1" }, fetchImpl });
  const tok = seen.filter((x) => /oauth2/.test(x.url));
  assert.equal(tok.length, 1);
  const form = new URLSearchParams(tok[0].init.body);
  assert.equal(form.get("grant_type"), "refresh_token"); assert.equal(form.get("refresh_token"), "1//REFRESHTOKENabcdef"); assert.equal(form.get("client_id"), "cid");
  const gen = seen.filter((x) => /aiplatform/.test(x.url));
  assert.equal(gen.length, 2);
  assert.equal(gen[0].url, "https://us-central1-aiplatform.googleapis.com/v1/projects/quota-proj/locations/us-central1/publishers/google/models/gemini-2.5-flash-image:generateContent"); // 프로젝트 = quota_project_id
  assert.equal(gen[0].init.headers.Authorization, "Bearer ya29.ACCESSTOKENxyz123456");
  assert.equal(gen[0].init.headers["x-goog-api-key"], undefined);
  const body = JSON.parse(gen[0].init.body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, "image/png");
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "4:5");
  assert.ok(r.every((x) => x.ok && x.files.length === 1));
  // 두 번째 실행: 토큰 캐시(교환 다시 안 함), 생성 401 → 첫 컷에서 끝, 오류에 토큰 없음
  seen.length = 0;
  const bad = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "Request had invalid authentication credentials. Bearer ya29.ACCESSTOKENxyz123456" } }) }; };
  const r2 = await generateScenes({ productImages: [src], shots: planShots({ product: PLANT }), n: 2, outDir: path.join(dir, "out2"), env: NOHOME, settings: { imageProvider: "vertex", vertexCredentials: cf, vertexProject: "p2" }, fetchImpl: bad });
  assert.equal(seen.length, 1); assert.ok(!seen.some((x) => /oauth2/.test(x.url)));
  assert.match(seen[0].url, /aiplatform\.googleapis\.com\/v1\/projects\/p2\/locations\/global\//);
  assert.ok(r2.every((x) => !x.ok && /401/.test(x.error) && !x.error.includes("ya29.ACCESS")));
  // 토큰 교환 실패(400) → 전 컷 ok:false, refresh_token 노출 없음
  clearVertexTokenCache();
  const tokFail = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" }) });
  const r3 = await generateScenes({ productImages: [src], shots: shots, n: 1, outDir: path.join(dir, "out3"), env: NOHOME, settings: { imageProvider: "vertex", vertexCredentials: cf, vertexProject: "p" }, fetchImpl: tokFail });
  assert.ok(r3.every((x) => !x.ok && /토큰 발급 실패/.test(x.error) && !x.error.includes("REFRESHTOKEN")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Vertex: 서비스 계정 JWT(RS256) 서명·교환", async () => {
  clearVertexTokenCache();
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cred = { type: "service_account", project_id: "sa-proj", client_email: "bot@sa-proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), private_key_id: "kid1", token_uri: "https://oauth2.googleapis.com/token" };
  const jwt = signServiceJwt(cred, 1000);
  const [h, c, sig] = jwt.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.deepEqual(dec(h), { alg: "RS256", typ: "JWT", kid: "kid1" });
  assert.deepEqual(dec(c), { iss: cred.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: cred.token_uri, iat: 1000, exp: 4600 });
  assert.ok(crypto.createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64")), "서명 검증");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-"));
  const cf = path.join(dir, "sa.json"); fs.writeFileSync(cf, JSON.stringify(cred));
  let form = null;
  const t = await getVertexToken(cf, { fetchImpl: async (url, init) => { form = new URLSearchParams(init.body); return { ok: true, text: async () => JSON.stringify({ access_token: "ya29.SA", expires_in: 3600 }) }; } });
  assert.equal(t.token, "ya29.SA"); assert.equal(t.project, "sa-proj");
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(form.get("assertion").split(".").length, 3);
  await assert.rejects(getVertexToken(path.join(dir, "none.json"), { fetchImpl: async () => ({}) }), /gcloud auth application-default login/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("findFrameRect: 네 변 균일 흰 테두리만 액자로 보고 원래 화면비로 중앙 재크롭, 꽉 찬 사진·한쪽 여백은 null", async () => {
  const { findFrameRect, makeBitmap, fillRect } = await import("../../src/main/detail/image-core.js");
  // 400×500(4:5) 흰 바탕 안에 노이즈 사진(위 30·아래 40·좌 20·우 24 여백)
  const W = 400, H = 500;
  const bm = makeBitmap(W, H, [250, 250, 250]);
  let seed = 9; const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 30; y < H - 40; y++) for (let x = 20; x < W - 24; x++) { const i = (y * W + x) * 4; bm.data[i] = r() * 255; bm.data[i + 1] = r() * 255; bm.data[i + 2] = r() * 255; }
  const f = findFrameRect(bm);
  assert.ok(f, "액자를 찾아야 한다");
  assert.ok(f.x >= 22 && f.y >= 32 && f.x + f.w <= W - 26 && f.y + f.h <= H - 42, JSON.stringify(f)); // 테두리 안쪽
  assert.ok(Math.abs(f.w / f.h - W / H) < 0.01, `화면비 ${f.w / f.h}`);
  // 꽉 찬 사진 → null
  const full = makeBitmap(W, H, [0, 0, 0]);
  for (let i = 0; i < W * H; i++) { full.data[i * 4] = r() * 255; full.data[i * 4 + 1] = r() * 255; full.data[i * 4 + 2] = r() * 255; }
  assert.equal(findFrameRect(full), null);
  // 위쪽만 흰 하늘(한쪽 여백) → null
  const sky = makeBitmap(W, H, [0, 0, 0]);
  for (let i = 0; i < W * H; i++) { sky.data[i * 4] = r() * 255; sky.data[i * 4 + 1] = r() * 255; sky.data[i * 4 + 2] = r() * 255; }
  fillRect(sky, { x: 0, y: 0, w: W, h: 60 }, [255, 255, 255]);
  assert.equal(findFrameRect(sky), null);
  // 흰 제품 사진(배경이 전부 흰색, 가운데 작은 물체) → 테두리가 15% 를 넘어 액자 아님
  const prod = makeBitmap(W, H, [255, 255, 255]);
  fillRect(prod, { x: 150, y: 200, w: 100, h: 100 }, [20, 20, 20]);
  assert.equal(findFrameRect(prod), null);
});

test("429 는 쉬었다 다시 시도(retryDelays), 계속 429 면 그 컷만 실패", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-429-"));
  const src = path.join(dir, "p.png"); fs.writeFileSync(src, Buffer.from([1]));
  const png = Buffer.from("x").toString("base64");
  let call = 0;
  const fetchImpl = async () => { call++; if (call === 1 || call >= 3 && call <= 5) return { ok: false, status: 429, text: async () => JSON.stringify({ error: { message: "Resource has been exhausted" } }) };
    return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) }; };
  const shots = planShots({ product: PLANT }).slice(0, 2);
  const r = await generateScenes({ productImages: [src], shots, n: 1, outDir: dir, env: { GEMINI_API_KEY: "k" }, fetchImpl, retryDelays: [0, 0], postProcess: null });
  assert.equal(r[0].ok, true);             // 429 → 재시도 성공(호출 2번)
  assert.equal(r[1].ok, false); assert.match(r[1].error, /429/); // 429 3번(첫 시도+재시도 2번) → 실패
  assert.equal(call, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- v5 섹션별 장면 ----
test("planSectionShots: 타입별 화면비·장수·글자 여백, versatility 4컷, 공통 규칙·테두리 금지·styleGuide", async () => {
  const { planSectionShots, versatilityPlaces } = await import("../../src/main/detail/scene-prompt.js");
  const product = { title_ko: "슬라이딩 서랍 수납장", title_en: "white sliding-drawer storage cabinet", category: "주방 수납", features: ["설치 불필요", "하중 25kg"] };
  const sections = [
    { id: "hero", type: "hero", copy: { title: "커피머신 아래 빈 공간" } },
    { id: "ba", type: "before_after" },
    { id: "cp", type: "checkpoint" },
    { id: "f1", type: "feature", copy: { title: "부드러운 슬라이딩 서랍", sub: "당기면 쏙" }, needs: "서랍을 당기는 손" },
    { id: "op", type: "options" },
    { id: "dt", type: "detail" },
    { id: "vs", type: "versatility" },
    { id: "x", type: "unknown_kind", textZone: "left" },
  ];
  const shots = planSectionShots({ sections, product, styleGuide: { lighting: "soft morning light", forbiddenProductUsage: "no extra drawers" } });
  const by = Object.fromEntries(shots.map((s) => [s.id, s]));
  assert.equal(shots.length, 7 + 3 + 1 + 1); // versatility 4컷, detail 부품 2컷
  assert.equal(by.hero.aspect, "2:3"); assert.equal(by.hero.n, 2); assert.match(by.hero.prompt_en, /top 35% of the frame completely empty/); assert.match(by.hero.prompt_en, /spans about 70–80% of the frame width/);
  assert.equal(by.hero.fit, false);
  assert.match(by.ba.prompt_en, /LEFT half .*messy/); assert.match(by.ba.prompt_en, /camera at counter level/); assert.equal(by.ba.aspect, "4:3"); assert.equal(by.ba.n, 1);
  assert.match(by.cp.prompt_en, /three-quarter angle/);
  assert.equal(by.cp.fit, false);
  for (const id of ["ba", "cp", "f1", "op", "dt-1", "vs-1"]) { assert.equal(by[id].textZone, "none"); if (id !== "cp") assert.equal(by[id].fit, true); assert.match(by[id].prompt_en, /at least 60% of the image/); assert.doesNotMatch(by[id].prompt_en, /reserved for/); }
  assert.equal(by.f1.aspect, "4:3"); assert.match(by.f1.prompt_en, /hand pulling a drawer/);
  assert.match(by.op.prompt_en, /Two size variants/); assert.equal(by.op.aspect, "4:3");
  assert.equal(by["dt-1"].aspect, "1:1"); assert.match(by["dt-1"].prompt_en, /Extreme close-up macro of .* fills the frame/);
  assert.deepEqual(["vs-1", "vs-2", "vs-3", "vs-4"].map((id) => by[id].aspect), ["1:1", "1:1", "1:1", "1:1"]);
  assert.equal(new Set(["vs-1", "vs-2", "vs-3", "vs-4"].map((id) => by[id].prompt_en)).size, 4);
  assert.equal(versatilityPlaces(product)[0][0], "홈카페 조리대");
  assert.equal(by.x.type, "feature"); assert.equal(by.x.textZone, "none"); // hero 가 아니면 섹션 textZone 무시
  for (const s of shots) {
    assert.match(s.prompt_en, /No border, no frame/); assert.match(s.prompt_en, /No text, no letters/);
    assert.match(s.prompt_en, /soft morning light/); assert.match(s.prompt_en, /no extra drawers/);
    assert.match(s.prompt_en, /exact white sliding-drawer storage cabinet from the input photo/);
    assert.ok(s.sectionId && s.type && s.prompt_ko);
  }
});

test("generateSectionScenes: hero 만 sceneModelHero, 404 면 기본 모델로 대체, 컷별 aspect, 동시성", async () => {
  const { generateSectionScenes } = await import("../../src/main/detail/scene.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-v5-"));
  const src = path.join(dir, "p.png"); fs.writeFileSync(src, Buffer.from([1]));
  const png = Buffer.from("x").toString("base64");
  const calls = [];
  let inflight = 0, maxInflight = 0;
  const fetchImpl = async (url, init) => {
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 5));
    inflight--;
    const model = decodeURIComponent(url.match(/models\/([^:]+):/)[1]);
    calls.push({ model, aspect: JSON.parse(init.body).generationConfig.imageConfig.aspectRatio });
    if (model === "gemini-3-pro-image-preview") return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: "Publisher Model was not found", status: "NOT_FOUND" } }) };
    return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) };
  };
  const logs = [];
  const r = await generateSectionScenes({ sections: [{ id: "hero", type: "hero" }, { id: "d", type: "detail", shot: { parts: ["손잡이"] } }, { id: "f", type: "feature" }], product: { title_ko: "수납장" },
    productImages: [src], outDir: dir, env: { ...NOHOME, GEMINI_API_KEY: "k" }, settings: { sceneModelHero: "gemini-3-pro-image-preview" }, fetchImpl, postProcess: null, retryDelays: [], log: (_l, t) => logs.push(t), concurrency: 2 });
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => x.ok));
  assert.equal(r[0].files.length, 2); assert.equal(r[0].model, "gemini-2.5-flash-image"); assert.match(r[0].modelNote, /사용 불가/);
  assert.equal(r[0].aspect, "2:3"); assert.equal(r[1].aspect, "1:1"); assert.equal(r[2].aspect, "4:3");
  assert.equal(calls.filter((c) => c.model === "gemini-3-pro-image-preview").length, 1); // 한 번 확인 후 기억
  assert.deepEqual(new Set(calls.map((c) => c.aspect)), new Set(["2:3", "1:1", "4:3"]));
  assert.equal(maxInflight, 2);
  assert.ok(logs.some((t) => /→ gemini-2.5-flash-image/.test(t)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fitContentRect: 빈 가장자리 30% 넘으면 내용 둘레로 원래 비율 크롭, 이하면 그대로, 내용 30% 미만은 tooSmall", async () => {
  const { fitContentRect, makeBitmap, fillRect } = await import("../../src/main/detail/image-core.js");
  // 400×300(4:3), 아래 절반이 빈 상판(단색), 위 오른쪽에 물체 — round3 ba 같은 경우
  const bm = makeBitmap(400, 300, [230, 230, 228]);
  let seed = 3; const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < 150; y++) for (let x = 0; x < 400; x++) { const i = (y * 400 + x) * 4; bm.data[i] = 120 + r() * 100; bm.data[i + 1] = 120 + r() * 100; bm.data[i + 2] = 120 + r() * 100; }
  const f = fitContentRect(bm);
  // 가로로 꽉 찬 내용이 위 절반에만 → 비율을 맞추려면 제품을 잘라야 하므로 자르지 않고 재생성 권장
  assert.equal(f.rect, null); assert.ok(f.emptyFrac > 0.3); assert.equal(f.tooSmall, true); assert.equal(f.mode, "regen");
  // 왼쪽 위 구석에 몰린 물체(4:3) → 짧은 쪽을 늘려 비율 맞춤 크롭
  const corner = makeBitmap(400, 300, [235, 235, 235]);
  for (let y = 0; y < 150; y++) for (let x = 0; x < 200; x++) { const i = (y * 400 + x) * 4; corner.data[i] = r() * 255; corner.data[i + 1] = r() * 255; corner.data[i + 2] = r() * 255; }
  const c = fitContentRect(corner);
  assert.ok(c.rect && c.mode === "grow", JSON.stringify(c));
  assert.ok(Math.abs(c.rect.w / c.rect.h - 4 / 3) < 0.02, `비율 ${c.rect.w / c.rect.h}`);
  assert.equal(c.rect.x, 0); assert.equal(c.rect.y, 0); assert.ok(c.rect.w >= 200 && c.rect.w < 260, JSON.stringify(c.rect));
  assert.equal(c.tooSmall, false);
  // 꽉 찬 사진 → 그대로
  const full = makeBitmap(200, 200);
  for (let i = 0; i < 200 * 200; i++) { full.data[i * 4] = r() * 255; full.data[i * 4 + 1] = r() * 255; full.data[i * 4 + 2] = r() * 255; }
  assert.equal(fitContentRect(full).rect, null);
  // 가운데 작은 물체(내용 < 15%) → tooSmall
  const small = makeBitmap(400, 400, [240, 240, 240]);
  fillRect(small, { x: 170, y: 170, w: 60, h: 60 }, [20, 20, 20]);
  assert.equal(fitContentRect(small).tooSmall, true);
});

test("generateScenes: fit 컷의 내용이 너무 작으면(tooSmall) 1회만 다시 생성", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-fit-"));
  const src = path.join(dir, "p.png"); fs.writeFileSync(src, Buffer.from([1]));
  const png = Buffer.from("x").toString("base64");
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) }; };
  const shots = [{ id: "a", purpose: "point", prompt_en: "x", fit: true }, { id: "b", purpose: "hero", prompt_en: "y", fit: false }];
  const r = await generateScenes({ productImages: [src], shots, n: 1, outDir: dir, env: { ...NOHOME, GEMINI_API_KEY: "k" }, fetchImpl, retryDelays: [],
    postProcess: async () => ({ tooSmall: true, emptyFrac: 0.8 }) });
  assert.equal(calls, 3); // a: 생성+재생성 1회, b: fit 아님 → 재생성 없음
  assert.ok(r.every((x) => x.ok && x.files.length === 1));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Vertex 다지역: 429 면 대기 없이 다음 지역, 지역당 동시 2·라운드로빈, 모두 429 면 짧게 대기, 404 지역 제외, global 전용 모델", async () => {
  clearVertexTokenCache();
  const { createRegionRouter, DEFAULT_SCENE_REGIONS } = await import("../../src/main/detail/scene.js");
  assert.ok(DEFAULT_SCENE_REGIONS.includes("global") && DEFAULT_SCENE_REGIONS.includes("us-central1") && !DEFAULT_SCENE_REGIONS.includes("asia-northeast3"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vxrr-"));
  const cf = path.join(dir, "adc.json");
  fs.writeFileSync(cf, JSON.stringify({ type: "authorized_user", client_id: "c", client_secret: "s", refresh_token: "1//R", quota_project_id: "qp" }));
  const src = path.join(dir, "p.png"); fs.writeFileSync(src, Buffer.from([1]));
  const ok = { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "eA==" } }] } }] }) };
  const e429 = { ok: false, status: 429, text: async () => JSON.stringify({ error: { message: "Resource has been exhausted" } }) };
  const regionOf = (u) => (u.match(/locations\/([^/]+)\//) || [])[1];
  const tok = { ok: true, text: async () => JSON.stringify({ access_token: "ya29.T", expires_in: 3600 }) };
  const shots = (k) => Array.from({ length: k }, (_, i) => ({ id: `s${i}`, purpose: "point", prompt_en: "x" }));
  const base = { productImages: [src], n: 1, outDir: dir, env: NOHOME, settings: { imageProvider: "vertex", vertexCredentials: cf }, postProcess: null };
  // (a) global 은 항상 429 → 다른 지역으로 즉시, 대기(sleep) 없음
  let slept = 0; const calls = [];
  const r1 = await generateScenes({ ...base, shots: shots(4), concurrency: 4, regions: ["global", "us-central1", "us-east1"], sleep: async () => { slept++; },
    fetchImpl: async (u) => { if (/oauth2/.test(u)) return tok; calls.push(regionOf(u)); await new Promise((r) => setTimeout(r, 5)); return regionOf(u) === "global" ? e429 : ok; } });
  assert.ok(r1.every((x) => x.ok && x.region !== "global"), JSON.stringify(r1.map((x) => x.region)));
  const g = calls.filter((c) => c === "global").length;
  assert.ok(g >= 1 && g <= 2, `global ${g}`); // 처음 동시에 들어간 2개(지역당 2)만 429, 그 뒤엔 쉬는 중이라 다시 안 감
  assert.equal(r1.stats.total429, g); assert.equal(slept, 0);
  assert.equal(r1.stats.regions["us-central1"].ok + r1.stats.regions["us-east1"].ok, 4);
  // (b) 지역당 동시 2: 2지역·동시 6 이면 한 번에 최대 4
  let inflight = 0, max = 0;
  await generateScenes({ ...base, shots: shots(8), concurrency: 6, regions: ["global", "us-central1"],
    fetchImpl: async (u) => { if (/oauth2/.test(u)) return tok; inflight++; max = Math.max(max, inflight); await new Promise((r) => setTimeout(r, 10)); inflight--; return ok; } });
  assert.equal(max, 4);
  // (c) 모든 지역 429 → 쉬는 시간까지 기다렸다가 성공
  let n = 0; slept = 0;
  const r3 = await generateScenes({ ...base, shots: shots(1), regions: ["global", "us-central1"], regionCooldownMs: 30, sleep: async (ms) => { slept++; await new Promise((r) => setTimeout(r, ms)); },
    fetchImpl: async (u) => { if (/oauth2/.test(u)) return tok; n++; return n <= 2 ? e429 : ok; } });
  assert.ok(r3[0].ok); assert.ok(slept >= 1); assert.equal(r3.stats.total429, 2);
  // (d) 404 지역은 빼고, global 전용 모델(gemini-3*)은 global 로만
  const seen = [];
  const r4 = await generateScenes({ ...base, shots: [{ id: "h", purpose: "hero", prompt_en: "x", model: "gemini-3-pro-image" }, { id: "p", purpose: "point", prompt_en: "y" }, { id: "q", purpose: "point", prompt_en: "z" }], regions: ["us-central1", "global", "us-east1"],
    fetchImpl: async (u) => { if (/oauth2/.test(u)) return tok; const r = regionOf(u), m = u.match(/models\/([^:]+):/)[1]; seen.push(`${m}@${r}`); return r === "us-east1" ? { ok: false, status: 404, text: async () => JSON.stringify({ error: { status: "NOT_FOUND" } }) } : ok; } });
  assert.ok(r4.every((x) => x.ok));
  assert.equal(r4[0].region, "global"); assert.equal(r4[0].model, "gemini-3-pro-image");
  assert.ok(!seen.some((x) => x.startsWith("gemini-3-pro-image@") && !x.endsWith("@global")));
  assert.ok(seen.filter((x) => x.endsWith("@us-east1")).length <= 1, "404 지역은 한 번만");
  // 라우터 단위: 라운드로빈으로 고르게
  const rt = createRegionRouter({ regions: ["a", "b", "c"], perRegion: 1 });
  const got = [await rt.acquire("m"), await rt.acquire("m"), await rt.acquire("m")];
  assert.deepEqual(got.sort(), ["a", "b", "c"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("v5 보완: versatility 는 섹션 장소(shot.places / needs)마다 다른 배경·소품, detail 은 부품마다 극클로즈업, before_after 4:3·hero 외 글자 여백 무시", async () => {
  const { planSectionShots, placeScene, sectionPlaces, sectionParts } = await import("../../src/main/detail/scene-prompt.js");
  const product = { title_ko: "슬라이딩 서랍 수납장", category: "주방 수납", features: ["둥근 손잡이", "높은 가드레일", "미끄럼 방지 매트"] };
  const secs = [
    { id: "vs", type: "versatility", shot: { needs: "활용 장소 4곳: 홈카페 / 사무실 탕비실 / 데스크 / 바 카운터", textZone: "top" } },
    { id: "v2", type: "versatility", shot: { places: ["욕실", "침실"] } },
    { id: "dt", type: "detail", shot: { needs: "소재 마감·부품 매크로", textZone: "bottom" } },
    { id: "d2", type: "detail", shot: { parts: ["패드", "도장면", "모서리"] } },
    { id: "ba", type: "before_after", shot: { textZone: "bottom" } },
    { id: "h", type: "hero", shot: { textZone: "left" } },
  ];
  const sh = planSectionShots({ sections: secs, product });
  const by = Object.fromEntries(sh.map((s) => [s.id, s]));
  assert.deepEqual(sectionPlaces(secs[0], product), ["홈카페", "사무실 탕비실", "데스크", "바 카운터"]);
  assert.match(by["vs-1"].prompt_en, /unbranded generic white coffee machine/); assert.match(by["vs-2"].prompt_en, /paper cups/); assert.match(by["vs-3"].prompt_en, /monitor/); assert.match(by["vs-4"].prompt_en, /cocktail shaker/);
  assert.ok(sh.filter((s) => s.sectionId === "vs").every((s) => /not a generic kitchen/.test(s.prompt_en) && s.textZone === "none"));
  assert.deepEqual(["v2-1", "v2-2"].map((id) => by[id].title_ko), ["욕실", "침실"]); assert.match(by["v2-1"].prompt_en, /bathroom vanity/); assert.match(by["v2-2"].prompt_en, /nightstand/);
  assert.equal(placeScene("캠핑장").en.includes("campsite"), true); assert.match(placeScene("우주정거장").en, /우주정거장/);
  // detail: 제품 글의 부품(손잡이·레일·패드) 중 2개, parts 가 있으면 그것(최대 3)
  assert.deepEqual(sectionParts(secs[2], product).map((p) => p.en), ["the handle", "the guard rail"]);
  assert.deepEqual(["dt-1", "dt-2"].map((id) => by[id].title_ko), ["손잡이", "레일"]);
  assert.match(by["dt-1"].prompt_en, /Extreme close-up macro of the handle .* fills the frame/); assert.equal(by["dt-1"].textZone, "none");
  assert.deepEqual(["d2-1", "d2-2", "d2-3"].map((id) => by[id].prompt_en.match(/macro of (the [a-z -]+?) of/)[1]), ["the non-slip pad on the bottom", "the powder-coated surface finish", "the rounded edge"]);
  // before_after: 4:3, 오른쪽 절반의 60% 이상, 글자 여백 문장 없음
  assert.equal(by.ba.aspect, "4:3"); assert.equal(by.ba.textZone, "none"); assert.match(by.ba.prompt_en, /at least 80% of the right half/); assert.doesNotMatch(by.ba.prompt_en, /reserved for/);
  // hero 는 섹션 textZone 을 따른다
  assert.equal(by.h.textZone, "left"); assert.match(by.h.prompt_en, /left 35%/);
});

test("장면 입력: 다른 브랜드·잘린 사진 제외, 누끼 → 제품 단독 → 그 외 / 공통 규칙에 브랜드 가전 금지·제품 주인공 / 가전은 무브랜드 일반 기계", async () => {
  const { pickSceneInputs } = await import("../../src/main/detail/scene.js");
  const { planSectionShots, placeScene, GENERIC_APPLIANCE_EN } = await import("../../src/main/detail/scene-prompt.js");
  const vision = { items: [
    { id: "g01", subject: "product_in_scene", product_visible: "partial", other_brand_prominent: true, score: 4 },
    { id: "g02", subject: "other", product_visible: "partial", other_brand_prominent: true, score: 2 },
    { id: "g03", subject: "product_in_scene", product_visible: "full", other_brand_prominent: true, score: 4 },
    { id: "g05", subject: "product", product_only: true, product_visible: "full", other_brand_prominent: false, score: 5 },
    { id: "d01", subject: "product_in_scene", product_visible: "full", other_brand_prominent: false, score: 3 },
    { id: "d05", subject: "product_in_scene", product_visible: "full", other_brand_prominent: false, score: 4 },
  ] };
  const c = ["clean/g02_cut.png", "clean/g05_cut.png", "raw/g01.jpg", "raw/g03.jpg", "raw/d01.jpg", "raw/d05.jpg", "raw/g05.jpg"].map((file) => ({ file }));
  assert.deepEqual(pickSceneInputs(c, vision, { max: 3 }), ["clean/g05_cut.png", "raw/g05.jpg", "raw/d05.jpg"]); // g02 누끼(다른 브랜드·일부)·g01·g03 제외
  assert.deepEqual(pickSceneInputs([{ file: "raw/g01.jpg" }], vision), []);
  assert.deepEqual(pickSceneInputs([{ file: "x/p9.png" }], vision), ["x/p9.png"]); // vision 에 없는 사진은 그대로
  const sh = planSectionShots({ sections: [{ id: "h", type: "hero" }, { id: "v", type: "versatility", shot: { places: ["홈카페", "사무실 탕비실", "주방"] } }], product: { title_ko: "수납장" } });
  for (const s of sh) {
    assert.match(s.prompt_en, /No other branded appliances or products \(no water purifiers, coffee machines, microwaves/);
    assert.match(s.prompt_en, /clear main subject, fully visible and uncropped, occupying the largest area of the frame/);
    assert.match(s.prompt_ko, /다른 브랜드 가전/);
  }
  assert.ok(placeScene("홈카페").en.includes(GENERIC_APPLIANCE_EN));
  assert.doesNotMatch(placeScene("사무실 탕비실").en, /: a water dispenser|and a microwave/);
  assert.doesNotMatch(placeScene("주방").en, /toaster/);
});
