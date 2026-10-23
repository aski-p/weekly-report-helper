// 회의록: PGX에 사번별로 저장 + 녹음기 + 파일 → 조각 변환
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRemoteRecords } from './useRemoteRecords.js';

export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const fmtClock = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`; };

export function useMeetings(employeeId) {
  const { items: list, add, update: change, remove, status, error, retry, flush } = useRemoteRecords('meetings', employeeId);
  const create = useCallback((patch = {}) => add({ id: crypto.randomUUID(), date: todayISO(), title: '', attendees: '', notes: '', transcript: '', durationSec: 0, summary: null, createdAt: Date.now(), updatedAt: Date.now(), ...patch }), [add]);
  const update = useCallback((id, patch) => change(id, (m) => {
    const next = typeof patch === 'function' ? patch(m) : patch;
    return { ...(('notes' in next && next.notes !== m.notes) || ('transcript' in next && next.transcript !== m.transcript) ? { summary: null } : {}), ...next };
  }), [change]);
  return { list, create, update, remove, status, error, retry, flush };
}

// ───────── 녹음기: 30초마다 끊어 독립된 파일 조각으로 넘긴다 (조각마다 바로 글자로 바꾸기 위해)
const CHUNK_MS = 30_000;
const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
// 녹음 중(일시정지 포함)인 마이크. 앱 업데이트는 이게 비어 있을 때만 적용한다
const liveStreams = new Set();
export const isRecording = () => liveStreams.size > 0;

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

export function useRecorder({ onChunk }) {
  const [state, setState] = useState('idle'); // idle | recording | paused
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const r = useRef({});
  const cb = useRef(onChunk);
  cb.current = onChunk;

  const tick = useCallback(() => {
    const x = r.current;
    if (!x.analyser) return;
    const buf = new Uint8Array(x.analyser.fftSize);
    x.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    if (x.running) setElapsed(x.base + (Date.now() - x.since) / 1000);
    x.raf = requestAnimationFrame(tick);
  }, []);

  // 조각 하나 녹음 시작. 끝나면(stop) 완성된 파일을 넘기고, 녹음 중이면 다음 조각을 이어서 시작
  const startSegment = useCallback(() => {
    const x = r.current;
    const rec = new MediaRecorder(x.stream, x.mime ? { mimeType: x.mime, audioBitsPerSecond: 32000 } : undefined);
    const parts = [];
    const startAt = x.base + (x.running ? (Date.now() - x.since) / 1000 : 0);
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType || x.mime || 'audio/webm' });
      if (blob.size > 2000) cb.current?.({ blob, seq: x.seq++, start: startAt });
      if (x.running) startSegment();
    };
    rec.start();
    x.rec = rec;
    clearTimeout(x.cut);
    x.cut = setTimeout(() => rec.state === 'recording' && rec.stop(), CHUNK_MS);
  }, []);

  const start = useCallback(async (offsetSec = 0) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* 지원 안 함 */ }
    liveStreams.add(stream);
    r.current = { stream, ctx, analyser, wake, mime: pickMime(), seq: 0, base: offsetSec, since: Date.now(), running: true };
    setElapsed(offsetSec);
    setState('recording');
    startSegment();
    r.current.raf = requestAnimationFrame(tick);
  }, [startSegment, tick]);

  const pause = useCallback(() => {
    const x = r.current;
    if (!x.running) return;
    x.base += (Date.now() - x.since) / 1000;
    x.running = false;
    clearTimeout(x.cut);
    if (x.rec?.state === 'recording') x.rec.stop(); // 지금까지를 한 조각으로
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    const x = r.current;
    if (x.running || !x.stream) return;
    x.running = true;
    x.since = Date.now();
    setState('recording');
    startSegment();
  }, [startSegment]);

  const stop = useCallback(() => {
    const x = r.current;
    if (!x.stream) return 0;
    const total = x.base + (x.running ? (Date.now() - x.since) / 1000 : 0);
    x.running = false;
    clearTimeout(x.cut);
    if (x.rec?.state === 'recording') x.rec.stop();
    cancelAnimationFrame(x.raf);
    x.stream.getTracks().forEach((t) => t.stop());
    x.ctx?.close().catch(() => {});
    x.wake?.release?.().catch(() => {});
    liveStreams.delete(x.stream);
    r.current = {};
    setState('idle');
    setLevel(0);
    setElapsed(total);
    return total;
  }, []);

  // 화면을 떠나면 마이크를 놓는다
  useEffect(() => () => { const x = r.current; if (x.stream) { liveStreams.delete(x.stream); x.wake?.release?.().catch(() => {}); x.running = false; clearTimeout(x.cut); x.rec?.state === 'recording' && x.rec.stop(); x.stream.getTracks().forEach((t) => t.stop()); x.ctx?.close().catch(() => {}); cancelAnimationFrame(x.raf); } }, []);

  return { state, elapsed, level, start, pause, resume, stop };
}

// ───────── 녹음 파일 가져오기: 16kHz 모노로 바꿔 60초 WAV 조각으로 자른다
export async function fileToChunks(file, onProgress) {
  const arr = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try { decoded = await ctx.decodeAudioData(arr); } finally { ctx.close().catch(() => {}); }
  const SR = 16000;
  const length = Math.ceil(decoded.duration * SR);
  const off = new OfflineAudioContext(1, length, SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  onProgress?.('변환 중…');
  const mono = (await off.startRendering()).getChannelData(0);
  const per = SR * 60;
  const chunks = [];
  for (let i = 0, seq = 0; i < mono.length; i += per, seq++) chunks.push({ blob: wav(mono.subarray(i, i + per), SR), seq, start: i / SR });
  return { chunks, duration: decoded.duration };
}

function wav(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

export const blobToBase64 = (blob) => new Promise((ok, fail) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(',')[1] || '');
  fr.onerror = fail;
  fr.readAsDataURL(blob);
});

// 회의록 → 복사·공유용 글
export function minutesText(m) {
  const s = m.summary;
  const lines = [`[회의록] ${s?.title || m.title || '회의'}`, `일시: ${m.date}${m.durationSec ? ` (녹음 ${fmtClock(m.durationSec)})` : ''}`];
  if (m.attendees) lines.push(`참석: ${m.attendees}`);
  if (s) {
    lines.push('', '■ 요약', s.summary);
    if (s.topics?.length) { lines.push('', '■ 안건별 논의'); s.topics.forEach((t) => { lines.push(`* ${t.topic}`); t.points.forEach((p) => lines.push(`  - ${p}`)); }); }
    if (s.decisions?.length) { lines.push('', '■ 결정 사항'); s.decisions.forEach((d) => lines.push(`- ${d}`)); }
    if (s.actionItems?.length) { lines.push('', '■ 할 일'); s.actionItems.forEach((a) => lines.push(`- ${a.task}${a.owner ? ` / ${a.owner}` : ''}${a.due ? ` / ${a.due}` : ''}`)); }
  } else if (m.transcript) lines.push('', m.transcript);
  return lines.join('\n');
}
