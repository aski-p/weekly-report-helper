# 주간보고 도우미

OneFinger 주간보고를 메모 몇 줄로 작성하도록 돕는 웹앱(PWA)입니다.

- **작성**: 메모를 적으면 본부 보고 양식에 맞춰 AI가 업무별 금주 실적·차주 계획·이슈로 정리하고, 확인 후 OneFinger에 올립니다.
- **조회**: 이번 주 본부 보고를 업무별·작성자별로 보고, 마음에 드는 글을 양식으로 저장합니다.
- **회의록**: 녹음 → 음성 인식 → AI 회의록 요약, 주간보고 메모로 보내기.
- **메신저**: 동료와 1:1·그룹 대화, `@봇` 으로 부르는 AI 비서.
- 스킨 21종·글꼴 24종, 홈 화면 설치(PWA)와 안드로이드 APK.

## 구조
- `src/` React(Vite) 화면, `api/router.js` + `lib/` Vercel 함수 (OneFinger API 중계, AI 호출).
- AI·음성 인식·채팅 서버는 별도 서버에서 OpenAI 호환 API/WebSocket 으로 제공되며, 주소와 키는 환경변수로만 설정합니다 (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `CHAT_SECRET`).

## 개발
```
npm install
npm run dev:api   # 로컬 API (dev/mock-onefinger.mjs 로 가짜 OneFinger 를 띄울 수 있음)
npm run dev
npm test
```

배포는 `scripts/release.sh "변경 요약"` — 테스트, (필요하면) APK 빌드, 커밋·푸시까지 하고 Vercel 이 `main` 을 받아 배포합니다.
