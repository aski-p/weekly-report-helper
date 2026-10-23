import { useEffect, useMemo, useState } from 'react';
import { api, errorText, store } from '../api.js';
import { toast } from '../components/Toast.jsx';
import SaveTemplateDialog from '../components/SaveTemplateDialog.jsx';
import { itemByWriter, asTemplateSource } from '../sections.js';
import { parseWriterHeader } from '../../lib/writer-header.js';
import { useTemplates } from '../templates.js';

const fmtRange = (w) => `${w.from.slice(5).replace('-', '.')} – ${w.to.slice(5).replace('-', '.')}`;
const FIELDS = [['thisWeek', '금주 실적'], ['nextWeek', '차주 계획'], ['issue', '이슈 · 협조 요청']];
const filled = (i) => FIELDS.some(([k]) => (i[k] || '').replace(/﻿/g, '').trim());

// OneFinger 응답 필드 이름이 확실하지 않은 값은 후보 이름 중 있는 것을 쓴다
const pick = (o, keys) => keys.map((k) => o?.[k]).find((v) => v != null && v !== '');
const updatedOf = (o) => pick(o, ['updatedAt', 'modifiedAt', 'lastModifiedAt', 'updDt', 'updatedDate']);
function confirmState(r) {
  if (!r) return null;
  const flag = pick(r, ['confirmed', 'isConfirmed', 'closed', 'isClosed']);
  if (typeof flag === 'boolean') return flag;
  const s = String(pick(r, ['statusCode', 'status', 'statusName', 'reportStatus']) || '');
  if (!s) return null;
  return /CONFIRM|CLOSE|DONE|FINAL|확정|마감/i.test(s);
}
const fmtTime = (v) => {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d)) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const SORTS = {
  report: { label: '보고서 순서', fn: (a, b) => (a.sortOrder ?? a._i) - (b.sortOrder ?? b._i) },
  name: { label: '업무명', fn: (a, b) => a.workName.localeCompare(b.workName, 'ko') },
  team: { label: '팀', fn: (a, b) => (a.ownerTeamName || '').localeCompare(b.ownerTeamName || '', 'ko') || a.workName.localeCompare(b.workName, 'ko') },
  recent: { label: '최근 수정', fn: (a, b) => new Date(updatedOf(b) || 0) - new Date(updatedOf(a) || 0) },
};

