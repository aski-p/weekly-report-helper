import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, store } from '../api.js';
import { toast } from '../components/Toast.jsx';
import WorkPicker from '../components/WorkPicker.jsx';
import ApprovalBox from '../components/ApprovalBox.jsx';
import ReportView from './ReportView.jsx';
import SkinPicker from '../components/SkinPicker.jsx';
import Templates from './Templates.jsx';
import Meetings from './Meetings.jsx';
import ChatWidget from './Chat.jsx';
import { chat, roomTitle, useTotalUnread } from '../chat.js';
import { notify } from '../useAutomation.js';
import { useMeetings } from '../meetings.js';
import { useTemplates } from '../templates.js';
import { useAutomation } from '../useAutomation.js';

const FIELD_MAX = 4000;
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtRange = (w) => `${w.from.slice(5).replace('-', '.')} – ${w.to.slice(5).replace('-', '.')}`;
const readJSON = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } };

export default function Workspace({ me, onLogout, onInstall }) {
  const [weeks, setWeeks] = useState([]);
  const [sel, setSel] = useState(null); // { year, week }
  const [ctx, setCtx] = useState(null);
  const [tab, setTab] = useState('memo'); // 모바일 전용
  const [view, setViewRaw] = useState(() => { const v = store.get('wr.view'); return ['write', 'view', 'meetings', 'templates'].includes(v) ? v : 'write'; }); // write | view | templates
  const setView = (v) => { setViewRaw(v); store.set('wr.view', v); scrollTo(0, 0); };

  // 채팅: 로그인해 있는 동안 늘 연결 (다른 화면에서도 새 메시지를 알 수 있게)
  useEffect(() => { chat.start(me.employeeId); return () => chat.stop(); }, [me.employeeId]);
  const chatUnread = useTotalUnread();
  useEffect(() => chat.onMessage((m) => {
    const s = chat.get();
    if (!s.me || m.senderId === s.me.id || m.kind !== 'text') return;
    if (!document.hidden && chat.viewing === m.roomId) return; // 지금 보고 있는 방
    const room = s.rooms.find((r) => r.id === m.roomId);
    const who = s.users[m.senderId]?.name || '새 메시지';
    const where = room?.kind === 'group' ? ` · ${roomTitle(room, s)}` : '';
    if (document.hidden) notify(`${who}${where}`, m.body.slice(0, 120), `wr-chat-${m.roomId}`);
    else if (store.get('wr.chat.open') !== '1') toast(`${who}: ${m.body.slice(0, 40)}`);
  }), []);
  useEffect(() => { document.title = chatUnread ? `(${chatUnread}) 주간보고 도우미` : '주간보고 도우미'; }, [chatUnread]);

  // 주차 목록 (조회 화면 날짜 선택용으로 1년치)
  useEffect(() => {
    api.weeks(52).then((ws) => {
      const sorted = [...ws].sort((a, b) => (b.year - a.year) || (b.week - a.week));
      setWeeks(sorted);
      const cur = sorted.find((w) => w.isCurrent) || sorted[0];
      if (cur) setSel({ year: cur.year, week: cur.week });
    }).catch((e) => toast(errorText(e)));
  }, []);

  const key = sel ? `${me.employeeId}.${sel.year}-${sel.week}` : null;
  const selWeek = weeks.find((w) => sel && w.year === sel.year && w.week === sel.week);

  // 주차별 메모/초안/승인 상태 (기기에 저장)
  const [memo, setMemo] = useState('');
  const [draft, setDraft] = useState(null);
  const [approval, setApproval] = useState(null);
  useEffect(() => {
    if (!key) return;
    setMemo(store.get(`wr.memo.${key}`) || '');
    setDraft(readJSON(`wr.draft.${key}`, null));
    setApproval(readJSON(`wr.approval.${key}`, null));
    setCtx(null);
    api.context(sel.year, sel.week).then(setCtx).catch((e) => toast(errorText(e)));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 회의록에서 메모에 한 줄을 넣으면 다시 읽는다
  useEffect(() => {
    const on = (e) => { if (key && e.detail === `wr.memo.${key}`) setMemo(store.get(`wr.memo.${key}`) || ''); };
    addEventListener('wr:memo', on);
    return () => removeEventListener('wr:memo', on);
  }, [key]);

  const [savedAt, setSavedAt] = useState(null);
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => { store.set(`wr.memo.${key}`, memo); setSavedAt(new Date()); }, 400);
    return () => clearTimeout(t);
  }, [memo, key]);
  useEffect(() => { if (key) store.set(`wr.draft.${key}`, draft ? JSON.stringify(draft) : null); }, [draft, key]);
  useEffect(() => { if (key) store.set(`wr.approval.${key}`, approval ? JSON.stringify(approval) : null); }, [approval, key]);

  const { list: meetings, flush: flushMeetings } = useMeetings(me.employeeId);
  const meetingCount = selWeek ? meetings.filter((m) => m.date >= selWeek.from && m.date <= selWeek.to && (m.notes.trim() || m.transcript.trim() || m.summary)).length : 0;

  // 양식
  const { templates } = useTemplates(me.employeeId);
  const [tplId, setTplIdRaw] = useState(() => store.get(`wr.writeTpl.${me.employeeId}`) || '');
  const setTplId = (v) => { setTplIdRaw(v); store.set(`wr.writeTpl.${me.employeeId}`, v || null); };
  const template = templates.find((t) => t.id === tplId) || null;

  // AI 정리
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const runDraft = useCallback(async () => {
    setDrafting(true); setDraftError(''); setTab('report');
    try {
      await flushMeetings();
      const r = await api.draft(sel.year, sel.week, memo, { template });
      const questions = r.questions || [];
      if (!r.items.length) {
        // 정리할 업무를 못 찾았으면 쓰던 초안은 그대로 두고 AI 가 물어본 것만 보여 준다
        setDraft((d) => ({ items: [], ...(d || {}), questions, at: Date.now() }));
        if (questions.length) toast('메모만으로는 정리하기 어렵습니다. "확인해 주세요"를 보고 메모를 보충해 주세요.');
        else setDraftError('메모에서 보고할 업무를 찾지 못했습니다. 한 일을 조금 더 구체적으로 적어 보세요.');
        return;
      }
      setDraft({ items: r.items.map((i) => ({ ...i, id: uid() })), questions, at: Date.now() });
      setApproval(null);
      if (r.meetingCount) toast(`회의 ${r.meetingCount}건을 회의별 한 항목으로 정리했습니다.`);
    } catch (e) {
      setDraftError(errorText(e, '정리하지 못했습니다.'));
      setTab('memo');
    } finally {
      setDrafting(false);
    }
  }, [memo, sel, template, flushMeetings]);

  // 지난주 끌어오기: 지난주 내 항목의 차주 계획을 이번 주 실적 자리에 (이미 있는 업무는 건너뜀)
  const [pulling, setPulling] = useState(false);
  async function pullLastWeek() {
    setPulling(true);
    try {
      const { items: last } = await api.lastWeek(sel.year, sel.week);
      if (!last.length) { toast('지난주에 내가 쓴 항목이 없습니다.'); return; }
      const keyOf = (i) => (i.workKindCode === 'G' ? `G:${i.workName}` : i.workId);
      const have = new Set((draft?.items || []).map(keyOf));
      const add = last.filter((i) => !have.has(keyOf(i))).map(({ lastWeek, ...i }) => ({ ...i, id: uid() }));
      if (!add.length) { toast('지난주 항목이 이미 모두 들어 있습니다.'); return; }
      setDraft((d) => ({ questions: [], ...(d || {}), items: [...(d?.items || []), ...add], at: Date.now() }));
      setApproval(null);
      setTab('report');
      toast(`지난주 항목 ${add.length}건을 가져왔습니다. 차주 계획을 금주 실적 자리에 옮겨 두었으니 다듬어 주세요.`);
    } catch (e) {
      toast(errorText(e, '지난주 기록을 가져오지 못했습니다.'));
    } finally {
      setPulling(false);
    }
  }

  // 자동화: 초안이 준비되면 작성 화면에 띄운다
  const [autoNotice, setAutoNotice] = useState(null); // { year, week, count, error }
  const { running: autoRunning, runNow } = useAutomation(me, weeks, (wk, d, error, message) => {
    setAutoNotice({ ...wk, count: d?.items.length || 0, error, message, open: !!d });
    if (d && !message && sel && wk.year === sel.year && wk.week === sel.week) { setDraft(d); setApproval(null); }
  });
  const openAutoDraft = () => {
    const wk = autoNotice;
    setAutoNotice(null);
    if (!sel || wk.year !== sel.year || wk.week !== sel.week) setSel({ year: wk.year, week: wk.week });
    setView('write'); setTab('report');
  };

  const items = draft?.items || [];
  const edit = (id, patch) => {
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    if (approval?.ok) setApproval(null);
  };
  const remove = (id) => setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
  const addBlank = () => setDraft((d) => ({
    ...(d || { questions: [] }),
    items: [...(d?.items || []), { id: uid(), workKindCode: null, workId: null, workName: '', existing: false, thisWeek: '', nextWeek: '', issue: '' }],
  }));

  const problems = useMemo(() => items.flatMap((i) => {
    const p = [];
    if (!i.workKindCode) p.push(`${i.workName || '새 항목'}: 업무를 고르세요`);
    for (const [k, label] of [['thisWeek', '금주 실적'], ['nextWeek', '차주 계획'], ['issue', '이슈']]) {
      if ((i[k] || '').length > FIELD_MAX) p.push(`${i.workName}: ${label}이 ${FIELD_MAX}자를 넘습니다`);
    }
    return p;
  }), [items]);

  // 승인 흐름: ① 최종 반영본을 보여주며 한 번 묻고 ② 승인하면 OneFinger 에 게시
  const payload = () => items.map(({ workKindCode, workId, workName, thisWeek, nextWeek, issue }) => ({ workKindCode, workId, workName, thisWeek, nextWeek, issue }));
  const [confirm, setConfirm] = useState(null); // dryRun 결과
  const [preparing, setPreparing] = useState(false);
  const [committing, setCommitting] = useState(false);

  async function askApproval() {
    if (problems.length) { toast(problems[0]); return; }
    setPreparing(true);
    try {
      setConfirm((await api.commit(sel.year, sel.week, payload(), true)).results);
    } catch (e) {
      toast(errorText(e, '최종 내용을 만들지 못했습니다.'));
    } finally {
      setPreparing(false);
    }
  }

  async function approve() {
    setCommitting(true);
    try {
      const { results } = await api.commit(sel.year, sel.week, payload());
      const ok = results.every((r) => r.ok);
      setApproval({ ok, at: Date.now(), results });
      setConfirm(null);
      toast(ok ? `${results.length}건을 OneFinger에 게시했습니다.` : '일부 항목을 게시하지 못했습니다. 아래 내용을 확인하세요.');
    } catch (e) {
      toast(errorText(e, '게시하지 못했습니다.'));
    } finally {
      setCommitting(false);
    }
  }

  const memoRef = useRef(null);
  const onMemoKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runDraft(); } };

  return (
    <div className="ws" data-tab={tab}>
      <header className="ws-top">
        <div className="ws-brand">
          <img src="/icons/icon-192.png" alt="" width="28" height="28" />
          <span>주간보고 도우미</span>
        </div>
        <nav className="ws-views" aria-label="화면">
          {[['write', '작성'], ['view', '조회'], ['meetings', '회의록'], ['templates', '양식·자동화']].map(([k, l]) => (
            <button key={k} aria-current={view === k ? 'page' : undefined} onClick={() => setView(k)}>{l}</button>
          ))}
        </nav>
        <label className="week-select" hidden={view !== 'write'}>
          <span className="sr-only">보고 주차</span>
          <select value={sel ? `${sel.year}-${sel.week}` : ''} onChange={(e) => { const [y, w] = e.target.value.split('-').map(Number); setSel({ year: y, week: w }); }}>
            {weeks.filter((w, i) => i < 9 || (sel && w.year === sel.year && w.week === sel.week)).map((w) => (
              <option key={`${w.year}-${w.week}`} value={`${w.year}-${w.week}`}>
                {w.year}년 {w.week}주차 ({fmtRange(w)}){w.isCurrent ? ' 이번 주' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="ws-user">
          <SkinPicker />
          <span>{me.employeeName} {me.gradeName}</span>
          <button className="text-link" onClick={onInstall}>앱 설치</button>
          <button className="text-link" onClick={onLogout}>로그아웃</button>
        </div>
      </header>

      {autoNotice && (
        <div className={`auto-banner${autoNotice.error ? ' fail' : ''}`} role="status">
          <span>{autoNotice.error ? `자동 작성 실패: ${autoNotice.error}` : autoNotice.message || `자동화가 ${autoNotice.week}주차 초안 ${autoNotice.count}건을 만들었습니다. 확인하고 승인하면 게시됩니다.`}</span>
          {autoNotice.open && <button className="btn small" onClick={openAutoDraft}>확인하기</button>}
          <button className="icon-btn" onClick={() => setAutoNotice(null)} aria-label="닫기">×</button>
        </div>
      )}

      {view === 'view' && <ReportView me={me} weeks={weeks} sel={sel} setSel={setSel} />}
      {view === 'templates' && <Templates me={me} running={autoRunning} onRunNow={runNow} />}
      {/* 녹음이 탭을 옮겨도 이어지도록 회의록 화면은 늘 붙여 둔다 */}
      <div className="mt-wrap" hidden={view !== 'meetings'}><Meetings me={me} onReport={(date) => {
        const week = weeks.find((w) => w.from <= date && date <= w.to);
        if (!week) { toast('이 회의 날짜의 보고 주차를 찾지 못했습니다.'); return; }
        setSel({ year: week.year, week: week.week }); setView('write'); setTab('memo');
        toast('보고서로 정리하기를 누르면 해당 주의 회의가 한 건씩 짧게 반영됩니다.');
      }} /></div>
      <ChatWidget />

      <div className="write-view" hidden={view !== 'write'}>
      <nav className="ws-tabs" aria-label="화면 전환">
        <button aria-pressed={tab === 'memo'} onClick={() => setTab('memo')}>메모</button>
        <button aria-pressed={tab === 'report'} onClick={() => setTab('report')}>
          보고서{items.length ? ` ${items.length}건` : ''}
        </button>
      </nav>

      <div className="ws-body">
        {/* 메모 */}
        <section className="pane memo-pane" aria-labelledby="memo-h">
          <div className="pane-head">
            <h2 id="memo-h">이번 주 메모</h2>
            <span className="saved">{savedAt && memo ? '기기에 저장됨' : ''}</span>
          </div>
          <div className="notepad">
            <textarea
              ref={memoRef}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onKeyDown={onMemoKey}
              spellCheck={false}
              placeholder={'한 일을 생각나는 대로 적으세요. 형식은 정리해 드립니다.\n\n기업은행 퇴직연금 화면 수정 3건 배포\n금요일 통합테스트 결함 2건 대응\n군인라운지 파일 업로드 안 되는 원인 찾음, 다음 주 수정\n화요일 고객사 회의 있음'}
            />
          </div>
          <div className="memo-foot">
            <p className="ctx-line">
              {!ctx ? '본부 보고서를 불러오는 중…'
                : `${me.buName} 보고 ${ctx.candidates.filter((c) => c.existing).length}건의 양식을 참고합니다`
                  + (ctx.lastWeekCount ? `, 지난주 내 기록 ${ctx.lastWeekCount}건도 이어서 씁니다.` : '.')}
            </p>
            {ctx && !ctx.aiReady && <p className="warn-line">AI가 설정되지 않아 새 글의 AI 정리는 사용할 수 없습니다. 요약이 저장된 회의는 보고서로 가져올 수 있습니다.</p>}
            <div className="write-tools">
              <label className="mini-select">
                <span>양식</span>
                <select value={template ? tplId : ''} onChange={(e) => setTplId(e.target.value)}>
                  <option value="">본부 보고 형식 따라가기</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <button className="btn ghost small" onClick={pullLastWeek} disabled={pulling || !sel}>{pulling ? '가져오는 중…' : '지난주 끌어오기'}</button>
            </div>
            {!templates.length && <p className="kbd-hint left">조회 화면에서 마음에 드는 글을 <b>양식으로 저장</b>하면 여기서 고를 수 있습니다.</p>}
            {draftError && <p className="form-error" role="alert">{draftError}</p>}
            <p className="view-sub">선택한 주의 회의 {meetingCount}건을 자동으로 가져옵니다. 회의 3건이면 핵심 3개 항목으로 정리합니다.</p>
            <button className="btn primary block" onClick={runDraft} disabled={drafting || !sel}>
              {drafting ? '정리하는 중…' : items.length ? '메모로 다시 정리하기' : '보고서로 정리하기'}
            </button>
            <p className="kbd-hint">Ctrl + Enter</p>
          </div>
        </section>

        {/* 보고서 */}
        <section className="pane report-pane" aria-labelledby="report-h">
          <article className="sheet" aria-busy={drafting}>
            <header className="sheet-head">
              <div>
                <h2 id="report-h">주간업무보고</h2>
                <dl className="sheet-meta">
                  <div><dt>소속</dt><dd>{me.buName} · {me.departmentName}</dd></div>
                  <div><dt>기간</dt><dd>{selWeek ? `${selWeek.year}년 ${selWeek.week}주차, ${fmtRange(selWeek)}` : '—'}</dd></div>
                </dl>
              </div>
              <ApprovalBox writer={me.employeeName} approval={approval} />
            </header>

            {draft?.auto && <p className="item-note">자동화가 "{draft.auto.template}" 양식으로 만든 초안입니다. 고칠 곳을 고친 뒤 승인하세요.</p>}

            {draft?.questions?.length > 0 && (
              <aside className="questions">
                <h3>확인해 주세요</h3>
                <ul>{draft.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </aside>
            )}

            {drafting && <DraftingState count={ctx?.candidates.filter((c) => c.existing).length} />}

            {!drafting && !items.length && (
              <div className="sheet-empty">
                <p>왼쪽에 메모를 적고 <b>보고서로 정리하기</b>를 누르면 이 자리에 보고 초안이 채워집니다.</p>
                <button className="text-link" onClick={addBlank}>직접 항목 추가</button>
              </div>
            )}

            {!drafting && items.map((item) => (
              <ReportItem key={item.id} item={item} candidates={ctx?.candidates || []}
                onChange={(p) => edit(item.id, p)} onRemove={() => remove(item.id)} />
            ))}

            {!drafting && items.length > 0 && (
              <button className="add-row" onClick={addBlank}>항목 추가</button>
            )}
          </article>

          {approval?.results && !approval.ok && (
            <ul className="results">
              {approval.results.map((r, i) => (
                <li key={i} className={r.ok ? 'ok' : 'fail'}>
                  <b>{r.ok ? '기록됨' : '실패'}</b> {r.workName}{r.error ? ` — ${r.error}` : ''}
                </li>
              ))}
            </ul>
          )}

          {items.length > 0 && !drafting && (
            <div className="approve-bar">
              {approval?.ok ? (
                <>
                  <span className="posted">게시 완료. 내용을 고치면 다시 승인할 수 있습니다.</span>
                  <a className="btn ghost" href="https://one.fingerservice.co.kr/reports/new" target="_blank" rel="noreferrer">OneFinger에서 보기</a>
                </>
              ) : (
                <button className="btn primary" onClick={askApproval} disabled={preparing}>
                  {preparing ? '최종 내용을 만드는 중…' : '검토하고 승인하기'}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      </div>

      {confirm && <ConfirmDialog results={confirm} busy={committing} onApprove={approve} onClose={() => !committing && setConfirm(null)} />}
    </div>
  );
}

function DraftingState({ count }) {
  return (
    <div className="drafting" role="status">
      <div className="drafting-lines" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <p>본부 보고 {count ?? ''}건의 형식에 맞춰 메모를 정리하고 있습니다. 보통 10–20초 걸립니다.</p>
    </div>
  );
}

const MODE_TEXT = {
  existing: '이번 주 보고서에 있는 항목입니다. 다른 작성자가 쓴 내용은 그대로 두고 내 구역만 채웁니다.',
  fresh: '이번 주 보고서에 새 항목으로 추가됩니다.',
};

function ReportItem({ item, candidates, onChange, onRemove }) {
  return (
    <section className="item">
      <div className="item-head">
        <WorkPicker value={item} candidates={candidates} onChange={onChange} />
        <button className="icon-btn" onClick={onRemove} aria-label={`${item.workName || '항목'} 삭제`} title="항목 삭제">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      {item.workKindCode && <p className="item-note">{item.existing ? MODE_TEXT.existing : MODE_TEXT.fresh}</p>}
      <div className="item-fields">
        <Field label="금주 실적" value={item.thisWeek} onChange={(v) => onChange({ thisWeek: v })} rows={8} />
        <Field label="차주 계획" value={item.nextWeek} onChange={(v) => onChange({ nextWeek: v })} rows={8} />
        <Field label="이슈 · 협조 요청" value={item.issue} onChange={(v) => onChange({ issue: v })} rows={2} wide placeholder="없으면 비워 두세요" />
      </div>
    </section>
  );
}

function Field({ label, value, onChange, rows, wide, placeholder }) {
  const over = (value || '').length > FIELD_MAX;
  const ref = useRef(null);
  // 내용에 맞춰 높이 자동 조절
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, rows * 21 + 20)}px`;
  }, [value, rows]);
  return (
    <label className={`rfield${wide ? ' wide' : ''}`}>
      <span className="rfield-label">
        {label}
        <span className={`count${over ? ' over' : ''}`}>{(value || '').length.toLocaleString()} / {FIELD_MAX.toLocaleString()}</span>
      </span>
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} spellCheck={false} placeholder={placeholder} />
    </label>
  );
}

function ConfirmDialog({ results, busy, onApprove, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const label = { new: '새 항목으로 추가', section: '내 구역만 추가·교체', replace: '항목 내용 교체' };
  const blocked = results.some((r) => r.error);
  return (
    <dialog ref={ref} className="confirm" onClose={onClose} onCancel={(e) => busy && e.preventDefault()}>
      <header className="confirm-head">
        <h3>이대로 게시할까요?</h3>
        <p>{results.length}개 업무가 선택한 주차의 본부 보고서에 아래 내용으로 들어갑니다. 다른 작성자가 쓴 부분은 바뀌지 않습니다.</p>
      </header>
      <div className="confirm-body">
        {results.map((r, i) => (
          <section key={i} className="preview-item">
            <h4>{r.workName} <span className="mode">{label[r.mode] || ''}</span></h4>
            {r.error && <p className="form-error">{r.error}</p>}
            {r.fields && [['thisWeek', '금주 실적'], ['nextWeek', '차주 계획'], ['issue', '이슈']].map(([k, l]) => (
              r.fields[k] ? <div key={k}><p className="preview-label">{l}</p><pre>{r.fields[k]}</pre></div> : null
            ))}
          </section>
        ))}
      </div>
      <footer className="confirm-foot">
        <button className="btn ghost" onClick={() => ref.current.close()} disabled={busy}>더 고치기</button>
        <button className="btn seal" onClick={onApprove} disabled={busy || blocked}>{busy ? '게시하는 중…' : '승인하고 게시'}</button>
      </footer>
    </dialog>
  );
}
