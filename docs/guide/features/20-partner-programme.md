# Partner programme

Outside partners (agencies, co-working spaces, MoMo agents and merchants, consultants, happy clients) refer businesses
to BuPulse and earn a share of what those businesses pay. The rules and the reasons for the rates are in
`docs/bizdev/PLAN.md`, section 6.

**Pages:** `/partners` (public: the programme and the application form), `/partners/me/<token>` (the partner's private
page, no account), **Admin → Sales → Partners** (`/admin/sales/partners`). **Who in Admin:** the page opens for staff
with *Sales team* or *Revenue and profit*; approving, turning down and pausing need *Sales team*; **Mark as paid** needs
*Approve or reject payments* (the same as confirming Mobile Money).

BuPulse never contacts a partner by itself: no email, no message. You send the partner their link and their page.

## The rules

| Rule | |
| --- | --- |
| Link | `bupulse.com/?ref=CODE` on any page. Partner codes are 7 characters; staff codes are 5 or 6, so a code is one or the other. The first link a visitor opens is kept for 30 days (the same cookie as staff links). |
| A referral | A company that signs up after opening the link, while the partner is **active** (not applied, paused or turned down). Not the partner's own sign-up (same email). One partner per company. A staff link opened first wins. |
| Counts when | The company's **first payment comes within 90 days** of signing up. |
| Earns | On every payment of that company for **12 months** from its first payment. |
| Rate | 20% for the partner's first 5 paying companies, 25% from the 6th, 30% from the 21st. The rate is decided at each payment by how many of the partner's companies have paid so far, and applies to all of them. |
| Money only | Mobile Money confirmed in Admin → Payments, card payments Paddle completed, paid invoices, minus refunds: exactly the payments Admin → Revenue counts. Nothing on trials, unpaid invoices or offers not paid. |
| Amount | In RWF: what the client paid in RWF, or a card payment's net dollars (after Paddle's fee) at the USD→RWF rate in Admin → Settings. |
| Hold | Payments of the last 14 days are **on hold** (time for a refund). The rest is **owed**, minus payouts already made. A refund after a payout makes "owed" negative until later commission covers it. |
| Payout | By hand with Mobile Money, then **Mark as paid** with the transaction id. |

## For the owner: step by step

1. **An application arrives.** Admin → Sales → **Partners** → *New applications* shows who, what kind of partner, how
   they will find clients and their phone. Call or message them.
2. **Approve** (or **Turn down** with a reason only you see). Approving gives a 7-character code and a private page.
3. **Send them two links** from their card under *Partners*: **Link to send** (their referral link) and **Their page**
   (their numbers). Use WhatsApp or email from your own phone.
4. **Each month** look at *Owed now* on each card. Send the money by Mobile Money to the partner's number, then open
   **Mark as paid**: the amount (at most what is owed), the Mobile Money transaction id and an optional note. The same
   transaction id cannot be recorded twice. Every payout is in the audit log (`partner_payout`).
5. **Pause** a partner who breaks the terms: their link stops counting new sign-ups; commission on companies they
   already brought keeps counting. **Resume** undoes it.

## What the partner sees

- **On `/partners`:** the three rates, who can join, how it works, the terms, and the form (kind of partner, name,
  organisation, email, Mobile Money number, town, how they will find clients, accepting the terms). After sending:
  "Thank you, we got your application". A second application from an address that already applied is accepted
  silently and not stored twice.
- **On their page:** their link, paying clients and their rate, owed (and on hold), paid, each company they brought
  (signed up, first payment, earning until, commission, "Paying", "Not paid yet" or "Paid too late") and their payouts.
  A paused partner sees their numbers without a link. Anyone without the exact link gets "page not found".

## For developers

| | |
| --- | --- |
| Rules (pure) | `lib/partners/commission.ts`: `partnerCommission`, `tierPct`, `TIERS`, `QUALIFY_DAYS` (90), `EARN_MONTHS` (12), `HOLD_DAYS` (14), `baseRwfOf`, `addMonths` |
| Shared (client-safe) | `lib/partners/shared.ts`: kinds, statuses, `partnerApplicationSchema` (zod), `PARTNER_CODE_LENGTH`, payout reference format |
| Service | `lib/partners/service.ts`: `submitPartnerApplication`, `assignPartnerReferral`, `approvePartner`, `rejectPartner`, `setPartnerPaused`, `recordPartnerPayout`, `partnerSummaries`, `loadPartners`, `partnerByToken`, `entriesForUsers` |
| Sign-up | `lib/account.ts` (`ensureAccount`): `assignReferral` (staff) first, `assignPartnerReferral` when no staff code matched. Both never throw. The code comes from the sign-up metadata `ref_code` or the `bp-ref` cookie (`lib/sales/ref-cookie.ts`, set in `proxy.ts`). |
| Money | Payments come from `BillingEvent` through `toRevenueEntry` and `dedupe` (`lib/money/revenue-shared.ts`), the same as Admin → Revenue |
| Public pages | `app/(marketing)/partners/page.tsx`, `partner-form.tsx`, `actions.ts`; `app/(marketing)/partners/me/[token]/page.tsx` (noindex) |
| Admin | `app/admin/(console)/(sales)/sales/partners/page.tsx` and `actions.ts`; menu entry in `components/admin/nav.ts` |
| Limits | `PUBLIC_LIMITS.partnerApply` in `lib/request-limits.ts` (5 an hour per address, 3 a day per email), a honeypot field |
| Tables | `Partner`, `PartnerReferral` (unique `businessId`; no foreign key to Business or User so history stays after an account is deleted), `PartnerPayout` (unique `reference`). Migration `20261025200000_partners`: RLS on, all grants revoked from the Data API roles |
| Audit | `approve_partner`, `reject_partner`, `pause_partner`, `resume_partner`, `partner_payout` (each in the same transaction as the change) |
| Tests | `tests/partners/commission.test.ts`, `tests/partners/service.test.ts`; `tests/security/rls-coverage.test.ts` covers the tables |

**Deploy:** run the migration before the code (`npx prisma migrate deploy`); until it has run, `/partners` cannot store
applications and Admin → Partners cannot load. Sign-ups are not affected (the partner lookup never throws).

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| A company a partner brought is not on their card | Did the visitor open a staff link first, or sign up more than 30 days after the link? Was the partner active at sign-up? | Expected. There is no manual "assign to partner" yet: note it and pay it by hand |
| A paying company shows no commission | Its first payment came more than 90 days after sign-up ("after 90 days: no commission"), or the payment is not confirmed yet | Confirm the payment in Admin → Payments |
| Commission looks too low on a card payment | Card payments count net of Paddle's fee, at the Settings USD→RWF rate | Expected |
| "That is more than is owed now" | Payments of the last 14 days are on hold | Pay the rest later |
| "A payout with that Mobile Money reference is already recorded" | The payout was saved already | Check the card's Payouts line |
| `/partners` form says "Something went wrong" | The migration has not run, or the database is down (`ErrorLog`, server logs) | Run the migration |
