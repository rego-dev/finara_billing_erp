# Session Idle Timeout & Draft Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-existing but currently-unused `sessionTimeout` setting up to real idle detection (warn, then auto-logout), and make sure a user interrupted mid-transaction doesn't lose unsaved work when they log back in.

**Architecture:** A global `SessionTimeoutGuard` (mounted once in the dashboard layout) tracks idle time via a shared `localStorage` timestamp, shows a countdown warning modal, then force-logs-out and remembers where the user was. Six core transaction forms each gain a small draft-persistence hook so their in-progress field values survive that forced logout and get restored automatically when the user lands back on the same screen after logging back in.

**Tech Stack:** Next.js 14 (client components), existing `lib/api.js` (`settings`, `auth`), `lib/auth.js` (`clearSession`), `react-hot-toast`. Testing: this repo's `jest` has no React/DOM test setup (no `jest-environment-jsdom`, no `@testing-library/react`) — only plain Node-style unit tests exist today (see `tests/accountMap.test.js`). This plan follows that same pattern: all genuinely pure logic is split into small CommonJS modules with real `jest` unit tests; anything that's inherently a React component/hook (event listeners, timers, DOM) is verified manually against the running dev server instead of invented test infra.

## Global Constraints

- Never start a new `npm run dev` instance — the user runs their own dev server; every manual-verification step below assumes it is already running on `:3000`/`:5000`. If it isn't running, ask before starting one.
- The three new pure `lib/` modules (`draftStorage.js`, `sessionTimeout.js`, `postLoginRedirect.js`) use **CommonJS** (`module.exports = { ... }`), not this codebase's usual ESM `lib/` style — specifically so the existing zero-config `jest` can `require()` them directly in tests. Next.js's bundler consumes named CommonJS exports via `import { x } from '@/lib/y'` without any extra config, so this doesn't change how the rest of the app uses them.
- No backend/Prisma changes. `sessionTimeout` already exists in `SystemSetting` (`server/controllers/settingsController.js:51`) and is already admin-editable via Settings → System — this plan only adds the missing client-side consumer.
- Idle-logout uses `clearSession()` from `lib/auth.js:15-19`, never `localStorage.clear()` — the latter (used by the unrelated refresh-failure path in `lib/api.js:43`) would also wipe the draft data this feature depends on.
- Draft persistence is scoped to exactly six forms: Journal Entry, AP Bill, AP Payment, AR Invoice, AR Collection, Expense Voucher. No other form is touched.

---

## Task 1: `lib/draftStorage.js` — draft save/load/clear/scan

**Files:**
- Create: `lib/draftStorage.js`
- Test: `tests/draftStorage.test.js`

**Interfaces:**
- Produces: `saveDraft(storage, key, data)`, `loadDraft(storage, key) -> object|null`, `clearDraft(storage, key)`, `listDraftKeys(storage, modulePrefix) -> string[]` — all take a `Storage`-shaped object (`getItem`, `setItem`, `removeItem`, `key`, `length`) as their first argument so they're testable without a real browser, and are consumed in later tasks with `window.localStorage`.

- [ ] **Step 1: Write the failing test**

Create `tests/draftStorage.test.js`:

```js
const { saveDraft, loadDraft, clearDraft, listDraftKeys } = require('../lib/draftStorage');

function createFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
}

describe('draftStorage', () => {
  test('saveDraft then loadDraft returns the same data', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'journal:new', { description: 'Office rent' });
    expect(loadDraft(storage, 'journal:new')).toEqual({ description: 'Office rent' });
  });

  test('loadDraft returns null when nothing was saved', () => {
    const storage = createFakeStorage();
    expect(loadDraft(storage, 'journal:new')).toBeNull();
  });

  test('loadDraft returns null for corrupt JSON instead of throwing', () => {
    const storage = createFakeStorage();
    storage.setItem('draft:journal:new', '{not valid json');
    expect(loadDraft(storage, 'journal:new')).toBeNull();
  });

  test('clearDraft removes the saved draft', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'bill:new', { vendorId: '1' });
    clearDraft(storage, 'bill:new');
    expect(loadDraft(storage, 'bill:new')).toBeNull();
  });

  test('listDraftKeys finds only keys under the given module prefix', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'journal:edit:5', { a: 1 });
    saveDraft(storage, 'journal:edit:9', { a: 2 });
    saveDraft(storage, 'bill:new', { a: 3 });
    expect(listDraftKeys(storage, 'journal:edit:').sort()).toEqual(['journal:edit:5', 'journal:edit:9']);
  });

  test('listDraftKeys returns an empty array when nothing matches', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'bill:new', { a: 3 });
    expect(listDraftKeys(storage, 'journal:edit:')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/draftStorage.test.js`
Expected: FAIL — `Cannot find module '../lib/draftStorage'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/draftStorage.js`:

```js
const PREFIX = 'draft:';

function saveDraft(storage, key, data) {
  try { storage.setItem(PREFIX + key, JSON.stringify(data)); } catch {}
}

function loadDraft(storage, key) {
  try {
    const raw = storage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearDraft(storage, key) {
  try { storage.removeItem(PREFIX + key); } catch {}
}

function listDraftKeys(storage, modulePrefix) {
  const full = PREFIX + modulePrefix;
  const out = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.indexOf(full) === 0) out.push(k.slice(PREFIX.length));
    }
  } catch {}
  return out;
}

module.exports = { saveDraft, loadDraft, clearDraft, listDraftKeys };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/draftStorage.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/draftStorage.js tests/draftStorage.test.js
git commit -m "feat(session): add pure draft save/load/clear/scan storage helpers"
```

---

## Task 2: `lib/sessionTimeout.js` — idle-phase calculation

