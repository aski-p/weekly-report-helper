// Local-only replacement for the private PGX chat server, using the existing UI protocol.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { WebSocketServer, WebSocket } from 'ws';
import { createPool, ticketVerifier } from './local-data-server.mjs';
import { createFriendOperations } from '../pgx/friends.js';
import { createDirectoryOperations } from '../pgx/directory.js';

const BOT = 'qwen-bot';
const fail = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
const shortText = (value, max, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw fail('입력 내용이 올바르지 않습니다');
  return value.trim();
};
const roomId = (value) => { if (!Number.isSafeInteger(value) || value < 1) throw fail('대화방을 선택하세요'); return value; };
const messageRow = (r) => ({ id: r.id, roomId: r.room_id, senderId: r.sender_id, kind: r.kind, body: r.body, clientId: r.client_id, createdAt: new Date(r.created_at).toISOString() });
const userRow = (r) => ({ id: r.employee_id, name: r.name, employeeNo: r.employee_no || '', grade: r.grade, department: r.department, bu: r.bu, avatar: r.avatar, lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null });

export async function startLocalChatServer({ dataDir, secret, port = 3001, aiBaseUrl = process.env.AI_BASE_URL, aiModel = process.env.AI_MODEL, aiKey = process.env.AI_API_KEY } = {}) {
  if (!dataDir || !secret?.trim()) throw new Error('Persistent dataDir and CHAT_SECRET are required');
  await mkdir(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir);
  const pool = createPool(db);
  const query = async (sql, params) => (await pool.query(sql, params)).rows;
  const transaction = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
      await client.query('COMMIT');
      return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  };
  try {
    await pool.query(await readFile(new URL('./local-chat-schema.sql', import.meta.url), 'utf8'));
    await query("INSERT INTO users(employee_id,name,department) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [BOT, 'Qwen', 'AI 비서']);
  } catch (e) { await db.close(); throw e; }
  const sessions = new Map();
  const requestsInFlight = new Set();
  const controllers = new Set();
  const verify = ticketVerifier(secret.trim());
  let closing = false, botTail = Promise.resolve(), botPending = 0;
  const deliver = (ws, value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  const notify = (ids, value) => { for (const id of new Set(ids)) for (const ws of sessions.get(id) || []) deliver(ws, value); };
  const broadcast = (value) => notify([...sessions.keys()], value);
  const members = (id, q = query) => q('SELECT * FROM chat_members WHERE room_id=$1 AND active=true ORDER BY user_id', [id]);
  const access = async (id, owner, q = query) => {
    roomId(id);
    const [r] = await q('SELECT r.* FROM chat_rooms r JOIN chat_members m ON m.room_id=r.id WHERE r.id=$1 AND m.user_id=$2 AND m.active=true', [id, owner]);
    if (!r) throw fail('참여 중인 대화방이 아닙니다', 'FORBIDDEN');
    return r;
  };
  const snapshot = async (id, owner) => {
    const r = await access(id, owner);
    const people = await members(id);
    const own = people.find((m) => m.user_id === owner);
    const [last] = await query('SELECT * FROM chat_messages WHERE room_id=$1 ORDER BY id DESC LIMIT 1', [id]);
    const [count] = await query("SELECT count(*)::int AS n FROM chat_messages WHERE room_id=$1 AND id>$2 AND sender_id<>$3 AND kind='text'", [id, own.last_read, owner]);
    return { id, kind: r.kind, name: r.name, members: people.map((m) => ({ id: m.user_id, lastRead: m.last_read })), myLastRead: own.last_read, unread: count.n, last: last ? messageRow(last) : null, lastMsgAt: new Date(last?.created_at || r.created_at).toISOString() };
  };
  const publishRoom = async (id) => {
    for (const m of await members(id)) if (!m.hidden && m.user_id !== BOT) notify([m.user_id], { ev: 'room', room: await snapshot(id, m.user_id) });
  };
  const knownUsers = () => query('SELECT * FROM users ORDER BY employee_id').then((rows) => rows.map(userRow));
  const validateUsers = async (ids, q) => {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,40}$/.test(id))) throw fail('참여자 목록이 올바르지 않습니다');
    for (const id of new Set(ids)) if (!(await q('SELECT 1 FROM users WHERE employee_id=$1', [id])).length) throw fail('앱에 로그인한 적이 없는 동료입니다');
    return [...new Set(ids)];
  };
  const friends = createFriendOperations({ query, notify });

  async function insertMessage(id, sender, body, clientId = null, kind = 'text') {
    const result = await transaction(async (q) => {
      await access(id, sender, q);
      const people = await members(id, q);
      const [inserted] = await q('INSERT INTO chat_messages(room_id,sender_id,body,client_id,kind) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *', [id, sender, body, clientId, kind]);
      if (!inserted) return { message: messageRow((await q('SELECT * FROM chat_messages WHERE room_id=$1 AND sender_id=$2 AND client_id=$3', [id, sender, clientId]))[0]), duplicate: true };
      await q('UPDATE chat_members SET hidden=false WHERE room_id=$1 AND active=true', [id]);
      await q('UPDATE chat_members SET last_read=$3 WHERE room_id=$1 AND user_id=$2 AND active=true', [id, BOT, inserted.id]);
      return { message: messageRow(inserted), people };
    });
    if (!result.duplicate) {
      const hidden = result.people.filter((m) => m.hidden && m.user_id !== BOT);
      for (const m of hidden) notify([m.user_id], { ev: 'room', room: await snapshot(id, m.user_id) });
      notify(result.people.filter((m) => !m.hidden).map((m) => m.user_id), { ev: 'message', message: result.message });
      if (result.people.some((m) => m.user_id === BOT)) notify(result.people.map((m) => m.user_id), { ev: 'read', roomId: id, userId: BOT, lastRead: result.message.id });
    }
    return result;
  }

  async function answerBot(id) {
    if (closing) return;
    const people = await members(id);
    if (!people.some((m) => m.user_id === BOT)) return;
    const ids = people.map((m) => m.user_id);
    const typing = () => notify(ids, { ev: 'typing', roomId: id, userId: BOT });
    typing();
    const timer = setInterval(typing, 3000);
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      if (!aiBaseUrl || !aiModel) throw fail('로컬 AI 서버가 설정되지 않았습니다');
      const history = await query("SELECT m.*,u.name FROM chat_messages m JOIN users u ON u.employee_id=m.sender_id WHERE room_id=$1 AND kind='text' ORDER BY m.id DESC LIMIT 12", [id]);
      const res = await fetch(`${aiBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(aiKey ? { authorization: `Bearer ${aiKey}` } : {}) },
        body: JSON.stringify({ model: aiModel, temperature: 0.3, max_tokens: 2048, messages: [
          { role: 'system', content: '너는 사내 메신저의 AI 비서다. 이 대화방의 내용만 참고해 한국어로 간결하게 답한다. 모르는 사실이나 담당자, 날짜를 지어내지 않는다. 다른 대화방이나 회사 시스템에 접근할 수 있다고 주장하지 않는다.' },
          ...history.reverse().map((m) => ({ role: m.sender_id === BOT ? 'assistant' : 'user', content: m.sender_id === BOT ? m.body.slice(0, 2000) : `${m.name}: ${m.body.slice(0, 2000)}` })),
        ] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw fail(`AI 서버 응답 오류 (${res.status})`);
      const text = data.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!text) throw fail('AI가 답변을 완성하지 못했습니다. 다시 질문해 주세요');
      if (!closing) await insertMessage(id, BOT, text.slice(0, 12000));
    } catch (e) {
      if (!closing) await insertMessage(id, BOT, e.name === 'AbortError' ? 'AI 응답이 지연되었습니다. 잠시 후 다시 질문해 주세요.' : e.code === 'BAD_REQUEST' ? e.message : '로컬 AI 서버에 연결하지 못했습니다.', null, 'system');
    } finally { clearInterval(timer); clearTimeout(timeout); controllers.delete(controller); }
  }
  const enqueueBot = (id) => {
    if (closing) return;
    if (botPending >= 8) { void insertMessage(id, BOT, 'AI 요청이 많습니다. 잠시 후 다시 질문해 주세요.', null, 'system').catch(() => {}); return; }
    botPending++;
    botTail = botTail.then(() => answerBot(id)).catch((e) => console.error('local bot', e.code || e.message)).finally(() => { botPending--; });
  };

  const operations = {
    async hello({ me }) {
      const rooms = await query('SELECT room_id FROM chat_members WHERE user_id=$1 AND active=true AND hidden=false', [me.id]);
      return { me, users: await knownUsers(), online: [BOT, ...sessions.keys()], friends: await friends.friends({ me }), rooms: (await Promise.all(rooms.map((r) => snapshot(r.room_id, me.id)))).sort((a, b) => b.lastMsgAt.localeCompare(a.lastMsgAt)) };
    },
    users: () => knownUsers(),
    ...createDirectoryOperations({ pool, verifyTicket: verify, notify, buColumn: 'bu' }),
    ...friends,
    async openDm({ me }, { userId }) {
      if (userId === me.id) throw fail('대화할 동료를 선택하세요');
      const id = await transaction(async (q) => {
        await validateUsers([userId], q);
        const key = JSON.stringify([me.id, userId].sort());
        const [r] = await q("INSERT INTO chat_rooms(kind,dm_key) VALUES ('dm',$1) ON CONFLICT(dm_key) DO UPDATE SET dm_key=EXCLUDED.dm_key RETURNING id", [key]);
        for (const who of [me.id, userId]) await q('INSERT INTO chat_members(room_id,user_id) VALUES ($1,$2) ON CONFLICT(room_id,user_id) DO UPDATE SET active=true,hidden=false', [r.id, who]);
        return r.id;
      });
      await publishRoom(id); return snapshot(id, me.id);
    },
    async createGroup({ me }, { name = '', memberIds }) {
      const title = shortText(name, 60, true);
      const id = await transaction(async (q) => {
        const ids = await validateUsers(memberIds, q);
        if (!ids.some((id) => id !== me.id)) throw fail('초대할 사람을 선택하세요');
        const [r] = await q("INSERT INTO chat_rooms(kind,name) VALUES ('group',$1) RETURNING id", [title]);
        for (const who of new Set([me.id, ...ids])) await q('INSERT INTO chat_members(room_id,user_id) VALUES ($1,$2)', [r.id, who]);
        return r.id;
      });
      await publishRoom(id); return snapshot(id, me.id);
    },
    async invite({ me }, { roomId: id, memberIds }) {
      await transaction(async (q) => {
        if ((await access(id, me.id, q)).kind !== 'group') throw fail('그룹 대화에만 초대할 수 있습니다');
        const ids = await validateUsers(memberIds, q);
        const existing = await members(id, q);
        if (new Set([...existing.map((m) => m.user_id), ...ids]).size > 100) throw fail('최대 100명까지 참여할 수 있습니다');
        for (const who of ids) await q('INSERT INTO chat_members(room_id,user_id) VALUES ($1,$2) ON CONFLICT(room_id,user_id) DO UPDATE SET active=true,hidden=false', [id, who]);
      });
      await publishRoom(id); return { ok: true };
    },
    async rename({ me }, { roomId: id, name }) {
      if ((await access(id, me.id)).kind !== 'group') throw fail('그룹 이름만 바꿀 수 있습니다');
      await query('UPDATE chat_rooms SET name=$2 WHERE id=$1', [id, shortText(name, 60, true)]);
      await publishRoom(id); return { ok: true };
    },
    async leave({ me }, { roomId: id }) {
      const room = await access(id, me.id);
      await query('UPDATE chat_members SET active=$3,hidden=true WHERE room_id=$1 AND user_id=$2', [id, me.id, room.kind === 'dm']);
      notify([me.id], { ev: 'left', roomId: id });
      if (room.kind === 'group') await publishRoom(id);
      return { ok: true };
    },
    async history({ me }, { roomId: id, before, limit = 50 }) {
      await access(id, me.id);
      if (before != null && (!Number.isSafeInteger(before) || before < 1)) throw fail('메시지 위치가 올바르지 않습니다');
      const size = Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 50;
      return (await query('SELECT * FROM chat_messages WHERE room_id=$1 AND ($2::integer IS NULL OR id<$2) ORDER BY id DESC LIMIT $3', [id, before ?? null, size])).reverse().map(messageRow);
    },
    async send({ me }, { roomId: id, body, clientId }) {
      const text = shortText(body, 4000);
      if (clientId != null && (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(clientId))) throw fail('메시지 ID가 올바르지 않습니다');
      const result = await insertMessage(id, me.id, text, clientId || randomUUID());
      if (!result.duplicate && result.people.some((m) => m.user_id === BOT)) {
        const room = await access(id, me.id);
        const [bot] = await query('SELECT name FROM users WHERE employee_id=$1', [BOT]);
        if (room.kind === 'dm' || text.includes('@봇') || text.includes(`@${bot.name}`)) enqueueBot(id);
      }
      return result.message;
    },
    async read({ me }, { roomId: id, lastId }) {
      await access(id, me.id);
      if (!Number.isSafeInteger(lastId) || lastId < 1) throw fail('읽은 메시지 ID가 올바르지 않습니다');
      const [last] = await query('SELECT COALESCE(max(id),0)::int AS id FROM chat_messages WHERE room_id=$1', [id]);
      const [own] = await query('UPDATE chat_members SET last_read=GREATEST(last_read,$3) WHERE room_id=$1 AND user_id=$2 RETURNING last_read', [id, me.id, Math.min(lastId, last.id)]);
      notify((await members(id)).map((m) => m.user_id), { ev: 'read', roomId: id, userId: me.id, lastRead: own.last_read });
      return { ok: true };
    },
    async typing({ me }, { roomId: id }) {
      await access(id, me.id);
      notify((await members(id)).filter((m) => m.user_id !== me.id).map((m) => m.user_id), { ev: 'typing', roomId: id, userId: me.id });
      return { ok: true };
    },
    async setBotProfile(_ctx, { name, avatar = '' }) {
      const title = shortText(name, 20);
      if (typeof avatar !== 'string' || (avatar !== '' && !/^\/avatars\/[fm](?:0[1-9]|10)\.webp$/.test(avatar))) throw fail('제공된 봇 사진 중에서 선택하세요');
      const [bot] = await query('UPDATE users SET name=$2,avatar=$3 WHERE employee_id=$1 RETURNING *', [BOT, title, avatar]);
      broadcast({ ev: 'user', user: userRow(bot) }); return userRow(bot);
    },
  };

  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true, chat: true, persistent: true, bot: !!aiBaseUrl && !!aiModel } : { code: 'NOT_FOUND' }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url, 'http://localhost');
      let validOrigin = !req.headers.origin;
      try { validOrigin ||= ['localhost', '127.0.0.1', '[::1]'].includes(new URL(req.headers.origin).hostname); } catch { /* reject unknown origins */ }
      const claims = verify(url.searchParams.get('ticket'));
      if (closing || url.pathname !== '/chat' || !validOrigin || !claims || claims.purpose || String(claims.sub) === BOT) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
      }
      const [record] = await query('INSERT INTO users(employee_id,name,grade,department,bu,employee_no) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(employee_id) DO UPDATE SET name=$2,grade=$3,department=$4,bu=$5,employee_no=COALESCE(NULLIF($6,\'\'),users.employee_no),last_seen=now() RETURNING *', [String(claims.sub), String(claims.name || claims.sub).slice(0, 100), String(claims.grade || '').slice(0, 100), String(claims.dept || '').slice(0, 200), String(claims.bu || '').slice(0, 200), String(claims.no || '').slice(0,40)]);
      if (socket.destroyed || closing) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, userRow(record)));
    })().catch(() => socket.destroy());
  });
  wss.on('connection', (ws, me) => {
    const first = !sessions.has(me.id);
    if (first) sessions.set(me.id, new Set());
    sessions.get(me.id).add(ws);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    if (first) broadcast({ ev: 'presence', userId: me.id, online: true, user: me });
    let queue = Promise.resolve(), windowStart = Date.now(), requests = 0;
    ws.on('message', (raw, binary) => {
      if (Date.now() - windowStart > 10000) { windowStart = Date.now(); requests = 0; }
      if (binary || ++requests > 120) { ws.close(1008, 'Invalid or excessive requests'); return; }
      queue = queue.then(async () => {
        let request;
        try {
          request = JSON.parse(raw.toString());
          if (!request || !Number.isSafeInteger(request.id) || request.id < 1 || !Object.hasOwn(operations, request.op)) throw fail('지원하지 않는 요청입니다');
          const data = await operations[request.op]({ me }, request);
          deliver(ws, { re: request.id, ok: true, data });
        } catch (e) {
          deliver(ws, { re: request?.id || -1, ok: false, error: { code: ['BAD_REQUEST', 'FORBIDDEN'].includes(e.code) ? e.code : 'ERROR', message: ['BAD_REQUEST', 'FORBIDDEN'].includes(e.code) ? e.message : '채팅 요청을 처리하지 못했습니다' } });
          if (!['BAD_REQUEST', 'FORBIDDEN'].includes(e.code)) console.error('local chat', e.code || e.message);
        }
      }).catch((e) => console.error('local chat queue', e.message));
      const pending = queue;
      requestsInFlight.add(pending);
      void pending.finally(() => requestsInFlight.delete(pending));
    });
    ws.on('close', () => {
      sessions.get(me.id)?.delete(ws);
      if (!sessions.get(me.id)?.size) {
        sessions.delete(me.id);
        broadcast({ ev: 'presence', userId: me.id, online: false });
      }
    });
  });
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 30000);
  heartbeat.unref();
  try { await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); }); }
  catch (e) { clearInterval(heartbeat); await db.close(); throw e; }
  let shutdown;
  return {
    url: `ws://127.0.0.1:${server.address().port}/chat`,
    close() {
      return shutdown ??= (async () => {
        closing = true; clearInterval(heartbeat);
        for (const controller of controllers) controller.abort();
        for (const ws of wss.clients) ws.terminate();
        await new Promise((ok) => wss.close(ok));
        await new Promise((ok) => server.close(ok));
        await Promise.allSettled([...requestsInFlight]);
        await botTail;
        await db.close();
      })();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = resolve(root, process.env.LOCAL_CHAT_DB_DIR || '.claude/local-chat/data');
  const app = await startLocalChatServer({ dataDir, secret: process.env.CHAT_SECRET, port: Number(process.env.LOCAL_CHAT_PORT || 3001) });
  console.log(`Local chat: ${app.url}`);
  console.log(`Persistent chat files: ${dataDir}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    app.close().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
  });
}
