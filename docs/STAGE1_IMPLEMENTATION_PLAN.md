# BuPulse — Stage 1 implementation plan

Written 6 October 2026. Project folder: `~/BuPulse`. Design reference: https://claude.ai/artifact/MgCLU5tpYRX8EHMuq77m1z

## 1. Goal of Stage 1

A production-ready BuPulse at **bupulse.com** that any small business owner can sign up to and use:

- a fast, animated, liquid-glass marketing site (no product demo before sign-in)
- sign-up with a 7-day trial (10 text generations, 5 images), then $49 / $99 plans and a done-for-you offer
- a brand profile that BuPulse learns once and uses everywhere
- an AI content studio: captions, video scripts, ad headlines and branded designs
- social accounts connected (Instagram, Facebook, TikTok, LinkedIn, YouTube) and posts created, scheduled, published and managed from BuPulse
- the lead-capturing chat widget for the business's own website
- a connectors hub: Google Drive, Dropbox, Canva, Shopify, WooCommerce, Cloudflare, webhooks and API keys
- our own analytics, cost and revenue tracking, a super-admin console, and a **Jarvis endpoint** with full admin access

**Stage 2 (not in this plan):** ads apps (Meta / Google / TikTok ads), Gmail and email marketing, website generation and hosting on the user's domain, video generation (Veo, Higgsfield), voiceover (ElevenLabs), trend scanning, the automatic "learn what works and improve" loop, Adobe Express editing, native mobile apps.

## 2. Decisions this plan is built on

| Topic | Decision |
|---|---|
| Customers | Every small business (shops, schools, construction, IT, restaurants, real estate, …). Nothing industry-specific in code or copy |
| Stack | Next.js 16 (App Router, TypeScript, Tailwind 4), Prisma 7, Supabase (Postgres, Auth, Storage) |
| Hosting | Cloudflare Workers via OpenNext, domain on Cloudflare DNS, Hyperdrive for the database connection |
| Sign-in | Supabase Auth: email link and Google |
| AI | Provider interfaces in `lib/ai`. Gemini for development, Claude switchable by env. Images: Gemini image model + our own templates |
| Social posting and app connectors | Free first: direct login with BuPulse's own developer apps is the default. Pro users may use their own Composio instead (they pay Composio, not us). BuPulse pays no Composio fees (section 2a) |
| Analytics | Built by us, stored in Supabase (no third-party tracker) |
| Jarvis | Full admin through a private API and an MCP server, every call logged |
| Trial | 7 days, 10 text + 5 images, no card. Product only usable after sign-in |
| CMS for blog/FAQ/testimonials | Sanity free tier (hosted, works on Workers) |
| Design | Liquid glass, light + dark, Geist, Pulse Blue `#2F6BFF` → Pulse Violet `#7B5CFF`, rich motion with fast loading |

## 2a. How users connect their accounts

Every social network and app connection uses one of three methods. Feature code never knows which: it calls our own `SocialProvider` / `ConnectorProvider` interfaces (`lib/social`, `lib/connectors`).

| Method | What the user does | Who can use it | How it works | Cost to BuPulse |
|---|---|---|---|---|
| **Direct** (default) | Clicks "Connect Instagram", logs in on Meta's page. Never sees the words Composio or API | All plans | Our own developer apps talk to Meta / TikTok / LinkedIn / Google / Dropbox / Canva / Shopify directly. BuPulse stores the tokens (encrypted) and refreshes them | $0 (the platform APIs are free) |
| **Bring your own Composio** | Pastes their Composio API key once in Settings → Advanced, then connects accounts inside their own Composio | Pro only | BuPulse calls Composio with the user's key; usage is billed to their Composio account | $0 |

A BuPulse-run Composio account is **not** used, so there is no Composio bill. If one is ever wanted (e.g. for an app we have not built directly), it can be added as a third method behind the same interface.

- One business can mix methods (e.g. Instagram direct, LinkedIn through their own Composio).
- A connection records its method, status, scopes and expiry; a daily job checks health and asks the user to reconnect before tokens expire.
- Switching method = disconnect and reconnect; scheduled posts move with the account.
- The same framework carries Stage 2 connections (Gmail and other email, ads accounts).

