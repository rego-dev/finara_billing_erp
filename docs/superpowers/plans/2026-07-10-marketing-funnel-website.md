# Finara Marketing Funnel Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public marketing funnel (Home `/`, `/features`, `/pricing`, `/contact`) to the existing Finara Next.js app, with real module screenshots, subtle Framer Motion animations, and DB-backed lead capture; the dashboard home moves from `/` to `/dashboard`.

**Architecture:** New `app/(marketing)/` route group with its own layout (marketing Navbar + Footer, no auth). Marketing components live in `components/marketing/`. Lead capture is a new Prisma `Lead` model + Express `leads` route (public POST, protected GET). Only the dashboard home page moves; all other module URLs stay unchanged.

**Tech Stack:** Next.js 14 App Router, Tailwind (existing `brand`/`primary` palette), Framer Motion 12 (already installed), Lucide React icons, react-hot-toast, Express + Prisma 5 + MySQL 8, Jest for unit tests, Playwright MCP browser tools for screenshots.

## Global Constraints

- Visual style: clean light & corporate — white/light-blue backgrounds, brand color `#0038A8` (Tailwind `brand`), `primary` blue scale, Inter font. NO dark hero, NO heavy parallax.
- Animations: Framer Motion only, subtle — fade-up `whileInView` firing once, stagger on card grids, screenshots scale 0.96→1, hover lifts. Respect the corporate tone.
- All marketing pages must be fully responsive down to 375px width.
- Reuse existing global CSS classes where they fit: `input`, `label`, `btn-primary`, `card`, `card-body`.
- Windows/Prisma: **STOP the dev server before running `prisma generate` / `prisma migrate`** (EPERM DLL lock on Windows). Restart it after.
- Prices on the pricing page are placeholders in PHP — keep the `{/* PLACEHOLDER PRICING — user will edit */}` comment.
- Commit after every task with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Run all shell commands from repo root `d:\Accounting System ERP` (POSIX path `/d/Accounting System ERP` in Bash).

---

### Task 1: Lead validation utility (TDD)

**Files:**
- Create: `server/utils/validateLead.js`
- Test: `tests/validateLead.test.js`

**Interfaces:**
- Produces: `validateLead(body) -> { valid: boolean, errors: object, data: { name, company, email, phone, message, source } }` — consumed by Task 3's controller. `data` strings are trimmed/truncated; optional empties become `null`; `source` defaults to `'contact'`.

- [ ] **Step 1: Write the failing test**

Create `tests/validateLead.test.js`:

```js
const { validateLead } = require('../server/utils/validateLead');

describe('validateLead', () => {
  const valid = {
    name: 'Juan Dela Cruz',
    company: 'ABC Trading',
    email: 'juan@abc.ph',
    phone: '0917-123-4567',
    message: 'Interested in a demo for our accounting team.',
    source: 'pricing',
  };

  test('accepts a complete valid lead', () => {
    const r = validateLead(valid);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.data).toEqual(valid);
  });

  test('rejects missing required fields', () => {
    const r = validateLead({});
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveProperty('name');
    expect(r.errors).toHaveProperty('email');
    expect(r.errors).toHaveProperty('message');
  });

  test('rejects malformed email', () => {
    const r = validateLead({ ...valid, email: 'not-an-email' });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveProperty('email');
  });

  test('trims whitespace and truncates overlong input', () => {
    const r = validateLead({ ...valid, name: `  ${'x'.repeat(300)}  ` });
    expect(r.data.name.length).toBe(100);
  });

  test('nulls empty optionals and defaults source', () => {
    const r = validateLead({ name: 'Ana', email: 'ana@x.ph', message: 'Hi there' });
    expect(r.valid).toBe(true);
    expect(r.data.company).toBeNull();
    expect(r.data.phone).toBeNull();
    expect(r.data.source).toBe('contact');
  });

  test('non-string values are treated as empty', () => {
    const r = validateLead({ name: 123, email: { a: 1 }, message: ['x'] });
    expect(r.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/validateLead.test.js`
Expected: FAIL — `Cannot find module '../server/utils/validateLead'`

- [ ] **Step 3: Write the implementation**

Create `server/utils/validateLead.js`:

```js
// Validation for public marketing lead submissions (POST /api/leads).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validateLead(body = {}) {
  const name    = clean(body.name, 100);
  const company = clean(body.company, 150);
  const email   = clean(body.email, 150);
  const phone   = clean(body.phone, 30);
  const message = clean(body.message, 2000);
  const source  = clean(body.source, 50) || 'contact';

  const errors = {};
  if (!name) errors.name = 'Name is required';
  if (!email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) errors.email = 'Invalid email address';
  if (!message) errors.message = 'Message is required';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: {
      name,
      company: company || null,
      email,
      phone: phone || null,
      message,
      source,
    },
  };
}

module.exports = { validateLead };
```

Note: the "accepts a complete valid lead" test uses all-filled optionals, so `data` equals input verbatim after trim — that is why `expect(r.data).toEqual(valid)` passes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/validateLead.test.js`
Expected: PASS, 6 tests. Also run the full suite `npm test` — all pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/validateLead.js tests/validateLead.test.js
git commit -m "feat: add lead submission validator"
```

---

### Task 2: Lead Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (append at end of file)

**Interfaces:**
- Produces: Prisma model `Lead` with fields `id, name, company?, email, phone?, message, source, status (LeadStatus NEW|CONTACTED|CLOSED), createdAt` — consumed by Task 3 via `prisma.lead`.

- [ ] **Step 1: Append the model to `prisma/schema.prisma`**

```prisma
// ─── Marketing Leads (website contact form) ────────────────
model Lead {
  id        Int        @id @default(autoincrement())
  name      String     @db.VarChar(100)
  company   String?    @db.VarChar(150)
  email     String     @db.VarChar(150)
  phone     String?    @db.VarChar(30)
  message   String     @db.Text
  source    String     @default("contact") @db.VarChar(50)
  status    LeadStatus @default(NEW)
  createdAt DateTime   @default(now())
}

enum LeadStatus {
  NEW
  CONTACTED
  CLOSED
}
```

- [ ] **Step 2: Stop the dev server if running**

Check for a running dev server (nodemon/next). If running in a terminal you control, stop it. Windows locks the Prisma client DLL — `prisma generate` fails with EPERM otherwise.

- [ ] **Step 3: Generate client and run migration**

