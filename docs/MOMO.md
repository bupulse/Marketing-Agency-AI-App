# Mobile Money payments (manual, with an automatic provider plug-in point)

Clients in Rwanda pay with MTN MoMo or Airtel Money, by hand. BuPulse shows them what to pay and where, they pay on
their phone and say so, and the owner checks the Mobile Money message and confirms in the admin console. Nothing
renews by itself; reminders and a short grace period replace automatic renewal. Card payments (Paddle) are unchanged.

Decided in `docs/RWANDA_LAUNCH_PLAN.md` (sections 2, 5 and R4). Built on 9 October 2026 (`docs/handovers/r4-momo.md`);
joined to the regions and the demo-first trial (R1, `docs/REGIONS.md`) on 12 October 2026.

## The flow

1. **Choose.** On Billing the client picks a plan and monthly or yearly, then **Mobile Money (MTN / Airtel)** or
   **Card**. The choice appears wherever the company's region lists both methods (`PricingRegion.paymentMethods`, RW
   today), at every pay entry point (Billing plans, the demo lock screen, offers, invoices); a method that is not set up
   yet stays visible and disabled ("Mobile Money coming soon" until the owner fills in where to pay, below; "Card
   payments coming soon" until card is set up, `docs/BILLING.md`, "Choosing how to pay"). The plans and amounts are the company region's
   (`companyPlans()`, `docs/REGIONS.md`): in Rwanda, Starter and Business in RWF. Only the company Owner can pay.
2. **Pay.** `startManualPayment` creates one `ManualPayment` (status `pending`) with the plan's price in the company's
   region (`getMomoPrice(businessId, plan, interval)` = `PlanRegionPrice`, the same amount the pricing page shows; a
   plan not offered there, or a region without Mobile Money, is refused before anything is written) and a reference
   such as `BP-7K3Q` (no 0/O/1/I). The pay screen shows the amount and the reference (copy buttons), "Dial
   `*182*8*1*<merchant code>#` on your MTN line" with a **Tap to dial** link on phones (`tel:*182*8*1*002450%23`: `#`
   must be escaped or the dialer drops it) and a copy button, the MTN number if there is one, Airtel instructions
   ("dial *182#, Send money, to <Airtel number>, reference BP-…") when an Airtel number is set, and the account name.
   The dial string comes from the admin's merchant code (`mtnMomoPayDial()` in `momo-shared.ts`; MTN Rwanda's MoMo Pay
   format `*182*8*1*<code>#`, the code kept as typed, leading zeros included). One open payment per company: starting again returns it; picking another plan before
   paying replaces it (the old one becomes `expired`).
3. **I have paid.** The client chooses the network, types the phone they paid from and the transaction id, and adds a
   **screenshot** of the MoMo confirmation (see "Proof" below). The transaction id is required (it powers the replay
   guard) unless the client ticks **I can't find the transaction id**: the screenshot is then required, and the owner
   types the id when confirming. Checked with zod (`proofSchema`), in the browser and again on the server. `submittedAt` is set once; every `ADMIN_EMAILS` address gets "New MoMo
   payment to check"; the Payments badge in the admin sidebar counts it; the activity feed shows it.
4. **Waiting.** "Waiting for approval · usually a few minutes" polls `momoPaymentStatus` every 5 seconds and refreshes
   the page when the owner decides.
