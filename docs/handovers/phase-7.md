# Phase 7 handover: connectors hub, webhooks and API

Built 8 October 2026. Decisions are in `docs/STAGE1_IMPLEMENTATION_PLAN.md` (Phase 7, "Decided 8 October 2026").
Details are in `docs/CONNECTORS.md` (with the owner setup for each console), `docs/WEBHOOKS.md` and `docs/API.md`.

## What works (tested locally against mocks; no real provider accounts yet)
- **Catalog** (`/dashboard/connectors`, nav "Connectors"):
  - Files, Design, Store and Website groups, each card showing its status.
  - A connector that fails or is slow shows "needs attention"; one with missing keys shows "Coming soon".
  - Contract: `lib/connectors/types.ts`, with one file per connector in `lib/connectors/entries/`.
- **Importers** (gallery "Import" menu, also inside `<MediaPicker>`):
  - Google Picker uses only `drive.file`, with no stored token.
  - Dropbox Chooser uses direct links.
  - Canva designs are exported as PNG. This needs the `design:meta:read` scope, so earlier Canva links are asked to reconnect.
  - Images only: the gallery has no video support.
  - Downloads only from allow-listed hosts, with each redirect re-checked.
  - The rate limit runs before the download; the quota is atomic, using an advisory lock.
- **Stores** (`/dashboard/stores`, plus import buttons on Projects):
  - Shopify: OAuth with `read_products`, timing-safe HMAC, and the GDPR and `app/uninstalled` webhooks. An install started from Shopify goes straight to OAuth and survives sign-in and sign-up (`next`, `bp_return`).
  - WooCommerce: one-click auth stores the keys as pending, and the owner confirms them on BuPulse. Manual keys also work.
  - Re-sync keeps the owner's edits: field baselines plus a version check. Products that disappear from the store are flagged `sourceMissing`.
  - The daily cron `47 3 * * *` takes the stalest stores first, with about 800 subrequests per call. "Sync now" loops in slices.
- **Cloudflare** (`/dashboard/domains`):
  - Connects with a pasted token, verified and stored encrypted, and lists the zones.
  - "Install chat" adds a Zaraz Custom HTML tool named per widget key, then reads it back. It also adds the domain to allowed websites, and falls back to the manual code.
- **Webhooks** (`/dashboard/connectors/webhooks`, every plan):
  - Events: `lead.created`, `content.generated`, `post.published`, `post.failed`.
  - HMAC-signed, retried by the hourly leads-digest cron at 1, 2, 4 and 8 h for up to 24 h, with a delivery log and Retry. Delivery is at least once.
  - The old per-widget webhook is copied into an endpoint. Its columns stay until after deploy (see TODO in `docs/WEBHOOKS.md`).
- **API** (`/dashboard/connectors/api`, Pro only):
  - Keys look like `bp_live_…`, are stored as SHA-256 hashes and are scoped.
  - Endpoints: GET projects, content, posts and leads; PATCH lead; POST draft post.
  - 60 calls per minute per key, with the Pro check on every call.

## Reviewed
- An Opus review found 2 high, 4 medium and 8 low issues; all are fixed.
- The lead added two more fixes: Shopify login return and Disconnect/Confirm buttons refreshing.
- Checks: tsc, lint and 1,100 tests pass, and `next build` succeeds. WebKit runs pass at desktop and phone width in light and dark.

## Open items
- **Owner accounts and keys:** each connector shows "Coming soon" until these exist.
  - Google Cloud: Picker API key, client ID and project number.
  - Dropbox app key.
  - Shopify Partner app: key and secret, URLs and GDPR webhooks.
  - Tick the Canva scope.
  - WooCommerce and Cloudflare need nothing from the owner.
- **Never run for real:**
  - Google, Dropbox, Canva and Shopify round trips.
  - WooCommerce one-click (it needs HTTPS).
  - The Cloudflare Zaraz install, whose payload shape is not fully documented by Cloudflare, so test it with a real account first.
  - The new-user sign-up path for a Shopify install, which is unit-tested only.
- **Follow-up migration after deploy:** drop `ChatWidget.webhookUrl`, `webhookSecretEncrypted` and `Lead.webhookPendingAt`.
- **Naming:** the nav now has both "Connections" (social accounts) and "Connectors" (apps). Consider renaming "Connections" to "Channels", as Buffer does.
- **Small races accepted:** a manual Retry during an in-flight cron attempt can send twice, and the manual "New project" action still counts before it creates.
