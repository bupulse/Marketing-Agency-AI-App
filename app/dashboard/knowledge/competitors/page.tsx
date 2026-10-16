import { featureGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { CompetitorEditor } from "@/components/knowledge/competitor-editor";
import { competitorFormValues, readPositioning } from "@/lib/knowledge/competitors";
import { listCompetitors } from "@/lib/knowledge/records";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Competitors & what makes you different" };

export default async function CompetitorsPage() {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, role } = await getAppContext();
  const competitors = await listCompetitors(business.id);
  const positioning = readPositioning(business.positioning);
  return (
    <>
      <BackLink />
      <PageHeader title="Competitors & what makes you different" description="Why customers choose you. BuPulse leads with your differences in every post." />
      <CompetitorEditor
        competitors={competitors.map((c) => ({ id: c.id, values: competitorFormValues(c) }))}
        differentiators={positioning.differentiators}
        statement={positioning.statement ?? ""}
        canEdit={can(role, "content")}
      />
    </>
  );
}
