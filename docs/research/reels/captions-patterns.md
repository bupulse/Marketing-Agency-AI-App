# Rwandan business captions and hashtags (round 4)

## How reliable this is

- `captions.jsonl` has 125 rows: 98 Meta Ad Library ads (91 Rwandan, 7 Kenyan, Ugandan or Tanzanian), 6 captions from reels in the owner's Facebook feed, and 21 TikTok captions already saved in `tiktok.jsonl` (16 Rwandan, 5 Kenyan or Ugandan). 111 rows are Rwandan.
- Captions are verbatim. Ad Library captions are the "primary text" of live ads, so they are written by the advertiser, not scraped from comments. They do not show likes or comments (`null`). Facebook reel and TikTok rows carry the counts the page showed.
- I did not read captions from ordinary Facebook business Page posts: the logged-in feed showed mostly music, comedy and news, and the Ad Library gave far more business captions.
- The `note` field is generated from what the caption contains (price, phone, place, delivery, structure) plus its opening line. It is not a judgement of sales results. Treat it as a checklist of what is there and what is missing.
- `kinyarwanda_pct` is a rough lower bound from a word list. A caption that is nearly all Kinyarwanda scores 60 to 100. A mixed one can score low. `language_mix` is "rw" at 40 and above. Counts below use that label.
- Skipped on purpose: the "Tajyira Akakanya Gukorere Akayabo Kama Faranga..." chain-style income posts (about a dozen pages post copies), "work and earn 30K a day" recruiters, the "Business wakora uyu munsi ugasezera k'ubukene" TikTok, affiliate or make-money-online pages, casino bonus ads, and foreign exporters. None is in the file.
- Sectors in the file: restaurants 13, real estate 11, shop-electronics 9, phone shops 9, beauty 6, school 6, home goods 6, education app 6, jewellery 5, shoes 5, services 5, plus smaller groups (clinic, hotel, travel, salon, bakery, baby shop, bar, car hire, internet, hardware).

## Numbers

**Hashtags per caption**

| Platform | Rows | Median | Range | With none |
| --- | --- | --- | --- | --- |
| Facebook ads (Ad Library) | 98 | 1 | 0 to 15 | 48 (49 percent) |
| Facebook ads that use any | 50 | 5 | 1 to 15 | |
| Facebook reels (feed) | 6 | 0 | 0 to 5 | 4 |
| TikTok | 21 | 5 | 0 to 8 | 2 |

