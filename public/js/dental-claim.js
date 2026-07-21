// dental-claim.js
const session = requireRole('employee');
let dependentsData = [];
let hospitalsData = [];
let dentalHospitalsRawData = [];
let cghsRatesData = [];

let billCounter = 0;
let itemCounter = 0;
const billState = {}; // { b1: { items: { i1: { verifyResult: null } }, billPdf: null, rxPdf: null, billChunks: null, rxChunks: null } }

const billsContainer = document.getElementById('billsContainer');
const reimbursementTypeEl = document.getElementById('reimbursementType');
const requestForEl = document.getElementById('requestFor');

function calcAge(dobStr) {
  const dob = new Date(dobStr);
  if (isNaN(dob)) return '--';
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

async function init() {
  if (!session) return;
  document.getElementById('userBadge').textContent = session.user.name + " (" + session.user.employee_id + ")";
  document.getElementById('roomEntitlement').value = session.user.room_entitlement || '';
  document.getElementById('employmentStatus').value = session.user.employment_status || '';
  document.getElementById('payScale').value = session.user.pay_scale || '';
  document.getElementById('mobile').value = session.user.mobile || '';
  document.getElementById('email').value = session.user.email || '';

  const [reimTypes, dep, dentalHospitalsRaw, cghsRatesRaw] = await Promise.all([
    apiGet('/reimbursement-types'),
    apiGet('/employee/' + session.user.employee_id),
    apiGet('/dental-hospitals'),
    apiGet('/dental-cghs-rates')
  ]);

  dentalHospitalsRawData = dentalHospitalsRaw;
  cghsRatesData = cghsRatesRaw;

  const uniqueHospSet = new Set();
  dentalHospitalsRaw.forEach(h => {
    const name = h['Hospital /Labs/ Clinics'];
    if (name && name.trim()) uniqueHospSet.add(name.trim());
  });
  hospitalsData = Array.from(uniqueHospSet).sort().map(name => ({ hospital_name: name }));

  reimbursementTypeEl.innerHTML = reimTypes.map(t => "<option value='" + t.type_name + "'>" + t.type_name + "</option>").join('');
  reimbursementTypeEl.value = 'Medical-Dental';
  reimbursementTypeEl.disabled = true;
  reimbursementTypeEl.classList.add('bg-slate-100', 'cursor-not-allowed', 'text-slate-500');
  
  reimbursementTypeEl.addEventListener('change', () => {
    if (reimbursementTypeEl.value !== 'Medical-Dental') {
      window.location.href = 'new-claim.html';
    }
  });

  dependentsData = dep.dependents;
  requestForEl.innerHTML = dependentsData.map(d => "<option value='" + d.name + "'>" + d.relationship + " — " + d.name + "</option>").join('');

  document.getElementById('dependentsBody').innerHTML = dependentsData.map(d => 
    "<tr><td>" + d.relationship + "</td><td>" + d.name + "</td><td>" + d.gender + "</td><td>" + fmtDate(d.date_of_birth) + "</td><td>" + calcAge(d.date_of_birth) + "</td></tr>"
  ).join('');

  addBillCard();
}
init();

function getExpenseInputHtml() {
  return "<select class='expenseType text-xs p-1 border rounded w-full'>" +
    "<option value=''>-- Select --</option>" +
    "<option value='CERAMIC CR'>Ceramic Crown</option>" +
    "<option value='COMP. FILL'>Composite Filling</option>" +
    "<option value='CROWNING'>Crowning Per Unit</option>" +
    "<option value='EXTRACTION'>Extraction Per Tooth</option>" +
    "<option value='FAC/DEC'>Extraction of Fractured/decayed Tooth</option>" +
    "<option value='RCT-ANTR'>Root Canal Treatment Anterior</option>" +
    "<option value='RCT-PSTR'>Root Canal Treatment Posterior</option>" +
    "<option value='SURGICAL'>Surgical Extraction Of Tooth</option>" +
    "<option value='TOOTH IMPL'>Tooth Implantation(Per Tooth)</option>" +
    "<option value='X-RAY'>X-Ray</option>" +
  "</select>";
}

function getHospitalInfo(hospitalName) {
  if (!hospitalName) return null;
  return dentalHospitalsRawData.find(h => h['Hospital /Labs/ Clinics'] && h['Hospital /Labs/ Clinics'].trim() === hospitalName.trim());
}

function updateItemPrice(row, bId) {
  const expenseType = row.querySelector('.expenseType').value;
  const card = document.querySelector(".bill-card[data-bill-id='" + bId + "']");
  if (!card) return;
  const hospitalStatus = card.querySelector('.hospitalStatus').value;
  const empHosp = card.querySelector('.empanelledHospital').value;
  const nonEmpHosp = card.querySelector('.nameOfHospital').value;
  const hospitalName = hospitalStatus === 'Empanelled' ? empHosp : nonEmpHosp;

  const expenseTypeSelect = row.querySelector('.expenseType');
  const expenseTypeText = expenseTypeSelect.value ? expenseTypeSelect.options[expenseTypeSelect.selectedIndex]?.text : '';
  const itemDesc = row.querySelector('.item-desc').value || '';
  const testName = (expenseTypeText + ' ' + itemDesc).trim();

  // ONLY search for the "item name" (itemDesc) as mentioned by the user for rate fetching
  const rateRow = findBestRateMatch(itemDesc);
  const cappingText = row.querySelector('.capping-text');
  if (rateRow) {
    let price = parseFloat(rateRow['NON_NABH LIMIT'] || 0); // default
    const hospInfo = getHospitalInfo(hospitalName);
    if (hospInfo) {
      const nabhStatus = (hospInfo['NABH/NON-NABH'] || '').toUpperCase();
      if (nabhStatus === 'NABH') price = parseFloat(rateRow['NABH LIMIT'] || 0);
      else if (nabhStatus === 'NON-NABH') price = parseFloat(rateRow['NON_NABH LIMIT'] || 0);
    }
    const teethStr = row.querySelector('.item-teeth').value;
    const teeth = (teethStr && parseInt(teethStr, 10) > 0) ? parseInt(teethStr, 10) : 1;
    const totalCap = price * teeth;
    cappingText.textContent = `Cap: ₹${totalCap}`;
    
    const priceInput = row.querySelector('.item-price');
    priceInput.max = totalCap;
    
    if (parseFloat(priceInput.value || 0) > totalCap) {
      priceInput.value = totalCap;
      recalcTotal();
    }
  } else {
    if (cappingText) cappingText.textContent = '';
  }
}

function findBestRateMatch(searchQuery) {
  if (!searchQuery || !searchQuery.trim()) return null;
  
  const query = searchQuery.toLowerCase().trim();
  
  const getRateName = (rate) => (rate['CGHS TREATMENT PROCEDURE/INVESTIGATION LIST '] || rate['CGHS TREATMENT PROCEDURE/INVESTIGATION LIST'] || '').toLowerCase();
  
  // 1. Try exact substring match first
  for (const rate of cghsRatesData) {
    const rateName = getRateName(rate);
    if (query.length >= 2 && rateName.includes(query)) return rate;
  }

  // 2. Fallback to fuzzy search
  const fuse = new Fuse(cghsRatesData, {
    keys: ['CGHS TREATMENT PROCEDURE/INVESTIGATION LIST ', 'CGHS TREATMENT PROCEDURE/INVESTIGATION LIST'],
    threshold: 0.8,
    ignoreLocation: true,
    ignoreFieldNorm: true,
    minMatchCharLength: 2,
    includeScore: true
  });
  
  const results = fuse.search(query);
  if (results.length > 0) return results[0].item;
  
  return null;
}

function addBillCard() {
  billCounter++;
  const bId = 'b' + billCounter;
  billState[bId] = { items: {}, billPdf: null, rxPdf: null, billChunks: null, rxChunks: null };

  const empHospHtml = "<option value=''>-- Select Hospital --</option>" + hospitalsData.map(h => "<option value='" + h.hospital_name + "'>" + h.hospital_name + "</option>").join('');

  const div = document.createElement('div');
  div.className = "bill-card bg-slate-50 border border-slate-200 rounded-xl p-5 mb-4 relative";
  div.dataset.billId = bId;
  div.innerHTML = 
    "<button type='button' class='absolute top-4 right-4 text-rose-500 hover:text-rose-700 text-sm delete-bill-btn'><i class='fa-solid fa-trash'></i></button>" +
    "<h4 class='font-bold text-sm text-slate-800 mb-3'>Invoice / Bill #" + billCounter + "</h4>" +
    "<div class='grid grid-cols-1 md:grid-cols-4 gap-4 mb-4'>" +
        "<div><label class='field-label'>Hospital Status <span class='req'>*</span></label><select class='field-input hospitalStatus'><option value=''>-- Select --</option><option value='Empanelled'>Empanelled</option><option value='Non-Empanelled'>Non-Empanelled</option></select></div>" +
        "<div><label class='field-label'>Hospital Name <span class='req'>*</span></label><select class='field-input empanelledHospital hidden'>" + empHospHtml + "</select><input type='text' class='field-input nameOfHospital hidden' placeholder='Enter Hospital Name'><div class='hosp-info-text text-[10px] text-blue-600 mt-1 font-semibold min-h-[15px]'></div></div>" +
        "<div><label class='field-label'>Bill No. <span class='req'>*</span></label><input type='text' class='field-input billNumber'></div>" +
        "<div><label class='field-label'>Bill Date <span class='req'>*</span></label><input type='date' class='field-input billDate'></div>" +
    "</div>" +
    "<div class='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>" +
        "<div><label class='field-label'>Bill PDF <span class='req'>*</span></label><input type='file' class='field-input billPdf' accept='application/pdf'><div class='billPdfStatus text-[10px] mt-1 text-slate-400'></div></div>" +
        "<div><label class='field-label'>Prescription PDF</label><input type='file' class='field-input rxPdf' accept='application/pdf'><div class='rxPdfStatus text-[10px] mt-1 text-slate-400'></div></div>" +
    "</div>" +
    "<div class='border border-slate-200 rounded-lg bg-white overflow-hidden'>" +
        "<div class='bg-slate-100 px-3 py-2 text-[10px] font-bold text-slate-600 uppercase flex justify-between items-center'><span>Bill Items</span></div>" +
        "<div class='bill-items-container p-3 space-y-2'></div>" +
        "<div class='bg-slate-50 border-t border-slate-100 px-3 py-3'>" +
            "<div class='flex justify-between items-center mb-3'>" +
                "<button type='button' class='text-xs font-bold text-blue-600 hover:underline add-item-btn'><i class='fa-solid fa-plus'></i> Add Item</button>" +
                "<div class='flex gap-4 text-xs'>" +
                    "<div class='flex items-center gap-2'><label class='font-bold text-slate-600'>Discount (₹)</label><input type='number' class='field-input !py-1 w-20 bill-discount' min='0' value='0' step='0.01'></div>" +
                    "<div class='flex items-center gap-2'><label class='font-bold text-slate-600'>GST (₹)</label><input type='number' class='field-input !py-1 w-20 bill-gst' min='0' value='0' step='0.01'></div>" +
                "</div>" +
            "</div>" +
            "<div class='flex justify-end'>" +
                "<div class='text-sm font-black text-slate-800 bg-slate-200/50 px-4 py-2 rounded-lg'>Bill Total: ₹<span class='bill-total-span'>0.00</span></div>" +
            "</div>" +
        "</div>" +
    "</div>";

  billsContainer.appendChild(div);

  div.querySelector('.delete-bill-btn').addEventListener('click', () => {
    delete billState[bId];
    div.remove();
    recalcTotal();
    renderVerifyResults();
  });

  div.querySelector('.add-item-btn').addEventListener('click', () => addItemToBill(bId, div.querySelector('.bill-items-container')));
  div.querySelector('.bill-gst').addEventListener('input', recalcTotal);
  div.querySelector('.bill-discount').addEventListener('input', recalcTotal);

  const trgVerify = () => verifyBillItems(bId);
  div.querySelector('.billNumber').addEventListener('blur', trgVerify);
  div.querySelector('.billDate').addEventListener('blur', trgVerify);

  const statusEl = div.querySelector('.hospitalStatus');
  const empHosp = div.querySelector('.empanelledHospital');
  const nonEmpHosp = div.querySelector('.nameOfHospital');
  const hospInfoText = div.querySelector('.hosp-info-text');
  
  const updateHospitalInfoDisplay = () => {
    const status = div.querySelector('.hospitalStatus').value;
    const hName = status === 'Empanelled' ? empHosp.value : nonEmpHosp.value;
    const hInfo = getHospitalInfo(hName);
    if (hInfo) {
      hospInfoText.innerHTML = `<i class='fa-solid fa-circle-info'></i> ${hInfo['NABH/NON-NABH']} | CGHS: ${hInfo['CGHS Status']}`;
    } else {
      hospInfoText.innerHTML = '';
    }
  };
  
  const updateAllPrices = () => {
    updateHospitalInfoDisplay();
    div.querySelectorAll('.item-row').forEach(row => updateItemPrice(row, bId));
  };
  empHosp.addEventListener('change', updateAllPrices);
  nonEmpHosp.addEventListener('blur', updateAllPrices);
  
  statusEl.addEventListener('change', () => {
    if (statusEl.value === 'Empanelled') {
      empHosp.classList.remove('hidden');
      nonEmpHosp.classList.add('hidden');
    } else if (statusEl.value === 'Non-Empanelled') {
      empHosp.classList.add('hidden');
      nonEmpHosp.classList.remove('hidden');
    } else {
      empHosp.classList.add('hidden');
      nonEmpHosp.classList.add('hidden');
    }
    updateAllPrices();
  });

  // File processors
  div.querySelector('.billPdf').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const status = div.querySelector('.billPdfStatus');
    if (!file) return;
    billState[bId].billPdf = file;
    status.textContent = 'Reading...';
    try {
      const { chunks } = await Verifier.processFile(file, (pct) => status.textContent = 'Reading (' + Math.round(pct) + '%)');
      billState[bId].billChunks = chunks;
      status.textContent = 'Ready';
      status.className = 'billPdfStatus text-[10px] mt-1 text-blue-600 font-bold';
      verifyBillItems(bId);
    } catch (e) {
      status.textContent = 'Failed';
      status.className = 'billPdfStatus text-[10px] mt-1 text-rose-600 font-bold';
    }
  });

  div.querySelector('.rxPdf').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const status = div.querySelector('.rxPdfStatus');
    if (!file) return;
    billState[bId].rxPdf = file;
    status.textContent = 'Reading...';
    try {
      const { chunks } = await Verifier.processFile(file, (pct) => status.textContent = 'Reading (' + Math.round(pct) + '%)');
      billState[bId].rxChunks = chunks;
      status.textContent = 'Ready';
      status.className = 'rxPdfStatus text-[10px] mt-1 text-emerald-600 font-bold';
      verifyBillItems(bId);
    } catch (e) {
      status.textContent = 'Failed';
      status.className = 'rxPdfStatus text-[10px] mt-1 text-rose-600 font-bold';
    }
  });

  addItemToBill(bId, div.querySelector('.bill-items-container'));
}

