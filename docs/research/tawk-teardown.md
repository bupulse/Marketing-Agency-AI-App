# tawk.to teardown (public sources only)

Research for `docs/SUPPORT_CHAT.md`. Collected 2026-10-23 without signing in, without creating an account, and without sending any chat message or form. **We copy ideas and features only, never their code, text or artwork.**

**How it was gathered**
- About 340 public help-center articles at help.tawk.to (`/article/<slug>`). Below they are cited as `H:<slug>`.
- The developer portal: `developer.tawk.to/jsapi`, `/webhooks` and `/zapier`.
- The marketing pages www.tawk.to, `/pricing` and the REST beta request form.
- The public visitor widget that tawk.to runs on its own site: property `521727297ca1334016000005`, widget `18nms7gql`, build `v4/app/6acdb8c93b0`. The loader marks this build `$_Tawk_Unstable=true` and its ETag says `canary-v4`, so customers may be served a different build. The bundle was downloaded to the scratchpad and read statically. It was never executed.
- Reviews: Trustpilot, Shopify App Store, wordpress.org, and the Capterra/G2 summaries in search results (both sites blocked direct fetch with a 403).
- A headless page-load capture of www.tawk.to set no tawk cookies within 25 s (cause unknown), so the runtime traffic is **not** observed. Everything in section 4 comes from the bundle source and is marked that way.

**Confidence**
- **H**: stated in their own docs, or plainly visible in the bundle.
- **M**: marketing copy, third-party pages, or a reasonable reading of the bundle.
- **L**: inference.
- **Unknown**: public sources don't show it.