Run: `npm run db:generate`
Expected: `✔ Generated Prisma Client`

Run: `npx prisma migrate dev --name add_lead_model`
Expected: `Your database is now in sync with your schema.` and a new folder under `prisma/migrations/*_add_lead_model/`.

- [ ] **Step 4: Verify model exists**

Run: `node -e "const p=require('./server/config/database'); p.lead.count().then(c=>{console.log('lead count:',c); process.exit(0)})"`
Expected: `lead count: 0`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Lead model for marketing lead capture"
```

---

### Task 3: Leads API — controller, route, mount, frontend helper

**Files:**
- Create: `server/controllers/leadController.js`
- Create: `server/routes/leads.js`
- Modify: `server/routes/index.js` (add one line)
- Modify: `server/index.js` (mount route, after line 141 `po-form`)
- Modify: `lib/api.js` (add `leads` export at end of file)

**Interfaces:**
- Consumes: `validateLead` from Task 1, `Lead` model from Task 2.
- Produces: `POST /api/leads` (public, rate-limited, body `{name, company?, email, phone?, message, source?}` → 201 `{id, message}` or 400 `{error, details}`); `GET /api/leads` (Bearer auth, ADMIN/MANAGER → array of leads newest first). Frontend: `leads.submit(data)` and `leads.list()` from `@/lib/api`.

- [ ] **Step 1: Create `server/controllers/leadController.js`**

```js
const prisma = require('../config/database');
const { validateLead } = require('../utils/validateLead');

// POST /api/leads — public (marketing site contact form)
exports.create = async (req, res, next) => {
  try {
    const { valid, errors, data } = validateLead(req.body);
    if (!valid) return res.status(400).json({ error: 'Validation failed', details: errors });
    const lead = await prisma.lead.create({ data });
    res.status(201).json({ id: lead.id, message: 'Thank you! We will get back to you shortly.' });
  } catch (err) {
    next(err);
  }
};

// GET /api/leads — ADMIN/MANAGER
exports.list = async (req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(leads);
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 2: Create `server/routes/leads.js`**

```js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/leadController');
const { authenticate, authorize } = require('../middleware/auth');

// Public endpoint — keep a tight limit to deter spam bots.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

router.post('/', submitLimiter, ctrl.create);
router.get('/', authenticate, authorize('ADMIN', 'MANAGER'), ctrl.list);

module.exports = router;
```

- [ ] **Step 3: Register the route**

In `server/routes/index.js`, add inside the exported object (after `poForm` line):

```js
  leads:         require('./leads'),
```

In `server/index.js`, after the line `app.use('/api/po-form',       routes.poForm);` add:

```js
app.use('/api/leads',         routes.leads);
```

- [ ] **Step 4: Add frontend API helper**

In `lib/api.js`, append at the end of the file:

```js
export const leads = {
  submit: (data) => api.post('/leads', data),
  list: () => api.get('/leads'),
};
```

- [ ] **Step 5: Verify endpoints manually**

Start the dev server in the background: `npm run dev` (leave running for later tasks).

Run:
```bash
curl -s -X POST http://localhost:5000/api/leads -H "Content-Type: application/json" -d '{"name":"Test Lead","email":"test@example.com","message":"Hello from curl"}'
```
Expected: `{"id":1,"message":"Thank you! We will get back to you shortly."}`

Run:
```bash
curl -s -X POST http://localhost:5000/api/leads -H "Content-Type: application/json" -d '{"name":"","email":"bad"}'
```
Expected: 400 with `{"error":"Validation failed","details":{...}}`

Run:
```bash
curl -s http://localhost:5000/api/leads
```
Expected: 401 (unauthenticated).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/leadController.js server/routes/leads.js server/routes/index.js server/index.js lib/api.js
git commit -m "feat: leads API - public submit, protected list"
```

---

### Task 4: Move dashboard home from `/` to `/dashboard`

**Files:**
- Move: `app/(dashboard)/page.jsx` → `app/(dashboard)/dashboard/page.jsx`
- Modify: `app/(auth)/login/page.jsx:86`
- Modify: `app/(dashboard)/layout.jsx:53`
- Modify: `components/layout/Sidebar.jsx:23`
- Modify: `lib/permissions.js:13`

**Interfaces:**
- Produces: dashboard home now served at `/dashboard`; the URL `/` becomes free for the marketing home page (Task 8). All other module URLs (`/journal`, `/payable`, ...) unchanged.

- [ ] **Step 1: Move the page file**

```bash
mkdir -p "app/(dashboard)/dashboard"
git mv "app/(dashboard)/page.jsx" "app/(dashboard)/dashboard/page.jsx"
```

- [ ] **Step 2: Update the four `/` references**

`app/(auth)/login/page.jsx` line 86 — change:
```js
      router.push('/');
```
to:
```js
      router.push('/dashboard');
```

`app/(dashboard)/layout.jsx` line 53 (inside the no-access effect) — change:
```js
      router.replace('/');
```
to:
```js
      router.replace('/dashboard');
```

`components/layout/Sidebar.jsx` line 23 — change:
```js
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
```
to:
```js
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
```

`lib/permissions.js` line 13 — change:
```js
  { key: 'dashboard',  label: 'Dashboard',           routes: ['/'],                               always: true },
```
to:
```js
  { key: 'dashboard',  label: 'Dashboard',           routes: ['/dashboard'],                      always: true },
```
(The `r === '/'` special case at `lib/permissions.js:70` becomes dead but harmless — leave it.)

- [ ] **Step 3: Search for any missed references**

Run: `grep -rn "push('/')\|replace('/')\|href=\"/\"" app components lib --include=*.jsx --include=*.js`
Expected: no matches inside dashboard/auth code (marketing components don't exist yet).

- [ ] **Step 4: Verify the login flow in the browser**

With `npm run dev` running, use Playwright MCP tools (load via ToolSearch if needed):
1. Navigate to `http://localhost:3000/login`.
2. Log in with `admin@ph-erp.com` / `Admin@123`. **If login fails** (local password differs from seed default — known on this machine), STOP and ask the user for working credentials before continuing.
3. Expected: redirected to `/dashboard`, dashboard KPI page renders.
4. Navigate to `http://localhost:3000/journal` — journal page still renders.
5. Navigate to `http://localhost:3000/` — expected 404 for now (marketing home comes in Task 8). This is acceptable at this checkpoint.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move dashboard home to /dashboard to free / for marketing site"
```

---

### Task 5: Motion primitives + BrowserFrame + CountUp

**Files:**
- Create: `components/marketing/Reveal.jsx`
- Create: `components/marketing/BrowserFrame.jsx`
- Create: `components/marketing/CountUp.jsx`

**Interfaces:**
- Produces:
  - `Reveal({ children, delay=0, y=24, className })` — fade-up on scroll, fires once.
  - `Stagger({ children, className })` + `StaggerItem({ children, className })` — staggered child reveals (named exports from `Reveal.jsx`).
  - `BrowserFrame({ src, alt, priority=false })` (default export) — screenshot in browser chrome with scale-in animation.
  - `CountUp({ to, suffix='', duration=1.4 })` (default export) — number count-up when scrolled into view.

- [ ] **Step 1: Create `components/marketing/Reveal.jsx`**

```jsx
'use client';
import { motion } from 'framer-motion';

const EASE = [0.22, 0.68, 0, 1];

export function Reveal({ children, delay = 0, y = 24, className = '' }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className = '' }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = '' }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Create `components/marketing/BrowserFrame.jsx`**

