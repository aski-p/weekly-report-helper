const WEEK_KEY = /^(memo|draft|approval)\.(20\d{2})-(\d{1,2})$/;
export function validWorkspaceKey(key) {
  if (typeof key !== 'string') return false;
  const m = key.match(WEEK_KEY);
  return m ? +m[3] >= 1 && +m[3] <= 53 : ['automation','writeTemplate','skin','font','view.team','view.sort','view.byWriter'].includes(key);
}
export function remoteWorkspaceKey(local, accountId) {
  const owner = String(accountId);
  for (const kind of ['memo','draft','approval']) {
    const prefix = `wr.${kind}.${owner}.`;
    if (local.startsWith(prefix)) { const key = `${kind}.${local.slice(prefix.length)}`; return validWorkspaceKey(key) ? key : null; }
  }
  if (local === `wr.auto.${owner}`) return 'automation';
  if (local === `wr.writeTpl.${owner}`) return 'writeTemplate';
  const key = local.startsWith('wr.') ? local.slice(3) : '';
  return ['skin','font','view.team','view.sort','view.byWriter'].includes(key) ? key : null;
}
export function localWorkspaceKey(remote, accountId) {
  if (!validWorkspaceKey(remote)) return null;
  const owner = String(accountId);
  if (WEEK_KEY.test(remote)) { const [kind, week] = remote.split('.'); return `wr.${kind}.${owner}.${week}`; }
  if (remote === 'automation') return `wr.auto.${owner}`;
  if (remote === 'writeTemplate') return `wr.writeTpl.${owner}`;
  return `wr.${remote}`;
}
export function meaningfulWorkspaceValue(key, value) {
  if (value == null || !value.trim() || value === 'null') return false;
  if (key.startsWith('draft.')) {
    try { const d = JSON.parse(value); return !!(d?.items?.length || d?.questions?.length); } catch { return false; }
  }
  return true;
}
