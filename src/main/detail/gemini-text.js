// Claude 대신 Gemini(Vertex AI)로 구조화 출력 — cli.js runStructured 와 같은 인자·같은 반환({ ok, result, model, usage, costUsd } | { error }).
// 수강생 구글 연결(google-conn.js)로 부르므로 무료 체험 크레딧이 쓰인다. 사진(Read 도구 대상)은 입력 글 속 경로를 찾아 메시지에 붙인다(relay.js 와 같은 방식).
// 모델: sonnet·opus → gemini-3.1-pro-preview, haiku → gemini-2.5-flash (2026-10-23: 신규 프로젝트는 gemini-2.5-pro 404). SEEDHACK_GEMINI_PRO / SEEDHACK_GEMINI_FLASH 로 바꿈
import { googleAuth, googleError } from "./google-conn.js";
import { findImagePaths, prepImage } from "./relay.js";

const noop = () => {};
export function geminiModel(alias) {
  const a = String(alias || "sonnet").toLowerCase();
  if (/^gemini-/.test(a)) return a;
  return /haiku/.test(a) ? process.env.SEEDHACK_GEMINI_FLASH || "gemini-2.5-flash" : process.env.SEEDHACK_GEMINI_PRO || "gemini-3.1-pro-preview";
}
// 달러/100만 토큰(Vertex 표준, 20만 토큰 이하) — 생각(thinking) 토큰은 출력값으로 청구
const PRICE = [[/3(\.\d+)?-pro/, 2, 12], [/3\.5-flash/, 1.5, 9], [/3(\.\d+)?-flash/, 0.5, 3], [/2\.5-pro/, 1.25, 10], [/2\.5-flash-lite/, 0.1, 0.4], [/2\.5-flash/, 0.3, 2.5]];
export function geminiCost(model, inTok, outTok) {
  const p = PRICE.find(([re]) => re.test(model)) || [null, 2, 12];
  return (inTok * p[1] + outTok * p[2]) / 1e6;
}

// JSON Schema → Gemini responseJsonSchema. 개수·길이·범위 제약은 설명 글로 옮긴다
// (2026-10-23 실측: 복잡한 항목 배열에 maxItems 가 붙으면 Vertex 가 "invalid argument" 400 — 사진 검수 스키마)
const MOVE = ["maxItems", "minItems", "maxLength", "minLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "uniqueItems"];
export function geminiSchema(s, depth = 0) {
  if (!s || typeof s !== "object" || depth > 14) return s;
  if (Array.isArray(s)) return s.map((x) => geminiSchema(x, depth + 1));
  const out = {}, moved = [];
  for (const [k, v] of Object.entries(s)) {
    if (["$schema", "default", "examples", "$comment"].includes(k)) continue;
    if (MOVE.includes(k) && typeof v !== "object") { moved.push(`${k} ${v}`); continue; }
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v || {}).map(([pk, pv]) => [pk, geminiSchema(pv, depth + 1)])) : typeof v === "object" ? geminiSchema(v, depth + 1) : v;
  }
  if (moved.length) out.description = [out.description, `(${moved.join(", ")})`].filter(Boolean).join(" ");
  return out;
}
// 차선: OpenAPI 형 responseSchema(additionalProperties 없음, ["x","null"] → nullable)
export function openApiSchema(s, depth = 0) {
  if (!s || typeof s !== "object" || depth > 14) return s;
  const { additionalProperties: _a, $schema: _s, default: _d, examples: _e, type, properties, items, anyOf, oneOf, ...rest0 } = s;
  const rest = Object.fromEntries(Object.entries(rest0).filter(([k]) => !MOVE.includes(k)));
  const out = { ...rest };
  if (Array.isArray(type)) { const t = type.filter((x) => x !== "null"); out.type = t[0] || "string"; if (type.includes("null")) out.nullable = true; }
  else if (type) out.type = type;
  if (properties) out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, openApiSchema(v, depth + 1)]));
  if (items) out.items = openApiSchema(items, depth + 1);
  if (anyOf || oneOf) out.anyOf = (anyOf || oneOf).map((v) => openApiSchema(v, depth + 1));
  return out;
}

const READ_NOTE = "\n\n[이 환경 안내] Read 도구는 없습니다. 입력 글에 적힌 사진 파일은 모두 이 메시지에 첨부되어 있고, 각 사진 바로 앞 줄에 그 파일 경로가 적혀 있습니다. 첨부된 사진을 직접 보고 판정하세요(열어 본 것으로 칩니다).";
const REGIONS = ["global", "us-central1", "us-east4", "europe-west4"];

