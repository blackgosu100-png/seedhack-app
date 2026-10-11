# 합격 체크리스트 — 전부 ✅ 가 될 때까지 끝나지 않는다 (QA 담당이 판정, 지휘자가 확인)

판정 표기: ✅ 합격 / ❌ 불합격(사유·담당) / ➖ 이번 밤 범위 밖(사유). 증거(명령·출력·파일 경로)를 함께 적는다.

## A. 추출 (A1)
- [ ] A1-1 fixture 상품 페이지에서 제목·가격(min/max)·속성표(≥5)·옵션(≥2)·갤러리(≥2)·상세 이미지(≥10, 페이지 순서) 를 읽는다 (`npx electron test/detail/extract-harness.js`)
- [ ] A1-2 이미지 주소 정규화: `_sum.jpg`·`.webp`·`_.webp`·`?x-oss-process` 꼬리 제거, 중복 제거, `//img.alicdn.com` 프로토콜 보완, data: URL 제외, 60px 미만 아이콘 제외
- [ ] A1-3 지연 로딩 이미지(`data-lazyload-src`, `data-src`, `data-original`)도 읽는다 — fixture에 포함
- [ ] A1-4 내려받기: 실패해도 계속(결과 `{ok,fail}`), 동시 4개, Referer 지정, 받은 파일 w/h 기록
- [ ] A1-5 1688 상품 페이지에 `#sg-detail-btn` 버튼이 뜨고 누르면 `detail:fromPage` 가 raw 를 보낸다 (fixture를 cn.cjs preload로 띄운 하네스에서 확인)
- [ ] A1-6 타오바오/티몰 상품 페이지 DOM 규칙도 구현(검증은 fixture로만, 실사이트 ➖ 허용)
- [ ] A1-7 기존 cn.cjs 동작(리스트업 넣기 상자·이미지 검색·probe)에 영향 없음 — `npm run selftest` 통과

## B. OCR·지우기 (A2)
- [ ] B-1 macOS Vision OCR: 중국어 글자가 그려진 샘플 12장에서 글자 상자를 찾는다(장당 ≥1개, 샘플 전체 재현율 ≥80%: 샘플 생성 때 넣은 문장 수 대비)
- [ ] B-2 tesseract.js 제공자: 같은 인터페이스로 동작(샘플 3장 이상에서 상자 ≥1) — 실패하면 none 으로 내려가고 파이프라인은 계속
- [ ] B-3 단색 배경 글자: 지운 뒤 상자 영역 픽셀이 배경색과 평균 차이 ≤ 12/255 (단위테스트)
- [ ] B-4 그라데이션 배경: 좌우 보간으로 자연스럽게(눈으로 확인한 before/after PNG를 `test/detail/img/out/` 에 저장하고 보고서에 경로)
- [ ] B-5 사진 위 글자: 메우지 않고 `kept`/`onPhoto:true` 로 돌려준다
- [ ] B-6 지운 결과에 다시 OCR 돌리면 CJK 상자 수가 원본의 20% 이하(단색 샘플 기준)
- [ ] B-7 첫 실행 컴파일 실패(swiftc 없음) 시 명확한 한국어 안내 메시지 + tesseract 로 대체

## C. 번역·카피·구성 (A3)
- [ ] C-1 규칙 기반 카피만으로도 Copy 모든 칸이 채워진다(AI 없이) — 단위테스트
- [ ] C-2 Claude CLI 경로: fixture 입력으로 실제 1회 호출해 스키마대로 돌아온다(모델 sonnet 기본, 180초 제한). 비용·소요 시간 보고
- [ ] C-3 lintCopy: 금지어(최저가·1위·최고·100%·완치·효능·쿠팡·원/₩ 가격) 검출 + 교체 — 단위테스트
- [ ] C-4 숫자·스펙은 원문에 있는 것만: AI 출력 spec 의 값이 attrs/OCR/상세글에 없는 숫자를 포함하면 제거(검사 함수 + 테스트)
- [ ] C-5 buildPlan: 섹션 순서 고정, hero 선택 규칙, 긴 이미지(세로 > 가로×2.5) 분할 cuts 생성, size/package/notice 분류 키워드 — 단위테스트
- [ ] C-6 번역 캐시 재사용(같은 문장 두 번 요청 안 함) — translate.js 그대로 쓰는지 확인

