# 레퍼런스 → 벤치마킹 내 템플릿 — 1단계 POC 결과 (2026-10-11)

## 결론
- **디자인은 사람이 만든 것과 거의 같은 수준으로 자동으로 뽑힙니다.** 클린맥스·브랜든 두 레퍼런스에서 자동으로 만든 테마로 커피 수납랙을 그리면, 사람이 손으로 만든 commerce·branden 테마와 나란히 놓아도 구분이 어렵습니다.
- **섹션 순서·각도도 레퍼런스를 따릅니다.** 클린맥스 순서(첫 화면 → 용도 → 장점 → 문제 제기 → 장점 → 전후 차이 → 장점 → FAQ → 주의 → 스펙)대로 커피 수납랙 페이지가 다시 짜였고, 사실은 전부 우리 상품 것입니다.
- **표절 가드가 동작합니다.** 레퍼런스 문장을 그대로·살짝 바꿔 넣으면 잡아서 고쳐 쓰고, 그래도 비슷하면 규칙 문구로 바꿉니다.
- **같은 카테고리 레퍼런스 시험은 아직입니다.** 이번 두 레퍼런스는 초음파 세척기·여행 파우치라 커피 수납랙과 카테고리가 다릅니다. 대표님이 같은 카테고리 레퍼런스를 주시면 그걸로 다시 확인합니다.

## 숫자
- AI 비용 합계 약 **$1.04** (레퍼런스 분석 2건 $0.50 + 벤치마킹 카피 2회 $0.52 + 고쳐 쓰기 확인 $0.02).
- 레퍼런스 분석: 클린맥스 26장 **$0.37 · 298초**, 브랜든 29장 **$0.13 · 99초** (haiku). OCR·픽셀 측정은 무료이고 10초 안팎.
- 벤치마킹 카피: **$0.22 · 128초** (sonnet 1회). 고쳐 쓰기는 걸릴 때만 **$0.02 · 20초** (haiku).
- 사실 확인(커피 수납랙 벤치마킹 결과): 카피 글 56개 · 숫자 7개 모두 우리 입력에 근거 있음 · 근거 주장(완판·1위·인증) 0건 · 레퍼런스와 비슷한 줄 0개.
- 기존 테마 8개는 바꾸기 전/후 결과가 **바이트 단위로 같음** (슬라이스·page.html·preview·figma-manifest. figma-bundle 은 만든 시각 칸만 다름).
- 테스트 `node --test test/detail/*.test.js` **162개 통과** (기존 153 + 새 9).

## 비교 시트 (OneDrive `상세페이지_자동생성_결과샘플/v10_레퍼런스자동템플릿_POC/`)
- `비교시트/A-style-cleanmax-1~3.png` — 레퍼런스(축소) · 자동 템플릿 · 사람이 만든 commerce
- `비교시트/B-style-branden-1~3.png` — 레퍼런스(축소) · 자동 템플릿 · 사람이 만든 branden
- `비교시트/C-flow-cleanmax-1~2.png` — 레퍼런스 3열 · 벤치마킹 생성(구조·카피·테마) · 기존 생성(ivory)
- 슬라이스: `스타일_클린맥스자동/`, `스타일_브랜든자동/`, `흐름_클린맥스벤치마킹/` (+ copy.json·sections.json·report.json)
- 레퍼런스 분석 결과: `레퍼런스분석/cleanmax-reference.json`, `branden-reference.json`

