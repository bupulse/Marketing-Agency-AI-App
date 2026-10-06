# Designs

Branded images for posts. Two ways to make one, both stored in the private `designs` bucket at
`<userId>/designs/<designId>.png` with a `Design` row.

| | Templates | Describe an image |
|---|---|---|
| Engine | `next/og` (Satori + Resvg) | Gemini image model |
| Cost to us | none (CPU only) | about $0.04 per image |
| Credit | none, unlimited | 1 image credit (trial 5, Standard 50, Pro 150) |
| Ledger | no | yes, `AiCall` with `feature: "image"` |

## Code map

- `lib/designs/layout.ts`: pure helpers (aspect ratios, theme from brand colours, text auto-fit). Unit tested.
- `lib/designs/templates/`: `registry.ts` (client-safe metadata), `shared.tsx` (layout families), one file per template, `fonts.ts`, `index.ts` (`renderTemplate`).
- `lib/designs/service.ts`: `createTemplateDesign`, `createAiDesign`, `deleteDesign`, `designUrl`, `listDesigns`, `previewTemplate`, `photoPreviewUrls`.
- `lib/designs/prompt.ts`: brand-aware prompt for the image model (no text in the image unless the user asks for it).
- `lib/ai/gemini-image.ts` + `lib/ai/image.ts`: `ImageProvider` for Gemini. `GEMINI_IMAGE_MODEL` (default `gemini-2.5-flash-image`), `GEMINI_API_KEY` shared with text.
- `app/dashboard/designs/actions.ts`: server actions. `app/api/designs/preview`: template thumbnails.
- `components/designs/design-studio.tsx`: the UI; its props are documented at the top of the file.

## How a template is drawn

`renderTemplate(id, input, ratio)` builds a React element tree and hands it to `ImageResponse`
(1080x1080, 1080x1350, 1080x1920, 1920x1080). Satori supports flexbox and a CSS subset only:
every element with several children needs `display: flex`, sizes are px, images need explicit
width and height, no grid. Photos and logos are passed as data URLs because Satori cannot use
private signed URLs; the service downloads them with the user's Supabase client.

Three layout families in `shared.tsx`: **overlay** (full-bleed photo or gradient, text on a scrim:
New arrival, Just listed with a frame, Announcement with a brand tint), **card** (gradient with a
rounded photo panel: Offer with a round badge, Event with a date block, Project done with a pill)
and **quote**. Every layout also works with no photo (brand gradient plus soft shapes).

Text auto-shrinks: `fitFontSize` estimates wrapped lines from average glyph width and picks the
largest size that fits the box (headline 124px down to 44px; sublines 40 to 26px). Over-long text is
cut with an ellipsis (`clampText`: headline 140 chars, subline 180, chip 40). Text colour is chosen
by WCAG contrast against the brand colours (`lib/color-contrast.ts`); one brand colour gets a darker
second tone for the gradient; no colours fall back to Pulse Blue and Violet.

### Adding a template

1. Add its metadata to `TEMPLATES` in `registry.ts` (id, name, description, field labels, `suits` project types) and to `TemplateId`.
2. Create `lib/designs/templates/<id>.tsx` exporting `(props: LayoutProps) => element`, usually `overlayLayout`, `cardLayout` or `quoteLayout` with options. A new look needs a new layout function in `shared.tsx`.
3. Register it in `LAYOUTS` in `index.ts`.
4. Add the id to `IDS` in `tests/unit/designs-templates.test.ts`. Set `DESIGNS_OUT=/some/dir` when running that test to write every PNG there and look at them.

## Fonts and languages

next/og only bundles one Latin font and limits assets to 500 KB, so `fonts.ts` fetches Inter
(ExtraBold 800 and Medium 500, SIL OFL) from the Fontsource CDN on jsDelivr, once per isolate, and
caches it in module scope. If the CDN is unreachable the render falls back to next/og's built-in
font, so a design is still produced (Latin only).

- Supported: Latin (including extended and Vietnamese), Cyrillic, Greek.
- Arabic: Cairo is loaded only when the text contains Arabic. Letters are joined and run right to left, but the text block stays left-aligned (no RTL layout). Noto Sans Arabic and Noto Naskh crash Satori's font parser, so Cairo it is.
- Not supported: Hebrew, Chinese, Japanese, Korean, Thai and Indic scripts (they show empty boxes). CJK fonts are several MB each; add one with the same loading pattern if a market needs it.
- Emoji render through Twemoji (fetched by next/og).
- Template photos must be JPG or PNG: Satori cannot decode WebP, so the service rejects it with a clear message (AI designs accept WebP as a reference). Photos must live under `<userId>/projects/`; size and type are checked from object metadata before download (max 12 MB), then a resized copy is fetched when Supabase image transformations are enabled.
- Font URLs are pinned to Fontsource 5.3.0 (`FONTSOURCE_VERSION` in `fonts.ts`); bump it deliberately.

## Costs and limits

- Templates: free and unlimited by owner decision. Each render is CPU work on the Worker; thumbnails in the picker are rendered on demand (`/api/designs/preview`, cached privately for 10 minutes), seven per picker open.
- AI images: `consumeUsage(userId, "image")` before the call, `refundUsage` if no image is stored. Gemini 2.5 Flash Image prices an image at about 1290 output tokens ($0.039); the ledger records tokens and `images: 1` (`lib/ai/pricing.ts`).
- Bucket `designs`: 10 MB per file, png/jpeg/webp only. Generated PNGs are about 100 KB to 1 MB.
