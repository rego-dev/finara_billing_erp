# Customizable Invoice Email Template — Design

## Purpose

Emailing an invoice to a customer (`notifications.emailInvoice`) currently sends a fixed, hardcoded HTML template (`server/utils/mailer.js#sendInvoiceEmail`) with no way to add payment instructions, terms & conditions, or a signature block, and no way to change the wording without a code change. This adds a per-business, editable email template — managed the same way every other setting in this app already is (`SystemSetting` key-value store, Settings page tab, `getAll`/`saveAll`).

## Scope

- Applies only to the single-invoice email (`emailInvoice` / "Email Invoice" button on the Receivable page). `sendOverdueReminder` and `sendPayslipEmail` are out of scope — no change to those templates.
- The existing HTML layout (letterhead-style header, line-items table, subtotal/VAT/total block, invoice date/due date line) stays fixed/unchanged. Only new, optional blocks are added, plus the greeting and subject become editable.
- No schema/migration changes. The invoice's existing `notes` field (already captured on invoice creation, already stored) is reused as the customer-facing "Notes" block in the email — this covers the PO/reference need without adding a new column.

## Storage — `server/controllers/settingsController.js`

Add 5 new keys to the `DEFAULTS` map (alongside the existing company/tax/fiscal defaults):

```js
invoiceEmailSubject:             'Invoice {{invoiceNo}} from {{companyName}}',
invoiceEmailGreeting:            'Dear {{customerName}},\n\nPlease find your invoice details below. Amount due: {{amountDue}}.',
invoiceEmailPaymentInstructions: '',
invoiceEmailTerms:               '',
invoiceEmailSignature:           '',
```

No changes needed to `getAll`/`saveAll` — they already merge/persist arbitrary keys generically.

## Placeholder substitution — `server/utils/mailer.js`

Add a small helper:

```js
function fillTemplate(str, data) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (data[k] ?? ''));
}
```

Supported tokens (available in subject, greeting, payment instructions, terms, and signature — same data object everywhere, for consistency): `{{customerName}} {{invoiceNo}} {{invoiceDate}} {{dueDate}} {{subtotal}} {{vat}} {{total}} {{amountDue}} {{companyName}} {{notes}}`.

`sendInvoiceEmail(invoice, customer, settings)` — new `settings` param (object with the 5 keys above plus `companyName`, as returned by `getAll`):

1. Build the substitution data object from `invoice`/`customer` (reusing the existing local `peso`/`dateStr` helpers already in the file) plus `companyName: settings.companyName` and `notes: invoice.notes || ''`.
2. `subject = fillTemplate(settings.invoiceEmailSubject, data)` — falls back to the current hardcoded subject if the resolved string is blank.
3. `greeting = fillTemplate(settings.invoiceEmailGreeting, data)` — rendered with newlines converted to `<br>` (or wrapped in `<p>` per line), replacing the current hardcoded `Dear ${customer.name}...` line.
4. Existing line-items table + totals block: unchanged.
5. Append, in this fixed order, **only if the substituted+trimmed value is non-empty**:
   - Notes block — from `data.notes` (invoice's own `notes` field), labeled "Notes"
   - Payment Instructions block — `fillTemplate(settings.invoiceEmailPaymentInstructions, data)`, labeled "Payment Instructions"
   - Terms & Conditions block — `fillTemplate(settings.invoiceEmailTerms, data)`, labeled "Terms & Conditions"
   - Signature block — `fillTemplate(settings.invoiceEmailSignature, data)`, no label, styled as a sign-off (rendered last, above the existing automated-message footer)
6. Each block reuses the same simple bordered/box styling already used elsewhere in `wrap()`'s inline-CSS conventions (no new stylesheet).

## Wiring — `server/controllers/notificationController.js`

`emailInvoice`: after loading the invoice/customer and before calling `mailer.sendInvoiceEmail`, fetch the relevant settings for `req.businessId`:

```js
const rows = await prisma.systemSetting.findMany({
  where: { businessId: req.businessId, key: { in: [
    'invoiceEmailSubject', 'invoiceEmailGreeting', 'invoiceEmailPaymentInstructions',
    'invoiceEmailTerms', 'invoiceEmailSignature', 'companyName',
  ] } },
});
const settings = { ...DEFAULTS_SUBSET, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
```

Pass `settings` as the third arg to `mailer.sendInvoiceEmail(invoice, invoice.customer, settings)`.

To avoid duplicating the 6 default values in two files, export `DEFAULTS` from `settingsController.js` (`module.exports.DEFAULTS = DEFAULTS`) and pick the needed subset in `notificationController.js` rather than redefining them.

Error handling for missing SMTP / send failure is unchanged from the recent fix (both surface as 400s with their real message).

## Settings UI — `app/(dashboard)/settings/page.jsx`

- New tab: `{ key: 'emailTemplate', label: 'Email Template', icon: Mail, roles: ['ADMIN', 'MANAGER'] }` (same roles as Company).
- New `{activeTab === 'emailTemplate' && (...)}` section following the existing `Field`/textarea conventions already used elsewhere in the file:
  - **Subject** — single-line `input`, bound to `form.invoiceEmailSubject`
  - **Greeting** — multi-line `textarea`, bound to `form.invoiceEmailGreeting`
  - **Payment Instructions** — multi-line `textarea`, optional, bound to `form.invoiceEmailPaymentInstructions`
  - **Terms & Conditions** — multi-line `textarea`, optional, bound to `form.invoiceEmailTerms`
  - **Signature** — multi-line `textarea`, optional, bound to `form.invoiceEmailSignature`
  - A small static hint block listing the available `{{placeholder}}` tokens
- No new save logic — the existing global "Save Settings" button already posts the entire `form` object via `settingsApi.saveAll(form)`, so these keys are picked up automatically the same way every other tab's fields are.
- Add `Mail` to the existing `lucide-react` import list.

## Out of Scope / No Change Needed

- `sendOverdueReminder` and `sendPayslipEmail` templates — untouched.
- No new Invoice field (PO Number) — `notes` is reused instead, per decision during brainstorming.
- No preview feature — structured fields with a fixed layout are low-risk enough that a live preview isn't needed for v1.
- No per-customer template overrides — one template per business, same as every other setting in this app.

## Testing

- Leave all 5 fields at default → email an invoice → confirm it looks the same as today (Notes block only appears if the invoice itself has notes).
- Fill in Payment Instructions, Terms, and Signature → email an invoice → confirm all three blocks appear, in order, correctly substituted.
- Leave Terms blank but fill Payment Instructions and Signature → confirm only the non-blank blocks render (no empty box for Terms).
- Use a placeholder in Subject (e.g. `Invoice {{invoiceNo}} — please settle by {{dueDate}}`) → confirm the sent email's subject line substitutes correctly.
- Save Settings with an invoice.notes value present → confirm the Notes block shows that exact text.
- Confirm existing SMTP-not-configured / send-failed error messages (from the earlier fix) still surface correctly — this change doesn't touch that error path.
