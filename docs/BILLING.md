# Billing

Mobile Money payments made by hand (Rwanda) are a separate flow beside the card checkout: `docs/MOMO.md`.

BuPulse bills through a payment provider behind one interface, `BillingAdapter` (`lib/billing/types.ts`).
Paddle is the first adapter (`lib/billing/paddle.ts`); Stripe and PayPal will add their own and be
registered in `lib/billing/index.ts`. The rest of the app never talks to a provider directly.

## How it works

1. The browser opens Paddle's checkout with `checkoutConfig()` (Paddle.js). Our user id is sent as
   `custom_data.userId`.
2. Paddle sends signed webhooks to `POST /api/billing/webhooks/paddle`. The route verifies the
   signature, stores the event in `BillingEvent` (unique on provider + event id, so retries are
   processed once) and calls `applyProviderSubscription`, which updates the user's `Subscription`.
3. The database is updated only from webhooks and from the result of actions (cancel, resume, change plan).

Decisions:

- Trial users who upgrade pay immediately; the paid period starts at checkout.
- Cancelling keeps the plan active until the period end (`cancelAtPeriodEnd`); resume clears it.
- Plan changes are prorated and charged immediately; if the payment fails the change is not applied.
- A failed payment (`past_due`) limits the account: nothing is deleted, no new generations.
  A Paddle `paused` subscription is treated the same way (PAST_DUE) and recovers on resume.
  **Never pause subscriptions** in the Paddle dashboard: updating the card does not resume a paused
  subscription, and the app has no "resume paused" button. Cancel (at period end) instead.
- Webhooks older than 5 minutes, or with a bad signature, get 401. Events for unknown users or
  prices are stored and acknowledged (200) with an "ignored" note. Processing errors return 500 so
  Paddle retries.
- Invoices: `listInvoices` returns `url: null` because Paddle's PDF links expire after an hour. Use
  `invoiceUrl(transactionId)` from `lib/billing/paddle.ts` when the customer clicks "Download".

## Choosing how to pay

Every pay entry point (Billing plans, the demo lock screen, a custom plan offer, an invoice on Billing or the invoice lock
screen; the trial-ended and paused screens lead to Billing) asks **Mobile Money (MTN / Airtel)** or **Card** wherever
the company's region lists both (`PricingRegion.paymentMethods`; RW). `lib/billing/pay-methods.ts` decides, per plan and
interval: a listed method is `ready`, or `soon` (shown disabled: "Card payments coming soon", "Mobile Money coming soon"),
never hidden; an unlisted one is `off`. A card-only region opens the checkout in one click.

Card is `ready` when (`lib/billing/card-ready.ts`, computed on the server before the page renders):

1. the provider is configured: `BILLING_PROVIDER` (unset = `PADDLE`, which is what you want; setting it explicitly to
   `PADDLE` changes nothing) with an API key, a client-side token **and** a webhook secret, saved in Admin → Settings →
   Card payments (below) or as `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`;
2. Paddle is switched on in Admin → Services;
3. the plan has a Paddle price for the company's region and interval (`regionPriceIdFor`): in GLOBAL the plan's own ids
   (Admin → Plans → sync, or `PADDLE_PRICE_<PLAN>_<MONTH|YEAR>`); in Rwanda and EAC `PlanRegionPrice.paddleMonthlyPriceId`
   / `paddleYearlyPriceId`, written by `npm run paddle:setup -- --regions` (below). Admin → Regions and prices shows
   "Ready" or "Not in Paddle" per row.

Why the choice was missing (13 October 2026): the dialog only opened when Mobile Money was set up (merchant code or a
number in Admin → Payments); otherwise "Upgrade" went straight to card, which in Rwanda always failed ("Card payments
are not ready for your region yet") because nothing ever wrote the RW Paddle price ids. `BILLING_PROVIDER` being unset
was not a cause (it defaults to Paddle).

Card routes: plans → `startCheckout` (auto-renewing Paddle subscription, activated by the webhooks); invoices → the
same checkout for the invoice's plan and interval ("Pay online" in the invoice email links to Billing; a custom plan's
invoice shows card disabled with "ask us for a card link"); offers and added features → "Ask us for a card link"
(Paddle cannot take a custom price, `docs/OFFERS.md`). Renewals: "Renewing" below.

## Renewing (decided 13 October 2026)

`lib/billing/renewal.ts` (pure; the Billing page, the server actions, the card webhook and the tests share it):

