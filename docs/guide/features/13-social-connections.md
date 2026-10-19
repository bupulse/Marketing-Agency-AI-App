# Social connections (Channels)

Channels is where a business links its social accounts so BuPulse can publish its posts: Instagram, Facebook Pages,
LinkedIn, TikTok and YouTube. The same page also lists the apps that bring photos and products in (Google Drive,
Dropbox, Canva, Shopify, WooCommerce, Cloudflare).

While BuPulse's own Meta, LinkedIn and Google apps wait for the networks' approval, Facebook, Instagram, LinkedIn and
YouTube connect through **BuPulse-Socials**: BuPulse's own Composio account, which uses Composio's already-approved apps.
The client needs no Composio account. They sign in on the network through a secure Composio page, Composio keeps the
login, and BuPulse posts through it. TikTok always uses BuPulse's own TikTok app. Instagram connects **Business and
Creator** (professional) accounts only.

**Page:** `/dashboard/connections`  **Plans:** Starter and Business (part of feature key `calendar`). Trial: the chosen
plan's features. Only the Owner and Admins can connect or disconnect (team permission `channels`); Members do not see it.
The admin can change what each plan includes in Admin → Plans.

## What you see

![Channels page](../images/client/connections.jpg)

- **Social accounts.** One card per network (Instagram, Facebook, LinkedIn, TikTok, YouTube) with a short note
  ("Business and Creator accounts", "Facebook Pages", "Profiles and Pages", …) and a **Connect** button (**Add** once
  the network has an account). Each connected account shows its picture, name, type (Business, Creator, Page, Profile,
  Organization, Channel) and a badge:
  - **Active**: BuPulse can post to it.
  - **Expires soon**: the login is about to run out; press Reconnect.
  - **Needs reconnect**: the network no longer accepts the login; press Reconnect.
  - **Reminder posting**: a personal Instagram account saved before this option was removed. It keeps working (BuPulse
    sends a reminder with the caption and photos ready) until it is disconnected. New ones cannot be added.
  - **Coming soon** instead of Connect: the network can be connected neither through BuPulse-Socials nor through
    BuPulse's own app yet.
- **The Connect window.** For Instagram: a "Professional account" box (posts automatically, photos and carousels of up
  to 10 images, results in your reports, for Business and Creator accounts), a **Connect Instagram** button and a tip on
  switching a personal account to a professional one in the Instagram app (free). For the other networks: one line on
  what happens and a **Connect <network>** button. When the network goes through BuPulse-Socials the window adds: "You
  sign in on a secure page from Composio, the partner BuPulse uses to connect social accounts. We never see your
  password."
- **Canva.** A card to link your own Canva account (each teammate links their own). See [Designs](05-designs.md).
- **Apps.** Cards for Google Drive, Dropbox, Shopify, WooCommerce and Cloudflare, with Connect, "Coming soon" or
  "Add to your plan". The same cards are on [Connectors](14-connectors-api-and-webhooks.md).
- **Pro note.** A line about connecting hundreds more apps with your own Composio account (Pro plan only).

## How to use it

1. Open **Channels** in the sidebar.
2. Press **Connect** on a network.
3. For **Instagram**, the account must be a **Business or Creator** account. A personal account cannot be connected:
   switch it in the Instagram app first (profile settings, Account type and tools, switch to a professional account).
4. Press the **Connect** button in the window. You are sent to the network's sign-in page (through Composio's secure
   page for BuPulse-Socials networks). Sign in and approve.
5. If your login has several accounts (for example several Facebook Pages, or a LinkedIn profile and its Pages),
   BuPulse shows a list: tick the ones to add and press save.
6. Back on Channels the account shows **Active**. It is now offered when you schedule a post in the
   [Calendar](07-calendar-and-publishing.md).
7. To stop, press **Disconnect** on the account. Scheduled posts for it go back to drafts, so nothing is published to an
   account you removed.

What each network does through BuPulse-Socials:

| Network | What can be connected | What BuPulse posts | Results in reports |
|---|---|---|---|
| Facebook | The Pages the login manages | Text, a link, one photo, several photos, or one video on its own | Likes (reactions), comments, shares |
| Instagram | One Business or Creator account | One photo (JPEG), a carousel of up to 10 photos, or one MP4 video as a Reel | Likes, comments |
| LinkedIn | The person's profile; company Pages they administer when Composio's app may list them (shown as "LinkedIn Page <number>") | Text and photos (no video) | None |
| YouTube | The channels of the login | Video scripts with reminders; BuPulse does not upload videos yet | None |

