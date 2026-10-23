// 양식(학습)과 자동화 설정: 이 기기에 사번별로 저장한다 (메모·초안과 같은 방식)
import { useCallback, useEffect, useState } from 'react';
import { store } from './api.js';

const read = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } };
const EVT = 'wr:templates';

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const DEFAULT_AUTO = { enabled: false, templateId: null, day: 5, time: '16:00', lastRun: 0 };

export function useTemplates(employeeId) {
  const tKey = `wr.templates.${employeeId}`;
  const aKey = `wr.auto.${employeeId}`;
  const [templates, setT] = useState(() => read(tKey, []));
  const [auto, setA] = useState(() => ({ ...DEFAULT_AUTO, ...read(aKey, {}) }));

  // 같은 화면의 다른 컴포넌트·다른 탭과 동기화
  useEffect(() => {
    const sync = () => { setT(read(tKey, [])); setA({ ...DEFAULT_AUTO, ...read(aKey, {}) }); };
    addEventListener(EVT, sync);
    addEventListener('storage', sync);
    return () => { removeEventListener(EVT, sync); removeEventListener('storage', sync); };
  }, [tKey, aKey]);

  const saveTemplates = useCallback((next) => {
    store.set(tKey, JSON.stringify(next));
    setT(next);
    dispatchEvent(new Event(EVT));
  }, [tKey]);

  const addTemplate = useCallback((t) => {
    const item = { ...t, id: Math.random().toString(36).slice(2, 10), createdAt: Date.now() };
    saveTemplates([item, ...read(tKey, [])]);
    return item;
  }, [saveTemplates, tKey]);
  const updateTemplate = useCallback((id, patch) => saveTemplates(read(tKey, []).map((t) => (t.id === id ? { ...t, ...patch } : t))), [saveTemplates, tKey]);
  const removeTemplate = useCallback((id) => saveTemplates(read(tKey, []).filter((t) => t.id !== id)), [saveTemplates, tKey]);

  const setAuto = useCallback((patch) => {
    const next = { ...DEFAULT_AUTO, ...read(aKey, {}), ...patch };
    store.set(aKey, JSON.stringify(next));
    setA(next);
    dispatchEvent(new Event(EVT));
  }, [aKey]);

  return { templates, addTemplate, updateTemplate, removeTemplate, auto, setAuto };
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
