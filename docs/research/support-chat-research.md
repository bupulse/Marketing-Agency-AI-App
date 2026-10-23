# Support chat: market and technical research

Written 23 October 2026 for the spec in `docs/SUPPORT_CHAT.md` (branch `support-chat`). It covers what the AI-first support tools do better than tawk.to, the UX practices worth copying, what our free stack (Netlify free, Supabase free, Gemini free tier) can carry, what Rwanda's data protection law asks of us, and a build plan. The tawk.to teardown itself is separate (`docs/research/tawk-teardown.md`), and the client website-chat product (`docs/WIDGET.md`, `docs/INBOX.md`) is not studied again here.

**How it was done:** public web pages only (vendor pricing pages, help centres and docs, the Chatwoot source on GitHub, law-firm summaries of the Rwandan law). No sign-ups. Every number has a source link next to it. When only a third-party blog had a number, it says so. Sums marked **(our maths)** are mine, worked from the cited numbers. The law section is a summary of secondary sources, **not legal advice**.

---

## 0. The findings that matter most

1. **Resolution-priced AI is the market norm, so ours costs almost nothing to run.** Intercom Fin charges $0.99 per outcome ([intercom.com/pricing](https://www.intercom.com/pricing)). Gorgias charges $0.90–1.00 per automated interaction ([gorgias.com/pricing](https://www.gorgias.com/pricing)). Freshchat Freddy is $49 per 100 sessions ([freshworks.com](https://www.freshworks.com/live-chat-software/pricing/)). Tidio Lyro starts at $32.50/month for 50 conversations ([tidio.com/pricing](https://www.tidio.com/pricing/)). Gemini Flash-Lite on the free tier costs $0 for each of those.
2. **The real gap in tawk.to is AI behind the agent, not only in front of the visitor.** Every leader now ships agent assist: suggested answers with cited sources, tone rewrites and translation (Intercom Copilot); summaries (Freshchat Freddy Copilot); a weekly "content gaps" report built from failed AI answers (Intercom Recommendations). The spec's section 4 already lines up with this.
3. **Every serious AI agent hands over on three triggers:** low confidence, frustration, and topics that are always handed over (Gorgias, Crisp Hugo, Fin). We should copy all three, plus "the person asked for a human".
4. **Count AI resolutions the way Zendesk does:** only conversations that were not escalated, judged by an LLM after a quiet window (2 hours by default for messaging) ([Zendesk](https://support.zendesk.com/hc/en-us/articles/5352026794010)).
5. **Supabase Realtime free = 200 concurrent connections, 2 million messages a month, 100 messages a second** ([limits](https://supabase.com/docs/guides/realtime/limits), [pricing](https://supabase.com/pricing)). That is plenty for staff, but **not** if every visitor on every page holds a WebSocket. Visitors should only connect while the chat panel is open.
6. **Polling and SSE through Netlify functions are the expensive path on the free plan.** The Free plan has a hard cap of 300 credits a month. Requests cost 2 credits per 10,000, compute 10 credits per GB-hour, and each production deploy 15 credits ([Netlify credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)). Streaming functions stop after 60 seconds ([Functions API](https://docs.netlify.com/build/functions/api/)). Heartbeats and polling should go straight to Supabase, not through Netlify.
7. **Presence notifies every subscriber on every change** ([Presence](https://supabase.com/docs/guides/realtime/presence)). Visitors should never join a shared presence channel. Build the live-visitors list from heartbeat rows, and push changes only to staff.
8. **IP location is already solved in our code.** `lib/platform/headers.ts` reads Netlify's `x-nf-geo`. On Netlify, Context gives city, country, subdivision, lat/long, timezone and postal code, plus the IP ([Functions API](https://docs.netlify.com/build/functions/api/)). No GeoIP database is needed. If we ever do need one, GeoLite2 needs an account and has a strict EULA, and DB-IP Lite is CC BY 4.0 with a link-back.
9. **Do not put the whole owner guide in every prompt.** The guide is 39 files of about 53,900 words (`docs/guide/features/*`, counted 23 Oct). That is roughly 70k tokens **(our estimate)** on every turn. Use retrieval: Postgres full-text search over guide sections first, and pgvector later only if needed.
10. **Kinyarwanda quality is the one big unknown.** One industry study gave Gemini 2.5 Pro 4.56/5 on Kinyarwanda, where in late 2024 no model was coherent ([RWS TrainAI 2.0](https://info.rws.com/hubfs/2026/trainai/llm-data-gen-study-2.0-campaign/trainai-multilingual-llm-synthetic-data-gen-study-2.0.pdf), via [HN](https://hn.svelte.dev/item/47847282)). No Flash-Lite figure exists. We need our own 30-sentence check with a native speaker before we switch on live translation.
11. **Rwanda's law wants data stored in Rwanda (Art. 50), unless the NCSA registration certificate authorises storage abroad.** Our database is in us-east-1, so registration with the NCSA (Arts. 29–31) has to cover the transfer. Gemini's free tier also says data is "used to improve our products", which counts as a further transfer and has to be in the privacy notice ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)).
12. **Supabase Storage free is 1 GB** ([pricing](https://supabase.com/pricing)), so 10 MB uploads fill it fast. Shrink images in the browser, cap PDFs, and expire attachments.

---

## 1. AI-first competitors

### 1.1 Summary table

| Product | How the AI answers | Agent assist | Visitor tracking | AI price (public) |
|---|---|---|---|---|
| **Intercom Fin** | RAG over Help Center, PDFs, webpages and internal content. "Guidance" holds policies and tone. Data connectors and user attributes for signed-in users. 45+ languages, and it can answer in a language the content was never written in ([Fin explained](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)) | Copilot: answers with cited sources, "Translate to…", "More friendly / More formal / Rephrase" ([Copilot](https://www.intercom.com/help/en/articles/8587194-copilot-explained)) | Not studied (seat product) | $0.99 per outcome. Copilot $29–35 per agent a month. Seats from $19/$29 ([pricing](https://www.intercom.com/pricing)) |
| **Crisp (Hugo AI agent)** | AI agent with escalation settings: it escalates "if Hugo cannot answer confidently, detects frustration, or needs a human" ([Crisp help](https://help.crisp.chat/en/article/how-to-create-an-ai-chatbot-with-magicreply-1i1jeof)) | Pricing page lists AI translation, conversation summaries and knowledge training without saying which plan has them ([pricing](https://crisp.chat/en/pricing/)) | "Live Geolocation" map of active visitors, with a way to start a chat ([pricing](https://crisp.chat/en/pricing/)) | Per workspace: Free $0 (no AI). Mini $45 with $5 of AI credits, "about 90 automated conversations". Essentials $95 with $25. Plus $295 with $75 ([pricing](https://crisp.chat/en/pricing/)). I found no public details on MagicReply. |
| **Tidio Lyro** | Learns from FAQ uploads, FAQ and website scrapers, and Zendesk article imports. Hands over to a human, or makes a ticket when nobody is online ([pricing](https://www.tidio.com/pricing/), [llm-info](https://www.tidio.com/llm-info/)) | Not detailed | Live visitors list from Starter. Viewed-pages history and visitor notes from Growth ([pricing](https://www.tidio.com/pricing/)) | From $32.50 a month for 50 Lyro conversations. A Lyro conversation is any conversation with at least one AI reply. Claims a "75% resolution rate" ([pricing](https://www.tidio.com/pricing/)) |
| **Zendesk AI agents** | Use cases plus generative replies. A resolution is checked by an LLM and counted only when the chat was not escalated ([Zendesk](https://support.zendesk.com/hc/en-us/articles/5352026794010)) | Copilot add-on, reported at $50 per agent a month (third party, [coworker.ai](https://coworker.ai/blog/zendesk-ai-pricing)) | Not studied | Rate not published. Third parties say about $1.50–2.00 per automated resolution ([eesel](https://eesel.ai/blog/zendesk-ai-pricing/)). Includes 5–15 per agent a month by plan ([Zendesk](https://support.zendesk.com/hc/en-us/articles/5352026794010)) |
| **LiveChat / Text** | Autonomous answers come from a separate product, ChatBot. Agent assist ("Text Copilot", reply suggestions) comes with paid plans (third party, [myaskai](https://myaskai.com/blog/livechat-ai-complete-guide-2026)) | Reply suggestions, Copilot | Known for its visitor list (not re-studied) | Seats $19–79 per agent. ChatBot from $52 a month (third party, same source). No per-resolution price found |
| **Chatwoot (open source)** | "Captain": assistants with `response_guidelines` and `guardrails`, documents, FAQ answers with 1536-dimension embeddings, scenarios and custom HTTP tools ([schema.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/db/schema.rb)) | Copilot suggestions in the editor. FAQ suggestions mined from conversations (third party, [eesel](https://www.eesel.ai/blog/chatwoot-pricing)) | Contact `last_activity_at`, location fields | Cloud tiers with Captain credits (third-party figures conflict). Captain is not in the free Community Edition (same source) |
| **Freshchat Freddy** | Freddy AI Agent. A session is one end-user interaction, and repeat chat within 24 hours counts as one ([pricing](https://www.freshworks.com/live-chat-software/pricing/)) | Freddy Copilot $29 per agent a month: "summarize issues", suggest next steps, "improve the tone". Translation is a separate Pro feature (same source) | Not studied | First 500 sessions free, then $49 per 100 sessions (same source) |
| **Gorgias AI Agent** | Learns from Shopify order data, the website, Help Center, URLs, documents and "Guidance". Hands over "when it lacks confidence… or detects an angry customer". Admins write "handover topics" in plain language. 80+ languages ([AI Agent explained](https://docs.gorgias.com/en-US/ai-agent-explained-497772), [customise](https://docs.gorgias.com/en-US/customize-how-ai-agent-behaves-567324)) | Per-ticket "reasoning" shows why the AI answered as it did | Not studied | $0.90 (annual) or $1.00 (monthly) per automated interaction, $1.50 over the allowance. If a human replies within 72 hours of an AI resolution, it is billed only as a ticket ([pricing](https://www.gorgias.com/pricing)) |

### 1.2 What each does better than tawk.to (the ideas worth taking)

**Intercom Fin**
- *One place for knowledge, with labelled sources.* Fin answers "using only the most relevant information from multiple knowledge sources" and lets you inspect which sources shaped an answer ([Fin explained](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)). For us: store the guide sections each AI reply used on the message (`aiSources`), and show them to the agent.
- *Guidance kept apart from knowledge.* Policies and tone live in a separate instruction layer. For us: a short admin-editable "AI rules" text in Admin → Live chat, kept separate from the guide.
- *Safety handover is automatic.* "Fin will always automatically hand off when that is the safest option", including for self-harm, jailbreaks, and high-risk medical, legal or financial advice ([same](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)).
- *Content gaps every week.* Recommendations are built from failed Fin answers compared with human replies to similar questions. They are generated weekly, and they also flag duplicate or contradictory content ([Recommendations](https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin)). Unresolved questions are grouped automatically into named topics over the last 30 days ([unresolved questions](https://fin.ai/help/en/articles/13975776-analyze-unresolved-questions)). This is the model for the spec's "knowledge gaps report".
- *Copilot's composer actions:* "Translate to…", "My tone of voice", "More friendly", "More formal", "Rephrase", with sources under each answer ([Copilot](https://www.intercom.com/help/en/articles/8587194-copilot-explained)).

**Crisp**
- *Priced per workspace, not per seat* ([pricing](https://crisp.chat/en/pricing/)). It is the closest to tawk.to's free model and shows that a live visitor map is a selling point.
- *Hugo's escalation triggers are spelled out:* not confident, frustration, needs a human ([help](https://help.crisp.chat/en/article/how-to-create-an-ai-chatbot-with-magicreply-1i1jeof)).

**Tidio**
- *Ticket fallback.* When no one is online, Lyro opens a ticket instead of leaving the visitor waiting ([llm-info](https://www.tidio.com/llm-info/)). This matches our "outside hours → ticket + email/WhatsApp".
- *Visitor list is a paid upsell, and page history even more so* ([pricing](https://www.tidio.com/pricing/)). Ours is free and internal, which shows how much value the spec's visitor list carries.

**Zendesk**
- *An honest resolution metric* (see section 2.6).

**Gorgias**
- *Handover topics in plain language* (for example "billing", "privacy"), kept apart from tone settings ([customise](https://docs.gorgias.com/en-US/customize-how-ai-agent-behaves-567324)).
- *A warning about sales:* review handover topics that could block sales chats, such as product recommendations and sizing ([sales prep](https://docs.gorgias.com/en-US/best-practices-prepare-ai-agent-for-sales-conversations-1123832)). For us: on public pages the AI should **keep** pricing and plan questions and only add a lead tag, never hand them over by default.
- *Per-ticket reasoning* so staff can see why the AI said something ([AI Agent explained](https://docs.gorgias.com/en-US/ai-agent-explained-497772)).

**Freshchat**
- *Session = 24 hours* ([pricing](https://www.freshworks.com/live-chat-software/pricing/)). This is a sensible unit for our own AI usage and cost ledger.

**Chatwoot as a reference design.** It is a Rails app. Real time goes over ActionCable at `/cable`, and background jobs (notifications, webhooks, automations, outgoing messages) run in workers ([client API docs](https://www.chatwoot.com/docs/product/channels/api/client-apis), [overview](https://www.bluehost.com/help/article/what-is-chatwoot)). Things worth copying from its source:
- **Tenancy and channels:** `accounts` → `inboxes` (`channel_type`, `timezone`, `working_hours_enabled`, `greeting_message`, `csat_survey_enabled`, `enable_auto_assignment`) → `channel_web_widgets` (`website_token`, `hmac_token`, `pre_chat_form_options`, `allowed_domains`, `reply_time`) ([schema.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/db/schema.rb)).
- **Contacts:** `contacts` plus `contact_inboxes` (`source_id` = the session id, `pubsub_token` = the visitor's private real-time token, `hmac_verified` for signed-in users).
- **Conversations:** `status` open/resolved/pending/snoozed and `priority` low → urgent ([conversation.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/models/conversation.rb)). Also `assignee_id`, `assignee_agent_bot_id`, `team_id`, `display_id` (a per-account number for humans), `snoozed_until`, `first_reply_created_at` and `waiting_since`. `waiting_since` is set on create, cleared on resolve, and set again on bot handoff. `bot_handoff!` clears the AI assignee and reopens the chat.
- **Messages:** `message_type` incoming/outgoing/activity/template, `content_type` (text, input_email, input_csat, cards, form…), `private` (internal note), `status` sent/delivered/read/failed, `sender_type/sender_id` ([message.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/models/message.rb)). Every create or update dispatches an event (`MESSAGE_CREATED`, `FIRST_REPLY_CREATED`) that listeners turn into broadcasts, notifications and reporting.
- **Agents:** `account_users.role` and `availability` (online/busy/offline) with `auto_offline`. `teams`/`team_members` and `inbox_members` for routing.
- **Reporting:** `reporting_events` (name, value, `value_in_business_hours`, event start and end) and daily `reporting_events_rollups`. Business-hours-aware metrics are a good idea for our team hours.
- **AI:** `captain_assistants` (guidelines, guardrails), `captain_documents`, `captain_faq_suggestions` with `captain_faq_observations` (FAQ candidates mined from conversations), `conversation_outcomes` (`captain_reply_count`, `handoff_at`, `handoff_reason_category`, `resolved_at`, `csat_rating`), and `captain_message_reports` (an agent flags a bad AI message). `conversation_outcomes` is the cleanest model for measuring AI resolution I found.
- **Real time:** `RoomChannel` subscribes with the `pubsub_token`. A visitor gets only their own stream. An agent also gets `account_<id>`. Online status is broadcast as `presence.update` ([room_channel.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/channels/room_channel.rb)). Translated to Supabase: one private topic per visitor conversation, one staff topic, and presence for agents only.

### 1.3 The best ideas, as a list for BuPulse

1. Each AI reply stores the guide sections it used. The agent sees "Answered from: 12 Billing → Mobile Money".
2. An admin-editable "AI rules" text (tone and policies), kept separate from the guide.
3. Handover on: an explicit request, low confidence (the model returns `confident: false` or no source), frustration (urgency tag `upset`), always-handover topics (refunds, account deletion, legal, payment disputes), and a safety list.
4. Sales topics stay with the AI on public pages, and they tag the lead instead of handing over.
5. A warm handover: the agent gets a 2-line summary, the reason it was escalated, what the AI already tried, and the account facts.
6. A `conversation_outcomes`-style row per chat: AI reply count, handover time and reason, resolved by whom, rating.
7. Resolution judged after a 2-hour quiet window by a cheap LLM pass, counted only for chats with no handover.
8. A weekly knowledge-gap report: cluster unresolved questions, compare them with the human replies, and draft a guide addition. Also flag contradictions between guide pages.
9. Composer actions: suggest 3 replies, translate, friendlier, more formal, shorter.
10. Agents can flag a bad AI message ("report"), which feeds the gaps report.
11. Business-hours-aware first-reply and wait-time stats.
12. A ticket is created automatically when no agent is online, and the visitor is told the reply will come by email or WhatsApp.
13. A per-workspace, no-seat model for future resale. Crisp and tawk.to show this sells.

---

## 2. Best practices

### 2.1 Proactive greeting that does not annoy

The evidence here is thin, and mostly vendor advice:
- **Timing.** One dataset (a patent filing, not peer-reviewed) found that acceptance was about 17% when the invitation came at 20 s, about 10% at 60 s and above 25% at about 120 s. It suggests going early (~20 s) or late (~120 s), not at 60 s ([USPTO 8565411](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8565411)). A vendor suggests 30–45 s on pricing pages, 60–90 s or no trigger on the homepage, and not "after 3 seconds" ([Velaro](https://v20.velaro.com/blog/proactive-chat-timing)).
- **Frequency.** Don't show the same invitation on every visit, and suppress it after a decline or a finished chat ([ProvideSupport](https://www.providesupport.com/articles/how-to-initiate-chats-that-actually-convert)). Tools offer per page load, per visit, or fixed-interval caps (same source).
- **Mobile.** Keep the text short, because long text grows the bubble over the content (same source).

**For our spec:** 15 s (30 s on pricing and sign-up) is in a reasonable range. I'd suggest three additions. (a) **Skip the bubble on the first page of a visit that came from an ad or a link-in-bio**, because those visitors are still deciding whether to stay. (b) **Never show it if the visitor has already chatted in the last 7 days** (localStorage). (c) **On phones, show only a dot or badge on the button, never a text bubble over content**, which matches "never covers content". Measure greeting shown → opened → first message per page, and tune from those numbers.

### 2.2 Pre-chat forms

- The only figures I found are old and secondhand: "55% of visitors abandon a chat when presented a pre-chat form" (no field count, date unclear) ([Alexander Jarvis](https://www.alexanderjarvis.com/what-is-live-chat-abandonment-rate-in-ecommerce/)). One practitioner calls the name and email gate "a layer of friction at the start of the chat" ([Convince & Convert](https://www.convinceandconvert.com/customer-experience/right-tone-with-live-chat/)). Removing one field from a (non-chat) form lifted conversion from 5.50% to 9.95% in one case ([Zuko](https://zuko.io/form-optimization-case-studies/beyond-clicks-property)).
- No controlled study on the number of fields was found.

**For our spec** (name, email and business required, WhatsApp optional): this is three required fields before any help. Here's a middle path that keeps the owner's lead goal. **Let the visitor type the question first**, so the form appears under their message as "So we can reply if you leave: name, email, business". The AI answers straight away after the form is sent. Chatwoot's `pre_chat_form_options` and our own website chat's contact card (`docs/WIDGET.md`) work this way. **Owner decision needed;** this is a test I'd A/B on test.bupulse.com, not a change to make silently.

### 2.3 AI → human handover

Vendor guides agree on these points, though most are vendor blogs:
- **Don't make people repeat themselves.** Pass on the transcript, an AI summary, what the bot tried, the account details, the reason for escalating and a suggested next step ([eesel](https://eesel.ai/blog/ai-agent-handoff-best-practices), [Alhena](https://alhena.ai/blog/ai-human-escalation-chatbot-handoff-best-practices/)). A survey quoted there says 74% find it frustrating to retell their story ([murf.ai](https://murf.ai/blog/ai-to-human-handoff)).
- **Four triggers:** an explicit request, negative sentiment, low confidence or a gap in the knowledge base, and restricted topics ([hyperleap](https://hyperleap.ai/blog/chatbot-human-handoff-best-practices)).
- **Offer a channel choice** when no one is free: "chat now / email me / book time" ([Cresta](https://cresta.com/guides/ai-to-human-agent-handoff-best-practices)). For us that is "wait here / reply by email / reply on WhatsApp".
- **A slow handover is worse than none.** Tell the visitor the honest wait time, and say whether the team is open.
- **Tag handover reasons** so routing and content get better over time.

### 2.4 Response-time expectations

- Comm100's 2025 benchmark (220M+ interactions) puts the cross-industry median first response near **1 min 35 s**. This is via secondary sources, and I couldn't fetch the primary report ([Velaro benchmarks](https://v20.velaro.com/blog/live-chat-benchmarks-2026)).
- LiveChat's stats, also quoted secondhand, say CSAT peaks at **84.7% when the first reply comes within 5–10 s** and falls by about 7 points for each extra minute. The same page says 57% abandon after a 3-minute wait. Treat both as directional (same source).

**For us:** the AI answers in seconds. The number that matters is **time from handover to the first human reply**. During team hours, target under 2 minutes. That matches the spec's 2-minute email alert.

### 2.5 CSAT patterns

- Ask once, at the end, inside the chat (Chatwoot keeps it as a message `content_type: input_csat` with `csat_survey_responses.rating` and `feedback_message` ([schema](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/db/schema.rb))).
- **Separate the AI-only score from the human score.** Fin's dashboard reports resolution rate, involvement rate and a CX score for every conversation ([Fin explained](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)).
- Use 2 options (👍/👎) or 5 stars, with one optional comment box, and send the transcript email after the rating, not before.

### 2.6 Measuring AI resolution rate

Here is how the vendors define it:
- **Intercom:** an outcome is counted when the customer confirms it is resolved, or doesn't ask for more help after Fin's reply, or Fin completes a workflow ([pricing](https://www.intercom.com/pricing)).
- **Zendesk:** only conversations that were **not escalated** are evaluated. An LLM checks the text to confirm the request was resolved without a human. Messaging chats are judged 2 hours after the first message by default, and this can be extended to 72 hours ([Zendesk](https://support.zendesk.com/hc/en-us/articles/5352026794010)).
- **Gorgias:** "fully resolved without a human agent". If a human replies within 72 hours, it no longer counts ([pricing](https://www.gorgias.com/pricing)).

**For us:** `aiResolved = no handover AND no agent message AND (rating ≥ 4 OR the visitor said thanks / closed OR no new visitor message for 2 h) AND a cheap Flash-Lite check says "resolved"`. If the same visitor comes back within 72 h on the same topic, the AI resolution is cancelled. Report three numbers: **involvement** (the share of chats where the AI replied), **AI resolution rate** (of involved chats) and **handover rate**, each split by surface (public, dashboard, creator, bio).

### 2.7 Knowledge-gap loop

1. Every chat with a handover, an AI reply with `confident: false`, a 👎 or an agent's "report" becomes a gap candidate.
2. Once a week (a `DueJob`), embed or cluster the candidate questions (or a simple Flash-Lite clustering pass over ≤ 200 questions). Name each cluster, count it, and attach 3 sample chats with the human agent's reply.
3. Draft a "suggested guide addition" from the agent replies, with the target guide file (`docs/guide/features/NN-*.md`).
4. Flag guide sections that contradict each other (Intercom does this ([Recommendations](https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin))).
5. The owner accepts it, the guide is edited, the search index rebuilds, and the gap is marked "fixed". The report then shows whether it recurred.

---

## 3. Technical choices for our stack

### 3.1 Supabase Realtime: the free-tier numbers

| Limit | Free | Pro | Source |
|---|---|---|---|
| Concurrent connections | 200 | 500 | [limits](https://supabase.com/docs/guides/realtime/limits) |
| Messages per second | 100 | 500 | same |
| Channel joins per second | 100 | 500 | same |
| Channels per connection | 100 | 100 | same |
| Presence keys per object | 10 | 10 | same |
| Presence messages per second | 20 | 50 | same |
| Presence calls per client per 30 s | 5 | 5 | same |
| Broadcast payload | 256 KB | 3,000 KB | same |
| Postgres Changes payload | 1,024 KB | 1,024 KB | same |
| Broadcast replay | 72 h retention, 25 messages per request | same | same |
| Messages per month | 2 million | 5 million, then $2.50 per million | [pricing](https://supabase.com/pricing) |
| Peak connections billed | 200, no overage on Free | 500, then $10 per 1,000 | [pricing](https://supabase.com/pricing) |

- Going over the per-second limit disconnects clients until throughput drops (`tenant_events`). Going over the monthly quota on Free puts the project in a "grace period" under the Fair Use Policy ([messages](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages), [peak](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections)).
- **How messages are counted:** "Each broadcast message counts as one message sent plus one message per subscribed client that receives it". For Postgres Changes, "one message per client that listens to the event" ([messages](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)).

**Broadcast vs Presence vs Postgres Changes**
- **Postgres Changes** run on a single thread and check every event against every subscriber. "If you expect more than ~3,000 concurrent subscribers… use Broadcast". RLS is not applied to DELETE ([postgres-changes](https://supabase.com/docs/guides/realtime/postgres-changes)). These are fine for a handful of staff, but Broadcast is the better default.
- **Broadcast** can be sent from the database (`realtime.send()`, or `realtime.broadcast_changes()` in a trigger), from REST without a socket, or with `channel.httpSend()` in supabase-js ≥ 2.107 (we have 2.117). Private channels support **replay** of database broadcasts for 72–96 h, which helps a reconnecting client catch up ([broadcast](https://supabase.com/docs/guides/realtime/broadcast)). One catch: daily partitions are created by WebSocket connections, so "`realtime.send` does not" create them (same page).
- **Presence** is for state that changes slowly. It "notifies **all** subscribers on every change", and you shouldn't call `track()` often ([presence](https://supabase.com/docs/guides/realtime/presence)). **Use it for agent online/away status only.**

**RLS for real time.** Private channels are authorised by RLS policies on `realtime.messages`, using `realtime.topic()` and the `extension` column (`broadcast`/`presence`). Policies are cached for the life of the connection, so a locked-out agent keeps receiving until the JWT expires. The docs therefore recommend short JWT expiry ([authorization](https://supabase.com/docs/guides/realtime/authorization)). For agents we can require MFA in the same policy, using a restrictive check on `auth.jwt()->>'aal' = 'aal2'` ([MFA](https://supabase.com/docs/guides/auth/auth-mfa)). The spec's "locked out instantly" then means: disable the agent row, revoke the session, and broadcast a `force_logout` to `agent:<id>`, since the socket can outlive the policy check.

**Auth for anonymous visitors, three options:**
1. *Supabase anonymous sign-in.* Gives the `authenticated` role with an `is_anonymous` claim. It's limited to **30 sign-ins per hour per IP** by default, recommends Turnstile, keeps rows in `auth.users` with no automatic cleanup ([anonymous](https://supabase.com/docs/guides/auth/auth-anonymous)), and probably counts toward MAU (not confirmed in the docs; Free is 50,000 MAU). Rwandan mobile users often share carrier IPs, so the per-IP cap is a real risk.
2. *Server-minted JWT* for the visitor. Third-party auth needs asymmetric keys, and signing with the project secret is the "work-around" Supabase is moving away from ([third-party overview](https://supabase.com/docs/guides/auth/third-party/overview)). I don't recommend it.
3. **(Recommended for the MVP)** Visitors never get a Supabase session. When they open the chat they get a **random 128-bit topic** `sv:<token>`, and subscribe to it as a *public* broadcast channel only while the panel is open. The server sends just a ping with no content (`{type:"msg", id}`), and the widget then fetches the message from our API with its session secret. Anyone who guessed the topic would learn only that "something happened". Staff use private channels with RLS. Private and public channels can live side by side as long as "Allow public access" stays on ([authorization](https://supabase.com/docs/guides/realtime/authorization)).

**Budget (our maths).** Say 1,000 chats a month, 20 messages each, a visitor plus 2 staff listening: 20,000 × (1 + 3) = 80k messages. Typing pings, throttled to one per 3 s and about 30 per chat: about 120k. The staff visitors feed for 3 staff, at about 30k visits × 4 updates: about 480k. That's roughly **0.7M of the 2M** a month. Connections: about 10 staff tabs plus the visitors with the chat open. That fits 200 easily, **as long as browsing visitors don't connect**.

### 3.2 Netlify: polling and SSE costs

- **Free plan:** 300 credits a month as a hard limit, reset monthly, with no auto recharge. Web requests 2 credits per 10k, compute 10 credits per GB-hour, bandwidth 20 credits per GB, each production deploy 15 credits ([credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)). (Check which plan the BuPulse account is really on. Legacy free plans are metered differently.)
- Synchronous functions time out at 60 s, background functions at 15 min, and scheduled ones at 30 s. Default memory is 1024 MB ([configuration](https://docs.netlify.com/build/functions/configuration/)). Streaming responses have "a 60-second execution limit and a 20 MB response size limit" ([API](https://docs.netlify.com/build/functions/api/)).

**Our maths:**
- One 200 ms function call at 1 GB is 0.2 GB-s. 10k calls are about 0.56 GB-h, or **≈ 5.6 compute credits plus 2 request credits ≈ 7.6 credits per 10k calls**.
- So 300 credits ≈ 400k short calls a month **if nothing else is spent**. Ten production deploys alone take 150.
- **SSE on Netlify is out.** One open SSE stream costs about 1 GB × 60 s every minute ≈ 0.17 credits a minute, so 100 visitors × 10 minutes ≈ 170 credits.
- **Polling at 5 s through Netlify** costs 120 calls per 10-minute chat. 1,000 chats ≈ 120k calls ≈ 90 credits. That is affordable only as a *fallback* while the panel is open and the socket is down. It can never be the main path, and never for browsing visitors.
- **So heartbeats go straight to Supabase.** The visitor's page sends a heartbeat every 30–60 s, only while the tab is visible, to a Postgres `security definer` RPC (`support_heartbeat(visit_token, path, title)`) through PostgREST with the anon key. That costs Supabase egress (5 GB free) instead of Netlify credits. The RPC rate-limits by visit token, using the `RateLimit` idea in SQL.
- **The AI reply path stays on Netlify,** in the same route handler pattern as the widget chat. A Gemini call of about 3 s ≈ 3 GB-s ≈ 0.008 credits. 3,000 replies ≈ 25 credits.
- **Host support.bupulse.com on the same Netlify site** (a domain alias, with host-based routing in the Next.js proxy). A second site would double the deploy credits.

### 3.3 Paid-later or alternative real-time services

| Service | Free tier | Source |
|---|---|---|
| Ably | 6M messages a month, 200 concurrent connections, 200 channels, 500 messages a second, no card | [Ably free](https://ably.com/docs/platform/pricing/free) |
| Pusher Channels Sandbox | 200k messages a day, 100 concurrent connections | [Pusher pricing](https://www.pusher.com/channels/pricing) |

Neither beats Supabase on connections, and both add a vendor. Keep a thin `RealtimeTransport` interface (`publish(topic, event)`, `subscribe`) so we can switch later. Ably has 3× the monthly messages if Supabase's 2M ever becomes the limit.

### 3.4 Live visitors list ("who's online") at scale

- Store **rows, not presence**: a `SupportVisit` row is updated by the heartbeat RPC (`lastSeenAt`, `currentPath`, `pageCount`). "Online" means `lastSeenAt > now() − 90 s`.
- Staff push: an `AFTER UPDATE` trigger calls `realtime.broadcast_changes()` on the private topic `staff:visitors`, **only when the path changes or a visit starts or ends**, never on a heartbeat that changes nothing. Messages = changes × staff tabs, not visitors².
- The staff app's first load is a single query (`where lastSeenAt > now()-90s order by lastSeenAt desc limit 500`), then patches from broadcasts. If the socket is down, re-query every 15 s.
- Agents' own status (online, away) uses Presence on `staff:presence`, at well under 20 presence messages a second.
- Clean up with a daily `DueJob`: close visits idle > 30 min, drop page hits > 30 days, and cut IPs down to the country (spec section 7).

### 3.5 IP geolocation (free options)

- **Netlify (what we run on):** `context.geo` has `city`, `country{code,name}`, `subdivision{code,name}`, `latitude`, `longitude`, `timezone`, `postalCode`, and `context.ip` has the client IP ([Functions API](https://docs.netlify.com/build/functions/api/)). In Next.js route handlers on Netlify we already read the `x-nf-geo` header (base64 JSON) in `lib/platform/headers.ts`, and the IP from `x-nf-client-connection-ip`. Netlify forum staff say the data comes from MaxMind ([forum](https://answers.netlify.com/t/geolocation-context/71149/12)). The `x-nf-geo` header itself has no official documentation page that I could find, so it stays covered by our tests. **Catch:** heartbeats that go straight to Supabase skip Netlify, so geo has to be captured once, at visit start, by a Netlify route (`POST /api/support/v1/visit`), and stored on the visit.
- **Cloudflare (if ever in front):** `CF-IPCountry` on every plan, and the "Add visitor location headers" managed transform adds city, continent, latitude and longitude ([Cloudflare](https://developers.cloudflare.com/network/ip-geolocation/)). Our code already ignores cf-* headers on Netlify, so they can't be spoofed.
- **Databases (not needed now):** MaxMind GeoLite2 needs a free account and licence key, is updated twice a week, and its EULA says old versions must be destroyed within 30 days of an update. It also forbids using the data "for the purpose of identifying or locating a specific household", and needs attribution ([EULA](https://www.maxmind.com/en/geolite2/eula), [GeoLite2](https://www.maxmind.com/en/asnum)). DB-IP City Lite is **CC BY 4.0**, updated monthly, and needs a link "IP Geolocation by DB-IP" on pages that show its results ([DB-IP](https://www.db-ip.com/db/download/ip-to-city-lite)). Either way, city-level accuracy in Rwanda is not verified, so show the city as "about".

### 3.6 Alerts: web push, PWA, desktop app

- **We already have web push** (`lib/push/web-push.ts`, the `PushSubscription` model, VAPID). The model is business-scoped, so agents need their own `SupportAgentDevice` table, or the model needs widening.
- **iOS:** web push needs iOS/iPadOS **16.4+**, the web app **added to the Home Screen**, a manifest with `display: standalone|fullscreen`, and the permission asked **"in response to direct user interaction"**. The Badging API works too ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). So the support app's phone setup screen must say "Add to Home Screen first" on iPhone.
- **Asking for permission:** use a custom explainer first, then the browser prompt only after the user says yes, and "don't ask for permission as soon as the user opens your site" ([web.dev](https://web.dev/articles/push-notifications-permissions-ux)). In the support app, ask after the agent's first sign-in, with "Get an alert on this device for new chats".
- **Desktop app (later): Tauri 2 vs Electron.**
  - Tauri has official plugins for Notifications, Updater, Autostart, Deep Linking and Single Instance ([Tauri plugins](https://v2.tauri.app/plugin/)).
  - Builds are much smaller, but the measurements disagree: one says about 3.2 MB vs 85 MB for Hello World and 42 MB vs 168 MB idle, while another warns that the popular "96% smaller" claim has no reproducible benchmark ([tech-insider](https://tech-insider.org/tauri-vs-electron-2026/), [digitalapplied](https://www.digitalapplied.com/blog/desktop-apps-web-stack-tauri-electron-deno-wails-2026)).
  - Electron renders the same everywhere (bundled Chromium). Tauri uses each OS's WebView and can have quirks (same sources).
  - **Signing cost (free-first issue):** a macOS app from the internet needs an Apple Developer account at $99 a year to be notarised. Without it the app shows as unverified, and on Apple silicon signing "is required for all apps from the Internet" ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)). Windows has a similar SmartScreen issue (not researched here).
  - **Recommendation:** make the support web app a good **PWA first** (installable on Windows and Mac via Chrome or Edge, with push). Then wrap the same URL in **Tauri** for the "downloadable" app, because it's small, has a native notification plugin, and auto-updates. Budget for signing when it ships (a paid item, so it waits per the free-first rule).

### 3.7 Voice notes with Gemini (free tier first)

- Gemini takes WAV, MP3, AAC, OGG, FLAC, M4A, Opus and **WebM** (what `MediaRecorder` gives in Chrome) among others. It counts **32 tokens per second** (1,920 tokens a minute). Inline requests go up to **20 MB** in total, and the Files API is for larger ones. It does "Transcription and translation" ([audio docs](https://ai.google.dev/gemini-api/docs/audio)).
- Free tier: Flash-Lite input and output are free, but the free tier is **"used to improve our products"**. Paid 3.1 Flash-Lite audio input is $0.50 per 1M tokens ([pricing](https://ai.google.dev/gemini-api/docs/pricing)). **Our maths:** a 1-minute note ≈ 1,920 tokens ≈ $0.001 when paid.
- Rate limits now show only in AI Studio for each project ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)), so check them there. A cached Google table had 2.5 Flash-Lite at 15 RPM / 250k TPM / 1,000 RPD on free ([search capture](https://ai.google.dev/gemini-api/docs/rate-limits?authuser=1)), and that may be out of date.
- **Plan:** cap notes at 2 minutes (≈ 1 MB Opus/WebM), send them inline, and transcribe in the same Netlify route after upload. If the transcript fails (quota), the note still reaches the agent as audio with "transcript paused". Spoken Kinyarwanda quality is untested, so ask the owner to record 10 sample notes.

### 3.8 Translation quality for Kinyarwanda

- **Google Translate** has supported Kinyarwanda since February 2020 ([Google blog](https://blog.google/products-and-platforms/products/translate/five-new-languages/)). Press a year later called the output "hilarious", linking that to the small amount of online Kinyarwanda text ([Multilingual](https://multilingual.com/one-year-in-kinyarwanda-google-translate-still-flawed/)). That is old evidence.
- **LLMs:** the RWS/TrainAI study (120 linguists, 8 models, 8 languages, 3 native-speaker reviews per output, not peer-reviewed) reports **Gemini 2.5 Pro 4.56/5 on Kinyarwanda**, against "no model could produce coherent text" in late 2024 ([report PDF](https://info.rws.com/hubfs/2026/trainai/llm-data-gen-study-2.0-campaign/trainai-multilingual-llm-synthetic-data-gen-study-2.0.pdf), [author's post](https://hn.svelte.dev/item/47847282)). It does not cover Flash-Lite.
- Kinyarwanda is not in the Gemini app's published language list, as far as I found ([Gemini help](https://support.google.com/gemini/answer/13575153?hl=en)). The model may still handle it, but Google doesn't promise it.
- **Research metric:** KinyCOMET (LREC 2026) is a Kinyarwanda–English quality metric that is public and beats BLEU, chrF and AfriCOMET at matching human judgement ([ACL Anthology](https://aclanthology.org/2026.lrec-1.383/)). We could use it to score our own test set offline.
- **Plan:** build a fixed test set of 30 real support sentences (billing, MoMo, "my post failed", greetings, slang and mixed Kinyarwanda–English). Run Flash-Lite, the main text model, and Google Translate. A native speaker (the owner or a tester) scores each one 1–5. Turn the feature on per language only above an agreed bar. Always show the agent the original next to the translation, with a "translated by AI" label. French and Swahili are lower risk, but give them the same check.

### 3.9 Knowledge: stuff the guide in, or retrieve?

- **Size:** 39 guide files, 53,894 words (our count, 23 Oct 2026). That's about 70k tokens at a typical 1.3 tokens a word **(estimate)**, before pricing and FAQs.
- **Stuffing it all in:** on paid 3.1 Flash-Lite that's about 70k × $0.25/M ≈ **$0.018 per AI turn** (our maths, from [pricing](https://ai.google.dev/gemini-api/docs/pricing)). Implicit caching is on by default for Gemini 2.5+ models (minimum 2,048–4,096 tokens by model), but the docs give no discount rate ([caching](https://ai.google.dev/gemini-api/docs/caching)). On the free tier, a 250k-TPM-style limit would allow only about 3 turns a minute across all chats. **Not viable.**
- **Retrieval, MVP option: Postgres full-text search** (`tsvector`, `websearch_to_tsquery`) over guide sections split at `##` headings, about 300–800 words each. Always include a 1–2k-token "guide map" (titles plus a line each) and the top 4 sections, about 5k tokens a turn. No embedding calls, no extra service, and it rebuilds on deploy from the Markdown files. English-only search is fine because the guide is English. Translate the visitor's question into English first (the same Flash-Lite call can return `searchQuery`).
- **v2 option: pgvector on Supabase.** Enable it with `create extension vector` in SQL ([pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)). The page doesn't list plan limits, but extensions are a Postgres feature. Embeddings: `gemini-embedding-2` text input is free on the free tier and $0.20 per 1M when paid ([pricing](https://ai.google.dev/gemini-api/docs/pricing)). About 150 chunks × 1536 floats ≈ 1 MB, which is trivial against the 500 MB database. Chatwoot uses this design (`article_embeddings`, `captain_assistant_responses.embedding vector(1536)`). Use **hybrid search** (FTS + vector, merged by rank) once we see FTS missing paraphrased questions in the gaps report.
- **Account facts** for signed-in clients (plan, trial days, Business info %, channels, credits, failed posts) go in as a small JSON block, read-only and built server-side for that one business, the way the widget passes `businessFactsContext`.

---

## 4. Compliance: Rwanda Law No 058/2021 (not legal advice)

Sources: DLA Piper's country summary ([law](https://www.dlapiperdataprotection.com/?c=RW&t=law), [definitions](https://www.dlapiperdataprotection.com/?c=RW&t=definitions)), the article texts quoted at [dpo.arxia.com](https://dpo.arxia.com/dpp-law/sharing-transferstorage-and-retention-of-personal-data), Hogan Lovells ([summary](https://hlc.com/en/publications/key-features-of-the-new-rwandan-data-protection-law)), PwC Rwanda ([cross-border alert](https://www.pwc.com/rw/en/assets/pdf/legal-alert-navigating-cross-border-data-transfer.pdf)) and Digital Policy Alert ([registration guide](https://digitalpolicyalert.org/change/12081-dpo-registration-guide-for-data-controllers-and-data-processors)). I didn't read the Official Gazette text itself.

| Topic | What the sources say | What it means for the support chat |
|---|---|---|
| **In force** | Since 15 Oct 2021, with 2 years to comply (DLA Piper) | Applies now |
| **Personal data** | "any information relating to an identified or identifiable natural person…", with location data and online identifiers given as examples (Art. 3) | IP, city, pages visited, visitor id and chat content are all personal data |
| **Legal basis** | Art. 46: consent, contract, legal obligation, vital interests, public interest, legitimate interests | Signed-in clients: contract (support for the service). Pre-chat leads: consent (the form). Visitor tracking for the live list: legitimate interests is arguable but **untested in Rwanda**. The cautious choice is a clear notice plus an opt-out, and no tracking before the banner or notice is shown. Whether cookie-style consent is needed is **not addressed** by any source I found |
| **Notice** | Art. 42: tell people the purposes, recipients, the storage period, consent withdrawal, transfers abroad and their rights | One line under the pre-chat form, plus a privacy policy section: what we track on the site (IP, approximate location, device, pages), why (support and sales), who sees it (BuPulse staff, Supabase in the USA, Google Gemini), how long (IP 30 days, chats N months), and how to object |
| **Registration** | Controllers and processors must register with the NCSA. The application covers identity, data categories, purposes, recipients, **destination countries** and risks. The certificate is issued within 30 days (Arts. 29–31). The NCSA DPO office issued a registration guide with an online form on 29 June 2023 | BuPulse needs to register as a controller (memory says there's **no business registration yet**, which may be a blocker, so check with the NCSA). List Supabase (USA), Netlify, Google and the email provider as recipients or processors |
| **Storage in Rwanda** | Art. 50: "The data controller or the data processor stores personal data in Rwanda", unless a valid registration certificate authorises storage abroad | Our us-east-1 database depends on the certificate. Until then this is a known gap the owner accepts. Moving regions isn't possible (no Supabase region in Rwanda) |
| **Transfer abroad** | Art. 48: allowed with NCSA authorisation plus safeguards, the data subject's consent, contract necessity, and other grounds. Art. 49: a written contract with the recipient, in a form the NCSA has not yet adopted | Gemini's free tier ("used to improve our products") is a transfer to Google with secondary use. Say so in the notice, or move support AI to the paid tier when it's affordable. Keep the vendors' DPAs on file |
| **Retention** | Art. 52: keep data until the purpose is met (longer on listed grounds), then destroy it so it "cannot be reconstructed" | Spec: IP for 30 days, then country only. Add: page-hit rows 30 days, unconverted visitor rows 12 months, chats 24 months (owner to decide), attachments 90 days, voice notes deleted after transcription plus 30 days |
| **Security and breaches** | Art. 47 on safeguards. Breach notice to the NCSA **within 48 hours**, and to the data subjects if the risk is high (Arts. 43, 45) | MFA for agents, a private storage bucket, signed URLs, RLS, audit log (`AuditLog`), and a written breach runbook |
| **DPO** | Required for large-scale regular and systematic monitoring of data subjects, among other cases (Art. 40) | Watching every visitor's pages *may* count as "systematic monitoring" once we're at scale. Keep it in view |
| **Rights** | Access, rectification, erasure, objection, restriction, withdrawing consent (Art. 42). Objection to direct marketing and profiling (Art. 19) | Lead scoring is profiling for sales, so honour an objection. Admin needs "export / delete this visitor's chats" |
| **Children** | Under 16 needs parental consent (Art. 9) | The pre-chat form doesn't ask age. The link-in-bio sales mode could reach minors, so keep it to lead capture only |
| **Penalties** | Administrative fines of RWF 2–5M or 1% of global turnover for companies (Art. 53), including for operating unregistered. Criminal offences go up to 5% of turnover (Art. 62) | Registration is the cheap fix |

**Uncertain:** whether a visitor list built from IP and pages needs opt-in consent; whether the NCSA will register a business that isn't yet incorporated; and the certificate's validity period (the regulation is pending, per DLA Piper). Ask a Rwandan lawyer or the NCSA DPO office before launch, not after.

---

## 5. Recommended architecture and phased plan

### 5.1 Shape

```
Visitor page (bupulse.com, dashboard, creator portal, bio corner link)
  └─ support-widget.js loader (same pattern as public/widget.js: closed Shadow DOM launcher, iframe /support/chat)
       ├─ POST /api/support/v1/visit            (Netlify: geo + IP captured once, returns visitToken)
       ├─ RPC support_heartbeat(visitToken,…)    (straight to Supabase PostgREST, every 30–60 s while visible)
       ├─ /api/support/v1/conversations/*        (Netlify route handlers: send message, AI reply, upload URL, rating)
       └─ Supabase Realtime, public topic sv:<128-bit>  (content-free pings, only while the panel is open)

Support app (support.bupulse.com = same Netlify site, host-routed; PWA; later Tauri shell; later phone)
  ├─ Supabase Auth session (email+password + TOTP, aal2), agent row checked server-side
  ├─ /api/support/v1/agent/*                     (versioned REST API; the only thing desktop/mobile apps use)
  └─ Supabase Realtime private topics (RLS on realtime.messages):
        staff:inbox · staff:visitors · agent:<id> · conv:<id> · staff:presence (Presence)

Back end
  ├─ Postgres via Prisma 7 (tables below) + triggers → realtime.broadcast_changes / realtime.send
  ├─ Gemini Flash-Lite (lib/ai provider; ledger feature "support"), FTS retrieval over guide sections
  ├─ DueJob handlers: 2-min no-reply email, outside-hours ticket, weekly gaps report, IP/attachment retention, AI-resolution judge
  └─ Supabase Storage private bucket "support" (signed upload/download URLs)
```

Reuse what we already have: the Turnstile and rate limits (`lib/widget/turnstile.ts`, `RateLimit`), `lib/platform/headers.ts`, `GeminiTextProvider` + `AiCall` ledger, `DueJob`, web push, `Lead`/`createLeadFromChat` for pre-chat leads (Admin → Sales), and `AuditLog`. **Keep it separate from** the client inbox engine (`Contact`/`Conversation`/`Message` are `businessId`-scoped and channel-adapter based). Support is BuPulse's own tenant with staff agents, different RLS and retention, so separate `Support*` tables keep the two from leaking into each other. The message shape copies the inbox so the UI pieces can be shared.

### 5.2 Data model (Prisma, Postgres)

| Table | Key columns | Notes |
|---|---|---|
| `SupportAgent` | id, userId (Supabase auth, unique), email, name, avatar, role `AGENT\|SUPERVISOR`, status `invited\|active\|locked`, availability `online\|away\|offline`, maxChats, lastSeenAt, lockedAt | Created in Admin → Live chat. Never an admin account. MFA required |
| `SupportDepartment` | id, key (`sales`,`technical`,`billing`,`creators`), name, sort | |
| `SupportAgentDepartment` | agentId, departmentId (unique pair) | Like Chatwoot `team_members` |
| `SupportSettings` | singleton: hours JSON (Kigali, per weekday), greetings JSON (per path pattern → text, delay), aiEnabled, aiRules (text), alwaysHandoverTopics[], prechatMode, retention JSON | Admin-edited |
| `SupportVisitor` | id, visitorKey (random, from localStorage, unique), userId?, businessId?, creatorProfileId?, name?, email?, phone?, businessName?, leadId?, firstSeenAt, lastSeenAt, visitCount, optedOut | One person across visits |
| `SupportVisit` | id, visitorId, tokenHash, startedAt, lastSeenAt, endedAt, ip? (nulled at 30 d), country, city, region, device, browser, os, referrer, landingPath, currentPath, currentTitle, pageCount, surface `public\|dashboard\|creator\|bio` | Heartbeat RPC updates it. Index `lastSeenAt` |
| `SupportPageHit` | id, visitId, path, title, at | 30-day retention. Capped per visit (e.g. 50) |
| `SupportConversation` | id, number (human-readable sequence), visitorId, visitId?, surface, status `AI\|WAITING\|OPEN\|PENDING\|CLOSED`, departmentId?, assigneeId?, aiActive, handoverAt?, handoverReason?, waitingSince?, firstHumanReplyAt?, lastMessageAt, closedAt?, closedBy, language, summary?, summaryAt?, leadScore?, tags[], urgency?, aiResolved?, rating?, ratingComment?, transcriptSentAt?, ticketMode (email/WhatsApp follow-up), topicToken (the sv:… secret, hashed) | Copies Chatwoot's `waiting_since` and `bot_handoff!` semantics |
| `SupportMessage` | id, conversationId, author `VISITOR\|AI\|AGENT\|SYSTEM`, agentId?, kind `TEXT\|NOTE\|EVENT\|FILE\|VOICE\|RATING`, body, lang?, translations JSON, attachmentId?, aiSources JSON (guide section ids), aiConfident?, clientMsgId (unique per conversation, for idempotent retries), createdAt, seenByVisitorAt?, seenByAgentAt? | `NOTE` = internal note, never sent to the visitor |
| `SupportAttachment` | id, conversationId, storagePath, mime, bytes, width?, height?, durationSec?, scanStatus, transcript?, transcriptStatus, expiresAt | Private bucket, signed URLs |
| `SupportOutcome` | conversationId (pk), aiReplyCount, agentReplyCount, handoverAt?, handoverReason?, resolvedBy `AI\|AGENT\|NONE`, judgedAt?, rating? | Copied from Chatwoot `conversation_outcomes` |
| `SupportEvent` | id, name, conversationId?, agentId?, value (seconds), valueInHours, at | Reporting (first reply, wait, handover), like `reporting_events` |
| `SupportCanned` | id, shortcut, title, body, departmentId? | v2 |
| `SupportGap` | id, weekOf, clusterTitle, count, sampleConversationIds[], suggestedAddition, targetGuideFile, status `open\|accepted\|fixed\|dismissed` | Weekly report |
| `SupportGuideChunk` | id, file, heading, anchor, body, tsv (generated tsvector), embedding? (vector, v2), hash | Rebuilt from `docs/guide/features/*` |
| `SupportDevice` | id, agentId, kind `webpush\|tauri\|fcm\|apns`, endpoint/token, keys JSON, label, lastSentAt | Agent alerts |
| `SupportMessageReport` | messageId, agentId, reason | Bad-AI flag → gaps |

RLS: deny everything to `anon` on all `Support*` tables. The only anon entry point is `security definer` functions (`support_heartbeat`). Staff reads go through our API (Prisma, service role), so RLS on these tables is defence-in-depth. The **real-time** RLS on `realtime.messages` is the one that matters: `staff:*`/`conv:*` topics need an active `SupportAgent` row for `auth.uid()` and `aal2`.

### 5.3 API surface (versioned: `/api/support/v1`)

These are JSON route handlers. Agents send `Authorization: Bearer <Supabase JWT>`, and visitors send `X-Support-Visit: <visitToken>` (plus a Turnstile token on the first message, as in the widget). Cursor pagination is `?after=<id>&limit=`. Errors are `{ error: { code, message } }`. An OpenAPI file in `docs/api/support-v1.yaml` is the contract the desktop and mobile apps build against. Breaking changes go to `/v2`.

**Visitor (widget)**
- `POST /visit` → `{ visitToken, visitorKey, hours:{open, nextOpen}, greeting?, conversation? }` (captures geo and IP)
- `POST /prechat` `{ name, email, business, whatsapp? }` → creates or links the `Lead`
- `POST /conversations` `{ text, clientMsgId }` → `{ conversationId, topic, messages }`
- `GET /conversations/:id/messages?after=`
- `POST /conversations/:id/messages` `{ text | attachmentId, clientMsgId }` → saves the message, triggers the AI reply when `aiActive`
- `POST /conversations/:id/typing`
- `POST /conversations/:id/human` (asks for a person; adds an event and handover)
- `POST /conversations/:id/uploads` `{ mime, bytes }` → signed upload URL, then `POST …/uploads/:id/done`
- `POST /conversations/:id/rating` `{ score, comment? }`, `POST /conversations/:id/transcript`
- RPC `support_heartbeat(visit_token, path, title)` (Supabase, not Netlify)

**Agent (support app, desktop, mobile)**
- `GET /me`, `PATCH /me` `{ availability }`, `POST /me/devices`, `DELETE /me/devices/:id`
- `GET /conversations?view=mine|unassigned|all|waiting&department=&tag=&q=&after=`
- `GET /conversations/:id` (with visitor, visit, account facts, outcome)
- `POST /conversations/:id/messages` `{ text, kind: TEXT|NOTE, clientMsgId, translateTo? }`
- `POST /conversations/:id/takeover` (sets `aiActive=false`, assigns the agent, broadcasts), `POST /conversations/:id/release-to-ai`
- `POST /conversations/:id/assign` `{ agentId | departmentId }`, `POST /conversations/:id/close`, `POST /conversations/:id/reopen`
- `GET /conversations/:id/assist` → `{ summary, suggestions[3], sources[] }` (cached per last message id)
- `POST /assist/rewrite` `{ text, style: friendlier|formal|shorter|translate, lang? }`
- `POST /messages/:id/report` (bad AI answer)
- `GET /visitors/live`, `GET /visitors/:id` (visits, pages, conversations), `POST /visitors/:id/invite` `{ text }` (an agent starts a chat)
- `GET /stats?from=&to=` (supervisor), `GET /gaps`, `PATCH /gaps/:id`
- `GET /canned`, CRUD (v2)
- `GET /realtime` → `{ url, anonKey, topics[] }` (the client then joins with its own JWT)

**Real-time events** (Broadcast payloads are small; clients fetch details over REST): `message.created {conversationId, messageId}`, `conversation.updated {id, fields[]}`, `typing {conversationId, who}`, `visitor.changed {visitId}`, `handover {conversationId, reason}`, `agent.force_logout`.

**Admin** (inside the Admin panel, server actions, not part of the public API): agents (invite, lock, reset MFA), departments, hours, greetings, AI settings, retention, export or delete a visitor.

### 5.4 Phases

**MVP (v1): the tawk.to replacement with an AI front desk**
1. The widget on public pages, the dashboard and the creator portal (not admin). Pre-chat form on public pages (the order is an owner decision, see 2.2). Smart greeting with the spec's timing, once per visit, and no text bubble on phones.
2. The AI answers from FTS-retrieved guide sections plus account facts. Handover on: asked for a human, not confident, upset, always-handover topics. Team-hours message and outside-hours ticket (email follow-up).
3. Support web app at support.bupulse.com (same site): sign-in with TOTP; inbox (mine / unassigned / all); take over and give back to the AI; internal notes; close; the visitor panel (country, city, device, pages, referrer, business and plan).
4. Real time: private staff topics, visitor ping topics, a 5 s poll fallback only while the panel is open and the socket is down.
5. Alerts: sound plus browser notification in the app; email after 2 minutes with no reply (`DueJob`).
6. Live visitors list (heartbeat RPC plus staff broadcast).
7. Rating plus transcript email. "Continue on WhatsApp" wa.me link.
8. Images and PDFs ≤ 10 MB, images shrunk in the browser, private bucket, 90-day expiry.
9. The privacy policy section, IP reduced after 30 days, retention jobs, the `support` AI ledger feature, and an AI-resolution judge job with a simple stats page.

**v2: better than tawk.to (spec section 4)**
- Summary plus 3 suggested replies on open (`/assist`), composer rewrite actions.
- Live translation (rw/fr/sw ↔ en) **after** the 30-sentence check (3.8).
- Lead score and urgency tags (sorting the inbox).
- The weekly knowledge-gaps report, and the bad-AI-answer flag.
- Voice notes with a transcript (free tier first; paused when out of quota).
- Web push to phones (PWA, iOS Home Screen flow) and the desktop browser.
- Supervisor: live read of any chat, reassignment, stats with business-hours times, ratings.
- Departments and routing, canned replies, agent-started chats from the visitor list.
- Bio-page "Made with BuPulse" sales mode.

**v3: apps and scale**
- A Tauri desktop app wrapping the PWA (notifications, auto-update, autostart), with signing budgeted.
- Phone apps on the same `/v1` API (or a better PWA first).
- WhatsApp alerts and a WhatsApp channel (paid WhatsApp Business API, built but off per the spec).
- pgvector hybrid retrieval if the gaps report shows FTS misses.
- Move to Gemini's paid tier for support (no product-improvement use of data), and NCSA-certified transfers.
- If the 200-connection or 2M-message caps get close, move to Supabase Pro or put Ably behind the `RealtimeTransport` interface.

### 5.5 Risks to watch

| Risk | Early sign | Plan |
|---|---|---|
| Netlify 300-credit cap | The credits graph in the Netlify UI | Heartbeats on Supabase; few production deploys; no SSE |
| Supabase 200 connections | Peak connections in usage | Visitors connect only with the panel open; staff tabs share one socket (BroadcastChannel between tabs) |
| Gemini free-tier RPM/RPD | 429s in the `AiCall` ledger | Short prompts (FTS); fallback model; "a person will reply" message |
| Storage 1 GB | Bucket size | Browser compression, 90-day expiry |
| Poor Kinyarwanda translation | Native-speaker scores | Launch translation per language only above the bar |
| Law: storage abroad without a certificate | — | NCSA registration listing the transfers, before launch |

---

## Sources (all fetched 23 Oct 2026)

- Intercom: [pricing](https://www.intercom.com/pricing) · [Fin explained](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained) · [Copilot](https://www.intercom.com/help/en/articles/8587194-copilot-explained) · [Recommendations](https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin) · [Unresolved questions](https://fin.ai/help/en/articles/13975776-analyze-unresolved-questions)
- Crisp: [pricing](https://crisp.chat/en/pricing/) · [AI agent help](https://help.crisp.chat/en/article/how-to-create-an-ai-chatbot-with-magicreply-1i1jeof)
- Tidio: [pricing](https://www.tidio.com/pricing/) · [llm-info](https://www.tidio.com/llm-info/)
- Zendesk: [automated resolutions](https://support.zendesk.com/hc/en-us/articles/5352026794010) · third party [eesel](https://eesel.ai/blog/zendesk-ai-pricing/), [coworker.ai](https://coworker.ai/blog/zendesk-ai-pricing)
- LiveChat/Text (third party): [myaskai](https://myaskai.com/blog/livechat-ai-complete-guide-2026)
- Chatwoot: [schema.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/db/schema.rb) · [message.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/models/message.rb) · [conversation.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/models/conversation.rb) · [room_channel.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/channels/room_channel.rb) · [client APIs](https://www.chatwoot.com/docs/product/channels/api/client-apis) · third party [eesel pricing](https://www.eesel.ai/blog/chatwoot-pricing)
- Freshchat: [pricing](https://www.freshworks.com/live-chat-software/pricing/)
- Gorgias: [pricing](https://www.gorgias.com/pricing) · [AI Agent explained](https://docs.gorgias.com/en-US/ai-agent-explained-497772) · [customise](https://docs.gorgias.com/en-US/customize-how-ai-agent-behaves-567324) · [sales prep](https://docs.gorgias.com/en-US/best-practices-prepare-ai-agent-for-sales-conversations-1123832)
- UX: [USPTO 8565411](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8565411) · [Velaro timing](https://v20.velaro.com/blog/proactive-chat-timing) · [Velaro benchmarks](https://v20.velaro.com/blog/live-chat-benchmarks-2026) · [ProvideSupport](https://www.providesupport.com/articles/how-to-initiate-chats-that-actually-convert) · [Alexander Jarvis](https://www.alexanderjarvis.com/what-is-live-chat-abandonment-rate-in-ecommerce/) · [Convince & Convert](https://www.convinceandconvert.com/customer-experience/right-tone-with-live-chat/) · [Zuko](https://zuko.io/form-optimization-case-studies/beyond-clicks-property) · [eesel handoff](https://eesel.ai/blog/ai-agent-handoff-best-practices) · [Alhena](https://alhena.ai/blog/ai-human-escalation-chatbot-handoff-best-practices/) · [murf.ai](https://murf.ai/blog/ai-to-human-handoff) · [hyperleap](https://hyperleap.ai/blog/chatbot-human-handoff-best-practices) · [Cresta](https://cresta.com/guides/ai-to-human-agent-handoff-best-practices) · [web.dev permission UX](https://web.dev/articles/push-notifications-permissions-ux)
- Supabase: [realtime limits](https://supabase.com/docs/guides/realtime/limits) · [pricing](https://supabase.com/pricing) · [authorization](https://supabase.com/docs/guides/realtime/authorization) · [postgres changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [broadcast](https://supabase.com/docs/guides/realtime/broadcast) · [presence](https://supabase.com/docs/guides/realtime/presence) · [messages usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) · [peak connections](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections) · [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) · [MFA](https://supabase.com/docs/guides/auth/auth-mfa) · [third-party auth](https://supabase.com/docs/guides/auth/third-party/overview) · [pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)
- Netlify: [credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) · [functions configuration](https://docs.netlify.com/build/functions/configuration/) · [functions API](https://docs.netlify.com/build/functions/api/) · [forum: geo](https://answers.netlify.com/t/geolocation-context/71149/12)
- Real time alternatives: [Ably free](https://ably.com/docs/platform/pricing/free) · [Pusher pricing](https://www.pusher.com/channels/pricing)
- Geo: [Cloudflare IP geolocation](https://developers.cloudflare.com/network/ip-geolocation/) · [GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula) · [GeoLite2](https://www.maxmind.com/en/asnum) · [DB-IP Lite](https://www.db-ip.com/db/download/ip-to-city-lite)
- Push and desktop: [WebKit iOS web push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) · [Tauri plugins](https://v2.tauri.app/plugin/) · [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/) · [tech-insider](https://tech-insider.org/tauri-vs-electron-2026/) · [digitalapplied](https://www.digitalapplied.com/blog/desktop-apps-web-stack-tauri-electron-deno-wails-2026)
- Gemini: [audio](https://ai.google.dev/gemini-api/docs/audio) · [pricing](https://ai.google.dev/gemini-api/docs/pricing) · [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [caching](https://ai.google.dev/gemini-api/docs/caching) · [Gemini app languages](https://support.google.com/gemini/answer/13575153?hl=en)
- Kinyarwanda: [RWS TrainAI 2.0 PDF](https://info.rws.com/hubfs/2026/trainai/llm-data-gen-study-2.0-campaign/trainai-multilingual-llm-synthetic-data-gen-study-2.0.pdf) · [author post](https://hn.svelte.dev/item/47847282) · [KinyCOMET](https://aclanthology.org/2026.lrec-1.383/) · [Google Translate launch](https://blog.google/products-and-platforms/products/translate/five-new-languages/) · [Multilingual](https://multilingual.com/one-year-in-kinyarwanda-google-translate-still-flawed/)
- Rwanda law: [DLA Piper law](https://www.dlapiperdataprotection.com/?c=RW&t=law) · [DLA Piper definitions](https://www.dlapiperdataprotection.com/?c=RW&t=definitions) · [Arts. 48–52 text](https://dpo.arxia.com/dpp-law/sharing-transferstorage-and-retention-of-personal-data) · [Hogan Lovells](https://hlc.com/en/publications/key-features-of-the-new-rwandan-data-protection-law) · [PwC cross-border](https://www.pwc.com/rw/en/assets/pdf/legal-alert-navigating-cross-border-data-transfer.pdf) · [Digital Policy Alert registration guide](https://digitalpolicyalert.org/change/12081-dpo-registration-guide-for-data-controllers-and-data-processors)
