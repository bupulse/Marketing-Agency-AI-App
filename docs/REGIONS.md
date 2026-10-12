# Regions, regional prices and the demo-first trial

Built 10 October 2026 (R1 of `docs/RWANDA_LAUNCH_PLAN.md`, plus section 12's demo-first trial). Handover: `docs/handovers/r1-regions-trial.md`.

## Regions

Regions are data: the `PricingRegion` table (`key`, `name`, `currency`, `countries[]` as ISO codes, `paymentMethods[]` = `momo` | `card`, `active`, `sortOrder`), managed at **Admin → Regions and prices** and read through `lib/region.ts` (`getRegions()`, cached 30 s, seeds in `lib/region-format.ts` as the fallback).

| Key | Countries | Currency | Payment |
|---|---|---|---|
| `RW` | RW | RWF | Mobile Money (R4) and card (Paddle, charged in USD) |
| `EAC` | KE, UG, TZ, BI, SS, CD, SO | USD | Card |
| `GLOBAL` | everything else (no country list) | USD | Card |

A country belongs to exactly one active region; the region with no countries takes the rest and cannot be switched off.

**Which region someone is in**

- **Public pages** (`/pricing`): `displayRegion()` = `?region=` (the "Not in Rwanda? See prices for …" switch; also local testing), then the `bp-region` cookie (`proxy.ts` copies `?region=` into it), then the IP country from Cloudflare's `cf-ipcountry` (`ANALYTICS_DEV_COUNTRY` stands in locally).
- **A company**: `Business.pricingRegion`, set at sign-up from the country field (`regionKeyForCountryName`: Rwanda → RW, the EAC list → EAC, else GLOBAL; also on `/welcome` for Google sign-ups). An admin changes it on the company page ("Change region", audited `update_company_region`). **Billing, checkout and the book-demo plan list always use the company region, never the IP** (`companyPlans(businessId)`).

## Prices per region

`PlanRegionPrice` (`planKey`, `regionKey`, `currency`, `monthlyMinor`, `yearlyMinor`, `cardMonthlyUsdCents`, `cardYearlyUsdCents`, `paddleMonthlyPriceId`, `paddleYearlyPriceId`). Amounts are in the currency's smallest unit (RWF has none: 15000 = 15,000 RWF; USD in cents). Read through `lib/region-prices.ts`:

- `getRegionPlans(regionKey)` → `RegionalPlan[]` (a `PublicPlan` with the region's amounts and `currency`, plus `paymentMethods` and, for a local-currency plan, `card` = the USD card price). A plan is **offered in a region only when it has a price there**; hidden and retired plans are never offered.
- **GLOBAL is the plan builder.** Its amounts are the plan's own `monthlyPriceCents` / `yearlyPriceCents` and its Paddle ids are the plan's own (the existing price-change flow with 30 days' notice keeps working). A GLOBAL row only means "offered here". A plan with no regional price at all (one an admin just created) is offered in GLOBAL at its own price, so the plan builder works as before.
- Seeded by the migration: GLOBAL rows for every paid plan that existed (Standard $49/$490, Pro $99/$990, …); EAC Standard $25/$250, Pro $49/$490; RW Starter 15,000/150,000 RWF, Business 35,000/350,000 RWF. The two Rwanda plans (`STARTER`, `BUSINESS`: text 60/200, image 30/100, seats 1/3, features content, designs, calendar, gallery) are active and priced only in RW, so they appear nowhere else. Their plan-level USD price is the derived card price, which keeps the plan builder's own checks happy.
- Money is formatted with `formatMinor(minor, currency)` (`lib/region-format.ts`): "15,000 RWF", "$49", "$49.50". `components/billing/helpers.ts` wraps it as `formatPrice` / `formatPlanPrice`.

**Card prices for RWF plans.** Two admin settings (**Admin → Settings**): USD→RWF rate (default 1,450) and card margin % (default 12). `cardUsdCents(minor, currency, rate, margin)` = amount ÷ rate × (1 + margin), rounded **up** to whole dollars: 15,000 RWF → $11.59 → **$12**; 35,000 → $27.03 → **$28** (the storyboard says $27: the rounding rule from the brief gives $28; change the margin to 11% if $27 is wanted). Saving a regional price computes and stores the card price; "Update card prices" recomputes every local-currency row after a rate change (audited `update_card_prices`) and clears their Paddle ids.

**Paddle (TODO).** Nothing here calls Paddle. The RW card prices and the EAC prices need their own Paddle prices (`PlanRegionPrice.paddle*PriceId`, or Paddle country `unit_price_overrides` on the plan's prices). Until they exist, `regionPriceIdFor()` returns null outside GLOBAL and checkout says "Card payments are not ready for your region yet. Pay by Mobile Money instead" (RW) or "Payments are not available right now" (EAC). Plan: a "Sync with Paddle" button on the Regions page that creates the prices (sandbox first) and, for a changed card price, moves subscribers through the existing `PlanPriceChange` flow. `BillingAdapter.checkoutConfig` already takes a `priceId` override.

## The demo-first trial (section 12)

No trial starts at sign-up, in any region. `SubscriptionStatus` has a new value, **`PENDING_DEMO`**; `ensureAccount` creates `{ plan: "TRIAL", status: "PENDING_DEMO", trialEndsAt: null }`. Existing companies are untouched.

1. **Choose a plan, book a demo** (`/book-demo`, owner or admin role). Step 1 lists the company region's plans (`choosePlan` → `Subscription.chosenPlan`). Step 2 lists free slots from the owner's availability (`bookDemo`). The dashboard redirects here while `PENDING_DEMO` and no plan is chosen (`components/app/context.ts`).
2. **Availability.** `AdminAvailability` rows (weekday, start and end minute, Africa/Kigali), seeded Monday–Friday 09:00–17:00; settings `demo.slotMinutes` (30), `demo.bufferMinutes` (15), `demo.blockedDates`, `demo.meetingLink` (the reusable Google Meet link). `lib/demo/slots.ts` (pure, Intl-based zone maths) cuts slots: inside a window, not on a blocked date, at least 2 hours ahead (`MIN_LEAD_MINUTES`), over the next 14 days, and not within the buffer of a live booking. `bookDemo` re-checks the slot and the partial unique index `DemoBooking_live_slot_key` (`startsAt` where status = booked) stops two clients taking the same minute.
3. **Emails and invites.** On booking, rescheduling and cancelling: one email to the client and one to every `ADMIN_EMAILS` address, with the time (Africa/Kigali), the meeting link, the chosen plan, a link to and an attachment of the `.ics` (`lib/demo/ics.ts`; served by `/api/demo/ics/[token]`, `DemoBooking.icsToken` is the secret). `sendEmail` gained optional `attachments` (Resend's base64 shape).
4. **Before the trial** the dashboard layout renders only `components/app/demo-lock.tsx`: "Your demo is on …", Join, Add to calendar, Reschedule (`/book-demo?step=time`), Cancel (both only up to 2 hours before, enforced in `lib/demo/bookings.ts`), the chosen plan and what happens next. Server side, while `PENDING_DEMO`: `lib/entitlements.ts` grants **no features** (every gated page, action and route answers "Add to your plan" / 403 / widget `not_in_plan`), `lib/usage.ts` throws `pending_demo` (402, the paywall dialog says "Your demo comes first"), and `/api/v1` keys see no `apiAccess`.
5. **Admin.** **Demos** page (upcoming / past / all, status filter): Mark done, No-show (with notes), **Start trial**. The same buttons and the region selector sit in the "Demo and trial" panel on the company page. Every action goes through `adminAction()` (allow-listed email + AAL2) and is audited (`update_demo`, `start_trial`, `update_company_region`). Jarvis read tools: `list_regions`, `list_region_prices`, `list_demos`.
6. **Start trial** (`lib/admin/demos.ts startTrial`): only from `PENDING_DEMO` with a chosen plan; sets `status = TRIALING`, `plan = TRIAL`, `trialEndsAt = now + trial days`, marks the live booking done, emails the client, records `trial_started`. **Trial length** is the setting `trial.days` (default **3**, Admin → Settings). `change_plan` to TRIAL uses the same setting. The TRIAL plan's `trialDays` column stays editable but drives nothing any more (kept so older builds and the plan form keep working); `getTrialInfo()` still reads it for anything legacy.
7. **During the trial** the company has the **chosen plan's features with the TRIAL plan's limits** (`featurePlanKey()` in `lib/entitlements.ts`; usage reads limits from `Subscription.plan` = TRIAL). A chosen plan that was retired since falls back to the TRIAL plan's features. `extend_trial` works as before. The client pays from Billing (the company region's plans); a paid plan sets `plan` to the bought key through the existing Paddle flow (MoMo: R4).
8. **Trial end** (`lib/demo/trial-reminders.ts`, hourly cron `TRIAL_CRON` = `53 * * * *` → `/api/cron/trial-reminders`, `CRON_SECRET`, listed in `lib/admin/cron.ts` for the health page). For trials without a card on file (`providerSubscriptionId` null: MoMo clients and anyone who never added a card): a reminder when a day is left (day 2 of a 3-day trial) and one on the last day (8 hours before the end), each recorded on the subscription (`trialReminder1SentAt` / `trialReminder2SentAt`) before sending, so at most once; nothing is claimed while Resend is off, and a failed send is retried next run. When `trialEndsAt` passes, the subscription becomes `EXPIRED` (audited as `system:cron`), the client gets "Your trial has ended", and the account is read-only through the existing paywall (`trial_expired`): nothing is deleted, paying reopens it. **Card clients (TODO, Paddle adapter):** at Start trial, open a Paddle checkout with a trial period so the card is on file and charged at the end unless cancelled; the webhooks then move the subscription to ACTIVE or CANCELED. Not implemented: no Paddle calls were added.

## Copy

"Start free trial" became "Book a free demo" everywhere (header, mobile menu, hero, final CTA, plan cards, industries, about, blog, sign-up and welcome forms, confirmation email page, FAQ "How do I get started?", terms section 3). The trial banner and billing page keep "free trial" wording for companies that are on one. Copy stays industry-neutral.
