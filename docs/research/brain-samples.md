# What Claude is told: brain samples

The exact research block (`brainContext`, `lib/video-engine/brain/select.ts`) that goes into Claude's brief for six example
briefs. It sits inside the brief as data, after the template and before the business facts; Claude still sees the photos
and the system prompt (which already covers the scroll-stopping opening, only-true facts, the safe area and the voice
language, so the block does not repeat them). Placeholders like {phone} are filled by Claude from the brief's facts.

Made by `BRAIN_SAMPLES=1 npx vitest run tests/video-engine/brain.test.ts -t "brain samples"`; rerun it after the brain
data changes.

## 1. Kigali phone shop on TikTok (Claude motion engine)

Brief: Nova Phones Kigali, Samsung Galaxy A56, 420,000 RWF, WhatsApp 0788 300 400, English, template Kigali price-first, 15 s.

3378 characters, about 845 tokens.

```text
What works: phone and electronics shop, product reveal, TikTok, 15 s (from 344 ads and reels BuPulse watched).
Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):
1. Number on screen, product in hand: "{phone} (top or lower-middle, whole clip) over {product} in a hand". First 2 s: Hands turn the product to show front and back; the phone or WhatsApp number is fixed on screen from the first frame to the last. Seen: "+250 785 478 140", "Whatsapp/Call: 0796148484".
2. Seller at the counter, price bar below: "{product} | {price} RWF | {phone}". First 2 s: The seller behind the shop counter holds the item up; a blue or yellow bar across the lower third with the product, the price and two numbers. Seen: "COMMERCIAL BLENDER / 48,000RWF / 0784695549", "TURN YOUR ROOM INTO A GALAXY".
3. Price banner from frame 0: "{product} {price}". First 2 s: The product (or the place) already moving, in a hand or in use, with a large price strip in the top third and the phone bar below; no intro. Seen: "48,000RWF", "PRICE 28K".
Timeline (15 s, 3 to 5 changes per 10 s):
- 0-2 s hook: The product already moving: in a hand, in use, or turning. No logo intro. On screen: The hook line, the price strip in the top third, the phone bar.
- 2-5 s body: The product doing its job in close-up. On screen: One feature in 2 to 4 words.
- 5-10 s body: Two more angles, colours or uses, 2 to 3 s each. On screen: One short label per shot.
- 10-13 s offer: The price card and what is included. On screen: Price in RWF in a solid box; the trust line if the owner gave one.
- 13-15 s cta: A clean hero shot of the product. On screen: The named route to order and the number, big, in the middle.
On-screen text and look:
- The price (or the offer) in the first frame, large, top third.
- The phone/WhatsApp number on screen from 0 s to the last frame, in a fixed bar above the app's UI, digits grouped.
- Burn in captions for every spoken line (most people watch muted).
- A real place behind the product (shelf, counter, table, compound) and real people or hands; no blank studio.
- Labels, prices and menus are drawn as text on top, never left to a generated image.
- The full price on screen with its condition in the same label ('28k with extension', '133k for 3 nights').
Call to action: WhatsApp or call {phone}; the shop address and room number (Makuza Peace Plaza, Room 35).
Caption: {product}: {claim}. Available now at {business} 📞 {phone} 🚚 {offer} (e.g. "✨ AQUOS Sense 9 — compact, powerful and seriously impressive. Available now at KIBO Electronics �..."). Include: the offer or the product in the first line; the route to order (WhatsApp, call, DM, the app); the area in the city; 4 to 6 hashtags with the city. Hashtags 4 to 6, local first: #kigalitiktok #rwandatiktok #KigaliRwanda #KigaliBusiness.
Don't:
- No income proof: no fake M-Money or bank SMS, no cash piles, no 'get rich' lines.
- No 'best', 'cheapest', 'most affordable in Kigali' unless the owner wrote it.
- No fake reviews or comments; a fictional presenter never poses as a real customer.
- No famous brands, logos, people or lookalikes that are not the business's own.
- No 'how I made this' / 'Comment PROMPT' wrapper in a client ad.
- No vague discounts ('40% or 60%'): one clear offer at a real price.
- No polished brand film without a price and number for a small seller.
```

## 2. Kigali phone shop on Facebook (Claude motion engine, Kinyarwanda)

Brief: The same shop and phone, content in Kinyarwanda (the voice speaks English), Facebook, 15 s.

3561 characters, about 890 tokens.

