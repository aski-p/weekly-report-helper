// 공동 작성 항목에서 "내 구역"만 추가/교체하고 다른 사람 글은 그대로 두는 로직.
// 사이트 관례: 여러 명이 쓰는 칸은 "작성자 : 이름 직급" 줄로 구역을 나눈다.

import { isWriter, parseWriterHeader } from './writer-header.js';

const clean = (s) => (s || '').replace(/﻿/g, '').replace(/\r\n/g, '\n');

// 항목에 나 말고 다른 작성자가 있거나, 누가 썼는지 모르는 기존 내용이 있으면 구역 모드
export function needsSectionMode(item, myEmployeeId) {
  const writers = item.writers || [];
  const others = writers.filter((w) => w.employeeId !== myEmployeeId);
  if (others.length) return true;
  const hasContent = [item.thisWeek, item.nextWeek, item.issue].some((v) => clean(v).trim());
  return hasContent && writers.length === 0;
}

// existing 안에서 myName 구역을 mine 으로 교체(없으면 끝에 추가)
export function mergeSection(existing, mine, myName, myTitle) {
  existing = clean(existing);
  mine = clean(mine).trim();
  const header = `작성자 : ${myName}${myTitle ? ' ' + myTitle : ''}`;
  const lines = existing.split('\n');

  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const h = parseWriterHeader(lines[i]);
    if (!h) continue;
    if (start === -1 && isWriter(h, myName)) { start = i; continue; }
    if (start !== -1) { end = i; break; }
  }

  if (start === -1) {
    if (!mine) return existing;
    const base = existing.replace(/\s+$/, '');
    return base ? `${base}\n\n${header}\n\n${mine}` : `${header}\n\n${mine}`;
  }

  const before = lines.slice(0, start).join('\n').replace(/\s+$/, '');
  const after = lines.slice(end).join('\n').replace(/^\s+/, '');
  const middle = mine ? `${header}\n\n${mine}` : '';
  return [before, middle, after].filter(Boolean).join('\n\n');
}

// 최종 저장값 계산
export function buildFields(item, draft, me) {
  const fields = {};
  const section = item && needsSectionMode(item, me.employeeId);
  for (const k of ['thisWeek', 'nextWeek', 'issue']) {
    const mine = clean(draft[k]).trim();
    if (!item) { fields[k] = mine; continue; }
    if (!section) { fields[k] = mine || clean(item[k]); continue; }
    fields[k] = mine ? mergeSection(item[k], mine, me.employeeName, me.gradeName) : clean(item[k]);
  }
  return { fields, mode: !item ? 'new' : section ? 'section' : 'replace' };
}

// 이전 주 항목에서 내 구역만 뽑기 (AI에게 연속성 참고용)
export function extractMine(text, myName) {
  text = clean(text);
  const lines = text.split('\n');
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const h = parseWriterHeader(lines[i]);
    if (!h) continue;
    if (start === -1 && isWriter(h, myName)) { start = i + 1; continue; }
    if (start !== -1) { end = i; break; }
  }
  return start === -1 ? null : lines.slice(start, end).join('\n').trim();
}
