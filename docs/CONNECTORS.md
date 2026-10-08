# Connectors

## Importers: Google Drive, Dropbox and Canva

Clients bring photos into the gallery (`/dashboard/gallery`, and inside every photo picker) from **Import > From Google Drive / From Dropbox / From Canva**. Choose a folder in the menu's "Save to" box first. Each file is downloaded by the server and checked like an upload: first bytes, JPEG/PNG/WebP only, 10 MB, and the 500-photo / 2 GB quota. Imports are not downscaled in the browser, so a photo over 10 MB is refused with a message. Videos and HEIC are not supported (the gallery is photos only), so the pickers only show images. Up to 20 files per import. Each connector card's Open button goes to the gallery.

Nothing long-lived is stored for Drive and Dropbox. `MediaAsset.source` records where a photo came from; a card shows "connected" once the business has imported at least once. Without its keys a connector shows "Coming soon".

### Google Drive (file picker, `drive.file` scope only)

BuPulse sees only the files the client picks, so no Google security review is needed. The access token lives in the browser for one import and is never saved. To stop BuPulse's access, the client can revoke it at <https://myaccount.google.com/permissions>.

1. Open <https://console.cloud.google.com/> and pick (or create) the project. Note its **project number** (Dashboard > Project info). That is `GOOGLE_PICKER_APP_ID`.
2. **APIs & Services > Library**: enable **Google Picker API** and **Google Drive API**.
3. **APIs & Services > Credentials > Create credentials > API key**. Restrict it: *Websites* = your site (`https://bupulse.com/*`, plus `http://localhost:3000/*` for testing), *API restrictions* = Google Picker API. That is `GOOGLE_PICKER_API_KEY`.
4. **Credentials > Create credentials > OAuth client ID > Web application**. Under **Authorized JavaScript origins** add `https://bupulse.com` (and `http://localhost:3000`). No redirect URI is needed. That is `GOOGLE_CLIENT_ID`. (If empty, `GOOGLE_YOUTUBE_CLIENT_ID` is used, so add the origins to that client instead if you want to share one.)
5. **OAuth consent screen > Data access**: add only the scope `.../auth/drive.file` (non-sensitive). Publish the app to production when ready; while it is in Testing, only listed test users can sign in.
6. Set the three env vars and redeploy.

### Dropbox (Chooser drop-in)

No sign-in on BuPulse's side. The Chooser returns temporary direct links (valid about 4 hours); the server downloads them, accepting only https links on `dropbox.com` and `dropboxusercontent.com`, following at most 3 redirects (each re-checked), with a 10 MB and 45 s limit.

1. Open <https://www.dropbox.com/developers/apps> > **Create app** > *Scoped access* > *App folder* or *Full Dropbox* (the Chooser needs no scopes; any choice works). Name it "BuPulse".
2. On the app's **Settings** page copy the **App key**. That is `DROPBOX_APP_KEY`.
3. Under **Chooser / Saver / Embedder domains** add `bupulse.com` (and `localhost` for testing).
4. Until Dropbox approves the app for production, it works for 500 linked users or fewer. Apply for production when you near that.

### Canva (import designs)

Uses the same Canva connection as "Edit in Canva" (`docs/CANVA.md`). "Import from Canva" lists the client's designs (thumbnails, search, paging), exports the chosen ones as PNGs 2048 px wide through the export-job API (page 1 of each design), and adds them to the gallery.

1. In the Canva developer portal, open the app > **Configuration > Canva REST APIs > Scopes** and tick **`design:meta:read`** (listing designs) as well as `design:content:read` (exports). The code now requests both.
2. Clients who linked Canva before this change are asked to **Reconnect Canva** the first time they open Import from Canva; no other action is needed.

### Env vars

| Variable | Where it comes from |
| --- | --- |
| `GOOGLE_PICKER_API_KEY` | Google Cloud API key (step 3) |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client (step 4) |
| `GOOGLE_PICKER_APP_ID` | Google Cloud project number (step 1) |
| `DROPBOX_APP_KEY` | Dropbox app key |
| `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` | already set for Edit in Canva |

All four new values are public identifiers, safe to send to the browser.

### Not yet tested against the real services

The Google Picker, the Dropbox Chooser and the Canva list/export calls have only run against mocked responses. First real round trip: set the keys, open the gallery, **Import**, and import one small PNG from each. The Dropbox direct-link host list is a best guess from Dropbox's docs.

## Stores and Cloudflare (Shopify, WooCommerce, Cloudflare)

