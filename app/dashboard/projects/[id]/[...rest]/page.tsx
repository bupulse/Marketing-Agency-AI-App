import { notFound, redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { resolveSubject, subjectHref } from "@/lib/knowledge/service";

// Old project links such as /dashboard/projects/<id>/edit go to the product's or campaign's page (same id).
export default async function ProjectSubPage({ params }: { params: Promise<{ id: string; rest: string[] }> }) {
  const { id, rest } = await params;
  const { business } = await getAppContext();
  const subject = await resolveSubject(business.id, id);
  if (!subject) notFound();
  redirect(rest[0] === "edit" ? `${subjectHref(subject)}/edit` : subjectHref(subject));
}
