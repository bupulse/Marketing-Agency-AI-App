# Designs

Branded images for posts. Three ways to make one, all stored in the private `designs` bucket at
`<userId>/designs/<designId>.png` with a `Design` row.

| | Templates | Template with AI photo | Describe an image |
|---|---|---|---|
| Engine | `next/og` (Satori + Resvg) | Gemini photo, then `next/og` layout | Gemini image model |
| Cost to us | none (CPU only) | about $0.04 per image | about $0.04 per image |
| Credit | none, unlimited | 1 image credit (trial 5, Standard 50, Pro 150) | 1 image credit |
| Ledger | no | yes, `AiCall` with `feature: "image"` | yes, same |
| Stored as | `Design` kind `TEMPLATE` | `Design` kind `AI` with `template` set | `Design` kind `AI` |

## Code map

- `lib/designs/layout.ts`: pure helpers (aspect ratios, theme from brand colours, text auto-fit). Unit tested.
- `lib/designs/packs.ts`: the five style packs and `recommendPack` (client-safe). `lib/designs/labels.ts`: default kicker text per `Business.contentLanguage`. `lib/designs/photo-scene.ts`: the scene brief for AI photos.
- `lib/designs/templates/`: `registry.ts` (client-safe metadata), `shared.tsx` (building blocks and the `Spec` a template hands to a pack), `packs/<pack>.tsx` (one layout function per style pack), one small file per template, `fonts.ts`, `index.ts` (`renderTemplate`).
- `lib/designs/service.ts`: `createTemplateDesign`, `createAiPhotoDesign`, `createAiDesign`, `deleteDesign`, `designUrl`, `listDesigns`, `previewTemplate`, `photoPreviewUrls`.
- `lib/designs/prompt.ts`: brand-aware prompt for the image model (no text in the image unless the user asks for it).
- `lib/ai/gemini-image.ts` + `lib/ai/image.ts`: `ImageProvider` for Gemini, through the Interactions API. `GEMINI_IMAGE_MODEL` (default `gemini-2.5-flash-image`), `GEMINI_API_KEY` shared with text.
- `app/dashboard/designs/actions.ts`: server actions. `app/api/designs/preview`: template thumbnails.
- `components/designs/design-studio.tsx`: the UI; its props are documented at the top of the file.

## How a template is drawn

`renderTemplate(id, input, ratio)` builds a React element tree and hands it to `ImageResponse`
(1080x1080, 1080x1350, 1080x1920, 1920x1080). Satori supports flexbox and a CSS subset only:
every element with several children needs `display: flex`, sizes are px, images need explicit
width and height, no grid, no `calc()`, no fragments that carry layout, and no `undefined` style
values (use a spread). A `boxShadow: "none"` draws a black box; use a transparent shadow instead.
Photos and logos are passed as data URLs because Satori cannot use private signed URLs; the
service downloads them with the user's Supabase client.

### Style packs

Each template is a small `Spec` (`mode`: `photo`, `card` or `quote`; `badge`: pill, block or circle;
`frame`; `tint`). A **style pack** turns a spec into a look, so a luxury salon and a phone shop no
longer share a layout. All sizes are written for a 1080px short side.

| Pack | Look | Fonts | Chosen for |
|---|---|---|---|
| `clean` | white panel over the photo, hairlines, brand bar | Inter | professional voice, retail, tech, default |
| `elegant` | ivory, thin rules, arched photo, centred serif | Playfair Display | luxury and caring voices, beauty |
| `bold` | dark base, diagonal brand band, skewed blocks, capitals | Anton | bold voice, fitness |
| `warm` | cream gradients, round photo shapes, pill labels | Nunito | friendly voice, restaurants, cafés, hotels |
| `playful` | tilted stickers, polaroid, hard shadows, confetti | Nunito | playful voice |

Seven more styles (minimal, luxe, vibrant, earthy, corporate, fresh, retro) came with the design library below; the
classic templates draw them with the closest of these five.

`recommendPack({ tone, industry })`: a distinctive voice (luxury, caring, bold, playful) decides;
else a strongly styled industry; else friendly is `warm`, professional is `clean`, anything else
`clean`. The studio marks that pack "Matches your brand" and starts on it, the client can switch,
and `/api/designs/preview?pack=` draws the thumbnails in the chosen pack (the business's own when
omitted). Text always sits on a panel, a solid base or a scrim, never straight on a photo.

Text auto-shrinks: `fitFontSize` estimates wrapped lines from average glyph width (`charWidth` per
font) and picks the largest size that fits the box. Over-long text is cut with an ellipsis
(`clampText`: headline 140 chars, subline 180, chip 40). Text colour is chosen by WCAG contrast
against the brand colours (`lib/color-contrast.ts`); one brand colour gets a darker second tone;
no colours fall back to Pulse Blue and Violet.

