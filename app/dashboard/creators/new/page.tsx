import { getAppContext } from "@/components/app/context";
import { BackLink } from "@/components/knowledge/back-link";
import { campaignActor, creatorsGate } from "@/components/creators/company/campaign-page";
import { blankAnswers, wizardOptions } from "@/components/creators/company/wizard/load";
import { QuickCampaign } from "@/components/creators/company/quick/quick-campaign";
import { CampaignWizard } from "@/components/creators/company/wizard/wizard";
import { ideaFromKnowledge, kindFromKnowledgeType } from "@/lib/creators/wizard-steps";
import { getCampaign as getKnowledgeCampaign } from "@/lib/knowledge/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "New creator campaign" };

/**
 * A new creator campaign: quick mode by default (docs/QUIZ_MODE.md, "C"), or step 1 of the detailed wizard with
 * `?detailed=1` (docs/CREATOR_CAMPAIGN_WIZARD.md). Both start with the owner's line, the kind and what it promotes;
 * Next makes the draft and fills the other steps. `?from=<id>` starts it from a Business info campaign ("Get creators
 * to post it"): its idea, kind and products, and its dates when the draft is made; `?product=<id>` from a product.
 */
export default async function NewCampaignPage({ searchParams }: PageProps<"/dashboard/creators/new">) {
  const blocked = await creatorsGate();
  if (blocked) return blocked;
  const actor = await campaignActor();
  const { business } = await getAppContext();
  const { from, product, detailed } = await searchParams;
  const source = typeof from === "string" && from.length <= 60 ? await getKnowledgeCampaign(business.id, from) : null;
  const productId = !source && typeof product === "string" && product.length <= 60 ? (await prisma.product.findFirst({ where: { id: product, businessId: business.id }, select: { id: true } }))?.id : undefined;
  const initial = await blankAnswers(
    business,
    source
      ? { idea: ideaFromKnowledge(source), name: source.name.slice(0, 80), kind: kindFromKnowledgeType(source.type), knowledgeCampaignId: source.id, productIds: source.products.map((p) => p.product.id) }
      : { productIds: productId ? [productId] : [] },
  );
  const { options } = await wizardOptions(actor, business, null, "idea");
  const keep = source ? `from=${encodeURIComponent(source.id)}` : productId ? `product=${encodeURIComponent(productId)}` : "";
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={source ? `/dashboard/knowledge/campaigns/${source.id}` : "/dashboard/creators"} label={source ? source.name : "Creator campaigns"} />
      {detailed === "1" ? (
        <CampaignWizard step="idea" initial={initial} options={options} quickHref={`/dashboard/creators/new${keep ? `?${keep}` : ""}`} />
      ) : (
        <QuickCampaign card="idea" initial={initial} options={options} detailedHref={`/dashboard/creators/new?detailed=1${keep ? `&${keep}` : ""}`} />
      )}
    </div>
  );
}
