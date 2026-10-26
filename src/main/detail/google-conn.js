// "내 구글 클라우드 연결" — 수강생이 자기 구글 클라우드 무료 체험(90일 $300 크레딧) 프로젝트를 앱에 연결해 Vertex AI(Gemini 글·이미지)·Cloud Vision(OCR)을 직접 부른다.
// 연결 방법 두 가지(docs/detail/GOOGLE-TRIAL-GUIDE.md):
//   apikey — 구글 클라우드 "API 키"(Vertex AI API·Cloud Vision API 로 제한) + 프로젝트 ID. 붙여 넣기만 하면 됨(기본)
//   sa     — 서비스 계정 키 JSON 파일을 끌어다 놓기(API 키를 못 만들 때 차선책)
// $300 크레딧은 Vertex AI·Vision 에는 쓰이고 AI Studio(Gemini API) 키에는 안 쓰인다(구글 공지) → AI Studio 키는 받지 않는다.
// OAuth "구글로 연결" 버튼은 검증 전 앱이 평생 100명·7일 만료 제한이라 지금은 쓰지 않는다(문서 참고).
// 개발: SEEDHACK_GOOGLE=adc 면 대표님 gcloud ADC 로(비교 시험용). 키는 로그·결과 파일에 남기지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let conn = null; // { kind, apiKey?, credFile?, project, connectedAt? }
export function setGoogleConn(c) { conn = c && (c.apiKey || c.credFile) ? { ...c } : null; }
export function googleConn() {
  if (conn) return conn;
  if (process.env.SEEDHACK_GOOGLE === "adc") {
    const f = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
    let project = process.env.GOOGLE_CLOUD_PROJECT || "";
    try { const j = JSON.parse(fs.readFileSync(f, "utf8")); project ||= j.quota_project_id || j.project_id || ""; } catch { return null; }
    return { kind: "sa", credFile: f, project, dev: true };
  }
  return null;
}
export const googleConnected = () => !!googleConn();

// 설정(store settings.google) → 연결. 서비스 계정 파일은 <userData>/detail/google-sa.json 에 복사해 둔 것을 쓴다
export function connFromSettings(g = {}) {
  if (!g || typeof g !== "object") return null;
  if (g.kind === "apikey" && g.apiKey) return { kind: "apikey", apiKey: String(g.apiKey), project: String(g.project || ""), connectedAt: g.connectedAt || null };
  if (g.kind === "sa" && g.credFile && fs.existsSync(g.credFile)) return { kind: "sa", credFile: g.credFile, project: String(g.project || ""), connectedAt: g.connectedAt || null };
  return null;
}

// 인증 머리글·주소. → { headers, url(model, loc, method) }
export async function googleAuth({ fetchImpl = globalThis.fetch } = {}) {
  const c = googleConn();
  if (!c) throw new Error("구글 클라우드가 연결되어 있지 않아요");
  if (c.kind === "apikey") {
    return {
      project: c.project, kind: "apikey",
      headers: { "Content-Type": "application/json", "x-goog-api-key": c.apiKey },
      vertexUrl: (model, loc = "global", method = "generateContent") => c.project ? vertexPath(c.project, loc, model, method) : `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:${method}`,
      visionUrl: "https://vision.googleapis.com/v1/images:annotate",
    };
  }
  const { getVertexToken } = await import("./scene.js");
  const t = await getVertexToken(c.credFile, { fetchImpl });
  const project = c.project || t.project;
  if (!project) throw new Error("구글 프로젝트 ID 가 없어요");
  let user = false; try { user = JSON.parse(fs.readFileSync(c.credFile, "utf8")).type === "authorized_user"; } catch {}
  return {
    project, kind: "token",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.token}`, ...(user ? { "x-goog-user-project": project } : {}) },
    vertexUrl: (model, loc = "global", method = "generateContent") => vertexPath(project, loc, model, method),
    visionUrl: "https://vision.googleapis.com/v1/images:annotate",
  };
}
function vertexPath(project, loc, model, method) {
  const host = loc === "global" ? "aiplatform.googleapis.com" : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${loc}/publishers/google/models/${encodeURIComponent(model)}:${method}`;
}

// 구글 오류 → 수강생용 한국어
export function googleError(status, msg = "") {
  const m = String(msg || "");
  if (status === 403 && /has not been used|SERVICE_DISABLED|is disabled/i.test(m)) {
    const api = /vision/i.test(m) ? "Cloud Vision API" : "Vertex AI API";
    return `${api} 가 꺼져 있어요. 안내 문서 3단계에서 "사용"을 눌러 주세요.`;
  }
  if (status === 403 && /billing/i.test(m)) return "구글 결제 계정(무료 체험)이 연결되지 않았어요. 구글 클라우드에서 무료 체험을 시작해 주세요.";
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(m)) return "API 키가 맞지 않아요. 키를 다시 복사해 붙여 넣어 주세요.";
  if (status === 401 || status === 403) return "구글 연결 권한이 없어요. 키를 만든 프로젝트와 프로젝트 ID 가 같은지 확인해 주세요.";
  if (status === 404) return "이 프로젝트에서 쓸 수 없는 AI 모델이에요.";
  if (status === 429) return "구글 AI 가 잠시 바빠요(분당 한도). 잠시 뒤 다시 해 주세요.";
  return `구글 AI 오류(${status || "연결"})`;
}

// 무료 체험 끝나는 날(연결한 날 + 90일, 추정) — 실제 남은 크레딧은 구글 결제 화면에서만 보인다(공개 API 없음)
export function trialInfo(connectedAt, now = Date.now()) {
  if (!connectedAt) return null;
  const end = connectedAt + 90 * 86400e3, days = Math.ceil((end - now) / 86400e3);
  return { end, daysLeft: days, ended: days <= 0 };
}
