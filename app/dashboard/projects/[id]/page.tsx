import { notFound, redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { resolveSubject, subjectHref } from "@/lib/knowledge/service";

// Old project links: the migration kept each project's id on the product or campaign it became.
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await getAppContext();
  const subject = await resolveSubject(business.id, id);
  if (!subject) notFound();
  redirect(subjectHref(subject));
}
