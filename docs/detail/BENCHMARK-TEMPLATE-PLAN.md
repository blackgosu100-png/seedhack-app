# 쿠팡 벤치마크 → 내 템플릿 — 2단계 설계안 (2026-10-11)

대표님 요구(2026-10-11): 쿠팡 경쟁 상세의 **구조 + 문구**를 가져와 더 좋은 문구로 치환, 이미지는 **1688·타오바오 실사진 먼저, 없으면 생성**,
그리고 **수강생 개개인이 자기 템플릿을 만들고 키워 갈 수 있는 확장성**(제작자 템플릿에 국한되지 않게).

1단계 POC(`REFERENCE-AUTO-POC.md`)로 "레퍼런스 폴더 → reference.json → custom 테마·섹션 순서·카피 각도"는 이미 동작한다.
2단계는 그것을 **버튼 한 번 → 보관함 → 고르기 → 공유**로 묶는 일이다. 새 파이프라인을 만들지 않는다.

## 1. 문구 "치환"의 뜻 (원칙 유지)
- 레퍼런스 문장은 **그대로 쓰지 않는다**(저작권·근거 없는 주장 위험). `guardSimilarity` 그대로.
- 대신 섹션마다 **각도·질문 방식·제목 길이·키커 리듬**을 가져오고, 사실은 우리 상품(1688 속성·기획서)으로 다시 쓴다.
  → 사용자 눈에는 "같은 자리에 같은 말투로, 우리 상품 문구가 들어간" = 치환. 이미 copy-prompt `벤치마킹` 칸이 이 일을 한다.
- 추가할 것: 섹션별 **원문 요지 한 줄**(OCR 요약, 20자 이내, "왜 이 말이 먹히는지")을 템플릿에 남겨 수강생이 읽고 고칠 수 있게. 문장 원문은 저장하지 않는다(ocr_lines 는 가드용으로만, 템플릿 내보내기에서 제외).

## 2. 이미지 자리 채우기 순서
| 순위 | 재료 | 지금 상태 |
|---|---|---|
| 1 | 1688 상세·갤러리 실사진(한글화) | 됨 (`extract.js`·`localize.js`) |
| 2 | 타오바오 판매자 상세·리뷰 사진 (`userData/taobao-reviews/<id>/`) | 폴더만 있음 → `extract.js` 입력에 합치기 (권리 주의: 참고용·사용자 선택) |
| 3 | 누끼 + 연출 생성 (`cutout.js`·`scene.js`) | 됨. 레퍼런스가 "사진 모양=연출컷"이면 그 섹션만 생성 |
| 4 | 그래도 없으면 글·아이콘 섹션으로 바꿈 | `applyReferenceOrder` 가 재료 없는 섹션을 이미 뺌 |
규칙: 사이즈·옵션·구성품은 **항상 실사진**(생성 금지, 메모리 `detail-real-image-first`).

## 3. 내 템플릿 (확장성의 핵심)
### 3-1. 파일
`userData/templates/<id>/template.json`
```json
{ "id": "tpl_20261011_a", "name": "주방 수납 잘 팔리는 A", "category": "주방>수납", "madeBy": "본인",
  "source": { "kind": "coupang", "url": "…", "capturedAt": "2026-10-11" },
  "tokens": { …reference.json tokens… },           // 색·정렬·여백·키커·띠 등 손잡이 14개
  "sections": [ { "type": "problem", "angle": "한 번에 해결 질문", "gist": "틈새 청소 번거로움" }, … ],
  "copyStyle": { "tone": "…", "titleLen": 12, "kicker": "POINT n" },
  "avoid": [ "완판", "KC 인증" ],                    // 근거 주장 금지 목록
  "overrides": {},                                  // 사용자가 세부 조정에서 바꾼 손잡이
  "version": 1 }
```
= reference.json 에서 **ocr_lines·measured 를 뺀 것 + 이름·분류·overrides**. 기본 8개 테마도 같은 형식으로 읽히게 한다(`tokens` 만 있는 템플릿).

### 3-2. 만드는 길 3가지
1. **쿠팡 화면 버튼** `🧲 템플릿으로 저장` (`src/preload/coupang.cjs`, 📝 리뷰 분석 옆): 상세 이미지 내려받기 → `reference.buildReference` → 이름 묻기(기본값 = 카테고리+상품명 앞 10자) → 보관함.
2. **폴더 가져오기**: 이미 받아 둔 레퍼런스 이미지 폴더(기존 `detail:reference`).
3. **내 결과물에서 만들기**: 만족한 상세페이지 작업 폴더의 plan/sections 를 템플릿으로 저장 → 다음 상품에 재사용(= 수강생이 자기 스타일을 키우는 길).

### 3-3. 쓰는 길
- 📄 상세페이지 화면 테마 고르기 = **기본 8 + 내 템플릿 N + "가져오기(.seedtpl.json)"**. 기본은 자동 추천 한 장(메모리 `simple-default-detail-optional`), "세부 조정" 펼치면 손잡이 칩 → `overrides` 에 저장.
- 순서 따르기 강도: `레퍼런스 그대로 / 우리 강점 섹션 유지(keepExtra)` 토글.
- 같은 쿠팡 주소·같은 폴더는 다시 분석하지 않는다(해시 캐시).

### 3-4. 공유 (제작자 템플릿에 국한되지 않게)
- 내보내기/가져오기 = `template.json` 한 파일(`.seedtpl.json`). 카톡·강의 자료로 주고받는다.
- 나중 공유 DB 가 생기면 같은 JSON 을 그대로 올린다(`소싱프로그램_설계안_v2_공유DB.md` 의 pool_* 옆에 `pool_templates`).

## 4. 손댈 파일
| 파일 | 일 |
|---|---|
| `src/main/detail/templates.js` (새) | 보관함 CRUD·내보내기·가져오기·reference.json→template.json 변환·캐시 |
| `src/main/detail/index.js` | `detail:templates` 가 기본+내 템플릿 합쳐 주기, `start({ templateRef })`, `info.reference` 대신 템플릿 id 받기 |
| `src/preload/coupang.cjs` | `🧲 템플릿으로 저장` 버튼 → `detail:captureReference { url, images }` |
| `src/main/detail/extract.js` | 타오바오 리뷰 사진 폴더를 재료로 합치기 |
| `src/renderer/detail.js` + panel | 템플릿 목록·이름 바꾸기·세부 조정 칩·가져오기/내보내기 |
| `test/detail/templates.test.js` | 변환·가져오기 왕복·overrides 적용 |

## 5. 순서·비용
1. templates.js + 변환 + 테스트 (반나절) → 2. 쿠팡 버튼 (반나절, 실제 쿠팡 2~3개로 검증) → 3. 화면(목록·칩) → 4. 타오바오 재료 합치기 → 5. 내보내기/가져오기.
분석 1회 $0.15~0.4·1~5분(haiku). 템플릿 재사용은 추가 비용 0. 1단계 속도 과제(목표 1분)는 그대로 남음.

## 6. 열린 질문(대표님)
- 템플릿 이름을 사용자가 짓게 할지, 자동(카테고리+날짜)으로 할지 → 기본 자동 + 바꾸기 권장.
- 수강생 간 공유는 파일 주고받기로 시작해도 되는지(공유 DB 는 베타 뒤).
