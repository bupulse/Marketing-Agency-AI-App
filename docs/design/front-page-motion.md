# Front page motion (11 November 2026)

How bupulse.com's home page moves, what we learned from studying apple.com, and how to change it.
Only techniques were taken from Apple: no text, images, video, fonts, icons or layout. Everything on the page is
BuPulse's own (brand blue #2f6bff to violet #7b5cff, our words, our own ads).

## What apple.com does (studied with REA, 11 Nov 2026)

Evidence: REA `capture_browser_scenario` of www.apple.com (Evidence `ev_a236de55…`) and of /iphone-18-pro/ (partial,
network only), plus `analyze_javascript_application` over the shipped scripts (`ev_58fc06f5…`): homepage
`main.built.js`, `AnimSystemModel`, `inline-media.built.js`, and the iPhone page's `main.built.js` / `head.built.js`
and `overview.built.css`. Observed in shipped code and DOM, not guessed:

- **One scroll engine ("AnimSystem") with keyframes written as expressions.** Elements carry
  `data-anim-keyframe` / `data-anim-scroll-group`; the engine parses strings such as `"t - (100vh - 70h)"` to `"b"`
  where `t`, `b`, `h` are the element's top, bottom and height and `vh` the window height (its expression evaluator
  handles `h`, `t`, `vh`, `vw`, `w`, `b`, `l`, `r`, `px`, and `css(--var)`). Metrics are measured once and kept;
  `ResizeObserver` (9 uses) re-measures. Scroll itself only reads `scrollY` and runs inside `requestAnimationFrame`
  (56 uses on the iPhone page).
- **Each keyframe has its own easing** (`easeFunction`, `lerp`), can toggle a CSS class (`cssClass:"sticky"`,
  `toggle:!0`) or fire enter/exit events, and can be switched off per breakpoint or by a condition
  (`disabledWhen:["no-enhanced"]`).
- **Pinned sections are plain `position: sticky`** (8 rules in the page CSS, with `will-change: transform`).
- **Scroll-scrubbed video**: a `VideoScrub` component streams the whole file through `MediaSource` into a blob URL
  so `currentTime` can jump anywhere instantly (37 `currentTime` uses), and swaps to another file when the
  breakpoint changes, keeping the time.
- **Media per screen size, loaded only when near**: `<video preload="none" muted playsinline aria-hidden>` with
  `data-inline-media-basepath` + a file per breakpoint (`large.mp4`, `largetall.mp4`), a `…_startframe.jpg` poster
  first, and a `data-inline-media-play-kf` keyframe deciding when it plays (`{"start":"t - (100vh - 50h)","end":"b"}`).
  Images use `data-lazy` (36 on the homepage). The next gallery item preloads one screen ahead (`start:"a0t - 100vh"`).
- **No CSS scroll timelines** (0 `animation-timeline` in 1.7 MB of CSS): they drive everything from JS.
- **Reduced motion is checked** (`matchMedia("(prefers-reduced-motion: reduce)")`) and the CSS has
  `prefers-reduced-motion` fallbacks.
- **Only cheap properties move**: 482 `opacity` and many `transform` declarations, `will-change` on moving layers,
  `clip-path`/`mask` for reveals.

## What we built, the BuPulse way

No new packages. Files are in `components/marketing/home/`.

| Piece | File | Technique |
| --- | --- | --- |
| Scroll engine | `scroll-scene.ts` | Like AnimSystem, tiny: one passive scroll listener, one `requestAnimationFrame` for all scenes, positions measured on resize (`ResizeObserver` on `body`) never during scroll, an `IntersectionObserver` turns far scenes off. A scene gets progress 0..1 and writes `--p`. |
| Hero: presenter turns into an android | `avatar-hero.tsx` | Pinned (`position: sticky`, 280svh phones, 330svh desktop). 36 frames on a `<canvas>`, scrubbed by scroll with a small lerp so wheel steps still play every frame. |
| Big statement | `scroll-words.tsx` | Pinned sentence; each word's opacity is `clamp(0.5, p*(n+4) - i, 1)` in CSS from `--p` (never below 0.5, for contrast). Real text, selectable. |
| AI presenter ads | `avatar-videos.tsx`, `../video-player.tsx` | BuPulse's inline player (the sample site's player as one React component): poster and big play button, blue-to-violet scrub bar with time tip, play/pause, ±10 s, time, sound, optional full screen (never forced), controls that fade while playing, keyboard. `preload="none"`; the 30 s ad plays muted while on screen; the examples load only on play. |
| Designs wall | `post-showcase.tsx` | Pinned (300svh). Twelve posts from BuPulse's own design engine (`lib/designs/library`) on a tilted wall that settles from close up (`--a`, the first 30 % of the scroll), three rows drifting in opposite directions, a phone in front flipping through four stories. |
| BuPulse Agency, coming soon | `agency.tsx` | Rise-ins, a slowly turning conic ring, department progress bars; "Tell me when it's ready" goes to `/signup?next=/apps/start?want=agency`. |
| A week of posts sliding sideways | `week-of-posts.tsx` | Pinned; the row moves `translate3d(-shift * p)`; the track height is `100svh + shift`, all in CSS. |
| How it works, building up | `how-it-works.tsx` | Sticky panel; an `IntersectionObserver` on the steps sets `data-step`; the panel gains one card per step (one card at a time on phones). |
| Chat that types itself | `chat-demo.tsx` | Plays once when visible. Every letter is in the HTML from the start and only becomes visible, so the box never changes size (no layout shift). |
| Rise-in cards and numbers | `rise-in.tsx` | CSS `animation-timeline: view()` where supported (off the main thread); `IntersectionObserver` fallback elsewhere. |
| Scenes: colour that morphs between sections | `scene-controller.tsx` | Sections carry `data-scene` (`light`, `night`, `deep` blue, `violet`). One fixed layer takes the colour of the section on the middle line of the screen and eases to it (background colour and two soft lights drawn with `currentColor`, no blur filter). Dark scenes (`.scene-dark`) keep BuPulse's dark tokens inside them in both themes and paint their own colour with soft edges. Over a dark scene the header (light mode) switches to light-on-dark glass and the white logo, by CSS only: links and buttons are untouched. |
| Parallax | `motion.css` | Hero glows move with `--p`; example ad tiles drift at two speeds on a `view()` timeline. |

