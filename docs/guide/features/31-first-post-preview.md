# Free first-post preview (before the demo)

A new company waits for its demo before anything in BuPulse opens (`docs/REGIONS.md`, "The demo-first trial"). With this
feature switched on, its owner can ask BuPulse for **one post about the business** on the demo screen: a caption,
hashtags and an ad headline, written from what they said at sign-up and onboarding. They see the value before the call,
and the demo starts from a real post. It is the 3d step of `docs/bizdev/PLAN.md`.

**It is off by default**, because every preview is a paid AI call. Nothing is spent until the owner switches it on.

**Where:** the demo screen (what a company sees while it waits for its demo) → **See your first post now**.
**Switch:** Admin → Settings → **Free first-post preview** (permission *System*).

## For the owner

1. Admin → Settings → **Free first-post preview**. The panel shows the **cost per sign-up** that uses it: about
   **$0.005** with today's text model (one Gemini 3.8 Flash call of about 2,500 tokens in and 900 out, at the prices in
   `lib/ai/pricing.ts`; Gemini 3.8 Flash doubles in price on 1 January 2027), at most twice that when a first try fails.
   Once previews have been made, it also shows their real average from the AI cost ledger.
2. Tick **Offer the free first-post preview to companies waiting for their demo** and **Save** (audited like every
   setting). Untick it to stop: companies that already have a post still see it; nobody can make a new one.
3. Every preview shows in Admin → AI calls and spend as feature `first_post_preview`, and counts in the monthly AI cap
   and the company's own allowance like every AI call.

## What the client sees

- On the demo screen, under the booking: **See your first post now** — "Free, before your demo: BuPulse writes one post
  about your business from what you told us." and **Make my first post** (Owner and Admin roles; other teammates are
  told who can).
- About 20 seconds later: **Your first post, written by BuPulse**, shown like a social media post (the business's
  initials in its brand colour, the headline, the caption, the hashtags), with "This is a sample. In your demo we make
  its design and a short video from your photos, and plan your week."
- If the AI fails: the reason and **Try again** (once). After a second failure: "Your free preview could not be made. We
  will make your first post together in the demo."
- Once the trial starts the whole app is open, so the card is gone and the preview cannot be asked for any more.

## Rules

| Rule | |
| --- | --- |
| Who | A company waiting for its demo (`PENDING_DEMO`), not suspended, Owner or Admin role |
| How many | One per company (a unique row); a failed one may be tried once more (`FIRST_POST_MAX_ATTEMPTS` = 2) |
| Plan usage | Not counted: it comes before the trial and its limits |
| AI money | Through the cost ledger (`withLedger`, feature `first_post_preview`): service switches, the monthly cap and the company allowance apply |
| Rate limit | 6 clicks an hour per company (`RATE_LIMITS.firstPostPreview`) |
| Deleting the account | The preview is deleted with it |

## For developers

| | |
| --- | --- |
| Service | `lib/preview/first-post.ts`: `makeFirstPostPreview`, `getFirstPostPreview`, `previewOffered`, `previewCostUsd`, `previewCostSummary`, `PREVIEW_TOKENS`, `FIRST_POST_MAX_ATTEMPTS` |
| The exception | `lib/usage.ts` `assertPreviewAllowed(userId)`: passes only a `PENDING_DEMO`, unsuspended company and touches no usage counter; `consumeUsage` still refuses everything while waiting (`pending_demo`). `lib/entitlements.ts` `previewAllowed(sub)` (pure) and `companyMayPreview(businessId)`: only `PENDING_DEMO` |
| Action | `app/dashboard/first-post/actions.ts` `makeFirstPostAction` (`requireActiveUser("settings")`, rate limit, friendly errors) |
| UI | `components/app/first-post-preview.tsx` (client), shown by `components/app/demo-lock.tsx` while the switch is on (a post already made stays visible) |
| Admin | `app/admin/(console)/(system)/settings/page.tsx` panel `#first-post-preview`; saved by `saveSettingsAction` when the form carries `previewPanel` |
| Setting | `firstPostPreview` (`sales.firstPostPreview`, default `false`) in `lib/admin/settings.ts` |
| Table | `FirstPostPreview` (unique `businessId`, `userId`, `status` making / ready / failed, `attempts`, `caption`, `hashtags`, `headline`, `provider`, `model`, `error`). Migration `20261025500000_first_post_preview`: RLS on, grants revoked. No foreign key; `lib/account-deletion.ts` deletes it by `userId` |
| Tests | `tests/preview/first-post.test.ts` (switch off spends nothing, only waiting companies, one claim, two clicks one call, one retry, usage untouched, cost), `tests/preview/first-post-view.test.ts` (the card), `tests/account-deletion.test.ts` |

**Deploy:** run the migration before switching it on. With the switch off the code never reads the table except to show
an existing preview (a missing table then just hides the card).

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| The card is missing | The switch (Admin → Settings), or the company is not waiting for its demo | Switch it on |
| "We could not make your post just now" | Admin → Errors (`preview.first_post`), Admin → AI calls (failed `first_post_preview` rows): AI off in Services, the monthly cap or the company allowance reached | Fix the cause; the client has one more try |
| "Your post is being written" stays | A request died half way (`status` making) | Delete the company's `FirstPostPreview` row in the database; the client can ask again |
