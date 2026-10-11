# 모듈 간 규약 (CONTRACTS) — 모든 담당이 이 형식을 그대로 따른다

공통: 모든 main 모듈은 ESM(`import`/`export`, package.json `"type":"module"`). 주석·로그는 한국어(기존 코드 톤). 외부 npm 패키지 추가는 tesseract.js 한 개만 허용(A2). 경로는 `path.join` 사용(윈도우 대비).
작업 폴더: `jobDir = path.join(app.getPath("userData"), "detail", jobId)` 하위 `raw/ clean/ out/` + `source.json ocr.json plan.json copy.json result.json`.
jobId = `YYYYMMDD-HHmmss-<offerId 또는 rand6>`.

## 1. DetailSource (A1 → 모두)  `source.json`
```jsonc
{
  "source": "1688" | "taobao" | "tmall" | "other",
  "url": "https://detail.1688.com/offer/123.html",
  "offerId": "123",
  "title_zh": "加厚脏衣篮 折叠收纳筐",
  "price": { "min": 12.8, "max": 15.5, "currency": "CNY" } | null,
  "attrs": [ { "k_zh": "材质", "v_zh": "PP" } ],            // 속성표(순서 유지, 최대 60)
  "options": [ { "label_zh": "灰色", "img": "https://..." } ], // 1단계 옵션(색상 등), 최대 30
  "gallery": [ { "url": "https://..." } ],                  // 대표 사진(큰 원본 주소, _sum/_.webp 꼬리 제거), 최대 10
  "detailImages": [ { "url": "https://...", "w": 790, "h": 1200 } ], // 상세 설명 이미지, 페이지 순서, 최대 40, w/h는 알면
  "detailText_zh": "…",                                    // 상세 글(그림이면 빈 문자열), 최대 20000자
  "shop": { "name": "", "years": 5, "repeat": 23 } | null,
  "readAt": 1760000000000
}
```
- cn.cjs 쪽 함수 이름: `readDetailRaw()` → 위 형식의 "raw" 객체(브라우저에서 바로 읽은 것). main의 `extract-core.js: normalizeSource(raw)` 가 꼬리 제거·중복 제거·개수 제한을 한다.
- IPC: cn.cjs는 `ipcRenderer.invoke("detail:fromPage", raw)` 로 보낸다. 핸들러는 A5(index.js)가 등록하고 내부에서 A1의 `normalizeSource` 를 부른다. A1은 `extract.js` 에 `downloadImages(source, jobDir, { session, onProgress })` 도 제공한다 → 아래 Images.
- 1688 상품 페이지에서 떠 있는 버튼: id `sg-detail-btn`, 글자 "📄 상세페이지 만들기", 화면 오른쪽 위(기존 `#sg-cn-box`와 겹치지 않게). 누르면 읽는 중 표시 → invoke → 결과(`{ok, jobId}` 또는 `{error}`)를 버튼 아래 한 줄로.

## 2. Images (A1 download → A2)
```jsonc
// source.json 의 images 배열 (download 후 추가)
"images": [ { "id": "d01", "kind": "gallery"|"detail"|"option", "url": "...", "file": "<jobDir>/raw/d01.jpg", "w": 790, "h": 1200, "bytes": 123456 } ]
```
- id: gallery `g01…`, detail `d01…`, option `o01…`. 받지 못한 이미지는 배열에서 뺀다(로그만). 파일 확장자는 받은 형식 그대로(jpg/png/webp→nativeImage로 png 저장).
- `downloadImages` 는 `{ ok: n, fail: n }` 를 돌려주고 `onProgress({ done, total, id })` 를 부른다. 동시 4개, 각 15초 제한, Referer `https://detail.1688.com/`(타오바오면 `https://item.taobao.com/`).

