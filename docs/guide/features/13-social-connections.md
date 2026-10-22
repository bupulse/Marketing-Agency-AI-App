# Social connections (Channels)

Channels is where a business links its social accounts so BuPulse can publish its posts: Instagram, Facebook Pages,
LinkedIn, TikTok, YouTube and X (Twitter). The same page also lists the apps that bring photos and products in (Google Drive,
Dropbox, Canva, Shopify, WooCommerce, Cloudflare).

While BuPulse's own Meta, LinkedIn and Google apps wait for the networks' approval, Facebook, Instagram, LinkedIn and
YouTube connect through **BuPulse-Socials**: BuPulse's own Composio account, which uses Composio's already-approved apps.
The client needs no Composio account. They sign in on the network through a secure Composio page, Composio keeps the
login, and BuPulse posts through it. **TikTok and X** go through BuPulse-Socials too, but Composio has no approved app
of its own for them: they need BuPulse's own TikTok and X developer apps added in Composio (`COMPOSIO_TIKTOK_AUTH_CONFIG_ID`,
`COMPOSIO_TWITTER_AUTH_CONFIG_ID`, [docs/PLATFORM_APPS.md](../../PLATFORM_APPS.md) section 10) and show **Coming soon**
until then. X also costs BuPulse money per post, so it stays off until the owner switches it on. Instagram connects
**Business and Creator** (professional) accounts only.

**Page:** `/dashboard/connections`  **Plans:** Starter and Business (part of feature key `calendar`). Trial: the chosen
plan's features. Only the Owner and Admins can connect or disconnect (team permission `channels`); Members do not see it.
The admin can change what each plan includes in Admin → Plans.

## What you see

![Channels page](../images/client/connections.jpg)

- **Social accounts.** One card per network (Instagram, Facebook, LinkedIn, TikTok, YouTube, X) with a short note
  ("Business and Creator accounts", "Facebook Pages", "Profiles and Pages", …) and a **Connect** button (**Add** once
  the network has an account). Each connected account shows its picture, name, type (Business, Creator, Page, Profile,
  Organization, Channel) and a badge:
  - **Active**: BuPulse can post to it.
  - **Expires soon**: the login is about to run out; press Reconnect.
  - **Needs reconnect**: the network no longer accepts the login; press Reconnect.
  - **Reminder posting**: a personal Instagram account saved before this option was removed. It keeps working (BuPulse
    sends a reminder with the caption and photos ready) until it is disconnected. New ones cannot be added.
  - **Coming soon** instead of Connect: the network can be connected neither through BuPulse-Socials nor through
    BuPulse's own app yet, or the BuPulse owner switched it off in Admin → Services (X is off until switched on).
