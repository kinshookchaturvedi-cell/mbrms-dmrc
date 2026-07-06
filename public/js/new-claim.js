// new-claim.js
const session = requireRole('employee');
let dependentsData = [];
let hospitalsData = [];
let testMasterData = [];        // [{test_id, canonical_name, bill_label, prescription_label}]
let testMasterById = {};        // test_id -> row
let lineCounter = 0;

// Per-line runtime state, keyed by line number (string)
// { billFile, billChunks, testId, verifyResult: {...} }
const lineState = {};

// Shared prescription state (removed, now per-line)

const billBody = document.getElementById('billBody');
const reimbursementTypeEl = document.getElementById('reimbursementType');
const requestForEl = document.getElementById('requestFor');

function calcAge(dobStr) {
  const dob = new Date(dobStr);
  if (isNaN(dob)) return '--';
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

// ---------- INIT ----------
async function init() {
  if (!session) return;
  document.getElementById('userBadge').textContent = `${session.user.name} (${session.user.employee_id})`;

  document.getElementById('roomEntitlement').value = session.user.room_entitlement || '';
  document.getElementById('employmentStatus').value = session.user.employment_status || '';
  document.getElementById('payScale').value = session.user.pay_scale || '';
  document.getElementById('mobile').value = session.user.mobile || '';
  document.getElementById('email').value = session.user.email || '';

  const [reimTypes, dep, hospitals, testMaster] = await Promise.all([
    apiGet('/reimbursement-types'),
    apiGet(`/employee/${session.user.employee_id}`),
    apiGet('/hospitals'),
    apiGet('/test-master'),
  ]);

  reimbursementTypeEl.innerHTML = reimTypes.map(t => `<option value="${t.type_name}">${t.type_name}</option>`).join('');
  dependentsData = dep.dependents;
  hospitalsData = hospitals;
  testMasterData = testMaster.filter(t => t.canonical_name); // drop blank rows
  testMasterData.forEach(t => { testMasterById[t.test_id] = t; });

  requestForEl.innerHTML = dependentsData.map(d => `<option value="${d.name}">${d.relationship} — ${d.name}</option>`).join('');

  document.getElementById('dependentsBody').innerHTML = dependentsData.map(d => `
    <tr>
      <td>${d.relationship}</td>
      <td>${d.name}</td>
      <td>${d.gender}</td>
      <td>${fmtDate(d.date_of_birth)}</td>
      <td>${calcAge(d.date_of_birth)}</td>
    </tr>`).join('');

  addBillLine(); // start with one line, like the real portal
}
init();

// ---------- FIELD VALIDATION (live, format-level) ----------
function attachValidation(id, validatorFn, errId) {
  const el = document.getElementById(id);
  const errEl = document.getElementById(errId);
  function run() {
    const result = validatorFn(el.value);
    if (el.value === '') { el.style.borderColor = ''; if (errEl) errEl.classList.add('hidden'); return; }
    if (result === true) {
      el.style.borderColor = '#16a34a';
      if (errEl) errEl.classList.add('hidden');
    } else {
      el.style.borderColor = '#dc2626';
      if (errEl) { errEl.textContent = result; errEl.classList.remove('hidden'); errEl.style.color = '#dc2626'; }
    }
  }
  el.addEventListener('input', run);
  el.addEventListener('blur', run);
}

attachValidation('mobile', v => /^[6-9][0-9]{9}$/.test(v) ? true : 'Enter a valid 10-digit Indian mobile number', 'mobileErr');
attachValidation('email', v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? true : 'Enter a valid e-mail address', 'emailErr');

// ---------- BILL LINE ITEMS ----------
function testOptions() {
  return testMasterData.map(t => `<option value="${t.test_id}">${t.canonical_name}</option>`).join('');
}
function hospitalOptions() {
  const sorted = [...hospitalsData].sort((a, b) => a.hospital_name.localeCompare(b.hospital_name));
  return sorted.map(h => `<option value="${h.hospital_name}">${h.hospital_name}</option>`).join('') + `<option value="Other">Other</option>`;
}

function addBillLine() {
  lineCounter++;
  const lineNo = lineCounter;
  lineState[lineNo] = { billFile: null, billChunks: null, rxFile: null, rxChunks: null, testNames: '', verifyResult: null };

  const tr = document.createElement('tr');
  tr.dataset.line = lineNo;
  tr.innerHTML = `
    <td class="text-center"><input type="checkbox" class="line-select"></td>
    <td class="text-center font-bold text-slate-500">${String(lineNo).padStart(4, '0')}</td>
    <td>
      <select class="hospitalStatus">
        <option value="NOMINATED">NOMINATED</option>
        <option value="EMPANELLED">EMPANELLED</option>
      </select>
    </td>
    <td>
      <div class="flex flex-col gap-1">
        <select class="rxHospitalSelect text-xs p-1 border rounded w-full"><option value="">-- Rx Hospital --</option>${hospitalOptions()}</select>
        <input type="text" class="rxHospitalInput hidden text-xs p-1 border rounded w-full" placeholder="Enter Rx Hospital">
      </div>
    </td>
    <td>
      <div class="flex flex-col gap-1">
        <select class="billHospitalSelect text-xs p-1 border rounded w-full"><option value="">-- Bill Hospital --</option>${hospitalOptions()}</select>
        <input type="text" class="billHospitalInput hidden text-xs p-1 border rounded w-full" placeholder="Enter Bill Hospital">
      </div>
    </td>
    <td>
      <select class="billTreatmentType">
        <option value="Pathology/Diagnostics">Pathology/Diagnostics</option>
        <option value="Consultation">Consultation</option>
        <option value="Medicines/Pharmacy">Medicines/Pharmacy</option>
        <option value="Room Charges">Room Charges</option>
        <option value="Surgery/Procedure">Surgery/Procedure</option>
        <option value="Other">Other</option>
      </select>
    </td>
    <td><input type="text" class="testInput" placeholder="e.g. CBC, X-Ray"></td>
    <td><input type="text" class="billNumber" placeholder="Bill #"></td>
    <td><input type="text" class="rxNumber" placeholder="Rx Ref #"></td>
    <td><input type="date" class="rxDate"></td>
    <td><input type="date" class="billDate"></td>
    <td><input type="number" class="deductions" value="0" min="0" step="0.01"></td>
    <td><input type="number" class="requestedAmount" value="0" min="0" step="0.01"></td>
    <td>
      <div class="relative">
        <label class="flex items-center gap-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-2 py-1.5 cursor-pointer w-full">
          <i class="fa-solid fa-paperclip"></i>
          <span class="line-pdf-label truncate">Attach Bill</span>
          <input type="file" class="line-pdf-input hidden" accept="application/pdf">
        </label>
        <div class="line-pdf-status text-[10px] mt-1 text-slate-400">No file yet</div>
      </div>
    </td>
    <td>
      <div class="relative">
        <label class="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2 py-1.5 cursor-pointer w-full">
          <i class="fa-solid fa-paperclip"></i>
          <span class="line-rx-label truncate">Attach Rx</span>
          <input type="file" class="line-rx-input hidden" accept="application/pdf">
        </label>
        <div class="line-rx-status text-[10px] mt-1 text-slate-400">No file yet</div>
      </div>
    </td>
  `;
  billBody.appendChild(tr);
  tr.querySelector('.testInput').value = lineState[lineNo].testNames || '';
  tr.querySelector('.testInput').addEventListener('input', (e) => {
    lineState[lineNo].testNames = e.target.value;
    lineState[lineNo].verifyResult = null;
    renderVerifyResults();
  });
  tr.querySelector('.testInput').addEventListener('blur', () => {
    verifyLine(lineNo);
  });

  tr.querySelector('.requestedAmount').addEventListener('input', recalcTotal);
  tr.querySelector('.deductions').addEventListener('input', recalcTotal);

  const dateEl = tr.querySelector('.billDate');
  dateEl.addEventListener('change', () => {
    const today = new Date().toISOString().slice(0, 10);
    if (dateEl.value > today) {
      dateEl.style.borderColor = '#dc2626';
      showToast('Bill date cannot be in the future', 'error');
    } else {
      dateEl.style.borderColor = '#16a34a';
    }
  });

  const rxDateEl = tr.querySelector('.rxDate');
  rxDateEl.addEventListener('change', () => {
    const today = new Date().toISOString().slice(0, 10);
    if (rxDateEl.value > today) {
      rxDateEl.style.borderColor = '#dc2626';
      showToast('Prescription date cannot be in the future', 'error');
    } else {
      rxDateEl.style.borderColor = '#16a34a';
    }
  });

  const pdfInput = tr.querySelector('.line-pdf-input');
  pdfInput.addEventListener('change', () => { if (pdfInput.files[0]) handleLineFile(lineNo, tr, pdfInput.files[0]); });

  const rxPdfInput = tr.querySelector('.line-rx-input');
  rxPdfInput.addEventListener('change', () => { if (rxPdfInput.files[0]) handleLineRxFile(lineNo, tr, rxPdfInput.files[0]); });

  const rxSelect = tr.querySelector('.rxHospitalSelect');
  const rxInput = tr.querySelector('.rxHospitalInput');
  rxSelect.addEventListener('change', (e) => {
    if (e.target.value === 'Other') rxInput.classList.remove('hidden');
    else rxInput.classList.add('hidden');
  });

  const billSelect = tr.querySelector('.billHospitalSelect');
  const billInput = tr.querySelector('.billHospitalInput');
  billSelect.addEventListener('change', (e) => {
    if (e.target.value === 'Other') billInput.classList.remove('hidden');
    else billInput.classList.add('hidden');
  });

  recalcTotal();
}
document.getElementById('addLineBtn').addEventListener('click', addBillLine);

document.getElementById('deleteLineBtn').addEventListener('click', () => {
  document.querySelectorAll('.line-select:checked').forEach(cb => {
    const tr = cb.closest('tr');
    delete lineState[tr.dataset.line];
    tr.remove();
  });
  recalcTotal();
  renderVerifyResults();
});
document.getElementById('selectAllLines').addEventListener('change', (e) => {
  document.querySelectorAll('.line-select').forEach(cb => cb.checked = e.target.checked);
});

function recalcTotal() {
  let total = 0;
  document.querySelectorAll('#billBody tr').forEach(tr => {
    const req = parseFloat(tr.querySelector('.requestedAmount').value) || 0;
    const ded = parseFloat(tr.querySelector('.deductions').value) || 0;
    total += Math.max(0, req - ded);
  });
  document.getElementById('requestedAmount').value = total.toFixed(2);
}
document.getElementById('calculateBtn').addEventListener('click', recalcTotal);

function getBillLines() {
  return Array.from(document.querySelectorAll('#billBody tr')).map(tr => {
    const lineNo = tr.dataset.line;
    return {
      lineNo,
      hospitalStatus: tr.querySelector('.hospitalStatus').value,
      rxHospital: tr.querySelector('.rxHospitalSelect').value === 'Other' ? tr.querySelector('.rxHospitalInput').value : tr.querySelector('.rxHospitalSelect').value,
      empanelledHospital: tr.querySelector('.billHospitalSelect').value === 'Other' ? tr.querySelector('.billHospitalInput').value : tr.querySelector('.billHospitalSelect').value,
      nameOfHospital: tr.querySelector('.billHospitalSelect').value === 'Other' ? tr.querySelector('.billHospitalInput').value : tr.querySelector('.billHospitalSelect').value,
      billTreatmentType: tr.querySelector('.billTreatmentType').value,
      descriptionOfExpense: tr.querySelector('.testInput').value,
      billNumber: tr.querySelector('.billNumber').value,
      prescriptionRefNumber: tr.querySelector('.rxNumber').value,
      prescriptionDate: tr.querySelector('.rxDate').value,
      billDate: tr.querySelector('.billDate').value,
      deductions: tr.querySelector('.deductions').value,
      remarksDeduction: '',
      requestedAmount: tr.querySelector('.requestedAmount').value,
      admissibleAmount: '',
      verificationStatus: lineState[lineNo]?.verifyResult?.overall || 'pending',
      verificationSummary: lineState[lineNo]?.verifyResult ? JSON.stringify(lineState[lineNo].verifyResult) : '',
    };
  });
}

// ---------- PER-LINE BILL PDF UPLOAD ----------
async function handleLineFile(lineNo, tr, file) {
  if (file.size > 2 * 1024 * 1024) { showToast('File exceeds 2MB limit', 'error'); return; }
  lineState[lineNo].billFile = file;
  lineState[lineNo].billChunks = null;
  lineState[lineNo].verifyResult = null;

  const labelEl = tr.querySelector('.line-pdf-label');
  const statusEl = tr.querySelector('.line-pdf-status');
  labelEl.textContent = file.name;
  statusEl.textContent = 'Reading PDF...';
  statusEl.className = 'line-pdf-status text-[10px] mt-1 text-amber-600 font-semibold';

  try {
    const { chunks } = await Verifier.processFile(file, (pct, label) => {
      statusEl.textContent = `${label} (${Math.round(pct)}%)`;
    });
    lineState[lineNo].billChunks = chunks;
    statusEl.textContent = 'Ready — verifying...';
    statusEl.className = 'line-pdf-status text-[10px] mt-1 text-blue-600 font-semibold';
    document.getElementById('uploadedBills').checked = true;
    verifyLine(lineNo);
  } catch (err) {
    statusEl.textContent = 'Could not read this PDF';
    statusEl.className = 'line-pdf-status text-[10px] mt-1 text-rose-600 font-semibold';
  }
}

async function handleLineRxFile(lineNo, tr, file) {
  if (file.size > 2 * 1024 * 1024) { showToast('File exceeds 2MB limit', 'error'); return; }
  lineState[lineNo].rxFile = file;
  lineState[lineNo].rxChunks = null;
  lineState[lineNo].verifyResult = null;

  const labelEl = tr.querySelector('.line-rx-label');
  const statusEl = tr.querySelector('.line-rx-status');
  labelEl.textContent = file.name;
  statusEl.textContent = 'Reading PDF...';
  statusEl.className = 'line-rx-status text-[10px] mt-1 text-amber-600 font-semibold';

  try {
    const { chunks } = await Verifier.processFile(file, (pct, label) => {
      statusEl.textContent = `${label} (${Math.round(pct)}%)`;
    });
    lineState[lineNo].rxChunks = chunks;
    statusEl.textContent = 'Ready — verifying...';
    statusEl.className = 'line-rx-status text-[10px] mt-1 text-emerald-600 font-semibold';
    document.getElementById('uploadedPrescription').checked = true;
    verifyLine(lineNo);
  } catch (err) {
    statusEl.textContent = 'Could not read this PDF';
    statusEl.className = 'line-rx-status text-[10px] mt-1 text-rose-600 font-semibold';
  }
}

// ---------- CROSS-VERIFICATION ----------
function verifyLine(lineNo) {
  const state = lineState[lineNo];
  if (!state) return;
  const tr = document.querySelector(`#billBody tr[data-line="${lineNo}"]`);
  if (!tr) return;

  const billNumber = tr.querySelector('.billNumber').value;
  const rxNumber = tr.querySelector('.rxNumber').value;
  const rxDate = tr.querySelector('.rxDate').value;
  const billDate = tr.querySelector('.billDate').value;
  const requestedAmount = tr.querySelector('.requestedAmount').value;
  const patientName = requestForEl.value;

  const testNamesStr = state.testNames || '';
  const testNames = testNamesStr.split(',').map(s => s.trim()).filter(s => s);

  const result = { lineNo, testName: testNamesStr };

  function evaluateTests(chunks) {
    if (!chunks || testNames.length === 0) return { status: 'pending', results: [] };
    let allFound = true;
    let anyFound = false;
    let results = [];
    for (const t of testNames) {
      const m = Verifier.matchLabelInChunks(t, chunks, 0.40);
      results.push({ test: t, ...m });
      if (m.status === 'verified') anyFound = true;
      if (m.status === 'failed' || m.status === 'pending' || m.status === 'partial') allFound = false;
    }
    return {
      status: allFound ? 'verified' : (anyFound ? 'partial' : 'failed'),
      results
    };
  }

  if (state.billChunks) {
    result.testInBill = evaluateTests(state.billChunks);
    result.patientInBill = Verifier.matchLabelInChunks(patientName, state.billChunks, 0.45);
    result.billNumberMatch = billNumber
      ? Verifier.verifyValue(billNumber, { anchor: 'bill', inputType: 'text', noAnchorNeeded: true }, state.billChunks, 0.4, 100)
      : { status: 'pending' };
    result.billDateMatch = billDate
      ? Verifier.verifyValue(billDate, { anchor: 'date', inputType: 'date', noAnchorNeeded: true }, state.billChunks, 0.01, 100)
      : { status: 'pending' };
    result.amountMatch = requestedAmount && parseFloat(requestedAmount) > 0
      ? Verifier.verifyValue(requestedAmount, { anchor: 'amount', inputType: 'amount', noAnchorNeeded: true }, state.billChunks, 0.01, 100)
      : { status: 'pending' };
  } else {
    result.testInBill = { status: 'pending' };
    result.patientInBill = { status: 'pending' };
    result.billNumberMatch = { status: 'pending' };
    result.billDateMatch = { status: 'pending' };
    result.amountMatch = { status: 'pending' };
  }

  if (state.rxChunks) {
    result.testInRx = evaluateTests(state.rxChunks);
    result.patientInRx = Verifier.matchLabelInChunks(patientName, state.rxChunks, 0.45);
    result.rxNumberMatch = rxNumber
      ? Verifier.verifyValue(rxNumber, { anchor: 'prescription', inputType: 'text', noAnchorNeeded: true }, state.rxChunks, 0.4, 100)
      : { status: 'pending' };
    result.rxDateMatch = rxDate
      ? Verifier.verifyValue(rxDate, { anchor: 'date', inputType: 'date', noAnchorNeeded: true }, state.rxChunks, 0.01, 100)
      : { status: 'pending' };
  } else {
    result.testInRx = { status: 'pending' };
    result.patientInRx = { status: 'pending' };
    result.rxNumberMatch = { status: 'pending' };
    result.rxDateMatch = { status: 'pending' };
  }

  // Overall line status: consider tests and all other fields
  const otherFields = [
    result.patientInBill, result.patientInRx,
    result.billNumberMatch, result.rxNumberMatch,
    result.billDateMatch, result.rxDateMatch,
    result.amountMatch
  ].filter(f => f && f.status !== 'pending');

  const statuses = [result.testInBill.status, result.testInRx.status, ...otherFields.map(f => f.status)];
  
  if (statuses.includes('failed')) result.overall = 'failed';
  else if (statuses.includes('partial')) result.overall = 'partial';
  else if (statuses.every(s => s === 'verified')) result.overall = 'verified';
  else result.overall = 'pending';

  state.verifyResult = result;
  renderVerifyResults();
}

function verifyAllLines() {
  Object.keys(lineState).forEach(lineNo => verifyLine(lineNo));
}
document.getElementById('reverifyAllBtn').addEventListener('click', verifyAllLines);

function badge(result, verifiedLabel, failedLabel) {
  const labels = { pending: 'Pending', verified: verifiedLabel || 'Found', partial: 'Partial Match', failed: failedLabel || 'Not Found' };
  const cls = `verify-${result.status}`;
  return `<span class="verify-badge ${cls}" title="${result.snippet ? result.snippet.replace(/<[^>]+>/g, '') : ''}">${labels[result.status]}</span>`;
}

function renderVerifyResults() {
  const container = document.getElementById('verifyResults');
  const lines = Object.keys(lineState);
  if (lines.length === 0 || lines.every(l => !lineState[l].verifyResult)) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic bg-slate-50 rounded-lg p-4 text-center">Upload a bill PDF for each line item and the prescription above to run cross-verification.</p>`;
    return;
  }

  container.innerHTML = lines.map(lineNo => {
    const state = lineState[lineNo];
    const r = state.verifyResult;
    if (!r) {
      return `<div class="border border-slate-100 rounded-xl p-4 bg-slate-50/40">
        <p class="text-xs font-bold text-slate-500">Line ${String(lineNo).padStart(4, '0')} — ${state.testNames || ''}</p>
        <p class="text-[11px] text-slate-400 mt-1">Attach this line's bill PDF to verify.</p>
      </div>`;
    }
    const overallBanner = {
      verified: '<span class="verify-badge verify-verified"><i class="fa-solid fa-check"></i> Test confirmed in both documents</span>',
      partial: '<span class="verify-badge verify-partial"><i class="fa-solid fa-triangle-exclamation"></i> Partially confirmed — check manually</span>',
      failed: '<span class="verify-badge verify-failed"><i class="fa-solid fa-xmark"></i> Mismatch — test not found in one or both documents</span>',
      pending: '<span class="verify-badge verify-pending">Awaiting documents</span>',
    }[r.overall];

    const testNamesStr = state.testNames || '';
    const testNamesList = testNamesStr.split(',').map(s => s.trim()).filter(s => s);
    
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
      
      // If a document is pending (not uploaded), we don't want to show tests as "Missing" from it.
      // We will only calculate groupings if BOTH documents are processed.
      // But if user wants to see it immediately, we assume pending means not found.
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

    return `<div class="border border-slate-200 rounded-xl overflow-hidden">
      <div class="px-4 py-2.5 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
        <p class="text-xs font-bold text-slate-700">Line ${String(lineNo).padStart(4, '0')} — ${r.testName}</p>
        ${overallBanner}
      </div>
      <div class="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-11 gap-3 text-[11px]">
        <div class="col-span-2 sm:col-span-4 lg:col-span-4"><p class="text-slate-400 font-bold uppercase text-[9px] mb-2">Test Verification Summary</p>${combinedTestsHtml}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Patient (Bill)</p>${badge(r.patientInBill)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Patient (Rx)</p>${badge(r.patientInRx)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Bill Number</p>${badge(r.billNumberMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Rx Ref Number</p>${badge(r.rxNumberMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Bill Date</p>${badge(r.billDateMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Rx Date</p>${badge(r.rxDateMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Amount</p>${badge(r.amountMatch)}</div>
      </div>
    </div>`;
  }).join('');
}

