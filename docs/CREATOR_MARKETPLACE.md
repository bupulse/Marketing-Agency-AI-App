# Creator marketplace

Phase 2 of [Creator campaigns](CREATOR_CAMPAIGNS.md). Creators find campaigns themselves at **bupulse.com/creators**.
They sign up once with a profile and apply in one tap. Companies on the plans with `creators` can find creators who
chose to be found and invite them. Everything in CREATOR_CAMPAIGNS.md still holds: invite links, `/c/<slug>`, pay,
tracking and payouts. This page only adds to it.

The owner's decisions (21 October 2026) are the rules below. Where this page says "owner decision", don't change it
without asking.

## The marketplace: `/creators` (public, indexed by Google)

- **Which campaigns.** It lists every campaign that is `LIVE`, `acceptingApplications`, `listed` (the company's
  "Show on the marketplace" switch, on by default: owner decision), not hidden by an admin (`hiddenAt` null), whose
  company's plan still has `creators`, and whose last day hasn't passed. A company that turns `listed` off still has
  its `/c/<slug>` link.
- **Public and indexed** (owner decision). The list and each campaign page are in the sitemap, with Open Graph images
  for WhatsApp sharing. Unlisted or hidden campaigns are `noindex` and left out of the sitemap.
- **Filters** (owner decision: all four):
  - platform (Instagram, Facebook, TikTok);
  - pay, sorted by best pay (highest rate per 1,000 views, then fee per post);
  - business type, from the company's industry (`Business.industryRef` / `industry`);
  - when: open now or starting soon, with the places left (plan limit `creatorsPerCampaign` minus SELECTED, JOINED and
    open invitations: an OFFERED row less than 14 days old holds its place, as the company side counts).
  Filters are query parameters, so a filtered list can be shared.
- **Campaign card:** company name and logo, campaign name, platforms, dates, pay in words (`creatorPayInWords`),
  places left, and the company's **payment record** (below).
- **Payment record** (owner decision): from payouts marked PAID. For example "Paid 12 creators" and "usually within
  N days of the month's end" (median of `paidAt − period.endsAt`). New companies show "New on BuPulse". A company with
  DUE payouts more than 14 days old shows "Some payments late". Only these figures are computed; nothing is typed by
  hand.

## Creator accounts (owner decision: profile once)

- **Sign up** at `/creators/signup`: name, email, password, WhatsApp. Supabase sign-up with email confirmation, with
  `user_metadata.account_kind = "creator"`. `ensureAccount` (lib/account.ts) must then make the `User` row and a
  `CreatorProfile`, **never a Business** or trial. Google sign-in for creators can come later.
- **Profile** at `/creator/profile`:
  - name, WhatsApp, location (district or city), a short bio;
  - handles with follower counts (`[{ network, handle, followers }]`, as on applications);
  - 1–3 sample links;
  - the "Let companies find me" switch (`discoverable`, off by default).
  - Connected accounts (Connections) show as **verified** next to the typed handles.
- **Apply in one tap** from `/creators` or `/c/<slug>` when signed in as a creator. The profile fills the application
  (`CampaignCreator` with `source = "MARKETPLACE"`, `profileId` set straight away): name (split into the form's first
  and last name), WhatsApp, the handles on the campaign's platforms, best posts and, for the "location" preset, the
  profile's district or city (`lib/creators/quick-apply-form.ts`). Since the wizard (docs/CREATOR_CAMPAIGN_WIZARD.md)
  the company's form decides the rest: when it has **required** fields the profile cannot answer (or requires best
  posts the profile has none of), a short form asks just those, with the basics shown and editable for this
  application only and the optional fields folded under "More questions". Otherwise it stays **one tap**, with "Change
  or add" folded. An incomplete profile (no handle for any of the campaign's platforms, or no WhatsApp when the form
  requires it) is asked to complete it first.
- When a company **selects** someone who applied with an account, there's no invite link: they become JOINED
  straight away and are told (email, plus a notice in the portal). People who applied without an account still get
  the invite link, as before.
- A signed-in company person who opens `/creators` sees the marketplace but can't apply ("Creators apply with a
  creator account").

## The creator's dashboard

