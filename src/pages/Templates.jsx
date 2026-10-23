import { useState } from 'react';
import SaveStatus from '../components/SaveStatus.jsx';
import { toast } from '../components/Toast.jsx';
import SaveTemplateDialog from '../components/SaveTemplateDialog.jsx';
import { DAYS, fmtSlot, nextSlot, useTemplates } from '../templates.js';
import { notifySupported, requestNotify } from '../useAutomation.js';

export default function Templates({ me, onRunNow, running }) {
  const { templates, addTemplate, updateTemplate, removeTemplate, auto, setAuto, status, error, retry } = useTemplates(me.employeeId);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const [perm, setPerm] = useState(notifySupported() ? Notification.permission : 'unsupported');

  const tplOk = templates.some((t) => t.id === auto.templateId);
  const toggle = async (on) => {
    if (on && !tplOk) { toast('먼저 자동화에 쓸 양식을 고르세요.'); return; }
    if (on && perm === 'default') setPerm(await requestNotify());
    setAuto({ enabled: on, lastRun: on ? Date.now() : auto.lastRun });
  };

  return (
    <div className="tpl-page">
      <section className="panel auto-panel" aria-labelledby="auto-h">
        <div className="panel-head">
          <div>
            <h2 id="auto-h">자동화</h2>
            <p className="panel-sub">정한 요일·시간에 고른 양식으로 이번 주 초안을 만들고 알려 드립니다. 게시는 확인하고 승인해야만 됩니다.</p>
          </div>
          <label className="switch big">
            <input type="checkbox" checked={auto.enabled} onChange={(e) => toggle(e.target.checked)} />
            <span>{auto.enabled ? '켜짐' : '꺼짐'}</span>
          </label>
        </div>
        <div className="auto-grid">
          <label className="mini-select">
            <span>양식</span>
            <select value={tplOk ? auto.templateId : ''} onChange={(e) => setAuto({ templateId: e.target.value || null })}>
              <option value="">{templates.length ? '양식을 고르세요' : '저장된 양식 없음'}</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="mini-select">
            <span>요일</span>
            <select value={auto.day} onChange={(e) => setAuto({ day: +e.target.value, lastRun: Date.now() })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DAYS[d]}요일</option>)}
            </select>
          </label>
          <label className="mini-select">
            <span>시간</span>
            <input type="time" value={auto.time} onChange={(e) => e.target.value && setAuto({ time: e.target.value, lastRun: Date.now() })} />
          </label>
        </div>
        <p className="auto-status">
          {auto.enabled && tplOk ? <>다음 실행 <b>{fmtSlot(nextSlot(auto))}</b> · 메모가 비어 있으면 지난주 차주 계획을 바탕으로 씁니다.</>
            : '꺼져 있습니다.'}
        </p>
        {perm === 'default' && <p className="auto-note">알림을 받으려면 <button className="text-link" onClick={async () => setPerm(await requestNotify())}>알림 허용</button>을 눌러 주세요.</p>}
        {perm === 'denied' && <p className="auto-note warn-line">브라우저에서 알림이 차단돼 있습니다. 앱을 열면 화면 안 알림으로 대신 알려 드립니다.</p>}
        <p className="auto-note">이 기기에서 앱(또는 탭)이 열려 있거나 백그라운드에 있을 때 실행되고, 꺼져 있었다면 다음에 열 때 바로 실행됩니다.</p>
        <div className="auto-actions">
          <button className="btn ghost small" disabled={!tplOk || running} onClick={onRunNow}>{running ? '초안 만드는 중…' : '지금 한 번 실행해 보기'}</button>
        </div>
      </section>

      <section className="panel" aria-labelledby="tpl-h">
        <div className="panel-head">
          <div>
            <h2 id="tpl-h">내 양식 {templates.length ? <small>{templates.length}개</small> : null}</h2>
            <p className="panel-sub">조회 화면에서 마음에 드는 글의 <b>양식으로 저장</b>을 누르거나, 글을 붙여넣어 추가하세요.</p>
          </div>
          <button className="btn primary small" onClick={() => setAdding(true)}>붙여넣어 추가</button>
        </div>
        <SaveStatus status={status} error={error} onRetry={retry} />
        {!templates.length && <p className="view-empty">아직 저장한 양식이 없습니다.</p>}
        <ul className="tpl-list">
          {templates.map((t) => (
            <li key={t.id} className="tpl-card">
              <div className="tpl-card-head">
                <input className="tpl-name" value={t.name} aria-label="양식 이름" onChange={(e) => updateTemplate(t.id, { name: e.target.value })} />
                {auto.templateId === t.id && auto.enabled && <span className="chip">자동화</span>}
                <button className="text-link" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>{open === t.id ? '접기' : '구조 보기'}</button>
                <button className="text-link" onClick={() => { if (confirm(`"${t.name}" 양식을 지울까요?`)) { removeTemplate(t.id); if (auto.templateId === t.id) setAuto({ templateId: null, enabled: false }); } }}>삭제</button>
              </div>
              <p className="view-sub">{[t.origin, t.style].filter(Boolean).join(' · ')}</p>
              {open === t.id && (
                <div className="item-fields">
                  <label className="rfield"><span className="rfield-label">금주 뼈대</span><textarea rows={7} value={t.thisWeek} spellCheck={false} onChange={(e) => updateTemplate(t.id, { thisWeek: e.target.value })} /></label>
                  <label className="rfield"><span className="rfield-label">차주 뼈대</span><textarea rows={7} value={t.nextWeek} spellCheck={false} onChange={(e) => updateTemplate(t.id, { nextWeek: e.target.value })} /></label>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {adding && <SaveTemplateDialog source={null} onClose={() => setAdding(false)} onSave={(t) => { addTemplate(t); toast(`"${t.name}" 양식 저장을 요청했습니다.`); }} />}
    </div>
  );
}
