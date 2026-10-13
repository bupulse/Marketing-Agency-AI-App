# Content

The Content page (`/dashboard/content`) is where the owner reviews new posts and finds every post by product,
campaign or app. Content -> Settings decides, per app, whether new posts wait for approval. Code:
`lib/content-board/`, `components/content-board/`, `app/dashboard/content/`.

## Layout

1. **Today.** Posts created today (business time zone) that wait for review: a count and cards, each with Approve
   (scheduled at the best time for its app), Edit (the composer) and Reject (deletes it, after a confirm), plus
   "Approve all". Older posts still waiting are one link away (`?status=review`). On phones the cards scroll sideways.
2. **Auto-scheduled notice.** When posts were scheduled on their own in the last 24 hours, a notice says how many and
   links to them (`?auto=1&status=scheduled`).
3. **Filters** (both levels, all in the URL, so a view can be shared): status chips inline (All, Needs review,
   Scheduled, Posted, Failed) and a "Filters" sheet (a bottom sheet on phones) with App, Post type, Status,
   Auto-scheduled and Date. Active filters show as removable chips.
4. **Grid.** One card per product, one per campaign and a **General** card for posts tied to neither (Autopilot tips,
   greetings, brand posts, composer posts without a subject). Each card: cover (the first album photo, else the newest
   picture BuPulse drew for it, else an icon), name, kind, and Needs review / Scheduled / Posted counts (Failed when
   any). Search and sort (latest activity, most to review, name) are a plain GET form. Archived products and campaigns
   show only while they have posts. With a post filter on, only subjects with matching posts show.
5. **A subject's posts** (`/dashboard/content/products/<id>`, `/campaigns/<id>`, `/general`): cards that read like a
   social post but in BuPulse's look: the picture, carousel (dots) or video (still with a play mark), the app icon and
   post type, 2 to 3 lines of caption, a status chip (Needs review, Scheduled for <date time>, Posted <date>, Failed,
   Draft, Post it yourself), the review reason when there is one, and the created date. A card opens the calendar's
   post detail (preview, Approve, Move, Back to review, Edit, Duplicate, Delete); Edit opens the composer. `?post=<id>`
   opens one post on arrival (links in the summary email). More posts load as the end of the list scrolls into view
   (`limit` grows by 24, up to 240), with a "Show more" link as the fallback.

Empty states give the next step: no products ("Add a product or service"), no connected app ("Connect an app"), a
product or campaign without posts ("Generate posts for this product", which writes the content and drafts the posts),
General ("Set up Autopilot"), nothing matching ("Clear filters").

`/dashboard/content` keeps its URL; the old "latest text per product" list was replaced (the text stays on each
product's and campaign's page). No other URL changed, so no redirect was needed.

## Filters (`filters.ts`, pure)

| Param | Values | Meaning |
| --- | --- | --- |
| `app` | `instagram,facebook,linkedin,tiktok,youtube` | the networks BuPulse supports (`NETWORKS`) |
| `type` | `post,carousel,video,article` | from the post's format and media: a video is a Reel on Instagram, a Short on YouTube, a Video elsewhere (SCRIPT reminders included); `article` is LinkedIn's long post. Stories are not supported by BuPulse, so there is no Story type. |
| `status` | `review,scheduled,posted,failed` | review = PENDING_APPROVAL and DRAFT; scheduled = SCHEDULED, PUBLISHING, NEEDS_ACTION; posted = PUBLISHED; failed = FAILED. Cancelled posts are never listed. |
| `date` | `created` (default) or `planned` | which date the range uses |
| `range` | `today`, `7d`, `30d`, `custom` (+ `from`, `to` as `YYYY-MM-DD`, inclusive) | in the business's time zone. Created looks back N days; "Scheduled or posted" looks N days back (posted) and N days ahead (scheduled). |
| `auto` | `1` | only posts auto-approval scheduled |
| `q`, `sort` | text; `recent`, `review`, `name` | grid search and order (on a subject page `q` searches the post text) |
| `limit` | 24 to 240 | how many posts a subject page shows |

