// The events a business can subscribe to, and the JSON body each one sends. The body is
//   { event, <lead|content|post>: {...}, business: { id, name }, createdAt }
// (the lead.created shape is the one the old per-widget webhook sent, so existing receivers keep working).
// Documented in docs/WEBHOOKS.md.

export const WEBHOOK_EVENTS = ["lead.created", "content.generated", "post.published", "post.failed", "automation.action"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** "webhook.test" is only sent by the Send test button. */
export type WebhookEventName = WebhookEvent | "webhook.test";

export const EVENT_LABELS: Record<WebhookEvent, { label: string; text: string }> = {
  "lead.created": { label: "New lead", text: "Someone left their details in your website chat." },
  "content.generated": { label: "Content generated", text: "The AI wrote a new caption, script or headlines." },
  "post.published": { label: "Post published", text: "A scheduled post went live on a network." },
  "post.failed": { label: "Post failed", text: "A post could not be published and needs your attention." },
  "automation.action": { label: "Automation step", text: "An automation reached a \"Send to webhook\" step." },
};

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

const KEY: Record<WebhookEventName, string> = {
  "lead.created": "lead",
  "content.generated": "content",
  "post.published": "post",
  "post.failed": "post",
  "automation.action": "automation",
  "webhook.test": "test",
};

export type WebhookPayload = Record<string, unknown> & { event: WebhookEventName; business: { id: string; name: string }; createdAt: string };

export function buildPayload(event: WebhookEventName, data: unknown, business: { id: string; name: string }, now = new Date()): WebhookPayload {
  return { event, [KEY[event]]: data, business: { id: business.id, name: business.name }, createdAt: now.toISOString() };
}

// ---- Data shapes, so every emitter sends the same fields ----------------------------------------------------

export function leadData(lead: { id: string; name: string | null; email: string | null; phone: string | null; interest: string | null; message: string | null; source: string; status: string; pageUrl: string | null; createdAt: Date }) {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    interest: lead.interest,
    message: lead.message,
    source: lead.source,
    status: lead.status.toLowerCase(),
    pageUrl: lead.pageUrl,
    createdAt: lead.createdAt.toISOString(),
  };
}

/** The subject ids of content and posts. `projectId` stays for older integrations: it is the product's or campaign's id (the migration kept project ids). */
export function subjectIds(r: { productId?: string | null; campaignId?: string | null; projectId?: string | null }) {
  return { productId: r.productId ?? null, campaignId: r.campaignId ?? null, projectId: r.productId ?? r.campaignId ?? r.projectId ?? null };
}

export function contentData(c: { id: string; productId?: string | null; campaignId?: string | null; projectId?: string | null; caption: string; hashtags: string[]; videoScript: string; adHeadlines: string[]; language: string; createdAt: Date }) {
  return {
    id: c.id,
    ...subjectIds(c),
    caption: c.caption,
    hashtags: c.hashtags,
    videoScript: c.videoScript,
    adHeadlines: c.adHeadlines,
    language: c.language,
    createdAt: c.createdAt.toISOString(),
  };
}

export function postData(p: { id: string; network: string; status: string; text: string; hashtags: string[]; productId?: string | null; campaignId?: string | null; projectId?: string | null; permalink: string | null; scheduledAt: Date | null; publishedAt: Date | null; lastError: string | null }) {
  return {
    id: p.id,
    network: p.network,
    status: p.status.toLowerCase(),
    text: p.text,
    hashtags: p.hashtags,
    ...subjectIds(p),
    permalink: p.permalink,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    error: p.lastError,
  };
}
