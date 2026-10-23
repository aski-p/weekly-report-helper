import { parseWriterHeader } from '../lib/writer-header.js';
export const REPORT_FIELDS = ['thisWeek', 'nextWeek', 'issue'];
export const ownsReportItem = (item, me) => (item.writers || []).some(w => String(w.employeeId) === String(me.employeeId));
export const reportClosed = report => report?.confirmed === true || report?.isConfirmed === true || report?.closed === true || report?.isClosed === true || /^(CONFIRMED|CLOSED|DONE|FINAL|확정|마감)$/i.test(String(report?.statusCode || report?.status || ''));
export const reportItemVersion = item => JSON.stringify([item.weeklyReportItemId, item.workKindCode, item.workId, item.workName, REPORT_FIELDS.map(k=>item[k]||''), (item.writers||[]).map(w=>[String(w.employeeId),w.employeeName]), item.updatedAt || item.modifiedAt || null]);
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
