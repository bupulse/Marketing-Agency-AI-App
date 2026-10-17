# Instagram patterns for the BuPulse video engine

## How reliable this is

- I watched 58 reels on the owner's logged-in Instagram, one at a time, in a real Chrome tab. Each got about 7 seconds of muted playback, captured as 4 frames (about 1, 3, 5 and 7 s). Page text gave me the caption, hashtags and counts.
- Everything beyond those 7 seconds (structure over a long video, pacing, ending) is read from the loop, the duration and the caption. Audio was never heard, so "music" is the audio name Instagram printed, or "not noted". Music mood is therefore mostly unknown.
- No likes, follows, comments, saves, shares, messages or downloads. No account settings touched. No block, challenge or "suspicious activity" notice appeared. One search page showed a generic "Something went wrong" once and loaded fine on the next try.
- The numbers Instagram shows are likes, comments and reposts. It does not show views on reels (one reel, `@chefrashid97`, printed "100M" plays). The posted date is not shown, so `posted` is null everywhere.
- The audio name is shown only when it is a licensed or original track in the caption header (11 of 58). For the rest `sound` is null.
- Database: `instagram.jsonl`, 58 rows, `watched: true`, `secondary: false`, same field names as `tiktok.jsonl` plus `found_by` (the search that surfaced it).
- Sample bias: Instagram's own `/reels/` feed is mostly entertainment (comedy, memes, supercars), not marketing, so most rows came from searches. Marketing searches surface many Indian, Gulf and US accounts. East African coverage is thin (7 rows: Kigali 3, Nairobi 3, Dar es Salaam 1). Likes are not comparable between rows: a 4 s meme and a 154 s itinerary are different games.
- Sizes: 37 of 58 are 15 s or shorter (median 13 s); 10 are 15-30 s; 11 are longer than 30 s (up to 154 s).

## Which searches worked

- Worked well: `product video`, `unboxing`, `before and after`, `phone shop`, `real estate`, `salon`, `Nairobi`, `Kigali`, `3D product`, `motion graphics ad`, `small business`, `restaurant`.
- `Rwanda` and `UGC` returned empty result grids. `ad` returned mostly the same reels as other searches.
- Search is a keyword search that returns reels and posts mixed. `#hashtag` URLs were redirected to the same keyword search.
- The home `/reels/` feed gave 4 reels (watched) and a long list of entertainment reels (not logged).

## Recurring hooks (first 2 seconds)

1. **Big claim text at frame 0, no intro.** "This is what $10M just under buys you here" (real estate), "Still paying for AI assistants." (Nairobi computer shop), "you also have a big belly". The text is on screen before any voice.
2. **Price in the first frame.** "$575,000" burned in from 0 s (Dallas agent, 325K likes), "299" next to a marketplace badge (USB juicer), "*199/-" label on a steamer, "150/-" on each keychain (100K likes). In shop and product reels the price is the hook.
3. **Before / After as one word each.** "before..." then "After", on the same camera angle. A single lowercase word, large, in the middle. 255K likes for two images and two words.
4. **POV line + place.** "POV: you're in Kigali, Rwanda... of course you're going to try the famous street food." "POV: when you just started in Real Estate". "POV" plus a specific place or role.
5. **Relatable statement for small sellers.** "when your business is small, EVERY order feels like a win" (118K likes), "I'M A SMALL BIZ OWNER but I'm also a..." (job titles pop in), "girl aren't you embarrassed?" These are not ads. They are the owner talking about the work.
6. **Curiosity gap with an empty frame.** "miss, you forgot something!" over an empty shelf, then the products pop in. Countdown numbers (3, 2) before a venue reveal.
7. **Product already in action at 0 s.** Chopper cutting, steamer on a shirt, red-light device on hair. No unboxing build-up.
8. **Owner in front of the stock.** Phone shop owner talking over a table of boxed iPhones (90.7K likes) or peeling film off a Samsung S22 (52.4K likes).
9. **Comment-keyword promise.** "Comment 'link'", "Comment \"Dallas\"", "Comment FREE". It is in the caption and often on screen.

## Pacing numbers (measured on what I watched)

