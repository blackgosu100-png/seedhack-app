# ⬆ 화면만 바로 업데이트 (친마 통합대시보드 방식)

고친 코드(src/·tools/ocr-mac·tools/cutout-mac)만 올리면, 켜져 있는 씨드핵이 10분 안에(새로 켜면 20초 뒤) 받아서 위쪽에 **"⬆ 새 버전 ○○ · 바로 적용"** 버튼을 띄운다. 누르면 몇 초 뒤 다시 켜지며 새 코드로 돈다. 설치 파일(155MB)은 다시 받지 않는다.

## 올리는 법 (대표님 맥)
```
cd ~/projects/140_coupang-signal-app && npm run hot -- "고친 내용 한 줄"
```
- 바뀐 파일만 GitHub `blackgosu100-png/coupang-signal-releases` 의 `hot/files/<sha256>` 로 올라가고, 서명한 `hot/manifest.json`·`hot/manifest.sig` 가 마지막에 올라간다.
- 서명 비밀 열쇠: `~/.seedhack/hot-key.pem` (이 맥에만. 잃어버리면 `--init-key` 로 새로 만들고 설치 파일을 다시 배포해야 함)
- 미리 보기: `npm run hot -- --dry`

## 이 방식으로 못 보내는 것 → 설치 파일로
- package.json 의 dependencies·Electron 버전·`src/boot.js`·빌드 설정
- 이때는 package.json `seedhackShell` 숫자를 1 올리고 설치 파일을 배포한다(그보다 낮은 설치본은 새 화면 업데이트를 받지 않음).

## 안전장치
- 서명이 맞지 않는 목록, 확인 값(sha256)이 다른 파일은 받지 않는다.
- 켤 때마다 "시도 중"을 적고 화면이 뜨면 지운다. 표시가 남은 채 다시 켜지면(켜다가 죽음) 그 버전은 버리고 설치본으로 켠다.
- 설치 파일을 새로 만들면(`src/hot-base.json` 시각) 그보다 오래된 화면 업데이트는 쓰지 않는다.
- 끄기: 환경변수 `SEEDHACK_NO_HOT=1`. 개발 실행(`npm start`)은 `SEEDHACK_HOT=1` 일 때만 쓴다.

## 시험 (2026-10-26, 맥 · 가짜 서버 폴더)
- 고친 파일 1개 → 받은 파일 2개 14KB, 나머지는 설치본에서 복사
- 목록 한 글자 위조 → 서명 불일치로 거부
- 새 코드 안에서 exceljs 같은 패키지 import 정상(registerHooks 로 설치본 node_modules 사용)
- 켜다가 죽게 한 버전 → 다음 켬에서 버리고 설치본으로 켜짐
