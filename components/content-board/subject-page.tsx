import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Megaphone, Package, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { CreateDayContent } from "@/components/content-flow/create-day-dialog";
import { DayVisuals } from "@/components/content-flow/day-visuals";
import { ContestConfirm } from "@/components/content-flow/contest-confirm";
import { Button } from "@/components/ui";
import { activeFilterCount, contentQuery, MAX_PAGE_SIZE, parseContentFilters, PAGE_SIZE, type ContentScope } from "@/lib/content-board/filters";
import { dayHeading, groupByDay, periodContains, periodLabel, periodOf, type PeriodView } from "@/lib/content-board/period";
import { loadOnePost, loadSubjectInfo } from "@/lib/content-board/queries";
import { loadDayContents, loadDayPosts, loadPeriodPosts } from "@/lib/content-flow/queries";
import { ANGLES, isAngleId } from "@/lib/studio/angles";
import { DAY_SECTION_LABEL, dayLabel, groupDay, parseDay, todayIn, type DaySection } from "@/lib/content-flow/day";
import { NETWORK_STYLE } from "@/lib/content-flow/networks";
import { networkChoices, runAllowance } from "@/lib/content-flow/service";
import { loadComposerContext } from "@/lib/publishing/queries";
import { isNetwork } from "@/lib/social/registry";
import { can } from "@/lib/team/roles";
import { FilterBar } from "./filter-bar";
import { PeriodBar } from "./period-bar";
import { ScheduleAllButton } from "./schedule-all";
import { PostBoard } from "./post-board";

type SearchParams = Record<string, string | string[] | undefined>;

const SECTIONS: DaySection[] = ["review", "goes", "made", "expired"];

/** Posts a page shows before "Show more": a week or a month lists more at once. */
const PAGE_FOR: Record<PeriodView, number> = { day: PAGE_SIZE, week: 72, month: 144 };

/**
 * One product's, campaign's or General's content (content flow v3, docs/CONTENT.md). Day (the default) opens on today
 * (the business's time zone) with what needs approval and what goes out; the bar browses past days (what was made
 * then) and the coming ones (what is scheduled). Week and Month list that period's posts by day, with the same cards.
 * "Create today's content" makes the day's posts.
 */
