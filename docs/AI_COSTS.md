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

## Video engine (October 2026)

The Claude video engine (docs/VIDEO_ENGINE.md) makes one Sonnet call per video design (two when the first answer
cannot be read), with up to 4 product photos as images: about $0.05 to $0.12 a video. Rendering, the MP4 and music are
free. Seedance clips (BytePlus, next) are about $0.35 (480p) to $0.76 (720p) per 5 seconds, an estimate until the first
BytePlus usage is read back. While in the Video Lab, every call is written to `video-lab/data/ledger.jsonl` with its
tokens and cost, under a $5 daily cap; once in the app, designs go through `withLedger` like every other AI call.
