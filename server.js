// 로컬 개발/자체 호스팅용 서버: /api/* 는 lib/routes.js 로, 나머지는 dist/ 정적 파일.
// Vercel 에서는 쓰이지 않는다 (api/router.js 가 같은 handle 을 쓴다).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handle } from './lib/routes.js';

const PORT = +process.env.PORT || 3000;
const DIST = join(import.meta.dirname, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const readBody = (req) => new Promise((ok) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const body = req.method === 'GET' ? undefined : await readBody(req);
    const { status, data } = await handle({ method: req.method, path: url.pathname.slice(4), headers: req.headers, body, query: url.searchParams });
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(data));
  }
  const file = normalize(join(DIST, url.pathname)).startsWith(DIST) ? join(DIST, url.pathname) : null;
  for (const f of [file, join(DIST, 'index.html')]) {
    try {
      const buf = await readFile(f);
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
      return res.end(buf);
    } catch { /* 다음 후보 */ }
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
