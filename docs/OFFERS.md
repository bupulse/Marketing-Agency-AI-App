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

"Posts per app per day" (1 to 10, the base plan's by default) is set in Limits but not priced; the custom plan carries
it (`limits.postsPerAppPerDay`, docs/CONTENT.md).

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

Automatic since 14 October 2026 (`lib/offers/card.ts`), for a custom plan offer and for added features alike:

1. **The amount.** The offer's price (RWF in Rwanda) is converted with the card rule of RWF plans
   (`offerCardQuote` = `cardUsdCents`: Settings USD→RWF rate plus the card margin, rounded up to whole dollars); an
   offer priced in USD (GLOBAL) is charged as it is. Billing shows it before paying: "≈ $24 by card (RWF 32,000),
   charged in US dollars once (no subscription)".
2. **The checkout.** "Pay by card" accepts the offer if needed (`acceptOffer`, method `card`) and
   `startOfferCardCheckout` creates a **one-off Paddle transaction** for that exact amount: a non-catalog item
   (`createOneOffTransaction` in `lib/billing/paddle.ts`, `POST /transactions` with an inline price and product; nothing
   is added to the Paddle catalog). Paddle.js opens it by transaction id, so the browser cannot change the amount. Its
   custom data carries the offer, the user, the USD amount and the RWF quote, **signed** (`qsig`, `lib/billing/signing.ts`).
   The amount is quoted again on the server: a client who saw another amount (the rate or the offer changed) gets
   "The card price is now $X" with the new amount to confirm, and nothing is charged.
3. **The webhook** (`transaction.completed`, `processPaddleEvent` → `applyOfferCardPayment`): checks both signatures,
   that the paid subtotal and currency are exactly the signed quote, that the offer is the client's, still accepted,
   and still costs the quoted amount (the stored quote wins over a later rate). Then, in one transaction, exactly what a
   confirmed Mobile Money payment does: offer `paid` (`paidBy card:<transaction>`), custom plan on (added features keep
   the period end; a full offer starts its period like Mobile Money), its unsubmitted Mobile Money payments closed and
   its invoice voided; audited `offer_paid_card`; the "plan is active" email. A replay finds the offer paid and changes
   nothing. Anything that cannot be applied (wrong amount, unsigned, offer withdrawn or paid another way, period
   changed) is logged to ErrorLog `billing.offer_card` as **refund needed** (the money arrived in Paddle).
4. **Revenue.** The transaction is a card payment in the books like any other (net USD from Paddle), with the RWF quote
   as its local amount, so the Revenue pages, the leaderboard and the sales TV count it (exact in RWF).
5. **No card**: when card payments are not set up, switched off in Admin → Services, or not offered in the company's
   region, the card button is not shown; Mobile Money and invoice stay. A card plan that still renews cannot take an
   offer by card (as by Mobile Money).

The custom plan then renews by hand (Mobile Money, or card in its last 7 days at the plan's card price), as before.

`PlanOffer.payMethod` may be `card` (migration `20261018110000_offer_card_pay_method` widens
`PlanOffer_pay_method_check`; `tests/offers/pay-method-constraint.test.ts` checks the constraint allows every
`OFFER_PAY_METHODS` value). A card start that fails is shown under the button as well as in a toast.

## Adding features to a paid plan (decided 13 October 2026)

The client pays **only for the added features, prorated for the days left** in the current period; the features switch
on when that payment is confirmed; **the period end does not move**; from the next renewal the price is the full new
total (plan + added features).

- **Maths** (`quoteAddition`, `prorateMinor` in `lib/offers/shared.ts`, pure): the added features' monthly prices
  (yearly: 10 months), a whole period → `round(amount × daysLeft / periodDays)` in the currency's smallest unit (whole
  RWF, US cents). `periodDays` is the period ending at `currentPeriodEnd` (31 for a month ending 1 November, 365 for a
  year); `daysLeft` counts a started day as a day; the same day the period started pays the whole period; at the end
  (0 days) there is nothing to pay, so it is refused ("renew first"). Example: +10,000 RWF/month, 15 of 30 days left →
  5,000 RWF. An added feature's allowance raises its limit (AI photos +30 designs, Website chat 500 replies).
- **Who can:** a running plan paid by Mobile Money, or a card plan that renews by itself (`additionContext`; see
  "Adding features to a card plan" below). A card plan set to end or past due takes nothing new (Billing says why); a
  plan no longer sold in the region: use a request.
- **Stored as** an ordinary `PlanOffer` with `options.mode = "addon"` and `options.addition` (current plan, add-on
  price per period, next-renewal total, period end, days left, `selfServe`); `adjustedMinor` = the prorated amount to
  pay now; `lines` = the add-on lines for a whole period. No schema change. Accepting prices it again for the days left
  that day (`additionAtAccept`) and prepares the custom plan at the **next-renewal total**.
- **Confirming** (`confirmManualPayment`, also through an invoice made from it): period mode `keep`; the subscription
  moves to the custom plan, `currentPeriodStart` / `currentPeriodEnd` untouched. Reminders and the next renewal use the
  custom plan's own price. Accepting also takes **today's** plan price for the next-renewal total.
- **The period must be the one it was priced for** (`additionFits`: same plan, interval, Mobile Money, ACTIVE and
  exactly `addition.periodEnd`). A renewal in between (e.g. accepted by invoice → renewed → invoice paid) would pay the
  add-on at the old proration, so starting its Mobile Money payment (offer or invoice) and confirming it are refused;
  the quote is withdrawn (`withdrawStaleAddition`: invoice voided, unsubmitted payments closed, prepared plan retired,
  reason `STALE_ADDITION_REASON`), Billing tells the client for 14 days to add the features again for a new quote, and
  the owner rejects (and refunds) a payment already reported.
- **Admin:** Customise plan → **Add to current plan** (beside "New custom plan"): the current plan is the locked base,
  its features ticked and locked, no limits or interval; the total shows the add-ons per period, "Client pays now
  (prorated, N of M days left)" and "Next renewal: plan + added features". A typed price replaces the add-ons' price
  per period (with a reason). Jarvis `create_offer` refuses this mode (console only).
- **Client, self-serve:** Billing → **Add features** (`components/billing/add-features.tsx`, `startFeatureAddition`):
  the plan's features ticked and locked; only built features priced in the region (their prerequisites too; never
  Managed) can be ticked; an instant quote (now, and from the renewal date); **Pay with Mobile Money**, **Get an
  invoice**, or **Pay by card** (automatic, "Card" above). It makes and accepts an add-features offer (`createdBy
  client:<id>`, audited `self_serve_addition`); a new choice replaces the client's own unpaid one (not after a payment
  was reported); an open offer from the team must be answered first. Anything else: **Request a custom change**.
