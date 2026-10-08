# BuPulse REST API (v1)

Read your projects, generated content, posts and leads, update leads, and create draft posts from your own tools. **Pro plan only.** Create keys in the dashboard under **Connectors > API** (`/dashboard/connectors/api`).

Base address: `https://bupulse.com/api/v1`

## Keys

- A key looks like `bp_live_...` and is shown **once**. BuPulse stores only its SHA-256 hash.
- Send it on every request: `Authorization: Bearer bp_live_...`
- Scopes (choose when creating the key):

| Scope | Allows |
| --- | --- |
| `projects:read` | `GET /projects`, `GET /projects/:id` |
| `content:read` | `GET /content`, `GET /content/:id` |
| `posts:read` | `GET /posts`, `GET /posts/:id` |
| `posts:write` | `POST /posts` (creates a **draft**; scheduling and publishing stay in the dashboard) |
| `leads:read` | `GET /leads`, `GET /leads/:id` |
| `leads:write` | `PATCH /leads/:id` (status and notes) |

- A key only ever sees the data of the business that made it.
- If the business leaves the Pro plan (or a payment fails), its keys stop working (`403 plan_required`) but are not deleted; they work again after upgrading.
- Limit: **60 requests per minute per key**. Over the limit you get `429` with a `Retry-After` header (seconds).
- Revoke a key in the dashboard; it stops working immediately.

## Errors

Always JSON: `{ "error": { "code": "...", "message": "..." } }`

| Status | code |
| --- | --- |
| 400 | `invalid_request` |
| 401 | `unauthorized` (missing, wrong or revoked key) |
| 403 | `insufficient_scope`, `plan_required` |
| 404 | `not_found` (also for ids that belong to another business) |
| 429 | `rate_limited` |
| 500 | `server_error` |

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
| `/projects` | `type` (product, service, event, offer, listing, ...) |
| `/content` | `projectId` |
| `/posts` | `status` (draft, pending_approval, scheduled, publishing, published, needs_action, failed, cancelled), `network`, `projectId` |
| `/leads` | `status` (new, contacted, won, lost), `source`, `q` (search text), `since` (ISO date) |

```bash
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/leads?status=new&since=2026-10-01T00:00:00Z"
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/posts?status=failed"
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/projects"
curl -s -H "Authorization: Bearer $KEY" "https://bupulse.com/api/v1/content?projectId=cm1proj"
```

## One item

`GET /leads/:id` (and the same for projects, content, posts) returns `{ "data": {...} }`.

```bash
curl -s -H "Authorization: Bearer $KEY" https://bupulse.com/api/v1/leads/cm1lead
```

```json
{ "data": { "id": "cm1lead", "name": "Amina", "email": "amina@example.com", "phone": "+250700000000",
  "interest": "Wedding photos", "message": null, "source": "website_chat", "status": "new", "notes": null,
  "pageUrl": "https://example.com", "createdAt": "2026-10-08T10:00:00.000Z", "updatedAt": "2026-10-08T10:00:00.000Z" } }
```

## Update a lead

`PATCH /leads/:id` with `status` (new, contacted, won, lost) and/or `notes` (text up to 5000 characters, `null` to clear). Needs `leads:write`.

```bash
curl -s -X PATCH -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"status":"contacted","notes":"Called on Friday, wants a quote"}' \
  https://bupulse.com/api/v1/leads/cm1lead
```

## Create a draft post

`POST /posts` with `network` (instagram, facebook, linkedin, tiktok, youtube), `text`, and optionally `hashtags` (array), `link`, `projectId`. Needs `posts:write`. The post is saved as a **draft** without an account; open it in the BuPulse calendar to pick the account, check it and schedule it.

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"network":"instagram","text":"New arrivals this week!","hashtags":["#new"],"projectId":"cm1proj"}' \
  https://bupulse.com/api/v1/posts
```

Photos are not returned as links (they live in your private storage); projects and posts show `photoCount` / `mediaCount`.

## Developer notes

Code: `lib/api/` (keys, auth and rate limit, paging, serializers) and `app/api/v1/*`. The routes are excluded from the session proxy in `proxy.ts` (they use bearer keys, never cookies).
