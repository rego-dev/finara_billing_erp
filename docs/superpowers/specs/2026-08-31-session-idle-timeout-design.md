# Session Idle Timeout & Draft Recovery — Design

**Date:** 2026-08-31
**Status:** Approved

## Goal

The app has no idle-session enforcement today: the JWT access token lives 8h
(`JWT_EXPIRES_IN`), the refresh token 7d, and the axios interceptor
(`lib/api.js:29-49`) silently refreshes on `401 TOKEN_EXPIRED` — so a tab left
open and unattended never logs out on its own. `Settings → System` already
has a **"Session Timeout (minutes)"** field (`sessionTimeout`,
`server/controllers/settingsController.js:51`, default `480`) labeled
"auto-logout", but nothing reads it; it's dead UI.

This wires that setting up to real idle detection: if the page sits idle
past the configured timeout, the user is logged out. But if they were
mid-transaction (filling out a bill, invoice, journal entry...) when that
happens, their unsaved input must not be lost — logging back in should
return them to the same screen with what they'd typed still there.

## Scope decision

Client-side only. No backend changes, no new settings — `sessionTimeout`
already exists and is already admin-editable; this feature is purely the
missing consumer of it. The JWT lifetimes are unchanged and remain the
actual security boundary; idle-logout is a UX layer on top, matching what
was explicitly requested (an abandoned-but-authenticated tab getting kicked
out, not a change to token security).

Draft recovery is scoped to the six forms where an interrupted user has
real, non-trivial typed content to lose (multi-line-item entry, not a
single date/amount field): **Journal Entry, AP Bill, AP Payment, AR
Invoice, AR Collection, Expense Voucher**. Every other form (vendors,
customers, settings, cheque clear/bounce/cancel, payroll period creation,
filters, etc.) is unaffected — losing a half-typed vendor name is a minor
inconvenience, not lost accounting work.

## Idle detection & warning modal

New `components/layout/SessionTimeoutGuard.jsx`, mounted once in
`app/(dashboard)/layout.jsx` alongside the existing `isAuthenticated()`
check (`layout.jsx:23-26`) — so it runs on every authenticated page,
independent of which module the user is in.

- On mount, calls `settings.getAll()` (already used by
  `app/(dashboard)/settings/page.jsx`) once to read `sessionTimeout`
  (minutes). `GET /api/settings` only requires `authenticate`
  (`server/routes/settings.js:9`), so this works for every role, not just
  ADMIN/MANAGER.
- Activity listeners (`mousemove`, `keydown`, `click`, `scroll`,
  `touchstart`), throttled to write at most once per 5s, set
  `localStorage.setItem('lastActivity', Date.now())`. Using `localStorage`
  instead of component state means every open tab shares one idle clock for
  free — activity in any tab resets the timer for all of them — with no
  extra multi-tab plumbing.