## 3. What has to start on day one (long lead times)

These are outside our control and can take weeks, so they start in Phase 0, in parallel with building:

1. **Our own developer apps for each network and app** (all free to register). They power the default direct method, so these reviews decide when each network goes live.
   - Meta (Instagram + Facebook): app review for `instagram_content_publish`, `pages_manage_posts`, `instagram_manage_insights`. Needs business verification, privacy policy, data-deletion URL and a screencast.
   - TikTok: Content Posting API audit. Until approved, posts can only be private/drafts.
   - LinkedIn: Community Management API access for company pages.
   - Google (YouTube): OAuth verification for the upload scope (sensitive scope).
   - Canva, Dropbox, Shopify: app/partner registration.
2. **Business details**: legal entity, address and support email (hello@bupulse.com) for the reviews above.
3. **Email sending**: Supabase's built-in email allows only a few messages per hour. Production needs custom SMTP (Resend free tier) with SPF/DKIM on bupulse.com.
4. **Legal pages**: privacy policy, terms, data deletion. Required by every platform review.

## 4. Phases

Each phase ends with something you can open and test. A phase is accepted by you before the next one that depends on it starts. Phases 4–7 can overlap once Phase 2 is accepted.

```
0 Foundations ─┬─ 1 Marketing site
               └─ 2 App shell + onboarding ─┬─ 3 Billing
                                            ├─ 4 Content studio ─── 5 Social publishing
                                            ├─ 6 Chat widget
                                            └─ 7 Connectors hub
                         (all) ─── 8 Analytics, admin + Jarvis ─── 9 Hardening + launch
```

### Phase 0 — Foundations and production setup

- Push the code to GitHub (`bupulse/Marketing-Agency-AI`), protected `main`, pull requests only.
- CI on every PR: lint, type check, unit tests (Vitest), build, end-to-end smoke tests (Playwright).
- Cloudflare Workers deploy with OpenNext: `staging.bupulse.com` and `bupulse.com`, Hyperdrive in front of Supabase, secrets in Cloudflare.
- Two Supabase projects: staging and production. Migrations applied by CI, never by hand.
- Supabase Storage buckets: `brand` (logos), `media` (photos/videos), `designs` (generated images). Row Level Security on every table and bucket.
- Encryption helper for stored third-party tokens and webhook secrets.
- Error logging to our own `ErrorLog` table (read later by the admin console and Jarvis).
- Developer apps registered and platform reviews (section 3) submitted.
- **Done when:** a pull request deploys to staging automatically, the current sign-in works on `staging.bupulse.com`, and every review in section 3 is submitted or scheduled.

### Phase 1 — Design system and marketing site

- Design tokens, light/dark mode, Geist, glass components (card, button, input, nav, dialog, tabs, toast), motion utilities. Respect "reduce motion".
- Pages from the approved mockup: Home (3D hero, industry ribbons, "whatever you sell", features, how it works, testimonials, FAQ, blog), Pricing, Done-for-you (book-a-call form), Industries, About, Contact (form creates an admin lead), Privacy, Terms, Data deletion.
- Blog, FAQ and testimonials from Sanity.
- Speed: static first paint, 3D hero loaded after the page is usable and lighter on phones. Target: Lighthouse performance ≥ 90 on mobile, LCP < 2 s.
- SEO: metadata, Open Graph images, sitemap, robots, structured data.
- **Done when:** bupulse.com (staging) shows every page in light and dark, passes the speed target and an accessibility check (WCAG AA), and a contact form submission appears in the database.

### Phase 2 — App shell, sign-in and onboarding

