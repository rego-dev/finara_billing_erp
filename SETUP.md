# PH-ERP Accounting System — Setup Guide

Philippine-compliant ERP with BIR, SSS, PhilHealth, Pag-IBIG modules.
Built with **Next.js 14 + Express + MySQL + Prisma**.

---

## Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18+ | https://nodejs.org |
| MySQL / MariaDB | 8.0+ | https://dev.mysql.com/downloads/ |
| Git | any | https://git-scm.com |

---

## 1. Create the MySQL Database

```sql
CREATE DATABASE ph_erp_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'erp_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON ph_erp_db.* TO 'erp_user'@'localhost';
FLUSH PRIVILEGES;
```

---

## 2. Backend Setup

```bash
cd backend

# Copy and configure environment
copy .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, etc.

# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run migrations (creates all tables)
npm run db:migrate

# Seed the database (COA + sample data + admin user)
npm run db:seed

# Start the API server
npm run dev     # development (auto-reload)
npm start       # production
```

**Backend runs on:** http://localhost:5000

---

## 3. Frontend Setup

```bash
cd frontend

# Copy and configure environment
copy .env.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:5000

# Install dependencies
npm install

# Start development server
npm run dev

# Production build
npm run build && npm start
```

**Frontend runs on:** http://localhost:3000

---

## 4. Login

| | |
|--|--|
| **URL** | http://localhost:3000/login |
| **Email** | admin@ph-erp.com |
| **Password** | Admin@123 |

> Change the admin password immediately after first login.

---

## System Architecture

```
┌─────────────────────┐     JWT Auth     ┌──────────────────────────┐
│   Next.js 14        │ ───────────────► │  Express.js API           │
│   (Port 3000)       │                  │  (Port 5000)              │
│                     │                  │                           │
│  • App Router       │  REST API calls  │  • Helmet (security)      │
│  • Tailwind CSS     │ ◄─────────────── │  • Rate limiting          │
│  • React Query      │                  │  • JWT authentication     │
│  • Recharts         │                  │  • Prisma ORM             │
└─────────────────────┘                  └──────────────────────────┘
                                                       │
                                                       ▼
                                         ┌─────────────────────────┐
                                         │   MySQL / MariaDB       │
                                         │   (Port 3306)           │
                                         └─────────────────────────┘
```

---

## Module Overview

### Chart of Accounts & General Ledger
- PFRS-aligned Chart of Accounts (50 pre-seeded accounts)
- Double-entry journal entries with balance validation
- Draft → Posted → Voided workflow
- Trial Balance, Income Statement, Balance Sheet

### Accounts Payable
- Vendor master management
- Bills with line items and VAT codes (Vatable/Zero/Exempt)
- Payment recording and aging report (0-30, 31-60, 61-90, 90+ days)

### Accounts Receivable
- Customer master management
- Invoices with 12% VAT computation
- Collection recording and AR aging report

### Payroll (Philippine-compliant)
- SSS contributions per 2024 table
- PhilHealth: 5% (2.5% each), ₱10k-₱100k monthly salary range
- Pag-IBIG: 1-2% employee, up to ₱100/month
- BIR Withholding Tax per TRAIN Law (2023+)
- Per-period payroll computation (Monthly / Semi-Monthly / Weekly)
- BIR Form 2316 data per employee

### BIR Compliance
- VAT Summary (Form 2550M / 2550Q)
- Compensation Withholding Summary (Form 1601-C)
- EWT Summary (Form 1601-EQ)
- Annual Alphalist of Employees
- RELIEF Export (sales & purchases)

---

## Security Features

- JWT access tokens (8h) + refresh tokens (7d)
- Bcrypt password hashing (cost factor 12)
- Helmet.js HTTP security headers
- CORS whitelist (frontend origin only)
- Global rate limiting: 500 req / 15 min
- Auth endpoint rate limit: 20 req / 15 min
- Input validation (express-validator + Zod)
- Parameterized queries via Prisma (SQL injection proof)
- Role-based access: ADMIN, MANAGER, ACCOUNTANT, VIEWER

---

## User Roles

| Role | Can Do |
|------|--------|
| ADMIN | Full access including user management, deletions |
| MANAGER | Create/edit/post/approve all modules |
| ACCOUNTANT | Create drafts, record transactions |
| VIEWER | Read-only access |

---

## Logs

Application logs are written to `backend/logs/`:
- `app.log` — all application events
- `error.log` — errors only

---

## Philippine Compliance

| Regulation | Coverage |
|-----------|----------|
| RA 11976 (Ease of Paying Taxes Act) | Invoice numbering, VAT codes |
| TRAIN Law (RA 10963, as amended) | Income tax brackets (2023+) |
| SSS Circular 2024 | Contribution table |
| PhilHealth Circular 2024-003 | 5% rate, ₱100k ceiling |
| Pag-IBIG | 2% employee contribution |
| PFRS / PFRS for SMEs | Chart of Accounts structure |
| BIR Forms | 2550M, 2550Q, 1601-C, 1601-EQ, 2316 |
