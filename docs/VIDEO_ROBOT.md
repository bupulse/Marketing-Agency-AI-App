# Video robot

Content videos are normally made in the owner's browser when they open the post (`docs/CONTENT_VISUALS.md`). The
video robot makes them automatically instead: a free GitHub Actions job (`.github/workflows/video-robot.yml`) runs
every 15 minutes, opens headless Google Chrome on the runner, draws each pending video with the app's own browser
renderer (`components/visuals/video-renderer.ts` and `lib/visuals/timeline.ts`, bundled as they are), uploads the file
and confirms it. From there the normal flow continues: the same checks and billing as a browser upload, the video goes
on its Autopilot posts, and whatever runs when a video is ready (auto-scheduling where the company does not require
approval; otherwise the post stays in review with its video ready).

It costs nothing: GitHub Actions minutes are free for public repositories, Chrome is already on GitHub's Ubuntu
runner, and the app only answers short API calls (well inside Netlify's 60 s per request; no video is ever rendered in
a Netlify function).

## Set it up

1. Make a secret: `openssl rand -hex 32`.
2. **Netlify** (or Cloudflare) environment: `VIDEO_ROBOT_SECRET` = that value. Redeploy so the functions see it.
3. **GitHub**, repository Settings, Secrets and variables, Actions:
   - Secrets: `VIDEO_ROBOT_SECRET` = the same value.
   - Variables: `ROBOT_APP_URL` = the site, for example `https://bupulse.com` (no trailing slash needed).
4. Test: Actions, "Video robot", Run workflow. The log shows only counts, for example
   `Videos waiting: videos 2`, `Encoder: format mp4`, `Run finished: claimed 2, made 2, failed 0`.
   Admin, Services, "Video robot" shows the last run and the made and failed counts of the last 24 hours; Admin,
   Health lists it with the other scheduled jobs.

Until both the secret and the variable are set the workflow skips quietly, and the app's robot API answers 404.
To switch it off, delete the secret in Netlify (owners make videos in their browser again) or disable the workflow.

## How a run works

1. **Peek** (`node scripts/video-robot/robot.mjs peek`, no install): how many videos wait. None: the run ends after a
   few seconds and leaves a heartbeat.
2. **Install** (`npm ci --ignore-scripts`, cached): esbuild and playwright-core. Playwright only drives the runner's
   Google Chrome (`channel: "chrome"`); it downloads no browser.
