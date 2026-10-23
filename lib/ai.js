// AI 호출 (의존성 없이 fetch)
// - AI_BASE_URL 이 있으면 OpenAI 호환 서버(PGX 의 Qwen 등)를 쓴다: AI_BASE_URL, AI_API_KEY, AI_MODEL
// - 없으면 Claude API: ANTHROPIC_API_KEY, ANTHROPIC_MODEL
const OPENAI = !!process.env.AI_BASE_URL;
export const MODEL = OPENAI ? (process.env.AI_MODEL || 'Qwen3.8-Flash-Next-EXL3') : (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5');
export const aiReady = () => (OPENAI ? !!process.env.AI_BASE_URL : !!process.env.ANTHROPIC_API_KEY);

const aiError = (message, code = 'AI_ERROR', status = 502) => Object.assign(new Error(message), { code, status });

const REPORT_TOOL = {
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

const TEMPLATE_TOOL = {
  name: 'save_template',
  description: '주간보고 글에서 내용은 빼고 구조(제목·항목 계층, 문체)만 뽑아 양식으로 저장한다.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '양식 이름 (짧게, 예: "개발팀 배포 보고형")' },
      thisWeek: { type: 'string', description: '금주 실적 칸의 뼈대. 원문의 들여쓰기·기호(#, *, -)를 그대로 두고 구체 내용은 {대괄호 설명}으로 바꾼다' },
      nextWeek: { type: 'string', description: '차주 계획 칸의 뼈대. 원문에 없으면 금주 뼈대와 같은 구조로' },
      issue: { type: 'string', description: '이슈 칸의 뼈대. 원문에 없으면 빈 문자열' },
      style: { type: 'string', description: '문체 규칙 한두 줄 (예: "명사형 개조식, ~완료/~진행 중으로 끝냄")' },
    },
    required: ['name', 'thisWeek', 'nextWeek', 'issue', 'style'],
  },
};

export function buildPrompt({ memo, me, period, candidates, examples, myLastWeek, template }) {
  const cand = candidates.map((c) => `- key=${c.key} | ${c.workName}${c.team ? ` (${c.team})` : ''}`).join('\n') || '(없음)';
  const ex = examples.map((e, i) =>
    `### 예시 ${i + 1}: ${e.workName}\n[금주]\n${e.thisWeek}\n[차주]\n${e.nextWeek}${e.issue ? `\n[이슈]\n${e.issue}` : ''}`
  ).join('\n\n');
  const last = myLastWeek.length
    ? myLastWeek.map((l) => `### ${l.workName}\n[지난주 실적]\n${l.thisWeek || '-'}\n[지난주에 쓴 차주 계획]\n${l.nextWeek || '-'}`).join('\n\n')
    : '(없음)';
  const tpl = template
    ? `\n## 내가 고른 양식 (이 구조와 문체를 최우선으로 따른다. {대괄호}는 메모 내용으로 채우고, 채울 내용이 없는 줄은 지운다)
[양식 이름] ${template.name}
[문체] ${template.style || '-'}
[금주 뼈대]
${template.thisWeek || '-'}
[차주 뼈대]
${template.nextWeek || '-'}${template.issue ? `\n[이슈 뼈대]\n${template.issue}` : ''}
`
    : '';

  return `너는 ${me.departmentName} ${me.employeeName} ${me.gradeName}의 주간보고를 대신 정리하는 비서다.
대상 기간: ${period}

## 할 일
아래 "내 메모"를 읽고 업무 항목별로 금주 실적 / 차주 계획 / 이슈를 작성해 write_weekly_report 도구로 제출한다.

## 규칙
1. 형식은 ${template ? '"내가 고른 양식"을 따르고, 양식에 없는 부분은 ' : ''}"같은 본부 다른 사람들 보고 예시"와 똑같이 맞춘다. 대분류는 "# 제목", 중분류는 " * 항목", 세부는 "  - 내용" (공백 들여쓰기 그대로).
2. 문장은 예시처럼 명사형 개조식으로 짧게 끝낸다 (예: "~ 개발", "~ 대응", "~ 완료", "~ 진행 중"). 존댓말 문장 금지.
3. 메모에 없는 사실, 숫자, 날짜, 고객명을 지어내지 않는다. 애매하면 questions에 적는다.
4. 차주 계획이 메모에 없으면, 금주에 진행 중인 일의 자연스러운 다음 단계를 보수적으로 적되 지난주 기록과 어긋나지 않게 한다. 근거가 전혀 없으면 금주 진행 중인 항목을 "계속 진행"으로 둔다.
5. "작성자 : 이름" 머리말은 절대 넣지 않는다 (시스템이 붙인다).
6. 업무는 후보 목록에서 가장 맞는 key를 고른다. 어떤 후보에도 안 맞는 일은 candidateKey=null 로 두고 workName을 짧게 짓는다. 한 업무의 내용은 한 항목으로 합친다.
7. 이슈는 협조 요청·리스크가 메모에 있을 때만 쓰고 아니면 빈 문자열.
8. 메모가 짧거나 모호해도 일반 문장으로 되묻지 말고 반드시 write_weekly_report 도구로 제출한다. 메모로 알 수 있는 만큼만 items 를 채우고(지어내지 말 것, 비어도 된다), 확인할 점은 questions 에 짧은 문장으로 넣는다.
${tpl}
## 후보 업무 (이번 주 보고서에 있는 항목 + 내가 최근 쓴 항목)
${cand}

## 같은 본부 다른 사람들 보고 예시 (형식 참고용, 내용은 베끼지 말 것)
${ex || '(없음)'}

## 내가 지난주에 쓴 내용 (연속성 참고)
${last}

## 내 메모
${memo}`;
}

