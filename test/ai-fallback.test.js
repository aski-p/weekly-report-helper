import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// 가짜 OpenAI 호환 서버: 정해 둔 답을 차례로 돌려준다
async function fakeAI(replies) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(replies[Math.min(seen.length - 1, replies.length - 1)]));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, seen, close: () => server.close() };
}
const textReply = (content) => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });
const toolReply = (args) => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ function: { name: 'write_weekly_report', arguments: JSON.stringify(args) } }] } }] });
const ctx = { memo: '기업은행 투자자산', me: { departmentName: '팀', employeeName: '홍길동', gradeName: '책임' }, period: '-', candidates: [], examples: [], myLastWeek: [] };
const ASK = '메모가 한 줄뿐이라 내용을 확정할 수 없습니다.\n\n- P2026-034 | 26년 기업은행 자산관리\n\n아래를 알려주세요.\n1. 어떤 업무인지\n2. 금주 진행 내용';

test('글로 되물으면 한 번 더 도구로 내라고 요청하고, 그 답을 쓴다', async () => {
  const ai = await fakeAI([textReply(ASK), toolReply({ items: [{ candidateKey: null, workName: 'A', thisWeek: 'x', nextWeek: 'y', issue: '' }], questions: [] })]);
  process.env.AI_BASE_URL = ai.url;
  const { draftReport } = await import('../lib/ai.js');
  const r = await draftReport(ctx);
  ai.close();
  assert.equal(r.items.length, 1);
  assert.equal(ai.seen.length, 2);
  assert.equal(ai.seen[1].messages.at(-2).content, ASK); // 앞 답을 보여 주며
  assert.match(ai.seen[1].messages.at(-1).content, /write_weekly_report 도구로 제출/);
});

test('끝내 글로만 답하면 항목 없이 그 질문을 돌려준다 (오류 대신)', async () => {
  const ai = await fakeAI([textReply(ASK)]);
  process.env.AI_BASE_URL = ai.url;
  const { draftReport } = await import('../lib/ai.js');
  const r = await draftReport(ctx);
  ai.close();
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.questions, ['메모가 한 줄뿐이라 내용을 확정할 수 없습니다.', '어떤 업무인지', '금주 진행 내용']);
});
