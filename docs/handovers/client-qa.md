# Client QA handover

Branch `client-qa` (based on `quiz-mode`), folder `/Users/macbook1/BuPulse-client`. Tests the client dashboard on
test.bupulse.com like a small Rwandan business owner, and fixes what it finds.

## Sessions

### 2026-10-23 (session 1)
- Read the guide, QUIZ_MODE, BUSINESS_INFO and PLANS docs.
- The new browser tab was signed out (login page); the owner signs in a test client for me (I never type passwords).

## Problems found

Format: where (URL) · steps · what happened / what should happen · severity (blocker / annoying / polish) · screenshot.

1. **Every dashboard page takes 6-15 s to answer on test.bupulse.com** · annoying (test site; testers feel it).
   - Where: any /dashboard page, e.g. /dashboard/content/settings (server wait 14.5 s), /dashboard/usage 6-9 s, /dashboard/gallery 7-8.6 s (fetch timings, 23 Oct).
   - Why: the test site runs on the owner's Mac in Rwanda; the TEST database is in AWS us-east-1, 240 ms away per query (measured: `select 1` 220-300 ms). A page makes about 25-35 queries one after another (the dashboard layout awaits about 8 lookups in a row, getAppContext several more, then the page). On bupulse.com (Netlify, US) a query is about 10 ms, so production is not hit the same way.
   - Should: fewer queries in a row on every page (Promise.all in app/dashboard/layout.tsx and components/app/context.ts), and/or run the test site near the database. Not changed yet.
2. **Quiz round pills were cut off with no hint of more** · polish · /dashboard/knowledge/quiz. Fixed: they scroll to the current round and fade at the edges (a2a0232d).

## Fixed

_None yet._

## Owner requests (23 October 2026)

1. Quiz banner on every dashboard page until Business info is complete, nicer design: **done** (docs/QUIZ_MODE.md "On every page").
2. Quiz round pills scroll by themselves to the current round: **done** (same section).
3. Daily posts on every paid plan, sized (Starter: 1 post a day on 1 app, free designs; Pro and Standard too): **done in code**, migration `20261030200000_daily_posts_every_plan` (not applied; the main session runs migrations when it merges). Pricing cards say it too (owner: yes on every plan), migration `20261030210000_daily_posts_price_cards`.
4. Video quality choice for Autopilot and Daily posts (Simple / Mix / AI videos): owner chose 3 choices, Simple first, and **fully automatic now** (AI clips made overnight, no tap needed). The engine part (overnight clips, credits, rendering) goes to the video-engine session through the main session; client-qa builds the setting and the choice of which videos are AI.

### Findings for request 4 (video quality)
- Autopilot and Daily posts do not make Claude "Motion" videos today: they make free slideshow videos (photos + captions + voice-over) from a video plan, drawn in the owner's browser or by the video robot (GitHub Actions). So "Simple" = today's slideshow.
- AI clips (Veo) and Motion videos exist only in the Video Studio (video-lab, studio.bupulse.com, the video-engine session), paid in studio credits (`videoCredits`: Starter 100, Business 500, Pro 1,500 a month). One AI video with 2-3 clips is about 230-320 credits, so only Business and Pro can afford a few a month.
- Veo clips take 1-6 minutes, longer than a server function may run, so making them for a nightly post needs a submit-then-check job (the existing `/api/cron/video-jobs`) plus clip support in the slideshow renderer. That touches the video engine: coordinate with the video-engine session.

### Request 4 progress
- Done (client-qa): the **Videos** choice (Simple / Mix / AI videos) in Autopilot and Content -> Settings, stored (migration `20261030220000_autopilot_video_quality` for Autopilot, JSON for Daily posts), and the planners mark AI videos with `VideoPlan.quality = "ai"`. Mix and AI are greyed out until the `veo` switch is on and the plan has studio credits. Docs: docs/CONTENT_VISUALS.md "Video quality".
- Asked for (video-engine, through the main session): the overnight AI clip maker that picks up plans marked "ai", charges studio credits, draws the clips into the slideshow, and falls back to simple with a refund.
