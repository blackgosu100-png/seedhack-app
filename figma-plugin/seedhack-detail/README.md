# 씨드핵 상세페이지 채우기 — 피그마 개발 플러그인

앱(씨드핵 📄 상세페이지)이 만든 `out/figma-bundle.json` 을 피그마에 꽂아 넣는 플러그인입니다. 네트워크 접속 없이 붙여넣기/파일 선택으로만 동작합니다.

## 설치(개발 플러그인 가져오기)
1. 피그마 데스크톱 앱에서 아무 파일이나 연다.
2. 메뉴 **Plugins → Development → Import plugin from manifest…**
3. 이 폴더의 `manifest.json` 을 고른다.
4. **Plugins → Development → 씨드핵 상세페이지 채우기** 로 실행.

## 사용
1. 앱에서 상세페이지를 만들고 **🎨 피그마 묶음** 으로 `figma-bundle.json` 을 연다(또는 작업 폴더 `out/figma-bundle.json`).
2. 플러그인 창에 파일을 고르거나 내용을 붙여 넣고 **채우기**.
3. 현재 페이지에 `#hero.image`, `#hero.headline` … 이름의 레이어가 있으면 그 자리에 이미지·글을 채우고, 없으면 780px 프레임을 새로 만든다.

레이어 이름 규칙과 템플릿 만드는 법: `docs/detail/FIGMA.md`.

## 파일
- `manifest.json` — api 1.0.0, main `code.js`, ui `ui.html`, networkAccess 없음. `id` 는 적지 않는다(개발 플러그인 가져오기 때 Figma 가 숫자 id 를 자동 부여 — 문자열 id 는 거부될 수 있음)
- `code.js` — figma 플러그인 API만 사용(createImage · loadFontAsync · characters · auto-layout 프레임 생성)
- `ui.html` — 붙여넣기/파일 선택 → base64 를 바이트로 풀어 postMessage

## 한계
- 피그마에서 실제로 실행해 본 검증은 아직 없다(API 문서 기준으로 작성). 처음 실행 때 오류가 나면 Plugins → Development → Open console 로 확인.
- 새 프레임 생성 시 글꼴은 Inter(피그마 기본)만 쓴다. 템플릿에 Pretendard 를 쓰려면 템플릿 레이어 방식을 쓴다.
