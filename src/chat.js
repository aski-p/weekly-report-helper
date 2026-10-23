// 채팅 클라이언트: 앱 서버에서 티켓을 받아 PGX 채팅 서버(WebSocket)에 붙는다. 끊기면 다시 붙는다.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from './api.js';

const initial = () => ({ status: 'idle', error: '', me: null, users: {}, online: new Set(), friends: new Set(), rooms: [], messages: {}, hasMore: {}, typing: {} });

export class ChatClient {
  constructor() {
    this.s = initial();
    this.subs = new Set();
    this.ws = null;
    this.n = 0;
    this.wait = new Map();
    this.retry = 0;
    this.listeners = new Set(); // 새 메시지 알림용
    this.generation = 0;
    this.viewing = null; // 지금 화면에 열려 있는 방 (알림 생략용)
  }

  // ── 상태 구독 (React useSyncExternalStore)
  subscribe = (fn) => { this.subs.add(fn); return () => this.subs.delete(fn); };
  get = () => this.s;
  set(patch) { this.s = { ...this.s, ...(typeof patch === 'function' ? patch(this.s) : patch) }; this.subs.forEach((f) => f()); }
  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async start(accountId) {
    if (this.started) return;
    this.accountId = accountId;
    this.generation++;
    this.started = true;
    this.connect();
    this.onOnline = () => this.ws?.readyState !== 1 && this.connect();
    this.onVisible = () => { if (!document.hidden) { if (this.ws?.readyState !== 1) this.connect(); else this.call('friends').then((ids) => this.set({ friends: new Set(ids) })).catch(() => {}); } };
    addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop() {
    this.started = false;
    this.generation++;
    removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    for (const w of this.wait.values()) { clearTimeout(w.timer); w.no(new Error('로그인 계정이 변경되었습니다')); }
    this.wait.clear();
    clearTimeout(this.timer);
    this.ws?.close(1000);
    this.ws = null;
    this.s = initial();
    this.subs.forEach((f) => f());
  }

  async connect() {
    if (!this.started) return;
    clearTimeout(this.timer);
    if (this.ws && this.ws.readyState <= 1) return;
    if (this.connecting === this.generation) return;
    this.connecting = this.generation;
    this.set({ status: this.s.me ? 'reconnecting' : 'connecting', error: '' });
    const generation = this.generation;
    const current = () => this.started && generation === this.generation;
    let t;
    try { t = await api.chatTicket(this.accountId); } catch (e) {
      if (this.connecting === generation) this.connecting = null;
      if (!current()) return;
      if (e.code === 'NO_CHAT') { this.set({ status: 'off', error: '채팅 서버가 아직 설정되지 않았습니다.' }); return; }
      return this.backoff(e.message);
    }
    if (this.connecting === generation) this.connecting = null;
    if (!current()) return;
    const ws = new WebSocket(`${t.url}?ticket=${encodeURIComponent(t.ticket)}`);
    this.ws = ws;
    ws.onopen = async () => {
      if (!current()) { ws.close(); return; }
      this.retry = 0;
      try {
        const h = await this.call('hello');
        if (!current()) return;
        const users = Object.fromEntries(h.users.map((u) => [u.id, u]));
        this.set((s) => ({ status: 'online', me: h.me, users, online: new Set(h.online), friends: new Set(h.friends || []), rooms: h.rooms, messages: reconnectKeep(s.messages, h.rooms) }));
      } catch (e) { if (current()) this.set({ error: e.message }); }
    };
    ws.onmessage = (e) => { if (current()) this.handle(JSON.parse(e.data)); };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const w of this.wait.values()) { clearTimeout(w.timer); w.no(new Error('연결이 끊겼습니다')); }
      this.wait.clear();
      if (e.code === 4001) this.retry = 0; // 티켓 만료 → 새 티켓으로 바로
      this.backoff(e.code === 4001 ? '' : '채팅 서버와 연결이 끊겼습니다');
    };
  }

  backoff(msg) {
    if (!this.started) return;
    const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.set({ status: 'reconnecting', error: msg || '' });
    this.timer = setTimeout(() => this.connect(), wait);
  }

  call(op, args = {}) {
    return new Promise((ok, no) => {
      if (this.ws?.readyState !== 1) { no(new Error('채팅 서버에 연결되지 않았습니다')); return; }
      const id = ++this.n;
      const timer = setTimeout(() => { if (this.wait.has(id)) { this.wait.delete(id); no(new Error('응답이 없습니다')); } }, 15_000);
      this.wait.set(id, { ok, no, timer });
      this.ws.send(JSON.stringify({ id, op, ...args }));
    });
  }

  handle(m) {
    if (m.re) {
      const w = this.wait.get(m.re);
      if (!w) return;
      this.wait.delete(m.re);
      clearTimeout(w.timer);
      return m.ok ? w.ok(m.data) : w.no(Object.assign(new Error(m.error?.message || '오류'), { code: m.error?.code }));
    }
    if (m.ev === 'message') {
      const msg = m.message;
      this.set((s) => {
        const list = s.messages[msg.roomId];
        const mine = s.me && msg.senderId === s.me.id;
        const rooms = s.rooms.map((r) => (r.id === msg.roomId ? { ...r, last: msg, lastMsgAt: msg.createdAt, unread: mine || msg.kind !== 'text' ? r.unread : r.unread + 1 } : r))
          .sort((a, b) => new Date(b.lastMsgAt) - new Date(a.lastMsgAt));
        if (!list) return { rooms };
        if (list.some((x) => x.id === msg.id)) return { rooms };
        return { rooms, messages: { ...s.messages, [msg.roomId]: [...list.filter((x) => !(msg.clientId && x.clientId === msg.clientId)), msg] } };
      });
      this.listeners.forEach((f) => f(msg));
    } else if (m.ev === 'room') {
      this.set((s) => ({ rooms: [m.room, ...s.rooms.filter((r) => r.id !== m.room.id)].sort((a, b) => new Date(b.lastMsgAt) - new Date(a.lastMsgAt)) }));
      // 모르는 사람이 들어 있으면 명단 다시 받기
      if (m.room.members.some((x) => !this.s.users[x.id])) this.call('users').then((us) => this.set({ users: Object.fromEntries(us.map((u) => [u.id, u])) })).catch(() => {});
    } else if (m.ev === 'read') {
      this.set((s) => ({
        rooms: s.rooms.map((r) => (r.id !== m.roomId ? r : {
          ...r,
          members: r.members.map((x) => (x.id === m.userId ? { ...x, lastRead: Math.max(x.lastRead, m.lastRead) } : x)),
          ...(s.me && m.userId === s.me.id ? { unread: 0, myLastRead: m.lastRead } : {}),
        })),
      }));
    } else if (m.ev === 'presence') {
      this.set((s) => {
        const online = new Set(s.online);
        m.online ? online.add(m.userId) : online.delete(m.userId);
        const users = m.user && !s.users[m.userId] ? { ...s.users, [m.userId]: m.user } : s.users;
        return { online, users };
      });
    } else if (m.ev === 'friends') {
      this.set({ friends: new Set(m.friends || []) });
    } else if (m.ev === 'user') {
      // 봇 이름·사진이 바뀌었을 때
      this.set((s) => ({ users: { ...s.users, [m.user.id]: { ...s.users[m.user.id], ...m.user } } }));
    } else if (m.ev === 'typing') {
      this.set((s) => ({ typing: { ...s.typing, [m.roomId]: { userId: m.userId, until: Date.now() + 4000 } } }));
    } else if (m.ev === 'left') {
      this.set((s) => ({ rooms: s.rooms.filter((r) => r.id !== m.roomId) }));
    }
  }

  // ── 동작
  async loadHistory(roomId, older = false) {
    const cur = this.s.messages[roomId] || [];
    const before = older ? cur.find((x) => x.id)?.id : undefined;
    const rows = await this.call('history', { roomId, before, limit: 50 });
    this.set((s) => {
      const have = s.messages[roomId] || [];
      const merged = older ? [...rows, ...have] : [...rows, ...have.filter((x) => !x.id || x.id > (rows.at(-1)?.id || 0))];
      return { messages: { ...s.messages, [roomId]: merged }, hasMore: { ...s.hasMore, [roomId]: rows.length === 50 } };
    });
  }

  async send(roomId, body) {
    const clientId = Math.random().toString(36).slice(2);
    const pending = { clientId, roomId, senderId: this.s.me.id, kind: 'text', body, createdAt: new Date().toISOString(), pending: true };
    this.set((s) => ({ messages: { ...s.messages, [roomId]: [...(s.messages[roomId] || []), pending] } }));
    try {
      await this.call('send', { roomId, body, clientId });
    } catch (e) {
      this.set((s) => ({ messages: { ...s.messages, [roomId]: (s.messages[roomId] || []).map((x) => (x.clientId === clientId && !x.id ? { ...x, pending: false, failed: true } : x)) } }));
      throw e;
    }
  }

  read(roomId) {
    const list = this.s.messages[roomId] || [];
    const last = [...list].reverse().find((x) => x.id)?.id;
    const room = this.s.rooms.find((r) => r.id === roomId);
    if (!last || !room || (room.myLastRead >= last && !room.unread)) return;
    this.set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, unread: 0, myLastRead: last } : r)) }));
    this.call('read', { roomId, lastId: last }).catch(() => {});
  }

  openDm = (userId) => this.call('openDm', { userId }).then((room) => { this.set((s) => ({ rooms: [room, ...s.rooms.filter((r) => r.id !== room.id)] })); return room; });
  createGroup = (name, memberIds) => this.call('createGroup', { name, memberIds }).then((room) => { this.set((s) => ({ rooms: [room, ...s.rooms.filter((r) => r.id !== room.id)] })); return room; });
  refreshUsers = () => this.call('users').then((us) => this.set({ users: Object.fromEntries(us.map((u) => [u.id, u])) }));
  async searchEmployees(q) {
    const generation = this.generation;
    const current = () => this.started && this.generation === generation;
    const { employees } = await api.searchEmployees(q, this.accountId);
    if (!current()) throw new Error('로그인 계정이 변경되었습니다');
    if (!employees.length) return [];
    const users = await this.call('directory', { tickets: employees.map((e) => e.directoryTicket) });
    if (!current()) throw new Error('로그인 계정이 변경되었습니다');
    this.set((s) => ({ users: { ...s.users, ...Object.fromEntries(users.map((u) => [u.id, u])) } }));
    return users;
  }
  addFriend = (userId) => this.call('addFriend', { userId }).then((ids) => this.set({ friends: new Set(ids) }));
  removeFriend = (userId) => this.call('removeFriend', { userId }).then((ids) => this.set({ friends: new Set(ids) }));
  invite = (roomId, memberIds) => this.call('invite', { roomId, memberIds });
  leave = (roomId) => this.call('leave', { roomId });
  rename = (roomId, name) => this.call('rename', { roomId, name });
  setBotProfile = (name, avatar) => this.call('setBotProfile', { name, avatar });
  typing = (roomId) => { const now = Date.now(); if (now - (this.lastTyping || 0) < 2500) return; this.lastTyping = now; this.call('typing', { roomId }).catch(() => {}); };
}

