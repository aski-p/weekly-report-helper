import { useEffect, useRef, useState } from 'react';
import { useAccountSync, refreshAccountSync, resolveAccountConflict } from '../account-sync.js';
const labels={memo:'메모',draft:'보고서 초안',approval:'게시 확인',automation:'자동화 설정',writeTemplate:'선택한 양식',skin:'스킨',font:'글꼴'};
const title=(key)=>{const [kind,week]=key.split('.');return `${labels[kind]||key}${/^20\d{2}-/.test(week||'')?` (${week})`:''}`;};
export default function SyncStatus(){
  const s=useAccountSync();const [open,setOpen]=useState(false);
  return <div className="sync-status" role="status">
    <span>{s.status==='loading'?'계정 자료 불러오는 중…':s.status==='pending'?`서버 저장 중 · ${s.pending}건`:s.status==='conflict'?`다른 기기 변경 확인 · ${s.conflicts.length}건`:s.status==='error'?'동기화 연결 확인 필요':s.status==='saved'?'계정 DB와 동기화됨':''}</span>
    {s.status==='error'&&<button className="text-link" onClick={refreshAccountSync}>다시 시도</button>}
    {s.conflicts.length>0&&<button className="text-link" onClick={()=>setOpen(true)}>두 내용 비교</button>}
    {open&&<ConflictDialog conflicts={s.conflicts} onClose={()=>setOpen(false)} />}
  </div>;
}
function ConflictDialog({conflicts,onClose}){
  const ref=useRef(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const item=conflicts[0];
  useEffect(()=>{ref.current.showModal();},[]);
  async function choose(choice){setBusy(true);setError('');try{await resolveAccountConflict(item.key,choice);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <dialog ref={ref} className="confirm sync-conflicts" aria-labelledby="sync-conflict-title" onClose={onClose} onCancel={(e)=>{if(busy)e.preventDefault();}}>
    <header className="confirm-head"><h3 id="sync-conflict-title">다른 기기의 변경 내용 확인</h3><p>같은 자료가 두 기기에서 바뀌었습니다. 덮어쓰기 전에 사용할 내용을 골라 주세요.</p></header>
    <div className="confirm-body">{item?<><h4>{title(item.key)}</h4><div className="sync-compare"><label className="field"><span>이 기기의 내용</span><textarea rows={10} value={item.localValue||'(비어 있음)'} readOnly /></label><label className="field"><span>서버에 저장된 내용</span><textarea rows={10} value={item.current.value||'(비어 있음)'} readOnly /></label></div>{error&&<p role="alert">{error}</p>}</>:<p>확인할 변경 내용이 없습니다.</p>}</div>
    <footer className="confirm-foot"><button className="btn ghost" disabled={busy} onClick={()=>ref.current.close()}>닫기</button>{item&&<><button className="btn ghost" disabled={busy} onClick={()=>choose('remote')}>서버 내용 사용</button><button className="btn primary" disabled={busy} onClick={()=>choose('local')}>이 기기 내용 저장</button></>}</footer>
  </dialog>;
}