export default function ReportView({ me, weeks, sel, setSel }) {
  const [report, setReport] = useState(undefined); // undefined=불러오는 중, null=없음
  const [team, setTeam] = useState(() => store.get('wr.view.team') || '');
  const [sort, setSort] = useState(() => store.get('wr.view.sort') || 'report');
  const [byWriter, setByWriter] = useState(() => store.get('wr.view.byWriter') === '1');
  const [saving, setSaving] = useState(null); // SaveTemplateDialog source
  const { addTemplate } = useTemplates(me.employeeId);

  useEffect(() => {
    const sync=()=>{setTeam(store.get('wr.view.team')||'');setSort(store.get('wr.view.sort')||'report');setByWriter(store.get('wr.view.byWriter')==='1');};
    addEventListener('wr:account-sync',sync);return()=>removeEventListener('wr:account-sync',sync);
  },[]);

  useEffect(() => { store.set('wr.view.team', team || null); }, [team]);
  useEffect(() => { store.set('wr.view.sort', sort); }, [sort]);
  useEffect(() => { store.set('wr.view.byWriter', byWriter ? '1' : null); }, [byWriter]);

  useEffect(() => {
    if (!sel) return;
    let live = true;
    setReport(undefined);
    api.report(sel.year, sel.week).then((r) => live && setReport(r.report)).catch((e) => { if (live) { setReport(null); toast(errorText(e)); } });
    return () => { live = false; };
  }, [sel?.year, sel?.week]); // eslint-disable-line react-hooks/exhaustive-deps

  // 주차 이동 (weeks 는 최신순)
  const idx = weeks.findIndex((w) => sel && w.year === sel.year && w.week === sel.week);
  const cur = weeks[idx];
  const go = (d) => { const w = weeks[idx + d]; if (w) setSel({ year: w.year, week: w.week }); };
  const onDate = (e) => {
    const v = e.target.value;
    if (!v) return;
    const w = weeks.find((x) => x.from <= v && v <= x.to);
    if (w) setSel({ year: w.year, week: w.week });
    else toast('불러온 범위(최근 1년) 밖의 날짜입니다.');
  };

  const items = useMemo(() => (report?.items || []).map((i, n) => ({ ...i, _i: n })), [report]);
  const teams = useMemo(() => [...new Set(items.map((i) => i.ownerTeamName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [items]);
  const shown = useMemo(() => items.filter((i) => !team || i.ownerTeamName === team).sort(SORTS[sort].fn), [items, team, sort]);

  // 상태 줄
  const stats = useMemo(() => {
    const writers = new Set();
    for (const i of items) for (const w of i.writers || []) writers.add(w.employeeId ?? w.employeeName);
    const lastUpdated = [updatedOf(report), ...items.map(updatedOf)].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
    return {
      total: items.length,
      done: items.filter(filled).length,
      writers: writers.size,
      mine: items.filter((i) => (i.writers || []).some((w) => w.employeeId === me.employeeId)).length,
      lastUpdated,
      confirmed: confirmState(report),
    };
  }, [items, report, me.employeeId]);

  // 작성자별로 나눠 보기
  const writerGroups = useMemo(() => {
    if (!byWriter) return [];
    const map = new Map();
    for (const i of shown) {
      for (const s of itemByWriter(i)) {
        if (!map.has(s.name)) map.set(s.name, { name: s.name, title: s.title, entries: [] });
        if (!map.get(s.name).title && s.title) map.get(s.name).title = s.title;
        map.get(s.name).entries.push({ ...s, workName: i.workName, team: i.ownerTeamName });
      }
    }
    const isMe = (g) => g.name === me.employeeName;
    return [...map.values()].sort((a, b) => isMe(b) - isMe(a) || (a.name === '작성자 미상') - (b.name === '작성자 미상') || a.name.localeCompare(b.name, 'ko'));
  }, [byWriter, shown, me.employeeName]);

  return (
    <section className="view" aria-labelledby="view-h">
      <div className="view-bar">
        <div className="week-nav" role="group" aria-label="주차 이동">
          <button className="icon-btn" onClick={() => go(1)} disabled={idx < 0 || idx >= weeks.length - 1} aria-label="이전 주">‹</button>
          <h2 id="view-h">{cur ? `${cur.year}년 ${cur.week}주차` : '—'}{cur?.isCurrent && <span className="chip">이번 주</span>}</h2>
          <button className="icon-btn" onClick={() => go(-1)} disabled={idx <= 0} aria-label="다음 주">›</button>
          <label className="date-pick" title="날짜로 주차 고르기">
            <span className="sr-only">날짜로 찾기</span>
            <input type="date" value={cur?.from || ''} onChange={onDate}
              min={weeks.at(-1)?.from} max={weeks[0]?.to} />
          </label>
        </div>
        <div className="view-tools">
          <label className="mini-select">
            <span>팀</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">전체</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              {team && !teams.includes(team) && <option value={team}>{team}</option>}
            </select>
          </label>
          <label className="mini-select">
            <span>정렬</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="switch">
            <input type="checkbox" checked={byWriter} onChange={(e) => setByWriter(e.target.checked)} />
            <span>작성자별로 보기</span>
          </label>
        </div>
      </div>

      <dl className="status-line" aria-live="polite">
        <div><dt>기간</dt><dd>{cur ? fmtRange(cur) : '—'}</dd></div>
        <div><dt>업무</dt><dd>{report === undefined ? '…' : `${stats.total}건`}</dd></div>
        <div><dt>작성 현황</dt><dd>{report === undefined ? '…' : `${stats.done}/${stats.total} 작성 · ${stats.writers}명 참여 · 내 항목 ${stats.mine}건`}</dd></div>
        <div><dt>최종 수정</dt><dd>{fmtTime(stats.lastUpdated)}</dd></div>
        <div><dt>확정</dt><dd>{stats.confirmed == null ? '—' : stats.confirmed ? <span className="badge ok">확정</span> : <span className="badge">작성 중</span>}</dd></div>
      </dl>

      {report === undefined && <div className="drafting" role="status"><div className="drafting-lines" aria-hidden="true"><i /><i /><i /></div><p>보고서를 불러오는 중…</p></div>}
      {report === null && <p className="view-empty">이 주차에는 아직 본부 보고서가 없습니다.</p>}
      {report && !shown.length && <p className="view-empty">{team ? `${team} 항목이 없습니다.` : '보고서에 항목이 없습니다.'}</p>}

      {report && !byWriter && shown.map((i) => (
        <article key={i.weeklyReportItemId ?? i._i} className="view-item">
          <header className="view-item-head">
            <div>
              <h3>{i.workName}</h3>
              <p className="view-sub">
                {[i.ownerTeamName, (i.writers || []).map((w) => w.employeeName || w.name).filter(Boolean).join(', ') || '작성자 없음', updatedOf(i) && `수정 ${fmtTime(updatedOf(i))}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            {filled(i) && (
              <button className="btn ghost small" onClick={() => setSaving({ text: asTemplateSource(i), workName: i.workName })}>양식으로 저장</button>
            )}
          </header>
          {filled(i) ? <ItemBody item={i} me={me} onSaveSection={(s) => setSaving({ text: asTemplateSource(s), workName: i.workName, writer: s.name })} />
            : <p className="view-empty small">아직 작성된 내용이 없습니다.</p>}
        </article>
      ))}

      {report && byWriter && writerGroups.map((g) => (
        <article key={g.name} className="view-item writer-group">
          <header className="view-item-head">
            <div>
              <h3>{g.name} {g.title}{g.name === me.employeeName && <span className="chip">나</span>}</h3>
              <p className="view-sub">{g.entries.length}개 업무</p>
            </div>
          </header>
          {g.entries.map((e, n) => (
            <section key={n} className="writer-entry">
              <div className="writer-entry-head">
                <h4>{e.workName}{e.team && <small> · {e.team}</small>}</h4>
                <button className="text-link" onClick={() => setSaving({ text: asTemplateSource(e), workName: e.workName, writer: g.name })}>이 구역을 양식으로</button>
              </div>
              <Fields value={e} />
            </section>
          ))}
        </article>
      ))}

      {saving && (
        <SaveTemplateDialog source={saving} accountName={me.employeeName} onClose={() => setSaving(null)}
          onSave={async (t) => { await addTemplate(t); toast(`"${t.name}" 템플릿을 내 계정에 저장했습니다.`); }} />
      )}
    </section>
  );
}

// 공동 작성 항목은 작성자 구역마다 "이 구역을 양식으로" 버튼
function ItemBody({ item, onSaveSection }) {
  const sections = itemByWriter(item);
  if (sections.length <= 1 && !splitHasHeader(item)) return <Fields value={item} />;
  return sections.map((s) => (
    <section key={s.name} className="writer-entry">
      <div className="writer-entry-head">
        <h4>작성자 : {s.name} {s.title}</h4>
        <button className="text-link" onClick={() => onSaveSection(s)}>이 구역을 양식으로</button>
      </div>
      <Fields value={s} />
    </section>
  ));
}

const splitHasHeader = (item) => FIELDS.some(([k]) => (item[k] || '').split('\n').some((l) => parseWriterHeader(l)));

function Fields({ value }) {
  return (
    <div className="view-fields">
      {FIELDS.map(([k, label]) => (value[k] || '').trim() ? (
        <div key={k} className={k === 'issue' ? 'wide' : ''}>
          <p className="preview-label">{label}</p>
          <pre>{value[k].replace(/﻿/g, '')}</pre>
        </div>
      ) : null)}
    </div>
  );
}