Unknown values are ignored. `contentWhere` turns the filters into one Prisma `where`, always with the business id.
The type filter reads `Post.mediaKind`, a column a database trigger keeps from `format` and `mediaPaths`
(`bupulse_post_media_kind`, migration `20261016090000_content_auto_approval`; `kind.ts` is the same rule in TypeScript),
because a video post on Instagram or Facebook has format POST and its video is only visible inside the array.

Counts come from one `post.groupBy(productId, campaignId, status)` under the filters (without status and search), and
`grouping.ts` (pure) turns them into cards. Pictures, carousel slides, video stills (the content's picture) and covers
are signed in one batched request per bucket (`signPaths`) and lazy-loaded.

## Where posts come from

- **Studio.** When content is written or edited for a product or campaign (the Studio buttons and `POST /api/generate`),
  `drafts.ts` drafts one post per usable connected app (`source STUDIO`, `PENDING_APPROVAL`, one `groupId`): Instagram,
  Facebook and LinkedIn get their own version of the caption and the content's picture or carousel; TikTok and YouTube
  get the video script (SCRIPT) with the video once it is made. Older drafts of the same product or campaign that still
  wait are replaced, in the same transaction as the new ones, **unless the owner edited them** (`Post.ownerEditedAt`,
  set by edits in the composer, media changes, moves and "Back to review"); approved, scheduled and hand-made posts are
  never touched. Scheduling a content by hand in the composer replaces its untouched drafts for the chosen accounts,
  in the same transaction. Nothing is drafted without the `calendar` feature or an account.
- **Autopilot.** Its posts are saved as before (`PENDING_APPROVAL`, or `SCHEDULED` with "Post without asking").
- When the content's picture finishes drawing or its video is uploaded, the drafts take it (`attachToContent` in
  `lib/visuals/service.ts`, as `attachToGroup` does for Autopilot) and get another auto-approval check. Only drafts
  still waiting (DRAFT, PENDING_APPROVAL) that the owner did not edit; never a SCHEDULED post. The write is guarded by
  the `updatedAt` it read, so an edit made meanwhile wins.

## Approval and auto-approval

**Settings** (`/dashboard/content/settings`): "Require my approval before posting" per app. Stored as
`Business.contentSettings` (`{ requireApproval: { instagram: false, ... } }`, zod `contentSettingsSchema`, strict);
missing or unreadable means approval required, so **the default is approval for every app**. Only Owners and Admins
may change it (`contentSettings` permission, checked in `saveContentSettings`, not only on the page); Members see the
settings read-only. Each save writes an `AuditLog` row (`action content.settings`, actor `user:<person>`, target
`company:<id>`, before and after as the list of apps that skip approval) in the same transaction. Changing a setting
only affects new posts.

