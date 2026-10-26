# 수강생 윈도우 PC 에서 📄 상세페이지 · 🖼 썸네일 (서버 중계)

대표님 맥은 지금처럼 이 PC 의 도구를 씁니다(Claude CLI · gcloud Vertex · macOS Vision).
수강생 PC(윈도우)는 같은 일을 대시보드 서버가 대표님 키로 대신 합니다. 수강생은 설치만 하면 됩니다.

## 무엇이 어디서 도나

| 일 | 대표님 맥 | 수강생 윈도우 |
|---|---|---|
| Claude(사진 검수·기획·카피·번역·검수) | Claude CLI | 서버 `task:"claude"` → Claude API |
| 이미지 생성 · AI 글자 지우기 | gcloud ADC → Vertex | 서버 `task:"image"` → Vertex(서비스 계정) |
| 중국어 OCR | macOS Vision | 서버 `task:"ocr"` → Google Cloud Vision |
| 누끼 | macOS Vision | 앱 안 ONNX(U²-Net), 모델은 처음 한 번 내려받음 |

- 고르는 곳: `src/main/detail/relay.js`(서버 호출·안내 글) · `cli.js` · `scene.js` · `ocr.js` · `cutout.js`
- 서버 코드·설정: 대시보드 저장소 `web/src/lib/signal-relay.mjs`, `web/SIGNAL_RELAY_SETUP.md`

## 한도와 안내

- 1인 하루: 상세페이지 3개 · $12 · 호출 800번(원본 한글화 1개 ≈ $3, 2026-10-23 실측) (한국 시간 0시에 다시 채워짐, 서버 환경변수로 바꿈)
- 전체 하루: $50. 넘으면 모두 멈춤
- 이미 시작한 상세페이지는 한도 개수를 넘어도 끝까지 만든다(금액 한도는 그대로)
- 한도·로그인·Wing 문제는 한 번 겪으면 그 실행에서 다시 부르지 않는다
- 결과 화면 맨 위 줄에 ⚠ 안내가 뜬다. 예: "오늘 만들 수 있는 상세페이지 3개를 다 만들었어요. 내일(한국 시간 0시) 다시 만들 수 있어요."

## 시험용 스위치(개발 PC)

| 환경변수 | 뜻 |
|---|---|
| `SEEDHACK_RELAY=server` | 로컬 도구가 있어도 전부 서버로(맥에서 윈도우 흉내). 누끼도 ONNX |
| `SEEDHACK_RELAY=off` | 서버 중계 끔 |
| `SEEDHACK_OCR_PROVIDER=vision\|server\|tesseract` | OCR 만 고정 |
| `SEEDHACK_CUTOUT=onnx` | 누끼만 ONNX |
| `SEEDHACK_CUTOUT_MODEL=birefnet\|u2net` | 누끼 모델 고정 |
| `SEEDHACK_ONNX_MODELS=<폴더>` | 미리 받아 둔 모델 폴더 |
| `DASHBOARD_URL` · `SIGNAL_VENDOR_ID` · `SIGNAL_ACCESS_TOKEN` | 로그인 없는 하네스용 |

## 누끼 모델 (2026-10-23 비교, 씨드핵 작업 12장, mac Vision 과 겹치는 정도 IoU 중앙값)

| 모델 | 라이선스 | 크기 | 1장(M4) | 메모리 | IoU |
|---|---|---|---|---|---|
| U²-Net (기본) | Apache-2.0 | 176MB | 0.3초 | 2.1GB | 0.82 |
| BiRefNet_lite fp16 | MIT | 115MB | 4~6초 | 8~9.7GB | 0.92 |

- BiRefNet 은 일반 node 에서는 돌지만 Electron 안에서는 큰 메모리 할당에서 죽는다(맥 16GB 실측: utilityProcess 코드 5, ELECTRON_RUN_AS_NODE SIGTRAP). 그래서 설정(`cutoutModel:"birefnet"`)으로만 켜고, 실패하면 U²-Net 으로 바꾼다.
- U²-Net 은 글자 띠·표까지 따는 일이 있어, OCR 글자 상자가 많은 장(인포그래픽)은 누끼를 쓰지 않는다(`textHeavy`).
- 내려받는 곳과 확인 값은 `cutout-core.js` MODELS (U²-Net: rembg GitHub 릴리스, BiRefNet: Hugging Face onnx-community). AGPL(imgly)·비상업(BRIA RMBG) 모델은 쓰지 않는다.
- 런타임 onnxruntime-node 1.30(MIT). 윈도우 설치본에는 win32-x64 바이너리만 넣는다(package.json build.win.files).

