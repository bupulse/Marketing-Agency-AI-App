# Ad Brain: BuPulse's own video ads, made by AI

The Ad Brain makes **30-second vertical video ads about BuPulse**, for BuPulse's own Instagram, TikTok, YouTube Shorts
and Facebook. It runs only for the BuPulse company account (office@bupulse.com): it is not a client feature.

It reads BuPulse's real features and plans, picks an ad format (for example the "Who's real?" twist), writes the script,
makes the actors, clips and music with AI, edits everything with effects, judges the result, fixes one weak part if
needed, and delivers the finished ad. **Nothing is published by itself**: the ad waits on the Posts page for your OK.

**Where:** Admin → AI and usage → **Ad Brain** (`/admin/ad-brain`). Limits: Admin → Settings → **Ad Brain limits**
(`/admin/settings/ad-brain`), with the spend limits and BuPulse's own Gallery video space.

## Make an ad

1. Open **Admin → Ad Brain**.
2. Open **Make an ad**. If you like, type a note for the brain, such as "push Autopilot" or "posts in Kinyarwanda".
   Leave it empty to let the brain choose.
3. Press **Make an ad**. Only one ad is made at a time.
4. The ad moves on by itself every 4 minutes (the scheduled jobs). To speed it up, press **Move it on now**.
5. Watch the card: Reading BuPulse → Choosing the concept → Writing the script → Making the pictures and clips →
   Editing → Being judged → Saving → **Ready**. **Progress** shows each step in plain words.
6. When it is **Ready**, play it on the card. It is also in the company account's **Videos** library and on its
   **Posts** page as four posts (Instagram, Facebook, TikTok, YouTube) **waiting for your OK**, with a caption and
   hashtags. Approve, edit or delete them there.

A real ad takes about 15 to 30 minutes and costs about **$2 to $3**.

**Free test:** "Re-render the cached ad" re-makes the 10 November "Who's real?" ad from its saved files with the real
renderer, judges it (about 2 cents) and delivers it. Use it to check that everything works.

## Spend limits

- **$3 per ad** and **$30 per month** (your decision). Change them in Admin → Settings → Ad Brain limits.
- Before every paid step, the Ad Brain checks both limits. If the next step would pass one, the ad **stops** and says
  why (for example "Stopped before passing this ad's $3.00 limit…"). Nothing more is paid for it.
- Before making any picture or clip, it checks that the whole plan fits; if not, it stops before paying for anything.
- Every paid call is in **Admin → AI calls and spend** under the feature **adBrain**.
- The site-wide monthly AI cap (Admin → AI) still applies on top. If it is lower than what you want to spend on ads,
  raise it there.

## The rules it never breaks

1. **No AI-drawn screens.** Phone, laptop and app screens in ads are always real captures of BuPulse. AI scenes keep
   screens turned away.
