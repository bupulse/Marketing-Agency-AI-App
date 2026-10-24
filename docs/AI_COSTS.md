# AI costs: how they are estimated, and why the bill can differ

Every AI call goes through `withLedger` (`lib/ai/ledger.ts`), which writes one `AiCall` row with the provider, the model, the tokens (or images, characters, seconds) and `costUsd`, priced from `lib/ai/pricing.ts`. The monthly cap, the per-company allowances, Admin, AI calls and spend, and the cost estimates on Costs all read that table. A real bill entered under Costs, Provider bills replaces the estimate for that provider and month.

## The gap that was found (October 2026)

Google billed about $1 for a month in which the admin showed a fraction of that. Reading the code (not the production data, which was not available) found these ways for a billed call to be recorded low or at zero, and they are fixed:

| Cause | Effect | Fix |
| --- | --- | --- |
| A model name the table did not know (a `-preview`, `-latest`, `-001` or dated suffix, a `models/` prefix, or a newer model set in `GEMINI_*_MODEL`) | Priced at **$0** | Names are normalized; an unknown name is priced at its family's dearest model (flash-lite, flash, pro, image, Claude, ElevenLabs) and listed on the AI page as "priced by family". |
| Image calls whose reported output tokens hold only the text part | An image recorded for a fraction of a cent instead of $0.039 to $0.134 | The per-image price is now a floor on the output side. |
| Calls that timed out on our side (Gemini text 90 s, images 120 s, Claude, ElevenLabs) | Recorded with 0 tokens, yet the provider finishes and bills them | The usage is estimated (prompt length / 4 in, 1,000 tokens out for text; one image; the characters or seconds asked for) and the row is marked `estimated`. |
| The art director gives up after 12 s while the model keeps answering | Recorded with 0 tokens | `withLateTimeout` hands the still-running call to the ledger, which records the real usage when it lands (in the background). |

Calls that are **not** billed and correctly cost nothing: 429 and 5xx answers that are retried or fall back to the cheaper model, 4xx refusals, network failures, and calls refused before sending (budget, switched off).

## What can still differ

- **Prices.** `MODEL_PRICES` is maintained by hand; a price change lands only when the table is updated. Gemini 3.8 Flash doubles on 2027-01-01.
- **Estimates of timed-out calls** are rough (especially output tokens).
- **Month edges.** The console counts Kigali months; Google bills in Pacific time.
- **Tax and currency.** Google adds VAT where it applies; the estimate is before tax. Enter the invoice total as the bill.
- **Calls outside production.** Local development, previews, demo captures or scripts that use the same API key are billed by Google but written to another database (or none). Use a separate key per environment to keep the production bill comparable.
- **ElevenLabs.** The ledger prices characters at the overage rate; characters inside the subscription cost less, and the subscription itself is a recurring cost. Enter only the usage-based part as the ElevenLabs bill.
- **A failed ledger write** (database blip) loses that one row; it is logged as `ai.ledger`.

## Checking

Each month: Admin, Money, Costs, Provider bills: enter Google's (and Anthropic's, ElevenLabs', Higgsfield's) amount for the month before. The Costs and AI pages show the estimate next to the bill and the difference in percent. A persistent gap of more than about 20% means a price or a call path is missing: look at the AI page's "priced by family" list and the models table first.

## Video (Video Studio, October 2026)

What one video costs BuPulse in providers, next to what the client pays in studio credits. 1 credit = 10 RWF and
USD 1 = 1,450 RWF (`RWF_PER_CREDIT`, `USD_PER_RWF` in `video-lab/credits.ts`). A credit price is the estimated
provider cost × 2.2, rounded to 5 credits (`MARGIN`, `roundCredits`), except Premium 3D and the voice-over, which are
owner decisions. "Measured" means the lab ledger (`video-lab/data/ledger.jsonl`, 56 rows from 16 to 17 October 2026,
API-equivalent cost even when Claude ran on the subscription); the rest says where the number comes from.

### Per video

