# BuPulse REST API (v1)

Read your products, campaigns, generated content, posts and leads, update leads, and create draft posts from your own tools. **Plans with the `apiAccess` feature only** (Pro today; see `docs/PLANS.md`). Create keys in the dashboard under **Connectors > API** (`/dashboard/connectors/api`).

Base address: `https://bupulse.com/api/v1`

## Keys

- A key looks like `bp_live_...` and is shown **once**. BuPulse stores only a peppered hash of it: HMAC-SHA256 with a server secret (`API_KEY_PEPPER`, or a key derived from `ENCRYPTION_KEY` when that is not set), so a copy of the database alone cannot be used to test guessed keys. Admin (Jarvis) keys are hashed the same way.
  - **Transition:** keys created before the pepper (Phase 9) were stored as plain SHA-256. They keep working: a key is looked up by its peppered hash, then by its plain hash, and a key found the second way is rehashed on that request. Nothing to run.
  - **Changing the pepper** (or `ENCRYPTION_KEY` while `API_KEY_PEPPER` is unset) makes every key invalid; owners must create new ones. Set `API_KEY_PEPPER` once, before go-live, and do not rotate it with `ENCRYPTION_KEY`.
- Send it on every request: `Authorization: Bearer bp_live_...`
- Scopes (choose when creating the key):

| Scope | Allows |
| --- | --- |
| `projects:read` | `GET /products`, `GET /products/:id`, `GET /campaigns`, `GET /campaigns/:id`, and the deprecated `GET /projects`, `GET /projects/:id` |
| `content:read` | `GET /content`, `GET /content/:id` |
| `posts:read` | `GET /posts`, `GET /posts/:id` |
| `posts:write` | `POST /posts` (creates a **draft**; scheduling and publishing stay in the dashboard) |
| `leads:read` | `GET /leads`, `GET /leads/:id` |
| `leads:write` | `PATCH /leads/:id` (status and notes) |

- A key only ever sees the data of the business that made it.
- If the business moves to a plan without `apiAccess` (or a payment fails), its keys stop working (`403 plan_required`) but are not deleted; they work again once the feature is back in the plan. While BuPulse cannot check the plan at all (a short outage) every call answers `503 feature_unavailable` instead: retry later, nothing has changed.
- Some writes need more than `apiAccess`: reading your own data always works, but `PATCH /leads/:id` needs the **website chat** feature and `POST /posts` needs the **calendar** feature in your plan. Without it the call answers `403 feature_required` (the message names the feature); `503 feature_unavailable` while the feature is paused on our side.
- Limit: **60 requests per minute per key**. Over the limit you get `429` with a `Retry-After` header (seconds).
- Revoke a key in the dashboard; it stops working immediately.

## Errors

Always JSON: `{ "error": { "code": "...", "message": "..." } }`

| Status | code |
| --- | --- |
| 400 | `invalid_request` |
| 401 | `unauthorized` (missing, wrong or revoked key) |
| 403 | `insufficient_scope`, `plan_required`, `feature_required` |
| 404 | `not_found` (also for ids that belong to another business) |
| 429 | `rate_limited` |
| 500 | `server_error` |
| 503 | `feature_unavailable` (the plan could not be checked, or the feature is paused; retry later) |

## Lists and paging

Lists return newest first: `{ "data": [...], "nextCursor": "..." | null }`. Pass `limit` (1 to 100, default 25) and `cursor` (the previous `nextCursor`) to get the next page.

```bash
KEY=bp_live_xxxxxxxx
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/leads?limit=2"
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/leads?limit=2&cursor=cm1abc"
```

Filters:

| Endpoint | Query parameters |
| --- | --- |
| `/products` | `kind` (physical, digital, service), `status` (active, draft, archived) |
| `/campaigns` | `type` (event, offer, promotion, launch, other) |
| `/projects` (deprecated) | `type`: product, listing, service, project list products; event, offer, other list campaigns |
| `/content` | `productId`, `campaignId`, `projectId` (deprecated: matches either) |
| `/posts` | `status` (draft, pending_approval, scheduled, publishing, published, needs_action, failed, cancelled), `network`, `productId`, `campaignId`, `projectId` (deprecated) |
| `/leads` | `status` (new, contacted, won, lost), `source`, `q` (search text), `since` (ISO date) |

```bash
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/leads?status=new&since=2026-10-01T00:00:00Z"
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/posts?status=failed"
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/products?kind=service"
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/content?productId=cm1prod"
```

## One item

`GET /leads/:id` (and the same for products, campaigns, content, posts) returns `{ "data": {...} }`.

### Products, campaigns and the old projects

Projects became **products** and **campaigns** in the Knowledge base (12 October 2026, `docs/KNOWLEDGE_BASE.md`). Each
project's id is now the id of the product or campaign it became, so stored ids keep working.

- A product: `{ id, kind, name, category, summary, description, price: { model, amountMinor, currency, note, label }, sellingPoints, features, targetCustomer, status, photoCount, createdAt, updatedAt }`. `amountMinor` is in the currency's smallest unit (francs for RWF, cents for USD); `label` is the price as people read it ("From 15,000 RWF").
- A campaign: `{ id, type, name, description, startsOn, endsOn, priceInfo, highlights, productIds, status, photoCount, createdAt, updatedAt }` (dates as `YYYY-MM-DD`).
- `GET /projects` and `/projects/:id` are **deprecated** and answer in the old shape (`type`, `title`, `price` text, `features`, `photoCount`), filled from the product or campaign.
- Content and posts carry `productId` and `campaignId`; their `projectId` is kept (the product's or campaign's id) for older scripts.

```bash
curl -s -H "Authorization: Bearer $KEY" https://bupulse.com/api/v1/leads/cm1lead
```

```json
{ "data": { "id": "cm1lead", "name": "Amina", "email": "amina@example.com", "phone": "+250700000000",
  "interest": "Wedding photos", "message": null, "source": "website_chat", "status": "new", "notes": null,
  "pageUrl": "https://example.com", "createdAt": "2026-10-08T10:00:00.000Z", "updatedAt": "2026-10-08T10:00:00.000Z" } }
```

## Update a lead

`PATCH /leads/:id` with `status` (new, contacted, won, lost) and/or `notes` (text up to 5000 characters, `null` to clear). Needs `leads:write` and the **website chat** feature in your plan (`403 feature_required` without it; reading leads still works).

```bash
curl -s -X PATCH -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"status":"contacted","notes":"Called on Friday, wants a quote"}' \
  https://bupulse.com/api/v1/leads/cm1lead
```

## Create a draft post

`POST /posts` with `network` (instagram, facebook, linkedin, tiktok, youtube), `text`, and optionally `hashtags` (array), `link`, and `productId` or `campaignId` (`projectId` still works: it is the same id). Needs `posts:write` and the **calendar** feature in your plan (`403 feature_required` without it). The post is saved as a **draft** without an account; open it in the BuPulse calendar to pick the account, check it and schedule it.

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"network":"instagram","text":"New arrivals this week!","hashtags":["#new"],"productId":"cm1prod"}' \
  https://bupulse.com/api/v1/posts
```

Photos are not returned as links (they live in your private storage); products, campaigns and posts show `photoCount` / `mediaCount`.

## Developer notes

Code: `lib/api/` (keys, auth and rate limit, paging, serializers) and `app/api/v1/*`. The routes are excluded from the session proxy in `proxy.ts` (they use bearer keys, never cookies).
