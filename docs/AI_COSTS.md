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
| **Motion** video (one Claude design) | 0.107 median (0.087 to 0.161, mean 0.114) | 155 | 30 credits | 300 | 1.9× (1.8× at the mean) | measured, 43 `claude-design` rows (Sonnet 5.5); rendering and MP4 are free (the browser) |
| **Premium 3D**, 540p, up to 8 s | 0.085 design + Mac time | 123 | 100 credits | 1,000 | 8.1× on cash | measured, 1 `claude-blender-design` row; `docs/BLENDER.md` "Premium 3D credits" says $0.08 to $0.09 |
| **Premium 3D**, 720p | 0.085 + about twice the Mac time | 123 | 150 credits | 1,500 | 12.2× on cash | as above; 720p render time not yet measured |
| Premium 3D **re-render** | 0 (Mac time only) | 0 | 70 credits | 700 | (machine slot) | `PREMIUM_RERENDER_CREDITS`; the 70 pays the Mac, about 1.5 to 3.5 min for 6 s at 540p (`docs/BLENDER.md`) |
| **Voice-over**, one take | 0.059 median (0.036 to 0.078) | 86 | 10 credits | 100 | **1.2× (0.9× for the longest take)** | measured, 7 `elevenlabs-voice` rows at the list price ($0.30 per 1,000 characters); a reused take is free and its credits are given back |
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

**What the margins say:**
- **Voice-over:** 10 credits is about cost. A 15 s script is about $0.06 to $0.07 (85 to 100 RWF) against 100 RWF; the
  longest take measured ($0.078) loses money. On a subscription plan ElevenLabs' characters cost less than the list
  price, so the real margin is better, but at list price 15 credits would give the 2.2× the other items have. Owner
  decision.
- **Motion:** at 30 credits it is under the 2.2× target, because the measured design ($0.107) is above the $0.10
  budget the price was set from. 35 credits would restore 2.2× at the median.
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
clips add their real token cost when they finish (`seedanceUsage`). Once in the app, designs, voice takes, images and
Seedance clips go through `withLedger` like every other AI call.
