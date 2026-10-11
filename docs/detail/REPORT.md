# 📄 상세페이지 자동 생성 — 아침 보고 (2026-10-09 밤 ~ 10-10 새벽, 지휘자 Claude)

## ⚠ 2026-10-09 08:15 추가 — 실제 1688 상품(948424797701) 첫 실행 결과 "사용 불가"
사용자가 실제 상품으로 돌린 결과(앱 데이터/detail/20261009-080956-948424797701/out)를 보면 글자를 지운 자리가 빈 벽·얼룩으로 남고, 스펙 표 조각이 카드 이미지로 들어가고, 구글 번역 오역(个→개인)이 띠에 보임. 원인: 중국 상세 이미지는 '큰 글자 + 제품 사진' 구성이라 **글자만 지우는 설계가 틀림**. 재설계: 글자 없는 제품 사진 영역만 잘라내고 한글은 템플릿이 쓴다(A2 cropPhoto · A3 photo 기준 구성·Claude 라벨 번역 · A5 실제 작업 재생 e2e). 아래 밤 보고는 fixture 기준이었음.


## ✅ 2026-10-09 낮 — 재설계 완료, 같은 상품 3차 결과 "쓸 수 있는 수준" (지휘자 판정)
- 바뀐 설계: 글자 지우기 → **글자 없는 제품 사진 영역만 잘라내기**(image-core findPhotoRegion·trimEdgeBands) + **Claude 비전 사진 검수**(vision.js: 사진을 직접 보고 usable/score/role/캡션/text_pos) + 카피 규칙 강화(관련성, 斤 환산, 하중 주장 "제조사 제공 기준", 공급사 브랜드·도매 문구·정책 약속·무의미 문장 제거).
- 파이프라인 10단계(clean 뒤 vision 추가). 재생 모드 `npx electron test/detail/e2e.js --replay <jobDir> [--ai]`로 실제 작업 폴더를 1688 재접속 없이 반복 검증.
- 3차 결과: 강의 폴더 `상세페이지_자동생성_결과샘플/실제상품_948424797701_3차(최종)/` — 사진 속 중국어 0, 빈 벽·조각 0, 특징 7장 캡션이 사진과 일치. 비용 약 $1.4/상품(검수 $1.2 + 카피 $0.2), 약 6분.
- 검증: 단위 76/76 · E2E_OK · REPLAY_OK · SELFTEST_OK. 미커밋.
- 남은 것: 앱 재시작 후 같은 상품·다른 상품으로 실사용 확인, 비용이 부담이면 검수 모델을 haiku로(SIGNAL_AI_MODEL) 또는 검수 사진 수 제한.

## 한 줄 결론
1688 상품 페이지 → 중국어 지운 한글 상세페이지(쿠팡 780px, 템플릿 3종) → 피그마 묶음까지 **딸깍 한 번**에 만드는 기능을 앱에 넣었고, fixture 기준 단위 59개·하네스 5종·e2e·기존 자체 점검이 전부 통과했습니다. **실제 1688 페이지와 피그마 안에서의 실행은 아직 검증 전**이고, 코드는 **커밋하지 않았습니다**(요청이 없어서).

## 진행 방식
지휘자(총괄 기획·규약·합격표) → 담당 5명 병렬 구현 → 지휘자 통합·육안 검수 → QA 판정관 독립 판정(❌ 2건 + 재작업 10건) → 담당 재작업 → 최종 검증. 문서: `PLAN.md`(기획) · `CONTRACTS.md`(모듈 규약) · `CHECKLIST.md`(합격표) · `QA.md`(판정) · `reports/A1~A5.md`(담당 보고).

