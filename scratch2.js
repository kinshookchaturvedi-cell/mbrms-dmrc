function badge(result, verifiedLabel, failedLabel) {
  if (!result || result.status === 'pending') return `<span class="verify-badge verify-pending">Pending</span>`;
  const labels = { pending: 'Pending', verified: verifiedLabel || 'Found', partial: 'Partial Match', failed: failedLabel || 'Not Found' };
  const cls = `verify-${result.status}`;
  return `<span class="verify-badge ${cls}" title="${result.snippet ? result.snippet.replace(/<[^>]+>/g, '') : ''}">${labels[result.status]}</span>`;
}

function renderVerifySummaryForHR(summaryStr, lineNo, testName) {
  if (!summaryStr) return '';
  try {
    const r = JSON.parse(summaryStr);
    const overallBanner = {
      verified: '<span class="verify-badge verify-verified"><i class="fa-solid fa-check"></i> Test confirmed in both documents</span>',
      partial: '<span class="verify-badge verify-partial"><i class="fa-solid fa-triangle-exclamation"></i> Partially confirmed — check manually</span>',
      failed: '<span class="verify-badge verify-failed"><i class="fa-solid fa-xmark"></i> Mismatch — test not found in one or both documents</span>',
      pending: '<span class="verify-badge verify-pending">Awaiting documents</span>',
    }[r.overall || 'pending'];

    const testNamesList = (testName || '').split(',').map(s => s.trim()).filter(s => s);
    
    let inBoth = [];
    let onlyInBill = [];
    let onlyInRx = [];
    let inNeither = [];

    const getTestStatus = (resObj, t) => {
      if (!resObj || !resObj.results) return 'pending';
      const found = resObj.results.find(x => x.test === t);
      return found ? found.status : 'pending';
    };

    for (const t of testNamesList) {
      const bStatus = getTestStatus(r.testInBill, t);
      const rStatus = getTestStatus(r.testInRx, t);
      const bFound = bStatus === 'verified';
      const rFound = rStatus === 'verified';
      if (bFound && rFound) inBoth.push(t);
      else if (bFound && !rFound) onlyInBill.push(t);
      else if (!bFound && rFound) onlyInRx.push(t);
      else inNeither.push(t);
    }

    const renderTestList = (title, list, colorCls, bgCls) => {
      if (list.length === 0) return '';
      return `<div class="mb-2 p-2 rounded-lg ${bgCls}">
        <p class="font-bold uppercase text-[9px] mb-1 ${colorCls}">${title}</p>
        <ul class="list-disc pl-3 text-[10px] text-slate-700 space-y-0.5 font-medium">${list.map(t => `<li>${t}</li>`).join('')}</ul>
      </div>`;
    };

    const combinedTestsHtml = `<div class="flex flex-col w-full pr-4">
      ${renderTestList('In both Invoice & Rx', inBoth, 'text-emerald-700', 'bg-emerald-50/50')}
      ${renderTestList('Only in Invoice', onlyInBill, 'text-amber-700', 'bg-amber-50/50')}
      ${renderTestList('Only in Rx', onlyInRx, 'text-amber-700', 'bg-amber-50/50')}
      ${renderTestList('Not found in either', inNeither, 'text-rose-700', 'bg-rose-50/50')}
      ${testNamesList.length === 0 ? '<span class="text-[10px] text-slate-400 italic">No tests entered</span>' : ''}
    </div>`;

    return `<div class="mt-3 border border-slate-200 rounded-xl overflow-hidden bg-white mb-4">
      <div class="px-4 py-2.5 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
        <p class="text-xs font-bold text-slate-700">Line ${String(lineNo).padStart(4, '0')} System Verification</p>
        ${overallBanner}
      </div>
      <div class="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-11 gap-3 text-[11px]">
        <div class="col-span-2 sm:col-span-4 lg:col-span-4"><p class="text-slate-400 font-bold uppercase text-[9px] mb-2">Tests</p>${combinedTestsHtml}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Patient (Bill)</p>${badge(r.patientInBill)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Patient (Rx)</p>${badge(r.patientInRx)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Bill #</p>${badge(r.billNumberMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Rx Ref #</p>${badge(r.rxNumberMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Bill Date</p>${badge(r.billDateMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Rx Date</p>${badge(r.rxDateMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Amount</p>${badge(r.amountMatch)}</div>
      </div>
    </div>`;
  } catch (e) {
    return '';
  }
}
