# Custom plans, offers and requests

Steps R3 and R5 of `docs/RWANDA_LAUNCH_PLAN.md`. A company can get a private plan with only what it needs: the admin
builds an offer from the company region's prices, the client accepts and pays it on Billing, and confirming the
payment switches the plan on.

## Add-on prices

- **The list of add-ons is code** (`ADDONS` in `lib/offers/shared.ts`): every built feature (key from
  `lib/features.ts`), Managed by BuPulse in two tiers (`managed:light`, `managed:full`), blocks of a limit
  (`block:text` +100 AI texts, `block:image` +50 designs, `block:chat` +1,000 chat replies) and `seat` (one extra user).
  AI photos include 30 designs and Website chat 500 chat replies.
- **The amounts are data**: `AddonPrice` (add-on, region, currency, monthly amount in the smallest unit). Edit them in
  **Admin → Money → Add-on prices** (one column per region, audited per change: `set_addon_price`,
  `remove_addon_price`). A price is always in the region's currency.
- The migration seeds Rwanda from section 4 of the launch plan (RWF). The plan gives no EAC or GLOBAL add-on prices, so
  none are seeded: add them before making offers there. Social channels are not a limit in the app, so "extra social
  channel" is not an add-on.

## Pricing an offer

`quoteOffer()` (pure; the editor's live total and the server use the same function):

1. The base plan (optional): its price in the company's region (`PlanRegionPrice`, or the plan's own price in GLOBAL).
2. One line per feature added on top of the base plan, prerequisites included (adding pulls them in; they are priced).
   Managed Full also needs Analytics.
3. Blocks for each limit above what is included (base plan limit + the add-ons' allowances), rounded up to whole blocks.
4. Extra users above the base plan's seats.

Yearly: the base plan's yearly price plus 10 months of each add-on (the regional plans' rule). A line with no price in
the region is flagged ("No price in RW") and counted as 0. The admin may type the price the client pays (rounding or
discount); a price that differs from the computed total needs a reason. The client sees the computed total struck
through when the price is lower ("4% off").

## Offer lifecycle

`PlanOffer.status`: `draft` → `sent` → `accepted` → `paid`, or `expired` / `withdrawn` (final).

| Step | Who | What happens |
|---|---|---|
| Save | Admin (console, AAL2) | Draft priced and frozen (lines, computed and adjusted total, currency = region currency). Audited `create_offer` / `update_offer`. |
| Send | Admin | `sent`, open for 7 days (1–60, per offer), the company owner is emailed with a link to Billing. A sent offer of the same company is withdrawn ("Replaced by a newer offer"); an accepted one blocks sending. The request it answers becomes `offered`. Audited `send_offer`. |
| Expire | Lazy | A sent offer past `validUntil` becomes `expired` on the next read (admin lists, Billing, the dashboard banner), audited `expire_offer` as `system:offers`. No cron. An accepted offer does not expire (the client may have paid); withdraw it if it is never paid. |
| Accept | Client (Owner) | `accepted`; the company's custom plan is prepared: a `PlanDefinition` with `isCustom`, `businessId`, status `hidden`, key `CUSTOM-…` from the offer id (so accepting twice never makes two), the offer's features and limits, priced in the offer's currency. Nothing switches on yet. Audited `accept_offer` as `client:<user id>`. |
| Pay | Client | Mobile Money: a `ManualPayment` with `offerId`, the offer's price, a BP-XXXX reference, the usual pay screen and the admin's Payments queue. Invoice: one invoice issued and sent at once from the offer (one line, the offer's price, `planKey` = the custom plan), payable by Mobile Money with its number or marked paid by the admin. The client can switch between the two until a payment is reported. |
| Confirm | Admin (Payments, or Mark as paid on the invoice) | The existing Mobile Money confirmation: subscription on the custom plan, `ACTIVE`, `MANUAL_MOMO`, a fresh period from now (usage resets), revenue event, "Your BuPulse Custom plan is active" email. In the same transaction (`lib/offers/activate.ts`): the offer becomes `paid` (conditional, once), the company's older custom plans are retired, the offer's other open invoice is voided, its unsubmitted payments closed. Audited `offer_paid`. |
| Withdraw | Admin | From draft, sent or accepted. Refused while the client has reported a payment (decide it in Payments first). Closes the offer's open payment, voids its invoice, retires the prepared plan. Audited `withdraw_offer`. |

**Idempotency and replays.** Every status change is a conditional write; a partial unique index keeps at most one sent
or accepted offer per company, another one live payment per offer; the Mobile Money replay guard (one live use of a
transaction id) covers offers too. A second confirm, a second accept or a replayed transaction id changes nothing.

**Renewals.** A custom plan renews by Mobile Money at its own price (`startManualPayment` accepts the company's own
custom plan; nobody else can buy it), but only once its offer is paid: while the offer is accepted, a plain payment of
the plan is routed to the offer's payment (`startOfferPayment`, the offer's price and interval); a withdrawn or expired
offer's plan cannot be paid. The renewal reminders work as for any MoMo plan.

