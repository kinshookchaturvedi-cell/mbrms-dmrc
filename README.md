# DMRC Medical Reimbursement Management Platform (Prototype)

A working prototype rebuilt to match DMRC's real ESS/SAP claim form (from the screenshots),
using plain HTML/CSS/JS on the frontend and a small Node/Express + CSV-file backend.

## Stack
- **Frontend:** HTML, Tailwind (via CDN — no build step), vanilla JS
- **Backend:** Node.js + Express (REST API)
- **"Database":** CSV files in `/data` (one file per table — easy to open in Excel and eyeball during the demo)
- **Client-side bill verification:** pdf.js + Tesseract.js (OCR) + Fuse.js (fuzzy matching), adapted from your `parser4.html` prototype

## 1. Install

```bash
npm install
```

This installs:
| Package | Why |
|---|---|
| `express` | web server / REST API |
| `multer` | handles the file upload for bill/prescription PDFs (2MB limit, mirrors real portal) |
| `papaparse` | reads/writes the CSV "database" files robustly (handles quoted commas etc.) |
| `nodemon` (dev) | auto-restarts server on file changes while you're developing |

The PDF verification libraries (`pdf.js`, `tesseract.js`, `fuse.js`) are loaded via CDN
`<script>` tags directly in `new-claim.html` — **no npm install needed for those**, since
they only run in the browser. If you'd rather vendor them locally (e.g. for an offline demo),
you can `npm install pdfjs-dist tesseract.js fuse.js` and swap the CDN tags for local copies,
but for tomorrow's demo the CDN is simplest and requires nothing extra.

## 2. Run

```bash
npm start
```

Then open **http://localhost:4000** in your browser.

For live-reload while you tweak things:
```bash
npm run dev
```

## 3. Demo logins

| Role | ID | Password |
|---|---|---|
| Employee | `EMP10234` | `pass123` |
| HR Admin | `HR2001` | `hrpass123` |

(A few more employees/HR users are seeded in `data/employees.csv` and `data/hr_admins.csv` if you want variety.)

## 4. Folder structure

```
dmrc/
├── data/                     ← CSV "databases"
│   ├── employees.csv         ← employee master + login
│   ├── dependents.csv        ← self/spouse/children per employee
│   ├── hr_admins.csv         ← HR login
│   ├── hospitals.csv         ← empanelled hospital master (147 hospitals, sourced from DMRC's
│   │                            actual Office Order HR/O&M/215/2022 — real names, addresses,
│   │                            regions, rate terms, and contacts)
│   ├── lal_pathlabs_centres.csv ← the 48 individual Dr Lal PathLabs collection-centre addresses
│   │                            (collapsed to one dropdown entry in hospitals.csv since they
│   │                            all bill at the same rate — full branch list kept here for reference)
│   ├── reimbursement_types.csv
│   ├── bill_treatment_types.csv
│   ├── test_master.csv       ← test name master with bill-side + prescription-side wording
│   ├── claims.csv            ← claim headers (transactional)
│   ├── claim_bills.csv       ← claim bill line items (transactional)
│   ├── claim_remarks.csv     ← status/audit trail (transactional)
│   └── attachments.csv       ← uploaded file records (prescription + one per bill line)
├── sample-files/             ← your real test documents, for demoing
│   ├── blood_test_invoice.pdf
│   └── prescription_EAR_NAD_signed.pdf
├── public/                   ← everything served to the browser
│   ├── index.html            ← role selection
│   ├── employee-login.html
│   ├── hr-login.html
│   ├── emp-dashboard.html
│   ├── my-claims.html
│   ├── new-claim.html        ← the SAP-style claim form (matches your screenshots)
│   ├── hr-dashboard.html
│   ├── claim-review.html     ← HR approve/reject/query a single claim
│   ├── approved-claims.html
│   ├── css/styles.css
│   ├── js/api.js             ← fetch helpers, session, toast, formatters
│   ├── js/new-claim.js       ← claim form logic + field validation
│   ├── js/verification.js    ← PDF text/OCR extraction + fuzzy field verification
│   └── uploads/              ← uploaded bill/prescription files land here
├── server/
│   ├── server.js             ← Express routes (REST API)
│   └── csvStore.js           ← tiny CSV read/write/append "ORM"
└── package.json
```

## 5. How the pieces map to what you saw in the real portal screenshots

- **Step 1 (Details)** → `new-claim.html` section 1: Reimbursement Type, Request Type,
  Requested Amount (auto-calculated), Room Entitlement, Recruitment/Employment Status,
  Pay Scale, Disease, Outstation Treatment, Mobile, E-mail, Request For, and the three
  "uploaded scanned copy of..." checkboxes.
- **Dependents grid** → populated from `dependents.csv` for the logged-in employee (self/spouse/child).
- **Bill line items table** (Add Line / Delete Line / Calculate, Hospital status, Empanelled
  Hospital, Bill/Treatment Type, Bill Number, Bill Date, Deductions, Remarks/Deduction,
  Requested Amount) → section 3 of the form, backed by `claim_bills.csv`.
