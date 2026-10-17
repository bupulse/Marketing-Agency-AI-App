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

---

# Rwanda playbook (round 2, 17 Oct 2026)

## What round 2 added

- 33 more Rwandan video ads from the Ad Library (`round: 2` in `facebook.jsonl`). The file now has 73 rows; 51 are Rwandan Ad Library ads.
- Searches that worked, all with the Rwanda filter and active video ads, 8 scrolls: "Kigali" (115 ads), "Rwanda" (203), "RWF" (90), "Kigali delivery" (56), "Kigali hotel" (25), "Kigali shop" (26), "Kigali clinic" (17), "Kigali house" (16), "Kicukiro", "igiciro", "Nyarugenge", "Gasabo". "Kigali salon" returned nothing; "Kigali restaurant" and "Kigali phones" returned very few. A sector word on its own ("salon", "restaurant") pulls global ads, so the local word has to be in the query.
- Of the 33, 28 were watched (5 frames over about 12 s) and 5 are text-only (`watched: false`): the video did not load, or only the card was captured. New fields on every round-2 row: `offer_wording`, `price_position`, `ordering_route`, `language_mix`, `visual_style`.
- **Honest limit on "longest running".** Almost all Rwandan video ads in the library are young: most started in the last two weeks, because small advertisers turn ads on and off. Only 8 of 51 have run more than 5 months: tuza_officall (shoes, since 9 Jun 2025, 16 months, text-only), homeofhybrid (car hire, since 6 Jul 2025, 15 months), Derma Skin Clinic Rwanda (since Mar 2026, 15+ ads), petal_florist_kigali (since 3 Mar 2026), Dilara Collection (4 May 2026), FRAMEG Cargo and Tours (6 May 2026), British English Language Institute (13 May 2026). So for Rwanda, "number of variants live at once" is a better signal than age: Derma (15), Piramie 4G+ (6 ads in 11 days), Elohome (8), Magic Chef (7), Kenlina-style copycats.

## What the longest-running and most-repeated Rwandan ads have in common

1. **One idea, one price or one offer, on screen from frame 0.** Piramie's pill ("20 Mbps | 20K / month") stays on every frame. Others: "COMMERCIAL BLENDER / 48,000RWF / 0784695549", "Price: 500k" (spin bike), "350M RWF" (house), "Price: 16M" (plots).
2. **Phone or WhatsApp is the ordering route in nearly every ad.** Of 51 Rwandan ads: 22 have a "Send WhatsApp message" button, 13 send to an Instagram profile, 4 use "Call now". 35 put a phone number in the caption. Only 1 uses a website sign-up (Piramie) and 1 a booking site (Kigali Rwanda Car Hire).
3. **A landmark address, not a street.** "Next to DELIGHT HOTEL", "opposite IPRC traffic lights", "Makuza Peace Plaza, Room 35", "same building as boho, door 8". This is how Kigali people find places, and the engine should ask for the landmark.
4. **Real people, real places, phone-filmed.** Most are phone selfies, a shop counter, a workshop or a walk-through. The polished ones (ONOMO hotel, Piramie, Dilara) are brands with budgets, and they have no price or number in the video. Only the budget brands skip a number; small sellers never do.
5. **Language mix.** Roughly: Kinyarwanda caption and English on-screen words (13 of 51 ads are Kinyarwanda in the caption), pure English (the majority), French only on 1 ad (HT26 Paris, in a Kigali shop post). Cleopatra Home writes the same caption twice, English then Kinyarwanda. Property and cheap-goods ads lean Kinyarwanda ("Ibibanza byiza ... Bigurishwa", "TERA NEZA MUGIHE..."). Hotels, clinics, tech and beauty lean English.
6. **Length.** Median 34 s; about half under 30 s. Under 20 s for product and offer ads, 40 to 90 s for a talking person (clinic, property, school).
7. **Captions carry the spec list.** Checklist emojis with price, size, area, water and power, title, delivery. The video is the proof, the caption is the contract.
8. **Delivery and payment trust lines.** "Free delivery in Kigali", "Payment after delivery", "Delivery anywhere in Rwanda", "Warranty and direct home delivery". None of the 51 mentions MoMo in the caption.
9. **Series by sector.** Magic Chef (one dish per ad), Derma (one condition per ad), Elohome (one gadget), Piramie (same template six times), Kigali TOP SHOES (one pair per ad).
10. **Sector patterns:**
    - Food: overhead plate, steam, price ladder in caption (BestPilau).
    - Phones and electronics: model name in a sticker or badge, shop counter, hand fan of phones, unboxing.
    - Beauty and clinic: a talking expert or a skin close-up, a pain question as hook, WhatsApp to book.
    - Real estate: location stack and price label, agent on camera, 4 to 5 rooms.
    - Schools and training: students doing the work, branch phones listed.
    - Cars and travel: vehicles walk-around with website bar; poster-then-footage with a discount badge.
    - Events and bars: poster first frame, then 3 to 4 night clips, offer as a multiplier ("Buy 4, get 5").

