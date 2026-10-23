import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecord, validDate } from '../pgx/data-api.js';
import { compactMeetings, meetingReportItem, weekRange } from '../lib/meeting-report.js';
test('real calendar dates only and meeting payload validation', () => {
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2026-10-23'), true);
  assert.throws(() => cleanRecord('meetings', {id:'test1',date:'2026-02-30'}));
  assert.throws(() => cleanRecord('meetings', {id:'test1',date:'2026-10-23',durationSec:-1}));
  assert.throws(() => cleanRecord('meetings', {id:'test1',date:'2026-10-23',summary:{topics:{}}}));
});
test('three meetings on one date produce exactly three short report bullets', async () => {
  const meetings = [1,2,3].map((n)=>({id:`test${n}`,date:'2026-10-23',title:`회의 ${n}`,summary:{reportMemo:`안건 ${n} 검토 및 후속 일정 확정`}}));
  const entries = await compactMeetings(meetings); const [item] = meetingReportItem(entries);
  assert.match(item.thisWeek, /10\/23 회의 \(3건\)/);
  assert.equal(item.thisWeek.split('\n').filter((s)=>s.startsWith('  - ')).length,3);
  for (const m of meetings) assert.ok(item.thisWeek.includes(m.title));
  assert.equal(item.nextWeek,''); assert.ok(item.thisWeek.length<600);
});
test('week dates include Monday/Sunday and handle year boundaries', () => {
  assert.deepEqual(weekRange(2026,43),{from:'2026-10-19',to:'2026-10-25'});
  assert.deepEqual(weekRange(2026,1),{from:'2025-12-29',to:'2026-01-04'});
  assert.throws(()=>weekRange(2026,54));
});
test('large meeting counts stay under the OneFinger field limit without dropping bullets', () => {
  const entries=Array.from({length:80},(_,i)=>({id:`test${i}`,date:'2026-10-23',title:`회의 ${i}`,text:'검토 '.repeat(60)}));
  const items=meetingReportItem(entries);
  assert.equal(items.flatMap((i)=>i.thisWeek.split('\n')).filter((s)=>s.startsWith('  - ')).length,80);
  assert.ok(items.every((i)=>i.thisWeek.length<=4000));
  assert.equal(new Set(items.map((i)=>i.workName)).size,items.length);
});
