// 회의록: 녹음 조각 → 글자 (PGX Whisper), 회의 전문 → 요약 (AI)
import { callTool } from './ai.js';
import { createHash } from 'node:crypto';
import { transcriptText, speakerList, speakerLabel } from '../shared/speakers.js';

const err = (message, code = 'STT_ERROR', status = 502) => Object.assign(new Error(message), { code, status });
export const sttReady = () => process.env.STT_ENABLED !== 'false' && !!process.env.AI_BASE_URL;
export const MAX_CHUNK_BYTES = 3 * 1024 * 1024; // Vercel 요청 한도(4.5MB) 안쪽, base64 고려

// audio: base64 문자열. PGX 프록시의 /v1/stt 로 그대로 넘긴다.
export async function transcribeChunk({ audio, mime, lang = 'ko', meetingId, speakerState = '' }, me) {
  if (!sttReady()) throw err('음성 인식 서버(AI_BASE_URL)가 설정되지 않았습니다', 'NO_STT', 500);
  const buf = Buffer.from(audio || '', 'base64');
  if (!buf.length) throw err('녹음 내용이 비어 있습니다', 'BAD_REQUEST', 400);
  if (buf.length > MAX_CHUNK_BYTES) throw err('녹음 조각이 너무 큽니다', 'BAD_REQUEST', 400);
  const headers = { 'content-type': mime || 'application/octet-stream' };
  if (process.env.AI_API_KEY) headers.authorization = `Bearer ${process.env.AI_API_KEY}`;
  if (typeof speakerState !== 'string' || speakerState.length > 64000) throw err('화자 연속 정보가 올바르지 않습니다', 'BAD_REQUEST', 400);
  if (meetingId != null && !/^[A-Za-z0-9_-]{4,40}$/.test(meetingId)) throw err('회의 ID가 올바르지 않습니다', 'BAD_REQUEST', 400);
  const session = meetingId && me ? createHash('sha256').update(JSON.stringify([String(me.employeeId), meetingId])).digest('hex') : '';
  if (speakerState) headers['x-wr-speaker-state'] = speakerState;
  let res;
  try {
    res = await fetch(`${process.env.AI_BASE_URL.replace(/\/+$/, '')}/stt?lang=${encodeURIComponent(lang)}&speaker_session=${session}`, {
      method: 'POST', headers, body: buf, signal: AbortSignal.timeout(50_000),
    });
  } catch (e) {
    throw err(e.name === 'TimeoutError' ? '음성 인식이 너무 오래 걸립니다' : '음성 인식 서버(PGX)에 연결하지 못했습니다');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw err(`음성 인식 실패: ${data.error?.message || res.status}`);
  return { text: data.text || '', duration: data.duration || 0, segments: Array.isArray(data.segments) ? data.segments : [], speakerState: data.speakerState || '', diarization: data.diarization === true };
}

const SUMMARY_TOOL = {
  name: 'write_meeting_minutes',
  description: '회의 녹취를 회의록으로 정리해 제출한다.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '회의 제목 (짧게). 주어진 제목이 있으면 그대로' },
      summary: { type: 'string', description: '3~6줄 핵심 요약. 명사형 개조식, 줄마다 "- "로 시작' },
      topics: {
        type: 'array',
        description: '논의 안건별 정리',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: '안건' },
            points: { type: 'array', items: { type: 'string' }, description: '논의 내용 (개조식)' },
          },
          required: ['topic', 'points'],
        },
      },
      decisions: { type: 'array', items: { type: 'string' }, description: '결정 사항 (없으면 빈 배열)' },
      actionItems: {
        type: 'array',
        description: '할 일 (없으면 빈 배열)',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string' },
            owner: { type: 'string', description: '담당자. 녹취에 없으면 빈 문자열' },
            due: { type: 'string', description: '기한. 녹취에 없으면 빈 문자열' },
          },
          required: ['task', 'owner', 'due'],
        },
      },
      reportMemo: { type: 'string', description: '이 회의를 내 주간보고 메모에 넣는다면 쓸 한두 줄 (예: "고객사 정기회의 참석, 2차 오픈 일정 11/20 확정")' },
    },
    required: ['title', 'summary', 'topics', 'decisions', 'actionItems', 'reportMemo'],
  },
};

export function buildSummaryPrompt({ me, title, date, attendees, notes, transcript, segments, speakerNames }) {
  return `너는 ${me.departmentName} ${me.employeeName} ${me.gradeName}의 회의록을 정리하는 비서다.
회의 날짜: ${date || '-'}
${title ? `회의 제목: ${title}\n` : ''}${attendees ? `참석자: ${attendees}\n` : ''}
## 할 일
아래 녹취(음성 인식 결과)와 메모를 읽고 write_meeting_minutes 도구로 회의록을 제출한다.

## 규칙
1. 음성 인식 결과라 오타·끊긴 문장·말버릇이 섞여 있다. 문맥으로 바로잡되, 확실하지 않은 고유명사·숫자는 녹취 표기를 그대로 쓴다.
2. 녹취와 메모에 없는 사실, 숫자, 날짜, 담당자를 지어내지 않는다.
3. 문장은 명사형 개조식으로 짧게 끝낸다 (예: "~ 확정", "~ 검토 필요", "~ 공유 예정"). 존댓말 문장 금지.
4. 결정 사항은 실제로 합의된 것만, 할 일은 누가 하기로 한 것만 적는다.
5. 잡담·인사·음향 확인 같은 내용은 뺀다.
6. A·B·C는 음성으로 구분한 화자다. 아래 이름 대응표가 있으면 지정된 이름을 쓰고, 미지정 화자는 알파벳 그대로 쓴다. 미확인 화자의 이름을 추측하지 않는다. 담당자는 해당 화자가 실제로 맡기로 한 일만 적는다.

## 화자 이름 대응표
${speakerList({ segments, speakerNames }).map((id) => speakerLabel(id, speakerNames)).join('\n') || '(미지정)'}

## 메모
${notes?.trim() || '(없음)'}

## 녹취
${transcriptText({ transcript, segments, speakerNames })}`;
}

export async function summarizeMeeting(input) {
  if (!transcriptText(input).trim() && !input.notes?.trim()) throw err('요약할 녹취나 메모가 없습니다', 'BAD_REQUEST', 400);
  const t = await callTool(buildSummaryPrompt({ ...input, transcript: input.transcript?.trim() || '(녹취 없음)' }), SUMMARY_TOOL, 4096);
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    title: (t.title || input.title || '회의').trim().slice(0, 80),
    summary: t.summary || '',
    topics: arr(t.topics).map((x) => ({ topic: x.topic || '', points: arr(x.points) })),
    decisions: arr(t.decisions),
    actionItems: arr(t.actionItems).map((a) => ({ task: a.task || '', owner: a.owner || '', due: a.due || '' })),
    reportMemo: t.reportMemo || '',
  };
}
