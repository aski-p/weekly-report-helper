// 프레임워크 무관 API 라우터: Vercel 함수(api/router.js)와 로컬 서버(server.js)가 같이 쓴다.
import { client, login, publicKey } from './onefinger.js';
import { buildContext, commit, lastWeekItems } from './report.js';
import { draftReport, extractTemplate, aiReady } from './ai.js';
import { transcribeChunk, summarizeMeeting, sttReady } from './meeting.js';
import { chatReady, chatUrl, makeTicket } from './chat.js';
import { meetingsForWeek, compactMeetings, meetingReportItem } from './meeting-report.js';
import { assertAccount, recordStore } from './record-store.js';
import { templateStore } from './templates.js';

const bad = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code });
const cleanTemplate = (t) => (t && typeof t === 'object'
  ? Object.fromEntries(['name', 'thisWeek', 'nextWeek', 'issue', 'style'].map((k) => [k, String(t[k] || '').slice(0, 3000)]))
  : null);

const routes = {
  'GET /public-key': () => publicKey(),

  'POST /login': ({ body }) => {
    const { employeeNo, encryptedPassword } = body || {};
    if (!employeeNo || !encryptedPassword) throw bad('사번과 비밀번호를 입력하세요');
    return login(String(employeeNo).trim(), encryptedPassword);
  },

  'GET /me': ({ api }) => api.me(),
  'POST /logout': async ({ api }) => { await api.logout(); return { ok: true }; },
  // 조회 화면은 날짜 선택을 위해 1년치까지 받는다
  'GET /weeks': ({ api, query }) => api.weeks(Math.min(Math.max(+query.get('count') || 8, 1), 60), 1),

  // 조회: 본부 보고서 원본 그대로 (없으면 report=null)
  'GET /report': async ({ api, query }) => {
    const me = await api.me();
    return { report: await api.getReport(+query.get('year'), +query.get('week'), me.buId) };
  },

  // 작성 화면 "지난주 끌어오기": 지난주 내가 쓴 항목 (공동 항목이면 내 구역만)
  'GET /last-week': async ({ api, query }) => {
    const me = await api.me();
    return { items: await lastWeekItems(api, me, +query.get('year'), +query.get('week')) };
  },

  // 회의록: 녹음 조각(base64) → 글자. 로그인한 사람만.
  'POST /meetings/transcribe': async ({ api, body }) => {
    await api.me();
    return transcribeChunk(body || {});
  },

  // 회의록: 녹취·메모 → 요약
  'POST /meetings/summarize': async ({ api, body }) => {
    const me = await api.me();
    const { title, date, attendees, notes, transcript } = body || {};
    if ((transcript || '').length > 200000) throw bad('녹취가 너무 깁니다 (20만 자 이하)');
    return summarizeMeeting({ me, title, date, attendees, notes, transcript });
  },

  // 채팅: PGX 채팅 서버 접속 티켓
  'GET /chat/ticket': async ({ api, accountId }) => {
    if (!chatReady()) throw Object.assign(new Error('채팅 서버가 설정되지 않았습니다'), { status: 503, code: 'NO_CHAT' });
    const me = await api.me();
    assertAccount(me, accountId);
    return { ticket: makeTicket(me), url: chatUrl() };
  },

  'GET /meetings': async ({ api, query, accountId }) => recordStore(assertAccount(await api.me(), accountId), 'meetings', 'GET', { query: Object.fromEntries(['cursor', 'from', 'to'].filter((k) => query.has(k)).map((k) => [k, query.get(k)])) }),
  'PUT /meetings': async ({ api, body, accountId }) => recordStore(assertAccount(await api.me(), accountId), 'meetings', 'PUT', { body: { meeting: body?.meeting, meetings: body?.meetings } }),
  'DELETE /meetings': async ({ api, query, accountId }) => recordStore(assertAccount(await api.me(), accountId), 'meetings', 'DELETE', { query: { id: query.get('id') || '' } }),
  'GET /meetings/status': () => ({ stt: sttReady(), ai: aiReady() }),

  // 학습: 보고서 글 → 양식(구조만)
  // 양식: PGX DB 에 사번별로 저장 (body.template 하나, 또는 body.templates 여러 개 = 기기에 있던 양식 옮기기)
  'GET /templates': async ({ api, accountId }) => templateStore(assertAccount(await api.me(), accountId), 'GET'),
  'PUT /templates': async ({ api, body, accountId }) => templateStore(assertAccount(await api.me(), accountId), 'PUT', { body: { template: body?.template, templates: body?.templates } }),
  'DELETE /templates': async ({ api, query, accountId }) => templateStore(assertAccount(await api.me(), accountId), 'DELETE', { id: query.get('id') || '' }),

  'POST /templates/extract': async ({ api, body }) => {
    await api.me(); // 로그인한 사람만 AI 를 쓸 수 있게
    const { text, workName, writer } = body || {};
    if (!text || !text.trim()) throw bad('양식으로 만들 글이 없습니다');
    if (text.length > 12000) throw bad('글이 너무 깁니다 (12,000자 이하)');
    return extractTemplate({ text, workName, writer });
  },
  'GET /works': ({ api, query }) => api.searchWorks(query.get('q') || undefined),

  'GET /context': async ({ api, query }) => {
    const me = await api.me();
    const ctx = await buildContext(api, me, +query.get('year'), +query.get('week'));
    return {
      period: ctx.period,
      candidates: ctx.candidates,
      exampleCount: ctx.examples.length,
      lastWeekCount: ctx.myLastWeek.length,
      aiReady: aiReady(),
    };
  },

  'POST /draft': async ({ api, body }) => {
    const { year, week, template, fromLastWeek } = body || {};
    let memo = (body?.memo || '').trim();
    const me = await api.me();
    const ctx = await buildContext(api, me, year, week);
    const meetings = await meetingsForWeek(me, year, week);
    // 자동화: 메모가 없으면 지난주에 세운 차주 계획을 이번 주 실적의 근거로 쓴다
    if (!memo && !meetings.length && fromLastWeek && ctx.myLastWeek.length) {
      memo = '(이번 주 메모 없음. 아래는 지난주에 세운 차주 계획이다. 이번 주에 그대로 진행했다고 보고 금주 실적은 "~ 진행"처럼 보수적으로 쓰고, 완료 여부가 불확실한 것은 questions 에 적어라.)\n\n'
        + ctx.myLastWeek.map((l) => `[${l.workName}]\n${l.nextWeek || '-'}`).join('\n\n');
    }
    if (!memo && !meetings.length) throw bad(fromLastWeek ? '메모도 지난주 기록도 없어 정리할 내용이 없습니다' : '메모를 입력하세요');
    const meetingMemos = new Set(meetings.map((m) => m.summary?.reportMemo).filter(Boolean));
    memo = memo.split('\n').filter((line) => !meetingMemos.has(line.trim())).join('\n').trim();
    const meetingEntries = await compactMeetings(meetings);
    // Meetings are rendered deterministically: one short bullet per meeting.
    // Do not let the general report model expand, duplicate, or merge those bullets.
    const out = memo ? await draftReport({ memo, me, ...ctx, template: cleanTemplate(template) }) : { items: [], questions: [] };
    const byKey = new Map(ctx.candidates.map((c) => [c.key, c]));
    const items = (out.items || []).map((it) => {
      const c = it.candidateKey != null && byKey.get(String(it.candidateKey));
      return {
        workKindCode: c ? c.workKindCode : 'G',
        workId: c ? c.workId : null,
        workName: c ? c.workName : it.workName,
        existing: c ? c.existing : false,
        thisWeek: it.thisWeek || '',
        nextWeek: it.nextWeek || '',
        issue: it.issue || '',
      };
    });
    return { period: ctx.period, items: [...items, ...(meetingEntries.length ? meetingReportItem(meetingEntries) : [])], questions: out.questions || [], meetingCount: meetingEntries.length };
  },

  'POST /commit': async ({ api, body }) => {
    const { year, week, items, dryRun } = body || {};
    if (!Array.isArray(items) || !items.length) throw bad('기록할 항목이 없습니다');
    const me = await api.me();
    return { results: await commit(api, me, year, week, items, { dryRun: !!dryRun }) };
  },
};

// path 는 "/api" 이후 부분 (예: "/login")
export async function handle({ method, path, headers, body, query }) {
  const fn = routes[`${method} ${path}`];
  if (!fn) return { status: 404, data: { code: 'NOT_FOUND', message: '없는 API입니다' } };
  const token = (headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  try {
    const data = await fn({ api: client(token), accountId: headers['x-wr-account'], body, query: query || new URLSearchParams() });
    return { status: 200, data: data ?? {} };
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    return { status: e.status || 502, data: { code: e.code || 'ERROR', message: e.message } };
  }
}