```text
What works: phone and electronics shop, product reveal, Facebook, 15 s (from 344 ads and reels BuPulse watched).
Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):
1. Number on screen, product in hand: "{phone} (top or lower-middle, whole clip) over {product} in a hand". First 2 s: Hands turn the product to show front and back; the phone or WhatsApp number is fixed on screen from the first frame to the last. Seen: "+250 785 478 140", "Whatsapp/Call: 0796148484".
2. Seller at the counter, price bar below: "{product} | {price} RWF | {phone}". First 2 s: The seller behind the shop counter holds the item up; a blue or yellow bar across the lower third with the product, the price and two numbers. Seen: "COMMERCIAL BLENDER / 48,000RWF / 0784695549", "TURN YOUR ROOM INTO A GALAXY".
3. Price banner from frame 0: "{product} {price}". First 2 s: The product (or the place) already moving, in a hand or in use, with a large price strip in the top third and the phone bar below; no intro. Seen: "48,000RWF", "PRICE 28K".
Timeline (15 s, 3 to 5 changes per 10 s):
- 0-2 s hook: The product already moving: in a hand, in use, or turning. No logo intro. On screen: The hook line, the price strip in the top third, the phone bar.
- 2-5 s body: The product doing its job in close-up. On screen: One feature in 2 to 4 words.
- 5-10 s body: Two more angles, colours or uses, 2 to 3 s each. On screen: One short label per shot.
- 10-13 s offer: The price card and what is included. On screen: Price in RWF in a solid box; the trust line if the owner gave one.
- 13-15 s cta: A clean hero shot of the product. On screen: The named route to order and the number, big, in the middle.
On-screen text and look:
- The price (or the offer) in the first frame, large, top third.
- The phone/WhatsApp number on screen from 0 s to the last frame, in a fixed bar above the app's UI, digits grouped.
- Burn in captions for every spoken line (most people watch muted).
- A real place behind the product (shelf, counter, table, compound) and real people or hands; no blank studio.
- Labels, prices and menus are drawn as text on top, never left to a generated image.
Call to action: WhatsApp or call {phone}; the shop address and room number (Makuza Peace Plaza, Room 35).
- Rwanda: English with Kinyarwanda touches for services; Kinyarwanda for plots, household and baby goods; a mix for food, phones and fashion; money the local way (38,000 RWF, 48K).
Caption: 💻 {business} STOCK 🔹 {product} 💰 {price} 🔹 {product} 💰 {price} (e.g. "💻 MICROSOFT SURFACE STOCK — LA PAIX TECHNOLOGY 🔹 Surface Pro 4 — i5 6th | 8/256 | 12.3” Touch �..."). Include: the product and the price or offer in the first 60 characters; the phone or WhatsApp number labelled 'Call/WhatsApp:' (a second number is fine); the area and a landmark on a 📍 line; the delivery line when the owner delivers; 0 to 3 hashtags (the city plus the sector). Hashtags 0 to 3, local first: #Kigali #Rwanda #KigaliRwanda #RwandaBusiness.
Don't:
- No income proof: no fake M-Money or bank SMS, no cash piles, no 'get rich' lines.
- No 'best', 'cheapest', 'most affordable in Kigali' unless the owner wrote it.
- No fake reviews or comments; a fictional presenter never poses as a real customer.
- No famous brands, logos, people or lookalikes that are not the business's own.
- No 'how I made this' / 'Comment PROMPT' wrapper in a client ad.
- No vague discounts ('40% or 60%'): one clear offer at a real price.
- No polished brand film without a price and number for a small seller.
```

## 3a. Kibagabaga house on Instagram (Seedance)

Brief: Ikaze Homes, 4 bedroom house in Kibagabaga, 180,000,000 RWF, Seedance tour, 15 s, with sound. The phone is overlaid by BuPulse.

3419 characters, about 855 tokens.