- **Pinterest** has a card with **Coming soon** and no button: BuPulse may add it later (see "Other networks" below).
- **The Connect window.** For Instagram: a "Professional account" box (posts automatically, photos and carousels of up
  to 10 images, results in your reports, for Business and Creator accounts), a **Connect Instagram** button and a tip on
  switching a personal account to a professional one in the Instagram app (free). For the other networks: one line on
  what happens and a **Connect <network>** button. When the network goes through BuPulse-Socials the window adds: "You
  sign in on a secure page from Composio, the partner BuPulse uses to connect social accounts. We never see your
  password." TikTok and X add one line on what BuPulse does there (TikTok: "At the time you choose, BuPulse sends your
  video to your TikTok inbox. Open TikTok, tap the notification, add the caption and post.", or "BuPulse posts your
  videos at the time you choose." once direct posting is on; X: text with up to 4 photos or one MP4 video, results
  about once a week).
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
| TikTok (with BuPulse's TikTok app in Composio) | The TikTok account of the login | One video (MP4, MOV or WebM). Before TikTok's audit: sent to the TikTok inbox at the scheduled time, the client adds the caption and posts it in TikTok (at most 5 waiting a day). After it (`TIKTOK_DIRECT_POST=true`): posted directly. Photo posts and scripts stay reminders | Views, likes, comments, shares, once the video is public and passed TikTok's checks |
| X (with BuPulse's X app in Composio, X switched on) | The X profile of the login | Text up to 280 characters (a link is added at the end), up to 4 photos (JPEG, PNG, WebP, GIF), or one MP4 video up to 140 seconds | Views, likes, replies, reposts, saves, read about once a week |

Without BuPulse's TikTok app in Composio, TikTok uses BuPulse's own TikTok app (sign in with TikTok) as before, and
TikTok video posts are reminders with the video attached. Accounts connected that way keep working that way.

## Limits and settings

- Connecting is limited to 30 tries an hour per person (`RATE_LIMITS.socialConnect`).
- **X costs money per call** (no free plan since February 2026): about $0.015 a post, $0.20 a post with a link, $0.005
  each time a post's numbers are read, $0.01 a profile look-up. BuPulse pays from the X app's credits. That is why the X
  service is off until the owner switches it on in **Admin → Services → X**, and why X numbers are read about once a
  week instead of daily. Details and set-up: [docs/PLATFORM_APPS.md](../../PLATFORM_APPS.md) section 10b.
- **TikTok before its audit**: videos go to the client's TikTok inbox (they finish the post in TikTok; the inbox upload
  cannot carry the caption). Direct posts from an unaudited app are private for good, so `TIKTOK_DIRECT_POST` stays
  empty until the audit passes. TikTok is free.
- There is no limit on how many accounts a business connects.
- **BuPulse-Socials** is on when the Composio key is saved in **Admin → Services → Composio** and the Composio service is
  switched on there. Switched off, new connections use BuPulse's own apps instead ("Coming soon" where those are not set
  up). Accounts already connected through BuPulse-Socials keep posting through it.
- Once Meta, LinkedIn or Google approve BuPulse's own app, the owner lists that network in `SOCIALS_DIRECT` (Admin →
  Services → Composio) to send new connections back to BuPulse's own app. Accounts keep the way they were connected
  until they are reconnected.
