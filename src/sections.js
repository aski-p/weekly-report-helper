// 보고서 칸을 "작성자 : 이름 직급" 줄 기준으로 나눈다 (서버 lib/merge.js 와 같은 해석).
import { parseWriterHeader } from '../lib/writer-header.js';

const clean = (s) => (s || '').replace(/﻿/g, '').replace(/\r\n/g, '\n');

// → [{ name, title, text }] — 머리말이 없는 앞부분은 name=null
export function splitSections(text) {
  const out = [];
  let cur = { name: null, title: '', lines: [] };
  for (const line of clean(text).split('\n')) {
    const h = parseWriterHeader(line);
    if (h) {
      out.push(cur);
      cur = { name: h.name, title: h.title, lines: [] };
    } else cur.lines.push(line);
  }
  out.push(cur);
  return out.map((s) => ({ name: s.name, title: s.title, text: s.lines.join('\n').trim() })).filter((s) => s.text || s.name);
}

const writerName = (w) => w.employeeName || w.name || '';

// 항목 하나 → 작성자별 { name, title, thisWeek, nextWeek, issue }
// 머리말이 없는 글은 작성자가 한 명이면 그 사람 것으로, 아니면 "작성자 미상"
// 머리말 이름은 항목의 실제 작성자 이름에 맞춘다 (예: "정민수(PM)" → 정민수)
export function itemByWriter(item) {
  const fields = ['thisWeek', 'nextWeek', 'issue'];
  const writers = item.writers || [];
  const solo = writers.length === 1 ? writers[0] : null;
  const known = (name) => writers.find((w) => writerName(w) === name) || writers.find((w) => writerName(w) && name.startsWith(writerName(w)));
  const map = new Map();
  for (const f of fields) {
    for (const s of splitSections(item[f])) {
      const w = s.name ? known(s.name) : solo;
      const name = w ? writerName(w) : s.name || '작성자 미상';
      const title = s.title || (w ? w.gradeName || '' : '');
      if (!map.has(name)) map.set(name, { name, title, thisWeek: '', nextWeek: '', issue: '' });
      const e = map.get(name);
      if (!e.title && title) e.title = title;
      e[f] = [e[f], s.text].filter(Boolean).join('\n\n');
    }
  }
  return [...map.values()];
}

// 보고서 칸 세 개를 "양식으로 저장"에 넘길 한 덩어리 글로
export function asTemplateSource({ thisWeek, nextWeek, issue }) {
  return [
    thisWeek && `[금주]\n${thisWeek}`,
    nextWeek && `[차주]\n${nextWeek}`,
    issue && `[이슈]\n${issue}`,
  ].filter(Boolean).join('\n\n');
}
