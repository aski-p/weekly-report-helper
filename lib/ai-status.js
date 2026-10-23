import { MODEL } from './ai.js';
let cached;
export async function aiConnectionStatus(force=false) {
  if (!force && cached && Date.now()-cached.at<3000) return cached.value;
  if (!process.env.AI_BASE_URL) return {available:false,stt:false,model:'',message:'AI 서버 연결 설정이 필요합니다.'};
  const base=process.env.AI_BASE_URL.replace(/\/+$/,'');
  const headers=process.env.AI_API_KEY?{authorization:`Bearer ${process.env.AI_API_KEY}`}:{ };
  const probe=async(path)=>{const res=await fetch(base+path,{headers,signal:AbortSignal.timeout(5000)});if(!res.ok)throw Error('unavailable');return res.json();};
  const [models,stt]=await Promise.allSettled([probe('/models'),probe('/stt/health')]);
  const available=models.status==='fulfilled'&&Array.isArray(models.value.data)&&models.value.data.some((m)=>m.id===MODEL);
  const value={available,stt:stt.status==='fulfilled'&&stt.value.status==='ok',model:MODEL,message:available?'AI 연결 정상':'AI 서버에 연결하지 못했습니다. 잠시 후 다시 연결해 주세요.'};
  cached={at:Date.now(),value};return value;
}
