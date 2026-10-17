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