- Branded sign-in and sign-up (email link + Google), custom SMTP emails, sign-out, session handling.
- Password sign-in for platform reviewers only (Meta, TikTok and others cannot use email links): a dedicated reviewer account enabled by an admin.
- Guided onboarding (4 steps): business name and industry, what you sell and who to, brand voice (pick + examples), logo and colours (upload; colours suggested from the logo), plus knowledge for the chat widget (hours, area, FAQs).
- App layout with the glass sidebar: Home, Projects, Content, Calendar, Designs, Leads, Connections, Brand, Usage, Billing, Settings.
- Settings: profile, business, brand, team placeholder, delete account (required by Meta).
- Trial banner and usage meters everywhere limits apply.
- **Done when:** a new user signs up, finishes onboarding in under 5 minutes, sees the dashboard with their brand applied, and can delete their account.

### Phase 3 — Billing (Stripe)

- Products: Standard $49/mo, Pro $99/mo, Done-for-you (custom, invoiced).
- Stripe Checkout to upgrade, Customer Portal to manage, webhooks update `Subscription` (plan, status, period) and reset usage each period.
- Paywall at limits and at trial end: clear upgrade screen, nothing lost.
- Receipts, failed-payment handling (past due → limited), cancellation at period end.
- **Done when:** in Stripe test mode a trial user upgrades, usage limits change immediately, a cancelled plan stays active until period end, and a failed payment blocks new generations.

### Phase 4 — AI content studio

- Projects for any business type: product, service, event, offer, listing, project; photos uploaded to Storage.
- Generate caption + hashtags, 30-second video script and 2–3 ad headlines in the brand voice; edit, regenerate, keep versions, copy.
- Branded designs: templates (New arrival, Offer, Event, Just listed, Project done, Quote, Announcement) rendered to PNG with the business's logo, colours and photo; plus "describe an image" with the Gemini image model.
- Per-network variants (length, hashtags, aspect ratio) prepared for Phase 5.
- AI cost ledger: every AI call records provider, model, tokens and estimated cost.
- Small quality check set (20 example businesses) run in CI against the prompts.
- **Done when:** for 5 different kinds of business, a user creates a project and gets usable text and a branded image in their brand, within the trial limits, and every call appears in the cost ledger.

### Phase 5 — Social connections, publishing and post management

- `SocialProvider` interface with two implementations: direct APIs for Meta (Instagram + Facebook), TikTok, LinkedIn and YouTube (default), and the user's own Composio (Pro).
- `Connection` table: business, network, method, external account, Composio connected-account id or encrypted tokens, scopes, status, expiry. Pro users' Composio API keys stored encrypted on the business.
- Connections page: connect/disconnect Instagram (Business/Creator), Facebook Pages, TikTok, LinkedIn (profile and company page), YouTube; the default button logs in directly; "Use my own Composio (Pro)" under Advanced; health status and reconnect prompts; token refresh job for direct connections.
- Composer: choose accounts, per-network preview and validation (Instagram needs media; TikTok and YouTube need video; character limits), attach images/designs/videos.
- Calendar: drafts, scheduled, published, failed; drag to reschedule; time-zone aware.
- Publishing engine: Cloudflare Cron Trigger + Queue picks due posts, publishes through Composio, retries with back-off, stores the post link and id, notifies on failure.
- Post management: list and filter, edit drafts, duplicate, delete (in BuPulse and on the network where supported).
- Results: pull basic metrics (views, likes, comments, shares, saves) into `PostMetrics` daily where the network allows.
- **Done when:** one user connects all five networks, schedules a post to each for the same time, they publish on time (TikTok may be private until its audit passes), and metrics appear the next day; and the same test passes with LinkedIn connected through a test user's own Composio key.

**Additions decided 7 October 2026** (owner wants it as simple as Buffer, publish.buffer.com):
- **Media gallery:** clients upload their own photos, loose or in folders (e.g. one per event). Every post, design and AI image can use them; AI makes new branded images from gallery photos. For clients who want to spend little on AI.
- **Autopilot:**
  - Each week the AI plans and writes the next week's posts from the brand templates, the gallery and the proven-trends sources.
  - **The client chooses:** by default posts arrive as drafts with one-tap "Approve all"; "Post without asking" is a setting.
  - Proven trends come from:
    - a built-in playbook of proven post types per industry;
    - a holiday and local-event calendar per country;
    - learning from which of the client's own posts did best (PostMetrics);
    - Instagram hashtag top media once Meta approves the app.
  - TikTok and Facebook have no official trends API; more sources plug in later behind one interface.
