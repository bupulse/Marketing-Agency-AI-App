# Content packs

Owner feedback (13 October 2026): all posts for a product looked the same, the same caption and picture on every app.
Now "Write content" for a product or campaign makes a **pack** of different posts. Each post has its own angle, its
own app, its own caption and hashtags, and its own picture with people. Code: `lib/studio/angles.ts` (pure),
`lib/ai/pack.ts` (the writer), `lib/studio/pack.ts` (the service), `lib/content-board/drafts.ts` (posts to review).

## How a pack is made

1. **Angles** (`chooseAngles`). The catalogue has price or offer, how it works, features and benefits, news, customer
   story, behind the scenes, tips, FAQ or myth-buster, why us, local moment, and book or buy. An angle is skipped
   when its facts are missing: price needs a price, news needs a campaign or a product added in the last 30 days, why
   us needs competitors in the Knowledge base, local moment needs a holiday in the company's country in the next 21
   days (`lib/autopilot/calendar.ts`). Angles rotate per product or campaign: angles it never had come first, then the
   least recently used (`GeneratedContent.angle` history), so an angle does not come back until the others had their
   turn. A fresh subject starts with what sells its kind best (products: features, price, story...; services: how it
   works, story...; events: news, book...).
   Content flow v3 added more ideas (playful, question or poll, breaking news, did you know, trivia, myth vs fact,
   tip of the day, customer spotlight, before and after, meme-style humour, and contests for "Create today's
   content" only), each marked fun or professional, with an optional fun share (`chooseAngles` options); see
   `docs/CONTENT.md`.
2. **Apps** (`spreadNetworks`). The pack is spread over the company's usable connected apps (none connected:
   Instagram, Facebook, TikTok, LinkedIn): every app gets one post before any gets a second, and each angle goes to the
   app it suits best (how it works on TikTok, news on Facebook, why us on LinkedIn...). BuPulse then decides each
   post's format (`lib/content-flow/format.ts`, docs/CONTENT.md "Picture or video"): mostly video on TikTok and
   YouTube, a mix on Instagram and Facebook, mostly pictures on LinkedIn, a carousel for list angles (tips, how it
   works, features, FAQ) when a post is not a video, within the plan's videos (this month's and today's). Saved on
   `GeneratedContent.format`.
3. **Writing** (`writePack`). One AI call writes every post, each for its angle and app (Instagram hooks and hashtags,
   Facebook conversational, LinkedIn professional, TikTok and Shorts with a video script). Every video post's script
   comes in the same call, scene by scene within the voiceover rules (`SCRIPT_GUIDE`, docs/CONTENT_VISUALS.md); a
   video post left without one gets it from the script writer (one more text generation). The single writer's facts
   rules apply: nothing invented, reviews only quoted from the CUSTOMER REVIEWS block; without one, the story angle is
   a relatable scenario, never a fake quote. Repeated or empty captions are dropped.
4. **Pictures** (`planPackVisuals`). The art director is asked for every post at once, with its angle: the cover is a
   people photo that fits the angle ("how it works": a staff member explaining the steps to a client; "price": a happy
   customer with the product; "news": the team at the opening; see `ANGLES[...].people`). Covers are then made to look
   different (`diversifyPack`: no two posts share a cover template while others are free). Carousels have a people
   cover; video posts get a video plan whose scenes use the people photo.
5. **Posts to review** (`draftPostsFromPack`). Each post becomes its own draft on its own app (a "post it yourself"
   reminder when the app is not connected), never copied to the other apps. A new pack replaces the older untouched
   drafts of the subject; an edited pack post replaces only the post it was edited from.

The pack size is in Content → Settings: 3 to 7 posts, 5 by default (`Business.contentSettings.packSize`).

## Costs and limits

- **Text:** 1 text credit per post written (`consumeUsage(userId, "text", n)`); with fewer credits left the pack is
  smaller (a pack of 5 with 3 credits left has 3 posts); credits for posts the AI did not write are given back, all of
  them when the call fails. So a Starter plan's 60 texts make 12 packs of 5 a month; plan limits keep their meaning.
- **AI images:** at most one per post (a pack of 5 uses up to 5), and only while the plan's images this month and the
  company's AI allowance last; the other posts are designed from the real photos and brand designs (never a failure),
  with "AI images for this month used — next refill on <date>" on their picture.
- One AI call writes the pack (about the cost of one single post with a longer answer), plus one cheap art director
  call per post.

## Data

`GeneratedContent.packId`, `angle`, `network` (`20261016140000_content_packs`, nullable: older content stays one post
for every app). The content page shows each post's angle and app; the version history lists the pack's posts.

## Not changed

- Autopilot keeps its playbook ideas, now one app per idea with its own picture, and the next pack angle of the
  product or campaign (content flow v3, `docs/CONTENT.md`).
- "Create today's content" on the Content day view is a pack for the chosen apps, with Gallery photos and videos
  first and the design choice (`docs/CONTENT.md`, content flow v3).
- The public API (`/api/generate`) still writes one post per call.