- Length: median 13 s. 64% of the reels are 15 s or shorter. The two biggest small-business hits (118K and 687K likes) are 6.7 s and 7.6 s.
- Cuts per 10 s (my estimate from 4 frames and loops):
  - Product demos and unboxings: 4-8.
  - Before/after: 2-4 (long holds, a hard cut at the reveal).
  - Talking-head and owner videos: 1-2 (one long take, text changes instead).
  - Motion graphics and 3D: 6-8, cuts on the beat.
  - Tours (real estate, restaurant, shop): 3-4.
- First text on screen at 0.0 s in about 60% of the reels. The rest (ASMR unboxing, pure product macro) have no text at all.
- Looping: many 6-11 s reels end on their first frame, so the loop is invisible.
- Price or offer on screen for the whole clip, not at the end, in shop and fashion reels.
- Talking-head reels over 40 s keep the viewer by changing text every 1-3 words (Grant Cardone, 91 s) or every sentence (50 s fitness coach), not by cutting.

## Text on screen conventions

- Position: upper third or centre. The bottom 20% and the right side are covered by the caption and the buttons, so text avoids them. Exception: a persistent shop name or phone number in the lower-left corner ("Phone Zone Mangalore", "0541 11 24 90") which works because it is small and constant.
- Styles that repeated:
  - **Highlighter boxes** (white or yellow rounded box, black bold text): fitness coach, Nairobi computer shop, seafood boil, car-lot skit.
  - **Word-by-word kinetic captions**, 1-3 words at a time, key words larger or coloured (Grant Cardone, the agent, the wig seller).
  - **One big statement in serif or sans**, held for the whole clip (small business, "miss, you forgot something").
  - **Label + price per item** in small serif at the top (crochet keychains).
- One font family per video. Two colours at most (white plus one accent: yellow, orange, purple).
- Text is short: 3-7 words per line, at most 3 lines.
- Local language is used when the audience is local (Arabic with a phone number, Tamil label with a book-by-DM caption, Spanish, Portuguese).
- Emoji sit at the end of the line, usually a flag, a crying-smile or a laughing face.

## Caption formulas

