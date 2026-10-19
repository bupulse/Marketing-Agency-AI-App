# Plan: everything ManyChat has, on BuPulse, keeping BuPulse's advantages

Written 19 October 2026 by the bizdev agent, after the teardown in `docs/bizdev/competitor-manychat.md` and a map of
BuPulse's code. The owner asked that BuPulse have **everything ManyChat has**, while keeping what BuPulse already does
better (making and publishing the posts, MoMo and RWF, Kinyarwanda, demos, custom plans and done-for-you).

## The honest answer first

Most of ManyChat can be built in our own code. **What stops "100%" today is permission from Meta and TikTok, not code:**

| Blocker | What it blocks | How to unblock | Cost |
| --- | --- | --- | --- |
| BuPulse is not a registered business, so Meta will not verify it | Instant alerts for new comments and DMs (Meta webhooks), **comment → private DM**, sending DMs for clients at scale, WhatsApp automation for clients | Register with RDB (online; free per several sources, hours to 2 days), then Meta Business Verification and App Review for `instagram_manage_comments`, `pages_messaging`, `instagram_business_manage_messages` (3 to 6 weeks, `docs/META_APP_REVIEW.md`) | $0 (to confirm on RDB's site) |
| Until then: Composio (our current route to Meta) has **no alerts** for comments or DMs | Fast replies | BuPulse checks for new comments/DMs every few minutes through Composio | Free up to the monthly cap (Composio's shared Meta app: 20,000 calls of the free 100,000), then about $0.0005 a call |
| TikTok | **Comment → DM is impossible for anyone** (TikTok's API does not allow it, per several vendors, Sept 2026); DM auto-replies need TikTok partner access | Apply to TikTok later | — |
| SMS | Texting contacts | A paid SMS provider (for example Africa's Talking) | Paid: needs the owner's OK |
| Meta click-to-DM ads | Creating ads from BuPulse | Meta `ads_management` review, after verification | $0 |

What Composio **can** do today (checked on its docs): read comments, reply to comments in public, list DM
conversations and messages, and send a DM **inside a conversation the person started**. Whether it can send the private
DM to a commenter (ManyChat's top feature) depends on the permissions Composio's Meta app holds: **to test with a real
account** before promising it.

## Feature by feature

Legend: ✅ BuPulse has it · 🟡 partly · ❌ missing · ⛔ blocked by a platform (see above).

| ManyChat feature | BuPulse today | Plan | Phase |
| --- | --- | --- | --- |
| Website chat with AI and lead capture | ✅ (`lib/widget/*`) | Becomes one channel of the new engine | A |
| Contacts (CRM): one record per person, tags, custom fields, segments, CSV import/export, merge duplicates | 🟡 Leads only (status, notes, CSV export) | **Contacts** built on Leads | A |
| Shared inbox: all conversations, a person takes over, assign to teammates, notes | 🟡 website chats are saved, but nobody can answer them live | **Inbox** with human reply in the website chat, assignment, notes | A |
| Automations: triggers (keyword, first message, out of hours, comment keyword) and steps (message, buttons, link, AI reply with a goal, ask phone/email, tag, field, wait, notify team, webhook) | ❌ | **Automation builder** (simple step list first, works on a phone) | A |
| Quick Automations / templates | ❌ | Rwanda templates: "Comment PRICE", "Book a viewing", "Menu and order", "Opening hours", "Giveaway" | A |
| Follow-up sequences (message after 1 day, 3 days…) | ❌ | Sequences + a "due jobs" table run by the every-minute cron | A |
| Broadcasts | ❌ | Email to contacts who agreed (Resend, with unsubscribe) + a WhatsApp-ready text the owner sends from their phone (free) | A |
| Growth tools: links, QR codes, website widgets that start a chat | 🟡 website chat only | Links and QR codes that open WhatsApp (wa.me with a keyword), Instagram DM (ig.me) or the website chat | A |
| Automation analytics: started, finished, link clicks, leads | ❌ | Counters per automation and tracked links | A |
| AI: replies from your info, intent recognition, text improver, "describe it and it builds the automation" | 🟡 AI replies on the website | AI step in automations, text improver, automation assistant (Gemini, same cost ledger) | A |
| Phone preview before going live | ❌ | Preview of each automation as a chat on a phone screen | A |
| "Pick your plan in 30 seconds" quiz | ❌ | Quiz on /pricing that ends on the plan + "Book a demo" | A |
| Instagram & Facebook: reply to comments in public, AI comment replies with approval | ❌ | Through Composio now (checked every few minutes), instant after verification | B |
| Instagram & Facebook: comment → private DM ("comment PRICE") | ❌ | ⛔ after verification (or through Composio if the test passes) | B |
| Instagram & Facebook: DM auto-replies, keywords, ice breakers, Story mention replies | ❌ | Replies inside conversations through Composio now; full after verification | B |
| WhatsApp automation for the client's own number | ❌ (only BuPulse's lead alert to the owner, switched off) | ⛔ after verification (Meta "Tech Provider" + Embedded Signup); Meta's message fees paid by the client from a MoMo-loaded wallet | C |
| Telegram | ❌ | Free and open (Bot API), no verification. Little used in Rwanda (guess), so low priority | D |
| TikTok automation | ❌ | ⛔ comment → DM impossible; DM replies need TikTok access | Later |
| SMS | ❌ | Paid provider, owner's OK needed | D |
| Email designer | 🟡 transactional emails only | Simple broadcast email editor (part of broadcasts) | A |
| Meta click-to-DM ads | ❌ | ⛔ after verification + ads review | D |
| Agency workspaces: one login, many client companies, copy an automation to another client | ❌ (one user = one company today) | Multi-company login + "copy to another company" | D |
| Integrations (Sheets, HubSpot, Mailchimp, Zapier, Make, API, webhooks) | ✅ API, webhooks, own Composio (Pro) | Add new events (contact created, tag added, automation finished) to webhooks and the API | A |
| Affiliate / partner programme | 🟡 staff referral links only | Outside partners with a code, commission tiers, paid by MoMo, partner page | D |
| Soft limits (never stop the client mid-month; forgive extra if they upgrade) | 🟡 the website chat falls back to collecting details | Warnings at 80% and 100%, and an add-on to buy more | A |
| Free plan forever, instant sign-up with Instagram | ❌ (demo first, by owner decision) | **Not copied**: demo-first stays an advantage in Rwanda. Optional later: a "see your first post" preview before the demo | — |

## What we keep that ManyChat does not have

Content making and publishing (texts, designs, AI photos, video, voice, Autopilot), MoMo/Airtel in RWF, Kinyarwanda,
demos, custom plans and Managed by BuPulse. The new engine plugs into them: for example, Autopilot can add "comment
PRICE for the price" to a post **and** switch on the matching automation, which ManyChat cannot do because it does not
make the post.

## How it is built (reuse first)

- **Reply engine** taken out of `lib/widget/chat.ts` so any channel uses it: knowledge facts, Gemini through the ledger
  and budget, usage (`limits.chat`), rate limits, lead capture.
- **Channels** behind one interface: website chat (now), Instagram/Facebook through Composio (`runTool`, polled by a
  new cron) or later Meta webhooks (signature check reuses `verifyMetaRequest`), WhatsApp, Telegram.
- **New tables** (one migration after `20261021100000_connection_method_composio`): Contact, ContactTag, ContactField,
  Conversation, Message, Automation, AutomationStep, AutomationRun, DueJob, Broadcast, TrackedLink. Leads stay and link
  to Contact.
- **Features** `automations`, `inbox`, `broadcasts` in `lib/features.ts`, gated like the others; a usage metric for
  automated messages.
- Tests in `tests/automations/`, `tests/inbox/`, `tests/contacts/`.

## Order and size (guesses)

| Phase | Contents | Size |
| --- | --- | --- |
| A | Contacts, Inbox, Automations with templates, sequences, broadcasts (email + WhatsApp-ready), links/QR, analytics, AI helpers, preview, plan quiz | Largest part: several weeks of work, done in slices that each work alone |
| B | Instagram/Facebook comments and DMs | 1 to 2 weeks on Composio; then switch to webhooks after verification |
| C | WhatsApp for clients | 2 weeks after verification |
| D | Agency workspaces, partner programme, Telegram, SMS, ads | Each about 1 week |

## Risks

- Other sessions are changing the same app (main session and video engine). This work stays on the `bizdev` branch
  and touches the website chat code, so merging needs care.
- Meta rules: one private reply per comment, within 7 days; DMs only within 24 hours of the person's last message;
  messaging apps must offer a way to reach a human (our Inbox covers this).
- Polling through Composio costs calls: it must have a monthly cap set in Admin, and switch off at the cap.