**Approve** (`approvePosts`): keeps a planned time that is still ahead (Autopilot's), else the best time
(`lib/publishing/best-time.ts`, pure, Autopilot's rules for one post): the business's posting times, the one nearest
the network's preferred hours first (learned from its own results when there are 6 or more, else `NETWORK_DEFAULTS`),
the coming week's preferred weekdays first, never in the past or within 15 minutes, and 2.5 hours from other posts on
the same account (posts approved together included). Falls back to the next free queue slot. Clears `reviewNote`.
The time is written by `claimSlot`: under a per-account advisory lock it checks that no queued post on the account is
within 2.5 hours, and picks a new best time (up to 3 tries) when another approval took the slot meanwhile.

**Auto-approval** (`auto.ts`, rules in `rules.ts`, pure): after Studio drafts posts, after an Autopilot run, and when a
post's picture or video is finished, every waiting post whose app needs no approval is scheduled at the best time,
with `autoScheduledAt` set, unless a safety rule keeps it in review with `Post.reviewNote`. Every write is guarded by
the post's `updatedAt` as the safety checks read it (a post changed meanwhile is left waiting) and goes through
`claimSlot`. Plans have no post cap (only text, images, video seconds, voice and chat are metered), so there is no
post limit to enforce:

| Rule | Reason shown |
| --- | --- |
| no `calendar` feature, or the account is read-only | "Scheduling is not part of your plan right now..." |
| no account / account must be reconnected | "Connect this app in Channels first." / "<App> needs to be reconnected first..." |
| video idea whose video is planned but not rendered | "Video needs to be made: open to render." |
| picture still being drawn / missing where the app needs one | "The picture is still being made: open it to finish." / "This post needs a picture..." |
| the network's rules (length, hashtags...) | the rule's own message |

**Video decision.** Videos are rendered in the owner's browser, so the server cannot finish them. A video idea with a
planned video waits in review with "Video needs to be made: open to render" (the post detail links to its product,
campaign or Autopilot card, where the video renders when opened); it is not swapped for the picture, because the idea
was written as a video (a script) and a TikTok or YouTube post cannot be a picture. As soon as the video is uploaded the
post is checked again and scheduled. A video idea with no video planned (the plan has no video) is the network's script
reminder, as before, and is scheduled.

**Autopilot.** "Post without asking" still schedules every Autopilot post. With it off, Autopilot's posts follow the
per-app settings; the "approve them" email goes only when some posts still wait.

**Safety window.** Auto-scheduled posts carry an "Auto" mark and stay editable until they go out: Edit, Move, Delete,
and **Back to review** (`unschedulePost`: SCHEDULED and not picked up by the publisher -> PENDING_APPROVAL).

**Daily summary** (`summary.ts`): the cron `/api/cron/content-summary` runs hourly at :07 (`CONTENT_SUMMARY_CRON` in
`worker.ts`, `wrangler.jsonc`, `netlify/functions/cron-content-summary.mts`, Admin cron list). From 08:00 in the
business's time zone, once per local day, the Owner and the Admins who chose alerts (`alertRecipients`) get "N posts
were scheduled for you": each post's app, time and first words, a link to open it (`?post=`), a button to the
auto-scheduled view and a link to the settings. Each call reads only businesses that may be due (auto-scheduled posts
in the last 3 days and no email in the last 8 hours: a business emailed at 08:00 local or later and seen within 8 hours
is on the same local day or before 08:00), ordered by `contentSummarySentAt` (never sent first), page by page through
all of them (keyset cursor on `contentSummarySentAt, id`); after 40 s it answers `nextCursor` and the cron calls again
(cursor calls in `worker.ts` and Netlify). It lists posts auto-scheduled since the last email (the last 24 hours
for the first) that are still going out or went out; posts taken back to review or deleted are left out. The business
is claimed by compare-and-set on `Business.contentSummarySentAt`, so two runs never send twice; nothing new, no email.
The in-app notice on the Content page covers the same posts for 24 hours.

## Data

Migration `20261016090000_content_auto_approval` (columns only, no new table, so the existing RLS and revoked grants
cover them): `PostSource` gains `STUDIO`; `Business.contentSettings` (JSONB) and `contentSummarySentAt`;
`Post.reviewNote`, `autoScheduledAt`, `mediaKind` (CHECK, kept by the trigger; existing rows filled by the migration);
indexes `Post(businessId, createdAt)` and `Post(businessId, autoScheduledAt)`. The trigger function has all EXECUTE
revoked. `20261016100000_post_owner_edited` adds `Post.ownerEditedAt`.

## Permissions and plans

The page needs the `content` feature; subject pages and every post action also need `calendar` (as the calendar's
actions). Approving, rejecting and editing posts follow the `content` permission (Members included), the settings
need `contentSettings` (Owner, Admin).

## Tests

`tests/content-board/`: filters (parsing, query string round trip, date windows, the Prisma query), grouping and counts,
the auto-approval rules, auto-scheduling (per app, safety rules, plan, best time, Autopilot times, spacing, retry),
Approve and Approve all, drafts from content, settings (validation, roles, audit) and the summary email (due time,
selection, content, compare-and-set). `tests/publishing/best-time.test.ts` for the best time.
