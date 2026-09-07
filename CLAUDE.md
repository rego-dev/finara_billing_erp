# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Philippine-compliant ERP system (Finara). Modules: Chart of Accounts, General Ledger, Accounts Payable, Accounts Receivable, Payroll (SSS/PhilHealth/Pag-IBIG/BIR TRAIN Law), BIR Compliance, and Reports.

Stack: **Next.js 14 (App Router) + Express.js + MySQL 8 + Prisma ORM 5**

## Commands

This is a **single unified project** at the repo root — one `package.json`, one `node_modules`. The Next.js UI (port 3000 in dev) and the Express API (`server/`, port 5000) run together.

```bash
npm install          # Install all deps (frontend + backend)
npm run dev          # Run BOTH: nodemon API on :5000 + Next.js on :3000 (concurrently)
npm run build        # next build (production frontend)
npm start            # Run BOTH for production: Express on :5000 + Next.js on $PORT
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:migrate   # Create & apply new migration (prisma migrate dev)
npm run db:deploy    # Apply migrations in production (prisma migrate deploy)
npm run db:seed      # Seed COA + sample data + admin user
npm run db:studio    # Open Prisma Studio
```

The browser always calls the same origin (`/api/...`); Next.js rewrites `/api/*` to the
internal Express server (`next.config.js`), so there is no CORS in the unified setup.

### Environment files
- `.env` — single root file for both apps (copy from `.env.example`). Express reads it via
  `dotenv`; Next.js reads it natively. `NEXT_PUBLIC_*` vars are exposed to the browser.

MySQL path on this machine: `C:\Program Files\MySQL\MySQL Server 9.4\bin\mysql.exe`

## Architecture

Top-level layout: `app/`, `components/`, `lib/`, `public/` (Next.js) + `server/` (Express API)
+ `prisma/` (schema, migrations, seed), all under one root `package.json`.

### Backend API (`server/`)
- `index.js` — Express app wiring: Helmet, CORS, rate limiting, route mounting, error handler. Binds to `:5000` (internal); Next.js proxies `/api/*` to it
- `routes/` — Thin routers; each file mounts to `/api/<module>`. All routes exported from `routes/index.js`
- `controllers/` — Business logic per module. Prisma queries live here
- `middleware/auth.js` — `authenticate` (JWT verify) and `authorize(...roles)` (RBAC). Roles: ADMIN, MANAGER, ACCOUNTANT, VIEWER
- `middleware/errorHandler.js` — Global Express error handler
- `config/database.js` — Prisma client singleton
- `utils/phCompliance.js` — SSS, PhilHealth, Pag-IBIG, TRAIN Law tax computation helpers

### Database (`prisma/`)
- `prisma/schema.prisma` — All models. After changes: `npm run db:generate && npm run db:migrate`
- `prisma/seed.js` — Seeds 52 PFRS-aligned accounts, admin user, sample vendor/customer/employee

### Frontend (root)
- `app/(auth)/` — Login page (no layout wrapper)
- `app/(dashboard)/` — All authenticated pages; `layout.jsx` wraps with Sidebar + Header
- `lib/api.js` — All API calls via Axios. One named export per module (`auth`, `journal`, `accounts`, `payable`, `receivable`, `payroll`, `bir`, `settings`). Auto-refreshes JWT on 401
- `lib/auth.js` — Session helpers (`getToken`, `getUser`, `setSession`, `clearSession`), `formatCurrency`, `formatDate`
- `lib/print.js` — `printDocument(title, subtitle, bodyHTML)` — opens print window with company letterhead. Also exports `phpFmt()` and `dateFmt()` for formatting inside print HTML
- `components/layout/Sidebar.jsx` — Navigation defined in the `NAV` array. Add new routes here

### UI conventions
Pages follow a consistent pattern:
1. `page-header` div with `page-title` + `page-subtitle` + action buttons
2. Filter `card` with `card-body`
3. Data `card` with table or content

CSS utility classes to reuse: `card`, `card-body`, `btn-primary`, `btn-secondary`, `btn-danger`, `input`, `label`, `badge`, `badge-blue/green/red/yellow`, `page-header`, `page-title`, `page-subtitle`, `sidebar-link`, `sidebar-link-active`, `sidebar-link-inactive`

Icons: Lucide React (`lucide-react`). Charts: Recharts. Toasts: `react-hot-toast`.

### Adding a new module (pattern)
1. Add Prisma model → `npm run db:generate && npm run db:migrate`
2. Create `server/controllers/<module>Controller.js`
3. Create `server/routes/<module>.js` and register in `server/routes/index.js` + `server/index.js`
4. Add API helpers to `lib/api.js`
5. Create pages under `app/(dashboard)/<module>/`
6. Add nav entry to `NAV` array in `components/layout/Sidebar.jsx`

### Auth flow
- JWT stored in `localStorage` as `accessToken` / `refreshToken`
- Axios interceptor auto-refreshes on `401 TOKEN_EXPIRED`
- Backend: wrap routes with `authenticate` then optionally `authorize('ADMIN', 'MANAGER')`

### Print
Always use `printDocument` from `@/lib/print` — it fetches company settings and builds a branded A4 letterhead. Pass raw HTML as `bodyHTML`. Use `phpFmt()` and `dateFmt()` inside the HTML string (not React formatters).
