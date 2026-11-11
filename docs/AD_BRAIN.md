# Ad Brain: the self-driving UGC ad engine

Owner decisions, 10 November 2026, after a day of hand-made test ads (see "What we learned" below).
Prototype code and every test asset: `~/bupulse-ugc-ads/` (outside the repo). Arcads teardown: `~/bupulse-ugc-ads/research/`.

## 1. What it is

A brain that makes complete 30 s vertical UGC-style video ads **about BuPulse, for BuPulse's own marketing**, on its own: it reads BuPulse's real business info, picks a viral
format, writes the script, plans every shot, effect, title, caption, music cue and sound effect, makes the assets,
edits, judges the result, fixes weak parts and delivers a finished ad. Every ad must look and feel different.

## 2. Owner decisions (do not re-litigate)

| Topic | Decision |
|---|---|
| Autonomy | **Fully automatic**: brief in, finished ad out. No approval steps before delivery. |
| Scope | **BuPulse only** (owner, 10 Nov 2026): every ad markets BuPulse itself, using the BuPulse company account (office@bupulse.com) and its real data. No client ads, no client-facing version. |
| Spend | **$3 per ad, $30 per month**. It stops before passing either and says why. Limits live in Admin → Settings. Every paid call goes through the AI ledger. |
| Delivery | Finished ad lands in the **Videos library + Posts page as "waiting for your OK"**, with a caption written. It never publishes on its own. |
| Thinking model | **Gemini now** (Gemini 3.8 Flash, key works), **Claude later** when an Anthropic API key is added (the .env key is empty today). Keep the model behind one interface. |
| Dashboard | **v1 included**: view the plan + small edits (change a line, a title, an effect, a music cue) and re-render. Full drag-and-drop editor later. Model: the "Timeline Anatomy" reel (instagram.com/p/DdG-RnKBeJr). |
| Real screens | **Secure screenshot robot**: the server opens the account's real dashboard pages in a headless browser with a short-lived internal read-only pass (no password typed) and captures them at phone and desktop size. |
| Creativity sources | (1) an **effects library** it mixes, never repeating a recent combination; (2) **reference reels**: owner drops an Instagram/TikTok link, the brain studies it and saves a "recipe"; (3) **results**: views, watch time and clicks favour what works; (4) the Admin **Training Lab** examples. |
| Builder | The video-engine agent, on its own branch. |

### Hard rules (never break)

1. **No AI-drawn screens.** Phone, laptop and app screens are always real captures with real data. AI scenes keep screens turned away or out of shot. (Owner called an AI blank phone screen "AI slop".)
2. **Always a spoken CTA at the end**: the actor says it, e.g. "Check out bupulse dot com and get a free quote." An end card alone is not enough.
3. **No AI Kinyarwanda voice.** Kinyarwanda only with real recorded voices. AI speech in English (French possible).
4. **No fake claims, results, testimonials or prices.** Claims come only from the business's real info (Business info, products, site). Never imply invented numbers.
5. **No burned-in "AI-generated" watermark** (owner): the platform's own AI label is switched on when posting.
6. Copy **mechanics** of reference reels, never their content, characters, wording or brand assets.
7. Music quieter than voices: ducked under speech (owner asked to lower it once).

## 3. Pipeline

```
Brief ─▶ Understand ─▶ Concept ─▶ Script ─▶ Plan (EDL) ─▶ Assets ─▶ Render ─▶ Judge ─▶ Fix ─▶ Deliver ─▶ Learn
```

