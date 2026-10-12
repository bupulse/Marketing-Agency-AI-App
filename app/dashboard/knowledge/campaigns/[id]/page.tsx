import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { DesignStudio } from "@/components/designs/design-studio";
import { AlbumCard } from "@/components/knowledge/album-card";
import { BackLink } from "@/components/knowledge/back-link";
import { DetailsList } from "@/components/knowledge/details-list";
import { ItemActions } from "@/components/knowledge/item-actions";
import { ContentCard } from "@/components/studio/content-card";
import { loadSubjectStudio } from "@/components/studio/queries";
import { WriteContentCta } from "@/components/studio/write-content-cta";
import { Badge, GlassCard } from "@/components/ui";
import { localDateISO, safeZone } from "@/lib/autopilot/timezone";
import { isCanvaEnabled } from "@/lib/canva/config";
import { recommendPack } from "@/lib/designs/packs";
import { CAMPAIGN_TYPE_LABEL, campaignPhase, dayString, formatDateRange, PHASE_LABEL } from "@/lib/knowledge/campaigns";
import { legacyTypeOf } from "@/lib/knowledge/legacy";
import { formatPrice, KIND_SHORT, STATUS_LABEL } from "@/lib/knowledge/products";
import { albumItems } from "@/lib/media/service";
import { getCampaign } from "@/lib/knowledge/service";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { id } = await params;
  const { business, usage, entitlements } = await getAppContext();
  const campaign = await getCampaign(business.id, id);
  if (!campaign) notFound();
  const subject = { kind: "campaign" as const, id: campaign.id };
  const [photos, studio] = await Promise.all([albumItems(business.id, "campaign", campaign.id), loadSubjectStudio(business.id, subject)]);
  // Designs fall back to the first linked product's album while the campaign has no photos of its own.
  const firstProduct = campaign.products[0]?.product;
  const designPhotos = photos.length || !firstProduct ? photos : await albumItems(business.id, "product", firstProduct.id);
  const startsOn = dayString(campaign.startsAt);
  const endsOn = dayString(campaign.endsAt);
  const phase = campaignPhase({ startsOn, endsOn }, localDateISO(new Date(), safeZone(business.timezone)));

  return (
    <>
      <BackLink href="/dashboard/knowledge/campaigns" label="Campaigns" />
      <GlassCard as="header" className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{CAMPAIGN_TYPE_LABEL[campaign.type]}</Badge>
              <Badge tone={phase === "running" && campaign.status === "ACTIVE" ? "success" : "neutral"}>{campaign.status === "ACTIVE" ? PHASE_LABEL[phase] : STATUS_LABEL[campaign.status]}</Badge>
            </div>
            <h1 className="break-words text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{campaign.name}</h1>
            <p className="text-[16px] font-medium">{[formatDateRange(startsOn, endsOn) || "No dates", campaign.priceInfo].filter(Boolean).join(" · ")}</p>
          </div>
          <ItemActions kind="campaign" id={campaign.id} name={campaign.name} archived={campaign.status === "ARCHIVED"} />
        </div>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="campaign-details" className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 id="campaign-details" className="text-lg font-semibold tracking-[-0.02em]">
          What BuPulse knows about it
        </h2>
        <DetailsList rows={[["Highlights", campaign.highlights], ["Description", campaign.description]]} />
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] text-muted">Products in this campaign</h3>
          {campaign.products.length === 0 ? (
            <p className="text-[15px] text-muted">
              None linked. <Link href={`/dashboard/knowledge/campaigns/${campaign.id}/edit`} className="font-semibold">Link products</Link> so their details and photos are used.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {campaign.products.map(({ product: p }) => (
                <li key={p.id}>
                  <Link href={`/dashboard/knowledge/products/${p.id}`} className="glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium no-underline">
                    <span className="text-muted">{KIND_SHORT[p.kind]}</span> {p.name} <span className="text-muted">· {formatPrice(p)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassCard>

      <AlbumCard kind="campaign" id={campaign.id} name={campaign.name} photos={photos.map((p) => ({ id: p.id, path: p.path, url: p.url, name: p.name }))} />

      {studio.contents.length === 0 ? (
        <WriteContentCta subjectId={campaign.id} used={usage.used.text} limit={usage.limits.text} />
      ) : (
        <ContentCard subject={subject} contents={studio.contents} used={usage.used.text} limit={usage.limits.text} photos={designPhotos.map((p) => ({ path: p.path, url: p.url }))} />
      )}

      {entitlements.usable.has("designs") && (
        <DesignStudio
          pack={recommendPack(business)}
          canva={isCanvaEnabled() && entitlements.usable.has("canva")}
          aiPhotos={entitlements.usable.has("aiPhotos")}
          subjectId={campaign.id}
          album={`campaign:${campaign.id}`}
          defaults={{
            headline: campaign.name,
            subline: campaign.highlights[0] ?? formatDateRange(startsOn, endsOn),
            chip: (campaign.priceInfo ?? "").slice(0, 40),
            photoPaths: designPhotos.map((p) => p.path),
            photoUrls: designPhotos.map((p) => p.url),
            projectType: legacyTypeOf(campaign),
          }}
          designs={studio.designs}
          credits={{ used: usage.used.image, limit: usage.limits.image, resetsAt: usage.resetsAt?.toISOString() ?? null }}
          hasLogo={Boolean(business.logoUrl)}
        />
      )}
    </>
  );
}
