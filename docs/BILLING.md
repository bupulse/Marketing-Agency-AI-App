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

## Environment variables

| Variable | Meaning |
| --- | --- |
| `BILLING_PROVIDER` | `PADDLE` (default) |
| `PADDLE_ENVIRONMENT` | `sandbox` (default) or `production` |
| `PADDLE_API_KEY` | Server API key (Paddle > Developer tools > Authentication) |
| `PADDLE_CLIENT_TOKEN` | Client-side token for Paddle.js (same page) |
| `PADDLE_WEBHOOK_SECRET` | Endpoint secret of the notification setting |
| `PADDLE_PRICE_<STANDARD\|PRO>_<MONTH\|YEAR>` | Price ids (`pri_...`), written by the setup script |

Sandbox and live are separate Paddle accounts with different keys, tokens and price ids.

## Setup (sandbox)

1. Create a Paddle sandbox account, then create an API key and a client-side token.
2. Put `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` and `PADDLE_ENVIRONMENT=sandbox` in `.env`.
3. Run `npm run paddle:setup -- --webhook-url https://bupulse.com/api/billing/webhooks/paddle`.
   It creates "BuPulse Standard" and "BuPulse Pro" with monthly and yearly USD prices matching
   `PRICES` in `lib/billing/catalog.ts`, creates the webhook endpoint, and writes the price ids and
   `PADDLE_WEBHOOK_SECRET` into `.env`. Re-running reuses what exists. Add `--print-secret` to also
   print the new endpoint secret. Without `--webhook-url`, only products and prices are created.
4. Copy the same variables into the Cloudflare Worker secrets.

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
