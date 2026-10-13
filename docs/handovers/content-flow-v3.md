# Handover: Content flow v3 (day view, "Create today's content")

Built 13 October 2026 on branch `v2-flow` (worktree `~/BuPulse-v2-flow`, from `v2`). Not pushed, not merged. No
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
  the cost line before confirming. One text generation per post; angles rotate per subject and day; Gallery photos
  and videos first; per-network length, hashtags, tone; content language plus the profile's language mix.
- **Autopilot** gets the same angle rotation (recorded with Studio's) and posts an album video as is for video ideas.

## Migration

`20261017090000_content_flow_v3`: columns on `GeneratedContent` (`forDate`, `angle`, `network`, `runId`, `mode` with
CHECK, `brief`) and an index; new table `ContentAngle` with RLS on and all grants revoked
(`tests/security/rls-coverage.test.ts` passes). Deploy order: back up, `prisma migrate deploy`, then the code.

## Decisions to confirm with the owner

- **Gallery videos.** The Gallery accepts photos only (`lib/media/rules.ts MEDIA_TYPES`), on every branch. The flow
  and Autopilot handle album videos (`video/*` or `.mp4`/`.webm`) and are tested with them, but they only appear once
  video uploads are added to the Gallery (a media task, not done here).
- **Media descriptions** are the Gallery file names (camera names like `IMG_2034` are ignored). There is no separate
  description or alt-text field on `MediaAsset`; adding one would make captions match photos better.
- **One angle per subject per day** (all the day's posts share it; each network gets its own hook-led text). A second
  run on the same day takes the next angle and does not replace the first run's drafts.
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
- People in posts (`v2-media`) plugs in through `planVisuals` / `createAiDesign`; both branches touch
  `components/content-board/schedule-all.tsx` with the same lint fix (identical text).
