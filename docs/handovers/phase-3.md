# Phase 3 handover: billing

Built 6 October 2026. Details: `docs/BILLING.md`.

## What works (tested against the Paddle sandbox with the test card)
- Trial user upgrades in the checkout overlay → plan active within ~2 s of Paddle's webhook (~25 s after paying);
  limits change immediately (10 → 100 text generations), trial ends.
- Switch Standard monthly → Pro yearly: prorated charge, plan and interval updated at once.
- Cancel → "Cancels on <date>", still active and still generating; Resume undoes it.
- Failed payment (signed `subscription.past_due` webhook for the real subscription) → PAST_DUE, red banner,
  `/api/generate` answers 402 `past_due`; recovery → ACTIVE again.
- Receipts listed on the billing page with fresh PDF links.
- Yearly prices: 12× monthly crossed out, yearly price, "17% off" (`components/billing/price-tag.tsx`).

## Provider-neutral
`lib/billing/types.ts` (BillingAdapter) — Paddle in `lib/billing/paddle.ts`; Stripe/PayPal plug in the same way and
`BILLING_PROVIDER` picks the provider for new checkouts (an admin-panel setting in Phase 8).

## Security (reviewed, all findings fixed)
Signed checkout user ids, no overwrite of a different live subscription (a duplicate is cancelled and flagged for a
refund), atomic out-of-order protection, unknown prices retried, account deletion cancels billing first.

## Sandbox state
- Products/prices created by `npm run paddle:setup`; ids in `.env`. Prices are quantity 1 only.
- The sandbox webhook points at a temporary tunnel URL that no longer exists. For local testing run
  `npx cloudflared tunnel --url http://localhost:3000` and `npm run paddle:setup -- --webhook-url <tunnel>/api/billing/webhooks/paddle`.

## For launch
- Live Paddle account approval (needs bupulse.com live with pricing, terms, privacy, refund policy).
- Live keys + `npm run paddle:setup -- --webhook-url https://bupulse.com/api/billing/webhooks/paddle` with
  `PADDLE_ENVIRONMENT=production`; set the live default payment link to https://bupulse.com/dashboard/billing.
- The live keys pasted in chat on 6 October should be deleted in the live Paddle account and recreated.
