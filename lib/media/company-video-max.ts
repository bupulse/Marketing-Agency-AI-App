// The Gallery's video cap for one company (docs/MEDIA.md): MEDIA_COMPANY_VIDEO_MAX_BYTES (100 MB) for everyone, except
// the BuPulse company account, which keeps its own Ad Brain ads (about 10 MB each) and gets Admin -> Settings
// "BuPulse's own gallery videos" (owner decision, 11 Nov 2026: 1 GB). Any failure to read it falls back to the
// everyone value, so no other company is ever affected.
import "server-only";
import { getSetting } from "@/lib/admin/settings";
import { prisma } from "@/lib/db";
import { adBrainCompanyEmail } from "@/lib/ad-brain/screen-pass";
import { companyVideoMaxBytes } from "./rules";

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; isCompany: boolean }>();

export async function videoMaxFor(businessId: string, now = Date.now()): Promise<number> {
  const base = companyVideoMaxBytes();
  try {
    let hit = cache.get(businessId);
    if (!hit || now - hit.at > CACHE_MS) {
      const row = await prisma.business.findUnique({ where: { id: businessId }, select: { user: { select: { email: true } } } });
      hit = { at: now, isCompany: (row?.user.email ?? "").toLowerCase() === adBrainCompanyEmail() };
      cache.set(businessId, hit);
    }
    if (!hit.isCompany) return base;
    return Math.max(base, (await getSetting("adBrainGalleryVideoMb")) * 1024 * 1024);
  } catch {
    return base;
  }
}

export function clearVideoMaxCache() {
  cache.clear();
}
