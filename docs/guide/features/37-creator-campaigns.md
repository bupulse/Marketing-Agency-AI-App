# Creator campaigns

Content creators post about your business on their own Instagram, Facebook Page or TikTok. You write the brief and the
daily tasks, set the pay, and share one link where creators apply. You pick the ones you like; they get a creator
login, connect their accounts and hand in a post every day. BuPulse reads every post's views and works out what each
creator earned. You pay them yourself by Mobile Money and mark each payout paid: BuPulse never holds the money.

**Where:** Menu → Publish → **Creators** (`/dashboard/creators`). **Plans:** feature key `creators`: the Business plan
and custom plans. Only Owners and Admins run campaigns (permission `creators`); Members do not see the page.
**Limits:** 2 campaigns live or paused at once and 20 creators per campaign, unless your plan says otherwise (Admin →
Plans → Live creator campaigns, Creators per campaign).

## Start a campaign

1. **Creators → New campaign.** Write the name and the **brief** (what the posts should show), your own **rules**
   (optional), and pick the **platforms**. Instagram must be a professional account and Facebook a Page: personal
   accounts cannot share their views.
2. Pick the **first and last day** (your timezone, at most a year) and the **required mentions**: `@yourhandle`,
   `#yourhashtag` or a link. The caption must contain one of them. Leave it empty for no check.
3. Set the **pay**, any mix of: an amount per 1,000 views, an amount per post handed in, **milestones** (a one-off
   amount when a post reaches a number of views) and the most one post or one creator earns in a period. Under it you
   see the rules as creators will read them. Rules that pay nothing are refused.
4. Set the **goals** of each 30-day period: views per creator, views of all creators, and a **budget**. Views past a
   target do not earn; when all creators together pass the campaign target, everyone's counted views shrink by the
   same share. Leave a field empty for no limit.
5. Add **your questions** for the application form (optional), then **Save as a draft**.

The campaign is split into 30-day **pay periods** (the last one can be shorter), each with the goals you set.

## Tasks

**Tasks** say what to post. A task covers some days and repeats on each of them: every day of its span, a creator
hands in its posts. **Add a task**: title, what to post, days (**Whole campaign**, **One week** or **One day** fill
them in), posts a day (1 to 10), video, photo or either, and the platforms. With more than one platform, choose
**one post on any of them** or **a post on every one of them**. **Make: one task per week / per day** creates one task
for each week or day of the span with the same words, to change one by one after. A task creators already handed in
cannot be deleted; change it instead.

## Go live and share the link

**Go live** needs a task. The campaign's page `/c/<name>` (top of every campaign page, with **Copy**) shows the brief,
your rules, the platforms, the dates and the pay; creators apply there. **Pause** stops hand-ins until you **Resume**.
**Settings → Close applications** keeps the page up without taking applications.

## Applicants

Each application shows the name, WhatsApp number, email, accounts with follower counts, links to their best posts and
the answers to your questions. **Select** picks them: a link to make their creator login (it works once, for 14 days)
is emailed to them and shown to you with **Copy link** and **Send on WhatsApp**. Lost it? **New link** makes another
(the old one stops working). **Decline** says no; declined applicants can still be picked later. Invited and joined
creators count towards your plan's creators per campaign.

## Creators and posts

**Creators** lists who joined, with their posts, views, what they earn this period, what is to pay and what was paid.
Open one for their posts with every number and what each post earns this period. **Remove** takes a creator out: they
cannot hand in any more; posts already handed in keep what they earn this period (reject them to take that away).

**Posts** lists every post link with its checks (on the creator's own connected account, posted on the task's day give
or take a day, with one of your mentions), its status (Checking, Counting views, Not valid, Removed, Rejected, Final),
views, reach, likes, comments and shares. Posts count the moment they are handed in. **Reject post** (or **Reject the
whole hand-in**) with a reason the creator sees: it earns nothing from then on, its pay leaves payouts not paid yet,
and pay already paid for it comes off the creator's next payout.

## Overview

Views, reach, posts and creators so far; **views per day** (read every 6 hours); the period running now against its
goals and budget, what creators earned so far in it and, when pay was cut, why in plain words (a target or a cap was
reached, or the budget); the top creators and top posts.

## Payouts

Every period: **Running** shows what each creator has earned so far (it can still change); **Closed** shows the
payouts written at its end. Pay each creator by Mobile Money, then **Mark paid** with the reference from the
confirmation message: the creator sees it as paid. **Change goals** changes the targets and budget of a period that is
running or still to come.

## Settings

Change the campaign. The dates and the currency change only while it is a draft. New pay rules count for the period
running now and the ones after it; periods already closed keep what they paid. New default goals go to the periods
that have not started. **Delete draft** works while nobody applied. **End campaign** (top of the page) stops
applications and hand-ins: the period running now still closes on its last day and pays what was earned.

## For developers

- Spec and the owner's decisions: `docs/CREATOR_CAMPAIGNS.md`.
- Pages: `app/dashboard/creators/**` (list, `new`, `[id]` overview, `tasks`, `applicants`, `creators`,
  `creators/[creatorId]`, `posts`, `payouts`, `settings`); server actions in `app/dashboard/creators/actions.ts`.
- Components: `components/creators/company/**`.
- Services: `lib/creators/campaigns.ts` (campaigns, tasks, applicants, invites, rejecting, payouts, goals),
  `lib/creators/analytics.ts` (overview, views per day, creators, posts, payout periods), `lib/creators/company-forms.ts`
  (form rules and plain words, shared with the forms), `lib/creators/slug.ts`; pay maths in `lib/creators/pay.ts`,
  `periods.ts`, `ledger.ts`.
- Tables: `CreatorCampaign`, `CreatorTask`, `CampaignCreator`, `CreatorSubmission`, `CreatorPost`,
  `CreatorPostSnapshot`, `CreatorPeriod`, `CreatorPayout`.
- Tests: `tests/creators/`.
