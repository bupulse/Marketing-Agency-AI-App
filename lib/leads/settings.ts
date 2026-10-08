import "server-only";
import { prisma } from "@/lib/db";

export type NotificationSettings = { notifyInstant: boolean; notifyDaily: boolean };

/** Without a widget row the defaults apply: both emails on. */
export async function getNotificationSettings(businessId: string): Promise<NotificationSettings> {
  const widget = await prisma.chatWidget.findUnique({ where: { businessId } });
  return {
    notifyInstant: widget?.notifyInstant ?? true,
    notifyDaily: widget?.notifyDaily ?? true,
  };
}

export async function saveEmailToggles(businessId: string, toggles: { notifyInstant: boolean; notifyDaily: boolean }): Promise<void> {
  await prisma.chatWidget.upsert({ where: { businessId }, create: { businessId, ...toggles }, update: toggles });
}
