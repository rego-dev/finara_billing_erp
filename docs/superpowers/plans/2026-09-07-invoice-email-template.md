# Customizable Invoice Email Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each business customize the subject, greeting, and three optional blocks (Payment Instructions, Terms & Conditions, Signature) of the "Email Invoice" HTML email, editable from Settings, with `{{token}}` placeholder substitution — no schema changes, no changes to the overdue-reminder or payslip email templates.

**Architecture:** Reuse the existing `SystemSetting` key-value store (already backs the whole Settings page) for 5 new template keys. `server/utils/mailer.js` gains a `fillTemplate` substitution helper and `sendInvoiceEmail` takes a new `settings` param to render the customizable pieces around the existing fixed HTML layout. `server/controllers/notificationController.js` fetches those settings per-business and passes them through. `app/(dashboard)/settings/page.jsx` gets a new "Email Template" tab using the page's existing generic save mechanism.

**Tech Stack:** Express + Prisma (MySQL) backend, Next.js 14 App Router frontend, Jest for backend unit tests (no frontend test harness exists in this repo — frontend changes are verified manually).

## Global Constraints

- No Prisma schema/migration changes — this feature stores everything as `SystemSetting` key/value rows, exactly like every other setting in this app.
- The existing fixed HTML layout in `sendInvoiceEmail` (letterhead via `wrap()`, line-items table, subtotal/VAT/total block, invoice/due date line) must not change — only new optional blocks are appended and the subject/greeting become template-driven.
- `sendOverdueReminder` and `sendPayslipEmail` in `server/utils/mailer.js` are out of scope — do not modify them.
- Every new optional block (Payment Instructions, Terms & Conditions, Signature, and the invoice's own Notes) must be completely omitted from the HTML (no empty box, no label) when its resolved value is blank.
- Spec: `docs/superpowers/specs/2026-09-07-invoice-email-template-design.md`

---

### Task 1: Export DEFAULTS and add the 5 invoice-email-template keys — `server/controllers/settingsController.js`

**Files:**
- Modify: `server/controllers/settingsController.js:53-54` (end of `DEFAULTS`), `server/controllers/settingsController.js:295` (`module.exports`)
- Test: `tests/settingsEmailTemplateDefaults.test.js` (create)

**Interfaces:**
- Produces: `settingsController.DEFAULTS` (plain object, now includes `invoiceEmailSubject`, `invoiceEmailGreeting`, `invoiceEmailPaymentInstructions`, `invoiceEmailTerms`, `invoiceEmailSignature` — all strings) — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/settingsEmailTemplateDefaults.test.js`:

```js
jest.mock('../server/config/database', () => ({
  systemSetting: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/settingsController');

const run = (req) => new Promise((resolve, reject) => {
  ctrl.getAll({ businessId: 1, ...req }, { json: resolve }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('settingsController — invoice email template defaults', () => {
  test('DEFAULTS exports the 5 invoice email template keys', () => {
    expect(ctrl.DEFAULTS).toMatchObject({
      invoiceEmailSubject: 'Invoice {{invoiceNo}} from {{companyName}}',
      invoiceEmailGreeting: expect.stringContaining('{{customerName}}'),
      invoiceEmailPaymentInstructions: '',
      invoiceEmailTerms: '',
      invoiceEmailSignature: '',
    });
  });

  test('getAll merges the invoice email defaults when nothing is saved yet', async () => {
    prisma.systemSetting.findMany.mockResolvedValue([]);
    const result = await run({});
    expect(result.invoiceEmailSubject).toBe('Invoice {{invoiceNo}} from {{companyName}}');
    expect(result.invoiceEmailPaymentInstructions).toBe('');
  });

  test('getAll lets a saved value override the invoice email default', async () => {
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'invoiceEmailSubject', value: 'Custom subject {{invoiceNo}}' },
    ]);
    const result = await run({});
    expect(result.invoiceEmailSubject).toBe('Custom subject {{invoiceNo}}');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/settingsEmailTemplateDefaults.test.js`
Expected: FAIL — `ctrl.DEFAULTS` is `undefined` (not yet exported), so the first `toMatchObject` assertion throws.

- [ ] **Step 3: Add the 5 keys to `DEFAULTS` and export it**

In `server/controllers/settingsController.js`, replace:

```js
  // System
  systemTimezone:     'Asia/Manila',
  decimalPlaces:      '2',
  showCentsInReports: 'true',
  sessionTimeout:     '480',   // minutes
  enforceStrongPwd:   'true',
  auditTrail:         'true',
};
```

with:

```js
  // System
  systemTimezone:     'Asia/Manila',
  decimalPlaces:      '2',
  showCentsInReports: 'true',
  sessionTimeout:     '480',   // minutes
  enforceStrongPwd:   'true',
  auditTrail:         'true',
  // Invoice email template
  invoiceEmailSubject:             'Invoice {{invoiceNo}} from {{companyName}}',
  invoiceEmailGreeting:            'Dear {{customerName}},\n\nPlease find your invoice details below. Amount due: {{amountDue}}.',
  invoiceEmailPaymentInstructions: '',
  invoiceEmailTerms:               '',
  invoiceEmailSignature:           '',
};
```

Then replace the `module.exports` line:

```js
module.exports = { getAll, saveAll, resetDefaults, backupDatabase, resetDatabase, getDbStats, listUsers, updateUser, deleteUser, resetUserPassword };
```

with:

```js
module.exports = { getAll, saveAll, resetDefaults, backupDatabase, resetDatabase, getDbStats, listUsers, updateUser, deleteUser, resetUserPassword, DEFAULTS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/settingsEmailTemplateDefaults.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/controllers/settingsController.js tests/settingsEmailTemplateDefaults.test.js
git commit -m "feat(settings): add and export invoice email template defaults

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Template substitution + optional blocks — `server/utils/mailer.js`

**Files:**
- Modify: `server/utils/mailer.js:80-102` (add helpers, rewrite `sendInvoiceEmail`), `server/utils/mailer.js:129-132` (`module.exports`)
- Test: `tests/mailerInvoiceEmail.test.js` (create)

**Interfaces:**
- Consumes: nothing from Task 1 directly (settings object shape is defined here; Task 1 only supplies matching keys).
- Produces: `mailer.fillTemplate(str, data) → string`, `mailer.sendInvoiceEmail(invoice, customer, settings = {}) → Promise<boolean>` (3rd param is new) — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/mailerInvoiceEmail.test.js`:

```js
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'user@test.local';
process.env.SMTP_PASS = 'secret';

const sendMailMock = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

const mailer = require('../server/utils/mailer');

const invoice = {
  invoiceNo: 'INV-000070',
  invoiceDate: '2026-09-04',
  dueDate: '2026-10-04',
  subtotal: 900,
  vatAmount: 0,
  totalAmount: 900,
  paidAmount: 0,
  notes: '',
  lines: [{ description: 'SINTRA BOARD 1.5X3FT', amount: 900 }],
};
const customer = { name: 'PASTORA BOK', email: 'pastora@example.com' };

const baseSettings = {
  invoiceEmailSubject: 'Invoice {{invoiceNo}} from {{companyName}}',
  invoiceEmailGreeting: 'Dear {{customerName}},\n\nPlease find your invoice details below. Amount due: {{amountDue}}.',
  invoiceEmailPaymentInstructions: '',
  invoiceEmailTerms: '',
  invoiceEmailSignature: '',
  companyName: 'Finara ERP',
};

beforeEach(() => sendMailMock.mockClear());

describe('mailer.fillTemplate', () => {
  test('substitutes known tokens and drops unknown ones as blank', () => {
    const result = mailer.fillTemplate('Hi {{name}}, total {{total}}, {{missing}}', { name: 'Juan', total: '₱100.00' });
    expect(result).toBe('Hi Juan, total ₱100.00, ');
  });
});

describe('mailer.sendInvoiceEmail', () => {
  test('substitutes the subject template with invoice data', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, baseSettings);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'pastora@example.com',
      subject: 'Invoice INV-000070 from Finara ERP',
    }));
  });

  test('substitutes the greeting with customer name and amount due', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, baseSettings);
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain('Dear PASTORA BOK');
    expect(html).toContain('Amount due: ₱900.00');
  });

  test('omits the Payment Instructions / Terms / Notes blocks when blank', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, baseSettings);
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('Payment Instructions');
    expect(html).not.toContain('Terms &amp; Conditions');
    expect(html).not.toContain('Terms & Conditions');
    expect(html).not.toContain('>Notes<');
  });

  test('renders Payment Instructions, Terms, Notes, and Signature blocks when filled', async () => {
    const settings = {
      ...baseSettings,
      invoiceEmailPaymentInstructions: 'Pay via GCash 0917-000-0000',
      invoiceEmailTerms: 'Due within 30 days.',
      invoiceEmailSignature: 'Juan Dela Cruz\nAccounting',
    };
    const invoiceWithNotes = { ...invoice, notes: 'Rush order' };

    await mailer.sendInvoiceEmail(invoiceWithNotes, customer, settings);
    const html = sendMailMock.mock.calls[0][0].html;

    expect(html).toContain('Payment Instructions');
    expect(html).toContain('Pay via GCash 0917-000-0000');
    expect(html).toContain('Terms & Conditions');
    expect(html).toContain('Due within 30 days.');
    expect(html).toContain('>Notes<');
    expect(html).toContain('Rush order');
    expect(html).toContain('Juan Dela Cruz');
  });

  test('falls back to the hardcoded subject when the template resolves blank', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, { ...baseSettings, invoiceEmailSubject: '' });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Invoice INV-000070 from Finara ERP',
    }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/mailerInvoiceEmail.test.js`
Expected: FAIL — `mailer.fillTemplate` is `undefined`, and `sendInvoiceEmail` ignores the 3rd arg / still hardcodes the subject and greeting, so most assertions fail.

- [ ] **Step 3: Implement `fillTemplate`, `textBlock`, and rewrite `sendInvoiceEmail`**

In `server/utils/mailer.js`, insert right before the existing `async function sendInvoiceEmail(invoice, customer) {` (currently line 83):

```js
function fillTemplate(str, data) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (data[k] ?? ''));
}

