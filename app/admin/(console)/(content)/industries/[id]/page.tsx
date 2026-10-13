import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { PageHeader } from "@/components/app";
import { Panel } from "@/components/admin/ui";
import { IndustryForm } from "@/components/admin/industry-form";
import { Badge } from "@/components/ui";
import { getIndustryAdmin } from "@/lib/admin/industries-service";
import { AdminError } from "@/lib/admin/types";

export const metadata = { title: "Industry" };
export const dynamic = "force-dynamic";

export default async function EditIndustryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  let industry;
  try {
    industry = await getIndustryAdmin(id);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        title={industry.name}
        description={`${industry.businesses} ${industry.businesses === 1 ? "company uses" : "companies use"} this sector. Changes apply to their next generated post, plan or chat reply.`}
        action={<Badge tone={industry.active ? "success" : "neutral"}>{industry.active ? "Active" : "Hidden"}</Badge>}
      />
      <Panel title="Edit industry">
        <IndustryForm initial={{ ...industry, id: industry.id }} />
      </Panel>
    </>
  );
}
