import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac, randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { startLocalChatServer } from '../dev/local-chat-server.mjs';
import { ChatClient } from '../src/chat.js';
import { api } from '../src/api.js';

function ticket(secret, sub, exp = Math.floor(Date.now() / 1000) + 300, extra = {}) {
  const payload = Buffer.from(JSON.stringify({ sub, name: `Test ${sub}`, dept: 'Test department', exp, ...extra })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
async function connect(url, token) {
  const ws = new WebSocket(`${url}?ticket=${encodeURIComponent(token)}`);
  const events = [], wait = new Map(), listeners = new Set(); let seq = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.re) {
      const pending = wait.get(m.re); if (!pending) return;
      wait.delete(m.re); clearTimeout(pending.timer);
      if (m.ok) pending.ok(m.data); else pending.no(Object.assign(new Error(m.error.message), { code: m.error.code }));
    } else { events.push(m); for (const f of listeners) f(m); }
  });
  await new Promise((ok, no) => { ws.once('open', ok); ws.once('error', no); });
  return {
    ws, events,
    call(op, args = {}) {
      return new Promise((ok, no) => {
        const id = ++seq;
        const timer = setTimeout(() => { wait.delete(id); no(new Error(`Timeout: ${op}`)); }, 4000);
        wait.set(id, { ok, no, timer }); ws.send(JSON.stringify({ id, op, ...args }));
      });
    },
    event(predicate) {
      const found = events.find(predicate); if (found) return Promise.resolve(found);
      return new Promise((ok, no) => {
        const timer = setTimeout(() => { listeners.delete(listener); no(new Error('Event timeout')); }, 4000);
        const listener = (m) => { if (predicate(m)) { clearTimeout(timer); listeners.delete(listener); ok(m); } };
        listeners.add(listener);
      });
    },
  };
}
const until = async (client, predicate) => {
  if (predicate(client.get())) return;
  await new Promise((ok, no) => {
    const timer = setTimeout(() => { stop(); no(new Error('Client state timeout')); }, 4000);
    const stop = client.subscribe(() => { if (predicate(client.get())) { clearTimeout(timer); stop(); ok(); } });
  });
};

