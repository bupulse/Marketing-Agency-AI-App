# Video engine: launch check for bupulse.com (Netlify free)

A read-only check of the video engine against production on Netlify's free plan (24 October 2026, video-engine agent,
for the main session while the owner is away). Nothing paid was called. The code read is quiz-mode at 0aad03c2 (what
test.bupulse.com runs), plus the fixes below.

Netlify's limits, from `docs/DEPLOY_NETLIFY.md`:
- Every request stops after **60 s**. `export const maxDuration` above 60 is ignored there.
- Scheduled functions stop after 30 s, so they only hand the job to `cron-runner-background`, which calls the route.
- `lib/platform/limits.ts` (`timeBudget`, `hasShortRequestLimit`) is how the code shortens its own budgets on Netlify.

## Summary

| Question | Answer |
| --- | --- |
| Any path doing more than about 25 s in one call? | Yes, four. All are fixed: overnight clips, the robot's claim and the Studio design route (video-engine, 80f23229), and the reel engine (client-qa, 658f3e43 and f146ee0f). |
| Claude subscription or local CLI in production? | No. Every path that could use it is refused on Netlify and Cloudflare (details below). Studio designs use `ANTHROPIC_API_KEY` only. |
| Google's daily limit running out for many businesses at once? | Nobody is charged for clips that are not made. Overnight videos wait, try 3 times, then become slideshows with credits back. Reels retry every minute without end while their page is open (client-qa). Studio clips fail at once with credits back. |
| Env settings | Table at the end. |

## 1. Request paths and time

### Fixed in this commit (video engine)

1. **Overnight AI clips** (`runAiClips`, inside `/api/cron/video-jobs`, every 10 minutes on Netlify).
   - Before: no time limit. One sweep could start and check up to 15 videos, and a video's work includes downloading
     a photo, making the first frame, sending to Google, and downloading and saving a finished clip of about 5 MB.
   - `VEO_PARALLEL` (3 clips at Google at once) kept the real work to about 6 clip actions a sweep, but nothing stopped
     at 60 s.
   - Now: a budget of 25 s on Netlify (90 s elsewhere), checked before each video, so a video is never cut in half.
     Videos left over wait for the next sweep with nothing taken. Test: "a sweep out of time leaves the videos for the
     next one".
2. **The robot's claim** (`POST /api/robot/videos/claim`, called by the GitHub robot).
   - Each claimed video may make its voice-over first (`ensureVoiceover`: a script shortening with the AI, then
     ElevenLabs), one after another. Up to 5 videos per claim.
   - Before: 2 to 5 new voice-overs could pass 60 s. Netlify would then cut the request, the leases would stay set and
     an attempt would be counted, so a video could fail 3 times without ever being rendered.
   - Now: after 20 s on Netlify (120 s elsewhere) the claim answers with the videos it has prepared, always at least
     one; the rest wait for the robot's next claim. Test: "out of time (Netlify's 60 s)".
   - Left as is: a single voice-over has ElevenLabs timeouts of 60 s and 110 s (`lib/ai/tts.ts`). A normal take is a
     few seconds; a stuck one would still be cut by Netlify, and the lease and attempt rules above cover it.
3. **Studio design route** (`POST /api/video/design`).
   - A design takes 30 to 60 s per call (4 versions side by side, a second Claude call when the first answer cannot
     be read). Its `maxDuration` of 300 is ignored on Netlify, so a design would be cut off after Claude was paid. The
     sweep would refund the credits, but the Claude cost would be lost.
   - Nothing in BuPulse calls this route any more: designs are made in the Video Studio at studio.bupulse.com, which
     runs as its own server (owner decision of 19 October 2026, `docs/STUDIO_DEPLOY.md`).
   - Now: refused on Netlify with 503 `studio_only` ("Videos are designed in the Video Studio…") before anything is
     charged or called. Other hosts (the test site) are unchanged. Test: "503 on Netlify (60 s per request)".

### Checked, fine

- The rest of `/api/cron/video-jobs`: stranded designs and voice reservations (database updates, 100 a run), Seedance
  bookkeeping, and "video ready" emails. All short. Its `maxDuration = 120` does nothing on Netlify, and the work fits
  in 60 s with the clip budget above.
- `POST /api/robot/videos/complete`: database and Storage checks only.
- `POST /api/video/jobs/<id>/voice`: one ElevenLabs take, normally well under 60 s. Also unused by BuPulse's pages.
- Content videos (slideshows) are never rendered on Netlify. The owner's browser renders them, or the robot on
  GitHub's runner does.

### Reel engine (client-qa's area): done

