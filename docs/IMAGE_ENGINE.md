# Image engine: unique finished ads by a team of agents

Owner request (23 October 2026): every AI picture unique, never out of ideas, each picture with its own prompt, from
the product photos when there are some and from Business info when there are none; a team of agents (one plans, one
writes prompts, one paints, one checks, one edits, one writes captions). Why the old pictures repeated, and what
Creatify does: docs/IMAGE_ENGINE_TEARDOWN.md.

## Owner decisions (23 October 2026)

- **New products may be invented** ("New in the range", like Creatify's Grow Walls): always allowed.
- **Words are drawn by the AI** into the picture, in a layout that changes every time: no templates on AI pictures.
  The free templates stay for plans without AI pictures (Starter) and when credits run out.
- **Image credits, not images**: Nano Banana (Lite, `gemini-2.5-flash-image`, $0.039) costs **1 credit**, Nano Banana
  Pro (`gemini-3-pro-image`, $0.134) **4 credits**, so a credit stays about $0.039 and the margins stay as before. The
  plans' "AI images" limits are now credits (Business 100 = 25 Pro, or 100 Lite, or a mix).
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
| Checker | checker.ts (pure), check.ts | Gemini Flash vision | Reads the words in the picture: misspelt words, numbers nobody gave, product not visible. |
| Editor | `createEngineDesign({ editOf })` | the picture's tier | One automatic fix after a failed check (the better picture is kept), and the owner's "Change this" (the tier's credits). |

`engine.ts` runs them: `planBatch` (Director, Prompter, Captioner; credits reserved; `ImageConcept` rows "planned"),
`paintNext` (one picture per call: Painter, Checker, Editor; a failed picture's credits are given back), `batchPictures`,
`ratePicture`, `editPicture`. Memory: the `ImageConcept` table (migration `20261030230000_image_concepts`).

## Where it runs

- **Designs → Unique AI ads** (components/designs/unique-ads.tsx, app/dashboard/designs/engine-actions.ts): an idea
  (optional), 4 / 10 / 20 pictures, shape, quality (Smart mix, Best, Saver) with the credits it will use; the pictures
  are painted two at a time and appear as they finish, each with its pattern, Pro/Lite, caption (copy), like / dislike
  and "Change this".
- **Next** (not yet): Create today's content, Daily posts and Autopilot use the engine for their AI pictures; the
  plans, Billing and Usage say "AI image credits".

## Limits

6 batches an hour per person (`imageBatch`), 20 pictures a batch, "Change this" 10 an hour (`aiImage`). Feature gate:
`aiPhotos`. Ledger feature `imageEngine` (Prompter, Captioner, Checker) and `image` (Painter, Editor).
