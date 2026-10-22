// 주간보고 맥락 수집(후보 업무, 양식 예시, 지난주 내 기록)과 저장 처리
import { buildFields, needsSectionMode, extractMine } from './merge.js';
import { FIELD_MAX } from './onefinger.js';

export const itemKey = (i) => (i.workKindCode === 'G' ? `G:${i.workName}` : i.workId);
const isMine = (i, me) => (i.writers || []).some((w) => w.employeeId === me.employeeId);
const trunc = (s, n) => { s = (s || '').replace(/﻿/g, ''); return s.length > n ? s.slice(0, n) + '\n…' : s; };

export async function prevWeekOf(api, year, week) {
  const weeks = await api.weeks(12, 1);
  const sorted = [...weeks].sort((a, b) => (b.year - a.year) || (b.week - a.week));
  const idx = sorted.findIndex((w) => w.year === year && w.week === week);
  return { target: sorted[idx], prev: idx >= 0 ? sorted[idx + 1] : null, weeks: sorted };
}

export async function buildContext(api, me, year, week) {
  const { target, prev } = await prevWeekOf(api, year, week);
  const [report, prevReport] = await Promise.all([
    api.getReport(year, week, me.buId),
    prev ? api.getReport(prev.year, prev.week, me.buId) : null,
  ]);
  const cur = report?.items || [];
  const old = prevReport?.items || [];

  // 후보: 이번 주 항목 전부 + 지난주 내가 쓴 항목
  const candidates = new Map();
  for (const i of cur) candidates.set(itemKey(i), { key: itemKey(i), workKindCode: i.workKindCode, workId: i.workId, workName: i.workName, team: i.ownerTeamName, existing: true });
  for (const i of old.filter((i) => isMine(i, me))) {
    if (!candidates.has(itemKey(i))) candidates.set(itemKey(i), { key: itemKey(i), workKindCode: i.workKindCode, workId: i.workId, workName: i.workName, team: i.ownerTeamName, existing: false });
  }

  // 양식 예시: 다른 사람이 쓴 항목 중 같은 팀 우선, 적당한 길이
  const pool = [...cur, ...old]
    .filter((i) => !isMine(i, me) && (i.thisWeek || '').trim().length > 80)
    .sort((a, b) => {
      const t = (x) => (x.ownerTeamName === me.departmentName ? 0 : 1);
      const len = (x) => Math.abs((x.thisWeek || '').length - 500);
      return t(a) - t(b) || len(a) - len(b);
    });
  const seen = new Set();
  const examples = [];
  for (const i of pool) {
    if (seen.has(itemKey(i)) || examples.length >= 4) continue;
    seen.add(itemKey(i));
    examples.push({ workName: i.workName, thisWeek: trunc(i.thisWeek, 1200), nextWeek: trunc(i.nextWeek, 700), issue: trunc(i.issue, 300) });
  }

  // 지난주 내 기록 (공동 항목이면 내 구역만)
  const myLastWeek = old.filter((i) => isMine(i, me)).map((i) => {
    const section = needsSectionMode(i, me.employeeId);
    const pick = (t) => (section ? extractMine(t, me.employeeName) : (t || '').trim()) || '';
    return { key: itemKey(i), workName: i.workName, thisWeek: trunc(pick(i.thisWeek), 1500), nextWeek: trunc(pick(i.nextWeek), 1000) };
  });

  return {
    period: target ? `${target.year}년 ${target.week}주차 (${target.from} ~ ${target.to})` : `${year}년 ${week}주차`,
    report,
    candidates: [...candidates.values()],
    examples,
    myLastWeek,
  };
}

function findItem(report, draft) {
  const items = report?.items || [];
  return draft.workKindCode === 'G'
    ? items.find((i) => i.workKindCode === 'G' && i.workName === draft.workName)
    : items.find((i) => i.workId === draft.workId);
}

// 저장: dryRun 이면 계산만
export async function commit(api, me, year, week, drafts, { dryRun = false } = {}) {
  let report = dryRun ? await api.getReport(year, week, me.buId) : await api.ensureReport(year, week, me.buId);
  const results = [];
  for (const d of drafts) {
    const r = { workName: d.workName, workId: d.workId ?? null };
    try {
      if (d.workKindCode !== 'G' && !d.workId) throw new Error('업무가 지정되지 않았습니다');
      let item = findItem(report, d);
      const { fields, mode } = buildFields(item, d, me);
      r.mode = mode;
      r.fields = fields;
      const over = Object.entries(fields).find(([, v]) => (v || '').length > FIELD_MAX);
      if (over) throw new Error(`${over[0]} 칸이 ${FIELD_MAX}자를 넘습니다 (${over[1].length}자)`);
      if (!dryRun) {
        if (!item) {
          await api.addItem(report.weeklyReportId, d);
          report = await api.getReport(year, week, me.buId);
          item = findItem(report, d);
          if (!item) throw new Error('항목을 추가했지만 찾을 수 없습니다');
        }
        await api.updateLocked(report.weeklyReportId, item, fields);
        r.ok = true;
      }
    } catch (e) {
      r.ok = false;
      r.error = e.code === 'ITEM_LOCKED_BY_OTHER' ? '다른 사람이 편집 중입니다 — 잠시 후 다시 시도하세요' : e.message;
    }
    results.push(r);
  }
  return results;
}