- **Campaigns** (home): every campaign they're in, by status: Joined, Waiting for the company (APPLIED or SELECTED),
  Invitations (OFFERED, with Accept or Decline), and Ended. Plus a "Find campaigns" link to `/creators`.
- **Tasks** (owner decision: pick, then tasks): Tasks opens with the list of their JOINED campaigns (logo, name, tasks
  due today). Tapping one shows only that campaign's tasks. With one campaign it opens straight into it.
- Earnings, Connections and Profile as already built (plus Profile).

## Companies finding creators (owner decision: yes, opt-in)

- `/dashboard/creators/find` (feature `creators`, permission `creators`) lists creator profiles with `discoverable`
  on and not blocked. Filters: platform, followers range, location, and has a connected (verified) account.
- Each profile shows:
  - name, location, bio, handles and followers (verified ones marked), sample links;
  - their **campaign record**: campaigns joined and ended, posts that counted, total views in BuPulse campaigns, and
    removed or rejected posts. This counts across all companies, but never shows other companies' names or pay.
- **Invite to a campaign:** pick one of the company's LIVE or DRAFT campaigns. That creates a `CampaignCreator` with
  `status = "OFFERED"`, `source = "OFFER"`, `offeredBy` and `offeredAt`, and counts toward `creatorsPerCampaign`. The
  creator is told by email and in the portal, and accepts (→ JOINED) or declines (→ DECLINED). An offer expires after
  14 days. One open offer per creator per campaign.
- Contact details (WhatsApp, email) show to a company only once the creator applied to or joined one of its
  campaigns.

## Safety (owner decision: all three)

- **Admin can hide and block.**
  - In the admin console, an admin can hide a campaign from the marketplace (`hiddenAt`, `hiddenReason`). Its
    `/c/<slug>` keeps working for creators already in it.
  - An admin can block a creator from the marketplace (`blockedAt`, `blockedReason`): no applying, not findable, and
    open offers withdrawn. Campaigns they've already joined go on unless a company removes them.
  - Every hide, block and undo is written to the audit log.
- **Report button.** Creators report a campaign (reasons: SCAM, NOT_PAID, SPAM, OFFENSIVE, OTHER), and companies
  report a creator (FAKE_VIEWS, SPAM, OFFENSIVE, OTHER). Each report is a `CreatorReport`, rate limited, one OPEN
  report per reporter and target. Reports show in the admin console's inbox (Admin → Inbox), where an admin resolves
  them with a note and can hide or block from there.
- **Payment record** (above): keeps companies honest in public.

## Company side and admin: details decided while building (21 October 2026)

Not owner decisions; change them freely.

- **Listing switch.** The new-campaign form has "Show on the marketplace" (on). Afterwards it is its own switch in
  Settings (`setListed`, not part of the settings form, so saving the form never flips it); showing needs the feature,
  hiding never does. An ENDED campaign cannot be listed again. A campaign hidden by an admin shows "Hidden by BuPulse"
  in its header, in the campaign list and, with the reason, in Settings; the switch keeps its value and applies again
  once the admin shows it.
- **Places.** `placesTaken()` (lib/creators/campaigns.ts) is the one count of `creatorsPerCampaign`: SELECTED + JOINED
  + OFFERED with `offeredAt` less than 14 days ago, under the campaign's advisory lock. The Applicants line uses the same
  rule, and so should the marketplace's "places left" (open offers hold a place).
- **Picking someone with an account.** A row with `profileId` set (the creator applied from their account) goes
  APPLIED or DECLINED → JOINED in one conditional update (`selectedAt` and `joinedAt` now, no token), and gets a
  "You're in" email linking to `/creator`; the portal shows it because the row is JOINED. A blocked creator cannot be
  picked. A row the company made itself (source OFFER) is never "selected": they answer the offer, or the company
  invites them again.
