# Designs

Unique AI adverts for the business, made from its products, photos, logo and colours, plus every picture BuPulse made
for it. Templates are no more (owner decision, 23 October 2026): every picture comes from the image engine, a team of
AI agents that plans a different idea for each picture, paints the finished advert with the words on it, checks the
spelling and the details, and fixes one mistake by itself. A design can also be opened in Canva, edited there and
brought back as a new design. Most of the time owners do not visit this page: "Create today's content", Daily posts
and Autopilot make their pictures on their own (see [Projects and content](04-projects-and-content.md)).

**Page:** `/dashboard/designs`  **Plans:** the page (feature key `designs`) on Starter and Business; AI adverts
(feature key `aiPhotos`) on Starter (30 image credits a month) and Business (100); Canva editing (feature key `canva`)
is in neither plan today: it can be added (Billing → Add features, when priced) or put in a custom plan, and only shows
once BuPulse's Canva app keys are set. Without AI pictures (or when the credits run out), posts use the owner's own
photos as they are.

## What you see

![Designs page](../images/client/designs.jpg)

_(The screenshot still shows the old template studio; to be retaken.)_

- **Make ads for.** Pick a product or campaign (or "Nothing in particular"). The ads then use its name, price, selling
  points and album photos, and are saved with it.
- **Unique AI ads.** "Your idea" (optional, in your own words), **How many** (4, 10 or 20), **Shape** (Feed 4:5,
  Square, Story 9:16) and **Quality**: Smart mix (the best ideas on Pro, the rest on Lite), Best (Pro, 4 credits a
  picture) or Saver (Lite, 2 credits). The line under it says how many pictures and credits that is, and how many
  credits are left. **Make my ads** starts them.
- **While they are made.** Each picture shows its step: "Painting…", "Checking the words and details…", "Fixing a
  small mistake…", "Checking the fix…". Two are made at a time.
- **Each finished picture.** Its idea (for example "At scale"), Pro or Lite and its credits, its caption, 👍 / 👎 (the
  engine learns from them) and **Change this**: say what to change ("make the headline bigger") and a changed copy is
  made for the picture's credits.
- **Your designs.** Every picture made, newest first, grouped by day, 30 a page, with a date filter. Each one can be
  downloaded, deleted or (with Canva) opened with **Edit in Canva**.

## How to use it

1. Open **Designs** in the menu.
2. Under **Make ads for**, choose the product or campaign the pictures are about.
3. Write your idea if you have one, pick how many, the shape and the quality.
4. Press **Make my ads** and keep the page open while they are painted (about a minute each).
5. Like the ones you like, dislike the others, or press **Change this** to fix one.
6. To use a picture, download it, or attach it to a post in the composer (see
   [Calendar and publishing](07-calendar-and-publishing.md)).
7. With Canva connected (Settings → Canva), click **Edit in Canva** on a design, edit it, then press **Return to
   BuPulse** in Canva. The edited picture is saved as a new design next to the original.

## Limits and settings

- **AI image credits:** Starter 30 a month, Business 100. A Lite picture uses 2, a Pro picture 4; "Change this" uses
  the picture's own credits. A picture that cannot be made gives its credits back. Batches are limited per hour
  against abuse.
- **On bupulse.com (Netlify)** each picture is made in short steps (one AI call each), so no request runs past 60 s;
  Autopilot makes 1 AI picture a week there by default and swaps it in later (see
  [docs/CONTENT_VISUALS.md](../../CONTENT_VISUALS.md) "Autopilot on Netlify").
- Product photos must be JPG, PNG or WebP, at most 12 MB.
- Canva needs the Canva app keys (`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`) and each client connects their own Canva
  account. Until Canva approves BuPulse's app, only the app owner's Canva team can connect (see
  [docs/CANVA.md](../../CANVA.md)).

## For developers

### Where it lives