## 만든 것
| 단계 | 파일 | 요지 |
|---|---|---|
| ① 추출 | `src/preload/cn.cjs`(끝에 추가), `src/main/detail/extract*.js` | 1688·타오바오·티몰 상품 페이지에서 제목·가격·속성·옵션·갤러리·상세 이미지(지연 로딩 포함)·상세 글 읽기, 📄 버튼, 이미지 내려받기(동시 4·Referer·webp→png) |
| ③④ OCR·지우기 | `src/main/detail/ocr.js`, `image*.js`, `tools/ocr-mac/ocr.swift` | 맥 Vision(로컬·무료, 재현율 100%) / 윈도우 tesseract.js, 단색·그라데이션 배경 글자 지우기(순수 JS), 사진 위 글자 띠 잘라내기, 빈 여백 자동 트림 |
| ⑤⑥⑦ 번역·카피·구성 | `translate.js`(기존), `src/main/detail/cli.js`, `copy*.js`, `plan-core.js` | 규칙 카피(AI 없이도 완성) + Claude CLI 카피(sonnet, 약 1분·$0.1), 금지어·중국 판매자 정책 약속·도매 문구·근거 없는 숫자 자동 제거, 섹션 구성(hero→공감→핵심포인트→상세→갤러리→스펙→사이즈→구성→주의→FAQ→CTA), 길이 18,000px 상한 |
| ⑧ 렌더·피그마 | `src/renderer/detail-templates/{clean,dark,pop}`, `src/main/detail/render.js`, `figma-plugin/seedhack-detail/`, `docs/detail/FIGMA.md` | 오프스크린 렌더 → 780px JPG 슬라이스(≤3000px) + preview.png + page.html + figma-bundle.json, 피그마 플러그인(레이어 이름 규칙 채우기, 템플릿 없으면 자동 생성) |
| ⑨ 화면 | `src/renderer/detail.js/.css`, `src/main/detail/index.js`, panel/gate/main 연결 | 사이드바 📄 상세페이지, "AI 작업 화면"(점 애니·순환 부제·큰 %·9단계·이미지 격자 점등·미니 터미널·경과 ms·완료 불꽃), 결과 미리보기·📂 폴더·🎨 피그마·🌐 HTML·↻ 다른 템플릿·취소 |

## 검증(최종, 2026-10-10 02:45)
- `node --test test/detail/*.test.js` → 59/59
- `npx electron test/detail/{extract,ocr,image,render}-harness.js` → A1_OK · OCR_OK · A2_OK · A4_OK
- `npx electron test/detail/e2e.js` → E2E_OK(대체 동작 0, 취소·재렌더·실패·webp 케이스 포함)
- `npm run selftest` → SELFTEST_OK(출력의 LISTUP_FAIL/CAPTURE_FAIL 2줄은 이번 작업 전부터 있던 것)
- 결과 샘플(눈으로 확인): 강의 폴더 `상세페이지_자동생성_결과샘플/`(e2e 결과 7장, 템플릿 3종 샘플, 앱 화면 캡처 7장)

## 아침에 해 주실 것(순서대로)
0. 다른 세션 알림: 지금 Wing 로그인이 Akamai에 막힌 상태라 앱 재시작·Wing 로그인은 차단이 풀린 뒤에. 📄 기능 시험은 Wing 로그인 없이 1688 탭만으로 가능(수강생 잠금이 켜져 있으면 대시보드 계정 로그인은 필요).
1. 앱 실행 → 🇨🇳 1688 상품 페이지 하나 열기 → 오른쪽 위 **📄 상세페이지 만들기** → 📄 화면에서 진행·결과 확인. (첫 실행 때 Vision OCR 도구를 `swiftc`로 컴파일합니다, 수 초.) 안 되면 콘솔의 한국어 사유를 보내 주세요 — DOM 규칙은 fixture로만 맞춘 상태라 실제 페이지에서 1~2곳 손볼 가능성이 큽니다.
2. 결과가 마음에 들면 `git add -A && git commit`(미커밋 상태). 배포(0.6.5)는 그 다음.
3. 피그마: `figma-plugin/seedhack-detail/`를 개발 플러그인으로 가져와 `out/figma-bundle.json` 붙여넣기 시험.

## 알려진 한계·다음 일
- 실제 1688·타오바오 페이지 미검증(원칙상 밤에 접속 안 함). 사진 속 로고·워터마크는 지우지 못함(글자 띠는 잘라냄).
- 배포판 AI 카피는 서버 중계 `task:"detail"` 처리기가 대시보드에 아직 없어 규칙 카피로 내려감 → 서버 작업 필요.
- 윈도우 OCR(tesseract.js)은 정확도가 낮음. 윈도우 실기 미검증.
- Vision이 한글을 한자로 오인하는 경우가 있어 "중국어 0개" 자동 판정은 경고로만.
- 비용: Claude CLI 카피 1회 약 $0.09~0.13(sonnet). 밤 작업 중 실제 호출 3회.
