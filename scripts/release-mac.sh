#!/bin/sh
# 맥 설치 파일(애플 칩·인텔 칩) 빌드 → 지금 최신 GitHub 릴리스에 덧붙여 올린다(같은 이름은 덮어씀).
# 사용: 윈도우 릴리스(`npm run release:win`)를 올린 뒤 `npm run release:mac`
# 주의(2026-11-17): 맥에서는 앱 이름이 한글이면 켜자마자 꺼진다(도우미 앱 이름을 못 찾음) → 맥판만 이름을 SeedHack 으로.
#   애플 개발자 서명이 없어 "확인되지 않은 개발자" 경고가 뜬다 → 처음 한 번 시스템 설정 > 개인정보 보호 및 보안 > "그래도 열기".
set -e
cd "$(dirname "$0")/.."
REPO=blackgosu100-png/coupang-signal-releases
TAG=$(gh release view -R "$REPO" --json tagName -q .tagName)
node scripts/hot-base.mjs
rm -f dist/builder/SeedHack-Mac-*
npx electron-builder --mac dmg --arm64 --x64 --publish never \
  -c.productName=SeedHack -c.mac.identity=- -c.mac.hardenedRuntime=false '-c.mac.artifactName=SeedHack-Mac-${arch}.${ext}'
gh release upload "$TAG" -R "$REPO" --clobber dist/builder/SeedHack-Mac-arm64.dmg dist/builder/SeedHack-Mac-x64.dmg
echo "■ $TAG 에 맥 설치 파일을 올렸습니다."
echo "  애플 칩(M1~): https://github.com/$REPO/releases/latest/download/SeedHack-Mac-arm64.dmg"
echo "  인텔 칩:      https://github.com/$REPO/releases/latest/download/SeedHack-Mac-x64.dmg"
