import { notFound } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { ProjectForm } from "@/components/studio/project-form";
import { detailsText } from "@/components/studio/helpers";
import { prisma } from "@/lib/db";
import { signPhotos } from "@/components/studio/queries";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getAppContext();
  if (!business) notFound();
  const project = await prisma.project.findFirst({ where: { id, businessId: business.id } });
  if (!project) notFound();
  const photos = await signPhotos(project.photoPaths);

  return (
    <>
      <PageHeader title="Edit project" description="Changes apply to the next content you write. Existing text is kept." />
      <ProjectForm
        projectId={project.id}
        initial={{
          type: project.type,
          title: project.title,
          price: project.price ?? "",
          features: project.features,
          details: detailsText(project.details),
          photos,
        }}
      />
    </>
  );
}