| What | Provider cost (USD) | RWF | Client pays | RWF | Margin (price ÷ cost) | Source of the cost |
| --- | --- | --- | --- | --- | --- | --- |
| **Motion** video (one Claude design) | 0.107 median (0.087 to 0.161, mean 0.114) | 155 | 35 credits | 350 | 2.3× (2.1× at the mean) | measured, 43 `claude-design` rows (Sonnet 5.5); rendering and MP4 are free (the browser); a viral recipe (the default since 19 October, docs/VIRAL_RECIPES.md) adds about 1,000 input tokens, about $0.003, and phone clips are free |
| **Premium 3D**, 540p, up to 8 s | 0.085 design + Mac time | 123 | 100 credits | 1,000 | 8.1× on cash | measured, 1 `claude-blender-design` row; `docs/BLENDER.md` "Premium 3D credits" says $0.08 to $0.09 |
| **Premium 3D**, 720p | 0.085 + about twice the Mac time | 123 | 150 credits | 1,500 | 12.2× on cash | as above; 720p render time not yet measured |
| Premium 3D **re-render** | 0 (Mac time only) | 0 | 70 credits | 700 | (machine slot) | `PREMIUM_RERENDER_CREDITS`; the 70 pays the Mac, about 1.5 to 3.5 min for 6 s at 540p (`docs/BLENDER.md`) |
| **Voice-over**, one take | 0.059 median (0.036 to 0.078) | 86 | 15 credits | 150 | 1.7× (1.3× for the longest take) | measured, 7 `elevenlabs-voice` rows at the list price ($0.30 per 1,000 characters); a reused take is free and its credits are given back |
| **Presenter or AI image** (Gemini) | 0.039 | 57 | 15 credits | 150 | 2.6× | measured, 5 `gemini-*` rows (`gemini-2.5-flash-image`) |

**Seedance** clips: seconds × the rate in `SEEDANCE_USD_PER_SECOND` (`lib/video-engine/seedance.ts`, public price pages
read 16 October 2026: Seedance 2.0 about $0.07/s at 480p, $0.15 at 720p, $0.37 at 1080p; Fast about 20% less; Mini
about half). These are **estimates until the first BytePlus invoice**. The real cost of each clip is priced from the
tokens BytePlus reports, at `SEEDANCE_USD_PER_M_TOKENS` ($7 per million by default). A rough cross-check, not from the
BytePlus docs (they do not state the token formula): if a clip is width × height × frames ÷ 1,024 tokens, a 720p, 24
fps, 5 s clip is about 108,000 tokens, about $0.76, close to the Pro 720p rate.

| Clip | Provider cost (USD) | RWF | Client pays (credits) | RWF | Margin |
| --- | --- | --- | --- | --- | --- |
| Mini 480p, 4 s (the key-day test clip) | 0.140 | 203 | 45 | 450 | 2.2× |
| Mini 480p, 5 s | 0.175 | 254 | 55 | 550 | 2.2× |
| Mini 720p, 5 s | 0.375 | 544 | 120 | 1,200 | 2.2× |
| Fast 480p, 5 s | 0.280 | 406 | 90 | 900 | 2.2× |
| Fast 720p, 5 s | 0.600 | 870 | 190 | 1,900 | 2.2× |
| Fast 720p, 10 s | 1.200 | 1,740 | 385 | 3,850 | 2.2× |
| Pro 720p, 5 s | 0.750 | 1,088 | 240 | 2,400 | 2.2× |
| Pro 1080p, 5 s | 1.850 | 2,683 | 590 | 5,900 | 2.2× |
| Pro 1080p, 10 s | 3.700 | 5,365 | 1,180 | 11,800 | 2.2× |
| Pro 1080p, 15 s | 5.550 | 8,048 | 1,770 | 17,700 | 2.2× |

Seedance credits are computed in `seedanceCredits`, so this table is exact for the estimate. Failed, cancelled and
expired clips are given back and BytePlus does not bill them. Free previews (no key) cost nothing.

### Veo AI clips (Google, 19 October 2026)

**23 October 2026: now Gemini Omni Flash.** Google shut the three Veo 3.1 previews down on the Gemini API on 22 October
2026 (a submit answers 404 "no longer available ... use models/gemini-omni-1.1-flash"). Owner decision the same day:
AI clips use **Gemini Omni Flash** (`gemini-omni-1.1-flash`, the default `VEO_MODEL`), same Gemini key, through the
Interactions API. Price from the Gemini API pricing page read that day: $17.50 per million output tokens at 5,792 tokens
a second of 720p, **about $0.10 a second** (twice Veo Lite; no free tier). Credits by the same formula:

