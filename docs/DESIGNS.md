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
