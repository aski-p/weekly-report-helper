# 주간보고 도우미

OneFinger 주간보고를 메모 몇 줄로 작성하도록 돕는 웹앱(PWA)입니다.

- **작성**: 메모를 적으면 본부 보고 양식에 맞춰 AI가 업무별 금주 실적·차주 계획·이슈로 정리하고, 확인 후 OneFinger에 올립니다.
- **조회**: 이번 주 본부 보고를 업무별·작성자별로 보고, 마음에 드는 글을 양식으로 저장합니다.
- **회의록**: 녹음 → 음성 인식·화자 A/B/C 구분 → AI 회의록 요약. 화자별 이름은 나중에 지정하고 발언별 화자를 수정할 수 있습니다. 사번별 DB에 저장하고 날짜별로 조회합니다. 선택한 주의 회의는 주간보고에 자동으로 포함되며, 회의 3건이면 핵심 3개 항목으로 정리합니다.
- **메신저**: 동료와 1:1·그룹 대화, `@봇` 으로 부르는 AI 비서. 친구·새 대화·초대 화면에서 실제 OneFinger 직원을 검색합니다. 메신저 미접속 직원도 친구로 등록할 수 있고, 친구 목록은 계정별 DB에 저장됩니다.
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
- `pgx/friends.js`는 개인 친구 목록의 등록·해제와 같은 계정의 연결에 대한 동기화를 담당합니다. `pgx/directory.js`는 앱 서버가 OneFinger에서 조회한 직원을 서명으로 확인한 뒤 등록합니다. OneFinger 로그인 토큰은 채팅 서버로 전달하지 않습니다.
- `pgx/data-api.js`와 `pgx/schema.sql`은 기존 PGX 서버에 연결할 개인 자료 API 모듈입니다. PGX 실행 환경의 DB 연결과 티켓 검증 함수를 주입해 사용합니다. 서버 주소·인증키는 저장소에 넣지 않습니다.

## 개발
```
npm install
npm run dev:api   # 로컬 API (dev/mock-onefinger.mjs 로 가짜 OneFinger 를 띄울 수 있음)
npm run dev
npm test
```

배포는 `scripts/release.sh "변경 요약"` — 테스트, (필요하면) APK 빌드, 커밋·푸시까지 하고 Vercel 이 `main` 을 받아 배포합니다.

### PGX 중단 시 임시 로컬 DB

`npm run dev:db`는 PGlite(PostgreSQL)를 이 PC에서 실행합니다. 기존 PGX의 SQL 스키마와 양식·회의록 API를 사용하며 계정별 저장, 화자 정보, 이전 기기 자료 병합 방식을 유지합니다.

Git에서 제외되는 `.env.local`에 `RECORD_STORE_URL=http://127.0.0.1:54329/chat`과 충분히 긴 임의의 `CHAT_SECRET`을 설정합니다. `npm run dev:db`와 `npm run dev:api`가 같은 파일을 읽습니다. 모의 OneFinger를 쓰려면 `ONEFINGER_API=http://127.0.0.1:4010/api/v1`도 설정하고 `node dev/mock-onefinger.mjs`를 실행합니다. 화면은 `npm run dev`로 실행합니다.

- DB는 기본적으로 `.claude/local-db/data/`에 영구 저장하며 Git과 Vercel 배포에서 제외됩니다. 서버를 종료해도 자료는 남습니다.
- 데이터 API는 `127.0.0.1:54329`에서만 듣고 기존 서명 티켓을 검증합니다. AI·음성 인식·메신저 서버는 제공하지 않습니다.
- PGX의 기존 자료는 자동으로 가져오지 않습니다. 브라우저에 남아 있는 자료는 기존 이전 기능으로 저장됩니다. 임시 DB와 PGX 사이의 자동 동기화도 제공하지 않습니다.
- PGX 복귀 시 로컬 DB를 보존한 상태에서 `RECORD_STORE_URL`을 제거하고 원래 PGX 설정으로 API 서버를 재시작합니다. 임시 자료 이관은 별도로 진행해야 합니다.
- 재부팅 후에는 DB, API, 화면 서버를 다시 실행합니다. DB 파일 백업은 `dev:db` 프로세스를 정상 종료한 뒤 `data/` 폴더 전체를 복사합니다. `LOCAL_DB_DIR`과 `LOCAL_DB_PORT`로 저장 위치와 포트를 바꿀 수 있습니다.

### 임시 로컬 채팅 서버

`npm run dev:chat`로 기존 메신저 화면과 호환되는 WebSocket 서버를 실행합니다. `.env.local`에 `CHAT_ENABLED=true`, `CHAT_URL=ws://127.0.0.1:3001/chat`을 지정하고 API 서버도 재시작합니다. API와 채팅 서버는 동일한 `CHAT_SECRET`을 사용합니다. 개인 자료 DB의 `RECORD_STORE_URL`은 그대로 유지합니다.

