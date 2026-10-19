# ManyChat: full walkthrough (competitor teardown)

Written 19 October 2026 by the bizdev agent. ManyChat (manychat.com) is the market leader for **automatic replies to
comments and messages** on Instagram, WhatsApp, TikTok, Messenger and Telegram. This page explains what it sells, how the
product is built, how it makes money and what BuPulse should learn from it.

## How this was done (and the limits)

- Tool: **REA** (reverse-engineering tool) pointed at a throwaway Chrome window with an empty profile.
  REA read 8 public pages (home, pricing, AI, Instagram, WhatsApp, agencies, affiliate, integrations) and analysed the
  JavaScript of the web app's public sign-up screens (419 code files). REA reads code; it does not run it.
- **No account was created, no form was filled, nothing was sent.** I stopped at the "Where would you like to start?"
  screen, because the next click creates an account through Instagram/Facebook login. So the inside of the app is known
  from its code (screen names, module names), not from using it.
- Headless (hidden) Chrome was blocked by Cloudflare's bot check. I did not try to get around it; a normal visible
  Chrome window loaded the site without any challenge.
- Labels used below: **Seen** = read on their site or in their code today. **Derived** = worked out from seen numbers.
  **Guess** = my estimate. **Outside source** = web search (listed at the end).

REA evidence IDs (for re-checking): homepage bundle `ev_d3ca58d9…a585a`, sign-up app bundle `ev_52b746da…b6bb`,
targets list `ev_b04bee3f…8878`.

## 1. The company in numbers

| Fact | Value | Label |
| --- | --- | --- |
| Customers | "1M+ creators, marketers & brands" (site); ~1.5M in 170 countries (April 2025 press) | Seen / Outside source |
| Funding | $140M round led by Summit Partners, April 2025; ~$163M total | Outside source |
| Profit | "near break-even" per its CEO in 2025 | Outside source |
| Revenue | ~$35M a year (a data directory estimate, not audited) | Outside source, weak |
| Official badges | Meta Business Partner, TikTok Marketing Partner, G2 rating | Seen |
| Languages | English, Spanish, Portuguese only (no French, no Kinyarwanda) | Seen |

## 2. What it sells: one sentence

"Turn comments into conversations that sell": when someone comments a word (for example **PRICE** or **GLOW**) under a
post, follows the account, mentions it in a Story, or sends a DM, ManyChat replies by itself in the DMs, sends the link
or price, asks for an email or phone number, tags the person as a lead and follows up later.

Their headline use cases (seen on the site): say hi to new followers, welcome messages, automated FAQs, **comment → DM
with a link and capture email/phone**, giveaways, lead magnets, sales conversations, booking calls, Meta **click-to-DM
ads**, follow-ups, out-of-hours replies, broadcasts.

Their pain-point marketing (seen in the footer "Problems" menu): *Can't keep up · Viral but broke · Wrong link, wrong
time · Can't log off · Renting your audience · Drowning in comments.*

## 3. Prices (seen on manychat.com/pricing today)

The page shows **yearly-billing prices by default** ("$168 billed annually (18% off)"). The monthly prices are behind a
toggle; I derived them from the discounts and they match outside sources.

| Plan | Yearly (per month) | Monthly (derived) | Active contacts included | Users | Main extras |
| --- | --- | --- | --- | --- | --- |
| Free | $0 | $0 | 25 | 1 | 2 channels, max 4 live automations, ManyChat branding, self-help support |
| Essential | $14 | ~$17 | 250 | 2 | unlimited automations, inbox reminders, email support, no branding |
| Pro | $29 | ~$39 | 2,500 | 3 | 3 channels, broadcasts, **AI**, inbox labels and rules |
| Business | $69 | ~$99 | 7,500 | 5 | all channels, shared team inbox with assignments, priority support |
| Advanced | $139 | ~$199 | 25,000 | 10 | top tier; there is no "contact sales" plan |

- **Billing unit = "Active Contact"**: one real person who messaged or was messaged that month, however many messages.
- **Overage** (seen): extra contacts cost $0.10 (Essential), $0.05 (Pro), $0.025 (Business), $0.004 (Advanced) each,
  a bit less on yearly plans. Automations never switch off; you can set an overage cap, you get warnings by email and in
  the app, and **overage is forgiven if you upgrade in the same month**.
