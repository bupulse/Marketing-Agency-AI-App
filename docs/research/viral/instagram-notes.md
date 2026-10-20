# Instagram viral round 1: what the 100 reels taught

Rows are in `instagram.jsonl` (`vt-ig-001` to `vt-ig-118`, 100 kept; ids are never reused, so there are gaps).
Frames (6 to 8 per reel, 540 px wide) are in `video-lab/data/viral/frames/instagram/<id>/` and stay on this Mac.

## How it was collected, and what to trust

- Reels were opened one at a time in one tab of the research Chrome and played through muted, start to finish. Frames
  were taken while the reel played, evenly spread over its whole length (first at 0.5 s). Structure timings in each row
  are read from those frames, so they are good to about 1 to 3 seconds. The audio was never heard: `sound` is the name
  Instagram printed, and `music_mood` says so.
- Plays come from the account's Reels grid, likes, comments and reposts from the reel page. Instagram rounds large
  numbers ("1.3K"), so likes are approximate. Saves and shares are not shown, so they are `null`.
- Mix: 72 East African (61 Rwanda, 6 Tanzania, 3 Uganda, 2 Kenya), 28 global or other.
  Business accounts are 76, creators 16, brands 8.
- Every kept row passes the viral bar in `viral_basis`. East African rows have a median of 104K plays, 31x their
  followers. Global rows have a median of 3.5M plays.
- 18 collected reels were left out and their frames deleted: 4 with children or a teen as the subject (vt-ig-028, 071,
  091, 099), 2 duplicates of a kept reel (040, 116), 1 that is not a business format (109), and 11 weak East African
  rows trimmed to hold the 70/30 mix (009, 010, 012, 013, 015, 016, 030, 061, 068, 069, 076).
- Watch out for: `vt-ig-083` (1.5M plays but 20 likes: the plays may be promoted), `vt-ig-022`, `074`, `075`, `021`
  (clips that look reposted from other creators), `vt-ig-044`, `108` (borrowed meme or film footage). They are marked in
  `notes`.

## What the 100 have in common

1. **A person or a hand holds the product.** Hands holding the item, the owner or a saleswoman standing at the stock,
   or a client seen from behind: that is what most first frames show. Studio shots and logo-first openings are rare.
2. **Short loops win big, long ones hold on in Rwanda.** 27 reels are 15 s or shorter and 55 are 30 s or shorter. The
   biggest hits are 6 to 15 s that end where they start (vt-ig-092 at 6 s, vt-ig-102 at 11 s, vt-ig-057, 068, 114). But
   East African owners also hold viewers for 60 to 180 s with one calm walk-through (vt-ig-018, 056, 070).
3. **Text is on screen in 70 of 100.** Short lines of 3 to 8 words, white on a dark box or with an outline, in the upper
   third or lower third, fixed for the whole reel: price boxes, "was/now", numbered reasons, "POV:" lines, a phone strip.
4. **The cut rate is about 4 per 10 s** (median). Talking owners cut 1 to 2 times, product parades 6 to 9 times.
5. **Before and after, tours and product reveals are 56 of 100** (reveal 21, tour 18, before/after 17). Tutorials (11),
   skits (12) and offers (9) come next.
6. **The caption does the selling.** Price lists (vt-ig-042), spec sheets (vt-ig-118), hours and address, delivery
   terms (vt-ig-058, 059) and "comment STL" promises (vt-ig-105) sit in the caption, not in the video.
7. **The comments show intent.** Price questions ("Angahe", "How much") are among the top comments of 27 of the 100
   reels (26 of them East African); adding "Number plz" and "Ukorerahe / where", 40 reels (35 East African) have buying
   questions. Those are leads the shop can answer in the comments.
8. **Most captions are English even in Rwanda.** Of 72 East African reels, 24 have Kinyarwanda or Swahili captions; the
   rest are English with Kinyarwanda comments underneath.

## East Africa against global

| | East Africa (72) | Global (28) |
| --- | --- | --- |
| Typical reel | owner, saleswoman or stylist in a real shop or salon, one steady shot | creator, brand film, 3D, skit or meme, one tight loop |
| Median length | 34 s | 15 s |
| Median plays | 104K (31x followers) | 3.5M |
| Phone or WhatsApp on screen | 27 of 72 | 4 of 28 |
| Price in the video or caption | 8 of 72 | 3 of 28 |
| Sectors | shop 21, salon 19, fashion 15, restaurant 10, clinic 3, events 2, car rental 2 | salon, phone shops, real estate, 3D creators, brands |
| What drives reach | price curiosity, the finished result, local pride, a funny skit | a joke about selling, a trick people try at once, a satisfying build |
| Where it ends | a number or address strip | a follow button, "comment X" or a link in bio |

