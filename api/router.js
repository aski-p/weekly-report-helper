// Vercel 서버리스 함수: /api/* 요청은 vercel.json 의 rewrite 로 모두 여기로 온다.
import { SECURITY_HEADERS } from '../lib/security.js';
import { handle } from '../lib/routes.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  // rewrite 후에도 원래 경로를 ?path= 로 넘겨받는다
  const path = '/' + (url.searchParams.get('path') || '').replace(/^\/+/, '');
  url.searchParams.delete('path');

  const { status, data } = await handle({
    method: req.method,
    path,
    headers: req.headers,
    body: req.body,
    ip: req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown',
    query: url.searchParams,
  });
  for(const [key,value] of Object.entries(SECURITY_HEADERS))res.setHeader(key,value);
  res.setHeader('Cache-Control','no-store, private');
  if(status===429)res.setHeader('Retry-After','60');
  res.status(status).json(data);
}
