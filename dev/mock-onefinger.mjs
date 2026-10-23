// 개발용 가짜 OneFinger API (실제 계정 없이 화면을 돌려보기 위함). 배포에는 포함되지 않는다.
//   node dev/mock-onefinger.mjs  →  http://localhost:4010/api/v1
//   ONEFINGER_API=http://localhost:4010/api/v1 node server.js
// 응답 모양은 lib/onefinger.js 가 기대하는 필드에 맞춘 추정치다.
import http from 'node:http';
import { generateKeyPairSync } from 'node:crypto';

const PORT = +process.env.MOCK_PORT || 4010;
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

const ME = { employeeId: 101, employeeName: '홍길동', gradeName: '책임', departmentName: '디지털금융팀', buId: 7, buName: '금융사업본부' };
const PEOPLE = {
  101: ME,
  102: { employeeId: 102, employeeName: '김민지', gradeName: '선임', departmentName: '디지털금융팀' },
  103: { employeeId: 103, employeeName: '박준호', gradeName: '수석', departmentName: '플랫폼팀' },
  104: { employeeId: 104, employeeName: '이서연', gradeName: '책임', departmentName: '플랫폼팀' },
};
const writer = (id) => ({ employeeId: id, employeeName: PEOPLE[id].employeeName, gradeName: PEOPLE[id].gradeName });