function textBlock(label, text) {
  if (!text || !text.trim()) return '';
  const html = text.trim().split('\n').map((line) => `<p style="margin:0 0 4px">${line}</p>`).join('');
  return `<div style="margin:14px 0;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
    ${label ? `<p style="margin:0 0 6px;font-weight:700;font-size:12px;color:#374151">${label}</p>` : ''}
    ${html}
  </div>`;
}

const DEFAULT_INVOICE_SUBJECT  = 'Invoice {{invoiceNo}} from {{companyName}}';
const DEFAULT_INVOICE_GREETING = 'Dear {{customerName}},\n\nPlease find your invoice details below. Amount due: {{amountDue}}.';
```

Then replace the whole existing `sendInvoiceEmail` function with:

```js
async function sendInvoiceEmail(invoice, customer, settings = {}) {
  if (!customer?.email) return false;
  const lines = (invoice.lines || []).map((l) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${l.description || ''}</td>
     <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${peso(l.amount)}</td></tr>`).join('');

  const data = {
    customerName: customer.name || '',
    invoiceNo:    invoice.invoiceNo,
    invoiceDate:  dateStr(invoice.invoiceDate),
    dueDate:      dateStr(invoice.dueDate),
    subtotal:     peso(invoice.subtotal),
    vat:          peso(invoice.vatAmount),
    total:        peso(invoice.totalAmount),
    amountDue:    peso(Number(invoice.totalAmount) - Number(invoice.paidAmount || 0)),
    companyName:  settings.companyName || 'Finara ERP',
    notes:        invoice.notes || '',
  };

  const subject = fillTemplate(settings.invoiceEmailSubject || DEFAULT_INVOICE_SUBJECT, data)
    || `Invoice ${invoice.invoiceNo} from ${data.companyName}`;
  const greeting = fillTemplate(settings.invoiceEmailGreeting || DEFAULT_INVOICE_GREETING, data)
    .trim().split('\n').filter(Boolean).map((line) => `<p>${line}</p>`).join('');

  const html = wrap(`Invoice ${invoice.invoiceNo}`,
    `${greeting}
     <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
       <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Description</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Amount</th></tr></thead>
       <tbody>${lines}</tbody>
       <tfoot>
         <tr><td style="padding:6px 8px;text-align:right">Subtotal</td><td style="padding:6px 8px;text-align:right">${peso(invoice.subtotal)}</td></tr>
         <tr><td style="padding:6px 8px;text-align:right">VAT</td><td style="padding:6px 8px;text-align:right">${peso(invoice.vatAmount)}</td></tr>
         <tr><td style="padding:6px 8px;text-align:right;font-weight:700">Total</td><td style="padding:6px 8px;text-align:right;font-weight:700">${peso(invoice.totalAmount)}</td></tr>
       </tfoot>
     </table>
     <p style="font-size:12px;color:#6b7280">Invoice date: ${data.invoiceDate} · Due date: ${data.dueDate}</p>
     ${textBlock('Notes', data.notes)}
     ${textBlock('Payment Instructions', fillTemplate(settings.invoiceEmailPaymentInstructions, data))}
     ${textBlock('Terms & Conditions', fillTemplate(settings.invoiceEmailTerms, data))}
     ${textBlock('', fillTemplate(settings.invoiceEmailSignature, data))}`);

  return sendMail({ to: customer.email, subject, html });
}
```

Finally, replace the `module.exports` block:

```js
module.exports = {
  sendMail, sendPasswordReset, sendInvoiceEmail, sendOverdueReminder, sendPayslipEmail,
  wrap, getTransporter, APP_URL,
};
```

with:

```js
module.exports = {
  sendMail, sendPasswordReset, sendInvoiceEmail, sendOverdueReminder, sendPayslipEmail,
  wrap, getTransporter, APP_URL, fillTemplate,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/mailerInvoiceEmail.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/mailer.js tests/mailerInvoiceEmail.test.js
git commit -m "feat(mailer): make invoice email subject/greeting/blocks template-driven

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire per-business settings into `emailInvoice` — `server/controllers/notificationController.js`

**Files:**
- Modify: `server/controllers/notificationController.js:1-4` (requires), `server/controllers/notificationController.js:43-57` (`emailInvoice`)
- Test: `tests/notificationControllerEmailInvoice.test.js` (create)

**Interfaces:**
- Consumes: `settingsController.DEFAULTS` (Task 1), `mailer.sendInvoiceEmail(invoice, customer, settings)` (Task 2).
- Produces: `notificationController.emailInvoice` now fetches `SystemSetting` rows scoped to `req.businessId` and merges them over `settingsController.DEFAULTS` before calling `mailer.sendInvoiceEmail`.

- [ ] **Step 1: Write the failing tests**

Create `tests/notificationControllerEmailInvoice.test.js`:

```js
jest.mock('../server/config/database', () => ({
  invoice: { findUnique: jest.fn() },
  systemSetting: { findMany: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({
  getTransporter: jest.fn(() => true),
  sendInvoiceEmail: jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const settingsController = require('../server/controllers/settingsController');
const ctrl = require('../server/controllers/notificationController');

const run = (req) => new Promise((resolve, reject) => {
  ctrl.emailInvoice({ businessId: 1, params: { id: '70' }, ...req }, { json: resolve }, reject);
});

beforeEach(() => jest.clearAllMocks());

const invoice = {
  id: 70, invoiceNo: 'INV-000070',
  customer: { name: 'PASTORA BOK', email: 'pastora@example.com' },
  lines: [],
};

describe('notificationController.emailInvoice', () => {
  test('400s when SMTP is not configured', async () => {
    mailer.getTransporter.mockReturnValue(null);
    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  test('404s when the invoice does not exist', async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);
    await expect(run({})).rejects.toMatchObject({ statusCode: 404 });
  });

  test('400s when the customer has no email on file', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ ...invoice, customer: { name: 'PASTORA BOK', email: null } });
    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
  });

  test('merges saved settings over the defaults and passes them to sendInvoiceEmail', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'invoiceEmailSubject', value: 'Custom {{invoiceNo}}' },
      { key: 'companyName', value: 'Acme Corp' },
    ]);
    mailer.sendInvoiceEmail.mockResolvedValue(true);

    await run({});

    expect(mailer.sendInvoiceEmail).toHaveBeenCalledWith(
      invoice,
      invoice.customer,
      expect.objectContaining({
        invoiceEmailSubject: 'Custom {{invoiceNo}}',
        companyName: 'Acme Corp',
        invoiceEmailGreeting: settingsController.DEFAULTS.invoiceEmailGreeting,
      })
    );
  });

  test('400s (not masked as a generic 500) when sendInvoiceEmail reports failure', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.systemSetting.findMany.mockResolvedValue([]);
    mailer.sendInvoiceEmail.mockResolvedValue(false);

    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
  });

  test('scopes the settings lookup to the requesting business', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.systemSetting.findMany.mockResolvedValue([]);
    mailer.sendInvoiceEmail.mockResolvedValue(true);

    await run({ businessId: 42 });

    expect(prisma.systemSetting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 42 }) })
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/notificationControllerEmailInvoice.test.js`
Expected: FAIL — `mailer.sendInvoiceEmail` is currently called with only 2 args (no settings object), and `prisma.systemSetting.findMany` is never called.

- [ ] **Step 3: Wire the settings lookup into `emailInvoice`**

In `server/controllers/notificationController.js`, replace the top of the file:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const mailer = require('../utils/mailer');
```

with:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const mailer = require('../utils/mailer');
const settingsController = require('./settingsController');

const EMAIL_TEMPLATE_KEYS = [
  'invoiceEmailSubject', 'invoiceEmailGreeting', 'invoiceEmailPaymentInstructions',
  'invoiceEmailTerms', 'invoiceEmailSignature', 'companyName',
];
```

Then replace the `emailInvoice` function. Note the current code on this branch does NOT yet check `mailer.getTransporter()` upfront and throws the send-failure error as a **502** (which the global error handler masks to a generic "Internal server error" for the caller — that masking is why this task also switches it to 400 while it's in here):

```js
exports.emailInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { customer: true, lines: true } });
    if (!invoice) throw createError('Invoice not found', 404);
    if (!invoice.customer?.email) throw createError('Customer has no email address on file', 400);

    const sent = await mailer.sendInvoiceEmail(invoice, invoice.customer);
    if (!sent) throw createError('Email could not be sent. Check SMTP configuration.', 502);

    await recordAudit({ req, action: 'EMAIL', entity: 'Invoice', entityId: id, summary: `Emailed invoice ${invoice.invoiceNo} to ${invoice.customer.email}` });
    res.json({ message: `Invoice emailed to ${invoice.customer.email}` });
  } catch (err) { next(err); }
};
```

with:

```js
exports.emailInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!mailer.getTransporter()) throw createError('Email is not configured (SMTP env vars missing)', 400);

    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { customer: true, lines: true } });
    if (!invoice) throw createError('Invoice not found', 404);
    if (!invoice.customer?.email) throw createError('Customer has no email address on file', 400);

    const rows = await prisma.systemSetting.findMany({
      where: { businessId: req.businessId, key: { in: EMAIL_TEMPLATE_KEYS } },
    });
    const settings = {
      ...settingsController.DEFAULTS,
      ...Object.fromEntries(rows.map((r) => [r.key, r.value])),
    };

    const sent = await mailer.sendInvoiceEmail(invoice, invoice.customer, settings);
    if (!sent) throw createError('Email could not be sent. Check SMTP configuration.', 400);

    await recordAudit({ req, action: 'EMAIL', entity: 'Invoice', entityId: id, summary: `Emailed invoice ${invoice.invoiceNo} to ${invoice.customer.email}` });
    res.json({ message: `Invoice emailed to ${invoice.customer.email}` });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/notificationControllerEmailInvoice.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full backend test suite to confirm no regressions**

