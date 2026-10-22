import Link from "next/link";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { CampaignChooser, type CreatorsAccess } from "@/components/knowledge/campaign-chooser";
import { CampaignForm } from "@/components/knowledge/campaign-form";
import { OwnCampaignQuiz } from "@/components/knowledge/campaign-quiz";
import { dayIn } from "@/lib/creators/periods";
import { prisma } from "@/lib/db";
import { campaignFormValues } from "@/lib/knowledge/campaigns";
import { formatPrice } from "@/lib/knowledge/products";
import { subjectOptions } from "@/lib/knowledge/service";
import { can } from "@/lib/team/roles";

export const metadata = { title: "Add a campaign" };

/**
 * "Who will post it?" first (docs/CREATOR_CAMPAIGN_WIZARD.md): the business on its own pages (`?who=me`: the quiz,
 * docs/QUIZ_MODE.md; `&form=1` the full form) or content creators (the creator campaign wizard). `?product=<id>` is
 * kept on every way.
 */
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ product?: string; who?: string; form?: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, entitlements, role } = await getAppContext();
  const { products } = await subjectOptions(business.id);
  const { product, who, form } = await searchParams;
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

  const own = `/dashboard/knowledge/campaigns/new?who=me${keep ? `&${keep}` : ""}`;
  if (form === "1") {
    const initial = campaignFormValues(null);
    if (productId) initial.productIds = [productId];
    return (
      <>
        <BackLink href="/dashboard/knowledge/campaigns/new" label="New campaign" />
        <PageHeader title="Add a campaign" description="An event, offer, promotion or launch. You can change anything later." />
        <p className="text-[14px] text-muted">
          Prefer a quick quiz?{" "}
          <Link href={own} className="font-medium text-text underline underline-offset-2">
            Answer 6 quick cards instead
          </Link>
        </p>
        <CampaignForm initial={initial} products={products} />
      </>
    );
  }

  // The quiz's products with their stored price in words: the only prices BuPulse may use in its ideas.
  const priced = await prisma.product.findMany({ where: { businessId: business.id, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, priceModel: true, priceAmount: true, currency: true, priceNote: true } });
  return (
    <>
      <BackLink href="/dashboard/knowledge/campaigns/new" label="New campaign" />
      <OwnCampaignQuiz
        products={priced.map((p) => ({ id: p.id, name: p.name, price: p.priceAmount != null && p.priceModel !== "ON_REQUEST" ? formatPrice(p) : null }))}
        initialProductIds={productId ? [productId] : []}
        today={dayIn(new Date(), business.timezone)}
        businessName={business.name}
        fullFormHref={`${own}&form=1`}
      />
    </>
  );
}
