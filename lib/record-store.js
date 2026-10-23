import { chatReady, chatUrl, makeTicket } from './chat.js';
const storeBase = () => process.env.RECORD_STORE_URL || (chatReady() ? chatUrl().replace(/^ws/, 'http') : null);
export const recordStoreReady = () => !!storeBase() && !!(process.env.RECORD_STORE_SECRET || process.env.CHAT_SECRET)?.trim();
export async function recordStore(me, kind, method, { body, query } = {}) {
  // Personal data can use a local server independently of chat and AI.
  const base = storeBase();
  if (!recordStoreReady()) throw Object.assign(new Error('개인 자료 저장소가 설정되지 않았습니다'), { status: 503, code: 'NO_STORE' });
  const url = new URL(`${base.replace(/\/$/, '')}/${kind}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
  let res;
  try { res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-wr-ticket': makeTicket(me, process.env.RECORD_STORE_SECRET?.trim() || undefined) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }); }
  catch { throw Object.assign(new Error('개인 자료 저장소에 연결하지 못했습니다. 변경 내용은 이 기기에 보관됩니다.'), { status: 502, code: 'STORE_UNAVAILABLE' }); }
  const data = await res.json().catch(() => null);
  if (!res.ok || data == null) throw Object.assign(new Error(data?.message || '저장소 응답을 확인하지 못했습니다'), { status: [400,401,403,409,413].includes(res.status) ? res.status : 502, code: data?.code || 'STORE_ERROR', current: data?.code === 'SYNC_CONFLICT' ? data.current : undefined });
  return data;
}

// The browser's record queue belongs to an account, even across logout/login.
export function assertAccount(me, expected) {
  if (expected != null && String(me.employeeId) !== String(expected)) {
    throw Object.assign(new Error('로그인 계정이 바뀌었습니다. 원래 계정으로 로그인하면 저장을 다시 시도합니다.'), { status: 409, code: 'ACCOUNT_CHANGED' });
  }
  return me;
}
