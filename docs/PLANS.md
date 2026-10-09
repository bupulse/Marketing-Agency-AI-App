# Plan builder

Plans live in the `PlanDefinition` table and are managed at `/admin/plans` (and by Jarvis: `list_plans`, `update_plan`, `update_plan_limits`, `change_plan`).
The pricing page, the in-app Billing page, checkout, usage limits, trial length and capability checks (API access) all read them through `lib/plan-catalog.ts` (`getPlans()`, `getPlan(key)`, cached 30 seconds, with the last good copy kept if the database blinks).

- `Subscription.plan` is the plan key as text (`TRIAL`, `STANDARD`, `PRO`, or any key you create). It has a foreign key to `PlanDefinition.key`.
- The `TRIAL` plan is special: it can be edited (length, limits, features) but not priced, hidden or retired.
- **Status:** `active` is for sale; `hidden` (draft) and `retired` are closed to new sign-ups. Clients already on them keep the plan, its limits and their price.
- **Env price ids:** `PADDLE_PRICE_<KEY>_<MONTH|YEAR>` (e.g. `PADDLE_PRICE_STANDARD_MONTH`) are still read as a fallback for any plan that has no Paddle price id in the database. They are the seed source for the original three plans. After the first price change, or "Sync with Paddle", the plan's ids are in the database and the env values only help map old subscriptions (the old ids are copied into the plan's price history).
- **Price changes:** Paddle prices are never edited. A change creates new prices, points the plan at them and schedules every live subscriber (`PlanPriceChange`, `PlanPriceChangeItem`). The daily cron `/api/cron/plan-price-changes` (04:29 UTC, `PLAN_PRICE_CRON` in `worker.ts` and `wrangler.jsonc`):
  - increase: emails the client (Resend) so the new price starts at least 30 days later (a renewal sooner than that waits for the one after), then, two days before that renewal, swaps the subscription item with `proration_billing_mode: "do_not_bill"`;
  - decrease: swaps two days before the next renewal, no email;
  - archives old Paddle prices when no subscription and no waiting move uses them.
- **Failure:** the plan is only changed after Paddle accepted the new prices; if anything fails nothing is changed and the error is shown on the plan page.
- Without `PADDLE_API_KEY` plans can be drafted and edited; prices of plans that already sell cannot be changed.

## Deploying the plan builder migration

Take a database backup (Supabase: Database > Backups, or a manual `pg_dump`) **before** deploying migrations `20261009095000_plan_builder`, `20261009095100_plan_builder_grants` and `20261009095200_plan_price_reminders`. The first one changes `Subscription.plan` from an enum to text (a table rewrite of `Subscription`), drops `PlanLimitOverride` (its rows are folded into the plans' limits) and drops the `Plan` enum. It runs in one transaction, so a failure leaves the database as it was, but it cannot be undone once applied; the backup is the way back.
