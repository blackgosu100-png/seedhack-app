# QA 판정 — 📄 상세페이지 자동 생성 (2026-10-09 02:20~02:35, QA 판정관)

원칙: 담당 보고서(reports/A1~A5.md)는 참고만 하고 **모든 명령을 직접 실행**했다. 앱 본체(npm start)·실제 1688/타오바오/쿠팡 접속·git 되돌리기는 하지 않았다. 코드는 한 줄도 고치지 않았다.
증거 파일은 프로젝트 밖 `/tmp/seedhack-qa/` 에 두었다(로그 4개, 화면 캡처 7장, e2e 슬라이스 사본 2벌, 보조 스크립트 3개).

## 0. 실행한 명령과 결과 요약

| 명령 | 결과 | 비고 |
|---|---|---|
| `node --test test/detail/*.test.js` | **55/55 pass** (`/tmp/seedhack-qa/…` 2차 실행) | 1차(02:20) 실행 때는 `copy.js:182 ReferenceError: WHOLESALE_KEY is not defined` 로 8개 실패 — A3 가 동시에 copy.js 를 고치던 중(파일 mtime 02:20). 1분 뒤 재실행에서 전부 통과. copy.js 는 QA 중에도 계속 바뀌고 있어(줄 번호 이동) **최종 상태는 지휘자가 한 번 더 돌려야 한다** |
| `npx electron test/detail/extract-harness.js` | **A1_OK** (41개 검사 ✔, exit 0) | fixture 3종(offer/nodesc/taobao) + downloadImages(file·가짜 세션 404/타임아웃·동시 4·Referer·webp→png) |
| `npx electron test/detail/ocr-harness.js` | **OK OCR_OK** | Vision 15장 1.67초 재현율 100%(51/51), tesseract 4장 88.2%, `--no-swiftc` 자식 → `NOSWIFTC_OK` + 한국어 안내 |
| `npx electron test/detail/image-harness.js` | **OK A2_OK** (`/tmp/seedhack-qa/seedhack-qa-image.log`) | 단색 7장 색 차이 0.00/255, 재OCR CJK 44→0, 트림 뒤 CJK 0, before/after `test/detail/img/out/` |
| `node test/detail/copy-harness.js --rules` | **OK 카피 하네스** (rules · 섹션 13 · cuts 1 · 금지어 0) | |
| `npx electron test/detail/render-harness.js` | **A4_OK** (`/tmp/seedhack-qa/seedhack-qa-render.log`) | clean 10,468 / dark 10,410 / pop 10,603px, long·empty·pipeline 변형 포함 점검 "문제 0개" |
| `npx electron test/detail/e2e.js` | **E2E_OK** (`/tmp/seedhack-qa/seedhack-qa-e2e.log`) | 73 이벤트 6.4초, 9단계·pct 단조, 취소·재렌더·실패·fromPage 보낸이 전부 ✔, "대체 동작 단계: 없음". 결과 폴더 `…/seedhack-detail-test/e2e/detail/20261009-022137-712345678901`(③ 재렌더로 **dark** 가 됨) + ④ `…-022148-…-p2hnu1`(clean). 사본 `/tmp/seedhack-qa/e2e-out/{dark-022137,clean-p2hnu1}/` |
| `npm run selftest` | **SELFTEST_OK** (exit 0, `/tmp/seedhack-qa/seedhack-qa-selftest.log`) | `LISTUP_FAIL Cannot set properties of null`·`CAPTURE_FAIL UnknownVizError` 2줄 있음 — `git diff --name-only` 에 `src/renderer/listup.js`·`src/main/main.js` 캡처 코드 변경 없음(main.js 변경은 import·initDetail·nav 문구 3곳뿐) → **이번 작업 전부터 있던 것**으로 판단 |
| `node --check` 새 JS 35개(변경 5개 포함) | 전부 통과 | figma code.js 포함 |
| 보조: `/tmp/seedhack-qa/ocr-slices.mjs` (완성 슬라이스 Vision OCR) | 아래 D-10 | `src/main/detail/ocr.js` 의 `ocrFile` 사용 |
| 보조: `/tmp/seedhack-qa/panel-harness.mjs` (panel.html + 실제 preload) | **PANEL_QA_OK**, 렌더러 console error 0 | 캡처 `/tmp/seedhack-qa/shots/1~7` |
| 보조: `/tmp/seedhack-qa/lint.mjs` (e2e copy.json 에 lintCopy) | 두 작업 모두 issues 0, 가격 패턴 0 | |

