import { PenLine } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui";
import { ContentLibrary } from "@/components/studio/content-library";
import { loadContentLibrary } from "@/components/studio/queries";
import { SubjectLinks } from "@/components/knowledge/subject-links";
import { subjectOptions } from "@/lib/knowledge/service";

export const metadata = { title: "Content" };

export default async function ContentPage() {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const [items, options] = await Promise.all([loadContentLibrary(business.id), subjectOptions(business.id)]);

  return (
    <>
      <PageHeader title="Content" description="The latest caption, script and ad headlines for each product and campaign, in one place." />
      <SubjectLinks options={options} />
      {items.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="No content yet"
          text="Add a product or campaign and BuPulse writes captions, hashtags, a video script and ad headlines for it."
          action={<Button href="/dashboard/knowledge/products/new">Add a product or service</Button>}
        />
      ) : (
        <ContentLibrary items={items} />
      )}
    </>
  );
}
