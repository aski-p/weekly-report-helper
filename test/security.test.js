import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvelope, createRequestLimiter, safeFailure, MAX_REQUEST_BYTES } from '../lib/security.js';
import { handle } from '../lib/routes.js';
test('request boundary rejects malformed, oversized, and cross-site mutations',()=>{
  for(const body of ['{','[]','null'])assert.throws(()=>validateEnvelope({method:'POST',headers:{},body}));
  assert.throws(()=>validateEnvelope({method:'PUT',headers:{'sec-fetch-site':'cross-site'},body:{}}),{status:403});
  assert.throws(()=>validateEnvelope({method:'PUT',headers:{},body:{text:'x'.repeat(MAX_REQUEST_BYTES)}}),{status:413});
  assert.throws(()=>validateEnvelope({method:'POST',headers:{'content-type':'text/plain'},body:'{}'}),{status:415});
});
test('protected endpoints reject missing authentication before calling upstream',async()=>{
  for(const [method,path]of [['GET','/workspace'],['POST','/draft'],['GET','/ai/status']])assert.equal((await handle({method,path,body:method==='POST'?{}:undefined})).status,401);
});
test('login abuse guard expires and does not share counters between addresses',()=>{
  let now=100;const check=createRequestLimiter(()=>now);
  for(let i=0;i<6;i++)check({path:'/login',ip:'a'});
  assert.throws(()=>check({path:'/login',ip:'a'}),{status:429});check({path:'/login',ip:'b'});now+=300001;check({path:'/login',ip:'a'});
});
test('upstream failure details are redacted while version conflicts remain actionable',()=>{
  const fail=safeFailure(Error('private-key-internal-host'),'/draft');
  assert.equal(fail.status,502);assert.ok(fail.data.requestId);assert.ok(!JSON.stringify(fail).includes('private-key'));
  const current={key:'memo.2026-43',version:2,value:'remote'};
  assert.deepEqual(safeFailure(Object.assign(Error('conflict'),{status:409,code:'SYNC_CONFLICT',current}),'/workspace').data.current,current);
});
