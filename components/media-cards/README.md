# Media cards

BuPulse's cards for videos, posts, products and campaigns on the client dashboard, re-created from the owner's samples
site (samples.bupulse.com/team/videos.html and images.html, 12 Nov 2026): the gradient border that follows the pointer,
the glass play button, the liquid-glass info panel, the lightbox player and the Instagram-style feed post.

Preview (development only, 404 in production): **/media-preview** (`?theme=dark`, `?open=post|carousel|video`).
It lives outside `/dashboard` because the dashboard layout needs a signed-in company.

All props are data only. Pages map their rows to them; `adapters.ts` has the mappings for today's shapes.

| File | What |
| --- | --- |
| `video-card.tsx` | `VideoCard` (dark 9:16 / 16:9 / 1:1 card, hover preview, glass panel with an `actions` slot) and `InlineVideo` (a video inside a post) |
| `media-player.tsx` | `MediaPlayer`: the full player (glass controls, prev/next, Esc, swipe, details panel) |
| `post-card.tsx` | `PostCard`: a feed post per platform (Instagram, Facebook, LinkedIn, X, TikTok, YouTube Shorts) |
| `post-modal.tsx` | `PostModal`: the opened post (media left, caption and details right; a full-screen sheet on phones) |
| `product-card.tsx` | `ProductCard` |
| `campaign-card.tsx` | `CampaignCard` (creator campaigns and Business info offers or events) |
| `parts.tsx` | `StatusPill`, `PlatformIcons`, `AccountPicture`, `CaptionText`, `ActionRow`, `glassButtonClass` |
| `helpers.ts` | pure helpers: `durationLabel`, `splitCaption`, `extraHashtags`, `truncateCaption`, `timeLabel`, `postStatusKey`, `priceLabel`, `dateRangeLabel`... (tests/media-cards) |
| `adapters.ts` | `libraryVideoCard`, `libraryPlayerItem`, `contentPostView`, `postMedia` |
| `media-cards.module.css` | the effects (glass, border, keyframes); reduced motion turns them off |

Motion uses transform and opacity only; the tilt, hover preview and pointer light are mouse-only and off with reduced
motion. Phones get tap to play and an arrow on the glass panel for the details and actions.

Note for styling: the CSS module is not in a Tailwind layer, so it wins over Tailwind utilities on the same element.
To override a module property from Tailwind (for example `hidden` on an `fbtn`), use the important form (`md:!hidden`).

## Wiring

### Videos library — done
`components/video-library/video-library.tsx`: `VideoCard` per `LibraryVideo` (`libraryVideoCard(v, timeZone)`), the
glass panel holds Schedule (opens a dialog with the schedule form), Download, Share to WhatsApp, Open its post (post
videos) and Delete (confirm in place). A card opens `MediaPlayer` with the same actions in its side panel.

### Posts, Content board, Calendar — to do
Data: `ContentPost` (lib/content-board/queries.ts) → `contentPostView(post, zone)` gives `PostView`.
- `components/content-board/post-card.tsx` (`PostCard` there) → render the media-cards `PostCard` with
  `post={contentPostView(post, zone)}`, `actions` from `content-actions.tsx` (Approve, Edit, Schedule, Delete as
  `MediaAction[]`), `footer={<WhatsAppShare …/>}`, `onOpen` → open `PostModal`. Keep the select mode (`selected`) and
  the "making" screen (render `MakingScreen` instead of the card while `post.setMaking`).
- `components/content-board/post-board.tsx` (the grid) → one `PostModal` for the shown list:
  `posts={shown.map(toDetail)}`, `index`, `actionsFor`. `toDetail` adds `variants` (the other posts of the same
  `groupId`, one tab per network), `details` (scheduled time, apps, product or campaign, made by) and `dateLine`.
- `components/publishing/post-detail.tsx` is today's opened post: `PostModal` can replace its view; keep its edit form
  where "Edit" goes.
- Calendar (`components/publishing/calendar.tsx`): the day cells stay small; a click on a post opens `PostModal` with
  the day's posts (prev/next walk the day).
- Gallery / Designs pages: a design is a `PostView` with `media` = its images and no status; or a `VideoCard` for reels.

### Products and campaigns — to do
- Business info products (`components/knowledge`, Product rows): `ProductCard` with
  `price={priceLabel(p.priceModel, p.priceAmount, p.currency)}`, `imageUrl` = first ProductPhoto (signed),
  `kindLabel` from `ProductKind`, `status="draft"` / `"ended"` for DRAFT / ARCHIVED, `stats` (posts made, last post),
  actions Make a post / Edit, `href` the product page.
- Creator campaigns (`components/creators`, CreatorCampaign): `CampaignCard` with `status={campaignStatusKey(c.status)}`,
  `dates={{ start: startsOn, end: endsOn, today }}`, `metric={{ label: "views", value, target: viewTargetCampaign }}`,
  `budget` from payRules and paid-out totals, `creators`, `platforms`, cover from `look`.
- Business info campaigns (Campaign: EVENT / OFFER / …): `CampaignCard` with `kindLabel`, `line={priceInfo}`, dates and
  `metric={{ label: "posts made", value, target }}`.
