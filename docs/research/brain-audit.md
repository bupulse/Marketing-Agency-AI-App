# Brain audit of the 33-template sweep

The motion engine's sweep (every template once, Samsung Galaxy A56 at Nova Phones Kigali, 420,000 RWF, WhatsApp, the brain's
research block on) scored with the brain's own scorers (`lib/video-engine/brain/score.ts`): `scoreDesign` with the voice on, and
`scoreCaption`. Platform by template category: TikTok for the TikTok templates, Facebook for marketplace and ads, Instagram
otherwise. **The sweep briefs carried no platform**, so the designer used its default safe area (y 0.12 to 0.82, x 0.07 to 0.93)
and default hashtags; the column "outside own box" counts text outside that default, which is the designer's own rule.

Made by `BRAIN_AUDIT=<sweep dir> npx vitest run tests/video-engine/brain.test.ts -t "brain audit"`. Means: design 91.7, caption 96.3.

| Template | Category | Platform | Style | Design | Caption | Outside own box | Design misses | Caption misses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3d-title-drop | 3d | instagram | showcase | 90 | 100 | 5 | safe-area-contact, safe-area, say-length | none |
| brand-story | ads | facebook | brand | 96 | 92 | 0 | phone-bar | hashtag-count |
| chrome-luxe | 3d | instagram | luxury | 95 | 100 | 0 | safe-area-contact | none |
| colour-options | marketplace | facebook | list | 90 | 92 | 8 | safe-area-contact, safe-area, say-length | hashtag-count |
| colour-pop | motion | instagram | showcase | 93 | 100 | 6 | safe-area-contact, safe-area | none |
| confetti-launch | 3d | instagram | showcase | 93 | 100 | 5 | safe-area-contact, safe-area | none |
| dark-minimal | motion | instagram | luxury | 89 | 85 | 1 | phone-bar, safe-area, caption | first-line, caption-price |
| event-poster | promo | instagram | list | 91 | 89 | 0 | phone-bar, safe-area-contact | first-line |
| floating-product-reveal | 3d | instagram | showcase | 95 | 100 | 1 | safe-area-contact | none |
| glass-cards | 3d | instagram | list | 95 | 100 | 1 | safe-area-contact | none |
| golden-hour | cinematic | instagram | luxury | 85 | 89 | 2 | phone-bar, safe-area-contact, safe-area, text-crowd | first-line |
| hypermotion | motion | instagram | showcase | 88 | 85 | 1 | safe-area-contact, say-length, caption | first-line, caption-price |
| ice-splash | product | instagram | showcase | 92 | 100 | 1 | safe-area-contact, text-crowd | none |
| kigali-market | cinematic | instagram | brand | 88 | 100 | 1 | phone-bar, safe-area-contact, safe-area | none |
| kigali-price-first | ads | facebook | direct | 97 | 92 | 1 | say-length | hashtag-count |
| kinetic-type | motion | instagram | showcase | 92 | 100 | 10 | safe-area-contact, say-length | none |
| macro-detail | product | instagram | showcase | 90 | 100 | 9 | safe-area-contact, safe-area, say-length | none |
| marketplace-listing | marketplace | facebook | list | 97 | 92 | 1 | say-length | hashtag-count |
| offer-flash | ads | facebook | direct | 96 | 80 | 0 | phone-bar | caption-cta, hashtag-count |
| price-drop | promo | instagram | direct | 95 | 100 | 0 | safe-area-contact | none |
| product-hero | product | instagram | list | 93 | 100 | 9 | safe-area-contact, safe-area | none |
| showroom-turntable | 3d | instagram | showcase | 90 | 100 | 8 | safe-area-contact, safe-area, say-length | none |
| story-cinematic | cinematic | instagram | luxury | 93 | 100 | 0 | phone-bar, say-length | none |
| studio-turntable | product | instagram | showcase | 86 | 100 | 0 | phone-bar, safe-area-contact, safe-area, say-length | none |
| tiktok-3-reasons | tiktok | tiktok | list | 90 | 100 | 0 | safe-area-contact, safe-area, say-length | none |
| tiktok-gadget | tiktok | tiktok | direct | 90 | 89 | 1 | safe-area-contact, safe-area, say-length | first-line |
| tiktok-secret | tiktok | tiktok | direct | 93 | 100 | 0 | safe-area-contact, safe-area | none |
| tv-spot | ads | facebook | brand | 88 | 92 | 1 | phone-bar, safe-area-contact, say-length | hashtag-count |
| typography-poster | motion | instagram | list | 92 | 100 | 1 | safe-area-contact, say-length | none |
| ugc-before-after | ugc | instagram | showcase | 90 | 100 | 1 | safe-area-contact, safe-area, text-crowd | none |
| ugc-pov | ugc | instagram | showcase | 89 | 100 | 2 | phone-bar, safe-area-contact, safe-area | none |
| ugc-review | ugc | instagram | showcase | 93 | 100 | 1 | safe-area-contact, safe-area | none |
| ugc-unboxing | ugc | instagram | showcase | 92 | 100 | 0 | safe-area-contact, say-length | none |

