# The route to 9,000,000 RWF a month (month 3 to 4 after launch)

Written 19 October 2026 by the bizdev "sales" agent. Builds on `docs/RWANDA_LAUNCH_PLAN.md` (section 6),
`docs/bizdev/competitor-manychat.md` and `docs/bizdev/manychat-parity-plan.md`, and on what the code sells today
(`lib/plans.ts`, `lib/features.ts`, `lib/offers/shared.ts`, the migrations of 14 October 2026).

**Labels.** Every number has a source in the list at the end ([S1], [S2] ...), or is marked **(guess)**. Guesses are
there to be replaced by our own numbers from Admin after the first weeks. Money is per month unless written otherwise.
1 USD is taken as **1,470 RWF** [S7] (Admin -> Settings still uses 1,450; see "Decisions for the owner").

## 1. The answer on one page

- **Who buys:** small businesses in Kigali that already sell on Instagram, WhatsApp and TikTok and post by hand:
  boutiques and fashion, beauty and salons, restaurants and cafés, real estate agents, phone and electronics shops,
  hotels and guest houses, gyms, schools and training centres, event organisers.
- **What they buy:** Business (50,000 RWF) is the main plan. Starter (15,000 RWF) is the door in. The money that
  makes the goal reachable comes from **Custom plans and "Managed by BuPulse"** (100,000 to 250,000 RWF).
- **How many:** about **156 paying clients** at month 4: 60 Starter, 60 Business (20 of them with the new
  "Social replies" add-on), 15 Custom, 21 Managed. That is **9.05M RWF a month** (section 4).
- **How they come:** in-person demos by the owner and 2 to 3 commission-paid sales agents (about half of new clients),
  outside partners paid a commission (agencies, co-working spaces, MoMo agents, happy clients), daily short videos in
  Kinyarwanda on TikTok, Instagram and WhatsApp Status, and free "AI for your business" workshops with business
  associations.
- **Pace:** about 30 new paying clients in month 1, 40 in month 2, 45 in month 3 and 50 in month 4, with monthly churn
  kept near 6% **(guess)**. That needs **25 to 40 demos a week**.
- **Honest view:** 9M a month by month 4 is a stretch. 4M to 6M is a strong result for a first market
  (`docs/RWANDA_LAUNCH_PLAN.md`, section 6). What decides it is the number of demos held each week and the Managed
  clients, not new features.

## 2. Who buys: sectors, sizes and places

### The market in numbers

| Fact | Number | Source |
| --- | --- | --- |
| Enterprises in Rwanda (2023 census) | 261,549 | [S1] |
| of which micro (1 to 3 workers) | 241,179 (about 92%) | [S1] |
| of which small (4 to 30 workers) | 16,730 (about 6%) | [S1] |
| of which medium (31 to 100 workers) | 3,103 | [S1] |
| Wholesale and retail trade, share of establishments | 53.5% | [S2] |
| Accommodation and food services, share of establishments | 23.0% | [S2] |
| Kigali's three districts, share of establishments | about 24% (Gasabo 9.3%, Nyarugenge 8.4%, Kicukiro 6.3%) | [S2] |
| Hotels and other accommodation, whole country (2024) | 1,460 (Gasabo 277, Kicukiro 167) | [S3] |
| Internet users (end of 2025) | 5.01 million (34.2%) | [S4] |
| Social media user identities (October 2025) | 1.35 million | [S4] |
| Instagram audience (September 2026) | about 737,000, up from 606,000 a year earlier | [S5] |
| Facebook audience (2026) | about 2.2 million | [S5] |
| MTN MoMo monthly active users (2025) | 6.2 million | [S6] |
| Active MoMo merchants (Q3 2025) | 578,000 | [S6] |

### Who to aim at first

The buyer is a business that **already spends time or money on social media** and can pay 15,000 to 50,000 RWF a
month. Micro shops with no Instagram or WhatsApp catalogue are not the first target.