**Fixed by client-qa** in 658f3e43 and f146ee0f, on quiz-mode and the test site since 24 October 2026. See
`docs/REEL_ENGINE.md` "Before clients: Netlify's 60 s":
- Starting is quick, and planning is done in steps.
- A reel with nothing to film fails instead of assembling.
- Each step does one heavy thing, with a 25 s budget.
- Paid work (a clip at Google, a saved clip) is saved at once.
- `VEO_PARALLEL` counts across all businesses, and a wait at Google's limit is shared.
- After 30 minutes at the limit the waiting clips fail with a plain message.

The findings as reported, kept for the record:

Its only callers are the server actions in `app/dashboard/video/reel-actions.ts`, driven by the browser. It is off
unless the business is in `REEL_ENGINE_BUSINESSES`, and its total spend is capped by `REEL_TEST_CAP_USD` (default $10).
None of it used `timeBudget`. Before it is opened to clients on Netlify:

1. **`startReel` is one long call.** It can make a presenter portrait (Gemini image, up to 120 s with retries), then
   write the script with the AI (10 to 40 s). That can pass 60 s on a business's first reel.
2. **Killed mid-start.** The job is created as "filming" with no clips before that work begins. If Netlify cuts the
   call, the job keeps a 3-minute lease. After it, `stepReel` finds no clips, and
   `plan.clips.every(c => c.status === "done")` is true for an empty list, so the job moves to "assembling" with 0
   clips (engine.ts:230 and :411, found by reading the code, not run).
3. **One `stepReel` call can pass 60 s.**
   - Painting a start frame takes one or two image calls plus a check.
   - Up to 3 clip sends happen in one call.
   - Or one finished clip's download (up to 120 s timeout), upload and check (90 s timeout).
4. **Paid work can be lost.**
   - `clip.operation` and the frame paths are saved only at the end of a step.
   - If Netlify cuts a step after Google accepted a clip, the clip is billed but forgotten, and the next step sends a
     second paid clip.
5. **Google's daily limit.**
   - A clip at the limit waits 60 s and is sent again, with no limit on tries.
   - `VEO_PARALLEL` (3) counts per reel, not across businesses, so many reels at once would all keep trying every
     minute while their pages are open.

Suggested shape: save after each paid action (a clip sent, a frame painted), put a `timeBudget` in `stepReel`, move
planning into steps, and give up (and say why) after a few "at its limit" answers.

## 2. Claude subscription and the local CLI

- The only CLI caller is `lib/image-engine/claude-cli.ts` (`claude -p` through `node:child_process`). It is refused
  unless `IMAGE_ENGINE_CLAUDE_SUBSCRIPTION=1` **and** the host is neither Netlify nor Cloudflare (`subscriptionAllowed`),
  and `claudeBySubscription` checks again before it spawns anything.
- Two things reach it: the image engine's and reel engine's Claude route (`lib/image-engine/planner.ts`: subscription
  only when `ANTHROPIC_API_KEY` is empty and the lock allows it), and Training Lab brains set to "claude-subscription"
  (`lib/training-lab/brains.ts`, same lock). Both are refused on bupulse.com.
- Studio designs (`lib/video-studio/jobs.ts`) use the API key only, through the cost ledger.
- The Video Lab's own subscription mode (`VIDEO_LAB_CLAUDE`) lives only in `video-lab/` (the Mac and studio server),
  not in the Next.js app.
- **Before the studio server goes live:** set `ANTHROPIC_API_KEY` there, leave `VIDEO_LAB_CLAUDE` and
  `IMAGE_ENGINE_CLAUDE_SUBSCRIPTION` unset, and move every Training Lab brain on "claude-subscription" to the API key
  (Admin → Training Lab → Team). This is on the owner's list.

## 3. When Google's daily limit runs out for many businesses

Google's limit is per Gemini key (one key for all of BuPulse). A clip refused at the limit is not made and not
billed (`RESOURCE_EXHAUSTED` is read as `VeoError` kind "quota").