Run: `npx jest`
Expected: PASS — all existing suites plus the 3 new files added in Tasks 1-3 (no failures).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/notificationController.js tests/notificationControllerEmailInvoice.test.js
git commit -m "feat(notifications): pass per-business email template settings to sendInvoiceEmail

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: "Email Template" tab — `app/(dashboard)/settings/page.jsx`

**Files:**
- Modify: `app/(dashboard)/settings/page.jsx:6-12` (icon import), `app/(dashboard)/settings/page.jsx:18-31` (`TABS`), `app/(dashboard)/settings/page.jsx:742` (insert new tab section between the Company and Fiscal & Tax sections)
- Test: none automated (this repo has no frontend test harness) — manual verification in Step 3.

**Interfaces:**
- Consumes: the 5 setting keys from Task 1 (`invoiceEmailSubject`, `invoiceEmailGreeting`, `invoiceEmailPaymentInstructions`, `invoiceEmailTerms`, `invoiceEmailSignature`) via the page's existing `form` state (populated by `settingsApi.getAll()`, which already merges in `settingsController.DEFAULTS`).
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Add the `Mail` icon and the new tab entry**

In `app/(dashboard)/settings/page.jsx`, replace:

```js
import {
  Building2, FileText, Users, Database, Settings as SettingsIcon,
  Calculator, Hash, Shield, Save, RefreshCw, Download, AlertTriangle,
  CheckCircle, Eye, EyeOff, Trash2, Plus, Edit2, Key, ToggleLeft,
  ToggleRight, Server, HardDrive, Clock, Globe, Loader2, X, ChevronDown,
  Inbox, HelpCircle, Blocks,
} from 'lucide-react';
```

