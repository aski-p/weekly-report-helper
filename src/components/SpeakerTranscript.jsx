import { useEffect, useRef, useState } from 'react';
import { speakerId, speakerLabel, speakerList, timeLabel, speakerAvatar } from '../../shared/speakers.js';
import SpeakerPicker from './SpeakerPicker.jsx';

export default function SpeakerTranscript({ meeting: m, update, live }) {
  const names = m.speakerNames || {};
  const segments = m.segments || [];
  const ids = speakerList(m);
  const [limit, setLimit] = useState(100);
  const [mode, setMode] = useState('read');
  const scroller = useRef(null);
  const [picking, setPicking] = useState(null);
  const trigger = useRef(null);
  const closePicker = () => { setPicking(null); requestAnimationFrame(() => trigger.current?.focus()); };
  useEffect(() => { if (live && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [segments.length, live]);
  const rename = (id, name) => update(m.id, { speakerNames: { ...names, [id]: name } });
  const add = () => {
    let n = 0; while (ids.includes(speakerId(n))) n++;
    rename(speakerId(n), '');
  };
  const edit = (id, patch) => update(m.id, (current) => ({ segments: current.segments.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  const convert = () => {
    const entries = m.transcript.split('\n').map((text) => text.trim()).filter(Boolean).map((text) => {
      const stamp = text.match(/^\[(\d+):(\d+)(?::(\d+))?\]\s*/);
      const start = stamp ? stamp[3] ? +stamp[1] * 3600 + +stamp[2] * 60 + +stamp[3] : +stamp[1] * 60 + +stamp[2] : 0;
      return { id: crypto.randomUUID(), start, end: start, speaker: '', text: text.replace(/^\[\d+:\d+(?::\d+)?\]\s*/, '') };
    });
    update(m.id, { segments: entries });
  };
  return <section className="speaker-transcript" aria-label="화자별 녹취">
    <div className="speaker-heading"><h3>화자별 녹취</h3><button className="btn ghost small" disabled={ids.length >= 100} onClick={add}>화자 추가</button></div>
    <div className="speaker-view-tabs" role="group" aria-label="녹취 보기 방식">
      <button type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}>녹취 보기</button>
      <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>발언·화자 수정</button>
    </div>
    {ids.length > 0 && <details className="speaker-name-panel"><summary>화자 이름 지정 · {ids.length}명</summary><div className="speaker-names" role="group" aria-label="알파벳별 이름 지정">
      {ids.map((id) => <label className="field" key={id}><span className="speaker-name-label"><span className="speaker-avatar" aria-hidden="true">{speakerAvatar(m.id, id)}</span>화자 {id} 이름</span><input aria-label={`화자 ${id} 이름`} value={names[id] || ''} onChange={(e) => rename(id, e.target.value)} placeholder="나중에 이름 지정" maxLength={80} /></label>)}
    </div><p className="view-sub">이름을 지정한 뒤 AI 요약을 만들면 해당 이름으로 정리됩니다.</p></details>}
    {segments.length && mode === 'read' ? <div className="transcript-continuous" ref={scroller} aria-label="연속 녹취">
      {segments.length > limit && <button className="text-link" onClick={() => setLimit((n) => n + 100)}>이전 발언 더 보기</button>}
      {segments.slice(-limit).map((s) => <div className="transcript-paragraph" key={s.id}>
        <div className="transcript-meta"><time>{timeLabel(s.start)}</time>{s.speaker && <span className="transcript-speaker"><span aria-hidden="true">{speakerAvatar(m.id, s.speaker)}</span> {speakerLabel(s.speaker, names)}</span>}</div>
        <p>{s.text}</p>
      </div>)}
    </div> : segments.length ? <>
      <div className="speaker-utterances" ref={scroller}>
        {segments.length > limit && <button className="text-link" onClick={() => setLimit((n) => n + 100)}>이전 발언 {Math.min(100, segments.length - limit)}개 더 보기</button>}
        {segments.slice(-limit).map((s) => <div className="speaker-utterance" key={s.id}>
          <div className="speaker-turn-head"><span>{timeLabel(s.start)}</span>
            <button type="button" className="speaker-turn-button" aria-label={`${timeLabel(s.start)} 발언 화자`} aria-haspopup="dialog" aria-expanded={picking?.id === s.id}
              onClick={(e) => { trigger.current = e.currentTarget; setPicking(s); }}>
              <span className="speaker-avatar" aria-hidden="true">{speakerAvatar(m.id, s.speaker)}</span>{s.speaker ? speakerLabel(s.speaker, names) : '화자 지정'} <span aria-hidden="true">⌄</span>
            </button>
          </div>
          <textarea aria-label={`${timeLabel(s.start)} ${speakerLabel(s.speaker, names)} 발언`} rows={2} value={s.text} onChange={(e) => edit(s.id, { text: e.target.value })} spellCheck={false} />
        </div>)}
      </div>
    </> : <label className="rfield"><span className="rfield-label">녹취 <span className="count">{m.transcript.length.toLocaleString()}자</span></span>
      <textarea className="mt-transcript" value={m.transcript} onChange={(e) => update(m.id, { transcript: e.target.value })} spellCheck={false} placeholder="녹음을 시작하면 발언별로 글이 쌓입니다. 기존 녹취를 붙여넣어 직접 화자를 지정할 수도 있습니다." />
      {m.transcript.trim() && <button className="text-link" onClick={convert}>기존 녹취를 발언별로 편집하기</button>}
    </label>}
    {picking && <SpeakerPicker meeting={m} segment={picking} ids={ids} onClose={closePicker} onChoose={(id) => { edit(picking.id, { speaker: id }); closePicker(); }} />}
  </section>;
}
