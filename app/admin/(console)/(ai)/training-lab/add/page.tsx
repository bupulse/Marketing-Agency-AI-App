import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Plus } from "lucide-react";
import { CARD, PageHeader } from "@/components/admin/kit";
import { requirePermission } from "@/lib/admin/auth";
import { cn } from "@/lib/cn";
import { DropZone } from "../drop/drop-zone";
import { LabTabs } from "../lab-tabs";

export const metadata = { title: "Training Lab: add an example" };
export const dynamic = "force-dynamic";

export default async function TrainingLabAddPage() {
  const me = await requirePermission("ai"); // pages render alongside the layout, so check here too
  // The owner from ADMIN_EMAILS only, like the library; anyone else does not see the page exists.
  if (!me.isOwner || me.staffId) notFound();
  return (
    <>
      <PageHeader icon={Plus} tone="violet" title="Add an example" description="Drop a reel, video, photo or voice note, or paste a link. The AI reads it and fills in the form; you check it and save." back={{ href: "/admin/training-lab", label: "Training Lab" }} />
      <LabTabs current="add" />
      <div className={cn("min-w-0 p-4 sm:p-6", CARD)}>
        <DropZone />
      </div>
      <Link href="/admin/training-lab" className="inline-flex min-h-11 w-fit items-center gap-2 px-1 text-[14px] font-semibold text-pulse-blue no-underline hover:underline">
        <BookOpen aria-hidden className="size-4" /> See everything in the Library
      </Link>
    </>
  );
}
