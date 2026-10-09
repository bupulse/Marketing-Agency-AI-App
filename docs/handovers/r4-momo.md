# R4 handover: manual Mobile Money payments

Built 9 October 2026 on branch `v2-momo`. How it works and how to extend it: `docs/MOMO.md`. Decisions: `docs/RWANDA_LAUNCH_PLAN.md` (R4).

## What works (tested locally, no database)
- **Data:** migration `20261009110000_manual_momo` adds `BillingProvider.MANUAL_MOMO`, `ManualPayment` and `RenewalNotice` (RLS on, grants revoked like the other internal tables). Owner settings live in `AdminSetting` key `billing.momo`.
- **Client (Billing page):** plan + period + "How would you like to pay?" (Card = existing Paddle checkout, Mobile Money = pay screen with amount in RWF, MoMo Pay code / numbers / account name, a `BP-XXXX` reference and three steps) → "I've paid" form (transaction id, phone, network; zod) → "Waiting for approval · usually a few minutes" (polls every 5 s) → rejected with reason and "Try again", or confirmed. One pending payment per company; Owner only (`billing` permission).
- **Admin → Payments:** badge with the number of submitted payments to check (sidebar and Overview attention list); queue with company, plan, amount, reference, transaction id, phone and times; Confirm / Reject with a reason. Both run as the owner's own decision (no approval queue), behind `adminAction()` (AAL2), refused over the API, audited, and safe to double-click. Confirm sets the subscription (provider `MANUAL_MOMO`, plan, `ACTIVE`, interval, period extended from a running MoMo period or started now, usage reset through the new period start), records a `BillingEvent` for revenue (USD at the owner's rate), tracks `upgrade` / `plan_change`, and emails "Your plan is active". Submitting a payment emails every `ADMIN_EMAILS` address and shows in the activity feed.
- **Settings panel on the same page:** merchant code, MoMo number, account name, Airtel number, RWF per USD, RWF prices per sellable plan (audited).
- **Renewals cron** `/api/cron/momo-renewals` (`41 5 * * *`, registered in `worker.ts`, `wrangler.jsonc`, `lib/admin/cron.ts` for the Health page): reminders 5 and 1 day before the end with a pay link and a WhatsApp-ready text, 3 days of grace, then `PAST_DUE` (existing paywall: read-only, nothing deleted) and a "paused" email. Idempotent through `RenewalNotice` claims; advisory lock; cursor.
- **Adapter:** `PaymentMethodAdapter` (`lib/billing/methods/types.ts`) with `manualMomo`; registry in `lib/billing/methods/index.ts`; webhook stub `POST /api/billing/webhooks/[provider]` answers 404 for every slug until a provider is registered.
- **Jarvis:** `list_momo_payments`, `get_momo_payment` (read only).
- **Guards:** a live card subscription blocks MoMo (cancel the card plan first); a paid-up MoMo plan blocks card checkout until its period ends; a late Paddle webhook cannot end a live MoMo plan.

## Tests
`tests/billing/momo-shared.test.ts` (reference, period maths incl. extension and yearly, reminder timing, money, settings, zod), `momo-service.test.ts` (one pending at a time, proof and admin alert, confirm/reject: console-only, audit, idempotency, period, revenue event, emails, apply guard), `momo-actions.test.ts` (roles, validation, admin actions call `adminAction`), `momo-renewals.test.ts` (5d/1d once, Resend off, failed send, grace → PAST_DUE, race with a confirmation, housekeeping, lock), `momo-routes.test.ts` (webhook 404, cron auth). `tests/admin/fake-db.ts` gained `manualPayment`, `renewalNotice`, `analyticsEvent` and composite-unique `createMany`.

## Not done / to decide
- **RWF prices** are in the MoMo settings (`billing.momo.prices`), with the USD price converted as the fallback. R1 should move them into per-region plan prices and point `getMomoPrice` at them.
- **Switching card → MoMo** is "cancel the card plan, pay by MoMo once it ends"; there is no automatic cancel-at-period-end of the Paddle subscription when a client chooses MoMo (the plan's R4 bullet). Easy to add in `startManualPayment` once the product wants it.
- **Trial on MoMo** (demo-first trial, reminders on days 2 and 3) belongs to the trial builder; the cron here only looks at `ACTIVE` MoMo subscriptions.
- **WhatsApp alerts** are emails with a copy-ready text until the WhatsApp Business plug-in exists.
- **Receipts:** MoMo clients have no invoice list (Paddle's is hidden for them); the confirmation email is the receipt.
- **Services card** for the automatic MoMo provider was not added (would change `SERVICE_IDS`, which other tests enumerate); add it with the provider.
- The migration has not been run against any database (the worktree's `.env` has no database on purpose). `next build` needs the Supabase/Paddle env to prerender some pages; see the build note in the report.
