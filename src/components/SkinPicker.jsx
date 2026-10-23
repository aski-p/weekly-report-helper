import { useEffect, useRef, useState } from 'react';
import { FONT_KINDS, FONTS, SKINS, loadFont, useSkin } from '../skin.js';

// 맨 위 막대의 "스킨" 버튼: 색 컨셉과 본문 글꼴을 고른다
export default function SkinPicker() {
  const [open, setOpen] = useState(false);
  const [{ skin, font }, set] = useSkin();
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    FONTS.forEach(loadFont); // 글꼴 미리보기
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="skin" ref={box}>
      <button type="button" className="skin-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" title="스킨·글꼴 바꾸기">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13c.9 0 1.4-.6 1.4-1.3 0-.4-.2-.7-.4-1-.2-.3-.4-.6-.4-1 0-.7.6-1.3 1.3-1.3h1.5A3.1 3.1 0 0 0 14.5 6.8C14.5 3.8 11.6 1.5 8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="4.8" cy="7.6" r="1" fill="currentColor" /><circle cx="6.6" cy="4.7" r="1" fill="currentColor" /><circle cx="9.9" cy="4.7" r="1" fill="currentColor" />
        </svg>
        <span>스킨</span>
      </button>
      {open && (
        <div className="skin-pop" role="dialog" aria-label="스킨과 글꼴">
          {[['밝은 색', SKINS.filter((s) => !s.dark)], ['어두운 색', SKINS.filter((s) => s.dark)]].map(([label, list]) => (
          <div key={label}>
          <p className="skin-label">{label}</p>
          <div className="skin-grid" role="radiogroup" aria-label={label}>
            {list.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={skin === s.id} className="skin-opt" onClick={() => set({ skin: s.id })}>
                <span className="skin-swatch" style={{ background: s.swatch[0] }} aria-hidden="true">
                  <span className="sw-sheet" style={{ background: s.swatch[1], borderColor: s.dark ? '#ffffff1f' : '#0000001a' }}>
                    <i style={{ background: s.swatch[2] }} /><i style={{ background: s.swatch[2], opacity: 0.45 }} />
                  </span>
                  <span className="sw-seal" style={{ borderColor: s.swatch[3] }} />
                </span>
                <span className="skin-name">{s.name}</span>
                <span className="skin-desc">{s.desc}</span>
              </button>
            ))}
          </div>
          </div>
          ))}
          {FONT_KINDS.map(([kind, label]) => (
          <div key={kind}>
          <p className="skin-label">글꼴 · {label}</p>
          <div className="font-list" role="radiogroup" aria-label={`글꼴 ${label}`}>
            {FONTS.filter((f) => f.kind === kind).map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={font === f.id} className="font-opt" onClick={() => set({ font: f.id })}>
                <span className="font-sample" style={{ fontFamily: `${f.stack}, sans-serif` }}>주간업무보고 가나다 123</span>
                <span className="font-name">{f.name}</span>
              </button>
            ))}
          </div>
          </div>
          ))}
          <p className="skin-note">이 기기에 저장됩니다. 메모·보고서 입력 칸은 들여쓰기가 맞도록 고정폭 글꼴을 유지합니다.</p>
        </div>
      )}
    </div>
  );
}
