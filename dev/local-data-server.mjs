// Temporary, loopback-only PostgreSQL personal-data server. Never deployed.
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createDataApi, ensureDataTables } from '../pgx/data-api.js';

// PGlite has one connection. Keep the whole transaction together, including
// standalone reads, so simultaneous accounts cannot share a transaction.
export function createPool(db) {
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let unlock;
    tail = new Promise((done) => { unlock = done; });
    await previous;
    return unlock;
  }
  async function query(sql, params) {
    const result = params === undefined ? (await db.exec(sql)).at(-1) : await db.query(sql, params);
    return { ...result, rowCount: result.rowCount ?? (result.command === 'SELECT' ? result.rows.length : result.affectedRows ?? 0) };
  }
  return {
    async query(sql, params) {
      const release = await acquire();
      try { return await query(sql, params); } finally { release(); }
    },
    async connect() {
      const unlock = await acquire();
      let released = false;
      return { query, release() { if (!released) { released = true; unlock(); } } };
    },
  };
}

export function ticketVerifier(secret) {
  return (ticket) => {
    if (typeof ticket !== 'string' || ticket.length > 10000) return null;
    const parts = ticket.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 || !/^[A-Za-z0-9_.-]{1,40}$/.test(String(claims.sub ?? ''))) return null;
      return claims;
    } catch { return null; }
  };
}

export async function startLocalDataServer({ dataDir, secret, port = 54329 } = {}) {
  if (!secret?.trim()) throw new Error('CHAT_SECRET is required in .env.local');
  if (!dataDir) throw new Error('A persistent dataDir is required');
  await mkdir(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir);
  try {
    const pool = createPool(db);
    await ensureDataTables(pool);
    const dataApi = createDataApi({ pool, verifyTicket: ticketVerifier(secret.trim()) });
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true, database: 'PostgreSQL (PGlite)', persistent: true }));
        return;
      }
      const kind = { '/chat/templates': 'templates', '/chat/meetings': 'meetings' }[url.pathname];
      if (kind) return void dataApi(req, res, url, kind);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Local personal-data API only' }));
    });
    await new Promise((ok, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', ok);
    });
    let closing;
    return {
      url: `http://127.0.0.1:${server.address().port}`,
      close() {
        return closing ??= (async () => {
          await new Promise((ok, fail) => server.close((e) => e ? fail(e) : ok()));
          await db.close();
        })();
      },
    };
  } catch (e) { await db.close(); throw e; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = resolve(root, process.env.LOCAL_DB_DIR || '.claude/local-db/data');
  const app = await startLocalDataServer({ dataDir, secret: process.env.RECORD_STORE_SECRET || process.env.CHAT_SECRET, port: Number(process.env.LOCAL_DB_PORT || 54329) });
  console.log(`Local data API: ${app.url}/chat`);
  console.log(`Persistent PostgreSQL files: ${dataDir}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    app.close().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
  });
}
