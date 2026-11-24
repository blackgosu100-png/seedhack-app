// 🔗 구글로 연결(google-oauth.js) — 가짜 구글로 단계 전환·무료 체험 감지·이어 하기·오류 안내 `node --test test/detail/google-oauth.test.js`
import test from "node:test";
import assert from "node:assert/strict";
import { runSetup, pkce, stepError, createMock, SCOPES } from "../../src/main/detail/google-oauth.js";

const fast = { sleep: () => new Promise((r) => setTimeout(r, 1)), billingPollMs: 1 };

test("PKCE: 검증값 43자 이상 · 도전값은 다른 값", () => {
  const p = pkce(); assert.ok(p.verifier.length >= 43); assert.notEqual(p.verifier, p.challenge);
  assert.ok(SCOPES.includes("https://www.googleapis.com/auth/cloud-platform"));
});

test("처음부터 끝까지: 로그인 → 카드 등록 대기(감지) → 프로젝트 → 크레딧 → AI 켜기 → 시험", async () => {
  process.env.SEEDHACK_GOOGLE_MOCK = "1";
  const steps = [], opened = [], saves = [];
  const r = await runSetup({ ...fast, openExternal: (u) => opened.push(u), onStep: (e) => steps.push(`${e.id}:${e.status}`), onSave: (s) => saves.push({ ...s }), test: async () => ({ text: { ok: true, msg: "" }, image: { ok: true, msg: "" }, ocr: { ok: true, msg: "" } }) });
  assert.equal(r.ok, true);
  assert.match(r.saved.projectId, /^seedhack-[0-9a-f]{6}$/);
  assert.equal(r.saved.linked, true); assert.equal(r.saved.enabled, true);
  assert.ok(steps.includes("billing:wait"), "결제 계정이 처음엔 없어 카드 등록 화면");
  assert.ok(opened.some((u) => /freetrial/.test(u)), "무료 체험 가입 화면을 연다");
  assert.deepEqual(steps.filter((s) => s.endsWith(":done")).map((s) => s.split(":")[0]), ["login", "billing", "project", "link", "enable", "test"]);
  assert.equal(saves.at(-1).email, "student@gmail.com");
});

test("이어 하기: 끝난 단계는 건너뛰고 실패한 곳부터", async () => {
  process.env.SEEDHACK_GOOGLE_MOCK = "1";
  const steps = [];
  const r = await runSetup({ ...fast, saved: { refreshToken: "rt", email: "a@gmail.com", billing: "billingAccounts/X", projectId: "seedhack-aaaaaa", linked: true }, onStep: (e) => steps.push(`${e.id}:${e.status}`), test: async () => null });
  assert.equal(r.ok, true);
  assert.ok(!steps.includes("project:now") && !steps.includes("link:now") && steps.includes("enable:now"));
});

test("오류: AI 켜기 실패 · 허용 안 누름 · 가입 안 함 → 멈춘 단계와 한 줄 안내", async () => {
  process.env.SEEDHACK_GOOGLE_MOCK = "fail-enable";
  let r = await runSetup({ ...fast, test: async () => null });
  assert.equal(r.ok, false); assert.equal(r.step, "enable"); assert.ok(r.help);
  process.env.SEEDHACK_GOOGLE_MOCK = "deny";
  r = await runSetup({ ...fast });
  assert.equal(r.step, "login"); assert.match(r.help, /허용/);
  process.env.SEEDHACK_GOOGLE_MOCK = "no-billing-forever";
  r = await runSetup({ ...fast, billingWaitMs: 30 });
  assert.equal(r.step, "billing"); assert.match(r.help, /무료 체험 가입/);
  delete process.env.SEEDHACK_GOOGLE_MOCK;
});

test("stepError: 누를 것 한 줄", () => {
  assert.match(stepError("project", 400, "Caller must accept the Terms of Service"), /약관/);
  assert.match(stepError("link", 403, "permission denied"), /권한/);
  assert.match(stepError("enable", 0, "fetch failed"), /인터넷/);
  assert.match(stepError("test", 429, ""), /1분 뒤/);
});

test("가짜 구글: 결제 계정은 세 번째 확인부터 생김(가입 감지 흉내)", async () => {
  const f = createMock("1");
  const n = async () => (await (await f("https://cloudbilling.googleapis.com/v1/billingAccounts")).json()).billingAccounts.length;
  assert.equal(await n(), 0); assert.equal(await n(), 0); assert.equal(await n(), 1);
});
