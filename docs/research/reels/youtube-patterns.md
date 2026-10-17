# YouTube Shorts patterns for the BuPulse video engine

## How reliable this is

- Source: YouTube Shorts, logged out, in the one tab I opened in the shared Chrome. I watched 36 Shorts muted (5 frames over about 12 s each), plus the title, channel, likes, comments and the auto-captions YouTube shows. Nothing was liked, subscribed to, commented on or downloaded. No block, consent wall or login wall appeared.
- All 36 rows in `youtube.jsonl` are `watched: true`, `secondary: false`, `platform: "youtube"`. The row's `query` field says which search found it.
- Searches run (each with the word "shorts" added): "small business ad", "product ad", "Kigali", "Rwanda business", "Nairobi shop", "3D product animation", "motion graphics ad", "restaurant promo", "phone shop". I used the search results, not the personalised Shorts feed, because the logged-out feed is generic.
- Shorts show likes and comments but no view count or date to a logged-out visitor. Where YouTube showed "Like" with no number, the field is `null`. `views`, `shares` and `posted` are `null` on every row. Sound was off, so voice and music are "unknown" or "not heard" unless captions showed it.
- 36 rows: 11 motion graphics, 7 product reveal, 7 tour, 5 tutorial, 3 skit/UGC, 1 offer, 2 other. Kigali, Nairobi and "Rwanda business" searches returned mostly city and travel videos, not ads. Real local marketing Shorts are rare: only 1 Kigali video (a WhatsApp lead offer), 2 Nairobi shop videos (a thrift shop and a market walk), and no East African restaurant or phone-shop ad. The best evidence for local ads stays on Facebook.

## What Shorts do differently

**Length.** Median 15 s, range 8 to 51 s; 23 of 36 are 15 s or shorter. The most-liked rows (Fanta motion ad 32K, Blender soda can 27K, Dior Blender 9.3K) are 10 s. A Short is one idea and ends. Facebook ads in Rwanda have a median of 34 s.