```text
What works: real estate (sale and rent), tour, Instagram Reels, 15 s (from 344 ads and reels BuPulse watched).
Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):
1. Where, what size, how much: "{city} / {area} | {count} BEDROOMS | {price}". First 2 s: Three stacked labels (district, sector, street) over the first shot, then a pill with the rooms; the price follows. Seen: "KIGALI KICUKIRO / KANOMBE KABEZA / MWITUNDA", "4 BEDROOMS".
2. Price banner from frame 0: "{product} {price}". First 2 s: The product (or the place) already moving, in a hand or in use, with a large price strip in the top third and the phone bar below; no intro. Seen: "48,000RWF", "PRICE 28K".
3. Whip pan into the tour: "(a fast move into the best room or the view, the price in the title)". First 2 s: A whip pan or a smooth gimbal glide into the best space at dusk; the caption carries the price. Seen: "Touring An AMAZING Modern Luxury Custom Home in Frisco, Texas", "$28,000,000 for a CASTLE in Las Vegas".
Timeline (15 s, 2 to 3 changes per 10 s):
- 0-3 s hook: The best view or a whip pan into the best room. BuPulse overlays: The location stack (city / area / street) and the key fact (4 BEDROOMS).
- 3-10 s body: The spaces one by one, 2 to 3 s each, smooth gimbal moves. BuPulse overlays: One label per space (living room, kitchen, plot size).
- 10-12 s offer: The outside or the view again. BuPulse overlays: The price large ('400K RWF / month').
- 12-15 s cta: The entrance or the sign. BuPulse overlays: WhatsApp {phone}, the area and a landmark.
Shots and sound:
- No text in the clip: open on motion, keep the top third and a lower-middle band calm for BuPulse's price strip and phone bar, end on a clean hero shot with space above.
- Labels, prices and menus are drawn as text on top, never left to a generated image.
- Real shop, stock and hands in frame; AI visuals keep the real product photo and never invent a place.
- Open on the best visual in frame 0, never a logo card.
Call to action (BuPulse overlays it on the last shot; keep that shot clean): WhatsApp {phone}; district, sector and street (Kicukiro, Kanombe, Kabeza); the property ID.
Don't:
- No income proof: no fake M-Money or bank SMS, no cash piles, no 'get rich' lines.
- No 'best', 'cheapest', 'most affordable in Kigali' unless the owner wrote it.
- No fake reviews or comments; a fictional presenter never poses as a real customer.
- No other app's watermark or template tag.
- No 'how I made this' / 'Comment PROMPT' wrapper in a client ad.
- No vague discounts ('40% or 60%'): one clear offer at a real price.
- No film, TV, football clips or copyrighted songs.
Also:
- Generated footage keeps the 'AI-generated' label; a generated person is never a real customer.
- Never depend on audio: the message is in text and picture; sound goes under it.
- A new shot or text change every 2 to 4 s.
- One product, one idea, one offer per video.
- Put proof in the middle: a real customer reacting, the product working, a real shop full of stock, a real number from the owner.
East Africa: Kigali buyers filter on district, sector and size first: put them in the first 3 s. The caption lists price in RWF, rooms, plot size, parking, the area and the number (Hills Props, Samkay). Settings that fit: the gate and the front of the house at golden hour; a smooth gimbal walk-through of the living room, kitchen and bedrooms.
```

## 3b. Kibagabaga house on Instagram (Claude motion engine, from photos)

Brief: The same house, made from the listing photos, template Brand story (a tour), 20 s.

3571 characters, about 893 tokens.

