# YouTube Shorts: what 100 viral Shorts taught (round 1, 19 October 2026)

Rows: `docs/research/viral/youtube.jsonl`, ids `vt-yt-001` to `vt-yt-100`. Frames (6 to 8 per Short, 540 px wide) are local only in
`video-lab/data/viral/frames/youtube/<id>/`.

## How reliable this is

- **Method.** Logged-out research Chrome (port 9334), my own tabs only. I found candidates with the YouTube search "Shorts" filter
  (about 40 searches in batches of 8 or fewer: Kigali, Rwanda, Kinyarwanda, Nairobi, Kampala, Uganda, Tanzania, Dar es Salaam,
  Bujumbura, phone shop, house for sale, salon, restaurant, product ad, 3D product animation and so on) and with the Shorts feed
  (two runs of about 40 swipes from a house-tour seed). The feed, even after a business seed, returned generic world content
  (football, comedy, skits), so it gave 3 of the 100 rows; the searches gave the rest.
- **Numbers.** A logged-out watch page shows views, likes, subscribers and comment counts, so they are real counts, not guesses
  (a few likes or comment counts that were hidden are `null`). I screened every candidate against the README bar first and kept
  only Shorts that pass. `viral_basis` names the rule. 77 of the 100 pass the "views at least 10 times followers" rule; the other
  23 pass on raw numbers (15 East African at 100,000 views, 5,000 likes or 300 comments; 8 global at 1M views or 50K likes).
- **Watching.** Each Short was played muted from start to end in its own tab, and frames were taken at 0.5 s and then spread
  evenly over the whole length. I read each Short from a contact sheet of those frames, the cut times found by comparing frames
  every 0.15 s (merged to one cut per 0.6 s), the title, description, hashtags and the top 5 comments. I did not hear the sound,
  so `music_mood` says "not heard" where captions did not tell. I did not see every second, so timings in `structure` are
  within a second or two, and `cuts_per_10s` is from the frame comparison, corrected by eye where staff or a pan moved.
- **Never done:** like, subscribe, comment, download a file, or touch another tab. Frames are screenshots of the playing video.
- **Skipped on purpose:** politics, military, a phone-shop clip with teenagers as customers, a re-upload channel, any "earn X a day"
  claim. No consent wall, captcha or login page appeared.
- **Limits.** The machine was heavily loaded all day, so capture was slow but nothing was skipped. The shared scratchpad was
  overwritten by another collector once; my scripts now live in a subfolder of it.

## Mix

| | Rows | Notes |
| --- | --- | --- |
| East African | 68 | Rwanda 30, Kenya 17, Uganda 17, Tanzania 3, Burundi 1. No Congo Short passed. |
| Global | 32 | India 9, United States 10, Sweden 3, United Kingdom 2, plus Canada, Italy, UAE, Pakistan, Turkey, Nigeria, Bangladesh and 2 with no clear country |
| Business or brand | 55 | 52 business, 3 brand |
| Creator | 45 | where a shop could copy the format |

**Where East Africa ran out.** Truly viral East African business Shorts are rare: the median East African row has 104K views and
the best business Shorts (house tours, phone shops) have 12K to 650K. 30 of the 68 East African rows are channels under 2,000
subscribers and 45 are under 10,000; they pass the bar by the 10-times rule (a 15 s Short of a 990-subscriber phone shop
with 120K views). To fill 70 I also took the most viral East African Shorts of any kind that a business could copy: Kigali,
Kampala, Dar es Salaam and Bujumbura city clips, a golf photo-shoot, a car-free-day run, street-food and market clips. They are
marked `kind: creator`. Seven of the East African rows are reposts from TikTok or Likee (watermark visible) and 2 are AI-generated
runway loops labelled "Rwanda fashion".

## What the 100 have in common

**Length.** Median 18 s. 41 are 15 s or shorter, 73 are 30 s or shorter, only 3 run over 60 s (a Dubai villa tour at 115 s, a shoe shop
at 122 s, a hair makeover at 145 s). The two most liked Shorts are 8 s (phone-case list, 92M views) and 27 s (KitKat parody ad).

