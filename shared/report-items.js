import { parseWriterHeader } from '../lib/writer-header.js';
export const REPORT_FIELDS = ['thisWeek', 'nextWeek', 'issue'];
export const ownsReportItem = (item, me) => (item.writers || []).some(w => String(w.employeeId) === String(me.employeeId));
export const reportClosed = report => report?.confirmed === true || report?.isConfirmed === true || report?.closed === true || report?.isClosed === true || /^(CONFIRMED|CLOSED|DONE|FINAL|확정|마감)$/i.test(String(report?.statusCode || report?.status || ''));
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const text = value => String(value ?? '').replace(/\r\n?/g, '\n');
function canonicalVersion(parts) {
  if (!Array.isArray(parts) || ![6,7].includes(parts.length) || !Array.isArray(parts[4]) || parts[4].length !== 3 || !Array.isArray(parts[5])) return null;
  if (parts[5].some(w => !Array.isArray(w) || w.length !== 2)) return null;
  return JSON.stringify([
    String(parts[0] ?? ''), text(parts[1]), parts[2] == null ? null : String(parts[2]), text(parts[3]),
    parts[4].map(text), parts[5].map(w => [String(w[0] ?? ''),text(w[1])]).sort((a,b) => compare(a[0],b[0]) || compare(a[1],b[1])),
  ]);
}
// Taking/releasing an edit lock can update timestamps without changing content.
// Compare only content, work identity and writers, in a stable representation.
export const reportItemVersion = item => canonicalVersion([item.weeklyReportItemId, item.workKindCode, item.workId, item.workName, REPORT_FIELDS.map(k=>item[k]), (item.writers||[]).map(w=>[w.employeeId,w.employeeName])]);
export function matchesReportItemVersion(item, version) {
  if (typeof version !== 'string') return false;
  try { return canonicalVersion(JSON.parse(version)) === reportItemVersion(item); } catch { return false; }
}

export function sharedReportItem(item, me) {
  return (item.writers||[]).some(w=>String(w.employeeId)!==String(me.employeeId)) || REPORT_FIELDS.some(k=>(item[k]||'').split('\n').some(l=>{const h=parseWriterHeader(l);return h&&h.name!==me.employeeName;}));
}
export const hasOwnSection = (item,me) => REPORT_FIELDS.some(k=>(item[k]||'').split('\n').some(l=>parseWriterHeader(l)?.name===me.employeeName));
export const canDeleteReportItem = (item,me) => ownsReportItem(item,me) && (!sharedReportItem(item,me)||hasOwnSection(item,me));
// Remove every own section, preserving unlabelled text and other writers.
export function withoutOwnSections(text, name) {
  let removing=false;
  return (text||'').split('\n').filter(line=>{const h=parseWriterHeader(line);if(h)removing=h.name===name;return !removing;}).join('\n').trim();
}