- **Offers** (lib/creators/offers.ts). To LIVE or DRAFT campaigns only, of creators who are `discoverable` and not
  blocked. Refused when the creator already applied (pick them on Applicants), is SELECTED, JOINED or REMOVED there,
  was declined after applying (Select after all), or has an offer under 14 days old. An expired offer, or one they
  declined or the company withdrew, is made again on the same row (the `(campaignId, email)` unique key), with the
  profile copied again. Email of the row: the creator's login email. Expiry is computed, not stored:
  `offerExpiresAt(offeredAt)` / `offerExpired()` in lib/creators/company-forms.ts (shared with the creator's Accept).
  Withdrawing sets DECLINED (offeredAt kept). Rate limit: 60 offers an hour per person.
- **Contact details.** Shown in Find creators and on Applicants once the creator applied to one of the company's
  campaigns (source LINK or MARKETPLACE, any status, also matched by email for link applications made before the
  account existed) or joined one (`joinedAt` set). An OFFERED row shows "Their WhatsApp and email show once they join".
- **Find creators.** One SQL query (`matchingIds`) filters and orders, 20 a page, most followers first. Followers: the
  biggest typed count, on the platform picked when there is one; a creator without a count drops out of a follower
  filter. Platform: a typed handle or an ACTIVE connection on it. Verified: an ACTIVE `CreatorConnection` (on the
  platform picked). Location: contains, case-insensitive, `%` and `_` typed literally. A typed handle is marked
  verified when an ACTIVE connection on that network has the same username; a connected account not typed is added,
  verified, without a count.
- **The record**: memberships with `joinedAt` set, in any company; "ended" counts those whose campaign is ENDED;
  posts that counted are TRACKING or FINAL with their latest views; "removed or rejected" counts REMOVED and REJECTED
  posts. INVALID links don't count either way. A creator with no joined campaign shows "New to BuPulse campaigns".
- **Company reports.** Report on a creator in the campaign's Creators tab and in Find creators. Allowed for a creator
  the company can find, or who has any row in its campaigns. Works without the feature (like the other safety steps).
- **Admin console** (Admin → Clients → Creator marketplace, `/admin/creators`, page permission `clients.view`,
  actions `clients.manage`): tabs Reports (open first, oldest first; resolved, newest first), Campaigns (search name,
  link or company; listed, not listed, hidden) and Creators (search name, email, WhatsApp or location; findable,
  blocked). Hide and block need a reason (3+ characters; the company sees a hide's reason); unhide and unblock take an
  optional one; resolving needs a note. Hiding or blocking from a report resolves that report in the same
  transaction, with the note "Campaign hidden: …" or "Creator blocked: …". Unblocking does not bring back withdrawn
  offers. Audit actions: `creators_hide_campaign`, `creators_unhide_campaign`, `creators_block_creator` (with
  `offersWithdrawn`), `creators_unblock_creator`, `creators_resolve_report`.
- **Inbox.** OPEN reports are the inbox section "Creator marketplace reports" (key `reports`), counted in the Inbox
  badge for people with `clients.manage`, and the page's own sidebar badge.
- **Report reasons** live in `lib/creators/report-reasons.ts` (pure, for the forms); lib/creators/reports.ts
  re-exports them.

## Creator side: details decided while building (21 October 2026)

Not owner decisions; change them freely.

- **Listing.** `isListed()` (lib/creators/market-filters.ts) is the one rule, used by `/creators`, the sitemap and the
  `index` robots tag of `/c/<slug>`. "Last day has not passed" is in the company's timezone. A campaign whose places
  are all taken stays on the list, marked **Full** and after the others; the **When** filter ("Open now", "Starting
  soon") keeps only campaigns with places left. Default order: newest first; `sort=pay` is best pay. The business
  types offered are the industries of the companies listed right now (`type=<industry slug>`). Up to 500 campaigns are
  read per page view.
- **Payment record** (lib/creators/record.ts): "creators paid" counts different people (by email) across the company's
  campaigns; the median days are rounded up, "within a day" for 0 or 1; a payout paid before its month's end counts
  as 0 days. A new company with a late payout shows both "New on BuPulse" and "Some payments late".
- **Hidden campaigns** (admin) take no new applications at all, neither one-tap nor the form; their page stays for
  the creators already in it, `noindex`. Unlisted campaigns take both kinds through their link.
- **`/c/<slug>`** shows the places left and the payment record. A visitor gets the form (plus "Sign in to apply in one
  tap"); a signed-in creator gets one-tap (or "Complete my profile", or "You applied" / "invited you"); a signed-in
  person without a creator profile gets "Creators apply with a creator account". With no place left the page says so
  and shows no form (the form's action itself still follows phase 1). Shared pictures: `app/creators/opengraph-image`
  and `app/c/[slug]/opengraph-image` (text only: campaign, company, first pay line).
- **Sign-up.** `/creators/signup` is `noindex`; the same per-address and per-email limits and Turnstile as the company
  sign-up; a known email is sent to sign in (`next=/creator`). The confirmation link opens `/auth/confirm?next=/creator/profile`,
  where `ensureAccount` makes the User row and profile (name from `full_name`, WhatsApp read as Rwandan without "+").
  No sign-up event or referral is recorded for creators. A signed-in company person on `/creators/signup` is told to
  sign out first. The login page links to it ("A content creator?").
- **Profile.** WhatsApp is required to save. Handles for any network (not only one campaign's), each with followers.
  A network shows **Verified** when the creator has an ACTIVE connected account on it. One-tap needs WhatsApp and a
  typed handle on one of the campaign's platforms (a connection alone has no follower count); samples are optional.
  `?next=/c/<slug>` brings them back to the campaign after saving.
- **One-tap apply** (lib/creators/quick-apply.ts): the email is the login's; only the handles on the campaign's
  platforms are copied; 20 an hour per creator; refused when the profile or the email already has a row in the campaign
  (an open invitation says so), and when no place is left (APPLIED does not take a place, so there is no lock).
- **Invitations** (lib/creators/offer-answers.ts): an expired invitation can't be accepted or declined. An open
  invitation already holds its place, so accepting counts every other place holder (SELECTED, JOINED, open
  invitations) against `creatorsPerCampaign` under the company's per-campaign lock (refused only if the plan shrank),
  refuses ENDED campaigns and blocked creators, and opens the campaign. Withdrawn invitations and admin blocks turn
  OFFERED into DECLINED on the company side; they show under Ended. The company is not emailed
  on an answer (it sees the status). Expired invitations stay under Invitations (marked Expired) for 14 more days, then
  move to Ended.
- **Campaigns page groups** (lib/creators/portal-groups.ts): Invitations, Joined (JOINED, campaign not ENDED), Waiting
  for the company (APPLIED, SELECTED; also applications sent with the form under the login's email before the account
  existed), Ended (ENDED campaigns, REMOVED, DECLINED: "Not picked", or "Invitation closed" for an invitation declined, withdrawn or closed by a block). Today's tasks moved to Tasks; the
  home shows a "N tasks to hand in today" link, and a "Complete your profile" notice while it is incomplete.
- **Tasks tab**: JOINED campaigns not ENDED, with "N tasks to hand in today"; a campaign shows Today and Other days.
  The hand-in page's back link goes to the campaign's tasks.
- **Reports**: "Report this campaign" (folded) on `/c/<slug>` for signed-in creators and at the bottom of the portal's
  campaign page.

## Code map

| Part | Where |
| --- | --- |
| Tables | migration `20261029100000_creator_marketplace` (CreatorCampaign.listed/hiddenAt, CreatorProfile fields, CampaignCreator.source/offeredBy/offeredAt and OFFERED, CreatorReport) |
| Marketplace, creator sign-up, profile, one-tap apply, portal changes, creator reports | `lib/creators/market-filters.ts` (rules), `lib/creators/marketplace.ts`, `lib/creators/logos.ts`, `lib/creators/profile-form.ts` (forms), `lib/creators/profile.ts`, `lib/creators/quick-apply.ts`, `lib/creators/quick-apply-form.ts`, `lib/creators/offer-answers.ts`, `lib/creators/portal-groups.ts`, `lib/account.ts` (creator branch of `ensureAccount`), `app/creators/**`, `app/c/[slug]/**`, `app/creator/(portal)/**`, `components/creators/marketplace/**` |
| Company finder, offers, company reports, listing switch, payment record, admin hide, block and reports | `lib/creators/finder.ts`, `lib/creators/offers.ts`, `lib/creators/record.ts`, `lib/creators/reports.ts`, `app/dashboard/creators/find/**`, admin console pages |
| Client guide | `docs/guide/features/37-creator-campaigns.md` (company: listing, finding creators), `38-for-creators.md` (creators: marketplace, profile, offers) |
