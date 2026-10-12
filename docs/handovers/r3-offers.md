# R3 / R5 handover: custom plans, offers and custom plan requests

Built 13 October 2026 on branch `v2-offers` (worktree `~/BuPulse-v2-offers`, from `v2`). Not pushed, not merged. No
database was touched: the migration was written and `npx prisma generate` was run. How it works: `docs/OFFERS.md`.

## What works (tested locally, no database)

- **Add-on prices** per region (Admin → Money → Add-on prices), audited; Rwanda seeded from launch plan section 4.
- **Customise plan** on the company page → editor with live total, prerequisites, limits in blocks, Managed tier,
  monthly/yearly, rounding/discount with a reason, client preview, Save draft / Save and send. **Offers** list and page
  with Withdraw.
- **Client**: offer card on Billing and on the demo lock screen, dashboard banner; Accept → Mobile Money (existing pay
  screen, offer-linked payment) or invoice (issued and emailed at once). Card shows "Ask us for a card link" (seam:
  `offerCardCheckoutAvailable()`).
- **Activation** inside the Mobile Money confirmation (also Mark as paid): subscription on the custom plan, fresh period,
  offer paid, older custom plans retired, other open offer invoice voided; once only.
- **Requests** (`/custom-plan`, protected): from pricing, Billing, demo screen, Add to your plan; admin email; 3/day per
  company; Admin → Plan requests (badge) → Customise plan prefilled.
- **Jarvis**: `list_offers`, `list_plan_requests`, `create_offer` (approval kind `create_offer`; exempt from the Paddle
  switch).

## Migration

`20261013120000_custom_plan_offers` (after `20261013110000_knowledge_base_2`): `PlanDefinition.isCustom` / `businessId`
(FK SET NULL); tables `AddonPrice`, `PlanOffer` (status/amount/method CHECKs, partial unique one sent-or-accepted per
company, unique `customPlanKey`), `CustomPlanRequest` (FK CASCADE so a deleted company takes contact details with it);
`ManualPayment.offerId` (FK SET NULL) with partial unique one live payment per offer; RLS on and `REVOKE ALL` for the
three tables; RW add-on price seeds (`ON CONFLICT DO NOTHING`). Additive only. Deploy order: back up, `prisma migrate
deploy`, then the code (the new code reads `ManualPayment.offerId` and `PlanDefinition.isCustom`).

## Decisions

- The custom plan row is **prepared at accept** (hidden, nobody on it), not at payment: `ManualPayment.planKey` and
  `Invoice.planKey` must point at an existing plan. It is switched on (subscription moved) only on confirmation.
- Accepted offers do not expire (the client may have paid); only sent ones do, lazily on read (no cron).
- Plan name is "Custom" (emails read "Your BuPulse Custom plan is active"). Its other interval's price is derived
  (yearly = 10 months; monthly = yearly / 10 rounded up) for renewals.
- Invoice VAT follows the invoice settings (default none), as for activation invoices.
- No EAC/GLOBAL add-on prices are seeded (the plan gives none). Extra social channel is not an add-on (no such limit).

## Checks (13 October 2026)

| Check | Result |
|---|---|
| `npx next typegen` | ok |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npx vitest run` | 189 files passed, 10 skipped; 2290 tests passed, 70 skipped, 0 failed |
| `npx next build` | compiled, 110 pages generated (slow: some route builds retried under load) |

Tests: `tests/offers/shared.test.ts` (totals per region, yearly, blocks, missing prices, prerequisites, removal
blocking, statuses, expiry, request validation), `service.test.ts` (add-on prices audit, save/send/replace, client
isolation, expiry, accept → MoMo → activate, accept → invoice → activate, idempotency and replays, replacement of an
older custom plan, withdraw, renewals, Jarvis approval, requests and rate limit), `actions.test.ts` (adminAction first,
Owner-only accept, billing permission on the form). `tests/admin/fake-db.ts` gained the new tables and two partial
unique indexes.

## Open items

- Card payment of an offer (Paddle one-off price) — see `docs/OFFERS.md`, "Card".
- A visitor from the pricing page signs in/up first; the `next=/custom-plan` return is only kept on sign-in.
- Admin notice on Payments does not say a payment is for an offer (the plan column shows "Custom").
- MRR in the plan builder ignores custom plans (they are left out of that list); the revenue roll-up still counts them.
