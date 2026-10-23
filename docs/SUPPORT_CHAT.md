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

## 9. Server (sc-core, 23 Oct 2026)

How the back end works. Code: `lib/support/**`, routes `app/api/support/v1/**`, route reference `docs/api/support-v1.md`.

**Database.** Migrations `20261031100000_support_chat` and `20261031100100_support_chat_unread`:
- the `Support*` tables, with RLS on and every grant revoked from the Data API roles (the app reads them through Prisma only);
- the four departments: `sales`, `technical`, `billing`, `creators` (Admin may rename them);
- `support_heartbeat(p_token, p_path, p_title)`, a `security definer` function and the only thing the anon key may call (see "Heartbeat" below);
- Realtime policies on `realtime.messages`: the private topics `staff:*`, `conv:<id>` and `agent:<id>` need an active, unlocked `SupportAgent` whose `userId` is `auth.uid()` and an `aal2` session. A restrictive policy keeps those prefixes closed whatever other policy is added later;
- full-text search over the guide: a generated `tsv` column on `SupportGuideChunk` with a GIN index (not in the Prisma schema; read with `$queryRaw`);
- the private Storage bucket `support` (10 MB, the types in `UPLOAD_LIMITS`, no Storage policies).

**A visit, step by step.**
1. The widget calls `POST /visit` on every page, with the token it already has. This is the only time a Netlify function sees the visitor, so it records the address, the location from the host's geo headers (Netlify `x-nf-geo`, no paid IP database), device, system and browser (from the user agent), the referrer's host name, and the signed-in client or creator (from the Supabase session cookie).
2. While the tab is visible, the page sends heartbeats straight to Supabase (`rpc("support_heartbeat")`), so browsing costs no Netlify credits. The function:
   - finds the visit by the token's SHA-256 (the token is never stored);
   - writes at most once every 10 s (page changes at most once a second);
   - adds a page hit when the page changes, 50 per visit at most;
   - pings `staff:visitors`;
   - answers `unread`: agent messages the visitor has not seen, so the widget can open itself;
   - answers `expired` after 20 minutes without a heartbeat. The widget then calls `/visit` again.
3. The visit token is sent as `X-Support-Visit` on every chat call and names the visitor. A visitor only ever reaches their own chats; anything else answers 404. A signed-in person also reaches their chats from another browser. A browser row linked to one account is never reused for another (shared computers).

**Pre-chat form.** On public pages and the bio corner link, `POST /prechat` is needed before the first message. It saves name, email, business and WhatsApp on the visitor and makes a `ContactRequest` of kind `support_chat`, which is BuPulse's own lead. The same email within 30 days reuses its row, and the first question is copied into it. Admin → Live chat lists them through `listSupportLeads({ after, limit })` (`lib/support/leads.ts`).

**The AI's turn** (`lib/support/answer.ts`), only while the chat is with the AI (status `AI`):
- The guide index is searched with the visitor's last two messages: Postgres FTS, any word matches, titles count more, top 4 sections. The prompt also gets the guide map (one line per file).
- Plus today's plans and prices for the visitor's region (not for creators).
- Plus the client's own account facts on the dashboard: plan, trial days left, Business info %, channels, failed posts this week. These are read-only and cached for a minute.
- Plus the team-hours line and the owner's AI rules and hand-over topics from Admin → Live chat.
- Gemini Flash-Lite (`SUPPORT_MODEL`, then `WIDGET_MODEL`) answers in JSON:
  - the reply, in the language of the visitor's last message;
  - language, confidence, a hand-over flag, sales, department, urgency and lead signal;
  - a short note for the team, topic tags, the guide sections used and up to 2 buttons.
- Buttons are kept only when their link is a known page.
- The cost goes to the AI ledger as feature `support`, never to a client's AI allowance.
- Limits: 40 AI answers a minute across everyone and 60 per address a day. Over the limit, or when the AI fails or is switched off, the chat goes to a person.

