import { PenLine } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui";
import { ContentLibrary } from "@/components/studio/content-library";
import { loadContentLibrary } from "@/components/studio/queries";

export const metadata = { title: "Content" };

export default async function ContentPage() {
  const { business } = await getAppContext();
  const items = business ? await loadContentLibrary(business.id) : [];

  return (
    <>
      <PageHeader title="Content" description="The latest caption, script and ad headlines for each project, in one place." />
      {items.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="No content yet"
          text="Create a project and BuPulse writes captions, hashtags, a video script and ad headlines for it."
          action={<Button href="/dashboard/projects/new">New project</Button>}
        />
      ) : (
        <ContentLibrary items={items} />
      )}
    </>
  );
}
