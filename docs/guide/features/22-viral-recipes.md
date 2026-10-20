# Viral recipes (videos made from viral videos)

Every Motion video in the Video Studio is now designed from the techniques of **real viral videos** instead of a
fixed template. BuPulse studied 300 viral business videos on TikTok, Instagram, Facebook and YouTube Shorts, most of
them from Rwanda and East Africa. For each new video it picks 3 to 5 that suit your business and mixes them into a new
plan for your product:

- how the first 3 seconds open;
- the order of the scenes and how fast they change;
- where the text, the price and your number go;
- how the camera moves;
- whether the end flows back into the start;
- how the post text is written.

Two videos of the same product come out different, and BuPulse avoids repeating your last five videos. All the facts
(the price, your number, your place) still come only from your product and business details.

**Page:** the Video Studio, **Create** (`/create`), Motion engine.  **Price:** no extra cost: a Motion video is still
35 credits. Phone clips are free.

## What you see

- Under the prompt bar: **✦ Made from viral videos**, with a small **Use a template instead** link. The template
  picker below the page stays hidden until you press it. Once you pick a template, the line says **Template: …** with
  **Back to viral techniques**.
- A drop zone: **Add 2 to 4 phone clips (5 to 10 s each)**. Each clip you add shows as a small tile with its length.
- In a finished video's drawer: **Why this video**, a few plain lines such as "Opens like a Kigali shop reel with 725K
  views, 117x the account's followers: a finished poster frame: the product, its name and the key fact all on screen
  at 0 s." It never shows other people's videos, pictures or account names.
- **Plan a week** (the opening-line chips): every day's video is made from viral techniques too; the table's **Made
  from** column says "Viral techniques".

## How to use it

1. Open **Create**, choose **Motion** and pick your product.
2. Optional: film 2 to 4 short clips on your phone (5 to 10 seconds each): your shop, hands holding the product, you
   talking about it. Drop them on the clip zone (or click it). With clips, BuPulse can use the viral techniques that
   need real footage; without them it uses the ones that work from photos (or from AI clips, if you chose them under
   Options).
3. Press **Generate**. When the design is ready, open it to see **Why this video**, then make the MP4 as usual.
4. Want a fixed look instead? Press **Use a template instead** and pick one.

## Limits

- Clips: MP4 or MOV, 5 to 10 seconds, at most 30 MB, at most 4 per video. On iPhone, set Camera, Formats, **Most
  Compatible** if a clip is refused for its format.
- A client's clips are saved in their BuPulse **Photos**, folder **Studio clips**, and count toward the Photos video
  space.
- The viral library holds TikTok rows as they are collected; until then most techniques come from Instagram, Facebook
  and YouTube.

## For developers

- How it works, the scoring and how to refresh the index: [docs/VIRAL_RECIPES.md](../../VIRAL_RECIPES.md).
- The index: `node lib/video-engine/brain/viral-ingest.ts` writes `lib/video-engine/brain/data/viral.json` from
  `docs/research/viral/*.jsonl`. It keeps no captions, comments, frames or account names.
- The recipe: `lib/video-engine/brain/viral.ts` (`viralRecipe`, `recipeText`, `recipeWhy`, `ClipNeed`). The designer:
  `lib/video-engine/designer.ts` (`recipeForBrief`, `BriefClip`, `placeClips`, `clipsText`). Style id `"viral"`
  (`VIRAL_STYLE_ID`, `lib/video-engine/templates.ts`) is the default in the studio, `lib/video-studio/jobs.ts`,
  `app/api/video/design` and `planSeries`.
- Stored: `VideoJob.brief.recipe` (with its `sources`, the viral ids). The job view has `viral: { why, sources }`. No
  migration.
- Score: `lib/video-engine/brain/score.ts` adds `recipe-opening`, `recipe-pace`, `recipe-price`, `recipe-phone` and
  `recipe-length` for viral designs only.
- Clips: `POST /api/clip`, `GET /api/clip/<assetId>` (`video-lab/client-clips.ts`, `video-lab/clip-rules.ts`); the
  design request carries `clipIds` (and `aiClipIds` for Veo).
- Prices: `lib/video-engine/price.ts` splits a long price field into the short price and its notes.
- Tests: `tests/video-engine/viral.test.ts`, `tests/video-engine/price.test.ts`, `tests/video-lab/client-clips.test.ts`,
  `tests/video-studio/design-route.test.ts`.

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| "That clip is 12 seconds" | the clip's length | Trim it to 5 to 10 seconds on the phone and add it again. |
| "Your phone saved this clip in a format the studio cannot play" | the codec (`checkClip`) | iPhone: Camera, Formats, Most Compatible; film again. |
| A clip shows black in the video | the browser cannot decode it (`video-source.ts`) | Use Chrome or Edge; add the clip again as an H.264 MP4. |
| New TikTok rows are not used | `viral.json` is older than the rows | Run `node lib/video-engine/brain/viral-ingest.ts` and the viral test, then commit. |
| Two videos look alike | `VideoJob.brief.recipe` of both | Check their `sources` and `opening.hookType`: the recent-recipe query reads the business's last 5 viral jobs. |