The Tanzanian shops (vt-ig-081, 085) are the strongest East African model: a price box on screen for the whole reel.

## The 10 best examples for BuPulse (by id)

1. **vt-ig-085** (Kelvoo Outfits, TZ, 2.5M plays): the price in a white box from frame 0 to the end, a dance that makes the
   dress move, then the matching piece. 1.8K comments are price and delivery questions.
2. **vt-ig-093** (The Crochet House, IN, 3.3M plays): item name and price printed above one item every 2 s. A model for
   the price-on-each hook.
3. **vt-ig-081** (Infinity Store Kariakoo, TZ, 88K plays): "Was 35,000 Now 25,000" in a black box on every slide.
4. **vt-ig-063** (Kigali Clipper Zone, RW, 1M plays, 2.5K comments): a barber, a chair, a fade reveal and a track.
5. **vt-ig-055** (Dilara Collection, RW, 725K plays on 6.2K followers): a six-slide catalogue slideshow with a gold logo and
   a contact card; the template BuPulse can generate from stills.
6. **vt-ig-077** (Linen House Kampala, UG): a fixed label with item, address, phone and price over a parade of items in hand.
7. **vt-ig-033** (Ando, RW, 344K plays): a 60 s POV skit (nothing to cook), the app as the rescue, an app card last.
8. **vt-ig-019** (Rwanda Microlocs, RW, 104K plays): "Three reasons" in large caps with one pink keyword per line, the phone
   number pinned small at the bottom.
9. **vt-ig-087** (Marketing Moves Homes, US): price-first hook ("just under $9.5M"), five numbered favourites, one room per beat.
10. **vt-ig-042** (La Paix Technology, RW, 71K plays): a clean unboxing with a 9-model price list in the caption.

Also worth studying: **vt-ig-092** and **vt-ig-112** (a small seller joking about her stall, 42.6M and 25.8M plays),
**vt-ig-039** (car rental: slogan poster, cars with one-word stickers, a pinned WhatsApp strip) and **vt-ig-098** (a phone
tip with the real settings screen).

## Eight rules for BuPulse's engines

1. **Put a fixed price box on screen from the first frame to the last** (a "price-banner" style, "was/now" for offers).
   Only 11 of 100 reels show a price (in the video or the caption), but the top comments of 26 East African reels ask for it:
   it is the biggest gap.
   If the owner does not want a price on screen, add a "DM for price" box and a WhatsApp button instead.
2. **Pin the phone number or WhatsApp as a small strip, not only on the end card.** The best Rwanda and Algeria reels keep
   it low and fixed for the whole clip (vt-ig-039, 062, 103). Add the address (district and building) in the same strip.
3. **Default length 12 to 20 seconds for a product, and make the last frame the first frame** so the loop is invisible.
   Allow up to 45 s for tours and 60 s for a skit; never longer without a reason.
4. **Open on a person, a hand or a problem word in the first 2 seconds**, not on a logo: the product in a hand, "Razor
   bumps", "POV:", a number, a question. Keep logo cards for the last 3 seconds.
5. **One item every 2 to 4 seconds, with its name and price above it** (vt-ig-093, 077, 083): the cleanest catalogue video
   BuPulse can make from product photos. Reuse the same slide template with a gold or brand-colour logo (vt-ig-055).
6. **Write the caption as a sales sheet**: price list, specs, hours, address, delivery terms, one keyword to comment
   (vt-ig-042, 105, 118). The caption generator should output it with the video.
7. **Offer a "relatable seller" skit and a "POV / me when" template.** These got the largest reach (vt-ig-092, 112, 033,
   108): one shot, a two-line question and answer, a seller or a client. The engine can write these from the owner's sector.
8. **Subtitle everything in the owner's language, short lines, lower third, two colours at most**, and use lower-case
   Kinyarwanda or Swahili price words where the audience uses them ("angahe", "bei"). The audio was not heard in this
   round, but most hits work muted.