## D. 템플릿·렌더·피그마 (A4)
- [ ] D-1 템플릿 3종(clean/dark/pop) 모두 같은 PagePlan으로 렌더됨 (`npx electron test/detail/render-harness.js` → out/*.jpg)
- [ ] D-2 모든 슬라이스 가로 = 780px, 세로 ≤ 3000px, 각 ≤ 10MB, JPG. 전체 세로 합 6,000~20,000px
- [ ] D-3 가독성: 본문 글자 ≥ 24px, 헤드라인 ≥ 40px, 캡션 ≥ 22px(CSS 확인), 명도 대비 본문 ≥ 4.5:1
- [ ] D-4 첫 화면(hero) 한 장 안에 상품 사진 + 헤드라인 + 보조문 + 배지 3개가 들어가고 세로 ≤ 1100px
- [ ] D-5 이미지는 원본보다 1.5배 넘게 키우지 않는다(작으면 여백·카드로 처리). 사진 위 글자(overlay)는 반투명 띠로 한글 덮음
- [ ] D-6 섹션이 비어 있으면(items 0) 그 섹션을 그리지 않는다. 글자 길이가 넘치면 … 처리 없이 줄바꿈(잘림 없음) — 긴 문장 fixture로 확인
- [ ] D-7 preview.png 생성, page.html 저장(브라우저로 열어 볼 수 있음)
- [ ] D-8 figma-manifest.json + figma-bundle.json(이미지 base64 포함) 생성, FIGMA.md 에 레이어 이름 표·플러그인 설치 순서(개발 플러그인 가져오기)·템플릿 만드는 법
- [ ] D-9 figma-plugin: manifest.json 유효(`"api":"1.0.0"`, `"main"`, `"ui"`, `networkAccess` 없음 = 붙여넣기 방식), code.js 는 `figma.*` API만 사용, 문법 오류 없음(`node --check`), 레이어 못 찾을 때 새 프레임 생성 로직 존재
- [ ] D-10 렌더 결과에 중국어(한자) 글자 0개: 완성 슬라이스에 OCR(A2 Vision)을 돌려 CJK 상자 0개 — e2e에서 확인(단색 샘플 기준)

## E. 화면·오케스트레이터 (A5)
- [ ] E-1 사이드바 📄 상세페이지 메뉴, VIEWS/showView/gate/nav 연결, 잠금 시 비활성
- [ ] E-2 `detail:run` 으로 fixture source 를 끝까지 돌려 out/*.jpg·preview·figma 묶음이 생긴다 (`npx electron test/detail/e2e.js` → "E2E_OK")
- [ ] E-3 진행 이벤트가 9단계 모두 나오고(step 순서·pct 단조 증가), 이미지 단위 진행(done/total)이 OCR·clean·download 에서 온다
- [ ] E-4 AI 작업 화면: 점 애니 제목, 순환 부제, 큰 %, 단계 체크, 이미지 격자 점등(실제 이미지 수), 미니 터미널 로그, 경과 ms, 완료 축하 → 가짜 숫자 없음(실제 진행만). 2~3초 멈춤 구간 없음(RAF 기반 보간)
- [ ] E-5 결과 화면: 슬라이스 세로 미리보기, 📂 폴더 열기, 🎨 피그마 묶음 저장, ↻ 템플릿 바꿔 다시 렌더(OCR 재실행 없이 plan 재사용)
- [ ] E-6 취소 가능(진행 중 detail:cancel → 단계 사이에서 멈추고 status "cancelled")
- [ ] E-7 실패해도 앱이 죽지 않고 fail 이벤트 + 한국어 사유. OCR none·AI 없음에서도 완료됨
- [ ] E-8 기존 `npm run selftest` 통과(회귀 없음), `node --check` 전 파일 통과
- [ ] E-9 prefers-reduced-motion 에서 연출 생략, 큰 화면(발표 모드 ZOOM) 가독성

## F. 전환율·완성도 (QA, 사람이 보듯 판정)
- [ ] F-1 첫 화면 3초 안에 "무엇을·누구에게·왜" 가 읽힌다(헤드라인 혜택 중심, 상품 사진 큼)
- [ ] F-2 구조: hero → 공감(pain) → 핵심포인트(usp) → 상세(feature/gallery) → 스펙 → 사이즈 → 구성 → 주의/배송 → FAQ → CTA 순서
- [ ] F-3 카피에 금지어 없음, 가격 없음, 원문에 없는 숫자 없음
- [ ] F-4 중국어 흔적 0 (글자·워터마크·중국 쇼핑몰 로고 — 로고는 OCR로 못 잡으면 ➖ 기록)
- [ ] F-5 템플릿 3종이 서로 분명히 다른 분위기(화이트 클린 / 다크 프리미엄 / 컬러 팝)이면서 같은 정보 구조
- [ ] F-6 preview.png 를 실제로 열어 보고(Read) 어색한 여백·겹침·잘림 없음
- [ ] F-7 README/REPORT: 사용법(앱에서 딸깍 → 폴더 → 쿠팡 등록), 피그마 연동 순서, 알려진 한계(윈도우 OCR, 실사이트 미검증, 로고)
