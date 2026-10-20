# TikTok viral round 1: what the 100 videos taught

Rows are in `tiktok.jsonl` (`vt-tt-001` to `vt-tt-111`, 100 kept; ids are never reused, so there are gaps).
Frames (6 to 8 per video, 540 px wide) are in `video-lab/data/viral/frames/tiktok/<id>/` and stay on this Mac.

## How it was collected, and what to trust

- Videos were opened one at a time in one tab of the research Chrome (logged in as the owner, never liked, followed or
  commented) and played through muted, start to finish. Frames were taken from the playing video, spread over its whole
  length (first at 0.5 s); `vt-tt-001` and `vt-tt-002` were taken by seeking instead of playing. Structure timings are
  read from those frames, so they are good to about 1 to 3 seconds. The audio was never heard: `sound.name` is what
  TikTok printed, `sound.kind` and `music_mood` are inferred from the picture.
- Views, likes, comments, shares, saves, followers, caption, hashtags, duration and post date come from the video page's
  own data; they are exact, not rounded. `country` is TikTok's "posted from" location, so a few rows differ from the
  shop's home (`vt-tt-017` is a Kenyan travel account reviewing a Kigali cafe; `vt-tt-064` is a Nairobi shop buying in
  Kariakoo).
- Top comments were read for 43 of the 100 rows (the comment panel did not load for the rest, so `top_comments` is empty
  there). Comment likes and categories were not captured: `likes` and `category` are `null`.
- Mix: **82 East African** (32 Rwanda, 21 Kenya, 20 Uganda, 9 Tanzania) and **18 global or other** (6 US, 3 Nigeria,
  3 Philippines, and one each Ghana, South Africa, Benin, Malaysia, Spain, UAE). That is short of the 70/30 target on the
  global side: global business searches produced mostly "TikTok shop" and income-pitch videos, which were left out.
  Business accounts are 85, creators 13, brands 2.
- Every kept row passes the viral bar in `viral_basis`. East African rows have a median of 226K views, 18x their
  followers. Global rows have a median of 1.2M views, 60x their followers. The biggest are `vt-tt-106` (20.8M),
  `vt-tt-082` (12.9M), `vt-tt-068` (9.7M), `vt-tt-074` (6.3M) and `vt-tt-076` (5.0M).
- 12 collected videos were left out and their frames deleted: income or dropshipping pitches (`vt-tt-077`, `084`), a
  slideshow with children as the subject and an unrelated caption (`083`), a conference clip that does not match its caption
  (`051`), a heartbreak song clip (`055`), and 7 near-duplicates or weak Nairobi rows trimmed to hold the 100 (`087`,
  `090`, `099`, `104`, `107`, `108`, `112`).
- Watch out for: `vt-tt-032` (only 872 views on a 4-follower account, kept as the cleanest numbered rental tour),
  `vt-tt-020` (a 5-follower account, 3.9K views), `vt-tt-041` (viewers are other small sellers, not buyers), `vt-tt-078`
  (hashtag-spam caption, kept for the demo), `vt-tt-056`, `057` and `062` (three clips of one shop's routine). They are
  marked in `notes`.

## What the 100 have in common

1. **A person or a hand holds the product, and the first frame already shows the thing.** Hands holding phones, shirts,
   perfume trays, a seller fanning out coloured iPhones, a model turning on a plain wall: studio shots and logo cards are
   rare. 14 openings are a result (a finished style, a worn outfit) and 7 are a demo.
2. **Short wins, but a calm tour can go long.** The median video is 17.5 s; 40 are 15 s or shorter and 80 are 30 s or
   shorter. The tightest hits are 5 to 6 s loops (`vt-tt-059`, 5 s, 899K views; `vt-tt-095`, 6 s, 2.9M views). A few
   restaurants and rentals hold viewers for 40 to 59 s with one walk-through (`vt-tt-032`, `033`, `106`, `111`).
3. **Text is on screen in 65 of 100.** Short lines of 3 to 10 words, white with a dark outline or in a white rounded box,
   fixed top or bottom for the whole clip: a price, a phone strip, "POV:", a location pin, a ticked list.
4. **The cut rate is about 4 per 10 s** (median). Talking sellers and skits cut 0 to 2 times, product parades 5 to 8.
5. **Before and after, offers, product reveals and tours are 66 of 100** (before/after 20, offer 19, reveal 15, tour 12).
   List (7), tutorial (6), skit (6) and kinetic typography (5) follow.
6. **Price and place are the questions.** Among the 43 rows with comments read, 24 have a price question ("How much",
   "Angahe", "bei") and 32 a buying question (price, location, number, "is it available", delivery). Only 34 of 100 videos
   show a price themselves.
7. **Most of the sound is the account's own.** 88 rows use an "original sound" (the shop's own audio or a reused clip);
   only 12 name a licensed or reused track (Afro soul, Brazilian funk, P-Square, Charli xcx). Sellers do not depend on
   a trending song; the picture and the price carry it.
8. **Local language shows up in text more than in captions.** Of 82 East African videos, 70 captions are English, 8 are
   Swahili, 3 Kinyarwanda and 1 Somali; the comments underneath are often Kinyarwanda, Luganda or Sheng.

## East Africa against global

| | East Africa (82) | Global (18) |
| --- | --- | --- |
| Typical video | owner, saleswoman, stylist or model in a real shop or salon, one steady shot | creator, brand or tutorial: a trick, a joke, a satisfying demo |
| Median length | 19 s | 13 s |
| Median views | 226K (18x followers) | 1.2M (60x) |
| Price in the video | 34 of 82 | 0 of 18 |
| Phone or WhatsApp on screen | 32 of 82 | 4 of 18 |
| Location shown | 70 of 82 | 4 of 18 |
| Sectors | fashion 27, restaurant 16, salon 13, phone shop 12, shop 10, real estate 2 | shop 8, services and tutorials 8 |
| What drives reach | a value-shock price, the finished look, an address, a funny staff skit | one effect that people copy, a joke about selling, an ASMR unboxing |
| Where it ends | a number or address strip that never left | "follow for more", a comment keyword or a link in bio |

