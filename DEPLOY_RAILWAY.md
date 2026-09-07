# Railway Deployment — Fix & Full Setup

Your backend API is already live (`/health` returns OK). The root URL shows
`{"error":"Route not found"}` because the backend is an **API-only** server with
no `/` page — that is normal. To make your *project* (the actual UI) appear, you
need the **frontend** deployed as its own service. This guide gets all three
services online: MySQL database, backend API, frontend UI.

The two config files I added (`backend/railway.json`, `frontend/railway.json`)
tell Railway exactly how to build and start each service.

---

## 0. One-time cleanup on your PC

A stale Git lock is blocking commits. In PowerShell:

```powershell
cd "D:\Accounting System ERP"
del .git\index.lock
```

(If `del` says the file isn't there, that's fine — skip it.)

---

## 1. Commit & push the new config

I moved `prisma` from devDependencies to dependencies in `backend/package.json`
(so Railway doesn't strip it under `NODE_ENV=production`). Regenerate the
lockfile so it stays in sync, then push:

```powershell
cd "D:\Accounting System ERP\backend"
npm install            # updates package-lock.json to match package.json
cd "D:\Accounting System ERP"
git add backend/railway.json frontend/railway.json backend/package.json backend/package-lock.json DEPLOY_RAILWAY.md
git commit -m "chore: add Railway deploy config; make prisma a runtime dependency"
git push origin main
```

---

## 2. Provision a MySQL database (Railway dashboard)

Your Prisma schema uses **MySQL** (not Postgres), so add a MySQL DB:

1. Open your project on railway.app.
2. **+ New → Database → Add MySQL.**
3. It creates a `MySQL` service with a `MYSQL_URL` variable.

---

## 3. Backend service settings

Open your existing backend service (the one serving `finara-erp-production`):

- **Settings → Source → Root Directory:** set to `backend`
- **Settings → Build:** leave as Nixpacks (the new `railway.json` is picked up
  automatically).
- **Variables** (Settings → Variables) — add/confirm:

  | Variable | Value |
  |---|---|
  | `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` (reference the MySQL service) |
  | `NODE_ENV` | `production` |
  | `JWT_SECRET` | a long random string |
  | `JWT_REFRESH_SECRET` | a different long random string |
  | `JWT_EXPIRES_IN` | `8h` |
  | `JWT_REFRESH_EXPIRES_IN` | `7d` |
  | `FRONTEND_URL` | your frontend URL from step 4 (for CORS) |

  > Don't set `PORT` — Railway provides it automatically.

On deploy, the start command runs `prisma migrate deploy` first, which creates
all your tables in the new MySQL database.

---

## 4. Frontend service (new)

1. **+ New → GitHub Repo →** select `finara-erp` (same repo).
2. **Settings → Source → Root Directory:** set to `frontend`.
3. **Variables:**

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://finara-erp-production.up.railway.app` (your backend URL) |

4. **Settings → Networking → Generate Domain.** This new domain is your
   **project URL** — open it and you'll see the actual app (login page), not
   "Route not found".
5. Go back to the **backend** service and set `FRONTEND_URL` to this frontend
   domain, then redeploy the backend (so CORS allows the browser).

---

## 5. Remove the broken "web" service (if present)

An earlier setup attempt created a service from an IaC placeholder
(`import-placeholder` / a service named `web`) pointing at the repo root, which
has no `package.json` — that is the deploy that **fails to build**. Delete it:

- Click that service → **Settings → Danger → Remove Service.**

Only the three good services should remain: **MySQL**, **backend**, **frontend**.

---

## 6. Seed the first admin user (once)

After the backend deploys and migrations run, create the admin/login data.
In the **backend** service:

- Open the service **shell** (or a one-off command) and run:
  ```
  node prisma/seed.js
  ```
  This seeds the chart of accounts and an admin user (see `prisma/seed.js`
  for the default credentials).

---

## 7. Verify

- Backend health: `https://finara-erp-production.up.railway.app/health` → `{"status":"ok"}`
- Frontend: open the generated frontend domain → login page loads.
- Log in with the seeded admin account.

---

### Why the build was failing
Your application code is fine — both the frontend (`next build`) and backend
build cleanly. The failure was a **Railway configuration** problem: a service
was trying to build from the repo root (no `package.json` there) and there was
no explicit build/start config telling Railway how to handle this monorepo.
The two `railway.json` files plus per-service Root Directory settings fix that.
