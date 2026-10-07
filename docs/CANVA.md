# Edit in Canva: setup

What it does: each client links their own Canva account once. After that, any BuPulse design can be opened in Canva to edit. When they press "Return to BuPulse" in Canva, the edited image is saved in BuPulse as a **new design** next to the original (the original is never overwritten).

The feature is completely hidden until `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` are set.

## 1. Create the app (Canva Developer Portal)

Canva now calls integrations "apps".

1. Sign in to Canva with the account that will own it, open <https://www.canva.com/developers/> and choose **Your apps** > **Create an app**.
2. Choose **Outside Canva** > **Start integrating**. Name it "BuPulse" and add the details Canva asks for.
3. Open **Configuration**. Under **Integration methods** choose **Canva REST APIs**. The next steps are all on this screen.

## 2. Scopes (Configuration > Canva REST APIs > Scopes)

Tick exactly these three:

| Scope | Why |
| --- | --- |
| `asset:write` | upload the design image to the client's Canva |
| `design:content:write` | create the Canva design from it |
| `design:content:read` | export the edited design back as PNG |

BuPulse only ever exports designs it created itself from BuPulse. If you change scopes later, clients must disconnect and connect again.

## 3. Redirect URLs (Outside Canva > Redirect URLs)

Add both (up to 10 allowed). They must match exactly, including the path and no trailing slash:

- Production: `https://bupulse.com/api/canva/callback`
- Local testing: `http://127.0.0.1:3000/api/canva/callback`

Canva does **not** accept `localhost`; it only accepts `127.0.0.1` with a port. Local testing therefore has to be done by opening the app at `http://127.0.0.1:3000` (not `localhost`), and `.env` needs `NEXT_PUBLIC_SITE_URL="http://127.0.0.1:3000"` (and `CANVA_REDIRECT_URI` set to the local callback URL if you set it at all) while testing. The sign-in cookie is tied to the address, so use 127.0.0.1 for the whole test, including signing in.

## 4. Return navigation (Configuration > Canva REST APIs > Return navigation)

Turn on **Return navigation** and set the **Return URL**:

- Production: `https://bupulse.com/api/canva/return`
- Local testing: temporarily change it to `http://127.0.0.1:3000/api/canva/return` (the portal takes one return URL). BuPulse itself needs no setting for this: the return URL is only configured in the portal.

## 5. Keys (Configuration > Client ID / Generate secret)

Copy the **Client ID** and press **Generate secret** (shown once). Put them in:

- local: `.env` (`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, optional `CANVA_REDIRECT_URI`; it defaults to `NEXT_PUBLIC_SITE_URL` + `/api/canva/callback`)
- production: Cloudflare Worker secrets with the same names (see `docs/DEPLOY.md`). `ENCRYPTION_KEY` must already be set: Canva tokens are stored encrypted with it.

Never commit `.env`; the Client secret must never be shared.

## 6. Test it yourself first

While the integration is in draft, only the Canva account that owns it (and accounts on the same team) can connect. Open `http://127.0.0.1:3000`, sign in, go to Settings and press **Connect Canva**, then open a design and press **Edit in Canva**. Pressing **Return to BuPulse** in Canva saves the edit as a new design; pressing it again saves the latest state again.

## 7. Let all clients connect (public review)

1. Remove every `127.0.0.1` / `localhost` redirect URL and put the production return URL back. Canva will not accept a submission that still lists local URLs.
2. Fill in everything on Canva's submission checklist (privacy policy and terms URLs, description, screenshots, support contact) and press **Submit for review**.
3. Canva tracks the review in a Jira ticket and emails you; they may send a questionnaire and ask for a demo or changes. Canva does not publish a review time, so plan for **a few weeks** and answer their questions quickly.

Until approved, only you and your Canva team can connect.

## How it works (for developers)

- `GET /api/canva/connect` starts OAuth 2.0 authorization code with PKCE (S256). The PKCE verifier and state travel in an AES-GCM sealed, httpOnly cookie valid for 10 minutes.
- `GET /api/canva/callback` checks state, swaps the code for tokens, stores access and refresh tokens encrypted in `CanvaConnection` (one row per user). Tokens are refreshed five minutes before expiry; refresh tokens are single use. Only a rejected refresh with `invalid_grant` deletes the connection (the user is asked to reconnect); rate limits and other errors keep it. Disconnecting also revokes the token at Canva (`POST /v1/oauth/revoke`, best effort).
- `POST /api/canva/open {designId}` (20 per hour per user; locked accounts get 403) checks the design belongs to the user, uploads the PNG (`POST /v1/asset-uploads`, polled), creates a custom-size design from it (`POST /v1/designs`) and returns the `edit_url` with `correlation_state` set to a random id stored in `CanvaEdit`.
- `GET /api/canva/return?correlation_jwt=...` (30 per hour per user) verifies the JWT (RS256/ES256 only) against Canva's keys (`/v1/connect/keys`, refetched at most once a minute), checks audience, type `rti`, `nbf`, expiry, and that the `CanvaEdit` row belongs to the signed-in user and the same Canva design. It claims the row (`processingAt`) so two returns cannot save at once, exports PNG (`POST /v1/exports`, polled), downloads it only from an https canva.com address with a 25 MB cap, saves it to the `designs` bucket and creates a new `Design` row. If this takes over 30 s the user is sent to `/dashboard/designs?canva=processing` and the save finishes in the background (total budget 55 s). The `CanvaEdit` row stays for two days so Return can be pressed again.
- Components: `components/designs/edit-in-canva.tsx` (`<EditInCanva designId enabled />`, `enabled` is `isCanvaEnabled()` from `lib/canva/config`), `components/settings/canva-card.tsx`, `components/designs/canva-return-toast.tsx`.
