# DMRC Medical Reimbursement Platform (MVP)

A working draft of a Medical Reimbursement Management Platform with a functional skeleton end-to-end.

## Features Included
- Employee Portal (React + Vite + Tailwind v3)
- HR/Admin Dashboard (React + Vite + Tailwind v3)
- Node.js Backend with Express and Prisma
- PostgreSQL Database Integration
- File Upload + Tesseract.js Basic OCR Pipeline
- JWT Authentication

## Setup Instructions

1. Ensure you have **Node.js** (v18+) and **PostgreSQL** running locally.
2. In the `backend/.env` file, confirm that the `DATABASE_URL` matches your local Postgres credentials.
3. Run the following command from the root directory to install dependencies for all 3 sub-projects:
   ```bash
   npm run install:all
   ```

## Running the Application

You can start the backend and both frontends simultaneously using:
```bash
npm start
```
This will launch:
- Backend Server: `http://localhost:4000`
- Employee Portal: `http://localhost:5173`
- HR/Admin Dashboard: `http://localhost:5174`

### Test Credentials
The database has been seeded with the following default accounts:

**Employee Login (Portal: http://localhost:5173)**
- **ID:** `EMP001`
- **Password:** `password123`

**HR Admin Login (Dashboard: http://localhost:5174)**
- **ID:** `HR001`
- **Password:** `password123`

## Usage Workflow
1. Log in as Employee (`EMP001`).
2. Submit a claim by entering an amount and uploading an image (e.g., a receipt).
3. Log in as HR Admin (`HR001`).
4. Review the submitted claim, view the receipt and basic OCR extracted data, and change the status (Approve/Reject).
5. Refresh the Employee portal to see the status update.
