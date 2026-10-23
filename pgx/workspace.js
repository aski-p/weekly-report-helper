import { validWorkspaceKey } from '../shared/workspace-keys.js';
const invalid = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code });
const record = (r) => ({ key: r.key, value: r.value, version: Number(r.version), updatedAt: +new Date(r.updated_at) });
export function createWorkspaceApi({ pool, readJson, send }) {
  return async (req, res, url, owner) => {
    if (req.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      if (!Number.isSafeInteger(since) || since < 0) throw invalid('동기화 위치가 올바르지 않습니다');
      const rows = (await pool.query('SELECT key,value,version,updated_at FROM workspace_documents WHERE owner_id=$1 AND version>$2 ORDER BY version LIMIT 101', [owner,since])).rows;
      const items = []; let bytes = 0;
      for (const row of rows.slice(0,100)) {
        const item = record(row), n = Buffer.byteLength(JSON.stringify(item));
        if (items.length && bytes + n > 2000000) break;
        bytes += n; items.push(item);
      }
      return send(res,200,{ items, cursor: items.at(-1)?.version || since, hasMore: rows.length > items.length });
    }
    if (req.method !== 'PUT') throw invalid('지원하지 않는 요청입니다',405);
    const body = await readJson(req);
    if (!body || !validWorkspaceKey(body.key) || !(body.value === null || typeof body.value === 'string') || (typeof body.value === 'string' && Buffer.byteLength(body.value) > 500000)) throw invalid('저장할 항목이나 내용이 올바르지 않습니다');
    if (!Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0 || (body.migration != null && typeof body.migration !== 'boolean')) throw invalid('자료 버전이 올바르지 않습니다');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace:${owner}`]);
      const current = (await client.query('SELECT key,value,version,updated_at FROM workspace_documents WHERE owner_id=$1 AND key=$2 FOR UPDATE',[owner,body.key])).rows[0];
      if (current && body.migration) { await client.query('COMMIT'); return send(res,200,{ item: record(current), existed: true }); }
      if (body.baseVersion !== (current ? Number(current.version) : 0)) {
        await client.query('ROLLBACK');
        return send(res,409,{code:'SYNC_CONFLICT',message:'다른 기기에서 바뀐 내용이 있습니다. 두 내용을 확인해 주세요.',current: current ? record(current) : {key:body.key,value:null,version:0}});
      }
      if (!current) {
        const count = (await client.query('SELECT count(*)::int AS n FROM workspace_documents WHERE owner_id=$1',[owner])).rows[0].n;
        if (count >= 2000) throw invalid('저장 가능한 항목 수를 초과했습니다',400,'LIMIT');
      }
      const saved = (await client.query(`INSERT INTO workspace_documents(owner_id,key,value) VALUES($1,$2,$3)
        ON CONFLICT(owner_id,key) DO UPDATE SET value=$3,version=nextval('workspace_revision'),updated_at=now()
        RETURNING key,value,version,updated_at`,[owner,body.key,body.value])).rows[0];
      await client.query('COMMIT');
      return send(res,200,{item:record(saved)});
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  };
}
