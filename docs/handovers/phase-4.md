# Phase 4 handover: AI content studio

Built 6–7 October 2026. Details: `docs/DESIGNS.md`, `docs/CANVA.md`.

## What works (tested with the real Gemini key)
- Writing: caption, hashtags, 30-second video script and ad headlines in the business's language.
  - The 20-business quality check (`npm run ai:eval`) passes 20/20.
  - 5 businesses passed end to end in the browser: English, Spanish, French, Swahili and Kinyarwanda.
- Models (Interactions API, `lib/ai/gemini-text.ts`, `lib/ai/gemini-image.ts`):
  - Text uses `gemini-3.8-flash`, falling back to `gemini-3.1-flash-lite` when busy. About $0.002 per write.
  - Images use `gemini-2.5-flash-image`. About $0.039 per image.
  - Gemini 2.5 Flash text is closed to new accounts; newer models are not served by `generateContent`.
- Every AI call is in `AiCall` with its cost. The $20/month cap (`AI_MONTHLY_BUDGET_USD`) stops AI calls and logs an alert.
- Designs:
  - **Free templates:** 7 templates × 5 brand style packs (clean, elegant, bold, warm, playful).
    - The pack is chosen from the brand voice and industry; the client can switch.
    - Labels are in the content language (Arabic falls back to English: satori cannot shape RTL).
  - **AI photo + brand layout:** 1 image credit. The photo is laid out in the chosen pack.
  - **Describe an image:** 1 image credit.
  - **AI images include realistic local customers or staff** taken from the business info. The "Include people" switch is on by default, and "no people" or "product only" in the description turns it off. Brand colours are described in words, never as hex codes.
  - AI images are limited to 10 per hour per user. Credits are refunded on provider failures only.
- Edit in Canva (`lib/canva/*`):
  - OAuth with PKCE and encrypted tokens.
  - Open sends the design to Canva; the return saves the edit as a new design, atomically and repeatable.
  - Hidden until `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` are set. **Not yet tested against real Canva.**
- Fixed along the way: stored brand knowledge with missing fields was dropped entirely (`readKnowledge`).

## Reviewed
An Opus review found 2 high, 5 medium and 9 low issues; all are fixed.

## Open items
- **Canva:**
  - The owner is creating the app in the Canva Developer Portal (scopes `asset:write`, `design:content:write`, `design:content:read`); run the full round trip with the keys.
  - The export download host check (`isCanvaDownloadUrl`) is a guess.
  - The not-signed-in return path is untested.
  - Public review before launch.
- **Speed:** from Kigali against the US database, writing takes about 29 s: ~8–11 s Gemini, ~10 s of database round trips (~0.25 s each), and ~8 s re-rendering the project page. Re-measure on Cloudflare (Hyperdrive). If still slow:
  - merge `consumeUsage` into one SQL statement;
  - trim the project page's sequential queries.
- **Workers:** the `caches.default` preview and font caches only run on Workers. Check them in `wrangler dev` or after deploy.
- **Keys:** the Gemini key was pasted in chat; rotate it before launch.