**Hooks that recur** (`hook_type`): result-first 15 (the finished look in frame 0, or the grey 3D model that becomes the ad),
curiosity 14 (a one-line label or a surprise scene), number-in-hand 12 (phone in the hand and the shop number on top, all East African),
price-banner 7, bold-local-claim 7 ("Kampala looking better than Dubai", "cleanest city in Africa"), appetite-shot 5. Four ways to open
with no sound: a finished product, a label that states the promise, a number or price, a person doing something.

**Titles are part of the hook.** 71 rows carry hashtags (average 4). 30 titles contain a number (price, bedrooms, "8 things", "$1").
The best East African titles pack search words: model plus "price in Kenya", "3 bedroom house for sale Kampala 300 million
WhatsApp +256...", "Imyenda myiza ya made in Rwanda". Titles that carry an occasion or a budget do well: "Civil marriage outfit
idea", "Date spots in Nairobi under 2500 for 2".

**Text.** 75 of 100 have text on screen. Text sits in the upper third (price strips, hook labels, phone numbers) or the middle
(word-by-word captions). The lower third is covered by YouTube's own channel bar and title; the East African Short with the
caption in the bottom third is cut off by the frame (vt-yt-067). Styles that recur: white bold with a black outline; white text
in a rounded box; orange or yellow bold with outline for phone numbers; one word at a time in the middle for talking clips.

**Sound.** 74 of 100 have no voice (music or nothing). Talking-head Shorts (podcast clips, skits, presenter tours) rely on
word-by-word captions. Presenter tours in Rwanda are spoken in Kinyarwanda with the number on screen. 16 East African rows are
in Kinyarwanda.

**Cuts.** Median 5.5 cuts per 10 s. 23 Shorts are single takes (0 to 2 cuts per 10 s): the phone-in-hand shop videos, orbit shots in
salons, a drone push. The 3D and bts-to-result Shorts cut every 1.5 to 2.5 s.

**Calls to action.** Only 14 rows show a price, 23 a phone number, 29 a place. Where none of the three is on screen the comments ask
for exactly that: 31 price questions, 17 location questions and 12 contact requests in the top comments. YouTube has no clickable
ad button, so the pointer is a number or a name in text, a URL in the title, or a pinned comment. Explicit "Subscribe" boxes appear
only in farm and travel Shorts and cover the subject.

## East Africa against global

- **Reach.** Median views: East Africa 104K, global 3.0M. Global winners are creators and brands; East African winners are small
  shops with a repeatable layout.