// ---------- SUBMIT ----------
document.getElementById('claimForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!document.getElementById('mobile').reportValidity()) return;
  if (!/^[6-9][0-9]{9}$/.test(document.getElementById('mobile').value)) {
    showToast('Please enter a valid mobile number before submitting', 'error'); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.getElementById('email').value)) {
    showToast('Please enter a valid e-mail address before submitting', 'error'); return;
  }
  if (!document.getElementById('termsAccepted').checked) {
    showToast('Please accept the Terms and Conditions to proceed', 'error'); return;
  }
  const bills = getBillLines();
  if (bills.length === 0) { showToast('Add at least one bill line item', 'error'); return; }
  for (const b of bills) {
    if (!b.billNumber || !b.billDate || !b.requestedAmount || parseFloat(b.requestedAmount) <= 0) {
      showToast('Each bill line needs a Bill Number, Bill Date and a Requested Amount greater than 0', 'error');
      return;
    }
  }
  const missingPdf = Object.keys(lineState).some(l => !lineState[l].billFile || !lineState[l].rxFile);
  if (missingPdf) {
    showToast('Please attach both bill and prescription PDFs for every line item', 'error');
    return;
  }

  recalcTotal();
  const payload = {
    employeeId: session.user.employee_id,
    reimbursementType: reimbursementTypeEl.value,
    requestType: document.getElementById('requestType').value,
    requestedAmount: document.getElementById('requestedAmount').value,
    roomEntitlement: document.getElementById('roomEntitlement').value,
    employmentStatus: document.getElementById('employmentStatus').value,
    payScale: document.getElementById('payScale').value,
    outstationTreatment: document.getElementById('outstationTreatment').value,
    disease: document.getElementById('disease').value,
    mobile: document.getElementById('mobile').value,
    email: document.getElementById('email').value,
    requestFor: requestForEl.value,
    uploadedPrescription: true,
    uploadedBills: true,
    uploadedReports: document.getElementById('uploadedReports').checked,
    termsAccepted: document.getElementById('termsAccepted').checked,
    comments: document.getElementById('comments').value,
    bills,
  };

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

  try {
    const { claimId } = await apiPost('/claims', payload);

    // Upload each line's own bill/invoice and prescription PDF
    for (const lineNo of Object.keys(lineState)) {
      const bFile = lineState[lineNo].billFile;
      if (bFile) {
        const fd = new FormData();
        fd.append('file', bFile);
        fd.append('claimId', claimId);
        fd.append('attachmentLevel', 'Bill Line');
        fd.append('lineNumber', lineNo);
        await apiUpload(fd);
      }
      const rFile = lineState[lineNo].rxFile;
      if (rFile) {
        const fd = new FormData();
        fd.append('file', rFile);
        fd.append('claimId', claimId);
        fd.append('attachmentLevel', 'Prescription');
        fd.append('lineNumber', lineNo);
        await apiUpload(fd);
      }
    }

    showToast(`Claim ${claimId} submitted successfully!`, 'success');
    setTimeout(() => { window.location.href = 'my-claims.html'; }, 1200);
  } catch (err) {
    showToast(err.error || 'Failed to submit claim', 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Claim';
  }
});