with:

```js
import {
  Building2, FileText, Users, Database, Settings as SettingsIcon,
  Calculator, Hash, Shield, Save, RefreshCw, Download, AlertTriangle,
  CheckCircle, Eye, EyeOff, Trash2, Plus, Edit2, Key, ToggleLeft,
  ToggleRight, Server, HardDrive, Clock, Globe, Loader2, X, ChevronDown,
  Inbox, HelpCircle, Blocks, Mail,
} from 'lucide-react';
```

Replace:

```js
const TABS = [
  { key: 'company',    label: 'Company',       icon: Building2,    roles: ['ADMIN', 'MANAGER'] },
  { key: 'fiscal',     label: 'Fiscal & Tax',  icon: FileText,     roles: ['ADMIN', 'MANAGER'] },
```

with:

```js
const TABS = [
  { key: 'company',    label: 'Company',       icon: Building2,    roles: ['ADMIN', 'MANAGER'] },
  { key: 'emailTemplate', label: 'Email Template', icon: Mail,      roles: ['ADMIN', 'MANAGER'] },
  { key: 'fiscal',     label: 'Fiscal & Tax',  icon: FileText,     roles: ['ADMIN', 'MANAGER'] },
```

- [ ] **Step 2: Insert the tab's content section**

Between the Company section's closing and the Fiscal & Tax section's opening:

