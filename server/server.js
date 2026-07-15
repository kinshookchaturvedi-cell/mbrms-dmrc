// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {
  readTable, appendRow, updateRow, findRows, findOne, nextId,
} = require('./csvStore');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- File upload (Multer) ----------
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const stamp = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${stamp}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB cap to mirror real portal

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}
function nowTime() {
  return new Date().toTimeString().slice(0, 8);
}

// ================= AUTH =================
app.post('/api/login', (req, res) => {
  const { role, id, password } = req.body;
  if (!role || !id || !password) return res.status(400).json({ error: 'Missing fields' });

  if (role === 'employee') {
    const emp = findOne('employees', e => e.employee_id === id && e.password === password);
    if (!emp) return res.status(401).json({ error: 'Invalid Employee ID or Password' });
    const { password: _pw, ...safe } = emp;
    return res.json({ user: safe, role: 'employee' });
  }

  if (role === 'hr') {
    const hr = findOne('hr_admins', h => h.hr_id === id && h.password === password);
    if (!hr) return res.status(401).json({ error: 'Invalid HR ID or Password' });
    const { password: _pw, ...safe } = hr;
    return res.json({ user: safe, role: 'hr' });
  }

  return res.status(400).json({ error: 'Invalid role' });
});

// ================= REFERENCE / MASTER DATA =================
app.get('/api/employee/:id', (req, res) => {
  const emp = findOne('employees', e => e.employee_id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const { password, ...safe } = emp;
  const dependents = findRows('dependents', d => d.employee_id === req.params.id);
  res.json({ employee: safe, dependents });
});

app.get('/api/hospitals', (req, res) => res.json(findRows('hospitals')));
app.get('/api/dental-hospitals', (req, res) => res.json(findRows('dental-empannel-master')));
app.get('/api/dental-cghs-rates', (req, res) => res.json(findRows('dental_cghsRates')));
app.get('/api/reimbursement-types', (req, res) => res.json(findRows('reimbursement_types')));
app.get('/api/bill-treatment-types', (req, res) => res.json(findRows('bill_treatment_types')));
app.get('/api/test-master', (req, res) => res.json(findRows('test_master')));

// ================= CLAIMS =================

// Create new claim (Step 1-3 of the SAP-style form submitted together)
app.post('/api/claims', (req, res) => {
  const b = req.body;
  if (!b.employeeId) return res.status(400).json({ error: 'employeeId required' });

  const claimId = nextId('claims', 'claim_id', 'CLM');
  const claimRow = {
    claim_id: claimId,
    employee_id: b.employeeId,
    reimbursement_type: b.reimbursementType || '',
    request_type: b.requestType || 'Claim',
    requested_amount: b.requestedAmount || '0',
    admissible_amount: '',
    room_entitlement: b.roomEntitlement || '',
    employment_status: b.employmentStatus || '',
    pay_scale: b.payScale || '',
    outstation_treatment: b.outstationTreatment || 'No',
    disease: b.disease || '',
    mobile: b.mobile || '',
    email: b.email || '',
    request_for: b.requestFor || '',
    uploaded_prescription: b.uploadedPrescription ? 'Yes' : 'No',
    uploaded_bills: b.uploadedBills ? 'Yes' : 'No',
    uploaded_reports: b.uploadedReports ? 'Yes' : 'No',
    terms_accepted: b.termsAccepted ? 'Yes' : 'No',
    comments: b.comments || '',
    status: 'Submitted',
    submitted_date: nowDate(),
    last_updated: nowDate(),
    approved_by: '',
    approved_date: '',
    payment_date: '',
  };
  appendRow('claims', claimRow);

  // bill line items
  const bills = Array.isArray(b.bills) ? b.bills : [];
  bills.forEach((line, idx) => {
    const billId = nextId('claim_bills', 'bill_id', 'BIL');
    appendRow('claim_bills', {
      bill_id: billId,
      claim_id: claimId,
      line_no: String(idx + 1).padStart(4, '0'),
      hospital_status: line.hospitalStatus || '',
      empanelled_hospital: line.empanelledHospital || '',
      name_of_hospital: line.nameOfHospital || '',
      bill_treatment_type: line.billTreatmentType || '',
      description_of_expense: line.descriptionOfExpense || '',
      bill_number: line.billNumber || '',
      bill_date: line.billDate || '',
      deductions: line.deductions || '0',
      remarks_deduction: line.remarksDeduction || '',
      admissible_amount: line.admissibleAmount || '',
      requested_amount: line.requestedAmount || '',
      verification_status: line.verificationStatus || 'pending',
      verification_summary: line.verificationSummary || '',
    });
  });

  // initial audit trail entry
  appendRow('claim_remarks', {
    remark_id: nextId('claim_remarks', 'remark_id', 'RMK'),
    claim_id: claimId,
    user_type: 'Employee',
    user_name: b.employeeId,
    date: nowDate(),
    time: nowTime(),
    previous_status: '',
    current_status: 'Submitted',
    remarks: 'Claim submitted by employee.',
  });

  res.json({ claimId, status: 'Submitted' });
});

// List claims for one employee (My Claims page)
app.get('/api/claims', (req, res) => {
  const { employeeId } = req.query;
  let claims = findRows('claims');
  if (employeeId) claims = claims.filter(c => c.employee_id === employeeId);
  // attach patient name from request_for + dependents, and bill count
  const allBills = readTable('claim_bills').rows;
  const enriched = claims.map(c => {
    const bills = allBills.filter(bl => bl.claim_id === c.claim_id);
    const hospital = bills[0]?.name_of_hospital || '';
    return { ...c, bill_count: bills.length, hospital };
  });
  res.json(enriched.reverse());
});

// Full single claim (claim header + bills + remarks + attachments + employee)
app.get('/api/claims/:claimId', (req, res) => {
  const claim = findOne('claims', c => c.claim_id === req.params.claimId);
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  const bills = findRows('claim_bills', b => b.claim_id === claim.claim_id);
  const remarks = findRows('claim_remarks', r => r.claim_id === claim.claim_id);
  const attachments = findRows('attachments', a => a.claim_id === claim.claim_id);
  const emp = findOne('employees', e => e.employee_id === claim.employee_id);
  const { password, ...safeEmp } = emp || {};
  const dependents = findRows('dependents', d => d.employee_id === claim.employee_id);
  res.json({ claim, bills, remarks, attachments, employee: safeEmp, dependents });
});

// HR: list all claims (joined with employee name/department)
app.get('/api/hr/claims', (req, res) => {
  const claims = findRows('claims');
  const employees = readTable('employees').rows;
  const allBills = readTable('claim_bills').rows;
  const enriched = claims.map(c => {
    const emp = employees.find(e => e.employee_id === c.employee_id);
    const bills = allBills.filter(bl => bl.claim_id === c.claim_id);
    return {
      ...c,
      employee_name: emp?.name || c.employee_id,
      department: emp?.department || '',
      bill_count: bills.length,
    };
  });
  res.json(enriched.reverse());
});

// Update claim status (HR approve / reject / query / mark paid)
app.put('/api/claims/:claimId/status', (req, res) => {
  const { status, hrId, hrName, remarks, admissibleAmount } = req.body;
  const claim = findOne('claims', c => c.claim_id === req.params.claimId);
  if (!claim) return res.status(404).json({ error: 'Claim not found' });

  const updates = { status, last_updated: nowDate() };
  if (status === 'Approved') {
    updates.approved_by = hrName || hrId || '';
    updates.approved_date = nowDate();
    if (admissibleAmount !== undefined) updates.admissible_amount = admissibleAmount;
  }
  if (status === 'Payment Done') {
    updates.payment_date = nowDate();
  }
  const updated = updateRow('claims', 'claim_id', req.params.claimId, updates);

  appendRow('claim_remarks', {
    remark_id: nextId('claim_remarks', 'remark_id', 'RMK'),
    claim_id: req.params.claimId,
    user_type: 'HR',
    user_name: hrName || hrId || 'HR Admin',
    date: nowDate(),
    time: nowTime(),
    previous_status: claim.status,
    current_status: status,
    remarks: remarks || '',
  });

  res.json({ claim: updated });
});

// ================= ATTACHMENTS =================
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { claimId, attachmentLevel, lineNumber } = req.body;
  const row = {
    attachment_id: nextId('attachments', 'attachment_id', 'ATT'),
    claim_id: claimId || '',
    attachment_level: attachmentLevel || 'Request Level',
    line_number: lineNumber || '',
    file_name: req.file.originalname,
    file_extension: path.extname(req.file.originalname).replace('.', ''),
    attachment_size: `${(req.file.size / 1024).toFixed(1)} KB`,
    file_path: `/uploads/${req.file.filename}`,
    uploaded_date: nowDate(),
  };
  appendRow('attachments', row);
  res.json(row);
});

