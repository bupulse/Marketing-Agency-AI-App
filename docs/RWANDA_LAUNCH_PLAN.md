# BuPulse — Rwanda launch, regional pricing and custom plans

Written 9 October 2026. Builds on `docs/STAGE1_IMPLEMENTATION_PLAN.md` (Phases 0–8 are built; Phase 9 is not).
Decisions below come from the owner's answers on 9 October 2026.

## 1. The idea in one page

BuPulse launches first in **Rwanda**, where small businesses have little money and pay with **MTN MoMo / Airtel Money**, not cards.

- **Prices depend on where the business is.** Rwanda gets the lowest prices, in RWF. The rest of East Africa (EAC) gets lower USD prices. Everyone else keeps today's prices ($49 / $99).
- **Simple plans for most clients.** In Rwanda there are two normal plans, **Starter** and **Business**. They cover the core: AI captions and scripts, branded designs, the calendar, scheduling and the gallery. Everything else is an add-on.
- **Custom plans for clients who want more.** A business describes what it needs and books an online meeting. After the meeting, the super admin opens the company in the console and adds features: website chat, Autopilot, AI photos, connectors, API and so on. Each feature can have its own limits, for example 100 AI images for one company and 1,000 for another. Every feature and every extra block of usage has a price. The console adds them up into the company's monthly or yearly price, and the admin can round or discount it. As soon as a company gets anything beyond its plan, it moves to its own **Custom plan**.
- **Prerequisites are automatic.** Adding Autopilot also adds the features it needs, with their prices, and explains why.
- **The client agrees first.** A new custom plan is an *offer*. The client sees it in Billing, accepts, pays, and only then do the features switch on.
- **Done-for-you ("Managed by BuPulse")** is an add-on to a custom plan: the BuPulse team runs the client's social media with BuPulse. This is the fastest way to the revenue goal.
- **Payments in Rwanda: the client chooses.** Prices are set in RWF.
  - **Card (Paddle):** charged in USD (Paddle has no RWF) at the converted price, and renews automatically every month or year, so the client never pays by hand.
  - **MoMo / Airtel:** the client sees the amount in RWF and how to pay (MoMo Pay code, number, steps), pays, taps "I've paid", and waits a few minutes while you check your MoMo and approve in the console. It's free and needs no business registration. An automatic MoMo provider (e.g. Paypack) plugs into the same place later.
- **Elsewhere:** East Africa and the rest of the world pay by card through Paddle in USD (Paddle has no RWF, KES, UGX or TZS, and no mobile money).
- **Goal:** **9,000,000 RWF of monthly income by month 3–4** (section 6).

## 2. Decisions

| Topic | Decision |
|---|---|
| Rwanda payment | The client chooses: **card through Paddle** (USD, automatic renewal) or **MoMo/Airtel** (RWF, manual approval in minutes). Automatic MoMo provider later behind the same adapter |
| Rwanda prices and card currency | Prices are set in RWF. Paddle can't charge RWF, so the card price is the RWF price ÷ the admin's USD rate, plus a **card margin** (admin setting, default 12%) that covers Paddle's fee and rate changes, rounded up to whole dollars. At 1,450 RWF/USD: Starter 15,000 → $12, Business 35,000 → $27. Shown as "$12/month by card (≈17,400 RWF)"; MoMo stays at the RWF price |
| Revenue goal | 9M RWF **per month** by month 3–4 |
| Which prices a visitor sees | IP country (Cloudflare `cf-ipcountry`) on the public site. The billing region is **locked by the business's sign-up country**; Rwanda prices also need Rwandan MoMo payment. Admin can change a company's region |
| East Africa region | EAC members: Kenya, Uganda, Tanzania, Burundi, South Sudan, DR Congo, Somalia. Rwanda is its own, cheapest region |
| East Africa currency | USD at the East Africa price, card through Paddle (Paddle country price overrides) |
| Custom plan price | Base plan + priced add-ons from a per-region price list, summed live; admin may round or discount |
| Starting a custom plan | Offer → client accepts → pays → features switch on |
| Prerequisites | Added automatically, priced, explained; can't be removed while something depends on them |
| Custom plan request | Form (business, goals, features of interest) + built-in time picker + Google Meet; request shows in the admin linked to the account |
| Rwanda normal plans include | AI captions/scripts/headlines, branded designs, calendar, scheduling, gallery. **Website chat and Autopilot are add-ons** |
| Rwanda billing periods | Monthly and yearly |
| Rwanda trial | **No trial.** Free in-person demo instead |
| Rwanda prices | Starter 15,000 RWF/month, Business 35,000 RWF/month, yearly = 10 months |
| Done-for-you | Yes: the "Managed by BuPulse" add-on inside a custom plan |
| Video and voiceover | Listed as "Coming soon", not sellable until built |
| Launch-ready means | Team feature finished and tests green; Phase 9 hardening; live on bupulse.com; Paddle live; Meta review pack |