1. **Understand**: read BuPulse's own Business info, products/plans, brand colours/logo, recent posts, bupulse.com and the feature list; pick the goal (awareness / free quote / one feature such as Autopilot, posts in Kinyarwanda, designs, chat widget). Output a brief with 2–3 provable claims about BuPulse.
2. **Concept**: pick a **format recipe** (Section 5) + 3–5 **effects** (Section 6) + caption style + music mood, avoiding the last N combinations used for this account. Write a one-line concept.
3. **Script**: hook in the first 2 s (claim, confession, question, pattern break; never open with the brand); one idea; spoken lines sized to clips (**≤ ~25 words per 10 s Omni clip**, ~2.5 words/s); the spoken CTA last; no money words in AI speech ("free", prices) because Omni refuses them, so prices and "free" go on screen and in the TTS/end card.
4. **Plan (EDL)**: a JSON edit decision list, the single source of truth the renderer and the dashboard both read:
   - `segments[]`: start/end, `source` (`ai_clip` | `ai_still_fx` | `real_screen` | `brand_card` | `end_card`), asset refs, `effects[]` with params, transition in/out.
   - `voice[]`: lines with character, clip, word timings (filled after generation).
   - `titles[]`, `captions` (style + word timings), `music` (track, drop time, ducking), `sfx[]`.
   - `characters[]`: identity base image + derived frames (same person across scenes).
5. **Assets**: Nano Banana frames (identity edits from one base portrait), Omni clips, screen-robot captures, Lyria music, TTS fallback. Cache by content hash; reuse before paying.
6. **Render**: EDL → frames → FFmpeg (video + mixed audio). Port the Python prototypes to the production renderer (Node + canvas/sharp + FFmpeg, or a Python worker on the self-host PC — agent's call, document it).
7. **Judge**: Gemini watches **and listens** with a fixed rubric (thumb-stop 0–2 s, retention, product clarity, wow, humour, sound, fake screens?, watermark?, spoken CTA present?, music too loud?). Scores 9/8/8/7 on today's best ads.
8. **Fix**: if a hard rule fails or a score < 7, re-roll **one** weak segment (prompt fix) within the budget; never loop.
9. **Deliver**: Videos library + Posts "waiting for your OK" with a caption and hashtags in the brand voice.
10. **Learn**: store the recipe + effects + scores; later read post results (views, watch time, clicks) to weight future choices.

## 4. Provider facts learned on 10 Nov 2026 (verify prices before relying on them)

| Provider | Facts |
|---|---|
| **Gemini Omni Flash** (`gemini-omni-1.1-flash`, Interactions API, image_to_video) | ~$0.1014/s at 720p. Speech in-clip, lip-sync good, East African accent, says "Boo-pulse". **Follows "about N seconds" in the prompt** (5 s scene = $0.51); talking clips cap at **10 s**. **Blocks** people falling/crashing through ceilings/floors even as comedy (use a still + edit effects). Refuses money words in speech. After ~20+ clips in a day it **failed every speech clip** ("failed", unbilled) while silent clips worked; quota resets ~midnight Pacific (~10:00 Kigali). Failures are not billed. |
| **Nano Banana 2.1** (`gemini-nano-banana-2.1`) | $0.034 per 1K image. **Editing the same photo** (reference image + "keep framing, replace X") keeps pose/room identical: man → chrome android → woman lined up perfectly; 4 scenes from one base portrait kept the same face. |
| **Lyria 3 Clip** (`lyria-3-clip-preview`, generateContent, responseModalities AUDIO) | $0.04 per 30 s track (mp3). **Ignores timing instructions** ("drop at 10 s"): build drops in the edit (separate intro track + energy detection on the main track). |
| **Gemini TTS** (`gemini-3.8-flash-tts`) | Reads style instructions aloud ("Say excitedly:" is spoken: send plain text). Voices only ~4–6/10 similar to Omni characters; best male fallback **Sadachbia**; spell "Boo Pulse". Use only when Omni speech is unavailable. |
| **Gemini 3.8 Flash** | Judge, word timings, analysis of video/audio; ~$0.004–0.01 per call. |
| Not available today | ElevenLabs (failed payment), Anthropic API key (empty), Higgsfield/Seedance/Kling keys (not on this Mac / test Admin). |

Real cost of today's ads: 12 s actor ad $1.06; 30 s split-screen $4.74; "Who's real?" 30 s **$2.24 (judge 9/10)**; "Yep, that's me" 30 s $2.69 (8/10).

## 5. Format recipes (start set, from today and the teardown)

| Recipe | Shape |
|---|---|
| Testimonial selfie | Actor talks to camera 10 s, captions, end card. Lowest engagement (judge 6–7). |
| Split-screen reveal | Wow first, then "how": real screens top, creator bottom (Arcads reel). |
| Kinetic cinematic | AI lifestyle scenes + flying real cards + bold titles (Arcads Kling reel). |
| Twist / identity reveal | "Which one is AI?" → "I'm the one who's not real" → transformations → beat drop → real screens. **Best: 9/10.** |
| Loop story | Freeze-frame "Yep, that's me", rewind "3 hours earlier", problem, discovery on real screens, payoff loops to the start. 8/10, humour 8. |
| Filmed-monitor walkthrough | Creator + phone-filmed real screens, one-word captions (mr.paidsocial reel). |
| Digital product formats | Green-screen reaction, phone-in-hand, POV, problem→app, "3 apps", fake chat, before/after (see the teardown artifact, section 9). |

## 6. Effects library (all prototyped in `~/bupulse-ugc-ads`)

Visual: RGB split glitch, slice displacement, scan-line wipe (and reverse), colour morph wipe, white flash, camera shake,
punch-in on cut, kinetic slam titles (skewed, shadow), sticker pops, floating reference cards, browser-window 3D drift,
tap ripple pinned to a real button (through perspective), freeze-frame + colour drain + grain + vignette, typewriter
text, tape rewind streaks + timecode, night grade + camcorder timestamp, phone-filmed monitor (perspective, moiré,
glare, focus pull, handheld drift), whip-pan, speed ramp / bounce camera, debris particles, face flicker callback,
split screen with blurred fill, word-by-word captions (CapCut style), one-word pop captions, end card.
Audio: robot voice (pitch + `afftfilt` robotize + echo), record scratch, tape rewind, glitch burst, boom/impact,
crash with debris, whoosh, typewriter clicks, UI click, music ducking, beat-grid cutting (cut every bar at the track BPM).

Each effect = `{id, params schema, render(frame, t, params)}`; the brain chooses by name and the EDL stores params.

## 7. Secure screenshot robot

- Internal route issues a **short-lived, read-only pass for the BuPulse company account only** (signed, minutes) used only by the server's headless Chromium.
- Captures a fixed page list (Home, Posts, Calendar, Autopilot, Designs/Photos, Leads when > 0) at phone (390×844 @3x) and desktop (1512×900) sizes; stores them as account assets with the capture date.
- The brain never shows a page with misleading empty data (e.g. Leads 0); it picks pages with real content.
- No clicks that change data; no admin pages; never any client's data (BuPulse's own account only).

