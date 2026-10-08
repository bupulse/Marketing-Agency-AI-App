import "server-only";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { LeadError } from "./service";
import { checkWebhookUrl, deliverWebhook, generateWebhookSecret, leadEventBody } from "./webhook";

export type NotificationSettings = { notifyInstant: boolean; notifyDaily: boolean; webhookUrl: string | null; hasWebhookSecret: boolean };

/** Without a widget row the defaults apply: both emails on, no webhook. */
export async function getNotificationSettings(businessId: string): Promise<NotificationSettings> {
  const widget = await prisma.chatWidget.findUnique({ where: { businessId } });
  return {
    notifyInstant: widget?.notifyInstant ?? true,
    notifyDaily: widget?.notifyDaily ?? true,
    webhookUrl: widget?.webhookUrl ?? null,
    hasWebhookSecret: Boolean(widget?.webhookSecretEncrypted),
  };
}

export async function saveEmailToggles(businessId: string, toggles: { notifyInstant: boolean; notifyDaily: boolean }): Promise<void> {
  await prisma.chatWidget.upsert({ where: { businessId }, create: { businessId, ...toggles }, update: toggles });
}

/** Saves the webhook address. The first time (or after a rotate) a secret is made; it is returned once and never again. */
export async function saveWebhook(businessId: string, rawUrl: string): Promise<{ secret: string | null }> {
  const url = rawUrl.trim();
  if (!url) {
    await prisma.chatWidget.updateMany({ where: { businessId }, data: { webhookUrl: null, webhookSecretEncrypted: null } });
    return { secret: null };
  }
  const check = checkWebhookUrl(url);
  if (!check.ok) throw new LeadError("invalid", check.error);
  const existing = await prisma.chatWidget.findUnique({ where: { businessId }, select: { webhookSecretEncrypted: true } });
  if (existing?.webhookSecretEncrypted) {
    await prisma.chatWidget.update({ where: { businessId }, data: { webhookUrl: check.url.toString() } });
    return { secret: null };
  }
  const secret = generateWebhookSecret();
  const webhookSecretEncrypted = await encrypt(secret);
  await prisma.chatWidget.upsert({
    where: { businessId },
    create: { businessId, webhookUrl: check.url.toString(), webhookSecretEncrypted },
    update: { webhookUrl: check.url.toString(), webhookSecretEncrypted },
  });
  return { secret };
}

/** A new secret for the saved webhook; the old one stops working at once. */
export async function rotateWebhookSecret(businessId: string): Promise<{ secret: string }> {
  const widget = await prisma.chatWidget.findUnique({ where: { businessId }, select: { webhookUrl: true } });
  if (!widget?.webhookUrl) throw new LeadError("invalid", "Save a webhook address first.");
  const secret = generateWebhookSecret();
  await prisma.chatWidget.update({ where: { businessId }, data: { webhookSecretEncrypted: await encrypt(secret) } });
  return { secret };
}

/** "Send test": one lead.test event, a single attempt, and a plain answer for the owner. */
export async function sendTestWebhook(businessId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const [widget, business] = await Promise.all([
    prisma.chatWidget.findUnique({ where: { businessId } }),
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } }),
  ]);
  if (!business || !widget?.webhookUrl || !widget.webhookSecretEncrypted) throw new LeadError("invalid", "Save a webhook address first.");
  const now = new Date();
  const body = leadEventBody(
    "lead.test",
    { id: "lead_test", name: "Test Visitor", email: "test@example.com", phone: "+250700000000", interest: "This is a test from BuPulse", message: null, source: "website_chat", status: "NEW", pageUrl: null, createdAt: now },
    business,
    now,
  );
  const result = await deliverWebhook({ url: widget.webhookUrl, secret: await decrypt(widget.webhookSecretEncrypted), event: "lead.test", body, retryDelaysMs: [] });
  return { ok: result.ok, status: result.status, error: result.error };
}
