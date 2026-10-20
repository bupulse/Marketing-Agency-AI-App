import { getAppContext } from "@/components/app/context";
import { pageGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { VideoLibrary, type StudioState } from "@/components/video-library/video-library";
import { isServiceEnabled } from "@/lib/admin/switch";
import { can } from "@/lib/team/roles";
import { listLibraryVideos, markStudioVideosSeen } from "@/lib/video-library/service";

export const metadata = { title: "Videos" };

const REASONS = new Set(["off", "permission", "plan", "error"]);

// The Videos library (docs/VIDEO_STUDIO_SPLIT.md): every video BuPulse made for the company, from the Video Studio
// (studio.bupulse.com, opened in a new tab) and the daily post slideshows, to watch, download, schedule or delete.
// ?v=<job id> opens on one video (the "Your video is ready" email); ?studio=<reason> says why the studio did not open.
export default async function VideosPage({ searchParams }: PageProps<"/dashboard/video">) {
  const blocked = await pageGate("content");
  if (blocked) return blocked;
  const { business, role, usage } = await getAppContext();
  const params = await searchParams;
  const reason = typeof params.studio === "string" && REASONS.has(params.studio) ? params.studio : null;
  const focus = typeof params.v === "string" ? params.v.slice(0, 40) : null;

  const [videos, studioOn] = await Promise.all([listLibraryVideos(business.id), isServiceEnabled("studio")]);
  // Opening the library is what "seen" means for the bell; the cards still say "New" this once.
  await markStudioVideosSeen(business.id, videos.filter((v) => v.isNew).map((v) => v.id)).catch(() => {});

  const credits = { used: usage.used.videoCredits ?? 0, limit: usage.limits.videoCredits ?? 0, resetsAt: usage.resetsAt ? new Date(usage.resetsAt).toISOString() : null };
  const studio: StudioState = !studioOn ? "off" : credits.limit > 0 ? "open" : "plan";

  return (
    <>
      <PageHeader title="Videos" description="Every video BuPulse made for you, from the Video Studio and your daily posts. Make new ones in the Video Studio; they appear here when they are ready." />
      <VideoLibrary
        initialVideos={videos}
        studio={studio}
        credits={credits}
        canBuy={can(role, "billing")}
        reason={reason}
        focus={focus}
        timeZone={business.timezone || "Africa/Kigali"}
      />
    </>
  );
}
