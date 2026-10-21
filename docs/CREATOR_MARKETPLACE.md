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
  - when: open now or starting soon, with the places left (plan limit `creatorsPerCampaign` minus SELECTED and JOINED).
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
  (`CampaignCreator` with `source = "MARKETPLACE"`, `profileId` set straight away). The creator only answers the
  company's own questions. An incomplete profile (no WhatsApp, or no handle for any of the campaign's platforms) is
  asked to complete it first.
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

## Code map

| Part | Where |
| --- | --- |
| Tables | migration `20261029100000_creator_marketplace` (CreatorCampaign.listed/hiddenAt, CreatorProfile fields, CampaignCreator.source/offeredBy/offeredAt and OFFERED, CreatorReport) |
| Marketplace, creator sign-up, profile, one-tap apply, portal changes, creator reports | `lib/creators/marketplace.ts`, `lib/creators/profile.ts`, `app/creators/**`, `app/creator/(portal)/**`, `components/creators/marketplace/**` |
| Company finder, offers, company reports, listing switch, payment record, admin hide, block and reports | `lib/creators/finder.ts`, `lib/creators/offers.ts`, `lib/creators/record.ts`, `lib/creators/reports.ts`, `app/dashboard/creators/find/**`, admin console pages |
| Client guide | `docs/guide/features/37-creator-campaigns.md` (company: listing, finding creators), `38-for-creators.md` (creators: marketplace, profile, offers) |