- **Card that renews by itself** (Paddle, not cancelled): Billing says "Renews automatically on <date>"; there is no
  manual renew button.
- **Anything else** (a Mobile Money plan, or a card plan cancelled at its period end): before the last 7 days
  (`RENEWAL_WINDOW_DAYS`) Billing says "Your plan is paid until <date>. You can renew from <date − 7 days>" and shows no
  renewal. In the last 7 days (and after the end, past due) it shows **Renew with Mobile Money** and **Renew with card**
  side by side; a method that is not ready stays visible, disabled, with its reason ("Mobile Money coming soon", "Card
  payments coming soon", a custom plan: "ask us for a card link").
- **No day is lost.** Mobile Money extends from the period end (`planManualPeriod`, mode `extend`). Card for a Mobile
  Money plan opens the checkout; when its webhook arrives inside the window, `applyProviderSubscription` lets the card
  subscription take over (outside it, it is still a `duplicate`) and moves its first renewal to one period after the
  Mobile Money end (`BillingAdapter.deferNextBilling`, Paddle `PATCH /subscriptions/{id}` with `next_billed_at` and
  `proration_billing_mode: do_not_bill`). If that call fails the card plan is still on and `ErrorLog`
  `billing.carry_over` says so (credit the days by hand). Card for a card plan cancelled at its end = resume it.
- **The server refuses early renewals** with the same sentence: `startManualPayment` (the same plan and interval; a
  switch to another plan is not a renewal) and `startCheckout` (any card checkout on a paid-up Mobile Money plan).

## Connecting Paddle (Admin → Settings → Card payments)

No environment variable needs editing. In Admin → Settings → **Card payments (Paddle)** (AAL2, every save audited):

1. Choose **Sandbox** or **Live** and paste the **API key** (`pdl_sdbx_apikey_…` / `pdl_live_apikey_…`) and the
   **client-side token** (`test_…` / `live_…`) from Paddle > Developer tools > Authentication. A value for the other
   environment is refused. **Test connection** checks the typed (or saved) key with a read-only call (`GET /event-types`).
2. **Save.** Each value is encrypted with `ENCRYPTION_KEY` (`lib/crypto.ts`, like the Google Calendar token) in
   `AdminSetting` `billing.paddle` and never shown again: the page shows its last 4 characters and where it comes from.
   An empty field keeps the saved value. The first save needs the API key and the client-side token together, and every
   save checks the values that will be in use afterwards (saved, typed or environment variable) against the chosen
   environment, so a sandbox key never runs with a live token. Switching sandbox ↔ live needs that account's key and token (and drops the old
   webhook secret). The audit row records the environment and the last 4 characters only.
