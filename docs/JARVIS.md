# Jarvis: admin API and MCP server

Jarvis (or any script) can read BuPulse's numbers and run admin actions through two doors that share one code path
(`lib/admin/service.ts`, tools in `lib/admin/tools.ts`):

- **MCP server:** `https://bupulse.com/api/mcp` (for adding BuPulse to Jarvis as a connector)
- **REST API:** `https://bupulse.com/api/admin/v1/…`

Both use the same admin key, the same validation, the same rate limit and the same audit log.

## 1. Create a key

1. Sign in to `/admin` (admin@bupulse.com, with the 6-digit code from your authenticator app).
2. Open **Jarvis**, give the key a name, optionally add the IP addresses Jarvis calls from (one per line; exact
   addresses or IPv4 ranges like `203.0.113.0/24`), and press **Create**.
3. Copy the key now (`bpj_live_…`). It is shown once; only a SHA-256 hash is stored.
4. **Rotate** issues a new key with the same name and allow-list and revokes the old one at once. **Revoke** stops a key immediately.

The IP check uses the `cf-connecting-ip` header that Cloudflare sets, so it only means something on the real site.
Each key is limited to 120 requests a minute.

## 2. Add it to Jarvis as a connector

- **URL:** `https://bupulse.com/api/mcp`
- **Transport:** Streamable HTTP (the server is stateless; every call is a JSON-RPC `POST` answered with JSON)
- **Auth:** header `Authorization: Bearer bpj_live_…`
- Browsers cannot call it: a request with an `Origin` header is refused unless it is bupulse.com or listed in the
  `MCP_ALLOWED_ORIGINS` environment variable (comma-separated). Server-to-server clients send no `Origin`.

Check the connection by asking Jarvis "how did BuPulse do this week and what's working?" (it calls `weekly_report` and `get_whats_working`).

## 3. Tools

Every tool has a description and JSON schema; `GET /api/admin/v1/tools` or MCP `tools/list` shows them. Dates are `YYYY-MM-DD` (UTC). Money is USD cents.
Analytics tools take `from`/`to` or `days` (default 7).

**Read**

| Tool | What it returns |
|---|---|
| `get_overview` | Visits, sign-ups, trials, paid, MRR, revenue, costs, profit, with the previous period |
| `get_metrics` | Daily series for chosen metric keys |
| `get_funnel` | Visit → sign-up → … → paid drop-off |
| `get_revenue`, `get_costs`, `get_profit` | Money by day and total |
| `get_top_content`, `get_whats_working` | Best posts; best industries, sources, pages, features |
| `weekly_report` | The weekly summary (default: last 7 full days) |
| `list_users`, `get_user` | Users with plan, status, usage, last activity; one user in detail |
| `list_businesses`, `get_business` | Same for businesses |
| `list_posts` | Posts across customers, filter by status/network/business |
| `get_errors` | The server error log |
| `get_audit_log` | Every admin action with before and after |
| `get_approval`, `list_approvals` | Money requests and their outcome |
| `list_feature_flags` | Flags |

**Actions** (run immediately, audited)

| Tool | Notes |
|---|---|
| `extend_trial` | 1–90 days, trial users only |
| `suspend_user` | **`confirm: true` required.** Blocks sign-in and all app, API and publishing use; data is kept |
| `restore_user` | Lifts a suspension |
| `set_feature_flag` | Switch, rollout percentage, per-user overrides |
| `send_announcement` | Dashboard banner for everyone or chosen plans |
| `update_plan_limits` | **`confirm: true` required.** Runtime override of `lib/plans.ts` limits, live within ~30 s |
| `rerun_failed_post` | Only `FAILED` posts, through the publishing engine's retry. Never `NEEDS_ACTION` (it may already be live) |

**Money actions: approval requests only**

| Tool | Notes |
|---|---|
| `issue_refund` | Full or partial (`amountMinor`) Paddle refund. The payment is looked up when you ask and recorded (transaction id, currency, amount); the owner approves exactly that payment. Needs `idempotencyKey` |
| `change_plan` | To `STANDARD`/`PRO`: Paddle subscription change. Needs `idempotencyKey`. To `TRIAL`: applied now, needs `confirm: true` |