## The 10 most common opening lines and badges (verbatim where readable)

1. A price strip at the top: "COMMERCIAL BLENDER / 48,000RWF / 0784695549" (EHA 250).
2. A promo headline with a number: "BEST BURGERS IN KIGALI / PROMO FOR 5K / DON'T MISS"; "PROMO! - HAPPY 3RD ANNIVERSARY" (BestPilau, 35K to 27K).
3. A new-arrival badge: "Now available!" with "Spinning Bikes Have Arrived in Kigali!"; "BETTER INTERNET HAS ARRIVED" (Piramie 4G+).
4. A model-plus-discount badge: "iPhone 18pro and 18pro max are available On discount"; "IPHONE 13 PRO 256GB".
5. A location stack or location in the first line: "KIGALI KICUKIRO / KANOMBE KABEZA / MWITUNDA"; "One bedroom In Gasogi Full furnished 400k | Month".
6. A plain question in Kinyarwanda or English: "Ufite gahunda yo gukora urugendo" ("Do you have a plan to travel?"); "Ready to see your skin exactly how it used to be?"
7. A friendly address to the city: "Kigali, we need to talk." (Inzovu Supermarket).
8. A POV story: "POV: She says 'I'm close' and you have NOTHING at home" (Ando delivery app).
9. A service claim in capitals: "Available 24/7" (Prime Wellness); "FRIDAY UNLOCKED / Buy 4, get 5" (Elevee Lounge).
10. A scare or loss line for B2B: "STOP LOSING CUSTOMERS ONLINE!" (Website Design Rwanda); "Old railing rusting? Staircase looking tired?" (Royal Aluminium).

Also seen: "RENT A CAR, RENT FREEDOM", "New and improved breastfeeding Diras", "Fish lovers!! This is your time to enjoy muhazi tilapia fish!!", and Kinyarwanda price openers such as "KURI 38000FRW TUGUHA IYI TWO IN ONE SMARTWATCH...".

## 5 shot lists the engine can copy

**1. Price-pill service (15 s, internet, solar, installers, subscriptions) - Piramie pattern**
- 0-3 s: price pill pinned at the top for the whole video ("20 Mbps | 20K / month"). Hero image: technician or product holding the item. Text "BETTER [THING] HAS ARRIVED".
- 3-6 s: the freebie ("FREE WIFI ROUTER"), people using it at home.
- 6-9 s: the quality claim ("FAST, RELIABLE").
- 9-12 s: trust ("TRUSTED INSTALLATIONS", a Kigali road or skyline).
- 12-15 s: "Sign up" button, free installation line. Ratio 1:1 or 4:5. Make 6 variants with different hero shots.

**2. Counter seller with a price bar (25 s, phones, gadgets, cosmetics, electronics) - Elohome / EHA 250 / Thierry Phones pattern**
- 0-2 s: seller at the shop counter holds the item up. Blue or yellow bar across the lower third: "[PRODUCT] | [PRICE] RWF | [two numbers]".
- 2-10 s: three uses shown (juice, mango, grains for a blender; ceiling stars, remote, base for a projector). A one-word sticker each.
- 10-20 s: seller says the one reason to buy, in Kinyarwanda. Captions follow.
- 20-25 s: "Free delivery in Kigali. Call or WhatsApp" and the address with a landmark.