3. **Set up prices** (`setUpPaddleStep`, `lib/billing/paddle-setup.ts`; the page runs it step by step so every request
   stays inside the hosting time limit: `plans` two at a time, `regions` four prices at a time, then `webhook`, each
   repeated while it answers `more`; a plan that fails is not retried in the same run; each step is audited): every plan without Paddle prices is synced (the
   plan builder's own sync: product, monthly and yearly price), every regional card price gets its USD Paddle prices
   (Rwanda, EAC; ids in `PlanRegionPrice`), and the notification destination `<site>/api/billing/webhooks/paddle` is
   created or updated with every event BuPulse handles (`PADDLE_EVENTS` in `scripts/paddle-sync.mjs`, incl.
   `transaction.completed`, `adjustment.created`, `adjustment.updated`); the secret Paddle returns is saved encrypted.
   Idempotent (stopping half-way and running again carries on); audited `paddle_set_up` per step. Problems (e.g. Paddle refusing a localhost URL) are listed, the rest still runs.
4. The **status line** says "Card payments: ready" or "not set up — <reason>" (missing values, Paddle switched off in
   Admin → Services, no plan priced), and how many plans have a card price per region. Card is offered to clients as
   soon as it is ready, with no deploy (caches: 30 s).

**Precedence:** per value, the one saved in Settings wins; a value not saved there falls back to its `PADDLE_*`
variable. The environment goes with the saved API key; without a saved key, `PADDLE_ENVIRONMENT` (default sandbox).
**Remove saved values** returns to the variables. The saved values are cached 5 s per instance, so a change reaches every
instance within seconds. A saved value that cannot be decrypted (ENCRYPTION_KEY changed) is logged to ErrorLog
(`billing.paddle.config`) and its variable, if any, applies: save it again. The webhook URL comes from
`NEXT_PUBLIC_SITE_URL` (`siteUrl()`), never from the request's host. The Services page counts Paddle as configured when Settings has all
three values. `lib/billing/paddle-config.ts` (`getPaddleConfig`) is the one reader; `paddleApi`, checkout, webhooks,
the plan builder, the service test and the Approvals links all use it.

## Environment variables

All `PADDLE_*` values are optional when Paddle is connected in Admin → Settings (above); they are the fallback.


| Variable | Meaning |
| --- | --- |
| `BILLING_PROVIDER` | `PADDLE` (default) |
| `PADDLE_ENVIRONMENT` | `sandbox` (default) or `production` |
| `PADDLE_API_KEY` | Server API key (Paddle > Developer tools > Authentication) |
| `PADDLE_CLIENT_TOKEN` | Client-side token for Paddle.js (same page) |
| `PADDLE_WEBHOOK_SECRET` | Endpoint secret of the notification setting |
| `PADDLE_PRICE_<STANDARD\|PRO>_<MONTH\|YEAR>` | Price ids (`pri_...`), written by the setup script |

Sandbox and live are separate Paddle accounts with different keys, tokens and price ids.

## Setup from the command line (sandbox), the alternative to Settings

1. Create a Paddle sandbox account, then create an API key and a client-side token.
2. Put `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` and `PADDLE_ENVIRONMENT=sandbox` in `.env`.
3. Run `npm run paddle:setup -- --webhook-url https://bupulse.com/api/billing/webhooks/paddle`.
   It creates "BuPulse Standard" and "BuPulse Pro" with monthly and yearly USD prices matching
   `PRICES` in `lib/billing/catalog.ts`, creates the webhook endpoint, and writes the price ids and
   `PADDLE_WEBHOOK_SECRET` into `.env`. Re-running reuses what exists. Add `--print-secret` to also
   print the new endpoint secret. Without `--webhook-url`, only products and prices are created.
4. Regional card prices (Rwanda's RWF plans charged in USD, EAC): `npm run paddle:setup -- --regions` with
   `DIRECT_URL` or `DATABASE_URL` pointing at the app's database. It creates a USD price per region row and interval on
   the plan's Paddle product (tagged `custom_data.regionKey`), reuses an identical one, and writes the ids into
   `PlanRegionPrice` (`scripts/paddle-sync.mjs`). Run it again after a regional price or the USD rate changes (that
   clears the ids). Card then shows as ready within a minute (caches).
5. Copy the same variables into the hosting secrets (Netlify / Cloudflare).

## Going live

1. Paddle approves live accounts only after review of a live website that shows pricing, terms of
   service, privacy policy and a refund policy.
2. In the live account create a new API key and client token, set `PADDLE_ENVIRONMENT=production`,
   and run `npm run paddle:setup -- --webhook-url https://bupulse.com/api/billing/webhooks/paddle`
   again (live ids differ from sandbox ones).
3. Update the Cloudflare secrets with the live values and redeploy.

## Testing webhooks locally

Expose the dev server and point a sandbox notification setting at it:

```
npx cloudflared tunnel --url http://localhost:3000
npm run paddle:setup -- --webhook-url https://<tunnel-host>/api/billing/webhooks/paddle
```

Paddle's webhook simulator (Developer tools > Simulations) can also replay events. Each distinct
destination URL gets its own secret, so keep the matching `PADDLE_WEBHOOK_SECRET` locally.

## Known behaviour
- Usage windows are counted from `currentPeriodStart`. If Paddle starts a new billing period when a
  customer switches between monthly and yearly, their monthly usage starts again from zero. They pay the
  prorated difference at that moment, so this is accepted; check it in the sandbox before going live.
- A second paid subscription for the same account (two checkouts at once) is cancelled immediately by the
  webhook and logged in `ErrorLog` with source `billing.duplicate`: refund that payment in Paddle.
- A webhook with a price BuPulse doesn't know (usually a missing `PADDLE_PRICE_*` setting) is not marked
  processed and returns 500, so Paddle retries it after the setting is fixed.
- Checkout custom data carries a server signature of the user id (`lib/billing/signing.ts`, key
  `BILLING_SIGNING_SECRET` or `ENCRYPTION_KEY`); webhooks ignore user ids without a valid signature.