- A 1s `setInterval` computes `idleMs = Date.now() - Number(localStorage.lastActivity)`
  and compares against the configured timeout:
  - At `timeoutMs - 60_000`: show a countdown modal ("You've been
    inactive — logging out in 0:57" with a **Stay Logged In** button).
  - Any activity while the modal is showing (button click, or just moving
    the mouse — the existing listeners already catch it) cancels the
    warning and resets the clock. This is a UX convenience, not a
    high-security control, so treating any activity as "still here" is the
    right tradeoff.
  - At `timeoutMs`: idle-logout fires (below).
- Also subscribes to the `storage` event for the `accessToken` key: if
  another tab clears it (idle-logout *or* the existing refresh-failure path
  in `lib/api.js:43-44`), this tab redirects to `/login` immediately too,
  instead of waiting for its next failed request.

### Idle-logout sequence

1. `localStorage.setItem('postLoginRedirect', pathname)` — so login can
   send them back.
2. `clearSession()` from `lib/auth.js:15-19` — **not** `localStorage.clear()`
   (which the existing refresh-failure path in `lib/api.js:43` uses today).
   `clearSession()` only removes `accessToken`/`refreshToken`/`user`, which
   matters here specifically because it leaves the `draft:*` keys (below)
   untouched. `localStorage.clear()` would silently defeat the draft-recovery
   half of this feature.
3. Best-effort `auth.logout()` call (fire-and-forget — the token is already
   being cleared client-side regardless of whether the server call
   succeeds).
4. `window.location.href = '/login'` with a toast: "You were logged out due
   to inactivity."

## Draft recovery

New hook, `lib/useDraftGuard.js`:

```js
export function useDraftGuard(key, form, setForm, { enabled = true } = {}) {
  const restored = useRef(false);

  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(`draft:${key}`);
      if (raw) { setForm(JSON.parse(raw)); toast('Draft restored from your last session'); }
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(`draft:${key}`, JSON.stringify(form)); } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [form, enabled, key]);

  return { clearDraft: () => { try { localStorage.removeItem(`draft:${key}`); } catch {} } };
}
```

- `key` identifies the form instance, e.g. `journal:new` or
  `journal:edit:${entry.id}` — new-entry and edit-existing drafts never
  collide.
- `clearDraft()` is called after a successful save, and on an explicit
  Cancel/close click (deliberate abandonment) — but **not** when the guard
  above force-navigates away, which is exactly the case the draft needs to
  survive.
- Debounced write (500ms) so typing doesn't hammer `localStorage` on every
  keystroke.

### Wired into the six target forms

| Form | Component | Draft key |
|---|---|---|
| Journal Entry | `JournalModal` (`app/(dashboard)/journal/page.jsx:236`) | `journal:new` / `journal:edit:<id>` |
| AP Bill | `CreateBillModal` (`app/(dashboard)/payable/page.jsx:464`) | `bill:new` / `bill:edit:<id>` |
| AP Payment | `PaymentModal` (`app/(dashboard)/payable/page.jsx:249`) | `payment:new:<billId>` |
| AR Invoice | `CreateInvoiceModal` (`app/(dashboard)/receivable/page.jsx:508`) | `invoice:new` / `invoice:edit:<id>` |
| AR Collection | `CollectionModal` (`app/(dashboard)/receivable/page.jsx:306`) | `collection:new:<invoiceId>` |
| Expense Voucher | `ExpensesPage`'s own form state + `Drawer` (`app/(dashboard)/expenses/page.jsx:127-254`) | `expense:new` / `expense:edit:<id>` |

Each just adds one `useDraftGuard(...)` call alongside its existing `form`
`useState`, and a `clearDraft()` call in its existing save-success and
cancel handlers — no structural changes to any of these components.

## Resuming on the same page

These modules are single-page-with-modals, not `/new` routes, so "back
where they were" is two pieces working together:

1. **Login redirects back**: `app/(auth)/login/page.jsx:86` currently
   always does `router.push('/dashboard')`. It changes to check
   `localStorage.getItem('postLoginRedirect')` first, `router.push` there
   instead if present, then remove the key — a one-time redirect, not a
   persistent override.
2. **Auto-reopen the modal**: each of the six pages above gets a
   mount-time check (after its normal data-fetch effect) for a leftover
   `draft:<prefix>:*` key. If found, it calls the same `setModal(...)` it
   would on a manual "New"/"Edit" click — for an edit-mode draft, matched
   against the just-loaded list by id (if the record no longer exists,
   e.g. deleted in the meantime, the stale draft key is discarded
   silently). The modal mounts, `useDraftGuard` restores the actual field
   values, and the user is exactly where they left off.

If the user never returns / logs in from a different device, the draft
simply sits unused in that browser's `localStorage` — no cleanup job, no
expiry needed; it's overwritten the next time that same key is used for a
genuinely new entry.

## Error handling

- `sessionTimeout` fetch failure (e.g. offline on load): guard falls back
  to the existing default (`480`) rather than disabling idle-logout
  entirely.
- Any `localStorage` access wrapped in `try/catch` throughout (private
  browsing / storage-disabled edge case) — draft recovery and idle-logout
  degrade to "doesn't restore/doesn't fire," never a thrown error that
  breaks the page.
- A malformed/corrupt `draft:*` JSON value is caught and discarded, not
  restored.

## Out of scope

- Server-side idle enforcement — the JWT/refresh lifetimes are unchanged;
  this is a client UX layer, not a security boundary change.
- Draft recovery for any form outside the six listed above.
- A "your session is about to expire" warning tied to the JWT's own 8h
  expiry (separate concern, already silently handled by the refresh-token
  interceptor).
- Cross-device draft sync (drafts live in that browser's `localStorage`
  only, matching how `accessToken`/`refreshToken` already work today).