## 8. Dashboard v1 (Timeline Anatomy style)

Admin only: list of ad jobs with status, cost, judge scores. Per ad: preview with shot number; tagged
script (`[CAM] [ACT] [AUDIO] [FX] [TITLE]` per segment, highlighted as it plays); multi-track timeline (scenes, voice,
music, SFX, titles, captions) with a playhead; small edits (text of a title or caption, swap an effect, music volume,
cut a segment) → re-render only what changed. Budget and spend shown on every job.

## 9. Data (suggested)

`AdJob` (account, brief, status, costUsd, scores), `AdPlan` (EDL JSON, version), `AdAsset` (type, hash, source,
provider, cost, url), `AdRecipe` (format, effects, source reel, score history), `EffectUse` (job, effect, params).
Costs via `withLedger` like every AI call; feature name `adBrain`.

## 10. Phases

1. **Core**: brain (Gemini) + EDL + renderer with ~12 core effects + Omni / Nano Banana / Lyria / TTS fallback + judge + one-fix + caps + delivery to the BuPulse company account's Videos/Posts. Runs from Admin. Reuse the prototypes and today's cached assets for tests.
2. **Screen robot** (Section 7).
3. **Dashboard v1** (Section 8).
4. **Learning**: reference-reel → recipe; results feedback; Training Lab examples.
5. ~~Clients~~: not planned. The owner decided the engine is for BuPulse's own marketing only.

## 11. Prototype map (`~/bupulse-ugc-ads`)