**Amounts.** The offer's price is the final amount: an offer invoice never has a tax line, whatever the VAT setting
(line = total = the offer's price). Confirming a payment of an offer refuses any amount or currency other than the
offer's price (`assertOfferAmount`, before the confirmation and again inside its transaction).

**Accepted but unpaid.** The offers list and the company page show "Accepted N days ago". The daily Mobile Money
renewals job emails the company owner on day 3 and day 7 after accepting (`lib/offers/reminders.ts`; claimed in
`reminder3SentAt` / `reminder7SentAt`, released when the email fails, only day 7 when day 3 was missed). After 7 days
the offer shows on the admin Overview attention list.

**Withdraw race.** The reported-payment check runs inside the withdrawal's transaction, after the unsubmitted payments
are closed, so a proof submitted at the same moment either stops the withdrawal or finds its payment closed.

**Jarvis approvals** are priced again before anything is saved; a price change since the request fails the approval.

**Never on sale.** Custom plans are left out of `regionalPlansFor` (pricing page, Billing plan picker, checkout),
`getSellablePlans` and the plan builder list (`listAdminPlans`).

## Card

Paddle cannot take a custom price through the existing adapter (no per-offer price creation, and the Rwanda card
prices are not in Paddle yet, docs/REGIONS.md). The offer's "Pay by card" button therefore shows "Ask us for a card
link" with the support address, and an offer invoice hides its card button. The seam: `offerCardCheckoutAvailable()`
in `lib/offers/service.ts`. To add it: create a one-off Paddle price for the offer (`createPaddlePrice` in
`lib/billing/paddle-catalog.ts`), store its id on the custom plan (`paddleMonthlyPriceId` / `paddleYearlyPriceId`), open
checkout for it, and mark the offer paid when the webhook applies the subscription (same steps as `markOfferPaidInTx`).

## Custom plan requests (R5)

- **Form** `/custom-plan` (signed-in companies in any state, including while waiting for the demo; Owner only):
  what the business does, goals, features of interest (the registry, coming-soon ones included), an optional budget
  range and phone. Linked to the company and its live demo booking. The owner of BuPulse (`ADMIN_EMAILS`) is emailed.
  Rate-limited to 3 a day per company.
- **Entry points:** pricing page "Need something different? Request a custom plan" (goes to sign-up with
  `next=/custom-plan?from=pricing`; after confirming the email, /welcome and /onboarding the visitor lands on the form;
  a signed-in visitor goes straight there), Billing, the demo screen, and "Add to your plan" (with that feature ticked).
- **Admin → Clients → Plan requests** (badge = new): status `new` / `contacted` / `offered` / `closed`, a link to the
  company and **Customise plan**, which opens the editor with the requested features ticked. Sending that offer marks the
  request `offered`.

## Admin

- **Company page** (Client 360, Overview and Billing tabs): "Custom plan" panel with **Customise plan**, the latest
  offers and requests.
- **Customise plan** (`/admin/offers/new?businessId=`): base plan, feature picker (prerequisites tick themselves, a
  feature needed by another cannot be unticked, base plan features show as included, coming-soon disabled), limits with
  what is included, Managed tier, monthly/yearly, live total with the priced lines, price and reason, message, days
  open, and a live preview of what the client sees. Save draft / Save and send.
- **Offers** (`/admin/offers`): every offer by status; an offer's page shows its details, the client's view and
  Withdraw.

## Jarvis

- `list_offers`, `list_plan_requests` (read).
- `create_offer` (money): only creates an approval with the priced lines and price locked in (idempotency key
  required). When the owner approves it in the console, the draft is saved (and sent with `send: true`) by the console's
  own functions; if the price changed meanwhile the approval fails and says so. Paddle is not needed for it.

## Files

- `lib/offers/shared.ts` (pure: catalog, maths, rules, schemas), `addon-prices.ts`, `service.ts`, `activate.ts`,
  `requests.ts`, `emails.ts`.
- Changed: `lib/billing/momo.ts` (offer payments, custom plan renewals, settle the offer on confirm), `lib/invoices/service.ts`
  (`issuePlanInvoice`), `lib/plan-catalog.ts` (`isCustom`, `businessId`), `lib/region-prices.ts`,
  `lib/admin/plans-service.ts`, `lib/admin/service.ts` + `tools.ts` + `types.ts` (create_offer approval), `proxy.ts`
  (`/custom-plan` protected), `lib/rate-limit.ts`.
- UI: `components/billing/offer-card.tsx`, `offer-actions.tsx`, `components/app/offer-banner.tsx`, `demo-lock.tsx`,
  `invoice-lock.tsx`, `components/admin/offer-editor.tsx`, `company-offers.tsx`, `app/admin/(console)/{offers,addon-prices,requests}`,
  `app/custom-plan`, `components/offers/custom-plan-form.tsx`, Billing and pricing pages.
- Migration `20261014100000_custom_plan_offers`. Tests `tests/offers/*`.
