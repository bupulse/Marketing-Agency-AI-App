# Handover: design library (image designs and video looks)

Built 13 October 2026 on branch `v2-templates` (worktree `~/BuPulse-v2-templates`, from `v2`). How it works:
`docs/DESIGNS.md`, sections "Design library" to "Adding to the library". Not pushed, not merged.

## What changed

- **12 styles** instead of 5: clean, elegant, bold, warm, playful plus minimal, luxe, vibrant, earthy, corporate,
  fresh, retro (`lib/designs/packs.ts`, tokens in `lib/designs/library/styles.ts`), with new `recommendPack` rules.
- **Image designs**: 14 layout families x 7 variants per style (`lib/designs/library/`), drawn with next/og.
- **Video looks**: 12 per style (`lib/visuals/video-looks.ts`), drawn by the existing browser renderer
  (`components/visuals/look-renderer.ts`), so the video robot gets them too.
- **BuPulse chooses**: `chooseDesign` / `assignDesigns` for slides, `chooseVideoLook` / `chooseLook` for videos, both
  avoiding the business's recent choices. Wired in `planVisuals`, `drawSlide`, `updateImageVisual` and Autopilot.
- **Admin gallery** `/admin/designs` (nav: Product > Design library) with an on-demand thumbnail route.

## Counts

| Style | Image designs | Video looks |
|---|---|---|
| clean | 98 | 12 |
| elegant | 98 | 12 |
| bold | 98 | 12 |
| warm | 98 | 12 |
| playful | 98 | 12 |
| minimal | 98 | 12 |
| luxe | 98 | 12 |
| vibrant | 98 | 12 |
| earthy | 98 | 12 |
| corporate | 98 | 12 |
| fresh | 98 | 12 |
| retro | 98 | 12 |
| **Total** | **1,176** | **144** |

## Migration and configuration

None. `VisualSlide.design` / `step` and `VideoPlan.look` / `contact` / `logoPath` are optional JSON keys in
`ContentVisual.plan`; older plans render exactly as before. No new secrets and no new dependencies.

## Size

Layouts are code (no image assets; patterns are generated SVG). Three new OFL fonts (Poppins, DM Serif Display,
Space Grotesk), Latin and Latin Extended woff2, about 115 KB in `public/fonts/video` (static files, not in the
function bundle); images fetch them from Fontsource like the existing fonts.

## Decisions

- **Composable, not hand-written**: style tokens x layout families x knob variants. Variants are picked for maximum
  difference (`variantsOf`), so the 7 of a family look distinct; ids are deterministic (`warm/split-03`).
- **Legibility is enforced by code and tests**: WCAG AA text on every surface for any brand colours; text on photos
  only on panels or scrims; text clipped to what its box holds at the smallest size.
- **The classic seven templates stay** (design studio, Autopilot single images, old plans); the newer styles draw
  them with the nearest classic pack. The studio's manual style and template pickers are unchanged (internal use);
  the content card's Style picker now lists twelve styles and a restyle re-chooses the designs.
- **No AI schema change**: the art director still returns pack and template per slide; the design follows from
  them, so no extra AI cost.
- **Video looks need nothing on the server**: the plan carries the look id. `logoPath` is supported by the renderer
  but not filled yet (the outro shows the business initial); to use the logo, pass it to `buildVideoPlan` and sign it
  in `lib/visuals/queries.ts` and `signScenePhotos` in `lib/visuals/robot.ts`.

## Tests

`tests/designs/library.test.ts` (48 real renders in CI; `DESIGNS_FULL=1` renders all 4,704, over an hour),
`tests/visuals/designs.test.ts`, `tests/visuals/video-looks.test.ts`, plus the updated
`tests/unit/designs-templates.test.ts` (classic templates render in the five classic packs; every new style builds).

## Open points

- Owner review of the gallery: some families may deserve tuning per style once seen with real brand colours.
- The content card still offers Style and Template changes; hide them if the owner should never pick at all.
