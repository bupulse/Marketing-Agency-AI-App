import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app";
import { SpecEditor } from "@/components/editor/spec-editor";
import { DEMO_SPEC } from "@/components/editor/demo-spec";
import { requirePermission } from "@/lib/admin/auth";
import { LabTabs } from "../lab-tabs";

export const metadata = { title: "Training Lab editor" };
export const dynamic = "force-dynamic";

export default async function TrainingLabEditorPage() {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only, like the library; anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  return (
    <>
      <PageHeader title="Training Lab" description="Edit a video: change the order and the length of the shots, the words, the stickers and the look. This is an example video; saving and exporting come next." />
      <LabTabs current="editor" />
      <SpecEditor initial={DEMO_SPEC} />
    </>
  );
}