- **Comments + status/remarks audit trail** → `claim_remarks.csv`, shown in the "Status
  Timeline" on both the employee's claim detail modal and the HR review page.
- **Attachments panel** → `attachments.csv` + files saved under `public/uploads/`.

## 6. Automatic field & cross-document verification (from your `parser4.html`)

This is now a genuine **bill ↔ prescription cross-check**, not just single-document field
verification:

- **Each bill line item has its own PDF upload** (the specific invoice/receipt for that line),
  not one shared upload for the whole claim.
- **The prescription is uploaded once at claim level** (it usually covers every test/treatment
  a doctor advised in one visit).
- For every line, the system checks:
  1. **Is this test named on the bill PDF?** (fuzzy match against that line's own bill)
  2. **Is this test named on the prescription PDF?** (fuzzy match against the shared prescription)
  3. Patient name found on the bill / on the prescription
  4. Bill Number / Bill Date / Requested Amount found near their respective anchors on the bill
- A line is only marked **Verified** when the test is confirmed in *both* documents — that's
  the actual reimbursement-fraud check DMRC needs (was this test actually prescribed, and was
  it actually billed).

`public/js/verification.js` still uses the same engine as your `parser-4.html` prototype
(pdf.js text extraction → Tesseract OCR fallback → Fuse.js fuzzy matching, date-variant
generation), generalised into two reusable functions:
- `Verifier.verifyValue()` — anchor + proximity-window field matching (bill number, date, amount)
- `Verifier.matchLabelInChunks()` — whole-document fuzzy test-name matching, with a token-overlap
  fallback for OCR noise / PDF column-order jumbling (tuned and tested against real scanned
  documents — see below)

**Test name master:** `data/test_master.csv` holds each test's *bill-side wording* and
*prescription-side wording* separately (e.g. a lab bill says `"HbA1c GLYCOSYLATED HEMOGLOBIN"`
while a doctor's prescription says `"Glycosylated Haemoglobin (HbA1C),EDTA"` — same test, very
different phrasing), which is what makes reliable cross-document matching possible. The
"Description of Expense" field on each bill line is now a dropdown driven by this master
instead of free text.

### This was tuned against your real sample files, not guessed

I extracted the actual text layer from both `blood_test_invoice.pdf` and
`prescription_EAR_NAD_signed.pdf`, ran the real matching algorithm against it in Node, and found
(and fixed) a genuine bug: Fuse.js's `threshold` option doesn't reliably cut off short-word
fuzzy matches against long text — it was letting `"MRI"` match unrelated text elsewhere in the
bill. Fixed by explicitly filtering results by score after the search. With that fix, all 11
real tests on your two sample files come back **Verified** in both documents, and a test that
genuinely wasn't billed (e.g. the MRI, which was prescribed but not in this particular lab
invoice) correctly comes back **Not Found** on the bill side — so the cross-check actually
discriminates real matches from false ones, not just always saying "verified".

## 7. Demo with your real files

I seeded `SHUBHI AGARWAL` (`EMP10456` / `pass123`) as a demo employee, since that's the patient
name on your sample documents — logging in as her means the patient-name cross-check will
actually pass. Both sample PDFs are in `sample-files/` for convenience.

Suggested demo flow:
1. Log in as `EMP10456` / `pass123`.
2. New Claim → Reimbursement Type: *Medical Pathology/Ophthalmology*.
3. Add ~10 bill lines, one per test from the invoice (Urea, Folate, Vitamin B12, Vitamin D,
   HbA1c, IgE, CRP, Peripheral Blood Smear, Hemogram, Creatinine), using the dropdown.
4. For each line, attach `sample-files/blood_test_invoice.pdf` as that line's Bill PDF (the
   same file works for every line since it's one multi-test invoice — a real employee would
   normally attach one bill per line here, this is just the sample data DMRC gave you).
5. Upload `sample-files/prescription_EAR_NAD_signed.pdf` as the Prescription.
6. Watch each line turn to "Test confirmed in both documents".
7. Submit → log in as HR (`HR2001` / `hrpass123`) → review → approve.

## 8. Notes / things to mention to your manager

- This is a prototype: passwords are stored in plaintext CSV for demo speed — a real
  deployment would need hashed passwords, a real DB (Postgres/MySQL), and proper auth/session
  tokens instead of `sessionStorage`.
- CSV files double as an easy way to *show* the data model in the demo — you can open any
  file in `/data` in Excel mid-demo to show "this is the employee database", "this is the
  claims database", etc.
- The claim form's live field validation (mobile number format, email format, bill date not in
  the future, required bill fields) is separate from the PDF auto-verification — the first
  catches typos as you type, the second cross-checks your entries against the uploaded document.