- A network can be switched off by the BuPulse owner in **Admin → Services** (Meta covers Facebook and Instagram; X
  starts off). Its card then shows "Coming soon" (an old Connect link says "This network is not available yet"), its
  posts wait as scheduled, and the daily token refresh leaves that network's accounts alone until it is back on.
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
| Logic | `lib/social/registry.ts`, `lib/social/connections.ts`, `lib/social/oauth.ts`, `lib/social/connect-errors.ts`, `lib/social/callback-response.ts`, `lib/social/graph.ts`, `lib/social/providers/{instagram,facebook,linkedin,tiktok,youtube,twitter}.ts` (`twitter` has no sign-in of its own), `lib/social/composio/client.ts`, `lib/social/composio/ways.ts` (which networks go through it, pure) and `lib/social/composio/networks.ts` (BuPulse-Socials, per network), `lib/connectors/catalog.ts` (the Apps cards) |
| Database | `Connection` (`kind` SOCIAL, `provider`, `method` DIRECT/OWN_COMPOSIO/COMPOSIO, `postingMode` AUTO/NOTIFY, `status` ACTIVE/EXPIRING/EXPIRED/REVOKED/ERROR, encrypted tokens; for COMPOSIO the encrypted "token" is the Composio connected-account id); `Post.connectionId`; `AdminSetting` `socials.composio.authConfigs` (the Composio auth config per network). Migration `prisma/migrations/20261021100000_connection_method_composio` |
| API routes | `app/api/social/[network]/connect/route.ts`, `app/api/social/[network]/callback/route.ts` (BuPulse's own apps), `app/api/social/[network]/composio/route.ts` (BuPulse-Socials return), `app/api/meta/data-deletion/route.ts`, `app/api/meta/deauthorize/route.ts` |
| Cron jobs | `app/api/cron/social-refresh/route.ts`, called daily at 04:43 UTC by `.github/workflows/social-refresh.yml` |
| Admin | `app/admin/(console)/(clients)/connections/page.tsx` (`forceDisconnectAction`), `lib/admin/connections.ts` (`listChannels`), `lib/admin/actions/connections.ts` (`forceDisconnectChannel`); switches in `lib/admin/switch.ts`; the Composio entry in `lib/admin/service-catalog.ts` |
| Tests | `tests/social-actions.test.ts`, `tests/social-connections.test.ts`, `tests/social-oauth.test.ts`, `tests/social-routes.test.ts`, `tests/social-meta-providers.test.ts`, `tests/cron-social-refresh-route.test.ts`, `tests/meta-callbacks.test.ts`, `tests/social/*.test.ts` (BuPulse-Socials in `tests/social/composio.test.ts`, TikTok and X in `tests/social/composio-tiktok-x.test.ts`) |
| Docs | [docs/PLATFORM_APPS.md](../../PLATFORM_APPS.md) (registering the Meta, TikTok, LinkedIn and YouTube apps) |

Environment variables (names only): `COMPOSIO_API_KEY`, `SOCIALS_DIRECT` (both can be saved in Admin → Services →
Composio), `COMPOSIO_TIKTOK_AUTH_CONFIG_ID` and `TIKTOK_DIRECT_POST` (Admin → Services → TikTok),
`COMPOSIO_TWITTER_AUTH_CONFIG_ID` (Admin → Services → X), `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `LINKEDIN_CLIENT_ID`,
`LINKEDIN_CLIENT_SECRET`, `LINKEDIN_COMMUNITY_MANAGEMENT`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
`TIKTOK_PHOTO_POSTING`, `GOOGLE_YOUTUBE_CLIENT_ID`, `GOOGLE_YOUTUBE_CLIENT_SECRET`, `CRON_SECRET`.

### Key functions

- `allProviders`, `getProvider`, `isNetwork` (`lib/social/registry.ts`) — the six network providers and lookup by name. Publishing, metrics and revoke follow each account's `method`: COMPOSIO accounts go to `lib/social/composio/networks.ts`, the rest to BuPulse's own app.
- `SocialProvider.isConfigured` / `authorizeUrl` / `finishOAuth` / `refresh` / `revoke` (`lib/social/types.ts`) — what each provider implements. `isConfigured` is about BuPulse's own app only.
- `viaComposio`, `MANAGED_NETWORKS`, `OWN_APP_CONFIG`, `ownAuthConfig`, `COMPOSIO_NETWORKS` (`lib/social/composio/ways.ts`, re-exported by `client.ts`) — whether new connections of a network go through BuPulse-Socials: `COMPOSIO_API_KEY` set, the network is Facebook, Instagram, LinkedIn or YouTube (Composio-managed) or TikTok / X with their auth config id set, and it is not in `SOCIALS_DIRECT`.
- `tiktokVideoPosts`, `tiktokDirectPost` (`lib/social/composio/ways.ts`) — TikTok video posts go out through BuPulse-Socials (TikTok's `rules.videoPosts`, `acceptsVideo` in `lib/visuals/post-media.ts`, `formatFor` in `lib/publishing/validate.ts`); to the inbox or posted directly.
- `authConfigFor`, `createConnectLink`, `getConnectedAccount`, `deleteConnectedAccount` (`lib/social/composio/client.ts`) — the Composio auth config per network ("BuPulse-Socials <Network>", made on first use; TikTok and X: the id from the environment, never a managed one), the one-time sign-in link (the business id is the Composio user), checking and removing a sign-in.
- `runTool`, `proxyRequest`, `toolError`, `uploadFile` (`lib/social/composio/client.ts`) — run one Composio tool (with the business as `user_id`), call the network's own API with the account's sign-in (TikTok), map error text to auth / rate limit / invalid / temporary, and hand Composio a file (LinkedIn and X photos, X videos).
- `composioNetwork` (`lib/social/composio/networks.ts`) — per network: `accounts` (what the sign-in may post to; Instagram refuses a personal account), `publish`, and `metrics` (Facebook, Instagram, TikTok and X). TikTok's metrics also give the post its lasting video id and link (`MetricsSnapshot.resolved`, saved by `collectMetrics`).
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

## Other networks Composio offers

Checked on Composio's toolkit pages on 22 October 2026 (https://docs.composio.dev/toolkits and each toolkit's page).
Built: Facebook, Instagram, LinkedIn, YouTube (managed sign-in), TikTok and X (BuPulse's own apps). Not built:

| Network | Composio toolkit | Sign-in | What it would need | Cost | Fit for BuPulse |
|---|---|---|---|---|---|
| Pinterest | `pinterest` | Composio-managed (yes) | Tools `PINTEREST_CREATE_PIN` (photos, carousels), `PINTEREST_REGISTER_MEDIA` and `PINTEREST_GET_MEDIA` (video), `PINTEREST_LIST_BOARDS`, `PINTEREST_GET_PROFILE`, `PINTEREST_GET_PIN_ANALYTICS`. A Pin needs a board. The page says creating Pins in production needs Pinterest **Standard access** (Trial apps cannot), which may apply to Composio's own app too: unverified until tried | Free | Small in Rwanda; shown as **Coming soon** in Channels |
| YouTube video upload | `youtube` (already connected) | Composio-managed (yes) | `YOUTUBE_UPLOAD_VIDEO` / `YOUTUBE_MULTIPART_UPLOAD_VIDEO` (the file object's shape is not documented), statistics with `YOUTUBE_GET_VIDEO_DETAILS_BATCH`. YouTube posts stay scripts until this is built | Free (YouTube quota: section 4 of PLATFORM_APPS.md) | Good next step: Shorts from the Video Studio |
| LinkedIn video and numbers | `linkedin` (already connected) | Composio-managed (yes) | `LINKEDIN_UPLOAD_VIDEO` and `LINKEDIN_CREATE_VIDEO_POST` (the member's own profile), `LINKEDIN_GET_SHARE_STATS` (company Pages only) | Free | Later |
| Reddit | `reddit` | Composio-managed (yes) | `REDDIT_CREATE_REDDIT_POST` (text and link posts; no single tool posts an image), `REDDIT_GET_REDDIT_USER_ABOUT`, `REDDIT_GET_POSTS_BY_FULLNAME` | Free | Poor: communities, not business pages. Not shown |
| Snapchat | `snapchat` | Not managed (own app) | The toolkit is the Snapchat **Marketing (ads) API**: campaigns, ads, audiences. It cannot post Stories or Spotlight for a business profile | Ads cost money | No organic posting. Not shown |
| Threads | none | — | Composio has no Threads toolkit. It would need BuPulse's own Meta Threads app (Threads API) as a direct provider | Free | Later, outside Composio. Not shown |

Every Composio call counts against BuPulse-Socials' monthly calls (`lib/social/inbox/budget.ts`).

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
| TikTok or X shows "Coming soon" | `COMPOSIO_TIKTOK_AUTH_CONFIG_ID` / `COMPOSIO_TWITTER_AUTH_CONFIG_ID` in Admin → Services; for X the X switch (off until switched on) | Add BuPulse's app in Composio and save the config id ([docs/PLATFORM_APPS.md](../../PLATFORM_APPS.md) section 10); switch X on. |
| A TikTok post is "Published" but not on the profile | Before TikTok's audit the video waits in the client's TikTok inbox | The client opens TikTok, taps the notification, adds the caption and posts. TikTok keeps at most 5 waiting videos a day. |
| TikTok results stay "waiting" | `collectMetrics`; TikTok gives the video id only for public videos that passed its checks | Nothing to fix for a private or inbox video. Once it is public, the next hourly run reads it. |
| X posts wait with "BuPulse's X account has no credit left" | The X app's credit balance in X's Developer Console | Buy credits (or raise the spending limit); the posts try again within the hour. |
