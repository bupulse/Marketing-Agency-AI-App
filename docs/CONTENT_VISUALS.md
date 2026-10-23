# Content visuals

Every piece of content BuPulse writes comes with its visual: a branded image or a 3 to 5 slide carousel, and for
video content a 10 to 30 second vertical video, with the caption below. The owner gets it ready to approve and can
change it. Code: `lib/visuals/`, `components/visuals/`, `app/dashboard/visuals/actions.ts`.

## How a visual is made

1. **Text first.** Studio (`generateForSubject`) or Autopilot (`runAutopilot`) writes the content as before.
2. **Art director.** One cheap text call (`lib/visuals/art-director.ts`, `getCheapTextProvider`, JSON schema,
   through `withLedger` with feature `visuals`, so the platform cap and the company allowance apply) reads the
   content and returns the format (single or carousel), the style pack, and per slide the template, the headline,
   subline, chip and kicker (short, from the content, in its language) and the picture source: `album` (one of the
   product's or campaign's own photos, free), `ai` (a Gemini photo of a scene, 1 image credit) or `none` (a text design).
   Owner text is fenced as data (`<<<POST ... POST>>>`, fences in the text removed).
3. **Rules check the answer** (`lib/visuals/direction.ts`, pure): unknown pack or template repaired
   (`recommendPack` and the subject's best template), texts clipped (headline 60, subline 110, chip 24), a chip whose
   numbers the content does not state is dropped (no invented prices or dates), WebP album photos skipped (Satori
   cannot draw them), photo templates without a photo become `announcement`, a carousel only where a connected network
   takes carousels and with 3 to 5 slides, at most 1 AI photo per visual and only when allowed. An answer that does not
   parse, an AI error, a timeout (12 s) or the budget cap gives `fallbackPlan` (the same rules without AI). The
   result is a `ContentVisual` row with status `pending`. Each slide then gets a design of the library chosen by
   BuPulse (`assignDesigns`, docs/DESIGNS.md "Design library"), avoiding the business's recent designs.
4. **Drawing** (`renderImageStep`): the content screen calls `renderVisual` until the visual is `ready`; each call
   draws slides for at most 30 s (Netlify stops a function at 60 s). A slide is drawn with the existing designs engine
   (`createTemplateDesign`, `Design` rows, `designs` bucket). An AI slide first pays for the photo with
   `createAiDesign` (1 image credit, `consumeUsage`, `withLedger` feature `image`, refund on failure); the photo is kept
   as a design and the template draws over it, so re-styling never pays twice. When the credit, the allowance or the AI
   fails, the slide uses the album photo or a text design and says why. A text design that cannot be drawn either marks
   the visual `failed` with a message; the content itself is never affected. Each call first takes a 2-minute lease
   (`renderingUntil`, compare-and-set), so two tabs never draw (or pay for) the same visual; the other call answers
   "rendering" and the screen waits. An AI photo is saved into the plan the moment it is paid for, before the template
   is drawn, so a failed draw keeps it and the retry reuses it. Changing a picture while it is being drawn is refused ("still being drawn").

AI photos are offered to the art director only when `aiPhotosAvailable`: the `aiPhotos` feature, an image credit left
this month, and the company AI allowance not reached.

### People in the pictures

Owner decision (13 October 2026): posts almost always show people.

- When AI photos are allowed, the cover is an AI scene with people: customers using or enjoying the product or
  service, staff serving, a family at home. The product's best album photo is the reference image, so the real product
  stays recognisable (a woman in Kigali holding the real phone). Without a photo, the scene is made from the
  description. A post without people is the rare exception: a price list, a quote card, or AI images not available
  (then the real photos and brand designs are used, never a failure).
- The art director returns a structured `people` brief (`lib/visuals/people.ts`): age band (18–25, 26–40, 41–60, 60+:
  adults only), gender (woman, man, mixed group) and role (customer, staff, family adults, team, professional) from
  fixed lists, plus activity, place, mood and framing as free text that goes through `safePhrase` (fences, control
  characters, minors, nudity, medical and before-and-after words removed, and a public figure's title together with
  the name after it). The country reaches a prompt only when it is on the sign-up list (`knownCountry`); the area and
  persona fields go through `safePhrase` too. Missing, BuPulse writes it from the company's country and first persona
  (Rwanda: Rwandans in Kigali settings, everyday clothes; ages and gender from the persona; under-18 and "all ages"
  personas still give adults).
- The image prompt (`lib/designs/prompt.ts`) adds: never a real, famous or recognisable person or a lookalike; adults
  only; respectful everyday clothing; nothing medical, no before-and-after; no text or logos (text comes from the
  templates).
- Carousels use one AI image: the cover; the other slides are designed slides (`useCoverPhoto`) over the same photo.
  Videos use the people photo for their opening scene and scenes without a photo; no AI image is made for a video.
- Autopilot: "Use AI images" is now on by default for new settings (existing settings keep the owner's choice).

### AI images and allowance by plan

| Plan | AI images a month (`image`) | Company AI allowance (`aiMonthlyUsd`) |
| --- | --- | --- |
| Rwanda Starter, Standard | 30 | $2 |
| Rwanda Business, Pro | 100 | $6 |
| Trial | 5 | $1 |

Set by `20261016130000_people_images` (`PlanDefinition.aiMonthlyUsd`, `limits.image`, card copy "N AI images a
month"); `companyAllowanceUsd` reads the plan's allowance (cached 30 s), else the code's seed plan, else
`AI_COMPANY_MONTHLY_USD`. When the images run out the visual is a free design from real photos and says "AI images for
this month used — next refill on <date>" with "Get an image pack (+50 AI images)" (add-on `block:image`, 5,000 RWF a
month in Rwanda, admin-editable). An image pack raises the dollar allowance too: a custom plan's `aiMonthlyUsd` is set
when its offer is accepted to its base plan's allowance plus $2 per pack (50 images at cost, rounded up,
`lib/offers/allowance.ts`); a custom plan without a base or an allowance gets its AI images at cost x 1.5 plus $1. When
the dollar allowance stops the images first, the same "AI images for this month used" message shows the 1st of next
month. The drawing lease (`RENDER_LEASE_MS`, 4 minutes) outlasts the slowest AI photo call (120 s timeout plus up to
30 s of SDK retries) so a second call never pays for the same photo.

### Carousel or single

`shouldCarousel`: a network that takes carousels (Instagram, Facebook, LinkedIn; with none connected yet, yes) and
either a list of 3 or more tips, steps or reasons in the caption, or 2 or more drawable album photos. The art director
may still choose single.

## Video

Free slideshow videos now; real AI video is a seam (`lib/visuals/ai-video.ts`, "AI video (coming soon)" disabled on the
screen).

- **Plan on the server** (`lib/visuals/video-plan.ts`, pure): from the video script (timestamps, scene labels and stage
  directions removed), a hook scene (the headline), up to 5 body scenes and a closing scene (the business name); each
  scene 2 to 6 s by caption length, then scaled so the video lasts 10 to 30 s with 0.5 s crossfades; album photos cycle
  through the scenes (none: the brand backdrop; an AI photo from the image visual is lent when there is one); Ken Burns
  moves alternate; colours from the brand (`buildTheme`), style from the pack. A **video look** (docs/DESIGNS.md,
  "Video looks") chosen by BuPulse sets layouts, transition, captions and motion; plans without one render as before. Made with the text when the plan has
  video (`videoAvailable`: the `video` feature and more than 0 videos a month) and there is a script.
- **"Make a video" never asks for a script first** (`remakeContentVisuals`, `lib/visuals/script-writer.ts`). Content
  without a video script gets one written by the AI from its own post (caption, angle, the subject's Knowledge base,
  the Digital Marketing Profile's voice and language mix): one text call through `withLedger`, **1 text generation**
  (shown on the button and under it; given back when the call fails), saved on the content, then the video is planned
  and made as usual. **"Write my own script"** opens a box with a scene helper (one line per scene, a shot idea in
  `[brackets]`, scene count, spoken characters and seconds of voice as you type); the owner's script is used as typed,
  no credit. Only "Videos are not in your plan" still stops it. Script rules (`lib/visuals/script.ts`, shared by the
  pack writer, Autopilot's writer and the script writer): 3 to 5 scenes, each spoken line at most 80 characters, at
  most 330 spoken characters in all (the headline opens the video and the business name closes it, so the voiceover
  stays within 30 seconds at about 15 characters a second, `docs/VOICE_AND_MUSIC.md`); an AI script is held to them
  (`fitScript`: extra scenes and over-long lines cut, hashtags out, the call to action kept).
- **Render in the browser** (`components/visuals/video-renderer.ts`): 1080x1920 at 30 fps on a canvas, captions
  burned in, MP4 through WebCodecs H.264 and `mp4-muxer` (MIT, about 14 KB gzipped, loaded only when a video is made;
  the library is superseded by Mediabunny but stable), else a real-time WebM through MediaRecorder, else a clear
  message and the picture is used. Re-encoded once at 55% bitrate if over 8 MB. Optional music only from a file the
  owner picks (decoded and encoded to AAC in the browser, never stored, no bundled music); skipped with a note when the
  browser cannot encode it. Timeline maths is pure and tested (`lib/visuals/timeline.ts`).
- **Upload** (`use-video-render.ts`): `startVideoUpload` checks the plan feature, MP4 or WebM, at most 8 MB and 30 s,
  the videos left (this month's and today's, unless it remakes a video it already has), the company's media quota and the platform guard, records a **reservation** on the visual
  (`uploadPath`, 8 MB, one hour; counted in the quotas like a stored video; at most 3 open per company), then gives a
  signed upload URL for `<userId>/videos/<visualId>-<n>.mp4` in the `media` bucket. `finishVideoUpload` re-checks the
  plan, takes only the reserved path (a file written straight into the folder is refused), checks the quota again with
  the real size (the visual's own old video and reservation are not counted twice; also when preparing), downloads the file (at most 8 MB), checks its first bytes (`ftyp` or EBML), reads its **real length** from the
  file (`lib/visuals/duration.ts`: MP4 `mvhd`; WebM Info Duration, else the last block's timecode, since MediaRecorder
  writes none), refuses more than 30.5 s, bills those seconds, clears the reservation, replaces the old file and, for
  Autopilot, puts the video on the group's posts. A rejected file is deleted. Confirming the same file twice bills once.
- **Video robot** (`docs/VIDEO_ROBOT.md`, optional, on when `VIDEO_ROBOT_SECRET` is set): a GitHub Actions job every
  15 minutes makes pending videos in headless Chrome with this same renderer and confirms them through the same
  upload checks, so nobody has to open the post. The screen then says "Being made automatically" and offers "Make it
  now" (the browser takes the render lease unless the robot holds it). After 3 failed robot renders the video is left
  to the browser. Caption fonts (Inter, or the pack's display font, SIL OFL) are self-hosted in `public/fonts/video`
  and loaded by the renderer, so the robot's and the browser's videos look the same.
- **When it renders**: on the subject's day view (Content, "Pictures and videos"; the first pending video of the day) as soon as the video is pending (progress bar), unless the video robot is on. On Autopilot cards the badge
  says "Video ready to render"; it renders when the owner opens the card's "Make the video" panel, one card at a time.
- Without video in the plan the screen shows the picture with "Add video to your plan" (`/dashboard/upgrade?feature=video`).

Videos count toward the company's media quota (500 items, 2 GB: `mediaUsage` adds `ContentVisual` video bytes) and the
platform guard (`platformBytes`, `MEDIA_PLATFORM_MAX_BYTES`, 900 MB default). The media bucket now accepts
`video/mp4` and `video/webm` (still 10 MB per file).

### Video quality (owner decision, 23 October 2026)

Autopilot (its settings card) and Daily posts (Content -> Settings) have a **Videos** choice, shown when the plan makes
videos: **Simple videos** (the default: the slideshow above, no studio credits), **Mix** (one video in four gets AI
clips, picked by a stable hash of the group or content id) and **AI videos** (every video gets AI clips). Mix and AI
videos are greyed out, with the reason, while the "Google Veo AI clips" switch is off or the plan has no studio credits
(`videoQualityOffer`, lib/visuals/video-quality-server.ts). Stored in `AutopilotSettings.videoQuality` (migration
`20261030220000_autopilot_video_quality`) and `Business.dailyPostSettings.videoQuality`; anything unknown reads as
simple.

The planners mark a video that should get AI clips with `VideoPlan.quality = "ai"` (`videoGetsAiClips` in
lib/visuals/video-quality.ts; Autopilot's `planGroupVideo`, Daily posts through `planVisuals({ videoQuality })`). An
unmarked plan, or "simple", is the slideshow. **Making the clips is the video engine's part** (requested from the
video-engine session, 23 October 2026): overnight, without the owner, submit and check Veo clips
(`AI_CLIPS_PER_VIDEO` × `AI_CLIP_SECONDS`, priced with `veoClipCredits`, paid in studio credits), draw them in the
slideshow, and fall back to the simple video, credits given back, when the switch, the credits or the AI cannot. Until
then a marked plan renders as the slideshow.

## What the owner can change

On the day view's "Pictures and videos" (Content, docs/CONTENT.md) and the Autopilot card ("Picture and video"):

| Action | What happens | Cost |
| --- | --- | --- |
| Approve as it is | nothing to do; Schedule takes the visual | none |
| Swap photo | album or gallery photo for the slide (JPG/PNG), redrawn | free |
| New design | every slide gets a different design of the same style (BuPulse picks it); photos and AI photos are reused | free |
| Style (under "More options") | every slide redrawn with designs of the new style; AI photos are reused | free |
| Edit text | headline, subline, chip per slide, redrawn | free |
| New picture | fresh art direction, the old slides go (unless a post uses them) | art director call; AI photo uses a credit |
| Make a video | the AI writes the script when there is none, then the video is made | 1 text generation without a script; one video when made |
| Write my own script | the owner's lines, one per scene, used as typed; then the video is made | one video when made |
| Remove | slide designs and video file go unless a post uses them; AI photos stay in Designs | none |
| Edit captions / Make it again / Add your music / music or voice change | new video plan or same plan, rendered again | only the seconds beyond the current video |

**Remakes** (fix from the Chrome test, 13 October 2026): a video that already exists is replaced, not paid again. The
seconds of the current video (`remakeCredit`: the visual's billed `seconds` while its file is there) are not counted
again; a longer remake counts only the extra seconds (`prepareVideoUpload` and `finalizeVideo`, browser and robot
alike). A remake that would need more seconds than are left is refused before it starts, with that message
(`assertRemakeAllowed`, in captions, photos, music and voice changes). The current file stays on the panel and on its
posts (`readyMedia` takes a video being made again, pending or failed) until the new one is confirmed; a refused or
failed remake keeps it. After the 30-day clean-up removed the file, a remake is a new video and counts in full.

Edited content versions keep their visuals (`carryVisuals`); pruned versions release theirs (`releaseContentVisuals`).

## Posts

`lib/visuals/post-media.ts` (pure):

- Feed posts take the carousel where the network has carousels (capped to its photo limit), else the first slide.
  Instagram's JPEG conversion runs as before; videos are skipped there.
- Video ideas (SCRIPT) become real video posts where BuPulse publishes video: Instagram Reels (`media_type=REELS`,
  MP4 only, the container is polled like images) and Facebook Page videos (`/videos` with `file_url`). TikTok and
  YouTube keep the script reminder, with the video attached; the reminder email links "Your video" for 7 days.
- The composer (`createPosts`): Schedule from content prefills the ready slides; a video in the media goes alone where
  the network takes it and with TikTok's or YouTube's reminder; LinkedIn and others get the photos or the content's
  picture instead.
- Autopilot (`lib/autopilot/visuals.ts`): each group gets its visual recorded on the group (`ContentVisual.groupId`).
  The art director is asked only when a carousel is likely; otherwise the playbook's single image is made as before
  (every size). Carousels have at most 3 slides; a run makes at most 5 AI photos and 30 renders. Video ideas get a
  video plan; when it is rendered the group's SCRIPT posts get it (Instagram/Facebook become video posts). A redrawn
  picture replaces the pictures on the group's posts that have not gone out.

## Data

`ContentVisual` (`prisma/migrations/20261015090000_content_visuals`): `businessId`, `contentId` (GeneratedContent,
cascade) or `groupId` (Autopilot post group), `kind` image | carousel | video, `status` pending | ready | failed,
`items` (ordered `{ designId?, path }`), `plan` (ImagePlan or VideoPlan, `lib/visuals/types.ts`), `bytes`, `seconds`,
`error`, `renderedAt`. CHECK constraints on kind, status and owner; RLS on and all grants revoked. The migration also
widens the media bucket's types and gives the Pro plan row the `video` key (Pro has the videos).

## Features and plans

`video` is a built feature ("Videos", metric `videos`). Usage counts **videos, not seconds** (owner decision,
14 October 2026; it was 240 video seconds a month before): each video is at most **30 seconds** (refused when saved,
`VIDEO_LIMITS.maxMs`; the plans BuPulse builds never pass it), at most **4 a day** (Kigali day, `VideoDayUsage`), and
the plans with video allow 4 × 30 = **120 a month**.

| Plan | Video | Videos a month | A day | Voiceover characters |
| --- | --- | --- | --- | --- |
| Rwanda Business, East Africa / Global Pro | yes | 120 | 4 | 72,000 (600 a video) |
| Free trial (whatever plan was chosen) | yes | 1 (one sample video) | 1 | 600 |
| Starter, Standard | no: "Add video to your plan" | 0 | 0 | 0 |

Both are **plan settings** (Admin → Plans: "Videos a month", "Videos per day"; `limits.videos`, `limits.videosPerDay`,
4 when missing; Jarvis `update_plan_limits`). `lib/plans.ts` (`VIDEO_PLAN_VIDEOS`, `VIDEOS_PER_DAY`, `TRIAL_VIDEOS`,
`VIDEO_MAX_SECONDS`) holds the same for the code's fallback plans.

**Counting** (`finalizeVideo`): a video uses one of the month (`consumeUsage(…, "videos", 1)`) and one of the day
(`consumeDailyVideo`, an atomic conditional increment) only once the file is saved and checked, so a failed or refused
render uses nothing (when today's cap is hit after the month's count, the month's is given back). Making an existing
video again (captions, photos, music, voice, "Make it again") replaces it and uses none; a video whose file the 30-day
clean-up removed counts again. `prepareVideoUpload` refuses before anything is rendered: "4 videos today, the most a
day: more tomorrow. 40 of 120 this month." or "Your plan's 120 videos for this month are used up (120 of 120)."
"Create today's content" and the packs plan at most the videos left now (the lower of this month's and today's,
`videosLeftNow`); Autopilot within the month's. Usage shows "N / 120" and "N of 4 today · up to 30 s each".

**Migration** `20261018120000_videos_per_month`: `UsageRecord.videoSeconds` is renamed `videos` and each started 30 s
becomes one video; plan limits `videoSeconds` become `videos` (> 30 s: 120 and `videosPerDay` 4; the trial's 30 s: 1)
and voiceover characters 600 a video on plans with voice; stored offers are renamed too; `VideoDayUsage` is created
(RLS on, no grants).

Video is in the add-on catalog and the offer builder like every built feature; Rwanda's price is 10,000 RWF a month
(owner decision; row `addon_rw_video`, editable in Add-on prices). Added on top of a plan without video, an offer's
custom plan gets 120 videos a month.

## Storage clean-up

- **30 days after posting:** `/api/cron/media-cleanup` (daily 03:19 UTC: `MEDIA_CLEANUP_CRON` in `worker.ts`,
  `wrangler.jsonc`, `netlify/functions/cron-media-cleanup.mts`, Admin cron list) deletes a video file once every post
  that used it went out and the last one was published 30 or more days ago (`lib/visuals/cleanup.ts`). Posts and the
  `ContentVisual` stay; the visual's items are emptied, `bytes` set to 0 (it stops counting toward the quotas) and
  `error` says "Video removed after 30 days". Videos no post used yet are kept. The video panel says: "Published videos
  are removed from BuPulse 30 days after posting; they stay on your social accounts."
- **Abandoned uploads:** the same cron lets expired reservations go (deleting their file unless it became the
  video) and deletes files in `<userId>/videos/` that no visual or waiting post refers to once they are an hour old.
- **With their owner:** deleting a product or campaign (`releaseSubjectVideos`), pruning content versions, "New picture"
  and Remove delete the video files too. A post still waiting to go out keeps its video: the visual is moved to that
  post's group, and the 30-day clean-up takes it later.

## Tests

`tests/visuals/script.test.ts`: script rules, the script writer's prompt, "Make a video" without a script (written,
charged, saved), with the owner's script (no AI, no credit), the plan blocker and the refund. `tests/visuals/`: direction (validation, fallbacks, carousel decision, sources, chips), video plan and timeline maths,
post mapping, service (art director fallbacks, AI photo paths with no credits or errors, render steps, video upload
checks and finalize, attaching to Autopilot posts), integration (feature gating, prompt fencing, quota with videos,
Autopilot group visuals), the browser renderer (light, mocked canvas). Also `tests/publishing/service.test.ts` (posts
from content) and `tests/social-meta-providers.test.ts` (Reels, Facebook video).
