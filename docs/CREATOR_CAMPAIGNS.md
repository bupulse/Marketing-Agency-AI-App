# Creator campaigns

A company runs a campaign for content creators. Creators apply, the company picks them, and they post the campaign's
daily tasks on their own Instagram, Facebook Page or TikTok. BuPulse reads each post's views and works out what every
creator earned. The company pays the creators itself by Mobile Money and marks each payout paid. BuPulse never holds
the money.

Feature key `creators` (lib/features.ts), on the Business plan and custom plans (migration
`20261028100000_creator_campaigns`). It runs on BuPulse-Socials (Composio): with Composio switched off in Admin, the
feature is unusable.

The owner's decisions (21 October 2026) are the rules below. Where this page says "owner decision", don't change it
without asking.

## People and links

| Who | Where | What they can do |
| --- | --- | --- |
| Company (owner, admins, editors with `creators` permission) | `/dashboard/creators` | Create and run campaigns, tasks, applicants, creators, posts, analytics, payouts |
| Anyone | `/c/<slug>` | Read the campaign brief and rules, apply |
| Selected creator, from the invite link | `/creator/join/<token>` | Create their creator login (or add the campaign to the one they have) |
| Creator | `/creator` | Their campaigns, the day's tasks, handing in, connections, earnings |

- **One login across companies** (owner decision). A creator's `User` row has a `CreatorProfile` and no
  `Business` or `Membership`. Each campaign link adds a `CampaignCreator` row to the same profile.
- A creator who opens `/dashboard` is sent to `/creator`. A company person who opens `/creator` without a profile is
  sent to `/dashboard`.
- Invite links are single use, 14 days, with only the sha-256 of the token stored (like team invites,
  lib/team/service.ts). The account is created with the email from the application.

## Applying (owner decision: a link per campaign)

The public page `/c/<slug>` shows the brief, the rules, the platforms, the dates and the pay rules in plain words. The
form asks for:

- name, WhatsApp number (required) and email (required: it becomes the login);
- the handle and follower count for each campaign platform (at least one);
- 1–3 links to their best posts;
- the company's own questions (`CreatorCampaign.questions`: `[{ id, label, required }]`).

One application per email per campaign. Applications are rate limited by IP and campaign. A campaign accepts
applications only while it is `LIVE` (or `DRAFT` with a preview for the company) and `acceptingApplications` is on.

## Campaigns, tasks and days

- A campaign has a brief, written rules, platforms (`instagram`, `facebook`, `tiktok`), first and last day (company
  timezone), required mentions, pay rules and default view targets.
- `mentions` lists the words the caption must contain: `@handle`, `#hashtag` or a link. Any one is enough. Empty
  means no check.
- **Tasks** say what to post. A task covers a span of days and repeats on every day of it: one task for the whole
  month, one per week, or one per day (owner decision). Each day of its span, the creator hands in `postsPerDay` posts
  for it.
- For each task the company picks `ALL` (a post on every one of the task's platforms) or `ANY` (one post on any of
  them) (owner decision). `mediaKind` is `VIDEO`, `IMAGE` or `ANY`.
- A creator hands in a task for a day with: the title, the caption they used, the uploaded images or videos, and the
  link of the post on each platform they posted on. That is one `CreatorSubmission` with one `CreatorPost` per link.
- **Auto-approved** (owner decision). A submission counts the moment it's handed in. The company can reject it (or
  one post of it) later, with a reason. That works like a removed post (below).

## Checks BuPulse makes on every post link (owner decision: all four)

1. **Own account**: the link must be a post of an account the creator connected (`CreatorConnection`). It's found
   on that account through Composio, which also gives its id, date and caption.
2. **On time**: the post's date (from the network) must fall on the task's day in the company timezone, or the day
   before or after, to allow for timezones. That stops reuse of old videos.
