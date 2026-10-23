import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalDataServer } from '../dev/local-data-server.mjs';
import { recordStore } from '../lib/record-store.js';
import { meetingsForWeek } from '../lib/meeting-report.js';
import { chatReady } from '../lib/chat.js';

test('local PostgreSQL preserves the PGX personal-data contract', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'wr-db-test-'));
  const secret = randomBytes(32).toString('hex');
  let app;
  const oldSecret = process.env.CHAT_SECRET, oldUrl = process.env.RECORD_STORE_URL;
  t.after(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (oldSecret == null) delete process.env.CHAT_SECRET; else process.env.CHAT_SECRET = oldSecret;
    if (oldUrl == null) delete process.env.RECORD_STORE_URL; else process.env.RECORD_STORE_URL = oldUrl;
  });
  const start = async () => {
    app = await startLocalDataServer({ dataDir, secret, port: 0 });
    process.env.RECORD_STORE_URL = `${app.url}/chat`;
    process.env.CHAT_SECRET = secret;
  };
  await start();
  const me = { employeeId: 'account-a', employeeName: 'Test account A' };
  const other = { employeeId: 'account-b', employeeName: 'Test account B' };
  const template = { id: 'shared-id', name: 'Template A', thisWeek: 'Draft', createdAt: Date.now() };

  await t.test('signed API access and independent record-store URL', async () => {
    const res = await fetch(`${app.url}/chat/templates`);
    assert.equal(res.status, 401);
    const sign = (claims) => {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
    };
    for (const ticket of [sign({ sub: 'account-a', exp: 1 }), sign({ sub: '', exp: Date.now() }), `${'x'}.${'é'.repeat(43)}`]) {
      assert.equal((await fetch(`${app.url}/chat/templates`, { headers: { 'x-wr-ticket': ticket } })).status, 401);
    }
    const saved = await recordStore(me, 'templates', 'PUT', { body: { template } });
    assert.equal(saved.items[0].name, 'Template A');
  });

  await t.test('same IDs belong to separate accounts and migration never overwrites', async () => {
    await recordStore(other, 'templates', 'PUT', { body: { template: { ...template, name: 'Template B' } } });
    await recordStore(me, 'templates', 'PUT', { body: { templates: [{ ...template, name: 'Old device copy' }] } });
    assert.equal((await recordStore(me, 'templates', 'GET'))[0].name, 'Template A');
    assert.equal((await recordStore(other, 'templates', 'GET'))[0].name, 'Template B');
    await recordStore(other, 'templates', 'DELETE', { query: { id: template.id } });
    assert.equal((await recordStore(me, 'templates', 'GET')).length, 1);
    assert.equal((await recordStore(other, 'templates', 'GET')).length, 0);
  });

  await t.test('concurrent transactions and paginated speaker records', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => recordStore(me, 'meetings', 'PUT', { body: { meeting: {
      id: `meeting-${String(i).padStart(3, '0')}`, date: '2026-10-23', title: `Meeting ${i}`,
      segments: [{ id: 'speech-1', start: 0, end: 2, speaker: 'A', text: 'A sample statement' }],
      speakerNames: { A: 'Speaker A' }, speakerState: 'encrypted_state',
    } } })));
    const first = await recordStore(me, 'meetings', 'GET');
    assert.equal(first.items.length, 20);
    assert.equal(first.items[0].speakerNames.A, 'Speaker A');
    assert.equal(first.items[0].segments[0].text, 'A sample statement');
    const second = await recordStore(me, 'meetings', 'GET', { query: { cursor: first.nextCursor } });
    assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map((m) => m.id)).size, 25);
    assert.deepEqual((await recordStore(other, 'meetings', 'GET')).items, []);
  });

  await t.test('records survive a database and HTTP server restart', async () => {
    await app.close();
    await start();
    assert.equal((await recordStore(me, 'templates', 'GET'))[0].name, 'Template A');
    const { items } = await recordStore(me, 'meetings', 'GET');
    assert.equal(items.length, 20);
    assert.equal(items[0].speakerState, 'encrypted_state');
  });

  await t.test('weekly reports include local meetings while chat is disabled', async (t) => {
    const previous = process.env.CHAT_ENABLED;
    t.after(() => {
      if (previous == null) delete process.env.CHAT_ENABLED; else process.env.CHAT_ENABLED = previous;
    });
    process.env.CHAT_ENABLED = 'false';
    assert.equal(chatReady(), false);
    const meetings = await meetingsForWeek(me, 2026, 43);
    assert.equal(meetings.length, 25);
  });

  await t.test('a separate store key keeps the local DB working after chat moves to PGX', async (t) => {
    const previous = process.env.RECORD_STORE_SECRET;
    t.after(() => {
      process.env.CHAT_SECRET = secret;
      if (previous == null) delete process.env.RECORD_STORE_SECRET; else process.env.RECORD_STORE_SECRET = previous;
    });
    process.env.RECORD_STORE_SECRET = secret;
    process.env.CHAT_SECRET = 'a-different-remote-chat-secret';
    assert.equal((await recordStore(me, 'templates', 'GET'))[0].name, 'Template A');
  });
});