## 1. 체크리스트 판정

### A. 추출 (A1)
| 항목 | 판정 | 증거 |
|---|---|---|
| A1-1 | ✅ | extract-harness: 제목·가격 {12.8,15.5}·속성 10·옵션 3·갤러리 3·상세 12(페이지 순서 d01…d12)·상세 글 66자·상점 |
| A1-2 | ✅ | extract-harness "갤러리 3장 — _sum.jpg·?x-oss-process·_.webp 꼬리 제거·중복 제거", "40px 아이콘·data: 구분선 제외" + extract-core.test.js(55개 중 15개) |
| A1-3 | ✅ | "지연 로딩(data-lazyload-src·data-src·data-original) 4장 포함", "d12 w=790"(속성값) |
| A1-4 | ✅ | 가짜 세션 9장 → ok 7 / fail 2(404·aborted) · 최대 동시 4 · Referer 1688/타오바오 · w/h/bytes 기록 · webp→png |
| A1-5 | ✅ | `#sg-detail-btn` "📄 상세페이지 만들기" top16/right33 → 클릭 → `detail:fromPage` raw 수신 → "✔ 만들기 시작 — …" |
| A1-6 | ✅(fixture) / ➖(실사이트) | offer-taobao.html 7개 검사 ✔. 티몰은 타오바오 규칙 공유, 전용 fixture 없음(원칙상 실사이트 접속 금지) |
| A1-7 | ✅ | SELFTEST_OK, `CN_PICK → 리스트업 12.5`, `HOVER_1688` 정상. cn.cjs 기존 코드 수정은 `offerId()` file:// 분기 1줄(git diff 확인) |

### B. OCR·지우기 (A2)
| 항목 | 판정 | 증거 |
|---|---|---|
| B-1 | ✅ | ocr-harness: d01~d12 전부 상자 ≥1, 재현율 100% (51/51) |
| B-2 | ✅ | tesseract 4장 상자 5/4/5/3(88.2%), `--no-swiftc` 로 vision 요청 → 실제 tesseract. none 하강은 코드 경로(`ocr.js getTessWorker catch → prov="none"`) + index.js 자체 none 대체 |
| B-3 | ✅ | image-core.test.js + 실제 샘플 7장 "최대 평균 색 차이 0.00/255" |
| B-4 | ✅ | `test/detail/img/out/d03-before.png`→`d03-after.png` 를 Read 로 확인: 세로 그라데이션 위 글 4줄이 사라지고 이음새·띠 자국 없음 |
| B-5 | ✅ | g01/d05/d06/d12 사진 위 글자 `kept`/`onPhoto:true` (image-harness) |
| B-6 | ✅ | 단색·그라데이션 9장 CJK 44 → 0 (0%) |
| B-7 | ✅ | `NOSWIFTC_OK`: "swiftc 가 없어 … `xcode-select --install` … tesseract OCR 로 대신합니다" |

### C. 번역·카피·구성 (A3)
| 항목 | 판정 | 증거 |
|---|---|---|
| C-1 | ✅ | copy.test.js "C-1 …" 통과, `--rules` 하네스 스키마 통과·섹션 13, e2e 기본 경로가 rules(비용 0) |
| C-2 | ✅(담당 실측, QA 재호출 안 함) | `test/detail/fixture/copy-sample.meta.json`: `how:"cli"`, `cli:sonnet`, 58.1초, $0.0894, 출력 5,851토큰, `rawValid ok`, 정책 약속 6건 → 정화 4건 → `finalLint ok`. createdAt 2026-10-08T17:20Z(=09 02:20 KST). 비용 절약을 위해 QA 는 재호출하지 않았다 |
| C-3 | ✅ | copy.test.js "C-3 lintCopy / sanitizeCopy" 통과; e2e copy.json 두 건 `lintCopy` → issues 0 (`/tmp/seedhack-qa/lint.mjs`) |
| C-4 | ✅ | copy.test.js "C-4 숫자 검증". e2e copy.json 의 단위 숫자 {15kg, 2cm, 25cm, 5cm, 30%, 60cm, 60L} 전부 source attrs/OCR 에 존재(python 대조) |
| C-5 | ✅ | plan-core.test.js 15개 통과. e2e plan.json: 섹션 순서 hero→pain→usp→feature×8→gallery→spec→size→package→notice→faq→cta, cuts `d07 → d07_01 (598×1500)`, dropped d02/d09(blank) |
| C-6 | ✅ | translate.js 미변경(git diff 에 없음). e2e "번역 호출 2회 · 73문장(40개 단위 묶음)", 재렌더 "번역 호출 0". index.js 는 `translate.json`/`trMap` 으로 이미 번역된 문장을 다시 보내지 않음(index.js:352~366) |