## 3. Regions and prices

Regions are data, not code: a `PricingRegion` table (key, name, currency, countries, payment methods, trial on/off) managed in the admin.

| Region | Countries | Currency | Payment | Trial | Plans |
|---|---|---|---|---|---|
| `RW` | Rwanda | RWF (card charged in USD) | Paddle card, auto-renewing · or MoMo / Airtel, manual approval | No (demo) | Starter 15,000 · Business 35,000 · Custom |
| `EAC` | KE, UG, TZ, BI, SS, CD, SO | USD | Paddle card | 7 days | Standard $25 · Pro $49 · Custom (proposed, editable) |
| `GLOBAL` | Everyone else | USD | Paddle card | 7 days | Standard $49 · Pro $99 · Custom (today's plans) |

**Rwanda plan contents (proposed limits, editable in the plan builder):**

| | Starter | Business |
|---|---|---|
| Price | 15,000 RWF/month · 150,000/year | 35,000 RWF/month · 350,000/year |
| AI texts (captions, scripts, headlines) | 60 | 200 |
| Branded designs | 30 | 100 |
| Calendar, scheduling, gallery | ✓ | ✓ |
| Social channels | 3 | 5 |
| Users | 1 | 3 |

## 4. Feature catalog and add-on prices (Rwanda, proposed)

Every feature lives in one code registry (key, name, prerequisites, usage metric, which outside service it needs, `built` or `coming_soon`). Prices live in the database per region, so the admin can change them.

| Feature | Needs | RW add-on / month | Included in |
|---|---|---|---|
| AI content (captions, scripts, headlines) | — | +100 texts: 3,000 | Starter, Business |
| Branded designs | — | +50 designs: 5,000 | Starter, Business |
| Calendar, scheduling, auto-publishing | — | — | Starter, Business |
| Media gallery | — | — | Starter, Business |
| AI photo designs ("describe an image", people) | Branded designs | 8,000 (incl. 30) | Custom |
| Website chat + hosted business page + WhatsApp lead alerts | — | 10,000 (incl. 500 replies); +1,000 replies: 3,000 | Custom |
| Autopilot (weekly AI plan) | AI content, Branded designs, Calendar, Gallery | 20,000 | Custom |
| Client analytics | Calendar (connected channels) | 5,000 | Custom |
| Canva editing | Branded designs | 5,000 | Custom |
| Store import (Shopify, WooCommerce) | — | 10,000 | Custom |
| Drive / Dropbox import | Gallery | 3,000 | Custom |
| Webhooks | — | 5,000 | Custom |
| API access | — | 15,000 | Custom |
| Extra user | — | 3,000 each | Custom |
| Extra social channel | — | 2,000 each | Custom |
| **Managed by BuPulse — Light** (12 posts/month made and published for them) | Calendar | 100,000 | Custom |
| **Managed by BuPulse — Full** (20 posts/month, designs, comment replies, monthly report) | Calendar, Analytics | 180,000 | Custom |
| Video generation, voiceover, captions (SRT) | — | Coming soon | — |

Example: a real estate agency on Business (35,000) adding website chat (10,000), Autopilot (20,000) and AI photos (8,000) pays 73,000 RWF/month. The admin may round it to 70,000.

## 5. How the flows work

**Custom plan request.** Pricing page or Billing → "Custom plan" → form (what the business does, goals, the features it's interested in) → pick a free slot from the owner's availability → both sides get an email with a calendar invite (.ics) and the Google Meet link. The request appears in the admin console under the company, next to its Client 360.

**Building the offer (admin).**
1. Open the company → "Customise plan".
2. Start from its current plan, then tick features and set limits. Prerequisites tick themselves.
3. Watch the total add up, optionally round or discount it, and choose monthly or yearly.
4. Send. The client gets an email and a WhatsApp-ready message with a link.

Everything is audited.

**Accepting (client).** Billing shows the offer: what's added, the new price, and from when. The client accepts and pays (MoMo in Rwanda, Paddle elsewhere). When the payment is confirmed, the company moves to its private Custom plan and the features switch on. An offer expires after 14 days.

**Choosing how to pay (Rwanda).** On checkout the client picks **Card** or **MoMo / Airtel Money**.
- **Card:** Paddle checkout in USD, showing the RWF price next to it. Paddle renews it automatically, and the existing webhooks keep the plan active, past due or cancelled.
- **MoMo:** the manual flow below. The client can switch method at any renewal.

**Card price conversion.** The admin sets one USD→RWF rate. Card prices for `RW` plans and offers are calculated from it and created in Paddle. They don't follow the rate automatically: when the rate moves, the admin clicks "Update card prices", which uses the existing price-change flow (increases have 30 days' notice; cuts apply at the next renewal).

**Manual MoMo payment (Rwanda).**
1. The client chooses a plan and a period. BuPulse shows the amount, the MoMo Pay code or number, and a reference (e.g. `BP-7K3Q`).
2. The client pays on their phone, then enters the MoMo transaction id and the phone number they paid from.
3. The client sees "Waiting for approval, usually a few minutes". The page updates by itself, and an email follows. You get an instant email alert and a badge on the admin "Payments" queue. You check your MoMo SMS and click Confirm (or Reject with a reason, which the client sees).
4. Confirm extends the paid-until date by a month or a year and resets usage.
5. Reminders go out by email, with a WhatsApp-ready message, 5 days and 1 day before the end. There are 3 days of grace, then the account is read-only. Nothing is deleted.

**Location.** Public pages read the IP country and show that region's prices, (no manual switch: "Use my location" with the browser's permission corrects VPN users; see docs/REGIONS.md). At sign-up the country chosen sets the company's region. Billing always uses the company's region, not the IP.