## 무엇이 되나
1. **디자인 손잡이 14개 자동 추출.** 색(바탕·글자·강조·어두운 띠·정보 판), 정렬, 여백, 제목 크기·굵기, 키커 알약, 띠 교대, 문제 제기 띠, 사진 모양, 강조 방식, 아이콘 띠, 정보 판, 첫 화면 글 자리, 주의 검정.
2. **잴 수 있는 것은 재고, AI 는 고르기만.** 색·정렬·여백·제목 크기는 픽셀과 OCR 로 직접 잽니다. AI(비전)는 정해진 선택지 중 고르기만 하고, 자유 CSS 는 쓰지 않습니다.
3. **AI 판단을 측정으로 고침.** 섹션 제목을 OCR 에서 찾아 그 자리 바탕을 잽니다. 예: 비전이 "문제 제기 = 그냥 글"이라 해도 실제로 어두운 띠 위면 말풍선 띠로 바꿉니다. 영문 키커가 2개도 없으면 키커를 끕니다.
4. **섹션 순서·각도 벤치마킹.** 레퍼런스 섹션을 우리 섹션 종류로 바꿔 순서를 맞춥니다. 재료가 없는 섹션(구형 vs 신형 비교, 판매 실적, 사용 방법, 후기)은 뺍니다.
5. **사실은 우리 것만.** 각도·말투·제목 길이·문제 제기 방식만 카피에 넘깁니다. 레퍼런스의 숫자·인증·실적은 "쓰지 말 것" 목록으로 넘깁니다.

## 예시 (클린맥스 → 커피 수납랙)
- 레퍼런스 키커 "POINT 2·3 / Difference 1" → 우리 페이지 "POINT 1·2·3 / Difference 1". "UPGRADE·NEW·2026 신제품" 같은 개선 주장 낱말은 쓰지 않습니다.
- 문제 제기: 레퍼런스 "이걸 한 번에 해결할 순 없을까?" → 우리 "맞춘 다음엔 어떻게 꺼낼까?" → 다음 제목 "그 답은 당겨서 / 풀아웃 서랍 구조".
- 고쳐 쓰기 시험: 레퍼런스 문장 3개를 일부러 넣었더니 3개 모두 잡혀 새로 쓰였습니다. 예: "이걸 한 번에 해결할 순 없을까?" → "좁은 공간도 활용할 순 없을까?"

## 안 되는 것·한계
- **같은 카테고리 시험 전.** 다른 카테고리라 각도 일부가 안 맞습니다. 예: 클린맥스 "주파수 수치로 과학성" 각도를 커피 랙은 폭 수치로 바꿔 썼습니다.
- **레퍼런스 순서를 그대로 따르면 우리 강점 섹션이 빠질 수 있습니다.** 클린맥스에는 지시선(체크포인트)·디테일 섹션이 없어서 커피 랙의 그 섹션이 빠졌습니다.
- **비전 판단이 가끔 틀립니다.** haiku 가 브랜든에 없는 키커 알약을 "있음"으로 답했습니다. 측정 보정으로 고쳤지만, 보정 규칙이 없는 손잡이(사진 모양·강조 방식)는 그대로 믿습니다.
- **표절 가드는 "거의 그대로"만 잡습니다.** 글자 3개 묶음이 60% 이상 겹치거나 8자 이상 똑같을 때입니다. 뜻만 같은 바꿔 쓰기는 통과합니다. 예: "손이 닿기 어려운 미세한 틈새까지".
- **레퍼런스 분석이 느립니다.** 긴 쿠팡 상세는 haiku 로도 5분 가까이 걸립니다. 시트 4~6장을 하나씩 열어 보느라 대화가 길어집니다.
- **어두운 띠는 대부분 숯색으로 잡힙니다.** 클린맥스의 진남색 띠는 그라데이션이라 면적이 작게 잡혔고, 띠 교대는 "없음"으로 판단했습니다. 사람이 만든 commerce 는 진남 교대를 썼습니다.
- **카피 스키마는 장점 3개 고정입니다.** 레퍼런스에 POINT 가 5개여도 3개만 씁니다. 나머지 각도는 앞 섹션에 합칩니다.
- **기획서는 이미 있으면 다시 쓰지 않습니다.** 이번 시험은 기존 기획서를 재사용해서, 기획서 단계의 벤치마킹 가이드는 확인하지 못했습니다(새 작업에서만 들어감).

