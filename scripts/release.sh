#!/usr/bin/env bash
# 배포 한 번에: 테스트 → (앱 코드가 바뀌었으면) APK 새로 빌드 → 웹 빌드 → 커밋·푸시(GitHub → Vercel 자동 배포) → 확인
#   scripts/release.sh "이번 변경 한 줄 요약"
# - PWA: 배포만 하면 앱을 다시 열거나 돌아올 때 새 버전이 적용된다 (src/App.jsx).
# - APK: 웹 화면은 서버에서 바로 오므로 자동. 앱 껍데기(~/weekly-report-apk)가 바뀐 경우에만
#   versionCode 를 올려 다시 빌드하고 apk-version.json 을 갱신한다 → 앱이 켜질 때 업데이트를 묻는다.
set -euo pipefail
cd "$(dirname "$0")/.."

NOTES="${1:-}"
APK_DIR="$HOME/weekly-report-apk"
KEYS="$HOME/weekly-report-apk-keys"
SITE="https://weekly-report-helper-swart.vercel.app"
VER=public/download/apk-version.json
json() { node -e "try { const j = require('./$VER'); console.log(j['$1'] ?? '') } catch { console.log('') }"; }

npm test

SRC_HASH=$(cd "$APK_DIR" && cat AndroidManifest.xml build.sh $(find src res -type f | sort) | sha256sum | cut -c1-16)
if [ "$SRC_HASH" != "$(json sourceHash)" ]; then
  PREV=$(json versionCode); CODE=$(( ${PREV:-2} + 1 )); NAME="1.$((CODE - 1)).0"
  echo "== APK 소스가 바뀜 → $NAME (versionCode $CODE) 빌드"
  docker run --rm -u "$(id -u):$(id -g)" -e VERSION_CODE="$CODE" -e VERSION_NAME="$NAME" \
    -v "$APK_DIR":/w -v "$KEYS":/keys:ro wr-apk-builder:36 /w/build.sh
  cp "$APK_DIR/out/weekly-report.apk" public/download/weekly-report.apk
  SHA=$(sha256sum public/download/weekly-report.apk | cut -d' ' -f1)
  SIZE=$(stat -c %s public/download/weekly-report.apk)
  CODE="$CODE" NAME="$NAME" SHA="$SHA" SIZE="$SIZE" SRC_HASH="$SRC_HASH" NOTES="$NOTES" node -e "
    const e = process.env;
    require('fs').writeFileSync('$VER', JSON.stringify({
      versionCode: +e.CODE, versionName: e.NAME, url: '/download/weekly-report.apk',
      sha256: e.SHA, size: +e.SIZE, notes: e.NOTES, sourceHash: e.SRC_HASH, builtAt: new Date().toISOString(),
    }, null, 2) + '\n');"
else
  echo "== APK 소스 그대로 → APK $(json versionName) 유지 (웹 변경은 앱에 바로 반영)"
fi

npm run build
if git remote get-url origin >/dev/null 2>&1; then
  # GitHub 에 올리면 Vercel 이 main 을 받아 운영에 배포한다
  git add -A
  git diff --cached --quiet || git commit -q -m "release: ${NOTES:-update}"
  git push -q origin main
  echo "== GitHub 푸시 완료 → Vercel 배포 대기"
else
  npx --yes vercel@latest deploy --prod --yes | tail -n 1
fi

echo "== 배포 확인"
for i in $(seq 1 36); do
  LIVE=$(curl -s "$SITE/download/apk-version.json?t=$RANDOM" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).sha256)}catch{console.log('')}})")
  [ "$LIVE" = "$(json sha256)" ] && break; sleep 5
done
[ "$LIVE" = "$(json sha256)" ] || { echo "apk-version.json 이 아직 반영되지 않았습니다"; exit 1; }
[ "$(curl -s "$SITE/download/weekly-report.apk?t=$RANDOM" | sha256sum | cut -d' ' -f1)" = "$(json sha256)" ] || { echo "APK 파일이 다릅니다"; exit 1; }
WANT=$(basename "$(ls dist/assets/index-*.js)")
for i in $(seq 1 36); do
  JS=$(curl -s "$SITE/?t=$RANDOM" | grep -oE '/assets/index-[^"]+\.js' | head -1)
  [ "$(basename "$JS")" = "$WANT" ] && break; sleep 5
done
[ "$(basename "$JS")" = "$WANT" ] || echo "주의: 웹 번들이 아직 $WANT 가 아닙니다 (Vercel 빌드 중이거나 실패) — Vercel 대시보드를 확인하세요"
echo "웹 $JS · APK $(json versionName) (versionCode $(json versionCode)) 배포 완료"
