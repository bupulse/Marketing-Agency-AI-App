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
5. **A subject's content, a day at a time** (`/dashboard/content/products/<id>`, `/campaigns/<id>`, `/general`;
   content flow v3, below): opens on **today** in the business's time zone with "Needs your OK", "Goes out this day"
   and "Made this day"; a date bar (previous / next day, a calendar picker, "Today", `?day=YYYY-MM-DD`, a year back and
   90 days ahead) browses past days (what was made or posted then) and the coming ones (what is scheduled). The cards
   are the board's: the picture, carousel (dots) or video (still with a play mark), the app icon and post type (top
   right), 2 to 3 lines of the caption, a status chip, the review reason, the created date and the amber "Not posted
   yet" border. A card opens the calendar's post detail (preview, Approve, Move, Back to review, Edit, Duplicate,
   Delete); Edit opens the composer. `?post=<id>` opens one post on arrival. The app, type, status and search filters
   and "Schedule all my posts" (the day's posts) work within the day. Below the posts, **Pictures and videos** shows
   the day's visuals: they are drawn there while pending (the first pending video starts on its own), and can be
   changed (photo, style, texts, a new picture, video captions).

Empty states give the next step: no products ("Add a product or service"), no connected app ("Connect an app"), a day
with nothing yet ("Create today's content" today, "Back to today" on another day), nothing matching ("Clear filters").

`/dashboard/content` keeps its URL. Product and campaign pages (Knowledge base) no longer have any content tools
(latest content, visual and video panels, caption and hashtags, video script, ad headlines, versions per network,
"Write it again", version history, the design studio, "Your designs"): they keep the details and the photo album and
link to "See this product's content" (the subject's day view). The services behind them stay (`generateForSubject`
for `/api/generate`, the visuals).

## Content flow v3: "Create today's content"

Code: `lib/content-flow/` (`angles.ts`, `day.ts`, `media.ts`, `networks.ts`, `cost.ts` are pure; `writer.ts`,
`service.ts`, `autopilot.ts`), `components/content-flow/`, `app/dashboard/content/day-actions.ts`.

The button on a subject's day view opens a dialog with two ways to make the business's **today** (its time zone):

- **AI makes it for me** (`mode ai`). Step 1, captions: one post per chosen app (connected ones are preselected;
  apps not connected get a reminder post as before), one text call and one text generation each, written for the
  network (`NETWORK_STYLE`: length, hashtag count, emojis, video or not) from the Knowledge base (product or campaign
  block, company profile, customers, positioning and competitors, FAQs and policies, quotable reviews only, the
  Digital Marketing Profile's voice and do / don't) and the **day's angle**. Step 2, visuals: Gallery first (below),
  then AI people photos (when "AI designs" was chosen and credits are left; the existing people logic of
  `createAiDesign`) or free designs. The art director (one call per designed post) picks the template from the whole
  registry (`TEMPLATES`), so the owner never picks one.
- **I'll create it**: **Describe today's content** (`mode describe`): a brief ("Promote the hydro tower for schools
  this week...") and optional Gallery picks; the brief is fenced (`OWNER BRIEF`) and leads, the rest is mode A.
  **Bring my own** (`mode own`): Gallery photos or videos and one caption; per app the AI adapts length, hashtags,
  tone and emojis without changing the meaning (`adaptOwnPost`, fenced `OWNER CAPTION`, then `fitToNetwork`); if the
  call fails the owner's caption is used, held to the app's rules, and the credit is given back. The media are used as
  they are (`ownMediaFor`): a video goes to Instagram (a Reel, MP4), TikTok and YouTube (their reminder carries it),
  photos to the feed apps as a picture or carousel within the app's limit; an app that cannot take what was given is
  skipped with the reason ("TikTok needs a video."). "Add BuPulse designs over my photos" draws designs over the feed
  posts instead (no AI photos).

The design choice is made once in the dialog: **AI designs (images with people)** or **Free templates (your photos +
BuPulse designs)** (AI is offered only when `aiPhotosAvailable`).

**What a run uses** (`runCost`, shown before confirming): "Uses 4 text generations and up to 4 AI images; you have 26
text generations and 12 AI images left this month." One text generation per post (as before); at most one AI image per
designed post and never more than the credits left; videos BuPulse makes count video seconds when they are made, as
before. A run whose posts need more text generations than are left is refused before anything is charged.

**Angles** (`angles.ts`): price or offer, how it works, features and benefits, news or announcement, customer story,
tips, FAQ, why us, behind the scenes, local moment, call to action, plus a hook (6) and a structure (5). Angles the
facts cannot support are left out (no price: no offer angle; no quotable review: no customer story; no FAQ: no FAQ
angle; news only for a campaign or a product added in the last 30 days). Each pick is the least recently used for the
subject (`ContentAngle` rows, Studio and Autopilot together), ties broken by a hash of subject and day, so every angle
is used before one returns and consecutive days always differ in angle, hook and structure; a second run on the same
day takes another angle. The writer also gets the subject's last captions (30 days) with "do not repeat their opening,
wording or structure".

**Gallery first** (`media.ts`): the subject's album (a campaign without photos uses its first product's album; General
uses the newest 12 Gallery items), photos and videos. TikTok and YouTube take the album's video when there is one
(several videos are shared out), else a video made from the photos (plan with video), else the script reminder;
Instagram takes an MP4 album video as a Reel, else a picture; Facebook and LinkedIn a picture. Photos are ordered least
used first (slides and scenes of the last 30 days' visuals and posts), the day rotating equally used ones, and each
post of the run leads with a different photo. Photos the owner picked while describing come first. The writer is told
what the post shows (the file names, rename photos in the Gallery to describe them; camera names such as
`IMG_2034.jpg` are not used), so the caption relates to it. An album video is used as is (never rendered, never
removed by the 30-day video clean-up, which only touches BuPulse's own videos). **The Gallery accepts photos only
today** (`MEDIA_TYPES`); album videos are handled wherever a `MediaAsset` has a `video/*` type or an `.mp4`/`.webm`
path, so they work as soon as the Gallery accepts video uploads.

**Language** (`languageLine`): `Business.contentLanguage` is the main language; the Digital Marketing Profile's
language mix (its "languages" answer, for example "Kinyarwanda and English") adds a few short phrases of the other
language where a local customer would say them, at most one on LinkedIn; prices, names and facts are never translated.

**Results**: one `GeneratedContent` row per post (`forDate`, `angle`, `network`, `runId`, `mode`, `brief`, and
`postsDraftedAt` set) with its own visuals, and one post per row (`source STUDIO`, `PENDING_APPROVAL`, one `groupId`
per run). Designed pictures and BuPulse videos are filled in when drawn (`attachToContent`), then auto-approval checks
them again; everything else (approval, auto-approval, reminders for apps not connected, "Schedule all") is as below.
A new run does not replace earlier drafts. Older content (no `forDate`) shows on the day it was written.

**Autopilot** (`lib/content-flow/autopilot.ts`): before writing, every week's post about a product or campaign gets
the day's angle from the same rotation (recorded with `source autopilot`); the writer's prompt carries the angle, hook
and structure. Its photos were already album first, then the least recently used Gallery photos; a video idea whose
product or campaign has an album video now posts that video as it is (no video plan is made for it).

**Permissions**: the `content` permission, the `content` and `calendar` features, 30 runs an hour per company.


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

- **Create today's content** (above): one post per chosen app per run.
- **Studio.** When content is written or edited for a product or campaign (`POST /api/generate`),
  `drafts.ts` drafts one post per usable connected app (`source STUDIO`, `PENDING_APPROVAL`, one `groupId`): Instagram,
  Facebook and LinkedIn get their own version of the caption and the content's picture or carousel; TikTok and YouTube
  get the video script (SCRIPT) with the video once it is made. Older drafts of the same product or campaign that still
  wait are replaced, in the same transaction as the new ones, **unless the owner edited them** (`Post.ownerEditedAt`,
  set by edits in the composer, media changes, moves and "Back to review"); approved, scheduled and hand-made posts are
  never touched. Scheduling a content by hand in the composer replaces its untouched drafts for the chosen accounts,
  in the same transaction. Nothing is drafted without the `calendar` feature. Drafting takes a per-content advisory
  lock and makes nothing when the content already has its drafts, so two page loads at once (the backfill) or a double
  click draft once; migration `20261016120000_dedupe_studio_drafts` removed the duplicates made before (untouched
  drafts only, the oldest kept).
- **Autopilot.** Its posts are saved as before (`PENDING_APPROVAL`, or `SCHEDULED` with "Post without asking").
- When the content's picture finishes drawing or its video is uploaded, the drafts take it (`attachToContent` in
  `lib/visuals/service.ts`, as `attachToGroup` does for Autopilot) and get another auto-approval check. Only drafts
  still waiting (DRAFT, PENDING_APPROVAL) that the owner did not edit; never a SCHEDULED post. The write is guarded by
  the `updatedAt` it read, so an edit made meanwhile wins.

## Apps that are not connected yet

Most pilot companies cannot connect Instagram, Facebook or TikTok until the networks approve BuPulse, so posts never
depend on a connection:

- **Drafts.** Studio drafts a post for every app the content was written for (its per-network versions; Instagram,
  Facebook and LinkedIn when there are none), connected or not. An app without a usable account gets a post with no
  account and `Post.remindOnly` (`lib/content-board/by-hand.ts`, `draftTargets`). It shows in Today and Needs review
  with its picture or video and a "Not connected" chip linking to Channels ("Connect Instagram").
- **Autopilot** lists apps without a usable account in its account choice as "Not connected: you get a reminder"
  (stored as `network:<app>` in `AutopilotSettings.connectionIds`); their posts are `remindOnly`. Once the app is
  connected, Autopilot writes for its account instead (`planConnections`), so the next weeks publish on their own.
- **Approve or auto-approve** schedules it at the best time like any post. At its time the publisher sends the
  existing reminder (`lib/publishing/engine.ts`, as for NOTIFY accounts and TikTok/YouTube scripts): email with the
  caption, hashtags, 7-day image and video links and "I posted it", then "Post it yourself" (NEEDS_ACTION) with Mark as
  posted. The post detail adds Copy caption and the image/video downloads. A post that lost its account later (not
  `remindOnly`) still fails as before.
- **Connected later.** A banner on the Content page ("N posts were made as a reminder... Publish automatically") and a
  button in the post detail switch waiting or scheduled reminder posts of a now-connected app to its account
  (`lib/content-board/connect.ts`; the first usable account that posts automatically), keeping text and media. A
  scheduled one is taken out of the queue first, checked by the safety rules, and scheduled again on a free slot (its
  time if still ahead, else the best time); if it cannot go it waits in Needs review with the reason, so a post is
  never published late or stacked.
- **Backfill.** Content written before drafting existed has `GeneratedContent.postsDraftedAt` null. Its posts were
  drafted once when its product or campaign was opened (`latestContentPosts`); the day view no longer runs it (content
  flow v3), and `createPostsFromContentAction` stays for such content.

## Not posted yet, "Schedule all my posts" and the connect notice

- **Highlight.** Every post that has not gone out (draft, needs review, scheduled, posting, post it yourself) has a
  warning-colour (amber) border and, at the bottom of the card, an icon and "Not posted yet · <reason>" (for example
  "Instagram not connected" with a Connect link, the review reason, "Goes out <date>"), so it never relies on colour.
- **Schedule all my posts** (Content page and each subject page; acts on the current view's drafts and posts waiting
  for review, up to 100): a dialog with "Schedule for me" (best times) or "I'll choose times" (a time per post,
  prefilled with the suggestion, in the business's time zone). `lib/content-board/schedule-all.ts` applies the same
  safety rules as auto-approval (`safetyReasons`), writes each post guarded by its `updatedAt`, keeps 2.5 hours per
  account (`claimSlot`), and reports what was scheduled and what was skipped, with why (time taken, no free time,
  in the past, more than 90 days ahead, changed meanwhile, video not made...). Needs the `content` permission and the `calendar` feature.
- **Approve** reports posts it could not place ("Approved 4 of 5. 1 could not find a free time: open it and pick a
  time"): `approvePosts` returns `skipped`.
- **Connect your apps.** While posts (or Autopilot) target apps without a usable account (`missingApps`), the Content
  page shows "Connect your apps so we can post for you" listing them with "Connect apps" (Channels; Members are told to
  ask an owner or admin), dismissible for the browser session (it returns in a new session or when the list changes),
  and the bell shows the same notice with a dot.
- **Scheduling by hand from content** replaces its untouched drafts for those accounts and cancels the drafts the owner
  had edited ("Replaced by the post you scheduled"), so an account never gets two posts.

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
| no account (and not an app-not-connected reminder post) / account must be reconnected | "Connect this app in Channels first." / "<App> needs to be reconnected first..." |
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

Migration `20261017090000_content_flow_v3`: `GeneratedContent.forDate` (DATE), `angle`, `network`, `runId`, `mode`
(CHECK ai | describe | own), `brief`, index `(businessId, forDate)`; table `ContentAngle` (`businessId`, `subjectKey`
"product:<id>" | "campaign:<id>" | "general", `day` DATE, `angle`, `hook`, `structure`, `source` CHECK studio |
autopilot, unique per business, subject, day and source) with RLS on and every grant revoked.

Migration `20261016090000_content_auto_approval` (columns only, no new table, so the existing RLS and revoked grants
cover them): `PostSource` gains `STUDIO`; `Business.contentSettings` (JSONB) and `contentSummarySentAt`;
`Post.reviewNote`, `autoScheduledAt`, `mediaKind` (CHECK, kept by the trigger; existing rows filled by the migration);
indexes `Post(businessId, createdAt)` and `Post(businessId, autoScheduledAt)`. The trigger function has all EXECUTE
revoked. `20261016100000_post_owner_edited` adds `Post.ownerEditedAt`; `20261016110000_posts_for_unconnected_apps`
adds `Post.remindOnly` and `GeneratedContent.postsDraftedAt`.

## Permissions and plans

The page needs the `content` feature; subject pages, "Create today's content" and every post action also need
`calendar` (as the calendar's actions). Approving, rejecting and editing posts follow the `content` permission (Members included), the settings
need `contentSettings` (Owner, Admin).

## Tests

`tests/content-flow/`: angle rotation per day (no repeat on consecutive days, all angles before a repeat, facts
filter, same-day rerun, Autopilot), Gallery first including videos, Bring my own per network (media, text rules,
adaptation with the AI mocked), the day view (Africa/Kigali bounds, `?day=`, the query, sections), the run (one text
generation per post, refunds, angle stored, posts and visuals, refusal before charging), the limits preview, and the
product and campaign pages without content tools. `tests/content-board/`: filters (parsing, query string round trip, date windows, the Prisma query), grouping and counts,
the auto-approval rules, auto-scheduling (per app, safety rules, plan, best time, Autopilot times, spacing, retry),
Approve and Approve all, drafts from content, settings (validation, roles, audit) and the summary email (due time,
selection, content, compare-and-set). `tests/publishing/best-time.test.ts` for the best time.