**3. Property with a location stack (30 s, houses, plots, rooms) - Hills Props / Samkay / IBRA pattern**
- 0-3 s: three-row location label (city / sector / cell). Agent or presenter in frame, price label in a yellow box top-right.
- 3-8 s: street and gate, plot size sign.
- 8-22 s: 4 to 5 rooms, 3 s each, label each ("4 BEDROOMS", "373SQM"). For plots, a site plan overlaid on the road.
- 22-30 s: WhatsApp badge and number, "Title ready", Property ID.

**4. Weekly event or promo poster (15 s, bar, lounge, restaurant) - Elevee Friday Unlocked / BestPilau pattern**
- 0-3 s: poster with the offer as the headline ("FRIDAY UNLOCKED - Buy 4, get 5"), times, location with landmark.
- 3-10 s: three phone clips of the place and the food (hand pour, plate, crowd).
- 10-15 s: price ladder or offer repeated in a big caption; WhatsApp button, "every Friday" tag.
- Same layout every week; swap offer and picture.

**5. Expert or trade in action (40 s, clinics, schools, repair, beauty) - Derma / Action College / Lou Aesthetic pattern**
- 0-3 s: question card or name card ("DR. [NAME], [CLINIC]", or "Ready to see your skin exactly how it used to be?").
- 3-25 s: either the expert explaining one thing in Kinyarwanda with sentence captions, or the students doing the work (hands, tools, close-ups).
- 25-35 s: one proof beat (before/after, a student result, a certificate).
- 35-40 s: phone numbers per branch in the lower third, WhatsApp book button, landmark address.

---

# Long runners (round 5, 17 Oct 2026)

## How this was made, and what is missing

- Source: Meta Ad Library, Rwandan active video ads, started before 15 August 2026 (60+ days live on 17 October). I pooled every Rwandan ad from my searches (372 ads with text) and found 69 that started before 15 August.
- **About half of those 69 are the "Tajyira Akakanya Gukorere Akayabo Kama Faranga..." income-chain posts and "earn 30K a day" recruiters** (about 30 ads from 12 or more pages, running since June and July). They are the longest-running Rwandan ads in the library after the sector ads. That is a warning for the whole "long running = works" idea: scam-style ads run long because they are cheap and constantly re-posted. I skipped all of them. Add "skip" logic for this pattern in any future mining.
- The 20 rows below are non-scam, are marked `long_runner: true` in `facebook.jsonl`, and span 97 to 565 days. 10 are rows I had already watched or logged; 10 are new this round (`round: 3`).
- **Chrome stopped mid-round.** While running more searches, the Facebook tab crashed ("Page crashed") and the debugging port 9334 went down, so I could not watch any new video this round. The new rows are text and card only (`watched: false`, with a `video_not_watched_reason`). `hook`, `structure`, `on_screen_text` and `why_it_works` are `null` on them. I did not restart or relaunch the owner's Chrome. I need the lead or the owner to start it again (or say if I may use a separate headless Chrome for the public Ad Library) to watch the new rows.
- `advertiser_live_ads_seen` is a lower bound: the number of that advertiser's ads my searches saw, not the true total.

## The 20 long runners

