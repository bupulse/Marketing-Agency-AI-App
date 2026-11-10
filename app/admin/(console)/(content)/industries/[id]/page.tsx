import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/auth";
import { Briefcase } from "lucide-react";
import { PageHeader, StatusPill } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { IndustryForm } from "@/components/admin/industry-form";
import { getIndustryAdmin } from "@/lib/admin/industries-service";
import { AdminError } from "@/lib/admin/types";

export const metadata = { title: "Industry" };
export const dynamic = "force-dynamic";

export default async function EditIndustryPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content");
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
        icon={Briefcase}
        tone="pink"
        back={{ href: "/admin/industries", label: "Industries" }}
        actions={<StatusPill tone={industry.active ? "good" : "muted"} dot>{industry.active ? "Offered at sign-up" : "Hidden"}</StatusPill>}
      />
      <Panel title="Edit industry">
        <IndustryForm initial={{ ...industry, id: industry.id }} />
      </Panel>
    </>
  );
}