```jsx
'use client';
import { motion } from 'framer-motion';

export default function BrowserFrame({ src, alt, priority = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: [0.22, 0.68, 0, 1] }}
      className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-[0_24px_60px_-12px_rgba(0,56,168,0.18)]"
    >
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <span className="ml-3 flex-1 max-w-xs h-5 rounded-md bg-white border border-gray-200 text-[10px] text-gray-400 flex items-center px-2 truncate">
          {alt}
        </span>
      </div>
      <img src={src} alt={alt} loading={priority ? 'eager' : 'lazy'} className="w-full h-auto block" />
    </motion.div>
  );
}
```

- [ ] **Step 3: Create `components/marketing/CountUp.jsx`**

```jsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';

export default function CountUp({ to, suffix = '', duration = 1.4 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start;
    let raf;
    const tick = (t) => {
      if (start === undefined) start = t;
      const p = Math.min((t - start) / (duration * 1000), 1);
      setVal(Math.round(to * (1 - Math.pow(1 - p, 3)))); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);

  return (
    <span ref={ref}>
      {val}
      {suffix}
    </span>
  );
}
```

- [ ] **Step 4: Verify no compile errors**

These components aren't imported by any page yet; confirm the running dev server logs stay clean after saving. (They get exercised in Task 8's browser verification.)

- [ ] **Step 5: Commit**

```bash
git add components/marketing/Reveal.jsx components/marketing/BrowserFrame.jsx components/marketing/CountUp.jsx
git commit -m "feat: marketing motion primitives - Reveal, Stagger, BrowserFrame, CountUp"
```

---

### Task 6: Marketing layout, Navbar, Footer

**Files:**
- Create: `app/(marketing)/layout.jsx`
- Create: `components/marketing/Navbar.jsx`
- Create: `components/marketing/Footer.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `app/(marketing)/layout.jsx` wraps all marketing pages with `<Navbar />` + `{children}` + `<Footer />`. Navbar shows "Go to Dashboard" when `localStorage.accessToken` exists, else "Login" + "Request a Demo".

- [ ] **Step 1: Create `components/marketing/Navbar.jsx`**

```jsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ArrowRight } from 'lucide-react';

const LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Contact', href: '/contact' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setAuthed(!!localStorage.getItem('accessToken'));
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-200 ${
        scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm' : 'bg-white'
      }`}
    >
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <img src="/finara-logo.svg" alt="Finara" className="h-8 w-auto" />
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === l.href
                  ? 'text-brand bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          {authed ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand hover:bg-brand-dark transition-colors"
            >
              Go to Dashboard <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
                Login
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand hover:bg-brand-dark shadow-[0_4px_14px_rgba(0,56,168,0.35)] hover:shadow-[0_6px_20px_rgba(0,56,168,0.45)] hover:-translate-y-px transition-all"
              >
                Request a Demo <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </nav>

      {/* Mobile panel */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1 shadow-lg">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block px-3 py-2.5 rounded-lg text-sm font-medium ${
                pathname === l.href ? 'text-brand bg-blue-50' : 'text-gray-600'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-gray-100 flex flex-col gap-2">
            {authed ? (
              <Link href="/dashboard" className="text-center px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand">
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-center px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200">
                  Login
                </Link>
                <Link href="/contact" className="text-center px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand">
                  Request a Demo
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Create `components/marketing/Footer.jsx`**

```jsx
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 sm:grid-cols-3 gap-10">
        <div>
          <img src="/finara-logo-white.svg" alt="Finara" className="h-8 w-auto mb-4" />
          <p className="text-sm leading-relaxed max-w-xs">
            Philippine-compliant accounting & ERP — double-entry GL, payroll, and BIR
            compliance in one system.
          </p>
        </div>
        <div>
          <h4 className="text-white text-sm font-semibold mb-3">Product</h4>
          <ul className="space-y-2 text-sm">
            <li><Link href="/features" className="hover:text-white transition-colors">Features</Link></li>
            <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
            <li><Link href="/login" className="hover:text-white transition-colors">Login</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-white text-sm font-semibold mb-3">Company</h4>
          <ul className="space-y-2 text-sm">
            <li><Link href="/contact" className="hover:text-white transition-colors">Contact Us</Link></li>
            <li><Link href="/contact" className="hover:text-white transition-colors">Request a Demo</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <span>© {new Date().getFullYear()} Finara. All rights reserved.</span>
          <span>BIR · SSS · PhilHealth · Pag-IBIG · PFRS for SMEs · TRAIN Law</span>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Create `app/(marketing)/layout.jsx`**

