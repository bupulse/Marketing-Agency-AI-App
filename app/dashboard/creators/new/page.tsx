import { getAppContext } from "@/components/app/context";
import { BackLink } from "@/components/knowledge/back-link";
import { creatorsGate } from "@/components/creators/company/campaign-page";
import { OnePageCampaign, type OnePageStart } from "@/components/creators/company/one-page/one-page-campaign";
import { campaignLimits, defaultCurrency } from "@/lib/creators/campaigns";
import { tiktokAuthConfig } from "@/lib/creators/connect-flow";
import { campaignNetworks } from "@/lib/creators/networks";
import { languageFromName } from "@/lib/creators/one-page";
import { ideaExamplesFor, ideaFromKnowledge } from "@/lib/creators/wizard-steps";
import { KIND_SHORT } from "@/lib/knowledge/products";
import { getCampaign as getKnowledgeCampaign, subjectOptions } from "@/lib/knowledge/service";
import { albumItems } from "@/lib/media/service";

export const metadata = { title: "New creator campaign" };

/**
 * A new creator campaign on one page (docs/CREATOR_CAMPAIGN_WIZARD.md, "One page", owner decision 31 October 2026):
 * the form makes the whole campaign in one go, then its page opens. `?from=<id>` starts it from a Business info campaign
 * ("Get creators to post it"): its idea as the description and its first product; `?product=<id>` from a product.
 * Drafts made before keep their quick mode and step-by-step setup (/dashboard/creators/[id]/quick and /setup), and
 * Settings still opens every step to change it.
 */
export default async function NewCampaignPage({ searchParams }: PageProps<"/dashboard/creators/new">) {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const { from, product } = await searchParams;
  const [source, lists, limits, currency] = await Promise.all([
    typeof from === "string" && from.length <= 60 ? getKnowledgeCampaign(business.id, from) : Promise.resolve(null),
    subjectOptions(business.id),
    campaignLimits(business.id),
    defaultCurrency(business.id),
  ]);
  const wanted = source?.products[0]?.product.id ?? (typeof product === "string" && product.length <= 60 ? product : null);
  const picked = wanted ? (lists.products.find((p) => p.id === wanted) ?? null) : null;
  const photos = picked ? (await albumItems(business.id, "product", picked.id)).filter((p) => p.kind !== "video").slice(0, 20) : [];
  const start: OnePageStart = {
    language: languageFromName(business.contentLanguage),
    description: source ? ideaFromKnowledge(source) : "",
    productId: picked?.id ?? null,
    productName: picked?.name ?? "",
    productPhotos: photos.map((p) => ({ id: p.id, url: p.url })),
  };
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={source ? `/dashboard/knowledge/campaigns/${source.id}` : "/dashboard/creators"} label={source ? source.name : "Creator campaigns"} />
      <OnePageCampaign
        start={start}
        options={{
          currency,
          planLimit: limits.creatorsPerCampaign,
          networks: campaignNetworks(Boolean(tiktokAuthConfig())),
          products: lists.products.map((p) => ({ id: p.id, name: p.name, hint: KIND_SHORT[p.kind as keyof typeof KIND_SHORT] })),
          examples: ideaExamplesFor(business.industry, (picked ? [picked] : lists.products.slice(0, 3)).map((p) => p.name)),
        }}
      />
    </div>
  );
}
