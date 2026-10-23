import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, store } from './api.js';
import { createRemoteStore } from './remote-store.js';
const stores = new Map();
function shared(kind, employeeId) {
  const key = `wr.${kind}.${employeeId}`;
  if (!stores.has(key)) stores.set(key, createRemoteStore({ key, storage: store,
    fetchAll: () => kind === 'templates' ? api.templates(employeeId) : api.meetings(employeeId),
    put: (item) => kind === 'templates' ? api.saveTemplate(item, employeeId) : api.saveMeeting(item, employeeId),
    drop: (id) => kind === 'templates' ? api.deleteTemplate(id, employeeId) : api.deleteMeeting(id, employeeId),
    migrate: (item) => kind === 'templates' ? api.importTemplates([item], employeeId) : api.importMeetings([item], employeeId),
  }));
  return stores.get(key);
}
export function useRemoteRecords(kind, employeeId) {
  const s = shared(kind, employeeId);
  const state = useSyncExternalStore(s.subscribe, s.get);
  useEffect(() => {
    s.refresh();
    const again = () => { if (!document.hidden) s.refresh(); };
    const leaving = () => { s.flush().catch(() => {}); };
    const warn = (e) => { if (s.get().status === 'pending' || s.get().status === 'error') { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('online', again);
    addEventListener('focus', again);
    addEventListener('pagehide', leaving);
    addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', again);
    return () => { leaving(); removeEventListener('online', again); removeEventListener('focus', again); removeEventListener('pagehide', leaving); removeEventListener('beforeunload', warn); document.removeEventListener('visibilitychange', again); };
  }, [s]);
  const add = useCallback((item) => { s.change(item.id, item, 0); return item; }, [s]);
  const remove = useCallback((id) => s.change(id, null, 0), [s]);
  return { ...state, add, update: s.update, remove, retry: s.refresh, flush: s.flush };
}