## 3. OCR (A2) `ocr.json`
```jsonc
{ "provider": "vision"|"tesseract"|"none", "images": [ { "id": "d01", "w": 790, "h": 1200,
   "boxes": [ { "x": 40, "y": 120, "w": 300, "h": 48, "text": "加厚材质", "conf": 0.93 } ] } ] }
```
API: `ocrImages(images, { onProgress }) → OcrResult` ; `ocrFile(file) → { w, h, boxes }`. 상자는 픽셀 좌표, 한 줄 단위. CJK가 없는 상자(숫자·영문만)는 `text`에 그대로 두되 `latin: true`.
- Vision: `tools/ocr-mac/ocr.swift` 를 첫 실행 때 `swiftc` 로 `userData/detail/bin/ocr-mac` 에 컴파일(없으면 Xcode CLT 안내). 언어 `["zh-Hans","zh-Hant","en-US"]`, level accurate. 출력 JSON(stdout).
- tesseract.js: `chi_sim` (언어 데이터는 처음 한 번 `userData/detail/tessdata` 에 내려받음). 제공자 선택: darwin이고 swiftc 가능 → vision, 아니면 tesseract, 둘 다 안 되면 none(상자 0개, 파이프라인은 계속).

## 4. Clean (A2) `clean/<id>.png`
API: `cleanImage({ file, boxes, out }) → { out, w, h, erased: n, kept: n, boxesOut: [ { ...box, action: "erased"|"kept", bg: "#rrggbb", onPhoto: bool } ] }`
- 상자를 조금 키워(상하좌우 +4px) 둘레 링 픽셀로 배경 추정. 둘레 색 분산이 작으면(단색·그라데이션) 행별로 좌우 끝 색을 선형 보간해 메움(`erased`). 분산이 크면(사진 위 글자) 메우지 않고 `kept` + `onPhoto:true` (템플릿이 반투명 한글 띠로 덮는다).
- 순수 함수는 `image-core.js` (BGRA Buffer 입력, Node 단위테스트 가능), nativeImage 입출력은 `image.js`.
- 추가 API: `resizeToWidth(file, out, 780)`, `imageInfo(file) → {w,h}`, `cropRect(file, out, {x,y,w,h})`.

## 5. 번역 (기존) `src/main/translate.js`
`initTranslate({ store, log }).translate(texts[]) → ko[]` 를 A3·A5가 쓴다. 바꾸지 않는다.

## 6. Copy (A3) `copy.json`
입력 `CopyInput`:
```jsonc
{ "title_zh": "", "title_ko": "", "attrs": [ { "k_zh","v_zh","k_ko","v_ko" } ], "options": [ { "label_zh","label_ko" } ],
  "detailText_ko": "", "images": [ { "id": "d01", "kind": "detail", "w": 790, "h": 1200, "texts_zh": [...], "texts_ko": [...] } ],
  "keyword": "빨래바구니", "coupangName": "리스트업 상품명(있으면)", "category": "" }
```
출력 `Copy`(JSON Schema는 copy-prompt.js의 `COPY_SCHEMA`):
```jsonc
{ "name_ko": "상품명 (쿠팡 등록용, 40자 이내, 키워드 포함)",
  "headline": "첫 화면 한 줄(18자 이내, 혜택/결과 중심)", "sub": "보조 한 줄(30자 이내)", "badges": ["무료배송 제외 — 원문 근거 있는 특징 3개"],
  "pain": { "title": "이런 적 있으시죠?", "items": [ { "icon": "😩", "text": "…" } ] },          // 3개
  "usp": { "title": "그래서 이렇게 만들었습니다", "items": [ { "title": "", "desc": "", "imageId": "d03"|null } ] }, // 3~4개
  "captions": [ { "imageId": "d01", "title": "", "desc": "" } ],  // 상세 이미지마다 한글 제목·설명(원문 OCR 번역 기반)
  "spec": [ { "k": "재질", "v": "PP" } ],                           // attrs 한글 정리(원문에 있는 것만)
  "size_note": "", "package_items": ["본품 1개"], "notice": ["…"], // 각 최대 6개
  "faq": [ { "q": "", "a": "" } ],                                  // 3~5개
  "cta": { "headline": "", "sub": "" },
  "tone": "friendly"|"premium"|"pop" }
```
API: `writeCopy(input, { log, model }) → { copy, how: "cli"|"server"|"rules", costUsd?, error? }`. CLI 없음/실패 → `rules`(규칙 기반)로 반드시 채운다. CLI 러너는 `cli.js: runStructured({ system, schema, text, model, timeoutMs }) → { ok, result } | { error }`.
금지어 검사 `lintCopy(copy) → { ok, issues: [] }`: 최저가·1위·최고·100%·완치·의학적 효능·"쿠팡"·가격 숫자(원/₩) 포함 시 issue. AI 결과에 issue 있으면 그 문장을 규칙 기반 문장으로 교체.

