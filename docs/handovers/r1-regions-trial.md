# R1 handover: regions, regional prices and the demo-first trial

Built 10 October 2026 on branch `v2-r1` (worktree `~/BuPulse-v2-r1`), on top of R2 (features and entitlements). What it does and how it works: `docs/REGIONS.md`. Plans: `docs/PLANS.md`.

## Migrations (in this order)

1. `20261010100000_subscription_pending_demo`: `ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING_DEMO'`. On its own because Postgres refuses to use a new enum value inside the transaction that added it.
2. `20261010100100_regions_and_demos`: `Business.pricingRegion` (default GLOBAL, backfilled from the sign-up country), `Subscription.chosenPlan`, `trialReminder1SentAt`, `trialReminder2SentAt`; tables `PricingRegion`, `PlanRegionPrice`, `AdminAvailability`, `DemoBooking` (RLS on, revoked from anon / authenticated / service_role like the other internal tables; partial unique index `DemoBooking_live_slot_key`); seeds: the three regions, the `STARTER` and `BUSINESS` plans, GLOBAL rows copied from every existing paid plan, EAC and RW prices, Monday–Friday 09:00–17:00 availability.

Both add columns with defaults and new tables only: no rewrite, nothing dropped, existing companies keep plan, status, prices and trial. Neither was applied to any database from this worktree (`npx prisma generate` was run).

**Deploy order.** Back up, `npx prisma migrate deploy` (with `DIRECT_URL`), then the code. The code tolerates the gap: without the regions tables `lib/region.ts` serves the seed regions and `lib/region-prices.ts` serves no rows, so GLOBAL falls back to the plans' own prices and the other regions show nothing; `ensureAccount` would fail to write `pricingRegion` / `PENDING_DEMO` until the migrations have run, so **run them before** the new Worker takes traffic. Add the `53 * * * *` cron trigger (in `wrangler.jsonc`, deployed with the Worker). Set the owner's meeting link and availability in Admin → Settings before the first sign-up; `ADMIN_EMAILS` receives the booking emails.

## Files

- Pure: `lib/region-format.ts` (seeds, country → region, `formatMinor`, `cardUsdCents`, `currencyNote`), `lib/demo/slots.ts` (zone maths, `freeSlots`), `lib/demo/ics.ts`.
- Server: `lib/region.ts` (regions, display region, company region), `lib/region-prices.ts` (`RegionalPlan`, `getRegionPlans`, `companyPlans`, `regionPriceIdFor`), `lib/admin/settings.ts` (typed AdminSetting keys, audited), `lib/admin/regions-service.ts`, `lib/admin/availability.ts`, `lib/admin/demos.ts` (`listDemos`, `setDemoStatus`, `startTrial`, `demoPanel`), `lib/demo/bookings.ts` (`choosePlan`, `bookDemo`, `cancelDemo`, emails + invites), `lib/demo/trial-reminders.ts`.
- Changed: `lib/account.ts` (PENDING_DEMO, region), `lib/entitlements.ts` (`featurePlanKey`), `lib/usage.ts` (`pending_demo`), `lib/plan-catalog.ts` (`PublicPlan.currency`), `lib/publishing/email.ts` (attachments), `lib/billing/types.ts` + `paddle.ts` (`priceId` override), `lib/admin/service.ts` (statuses, trial setting), `lib/admin/tools.ts` (3 read tools), `lib/admin/cron.ts`, `worker.ts`, `wrangler.jsonc`, `proxy.ts` (`/book-demo` protected, `bp-region` cookie), `app/welcome/actions.ts`.
- App: `app/book-demo/*`, `components/demo/*`, `components/app/demo-lock.tsx` + `demo-cancel.tsx`, `app/dashboard/demo/actions.ts`, `app/dashboard/layout.tsx`, `components/app/context.ts` (`pendingDemo`, `chosenPlan`), `app/api/demo/ics/[token]/route.ts`, `app/api/cron/trial-reminders/route.ts`, `app/(marketing)/pricing/*`, `app/dashboard/billing/*`, `components/billing/{helpers,price-tag,plan-picker,upgrade-dialog}.tsx`, `components/marketing/pages/{plan-cards,plan-comparison}.tsx`, copy in the marketing, auth and legal pages, `lib/content/site.ts`.
- Admin: `app/admin/(console)/demos/*`, `settings/page.tsx` + `actions.ts`, `settings/regions/*`, `components/admin/demo-panel.tsx` (on the company page), `components/admin/nav.ts`, companies list status filter.
- Tests: `tests/regions/*`, `tests/demo/*`; `tests/admin/fake-db.ts` gained the new tables and nested relation filters.

## Decisions

- **The TRIAL plan stays the subscription's plan during the trial.** `Subscription.chosenPlan` carries the plan chosen at sign-up; entitlements use its features while TRIALING (`featurePlanKey`), limits stay the TRIAL plan's. Everything that checked `plan === "TRIAL"` (banner, extend trial, checkout, analytics) keeps working unchanged. The chosen plan has no foreign key so plans can be retired freely; a missing one falls back to the TRIAL plan's features.
- **Trial length = AdminSetting `trial.days` (default 3)**, used by Start trial and by `change_plan` to TRIAL. `PlanDefinition.trialDays` of the TRIAL plan is no longer used for sign-ups; it is left in place (not dropped, still editable) so nothing breaks.
- **GLOBAL prices are the plan builder's own** (one source of truth for USD prices and the Paddle price-change flow); only the other regions have their own amounts in `PlanRegionPrice`. The Regions page shows GLOBAL as read-only "from the plan builder".
- **Card price rounding is up to whole dollars**, as briefed: 35,000 RWF comes out at $28, not the storyboard's $27.
- **Reminders**: "a day before" and "last day (8 h before)"; for a 3-day trial that is day 2 and day 3. Trials shorter than 36 h get only the last-day one. Only for subscriptions with no `providerSubscriptionId`.
- **Expiry flips the status to EXPIRED** (audited) rather than relying on `trialEndsAt` alone, so the admin lists and analytics see it; `lib/usage.ts` still answers `trial_expired` first.
- Members (non-admin roles) of a pending company see the lock screen without reschedule / cancel; only `settings`-capable roles book.
- `/book-demo` is under `proxy.ts`'s protected paths; `/api/demo/ics/[token]` is public by token.

## Checks

`npx tsc --noEmit`, `npm run lint`, `npx vitest run` and `npx next build`: see the report in the final message of the build (results are recorded there, not here).

## Open items

- Paddle: create the RW card prices and the EAC prices (`PlanRegionPrice.paddle*PriceId`), and the card-at-trial-start flow (`docs/REGIONS.md`, "Paddle (TODO)"). Nothing calls Paddle today.
- R4 (manual MoMo) plugs into the same region data: `RegionalPlan.paymentMethods` contains `momo` for RW, and the RW amounts in RWF are the source of truth for the MoMo screen. Reconcile any `rwfMonthly` columns from the `v2-momo` branch against `PlanRegionPrice` at merge.
- The Starter and Business cards use plain highlights; R6 may want Rwanda-specific wording and the WhatsApp button.
- Google Calendar per-booking Meet links (R5 optional upgrade) would replace the single `demo.meetingLink` setting.
- The owner's availability is one weekly pattern; no per-date exceptions beyond blocked dates.
- Admin "Start trial" sends one email; there is no admin-side reschedule/cancel of a booking apart from marking it cancelled.
