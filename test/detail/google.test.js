// 내 구글 클라우드 연결(google-conn.js)·Gemini 구조화(gemini-text.js) 순수 부분 — `node --test test/detail/google.test.js`
import test from "node:test";
import assert from "node:assert/strict";
import { geminiSchema, openApiSchema, geminiModel, geminiCost } from "../../src/main/detail/gemini-text.js";
import { googleError, trialInfo, connFromSettings, setGoogleConn, googleConnected } from "../../src/main/detail/google-conn.js";

test("geminiSchema: 개수·길이 제약은 설명으로, enum·required 유지", () => {
  const s = geminiSchema({ $schema: "x", type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", maxItems: 16, description: "사진마다", items: { type: "object", properties: { t: { type: "string", maxLength: 20, enum: ["a", "b"] } } } } } });
  assert.equal(s.$schema, undefined);
  assert.equal(s.properties.items.maxItems, undefined);
  assert.equal(s.properties.items.description, "사진마다 (maxItems 16)");
  assert.deepEqual(s.properties.items.items.properties.t.enum, ["a", "b"]);
  assert.equal(s.properties.items.items.properties.t.maxLength, undefined);
  assert.deepEqual(s.required, ["items"]);
});

test("openApiSchema: additionalProperties 빼고 null 허용은 nullable", () => {
  const s = openApiSchema({ type: "object", additionalProperties: false, properties: { p: { type: ["string", "null"] }, n: { type: "integer", maximum: 5 } } });
  assert.equal(s.additionalProperties, undefined);
  assert.deepEqual(s.properties.p, { type: "string", nullable: true });
  assert.equal(s.properties.n.maximum, undefined);
});

test("모델 고르기·가격", () => {
  assert.equal(geminiModel("sonnet"), "gemini-3.1-pro-preview");
  assert.equal(geminiModel("haiku"), "gemini-2.5-flash");
  assert.equal(geminiModel("gemini-3.5-flash"), "gemini-3.5-flash");
  assert.ok(Math.abs(geminiCost("gemini-3.1-pro-preview", 1e6, 1e5) - 3.2) < 1e-9);
});

test("구글 오류 → 수강생 안내", () => {
  assert.match(googleError(403, "Cloud Vision API has not been used in project x before or it is disabled"), /Cloud Vision API 가 꺼져/);
  assert.match(googleError(403, "Vertex AI API has not been used"), /Vertex AI API 가 꺼져/);
  assert.match(googleError(403, "This API method requires billing to be enabled"), /무료 체험/);
  assert.match(googleError(400, "API key not valid. Please pass a valid API key."), /API 키가 맞지/);
  assert.match(googleError(429), /바빠요/);
});

test("무료 체험 남은 날(연결한 날 + 90일)", () => {
  const t0 = Date.parse("2026-10-01T00:00:00Z");
  assert.equal(trialInfo(t0, Date.parse("2026-10-23T00:00:00Z")).daysLeft, 68);
  assert.equal(trialInfo(t0, Date.parse("2027-01-15T00:00:00Z")).ended, true);
  assert.equal(trialInfo(null), null);
});

test("설정 → 연결", () => {
  assert.equal(connFromSettings({ kind: "apikey", apiKey: "AIzaXXXX", project: "p1" }).kind, "apikey");
  assert.equal(connFromSettings({ kind: "sa", credFile: "/없는/파일.json" }), null);
  setGoogleConn(connFromSettings({ kind: "apikey", apiKey: "AIzaXXXX", project: "p1" })); assert.equal(googleConnected(), true);
  setGoogleConn(null); assert.equal(googleConnected(), !!process.env.SEEDHACK_GOOGLE);
});
