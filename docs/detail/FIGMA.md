# 피그마 연동 — 레이어 이름 규칙 · 템플릿 만드는 법 · 플러그인 사용

앱(씨드핵 📄 상세페이지)은 렌더가 끝나면 작업 폴더 `out/` 에 두 파일을 둔다.
- `figma-manifest.json` — 섹션별 레이어 이름 → 값(글 또는 이미지 상대경로) 목록 + 이미지 목록(`assets`)
- `figma-bundle.json` — manifest + 이미지 base64(플러그인에 통째로 붙여 넣는 "내보내기 묶음")

피그마 플러그인(`figma-plugin/seedhack-detail`)이 묶음을 읽어 **현재 페이지의 레이어 이름**을 찾아 채운다. 레이어가 하나도 없으면 780px 프레임을 새로 만든다.

## 1. 레이어 이름 표
이름은 `#<섹션>.<번호>.<항목>` 꼴. 번호는 1부터. 섹션이 여러 번 나오는 feature 는 `#feature.<섹션번호>.<항목>`.
이미지 레이어는 **사각형/프레임**(fill 을 이미지로 바꿈), 글 레이어는 **텍스트**(characters 교체, 글꼴은 레이어에 있는 것 유지).

| 섹션 | 레이어 이름 | 종류 | 값 |
|---|---|---|---|
| hero | `#hero.image` | 이미지 | 대표 사진 |
| | `#hero.headline` | 글 | 헤드라인(혜택 한 줄) |
| | `#hero.sub` | 글 | 보조문 |
| | `#hero.badge.1` ~ `#hero.badge.3` | 글 | 배지 |
| pain | `#pain.title` | 글 | "이런 적 있으시죠?" |
| | `#pain.1.icon`, `#pain.1.text` … (1~3) | 글 | 아이콘(이모지)·문장 |
| usp | `#usp.title` | 글 | "그래서 이렇게 만들었습니다" |
| | `#usp.1.title`, `#usp.1.desc`, `#usp.1.image` … (1~4) | 글·이미지 | 포인트 제목·설명·사진(없을 수 있음) |
| feature | `#feature.1.image`, `#feature.1.title`, `#feature.1.desc` | 이미지·글 | 상세 사진 + 캡션 (feature 섹션 순서대로 1, 2, 3 …) |
| | `#feature.1.overlay.1` … | 글 | 사진 위 중국어 자리(반투명 띠)에 들어가는 한글 |
| gallery | `#gallery.1.image`, `#gallery.2.image` … | 이미지 | 2열 격자 사진 |
| spec | `#spec.1.k`, `#spec.1.v` … | 글 | 표 항목·값 |
| | `#spec.image` | 이미지 | 스펙 이미지(있으면) |
| size | `#size.image`, `#size.note` | 이미지·글 | 사이즈 표 사진·메모 |
| package | `#package.1` …, `#package.image` | 글·이미지 | 구성품 칩 |
| notice | `#notice.1` … | 글 | 배송·AS·주의 문장 |
| faq | `#faq.1.q`, `#faq.1.a` … | 글 | 질문·답 |
| cta | `#cta.headline`, `#cta.sub`, `#cta.image` | 글·이미지 | 마무리 문구(가격·버튼 없음) |

같은 이름의 레이어가 여러 개면 전부 채운다(예: 헤드라인을 두 군데 쓰는 템플릿). manifest 에 없는 레이어는 그대로 둔다.

