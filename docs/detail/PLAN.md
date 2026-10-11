# 📄 상세페이지 자동 생성 — 총괄 기획 (2026-10-09 밤, 지휘자: Claude)

## 목표
1688/타오바오 상품 페이지 → 중국 상세 이미지·글을 읽고 → 중국어 글자를 지우고 한글로 바꾸고 → **전환율이 나오는 구조**의 한글 상세페이지를
쿠팡 규격(가로 780px, 이미지 여러 장)으로 **딸깍 한 번에** 만든다. 피그마 템플릿으로도 같은 내용을 내보낸다(플러그인).

사용자 요구(원문 요약): "중국 상세페이지 이미지를 활용해 피그마 템플릿으로 순식간에 고퀄 상세페이지를 뚝딱 만드는 기능. 전환율이 잘 나오는 상세페이지. 디테일·완성도."

## 전체 흐름 (파이프라인)
```
① 추출 extract   1688 상품 페이지 DOM(cn.cjs) → DetailSource JSON (제목·가격·속성표·옵션·갤러리·상세 이미지 주소·상세 글)
② 내려받기 download  이미지 → userData/detail/<jobId>/raw/*.jpg  (Referer 붙여 세션 fetch)
③ OCR ocr        각 이미지의 중국어 글자 상자(x,y,w,h,text)  — macOS Vision(로컬) / tesseract.js(윈도우 대비)
④ 지우기 clean    글자 상자를 배경색으로 메움(순수 JS 인페인팅) → clean/*.png
⑤ 번역 translate  OCR 글·제목·속성 → 한글 (기존 src/main/translate.js: DeepL 또는 구글 무료)
⑥ 카피 copy      전환형 카피(헤드라인·공감·핵심포인트·캡션·FAQ·주의사항·CTA) — Claude CLI(개발) / 규칙 기반 대체
⑦ 구성 plan      이미지 분류(히어로/특징/스펙/사이즈/패키지) + 카피 → PagePlan JSON
⑧ 렌더 render     HTML 템플릿(780px)에 PagePlan을 꽂아 오프스크린 창에서 섹션별 캡처 → out/01.jpg … + 미리보기 + figma-manifest.json
⑨ 화면 UI        사이드바 📄 상세페이지: 리스트업 상품 선택 → 딸깍 → "AI 작업 화면"(휘리릭 연출) → 결과 미리보기·폴더 열기·피그마 내보내기
```

## 핵심 결정
- **피그마 REST API는 노드를 만들지 못한다** → 자동 채우기는 피그마 **플러그인**(figma-plugin/seedhack-detail). 앱은 figma-manifest.json + 이미지 폴더를 내보내고, 플러그인이 템플릿 레이어(이름 규칙 `#hero.image` 등)에 꽂는다.
- **피그마 없이도 결과가 나와야 한다**(시연·초보) → HTML 템플릿 렌더가 1차 경로. 피그마는 손보고 싶을 때의 고급 경로.
- 외부 의존성 추가 최소화: 이미지 픽셀 처리는 Electron `nativeImage`(toBitmap/createFromBitmap) + 순수 JS. OCR은 macOS Vision(Swift, 로컬·무료). 윈도우는 tesseract.js 제공자(인터페이스만 같게).
- AI 카피는 기존 패턴(src/main/ai-cli.js: 개발 = Claude CLI 구독, 배포판 = 서버 중계 `task`)을 따르되 ai-cli.js는 건드리지 않고 `src/main/detail/cli.js`에 범용 러너를 둔다. AI가 없어도 규칙 기반 카피로 끝까지 간다.
- 광고법·신뢰: 숫자·효능은 **원문(속성표·상세 글·OCR)에 있는 것만**. "최저가·1위·100% 효과" 같은 표현 금지. 가격은 상세페이지에 넣지 않는다(쿠팡이 보여 줌).
- 원칙 유지: 1688에 추가 요청을 보내지 않는다(화면 DOM과 이미지 주소만). 보안 인증은 사람이. 테스트는 **fixture만** 쓰고 실제 1688·타오바오에 접속하지 않는다. 앱(npm start)을 띄우지 않는다 — 각자 `npx electron test/detail/<harness>.js`(별도 userData)로 검증한다.

## 담당 (파일 소유 — 다른 담당 파일은 절대 수정하지 않는다)
| 담당 | 역할 | 소유 파일 |
|---|---|---|
| A1 추출기 | ①② | `src/preload/cn.cjs`(맨 아래에 덧붙이기만), `src/main/detail/extract.js`, `src/main/detail/extract-core.js`, `test/detail/fixture/**`, `test/detail/extract*.{js,test.js}` |
| A2 이미지 가공 | ③④ | `src/main/detail/ocr.js`, `src/main/detail/image.js`, `src/main/detail/image-core.js`, `tools/ocr-mac/**`, `test/detail/img/**`, `test/detail/image*.{js,test.js}`, `test/detail/ocr*.js` |
| A3 카피·구성 | ⑤⑥⑦ | `src/main/detail/cli.js`, `src/main/detail/copy-prompt.js`, `src/main/detail/copy.js`, `src/main/detail/plan-core.js`, `test/detail/plan*.test.js`, `test/detail/copy*.{js,test.js}` |
| A4 템플릿·렌더·피그마 | ⑧ + 피그마 | `src/renderer/detail-templates/**`, `src/main/detail/render.js`, `figma-plugin/**`, `docs/detail/FIGMA.md`, `test/detail/render*.js` |
| A5 화면·오케스트레이터 | ⑨ + 파이프라인 연결 | `src/main/detail/index.js`, `src/renderer/detail.js`, `src/renderer/detail.css`, `src/preload/panel.cjs`(CHANNELS 추가), `src/renderer/panel.html`, `src/renderer/panel.js`, `src/renderer/gate.js`, `src/main/main.js`(import·nav·layout 연결만), `test/detail/e2e.js` |

공통 규약은 `docs/detail/CONTRACTS.md`, 합격 기준은 `docs/detail/CHECKLIST.md`. 규약을 바꿔야 하면 바꾸지 말고 보고서(`docs/detail/reports/<담당>.md`)에 적는다.

## 일정(밤새)
1. A1~A5 동시 착수 → 각자 단위 검증 통과 + 보고서 작성
2. 지휘자 통합 → `npx electron test/detail/e2e.js`(fixture 끝까지) + `npm run selftest`(기존 기능 회귀)
3. QA 담당이 CHECKLIST 항목별 합격/불합격 판정 → 불합격은 담당에게 재작업 → 전부 합격까지 반복
4. 아침 보고: `docs/detail/REPORT.md` + 강의 폴더 요약
