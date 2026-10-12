# R1 handover: regions, regional prices and the demo-first trial

Built 10 October 2026 on branch `v2-r1` (worktree `~/BuPulse-v2-r1`), on top of R2 (features and entitlements); finished and merged with `v2` (R2 review fixes, R4 manual Mobile Money) on 12 October 2026. What it does and how it works: `docs/REGIONS.md`. Plans: `docs/PLANS.md`. Mobile Money: `docs/MOMO.md`.

## Migrations (in this order)

After `20261009110000_plan_features` (R2) and `20261009120000_manual_momo` (R4):

1. `20261010100000_subscription_pending_demo`: `ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING_DEMO'`. On its own because Postgres refuses to use a new enum value inside the transaction that added it.
2. `20261010100100_regions_and_demos`: `Business.pricingRegion` (default GLOBAL, backfilled from the sign-up country), `Subscription.chosenPlan`, `trialReminder1SentAt`, `trialReminder2SentAt`; tables `PricingRegion`, `PlanRegionPrice`, `AdminAvailability`, `DemoBooking` (RLS on, revoked from anon / authenticated / service_role like the other internal tables; partial unique index `DemoBooking_live_slot_key`); seeds: the three regions, the `STARTER` and `BUSINESS` plans, GLOBAL rows copied from every existing paid plan, EAC and RW prices, Monday–Friday 09:00–17:00 availability.

Both add columns with defaults and new tables only: no rewrite, nothing dropped, existing companies keep plan, status, prices and trial. Neither was applied to any database from this worktree (`npx prisma generate` was run).

**Deploy order.** Back up, `npx prisma migrate deploy` (with `DIRECT_URL`), then the code. The code tolerates the gap: without the regions tables `lib/region.ts` serves the seed regions and `lib/region-prices.ts` serves no rows, so GLOBAL falls back to the plans' own prices and the other regions show nothing; `ensureAccount` would fail to write `pricingRegion` / `PENDING_DEMO` until the migrations have run, so **run them before** the new Worker takes traffic. Add the `53 * * * *` cron trigger (in `wrangler.jsonc`, deployed with the Worker). Set the owner's meeting link and availability in Admin → Settings before the first sign-up; `ADMIN_EMAILS` receives the booking emails.

## Files

- Pure: `lib/region-format.ts` (seeds, country → region, `formatMinor`, `cardUsdCents`, `currencyNote`), `lib/demo/slots.ts` (zone maths, `freeSlots`), `lib/demo/ics.ts`.
- Server: `lib/region.ts` (regions, display region, company region), `lib/region-prices.ts` (`RegionalPlan`, `getRegionPlans`, `companyPlans`, `regionPriceIdFor`), `lib/admin/settings.ts` (typed AdminSetting keys, audited), `lib/admin/regions-service.ts`, `lib/admin/availability.ts`, `lib/admin/demos.ts` (`listDemos`, `setDemoStatus`, `startTrial`, `demoPanel`), `lib/demo/bookings.ts` (`choosePlan`, `bookDemo`, `cancelDemo`, emails + invites), `lib/demo/trial-reminders.ts`.
- Changed: `lib/account.ts` (PENDING_DEMO, region), `lib/entitlements.ts` (`featurePlanKey`), `lib/usage.ts` (`pending_demo`), `lib/plan-catalog.ts` (`PublicPlan.currency`), `lib/publishing/email.ts` (attachments), `lib/billing/types.ts` + `paddle.ts` (`priceId` override), `lib/admin/service.ts` (statuses, trial setting), `lib/admin/tools.ts` (3 read tools), `lib/admin/cron.ts`, `worker.ts`, `wrangler.jsonc`, `proxy.ts` (`/book-demo` protected, `bp-region` cookie), `app/welcome/actions.ts`.
- App: `app/book-demo/*`, `components/demo/*`, `components/app/demo-lock.tsx` + `demo-cancel.tsx` + `demo-pay.tsx` (Pay by Mobile Money from the lock screen), `app/dashboard/demo/actions.ts`, `app/dashboard/layout.tsx`, `components/app/context.ts` (`pendingDemo`, `chosenPlan`), `app/api/demo/ics/[token]/route.ts`, `app/api/cron/trial-reminders/route.ts`, `app/(marketing)/pricing/*`, `app/dashboard/billing/*`, `components/billing/{helpers,price-tag,plan-picker,upgrade-dialog}.tsx`, `components/marketing/pages/{plan-cards,plan-comparison}.tsx`, copy in the marketing, auth and legal pages, `lib/content/site.ts`.
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

## Integration with R4 (manual Mobile Money), 12 October 2026

`v2` (with R4) was merged into `v2-r1`. Conflicts and how they were resolved:

- `prisma/schema.prisma`: `PlanDefinition` gets both relations (`regionPrices`, `manualPayments`); the R1 models follow. Migrations stay in date order: R2 `20261009110000` < R4 `20261009120000` < R1 `20261010100000` / `100100`. `npx prisma generate` was run; nothing was applied to a database.
- `worker.ts`, `wrangler.jsonc`, `lib/admin/cron.ts`: both crons kept (`41 5 * * *` momo-renewals, `53 * * * *` trial-reminders); `tests/worker-crons.test.ts` checks the two files agree.
- `tests/admin/fake-db.ts`: both sets of tables; `findUnique` / `findFirst` / `findMany` now attach a row's `business` (by `businessId`) and `user` (by `userId`) when a `select` / `include` asks for them, which the demo list and the trial reminders need.
- `app/dashboard/billing/page.tsx`, `components/billing/plan-picker.tsx`: R1's regional plans (`companyPlans`) carry R4's payment-method dialog. Mobile Money is offered only when the company's region lists `momo` **and** the owner has filled in where to pay; the MoMo amount of a plan is its regional price (`momoPriceOf`), the card amount its derived USD price.

