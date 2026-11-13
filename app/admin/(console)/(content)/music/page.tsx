import { MusicView, TRACK_FILTERS } from "@/components/admin/content-ai/music-view";
import { chosen } from "@/components/admin/kit";
import { requirePermission } from "@/lib/admin/auth";
import { param } from "@/lib/admin/format";
import { cleanupMusicOrphans, lastTrackAddedAt, listTracks, MUSIC_LIBRARY_MAX_BYTES, musicUrl } from "@/lib/music/service";
import { adminTrendingTips } from "@/lib/social/trending-sounds";

export const metadata = { title: "Music library" };
export const dynamic = "force-dynamic";

export default async function MusicPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("content"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  // Uploads started and never finished (older than an hour) are cleared on the way in.
  await cleanupMusicOrphans();
  const [tracks, lastAdded, trending] = await Promise.all([listTracks(), lastTrackAddedAt().catch(() => null), adminTrendingTips()]);
  return (
    <MusicView
      tracks={tracks}
      urlOf={musicUrl}
      maxBytes={MUSIC_LIBRARY_MAX_BYTES}
      lastAdded={lastAdded?.toISOString() ?? null}
      trending={{ tips: trending.tips, updatedAt: trending.updatedAt?.toISOString() ?? null }}
      show={chosen(sp, "show", TRACK_FILTERS, "") as "" | (typeof TRACK_FILTERS)[number]}
      params={sp}
      message={{ notice: param(sp.notice) || undefined, error: param(sp.error) || undefined }}
    />
  );
}
