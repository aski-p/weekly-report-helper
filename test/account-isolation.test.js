import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAccount } from '../lib/record-store.js';
import { ChatClient } from '../src/chat.js';
import { api } from '../src/api.js';
const browserGlobals = () => {
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
};
test('the authenticated owner rejects pending writes belonging to the previous account', () => {
  const me = { employeeId: 'accountB' };
  assert.throws(() => assertAccount(me, 'accountA'), { code: 'ACCOUNT_CHANGED', status: 409 });
  assert.equal(assertAccount(me, 'accountB'), me);
  assert.equal(assertAccount(me, undefined), me); // existing clients still use their authenticated identity
});
test('a ticket arriving after logout never reconnects the old chat account', async () => {
  browserGlobals();
  let finish, sockets = 0;
  const original = api.chatTicket;
  api.chatTicket = () => new Promise((r) => { finish = r; });
  globalThis.WebSocket = class { constructor() { sockets++; } };
  try {
    const client = new ChatClient();
    await client.start('accountA');
    client.stop();
    finish({ url: 'ws://example.invalid', ticket: 'old' });
    await new Promise((r) => setImmediate(r));
    assert.equal(sockets, 0);
    assert.equal(client.get().me, null);
  } finally { api.chatTicket = original; }
});
test('logout immediately rejects pending friend operations and clears their timers', async () => {
  browserGlobals();
  const client = new ChatClient();
  client.ws = { readyState: 1, send() {}, close() {} };
  const request = client.call('addFriend', { userId: 'accountB' });
  client.stop();
  await assert.rejects(request, /계정이 변경/);
  assert.equal(client.wait.size, 0);
  assert.equal(client.get().friends.size, 0);
});
