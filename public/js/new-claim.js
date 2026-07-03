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

// Shared prescription state
let rxFile = null;
let rxChunks = null;

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
  return hospitalsData.map(h => `<option value="${h.hospital_name}">${h.hospital_name}</option>`).join('');
}

function addBillLine() {
  lineCounter++;
  const lineNo = lineCounter;
  lineState[lineNo] = { billFile: null, billChunks: null, testId: testMasterData[0]?.test_id || '', verifyResult: null };

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
    <td><select class="empanelledHospital">${hospitalOptions()}</select></td>
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
    <td><select class="testSelect">${testOptions()}</select></td>
    <td><input type="text" class="billNumber" placeholder="Bill #"></td>
    <td><input type="date" class="billDate"></td>
    <td><input type="number" class="deductions" value="0" min="0" step="0.01"></td>
    <td><input type="number" class="requestedAmount" value="0" min="0" step="0.01"></td>
    <td>
      <div class="relative">
        <label class="flex items-center gap-1.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-2 py-1.5 cursor-pointer w-full">
          <i class="fa-solid fa-paperclip"></i>
          <span class="line-pdf-label truncate">Attach PDF</span>
          <input type="file" class="line-pdf-input hidden" accept="application/pdf">
        </label>
        <div class="line-pdf-status text-[10px] mt-1 text-slate-400">No file yet</div>
      </div>
    </td>
  `;
  billBody.appendChild(tr);
  tr.querySelector('.testSelect').value = lineState[lineNo].testId;
  tr.querySelector('.testSelect').addEventListener('change', (e) => {
    lineState[lineNo].testId = e.target.value;
    lineState[lineNo].verifyResult = null;
    renderVerifyResults();
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

  const pdfInput = tr.querySelector('.line-pdf-input');
  pdfInput.addEventListener('change', () => { if (pdfInput.files[0]) handleLineFile(lineNo, tr, pdfInput.files[0]); });

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
    const testId = tr.querySelector('.testSelect').value;
    const test = testMasterById[testId];
    return {
      lineNo,
      hospitalStatus: tr.querySelector('.hospitalStatus').value,
      empanelledHospital: tr.querySelector('.empanelledHospital').value,
      nameOfHospital: tr.querySelector('.empanelledHospital').value,
      billTreatmentType: tr.querySelector('.billTreatmentType').value,
      descriptionOfExpense: test ? test.canonical_name : '',
      billNumber: tr.querySelector('.billNumber').value,
      billDate: tr.querySelector('.billDate').value,
      deductions: tr.querySelector('.deductions').value,
      remarksDeduction: '',
      requestedAmount: tr.querySelector('.requestedAmount').value,
      admissibleAmount: '',
      verificationStatus: lineState[lineNo]?.verifyResult?.overall || 'pending',
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

// ---------- PRESCRIPTION UPLOAD ----------
const rxUploadZone = document.getElementById('rxUploadZone');
const rxFileInput = document.getElementById('rxFileInput');
const rxProgressWrap = document.getElementById('rxProgressWrap');
const rxProgLabel = document.getElementById('rxProgLabel');
const rxProgPct = document.getElementById('rxProgPct');
const rxProgFill = document.getElementById('rxProgFill');

rxFileInput.addEventListener('change', () => { if (rxFileInput.files[0]) handleRxFile(rxFileInput.files[0]); });
rxUploadZone.addEventListener('dragover', e => { e.preventDefault(); rxUploadZone.classList.add('border-blue-400'); });
rxUploadZone.addEventListener('dragleave', () => rxUploadZone.classList.remove('border-blue-400'));
rxUploadZone.addEventListener('drop', e => {
  e.preventDefault(); rxUploadZone.classList.remove('border-blue-400');
  if (e.dataTransfer.files[0]?.type === 'application/pdf') handleRxFile(e.dataTransfer.files[0]);
});

async function handleRxFile(file) {
  if (file.size > 2 * 1024 * 1024) { showToast('File exceeds 2MB limit', 'error'); return; }
  rxFile = file;
  rxChunks = null;
  document.getElementById('rxUploadLabel').textContent = file.name;
  document.getElementById('uploadedPrescription').checked = true;
  rxProgressWrap.classList.remove('hidden');
  setRxProgress(0, 'Reading...');
  try {
    const { chunks } = await Verifier.processFile(file, setRxProgress);
    rxChunks = chunks;
    setRxProgress(100, 'Ready');
    showToast('Prescription processed — re-verifying all lines against it', 'success');
    verifyAllLines();
  } catch (err) {
    showToast('Could not process the prescription PDF', 'error');
    rxProgressWrap.classList.add('hidden');
  }
}
function setRxProgress(pct, label) {
  rxProgFill.style.width = pct + '%';
  rxProgPct.textContent = Math.round(pct) + '%';
  rxProgLabel.textContent = label;
}

// ---------- CROSS-VERIFICATION ----------
function verifyLine(lineNo) {
  const state = lineState[lineNo];
  if (!state) return;
  const test = testMasterById[state.testId];
  const tr = document.querySelector(`#billBody tr[data-line="${lineNo}"]`);
  if (!tr || !test) return;

  const billNumber = tr.querySelector('.billNumber').value;
  const billDate = tr.querySelector('.billDate').value;
  const requestedAmount = tr.querySelector('.requestedAmount').value;
  const patientName = requestForEl.value;

  const result = { lineNo, testName: test.canonical_name };

  if (state.billChunks) {
    result.testInBill = Verifier.matchLabelInChunks(test.bill_label || test.canonical_name, state.billChunks, 0.35);
    result.patientInBill = Verifier.matchLabelInChunks(patientName, state.billChunks, 0.35);
    result.billNumberMatch = billNumber
      ? Verifier.verifyValue(billNumber, { anchor: 'bill', inputType: 'text' }, state.billChunks, 0.4, 100)
      : { status: 'pending' };
    result.billDateMatch = billDate
      ? Verifier.verifyValue(billDate, { anchor: 'date', inputType: 'date' }, state.billChunks, 0.4, 100)
      : { status: 'pending' };
    result.amountMatch = requestedAmount && parseFloat(requestedAmount) > 0
      ? Verifier.verifyValue(requestedAmount, { anchor: 'amount', inputType: 'amount', noAnchorNeeded: true }, state.billChunks, 0.4, 100)
      : { status: 'pending' };
  } else {
    result.testInBill = { status: 'pending' };
    result.patientInBill = { status: 'pending' };
    result.billNumberMatch = { status: 'pending' };
    result.billDateMatch = { status: 'pending' };
    result.amountMatch = { status: 'pending' };
  }

  if (rxChunks) {
    result.testInRx = Verifier.matchLabelInChunks(test.prescription_label || test.canonical_name, rxChunks, 0.35);
    result.patientInRx = Verifier.matchLabelInChunks(patientName, rxChunks, 0.35);
  } else {
    result.testInRx = { status: 'pending' };
    result.patientInRx = { status: 'pending' };
  }

  // Overall line status: verified only if the test was found in BOTH documents
  const statuses = [result.testInBill.status, result.testInRx.status];
  if (statuses.includes('failed')) result.overall = 'failed';
  else if (statuses.every(s => s === 'verified')) result.overall = 'verified';
  else if (statuses.some(s => s === 'verified' || s === 'partial')) result.overall = 'partial';
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
    const test = testMasterById[state.testId];
    if (!r) {
      return `<div class="border border-slate-100 rounded-xl p-4 bg-slate-50/40">
        <p class="text-xs font-bold text-slate-500">Line ${String(lineNo).padStart(4, '0')} — ${test ? test.canonical_name : ''}</p>
        <p class="text-[11px] text-slate-400 mt-1">Attach this line's bill PDF to verify.</p>
      </div>`;
    }
    const overallBanner = {
      verified: '<span class="verify-badge verify-verified"><i class="fa-solid fa-check"></i> Test confirmed in both documents</span>',
      partial: '<span class="verify-badge verify-partial"><i class="fa-solid fa-triangle-exclamation"></i> Partially confirmed — check manually</span>',
      failed: '<span class="verify-badge verify-failed"><i class="fa-solid fa-xmark"></i> Mismatch — test not found in one or both documents</span>',
      pending: '<span class="verify-badge verify-pending">Awaiting documents</span>',
    }[r.overall];

    return `<div class="border border-slate-200 rounded-xl overflow-hidden">
      <div class="px-4 py-2.5 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
        <p class="text-xs font-bold text-slate-700">Line ${String(lineNo).padStart(4, '0')} — ${r.testName}</p>
        ${overallBanner}
      </div>
      <div class="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-[11px]">
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Test in Bill</p>${badge(r.testInBill)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Test in Prescription</p>${badge(r.testInRx)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Patient (Bill)</p>${badge(r.patientInBill)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Patient (Rx)</p>${badge(r.patientInRx)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Bill Number</p>${badge(r.billNumberMatch)}</div>
        <div><p class="text-slate-400 font-bold uppercase text-[9px] mb-1">Bill Date</p>${badge(r.billDateMatch)}</div>
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
  const missingPdf = Object.keys(lineState).some(l => !lineState[l].billFile);
  if (missingPdf) {
    showToast('Please attach a bill/invoice PDF for every line item', 'error');
    return;
  }
  if (!rxFile) {
    showToast('Please upload the doctor\'s prescription PDF', 'error');
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

    // Upload the prescription once, tagged at claim level
    const rxForm = new FormData();
    rxForm.append('file', rxFile);
    rxForm.append('claimId', claimId);
    rxForm.append('attachmentLevel', 'Prescription');
    await apiUpload(rxForm);

    // Upload each line's own bill/invoice PDF, tagged with its line number
    for (const lineNo of Object.keys(lineState)) {
      const file = lineState[lineNo].billFile;
      if (!file) continue;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('claimId', claimId);
      fd.append('attachmentLevel', 'Bill Line');
      fd.append('lineNumber', lineNo);
      await apiUpload(fd);
    }

    showToast(`Claim ${claimId} submitted successfully!`, 'success');
    setTimeout(() => { window.location.href = 'my-claims.html'; }, 1200);
  } catch (err) {
    showToast(err.error || 'Failed to submit claim', 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Claim';
  }
});