```text
What works: real estate (sale and rent), tour, Instagram Reels, 20 s (from 344 ads and reels BuPulse watched).
Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):
1. Where, what size, how much: "{city} / {area} | {count} BEDROOMS | {price}". First 2 s: Three stacked labels (district, sector, street) over the first shot, then a pill with the rooms; the price follows. Seen: "KIGALI KICUKIRO / KANOMBE KABEZA / MWITUNDA", "4 BEDROOMS".
2. Price banner from frame 0: "{product} {price}". First 2 s: The product (or the place) already moving, in a hand or in use, with a large price strip in the top third and the phone bar below; no intro. Seen: "48,000RWF", "PRICE 28K".
3. Whip pan into the tour: "(a fast move into the best room or the view, the price in the title)". First 2 s: A whip pan or a smooth gimbal glide into the best space at dusk; the caption carries the price. Seen: "Touring An AMAZING Modern Luxury Custom Home in Frisco, Texas", "$28,000,000 for a CASTLE in Las Vegas".
Timeline (20 s, 2 to 3 changes per 10 s):
- 0-3 s hook: The best view or a whip pan into the best room. On screen: The location stack (city / area / street) and the key fact (4 BEDROOMS).
- 3-14 s body: The spaces one by one, 2 to 3 s each, smooth gimbal moves. On screen: One label per space (living room, kitchen, plot size).
- 14-17 s offer: The outside or the view again. On screen: The price large ('400K RWF / month').
- 17-20 s cta: The entrance or the sign. On screen: WhatsApp {phone}, the area and a landmark.
On-screen text and look:
- The price (or the offer) in the first frame, large, top third.
- The phone/WhatsApp number on screen from 0 s to the last frame, in a fixed bar above the app's UI, digits grouped.
- Burn in captions for every spoken line (most people watch muted).
- A real place behind the product (shelf, counter, table, compound) and real people or hands; no blank studio.
- Labels, prices and menus are drawn as text on top, never left to a generated image.
- The full price on screen with its condition in the same label ('28k with extension', '133k for 3 nights').
Call to action: WhatsApp {phone}; district, sector and street (Kicukiro, Kanombe, Kabeza); the property ID.
Caption: {product} {price} {offer} Call or WhatsApp {phone} 📍 {area} (e.g. "Samsung s22 ₹10000/- Downpayment Call or whatsapp📞 =99108450…"). Include: the offer or the price first; one line of benefit; the contact: phone, WhatsApp or 'DM to order'; the place (street, neighbourhood or a location tag); 3 to 6 hashtags: 2 broad, 2 local (#kigali, #rwanda), 1 or 2 niche. Hashtags 3 to 6, local first: #kigali #rwanda #kigalirwanda #kigalifood.
Don't:
- No income proof: no fake M-Money or bank SMS, no cash piles, no 'get rich' lines.
- No 'best', 'cheapest', 'most affordable in Kigali' unless the owner wrote it.
- No fake reviews or comments; a fictional presenter never poses as a real customer.
- No famous brands, logos, people or lookalikes that are not the business's own.
- No 'how I made this' / 'Comment PROMPT' wrapper in a client ad.
- No vague discounts ('40% or 60%'): one clear offer at a real price.
- No polished brand film without a price and number for a small seller.
East Africa: Kigali buyers filter on district, sector and size first: put them in the first 3 s. The caption lists price in RWF, rooms, plot size, parking, the area and the number (Hills Props, Samkay). Settings that fit: the gate and the front of the house at golden hour; a smooth gimbal walk-through of the living room, kitchen and bedrooms.
```

## 4. Restaurant offer on Facebook (Claude motion engine)

Brief: Cave Kitchen Kicukiro, 'Buy one pizza, get one free every Tuesday', pizza 12,000 RWF, call 0791 000 111, template Offer flash, 15 s.

3452 characters, about 863 tokens.

```text
What works: restaurant, café, bakery, offer, Facebook, 15 s (from 344 ads and reels BuPulse watched).
Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):
1. Offer badge with the day: "{offer} EVERY {day}". First 2 s: Top-down table with the food; a solid badge with the offer and the day sits on screen for the whole clip. Seen: "BUY 1 GET 1 FREE", "BUY ONE PIZZA GET ONE FREE EVERY TU".
2. Promo for one price: "{claim} | PROMO FOR {price} | DON'T MISS". First 2 s: A hand unwraps or lifts the one product; the header text and the number stay up the whole clip. Seen: "BEST BURGERS IN KIGALI / PROMO FOR 5K - DON'T MISS", "hurry! hurry! special offer any style 1800 (inclusive of braids & free wash)".
3. Appetite shot: "{product} in macro: steam, a pull, a bite (price at the top)". First 2 s: Food macro in the first second: steam, a cheese pull, a foil unwrap, a first bite by a real person. Seen: "Fish lovers!! This is your time to enjoy muhazi tilapia fish !!", "Mozzarella-stick cheese pull readable in under 1 s with no sound".
Timeline (15 s, 3 to 4 changes per 10 s):
- 0-2 s hook: The product top-down or in a hand. On screen: The offer badge with the day ('BUY 1 GET 1 FREE', 'EVERY TUESDAY').
- 2-6 s proof: A real person bites, opens or uses it. On screen: The badge stays.
- 6-10 s body: A second item or a close-up. On screen: Its name and price next to it.
- 10-13 s body: The place: the venue, the counter, the shop front. On screen: The area or the address.
- 13-15 s cta: The offer item again, clean. On screen: 'Order on {app}' or 'Call {phone}', in the middle.
On-screen text and look:
- The price (or the offer) in the first frame, large, top third.
- The phone/WhatsApp number on screen from 0 s to the last frame, in a fixed bar above the app's UI, digits grouped.
- Burn in captions for every spoken line (most people watch muted).
- A real place behind the product (shelf, counter, table, compound) and real people or hands; no blank studio.
- Labels, prices and menus are drawn as text on top, never left to a generated image.
- The full price on screen with its condition in the same label ('28k with extension', '133k for 3 nights').
Call to action: Order on {app} or call {phone}; the area (Kicukiro Sonatube, Kimironko).
Caption: 🍔 {product} for only {price} {day}
Abakiriya bacu barishimye 😍 ntucikwe!
🚚 Delivery in {area}
📍 {area}, {landmark}
📲 Order: {phone}
#KigaliFood #{business} (e.g. "🔥 PROMO DISCOUNT 37.5% OFF! 🔥5K Abakiriya bacu barishimye 😍 nawe ntucikwe!"). Include: the product and the price or offer in the first 60 characters; the phone or WhatsApp number labelled 'Call/WhatsApp:' (a second number is fine); the area and a landmark on a 📍 line; the delivery line when the owner delivers; 0 to 3 hashtags (the city plus the sector). Hashtags 0 to 3, local first: #Kigali #Rwanda #KigaliRwanda #RwandaBusiness.
Don't:
- No income proof: no fake M-Money or bank SMS, no cash piles, no 'get rich' lines.
- No 'best', 'cheapest', 'most affordable in Kigali' unless the owner wrote it.
- No fake reviews or comments; a fictional presenter never poses as a real customer.
- No famous brands, logos, people or lookalikes that are not the business's own.
- No 'how I made this' / 'Comment PROMPT' wrapper in a client ad.
- No vague discounts ('40% or 60%'): one clear offer at a real price.
- No polished brand film without a price and number for a small seller.
```

