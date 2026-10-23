import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { deleteReportItem } from '../lib/report-delete.js';
import { reportItemVersion, withoutOwnSections } from '../shared/report-items.js';
const me={employeeId:1,employeeName:'작성자 가',buId:7};
function fixture(patch={}){
 const item={weeklyReportItemId:10,workKindCode:'G',workName:'검증 업무',writers:[me],thisWeek:'검증 완료',nextWeek:'재확인 예정',issue:'',...patch};
 const report={weeklyReportId:20,items:[item]};let locks=0,unlocks=0,deleted=0,update;
 const api={getReport:async()=>report,lock:async()=>{locks++;},unlock:async()=>{unlocks++;},deleteItem:async()=>{deleted++;},updateItem:async(r,i,body)=>{update=body;}};
 return {api,item,report,input:()=>({year:2026,week:43,itemId:10,version:reportItemVersion(item)}),counts:()=>({locks,unlocks,deleted,update})};
}
test('a sole writer deletes their item under the existing edit lock',async()=>{
 const f=fixture();assert.equal((await deleteReportItem(f.api,me,f.input())).mode,'item');assert.deepEqual(f.counts(),{locks:1,unlocks:1,deleted:1,update:undefined});
});
test('another writer, closed report and stale preview cannot delete',async()=>{
 const other=fixture({writers:[{employeeId:2}]});await assert.rejects(deleteReportItem(other.api,me,other.input()),{status:403});assert.equal(other.counts().locks,0);
 const closed=fixture();closed.report.confirmed=true;await assert.rejects(deleteReportItem(closed.api,me,closed.input()),{code:'REPORT_CLOSED'});
 const stale=fixture();const input=stale.input();stale.item.thisWeek='changed';await assert.rejects(deleteReportItem(stale.api,me,input),{code:'REPORT_CHANGED'});assert.equal(stale.counts().deleted,0);
});
test('edits between initial read and lock acquisition are preserved',async()=>{
 const f=fixture();f.api.lock=async()=>{f.item.issue='other edit';};const input=f.input();await assert.rejects(deleteReportItem(f.api,me,input),{code:'REPORT_CHANGED'});assert.equal(f.counts().unlocks,1);assert.equal(f.counts().deleted,0);
});
test('shared item removal preserves other writers and unlabelled content in all fields',async()=>{
 const owner={...me,employeeName:'가명가'};
 const f=fixture({writers:[me,{employeeId:2,employeeName:'가명나'}],thisWeek:'기존 안내\n\n작성자 : 가명가 책임\n내 내용\n\n작성자 : 가명나 선임\n다른 내용',nextWeek:'작성자 : 가명나\n다른 계획',issue:'작성자 : 가명가\n내 이슈'});
 assert.equal((await deleteReportItem(f.api,owner,f.input())).mode,'section');
 assert.equal(f.counts().deleted,0);assert.match(f.counts().update.thisWeek,/기존 안내/);assert.match(f.counts().update.thisWeek,/다른 내용/);assert.ok(!f.counts().update.thisWeek.includes('내 내용'));assert.equal(f.counts().update.nextWeek,f.item.nextWeek);assert.equal(f.counts().update.issue,'');
});
test('unlabelled shared text is never guessed to be owned; failures release locks',async()=>{
 const f=fixture({writers:[me,{employeeId:2}]});await assert.rejects(deleteReportItem(f.api,me,f.input()),{code:'SECTION_UNCLEAR'});assert.equal(f.counts().unlocks,1);assert.equal(f.counts().deleted,0);
 const broken=fixture();broken.api.deleteItem=async()=>{throw Error('upstream');};await assert.rejects(deleteReportItem(broken.api,me,broken.input()));assert.equal(broken.counts().unlocks,1);
});
test('all duplicate own sections are removed, with other sections intact',()=>{
 assert.equal(withoutOwnSections('작성자 : 가명가\n첫째\n작성자 : 가명나\n유지\n작성자 : 가명가\n둘째','가명가'),'작성자 : 가명나\n유지');
});
test('real client and protected routes register then delete a weekly report item',async(t)=>{
 let report=null,nextId=1;const events=[];
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
  const path=req.url;events.push(req.method+' '+path);const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(value==null?'':JSON.stringify(value));};
  if(req.headers.authorization!=='Bearer test-token')return send(401,{code:'UNAUTHORIZED'});
  if(path==='/auth/me')return send(200,me);
  if(req.method==='GET'&&path==='/weekly-reports/2026/43/7')return send(report?200:404,report||{code:'NOT_FOUND'});
  if(req.method==='POST'&&path==='/weekly-reports'){if(report)return send(409,{code:'REPORT_EXISTS'});report={weeklyReportId:20,items:[]};return send(200,report);}
  if(req.method==='POST'&&path==='/weekly-reports/20/items'){report.items.push({...body,weeklyReportItemId:nextId++,writers:[me]});return send(200,report.items.at(-1));}
  if(path.endsWith('/lock'))return send(204);
  if(path==='/weekly-reports/20/items/1'&&req.method==='PUT'){Object.assign(report.items[0],body);return send(200,report.items[0]);}
  if(path==='/weekly-reports/20/items/1'&&req.method==='DELETE'){report.items=[];return send(204);}
  return send(404,{code:'NOT_FOUND'});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 process.env.ONEFINGER_API=`http://127.0.0.1:${server.address().port}`;
 const {handle}=await import('../lib/routes.js');const headers={authorization:'Bearer test-token','x-wr-account':'1'};
 const item={workKindCode:'G',workName:'검증 업무',thisWeek:'완료',nextWeek:'예정',issue:''};
 const call=(path,body,h=headers)=>handle({method:'POST',path,body,headers:h});
 assert.equal((await call('/commit',{year:2026,week:43,items:[item],dryRun:true})).data.results[0].mode,'new');assert.equal(report,null);
 assert.equal((await call('/commit',{year:2026,week:43,items:[item]})).data.results[0].ok,true);assert.equal(report.items[0].thisWeek,'완료');
 const body={year:2026,week:43,itemId:1,version:reportItemVersion(report.items[0])};
 assert.equal((await call('/report-items/delete',body,{'x-wr-account':'1'})).status,401);
 assert.equal((await call('/report-items/delete',body,{...headers,'x-wr-account':'2'})).status,409);
 assert.equal((await call('/report-items/delete',{...body,itemId:'../'})).status,400);
 assert.equal((await call('/report-items/delete',body)).status,200);assert.equal(report.items.length,0);assert.ok(events.includes('DELETE /weekly-reports/20/items/1'));
});