## 7. PagePlan (A3) `plan.json` — 템플릿(A4)의 입력
```jsonc
{ "meta": { "jobId": "", "templateId": "clean"|"dark"|"pop", "width": 780, "createdAt": 0 },
  "product": { "name_ko": "", "keyword": "" },
  "sections": [
    { "type": "hero", "image": "clean/g01.png", "headline": "", "sub": "", "badges": [] },
    { "type": "pain", "title": "", "items": [ { "icon": "", "text": "" } ] },
    { "type": "usp", "title": "", "items": [ { "title": "", "desc": "", "image": "clean/d03.png"|null } ] },
    { "type": "feature", "image": "clean/d02.png", "title": "", "desc": "", "overlay": [ { "x":0,"y":0,"w":0,"h":0,"text":"" } ] }, // 사진 위 글자(kept)는 overlay 띠
    { "type": "gallery", "images": [ "clean/g02.png", ... ] },
    { "type": "spec", "rows": [ { "k": "", "v": "" } ], "image": null },
    { "type": "size", "image": "clean/d07.png", "note": "" },
    { "type": "package", "items": [], "image": null },
    { "type": "notice", "items": [] },
    { "type": "faq", "items": [ { "q": "", "a": "" } ] },
    { "type": "cta", "headline": "", "sub": "", "image": null }
  ] }
```
API: `buildPlan({ source, ocr, cleaned, copy, templateId }) → plan` (순수, plan-core.js). 이미지 분류 규칙: 갤러리 첫 장=hero(없으면 가장 정사각형에 가까운 상세 이미지); 세로가 가로의 2.5배 넘는 긴 이미지는 `cropRect` 로 1500px 단위 분할 요청 목록 `plan.cuts = [{ src, out, rect }]` 를 내고 A5가 자르게 한다; 사이즈 표(OCR에 cm/mm/尺寸 多), 패키지(包装/装箱), 주의(注意/温馨提示) 키워드로 분류. 순서는 위 순서 고정(없는 섹션은 뺌). 이미지 경로는 jobDir 기준 상대경로.

## 8. Render (A4) `out/`
API: `renderPlan({ plan, jobDir, templateId, onProgress }) → { slices: [ { file: "out/01.jpg", w: 780, h: 2400, sections: ["hero","pain"] } ], preview: "out/preview.png", html: "out/page.html", figmaManifest: "out/figma-manifest.json" }`
- 템플릿: `src/renderer/detail-templates/<id>/index.html` + `template.js`(전역 `window.renderPlan(plan, baseUrl)` 가 DOM을 그린 뒤 `document.body.dataset.ready="1"`) + `style.css`. 글꼴은 앱의 `src/renderer/fonts.css`(Pretendard) 재사용.
- 오프스크린 `BrowserWindow({ show:false, width:780, webPreferences:{ offscreen:true } })`, `file://` 로 index.html 로드 후 `renderPlan` 실행, 섹션(`section[data-sec]`)마다 `getBoundingClientRect` → 높이에 맞춰 창 크기 조절·스크롤 후 `capturePage(rect)` → 슬라이스는 섹션을 이어 붙이되 한 장 높이 ≤ 3000px, JPG 품질 88, 가로 정확히 780. `preview.png` 는 전체를 1/4 축소한 한 장.
- figma-manifest.json: `{ "template": id, "width": 780, "sections": [ { "type": "hero", "layers": { "#hero.image": "clean/g01.png", "#hero.headline": "…" } } ], "assets": [ "clean/g01.png", ... ] }` — 레이어 이름 규칙은 `docs/detail/FIGMA.md` 에 표로.
- 피그마 플러그인 `figma-plugin/seedhack-detail/{manifest.json, code.js, ui.html, README.md}`: UI에 manifest JSON 붙여넣기(또는 파일 선택, 이미지는 같은 폴더에서 base64로 읽어 붙여넣는 "내보내기 묶음" `out/figma-bundle.json` 을 앱이 만들어 둔다 → A4 render.js가 생성). 템플릿 페이지의 레이어 이름(`#hero.image` …)을 찾아 이미지 fill·텍스트 교체, 없으면 새 프레임 생성.

