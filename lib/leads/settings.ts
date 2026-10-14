import "server-only";
import { prisma } from "@/lib/db";

export type NotificationSettings = { notifyInstant: boolean; notifyDaily: boolean; notifyWhatsapp: boolean; whatsappNumber: string | null };

/** Without a widget row the defaults apply: both emails on, WhatsApp off. */
export async function getNotificationSettings(businessId: string): Promise<NotificationSettings> {
  const widget = await prisma.chatWidget.findUnique({ where: { businessId } });
  return {
    notifyInstant: widget?.notifyInstant ?? true,
    notifyDaily: widget?.notifyDaily ?? true,
    notifyWhatsapp: widget?.notifyWhatsapp ?? false,
    whatsappNumber: widget?.whatsappNumber ?? null,
  };
}

export async function saveEmailToggles(businessId: string, toggles: { notifyInstant: boolean; notifyDaily: boolean }): Promise<void> {
  await prisma.chatWidget.upsert({ where: { businessId }, create: { businessId, ...toggles }, update: toggles });
}

/** `whatsappNumber` null: the alerts go to the business phone from sign-up. */
export async function saveWhatsappAlerts(businessId: string, settings: { notifyWhatsapp: boolean; whatsappNumber: string | null }): Promise<void> {
  await prisma.chatWidget.upsert({ where: { businessId }, create: { businessId, ...settings }, update: settings });
}