Pages: `/dashboard/stores` (choose a store), `/dashboard/stores/shopify`, `/dashboard/stores/woocommerce` (connect, pick products, sync) and `/dashboard/domains` (Cloudflare). The Projects page has an "Import from Shopify/WooCommerce" button. Code is in `lib/stores/*`, `lib/cloudflare/*` and `lib/connectors/entries/{shopify,woocommerce,cloudflare}.ts`.

### How import and re-sync work

- A store product becomes a Project of type "product": title, price (free text with currency, "From $20.00" for ranges), features (category, tags, attributes), description in `details.notes`, and up to 10 photos copied into the private `media` bucket under `<userId>/projects/`.
- `ProductSync` maps `(store connection, product id)` to one Project, so importing or syncing twice updates instead of duplicating. The user picks products, or "Import all" (capped at 200). The screen imports 5 products per request and shows progress.
- **Overwrite rule (never silently overwrite an edit).** The mapping keeps a `baseline`: each field as the last sync wrote it. A re-sync replaces a field with the store's value only while the Project still equals that baseline. A field the user changed (name, price, features, description, or photos) is kept, reported as "kept your edits", and stays protected on later syncs. Photos are replaced only if the project's photo list is exactly what the last sync wrote; images are matched by source URL so unchanged photos are never downloaded again. Deleting the project removes its mapping, so re-importing it starts fresh.
- Safety: a re-sync writes a project only if it has not been saved since it was read (compare on `updatedAt`); if the user saved in between, their edit wins and the product is reported as "kept your edits". The 500-project cap is checked inside a transaction under a per-business advisory lock, so parallel imports cannot pass it.
- Subrequest budget: a Workers invocation may only make so many fetches, so each "Sync now" call handles at most 40 products and stops early at about 800 subrequests (image downloads, uploads, removals). The button keeps calling until the pass is done (`since` marks the pass start). The daily cron shares one 800 budget per call across stores and continues a half-done store in the next call.
- A product removed from the store is flagged `sourceMissing`; the Project stays.
- Re-sync runs from the "Sync now" button (up to 100 products) and daily from `/api/cron/store-sync` (03:47 UTC, 5 stores per call with `?cursor=`, driven by `worker.ts`; stores are taken stalest first by `lastAttemptAt` (never-tried first) and stamped before their work, so every store gets its turn and a failing one cannot block the rest; the schedule is in both `worker.ts` and `wrangler.jsonc`).
- Images are fetched with the SSRF guard from `lib/leads/webhook.ts`: https only, port 443, no credentials, no private or local hosts, redirects followed by hand and re-checked, 10 MB cap, type decided from the file's first bytes (JPEG, PNG, WebP). Shopify images must come from Shopify's CDN hosts. WooCommerce images may come from any public https host (shops use CDNs); `global_fetch_strictly_public` in `wrangler.jsonc` also stops public names that resolve to private addresses on Workers.
- Store keys and tokens are encrypted with `lib/crypto.ts` and never sent to the browser. A 401 or 403 from a store marks the connection "needs attention".

### Shopify: owner setup

1. Create a Partner account at <https://partners.shopify.com/>, then **Apps > Create app > Create app manually** (or `shopify app init`). Distribution: *Public* (App Store) or *Custom* per store; both use the same code.
2. **App URL**: `https://bupulse.com/dashboard/stores/shopify`.
3. **Allowed redirection URL(s)**: `https://bupulse.com/api/stores/shopify/callback` (and `http://localhost:3000/api/stores/shopify/callback` for testing).
4. **Scopes**: `read_products` only.
5. **Compliance webhooks** (mandatory for public apps): set all three, and `app/uninstalled`, to `https://bupulse.com/api/stores/shopify/webhooks`: `customers/data_request`, `customers/redact`, `shop/redact`, `app/uninstalled`. In `shopify.app.toml` this is `[webhooks]` with `compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]` and `uri = "/api/stores/shopify/webhooks"`. BuPulse also asks for `app/uninstalled` itself when a store connects. Every webhook is verified with `X-Shopify-Hmac-Sha256`; a bad signature gets 401.
6. Installs from Shopify (App Store or admin) open the App URL with `?shop&hmac&host&timestamp`. A request with a valid HMAC (at most 15 minutes old) starts OAuth immediately; the "type your shop" form is only for people who start from BuPulse, and posts from BuPulse's own origin. Nothing is connected until the callback has passed Shopify's approval screen and the HMAC, state and shop checks.
7. Copy the **Client ID** and **Client secret** into `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`, redeploy. Without them the Shopify card shows "Coming soon".
8. Test on a development store from the Partner Dashboard. Public listing needs Shopify's app review.

GDPR: BuPulse reads products only and stores no Shopify customer data, so `customers/*` webhooks have nothing to export or erase and answer 200. `shop/redact` and `app/uninstalled` delete the shop's connection and mappings (imported Projects stay, they are the merchant's content in BuPulse). Admin API version: `SHOPIFY_API_VERSION`, default `2026-07`.

