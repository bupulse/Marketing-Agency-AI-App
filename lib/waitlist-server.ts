import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { cleanSetting, SETTING_KEYS } from "@/lib/admin/settings";
import { DEFAULT_LAUNCH_DATE, waitlistInfo, type WaitlistInfo } from "./waitlist";

/**
 * The waiting list for this request (lib/waitlist.ts), or null when it is off. One query, shared by everything a page
 * renders (React cache). A database blip reads as "off", so the site keeps working as it does without the list.
 */
export const getWaitlist = cache(async (): Promise<WaitlistInfo | null> => {
  let rows: { key: string; value: unknown }[] = [];
  try {
    rows = await prisma.adminSetting.findMany({ where: { key: { in: [SETTING_KEYS.waitlistOn, SETTING_KEYS.waitlistLaunchDate] } } });
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const on = byKey.get(SETTING_KEYS.waitlistOn) === true;
  let day = DEFAULT_LAUNCH_DATE;
  try {
    const raw = byKey.get(SETTING_KEYS.waitlistLaunchDate);
    if (raw !== undefined) day = cleanSetting.waitlistLaunchDate(raw);
  } catch {
    // A bad stored day falls back to the default.
  }
  return waitlistInfo(on, day);
});

/** True while new accounts are closed (the waiting list is on). */
export async function signupsClosed(): Promise<boolean> {
  return (await getWaitlist()) !== null;
}
