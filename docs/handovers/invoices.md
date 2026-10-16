# Handover: post-demo activation and invoices

Built 13 October 2026 on branch `v2-invoices` (worktree `~/BuPulse-v2-invoices`, from `v2`). Not pushed, not merged.
No database was touched: the migration was written and `npx prisma generate` was run, nothing was applied. How it
works: `docs/INVOICES.md`.

## What works (tested locally, no database)

- **Activate account** replaces Start trial on Demos and the company page's Demo and trial panel: Start trial with an
  editable number of days (1 to 90, default `trial.days`; reuses `startTrial`), or **No trial, send invoice**
  (monthly / yearly) which drafts an invoice for the chosen plan at the region price (RWF in RW, USD elsewhere) and
  opens the editor. AAL2 (`adminAction`) and audited.
- **Invoices** (Admin → Money → Invoices): list with status filter (incl. Overdue), company filter and search; editor
  for drafts (lines, quantities, prices, due date, notes, billing contact) with a live preview; Preview / Download PDF;
  Send (PDF attached, owner + billing contact, Pay online link); Resend email; Mark as paid (method + transaction id or
  receipt); Void (reason). Console only, audited, one conditional status write each (double clicks are refused).
- **Invoice settings**: logo (PNG/JPEG ≤ 512 KB, private bucket), name, address, email, phone, website, TIN, VAT rate
  (default none), footer, payment instructions (prefilled from the MoMo details), accent colour, with a preview.
- **PDF**: pdf-lib + standard fonts (Workers-safe), A4, multi-page, logo, PAID / VOID marks; stored in the private
  `invoices` bucket on send; client and admin download through auth-checked routes.
- **Paying**: Billing shows the open invoice (Pay by Mobile Money / Pay by card / PDF) and the invoice list; a company
  still `PENDING_DEMO` sees the invoice lock screen instead of the demo screen. Mobile Money uses reference = invoice
  number and amount = invoice total; confirming in Payments marks the invoice paid and activates its plan and interval
  (R4 confirm, same transaction). Mark as paid goes through the same confirmation. An active Paddle subscription for the
  same plan / interval: a completed card payment settles the open invoice it pays (webhook `transaction.completed`).
- **Overdue**: one reminder email on the due date from the daily momo-renewals job; the account follows the existing
  paywall (documented in `docs/INVOICES.md`, "Overdue").

## Owner testing fix (13 October 2026): activation only before the trial

Demos and the company page's demo panel now read the subscription fresh on each load and show **Activate account** only
for `PENDING_DEMO` companies. Others show where they stand (`lib/admin/subscription-summary.ts`, rendered by
`components/admin/subscription-status.tsx`: "On trial until 15 Oct", "Active – Business, MoMo, paid until 12 Nov",
"Past due – …", "Trial ended …") with **Extend trial** (trial plan only) and **Change plan** links to the Client 360
actions on the company page (`?tab=billing#actions`; the Actions panel got an `id="actions"` anchor).
`createActivationInvoice` now refuses anything but `PENDING_DEMO` with the same wording as Start trial. Test:
`tests/invoices/subscription-summary.test.ts`.

## Review fixes (13 October 2026, after merging v2: Google Calendar booking, location pricing)

1. **Card settlement** only on `transaction.completed` (money received), never on `subscription.*` events; at most one
   invoice, for the plan and interval paid, sent before the payment; exact amount + currency wins, otherwise only a first
   purchase (not `subscription_recurring`) settles the newest. `paidBy paddle:<transaction id>`. Tests:
   `tests/paddle-webhook.test.ts` (subscription.updated on an active card plan settles nothing),
   `tests/invoices/service.test.ts`.
2. **Reference index vs deletion**: `ManualPayment_reference_key` is `WHERE reference NOT LIKE 'BP-INV-%'` (no longer
   on `invoiceId`), so the SET NULL when a company's invoices are deleted cannot collide. The deletion purge also removes
   the company's invoice PDFs. Tests: service ("deleting a company"), `tests/account-deletion.test.ts`.
3. Client PDF route: no second `decodeURIComponent` (a malformed id is a 404).
5. **Mark as paid**: bank / cash receipts are stored as `BP-INV-0001/<receipt>` (scoped per invoice); MTN / Airtel ids
   stay global for the replay guard.
6. **Logo**: width and height read from the PNG IHDR / JPEG SOF header, at most 2000 × 2000, before storing; the PDF
   re-checks before embedding; SVG and anything else refused.

## Migration

`20261013090000_invoices` (after `20261012130100_storage_account_blocked`):

- sequence `Invoice_number_seq`; table `Invoice` (status and amount CHECKs, unique `number`, partial unique
  `Invoice_one_draft_per_business`), RLS on, `REVOKE ALL` from `PUBLIC, anon, authenticated, service_role` (table and
  sequence);
