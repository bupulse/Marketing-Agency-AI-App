# BuPulse support chat (spec)

BuPulse's own customer support: a chat on every page (except the admin panel), an AI that knows the whole system, and a separate support app where staff reply, watch live visitors and take over from the AI. Like tawk.to, with AI built in. Branch `support-chat`, tested on test.bupulse.com before any deploy.

Not the same as the **Website chat** product (`docs/WIDGET.md`). That one is what clients put on *their* sites. This one is BuPulse talking to *its* visitors and clients. Code is shared where it fits (the loader pattern, Turnstile, limits, the Gemini provider).

Owner decisions (2026-10-23, grill session):

## 1. Where the chat shows

| Place | Who | Behaviour |
|---|---|---|
| Public site (bupulse.com: home, pricing, creators, sign-up, login…) | Visitors | Pre-chat form first: **name, email, business** (required) + **WhatsApp** (optional). Becomes a lead in Admin → Sales. One privacy line under the form. |
| Client dashboard | Signed-in owners and team | Straight into the chat; no form. Staff see their business, plan, trial. |
| Creator portal | Signed-in creators | Straight in. |
| Link-in-bio and other client-facing pages | Clients' customers | **No greeting popup.** A small "Made with BuPulse" corner link opens the chat in sales mode ("want a page like this?"). Questions meant for the business are pointed to that business's own contacts. |
| Admin panel | — | Never shown. |

**Greeting ("Need help?")**: smart, once per visit. A small bubble near the button after ~15 s (30 s on pricing and sign-up) with a line for that page ("Questions about plans?"). Once closed it stays closed for the visit. On phones it never covers content.

## 2. Who replies

- **AI first, staff take over.** The AI answers instantly, 24/7. Any agent can jump in, and then the AI goes quiet in that chat. The AI hands over by itself when it can't help or the person asks for a human.
- **Team hours** (e.g. Mon–Sat 8:00–20:00 Kigali) are shown in the chat. Outside them, the AI keeps answering. When it hands over, it says when the team opens and that they will reply by email or WhatsApp, and it opens a ticket.
- **AI knowledge:** the whole owner guide (`docs/guide/features/*`, pricing and plans, FAQs). For signed-in clients it also reads **their own account status**: plan, trial days left, Business info %, connected channels and expired ones, credits, failed posts. This is read-only, always scoped to that one business, and it never takes actions.

## 3. Support app (staff side)

- **Separate app**, first as a web app (e.g. support.bupulse.com), then a **downloadable desktop app** (Windows/Mac) and later phone apps. Everything goes through a versioned support API so the apps share one backend.
- **Accounts are created in Admin → Live chat.** Admin manages agents, departments, team hours, the greeting texts and the AI settings. Agents never use admin accounts.
- **Sign-in:** email + password + 6-digit authenticator code. The invite email sets the password and the code. Agents can be locked out instantly.
- **Roles:**
  - **Agent:** replies.
  - **Supervisor:** sees all chats, reassigns them, reads chats live, sees stats and ratings.
  - **Departments:** Sales, Technical help, Billing, Creators. They route chats.
- **Live visitors list:** who is on the site right now, with:
  - IP, country, city;
  - device, browser;
  - current page, pages visited, referrer;
  - time on site, visit count;
  - for signed-in people, also business/plan.
  - The privacy policy explains this (Rwanda data protection law, 2021). Agents can start a chat with a visitor who is browsing.
- **Alerts** for a new chat or a hand-over:
  - sound and a browser alert in the app;
  - push to the phone;
  - email after 2 minutes with no reply;
  - **WhatsApp** (built but off, since it needs the paid WhatsApp Business API).

## 4. Better than tawk.to (AI extras)

- **Summary and suggested replies:** when an agent opens a chat, 2 lines on what the person needs and 3 ready replies from the guide.
- **Live translation:** Kinyarwanda, French and Swahili ↔ English, both ways.
- **Knowledge gaps report:** questions the AI couldn't answer, each with a suggested guide addition, every week.
- **Lead score and urgency tags:** for example "hot lead: asked about Pro price" or "upset: post failed". Tagged chats sort to the top.

## 5. Inside the chat (visitor side)

- Screenshots, photos and PDFs up to 10 MB, checked and stored privately.
- A rating at the end, and an emailed transcript.
- "Continue on WhatsApp" (a wa.me link to the support number).
- **Voice notes** with a transcript for the agent. This uses Gemini audio on the free tier first (free-first rule). If that runs out, it is paused rather than paid.

## 6. tawk.to teardown

A UX and feature study of dashboard.tawk.to: the owner signs in to their own free account, and Claude clicks around read-only. Their widget goes on a throwaway test page to see the visitor list. **Ideas and features only; no copying of their code, text or artwork.** Findings: `docs/research/tawk-teardown.md`.

## 7. Open technical defaults (Claude's picks, change if needed)