export async function geminiStructured({ system, schema, text, model = "sonnet", timeoutMs = 300000, allowedTools = null, log = noop, fetchImpl = globalThis.fetch } = {}) {
  if (!system || !schema) return { error: "지시문(system)과 스키마(schema)가 필요합니다" };
  const t0 = Date.now(), m = geminiModel(model);
  const wantRead = Array.isArray(allowedTools) && allowedTools.includes("Read");
  const parts = [];
  if (wantRead) for (const f of findImagePaths(text).slice(0, 40)) { try { const p = await prepImage(f, { maxSide: 1536, quality: 85 }); parts.push({ text: `파일: ${f}` }, { inlineData: { mimeType: p.mime, data: p.b64 } }); } catch {} }
  parts.push({ text: String(text ?? "") || "(입력 없음)" });
  let auth;
  try { auth = await googleAuth({ fetchImpl }); } catch (e) { return { error: String(e?.message || e) }; }
  // 개수·길이 제약은 스키마에서 설명 글로 옮겼으므로(geminiSchema) 지시문에서 한 번 더 못 박는다 — 넘친 글을 앱이 잘라 "1초 특허받"처럼 끊기던 것(2026-10-23 비교)
  const LIMIT_NOTE = "\n\n[형식 지키기] 응답 형식 설명의 괄호 속 제한(maxLength 글자 수 · maxItems 개수)은 반드시 지킵니다. 넘치면 문장이 잘려 상세페이지에 그대로 실립니다. 제한 안에서 끝나는 완결된 말로 씁니다.";
  const base = { systemInstruction: { parts: [{ text: (wantRead ? system + READ_NOTE : system) + LIMIT_NOTE }] }, contents: [{ role: "user", parts }] };
  const cfg = (useJson) => ({ responseMimeType: "application/json", maxOutputTokens: /pro/.test(m) ? 65535 : 32768, ...(useJson ? { responseJsonSchema: geminiSchema(schema) } : { responseSchema: openApiSchema(schema) }) });
  let useJson = true, last = null, inTok = 0, outTok = 0;
  for (let a = 0; a < 6; a++) {
    if (Date.now() - t0 > timeoutMs) break;
    const loc = /^gemini-3/.test(m) ? "global" : REGIONS[a % REGIONS.length];
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), Math.max(20000, timeoutMs - (Date.now() - t0)));
    let r, j;
    try { r = await fetchImpl(auth.vertexUrl(m, loc), { method: "POST", headers: auth.headers, body: JSON.stringify({ ...base, generationConfig: cfg(useJson) }), signal: ac.signal }); j = await r.json().catch(() => ({})); }
    catch (e) { last = e?.name === "AbortError" ? "구글 AI 응답 시간 초과" : `구글 AI 연결 실패: ${String(e?.message || e).slice(0, 80)}`; continue; }
    finally { clearTimeout(tm); }
    const um = j?.usageMetadata || {};
    inTok += Number(um.promptTokenCount) || 0; outTok += (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0);
    if (r.status === 400 && useJson && /responseJsonSchema|json_schema|schema/i.test(j?.error?.message || "")) { useJson = false; log("dim", "  ✨ Gemini: responseJsonSchema 거절 → responseSchema 로 다시"); continue; }
    if (r.status === 429 || r.status >= 500) { last = googleError(r.status, j?.error?.message); await new Promise((q) => setTimeout(q, [3000, 8000, 15000, 25000, 30000, 30000][a])); continue; }
    if (!r.ok) { log("dim", `  ✨ Gemini ${r.status}: ${String(j?.error?.message || "").slice(0, 300)}`); return { error: googleError(r.status, j?.error?.message), detail: String(j?.error?.message || "").slice(0, 300), status: r.status, costUsd: geminiCost(m, inTok, outTok) }; }
    const cand = j?.candidates?.[0];
    const txt = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    let result = null;
    try { result = JSON.parse(txt); } catch { try { result = JSON.parse(String(txt).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch {} }
    if (result && typeof result === "object") return { ok: true, result, model: `gemini:${m}`, usage: { input_tokens: inTok, output_tokens: outTok }, costUsd: geminiCost(m, inTok, outTok), elapsedMs: Date.now() - t0 };
    last = `Gemini 응답을 해석하지 못함(${cand?.finishReason || "?"})`;
    log("dim", `  ✨ ${last} → 다시`);
  }
  return { error: last || "구글 AI 실패", costUsd: geminiCost(m, inTok, outTok) };
}
