import { notFound } from "next/navigation";
import { previewAllowed } from "@/lib/support/preview";
import { MakingPreview } from "./making-preview";

export const metadata = { title: "Loading screen preview", robots: { index: false, follow: false } };

/**
 * Development only: the loading screen shown while a post's set is made (components/visuals/making-screen.tsx), with
 * made-up progress, no sign-in and no database. Not found in production.
 * /making-preview/<captions|images|reel|music|ready|frames|live>, ?at=<ms already spent> to start the clock part-way (live: &hold=1 keeps the made-up server there).
 * "live" feeds the screen a made-up server's real progress (daySetProgressAction's shape) through fromSetProgress.
 */
export default async function Page({ params, searchParams }: PageProps<"/making-preview/[[...screen]]">) {
  if (!previewAllowed()) notFound();
  const screen = (await params).screen?.[0] ?? "images";
  const query = await searchParams;
  const at = Number(query.at ?? 0);
  if (!["captions", "images", "reel", "music", "ready", "frames", "live"].includes(screen)) notFound();
  return <MakingPreview screen={screen} hold={query.hold === "1"} at={Number.isFinite(at) ? Math.max(0, Math.min(600_000, at)) : 0} />;
}