| Part | Where |
|---|---|
| Page | `app/dashboard/designs/page.tsx` (`DesignsPage`) |
| Server actions | `app/dashboard/designs/engine-actions.ts` (`startImageBatch`, `paintImageStep`, `ratePictureAction`, `editPictureAction`), `app/dashboard/designs/actions.ts` (`deleteDesign`, `getDesignDownloadUrl`), `app/dashboard/settings/canva-actions.ts` (`disconnectCanvaAction`) |
| Components | `components/designs/unique-ads.tsx` (`UniqueAds`), `components/designs/design-studio.tsx` (`DesignStudio`: the gallery), `components/designs/designs-paging.tsx`, `components/designs/edit-in-canva.tsx`, `components/designs/canva-return-toast.tsx`, `components/knowledge/subject-picker.tsx`, `components/settings/canva-card.tsx` |
| Logic | `lib/image-engine/` (`engine.ts` `planBatch`, `paintNext`, `startPicture`, `stepPicture`, `paintOne`; `director.ts`, `planner.ts`, `prompter.ts`, `captioner.ts`, `painter-prompt.ts`, `check.ts`, `checker.ts`, `realism.ts`), `lib/designs/service.ts` (`createEngineDesign`, `createPhotoDesign`, `listDesignsPage`, `deleteDesign`), `lib/designs/list.ts`, `lib/designs/layout.ts`, `lib/ai/gemini-image.ts`, `lib/canva/` (`service.ts`, `client.ts`, `config.ts` `isCanvaEnabled`, `tokens.ts`, `pkce.ts`, `return-jwt.ts`) |
| Database | `ImageConcept` (one planned picture: idea, words, tier, credits, step, check), `Design` (the stored picture), `ContentVisual`, `CanvaConnection`, `CanvaEdit`, `UsageRecord`, `AiCall`; Storage bucket `designs` |
| API routes | `app/api/canva/connect/route.ts`, `app/api/canva/callback/route.ts`, `app/api/canva/open/route.ts`, `app/api/canva/return/route.ts` |
| Cron jobs | `/api/cron/autopilot-visuals` (Autopilot's pictures made later on Netlify) |
| Tests | `tests/image-engine/*.test.ts` (`engine.test.ts`, `status-migration.test.ts`, `director.test.ts`, `checker.test.ts`), `tests/designs-service.test.ts`, `tests/designs-list.test.ts`, `tests/canva.test.ts`, `tests/canva-routes.test.ts` |
| Docs | [docs/IMAGE_ENGINE.md](../../IMAGE_ENGINE.md), [docs/IMAGE_ANTI_SLOP.md](../../IMAGE_ANTI_SLOP.md), [docs/DESIGNS.md](../../DESIGNS.md), [docs/CANVA.md](../../CANVA.md), [docs/CONTENT_VISUALS.md](../../CONTENT_VISUALS.md) |

### Key functions

- `planBatch` (lib/image-engine/engine.ts) — the Director picks a pattern, shot, light, layout and camera for each
  picture the company has not had lately, the Prompter writes the idea and words, the Captioner the captions; the
  credits are reserved and one `ImageConcept` is saved per picture.
- `paintNext` (lib/image-engine/engine.ts) — one step of one picture per call: paint, check, fix once, check the fix
  (statuses planned → painting → painted → fixing → edited → done or failed); a failed picture gives its credits back.
- `startPicture` / `stepPicture` / `paintOne` — a post's picture (Create post, Daily posts, Autopilot): planned and paid
  first, then the same steps (one per call on the content screen, all at once for Autopilot on the Mac and Cloudflare).
- `checkPicture` (lib/image-engine/check.ts) — copies the words in the picture letter by letter and looks for AI slop.
- `createEngineDesign` (lib/designs/service.ts) — paints with Gemini (Nano Banana Pro or 2), with the product photo and
  logo, and stores the picture as a `Design`.
- `listDesignsPage` (lib/designs/service.ts) — the "Your designs" list, 30 a page.
- `openDesignInCanva` / `finishCanvaReturn` (lib/canva/service.ts) — upload to Canva, and save the edited PNG back as
  a new `Design`.
- `assertFeature` (lib/entitlements.ts) — the actions check `designs`, and `aiPhotos` for the AI adverts.

### How it works

1. The page loads designs (`listDesignsPage`), the chosen product or campaign (`resolveSubject`, `writingSubject`) and
   the credits left.
2. **Make my ads** → `startImageBatch` → `assertFeature(aiPhotos)` → `planBatch` (credits reserved with
   `consumeUsage(image)`).
3. The screen calls `paintImageStep` with two painters at a time until every picture is done or failed; each call is
   one AI step (`paintNext`), saved on the picture's row, so a lost connection carries on.
4. Ratings go to `ratePictureAction`; **Change this** to `editPictureAction` (a changed copy, for the picture's credits).
5. Canva: `/api/canva/open` uploads the PNG and returns Canva's edit link; Canva sends the user back to
   `/api/canva/return`, which exports the PNG and saves a new `Design`.

## If something goes wrong

| Symptom | First place to look | Usual fix |
|---|---|---|
| "Unique AI ads" missing | Admin → Plans (feature `aiPhotos`); Admin → Services (Gemini) | Add AI pictures to the plan, or switch Gemini back on. |
| "You have no AI image credits left this month" | Usage page; `consumeUsage` in `lib/usage.ts` | Wait for the monthly refill or add more images. |
| A picture failed ("Its credits were given back") | Admin → Errors (`image-engine.paint`); the `ImageConcept` row's `error` | Make it again; check Gemini in Admin → Services. |
| A picture stays on one step | the `ImageConcept` row's `status` and `paintingUntil` | Another call holds it; after 6 minutes the next call takes it over. Keep the page open. |
| A typo in a picture's words | the row's `check` (what the Checker read) | Press **Change this** with the right spelling. |
| No "Edit in Canva" button | `isCanvaEnabled` in `lib/canva/config.ts`; Admin → Services (Canva); plan feature `canva` | Set the Canva keys, add the feature, connect Canva in Settings. |
| Canva return says "processing" | `finishCanvaReturn` in `lib/canva/service.ts`; Admin → Errors | The save finishes in the background; refresh Designs after a minute. |
| Canva asks to reconnect | `CanvaConnection` (refresh failed with `invalid_grant`) | Connect Canva again in Settings. |
