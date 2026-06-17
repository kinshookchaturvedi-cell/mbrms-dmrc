import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import Tesseract from 'tesseract.js';

const app = express();
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter });
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Storage for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Middleware
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Auth routes
app.post('/auth/register', async (req, res) => {
  const { employeeId, name, email, password, role, department } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: { employeeId, name, email, passwordHash, role, department }
    });
    res.json({ id: user.id, name: user.name, role: user.role });
  } catch (err) {
    res.status(400).json({ error: 'User already exists' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { employeeId, password } = req.body;
  const user = await prisma.user.findUnique({ where: { employeeId } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET);
  res.json({ token, role: user.role, name: user.name });
});

// Claims routes
app.post('/claims', authenticate, async (req: any, res) => {
  const { totalAmount } = req.body;
  const claim = await prisma.claim.create({
    data: {
      employeeId: req.user.id,
      status: 'SUBMITTED',
      totalAmount: totalAmount || 0
    }
  });
  res.json(claim);
});

app.get('/claims', authenticate, async (req: any, res) => {
  let claims;
  if (req.user.role === 'employee') {
    claims = await prisma.claim.findMany({
      where: { employeeId: req.user.id },
      include: { employee: true },
      orderBy: { createdAt: 'desc' }
    });
  } else {
    claims = await prisma.claim.findMany({
      include: { employee: true },
      orderBy: { createdAt: 'desc' }
    });
  }
  res.json(claims);
});

app.get('/claims/:id', authenticate, async (req: any, res) => {
  const claim = await prisma.claim.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      employee: true,
      documents: true,
      approvals: { include: { reviewer: true }, orderBy: { createdAt: 'desc' } }
    }
  });
  res.json(claim);
});

// Document Upload + OCR
app.post('/claims/:id/documents', authenticate, upload.single('document'), async (req: any, res) => {
  const claimId = Number(req.params.id);
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const fileUrl = `/uploads/${file.filename}`;
  const filePath = path.join(__dirname, '../uploads', file.filename);

  let extractedText = '';
  let extractedJson = {};

  try {
    const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
    extractedText = text;
    
    // Basic heuristics parser
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const hospitalName = lines.length > 0 ? lines[0] : 'Unknown Hospital';
    const amountMatch = text.match(/(?:Rs\.?|₹)\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/i);
    const dateMatch = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);

    extractedJson = {
      hospitalName,
      extractedAmount: amountMatch ? amountMatch[1] : null,
      extractedDate: dateMatch ? dateMatch[0] : null
    };

  } catch (err) {
    console.error('OCR Error:', err);
  }

  const document = await prisma.document.create({
    data: {
      claimId,
      docType: 'RECEIPT',
      fileUrl,
      extractedText,
      extractedJson
    }
  });

  res.json(document);
});

// Update status
app.patch('/claims/:id/status', authenticate, requireRole(['hr', 'admin']), async (req: any, res) => {
  const { status, remarks, approvedAmount } = req.body;
  const claimId = Number(req.params.id);

  const approval = await prisma.approval.create({
    data: {
      claimId,
      reviewerId: req.user.id,
      decision: status,
      remarks
    }
  });

  const claim = await prisma.claim.update({
    where: { id: claimId },
    data: { status, approvedAmount: approvedAmount || undefined }
  });

  res.json({ claim, approval });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