TikTok connects with BuPulse's own TikTok app (sign in with TikTok) as before.

## Limits and settings

- Connecting is limited to 30 tries an hour per person (`RATE_LIMITS.socialConnect`).
- There is no limit on how many accounts a business connects.
- **BuPulse-Socials** is on when the Composio key is saved in **Admin → Services → Composio** and the Composio service is
  switched on there. Switched off, new connections use BuPulse's own apps instead ("Coming soon" where those are not set
  up). Accounts already connected through BuPulse-Socials keep posting through it.
- Once Meta, LinkedIn or Google approve BuPulse's own app, the owner lists that network in `SOCIALS_DIRECT` (Admin →
  Services → Composio) to send new connections back to BuPulse's own app. Accounts keep the way they were connected
  until they are reconnected.
- A network can be switched off by the BuPulse owner in **Admin → Services** (Meta covers Facebook and Instagram).
  Connect then says "This network is not available yet", and the daily token refresh leaves that network's accounts
  alone until it is back on.
- **Admin → Connections** lists every client's channels; support can force-disconnect one. Its queued posts get a
  "Needs reconnect" note and go back to normal when the client reconnects.
- Losing the `calendar` feature never removes accounts. Disconnecting always works; connecting a new one needs the feature.

## For developers

### Where it lives

