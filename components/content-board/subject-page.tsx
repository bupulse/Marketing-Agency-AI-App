import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Megaphone, Package, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { CreateDayContent } from "@/components/content-flow/create-day-dialog";
import { DayBar } from "@/components/content-flow/day-bar";
import { DayVisuals } from "@/components/content-flow/day-visuals";
import { Button } from "@/components/ui";
import { activeFilterCount, contentQuery, parseContentFilters, PAGE_SIZE, type ContentScope } from "@/lib/content-board/filters";
import { loadOnePost, loadSubjectInfo } from "@/lib/content-board/queries";
import { loadDayContents, loadDayPosts } from "@/lib/content-flow/queries";
import { ANGLES, isAngleId } from "@/lib/studio/angles";
import { DAY_SECTION_LABEL, dayLabel, groupDay, parseDay, todayIn, type DaySection } from "@/lib/content-flow/day";
import { NETWORK_STYLE } from "@/lib/content-flow/networks";
import { networkChoices, runAllowance } from "@/lib/content-flow/service";
import { loadComposerContext } from "@/lib/publishing/queries";
import { isNetwork } from "@/lib/social/registry";
import { FilterBar } from "./filter-bar";
import { ScheduleAllButton } from "./schedule-all";
import { PostBoard } from "./post-board";

type SearchParams = Record<string, string | string[] | undefined>;

const SECTIONS: DaySection[] = ["review", "goes", "made"];

/**
 * One product's, campaign's or General's content, a day at a time (content flow v3, docs/CONTENT.md): it opens on
 * today (the business's time zone) with what needs approval and what goes out; the date bar browses past days (what
 * was made then) and the coming ones (what is scheduled). "Create today's content" makes the day's posts.
 */
export async function SubjectPostsPage({ scope, searchParams }: { scope: ContentScope; searchParams: SearchParams }) {
  const blocked = (await featureGate("content")) ?? (await featureGate("calendar"));
  if (blocked) return blocked;
  const { business, user } = await getAppContext();
  const info = await loadSubjectInfo(business.id, scope);
  if (!info) notFound();
  const zone = business.timezone || "UTC";
  const now = new Date();
  const today = todayIn(zone, now);
  const day = parseDay(searchParams.day, zone, now);
  const filters = { ...parseContentFilters(searchParams), range: undefined, from: undefined, to: undefined };
  const postId = typeof searchParams.post === "string" ? searchParams.post.slice(0, 64) : null;

  const [list, contents, context, openPost, networks, allowance] = await Promise.all([
    loadDayPosts(business.id, scope, day, filters, zone, now),
    loadDayContents(business.id, scope, day, zone),
    loadComposerContext(business.id),
    postId ? loadOnePost(business.id, postId) : null,
    networkChoices(business.id),
    runAllowance({ userId: user.id, businessId: business.id }),
  ]);
  const path = scope.kind === "general" ? "/dashboard/content/general" : `/dashboard/content/${scope.kind === "product" ? "products" : "campaigns"}/${scope.id}`;
  const query = contentQuery(filters);
  const withDay = (extra: string) => {
    const p = new URLSearchParams(extra.replace(/^\?/, ""));
    if (day !== today) p.set("day", day);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const moreHref = list.hasMore ? `${path}${withDay(contentQuery({ ...filters, limit: filters.limit + PAGE_SIZE }, { limit: true }))}` : null;
  const filtered = activeFilterCount(filters) > 0 || Boolean(filters.q);
  const Icon = scope.kind === "product" ? Package : scope.kind === "campaign" ? Megaphone : Sparkles;
  const thing = scope.kind === "campaign" ? "campaign" : scope.kind === "product" ? "product" : "business";
  const album = scope.kind === "general" ? undefined : `${scope.kind}:${scope.id}`;
  const sections = groupDay(list.posts, day, zone);
  const visuals = contents
    .filter((c) => c.image || c.video)
    .map((c) => ({ id: c.id, label: c.network && isNetwork(c.network) ? NETWORK_STYLE[c.network].label : "Post", angle: isAngleId(c.angle) ? ANGLES[c.angle].label : null, image: c.image, video: c.video }));
  const create = <CreateDayContent scope={scope} path={path} subjectName={info.name} networks={networks} allowance={allowance} album={album} />;

  const empty = filtered ? (
    <EmptyState icon={Icon} title="No posts match these filters on this day" text="Try another app or type, or clear the filters." action={<Button href={`${path}${withDay("")}`}>Clear filters</Button>} />
  ) : day === today ? (
    <EmptyState
      icon={Icon}
      title="Nothing for today yet"
      text={`Create today's posts for this ${thing}: BuPulse writes a short post for each app from a new angle every day, with your Gallery photos and videos first. They wait for your OK here.`}
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
        <ChevronLeft aria-hidden className="size-4" /> Content
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
            {create}
          </div>
        }
      />
      <DayBar path={path} day={day} today={today} label={dayLabel(day, today)} query={query} />
      <FilterBar filters={filters} day={day !== today ? day : undefined} />
      <div className="-mt-3 flex justify-end">
        <ScheduleAllButton query={contentQuery({ ...filters, range: "custom", from: day, to: day })} scope={scope} />
      </div>
      {shown.length === 0
        ? empty
        : shown.map((s) => (
            <section key={s} aria-labelledby={`day-${s}`} className="flex flex-col gap-3">
              <h2 id={`day-${s}`} className="px-1 text-lg font-semibold tracking-[-0.02em]">
                {DAY_SECTION_LABEL[s]}
              </h2>
              <PostBoard posts={sections[s]} total={sections[s].length} zone={zone} context={context} moreHref={s === last ? moreHref : null} openPost={s === "review" ? openPost : null} empty={null} />
            </section>
          ))}
      <DayVisuals items={visuals} videoInPlan={allowance.videoInPlan} album={album} />
    </div>
  );
}
