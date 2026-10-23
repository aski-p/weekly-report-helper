import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { store } from '../api.js';
import { toast } from '../components/Toast.jsx';
import { BOT_AVATARS, BOT_ID, chat, roomTitle, useChat, useTyping } from '../chat.js';

const hhmm = (iso) => { const d = new Date(iso); return `${d.getHours() < 12 ? '오전' : '오후'} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dayKey = (iso) => new Date(iso).toDateString();
const dayText = (iso) => { const d = new Date(iso); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`; };
const listTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const initial = (name) => (name || '?').slice(-2);

const ago = (iso) => {
  if (!iso) return '';
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
};
const NO_DEPT = '부서 없음';

// 오른쪽 아래 메신저 버튼 + 창 (친구 · 부서 · 대화)
export default function ChatWidget() {
  const s = useChat();
  const [open, setOpenRaw] = useState(() => store.get('wr.chat.open') === '1');
  const [tab, setTabRaw] = useState(() => store.get('wr.chat.tab') || 'dept'); // friends | dept | rooms
  const [roomId, setRoomId] = useState(() => +store.get('wr.chat.sel') || null);
  const [dept, setDept] = useState(null);
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(null); // { mode: 'new' | 'invite', roomId? }
  const setOpen = (v) => { setOpenRaw(v); store.set('wr.chat.open', v ? '1' : null); };
  const setTab = (v) => { setTabRaw(v); store.set('wr.chat.tab', v); setQ(''); };
  useEffect(() => { store.set('wr.chat.sel', roomId ? String(roomId) : null); }, [roomId]);
  const room = s.rooms.find((r) => r.id === roomId) || null;
  useEffect(() => { chat.viewing = open && room ? room.id : null; }, [open, room]);
  const unread = s.rooms.reduce((n, r) => n + (r.unread || 0), 0);

  // 부서별 묶음 (나는 빼고, 접속 중 먼저)
  const people = useMemo(() => Object.values(s.users).filter((u) => u.id !== s.me?.id), [s.users, s.me]);
  const depts = useMemo(() => {
    const map = new Map();
    for (const u of people) {
      const k = u.department || NO_DEPT;
      if (!map.has(k)) map.set(k, { name: k, bu: u.bu, users: [] });
      map.get(k).users.push(u);
    }
    const mine = s.me?.department;
    return [...map.values()].map((d) => ({ ...d, online: d.users.filter((u) => s.online.has(u.id)).length }))
      .sort((a, b) => (b.name === mine) - (a.name === mine) || b.online - a.online || a.name.localeCompare(b.name, 'ko'));
  }, [people, s.online, s.me]);
  const sortPeople = (list) => [...list].sort((a, b) => s.online.has(b.id) - s.online.has(a.id) || a.name.localeCompare(b.name, 'ko'));

  async function talk(userId) {
    try { const r = await chat.openDm(userId); setRoomId(r.id); } catch (e) { toast(e.message); }
  }
  const ql = q.trim().toLowerCase();
  const match = (u) => !ql || [u.name, u.department, u.grade, u.id].some((t) => (t || '').toLowerCase().includes(ql));
  const row = (u) => <PersonRow key={u.id} u={u} online={s.online.has(u.id)} onTalk={() => talk(u.id)} />;

  let body;
  if (s.status === 'off') body = <p className="chat-note">{s.error}</p>;
  else if (!s.me) body = <p className="chat-note" role="status">{s.status === 'reconnecting' ? `채팅 서버에 다시 연결하는 중… ${s.error}` : '채팅 서버에 연결하는 중…'}</p>;
  else if (room) body = <Conversation key={room.id} room={room} active={open} onBack={() => setRoomId(null)} onInvite={() => setPicker({ mode: 'invite', roomId: room.id })} onLeft={() => setRoomId(null)} />;
  else {
    let content;
    if (tab === 'friends') {
      const fr = sortPeople(people.filter((u) => s.friends.has(u.id) && match(u)));
      const on = fr.filter((u) => s.online.has(u.id)), off = fr.filter((u) => !s.online.has(u.id));
      content = <>
        <button className="btn primary small block" disabled={s.status !== 'online'} onClick={() => setPicker({ mode: 'friend' })}>친구 등록</button>
        <p className="chat-note">내 계정의 친구 목록은 서버에 저장되어 다른 기기에서도 유지됩니다.</p>
        {!s.friends.size ? <p className="chat-note">아직 친구가 없습니다. 친구 등록으로 동료를 찾아보세요.</p> : (
        <>
          <p className="chat-sec">접속 중 {on.length}</p>{on.map(row)}
          <p className="chat-sec">오프라인 {off.length}</p>{off.map(row)}
          {!fr.length && <p className="chat-note">검색에 맞는 친구가 없습니다.</p>}
        </>
      )}</>;
    } else if (tab === 'dept') {
      if (ql) content = <>{sortPeople(people.filter(match)).map(row)}{!people.some(match) && <p className="chat-note">찾는 사람이 없습니다.</p>}</>;
      else if (dept) {
        const d = depts.find((x) => x.name === dept);
        content = (
          <>
            <button className="chat-crumb" onClick={() => setDept(null)}>‹ 전체 부서</button>
            <p className="chat-sec">{dept}{d?.bu ? <small> · {d.bu}</small> : null} — 접속 {d?.online || 0} / {d?.users.length || 0}명</p>
            {d ? sortPeople(d.users).map(row) : <p className="chat-note">이 부서에 앱을 쓰는 사람이 없습니다.</p>}
          </>
        );
      } else {
        content = !depts.length ? <p className="chat-note">아직 앱에 로그인한 다른 동료가 없습니다. 동료가 한 번 로그인하면 부서별로 나타납니다.</p> : (
          <ul className="dept-list">
            {depts.map((d) => (
              <li key={d.name}>
                <button className="dept-card" onClick={() => setDept(d.name)}>
                  <span className="dept-name">{d.name}{d.name === s.me.department && <span className="chip">내 부서</span>}<small>{d.bu}</small></span>
                  <span className="dept-count"><i className={d.online ? 'on' : ''} />{d.online} / {d.users.length}</span>
                </button>
              </li>
            ))}
          </ul>
        );
      }
    } else {
      const rooms = s.rooms.filter((r) => !ql || roomTitle(r, s).toLowerCase().includes(ql));
      content = (
        <>
          <button className="btn ghost small block" onClick={() => setPicker({ mode: 'new' })}>새 대화 · 그룹 만들기</button>
          {!rooms.length && <p className="chat-note">{s.rooms.length ? '찾는 대화방이 없습니다.' : '아직 대화가 없습니다.'}</p>}
          <ul className="room-list">
            {rooms.map((r) => {
              const title = roomTitle(r, s);
              const other = r.kind === 'dm' ? r.members.find((m) => m.id !== s.me.id) : null;
              return (
                <li key={r.id}>
                  <button className="room-card" onClick={() => setRoomId(r.id)}>
                    <Avatar name={r.kind === 'dm' ? s.users[other?.id]?.name : title} src={r.kind === 'dm' ? s.users[other?.id]?.avatar : ''} group={r.kind === 'group'} online={other && s.online.has(other.id)} />
                    <span className="room-main">
                      <span className="room-title">{title}{r.kind === 'group' && <small> {r.members.length}</small>}</span>
                      <span className="room-last">{r.last ? (r.last.kind === 'system' ? r.last.body : `${r.last.senderId === s.me.id ? '나: ' : ''}${r.last.body}`) : '대화를 시작하세요'}</span>
                    </span>
                    <span className="room-side">
                      <span className="room-time">{listTime(r.last?.createdAt)}</span>
                      {r.unread > 0 && <span className="unread-badge">{r.unread > 99 ? '99+' : r.unread}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      );
    }
    body = (
      <>
        <nav className="chat-tabs" aria-label="메신저">
          {[['friends', '친구'], ['dept', '부서'], ['rooms', '대화']].map(([k, l]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}{k === 'rooms' && unread > 0 && <span className="tab-badge">{unread > 99 ? '99+' : unread}</span>}</button>
          ))}
        </nav>
        <input className="mt-search chat-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={tab === 'rooms' ? '대화방 검색' : '이름·부서 검색'} aria-label="검색" />
        {s.status !== 'online' && <p className="chat-conn">연결이 끊겨 다시 붙는 중…</p>}
        <div className="chat-scroll">{content}</div>
      </>
    );
  }

  return (
    <>
      <button className={`chat-fab${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`메신저${unread ? `, 안 읽은 메시지 ${unread}개` : ''}`}>
        {open
          ? <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M6 6l10 10M16 6L6 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          : <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 4C7.5 4 3 7.6 3 12c0 2.6 1.6 4.9 4 6.4L6.2 22l4.3-2.3c.8.2 1.6.3 2.5.3 5.5 0 10-3.6 10-8s-4.5-8-10-8Z" fill="currentColor" /></svg>}
        {!open && unread > 0 && <span className="fab-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <section className="chat-panel" role="dialog" aria-label="메신저">
          {!room && (
            <header className="chat-panel-head">
              <h2>메신저</h2>
              {s.me && <span className="view-sub">{s.me.name} · 접속 {s.online.size}명</span>}
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="메신저 닫기">×</button>
            </header>
          )}
          {body}
        </section>
      )}
      {picker && (
        <PeoplePicker mode={picker.mode} room={s.rooms.find((r) => r.id === picker.roomId)} onClose={() => setPicker(null)}
          onDone={async (ids, name) => {
            try {
              if (picker.mode === 'friend') { await chat.addFriend(ids[0]); toast('친구를 내 계정에 등록했습니다.'); }
              else if (picker.mode === 'invite') { await chat.invite(picker.roomId, ids); toast('초대했습니다.'); }
              else if (ids.length === 1 && !name) setRoomId((await chat.openDm(ids[0])).id);
              else setRoomId((await chat.createGroup(name, ids)).id);
              setPicker(null);
            } catch (e) { toast(e.message); }
          }} />
      )}
    </>
  );
}

function PersonRow({ u, online, onTalk }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="person-row">
      <Avatar name={u.name} src={u.avatar} online={online} />
      <span className="person-main">
        <b>{u.name}</b> <small>{u.grade}</small>
        <span className={`person-status${online ? ' on' : ''}`}>{online ? '접속 중' : `오프라인${u.lastSeen ? ` · ${ago(u.lastSeen)}` : ''}`}{u.department ? ` · ${u.department}` : ''}</span>
      </span>
      {u.id === BOT_ID
        ? <button className="btn small ghost" onClick={() => setEditing(true)}>프로필</button>
        : <FriendButton user={u} />}
      <button className="btn primary small" onClick={onTalk}>대화</button>
      {editing && <BotProfileDialog onClose={() => setEditing(false)} />}
    </div>
  );
}

function FriendButton({ user }) {
  const s = useChat();
  const [busy, setBusy] = useState(false);
  const friend = s.friends.has(user.id);
  async function toggle() {
    setBusy(true);
    try {
      if (friend) await chat.removeFriend(user.id); else await chat.addFriend(user.id);
      toast(friend ? `${user.name}님을 친구에서 해제했습니다.` : `${user.name}님을 내 친구로 등록했습니다.`);
    } catch (e) { toast(e.message); }
    finally { setBusy(false); }
  }
  return <button className={`btn ghost small${friend ? ' is-friend' : ''}`} onClick={toggle} disabled={busy || s.status !== 'online'} aria-pressed={friend} aria-label={`${user.name} ${friend ? '친구 해제' : '친구 등록'}`}>{busy ? '저장 중…' : friend ? '친구 ✓' : '친구 등록'}</button>;
}

function Avatar({ name, src, group, online }) {
  return (
    <span className={`avatar${group ? ' group' : ''}${src ? ' photo' : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : group ? <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="6.5" cy="6" r="2.6" fill="currentColor" /><circle cx="12.5" cy="7" r="2.2" fill="currentColor" opacity=".7" /><path d="M1.8 15c.4-2.8 2.4-4.4 4.7-4.4s4.3 1.6 4.7 4.4M10.6 11.1c2.3-.4 4.6.8 5.2 3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> : initial(name)}
      {online && <i className="online-dot" title="접속 중" />}
    </span>
  );
}

function Conversation({ room, active, onBack, onInvite, onLeft }) {
  const s = useChat();
  const list = s.messages[room.id];
  const title = roomTitle(room, s);
  const other = room.kind === 'dm' ? s.users[room.members.find((m) => m.id !== s.me?.id)?.id] : null;
  const typer = useTyping(room.id);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [botEdit, setBotEdit] = useState(false);
  const hasBot = room.members.some((m) => m.id === BOT_ID);
  const scroller = useRef(null);
  const atBottom = useRef(true);
  const prevHeight = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => { if (!list) chat.loadHistory(room.id).catch((e) => toast(e.message)); }, [room.id, list]);
  // 보고 있으면 읽음 처리
  useEffect(() => {
    if (!active || !list?.length) return;
    const mark = () => { if (!document.hidden && atBottom.current) chat.read(room.id); };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [active, list, room.id]);

  // 새 메시지가 오면 맨 아래로 (위로 올려 보고 있을 땐 그대로), 예전 글을 불러오면 자리 유지
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current && el.scrollTop < 40) el.scrollTop = el.scrollHeight - prevHeight.current;
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = 0;
  }, [list?.length, active]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom.current && active) chat.read(room.id);
    if (el.scrollTop < 40 && s.hasMore[room.id] && !prevHeight.current) {
      prevHeight.current = el.scrollHeight;
      chat.loadHistory(room.id, true).catch(() => { prevHeight.current = 0; });
    }
  };

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    atBottom.current = true;
    try { await chat.send(room.id, body); } catch (e) { toast(e.message); }
    inputRef.current?.focus();
  }

  const onKey = (e) => {
    // 한글 조합 중 Enter 는 글자 확정용이라 보내지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
  };

  // 메시지마다 "안 읽은 사람 수" (보낸 사람 제외)
  const unreadOf = (m) => (m.id && m.kind === 'text' ? room.members.filter((x) => x.id !== m.senderId && x.lastRead < m.id).length : 0);

  async function leave() {
    setMenu(false);
    if (!confirm(room.kind === 'group' ? `"${title}" 방에서 나갈까요? 대화 내용이 목록에서 사라집니다.` : '이 대화를 목록에서 지울까요? 상대가 다시 말을 걸면 다시 나타납니다.')) return;
    try { await chat.leave(room.id); onLeft(); } catch (e) { toast(e.message); }
  }
  async function inviteBot() {
    setMenu(false);
    try { await chat.invite(room.id, [BOT_ID]); toast(`봇이 대화를 듣고 있습니다. 의견이 필요하면 "@봇"으로 불러 주세요.`); } catch (e) { toast(e.message); }
  }
  async function rename() {
    setMenu(false);
    const name = prompt('방 이름', room.name || '');
    if (name == null) return;
    try { await chat.rename(room.id, name); } catch (e) { toast(e.message); }
  }

  let lastDay = null, lastSender = null, lastMin = null;
  return (
    <div className="convo">
      <header className="convo-head">
        <button className="text-link convo-back" onClick={onBack} aria-label="목록으로">‹</button>
        <div className="convo-title">
          <h3>{title}</h3>
          <p className="view-sub">
            {room.kind === 'group'
              ? `${room.members.length}명 · ${room.members.filter((m) => s.online.has(m.id)).length}명 접속 중`
              : (() => { const o = room.members.find((m) => m.id !== s.me.id); const u = s.users[o?.id]; return u ? `${[u.department, u.grade].filter(Boolean).join(' · ')}${s.online.has(u.id) ? ' · 접속 중' : ''}` : ''; })()}
          </p>
        </div>
        {other && other.id !== BOT_ID && <FriendButton user={other} />}
        <div className="convo-menu">
          <button className="icon-btn" aria-label="대화방 메뉴" aria-expanded={menu} onClick={() => setMenu((x) => !x)}>⋯</button>
          {menu && (
            <div className="menu-pop" role="menu">
              {room.kind === 'group' && <button role="menuitem" onClick={() => { setMenu(false); onInvite(); }}>사람 초대</button>}
              {room.kind === 'group' && <button role="menuitem" onClick={rename}>방 이름 바꾸기</button>}
              {room.kind === 'group' && !hasBot && <button role="menuitem" onClick={inviteBot}>{s.users[BOT_ID]?.name || '봇'} 초대</button>}
              {hasBot && <button role="menuitem" onClick={() => { setMenu(false); setBotEdit(true); }}>봇 이름·사진 바꾸기</button>}
              <button role="menuitem" onClick={leave}>{room.kind === 'group' ? '방 나가기' : '대화 지우기'}</button>
            </div>
          )}
        </div>
      </header>

      <div className="convo-body" ref={scroller} onScroll={onScroll}>
        {!list && <p className="view-empty small">불러오는 중…</p>}
        {list && !s.hasMore[room.id] && list.length > 0 && <p className="convo-start">대화의 시작입니다</p>}
        {list?.map((m) => {
          const day = dayKey(m.createdAt);
          const showDay = day !== lastDay;
          const min = m.createdAt.slice(0, 16);
          const grouped = !showDay && m.kind === 'text' && lastSender === m.senderId && lastMin === min;
          lastDay = day; lastSender = m.kind === 'text' ? m.senderId : null; lastMin = min;
          const mine = m.senderId === s.me.id;
          const sender = s.users[m.senderId];
          const unread = unreadOf(m);
          return (
            <div key={m.id || m.clientId}>
              {showDay && <p className="day-sep"><span>{dayText(m.createdAt)}</span></p>}
              {m.kind === 'system' ? <p className="sys-msg">{m.body}</p> : (
                <div className={`msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
                  {!mine && !grouped && <Avatar name={sender?.name} src={sender?.avatar} />}
                  <div className="msg-col">
                    {!mine && !grouped && room.kind === 'group' && <p className="msg-name">{sender?.name || '알 수 없음'} <small>{sender?.grade}</small></p>}
                    <div className="msg-row">
                      <p className={`bubble${m.failed ? ' failed' : ''}`}>{m.body}</p>
                      <span className="msg-meta">
                        {unread > 0 && <b className="msg-unread">{unread}</b>}
                        <span>{m.failed ? '전송 실패' : m.pending ? '보내는 중' : hhmm(m.createdAt)}</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {botEdit && <BotProfileDialog onClose={() => setBotEdit(false)} />}
      <footer className="composer">
        <p className="typing-line" aria-live="polite">{typer ? `${typer}님이 입력 중…` : hasBot && room.kind === 'group' ? `${s.users[BOT_ID]?.name || '봇'}이(가) 듣고 있어요 · "@봇"으로 의견을 물어보세요` : ''}</p>
        <div className="composer-row">
          <textarea ref={inputRef} rows={1} value={text} placeholder="메시지 입력 (Enter 보내기, Shift+Enter 줄바꿈)" aria-label="메시지 입력"
            onChange={(e) => { setText(e.target.value); if (e.target.value) chat.typing(room.id); }} onKeyDown={onKey} maxLength={4000} />
          <button className="btn primary" onClick={send} disabled={!text.trim() || s.status !== 'online'}>보내기</button>
        </div>
      </footer>
    </div>
  );
}

// 봇 이름·사진 바꾸기 (모두에게 같은 봇)
function BotProfileDialog({ onClose }) {
  const s = useChat();
  const bot = s.users[BOT_ID] || {};
  const ref = useRef(null);
  const [name, setName] = useState(bot.name || '');
  const [avatar, setAvatar] = useState(bot.avatar || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  async function save() {
    setBusy(true);
    try { await chat.setBotProfile(name.trim(), avatar); toast('봇 프로필을 바꿨습니다.'); ref.current.close(); }
    catch (e) { toast(e.message); setBusy(false); }
  }
  return (
    <dialog ref={ref} className="confirm picker-dialog" onClose={onClose}>
      <header className="confirm-head">
        <h3>봇 이름·사진</h3>
        <p>모든 사람에게 같은 이름과 사진으로 보입니다. "@봇" 또는 "@이름"으로 부를 수 있습니다.</p>
      </header>
      <div className="confirm-body">
        <label className="field"><span>이름</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="예: 지민" /></label>
        <p className="bot-pick-label">사진</p>
        <div className="bot-avatars" role="radiogroup" aria-label="봇 사진">
          <button type="button" role="radio" aria-checked={!avatar} className="bot-avatar none" onClick={() => setAvatar('')}>없음</button>
          {BOT_AVATARS.map((src, i) => (
            <button key={src} type="button" role="radio" aria-checked={avatar === src} aria-label={`${i < 10 ? '여성' : '남성'} ${(i % 10) + 1}`} className="bot-avatar" onClick={() => setAvatar(src)}>
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
      <footer className="confirm-foot">
        <button className="btn ghost" onClick={() => ref.current.close()} disabled={busy}>취소</button>
        <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>저장</button>
      </footer>
    </dialog>
  );
}

function PeoplePicker({ mode, room, onClose, onDone }) {
  const s = useChat();
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); chat.refreshUsers().catch((e) => toast(e.message)); }, []);

  const inRoom = new Set(room?.members.map((m) => m.id) || []);
  const people = Object.values(s.users).filter((u) => u.id !== s.me.id && !inRoom.has(u.id) && (mode !== 'friend' || (u.id !== BOT_ID && !s.friends.has(u.id))));
  const ql = q.trim().toLowerCase();
  const shown = people.filter((u) => !ql || [u.name, u.department, u.bu, u.id].some((t) => (t || '').toLowerCase().includes(ql)))
    .sort((a, b) => (s.online.has(b.id) - s.online.has(a.id)) || (a.department || '').localeCompare(b.department || '', 'ko') || a.name.localeCompare(b.name, 'ko'));
  const toggle = (id) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : mode === 'friend' ? [id] : [...p, id]);
  const group = mode === 'new' && picked.length > 1;

  return (
    <dialog ref={ref} className="confirm picker-dialog" onClose={onClose}>
      <header className="confirm-head">
        <h3>{mode === 'friend' ? '친구 등록' : mode === 'invite' ? '사람 초대' : '새 대화'}</h3>
        <p>{mode === 'friend' ? '앱에 로그인한 동료를 이름·부서·사번으로 찾아 내 친구로 등록하세요. 상대방의 친구 목록은 바뀌지 않습니다.' : mode === 'invite' ? '이 방에 넣을 사람을 고르세요.' : '한 명을 고르면 1:1, 여러 명이면 그룹 대화가 됩니다.'}</p>
      </header>
      <div className="confirm-body">
        <input className="mt-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·부서·사번 검색" aria-label="사람 검색" autoFocus />
        {group && <label className="field" style={{ marginTop: 10 }}><span>그룹 이름 (비워 두면 참여자 이름)</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>}
        <ul className="people">
          {shown.map((u) => (
            <li key={u.id}>
              <label className="person">
                <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
                <Avatar name={u.name} src={u.avatar} online={s.online.has(u.id)} />
                <span><b>{u.name}</b> {u.grade}<small>{[u.department, u.bu].filter(Boolean).join(' · ')}</small></span>
              </label>
            </li>
          ))}
          {!shown.length && <li className="view-empty small">{people.length ? '찾는 사람이 없습니다.' : '아직 앱에 로그인한 다른 동료가 없습니다. 동료가 한 번 로그인하면 여기에 나타납니다.'}</li>}
        </ul>
      </div>
      <footer className="confirm-foot">
        <button className="btn ghost" onClick={() => ref.current.close()} disabled={busy}>취소</button>
        <button className="btn primary" disabled={!picked.length || busy} onClick={async () => { setBusy(true); await onDone(picked, group ? name.trim() || '' : ''); setBusy(false); }}>
          {mode === 'friend' ? '내 친구로 등록' : mode === 'invite' ? `${picked.length}명 초대` : picked.length > 1 ? `${picked.length}명과 그룹 대화` : '대화 시작'}
        </button>
      </footer>
    </dialog>
  );
}