**One source of truth for RWF prices.** `MomoSettings` lost `prices` and `usdToRwf` (old rows still carrying them are ignored by `cleanMomoSettings`). `getMomoPrice(businessId, plan, interval)` reads the company region's `RegionalPlan` (`PlanRegionPrice`); `startManualPayment` refuses, before writing anything, a plan not offered in the region or a region without Mobile Money. The USD value of a confirmed payment for the revenue roll-up uses the pricing setting `usdToRwf` (Admin → Settings), the same rate the card prices use. The admin Payments settings panel keeps merchant code, numbers and account name only, and points to Regions and prices / Settings. Renewal reminders quote the current regional price, or what the client paid last time when the plan is no longer offered in their region.

**Trial end.** The trial-reminders cron looks only at `TRIALING` subscriptions without a card on file; the momo-renewals cron only at `MANUAL_MOMO` + `ACTIVE`. No subscription is ever in both sets, so no duplicate emails. A `PENDING_DEMO`, `TRIALING`, `EXPIRED` or `PAST_DUE` company that pays by Mobile Money becomes `ACTIVE` on the plan it paid for when the owner confirms (test in `tests/billing/momo-service.test.ts`); the lock screen offers "Pay for <plan> by Mobile Money" so paying need not wait for the demo.

**Fix list (`docs/RWANDA_LAUNCH_PLAN.md`, section 13).**

1. Home page: the placeholder testimonials section is gone (`components/marketing/home/testimonials.tsx` deleted, `testimonials` removed from `lib/content/site.ts`; bring it back with real quotes). The hero scene's "[your.shop]", "[Product photo]", "[Phone model]", "[offer]" and "[Visitor name]" are realistic example text. The remaining bracketed placeholders are legal ones in the terms, privacy and data-deletion pages ("[Company legal name], [Address]", "[State]"): they need the owner's legal entity and were left as they are (see Open items).
2. Autopilot posting times: the planner's `slot()` put the learning profile's best hours (local hours of past posts that did well) **before** the owner's posting times, so a history that did well at 11:00 Kigali (posts seeded at 09:00 UTC) made it post at 11:00 and 20:00 local although the settings said 09:00 and 18:00, which looked like a two-hour zone shift. Learned hours now only order the owner's posting times; they never add hours. Tests: `tests/autopilot/planner.test.ts`, "keeps the owner's posting times in Africa/Kigali …" and "… in a zone behind UTC (America/Sao_Paulo)". `zonedToUtc` itself was right. (`Business.timezone` defaults to "UTC" and is set from the browser on the first dashboard visit, `components/publishing/auto-timezone.tsx`; a business whose owner never opened the dashboard is planned in UTC: worth setting the zone from the sign-up country one day.)
3. Dashboard "Designs" card: counts `Design` rows of the company.

Also fixed while making the checks green: `lib/demo/slots.ts` `freeSlots` covered `days + 1` days (now exactly `days`) and `formatSlot` / `formatSlotDay` / `formatSlotTime` are built from `formatToParts` so the text is the same whatever the ICU version ("Tuesday 13 October 2026, 10:00"); R1's own tests had a few wrong expectations (ICS folding, audit count, trial expiry in the second run) and an untyped email mock that failed `tsc`.

## Checks

Run on 12 October 2026 in the worktree after the merge with `v2` (no database; `.env` has empty database values on purpose, nothing was migrated):

| Check | Result |
|---|---|
| `npx next typegen` | ok |
| `npx tsc --noEmit` | clean (exit 0) |
| `npm run lint` | clean: 0 errors, 0 warnings |
| `npx vitest run` | 137 files passed, 9 skipped; 1712 tests passed, 69 skipped; 0 failed (the jpeg / carousel timing tests passed first time) |
| `npx next build` | compiled, 89 static pages generated, exit 0 |

New or changed tests: `tests/billing/momo-*.test.ts` (regional prices, PENDING_DEMO / EXPIRED → ACTIVE on confirm, reminder amount fallback, settings without prices), `tests/autopilot/planner.test.ts` (posting times in Africa/Kigali and America/Sao_Paulo with a learned profile), `tests/demo/*` and `tests/regions/region-prices.test.ts` (R1's own, now passing and type-clean), `tests/admin/fake-db.ts` (relations on select / include).

## Open items

- Paddle: create the RW card prices and the EAC prices (`PlanRegionPrice.paddle*PriceId`), and the card-at-trial-start flow (`docs/REGIONS.md`, "Paddle (TODO)"). Nothing calls Paddle today.
- Legal placeholders on the public pages (`app/(marketing)/terms`, `privacy`, `data-deletion`: "[Company legal name], [Address]", "[State]", "[County, State]") need the owner's legal entity and governing law; nothing was invented.
- `Business.timezone` is only set from the browser on the first dashboard visit; Autopilot plans a business whose owner never opened the dashboard in UTC. Setting it from the sign-up country (Rwanda → Africa/Kigali) at `ensureAccount` would close that gap.
- Confirming a Mobile Money payment of a `PENDING_DEMO` company leaves its demo booking as it is; the owner may still hold the call or mark it done / cancelled from Demos.
- The Starter and Business cards use plain highlights; R6 may want Rwanda-specific wording and the WhatsApp button.
- Google Calendar per-booking Meet links (R5 optional upgrade) would replace the single `demo.meetingLink` setting.
- The owner's availability is one weekly pattern; no per-date exceptions beyond blocked dates.
- Admin "Start trial" sends one email; there is no admin-side reschedule/cancel of a booking apart from marking it cancelled.