## 4. Safety rules

- **Money never moves from Jarvis.** `issue_refund` and `change_plan` (paid) only create an approval with status `pending` and
  return `{ id, status }`. Nothing happens until the owner presses **Approve** in the admin console (approvals badge in the menu).
  Approving runs it exactly once; Reject discards it; unapproved requests expire after 7 days. Poll `get_approval(id)`
  for `executed`, `failed` (Paddle refused; safe to ask again) or `needs_check` (Paddle may have acted, for example it answered and a later step
  failed, or the call timed out; check Paddle before anything else; it is never retried automatically).
- **Idempotency keys.** Money tools need a unique key (8–128 characters: letters, numbers, `. _ : -`). Sending the same key
  again returns the same approval (`replayed: true`); the same key with different details is a `409`.
- **Confirm.** `suspend_user` and `update_plan_limits` are refused without `confirm: true`.
- **Audit.** Every action, including approval requests and the owner's approve/reject, writes an `AuditLog` row
  (actor `jarvis:<keyId>` or `admin`, target, before, after, IP). The table is append-only: the database refuses edits and deletes.
- The admin account cannot be suspended. A refund is only sent for a transaction that belongs to that user's Paddle customer.
- If an approval shows `approved` for a long time, the server stopped between claiming and finishing it. It is never retried automatically: check Paddle, then request again with a new key.
- One JSON-RPC message per MCP request (batches are refused), so every tool call counts against the 120 per minute limit.

## 5. curl examples

```bash
KEY=bpj_live_...
BASE=https://bupulse.com

# MCP: initialize, list tools, call a tool
curl -s $BASE/api/mcp -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s $BASE/api/mcp -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s $BASE/api/mcp -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"weekly_report","arguments":{}}}'

# REST: reads are GET shortcuts, anything can be POSTed to /tools/{name}
curl -s "$BASE/api/admin/v1/overview?days=30" -H "Authorization: Bearer $KEY"
curl -s "$BASE/api/admin/v1/users?q=bakery&limit=10" -H "Authorization: Bearer $KEY"
curl -s "$BASE/api/admin/v1/posts?status=FAILED" -H "Authorization: Bearer $KEY"
curl -s $BASE/api/admin/v1/tools/extend_trial -H "Authorization: Bearer $KEY" \
  -d '{"userId":"<user uuid>","days":7}'
curl -s $BASE/api/admin/v1/tools/suspend_user -H "Authorization: Bearer $KEY" \
  -d '{"userId":"<user uuid>","reason":"chargeback","confirm":true}'

# Money: creates a pending approval; the owner approves in the console
curl -s $BASE/api/admin/v1/tools/issue_refund -H "Authorization: Bearer $KEY" \
  -d '{"userId":"<user uuid>","reason":"double charge","idempotencyKey":"refund-2026-10-001"}'
# -> {"result":{"id":"…","status":"pending","kind":"issue_refund","replayed":false,"message":"Waiting for the owner…"}}
curl -s $BASE/api/admin/v1/approvals/<id> -H "Authorization: Bearer $KEY"
```

REST errors are JSON: `{ "error": { "code", "message" } }` with codes `unauthorized` (401), `ip_not_allowed` (403),
`rate_limited` (429, with `Retry-After`), `invalid` / `confirm_required` / `idempotency_required` (400), `not_found` (404),
`conflict` (409). In MCP, a failed tool returns `isError: true` with the same code at the start of the text; unknown tools
and methods are JSON-RPC errors (`-32602`, `-32601`).

## 6. For developers

- Add a tool in `lib/admin/tools.ts` (zod schema + one call into `lib/admin/service.ts`); REST and MCP pick it up.
- The admin console calls `lib/admin/service.ts` directly with `consoleContext()`. Only the console context can `approveAction` / `rejectAction`.
- App code: `isEnabled(flag, userId)` (`lib/admin/flags.ts`) and `getActiveAnnouncements(user)` (`lib/admin/service.ts`).
- Tests: `tests/admin/`. Migration: `20261009030000_admin_jarvis`. Owner setup: nothing beyond `ADMIN_EMAILS`; `MCP_ALLOWED_ORIGINS` only if a browser-based client is ever used.
