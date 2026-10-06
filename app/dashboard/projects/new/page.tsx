import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { ProjectForm } from "@/components/studio/project-form";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const { usage } = await getAppContext();
  return (
    <>
      <PageHeader title="New project" description="Tell BuPulse what you want to promote. You can change anything later." />
      <ProjectForm used={usage.used.text} limit={usage.limits.text} />
    </>
  );
}