## 2. 템플릿 만드는 법(디자이너)
1. 피그마에 새 페이지를 만들고 가로 **780px** 프레임을 섹션별로 세로로 놓는다(쿠팡 상세 이미지 규격).
2. 사진 자리는 사각형(또는 프레임)으로 그리고 이름을 `#hero.image` 처럼 짓는다. 비율은 자유 — 플러그인은 `scaleMode: FILL` 로 채운다.
3. 글 자리는 텍스트 레이어로 만들고 이름을 `#hero.headline` 처럼 짓는다. 글꼴·크기·색은 그대로 유지된다(Pretendard 가 설치돼 있으면 그대로 쓰면 된다). 글이 길어질 수 있으니 **Auto height** 로 둔다.
4. 레이어 이름만 맞으면 그룹·오토레이아웃 구조는 자유다. 섹션 프레임 자체 이름은 아무거나 괜찮다.
5. 이 페이지를 연 상태에서 플러그인을 실행하면 그 페이지의 레이어를 찾는다.

## 3. 플러그인 설치(개발 플러그인 가져오기)
1. 피그마 **데스크톱 앱**에서 파일을 연다(브라우저 판은 개발 플러그인 가져오기가 안 됨).
2. 메뉴 **Plugins → Development → Import plugin from manifest…**
3. `figma-plugin/seedhack-detail/manifest.json` 선택. (manifest 에 `id` 가 없는 것이 정상 — 가져올 때 Figma 가 숫자 id 를 자동으로 붙여 준다)
4. 실행: **Plugins → Development → 씨드핵 상세페이지 채우기**.

## 4. 사용 순서
1. 앱에서 📄 상세페이지 → 상품 선택 → 템플릿 선택 → ▶ 딸깍 → 완료 후 **🎨 피그마 묶음**(= `out/figma-bundle.json`).
2. 피그마에서 템플릿 페이지(또는 빈 페이지)를 연다.
3. 플러그인 실행 → 파일 선택(또는 JSON 붙여넣기) → **채우기**.
4. 결과 확인 → 손질 → 피그마에서 780px 프레임을 JPG 로 내보내 쿠팡에 올린다.

## 5. 한계 · 메모
- **피그마에서 실제로 실행해 본 검증은 아직 없다.** 플러그인 API 문서 기준으로 작성했고 `node --check` 만 통과. 첫 실행 때 오류가 나면 Plugins → Development → Open console 에서 메시지를 확인한다.
- 네트워크 접속 없음(`networkAccess` 미선언) — 이미지는 묶음 파일의 base64 로만 들어간다. 묶음 파일은 이미지 수에 따라 수 MB 가 될 수 있다.
- 새 프레임 생성 모드는 글꼴 Inter(피그마 기본)만 쓴다. 글자 크기: 헤드라인 46 / 제목 30 / 본문 24.
- 템플릿 레이어 방식에서 이미지 레이어는 `fills` 가 있는 노드(사각형·프레임·타원)만 채워진다.

## 6. v2(스튜디오) 섹션 레이어 이름
| 섹션 | 레이어 이름 |
|---|---|
| hero / solution / cta / size | 이미지 `#hero.image`(사진), 누끼는 `#hero.cutout`(같은 식으로 `#solution.cutout`, `#cta.cutout`, `#size.cutout`) |
| problem | `#problem.title`, `#problem.1.text` … |
| agitate | `#agitate.1`(큰 문장), `#agitate.2`(보조문) |
| solution | `#solution.headline`, `#solution.sub`, `#solution.image`/`.cutout` |
| benefits | `#benefits.title`, `#benefits.1.title`, `#benefits.1.desc`, `#benefits.1.image`/`.cutout` … |
| proof | `#proof.1.value`, `#proof.1.unit`, `#proof.1.label`, `#proof.1.desc` … |
| compare | `#compare.1.k`, `#compare.1.a`, `#compare.1.b` …(○/✕ 는 "가능"/"불가" 글로) |
| steps | `#steps.1.title`, `#steps.1.desc`, `#steps.1.image`/`.cutout` … |
| objections | `#objections.1.q`, `#objections.1.a` … |
| trust | `#trust.1.title`, `#trust.1.desc` … |
| size 치수 | `#size.dims.w`, `#size.dims.h`, `#size.dims.1`(깊이·펼침·접힘 칩) |
