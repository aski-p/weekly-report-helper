import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api.js';
import WorkPicker from './WorkPicker.jsx';
export default function ReportRegistration({me,week,items,onClose,onSaved}) {
  const ref=useRef(null);
  const [item,setItem]=useState({workKindCode:'',workId:null,workName:'',thisWeek:'',nextWeek:'',issue:''});
  const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const candidates=items.map(i=>({...i,existing:true}));
  useEffect(()=>{ref.current.showModal();},[]);
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');
    try{
      const r=await api.commit(week.year,week.week,[item],!preview,me.employeeId);
      const failure=r.results.find(r=>r.error||r.ok===false);
      if(failure)throw Error(failure.error||'등록하지 못했습니다. 다시 확인해 주세요.');
      if(preview)onSaved();else setPreview(r.results[0]);
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  return <dialog ref={ref} className="confirm report-registration" aria-labelledby="register-report-title" onClose={onClose} onCancel={e=>{if(busy)e.preventDefault();}}>
    <form onSubmit={submit}>
      <header className="confirm-head"><h3 id="register-report-title">주간보고 등록</h3><p>{week.year}년 {week.week}주차 · {me.employeeName}</p></header>
      <div className="confirm-body">
        {!preview?<><label className="field"><span>업무 선택 · 업무명을 입력하면 일반업무로 추가할 수 있습니다</span></label><WorkPicker value={item} candidates={candidates} onChange={patch=>setItem(i=>({...i,...patch}))} />
          {[['thisWeek','금주 실적'],['nextWeek','차주 계획'],['issue','이슈 · 협조 요청']].map(([key,label])=><label className="field" key={key}><span>{label}</span><textarea rows={5} maxLength={4000} value={item[key]} onChange={e=>setItem(i=>({...i,[key]:e.target.value}))} /></label>)}</>
          :<><p>{preview.mode==='section'?'공동 항목의 내 구역에 등록합니다.':preview.mode==='replace'?'기존 내 항목에 반영합니다.':'새 항목으로 등록합니다.'}</p><h4>{item.workName}</h4>{[['thisWeek','금주 실적'],['nextWeek','차주 계획'],['issue','이슈']].map(([k,l])=>preview.fields[k]?<div key={k}><p className="preview-label">{l}</p><pre className="report-registration-preview">{preview.fields[k]}</pre></div>:null)}</>}
        {error&&<p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="confirm-foot"><button type="button" className="btn ghost" disabled={busy} onClick={()=>ref.current.close()}>닫기</button>{preview&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>{setPreview(null);setError('');}}>다시 수정</button>}<button type="submit" className="btn seal" disabled={busy||!item.workKindCode||!item.workName.trim()||![item.thisWeek,item.nextWeek,item.issue].some(v=>v.trim())}>{busy?'처리 중…':preview?'확인하고 등록':'등록 내용 확인'}</button></footer>
    </form>
  </dialog>;
}
