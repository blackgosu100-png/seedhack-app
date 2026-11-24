# "구글로 연결" 버튼 준비 — 대표님이 하실 일

수강생은 **[구글로 연결] → 구글 로그인 → (처음이면) 카드 등록**만 해요. 프로젝트 만들기·크레딧 연결·AI 켜기·시험은 앱이 자동으로 해요.
그러려면 대표님 구글 계정에 "씨드핵이 구글 로그인을 요청해도 된다"는 등록(OAuth 클라이언트)이 한 번 필요해요.

걸리는 시간: 1~4단계 약 20분 · 5단계(검증 신청)는 준비물이 모이면 30분, 구글 심사는 몇 주

---

## 1. 전용 프로젝트 만들기 (3분)

1. console.cloud.google.com → 위쪽 프로젝트 고르기 → **새 프로젝트**
2. 이름: `seedhack-login` → 만들기
3. 이 프로젝트를 고른 상태로 다음 단계를 해요(지금 AI 에 쓰는 프로젝트와 섞지 않기 위해서예요)

## 2. API 3개 켜기 (3분)

"API 및 서비스 → 라이브러리"에서 아래 셋을 검색해 **[사용]**을 눌러요.

1. Cloud Resource Manager API — 수강생 계정에 작업 공간(프로젝트) 만들기
2. Cloud Billing API — 무료 체험 확인·크레딧 연결
3. Service Usage API — 수강생 프로젝트에서 AI 기능 켜기

- 모두 무료 API 예요. 수강생 AI 사용료는 수강생 무료 체험에서 나가요.

## 3. 동의 화면 만들기 (7분)

"Google 인증 플랫폼(OAuth 동의 화면)"으로 가요.

1. **브랜딩**
   - 앱 이름 `씨드핵`
   - 지원 이메일: 대표님 메일
   - 로고: 120×120 PNG(검증 때 필요, 나중에 넣어도 됨)
   - 앱 홈페이지·개인정보처리방침 주소: 5단계 초안을 올린 주소(나중에 넣어도 됨)
2. **대상**: **외부** 고르기
3. **데이터 액세스 → 범위 추가**: 아래 세 개
   - `openid`
   - `.../auth/userinfo.email`
   - `https://www.googleapis.com/auth/cloud-platform` — 화면에 "민감" 표시가 붙어요
4. **게시 상태 → [앱 게시]** 를 눌러 **프로덕션**으로 바꿔요
   - 테스트 상태로 두면 수강생을 한 명씩 등록해야 하고, **7일마다 다시 로그인**해야 해요.
   - 프로덕션(검증 전)이면 수강생 화면에 **"확인되지 않은 앱"** 경고가 한 번 떠요. 앱 화면이 "고급 → 씨드핵(으)로 이동"을 누르라고 안내해요.
   - 검증 전에는 **앱 평생 100명**까지만 연결할 수 있어요. 베타는 이걸로 시작하고, 5단계 검증을 같이 신청해요.

## 4. 클라이언트 만들기 (2분)

1. "클라이언트 → **+ 클라이언트 만들기**"
2. 애플리케이션 유형: **데스크톱 앱** · 이름 `씨드핵 앱`
3. 만들어지면 **클라이언트 ID**와 **클라이언트 보안 비밀** 두 줄을 복사해 저에게 보내 주세요
   - 데스크톱 앱의 보안 비밀은 구글 설명대로 앱 안에 들어가도 되는 값이에요. 대신 PKCE 로 보호해요.
   - 제가 `src/main/detail/google-oauth-config.js` 에 넣고, 화면 업데이트로 수강생 앱에 보내요.

여기까지 하면 버튼이 켜져요. 그 전에는 앱에 **"구글로 연결 (준비 중)"**으로 보여요.

## 5. 구글 검증 신청 (100명을 넘기 전에)

준비물:

| 준비물 | 상태 |
|---|---|
| 앱 홈페이지 | 아래 초안 → `seedhack.noah-lap.cloud` 같은 대표님 도메인에 한 장 |
| 개인정보처리방침 | 아래 초안 → 같은 도메인에 한 장 |
| 도메인 소유 확인 | Google Search Console 에 그 도메인 등록. `*.vercel.app` 은 소유 확인이 안 돼요 |
| 시연 영상 | 유튜브 "일부 공개" 1~2분: 앱 [구글로 연결] → 동의 화면(주소창 client_id 보이게) → 앱이 프로젝트 만들고 AI 켜는 장면 → 상세페이지에서 AI 쓰는 장면 |
| 범위 사용 이유 | 아래 영문 초안 |

### 개인정보처리방침 초안 (요지)

- 씨드핵은 수강생이 [구글로 연결]을 누르면 구글 계정 이메일과 Google Cloud 권한(cloud-platform)을 받아요.
- 이 권한으로 하는 일은 네 가지뿐이에요.
  - 수강생 계정에 "SeedHack AI" 프로젝트를 만들어요.
  - 수강생 결제 계정(무료 체험)을 그 프로젝트에 연결해요.
  - Vertex AI·Cloud Vision 을 켜요.
  - 수강생이 요청한 상세페이지 이미지 번역·생성·글자 읽기를 그 프로젝트로 처리해요.
- 로그인 정보(새로 고침 토큰)는 수강생 PC 의 운영체제 보안 저장소에 암호화해 두고, 씨드핵 서버로 보내지 않아요.
- 수강생은 앱 [끊기] 또는 Google 계정 → 보안 → 타사 앱 액세스에서 언제든 권한을 지울 수 있어요.
- 문의: (대표님 메일)

### 범위 사용 이유 (영문 초안 — 신청서에 붙여 넣기)

> SeedHack is a desktop app for Korean e-commerce sellers. When the user clicks "Connect Google", the app uses the cloud-platform scope only to (1) create a dedicated project "SeedHack AI" in the user's own Google Cloud account, (2) link the user's own billing account (free trial) to it, (3) enable Vertex AI and Cloud Vision APIs on that project, and (4) call Vertex AI Gemini models and Cloud Vision on the user's behalf to translate and generate product detail page images the user requested. No narrower scope exists for Vertex AI or Service Usage. Tokens are stored only on the user's device (OS keychain / DPAPI) and are never sent to our servers.

---

## 대표님이 하시면 안 되는 것

- 수강생 대신 카드 등록·약관 동의를 하지 않아요. 수강생 본인 계정이에요.
- 클라이언트 보안 비밀 말고, 서비스 계정 키 파일 같은 다른 비밀은 앱에 넣지 않아요.

## 참고

- 근거: [Google OAuth 앱 대상·사용자 한도](https://support.google.com/cloud/answer/15549945) · [OAuth 범위 목록](https://developers.google.com/identity/protocols/oauth2/scopes) · [무료 체험 크레딧 범위](https://docs.cloud.google.com/free/docs/free-cloud-features)
- 확인 못 한 것:
  - cloud-platform 이 "민감" 인지 "제한" 인지는 공개 문서에 명시가 없어요. 동의 화면에 붙는 표시로 확인해야 해요. 제한이면 보안 평가(CASA)까지 필요해요.
  - 실제 구글 로그인·프로젝트 만들기는 대표님 클라이언트가 생긴 뒤 처음 시험할 수 있어요. 지금은 가짜 구글로 단계 전환·감지·오류 화면만 확인했어요.
