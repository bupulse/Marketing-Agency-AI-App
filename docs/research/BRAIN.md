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
| Research rows | 687: 512 videos, ads and page posts (440 watched first-hand: TikTok 170, Facebook 133, Instagram 101, YouTube Shorts 36), 125 post captions (111 Rwandan), 30 TikTok clips whose 450 comments were read and 20 Instagram reels whose 177 comments were read; 8 income-chain posts kept only as what not to copy; 25 AI-made clips kept out of hooks, formats and sectors |
| Hooks (openings) | 63 | The first 2 seconds: the line, what is on screen, where it was seen, real example lines |
| Formats | 10 | Product reveal, UGC testimonial, before/after, unboxing, tour, offer, 3D motion, kinetic typography, tutorial, list or price list |
| Captions | 4 platforms, all researched, 32 formulas including 5 model captions by sector and a page-post line per platform, 10 ways to order, the caption corpus counts |
| Rules | 92 (77 do, 15 don't): 29 for ads only, 5 for page posts only, 15 marked early evidence |
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
buys you" hooks.
Facebook round 4 (49 rows): 16 event ads (a poster or animated slide first, venue footage at night, tickets by a USSD
code such as "dial *669*3426#"), 8 school ads (Action School, Saint Charles study-abroad, Kigali English Academy, British
Council, ALX) and 5 clinic and optician ads; no Rwandan pharmacy ads exist in the Ad Library, and herbal-remedy pages
were left out as likely quackery. Round 6 added 20 organic reels from 12 big Rwandan pages (RwandAir, Simba, Inyange,
Skol, Bourbon, CANAL+, Bralirwa, ONOMO, Piramie, Inzovu, Abby Home, Java House): see "Ads and page posts".
Instagram round 2 (43 reels from 36 East African business accounts, 34 of them in Kigali, each account's top reels)
added (counts as recounted from the 34 Kigali rows): Kigali reels run a median 27 s (global 13 s) in one continuous take,
1 to 4 cuts per 10 s; 10 of 34 keep the number on screen for all or most of the clip (12 at some point), and those 10
had median 73.4K plays against 36.0K for the rest (46 against 6.5 plays per follower, a direction, not proof); none of
the 34 shows the price on screen (an amount appears in 3 captions), so a price badge is a free edge; the caption is the
shop card (17 of 34 give a phone or a DM/WhatsApp line, 13 a number); plays run a median 21 times the followers while
likes are only 0.55% of plays (people call or WhatsApp instead). A row's strength now
also counts plays against followers (100 times or more = 1), so a 751-follower shop with 161K plays ranks as strong. The
Instagram lengths for product reveals, offers, UGC and before/after now reach 25 to 30 s, services get the
one-take-process rule, and a Kinyarwanda-first bilingual hook ("Turi kuri Promotion / We are on promotion") is a
priority-3 rule marked as a bet: only 4 Kigali rows use Kinyarwanda. Each account's best reels were chosen, so these show
what wins, not the average post.
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

## Early evidence

The researchers audited every rule and hook against its rows (`docs/research/brain-evidence-audit.md`). A research rule
or hook that cites fewer than 3 rows is marked `weak: true` (15 rules with the provisional AI rules, 25 hooks; checkBrain refuses an unmarked one);
`brainContext` adds "(early evidence)" after it, and `scoreDesign` and `scoreCaption` count a check on a weak rule at
half its points. Reasons say only what the cited rows show: `no-vague-discount` is now a BuPulse policy (its one row was a
Ghanaian store whose vague discount did well), `price-first-frame` says it is what short-lived product ads do (only 7 of
20 long runners show a price), and MoMo is "rare", not "absent" (the Sofar Kigali ticket ad writes "MoMo: 0788617015").

Caption formulas follow the same rule: one citing fewer than 3 rows is `weak`, and the four Facebook "model" captions
(`model-shop`, `model-salon`, `model-school`, `now-available-cod`) are marked `model: true`, so the context says
"Caption (BuPulse model, not observed)". `model-school` now follows real school captions (445 to 990 characters, 17 to
19 short lines). The Instagram formulas now rest on the Kigali account reels (`ig-owner-contact`, `ig-price-stock`,
`ig-dm-order`, and a new `ig-service-card` from the spa and clinic captions); `ig-owner-question` is a page post. The
TikTok `question-then-offer` no longer uses the Ghanaian "Drop 40% or 60%" line. Shorts take 0 to 3 hashtags (14 of 36
titles use none), and the Facebook 600-character cap is soft: schools, clinics, services and property may run to 1,000
(19 of 125 real captions do).

The TikTok recount: 6 of 10 Rwandan seller ads put the price, the offer or the number in the first 3 s (not 11 of 17,
which included a Ghanaian and a Ugandan store and creator clips). The most-liked Rwandan phone-shop clip is
@rujamaphones (5,200 likes), then Hadidja Collection (3,086) and KIBO Electronics (3,016); the 67.8K "Drop 40% or 60%"
clip is Ghanaian (country GH in the index). Biko Group, The Bistro Group and the Wings n More clip have no confirmed
country.

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
  6, Shorts 0 to 3, with a local tag and at most two broad ones. #MadeInRwanda is never required, and only allowed for
  goods made in Rwanda;
- a Kinyarwanda business's caption has Kinyarwanda in it (a mixed caption counts). The detector agrees with the
  researcher's labels on 14 of 14 Kinyarwanda, 18 of 19 mixed and 76 of 77 English Rwandan captions;
- the length (Facebook under 600 characters, a soft limit raised to 1,000 for schools, clinics, services and property; TikTok and Instagram under 300, a Short's title under 100);
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

## Opening lines for the owner

`suggestHooks(brief, { platform, count = 3 })` (`brain/suggest.ts`) turns the best hooks into lines the owner can click
on the Create page. Each line is filled in from the brief's facts only: the product, the price with its condition
("from 25,000 RWF", "50,000 RWF per day"), the area (the product's own place first, neighbourhoods before districts), the
number grouped as Rwandans read it, the offer ("BUY 1 GET 1 FREE EVERY TUESDAY"), and for clinics the founding year and
the insurers. A hook whose facts are missing is skipped, so no price means no price hook. Lines are in the business's
language, using the corpus's own Kinyarwanda forms ("{product} kuri {price} gusa", "INZU IGURISHWA I {AREA}", "KURI
{price} TUGUHA ..."), at most 7 words on screen, and each passes `checkLanguage`. Clinics and schools never get a price
hook. Each line comes with one sentence on why ("Seen in 8 research videos for phone and electronics shop, 4 of them
Rwandan; homeofhybrid ran it for 468 days on Facebook.") and its research rows. The line the owner picks goes into
Claude's brief through `brainContext(brief, { chosenHook })`, as the opening to use.

Examples: a Kigali phone shop gets "Samsung Galaxy A56 · WhatsApp 0788 300 400", "Samsung Galaxy A56 · 420,000 RWF" and
"Samsung Galaxy A56 · 50 MP camera"; a Kinyarwanda house listing "INZU IGURISHWA I KIBAGABAGA · 180M RWF"; a clinic
"Since 2015 in Kigali" and "We take RSSB, MMI, Old Mutual".

## A week of videos

`planSeries(brief, { platform, count = 7, outcomes, businessId, startDay, presenter })` (`brain/series.ts`) plans a
week of distinct posts for one product or offer, for Autopilot. Each day has its own hook (with the filled-in line from
`suggestHooks`), its own Claude template, a format, a length from the format's research range for that platform (6 to
30 s), the platform's caption formula, a music mood from the sector's research (else by format), whether to use a voice,
and one line of direction for the designer. The rules:

- No hook and no template repeats; the format used least so far comes first, so the week varies.
- Day 1 leads with the price for product sectors and with trust (an authority hook) for clinics and schools; trust
  sectors never get a price hook or a price template, and a clinic never gets a before/after.
- The middle post is a list, or a before/after where the work shows (salons, services, real estate, fashion).
- No offer video without an offer in the owner's note or a "was ... now ..." price; no price-drop without the old price;
  no price hook without a price.
- Presenter-led and UGC posts, and the voice, only when the business has a presenter.
- With platform "any" the days rotate TikTok, Instagram, Facebook, Shorts.
- The same number and the same place in every post: the long-running Rwandan advertisers run 8 to 15 variants of one
  format sharing the address, the number and the button, so every note says which number and place to keep on screen.

The Kigali phone shop (Samsung Galaxy A56, 420,000 RWF, Makuza Peace Plaza, 0788 300 400), starting Monday 19 October:

| Day | Platform | Hook | Opening line | Template | Format | Length | Caption | Music |
|---|---|---|---|---|---|---|---|---|
| Mon 19 Oct | TikTok | price-banner | Samsung Galaxy A56 · 420,000 RWF | kigali-price-first | product-reveal | 15 s | available-now | upbeat |
| Tue 20 Oct | Instagram | number-in-hand | Samsung Galaxy A56 · WhatsApp 0788 300 400 | kigali-market | tour | 15 s | ig-owner-contact | warm |
| Wed 21 Oct | Facebook | spec-words | Samsung Galaxy A56 · 50 MP camera | product-hero | product-reveal | 15 s | stock-list | upbeat |
| Thu 22 Oct | Shorts | numbered-list | 3 reasons to choose Samsung Galaxy A56 | tiktok-3-reasons | list | 15 s | store-list-title | upbeat |
| Fri 23 Oct | TikTok | model-badge | Samsung Galaxy A56 available now | studio-turntable | product-reveal | 15 s | available-now | upbeat |
| Sat 24 Oct | Instagram | now-available | Samsung Galaxy A56 is here | macro-detail | product-reveal | 12 s | ig-owner-contact | upbeat |
| Sun 25 Oct | Facebook | what-x-buys | What 420,000 RWF buys in Kigali | brand-story | tour | 20 s | stock-list | warm |

Every note ends "Keep the number (0788 300 400) and the place (Makuza Peace Plaza, Kigali) on screen, as in every post
this week." A skin clinic in Gishushu gets "Since 2015 in Kigali" first, then "We take RSSB, MMI, Old Mutual", the
three reasons in the middle and "Still dealing with acne?", all calm music, no price and no before/after. When a brief
has fewer usable hooks than days, fewer posts come back rather than repeats.

Instagram comments (20 Kigali reels, 177 comments, `instagram-comments.jsonl`, ids `ic-`): 72 of 177 comments (41%) ask
the price, 61 to 63% under shoes, skincare and hair reels and 50% under phones; food, event and brand reels draw 97 to
100% praise and no questions; sellers answered 46 of 86 questions and 19 of 38 price replies only said "DM"; viewers
complain "Mujye muvuga n'ibiciro" (say the prices too) and "Jyuvuga cyane twumve" (speak up). It strengthens
`price-stays`, `number-labelled`, `caption-preanswer`, `cta-route` and `voice-with-person`, and adds the seller's first
comment: `firstCommentFor(brief)` (exported from the index) fills "Price / 📍 place / Delivery / WhatsApp" (or the
researcher's Kinyarwanda reply-kit lines "Igiciro ni ...", "Turi i ..., hafi ya ...", "Turohereza i ...", "Nandikira kuri
WhatsApp ...") from the brief's facts only, and the ad context asks Claude for it with the caption.

TikTok round 4 (37 clips, partial: comments blocked by a captcha): 20 AI-made, 12 real-shop controls, 5 unclear. No
East African retailer was found using AI for its own ad; the AI business clips are AI studios' sales demos, with a median
309 likes and 5 comments against 1,213 and 42 for real Rwandan shop clips with the price and the number on screen. The
index keeps `ai` and `aiLabel` on these rows; checkBrain lets only the AI rules (`ai-real-product`, `ai-real-place`,
`ai-real-face`, `ai-disclose`, `ai-label`, `look-real`, `native-look`, `no-fake-customers`) cite an AI-made clip, so no
hook, format or sector learns from them. The four new AI rules are early evidence; `look-real` now cites the controls.

## Ads and page posts

A brief is an **ad** (the default) or a **post** on the business's own page (`purpose: "post"` on the BrainBrief, or on
the designer's and the prompt writer's briefs, which `brainBriefFromDesign` and `brainBriefFromPrompt` pass through).
The two do not mix:

- 29 rules are for ads only (`purposes: ["ad"]`: the phone bar, the price in the first frame, the contact card, the full
  shop-card caption, the platform hashtag counts, "no polished brand film without a price"...), and 5 are for posts only
  (`post-no-overlay`, `post-short-visual`, `post-caption`, `post-moments`, `post-warm-sound`). checkBrain refuses an
  ad rule that cites an organic reel.
- A post's hooks leave out the price-first and contact-first ones (and offer badges without an offer); its format is
  never "offer" without an offer; its caption is the `page-post` line (one friendly line, 0 to 3 tags); its call to
  action is the logo or the shop sign, with the number in the caption.
- An ad's hook ranking leaves out the 20 organic reels (`organic: true` in the index; a page's reels are never counted
  as live ad variants); a post's ranking counts them half again as much.
- `scoreDesign` and `scoreCaption` take the purpose (`brief.purpose` or `options.purpose`). A post is not marked down for having
  no hook text at 0 s, no price, no number and no order line; it fails instead if the price or number stays on screen
  in every scene (`post-no-overlay`) or the last scene is a hard sell (`post-end`), and it is held to 12 to 25 s, about
  3 scenes, a caption of about 10 to 25 words and at most 3 hashtags.

Why: on the 12 pages only 1 of 20 reels shows a price and a phone; they run a median 20 s (ads 34 s), 14 of 20 carry
no hashtag, and reach came from places and moments (ONOMO's silent dining-room film 310K views, CANAL+'s national-team
highlights 54K, RwandAir's staff moments 18K), while the one organic post with a real offer got 163 views.

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
- **YouTube Shorts** is thin on East Africa (few local Shorts). Instagram now has 43 East African reels (34 Kigali), but they are each account's top reels: good for what wins, not for the average post. Facebook stays the main evidence for Rwandan ads.
- **Thin sectors**: events now has 24 rows (16 Facebook ads from round 4) but few prices; there are no Rwandan pharmacy
  ads at all; Kigali salon ads are young (at most 24 days live). Transport and travel (car hire, tours, travel agencies) has 12 Rwandan ads.
  Clinic rules are education-only by policy.
- **Rwandan ads are young**: most started in the last two weeks, so days running says little in Rwanda; the number of
  variants live at once (Derma 15, Elohome 8, Magic Chef 7, Piramie 6) is the better signal but is not yet a field in the
  research rows, so it does not count in a row's strength.
- **"Works" is a proxy**: TikTok likes, Facebook days running and Instagram plays against followers, not sales.
  BuPulse's own results now feed the ranking (see "Learning from our own results"); an outcome's `messages` (WhatsApp
  taps or DM conversations, when the network reports them) counts five times a like, since Kigali viewers message rather
  than like. Sales would be the next signal to record.

## 17 October changelog

Everything in the brain was built on 17 October 2026 (commits 1297ba6 to fc8d270); this is the one-page summary for the
next session.

**Sources and counts at the end of the day.** 687 research rows in `data/evidence.json`, made by
`node lib/video-engine/brain/ingest.ts` from `docs/research/reels/` (ids stay stable; `--no-new` refreshes only, and
`--skip=<source>` leaves a file that is still being written):

| Source (id prefix) | Rows | What |
| --- | --- | --- |
| TikTok (`tt-`) | 216 | 170 watched; round 2 thin sectors, round 3 sounds, round 4 AI-made clips (`ai`, `aiLabel`) |
| Facebook (`fb-`) | 159 | Ad Library ads, the Rwanda playbook, long runners, round 4 events, schools, clinics; 20 organic page reels (`organic`) |
| Instagram (`ig-`) | 101 | 58 global reels and 43 Kigali account reels (plays and followers) |
| YouTube Shorts (`yt-`) | 36 | |
| Captions (`cp-`) | 125 | 111 Rwandan post captions |
| TikTok comments (`cm-`) | 30 | clip summaries of 450 comments |
| Instagram comments (`ic-`) | 20 | clip summaries of 177 comments |

421 rows are Rwandan; 8 are income-chain or scam posts (only `no-fake-income` and `no-income-promise` may cite them);
25 are AI-made clips (only the AI rules may cite them). 63 hooks (25 weak), 10 formats, 11 sectors, 92 rules (77 do, 15
don't; 29 ads only, 5 posts only, 15 weak), 33 caption formulas on 4 platforms plus the seller's first comment.

**The pieces, all exported from `lib/video-engine/brain/index.ts` (browser-safe; `outcomes-store.ts` is the only
file-system part):**

- `brainFor` / `brainContext` (select.ts): the pick for a brief and the about-900-token research block for Claude
  (hooks, timeline, rules, call to action, Sound line, caption with the first comment, don'ts).
- Scorers (score.ts): `scoreDesign`, `scoreCaption`, `scoreSeedancePrompt`; `templateStyle` / `STYLE_LIMITS` (direct,
  list, showcase, brand, luxury); `amounts` reads grouped money of any size and skips phone numbers.
- `SAFE_AREAS` / `safeAreaFor` (database.ts): per platform (Instagram's right edge 0.85; Shorts and YouTube the same);
  wide and square shapes keep a 5% margin.
- `checkLanguage` (language.ts): Kinyarwanda and French price and call-to-action forms from the corpus.
- `rankWithOutcomes` / `outcomesLine` (outcomes.ts): our own posted results move the ranking (prior worth 10 posts,
  own business 3, sector 1, others 0.5; 5 posts minimum; under 20 posts a research top-three hook keeps its place);
  `messages` counts five times a like.
- `suggestHooks` (suggest.ts): three filled-in opening lines from the facts, at most 7 words, English or Kinyarwanda,
  trust-first for clinics and schools, never a price line without a price.
- `planSeries` (series.ts): a week of distinct posts for Autopilot (see "A week of videos").
- `firstCommentFor` (suggest.ts): the seller's pinned comment (price, place, delivery, WhatsApp) from the facts only.
- `purpose: "ad" | "post"` (BrainBrief, ScoreBrief, ScoreOptions; `purposes` on rules and caption formulas): page
  posts get their own rules, hooks, caption and scoring (see "Ads and page posts"). It is not `mode`: DesignBrief
  already uses `mode` for reference, text and image.
- `weak: true` on rules, hooks and formulas with fewer than 3 rows, `model: true` on BuPulse's own model captions:
  the context says "(early evidence)" or "(BuPulse model, not observed)", and a weak rule's check counts half.
- checkBrain refuses: an unknown reference, an uncited research rule, a scam or AI-made row cited outside its rules,
  an ad rule citing an organic reel, and an unmarked rule, hook or formula with fewer than 3 rows.

**Checked today.** The researchers' evidence audit (`brain-evidence-audit.md`): reasons rewritten to say only what the
rows show, the Ghanaian "Drop 40% or 60%" clip supports no rule, MoMo is "rare", 6 of 10 Rwandan seller ads show the
price, the offer or the number in the first 3 s. The 33-template sweep scores a mean 89.9 for designs and 96.3 for
captions (`brain-audit.md`). The motion engine's loop-6 designs, run through today's `validateSpec` and scorer: dress
100, restaurant 99.5, house 98.8 (from 91.6: the 120,000,000 RWF price is now read and "Find us in Kibagabaga" counts
as a call to action), dress 1:1 100, dress 4:5 100; no design dropped. What is left there: three text-crowd misses
(luxury and direct templates with one line too many) and "5 stars" in the house `ugc-review` (no-fake-customers).

**Open for the next session.** The app side of `purpose` (a "post" switch on Create and Autopilot), recording
`messages` in PostMetrics, the AI rules' evidence (TikTok comments under AI clips were blocked by a captcha), Shorts
captions from East African shops, and the owner's listening pass on sound.

