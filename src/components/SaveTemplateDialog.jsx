import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api.js';

// 글 → AI가 구조를 뽑음 → 확인·이름 수정 → 양식으로 저장
// source: { text, workName, writer } — text 가 비어 있으면 붙여넣기 입력부터 받는다
export default function SaveTemplateDialog({ source, onSave, onClose }) {
  const ref = useRef(null);
  const [text, setText] = useState(source?.text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tpl, setTpl] = useState(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { if (source?.text) extract(source.text); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function extract(t = text) {
    if (!t.trim()) { setError('양식으로 만들 글을 붙여넣으세요.'); return; }
    setBusy(true); setError('');
    try {
      setTpl(await api.extractTemplate(t, source?.workName, source?.writer));
    } catch (e) {
      setError(errorText(e, '양식을 만들지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setTpl((p) => ({ ...p, [k]: e.target.value }));
  const origin = source?.workName ? `${source.workName}${source.writer ? ` · ${source.writer}` : ''}` : '붙여넣은 글';

  return (
    <dialog ref={ref} className="confirm tpl-dialog" onClose={onClose} onCancel={(e) => busy && e.preventDefault()}>
      <header className="confirm-head">
        <h3>양식으로 저장</h3>
        <p>{tpl ? 'AI가 뽑은 구조입니다. {중괄호}는 매주 채워질 자리입니다. 고칠 곳이 있으면 고친 뒤 저장하세요.' : `${origin}에서 내용은 빼고 형식만 양식으로 남깁니다.`}</p>
      </header>
      <div className="confirm-body">
        {!tpl && !source?.text && (
          <label className="rfield wide">
            <span className="rfield-label">보고서 글 붙여넣기</span>
            <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              placeholder={'# 업무명\n * 항목\n  - 세부 내용\n\n[차주]·[이슈]로 나눠 붙여도 됩니다.'} />
          </label>
        )}
        {busy && (
          <div className="drafting" role="status">
            <div className="drafting-lines" aria-hidden="true"><i /><i /><i /></div>
            <p>글의 구조를 읽고 양식을 만드는 중입니다. 보통 10초 안팎 걸립니다.</p>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {tpl && !busy && (
          <div className="tpl-edit">
            <label className="field"><span>양식 이름</span><input value={tpl.name} onChange={set('name')} maxLength={40} /></label>
            <label className="field"><span>문체</span><input value={tpl.style} onChange={set('style')} /></label>
            <div className="item-fields">
              <label className="rfield"><span className="rfield-label">금주 뼈대</span><textarea rows={8} value={tpl.thisWeek} onChange={set('thisWeek')} spellCheck={false} /></label>
              <label className="rfield"><span className="rfield-label">차주 뼈대</span><textarea rows={8} value={tpl.nextWeek} onChange={set('nextWeek')} spellCheck={false} /></label>
              <label className="rfield wide"><span className="rfield-label">이슈 뼈대</span><textarea rows={2} value={tpl.issue} onChange={set('issue')} spellCheck={false} placeholder="없으면 비워 두세요" /></label>
            </div>
          </div>
        )}
      </div>
      <footer className="confirm-foot">
        <button className="btn ghost" onClick={() => ref.current.close()} disabled={busy}>취소</button>
        {tpl
          ? <button className="btn primary" disabled={busy || !tpl.name.trim()} onClick={() => { onSave({ ...tpl, name: tpl.name.trim(), origin }); ref.current.close(); }}>양식 저장</button>
          : !source?.text && <button className="btn primary" disabled={busy} onClick={() => extract()}>{busy ? '만드는 중…' : '구조 뽑기'}</button>}
      </footer>
    </dialog>
  );
}
