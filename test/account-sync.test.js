import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountSync } from '../src/account-sync-store.js';
function memory(values={}) {
  const entries=new Map(Object.entries(values)),listeners=new Set();
  return {get:k=>entries.get(k)??null,keys:()=>[...entries.keys()],set(k,value,remote=false){value==null?entries.delete(k):entries.set(k,value);listeners.forEach(fn=>fn({key:k,value,remote}));},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
}
function backend(){const docs=new Map();let version=0;return{docs,fetchChanges:async(since)=>({items:[...docs.values()].filter(d=>d.version>since),cursor:version}),save:async(p)=>{const previous=docs.get(p.key);if(previous&&p.migration)return{item:previous,existed:true};if((previous?.version||0)!==p.baseVersion)throw Object.assign(Error('conflict'),{code:'SYNC_CONFLICT',body:{current:previous}});const item={key:p.key,value:p.value,version:++version};docs.set(p.key,item);return{item};}};}
const memo='wr.memo.a.2026-43';
test('legacy migration excludes credentials and other accounts and retains conflicting copies',async()=>{
  const b=backend();await b.save({key:'memo.2026-43',value:'server',baseVersion:0});
  const storage=memory({[memo]:'device','wr.token':'secret','wr.memo.b.2026-43':'other'});
  const engine=createAccountSync({accountId:'a',storage,...b});
  await engine.start();await engine.flush();
  assert.equal(engine.get().conflicts.length,1);assert.equal(b.docs.size,1);assert.equal(storage.get(memo),'device');
  await engine.resolve('memo.2026-43','remote');assert.equal(storage.get(memo),'server');assert.equal(engine.get().pending,0);
  assert.match(storage.get('wr.sync.a.backup.memo.2026-43'),/device/);engine.stop();
});
test('two devices detect conflicts; explicit choice saves against the latest version',async()=>{
  const b=backend(),a=memory(),c=memory();
  const x=createAccountSync({accountId:'a',storage:a,...b}),y=createAccountSync({accountId:'a',storage:c,...b});
  await x.start();await y.start();a.set(memo,'one');await x.flush();c.set(memo,'two');await y.flush();
  assert.equal(y.get().status,'conflict');assert.equal(b.docs.get('memo.2026-43').value,'one');
  await y.resolve('memo.2026-43','local');await x.refresh();assert.equal(a.get(memo),'two');x.stop();y.stop();
});
test('an in-flight save preserves newer edits and offline outbox survives reopening',async()=>{
  const b=backend(),storage=memory();let release,entered;
  const started=new Promise(r=>entered=r);
  const engine=createAccountSync({accountId:'a',storage,...b,save:async p=>{entered();await new Promise(r=>release=r);return b.save(p);}});
  await engine.start();await engine.flush();storage.set(memo,'first');const saving=engine.flush();await started;storage.set(memo,'second');release();
  // A second write is now blocked; stop the engine without erasing the durable outbox.
  await new Promise(r=>setImmediate(r));engine.stop();release();await saving;
  const next=createAccountSync({accountId:'a',storage,...b});await next.start();await next.flush();
  assert.equal(b.docs.get('memo.2026-43').value,'second');assert.equal(storage.get(memo),'second');next.stop();
});
test('stale pull results cannot roll back an acknowledged save',async()=>{
  const b=backend(),storage=memory();await b.save({key:'memo.2026-43',value:'old',baseVersion:0});
  let finish,delay=false;
  const engine=createAccountSync({accountId:'a',storage,...b,fetchChanges:async since=>{const snapshot=await b.fetchChanges(since);if(delay)await new Promise(r=>finish=r);return snapshot;}});
  await engine.start();delay=true;const pulling=engine.refresh();await new Promise(r=>setImmediate(r));storage.set(memo,'new');await engine.flush();finish();await pulling;
  assert.equal(storage.get(memo),'new');engine.stop();
});
