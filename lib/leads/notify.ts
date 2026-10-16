import "server-only";
import { prisma } from "@/lib/db";
import { alertRecipients } from "@/lib/team/recipients";
import { sendEmail } from "@/lib/publishing/email";
import { linkSiteUrl } from "@/lib/auth/request-site";
import { pushToLeadWatchers } from "@/lib/push/service";
import { leadLabel, renderInstantLeadEmail } from "./email";
import { sendWhatsappLeadAlert, whatsappConfig } from "./whatsapp";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { leadData } from "@/lib/webhooks/events";

export type NotifyResult = { emailed: boolean; webhook: boolean; /** Devices that accepted the push alert. */ pushed: number; whatsapp: boolean };

/** The push alert's text: who, and the first thing they wrote (else how to reach them). */
export function pushText(lead: { name: string | null; email: string | null; phone: string | null; message: string | null; interest: string | null }, transcript: { role: string; content: string }[]): { title: string; body: string } {
  const firstVisitorLine = transcript.find((m) => m.role === "visitor")?.content;
  const said = (lead.message || firstVisitorLine || lead.interest || lead.phone || lead.email || "Open BuPulse to see the details.").replace(/\s+/g, " ").trim();
  return { title: `New lead: ${leadLabel(lead)}`, body: said.length > 140 ? `${said.slice(0, 139)}…` : said };
}

/**
 * Every alert for one new lead: the instant email, the lead.created webhook, push to the devices that switched alerts
 * on, and WhatsApp when the admin and the owner switched it on. Call it only after claiming the lead's notifiedAt (see
 * createLeadFromChat), so a double submit never sends twice. Each channel is independent and they run side by side:
 * a slow or failing one never stops or delays the email. Webhooks are the business's endpoints on Connectors >
 * Webhooks (lib/webhooks); the old per-widget address was moved there by a migration.
 */
export async function notifyNewLead(leadId: string): Promise<NotifyResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      business: { select: { id: true, name: true, phone: true, user: { select: { email: true, deletionScheduledFor: true, suspendedAt: true } } } },
      session: { select: { messages: { orderBy: { createdAt: "desc" }, take: 6, select: { role: true, content: true } } } },
    },
  });
  if (!lead) return { emailed: false, webhook: false, pushed: 0, whatsapp: false };
  const { business } = lead;
  const widget = await prisma.chatWidget.findUnique({ where: { businessId: business.id } });
  const result: NotifyResult = { emailed: false, webhook: false, pushed: 0, whatsapp: false };
  const accountLive = !business.user.deletionScheduledFor && !business.user.suspendedAt;
  const transcript = (lead.session?.messages ?? []).slice().reverse();

  await Promise.all([
    (async () => {
      if (!((widget?.notifyInstant ?? true) && business.user.email && accountLive)) return;
      try {
        const mail = renderInstantLeadEmail({ lead, businessName: business.name, transcript });
        // The Owner, and Admins who opted in. `emailed` says whether the first (the owner's) went out.
        const recipients = await alertRecipients(business.id, business.user.email);
        const sent = await Promise.all(recipients.map((to) => sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text })));
        result.emailed = sent[0] ?? false;
      } catch (error) {
        console.error("[leads] instant email failed:", error instanceof Error ? error.message : error);
      }
    })(),
    (async () => {
      result.webhook = (await emitWebhookEvent(business.id, "lead.created", leadData(lead))) > 0;
    })(),
    // Push: each person's own devices (lib/push/service.ts). Off without VAPID keys; never throws.
    (async () => {
      if (!accountLive) return;
      try {
        const text = pushText(lead, transcript);
        result.pushed = await pushToLeadWatchers(business.id, { ...text, url: `${await linkSiteUrl()}/dashboard/leads/${encodeURIComponent(lead.id)}`, tag: `lead-${lead.id}` });
      } catch (error) {
        console.error("[leads] push alert failed:", error instanceof Error ? error.message : error);
      }
    })(),
    // WhatsApp: only while the admin has the service on and configured, and the owner switched it on (lib/leads/whatsapp.ts).
    (async () => {
      if (!accountLive || !widget?.notifyWhatsapp || !whatsappConfig()) return;
      result.whatsapp = await sendWhatsappLeadAlert({ to: widget.whatsappNumber || business.phone, lead, businessName: business.name, businessId: business.id });
    })(),
  ]);
  return result;
}
