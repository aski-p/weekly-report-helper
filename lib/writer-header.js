// "작성자 : 이름 직급" 머리말 해석. 화면(src/sections.js)과 서버(lib/merge.js)가 같이 쓴다.
// 사람마다 쓰는 모양이 달라서 아래를 모두 같은 머리말로 본다.
//   작성자 : 홍길동 책임 / 1. 작성자 : 홍길동 책임 / - 작성자: 홍길동 / [작성자 : 홍길동팀장]

const HEADER_RE = /^\s*(?:\d{1,2}\s*[.)]\s*|[-*•·#]+\s*|\[\s*)?작성자\s*[:：]\s*(.+?)\s*\]?\s*$/;

// 이름에 붙여 쓴 직급을 떼어 내기 위한 목록 (긴 것부터)
const TITLES = ['부사장', '본부장', '센터장', '그룹장', '파트장', '실장', '팀장', '부장', '차장', '과장', '대리', '주임', '사원',
  '수석', '책임', '선임', '전임', '마스터', '매니저', '프로', '이사', '상무', '전무', '사장', '대표', 'PM', 'PL', 'PO', '님'];

// → { name, title } 또는 null
export function parseWriterHeader(line) {
  const m = String(line || '').match(HEADER_RE);
  if (!m) return null;
  let [name, ...rest] = m[1].trim().split(/\s+/);
  let title = rest.join(' ');
  if (!title) {
    const t = TITLES.find((x) => name.length > x.length + 1 && name.endsWith(x));
    if (t) { title = t; name = name.slice(0, -t.length); }
  }
  return name ? { name, title } : null;
}

// 머리말의 이름이 이 사람 것인가 (직급을 붙여 쓴 경우도)
export const isWriter = (header, name) => !!header && !!name && header.name === name;
