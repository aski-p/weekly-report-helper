import { useEffect, useRef, useState } from 'react';
import { speakerId, speakerLabel, speakerList, timeLabel } from '../../shared/speakers.js';

export default function SpeakerTranscript({ meeting: m, update, live }) {
  const names = m.speakerNames || {};
  const segments = m.segments || [];
  const ids = speakerList(m);
  const [limit, setLimit] = useState(100);
  const scroller = useRef(null);
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
    <p className="view-sub">음성에 따라 A·B·C로 구분합니다. 이름은 나중에 지정해도 됩니다. 다른 사람으로 구분된 발언은 화자를 직접 바꿀 수 있습니다.</p>
    {ids.length > 0 && <div className="speaker-names" role="group" aria-label="알파벳별 이름 지정">
      {ids.map((id) => <label className="field" key={id}><span>화자 {id} 이름</span><input value={names[id] || ''} onChange={(e) => rename(id, e.target.value)} placeholder="나중에 이름 지정" maxLength={80} /></label>)}
    </div>}
    {ids.length > 0 && <p className="view-sub">이름을 지정한 뒤 AI 요약을 만들면 지정한 이름으로 정리됩니다.</p>}
    {segments.length ? <>
      <div className="speaker-utterances" ref={scroller}>
        {segments.length > limit && <button className="text-link" onClick={() => setLimit((n) => n + 100)}>이전 발언 {Math.min(100, segments.length - limit)}개 더 보기</button>}
        {segments.slice(-limit).map((s) => <div className="speaker-utterance" key={s.id}>
          <div className="speaker-turn-head"><span>{timeLabel(s.start)}</span>
            <select aria-label={`${timeLabel(s.start)} 발언 화자`} value={s.speaker} onChange={(e) => edit(s.id, { speaker: e.target.value })}>
              <option value="">화자 미확인</option>
              {ids.map((id) => <option key={id} value={id}>{speakerLabel(id, names)}</option>)}
            </select>
          </div>
          <textarea aria-label={`${timeLabel(s.start)} ${speakerLabel(s.speaker, names)} 발언`} rows={2} value={s.text} onChange={(e) => edit(s.id, { text: e.target.value })} spellCheck={false} />
        </div>)}
      </div>
    </> : <label className="rfield"><span className="rfield-label">녹취 <span className="count">{m.transcript.length.toLocaleString()}자</span></span>
      <textarea className="mt-transcript" value={m.transcript} onChange={(e) => update(m.id, { transcript: e.target.value })} spellCheck={false} placeholder="녹음을 시작하면 발언별로 글이 쌓입니다. 기존 녹취를 붙여넣어 직접 화자를 지정할 수도 있습니다." />
      {m.transcript.trim() && <button className="text-link" onClick={convert}>기존 녹취를 발언별로 편집하기</button>}
    </label>}
  </section>;
}
