export const speakerId = (index) => {
  let n = index + 1, out = '';
  while (n > 0) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); }
  return out;
};
export const speakerLabel = (id, names = {}) => id ? `${id}${names[id]?.trim() ? ` (${names[id].trim()})` : ''}` : '화자 미확인';
export const timeLabel = (seconds) => {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
export function transcriptText(meeting, withNames = true) {
  if (!meeting.segments?.length) return meeting.transcript || '';
  return meeting.segments.map((s) => `[${timeLabel(s.start)}] ${speakerLabel(s.speaker, withNames ? meeting.speakerNames : {})}: ${s.text}`).join('\n');
}
export function speakerList(meeting) {
  return [...new Set([...(meeting.segments || []).map((s) => s.speaker).filter(Boolean), ...Object.keys(meeting.speakerNames || {})])]
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
}
export function appendSpeech(meeting, result, offset = 0) {
  const entries = (result.segments?.length ? result.segments : result.text?.trim() ? [{start: 0, end: result.duration || 0, speaker: '', text: result.text.trim()}] : [])
    .filter((s) => s.text?.trim()).map((s) => ({ id: crypto.randomUUID(), start: offset + Math.max(0, Number(s.start) || 0), end: offset + Math.max(Number(s.start) || 0, Number(s.end) || 0), speaker: /^[A-Z]{1,2}$/.test(s.speaker) ? s.speaker : '', text: s.text.trim() }));
  // Preserve legacy text when a recording is resumed after upgrading the app.
  const old = meeting.segments?.length ? meeting.segments : meeting.transcript?.trim() ? [{id: crypto.randomUUID(), start: 0, end: offset, speaker: '', text: meeting.transcript.trim()}] : [];
  const next = { ...meeting, segments: [...old, ...entries], speakerState: result.speakerState || meeting.speakerState || '' };
  return { segments: next.segments, speakerState: next.speakerState, transcript: transcriptText(next, false) };
}
