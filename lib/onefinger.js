// OneFinger(one.fingerservice.co.kr) API 클라이언트

export const API_BASE = process.env.ONEFINGER_API || 'https://one.fingerservice.co.kr/api/v1';
export const FIELD_MAX = 4000; // 사이트 프론트의 칸당 최대 글자수

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || `HTTP ${status}`);
    this.status = status;
    this.code = body && body.code;
    this.body = body;
  }
}

async function call(method, path, { token, body, query } = {}) {
  const qs = query
    ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString()
    : '';
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}${qs}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === 'object' ? data : { code: 'ERROR', message: data });
  return data;
}

// 비밀번호는 브라우저에서 공개키(RSA-OAEP/SHA-256)로 암호화해 보내므로 서버는 원문을 보지 않는다
export const publicKey = () => call('GET', '/auth/public-key');
export const login = (employeeNo, encryptedPassword) =>
  call('POST', '/auth/login', { body: { employeeNo, encryptedPassword } });

export function client(token) {
  const get = (p, q) => call('GET', p, { token, query: q });
  const post = (p, b) => call('POST', p, { token, body: b });
  const put = (p, b) => call('PUT', p, { token, body: b });
  const del = (p) => call('DELETE', p, { token });

  const api = {
    me: () => get('/auth/me'),
    logout: () => post('/auth/logout'),
    weeks: (count = 8, ahead = 1) => get('/weekly-reports/weeks', { count, ahead }),

    // 없으면 null
    async getReport(year, week, buId) {
      try { return await get(`/weekly-reports/${year}/${week}/${buId}`); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },

    // 사이트와 동일: 생성 시도 → 이미 있으면 조회
    async ensureReport(year, week, buId) {
      try { return await post('/weekly-reports', { year, week }); }
      catch (e) {
        if (e.code === 'REPORT_EXISTS') return api.getReport(year, week, buId);
        throw e;
      }
    },

    async searchWorks(q, size = 30) {
      const [p, s] = await Promise.all([
        get('/works', { workTypeCode: 'P', q, size }),
        get('/works', { workTypeCode: 'S', q, size }),
      ]);
      return [...(p.items || []), ...(s.items || [])].map((w) => ({
        workId: w.workId,
        workName: w.workName,
        workKindCode: w.workTypeCode,
        label: `${w.workTypeCode === 'S' ? '서비스·사업' : '프로젝트'} · ${w.externalCode ?? w.workId}`,
      }));
    },

    addItem: (reportId, item) =>
      post(`/weekly-reports/${reportId}/items`, item.workKindCode === 'G'
        ? { workKindCode: 'G', workName: item.workName, thisWeek: '', nextWeek: '' }
        : { workKindCode: item.workKindCode, workId: item.workId, thisWeek: '', nextWeek: '' }),
    lock: (reportId, itemId) => post(`/weekly-reports/${reportId}/items/${itemId}/lock`),
    unlock: (reportId, itemId) => del(`/weekly-reports/${reportId}/items/${itemId}/lock`),
    updateItem: (reportId, itemId, body) => put(`/weekly-reports/${reportId}/items/${itemId}`, body),

    // 잠금 → 수정 → 잠금 해제 (사이트 편집 흐름과 동일)
    async updateLocked(reportId, item, fields) {
      await api.lock(reportId, item.weeklyReportItemId);
      try {
        return await api.updateItem(reportId, item.weeklyReportItemId, {
          workKindCode: item.workKindCode,
          workId: item.workId ?? null,
          workName: item.workName,
          thisWeek: fields.thisWeek ?? item.thisWeek ?? '',
          nextWeek: fields.nextWeek ?? item.nextWeek ?? '',
          issue: fields.issue ?? item.issue ?? '',
        });
      } finally {
        await api.unlock(reportId, item.weeklyReportItemId).catch(() => {});
      }
    },
  };
  return api;
}

