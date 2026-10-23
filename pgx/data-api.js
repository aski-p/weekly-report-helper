// Mounted by the private PGX server. Connections and ticket verification stay private.
import { readFile } from 'node:fs/promises';
import { transcriptText } from '../shared/speakers.js';
const ID = /^[A-Za-z0-9_-]{4,40}$/;
const invalid = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code });
const text = (v, max) => { if (typeof v !== 'string' || v.length > max) throw invalid(`문자열은 ${max}자 이하로 입력하세요`); return v; };
const optional = (v, max) => text(v ?? '', max);
export function validDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}
const date = (v) => { if (!validDate(v)) throw invalid('올바른 회의 날짜를 선택하세요'); return v; };
const time = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 8640000000000000 ? new Date(n) : new Date(); };
export function cleanRecord(kind, t) {
  if (!t || typeof t !== 'object' || Array.isArray(t) || !ID.test(t.id || '')) throw invalid('올바른 저장 ID가 필요합니다');
  const common = { id: t.id, createdAt: time(t.createdAt) };
  if (kind === 'templates') {
    const v = Object.fromEntries(Object.entries({ name: 60, thisWeek: 4000, nextWeek: 4000, issue: 4000, style: 500, origin: 200 }).map(([k, n]) => [k, optional(t[k], n)]));
    if (!v.name.trim()) throw invalid('양식 이름을 입력하세요');
    return { ...common, ...v, name: v.name.trim() };
  }
  const speakerNames = {};
  if (t.speakerNames != null && (typeof t.speakerNames !== 'object' || Array.isArray(t.speakerNames) || Object.keys(t.speakerNames).length > 100)) throw invalid('화자 이름 목록이 올바르지 않습니다');
  for (const [id, name] of Object.entries(t.speakerNames || {})) {
    if (!/^[A-Z]{1,2}$/.test(id)) throw invalid('화자는 A, B와 같은 알파벳으로 지정하세요');
    speakerNames[id] = text(name, 80).trim();
  }
  if (t.segments != null && (!Array.isArray(t.segments) || t.segments.length > 5000)) throw invalid('발언 목록이 올바르지 않습니다');
  const segments = (t.segments || []).map((s) => {
    if (!s || !ID.test(s.id || '') || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start || s.end > 31536000 || (s.speaker !== '' && !/^[A-Z]{1,2}$/.test(s.speaker))) throw invalid('발언의 시각 또는 화자가 올바르지 않습니다');
    return { id: s.id, start: s.start, end: s.end, speaker: s.speaker, text: text(s.text, 200000) };
  });
  const transcript = segments.length ? text(transcriptText({ segments }, false), 200000) : optional(t.transcript, 200000);
  const speakerState = optional(t.speakerState, 64000);
  if (!/^[A-Za-z0-9_=\-]*$/.test(speakerState)) throw invalid('화자 연속 정보가 올바르지 않습니다');
  const durationSec = Number(t.durationSec ?? 0);
  if (!Number.isInteger(durationSec) || durationSec < 0 || durationSec > 31536000) throw invalid('녹음 시간이 올바르지 않습니다');
  let summary = null;
  if (t.summary != null) {
    if (typeof t.summary !== 'object' || Array.isArray(t.summary) || Buffer.byteLength(JSON.stringify(t.summary)) > 100000) throw invalid('회의 요약이 너무 크거나 올바르지 않습니다');
    const s = t.summary;
    const strings = (v) => { if (v == null) return []; if (!Array.isArray(v) || v.length > 100) throw invalid('요약 항목이 올바르지 않습니다'); return v.map((x) => text(x, 4000)); };
    if (s.topics != null && (!Array.isArray(s.topics) || s.topics.length > 100)) throw invalid('안건이 올바르지 않습니다');
    if (s.actionItems != null && (!Array.isArray(s.actionItems) || s.actionItems.length > 100)) throw invalid('할 일이 올바르지 않습니다');
    summary = { title: optional(s.title, 200), summary: optional(s.summary, 12000), reportMemo: optional(s.reportMemo, 2000),
      decisions: strings(s.decisions), topics: (s.topics || []).map((x) => ({ topic: optional(x?.topic, 500), points: strings(x?.points) })),
      actionItems: (s.actionItems || []).map((x) => ({ task: optional(x?.task, 4000), owner: optional(x?.owner, 200), due: optional(x?.due, 200) })), at: Number(s.at) || 0 };
  }
  return { ...common, date: date(t.date), title: optional(t.title, 200), attendees: optional(t.attendees, 2000), notes: optional(t.notes, 30000), transcript, durationSec, summary, segments, speakerNames, speakerState };
}
const row = (kind, r) => kind === 'templates'
  ? { id: r.id, name: r.name, thisWeek: r.this_week, nextWeek: r.next_week, issue: r.issue, style: r.style, origin: r.origin, createdAt: +new Date(r.created_at), updatedAt: +new Date(r.updated_at) }
  : { id: r.id, date: r.date, title: r.title, attendees: r.attendees, notes: r.notes, transcript: r.transcript, durationSec: r.duration_sec, summary: r.summary, segments: r.segments || [], speakerNames: r.speaker_names || {}, speakerState: r.speaker_state || '', createdAt: +new Date(r.created_at), updatedAt: +new Date(r.updated_at) };
