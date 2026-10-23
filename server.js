// 로컬 개발/자체 호스팅용 서버: /api/* 는 lib/routes.js 로, 나머지는 dist/ 정적 파일.
// Vercel 에서는 쓰이지 않는다 (api/router.js 가 같은 handle 을 쓴다).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { MAX_REQUEST_BYTES, SECURITY_HEADERS, CSP, safeFailure, securityError } from './lib/security.js';
import { handle } from './lib/routes.js';

const PORT = +process.env.PORT || 3000;
const DIST = join(import.meta.dirname, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const readBody = async (req) => {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST_BYTES)throw securityError('요청 내용이 너무 큽니다',413,'TOO_LARGE');chunks.push(chunk);}
  return chunks.length?Buffer.concat(chunks).toString():undefined;
};

http.createServer(async (req, res) => {
  for(const [key,value]of Object.entries(SECURITY_HEADERS))res.setHeader(key,value);
  res.setHeader('Content-Security-Policy',CSP);
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let result;
    try{const body=req.method==='GET'?undefined:await readBody(req);result=await handle({method:req.method,path:url.pathname.slice(4),headers:req.headers,body,query:url.searchParams,ip:req.socket.remoteAddress});}
    catch(e){result=safeFailure(e,url.pathname);}
    const {status,data}=result;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private' });
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
