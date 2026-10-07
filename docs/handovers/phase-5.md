# Phase 5 handover: connections, publishing, gallery and Autopilot

Built 7 October 2026. Decisions are in `docs/STAGE1_IMPLEMENTATION_PLAN.md` (Phase 5, "Additions decided 7 October 2026").
Details are in `docs/AUTOPILOT.md`, `docs/PLATFORM_APPS.md` and `docs/DEPLOY.md` (cron).

## What works (tested locally; no real network keys yet)
- **Gallery** (`/dashboard/gallery`):
  - Photos are loose or in folders, with bulk upload, move, rename and delete.
  - Photos are downscaled to 2048 px in the browser (checked in WebKit: 3000×4000 became 1536×2048 at 210 KB).
  - The bucket allows 10 MB and JPEG, PNG and WebP only. Files are checked by their first bytes, and the quota is 500 photos or 2 GB.
  - `<MediaPicker>` is used by the composer and design studio. "Make a design" works from any photo.
- **Connections** (Buffer-style):
  - Instagram Professional (Instagram Login, automatic posting) or Personal (reminder posting).
  - Personal works today, without Meta.
  - Facebook Pages; LinkedIn member and Page (same scopes for both, the token shared between them); TikTok and YouTube.
  - Every network shows "Coming soon" until its keys are set.
  - Meta data-deletion and deauthorize callbacks are in place, and a daily token refresh runs.
- **Composer, calendar and queue:**
  - Previews and validation per network.
  - Drag to reschedule; week, month and queue views.
  - The time zone is set automatically from the browser.
- **Publishing engine:**
  - Atomic claims, with up to 5 attempts and back-off.
  - An uncertain post becomes NEEDS_ACTION and is never re-sent.
  - Reminder emails for personal Instagram and for video scripts.
  - Instagram images are converted to JPEG and padded to 4:5 or 1.91:1, kept under 8 MB.
  - Metrics are collected hourly.
  - The real-database claim test (`RUN_DB_TESTS=1`) passes.
- **Autopilot** (`/dashboard/autopilot`):
  - 37 playbook ideas, holidays for 13+ countries, and learning from PostMetrics.
  - Writes one version per network.
  - "Approve all" by default; "Post without asking" is optional.
  - Costs about 2¢ of AI per week and 1 text credit per idea.
  - Runs are idempotent per local week.

## Reviewed
An Opus review found 4 high, 7 medium and 6 low issues; all are fixed. The final WebKit check found 3 more bugs, also fixed:
- a time-zone refresh pulled the user back to the page they had left;
- a hydration mismatch in the time-zone picker;
- the time-zone save was lost when leaving the page quickly.

The Safari dialog background and phone height are fixed in the shared Dialog.

## Open items
- **Network apps** (`docs/PLATFORM_APPS.md`):
  - Meta: the owner has the business portfolio and has submitted verification; the app is being created.
  - LinkedIn, TikTok and Google/YouTube are not started.
  - TikTok needs HTTPS redirects, so it can't be tested on localhost.
  - Set `LINKEDIN_COMMUNITY_MANAGEMENT=true` once that product is approved.
- **Never run on real Workers:**
  - the scheduled handler and the publish, metrics and autopilot crons in `worker.ts`;
  - the @jsquash wasm hand-off;
  - the image padding.
- **No real network post yet:** every provider is tested only against mocked APIs.
- **Trial credits:** one Autopilot week of 5 ideas uses 5 of the 10 trial text credits. Consider a separate Autopilot allowance.
- **Cosmetic:** on phones the page shows through very faintly behind dialogs, and the disabled Professional card is translucent.
- **Canva:** the round trip is still untested (see `docs/handovers/phase-4.md`). The test user `delivered+canva@resend.dev` is kept for it.
