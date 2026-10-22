import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';

const kindLabel = (k) => (k === 'S' ? '서비스·사업' : k === 'G' ? '일반업무' : k === 'P' ? '프로젝트' : '');

// 업무 고르기: 이번 주 보고서 항목 → 전체 업무 검색 → 일반업무 새로 만들기
export default function WorkPicker({ value, candidates, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 1) { setRemote([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.works(q.trim()).then(setRemote).catch(() => setRemote([])).finally(() => setLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [q, open]);

  const ql = q.trim().toLowerCase();
  const local = candidates.filter((c) => !ql || c.workName.toLowerCase().includes(ql));
  const localIds = new Set(local.map((c) => c.workId).filter(Boolean));
  const others = remote.filter((w) => !localIds.has(w.workId));
  const options = [
    ...local.map((c) => ({ ...c, group: c.existing ? '이번 주 보고서' : '지난주에 쓴 업무' })),
    ...others.map((w) => ({ ...w, existing: false, group: '전체 업무' })),
    ...(q.trim() ? [{ workKindCode: 'G', workId: null, workName: q.trim(), existing: false, group: '새로 만들기', create: true }] : []),
  ];

  function pick(o) {
    const existing = o.workKindCode === 'G'
      ? candidates.some((c) => c.workKindCode === 'G' && c.workName === o.workName && c.existing)
      : candidates.some((c) => c.workId === o.workId && c.existing);
    onChange({ workKindCode: o.workKindCode, workId: o.workId ?? null, workName: o.workName, existing });
    setOpen(false); setQ('');
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[active]) pick(options[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  let lastGroup = null;
  return (
    <div className="picker" ref={boxRef}>
      <button type="button" className={`picker-btn${value.workKindCode ? '' : ' empty'}`} onClick={() => { setOpen((o) => !o); setActive(0); }} aria-expanded={open} aria-haspopup="listbox">
        <span className="picker-name">{value.workName || '업무를 고르세요'}</span>
        {value.workKindCode && <span className="picker-kind">{kindLabel(value.workKindCode)}{value.workId ? ` ${value.workId}` : ''}</span>}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="picker-pop">
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
            placeholder="업무명으로 찾기" role="combobox" aria-controls={listId} aria-expanded="true" aria-autocomplete="list" />
          <ul id={listId} role="listbox">
            {options.map((o, i) => {
              const head = o.group !== lastGroup ? (lastGroup = o.group) : null;
              return [
                head && <li key={`h-${head}`} className="picker-group" role="presentation">{head}</li>,
                <li key={`${o.group}-${o.workId || o.workName}`} role="option" aria-selected={i === active}
                  className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                  <span>{o.create ? `"${o.workName}" 일반업무로 추가` : o.workName}</span>
                  {!o.create && <small>{kindLabel(o.workKindCode)}{o.team ? ` · ${o.team}` : ''}</small>}
                </li>,
              ];
            })}
            {loading && <li className="picker-group" role="presentation">찾는 중…</li>}
            {!options.length && !loading && <li className="picker-group" role="presentation">업무명을 입력해 찾으세요</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
