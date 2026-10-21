import "server-only";
import { addDaysYmd } from "@/lib/demo/slots";
import { prisma } from "@/lib/db";
import { deleteCampaignFolder, MEDIA_KEEP_DAYS } from "../media";

// Handed-in files are deleted 60 days after their campaign's last day (docs/CREATOR_CAMPAIGNS.md, "Limits": the free
// Supabase Storage is 1 GB). Run by the creator views job. Each creator's whole campaign folder goes, so uploads that
// were never handed in go too. Hand-ins still listing files are cleaned whenever the job runs; the folders of creators
// with no such hand-in are swept during the week after the 60 days.

const SWEEP_DAYS = 7;

/** Returns how many files were deleted. */
export async function cleanupMedia(now = new Date()): Promise<number> {
  const cutoff = new Date(`${addDaysYmd(now.toISOString().slice(0, 10), -MEDIA_KEEP_DAYS)}T00:00:00Z`);
  const sweepFrom = new Date(cutoff.getTime() - SWEEP_DAYS * 86_400_000);
  const [withFiles, recent] = await Promise.all([
    prisma.creatorSubmission.findMany({
      where: { mediaPaths: { isEmpty: false }, campaign: { status: "ENDED", endsOn: { lt: cutoff } } },
      select: { campaignId: true, campaignCreator: { select: { profileId: true } } },
      take: 50,
    }),
    prisma.campaignCreator.findMany({
      where: { profileId: { not: null }, campaign: { status: "ENDED", endsOn: { lt: cutoff, gte: sweepFrom } } },
      select: { campaignId: true, profileId: true },
      take: 50,
    }),
  ]);
  const folders = new Map<string, { profileId: string; campaignId: string }>();
  for (const s of withFiles) if (s.campaignCreator.profileId) folders.set(`${s.campaignCreator.profileId}/${s.campaignId}`, { profileId: s.campaignCreator.profileId, campaignId: s.campaignId });
  for (const c of recent) folders.set(`${c.profileId}/${c.campaignId}`, { profileId: c.profileId!, campaignId: c.campaignId });

  let deleted = 0;
  for (const { profileId, campaignId } of folders.values()) {
    deleted += await deleteCampaignFolder(profileId, campaignId);
    await prisma.creatorSubmission.updateMany({ where: { campaignId, campaignCreator: { profileId }, mediaPaths: { isEmpty: false } }, data: { mediaPaths: [] } });
  }
  return deleted;
}