document.getElementById('addLineBtn').addEventListener('click', addBillCard);
document.getElementById('deleteLineBtn').addEventListener('click', () => {
    billsContainer.innerHTML = '';
    for(let k in billState) delete billState[k];
    recalcTotal();
    renderVerifyResults();
});

function addItemToBill(bId, container) {
  itemCounter++;
  const iId = 'i' + itemCounter;
  billState[bId].items[iId] = { verifyResult: null };

  const div = document.createElement('div');
  div.className = "flex gap-2 items-center item-row";
  div.dataset.itemId = iId;
  div.innerHTML = 
    "<div class='w-1/4'>" + getExpenseInputHtml() + "</div>" +
    "<div class='w-1/4'><input type='text' class='field-input text-xs !py-1.5 item-desc' placeholder='Item Name (As mentioned in bill)'></div>" +
    "<div class='w-[15%]'><input type='number' class='field-input text-xs !py-1.5 item-teeth' placeholder='Teeth (e.g. 2)' min='0'></div>" +
    "<div class='w-1/4 flex flex-col'><input type='number' class='field-input text-xs !py-1.5 item-price' placeholder='Price (₹)' value='0' min='0' step='0.01'><div class='capping-text text-[10px] text-emerald-600 font-bold text-right pr-2 min-h-[14px] mt-0.5'></div></div>" +
    "<button type='button' class='text-rose-400 hover:text-rose-600 delete-item-btn p-1 self-start mt-1.5'><i class='fa-solid fa-xmark'></i></button>";
  
  container.appendChild(div);

  const trgVerify = () => verifyBillItems(bId);
  div.querySelector('.expenseType').addEventListener('change', () => {
    updateItemPrice(div, bId);
    trgVerify();
  });
  div.querySelector('.item-desc').addEventListener('blur', () => {
    updateItemPrice(div, bId);
    trgVerify();
  });
  div.querySelector('.item-teeth').addEventListener('input', () => {
    updateItemPrice(div, bId);
  });
  div.querySelector('.item-price').addEventListener('blur', trgVerify);
  div.querySelector('.item-price').addEventListener('input', (e) => {
    if (e.target.max) {
      const max = parseFloat(e.target.max);
      const val = parseFloat(e.target.value || 0);
      if (val > max) {
        e.target.value = max;
      }
    }
    recalcTotal();
  });

  div.querySelector('.delete-item-btn').addEventListener('click', () => {
    delete billState[bId].items[iId];
    div.remove();
    recalcTotal();
    renderVerifyResults();
  });
}

