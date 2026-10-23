import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { chat } from '../chat.js';
import { toast } from './Toast.jsx';
export default function AIConnection({accountId}){
  const [state,setState]=useState(null);const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;const check=()=>{if(!document.hidden)api.aiStatus(accountId).then((s)=>{if(active)setState(s);}).catch(()=>{if(active)setState({available:false});});};check();const id=setInterval(check,15000);return()=>{active=false;clearInterval(id);};},[accountId]);
  async function reconnect(){setBusy(true);try{const result=await api.reconnectAi(accountId);setState(result);chat.reconnect();dispatchEvent(new CustomEvent('wr:ai-connection',{detail:result}));toast(result.available?'Qwen AI 연결을 확인했습니다.':result.message);}catch{toast('AI 연결을 확인하지 못했습니다. 다시 시도해 주세요.');}finally{setBusy(false);}}
  return <div className="ai-connection" role="status"><span>{!state?'AI 연결 확인 중…':state.available?'Qwen AI 연결됨':'AI 연결 확인 필요'}</span><button className="btn ghost small" disabled={busy} onClick={reconnect}>{busy?'연결 확인 중…':'AI 다시 연결'}</button></div>;
}