### D. 템플릿·렌더·피그마 (A4)
| 항목 | 판정 | 증거 |
|---|---|---|
| D-1 | ✅ | render-harness clean/dark/pop 모두 A4 샘플 plan 렌더(4·4·5장). e2e 도 clean→dark 재렌더 성공 |
| D-2 | ✅ | e2e dark: 780×{1474,2701,2997,3000,1719,2681,1251} 합 15,823 / clean: 합 15,871 — 전부 ≤3000·≤10MB(최대 404KB)·JPG. 하네스 clean 10,468 등 6,000~20,000 범위 |
| D-3 | ✅ | base.css 변수(본문 24/헤드라인 46/캡션 22) + render-core `check()` 실측 "본문 최소 24px · 헤드라인 46(pop 50) · 캡션 22 · 최소 대비 clean 5.02 / dark 8.47 / pop 4.70" |
| D-4 | ✅ | hero 1062/1062/1080px(≤1100), 사진+헤드라인+보조문+배지 3개 한 장(`/tmp/seedhack-qa/e2e-out/dark-022137/01.jpg`, `test/detail/out/pop/01.jpg` Read). 긴 헤드라인(60자) fixture 도 1080 |
| D-5 | ✅ | `check()` "이미지 1.5배 초과 확대" 0건; overlay 띠는 `test/detail/out/dark/02.jpg` Read("사방 통풍 구멍"·"두꺼운 PP 소재"·"물로 씻어 말리면 끝" 반투명 띠) |
| D-6 | ✅ | empty-clean 섹션 9개(pain/faq/gallery 없음). long-pop/01.jpg Read: 4줄 헤드라인·긴 배지 줄바꿈, 잘림·말줄임 없음 |
| D-7 | ✅ | e2e out/preview.png(195×3956)·page.html 존재, Read 로 preview 확인 |
| D-8 | ✅ | figma-manifest.json(dark·780·assets 12·레이어 이름 `#hero.badge.1`·`#feature.1.image`·`#spec.1.k` … FIGMA.md 표와 일치) + figma-bundle.json 9.2MB(`images["clean/g01.png"] = {mime,w:800,h:710,base64}`). FIGMA.md 에 레이어 표·템플릿 만드는 법·개발 플러그인 가져오기 순서·사용 순서·한계 있음 |
| D-9 | ✅(주의 1건) | manifest `api 1.0.0 / main code.js / ui ui.html / networkAccess 없음 / editorType figma / documentAccess dynamic-page`; code.js `figma.*` 만(fetch 없음), `node --check` 통과, 레이어 0개면 `figma.createFrame` 오토레이아웃 생성(code.js:66~). 글자 교체는 `loadFontAsync` 뒤 `characters`(setText), dynamic-page 는 `page.loadAsync()` 처리. **주의**: `"id": "seedhack-detail-fill"` — 피그마 plugin id 는 피그마가 발급하는 숫자 문자열이라 "Import plugin from manifest" 때 거부될 수 있음(아래 재작업) |
| D-10 | ✅(그림 안) / ➖(자동 계측) | `/tmp/seedhack-qa/ocr-slices.mjs` 로 e2e 슬라이스 14장 + 하네스 13장에 Vision OCR: **CJK 상자가 전부 캡션 글 영역**(y 좌표가 `.cap-box` 위치, 예 04.jpg y=506/555/1377/1465) — e2e 가짜 번역("[한글] 원문")의 한계이지 **그림 안에 남은 중국어는 0**(사진 띠 d05/d06/d12/g01 은 A2 bandCut 으로 잘려 나감, 슬라이스 Read 로 확인). 단 Vision 이 **한글을 한자로 오인**(예 "주의"→"茶旦", "PP 재질"→"PP企")해 한글만 있는 하네스 슬라이스에서도 CJK 1~4개가 나오므로 "OCR CJK 0개" 자동 판정은 신뢰할 수 없다 → 계측 기준은 ➖, 사람 판정은 ✅ |

