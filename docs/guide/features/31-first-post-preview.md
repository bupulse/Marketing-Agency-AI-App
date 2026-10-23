# Free first-post preview (on hold)

**On hold since 22 October 2026.** The preview was made for companies waiting for their demo: on the demo screen, the
owner could ask BuPulse for **one post about the business** (a caption, hashtags and an ad headline, written from what
they said at sign-up and onboarding), to see the value before the call. Since the free trial starts straight away with
no demo (`docs/REGIONS.md`, "Trial first"), that screen is gone and **the card is not shown anywhere**: a new company
goes from onboarding to "Choose the plan you want to try" and into the full app. The switch, the code and the table are
kept in case the preview comes back somewhere else.

**It is off by default**, because every preview is a paid AI call. Switching it on today changes nothing a client sees.

**Switch:** Admin → Settings → **Free first-post preview** (permission *System*). Its text there still speaks of
"companies waiting for their demo".

## For the owner

1. Admin → Settings → **Free first-post preview** shows the **cost per sign-up** that would use it: about **$0.005**
   with today's text model (one Gemini 3.8 Flash call of about 2,500 tokens in and 900 out, at the prices in
   `lib/ai/pricing.ts`; Gemini 3.8 Flash doubles in price on 1 January 2027), at most twice that when a first try fails.
2. Every preview made in the past shows in Admin → AI calls and spend as feature `first_post_preview`.

## What a client saw (until 22 October 2026)

- On the demo screen, under the booking: **See your first post now** and **Make my first post** (Owner and Admin roles).
- About 20 seconds later: **Your first post, written by BuPulse**, shown like a social media post.
- If the AI failed: the reason and **Try again** (once).

## Rules

| Rule | |
| --- | --- |
| Who | A company that has not started its trial (`PENDING_DEMO`), not suspended, Owner or Admin role |
| How many | One per company (a unique row); a failed one may be tried once more (`FIRST_POST_MAX_ATTEMPTS` = 2) |
| Plan usage | Not counted: it would come before the trial and its limits |
| AI money | Through the cost ledger (`withLedger`, feature `first_post_preview`): service switches, the monthly cap and the company allowance apply |
| Rate limit | 6 clicks an hour per company (`RATE_LIMITS.firstPostPreview`) |
| Deleting the account | The preview is deleted with it |

## For developers

| | |
| --- | --- |
| Service | `lib/preview/first-post.ts`: `makeFirstPostPreview`, `getFirstPostPreview`, `previewOffered`, `previewCostUsd`, `previewCostSummary`, `PREVIEW_TOKENS`, `FIRST_POST_MAX_ATTEMPTS` |
| The exception | `lib/usage.ts` `assertPreviewAllowed(userId)`: passes only a `PENDING_DEMO`, unsuspended company and touches no usage counter; `consumeUsage` still refuses everything before the trial (`pending_demo`). `lib/entitlements.ts` `previewAllowed(sub)` (pure) and `companyMayPreview(businessId)`: only `PENDING_DEMO` |
| Action | `app/dashboard/first-post/actions.ts` `makeFirstPostAction` (`requireActiveUser("settings")`, rate limit, friendly errors) |
| UI | `components/app/first-post-preview.tsx` (client). Not rendered anywhere since `components/app/demo-lock.tsx` was removed on 22 October 2026 |
| Admin | `app/admin/(console)/(system)/settings/page.tsx` panel `#first-post-preview`; saved by `saveSettingsAction` when the form carries `previewPanel` |
| Setting | `firstPostPreview` (`sales.firstPostPreview`, default `false`) in `lib/admin/settings.ts` |
| Table | `FirstPostPreview` (unique `businessId`, `userId`, `status` making / ready / failed, `attempts`, `caption`, `hashtags`, `headline`, `provider`, `model`, `error`). Migration `20261025500000_first_post_preview`: RLS on, grants revoked. No foreign key; `lib/account-deletion.ts` deletes it by `userId` |
| Tests | `tests/preview/first-post.test.ts` (switch off spends nothing, only waiting companies, one claim, two clicks one call, one retry, usage untouched, cost), `tests/preview/first-post-view.test.ts` (the card), `tests/account-deletion.test.ts` |

**Deploy:** run the migration before switching it on. With the switch off the code never reads the table except to show
an existing preview (a missing table then just hides the card).

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| The card is missing | Expected: it is on hold and shown nowhere (see the top of this page) | None needed |
| "We could not make your post just now" | Admin → Errors (`preview.first_post`), Admin → AI calls (failed `first_post_preview` rows): AI off in Services, the monthly cap or the company allowance reached | Fix the cause; the client has one more try |
| "Your post is being written" stays | A request died half way (`status` making) | Delete the company's `FirstPostPreview` row in the database; the client can ask again |