| Days | Advertiser (sector) | Live ads seen | Length | Language | Phone in caption | Price or offer |
| --- | --- | --- | --- | --- | --- | --- |
| 565 | Judith Safaris (tours) | 1 | 87 s | en | no | no |
| 495 | tuza_officall (shoes) | 1 | 6 s | en | yes (DM number) | free delivery |
| 468 | homeofhybrid (car hire) | 1 | 35 s | en | no (in video) | no |
| 235 | SagaPoll (app) | 1 | 46 s | mixed | no | no |
| 229 | HT26 Paris (wine, French) | 1 | 27 s | fr | WhatsApp link | no |
| 228 | petal_florist_kigali | 1 | 3 s | en | no (DM, address) | no |
| 228 | isaro_interiors_design | 1 | 36 s | en | yes | no |
| 222 | Derma Skin Clinic Rwanda (clinic) | 17 | 43 to 90 s | en and rw | yes, 2 numbers | no |
| 167 | avenue group (furniture) | 1 | 48 s | en | yes | no |
| 166 | Dilara Collection (furniture) | 1 | 18 s | en | yes | no |
| 164 | framegrw (travel) | 1 | 49 s | en | on poster | up to 35% off |
| 157 | British English Language Institute | 1 | 88 s | en | yes | no |
| 145 | Rweshereka Adolphe (travel) | 1 | 23 s | en and rw | no | no |
| 131 | thermalgridafrica (hot water) | 1 | 85 s | rw | yes | discount, 2 weeks |
| 124 | LUNA Residence (hotel) | 1 | 54 s | en | WhatsApp | from 20,000 RWF a night |
| 106 | Taxacle (tax services) | 1 | 69 s | en | no | no |
| 102 | AutoXpress Rwanda (auto service) | 2 | 67 s | en | no | no |
| 101 | Website design Rwanda | 1 | 73 s | en | on poster | 20% off |
| 97 | Primeskincare Rwanda | 1 | 5 s | en | yes | free consultation, delivery |
| 96 | Kex Group (projector) | 1 | 42 s | en | yes (in video) | 40,000 RWF, free delivery |

## What they have in common

- **Length**: median 48 s, a wide spread (3 to 90 s). Rwandan long runners are not short. Two thirds are over 35 s. The exceptions are three tiny loops (3 s flower bouquet, 5 s skincare, 6 s shoes) that cost almost nothing to run for months.
- **Hook**: where I watched them, the first frame carries a label or an object, not a person talking: a title ("RENT A CAR, RENT FREEDOM"), a "NEW COLLECTION" tag, a product (the bouquet, the galaxy projector, a poster slide). Caption openers are plain statements or one question ("Need a furniture upgrade?", "Need a place to stay in Kigali?", "Hair loss is not the end of your story").
- **Price**: only 7 of 20 show a price or an offer. This differs from the new, short-lived Rwandan ads, where the price strip is almost universal. Long runners are mostly services and considered purchases (clinic, school, travel, furniture, internet), where the offer is a visit or a consultation.
- **Phone and ordering route**: 11 of 20 put a number in the caption; 5 use the WhatsApp button, 2 "Call now", 5 an Instagram or Messenger profile. The seven with no number in the caption (the SagaPoll app, the tours, Taxacle, AutoXpress) rely on the button.
- **Language**: 17 of 20 are English; 1 French, 1 mixed, and only thermalgridafrica is mostly Kinyarwanda. Derma alternates English and Kinyarwanda by video, same address block each time. The Kinyarwanda ads in my newer, short-lived set are mostly plots and cheap goods; the long runners are the opposite, a more English, service-led, mid-to-high price group.
- **Hashtags**: 0 to 12, median 2 to 3, and 8 of 20 have none; the clinic's block of eight is the same in every ad.
- **Volume**: the advertiser with the most live ads (Derma, 17 seen) has run them since March. One advertiser, one explainer or testimonial format, many variants.
- **Not seen in any**: a MoMo mention, a countdown timer, or an income claim (excluded by design).

## 5 rules for the engine from the long runners

1. Build campaigns, not one clip: a template that outputs 8 to 15 variants of one format (the clinic's one-topic-per-video series, Piramie's five-beat template), each with its own hook line, all sharing the same address, number and button.
2. Allow long, talking-person videos for services: 45 to 90 s with a named expert or owner, sentence-by-sentence captions, and a fixed contact block. Keep a 3 to 6 s still-image loop as the cheap always-on variant for gifts, flowers, shoes and skincare.
3. For services and considered purchases, the offer can be "book a consultation / visit us / free quote" instead of a price; require a price only for goods. Show the price when there is a real one (from 20,000 RWF a night, 40,000 RWF + free delivery).
4. Put the ordering route in two places: the platform button (WhatsApp, Call now, or Messages) and the caption (number and landmark address). Never rely on the button alone.
5. Default to English with Kinyarwanda touches for services, hotels, clinics and schools, and Kinyarwanda for plots, household goods and baby products; offer the language switch per ad, not per account. And do not use "long running" as a quality signal on its own: filter out income-claim chains and recruiters before the engine learns from them.