- **Trial**: Free plan needs no card. Essential or Pro can be tried free for **14 days**. 30-day refund on request.
- **Payment**: cards only (Visa, Mastercard, Amex, Discover) through Stripe. Prices depend on the billing country; tax extra.
- **Email**: 10k / 30k / 100k emails a month on the upper plans (exact plan mapping not visible without clicking).
- **"Pick your plan in 30 seconds"**: a short quiz on the pricing page ("Where do people find you?" → goals → plan).
- In Rwandan money (guess, at about 1,450 RWF per dollar; check today's rate): Essential ~25,000 RWF a month, Pro
  ~57,000 RWF a month, Business ~144,000 RWF a month, paid by card in dollars.

**Out-of-date page:** the AI page still says "AI only available as add-on to Manychat Pro, $29/month", while the new
pricing cards list AI inside Pro, Business and Advanced (5-tier pricing started 2 March 2026 per outside sources).

### WhatsApp costs extra (seen on /product/whatsapp)

- Meta's per-conversation fees are paid on top, from a prepaid **"Manychat Wallet"** loaded in Settings.
- You need a **separate phone number**; once connected, chats no longer appear in the WhatsApp Business phone app,
  only in ManyChat's Live Chat. Sending first (marketing) messages needs Facebook Business verification.
- The page says WhatsApp is Pro-only and "first 1,000 conversations a month are free". That text predates Meta's 2025
  switch to per-message pricing (my knowledge), so treat it as possibly stale.

## 4. Inside the app: every module (from its code)

The app (app.manychat.com) is one big React program; its code lives on their CDN `mccdn.me` (release folder `1928`).
REA listed **172 screen routes** and **379 module names**. Grouped into plain areas:

| Area | Screens / modules seen in the code | What it does (derived) |
| --- | --- | --- |
| Sign-up & onboarding | `signin`, `signup`, `signup/oneTap`, `auth/magic`, `registration/:section/:channel`, `questionnaire`, `selectChannel`, `profile/addIgAccount` / `addWaAccount` / `addTiktokAccount` / `addTgAccount`, `telegramAuth`, `facebookAuth`, `trial`, `welcome` | Sign up by logging in with the channel itself (Instagram/Facebook, TikTok, Telegram QR, Google One Tap, magic link), then a questionnaire |
| Automation building | `flows`, `flow/:flow_id/:mode`, `easy-builder-wizard`, `quick-automations-wizard`, `automation/keywords`, `rules`, `triggerRules`, `sequence`, `system-keywords`, `FAQ`, `iceBreakers`, `storyMention`, `followReply`, `DelayPicker`, `FormulaInput` (mathjs), `VariableEditor`, `SmartLinkEditor`, `TikTokLinkEditor` | Drag-and-drop **Flow Builder** on a canvas (PixiJS + d3-zoom), a guided wizard for beginners, keyword and comment triggers, drip sequences, conditions and formulas |
| Templates | `templates`, `template/:hash`, `installedTemplates`, `importSharedFlow/:share_hash`, `packagedUseCase` | Ready-made automations; flows can be shared by link and cloned (agencies reuse them per client) |
| Phone preview | `mccdn.me/simulator`, `PhonePreviewKit`, `flowPlayerEmbed` | Shows how the chat looks on a phone before going live |
| Inbox | `chat/:thread_user_id`, `LiveChat`, `chat/analytics`, `AutoAssignmentTypes`, `threadsActions` | Live chat for a human to take over, assignment to teammates, chat stats; real-time updates over websockets (Centrifugo) |
| Contacts (CRM) | `subscribers/:user_id`, `customer_segments`, `smartSegments`, `tags`, `tagsFolder`, `userFields`, `globalFields`, `merge`, `contactMerge`, `bulkActions`, CSV (`papaparse`) | Every person who wrote becomes a contact with tags, custom fields, segments; duplicates can be merged |
| Broadcasts & messages | `posting`, `scheduled`, `drafts`, `history`, `whatsapp/messageTemplates`, `messenger/utilityTemplates`, `marketing-message-templates-analytics`, `recurring-notification-topics`, `quickCampaign` | Send a message to a segment now or later; manage WhatsApp/Messenger templates Meta must approve |
| Email & SMS | `emailBuilderActions`, `emailHelpers`, `smsInterfaces` | A built-in email designer and SMS sending |
| AI | `ai`, `ai-step-automation`, `aiIntents`, `skills`, `training`, `playground`, `suggested-questions` | AI replies trained on your info (up to 250k characters), AI step inside a flow with a goal, intent recognition, a text improver, a flow-building assistant, a test playground |
| Growth tools | `growth-tools/widget`, `Widget`, `qrcode.react`, `ref links` | Website widgets, QR codes and links that open a chat |
| Ads | `ads`, `ads/new/:ad_account_id`, `account/…/campaign/…/adset/…/ad/:ad_id`, `pixel`, `ConversionsApiStatus` | Create Meta click-to-DM ads from inside ManyChat; send conversions back to Meta |
| Analytics | `analytics`, `insights`, `dashboard`, `recommendations`, `stats`, `chart.js` | Clicks, how many people entered an automation, completion rate, suggestions |
| Integrations & apps | `integration`, `applications`, `apps/:app_id`, `apps/:app_hash/install` | Built-in: Google Sheets, HubSpot, Klaviyo, Mailchimp, ActiveCampaign, Kit, Flodesk, Hotmart, Zapier, Make, plus ChatGPT/Claude/DeepSeek and a public API; an app marketplace |
| Team & agencies | `agency`, `userRoles`, `invitation/:hash`, `cms` | One login with a separate workspace per client, roles for staff and clients |
| Money | `billing`, `upgradeToPro`, `UpgradeModal`, `wallet`, `cardVerification`, `Confirm3DS`, `eMandateSlice`, `taxForm`, `PaymentCurrencies` | Stripe card checkout with 3-D Secure, India's e-mandate, local currencies, the WhatsApp wallet, upgrade pop-ups everywhere |
| Safety | `compliance-monitoring`, `banInfo`, `TurnstileCaptcha` | Watches for rule breaks that could get a Meta account blocked; captcha against bots |

The server API is shaped like `/{accountID}/{module}/{action}` (for example `/:accountID/contactMerge/compare`). Most API
addresses are built at run time, so REA could not list them all (**unknown**). I did not call any of them.

## 5. The sign-up funnel (observed live)

1. Website: "GET STARTED" everywhere, "Start your free trial — no credit card required", 3 steps: *Sign up free →
   Connect your channels → Go live in minutes*.
2. `app.manychat.com/signin` → with no login it sends you to **Sign Up** → **"Where would you like to start?"**
   (Instagram, TikTok, WhatsApp, Facebook Messenger, Telegram). *(screenshot taken)*
3. There is **no email/password form**: you create the account by logging in with the channel. The channel is
   connected in the same step, so a new user is "live-ready" seconds after sign-up.
4. Then a questionnaire (`profile/questionnaire`) and the template/wizard path (Quick Automations) to reach a first
   working automation fast.
5. Upgrade prompts: a large `UpgradeModal` module, "Pro" labels on locked features, a `goProExperimentHandlers` module
   (they A/B test the upgrade push), lifecycle messages through Braze.

## 6. How they get customers

- **Affiliate programme** (seen on /affiliate): run on PartnerStack. A referral counts when the person **pays within 90
  days**. Commission for the first 12 months: **30%** (0–30 paid sign-ups), **40%** (31–200), **50%** (201+). Paid
  monthly on the 13th. Top partners get 100% revenue share, co-branded landing pages, early access, a ready-made content
  kit. Names shown include Jenna Kutcher, Amy Porterfield, Russell Brunson, School of Bots.
- **Agencies**: a "Hire an agency" directory (`/agency/listing`) and an agency product page (workspaces per client,
  clone flows, client reports, Meta ads to DMs).
- **Creator social proof everywhere**: each quote has a follower count and a money result ("$135,000 from 2 posts",
  "200 email sign-ups in a single day", "2K leads from a single lead magnet").
- **Content**: blog, how-to guides, video course, webinars, YouTube, a "Chronically online" series, chatbot examples,
  success stories, a community.
- **Tracking stack on the marketing site** (seen in storage keys and scripts): Google tag served from their own domain
  (`/gtg/`), Google Ads click IDs, the TikTok pixel, their own visit pixel `/analytics/png` and referrer script
  `extvisit.js`, Usercentrics cookie consent, probably Microsoft Clarity (`_cltk`). In the app: PostHog (product
  analytics and feature flags), Braze (in-app and email nudges), Hotjar, Sentry (errors).

## 7. Tech stack (seen in code)

- **Marketing site**: Next.js (REA high-confidence fingerprint), behind Cloudflare.
- **App**: React single-page app built with Vite (Rolldown), Redux Toolkit, React Router, XState (state machines),
  react-hook-form + zod (forms), PixiJS v8 and d3 (flow canvas), react-dnd (drag and drop), chart.js, mathjs, emoji-mart,
  DOMPurify, axios, Centrifugo websockets (live inbox), Stripe, Facebook SDK, Telegram login, Cloudflare Turnstile.

## 8. Where ManyChat is weak for a Rwandan small business

1. **Card-only, in dollars.** Most Rwandan small businesses pay with MoMo. ManyChat has no Mobile Money.
2. **Price.** Pro is ~$39 a month on monthly billing (~57,000 RWF, guess), and WhatsApp messages cost extra from a prepaid
   wallet.
3. **WhatsApp is hard**: a new number, chats leave the WhatsApp Business phone app, Business verification for outbound.
4. **Language**: English/Spanish/Portuguese. No Kinyarwanda, no French.
5. **It only answers.** It does not make the posts, photos or videos. Its customers still need content for comments to
   come in. That is exactly what BuPulse does.
6. **Self-serve, no local help.** Rwandan owners usually want someone to set it up with them (BuPulse's demo-first trial
   fits that better).

## 9. What BuPulse should take from this (ranked by value)

| # | Idea | Why it matters for the 9M RWF goal | Effort |
| --- | --- | --- | --- |
| 1 | **Comment-to-DM and auto-reply for Instagram** ("comment PRICE, get the price in DM"), sold as a BuPulse add-on | Rwandan Instagram sellers already write "DM for price"; this is ManyChat's #1 selling feature, and nobody local offers it with MoMo billing. Turns BuPulse from "posts" into "posts + sales". | Large: needs Meta app review for Instagram messaging/comments (see `docs/META_APP_REVIEW.md`) |
| 2 | **Affiliate/partner programme paid in MoMo**: ManyChat's tiered model (more referrals, higher %), but for agencies, co-working spaces and MoMo agents | Cheapest way to get many clients without ads | Medium |
| 3 | **"Pick your plan in 30 seconds" quiz** on the pricing page | Helps owners who don't know which plan they need; feeds the demo booking | Small |
| 4 | **Proof with numbers** on the landing page (followers, sales, leads per client) once the first clients have results | ManyChat's whole site sells on it | Small (needs real client results first) |
| 5 | **Soft limits, never a hard stop**: warn as the limit nears and forgive extra use when the client upgrades that month | Keeps clients happy and pushes upgrades | Small to medium |
| 6 | **Agency workspaces + clone a setup to a new client** | Agencies resell BuPulse to many shops | Medium |
| 7 | **Phone preview** of a post or chat before it goes live | Builds trust for non-technical owners | Small |

Positioning line to test (guess): *"BuPulse makes your posts and answers your customers. Pay with MoMo, in Kinyarwanda."*

## 10. BuPulse vs ManyChat (checked against BuPulse's code, 19 Oct 2026)

They do different jobs. **BuPulse works before the post** (writes it, designs it, publishes it). **ManyChat works after
the post** (answers the comments and DMs and turns them into sales). They overlap only in AI replies and the leads list.

| Area | ManyChat | BuPulse today | Better for a Rwandan shop |
| --- | --- | --- | --- |
| Making posts (text, designs, AI photos, video, voice, weekly Autopilot) | None | Full set (`lib/features.ts`, all built) | **BuPulse** |
| Publishing to Instagram, Facebook, LinkedIn, TikTok, YouTube | No (it only messages) | Yes (direct, or through BuPulse-Socials on Composio) | **BuPulse** |
| Replying to Instagram/Facebook comments and DMs | Its core product | **None**: BuPulse only publishes and reads like/comment counts (`lib/social/providers/*`, `lib/social/composio/networks.ts`) | **ManyChat** |
| WhatsApp automation | Yes (extra fees, new number) | Only lead alerts to the owner, built but switched off | **ManyChat** |
| AI replies | On Instagram, WhatsApp, TikTok, Messenger | On the business's website (website chat), from the knowledge base | ManyChat (where the customers are) |
| Leads list | Contacts with tags, segments, broadcasts | Leads page with statuses, notes, call/WhatsApp buttons, CSV, phone alerts | Even (ManyChat deeper, BuPulse simpler) |
| Sign-up to first result | 1 step (log in with Instagram), live in minutes | 3-step form, email link, 4-step brand set-up, book a demo, wait for the trial to be started | **ManyChat** |
| Free use | Free plan forever + 14-day trial | No free plan; 3-day trial after a demo | ManyChat |
| Paying | Card in USD only | MoMo/Airtel in RWF or card | **BuPulse** |
| Price for a small business | Pro ~$39/month monthly (~57,000 RWF, guess) + WhatsApp fees | Starter 15,000, Business 50,000 RWF | **BuPulse** |
| Language | EN/ES/PT | Content in Kinyarwanda included | **BuPulse** |
| Human help | Self-serve; agencies directory | Demo, custom plans, "Managed by BuPulse" | **BuPulse** |
| Referral / partners | 30–50% for 12 months, PartnerStack | Sales-staff referral links only (`lib/sales/referral.ts`), no outside partners | ManyChat |
| Proof on the site | Creator quotes with numbers everywhere | None yet (pre-launch) | ManyChat |

**Biggest gaps for BuPulse:** (1) no replies on social, where Rwandan customers actually ask "how much?"; (2) slow
time to first result. **Biggest strengths:** content creation, MoMo and RWF, Kinyarwanda, and human set-up.

**Reuse note:** the website chat already answers from the knowledge base and saves leads. Instagram/Facebook comment and
DM replies could reuse that same engine and the Leads page; the new part is receiving comments/DMs (Meta permissions
`instagram_manage_comments` / `instagram_business_manage_messages`, or Composio triggers if they exist: **to check**).

## Open questions (not answered by this teardown)

- Real conversion rates (sign-up → paid) and churn: private. Unknown.
- How their AI is built (which model, prompt, limits) beyond what the site says: unknown.
- Whether ManyChat has paying customers in Rwanda: no public data found.
- Exact list of server API calls: mostly built at run time, unknown.

## Sources

- ManyChat public pages read with REA on 19 Oct 2026: manychat.com, /pricing, /product/ai, /product/instagram,
  /product/whatsapp, /product/for-agencies, /affiliate/, /integrations, app.manychat.com sign-in / sign-up screens.
- Funding and users: [Summit Partners announcement](https://www.summitpartners.com/news/manychat-raises-140m-to-fuel-the-future-of-ai-driven-customer-engagement-on-social-and-messaging-platforms),
  [TechCrunch, 22 Apr 2025](https://techcrunch.com/2025/04/22/manychat-taps-140m-to-boost-its-business-messaging-platform-with-ai),
  [CB Insights](https://www.cbinsights.com/company/manychat/financials), revenue estimate from [Bitscale directory](https://bitscale.ai/directory/manychat) (weak).
- March 2026 plan change and monthly prices: [eesel.ai](https://www.eesel.ai/blog/manychat-pricing),
  [BotPenguin](https://botpenguin.com/blogs/manychat-pricing), [Featurebase review](https://www.featurebase.app/blog/manychat-review).
- Feature reviews: [Chatimize 6-year review](https://chatimize.com/reviews/manychat/).
- African market context: [TechCabal on WhatsApp chatbots, Apr 2026](https://techcabal.com/2026/04/21/whatsapp-chatbots/),
  [Streamline Feed (Kenya)](https://streamlinefeed.co.ke/news/how-to-build-automated-instagram-sales-funnels-with-manychat).
