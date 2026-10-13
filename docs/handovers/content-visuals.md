# Handover: content visuals (images, carousels, videos)

Built 12 October 2026 on branch `v2-media` (worktree `~/BuPulse-v2-media`, from `v2`). Not pushed, not merged. No
database was touched: the migration was written and `npx prisma generate` was run. No real AI or image API was called;
tests mock them. How it works: `docs/CONTENT_VISUALS.md`.

## What works (tested locally, no database)

- Studio content arrives with a planned picture (art director, validated) that the page draws a few slides per call,
  and, when the plan has video, a video plan rendered in the browser with a progress bar and uploaded.
- Owner controls: swap photo, style pack, template, slide texts, new picture, remove; video captions, make again, own
  music, remove; "AI video (coming soon)" shown disabled.
- Autopilot: carousels for list ideas, the single playbook image otherwise, video plans for video ideas ("Video ready to
  render" on the card, rendered when opened), and the visuals go on the posts.
- Posts: carousels where the network has them; Instagram Reels and Facebook videos; TikTok and YouTube reminders carry
  the video; the reminder email links it.

## Migration

`20261015090000_content_visuals` (after `20261014100000_custom_plan_offers`): table `ContentVisual` (FKs to Business and
GeneratedContent, cascade; CHECKs; indexes), RLS on, `REVOKE ALL`; media bucket types plus `video/mp4`, `video/webm`;
`PlanDefinition` row `PRO` gets `"video"` in `featureKeys` if missing. Additive. Deploy order: back up,
`prisma migrate deploy`, then the code.

## Cost per post (estimates, October 2026 prices in `lib/ai/pricing.ts`)

| Visual | AI cost | Credits |
| --- | --- | --- |
| Art director (Gemini 3.1 Flash-Lite, about 1,500 tokens in, 400 out) | about $0.001 | none |
| Single image or carousel from album photos or text | $0 (CPU only) | none |
| With one AI photo (Gemini 2.5 Flash Image) | about $0.04 | 1 image credit |
| Slideshow video | $0 (the owner's browser) | its seconds of `videoSeconds` |

So a Studio post costs about $0.001 extra for its picture, $0.04 with an AI photo. An Autopilot week of 7 posts costs
at most 5 AI photos ($0.20) plus a few art director calls (only for likely carousels). All of it goes through the AiCall
ledger, the platform cap (`AI_MONTHLY_BUDGET_USD`) and the company allowance (`AI_COMPANY_MONTHLY_USD`, $3).

## Free-plan limits to watch

- **Supabase Storage, 1 GB in total.** Videos are 3 to 8 MB each; they count toward `MEDIA_PLATFORM_MAX_BYTES` (900 MB)
  with the gallery photos, so about 100 to 200 stored videos across all companies fill it (published ones are deleted after 30 days). Uploads are refused with the
  friendly "storage is full" message past the guard. Designs (slides) are in the `designs` bucket, 100 KB to 1 MB each,
  and are not in the platform guard (as before).
- **Netlify, 60 s per function.** Slides are drawn in calls of at most 30 s; video is never rendered on the server.
  Autopilot runs one business per call there, and carousels add up to 3 renders per group. Instagram Reels can take
  longer than the 25 s container wait on Netlify: the post is then retried ("temporary") and each retry makes a new
  container, so a Reel may need a few publisher runs.
- **Browser support.** MP4 needs WebCodecs (Chrome, Edge, recent Safari); others fall back to WebM in real time
  (30 s takes 30 s); very old browsers get a message and the picture.

## Decisions

- Visuals belong to a content version; edits carry them to the new version. One image visual and one video visual per
  version or group; "New picture" replaces the image one.
- AI photos are stored as designs (Designs page, `kind AI`) and reused when restyling. Slide designs are deleted when
  replaced, unless a post uses them.
- Video seconds are counted when the upload is confirmed (not when rendering starts), so a failed render costs nothing.
- `video` is built; see the plan table in `docs/CONTENT_VISUALS.md`.
- Autopilot asks the art director only when a carousel is likely, to keep a week's run short and cheap.

## Follow-up (owner decisions of 12 October 2026)

- Video by plan: Rwanda Business and Pro 240 s a month, trial 30 s, Starter and Standard none (add-on, RW price
  10,000 RWF a month, owner decision). Same migration file (`20261015090000_content_visuals`).
- Daily `/api/cron/media-cleanup`: video files go 30 days after their posts were published; videos also go with their
  product, campaign or pruned content (a waiting post keeps its video until then).

## Not done / next

- Real AI video (Veo or similar): plug into `lib/visuals/ai-video.ts` with credits and the ledger.
- TikTok and YouTube upload APIs (videos go out by reminder email for now).
- A gallery view of rendered videos.
