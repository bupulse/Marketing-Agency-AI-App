# TikTok patterns for the BuPulse video engine

Two parts. **A** is first-hand: I watched 67 videos in the owner's logged-in TikTok (notes and links only, no likes, follows, comments or downloads, about 7 s each). **B** is from public articles that I only read.

## How reliable A is

- 67 rows in `tiktok.jsonl` have `secondary: false`, `watched: true`: 13 from the For You feed, 18 from the searches "small business ad", "product video ad" and "UGC ad", and 36 from "Kigali business", "Rwanda business ad", "restaurant promo", "phone shop", "salon before and after" and "real estate tour".
- I watched about 7 s of each and looked at three frames (about 0.8 s, 3 s, 6 s). So cuts per 10 s are estimates, the hook and on-screen text are what appeared in those frames, and the audio was muted (I could not hear music or voice). `music_mood` and `voice` are what I could infer from the picture, and most are "not clear".
- Likes, comments, saves and shares are as TikTok showed them, and the sample is small. The For You feed was mostly entertainment (lyrics, football, skits), so I used it for hook and format ideas, not for marketing rules.
- No challenge or block appeared in the logged-in session. Some pages loaded slowly; I waited longer and did not retry in a loop.

## A. What I saw

**The Rwandan and East African business ads (17 shop, restaurant and phone-shop ads):**
- 11 of 17 show the price, the offer or a phone number in the first 3 seconds. Examples: a Kigali skincare vendor ("POV: You just found the most affordable skincare vendor in Kigali" plus "15% OFF regular prices + FREE DELIVERY in KGL."), a bedding shop (a card with "PRICE 28K", a phone number and "LOCATION: DOWNTOWN S-82"), a phone shop (the phone number on top for the whole clip), a phone price list of iPhone 11 to 14 Pro Max in one frame.
- Restaurant ads in Kigali use an offer badge in frame 1: "BUY 1 GET 1 FREE", "Buy one pizza. Get one FREE. Every Tuesday", "YOU GET ONE FREE EVERY TUESDAY", "Lunch Time Promo ... 130 includes flavored iced tea". A real person eating is the common shot. The call to action names the route: "Order on VubaVuba" or "Call us: +250 791 448 670".
- Phone shops show the real shop behind the seller (shelves, boxes), then animate spec words in as they speak ("One SIM + eSIM", "Cover, Screen protector + charger", "MAIN AND ULTRA CAMERA 50.3MP").
- Language is mixed: English on screen for products and prices, Kinyarwanda for business-idea and "for sale" posts ("Iragurishwa 4M ... Imari ntigucike", "Business wakora uyu munsi", "Muze twikorere business").
- Most are 13-25 s. The most-liked Rwandan phone-shop video is a phone shop's 13 s offer clip (67.8K likes) with a staff-at-the-counter scene and a "Drop 40% or 60%" caption.
- Production is phone-handheld or static selfie in the real shop. Polished ones (Wings n More by a visuals studio, The Bistro Group, Biko Group) use styled top-down food shots and a short text overlay.
- Some sellers use AI "income proof" clips with an M-Money SMS overlay and a WhatsApp number (labelled AI-generated). This is a questionable claim format. The engine should not copy it.

**Hooks I saw repeat (all 67):**
1. A question or direct address as large first-frame text: "Urgent order?", "Bulk orders?", "Why keep watching others upgrade?", "ese wakwitwika kubera urukundo?".
2. POV text with a place and a benefit: "POV: You just found the most affordable skincare vendor in Kigali".
3. A promise text with "Wait for it..." or "Wait for the end results..." over a before/after (salons).
4. A finished result first, then the recipe (AI ad creators: burger ad, Red Bull UGC, cinematic drink cans).
5. A whip pan or fast move into the scene (real-estate tours).
6. "How to make this", "How to create 100 UGC ads using Claude" (a title that states the result).
7. Cards in hand ("THE RUMORS ARE TRUE!") as a trend template for a promo.

