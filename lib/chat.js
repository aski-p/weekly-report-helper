// 채팅 티켓: 로그인한 사람에게 PGX 채팅 서버 접속권을 짧게(5분) 서명해 준다.
// 채팅 서버는 이 서명만 확인하고, OneFinger 토큰은 PGX 로 가지 않는다.
import { createHmac } from 'node:crypto';

const TTL_SEC = 300;
// 채팅 서버는 파일에서 읽은 값을 trim 해서 쓰므로 여기서도 앞뒤 공백·줄바꿈을 뺀다
const secret = () => (process.env.CHAT_SECRET || '').trim();
const sign = (claims, signingSecret = secret()) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', signingSecret).update(payload).digest('base64url')}`;
};
export const chatReady = () => process.env.CHAT_ENABLED !== 'false' && !!secret() && !!chatUrl();

// CHAT_URL 이 없으면 AI 서버와 같은 PGX 주소의 /chat
export function chatUrl() {
  if (process.env.CHAT_URL) return process.env.CHAT_URL;
  if (!process.env.AI_BASE_URL) return null;
  const u = new URL(process.env.AI_BASE_URL);
  return `${u.protocol === 'http:' ? 'ws:' : 'wss:'}//${u.host}/chat`;
}

export function makeTicket(me, signingSecret) {
  return sign({
    sub: me.employeeId,
    name: me.employeeName,
    grade: me.gradeName || '',
    dept: me.departmentName || '',
    bu: me.buName || '',
    no: me.employeeNo || '',
    exp: Math.floor(Date.now() / 1000) + TTL_SEC,
  }, signingSecret);
}

// Register verified directory entries without forwarding the OneFinger login token.
export const makeDirectoryTicket = (me, employee) => sign({ sub: me.employeeId, purpose: 'employee-directory', employee, exp: Math.floor(Date.now() / 1000) + TTL_SEC });
