# BuPulse hosts: one client sign-in, a host per service (phase 1, 11 November 2026)

Owner decisions, 11 November 2026. The code is in `lib/platform/app-hosts.ts` (pure: which host serves what) and
`proxy.ts` (routing). **Everything is switched off until the three settings below are set**: then the site works
exactly as before, on one host.

## What lives where

| Host | Serves |
|---|---|
| **bupulse.com** | The public site, the **one client sign-in** (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/*` incl. Google's `/auth/google`), the service chooser **`/apps`** and the sign-up step **`/apps/start`**, account pages (`/account/*`, `/suspended`, `/invite/*`), the creator portal (`/creator`, `/creators/signup`), and **every connection flow** (social, Canva, Shopify, WooCommerce, Composio, Zernio, Upload-Post) |
| **marketing.bupulse.com** | The Marketing dashboard with clean addresses: `app/dashboard/*` is served at `/*` (`/` is the home, `/posts` is `/dashboard/posts`), and its signed-in set-up pages `/welcome`, `/onboarding`, `/start-trial`, `/book-demo`, `/custom-plan` |
| **admin.bupulse.com** | The admin console with clean addresses (`/companies` is `/admin/companies`, `/` is the Overview, `/login` its own sign-in). Never a front page (`/industries` here is the admin page) |
| **support.bupulse.com** | The support app, unchanged (`lib/support/app-host.ts`) |
| agency.bupulse.com | Agency OS, **phase 2**: reserved in `SERVICES` only, not routed, not in the tunnel |

Old addresses keep working: `bupulse.com/dashboard/...` and the set-up pages go (307, query kept) to the Marketing
host's clean address; `bupulse.com/admin/...` to the admin host. Host redirects are **307, never 308**: browsers keep a
308 for ever, so switching a setting off would not reach people redirected once.

## Sign-in and sessions

- One sign-in on bupulse.com. After it, `/apps` shows a card per service the person has (Marketing with their company
  and trial status; the creator portal for creators; Agency as "Coming soon" if they asked for it). With exactly one,
  they go straight there. A new company owner who has not started a trial first sees "What do you want to start?"
  (Marketing, Agency or both); the picks are kept in their Supabase user metadata (`services_picked`) for phase 2.
- A safe `?next=` goes straight through: a path on this site, or an address on the Marketing host (the Marketing host's
  sign-in gate sends `bupulse.com/login?next=https://marketing.bupulse.com/posts`). Anything else is refused
  (`lib/auth/safe-next.ts`, `nextFromUrl`).
- The Marketing top bar has a service switcher: Marketing (ticked), Agency (coming soon) and "All services" (`/apps?all=1`).

| Host | Session cookie | Domain |
|---|---|---|
| bupulse.com, www.bupulse.com, marketing.bupulse.com (later agency.) | `bp-client-auth` (Supabase chunks `.0`, `.1`) | `.bupulse.com` (shared) |
| admin.bupulse.com | `bp-admin-auth` | host-only |
| support.bupulse.com | Supabase's default `sb-<project>-auth-token` | host-only (unchanged) |
| any host while the settings are unset | Supabase's default | host-only (as before) |

- The server client (`lib/supabase/server.ts`), the proxy and the browser client (`lib/supabase/client.ts`) pick the
  same cookie from the host (`sessionCookieOptions`). The browser cannot read the server's settings, so the proxy sets a
  small `bp-auth-scope` cookie (`client:.bupulse.com` or `admin`) that the browser client reads.
- Signing out on any client host clears the shared cookie: every client service is signed out. The admin console and a
  client account can be signed in side by side in one browser. The support app ignores both cookies.
- The `bp_return` cookie (where to go after sign-up's steps) and the pricing quiz's `bp-plan-pick` are also shared with
  the Marketing host. The referral cookie `bp-ref`, the tracked link `bp-link` and the visit id stay on bupulse.com,
  where sign-up is.

## Connections (shared later with Agency)

Every flow starts and finishes on bupulse.com, where its callback is registered, so its state and PKCE cookies and the
shared session are on the same host. The "Connect" links on the Marketing host reach bupulse.com's start route (the
proxy sends a start reached on the Marketing host there; the Shopify form posts there directly); after the callback the
person lands on `bupulse.com/dashboard/...`, which goes on to the Marketing host's clean page. Every token exchange
still sends the registered bupulse.com `redirect_uri` (tests/platform/registered-redirects.test.ts).

- Social (Meta, Instagram, LinkedIn, TikTok, YouTube): `lib/social/oauth.ts` `redirectUri()`, unchanged.
- Creator connections, Composio, Zernio, Upload-Post: take any callback per request; built from bupulse.com.
- Canva: `/api/canva/callback` and the editor's `/api/canva/return` run on bupulse.com.
- Shopify: install links `bupulse.com/dashboard/stores/shopify?shop=…&hmac=…` go to the Marketing host with the whole
  query; a signed-out merchant signs in on bupulse.com and comes back to it.
- WooCommerce: the store POSTs the keys to `bupulse.com/api/stores/woocommerce/callback` server to server. A POST is
  never redirected between hosts.
- Google Calendar (admin): started on the admin host (its session is host-only); Google calls back on bupulse.com,
  which bounces the GET to the same address on the admin host, where the state cookie and the admin session are. Safer
  than finishing on bupulse.com with a signed state, which would mean trusting an admin identity on a host without the
  admin session.
- Connections are stored per client company, not per host: social channels `Connection.businessId`, stores
  `StoreConnection.businessId`, Cloudflare `CloudflareConnection.businessId`; Canva per person (`CanvaConnection.userId`);
  creators' channels per creator (`CreatorConnection.profileId`).

## The owner's one-time steps

1. **Cloudflare DNS** (bupulse.com zone), two records, both **Proxied**:
   - `CNAME marketing → cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0.cfargotunnel.com`
   - `CNAME admin → cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0.cfargotunnel.com`

   (or on the PC: `cloudflared tunnel route dns bupulse-prod marketing.bupulse.com` and the same for
   `admin.bupulse.com`). The tunnel config (`scripts/self-host/windows/tunnel-config.ps1`) already lists both; the next
   update rewrites it and restarts the tunnel.
2. **Settings** in the Netlify production environment (the PC's `server.mjs` reads them at each start), then restart
   the BuPulse server (or install the next update):
   - `MARKETING_APP_URL` = `https://marketing.bupulse.com`
   - `ADMIN_APP_URL` = `https://admin.bupulse.com`
   - `CLIENT_COOKIE_DOMAIN` = `.bupulse.com`

   Not in Admin -> Services: the proxy cannot read keys saved there. The Marketing host stays off without
   `CLIENT_COOKIE_DOMAIN`. The admin host works on its own.
3. **Supabase -> Authentication -> URL Configuration -> Redirect URLs**: nothing is required, because every sign-in
   and email link stays on bupulse.com. To be safe, make sure these lines are there:
   - `https://bupulse.com/auth/callback`
   - `https://bupulse.com/auth/confirm`
   - `https://bupulse.com/**`
4. **Google sign-in console**: nothing. `/auth/google` stays on bupulse.com.
5. **Paddle**: card checkout now runs on marketing.bupulse.com. Check in Paddle -> Checkout -> Website approval that
   the approved domain covers it (add `marketing.bupulse.com` if Paddle asks).
6. Everyone signs in **once** again after the switch: the session cookie's name changes (the old ones are removed).

To switch off: empty the three settings and restart. Everything is back on one host at once (307s are not cached).

## Local testing

```
NEXT_PUBLIC_SITE_URL=http://bupulse.localhost:3041 \
MARKETING_APP_URL=http://marketing.bupulse.localhost:3041 \
ADMIN_APP_URL=http://admin.bupulse.localhost:3041 \
CLIENT_COOKIE_DOMAIN=.bupulse.localhost npx next dev -p 3041
```

`*.localhost` needs no DNS. A shared parent (`bupulse.localhost`) is needed for the shared cookie: browsers do not share
a `Domain=localhost` cookie between `localhost` and `marketing.localhost`. `marketing.localhost` and `admin.localhost`
work for routing. The screens are in a dev-only preview: `/apps-preview`, `/apps-preview/start`,
`/apps-preview/listed`, `/apps-preview/switcher`.

## Phase 2 (not built)

- Agency OS moves onto BuPulse's Supabase accounts (today a separate project with test users) at agency.bupulse.com:
  add it to `marketingOrigin`-style config (`AGENCY_APP_URL`), the tunnel, the proxy's routing and the client cookie
  hosts; mark it `ready` in `SERVICES`; add its membership check in `lib/platform/services.ts`.
- Create the Agency workspace for everyone with `services_picked` containing `agency`.
- Agency reads the shared connections: today they are keyed by `businessId`; Agency needs a mapping from its workspace
  (or its client companies) to BuPulse `Business` rows, and a read API on bupulse.com with the shared session.
