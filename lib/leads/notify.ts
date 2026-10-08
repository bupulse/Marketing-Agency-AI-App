import "server-only";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { sendEmail } from "@/lib/publishing/email";
import { renderInstantLeadEmail } from "./email";
import { deliverWebhook, leadEventBody } from "./webhook";

/**
 * The owner's instant email and the webhook for one new lead. Call it only after claiming the lead's
 * notifiedAt (see createLeadFromChat), so a double submit never sends twice. Each part is independent:
 * a bad webhook never stops the email and the other way round.
 */
type WebhookLead = Parameters<typeof leadEventBody>[1];

/**
 * One delivery run (3 attempts) of lead.created. Clears Lead.webhookPendingAt on success; on failure sets it
 * (keeping the first failure time) so the hourly cron can try again. Never throws.
 */
export async function sendLeadWebhook(args: {
  lead: WebhookLead;
  business: { id: string; name: string };
  webhookUrl: string;
  secretEncrypted: string;
  retryDelaysMs?: number[];
}): Promise<boolean> {
  const { lead, business } = args;
  try {
    const delivery = await deliverWebhook({
      url: args.webhookUrl,
      secret: await decrypt(args.secretEncrypted),
      event: "lead.created",
      body: leadEventBody("lead.created", lead, business),
      retryDelaysMs: args.retryDelaysMs,
    });
    if (delivery.ok) {
      await prisma.lead.updateMany({ where: { id: lead.id, webhookPendingAt: { not: null } }, data: { webhookPendingAt: null } });
    } else {
      console.warn(`[leads] webhook for business ${business.id} failed after ${delivery.attempts} attempts: ${delivery.error}`);
      await prisma.lead.updateMany({ where: { id: lead.id, webhookPendingAt: null }, data: { webhookPendingAt: new Date() } });
    }
    return delivery.ok;
  } catch (error) {
    console.error("[leads] webhook failed:", error instanceof Error ? error.message : error);
    await prisma.lead.updateMany({ where: { id: lead.id, webhookPendingAt: null }, data: { webhookPendingAt: new Date() } }).catch(() => {});
    return false;
  }
}

export async function notifyNewLead(leadId: string): Promise<{ emailed: boolean; webhook: boolean }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      business: { select: { id: true, name: true, user: { select: { email: true, deletionScheduledFor: true } }, } },
      session: { select: { messages: { orderBy: { createdAt: "desc" }, take: 6, select: { role: true, content: true } } } },
    },
  });
  if (!lead) return { emailed: false, webhook: false };
  const { business } = lead;
  const widget = await prisma.chatWidget.findUnique({ where: { businessId: business.id } });
  const result = { emailed: false, webhook: false };

  // Email and webhook run side by side, so a slow webhook never delays the email.
  await Promise.all([
    (async () => {
      if (!((widget?.notifyInstant ?? true) && business.user.email && !business.user.deletionScheduledFor)) return;
      try {
        const transcript = (lead.session?.messages ?? []).slice().reverse();
        const mail = renderInstantLeadEmail({ lead, businessName: business.name, transcript });
        result.emailed = await sendEmail({ to: business.user.email, subject: mail.subject, html: mail.html, text: mail.text });
      } catch (error) {
        console.error("[leads] instant email failed:", error instanceof Error ? error.message : error);
      }
    })(),
    (async () => {
      if (!widget?.webhookUrl || !widget.webhookSecretEncrypted) return;
      result.webhook = await sendLeadWebhook({ lead, business, webhookUrl: widget.webhookUrl, secretEncrypted: widget.webhookSecretEncrypted });
    })(),
  ]);
  return result;
}
