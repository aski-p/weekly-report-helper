import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWriterHeader } from '../lib/writer-header.js';
import { mergeSection, extractMine } from '../lib/merge.js';
import { itemByWriter } from '../src/sections.js';

test('머리말 여러 모양', () => {
  assert.deepEqual(parseWriterHeader('작성자 : 홍길동 책임'), { name: '홍길동', title: '책임' });
  assert.deepEqual(parseWriterHeader('1. 작성자 : 한도윤 마스터'), { name: '한도윤', title: '마스터' });
  assert.deepEqual(parseWriterHeader('  - 작성자: 오세진'), { name: '오세진', title: '' });
  assert.deepEqual(parseWriterHeader('작성자 : 정민수팀장'), { name: '정민수', title: '팀장' });
  assert.deepEqual(parseWriterHeader('작성자 : 정민수 팀장'), { name: '정민수', title: '팀장' });
  assert.deepEqual(parseWriterHeader('[작성자 : 류하늘]'), { name: '류하늘', title: '' });
  assert.deepEqual(parseWriterHeader('작성자：최수석'), { name: '최수석', title: '' }); // 3글자 이름은 직급으로 자르지 않음
  assert.equal(parseWriterHeader('# 클라이언트 개발:8, 배포:5'), null);
  assert.equal(parseWriterHeader(' * 작성자 확인 요청 건'), null);
});

test('붙여 쓴 직급과 띄어 쓴 직급이 한 사람으로 묶인다', () => {
  const writers = [{ employeeId: 'E1', employeeName: '정민수', gradeName: '팀장' }, { employeeId: 'E2', employeeName: '한도윤', gradeName: '마스터' }];
  const item = {
    writers,
    thisWeek: '작성자 : 정민수팀장\n# A\n * 유지운영 대응\n\n1. 작성자 : 한도윤 마스터\n# B\n*개인스마트',
    nextWeek: '작성자 : 정민수 팀장\n# A\n * 유지운영 대응',
  };
  const out = itemByWriter(item);
  assert.deepEqual(out.map((s) => s.name), ['정민수', '한도윤']);
  assert.match(out[0].thisWeek, /# A/);
  assert.match(out[0].nextWeek, /# A/);
  assert.equal(out[0].title, '팀장');
  assert.match(out[1].thisWeek, /개인스마트/);
});

test('머리말이 없고 작성자가 여럿이면 작성자 미상, 한 명이면 그 사람', () => {
  assert.equal(itemByWriter({ writers: [{ employeeName: 'A' }, { employeeName: 'B' }], thisWeek: '내용' })[0].name, '작성자 미상');
  assert.equal(itemByWriter({ writers: [{ employeeName: '오세진', gradeName: '책임' }], thisWeek: '내용' })[0].name, '오세진');
});

test('저장: 직급을 붙여 쓴 내 구역도 찾아서 교체한다 (중복으로 붙이지 않음)', () => {
  const existing = '1. 작성자 : 한도윤 마스터\n옛 내용\n\n작성자 : 정민수팀장\n남의 글';
  const merged = mergeSection(existing, '새 내용', '한도윤', '마스터');
  assert.equal((merged.match(/한도윤/g) || []).length, 1);
  assert.match(merged, /새 내용/);
  assert.doesNotMatch(merged, /옛 내용/);
  assert.match(merged, /남의 글/);
  assert.equal(extractMine(existing, '정민수'), '남의 글');
});
