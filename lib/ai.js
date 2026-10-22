// 메모 → 주간보고 초안 (Claude API, 의존성 없이 fetch로 호출)
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const TOOL = {
  name: 'write_weekly_report',
  description: '업무 메모를 업무 항목별 주간보고 초안으로 정리해 제출한다.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            candidateKey: {
              type: ['string', 'null'],
              description: '후보 업무 목록의 key 중 이 내용에 해당하는 것. 맞는 게 없으면 null',
            },
            workName: { type: 'string', description: '후보에 없을 때 쓸 일반업무 이름 (짧게)' },
            thisWeek: { type: 'string', description: '금주 실적' },
            nextWeek: { type: 'string', description: '차주 계획' },
            issue: { type: 'string', description: '이슈/협조요청. 없으면 빈 문자열' },
          },
          required: ['candidateKey', 'workName', 'thisWeek', 'nextWeek', 'issue'],
        },
      },
      questions: {
        type: 'array',
        items: { type: 'string' },
        description: '메모만으로 판단이 안 돼 사용자 확인이 필요한 점 (없으면 빈 배열)',
      },
    },
    required: ['items', 'questions'],
  },
};

export function buildPrompt({ memo, me, period, candidates, examples, myLastWeek }) {
  const cand = candidates.map((c) => `- key=${c.key} | ${c.workName}${c.team ? ` (${c.team})` : ''}`).join('\n') || '(없음)';
  const ex = examples.map((e, i) =>
    `### 예시 ${i + 1}: ${e.workName}\n[금주]\n${e.thisWeek}\n[차주]\n${e.nextWeek}${e.issue ? `\n[이슈]\n${e.issue}` : ''}`
  ).join('\n\n');
  const last = myLastWeek.length
    ? myLastWeek.map((l) => `### ${l.workName}\n[지난주 실적]\n${l.thisWeek || '-'}\n[지난주에 쓴 차주 계획]\n${l.nextWeek || '-'}`).join('\n\n')
    : '(없음)';

  return `너는 ${me.departmentName} ${me.employeeName} ${me.gradeName}의 주간보고를 대신 정리하는 비서다.
대상 기간: ${period}

## 할 일
아래 "내 메모"를 읽고 업무 항목별로 금주 실적 / 차주 계획 / 이슈를 작성해 write_weekly_report 도구로 제출한다.

## 규칙
1. 형식은 "같은 본부 다른 사람들 보고 예시"와 똑같이 맞춘다. 대분류는 "# 제목", 중분류는 " * 항목", 세부는 "  - 내용" (공백 들여쓰기 그대로).
2. 문장은 예시처럼 명사형 개조식으로 짧게 끝낸다 (예: "~ 개발", "~ 대응", "~ 완료", "~ 진행 중"). 존댓말 문장 금지.
3. 메모에 없는 사실, 숫자, 날짜, 고객명을 지어내지 않는다. 애매하면 questions에 적는다.
4. 차주 계획이 메모에 없으면, 금주에 진행 중인 일의 자연스러운 다음 단계를 보수적으로 적되 지난주 기록과 어긋나지 않게 한다. 근거가 전혀 없으면 금주 진행 중인 항목을 "계속 진행"으로 둔다.
5. "작성자 : 이름" 머리말은 절대 넣지 않는다 (시스템이 붙인다).
6. 업무는 후보 목록에서 가장 맞는 key를 고른다. 어떤 후보에도 안 맞는 일은 candidateKey=null 로 두고 workName을 짧게 짓는다. 한 업무의 내용은 한 항목으로 합친다.
7. 이슈는 협조 요청·리스크가 메모에 있을 때만 쓰고 아니면 빈 문자열.

## 후보 업무 (이번 주 보고서에 있는 항목 + 내가 최근 쓴 항목)
${cand}

## 같은 본부 다른 사람들 보고 예시 (형식 참고용, 내용은 베끼지 말 것)
${ex || '(없음)'}

## 내가 지난주에 쓴 내용 (연속성 참고)
${last}

## 내 메모
${memo}`;
}

export async function draftReport(ctx) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY 환경변수를 설정하세요'), { code: 'NO_AI_KEY', status: 500 });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: buildPrompt(ctx) }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(`AI 호출 실패: ${data.error?.message || res.status}`), { code: 'AI_ERROR', status: 502 });
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (!block) throw Object.assign(new Error('AI 응답 형식이 올바르지 않습니다'), { code: 'AI_ERROR', status: 502 });
  return block.input;
}