```jsx
import Navbar from '@/components/marketing/Navbar';
import Footer from '@/components/marketing/Footer';

export const metadata = {
  title: {
    default: 'Finara — Philippine-Compliant Accounting & ERP',
    template: '%s | Finara',
  },
  description:
    'Finara is an all-in-one accounting and ERP system built for Philippine businesses — general ledger, payables, receivables, payroll with SSS/PhilHealth/Pag-IBIG, and BIR compliance.',
};

export default function MarketingLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 4: Verify no compile errors**

The layout has no page yet (home comes in Task 8), so just confirm dev server logs show no errors after saving files.

- [ ] **Step 5: Commit**

```bash
git add "app/(marketing)/layout.jsx" components/marketing/Navbar.jsx components/marketing/Footer.jsx
git commit -m "feat: marketing layout with navbar and footer"
```

---

### Task 7: Capture module screenshots

**Files:**
- Create: `public/marketing/screenshots/dashboard.png`, `journal.png`, `payable.png`, `receivable.png`, `payroll.png`, `bir.png`, `reports.png`, `inventory.png`

**Interfaces:**
- Produces: eight PNG screenshots at 1440×900 viewport, referenced by Tasks 8–9 as `/marketing/screenshots/<name>.png`.

- [ ] **Step 1: Prepare**

Ensure `npm run dev` is running. Create the target folder:

```bash
mkdir -p public/marketing/screenshots
```

Load Playwright MCP tools via ToolSearch (`browser_navigate`, `browser_resize`, `browser_take_screenshot`, `browser_fill_form`, `browser_click`, `browser_snapshot`).

- [ ] **Step 2: Log in**

1. `browser_navigate` → `http://localhost:3000/login`
2. `browser_resize` → width 1440, height 900
3. Fill email `admin@ph-erp.com`, password `Admin@123`, submit. **If login fails, ask the user for working credentials** (local admin password is known to differ from the seed default on this machine).
4. Expected: lands on `/dashboard`.

- [ ] **Step 3: Capture each module**

For each row, `browser_navigate` to the URL, wait for content to render (use `browser_snapshot` to confirm data is visible, not spinners), then `browser_take_screenshot` (viewport, PNG) with the given filename:

| URL | filename |
|---|---|
| `http://localhost:3000/dashboard` | `dashboard.png` |
| `http://localhost:3000/journal` | `journal.png` |
| `http://localhost:3000/payable` | `payable.png` |
| `http://localhost:3000/receivable` | `receivable.png` |
| `http://localhost:3000/payroll` | `payroll.png` |
| `http://localhost:3000/bir` | `bir.png` |
| `http://localhost:3000/reports/income-statement` | `reports.png` |
| `http://localhost:3000/inventory` | `inventory.png` |

Playwright MCP saves screenshots to its own output directory — copy each file into `public/marketing/screenshots/` with the correct name afterward.

For `reports.png`: if the income statement needs a date range/Generate click before data shows, click Generate first so the screenshot shows real figures.

- [ ] **Step 4: Quality check**

View each PNG (Read tool renders images). Each must show a populated page — tables with rows, charts with data, no empty states, no error toasts. If a page looks empty, either pick a better sub-page of the same module or add minimal sample data via the UI, then recapture.

- [ ] **Step 5: Commit**

```bash
git add public/marketing/screenshots
git commit -m "feat: add real module screenshots for marketing site"
```

---

### Task 8: Home page (main funnel)

**Files:**
- Create: `app/(marketing)/page.jsx`
- Create: `components/marketing/Hero.jsx`
- Create: `components/marketing/ModuleShowcase.jsx`
- Create: `components/marketing/FeatureGrid.jsx`
- Create: `components/marketing/ComplianceStrip.jsx`
- Create: `components/marketing/StatsRow.jsx`
- Create: `components/marketing/CTABanner.jsx`

**Interfaces:**
- Consumes: `Reveal`, `Stagger`, `StaggerItem` (Task 5), `BrowserFrame` (Task 5), `CountUp` (Task 5), screenshots (Task 7).
- Produces: `ModuleShowcase({ title, kicker, description, bullets, image, alt, reverse=false })` — reused by Task 9's features page. `CTABanner()` — reused by Tasks 9–10.

- [ ] **Step 1: Create `components/marketing/Hero.jsx`**

```jsx
'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import BrowserFrame from './BrowserFrame';

const EASE = [0.22, 0.68, 0, 1];

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/80 via-white to-white">
      {/* soft decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-100/60 blur-3xl" />
      <div className="pointer-events-none absolute top-40 -left-32 w-80 h-80 rounded-full bg-blue-50 blur-3xl" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100/70 text-brand text-xs font-semibold tracking-wide uppercase"
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Philippine-Compliant ERP
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-gray-900 leading-[1.08]"
        >
          Accounting software built for
          <span className="text-brand"> Philippine businesses</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
          className="mt-5 max-w-2xl mx-auto text-base sm:text-lg text-gray-500 leading-relaxed"
        >
          Finara brings your general ledger, payables, receivables, payroll, and BIR
          compliance into one system — PFRS-aligned and TRAIN Law ready.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
          className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-base font-bold text-white bg-brand hover:bg-brand-dark shadow-[0_8px_24px_rgba(0,56,168,0.35)] hover:shadow-[0_12px_32px_rgba(0,56,168,0.45)] hover:-translate-y-0.5 transition-all"
          >
            Request a Demo <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/features"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-base font-semibold text-gray-700 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all"
          >
            Explore Features
          </Link>
        </motion.div>

        <div className="mt-14 max-w-5xl mx-auto">
          <BrowserFrame src="/marketing/screenshots/dashboard.png" alt="Finara Dashboard" priority />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `components/marketing/ModuleShowcase.jsx`**

```jsx
import Link from 'next/link';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';
import BrowserFrame from './BrowserFrame';

export default function ModuleShowcase({
  title,
  kicker,
  description,
  bullets = [],
  image,
  alt,
  reverse = false,
}) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
      <div
        className={`grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center ${
          reverse ? 'lg:[&>*:first-child]:order-2' : ''
        }`}
      >
        <Reveal>
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">{kicker}</p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">{title}</h2>
          <p className="mt-4 text-gray-500 leading-relaxed">{description}</p>
          <ul className="mt-6 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-gray-700">
                <CheckCircle2 className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" />
                {b}
              </li>
            ))}
          </ul>
          <Link
            href="/contact"
            className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:gap-2.5 transition-all"
          >
            See it in action <ArrowRight className="w-4 h-4" />
          </Link>
        </Reveal>
        <div>
          <BrowserFrame src={image} alt={alt} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create `components/marketing/FeatureGrid.jsx`**

