import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { SpecEditor } from "@/components/editor/spec-editor";
import { DEMO_SPEC } from "@/components/editor/demo-spec";
import { requirePermission } from "@/lib/admin/auth";
import { LabTabs } from "../lab-tabs";
import { openReelAction } from "./actions";
import { listFinishedReels, type ReelChoice } from "./reels";

export const metadata = { title: "Training Lab editor" };
export const dynamic = "force-dynamic";

export default async function TrainingLabEditorPage() {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only, like the library; anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  const reels: ReelChoice[] = await listFinishedReels().catch(() => []);
  return (
    <>
      <PageHeader title="Training Lab" description="Edit a video: change the order and the length of the shots, the words, the stickers and the look, then export the MP4. Start from the example or open a finished reel." />
      <LabTabs current="editor" />
      <SpecEditor initial={DEMO_SPEC} reels={reels} openReel={openReelAction} />
    </>
  );
}
