// 서버(/api) 호출 + 토큰 보관 + 비밀번호 브라우저 암호화
const TOKEN_KEY = 'wr.token';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch { return false; } },
};
export { store };

let token = store.get(TOKEN_KEY);
const listeners = new Set();
export const onUnauthorized = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const hasToken = () => !!token;
export function setToken(t) { token = t; store.set(TOKEN_KEY, t); }

export class ApiError extends Error {
  constructor(status, body) { super(body?.message || `HTTP ${status}`); this.status = status; this.code = body?.code; }
}

async function request(method, path, { body, query, accountId } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')) : '';
  const headers = {};
  if (accountId != null) headers['x-wr-account'] = String(accountId);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}${qs}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: '서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && path !== '/login') { setToken(null); listeners.forEach((f) => f(err)); }
    throw err;
  }
  return data;
}

// OneFinger 사이트 프론트와 동일한 방식: 공개키(RSA-OAEP / SHA-256)로 암호화 → base64
// 원문 비밀번호는 이 기기를 떠나지 않는다.
async function encryptPassword(password) {
  const { publicKey } = await request('GET', '/public-key');
  const der = Uint8Array.from(
    atob(publicKey.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '')),
    (c) => c.charCodeAt(0)
  );
  const key = await crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(password)));
  let bin = '';
  for (const b of enc) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const api = {
  async login(employeeNo, password) {
    const encryptedPassword = await encryptPassword(password);
    const r = await request('POST', '/login', { body: { employeeNo, encryptedPassword } });
    setToken(r.accessToken);
    return r;
  },
  async logout() { try { await request('POST', '/logout'); } finally { setToken(null); } },
  me: () => request('GET', '/me'),
  weeks: (count) => request('GET', '/weeks', { query: { count } }),
  report: (year, week) => request('GET', '/report', { query: { year, week } }),
  lastWeek: (year, week) => request('GET', '/last-week', { query: { year, week } }),
  chatTicket: (accountId) => request('GET', '/chat/ticket', { accountId }),
  searchEmployees: (q, accountId) => request('GET', '/chat/employees', { query: { q }, accountId }),
  meetingStatus: () => request('GET', '/meetings/status'),
  transcribe: (audio, mime, context = {}) => request('POST', '/meetings/transcribe', { accountId: context.accountId, body: { audio, mime, lang: 'ko', meetingId: context.meetingId, speakerState: context.speakerState || '' } }),
  summarizeMeeting: (m) => request('POST', '/meetings/summarize', { body: { title: m.title, date: m.date, attendees: m.attendees, notes: m.notes, transcript: m.transcript, segments: m.segments || [], speakerNames: m.speakerNames || {} } }),
  extractTemplate: (text, workName, writer) => request('POST', '/templates/extract', { body: { text, workName, writer } }),
  meetings: async (accountId) => {
    const items = []; let cursor;
    do { const page = await request('GET', '/meetings', { accountId, query: { cursor } }); items.push(...page.items); cursor = page.nextCursor; } while (cursor);
    return items;
  },
  saveMeeting: (meeting, accountId) => request('PUT', '/meetings', { accountId, body: { meeting } }),
  importMeetings: (meetings, accountId) => request('PUT', '/meetings', { accountId, body: { meetings } }),
  deleteMeeting: (id, accountId) => request('DELETE', '/meetings', { accountId, query: { id } }),
  templates: (accountId) => request('GET', '/templates', { accountId }),
  saveTemplate: (template, accountId) => request('PUT', '/templates', { accountId, body: { template } }),
  importTemplates: (templates, accountId) => request('PUT', '/templates', { accountId, body: { templates } }),
  deleteTemplate: (id, accountId) => request('DELETE', '/templates', { accountId, query: { id } }),
  context: (year, week) => request('GET', '/context', { query: { year, week } }),
  works: (q) => request('GET', '/works', { query: { q } }),
  draft: (year, week, memo, { template, fromLastWeek } = {}) => request('POST', '/draft', { body: { year, week, memo, template, fromLastWeek } }),
  commit: (year, week, items, dryRun = false) => request('POST', '/commit', { body: { year, week, items, dryRun } }),
};

export const ERROR_TEXT = {
  AUTH_INVALID: '사번 또는 비밀번호가 맞지 않습니다.',
  AUTH_LOCKED: '비밀번호를 5회 틀려 계정이 잠겼습니다. 관리자에게 잠금 해제를 요청하세요.',
  AUTH_NOT_CREATED: '아직 계정이 발급되지 않았습니다. 관리자에게 문의하세요.',
  AUTH_BLOCKED: '사용이 중지된 계정입니다. 관리자에게 문의하세요.',
  AUTH_MUST_CHANGE_PASSWORD: 'OneFinger 사이트에서 비밀번호를 먼저 변경한 뒤 로그인하세요.',
  NO_AI_KEY: 'AI 정리 기능이 아직 설정되지 않았습니다. 관리자에게 API 키 설정을 요청하세요.',
  NO_STT: '음성 인식 서버가 설정되지 않았습니다. 관리자에게 문의하세요.',
};
export const errorText = (e, fallback = '요청을 처리하지 못했습니다.') => ERROR_TEXT[e?.code] || e?.message || fallback;
