# Handover: Content page redesign and auto-approval

Built 13 October 2026 on branch `v2-contentui` (worktree `~/BuPulse-v2-contentui`, from `v2-media`). Not pushed, not
merged. No database was touched: the migration was written and `npx prisma generate` was run. How it works:
`docs/CONTENT.md`.

## What works (tested locally, no database)

- Content page: "Today" (posts made today waiting for review, Approve / Edit / Reject, Approve all), the auto-scheduled
  notice, filters in the URL (app, post type, date created or scheduled/posted with Today, 7 days, 30 days, custom,
  status, auto-scheduled), the grid of products, campaigns and General with covers, counts, search and sort.
- Subject pages with post cards (picture, carousel dots, video still with play mark, app and type badge, caption
  excerpt, status chip, created date) opening the calendar's post detail and composer, infinite scroll, `?post=` links.
- Content -> Settings: "Require my approval before posting" per app; Owner/Admin only, audited; default approval on.
- Studio content now drafts one post per connected app (source STUDIO) that waits for review; drafts take the
  picture or video when it is finished.
- Auto-approval for Studio and Autopilot at the best time with safety rules (plan, channel, picture, video, network
  rules), "Back to review" on scheduled posts, the daily summary email (cron hourly, sent from 08:00 local).

## Decisions to confirm with the owner

- **Videos not rendered yet stay in "Needs review"** ("Video needs to be made: open to render") instead of going out
  as the picture: the idea was written as a video and TikTok/YouTube take no pictures. A script reminder with no video
  planned (plan without video) is scheduled as before.
- **Studio drafts replace older waiting drafts** of the same product or campaign on every rewrite or edit, so the
  Today list does not fill up with versions.
- Autopilot's "Post without asking" stays as a master switch; with it off, Autopilot follows the per-app settings.
- Changing a setting does not touch posts already waiting.
- "Story" is not a post type: BuPulse cannot publish stories. "Blog/website" is not an app yet.

## Migration

`20261016090000_content_auto_approval` (after `20261015090000_content_visuals`): `PostSource` + `STUDIO`;
`Business.contentSettings`, `contentSummarySentAt`; `Post.reviewNote`, `autoScheduledAt`, `mediaKind` with CHECK and
the trigger `Post_media_kind` (function `bupulse_post_media_kind`, EXECUTE revoked), backfill of `mediaKind`; two
indexes. Columns only, no new table. `ALTER TYPE ... ADD VALUE` must not share a transaction with a use of the value
(it does not). Deploy order: back up, `prisma migrate deploy`, then the code.

## New cron

`/api/cron/content-summary` hourly at :07 (Cloudflare `7 * * * *`, Netlify `cron-content-summary`, Admin cron list).
Cloudflare now has 11 cron triggers; check the account's limit before deploying.

## Not done / next

- No browser check was run (no database); the screens were built from the design system and typed, linted and built.
- The summary email is English only, like the other publishing emails.
- Posts made in the composer without a product or campaign land in General; there is no way to move a post to a
  product yet.