`ads.json`, `frames.mjs` (Nano Banana), `clips.mjs` / `broll.mjs` / `twist/clips.mjs` / `story/clips.mjs` (Omni),
`judge.mjs` (Gemini judge + word timings), `render.py` (captions/badge/end card), `reveal/render_reveal.py` +
`render_reveal30.py` (split screen, kinetic), `twist/render_twist.py` (glitch/robot/beat drop), `story/render_story.py`
(freeze/rewind/filmed-monitor/loop), `ledger.jsonl` (every cent spent), `final/` (finished ads), `research/`
(Arcads code teardown, digital-product research, skills).

## 12. Phase 1 build (10-11 Nov 2026, branch `ad-brain`)

Built by the video-engine agent. Everything below runs on the TEST database; nothing is pushed, merged or deployed.

**How an ad is made** (`lib/ad-brain/pipeline.ts`, one step at a time, leased, retried up to 4 times):

| Step | What happens | File |
|---|---|---|
| queued -> understanding | Brand brief from BuPulse's real facts: the company account's Business info and products, the built features (`lib/features.ts`), the sellable plans, recent posts; 2-3 provable claims | `facts.ts`, `brain.ts` |
| concept | Code picks the format (never the last one; best judge scores weigh most) and 3-5 signature effects (never >= 60 % alike to the last 8 ads' combos); the brain writes the one-line concept, music mood, caption and title style | `recipes.ts`, `effects.ts` |
| script | The brain fills the format's beats; `checkScript` enforces section 3.3 and the hard rules; one retry with the problems listed, then it stops | `script-rules.ts` |
| assets | The whole plan's cost is checked first (`planFits`); then portraits and identity edits (Nano Banana 2.1), Omni clips (submitted, collected on later steps), Lyria music (+ tempo/first beat analysed locally), TTS lines (+ word timings); every file cached by hash in `AdAsset` / bucket `ad-brain`; Omni speech failure turns that line into a TTS voice-over with a silent clip | `plan.ts`, `providers.ts`, `store.ts` |
| (plan) | `buildEdl` times each beat from the real clip lengths and word timings, puts screens on the music's bars, places effects, titles, captions, ducked music with its drop, SFX, end card + spoken CTA; `validateEdl` (shape, timeline, hard rules) | `plan.ts`, `edl.ts` |
| rendering | The Python renderer runs as its own process; the next step picks up the MP4 | `render.ts`, `tools/ad-render/` |
| judging | Gemini watches and listens (540 px copy) with the rubric + hard-rule checks; `decideFix`: deliver, or lower the music (free), or re-roll ONE weak AI segment if it fits the limits; never a loop | `judge.ts` |
| delivering | Gallery folder "Ad Brain" -> Videos library (`VideoJob` engine `adbrain`) -> 4 posts `PENDING_APPROVAL` (Instagram, Facebook, TikTok, YouTube), never auto-scheduled; no posts when a hard rule was flagged | `deliver.ts` |

**Formats built:** `twist` (Who's real?), `loop_story` (Yep, that's me), `testimonial_screens` (creator talk + real
screens). The rest of section 5 comes with phase 4.

**Effects ported** (`lib/ad-brain/effects.ts` = `tools/ad-render/adr/*.py`, a test keeps them in step), 26 in all:
- picture: RGB split, slice glitch, camera shake, punch-in, freeze-frame (drain, grain, vignette), tape rewind
  (timecode), night grade (camcorder stamp), robot scan-lines, debris, bouncing camera, slow push
- transitions: cut, scan-line wipe (both ways), white flash, whip-pan
- real screens: browser window with 3D drift, phone-filmed monitor, tap ripple through the perspective
- titles: slam, typewriter, one-word pop
- captions: word-by-word, one-word
- sound: robot voice, beat-grid cutting, plus music ducking and 9 synthesised SFX (whoosh, boom, glitch, scratch,
  rewind, typewriter, click, crash, riser)

Floating real-screen cards and the end card (face or logo) are drawn too.

**Hard rules in code:** `validateEdl` refuses a screen that is not a real capture (1), a missing or misplaced spoken
CTA (2), AI Kinyarwanda speech (3), money words in Omni speech, a watermark title (5), and music less than 12 dB under
the voices (7). `checkScript` refuses invented claim numbers (4). Prompts keep phone, laptop, monitor and TV screens
away in AI scenes (1). The judge re-checks 1, 2, 3, 5 and 7 on the finished ad.

**Where the renderer runs:** on the computer that serves bupulse.com (the self-hosted Windows PC), as a separate
Python process started by the Node server. It needs Python 3.9+ with Pillow and numpy, plus ffmpeg (install steps in
`tools/ad-render/README.md` and `docs/SELF_HOST.md`). It cannot run on Netlify or Cloudflare. A 30 s ad renders in
about 25 s on the M-series Mac.

**Limits:** Admin -> Settings -> "Ad Brain limits", its own settings page ($3 / $30 by default). They are
checked before every paid call, the whole plan is checked before the first asset, and the feature `adBrain` is kept out
of the company's AI allowance. The site-wide AI cap (`AI_MONTHLY_BUDGET_USD`, $20 by default) still applies on top.

**Admin:** Admin -> AI and usage -> Ad Brain (`/admin/ad-brain`) has "Make an ad" (with optional notes), a free
"Re-render the cached ad", "Move it on now", "Load the real captures" and a card per ad (status, cost, judge, video,
the tagged plan, progress log, Cancel). The video-jobs cron moves ads on every 4 minutes.

**Measured on 11 Nov 2026 (TEST), $0.56 of paid calls in all:**
- The cached twist ad re-rendered by the production renderer (25 s), judged and delivered for $0.006 (judge 7/10 on
  the 540 px copy).
- A real brief, concept and script: $0.017 with the stricter parser; an earlier run lost $0.054 on two unreadable
  answers, now fixed.
- One assets pass through the pipeline: portrait $0.034, Lyria $0.04 (measured 130.4 BPM for a 130 BPM prompt), TTS
  line + word timings $0.004.
- One 4 s silent Omni clip from that portrait: $0.40 in 47 s, same face.
- The full plan for that script was estimated at **$2.02**, inside the $3 limit. A full real ad has **not** been made
  yet: it needs the owner's OK to spend about $2-3.

**Not in phase 1:** the dashboard's small edits and re-render (phase 3; the plan, the tagged script and the log are
shown read-only), learning from reference reels and post results (phase 4), the split-screen / kinetic / walkthrough
formats, and 1:1 or 4:5 versions. The screen robot (phase 2) came next, before go-live: section 13.

