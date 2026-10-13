import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { latestContentPosts } from "@/lib/content-board/drafts";
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
import { isCanvaEnabled } from "@/lib/canva/config";
import { recommendPack } from "@/lib/designs/packs";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/knowledge/campaigns";
import { legacyTypeOf } from "@/lib/knowledge/legacy";
import {
  ACCESS_LABEL,
  CONDITION_LABEL,
  KIND_LABEL,
  PLACE_LABEL,
  priceLine,
  productReadiness,
  readDetails,
  STATUS_LABEL,
  type DigitalDetails,
  type PhysicalDetails,
  type ServiceDetails,
} from "@/lib/knowledge/products";
import { getProduct, productAlbum } from "@/lib/knowledge/service";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { id } = await params;
  const { business, usage, entitlements } = await getAppContext();
  const product = await getProduct(business.id, id);
  if (!product) notFound();
  const subject = { kind: "product" as const, id: product.id };
  // Content written before posts were drafted gets its posts to review once, when its page is opened (docs/CONTENT.md).
  if (entitlements.usable.has("calendar")) await latestContentPosts(business.id, { productId: product.id }, { backfill: true }).catch(() => null);
  const [photos, studio] = await Promise.all([productAlbum(business.id, product.id), loadSubjectStudio(business.id, subject)]);
  const readiness = productReadiness({ ...product, photoCount: photos.length });
  // Designs draw photos only; the album's videos are posted as they are (docs/MEDIA.md).
  const stills = photos.filter((p) => p.kind !== "video");
  const details = readDetails(product.kind, product.details);
  const kindRows: [string, string | string[] | null][] =
    product.kind === "PHYSICAL"
      ? [
          ["Variants", (details as PhysicalDetails).variants],
          ["Condition", (details as PhysicalDetails).condition ? CONDITION_LABEL[(details as PhysicalDetails).condition!] : null],
          ["Delivery", (details as PhysicalDetails).delivery],
          ["Warranty", (details as PhysicalDetails).warranty],
        ]
      : product.kind === "DIGITAL"
        ? [
            ["How customers get it", (details as DigitalDetails).access.map((a) => ACCESS_LABEL[a]).join(", ")],
            ["Platform and requirements", (details as DigitalDetails).platform],
            ["Licence or subscription", (details as DigitalDetails).licence],
            ["Trial or demo", (details as DigitalDetails).trial ? "Available" : null],
          ]
        : [
            ["Duration", (details as ServiceDetails).duration],
            ["Where", (details as ServiceDetails).places.map((w) => PLACE_LABEL[w]).join(", ")],
            ["Booking", (details as ServiceDetails).bookingNeeded ? "Customers need to book" : null],
          ];

  return (
    <>
      <BackLink href="/dashboard/knowledge/products" label="Products & services" />
      <GlassCard as="header" className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{KIND_LABEL[product.kind]}</Badge>
              {product.status !== "ACTIVE" && <Badge tone="neutral">{STATUS_LABEL[product.status]}</Badge>}
              {product.category && <Badge tone="neutral">{product.category}</Badge>}
              {product.storeSync && <Badge tone="violet">{product.storeSync.connection.provider === "shopify" ? "Synced from Shopify" : "Synced from WooCommerce"}</Badge>}
            </div>
            <h1 className="break-words text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{product.name}</h1>
            <p className="text-[16px] font-medium">{priceLine(product)}</p>
            <p className="max-w-2xl text-[15px] text-muted">{product.summary}</p>
          </div>
          <ItemActions kind="product" id={product.id} name={product.name} archived={product.status === "ARCHIVED"} />
        </div>
        {!readiness.ready && (
          <p role="status" className="rounded-2xl bg-new-bg px-4 py-3 text-[14px] text-new">
            <strong>Add {readiness.missing.join(", ")}</strong> so BuPulse can write about it well.{" "}
            {readiness.missing.some((m) => m !== "a photo") && (
              <Link href={`/dashboard/knowledge/products/${product.id}/edit`} className="font-semibold">
                Edit details
              </Link>
            )}
          </p>
        )}
      </GlassCard>

      <GlassCard as="section" aria-labelledby="product-details" className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 id="product-details" className="text-lg font-semibold tracking-[-0.02em]">
          What BuPulse knows about it
        </h2>
        <DetailsList
          rows={[
            ["Why customers choose it", product.usps],
            ["Key features", product.features],
            ["Made for", product.targetCustomer],
            ...kindRows,
            ["Full description", product.description],
            ["Campaigns", product.campaigns.map((c) => `${c.campaign.name} (${CAMPAIGN_TYPE_LABEL[c.campaign.type]})`)],
          ]}
        />
      </GlassCard>

      <AlbumCard kind="product" id={product.id} name={product.name} photos={photos.map((p) => ({ id: p.id, path: p.path, url: p.url, name: p.name, kind: p.kind, posterUrl: p.posterUrl, durationMs: p.durationMs }))} />

      {studio.contents.length === 0 ? (
        <WriteContentCta subjectId={product.id} used={usage.used.text} limit={usage.limits.text} />
      ) : (
        <ContentCard subject={subject} contents={studio.contents} videoInPlan={studio.videoInPlan} used={usage.used.text} limit={usage.limits.text} photos={stills.map((p) => ({ path: p.path, url: p.url }))} />
      )}

      {/* Designs are their own plan feature; the product page keeps its content tools without them. */}
      {entitlements.usable.has("designs") && (
        <DesignStudio
          pack={recommendPack(business)}
          canva={isCanvaEnabled() && entitlements.usable.has("canva")}
          aiPhotos={entitlements.usable.has("aiPhotos")}
          subjectId={product.id}
          album={`product:${product.id}`}
          defaults={{
            headline: product.name,
            subline: product.usps[0] ?? product.features[0] ?? "",
            chip: product.priceAmount != null || product.priceNote ? priceLine(product).slice(0, 40) : "",
            photoPaths: stills.map((p) => p.path),
            photoUrls: stills.map((p) => p.url),
            projectType: legacyTypeOf(product),
          }}
          designs={studio.designs}
          credits={{ used: usage.used.image, limit: usage.limits.image, resetsAt: usage.resetsAt?.toISOString() ?? null }}
          hasLogo={Boolean(business.logoUrl)}
        />
      )}
    </>
  );
}
