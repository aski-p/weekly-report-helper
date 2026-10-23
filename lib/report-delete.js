import { REPORT_FIELDS, reportClosed, matchesReportItemVersion, ownsReportItem, sharedReportItem, hasOwnSection, withoutOwnSections } from '../shared/report-items.js';
const fail=(message,status=409,code='REPORT_CHANGED')=>Object.assign(new Error(message),{status,code});
export async function deleteReportItem(api,me,{year,week,itemId,version}) {
  const load=async()=>{
    const report=await api.getReport(year,week,me.buId);
    const item=report?.items?.find(i=>String(i.weeklyReportItemId)===String(itemId));
    if(!item)throw fail('이미 삭제된 항목입니다. 목록을 새로 불러와 주세요.',404,'NOT_FOUND');
    if(reportClosed(report)||reportClosed(item))throw fail('확정된 보고서는 삭제할 수 없습니다.',403,'REPORT_CLOSED');
    if(!ownsReportItem(item,me))throw fail('내가 작성한 항목만 삭제할 수 있습니다.',403,'FORBIDDEN');
    if(!matchesReportItemVersion(item,version))throw fail('보고서 내용이 변경되었습니다. 목록을 새로 불러온 뒤 다시 확인해 주세요.');
    return {report,item};
  };
  const {report,item}=await load();
  await api.lock(report.weeklyReportId,item.weeklyReportItemId);
  try {
    const current=await load();
    if(sharedReportItem(current.item,me)){
      if(!hasOwnSection(current.item,me)||(current.item.writers||[]).some(w=>String(w.employeeId)!==String(me.employeeId)&&w.employeeName===me.employeeName))throw fail('공동 항목에서 내 구역을 구분할 수 없어 삭제하지 않았습니다.',409,'SECTION_UNCLEAR');
      const fields=Object.fromEntries(REPORT_FIELDS.map(k=>[k,withoutOwnSections(current.item[k],me.employeeName)]));
      await api.updateItem(report.weeklyReportId,item.weeklyReportItemId,{workKindCode:current.item.workKindCode,workId:current.item.workId??null,workName:current.item.workName,...fields});
      return {deleted:true,mode:'section'};
    }
    await api.deleteItem(report.weeklyReportId,item.weeklyReportItemId);
    return {deleted:true,mode:'item'};
  } finally {await api.unlock(report.weeklyReportId,item.weeklyReportItemId).catch(()=>{});}
}