## 13. Phase 2 and judge calibration (11 Nov 2026, branch `ad-brain`)

The owner decided to build the screen robot before going live, then ship one release.

### The screen robot (section 7)

**The pass.** `lib/ad-brain/screen-pass.ts` makes a signed (HMAC-SHA256), 5-minute pass naming the BuPulse company
account. The key is derived from `SCREEN_PASS_SECRET`, else from `SUPABASE_SECRET_KEY`. The pass is never stored, and
two places check it:
- `proxy.ts` accepts it only when the request comes from this computer (host `127.0.0.1` or `localhost`, and no
  `cf-connecting-ip`, `x-forwarded-for` or `x-real-ip`), only for GET and HEAD, and only on `/dashboard/**` and the read
  API (never `/admin`, `/api/admin`, `/api/cron` or `/api/auth`). Anything else carrying a pass gets a 403, and a pass
  never falls back to a normal session.
- `getCurrentUser` (`lib/supabase/server.ts`, through `lib/ad-brain/screen-user.ts`) checks the pass again, checks that
  the request is local, and checks that the user's email is the company account (`AD_BRAIN_COMPANY_EMAIL`, else
  office@bupulse.com).

Admin pages never read the pass: they verify the Supabase session themselves (`lib/admin/auth.ts`).

**The capture.** `scripts/ad-brain/capture-screens.mjs` is a separate Node process using `playwright-core` with the
installed Google Chrome (the video robot's approach).
- **What it opens:** Home, Posts, Calendar, Autopilot, Designs and Photos, plus Leads only when there are leads.
- **Sizes:** phone (390×844 @3x = 1170×2532) and desktop (1512×900).
- **What it records:** the main content's crop, and the position of a real button such as "Approve all" (read only,
  for the tap ripple).
