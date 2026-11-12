import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, FolderSearch, PenLine, Settings, Sparkles } from "lucide-react";
import { PageHeader, SectionCard, SectionGrid } from "@/components/admin/kit";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { SwitchToAutoBanner } from "@/components/content-board/content-actions";
import { TodayReview } from "@/components/content-board/today-review";
import { Button, GlassCard } from "@/components/ui";
import { parseContentFilters } from "@/lib/content-board/filters";
import { loadSubjectCards, loadToday, missingApps, recentAutoCount, switchableByHand } from "@/lib/content-board/queries";
import { can } from "@/lib/team/roles";
import { ConnectAppsBanner } from "@/components/content-board/connect-apps-banner";
import { SkitSection } from "@/components/skits/skit-section";
import { loadComposerContext } from "@/lib/publishing/queries";

export const metadata = { title: "Posts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The query keys of the board's filters and period: a link with any of them belongs on "All posts". */
const BROWSE_KEYS = ["app", "type", "status", "range", "date", "from", "to", "auto", "view", "day", "q", "sort", "limit"];

/**
 * Posts (redesigned 12 Nov 2026, one job per screen): today's posts to check first, the talking skits, then cards to
 * the rest: All posts (every post by product, campaign, app or date, with the filters), the General posts and the
 * Settings. Old links with filters (?status=review, ?auto=1&status=scheduled from the emails) go to All posts.
 */
export default async function ContentPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const sp = await searchParams;
  if (BROWSE_KEYS.some((k) => sp[k] !== undefined)) {
    const keep = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) keep.append(k, one);
    redirect(`/dashboard/content/all?${keep.toString()}`);
  }
  const { business, entitlements, role } = await getAppContext();
  const filters = parseContentFilters(sp);
  const zone = business.timezone || "UTC";
  const now = new Date();
  const posting = entitlements.usable.has("calendar");

  const [cards, today, autoCount, context, switchable, missing] = await Promise.all([
    loadSubjectCards(business.id, filters, zone, now),
    posting ? loadToday(business.id, filters, zone, now) : null,
    posting ? recentAutoCount(business.id, now) : 0,
    posting ? loadComposerContext(business.id) : null,
    posting ? switchableByHand(business.id) : [],
    missingApps(business.id),
  ]);
  const nothingYet = cards.length === 1 && cards[0].kind === "general" && cards[0].total === 0 && !today?.posts.length && !today?.older;
  const total = cards.reduce((n, c) => n + c.total, 0);
  const subjects = cards.filter((c) => c.kind !== "general").length;
  const general = cards.find((c) => c.kind === "general");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={PenLine}
        tone="violet"
        title="Posts"
        description="Check today's posts first. Everything else is one tap away."
        actions={
          <Button href="/dashboard/content/settings" variant="outline" size="sm" leading={<Settings aria-hidden className="size-4" />}>
            Settings
          </Button>
        }
      />

      {autoCount > 0 && (
        <GlassCard role="status" className="flex flex-wrap items-center gap-3 p-4">
          <Sparkles aria-hidden className="size-5 shrink-0 text-pulse-blue" />
          <p className="min-w-0 flex-1 text-[15px]">
            {autoCount === 1 ? "1 post was" : `${autoCount} posts were`} scheduled for you in the last 24 hours, without waiting for approval. You can change or cancel {autoCount === 1 ? "it" : "them"} until {autoCount === 1 ? "it goes" : "they go"} out.
          </p>
          <Link href="/dashboard/content/all?auto=1&status=scheduled" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue">
            See them
          </Link>
        </GlassCard>
      )}

      <ConnectAppsBanner apps={missing} canConnect={can(role, "channels")} />
      {switchable.length > 0 && <SwitchToAutoBanner postIds={switchable} />}

      {nothingYet ? (
        <EmptyState
          icon={PenLine}
          title="No content yet"
          text="Add a product or campaign and BuPulse writes the posts for it: a caption for each app, with its picture or video. New posts wait here for your OK."
          action={<Button href="/dashboard/knowledge/products/new">Add a product or service</Button>}
        />
      ) : (
        <>
          {today && context && <TodayReview posts={today.posts} older={today.older} zone={zone} context={context} />}
          {entitlements.usable.has("video") && <SkitSection businessId={business.id} zone={zone} canRecord={can(role, "content") && !entitlements.block} />}
          <section aria-labelledby="posts-more" className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5 px-1">
              <h2 id="posts-more" className="text-[18px] font-bold tracking-[-0.02em]">
                Find a post
              </h2>
              <p className="text-[13.5px] text-muted">Pick where to look.</p>
            </div>
            <SectionGrid>
              <SectionCard href="/dashboard/content/all" icon={FolderSearch} tone="violet" title="All posts" hint="By product, campaign, app or date, with filters." value={total} valueLabel={subjects ? `posts, ${subjects} ${subjects === 1 ? "product or campaign" : "products and campaigns"}` : "posts"} row />
              {posting && general && <SectionCard href="/dashboard/content/general" icon={Sparkles} tone="blue" title="General posts" hint="Posts about your business as a whole. Make today's here." value={general.total} valueLabel="posts" row />}
              {entitlements.usable.has("calendar") && <SectionCard href="/dashboard/calendar" icon={CalendarDays} tone="indigo" title="Calendar" hint="What goes out each day, week and month." row />}
            </SectionGrid>
          </section>
        </>
      )}
    </div>
  );
}
