import { useSyncExternalStore } from 'react';
import { api, store } from './api.js';
import { createAccountSync } from './account-sync-store.js';
import { applySkin } from './skin.js';
let engine=null, stopListeners=null;
const idle={status:'idle',pending:0,conflicts:[],error:'',lastSync:null};
const listeners=new Set();
const notify=()=>listeners.forEach((fn)=>fn());
export async function startAccountSync(accountId) {
  stopAccountSync();
  const current=createAccountSync({accountId,storage:store,fetchChanges:(since)=>api.workspace(accountId,since),save:(entry)=>api.saveWorkspace(entry,accountId),onRemote:(keys)=>{
    if(keys.some((k)=>k==='wr.skin'||k==='wr.font'))applySkin();
    dispatchEvent(new CustomEvent('wr:account-sync',{detail:keys}));
  }});
  engine=current;current.subscribe(notify);notify();
  const refresh=()=>{if(!document.hidden)current.refresh();};
  const interval=setInterval(refresh,10000);
  addEventListener('online',refresh);addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  stopListeners=()=>{clearInterval(interval);removeEventListener('online',refresh);removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  await current.start();
}
export function stopAccountSync(){stopListeners?.();stopListeners=null;engine?.stop();engine=null;notify();}
export function useAccountSync(){return useSyncExternalStore((fn)=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>engine?.get()||idle);}
export const refreshAccountSync=()=>engine?.refresh();
export const resolveAccountConflict=(key,choice)=>engine?.resolve(key,choice);
export const flushAccountSync=()=>engine?.flush();
