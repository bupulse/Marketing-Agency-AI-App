# Outgoing webhooks

BuPulse can POST an event to your own address (or Zapier, Make, n8n) whenever something happens. Webhooks are on every plan, including the free trial. Set them up in the dashboard under **Connectors > Webhooks** (`/dashboard/connectors/webhooks`). Up to 5 endpoints per business.

**Zapier:** create a Zap with the trigger *Webhooks by Zapier > Catch Hook*, copy its address into BuPulse, press *Send test event*, then pick the fields in Zapier.
**Make:** add the module *Webhooks > Custom webhook*, copy its address into BuPulse, press *Send test event*. Make learns the fields from the test.
Both give an https address, which is all BuPulse needs. You do not have to verify the signature in Zapier or Make.

## Events

| Event | When |
| --- | --- |
| `lead.created` | A visitor left their details in the website chat. |
| `content.generated` | The AI wrote a new caption, script and headlines for a project. |
| `post.published` | A scheduled post went live on a network. |
| `post.failed` | A post could not be published (the owner also gets an email). |
| `webhook.test` | Only from the *Send test event* button. |

Each endpoint chooses its events.

## Request

`POST` with `content-type: application/json` and these headers:

```
X-BuPulse-Event:     lead.created
X-BuPulse-Signature: t=1791450000,v1=5b1d...   (hex)
User-Agent:          BuPulse-Webhooks/1.0
```

Body: `{ "event", "<lead|content|post>", "business": { "id", "name" }, "createdAt" }`

```jsonc
// lead.created
{ "event": "lead.created",
  "lead": { "id": "cm...", "name": "Amina", "email": "amina@example.com", "phone": "+250700000000",
            "interest": "Wedding photos in March", "message": null, "source": "website_chat",
            "status": "new", "pageUrl": "https://example.com/pricing", "createdAt": "2026-10-08T10:00:00.000Z" },
  "business": { "id": "cm...", "name": "Kigali Studio" }, "createdAt": "2026-10-08T10:00:01.000Z" }

// content.generated
{ "event": "content.generated",
  "content": { "id": "cm...", "projectId": "cm...", "caption": "...", "hashtags": ["#..."], "videoScript": "...",
               "adHeadlines": ["..."], "language": "English", "createdAt": "..." },
  "business": { ... }, "createdAt": "..." }

// post.published / post.failed
{ "event": "post.published",
  "post": { "id": "cm...", "network": "instagram", "status": "published", "text": "...", "hashtags": [],
            "projectId": "cm...", "permalink": "https://...", "scheduledAt": "...", "publishedAt": "...", "error": null },
  "business": { ... }, "createdAt": "..." }
```

For `post.failed`, `status` is `failed` and `error` says why.

## Verifying the signature

`v1` is `HMAC-SHA256(secret, "<t>.<raw body>")` in hex, where `secret` is the `whsec_...` value shown once when you add the endpoint (or after *New secret*), and `<raw body>` is the exact bytes received. Recompute it, compare in constant time, and reject a `t` older than 5 minutes.

```js
// Node 18+, Express: use express.raw({ type: "application/json" }) so req.body is the raw Buffer
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, rawBody, header, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const given = Buffer.from(parts.v1 ?? "", "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}

app.post("/bupulse", express.raw({ type: "application/json" }), (req, res) => {
  if (!verify(process.env.BUPULSE_WEBHOOK_SECRET, req.body.toString("utf8"), req.header("x-bupulse-signature") ?? "")) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(req.body);
  // ...handle event.event
  res.sendStatus(200);
});
```

## Delivery, retries and the log

- Answer with any `2xx` within 5 seconds. Redirects are followed only to safe https addresses.
- The first send happens right after the event, in the background (3 tries, after 1 s and 4 s). It never slows down or blocks what happened in BuPulse.
- Timeouts, `429` and `5xx` answers are tried again by an hourly job with growing waits (about 1 h, 2 h, 4 h, then every 8 h) until 24 hours after the event, then marked *Failed*. Other `4xx` answers are not retried.
- Delivery is **at least once**. Receivers should treat events as idempotent (dedupe on `lead.id`, `post.id` or `content.id` together with the event name).
- **Connectors > Webhooks** lists the last 50 deliveries with status, HTTP code and number of tries, and a *Retry* button. Deliveries are deleted after 30 days.
- Only https on port 443 is allowed, never a private or local network address (SSRF guard).

## Moved: the old lead webhook

Before Phase 7 the website chat settings had one lead webhook. Migration `20261008060000_connectors_hub_webhooks_api` moved every such address into an endpoint that listens to `lead.created`, with the **same secret**, so receivers need no change and leads are not sent twice. The `lead.created` body is unchanged.

The migration does **not** clear the old `ChatWidget.webhookUrl` / `webhookSecretEncrypted` columns, because migrations run a few minutes before the new Worker is live and an old Worker that saw them empty would lose leads. The new code never reads them. Leads the old system had marked pending (`Lead.webhookPendingAt`), including ones an old Worker marks during the deploy window, are adopted by the hourly job as normal deliveries. **TODO: a follow-up migration after the deploy is live clears or drops those two columns and `Lead.webhookPendingAt`.**

## Developer notes

Code is in `lib/webhooks/` (`core.ts` signing, SSRF guard and the send; `emit.ts` the hook used by lead, content and publishing code; `delivery.ts` and `retry.ts` the retries; `endpoints.ts` the dashboard operations). The hourly job is `/api/cron/leads-digest` (cron `37 * * * *`).
For browser tests against a listener on this computer, set `BUPULSE_TEST_ALLOW_LOCAL_WEBHOOKS=1`. It only works while `NEXT_PUBLIC_SITE_URL` is itself `localhost`/`127.0.0.1`, so production ignores it. Never set it in production.