5. **Confirm** (admin → Payments). The queue shows the amount, the reference, the phone, the transaction id (or "no
   transaction id") and the screenshot (a 10-minute signed URL; click to enlarge). Without a client id the Confirm dialog
   asks for it (`confirmManualPayment(ctx, id, now, { transactionId })`), and it goes through the same replay checks. In one transaction: the payment is claimed (`pending` → `confirmed`, so a second click
   is refused), the subscription becomes `provider MANUAL_MOMO`, the paid plan, `ACTIVE`, the interval, the new period
   (`currentPeriodStart/End`; card ids cleared), a `BillingEvent` (`manual_payment.confirmed`, with the USD value at the
   USD->RWF rate of Admin -> Settings, `pricing.usdToRwf`) is written for revenue, and an audit row with before and after.
   Whatever the company's status was (waiting for its demo, on its trial, expired, past due), it is `ACTIVE` on the plan
   it paid for afterwards. Then the `upgrade` / `plan_change`
   analytics event and the "Your plan is active" email. Usage counts from the new period start, so it resets.
   - Period (`planManualPeriod`): a running period (a paid-up MoMo one, or a card one the client has cancelled at its
     end) of the **same plan and interval** is extended from its end (early renewal loses nothing; only
     `currentPeriodEnd` moves, `currentPeriodStart` stays the usage anchor and is never in the future). A **different
     plan or interval** starts now and replaces the running period (no free overlap; the queue and the client's pay
     screen both say "Plan change: replaces the current period (N days left)" and the owner may credit by hand).
     A trial, an ended, past-due or still-renewing card plan starts now. Monthly adds one month, yearly twelve.
     The payment row keeps the exact period it bought.
   - Replay: a transaction id already used by a pending or confirmed payment of any company is refused on submit, again
     inside the confirm transaction, and by a partial unique index (network + upper(transactionId)). The queue warns
     "Transaction id seen before on payment X" when any older payment, rejected ones included, used it.
   - Concurrency: the subscription write is conditional on the ids, status and period end that were read; if it
     changed meanwhile the period is recomputed once. One pending payment per company is also a partial unique index.
6. **Reject** with a reason (3 to 300 characters): the client sees it on Billing for a week with **Try again**, and gets
   an email. Audited, once.
7. **Renewals** (`/api/cron/momo-renewals`, daily 05:41 UTC, `MOMO_RENEWALS_CRON`): for `MANUAL_MOMO` + `ACTIVE`
   subscriptions, a reminder email 5 days and 1 day before `currentPeriodEnd` (the plan's current regional price, or
   what the client paid last time when the plan is no longer offered in their region; where to pay; a "Pay now" link
   and a WhatsApp-ready text the client can copy), 3 days of grace, then `PAST_DUE` (the existing paywall makes the
   account read-only, nothing is deleted) and a "plan is paused" email. Each email is claimed first in `RenewalNotice`
   (unique per user, period end and kind), so it is never sent twice; a failed send gives the claim back. No reminder
   while a submitted payment waits for the owner. Payments started but never submitted are closed after 48 hours.
   Runs under an advisory lock with a cursor, like the price-change job.

Invoices (`docs/INVOICES.md`): a payment can settle a BuPulse invoice. Its reference is then the invoice number
(`BP-INV-0001`, shared by every attempt at that invoice), the amount is the invoice total, and confirming it also marks
the invoice paid in the same transaction. One live payment per invoice (`ManualPayment_invoice_live_key`).

Switching method: a card subscription that still renews blocks a MoMo payment; once the client has cancelled it
(`cancelAtPeriodEnd`, active until its period end) a MoMo payment of the same plan starts from that end. A paid-up MoMo
plan blocks card checkout until its period has ended. A late Paddle webhook can never end a paid-up Mobile Money plan
(`lib/billing/apply.ts`: ACTIVE with the period end in the future); a new live card subscription on top of one is a
duplicate, like a second card purchase, while a past-due or lapsed MoMo plan is simply replaced by it.

## Proof (the screenshot)

- **Bucket:** `payment-proofs`, private, 5 MB, JPEG / PNG / WebP (migration `20261017170000_payment_proofs`). No Storage
  policy names it: signed-in users cannot list, read or write it; only the server key does.
- **Upload:** `startMomoProofUpload` → `startProofUpload(userId, { paymentId, type, bytes })` checks the type and size,
  that the payment is the caller's own, pending and not submitted, records the new path on the payment
  (`<userId>/<paymentId>/<uuid>.<ext>`, a re-upload removes the previous file) and returns a one-file signed upload URL.
  The browser uploads straight to Storage. A HEIC photo (or any image over 5 MB) is converted to JPEG in the browser
  first (canvas, long side at most 2400 px); a file the browser cannot read is refused with "JPEG, PNG or WebP".
- **Check on submit:** the path must be the one recorded for that payment; the server downloads it, checks the size and
  the first bytes (`sniffProofType`; anything else is deleted and refused), and stores `proofBytes` and `proofType` in the
  same conditional write that submits the payment. A screenshot uploaded and then left out of the form is deleted.
- **Clean-up:** screenshots of payments never submitted (cancelled, replaced, closed after 48 hours) are removed by the
  daily renewals job (`sweepUnsubmittedProofs`, `proofsRemoved` in its result); submitted ones are kept as the record of
  the money; the account purge removes the whole `<userId>/` folder (`lib/account-deletion.ts`).
- **Admin:** `ManualPaymentAdminView.proofPath` (only once checked) → `proofSignedUrl()` on the Payments page. The confirm
  audit row records `transactionId`, `transactionIdBy: "admin"` when the owner typed it, and `screenshot: true|false`.

## The demo-first trial and Mobile Money

`docs/REGIONS.md` has the trial itself. What matters here:

- **Waiting for the demo** (`PENDING_DEMO`): the lock screen (`components/app/demo-lock.tsx`) offers **Pay for <plan>**
  to the Owner, with the same Mobile Money / Card choice as Billing (`components/app/demo-pay.tsx`, monthly). Mobile
  Money shows the pay screen in place; card opens the Paddle checkout and the webhook activates the plan. Confirming makes
  the company `ACTIVE` and the dashboard opens. **The demo booking is kept** (decided 12 October 2026): a paying client
  may still want the walk-through, so the booking stays `booked` and shows in Demos with the company badged "Paying";
  the owner holds it or marks it done / cancelled. The calendar invite still works for both sides.
- **On the trial** (`TRIALING`): the client pays from Billing as above. Trial-end reminders (a day before, last day) and
  the expiry to `EXPIRED` are the trial-reminders cron's (`lib/demo/trial-reminders.ts`, hourly), which only looks at
  `TRIALING` subscriptions without a card on file. The Mobile Money renewals cron only looks at `MANUAL_MOMO` +
  `ACTIVE`. The two never see the same subscription, so nobody gets two sets of emails.
- **Expired or paused** (`EXPIRED`, `PAST_DUE`): a confirmed payment starts a fresh period now and reopens the account.

## Settings (admin → Settings → "Payments: Mobile Money"; Payments shows them with a link)

Stored in `AdminSetting` key `billing.momo` (`MomoSettings` in `lib/billing/momo-shared.ts`), audited on every save:

| Field | Meaning |
|---|---|
| MoMo Pay merchant code | Shown first if present, as the MTN dial string `*182*8*1*<code>#` (the settings form previews it). BuPulse's code: 002450 |
| MTN MoMo number, Airtel Money number | Shown when there is no code, or beside it |
| Account name | What the client sees on their phone |

**Prices are not here.** What a Mobile Money client pays is the plan's price in the company's region
(`PlanRegionPrice`, Admin → Regions and prices, `docs/REGIONS.md`), read through `getMomoPrice()` / `momoPriceOf()`.
The **USD→RWF rate** that values Mobile Money revenue in dollars (and derives the card prices of RWF plans) is the one
pricing setting in Admin → Settings (`pricing.usdToRwf`, `lib/admin/settings.ts`). Rows written before 12 October 2026
may still carry `prices` and `usdToRwf` inside `billing.momo`; `cleanMomoSettings` ignores them.

A malformed code (not 4 to 12 digits) or number (not a phone number) is refused, never truncated. Every save is audited
with the stored values read inside the transaction, and every `ADMIN_EMAILS` address is emailed when the code or a number
changes.

Mobile Money is offered to clients only when a code or a number is filled in (`momoConfigured`) **and** the company's
region lists `momo` in its payment methods.

## Where things are

| | |
|---|---|
| Rules with no I/O (reference, period, reminders, money, settings shape, zod) | `lib/billing/momo-shared.ts` |
| The service (start, proof, cancel, confirm, reject, lists, badge count) | `lib/billing/momo.ts` |
| Settings (where clients pay) and the regional price lookup (`getMomoPrice`) | `lib/billing/momo-settings.ts` |
| Emails | `lib/billing/momo-emails.ts` |
| Daily job | `lib/billing/momo-renewals.ts`, `app/api/cron/momo-renewals/route.ts` |
| Method adapter interface and registry | `lib/billing/methods/` |
| Screenshots (private bucket: upload URL, check, signed URL, removal) | `lib/billing/momo-proofs.ts` |
| Client | `app/dashboard/billing/actions.ts` (`startMomoPayment`, `startMomoProofUpload`, `submitMomoProof`, `cancelMomoPayment`, `momoPaymentStatus`), `components/billing/momo-payment.tsx`, the method choice (`components/billing/pay-choice.tsx`, `lib/billing/pay-methods.ts`) in `plan-picker.tsx`, "Pay now" on the demo lock screen (`components/app/demo-pay.tsx`) |
| Admin | `app/admin/(console)/payments/` (queue, history, settings), badge in the sidebar, item in the Overview attention list |
| Jarvis | `list_momo_payments`, `get_momo_payment` (read only; confirming stays in the console) |
| Analytics | `BillingEvent` type `manual_payment.confirmed` is read by the roll-up (`MONEY_EVENT_TYPES`), the activity feed and the Client 360 billing tab |
| Tests | `tests/billing/momo-*.test.ts` |

## Adding an automatic provider (Paypack, Flutterwave, MTN)

The client flow and the admin page do not change; the provider confirms instead of the owner.

1. Add a `BillingProvider` value (e.g. `PAYPACK`) in `prisma/schema.prisma` with a migration (`ALTER TYPE ... ADD VALUE`).
2. Write `lib/billing/methods/paypack.ts` implementing `PaymentMethodAdapter` (`lib/billing/methods/types.ts`):
   `startPayment` can reuse `startManualPayment` and additionally ask the provider to push a payment request to the
   client's phone; `submitProof` may be a no-op; `confirm`/`reject` call `confirmManualPayment` / `rejectManualPayment`
   with a system context (`{ ...consoleContext(null), actor: "system:paypack" }` after relaxing `requireConsole` for
   that actor); `parseWebhook` verifies the signature and returns the reference and outcome.
3. Register it in `lib/billing/methods/index.ts`: `ADAPTERS.PAYPACK = paypack` and `WEBHOOK_SLUGS.paypack = "PAYPACK"`.
   `POST /api/billing/webhooks/paypack` then reaches the adapter (today every slug answers 404). Store each event in
   `BillingEvent` (unique on provider + event id) before acting, so retries run once, as the Paddle route does.
4. Add a Services card (`lib/admin/service-catalog.ts`) with its keys. Amounts keep coming from the regional prices.
