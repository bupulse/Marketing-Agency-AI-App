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