export const BOT_ID = 'qwen-bot';
export const BOT_AVATARS = [...Array.from({ length: 10 }, (_, i) => `/avatars/f${String(i + 1).padStart(2, '0')}.webp`),
  ...Array.from({ length: 10 }, (_, i) => `/avatars/m${String(i + 1).padStart(2, '0')}.webp`)];

// 다시 붙었을 때: 열어 둔 방의 메시지는 남기되, 아직 안 보낸(pending) 것만 유지
const reconnectKeep = (messages) => Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, v.filter((x) => x.id || x.pending)]));

export const chat = new ChatClient();

export function useChat() {
  return useSyncExternalStore(chat.subscribe, chat.get);
}

// 방 이름: 그룹은 이름(없으면 멤버 이름), 1:1 은 상대 이름
export function roomTitle(room, s) {
  const others = room.members.filter((m) => m.id !== s.me?.id).map((m) => s.users[m.id]?.name || '알 수 없음');
  if (room.kind === 'dm') return others[0] || '(나간 사람)';
  return room.name || others.slice(0, 4).join(', ') + (others.length > 4 ? ` 외 ${others.length - 4}명` : '') || '빈 대화방';
}

export function useTotalUnread() {
  const s = useChat();
  return useMemo(() => s.rooms.reduce((n, r) => n + (r.unread || 0), 0), [s.rooms]);
}

// 다른 사람이 "입력 중" (4초 지나면 사라짐)
export function useTyping(roomId) {
  const s = useChat();
  const [, tick] = useState(0);
  const t = s.typing[roomId];
  useEffect(() => { if (!t) return; const id = setTimeout(() => tick((x) => x + 1), Math.max(0, t.until - Date.now()) + 50); return () => clearTimeout(id); }, [t]);
  return t && t.until > Date.now() ? s.users[t.userId]?.name : null;
}
