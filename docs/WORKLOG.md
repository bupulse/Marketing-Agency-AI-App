# BuPulse v2: work log and task queue

The autonomous loop reads this file, takes the first open task, does it (build → review → fix → merge into `v2`), ticks it off and writes a log line. The owner checks this file at the end of each run.

## Rules for every run
- **Models:** Opus 5.5 or smaller only (no Fable). At most 2–3 agents in parallel.
- **Where:** work in a git worktree per task (`~/BuPulse-v2-<task>`), merge into `v2` after review. Never touch v1's database. The v2 test database is the Supabase project `rzlcizxnhtfqminqkphp`.
- **Never without the owner:**
  - production databases or deploys;
  - money;
  - creating accounts on outside services or accepting their terms;
  - pushing to GitHub.
  Ask through the helper terminal (multiple choice, with steps) and continue with other tasks while waiting.
- **Secrets:** go into `.env` files (never committed) and the macOS Keychain (service name `BuPulse <thing>`); never into git or this log.

## Queue
1. [ ] **Sign-up and industries:** "Other" with the industry field, required business description, phone with the country code formatted as typed, Industries in the admin with guided fields and suggestions, and the AI using the industry. Builder started on 12 Oct (WIP on `v2-signup`).
2. [ ] **Test accounts in v2:**
   - Inzu (waiting for demo), Urugo (trial), Nova (paid by MoMo, with cyusa@bupulse.com as a team member), Savannah Bakery (Kenya, trial), Lisbon Coffee Co (Portugal, trial), and admin@bupulse.com.
   - Emails are e.cyusa21+…@gmail.com and ceuze+…@gmail.com.
   - Passwords go into the Keychain and `~/BuPulse-v2/TEST_ACCOUNTS.md` (git-ignored).
3. [ ] **Real channels on localhost:**
   - Meta (Facebook Pages, and Instagram through Facebook): add the `http://localhost:3001` redirect addresses.
   - LinkedIn and YouTube developer apps: create them with the owner's approval, put their keys in the v2 `.env`, and test a real connect from Urugo.
   - TikTok and Instagram's own login need HTTPS, so they wait for the live site.
4. [ ] **Owner test pass support:** fix what the owner reports from testing localhost:3001.
5. [ ] **Phase 9 security review of v2:**
   - Review everything that is new since `main`.
   - Fix the high and medium findings.
   - Add end-to-end tests of the main journeys: sign-up → demo → trial → MoMo → active.
6. [ ] **Small follow-ups:**
   - Read-only Webhooks and API pages after a downgrade, so delete and revoke are reachable from the screen.
   - Legal pages: needs the owner's name and address.
7. [ ] **Go-live preparation (needs the owner):** GitHub Actions secrets, Cloudflare token, production Supabase, Resend DNS, a deploy dry run.
8. [ ] **Re-record the demo videos** with the real v2 screens (optional, after testing).

## Log
- 2026-10-12 06:55: resumed. Demo data deleted from v1's development database (its password was in the public repository). R4 MoMo and R1 regions and trial reviewed, fixed and merged into `v2`. v2 test database created (all migrations applied). v2 runs on localhost:3001; pages and RWF pricing were checked.

## Queue update (12 Oct 2026, afternoon): all of this is to be done today
- Owner rule: **free services only for now.** Pause anything paid, propose free alternatives as multiple choice, keep the paid option behind a switch.
- [x] Sign-up industries and phone; business info (hours, locations, contacts, building details); security fixes; Google Calendar booking; location-locked pricing. All merged.
- [x] Invoices and post-demo activation: merged (02ab3b6), migration applied to the test database.
- [x] "Use my location" with a built-in offline country map (free), Google behind GEO_PROVIDER for later: merged (2012f28).
- [x] Small follow-ups: read-only Webhooks/API pages after a downgrade; legal pages name "BuPulse, Kigali, Rwanda": merged (fb404ed).
- [x] Knowledge Base part 1 (company profile, products & services, campaigns from projects, gallery folders and product albums): merged with review fixes (89ecd2d).
- [x] Knowledge Base part 2: customers & audience, competitors and differentiation, FAQs & policies, reviews & testimonials, AI marketing interview: merged with review fixes (89ecd2d). Per-company AI allowance $3/month (AI_COMPANY_MONTHLY_USD).
- [x] Hosting on the **Netlify free plan** instead of Cloudflare Workers Paid (merged 4c51add; the publisher runs every 5 minutes; nothing deployed yet, owner steps in docs/DEPLOY_NETLIFY.md):
  - port OpenNext/Workers specifics (cron triggers → Netlify scheduled functions, Hyperdrive → pooled DATABASE_URL, Worker bindings, wasm image codecs);
  - read the location from Netlify's geo header (x-nf-geo) with cf-ipcountry kept as a fallback;
  - point the Updates/deploy flow at Netlify;
  - Cloudflare stays as DNS.