```jsx
import {
  Receipt, FileText, Boxes, ShoppingCart, PiggyBank, Building2, ScrollText, Briefcase,
} from 'lucide-react';
import { Reveal, Stagger, StaggerItem } from './Reveal';

const FEATURES = [
  { icon: Receipt,      title: 'Accounts Payable',    text: 'Track vendor bills, due dates, and payments with aging reports.' },
  { icon: FileText,     title: 'Accounts Receivable', text: 'Invoices, quotations, collections, and customer aging at a glance.' },
  { icon: Boxes,        title: 'Inventory',           text: 'Items, stock transactions, and inventory valuation reports.' },
  { icon: ShoppingCart, title: 'Purchase Orders',     text: 'Create POs and convert them straight into vendor bills.' },
  { icon: PiggyBank,    title: 'Budgeting',           text: 'Set budgets per account and monitor actual vs. plan.' },
  { icon: Briefcase,    title: 'Fixed Assets',        text: 'Asset registry with automatic depreciation schedules.' },
  { icon: ScrollText,   title: 'Audit Trail',         text: 'Every change logged — who, what, and when, for full accountability.' },
  { icon: Building2,    title: 'Multi-Business',      text: 'Run multiple companies in one system with separated books.' },
];

export default function FeatureGrid() {
  return (
    <section className="bg-gray-50/70 border-y border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <Reveal className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Everything included</p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            One system for the whole back office
          </h2>
          <p className="mt-4 text-gray-500">
            Beyond the core books, Finara covers the day-to-day operations around them.
          </p>
        </Reveal>
        <Stagger className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <StaggerItem key={f.title}>
              <div className="h-full bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-gray-900 text-sm">{f.title}</h3>
                <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{f.text}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `components/marketing/ComplianceStrip.jsx`**

```jsx
import { ShieldCheck } from 'lucide-react';
import { Reveal, Stagger, StaggerItem } from './Reveal';

const BADGES = [
  'BIR VAT (2550)', 'Expanded Withholding Tax', 'Alphalist', 'RELIEF',
  'SSS', 'PhilHealth', 'Pag-IBIG', 'TRAIN Law Payroll', 'PFRS for SMEs',
];