// 2026년 기준 ISO 주차 (월~일)
function weekInfo(offset) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const th = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 3);
  const jan4 = new Date(th.getFullYear(), 0, 4);
  const week = 1 + Math.round(((th - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { year: th.getFullYear(), week, from: iso(mon), to: iso(sun), isCurrent: offset === 0 };
}

let nextItemId = 1000;
const reports = new Map(); // `${year}-${week}` → report
function seed(offset, items, extra = {}) {
  const w = weekInfo(offset);
  reports.set(`${w.year}-${w.week}`, {
    weeklyReportId: 500 + reports.size, year: w.year, week: w.week, buId: ME.buId, buName: ME.buName,
    statusCode: offset < -1 ? 'CONFIRMED' : 'WRITING', confirmed: offset < -1,
    updatedAt: new Date(Date.now() + offset * 7 * 864e5).toISOString(),
    ...extra,
    items: items.map((i, n) => ({ weeklyReportItemId: nextItemId++, sortOrder: n + 1, updatedAt: new Date(Date.now() + offset * 7 * 864e5 - n * 36e5).toISOString(), issue: '', ...i })),
  });
}

seed(-2, [
  { workKindCode: 'P', workId: 9001, workName: '기업은행 퇴직연금 고도화', ownerTeamName: '디지털금융팀', writers: [writer(101), writer(102)],
    thisWeek: '작성자 : 홍길동 책임\n\n# 기업은행 퇴직연금 고도화\n * 화면 개선\n  - IRP 가입 화면 설계 완료\n\n작성자 : 김민지 선임\n\n# 통합테스트 준비\n * 시나리오 작성\n  - 테스트 시나리오 40건 작성 완료',
    nextWeek: '작성자 : 홍길동 책임\n\n# 기업은행 퇴직연금 고도화\n * 화면 개선\n  - IRP 가입 화면 개발 착수\n\n작성자 : 김민지 선임\n\n# 통합테스트\n  - 1차 통합테스트 수행' },
]);
seed(-1, [
  { workKindCode: 'P', workId: 9001, workName: '기업은행 퇴직연금 고도화', ownerTeamName: '디지털금융팀', writers: [writer(101), writer(102)],
    thisWeek: '작성자 : 홍길동 책임\n\n# 기업은행 퇴직연금 고도화\n * 화면 개선\n  - IRP 가입 화면 3건 개발 완료\n  - 연금 수령 조회 화면 성능 개선 진행 중\n\n작성자 : 김민지 선임\n\n# 통합테스트\n * 1차 통합테스트\n  - 결함 12건 중 10건 조치 완료',
    nextWeek: '작성자 : 홍길동 책임\n\n# 기업은행 퇴직연금 고도화\n * 화면 개선\n  - IRP 가입 화면 3건 배포\n  - 연금 수령 조회 화면 성능 개선 완료\n\n작성자 : 김민지 선임\n\n# 통합테스트\n  - 잔여 결함 2건 조치' },
  { workKindCode: 'S', workId: 7002, workName: '군인라운지 운영', ownerTeamName: '디지털금융팀', writers: [writer(101)],
    thisWeek: '# 군인라운지 운영\n * 정기 점검\n  - 서버 패치 적용 완료', nextWeek: '# 군인라운지 운영\n * 장애 대응\n  - 파일 업로드 오류 원인 분석' },
  { workKindCode: 'P', workId: 9100, workName: '차세대 인증 플랫폼', ownerTeamName: '플랫폼팀', writers: [writer(103)],
    thisWeek: '# 차세대 인증 플랫폼\n * 설계\n  - 토큰 발급 구조 설계 검토 완료\n  - 키 관리 정책 초안 작성\n * 인프라\n  - 스테이징 클러스터 구성 완료 (10/14)', nextWeek: '# 차세대 인증 플랫폼\n * 개발\n  - 토큰 발급 API 개발 착수' },
], { confirmed: false });
seed(0, [
  { workKindCode: 'P', workId: 9001, workName: '기업은행 퇴직연금 고도화', ownerTeamName: '디지털금융팀', writers: [writer(102)],
    thisWeek: '작성자 : 김민지 선임\n\n# 통합테스트\n * 1차 통합테스트\n  - 잔여 결함 2건 조치 완료\n  - 2차 통합테스트 시나리오 보완', nextWeek: '작성자 : 김민지 선임\n\n# 통합테스트\n  - 2차 통합테스트 수행' },
  { workKindCode: 'P', workId: 9100, workName: '차세대 인증 플랫폼', ownerTeamName: '플랫폼팀', writers: [writer(103), writer(104)],
    thisWeek: '작성자 : 박준호 수석\n\n# 차세대 인증 플랫폼\n * 개발\n  - 토큰 발급 API 1차 개발 완료\n\n작성자 : 이서연 책임\n\n# 키 관리\n * HSM 연동\n  - 벤더 기술 검토 회의 (10/21)\n  - 연동 규격서 수령',
    nextWeek: '작성자 : 박준호 수석\n\n# 차세대 인증 플랫폼\n * 개발\n  - 토큰 갱신 API 개발\n\n작성자 : 이서연 책임\n\n# 키 관리\n  - HSM 연동 PoC 착수', issue: '작성자 : 이서연 책임\n\nHSM 장비 반입 일정 확정 필요 (인프라팀 협조)' },
  { workKindCode: 'G', workId: null, workName: '팀 주간회의', ownerTeamName: '플랫폼팀', writers: [], thisWeek: '', nextWeek: '' },
]);

const WORKS = [
  { workId: 9001, workName: '기업은행 퇴직연금 고도화', workTypeCode: 'P', externalCode: 'P-26-031' },
  { workId: 9100, workName: '차세대 인증 플랫폼', workTypeCode: 'P', externalCode: 'P-26-044' },
  { workId: 7002, workName: '군인라운지 운영', workTypeCode: 'S', externalCode: 'S-0712' },
  { workId: 7010, workName: '모바일뱅킹 유지보수', workTypeCode: 'S', externalCode: 'S-0730' },
];

const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(data == null ? '' : JSON.stringify(data)); };
const err = (res, status, code, message) => send(res, status, { code, message });

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/^\/api\/v1/, '');
    const body = raw ? JSON.parse(raw) : {};
    const authed = /^Bearer mock-token(-\d+)?$/.test(req.headers.authorization || '');
    let m;

    if (req.method === 'GET' && p === '/auth/public-key') return send(res, 200, { publicKey });
    // 사번 1001~1004 → 사람 101~104 (그 밖은 홍길동). 토큰에 사람 id 를 담는다.
    if (req.method === 'POST' && p === '/auth/login') {
      if (!body.employeeNo) return err(res, 400, 'AUTH_INVALID', 'bad');
      const id = PEOPLE[+body.employeeNo - 900] ? +body.employeeNo - 900 : ME.employeeId;
      return send(res, 200, { accessToken: `mock-token-${id}` });
    }
    if (!authed) return err(res, 401, 'UNAUTHORIZED', '로그인이 필요합니다');
    const who = { ...ME, ...PEOPLE[+(req.headers.authorization.match(/mock-token-(\d+)/)?.[1] || ME.employeeId)] };

    if (req.method === 'GET' && p === '/auth/me') return send(res, 200, who);
    if (req.method === 'POST' && p === '/auth/logout') return send(res, 204);
    if (req.method === 'GET' && p === '/weekly-reports/weeks') {
      const count = +url.searchParams.get('count') || 8, ahead = +url.searchParams.get('ahead') || 0;
      return send(res, 200, Array.from({ length: count + ahead }, (_, i) => weekInfo(ahead - i)));
    }
    if (req.method === 'GET' && (m = p.match(/^\/weekly-reports\/(\d+)\/(\d+)\/(\d+)$/))) {
      const r = reports.get(`${m[1]}-${m[2]}`);
      return r ? send(res, 200, r) : err(res, 404, 'NOT_FOUND', '보고서 없음');
    }
    if (req.method === 'POST' && p === '/weekly-reports') {
      const k = `${body.year}-${body.week}`;
      if (reports.has(k)) return err(res, 409, 'REPORT_EXISTS', 'exists');
      reports.set(k, { weeklyReportId: 500 + reports.size, year: body.year, week: body.week, buId: ME.buId, statusCode: 'WRITING', confirmed: false, updatedAt: new Date().toISOString(), items: [] });
      return send(res, 200, reports.get(k));
    }
    const rep = (id) => [...reports.values()].find((r) => r.weeklyReportId === +id);
    if (req.method === 'POST' && (m = p.match(/^\/weekly-reports\/(\d+)\/items$/))) {
      const r = rep(m[1]);
      r.items.push({ weeklyReportItemId: nextItemId++, ownerTeamName: ME.departmentName, writers: [], issue: '', updatedAt: new Date().toISOString(), ...body });
      return send(res, 200, r.items.at(-1));
    }
    if ((m = p.match(/^\/weekly-reports\/(\d+)\/items\/(\d+)(\/lock)?$/))) {
      const item = rep(m[1])?.items.find((i) => i.weeklyReportItemId === +m[2]);
      if (!item) return err(res, 404, 'NOT_FOUND', 'item');
      if (m[3]) return send(res, 204);
      if(req.method==='DELETE'){const r=rep(m[1]);r.items=r.items.filter(i=>i!==item);return send(res,204);}
      if (req.method === 'PUT') {
        Object.assign(item, { thisWeek: body.thisWeek, nextWeek: body.nextWeek, issue: body.issue, updatedAt: new Date().toISOString() });
        if (!item.writers.some((w) => w.employeeId === ME.employeeId)) item.writers.push(writer(ME.employeeId));
        rep(m[1]).updatedAt = item.updatedAt;
        return send(res, 200, item);
      }
    }
    if (req.method === 'GET' && p === '/works') {
      const q = (url.searchParams.get('q') || '').toLowerCase(), t = url.searchParams.get('workTypeCode');
      return send(res, 200, { items: WORKS.filter((w) => w.workTypeCode === t && (!q || w.workName.toLowerCase().includes(q))) });
    }
    err(res, 404, 'NOT_FOUND', `mock: ${req.method} ${p}`);
  });
}).listen(PORT, () => console.log(`mock OneFinger http://localhost:${PORT}/api/v1`));
