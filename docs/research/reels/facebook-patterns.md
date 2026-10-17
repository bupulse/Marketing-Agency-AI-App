# Facebook patterns for the BuPulse video engine

## How reliable this is

- Source: the public Meta Ad Library (active, video only, countries RW, KE, UG, TZ, NG) and the owner's Reels tab. No likes, follows, comments, saves or downloads. No block, challenge or login wall appeared.
- 40 rows in `facebook.jsonl`: 34 Ad Library ads and 6 reels from the feed. 30 rows were watched (muted, 5 frames over about 12 s each, read from screenshots). 10 rows are `watched: false`, because the video did not load or I only read the ad text. Their fields I could not see are `null`.
- I watched with the sound off. Voice and music are marked "unknown" where I could not hear them. Cuts per 10 s are estimates from 5 frames.
- The Ad Library shows no likes, views or spend. "Works" here means **how long an ad has been active and how many variants the advertiser keeps running**. That is a proxy, not proof of sales.
- The Rwanda filter returns many global ads. Searching local words ("Kigali", "MoMo", "RWF", "WhatsApp") found the real Rwandan advertisers. English words like "shop" mostly returned global dropshippers.
- Reels in this feed were mostly entertainment (music, comedy, news). Only 6 had marketing value, so reels are a small part of the evidence.

## What the searches showed

| Search | Result |
| --- | --- |
| Kigali, RW | about 340 ads; best source of real Rwandan video ads |
| mobile money, RW | about 180 results, mostly global; no MoMo-specific local ad found |
| RWF, MoMo, WhatsApp, RW | useful for price-in-RWF ads |
| shop, salon, restaurant, delivery, phone, fashion, school, real estate | RW, KE, UG, TZ pulled 27 to 88 ads each after 2 scrolls; NG only "shop" was run |

Longest-running East African video ads I found (to 17 Oct 2026):
- SPOT SALON & Beauty Studio, Nairobi, since 8 Feb 2024 (about 20 months).
- Kenlina-B (Kenya), TnzStore (Tanzania), Ugalina (Uganda): the same template since Oct 2024 to Mar 2025, 7 to 12 variants each.
- Florito cafe playlist (KE), 5 Nov 2024. Fitae (KE), royal_cakestz (TZ), Tawali Glamour (KE), May 2025.
- homeofhybrid car rental, Kigali, since 6 Jul 2025 (15 months).
- Derma Skin Clinic Rwanda: 15+ ads since March 2026. Magic Chef Kigali: 7+ ads since August 2026.

## What long-running East African Facebook video ads have in common

**Hooks**
- The offer or product is on screen at second 0: a price banner ("Offer today at Kes 2,100", "PROMO FOR 5K", "48,000RWF"), or a clear label ("RENT A CAR, RENT FREEDOM", "One bedroom In Gasogi Full furnished 400k / Month").
- Real hands or people, not studio shots: a hand unwrapping a burger, a nurse holding phone boxes, a doctor in a clinic.
- Pain first when the copy is longer: "Tired of Snoring Ruining Your Sleep?", "Still...?".
- POV hooks appear in both local ads and reels ("POV: You're about to make someone smile for just 15Tsh").

**Length**
- Most Rwandan local ads are 15 to 30 s. Several are 60 to 90 s (the clinic, a property tour), always with a talking person.
- The short loops (5 s flower grid, 5 s model walk) also ran for 9+ months. A short loop is enough for a gift or a fashion item.
- Vertical 9:16 dominates. A few 16:9 or 1:1 ads appear and look older.

**Text**
- Price, phone number and one claim in burned-in text, usually in the top third, not the bottom. A permanent phone-number bar (green or yellow) is the commonest pattern in Rwanda (Eguriro, EHA 250, Kex Group, homeofhybrid).
- Captions are tiny and plain. The clinic uses sentence-by-sentence boxed captions that match the speech.
- Only about one in three local ads uses a hook sentence. The rest use a price strip.

**Offers**
- Flat price, free delivery, a bundle or a "was / now" anchor ("Was Kes 4,200, Now Kes 2,100", "Starting from 500 RWF", "Add 3 to cart, get 1 free", "37.5% off for 5K").
- Cash-on-delivery sellers (Kenlina-B, Ugalina, TnzStore) always add "Free delivery" and "Pay after delivery". This is the trust line, and the loudest pattern in Kenya, Uganda and Tanzania.
- Event venue: everything free except food and drink (One Click Hotel).

**Calls to action**
- The button is almost always "Send WhatsApp message" for local businesses (API.WHATSAPP.COM links), or "Visit Instagram profile" / "Order now" / "Shop now" for shops with a site.
- The caption repeats the phone number, the area (Gishushu, Utawala, Roysambu, Makuza Peace Plaza, Room 35) and the delivery promise.
- No local ad I read mentions MoMo, M-Pesa or Airtel Money in the caption. Pay-on-delivery and WhatsApp are the payment story. MoMo is an opening for the engine: no one is showing it.

