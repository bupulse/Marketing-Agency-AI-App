# Invoices and post-demo activation

After the demo the admin activates the account: a trial, or no trial and an invoice to pay. Invoices are BuPulse's own
(numbered `BP-INV-0001` onwards, PDF by email), paid by Mobile Money with the invoice number as the reference, by card,
or marked paid by hand. Paying one switches the plan on. Built 13 October 2026 (handover: `docs/handovers/invoices.md`).

## Activate account (after the demo)

**Admin → Demos** (each row of a company waiting for its demo) and the **Demo and trial** panel on the company page
show **Activate account** where **Start trial** used to be. The dialog offers:

- **Start trial**, with the number of days (1 to 90, default the `trial.days` setting). Runs `startTrial`
  (`lib/admin/demos.ts`) with those days: same checks, email and audit (`start_trial`) as before.
- **No trial, send invoice**, monthly or yearly (default monthly). `createActivationInvoice` (`lib/invoices/service.ts`)
  creates a **draft** for the client's chosen plan (`Subscription.chosenPlan`) at the company region's price
  (`companyPlans`, the same amounts as Billing: RWF in Rwanda, USD elsewhere), one line ("BuPulse Pro plan, monthly
  (1 month)"), issued today (Kigali) and due in 3 days, VAT from the settings. The live demo booking is marked done.
  The admin lands in the editor. Only for a company still waiting for its demo (like Start trial), and refused for a
  plan the region does not sell. Clicked twice (or by two admins) it opens the same draft: one draft per company
  (`Invoice_one_draft_per_business`). The subscription stays `PENDING_DEMO` until the invoice is paid.

Activate account is shown only while the company's subscription is `PENDING_DEMO` (read fresh on each page load). Past
that, the Demos list and the panel show where the company stands instead (`lib/admin/subscription-summary.ts`: "On
trial until 15 Oct", "Active – Business, MoMo, paid until 12 Nov", "Past due – …", "Trial ended 15 Oct") with links to
**Extend trial** (trial plan only) and **Change plan**, which open the company page's Client 360 actions
(`?tab=billing#actions`).

Both go through `adminAction()` (allow-listed email, AAL2) and are audited (`start_trial`, `create_invoice`).

## Invoices

`Invoice` (`prisma/schema.prisma`, migration `20261013090000_invoices`): `number` (unique), `businessId`, `status`
(`draft` | `sent` | `paid` | `void`), `currency`, `lines` (JSON `[{ description, quantity, unitMinor }]`),
`subtotalMinor`, `taxRatePercent`, `taxMinor`, `totalMinor`, `issueDate`, `dueDate` (calendar days), `notes`,
`billingEmail`, `planKey` / `interval` (what paying activates), the `billTo` and `seller` snapshots taken when sent,
`pdfPath`, `sentAt`, `sentTo`, `reminderSentAt`, `paidAt`, `paidBy` (`manual_payment:<ManualPayment id>` or
`paddle:<subscription id>`), `voidedAt` / `voidReason`, `createdBy`. RLS on, grants revoked like every internal table.

**Numbers** come from the Postgres sequence `Invoice_number_seq` (`nextInvoiceNumber`: `SELECT nextval(...)`), so two
invoices created at the same instant never share a number and no lock is needed. A number is never reused: a voided
invoice keeps its number, and a create that fails leaves a gap. `BP-INV-0001` … `BP-INV-9999`, then `BP-INV-10000`.

**Totals**: subtotal = Σ quantity × unit price; VAT = subtotal × rate, rounded to the smallest unit, only when a VAT
rate is set (default none: no tax line); total = subtotal + VAT. Recomputed on the server on every save.

### Lifecycle (Admin → Invoices, `/admin/invoices`)

| Action | From | What happens |
|---|---|---|
| Edit (Save draft) | draft | Lines (1 to 30; description up to 200 characters, whole quantity 1 to 10,000, price ≥ 0), due date (not before the issue date, at most a year after), notes (printed), billing contact (optional email). Live preview beside the form. `update_invoice` |
| Preview PDF / Download PDF | any | `/admin/invoices/[id]/pdf` (AAL2 admins only, 404 to anyone else). A draft is drawn with the current settings |
| Send | draft | Saves what the editor shows, then: issue date = today, the due date must not have passed, `billTo` and `seller` frozen, status `sent` (the claim comes first, so a double click never emails twice), the PDF stored, and one email each to the owner and the billing contact with the PDF attached (amount, due date, reference, **Pay online** button to `/dashboard/billing?invoice=BP-INV-0001`). A failed email leaves it sent; the notice says so. `send_invoice` |
| Resend email | sent | The stored PDF again to the same addresses. `resend_invoice` |
| Mark as paid | sent | Method (MTN, Airtel, bank transfer, cash) and transaction id / receipt number. See below. `invoice_paid` (+ `confirm_momo_payment`) |
| Void | draft, sent | With a reason (3 to 300 characters). Not while a payment the client reported waits in Payments; a payment they only opened is closed. A paid invoice is refunded, never voided. `void_invoice` |

Every action is console only (`requireConsole`: the Jarvis API is refused), behind `adminAction()`, audited, and one
conditional write on the status, so a second click or a second admin gets "already …" and nothing changes.

The list filters by status (All, Drafts, Sent, **Overdue** = sent and past the due date, Paid, Void), by company
(`?businessId=`, linked from the company page) and searches the number or the company name.

### Invoice settings (`/admin/invoices/settings`)

AdminSetting `invoice.settings` (`InvoiceSettings`, `lib/invoices/shared.ts`; audited `set_invoice_settings`,
`set_invoice_logo`): logo (PNG or JPEG, at most 512 KB and 2000 × 2000 pixels, type and size read from the file's header before anything
is decoded, so SVG and decompression bombs are refused; stored in the private `invoices` bucket under `settings/`; the
PDF re-checks the header before embedding), business / legal name (default "BuPulse"), address, email, phone, website, TIN (optional,
printed when set), VAT rate (optional; empty = no tax line), footer, payment instructions (prefilled from the Mobile
Money settings: "Pay by Mobile Money to MoMo Pay code … (account name), or online with the link below."), accent colour.
Malformed values are refused, never truncated. A preview with a made-up client sits beside the form. Drafts and new
invoices use the settings; a sent invoice keeps what it was sent with.

## The PDF (`lib/invoices/pdf.ts`)

pdf-lib with the standard Helvetica fonts: pure JavaScript, no native code, no font files, so it runs on Cloudflare
Workers as it does in Node and the tests. A4: accent band, logo and BuPulse's details (address, email, phone, website,
TIN), INVOICE with number, issue and due dates and the plan; PAID (with the date) or VOID mark; Bill to (company,
owner, phone, email, head office from the business info, country); the line table (wraps long descriptions, continues on
new pages with the header repeated); subtotal, VAT, total; **How to pay** (the instructions, MoMo Pay code, MTN and Airtel
numbers, account name, "Use reference BP-INV-0001", the Pay online URL); notes; footer with "BP-INV-0001 · Page 1 of N".
Characters the standard fonts cannot draw (emoji, other scripts) print as "?" instead of failing.

**Storage**: the private bucket `invoices` (a deleted account's `pdf/<businessId>/` files are removed by the deletion purge, `lib/account-deletion.ts`) (created by the migration; no Storage policy names it, so signed-in users can
neither read nor write it). The app uses the service key after its own checks: `pdf/<businessId>/<number>.pdf` is
written when the invoice is sent. Downloads: a sent invoice serves the stored copy; a paid or void one is drawn again
from the frozen details with its mark; if Storage was down at send time the PDF is drawn again on download (same frozen
data, so the same invoice).

## Paying an invoice

**Client Billing page** (`/dashboard/billing`): the open invoice (newest `sent` one) with the total, the due date,
Download PDF, **Pay by Mobile Money** (where the region takes it and Payments → Where clients pay is filled in) and
**Pay by card** (where the region takes cards). Below, **Invoices**: every sent, paid or void invoice of the company with
its status and PDF (`/api/invoices/[id]/pdf`). Drafts are never shown to the client.

**While the company waits for its demo** (`PENDING_DEMO`) the dashboard is the lock screen; once an open invoice exists
the layout shows `components/app/invoice-lock.tsx` ("Your invoice is ready", the same pay card and list) instead of
the demo screen. A voided invoice brings the demo screen back.

**Mobile Money**: `startMomoPayment({ invoiceId })` → `startInvoicePayment` (`lib/billing/momo.ts`) opens a
`ManualPayment` with `invoiceId`, **reference = the invoice number**, **amount = the invoice total**, the invoice's
currency, plan and interval. Only for an invoice of the caller's own company that is `sent`, a region with Mobile
Money, the Owner (`billing` permission) and the shared `momo:` rate limit. The pay screen, "I've paid", the admin
queue and the email are the usual ones (`docs/MOMO.md`). Starting again returns the same payment; a rejected attempt
can be retried with the same reference.

**Confirming** (Admin → Payments) runs the R4 confirmation unchanged (plan, interval, period, `ACTIVE`, revenue event,
analytics, "Your plan is active" email) and, in the same transaction, moves the invoice `sent` → `paid`
(`paidBy manual_payment:<id>`, audited `invoice_paid`). A voided or already paid invoice stops the confirmation:
nothing is written and the admin is told to reject (and refund) instead.

**Replay guards**: the R4 guards all hold (transaction id unique per network among live payments, checked on submit,
inside confirm and by the index; one pending payment per company). On top: one live payment per invoice
(`ManualPayment_invoice_live_key`: `invoiceId` unique where status is pending or confirmed), and the invoice claim itself
(only a `sent` invoice becomes `paid`). `ManualPayment.reference` stays unique for plain payments
(`ManualPayment_reference_key` is now partial: `where reference not like 'BP-INV-%'`, so deleting a company, which sets the payments' `invoiceId` to null, never collides), because every attempt at one invoice shares
its number.

**Mark as paid** (admin): for an invoice with a plan, a `ManualPayment` is created with the invoice number, the method as
the network and the typed transaction id / receipt, and confirmed at once through `confirmManualPayment`, so the plan,
period, revenue, guards and email are exactly the Mobile Money ones. MTN / Airtel transaction ids are stored as typed,
so the replay guard still refuses the same SMS on a second invoice; a bank or cash receipt is stored scoped to the
invoice (`BP-INV-0001/R-0001`, `manualTransactionId`), so the same receipt words on two invoices are not a replay. A payment the client opened but did not report
gives way; one they reported must be decided in Payments first. An invoice without a plan is just marked paid
(`manual:<method>:<reference>`).

**Card**: Pay by card opens the existing checkout for the invoice's plan and interval (charged at the plan's card price
in USD, renewing in Paddle). Only a **completed payment** settles an invoice: the Paddle `transaction.completed` event
(`cardPaymentOf`, `settleInvoiceFromCardPayment`), never `subscription.*` events (renewals, edits). It settles at most one
open invoice of that company, for the plan and interval paid and **sent before the payment**: the newest whose total and
currency equal the payment, or else, for a first purchase (Paddle origin other than `subscription_recurring`), the
newest one (an RWF invoice paid at the USD card price). A renewal that matches no invoice exactly settles nothing.
`paidBy paddle:<transaction id>`, audited as `system:paddle`. Until the RW card prices exist in Paddle, checkout answers
"Card payments are not ready for your region yet" (`docs/REGIONS.md`).

**Which payments settle an invoice (card and Mobile Money alike, `matchInvoicePayment`).** Only invoices for the paid plan and interval that were sent before the payment are considered. An invoice is marked paid automatically only when the payment provably is for it: its total and currency equal the payment, or it has a single plan line whose amount equals the payment (the newest such). Anything else is **not** marked paid, because a payment at the standard price must not close a larger invoice (a setup fee, extra lines). That includes an RWF invoice paid at the plan's USD card price. Instead the newest candidate gets `Invoice.paymentReview` (source, reference, amount, currency, time), an `invoice_payment_review` audit row is written, the admins are emailed, and the admin invoice page shows "Payment received: X ... check and mark paid". The invoice stays `sent`, so the due-date reminder keeps going until an admin marks it paid; marking it paid then only confirms the money (no second payment or period, `paidBy` = `paddle:<transaction>` or `momo:<reference>`). A card renewal never needs review. Settled by a plain MoMo payment: `paidBy` = `momo:<reference>`, same transaction as the confirmation.

## Overdue

- **Reminder**: the daily Mobile Money job (`/api/cron/momo-renewals`, 05:41 UTC = 07:41 Kigali) sends one reminder per
  sent invoice on its due date (or the first run after it), with the PDF and the Pay online link
  (`sendInvoiceReminders`). Claimed first (`reminderSentAt`), released when the email fails; nothing is claimed while
  Resend is switched off. The run's summary carries `invoiceReminders` when any went out.
- **The account**: an invoice never changes the subscription by itself. The existing paywall rules decide:
  - activated with **no trial** (`PENDING_DEMO`): stays read-only on the invoice lock screen until the invoice is paid
    (nothing is deleted);
  - on a **trial** with an invoice: the trial ends as usual (`EXPIRED`, read-only) and paying reopens it;
  - a **paying Mobile Money** company: renewals and grace as in `docs/MOMO.md` (`PAST_DUE` after 3 days of grace).
  The invoice stays `sent` (shown as **Overdue**) and can be paid at any time; the admin may void it and issue a new one.

## Where things are

| | |
|---|---|
| Rules with no I/O (numbers, totals, money input, dates, editor checks, settings shape) | `lib/invoices/shared.ts` |
| The PDF | `lib/invoices/pdf.ts` |
| Service (activation, edit, send, resend, mark paid, void, reminders, card settlement, lists, client reads) | `lib/invoices/service.ts` |
| Settings and logo | `lib/invoices/settings.ts` |
| Storage (`invoices` bucket) | `lib/invoices/storage.ts` |
| Emails | `lib/invoices/emails.ts` |
| Mobile Money for invoices | `lib/billing/momo.ts` (`startInvoicePayment`, the invoice claim in `confirmManualPayment`) |
| Admin | `app/admin/(console)/invoices/` (list, `[id]` editor, `[id]/pdf`, `settings`, `actions.ts`), `components/admin/activate-account.tsx`, `components/admin/invoice-editor.tsx`, nav item under Money |
| Client | `components/billing/invoice-pay.tsx`, `components/billing/client-invoices.tsx`, `components/app/invoice-lock.tsx`, `app/api/invoices/[id]/pdf/route.ts`, `app/dashboard/billing/page.tsx`, `app/dashboard/layout.tsx` |
| Shared preview | `components/invoices/invoice-preview.tsx` |
| Tests | `tests/invoices/*` |