The logged-in dashboard teardown in spec §6 (the owner's own free account) should check every item marked Unknown, above all the column set in section 2.

---

## 1. Product map

### 1.0 Account model
| Item | What it is | Conf. / source |
|---|---|---|
| Agent-centric accounts | One login can belong to many properties. Invites are per property. An email address can be used only once across tawk.to. | H, `H:how-to-invite-and-manage-agents` |
| Property | A business unit with its own widgets, Knowledge Base, chat page and data. Unlimited and free. | H, `H:the-difference-between-properties-chat-pages-and-profile-pages` |
| Chat page, Profile page | A hosted chat page (1 per property) for businesses without a website. A personal profile page (1 per account) that only its owner answers. | H, same article |
| Multiple widgets per property | Switched with the JS API `switchWidget({propertyId, widgetId})`, e.g. for each language. | H, jsapi; `H:change-the-widget-based-on-the-visitors-language` |
| Unlimited agents for free | The pricing page says "No per-seat fees", "Free forever". | H, tawk.to/pricing |

### 1.1 Dashboard areas
| Area | What it does | Conf. / source |
|---|---|---|
| **Dashboard (home)** | **Live Visitors:** a real-time graph, plus historical analytics for visitors, chats and page views. **History:** recent chats. **Daily totals:** visitors, page views and answered chats, each compared with yesterday and the 7-day high/low. **Summary:** Positive Sentiment (from ratings), Engagement (chats ÷ visits) and Availability (how often agents were online). | H, `H:understanding-the-statistics-in-your-dashboard` |
| **Monitoring** | Live visitors in 4 groups: **Unanswered**, **Served**, **Active** (browsing, not in a chat) and **Idle**. **Sleep Mode** pauses the live feed after 10 min / 30 min / 1 h / 2 h of agent inactivity, with a "Continue Subscribing" prompt 1 min before; chat notifications still arrive. See section 2. | H, `H:understanding-visitor-monitoring-and-chat-sessions`, `H:enabling-the-sleep-mode-feature` |
| **Left sidebar (live chats)** | Incoming and ongoing chats, colour-coded: pink = unanswered, green = joined or new visitor message, red = being transferred, grey = answered by someone else. Visitor dot: green = active, yellow = idle; orange = no reply for over 10 min. | H, `H:how-to-answer-an-incoming-chat`, `H:tips-for-responding-to-multiple-chats-at-the-same-time` |
| **Inbox (shared)** | **Channels:** chats, tickets, email (IMAP), Facebook Messenger, WhatsApp (including Coexistence), Telegram, Twilio SMS, and Trash with Restore and Purge. **Filters:** agent, minimum messages, rating, status, tags, last updated. **Sort:** created or updated. **Open** = missed chat, **Closed** = done. Chats can be exported. | H, `H:getting-started-with-messaging`, the channel categories, `H:exporting-messages` |
| **Tickets** | **Statuses:** Open, Pending (set automatically when an agent replies) and Closed (never automatic; a reply reopens). **Fields:** priority, assignee (agent or department), tags, internal notes. **Sources:** a chat, a past chat, a contact, an offline message (needs the visitor's email), forwarded email, or the KB "Submit Ticket" form. **Send-and-set-status button:** sends the reply and sets the status in one click. Search and export. | H, the ticketing category |
| **Contacts (CRM)** | **Every chat creates a contact** with automatic data: location and IP. **Records:** people, organizations (B2B), saved segments, custom attributes (Long Text up to 2048 characters, Number, Date, lists), tags and internal notes. **Contact page:** a timeline across all channels. **Data:** merge duplicates, CSV import/export, message a contact. | H, the contacts category |
| **Reporting** | **Live chat:** chat volume, missed chats, offline messages, average chat duration, user satisfaction, first response time. **Tickets:** new, solved, source, resolution time, reopened, first response. **Knowledge Base:** top articles, searches (terms, results, clicks), feedback (helpful above 50%). **AI Assist:** message usage (bot, AI Commands, Smart Reply, transcription). **Lead Capture records.** **Controls:** filter by agent or tag, daily or weekly, 7 days to 12 months, graph or table, CSV download. **Weekly Roundup email.** | H, `H:understanding-reporting`, `H:understanding-weekly-roundup-email` |
| **Knowledge Base** | **Hosted help center:** a block editor with "/" insert and AI commands, categories and a primary category, private (agent-only) articles. **Languages:** extra languages copy the structure, but **translation is manual**. **Other:** custom domain plus SSL (white-label), a Submit Ticket form, and search inside the widget. | H, the KB category; marketing copy |
| **Admin → Property Members** | Invite by email or CSV. **Only 2 roles: Admin and Agent.** Pending invitations can be resent or deleted. | H, `H:how-to-invite-and-manage-agents` |
| **Admin → Departments** | Name, description and agents; an agent can be in several. **Routing:** a department picker in the pre-chat form, transfer to a department, tickets assigned to a department, and reports filtered by department. **Deleting** a department asks where its conversations should go. | H, `H:creating-and-managing-departments` |
| **Admin → Agent Alerts** | Internal notes of up to 500 characters, shown to agents at the start of every chat ("push the promo", policy reminders). Per property. | H, `H:creating-and-managing-agent-alerts` |
| **Admin → Shortcuts (canned replies)** | **Parts:** a title (recalled with "/"), a message, up to 4 **Suggested Messages** (buttons the visitor can click), up to 5 **AI Questions** (example questions that make the AI send this shortcut), and **Actions** (e.g. Change Tags). Global or personal (profile) shortcuts. A built-in `lead-capture-form` shortcut. | H, `H:tips-for-responding-to-multiple-chats-at-the-same-time`, `H:tagging-chats-contacts-and-tickets`, `H:capturing-leads-via-the-tawkto-lead-capture-form` |
| **Admin → Triggers (proactive)** | **Basic types:** Site Notification, Page Notification, Chat Rescuer, Widget Maximized. **Advanced:** see section 1.2. Up to 20 triggers per property. The type can't be changed after saving. Triggers only run while the widget is online. | H, `H:creating-and-managing-triggers`, `H:advanced-triggers` |
| **Admin → Tabs** | Side panels in the agent chat view. **Built in:** Details, Knowledge Base, Shortcuts, History. **Custom:** URL (an embedded page such as a Google Form or booking tool), Text, Menu, and Chat (a direct message or group chat). | H, `H:creating-and-managing-tabs` |
| **Admin → Chat Widget** | **Content editor:** header and body cards for each state (online, away, offline, pre-chat). **Appearance:** colours, position. **Language.** **Attention Grabber:** an image near the bubble, with seasonal sets. **Behaviour switches:** see section 3.2. **Scheduler.** **Consent form.** **Country restriction.** **Domain and platform restrictions.** **Direct Chat Link.** | H, the chat-widget-customization category |
| **Admin → Widget Scheduler** | Off, a preset, or custom. **Custom:** time zone (with daylight saving), per-day on/off, several segments per day. **Precedence:** the scheduler beats agent status and AI availability; outside the hours the widget is offline. A chat in progress is not cut off. | H, `H:using-the-widget-scheduler`, `H:the-difference-between-online-away-and-invisible` |
| **Pre-chat form** | Up to 10 fields: Name, Email, Phone (with country code), Department, Text, Text Area, Options, Multiple choice, Number, Date. **Options:** required (star), drag to reorder, link a field to a contact custom attribute, "Exclude from AI" (the AI waits for the first real message). Their own doc warns it **reduces chat volume**. | H, `H:using-the-pre-chat-form` |
| **Offline form** | Name, email and message, plus questions. It goes to the Inbox and can become a ticket by email. The JS API `onOfflineSubmit` passes `{name,email,message,questions[]}`. | H, `H:responding-to-offline-messages-via-ticketing`, jsapi |
| **Consent form** | **Two separate forms:** GDPR (EU/EEA visitors or all visitors) and US two-party-consent states (14 states, with California and Florida flagged "High risk"). **Per state:** the message, privacy URL and button labels. **Purpose:** consent before cookies or local storage are used. | H, `H:enabling-and-managing-your-consent-form`; the bundle has `ConsentForm` and `UsTwoPartyForm` chunks |
| **Banned visitors** | Ban from a live chat or the Inbox (3-dot menu → Ban, with a reason and an optional **Ban IP**), or add an IP manually to the Ban List. Without an IP ban, a visitor can come back by clearing cookies. Unban by deleting the entry. | H, `H:banning-a-visitor` |
| **Country restriction** | Show the widget only to listed countries, or hide it from them (IP geolocation). Hidden visitors **still appear in Monitoring**, and agents can still chat with them. | H, `H:restricting-the-chat-widget-by-country` |
| **Profile → Aliases** | Up to 30 personas (name, title, image), one of them default, picked when joining a chat. Used "to appear as a larger organization". | H, `H:creating-and-managing-aliases`, `H:how-many-aliases-can-i-create` |
| **Agent status** | Online, Away, Invisible. By default the widget can show **online even when every agent is invisible or away**, unless "Widget offline when all agents offline" is on. AI Assist can keep it online too. | H, `H:the-difference-between-online-away-and-invisible` |
| **Notifications** | Desktop and sound alerts per event (new chat, new visitor, new agent message). Mobile push, badge, and a Do Not Disturb mode. "New visitor" alerts can be turned off. | H, `H:managing-sound-settings-and-desktop-notifications`, `H:how-to-stop-new-visitor-notifications` |
| **Internal messaging** | Direct messages and group chats between agents; they can be pinned as tabs. | H, `H:setting-up-direct-messages` |
| **Webhooks / Zapier** | See section 5. Up to 10 webhooks per property. | H, `H:creating-and-managing-webhooks` |
| **Integrations** | **Site builders:** WordPress, Shopify, Wix, Squarespace, Webflow, Joomla, PrestaShop, Magento, BigCommerce, OpenCart, GTM… **Analytics:** GA and Google Ads event tracking. **Make/Zapier recipes.** **AI Assist API integrations:** Shopify, WooCommerce, BigCommerce, Google Forms, custom HTTP API. | H, the integrations and AI Assist integration categories |
| **Apps** | Web, Windows, macOS, iOS and Android, all free. **iOS:** 3.6 stars from 205 ratings. **Mobile SDK:** none; their doc says it is "on the roadmap" and suggests the Direct Chat Link in a webview or browser. | H/M, tawk.to marketing; apps.apple.com/app/id907458277; `H:how-to-add-the-tawkto-widget-to-your-mobile-application` |

### 1.2 Advanced trigger engine (closest to our "smart greeting")
- **When it runs (event):** examples only, "visitor loads a page" and "visitor starts a chat" (a full list is not public). It checks **ANY** or **ALL** of up to **10 conditions**, then runs up to **5 actions**. H, `H:advanced-triggers`
- **Conditions**, by group (H, `H:conditions-for-advanced-triggers`):
  - **Time/Date:** hour of day, day of week, time on page, time on site, "still on site", "still on page".
  - **Location:** IP, hostname, city, country.
  - **Previous visits:** previous visits, previous chats.
  - **Page:** page URL, page count, page title, previous page.
  - **Visitor:** name, referrer, search engine, search terms.
  - **Software:** user-agent text, browser, platform/OS (including mobile).
  - **Online status:** account status, user status.
  - **Chat:** visitor requesting chat (true/false), visitor served (true/false), message contains.
- **Actions:**
  - Send a message, as a shortcut or custom text with an agent image and name, plus up to 4 suggested replies.
  - **Wait** N seconds.
  - **Set Name of Visitor.**
  - **Append Note** or **Replace Note** (internal).
- **Once per visitor:** an "only once per visitor" toggle.
- **Chat Rescuer:** if nobody answers within N seconds, it offers the lead-capture form. `H:advanced-trigger-—-chat-rescuer-…`

### 1.3 AI Assist ("Apollo") and paid add-ons
**What AI Assist does.** H, `H:getting-started-with-ai-assist`, `H:understanding-ai-assist’s-data-sources`, `H:using-smart-reply`, `H:using-ai-base-commands`, `H:understanding-ai-transcription-in-tawkto`
- **What it is:** a per-property add-on. The bot persona appears as "Apollo AI" in docs and marketing.
- **Setup wizard:**
  - **Inputs:** a description or template; the website URL, documents or a written description; the industry.
  - **Objectives:** Answer questions, Capture leads, Book appointments, Order support.
  - **Objective details:** which visitor details to collect; whether to escalate or point to self-service; which facts never to state, such as exact price, stock or delivery times.
  - **Business facts:** name, address, phones, emails, socials, hours, custom facts.
  - **Generated, then editable:** FAQs, a persona, an avatar, a business description, Instructions.
  - **Hookups:** tools and integrations, then channels.
- **Per agent:**
  - **Instructions** (a base prompt) and **Scenarios** (instructions for one situation, e.g. refunds or order tracking).
  - **Completion model:** "Auto" costs 3 credits a reply.
  - **Schedule.**
  - **Behaviour:** reply delay ("more human"), "Revise answer based on context", multilingual replies.
  - **Escalation:** the shortcuts used when a visitor asks for a human or nothing is found.
- **Data sources:** FAQs, plain text, documents (PDF, CSV, TXT), tables (CSV or Excel), KB articles, shortcuts, and website crawl (100 to 10,000 pages, re-crawled hourly on Enterprise). Agents share every source except Text.
- **For human agents:**
  - **Smart Reply:** a suggested reply from the data sources; it costs credits.
  - **AI Commands** in chats, tickets and the KB: `/ai-brainstorm`, `-task`, `-tone`, `-fixtext`, `-pointexpand`, `-sentenceexpand`, `-simplify`, `-stepbystep`, `-summarize`, `-writeabout`.
- **AI Transcription** of voice messages: MP3, MP4, M4A, WAV, WEBM…, up to 25 MB and 5 min. It costs 1 credit per started minute of speech (at most 5), plus the reply.
- **Takeover:** a human clicks **Join Chat** and the AI leaves by itself. After the chat closes, a new visitor message brings the AI back. `H:how-to-take-over-a-chat-from-another-agent-or-ai-assist`

**AI Assist plans** (H, `H:how-to-manage-billing-for-ai-assist`)

| Plan | Price | Credits / month | AI agents | Crawled pages | API calls |
|---|---|---|---|---|---|
| Hobby | free | 100 | 1 | 100 | none |
| Growth | $29/mo or $290/yr | 1,000 | 3 | 500 | 1,000 |
| Business | $99/mo or $990/yr | 5,000 | 5 | 2,000 (every 12 h) | 5,000 |
| Enterprise | $399/mo or $3,990/yr | 20,000 | 10 | 10,000 (hourly) | 10,000 |

- **Extra credits:** $30 per 1,000; they don't expire. Excess usage can run to a negative balance.
- **What 100 credits buy:** at 3 credits per Auto reply, Hobby's 100 credits are about **33 AI replies a month** (L, our arithmetic).

**Other add-ons**

| Add-on | Price | Conf. / source |
|---|---|---|
| Remove Branding / Whitelabel | $39 a month, or $348 a year ($29/mo); per property. Covers the widget, chat page, direct link, popout, ticket email footers and KB, on custom domains. | H, `H:purchasing-the-remove-branding-and-white-label-add-on` |
| Video + Voice + Screensharing | Per property; **price not public**. 1 agent and 1 visitor per call; calls are not recorded. | H, `H:video-voice-screensharing-add-on`, `H:getting-started-with-video-voice-screensharing` |
| Hire Chat Agents | $1 an hour; English only; 2 chats at once by default. | H, pricing page and `H:how-to-purchase-tawktos-hired-agent-service` |
| Virtual Assistants | From $7 an hour. | H, pricing |
| Voice Agents (AI phone) | From $49 a month: inbound and outbound calls on a real number, warm transfer to a human. | M, pricing copy |
| Data Enrichment | From $59 a month: names the company behind anonymous visitors and fills in contact emails and direct phone numbers. | M, pricing copy |
| Marketing claims | "Translate chats into 50+ languages on the fly"; "AI Voice Agent"; "AI Workflows". **Not documented in the help center.** | M, pricing copy |

---

## 2. Visitor list (Monitoring) details

**What is documented**
| Field / behaviour | Conf. / source |
|---|---|
| Groups: Unanswered, Served, Active, Idle | H, `H:understanding-visitor-monitoring-and-chat-sessions` |
| **Session rules:** a session ends after **20 min of inactivity**, then a **2-min buffer**; a return inside the buffer is the same session. A visitor = a session, not a unique person. Bots are excluded. | H, same article and `H:how-does-tawkto-define-visitors` |
| A finished chat stays in Monitoring until the buffer ends, then moves to the Inbox. **Transcripts, tickets and email notifications are sent only after the session ends.** | H, same |
| **Details tab** (for a chat or visitor): name, email, phone, social links (all editable); location; device; web and live-chat sessions; OS; IP (shown under name and email); internal notes | H, `H:tips-for-responding-to-multiple-chats…`, `H:creating-and-managing-tabs`, `H:conditions-for-advanced-triggers` |
| **History tab:** past chats with this visitor, or with the whole property | H, `H:creating-and-managing-tabs` |
| **Data the server holds per visitor** (shown by the trigger conditions): IP, hostname, city, country, previous visits, previous chats, current URL, page count, page title, previous page, referrer, search engine, search terms, user agent, browser, platform, time on page, time on site, requesting-chat flag, served flag | H, `H:conditions-for-advanced-triggers` |
| **Sneak peek:** marketing says "See … what they typed before they hit send". The bundle sends the input box text about every 1 s while the visitor types (section 4). | M/H, pricing copy; bundle `messagePreview` |
| **Proactive chat from the list:** "you can still view their activity and **start a chat manually**" | H, `H:restricting-the-chat-widget-by-country` |
| **Custom data shown to agents:** JS API `setAttributes` (key/value), `addEvent(name, metadata)` and `addTags` (at most 10). Contact custom attributes from the pre-chat form. | H, jsapi; `H:using-the-pre-chat-form` |
| **IP tracking switch:** on the personal Profile Page ("Track IP addresses"). A property-level switch is **Unknown**. | H, `H:editing-your-personal-profile-page` |
| **Privacy pushback:** a Shopify reviewer (2026-09-15) called it "spyware" and said tracking continued after uninstall | M, apps.shopify.com/tawk-to/reviews |

**Unknown (to verify in the logged-in teardown):**
- The exact columns and their order (from memory, likely visitor/name, country flag, time online, current page, pages, chats, visits and referrer; **unverified**).
- Whether columns can be configured.
- How the proactive "start chat" button and its first message look.
- Whether the sneak-peek text is shown before the visitor has asked for a chat.
- How many visitors the list can show at once.
- The device and browser icon set.

---

## 3. Agent chat window and visitor widget features

### 3.1 Agent side
| Feature | Details | Conf. / source |
|---|---|---|
| Join / take over | **Join Chat** → confirm; an alias can be picked first. Several human agents can sit in the same chat; the AI leaves when a human joins. | H, `H:how-to-answer-an-incoming-chat` |
| **Whisper** | A "Whisper" mode next to Reply turns the composer orange. Internal messages, kept in history after the chat ends. Doubles as notes ("lead source", "handover"). | H, `H:helping-other-agents-with-whispers` |
| **Transfer** | To an agent or department, **with a note**, cancelable until accepted. The visitor is told. **Only to online agents.** It doesn't close the chat. | H, `H:transferring-a-chat` |
| Invite or collaborate | Multiple agents per chat (join), group chats, direct messages. A separate "invite" button: **Unknown**. | H/Unknown |
| **Shortcuts with "/"** | Type "/" to search shortcuts by title or text; a Shortcuts tab to browse and edit; shortcuts can carry suggested-reply buttons and tag actions. `/ai-…` runs AI commands. | H, `H:tips-for-responding…`, `H:using-ai-base-commands` |
| Smart Reply | A button next to Reply and Whisper; regenerate for another; costs credits. | H, `H:using-smart-reply` |
| Tags | The tag icon on a chat (live or past). A shortcut action can tag automatically, and AI Assist can tag through shortcuts. Inbox and reports filter by tag. | H, `H:tagging-chats-contacts-and-tickets` |
| Ban | 3-dot menu → Ban, with a reason and Ban IP | H, `H:banning-a-visitor` |
| Create ticket | From a live or past chat or an offline message (needs an email) | H, ticketing articles |
| Files | Attach in the composer. WhatsApp channel limits: images 5 MB, documents 100 MB, audio and video 16 MB, plus location and contact cards. | H, the WhatsApp Inbox article |
| Reactions, quote-reply, read ticks | Documented for channel conversations (WhatsApp/Telegram) | H, the channel Inbox articles |
| Calls | Video, Voice or Screen Share icons (paid add-on); the visitor accepts or declines | H, `H:getting-started-with-video-voice-screensharing` |
| Split view | Up to 4 chats side by side. With 3 or more, the tabs move into a dropdown. | H, `H:tips-for-responding…` |
| Side tabs | Details, KB search, Shortcuts, History, plus custom URL, Text, Menu and Chat tabs | H, `H:creating-and-managing-tabs` |
| Agent Alerts | An internal banner at the start of each chat | H, `H:creating-and-managing-agent-alerts` |
| Ratings | The visitor gives thumbs up or down; the JS API reports -1/0/1. Reports show positive, neutral and negative. | H, `H:change-how-the-widget-behaves-on-your-site`, jsapi |
| Transcript | The visitor can request an email transcript (can be disabled). Webhooks carry the full transcript 3 min after the session ends. | H, jsapi `onTranscriptRequest`; `H:creating-and-managing-webhooks` |
| Live translation for agents | Marketing claim ("auto-translate", "50+ languages"); **no help article found** | M |
| Visitor summary for the agent | **Not offered** by name. Only `/ai-summarize` on selected text. | H (absence in docs = M) |

### 3.2 Visitor widget (settings plus what the bundle shows)
| Feature | Details | Conf. / source |
|---|---|---|
| States | Bubble ("min"), open window ("max"), popout, slide; online, away, offline; pre-chat, offline form, consent, "offline submitted" | H, behaviour article; bundle chunks `MinWidget`, `MaxWidget`, `BubbleWidget`, `OfflineSubmitted`, `ConsentForm` |
| Message preview ("sneak peek" for the visitor) | While minimized, the agent's message shows as a preview card with a reply box. It can be turned off separately for desktop and mobile. | H, `H:change-how-the-widget-behaves-on-your-site`; bundle `MessagePreview` |
| Typing both ways | Agent typing shown to the visitor, and the visitor's draft sent to agents; both can be switched off | H, same; bundle `agentIsTyping`, `messagePreview` |
| Estimated wait time | Based on past answer times; can be hidden | H, same |
| Browser-tab title alert, sounds | Both can be switched off | H, same |
| Emoji, file upload, rating, email transcript | Each can be switched off. The bundle allows **5 files per send, 50 MB each**. | H, same; bundle `maxNumberFileUpload`, `maxSizeFileUpload` |
| In-chat forms | Change name, email transcript, restart chat, end chat, lead-capture form (fields set up in a shortcut), suggested-reply buttons, `[option]` survey syntax inside messages | bundle chunks (H); `H:capturing-leads-…` |
| KB inside the widget | Search, featured articles, article view, rating, plus search analytics | bundle endpoints `va.tawk.to/v1/kb/article/{search,get,featured,rating}`, `kb/analytics/*` (H) |
| Agents strip | The widget shows the agent list or avatars | bundle `AgentsList`, `public/v1/agent/list` (H) |
| Attention Grabber | An image near the bubble, with seasonal sets | H, `H:enabling-the-attention-grabber` |
| Mobile | The open window covers the screen. The bundle adds `#max-widget` to the URL so the phone's **Back button closes the chat** instead of leaving the page. A Trustpilot user complains it "covers the entire website" (2025-03-07). | H bundle; M review |
| Inactivity | 10 min without activity → visitor status "away"; 20 min → the socket disconnects and reconnects on the next mouse, touch or key event | H, bundle `activityMonitor` (6e5 / 12e5 ms) |

---

## 4. Widget teardown (public bundle, static reading, no execution)

### 4.1 Load sequence
1. **Customer snippet.** It sets `Tawk_API={}` and `Tawk_LoadStart=new Date()`, then injects an async `<script src="https://embed.tawk.to/<propertyId>/<widgetId>">`. (H, tawk.to's own Next.js loader in the site chunk; the snippet shape is shown on their homepage.)
2. **Loader**, about 1.2 KB, `application/x-javascript`, served through Cloudflare, `cache-control: public, max-age=3600`, ETag = build id.
   - It sets `$_Tawk_AccountKey` and `$_Tawk_WidgetId`.
   - **After `window.load`**, it injects the entry `/_s/v4/app/<build>/js/twk-main.js` as `type="module" crossorigin="anonymous"`.
   - The build is **Vite ES modules** with dynamic `import()` chunks. (H)
3. **Main module.** About 325 KB of Vue 3 with i18next. It wires up services: `emitter`, `i18n`, `socket`, `jsApi`, `tawkWindow`, `widgetSettings`, `chatManager`, `audioPlayer`, `scheduler`, `sessionManager`, `activityMonitor`, `webStorage`, `logger`. About 35 lazy chunks hold the UI parts (MaxWidget 69 KB, MinWidget, BubbleWidget, MessagePreview, the forms, CallWidget, KB search…). (H)
4. **Settings.** `GET https://va.tawk.to/v1/widget-settings?propertyId&widgetId&sv=<cached settingsVersion>` returns the widget config, WebRTC options, schedule (`ws.sch`), language and branding. The settings version is cached in sessionStorage `tawk_sv`, so a repeat load can skip the payload. (H)
5. **Register.** `POST https://va.tawk.to/v1/session/start`, with the stored visitor token sent in an `X-Tawk-Token` header. The body is listed in section 4.3. (H)
   - **Tab lock:** before registering, the tab writes cookie `TawkConnectionTime` every 100 ms while it registers. If another tab registered less than 1 s ago, it waits 1 s, so two tabs don't both register.
   - **Retry:** exponential backoff with jitter and a 90 s hard timeout. After the maximum retries it hides the widget. (H)
6. **Response.** Contains `visitorSocketServer`, `sessionKey`, a token (`tkn`), `pageStatusVersion`, visitor id and chat state (field names as used in the bundle). (H for the names used; the full shape is Unknown)
7. **Socket.** `wss://<visitorSocketServer>/s`, using **socket.io / engine.io with the WebSocket transport only** (no long-poll fallback on this path, although engine.io's polling code is bundled).
   - **Query:** `k`=sessionKey, `cver`=chat version, `pop`=is popout, `asver`=page-status version, `tkn`=token.
   - **Health:** engine.io ping/pong heartbeat.
   - **Reconnect:** up to 5 connect attempts, then the widget hides. (H)
8. **Rendering.** Every widget part renders into its **own iframe**: same-origin, `srcdoc="<html></html>"` or blank, with styles injected (`iframe-styles` chunk). The Vue app itself runs in the host page. **No Shadow DOM** (no `attachShadow` in the bundle). (H)

### 4.2 Transport protocol (socket message names in the bundle)
**Server → widget events:**
- **Typing:** `agentIsTyping`, `agentStopedTyping` (sic).
- **Messages and visitor state:** `visitorMessage`, `visitorChatSeen`, `visitorChatTransfer`, `visitorChatDismiss`, `visitorChatWindowState`, `visitorPopupFocus`, `visitorSound`, `visitorTagsUpdate`, `visitorDataUpdate` (name, email, department, pre-chat submitted), `visitorConversationPresenceUpdate`.
- **Page status:** `pageStatus` (online, away, offline), `pageDisable` (remove the widget), `widgetScheduleUpdate`.
- **Uploads:** `uploadProgress`, `uploadFinished`, `uploadError`.
- **Calls:** `vCallStatus`.
- **Connection:** `chatBubbleClosed`, `remoteDisconnect`, `ready`.

**Widget → server, plain socket messages:**
- **Page and typing:** `nav`, `messagePreview` (the visitor's draft text plus a timestamp).
- **Window state:** `chatWindowState`, `chatBubbleClose`, `notifyWidgetResized`, `visitorPopupFocus`, `visitorSound`.
- **Chat lifecycle:** `visitorRating`, `endChat`, `sendTranscript`, `saveTranscriptEmailForm`, `saveNameChangeForm`.
- **JS API data:** `setAttributes`, `addEvent`, `addTags`, `removeTags`, `fileUploadMessage`.
- **Connection:** `socketStatusUpdate` (active or away), `ping`.

**Widget → server, RPC-style calls** (`send("service", <service>, <route>, payload, ack)`), each with a 35 s callback timeout:

| Service | Routes |
|---|---|
| `visitor-chat` | `/v1/message/visitor`, `/v1/visitor/prechat-form`, `/v1/visitor/offline-form`, `/v1/visitor/messages-seen`, `/v1/visitor/dismiss-preview` |
| `webrtc` | `/v1/vcall/{init,status,reject}/visitor` |
| `table` | `/v1/form/get` |

**HTTP endpoints:**
- **Session:** `va.tawk.to/v1/{widget-settings, session/start, chat/list, client/login, client/logout}`.
- **Forms and tickets:** `v1/ticket/create`, `v1/form/lead-capture/submit`.
- **Knowledge Base:** `v1/kb/*`.
- **Agents:** `public/v1/agent/list`.
- **Logging:** `log`, `log-performance/v3`.
- **Files:** `upload.tawk.to/upload/handle` (get a handle), then a multipart POST to `upload.tawk.to/upload/visitor-chat/visitor?handle=&visitorSessionId=`. The file is then sent as a message attachment.
- **Calls:** `video.tawk.to/v2/call`.
- **Static files:** `tawk.link/…` for avatars and attachments.

(H, all from bundle strings)

**Offline queue:** while disconnected, outgoing messages are stacked and flushed after reconnect. `messagePreview` keeps only the latest value, and sending a message drops the pending preview. (H)

**Echo filtering:** incoming events carry an `origin`, and a tab ignores events it sent itself. This keeps **several open tabs in sync** (e.g. closing the bubble in one tab closes it in all). (H)

### 4.3 What visitor data the widget sends
- **`session/start` body:**
  - `p` (property id), `w` (widget id), `platform` (`mobile` or `desktop`, from the user agent), `tzo` (time-zone offset), `url` (`location.href`, or the top window's URL when framed), `referrer`, `vss` (visitor session state), `user` (JS API `Tawk_API.visitor`: name, email, phone, hash), `consent` (true when consent was given), `wss` (`min` or `max`).
  - Visitor identity: `u` (uuid), `uv` (uuid version) and `uw`, or `uik` (an idempotency key) when there is no uuid. (H)
- **`nav` on every page view:** `{u: href, t: document.title, r: referrer when changed}`.
  - **SPA detection:** the bundle wraps `history.pushState` and `replaceState` and listens to `popstate` and `hashchange`, so single-page apps are tracked without extra code.
  - **Throttle and dedupe:** sent 500 ms after the change, and skipped when the URL equals sessionStorage `previousNav`. (H)
- **Language:** `navigator.language` is **not** read. The widget language comes from settings, and the server presumably uses `Accept-Language` (L). Screen size and `devicePixelRatio` are read (likely for layout; whether they are sent is Unknown).
- **Server-side data:** IP, geolocation, browser and OS are not computed in the widget, so the server must derive them from the request (L, consistent with the trigger conditions).
- **Sneak peek:** on keydown, the bundle starts a 1 s timer and then sends the trimmed draft (`messagePreview`), only if the `showVisitorTyping` setting is on. Enter (not Shift+Enter, desktop only) sends the message. Clearing the box sends an empty preview. (H)

### 4.4 Storage (visitor identity and session)
| Key | Where | Purpose (as read) |
|---|---|---|
| `twk_uuid_<propertyId>` | first-party cookie (localStorage in a hosted page or popout; sessionStorage plus `postMessage` in a popout) | Visitor id as JSON `{uuid, version, isPartial}` |
| `Tawk_<propertyId>` | cookie | Session info, split on `::` or `\|\|` |
| `__tawkuuid` | cookie | Older (deprecated) uuid, still read |
| `twk_idm_key` | cookie | Idempotency key, made inside `navigator.locks.request("idempotency_key")` so tabs that open together create **one** visitor |
| `twk_token`, `twk_token_<propertyId>` | localStorage / sessionStorage | Session token, sent as `X-Tawk-Token` |
| `TawkConnectionTime` | cookie | Cross-tab registration lock (see section 4.1) |
| `tawk_sv`, `tawk_has_register_visitor`, `previousNav` | sessionStorage | Settings version, identified-visitor flag, last URL sent |

Cookies are written with **180-day expiry** (`15552e6` ms) and `SameSite=Lax`. Inside an iframe they use `SameSite=None`. On `file:` pages or in iframes they fall back to localStorage. (H)

### 4.5 Presence, status and schedule
- **Page status** (`online`, `away`, `offline`) is pushed by the server (`pageStatus`), with a version (`asver`) to skip stale updates.
- **The schedule** arrives in the settings and through `widgetScheduleUpdate`, so the widget can flip state live. The scheduler beats agent status (H, docs).
- **Visitor presence:** `socketStatusUpdate` `away` after 10 min idle; disconnect after 20 min. This matches the documented 20-min session end plus the 2-min buffer. (H)
- **"Sleep Mode"** is the dashboard-side counterpart that stops the agent's live feed (H, docs).

### 4.6 Identity verification and SPA
- **Secure mode:** `Tawk_API.visitor = {name, email, hash}`, where `hash = HMAC-SHA256(email, property API key)` is computed on the server. `login({hash, userId, …})` restores past conversations and `logout()` clears them. (H, jsapi)
- **SPA tip:** marketing says "Single-page app? Use `Tawk_API.showWidget()` after each route change" and "Strict CSP? Allow embed.tawk.to in your script-src". (M)

---

## 5. APIs

### 5.1 JavaScript API (developer.tawk.to/jsapi, H)
**Config, set before load:**
- `Tawk_API.autoStart=false`: don't connect until `start()`.
- `Tawk_API.visitor = {name, email, phone (E.164), hash}`.
- `Tawk_API.customStyle = {zIndex}` (the only style option).

**Methods:**

| Group | Methods |
|---|---|
| Connection | `start({showWidget})`, `shutdown()`, `switchWidget({propertyId, widgetId}, cb)` |
| Identity | `login({hash, userId, name, email, phone, …attrs}, cb)`, `logout(cb)` |
| Window | `maximize`, `minimize`, `toggle`, `popup`, `getWindowType`, `showWidget`, `hideWidget`, `toggleVisibility` |
| State | `getStatus`, `isChatMaximized`, `isChatMinimized`, `isChatHidden`, `isChatOngoing`, `isVisitorEngaged` |
| Chat | `endChat` |
| Data | `setAttributes(obj, cb)` (keys `[a-z0-9-]`; name and email need `hash` in secure mode), `setChatInputMessage(text)`, `addEvent(name, meta, cb)`, `addTags([…], cb)` (at most 10 tags), `removeTags` |

**Events:**

| Group | Events |
|---|---|
| Lifecycle | `onLoad`, `onBeforeLoad`, `onStatusChange(status)` |
| Window | `onChatMaximized`, `onChatMinimized`, `onChatHidden` |
| Chat | `onChatStarted`, `onChatEnded` |
| Forms | `onPrechatSubmit(data)`, `onOfflineSubmit({name, email, message, questions})` |
| Messages | `onChatMessageVisitor`, `onChatMessageAgent`, `onChatMessageSystem` |
| Agents | `onAgentJoinChat({name, position, image, id})`, `onAgentLeaveChat({name, id})` |
| Feedback and data | `onChatSatisfaction(-1/0/1)`, `onVisitorNameChanged`, `onFileUpload(link)`, `onTagsUpdated`, `onTranscriptRequest(email)` |

Most events don't fire in the popout window.

### 5.2 REST API
- **Status:** a **private beta**, granted on request through a form that asks "internal or public integration" (H, tawk.to/rest-api-beta-access-request). There is no public reference on developer.tawk.to (H).
- **Shape and scope (third-party guide, M):**
  - RPC-style `https://api.tawk.to/v1/<method>`.
  - Basic-auth API key.
  - Scope: properties and members, chats and stats, tickets, KB, webhooks, tabs.
- **Unknown:** method names, rate limits, write access to messages.

### 5.3 Webhooks (developer.tawk.to/webhooks, H)
**Events and payload fields**

| Event | Fields |
|---|---|
| `chat:start` | Sent on the first visitor or agent message (whispers and triggers don't count). `chatId`, `time`, `domain`, `referrer`, `message{text, type: msg/file/webrtc-call, sender.type}`, `visitor{name, email?, city, country ISO}`, `property{id, name}` |
| `chat:end` | Same fields, without the message |
| `chat:transcript_created` | The full message list `{sender{t: a/v/s, n, id}, type, msg, time, attchs[{type, content.file{url, name, mimeType, size, extension}}]}`, sent about 3 min after the session ends |
| `ticket:create` | `requester{name, email, type}`, `ticket{id, humanId, subject, message}` |

**Delivery**
- **Signature:** `X-Tawk-Signature` = hex HMAC-SHA1 of the raw body, keyed with the webhook secret.
- **Dedupe:** `X-Hook-Event-Id` stays the same on retries.
- **Retries:** for up to 12 h; a reply slower than 30 s counts as a failure.
- **Limit:** 10 webhooks per property.

**Zapier:** the same 4 triggers (`chat_start`, `chat_end`, `chat_transcript_created`, `new_ticket`) and **no actions** (H, zapier.com/apps/tawk-to/integrations).

**Gaps (L):** no events for messages, ratings, a visitor coming online, AI handover or tag changes.

---

## 6. Weak points and where an AI-first product can win

| # | Weak point | Evidence | How BuPulse wins |
|---|---|---|---|
| 1 | **Reliability and real-time bugs** | **Capterra:** 4.6/5 from 344 reviews, but the top complaint is bugs, crashes and connection drops ("chat ends if I switch tabs a few minutes"; "app logs me out"). **Trustpilot** (2.2/5, 108 reviews): "All messages get duplicated 10x in chat (at least at agent's side)" (2026-10-07). | Idempotent message ids, at-least-once delivery with client dedupe, a tested reconnect path, and the 5 s polling fallback (spec §7). |
| 2 | **Missed-chat notifications** | **Shopify** (3.6/5, 89 reviews): "doesn't notify me anymore when a chat comes through" (2018). **Trustpilot:** the mobile Do Not Disturb setting kept turning itself back on and chats were missed (2025-09-04). | The spec's alert ladder (sound, push, email after 2 min, WhatsApp later) and a "no reply in N min" escalation. |
| 3 | **AI is paid, metered per property, and stingy on free** | Hobby gives 100 credits; Auto costs 3 credits a reply, so about 33 replies a month. Smart Reply, Commands and transcription all use credits. Each property is billed separately. A switcher vendor says AI suggestions go nowhere when no agent is online (M, competitor page). | The AI is the default responder, 24/7, on the Gemini free tier. Summary, suggested replies and translation are built in, not upsells. |
| 4 | **Thin roles and supervision** | Only Admin and Agent; no supervisor role, no live "read-only monitor" role, no SLA rules. Transfers only to online agents. | Agent, Supervisor and Departments (spec §3): live read, reassign, stats and ratings. |
| 5 | **No real "summary" or context on open** | Only `/ai-summarize` on selected text; Agent Alerts are static text. | A 2-line need summary plus 3 suggested replies the moment a chat opens (spec §4). Account status for signed-in clients. |
| 6 | **Translation is weak or undocumented** | KB translation is manual. "50+ languages" exists only as a marketing claim. Hired agents are English only. Kinyarwanda support is Unknown. | Live two-way translation for Kinyarwanda, French and Swahili ↔ English (spec §4). |
| 7 | **Pre-chat form kills volume** | Their own doc: enabling it "usually leads to fewer chats". | The owner chose a required form on the public site (§1). Keep it short (4 fields) and measure drop-off. A conversational capture by the AI could be tested later. |
| 8 | **Can't reach visitors once they leave** | Trustpilot: "I can't write a customer when they are offline" (2026-10-07). Offline messages become tickets only with an email. | Email or WhatsApp follow-up, and a ticket opened by the AI at handover (spec §2). |
| 9 | **Branding fee resentment** | "29$ a month to remove one line of text" (Shopify, 2024-11-10). The actual price is $39/mo monthly or $348/yr. | Not relevant to our own support chat; relevant if we sell the Website chat product (`docs/WIDGET.md`). |
| 10 | **Spam, scams and privacy perception** | Trustpilot: spam from foreign IPs (2025-10-22), "supporting scam sites". Shopify: "spyware… tracking after uninstall" (2026-09-15). Bans are IP or cookie only. | Turnstile, rate limits, a clear privacy line and data-retention policy (IP reduced to the country after 30 days, spec §7). |
| 11 | **Mobile widget takes over the page** | "covers the entire website" (Trustpilot, 2025-03-07). | Spec §1: the greeting never covers content on phones; keep the open chat as a sheet that can be dismissed, and copy the Back-button-closes-chat idea. |
| 12 | **Delayed transcripts and webhooks** | Sent only after a 20-min inactivity session end, plus a 2-min buffer and 3 min. | Send the transcript when the chat is ended explicitly or rated. |
| 13 | **Dashboard load from visitor monitoring** | "Sleep Mode" exists to save agent CPU and bandwidth. | Show only visitors with a signal (pricing or sign-up page, signed-in, returning, high score); paginate; use Supabase Realtime presence channels per site. |
| 14 | **Trigger limits** | 20 triggers per property, 10 conditions, 5 actions; type fixed after save. | Our greeting is rule-plus-AI: per-page text and timing (15 s or 30 s), once per visit (spec §1). Nothing to configure for v1. |

---

## 7. What BuPulse should copy, do better, or skip

| Spec § | tawk.to idea | Verdict | Note for BuPulse |
|---|---|---|---|
| §1 Where it shows | Async loader after `window.load`, ES-module chunks, each part in its own iframe | **Copy (idea)** | Keeps our CSS away from host pages (link-in-bio pages). One tiny loader plus lazy chunks. |
| §1 | SPA nav detection by wrapping `pushState`, `replaceState`, `popstate` and `hashchange`; `nav {url, title, referrer}`, debounced 500 ms and deduped | **Copy** | Next.js App Router is a SPA. Without this, "current page" and "pages visited" are wrong. |
| §1 | Mobile Back button closes the open chat (history entry) | **Copy** | Fits "on phones it never covers content". |
| §1 Greeting | Basic and advanced triggers (time on page, page URL, visits, referrer, served or requesting flags) | **Do better** | Spec greeting: per page, once per visit, 15 s or 30 s, closed stays closed. Never show it to a visitor already chatting (copy their "served = false" guard). |
| §1 | Country, domain and platform restriction | Skip (v1) | No need for our own site. |
| §1 | Consent form (GDPR or US two-party) | **Adapt** | Rwanda data-protection law (2021): add a privacy line under the form (spec), and don't set the visitor cookie on client-facing pages until the chat is opened. |
| §2 Who replies | AI leaves when a human joins; AI returns on a new message after the chat closes | **Copy** | Exactly the spec's "AI goes quiet". Add a visible "Human joined" system message. |
| §2 | Scheduler beats agent status; ongoing chats aren't cut off; daylight saving handled | **Copy** | Team hours Mon–Sat 8–20 Kigali (no daylight saving). Show the hours in the widget, and let the AI keep answering outside them (they go offline; we stay AI-online). |
| §2 | Scenarios, Instructions, Business Facts, "info to never state as fact" | **Copy (idea)** | Our guide is the source. Add a "never invent prices or dates" rule and escalate instead. |
| §2 | Escalation shortcuts when the AI can't help | **Do better** | Hand over by itself, then a ticket, then "team opens at …" with email or WhatsApp (spec §2). |
| §3 Support app | Admin and Agent roles only | **Do better** | Agent, Supervisor, Departments; 2FA sign-in; instant lockout (spec §3). |
| §3 | Departments in the pre-chat form, transfer with a note, cancel until accepted | **Copy** | Departments: Sales, Technical help, Billing, Creators. Allow transfer to a department even when nobody in it is online (their gap). |
| §3 | Whisper (orange composer), kept in history | **Copy** | Also lets supervisors coach. |
| §3 | "/" shortcuts with suggested-reply buttons and tag actions | **Copy** | Our shortcuts can come from the guide; AI suggestions sit above them. |
| §3 | Smart Reply and `/ai-*` commands (metered) | **Do better** | Free, automatic on open (summary plus 3 replies). |
| §3 | Side tabs (Details, KB, Shortcuts, History, custom URL) | **Copy** | Details = visitor plus, for signed-in people, business, plan, trial and health (read-only, spec §2). |
| §3 | Split view of up to 4 chats | Later | Desktop app phase. |
| §3 | Aliases (30 personas, "appear larger") | **Skip** | Honesty: real names per agent. |
| §3 Visitors list | Groups Unanswered, Served, Active, Idle; session = 20 min idle + 2-min buffer; sneak peek of the draft text | **Copy (groups, session rules)** | Use the same idle rule for "time on site" so numbers make sense. |
| §3 | Sneak peek of what visitors type before sending | **Copy, with care** | Only after the visitor has opened the chat; mention it in the privacy policy; throttle to 1 s. |
| §3 | Visitor fields (IP, geo, device, pages, referrer, visits, previous chats, search terms) | **Copy, trimmed** | The spec list. Search terms are mostly unavailable today, so skip them. Geo comes from Netlify headers (spec §7). |
| §3 | Sleep Mode for the live feed | **Copy (idea)** | Unsubscribe the presence channel when the agent tab is idle or hidden. |
| §3 Alerts | Sound, desktop alerts, tab-title alert, mobile push, DND | **Copy, plus email after 2 min** | Their DND bug shows why: make the DND state visible and server-side. |
| §3 | Agent Alerts (internal banner per chat) | **Copy** | Cheap: an admin-set banner, e.g. "promo this week". |
| §3 | Contacts CRM, segments, organizations, merge | Partly | The lead goes to Admin → Sales (spec §1). The chat history attaches to the business. No separate CRM. |
| §3 | Ban (reason, cookie or IP) | **Copy** | Also block by email or phone; Turnstile on the first message. |
| §3 | Reporting (volume, missed, first response, duration, satisfaction, offline, KB search terms) | **Copy** | Plus **Knowledge gaps** (spec §4), which they lack. |
| §4 AI extras | Lead Capture Form, Chat Rescuer | **Do better** | Lead score and urgency tags, with hot chats sorted to the top (spec §4). |
| §4 | Live translation (marketing only) | **Do better** | A first-class feature for rw, fr and sw. |
| §5 Inside chat | Files: 5 per send, 50 MB; images and docs | **Adapt** | Spec: 10 MB, screenshots, photos and PDFs, checked and private. |
| §5 | Thumbs rating (-1/0/1), email transcript | **Copy** | Send the transcript on end or rating, not 20+ minutes later. |
| §5 | Voice messages plus AI transcription (paid credits) | **Do better** | Spec: Gemini audio on the free tier; pause it when that runs out. |
| §5 | Video, voice and screen share (paid add-on) | Skip (v1) | "Continue on WhatsApp" covers calls. |
| §5 | KB search inside the widget | Later | Our AI answers from the guide. A "see the guide article" link in AI answers does the same job. |
| §7 Tech | Visitor id cookie (180 days), idempotency key under `navigator.locks`, cross-tab register lock, origin-tagged events for tab sync | **Copy (ideas)** | Prevents duplicate visitors and duplicate leads when several tabs open. Directly answers their "duplicated 10x" bug class. |
| §7 | Stored-settings version (`sv`) so repeat loads skip the payload | **Copy** | One settings JSON with a version. Cache it at the CDN. |
| §7 | Socket.io WebSocket only, 5 reconnects, then hide | **Do better** | Supabase Realtime plus 5 s polling fallback; never hide a chat in progress. Show "reconnecting…". |
| §7 | Webhooks with HMAC, event id, 12 h retries | **Copy** | For the versioned support API (spec §3): sign with HMAC-SHA256 (they use SHA1), send an event id, retry. |
| §7 | JS API (`setAttributes`, `addTags`, `login` with HMAC hash, `onChatStarted`…) | **Copy, small** | Our own pages are first-party. We need `open()`, `setContext({page})`, and identity from the session (no hash). Skip a public JS API in v1. |

---

## Source list
- Help center: `https://help.tawk.to/article/<slug>` for each `H:` slug above. Categories: `https://help.tawk.to/category/<name>`.
- Developer portal: https://developer.tawk.to/jsapi/, https://developer.tawk.to/webhooks/, https://developer.tawk.to/zapier/
- REST beta form: https://www.tawk.to/rest-api-beta-access-request/
- Pricing and add-ons: https://www.tawk.to/pricing/ (strings read from the page payload)
- REST shape (third party): https://rollout.com/integration-guides/tawk.to/api-essentials
- Zapier: https://zapier.com/apps/tawk-to/integrations
- Widget, read statically (scratchpad `tawk/embed/`): `https://embed.tawk.to/521727297ca1334016000005/18nms7gql` → `https://embed.tawk.to/_s/v4/app/6acdb8c93b0/js/twk-main.js` plus its chunks
- Reviews:
  - https://www.trustpilot.com/review/tawk.to
  - https://apps.shopify.com/tawk-to/reviews
  - https://wordpress.org/support/plugin/tawkto-live-chat/reviews/
  - Capterra (https://www.capterra.com/p/167792/tawk-to/reviews/, through the search summary; a direct fetch returned 403)
  - iOS listing: https://apps.apple.com/app/id907458277