## 6. Reaching 9,000,000 RWF a month

Average monthly value used: Starter 15,000; Business 35,000; Custom 75,000 (Business plus about 40,000 of add-ons); Managed 150,000 (a mix of Light and Full, software included). EAC and global sales come on top.

| Scenario | Starter | Business | Custom | Managed | Paying clients | Monthly income |
|---|---|---|---|---|---|---|
| A. Software-led | 200 → 3.0M | 100 → 3.5M | 25 → 1.88M | 4 → 0.6M | 329 | **8.98M** |
| B. Balanced | 100 → 1.5M | 60 → 2.1M | 30 → 2.25M | 21 → 3.15M | 211 | **9.0M** |
| C. Agency-led (recommended) | 50 → 0.75M | 40 → 1.4M | 20 → 1.5M | 36 → 5.4M | 146 | **9.05M** |

- **A is unrealistic in 3–4 months.** It needs about 20 new self-service clients a week in a market new to AI tools.
- **C needs the fewest clients but a team.** One content assistant using BuPulse can run about 8–10 managed clients, so 36 managed clients means 4 assistants (a cost to subtract).
- **Pace for C:** about 3M in month 1, 5M in month 2, 7M in month 3, and 9M in month 4. That means about 10 new paying clients a week, 2–3 of them managed, plus keeping monthly churn under about 8%.
- **Honest view:** 9M a month by month 4 is a stretch goal. 4–6M a month is a strong result for a first market. What decides it is sales effort (demos per week), not features.

## 7. Go-to-market in Rwanda