**Titles.** The title is part of the hook and carries the promise or number, not a brand line: "Build $10k website in 60 Seconds Using AI", "5 reasons to invest in Rwanda", "I put $1,000,000 USD into Commercial property in Rwanda", "MAKING PRODUCT ADS IN BLENDER - DAY 8". Series ("DAY 8") and "How I..." forms recur. Phone numbers appear in the title in local shop Shorts ("Nairobi Thrift shop(0757233779)"). Hashtags (#shorts, #kigali_250) sit at the end; the pile-of-hashtags habit is common in low-view videos.

**Hooks.** Three kinds:
1. A visual that works in frame 0 with no sound: macro product (perfume, face wash tubes), dough tossed in the air, a can with a splash.
2. A text promise in the first second: "Copy his business link", "Turn product into ads", "1. RWANDA".
3. A relatable joke: "I'm a small business owner but I'm also a..." with job titles popping around her face.

**Text on screen.**
- Big centred words, one phrase per cut, in yellow or white with a black outline. Keyword highlight in a second colour (cyan "Kigali", orange "wake up").
- YouTube adds its own auto-captions at the top of the frame. Designers leave the top clear or avoid duplicating them; one Short (the wok video) doubles them and looks cluttered.
- The bottom third is covered by the channel name, title and Subscribe button (clearly visible in 4 frames), so critical text, prices and phone numbers belong in the middle, not at the bottom.

**Subscribe and CTA habits.** None of the 36 rows has a spoken or written "subscribe". YouTube draws its own Subscribe button next to the channel name. The CTAs are: a QR code and "Contact us today" (Blender service reel, 27K likes), a "CONTACT US" end card (kinetic type service), a URL spoken in the steps ("Go to build-sites.com"), "ORDER NOW" as a graphic button in a menu loop, and a phone number in the title or overlay (local shops). Shorts have no clickable ad button, so the ad is a pointer: a number, a QR, a name to search.

**Looks and cuts.** Two worlds:
- Craft showreels (3D product, After Effects, AI cinematic): 3 to 5 cuts per 10 s, no voice, no text or one label, macro push-ins, one hero shot at the end. These collect the likes (5K to 32K).
- Shop and street footage (phone shops, market, thrift shop): handheld pans, 3 to 4 cuts per 10 s, almost never any price, and low to mid likes (4 to 2.9K).

**What the Rwandan and Kenyan Shorts show.** Kigali city clips with skyline drone shots get 1.2K to 9.8K likes with no text. A woman golfer with a "Kigali" title got 8.6K, so people in frame beat buildings. The one lead-generation Short (a man with a MoMo SMS screenshot showing 1,200,000 RWF and a giant WhatsApp number) is the pattern of income-proof plus WhatsApp. It is also the pattern of scams, so the engine should not offer income claims.

## How this differs from TikTok and Facebook

- vs TikTok: Shorts lean on the title and search (people type "3D product animation"), so the title and first on-screen word must name the thing. TikTok leans on sound and trend. Many Shorts are TikTok reposts (the fitting-room Short still carries the TikTok watermark).
- vs Facebook ads: no price banner or phone bar by default; a Short that sells uses the title and one end card. Facebook ads are longer and carry the offer from frame 0.
- Craft matters more here: motion-graphics and 3D looks win likes, local shop videos do not. This is the clearest opening for the Claude motion engine.

## 10 rules for the engine (Shorts output)

1. Default to 10 to 15 s for a Short. Offer 20 to 30 s only for a three-to-five-step list or a walkthrough.
2. Generate a title with the promise or number, plus a series tag option ("Day 12", "New stock Sunday"). Keep the first 40 characters meaningful, because that is what shows in search.
3. Open on the best visual in frame 0: a macro of the product, the splash, the reveal. Never open on a logo card (only motion-graphics service Shorts do, and they get fewer likes).
4. Put the first word on screen at 0.0 s: one short phrase, large, centred, with one highlight colour for the key word.
5. Keep all text inside the safe middle: leave the top 10 percent for YouTube auto-captions and the bottom 25 percent for the title, channel and Subscribe button. Prices and phone numbers go at about 40 to 60 percent height.
6. Show the product in three beats of 2 to 3 s: macro, in-use or splash, hero with the name. Add a wipe or morph between beats (the Fanta and L'Oreal pattern).
7. End with a one-line pointer: a short phone number, "WhatsApp [number]", a QR code, or the shop name to search. Do not write "subscribe": the platform draws it.
8. Do not let an AI image generator write the product label or the price (the coconut-water and menu Shorts show garbled words). Draw labels and prices as engine text over the picture.
9. Make the 3D "look" a selectable style: macro push-in, floating hero, explode and reassemble (the phone disassembly), clay-to-final render reveal (27K likes). These match what `draw3d.ts` and the Blender pipeline can offer.
10. Reuse the same asset for Facebook and TikTok: render 9:16 once, then make a Facebook version with a price pill at the top and the phone bar, and a Shorts version with the title and end pointer. Test two titles per product.

## 5 shot lists

**1. Macro product hero (10 s, cosmetics, perfume, drinks, gadgets)**
- 0-3 s: extreme macro of the label or the dropper, slow push-in, a one-word text ("NEW").
- 3-6 s: the product tilts, the cap lifts or a splash hits; a soft whoosh on the cut.
- 6-9 s: hero shot on a coloured backdrop that matches the label; name and price in the middle.
- 9-10 s: shop name or number and "WhatsApp" line.

**2. Menu-card loop (12 s, restaurants, bakeries, pizza)**
- 0-3 s: card with "ORDER NOW" button and dish one with name and price.
- 3-6 s: slide to dish two, same layout. 6-9 s: dish three.
- 9-12 s: logo and the number; loop back to dish one.

**3. Three-step routine (15 s, salons, skincare, cleaning)**
- 0-3 s: "STEP 1" with the product on a coloured circle.
- 3-6 s: step two. 6-9 s: step three. Each step is one verb ("CLEANSE", "TREAT", "NOURISH").
- 9-12 s: result close-up (skin, hair, shine).
- 12-15 s: shop name, address with landmark, number.

**4. Explode and reassemble (15 s, phones, electronics, tools)**
- 0-3 s: the whole product floats on a dark floor glow, model name on screen.
- 3-8 s: parts fly apart (screen, camera, battery), each with a two-word label.
- 8-12 s: parts return and lock; a "what is inside" line.
- 12-15 s: price, warranty, number.

**5. Store walk then sign (15 s, phone shop, boutique, market stall)**
- 0-3 s: hand opens the door, text with the shop name and the area.
- 3-12 s: four pans (counter, wall of stock, a hot item, a customer), 2 to 3 s each, a one-word label each.
- 12-15 s: the lit sign at night, number and landmark in the middle of the frame.