- **Real time:** Supabase Realtime (free tier, already on Supabase) for new messages, typing and the visitors list, with a 5 s polling fallback.
- **AI model:** Gemini Flash-Lite (the same as the website chat, free tier), with the main text model as fallback. It is logged in the AI cost ledger as feature `support`.
- **IP location:** the hosting provider's geo headers (Netlify `x-nf-geo` / Cloudflare `cf-ipcountry`), with no paid IP database. The IP is stored for 30 days, then reduced to the country.

## 8. Build (started 2026-10-23)

**Designs:** the owner approved the mockups on the canvas "BuPulse Support Chat Design" (https://claude.ai/artifact/5nKvVay7E27mP37zBaP8e5). Build what they show.
- **Brand:** Geist, background `#f5f5f7`, text `#1d1d1f`, muted `#5e5e63`, and the brand gradient `linear-gradient(120deg, #2f6bff, #7b5cff)` for the launcher and primary buttons. Use the existing Tailwind tokens and components (`bg-brand-gradient`, `glass`, `Button`, `GlassCard`).
- **Support app sidebar:** the brand gradient in light mode, not black (owner, 23 Oct). In dark mode it takes a dark tone, e.g. `#0b0b0f` or the dark glass of the dashboard, with the gradient only on accents.
- Both the support app and the widget follow the site's light/dark theme.

**Contract:** `lib/support/contract.ts` defines the request bodies, responses, routes and real-time events. Prisma models are `Support*` in `prisma/schema.prisma`. Change the contract only in sc-core, and announce it.

**Who builds what.** Three branches off `support-chat`, each in its own folder:

| Branch / folder | Owns | Does not touch |
|---|---|---|
| `sc-core` (`~/BuPulse-sc-core`) | The migration (with the `support_heartbeat` RPC and the RLS on `realtime.messages`), `lib/support/**` (except the contract, which it may extend), `app/api/support/**`, AI (guide search over `SupportGuideChunk`, account facts, hand-over rules, summary, suggestions, rewrite), real-time broadcast, uploads to the private bucket `support`, leads from the pre-chat form, email alerts after 2 min, retention jobs, the agent auth guard `requireSupportAgent`, the agent and department services that Admin uses, and tests | Widget UI, support app UI |
| `sc-widget` (`~/BuPulse-sc-widget`) | The visitor chat:<br>• loader `public/support-widget.js`<br>• chat page `app/help-chat/**`<br>• its UI and greeting rules<br>• mounting it on public pages, the dashboard and the creator portal (never Admin)<br>• the bio-page corner link<br>• the privacy-policy section<br>• tests | API internals, support app |
| `sc-app` (`~/BuPulse-sc-app`) | `support.bupulse.com`:<br>• host routing in `proxy.ts`<br>• `app/support/**`: sign-in with password + TOTP, chats, live visitors, stats; installable as a PWA<br>• `app/admin/(console)/live-chat/**` (agents, departments, hours, greetings, AI rules)<br>• the menu entry in Admin<br>• tests | API internals, widget |

**Until sc-core lands,** sc-widget and sc-app build against the contract, with a small mock where they need data. The main session merges `sc-core` first, then the others, into `support-chat`, then `support-chat` into `quiz-mode` for test.bupulse.com.

## 10. Visitor chat (sc-widget)

The chat visitors, clients and creators see. Guide page for owners: `docs/guide/features/39-help-chat.md`.

**Where it shows.** `SupportChatMount` (`components/support-chat/mount.tsx`) sits in the root layout. `chatSurface` (`lib/support/client/mount.ts`) decides from the path and host:
- `/dashboard/**` → `dashboard`, `/creator/**` → `creator`, every other page → `public`;
- never on `/admin`, `/support`, `/help-chat`, `/b/`, `/widget/`, `/screen/`, `/api/`, or any `support.` host.

Link-in-bio pages (`lib/bio/page.ts`) get only the "Made with BuPulse" corner pill. It links to `/help-chat?from=bio`, the chat on a page of its own (`app/help-chat/page.tsx`), surface `bio`: sales mode, no greeting. The bio page keeps its strict CSP and loads no extra script.

**Two corner buttons on the public pages** (owner, 23 Oct). The green WhatsApp button (`components/marketing/whatsapp-button.tsx`, 48 px, only when `NEXT_PUBLIC_WHATSAPP_NUMBER` is set) stays, 12 px above the chat button (60 px), on the same right edge. The rules are `.bp-whatsapp-fab` in `app/globals.css`:
- it hides while the panel is open (`html[data-support-chat-open]`); the chat keeps its own "Continue on WhatsApp";
- it takes the corner when the chat could not start (`html[data-support-chat-off]`);
- the greeting moves up by `--bp-fab-stack`, so it covers neither button;
- on phones (≤ 480 px) the page gets bottom padding, so its end scrolls clear of both buttons. Both stay at least 44 px. There is no cookie bar (only essential cookies); the buttons already sit above the dashboard and creator phone bars (`--bp-bottom-bar`).

**Loading.** At first only the gradient button is drawn. The chat code (`components/support-chat/widget.tsx`) loads when the browser is idle, or on hover or the first tap. supabase-js loads only when the panel opens (real time). The mock server (`lib/support/client/mock.ts`) is used only with `NODE_ENV !== "production"` and `NEXT_PUBLIC_SUPPORT_CHAT_MOCK=1`, so it never ships.

**Greeting** (`lib/support/client/greeting.ts` `greetingMode`). It shows after `greeting.delaySec` from `/visit`, once per visit (sessionStorage `bp-sc-greeting`). It never shows:
- within 7 days of the visitor's last chat message (localStorage `bp-sc-last-chat`);
- on the first page of a visit that came from an ad (`gclid`, `fbclid`, `ttclid`… or a paid `utm_medium`) or a bio link (`utm_source=bio` or a `/b/` referrer);
- while chatting or with the panel open, or on bio pages.

Phones (≤ 480 px) only get a red dot on the button. Closing the greeting keeps it closed for the visit.

**Panel.** On a computer, a 380 × 640 card above the button. On a phone, a full-screen sheet: it pushes a history entry, so Back closes it, and the page behind does not scroll. Focus moves into the panel (not into a field on phones, so the keyboard stays down); Tab stays inside; Esc closes and gives focus back to the button. New messages are announced (`role="log"`, `aria-live`). Light and dark follow the site. All words are in `lib/support/client/copy.ts`.

**Views:**
- Pre-chat form, when `me.needsForm` and no conversation yet: name, email and business (required), WhatsApp after +250 (optional, saved as E.164), the privacy line (links `/privacy#support-chat`) and "Already a client? Log in".
- Chat:
  - the AI's "from the guide" line (`sources`) and its action buttons (only `/…` and `https://` links);
  - quick replies, "Talk to a person" and "That's all, thanks";
  - EVENT messages as dividers (body shown as-is); the typing line; the agent's initials and name in the header; the team hours label; WhatsApp.
- End screen: thumbs up/down, comment, "Email me a copy" (only when the email is known), WhatsApp, "Start a new chat".

**Sending** (`lib/support/client/outbox.ts`):
- Every message gets a `clientMsgId` once. Messages go out one at a time and in order, with the same id on every retry.
- Network and 5xx errors retry by themselves (1, 2, 4 … 30 s). 4xx errors wait for "Tap to try again".
- Offline, the messages wait and go out on `online`. Text-only messages survive a reload (sessionStorage).
- The banner says "Reconnecting…" or "You are offline"; the conversation never disappears.
- A 403 `challenge_required` runs Cloudflare Turnstile (`turnstileSiteKey` from `/visit`) and retries once.

**Files** (`lib/support/client/uploads.ts`, `components/support-chat/media.ts`):
- Photos are redrawn in the browser as JPEG, at most 1600 px on the longest side (iPhone HEIC converted), unless already small.
- PDFs: at most 10 MB (`UPLOAD_LIMITS`).
- Voice notes: MediaRecorder (webm/opus, mp4 on Safari), stopped at 120 s. They show as a waveform bubble with the transcript.
- Flow: `POST …/uploads`, `PUT` the file to `uploadUrl`, `POST …/uploads/:id/done`, then the message with `attachmentId`. A retry does not upload again.
- Files need a conversation, so the paperclip and microphone wake up after the first message.

**Real time and heartbeats** (`components/support-chat/use-support-chat.ts`):
- The visitor topic (`conversation.topic`, or `visit.topic`) is subscribed only while the panel is open. A `message.created`, `conversation.updated` or `handover` ping fetches `GET …/messages?after=<last id>`. A `typing` ping shows the dots.
- While the socket is down and the panel is open, it polls every 5 s.
- Heartbeats go to Supabase's RPC endpoint (`/rest/v1/rpc/support_heartbeat`, public key only) every 45 s while the tab is visible. Page changes are sent the same way, 1.5 s after the visitor settles on a page, never twice for the same path, path only (no query).
- The typing draft goes at most once a second, only with the panel open and a conversation.

**What the widget expects from the API** (asked of sc-core):
- `VisitResponse` also has `topic` (before any conversation), `whatsapp` (E.164 or null) and `turnstileSiteKey`. All are optional in the widget's type (`Visit` in `lib/support/client/api.ts`).
- 401 on a visit token: the widget calls `/visit` again once.
- The heartbeat RPC may answer `{ unread }`; then the closed button shows a dot.

**Tests:** `tests/support-widget/` covers:
- greeting rules, mount exclusions, phone width;
- outbox order, retry, idempotency and offline;
- path and typing throttles;
- upload checks, shrink sizes, voice types, the pre-chat form;
- the HTTP client with a fake fetch, the mock, and the bio corner link;
- the two corner buttons' sizes and stacking rules (`buttons.test.ts`).