### E. 화면·오케스트레이터 (A5)
| 항목 | 판정 | 증거 |
|---|---|---|
| E-1 | ✅ | panel-harness: `auth {gate:true,licensed:false}` 전송 → `tDetail.disabled=true`, 해제 → false(gate.js:19). `#tDetail` 클릭 → `detail.hidden=false, siteHint.hidden=true, listup.hidden=true, nav.on=tDetail, nav:tab 1회`. main.js nav 문구 분기·`showDetail()` 코드 확인. 캡처 `/tmp/seedhack-qa/shots/1-pick.png` |
| E-2 | ✅ | E2E_OK: raw 15/15 · clean 전부 · out/*.jpg 7장 · preview · page.html · figma-manifest/bundle(base64 12장) |
| E-3 | ✅ | e2e "9단계 모두 등장 / step 순서 단조 / pct 단조 증가(0.8→100) / download·ocr·clean done/total" |
| E-4 | ✅ | `shots/2-work-ocr40.png`: 점 애니 제목("…" 가 1~3개로 순환), 순환 부제("이미지 속 문장 상자 읽는 중"↔"중국어 글자 찾는 중"), 41%, 단계 체크(download done 15/15, ocr now 9/15), 격자 15칸 점등+썸네일, 미니 터미널 12줄, 경과 0.50s. 1.5초 이벤트 공백 뒤 41%→43%(상한 49.5 미만 보간)·2.33s 경과 — 멈춤 없음. 숫자는 전부 이벤트 값(15장·字 n개·🧹 n). `shots/4-done.png` 완료 체크+불꽃 28개 |
| E-5 | ✅ | `shots/5-result.png`: 세로 미리보기 7장(naturalWidth 780, file://), 버튼 "📂 폴더 열기 | 🎨 피그마 묶음 | 🌐 HTML | ↻ 다른 템플릿 | ✕ 닫기"(4종+닫기), ↻ 누르면 템플릿 카드 3개. e2e ③ 재렌더 "OCR·번역 재실행 없음(ocr.json mtime 동일·번역 호출 0)". ※ "🎨 피그마 묶음" 은 저장 대화상자가 아니라 `shell.showItemInFolder` 로 파일을 보여 준다(기능상 충분) |
| E-6 | ✅ | e2e ② 취소 → fail(cancelled) · result.json status=cancelled · 멈춘 단계 ocr |
| E-7 | ✅ | e2e ④ 이미지 0장 → "✕ 이미지 내려받기 단계 실패 · 이미지를 한 장도 받지 못했습니다" 뒤 같은 프로세스에서 fromPage 정상 완료. `shots/7-fail.png`. index.js start() IIFE 가 try/catch/finally 로 감쌈(index.js:496~513) |
| E-8 | ✅ | SELFTEST_OK · node --check 전부 통과 |
| E-9 | ✅ | CDP `Emulation.setEmulatedMedia prefers-reduced-motion:reduce` → `matchMedia(...).matches=true`, 완료 때 `.dt-spark` 0개·`.dt-done` animation none·0.3초 뒤 결과 화면. 발표 모드(`body.present`) 캡처 `shots/3-work-render-present.png`: % 60px, 제목 34px — 큰 화면에서 읽힘 |

### F. 전환율·완성도 (사람이 보듯)
| 항목 | 판정 | 증거 |
|---|---|---|
| F-1 | ✅(규칙 카피는 보강 권장) | dark/01.jpg: "빨래바구니 하나로 정리 끝" + 사진 큼 + 배지 3 → 무엇을·왜는 3초 안에 읽힘. 보조문 "두꺼운 재질 · 접이식 · 넉넉한 용량 · **PP 재질**" 은 두꺼운 재질/PP 재질 중복, "누구에게"가 없음(규칙 경로 한계). AI 경로 샘플(copy-sample.json "빨래 더미 사라지는 큰 바구니 / 접었다 펼쳤다, 공간 걱정 없이")은 충분 |
| F-2 | ✅ | e2e plan.json 섹션 순서 = hero→pain→usp→feature→gallery→spec→size→package→notice→faq→cta (01~07.jpg Read 로 확인) |
| F-3 | ✅ | lintCopy issues 0, 가격 패턴(원/₩/¥) 0, 단위 숫자 전부 원문에 있음. 단 ① 규칙 notice 기본 문장 "배송 중 포장 눌림이 있을 수 있으나 사용에는 문제가 없습니다" 는 원문 근거 없는 서술(숫자·효능은 아님) ② 캡션 d08 "支持定制LOGO 欢迎咨询"(맞춤 로고·문의 환영: 도매 B2B 문구)·notice "请以实物为准 介意者慎拍"(중국 셀러 관용구) 가 그대로 통과 — 아래 재작업 |
| F-4 | ✅(그림) / ➖(로고) | 그림 안 중국어 0(D-10). 캡션 속 중국어는 e2e 가짜 번역 탓. 워터마크·로고는 샘플에 없어 판정 불가(➖) |
| F-5 | ✅ | `test/detail/out/{clean,dark,pop}/01.jpg` Read: 화이트+초록 둥근 카드 / 검정+금선 / 노랑·코랄·파랑 블록+두꺼운 테두리 — 분위기가 분명히 다르고 섹션 구조 동일 |
| F-6 | ❌ | preview.png·슬라이스 Read 결과 어색한 곳 2가지: ① **dark 06.jpg 구성품 섹션 이미지 `clean/d07_01.png`(598×1500 조각)** 이 위쪽 상자 하나·거대한 흰 여백·아래쪽 상자 하나로 보여 1,500px 가까이가 거의 빈 흰 판 — A2 트림이 d07 의 产品尺寸 윗줄(y 84~240)을 잘라낸 뒤 A3 가 "包装清单 머리글 조각"을 package 이미지로 골라 생긴 것(A3 보고서 9절도 인지). ② 02.jpg usp 카드·feature 의 d01 등은 지운 뒤 **연한 사각형만 남은 빈 그림**(fixture 가 도형뿐이라 생기는 한계, 실사진에서는 덜함). 겹침·잘림은 없음 |
| F-7 | ❌ | `docs/detail/REPORT.md` 없음, 프로젝트 README.md 에 📄 상세페이지 사용법·피그마 순서·알려진 한계 없음(README 의 "상세페이지" 는 광고 전환율 표). 플러그인 README·FIGMA.md 만 있음 — 아침 지휘자 몫이지만 현재 시점 불합격 |

## 2. 코드 리뷰 (심각도 상/중/하 · 파일:줄)

(a) 윈도우 경로
- 하 `src/main/detail/render.js:145-147` page.html 의 글꼴 URL 이 앱 설치 경로의 **절대 file:// 주소** → 앱을 업데이트·이동하면 page.html 글꼴만 깨짐(슬라이스 JPG 는 무관). 윈도우 자체는 `pathToFileURL` 로 안전.
- 확인 ✓ `src/renderer/detail.js:10 fileUrl()` 백슬래시→`/`, `C:` 보존(`file:///C:/…`). `plan-core.js:45 relPath()` 역슬래시 정리. `index.js:452` `path.join(dir, c.src)` 로 `/` 상대경로를 OS 경로로 환원. `ocr.js:22-26` swiftc 는 darwin 전용, tesseract `cachePath` 는 userData.

(b) 예외가 앱을 죽일 수 있는 곳
- 중 `src/main/detail/index.js:464` 재렌더(`↻ 다른 템플릿`) 시작에서 `fs.rmSync(out)` 을 먼저 지우고 렌더 → 템플릿 렌더와 자체 렌더가 둘 다 실패하면 **이전 결과 파일이 사라지고** result.json 은 이전 `slices` 를 그대로 가리킴(status 는 failed 로 바뀌지만 목록의 preview/slicePaths 가 깨진 경로). 앱은 죽지 않음. → 새 out 을 임시 폴더에 만들고 성공했을 때 바꿔 끼우기.
- 중 `src/main/detail/extract.js:40 closeDecoder()` 가 숨은 창을 `destroy()` 로 닫음. A4 보고서대로 Electron 44 에서 `destroy()` 직후 다음 오프스크린 창이 `ERR_FAILED` 로 죽는 현상이 있다면 webp/gif 를 한 장이라도 받은 작업은 ⑧ 렌더(오프스크린 창)가 실패 → 자체 렌더(renderLite)로 떨어질 수 있음. e2e fixture 는 전부 png 라 검증되지 않음. `render.js:200 closeWindow()` 처럼 `close()`+`closed` 대기로 통일 권장.
- 하 `index.js:285` ocr onProgress 에 `boxes` 가 없는데(ocr.js 는 `{done,total,id}` 만 줌) 메시지가 `字 d01 · 글자 상자 ?개` 로 찍힘 — 미니 터미널에 "?개" 가 15줄 보임(가짜 숫자는 아니지만 미완성처럼 보임). boxes 없으면 "·" 로.
- 확인 ✓ `index.js:496-513` 파이프라인 전체가 async IIFE try/catch/finally, `emit→send` 는 `win.isDestroyed()` 가드(main.js:64). `render.js:169 finally closeWindow`. `extract.js:66-82` 장당 try/catch. 핸들러 밖 throw·await 없는 promise 는 없음(`detail.js:125 pickTpl` 의 `invoke(...).catch(()=>{})` 등 처리됨).

(c) 1688 추가 요청
- 하 `src/preload/cn.cjs` `fetchDetailHtml()`(버튼 클릭 시 detailUrl 1회) — 기존 `readDetailText()` 가 페이지 진입 때 이미 같은 주소를 1회 받으므로 상품 한 페이지당 **합계 2회**. 규약 "detailUrl 1회 허용" 의 취지(추가 요청 최소화)엔 맞지만 결과를 공유하면 1회로 줄일 수 있음.
- 하 `cn.cjs wakeLazy()` 가 사용자 화면을 20단계 스크롤(최대 6초) → 1688 페이지 자체의 지연 로딩 이미지 요청이 일어남(앱이 보내는 요청은 아님). 사용자 눈에 화면이 튀는 점은 안내 문구로.
- 확인 ✓ 이미지 내려받기는 `extract.js` 세션 fetch + Referer(허용), 그 외 1688 요청 없음. 테스트는 fixture 만.

(d) 금지어·가격
- 확인 ✓ 가격은 source.json 에만 저장되고 copy/plan/렌더에 없음(lint.mjs 가격 패턴 0). lintCopy 금지어 0.
- 중 `src/main/detail/copy.js rulesCopy` 캡션·notice 는 OCR 줄을 그대로 옮겨서 도매 문구(定制LOGO·欢迎咨询·批发·起订·咨询)·중국 셀러 관용구(介意者慎拍)가 소비자 상세페이지에 들어감(e2e d08 캡션, notice 3번째). `WHOLESALE_KEY` 는 속성표(spec)에만 적용됨 → OCR 줄에도 같은 필터 + "介意者慎拍/谨慎购买/亲/掌柜" 류 관용구 제거.
- 하 규칙 notice 기본 문장 "배송 중 포장 눌림이 있을 수 있으나 사용에는 문제가 없습니다"(copy.js 기본 문장) 는 원문 근거 없는 품질 서술 — 중립 문장으로 바꾸는 편이 안전.

(e) 민감 정보 로그
- 확인 ✓ 로그는 jobId·파일 경로·장수만. `cli.js` 는 Claude CLI 자식에 process.env 를 통째로 넘기지만(기존 ai-cli.js 와 동일) 로그엔 남기지 않음. `copy.js viaServer()` 는 vendor_id+카피 입력(제목·속성·OCR 번역)만 전송 — 기존 cn:ai 와 같은 범위. Wing/비밀번호/토큰 로그 없음.

(f) 그 밖
- 하 `package.json` build 설정(`files: tools/ocr-mac/**`, `asarUnpack: tesseract.js*, tools/ocr-mac/**`) 이 바뀌어 있음 — 담당 소유 표에 없는 파일(지휘자 결정이면 OK). `ocr.js:11` 가 `app.asar.unpacked` 경로를 가정하므로 설정과 짝이 맞음.
- 하 `detail.js:131` 리스트업 행 ▶ 는 "주소 복사 + 1688 탭 열기 + 안내" 만(규약대로). 시연에서 "딸깍 한 번" 은 1688 화면의 📄 버튼이라는 점을 안내 문구가 설명하고 있음.
- 하 `figma-plugin/seedhack-detail/manifest.json` `"id"` 가 숫자가 아닌 문자열 — 피그마 가져오기 때 "Invalid plugin id" 가 날 수 있음(피그마는 id 를 스스로 발급). 키를 지우면 가져오기 때 자동 추가됨.
- 하 e2e(`test/detail/e2e.js`) 의 가짜 번역이 "[한글] " 접두 + 원문이라 D-10/F-4 의 "중국어 0" 자동 판정이 e2e 로는 영영 불가능. `test/detail/fixture/source-sample.json` 에 이미 zh→ko 63쌍(`translations`)이 있으니 그것을 가짜 번역 사전으로 쓰면 캡션까지 한글이 되어 OCR 판정이 의미를 가짐(한글 오인 문제는 남음).
- 하 e2e dark/05.jpg: 스펙 "규격 40*30*60cm"(속성표) 와 사이즈 안내 "产品尺寸 40*30*25cm"(OCR) 가 한 페이지에 공존 — source-sample fixture 자체가 모순이지만 실제 페이지에서도 생길 수 있는 상황(속성표 우선 등 규칙 없음).

## 3. 지휘자에게 보내는 재작업 목록 (우선순위 순)

1. **A3 (중) 도매·중국 셀러 문구 필터** — `copy.js rulesCopy`/`sanitizeCopy` 의 캡션·notice·size_note·package 에도 `WHOLESALE_KEY`(定制|批发|起订|咨询|LOGO|代发|货源 …) + 관용구(介意者慎拍|谨慎拍|亲|掌柜|客服) 줄 제거. AI 경로는 `COPY_SYSTEM` 에 "도매·문의 유도 문구 금지" 한 줄. 증거: e2e d08 캡션 "支持定制LOGO 欢迎咨询", notice "请以实物为准 介意者慎拍" (`/tmp/seedhack-qa/e2e-out/dark-022137/04.jpg`, `06.jpg`).
2. **A2+A3 (중) 구성품/사이즈 섹션의 빈 그림(F-6 ①)** — A2: `findTrimRect` 가 d07 처럼 "위쪽 글 머리글 + 아래 도형" 인 긴 이미지에서 产品尺寸 줄(y 84~240)을 지운 뒤 통째로 잘라 버리는 대신, 지운 상자 자리를 '내용 있음' 으로 보지 않더라도 **조각(cut) 경계 안에서 큰 빈 구간(예 ≥400px 연속 배경)을 접는 2차 트림** 또는 A3: `consider()` 에서 조각의 '내용 비율'(배경 아닌 픽셀 비율, A2 가 `rec.trim.content` 로 넘김)이 낮으면 `image:null`(글만). 증거: `dark-022137/06.jpg` 구성품 그림.
3. **A5 (중) 재렌더 실패 시 이전 결과 보존** — `index.js:464` out 삭제를 렌더 성공 뒤로 미루기(임시 폴더 → rename). 
4. **A1 또는 A5 (중, 확인 필요) 디코더 창 destroy() 와 오프스크린 렌더 충돌** — `extract.js:40` 을 `close()`+`closed` 대기로 바꾸고, fixture 에 webp 1장을 섞은 e2e 변형(`extra.webp` 이미 있음)으로 ⑧ 렌더가 `render`(lite 아님) 로 끝나는지 확인.
5. **A4 (하) 피그마 manifest `id` 제거** 또는 피그마가 발급한 숫자 id 로 교체 + FIGMA.md 에 "가져오기 때 id 오류가 나면 id 줄 삭제" 한 줄. (피그마 실행 검증은 아침 사람 몫.)
6. **A5 (하) OCR 진행 메시지 "?개"** — `index.js:285` boxes 없으면 "·" 또는 생략. 
7. **A5 (하) e2e 가짜 번역을 fixture 사전으로** — D-10/F-4 를 e2e 에서 자동 판정할 수 있게. 
8. **A3 (하) 규칙 헤드라인·보조문 다듬기** — 보조문 배지 중복(두꺼운 재질/PP 재질) 제거, 대상 고객 한 마디("가족 빨래가 많은 집") 추가; notice 기본 문장 "포장 눌림…" 을 중립 문장으로. 
9. **지휘자 (❌ F-7) `docs/detail/REPORT.md` + 프로젝트 README 사용법 절** — 앱에서 딸깍 → 폴더 → 쿠팡 등록, 피그마 연동 순서(FIGMA.md 링크), 알려진 한계(윈도우 OCR 품질·실사이트 미검증·로고/워터마크·배포판 AI 서버 중계 미구현·Claude CLI 1회 $0.09/50~70초).
10. **지휘자 (확인) copy.js 동시 수정 마무리 뒤 `node --test` 한 번 더** — QA 중 1차 실행은 `WHOLESALE_KEY` 미정의로 8개 실패했고, 2차 55/55 였으나 파일이 그 뒤에도 바뀌고 있었다.

## 4. 이번 밤 범위 밖으로 둬도 되는 것
- 실제 1688·타오바오·티몰 페이지에서의 추출·내려받기·📄 버튼(원칙상 접속 금지, 아침에 사람이 1회 확인). 티몰 전용 fixture.
- 피그마 데스크톱에서 플러그인 실제 실행(문법·API 검토만 함).
- 윈도우 실기 검증(tesseract 품질·asar 언팩·경로) — 코드 리뷰로는 문제 없음.
- 배포판 AI 서버 중계(`task:"detail"` 서버 처리기) — 현재는 rules 로 안전하게 떨어짐.
- 로고·워터마크 제거(OCR 로 못 잡음, F-4 ➖).
- Vision 이 한글을 한자로 오인하는 문제(OCR 자동 판정용일 뿐, 파이프라인 결과엔 영향 없음 — 한글이 그려진 입력 이미지는 없음).
- 속성표와 OCR 의 치수 모순 조정(fixture 모순).
- page.html 글꼴 절대경로.

## 5. 캡처·증거 경로
- 화면: `/tmp/seedhack-qa/shots/1-pick.png`(고르기) `2-work-ocr40.png`(작업 중 41%) `3-work-render-present.png`(렌더 95%·발표 모드) `4-done.png`(완료 축하) `5-result.png` `6-result-scrolled.png`(결과) `7-fail.png`(실패)
- e2e 슬라이스 사본: `/tmp/seedhack-qa/e2e-out/dark-022137/01~07.jpg, preview.png, plan.json, copy.json`, `/tmp/seedhack-qa/e2e-out/clean-p2hnu1/01~07.jpg, preview.png`
- 하네스 미리보기: `test/detail/out/{clean,dark,pop,long-*,empty-clean,pipeline-clean}/`
- 로그: `/tmp/seedhack-qa/seedhack-qa-{e2e,render,image,selftest}.log`
- 보조 스크립트: `/tmp/seedhack-qa/ocr-slices.mjs`(슬라이스 OCR), `panel-harness.mjs`(화면), `lint.mjs`(카피 lint)

## 6. 최종 판정(지휘자, 2026-10-10 02:45)
재작업 10건 반영 후 재검증: 단위 59/59 · 하네스 5종 OK · E2E_OK · SELFTEST_OK. F-6(구성품 빈 그림) → 조각 트림·contentRatio 제외로 해결(남은 연한 사각형은 fixture 자리표시 도형). F-7 → README 사용법 절 + `docs/detail/REPORT.md` 작성. ➖ 항목(실사이트·피그마 실행·윈도우 실기·로고)은 범위 밖으로 유지.