- 1:1·그룹 대화, 초대·이름 변경·나가기, 과거 대화 조회, 읽음·입력 중·접속 상태, 계정별 친구 목록을 지원합니다. 실제 OneFinger 직원 검색 결과를 등록하면 메신저 미접속 직원에게도 대화를 만들 수 있습니다.
- Qwen과 1:1 대화하거나 그룹에 초대한 뒤 `@봇` 또는 `@봇이름`으로 부르면 로컬 AI가 해당 대화방의 최근 메시지만 참고해 답합니다. `AI_BASE_URL`·`AI_MODEL` 설정을 사용합니다.
- 대화·친구·봇 프로필은 `.claude/local-chat/data/`의 PostgreSQL(PGlite)에 영구 저장되며 Git과 배포에서 제외됩니다. PGX의 기존 대화는 가져오지 않습니다.
- 기본 주소는 이 PC에서만 접속할 수 있습니다. 다른 PC·휴대폰이나 운영 사이트에서 접속하려면 별도 네트워크·HTTPS 구성이 필요합니다. 재부팅 후 `dev:chat`을 다시 실행합니다. `LOCAL_CHAT_PORT`·`LOCAL_CHAT_DB_DIR`로 포트·저장 위치를 바꿀 수 있습니다.

### 실제 직원 검색과 PGX 복귀

실제 직원 검색은 로그인된 OneFinger 계정으로 `/employees?q=...&limit=30`을 조회합니다. `ONEFINGER_API`를 실제 서버로 설정한 뒤 다시 로그인해야 합니다. 모의 로그인 토큰은 실제 직원 조회에 사용할 수 없습니다. 검색 결과에는 메신저에 필요한 이름·소속·직급·사번만 포함합니다.

PGX 채팅 서버에는 `pgx/directory.js`도 설치하고 `createDirectoryOperations({ pool, verifyTicket, notify: sendTo })`를 `ops`에 연결합니다. 실행 전에 `ensureDirectoryTables(pool)`을 호출합니다. WebSocket 로그인에서는 `purpose`가 있는 직원 등록용 티켓을 거부해야 합니다.

AI·채팅을 PGX로 복귀시키면서 개인 자료를 계속 로컬 DB에 둘 경우, `RECORD_STORE_URL`과 기존 로컬 DB의 서명 키를 `RECORD_STORE_SECRET`으로 유지합니다. PGX용 `CHAT_SECRET`과 구분되며, 로컬 DB 실행 시에도 `RECORD_STORE_SECRET`이 우선 적용됩니다.

### 로컬 Qwen AI

OpenAI 호환 AI를 사용할 때는 `.env.local`의 `AI_BASE_URL`에 `/v1`까지 포함한 주소, `AI_MODEL`에 서버의 `/v1/models`가 반환한 모델 ID를 설정합니다. 서버가 `chat_template_kwargs`를 거부하면 `AI_SEND_CHAT_TEMPLATE_KWARGS=false`로 생략할 수 있습니다. AI 서버에 음성 인식이나 채팅 기능이 없으면 `STT_ENABLED=false`, `CHAT_ENABLED=false`를 설정합니다. 개인 자료는 별도 `RECORD_STORE_URL`을 계속 사용하며 주간보고의 회의 포함도 유지됩니다. 설정 후 API 서버를 재시작합니다.

## PGX 화자 구분 모듈
`pgx/speaker_diarization.py`는 기존 Whisper STT에 연결하는 음성 기반 화자 구분 모듈입니다. Microsoft WavLM의 고정된 모델 버전을 쓰며, 기존 PyTorch·Transformers·NumPy·cryptography 실행 환경에서 동작합니다.

- 기존 STT는 Whisper의 `return_timestamps='word'` 결과와 16kHz 오디오를 `SpeakerDiarizer.analyze`에 전달합니다.
- 앱 API는 로그인 계정과 회의 ID로 익명 세션을 만들고, 음성 요청에 `speaker_session`과 `x-wr-speaker-state`를 전달합니다. 인증 프록시도 해당 상태 헤더를 STT에 전달해야 합니다.
- 화자 연속 정보는 회의 세션에 묶어 AES-GCM으로 암호화하며, DB의 `speaker_state`에 저장합니다. 다음 조각·이어서 녹음할 때 다시 전달하므로 A/B/C가 유지됩니다. 이름 대응표와 발언은 `speaker_names`, `segments`에 저장합니다.
- `pgx/data-api.js`가 사용하는 `shared/speakers.js`도 PGX 서버의 `shared/` 디렉터리에 함께 복사해야 합니다.
- Python 검증: `python3 -m unittest discover -s pgx -p 'test_speaker*.py'`.
