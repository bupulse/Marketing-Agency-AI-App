# Viral recipes

Owner decision (19 October 2026): every Video Studio video, the client's and Autopilot's, is designed from the
techniques of real viral videos, not from one of the 42 fixed templates. Each video gets its own **recipe**: an
original mix of 3 to 5 viral videos from the viral library (`docs/research/viral/`). The opening comes from one video,
the beats from another, and the price placement, camera, loop and caption from others. Templates stay one link away:
"Use a template instead" on the Create page.

## How it works

1. **The index.** `lib/video-engine/brain/viral-ingest.ts` reads the library (`docs/research/viral/<platform>.jsonl`,
   about 100 videos per platform) and writes `lib/video-engine/brain/data/viral.json`, one compact entry per video. It
   keeps:
   - id, platform, country and city, region (East Africa or global), sector, kind, format, hook type, length;
   - viral strength (0 to 1) and the proof in words ("1.2M views, 232x the account's followers", "an ad running 614
     days");
   - the first 3 seconds, the beats (from, to, role, what), cuts per 10 s, camera, look, text style;
   - the on-screen lines with the facts replaced (`{price}`, `{phone}`, `{business}`);
   - whether price, phone and place were shown, the call to action, whether it loops, voice and music;
   - why it went viral and the lesson for the engine;
   - the caption's **shape** only (lines, hashtags, whether it had the price, the place, a question);
   - what remaking it needs: `photos`, `filmed`, `person` (someone on camera), and `ai-ok` (an AI clip may stand in).

   It never keeps captions, comments, frames or account names. These are other people's videos and the index ships in
   the repo, so handles, account names (also without their place, "Derma Skin Clinic"), phone numbers, web addresses,
   @mentions and named people ("DR. BOSCO" becomes "the doctor") are taken out of every text. Product brands that other
   accounts mention too (Tecno, Samsung, Olay) stay: they name what was sold, not who sold it. Scam rows are left out.
2. **The match.** `lib/video-engine/brain/viral.ts`, `viralRecipe(input)`, scores every video for the brief:

   | What | Points |
   | --- | --- |
   | Same sector | 40 |
   | Neighbouring sector (`NEIGHBOURS`, e.g. agriculture borrows from shops and food) | 22 |
   | Same platform | 15 |
   | Rwanda | 18 |
   | East Africa | 10 |
   | Viral strength | up to 25 |
   | Opening built on a fact the brief lacks (a price, a place, a real offer) | -15 |
   | Used in one of the business's last 5 recipes | -25 |
   | Seeded chance (one seed per job) | up to 28 |

   It then takes 3 to 5 videos from different accounts, with at least two whose look the footage can remake.
3. **The mix.** Each technique comes from a pick that fits it, and unused picks come first, so every pick lends
   something:
   - **Opening:** a video the footage can remake, with an opening type the recent recipes did not use.
   - **Beats:** another video, scaled to the length (the hook up to 3 s, how to order at the end), with a beat order the
     recent recipes did not use.
   - **Pace:** the median cut rate of the picks.
   - **Text:** a style and band (top, middle, bottom) inside the platform's safe area.
   - **Price and phone:** where they go (from 0 s, every scene, the end card).
   - **The rest:** the camera feel and moves, the loop (never on Facebook), the caption pattern, the music mood and
     voice.
   - **Footage per beat:** a photo, the client's phone clip, or an AI clip (Veo), with a one-line shot description
     (`clipNeeds`).

   The recipe records which technique came from which viral id (`sources`). The opening and the beats never come from
   the same video when there is a choice. The same seed always gives the same recipe.
4. **The design.** `designer.ts`:
   - Takes `styleId: "viral"` (`VIRAL_STYLE_ID` in `templates.ts`, the default everywhere: the studio's owner and client
     paths, `lib/video-studio/jobs.ts`, `app/api/video/design`, and Autopilot's week plan `planSeries`, whose
     `styleId` is always "viral").
   - Sends `recipeText(recipe)` in place of the `Template "…":` line.
   - Makes the research block (`brainContext(..., { viral: true })`) give hook wording and rules only, with no timeline,
     because the recipe sets the order.
   - The owner's own opening line, and the don'ts, still win over the recipe.
   - Facts still come only from the brief (the fact check and the Place rule are unchanged). The viral videos' words,
     products and prices are examples of where things go, never content: prices in the examples are shown as `[price]`.
   - Template videos are sent exactly as before.
5. **Storing and avoiding.** The recipe is stored in `VideoJob.brief.recipe` (the owner's test jobs keep `recipe` on
   the job). A new design reads the business's last 5 recipes (`recentRecipes`, before any credit is charged) and
   avoids their openings, layouts (text band and price placement) and beat orders. Several versions in one request
   avoid each other too. An edit or extend keeps its parent's recipe.
6. **The score.** `brain/score.ts` adds five checks when a design has a recipe:
   - `recipe-opening`: the opening idea in the first 3 s (the price, a question, a number, the product big in the
     frame, or the opening line);
   - `recipe-pace`: changes per 10 s within the recipe's range;
   - `recipe-price`: the price when and where the recipe puts it;
   - `recipe-phone`: the number in every scene, or on the end card;
   - `recipe-length`: the length the recipe was made for.

   Template videos have no recipe, so their scores do not change.
7. **"Why this video".** `recipeWhy(recipe)` explains the mix in plain English for the client. Example: "Opens like a
   Kigali shop reel with 725K views, 117x the account's followers: a finished poster frame…". It is shown in the video's
   drawer on the Create page and given as `viral.why` on the app's job view. It never names an account and never shows
   other people's frames.

## Phone clips

The Create page invites the client to add 2 to 4 phone clips of 5 to 10 s each: the shop, hands holding the product,
the owner talking. Clips are free.

- **Without clips:** the recipe only opens and builds from videos that photos can remake.
- **With clips:** it may use techniques that need filmed footage or a person on camera, and gives the clips to the
  beats that want them.
- **Upload:** `POST /api/clip` (`video-lab/client-clips.ts`). MP4 or MOV, 5 to 10 s (half a second of slack), at most
  30 MB. Codecs the browser renderer plays: H.264, HEVC, VP9, AV1.
- **Where clips are kept:** a client's clip becomes a Gallery video in the folder "Studio clips", with the Gallery's own
  checks and video quota. It is served back only to its business at `GET /api/clip/<assetId>`. The owner's test clips
  stay in `video-lab/data/media` and are served at `/api/media/<id>`.
- **In the design:** the request sends `clipIds`, which become `BriefClip`s (`designer.ts`). Claude sees "Clip 1 is a
  7 s phone clip…" and places one with `{ kind: "video", clip: 1, … }`. `placeClips` turns the number into the clip's
  path, mutes the clip's own sound, and drops any video layer that names no clip of the brief. The renderer draws it
  like a Seedance clip (`video-frames.ts`, `video-source.ts`).
- **AI clips** (Veo, `docs/guide/features/21-ai-clips.md`) arrive the same way as `aiClipIds`. Their number tells the
  recipe how many beats take an AI clip.

## Prices

A price field may hold a paragraph ("From 250,000 RWF · Final pricing depends on…"). `lib/video-engine/price.ts`
`splitPrice` turns it into:

- `price`: the amount with its condition ("From 250,000 RWF", "50,000 RWF per day"), which is what the video and the
  caption's first line show;
- `priceNotes`: the rest, true facts for the caption's later lines or the voice, never on screen.

The designer, the Brain's opening lines (`suggest.ts` `priceLabel`), the fact check, the score, the studio's product
list (`video-lab/data-source.ts`) and the app's brief (`lib/video-studio/brief.ts`) all use the split.

## Refreshing the index

When new rows land (TikTok is still being collected):

```
node lib/video-engine/brain/viral-ingest.ts
npx vitest run tests/video-engine/viral.test.ts
```

The script only reads the rows. A line that is not one JSON object (a collector mid-write) is skipped with a warning,
and the file is replaced in one step. The test checks that every indexed id is a library row, and that no account
name, comment or caption made it into the index. Commit `viral.json` with the rows.

## Cost

There is no extra AI call. The recipe block adds about 1,000 input tokens to the one Claude design (about $0.003 on
Sonnet 5.5), so a Motion video stays at its measured cost (docs/AI_COSTS.md). Phone clips are free; AI clips are priced
in docs/AI_COSTS.md.

## Where the code lives

| What | File |
| --- | --- |
| Index builder | `lib/video-engine/brain/viral-ingest.ts` → `lib/video-engine/brain/data/viral.json` |
| Matcher, recipe, text for Claude, "Why this video" | `lib/video-engine/brain/viral.ts` (`viralRecipe`, `pickViral`, `recipeText`, `recipeWhy`, `ClipNeed`) |
| Designer (recipe block, clips, `recipeForBrief`, `BriefClip`, `placeClips`) | `lib/video-engine/designer.ts` |
| Recipe checks | `lib/video-engine/brain/score.ts` (`recipeChecks`) |
| Short price | `lib/video-engine/price.ts` |
| App jobs (recipe per version, recent recipes, `viral` on the view) | `lib/video-studio/jobs.ts` |
| Studio (owner door, clip routes) | `video-lab/server.ts`, `video-lab/client-clips.ts`, `video-lab/clip-rules.ts`, `video-lab/client-jobs.ts` |
| Create page | `video-lab/site/client/create.ts` (`renderViral`, `clipZone`, "Why this video" in `showFacts`), `video-lab/site/pages/create.html` |
| Tests | `tests/video-engine/viral.test.ts`, `tests/video-engine/price.test.ts`, `tests/video-lab/client-clips.test.ts`, `tests/video-studio/design-route.test.ts` |