**Size:** small enterprises (4 to 30 workers, about 16,700 in Rwanda [S1]) and the top of the micro ones (a shop with
an active Instagram page). About a quarter of all establishments are in Kigali [S2], so Kigali's share of small
enterprises is roughly **4,000 businesses (guess: 24% of 16,730)**. 156 paying clients is **about 4% of them**: hard
but possible, and it leaves the micro segment and the other cities as growth room.

**Places, in order:** Kigali (Nyarugenge town centre and Nyabugogo for shops; Kimihurura, Kacyiru and Kiyovu for
restaurants, real estate and services; Remera and Kicukiro for salons and gyms), then Musanze and Rubavu, the next
biggest districts by number of establishments [S2] and the tourism towns for hotels.

| Priority | Sector | Why they buy | Best plan | Size of the pool |
| --- | --- | --- | --- | --- |
| 1 | Boutiques, fashion, shoes, cosmetics | Sell on Instagram every day, need many product posts and short videos | Business (videos from their product photos), Starter for the smallest | Trade is 53.5% of establishments [S2] |
| 1 | Real estate agents and developers | Every listing needs posts, photos and a video; buyers ask "how much?" in comments | Business + Social replies, Custom with website chat | Many agents work in WhatsApp groups (guess) |
| 1 | Restaurants, cafés, bars | Menus, daily specials, events; weekends and month-end pay days | Business | Accommodation and food services are 23.0% [S2] |
| 2 | Salons, barbers, spas, gyms | Before/after photos, offers, bookings in DMs | Starter or Business | Large, mostly micro (guess) |
| 2 | Phone and electronics shops | New stock every week, prices asked in comments | Business + Social replies | Visible in Kigali town centre (guess) |
| 2 | Hotels, guest houses, tour operators | Bookings from tourists, content in English and French | Custom, Managed | 1,460 accommodation businesses [S3] |
| 3 | Schools, training centres, event organisers | Intake seasons, events, many enquiries | Business, Custom | (guess) |

The sector guidance for each of these is already in Admin -> Industries (`docs/INDUSTRIES.md`), so the demo shows posts
that sound local from the first minute.

## 3. The price ladder

### What we sell today (from the code)

| Plan | Price (RWF) | What it includes | AI cost at full use |
| --- | --- | --- | --- |
| Starter | 15,000 a month, 150,000 a year | 60 AI texts, 30 designs, calendar, publishing, gallery, 1 user | small (texts and designs) |
| Business | 50,000 a month, 500,000 a year | 200 texts, 100 designs, **100 AI photos**, **website chat (500 replies)**, **videos** with voiceover, 3 users | about $25.90 (about 38,000 RWF) at full use, `docs/PLANS.md` |
| Custom | Business or Starter + add-ons, priced live in Admin -> Offers | see the add-on list below | depends |
| Card price | the RWF price / rate x 1.12, rounded up to whole dollars | Starter $12, Business about $39 | Paddle takes 5% + $0.50 [S8] |

Add-on prices today (Admin -> Money -> Add-on prices, `docs/RWANDA_LAUNCH_PLAN.md` section 4 and the 14 October
changes): AI photos 8,000; website chat 10,000; Autopilot 20,000; analytics 5,000; Canva 5,000; store import 10,000;
Drive import 3,000; webhooks 5,000; API 15,000; extra user 3,000; video 20,000; voiceover 15,000; **Managed Light
100,000** (12 posts a month made and published) and **Managed Full 180,000** (20 posts, designs, comment replies,
monthly report).

### What to change and what to add

