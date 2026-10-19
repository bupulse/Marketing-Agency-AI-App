# Handover: video engine map (16 October 2026)

Read first: docs/VIDEO_ENGINE.md (the engine and the lab), docs/research/VIDEO_COMPETITORS_TEARDOWN.md (how
seedance2ai.io and Higgsfield work, BytePlus Seedance facts), docs/CONTENT_VISUALS.md and docs/VOICE_AND_MUSIC.md
(today's slideshow videos, voice and music), docs/VIDEO_ROBOT.md.

## Owner decisions so far

- **Main engine: Claude-designed** (Sonnet). Seedance is the backup and premium engine, for shots that need real moving
  people.
- **Test in a separate local lab:** `npm run lab`, http://localhost:3100, TEST database only, $5 a day.
- **Seedance avatars:** from the BytePlus digital-character library.
- **Test photos:** from the test database's products.
- **Colours:** BuPulse brand colours in the lab (Pulse Blue #2f6bff, Pulse Violet #7b5cff, Ink #0b0b0f).
- **Claude access for tests:** the owner's **Claude subscription** (Claude Code CLI) for tests only. **Remind the
  owner to switch to the API key (`ANTHROPIC_API_KEY`) before any deploy, release zip or wiring into the app.**

## 17 October: the Video Studio

The owner wants real videos (moving people), "fully like Seedance and Higgsfield", BuPulse-branded, Seedance via
BytePlus. Built: the studio site (home, create with one prompt bar for both engines, showcase, my videos, pricing,
guide), the BytePlus Seedance connection with jobs, polling, download and credit refunds, Claude as the prompt writer
for Seedance, RWF credits and a test wallet. Seedance cannot run until `SEEDANCE_API_KEY` is in `.env`.

## State

- **Done:**
  - the engine (spec, checking, renderer, MP4 with music, Claude designer, styles and hooks, a free sample);
  - the lab;
  - 26 tests;
  - checked in Chrome: the sample renders with photos and saves a 12 s MP4 with sound (5.3 MB).
- **First real design:** made through the subscription (Galaxy A56, 15 s, $0.103 API-equivalent, 35 s), and its
  MP4 (6.9 MB, 23 s).
- **Waiting:** the BytePlus key (`SEEDANCE_API_KEY`) and the digital-character library; the API key at deploy time.
- **Next:**
  1. Run more designs across styles and products, and record the measured costs.
  2. Tune the prompt and styles on what comes out.
  3. Add voice-over from `say` lines.
  4. Add Seedance tasks in the lab.
  5. Then wire it into the app ("Make a video", Autopilot, robot, quotas, guide).

## 17 October, overnight team run (lead: Fable 5.1; agents on Opus 5.5 / Sonnet)

Owner away; decisions taken by the lead. Team brief: docs/handovers/video-studio-team.md. Done and committed so far:

- **Research:** TikTok 93 watched + 46 public rows; Facebook 73 rows (51 Rwandan Ad Library video ads) with a Rwanda
  playbook; Instagram and YouTube Shorts in progress. Files: docs/research/reels/*.
- **Brain:** lib/video-engine/brain (38 hooks, 10 formats, 52 rules, 11 sectors, 179 evidence rows), brainContext for
  Claude briefs, docs/research/BRAIN.md "How the engine operates". A design scorer is in progress.
- **Motion engine:** 3D look (extruded text, turntables, light, particles, glass/metal), ElevenLabs voice-over with
  the Kinyarwanda rule, free product cut-outs, research hook and platform in the brief, 33 templates, several quality
  loops on real designs. Loop 4 (fact checker + sweep of all templates) in progress.
- **Seedance:** brain (30 templates, rules, checks, plans), free storyboard previews, readiness check, 12 example
  storyboards. Waits for SEEDANCE_API_KEY.
- **Blender:** premium 3D pipeline (scene JSON -> Eevee MP4, about 2 minutes per 5 s clip at 540p). Claude-written
  scenes in progress; studio wiring queued.
- **Studio site:** home, create (one bar for both engines), model pages, Nano Banana image page, API page, EN/FR/RW,
  password gate, Seedance previews, voice-over, last-good-build restarts, QA 92/92.
- **Online:** gate live; the tunnel command (tools/bin/studio-online.sh) must be run by the owner (the lead's
  environment refuses to start tunnels). Password in .env (STUDIO_PASSWORD).

## 17 October, the team's morning (lead: Fable 5.1, agents on Sonnet)

Committed in order: Brain live-variants and samples (10ce46f), YouTube Shorts research (ad61959), captions corpus
(a6e293e), motion engine fact checker and legibility (76f6b5f), Brain YouTube fold-in and caption check (41f901b),
studio Premium 3D (57f2040), Brain caption tuning (07104f4), motion engine scores and safe area (e80a785), Brain audit
(036c940, 8bc3435), research rounds (126d304, d5fed72, ca130e5), motion engine text off the product (284467a), studio
visual pass (febe4fc), Seedance prompts within 160 words (db5fe6d), Blender scene designer (78ce0e4), Brain language
check (047ad40), guide page 19 (da730ec).

Decisions made for the owner while away: luxury templates carry a small quiet phone line in every scene; safe areas
are per platform (YouTube: price and phone in the middle band); six short templates raised to 15 s; Premium 3D
credits 100 at 540p, 150 at 720p, re-render 70; Premium 3D clips get sound through Blender's own muxing (no ffmpeg);
Seedance clips get BuPulse's text overlaid in the browser through a "video" layer in the motion engine.

In progress: motion engine loop 6 (other products, 1:1 and 4:5), then the video layer and the language check;
Seedance overlay spec and frame source (mp4box); Blender audio mux, then the "expensive look" loop; studio caption
check, Premium 3D voice step, credits; Brain Instagram ingest; research rounds (Facebook events/schools/clinics and
organic reels, Instagram East African accounts, TikTok thin sectors and sounds).

Incident: an agent's `pkill -f cat` killed Chrome and the supervisor at 09:48; both relaunched, rule added to the team
brief.

### Midday, 17 October: decisions the owner may reverse
- Prices from measured costs (docs/AI_COSTS.md): Motion 35 credits (was 30), voice-over 15 (was 10); Premium 3D 100 at
  540p, 150 at 720p, re-render 70; Seedance by formula at 2.2x.
- Video credits per plan (docs/VIDEO_APP_INTEGRATION.md): Starter 100, Business 500, top plan 1,500 a month, no
  roll-over; trial 50; presenter images from video credits.
- App integration started on this branch: pure lib/video-engine/credits.ts and the Prisma migration
  20261022100000_video_studio (TEST database only). The app must use ANTHROPIC_API_KEY, never the subscription.
- Guide pages 19 (Video Brain) and 20 (Video Studio), docs/SEEDANCE_KEY_DAY.md for the key day.

- 14:20: TikTok showed a slider captcha in the researcher's tab (the shared Chrome on port 9334). The agents stopped browsing TikTok and did not touch it; the owner should clear the slider in that tab, or close it.

- App integration task 4: video ledger features (video-design, video-premium, video-seedance-prompt, video-seedance, video-voice, video-image) are left out of a company's monthly AI allowance (metered by video credits instead) but still count against the platform cap AI_MONTHLY_BUDGET_USD: RAISE THAT CAP WHEN VIDEO GOES LIVE. A test forbids app/, lib/ and components/ from importing video-lab or the subscription transport.

### Afternoon, 17 October
- Research closed for the day: 687 rows (TikTok 216, Facebook 159, Instagram 101, Shorts 36, captions 125, comment
  studies 30 + 20), docs/research/RESEARCH_SUMMARY.md for the owner, an evidence audit of every rule, hook and
  caption formula (docs/research/brain-evidence-audit.md) with its fixes folded in; weak evidence marked and weighed at
  half; ads and organic posts split by `purpose`.
- Brain: suggestHooks (opening-line chips, live on /create), planSeries (a week of distinct videos), firstCommentFor,
  outcomes learning, language check, SAFE_AREAS per platform.
- Motion engine: 60-design run on three products and two shapes (mean 98), video layer for Seedance overlays, language
  check in every design. Loop 8 open: cut-out product size, labelled number, re-shape glitches on 1:1.
- Premium 3D: three looks, plinth, flat phone bar, sound mixed by Blender; loop 3 open (cut-outs on the plinth,
  crisper titles, frame 0).
- Studio: Premium 3D voice live, Seedance references and characters, test-mode bar, free re-shapes to 1:1 and 4:5,
  "Add BuPulse text" for Seedance clips in progress.
- App: VideoJob/VideoOutcome models (migration applied to TEST), plan video credits, add-on, ledger features, Seedance
  token pricing, POST /api/video/design, the video-jobs cron sweep; task 6 (the dashboard Create page) in progress.
  The videoStudio feature stays "coming soon" until the owner decides to sell it.
- Still for the owner: run tools/bin/studio-online.sh for video.bupulse.com; clear the TikTok captcha tab; play the
  Kitenge Premium 3D clip with sound; clean the LEAF Hydro Tower price field; the SEEDANCE_API_KEY day
  (docs/SEEDANCE_KEY_DAY.md); switch to ANTHROPIC_API_KEY before any deploy.
- App Video Studio voice-overs need ELEVENLABS_API_KEY in Admin -> Services on TEST before a first real take (about $0.30 per 1,000 characters; a 15 s video is about 150).

### Late afternoon, 17 October: the app's Motion first release is in code
- /dashboard/video (hidden behind the coming-soon `videoStudio` feature): design on credits through the API key only,
  opening-line chips, live preview, edit/extend, voice-over (15 credits, cached takes free, credits held on the job
  and refunded by the sweep), music from the library, the MP4 encoded in the browser into the Gallery (counts a plan
  video and a day), schedule through the composer with one checked caption per network (CAPTION_PASS 70) and the music
  credit, VideoOutcome rows for the Brain filled by the metrics cron. Migrations applied to TEST only:
  20261022100000_video_studio and 20261023100000_video_job_sound.
- To open it to clients: take `videoStudio` out of "coming soon" in lib/features.ts, add it to the plans, set
  ANTHROPIC_API_KEY and the ElevenLabs key in Admin -> Services, raise AI_MONTHLY_BUDGET_USD, and test one video in a
  browser on TEST first (none of the app page has been opened in a browser yet; it is covered by mocked tests only).
- Still planned (docs/VIDEO_APP_INTEGRATION.md tasks 9 to 16): Seedance in the app, cut-outs in the browser, the Mac
  render worker for Premium 3D, Admin cards, Autopilot videos.
- End of the motion engine day: a fresh 33-template Galaxy sweep through the whole committed pipeline scores a mean of 99.9 (32 at 100), with one true fact warning and one true language warning; other products 99.3 to 99.6; the 1080p clip-sound proof passes unpatched. Sheets and score table in /private/tmp/claude-502/-Users-macbook1-BuPulse-video/quality/loop10/.
- Closing checks (17 October, 16:50): `npx tsc --noEmit -p .` exit 0; eslint clean on every touched file; vitest: tests/video-engine 407 passed, app suites 830 passed (20 db-only skipped); `npx next build` exit 0, no warnings, 125 static pages, 10 min 44 s under load. Two blockers found and fixed on the way: lone surrogates in the Brain data (ingest now cuts by code point, with a test) and a demo route exporting constants (moved to lib/demo/ics-config.ts).

## End of 17 October: where to start next time
All eight agents are finished and idle; everything is committed on `video-engine` (nothing pushed). The studio keeps
running on localhost:3100 under the supervisor; the Mac stays awake under caffeinate.

Owner's list, in order:
1. Run `~/BuPulse-video/tools/bin/studio-online.sh` in a Terminal and leave it open: https://video.bupulse.com
   (password STUDIO_PASSWORD in .env). Then follow "Try it in five minutes" in docs/guide/features/20-video-studio.md.
2. Play the Kitenge Premium 3D clip with sound (My videos) and one Motion MP4 with voice; the agents cannot listen.
3. Clear the TikTok slider captcha in the research Chrome tab (or close the tab).
4. Clean the LEAF Hydro Tower product's price field (it holds a paragraph).
5. The Seedance key day: docs/SEEDANCE_KEY_DAY.md.
6. Before any deploy of the lab or the app: ANTHROPIC_API_KEY (the amber bar on the studio says when it is still the
   subscription), the ElevenLabs key in Admin -> Services on TEST, raise AI_MONTHLY_BUDGET_USD.

Next session's work: Seedance in the app (plan task 8), the library page, the guide page, the Mac render worker for
Premium 3D, then a real browser trial on TEST before `videoStudio` leaves "coming soon". Research gaps are listed in
docs/research/RESEARCH_SUMMARY.md and the Brain's changelog in docs/research/BRAIN.md.

## 19 October: viral library, viral-first videos, AI clips, the studio split (lead: Opus 5.5; agents Opus 5.5 / Sonnet)

The owner was away from about 15:00; the lead and BuPulse's main session (bupulse-fe) decided within the house rules.
Everything is committed locally on `video-engine` (nothing pushed); bupulse-fe took 6082574 into its launch candidate.

What was built:
- **Viral library** (`docs/research/viral/`, README has the rules): YouTube 100, Facebook 100 (43 long-running ads),
  Instagram 100 (72 East African), TikTok in progress (79 rows at 20:40; notes file follows). Notes per platform in
  `<platform>-notes.md`. Frames stay on this Mac (`video-lab/data/viral/frames`, git-ignored). Owner-only page `/viral`.
- **Viral-first videos** (docs/VIRAL_RECIPES.md, guide 22): every Motion and Seedance design follows a recipe mixed from
  3 to 5 matching viral videos (index `lib/video-engine/brain/data/viral.json`, built by `viral-ingest.ts`, no
  captions, comments, frames or account names). Templates behind "Use a template instead". The business's last 5
  recipes are avoided. Five recipe checks in the score. Two LEAF proofs: different sources, scores 97 and 96.
- **Phone clips**: 5 to 10 s MP4/MOV, 30 MB, Gallery "Studio clips", placed as video layers.
- **AI clips (Google Veo 3.1 Lite)**, guide 21: image-to-video from the product photo, 9:16 720p, $0.05/s; 65/95/130
  credits for 4/6/8 s; 2 to 3 per video; clip audio never mixed in (tested on a real MP4). Uses GEMINI_API_KEY.
- **Short price everywhere** (`lib/video-engine/price.ts`); the LEAF fixes (agriculture sector, 7-post weeks).
- **Studio split for studio.bupulse.com** (docs/STUDIO_DEPLOY.md): tickets, sessions, scoping, credits through
  lib/usage, Motion / Seedance (item 8) / Premium 3D (item 9) as VideoJobs into BuPulse's Videos library, hardening,
  the going-live files (switched off). Guide pages 29 (clients) and 30 (owner).

Switches in Admin -> Services and their defaults:
| Service | Default | Off means |
|---|---|---|
| Video Studio (`studio`) | off | "Video Studio: coming soon" in BuPulse |
| Google Veo AI clips (`veo`) | off | "AI clips are paused"; photos and phone clips only |
| Premium 3D (Blender) (`premium3d`) | off | "coming soon" for clients |
| Seedance (`seedance`) | on, but no key yet | free storyboard previews, "Real video is coming soon" |
| ElevenLabs, Gemini, Anthropic | on | voice-over / AI images / design pause |

Spend: Veo **$1.80 of the owner's $5** test budget (9 clips of 4 s, logged in docs/AI_COSTS.md). Claude designs ran on
the subscription.

For the owner when back:
1. The owner checks in docs/STUDIO_DEPLOY.md "Owner checks to run (on TEST)": a Premium 3D 540p clip as E2E Starter
   Test, and the Veo client check (a TEST business needs 230+ video credits). The lead's attempt to raise LEAF's TEST
   credits was blocked by the session's safety check (shared data), correctly: it is the owner's call.
2. LEAF's Custom plan on TEST has videoCredits 100 (raised from 0 with the owner's OK on 19 October, all used): keep or
   set back.
3. Turn billing on for the Gemini key in Google AI Studio before switching Veo on (Veo has no free tier).
4. Going live: docs/STUDIO_DEPLOY.md "Going live (for the owner)", step 0 first (merge and release with the studio
   migrations). Switch the studio to ANTHROPIC_API_KEY before any deploy.
5. Research Chrome: DevTools port 9334, profile `video-lab/data/research-chrome` (logins kept). TikTok showed a slider
   captcha once; solve it there if it returns.

Next work: TikTok to 100 rows, then re-run `node lib/video-engine/brain/viral-ingest.ts` and commit viral.json; voice-over
for clients' Premium 3D clips; a second viral round (Kenya, Explore/For You scrolling) if the owner wants it.
