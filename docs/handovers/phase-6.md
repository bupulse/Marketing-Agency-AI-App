# Phase 6 handover: website chat widget and leads

Built 8 October 2026. Decisions are in `docs/STAGE1_IMPLEMENTATION_PLAN.md` (Phase 6, "Decided 8 October 2026").
Setup, limits and security notes are in `docs/WIDGET.md`.

## What works (tested locally)
- **Chat widget** (`/dashboard/widget`, nav "Website chat"):
  - One script line: `public/widget.js` draws the launcher in a closed Shadow DOM and opens `/widget/<key>` in an iframe.
  - The chat page is a route handler with a per-business `frame-ancestors`. Every other page now denies framing.
  - Replies follow the visitor's language, including the fixed texts.
  - The contact card appears after helping, on interest (price, booking) or when the AI can't answer.
  - Phones (480 px and under) get a full-screen chat.
  - Model: `WIDGET_MODEL` (default gemini-3.1-flash-lite), about $0.0005 per reply.
- **Limits:**
  - Chat replies per month: 50 / 1,000 / 5,000. At the limit, contact collection continues without AI.
  - Each message claims its slot atomically, with 40 messages per session.
  - Per-business limits, a per-business IP limit and a global IP flood guard.
  - 30 AI replies a day per visitor per business.
  - Turnstile is optional; an interactive challenge shows inline.
- **Allowed websites:** new widgets start with the business website's domain. An empty list is allowed, and the dashboard warns about it.
- **Local testing:**
  - Pages on `http://localhost:<any port>` work, and so do pages opened as a file, but only while BuPulse itself runs locally.
  - `widget.js` logs `[BuPulse chat] Not shown: …` in the console with the reason.
- **Leads inbox** (`/dashboard/leads`):
  - Statuses, notes and filters, plus CSV export (formula-safe, phones kept clean).
  - An instant email per lead.
  - A daily summary at 08:00 business time (cron `37 * * * *`, filtered to the zones where it is 08:00, paged).
  - An optional HMAC-signed webhook: 3 quick tries, then hourly retries for 24 h (`Lead.webhookPendingAt`). Delivery is at least once, so receivers dedupe on `lead.id`.
- **Crons:** `worker.ts` maps each schedule explicitly. `tests/worker-crons.test.ts` keeps it in sync with `wrangler.jsonc`, and an unknown schedule logs an error.

## Reviewed
- An Opus review found 2 high, 4 medium and 5 low issues; all are fixed.
- The owner's own test then found two more problems, both fixed:
  - the chat box was empty on local test pages (`frame-ancestors` missed localhost ports);
  - pages opened as a file couldn't load the chat.
- Checks: tsc, lint and 902 tests pass, and `next build` succeeds. WebKit and Chromium browser runs pass at desktop and phone width.

## Open items
- **Turnstile:** not tried with real keys. Create the keys before launch; without them a production error is logged and only the limits apply.
- **Not checked on real Workers:** the headers and Cache-Control for `widget.js`, and the crons.
- **Snippet address:** the snippet uses `NEXT_PUBLIC_SITE_URL`. Owners must copy it again after deploy, because the localhost snippet only works on this Mac.
- **Translations:** a native speaker should check the Kinyarwanda and Swahili UI strings.
- **CSP warning:** in WebKit against `next dev`, the chat iframe logs a harmless "Refused to apply a stylesheet" warning. It was not seen on a production build, and the styling is fine.
- **Dashboard preview:** it uses real chat credits and creates real leads.
- **Owner's test page:** `~/Downloads/WECLEARN V2/index.html` line 811 now loads `http://localhost:3000/widget.js`.
