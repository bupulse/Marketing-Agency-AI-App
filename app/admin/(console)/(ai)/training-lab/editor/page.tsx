import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { SpecEditor } from "@/components/editor/spec-editor";
import { DEMO_SPEC } from "@/components/editor/demo-spec";
import { requirePermission } from "@/lib/admin/auth";
import { LabTabs } from "../lab-tabs";
import { confirmExampleFileAction, createExampleAction } from "../actions";
import { openReelAction } from "./actions";
import { listFinishedReels, openFinishedReel, type OpenedReel, type ReelChoice } from "./reels";
import { notice } from "@/components/admin/ui";

export const metadata = { title: "Training Lab editor" };
export const dynamic = "force-dynamic";

export default async function TrainingLabEditorPage({ searchParams }: PageProps<"/admin/training-lab/editor">) {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only, like the library; anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  const sp = await searchParams;
  // ?reel=<id> (from the Team page or the Library's finished reels): that finished reel, with fresh links.
  const reelId = typeof sp.reel === "string" ? sp.reel.trim().slice(0, 60) : "";
  const [reels, initialReel] = await Promise.all([
    listFinishedReels().catch((): ReelChoice[] => []),
    reelId ? openFinishedReel(reelId).catch((): OpenedReel | null => null) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title="Training Lab" description="Edit a video: change the order and the length of the shots, the words, the stickers and the look, then export the MP4 or save the edit as a Lab example. Start from the example or open a finished reel." />
      <LabTabs current="editor" />
      {reelId && !initialReel && <p role="status" className={notice.bad}>That reel is not finished or is gone, so the example is open instead.</p>}
      <SpecEditor initial={DEMO_SPEC} initialReel={initialReel} reels={reels} openReel={openReelAction} createExample={createExampleAction} confirmFile={confirmExampleFileAction} />
    </>
  );
}