export const ensureDataTables = async (pool) => pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
async function bodyOf(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3500000) throw invalid('저장할 내용이 너무 큽니다', 413);
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { throw invalid('JSON 형식이 올바르지 않습니다'); }
}
const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
export function createDataApi({ pool, verifyTicket }) {
  return async (req, res, url, kind) => {
    try {
      const claims = verifyTicket(req.headers['x-wr-ticket']);
      if (!claims) throw invalid('다시 로그인하세요', 401, 'UNAUTHORIZED');
      const owner = String(claims.sub);
      const isMeeting = kind === 'meetings';
      if (!isMeeting && kind !== 'templates') throw invalid('없는 저장소입니다', 404);
      if (req.method === 'GET') {
        if (!isMeeting) {
          const r = await pool.query('SELECT * FROM templates WHERE owner_id=$1 ORDER BY created_at DESC', [owner]);
          return send(res, 200, r.rows.map((r) => row(kind, r)));
        }
        const params = [owner]; const where = ['owner_id=$1'];
        for (const [key, op] of [['from', '>='], ['to', '<=']]) if (url.searchParams.has(key)) { params.push(date(url.searchParams.get(key))); where.push(`meeting_date ${op} $${params.length}::date`); }
        const cursor = url.searchParams.get('cursor');
        if (cursor) {
          let c; try { c = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { throw invalid('목록 위치가 올바르지 않습니다'); }
          if (!c || !ID.test(c.id || '')) throw invalid('목록 위치가 올바르지 않습니다');
          params.push(date(c.date), c.id); where.push(`(meeting_date,id) < ($${params.length - 1}::date,$${params.length})`);
        }
        const r = await pool.query(`SELECT *, to_char(meeting_date,'YYYY-MM-DD') AS date FROM meetings WHERE ${where.join(' AND ')} ORDER BY meeting_date DESC,id DESC LIMIT 21`, params);
        const items = []; let bytes = 0;
        for (const record of r.rows.slice(0, 20)) {
          const item = row(kind, record); const n = Buffer.byteLength(JSON.stringify(item));
          if (items.length && bytes + n > 2000000) break;
          bytes += n; items.push(item);
        }
        const last = items.at(-1);
        return send(res, 200, { items, nextCursor: last && r.rows.length > items.length ? Buffer.from(JSON.stringify({ date: last.date, id: last.id })).toString('base64url') : null });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!ID.test(id || '')) throw invalid('삭제할 ID가 필요합니다');
        await pool.query(`DELETE FROM ${kind} WHERE owner_id=$1 AND id=$2`, [owner, id]);
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'PUT') throw invalid('지원하지 않는 요청입니다', 405);
      const body = await bodyOf(req);
      const raw = isMeeting ? body.meeting : body.template;
      const batch = isMeeting ? body.meetings : body.templates;
      const list = batch ?? [raw];
      if (!Array.isArray(list) || !list.length || list.length > 100) throw invalid('저장 목록이 올바르지 않습니다');
      const records = list.map((t) => cleanRecord(kind, t));
      const client = await pool.connect();
      const saved = [];
      try {
        await client.query('BEGIN');
        // Serialize writes for one owner, including limit checks and migration batches.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`wr:${kind}:${owner}`]);
        const limit = isMeeting ? 5000 : 100;
        const count = await client.query(`SELECT count(*)::int AS n FROM ${kind} WHERE owner_id=$1`, [owner]);
        let remaining = limit - count.rows[0].n;
        for (const t of records) {
          const exists = await client.query(`SELECT 1 FROM ${kind} WHERE owner_id=$1 AND id=$2`, [owner, t.id]);
          if (!exists.rowCount && remaining-- <= 0) throw invalid(`${isMeeting ? '회의록' : '양식'}은 ${limit}개까지 저장할 수 있습니다`, 400, 'LIMIT');
          // Old local records never overwrite a copy already saved on another device.
          if (batch && exists.rowCount) continue;
          if (isMeeting) {
            const r = await client.query(`INSERT INTO meetings (owner_id,id,meeting_date,title,attendees,notes,transcript,duration_sec,summary,created_at,segments,speaker_names,speaker_state)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
              ON CONFLICT (owner_id,id) DO UPDATE SET meeting_date=$3,title=$4,attendees=$5,notes=$6,transcript=$7,duration_sec=$8,summary=$9,segments=$11,speaker_names=$12,speaker_state=$13,updated_at=now()
              RETURNING *,to_char(meeting_date,'YYYY-MM-DD') AS date`, [owner,t.id,t.date,t.title,t.attendees,t.notes,t.transcript,t.durationSec,t.summary,t.createdAt,JSON.stringify(t.segments),JSON.stringify(t.speakerNames),t.speakerState]);
            saved.push(row(kind, r.rows[0]));
          } else {
            const r = await client.query(`INSERT INTO templates (owner_id,id,name,this_week,next_week,issue,style,origin,created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
              ON CONFLICT (owner_id,id) DO UPDATE SET name=$3,this_week=$4,next_week=$5,issue=$6,style=$7,origin=$8,updated_at=now()
              WHERE templates.owner_id=$1 RETURNING *`, [owner,t.id,t.name,t.thisWeek,t.nextWeek,t.issue,t.style,t.origin,t.createdAt]);
            saved.push(row(kind, r.rows[0]));
          }
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      return send(res, 200, { items: saved });
    } catch (e) {
      if (!e.status) console.error('personal data API', e.code || e.message);
      send(res, e.status || 500, { code: e.status ? e.code : 'ERROR', message: e.status ? e.message : '저장소 오류가 발생했습니다' });
    }
  };
}