export async function SubjectPostsPage({ scope, searchParams }: { scope: ContentScope; searchParams: SearchParams }) {
  const blocked = (await featureGate("content")) ?? (await featureGate("calendar"));
  if (blocked) return blocked;
  const { business, user, role } = await getAppContext();
  const info = await loadSubjectInfo(business.id, scope);
  if (!info) notFound();
  const zone = business.timezone || "UTC";
  const now = new Date();
  const today = todayIn(zone, now);
  const parsed = parseContentFilters(searchParams);
  const view: PeriodView = parsed.view ?? "day";
  const day = parseDay(searchParams.day, zone, now);
  const period = periodOf(view, day);
  const pageSize = PAGE_FOR[view];
  // The board's date range does not apply here: the period replaces it.
  const base = { ...parsed, range: undefined, from: undefined, to: undefined, view: undefined, day: undefined };
  const filters = { ...base, limit: Math.max(base.limit, pageSize) };
  // The period as the URL keeps it (Day and today are the defaults, left out).
  const periodParams = { view: view === "day" ? undefined : view, day: day === today ? undefined : day };
  const postId = typeof searchParams.post === "string" ? searchParams.post.slice(0, 64) : null;

  const [list, contents, context, openPost, networks, allowance] = await Promise.all([
    view === "day" ? loadDayPosts(business.id, scope, day, filters, zone, now) : loadPeriodPosts(business.id, scope, period, filters, zone, now),
    view === "day" ? loadDayContents(business.id, scope, day, zone) : Promise.resolve([]),
    loadComposerContext(business.id),
    postId ? loadOnePost(business.id, postId) : null,
    networkChoices(business.id),
    runAllowance({ userId: user.id, businessId: business.id }),
  ]);
  const path = scope.kind === "general" ? "/dashboard/content/general" : `/dashboard/content/${scope.kind === "product" ? "products" : "campaigns"}/${scope.id}`;
  const query = contentQuery(base);
  const withDay = (extra: string) => {
    const p = new URLSearchParams(extra.replace(/^\?/, ""));
    if (periodParams.view) p.set("view", periodParams.view);
    if (periodParams.day) p.set("day", periodParams.day);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const moreHref = list.hasMore ? `${path}${withDay(contentQuery({ ...base, limit: Math.min(filters.limit + pageSize, MAX_PAGE_SIZE) }, { limit: true }))}` : null;
  const filtered = activeFilterCount(filters) > 0 || Boolean(filters.q);
  const Icon = scope.kind === "product" ? Package : scope.kind === "campaign" ? Megaphone : Sparkles;
  const thing = scope.kind === "campaign" ? "campaign" : scope.kind === "product" ? "product" : "business";
  const album = scope.kind === "general" ? undefined : `${scope.kind}:${scope.id}`;
  const sections = groupDay(list.posts, day, zone);
  const days = view === "day" ? [] : groupByDay(list.posts, period, zone);
  const span = view === "week" ? "week" : "month";
  const visuals = contents
    .filter((c) => c.image || c.video)
    .map((c) => ({ id: c.id, label: c.network && isNetwork(c.network) ? NETWORK_STYLE[c.network].label : "Post", angle: isAngleId(c.angle) ? ANGLES[c.angle].label : null, image: c.image, video: c.video, hasScript: c.hasScript, groupId: c.groupId }));
  const create = <CreateDayContent scope={scope} path={path} subjectName={info.name} networks={networks} allowance={allowance} album={album} />;
  // Today's header button opens by itself on ?create=1 (+ Create → New post); the empty state's copy never does.
  const createHere = periodContains(period, today) ? <CreateDayContent scope={scope} path={path} subjectName={info.name} networks={networks} allowance={allowance} album={album} openOnAsk /> : create;

  const empty = filtered ? (
    <EmptyState icon={Icon} title={`No posts match these filters this ${view}`} text="Try another app or type, or clear the filters." action={<Button href={`${path}${withDay("")}`}>Clear filters</Button>} />
  ) : view !== "day" ? (
    <EmptyState
      icon={Icon}
      title={period.end < today ? `Nothing was made or posted this ${span}` : `Nothing is planned for this ${span} yet`}
      text={`Pick another ${span}, or look at one day at a time.`}
      action={<Button href={`${path}${contentQuery({ ...base, view: span, limit: undefined })}`}>{`Back to this ${span}`}</Button>}
    />
  ) : day === today ? (
    <EmptyState
      icon={Icon}
      title="Nothing for today yet"
      text={`Create today's posts for this ${thing}: BuPulse writes a short post for each app from a new angle every day, with your own Photos first. They wait for your OK here.`}
      action={create}
    />
  ) : (
    <EmptyState icon={Icon} title={day < today ? "Nothing was made or posted this day" : "Nothing is scheduled for this day yet"} text="Pick another day, or go back to today." action={<Button href={path}>Back to today</Button>} />
  );
  const shown = SECTIONS.filter((s) => sections[s].length > 0 || (s === "review" && openPost));
  const last = shown[shown.length - 1];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/content" className="-mb-2 inline-flex min-h-11 w-fit items-center gap-1 px-1 text-[15px] font-medium text-muted hover:text-text">
        <ChevronLeft aria-hidden className="size-4" /> Posts
      </Link>
      <PageHeader
        title={info.name}
        description={info.label}
        action={
          <div className="flex flex-wrap gap-2">
            {info.albumHref && (
              <Button href={info.albumHref} variant="outline" size="sm">
                Open {thing}
              </Button>
            )}
            {createHere}
          </div>
        }
      />
      <PeriodBar path={path} view={view} anchor={day} today={today} label={view === "day" ? dayLabel(day, today) : periodLabel(period, today)} query={query} />
      <FilterBar filters={{ ...base, ...periodParams }} dates={false} />
      <div className="-mt-3 flex justify-end">
        <ScheduleAllButton query={contentQuery({ ...base, view, day })} scope={scope} />
      </div>
      <ContestConfirm posts={list.posts.filter((p) => p.contest?.pending).map((p) => ({ id: p.id, network: p.network, excerpt: p.excerpt }))} today={today} canConfirm={can(role, "contentSettings")} />
      {view !== "day"
        ? days.length === 0 && !openPost
          ? empty
          : (days.length ? days : [{ day: today, posts: [] }]).map((g, i, all) => (
              <section key={g.day} aria-labelledby={`day-${g.day}`} className="flex flex-col gap-3">
                <h2 id={`day-${g.day}`} className="flex flex-wrap items-center gap-2 px-1 text-lg font-semibold tracking-[-0.02em]">
                  {dayHeading(g.day, today)}
                  {g.day === today && <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-[13px] text-pulse-blue">Today</span>}
                </h2>
                <PostBoard posts={g.posts} total={g.posts.length} zone={zone} context={context} moreHref={i === all.length - 1 ? moreHref : null} openPost={i === 0 ? openPost : null} empty={null} />
              </section>
            ))
        : shown.length === 0
        ? empty
        : shown.map((s) => (
            <section key={s} aria-labelledby={`day-${s}`} className="flex flex-col gap-3">
              <h2 id={`day-${s}`} className="px-1 text-lg font-semibold tracking-[-0.02em]">
                {DAY_SECTION_LABEL[s]}
              </h2>
              <PostBoard posts={sections[s]} total={sections[s].length} zone={zone} context={context} moreHref={s === last ? moreHref : null} openPost={s === "review" ? openPost : null} empty={null} />
            </section>
          ))}
      {view === "day" && <DayVisuals items={visuals} videoInPlan={allowance.videoInPlan} album={album} />}
    </div>
  );
}
