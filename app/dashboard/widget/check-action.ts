"use server";

import { requireActiveUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db";
import { RateLimitError, rateLimit } from "@/lib/rate-limit";
import { hostOf } from "@/lib/widget/origin";
import { describeSeen, type SeenResult } from "@/lib/widget/seen";

export type CheckResult = { ok: true; result: SeenResult; typedHost: string | null } | { ok: false; error: string };

/** "Check installation": has the widget loaded on a website recently, and does it match the page the owner typed? */
export async function checkInstallation(url: string): Promise<CheckResult> {
  const user = await requireActiveUser();
  const typed = url.trim() ? hostOf(url.trim().slice(0, 300)) : null;
  if (url.trim() && !typed) return { ok: false, error: "That does not look like a web address. Try something like https://mysite.com/contact." };
  try {
    await rateLimit(`widget-check:${user.id}`, { limit: 40, windowSeconds: 60 * 60 });
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: "Please wait a little before checking again." };
    throw error;
  }
  const business = await prisma.business.findUnique({ where: { userId: user.id }, select: { id: true } });
  const widget = business ? await prisma.chatWidget.findUnique({ where: { businessId: business.id }, select: { lastSeenAt: true, lastSeenHost: true } }) : null;
  return { ok: true, typedHost: typed, result: describeSeen({ lastSeenAt: widget?.lastSeenAt ?? null, lastSeenHost: widget?.lastSeenHost ?? null, url, now: new Date() }) };
}
