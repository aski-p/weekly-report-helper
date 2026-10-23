# 주간보고 도우미

OneFinger 주간보고를 메모 몇 줄로 작성하도록 돕는 웹앱(PWA)입니다.

- **작성**: 메모를 적으면 본부 보고 양식에 맞춰 AI가 업무별 금주 실적·차주 계획·이슈로 정리하고, 확인 후 OneFinger에 올립니다.
- **조회**: 이번 주 본부 보고를 업무별·작성자별로 보고, 마음에 드는 글을 양식으로 저장합니다.
- **회의록**: 녹음 → 음성 인식·화자 A/B/C 구분 → AI 회의록 요약. 화자별 이름은 나중에 지정하고 발언별 화자를 수정할 수 있습니다. 사번별 DB에 저장하고 날짜별로 조회합니다. 선택한 주의 회의는 주간보고에 자동으로 포함되며, 회의 3건이면 핵심 3개 항목으로 정리합니다.
- **메신저**: 동료와 1:1·그룹 대화, `@봇` 으로 부르는 AI 비서. 친구 탭에서 동료를 검색해 등록하거나 1:1 대화방에서 바로 등록합니다. 친구 목록은 개인 계정별 DB에 저장되고 같은 계정의 다른 기기에도 반영됩니다.
- 스킨 21종·글꼴 24종, 홈 화면 설치(PWA)와 안드로이드 APK.

## 구조
- `src/` React(Vite) 화면, `api/router.js` + `lib/` Vercel 함수 (OneFinger API 중계, AI 호출).
- AI·음성 인식·채팅 서버는 별도 서버에서 OpenAI 호환 API/WebSocket 으로 제공되며, 주소와 키는 환경변수로만 설정합니다 (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `CHAT_SECRET`).

## 개인 자료 저장
- 템플릿은 AI로 구조를 뽑거나 직접 작성해 저장할 수 있습니다. 서버 저장이 확인된 뒤 저장 완료를 표시합니다.
- 양식과 회의록은 PGX 채팅 서버의 Postgres에 사번별로 저장합니다. 다른 사번의 자료는 조회·수정·삭제할 수 없습니다.
- 예전 기기 저장 자료는 로그인 후 서버로 자동 이전합니다. 저장에 실패한 수정 내용은 기기에 보관하고 다시 시도합니다.
- 새 녹취는 발언 시각·화자 알파벳·내용을 함께 저장합니다. 알파벳별 이름을 지정하면 녹취와 복사본에 반영되며, 이름 지정 후 AI 요약을 다시 만들면 해당 이름으로 정리됩니다. 예전 텍스트 녹취도 발언별 편집으로 바꿔 직접 화자를 지정할 수 있습니다.
- 회의 원문·상세 요약은 회의록 화면에서 확인하고, 주간보고에는 날짜 아래 회의당 한 개의 짧은 항목만 넣습니다. 내용 없는 새 회의는 제외합니다.
- 템플릿 ID는 계정별로 구분합니다. 계정이 바뀌면 이전 계정의 저장 대기 요청은 서버에서 거부합니다.
- `pgx/friends.js`는 개인 친구 목록의 등록·해제와 같은 계정의 연결에 대한 동기화를 담당합니다. 동료가 앱에 한 번 로그인하면 검색할 수 있습니다.
- `pgx/data-api.js`와 `pgx/schema.sql`은 기존 PGX 서버에 연결할 개인 자료 API 모듈입니다. PGX 실행 환경의 DB 연결과 티켓 검증 함수를 주입해 사용합니다. 서버 주소·인증키는 저장소에 넣지 않습니다.

## 개발
```
npm install
npm run dev:api   # 로컬 API (dev/mock-onefinger.mjs 로 가짜 OneFinger 를 띄울 수 있음)
npm run dev
npm test
```

배포는 `scripts/release.sh "변경 요약"` — 테스트, (필요하면) APK 빌드, 커밋·푸시까지 하고 Vercel 이 `main` 을 받아 배포합니다.

## PGX 화자 구분 모듈
`pgx/speaker_diarization.py`는 기존 Whisper STT에 연결하는 음성 기반 화자 구분 모듈입니다. Microsoft WavLM의 고정된 모델 버전을 쓰며, 기존 PyTorch·Transformers·NumPy·cryptography 실행 환경에서 동작합니다.

- 기존 STT는 Whisper의 `return_timestamps='word'` 결과와 16kHz 오디오를 `SpeakerDiarizer.analyze`에 전달합니다.
- 앱 API는 로그인 계정과 회의 ID로 익명 세션을 만들고, 음성 요청에 `speaker_session`과 `x-wr-speaker-state`를 전달합니다. 인증 프록시도 해당 상태 헤더를 STT에 전달해야 합니다.
- 화자 연속 정보는 회의 세션에 묶어 AES-GCM으로 암호화하며, DB의 `speaker_state`에 저장합니다. 다음 조각·이어서 녹음할 때 다시 전달하므로 A/B/C가 유지됩니다. 이름 대응표와 발언은 `speaker_names`, `segments`에 저장합니다.
- `pgx/data-api.js`가 사용하는 `shared/speakers.js`도 PGX 서버의 `shared/` 디렉터리에 함께 복사해야 합니다.
- Python 검증: `python3 -m unittest discover -s pgx -p 'test_speaker*.py'`.