3. **Claim** (`POST /api/robot/videos/claim`): up to 2 videos at a time, oldest first. Each is leased for 15 minutes
   (compare-and-set on `renderingUntil`, the same lease the picture drawing uses), so two runs, or the robot and an
   owner's browser, never make the same video. The upload is reserved through `prepareVideoUpload`, exactly as for the
   browser (plan has video, video seconds left, media quota, platform storage guard, at most 3 open uploads). A video
   that fails those checks is released and tried again next run; it does not count as a failure. Each job carries the
   video plan, signed download URLs of its photos (30 minutes, only photos in the owner's own folders) and a signed
   upload URL. No database ids or storage keys are sent apart from what those signed URLs contain.
4. **Render**: the page is bundled from `scripts/video-robot/page-entry.ts` with the renderer and served to Chrome
   from memory. Photos are downloaded by Node (12 MB and 20 s at most each) and passed as data URLs; a photo that fails
   draws the brand backdrop, as in the browser. At most 5 minutes per video (less if the lease is shorter).
5. **Upload and confirm** (`POST /api/robot/videos/complete`, job id only): the server runs `finalizeVideo`, the
   browser's own path: the file's real length is read and billed once (`videoSeconds`), the quota is checked with the
   real size, the old file is replaced, the Autopilot posts get the video, and the post-video hooks run. Confirming
   twice bills once.
6. **Fail** (`POST /api/robot/videos/fail`, job id and a reason code): the lease and the reservation go (with the file),
   and the attempt is counted (`robotAttempts`). After **3** failed robot renders the robot leaves the video alone and
   the owner's screen says "We could not make it automatically. Make it here in your browser." Editing the captions or
   making the video again starts the count over.
7. **Report** (`POST /api/robot/videos/report`): claimed, made and failed counts (a `CronRun` row, job `video-robot`).

The run stops claiming when about 17 minutes have passed (the job is killed at 20) or after 12 videos; the workflow's
concurrency group stops runs overlapping.

## MP4 or WebM

The robot makes MP4 (WebCodecs H.264 through `mp4-muxer`, the browser's main path) when the runner's Chrome can encode
H.264 at 1080x1920. Google Chrome (unlike Chromium) ships an H.264 encoder on Linux (OpenH264), so this is the normal
case; the renderer tries High, Main and then Baseline profiles. If no H.264 encoder is available the robot uses the
renderer's WebM path (MediaRecorder, real time: a 30 s video takes 30 s), which works in every Chrome; WebM videos
are accepted everywhere a browser-made WebM is. `ROBOT_FORMAT=webm` forces it. ffmpeg was not used: it would mean a
second drawing code path (a different look) or extra installs, while Chrome's own encoders keep the output identical
to an owner's browser.

Checked locally on 13 October 2026 (`node scripts/video-robot/self-test.mjs`, macOS, Google Chrome headless, fake
app on 127.0.0.1): MP4 10.5 s video, 1.7 MB, length read back as 10,500 ms, made in about 35 s with the photo and
captions drawn; WebM forced: 10.4 s, made in about 23 s. Not yet run on GitHub's Ubuntu runner: the first
"Run workflow" shows `Encoder: format mp4` or `format webm`.

## Fonts

The renderer loads the caption font of the video's style (Inter, Playfair Display, Anton or Nunito; Latin and Latin
Extended) from the same pinned Fontsource CDN the slide designs use, with a 4 s limit, in the browser and in the robot
alike, so both videos look the same. Without the CDN both fall back to system fonts.

## Limits

- GitHub's scheduled runs are often late (5 to 30 minutes, sometimes more at busy times) and may be skipped; the
  screen says "usually within 30 min" and owners can always click "Make it now".
- GitHub disables scheduled workflows after 60 days without commits to the repository; re-enable it in Actions.
- Free minutes are unlimited only while the repository is public. In a private repository each run uses minutes from
  the free 2,000 a month (an idle run takes well under a minute; a busy one 3 to 15).
- The repository and its Actions logs are public: the robot prints only event names and counts
  (`scripts/video-robot/log.mjs`; `tests/video-robot-script.test.ts` checks it) and uploads no artifacts.
- The API is rate-limited (120 calls an hour per IP, `RATE_LIMITS.videoRobot`); a run makes about 5 to 15.
- Music is never added by the robot (owners add their own music from the video panel, in the browser).

## Code

- `lib/visuals/robot.ts`: claim, complete, fail, heartbeat, the owner's screen state, the admin status.
- `lib/visuals/robot-auth.ts`: bearer check (constant time), rate limit, off without the secret.
- `app/api/robot/videos/{peek,claim,complete,fail,report}/route.ts`.
- `scripts/video-robot/`: `robot.mjs` (the robot), `page-entry.ts` and `build-page.mjs` (the page), `log.mjs` (the only
  printer), `self-test.mjs` (local check against a fake app).
- Migration `20261016090000_video_robot`: `ContentVisual.robotJobId` (unique) and `robotAttempts`, and the queue index.
- Owner screen: `components/visuals/content-visual.tsx` ("Being made automatically", "Make it now"), the browser takes
  the lease first (`startVideoRender`, `leaseVideoForBrowser`).
- Tests: `tests/visuals/robot.test.ts`, `tests/visuals/robot-api.test.ts`, `tests/video-robot-script.test.ts`,
  `tests/workflows-pinned.test.ts`.