- **Pilot (weeks 1–3):** 10–15 businesses (real estate agents, boutiques, restaurants, salons, hardware) get one month of Managed for free in exchange for a testimonial and before/after posts.
- **In-person demos replace the trial:** generate a post for the owner's own product on their phone in 2 minutes. Target 30–40 demos a week. In-person demos tend to close much better than online sign-ups.
- **Content in Kinyarwanda:** daily TikTok, Instagram and WhatsApp Status posts showing a weak post vs the BuPulse version.
- **Communities:** real estate broker WhatsApp groups, business associations, hubs (Norrsken House Kigali, kLab), and free "AI for your business" workshops that end in demos.
- **Referrals:** one free month for every paying business referred.
- **Track:** demos per week → paid; Starter → Business/Custom upgrades; churn. The admin analytics already show sign-ups, revenue and funnels.

## 8. Implementation plan

Each step ends with tests passing and a handover note in `docs/handovers/`.

### R0 — Stabilise (first)
- Finish companies and team members (uncommitted work). Fix the 14 failing tests: `requirePersonalUser` missing from the auth mocks in `account-deletion`, `canva-routes` and `social-meta-providers`.
- Commit. `tsc`, lint, `vitest` and `next build` must all be green.

### R1 — Regions and regional prices
- `PricingRegion` (key, name, currency, countries[], paymentMethods[], trialEnabled), seeded with `RW`, `EAC` and `GLOBAL`.
- `PlanRegionPrice` (planKey, regionKey, monthlyMinor, yearlyMinor, currency, Paddle price ids); a plan is offered in a region only when it has a price there. The current USD prices move to `GLOBAL`.
- `Business.pricingRegion`, set from the sign-up country; the admin can change it (audited).
- `proxy.ts` / `lib/region.ts`: IP country → display region (a cookie the visitor can override); billing uses the company region.
- Pricing page, Billing page, plan cards and checkout read the region's plans and currency, with RWF formatting (no decimals).
- `RW` card prices: an admin USD→RWF rate setting; `PlanRegionPrice` keeps the RWF price and the derived USD Paddle price ids; "Update card prices" goes through the existing price-change flow.
- Checkout for `RW` offers two methods: Card (Paddle, auto-renewing, USD) and MoMo / Airtel (R4).
- EAC on Paddle: country `unit_price_overrides` on the same Paddle prices; checkout is allowed only for the company's region.
- Trial per region: no trial in `RW`. Rwandan sign-ups land on "Choose a plan or book a demo".

### R2 — Feature registry and entitlements
- `lib/features.ts`: registry of every feature (section 4), with prerequisites, metric, service and status (`built` / `coming_soon`).
- `PlanDefinition.features` becomes a list of feature keys (the marketing bullet points move to `highlights`). The `apiAccess` and `ownComposio` capabilities become features, with a migration.
- Every gated page, server action and API route checks `hasFeature(company, key)`. The nav hides what the company doesn't have and shows "Add to your plan" instead. Website chat and Autopilot become add-ons in `RW`.
- Prerequisite resolver with tests: adding pulls in prerequisites, removing is blocked while needed, and there are no cycles.

### R3 — Custom plans and offers
- Custom plan = a private `PlanDefinition` (`isCustom`, `businessId`, never on the pricing page). This reuses the plan builder, limits and usage code.
- `AddonPrice` (feature or metric block, region, monthly price) with an admin page to edit the price list.
- `PlanOffer` (company, proposed features and limits, computed total, adjusted total, interval, status `draft` → `sent` → `accepted` → `paid` / `expired` / `withdrawn`).
- Admin: "Customise plan" on the company page (Client 360), with a live total, rounding or discount, and Send. Client: an offer card in Billing with Accept → payment.
- When paid: create or replace the company's Custom plan, switch features on, audit. Jarvis tools `create_offer` and `list_offers`. A paid offer is a money action, so it follows the existing approval rules.

