import { redirect } from "next/navigation";
import { getAppContext } from "@/components/app/context";
import { PostsView } from "@/components/app/views/a-posts-view";
import { featureGate } from "@/components/app/no-access";
import { SwitchToAutoBanner } from "@/components/content-board/content-actions";
import { TodayReview } from "@/components/content-board/today-review";
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
    <PostsView
      data={{ autoCount, total, subjects, generalTotal: posting && general ? general.total : null, calendar: entitlements.usable.has("calendar"), nothingYet }}
      banners={
        <>
          <ConnectAppsBanner apps={missing} canConnect={can(role, "channels")} />
          {switchable.length > 0 && <SwitchToAutoBanner postIds={switchable} />}
        </>
      }
      today={today && context ? <TodayReview posts={today.posts} older={today.older} zone={zone} context={context} /> : null}
      skits={entitlements.usable.has("video") ? <SkitSection businessId={business.id} zone={zone} canRecord={can(role, "content") && !entitlements.block} /> : null}
    />
  );
}