- AI: the owner has $30 of AI credit. Set AI_MONTHLY_BUDGET_USD to 30 and warn at 80%.
- 2026-10-12 16:10: invoices, offline "Use my location", follow-ups (read-only webhooks/API, legal text) and Netlify hosting merged into `v2`. Fixed a dev-only database pool error (33b6bd1). Knowledge Base part 1 is getting its review fixes; part 2 is being built.
- 2026-10-12 16:50: Knowledge base (parts 1 and 2) merged into `v2`, migrations applied to the test database, 2246 tests and the build pass. Journey tests found 2 billing bugs; fixes in progress on `v2-journeys`.

## Publish-ready checklist (goal: deploy v2 on Wed 14 Oct)
- [x] Launch basics: WhatsApp button (NEXT_PUBLIC_WHATSAPP_NUMBER), MoMo/Airtel/Card badges on pricing, /api/status (07dd006).
- [x] Billing fixes from the journey tests + two review rounds (exact-amount invoice settlement, payment review list, unmapped Paddle prices with admin Reprocess): merged (b59efd8); Paddle setup now subscribes to transaction.completed and adjustment.* (5e58c2f).
- [x] R3 custom plans and offers + R5 custom-plan request form: reviewed, fixed and merged (96b3d68); migration applied to the test database.
- [x] Final security review of everything since 615da00: no critical/high; all findings fixed and merged (2f5100f, b59efd8).
- [x] Meta app review pack: `docs/META_APP_REVIEW.md` (9e0991f).
- [x] Release prep: `docs/RELEASE_2.0.md` (release notes, owner tasks, go-live order, backups, rollback, limits). Offline Netlify build to re-run on the final head.
- [ ] Owner: test v2 on localhost:3001; Netlify + production Supabase (free) + Resend DNS; MoMo Pay code; availability; Connect Google Calendar; reset keys pasted in chat.
- [ ] Merge v2 into `main`, deploy, one real 100 RWF MoMo payment, zip handover.
- 2026-10-12 20:25: internet outage 17:41–20:12 interrupted the agents; resumed. Security fixes and billing fixes merged; migrations applied to the test database.
- [ ] Content comes with its visual (owner request, 12 Oct evening): AI art director picks template/style and single image or carousel; product album photos first, AI photo when needed (within allowance), free design fallback; free browser-rendered slideshow videos for video content (AI video "coming soon"); everything editable before posting. Building on `v2-media`.
- [ ] Content page redesign (owner request, 13 Oct): product / campaign / General cards → post cards (Instagram-like, with image or video), filters (app, post type, created or posted date, status), "Today: needs review" section with Approve / Approve all, and Content settings to skip approval per app (auto-schedule at the best time, daily summary email, cancellable until posted). Building on `v2-contentui` (based on `v2-media`).
- [ ] People in posts (owner request, 13 Oct): AI scenes with local people in most images (real product photo as reference when available), carousel cover with people, AI images limited by plan (Starter/Standard 30, Business/Pro 100, trial 5; allowance $2/$6/$1), image pack add-on 5,000 RWF. On `v2-media`.
- [x] Free video robot (GitHub Actions every 15 min, same renderer, auto-schedules when done): merged. To switch on at go-live: VIDEO_ROBOT_SECRET in Netlify + GitHub secret, ROBOT_APP_URL variable (docs/VIDEO_ROBOT.md).
- [ ] Varied content packs (owner feedback, 13 Oct): each generation makes a pack of different posts (price/offer, how it works, features, news, story, tips, FAQ, why us, behind the scenes, local moment, CTA), angles rotated per product, spread across networks in each network's format, every visual with people and visually distinct. On `v2-media` after people-in-posts.
- [ ] Content flow v3 (owner, 13 Oct afternoon): product pages lose all content tools; Content → pick product/campaign/General → day view (today first, browse past days); "AI generates it" (captions per platform from Knowledge base + Digital Marketing Profile, then images/videos using Gallery photos AND videos first, a different angle every day, design choice AI designs vs free templates, never pick a template) or "I create it" (describe today's content, or bring my own media + caption → AI adapts per platform). On `v2-flow`. (Replaces the "varied content packs" item.)
- [ ] Design library: up to 100 templates per style for images AND videos, more styles beyond Clean/Elegant/Bold/Warm/Playful. On `v2-templates`.
- [ ] Voiceover (ElevenLabs paid plan, owner subscribes) + free royalty-free music library + people photos animated in videos. After people-in-posts merges.
- [ ] Content rules (owner, 13 Oct evening): posts per app per day by plan (trial/Starter 1, Business 3, custom 1–10 in the offer builder); price choice (AI decides by default ≈1 in 4, With price, No price); new idea types every day (playful, engaging question, breaking news, did you know, challenge/contest, quiz, myth vs fact, tip, behind the scenes, customer spotlight, local moment, brand-safe humour) with repeat checks; contest posts suggested by AI but need the owner to confirm prize and rules. On `v2-flow`.
- [x] Hosting decision (owner, 13 Oct 17:00): Cloudflare Workers Paid ($5/month) instead of Netlify free (Netlify kept as fallback). Video storage 100 MB per company at launch. Checking the Worker bundle size, crons and Workers compatibility of today's features on `v2-media`. Done on `v2-media`: Worker 9.2 MiB gzipped (was 11.0 MiB, limit 10 MiB), 11 cron triggers in `worker-crons.ts`, `check-env --cloudflare` in `deploy.yml`, docs moved to Cloudflare (`docs/DEPLOY.md`, `docs/RELEASE_2.0.md`), video cap 100 MB.
- 2026-10-13 18:30: merged into `v2` today: content flow v3, content rules (posts per app by plan, price choice, idea types, contests), people images, voiceover + music (20 ElevenLabs tracks seeded on the test project), Gallery videos (private bucket), design library (12 styles × 105 designs, 144 video looks), Designs paging, Cloudflare Workers readiness (9.2 MiB worker, fetch AI clients with retries; live Gemini call verified). Hosting decision: Cloudflare Workers Paid. Next: owner test pass, then go-live steps in docs/RELEASE_2.0.md.
- 2026-10-13 19:25: merged: payments (MoMo or card at every pay point, MTN dial *182*8*1*002450#, screenshot proof locked after check, Admin → Settings → Payments with MoMo + Paddle connect/test/stepped set-up; sandbox card prices set up for RW/EAC), AI-written video scripts + per-app picture/video choice (TikTok/Shorts video), industries test timeout. All builders done; owner testing tonight; deploy tomorrow (Cloudflare Workers Paid) — re-run Paddle "Set up prices" on the live site for the webhook.
- 2026-10-13 23:00: final pre-deploy checks on `v2` (f253a23 + docs): tsc, lint, vitest (3172 passed), next build and the Workers build pass; Worker 41,004 KiB, **gzip 10,017 KiB (9.78 MiB) of the 10 MiB limit**, about 220 KiB left. Merged today evening: billing (7-day renewal window for MoMo and card, add features mid-period with proration, request form without goals, card carry-over retries), staff and roles with emailed-code + authenticator admin sign-in, referral links, leaderboard and sales room TV with sounds, new Overview with approve card, admin currency switch RWF | USD | EUR, page-loading animation, Account menu, one sign-in method per account. `check-env` now warns when `AUTH_EXTRA_ORIGINS` or `PUBLIC_LINK_URL` is set in production. Release notes and owner tasks in `docs/RELEASE_2.0.md`.