## 2단계 제안
1. **쿠팡 상품 화면 버튼.** `📝 리뷰 분석` 옆에 `🧲 레퍼런스로 저장`. 상세 이미지를 내려받아 바로 분석합니다. 위치: `src/preload/coupang.cjs`.
2. **내 템플릿 보관함.** 분석 결과를 이름 붙여 저장합니다(예: "주방 수납 잘 팔리는 A"). 상세페이지 만들기 화면에서 골라 씁니다. 같은 레퍼런스는 다시 분석하지 않습니다.
3. **손잡이 조정 화면.** 기본은 자동 그대로 한 장. "세부 조정"을 펼치면 색·정렬·키커·띠 등을 칩으로 바꿉니다.
4. **순서 따르기 강도.** "레퍼런스 그대로 / 우리 강점 섹션 유지" 중 고르기. 지금은 "그대로"만 있습니다.
5. **분석 속도.** 시트 장수를 줄이거나(중요 구간만) 모양 판단과 순서 판단을 나눕니다. 목표 1분·$0.15 이하.

## 대표님께 여쭐 것
같은 카테고리(커피·주방 수납) 쿠팡 레퍼런스 1~2개를 주시면 그걸로 구조·카피 벤치마킹을 다시 확인하겠습니다.

---

## 바뀐 파일·실행 방법 (기술)
- `src/renderer/detail-templates/card/themes/custom.css` — 새 테마. `--rf-*` 변수 + `body[data-rf-*]` 손잡이.
- `src/renderer/detail-templates/card/template.js` — `customSetup`(custom 테마일 때만). `brandenSetup` 에 선택 인자(기본값 = 기존 동작). THEMES 에 `custom`.
- `src/main/detail/render.js` — THEMES 에 `custom` (렌더 쪽 목록. 앱 화면 테마 목록 `index.js THEMES` 에는 넣지 않음).
- `src/main/detail/reference-core.js` — 순수 함수: `normalizeTokens`, `locateSections`, `styleFromSections`, `refRecipe`, `applyReferenceOrder`, `refKickers`, `referenceGuide`, `similarTo`, `guardSimilarity`.
- `src/main/detail/reference.js` — `buildReference({ input, outDir, model="haiku", reuse })`: 한국어 OCR → 픽셀 측정(폭 390 이어 붙이기) → 4열 시트(열 = 원본 2400px) → 비전 1회 → `reference.json`.
- `src/main/detail/ocr.js`, `tools/ocr-mac/ocr.swift` — `langs` 옵션(환경 변수 `SEEDHACK_OCR_LANGS`). 기본은 그대로 중국어. swift 소스가 바뀌어 다음 실행 때 한 번 다시 컴파일됨.
- `src/main/detail/plan-core.js` — `planSectionsV5({ reference })` 레퍼런스 순서, `buildPlanV5` 레퍼런스 키커.
- `src/main/detail/copy.js`, `copy-prompt.js` — `writeCopyV5({ reference })`: 가이드 + 섹션별 "벤치마킹" 칸 + `guardCopySimilarity`(haiku 고쳐 쓰기 → 규칙 → 예비 문구).
- `src/main/detail/brief-prompt.js` — `reference_guide` 가 있으면 기획서 입력에 붙임.
- `src/main/detail/index.js` — `info.reference`(reference.json 또는 이미지 폴더) → `reference/reference.json`, 테마 `custom` + `plan.meta.refTokens`. IPC `detail:reference { jobId, reference }`. `start({ reference })`.
- 테스트: `test/detail/reference-core.test.js`(9개). 하네스: `reference-harness.js`(분석), `reference-flow.js`(실제 파이프라인, 작업 폴더는 임시 복사), `theme-replay.js --ref= --plan=`.

```
npx electron test/detail/reference-harness.js "<레퍼런스 폴더>" <출력> [--model=sonnet] [--reuse=<reference.json>]
npx electron test/detail/theme-replay.js "<작업 폴더>" <출력> custom --ref=<reference.json>
npx electron test/detail/reference-flow.js "<작업 폴더>" <reference.json 또는 폴더> <출력>
```
