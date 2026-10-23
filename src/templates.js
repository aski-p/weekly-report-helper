// 양식과 자동화 설정은 계정 DB에 동기화하고, 기기에는 오프라인 사본을 둔다.
import { useCallback, useEffect, useState } from 'react';
import { store } from './api.js';
import { useRemoteRecords } from './useRemoteRecords.js';

const read = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } };
const EVT = 'wr:templates';

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const DEFAULT_AUTO = { enabled: false, templateId: null, day: 5, time: '16:00', lastRun: 0 };

export function useTemplates(employeeId) {
  const { items: templates, add, update: updateTemplate, remove: removeTemplate, status, error, retry, flush } = useRemoteRecords('templates', employeeId);
  const aKey = `wr.auto.${employeeId}`;
  const [auto, setA] = useState(() => ({ ...DEFAULT_AUTO, ...read(aKey, {}) }));
  useEffect(() => {
    const sync = () => setA({ ...DEFAULT_AUTO, ...read(aKey, {}) });
    addEventListener(EVT, sync); addEventListener('storage', sync); addEventListener('wr:account-sync',sync);
    return () => { removeEventListener(EVT, sync); removeEventListener('storage', sync); removeEventListener('wr:account-sync',sync); };
  }, [aKey]);
  const addTemplate = useCallback(async (t) => {
    const item = add({ ...t, id: t.id || crypto.randomUUID(), createdAt: t.createdAt || Date.now(), updatedAt: Date.now() });
    await flush();
    return item;
  }, [add, flush]);
  const setAuto = useCallback((patch) => {
    const next = { ...DEFAULT_AUTO, ...read(aKey, {}), ...patch };
    store.set(aKey, JSON.stringify(next)); setA(next); dispatchEvent(new Event(EVT));
  }, [aKey]);
  return { templates, addTemplate, updateTemplate, removeTemplate, auto, setAuto, status, error, retry };
}

// 이번 주(일요일 시작)의 예약 시각 — 이미 지났을 수도 있다
export function slotThisWeek(auto, now = new Date()) {
  const [h, m] = (auto.time || '16:00').split(':').map(Number);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + auto.day, h, m);
  return d;
}

// 다음 예약 시각 (표시용)
export function nextSlot(auto, now = new Date()) {
  const s = slotThisWeek(auto, now);
  if (s > now) return s;
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7, s.getHours(), s.getMinutes());
}

// 지금 실행해야 하나: 이번 주 예약 시각이 지났고, 그 이후 아직 안 돌았으면
export function isDue(auto, now = new Date()) {
  if (!auto.enabled || !auto.templateId) return false;
  const s = slotThisWeek(auto, now);
  return now >= s && (auto.lastRun || 0) < s.getTime();
}

export const fmtSlot = (d) => `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
