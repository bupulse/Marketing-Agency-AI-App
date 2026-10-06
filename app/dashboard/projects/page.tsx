import { FolderKanban, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui";
import { ProjectGrid } from "@/components/studio/project-grid";
import { loadProjectCards } from "@/components/studio/queries";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const { business } = await getAppContext();
  const projects = business ? await loadProjectCards(business.id) : [];
  const newButton = (
    <Button href="/dashboard/projects/new" leading={<Plus aria-hidden className="size-[18px]" />}>
      New project
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Projects"
        description="A project is anything you want to promote. Add the details once, then create content from it."
        action={projects.length > 0 ? newButton : undefined}
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Create your first project"
          text="Add a product, service, event or offer with a few photos, and BuPulse writes the content for you."
          points={[
            "Works for any business: products, services, events, offers and more",
            "Upload photos and add price and key features",
            "Get captions, hashtags, a video script and ad headlines in your brand voice",
          ]}
          action={newButton}
        />
      ) : (
        <ProjectGrid projects={projects} />
      )}
    </>
  );
}