The Kampala and Nairobi shops are the strongest East African models for BuPulse: floor and shop number in a fixed strip,
tier prices (`vt-tt-088`), a bundle stacked on the counter (`vt-tt-049`) and a deposit-plus-daily phone offer
(`vt-tt-095`).

## The 10 best examples for BuPulse (by id)

1. **vt-tt-049** (Treasure Kukyala/Kwanjula, UG, 396K views, 2.9K shares, 3.6K saves): "End of month package @200,000"
   with every item listed on the left while the real goods are stacked on the counter in that order.
2. **vt-tt-029** (Simbi Shop, RW, 149K views, 1.5K saves): a text block (item and price, promotion, WhatsApp number) top
   left, a white "8k" tag on the product, colours shown one after another. Comments: "are you sure it's 8k?".
3. **vt-tt-106** (Unknown Barber, KE, 20.8M views, 25.7K comments): a masked barber, a crying client, a big chop and a
   blonde reveal in 59 s. The emotional arc is the format.
4. **vt-tt-095** (Watu Credit, KE, 2.9M views, 6 s): "Deposit 1,900, Daily 60ksh" in a box over a rotating phone with
   the number pinned. A financing offer in one frame.
5. **vt-tt-088** (Eastleigh Wholesalers, KE, 573K views): "3pcs ksh 650, 10pcs ksh 4,500" and two numbers in one white
   box over a try-on of printed sets.
6. **vt-tt-098** (Tryana Nails Spa, KE, 422K views, 88x followers): two fixed boxes, a price (Gel 300, Tips + Gel from 400)
   and a perk (free refreshments and WiFi), over a walk through the spa.
7. **vt-tt-005** (Tiana Store, RW, 95K views, 24x followers): a presenter holding two iPhone boxes in an orange-lit
   shop, both prices and the shop number fixed in frame, comments about instalments and swaps.
8. **vt-tt-013** (Wendys, RW, 226K views, 2.1K shares): a giant 16K platter with "We do delivery, Call" fixed on top; the
   price is argued about in the comments.
9. **vt-tt-032** (Nshuti Real Estate, RW): FOR RENT, agency, phone and "1M RWF / MONTH" in the corners of every frame,
   numbered rooms 01/05 to 05/05 and a white contact card at the end: the template for BuPulse's real-estate engine.
10. **vt-tt-046** (UK Online Shop, UG, 526K views, 1.6K comments): a recurring-character bargaining skit set in the shop,
    with the shop sign visible in every frame and a laughing meme cut at the end.

Also worth studying: **vt-tt-076** (a paper sheet and a remote reveal "NEW PRODUCT ... 05-07-24", 5.0M views, 95K saves),
**vt-tt-072** and **vt-tt-073** (cheap product-display and hand-swipe reveal tutorials), **vt-tt-044** (a staff
ringtone skit, 275K views), **vt-tt-059** (a 5 s dress loop, 899K views) and **vt-tt-003** (word-by-word Kinyarwanda
captions over a stamp demo).

## Eight rules for BuPulse's engines

1. **Put a fixed price box on screen from the first frame to the last**, and a "was/now" or tier line for offers.
   Only 34 of 100 videos show a price, yet the commonest comment is "how much" (24 of the 43 videos with comments read).
   If the owner will not show a price, use a "DM for price" box with the WhatsApp number.
2. **Pin the phone or WhatsApp as a small strip for the whole clip, with the address as floor and shop number** (the
   Nairobi and Kampala shops give building, floor and shop: `vt-tt-091`, `037`, `034`). Viewers answer with "location".
3. **One item per cut, each with its own price tag** (`vt-tt-002`, `050`, `005`): the cleanest catalogue video BuPulse
   can build from product photos or a phone clip. For many items at one price, hold one price label fixed.
4. **Build offer stacks as text, not just a number**: bundle lists with a stacked counter (`vt-tt-049`), tier prices
   (`vt-tt-088`), deposit plus daily payment (`vt-tt-095`), a price plus a perk (`vt-tt-098`), a checklist of free extras
   (`vt-tt-097`). Add an "offer stack" template next to "price-banner".
5. **Default length 12 to 20 s for a product and 5 to 8 s for a loop; allow 45 to 60 s only for tours, rentals and one
   story.** End where you started so the loop is invisible (`vt-tt-059`, `095`).
6. **Open on a person, a hand or the finished result in the first 2 seconds**, then a place label ("Hidden gem in CBD,
   Moi Avenue", "TUKO KARIAKOO", "Kicukiro, Kagarama") top or bottom left. Keep logo and name cards for the last 3 seconds.
7. **Offer skit, POV and "relatable seller" templates.** `vt-tt-022`, `044`, `046`, `048`, `067`, `070` and `065` got
   large reach with one shop as the stage, two or three staff, a two-line setup and a payoff. Make a shop-sign-in-every-frame
   skit template and a "grand opening ribbon" and "my small business got N orders" hook.
8. **Subtitle in the owner's language, one short line or word at a time, and write the caption as the sales sheet**:
   price, floor and shop, hours, delivery, instalments ("lipa pole pole"), one keyword to comment (`vt-tt-003`, `100`,
   `081`). Swahili and Kinyarwanda price words ("bei", "angahe") match what viewers type. The audio was not heard in
   this round, but most hits work muted.
