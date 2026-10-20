# Facebook viral round 1: what the 100 videos taught

Round of 19 October 2026. 100 rows in `facebook.jsonl` (ids vt-fb-001 to vt-fb-128, with gaps where I dropped a video after
watching it: children as the subject, political comments, income pitches, duplicates). Frames are in
`video-lab/data/viral/frames/facebook/<id>/` (6 to 8 JPEGs, 540 px wide, local only).

## How reliable this is

- **Sources.** 43 Ad Library ads and 57 organic reels. Region by country of the page: 74 East African (21 Rwanda, 28 Kenya,
  15 Tanzania, 9 Uganda, plus two Kinyarwanda or Swahili creators with no country shown) and 26 global.
- **Ad rule.** Every ad has run at least 32 days (median 135, 17 of them 200 days or more, the oldest 719 days) and the same
  page had 5 to 33 live ads in the library (median 8). Facebook's own "N ads use this creative" shows only 2 or 3, so I
  counted live ads from the same page in my searches. That is a lower bound, and it is **not proof of sales**.
- **Organic bar.** Each reel passes the README bar and `viral_basis` says which one: 100K+ views or 10x followers or 5K likes or
  300 comments for East Africa, 1M views or 50K likes for global. Views come from the page's Reels grid, likes, comments and
  shares from the reel itself.
- **How I watched.** Every video was opened in the logged-in research Chrome and played muted. Videos up to 45 s were
  played in real time with a screenshot at 6 to 8 spread-out moments. Longer ones (about a third) were sampled by seeking
  across the whole length, so the timings for those are read from 8 frames and the caption, not second by second. Cuts per
  10 s are estimates.
- **Gaps.** Followers are `null` for ads. Comments are what the panel showed first (up to 5, 40 of 57 reels had some).
  `posted` is `null` for reels (the viewer does not show the date). Sound is unknown for everything because I watched muted.
- **Discovery bias.** I found organic reels by scanning about 300 page Reels grids (Rwanda, Kenya, Uganda, Tanzania pages from
  Facebook search, plus global brands) and by walking the owner's Reels feed. Most Rwandan shop pages are small: of about 220
  pages with 1.5K+ followers only a handful had a reel past the bar. The Rwandan organic rows therefore lean to brands (MTN,
  Airtel, Equity, RwandAir, Skol, Bank of Kigali) plus a few small pages that broke out (Kwanda Real Estate, Kigali Diplomat Hotel,
  Vatel).

## What the 100 have in common

1. **A concrete thing in the first frame, not a logo.** 82 of 100 have burned-in text; 19 hook lines contain a number (a price,
   a count, a date). The commonest hooks are curiosity (11), a direct question (7), a pain question (6), demo first (6), an
   occasion title (6) and an expert card (6).
2. **Text is the sound track.** 49 of 100 have no voice at all and still work; many carry a permanent strip or card for the
   whole video (price, phone, slogan, banner). Sentence-by-sentence caption boxes are the norm when a person talks.
3. **One real place and real people.** Shop floors, pavements, kitchens and clinics beat studios. The big East African reels are
   plain: a house tour with a spec list (vt-fb-045), sofas on a pavement with the price card (vt-fb-050), a computer counter
   with a price list (vt-fb-048).
4. **The caption does the selling.** Price lists, address, area, two phone numbers, "free delivery", "pay after delivery" and
   hashtags are in the caption almost every time, and the video only has to make people stop.
5. **Formats repeat.** product-reveal 22, offer 17, ugc-testimonial 15, tour 15, tutorial 13, kinetic-typography 9, list 5,
   before-after 4. The winning advertisers run the same template with new products (Kenlina-B, Ugalina, Derma Skin Clinic,
   Safaricom data offers).
6. **Length.** Median 34 s (ads 44 s, reels 34 s). 35 of 100 are 20 s or shorter; the long ones are talking heads (clinic,
   real estate, CEO) or step-by-step recipes.

## Ads against organic reels

| | Ads (43) | Organic reels (57) |
| --- | --- | --- |
| Why it is in | 32+ days running, 5+ live copies | views, likes or comments over the bar |
| Median length | 44 s | 34 s |
| Price on screen | 10 of 43 | 11 of 57 |
| Phone on screen | 11 of 43 | 11 of 57 |
| Typical hook | "Now in Uganda/Kenya" banner, price card, pain question, expert card | curiosity, a skit, a quiz ("Guess where we are landing"), a recipe, a new-menu tease |
| Call to action | a button: Shop now, Send WhatsApp message, Visit Instagram profile | none in the video; phone and address in the caption |
| Tone | direct response, same template many times | entertainment first, offer second |

