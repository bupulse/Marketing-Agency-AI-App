# Image engine: Creatify teardown and why BuPulse images repeat

Owner request (23 October 2026): AI images must be unique every time and never run out of ideas. Asked for the
same thing ("show how this product improves a farmer's yield, a happy farmer, a greenhouse, different products with the
same concept at large scale, people inside") with one LEAF Hydro Tower photo, BuPulse made near-identical images;
Creatify made three different ads: a farmer holding a harvest crate beside the tower; a commercial greenhouse full of
taller "Farm Towers" with workers on a ladder and a trolley; and a new product, wall-shaped "Grow Walls", in aisles with
three people. Each had its own headline, subline and CTA in the same layout (brand kicker line, big headline, subline,
green pill button, creatify watermark).

## 1. Creatify, from the outside

How it was looked at: REA (`analyze_web_bundle`) on the public marketing page (Evidence
`ev_e9330d9571706d50fefdecdaf28f1b546c2517529e091852f11478486a984b64`: Vite + React, marketing only) and on the app's
sign-in page, which ships the whole app (Evidence `ev_78abcd7f83733c288f36c95c582d7dfaed77f1ae5b6f8ec3f082cf8fde25b4b8`:
105 scripts, 319 routes), then a text search of the main bundle. Not signed in, nothing run, no source maps fetched.
Their prompts and models run on their servers, so how a prompt is written is **inferred**, not observed.

### Observed in their code

- **Image Ads is a flow with its own record** (`/tools/image_ads/<flow>/`). Ways in: `scrape_from_url` (a product
  page), `upload_product_manually` (product + `instructions` + `use_brand_kit`), `create_from_folder` (a saved
  product). It refuses to start without a product image ("Add at least one product image before generating Image Ads").
- **What the flow knows** (the setup state): brand name, brand description, product images and the ones selected,
  brand URL; advanced: **three selling points**, brand fonts, logo, colours; promotion: original price, promo price,
  promotion details. The brand kit adds industry, industry category, selling points, brand images, logos and fonts.
- **Generate** (`/tools/image_ads/<flow>/generate/`): `num_images` **4, 10 or 20**, `aspect_ratio` (1:1, 16:9, 9:16),
  `image_gen_model`, `language`. Models: `nano-banana`, `nano-banana-pro`, `gpt`, `gpt-image-2`,
  `gpt-image-2.5-sunburst`. A run takes 3 minutes (7 with some options). The waiting screen walks through
  "Analyzing your product info..." → "Sparking big ideas for your brand..." → "Turning concepts into eye-catching
  visuals..." → "Polishing every pixel to perfection...".
- **Every generated image is its own record**: `image_url`, `product_image` (which product photo it was made from),
  `heading`, `subheading`, `cta`, **`prompt`**, `rating`. So each image has its own prompt and its own words.
- **Revise one image** (`revise_image`): send that image's prompt, heading, subheading and CTA back, changed ("about 1
  minute"). **Rate** an image (`rating`; "image_dislike" feedback).
- **The agent's skill** "static-ad-concept-generator" ("Static concepts: eight statics from proven templates, filled
  with your offer"): its example prompt is *Generate eight static ad concepts … Use at least four templates
  (before/after, us vs them, testimonial, feature callout)*. Other skills: one testimonial per buyer persona; an
  "Ad Cloner" that remakes winning ads; a library of 15M+ ads; brand "knowledge", "memory" and "skills" pages; QA rules
  and verdicts.

### Inferred (how the three LEAF images were most likely made)

1. **Read the product** (name, description, selling points, photos, brand).
2. **One planning step writes N different concepts** ("sparking big ideas"), each from a different proven ad pattern
   and a different scene: the farmer and his harvest (lifestyle / outcome), the commercial farm (scale), the new Grow
   Walls (a product-line idea). Each concept gets its own heading, subheading, CTA and **its own full image prompt**.
3. **Each prompt goes to an image-edit model with the product photo as reference** (Nano Banana or GPT-image), told to
   keep the product's design language rather than copy the photo, so the tower can grow, multiply or become a wall.
4. **The words are laid out by a template** (the three ads share exactly the same positions and fonts), stored apart
   from the picture, which is why they can be revised alone.

## 2. Why BuPulse repeats itself (our code)

All under lib/; full map in the investigation of 23 October 2026.

1. **Every image is planned alone, in parallel, with no memory.** The art director (`visuals/art-director.ts`) runs
   once per post with `Promise.all`; no call sees the others' scenes. Nothing stores past scenes or prompts
   (`recentVisualChoices` remembers layouts only; `avoidTemplates` is never set).
2. **About 80% of each prompt is the same boilerplate** (`designs/prompt.ts` buildImagePrompt), and the only part that
   changes is a short scene; Gemini gets no seed.
3. **The same photo, pinned three times.** The product photo is the reference, and the prompt says "main subject",
   "keep the product faithful", "appears exactly as it is". With one photo, every image re-draws that photo.
4. **The owner's brief never reaches the image.** It goes to the caption writer only (`content-flow/service.ts`);
   the art director and the image prompt never see it. Daily posts have no brief at all.
5. **Fixed composition**: "one to three people", "medium shot", "an everyday Kigali setting", "lower half calm",
   "uncluttered". Large-scale or wide scenes are ruled out.
6. **Cheap fallback**: Flash-Lite with a 12 s limit; on timeout the scene is just the product title.
7. **New picture is hard to get**: "New design" and template changes reuse the old AI photo.

## 3. Proposed engine (for the owner's decisions)

- **Concept planner, one call per batch** (4, 10 or 20): reads Business info, the product (description, selling
  points, price), the brief, the audience and the photos, and returns N concepts that each differ in **pattern**
  (lifestyle outcome, scale / commercial, product line, before/after, us vs them, testimonial, feature callout,
  problem / solution, behind the scenes, flat lay, seasonal, social proof…), **setting**, **people**, **shot**
  (close-up, wide, overhead, hands) and **light / mood**. Each concept carries its headline, subline, CTA, which photo
  to use, how strictly to keep the product, and its own complete image prompt.
- **Concept memory**: every concept is saved (pattern, setting, people, shot, prompt) per company; the planner is told
  what was used lately and a coverage grid picks patterns not used yet, so it never runs out.
- **Product treatment per concept**: *exact* (the product as it is), *in use / at scale* (same product, many of them,
  bigger setting), *product-line idea* (same design language, new form, like Grow Walls; only when allowed).
- **Every product photo rotates**; no photo: the prompt is built from Business info alone.
- **Words stay in our templates** (satori), like Creatify's layout; each image keeps its prompt and words, so "revise
  this one" and ratings work, and a dislike teaches the planner.
- The brief from Create, Daily posts and Autopilot all feed the planner.