test('local chat implements the existing messenger protocol with persistent ownership', async (t) => {
  const secret = randomBytes(32).toString('hex');
  const dataDir = await mkdtemp(join(tmpdir(), 'wr-chat-test-'));
  const aiRequests = [];
  const ai = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      aiRequests.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '테스트 봇 응답' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise((ok) => ai.listen(0, '127.0.0.1', ok));
  const options = { dataDir, secret, port: 0, aiBaseUrl: `http://127.0.0.1:${ai.address().port}/v1`, aiModel: 'local-test-model' };
  let app, a, b, c;
  const sockets = [];
  const client = new ChatClient();
  const originalTicket = api.chatTicket;
  const originalGlobals = { document: globalThis.document, addEventListener: globalThis.addEventListener, removeEventListener: globalThis.removeEventListener, WebSocket: globalThis.WebSocket };
  t.after(async () => {
    client.stop(); api.chatTicket = originalTicket;
    Object.assign(globalThis, originalGlobals);
    for (const s of sockets) s.ws.terminate();
    await app?.close(); await new Promise((ok) => ai.close(ok));
    await rm(dataDir, { recursive: true, force: true });
  });
  app = await startLocalChatServer(options);
  for (const id of ['account-a', 'account-b', 'account-c']) sockets.push(await connect(app.url, ticket(secret, id)));
  [a, b, c] = sockets;
  globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.WebSocket = WebSocket;
  api.chatTicket = async () => ({ url: app.url, ticket: ticket(secret, 'account-a') });
  await client.start('account-a');
  await until(client, (s) => s.status === 'online');

  await t.test('real app client connects, and invalid tickets and remote origins are rejected', async () => {
    assert.equal(client.get().me.id, 'account-a');
    assert.ok(client.get().users['qwen-bot']);
    assert.ok(client.get().online.has('account-b'));
    for (const [token, origin] of [['forged', undefined], [ticket(secret, 'account-a', 1), undefined], [ticket(secret, 'account-a'), 'https://unrelated.example']]) {
      const status = await new Promise((ok, no) => {
        const ws = new WebSocket(`${app.url}?ticket=${encodeURIComponent(token)}`, origin ? { origin } : {});
        ws.on('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); ok(res.statusCode); });
        ws.on('error', () => {}); ws.on('open', () => { ws.terminate(); no(new Error('Unexpected successful authentication')); });
      });
      assert.equal(status, 401);
    }
  });

  await t.test('friends synchronize only across the owning account connections', async () => {
    await a.call('addFriend', { userId: 'account-b' });
    await until(client, (s) => s.friends.has('account-b'));
    assert.deepEqual(await b.call('friends'), []);
    assert.ok(!b.events.some((e) => e.ev === 'friends'));
  });

  await t.test('signed directory results allow friends and DMs before the employee first logs in', async () => {
    const employee = { id: 'directory-unseen', name: 'Directory employee', employeeNo: 'FTEST002', grade: '', department: 'Test department', bu: '' };
    const token = ticket(secret, 'account-a', Math.floor(Date.now() / 1000) + 300, { purpose: 'employee-directory', employee });
    await assert.rejects(b.call('directory', { tickets: [token] }), { code: 'FORBIDDEN' });
    const users = await a.call('directory', { tickets: [token] });
    assert.equal(users[0].lastSeen, null);
    assert.ok(!(await a.call('hello')).online.includes(employee.id));
    assert.ok((await a.call('addFriend', { userId: employee.id })).includes(employee.id));
    const room = await a.call('openDm', { userId: employee.id });
    assert.ok(room.members.some((m) => m.id === employee.id));
  });

  let dm, group;
  await t.test('DM delivery, sender identity, idempotency, read receipts and typing', async () => {
    dm = await a.call('openDm', { userId: 'account-b' });
    const sent = await a.call('send', { roomId: dm.id, body: 'PRIVATE_DM_ONLY', clientId: 'one-send', senderId: 'account-c' });
    assert.equal(sent.senderId, 'account-a');
    assert.equal((await a.call('send', { roomId: dm.id, body: 'PRIVATE_DM_ONLY', clientId: 'one-send' })).id, sent.id);
    await b.event((e) => e.ev === 'message' && e.message.id === sent.id);
    assert.equal((await b.call('history', { roomId: dm.id })).length, 1);
    await b.call('read', { roomId: dm.id, lastId: sent.id + 9999 });
    assert.equal((await a.event((e) => e.ev === 'read' && e.userId === 'account-b')).lastRead, sent.id);
    await a.call('typing', { roomId: dm.id });
    await b.event((e) => e.ev === 'typing' && e.roomId === dm.id);
    assert.ok(!c.events.some((e) => e.message?.roomId === dm.id));
    await until(client, (s) => s.rooms.some((r) => r.id === dm.id));
    await client.loadHistory(dm.id);
    await client.send(dm.id, 'From the actual app client');
    assert.equal(client.get().messages[dm.id].at(-1).pending, undefined);
  });

  await t.test('nonmembers cannot read, write or alter private rooms', async () => {
    for (const op of ['history', 'send', 'read', 'typing', 'rename', 'invite', 'leave']) {
      await assert.rejects(c.call(op, { roomId: dm.id, body: 'intrusion', lastId: 1, name: 'intrusion', memberIds: ['account-c'] }), { code: 'FORBIDDEN' });
    }
  });

  await t.test('group creation, rename, invitation, leave and history pagination', async () => {
    group = await a.call('createGroup', { name: 'Test group', memberIds: ['account-b'] });
    await a.call('rename', { roomId: group.id, name: 'Renamed group' });
    await a.call('invite', { roomId: group.id, memberIds: ['account-c'] });
    assert.equal((await c.call('hello')).rooms.find((r) => r.id === group.id).name, 'Renamed group');
    await c.call('leave', { roomId: group.id });
    await assert.rejects(c.call('history', { roomId: group.id }), { code: 'FORBIDDEN' });
    for (let n = 0; n < 55; n++) await a.call('send', { roomId: group.id, body: `Message ${n}`, clientId: `page-${n}` });
    const recent = await b.call('history', { roomId: group.id });
    const older = await b.call('history', { roomId: group.id, before: recent[0].id });
    assert.equal(recent.length, 50); assert.equal(older.length, 5);
    assert.ok(older.at(-1).id < recent[0].id);
  });

  await t.test('bot uses only its own room and responds in DMs and mentioned groups', async () => {
    const botDm = await a.call('openDm', { userId: 'qwen-bot' });
    await a.call('send', { roomId: botDm.id, body: 'Hello bot', clientId: 'bot-dm' });
    await a.event((e) => e.ev === 'message' && e.message.roomId === botDm.id && e.message.senderId === 'qwen-bot');
    assert.ok(!JSON.stringify(aiRequests).includes('PRIVATE_DM_ONLY'));
    await a.call('invite', { roomId: group.id, memberIds: ['qwen-bot'] });
    const before = aiRequests.length;
    await a.call('send', { roomId: group.id, body: 'A regular group message', clientId: 'regular' });
    await a.call('setBotProfile', { name: 'Helper', avatar: '/avatars/f01.webp' });
    await a.call('send', { roomId: group.id, body: '@Helper summarize this room', clientId: 'bot-group' });
    await a.event((e) => e.ev === 'message' && e.message.roomId === group.id && e.message.senderId === 'qwen-bot');
    assert.equal(aiRequests.length, before + 1);
    assert.equal(aiRequests.at(-1).model, 'local-test-model');
  });

  await t.test('restart preserves users, rooms, messages, bot profile and account friends', async () => {
    client.stop(); for (const s of sockets) s.ws.terminate();
    await app.close(); app = await startLocalChatServer(options);
    const reconnected = await connect(app.url, ticket(secret, 'account-a')); sockets.push(reconnected);
    const hello = await reconnected.call('hello');
    assert.ok(hello.rooms.some((r) => r.id === dm.id));
    assert.deepEqual(hello.friends, ['account-b', 'directory-unseen']);
    assert.equal(hello.users.find((u) => u.id === 'qwen-bot').name, 'Helper');
    assert.equal((await reconnected.call('history', { roomId: dm.id }))[0].body, 'PRIVATE_DM_ONLY');
  });
});