### R4 — Manual MoMo payments
- `BillingProvider.MANUAL_MOMO` and an adapter behind the existing `BillingAdapter` interface, so Paypack can replace it later without touching feature code.
- `ManualPayment` (company, reference, amountMinor, currency, period, plan or offer, payer phone, MoMo transaction id, status `pending` / `confirmed` / `rejected`, confirmedBy).
- The company's subscription records its method (`PADDLE` or `MANUAL_MOMO`); switching method takes effect at the next renewal, and a Paddle subscription is cancelled at period end when the client moves to MoMo.
- Client: payment screen with instructions, the MoMo Pay code or number (admin setting), the reference, the transaction id form, and its status.
- Admin: "Payments" queue with Confirm / Reject (audited, idempotent); confirming sets `currentPeriodEnd` and resets usage.
- Cron: reminders 5 days and 1 day before the end (email + WhatsApp-ready text), 3 days of grace, then `past_due` (read-only), using the existing paywall.
- Revenue from MoMo feeds the existing analytics, alongside Paddle.

### R5 — Custom plan requests and booking
- `CustomPlanRequest` (company, description, goals, features of interest, status) and `AdminAvailability` (weekly slots, Africa/Kigali time, buffer, blocked days).
- Booking page with free slots; confirmation email with an `.ics` invite to both sides.
- Google Meet: first version uses a reusable Meet link saved in admin settings. Optional upgrade: connect `admin@bupulse.com` Google Calendar so each booking creates its own event and Meet link.
- Admin: requests list → open company → "Customise plan".

### R6 — Rwanda launch content
- Rwanda version of the home and pricing pages: RWF prices, MoMo/Airtel badges, "Book a free demo", and a WhatsApp contact button.
- Seed the `RW` plans and add-on prices from sections 3 and 4.
- Video and voiceover shown as "Coming soon".

### Plug-in points for later connections
Built now as interfaces, each with an admin Services card showing "Not connected", so adding one later only needs its keys and a small adapter:
- **Automatic MoMo provider** (Paypack, Flutterwave or direct MTN): `PaymentMethodAdapter` beside the manual one, with a webhook route `/api/billing/webhooks/[provider]` that is already registered.
- **Google Calendar** for a separate Meet link per booking (R5 starts with one reusable link).
- **WhatsApp Business** for lead alerts and payment reminders (R4 and R5 create WhatsApp-ready texts until then).
- **Exchange rate feed** to suggest the USD→RWF rate (the admin still approves card price changes).

### R7 — Phase 9 hardening and launch
- Security review (as in the Stage 1 plan, Phase 9), plus the storage-suspension fix and the old-table policies and grants listed in the Phase 8 handover.
- End-to-end tests: Rwandan sign-up → MoMo payment → confirm → generate → schedule; offer → accept → pay → features on; EAC Paddle checkout.
- Status endpoint, backup check, error alerts.
- Production: Cloudflare Workers + Supabase production + DNS for bupulse.com; Paddle live; Resend SPF/DKIM/DMARC.
- Meta app review pack: permission justifications, screencast script, test account, privacy and deletion URLs (already built).

## 9. What only the owner can do

| Task | Why |
|---|---|
| Get an MTN MoMo Pay code (or decide which number to use) and an Airtel Money number | Clients pay here |
| Cloudflare and Supabase production accounts, secrets, DNS | Going live |
| Paddle live-account verification | Card payments for EAC and global |
| **Meta business verification** | Meta usually asks for registered-business documents. Until it's done, Instagram/Facebook posting runs as reminders plus copy-and-post, not automatic publishing |
| Decide when to register the business (RDB) and with tax (RRA) | Needed for an automatic MoMo provider, Meta verification and larger income |
| Set availability for meetings; recruit content assistants for Managed | Sales and delivery |

## 10. To check before relying on them

- MoMo personal wallets have daily and monthly limits. Check that yours covers about 9M RWF a month, or use MoMo Pay (merchant).
- The automatic MoMo provider's terms (Paypack or similar): fees around 1–2% (estimate) and the documents it requires.
- Paddle country price overrides for the EAC countries, and whether Paddle accepts your seller profile and buyers with a Rwandan billing address.
- Paddle's fee (5% + $0.50 per payment) is about 10% on a $10 Starter payment, against about 5–7% at $24. Either accept it or set the card price a little higher than the converted MoMo price. Rwandan banks may also add a foreign-currency fee on USD card payments.
- The RWF/USD rate used in comparisons (≈1,450 RWF per USD, October 2026 estimate).