// ================= DASHBOARD STATS =================
app.get('/api/stats/employee/:id', (req, res) => {
  const claims = findRows('claims', c => c.employee_id === req.params.id);
  const counts = { total: claims.length, approved: 0, underReview: 0, queryRaised: 0, rejected: 0 };
  claims.forEach(c => {
    if (c.status === 'Approved' || c.status === 'Payment Done') counts.approved++;
    else if (c.status === 'Query Raised') counts.queryRaised++;
    else if (c.status === 'Rejected') counts.rejected++;
    else counts.underReview++;
  });
  res.json(counts);
});

app.get('/api/stats/hr', (req, res) => {
  const claims = findRows('claims');
  const today = nowDate();
  const pending = claims.filter(c => c.status === 'Submitted' || c.status === 'Under Review').length;
  const approvedToday = claims.filter(c => c.status === 'Approved' && c.approved_date === today).length;
  const queriesOpen = claims.filter(c => c.status === 'Query Raised').length;

  const employees = readTable('employees').rows;
  const deptTotals = {};
  claims.forEach(c => {
    if (c.status === 'Approved' || c.status === 'Payment Done') {
      const emp = employees.find(e => e.employee_id === c.employee_id);
      const dept = emp?.department || 'Unknown';
      deptTotals[dept] = (deptTotals[dept] || 0) + (parseFloat(c.admissible_amount || c.requested_amount) || 0);
    }
  });

  res.json({ pending, approvedToday, queriesOpen, totalClaims: claims.length, deptTotals });
});

app.listen(PORT, () => {
  console.log(`DMRC Medical Reimbursement server running → http://localhost:${PORT}`);
});
