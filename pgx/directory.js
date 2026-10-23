// Accept only app-server-signed OneFinger directory results. Never receive its login token.
export const ensureDirectoryTables = (pool) => pool.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_no text NOT NULL DEFAULT '';
  ALTER TABLE users ALTER COLUMN last_seen DROP NOT NULL;
`);

export function createDirectoryOperations({ pool, verifyTicket, notify, buColumn = 'bu_name' }) {
  if (!['bu_name', 'bu'].includes(buColumn)) throw new Error('Unsupported department schema');
  const invalid = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
  return {
    async directory({ me }, { tickets }) {
      if (!Array.isArray(tickets) || !tickets.length || tickets.length > 30) throw invalid('직원 검색 결과가 올바르지 않습니다');
      const employees = tickets.map((token) => {
        const claims = verifyTicket(token), e = claims?.employee;
        if (!claims || claims.purpose !== 'employee-directory' || String(claims.sub) !== String(me.id) || !e || e.id === 'qwen-bot' || !/^[A-Za-z0-9_.-]{1,40}$/.test(e.id || '')) throw invalid('직원 검색 결과가 만료되었거나 계정이 변경되었습니다', 'FORBIDDEN');
        for (const [key, max] of Object.entries({ name: 100, employeeNo: 40, grade: 100, department: 200, bu: 200 })) if (typeof e[key] !== 'string' || e[key].length > max) throw invalid('직원 정보가 올바르지 않습니다');
        if (!e.name.trim()) throw invalid('직원 이름이 없습니다');
        return e;
      });
      const client = await pool.connect();
      const users = [];
      try {
        await client.query('BEGIN');
        for (const e of employees) {
          const { rows: [r] } = await client.query(`INSERT INTO users(employee_id,name,employee_no,grade,department,${buColumn},last_seen)
            VALUES ($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT(employee_id) DO UPDATE SET name=$2,employee_no=$3,grade=$4,department=$5,${buColumn}=$6 RETURNING *`,
          [e.id,e.name,e.employeeNo,e.grade,e.department,e.bu]);
          users.push({ id: r.employee_id, name: r.name, employeeNo: r.employee_no, grade: r.grade, department: r.department, bu: r[buColumn], avatar: r.avatar || '', lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null });
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      for (const user of users) notify([String(me.id)], { ev: 'user', user });
      return users;
    },
  };
}
