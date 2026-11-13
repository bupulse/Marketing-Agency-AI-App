import { FolderSearch } from "lucide-react";
import { PageHeader } from "@/components/admin/kit";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { FilterBar } from "@/components/content-board/filter-bar";
import { PeriodBar } from "@/components/content-board/period-bar";
import { ScheduleAllButton } from "@/components/content-board/schedule-all";
import { SubjectGrid } from "@/components/content-board/subject-grid";
import { contentQuery, customRangeText, parseContentFilters } from "@/lib/content-board/filters";
import { periodLabel, periodOf } from "@/lib/content-board/period";
import { loadSubjectCards } from "@/lib/content-board/queries";
import { parseDay, todayIn } from "@/lib/content-flow/day";

export const metadata = { title: "All posts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Posts, "All posts" (split from the Posts page, 12 Nov 2026, so each screen has one job): every post by product,
 * campaign or General, with the Day / Week / Month bar, the filters (as chips) and "Schedule all". The Posts page sends
 * any old link with filters (?status=review, ?auto=1...) here, so shared links and emails keep working.
 */
export default async function AllPostsPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, entitlements } = await getAppContext();
  const parsed = parseContentFilters(await searchParams);
  const zone = business.timezone || "UTC";
  const now = new Date();
  // The Day / Week / Month switch: none ("All") by default here; the day is kept within the date bar's range.
  const todayKey = todayIn(zone, now);
  const anchor = parseDay(parsed.day, zone, now);
  const filters = { ...parsed, day: parsed.view && anchor !== todayKey ? anchor : undefined };
  const period = filters.view ? periodOf(filters.view, anchor) : null;
  const label = period ? periodLabel(period, todayKey) : null;
  const posting = entitlements.usable.has("calendar");
  const cards = await loadSubjectCards(business.id, filters, zone, now);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={FolderSearch} tone="violet" title="All posts" description="Find any post by product, campaign, app or date." back={{ href: "/dashboard/content", label: "Posts" }} />
      <PeriodBar path="/dashboard/content/all" view={filters.view ?? null} anchor={anchor} today={todayKey} label={label ?? ""} query={contentQuery(filters)} allowAll custom={filters.range === "custom" ? customRangeText(filters) : null} />
      <FilterBar filters={filters} />
      {posting && (
        <div className="-mt-3 flex justify-end">
          <ScheduleAllButton query={contentQuery(filters)} />
        </div>
      )}
      <SubjectGrid cards={cards} filters={filters} period={label} />
    </div>
  );
}