- **Read only:** it never clicks or types, and it also aborts any non-GET request a page tries to make.
- **Storage:** `lib/ad-brain/screens.ts` saves each picture as an `AdAsset` of kind `screen` and provider `robot`, with
  the capture date, the page, the size and the page's data count.

**Refresh.** The robot runs before an ad when the newest capture is 24 hours old (the "understanding" step; a failure
keeps the last captures), and from Admin → Ad Brain → "Capture the screens now".

**No misleading pages.** A page with no data (no posts, no designs, Autopilot off, an empty calendar) is captured but
marked `empty`. `listScreens` never offers it to the brain, and Leads is not even opened at 0. The labels tell the
brain how many items each page has.

**Prototype captures.** The 10 Nov captures (`~/bupulse-ugc-ads`) stand in only in tests and development
(`NODE_ENV` is not production, or `AD_BRAIN_FIXTURE_SCREENS=1`). The production pipeline uses robot captures only.

**Checked.** The pass, the proxy gate and the capture rules have unit tests (`tests/ad-brain/screen-pass.test.ts`). The
capture script and Chrome were run against a local stand-in page, which confirmed:
- the cookie is needed (a page that asks to sign in gives a clear error);
- the 1170×2532 and 1512×900 sizes;
- the crop that leaves out the sidebar, and the button position;
- a page script's POST never reaches the server.

Per the owner, it was **not** run against TEST's LEAF account. The first real capture happens on bupulse.com after
go-live, as step 8 of the checklist below.

**BuPulse's own gallery space.** `lib/media/company-video-max.ts` gives the company account its own gallery-video
limit: Admin → Settings → "BuPulse's own gallery videos", 1,024 MB by default (owner decision). Every other company
keeps `MEDIA_COMPANY_VIDEO_MAX_BYTES` (100 MB).

### Judge calibration

The judge now:
- watches the ad at 720p: the file itself when it is 14 MB or less, else a 720p re-encode;
- answers at temperature 0;
- uses an anchored rubric: 9-10 is a twist, transformation or reveal paying off on the product; 8 is a funny story,
  demo or split-screen; 7 is a competent selfie testimonial with captions;
- scores the hard rules separately from craft;
- looks twice in parallel and combines the answers (`combineJudgements`): scores averaged, a hard rule broken if either
  look saw it.

It costs about **$0.012 per ad** (two looks of about $0.006 each), under the $0.02 cap.

Against the owner's hand scores, over two rounds:

| Ad | Owner | Judge |
|---|---|---|
| "Who's real?" twist | 9 | 9 / 9 |
| "Yep, that's me" | 8 | 8 / 9 |
| 30 s split-screen | 8 | 8 / 8 |
| Salon testimonial | 7 | 5 / 5 |

The salon ad has real defects the judge names: its voice is cut off at the end card, and it carries an old burned-in
"AI-generated" badge. So it lands under the pass mark and would get its one re-roll. Before calibration the same ads
scored 7/7/6/5. Those answers are kept as a test (`tests/ad-brain/judge-calibration.test.ts`). Calibration calls cost
$0.14 in all.

### Merging into main (for the coordinator)

- **Merged with `origin/main` (98f2414a) on 11 Nov**: the Ad Brain page sits in the grouped admin nav (AI and usage);
  its limits are their own Settings area "Ad Brain limits" (`/admin/settings/ad-brain`, a card in a "BuPulse's own
  marketing" section of the Settings hub); both have dev-only previews (`/admin/preview/ad-brain`,
  `/admin/preview/settings-area?area=ad-brain`).
