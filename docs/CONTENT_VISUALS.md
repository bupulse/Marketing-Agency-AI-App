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
   result is a `ContentVisual` row with status `pending`.
4. **Drawing** (`renderImageStep`): the content screen calls `renderVisual` until the visual is `ready`; each call
   draws slides for at most 30 s (Netlify stops a function at 60 s). A slide is drawn with the existing designs engine
   (`createTemplateDesign`, `Design` rows, `designs` bucket). An AI slide first pays for the photo with
   `createAiDesign` (1 image credit, `consumeUsage`, `withLedger` feature `image`, refund on failure); the photo is kept
   as a design and the template draws over it, so re-styling never pays twice. When the credit, the allowance or the AI
   fails, the slide uses the album photo or a text design and says why. A text design that cannot be drawn either marks
   the visual `failed` with a message; the content itself is never affected.

AI photos are offered to the art director only when `aiPhotosAvailable`: the `aiPhotos` feature, an image credit left
this month, and the company AI allowance not reached.

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
  moves alternate; colours from the brand (`buildTheme`), style from the pack. Made with the text when the plan has
  video (`videoAvailable`: the `video` feature and more than 0 video seconds a month) and there is a script.
- **Render in the browser** (`components/visuals/video-renderer.ts`): 1080x1920 at 30 fps on a canvas, captions
  burned in, MP4 through WebCodecs H.264 and `mp4-muxer` (MIT, about 14 KB gzipped, loaded only when a video is made;
  the library is superseded by Mediabunny but stable), else a real-time WebM through MediaRecorder, else a clear
  message and the picture is used. Re-encoded once at 55% bitrate if over 8 MB. Optional music only from a file the
  owner picks (decoded and encoded to AAC in the browser, never stored, no bundled music); skipped with a note when the
  browser cannot encode it. Timeline maths is pure and tested (`lib/visuals/timeline.ts`).
- **Upload** (`use-video-render.ts`): `startVideoUpload` checks the plan feature, MP4 or WebM, at most 8 MB and 30 s,
  the video seconds left, the company's media quota and the platform guard, then gives a signed upload URL for
  `<userId>/videos/<visualId>-<n>.mp4` in the `media` bucket. `finishVideoUpload` reads the object's size and first
  bytes (`ftyp` or EBML), counts the seconds (`consumeUsage(userId, "videoSeconds", seconds)`), replaces the old file
  and, for Autopilot, puts the video on the group's posts. A rejected file is deleted.
- **When it renders**: on the content page as soon as the video is pending (progress bar). On Autopilot cards the badge
  says "Video ready to render"; it renders when the owner opens the card's "Make the video" panel, one card at a time.
- Without video in the plan the screen shows the picture with "Add video to your plan" (`/dashboard/upgrade?feature=video`).

Videos count toward the company's media quota (500 items, 2 GB: `mediaUsage` adds `ContentVisual` video bytes) and the
platform guard (`platformBytes`, `MEDIA_PLATFORM_MAX_BYTES`, 900 MB default). The media bucket now accepts
`video/mp4` and `video/webm` (still 10 MB per file).

## What the owner can change

On the content card (Studio) and the Autopilot card ("Picture and video"):

| Action | What happens | Cost |
| --- | --- | --- |
| Approve as it is | nothing to do; Schedule takes the visual | none |
| Swap photo | album or gallery photo for the slide (JPG/PNG), redrawn | free |
| Style / Template | every slide redrawn in the new pack or template; AI photos are reused | free |
| Edit text | headline, subline, chip per slide, redrawn | free |
| New picture | fresh art direction, the old slides go (unless a post uses them) | art director call; AI photo uses a credit |
| Remove | slide designs and video file go unless a post uses them; AI photos stay in Designs | none |
| Edit captions / Make it again / Add your music | new video plan or same plan, rendered again | video seconds again |

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
widens the media bucket's types and gives the Pro plan row the `video` key (Pro has the video seconds).

## Features and plans

`video` is a built feature ("Videos", metric `videoSeconds`). Owner decision (12 October 2026):

| Plan | Video | Video seconds a month |
| --- | --- | --- |
| Rwanda Business, East Africa / Global Pro | yes | 240 (8 videos of up to 30 s) |
| Free trial (whatever plan was chosen) | yes | 30 (one sample video) |
| Starter, Standard | no: "Add video to your plan" | 0 |

The migration sets this on the `PlanDefinition` rows (features and limits are per plan key; regions only price them);
`lib/plans.ts` (`VIDEO_PLAN_SECONDS`, `TRIAL_VIDEO_SECONDS`) holds the same for the code's fallback plans. Video is in
the add-on catalog and the offer builder like every built feature; Rwanda has a placeholder price (10,000 RWF, row
`addon_rw_video`) for the admin to set. Added on top of a plan without video, an offer's custom plan gets 240 video
seconds. `voice` stays coming soon.

## Storage clean-up

- **30 days after posting:** `/api/cron/media-cleanup` (daily 03:19 UTC: `MEDIA_CLEANUP_CRON` in `worker.ts`,
  `wrangler.jsonc`, `netlify/functions/cron-media-cleanup.mts`, Admin cron list) deletes a video file once every post
  that used it went out and the last one was published 30 or more days ago (`lib/visuals/cleanup.ts`). Posts and the
  `ContentVisual` stay; the visual's items are emptied, `bytes` set to 0 (it stops counting toward the quotas) and
  `error` says "Video removed after 30 days". Videos no post used yet are kept. The video panel says: "Published videos
  are removed from BuPulse 30 days after posting; they stay on your social accounts."
- **With their owner:** deleting a product or campaign (`releaseSubjectVideos`), pruning content versions, "New picture"
  and Remove delete the video files too. A post still waiting to go out keeps its video: the visual is moved to that
  post's group, and the 30-day clean-up takes it later.

## Tests

`tests/visuals/`: direction (validation, fallbacks, carousel decision, sources, chips), video plan and timeline maths,
post mapping, service (art director fallbacks, AI photo paths with no credits or errors, render steps, video upload
checks and finalize, attaching to Autopilot posts), integration (feature gating, prompt fencing, quota with videos,
Autopilot group visuals), the browser renderer (light, mocked canvas). Also `tests/publishing/service.test.ts` (posts
from content) and `tests/social-meta-providers.test.ts` (Reels, Facebook video).
