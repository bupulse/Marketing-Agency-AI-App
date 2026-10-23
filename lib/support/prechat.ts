import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { turnstileEnabled, verifyTurnstile } from "@/lib/widget/turnstile";
import { cleanEmail, cleanPhone } from "@/lib/widget/detect";
import type { prechatBody, VisitResponse } from "./contract";
import { SupportError, limit } from "./http";
import { SUPPORT_LIMITS } from "./limits";
import { broadcast } from "./realtime";
import type { VisitorSession } from "./visits";

// The pre-chat form on public pages (docs/SUPPORT_CHAT.md section 1): name, email, business and an optional WhatsApp
// number. The visitor becomes one of BuPulse's own leads: a ContactRequest of kind "support_chat" (the public site's
// requests to BuPulse; ContactRequest has no "source" column, the kind is the source). The same email within 30 days
// reuses its row, so a visitor who fills the form on two visits is one lead.

export const SUPPORT_LEAD_KIND = "support_chat";
const LEAD_REUSE_MS = 30 * 24 * 60 * 60 * 1000;

export async function submitPrechat(session: VisitorSession, raw: z.infer<typeof prechatBody>, ctx: { ip: string | null }): Promise<{ me: VisitResponse["me"] }> {
  await limit(`support:prechat:${session.visitorId}`, SUPPORT_LIMITS.prechat);
  if (turnstileEnabled()) {
    if (!raw.turnstileToken) throw new SupportError(403, "challenge_required", "Please confirm you are not a robot.");
    if (!(await verifyTurnstile(raw.turnstileToken, ctx.ip))) throw new SupportError(403, "challenge_failed", "The robot check did not pass. Please try again.");
  }
  const email = cleanEmail(raw.email);
  if (!email) throw new SupportError(400, "invalid_email", "That email address does not look right.");
  const phone = raw.whatsapp?.trim() ? cleanPhone(raw.whatsapp) : undefined;
  if (raw.whatsapp?.trim() && !phone) throw new SupportError(400, "invalid_phone", "That WhatsApp number does not look right.");
  const name = raw.name.trim().slice(0, 120);
  const business = raw.business.trim().slice(0, 160);

  const recent = await prisma.contactRequest.findFirst({ where: { kind: SUPPORT_LEAD_KIND, email, createdAt: { gt: new Date(Date.now() - LEAD_REUSE_MS) } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const lead = recent
    ? await prisma.contactRequest.update({ where: { id: recent.id }, data: { name, businessName: business, ...(phone ? { phone } : {}), handled: false }, select: { id: true } })
    : await prisma.contactRequest.create({ data: { kind: SUPPORT_LEAD_KIND, name, email, phone: phone ?? null, businessName: business, message: `Support chat on ${session.surface === "bio" ? "a link-in-bio page" : "the public site"}.` }, select: { id: true } });

  const visitor = await prisma.supportVisitor.update({
    where: { id: session.visitorId },
    data: { name, email, businessName: business, ...(phone ? { phone } : {}), leadId: lead.id },
    select: { name: true, email: true, businessName: true, userId: true },
  });
  await broadcast({ type: "visitor.changed", visitId: session.visitId }, { visitors: true });
  return { me: { name: visitor.name, email: visitor.email, signedIn: !!visitor.userId, businessName: visitor.businessName, needsForm: false } };
}

/** The lead's first question, once the chat starts, so Admin sees what they asked. */
export async function noteLeadQuestion(leadId: string | null, text: string) {
  if (!leadId || !text.trim()) return;
  await prisma.contactRequest.updateMany({ where: { id: leadId, message: { startsWith: "Support chat on" } }, data: { message: text.trim().slice(0, 4000) } });
}