| Part | Files |
|---|---|
| Page | `app/dashboard/connections/page.tsx` (`pageGate("channels")` then `featureGate("calendar")`; per network `viaComposio` and the `composio` switch decide BuPulse-Socials) |
| Server actions | `app/dashboard/connections/actions.ts`: `disconnectAction`, `savePickedAccountsAction`, `cancelPickAction` |
| Components | `components/connections/channel-list.tsx`, `connect-dialog.tsx`, `account-picker.tsx`, `connect-toast.tsx`, `disconnect-button.tsx`, `network-icon.tsx`, `types.ts`; `components/connectors/connector-card.tsx`; `components/settings/canva-card.tsx` |
| Logic | `lib/social/registry.ts`, `lib/social/connections.ts`, `lib/social/oauth.ts`, `lib/social/connect-errors.ts`, `lib/social/callback-response.ts`, `lib/social/graph.ts`, `lib/social/providers/{instagram,facebook,linkedin,tiktok,youtube}.ts`, `lib/social/composio/client.ts` and `lib/social/composio/networks.ts` (BuPulse-Socials), `lib/connectors/catalog.ts` (the Apps cards) |
| Database | `Connection` (`kind` SOCIAL, `provider`, `method` DIRECT/OWN_COMPOSIO/COMPOSIO, `postingMode` AUTO/NOTIFY, `status` ACTIVE/EXPIRING/EXPIRED/REVOKED/ERROR, encrypted tokens; for COMPOSIO the encrypted "token" is the Composio connected-account id); `Post.connectionId`; `AdminSetting` `socials.composio.authConfigs` (the Composio auth config per network). Migration `prisma/migrations/20261021100000_connection_method_composio` |
| API routes | `app/api/social/[network]/connect/route.ts`, `app/api/social/[network]/callback/route.ts` (BuPulse's own apps), `app/api/social/[network]/composio/route.ts` (BuPulse-Socials return), `app/api/meta/data-deletion/route.ts`, `app/api/meta/deauthorize/route.ts` |
| Cron jobs | `app/api/cron/social-refresh/route.ts`, called daily at 04:43 UTC by `.github/workflows/social-refresh.yml` |
| Admin | `app/admin/(console)/(clients)/connections/page.tsx` (`forceDisconnectAction`), `lib/admin/connections.ts` (`listChannels`), `lib/admin/actions/connections.ts` (`forceDisconnectChannel`); switches in `lib/admin/switch.ts`; the Composio entry in `lib/admin/service-catalog.ts` |
| Tests | `tests/social-actions.test.ts`, `tests/social-connections.test.ts`, `tests/social-oauth.test.ts`, `tests/social-routes.test.ts`, `tests/social-meta-providers.test.ts`, `tests/cron-social-refresh-route.test.ts`, `tests/meta-callbacks.test.ts`, `tests/social/*.test.ts` (BuPulse-Socials in `tests/social/composio.test.ts`) |
| Docs | [docs/PLATFORM_APPS.md](../../PLATFORM_APPS.md) (registering the Meta, TikTok, LinkedIn and YouTube apps) |

Environment variables (names only): `COMPOSIO_API_KEY`, `SOCIALS_DIRECT` (both can be saved in Admin → Services →
Composio), `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `LINKEDIN_CLIENT_ID`,
`LINKEDIN_CLIENT_SECRET`, `LINKEDIN_COMMUNITY_MANAGEMENT`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
`TIKTOK_PHOTO_POSTING`, `GOOGLE_YOUTUBE_CLIENT_ID`, `GOOGLE_YOUTUBE_CLIENT_SECRET`, `CRON_SECRET`.

### Key functions

- `allProviders`, `getProvider`, `isNetwork` (`lib/social/registry.ts`) — the five network providers and lookup by name. Publishing, metrics and revoke follow each account's `method`: COMPOSIO accounts go to `lib/social/composio/networks.ts`, the rest to BuPulse's own app.
- `SocialProvider.isConfigured` / `authorizeUrl` / `finishOAuth` / `refresh` / `revoke` (`lib/social/types.ts`) — what each provider implements. `isConfigured` is about BuPulse's own app only.
- `viaComposio`, `COMPOSIO_NETWORKS` (`lib/social/composio/client.ts`) — whether new connections of a network go through BuPulse-Socials: `COMPOSIO_API_KEY` set, the network is Facebook, Instagram, LinkedIn or YouTube, and it is not in `SOCIALS_DIRECT`.
- `authConfigFor`, `createConnectLink`, `getConnectedAccount`, `deleteConnectedAccount` (`lib/social/composio/client.ts`) — the Composio auth config per network ("BuPulse-Socials <Network>", made on first use), the one-time sign-in link (the business id is the Composio user), checking and removing a sign-in.
- `runTool`, `toolError`, `uploadFile` (`lib/social/composio/client.ts`) — run one Composio tool (with the business as `user_id`), map its error text to auth / rate limit / invalid / temporary, and hand Composio a photo (LinkedIn).
- `composioNetwork` (`lib/social/composio/networks.ts`) — per network: `accounts` (what the sign-in may post to; Instagram refuses a personal account), `publish`, and `metrics` (Facebook and Instagram only).
- `VARIANTS`, `isValidVariant` (`lib/social/oauth.ts`) — BuPulse's own apps: Instagram via `instagram` or `facebook` login; LinkedIn `member` or `organization`.
- `sealState` / `openState` (`lib/social/oauth.ts`) — the encrypted, 10-minute state cookie (`STATE_COOKIE`) with the PKCE verifier, or for BuPulse-Socials the Composio connected-account id (`composioAccount`).
- `sealPending` / `openPending` (`lib/social/oauth.ts`) — holds a multi-account result in chunked cookies until the account picker is saved.
- `done` (`lib/social/callback-response.ts`) — the redirect back to Channels shared by both return routes; clears the state cookie and any half-open picker.
- `saveConnections` (`lib/social/connections.ts`) — writes the chosen accounts with encrypted tokens and `method` (COMPOSIO when the result came from BuPulse-Socials); a reconnect through BuPulse-Socials removes the Composio sign-in it replaced.
- `listConnections` (`lib/social/connections.ts`) — what the page may show (never tokens).
- `loadCredentials`, `refreshConnectionById`, `markConnectionError` (`lib/social/connections.ts`) — decrypt and refresh for the publisher and the cron; an auth error sets `EXPIRED`. A NOTIFY account is never handed out for automatic posting.
- `disconnect` / `deleteConnections` (`lib/social/connections.ts`) — best-effort revoke, delete the row, return SCHEDULED / PENDING_APPROVAL / NEEDS_ACTION posts to DRAFT; for BuPulse-Socials, the Composio sign-in is removed once no account uses it.
- `restoreQueuedPosts` (`lib/social/connections.ts`) — after a reconnect, clears the admin's "Needs reconnect:" note; past-due ones become "Pick a new time".
- `CONNECT_ERRORS` (`lib/social/connect-errors.ts`) — the friendly texts for `?error=` codes.
- `deleteMetaConnections` (`lib/social/meta-callbacks.ts`) — Meta's deauthorize / data-deletion callbacks.
- `disabledNetworks`, `isServiceEnabled` (`lib/admin/switch.ts`) with `NETWORK_SERVICE` (`lib/admin/service-catalog.ts`) — the admin's per-network switch, and the `composio` switch for BuPulse-Socials.

### How it works

1. **Connect** links to `/api/social/<network>/connect`. The route checks the role (`requireActiveUser("channels")`),
   the `calendar` feature, the network's admin switch and the rate limit.
2. **BuPulse-Socials** (`viaComposio(network)` and the `composio` switch on): `createConnectLink` asks Composio for a
   sign-in link for this business, the state cookie records the Composio connected-account id, and the person goes to
   Composio's page, then the network's.
3. Composio sends the person to `/api/social/<network>/composio`. The route opens the state, compares `state`, re-checks
   the switches and the feature, and checks the Composio account is ACTIVE and belongs to this business. Then
   `composioNetwork(network).accounts` lists what it may post to. Anything but a saved connection deletes the Composio
   sign-in again.
4. **BuPulse's own app** (otherwise): the route seals the state cookie with a PKCE verifier and redirects to the network,
   which returns to `/api/social/<network>/callback`. The route opens the state, re-checks the switch and the feature,
   compares `state`, then calls the provider's `finishOAuth`.
5. Either way, one account: `saveConnections(..., "AUTO")` and a redirect with `?connected=<network>`. Several:
   `sealPending` and `?pick=<network>`; the page shows `AccountPicker`, whose form calls `savePickedAccountsAction`.
   Closing the picker (`cancelPickAction`) removes an unused BuPulse-Socials sign-in.
6. Every day the social-refresh job refreshes AUTO tokens that expire within 7 days (200 per run, soonest first) and
   marks failures. BuPulse-Socials accounts store no expiry (Composio keeps their login), so the job skips them; a
   login the network no longer accepts shows up as **Needs reconnect** when a post or the results job hits it.
7. **Disconnect** → `disconnectAction` → `disconnect(id, { businessId })` (a connection of another business is ignored).
8. Older NOTIFY accounts (personal Instagram, "Reminder posting") keep getting reminders from the publisher
   ([Calendar and publishing](07-calendar-and-publishing.md)) until disconnected; there is no way to add new ones.

## If something goes wrong

| Symptom | Look first | Usual fix |
|---|---|---|
| Card shows "Coming soon" | Admin → Services → Composio (key saved, switched on, `SOCIALS_DIRECT`); for TikTok, or a network in `SOCIALS_DIRECT`, the provider's `isConfigured` in `lib/social/providers/<network>.ts` | Save `COMPOSIO_API_KEY` and switch Composio on, or set that network's own app variables. |
| "This network is not available yet" after pressing Connect | Admin → Services (the network or Composio switched off), or the plan lacks `calendar` | Switch the service back on, or add the calendar feature to the plan. |
| "We could not finish connecting" right after pressing Connect | Admin → Errors (source `social.connect.composio`) | Check the Composio key in Admin → Services; if Composio itself is down, try again later. |
| "We could not find an account to connect" (Instagram) | `CONNECT_ERRORS.no_accounts`; the account type in the Instagram app | The Instagram account must be Business or Creator. Switch it in the Instagram app, then connect again. |
| "We could not find an account to connect" (Facebook, LinkedIn, YouTube) | `composioNetwork(network).accounts` | The login has no Facebook Page, LinkedIn profile or YouTube channel. Sign in with the account that manages it. |
| "The connection was cancelled" | The person declined on the network's page, or Composio reported the sign-in as failed | Press Connect again and approve. |
| "That connection took too long" / "could not be verified" | `openState` in `lib/social/oauth.ts` (10-minute cookie); for BuPulse-Socials, the Composio account belongs to another business | Start again in the same browser, signed in to the right business; for BuPulse's own apps check the site URL matches the redirect URI registered with the network (`redirectUri`). |
| Account shows **Needs reconnect** | Admin → Connections; `Connection.lastError`; `markConnectionError` | Press Reconnect. If many accounts expire at once, check the social-refresh workflow ran (Admin → Health / cron runs). |
| Posts to an account stopped after support disconnected it | `NEEDS_RECONNECT_PREFIX` notes on posts | Reconnect the account; `restoreQueuedPosts` puts the queued posts back. |
| A LinkedIn post with a video fails | `composioNetwork("linkedin").publish` | LinkedIn through BuPulse-Socials takes text and photos only. |