| Where | What happens | Credits |
| --- | --- | --- |
| Overnight clips (Autopilot / Daily posts videos marked "ai") | At most 3 clips at Google at once across all businesses. A refused clip is sent again from the next sweep, 3 sends in all, then the video is a slideshow that says "Google was too busy to make the AI clips". `VEO_CLIPS_PER_DAY` (10, or 0 to pause) caps the day, counting re-sends. | Taken when the video starts; given back exactly once for clips not made. |
| Video Studio clips (studio server, `video-lab/ai-clips.ts`) | The clip waits a minute and is sent again, up to `QUOTA_WAITS` (3) times, without counting as a try. Then it fails with Google's limit message. It used to fail at once. | Given back. |
| Reels (test businesses only) | At most `VEO_PARALLEL` clips at Google across all reels, and a wait at the limit is shared. After 30 minutes (`BUSY_GIVE_UP_MS`) the waiting clips fail with a plain message (client-qa's fix; it used to retry without end). | No credits yet; the test cap counts spend. Nothing is paid for clips that were not made. |

If the daily limit is hit every day, raise it with Google (AI Studio, the key's project, quotas) or lower
`VEO_CLIPS_PER_DAY`. Nothing piles up on BuPulse's side for overnight videos: each sweep looks at no more than 5 new
and 10 working videos.

The studio's clips now wait and retry at the limit, as overnight clips do (done 24 October 2026).

## 4. Netlify credits: the video sweep every 10 minutes

Every 4 minutes, `netlify/functions/cron-video-jobs.mts` would run about 10,800 times a month, each three invocations
(scheduled function, background runner, route), about 15 to 50 of the 300 monthly credits, and it was not in
`docs/DEPLOY_NETLIFY.md`'s estimate.

**Decided** (main session, 24 October 2026, while the owner was away): every 10 minutes on Netlify, about 4,300 runs, roughly
6 to 20 credits, now in the estimate. Cloudflare and the test site stay at 4 minutes. `NETLIFY_VIDEO_JOBS_EVERY_MINUTES`
in `lib/platform/limits.ts`; `tests/netlify-crons.test.ts` checks the schedule. Overnight clips re-send at Google's
limit once a sweep, up to 3 times, so `CLIP_GIVE_UP_MS` went from 20 to 45 minutes and a clip at the limit still gets
its third send. A stranded Studio design is refunded up to 10 minutes later, and "video ready" emails go out up to 10
minutes later.

## 5. Settings production needs (video)

Keys can be set in Netlify's environment or saved in Admin → Services (`lib/admin/service-keys.ts`). The Admin
switches (Google Veo AI clips, ElevenLabs, Claude, Seedance) are in the database, not the environment.

| Setting | Where | Needed for | If unset |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` (billing on) | Netlify / Admin | Overnight AI clips (Gemini Omni), reels, image checks | No AI clips: "ai" videos become slideshows ("paused"). |
| `VEO_MODEL` | Netlify | AI clip model | `gemini-omni-1.1-flash` (right; Veo 3.1 was shut down on 22 Oct 2026). |
| `VEO_CLIPS_PER_DAY` | Netlify | BuPulse's own daily clip cap, all companies | 10 (about $6 a day). 0 pauses overnight clips. |
| `VEO_USD_PER_SECOND` | Netlify | Cost ledger price override | List price, about $0.10 a second. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` | Netlify / Admin | Voice-overs (content videos, robot, Studio) | Videos without a voice. |
| `ANTHROPIC_API_KEY` | Netlify / Admin | AI text where Claude is chosen (`AI_TEXT_PROVIDER`), voice script shortening | Gemini is used for text (`AI_TEXT_PROVIDER` default "gemini"). |
| `CRON_SECRET` | Netlify | `/api/cron/video-jobs` and the background runner | The sweep answers 500: no refunds of stranded jobs, no overnight clips, no "ready" emails. |
| `VIDEO_ROBOT_SECRET` | Netlify **and** GitHub secret | The robot's claim and complete calls | The robot is off; owners render videos in their browser. |
| `ROBOT_APP_URL` | GitHub variable | Where the robot calls (`https://bupulse.com`) | The robot workflow skips quietly. |
| `ROBOT_MAX_VIDEOS`, `ROBOT_CONCURRENCY`, `ROBOT_VIDEO_TIMEOUT_MS`, `ROBOT_BUDGET_MS`, `ROBOT_FORMAT` | GitHub (robot) | Robot pacing | Defaults: 12 videos a run, 1 at a time, MP4. |
| `STUDIO_URL` | Netlify / Admin → Services → Video Studio | The "Open Video Studio" button and tickets | `https://studio.bupulse.com`. |
| `SEEDANCE_API_KEY`, `SEEDANCE_MODEL`, `SEEDANCE_BASE_URL`, `SEEDANCE_USD_PER_M_TOKENS` | Studio server / Admin | Seedance clips (after launch) | Seedance off. |
| `REEL_ENGINE_BUSINESSES`, `REEL_TEST_CAP_USD` | Netlify | Reels (client-qa) | Reels off for everyone (right for launch). |
| `IMAGE_ENGINE_CLAUDE_SUBSCRIPTION`, `VIDEO_LAB_CLAUDE` | **Never in production** | Test-only subscription mode | Correct when unset. |
| `PLATFORM=netlify` | Netlify build (netlify.toml) | Turns on the shorter time budgets above | Detected from Netlify's own variables anyway. |

Not covered here: the studio server's own settings (`STUDIO_SESSION_SECRET`, Supabase keys and so on), which are in
`docs/STUDIO_DEPLOY.md`.

## Waiting for the owner

1. Before the studio server goes live: API keys only, with no subscription (section 2).
2. Reels on Netlify: client-qa's fixes are done (section 1). Allow-listing a client business is the owner's choice.
