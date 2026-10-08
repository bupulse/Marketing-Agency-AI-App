# Website chat widget

A chat bubble owners add to their website with one line. It answers visitors from the business's own facts and collects contact details as leads (see `lib/leads`). Phase 6.

```html
<script src="https://bupulse.com/widget.js" data-key="WIDGET_KEY" async></script>
```

## How it fits together

| Part | File |
|---|---|
| Loader (vanilla JS, cacheable, never throws) | `public/widget.js` |
| Chat UI inside the iframe (vanilla JS) | `public/widget-chat.js` |
| Chat page `/widget/<key>` (route handler, HTML + per-business CSP) | `app/widget/[key]/route.ts`, `lib/widget/page.ts` |
| Chat API `POST /api/widget/chat`, contact card `POST /api/widget/lead`, launcher config `GET /api/widget/config` | `app/api/widget/*`, `lib/widget/chat.ts` |
| AI reply, prompt, parsing | `lib/widget/ai.ts`, `lib/widget/prompt.ts` |
| Origin / frame rules | `lib/widget/origin.ts` |
| Turnstile | `lib/widget/turnstile.ts` |
| Dashboard page (settings, snippet, live preview, usage) | `app/dashboard/widget`, `components/widget` |

`widget.js` fetches `/api/widget/config` (public data only), and if the widget is on and the site is allowed, draws a launcher inside a closed Shadow DOM (host CSS cannot reach it) and, on first open, an iframe to `/widget/<key>`. The iframe holds all UI. It tells the loader to resize or close by `postMessage` (the loader only trusts messages from its own iframe and our origin). On phones (max 480px) the open chat is full screen. Animations are disabled under `prefers-reduced-motion`. Everything in the loader is wrapped in try/catch. `window.BuPulse.open()/close()/toggle()` are available.

## Allowed domains and their limits

Owners list the sites that may show the chat. Empty list = any site (easy install). A domain also covers its subdomains; `www.` is ignored.

- **Framing (strong, browser-enforced):** the chat page sends `Content-Security-Policy: frame-ancestors 'self' https://site https://*.site`, or `frame-ancestors *` when the list is empty. Every other page of the app sends `frame-ancestors 'none'` and `X-Frame-Options: DENY` (`next.config.ts`). `'self'` keeps the dashboard preview working.
- **API (best effort):** the chat API checks the `origin` value `widget.js` passes (the host page's hostname), the `Origin` header (a browser call from another site is rejected) and the `Referer` of the chat page (its `origin` parameter must agree). Browsers cannot forge `Origin`/`Referer`, so this stops the key being used on other websites. But anyone calling the API from a script (curl) can send any `origin` value. It is therefore not a security boundary: abuse is limited by the rate limits, the message and session caps, Turnstile, and the monthly chat credits and AI budget. The page request also rejects a `Referer` host that is not allowed.

## Abuse protection

- Rate limits (`lib/widget/limits.ts`, table `RateLimit`): per IP 60 / 10 min (IP is hashed), per visitor 20 messages / 10 min, per business 40 / minute, contact card 6 / 10 min per visitor.
- Message at most 1000 characters; a session at most 40 visitor messages (then only contact collection).
- A session belongs to its `visitorId` (random, kept in the iframe's localStorage); another visitor's session id is rejected.
- **Cloudflare Turnstile:** set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to turn it on (managed, shown only if needed: `appearance: interaction-only`). It is required for the first message of a session, again every 10th message and when messages arrive faster than 1.2 s apart. The token is verified server-side. **Without both keys Turnstile is skipped** and only the limits above apply. Add `challenges.cloudflare.com` to the Turnstile widget's allowed hostnames for `bupulse.com`.

## AI

- Model: `WIDGET_MODEL` (default `gemini-3.1-flash-lite`) through `GeminiTextProvider`; the main text model (`GEMINI_TEXT_MODEL`) is the fallback when Flash-Lite is busy. Recorded in the cost ledger as feature `widget`.
- The system prompt contains only that business's facts: name, industry, description, audience, website, hours, area, contact, FAQs and its 15 most recent projects (title, type, price, features). Rules: never invent prices, availability, policies or contact details; if unsure say so and offer a team reply; refuse off-topic or harmful requests briefly; answer in the language of the visitor's last message; 2 to 4 sentences. Visitor text is passed as JSON data, and the prompt says it is never instructions.
- The model returns `{ reply, wantsContact, language, detected: { name, email, phone, interest } }`.
- **Contact timing:** the contact card (name, phone or email, short interest) appears when the model sets `wantsContact` (interest in price, booking, buying, a quote, or it could not answer), when the visitor's message contains such words, or from the 3rd visitor message. Never once a lead exists. Emails and phone numbers typed in a message are also found by the server and saved. Saving calls `createLeadFromChat` (`lib/leads/service.ts`), which sends the instant email and webhook.
- Language: the greeting and fallback texts (`lib/widget/strings.ts`) use the business's content language; AI replies follow the visitor.

## Usage and plans

Each AI reply uses 1 `chat` credit of the business owner (`consumeUsage(userId, "chat")`), refunded if the AI call fails. Limits: Trial 50, Standard 1,000, Pro 5,000 per month. With no credit left, an expired trial, an inactive or past-due subscription, there is no AI reply: the visitor sees "Leave your details and the team will get back to you." with the contact card, and leads still work.

## Install guide and "Check installation"

`/dashboard/widget` shows a grid of platforms (HTML, WordPress, Next.js, React, Shopify, Wix, Squarespace, Webflow, Google Tag Manager). Each opens a dialog with the exact code (real key and `NEXT_PUBLIC_SITE_URL`, escaped), a Copy button, and an animated walkthrough: a mock editor or menu per step, auto-advancing with progress dots (pauses on hover or focus, steps are clickable, still frames with `prefers-reduced-motion`). Content lives in `lib/widget/install.ts`; the CSS animations in `components/widget/install-guide.css`.

The loader works with `next/script` (`document.currentScript` is null there, so it falls back to `script[data-key][src*="widget.js"]`) and survives client-side navigation: one launcher, never mounted twice (checked in WebKit).

When the config endpoint answers "enabled" for a site that is not BuPulse itself, it records `ChatWidget.lastSeenAt` and `lastSeenHost`, at most once per 10 minutes. "Check installation" reads these (and compares with the page address the owner types). Visits from the same hostname as BuPulse (for example localhost while developing) are not recorded.

## Setup for a business

Open **Website chat** in the dashboard (this creates the widget row), copy the snippet, paste it before `</body>`. Guides for WordPress, Wix, Shopify, Squarespace and plain HTML are on that page.

## Tests

`npx vitest run tests/widget` (units and service with mocks). Quality eval with the real model: `npm run ai:eval:widget` (5 businesses x 4 questions, costs cents).

## Lead webhook delivery

Lead webhooks are now part of the general outgoing webhooks (Connectors > Webhooks, `lib/webhooks`, `docs/WEBHOOKS.md`). Each endpoint that listens to `lead.created` gets the event, with the same signature, retries and delivery log. The old per-widget address (`ChatWidget.webhookUrl`) was moved into an endpoint by migration `20261008060000_connectors_hub_webhooks_api`, keeping the same secret.