- **Card:** a one-off Paddle charge of the prorated amount converted to USD ("Card" above).
- Tests: `tests/offers/addition.test.ts`, `tests/billing/renewal.test.ts`, `tests/offers/card.test.ts`.

## Adding features to a card plan (decided 15 October 2026)

A card plan (a Paddle subscription that renews by itself) takes added features on that same subscription, self-serve:
no team, no card link (`lib/offers/card-plan.ts`, `lib/offers/card-plan-items.ts`).

- **Same list and rules** as Mobile Money's "Add features": the plan's features ticked and locked, built features priced
  in the region (prerequisites too, never Managed), "Coming soon" for those not set up yet (`selfServeQuote`).
- **Card price:** each added feature's regional price for a whole period (yearly: 10 months) at the card rule of plans
  (`cardAdditionQuote` = `cardUsdCents`: Settings USD→RWF rate plus the card margin, whole dollars up). Billing shows
  each feature's "+$4 / month by card", "≈ $3 now for the 25 days left" (our estimate; Paddle prorates to the second)
  and the card plan's new price from the renewal date, then **Add to my card plan** and a confirm step before the card
  is charged. A rate changed since the page loaded is answered with the new price to confirm, never charged.
- **The change:** the same add-features offer and custom plan as Mobile Money (plan + features, at the regional price;
  `options.cardPlan` keeps the card items, the subscription and the rate). Then `PATCH /subscriptions/{id}` with every
  current item kept by its price id plus one **non-catalog price** per feature (`addRecurringItems` in
  `lib/billing/paddle.ts`; nothing is added to the catalog): monthly or yearly like the plan, USD, custom data
  `{ kind: "bupulse_addon", key, offerId, userId, sig }` (`sig` signs `addon:<offer>:<user>`),
  `proration_billing_mode: "prorated_immediately"`, `on_payment_failure: "prevent_change"` (a declined card changes
  nothing; the offer is withdrawn and the client told).