- **Owner-style CTA with contact in the caption**: "Call or whatsapp" + two numbers + address ("Phone Club Delhi"), "DM to book your appointment" + phone + town (Tirupur salon), "Talk to us 0711 179 871 ... Tom Mboya street, Old Nation House Nairobi" (Nairobi shop). Seven of the 58 reels put a phone number, WhatsApp or DM instruction in the caption (more also give an address or a place tag).
- **Comment keyword**: "Comment 'link' for direct link of the product", "Comment \"Dallas\" ... Text \"Dallas\" to 956...", "Comment FREE to claim free access". The four reels using it show 170, 6.3K, 8.5K and 182K comments; three of them are far above their peers.
- **Price and stock in the caption** (East Africa, fashion): "70,000 TZS ... ORANGE SOLD, available in green ... LIMITED PIECES, SHOP NOW", "KSh 6,000 (Platter for 2)".
- **A question that owners answer**: "Any other small business feel me?", "What else should I add to the list?" Both pull comment counts above 300.
- **Hashtags**: 3-12 at the end, mixed broad (#smallbusiness, #fyp) and local (#kigali, #nairobi, #bathinda). Long keyword dumps exist (tech_faraz) but the biggest hits mostly use few.
- **Credit lines**: "Made with @higgsfield.ai", "AI content" and "AI-generated profile" labels appear on 6 rows. Instagram shows these labels itself on AI videos, so label rules matter for the engine.

## Audio

- Printed audio names are mostly film and regional songs (Bollywood, Tamil, Punjabi) or phonk ("MONTAGEM PEGADORA (Ultra Slowed)", "LET ME DRIVE FUNK (Slowed)") or an Outkast track ("So Fresh, So Clean") matched to a hair-transformation claim.
- ASMR (unboxing, product macro) has no music and no voice.
- Owner/agent talking reels use voice with a light bed or no music.
- I could not read audio for most reels because playback was muted and the page does not print it. The engine should not treat "trending audio" as a measurable input.

## Lengths that worked

- 6-10 s: one idea, hook text, loop (small business statements, keychain catalogue).
- 11-16 s: product demos, transformations, motion-graphics ads.
- 20-50 s: talking tutorials and owner shop tours with word-by-word captions.
- Over 60 s: only with an owner or expert on camera, and only with a strong list or promise (itinerary, "top 5 features").

## What East African business reels do differently

Seven rows (Kigali 3, Nairobi 3, Dar es Salaam 1), so treat as directional.

- **The caption is the sales page.** Price in local currency, stock status ("SOLD", "LIMITED"), location (Kinondoni, Tom Mboya street, Kimihurura KN 14 Av 39), phone or WhatsApp number, delivery line. The video carries almost no text.
- **Real people and real places.** A named street, named restaurant, the owner in a branded shirt, a real car lot with its sign visible. No stock footage.
- **Comedy skits** work in Kenya (car-lot skit about influencers asking for freebies) and insider humour (Kilimani dust, "vumbi").
- **Food and nightlife in neon colour** for Kigali (Nyamirambo barbecue street): hand-held, saturated, a POV hook.
- **Fashion shot on a model in a styled showroom**, bright natural light, hand tie-detail then turn.
- **Service explainers by shop staff** (Nairobi computer shop): staff member to camera, branded shirt, then a screen recording.
- **Weaker craft**: dark openings, no hook text, no price on screen, landscape framing, small subtitles. Most East African rows had under 6K likes. The craft gap is the opportunity: the same content with a hook line, a price tag on screen and a contact line would follow the patterns of the winners from India and the US.
- **Language**: English captions for Kenya, Tanzania and Rwanda, with Swahili and Kinyarwanda mostly absent. Local-language text is a differentiator, as the Tamil and Arabic rows show.

## 10 concrete rules for the engine

1. Put the first text on screen at 0.0 s. It must say the claim, the price or the question, in 3-7 words. Never open with a logo or a fade.
2. Keep every reel 6-16 s by default. Offer 20-45 s only for talking-head or tour templates, and 60 s+ only with an on-camera presenter.
3. Show the price, in local currency (RWF), for the whole clip when the product has one. Use a persistent label in the upper third or a small badge in a corner. Never under 24% of frame height from the bottom.
4. Put all text inside the safe area: no text in the bottom 20% or the right 15%, except a small persistent shop name / phone line.
5. One caption style per video: either highlighter boxes, word-by-word kinetic captions (1-3 words), or one big statement. Max two colours plus white. Emphasise one key word per line by size or colour.
6. Cut by format: 4-8 cuts per 10 s for demos and 3D, 3-4 for tours, 2-4 for before/after, 1-2 for talking heads (change text instead).
7. Before/after templates use the same framing for both halves, a single lowercase label ("before" / "after"), and a hard cut. Hold each half 2-3 s.
8. Always generate the caption with: the offer or price, one line of benefit, the contact (phone, WhatsApp, DM), the place, and a comment-keyword CTA ("Comment PRICE"). Add 3-6 hashtags: 2 broad, 2 local (#kigali, #rwanda), 1-2 niche.
9. Loop the video: end on a frame close to the first so the loop is seamless, and keep under 15 s when possible.
10. Support Kinyarwanda, French, English and Swahili text blocks. Local-language hook text is rare on East African reels and is a clear differentiator. Add an "AI-generated" label when the footage is generated, since Instagram labels these videos itself.

## 5 template ideas with shot lists

All 9:16, text in the top third, price or contact line persistent in the lower-left corner.

**1. Phone shop: "New stock" (13 s)**
- 0.0-1.5 s: black-to-product cut on the newest phone in hand. Hook text: "NEW STOCK: iPhone 15 from 650,000 RWF".
- 1.5-5 s: shelf wall pan (wide), then a hand picks a phone off the counter.
- 5-9 s: three quick close-ups (camera, screen on, box) with one-word labels (Camera / Screen / Warranty).
- 9-12 s: owner to camera or price card with the model list.
- 12-13 s: end card: shop name, address, WhatsApp number. Caption: "Comment PRICE" + number.

**2. Before / after (restaurant, salon, renovation) (8-10 s)**
- 0.0-3 s: "before..." label, locked camera on the old state.
- 3-3.2 s: hard cut.
- 3.2-7 s: "after" label, same framing, finished state; slow push-in.
- 7-9 s: one more angle of the result, price tag ("Haircut 5,000 RWF") and "Book on WhatsApp".

**3. Catalogue reel with prices (12-15 s)** (the 100K-like keychain format)
- 0-1.5 s: title over the collection: "Our bags with their prices".
- Then 5-6 items, 1.5-2 s each: product held in hand or on a shelf, label and price at the top in serif.
- Last 2 s: all items wide, plus the "DM to order" line and the number.

**4. Owner-to-camera offer (20-30 s)**
- 0-2 s: "This is what 100,000 RWF buys you" (stacked hook text, one key word coloured).
- 2-20 s: owner talks beside the stock or location, word-by-word captions in the centre, two b-roll cuts on important products.
- 20-28 s: price list as 3 text boxes appearing one by one.
- Final 2 s: "Comment OFFER" with the contact. This is the talking-head format of the largest phone-shop and real-estate reels.

**5. 3D product spot (8-12 s)**
- 0-1 s: brand colour field with huge condensed word ("NEW").
- 1-4 s: packshot drops in with motion blur and a colour wipe to the second colour.
- 4-8 s: slow dolly macro of the product with floating UI labels (price, benefit), cuts on the beat at 2 s intervals.
- 8-10 s: logo tile and a one-line CTA. This follows the Pringles, Duolingo and Notion motion-graphics rows (77.8K likes on the Duolingo concept) and the Blender watch macro, and needs no footage at all.

## East Africa, first-hand (round 2, accounts visited directly)

### How I got it

- I opened about 45 business accounts' Reels tabs in the owner's logged-in Chrome and got watched reels from 36 of them: 27 in Kigali (phone and laptop shops, salons, spas, nail and wig makers, restaurants and bars, delivery app, real estate, shoes and clothes, jewellery, furniture, clinics, a school, a florist, an events dancer group, a car-rental firm), plus Nairobi (Naivas, Java House, House of Cars, Brimat Computers), Dar es Salaam (Meraki, Royal Cakes) and Kampala (three baby and kids shops). Handles came from the Facebook advertisers in `facebook.jsonl` and from Instagram's own account search ("kigali real estate", "kigali clinic", "kigali school", "kigali events" and so on).
- For each account I read the play count on the reel tiles and watched the top one or two reels (about 7 s each, muted, 4 frames). 43 rows were added to `instagram.jsonl` with `found_by: "account"`, `account`, `account_followers` and the tile play count in `stats_as_reported.views`. Four rows are collab or customer posts by another handle (`collab_post_by`).
- Bias to keep in mind: I chose each account's best reels by plays, so these are the winners, not the average post. The Kigali rows (34) are the base for the numbers below.
- Several candidate accounts had no usable Reels tab or did not exist under the guessed handle (for example a supermarket, a hotel and a clinic from the Facebook list). No notice, challenge or block appeared. For about an hour the machine was so loaded that Instagram's tab stopped responding, which cost time but no data.

### What Kigali businesses post compared with the global reels

| | Global reels (first 58) | Kigali accounts (34) |
| --- | --- | --- |
| Median length | 13 s (64% under 16 s) | 27 s (only 8 of 34 under 21 s; 23 are 21-60 s) |
| First-frame hook line | about 60% have text at 0 s | 13 of 34 have no text on screen at all; the first text is usually a phone number, a brand or a place |
| Phone number on screen | rare | 13 of 34, always from frame 0 and for the whole clip |
| Phone, WhatsApp or DM line in the caption | 7 of 58 | 14 of 34, plus address, delivery and payment terms |
| Price shown on screen | common in the shop and fashion reels from India and the US | 3 of 34 (price sits in the caption, if at all) |
| Language | English, some local | English 29 of 34; Kinyarwanda in 4 (promotion lines, a cream recommendation, a land sale) |
| Typical format | one idea, hook, loop | in-shop walk-through, product held in hand, treatment filmed in one take, template slide plus raw phone footage |
| Editing | 4-8 cuts per 10 s for demos | 1-4 cuts per 10 s, mostly one continuous shot |

Typical categories among the 34: offers 10, product reveals 6, before/after 6, tours 5, UGC 4, tutorials 2.

### What stands out

1. **The phone number is the hook.** On the best shop reels the number is the first thing on screen and stays there (La Paix Technology 161K plays on 751 followers, Home of Hybrid 110K plays on 59 followers, Metro Cosmetics 98.6K plays on 662 followers, Lou Aesthetic EmSculpt 40.9K). Reels with the number on screen had median 58.8K plays against 39.7K without, in this biased sample of top reels, and the gap is the right sign, not proof.
2. **Reach comes from the format, not the follower count.** Median plays are about 21 times the follower count. The top plays-to-followers ratios (59-follower car rental 110K plays, Sera Beauty 513K plays on 2.3K followers, La Paix 161K on 751, Elysian Spa 286K on 4.1K) all come from tiny accounts. Instagram is pushing local product and treatment reels to far more people than the account has.
3. **Likes are low compared with plays.** Median likes-to-plays is about 0.55%. People watch and then WhatsApp or call, they do not like. Success should be measured in messages, not likes.
4. **Services film one satisfying process in one take.** Spa scrub (286K and 88K plays), facial (32K), microlocs hair flip (193K and 171K), nails (5.6K), acne cream "Day 1 / Day 7" (98K and 74K). The treatment is the proof, the booking line is a text strip at the bottom.
5. **Shops use staff or the owner as presenter.** A shop assistant in a branded polo presenting a "summer combo" (250cityshoes: 300K and 227K plays on 42K followers), the seller holding boots (Albatross), the owner at the stock wall (the Indian examples earlier).
6. **Template slides are everywhere.** Photo-card animations with a "VISIT US" button (Elevée Lounge), "RENT A CAR" slides (Home of Hybrid), "Turi kuri Promotion" over a laptop pan (La Paix), phone-number bars. These are what the engine can generate from photos.
7. **Stories with a local joke work best on the biggest accounts.** Ando's "POV: She says 'I'm close' and you have NOTHING at home" skit (275K plays), the Nairobi car-lot skit about influencers asking for freebies (5K likes), a proposal story where five vendors are tagged (97.6K plays).
8. **Corporates use motion graphics, not footage.** Naivas: orange price badges with packshots and the offer end date in the footer (80K plays on 243K followers: low relative reach, but zero filming).
9. **Captions are the sales page.** Price in local currency (TSh, UGX, RWF, KSh), sizes, "Limited size", "Free delivery in Kigali", landmarks as directions (opposite Canabella, below Rebero Resort, TCB Building room 25AB), MoMo or "payment after delivery". Almost never on the video itself.
10. **Weak spots**: dark openings (Lou), no price anywhere (nearly all), small unreadable captions, 50-290 s videos with no hook (Pharo School, Java House), reposted foreign clips (a Kampala baby shop reposts a Brazilian Shopee affiliate video), landscape footage letterboxed.

### Accounts that do it best (Kigali first)

| Account | Followers | What they do | Best plays I saw |
| --- | --- | --- | --- |
| @serabeauty.rw | 2.3K | Face first, product in hand, application, smile; watermark on every frame; "DM to order, delivery available" | 513K, 348K |
| @elysian_spa_kigali | 4.1K | One continuous treatment shot with a booking line (area plus phone) on screen the whole time | 286K, 88K |
| @250cityshoes_ | 42.3K | Staff presenter in the shop, "New arrivals / Limited size", three numbers, address, free delivery in the caption | 300K, 227K |
| @ando_kigali | 3.4K | Relatable POV skits and event promos (World Cup code) with a visible branded bag | 275K, 86.5K |
| @rwanda_microlocs | 4.6K | Hair flip from behind, question hook text, "Rwandan queens" line | 193K, 171K |
| @lapaixtechnologyltd | 751 | Promotion line in Kinyarwanda, number on top for the whole clip, yellow caption box with address | 161K, 55K |
| @metro_cosmetics_12 | 662 | "Day 1 / Day 3 / Day 5 / Day 7" result counters, headline box with phone on screen | 98.6K, 74.3K |
| @homeofhybrid | 59 | Template slides plus raw car footage, phone bar for the whole video | 110K |
| @petal_florist_kigali | 16.8K | Cake-bouquet products and vendor-tagged story posts | 97.6K |
| @kigali_sneaker_gallery, @shoes._gallery_, @albatross_designer | 8.4K / 20.3K / 2.8K | Sneaker macro, sizes and phone in caption; customer testimonial with kinetic text; boots held by the seller with number tag | 40K, 42K, 59K |

Outside Kigali: Naivas (Nairobi) for retail price-badge motion graphics, House of Cars Kenya (172K plays, drone film, price and salesperson number in the caption), Brimat Computers (Nairobi, 46K plays, "MEGA SALE 30% OFF" paper signs, directions with landmarks), Meraki (Dar es Salaam, 236K followers, kaftan catalogue with TSh price in the caption), Royal Cakes (Dar es Salaam, "Only TSh 10,000", area, delivery, number).

### 5 rules for the engine, from the East African accounts

1. **Phone or WhatsApp number on screen from frame 0 to the last frame**, in a bar at the top or in the lower third (not the bottom 12%). Make it a required field of every Kigali template, with the area or landmark next to it. This single element matches the best reels in the sample.
2. **Default to 15-30 s, one continuous process or walk-through, 1-4 cuts per 10 s** for Rwandan business templates. Put the hook text (claim, "Promotion", "New arrivals", "Day 7") on screen at 0 s, then show the process once, then the contact. Do not use the 8-cut-per-10-s global recipe for services.
3. **Build the price badge into every product and offer template** (RWF, big numerals, orange or brand-colour shape, "Free delivery in Kigali" line). Only 3 of 34 Kigali reels show the price on screen, so this is a free advantage over their competitors. Put the same text in the caption the engine writes.
4. **Generate bilingual hook text, Kinyarwanda first**, with an English line below ("Turi kuri Promotion / We are on promotion"). Only 4 Kinyarwanda rows exist in the sample, so this is a bet rather than a measurement: the best of them (La Paix, 161K plays on 751 followers) pairs a Kinyarwanda promotion line with the number on screen. Offer a Swahili variant for Nairobi and Dar es Salaam.
5. **Caption generator = a shop card**: offer line, price in local currency, sizes or options, "Limited" stock line, delivery terms, payment (MoMo code or "payment after delivery"), landmark address, phone/WhatsApp, a comment keyword ("Comment PRICE") and local hashtags (#kigali #rwanda #kigaliupdates #<niche>). Pair it with a vendor-tagging line when other businesses appear (the proposal story with five tagged vendors had 97.6K plays).

## What viewers ask (round 3: comments under Kigali business reels)

### How I got it

- 20 Kigali reels from the account round, picked by comment count across sectors (shoes and clothes, skincare and beauty, wigs and hair, phones and laptops, spa, food delivery, events, a school), plus one food-tour creator reel. I opened each reel's comment panel in the same logged-in tab, expanded the reply threads, and read the top comments (Instagram's default "top" order). No likes, follows, replies or comments.
- 177 comments recorded in `instagram-comments.jsonl` (20 `clip_summary` rows plus 177 `comment` rows, same shape as `tiktok-comments.jsonl`). Commenter names are removed, @mentions are `@[user]`, language is rw / en / emoji. Each question has `seller_reply` (replied, how, text).
- Comment counts on Instagram are small compared with TikTok: only 5 of the 20 reels have more than 40 comments and 5 have fewer than 10, so 11 of the 20 yielded fewer than 10 usable comments. One reel (a skincare reel) showed an empty comment panel.
- I skipped spam: about 7 copy-pasted job adverts, a French health-supplement paste with a phone number, and foreign-language "massage service" bait on the spa reel.
- The classification (price / location / delivery / phone-DM / praise / other) is mine, by keyword rules plus a read-through. Kinyarwanda price words (angahe, nangahe, igura, agurangahe, hangaye) are the largest share.

### Category shares per sector

| Sector | Comments | Price | Location | Delivery | Phone/DM | Praise | Other |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shoes and fashion (250cityshoes x2, Albatross) | 44 | 61% | 5% | 5% | 2% | 2% | 25% |
| Skincare and beauty (Sera x2, Zuri, Carlyvine, Metro) | 45 | 62% | 2% | 4% | 2% | 11% | 18% |
| Salons and hair (microlocs x2) | 16 | 63% | 0% | 0% | 0% | 13% | 25% |
| Phones and electronics (La Paix x2) | 14 | 50% | 0% | 0% | 14% | 14% | 21% |
| Spa (Elysian) | 5 | 0% | 20% | 0% | 40% | 40% | 0% |
| Food delivery and food tour (Ando x2, a creator reel) | 33 | 0% | 0% | 0% | 0% | 97% | 3% |
| Events and florist (proposal story, dance group) | 19 | 0% | 0% | 0% | 0% | 100% | 0% |
| School (Pharo) | 1 | 0% | 0% | 0% | 0% | 100% | 0% |

Overall: 177 comments, 49% are a question or a request (86), 41% are price questions (72), 36% are praise, 15% other (mostly "I need this" buying signals and greetings). Language of the questions: Kinyarwanda 45, English 40.

### What it means

1. **Wherever there is a product, the first comment is the price.** 61-63% of all comments on shoes, clothes, skincare, wigs and hair reels, 50% on phone reels. Entertainment, event and food-brand reels get praise only (97-100%), so there is nothing to answer but also nothing to sell.
2. **Questions that mean something was missing from the video** (counted among the 86):
   - "How much / Angahe / Nangahe / Agurangahe / Igura angahe": 72 times. The price was missing from the video and often from the caption too.
   - "Mujye muvuga n'ibiciro" (say the prices too) and "Ese mwajyiye muvuga ibiciro" (you never say the prices): explicit complaints under a shoes reel and a skincare reel.
   - "Mukorerahe / Ukorerahe / Mukorera he / Location please": 4 times, on reels with the address only in the caption.
   - "Mukora delivery", "Nayibona gute", "You deliver in Kenya?", "Is it in Rusizi?": delivery terms missing.
   - "Number plz", "Nimero", "Contact?", "Contact detail address communication please": the contact missing from the video even on reels that have it in the caption.
   - "Jyuvuga cyane twumve" (speak up so we can hear): the voice in the shoes reel is hard to follow.
   - "Can it be done on very short soft hair?", "Is it extension?", "Does the price include the wig?": product suitability and what is included.
   - "I need this / I want this shoe / Ndashaka aka miroire": buying signals with no way to act (no link, no price).
3. **Replies answer less than half the questions.** Sellers replied to 46 of the 86 questions (53%). Among the price questions, 38 of 72 got a reply: 15 gave the price in the comment, 19 sent the asker to DM or "inbox".
4. **Reply habits that work, from the accounts that reply:**
   - Serabeauty (10 of 11 and 8 of 9 questions answered): replies with a one-word "inbox", the price ("30k") for the early commenters, or "Delivery" and the location ("MIC building").
   - Rwanda microlocs: gives the price and the terms in the comment ("microlocs installation is 150k", "25k, grow between 3-9 weeks", "our prices are fixed") and answers suitability questions in full.
   - Zuri: a polite fixed line ("Thank you for your interest in our wigs! Kindly check DMs for more info") and a direct "yes we do" for delivery to Kenya.
   - Carlyvine: answers each "Kagura angahe" with "35k" (3 of 3).
   - 250cityshoes: three different habits on two reels. On the "summer combo" reel 8 of 8 questions got "Dm please" or the address (and one "welcome" per commenter). On the "New arrivals / Limited size" reel, 14 questions (nearly all prices) got one reply (the address) and none for the price: 227K plays turned into 14 unanswered price questions.
5. **A "Dm please" reply works only if the DM is answered**, which I could not check. It does keep the price off public view, which hurts the next 20 viewers who ask the same question (the same "How much" appears 6-10 times under one reel).
6. **The most-liked comments are a signal.** 37 comments have 2+ likes; they are a mix of praise and repeated "How much" questions; a liked question is the same question asked by many.

### 5 rules for the engine

1. **Put the price on the video itself, and the same price in the caption.** 41% of all comments and 61-63% of comments in selling sectors are "How much?" Show the price as a badge on the product shot, plus "from 30,000 RWF" in the caption. A price on screen removes the most common comment and the commonest reason to DM.
2. **Generate a four-line answer card for every post** and put it where it cannot be missed: price, address (landmark), delivery (where, how much), phone/WhatsApp. These are the four things the 86 questions ask for. Put the card on the last 2 seconds of the video and in the first comment (pinned) so the seller can paste it.
3. **Write the pinned first comment for the seller**, in Kinyarwanda and English: "Prices: ... / Location: ... / Delivery: ... / WhatsApp: ...". Pinning the answer once avoids the pattern of the same "How much" repeated 10 times under one reel.
4. **Provide a reply kit with one-click answers in Kinyarwanda**: "Igiciro ni 30,000 RWF", "Turi i ..., hafi ya ...", "Turohereza i Kigali kandi n'ahandi", "Nandikira kuri WhatsApp ...", "Murakoze cyane". Remind the seller to answer the "buying signal" comments ("I need this"), which currently get "welcome" or nothing. A seller who answers 8 of 9 questions (Sera) gets visible demand; one who answers 1 of 14 (250cityshoes new arrivals) loses it.
5. **Make the voice clear and short**, and add Kinyarwanda captions when someone speaks (one comment asked the speaker to talk louder). For entertainment and brand reels (praise only), add a visible call to action, because 97-100% praise with zero questions means no buying path was shown.