export function buildTemplatePrompt({ text, workName, writer }) {
  return `아래는 회사 주간보고 시스템에 실제로 올라간 글이다${workName ? ` (업무: ${workName}${writer ? `, 작성자: ${writer}` : ''})` : ''}.
이 글의 "형식"만 양식으로 저장하려 한다. save_template 도구로 제출하라.

## 규칙
1. 제목·항목 계층(#, *, -, 번호)과 들여쓰기, 줄 순서는 원문 그대로 유지한다.
2. 고객명·숫자·날짜·시스템명 같은 구체 내용은 모두 {무엇을 쓰는 자리인지} 형태로 바꾼다. 예: "  - 기업은행 퇴직연금 화면 3건 배포" → "  - {고객사} {화면/기능} {건수} 배포"
3. 같은 모양이 반복되는 줄은 한 번만 남긴다.
4. "작성자 : 이름" 줄은 넣지 않는다.
5. 원문이 [금주]/[차주]/[이슈]로 나뉘어 있으면 각 칸에 맞게 나누고, 한 덩어리면 thisWeek 에 넣고 nextWeek 는 같은 구조로 만든다.

## 원문
${text}`;
}

// 도구 하나를 강제로 호출시켜 그 입력(JSON)을 돌려준다.
// textFallback: 모델이 끝내 도구 대신 일반 글로 답하면(되묻기 등) 그 글을 결과 모양으로 바꿔 돌려준다
export async function callTool(prompt, tool, maxTokens = 4096, { textFallback } = {}) {
  if (!aiReady()) throw aiError(OPENAI ? 'AI_BASE_URL 환경변수를 설정하세요' : 'ANTHROPIC_API_KEY 환경변수를 설정하세요', 'NO_AI_KEY', 500);
  return OPENAI ? callOpenAI(prompt, tool, maxTokens, textFallback) : callAnthropic(prompt, tool, maxTokens);
}

async function callAnthropic(prompt, tool, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw aiError(`AI 호출 실패: ${data.error?.message || res.status}`);
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (!block) throw aiError('AI 응답 형식이 올바르지 않습니다');
  return block.input;
}