| Step on the ladder | Price (RWF a month) | Change | Why |
| --- | --- | --- | --- |
| Starter | **15,000** (keep) | none | The door in. Cheaper than one boosted post a week (guess) and than a freelancer's 100,000 to 300,000 [S9]. |
| Starter + video | 15,000 + 20,000 video add-on | none | Lets a small shop try videos without jumping to Business. |
| Business | **50,000** (keep) | add the **Inbox** (reply to website chats and, later, Instagram and Facebook messages from one place) | It is a selling point that costs little: the AI cost is already in the website chat allowance. It also keeps clients (they work in BuPulse every day). |
| **Social replies** add-on (new) | **25,000** | Business or Custom only. Automatic replies: keyword triggers ("comment PRICE"), auto-replies to DMs, follow-ups, Instagram and Facebook comment replies with the owner's approval. Includes 1,000 automated replies; +1,000 replies 5,000 | ManyChat Essential is about $17 (25,000 RWF) and Pro about $39 (57,000 RWF), card only [S10]. Business + Social replies = 75,000 RWF: less than ManyChat Pro **plus** the posts, photos and videos ManyChat does not make. |
| Business Plus (later) | **75,000** | Business + Social replies as one plan, once 20 clients use the add-on | A simpler choice on /pricing once it is proven. Not before Meta verification (below). |
| Custom | **80,000 to 150,000** (typical) | none: built in Admin -> Offers | For businesses that want Autopilot, website chat, stores, API, more users. |
| Managed Light / Full | **100,000 / 180,000** on top of a plan | none | The fastest route to the goal: 21 Managed clients are a third of it. |

**Why the Social replies price works (cost check).** 1,000 AI replies cost about $0.80 (the website chat's 500 replies
cost about $0.40, `docs/PLANS.md`). The real cost is reading Instagram and Facebook: until Meta verifies BuPulse, new
comments and DMs are read through Composio every few minutes. Checking every 5 minutes is about 8,640 calls a month
per connected account; Composio's shared free cap is about 20,000 calls (`docs/bizdev/manychat-parity-plan.md`), then
about $0.0005 a call, so **about $4.30 (6,300 RWF) per client per month** after the first two or three clients
**(derived)**. 25,000 RWF covers it with a good margin; checking every 10 minutes halves it.

**When it can be sold.** The inbox and website-chat automations can be sold as soon as they are built. **Instagram and
Facebook comment replies need Meta's permission**, and Meta verification needs a registered business
(`docs/bizdev/manychat-parity-plan.md`, "The honest answer first"). Until then sell them as "coming soon" in demos and
do not take money for them. RDB registration of a sole proprietorship is reported free and fast [S11]: that is the
single cheapest step that unlocks this add-on, Paddle live and an automatic MoMo provider.

**Video is a selling point on every demo.** Business already makes short vertical videos from the client's own product
photos, with captions and a voiceover, and keeps them in the videos library (`docs/CONTENT_VISUALS.md`). The full AI
video engine (studio.bupulse.com) is being built beside it. In a demo: take three photos of the owner's product, make a
post and a video in front of them.

### Yearly plans

Yearly = 10 months (already in the code). Push yearly at the end of a good trial: a client who pays 500,000 RWF once
cannot churn for a year, and the cash pays for agents and assistants early. Target: **20% of new clients on yearly
(guess)**. In the goal arithmetic a yearly client counts as one twelfth a month (as Admin -> Revenue does).

## 4. The funnel arithmetic

### The goal mix at month 4

| Plan | Clients | Average RWF a month | RWF a month |
| --- | --- | --- | --- |
| Starter | 60 | 15,000 | 900,000 |
| Business | 60 | 50,000 | 3,000,000 |
| of them with Social replies | (20) | +25,000 | 500,000 |
| Custom | 15 | 100,000 **(guess: Business + about 50,000 of add-ons)** | 1,500,000 |
| Managed (Light and Full, plan included) | 21 | 150,000 **(guess: a mix of 50,000 + 100,000 and 50,000 + 180,000)** | 3,150,000 |
| **Total** | **156** | | **9,050,000** |

Compared with scenario C in `docs/RWANDA_LAUNCH_PLAN.md` (146 clients, 36 Managed), this mix needs fewer Managed
clients (21) because Business went up from 35,000 to 50,000 RWF on 14 October 2026.

### Clients needed month by month

Monthly churn: SMB software usually loses **2.5% to 5%** of clients a month, 3% to 7% for very small businesses
[S12][S13]. Mobile Money renews by hand, which adds forgetting, so this plan uses **6% (guess)**.