- **Per-network versions:**
  - LinkedIn: a longer business post, or an article.
  - Instagram and Facebook: caption plus image or carousel.
  - TikTok and Reels: a script only until Stage 2 video.
- **Buffer-style connecting:** one Connect button per network.
  - Instagram offers **Professional** (automatic posting through Instagram Login, no Facebook Page needed) or **Personal**.
  - Personal accounts get notification-based posting: a reminder with the caption and media ready, finished by the client in the Instagram app.
- **X/Twitter: later.** It charges per post since 2026 (about 1.5¢, 20¢ with a link).

### Phase 6 — Lead-capturing chat widget

- One-line embed (`<script src="https://bupulse.com/widget.js" data-key="…">`) served from Workers, isolated in its own frame so it never breaks the host site.
- Looks like the business (colours, logo, greeting, position), answers only from the business's knowledge, then asks for name, email/phone and interest.
- Abuse protection: Cloudflare Turnstile, rate limits per site and visitor, allowed domains list.
- Leads inbox: status (new, contacted, won, lost), notes, email notification to the owner, CSV export, webhook event.
- Chat messages counted in usage (new metric per plan).
- **Done when:** the widget is installed on a test site, a visitor's question is answered correctly, their details appear in Leads within seconds, the owner gets an email, and spam attempts are blocked.

**Decided 8 October 2026:**
- **Chat replies per month:** Trial 50, Standard 1,000, Pro 5,000. At the limit the widget keeps collecting contact details without AI answers. Gemini Flash-Lite costs about 0.02¢ per reply.
- **Asking for contact details:** after helping, when the visitor shows interest (price, booking, buying, or after 2–3 messages), and always when the AI can't answer.
- **Language:** replies in the visitor's language; the greeting is in the business's content language.
- **Owner alerts:** an instant email for each new lead, plus a daily summary email. WhatsApp alerts are Stage 2.

### Phase 7 — Connectors hub

