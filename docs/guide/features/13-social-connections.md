# Social connections (Channels)

Channels is where a business links its social accounts so BuPulse can publish its posts: Instagram, Facebook Pages,
LinkedIn, TikTok and YouTube. The same page also lists the apps that bring photos and products in (Google Drive,
Dropbox, Canva, Shopify, WooCommerce, Cloudflare). A personal Instagram account can be added without any login: BuPulse
then reminds the owner to post by hand instead of posting itself.

**Page:** `/dashboard/connections`  **Plans:** Starter and Business (part of feature key `calendar`). Trial: the chosen
plan's features. Only the Owner and Admins can connect or disconnect (team permission `channels`); Members do not see it.
The admin can change what each plan includes in Admin → Plans.

## What you see

![Channels page](../images/client/connections.jpg)

- **Social accounts.** One card per network (Instagram, Facebook, LinkedIn, TikTok, YouTube) with a short note
  ("Facebook Pages", "Profiles and Pages", …). Each connected account shows its picture, name, type (Business,
  Creator, Personal, Page, Profile, Organization, Channel) and a badge:
  - **Active**: BuPulse can post to it.
  - **Expires soon**: the login is about to run out; press Reconnect.
  - **Needs reconnect**: the network no longer accepts the login; press Reconnect.
  - **Reminder posting**: a personal Instagram account. BuPulse sends a reminder with the caption and photos ready.
  - **Coming soon** instead of Connect: BuPulse's own keys for that network are not set yet.
- **Canva.** A card to link your own Canva account (each teammate links their own). See [Designs](05-designs.md).
- **Apps.** Cards for Google Drive, Dropbox, Shopify, WooCommerce and Cloudflare, with Connect, "Coming soon" or
  "Add to your plan". The same cards are on [Connectors](14-connectors-api-and-webhooks.md).
- **Pro note.** A line about connecting hundreds more apps with your own Composio account (Pro plan only).

## How to use it

1. Open **Channels** in the sidebar.
2. Press **Connect** on a network.
3. For **Instagram**, choose:
   - **Professional** (Business or Creator account): you sign in with Instagram (or Facebook). Posts go out by themselves
     at the time you choose. The account must be a Business or Creator account linked to a Facebook Page.
   - **Personal**: type your Instagram username (like `@yourshop`). No login. BuPulse reminds you when it is time to post.
4. For the other networks you are sent to the network's own sign-in page. Approve BuPulse there.
5. If your login has several accounts (for example several Facebook Pages), BuPulse shows a list: tick the ones to add
   and press save.
6. Back on Channels the account shows **Active**. It is now offered when you schedule a post in the
   [Calendar](07-calendar-and-publishing.md).
7. To stop, press **Disconnect** on the account. Scheduled posts for it go back to drafts, so nothing is published to an
   account you removed.

## Limits and settings

- Connecting is limited to 30 tries an hour per person (`RATE_LIMITS.socialConnect`).
- There is no limit on how many accounts a business connects.
- A network can be switched off by the BuPulse owner in **Admin → Services**. Connect then says "This network is not
  available yet", and the daily token refresh leaves that network's accounts alone until it is back on.
- **Admin → Connections** lists every client's channels; support can force-disconnect one. Its queued posts get a
  "Needs reconnect" note and go back to normal when the client reconnects.
- Losing the `calendar` feature never removes accounts. Disconnecting always works; connecting a new one needs the feature.

## For developers

### Where it lives

| Part | Files |
|---|---|
| Page | `app/dashboard/connections/page.tsx` (`pageGate("channels")` then `featureGate("calendar")`) |
| Server actions | `app/dashboard/connections/actions.ts`: `disconnectAction`, `connectReminderAction`, `savePickedAccountsAction`, `cancelPickAction` |
| Components | `components/connections/channel-list.tsx`, `connect-dialog.tsx`, `account-picker.tsx`, `connect-toast.tsx`, `disconnect-button.tsx`, `network-icon.tsx`, `types.ts`; `components/connectors/connector-card.tsx`; `components/settings/canva-card.tsx` |
| Logic | `lib/social/registry.ts`, `lib/social/connections.ts`, `lib/social/oauth.ts`, `lib/social/connect-errors.ts`, `lib/social/graph.ts`, `lib/social/providers/{instagram,facebook,linkedin,tiktok,youtube}.ts`, `lib/connectors/catalog.ts` (the Apps cards) |
| Database | `Connection` (`kind` SOCIAL, `provider`, `postingMode` AUTO/NOTIFY, `status` ACTIVE/EXPIRING/EXPIRED/REVOKED/ERROR, encrypted tokens); `Post.connectionId` |
| API routes | `app/api/social/[network]/connect/route.ts`, `app/api/social/[network]/callback/route.ts`, `app/api/meta/data-deletion/route.ts`, `app/api/meta/deauthorize/route.ts` |
| Cron jobs | `app/api/cron/social-refresh/route.ts`, called daily at 04:43 UTC by `.github/workflows/social-refresh.yml` |
| Admin | `app/admin/(console)/(clients)/connections/page.tsx` (`forceDisconnectAction`), `lib/admin/connections.ts` (`listChannels`); switches in `lib/admin/switch.ts` |
| Tests | `tests/social-actions.test.ts`, `tests/social-connections.test.ts`, `tests/social-oauth.test.ts`, `tests/social-routes.test.ts`, `tests/social-meta-providers.test.ts`, `tests/cron-social-refresh-route.test.ts`, `tests/meta-callbacks.test.ts`, `tests/social/*.test.ts` |
| Docs | [docs/PLATFORM_APPS.md](../../PLATFORM_APPS.md) (registering the Meta, TikTok, LinkedIn and YouTube apps) |