3. **Mention**: the network's caption must contain one of the campaign's `mentions`, case-insensitive.
4. **Stays up**: every post is read at least once a day until the campaign ends. A post that's gone (deleted,
   private, or the account disconnected for over 3 days) becomes `REMOVED` (owner decision: "lose that post"):
   - its pay in the open period and in any DUE payout drops to 0 (`withoutPost`);
   - pay it earned in a PAID payout is taken off the creator's next payout (`deductionsFor`);
   - the creator and the company are told.

A link that fails check 1, 2 or 3 is `INVALID` with the reason shown to the creator, who can fix it and hand in
again. It earns nothing. Statuses of `CreatorPost`: `CHECKING`, then `TRACKING`, `INVALID`, `REMOVED`, `REJECTED`, or
`FINAL` (the campaign ended and the last period closed).

**Accounts** (owner decision): Instagram must be a professional account (Creator or Business). Facebook must be a
Page. Personal accounts can't share views, and screenshots aren't accepted.

## Reading views

- Every 6 hours (owner decision) the job `/api/cron/creator-views` (Netlify `cron-creator-views`) reads the views,
  impressions (reach), likes, comments and shares of tracked posts, and writes a `CreatorPostSnapshot` when they
  changed.
- To stay inside Composio's free calls, it reads **per connected account**, not per post: one list call returns many
  posts with their numbers. Posts older than 7 days are read once a day. Calls are reserved with
  `reserveComposioCalls` (lib/social/inbox/budget.ts), and the job stops early, without failing, when the month's
  budget is low.
- At a period's end the job takes a final reading, closes the period and writes the payouts.

## Pay (lib/creators/pay.ts, lib/creators/ledger.ts)

- **30-day periods** (lib/creators/periods.ts), each with its own goals (`CreatorPeriod.viewTargetPerCreator`,
  `viewTargetCampaign`, `budget`), copied from the campaign's defaults when the campaign is made. The company can
  change an open period's goals. Each period is paid at its end, even when the campaign is longer (owner decision).
- **Views count in the period they happen** (owner decision): reading at the period's end minus reading at its start.
- **Targets** (owner decision: both). Views past the creator's target don't earn. When all creators together pass the
  campaign target, everyone's counted views are scaled by the same share.
- **Pay rules** (owner decision: all four):
  - a rate per 1,000 counted views;
  - milestones (a one-off amount when a post's total views reach a number, paid once);
  - a fee per post handed in during the period;
  - caps per post, per creator per period, and the period's budget, applied in that order.
- Amounts are whole units of the campaign currency, rounded down.
- **Payouts**: when a period closes, a `CreatorPayout` is written for every creator who earned (amount = earned minus
  deductions, never below 0; anything still owed is in `breakdown.stillOwed`). The company pays by MoMo, types the
  reference, and marks it PAID. The creator sees it as paid.

## Limits

- Plan limits `liveCampaigns` (LIVE or PAUSED campaigns at once) and `creatorsPerCampaign` (SELECTED + JOINED), in
  `PlanDefinition.limits`. When missing: Business 2 and 20, custom plans as their admin sets.
- Uploads go to the private Storage bucket `creator-media`, at most 100 MB per file and 6 files per submission. They're
  deleted 60 days after the campaign ends, because the free Supabase Storage is 1 GB.

## Code map

| Part | Where |
| --- | --- |
| Tables | `prisma/schema.prisma` (CreatorCampaign … CreatorPayout), migration `20261028100000_creator_campaigns` |
| Pay rules, periods, ledger | `lib/creators/pay.ts`, `periods.ts`, `ledger.ts` |
| Company side | `lib/creators/campaigns.ts`, `lib/creators/analytics.ts`, `app/dashboard/creators/**`, `components/creators/company/**` |
| Creator side | `lib/creators/portal.ts`, `lib/creators/auth.ts`, `app/c/[slug]`, `app/creator/**`, `components/creators/portal/**` |
| Reading posts | `lib/creators/tracking/**` (Composio adapters, checks, the 6-hourly job, period close), `app/api/cron/creator-views`, `netlify/functions/cron-creator-views.mts` |
| Client guide | `docs/guide/features/37-creator-campaigns.md` |
