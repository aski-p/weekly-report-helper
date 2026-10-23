# 주간보고 도우미 (weekly-report-helper)

## 배포 규칙
- 수정한 뒤에는 항상 `scripts/release.sh "변경 한 줄 요약"` 으로 배포한다. `vercel deploy` 를 따로 부르지 않는다.
  - 테스트 → (APK 소스가 바뀌었으면) APK 재빌드·versionCode 증가·`public/download/apk-version.json` 갱신 → 웹 빌드 → 커밋·`git push origin main` → Vercel 이 GitHub 에서 받아 배포 → 반영 확인.
- 저장소 https://github.com/aski-p/weekly-report-helper 는 **공개**다. 비밀값·서명 키·내부 주소(PGX tailnet 호스트 등)·동료 실명을 코드나 테스트에 넣지 않는다 (환경변수·가명 사용).
- PWA: 서비스 워커가 새 버전을 바로 넘겨받고, 앱을 다시 열거나 돌아올 때 화면을 새로 불러온다 (녹음 중이면 미룸). `src/App.jsx`, `index.html` 자가 복구.
- APK: 웹 화면은 서버에서 바로 오므로 자동 반영. 앱 껍데기(`~/weekly-report-apk`)가 바뀌면 앱이 켜질 때 apk-version.json 을 보고 업데이트를 묻는다 (`Updater.java`).
- APK 빌드·검증 방법은 `~/weekly-report-apk/README.md`. 서명 키 `~/weekly-report-apk-keys/` 는 저장소·Vercel 에 올리지 않는다.
- 채팅 서버는 PGX `~/pgx-connect/chat-server` (systemd user 서비스 `wr-chat`), Qwen 봇도 여기.