## 9. 오케스트레이터·IPC (A5) `src/main/detail/index.js`
`initDetail({ ipcMain, app, win, store, log, translate, getCnSession, send })`
- IPC(패널→main): `detail:list` → 작업 목록 `[ { jobId, title, createdAt, status, preview, sliceCount } ]`; `detail:run` `{ source?: DetailSource, jobId?, templateId, rowId? }` → 파이프라인 시작 `{ jobId }`; `detail:cancel`; `detail:get` `{ jobId }` → result.json; `detail:open` `{ jobId, what: "folder"|"preview"|"figma" }`; `detail:templates` → `[ { id, name, desc, thumb } ]`; `detail:rerender` `{ jobId, templateId }`.
- IPC(1688 화면→main): `detail:fromPage` raw → normalize → `detail:run` 과 같은 흐름 + 패널을 📄 화면으로 전환(`send("nav", { tab: "detail", url: "📄 상세페이지" })`).
- 진행 이벤트(main→패널): `send("detail:progress", { jobId, step, stepIndex, steps: 9, pct, msg, extra })` step ∈ extract|download|ocr|clean|translate|copy|plan|render|done|fail. 이미지 단위 진행은 `extra: { done, total, id, thumb? }`.
- panel.cjs CHANNELS 에 `"detail:progress"`, `"detail:changed"` 추가.
- 화면: `panel.html` 에 `<div class="detail" id="detail" hidden>` 섹션(리스트업처럼 본문 HTML 화면), `panel.js` VIEWS에 `detail: ["📄 상세페이지", "1688 상세 이미지 → 한글 상세페이지 자동 생성 · 피그마 내보내기"]`, `showView` 에서 `$("detail").hidden = v !== "detail"`, siteHint 숨김 목록에 detail 추가. 사이드바 "중국 소싱" 묶음 tChat 아래에 `<button id="tDetail" class="nav-item" type="button" data-view="detail">`. gate.js 잠금 목록에 `"tDetail"`. main.js `nav:tab` 의 안내 문구 분기에 detail 추가(사이트 뷰 아님 → 모든 WebContentsView 숨김은 layout()이 active 로 처리하므로 추가 수정 불필요, `send("nav")` url 문구만).
- 화면 구성(detail.js): 왼쪽 상품 목록(리스트업 행 중 cnUrl 있는 것 + 지난 작업), 템플릿 선택(3개 썸네일), ▶ 딸깍 버튼 → **AI 작업 화면**(detail.css, aiscan 스타일: 점 애니 제목, 순환 부제, 큰 %, 단계 체크, 이미지 격자 점등, 미니 터미널 로그 1줄/초, 경과 ms) → 완료 축하 → 결과: 슬라이스 세로 스크롤 미리보기, `📂 폴더 열기` `🎨 피그마 묶음` `↻ 다른 템플릿으로` 버튼. prefers-reduced-motion 대응.

## 10. 테스트 하네스 규칙
- 순수 모듈: `node --test test/detail/*.test.js` (node:test, 의존성 없음).
- Electron 필요 모듈: `npx electron test/detail/<name>.js` — 스크립트 맨 위에서 `app.setPath("userData", path.join(os.tmpdir(), "seedhack-detail-test"))`, 끝나면 `console.log("OK …")` 후 `app.quit()`. 창은 `show:false`. 네트워크 접속 없음(fixture만). 실패 시 `process.exitCode = 1`.
- fixture: `test/detail/fixture/offer.html`(1688 상품 페이지 흉내: 제목·가격·속성표·옵션·갤러리·상세 이미지 10장 이상·detailUrl 없음) + `test/detail/fixture/img/*.jpg|png` (중국어 글자가 그려진 상세 이미지 — A2가 `test/detail/img/make-samples.js`(electron)로 생성해 두고 A1 fixture도 그 파일을 쓴다. A1은 A2를 기다리지 말고 자리표시 이미지를 먼저 만들어 두되 같은 경로·이름(`img/d01.png`…`d12.png`, `img/g01.png`…`g03.png`)을 쓴다.)