**Hand-over rules** (`lib/support/rules.ts`, in this order):
1. The visitor asked for a person (English, French, Kinyarwanda and Swahili phrases, or the AI's flag).
2. The visitor is upset.
3. One of the always-handed-over topics.
4. No AI answer.
5. The AI was not confident.

On public pages and the bio link, sales and pricing questions stay with the AI and get the tag `sales`; asking for a person or being upset still hands over there. A hand-over (`lib/support/handover.ts`) does this:
- The AI goes quiet, the chat goes to the AI's department, and `waitingSince` and a system event are set.
- In team hours: status `WAITING`, a push to the agents on duty at once, and the 2-minute email job.
- Outside team hours: status `PENDING` (a ticket), the tag "outside hours" and the ticket email to the visitor.

**Agents** (`requireSupportAgent`):
- Each call needs `Authorization: Bearer <Supabase access token>`, checked with Supabase Auth (a revoked session fails). Then the support app's own rules decide (`agentAccess` in `lib/support/app-access.ts`, shared with its pages): a `SupportAgent` that is not locked, signed in with a password or an emailed link, at `aal2` with a verified authenticator app.
- An invited agent's first full sign-in links their account and activates them.
- Supervisors see every chat. Agents see the AI's chats, the waiting ones and their own.
- A TEXT reply takes the chat over (the AI goes quiet). A NOTE stays internal.
- `translateTo` sends the agent's text translated, and the original stays visible to agents.
- `/assist` (a summary and 3 suggestions) is cached per last message.
- Locking an agent (Admin → Live chat, `lib/support/agents.ts`) refuses their next call and deletes their sessions; `forceLogout(agentId)` (`lib/support/realtime.ts`) then tells their open app to sign out.

**Real time.** The server sends pings with Supabase Realtime's REST broadcast and the service key; no socket is held.
- Payloads are the `RealtimeEvent` objects. Clients fetch the details over REST.
- The visitor's topic `sv:<secret>` is public, one per visitor (the same for all their chats, and known from `POST /visit` before any chat, so a chat an agent starts reaches an open panel). Its secret is an HMAC of the visitor id, made with a key derived from `ENCRYPTION_KEY`; nothing secret is stored. That topic only ever gets content-free pings, never a draft.
- EVENT messages ("Jean M. joined · the AI stepped back", "Waiting for a person from the BuPulse team") are written for the visitor, who sees them as a divider; the hand-over reason stays in `handoverReason` for agents.

**Jobs** (DueJobs, run by the every-minute cron `app/api/cron/publish`; no new cron):

| Job | When | What |
|---|---|---|
| `support.alert` | 2 min after a hand-over in team hours | Emails the agents on duty if nobody has replied; once per hand-over |
| `support.ticket` | at a hand-over outside team hours | "We got your message" to the visitor |
| `support.reply_email` | 2 min after an agent's reply | Emails the reply to a visitor who has not seen it in the chat |
| `support.transcript` | after a rating that asked for it | The transcript, once |
| `support.judge` | 2 h after an AI-only chat's last message, or when it closes | Sets `aiResolved` (a person touched it or a thumbs-down: no; a thumbs-up: yes; otherwise a Flash-Lite check) |
| `support.sweep` | hourly, schedules itself | Retention, below |

The sweep is idempotent. It does this:
- closes visits idle for 20 minutes;
- clears the IP, city and region 30 days after the visit (the country stays);
- deletes page hits after 30 days;
- deletes files 90 days after upload, and upload slots nobody finished after an hour;
- closes AI-only chats with nothing new for a day.

**Uploads.**
1. `POST …/uploads` checks the type, the size (10 MB) and voice notes' length (2 minutes), then gives a signed upload URL into `conv/<id>/…`.
2. The widget PUTs the file to that URL.
3. `…/done` checks what really arrived.
4. A voice note is transcribed with Gemini audio at that step, so the AI and the agent read the words. If that fails (quota), `transcriptStatus` is `paused` and the audio still goes through.

Download links are signed for an hour.

**The guide index.** `node --env-file=.env --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/support-guide-index.mjs` rebuilds it from `docs/guide/features/*.md` after the guide changes. It splits the files at `##`, skips "For developers" sections, and is hash-based and idempotent. An empty index fills itself on first use: the files ship with the API routes through `outputFileTracingIncludes`.

**Environment.**
- Existing variables it needs:
  - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (given to browsers for Realtime);
  - `SUPABASE_SECRET_KEY` (broadcast, storage, invites);
  - `ENCRYPTION_KEY` (topic secrets);
  - `GEMINI_API_KEY`;
  - `TURNSTILE_*` (optional: new chats, every 10th message, fast messages and the form);
  - `RESEND_*`;
  - `VAPID_*` (optional push).
- New, both optional:
  - `SUPPORT_MODEL`.
  - `SUPPORT_APP_URL` (added by sc-app): the support app's address for links in emails. Empty means `<site>/support`.

**Limits** (`lib/support/limits.ts`):

| What | Limit |
|---|---|
| `/visit` | 300 per address and 60 per visitor in 10 minutes |
| Pre-chat form | 6 per visitor in 10 minutes |
| Messages | 20 per visitor and 120 per address in 10 minutes |
| Message polls | 150 per visitor in 10 minutes |
| Typing | 90 a minute per chat |
| Uploads | 20 an hour per visitor |
| Agent calls | 600 a minute per agent |
| Assist, rewrite and translate | 60 per agent in 10 minutes |
| Agent-started chats | 30 an hour per agent |

**Left for v2:**
- live translation of visitor messages for agents (after the 30-sentence Kinyarwanda check);
- the weekly knowledge-gaps report and the bad-answer flag;
- canned replies;
- agent uploads;
- pgvector hybrid search;
- cancelling an AI resolution when the visitor returns within 72 h;
- CORS for the desktop app;
- WhatsApp alerts (paid).

## 11. Support app and Admin (sc-app)

### Where it lives

- **support.bupulse.com** serves only the support app. `proxy.ts` rewrites every path on that host under `/support`
  (`lib/support/app-host.ts`): `support.bupulse.com/visitors` is `app/support/(app)/visitors`. Its assets (`/_next/`,
  `/icons/`, `/support-sw.js`) and the API (`/api/support/`) pass as they are; anything else of the site (dashboard,
  admin, other APIs) is rewritten too, so it is **not found** there. Paths the proxy matcher skips (the widget,
  `/b/` bio pages, webhooks, `/api/v1`) are still served on that host by the same Netlify site; they are public anyway.
- On any other host the same app opens at **/support** (local testing: `http://localhost:3001/support`, or
  `http://support.localhost:3001` for the host mode; test site: `https://test.bupulse.com/support`). Links use the base
  `""` on the support host and `/support` elsewhere (`supportHref`).
- Never indexed: `X-Robots-Tag: noindex, nofollow` from the proxy, `robots` metadata on every page, `/support` in
  `app/robots.ts`, and `support.bupulse.com/robots.txt` disallows everything.
- `SUPPORT_APP_URL` (optional, e.g. `https://support.bupulse.com`) is where invite and reset links point. Unset, they
  point to `<PUBLIC_LINK_URL or NEXT_PUBLIC_SITE_URL>/support`, which works before the domain is set up.

### Owner steps for support.bupulse.com (not done yet)

support.bupulse.com is a **domain alias of the same Netlify site** (no second site, no second deploy):

1. Netlify → the BuPulse site → **Domain management** → **Add a domain** → `support.bupulse.com` → **Add domain**
   (Netlify calls it a domain alias).
2. At the DNS provider of bupulse.com, add a **CNAME**: name `support`, value `<the-site>.netlify.app` (the site's
   Netlify address, shown in Domain management). If bupulse.com's DNS is Netlify DNS, Netlify adds it by itself.
3. Wait for **HTTPS** to show as active for the alias (Netlify's free Let's Encrypt certificate, minutes to an hour).
4. In Netlify → Environment variables, add `SUPPORT_APP_URL=https://support.bupulse.com`, then redeploy.
5. Open https://support.bupulse.com: it shows the support sign-in. (No Supabase redirect URL is needed: the invite and
   reset links open our own pages, which verify them.)

