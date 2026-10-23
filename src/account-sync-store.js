import { remoteWorkspaceKey, localWorkspaceKey, meaningfulWorkspaceValue } from '../shared/workspace-keys.js';

// A durable outbox and optimistic versions keep offline edits from overwriting
// another device. Only the explicit workspace allowlist can leave this device.
export function createAccountSync({ accountId, storage, fetchChanges, save, onRemote = () => {} }) {
  const read = (key, fallback) => { try { return JSON.parse(storage.get(key)) ?? fallback; } catch { return fallback; } };
  const prefix = `wr.sync.${accountId}`;
  const versions = read(`${prefix}.versions`, {});
  const pending = new Map(read(`${prefix}.outbox`, []));
  let state = { status: 'loading', pending: pending.size, conflicts: [], error: '', lastSync: null };
  let active = true, initialized = false, cursor = 0, sequence = Math.max(0,...[...pending.values()].map((p)=>p.sequence || 0));
  let pulling, flushing, timer, unsubscribe;
  const listeners = new Set();
  function publish(error) {
    storage.set(`${prefix}.outbox`, JSON.stringify([...pending]));
    storage.set(`${prefix}.versions`, JSON.stringify(versions));
    const conflicts = [...pending].filter(([,p])=>p.conflict).map(([key,p])=>({key,localValue:p.value,current:p.conflict}));
    state = { ...state, pending: pending.size, conflicts, error: error || '', status: error ? 'error' : conflicts.length ? 'conflict' : pending.size ? 'pending' : initialized ? 'saved' : 'loading' };
    listeners.forEach((fn)=>fn());
  }
  function apply(item) {
    const key = localWorkspaceKey(item.key, accountId);
    if (key && storage.get(key) !== item.value) { storage.set(key,item.value,true); onRemote([key]); }
    versions[item.key] = item.version;
  }
  function changed({key: local, value, remote}) {
    if (!active || remote) return;
    const key = remoteWorkspaceKey(local,accountId); if (!key) return;
    const previous = pending.get(key);
    pending.set(key,{value,baseVersion:previous?.baseVersion ?? versions[key] ?? 0,sequence:++sequence,conflict:previous?.conflict});
    publish(); clearTimeout(timer);
    if (initialized) timer = setTimeout(()=>flush().catch(()=>{}),500);
  }
  async function pull(initial = false) {
    if (pulling) return pulling;
    pulling = (async()=>{
      const legacy = new Map();
      if (initial) for (const local of storage.keys()) {
        const key = remoteWorkspaceKey(local,accountId), value=storage.get(local);
        if (key && versions[key] == null && !pending.has(key) && meaningfulWorkspaceValue(key,value)) legacy.set(key,value);
      }
      const result = await fetchChanges(initial ? 0 : cursor);
      if (!active) return;
      const found = new Set();
      for (const item of result.items) {
        found.add(item.key);
        if (item.version < (versions[item.key] || 0)) continue;
        if (legacy.has(item.key) && legacy.get(item.key) !== item.value) {
          pending.set(item.key,{value:legacy.get(item.key),baseVersion:item.version,sequence:++sequence,conflict:item});
        }
        const p = pending.get(item.key);
        if (p) {
          if (p.value === item.value) { pending.delete(item.key); apply(item); }
          else if (item.version !== p.baseVersion) p.conflict=item;
        } else apply(item);
      }
      if (initial) for (const [key,value] of legacy) if (!found.has(key) && !pending.has(key)) pending.set(key,{value,baseVersion:0,sequence:++sequence,migration:true});
      cursor=result.cursor; initialized=true; state={...state,lastSync:Date.now()}; publish();
    })().finally(()=>{pulling=null;});
    return pulling;
  }
  async function flush() {
    clearTimeout(timer);
    if (!active) return;
    if (flushing) return flushing;
    flushing=(async()=>{
      if (!initialized) await pull(true);
      while(active) {
        const entry=[...pending].find(([,p])=>!p.conflict); if (!entry) break;
        const [key,p]=entry;
        try {
          const response=await save({key,value:p.value,baseVersion:p.baseVersion,migration:!!p.migration});
          if (!active) return;
          const current=pending.get(key); if (!current) continue;
          const item=response.item;
          if (response.existed && item.value !== p.value) { current.conflict=item; publish(); continue; }
          versions[key]=item.version;
          if (current.sequence===p.sequence) { pending.delete(key); apply(item); }
          else { current.baseVersion=item.version; current.migration=false; if(current.conflict?.version===item.version)current.conflict=null; }
          state={...state,lastSync:Date.now()}; publish();
        } catch(e) {
          if (e.code==='SYNC_CONFLICT' && e.body?.current) {
            const current=pending.get(key); if (!current) continue;
            if (current.value===e.body.current.value) { pending.delete(key); apply(e.body.current); }
            else current.conflict=e.body.current;
            publish();
          } else throw e;
        }
      }
    })().catch((e)=>{publish(e.message || '동기화에 실패했습니다');throw e;}).finally(()=>{flushing=null;if(!pending.size)clearTimeout(timer);});
    return flushing;
  }
  async function refresh() {
    try { await pull(!initialized); await flush(); } catch(e) { publish(e.message || '서버에 연결하지 못했습니다'); }
  }
  async function resolve(key, choice) {
    const p=pending.get(key); if (!p?.conflict) return;
    // Retain a device copy of the alternative the user chose to replace.
    storage.set(`${prefix}.backup.${key}`,JSON.stringify({local:p.value,remote:p.conflict,at:Date.now()}));
    if(choice==='remote'){ const item=p.conflict; pending.delete(key); apply(item);publish(); }
    else {p.baseVersion=p.conflict.version;p.conflict=null;p.migration=false;publish();await flush();}
  }
  return {
    get:()=>state, subscribe:(fn)=>{listeners.add(fn);return()=>listeners.delete(fn);}, flush,refresh,resolve,
    start:async()=>{unsubscribe=storage.subscribe(changed);try{await pull(true);flush().catch(()=>{});}catch(e){publish(e.message||'서버에 연결하지 못했습니다');}},
    stop:()=>{active=false;unsubscribe?.();clearTimeout(timer);publish();},
  };
}
