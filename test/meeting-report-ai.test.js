import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
let reply;
const calls = [];
const server = http.createServer((req,res)=>{let raw='';req.on('data',(d)=>raw+=d);req.on('end',()=>{calls.push(JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'compact_meetings',arguments:JSON.stringify(reply)}}]}}]}));});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
process.env.AI_BASE_URL=`http://127.0.0.1:${server.address().port}/v1`;
const { compactMeetings, meetingReportItem } = await import('../lib/meeting-report.js');
const records=[1,2,3].map(n=>({id:`meeting${n}`,title:`회의${n}`,date:'2026-10-23',notes:`안건${n} 검토`,transcript:'',summary:null}));
test('unsummarized meetings use AI and stay one bullet per source, even out of order',async()=>{
  reply={meetings:[3,1,2].map(n=>({id:`meeting${n}`,text:`안건${n} 검토 및 일정 협의`}))};
  const entries=await compactMeetings(records);
  assert.deepEqual(entries.map(m=>m.id),records.map(m=>m.id));
  assert.equal(meetingReportItem(entries)[0].thisWeek.split('\n').filter(s=>s.startsWith('  - ')).length,3);
  assert.match(calls[0].messages[0].content,/회의 3건이면 3개 항목/);
});
test('a missing meeting in the AI result fails visibly instead of silently dropping it',async()=>{
  reply={meetings:[{id:'meeting1',text:'안건1 검토'}]};
  await assert.rejects(compactMeetings(records),{code:'MEETING_SUMMARY_INCOMPLETE'});
});
process.on('beforeExit',()=>server.close());
// Close after the last test instead of keeping the test runner alive.
test('close mock provider',async()=>{await new Promise(r=>server.close(r));});
