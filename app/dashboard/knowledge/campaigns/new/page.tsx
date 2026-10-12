import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { CampaignForm } from "@/components/knowledge/campaign-form";
import { campaignFormValues } from "@/lib/knowledge/campaigns";
import { subjectOptions } from "@/lib/knowledge/service";

export const metadata = { title: "Add a campaign" };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const { products } = await subjectOptions(business.id);
  const { product } = await searchParams;
  const initial = campaignFormValues(null);
  if (product && products.some((p) => p.id === product)) initial.productIds = [product];
  return (
    <>
      <BackLink href="/dashboard/knowledge/campaigns" label="Campaigns" />
      <PageHeader title="Add a campaign" description="An event, offer, promotion or launch. You can change anything later." />
      <CampaignForm initial={initial} products={products} />
    </>
  );
}
