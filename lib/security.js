import { createHash, randomUUID } from 'node:crypto';
export const MAX_REQUEST_BYTES=4400000;
export const securityError=(message,status=400,code='BAD_REQUEST')=>Object.assign(new Error(message),{status,code});
export const SECURITY_HEADERS={
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), geolocation=(), payment=(), microphone=(self)',
  'Cross-Origin-Opener-Policy':'same-origin',
};
export const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:; img-src 'self' data: blob:; connect-src 'self' https://*.ts.net wss://*.ts.net; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";
export function parseRequestBody(value,headers={}){
  const length=Number(headers['content-length']||0);
  if(length>MAX_REQUEST_BYTES)throw securityError('요청 내용이 너무 큽니다',413,'TOO_LARGE');
  if(value==null||value==='')return undefined;
  if(headers['content-type']&&!String(headers['content-type']).toLowerCase().startsWith('application/json'))throw securityError('JSON 요청만 처리할 수 있습니다',415,'CONTENT_TYPE');
  if(typeof value==='string'||Buffer.isBuffer(value)){
    if(Buffer.byteLength(value)>MAX_REQUEST_BYTES)throw securityError('요청 내용이 너무 큽니다',413,'TOO_LARGE');
    try{value=JSON.parse(value.toString());}catch{throw securityError('JSON 형식이 올바르지 않습니다');}
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw securityError('요청 본문은 JSON 객체여야 합니다');
  if(Buffer.byteLength(JSON.stringify(value))>MAX_REQUEST_BYTES)throw securityError('요청 내용이 너무 큽니다',413,'TOO_LARGE');
  return value;
}
export function validateEnvelope({method,headers,body}){
  if(!['GET','POST','PUT','DELETE'].includes(method))throw securityError('지원하지 않는 요청입니다',405,'METHOD_NOT_ALLOWED');
  if(method!=='GET'&&headers['sec-fetch-site']==='cross-site')throw securityError('다른 사이트에서 보낸 변경 요청은 허용되지 않습니다',403,'CROSS_SITE');
  if(headers['x-wr-account']!=null&&!/^[A-Za-z0-9_.-]{1,80}$/.test(String(headers['x-wr-account'])))throw securityError('계정 정보가 올바르지 않습니다');
  return parseRequestBody(body,headers);
}
// An instance-level abuse guard. The upstream login and platform protections
// remain authoritative; this is not a distributed rate limit.
export function createRequestLimiter(now=Date.now){
  const entries=new Map();
  return ({path,token='',ip='unknown'})=>{
    const expensive=['/draft','/templates/extract','/meetings/summarize','/ai/reconnect'].includes(path);
    const login=path==='/login';
    const limit=login?6:expensive?20:240,windowMs=login?300000:60000;
    const key=createHash('sha256').update(`${login?'login':expensive?'ai':'api'}:${ip}:${login?'':token}`).digest('hex');
    const at=now();let entry=entries.get(key);
    if(!entry||entry.until<=at){entry={count:0,until:at+windowMs};entries.set(key,entry);}
    if(++entry.count>limit)throw securityError('요청이 많습니다. 잠시 후 다시 시도하세요',429,'RATE_LIMIT');
    if(entries.size>4096)for(const [k,v]of entries){if(v.until<=at||entries.size>4096)entries.delete(k);}
  };
}
export function safeFailure(error,path){
  const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:502;
  if(status<500)return{status,data:{code:error.code||'BAD_REQUEST',message:error.message,...(error.code==='SYNC_CONFLICT'?{current:error.current}:{})}};
  const requestId=randomUUID();
  console.error('API request failed',{requestId,path,code:error.code||'UPSTREAM_ERROR'});
  const messages={NO_AI_KEY:'AI 연결 설정을 확인해 주세요.',NO_CHAT:'메신저 연결 설정을 확인해 주세요.',NO_STORE:'자료 저장 서버 연결을 확인해 주세요.',STORE_UNAVAILABLE:'자료 서버에 연결하지 못했습니다. 변경 내용은 이 기기에 보관됩니다.',MEETING_SUMMARY_INCOMPLETE:'일부 회의가 요약에서 빠졌습니다. 다시 정리해 주세요.'};
  return{status,data:{code:error.code||'ERROR',message:messages[error.code]||'서버 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',requestId}};
}
