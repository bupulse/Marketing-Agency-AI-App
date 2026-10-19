# Client features

One page per feature of the client dashboard, in the order of the menu. Each page starts with plain steps for the
owner (what you see, how to use it, limits) and ends with **For developers** (files, key functions, database tables,
routes, cron jobs and tests) and **If something goes wrong** (symptom → where to look → usual fix).

Screenshots come from the test business "Nova Phones Kigali", a phone shop on the Business plan, plus Urugo Homes on a
trial and Inzu Fashion waiting for its demo. All names and numbers in them are made up.

| # | Feature | Page URL | File |
|---|---|---|---|
| 1 | Dashboard home | `/dashboard` | [01-dashboard-home.md](01-dashboard-home.md) |
| 2 | Sign-up, onboarding and account states | `/signup`, `/login`, `/welcome`, `/onboarding`, `/book-demo`, `/account/waiting`, `/suspended`, `/invite/[token]` | [02-sign-up-onboarding-and-account-states.md](02-sign-up-onboarding-and-account-states.md) |
| 3 | Knowledge base | `/dashboard/knowledge` (profile, products, campaigns, locations, audience, competitors, faqs, reviews, interview) | [03-knowledge-base.md](03-knowledge-base.md) |
| 4 | Projects and content | `/dashboard/content`, `/dashboard/content/products/[id]`, `/dashboard/content/campaigns/[id]`, `/dashboard/content/general`, `/dashboard/content/settings` (old `/dashboard/projects*` links redirect) | [04-projects-and-content.md](04-projects-and-content.md) |
| 5 | Designs | `/dashboard/designs` | [05-designs.md](05-designs.md) |
| 6 | Gallery and media import | `/dashboard/gallery` | [06-gallery-and-media-import.md](06-gallery-and-media-import.md) |
| 7 | Calendar and publishing | `/dashboard/calendar`, `/posted` | [07-calendar-and-publishing.md](07-calendar-and-publishing.md) |
| 8 | Autopilot | `/dashboard/autopilot` | [08-autopilot.md](08-autopilot.md) |
| 9 | Videos and voiceover | (inside Content and Autopilot), `/screen/[token]` | [09-videos-and-voiceover.md](09-videos-and-voiceover.md) |
| 10 | Leads | `/dashboard/leads`, `/dashboard/leads/[id]` | [10-leads.md](10-leads.md) |
| 11 | Website chat | `/dashboard/widget` (and `widget.js` on the client's website) | [11-website-chat.md](11-website-chat.md) |
| 12 | Analytics | `/dashboard/analytics` | [12-analytics.md](12-analytics.md) |
| 13 | Social connections (Channels) | `/dashboard/connections` | [13-social-connections.md](13-social-connections.md) |
| 14 | Connectors, API and webhooks | `/dashboard/connectors`, `/dashboard/connectors/api`, `/dashboard/connectors/webhooks` | [14-connectors-api-and-webhooks.md](14-connectors-api-and-webhooks.md) |
| 15 | Online stores | `/dashboard/stores`, `/dashboard/stores/[provider]` | [15-online-stores.md](15-online-stores.md) |
| 16 | Domains | `/dashboard/domains` | [16-domains.md](16-domains.md) |
| 17 | Billing, plans and usage | `/dashboard/billing`, `/dashboard/upgrade`, `/dashboard/usage`, `/custom-plan`, `/custom-plan/call` | [17-billing-plans-and-usage.md](17-billing-plans-and-usage.md) |
| 18 | Team, settings and brand | `/dashboard/settings`, `/dashboard/settings/team`, `/dashboard/brand`, `/account/deletion` | [18-team-settings-and-brand.md](18-team-settings-and-brand.md) |
| 23 | Pricing page: plan quiz and Mobile Money steps | `/pricing` | [23-pricing-page-and-plan-quiz.md](23-pricing-page-and-plan-quiz.md) |
| 24 | Instagram and Facebook replies (social inbox) | `/dashboard/connections` (the switch per account), Admin → Services | [24-social-inbox.md](24-social-inbox.md) |
| 25 | Partner programme | `/partners`, `/partners/me/[token]`, Admin → Sales → Partners | [25-partners.md](25-partners.md) |
| 26 | Revenue goal tracker (Admin) | `/admin/revenue`, `/admin/settings#goal` | [26-revenue-goal-tracker.md](26-revenue-goal-tracker.md) |
| 27 | Inbox and contacts | `/dashboard/inbox`, `/dashboard/contacts`, `/dashboard/contacts/[id]` | [27-inbox-and-contacts.md](27-inbox-and-contacts.md) |
| 28 | Automations | `/dashboard/automations`, `/dashboard/automations/[id]` | [28-automations.md](28-automations.md) |

## Which plan has what

What a company may use is decided only by its plan's feature list (`PlanDefinition.featureKeys`, edited in
**Admin → Plans**; the list of features is `lib/features.ts`). At the time of writing:

| Plan | Price (Rwanda) | Features | Monthly limits |
|---|---|---|---|
| Starter | 15,000 RWF a month | AI content, branded designs, calendar and scheduling, media gallery | 60 AI texts, 30 AI images (unused without AI photos), 1 user |
| Business | 50,000 RWF a month (500,000 RWF a year) | Starter + AI photos, website chat and leads, videos, voiceover | 200 AI texts, 100 AI images, 500 chat replies, 120 videos (4 a day, up to 30 s), 3 users |
| Free trial | free, after the demo | the features of the plan the client chose | the TRIAL plan's limits (10 texts, 5 images, 1 sample video, 50 chat replies) |
| Custom plan | agreed per client | any built features and extra blocks | set in the offer |

Everything else (Autopilot, Analytics, Canva, Drive and Dropbox import, store import, webhooks, API access, Managed
by BuPulse) can be added from **Billing → Add features** when it has a price in the client's region, or put in a
custom plan. A feature whose outside service is switched off in **Admin → Services** shows as paused. See
[Billing, plans and usage](17-billing-plans-and-usage.md) and [docs/PLANS.md](../../PLANS.md).

## Roles

| Role | Can do |
|---|---|
| Owner | Everything, including billing, the plan and deleting the company. |
| Admin | Everything except billing and deleting the company: team, channels, connectors, website chat, settings. |
| Member | Make, edit and schedule content and designs, and see leads. No billing, channels or settings. |

The rules are in `lib/team/roles.ts` (`PERMISSIONS`, `can`). Pages a role cannot use show "Ask your company owner".