// Vercel 함수 제한(60초) 안에 끝나도록 전체 50초에서 끊는다.
// 형식이 깨진 응답은 남은 시간이 넉넉할 때 한 번 더 받아본다. 도구 대신 글로 답했으면 그 글을 보여 주며 도구로 내라고 다시 요청한다.
async function callOpenAI(prompt, tool, maxTokens, textFallback) {
  const deadline = Date.now() + 50_000;
  const messages = [{ role: 'user', content: prompt }];
  const first = await requestOpenAI(messages, tool, maxTokens, 50_000);
  if (first.parsed) return first.parsed;
  const left = deadline - Date.now();
  let last = first;
  if (first.finish !== 'length' && left > 20_000) {
    const retry = first.text
      ? [...messages, { role: 'assistant', content: first.text },
        { role: 'user', content: `위 답은 ${tool.name} 도구로 제출되지 않았다. 일반 문장으로 되묻지 말고 반드시 ${tool.name} 도구로 제출하라. 확인이 필요한 점은 questions 에 짧게 넣는다.` }]
      : messages;
    last = await requestOpenAI(retry, tool, maxTokens, left);
    if (last.parsed) return last.parsed;
  }
  const text = last.text || first.text;
  if (textFallback && text) return textFallback(text);
  throw aiError(first.finish === 'length'
    ? 'AI 응답이 너무 길어 잘렸습니다. 내용을 나눠서 다시 시도하세요.'
    : 'AI 응답 형식이 올바르지 않습니다. 다시 시도하세요.');
}

async function requestOpenAI(messages, tool, maxTokens, timeoutMs) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.AI_API_KEY) headers.authorization = `Bearer ${process.env.AI_API_KEY}`;
  let res;
  try {
    res = await fetch(`${process.env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },
        tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
        tool_choice: { type: 'function', function: { name: tool.name } },
        messages,
      }),
    });
  } catch (e) {
    throw aiError(e.name === 'TimeoutError' ? 'AI 응답이 너무 오래 걸립니다. 메모를 나눠서 다시 시도하세요.' : 'AI 서버(PGX)에 연결하지 못했습니다');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw aiError(`AI 호출 실패: ${data.error?.message || res.status}`);
  const msg = data.choices?.[0]?.message || {};
  const call = (msg.tool_calls || []).find((c) => c.function?.name === tool.name);
  const raw = call ? call.function.arguments : msg.content;
  const finish = data.choices?.[0]?.finish_reason;
  const parsed = parseJSON(raw);
  if (!parsed) {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
    console.error('AI 응답 해석 실패', { tool: tool.name, finish, toolCall: !!call, length: text.length, head: text.slice(0, 300), tail: text.slice(-300) });
  }
  // 도구를 부르지 않고 글로만 답한 경우 (되묻기 등)
  const text = !call && typeof msg.content === 'string' ? msg.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
  return { parsed, finish, text };
}

// 인자가 문자열 JSON 이거나, 도구 호출 대신 본문에 JSON 을 쓴 경우까지 받아준다.
// 문자열 안의 날 줄바꿈·탭, 끝의 쉼표처럼 로컬 모델이 흔히 내는 실수는 고쳐서 읽는다.
export function parseJSON(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const body = s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  for (const t of [s, body, repairJSON(body)]) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === 'object') return v;
    } catch { /* 다음 */ }
  }
  return null;
}

function repairJSON(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { out += c + (s[++i] ?? ''); continue; }
      if (c === '"') inStr = false;
      else if (c === '\n') { out += '\\n'; continue; }
      else if (c === '\r') { out += '\\r'; continue; }
      else if (c === '\t') { out += '\\t'; continue; }
      else if (c < ' ') continue;
    } else if (c === '"') inStr = true;
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

// 모델이 끝내 글로만 되물으면 보고 항목 없이 그 질문을 "확인해 주세요" 로 보여 준다
export function textToQuestions(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // 번호·기호 목록만 질문으로 (후보 업무를 나열한 "key | 이름" 줄은 뺀다)
  const listed = lines.filter((l) => /^(\d+[.)]|[-•*])\s+/.test(l) && !l.includes('|')).map((l) => l.replace(/^(\d+[.)]|[-•*])\s+/, ''));
  const qs = listed.length ? [lines[0], ...listed.filter((l) => l !== lines[0])] : [text];
  return qs.slice(0, 8).map((q) => q.slice(0, 300));
}

export const draftReport = (ctx) => callTool(buildPrompt(ctx), REPORT_TOOL, 4096, {
  textFallback: (text) => ({ items: [], questions: textToQuestions(text) }),
});

export async function extractTemplate({ text, workName, writer }) {
  const t = await callTool(buildTemplatePrompt({ text, workName, writer }), TEMPLATE_TOOL, 2048);
  return {
    name: (t.name || workName || '새 양식').trim().slice(0, 40),
    thisWeek: t.thisWeek || '',
    nextWeek: t.nextWeek || '',
    issue: t.issue || '',
    style: t.style || '',
  };
}
