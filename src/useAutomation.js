// 자동화 실행기: 예약 시각이 지나면 고른 양식으로 이번 주 초안을 만들고 알린다. 게시는 하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, store } from './api.js';
import { isDue, useTemplates } from './templates.js';

export const notifySupported = () => typeof Notification !== 'undefined';
export const requestNotify = async () => (notifySupported() ? Notification.requestPermission() : 'unsupported');

export async function notify(title, body, tag = 'wr-auto') {
  if (!notifySupported() || Notification.permission !== 'granted') return;
  const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, opts);
  } catch { /* 아래로 */ }
  try { new Notification(title, opts); } catch { /* 모바일 일부는 SW 알림만 됨 */ }
}

// weeks: 최신순 주차 목록. onReady({ year, week }, draft) 로 결과를 넘긴다.
export function useAutomation(me, weeks, onReady) {
  const { templates, auto, setAuto } = useTemplates(me.employeeId);
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const cb = useRef(onReady);
  cb.current = onReady;

  const run = useCallback(async ({ manual = false } = {}) => {
    const tpl = templates.find((t) => t.id === auto.templateId);
    const week = weeks.find((w) => w.isCurrent) || weeks[0];
    if (!tpl || !week || busy.current) return;
    busy.current = true;
    setRunning(true);
    if (!manual) setAuto({ lastRun: Date.now() }); // 실패해도 같은 주에 반복 실행하지 않도록 먼저 기록
    const key = `${me.employeeId}.${week.year}-${week.week}`;
    const read = (k) => { try { return JSON.parse(store.get(k)); } catch { return null; } };
    const existing = read(`wr.draft.${key}`);
    const posted = read(`wr.approval.${key}`)?.ok;
    // 이미 게시했거나 쓰던 초안이 있으면 덮어쓰지 않고 알림만 (수동 실행은 물어본다)
    if (posted || (existing?.items?.length && !(manual && confirm('이번 주에 쓰던 초안이 있습니다. 자동화 초안으로 바꿀까요?')))) {
      if (!manual) {
        const msg = posted ? `${week.week}주차는 이미 게시했습니다.` : `${week.week}주차 초안 ${existing.items.length}건이 승인을 기다리고 있습니다.`;
        cb.current?.({ year: week.year, week: week.week }, posted ? null : existing, null, msg);
        notify('주간보고 알림', msg);
      }
      busy.current = false;
      setRunning(false);
      return;
    }
    try {
      const memo = store.get(`wr.memo.${key}`) || '';
      const r = await api.draft(week.year, week.week, memo, { template: tpl, fromLastWeek: true });
      const uid = () => Math.random().toString(36).slice(2, 9);
      const draft = { items: r.items.map((i) => ({ ...i, id: uid() })), questions: r.questions || [], at: Date.now(), auto: { template: tpl.name } };
      store.set(`wr.draft.${key}`, JSON.stringify(draft));
      store.set(`wr.approval.${key}`, null);
      cb.current?.({ year: week.year, week: week.week }, draft);
      notify('주간보고 초안이 준비됐습니다', `${week.week}주차 · "${tpl.name}" 양식 · ${draft.items.length}건. 확인하고 승인하면 게시됩니다.`);
    } catch (e) {
      cb.current?.({ year: week.year, week: week.week }, null, errorText(e, '자동 초안을 만들지 못했습니다.'));
      notify('주간보고 자동 작성 실패', errorText(e, '앱을 열어 확인하세요.'));
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, [templates, auto.templateId, weeks, me.employeeId, setAuto]);

  // 30초마다, 그리고 앱으로 돌아올 때 확인
  useEffect(() => {
    if (!auto.enabled || !weeks.length) return;
    const check = () => { if (isDue(auto)) run(); };
    check();
    const t = setInterval(check, 30_000);
    addEventListener('visibilitychange', check);
    addEventListener('focus', check);
    return () => { clearInterval(t); removeEventListener('visibilitychange', check); removeEventListener('focus', check); };
  }, [auto, weeks.length, run]);

  return { running, runNow: () => run({ manual: true }) };
}
