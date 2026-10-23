import { useEffect, useRef } from 'react';
import { speakerAvatar, speakerLabel, timeLabel } from '../../shared/speakers.js';

export default function SpeakerPicker({ meeting, segment, ids, onChoose, onClose }) {
  const ref = useRef(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const key = crypto.randomUUID();
    let owned = true;
    // Android's system Back closes this picker before leaving the recording page.
    history.pushState({ ...history.state, speakerPicker: key }, '', location.href);
    const back = () => { owned = false; close.current(); };
    addEventListener('popstate', back);
    dialog.showModal();
    return () => {
      removeEventListener('popstate', back);
      if (dialog.open) dialog.close();
      if (owned && history.state?.speakerPicker === key) history.back();
    };
  }, []);
  return <dialog ref={ref} className="confirm speaker-picker" aria-labelledby="speaker-picker-title"
    onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <header className="confirm-head speaker-picker-head">
      <div><h3 id="speaker-picker-title">발언 화자 선택</h3><p>{timeLabel(segment.start)} 발언의 화자를 고르세요.</p></div>
      <button type="button" className="icon-btn" aria-label="화자 선택 닫기" onClick={onClose}>×</button>
    </header>
    <div className="confirm-body speaker-options">
      {['', ...ids].map((id) => <button type="button" key={id || 'unknown'} className="speaker-option"
        aria-pressed={segment.speaker === id} aria-label={`${speakerLabel(id, meeting.speakerNames)} 선택`} onClick={() => onChoose(id)}>
        <span className="speaker-avatar" aria-hidden="true">{speakerAvatar(meeting.id, id)}</span>
        <span>{id ? speakerLabel(id, meeting.speakerNames) : '이름 없이 유지'}</span>
        {segment.speaker === id && <small>선택됨</small>}
      </button>)}
    </div>
    <footer className="confirm-foot"><button type="button" className="btn ghost" onClick={onClose}>녹취로 돌아가기</button></footer>
  </dialog>;
}