- Catalog page with connect/disconnect and status, using the same methods as Phase 5 (`ConnectorProvider`; direct OAuth by default, the user's own Composio for Pro):
  - Google Drive and Dropbox: media picker that imports files into BuPulse.
  - Canva: import designs into the content library.
  - Shopify and WooCommerce: import products as projects (title, price, photos, description), with re-sync.
  - Cloudflare: connect the user's account and list their domains; one-click widget install helper. Site hosting comes in Stage 2.
- Outgoing webhooks: `lead.created`, `content.generated`, `post.published`, `post.failed`, signed with a per-endpoint secret, retried, with a delivery log.
- User API keys (Pro plan): REST API for projects, content, posts and leads; keys hashed, scoped, revocable, rate limited.
- **Done when:** a user imports a product from Shopify and a photo from Drive into one post, a Zapier/Make webhook receives `lead.created`, and an API key can list leads.

**Decided 8 October 2026:**
- **Connectors:** all four groups are in Phase 7: Google Drive and Dropbox, Shopify and WooCommerce, Canva import, and Cloudflare domains.
- **Google Drive:** file picker only (Google Picker with the `drive.file` scope). BuPulse sees only the files the client picks, so no restricted-scope security review is needed.
- **Webhooks and API:** outgoing webhooks are on every plan, including Trial. The REST API with keys is Pro only.
- **Composio:** later. Zapier and Make webhooks cover other apps for now.

### Phase 8 — Analytics, super-admin console and Jarvis endpoint

**Our own analytics**
- First-party tracker (`/api/collect`, small script, no cookies needed for anonymous visits): page views, sessions, referrer, UTM, device, country (from Cloudflare), with bot filtering and hashed IPs.
- Product events: sign-up, onboarding steps, generation, design, post scheduled/published, lead captured, upgrade, cancel.
- Daily roll-ups by a scheduled job: visits, sign-ups, trial → paid conversion, MRR, churn, active users, feature adoption, funnel drop-off.
- Costs: AI (from the ledger), Composio, email, hosting (entered monthly). Revenue from Stripe. Profit per day and month.
- "What's working": best-converting industries, traffic sources and pages; content types and networks with the best engagement; features used by paying vs churned users.

**Super-admin console** (`/admin`, your account only): overview, users and businesses, revenue, costs, funnels, content performance, errors, feature flags, announcements, audit log.

**Jarvis endpoint**
- REST: `https://bupulse.com/api/admin/v1/…` and an MCP server at `https://bupulse.com/api/mcp` so Jarvis can add BuPulse as a connector.
- Auth: a Jarvis API key (stored hashed), sent as a bearer token; optional IP allow-list; key rotation from the admin console.
- Read tools: `get_overview`, `get_metrics(range)`, `get_funnel`, `get_revenue`, `get_costs`, `get_profit`, `list_users`, `get_user`, `get_business`, `list_posts`, `get_top_content`, `get_whats_working`, `get_errors`, `get_audit_log`, `weekly_report`.
- Action tools (full admin): `extend_trial`, `change_plan`, `issue_refund`, `suspend_user`, `restore_user`, `set_feature_flag`, `send_announcement`, `update_plan_limits`, `rerun_failed_post`.
- Safety even with full admin: every call written to the audit log with before/after values; money actions (`issue_refund`, `change_plan` to paid) require an idempotency key; destructive actions require `confirm: true`; Jarvis's own approval rules apply on its side.
- **Done when:** the admin console shows real visits, sign-ups, revenue, costs and profit for staging, and Jarvis, connected through MCP, answers "how did BuPulse do this week and what's working?" and can extend a trial, with the change visible in the audit log.

**Decided 8 October 2026:**
- **Client analytics added to Phase 8:** an "Analytics" page for each business. It shows post reach and engagement per network, the best posts, website-chat leads, and the weekly trend, all from the metrics Phase 5 already collects.
- **Admin access:** only `admin@bupulse.com` (env `ADMIN_EMAILS`), and it always needs a 6-digit code from an authenticator app (TOTP through Supabase MFA, which works with Microsoft Authenticator). Admin pages and actions require the AAL2 session level.
- **Money actions** (refunds, and changing a user to a paid plan): Jarvis and the API can only prepare them as approval requests. They run only after the owner clicks Approve in the admin console. Every other action runs directly and is written to the audit log.
- **Corrections to the text above:** revenue comes from Paddle, not Stripe, and Composio costs are dropped, because Composio comes later.

**Admin console additions, decided 9 October 2026:**
- **Services:** every outside service has a status card: key set or missing, healthy, last error, usage and cost. Each card has a "Test now" button and an on/off switch. When a service is off, the matching features show a friendly "temporarily unavailable" message. Keys stay in the Cloudflare environment and are never shown or edited in the console.
- **Client connections:** admin views of every client's social channels, connectors, webhooks and API keys, and website chat widgets. They show status, errors and usage, with audited force-disconnect, pause, revoke and switch-off actions.
- **More information:**
  - System health: crons, queues, backlog, error rate, database size.
  - AI usage and budget against the $20 cap.
  - A live activity feed.
  - A Client 360 page for each client.

### Phase 9 — Hardening and launch

- Security review: RLS on every table and bucket, auth on every route, token encryption, rate limits, input validation, secrets, OWASP top 10, widget isolation.
- Tests: end-to-end tests for sign-up → onboarding → generate → schedule → publish → lead → upgrade; load test of the widget and publishing queue.
- Reliability: Supabase backups, error alerts to the admin console and Jarvis, a status check endpoint.
- Email deliverability (SPF, DKIM, DMARC on bupulse.com), transactional email templates.
- Launch: production deploy, 5 beta businesses from different industries, fix list, then public launch. BuPulse set up as an organisation in Jarvis.
- **Done when:** the security review has no open serious issues, every end-to-end test passes on production, and 5 beta businesses have each published at least one post and captured or tested a lead.

## 5. Agent teams

Every phase is built the same way: **a lead (Opus)** plans the phase into tasks, gives each builder a clear part with the files they own, and merges; **builders (Sonnet)** each work in their own git worktree on one part; **a test writer** writes the phase's done-when test; **a separate reviewer** checks security and correctness before you see it. Each phase ends with a handover note in `docs/handovers/`.

| Phase | Builders | Also |
|---|---|---|
| 0 Foundations | DevOps (CI, Cloudflare, Hyperdrive), Supabase (projects, storage, RLS, encryption) | Platform-review helper (prepares review texts, screencast scripts) |
| 1 Marketing site | Design-system engineer, page builder ×2, motion/3D engineer, CMS + SEO engineer | Accessibility + speed reviewer |
| 2 App shell | Auth + email engineer, onboarding engineer, app-shell/UI engineer | UX copy writer |
| 3 Billing | Stripe engineer, paywall/UI engineer | Billing test writer |
| 4 Content studio | AI engineer (prompts, providers, cost ledger), design-templates engineer, studio UI engineer | Prompt quality checker |
| 5 Social publishing | direct-API engineer ×2 (Meta; TikTok/LinkedIn/YouTube), Composio own-key engineer, scheduler/queue engineer, composer + calendar UI engineer | Publishing test writer, security reviewer (token storage) |
| 6 Chat widget | Widget engineer, lead inbox engineer | Security reviewer (abuse, isolation) |
| 7 Connectors | Direct connectors engineer (Drive, Dropbox, Canva, Shopify, WooCommerce, Cloudflare), webhooks + public API engineer, catalog UI engineer | Security reviewer |
| 8 Analytics + Jarvis | Data engineer (tracker, roll-ups), admin console engineer, admin API + MCP engineer | Security reviewer |
| 9 Launch | Security reviewer, end-to-end + load test writers, docs writer | Release checklist owner |

Rules for every agent: read this plan and `AGENTS.md` first (Next.js 16 has breaking changes: read `node_modules/next/dist/docs/`); never put secrets in code or client bundles; every new table gets RLS; every user-facing string industry-neutral; no work merged without the phase's tests passing.

## 6. Running costs (monthly, Stage 1)

| Item | Cost |
|---|---|
| Cloudflare Workers Paid (needed: app is larger than the free 3 MB limit) | $5 |
| Supabase | Free while building; Pro $25 at launch (backups, no pausing) |
| Composio | $0 (not used by BuPulse; Pro users may bring their own) |
| Email (Resend) | Free up to 3,000/month |
| Sanity | Free |
| Gemini API | Free tier for development; paid per use in production |
| Stripe | 2.9% + 30¢ per payment |
| Domain, mailbox | ~$1 + $7 |

About **$13/month while building, ~$40/month after launch** before AI usage, within the $50 budget. Supabase Pro can wait until the first paying customers.

## 7. Risks

- **Platform reviews decide the launch date.** Meta, TikTok and Google reviews can take 2–6 weeks and can be rejected. Mitigation: submit in Phase 0; launch with networks as they are approved.
- **Building every connection ourselves is more work than Composio** (OAuth, token refresh, API changes per platform). Mitigation: one shared provider test suite; the direct-API engineers own one platform family each.
- **YouTube uploads** are limited to 100 per day per project (own quota bucket since June 2026) and stay private until the YouTube API audit passes. Mitigation: submit the audit in Phase 0; queue uploads. Details in `docs/PLATFORM_APPS.md`.
- **TikTok** posts are private-only until its Direct Post audit passes. Mitigation: launch with "send to TikTok drafts", switch on direct posting after the audit.
- **Direct tokens are ours to protect.** Encrypted at rest, never sent to the browser, refreshed by a job, revoked on disconnect and account deletion.
- **Next.js 16 on Cloudflare Workers** is newer than on Vercel. Mitigation: deploy to staging from day one; if a blocker appears, Vercel Pro is the fallback.
- **AI cost per trial user**: limits and the cost ledger keep this visible; Jarvis watches profit daily.
- **$9k profit goal by early January**: Stage 1 must reach paying users by mid-November to leave time to sell. Phases 1–6 are the minimum to sell; 7–8 can follow right after launch if needed.
