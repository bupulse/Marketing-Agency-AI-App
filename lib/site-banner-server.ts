import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { SETTING_KEYS } from "@/lib/admin/settings";
import { bannerShowing, readSiteBanner, type SiteBanner } from "./site-banner";

/**
 * The site banner for this request (lib/site-banner.ts) when it should be on the page now (switched on, inside its
 * show-from / hide-after window), else null. One query per request (React cache); a database blip hides it.
 */
export const getShowingBanner = cache(async (): Promise<SiteBanner | null> => {
  try {
    const row = await prisma.adminSetting.findUnique({ where: { key: SETTING_KEYS.siteBanner } });
    const banner = readSiteBanner(row?.value);
    return bannerShowing(banner) ? banner : null;
  } catch {
    return null;
  }
});
