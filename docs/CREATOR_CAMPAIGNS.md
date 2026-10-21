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

## Creator side: details decided while building (21 October 2026)

Not owner decisions; change them freely.

- **Logins.** `/creator/join/<token>` with a new email makes the Supabase login (confirmed), a `User` row with no
  Business or Membership, the `CreatorProfile`, and claims the invite (SELECTED -> JOINED with one conditional update,
  so a link opened twice joins once). An email that already has a login signs in first; only that login may use the
  link (it was sent to that address), and a profile is made for it when missing (a company person can be a creator
  too, and keeps the dashboard). `getAppContext` and `/welcome` send a person who has a profile and no company to
  `/creator`; `requireCreator()` (lib/creators/auth.ts) sends a signed-in person without a profile to `/dashboard`.
- **Applying.** `/c/<slug>` is shown for LIVE campaigns (with the form while `acceptingApplications`), PAUSED and ENDED
  ones (with "not taking applications"), and DRAFT ones to members of the company only (a preview; the form cannot be
  sent). Never indexed. Limited to 8 applications per hour per address and campaign; a honeypot field. The WhatsApp
  number becomes E.164: written with "+" it can be any country, else it is read in the company's country (Rwanda when
  unknown). Followers can be typed "12k" or "1.5M".
- **Hand-ins.** For any day of the task from its first day to today (not the future); `postsPerDay` hand-ins per task
  and day count, and a hand-in whose links are all INVALID does not count, so the creator can hand in again. Every
  platform given a link must be connected first. Files: `creator-media` bucket (migration
  `20261028200000_creator_media_bucket`, no Storage policies), path `<profileId>/<campaignId>/<uuid>-<name>`, images
  (JPEG, PNG, WebP, HEIC) and videos (MP4, MOV, WebM); a VIDEO task takes videos only, an IMAGE task photos only. **The
  Supabase Free plan caps any upload at 50 MB** whatever the bucket says: files of 50-100 MB need the Pro plan.
- **PAUSED** campaigns take no hand-ins and no applications; their posts keep being read and their periods close.
  ENDED campaigns' open periods still close at their end.