Facebook business captions mostly skip hashtags. When they use them, they use 3 to 6 at the end, often copied from TikTok (#fyp, #viral, #foryou). TikTok captions nearly always carry them.

**Hashtags that recur** (count across all 125 rows): #Kigali 17, #Rwanda 14, #fyp 6, #viral 5, #KigaliRwanda 5, #RwandaBusiness 5, #inkokokoko 4, #VisitRwanda 3, #KigaliHomes 3, #foryou 3. Sector sets repeat as a block: the clinic reuses the same eight (#dermaskinclinic #acnetreatment #skindiseases #dermatologykigali #skinclinicrwanda...). Others seen: #KigaliRealEstate, #RwandaRealEstate, #HouseForRentKigali, #KigaliFood, #KigaliTikTok, #RwandaTikTok, #RwandaBusiness, #KigaliBusiness, #KigaliShopping, #tiktokeastafrica with five flags, #homedecor. #MadeInRwanda did not appear in any of the 125 captions (one bakery ad I did not include uses it), so it is rare. Brand hashtags (#BestPilau-type names, #EliteParadise, #DareRwanda) appear once per business.

**Caption length**
- Facebook ads: median 48 words (316 characters), middle half 171 to 511 characters, longest 1,061. Median 7 lines.
- TikTok: median 25 words (184 characters), one line (no line breaks).
- Facebook reels: median 10 words. Short, no phone.
- By sector (median characters): restaurant 255, real estate 305 (9 lines), school 622.
- Emoji: Facebook ads median 3; 30 of 125 captions open with an emoji (often 🔥 🚨 ⚠️ 🏡 ✨ or a flag 🇷🇼). TikTok median 0.
- Structure: short shop captions (price, size, number) run 20 to 60 characters. Property and clinic captions are checklists, one fact per line with a ✅ or an icon.

**What is in the caption (111 Rwandan rows)**: phone or WhatsApp 63 percent, place or address 77 percent, price or offer 58 percent, a call to action 71 percent, delivery promise 30 percent. All four of phone, price, place and call to action appear in 30 rows.

**Language, Rwandan rows**: English 77, mixed 19, Kinyarwanda 14, French 1. English is still the default, even on pages writing to local buyers. Kinyarwanda dominates in property plots ("IBIBANZA 28 BIGURISHWA"), cheap goods (Eguriro shop, in capitals), construction and sanitation (SATO), baby products, and one-line shops ("GURA NAWE ni free delivery twandikire cg uduhamagare 0790 583 341"). Mixed is the normal voice of restaurants, phones and fashion. French appears once, in a wine post.

**How phone numbers are written (120 numbers)**
- Local 10 digits with no spaces: 78 (0788218567). With spaces: 7 (0796 680 413).
- International with spaces: 22 (+250 791 902 678). Without spaces: 10 (+250784343057). With dashes: 3 (+250-739-095040).
- Two numbers are common: "0796500650 / 0787500662", "0788218567 and 0795579050". Always 07x, for Rwanda MTN and Airtel prefixes: 078, 079, 072, 073.
- The label before the number: "Call/WhatsApp:" (most common), "Call&WhatsApp:", "Call or WhatsApp", "Info:+250784343057 WhatsApp", "TEL:", "Phone:", "📞", "📲", "☎️", "Dm", "call&tsapp", "wastp". In Kinyarwanda: "Duhamagare cyangwa utwandikire kuri WhatsApp: 0788709927", "twandikire cg uduhamagare", "uhamagare kuri 0788916286".
- The number often leads the caption: "0796 680 413 Stainless Steel Balconies...", "0 798 287 493 | Howear HW8 Pro...".

**How prices are written**: "RWF 20K/month", "20,000 RWF", "48,000RWF", "38000FRW", "18k gusa", "12,000 rfw", "Price:3.5M", "130,000,000 RWF | Kiraganirwa­ho" (negotiable), "KURI 33K", "from 500 RWF", ladders with arrows ("35K → 27K"), "was / now". "K" and "M" shorthand is common for plots and shoes, and the currency word comes in six spellings (RWF, FRW, Rwf, rfw, frw, rwf), so any checker must accept all of them.

**Recurring words and phrases** (all counts are captions in the file)
- English: "Free delivery" 18, "Available" 19, "Price" 19, "Order" 17, "Location" 12, "Contact" 10, "Limited stock", "Payment after delivery/receiving" 3, "Promo" 7, "% off" 5, "Every Friday" 3, "Hurry before the promo ends", "Now", "Today", "Only", "From".
- Kinyarwanda: "Duhamagare / hamagara" 9, "twandikire / utwandikire" 8, "kuri" before a price 16 ("kuri 18k gusa"), "gusa" (only) 5, "ubuntu" (free) 2, "ntucikwe" (don't miss out) 3, "tuguha" (we give you), "tuyikujyezaho" (we deliver it to you), "tuvugishe" (talk to us), "igiciro" (price), "kiraganirwaho" (negotiable), "abakiriya bacu barishimye" (our customers are happy), "murakaza neza" (welcome, spelled "murakazaneza" once), "Ibyangombwa birahari" (documents ready), "Ushaka ... " (if you want).
- "Murakaza neza" and "Tugurisha" were less common than expected. Tugurisha did not appear; the verbs used are "igurishwa / bigurishwa" (is / are for sale) and "Hamagara / Duhamagare".

## What works (observations, not tested results)

- Real estate Ad Library captions are the most structured: icon bullets for price, rooms, plot size, location, title status, then a number (Hills Props, IBRA, Samkay).
- Restaurants state one price or a price ladder and the delivery numbers (Best Burgers, BestPilau, Magic Chef). TikTok restaurants add a weekday ("Every Tuesday") and a landmark ("Kicukiro, Sonatube KK 334 St"), which is a habit worth copying.
- Phone and electronics captions name the model, the storage or spec, and the number. The best add warranty and home delivery.
- Clinics and schools write long, with a hook question or a customer story, the address, two numbers and eight or more hashtags.
- Weak captions: hashtags only (SAPA bakery, cardgames, TikTok #RwandaTikTok sets), "Price: Affordable" with no number, or no phone at all.

## 10 rules for the engine's caption writer

1. Start with what is sold and the price in the first line: "Jumpsuit Diras kuri 18k gusa", "Commercial blender, 48,000 RWF". The first 60 characters must hold the product and the price or offer.
2. Always include the contact: a Rwandan number in 07xx format, written as "Call/WhatsApp: 0788 123 456" (spaces in groups of 4-3-3 read well, but also accept 0788123456 and +250 788 123 456). Allow a second number. Never invent a number: it must come from the owner's profile.
3. Name the place with a landmark, not only a district: "Kicukiro, Sonatube, KK 334 St", "Makuza Peace Plaza, Room 35", "Kimironko, KG 35 Ave". Use a 📍 line.
4. Price format: accept and write RWF as "20,000 RWF" by default, with "K" and "M" shorthand only where the owner uses it ("18k", "130M"). When there is a discount, show old and new ("35K → 27K") or a percentage plus a price.
5. State the trust line the sector uses: "Free delivery in Kigali", "Payment after delivery", "Delivery available", "Warranty", "Titles ready". Include delivery whenever the owner delivers.
6. One CTA, in the owner's language: "Order on WhatsApp", "Call now", "DM to book", "Duhamagare / Twandikire kuri WhatsApp". For Kinyarwanda captions use "Duhamagare" or "Twandikire", not literal translations of "Click the link".
7. Match the language mix to the audience: Kinyarwanda for plots, houses, cheap goods and baby products; English for hotels, clinics, tech and beauty; a mixed caption (Kinyarwanda hook, English product name) for food and fashion. Keep product names, models and RWF in their original form.
8. Layout: one fact per line with an icon for property, clinic and school captions (🏡 💰 🛏️ 📍 ✅ 📞); a single line for a plain product. Aim for 150 to 350 characters for shops and food, 250 to 500 for property and services, and cut anything over 600. TikTok and reel captions: one or two lines, then hashtags.
9. Hashtags: Facebook 0 to 3 (city plus sector, for example #Kigali #KigaliFood); TikTok and Instagram 4 to 6 (#Kigali or #KigaliTikTok, #RwandaBusiness, one sector tag, one brand tag, #fyp if wanted). Do not stack 10 or more. Use #Kigali and #Rwanda only when true; add #MadeInRwanda only for goods made in Rwanda.
10. Never write income claims, "earn X a day", guaranteed results, or miracle cures, and never invent a customer, a price, a stock level or a discount. The caption check should reject any of these and any caption that has no price, no contact and no place at once. A caption with none of price, contact, place or call to action is only a hashtag line and fails.

## 5 model captions (one per sector, with placeholders)

**Shop (electronics or fashion), English with Kinyarwanda price word**
```
🔥 [Product, model] kuri [18,000] RWF gusa
✅ [Feature 1] · [Feature 2] · [Colours / sizes]
🚚 Free delivery in Kigali · Pay on delivery
📍 [Shop, building, room], [Neighbourhood]
📞 Call/WhatsApp: [0788 123 456]
#Kigali #[Sector]
```

**Restaurant, mixed**
```
🍔 [Dish] + [side] for only [5,000] RWF [every Tuesday]
Abakiriya bacu barishimye 😍 ntucikwe!
🚚 Delivery in [Kicukiro, Remera, Kimironko] · [30 min]
📍 [Place], [Street / landmark]
📲 Order: [0788 123 456] / [0795 123 456]
#KigaliFood #[Brand]
```

**Real estate, Kinyarwanda**
```
🏡 INZU NZIZA IGURISHWA I [KABEZA], KIGALI
💰 Igiciro: [130,000,000] RWF | Kiraganirwaho
🛏️ Ibyumba [4] · 🚿 Ubwogero [3] · 🌿 Ubutaka [373] m²
📍 [Sector, District] · [near landmark]
✅ Ibyangombwa birahari
📞 Duhamagare cyangwa utwandikire kuri WhatsApp: [0788 123 456]
Property ID: [HP-001]
```

**Salon or beauty, English with Kinyarwanda welcome**
```
✨ [Service] at [Salon name], [Neighbourhood]
💆 [Service 1] [price] · [Service 2] [price] · [Service 3] [price]
🕘 Open [Mon–Sat, 8am–8pm] · Walk-ins welcome
📍 [Building / landmark], [Neighbourhood]
📲 Book on WhatsApp: [0788 123 456]
Murakaza neza! 💕  #Kigali #[Salon]
```

**School or training, English**
```
🎓 [Course] intake open: starts [date]
✅ [Duration] · [Practical / certificate] · [Evening classes]
💰 Fee: [150,000] RWF (pay in [2] parts)
📍 [Campus, area, landmark]
📞 Call/WhatsApp to enrol: [0788 123 456]
Limited seats: register by [date].  #Kigali #[Course]
```