### Sign-in (agents only)

`app/support/(auth)/*`, actions in `app/support/(auth)/actions.ts`. Same Supabase Auth as Admin (TOTP at AAL2), but the
person must be a `SupportAgent` row: never the owner's, a staff member's or a client's sign-in.

- **Sign in:** work email + password (`signInWithPassword`), then **/verify** (6-digit code) or **/setup** (add an
  authenticator app). Every wrong answer looks the same and takes at least 1.2 s.
- **Invite:** Admin creates the sign-in with `auth.admin.generateLink({ type: "invite" })` and emails **our own** link
  `…/accept?token_hash=…&type=invite` (the link never leaves the email: not returned, logged or audited). The page
  verifies it only when **Choose my password** is pressed (a mail scanner's visit cannot use it up), then the agent
  chooses a password (10+ characters) and adds the authenticator.
- **Forgot password:** `…/forgot` emails `…/reset?token_hash=…&type=recovery` to active agents only (same answer for
  any address). With an authenticator already set, its code comes first, then the new password.
- Choosing a password or adding an authenticator needs an **emailed link or code from the last 10 minutes**
  (`hasRecentMailboxProof`); otherwise /setup emails a code first, like Admin.
- **Guard:** `requireSupportAgentPage` (`lib/support/app-auth.ts`) for every page and action; the rules are pure in
  `lib/support/app-access.ts` (`agentAccess`), shared with sc-core's API guard `requireSupportAgent`. An agent must be
  confirmed, not locked, linked to this sign-in (or not linked yet), signed in with a password or an emailed link (not
  Google), at AAL2 with a verified TOTP factor. The first full sign-in links `userId` and sets `status: active`;
  `lastSeenAt` is noted hourly.

### The app

`app/support/(app)/*` (pages), `components/support-app/*` (UI), `lib/support/app-client/*` (typed agent API client,
list rules, real time, and the mock):

- **Chats** (`/`, `?c=<id>` opens a chat), **Live visitors** (`/visitors`), **Stats** (`/stats`, supervisors; others get
  404). Sidebar: the brand gradient in light mode, `#111117` with gradient accents in dark mode. At 390 px the sidebar
  is a top bar, the list and the chat take turns with a back button, and the visitors table becomes cards.
- **Real time:** Supabase Realtime private channels (`staff:inbox`, `staff:visitors`, `agent:<id>`, `conv:<id>`) on the
  agent's own session (`lib/support/app-client/realtime.ts`). Each screen re-asks every 15 s while the socket is not
  live; the visitors feed unsubscribes and stops asking while the tab is hidden. `agent.force_logout` on `agent:<id>`
  sends the app to the sign-in page.
- **Alerts:** a chime (made in the browser) and a notification when a chat appears in Waiting or Mine. Notification
  permission is asked only after a click on **Get alerts on this device**, which also registers web push
  (`POST /agent/devices`) when `VAPID_PUBLIC_KEY` is set. On an iPhone the button says to **Add to Home Screen first**.
- **PWA:** `…/app.webmanifest` (its own name, start page and scope), `public/support-sw.js` registered with the scope
  `/` on the support host and `/support/` elsewhere, so it never controls the client dashboard. No caching.
- **Preview (development only):** `/support/preview`, `/support/preview/visitors`, `/support/preview/stats` show the
  screens with made-up data (`lib/support/app-client/mock.ts`), no sign-in; `notFound()` in production
  (`previewAllowed`).

### Admin → Live chat

`app/admin/(console)/live-chat` (tabs Agents, Departments, Team hours, Greetings, AI rules, Chat leads), permission **`liveChat`**
(owner always; staff through a custom role), menu group **Live chat**.

- `lib/support/agents.ts`: invite, edit, lock / unlock, resend invite, reset authenticator, rename a department. Only
  with `liveChat`; addresses lower-cased and used once; admin, staff and existing BuPulse sign-ins refused. **Lock**
  sets `status: locked`, deletes the agent's `auth.sessions` rows (refresh tokens go with them) and the guard refuses
  them from the next request. **Reset authenticator** deletes their factors and signs them out. Every change is
  audited (`support_agent_*`, `support_department_rename`).
- **Chat leads:** the pre-chat form's leads (ContactRequest `kind: "support_chat"`), newest first, 50 a page, with
  **Open the chat** (the visitor's newest chat, through `SupportVisitor.leadId`). Read by `chatLeads` in
  `lib/support/admin-leads.ts`, which switches to sc-core's `listSupportLeads` from `lib/support/leads.ts` once merged.
- `saveSupportSettings` (`lib/support/settings.ts`): schema plus `supportSettingsProblems` (times, overlaps, greeting
  paths, E.164 WhatsApp), audited as `support_settings_save`, cache cleared.

### Waiting on sc-core

- The agent API (`/api/support/v1/agent/*`) and `requireSupportAgent` (using `agentAccess`).
- `GET /agent/team → { agents: { id, name, availability, departments, openChats, maxChats }[] }` for Transfer (not in
  the contract yet).
- An optional `surface` on `LiveVisitor` (the app reads it from the path until then).
- Broadcasting `agent.force_logout` on `agent:<id>` when an agent is locked, and the web push sends to `SupportDevice`.

### Later (v2)

The desktop app (Tauri, Windows and Mac) around the same web app and API; phone apps (or the PWA with push); the
knowledge-gaps screen; saved replies ("/" shortcuts); sending files from the app.

Tests: `tests/support-app/*`.