## 11. Build timeline (written 9 October 2026)

The demo videos in `Demo/` are the acceptance test: each step is done when its scenes work in the real app. Every step ends with tests passing, a reviewer pass and a handover note. New features stay behind switches until the owner approves them.

| Day | Date | Work (estimated hours) | Deliverable at end of day | Owner (hours) |
|---|---|---|---|---|
| 1 | Mon 12 Oct | R0: finish team feature, fix 14 tests, commit (2h). R2: feature registry, prerequisite resolver, tests (3h); feature checks on pages, actions, API and nav (4h) | Clean `main`; each company gets only its plan's features; "Add to your plan" in the nav | MoMo Pay code; check MoMo wallet monthly limit (1h) |
| 2 | Tue 13 Oct | R1: regions table and migrations (2h); prices per region, RWF formatting, IP country display, sign-up locks region (4h); no trial in RW, card margin and USD rate setting, Paddle card prices for RW and EAC overrides (3h) | Pricing page shows Rwanda / EAC / global prices; Rwandan sign-up has no trial | Approve the RW and EAC prices (0.5h) |
| 3 | Wed 14 Oct | R4: payment method choice (card or MoMo) (2h); MoMo pay screen, "I've paid", waiting state (3h); admin Payments list, approve/reject, emails (2h); reminders cron, grace period, read-only (2h) | Videos 2 and 5 work for real: MoMo payment approved in the admin, and card with automatic renewal | Test one real 100 RWF MoMo payment (0.5h) |
| 4 | Thu 15 Oct | R3: add-on price list (2h); "Customise plan" builder with prerequisites, limits and live total (4h); offer → accept → pay → features switch on (3h). Plug-in points for automatic MoMo, Google Calendar, WhatsApp and exchange rate (1h) | Video 4's admin builder and offer flow work for real | Review the add-on prices (0.5h) |
| 5 | Fri 16 Oct | R5: custom-plan request form, availability, booking, invite with Meet link (4h). R6: Rwanda home and pricing pages, WhatsApp button, "Book a free demo" (2h). End-to-end tests of the main journeys (3h) | Request → meeting booked → offer; Rwanda site ready | Set your meeting availability; record a reusable Meet link (0.5h) |
| 6 | Mon 19 Oct | R7: security review and fixes (3h); production deploy: Cloudflare, Supabase production, DNS (2h); Paddle live and webhook test (1h); Meta app review pack (1h); re-capture real screens and re-render the videos (1h) | bupulse.com live; videos show the real app | Cloudflare / Supabase / DNS logins (2h); Paddle live verification (1h); submit the Meta review (1h) |
| — | Tue 20 Oct | Buffer and launch support (up to 4h) | First pilot businesses onboarded | Visit and onboard the first 5 pilot businesses |

About 57 hours of build work, plus about 9 hours from the owner.

**Waits outside our control:** Paddle live approval takes a few days (card payments switch on when it arrives). Meta review takes 2–6 weeks and needs business verification. Until it's approved, Instagram and Facebook use reminder + copy-and-post, and the custom-plan video is used for in-person demos only.

**Gap between the videos and v1:** the custom-plan video shows the lead alert arriving on WhatsApp. Real WhatsApp alerts need the WhatsApp Business Platform, which also needs Meta business verification. v1 sends an instant email and a browser notification, with a "Reply on WhatsApp" button that opens a chat with the visitor. Real WhatsApp alerts plug in once Meta verification is done.

## 12. Decisions of 9 October 2026 (afternoon): pilot launch on 12 October

**Two versions side by side**
- **v1** is `~/BuPulse` on branch `main` (version 1.0.0). It stays as it is, apart from the update screen below.
- **v2** is `~/BuPulse-v2` on branch `v2` (version 2.0.0). It is a git worktree of the same repository and runs on `localhost:3001` (`npm run dev`).
- v2 uses its **own free Supabase project** for testing, so v1's data is never touched. Its `.env` has the database and Supabase values left empty until the owner fills them in.
- When v2 is approved, it is merged into `main`, deployed, and handed over as a zip (without `node_modules`, `.next` or `.env`).