- **Checks.** The mention: `@name` and `#tag` must stand on their own (`#leaf` does not match `#leafy`), a link
  matches with or without `https://` and `www.`. A link that cannot be checked now (network down, account needing a
  new sign-in, the month's Composio calls used up) stays CHECKING with the reason; the job tries again and gives up
  (INVALID) after 3 days. Only a TRACKING post holds the network's id (`externalId`), so an INVALID link never blocks
  handing in the same post again once it is fixed. A post already counted (any campaign) is refused with "A post can
  earn in one campaign only".
- **Stays up.** A post missing from the account is REMOVED only when a second reading at least 6 hours later misses
  it too (a network can answer short for a while). "Disconnected for over 3 days" counts from the last good reading
  of the account (`CreatorConnection.lastCheckedAt`), or from the moment the creator pressed Disconnect.
- **Readings.** Views never go down in BuPulse (a network recount lower is ignored); a number a network did not give
  keeps the last one. A reading due within 30 minutes is taken now (the job is 6 hours apart). At a period's end the
  final reading is stored at the period's `endsAt` exactly, so it is both that period's end and the next one's start,
  and other readings of that campaign wait until it is closed. The close waits for the final reading, up to 24 hours;
  after that it closes with the readings it has.
- **Payouts.** A creator who earned nothing in a period gets no payout row; deductions they owe wait for one that can
  carry them, except after the last period, when a row records what is still owed (`breakdown.stillOwed`).
- **Telling people.** Emails (best effort, lib/creators/tracking/notify.ts): the creator and the company when posts
  are removed (one email per person per run), the creator when an account needs signing in again, and the creator and
  the company when a period's payouts are written. In the app: each post's status and reason, and "Stopped earning
  lately" on the portal's home page.
- **Composio.** A creator's Composio user is `creator_<profileId>`. The job's calls are reserved against the inbox's
  monthly limit (`pollLimit` of Admin -> Services -> Instagram and Facebook replies), the same pool as the inbox check;
  a creator's own sign-in is counted but never blocked. The Composio connected-account id is stored as it is (it opens
  nothing without BuPulse's key). One network account belongs to one creator profile.
- **TikTok** has no Composio-managed sign-in, so it needs an auth config made in Composio with BuPulse's own TikTok
  developer app (scopes `user.info.basic`, `user.info.profile`, `video.list`), its id in
  `COMPOSIO_TIKTOK_AUTH_CONFIG_ID`. Without it the Connections page shows TikTok as "Coming soon". TikTok stays out of
  `COMPOSIO_NETWORKS`, so the company side's posting is unchanged.
- **Files** are deleted by the views job (60 days after the campaign's last day, for ENDED campaigns): every hand-in
  still listing files, plus, during the week after, each creator's whole campaign folder (uploads never handed in).

## What the networks give (checked 21 October 2026)

| Network | Account | Find a link | Read many posts | Views |
| --- | --- | --- | --- | --- |
| Instagram | `INSTAGRAM_GET_USER_INFO` (`ig_user_id: "me"`, `fields` incl. `account_type`, `user_id`) | `INSTAGRAM_GET_IG_USER_MEDIA` (`ig_user_id`, `fields`, `limit` up to 100, `since`, `after`), matched on `shortcode` / `permalink` | the same list, `since` the oldest post, then `INSTAGRAM_GET_IG_MEDIA` (`ig_media_id`) for any not in it | insights `views`, `reach`, `shares`: as `insights.metric(...)` inside the list call, else `INSTAGRAM_GET_IG_MEDIA_INSIGHTS` (`ig_media_id`, `metric` array) per post |
| Facebook | `FACEBOOK_LIST_MANAGED_PAGES` | `FACEBOOK_GET_PAGE_POSTS` (`page_id`, `fields`, `limit` up to 100, `since`, `until`), matched on ids in `permalink_url` / the post id | the same list stepping back with `until`, then `FACEBOOK_GET_POST` (`post_id`) | `post_media_view` (views) and `post_total_media_view_unique` (reach): inside the list call, else `FACEBOOK_GET_POST_INSIGHTS` (`post_id`, `metrics`) |
| TikTok | `GET /v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username` (proxy) | `POST /v2/video/query/` with `filters.video_ids` (the id is in the link) | the same, 20 ids a call; an id left out is gone or not the account's | `view_count`, `like_count`, `comment_count`, `share_count` on the video |

What the docs say, and where:

- Composio Instagram toolkit (https://docs.composio.dev/toolkits/instagram): Composio-managed OAuth, Instagram Login.
  The tools and arguments above. Media fields listed include `id, caption, media_type, permalink, timestamp,
  comments_count, like_count, shortcode, media_product_type, view_count, shares_count, total_views_count`; insights
  metrics "views, reach, saved, likes, comments, shares, total_interactions, reposts", with `impressions`, `plays`,
  `video_views` deprecated. The `insights.metric(...)` expansion inside the list call is **not documented** there: the
  code tries it and falls back to one insights call per post when it is refused.
- Meta, IG Media (https://developers.facebook.com/docs/instagram-platform/reference/instagram-media): `view_count` is
  Business Discovery only, `total_views_count` and `shares_count` Facebook Login only, so with Instagram Login views
  come from insights. IG Media insights (https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights):
  `views`, `reach`, `shares`, `likes`, `comments` for FEED and REELS; `impressions` deprecated for media after
  2 July 2024; a metric with no data is left out (not 0); data can lag up to 48 hours; Graph v26.0; permissions
  `instagram_business_basic`, `instagram_business_manage_insights`.
- Composio Facebook toolkit (https://docs.composio.dev/toolkits/facebook): the tools above;
  `FACEBOOK_GET_POST_INSIGHTS` lists `post_media_view` and `post_total_media_view_unique`. `FACEBOOK_GET_PAGE_POSTS`
  has no cursor, hence `until`. Meta insights (https://developers.facebook.com/docs/graph-api/reference/insights):
  `post_impressions` and `post_impressions_unique` deprecated from v25; "By June 15, 2026, a number of the Page
  Insights metrics will be deprecated for all API versions" (which ones is not said). The expansion inside the list
  call is tried the same way as Instagram's.
- Composio TikTok toolkit (https://docs.composio.dev/toolkits/tiktok): "Composio-managed OAuth available? No"; tools
  include `TIKTOK_LIST_VIDEOS` (`cursor`, `max_count`) and `TIKTOK_QUERY_VIDEOS` (`video_ids`), whose fields are not
  stated, so BuPulse calls TikTok through Composio's proxy with its own `fields`. TikTok Display API:
  video query (https://developers.tiktok.com/doc/tiktok-api-v2-video-query) `POST /v2/video/query/`, up to 20
  `video_ids`, scope `video.list`, only the user's own videos; video list (https://developers.tiktok.com/doc/tiktok-api-v2-video-list)
  `max_count` up to 20, `cursor`, `has_more`; video object (https://developers.tiktok.com/doc/tiktok-api-v2-video-object)
  `id, create_time` (seconds), `share_url, video_description, title, view_count, like_count, comment_count,
  share_count`; user info (https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info) `open_id, union_id,
  avatar_url, display_name` (`user.info.basic`), `username` (`user.info.profile`). TikTok answers HTTP 200 with
  `error.code` "ok" on success.
- **Not checked yet, for the owner's first real test:** that Composio's managed Instagram and Facebook apps hold the
  insights permissions (without them views read 0 and the posts earn nothing), that the insights expansion works in
  the list calls (otherwise each post costs one more call per reading), and how a deleted post answers on each network
  (the code treats "does not exist" / `(#100)` on a by-id read as gone, and asks twice before removing).

## Code map

| Part | Where |
| --- | --- |
| Tables | `prisma/schema.prisma` (CreatorCampaign … CreatorPayout), migration `20261028100000_creator_campaigns` |
| Pay rules, periods, ledger | `lib/creators/pay.ts`, `periods.ts`, `ledger.ts` |
| Company side | `lib/creators/campaigns.ts`, `lib/creators/analytics.ts`, `app/dashboard/creators/**`, `components/creators/company/**` |
| Creator side | `lib/creators/portal.ts`, `auth.ts`, `join.ts`, `apply.ts`, `application.ts`, `handin.ts`, `media.ts`, `connections.ts`, `connect-flow.ts`, `describe.ts`, `tasks.ts`, `app/c/[slug]`, `app/creator/**`, `app/api/creator/[network]/{connect,callback}`, `components/creators/portal/**` |
| Reading posts | `lib/creators/tracking/**` (links, checks, adapters, resolve, the 6-hourly job, close, removal, notify, cleanup), `app/api/cron/creator-views`, `netlify/functions/cron-creator-views.mts` (every 6 hours at :31 UTC, cursor calls), `worker-crons.ts` `CREATOR_VIEWS_CRON` |
| Tests | `tests/creators/*.test.ts`; against the TEST database: `RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/creators/flow.db.test.ts` |
| Client guide | `docs/guide/features/37-creator-campaigns.md`, creators: `docs/guide/features/38-for-creators.md` |