### WooCommerce: nothing to register

- One-click: the "Connect" button is a server action (POST, so another website cannot start it for a signed-in owner). It sends the merchant to `<store>/wc-auth/v1/authorize?app_name=BuPulse&scope=read&user_id=<sealed state>&return_url=…&callback_url=…`. WooCommerce POSTs the consumer key and secret to `/api/stores/woocommerce/callback`. `user_id` is an AES-GCM sealed blob (user, business, store address, expiry 15 minutes); a forged or expired one gets 401, the store address is taken from it (never from the request), and the keys are tried against that store. They are then saved as **pending** only: the owner lands back on `/dashboard/stores/woocommerce`, sees "Connect <store>?" and must click to confirm (30 minute limit). Only then does the connection change, and product mappings are dropped only if the store host differs. WooCommerce requires an https callback, so the one-click way works only on a deployed https BuPulse.
- Manual keys: the same page has "Or paste your keys by hand" (WooCommerce > Settings > Advanced > REST API > Add key, Read). Used when the host blocks `/wc-auth`.
- API: `/wp-json/wc/v3/products` (paged, `status=publish`) with Basic auth, retrying with the keys as query parameters if a host strips the Authorization header. Store URL rules: https, no private hosts, no credentials.

**Signing in during a Shopify install.** An install opened while signed out goes to `/login?next=<the whole install URL>` (`proxy.ts` keeps the query). `next` must be a same-site relative path (`safeNext`), so it is not an open redirect. It is kept through Google sign-in, the sign-up confirmation email (`/auth/confirm?next=…`) and "Create an account" / "Sign in" links, and a short-lived httpOnly cookie (`bp_return`, 1 hour) carries it through `/welcome` and `/onboarding`, which end on that path instead of `/dashboard`. After sign-in the install redirect starts OAuth. Shopify's signature is only valid for 15 minutes, so a sign-up that waits longer on its confirmation email lands on the normal Shopify page, where the shop can be typed.

Disconnect, Confirm and Cancel use a server action followed by a full page load (not a router redirect), so the page always shows the new state.

### Cloudflare: owner and user setup

No BuPulse-side registration: Cloudflare has no general third-party OAuth, so each user pastes an API token. The page links to a pre-filled token page (`https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=…`) and lists the steps. The token needs **Zone > Zone > Read** and **Zone > Zaraz > Edit**. It is verified with `GET /user/tokens/verify`, then stored encrypted and never shown again. (Use a *User* API token; account-owned tokens verify on a different endpoint.)

**Install method: Zaraz "Custom HTML" tool.** "Install chat" reads the zone's Zaraz config, adds one tool named "BuPulse chat widget (<widget key>)" (so two businesses on one zone never touch each other's tool) (the widget script line, fired on pageview), writes the config back and publishes it, then reads it back to confirm (on updates as well as first installs). It also adds the domain to the chat widget's allowed websites. Running it again changes nothing (the tool is found by name). "Remove" deletes only that tool. Why not the alternatives: **Snippets** are not available on the Free plan; an HTML-rewriting **Worker route** needs Workers permissions and puts the whole site behind the Free plan's 100,000 requests a day limit. Zaraz works on the Free plan with a single permission, and other tools and triggers are passed through unchanged. Limits: the domain must be proxied through Cloudflare (orange cloud), and a site whose pages are not proxied will not show the chat. If Cloudflare refuses the change (no Zaraz permission, Zaraz unavailable), nothing is changed and the screen shows the code to paste plus a link to the install guides on Website chat. "Live" means the widget has loaded on that domain (`ChatWidget.lastSeenHost`); "Added" means installed but not seen yet. Disconnecting forgets the token but leaves installed chats on the sites (Remove them first to take them down).

### Env vars

| Variable | Where it comes from |
| --- | --- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Shopify Partner Dashboard > app > Client credentials |
| `SHOPIFY_API_VERSION` (optional) | Admin API version, default `2026-07` |

### Not yet tested against the real services

Shopify (OAuth, GraphQL, webhooks), WooCommerce and Cloudflare have only run against mocked responses and, for the screens, seeded data. The Cloudflare Zaraz tool shape (`type: "custom-html"`, action `data.htmlCode`) follows Cloudflare's published config schema but has not been run against a real zone; the permission names in the token link (`zone` read, `zaraz` edit) are likewise unconfirmed. First real round trip: create a token, press Install chat on a test zone, open the site, then check that "Live" appears. If Cloudflare rejects the shape, adjust `buildTool` in `lib/cloudflare/zaraz.ts` (one function).
