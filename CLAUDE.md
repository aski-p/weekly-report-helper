# 주간보고 도우미 (weekly-report-helper)

## 배포 규칙
- 수정한 뒤에는 항상 `scripts/release.sh "변경 한 줄 요약"` 으로 배포한다. `vercel deploy` 를 따로 부르지 않는다.
  - 테스트 → (APK 소스가 바뀌었으면) APK 재빌드·versionCode 증가·`public/download/apk-version.json` 갱신 → 웹 빌드 → 커밋·`git push origin main` → Vercel 이 GitHub 에서 받아 배포 → 반영 확인.
- 저장소 https://github.com/aski-p/weekly-report-helper 는 **공개**다. 비밀값·서명 키·내부 주소(PGX tailnet 호스트 등)·동료 실명을 코드나 테스트에 넣지 않는다 (환경변수·가명 사용).
- PWA: 서비스 워커가 새 버전을 바로 넘겨받고, 앱을 다시 열거나 돌아올 때 화면을 새로 불러온다 (녹음 중이면 미룸). `src/App.jsx`, `index.html` 자가 복구.
- APK: 웹 화면은 서버에서 바로 오므로 자동 반영. 앱 껍데기(`~/weekly-report-apk`)가 바뀌면 앱이 켜질 때 apk-version.json 을 보고 업데이트를 묻는다 (`Updater.java`).
- APK 빌드·검증 방법은 `~/weekly-report-apk/README.md`. 서명 키 `~/weekly-report-apk-keys/` 는 저장소·Vercel 에 올리지 않는다.
- 채팅 서버는 PGX `~/pgx-connect/chat-server` (systemd user 서비스 `wr-chat`), Qwen 봇도 여기.

## 개인 자료
- 양식·회의록은 PGX 채팅 서버의 Postgres에 사번별로 저장한다. `pgx/data-api.js` + `pgx/schema.sql`이 개인 자료 API 모듈이다.
- PGX의 `chat-server/data-store/`에 두 파일을 복사하며, 기존 서버가 `createDataApi({ pool, verifyTicket })`와 `ensureDataTables(pool)`로 연결한다. 비공개 서버 전체 코드는 공개 저장소에 넣지 않는다.
- 회의록은 날짜별 조회하고, 보고서 작성 시 선택한 주의 회의를 자동 포함한다. 회의당 핵심 한 항목만 쓰며(3회의 = 3항목) 상세 회의록을 주간보고에 복사하지 않는다.
- 클라이언트 저장 요청은 직렬화하고, 실패한 변경은 로컬 outbox에서 재시도한다. 기존 기기 자료 이전은 서버의 기존 자료를 덮어쓰지 않는다.

- 템플릿의 기본키는 `(owner_id,id)`이며, 이전 전역 ID 기본키는 데이터 보존 후 자동 이전한다. 개인 자료 API의 `x-wr-account`는 실제 로그인 계정과 맞아야 한다.
- 템플릿 직접 작성·AI 추출 후 저장 모두 DB 저장을 확인한 뒤 완료 처리한다.
- 친구 목록은 `pgx/friends.js`에서 계정별 DB 저장하고 `friends` 이벤트를 같은 계정의 연결에만 보낸다. 채팅 서버의 `ops`에 `createFriendOperations({ query: q, notify: sendTo })`를 연결한다.
- 직원 검색은 로그인 계정으로 OneFinger `/employees`를 조회하고, 계정에 묶인 서명 티켓으로 채팅 서버에 등록한다. `pgx/directory.js`의 `createDirectoryOperations`를 `ops`에 연결하고 시작 전에 `ensureDirectoryTables`를 실행한다. WebSocket 로그인은 `purpose`가 있는 직원 등록 티켓을 거부한다. OneFinger 로그인 토큰을 채팅 서버로 전달하지 않는다.
- 임시 로컬 DB·채팅 서버는 `dev/`에 있고 데이터와 키는 `.claude/`·`.env.local`에만 둔다. AI·채팅을 PGX로 복귀시켜도 로컬 DB를 유지할 때는 `RECORD_STORE_URL`과 별도 `RECORD_STORE_SECRET`을 사용한다. 로컬 전용 주소·키를 Vercel 운영 환경에 넣지 않는다.

- 화자 구분은 `pgx/speaker_diarization.py`를 PGX STT에 연결한다. Whisper 단어 시각과 음성 임베딩으로 회의별 A/B/C를 구분하며, 이름은 사용자가 지정한다. 구분하지 못한 발언은 미확인으로 두고 수정을 허용한다.
- 회의의 `segments`, `speaker_names`, 암호화된 `speaker_state`를 함께 저장한다. 상태는 로그인 계정·회의별 세션에 묶으며, 다른 회의 상태를 재사용하지 않는다.
- `shared/speakers.js`를 채팅 서버 `shared/`에 함께 복사한다. 인증 프록시는 STT의 `x-wr-speaker-state` 헤더를 전달해야 한다. 원본 음성은 계속 영구 저장하지 않는다.

- 메모·초안·게시 확인·선택 양식·자동화·화면 설정은 `workspace_documents`에 계정별 동기화한다. PGX에 `pgx/workspace.js`와 `shared/workspace-keys.js`도 복사하고 `/workspace`를 개인 자료 API로 연결한다. 토큰·권한·내비게이션 상태는 허용 목록에 없으며 전송하지 않는다.
- 동기화는 버전 비교로 충돌을 검출한다. 다른 기기의 내용을 조용히 덮어쓰지 않는다. 사용자가 선택하기 전 두 사본을 유지하며, 선택 시에도 기기에 대체 사본을 남긴다.
- Qwen 네이티브 XML 도구 응답 호환은 `pgx/tool_adapter.py`를 인증 프록시에 연결한다. 요청 전 `prepare_request`, 비스트리밍 응답 후 `normalize_response`를 적용한다. `/v1/stt/health`도 인증 후 STT 상태로 연결해야 AI 재연결 상태에 반영된다.
- 보안 경계는 `lib/security.js`와 공통 라우터다. CSP를 바꾸면 글꼴·마이크·서비스 워커·채팅 연결을 확인한다. 요청 횟수 제한은 프로세스별 보조 수단이며 분산 전역 제한을 보장하지 않는다. 개인 자료·AI 응답 본문·인증 비밀을 로그에 남기지 않는다.

- 조회 화면에서 직접 주간보고를 등록하고 게시된 내 항목을 삭제할 수 있다. 등록은 기존 `/commit`의 미리보기와 확인 흐름을 사용한다. 삭제는 `lib/report-delete.js`에서 로그인 계정·본부·작성자·확정 여부를 검증하고, 잠금 후 다시 읽어 확인 당시 버전과 비교한다. 단독 항목은 OneFinger 항목 DELETE, 공동 항목은 내 작성자 구역만 제거한다. 작성자를 구분할 수 없는 공동 본문은 삭제하지 않는다.
