import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { CampaignChooser, type CreatorsAccess } from "@/components/knowledge/campaign-chooser";
import { CampaignForm } from "@/components/knowledge/campaign-form";
import { campaignFormValues } from "@/lib/knowledge/campaigns";
import { subjectOptions } from "@/lib/knowledge/service";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Add a campaign" };

/**
 * "Who will post it?" first (docs/CREATOR_CAMPAIGN_WIZARD.md): the business on its own pages (`?who=me`, the form
 * below) or content creators (the creator campaign wizard). `?product=<id>` is kept on both ways.
 */
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ product?: string; who?: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, entitlements, role } = await getAppContext();
  const { products } = await subjectOptions(business.id);
  const { product, who } = await searchParams;
  const productId = product && products.some((p) => p.id === product) ? product : null;
  const keep = productId ? `product=${encodeURIComponent(productId)}` : "";

  if (who !== "me") {
    const creators: CreatorsAccess = !can(role, "creators") ? "role" : entitlements.usable.has("creators") ? "ok" : can(role, "upgrade") ? "upgrade" : "not_in_plan";
    return (
      <>
        <BackLink href="/dashboard/knowledge/campaigns" label="Campaigns" />
        <PageHeader title="New campaign" description="Who will post it?" />
        <CampaignChooser ownHref={`/dashboard/knowledge/campaigns/new?who=me${keep ? `&${keep}` : ""}`} creatorsHref={`/dashboard/creators/new${keep ? `?${keep}` : ""}`} creators={creators} />
      </>
    );
  }

  const initial = campaignFormValues(null);
  if (productId) initial.productIds = [productId];
  return (
    <>
      <BackLink href="/dashboard/knowledge/campaigns/new" label="New campaign" />
      <PageHeader title="Add a campaign" description="An event, offer, promotion or launch. You can change anything later." />
      <CampaignForm initial={initial} products={products} />
    </>
  );
}