function recalcTotal() {
  let grandTotal = 0;
  document.querySelectorAll('.bill-card').forEach(card => {
    let itemsTotal = 0;
    card.querySelectorAll('.item-price').forEach(inp => {
      itemsTotal += parseFloat(inp.value) || 0;
    });
    const gst = parseFloat(card.querySelector('.bill-gst').value) || 0;
    const discount = parseFloat(card.querySelector('.bill-discount').value) || 0;
    const billTotal = Math.max(0, itemsTotal + gst - discount);
    card.querySelector('.bill-total-span').textContent = billTotal.toFixed(2);
    grandTotal += billTotal;
  });
  document.getElementById('requestedAmount').value = grandTotal.toFixed(2);
}
document.getElementById('calculateBtn').addEventListener('click', recalcTotal);


// ---------- VERIFICATION ----------
function verifyBillItems(bId) {
  const card = document.querySelector(".bill-card[data-bill-id='" + bId + "']");
  if (!card) return;
  const state = billState[bId];
  if (!state) return;

  const billNumber = card.querySelector('.billNumber').value;
  const billDate = card.querySelector('.billDate').value;
  const patientName = requestForEl.value;

  const itemRows = card.querySelectorAll('.item-row');
  itemRows.forEach(row => {
    const iId = row.dataset.itemId;
    const expenseType = row.querySelector('.expenseType');
    const price = row.querySelector('.item-price').value;
    const expText = expenseType.value ? expenseType.options[expenseType.selectedIndex]?.text : '';
    const itemDesc = row.querySelector('.item-desc').value.trim();
    const testName = (expText + ' ' + itemDesc).trim();
    const verifyName = itemDesc || expText || testName;

    const result = { bId, iId, testName: testName };

    if (state.billChunks) {
      result.patientInBill = Verifier.matchLabelInChunks(patientName, state.billChunks, 0.45);
      result.billNumberMatch = billNumber ? Verifier.verifyValue(billNumber, { anchor: 'bill', inputType: 'text', noAnchorNeeded: true }, state.billChunks, 0.4, 100) : { status: 'pending' };
      result.billDateMatch = billDate ? Verifier.verifyValue(billDate, { anchor: 'date', inputType: 'date', noAnchorNeeded: true }, state.billChunks, 0.01, 100) : { status: 'pending' };
      result.amountMatch = price && parseFloat(price) > 0 ? Verifier.verifyValue(price, { anchor: 'amount', inputType: 'amount', noAnchorNeeded: true }, state.billChunks, 0.01, 100) : { status: 'pending' };
      result.testInBill = verifyName ? { status: Verifier.matchLabelInChunks(verifyName, state.billChunks, 0.40).status } : { status: 'pending' };
    } else {
      result.patientInBill = result.billNumberMatch = result.billDateMatch = result.amountMatch = result.testInBill = { status: 'pending' };
    }

    if (state.rxChunks) {
      result.patientInRx = Verifier.matchLabelInChunks(patientName, state.rxChunks, 0.45);
      result.testInRx = verifyName ? { status: Verifier.matchLabelInChunks(verifyName, state.rxChunks, 0.40).status } : { status: 'pending' };
    } else {
      result.patientInRx = result.testInRx = { status: 'pending' };
    }

    const statuses = [
      result.testInBill.status, result.testInRx.status, 
      result.patientInBill.status, result.patientInRx.status,
      result.billNumberMatch.status, result.billDateMatch.status, result.amountMatch.status
    ].filter(s => s !== 'pending');
    
    if (statuses.length === 0) result.overall = 'pending';
    else if (statuses.includes('failed')) result.overall = 'failed';
    else if (statuses.includes('partial')) result.overall = 'partial';
    else result.overall = 'verified';

    state.items[iId].verifyResult = result;
  });

  renderVerifyResults();
}