2. **A spoken call to action** at the end ("Check out BuPulse dot com and get a free quote").
3. **No AI Kinyarwanda voice.** AI voices speak English only.
4. **No made-up claims, results, testimonials or prices.** It may only claim what is in BuPulse's features and plans.
5. **No "AI-generated" watermark** burned in (the platform's own AI label is used when posting).
6. **Copies only the mechanics** of a format, never another ad's content.
7. **Music under the voices**: it dips under every word.

The plan is checked against these rules before anything is paid for, and the judge checks the finished ad again. If
the judge flags a hard rule, the ad is still saved in the Videos library, but **no posts are made**, and the card says
why.

## Real screens

Ads only show real captures of BuPulse's own dashboard, taken by the **screen robot**. The robot is the server opening
the company account's pages in a hidden browser:
- **Pages:** Home, Posts, Calendar, Autopilot, Designs and Photos, plus Leads only when there are leads.
- **Sizes:** each page at phone and at computer size.
- **Read only:** it only looks. It cannot click, change anything, open admin pages or see any other account.
- **When:** by itself before an ad when the captures are a day old, or at once with **Capture the screens now** on the
  Ad Brain page. The page shows how many usable captures there are and when they were taken. An ad needs at least 3.
- **No misleading pages:** a page with nothing on it (no posts yet, Autopilot off, no leads) is never shown in an ad.
  So fill the company account with real posts and designs first.

The judge watches each finished ad twice (about 1 cent in all) and scores it like you would. On your 10 November ads
it gave "Who's real?" 9, "Yep, that's me" 8 to 9, and the split-screen 8. It gave the salon ad 5, because its voice is
cut off at the end and it has the old "AI-generated" badge.

## For developers

- **Spec:** `docs/AD_BRAIN.md` (owner decisions in section 2 are final; the phase 1 build is described at the end).
- **Code:** `lib/ad-brain/`:
  - `effects.ts`: the effects library and the choice of 3 to 5 signature effects that never repeat a recent look
  - `recipes.ts`: the formats (twist, loop story, creator talk + screens) and the format choice
  - `script-rules.ts`: the script rules (hook, 25 words per clip, money words, Kinyarwanda, CTA, invented numbers)
  - `edl.ts`: the EDL (the plan as JSON) and its check, including the hard rules
  - `plan.ts`: script → assets to make (prompts) → EDL with real timings
  - `brain.ts`: the thinking model behind one interface (Gemini now, Claude with `AD_BRAIN_MODEL=claude`), with the
    brand brief, concept and script prompts
  - `providers.ts`: Nano Banana 2.1, Lyria, Gemini TTS, word timings, the judge's call. Omni clips use
    `lib/video-engine/veo.ts`
  - `judge.ts`: the rubric and the one-fix decision
  - `budget.ts`: the limits and unit prices
  - `pipeline.ts`: the step machine (`sweepAdJobs`, `stepOnce`)
  - `render.ts`: runs the Python renderer
  - `deliver.ts`: Gallery, Videos library, posts
  - `store.ts`: the `ad-brain` bucket and asset cache
  - `facts.ts`: the company account, BuPulse's facts, real screens
  - `fixtures.ts`: the cached twist ad
  - `screen-pass.ts`: the robot's 5-minute signed read-only pass, also checked in `proxy.ts`
  - `screen-user.ts`: the pass's user for `getCurrentUser`, the company account only
  - `screen-plan.ts`: the pages, the 24 h refresh and the empty-page rule
  - `screens.ts`: runs `scripts/ad-brain/capture-screens.mjs` (headless Chrome) and stores the captures
- **BuPulse's gallery space:** `lib/media/company-video-max.ts` (setting `adBrainGalleryVideoMb`).
  - `service.ts`: Admin
- **Renderer:** `tools/ad-render/` (Python 3.9+, Pillow, numpy, ffmpeg). See its README.
- **Admin:**
  - page: `app/admin/(console)/(ai)/ad-brain/` (data), drawn by `components/admin/content-ai/ad-brain-view.tsx`
  - limits: `lib/admin/settings.ts` (`adBrainPerAdUsd`, `adBrainMonthlyUsd`, `adBrainGalleryVideoMb`), their own
    settings area "ad-brain" (`components/admin/system/settings/ad-brain-area.tsx`, a card on the Settings hub)
  - previews without sign-in (development only): `/admin/preview/ad-brain`, `/admin/preview/settings-area?area=ad-brain`
- **Cron:** `/api/cron/video-jobs` (every 4 minutes) calls `sweepAdJobs({ budgetMs: 80_000 })`.
- **Database:**
  - migrations `20261110230000_ad_brain` and `20261110233000_ad_brain_video_engine`
  - tables `AdJob` and `AdAsset`, and the private bucket `ad-brain`
  - finished ads are `VideoJob` rows of engine `adbrain`, plus `Post` rows (`PENDING_APPROVAL`, group `ad-<job id>`)
- **Tests:** `tests/ad-brain/*` (EDL check, budget, effects and the renderer registry, script rules, planner, judge, judge calibration, screen pass and proxy gate, gallery space).

## If something goes wrong

| Symptom | Where to look | Usual fix |
|---|---|---|
| "Stopped before passing … limit" | The card's message | Raise the limit in Settings, or wait for next month. |
| "fewer than 3 real screen captures with real data" | Ad Brain → Real screens | Press "Capture the screens now"; if pages are empty, add real posts and designs to the company account first. |
| "Google Chrome could not start for the screen robot" | The server PC | `winget install Google.Chrome`, or set `AD_BRAIN_CHROME_PATH` (docs/SELF_HOST.md). |
| "No page could be captured … the pass was not accepted" | `AD_BRAIN_SELF_URL` | It must be this server's own local address (default `http://127.0.0.1:3002`), never bupulse.com. |
| Stuck on "Editing" | The server's temp folder `bupulse-ad-brain/<job>/render.log` | Python, Pillow, numpy or ffmpeg missing on the server: see `tools/ad-render/README.md`. |
| "The renderer could not start" | Same | Install Python, or set `AD_RENDER_PYTHON` to its full path. |
| Clips fail with "at its limit" | Progress | Google's daily Omni limit: speech lines turn into voice-overs by themselves; or try after 10:00 Kigali time. |
| "Your videos have reached their 100 MB" | Company Gallery | Delete old videos in the company account's Gallery (each ad is about 10 MB). |
| "Google Veo AI clips … switched off" | Admin → Services | Switch on Google Veo AI clips (Omni). |
