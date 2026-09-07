# Finara Marketing Funnel Website — Design

**Date:** 2026-07-10
**Status:** Approved

## Goal

A complete promotional funnel for the Finara ERP system, living inside the same Next.js app: Home → Features → Pricing → Contact Us. Features the accounting modules with real screenshots, subtle scroll animations, and clear CTAs that drive visitors to the lead-capture form.

## Decisions

| Decision | Choice |
|---|---|
| Site location | Same Next.js app, new `app/(marketing)/` route group; landing page at `/` |
| Dashboard routing | Only dashboard home moves: `/` → `/dashboard`; all module URLs unchanged |
| Screenshots | Real captures via Playwright from the locally running app |
| Pages | Home (single scrolling funnel), Features, Pricing, Contact Us |
| Lead handling | Save to MySQL via new Prisma `Lead` model + Express endpoint |
| Pricing content | 3 placeholder tiers in PHP (user edits actual figures later) |
| Visual style | Clean light & corporate — white/light-blue, brand color #0038A8, subtle animations |
| Animation library | Framer Motion (already in dependencies) |

## 1. Architecture & Routing

- New route group **`app/(marketing)/`** with its own `layout.jsx` — marketing navbar + footer, no Sidebar, no auth check. Pages:
  - `/` — Home (main funnel page)
  - `/features` — per-module deep dive
  - `/pricing` — tiers + comparison table
  - `/contact` — lead form + company info
- **Dashboard home moves:** `app/(dashboard)/page.jsx` → `app/(dashboard)/dashboard/page.jsx` (URL `/dashboard`). All other authenticated URLs unchanged (`/journal`, `/payable`, `/payroll`, `/bir`, ...).
- Required updates: login redirect target, sidebar logo link, any `router.push('/')` or `href="/"` references inside the dashboard/auth pages.
- Marketing components in **`components/marketing/`**: `Navbar`, `Footer`, `Hero`, `ModuleShowcase`, `FeatureGrid`, `PricingSection`, `CTABanner`, `ContactForm`, `BrowserFrame`, `Reveal` (motion wrapper).
- Navbar auth awareness: if `accessToken` exists in localStorage, show **"Go to Dashboard"** instead of **"Login"** (which links to the existing `/login` page).

## 2. Screenshot Pipeline

- Run the app locally, log in, capture real screenshots via Playwright at 1440px viewport width.
- Modules to capture: Dashboard, Journal/GL, Accounts Payable, Accounts Receivable, Payroll, BIR Compliance, Reports (Income Statement), Inventory.
- Saved to `public/marketing/screenshots/*.png`.
- Each screenshot rendered inside a **BrowserFrame** component (browser chrome bar + soft shadow, rounded corners).
- If seeded data looks sparse, touch up sample data first so captures look presentable.

## 3. Page Content (Funnel Flow)

### Home
1. **Hero** — headline positioning Finara as a Philippine-compliant ERP ("Built for PH businesses — BIR, SSS, PhilHealth, Pag-IBIG ready"), subtext, dual CTA: **"Request a Demo"** → `/contact` (primary), "Explore Features" → `/features` (secondary). Hero screenshot: Dashboard in a BrowserFrame.
2. **Module showcases** — alternating left/right sections (screenshot + copy) for the flagship modules.
3. **Features icon grid** — quick-scan grid using Lucide icons.
4. **BIR compliance highlight strip** — VAT, EWT, Alphalist, RELIEF, TRAIN Law payroll.
5. **Stats row** — count-up numbers (modules, report types, statutory tables).
6. **Final CTA banner** — "Request a Demo" repeat.
7. **Footer** — nav links, contact info, copyright.

### Features
Per-module sections with screenshot + bullet list: GL/Journal, AP, AR, Payroll (PH statutory computations highlighted), BIR (VAT, EWT, Alphalist, RELIEF), Reports, Inventory, Budget/Assets.

### Pricing
3 placeholder tiers in PHP: **Starter / Professional / Enterprise (custom pricing)**. Feature comparison table. Every tier CTA → `/contact`.

### Contact Us
Lead form: name, company, email, phone, message. Company info block. Success toast (`react-hot-toast`) on submit.

## 4. Lead Capture Backend

- Prisma model **`Lead`**: `id`, `name`, `company?`, `email`, `phone?`, `message`, `source` (originating page), `status` enum `NEW`/`CONTACTED`/`CLOSED` (default `NEW`), `createdAt`.
- `server/controllers/leadController.js` + `server/routes/leads.js`, registered in `server/routes/index.js`:
  - **POST `/api/leads`** — public, input validation, rate-limited.
  - **GET `/api/leads`** — protected `authenticate` + `authorize('ADMIN', 'MANAGER')`.
- Add `leads` export to `lib/api.js`.
- Leads are viewed via Prisma Studio or the protected GET endpoint; an admin UI page is out of scope.

## 5. Animations

Framer Motion, subtle and corporate:
- Fade-up reveals on scroll (`whileInView`, fire once).
- Staggered children for feature cards.
- Screenshots slide in with slight scale (0.95 → 1).
- Gentle hover lift on cards and CTA buttons.
- Count-up on stats row.
- No heavy parallax.

## 6. SEO & Polish

- Per-page `metadata` (title/description) via Next.js metadata API.
- Open Graph tags using the dashboard screenshot.
- Fully responsive down to mobile.
- Palette: existing Tailwind `brand` (#0038A8) and `primary` blue scale on white/light-blue backgrounds; Inter font (already configured).

## 7. Verification

1. `npm run dev` → browse `/`, `/features`, `/pricing`, `/contact`.
2. Submit the contact form → verify a `Lead` row lands in MySQL.
3. Login flow redirects to `/dashboard`.
4. Spot-check existing module pages (`/journal`, `/payable`, `/payroll`) still work.
5. Check mobile viewport rendering of all marketing pages.

## Out of Scope (YAGNI)

Leads admin UI page, email notifications, blog, testimonials, multi-language, analytics integration, embedded login form on the landing page.
