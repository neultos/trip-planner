#!/usr/bin/env bash
# 테스트 APK 빌드. 안드로이드 빌드는 한글 경로에서 막혀서 영문 임시 폴더로 복사해 빌드함
set -euo pipefail
cd "$(dirname "$0")"
B="${WT_BUILD_DIR:-$TEMP/wtbuild}"
: "${GRADLE:=$LOCALAPPDATA/Programs/gradle-8.11.1/bin/gradle.bat}"
rm -rf "$B" && mkdir -p "$B"
cp -r settings.gradle.kts build.gradle.kts gradle.properties local.properties app "$B"/
rm -rf "$B/app/build"
(cd "$B" && "$GRADLE" --no-daemon --offline -q :app:assembleDebug)
mkdir -p build && cp "$B/app/build/outputs/apk/debug/app-debug.apk" build/wetrip-test.apk
echo "build/wetrip-test.apk"