- **Carrying the screen robot over a proxy rewrite (the pending "host-split" branch).** The whole change is:
  - **`proxy.ts`:** one import and these lines, before the Supabase client is made:
    `const robot = await screenPassGate(request); if (robot) return robot;` (`lib/ad-brain/screen-pass-gate.ts`)
  - **`lib/supabase/server.ts`:** `getCurrentUser` returns `screenPassUser()` (`lib/ad-brain/screen-user.ts`) when
    there is no Supabase user.

  Both helpers are self-contained and gated local + read-only + company account only. Re-add those lines in the new
  files, then run `tests/ad-brain/screen-pass.test.ts`.

- `ad-brain` merges into the current `main` (98f2414a) with **no conflicts** (`git merge-tree` dry run, 11 Nov). It
  touches files `main` changed since (`.env.example`, `components/admin/nav.ts`, `docs/AI_COSTS.md`), but on different
  lines.
- **Recommended: merge, don't rebase.** `git merge --no-ff ad-brain` from `main` keeps the branch's commits and their
  dates (the migrations were applied to TEST from these commits). A rebase would only rewrite those dates.
- **The uncommitted `docs/AD_BRAIN.md` in the main working tree** is the coordinator's BuPulse-only edit. The branch
  commits that same text plus sections 12 and 13. Before merging:
  1. Compare: `git diff --no-index docs/AD_BRAIN.md <(git show ad-brain:docs/AD_BRAIN.md)`. Only sections 12 and 13
     should differ.
  2. Move the uncommitted file aside, or discard it, so the merge's copy is the one kept. Git refuses to merge over an
     untracked file of the same name.
- **Migrations:** `20261110230000_ad_brain`, `20261110233000_ad_brain_video_engine` and `20261110234000_ad_brain_grants`
  all sort after `main`'s latest (`20261110120000_tracked_links`). They are additive: two new tables, one bucket, and
  `adbrain` allowed as a `VideoJob` engine. All three are applied to TEST. On TEST the second one was marked applied
  with `prisma migrate resolve` after its connection dropped; its change is confirmed in the database.

### Go-live checklist (owner and coordinator; nothing here has been done)

1. **Backup first**, on the server PC from the repo folder: `node scripts/self-host/windows/server.mjs tool backup`.
   It writes to `%USERPROFILE%\bupulse-prod\backups\bupulse-<time>.jsonl.gz`. Keep it private.
2. **Merge** `ad-brain` into `main` as above, run `npx tsc --noEmit -p .`, `npx vitest run` and `npx next build`, then
   push (owner's OK).
3. **Windows installs**, as the server task's user (`docs/SELF_HOST.md`):
   - `winget install Python.Python.3.12`
   - `winget install Gyan.FFmpeg`
   - `winget install Google.Chrome`
   - `python -m pip install -r D:\BuPulse\tools\ad-render\requirements.txt`
   - check with `python D:\BuPulse\tools\ad-render\render.py selftest`
4. **Update the PC**: `powershell -ExecutionPolicy Bypass -File D:\BuPulse\scripts\self-host\windows\update.ps1`. Its
   build runs `prisma migrate deploy`, which applies the three migrations to production. Then restart the "BuPulse
   server" task so it sees the new PATH (Python, ffmpeg, Chrome).
5. **Admin settings** on bupulse.com:
   - AI → monthly AI cap **$60**
   - Settings → Ad Brain limits: **$3 per ad, $30 per month**, and BuPulse's own
     gallery videos **1,024 MB**
   - Services: Google Gemini and Google Veo AI clips (Omni) **on**
6. **Company account**: check that office@bupulse.com is BuPulse's own business on production (Business info, logo, a
   week of posts), so the robot's captures have real data.
7. **ANTHROPIC_API_KEY** is not needed: the Ad Brain uses Gemini unless `AD_BRAIN_MODEL=claude`.
8. **First run**:
   - Admin → Ad Brain → "Capture the screens now". Expect about 12 pictures, empty pages kept out.
   - Then "Re-render the cached ad". This works only where the prototype folder exists, so skip it on the PC.
   - Then "Make an ad": about $2-3 and 15-30 minutes. The owner approved this first full ad on the live site.
9. **Check the result**: the ad plays in the company account's Videos library, and its 4 posts wait on the Posts page.
   Approve one by hand only after watching it.
