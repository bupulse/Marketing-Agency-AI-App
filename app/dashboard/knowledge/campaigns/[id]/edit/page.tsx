import { notFound } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { CampaignForm } from "@/components/knowledge/campaign-form";
import { campaignFormValues } from "@/lib/knowledge/campaigns";
import { getCampaign, subjectOptions } from "@/lib/knowledge/service";

export const metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { id } = await params;
  const { business } = await getAppContext();
  const [campaign, options] = await Promise.all([getCampaign(business.id, id), subjectOptions(business.id)]);
  if (!campaign) notFound();
  const linked = campaign.products.map((p) => p.product);
  // An archived product stays selectable here while it is still linked.
  const products = [...options.products, ...linked.filter((l) => !options.products.some((p) => p.id === l.id))];
  return (
    <>
      <BackLink href={`/dashboard/knowledge/campaigns/${campaign.id}`} label={campaign.name} />
      <PageHeader title="Edit campaign" />
      <CampaignForm campaignId={campaign.id} initial={campaignFormValues({ ...campaign, productIds: linked.map((p) => p.id) })} products={products} />
    </>
  );
}
