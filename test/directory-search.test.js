import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createPool, ticketVerifier } from '../dev/local-data-server.mjs';
import { createDirectoryOperations, ensureDirectoryTables } from '../pgx/directory.js';

test('OneFinger employee search authenticates, limits fields and signs account-bound directory entries', async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    seen.push({ path: url.pathname, auth: req.headers.authorization, q: url.searchParams.get('q'), limit: url.searchParams.get('limit') });
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer verified-test-token') { res.writeHead(401); res.end(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Sign in' })); return; }
    if (url.pathname === '/auth/me') { res.end(JSON.stringify({ employeeId: 'account-a' })); return; }
    if (url.pathname === '/employees') {
      res.end(JSON.stringify([{ employeeId: 'directory-new', employeeName: '가상 직원', employeeNo: 'FTEST001', departmentName: '가상 부서', gradeName: '담당', email: 'private@example.invalid', irrelevantPrivateField: 'do not expose' }])); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => new Promise((ok) => server.close(ok)));
  process.env.ONEFINGER_API = `http://127.0.0.1:${server.address().port}`;
  process.env.CHAT_SECRET = randomBytes(32).toString('hex');
  process.env.CHAT_URL = 'ws://example.invalid/chat';
  process.env.CHAT_ENABLED = 'true';
  const { handle } = await import('../lib/routes.js');
  const request = (token = 'verified-test-token', account = 'account-a', q = '가상') => handle({ method: 'GET', path: '/chat/employees', headers: { authorization: `Bearer ${token}`, 'x-wr-account': account }, query: new URLSearchParams({ q }) });
  const result = await request();
  assert.equal(result.status, 200);
  const [employee] = result.data.employees;
  assert.equal(employee.id, 'directory-new');
  assert.equal(employee.employeeNo, 'FTEST001');
  assert.equal(employee.email, undefined);
  assert.equal(employee.irrelevantPrivateField, undefined);
  const claims = ticketVerifier(process.env.CHAT_SECRET)(employee.directoryTicket);
  assert.equal(claims.sub, 'account-a');
  assert.equal(claims.purpose, 'employee-directory');
  assert.equal(claims.employee.id, employee.id);
  assert.ok(!JSON.stringify(claims).includes('verified-test-token'));
  assert.deepEqual(seen.find((r) => r.path === '/employees'), { path: '/employees', auth: 'Bearer verified-test-token', q: '가상', limit: '30' });
  assert.equal((await request('invalid')).status, 401);
  assert.equal((await request('verified-test-token', 'another-account')).status, 409);
  assert.equal((await request('verified-test-token', 'account-a', '')).status, 400);
});

test('PGX schema accepts verified employees without requiring a prior messenger login', async (t) => {
  const db = await PGlite.create(); t.after(() => db.close());
  const pool = createPool(db);
  await pool.query("CREATE TABLE users(employee_id text PRIMARY KEY,name text NOT NULL,grade text NOT NULL DEFAULT '',department text NOT NULL DEFAULT '',bu_name text NOT NULL DEFAULT '',avatar text NOT NULL DEFAULT '',last_seen timestamptz NOT NULL DEFAULT now())");
  await ensureDirectoryTables(pool);
  const { makeDirectoryTicket } = await import('../lib/chat.js');
  const events = [];
  const ops = createDirectoryOperations({ pool, verifyTicket: ticketVerifier(process.env.CHAT_SECRET), notify: (ids, event) => events.push({ ids, event }) });
  const employee = { id: 'directory-new', name: '가상 직원', employeeNo: 'FTEST001', grade: '담당', department: '가상 부서', bu: '가상 본부' };
  const token = makeDirectoryTicket({ employeeId: 'account-a' }, employee);
  await assert.rejects(ops.directory({ me: { id: 'account-b' } }, { tickets: [token] }), { code: 'FORBIDDEN' });
  await assert.rejects(ops.directory({ me: { id: 'account-a' } }, { tickets: ['forged'] }), { code: 'FORBIDDEN' });
  const [saved] = await ops.directory({ me: { id: 'account-a' } }, { tickets: [token] });
  assert.equal(saved.id, employee.id); assert.equal(saved.employeeNo, employee.employeeNo);
  assert.equal(saved.lastSeen, null); assert.equal(saved.bu, employee.bu);
  assert.deepEqual(events[0].ids, ['account-a']);
});
