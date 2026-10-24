// A finished reel as an editable spec: the same steps the Videos page takes when it joins a reel (the plan from the
// server's ReelView, buildReelSpec for talking reels or buildMontageSpec for montage reels (buildReelSpec picks), the cuts
// on the music's beat). Client only (it reads the music to find the beat).
import type { ReelView } from "@/lib/reel-engine/engine";
import { buildReelSpec, type ReelPlan } from "@/lib/reel-engine/story";
import type { MotionSpec } from "@/lib/video-engine/spec";

export type ReelBrand = { name: string; color: string; contact: string | null };
export type ReelSource = { spec: MotionSpec; musicUrl: string | null; title: string };

/** The plan the spec builders need, from the server's view of the reel (the fields the builders read). */
export function planFromView(view: ReelView): ReelPlan {
  return {
    title: view.title,
    caption: view.caption,
    hashtags: view.hashtags,
    music: null,
    presenter: view.presenter ?? "",
    price: view.price,
    hook: view.hook,
    tag: view.tag,
    clips: view.clips.map((c) => ({ beat: c.beat as ReelPlan["clips"][number]["beat"], kind: c.kind, seconds: c.seconds, variant: "", camera: "", presenter: false, frame: "", motion: "", line: c.line, stress: c.stress, status: "done" })),
  };
}

export async function reelSource(view: ReelView, brand: ReelBrand): Promise<ReelSource> {
  const { beatOfTrack } = await import("@/lib/reel-engine/beats");
  const spec = buildReelSpec(planFromView(view), view.clips.map((c) => c.clipUrl ?? ""), brand, await beatOfTrack(view.musicUrl));
  return { spec, musicUrl: view.musicUrl, title: view.title || "reel" };
}

/** A safe file name for the download: "Kigali car seller!" gives "kigali-car-seller.mp4". */
export function mp4Name(title: string): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "video"}.mp4`;
}
