# Client QA handover

Branch `client-qa` (based on `quiz-mode`), folder `/Users/macbook1/BuPulse-client`. Tests the client dashboard on
test.bupulse.com like a small Rwandan business owner, and fixes what it finds.

## Sessions

### 2026-10-23 (session 1)
- Read the guide, QUIZ_MODE, BUSINESS_INFO and PLANS docs.
- The new browser tab was signed out (login page); the owner signs in a test client for me (I never type passwords).

### 2026-10-24 (session 2, owner away; the main session decides)
- Reel 5 (round-3 montage, Kinyarwanda) finished after Google's daily quota reset: 6/10 from Gemini, the product changed
  between shots (LEAF's album has 8 different towers) — fixed: one product photo a reel. Reels: $16.63 of $20 spent.
- Netlify's 60 s, all live on the test site:
  - image engine in steps of one AI call (migration `20261031200400_image_concept_steps`);
  - Create post's picture stepped across render calls;
  - reel engine: quick start, one heavy thing a step, paid work saved at once, Google's limit shared across
    businesses, a 30-minute give-up;
  - Autopilot's AI pictures left for later on Netlify (`/api/cron/autopilot-visuals`, every 30 minutes Fri to Sun),
    1 a run there (`AUTOPILOT_NETLIFY_AI_PICTURES`).
- Set up the Training Lab agent (`/Users/macbook1/BuPulse-training`, branch `training-lab`) at the owner's request.
- Waiting for the owner:
  - Chrome on the test site is signed in as "BuPulse Admin" on /welcome: LEAF needs signing in again before browser
    walk-throughs (and the Designs guide screenshot);
  - more reel budget ($3.37 left; a reel is about $4.50);
  - the Netlify proposals in docs/DEPLOY_NETLIFY.md (AI pictures in plan prices, late pictures on GitHub's runner).

## Problems found

Format: where (URL) · steps · what happened / what should happen · severity (blocker / annoying / polish) · screenshot.

1. **Every dashboard page takes 6-15 s to answer on test.bupulse.com** · annoying (test site; testers feel it).
   - Where: any /dashboard page, e.g. /dashboard/content/settings (server wait 14.5 s), /dashboard/usage 6-9 s, /dashboard/gallery 7-8.6 s (fetch timings, 23 Oct).
   - Why: the test site runs on the owner's Mac in Rwanda; the TEST database is in AWS us-east-1, 240 ms away per query (measured: `select 1` 220-300 ms). A page makes about 25-35 queries one after another (the dashboard layout awaits about 8 lookups in a row, getAppContext several more, then the page). On bupulse.com (Netlify, US) a query is about 10 ms, so production is not hit the same way.
   - Should: fewer queries in a row on every page, and/or run the test site near the database.
   - Owner chose: cut the round trips. Done in the shared part (every page): getAppContext loads the business, usage
     and person together, then the plan and the logo together (was 5 trips in a row, now 2); the dashboard layout's 7
     lookups (announcements, offer, apps to connect, daily posts waiting, new videos, studio switch, inbox) run together
     (was 7 in a row, now 1, plus the offer's payment only when an offer was accepted). Test: tests/app/context-speed.test.ts.
     About 10 round trips fewer per page, roughly 2 s on the test site. To measure after deploy: fetch timings of
     /dashboard/usage and /dashboard/gallery (before: 6.2-9.3 s and 6.9 s to first byte).
   - Owner said yes (through the main session, 23 Oct): the proxy now uses `getClaims()`. TEST publishes an ES256 key
     (/auth/v1/.well-known/jwks.json), so tokens signed with it are checked locally (the key is cached 10 minutes for
     all requests, GLOBAL_JWKS in auth-js); a legacy HS256 token falls back to getUser by itself. Before (warm, signed
     in): /robots.txt through the proxy about 500 ms. Test: tests/auth/proxy-claims.test.ts.
   - After (live 23 Oct, warm, signed in): /robots.txt median 70 ms over 15 tries (13 of 15 under 200 ms): the proxy no
     longer waits for Supabase Auth. Whole pages after it: /dashboard/usage 4.7-6.5 s, /gallery 3.7-5.1 s,
     /content 5.6 s, the same as after batch 3 (3.9-4.5 s) within the noise of a Mac that also runs builds. The first
     visit of a page not warmed after a restart: 13 s. Next big wins: fewer queries in each page itself, or a test site
     near the database.
   - Was a proposal (sign-in security, needed the main session's OK): proxy.ts and getCurrentUser
     (lib/supabase/server.ts) each call `supabase.auth.getUser()`, a network call to Supabase Auth, so every page pays
     two Auth round trips. Supabase recommends `getClaims()` in the proxy (verifies the JWT locally when the project
     uses asymmetric signing keys); the page would keep `getUser()`. Saves one Auth trip per request.
   - Batch 5 (fewer trips per page), measured with read-only timings of the shared lookups against TEST:
     - **Prisma relationJoins** (prisma/schema.prisma generator `previewFeatures`): a nested read was one round trip
       per level. business -> user -> subscription 800 ms -> 250 ms; companyEntitlements 800 -> 290 ms;
       getUsageSummary 730 -> 500 ms. Checked: all 125 models read with their relations (take 8, each relation take
       10, ordered by createdAt then id) give identical results with "query" and "join". Needs `prisma generate` at
       build (the build does it); no migration.
     - getAppContext: ensureAccount and resolveCompany together (a first visit looks again), the plan's features start
       as soon as the company is known.
     - The logo link is reused for 50 minutes (signedLogoUrl, lib/storage.ts): no Storage call on most pages, and the
       browser keeps the image.
     - Home: the quiz score runs alongside the counts (was after them), and quizEntry is cached per request, so the
       layout's banner and the home card share one score.
     - clientOffer (the layout asks on every page): one read; the expire-and-audit step only when the latest open
       offer is past its date (was a findMany before every read).
   - After batch 5 (live 23 Oct, warm, signed in, time to first byte): /dashboard 3.1-4.6 s (was 9.7),
     /content 2.4 (4.2), /gallery 1.7 (3.8), /leads 2.0 (3.8), /calendar 1.4 (4.7), /billing 2.2 (4.7), /usage 5.3
     (one sample, check again). No page errors with relationJoins.
2. **Quiz round pills were cut off with no hint of more** · polish · /dashboard/knowledge/quiz. Fixed: they scroll to the current round and fade at the edges (a2a0232d).
3. **A post whose time has passed still says only "Needs approval", with no hint what Approve does** · annoying ·
   /dashboard/calendar (week of 19 Oct: LinkedIn post Tue 20 Oct 09:00, opened on Fri 23 Oct).
   - Steps: open a waiting post whose time is in the past.
   - Happened: Approve and Move with the old date; nothing says the time is gone (approvePosts quietly moves it to the
     next good time). Should: say so before the tap. Fixed: a note "Its time has passed. Approve it and BuPulse posts
     it at the next good time, or pick a new time with Move." and the toast says it went to the next good time
     (lib/publishing/approval-note.ts, components/publishing/post-detail.tsx).
4. **Import on "All photos" is greyed out until a folder or product is picked** · question for the owner ·
   /dashboard/gallery, Import menu. It is the documented rule (lib/media/destinations.ts: every upload names its
   destination), but it is one more decision for a busy owner. Option: let "Not in a folder" be a destination.
   Owner decision (23 Oct): keep it as it is.
   Google Drive and Dropbox show "Coming soon" on the test site (no keys).
5. **First page after a test-site restart takes about 22 s** · annoying (test site) · any page right after a deploy.
   Warm pages after each restart (main session's deploy step).
6. **Speed after batch 3 (warm):** /dashboard/usage 3.9 s to first byte (was 6.2-9.3 s), /dashboard/gallery 4.3-4.5 s
   (was 6.9 s).

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

## Image engine (23 October 2026)

- Built: docs/IMAGE_ENGINE.md (agents, decisions, where it runs), docs/IMAGE_ENGINE_TEARDOWN.md (Creatify),
  docs/IMAGE_ANTI_SLOP.md (realism rules). Live tests: batch 1 (Pro words perfect, Lite misspelt: Lite is now Nano
  Banana 2), batch 2 after anti-slop (3 of 4 looked like real photos; 1 warped tower the Editor could not save).
- Step 1 (every post picture from the engine, no templates, Starter gets AI pictures): commits after 8b81b1ca.
- **Before production (bupulse.com on Netlify, 60 s per request):** one picture with Claude planning (about 20 s on the
  CLI), a Pro paint (about 40 s), the check and one fix can pass 60 s. Split paintRow into steps (paint, then
  check-and-fix in the next call, using the row's status) before it runs on Netlify. The test site (Mac) has no limit.
  **Done for the Designs page (24 Oct, main session's go):** a picture is now made in steps of one AI call each
  (paint, check, fix, check the fix), saved on the row, so each call of "Make my ads" stays near one picture's time
  (about 40 s for Pro, the floor). **Then a post's picture too:** Create post's renderImageStep plans and pays for it in
  one call (the slide keeps its `conceptId` at once) and steps it in the next calls (`stepPicture`); the screen asks
  up to 5 more times for it. Autopilot's nightly run (`paintOne`, lib/autopilot) still makes it in one call: fine on
  the Mac, to check against the scheduled function's limit before Autopilot runs on Netlify.
- Open ideas: a fresh repaint instead of an edit when the Checker sees slop (costs one more picture: owner to decide);
  store what the Checker read, to tell real typos from false alarms; lib/designs/service createTemplateDesign,
  createAiDesign, createAiPhotoDesign and the templates library are now unused by the app (left for a cleanup commit);
  docs/guide/features/05-designs.md still describes templates.
