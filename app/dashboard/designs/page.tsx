import { Suspense, type ReactNode } from "react";
import { Images, Palette, Sparkles } from "lucide-react";
import { ChoiceTiles, FilterChips, PageHeader } from "@/components/admin/kit";
import { CanvaReturnToast } from "@/components/designs/canva-return-toast";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { DesignStudio } from "@/components/designs/design-studio";
import { UniqueAds } from "@/components/designs/unique-ads";
import { isCanvaEnabled } from "@/lib/canva/config";
import { DesignsFilter, DesignsPager } from "@/components/designs/designs-paging";
import { DESIGNS_PER_PAGE, designsDateBounds, parseDesignsQuery } from "@/lib/designs/list";
import { listDesignsPage } from "@/lib/designs/service";
import { resolveSubject, subjectOptions, writingSubject } from "@/lib/knowledge/service";

export const metadata = { title: "Designs" };

type Params = { photo?: string; for?: string; page?: string; range?: string; from?: string; to?: string; tab?: string; canva?: string };

/**
 * Designs (redesigned 12 Nov 2026, one job per screen): two tabs, "Make ads" (pick what the ads are for from chips,
 * then the AI ads maker) and "Your designs" (every picture made, by date, with paging). A plan without AI pictures
 * has only "Your designs". Paging and date links keep ?tab=mine; an old link with a page or dates, and the way back
 * from Canva (?canva=), open that tab.
 */
export default async function DesignsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const blocked = await featureGate("designs");
  if (blocked) return blocked;
  const { user, business, usage, entitlements } = await getAppContext();
  const sp = await searchParams;
  const { for: forId } = sp;
  const canMake = entitlements.usable.has("aiPhotos");
  const tab = !canMake || sp.tab === "mine" || (sp.tab !== "make" && Boolean(sp.page || sp.range || sp.from || sp.to || sp.canva)) ? "mine" : "make";
  // 30 designs a page, newest first, optionally only from some dates (in the business's time zone).
  const query = parseDesignsQuery(sp);
  const bounds = designsDateBounds(query, new Date(), business.timezone);
  const forKept = forId && forId.length <= 60 ? forId : undefined;
  const keep = { for: forKept, tab: canMake ? "mine" : undefined };

  const tabs = canMake ? (
    <ChoiceTiles
      label="Designs"
      param="tab"
      base="/dashboard/designs"
      params={{ for: forKept }}
      current={tab}
      allValue="make"
      className="max-w-2xl [&_ul]:grid-cols-2"
      options={[
        { value: "make", label: "Make ads", hint: "New AI ads from your products.", icon: Sparkles, tone: "violet" },
        { value: "mine", label: "Your designs", hint: "Every picture made for you.", icon: Images, tone: "blue" },
      ]}
    />
  ) : null;

  let body: ReactNode;
  if (tab === "make") {
    // ?for=<product or campaign id>: the ads are made for it (its name, price and album) and saved with it.
    const [subject, options] = await Promise.all([resolveSubject(business.id, forId), subjectOptions(business.id)]);
    const about = subject ? await writingSubject(business.id, subject) : null;
    const choices = [
      { value: "", label: "Nothing in particular" },
      ...options.products.map((p) => ({ value: p.id, label: p.name })),
      ...options.campaigns.map((c) => ({ value: c.id, label: c.name })),
    ];
    body = (
      <>
        {choices.length > 1 && (
          <section aria-labelledby="ads-for" className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5 px-1">
              <h2 id="ads-for" className="text-[16px] font-bold tracking-[-0.01em]">
                Make ads for
              </h2>
              <p className="text-[13px] text-muted">Pick a product or campaign: its name, price and photos go into the ads.</p>
            </div>
            <FilterChips label="Make ads for" param="for" base="/dashboard/designs" params={{}} current={subject?.id ?? ""} options={choices} />
          </section>
        )}
        {/* The image engine (docs/IMAGE_ENGINE.md): unique finished ads, for plans with AI pictures. */}
        <UniqueAds
          key={subject?.id ?? "none"}
          subjectId={subject?.kind === "product" ? subject.id : null}
          subjectName={subject?.kind === "product" ? (about?.title ?? null) : null}
          credits={{ used: usage.used.image, limit: usage.limits.image }}
        />
      </>
    );
  } else {
    const list = await listDesignsPage(user.id, { page: query.page, perPage: DESIGNS_PER_PAGE, ...bounds });
    body = (
      <DesignStudio
        designs={list.items}
        canva={isCanvaEnabled() && entitlements.usable.has("canva")}
        timeZone={business.timezone}
        galleryTop={<DesignsFilter base="/dashboard/designs" query={query} total={list.total} extra={keep} />}
        galleryBottom={<DesignsPager base="/dashboard/designs" query={{ ...query, page: list.page }} page={list.page} pages={list.pages} extra={keep} />}
      />
    );
  }

  return (
    <>
      <PageHeader icon={Palette} tone="pink" title="Designs" description="Unique AI ads made from your products, and every picture BuPulse made for you." />
      <Suspense>
        <CanvaReturnToast />
      </Suspense>
      {tabs}
      {body}
    </>
  );
}