## 글꼴

- 상세페이지 템플릿: SCDream(에스코어 드림) 9종 · Pretendard 를 앱에 넣어 둠 → 윈도우도 맥과 같은 글꼴
- SCDream 라이선스 원문 파일은 저장소에 없음 — 배포 전 에스코어 배포 조건(상업 사용·앱 동봉 허용 여부) 확인 필요
- Pretendard: SIL OFL 1.1 (`src/renderer/fonts/LICENSE-Pretendard.txt`)
- 썸네일은 맥에서 Apple SD Gothic Neo 를 쓰고, 윈도우에서는 앱에 든 Pretendard 로 대신한다(맑은 고딕으로 바뀌지 않게)

## 아직 확인 못 한 것

- 서버의 Claude API 경로(키가 없어 로컬 시험은 서버의 Claude CLI 로 대신함)
- 윈도우 실기: onnxruntime 바이너리 적재(asar 밖), 한글 사용자 이름 경로, 오프스크린 렌더 글꼴

## OCR 비교 (2026-10-23, 3개 상품 상세 24장, 맥 Vision 대비)

| | 맥 Vision | Google Cloud Vision |
|---|---|---|
| 한자 글자 수 | 1,573 | 1,570 (같은 글자 1,534 = 97.5%) |
| 세로쓰기 "品牌形象代言人" | 못 읽음(보강 단계가 따로 다시 읽음) | 바로 읽음(vertical 상자) |
| 사진 무늬를 글자로 잘못 읽음 | d02 에 3줄 | 없음 |
| 이미지 경계에 걸친 글 | 보강 단계 필요 | d12 한 줄 바로 읽음 |
| 1장 시간 · 비용 | 로컬 · 0 | 0.4초 · $0.0015 (월 1,000장 무료) |

- Gemini 2.5 Flash 로 글자 위치 읽기: 3장 중 2장이 반복 출력·형식 오류 → 탈락
- tesseract(지금 윈도우 대체): 중국어·세로쓰기 약함 → 구글 연결도 서버도 없을 때만

## 2026-10-23 바뀐 방향: 수강생 구글 무료 체험이 기본, 서버는 보조

고르는 순서(cli.js aiProvider · scene.js · ocr.js):
1. 이 PC 에 Claude CLI·gcloud·macOS Vision 이 있으면 그대로(대표님 맥)
2. 🔗 내 구글 클라우드가 연결돼 있으면 그 프로젝트로 Gemini(글·이미지)·Cloud Vision(OCR) — 무료 체험 크레딧
   - 단 번역(원본 한글화 purpose localize·localize-rewrite)은 서버 중계(Claude)로 보낸다. 바꾸려면 SEEDHACK_RELAY_PURPOSES
   - 구글이 401·403(무료 체험 끝·권한)이면 그 호출은 서버 중계로 한 번 더
3. 그 밖은 서버 중계

- 연결 방법·수강생 안내: docs/detail/GOOGLE-TRIAL-GUIDE.md (키 파일 끌어다 놓기가 기본, 서비스 계정에 묶은 API 키가 대안)
- Claude vs Gemini 비교(3개 상품): 강의 폴더 상세페이지_자동생성_결과샘플/v14_Claude_vs_Gemini_비교/비교표.html
  - 번역: 두 심판이 같은 쪽을 고른 줄 Claude 37 : Gemini 19 → 번역만 Claude 유지
  - 카피: 블라인드 판정 Claude 2 : Gemini 4 · 글 AI 비용 $7.88 : $2.11 · 결과까지 41분 : 30분(3개 합)
- Gemini 모델: gemini-3.1-pro-preview(기본) · gemini-2.5-flash(haiku 자리). 새 프로젝트는 gemini-2.5-pro 404
