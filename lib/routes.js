// 프레임워크 무관 API 라우터: Vercel 함수(api/router.js)와 로컬 서버(server.js)가 같이 쓴다.
import { client, login, publicKey } from './onefinger.js';
import { buildContext, commit } from './report.js';
import { draftReport } from './ai.js';

const bad = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code });

const routes = {
  'GET /public-key': () => publicKey(),

  'POST /login': ({ body }) => {
    const { employeeNo, encryptedPassword } = body || {};
    if (!employeeNo || !encryptedPassword) throw bad('사번과 비밀번호를 입력하세요');
    return login(String(employeeNo).trim(), encryptedPassword);
  },

  'GET /me': ({ api }) => api.me(),
  'POST /logout': async ({ api }) => { await api.logout(); return { ok: true }; },
  'GET /weeks': ({ api }) => api.weeks(8, 1),
  'GET /works': ({ api, query }) => api.searchWorks(query.get('q') || undefined),

  'GET /context': async ({ api, query }) => {
    const me = await api.me();
    const ctx = await buildContext(api, me, +query.get('year'), +query.get('week'));
    return {
      period: ctx.period,
      candidates: ctx.candidates,
      exampleCount: ctx.examples.length,
      lastWeekCount: ctx.myLastWeek.length,
      aiReady: !!process.env.ANTHROPIC_API_KEY,
    };
  },

  'POST /draft': async ({ api, body }) => {
    const { year, week, memo } = body || {};
    if (!memo || !memo.trim()) throw bad('메모를 입력하세요');
    const me = await api.me();
    const ctx = await buildContext(api, me, year, week);
    const out = await draftReport({ memo, me, ...ctx });
    const byKey = new Map(ctx.candidates.map((c) => [c.key, c]));
    const items = (out.items || []).map((it) => {
      const c = it.candidateKey && byKey.get(it.candidateKey);
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
    return { period: ctx.period, items, questions: out.questions || [] };
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
    const data = await fn({ api: client(token), body, query: query || new URLSearchParams() });
    return { status: 200, data: data ?? {} };
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    return { status: e.status || 502, data: { code: e.code || 'ERROR', message: e.message } };
  }
}