Default kickers ("New arrival", "Special offer"...) follow `Business.contentLanguage` for English,
French, Spanish, Portuguese, German, Italian, Dutch, Swahili, Kinyarwanda, Turkish and Indonesian; other languages, Arabic included (Satori does not shape right-to-left text reliably), fall back to English. A kicker the user typed, or "", is never replaced.

### AI photo plus layout

`createAiPhotoDesign` uses one image credit exactly like `createAiDesign` (`consumeUsage` first,
`withLedger`, `refundUsage` on any failure, including a layout failure after the photo was made).
`buildSceneBrief` asks Gemini for a realistic photo with calm space for the message and no text,
and strips words that would make `buildImagePrompt` drop its "no text in the image" rule. The
photo (PNG or JPEG only) is then drawn by the chosen template and pack. Quote is not offered over a
photo. No migration: it is a `Design` with `kind: AI` and `template` set.

### Adding a template

1. Add its metadata to `TEMPLATES` in `registry.ts` (id, name, description, field labels, `suits` project types) and to `TemplateId`.
2. Create `lib/designs/templates/<id>.tsx` exporting `(props: LayoutProps) => renderPack(props, spec)`. A new look for every template is a new pack: add `packs/<pack>.tsx`, register it in `packs/index.tsx`, `PACKS` in `lib/designs/packs.ts` and (for a new font) `PACK_FONTS` in `fonts.ts`.
3. Register the template in `LAYOUTS` in `index.ts` and add its kicker to every language in `labels.ts`.
4. Add the id to `IDS` in `tests/unit/designs-templates.test.ts`. Set `DESIGNS_OUT=/some/dir` when running that test to write every pack x template x ratio PNG there and look at them.

## Design library

On top of the seven classic templates, BuPulse has a library of image designs and video looks, and **BuPulse picks
them, never the owner**: the art director chooses the style and what each slide is about (its template), then
`chooseDesign` picks the design. Code: `lib/designs/library/` (client-safe catalogue and data, Satori layouts) and
`lib/visuals/video-looks.ts` (video looks), wired in `lib/visuals/designs.ts`.

### Styles

Twelve styles (`PACKS`, `lib/designs/packs.ts`); their tokens (font, paper and ink, dark surface, metal, radius,
stroke, shadow, motifs, kicker and chip shapes, tilt, brand lean, favourite tones, video caption font) are in
`lib/designs/library/styles.ts`.

| Style | Font | Look | Chosen for (`recommendPack`) |
|---|---|---|---|
| `clean` | Inter | white panels, hairlines, grids | professional voice, default |
| `elegant` | Playfair Display | ivory, thin rules, arches | luxury and caring voices, beauty |
| `bold` | Anton | dark, diagonals, capitals, hard shadows | bold voice, fitness |
| `warm` | Nunito | cream, waves, round shapes | friendly voice, restaurants and cafés |
| `playful` | Nunito | confetti, stickers, tilted stamps | playful voice |
| `minimal` | Inter 500 | quiet type, one accent, space | architecture, photography, design studios |
| `luxe` | Playfair Display | near-black, gold rules, art-deco fans | luxury voice for property, hotels, fashion; jewellery, perfume |
| `vibrant` | Poppins | saturated blocks, blobs, zigzags | schools, kids, parties, music, events |
| `earthy` | DM Serif Display | earth tones, woven zigzags and mud-cloth-like marks (generic geometry) | hotels and travel, crafts, textiles, furniture |
| `corporate` | Space Grotesk | navy, grids, plus marks | IT and software, phones, finance, law, construction |
| `fresh` | Nunito | light green tints, leaves | clinics and health, farms, groceries, juice; caring voice in those |
| `retro` | DM Serif Display | cream paper, sunbursts, badges, offset shadows | barbers, vintage, thrift, diners |

A bold or playful voice decides; luxury and caring look at the industry first; then the industry; then friendly is
`warm` and professional `clean` (a professional voice never gets `vibrant`). Poppins, DM Serif Display and Space
Grotesk (SIL OFL) are the three new fonts: fetched from Fontsource for images like the others, self-hosted in
`public/fonts/video` for videos. The classic templates draw the new styles with the closest classic pack
(`classicPack` in `templates/packs/index.tsx`: minimal and corporate as clean, luxe as elegant, vibrant as playful,
earthy and fresh as warm, retro as bold).

### Image designs

`lib/designs/library/catalog.ts`: 15 **layout families** x 7 **variants** = **105 designs per style, 1,260 in all**.