function verifyAllLines() {
  Object.keys(billState).forEach(bId => verifyBillItems(bId));
}
document.getElementById('reverifyAllBtn').addEventListener('click', verifyAllLines);

function badge(result) {
  if (!result) return '';
  const labels = { pending: 'Pending', verified: 'Found', partial: 'Partial', failed: 'Not Found' };
  return "<span class='verify-badge verify-" + result.status + "'>" + labels[result.status] + "</span>";
}

function renderVerifyResults() {
  const container = document.getElementById('verifyResults');
  let hasAny = false;
  let html = "";

  Object.keys(billState).forEach(bId => {
    const bState = billState[bId];
    Object.keys(bState.items).forEach(iId => {
      const r = bState.items[iId].verifyResult;
      if (!r) return;
      hasAny = true;

      let banner = "";
      if (r.overall === 'verified') banner = "<span class='verify-badge verify-verified'><i class='fa-solid fa-check'></i> Confirmed</span>";
      else if (r.overall === 'partial') banner = "<span class='verify-badge verify-partial'><i class='fa-solid fa-triangle-exclamation'></i> Partial</span>";
      else if (r.overall === 'failed') banner = "<span class='verify-badge verify-failed'><i class='fa-solid fa-xmark'></i> Mismatch</span>";
      else banner = "<span class='verify-badge verify-pending'>Awaiting</span>";

      html += "<div class='border border-slate-200 rounded-xl overflow-hidden mb-3'>" +
        "<div class='px-4 py-2.5 bg-slate-50 flex items-center justify-between gap-2'>" +
          "<p class='text-xs font-bold text-slate-700'>Item — " + r.testName + "</p>" + banner +
        "</div>" +
        "<div class='p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-[11px]'>" +
          "<div><p class='text-slate-400 font-bold uppercase text-[9px] mb-1'>Item (Bill)</p>" + badge(r.testInBill) + "</div>" +
          "<div><p class='text-slate-400 font-bold uppercase text-[9px] mb-1'>Item (Rx)</p>" + badge(r.testInRx) + "</div>" +
          "<div><p class='text-slate-400 font-bold uppercase text-[9px] mb-1'>Patient (Bill)</p>" + badge(r.patientInBill) + "</div>" +
          "<div><p class='text-slate-400 font-bold uppercase text-[9px] mb-1'>Bill No.</p>" + badge(r.billNumberMatch) + "</div>" +
          "<div><p class='text-slate-400 font-bold uppercase text-[9px] mb-1'>Bill Date</p>" + badge(r.billDateMatch) + "</div>" +
          "<div><p class='text-slate-400 font-bold uppercase text-[9px] mb-1'>Amount</p>" + badge(r.amountMatch) + "</div>" +
        "</div>" +
      "</div>";
    });
  });

  if (!hasAny) {
    container.innerHTML = "<p class='text-xs text-slate-400 italic bg-slate-50 rounded-lg p-4 text-center'>Upload documents and add items to run verification.</p>";
  } else {
    container.innerHTML = html;
  }
}

