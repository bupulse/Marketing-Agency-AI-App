import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/publishing/email";
import { renderInstantLeadEmail } from "./email";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { leadData } from "@/lib/webhooks/events";

/**
 * The owner's instant email and the lead.created webhook for one new lead. Call it only after claiming the lead's
 * notifiedAt (see createLeadFromChat), so a double submit never sends twice. Each part is independent:
 * a bad webhook never stops the email and the other way round. Webhooks are the business's endpoints on
 * Connectors > Webhooks (lib/webhooks); the old per-widget address was moved there by a migration.
 */
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
      result.webhook = (await emitWebhookEvent(business.id, "lead.created", leadData(lead))) > 0;
    })(),
  ]);
  return result;
}
