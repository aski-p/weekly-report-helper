// Vercel 서버리스 함수: /api/* 요청은 vercel.json 의 rewrite 로 모두 여기로 온다.
import { handle } from '../lib/routes.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  // rewrite 후에도 원래 경로를 ?path= 로 넘겨받는다
  const path = '/' + (url.searchParams.get('path') || '').replace(/^\/+/, '');
  url.searchParams.delete('path');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const { status, data } = await handle({
    method: req.method,
    path,
    headers: req.headers,
    body,
    query: url.searchParams,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}