## 5. Salon on TikTok (Seedance, before and after)

Brief: Amahoro Braids, knotless braids, from 25,000 RWF, Seedance transformation, 10 s, with sound. The phone is overlaid by BuPulse.

3594 characters, about 899 tokens.

```text
What works: salon, barber, nails, beauty, before and after, TikTok, 10 s (from 344 ads and reels BuPulse watched).
Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):
1. Wait for it ... (the result first): "Wait for it... ({result} first, then the before)". First 2 s: The finished result (the hairstyle, the room, the car) for 1 to 2 s with 'Wait for it...' or 'After', then the before. Seen: "Wait for it...", "After". Never a body, skin or medical before/after.
2. Tired of ...? / Still ...?: "Tired of {problem}?". First 2 s: The everyday problem on screen first (dull, real), then a hard cut to the product fixing it. Seen: "Tired of Snoring Ruining Your Sleep?", "Nobody warns you how annoying juicers are to actually clean".
3. before... / after (one word each): "before... | after". First 2 s: The same framing twice: the old state with one lowercase word 'before...' held 2 to 3 s, a hard cut, the finished state with 'after' and a slow push-in. Seen: "before...", "Before... / After". Never a body, weight or face before/after: rooms, hair, shops and renovations only.
Timeline (10 s, 3 to 4 changes per 10 s):
- 0-2 s hook: The finished result, held still and bright. BuPulse overlays: 'Wait for it...' or 'After'.
- 2-4.5 s proof: The before, dull and real. BuPulse overlays: 'Before'.
- 4.5-8 s offer: The full result again, held. BuPulse overlays: The service name and the price.
- 8-10 s cta: The result with the business sign or the chair. BuPulse overlays: 'Book: WhatsApp {phone}'.
Research length for this format: 14 to 20 s; keep the same beats at this length.
Shots and sound:
- No text in the clip: open on motion, keep the top third and a lower-middle band calm for BuPulse's price strip and phone bar, end on a clean hero shot with space above.
- Labels, prices and menus are drawn as text on top, never left to a generated image.
- Real shop, stock and hands in frame; AI visuals keep the real product photo and never invent a place.
- Open on the best visual in frame 0, never a logo card.
Call to action (BuPulse overlays it on the last shot; keep that shot clean): Book on WhatsApp {phone}; the street (Roysambu, Lumumba Drive style).
Sound: music mood afro (mid-tempo Afrobeats or amapiano loops) from BuPulse's library, never a trending track; voice: a voice-over with word-by-word captions for a client story; otherwise the text carries it. The clip must work muted.
Don't:
- No income proof: no fake M-Money or bank SMS, no cash piles, no 'get rich' lines.
- No 'best', 'cheapest', 'most affordable in Kigali' unless the owner wrote it.
- No fake reviews or comments; a fictional presenter never poses as a real customer.
- No other app's watermark or template tag.
- No 'how I made this' / 'Comment PROMPT' wrapper in a client ad.
- No vague discounts ('40% or 60%'): one clear offer at a real price.
- No film, TV, football clips or copyrighted songs.
Also:
- In a before/after, show the result first ('After' or 'Wait for it...'), then the before, then the process, then the offer.
- Generated footage keeps the 'AI-generated' label; a generated person is never a real customer.
- Never depend on audio: the message is in text and picture; sound goes under it.
- A new shot or text change every 2 to 4 s.
- One product, one idea, one offer per video.
East Africa: One flat price that includes a free extra (braids and a free wash) ran 982 days in Nairobi. Never a body, skin or medical before/after (Meta and TikTok policy, owner rule). Settings that fit: the salon chair with a ring light; close-ups of hands braiding.
```