| Month | New paying clients | Lost (6% of last month) | Paying at month end | MRR at month end (avg 58,000 RWF, guess) |
| --- | --- | --- | --- | --- |
| 1 | 30 | 0 | 30 | 1.7M |
| 2 | 40 | 2 | 68 | 3.9M |
| 3 | 45 | 4 | 109 | 6.3M |
| 4 | 50 | 7 | 152 | 8.8M |
| 5 | 50 | 9 | 193 | 11.2M |

The average of the goal mix is 9,050,000 / 156 = 58,000 RWF **(derived)**. At this pace the goal arrives at the end of
month 4 or early in month 5. Every Managed client added early pulls it forward by 2.5 Starter clients' worth.

### From visit to paying client

| Step | Rate used | Source |
| --- | --- | --- |
| Visitor -> signs up and books a demo | 3% | Median visitor -> demo in B2B software is 3.8% [S14]; lower here because many visitors only look at prices (guess) |
| Demo booked -> demo held | 75% | (guess; no-shows are common, the demo reminders help) |
| Demo held -> trial started | 85% | (guess: the trial starts in the demo) |
| Trial -> paid | 40% | Sales-assisted trials convert 25% to 40% [S15]; in-person demos sit at the top (guess) |
| **Demo held -> paid** | **about 34%** | derived (85% x 40%) |
| Online-only lead -> paid | about 1% of visitors | derived (3% x 75% x 34%) |

To get **50 new paying clients a month (month 4)** we need about **150 demos held a month, about 35 a week**:

| Source of demos (month 4) | Demos a month | How |
| --- | --- | --- |
| In-person visits by the owner and 2 to 3 agents | 75 | Each agent holds 3 to 4 demos a day on visit days, about 25 to 30 a month each (guess) |
| Partners (agencies, co-working spaces, MoMo agents, clients) | 35 | 15 to 25 active partners, 1 to 2 demos each a month (guess) |
| Online: TikTok, Instagram, WhatsApp Status, website | 25 | about 1,100 site visits a month at 3% -> 33 bookings, 75% held (derived) |
| Workshops with associations and hubs | 15 | 2 workshops a month, 20 to 30 owners each, about a third book a demo (guess) |
| **Total** | **150** | |

Managed and Custom clients come out of the same demos: aim for **about 1 in 4 paying clients on Custom or Managed (based on the goal mix: 36 of 156)**. The demo script in `docs/bizdev/SALES_KIT.md` ends by asking every owner
"Do you want to do it yourself, or should we do it for you?".

## 5. Channels and partners