// ---------- SUBMIT ----------
document.getElementById('claimForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  recalcTotal();

  let billsToSubmit = [];
  let uploadTasks = []; // { file, level, lineNo }

  let globalLineCounter = 1;
  const cards = document.querySelectorAll('.bill-card');
  if (cards.length === 0) { showToast('Add at least one bill', 'error'); return; }

  for (const card of cards) {
    const bId = card.dataset.billId;
    const billNumber = card.querySelector('.billNumber').value;
    const billDate = card.querySelector('.billDate').value;
    const hospitalStatus = card.querySelector('.hospitalStatus').value;
    const empHosp = card.querySelector('.empanelledHospital').value;
    const nonEmpHosp = card.querySelector('.nameOfHospital').value;
    
    if (!billNumber || !billDate) { showToast('Each bill needs a Number and Date', 'error'); return; }
    if (!hospitalStatus) { showToast('Please select Hospital Status for Bill ' + billNumber, 'error'); return; }
    
    const hospitalName = hospitalStatus === 'Empanelled' ? empHosp : nonEmpHosp;
    if (!hospitalName) { showToast('Please provide Hospital Name for Bill ' + billNumber, 'error'); return; }
    
    const state = billState[bId];
    if (!state.billPdf) { showToast('Upload a Bill PDF for Bill ' + billNumber, 'error'); return; }

    const itemRows = card.querySelectorAll('.item-row');
    if (itemRows.length === 0) { showToast('Add at least one item to Bill ' + billNumber, 'error'); return; }

    const gst = parseFloat(card.querySelector('.bill-gst').value) || 0;
    const discount = parseFloat(card.querySelector('.bill-discount').value) || 0;
    const netAdjustment = gst - discount;
    let itemsTotal = 0;
    itemRows.forEach(row => { itemsTotal += parseFloat(row.querySelector('.item-price').value) || 0; });

    itemRows.forEach(row => {
      const iId = row.dataset.itemId;
      const expenseType = row.querySelector('.expenseType').value;
      const teeth = row.querySelector('.item-teeth').value;
      const desc = row.querySelector('.item-desc').value;
      const priceRaw = parseFloat(row.querySelector('.item-price').value) || 0;
      
      if (priceRaw <= 0) {
        showToast('Each item needs a price greater than 0', 'error');
        throw new Error('Validation failed');
      }
      
      let finalPrice = priceRaw;
      if (itemsTotal > 0 && netAdjustment !== 0) {
        finalPrice = priceRaw + (priceRaw / itemsTotal) * netAdjustment;
      }

      const itemRes = state.items[iId]?.verifyResult || {};

      billsToSubmit.push({
        lineNo: String(globalLineCounter),
        hospitalStatus: hospitalStatus,
        rxHospital: hospitalName,
        empanelledHospital: hospitalStatus === 'Empanelled' ? hospitalName : '',
        nameOfHospital: hospitalStatus !== 'Empanelled' ? hospitalName : '',
        billTreatmentType: expenseType,
        descriptionOfExpense: desc + (teeth ? ' (Teeth: ' + teeth + ')' : ''),
        billNumber: billNumber,
        prescriptionRefNumber: '',
        prescriptionDate: '',
        billDate: billDate,
        deductions: '0', remarksDeduction: '',
        requestedAmount: finalPrice.toFixed(2),
        admissibleAmount: '',
        verificationStatus: itemRes.overall || 'pending',
        verificationSummary: JSON.stringify(itemRes),
      });

      // We attach the Bill PDF (and Rx PDF if present) to the FIRST line of this bill, or to EVERY line?
      // The backend groups by claimId. Standard DMRC backend supports 'Bill Line' level attachments by line number.
      uploadTasks.push({ file: state.billPdf, level: 'Bill Line', lineNo: String(globalLineCounter) });
      if (state.rxPdf) {
        uploadTasks.push({ file: state.rxPdf, level: 'Prescription Line', lineNo: String(globalLineCounter) });
      }

      globalLineCounter++;
    });
  }

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
    uploadedPrescription: true, uploadedBills: true, uploadedReports: false,
    termsAccepted: document.getElementById('termsAccepted').checked,
    comments: document.getElementById('comments').value,
    bills: billsToSubmit,
  };

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

  try {
    const { claimId } = await apiPost('/claims', payload);

    for (const task of uploadTasks) {
      const fd = new FormData();
      fd.append('file', task.file);
      fd.append('claimId', claimId);
      fd.append('attachmentLevel', task.level);
      fd.append('lineNumber', task.lineNo);
      await apiUpload(fd);
    }

    showToast('Claim ' + claimId + ' submitted successfully!', 'success');
    setTimeout(() => { window.location.href = 'my-claims.html'; }, 1200);
  } catch (err) {
    if (err.message !== 'Validation failed') {
        showToast(err.error || 'Failed to submit claim', 'error');
    }
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Claim';
  }
});
