import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteStore } from '../src/remote-store.js';
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const storage = () => { const map = new Map(); return { get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) }; };
function setup(overrides = {}) {
  const disk = overrides.storage || storage();
  disk.set('records.migrated', '1');
  return createRemoteStore({ key: 'records', storage: disk, fetchAll: async () => [], put: async (t) => ({ items: [t] }), drop: async () => ({ ok: true }), migrate: async () => {}, ...overrides });
}
test('edits made while a save is in flight are saved afterwards without rollback', async () => {
  const first = deferred(); const entered = deferred(); const writes = [];
  const s = setup({ put: async (t) => { writes.push(t); if (writes.length === 1) { entered.resolve(); await first.promise; } return { items: [t] }; } });
  s.change('record1', { id: 'record1', title: 'old' }, 10000);
  const work = s.flush(); await entered.promise;
  s.update('record1', { title: 'new' }); first.resolve(); await work;
  assert.deepEqual(writes.map((t) => t.title), ['old', 'new']);
  assert.equal(s.get().items[0].title, 'new'); assert.equal(s.get().status, 'saved');
});
test('a failed save survives reopening and retries using the same id', async () => {
  const disk = storage();
  const s = setup({ storage: disk, put: async () => { throw new Error('offline'); } });
  s.change('record1', { id: 'record1', title: 'keep me' }, 10000);
  await assert.rejects(s.flush(), /offline/);
  assert.equal(s.get().status, 'error');
  const saved = [];
  const reopened = setup({ storage: disk, put: async (t) => { saved.push(t); return { items: [t] }; } });
  await reopened.flush(); assert.equal(saved[0].title, 'keep me'); assert.equal(reopened.get().status, 'saved');
});
test('deleting a record while its update is pending cannot resurrect it', async () => {
  const gate = deferred(), entered = deferred(); const deletes = [];
  const s = setup({ put: async (t) => { entered.resolve(); await gate.promise; return { items: [t] }; }, drop: async (id) => { deletes.push(id); } });
  s.change('record1', { id: 'record1' }, 10000); const work = s.flush(); await entered.promise;
  s.change('record1', null, 10000); gate.resolve(); await work;
  assert.deepEqual(deletes, ['record1']); assert.deepEqual(s.get().items, []);
});
test('migration merges legacy entries and never overwrites an existing server record', async () => {
  const disk = storage(); disk.set('records', JSON.stringify([{id:'old1',title:'stale'}, {id:'old2',title:'local'}]));
  let items = [{id:'old1',title:'server'}]; const migrated = [];
  const s = createRemoteStore({key:'records',storage:disk,fetchAll:async()=>items,put:async()=>{},drop:async()=>{},migrate:async(t)=>{migrated.push(t); items=[...items,t];}});
  await s.refresh(); assert.deepEqual(migrated.map((t)=>t.id),['old2']); assert.equal(s.get().items.find((t)=>t.id==='old1').title,'server');
});
