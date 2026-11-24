// 🔗 "구글로 연결" OAuth 클라이언트 — 대표님이 구글 클라우드에서 만든 "데스크톱 앱" 클라이언트 ID·보안 비밀(docs/detail/GOOGLE-OAUTH-SETUP.md 4단계).
// 데스크톱 앱의 보안 비밀은 구글 설명대로 앱 안에 들어가도 되는 값이다(설치형 앱은 비밀을 지킬 수 없어 PKCE 로 보호). 비어 있으면 버튼은 "준비 중"으로 보인다.
// 값은 google-oauth-local.json(깃 제외, 설치 파일에는 포함)에 둔다 — 저장소가 공개라서 소스에 직접 적지 않는다. 환경 변수가 있으면 그게 우선.
import fs from "node:fs";
let local = {};
try { local = JSON.parse(fs.readFileSync(new URL("./google-oauth-local.json", import.meta.url), "utf8")); } catch {}
export const CLIENT_ID = process.env.SEEDHACK_GOOGLE_CLIENT_ID || local.client_id || "";
export const CLIENT_SECRET = process.env.SEEDHACK_GOOGLE_CLIENT_SECRET || local.client_secret || "";
