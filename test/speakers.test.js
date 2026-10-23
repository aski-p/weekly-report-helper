import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendSpeech, transcriptText, speakerId, speakerList } from '../shared/speakers.js';
import { cleanRecord } from '../pgx/data-api.js';
import { buildSummaryPrompt } from '../lib/meeting.js';
import { minutesText } from '../src/meetings.js';
const meeting={id:'meeting1',date:'2026-10-23',transcript:'',speakerNames:{A:'참석자 가',B:'참석자 나'}};
const result={text:'일정을 확인합니다. 담당하겠습니다.',speakerState:'encrypted_state',duration:10,segments:[{start:1,end:4,speaker:'A',text:'일정을 확인합니다.'},{start:5,end:9,speaker:'B',text:'담당하겠습니다.'}]};
test('speaker labels retain their identity when names are assigned later',()=>{
  const m={...meeting,...appendSpeech(meeting,result,30)};
  assert.equal(m.segments[0].start,31);assert.equal(m.segments[1].speaker,'B');
  assert.match(transcriptText(m),/A \(참석자 가\)/);
  const renamed={...m,speakerNames:{A:'새 이름',B:'참석자 나'}};
  assert.match(transcriptText(renamed),/A \(새 이름\)/);
  assert.ok(!transcriptText(renamed).includes('참석자 가'));
  assert.equal(renamed.segments[0].text,'일정을 확인합니다.');
  assert.equal(renamed.speakerState,'encrypted_state');
});
test('speech appended after an upgrade preserves old unassigned transcript',()=>{
  const old={...meeting,transcript:'예전 녹취 내용'};
  const next=appendSpeech(old,result,60);
  assert.equal(next.segments[0].text,'예전 녹취 내용');assert.equal(next.segments[0].speaker,'');
  assert.equal(next.segments[1].speaker,'A');
});
test('old STT responses become unassigned speech instead of inventing a speaker',()=>{
  const next=appendSpeech(meeting,{text:'확인이 필요한 발언',duration:5},0);
  assert.equal(next.segments[0].speaker,'');assert.match(next.transcript,/화자 미확인/);
});
test('meeting DB validation preserves names, segments and encrypted continuation state',()=>{
  const input={...meeting,...appendSpeech(meeting,result,0)};
  const out=cleanRecord('meetings',input);
  assert.deepEqual(out.speakerNames,meeting.speakerNames);
  assert.equal(out.segments[1].speaker,'B');assert.equal(out.speakerState,'encrypted_state');
  assert.throws(()=>cleanRecord('meetings',{...input,speakerNames:{bad:'x'}}));
  assert.throws(()=>cleanRecord('meetings',{...input,segments:[{...input.segments[0],end:-1}]}));
});
test('summary input and exported minutes use the assigned names',()=>{
  const m={...meeting,...appendSpeech(meeting,result,0)};
  const prompt=buildSummaryPrompt({...m,me:{departmentName:'팀',employeeName:'작성자',gradeName:'담당'}});
  assert.match(prompt,/B \(참석자 나\): 담당하겠습니다/);
  const copied=minutesText({...m,summary:{title:'회의',summary:'일정 검토',decisions:[],topics:[],actionItems:[]}});
  assert.match(copied,/■ 발언별 녹취/);assert.match(copied,/참석자 가/);
  assert.deepEqual(speakerList(m),['A','B']);assert.equal(speakerId(26),'AA');
});