| Family | Photo | Fits |
|---|---|---|
| `hero` full-bleed photo + panel | needs one | new, showcase, listing, offer, news |
| `split` photo one side, text the other | optional | new, feature, listing, how-it-works |
| `polaroid` framed photo on a pattern | needs one | showcase, new, testimonial, event |
| `circle` round or arched crop | optional | new, feature, testimonial, offer |
| `diagonal` slanted brand band | optional | offer, price, announcement, event |
| `magazine` masthead + cover lines | needs one | news, new, showcase, feature |
| `price` price tag hero | optional | price, offer, new, listing |
| `steps` numbered step or tip | none | how-it-works, tips |
| `quote` saying in large type | none | quote, tips |
| `testimonial` stars, words, portrait | optional | testimonial, quote |
| `features` up to four tiles from the subline (split on `·`, `|`, `;`, `, `) | optional | feature, how-it-works, tips |
| `poster` event poster with a date block | optional | event, announcement, offer |
| `banner` loud announcement | optional | announcement, news, offer, event |
| `minimal` quiet type, one accent | optional | general, quote, news, tips |
| `spotlight` product in a large frame, price badge, features called out | optional | new, feature, showcase, price, listing |

A variant is a set of **knobs**: tone (paper, brand, night, tint), motif (one of the style's SVG patterns, or none),
flip, photo shape (rect, round, arch, circle, slant), accent (bar, dot, underline, corner, frame, none), type scale and
centring. The first variant takes each knob's safest value in the style's favourite tone; each next one is the
combination furthest from all chosen so far (`variantsOf`), so neighbours differ in several knobs (tested). Ids are
deterministic: `<style>/<family>-<nn>` (`warm/split-03`); they change only if a family's knob space changes.
Every design supports the four aspects. Metadata per design: `fits` (angles), `needsPhoto`, `usesPhoto`,
`capacity` (headline + subline characters), `aspects`.

Legibility: every surface's text colour passes WCAG AA (4.5:1) on both ends of its gradient for any brand colours
(a gradient that cannot is flattened, a mid tone deepened; `palette` in `kit.tsx`, tested over ten palettes);
highlights pass 3:1 or fall back to the text colour. Text on photos sits on a panel or a dark scrim. Headlines and
sublines auto-fit their box with the style font's metrics and are clipped to what the box holds at the smallest size.
Patterns are SVG data URLs (`motifs.ts`; CSS background patterns do not render reliably in Satori) and polygons are
in px (Satori resolves percentages in `clipPath` badly).

Drawing: `renderDesign(id, input, ratio, { template })` in `render.tsx` (same `ImageResponse`, fonts and limits as
the templates). `createTemplateDesign` takes `design` and `step`; with a valid design id it draws the design instead
of the classic template (the `Design` row still records the template).

### Choosing (the owner never picks)

`chooseDesign({ style?, angle, aspect, hasPhoto, textLength, recent, seed? })` scores every design of the style:
angle fit, photo (a photo design when there is a photo; never a design that needs one without), text capacity, and
`recent` (the business's last designs: never repeated while others fit, and the families of the last few score lower
so consecutive posts change layout). Ties are spread by `seed` (the content or group id). Deterministic.

`lib/visuals/designs.ts`: `assignDesigns(plan, { recent, seed })` runs after the art director (and the rules
fallback) in `planVisuals` and Autopilot carousels; the angle comes from the template (`offer` with a number in the
chip is `price`; text slides inside a carousel are `tips`, numbered with `step`); slides of one carousel never share a
design. `recentVisualChoices` reads the last 24 `ContentVisual` plans of the business. When a slide's photo fails or
the owner restyles, swaps a photo or changes the template, the changed slides get a new design of the right style
(`designFor`, `updateImageVisual`). Plans made before the library have no `design` and draw the classic templates.
The design studio's manual template and style pickers remain as they were (internal use). On the content card the owner gets one **New design** button (`changeVisual({ redesign: true })`: every slide gets a different design of the same style, photos and paid AI photos reused, so no image credit); the style dropdown sits under a collapsed "More options" and there is no template picker.

### Video looks

`lib/visuals/video-looks.ts`: **12 looks per style, 144 in all**, built from the style tokens x 8 look families
(cinematic, kinetic, framed, split, card, steps, quote, editorial) x knobs. A look sets the hook and body layouts
(lower-third, kinetic title, framed, split, card, steps, quote; a body scene with a price gets the price card; the
closing scene is the outro with logo or initial, business name, call to action and optional contact), the transition
(crossfade, slide, zoom, wipe and its length), the caption style (position, box, alignment, case, size, accent; one
caption at a time), the Ken Burns preset (zoom and move order), brand colour use and the backdrop motif for scenes
without a photo. Caption colours pass 4.5:1 on their box or sit on a dark scrim (tested). `chooseLook` /
`chooseVideoLook({ style?, angle?, hasPhoto, recent, seed })` picks one avoiding recent looks and the last family.
The plan stores `look` (and optional `contact`, `logoPath`); the renderer (`components/visuals/video-renderer.ts`,
`look-renderer.ts`) draws it the same in the browser and in the video robot; plans without a look render as before.

### Reviewing

- `/admin/designs` (Product > Design library, AAL2 like the rest of the console): every design of a style as a
  thumbnail, 24 a page, in any aspect, with or without a sample photo and in four sample palettes
  (`/admin/designs/thumb`, drawn on demand, cached a day in the browser), plus three frames of each video look drawn in
  the browser by the real renderer.
- `tests/designs/library.test.ts`: catalogue (counts, ids, distinct neighbours), contrast, chooser, the element tree
  of every design in every aspect, and 48 real renders in CI (about a second each). `DESIGNS_FULL=1 npx vitest run
  tests/designs/library.test.ts` renders all 5,040 (every design x 4 aspects; over an hour), `DESIGNS_OUT=/dir` writes
  the PNGs. `tests/visuals/video-looks.test.ts` and `tests/visuals/designs.test.ts` cover looks and the wiring.

### Adding to the library

- A variant: widen the family's knob space in `SPACES` (`catalog.ts`); ids of that family may shift, so do it before
  launch or accept that old plans redraw with the nearest design (`usableDesign` falls back by style).
- A family: add it to `FamilyId`, `FAMILIES`, `SPACES` and `FAMILY_LAYOUTS` (`render.tsx`) with its layout in
  `families/`.
- A style: add it to `PackId`/`PACKS`, `STYLES`, `recommendPack`, `PACK_FONTS` (`fonts.ts`), `CLASSIC` in
  `templates/packs/index.tsx`, and its video font files in `public/fonts/video`.

## Fonts and languages

next/og only bundles one Latin font and limits assets to 500 KB, so `fonts.ts` fetches Inter
(ExtraBold 800 and Medium 500, SIL OFL) from the Fontsource CDN on jsDelivr, once per isolate, and
caches it in module scope. If the CDN is unreachable the render falls back to next/og's built-in
font, so a design is still produced (Latin only).

- Font subsets (Latin Extended, Vietnamese, Cyrillic, Greek) are fetched only when the text uses those characters, and font bytes are kept in the Workers Cache API across isolates (in-memory only in Node).
- Style packs add Playfair Display (elegant), Anton (bold) and Nunito (warm, playful), fetched like Inter and cached per isolate: Latin, Latin Extended and (when the text needs it) Cyrillic subsets, one weight each. Inter stays in the font list as the fallback for glyphs they lack (Anton has no Cyrillic).
- Supported: Latin (including extended and Vietnamese), Cyrillic, Greek.
- Arabic: Cairo is loaded only when the text contains Arabic. Letters are joined and run right to left, but the text block stays left-aligned (no RTL layout). Noto Sans Arabic and Noto Naskh crash Satori's font parser, so Cairo it is.
- Not supported: Hebrew, Chinese, Japanese, Korean, Thai and Indic scripts (they show empty boxes). CJK fonts are several MB each; add one with the same loading pattern if a market needs it.
- Emoji render through Twemoji (fetched by next/og).
- Template photos must be JPG or PNG: Satori cannot decode WebP, so the service rejects it with a clear message (AI designs accept WebP as a reference). Photos must live under `<userId>/projects/`; size and type are checked from object metadata before download (max 12 MB), then a resized copy is fetched when Supabase image transformations are enabled.
- Font URLs are pinned to Fontsource 5.3.0 (`FONTSOURCE_VERSION` in `fonts.ts`); bump it deliberately.

## Costs and limits

- Templates: free and unlimited by owner decision. Each render is CPU work on the Worker; thumbnails in the picker are rendered on demand (`/api/designs/preview`). Renders are kept in the Workers Cache API for a week, keyed by a hash of business name, logo path, colours, language, template, pack and ratio (bump `PREVIEW_VERSION` when a layout changes), and only cache misses count against the 400 per hour limit. The browser reuses a thumbnail for an hour. The style picker always previews the same template, so switching templates does not redraw it.
- AI images and AI photo designs share a tighter rate limit (`RATE_LIMITS.aiImage`, 10 an hour per user) because each call pays Gemini. If the photo comes back as WebP or cannot be decoded, the design is drawn on the pack's brand backdrop and not refunded. `consumeUsage(userId, "image")` before the call, `refundUsage` if no image is stored. Gemini 2.5 Flash Image prices an image at about 1290 output tokens ($0.039); the ledger records tokens and `images: 1` (`lib/ai/pricing.ts`).
- Bucket `designs`: 10 MB per file, png/jpeg/webp only. Generated PNGs are about 100 KB to 1 MB.