- Ads are built to be repeated: 13, 18 or 33 live copies of one layout is normal. 6 ads carry "pay after delivery" or "pay on delivery" and 10 use the WhatsApp
  button.
- Organic reels win on comments: viewers ask prices (vt-fb-048, 049, 068), argue (vt-fb-099, 104) or guess (vt-fb-081). The
  brands that answer those comments get more reach.
- The biggest organic East African numbers came from tiny pages with a plain video: Kwanda Real Estate 446K views on 2K
  followers, Mazal Furniture 237K on 3K, Baps Shayona 369K on 14K, Velam tours 168K on 2.1K.

## East Africa against global

- **East Africa (74):** prices and phone numbers are on screen in about a quarter of rows and in the caption in most. Trust lines
  are local: "Unalipa kiti ikikufikia" (you pay when the sofa reaches you), "Free delivery across Kenya, pay after delivery".
  Language is English mixed with Swahili or Kinyarwanda (18 rows are mainly Swahili or Kinyarwanda). The Kinyarwanda
  how-to and price cards from Airtel and MTN Rwanda have 500K to 960K views.
- **Global (26):** shorter (median 20 s) and faster (median 4 cuts per 10 s against 2.5), almost never a price or a phone, much
  more kinetic text, meme dialogue ("Them: ... Me: Yes"), mascots and one-line questions. They sell with a joke or a
  craft, not with a price.
- **What crosses over:** a one-line question, a "NOW IN <country>" banner, a before/after, a how-to with one step per card, and a
  seasonal hook. What does not: global brand teasers (silhouettes, coming soon) depend on fame; a small shop should copy the
  structure, not the idea.

## The 10 best examples to learn from (by id)

| id | What it teaches |
| --- | --- |
| vt-fb-045 | Kwanda house tour: spec list (area, beds, baths, size) as a fixed lower-third, 446K views on a 2K page |
| vt-fb-050 | Mazal Furniture: price per size on a card the whole clip plus a pay-on-delivery line in Swahili |
| vt-fb-046 | Baps Shayona newspaper headline teaser ("What's new?" then "New menu!" then "It is here"), 13 s |
| vt-fb-048 | Nairobi Computer Shop: exact configurations and Kes prices as the caption, 250K views |
| vt-fb-008 | Ugalina "NOW IN UGANDA" banner over one real-use take, 13 live copies for 20 months |
| vt-fb-001 | Derma Skin Clinic: expert name card, sentence-by-sentence caption boxes, 18 live ads |
| vt-fb-069 | Airtel Rwanda send-money how-to in Kinyarwanda, one tap per card, 964K views |
| vt-fb-109 | Chicken Inn: size pills (REG, LRG, MEGA with prices) and add-on pills in one fast card video |
| vt-fb-081 | RwandAir "Guess where we are landing": one shot, one caption, 274 comments |
| vt-fb-120 | McDonald's "Them: What do you want? Me: Yes": the build of the burger told in two captions |

## 8 rules for BuPulse's engines

1. **Put the offer or the question in the first frame**, in text, top third: a price card (was/now or per size), a "NOW IN
   <country>" banner, or a one-line question. Never open on a logo.
2. **Make every video work muted.** Burn in one phrase at a time, keep a permanent strip (price, slogan, phone) for the whole
   clip, and use sentence-by-sentence caption boxes when a person speaks.
3. **Write the caption as the sales page.** Price list or "from" price, area and landmark, two phone numbers, delivery promise
   ("free delivery", "pay after delivery", in Kinyarwanda or Swahili where the audience speaks it), 3 to 5 hashtags with the
   city. The engine should fill this from the shop profile.
4. **Offer templates by shop type, not one style:** property and tour (spec list, drone plus rooms), clinic (expert card plus
   customer before/after), restaurant (new-menu headline, set-menu card with price for two), product (real use in one take
   plus delivery line), services how-to (one tap or step per card).
5. **Make variants of a winner, never replace it.** Winners run 5 to 33 live copies of one layout. Generate 3 to 5 versions
   (new price, new product, new first line, shorter list) and keep the original.
6. **Use real people and real places.** A host, owner or customer in the first and last shot; hands only if nobody can be
   filmed; pavement, shop floor or kitchen over studio. Keep the first-person camera and the one-take feel.
7. **Design for the comments.** Expect price questions: add a pinned price card or a "price of each item" reply card, and use
   questions and quizzes ("Guess where...", "pick a side") when the goal is reach.
8. **Length by job:** 7 to 20 s for teasers, skits and offers; 30 to 60 s for recipes, tours and how-tos; 90 s or more only for
   a talking host with sentence captions. Keep the same layer (price tag, number, dial code) fixed and swap the scene,
   as Safaricom does for its weekly data offers.
