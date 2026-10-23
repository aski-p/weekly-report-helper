import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, store } from '../api.js';
import { toast } from '../components/Toast.jsx';
import { blobToBase64, canRecord, fileToChunks, fmtClock, minutesText, todayISO, useMeetings, useRecorder } from '../meetings.js';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (iso) => { const d = new Date(`${iso}T00:00`); return isNaN(d) ? iso : `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`; };
const titleOf = (m) => m.summary?.title || m.title || '제목 없는 회의';

// weeks: 최신순 주차 목록 (주간보고 메모로 보내기용)
export default function Meetings({ me, weeks }) {
  const { list, create, update, remove } = useMeetings(me.employeeId);
  const [selId, setSelId] = useState(() => store.get('wr.meetings.sel') || null);
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState('all'); // all | week | month | day
  const [day, setDay] = useState(todayISO());
  useEffect(() => { store.set('wr.meetings.sel', selId); }, [selId]);
  const sel = list.find((m) => m.id === selId) || null;

  // ── 녹음 + 글자 변환 대기열 (페이지에 하나: 다른 회의를 보고 있어도 녹음은 계속된다)
  const [recId, setRecId] = useState(null);
  const [queue, setQueue] = useState({ pending: 0, failed: [] });
  const jobs = useRef([]);
  const working = useRef(false);

  const pump = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    while (jobs.current.length) {
      const job = jobs.current[0];
      let text = null, error = null;
      for (let attempt = 0; attempt < 3 && text == null; attempt++) {
        try {
          const r = await api.transcribe(await blobToBase64(job.blob), job.blob.type);
          text = r.text || '';
        } catch (e) {
          error = e;
          if (e.status && e.status < 500 && e.code !== 'STT_ERROR') break;
          await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
        }
      }
      jobs.current.shift();
      if (text != null) {
        if (text.trim()) update(job.meetingId, (m) => ({ transcript: `${m.transcript ? `${m.transcript.replace(/\s+$/, '')}\n` : ''}[${fmtClock(job.start)}] ${text.trim()}` }));
        setQueue((s) => ({ ...s, pending: jobs.current.length }));
      } else {
        setQueue((s) => ({ pending: jobs.current.length, failed: [...s.failed, job] }));
        toast(errorText(error, '일부 구간을 글자로 바꾸지 못했습니다.'));
      }
    }
    working.current = false;
  }, [update]);

  const enqueue = useCallback((meetingId, chunk) => {
    jobs.current.push({ ...chunk, meetingId });
    setQueue((s) => ({ ...s, pending: jobs.current.length }));
    pump();
  }, [pump]);

  const retryFailed = () => {
    setQueue((s) => { jobs.current.push(...s.failed); return { pending: jobs.current.length, failed: [] }; });
    pump();
  };

  // 녹음을 끝낸 뒤에 도착하는 마지막 조각도 그 회의로 가도록, 끝낼 때 비우지 않는다
  const recTarget = useRef(null);
  const rec = useRecorder({ onChunk: (c) => recTarget.current && enqueue(recTarget.current, c) });

  async function startRec(m) {
    try {
      recTarget.current = m.id;
      await rec.start(m.durationSec || 0);
      setRecId(m.id);
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? '마이크 사용을 허용해 주세요.' : '마이크를 열지 못했습니다.');
    }
  }
  function stopRec() {
    const total = rec.stop();
    if (recId) update(recId, { durationSec: Math.round(total) });
    setRecId(null);
  }

  // 녹음 중 창을 닫으려 하면 경고
  useEffect(() => {
    if (!recId && !queue.pending) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [recId, queue.pending]);

  async function importFile(m, file) {
    if (file.size > 150 * 1024 * 1024) { toast('150MB 이하 파일만 가져올 수 있습니다.'); return; }
    toast('녹음 파일을 읽는 중…');
    try {
      const { chunks, duration } = await fileToChunks(file);
      const base = m.durationSec || 0;
      chunks.forEach((c) => enqueue(m.id, { ...c, start: base + c.start }));
      update(m.id, { durationSec: Math.round(base + duration) });
      toast(`${fmtClock(duration)} 분량을 ${chunks.length}조각으로 나눠 글자로 바꾸고 있습니다.`);
    } catch {
      toast('이 파일은 읽을 수 없습니다. mp3·m4a·wav·webm 파일을 써 주세요.');
    }
  }

  // ── 목록: 기간·검색 필터 후 날짜별로 묶기
  const groups = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ql = q.trim().toLowerCase();
    const shown = list.filter((m) => {
      if (period === 'week' && m.date < iso(weekStart)) return false;
      if (period === 'month' && m.date.slice(0, 7) !== iso(now).slice(0, 7)) return false;
      if (period === 'day' && m.date !== day) return false;
      if (!ql) return true;
      return [titleOf(m), m.attendees, m.notes, m.transcript, m.summary?.summary].some((t) => (t || '').toLowerCase().includes(ql));
    }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const map = new Map();
    for (const m of shown) { if (!map.has(m.date)) map.set(m.date, []); map.get(m.date).push(m); }
    return [...map.entries()];
  }, [list, q, period, day]);

  const newMeeting = () => {
    const m = create({ date: period === 'day' ? day : todayISO() });
    setSelId(m.id);
  };

  return (
    <div className={`mt-page${sel ? ' has-sel' : ''}`}>
      <aside className="mt-list" aria-label="회의 목록">
        <div className="mt-list-head">
          <h2>회의록 {list.length ? <small>{list.length}건</small> : null}</h2>
          <button className="btn primary small" onClick={newMeeting}>새 회의</button>
        </div>
        <input className="mt-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·참석자·내용 검색" aria-label="회의록 검색" />
        <div className="mt-filter" role="group" aria-label="기간">
          {[['all', '전체'], ['week', '이번 주'], ['month', '이번 달'], ['day', '날짜']].map(([k, l]) => (
            <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>
          ))}
          {period === 'day' && <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="날짜 고르기" />}
        </div>
        {!groups.length && <p className="view-empty small">{list.length ? '조건에 맞는 회의가 없습니다.' : '아직 회의록이 없습니다. 새 회의를 만들고 녹음을 시작하세요.'}</p>}
        {groups.map(([date, ms]) => (
          <section key={date} className="mt-day">
            <h3>{dayLabel(date)}</h3>
            <ul>
              {ms.map((m) => (
                <li key={m.id}>
                  <button className="mt-card" aria-current={m.id === selId || undefined} onClick={() => setSelId(m.id)}>
                    <span className="mt-card-title">{recId === m.id && <i className="rec-dot" aria-label="녹음 중" />}{titleOf(m)}</span>
                    <span className="mt-card-meta">
                      {[m.durationSec ? fmtClock(m.durationSec) : null, m.attendees, m.summary ? '요약됨' : m.transcript ? '녹취만' : null, m.summary?.actionItems?.length ? `할 일 ${m.summary.actionItems.length}` : null].filter(Boolean).join(' · ') || '비어 있음'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </aside>

      <section className="mt-detail" aria-label="회의 내용">
        {!sel ? (
          <div className="mt-empty">
            <p>왼쪽에서 회의를 고르거나 <b>새 회의</b>를 만드세요.</p>
            <p className="view-sub">녹음은 PGX 서버에서 글자로 바뀌고, 오디오는 저장하지 않습니다. 회의록은 이 기기에 저장됩니다.</p>
          </div>
        ) : (
          <MeetingDetail key={sel.id} m={sel} me={me} weeks={weeks} update={update}
            onBack={() => setSelId(null)}
            onDelete={() => { if (recId === sel.id) { toast('녹음을 먼저 끝내세요.'); return; } if (confirm(`"${titleOf(sel)}" 회의록을 지울까요?`)) { remove(sel.id); setSelId(null); } }}
            rec={rec} recId={recId} onStart={() => startRec(sel)} onStop={stopRec}
            queue={queue} onRetry={retryFailed} onImport={(f) => importFile(sel, f)} />
        )}
      </section>
    </div>
  );
}

function MeetingDetail({ m, me, weeks, update, onBack, onDelete, rec, recId, onStart, onStop, queue, onRetry, onImport }) {
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const tRef = useRef(null);
  const mine = recId === m.id;
  const busyElsewhere = recId && !mine;

  // 새 글이 붙으면 녹취 칸 맨 아래로
  useEffect(() => { if (mine && tRef.current) tRef.current.scrollTop = tRef.current.scrollHeight; }, [m.transcript, mine]);

  async function summarize() {
    if (!m.transcript.trim() && !m.notes.trim()) { setError('녹음하거나 메모를 적은 뒤 요약하세요.'); return; }
    setSummarizing(true); setError('');
    try {
      const s = await api.summarizeMeeting(m);
      update(m.id, { summary: { ...s, at: Date.now() }, title: m.title || s.title });
    } catch (e) {
      setError(errorText(e, '요약하지 못했습니다.'));
    } finally {
      setSummarizing(false);
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(minutesText(m)); toast('회의록을 복사했습니다.'); } catch { toast('복사하지 못했습니다.'); }
  }

  // 회의 날짜가 속한 주의 주간보고 메모 끝에 한 줄 추가
  function sendToReport() {
    const w = weeks.find((x) => x.from <= m.date && m.date <= x.to);
    if (!w) { toast('이 날짜의 보고 주차를 찾지 못했습니다.'); return; }
    const k = `wr.memo.${me.employeeId}.${w.year}-${w.week}`;
    const line = m.summary?.reportMemo || titleOf(m);
    const cur = store.get(k) || '';
    if (cur.includes(line)) { toast('이미 넣은 내용입니다.'); return; }
    store.set(k, `${cur.replace(/\s+$/, '')}${cur.trim() ? '\n' : ''}${line}`);
    dispatchEvent(new CustomEvent('wr:memo', { detail: k }));
    toast(`${w.week}주차 주간보고 메모에 넣었습니다.`);
  }

  const set = (k) => (e) => update(m.id, { [k]: e.target.value });
  const s = m.summary;

  return (
    <article className="mt-sheet">
      <div className="mt-sheet-top">
        <button className="text-link mt-back" onClick={onBack}>‹ 목록</button>
        <button className="text-link" onClick={onDelete}>삭제</button>
      </div>
      <input className="mt-title" value={m.title} onChange={set('title')} placeholder={s?.title || '회의 제목'} aria-label="회의 제목" />
      <div className="mt-meta">
        <label className="mini-select"><span>날짜</span><input type="date" value={m.date} onChange={(e) => e.target.value && update(m.id, { date: e.target.value })} /></label>
        <label className="mini-select grow"><span>참석</span><input value={m.attendees} onChange={set('attendees')} placeholder="예: 기업은행 김과장, 박준호, 김민지" /></label>
      </div>

      {/* 녹음 */}
      <div className={`recorder${mine && rec.state === 'recording' ? ' on' : ''}`}>
        {!canRecord() ? <p className="view-sub">이 브라우저는 녹음을 지원하지 않습니다. 녹음 파일 가져오기를 쓰세요.</p>
          : busyElsewhere ? <p className="view-sub">다른 회의를 녹음하는 중입니다.</p>
          : !mine ? (
            <button className="btn rec-btn" onClick={onStart}><i className="rec-dot" aria-hidden="true" />{m.durationSec ? '이어서 녹음' : '녹음 시작'}</button>
          ) : (
            <>
              <span className="rec-time" aria-live="off">{fmtClock(rec.elapsed)}</span>
              <span className="rec-level" aria-hidden="true"><i style={{ transform: `scaleX(${rec.state === 'recording' ? Math.max(0.03, rec.level) : 0.03})` }} /></span>
              {rec.state === 'recording'
                ? <button className="btn ghost small" onClick={rec.pause}>일시정지</button>
                : <button className="btn ghost small" onClick={rec.resume}>계속</button>}
              <button className="btn seal small" onClick={onStop}>녹음 끝내기</button>
            </>
          )}
        <span className="rec-status">
          {queue.pending ? `글자로 바꾸는 중 · ${queue.pending}조각 남음` : mine ? '30초마다 글자로 바뀝니다' : ''}
          {queue.failed.length > 0 && <> · <button className="text-link" onClick={onRetry}>실패 {queue.failed.length}조각 다시 시도</button></>}
        </span>
        <button className="text-link rec-file" onClick={() => fileRef.current?.click()} disabled={!!recId}>녹음 파일 가져오기</button>
        <input ref={fileRef} type="file" accept="audio/*,video/mp4,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f); }} />
      </div>

      <div className="item-fields mt-fields">
        <label className="rfield">
          <span className="rfield-label">녹취 <span className="count">{m.transcript.length.toLocaleString()}자</span></span>
          <textarea ref={tRef} className="mt-transcript" value={m.transcript} onChange={set('transcript')} spellCheck={false}
            placeholder="녹음을 시작하면 이 자리에 말한 내용이 쌓입니다. 잘못 알아들은 부분은 직접 고칠 수 있습니다." />
        </label>
        <label className="rfield">
          <span className="rfield-label">메모</span>
          <textarea className="mt-notes" value={m.notes} onChange={set('notes')} spellCheck={false} placeholder="회의 중 직접 적어 둘 것 (요약할 때 같이 참고합니다)" />
        </label>
      </div>

      <div className="mt-actions">
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary" onClick={summarize} disabled={summarizing || mine || queue.pending > 0}>
          {summarizing ? 'AI가 요약하는 중…' : s ? 'AI로 다시 요약' : 'AI로 요약하기'}
        </button>
        {(mine || queue.pending > 0) && <span className="view-sub">녹음과 글자 변환이 끝나면 요약할 수 있습니다.</span>}
      </div>

      {summarizing && <div className="drafting" role="status"><div className="drafting-lines" aria-hidden="true"><i /><i /><i /><i /></div><p>녹취를 읽고 안건·결정 사항·할 일을 정리하고 있습니다. 보통 15–30초 걸립니다.</p></div>}

      {s && !summarizing && (
        <section className="mt-summary" aria-label="AI 요약">
          <header className="mt-summary-head">
            <h3>{s.title}</h3>
            <div className="mt-summary-tools">
              <button className="btn ghost small" onClick={copy}>회의록 복사</button>
              <button className="btn ghost small" onClick={sendToReport} title={s.reportMemo}>주간보고 메모에 넣기</button>
            </div>
          </header>
          <div className="mt-block"><h4>요약</h4><pre>{s.summary}</pre></div>
          {s.topics?.length > 0 && (
            <div className="mt-block"><h4>안건별 논의</h4>
              {s.topics.map((t, i) => (<div key={i} className="mt-topic"><p><b>{t.topic}</b></p><ul>{t.points.map((p, j) => <li key={j}>{p}</li>)}</ul></div>))}
            </div>
          )}
          <div className="mt-two">
            <div className="mt-block"><h4>결정 사항</h4>{s.decisions?.length ? <ul>{s.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p className="view-sub">없음</p>}</div>
            <div className="mt-block"><h4>할 일</h4>
              {s.actionItems?.length ? (
                <table className="mt-todo"><thead><tr><th>할 일</th><th>담당</th><th>기한</th></tr></thead>
                  <tbody>{s.actionItems.map((a, i) => <tr key={i}><td>{a.task}</td><td>{a.owner || '—'}</td><td>{a.due || '—'}</td></tr>)}</tbody></table>
              ) : <p className="view-sub">없음</p>}
            </div>
          </div>
          {s.reportMemo && <p className="mt-memo-line">주간보고용 한 줄: {s.reportMemo}</p>}
        </section>
      )}
    </article>
  );
}