**Language**
- Rwanda: Kinyarwanda mixed with English ("Abakiriya bacu barishimye", "KURI 38000FRW TUGUHA...", "Inzu nziza igurishwa"). Tanzania: Swahili copy for the same template. Kenya and Uganda: English.

## How this differs from TikTok

- Facebook ads here are **direct response**: a phone number on screen and a WhatsApp button, not a trend. TikTok patterns lean on sound, POV, comment replies.
- Facebook videos are longer (20 to 90 s) and slower (about 0 to 4 cuts per 10 s versus 3 to 5 on TikTok).
- Facebook ads reuse TikTok clips (TikTok watermarks are visible in at least 3 of the ads I watched), so one clip can be cut for both.
- The same ad runs for months, and advertisers add variants instead of replacing it. TikTok content rotates faster.
- The Ad Library gives the age of every ad, so we can rank by time running, which TikTok does not show.

## 10 rules for the engine

1. Put the price (or the offer in a few words) in the first frame, top third of the screen, large. Not in a bottom caption.
2. Add a phone or WhatsApp bar from second 0 to the last frame. Default to a 9:16 strip with a phone icon and the number in big digits.
3. Default length 15 to 25 s for products and offers. Offer 30 to 60 s only for a talking host (clinic, property, restaurant tour). Offer a 5 s loop for gifts and fashion.
4. Show the product doing its job in the first 3 s (food close-up, blender with juice, nails, dress flap). Show at least 3 use cases or angles in 10 s.
5. Use one-word or short sticker captions that change with the beat for the story, and a fixed strip for the price and phone. Never more than 2 text lines at once.
6. Always write the caption: price in RWF, area and landmark, delivery promise ("Free delivery", "Delivery available"), the phone number twice, and 3 to 4 hashtags with the city.
7. Put a trust line in text or caption: "Pay after delivery", "Free delivery over 50k", "30 days return", a real address. In Rwanda prefer MoMo and WhatsApp wording; keep it as a configurable line.
8. Use a person where possible: a host, a shop assistant, a customer holding the item. If no person exists, use hands on the product. Let the host open with a greeting in Kinyarwanda ("Muraho", "Tubahe...").
9. Make language selectable: Kinyarwanda mix for Rwanda, Swahili for Tanzania, English for Kenya and Uganda. Keep numbers and RWF/KES/TZS formats natural ("38,000 RWF", "48K").
10. Make 3 to 5 variants of every product (price hook, pain hook, POV hook, demo-only, offer-only) because the winning advertisers run many variants at once. Never replace the best one; add to it.

## 5 template ideas with shot lists

**1. Price banner product demo (15 s, shop, phone seller, kitchenware)**
- 0-1 s: top banner with price and phone number, product already in motion.
- 1-5 s: the product in use, close-up, no talking.
- 5-10 s: 2 more use cases or colours, 2 to 3 s each, small label each.
- 10-13 s: "Free delivery in Kigali" sticker and the stock line.
- 13-15 s: WhatsApp button graphic, number large, MoMo / pay on delivery line.

**2. Doctor / expert talk (45 s, clinics, salons, schools, lawyers)**
- 0-3 s: name and role card ("DR. [NAME], [CLINIC]") over the presenter.
- 3-30 s: one problem, one explanation; sentence-by-sentence caption box.
- 30-40 s: proof, a client photo or "From confusion to confidence" before/after.
- 40-45 s: address, two phone numbers, WhatsApp button.

**3. Property or room tour (30 s, real estate, hotel, rental)**
- 0-3 s: three-panel location stack (city / district / sector), then "4 BEDROOMS" pill.
- 3-20 s: 5 rooms, 3 s each, a label each (living room, kitchen, plot size).
- 20-26 s: price "400K RWF / month" or "130M RWF" large.
- 26-30 s: WhatsApp button, property ID, address.

**4. One dish per video (20 s, restaurant, cafe, bakery)**
- 0-2 s: the dish in macro, with "PROMO 5K" and the number at the top.
- 2-12 s: three cuts: steam, slice or pour, a hand lifts it.
- 12-17 s: a customer reaction bite or a table of friends.
- 17-20 s: "Order on WhatsApp / MoMo", delivery areas.
- Run it weekly with a new dish (series, same layout).

**5. Now available in [country] (20 s, any cash-on-delivery gadget seller)**
- 0-2 s: flag emoji, "Now available in Rwanda", the product.
- 2-8 s: a pain line ("Tired of ...?") and the product fixing it.
- 8-15 s: three benefit ticks, one per 2 s.
- 15-20 s: "Free delivery in Kigali. Pay on delivery. WhatsApp: [number]".
