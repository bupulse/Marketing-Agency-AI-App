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