| One Gemini Omni clip (720p, 9:16) | Provider cost (USD) | RWF | Client pays (credits) | RWF | Margin |
| --- | --- | --- | --- | --- | --- |
| 4 s | 0.40 | 580 | 130 | 1,300 | 2.2× |
| 6 s | 0.60 | 870 | 190 | 1,900 | 2.2× |
| 8 s | 0.80 | 1,160 | 255 | 2,550 | 2.2× |

Omni has no length setting: the prompt asks for the length ("Length: about 6 seconds."), and the first real clips came
out 6.0 s for 6 asked; the ledger records the file's real seconds. The Veo tables below are kept for history (and for a
Veo model set by hand in `VEO_MODEL`).

"AI makes the clips" adds 2 or 3 real moving clips of the product to a Motion video, made by **Google Veo 3.1 Lite**
through the Gemini API (the existing `GEMINI_API_KEY`; Veo has no free tier, so billing must be on). Owner decision,
19 October 2026. Price: **$0.05 a second at 720p**, audio always on (BuPulse mutes it and uses its own music and
voice-over), from the Gemini API pricing page read that day. Google bills **only clips it makes**: a blocked or failed
clip costs nothing, and its credits are given back. Credits use the usual formula (`veoClipCredits` in
`lib/video-engine/credits.ts`, × 2.2, rounded to 5); `VEO_USD_PER_SECOND` overrides the rate if Google changes it.

| One clip (720p, 9:16) | Provider cost (USD) | RWF | Client pays (credits) | RWF | Margin |
| --- | --- | --- | --- | --- | --- |
| 4 s | 0.20 | 290 | 65 | 650 | 2.2× |
| 6 s | 0.30 | 435 | 95 | 950 | 2.2× |
| 8 s | 0.40 | 580 | 130 | 1,300 | 2.2× |

| A whole Motion video with AI clips | Provider cost (USD) | Client pays (credits) | RWF |
| --- | --- | --- | --- |
| Design + 2 clips of 4 s | 0.107 + 0.40 = about 0.51 | 35 + 130 = 165 | 1,650 |
| Design + 3 clips of 4 s | 0.107 + 0.60 = about 0.71 | 35 + 195 = 230 | 2,300 |
| Design + 3 clips of 6 s | 0.107 + 0.90 = about 1.01 | 35 + 285 = 320 | 3,200 |
| (+ voice-over) | + about 0.06 | + 15 | + 150 |

| An Autopilot / Daily posts video marked "AI" (made overnight, `lib/visuals/ai-clips.ts`) | Provider cost (USD) | Client pays (credits) | RWF |
| --- | --- | --- | --- |
| Slideshow + 2 Gemini Omni clips of 6 s (the default: `AI_CLIPS_PER_VIDEO`, `AI_CLIP_SECONDS`) | 1.20 (the slideshow is free) | 380 | 3,800 |
| Half done (1 clip made, 1 blocked or failed; Google bills only the made one) | 0.60 | 190 (190 back) | 1,900 |
| Nothing made (simple video instead) | 0 | 0 (380 back) | 0 |

"Mix" makes one video in four an AI video. BuPulse's own limit, `VEO_CLIPS_PER_DAY` (default 10 clips in 24 hours for
all companies, at most about $6 a day at Omni's price), stops a run-away spend; the videos past it are simple videos with no credits
taken. The voice-over and music of these videos are the slideshow's own (plan voice-over characters, the music
library), not studio credits.

The clips are made once per request and shared by every version of the design. Recorded: in the lab ledger as
`veo-clip` rows for the owner's tests, through `withLedger` (provider `veo`, feature `video-veo`, seconds recorded as
input tokens and priced per second in `lib/ai/pricing.ts`) for a client.

**Real test clips** (owner-approved test budget: $5 in total, about 15 clips of 4 s; LEAF Hydro Tower, TEST database):