**Updates from the admin (built in v1 and v2)**
- Admin → Settings → **Updates** shows the running version, the newest release and its notes.
- **Install update** needs a fresh authenticator code (AAL2). It starts the official deploy through GitHub Actions (`workflow_dispatch`): database backup check, migrations, then the new Worker.
- The page shows the deploy's progress and offers **Roll back** to the previous Worker version.
- The admin never uploads code. The button needs the repository on GitHub, a GitHub token with Actions permission in the Worker environment, and the deploy workflow.

**No free trial at sign-up: demo first, then a trial**
1. A new client signs up, chooses a plan, and books a demo time. Before the demo the dashboard only shows "Your demo is on …" and a short tour. Nothing else works.
2. In the demo meeting we learn the business and show BuPulse.
3. After the demo, the admin clicks **Start trial** on the company. The trial length is set in Admin → Settings (default **3 days**; this replaces the 7-day trial).
4. When the trial ends:
   - **MoMo clients** get reminders on days 2 and 3 and must pay to continue. If they don't, the account becomes read-only; nothing is deleted.
   - **Card clients** add their card when the trial starts and are charged automatically at the end, unless they cancel.
- This applies to every region. Section 2's "Rwanda: no trial" is replaced by this rule.

**Scope for the pilot launch on Monday 12 October**
- In:
  - R2 (features and plan checks)
  - R1 (regions, RWF prices by location)
  - R4 (manual MoMo payments with admin approval)
  - The demo-first trial, with a simple demo booking: pick a time from the owner's availability; email + calendar invite with the owner's reusable Google Meet link
  - Admin "Start trial"
  - The Updates screen
  - Essential security checks
  - Deploy
- Custom plans are made by hand in the existing plan builder (a private plan per company).
- Later in the week: R3 custom-plan builder and offers, the R5 request form, card payments (once Paddle is live), the full R7 review, and re-recording the videos.

## 13. Fix list found while recording the demo videos (9 October 2026)

To fix before the pilot launch on 12 October:
1. **Home page placeholders.** The testimonials section is placeholder text, and the hero illustration shows placeholders such as "[your.shop]". Remove the testimonials until real pilot quotes exist, and replace the placeholders with real example text.
2. **Autopilot posting times.** Kigali times were saved as UTC, so 09:00 showed as 11:00 local (found with Nova Phones' planned week). Check the time-zone conversion in the Autopilot planner and add a test with Africa/Kigali.
3. **Dashboard "Designs" card.** The count is hard-coded to 0 (`app/dashboard/page.tsx`, about line 52). Show the company's real design count.

Demo data in the v1 development database (4 demo accounts and their content) is listed in `Demo/capture/MANIFEST.md`.
- Remove it with `node Demo/capture/cleanup.mjs --yes` (without `--yes` it only lists what it would delete).
- Don't press "Approve all" on Nova's 14 Autopilot posts: its social connections are fake rows.

## 14. Pilot moved to Wednesday 14 October (decided 12 October 2026)

| Day | Work | Owner |
|---|---|---|
| Mon 12 Oct | Finish R1 (regions, RWF prices) and the demo-first trial on top of R2 + R4. Fold MoMo's RWF prices into regional prices. Review and fix. Fix list from section 13 | Create the v2 test Supabase project and paste its keys into `~/BuPulse-v2/.env`; send the MoMo Pay code, demo availability and Meet link |
| Tue 13 Oct | Apply migrations to the v2 test database, seed regions and plans, run v2 on localhost:3001. Owner tests every flow. Security pass and fixes. Production setup | Test v2 (about 1 hour); Cloudflare token and account ID, production Supabase, Resend DNS, admin authenticator |
| Wed 14 Oct | Merge v2 into `main`, back up the database, deploy to bupulse.com, one real 100 RWF MoMo payment, onboard the first pilot businesses | Approve the deploy; test payment; pilot visits |

Also on 12 October:
- The demo accounts and their data were deleted from the development database. Their password had been published in the public GitHub repository.
- The owner chose to keep the repository public. No API keys or database passwords are in it; `.env` has never been committed.