## 6. School on YouTube Shorts (Claude motion engine)

Brief: Bright Future Academy, evening English course, 30,000 RWF a month, WhatsApp 0782 000 333, template 3 reasons, 15 s.

3524 characters, about 881 tokens.

```text
What works: school, training, courses, list or price list, YouTube Shorts, 15 s (from 344 ads and reels BuPulse watched).
Hook options (pick one; fill {placeholders} only with facts from the brief, drop the rest):
1. Numbered list: "{count} {product} you need / 1. ... 2. ... 3. ...". First 2 s: Item 1 on screen at 0 s, one item per beat with a big number. Seen: "1. Perfumes business", "4/20 Business ya products".
2. Students or workers doing the work: "Master the skills of {claim} at {business}". First 2 s: Hands on tools in the real workshop or classroom, matching uniforms; the branch numbers in the lower third. Seen: "Master the skills of a professional mechanic".
3. More than you think: "Your {product} can do more than you think!". First 2 s: The device's screen or a surprising feature in close-up. Seen: "Your phone can do more than you think!".
Timeline (15 s, 5 to 8 changes per 10 s):
- 0-1.5 s hook: Item 1 already on screen (in a hand, or the full price list card). On screen: Number 1 or the list title, the phone number.
- 1.5-12 s body: One item per beat, about 2 s each: a product in a hand in front of the stock, or one reason or lesson point. On screen: A big number and the item; a price label on each product.
- 12-15 s cta: The shop, the class or the team. On screen: 'Call / WhatsApp {phone}'.
On-screen text and look:
- The phone/WhatsApp number on screen from 0 s to the last frame, in a fixed bar above the app's UI, digits grouped.
- Burn in captions for every spoken line (most people watch muted).
- A real place behind the product (shelf, counter, table, compound) and real people or hands; no blank studio.
- Shorts: top 10% clear (auto-captions), bottom 25% clear (title, Subscribe); price and number at 40 to 60% height.
- Labels, prices and menus are drawn as text on top, never left to a generated image.
- The full price on screen with its condition in the same label ('28k with extension', '133k for 3 nights').
Call to action: WhatsApp {phone} to register; the campus area.
Sound: music mood calm or inspiring (quiet and clean; inspiring for a brand film) from BuPulse's library, never a trending track; voice: a student or a teacher speaking, always subtitled. The clip must work muted.
Caption: {count} reasons to {claim} / {product} in {city}: {offer} (e.g. "5 reasons to invest in Rwanda"). Include: the promise, the number or the product name in the first 40 characters; the shop name and the city (people search for them); the phone number in the title for a local shop; 1 to 3 hashtags at the end (#shorts and the city). Hashtags 1 to 3, local first: #shorts #kigali #kigali_250 #rwanda.
Don't:
- No income proof: no fake M-Money or bank SMS, no cash piles, no 'get rich' lines.
- No 'best', 'cheapest', 'most affordable in Kigali' unless the owner wrote it.
- No fake reviews or comments; a fictional presenter never poses as a real customer.
- No famous brands, logos, people or lookalikes that are not the business's own.
- No 'how I made this' / 'Comment PROMPT' wrapper in a client ad.
- No vague discounts ('40% or 60%'): one clear offer at a real price.
- No polished brand film without a price and number for a small seller.
Offer wording seen (only if true for this business): Start now; Use the app to practise; One lesson per video.
East Africa: Nairobi and Kampala sellers put a price on every product shot (150/=, KSH 35, 85,000) and keep the number on screen. Settings that fit: a teacher in uniform pointing at the lesson; a classroom with students working.
```
