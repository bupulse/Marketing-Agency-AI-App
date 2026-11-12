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
| `media-tile.tsx` | `MediaTile`: a photo, design or video tile of a fixed shape |
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

### Posts, Content board, Today, Calendar — done
- `components/content-board/post-card.tsx`: the board's `PostCard` renders the media-cards `PostCard` from
  `boardPostView(post, zone)` with its slots: the select box (`topSlot`), the making screen (`mediaOverlay`), "No picture
  yet" (`placeholder`), Auto (`mediaBadges`), the idea / contest / moved chips (`badges`), type and created date
  (`meta`), the "Not posted yet" / expired notes (`notes`) and `actions` + Share to WhatsApp (`footer`). Used by
  `post-board.tsx` (All posts, General, products, campaigns) and `today-review.tsx` (Posts page "Today").
- `components/publishing/post-detail.tsx`: `PostDetail` keeps its props and opens as `PostModal` (`detailView`):
  media left; right column the account, caption per app (tabs from the post's group), details (when, app, made by),
  then every note, results, the move form and the script/versions (`renderBody`), and the buttons (`renderFooter`).
  Edit still opens the composer. `list` + `onNavigate` give previous/next: the board's cards, Today's list, or the
  calendar day (`calendar.tsx` passes the opened post's day).
- Previews: `/media-preview/wired` (`?open=b1…b8`, `?theme=dark`) renders PostBoard, Calendar, ProductGrid,
  CampaignList, DesignStudio and photo tiles with made-up rows. Server actions need a signed-in company; in a browser
  the opened post's "script and versions" box asks for sign-in, so the headless screenshots drop those requests.

### Products, campaigns, designs, photos — done
- `components/knowledge/product-grid.tsx`: `ProductCard` per Business info product (kind, status, store badge,
  photos/texts counts and "Needs details" in `extra`).
- `app/dashboard/knowledge/campaigns/page.tsx`: `CampaignCard` per Business info campaign (type, phase as the status,
  `dateText`, `line={priceInfo}`, products/texts `facts`).
- `components/creators/company/campaign-list.tsx`: `CampaignCard` per creator campaign (status, platforms, dates,
  creators and tasks; drafts keep "Draft · step N of 12", Continue and Detailed setup; applicants and hidden badges).
  The list rows carry no views or budget, so the ring and bar stay off until they do.
- `components/designs/design-studio.tsx` and `components/media/gallery-view.tsx`: `MediaTile` (fixed shape, the design
  whole with `fit="contain"`, lift, glass label, a video's hover preview); Save / Canva / Delete and the gallery's
  select box are unchanged.