export default function ComplianceStrip() {
  return (
    <section className="bg-brand">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 text-center">
        <Reveal>
          <ShieldCheck className="w-10 h-10 text-blue-200 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Compliance is built in, not bolted on
          </h2>
          <p className="mt-3 text-blue-200 max-w-xl mx-auto text-sm sm:text-base">
            Statutory tables and BIR report formats ship with the system and stay current —
            no spreadsheets, no manual lookups.
          </p>
        </Reveal>
        <Stagger className="mt-8 flex flex-wrap justify-center gap-2.5">
          {BADGES.map((b) => (
            <StaggerItem key={b}>
              <span className="inline-block px-4 py-2 rounded-full text-xs font-semibold text-white bg-white/10 border border-white/20 backdrop-blur-sm">
                {b}
              </span>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create `components/marketing/StatsRow.jsx`**

```jsx
import { Reveal } from './Reveal';
import CountUp from './CountUp';

const STATS = [
  { to: 20, suffix: '+', label: 'Integrated modules' },
  { to: 52, suffix: '', label: 'PFRS-aligned accounts' },
  { to: 4, suffix: '', label: 'Statutory agencies covered' },
  { to: 10, suffix: '+', label: 'Financial & BIR reports' },
];

export default function StatsRow() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
      <Reveal className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
        {STATS.map((s) => (
          <div key={s.label}>
            <div className="text-4xl sm:text-5xl font-black text-brand tracking-tight">
              <CountUp to={s.to} suffix={s.suffix} />
            </div>
            <p className="mt-2 text-xs sm:text-sm text-gray-500 font-medium">{s.label}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
```

- [ ] **Step 6: Create `components/marketing/CTABanner.jsx`**

```jsx
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';

export default function CTABanner() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark px-6 sm:px-12 py-12 sm:py-16 text-center">
          <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-white/5 blur-2xl" />
          <h2 className="relative text-2xl sm:text-4xl font-black text-white tracking-tight">
            Ready to see Finara in action?
          </h2>
          <p className="relative mt-3 text-blue-200 max-w-lg mx-auto text-sm sm:text-base">
            Tell us about your business and we&apos;ll walk you through the system with your
            own use cases.
          </p>
          <Link
            href="/contact"
            className="relative mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-xl text-base font-bold text-brand bg-white hover:bg-blue-50 shadow-lg hover:-translate-y-0.5 transition-all"
          >
            Request a Demo <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
```

- [ ] **Step 7: Create `app/(marketing)/page.jsx`**

```jsx
import Hero from '@/components/marketing/Hero';
import ModuleShowcase from '@/components/marketing/ModuleShowcase';
import FeatureGrid from '@/components/marketing/FeatureGrid';
import ComplianceStrip from '@/components/marketing/ComplianceStrip';
import StatsRow from '@/components/marketing/StatsRow';
import CTABanner from '@/components/marketing/CTABanner';

export const metadata = {
  title: 'Finara — Philippine-Compliant Accounting & ERP',
  description:
    'General ledger, payables, receivables, payroll with SSS/PhilHealth/Pag-IBIG, and BIR compliance — one system built for Philippine businesses.',
  openGraph: {
    title: 'Finara — Philippine-Compliant Accounting & ERP',
    description: 'One system for your books, payroll, and BIR compliance.',
    images: ['/marketing/screenshots/dashboard.png'],
  },
};

export default function HomePage() {
  return (
    <>
      <Hero />

      <ModuleShowcase
        kicker="General Ledger"
        title="Double-entry that balances itself"
        description="Post journal entries with a draft → posted → voided workflow on top of a 52-account, PFRS-aligned chart of accounts. Your trial balance is always in balance — by construction."
        bullets={[
          'PFRS-aligned chart of accounts out of the box',
          'Draft, post, and void workflow with full audit trail',
          'Recurring entries for month-end routines',
        ]}
        image="/marketing/screenshots/journal.png"
        alt="Finara General Ledger"
      />

      <ModuleShowcase
        reverse
        kicker="Payroll"
        title="TRAIN Law payroll in minutes"
        description="Run payroll periods with SSS, PhilHealth, Pag-IBIG, and BIR withholding computed automatically from built-in statutory tables — no manual lookups."
        bullets={[
          'SSS, PhilHealth & Pag-IBIG contribution tables built in',
          'BIR TRAIN Law withholding tax computation',
          'Payslips, payroll periods, and remittance summaries',
        ]}
        image="/marketing/screenshots/payroll.png"
        alt="Finara Payroll"
      />

      <ModuleShowcase
        kicker="BIR Compliance"
        title="BIR reports without the spreadsheet gymnastics"
        description="Generate the reports your accountant files every month and quarter — straight from your posted books."
        bullets={[
          'VAT summary and returns support (2550)',
          'Expanded withholding tax (EWT) tracking',
          'Alphalist and RELIEF exports',
        ]}
        image="/marketing/screenshots/bir.png"
        alt="Finara BIR Compliance"
      />

      <ModuleShowcase
        reverse
        kicker="Reports"
        title="Financial statements on demand"
        description="Income statement, balance sheet, and trial balance are always up to date — plus a custom report builder when you need a different cut of the numbers."
        bullets={[
          'Income statement & balance sheet in one click',
          'Trial balance with drill-down to entries',
          'Custom report builder for your own formats',
        ]}
        image="/marketing/screenshots/reports.png"
        alt="Finara Financial Reports"
      />

      <FeatureGrid />
      <ComplianceStrip />
      <StatsRow />
      <CTABanner />
    </>
  );
}
```

- [ ] **Step 8: Verify in browser**

Navigate to `http://localhost:3000/`:
- Hero renders with staggered entrance, dashboard screenshot in browser frame.
- Scrolling reveals each showcase section (fade-up, once).
- Feature cards stagger in; compliance strip badges stagger; stats count up.
- Both hero CTAs navigate (`/contact` will 404 until Task 11 — acceptable now; `/features` 404 until Task 9 — acceptable now).
- Resize to 375px width — no horizontal scroll, hamburger menu works.

- [ ] **Step 9: Commit**

```bash
git add "app/(marketing)/page.jsx" components/marketing
git commit -m "feat: marketing home page with animated module showcases"
```

---

### Task 9: Features page

**Files:**
- Create: `app/(marketing)/features/page.jsx`

**Interfaces:**
- Consumes: `ModuleShowcase`, `CTABanner`, `Reveal`, `Stagger`, `StaggerItem` (Tasks 5, 8), screenshots (Task 7).

- [ ] **Step 1: Create `app/(marketing)/features/page.jsx`**

```jsx
import ModuleShowcase from '@/components/marketing/ModuleShowcase';
import CTABanner from '@/components/marketing/CTABanner';
import { Reveal, Stagger, StaggerItem } from '@/components/marketing/Reveal';
import {
  Landmark, RefreshCcw, PiggyBank, Briefcase, ScrollText, Building2, ShoppingCart, Wallet,
} from 'lucide-react';

export const metadata = {
  title: 'Features',
  description:
    'Explore every Finara module — general ledger, AP, AR, payroll, BIR compliance, reports, and inventory.',
};

const MODULES = [
  {
    kicker: 'General Ledger',
    title: 'The core of your books',
    description:
      'Full double-entry accounting with a PFRS-aligned chart of accounts. Journal entries move through draft, posted, and voided states, and every posting is traceable.',
    bullets: [
      '52 PFRS-aligned accounts, extendable to your needs',
      'Draft → posted → voided workflow',
      'Trial balance with drill-down to source entries',
    ],
    image: '/marketing/screenshots/journal.png',
    alt: 'Finara General Ledger',
  },
  {
    kicker: 'Accounts Payable',
    title: 'Know what you owe, and when',
    description:
      'Manage vendors, record bills, schedule payments, and watch aging buckets so nothing slips past due.',
    bullets: [
      'Vendor registry with TIN and contact details',
      'Bills with due-date tracking and partial payments',
      'AP aging report by vendor and bucket',
    ],
    image: '/marketing/screenshots/payable.png',
    alt: 'Finara Accounts Payable',
  },
  {
    kicker: 'Accounts Receivable',
    title: 'Invoice, collect, and stay on top of customers',
    description:
      'From quotation to invoice to collection — track every peso your customers owe with clear aging.',
    bullets: [
      'Quotations that convert to invoices',
      'Collections with automatic ledger posting',
      'AR aging report by customer and bucket',
    ],
    image: '/marketing/screenshots/receivable.png',
    alt: 'Finara Accounts Receivable',
  },
  {
    kicker: 'Payroll',
    title: 'Philippine payroll, computed correctly',
    description:
      'SSS, PhilHealth, Pag-IBIG, and BIR TRAIN Law withholding are computed from built-in statutory tables every payroll period.',
    bullets: [
      'Statutory contribution tables maintained in-system',
      'TRAIN Law withholding tax computation',
      'Payslips and remittance-ready summaries',
    ],
    image: '/marketing/screenshots/payroll.png',
    alt: 'Finara Payroll',
  },
  {
    kicker: 'BIR Compliance',
    title: 'File with confidence',
    description:
      'Your BIR reports come straight from posted books — VAT summaries, expanded withholding, Alphalist, and RELIEF exports.',
    bullets: [
      'VAT (2550) summary from actual transactions',
      'EWT tracking per vendor',
      'Alphalist & RELIEF export formats',
    ],
    image: '/marketing/screenshots/bir.png',
    alt: 'Finara BIR Compliance',
  },
  {
    kicker: 'Reports',
    title: 'Answers, not exports',
    description:
      'Standard financial statements are one click away, and the custom report builder covers everything else.',
    bullets: [
      'Income statement, balance sheet, trial balance',
      'Custom report builder with saved reports',
      'Print-ready output with your company letterhead',
    ],
    image: '/marketing/screenshots/reports.png',
    alt: 'Finara Reports',
  },
  {
    kicker: 'Inventory',
    title: 'Stock that ties to your books',
    description:
      'Track items and stock movements with valuation that flows into your financials automatically.',
    bullets: [
      'Item master with categories and units',
      'Stock-in, stock-out, and adjustment transactions',
      'Inventory valuation reports',
    ],
    image: '/marketing/screenshots/inventory.png',
    alt: 'Finara Inventory',
  },
];

const MORE = [
  { icon: ShoppingCart, label: 'Purchase Orders' },
  { icon: Wallet,       label: 'Expenses' },
  { icon: PiggyBank,    label: 'Budgeting' },
  { icon: Briefcase,    label: 'Fixed Assets' },
  { icon: Landmark,     label: 'Bank & Reconciliation' },
  { icon: RefreshCcw,   label: 'Recurring Entries' },
  { icon: ScrollText,   label: 'Audit Trail' },
  { icon: Building2,    label: 'Multi-Business' },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-blue-50/80 to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-8 text-center">
          <Reveal>
            <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Features</p>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-900">
              Every module, working from one ledger
            </h1>
            <p className="mt-4 max-w-2xl mx-auto text-gray-500 text-base sm:text-lg">
              No sync jobs, no imports between tools — each module posts to the same
              double-entry core.
            </p>
          </Reveal>
        </div>
      </section>

      {MODULES.map((m, i) => (
        <ModuleShowcase key={m.kicker} {...m} reverse={i % 2 === 1} />
      ))}

      <section className="bg-gray-50/70 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <Reveal className="text-center">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              …and the operations around them
            </h2>
          </Reveal>
          <Stagger className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {MORE.map((m) => (
              <StaggerItem key={m.label}>
                <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3.5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <m.icon className="w-5 h-5 text-brand flex-shrink-0" />
                  <span className="text-sm font-semibold text-gray-800">{m.label}</span>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <div className="pt-16">
        <CTABanner />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:3000/features`: all seven module sections render alternating left/right with screenshots animating in; "more" grid staggers; CTA banner at bottom links to `/contact`. Check 375px width.

- [ ] **Step 3: Commit**

```bash
git add "app/(marketing)/features/page.jsx"
git commit -m "feat: marketing features page"
```

---

### Task 10: Pricing page

**Files:**
- Create: `app/(marketing)/pricing/page.jsx`
- Create: `components/marketing/PricingSection.jsx`

**Interfaces:**
- Consumes: `Reveal`, `Stagger`, `StaggerItem`, `CTABanner`.
- Produces: standalone pricing page; all tier CTAs link to `/contact?plan=<tier>` so the contact form can note the plan (Task 11 reads the `plan` query param).

- [ ] **Step 1: Create `components/marketing/PricingSection.jsx`**

```jsx
'use client';
import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';
import { Stagger, StaggerItem } from './Reveal';

// PLACEHOLDER PRICING — user will edit the amounts below before launch.
const TIERS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '₱1,499',
    per: '/month',
    tagline: 'For small businesses getting their books in order.',
    features: [
      '1 business',
      'Up to 3 users',
      'General Ledger & Chart of Accounts',
      'Accounts Payable & Receivable',
      'Standard financial reports',
    ],
    highlighted: false,
  },
  {
    key: 'professional',
    name: 'Professional',
    price: '₱3,499',
    per: '/month',
    tagline: 'For growing teams that need payroll and compliance.',
    features: [
      'Everything in Starter',
      'Up to 10 users',
      'Payroll with SSS / PhilHealth / Pag-IBIG / TRAIN',
      'BIR compliance (VAT, EWT, Alphalist, RELIEF)',
      'Inventory & Purchase Orders',
      'Priority support',
    ],
    highlighted: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    per: '',
    tagline: 'For multi-company operations with custom needs.',
    features: [
      'Everything in Professional',
      'Unlimited users & multi-business',
      'Custom report builder onboarding',
      'Data migration assistance',
      'Dedicated support & training',
    ],
    highlighted: false,
  },
];

export default function PricingSection() {
  return (
    <Stagger className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
      {TIERS.map((t) => (
        <StaggerItem key={t.key} className="h-full">
          <div
            className={`relative h-full flex flex-col rounded-2xl border p-7 transition-all duration-200 hover:-translate-y-1 ${
              t.highlighted
                ? 'border-brand bg-white shadow-[0_20px_50px_-12px_rgba(0,56,168,0.3)] lg:scale-[1.03]'
                : 'border-gray-200 bg-white shadow-sm hover:shadow-md'
            }`}
          >
            {t.highlighted && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand text-white text-[11px] font-bold tracking-wide uppercase">
                Most Popular
              </span>
            )}
            <h3 className="text-lg font-bold text-gray-900">{t.name}</h3>
            <p className="mt-1 text-xs text-gray-500">{t.tagline}</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-black text-gray-900 tracking-tight">{t.price}</span>
              <span className="text-sm text-gray-400">{t.per}</span>
            </div>
            <ul className="mt-6 space-y-2.5 flex-1">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={`/contact?plan=${t.key}`}
              className={`mt-7 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all ${
                t.highlighted
                  ? 'text-white bg-brand hover:bg-brand-dark shadow-[0_6px_18px_rgba(0,56,168,0.35)]'
                  : 'text-brand bg-blue-50 hover:bg-blue-100'
              }`}
            >
              {t.key === 'enterprise' ? 'Talk to Us' : 'Get Started'} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
```

- [ ] **Step 2: Create `app/(marketing)/pricing/page.jsx`**

```jsx
import PricingSection from '@/components/marketing/PricingSection';
import CTABanner from '@/components/marketing/CTABanner';
import { Reveal } from '@/components/marketing/Reveal';

export const metadata = {
  title: 'Pricing',
  description: 'Simple plans for Philippine businesses of every size.',
};

export default function PricingPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-blue-50/80 to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-8 text-center">
          <Reveal>
            <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Pricing</p>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-900">
              Plans that grow with your business
            </h1>
            <p className="mt-4 max-w-xl mx-auto text-gray-500 text-base sm:text-lg">
              Start with the books, add payroll and compliance when you&apos;re ready. No
              per-transaction fees.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-16">
        <PricingSection />
        <Reveal className="mt-10 text-center">
          <p className="text-xs text-gray-400">
            All prices are in Philippine pesos, VAT-exclusive. Annual billing discounts
            available — ask us.
          </p>
        </Reveal>
      </section>

      <CTABanner />
    </>
  );
}
```

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:3000/pricing`: three tiers stagger in, middle tier highlighted with "Most Popular" badge, CTAs link to `/contact?plan=starter|professional|enterprise`. Check 375px width (tiers stack vertically).

- [ ] **Step 4: Commit**

```bash
git add "app/(marketing)/pricing/page.jsx" components/marketing/PricingSection.jsx
git commit -m "feat: marketing pricing page with placeholder tiers"
```

---

### Task 11: Contact page with lead form

**Files:**
- Create: `app/(marketing)/contact/page.jsx`
- Create: `components/marketing/ContactForm.jsx`

**Interfaces:**
- Consumes: `leads.submit(data)` from `lib/api.js` (Task 3); `plan` query param from Task 10's pricing CTAs.
- Produces: the funnel's conversion endpoint.

- [ ] **Step 1: Create `components/marketing/ContactForm.jsx`**

```jsx
'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Send, CheckCircle2 } from 'lucide-react';
import { leads } from '@/lib/api';

const PLAN_LABELS = {
  starter: 'Starter plan',
  professional: 'Professional plan',
  enterprise: 'Enterprise plan',
};

function ContactFormInner() {
  const searchParams = useSearchParams();
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // Pre-fill the message when arriving from a pricing tier CTA.
  useEffect(() => {
    const plan = PLAN_LABELS[searchParams.get('plan')];
    if (plan) {
      setForm((f) => (f.message ? f : { ...f, message: `Hi! I'm interested in the ${plan}. ` }));
    }
  }, [searchParams]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const plan = searchParams.get('plan');
      await leads.submit({ ...form, source: plan ? `pricing:${plan}` : 'contact' });
      setSent(true);
      toast.success('Message sent! We will get back to you shortly.');
    } catch (err) {
      const details = err.response?.data?.details;
      toast.error(
        details ? Object.values(details)[0] : err.response?.data?.error || 'Something went wrong. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-gray-900">Thank you!</h3>
        <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
          Your message is in. We&apos;ll reach out within one business day to schedule your demo.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Full Name *</label>
          <input className="input" required maxLength={100} value={form.name} onChange={set('name')} placeholder="Juan Dela Cruz" />
        </div>
        <div>
          <label className="label">Company</label>
          <input className="input" maxLength={150} value={form.company} onChange={set('company')} placeholder="ABC Trading Corp." />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Email Address *</label>
          <input className="input" type="email" required maxLength={150} value={form.email} onChange={set('email')} placeholder="you@company.com" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" maxLength={30} value={form.phone} onChange={set('phone')} placeholder="0917 123 4567" />
        </div>
      </div>
      <div>
        <label className="label">How can we help? *</label>
        <textarea
          className="input min-h-[120px] resize-y"
          required
          maxLength={2000}
          value={form.message}
          onChange={set('message')}
          placeholder="Tell us about your business and what you're looking for…"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl text-base font-bold text-white bg-brand hover:bg-brand-dark disabled:bg-blue-300 shadow-[0_6px_18px_rgba(0,56,168,0.35)] hover:-translate-y-0.5 transition-all"
      >
        {loading ? 'Sending…' : (<>Send Message <Send className="w-4 h-4" /></>)}
      </button>
    </form>
  );
}

export default function ContactForm() {
  return (
    <Suspense fallback={null}>
      <ContactFormInner />
    </Suspense>
  );
}
```

(`useSearchParams` requires the `Suspense` wrapper to avoid a Next.js CSR bailout error during build.)

- [ ] **Step 2: Create `app/(marketing)/contact/page.jsx`**

```jsx
import { Mail, Clock, MessageSquareText } from 'lucide-react';
import ContactForm from '@/components/marketing/ContactForm';
import { Reveal } from '@/components/marketing/Reveal';

export const metadata = {
  title: 'Contact Us',
  description: 'Request a demo or ask us anything about Finara.',
};

// Editable marketing copy — update the email/hours to your real contact details.
const INFO = [
  { icon: Mail, title: 'Email us', text: 'sales@finara.ph' },
  { icon: Clock, title: 'Response time', text: 'Within one business day' },
  { icon: MessageSquareText, title: 'What happens next', text: 'A short call, then a guided demo with your own use cases.' },
];

export default function ContactPage() {
  return (
    <section className="bg-gradient-to-b from-blue-50/80 to-white min-h-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-20">
        <Reveal className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Contact Us</p>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-900">
            Let&apos;s get your books in order
          </h1>
          <p className="mt-4 text-gray-500 text-base sm:text-lg">
            Tell us about your business — we&apos;ll show you exactly how Finara fits.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          <Reveal className="lg:col-span-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_16px_40px_-12px_rgba(0,56,168,0.12)] p-6 sm:p-8">
              <ContactForm />
            </div>
          </Reveal>
          <Reveal delay={0.15} className="lg:col-span-2 space-y-4">
            {INFO.map((i) => (
              <div key={i.title} className="flex items-start gap-4 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center flex-shrink-0">
                  <i.icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{i.title}</h3>
                  <p className="mt-0.5 text-sm text-gray-500">{i.text}</p>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify end-to-end**

1. Navigate to `http://localhost:3000/contact`, fill the form, submit.
2. Expected: success state with green check + toast.
3. Verify the row landed:
```bash
node -e "const p=require('./server/config/database'); p.lead.findMany({orderBy:{id:'desc'},take:1}).then(r=>{console.log(r); process.exit(0)})"
```
Expected: the lead you just submitted.
4. Navigate to `http://localhost:3000/contact?plan=professional` — message field pre-fills with "Hi! I'm interested in the Professional plan."
5. Submit with an empty name (clear required manually via devtools or rely on HTML validation) — HTML `required` blocks it client-side; server 400 path already verified in Task 3.

- [ ] **Step 4: Commit**

```bash
git add "app/(marketing)/contact/page.jsx" components/marketing/ContactForm.jsx
git commit -m "feat: contact page with DB-backed lead capture"
```

---

### Task 12: Full-funnel verification & production build

**Files:**
- No new files; fixes only if verification finds issues.

- [ ] **Step 1: Run the test suite**

Run: `npm test`
Expected: all suites pass (including `validateLead.test.js`).

- [ ] **Step 2: Production build**

Stop the dev server first (Windows file locks), then:
Run: `npm run build`
Expected: build succeeds; route list shows `/`, `/features`, `/pricing`, `/contact`, `/dashboard`, and all existing dashboard routes. Restart `npm run dev` afterward.

- [ ] **Step 3: Walk the funnel in the browser**

1. `/` → hero, showcases animate on scroll, all nav links work.
2. `/features` → 7 module sections + more-grid.
3. `/pricing` → tiers render; "Get Started" → `/contact?plan=starter`.
4. `/contact` → submit a lead; verify success + DB row.
5. Navbar "Login" → `/login` → sign in → lands on `/dashboard`.
6. Back on `/` while logged in → navbar shows "Go to Dashboard".
7. Spot-check `/journal`, `/payable`, `/payroll` still work.
8. Mobile (375px): all four marketing pages — no horizontal scroll, hamburger works.

- [ ] **Step 4: Fix anything found, then final commit**

```bash
git add -A
git commit -m "chore: marketing funnel verification fixes"
```
(Skip the commit if nothing changed.)