```jsx
              <Field label="Website">
                <input className="input" value={form.companyWebsite || ''} onChange={set('companyWebsite')} placeholder="https://www.company.com" />
              </Field>
            </>
          )}

          {/* ── Fiscal & Tax ── */}
          {activeTab === 'fiscal' && (
```

insert a new block so it reads:

```jsx
              <Field label="Website">
                <input className="input" value={form.companyWebsite || ''} onChange={set('companyWebsite')} placeholder="https://www.company.com" />
              </Field>
            </>
          )}

          {/* ── Email Template ── */}
          {activeTab === 'emailTemplate' && (
            <>
              <SectionTitle icon={Mail}>Invoice Email Template</SectionTitle>
              <p className="text-xs text-gray-400 -mt-2 mb-2">
                Placeholders: <code className="font-mono">{'{{customerName}} {{invoiceNo}} {{invoiceDate}} {{dueDate}} {{subtotal}} {{vat}} {{total}} {{amountDue}} {{companyName}} {{notes}}'}</code>
              </p>

              <Field label="Subject Line">
                <input className="input" value={form.invoiceEmailSubject || ''} onChange={set('invoiceEmailSubject')} placeholder="Invoice {{invoiceNo}} from {{companyName}}" />
              </Field>
              <Field label="Greeting" sub="shown at the top of the email, above the invoice details">
                <textarea className="input" rows={3} value={form.invoiceEmailGreeting || ''} onChange={set('invoiceEmailGreeting')} />
              </Field>
              <Field label="Payment Instructions" sub="optional — the block is hidden entirely when left blank">
                <textarea className="input" rows={3} value={form.invoiceEmailPaymentInstructions || ''} onChange={set('invoiceEmailPaymentInstructions')} placeholder="e.g. Pay via GCash 0917-000-0000 or BDO 000-000-0000" />
              </Field>
              <Field label="Terms & Conditions" sub="optional — the block is hidden entirely when left blank">
                <textarea className="input" rows={3} value={form.invoiceEmailTerms || ''} onChange={set('invoiceEmailTerms')} placeholder="e.g. Payment due within 30 days of invoice date." />
              </Field>
              <Field label="Signature" sub="optional — the block is hidden entirely when left blank">
                <textarea className="input" rows={3} value={form.invoiceEmailSignature || ''} onChange={set('invoiceEmailSignature')} placeholder={'e.g. Juan Dela Cruz\nAccounting Department'} />
              </Field>
            </>
          )}

          {/* ── Fiscal & Tax ── */}
          {activeTab === 'fiscal' && (
```

- [ ] **Step 3: Manual verification**

1. Start the dev server yourself (`npm run dev`) — do not have an agent start a competing instance.
2. Go to **Settings**, confirm a new **"Email Template"** tab appears next to "Company".
3. Open it, fill in Payment Instructions, Terms & Conditions, and Signature, change the Subject Line to include `{{invoiceNo}}`, click **Save Settings**. Confirm the success toast and that the fields still show your text after a page reload.
4. Go to **Accounts Receivable**, open an invoice whose customer has an email on file (and, ideally, whose invoice has Notes set), click **Email Invoice**. Confirm it succeeds (success toast) — this confirms the full chain (Task 4 → Task 3 → Task 2) is wired correctly end-to-end. Task 2's Jest suite already covers the HTML/subject correctness in detail, so this step is a smoke test, not a re-verification of every case.
5. Clear the Payment Instructions/Terms/Signature fields back to blank and Save — confirms round-tripping blank values is not broken (should behave like a fresh install).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/settings/page.jsx"
git commit -m "feat(settings): add Email Template tab for the invoice email

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
