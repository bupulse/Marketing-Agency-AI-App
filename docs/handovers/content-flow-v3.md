# Handover: Content flow v3 (day view, "Create today's content")

Built 13 October 2026 on branch `v2-flow` (worktree `~/BuPulse-v2-flow`, from `v2`, then merged with v2's people in
posts and content packs, which mode A now builds on). Not pushed, not merged. No
database was touched and no AI API was called: the migration was written, `npx prisma generate` was run, the AI is
mocked in the tests. How it works: `docs/CONTENT.md` ("Content flow v3").

## What changed

- **Product and campaign pages** keep their details and album only, with "See this product's content →" /
  "See this campaign's content →" to the Content day view. The content card, visual and video panels, versions,
  "Write it again", the design studio and "Your designs" are gone from them; the components only they used were
  deleted (`components/studio/{content-card,write-content-cta,use-generate,generate-progress,queries,network-previews}`,
  `components/content-board/generate-posts`). The services stay (`generateForSubject`, `/api/generate`, visuals; the
  Studio server actions `generateContent` / `saveEditedContent` stay with their tests). The Designs page keeps its
  design studio.
- **Subject content page** (`/dashboard/content/products|campaigns/<id>`, `/general`) is a day view: today first
  (business time zone), a date bar with previous / next, a calendar picker and "Today" (`?day=`), sections "Needs your
  OK", "Goes out this day", "Made this day", the board's cards, filters (without the date filter) and "Schedule all"
  for the day, and "Pictures and videos" where the day's visuals are drawn and changed. The post detail's "Open it"
  for a picture or video still being made now links there.
- **Create today's content** (dialog): AI makes it for me / I'll create it (Describe today's content, Bring my own),
  apps (connected preselected; others become reminders), design choice (AI designs with people vs Free templates),
  the cost line before confirming. Modes A and "Describe" are a content pack (packs' angles and rotation, one call,
  one text credit per post, people pictures) for the chosen apps, plus the day, Gallery photos and videos first, the
  design choice, the day's opening and structure, and the language mix. "Bring my own" adapts per app.
- **Autopilot**: one app per idea (each post its own idea and picture; "Posts per week" counts posts), the next pack
  angle per product or campaign post, and an album video posted as is for video ideas.

## Migration

`20261017090000_content_flow_v3` (after packs' `20261016140000_content_packs`): columns on `GeneratedContent`
(`forDate`, `mode` with CHECK, `brief`) and an index. No new table. Deploy order: back up, `prisma migrate deploy`,
then the code.

## Decisions to confirm with the owner

- **Gallery videos.** The Gallery accepts photos only (`lib/media/rules.ts MEDIA_TYPES`), on every branch. The flow
  and Autopilot handle album videos (`video/*` or `.mp4`/`.webm`) and are tested with them, but they only appear once
  video uploads are added to the Gallery (a media task, not done here).
- **Media descriptions** are the Gallery file names (camera names like `IMG_2034` are ignored). There is no separate
  description or alt-text field on `MediaAsset`; adding one would make captions match photos better.
- **Each post of a day has its own angle** (packs), and the next day continues the subject's rotation. A second run
  on the same day continues it too and does not replace the first run's drafts (packs from "Write content" do).
- **Autopilot volume:** with one app per idea, "Posts per week" (1 to 14) is the total number of posts, one text
  credit each, spread over the accounts (before, each idea went to every account for one credit). Autopilot's angle
  choices are not stored, so the rotation counts only Studio and day-run content.
- **Bring my own:** photos are used as they are (the networks crop them); "Add BuPulse designs" redraws feed posts in
  each network's shape instead. TikTok / YouTube are skipped without a video. A failed adaptation posts the owner's
  caption as typed (uncharged).
- **Instagram with an album MP4** becomes a Reel; Facebook and LinkedIn get pictures.
- Old Studio content (before v3) is no longer drafted on its own when a page opens; its visuals show on the day it was
  written.

## Not done / next

- No browser check (no database); screens were built from the design system, typed, linted and built.
- Gallery video uploads and a description field (above).
- A run makes its text calls in parallel and its art director calls in parallel (about 10 to 20 s for 5 apps); the
  pictures are drawn on the day view afterwards, like before.
- The design library expansion (`v2-templates`) needs no change here: the art director reads `TEMPLATES` and `PACKS`.
- `tests/content-board/filters.test.ts`: the `cardExcerpt` test imports the queries module inside the test, which
  now takes more than 5 s on a cold run (the visuals service grew); it has a 30 s timeout.

## Review fixes (after the merge into v2)

- One run at a time per company with a request key from the dialog (`Business.contentRunKey`, `contentRunUntil`,
  migration `20261017150000_content_run_claim`): "Already making today's content…".
- AI photos reserved when the run starts and given back when a slide ends without one (`prepaidAi`, `createAiDesign`
  `prepaid`).
- The cost line includes video seconds and voiceover characters of the videos BuPulse would make.
- Recent captions are fenced (`RECENT POSTS`) in the prompt.
- Autopilot settings say AI images with people are on by default and what turning them off does.

## Owner requirements (posts per app, price, ideas, contests)

- **Posts per app per day** by plan (`PlanDefinition.limits.postsPerAppPerDay`; trial, Starter, Standard 1; Business,
  Pro 3; custom plans 1 to 10 in the offer builder's Limits; migration `20261017150100_posts_per_app_per_day`). The
  dialog's "Posts per app" counts the subject's posts today; Autopilot respects it per account, day and subject.
  Admin -> Plans edits it ("Posts per app per day", 1 to 10, audited with the plan), and so does the
  `update_plan_limits` / `update_plan` tool (null resets to the seeded value).
- **Price choice** in the dialog: AI decides (default), With price, No price (engaging).
- **More ideas**, balanced fun / professional by the Digital Marketing Profile; the idea type shows on every card.
- **Contests**: suggested with placeholders, "Needs your confirmation: prize & rules" until the owner fills in the
  prize, end date and winner rule and confirms paying (migration `20261017150200_contest_posts`, `Post.contest`).
  Never approved, scheduled or auto-approved before that; never auto-approved after.
- Decision to confirm: "AI decides" shows a price on at most one post per run and only when the subject's last 3
  posts had none.

## Content rules review fixes

Contest guard on every path (validatePost, safety rules, edit with a time, move, retry, approve, publisher), edits
that change the confirmed prize / date / rule need re-confirming, end date today to 90 days (business zone), Owner or
Admin to confirm, no placeholders on pictures and a redraw with the prize after confirming (photo reused). "No price"
posts: price-free shared prompt, every field checked for price-like words. Per-day cap counts every post of the
subject on the app that day (also Autopilot's planner).
