import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);
  
  await prisma.user.upsert({
    where: { employeeId: 'EMP001' },
    update: {},
    create: {
      employeeId: 'EMP001',
      name: 'John Employee',
      email: 'john@dmrc.local',
      passwordHash,
      role: 'employee',
      department: 'Engineering'
    }
  });

  await prisma.user.upsert({
    where: { employeeId: 'HR001' },
    update: {},
    create: {
      employeeId: 'HR001',
      name: 'Jane Admin',
      email: 'jane.hr@dmrc.local',
      passwordHash,
      role: 'hr',
      department: 'Human Resources'
    }
  });
  
  console.log('Seed completed. Employee: EMP001/password123, HR: HR001/password123');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
