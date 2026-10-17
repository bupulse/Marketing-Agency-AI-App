# The creative brain: how the engine operates

The brain is what BuPulse Video Studio knows about **how winning marketing videos are made**, written down as a
database, plus the rules the engine follows when it makes one. The researchers watch real ads and reels on TikTok,
Facebook and Instagram and take notes. The brain turns those notes into choices: which opening to use, what goes on
screen at which second, how to end, what to write in the post, and what never to do.

It is not an AI. It is data and plain rules, so the same brief always gets the same advice, and every piece of advice
points back to the real videos it came from.

Code: `lib/video-engine/brain/` (data in `brain/data/*.json`). Tests: `tests/video-engine/brain.test.ts`.

## What is in it (17 October 2026: TikTok, Facebook, Instagram, YouTube Shorts and the caption corpus)

| Part | Count | What it holds |
| --- | --- | --- |
| Research rows | 538: 383 videos and ads (317 watched first-hand: TikTok 133, Facebook 90, Instagram 58, YouTube Shorts 36), 125 post captions (111 Rwandan) and 30 clips whose 450 comments were read; 8 income-chain posts kept only as what not to copy |
| Hooks (openings) | 62 | The first 2 seconds: the line, what is on screen, where it was seen, real example lines |
| Formats | 10 | Product reveal, UGC testimonial, before/after, unboxing, tour, offer, 3D motion, kinetic typography, tutorial, list or price list |
| Captions | 4 platforms, all researched, 28 formulas including 5 model captions by sector, 10 ways to order, the caption corpus counts |
| Rules | 81 (66 do, 15 don't) |
| Sectors | 11 | Restaurant, phone shop, salon, fashion, real estate, school, car rental, clinic, events, services, and "shop" for everything else |

The Facebook "Rwanda playbook" (round 2) is folded in: its verbatim opening lines (the price pill, the counter seller
with a price bar, the model badge, Kinyarwanda offer lines, "Kigali, we need to talk.", "Available 24/7", the loss line,
the poster first frame), the ordering routes and caption counts, landmark addresses, and the sector patterns.
YouTube Shorts (36 watched) added: Shorts lengths (median 15 s), the title as the hook and the caption, the safe middle
(YouTube's own auto-captions at the top, title and Subscribe button over the bottom quarter), the end pointer (a number, a
QR code, a name to search), no "subscribe" lines, and the splash, explode-and-reassemble, menu-card, step-routine and
door-opening hooks. Real local marketing Shorts are rare (1 Kigali lead-offer clip, 2 Nairobi shop clips), so Facebook
stays the main evidence for Rwandan ads.
Instagram (58 reels watched) added: reels of 6 to 16 s that loop, the first text at 0.0 s, one text style per video,
the before shown first with one lowercase word on Instagram (the result first on TikTok), the right 15% of the frame left
to the app's buttons (a small shop or phone line in the lower-left corner is the one exception), a comment keyword beside
the number, the platform's own "AI-generated" label, and the empty-frame, owner-with-stock and "this is what {price}
buys you" hooks. East Africa is thin there (7 rows).
TikTok round 2 (40 Kigali clips for salons, fashion, transport and travel, schools, clinics and pharmacies) added: product
sectors lead with the price, clinics and schools with trust and numbers ("since 1969", "6 Branches", the insurers, "17
SCHOOLS"); a clean CONTACT US card at the end; and the sound rules from 30 clips (12 carried by text, 11 by the picture,
7 by a subtitled speaker): never depend on audio, a library music mood per sector (afro for salons, fashion and travel;
calm for clinics and schools; never a trending track), a voice only when a person carries the clip. Each sector's mood
and voice go into the designer's brief as a "Sound:" line.
What viewers ask (450 comments on 30 TikTok business clips, `tiktok-comments.jsonl`; only the clip summaries are indexed,
as `cm-` rows, with the clip's comment count as its signal) added: the full price with its condition on screen (21% of
comments ask the price, 69 of 94 on clips that show none; a shown "8k" answered "18k" was called a lie), the area and a
landmark in the last 3 seconds, a labelled number ("WhatsApp …"), the caption's first line pre-answering the standard
questions, insurers on screen for clinics, a real shop in frame (two clips drew "is this AI?"), and no bare "Inbox"
replies. Only Rwandan clips are cited for Rwandan findings; the Kenyan, Nigerian, Tanzanian and Chinese-campus clips keep
their own country (or none).

## The pipeline, step by step

1. **Brief.** The owner picks a product, photos, a template (or lets Claude choose), a length and, soon, the platform.
   The studio already knows the business: name, what it does, language, phone, price.
2. **Brain selection.** Before anything is designed, the brain reads the brief and decides:
   - **the sector** (from words like "iPhone", "bedrooms", "braids"; "shop" when nothing matches);
   - **the format** (from the template; otherwise the sector's best format that the chosen engine can make);
   - **three hook options**, ranked (see "How hooks are ranked");
   - **the timeline**: the format's beats stretched or squeezed to the requested length (the hook and the ending keep
     their length, the middle shares the rest, and very short videos drop middle beats);
   - **the rules** that apply (only the ones for this engine, this format, and the facts the brief has: no phone-bar
     rule when there is no phone);
   - **the caption formula** for the platform;
   - **the language**: on-screen text in the business's language; the voice speaks English when the business writes in
     Kinyarwanda or Swahili (the voice cannot speak them).
3. **Claude designs (motion engine) or Claude writes the Seedance prompt.** The brain's choices go into Claude's brief
   as a short block, "What works for this kind of video" (at most about 900 tokens, roughly 600 words). Claude
   still sees the photos and writes the design; the brain tells it what the research says works.
   - For the **motion engine**, the block says what goes on screen at each second, where the price and the number go,
     and what to write in the caption.
   - For **Seedance**, the block says what to film at each second and to keep the frame free of text: BuPulse puts the
     price strip and the phone bar on top afterwards (Seedance garbles letters).
4. **Render or film.** The motion engine draws the video on our own renderer (free). Seedance films the clip (paid).
5. **Voice-over.** ElevenLabs reads the lines. The brain's rule: the voice starts by half a second, music stays under
   it, and numbers are said the way people say them.
6. **Caption.** Claude writes the post text with the brain's formula: price in RWF, the area and a landmark, delivery
   only if true, the number twice, 3 to 4 hashtags with the city.
7. **Post.** The owner posts (or schedules). Making 3 to 5 versions with different hooks is a brain rule: the winning
   advertisers keep many versions running and never replace the best one.

## How research keeps feeding it

1. The researchers add rows to `docs/research/reels/tiktok.jsonl`, `facebook.jsonl` and (soon) `instagram.jsonl`, and
   write their patterns files. The brain never edits their files.
2. Run `node lib/video-engine/brain/ingest.ts`. It reads every row and updates the index
   (`brain/data/evidence.json`): each row gets a short id (`tt-097`, `fb-011`, `ig-001`), its country, its date (a
   TikTok link holds its upload date; the Ad Library shows when an ad started), and its **strength** (0 to 1: likes on
   TikTok on a log scale, days running on Facebook, where a year counts 1). Ids never change once given, even if rows
   move.
   A row is found again by its URL, so filling in its hook later keeps its id. `--no-new` refreshes the rows already
   indexed and leaves out rows a researcher is still writing.
   **Income chains and scams are filtered before the brain learns from age.** About half of the longest-running Rwandan
   ads in the Ad Library are income-chain posts ("Tajyira Akakanya Gukorere Akayabo…", "earn 30K a day" recruiters) and
   MoMo-screenshot "proof": they run long because they are cheap and re-posted, not because they sell. Such a row is marked
   `scam`, its days running and variants never count as strength, and only the fake-income and income-promise don'ts may
   cite it (the test fails otherwise).
3. New hooks, rules and sector notes are added by hand to the JSON files (this is the curating step: the brain agent
   reads the new patterns and folds them in). The test fails if any hook, rule or sector cites a row that does not
   exist, or if a row the brain cites no longer matches the researcher's file.

When the Instagram research and the Facebook "Rwanda playbook" are ready, step 2 picks up `instagram.jsonl` by itself;
step 3 adds Instagram to the hooks' platforms, replaces the interim Instagram caption guide, and adds the playbook's
rules (marked `rwanda`).

## How hooks are ranked

Each hook gets points; the three highest are offered. A hook is never offered if it needs a fact the brief lacks (no
price, no price hook; no phone, no "number on screen" hook) or if the engine cannot make it (3D giant words are Claude
only).

| Points | For |
| --- | --- |
| up to 25 | **Evidence**: how many research rows show it, how strong they are (likes or days running), first-hand rows count more than articles |
| 20 | **Platform**: seen on this platform (Instagram and YouTube Shorts borrow TikTok's for now, 12) |
| 25 + up to 20 | **Sector**: made for this sector, plus a bonus for the sector's own top picks |
| 15 + up to 10 | **Format**: made for this format, plus a bonus for the format's own top picks |
| 3 or 12 per fact | **Fits the facts**: 3 for a common fact it uses (price, phone, offer), 12 for a rare one (an old price for "was / now", a location, the owner's own claim, a presenter, a weekly series) |
| up to 10 | **Local**: seen in Rwandan ads (East African ads count half) |
| up to 10 | **Recency**: seen in the newest year of research |

## Worked example 1: a Kigali phone shop on Facebook

Brief: "Kigali Phones", iPhone 13 and Samsung Galaxy, price given, WhatsApp number given, content in Kinyarwanda,
15 seconds, Facebook, the motion engine.

- **Sector**: phone shop. **Format**: product reveal (the phone shop's first choice). 15 s is inside Facebook's 15 to
  25 s for this format.
- **Hooks offered**:
  1. *Number on screen, product in hand* (130 points): hands turn the phone, the WhatsApp number fixed on screen from
     the first frame. Seen: "+250 785 478 140" (kigaliphones), "Whatsapp/Call: 0796148484" (homeofhybrid, 468 days).
  2. *Price banner from frame 0* (118): "48,000RWF", "PRICE 28K", "Spinning bike / Price: 500k".
  3. *Seller at the counter, price bar below* (116): the seller holds the phone up behind the counter, a blue or yellow
     bar in the lower third with the model, the price and two numbers (Elohome, 8 ads live; EHA 250).
- **Timeline**: 0-2 s the phone moving in a hand with the price strip and phone bar; 2-5 s close-up doing its job;
  5-10 s two more angles or colours; 10-13 s the price card and what is included; 13-15 s a clean hero shot with
  "WhatsApp {number}" big in the middle.
- **Rules that bind it** (the first ones): price in the first frame, top third; the number on screen to the end; nothing
  in the bottom 15%; captions burned in; a real shop behind the phone, not a blank studio.
- **Language**: on-screen text and caption in Kinyarwanda (with English for models and prices), the voice in English.
- **Caption**: "{product} PRICE: {price} TEL: {phone} ADDRESS: {area}", with the number twice and #Kigali tags.
- **Don'ts**: no fake M-Money screenshots, no invented "only 3 left", no "cheapest in Kigali" unless the owner wrote
  it, no other app's watermark.

## Worked example 2: a house in Kibagabaga on TikTok (Seedance)

Brief: "4 bedroom house for sale in Kibagabaga", price given, WhatsApp given, English, 15 seconds, TikTok, Seedance.

- **Sector**: real estate. **Format**: tour. TikTok tours that work are 16 to 45 s; Seedance films at most 15 s, so the
  brain keeps the same beats, shorter (it says so in the brief).
- **Hooks offered**:
  1. *Where, what size, how much* (144): three stacked labels "KIGALI / GASABO / KIBAGABAGA" style, then "4 BEDROOMS",
     then the price. Seen: Hills Props ("KIGALI KICUKIRO / KANOMBE KABEZA / MWITUNDA", "4 BEDROOMS", "373SQM") and
     Samkay ("One bedroom In Gasogi Full furnished 400k / Month"), IBRA ("Ibibanza byiza Masaka inyuma Ya Gare Bigurishwa / Price: 16M").
  2. *Price banner from frame 0* (125).
  3. *Whip pan into the tour* (108): a fast move or a gimbal glide into the best room at dusk (the top US tours had
     427K and 433K likes).
- **Timeline for Seedance**: 0-3 s the best view or a whip pan into the living room; 3-10 s the rooms one by one, 2 to
  3 s each, smooth gimbal moves; 10-12 s the outside again; 12-15 s the entrance or the gate. BuPulse overlays the
  location stack, the room labels, the price and "WhatsApp {number}" on top.
- **Rules**: no text in the clip (keep the top third and a lower-middle band calm for the overlay); motion in the first
  frame; a real place; end on a clean shot with space above it.
- **Don'ts**: as above; nothing invented (no "plot 500 m²" unless the owner gave it).

## Scoring a design

After Claude answers, the brain can mark the result out of 100 (`brain/score.ts`), so the studio can show it and the
engine can compare templates. It only checks what a program can measure; taste is still the owner's eye.

- **Motion design** (`scoreDesign`): the hook is on screen within 1.5 s and short; the price is shown (and early, top
  third, on Facebook by 1.5 s) when the brief has one; the number (or another way to order) is in the last scene and,
  when there is a number, in every scene; the last scene has a call to action; every scene moves; all text is inside
  the platform's safe area; the length and the number of scenes fit the format; every scene has a voice line (when the
  voice is on) that fits its length; text lines are short and scenes not crowded; the post caption has the number and
  the price; nothing from the do-not-copy list; no number, discount, stock line or delivery promise that the brief
  does not give.
- **Seedance prompt** (`scoreSeedancePrompt`): time codes from 0 to the clip's length in 2 to 5 shots; motion in the
  first shot (a shot of 2 to 4 s; a before/after opens on the result, which must come first); a clip length Seedance
  films (4 to 15 s); a real place; the "exactly as in the photo" sentence when a product photo is attached; no famous,
  lookalike or child subjects; no invented facts; 60 to 160 words; no text asked for in the frames; references that
  exist; no spoken line without sound or in Kinyarwanda or Swahili; a clean hero shot at the end.

Each failed check says which rule it enforces, why, and in which scene. Checks that do not apply (a price check with
no price) are left out of the 100. BuPulse's own Seedance shot plans score 100; the hand-made sample design scores 90
(the price comes late, one line sits too low, and its caption lacks the price).

The safe area per platform (`SAFE_AREAS` and `safeAreaFor(platform)` in `brain/index.ts`) is the one both the scorer and
the validator use: TikTok and Instagram keep text above 78% of the height, Facebook above 85%, Shorts between 10% and 75%,
and TikTok and Shorts leave the right 15% to the app's buttons.

## Scoring a caption

`scoreCaption(caption, hashtags, brief, { platform })` marks the post text out of 100. It is built on the caption corpus
(`docs/research/reels/captions.jsonl`: 125 real captions, 111 Rwandan), not on guesses:

- the product, and the price or offer, in the first 60 characters (a Short's title: the first 40);
- how to order, including the Kinyarwanda forms sellers use ("Duhamagare", "Twandikire");
- the phone number, in any form the corpus shows (0788218567, 0788 218 567, +250 788 218 567, +250-788-218-567). The
  check found the number in all 74 corpus captions that have one;
- the price, in any form (20,000 RWF, 48,000RWF, 38000FRW, 18k gusa, Price:3.5M);
- where the business is (a 📍 line, a landmark), when the brief has a place, and the delivery line when it delivers;
- hashtags as the platform's sellers use them: Facebook 0 to 3 (half of Rwandan ads use none), TikTok and Instagram 4 to
  6, Shorts 1 to 3, with a local tag and at most two broad ones. #MadeInRwanda is never required, and only allowed for
  goods made in Rwanda;
- a Kinyarwanda business's caption has Kinyarwanda in it (a mixed caption counts). The detector agrees with the
  researcher's labels on 14 of 14 Kinyarwanda, 18 of 19 mixed and 76 of 77 English Rwandan captions;
- the length (Facebook under 600 characters, TikTok and Instagram under 300, a Short's title under 100);
- no made-up superlatives, income claims ("earn X a day", MoMo screenshots), cures, "subscribe" on Shorts, or facts the
  brief does not give.

It returns the score, what passed, and `missed`: what to fix, in plain English. The strongest Rwandan captions in the
corpus (price, phone, place and a call to action) average 75 or more.

## Checking the language

`checkLanguage(texts, language)` (`brain/language.ts`) reads what an engine wrote (on-screen lines, voice lines, the
caption; `languageTextsOf(spec)` collects them from a design) and lists plain-English issues. It is a word-list check
built from how Rwandan sellers actually write (the caption corpus and the Kinyarwanda and French rows), not a
translator, and it only flags forms the corpus never uses:

- **Prices** written "420,000 francs", "Frs", "amafaranga y'u Rwanda" or "420.000 RWF" on screen or in the caption; the
  corpus writes RWF (38), k (26), M (11) and Frw, with commas. Voice lines are left alone (the voice says "francs" on purpose).
- **An English call to action in a Kinyarwanda caption or video** ("Call now", "Order now", "Contact us", "DM us"...):
  none of the 63 Kinyarwanda and mixed Rwandan texts uses one; they write "Duhamagare", "Twandikire kuri WhatsApp",
  "uduhamagare". "Call/WhatsApp:" is used, and allowed. The same for a French caption.
- **One sentence built from two languages' grammar** ("Gura the best phone kuri iyi price for you"). The corpus switches
  language between sentences, or keeps a product name or "free delivery" inside a Kinyarwanda sentence, but almost never
  mixes the grammar (3 sentences in 63 texts, two of them in an income-chain post).
- **Web words on a video frame** ("Kanda hano", "Click the link", "Swipe up"): nobody can click a video.
- **Two literal translations** the corpus never uses ("amafaranga y'u Rwanda", "kohereza ku buntu"). The list is kept
  short on purpose: the corpus does use "Iyandikishe nonaha" and "Kanda kuri link", which a guess would have flagged.

`PREFERRED_PHRASES` lists what sellers write instead ("Duhamagare cyangwa utwandikire kuri WhatsApp: {phone}",
"{product} kuri {price} gusa", "Ntucikwe!", "Kiraganirwaho", "Ibyangombwa birahari"...), for the designer's brief.

## Learning from our own results

The research tells the brain what works for other sellers. Once clients post through BuPulse, the brain also learns
from what BuPulse's own videos did (`brain/outcomes.ts`).

- **The record.** Each posted video becomes an `Outcome` row (`brain/types.ts`): the video, the business, its sector,
  the platform, the template, hook, format and caption formula used, the length, the language, when it was posted, and
  the post's numbers after 24 hours and after 7 days (views, reach, likes, comments, saves, shares, the same fields the
  publisher reads into `PostMetrics`). The lab keeps them in `video-lab/data/outcomes.jsonl` (`recordOutcome`,
  `loadOutcomes` in `brain/outcomes-store.ts`; the latest row of a video wins).
- **How a post is judged.** Against the other BuPulse posts on the same platform: its views (or reach) and its
  engagement per view (comments, saves and shares count more than a like), each as a percentile, averaged. 0.5 is the
  middle. A post without numbers yet is left out.
- **How a hook (or format, or template) is re-ranked** (`rankWithOutcomes`):
  - The research gives it an expected result, 0.4 for the weakest candidate to 0.7 for the strongest, worth 10 posts.
  - Each of its posts on that platform moves the expectation towards what really happened. The business's own posts
    count 3, posts from the same sector 1, posts from other sectors 0.5.
  - It needs at least **5 posted videos** before its own results count at all.
  - Below **20 posts**, it may move up and down, but it never pushes a research top-three hook out of the top three.
  - Worked out in the tests: a weak research hook rises into the top three after 20 strong posts, while a 2-post fluke
    stays where the research put it.
- **What Claude is told.** `brainContext(brief, { outcomes, businessId })` re-ranks the hook options. When the business
  has 5 or more posted videos on the platform (or its sector has 10), it also adds one line, for example: "What has
  worked for you (12 posted videos on TikTok): the "Number on screen, product in hand" opening (5 videos), product
  reveal videos (8), videos of 11 to 20 s did better than the rest."

**What the app's database migration will need** (the lab file has the same fields):

- A `VideoOutcome` table: `id`, `videoId` (unique), `postId` (unique, the `Post` that published it), `businessId`,
  `sector`, `platform`, `templateId`, `hookId`, `formatId`, `captionFormulaId`, `seconds`, `language`, `postedAt`,
  `source` (`"bupulse"`), `createdAt`, and indexes on (`platform`, `sector`) and (`businessId`, `platform`).
- The numbers do not need their own columns: the publisher already stores `PostMetrics` snapshots. The 24-hour and 7-day
  stats are the snapshots captured closest to `postedAt` + 24 h and + 7 days (or two `Json` columns, `stats24h` and
  `stats7d`, filled by the hourly metrics job, if reading snapshots is too slow).
- The video job must save which template, hook and caption formula it used. The designer knows the template and the hook
  (`styleId`, `hookId`) and the format follows from the template (`formatFromTemplate`). The caption formula is not
  recorded yet; `scoreCaption` or the designer will have to note it.
- Outcomes are read per platform and per sector, at most a few thousand rows: load them once per design request, or
  cache them per platform for an hour.

## What the brain does not know yet

- **Sound.** Everything was watched muted. The sound rules come from TikTok's printed sound labels and from what the
  picture shows (a speaker, burned-in text), not from listening. The owner (or a later pass) should check sound on the top 10 rows.
- **Instagram** and **YouTube Shorts** are thin on East Africa (7 of 58 reels; few local Shorts): Facebook stays the main evidence for Rwandan ads.
- **Thin sectors**: events is now the thinnest (6 event and venue rows, plus 2 hotels and residences); Kigali salon
  ads are young (at most 24 days live). Transport and travel (car hire, tours, travel agencies) has 12 Rwandan ads.
  Clinic rules are education-only by policy.
- **Rwandan ads are young**: most started in the last two weeks, so days running says little in Rwanda; the number of
  variants live at once (Derma 15, Elohome 8, Magic Chef 7, Piramie 6) is the better signal but is not yet a field in the
  research rows, so it does not count in a row's strength.
- **"Works" is a proxy**: TikTok likes and Facebook days running, not sales. BuPulse's own results now feed the
  ranking (see "Learning from our own results"), but views and likes are not orders either; WhatsApp messages and
  sales would be the next signal to record.
