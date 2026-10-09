# Mobile Money payments (manual, with an automatic provider plug-in point)

Clients in Rwanda pay with MTN MoMo or Airtel Money, by hand. BuPulse shows them what to pay and where, they pay on
their phone and say so, and the owner checks the Mobile Money message and confirms in the admin console. Nothing
renews by itself; reminders and a short grace period replace automatic renewal. Card payments (Paddle) are unchanged.

Decided in `docs/RWANDA_LAUNCH_PLAN.md` (sections 2, 5 and R4). Built on 9 October 2026 (`docs/handovers/r4-momo.md`).

## The flow

1. **Choose.** On Billing the client picks a plan and monthly or yearly, then **Card** or **Mobile Money (MoMo / Airtel)**.
   The choice only appears once the owner has filled in where to pay (below). Only the company Owner can pay.
2. **Pay.** `startManualPayment` creates one `ManualPayment` (status `pending`) with the plan's RWF price and a reference
   such as `BP-7K3Q` (no 0/O/1/I). The card shows the amount, the MoMo Pay code or numbers, the account name, the
   reference and three steps. One open payment per company: starting again returns it; picking another plan before
   paying replaces it (the old one becomes `expired`).
3. **I've paid.** The client types the transaction id, the phone they paid from and the network (checked with zod, in
   the browser and again on the server). `submittedAt` is set once; every `ADMIN_EMAILS` address gets "New MoMo
   payment to check"; the Payments badge in the admin sidebar counts it; the activity feed shows it.
4. **Waiting.** "Waiting for approval · usually a few minutes" polls `momoPaymentStatus` every 5 seconds and refreshes
   the page when the owner decides.
5. **Confirm** (admin → Payments). In one transaction: the payment is claimed (`pending` → `confirmed`, so a second click
   is refused), the subscription becomes `provider MANUAL_MOMO`, the paid plan, `ACTIVE`, the interval, the new period
   (`currentPeriodStart/End`; card ids cleared), a `BillingEvent` (`manual_payment.confirmed`, with the USD value at the
   owner's rate) is written for revenue, and an audit row with before and after. Then the `upgrade` / `plan_change`
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
   subscriptions, a reminder email 5 days and 1 day before `currentPeriodEnd` (amount, where to pay, a "Pay now" link
   and a WhatsApp-ready text the client can copy), 3 days of grace, then `PAST_DUE` (the existing paywall makes the
   account read-only, nothing is deleted) and a "plan is paused" email. Each email is claimed first in `RenewalNotice`
   (unique per user, period end and kind), so it is never sent twice; a failed send gives the claim back. No reminder
   while a submitted payment waits for the owner. Payments started but never submitted are closed after 48 hours.
   Runs under an advisory lock with a cursor, like the price-change job.

Switching method: a card subscription that still renews blocks a MoMo payment; once the client has cancelled it
(`cancelAtPeriodEnd`, active until its period end) a MoMo payment of the same plan starts from that end. A paid-up MoMo
plan blocks card checkout until its period has ended. A late Paddle webhook can never end a paid-up Mobile Money plan
(`lib/billing/apply.ts`: ACTIVE with the period end in the future); a new live card subscription on top of one is a
duplicate, like a second card purchase, while a past-due or lapsed MoMo plan is simply replaced by it.

## Settings (admin → Payments → "Where clients pay")

Stored in `AdminSetting` key `billing.momo` (`MomoSettings` in `lib/billing/momo-shared.ts`), audited on every save:

| Field | Meaning |
|---|---|
| MoMo Pay merchant code | Shown first if present |
| MTN MoMo number, Airtel Money number | Shown when there is no code, or beside it |
| Account name | What the client sees on their phone |
| RWF per USD | Converts plans without an RWF price (rounded to 100 RWF) and values MoMo revenue in USD for the roll-up (default 1,450) |
| RWF prices per plan | Monthly and yearly, whole francs. Empty = converted USD price. **R1 (regions) folds these into per-region plan prices**; until then this is the one place RWF prices live (`getMomoPrice`) |

A malformed code (not 4 to 12 digits) or number (not a phone number) is refused, never truncated. Every save is audited
with the stored values read inside the transaction, and every `ADMIN_EMAILS` address is emailed when the code or a number
changes.

Mobile Money is offered to clients only when a code or a number is filled in (`momoConfigured`).

## Where things are

| | |
|---|---|
| Rules with no I/O (reference, period, reminders, money, settings shape, zod) | `lib/billing/momo-shared.ts` |
| The service (start, proof, cancel, confirm, reject, lists, badge count) | `lib/billing/momo.ts` |
| Settings and RWF prices | `lib/billing/momo-settings.ts` |
| Emails | `lib/billing/momo-emails.ts` |
| Daily job | `lib/billing/momo-renewals.ts`, `app/api/cron/momo-renewals/route.ts` |
| Method adapter interface and registry | `lib/billing/methods/` |
| Client | `app/dashboard/billing/actions.ts` (`startMomoPayment`, `submitMomoProof`, `cancelMomoPayment`, `momoPaymentStatus`), `components/billing/momo-payment.tsx`, the method dialog in `plan-picker.tsx` |
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
4. Add a Services card (`lib/admin/service-catalog.ts`) with its keys, and set its RWF price source if it differs.
