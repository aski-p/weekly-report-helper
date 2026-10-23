// Durable local outbox + serialized server writes, shared by all mounted views.
export function createRemoteStore({ key, storage, fetchAll, put, drop, migrate, onError = () => {} }) {
  const read = (k, fallback) => { try { return JSON.parse(storage.get(k)) ?? fallback; } catch { return fallback; } };
  const cached = read(key, []);
  const pending = new Map(read(`${key}.outbox`, []));
  let state = { items: Array.isArray(cached) ? cached : [], status: 'loading', error: '' };
  let revision = 0, version = Math.max(0, ...[...pending.values()].map((p) => p.version || 0)), loading, flushing, timer;
  const subs = new Set();
  const emit = () => { storage.set(key, JSON.stringify(state.items)); storage.set(`${key}.outbox`, JSON.stringify([...pending])); subs.forEach((f) => f()); };
  const status = () => { state = { ...state, status: pending.size ? 'pending' : 'saved', error: '' }; emit(); };
  const overlay = (items) => {
    const map = new Map(items.map((x) => [x.id, x]));
    for (const [id, p] of pending) { if (p.item) map.set(id, p.item); else map.delete(id); }
    return [...map.values()];
  };
  const failed = (e) => { state = { ...state, status: 'error', error: e.message || '서버에 저장하지 못했습니다' }; emit(); onError(e); };
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const started = revision;
      let items = await fetchAll();
      if (!storage.get(`${key}.migrated`)) {
        const legacy = state.items.filter((x) => !pending.has(x.id) && !items.some((s) => s.id === x.id));
        // One at a time keeps long transcripts below the function request limit.
        for (const item of legacy) await migrate(item);
        if (legacy.length) items = await fetchAll();
        storage.set(`${key}.migrated`, '1');
      }
      if (revision === started) state = { ...state, items: overlay(items) };
      status();
    })().finally(() => { loading = null; });
    return loading;
  }
  async function flush() {
    clearTimeout(timer);
    if (flushing) return flushing;
    flushing = (async () => {
      await load();
      while (pending.size) {
        const [id, p] = pending.entries().next().value;
        const result = p.item ? await put(p.item) : await drop(id);
        // An edit made while the request was in flight must remain in the outbox.
        if (pending.get(id)?.version === p.version) {
          pending.delete(id);
          if (p.item && result?.items?.[0]) state = { ...state, items: state.items.map((x) => x.id === id ? result.items[0] : x) };
        }
        revision++;
        status();
      }
    })().catch((e) => { failed(e); throw e; }).finally(() => { flushing = null; if (!pending.size) clearTimeout(timer); });
    return flushing;
  }
  function change(id, item, delay = 500) {
    revision++;
    pending.set(id, { item, version: ++version });
    state = { ...state, items: overlay(state.items) };
    status();
    clearTimeout(timer);
    timer = setTimeout(() => { flush().catch(() => {}); }, delay);
  }
  return {
    get: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    refresh: () => load().then(() => pending.size ? flush() : undefined).catch(failed),
    flush,
    change,
    update: (id, patch) => {
      const item = state.items.find((x) => x.id === id);
      if (item) change(id, { ...item, ...(typeof patch === 'function' ? patch(item) : patch), updatedAt: Date.now() });
    },
  };
}