| Channel | What we do | Cost | Expected (month 4) |
| --- | --- | --- | --- |
| **Owner + sales agents, in person** | Walk the target streets with a phone; make a post and a video of the owner's own product in 2 minutes; book the trial on the spot. Agents already have referral links (Admin -> Sales; `lib/sales/referral.ts`) and appear on the leaderboard | Commission only (proposed: the partner rates below), transport (paid, needs OK) | about 25 new clients |
| **Partners (new programme, section 6)** | Agencies resell or refer; co-working spaces (Norrsken House Kigali, kLab, Westerwelle Startup Haus [S16]) refer members; MoMo agents and shop-front merchants refer the shops around them; happy clients refer friends | Commission on confirmed payments only | about 12 new clients |
| **Business associations** | Private Sector Federation (at least 15,000 members in 2019, 60% SMEs [S17]) and its clusters; the ICT Chamber (240+ members [S17]); market associations; women and youth entrepreneur groups | Free talks; venue and snacks for a workshop (paid, needs OK; free alternative: hold it in a co-working space's event room) | about 6 new clients |
| **Short videos in Kinyarwanda** | Daily TikTok, Instagram Reels and WhatsApp Status: "weak post vs BuPulse post", a real shop's video made in 2 minutes, client results | Free (made with BuPulse itself) | about 7 new clients |
| **WhatsApp groups** | Real estate brokers', market traders' and entrepreneurs' groups: share a useful tip and the demo offer, never spam | Free | inside the online numbers |
| **Boosted posts / ads** | Not before the free channels work | Paid: needs the owner's OK. Free alternative: the partner programme and daily organic videos | 0 in this plan |

Rwandan small businesses take orders by phone and WhatsApp and often have no computer [S18]: every channel should end
in a WhatsApp conversation and an in-person or phone demo, not a long web form.

## 6. The partner programme

Built in step 3 of this work (`/partners`, Admin -> Sales -> Partners). The rules:

| Rule | Choice | Why |
| --- | --- | --- |
| Who | Agencies, co-working spaces, MoMo agents and merchants, consultants, happy clients | Each reaches small businesses BuPulse cannot reach alone |
| How to join | Apply on bupulse.com/partners; the owner approves in Admin | Keeps quality; no account needed |
| The link | `bupulse.com/?ref=CODE` (any page). Partner codes are 7 characters, staff codes 5 or 6, so they never clash | Reuses the staff referral cookie (30 days, first link wins) |
| What counts | A company that signs up with the partner's link and **pays within 90 days** | ManyChat uses 90 days too [S10] |
| Commission | **20%** of every confirmed payment for the client's first 12 months. **25%** once the partner has 6 paying clients, **30%** from 21 | See below |
| Paid on | **Confirmed money only**: Mobile Money confirmed in Admin -> Payments, card payments Paddle completed, net of refunds | No commission on unpaid invoices or trials |
| Payout | Monthly by Mobile Money, by hand, from Admin; each payout records the MoMo reference and is audited | Free; no provider needed |
| Partner's view | A private link showing their clients (business name, plan, paid or not) and their commission | Trust without an account |

**Why 20/25/30% and not ManyChat's 30/40/50% [S10].** ManyChat is self-serve: a referral costs it nothing more. BuPulse
holds a demo and a trial for every client, and Business costs up to about 38,000 RWF of AI at full use against 50,000
RWF (`docs/PLANS.md`). At 30% on a fully used Business the margin would be negative, so the top rate is kept for
partners who bring volume (21+ clients), when most of their clients are Starter and Custom, and Managed revenue (mostly
people's time) carries it. Common SaaS programmes pay 20% to 30% recurring [S19], so 20% to start is normal.

**Example.** A co-working space brings 8 clients: 4 Starter (15,000) and 4 Business (50,000) = 260,000 RWF a month.
With 8 paying clients it is on 25%: **65,000 RWF a month** to the space, for 12 months per client.

**Cost to BuPulse at the goal (guess).** If a quarter of revenue comes through partners at an average 22%:
9,050,000 x 25% x 22% = **about 500,000 RWF a month** in commission. Sales agents' commission is extra (proposed at
the same rates, paid on their own clients).

## 7. 30 / 60 / 90 days

### Days 1 to 30: prove it sells

- Business: 15 pilot businesses on a free month of Managed for a testimonial and before/after posts
  (`docs/RWANDA_LAUNCH_PLAN.md` section 7). Owner holds 5 demos a day, 4 days a week. Recruit 2 sales agents on
  commission and 5 first partners (2 co-working spaces, 1 agency, 2 MoMo merchants on busy streets). One free workshop
  at a co-working space. Daily short video.
- Software: pricing page with Mobile Money steps and the plan quiz; partner programme; goal tracker in Admin (this
  work).
- Owner: decide on RDB registration (free, unlocks Meta, Paddle live, automatic MoMo).
- **Target:** 30 paying clients, 1.7M RWF a month.

### Days 31 to 60: repeat and add partners

- Business: 3 agents; 15 active partners; 2 workshops (PSF cluster, a market association). First case studies from
  the pilots, with numbers (followers, messages, sales) once the owners agree. Hire the first content assistant for
  Managed when 6 Managed clients pay.
- Software: the Inbox and website-chat automations go on sale (from the conversations engine); trial follow-ups.
- **Target:** 68 paying clients, 3.9M RWF a month.

### Days 61 to 90 (and month 4): scale what works

- Business: drop the weakest channel, double the best; 25 partners; push yearly at trial end; second content
  assistant. If Meta verification is done, launch Social replies (Instagram and Facebook comment replies).
- **Target:** 109 paying clients and 6.3M at day 90; **152 clients and about 8.8M to 9M at the end of month 4**.

## 8. Costs (free first)

| Item | Cost | Free alternative | Needs the owner's OK |
| --- | --- | --- | --- |
| Hosting (Netlify free), database (Supabase free), email (Resend free tier) | 0 | | no |
| AI (Gemini) at the goal | about 30% of Business price at average use (guess); watch Admin -> Usage per client | lower limits per plan | no (already in the budget cap) |
| Partner and agent commission | about 500,000 RWF a month at the goal (section 6) | | yes (the rates) |
| Content assistants for Managed | 2 to 3 people, about 200,000 RWF each a month **(guess)** | the owner does the first 6 Managed clients | yes |
| Transport for in-person demos | about 3,000 RWF a day per agent **(guess)** | agents cover it from commission | yes |
| Workshop snacks and printing | about 50,000 RWF each **(guess)** | co-working space's free event room, no printing | yes |
| Boosted posts | any | organic short videos | yes |
| RDB registration | reported free [S11] | | owner's decision |
| Paddle (card) | 5% + $0.50 per payment [S8] | Mobile Money (free, by hand) | already decided |
| Automatic MoMo provider (later) | about 1% to 2% **(guess)** | manual confirmation | yes |

**Check:** MoMo personal wallets have limits (reported 2,000,000 RWF a day for a standard account [S20]); 9M RWF a
month spread over many small payments fits, but confirm the monthly limit with MTN or use MoMo Pay (merchant code
002450 is already set up).

## 9. Numbers to watch every week

Most are already in Admin; the goal tracker (step 3 of this work) puts the key ones on one card.

| Number | Where | Target |
| --- | --- | --- |
| Demos booked and held this week | Admin -> Demos | 25 to 40 held |
| Demo -> trial, trial -> paid | Admin -> Demos, Funnels | 85%, 40% |
| New paying clients this week | Admin -> Revenue | 8 to 12 |
| MRR in RWF against 9,000,000 | Admin -> Revenue (goal tracker) | the month's target in section 7 |
| Paying clients per plan | Admin -> Revenue | the goal mix |
| Monthly churn (clients who did not renew) | Admin -> Revenue, Client health | under 6% |
| Renewals due in the next 7 days | Admin -> Client health | all contacted |
| Partners: applications, active, clients brought, commission owed | Admin -> Sales -> Partners | 15 active by day 60 |
| AI cost per client against price | Admin -> Usage per client | under 40% of price |

## 10. Decisions for the owner

1. **Partner rates:** 20/25/30% for 12 months (recommended), or 30% flat, or a free month per referral only.
2. **Social replies add-on at 25,000 RWF** (recommended), included in Business, or a 75,000 RWF Business Plus plan now.
3. **Register the business with RDB now** (recommended: free and it unlocks Meta, Paddle live and automatic MoMo), or
   wait until revenue arrives.
4. **The USD rate in Admin -> Settings:** 1,470 (today's rate [S7]) or keep 1,450.
5. **Sales agents' pay:** commission only at the partner rates (recommended), or a small base plus commission.

## Sources

- [S1] NISR, Establishment Census 2023, enterprises by size: [statistics.gov.rw](https://statistics.gov.rw/index%2ephp/print/pdf/node/866); microdata: [microdata.statistics.gov.rw](https://microdata.statistics.gov.rw/index.php/catalog/112/datafile/F4/V134)
- [S2] NISR, Establishment Census 2023 report (sector and district shares): [statistics.gov.rw](https://statistics.gov.rw/data-sources/censuses/Establishment-Census/establishment-census-2023), [PDF](https://statistics.gov.rw/sites/default/files/documents/2025-01/Establishment%20Census%202023.pdf)
- [S3] Rwanda Statistical Yearbook 2025 via The New Times / AllAfrica, accommodation establishments: [allafrica.com](https://allafrica.com/stories/202601130547.html)
- [S4] DataReportal, Digital 2026: Rwanda: [datareportal.com](https://datareportal.com/reports/digital-2026-rwanda)
- [S5] NapoleonCat, Instagram and Facebook users in Rwanda: [Instagram](https://napoleoncat.com/stats/instagram-users-in-rwanda/), [Facebook](https://napoleoncat.com/stats/facebook-users-in-rwanda/2021/07)
- [S6] MTN Rwandacell results 2025 (MoMo users and merchants): [Q3 2025](https://rse.rw/IMG/pdf/mtn_rwandacell_ytdq3_2025_earnings_results.pdf), [KT Press](https://www.ktpress.rw/2025/11/mtn-rwanda-market-share-grows-to-64/)
- [S7] USD/RWF about 1,470 (August 2026): [Currencybeacon](https://www.currencybeacon.com/rates/USD/RWF), [Trading Economics](https://tradingeconomics.com/rwanda/currency)
- [S8] Paddle pricing, 5% + 50¢ per transaction: [paddle.com/pricing](https://www.paddle.com/pricing)
- [S9] Local social media management rates, 100,000 to 300,000 RWF per client a month (opinion column, single source): [The New Times](https://www.newtimes.co.rw/article/33598/opinions/five-ways-you-can-make-money-on-social-media/amp)
- [S10] ManyChat prices and affiliate programme: `docs/bizdev/competitor-manychat.md` (read on manychat.com/pricing and /affiliate, 19 Oct 2026)
- [S11] RDB online registration reported free: [EBC Rwanda](https://ebc-rwanda.org/business_starter/bsp), [Kolonell](https://kolonell.com/en/blog/register-business-one-stop-shop-rwanda-rdb-2026) (third-party guides; confirm on rdb.rw)
- [S12] Monthly churn benchmarks for SMB software (ProfitWell data): [Lenny's Newsletter](https://www.lennysnewsletter.com/p/monthly-churn-benchmarks)
- [S13] SMB churn 3% to 7% a month: [Kalungi](https://www.kalungi.com/blog/-average-churn-rate-for-b2b-saas)
- [S14] Visitor -> demo median 3.8%: [SaaS Hero](https://www.saashero.net/strategy/b2b-saas-demo-conversion-benchmarks/)
- [S15] Trial -> paid 15% to 25% self-serve, 25% to 40% sales-assisted: [Userpilot](https://userpilot.com/blog/?p=113413), [Eleken](https://www.eleken.co/blog-posts/saas-conversion-rates)
- [S16] Kigali hubs: [Westerwelle Startup Haus Kigali](https://westerwelle-foundation.com/locations/wsh-kigali/), [kLab (YourStory)](https://yourstory.com/2021/09/startup-guide-kigali-rwanda)
- [S17] Private Sector Federation membership (2019) and ICT Chamber: [KT Press 2019](https://www.ktpress.rw/2019/06/the-dilemma-of-a-healthy-but-disorganized-rwanda-private-sector/), [ICT Chamber keynote](https://itpo-tokyo.unido.org/files/3_Keynote-Speech-3-Mr.-Alex-Ntale-ICT-Chamber-CEO-.pdf)
- [S18] Rwandan MSMEs take orders by phone and WhatsApp, often without computers: [Cenfri](https://cenfri.org/articles/testing-how-digitalisation-could-transform-msmes-in-rwanda/)
- [S19] SaaS affiliate programmes, 20% to 30% recurring common: [Rewardful directory](https://www.rewardful.com/saas-affiliate-programs), [Dodo Payments roundup](https://dodopayments.com/blogs/saas-affiliate-program)
- [S20] MTN MoMo Rwanda daily limit reported 2,000,000 RWF (developer guide, estimate): [Kolonell](https://kolonell.com/en/blog/momo-transaction-limits-by-country-2026)