**Files:**
- Create: `lib/sessionTimeout.js`
- Test: `tests/sessionTimeout.test.js`

**Interfaces:**
- Produces: `WARNING_MS` (number, `60000`), `getSessionPhase({ lastActivity, now, timeoutMinutes }) -> 'active'|'warning'|'expired'`, `formatCountdown(ms) -> string` (`"M:SS"`) — consumed by `SessionTimeoutGuard` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/sessionTimeout.test.js`:

```js
const { WARNING_MS, getSessionPhase, formatCountdown } = require('../lib/sessionTimeout');

describe('getSessionPhase', () => {
  const timeoutMinutes = 2; // 120000ms

  test('active when well within the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 30000, timeoutMinutes })).toBe('active');
  });

  test('warning exactly at timeout - WARNING_MS', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 120000 - WARNING_MS, timeoutMinutes })).toBe('warning');
  });

  test('still warning just before the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 119999, timeoutMinutes })).toBe('warning');
  });

  test('expired exactly at the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 120000, timeoutMinutes })).toBe('expired');
  });

  test('expired well past the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 999999, timeoutMinutes })).toBe('expired');
  });
});

describe('formatCountdown', () => {
  test('formats under a minute as 0:SS', () => {
    expect(formatCountdown(45000)).toBe('0:45');
  });
  test('formats a full minute as 1:00', () => {
    expect(formatCountdown(60000)).toBe('1:00');
  });
  test('pads single-digit seconds', () => {
    expect(formatCountdown(5000)).toBe('0:05');
  });
  test('clamps negative values to 0:00', () => {
    expect(formatCountdown(-500)).toBe('0:00');
  });
  test('rounds up partial seconds so it never shows 0:00 while still counting down', () => {
    expect(formatCountdown(200)).toBe('0:01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/sessionTimeout.test.js`
Expected: FAIL — `Cannot find module '../lib/sessionTimeout'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/sessionTimeout.js`:

```js
const WARNING_MS = 60000;

function getSessionPhase({ lastActivity, now, timeoutMinutes }) {
  const timeoutMs = timeoutMinutes * 60000;
  const idleMs = now - lastActivity;
  if (idleMs >= timeoutMs) return 'expired';
  if (idleMs >= timeoutMs - WARNING_MS) return 'warning';
  return 'active';
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { WARNING_MS, getSessionPhase, formatCountdown };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/sessionTimeout.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sessionTimeout.js tests/sessionTimeout.test.js
git commit -m "feat(session): add pure idle-phase and countdown-format helpers"
```

---

## Task 3: `lib/postLoginRedirect.js` — return-to-page + idle-logout flag

**Files:**
- Create: `lib/postLoginRedirect.js`
- Test: `tests/postLoginRedirect.test.js`

**Interfaces:**
- Produces: `setPendingRedirect(storage, pathname)`, `consumePendingRedirect(storage) -> string|null`, `setIdleLogoutFlag(storage)`, `consumeIdleLogoutFlag(storage) -> boolean` — "consume" means read-then-delete (one-shot). Consumed by `SessionTimeoutGuard` (Task 4, sets both) and the login page (Task 5, consumes both).

- [ ] **Step 1: Write the failing test**

Create `tests/postLoginRedirect.test.js`:

```js
const {
  setPendingRedirect, consumePendingRedirect, setIdleLogoutFlag, consumeIdleLogoutFlag,
} = require('../lib/postLoginRedirect');

function createFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('postLoginRedirect', () => {
  test('consumePendingRedirect returns the saved path and clears it', () => {
    const storage = createFakeStorage();
    setPendingRedirect(storage, '/payable');
    expect(consumePendingRedirect(storage)).toBe('/payable');
    expect(consumePendingRedirect(storage)).toBeNull();
  });

  test('consumePendingRedirect returns null when nothing was saved', () => {
    const storage = createFakeStorage();
    expect(consumePendingRedirect(storage)).toBeNull();
  });

  test('consumeIdleLogoutFlag returns true once then false', () => {
    const storage = createFakeStorage();
    setIdleLogoutFlag(storage);
    expect(consumeIdleLogoutFlag(storage)).toBe(true);
    expect(consumeIdleLogoutFlag(storage)).toBe(false);
  });

  test('consumeIdleLogoutFlag returns false when never set', () => {
    const storage = createFakeStorage();
    expect(consumeIdleLogoutFlag(storage)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/postLoginRedirect.test.js`
Expected: FAIL — `Cannot find module '../lib/postLoginRedirect'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/postLoginRedirect.js`:

```js
const REDIRECT_KEY = 'postLoginRedirect';
const IDLE_FLAG_KEY = 'idleLogoutFlag';

function setPendingRedirect(storage, pathname) {
  try { storage.setItem(REDIRECT_KEY, pathname); } catch {}
}

function consumePendingRedirect(storage) {
  try {
    const v = storage.getItem(REDIRECT_KEY);
    if (v) storage.removeItem(REDIRECT_KEY);
    return v || null;
  } catch {
    return null;
  }
}

function setIdleLogoutFlag(storage) {
  try { storage.setItem(IDLE_FLAG_KEY, '1'); } catch {}
}

function consumeIdleLogoutFlag(storage) {
  try {
    const v = storage.getItem(IDLE_FLAG_KEY);
    if (v) storage.removeItem(IDLE_FLAG_KEY);
    return !!v;
  } catch {
    return false;
  }
}

module.exports = { setPendingRedirect, consumePendingRedirect, setIdleLogoutFlag, consumeIdleLogoutFlag };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/postLoginRedirect.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/postLoginRedirect.js tests/postLoginRedirect.test.js
git commit -m "feat(session): add pending-redirect and idle-logout-flag helpers"
```

---

## Task 4: `SessionTimeoutGuard` — idle detection, warning modal, forced logout

**Files:**
- Create: `components/layout/SessionTimeoutGuard.jsx`
- Modify: `app/(dashboard)/layout.jsx:1-101`

**Interfaces:**
- Consumes: `settings.getAll()` (`lib/api.js:395`, returns `{ data: { sessionTimeout: '480', ... } }`), `auth.logout()` (`lib/api.js:54`), `clearSession()` (`lib/auth.js:15-19`), `getSessionPhase`/`formatCountdown`/`WARNING_MS` (Task 2), `setPendingRedirect`/`setIdleLogoutFlag` (Task 3), `usePathname` from `next/navigation`.
- Produces: `export default function SessionTimeoutGuard()` — a self-contained client component with no props, mounted once.

- [ ] **Step 1: Create the component**

Create `components/layout/SessionTimeoutGuard.jsx`:

```jsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { settings as settingsApi, auth as authApi } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { getSessionPhase, formatCountdown, WARNING_MS } from '@/lib/sessionTimeout';
import { setPendingRedirect, setIdleLogoutFlag } from '@/lib/postLoginRedirect';

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
const ACTIVITY_THROTTLE_MS = 5000;
const CHECK_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MINUTES = 480;

export default function SessionTimeoutGuard() {
  const pathname = usePathname();
  const [timeoutMinutes, setTimeoutMinutes] = useState(null);
  const [phase, setPhase] = useState('active');
  const [remainingMs, setRemainingMs] = useState(WARNING_MS);
  const lastWriteRef = useRef(0);
  const loggedOutRef = useRef(false);

  useEffect(() => {
    settingsApi.getAll()
      .then(({ data }) => setTimeoutMinutes(Number(data.sessionTimeout) || DEFAULT_TIMEOUT_MINUTES))
      .catch(() => setTimeoutMinutes(DEFAULT_TIMEOUT_MINUTES));
  }, []);

  const recordActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
    lastWriteRef.current = now;
    try { window.localStorage.setItem('lastActivity', String(now)); } catch {}
  }, []);

  const doLogout = useCallback(() => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    try {
      setPendingRedirect(window.localStorage, pathname);
      setIdleLogoutFlag(window.localStorage);
    } catch {}
    clearSession();
    authApi.logout().catch(() => {});
    window.location.href = '/login';
  }, [pathname]);

  useEffect(() => {
    if (timeoutMinutes == null) return undefined;

    try {
      if (!window.localStorage.getItem('lastActivity')) {
        window.localStorage.setItem('lastActivity', String(Date.now()));
      }
    } catch {}

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, recordActivity, { passive: true }));

    const interval = setInterval(() => {
      let lastActivity;
      try { lastActivity = Number(window.localStorage.getItem('lastActivity')) || Date.now(); }
      catch { lastActivity = Date.now(); }
      const now = Date.now();
      const nextPhase = getSessionPhase({ lastActivity, now, timeoutMinutes });
      setPhase(nextPhase);
      if (nextPhase === 'warning') {
        setRemainingMs(Math.max(0, timeoutMinutes * 60000 - (now - lastActivity)));
      }
      if (nextPhase === 'expired') doLogout();
    }, CHECK_INTERVAL_MS);

    const onStorage = (e) => {
      if (e.key === 'accessToken' && e.newValue === null) {
        window.location.href = '/login';
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, recordActivity));
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, [timeoutMinutes, recordActivity, doLogout]);

  const stayLoggedIn = () => {
    try { window.localStorage.setItem('lastActivity', String(Date.now())); } catch {}
    lastWriteRef.current = Date.now();
    setPhase('active');
  };

  if (phase !== 'warning') return null;

  return (
    <div className="modal-overlay">
      <div className="modal max-w-sm">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Session Expiring</h3>
        </div>
        <div className="modal-body">
          <p className="text-sm text-gray-600">
            You&apos;ve been inactive for a while. For your security, you&apos;ll be logged out in{' '}
            <span className="font-mono font-semibold">{formatCountdown(remainingMs)}</span>.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-primary" onClick={stayLoggedIn}>Stay Logged In</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the dashboard layout**

In `app/(dashboard)/layout.jsx`, add the import at the top (after the existing `BusinessProvider` import on line 11):

```js
import { BusinessProvider } from '@/lib/businessContext';
import SessionTimeoutGuard from '@/components/layout/SessionTimeoutGuard';
```

Then change the return statement (currently `if (!authed) return null;` at line 70, followed by a single `<BusinessProvider>` root at lines 72-100) to render the guard alongside it:

```jsx
  if (!authed) return null;

  return (
    <>
      <SessionTimeoutGuard />
      <BusinessProvider>
        <div className="flex h-screen bg-gray-50 dark:bg-gray-950" data-readonly={readonly}>
          <Sidebar
            collapsed={collapsed}
            onToggle={toggleSidebar}
            mobileOpen={mobileOpen}
            onMobileClose={() => setMobileOpen(false)}
          />

          {/* Mobile overlay backdrop */}
          {mobileOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}

          <div className={`flex-1 flex flex-col min-h-screen overflow-hidden transition-all duration-200 ${collapsed ? 'lg:ml-16' : 'lg:ml-64'}`}>
            <Header onMobileMenu={() => setMobileOpen(true)} />
            <main className="flex-1 overflow-y-auto p-4 lg:p-6">
              <PageTransition>
                {children}
              </PageTransition>
            </main>
          </div>
        </div>
      </BusinessProvider>
    </>
  );
}
```

(Only the wrapping `<>...</>` and the new `<SessionTimeoutGuard />` line are new — everything inside `<BusinessProvider>` is unchanged.)

- [ ] **Step 3: Manually verify the warning modal and forced logout**

With the dev server already running:
1. Log in, go to Settings → System, set "Session Timeout (minutes)" to `2`, Save Settings.
2. Navigate to any dashboard page (e.g. `/journal`) and stop interacting — don't move the mouse or touch the keyboard.
3. After ~1 minute, confirm the "Session Expiring" modal appears with a live counting-down timer.
4. Move the mouse. Confirm the modal disappears (activity cancelled the warning).
5. Go idle again for the full 2 minutes without touching anything this time. Confirm you're redirected to `/login` and a toast reads "You were logged out due to inactivity." (this part of the toast is wired in Task 5 — if it's not showing yet, just confirm the redirect itself happens).
6. Log back in and confirm you land back on `/journal` (also wired in Task 5 — if not yet, you'll land on `/dashboard`, which is fine at this checkpoint).
7. Open the app in two browser tabs side by side. In tab A, click "Stay Logged In" or otherwise interact. Confirm tab B's idle countdown (if a warning was showing there too) also resets — both tabs share one `lastActivity` timestamp.
8. Set "Session Timeout (minutes)" back to a normal value (e.g. `480`) in Settings when done testing.

- [ ] **Step 4: Commit**

```bash
git add components/layout/SessionTimeoutGuard.jsx "app/(dashboard)/layout.jsx"
git commit -m "feat(session): add idle-detection guard with warning modal and forced logout"
```

---

## Task 5: Login page — return to the same page, explain why you were logged out

**Files:**
- Modify: `app/(auth)/login/page.jsx:1-92`

**Interfaces:**
- Consumes: `consumePendingRedirect(window.localStorage)`, `consumeIdleLogoutFlag(window.localStorage)` (Task 3).

- [ ] **Step 1: Add the import**

In `app/(auth)/login/page.jsx`, add after the existing `import { setSession } from '@/lib/auth';` (line 6):

```js
import { setSession } from '@/lib/auth';
import { consumePendingRedirect, consumeIdleLogoutFlag } from '@/lib/postLoginRedirect';
```

- [ ] **Step 2: Show the idle-logout toast on mount**

Add a new effect right after the existing mount-animation effect (`app/(auth)/login/page.jsx:73-77`):

```js
  useEffect(() => {
    // Trigger enter animation after mount
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (consumeIdleLogoutFlag(window.localStorage)) {
      toast.error('You were logged out due to inactivity.');
    }
  }, []);
```

- [ ] **Step 3: Redirect back to the page the user was on**

Change `handleSubmit` (`app/(auth)/login/page.jsx:79-92`):

```js
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authApi.login(form);
      setSession(data);
      toast.success(`Welcome back, ${data.user.firstName}!`);
      const redirectTo = consumePendingRedirect(window.localStorage) || '/dashboard';
      router.push(redirectTo);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };
```

- [ ] **Step 4: Manually verify**

With the dev server already running:
1. Repeat Task 4's Step 3 scenario end to end (Settings → System Timeout = 2 min, go idle on `/journal`, get logged out).
2. Confirm the login page shows a red toast: "You were logged out due to inactivity."
3. Log back in and confirm you land on `/journal` (not `/dashboard`).
4. Log in normally (not via an idle-logout) and confirm no stray toast appears and you land on `/dashboard` as before.
5. Reset Session Timeout back to `480` in Settings.

- [ ] **Step 5: Commit**

```bash
git add "app/(auth)/login/page.jsx"
git commit -m "feat(session): redirect back to the interrupted page after idle re-login"
```

---

## Task 6: Draft-restore hook + Journal Entry wiring

**Files:**
- Create: `lib/useDraftGuard.js`
- Modify: `app/(dashboard)/journal/page.jsx` (imports at lines 1-9; `JournalModal` at lines 236-357; `JournalPage` at lines 359-375, 496)

**Interfaces:**
- Consumes: `saveDraft`, `loadDraft`, `clearDraft` (Task 1).
- Produces: `useDraftGuard(key, form, setForm, { enabled }?) -> { clearDraft }` — a React hook: restores a saved draft into `form` once on mount (via `setForm`), then debounce-saves `form` on every change under the same key. Reused by Tasks 7 and 8.

- [ ] **Step 1: Create the hook**

Create `lib/useDraftGuard.js`:

```js
'use client';
import { useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { saveDraft, loadDraft, clearDraft as removeDraft } from './draftStorage';

export function useDraftGuard(key, form, setForm, { enabled = true } = {}) {
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!enabled || restoredRef.current || typeof window === 'undefined') return;
    restoredRef.current = true;
    const draft = loadDraft(window.localStorage, key);
    if (draft) {
      setForm(draft);
      toast('Draft restored from your last session', { icon: '📝' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const t = setTimeout(() => saveDraft(window.localStorage, key, form), 500);
    return () => clearTimeout(t);
  }, [form, enabled, key]);

  const clearDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    removeDraft(window.localStorage, key);
  }, [key]);

  return { clearDraft };
}
```

- [ ] **Step 2: Wire it into `JournalModal`**

In `app/(dashboard)/journal/page.jsx`, update the top imports (lines 1-9):

```js
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { journal as jApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Eye, CheckCircle, XCircle, Filter, AlertTriangle, ShieldAlert, Lock, Printer, Search } from 'lucide-react';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput, { groupThousands } from '@/components/NumberInput';
import { formatCurrency, formatDate } from '@/lib/auth';
import { useDraftGuard } from '@/lib/useDraftGuard';
import { loadDraft, listDraftKeys, clearDraft } from '@/lib/draftStorage';
```

In `JournalModal` (line 236-248), add the hook right after `const [saving, setSaving] = useState(false);`:

```js
  const [saving, setSaving] = useState(false);
  const draftKey = entry?.id ? `journal:edit:${entry.id}` : 'journal:new';
  const { clearDraft: clearJournalDraft } = useDraftGuard(draftKey, form, setForm);
```

In `handleSubmit` (lines 261-273), clear the draft right after the success toast, before `onSaved()`:

```js
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!balanced) { toast.error('Entry is not balanced'); return; }
    setSaving(true);
    try {
      const payload = { ...form, lines: form.lines.filter(l => l.accountId).map(l => ({ ...l, accountId: Number(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })) };
      if (entry?.id) await jApi.update(entry.id, payload);
      else await jApi.create(payload);
      toast.success('Journal entry saved');
      clearJournalDraft();
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };
```

Add a close handler that also clears the draft, and use it for both the X button and the Cancel button:

```js
  const handleClose = () => { clearJournalDraft(); onClose(); };
```

Change line 280 from `<button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>` to:

```jsx
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
```

Change line 345 from `<button type="button" onClick={onClose} className="btn-secondary">Cancel</button>` to:

```jsx
            <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
```

- [ ] **Step 3: Auto-reopen a leftover draft in `JournalPage`**

In `JournalPage` (line 359-375), add a `useRef` and a mount-time effect right after the existing `load`/`accounts` effects:

```js
export default function JournalPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ status: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [voidEntry, setVoidEntry] = useState(null);
  const autoOpenedRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    jApi.list({ ...filter, page, limit: 20 }).then(r => { setEntries(r.data.data); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [filter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then(r => setAccounts(r.data)); }, []);

  useEffect(() => {
    if (autoOpenedRef.current || loading || typeof window === 'undefined') return;
    autoOpenedRef.current = true;

    if (loadDraft(window.localStorage, 'journal:new')) { setModal('new'); return; }

    const editKeys = listDraftKeys(window.localStorage, 'journal:edit:');
    if (!editKeys.length) return;
    const id = Number(editKeys[0].split(':').pop());
    if (!Number.isFinite(id)) { clearDraft(window.localStorage, editKeys[0]); return; }
    jApi.get(id)
      .then(({ data }) => setModal(data))
      .catch(() => clearDraft(window.localStorage, editKeys[0]));
  }, [loading]);
```

- [ ] **Step 4: Manually verify**

With the dev server already running:
1. Go to `/journal`, click "New Entry", type a description and fill in one line's account/amount. Open browser devtools → Application/Storage → Local Storage, confirm a `draft:journal:new` key appears within ~1 second holding what you typed.
2. Click Cancel. Confirm the `draft:journal:new` key is gone.
3. Repeat step 1 (type a partial entry), but this time don't cancel — instead, in Settings set Session Timeout to 2 minutes, go idle until you're logged out (per Task 4/5's flow).
4. Log back in. Confirm you land on `/journal` and the "New Journal Entry" modal reopens automatically with your description and line data still filled in, plus a "Draft restored from your last session" toast.
5. Save the entry normally. Confirm the `draft:journal:new` key is removed from Local Storage after a successful save.
6. Reset Session Timeout back to `480`.

- [ ] **Step 5: Commit**

```bash
git add lib/useDraftGuard.js "app/(dashboard)/journal/page.jsx"
git commit -m "feat(session): restore in-progress Journal Entry drafts after idle logout"
```

---

## Task 7: AP Bill + AP Payment wiring

**Files:**
- Modify: `app/(dashboard)/payable/page.jsx` (imports at lines 1-14; `PaymentModal` at lines 249-354; `CreateBillModal` at lines 464-727ish; `BillsPage` at lines 730-777, 1086-1130)

**Interfaces:**
- Consumes: `useDraftGuard` (Task 6), `loadDraft`/`listDraftKeys`/`clearDraft` (Task 1).

- [ ] **Step 1: Update imports**

In `app/(dashboard)/payable/page.jsx`, change lines 1-14 to add `useRef` and the two new imports:

```js
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { payable as pApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Eye, CreditCard, Ban, ChevronDown, ChevronUp,
  Filter, X, Check, AlertCircle, Clock, CheckCircle2, FileText,
  Printer, Download, Pencil
} from 'lucide-react';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import { formatCurrency, formatDate } from '@/lib/auth';
import VendorSelect from '@/components/VendorSelect';
import DescriptionInput, { rememberDescription } from '@/components/DescriptionInput';
import NumberInput from '@/components/NumberInput';
import { useDraftGuard } from '@/lib/useDraftGuard';
import { loadDraft, listDraftKeys, clearDraft } from '@/lib/draftStorage';
```

- [ ] **Step 2: Wire `PaymentModal`**

In `PaymentModal` (line 249-260), add the hook after `const [saving, setSaving] = useState(false);`:

```js
  const [saving, setSaving] = useState(false);
  const draftKey = `payment:new:${bill.id}`;
  const { clearDraft: clearPaymentDraft } = useDraftGuard(draftKey, form, setForm);
```

In its `handleSubmit` (lines 262-286), clear the draft on success, before `onPaid()`:

```js
      await pApi.bills.payment(bill.id, { ...form, amount: Number(form.amount) });
      toast.success('Payment recorded successfully');
      clearPaymentDraft();
      onPaid();
```

Add a close handler and use it for both close buttons:

```js
  const handleClose = () => { clearPaymentDraft(); onClose(); };
```

Change line 293 (`<button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>`) and line 344 (`<button type="button" onClick={onClose} className="btn-secondary">Cancel</button>`) to use `handleClose` instead of `onClose`.

- [ ] **Step 3: Wire `CreateBillModal`**

In `CreateBillModal` (line 464-485), add the hook after `const [saving, setSaving] = useState(false);`:

```js
  const [saving, setSaving] = useState(false);
  const draftKey = bill?.id ? `bill:edit:${bill.id}` : 'bill:new';
  const { clearDraft: clearBillDraft } = useDraftGuard(draftKey, form, setForm);
```

In its `handleSubmit` (lines 526-558), clear the draft after either success branch, before `onSaved()`:

```js
      if (bill) {
        await pApi.bills.update(bill.id, payload);
        toast.success('Bill updated successfully');
      } else {
        await pApi.bills.create(payload);
        toast.success('Bill created successfully');
      }
      clearBillDraft();
      onSaved();
```

Add a close handler and use it for both close buttons:

```js
  const handleClose = () => { clearBillDraft(); onClose(); };
```

Change line 565 (`<button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>`) and line 716 (`<button type="button" onClick={onClose} className="btn-secondary">Cancel</button>`) to use `handleClose` instead of `onClose`.

- [ ] **Step 4: Auto-reopen a leftover draft in `BillsPage`**

Add `const autoOpenedRef = useRef(false);` to the state block (line 730-742, alongside the existing `modal` state), then add this effect after the existing `load`/vendors/accounts effects (after line 777):

```js
  useEffect(() => {
    if (autoOpenedRef.current || loading || typeof window === 'undefined') return;
    autoOpenedRef.current = true;

    if (loadDraft(window.localStorage, 'bill:new')) { setModal({ type: 'create' }); return; }

    const billEditKeys = listDraftKeys(window.localStorage, 'bill:edit:');
    if (billEditKeys.length) {
      const id = Number(billEditKeys[0].split(':').pop());
      if (Number.isFinite(id)) {
        pApi.bills.get(id)
          .then(({ data }) => setModal({ type: 'edit', bill: data }))
          .catch(() => clearDraft(window.localStorage, billEditKeys[0]));
        return;
      }
      clearDraft(window.localStorage, billEditKeys[0]);
    }

    const paymentKeys = listDraftKeys(window.localStorage, 'payment:new:');
    if (paymentKeys.length) {
      const billId = Number(paymentKeys[0].split(':').pop());
      if (Number.isFinite(billId)) {
        pApi.bills.get(billId)
          .then(({ data }) => setModal({ type: 'payment', bill: data }))
          .catch(() => clearDraft(window.localStorage, paymentKeys[0]));
        return;
      }
      clearDraft(window.localStorage, paymentKeys[0]);
    }
  }, [loading]);
```

- [ ] **Step 5: Manually verify**

With the dev server already running:
1. On `/payable`, click "New Bill / Purchase Invoice", pick a vendor, add a line item. Confirm a `draft:bill:new` key appears in Local Storage.
2. Idle-logout (Session Timeout = 2 min), log back in. Confirm you land on `/payable` with the New Bill modal reopened and your vendor/line item still filled in.
3. Cancel it. Confirm the draft key is cleared.
4. Open an existing bill, click Record Payment, enter a partial amount. Confirm a `draft:payment:new:<billId>` key appears.
5. Idle-logout, log back in. Confirm the Record Payment modal reopens for the same bill with your amount still filled in.
6. Complete the payment normally and confirm the draft key clears on success.
7. Reset Session Timeout back to `480`.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/payable/page.jsx"
git commit -m "feat(session): restore in-progress AP Bill and Payment drafts after idle logout"
```

---

## Task 8: AR Invoice + AR Collection wiring

**Files:**
- Modify: `app/(dashboard)/receivable/page.jsx` (imports at lines 1-17; `CollectionModal` at lines 306-439; `CreateInvoiceModal` at lines 508-774ish; page component at lines 784-793, 1159-1194)

**Interfaces:**
- Consumes: `useDraftGuard` (Task 6), `loadDraft`/`listDraftKeys`/`clearDraft` (Task 1).

- [ ] **Step 1: Update imports**

Change lines 1-17 to add `useRef` and the two new imports:

```js
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { receivable as rApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Eye, Ban, Filter, X,
  AlertCircle, Clock, CheckCircle2, FileText,
  Printer, ChevronDown, ChevronUp, Pencil, Truck,
} from 'lucide-react';
import PesoReceipt from '@/components/icons/PesoReceipt';
import PesoSign from '@/components/icons/PesoSign';
import CustomerSelect from '@/components/CustomerSelect';
import DescriptionInput, { rememberDescription } from '@/components/DescriptionInput';
import NumberInput from '@/components/NumberInput';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import { formatCurrency, formatDate } from '@/lib/auth';
import { useBusiness, isPreCutover } from '@/lib/businessContext';
import { useDraftGuard } from '@/lib/useDraftGuard';
import { loadDraft, listDraftKeys, clearDraft } from '@/lib/draftStorage';
```

- [ ] **Step 2: Wire `CollectionModal`**

In `CollectionModal` (line 306-316), add the hook after `const [saving, setSaving] = useState(false);`:

```js
  const [saving, setSaving] = useState(false);
  const draftKey = `collection:new:${invoice.id}`;
  const { clearDraft: clearCollectionDraft } = useDraftGuard(draftKey, form, setForm);
```

In its `handleSubmit` (lines 318-338), clear the draft on success, before `onCollected()`:

```js
      await rApi.invoices.payment(invoice.id, { ...form, amount: Number(form.amount) });
      toast.success('Collection recorded successfully');
      clearCollectionDraft();
      onCollected();
```

Add a close handler and use it for both close buttons:

```js
  const handleClose = () => { clearCollectionDraft(); onClose(); };
```

Change line 345 (X button) and line 429 (Cancel button) to use `handleClose` instead of `onClose`.

- [ ] **Step 3: Wire `CreateInvoiceModal`**

In `CreateInvoiceModal` (line 508-529), add the hook after `const [saving, setSaving] = useState(false);`:

```js
  const [saving, setSaving] = useState(false);
  const draftKey = invoice?.id ? `invoice:edit:${invoice.id}` : 'invoice:new';
  const { clearDraft: clearInvoiceDraft } = useDraftGuard(draftKey, form, setForm);
```

In its `handleSubmit` (lines 569-601), clear the draft after either success branch, before `onSaved()`:

```js
      if (invoice) {
        await rApi.invoices.update(invoice.id, payload);
        toast.success('Invoice updated successfully');
      } else {
        await rApi.invoices.create(payload);
        toast.success('Invoice created successfully');
      }
      clearInvoiceDraft();
      onSaved();
```

Add a close handler and use it for both close buttons:

```js
  const handleClose = () => { clearInvoiceDraft(); onClose(); };
```

Change line 608 (X button) and line 768 (Cancel button) to use `handleClose` instead of `onClose`.

- [ ] **Step 4: Auto-reopen a leftover draft**

Add `const autoOpenedRef = useRef(false);` to the state block (near line 793, alongside `modal`), then add this effect after the existing `load` effect:

```js
  useEffect(() => {
    if (autoOpenedRef.current || loading || typeof window === 'undefined') return;
    autoOpenedRef.current = true;

    if (loadDraft(window.localStorage, 'invoice:new')) { setModal({ type: 'create' }); return; }

    const invoiceEditKeys = listDraftKeys(window.localStorage, 'invoice:edit:');
    if (invoiceEditKeys.length) {
      const id = Number(invoiceEditKeys[0].split(':').pop());
      if (Number.isFinite(id)) {
        rApi.invoices.get(id)
          .then(({ data }) => setModal({ type: 'edit', invoice: data }))
          .catch(() => clearDraft(window.localStorage, invoiceEditKeys[0]));
        return;
      }
      clearDraft(window.localStorage, invoiceEditKeys[0]);
    }

    const collectionKeys = listDraftKeys(window.localStorage, 'collection:new:');
    if (collectionKeys.length) {
      const invoiceId = Number(collectionKeys[0].split(':').pop());
      if (Number.isFinite(invoiceId)) {
        rApi.invoices.get(invoiceId)
          .then(({ data }) => setModal({ type: 'collect', invoice: data }))
          .catch(() => clearDraft(window.localStorage, collectionKeys[0]));
        return;
      }
      clearDraft(window.localStorage, collectionKeys[0]);
    }
  }, [loading]);
```

- [ ] **Step 5: Manually verify**

Same pattern as Task 7's Step 5, but on `/receivable`: New Sales Invoice draft, idle-logout, confirm reopen + restore; Record Collection draft on an existing invoice, idle-logout, confirm reopen + restore; confirm both clear their draft key on a successful save or Cancel. Reset Session Timeout back to `480` afterward.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/receivable/page.jsx"
git commit -m "feat(session): restore in-progress AR Invoice and Collection drafts after idle logout"
```

---

## Task 9: Expense Voucher wiring

**Files:**
- Modify: `app/(dashboard)/expenses/page.jsx` (imports at lines 1-14; `ExpensesPage` state at lines 127-172; `resetForm`/`openNew`/`openEdit` at lines 214-240; `handleSave` at lines 254-274; Drawer usage around line 535-546)

**Interfaces:**
- Consumes: `saveDraft`/`loadDraft`/`clearDraft`/`listDraftKeys` (Task 1) directly — **not** `useDraftGuard`, because this page keeps the voucher form as nine separate `useState` fields (`fType`, `fDate`, ...) rather than one form object, and the drawer is opened/closed on an already-mounted page rather than via modal mount/unmount, so the hook's "restore once on mount" assumption doesn't fit here. The same underlying storage functions are reused directly instead.

- [ ] **Step 1: Update imports**

Change lines 1-14 to add `useRef` and the new import:

```js
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { expenses as expApi, accounts as accountsApi, audit as auditApi } from '@/lib/api';
import { formatCurrency, formatDate, getUser } from '@/lib/auth';
import { printDocument } from '@/lib/print';
import Attachments from '@/components/Attachments';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';
import toast from 'react-hot-toast';
import {
  Plus, X, Printer, RefreshCw, Trash2, Send, CheckCircle2,
  Banknote, AlertCircle, Edit2, Search, Wallet, ChevronDown,
  FileText, History,
} from 'lucide-react';
import { saveDraft, loadDraft, clearDraft, listDraftKeys } from '@/lib/draftStorage';
```

- [ ] **Step 2: Track the current draft key and add the debounced auto-save effect**

After the form-state declarations (line 170, `const [fItems, ...] = useState(...)`) and the `fTotal` line, add:

```js
  const fTotal = fItems.reduce((s, it) => s + Number(it.amount || 0), 0);

  const draftKey = editing?.id ? `expense:edit:${editing.id}` : 'expense:new';
  const autoOpenedRef = useRef(false);

  const applyDraft = useCallback((d) => {
    if (!d) return;
    setFType(d.fType); setFDate(d.fDate); setFPayee(d.fPayee); setFCategory(d.fCategory);
    setFPurpose(d.fPurpose); setFReceiptNo(d.fReceiptNo); setFRequestedBy(d.fRequestedBy);
    setFNotes(d.fNotes); setFItems(d.fItems);
  }, []);

  useEffect(() => {
    if (!drawerOpen || typeof window === 'undefined') return undefined;
    const t = setTimeout(() => {
      saveDraft(window.localStorage, draftKey, {
        fType, fDate, fPayee, fCategory, fPurpose, fReceiptNo, fRequestedBy, fNotes, fItems,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [drawerOpen, draftKey, fType, fDate, fPayee, fCategory, fPurpose, fReceiptNo, fRequestedBy, fNotes, fItems]);
```

- [ ] **Step 3: Restore a draft when the drawer opens, clear it on save/cancel**

Change `openNew` and `openEdit` (lines 220-240):

```js
  function openNew() {
    setEditing(null);
    resetForm();
    setDrawerOpen(true);
    const d = loadDraft(window.localStorage, 'expense:new');
    if (d) { applyDraft(d); toast('Draft restored from your last session', { icon: '📝' }); }
  }

  function openEdit(v) {
    setEditing(v);
    setFType(v.type);
    setFDate(new Date(v.date).toISOString().slice(0, 10));
    setFPayee(v.payee);
    setFCategory(v.category);
    setFPurpose(v.purpose);
    setFReceiptNo(v.receiptNo || '');
    setFRequestedBy(v.requestedBy || '');
    setFNotes(v.notes || '');
    setFItems(v.items?.length
      ? v.items.map(it => ({ description: it.description, accountId: it.accountId || null, amount: String(it.amount), receiptNo: it.receiptNo || '' }))
      : [{ description: '', accountId: null, amount: '', receiptNo: '' }]);
    setDrawerOpen(true);
    const d = loadDraft(window.localStorage, `expense:edit:${v.id}`);
    if (d) { applyDraft(d); toast('Draft restored from your last session', { icon: '📝' }); }
  }
```

Change `handleSave` (lines 254-274) to clear the draft on success, before closing the drawer:

```js
  async function handleSave() {
    if (!fPayee || !fCategory || !fPurpose) { toast.error('Payee, category, and purpose are required'); return; }
    if (fItems.some(it => !it.description || !it.amount)) { toast.error('Each line item needs a description and amount'); return; }

    const payload = {
      type: fType, date: fDate, payee: fPayee, category: fCategory, purpose: fPurpose,
      receiptNo: fReceiptNo, requestedBy: fRequestedBy, notes: fNotes,
      items: fItems.map(it => ({ ...it, amount: Number(it.amount) })),
    };
    try {
      if (editing) {
        await expApi.update(editing.id, payload);
        toast.success('Updated');
      } else {
        await expApi.create(payload);
        toast.success('Expense voucher created');
      }
      clearDraft(window.localStorage, draftKey);
      setDrawerOpen(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Save failed'); }
  }
```

Change the Drawer's close handlers (around line 535-546) to also clear the draft:

```jsx
      <Drawer wide open={drawerOpen} onClose={() => { clearDraft(window.localStorage, draftKey); setDrawerOpen(false); }}
        title={editing ? `Edit — ${editing.voucherNo}` : 'New Expense Voucher'}
        subtitle={editing ? `${TYPE_OPTS.find(t=>t.value===editing.type)?.label || editing.type} · ${editing.status}` : 'Fill in the details below'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => { clearDraft(window.localStorage, draftKey); setDrawerOpen(false); }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>
              {editing ? 'Save Changes' : 'Create Voucher'}
            </button>
          </>
        }
      >
```

- [ ] **Step 4: Auto-reopen a leftover draft on page load**

Add this effect after the existing data-loading effects (after line 211):

```js
  useEffect(() => {
    if (autoOpenedRef.current || loading || typeof window === 'undefined') return;
    autoOpenedRef.current = true;

    if (loadDraft(window.localStorage, 'expense:new')) { openNew(); return; }

    const editKeys = listDraftKeys(window.localStorage, 'expense:edit:');
    if (!editKeys.length) return;
    const id = Number(editKeys[0].split(':').pop());
    if (!Number.isFinite(id)) { clearDraft(window.localStorage, editKeys[0]); return; }
    expApi.get(id)
      .then(({ data }) => openEdit(data))
      .catch(() => clearDraft(window.localStorage, editKeys[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
```

- [ ] **Step 5: Manually verify**

With the dev server already running:
1. On `/expenses`, click "New Voucher", fill in payee/category/purpose and a line item. Confirm a `draft:expense:new` key appears in Local Storage.
2. Idle-logout (Session Timeout = 2 min), log back in. Confirm you land on `/expenses` with the New Voucher drawer reopened and your fields still filled in, plus the "Draft restored" toast.
3. Save it. Confirm the draft key clears.
4. Repeat for editing an existing voucher (`expense:edit:<id>`) and confirm Cancel also clears its key.
5. Reset Session Timeout back to `480`.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/expenses/page.jsx"
git commit -m "feat(session): restore in-progress Expense Voucher drafts after idle logout"
```

---

## Task 10: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: all existing suites still pass, plus the three new ones from Tasks 1-3 (`draftStorage`, `sessionTimeout`, `postLoginRedirect`).

- [ ] **Step 2: Manual cross-feature smoke test**

With the dev server already running, and Session Timeout set to `2` minutes in Settings:
1. Start filling in a new AP Bill on `/payable`, go idle past the warning and past the timeout.
2. Confirm: warning modal appeared with live countdown → forced logout → login page showed the idle-logout toast → after logging back in, you're back on `/payable` with the New Bill modal reopened and your data intact.
3. Confirm normal (non-idle) login/logout still behaves exactly as before — no toast, always lands on `/dashboard`.
4. Confirm a completely unrelated page (e.g. `/accounts`, which has no draft wiring) still idles-out and force-logs-out correctly, it just doesn't restore anything on return (expected — out of scope).

- [ ] **Step 3: Reset Settings**

In Settings → System, set Session Timeout back to its normal production value (e.g. `480`) so the app isn't left in a 2-minute-logout state.

- [ ] **Step 4: Final commit (if Step 3's Settings change needs no code, skip; otherwise commit any leftover fixups)**

```bash
git status
```

If everything from Tasks 1-9 is already committed and only the in-app Settings value changed (not a file), there's nothing further to commit here — this task is verification-only.
