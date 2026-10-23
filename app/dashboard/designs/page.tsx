import { Suspense } from "react";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { DesignStudio } from "@/components/designs/design-studio";
import { UniqueAds } from "@/components/designs/unique-ads";
import { isCanvaEnabled } from "@/lib/canva/config";
import { DesignsFilter, DesignsPager } from "@/components/designs/designs-paging";
import { DESIGNS_PER_PAGE, designsDateBounds, parseDesignsQuery } from "@/lib/designs/list";
import { listDesignsPage } from "@/lib/designs/service";
import { SubjectPicker } from "@/components/knowledge/subject-picker";
import { resolveSubject, subjectOptions, writingSubject } from "@/lib/knowledge/service";

export const metadata = { title: "Designs" };

export default async function DesignsPage({ searchParams }: { searchParams: Promise<{ photo?: string; for?: string; page?: string; range?: string; from?: string; to?: string }> }) {
  const blocked = await featureGate("designs");
  if (blocked) return blocked;
  const { user, business, usage, entitlements } = await getAppContext();
  const sp = await searchParams;
  const { for: forId } = sp;
  // 30 designs a page, newest first, optionally only from some dates (in the business's time zone).
  const query = parseDesignsQuery(sp);
  const bounds = designsDateBounds(query, new Date(), business.timezone);
  const list = await listDesignsPage(user.id, { page: query.page, perPage: DESIGNS_PER_PAGE, ...bounds });
  const designs = list.items;
  const keep = { for: forId && forId.length <= 60 ? forId : undefined };
  // ?for=<product or campaign id>: the ads are made for it (its name, price and album) and saved with it.
  const subject = await resolveSubject(business.id, forId);
  const about = subject ? await writingSubject(business.id, subject) : null;
  const options = await subjectOptions(business.id);

  return (
    <>
      <PageHeader title="Designs" description="Unique AI ads for your business, made from your products and photos, and every picture BuPulse made for you." />
      <Suspense>
        <CanvaReturnToast />
      </Suspense>
      <SubjectPicker
        base="/dashboard/designs"
        value={subject?.id ?? ""}
        label="Make ads for"
        none="Nothing in particular"
        options={[...options.products.map((p) => ({ id: p.id, name: p.name, group: "Products & services" as const })), ...options.campaigns.map((c) => ({ id: c.id, name: c.name, group: "Campaigns" as const }))]}
      />
      {/* The image engine (docs/IMAGE_ENGINE.md): unique finished ads, for plans with AI pictures. */}
      {entitlements.usable.has("aiPhotos") && (
        <UniqueAds
          key={subject?.id ?? "none"}
          subjectId={subject?.kind === "product" ? subject.id : null}
          subjectName={subject?.kind === "product" ? (about?.title ?? null) : null}
          credits={{ used: usage.used.image, limit: usage.limits.image }}
        />
      )}
      <DesignStudio
        designs={designs}
        canva={isCanvaEnabled() && entitlements.usable.has("canva")}
        timeZone={business.timezone}
        galleryTop={<DesignsFilter base="/dashboard/designs" query={query} total={list.total} extra={keep} />}
        galleryBottom={<DesignsPager base="/dashboard/designs" query={{ ...query, page: list.page }} page={list.page} pages={list.pages} extra={keep} />}
      />
    </>
  );
}