## The three most common misses

1. **design safe-area-contact** in 27 of 33 designs. Example: "Call / WhatsApp 0788 300 400" in scene 1 and 1 more: the price, number or call to action goes under the app's buttons (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
2. **design safe-area** in 17 of 33 designs. Example: "6.7-inch AMOLED screen" in scene 2 and 1 more goes outside the safe area (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
3. **design say-length** in 15 of 33 designs. Example: The say line of scene 5 has 9 words for 2 s (about 2.5 words a second).

All misses by count: design safe-area-contact 27, design safe-area 17, design say-length 15, design phone-bar 10, caption hashtag-count 6, caption first-line 5, design text-crowd 3, caption caption-price 2, design caption 2, caption caption-cta 1.

## The five lowest designs

**golden-hour** (cinematic, instagram, luxury): design 85, caption 89.

- phone-bar (scene 2): The number is missing from scenes 2, 3, 4; keep it on screen from 0 s to the end (a small quiet line is enough for this template).
- safe-area-contact (scene 1): "Call / WhatsApp 0788 300 400" in scene 1 and 1 more: the price, number or call to action goes under the app's buttons (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
- safe-area (scene 2): "6.7-inch AMOLED screen" in scene 2 and 1 more goes outside the safe area (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
- text-crowd (scene 4): Scene 4 has 4 text lines besides the price and number; a luxury template keeps to 2.
- first-line: Put the product and the price or offer in the first 60 characters ("Jumpsuit Diras kuri 18k gusa", "Commercial blender, 48,000 RWF").

**studio-turntable** (product, instagram, showcase): design 86, caption 100.

- phone-bar (scene 1): The number is missing from scenes 1, 2, 3, 4; keep it on screen from 0 s to the end (a small quiet line is enough).
- safe-area-contact (scene 5): "0788 300 400" in scene 5: the price, number or call to action goes under the app's buttons (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
- safe-area (scene 3): "5,000 mAh battery" in scene 3 goes outside the safe area (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
- say-length (scene 5): The say line of scene 5 has 9 words for 2 s (about 2.5 words a second).

**hypermotion** (motion, instagram, showcase): design 88, caption 85.

- safe-area-contact (scene 1): "📞 0788 300 400" in scene 1 and 5 more: the price, number or call to action goes under the app's buttons (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
- say-length (scene 4): The say line of scene 4 has 8 words for 2 s (about 2.5 words a second).
- caption: The post caption is missing the price.
- first-line: Put the product and the price or offer in the first 60 characters ("Jumpsuit Diras kuri 18k gusa", "Commercial blender, 48,000 RWF").
- caption-price: Add the price (420,000 RWF).

**kigali-market** (cinematic, instagram, brand): design 88, caption 100.

- phone-bar (scene 2): The number is missing from scenes 2, 3, 4; keep it on screen from 0 s to the end (a small quiet line is enough for this template).
- safe-area-contact (scene 1): "Call or WhatsApp 0788 300 400" in scene 1: the price, number or call to action goes under the app's buttons (instagram: y 0.12 to 0.78, x 0.07 to 0.93).
- safe-area (scene 2): "In stock now: black, light blue, pink" in scene 2 and 1 more goes outside the safe area (instagram: y 0.12 to 0.78, x 0.07 to 0.93).

**tv-spot** (ads, facebook, brand): design 88, caption 92.

- phone-bar (scene 2): The number is missing from scenes 2, 3, 4, 5; keep it on screen from 0 s to the end (a small quiet line is enough for this template).
- safe-area-contact (scene 6): "WhatsApp / Call 0788 300 400" in scene 6: the price, number or call to action goes under the app's buttons (facebook: y 0.08 to 0.85, x 0.07 to 0.93).
- say-length (scene 4): The say line of scene 4 has 11 words for 3 s (about 2.5 words a second).
- hashtag-count: 6 hashtags; captions that work on Facebook use 0 to 3.

## Whose fault (17 October 2026)

### The designer's (for the motion engine: designer.ts and the templates)

1. **The platform never reached the designer.** The sweep briefs had no platform field, so the designer used its default safe area
   (bottom 0.82, right 0.93): phone bars end at y 0.82 to 0.83 and text reaches x 0.90 to 0.93. Instagram and TikTok cover
   the bottom 20%, and TikTok and Shorts cover the right edge, so 27 of 33 designs put the price, the number or the call to
   action under the app's buttons. Fixes: pass the platform field in every brief (DesignBrief already has it); when none is given,
   make the default the strictest common box (y 0.12 to 0.78, x 0.07 to 0.85) and say "the phone bar ends at y 0.78 at the
   latest". Text outside even the designer's own default box (the "outside own box" column: kinetic-type 10, macro-detail 9,
   product-hero 9, showroom-turntable 8, colour-options 8) is a plain miss; validate.ts could pull such boxes inside.
2. **Voice lines too long for their scenes** (15 of 33): 8 to 13 words for 1.3 to 3 s. The prompt says about 2.5 words a
   second; it should give the counts outright ("2 s: at most 5 words; 3 s: at most 7") or the validator should stretch the
   scene or flag the line.
3. **Captions:** start with the product and the price (5 of 33 did not); always include the price when the brief has one
   (dark-minimal, hypermotion left it out); always say how to order (offer-flash did not); hashtags by platform: Facebook 0
   to 3, TikTok and Instagram 4 to 6, Shorts 1 to 3 (all six Facebook designs wrote 5 or 6).
4. **offer-flash** is a direct offer ad but dropped the number in scenes 2 to 4: its template direction should ask for the
   phone bar from the first frame to the last, as kigali-price-first does.
5. **Few words where the template says so:** golden-hour put four lines in one scene; luxury and cinematic directions should
   say "at most two short lines per scene; the features go in the voice". Showcase templates stacked three features and a
   tagline in one scene (ice-splash, ugc-before-after): one feature per scene.
6. **Template lengths** (templates.ts seconds, an owner decision): colour-options 10 s, tiktok-secret 10 s, marketplace-listing,
   offer-flash, tiktok-gadget and ugc-pov 12 s are below the research range for their platform (15 to 25 s for products,
   offers and UGC on TikTok and Facebook). The scorer no longer counts this against a design that keeps the requested length.

### The scorer's (fixed in brain/score.ts)

Before these fixes the same 33 designs averaged 89.3 (design) and 96.3 (caption).

1. **The number in every scene:** owner decision (17 October): every template keeps the number on screen in every scene;
   luxury, cinematic and minimal templates (dark-minimal, chrome-luxe, golden-hour, story-cinematic, brand-story, tv-spot,
   kigali-market) as a small quiet line (size about 0.03) with the full contact at the end. The check accepts any size, so
   a quiet line passes; until the templates change, these designs still miss it (the misses below are real for now).
2. **Lines per scene** by style: luxury 2, direct, brand and showcase 3, list, poster and card templates 5 (glass-cards,
   typography-poster, event-poster, product-hero, tiktok-3-reasons, the marketplace templates).
3. **The price early** follows the format: in the hook only when the format's first beat carries it (1.5 s on Facebook for
   direct ads), otherwise by the beat that shows it (a before/after shows it after the result); luxury and brand templates
   may keep it for the end.
4. **Length:** a design that keeps the requested length passes; the research range is a template question, not the design's.
5. **Scene count** follows the format's cut rhythm (kinetic typography may use up to 8 scenes in 10 s).
6. **Safe area** is split: the price, the number or the call to action under the app's buttons costs 7 points; other text 3;
   a giant word that runs off the canvas on purpose, or a giant background word behind the product (size above 0.22, depth
   0.35 or less: "GALAXY", "5G"), is not counted.
7. **Reading numbers** the way factcheck.ts does: "Samsung Galaxy A56 • 420,000 RWF" was read as 56,420,000, and a phone
   number on one line swallowed the price on the next (the "0" in showroom-turntable). A space or a bullet never joins two
   numbers now, phone numbers are taken out first, and digits glued to letters (A56, 5G) are model names, not amounts.