| # | Date | Clip | What it shows | Provider cost (USD) | Running total |
| --- | --- | --- | --- | --- | --- |
| 1 | 19 Oct 2026 | 4 s, 9:16, 720p, Veo 3.1 Lite, 47 s to make | first frame the product photo; slow push-in while an adult's hands pick lettuce from the tower | 0.20 | 0.20 |
| 2 | 19 Oct 2026 | 4 s, through the studio route (`vc-a18e0373e375`), 51 s | kitchen photo cropped by sharp's "attention" crop to the counter: Veo panned and invented its own tower (crop fixed after this) | 0.20 | 0.40 |
| 3 | 19 Oct 2026 | 4 s, studio route (`vc-d77f4dfe9d50`), 45 s | "attention" crop on the greenhouse photo picked the control box; peppers and a new tower slide in (crop fixed after this) | 0.20 | 0.60 |
| 4 | 19 Oct 2026 | 4 s, studio route, centre crop (`vc-f70f242ef185`) | the real kitchen tower stays in frame; an adult East African man smiles and presents it with his hands | 0.20 | 0.80 |
| 5 | 19 Oct 2026 | 4 s, studio route, centre crop (`vc-1475999cf352`) | the greenhouse rack, then the scene morphs into a street shop and the rack changes shape (the "Kigali setting" asked for a new place; prompt fixed after this) | 0.20 | 1.00 |
| 6 | 19 Oct 2026 | 4 s, studio route, fixed prompt (`vc-fbd17b278a07`) | the same rack stays in its greenhouse; slow orbit, the sun flares through; the product and its LEAF base unchanged | 0.20 | 1.20 |
| 7-9 | 19 Oct 2026 | 3 clips of 4 s made together from the Create page for a viral recipe's AI beats (run `vr-32e2d800bc09`, 55 to 74 s) | the spiral, terracotta and sculpture towers from their own photos, hands reaching in; then designed (same recipe), rendered to a 15 s MP4 with music: clips placed in scenes 2 to 4, their sound absent from the mix | 0.60 | 1.80 |
| - | 23 Oct 2026 | the overnight clip maker's first try (`lib/visuals/ai-clips.ts`, LEAF Hydro Tower video on TEST) | Google refused both submits: Veo 3.1 Lite shut down the day before (404). Not billed; the video fell back to the slideshow and its 190 credits came back once | 0.00 | 1.80 |
| 10-11 | 23 Oct 2026 | 2 Gemini Omni Flash clips of 6 s by the overnight clip maker (same LEAF video, owner-approved paid test), both made in about 85 s, 6.0 s each (3.2 and 4.7 MB) | scene 1 from the tower photo: push-in, an adult's hand picks basil, the product unchanged; scene 2: slow move over the terracotta tower. Rendered by the robot's renderer into a 20 s MP4 (4.9 MB, 11 s to make) with the clips under the captions and the music | 1.20 | 3.00 |

**Reel engine test reels** (owner-approved test budget: $10 in total for all reels, raised to $20 on 23 Oct, docs/REEL_ENGINE.md; LEAF Hydro
Tower, TEST database, Gemini Omni Flash at about $0.10 a second; refused clips cost nothing):

