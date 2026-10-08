// The lead.created webhook body. Signing, the SSRF guard and delivery live in lib/webhooks/core.ts and are
// re-exported here so existing imports keep working.
export * from "@/lib/webhooks/core";

export type WebhookLead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  interest: string | null;
  message: string | null;
  source: string;
  status: string;
  pageUrl: string | null;
  createdAt: Date;
};

/** The JSON body of lead.created. */
export function leadEventBody(event: "lead.created" | "lead.test", lead: WebhookLead, business: { id: string; name: string }, now = new Date()): string {
  return JSON.stringify({
    event,
    lead: {
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
    },
    business: { id: business.id, name: business.name },
    createdAt: now.toISOString(),
  });
}