Environment variables (names only): `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`,
`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_COMMUNITY_MANAGEMENT`, `TIKTOK_CLIENT_KEY`,
`TIKTOK_CLIENT_SECRET`, `TIKTOK_PHOTO_POSTING`, `GOOGLE_YOUTUBE_CLIENT_ID`, `GOOGLE_YOUTUBE_CLIENT_SECRET`, `CRON_SECRET`.

### Key functions

- `allProviders`, `getProvider`, `isNetwork` (`lib/social/registry.ts`) — the five network providers and lookup by name.
- `SocialProvider.isConfigured` / `authorizeUrl` / `finishOAuth` / `refresh` / `revoke` (`lib/social/types.ts`) — what each provider implements.
- `VARIANTS`, `isValidVariant` (`lib/social/oauth.ts`) — Instagram via `instagram` or `facebook` login; LinkedIn `member` or `organization`.
- `sealState` / `openState` (`lib/social/oauth.ts`) — the encrypted, 10-minute OAuth state cookie (`STATE_COOKIE`) with the PKCE verifier.
- `sealPending` / `openPending` (`lib/social/oauth.ts`) — holds a multi-account OAuth result in chunked cookies until the account picker is saved.
- `saveConnections` (`lib/social/connections.ts`) — writes the chosen accounts with encrypted tokens.
- `saveReminderConnection` (`lib/social/connections.ts`) — adds a personal Instagram as a `NOTIFY` connection (no tokens).
- `listConnections` (`lib/social/connections.ts`) — what the page may show (never tokens).
- `loadCredentials`, `refreshConnectionById`, `markConnectionError` (`lib/social/connections.ts`) — decrypt and refresh for the publisher and the cron; an auth error sets `EXPIRED`.
- `disconnect` / `deleteConnections` (`lib/social/connections.ts`) — best-effort revoke, delete the row, return SCHEDULED / PENDING_APPROVAL / NEEDS_ACTION posts to DRAFT.
- `restoreQueuedPosts` (`lib/social/connections.ts`) — after a reconnect, clears the admin's "Needs reconnect:" note; past-due ones become "Pick a new time".
- `CONNECT_ERRORS` (`lib/social/connect-errors.ts`) — the friendly texts for `?error=` codes.
- `deleteMetaConnections` (`lib/social/meta-callbacks.ts`) — Meta's deauthorize / data-deletion callbacks.
- `disabledNetworks`, `isServiceEnabled` (`lib/admin/switch.ts`) with `NETWORK_SERVICE` (`lib/admin/service-catalog.ts`) — the admin's per-network switch.

### How it works

1. **Connect** links to `/api/social/<network>/connect?variant=…`. The route checks the role (`requireActiveUser("channels")`),
   the `calendar` feature, the admin switch and the rate limit, seals the state cookie and redirects to the network.
2. The network sends the user to `/api/social/<network>/callback`. The route opens the state, re-checks the switch and the
   feature, compares `state`, then calls the provider's `finishOAuth`.
3. One account: `saveConnections(..., "AUTO")` and a redirect with `?connected=<network>`. Several: `sealPending` and
   `?pick=<network>`; the page shows `AccountPicker`, whose form calls `savePickedAccountsAction`.
4. Personal Instagram: `connectReminderAction` → `saveReminderConnection` (`postingMode` NOTIFY). The publisher reminds
   instead of posting ([Calendar and publishing](07-calendar-and-publishing.md)).
5. Every day the social-refresh job refreshes AUTO tokens that expire within 7 days (200 per run, soonest first) and
   marks failures.
6. **Disconnect** → `disconnectAction` → `disconnect(id, { businessId })` (a connection of another business is ignored).

## If something goes wrong

| Symptom | Look first | Usual fix |
|---|---|---|
| Card shows "Coming soon" | The provider's `isConfigured` in `lib/social/providers/<network>.ts`; Admin → Services | Set that network's environment variables and redeploy. |
| "This network is not available yet" after pressing Connect | Admin → Services (switched off), or the plan lacks `calendar` | Switch the service back on, or add the calendar feature to the plan. |
| "We could not find an account to connect" (Instagram) | `CONNECT_ERRORS.no_accounts` | The Instagram account must be Business or Creator and linked to a Facebook Page that is ticked during the Facebook login. |
| "That connection took too long" / "could not be verified" | `openState` in `lib/social/oauth.ts` (10-minute cookie) | Start again in the same browser; check the site URL matches the redirect URI registered with the network (`redirectUri`). |
| Account shows **Needs reconnect** | Admin → Connections; `Connection.lastError`; `markConnectionError` | Press Reconnect. If many accounts expire at once, check the social-refresh workflow ran (Admin → Health / cron runs). |
| Posts to an account stopped after support disconnected it | `NEEDS_RECONNECT_PREFIX` notes on posts | Reconnect the account; `restoreQueuedPosts` puts the queued posts back. |