- `ManualPayment.invoiceId` (nullable FK, `ON DELETE SET NULL`), indexes on `invoiceId` and `reference`;
  `ManualPayment_reference_key` dropped and recreated as **partial** (`where "reference" not like 'BP-INV-%'`, independent of `invoiceId`, so the SET NULL when a company's invoices are deleted never collides): plain payments keep
  unique BP-XXXX references, attempts at one invoice share its number; new partial unique
  `ManualPayment_invoice_live_key` (one pending or confirmed payment per invoice);
- Storage bucket `invoices` (private, 5 MB, PDF / PNG / JPEG), skipped where there is no `storage` schema. No policy
  names it: only the service key reaches it.

Additive only (new table, nullable column, index swap on a unique key that keeps its uniqueness for existing rows).
Deploy order: back up, `npx prisma migrate deploy`, then the code. The new code before the migration fails only on
invoice pages and on `ManualPayment` reads (the `invoiceId` column), so run the migration first, as for R1.

New dependency: `pdf-lib@1.17.1` (pure JS, MIT).

## Changed outside the new files

- `lib/billing/momo.ts`: `startManualPayment` split into a shared `openPayment` + new `startInvoicePayment`; confirm
  pre-checks and claims the invoice inside its transaction; billing event and audit carry the invoice id. Behaviour of
  plain payments unchanged (all R4 tests pass).
- `lib/billing/momo-shared.ts`: `isReference` accepts `BP-INV-0001`; `ManualPaymentView.invoiceId`.
- `lib/billing/momo-renewals.ts`: calls `sendInvoiceReminders` once per sweep (isolated try/catch; `invoiceReminders`
  only present in the run summary when > 0).
- `app/api/billing/webhooks/paddle/route.ts`: on `transaction.completed`, `settleInvoiceFromCardPayment` (best effort).
- `lib/account-deletion.ts`: the purge removes `pdf/<businessId>/` from the `invoices` bucket.
- `app/dashboard/billing/actions.ts`: `startMomoPayment` also takes `{ invoiceId }`.
- `app/dashboard/billing/page.tsx`, `app/dashboard/layout.tsx` (invoice lock while `PENDING_DEMO`),
  `components/billing/momo-payment.tsx` (invoice wording, retry keeps the invoice).
- `app/admin/(console)/(clients)/demos/page.tsx`, `components/admin/demo-panel.tsx`: the Start trial button became
  `<ActivateAccount>` (a few lines each; `startTrialAction` in `demos/actions.ts` is kept and unchanged).
  **Note for the demo-booking / calendar builder working on the same files:** only those button blocks changed.
- `components/admin/nav.ts` (Invoices under Money), `lib/rate-limit.ts` (`invoicePdf`: 60/h per company),
  `prisma/schema.prisma`, `tests/admin/fake-db.ts` (invoice table, partial unique indexes, `contains`, the sequence in
  `$queryRaw`).

## Tests

`tests/invoices/shared.test.ts` (numbers, totals and VAT, money input, Kigali dates, overdue / reminder timing, editor
validation per field, settings), `pdf.test.ts` (non-empty PDF, number / total / reference in the page text, logo
embedded, broken logo skipped, unsupported characters, multi-page, PAID / VOID), `service.test.ts` (numbering under
concurrency, activation and its one-draft race, editor, send once with attachment and stored PDF, Storage down, MoMo
with the invoice reference → confirm → invoice paid → plan ACTIVE, replay and retry, void guards, mark paid through
confirm, reminders once, card settlement, client sees only its own invoices, admin list filters), `actions.test.ts`
(every admin action re-checks AAL2 first, Activate account both ways, Owner-only invoice payment, PDF routes 401 / 403 /
404 / 200 and admin 404), `numbering.db.test.ts` (40 concurrent `nextval` against Postgres; skipped unless
`RUN_DB_TESTS=1` with a database).

## Checks (13 October 2026, no database)

| Check | Result |
|---|---|
| `npx next typegen` | ok |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npx vitest run` | 166 files passed, 10 skipped; 2018 tests passed, 70 skipped; 0 failed (after the review fixes and the v2 merge) |
| `npx next build` | compiled, exit 0 |

## Not done / to decide

- Invoices are created from Activate account only; there is no "New invoice" for an arbitrary company yet (the service
  and editor support it; it needs a company picker). A draft's plan and interval are fixed at creation (void and
  re-issue to change them).
- Card payment of an invoice charges the plan's card price (USD, derived from RWF), not the invoice total; a discount
  on the invoice is honoured only by Mobile Money or Mark as paid. Paddle cannot charge a one-off custom amount
  without a transaction API integration.
- Payment instructions saved once stop following later MoMo detail changes (the empty value follows them); clear the
  field to go back to the automatic text.
- The admin Activity feed and Client 360 do not list invoices yet (the company page links to the filtered list).
- The bucket is created by the migration; on a Supabase project where migrations run without the `storage` schema, create
  the private `invoices` bucket by hand (PDF / PNG / JPEG, 5 MB).
- A real-database check of the migration (partial index swap on `ManualPayment`) and the end-to-end send (Resend with an
  attachment) should be part of the Tuesday test pass.