**Pacing and length:** (estimates from three frames)
- Product, price and phone clips: 15-25 s with a new shot or text change every 2-4 s (about 3-5 cuts per 10 s).
- Offer and menu clips: 15-21 s, about 3-4 cuts per 10 s.
- Talking-head tips: 1-2 cuts per 10 s but word-by-word captions keep movement.
- Before/after: 14-20 s, about 3-4 cuts per 10 s; the "after" frame first in several (Red Heaven, Beeuaesthetics, Fendynco).
- Real-estate tours: 16-60 s; the highest-liked ones (427K and 432K likes) are 61-274 s, the top tour is a gimbal walk-through at dusk with the title carrying the price.
- Entertainment feed clips: 7-24 s; a 6 s clip had 305K likes and 59.9K shares.

**Text on screen:**
- Big and centred or at the top, white bold with an outline, often one phrase at a time. Word-by-word subtitles on talking heads.
- Price cards are solid boxes. Phone numbers are orange or white and stay on screen for the whole clip.
- Offers sit in a badge or as a bottom-third card.
- The app's own UI (the platform's username and caption) covers the bottom 15%, so the CTA is placed in the middle.

**Captions (verbatim formulas):**
- Offer first, then how to order: "Wednesday Promotion 🍔Buy One Burger, Get One Free!", "Buy one pizza. Get one FREE. Every Tuesday at Cave Coffee 🍕Save this so you don't forget".
- Price list in the caption for fashion: "📍Vintage shirt: 14,000 📍Greg shirt: 25,000".
- A route to order: "Send a dm on ig to place an order.", "Book your appointment WhatsApp ...", "DM now before stock ends".
- Hashtags are local (#kigalitiktok, #rwandatiktok, #KigaliBusiness) plus #fyp.

**Sound and audio:** I watched muted, so I could not judge music. The sound labels were mostly "original sound", trending sounds, or none. The For You top clips used trending sounds with a beat-timed transition (outfit change).

**Native, not polished:** the best-performing marketing clips in the sample were low-fi: a phone salesman in a shop, a woman eating a burger, a price list on a phone case. The AI-labelled cinematic product clips (Pixury, Dior perfume 3D, McDonald's-style burger) look premium but had 3-7K likes. Real shops with real people got more local engagement.

## 10 rules the engine should follow (from what I saw)

1. Put the price, the offer or the phone number on screen in the first 3 seconds (11 of 17 Rwandan ads do).
2. Make the first caption a question or a POV line in plain words ("Urgent order?", "POV: you just found ...").
3. Show a real person and a real place (the shop shelf, the table, the counter) behind every product. Do not use a blank studio.
4. Keep 15-25 s, a new shot or text change every 2-4 s. Use one idea per clip.
5. Use a price card or price list as a solid box that stays up; keep phone numbers on screen to the end.
6. End with one way to order, named: "Order on [app]", "Call [number]", "WhatsApp [number]", "DM now before stock ends". Put it in the middle of the frame, not the bottom 15%.
7. Show the result first for before/after ("After" or "Wait for it..."), then the process, then the offer.
8. Animate spec words in as they are spoken (one phrase at a time, white bold with an outline).
9. Match the language of the audience: English for products and prices, Kinyarwanda for the hook and the invitation; always burn in captions.
10. Run a weekly recurring offer as a series (Wednesday buy-one-get-one, Tuesday free burger, lunch promo Monday-Friday) with the same badge each week.

## 5 template ideas with shot lists (Rwanda first)

**1. Weekly offer badge (15-20 s, restaurant or cafe)**
- 0-2 s: top-down table, badge "BUY 1 GET 1 FREE" and the day.
- 2-6 s: a person bites in, close-up of food.
- 6-12 s: second dish, name label near the dish, price.
- 12-17 s: venue shot.
- 17-20 s: "Order on [app]" or "Call [number]".

**2. Phone shop spec talk (20 s)**
- 0-2 s: seller holds the phone in the shop, phone number on top.
- 2-12 s: three spec words animated in as he speaks.
- 12-17 s: price card (RWF) and "accessories included".
- 17-20 s: "DM now before stock ends" plus number.

**3. Price list in one frame (8-15 s, shops, spare parts, fashion)**
- 0-1 s: product in hand.
- 1-12 s: full price list as a card, number at the bottom.
- 12-15 s: "Call/WhatsApp".

**4. POV local vendor (15-20 s, any shop)**
- 0-2 s: "POV: You just found the most affordable [product] in [Kigali]" plus the shop front.
- 2-10 s: three quick shelf pans and one hand-held product close-up.
- 10-16 s: "15% OFF + FREE DELIVERY in KGL." as a bottom card.
- 16-20 s: contact line.

**5. Before and after (14-20 s, salon, barber, cleaning, renovation)**
- 0-2 s: the "after" frame with "Wait for it...".
- 2-4 s: the "before".
- 4-12 s: three process cuts or a time-lapse.
- 12-16 s: the final hold plus the service and price.
- 16-20 s: "Book: WhatsApp [number]".

## A2. Motion graphics and 3D (26 more watched videos)

From the searches "3D product animation", "motion graphics ad", "product reveal animation", "kinetic typography ad", "unboxing", "Nairobi business" and "Kampala business". Same method and limits as A (about 7 s, three frames, muted, so **sound design was not heard**; timing numbers are estimates). Rows are in `tiktok.jsonl` as `q3`.

**What the 3D and motion-graphics clips do:**
- **Floating product plus particles.** The best 3D ads suspend the product in air with ingredients or liquid around it (a serum bottle in a bubble splash, a bottle among coconuts, a cup with milk-tea splashes, bread slices spinning). Depth of field is shallow, the background is simple.
- **Three-beat reveal.** Detail or macro (a gold cap, rim light) then the product in a set (columns, a mossy island on water) then the logo as a clean card. A 17 s and 24 s example both end on the brand name in wide-spaced capitals.
- **Giant text behind or through the product.** "BLURE", "BREAD", "FRUIT / MILKTEA" are huge, partly hidden behind the product or extruded in 3D. They are cut by the frame edge and swap colour with each flavour or colour beat (green, pink, orange; blueberry blue, pomegranate red).
- **Colour themes per beat.** The commissioned drink ad changes colour about once a second.
- **Kinetic typography.** One phrase per beat, 2-4 words at a time, with one key word in a highlight colour (red on white, purple on white, white and blue on dark navy). Words pop in with overshoot, slide in with motion blur, or "stomp" on a beat between black frames. Rows of repeated words ("MINDSET" stack, slanted "EMPIRE" stripes) fill the frame.
- **UI motion.** Smooth push-in zooms between phone screens (745.2K likes for a student UI animation).
- **How-to wrapper.** Many AI-ad clips show the prompt first ("Cinematic 3D action-packed advertisement for ...") then the output, and ask people to comment a word ("Comment: PROMPT"). Three-step recipes ("Upload a photo", "the prompt", "the style you want") are captioned in time with speech.
- **Length and cuts:** 13-31 s for finished ads. The fastest are about 8-10 cuts per 10 s (colour changes and word beats), the premium 3D ones about 3-5.
- **Light versus dark:** Light backgrounds go with bright flavour colours and fast beats; dark backgrounds with premium perfume and skincare and slow orbits.
- **Unboxing (4 videos):** Top-down or handheld hands only, no voice needed. The colour or the reveal of the item is the reward (a pink MacBook got 1.1M likes). A Kampala shop shows boxes of new stock arriving (5.5K likes).

**What the Nairobi and Kampala business clips do:**
- Price on every product shot. A hand holds each item with a white or outlined label ("150/=", "160/=", "KSH 35", "Glow oil 1litre 85,000"), a new product about every 2 s.
- A phone number stays on screen for the whole clip, in a serif or outlined font ("0761 487 464", "+256708735746 Retail and wholesale").
- A real shop is the proof: wall of stock, customers, a worker packing. A caption states the offer at 0 s ("Start your cosmetics business with us", "POV: Kenyan brands are stepping into global markets with our packaging").
- Wholesale and "start your business" are common hooks; stock and price matter more than polish.
- Uganda: bilingual subtitles (English and Luganda) in a numbered series ("Step-by-Step Series").
- Likes are 2K-30K for these, and 59K-745K for the pure visuals or trend formats.

**5 rules for the engine from the motion-graphics and 3D clips:**
1. **Float the product, add particles.** For a 3D look, put the product in the middle with 4-8 floating ingredients, splashes or bubbles around it. Keep the background to one colour or a simple set, with shallow depth of field.
2. **Use a three-beat reveal.** Beat 1 (0-2 s) macro or detail with a rim light. Beat 2 (2-5 s) the full product in a themed set with a slow orbit or push-in. Beat 3 (last 2-3 s) the brand or price card on a clean background.
3. **Make giant text part of the scene.** Put the product name or the flavour/colour word huge, behind or beside the product, cut by the frame edge and swapped per beat (colour theme per beat; up to one change per second for drink and snack ads).
4. **Animate text on the beat.** One phrase per beat, 2-4 words, one highlighted key word, pop-in with overshoot or a slide with motion blur; hold each card about 0.5-1.5 s. Use a locked camera for text clips and a moving camera for products.
5. **Put the price and contact into the motion too.** In East African business clips the price label rides on each product and the phone number never leaves the frame. A motion-graphics ad for a Rwandan shop should do the same: price tag animates onto each product shot and the number sits in a fixed lower-middle band to the end.

Not verified: the audio. Sound design (whooshes on text, hits on reveals, music tempo) should be checked unmuted by the owner or in a follow-up pass.

## B. Patterns from public sources (read, not watched)

These come from 46 rows (`secondary: true`, `watched: false`) built from articles and case studies written before I had a logged-in session. Many numbers are brand or agency claims and some sources conflict (best length is given as 9-15 s, 15-25 s and a 39 s median), so treat them as ranges.

Recurring patterns

**Hooks that repeat** (Influee, Zeely, Segwise):
- Frustration or plain-speech problem: "Nobody warns you how annoying juicers are to clean."
- Comment reply: "Replying to @user ..." (The Farmer's Dog).
- Discovery or POV: "I found jeans that don't gap", "POV: ...".
- Demo first: "Watch this stain lift in 8 seconds."
- Bold or shocking claim that is visibly true: "I found my long-lost cousins in Dubai."
- Before/after, shown as the result first.
- Offer in the first line: "50% off brand-new books", "half off weekdays".
- Visual-only hooks that work with no sound: the cheese pull, the product reveal, the swatch.

**Pacing numbers** (secondary, not measured by me):
- Hook inside 3 s. Japan 1-2 s.
- First caption at 0.0 s. About 5 words. Voice-over starts by 0.5 s. First cut by 1.5 s. Product proof by 3 s.
- A cut every 2-3 s.
- Structure: hook 0-3 s, context 3-7 s, reveal or demo 8-20 s, proof 20-25 s, CTA at the end.
- Top-ad retention: about 100% to 75-85% at 1 s, 50-60% at 3 s, 40-50% at 6 s, 25-35% at 15 s. A hook that keeps 55%+ at 3 s is strong.
- Length: top CTR ads cluster at 15-25 s. Under 10 s works for one-idea product clips (Baby Brezza and Tyson ads, about 6 s). Past 40 s, retention drops sharply.
- The CTA goes last 3-5 s, or at 75-80% of the video.

**Text on screen:**
- Large, centred, animated. Not bottom subtitles, because the platform UI covers them in 9:16.
- Put the first caption on screen at 0.0 s.
- 63% of top ads use text in the first frame (source claim).
- Most viewers watch muted. Captions are needed even when someone speaks.

**Caption and offer formulas:**
- Discount code or link in the caption or bio ("60% off link in bio", "code in caption").
- A reply-to-comment opener.
- A one-line offer headline.

**Sounds:**
- Native, trending audio and original jingles (Binley Mega Chippy) carry reach.
- In Brazil, music beats voice-over.
- Rare Beauty used a text-to-speech voice over UGC.
- No specific sound titles were readable from sources.

**What East African business videos do differently** (only three Kenyan sources, no Rwandan videos found):
- Local service and food sellers (a Nairobi dreadlocks salon, a home caterer) win with daily or twice-weekly posting, not polished ads.
- They show the real work (styles, meals) and answer comments.
- Customers arrive through DMs or visits, not shop links. The owners say "most clients are from TikTok".
- Honest behind-the-scenes stories get both views and brand deals.
- In Kigali, local brands pay creators for a one-minute promo or a live session. A video engine can fill that gap.

### B rules from the public sources (10)

(The first-hand rules in section A win where they disagree.)

1. State the value, offer or result in the first 3 seconds. The first frame must make sense with no sound.
2. Put a large caption (about 5 words) on screen at 0.0 s. Put it in the upper-middle, not the bottom.
3. Cut or change the picture every 2-3 seconds (about 3-5 cuts per 10 s).
4. Default length is 15-20 s for offers and demos. Use 6-9 s for a single-idea product clip. Never go over 30 s without a reason.
5. Show the product or result working before any persuasion (demo or after-first).
6. Use plain, person-style language in the hook ("I found...", "Nobody tells you...", "Replying to..."), not brand slogans.
7. Show proof in the middle: a real customer, a real number, a before/after or a screen. One value point per video.
8. Put the offer and price in text as large overlay, and repeat it in the CTA ("Order on WhatsApp/MoMo ...", "DM to book").
9. Always burn in captions, and start any voice-over by 0.5 s. Keep music secondary to the voice and add a sound effect on each reveal.
10. Make a series, not one-offs (weekly "new stock Sunday", "client of the week"). Use a recurring sound and format, and let the engine make 3 hook variants per product.

### B template ideas from the public sources (5)

**1. New stock reveal (15 s, shop or phone seller, boutique)**
- 0-1 s: close-up of the covered box or product, text "NEW IN" plus a price.
- 1-3 s: reveal (cover pulled away), one sound effect.
- 3-9 s: 3 quick angles or colours, 2 s each, with one short feature caption each.
- 9-13 s: price and "only N left" overlay.
- 13-15 s: CTA "Order now: WhatsApp / MoMo" with the number big.

**2. Problem, then fix (20 s, salon, repair, service)**
- 0-3 s: the problem on screen, text "Still [pain]?" or a customer's message.
- 3-8 s: the usual bad result or why it happens.
- 8-16 s: the business's fix in 3 steps, each a quick cut with a caption.
- 16-20 s: the result, then CTA and booking number.

**3. Before and after (12 s, salon, cleaning, auto, home)**
- 0-2 s: the "after" shot with text "Wait for the end".
- 2-4 s: the "before" shot.
- 4-9 s: 3 quick process cuts.
- 9-12 s: full "after" hold, offer and CTA.

**4. Comment reply, then show (18 s, any local business)**
- 0-2 s: a comment card on screen ("Is this price real? / Do you deliver?").
- 2-5 s: the owner answers in one line (voice-over or text).
- 5-14 s: proof footage (delivery, receipt, product in use).
- 14-18 s: offer and how to order.

**5. Weekly menu or tour (20 s, restaurant, hotel, real estate)**
- 0-2 s: the best visual (cheese pull, steam, the view), text with the dish or place and the price.
- 2-12 s: 4-5 beats of 2 s each (dish, dish, kitchen, customer reaction, place).
- 12-17 s: the offer of the week or the room features, big caption.
- 17-20 s: CTA with location (Kigali neighbourhood) and phone, and a "part 2 next week" tag.

## C. Round 2: thin sectors (40 more watched rows, `round: 2`)

40 Kigali-area videos, 8 each for salons, fashion, transport/travel, schools and clinics/pharmacies (`sector` field in `tiktok.jsonl`). Same method as A (about 7 s, three frames, muted). No Kenyan or Ugandan rows were needed except one Uganda travel account. I skipped income claims and scams.

- **Salons:** the best ones show the client in front of the salon's logo wall (a pixie cut, boho curls) and put the price in the first frame ("28k only, with extension", "NOW AVAILABLE IN RWANDA.", "36k rwf" in a caption). A printed menu with prices as frame 1 is a strong simple opener. Some are only a room tour with no price or contact (weak).
- **Fashion:** a locked shot with the price tag on the product ("8k") and a phone number in the lower corner, or one mannequin that swaps colour every 1-2 s with "Original complete 0787789066". A "MONDAY ... outfit per day" week format and a street-wear tour with "from 7.5K RWF" and the area ("Kisimenti Remera Behind Eco Bank").
- **Transport and travel:** the car-rental clip puts the price per day in the opening text ("50,000 RWF per day") with three car shots; activity clips put the price on the shot ("7$ FOR 15 MIN"); list videos ("6 THINGS TO DO IN KIGALI", "5 beautiful places") use numbered titles and "save this" as the call to action. A budget in the title ("600k UGX for 3 days") works.
- **Schools:** brand-film style (logo, building, students walking, drone shot of a big campus), a student speaking to camera with subtitles ("so he recommended me to come here"), ranked lists ("Top 9 Best Secondary Schools in Rwanda") and a title card with numbers ("17 SCHOOLS | 52 DEBATES TEAMS"). Enrolment CTA lives in the caption ("The September intake is here, grab your seat now"). Most are 26-47 s; lists and events are 118-266 s.
- **Clinics and pharmacies:** shelf pans (Dove, Strepsils, Aptamil), a lit modern interior, owners explaining ("First Private Pharmacy In Rwanda since 1969 / 6 Branches across Kigali"), a clinic answering the insurance question with a poster ("We work with EDENCARE, SONARWA, and RSSB") and ending on a clean "CONTACT US +250 ..." card. Trust cues (since 1969, insurers, doctor in scrubs) are the hook; prices appear only on shelf tags.

**What these add to the rules in A:**
- Service sectors (clinic, school) lead with trust and numbers, not price; product sectors (fashion, salon, car hire) lead with price.
- A clean contact card in the last 2-3 seconds is used by the clinics and works better than a number in the caption.
- Local words in the CTA ("Karibu", "waduhamagara cg ukatwandikira") sit next to the phone number.

## D. Sounds and voice (30 watched clips)

**Limit:** I watched muted and cannot hear. For each clip I used TikTok's sound label under the caption (when one was shown) and what the picture shows (a visible talker, burned-in text, or neither). "Voice" below means a visible speaker or a voice-over implied by subtitles, not something I heard. Eight clips showed no sound label at all.

| Clip | Sound label shown (kind) | What carries the message |
| --- | --- | --- |
| fyp_5 evana.kz_ (outfit change) | original sound "SHOGUN" (trend sound) | picture and the beat; no text |
| fyp_10 benitarelates (skit) | original sound "Xduppy" | text (the joke is the first-frame sentence) |
| fyp_16 songclubz (lyrics) | original sound "suara asli - ilham" | text (lyric subtitles) |
| q1_8 zana.cosmetics.ng | "sonido original - Brenda Yuridhia Mart" | text ("Using this capcut template...") |
| q2_1 sitony_sniper (Kigali skincare) | original sound "NEMZZZ" | text (POV + offer) |
| q2_3 kigali.business.i (shop for sale) | "son original - WOOD PROMO" | text (Kinyarwanda sentence, price) |
| q2_17 cohvisuals (Wings n More) | original sound "CØHVISUALS" (the studio's own) | picture |
| q2_20 21strepublicphonestore | original sound "zombeans" | picture; offer in the caption |
| q2_21 rujamaphones | Ukrainian creator sound "ріжочек.ua!!" (reused) | text spec cards plus a visible speaker |
| q2_32 americas_realtor | original sound "Lyrics0674" | picture; voice-over probable (61 s) |
| q2_35 chadhomes | original sound (own company) | picture; plain tour |
| q3_15 yajairay10 (unboxing) | original sound "Hillel Barak" | picture and sound; no text |
| q3_16 sheglow_shopug (stock arriving) | "The Wealthy Women Hub" (reused creator audio) | picture |
| q3_17 by.manka_ (unboxing) | "Heaven Baby - Ayra Starr" (Afrobeats track) | music and picture |
| q3_24 pieces_ug (jewellery) | "Nze Ani? - Maurice Kirya" (Ugandan artist) | music and a phone-line text |
| r2_clinic_6 thegrandmtwapahospital | same Ukrainian sound "ріжочек.ua!!" as q2_21 | picture only |
| r2_fashion_5 cinacrafoord (street wear) | "I Get the Bag (feat. Migos) - Gucci Mane" (hip-hop track) | text (location, price) and music |
| r2_fashion_7 u_judy03 | original sound (own) | picture and day labels |
| r2_salon_6 sheane.beauty | "SLICK - Victony" (Afrobeats track) | text ("28k only") and music |
| r2_travel_2 living_in_rwanda_now | original sound "LIVING IN RWANDA" | text names; voice-over probable |
| r2_travel_6 homelandtourstravel | "its plenty - Ken" (music) | text (price per day) |
| r2_travel_8 pearlofafrica.ug | original sound "Player1505" | picture only |
| q2_2 josiane625beddings | no label shown | voice (presenter speaks) plus price card |
| q2_13 darerwanda | no label shown | picture and offer badge; no voice |
| q2_14 biko_group | no label shown | text and picture |
| q2_19 kigaliphones | no label shown | text (phone number) and picture |
| r2_fashion_9 kigali_fashion_hub | no label shown | text (number) and picture |
| r2_school_3 bluelakes.int.sch.rw | no label shown | voice (student) plus subtitles |
| r2_clinic_7 dermaskinclinicrwanda | no label shown | voice plus text and a contact card |
| r2_salon_4 harriet_yusuf | no label shown | voice-over plus word captions |

**Counts (30 clips):**
- Sound kind: 15 original sounds under the creator's name, 5 named music tracks (Afrobeats: Ayra Starr, Victony; Ugandan artist: Maurice Kirya; hip-hop: Gucci Mane; "its plenty" by Ken), 2 reused foreign creator sounds (the same Ukrainian sound on two different Rwandan shops), 8 with no label shown.
- Carrier: text-led 12, voice-led 7, picture or sound only 11.
- Named tracks were used by salon, travel, fashion and unboxing clips; shop and phone ads mostly used original or reused sounds.

**5 rules for the engine's music and voice-over:**
1. **Text first, sound second.** 12 of 30 clips carried the message in on-screen text alone, and the other 11 relied on picture. Never let a clip depend on its audio; build the message in text and picture and add sound under it.
2. **Pick the music kind by sector.** Mid-tempo Afrobeats-style or amapiano-style loops for salon, fashion, travel and unboxing (the named tracks seen were Afrobeats and East African); a harder beat for street wear; quiet, clean ambient for clinics, pharmacies and schools (those clips used picture, calm sound or a speaker).
3. **Voice-over only when a person or a story is needed.** The 7 voice-led clips were a presenter, a student, a doctor or a vlogger, and all had burned-in subtitles. For shop, menu and price clips skip voice-over and use text; where voice is used, keep it to one short line per beat and have it match the on-screen caption.
4. **Make text change land on the beat.** In text-led clips the phrase or price changes every 2-4 s; cut the music loop so a beat falls on each text change and on the product reveal (a sound hit on the reveal is common in 3D and kinetic clips, not verified by ear).
5. **Language by role.** Spoken or hook line in Kinyarwanda for local trust, product, price and contact in English or numerals, and the CTA bilingual ("Karibu", "waduhamagara cg ukatwandikira"). Never use a trending sound just for reach: BuPulse uses its own royalty-free music, so choose the kind (tempo and mood above), not a specific track, and always burn in captions.