- **What East African Shorts do.** Price, phone and place on screen: 12 of 68 show a price, 20 a phone, 27 a place (global: 2, 3 and
  2). Layouts repeat per shop: a one-hand phone clip with the number in orange on top (Yotta Hills and a sister account, 4 rows), a presenter-led house
  tour with a phone bar and an end contact card (Trecc, Bosco, Quick Homes, Edna), a salon orbit shot (Gee Curly), a wall-of-stock pan
  with two numbers (J's Addiction). 25 of 68 are tours; 8 are lists; photo slideshows (4 rows) are cheap and common.
- **What global Shorts do.** 12 of 32 open on the result; formats are behind-the-scenes to result (KitKat parody, Kerastase, Nivea,
  Vaseline, perfume with smoke), a progress or grey-model reveal in 3D (Blender can, DAY 6, DAY 8), a skit at the counter, a comment
  reply that answers a doubter, or a house tour whose price range is a label. They almost never show a phone number.
- **Shared.** Both win with a person in frame, a constant label, and one idea per Short.
- **East African gaps.** Almost no East African 3D or motion-graphics Short passed the bar; the 3D showreels all came from India,
  Sweden or the US. No restaurant ad with a price on screen from Kigali or Nairobi reached the bar.

## The 10 best examples (by id)

1. **vt-yt-004** (Nairobi, 2.6M views): "Everything you can get with $1": a running spend counter (0/130 Ksh to 130/130 Ksh) over street
   food. Price as a progress bar.
2. **vt-yt-013** (Kigali house, 228K views): 78,000,000 RWF at the top and a WhatsApp bar at the bottom for 60 s while a presenter
   walks the rooms. The Rwandan house-tour template.
3. **vt-yt-006** (Kimironko house, 653K views): presenter walking out of the door, phone bar from frame 0, contact end card.
4. **vt-yt-068** (Ruiru, Kenya, 1.0M views): three-line price, area and phone box in the middle for a 60 s 360-degree tour.
5. **vt-yt-011** (Kigali phones, 140K views on a 990-subscriber channel): one take of two iPhones with the number on top. The cheapest
   copyable shop Short.
6. **vt-yt-069** (Kigali restaurants, 11.7K views on a 62-subscriber channel): numbered "best restaurants with their locations", a pin
   and a street per place.
7. **vt-yt-020** (Kampala crocs, 10K views on 222 subscribers): tiered wholesale prices stacked over real stock plus the stall number.
8. **vt-yt-024** (KitKat parody ad, 127M views): "Wait for the result", a homemade set, a twist. Behind-the-scenes as the story.
9. **vt-yt-019** and **vt-yt-087** (Blender can 1.6M, DAY 6 1.1M): grey model with a progress bar, then the finished ad; a daily series.
10. **vt-yt-081** (restaurant B-roll checklist, 322K views): ambience, logo, menu, food, close-up: the five shots every restaurant
    needs, shown as the shots.

## 8 rules for BuPulse's engines

1. **Always render a contact strip.** Price (with "per month" or "per day" where it applies), area and WhatsApp number, in text, in the
   upper or middle third from frame 0 to the end. When it is missing the top comments are "how much", "where", "number". Keep it
   out of the lower third (the Shorts channel bar covers it).
2. **Open on the result or on one promise line in the first second.** Result-first, a one-line label ("Mini India in Kenya"), a
   price pill, or the number in hand. No logo intro.
3. **Write the title like a listing.** Product or place, key number, price, area, phone: "3 bedroom house for sale Kampala, 300M,
   WhatsApp +256...". 30 of the 100 titles carry a number; East African ones carry the number the buyer searches.
4. **Fit the length to the format.** Phone-in-hand and salon orbits: 10 to 15 s, 0 to 2 cuts. Lists and product reveals: 15 to 25 s,
   a cut every 2 s. House or shop tours: 40 to 60 s with a presenter, one cut per 3 to 5 s.
5. **Build the house-tour template once.** Presenter walking, phone bar, price strip, end contact card (Trecc, Bosco, Edna all use it
   and each reached 200K to 1M views). Same template, new house.
6. **Offer "grey to finished" and "how it was made" for the 3D engine.** A grey model with a progress bar that becomes the finished
   ad, numbered shots (Shot 1, 3, 4), and a DAY N series gave 0.7M to 127M views. Use real props for realistic ads (fruit, water,
   smoke) as the home-made versions do.
7. **Use numbered lists with prices and pins.** "Top 5 in Kigali with locations", "8 things with prices", "under 2500 for 2": each item is one
   caption line with a name, a price and a street, so it works muted and gets saved.
8. **Design for no sound and for repetition.** 74 of 100 have no voice, so talking clips need word-by-word captions. Keep one layout
   per shop and repeat it daily (the Yotta Hills phone clips and Gee Curly salon clips all share a template). If a scene is made
   by AI video, never trust generated text (the AI runway shows an invented brand 'FACEMON'), overlay the real shop name, and say
   it is AI. Never reuse a third-party clip (radio meme, TikTok repost).

## Other findings

- Photo slideshows (3 s per photo) with a title are viral in Rwanda and cost nothing (vt-yt-008, 009, 050, 088). They show prices or numbers
  only in the title, so the comments ask for them.
- Skits at the counter (India, US) and comment-replies to a doubter ("you can buy it on Amazon", "this is not successful") are the
  global answer to "what do I post when I have no new product". East Africa has none that passed the bar: an open opening.
- Comments on East African shop Shorts are mostly price and location questions in Kinyarwanda ("Angahe?", "Mukorera hehe?",
  "Ngapi?"). A first reply from the owner in the pinned comment (as the Turkish recipe and the Hyderabad store do with a Maps link) is
  a free feature BuPulse could draft.
- Several East African house tours show only a price or only a phone, never both with a location. The ones that show all three
  (Trecc, Bosco, Edna) are the ones that went past 200K views.