- **Switching on:** never from the browser. Paddle's answer to the change and its `subscription.updated` webhook go
  through the same `applyProviderSubscription`: `mapSubscription` takes the plan's own price (the first item that is
  not an added feature; items come in any order) and reads the added items. Every change of a card plan (an
  add-features offer, or a removal) records the add-ons the plan has once it is on (`cardPlan.keys`; for the first
  offers, their custom plan's features beyond the plan's own). `cardAddonPlan` checks each item's signature and puts
  the client on the change whose keys are exactly the signed items, the one waiting first, else the latest: its custom
  plan, or the plan's own when none are left. Nothing is switched on that the card is not paying for (items that match
  no change: the latest paid change whose features are all still there, logged). The first event carrying a change
  settles it (`settleCardPlanChangeInTx`: an offer is paid with `markOfferPaidInTx`, `paidBy card:<subscription>`; a
  removal is marked done), once, in the same write. Renewals keep the items and the plan; items BuPulse cannot match
  are logged (`billing.card_addons`) for the owner to check in Paddle.
- **Lost answers:** a network error or a 5xx leaves the offer open for the webhook; the next "Add to my card plan"
  (after a minute) reads the subscription from Paddle and settles it when the items are there, or withdraws it: never
  added twice. Billing says "waiting for the card payment to be confirmed" meanwhile and shows no pay buttons for it
  (`clientOffer` never shows a card plan's offer).
- **Plan changes:** a plan change (`changePlan`) sends only the new price, so the added features end with it (Paddle
  credits their unused part); the switch dialog says so, naming them. Billing shows the card plan's price as the plan's
  plus the added features' ("$17 per month: Starter plus AI photos"). One feature at a time: "Removing a feature from a
  card plan" below.
- **Not possible, and why:** set to end ("Renew it from <date>, then add the features here"), past due ("Update your
  payment method above, then add features"). Card not set up, switched off, or the provider unable to take the change
  (a key without permission): "Adding features by card is not available right now. Write to us at … and we will add
  them to your plan for you." An admin "Add to current plan" offer is refused for a card plan (it could only be paid
  by Mobile Money or a one-off card payment).
- Tests: `tests/offers/card-plan.test.ts`.

## Removing a feature from a card plan (decided 15 October 2026)

Billing → Add features lists the features added to a card plan ("Added to your card plan"), each with its card price
and **Remove** (`removeFeatureFromCardPlan` in `lib/offers/card-plan.ts`).

- **Confirm first:** "Remove Website chat and leads? It stops when Paddle confirms. The unused days go back as credit on
  your card plan, which then costs $X a month", with what it leaves behind (`cardRemovalEffects`): Website chat stops
  answering (the widget reads the plan, `lib/widget/config.ts`) and the leads already captured stay; AI photos' images
  go back to the plan's own number and the designs made stay; anything used above the new limits is not refunded and
  new use waits for the next period.
- **Recorded as a removal:** a PlanOffer with `options.mode = "removal"`, `removed`, `cardPlan.keys` (what is left) and
  nothing to pay (`adjustedMinor` 0; migration `20261020100000_offer_removal_amount` lets only a removal be 0), created
  accepted by the client, audited `card_plan_remove_feature`. Its custom plan is the plan's own plus the features left
  (`quoteAddition` on the plan's regional price: limits and the price a Mobile Money renewal of it would take); none
  left: no custom plan, the plan's own.
- **The change:** `PATCH /subscriptions/{id}` with every other item kept by its price id (`removeRecurringItems` in
  `lib/billing/paddle.ts`), `prorated_immediately`: Paddle puts the removed item's unused days on the customer's credit
  balance, which pays the next bills (checked in the sandbox).
- **Switching off:** only when Paddle confirms (its answer, or the webhook), through `applyProviderSubscription` like
  every change: the removal's keys match the items left, so the client moves to its plan and it is marked done
  (audited `card_plan_feature_removed`). A refusal withdraws the removal (its plan retired); a lost answer is settled on
  the next try, like adding.
- **Not removed:** a feature another added one needs ("Voiceover needs Videos: remove it first."), a plan set to end
  (they end with it), past due (update the payment first).
- **Mobile Money plans:** no self-serve removal (not built). Dropping a feature at the renewal would need the renewal
  payment, its reminders and the confirmation to move to the smaller plan only when the paid period ends; Billing says
  "Request a custom change" for it, as before.
- Tests: `tests/offers/card-plan.test.ts` ("Remove a feature from a card plan").

## Custom plan requests (R5)

- **Form** `/custom-plan` (signed-in companies in any state, including while waiting for the demo; Owner only):
  what the business does, features of interest (the registry, coming-soon ones included), an optional budget range and
  phone. The plan's own features (with their prerequisites) are ticked and locked ("In your plan"); ticking a feature
  ticks what it needs; only what is new is stored. There is no goals field any more (13 October 2026; the column is
  nullable, migration `20261017190000_request_goals_optional`, older requests keep theirs). Linked to the company and its live demo booking. The owner of BuPulse (`ADMIN_EMAILS`) is emailed.
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
