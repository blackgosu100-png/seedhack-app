#!/bin/sh
# 윈도우 설치 파일 빌드 → GitHub 릴리스(blackgosu100-png/coupang-signal-releases)에 설치 파일·blockmap·latest.yml을 한 번에 올린다.
# 사용: package.json의 version을 올린 뒤 `npm run release:win`
set -e
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
REPO=blackgosu100-png/coupang-signal-releases
if gh release view "v$V" -R "$REPO" >/dev/null 2>&1; then echo "✕ v$V 릴리스가 이미 있습니다. package.json의 version을 올려 주세요."; exit 1; fi
rm -f dist/builder/latest.yml
node scripts/hot-base.mjs
npx electron-builder --win nsis --x64 --publish never
grep -q "version: $V" dist/builder/latest.yml || { echo "✕ latest.yml 버전이 $V가 아닙니다"; exit 1; }
# 고정 다운로드 링크용 복사본(버전 숫자 없음): https://github.com/$REPO/releases/latest/download/SeedHack-Setup.exe
cp "dist/builder/SeedHack-Setup-$V.exe" dist/builder/SeedHack-Setup.exe
gh release create "v$V" -R "$REPO" --title "$V" --notes "씨드핵 SEEDHACK $V" \
  "dist/builder/SeedHack-Setup-$V.exe" "dist/builder/SeedHack-Setup-$V.exe.blockmap" dist/builder/latest.yml dist/builder/SeedHack-Setup.exe
echo "■ v$V 배포 완료 — 윈도우 설치판이 켜질 때 자동으로 받아 갑니다."
echo "  고정 다운로드 링크: https://github.com/$REPO/releases/latest/download/SeedHack-Setup.exe"