| # | Date | What | Provider cost (USD) | Running total |
| --- | --- | --- | --- | --- |
| 1 | 23 Oct 2026 | Reel `cmvl6ynoi0005ns45iigbvwmi`, Kinyarwanda: the presenter's portrait, 4 start frames (one repainted by the Checker), 3 clips of 8 s filmed (Omni speaks Kinyarwanda); the call to action refused 3 times (it said the price) | 3.00 | 3.00 |
| 2 | 23 Oct 2026 | Finding the cause by hand: the refused script with a filmed clip's start frame (refused, free), without "WhatsApp" (refused, free), without the price sentence (filmed, not used) | 0.80 | 3.80 |
| 3 | 23 Oct 2026 | Gemini transcript of the 3 filmed clips (what is said, which language) | < 0.01 | 3.80 |
| 4 | 23 Oct 2026 | Reel 1's call to action filmed again without the price ("Try the failed clips again"); the reel joined in the browser, 30.07 s; Gemini's review of it | 0.81 | 4.61 |
| 5 | 23 Oct 2026 | Reel `cmvldpn6s0003ug45xymta9pk`, English: 4 start frames, 4 clips of 8 s all filmed at the first try (no price spoken), joined, 30.07 s; Gemini's review of it. Veo switched off after it | 3.61 | 8.22 |
| 6 | 23 Oct 2026 | Round 2 (owner raised the budget to $20 and asked to keep Veo on): reel in Kinyarwanda with the clip Checker, start frames, 4 clips with the Checker's refilms, joined and re-cut for free; Gemini's reviews | 3.47 | 11.69 |
| 7 | 24 Oct 2026 | Round 3, the viral montage `cmvlld9s30005l6458d9cthux`: 7 start frames and 1 product shot filmed; the other 6 clips refused with RESOURCE_EXHAUSTED (the project's daily Omni quota, free) | 0.94 | 12.63 |
| 8 | 24 Oct 2026 | The montage finished after the quota reset ("Try the failed clips again"): 6 clips filmed, 1 product shot filmed again for the checker, joined in the browser, 30.07 s; Gemini's review | 4.00 | 16.63 |

**What the margins say:**
- **Voice-over:** 15 credits since 17 October (owner decision; it was 10, about cost). A 15 s script is about $0.06 to
  $0.07 (85 to 100 RWF) against 150 RWF, and even the longest take measured ($0.078, 113 RWF) is covered. On a
  subscription plan ElevenLabs' characters cost less than the list price, so the real margin is better.
- **Motion:** 35 credits since 17 October (owner decision; it was 30, under the 2.2× target because the measured design,
  $0.107, is above the $0.10 budget the price was set from). 35 gives 2.3× at the median.
- **Premium 3D:** its cash margin is large because the price mostly pays for the Mac's time: one render at a time,
  about 20 clips an hour at most.

### The monthly picture: 9M RWF of video sales

Provider cost = sales × (cost ÷ price) for each kind of video. There is no sales mix yet (clients do not have the
studio), so this shows the lab's own measured mix and the bounds:

| Mix | Provider cost share | Provider cost for 9,000,000 RWF of sales | USD |
| --- | --- | --- | --- |
| The lab's own charges so far (wallet, 16 to 17 October: Motion 150 credits, Premium 3D 120, re-render 70, voice 100, images 30; no Seedance yet) | 40% | about 3.6M RWF | about 2,500 |
| All Seedance (any tier: always about 1 ÷ 2.2) | 45% | about 4.1M RWF | about 2,840 |
| All Motion (at the measured median design) | 52% | about 4.7M RWF | about 3,210 |
| All Premium 3D at 540p (cash only; the Mac's time is the limit) | 12% | about 1.1M RWF | about 765 |

So at today's prices, providers take about 40 to 50% of video sales, and the rest is gross margin before hosting,
staff and MoMo fees.
- **Ceiling:** Premium 3D cannot carry 9M RWF a month, because the Mac renders one clip at a time (about 20 an hour).
  9M RWF would be about 9,000 clips, 450 hours of rendering.
- **Watch:** the voice-over, which is sold at about cost; Motion, slightly under target; and the first BytePlus
  invoice, which replaces the Seedance estimates.

### Where the costs are recorded

While in the Video Lab, every paid call is written to `video-lab/data/ledger.jsonl` with its tokens and cost (the
API-equivalent cost when Claude runs on the subscription), under a $5 daily cap (`VIDEO_LAB_DAILY_USD`). Seedance
clips add their real token cost when they finish (`seedanceUsage`), and Veo AI clips a `veo-clip` row each. Once in the
app, designs, voice takes, images, Seedance clips and a client's Veo clips go through `withLedger` like every other AI
call.

**Training Lab AI notes** (owner-approved test budget, 24 October 2026: **$2 in total**). Gemini watches an example the
owner drops in the Training Lab and drafts its notes (lib/training-lab/analyse.ts), about a cent a video. Every call is
in the AI ledger as feature `trainingLab`, and the Lab stops by itself when that feature's spend reaches
`TRAINING_LAB_ANALYSIS_CAP_USD` (2). Switched on with `TRAINING_LAB_ANALYSIS=1` on the owner's test site only.