All styles are in `motion.css`. Only `transform` and `opacity` are animated during scroll (box-shadow and colours
change only on beat or step changes, as short transitions).

## The hero frames

From BuPulse's own ad "Who's real?" (`~/bupulse-sample-site/site/v/ugc-whos-real.mp4`, made 10 Nov 2026 with an AI
presenter; it already contains the glitch scan from man to android). 36 stills, cropped to 720x840 from y=40 so the
burned-in captions are left out:

- 10 frames from 5.10 to 5.91 s (the man talking), 16 frames from 6.0 to 6.5 s (the glitch, dense so it fills most of
  the scroll), 10 frames from 6.6 to 7.5 s (the android talking).
- Phones: `public/marketing/avatar/mNN.webp`, 360x420, cwebp q66, about 430 KB for all 36.
- Wider screens (768 px and up): `dNN.webp`, 600x700, q70, about 820 KB.
- Frame 00 is a normal `<img fetchpriority="high">` (the LCP image); the canvas only appears once a later frame is
  drawn. The other frames start loading after the page is idle (1.2 s + `requestIdleCallback`) or at the first
  scroll/touch, four at a time, in an order that covers the whole timeline early (0, 35, 17, 8, 26, ...).
- Rebuild: ffmpeg `-ss <t> -i ugc-whos-real.mp4 -frames:v 1 -vf crop=720:840:0:40`, then scale and `cwebp`
  (Homebrew's ffmpeg has no WebP encoder). The script used is kept in the work notes; any frame list works as long as
  `FRAME_COUNT` in `avatar-hero.tsx` matches.
- The ads: `whos-real-360.mp4` (phones, about 1.4 MB, crf 30) and `whos-real-540.mp4` (desktop, about 2.1 MB, crf 32),
  `+faststart`; four 12 s examples at 360x640 (about 0.3 MB each) with WebP posters.

## Reduced motion and no JavaScript

- `prefers-reduced-motion: reduce`: nothing is pinned or scrubbed. The hero shows one still split down the middle,
  half man, half android, with "It was AI all along"; the week of posts is a normal swipeable row; every step, card,
  chat message and word is simply shown; videos wait for a play button.
- Without JavaScript the pinned layout still renders (CSS only) with the first frame, beat 1 and the static chat;
  all text is in the HTML for search engines.

## Changing things

- Hero timing: `frameAt()` (frames play from 8% to 78% of the scene) and `beatAt()` (beats change at 27% and 62%).
- Scene lengths: `.ah`, `.sw` heights in `motion.css`; the week row's length follows `--cw`, `--gap`, `--pad`.
- Prices, chat allowances, skits a week and the cheapest plan on the page come from the live plans of the visitor's
  region (`getRegionPlans`), so Admin -> Plans changes show up without code changes.

## Round 2 (11 November 2026, owner's notes)

- **No prices on the home page.** The pricing preview and the cheapest-price number are gone; a "See plans and prices"
  card links to /pricing. The page is a story: hero, statement, AI presenter ads, designs, daily posts, how it works,
  website chat, BuPulse Agency (coming soon), industries, features, a few numbers, plans card, FAQ.
- **AI presenter ads** are in the Business plans: "Business and Business Pro include 2 AI presenter ads a month" (shown
  to Rwanda visitors, where those plans are sold). **Talking skits** are "coming soon" until they are switched on.
- **Designs wall images:** made with the app's own renderer (`renderDesign`, the same engine as client posts) through a
  temporary local route that was deleted afterwards. Example businesses are named "Your salon", "Your café"... The two
  photo posts use stills from BuPulse's own salon and construction ads. 4:5 posts at 540 px (q72) and 9:16 stories at
  360 px (q70): 252 KB for all sixteen, in `public/marketing/posts`.
- **Pricing page fix:** in the monthly view `PriceTag` no longer keeps the yearly "Was … / % off" line in the page (it
  was only faded out, so page text and text-only readers saw it). Test: `tests/billing/price-tag.test.ts`.
