# Image engine: unique finished ads by a team of agents

Owner request (23 October 2026): every AI picture unique, never out of ideas, each picture with its own prompt, from
the product photos when there are some and from Business info when there are none; a team of agents (one plans, one
writes prompts, one paints, one checks, one edits, one writes captions). Why the old pictures repeated, and what
Creatify does: docs/IMAGE_ENGINE_TEARDOWN.md.

## Owner decisions (23 October 2026)

- **New products may be invented** ("New in the range", like Creatify's Grow Walls): always allowed.
- **Words are drawn by the AI** into the picture, in a layout that changes every time: no templates on AI pictures.
  The free templates stay for plans without AI pictures (Starter) and when credits run out.
- **Image credits, not images**: Lite is **Nano Banana 2** (`gemini-3.1-flash-image`, about $0.067) at **2 credits**,
  Pro is Nano Banana Pro (`gemini-3-pro-image`, about $0.134) at **4 credits**, so a credit is about $0.034. The plans'
  "AI images" limits are now credits (Business 100 = 25 Pro, or 50 Lite, or a mix). First test (23 October): Lite on
  Nano Banana (2.5 Flash Image) misspelt small words ("hesh", "hydorponics") while Pro was perfect, so the owner chose
  Nano Banana 2 for Lite. `GEMINI_IMAGE_PRO_MODEL` / `GEMINI_IMAGE_LITE_MODEL` change them.
- **Smart mix** by default: the first picture of a batch on Pro, then one in four, while the credits allow.
- **Claude and Gemini both write** the concepts. Claude uses ANTHROPIC_API_KEY when set; until then the owner's Claude
  subscription, **on the test site only** (`IMAGE_ENGINE_CLAUDE_SUBSCRIPTION=1` on the Mac that serves
  test.bupulse.com; never on Netlify or Cloudflare).

## The agents

| Agent | File | Model | Job |
| --- | --- | --- | --- |
| Director | lib/image-engine/director.ts, patterns.ts | rules (free) | For each picture: ad pattern (18: the result, in use, at scale, new in the range, hero, before/after, old vs new, customer words, feature callouts, problem solved, behind the scenes, flat lay, local moment, popular, the offer, how it works, arrives, detail), shot, light, layout of the words, product photo, Pro or Lite. Least used first, from the company's memory; the brief's words pick patterns first ("large scale" → at scale). Patterns that need real reviews or a price are left out without them. |
| Prompter | prompter.ts (pure), planner.ts | Claude Sonnet + Gemini Flash, in parallel | Each picture's idea, headline (≤7 words), small line, button and its own 80–170 word image prompt, all different from each other and from the recent pictures. Never an invented number, %, promise or review (checked in code). A gap is retried by the other writer, then written by the rules. |
| Captioner | captions.ts (pure), captioner.ts | Gemini | The post caption and hashtags for each picture, in the business's language; sentences with invented numbers dropped. |
| Painter | painter-prompt.ts, `createEngineDesign` (lib/designs/service.ts) | Nano Banana Pro or Lite | The finished advert from the concept's prompt, the product photo (exact, at scale, or a new item of the line), the logo and the exact words. |
| Checker | checker.ts (pure), check.ts | Gemini Flash vision | Reads the words in the picture and, for each line we asked for, copies what is drawn letter by letter and says whether it is the same (a reading model silently corrects typos: in the first test it read "hydorponics" as right). A line passes only when its copy matches exactly. Also numbers nobody gave, product not visible. |
| Editor | `createEngineDesign({ editOf })` | the picture's tier | One automatic fix after a failed check (the better picture is kept), and the owner's "Change this" (the tier's credits). |

`engine.ts` runs them: `planBatch` (Director, Prompter, Captioner; credits reserved; `ImageConcept` rows "planned"),
`paintNext` (one step of one picture per call, so no call runs long on Netlify's 60 s: the Painter ("painting" to
"painted"), the Checker ("painted", then done or "fixing"), the Editor's one fix ("fixing" to "edited") and the
Checker on the fix ("edited" to done, the better picture kept); each step saves the row, so any later call carries on;
a failed picture's credits are given back), `paintOne` (a post's picture: the same steps one after another, because
its callers wait for the picture), `batchPictures`,
`ratePicture`, `editPicture`. Memory: the `ImageConcept` table (migration `20261030230000_image_concepts`).

## The whole flow (owner's design, 23 October 2026)

Create post (the post side) sends a request to the engine; the engine's agents make the pictures; the post side's Social
agent turns them into posts:

1. **Brain**: gathers everything about the business and the product (Business info, product, price, selling points,
   photos, real reviews, campaigns, the memory of past pictures, and what performed well). Today: `loadFacts` in
   engine.ts; to become its own agent.
2. **Director + Prompter** (the prompt generator): a different idea and its own prompt per picture.
3. **Painter** (the image generator), then the **Checker**, the **Editor** for one fix, and the Checker again.
4. Back to the post side, the **Social agent**: for each picture or video, a different caption and hashtags for every
   network (Instagram, Facebook, TikTok…), the music, and the schedule.
   - **Music** (owner decision): Instagram and Facebook do not let apps add music to a still image, so an image post
     there becomes a short Reel (6 to 10 s, slow zoom, a track from BuPulse's licensed music library); TikTok gets the
     photo post with TikTok's own music (`auto_add_music`).
   - **Approval** (owner decision): posts wait in "Needs review" for the owner's OK, as today; apps set to "no
     approval" in Post settings are scheduled at once.

Build order: (1) the engine behind Create post, Daily posts and Autopilot; (2) the Social agent's captions per network
from each picture's concept; (3) the picture-to-Reel music step and TikTok music; (4) the Brain as its own agent with
what performed well.

## Where it runs

- **Every post picture (step 1, 23 October 2026; no templates, owner decision):** `drawSlide` (lib/visuals/service.ts),
  used by Create post / "Create today's content", Daily posts, Studio, "Make the picture again" and Autopilot
  carousels, and Autopilot's single pictures (lib/autopilot/images.ts) call `paintOne`: one picture with the Director's
  least-used pattern, shot, light, layout and camera, the Prompter writing from the post's brief and caption (Claude and
  Gemini take turns), then the Painter, Checker and Editor. Pro when the credits allow it and none of the company's last
  three pictures was Pro (about one post in four), else Lite. Without AI (not in the plan, no credits, a failure) the
  slide is the owner's own photo as it is (`createPhotoDesign`); with no photo either, the slide is skipped, and a
  visual with nothing to show fails with "add a photo of the product, or AI image credits". Designed tip slides are no
  more, so a carousel is the AI cover and the product's photos.
- **Starter** gets AI pictures with its 30 credits (migration `20261030250000_starter_ai_pictures`).
- **Designs** shows "Unique AI ads" and the gallery; the template and "Describe an image" tools and their actions are
  removed. Plans, Billing, Usage and Home say "AI image credits".
- **Designs → Unique AI ads** (components/designs/unique-ads.tsx, app/dashboard/designs/engine-actions.ts): an idea
  (optional), 4 / 10 / 20 pictures, shape, quality (Smart mix, Best, Saver) with the credits it will use; the pictures
  are painted two at a time and appear as they finish, each with its pattern, Pro/Lite, caption (copy), like / dislike
  and "Change this".
- **Next** (not yet): Create today's content, Daily posts and Autopilot use the engine for their AI pictures; the
  plans, Billing and Usage say "AI image credits".

## Limits

6 batches an hour per person (`imageBatch`), 20 pictures a batch, "Change this" 10 an hour (`aiImage`). Feature gate:
`aiPhotos`. Ledger feature `imageEngine` (Prompter, Captioner, Checker) and `image` (Painter, Editor).
