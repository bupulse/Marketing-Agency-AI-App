import Link from "next/link";
import { PenLine, Settings, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/content-board/filter-bar";
import { SubjectGrid } from "@/components/content-board/subject-grid";
import { TodayReview } from "@/components/content-board/today-review";
import { Button, GlassCard } from "@/components/ui";
import { parseContentFilters } from "@/lib/content-board/filters";
import { loadSubjectCards, loadToday, recentAutoCount } from "@/lib/content-board/queries";
import { loadComposerContext } from "@/lib/publishing/queries";

export const metadata = { title: "Content" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContentPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await featureGate("content");
  if (blocked) return blocked;
  const { business, entitlements } = await getAppContext();
  const filters = parseContentFilters(await searchParams);
  const zone = business.timezone || "UTC";
  const now = new Date();
  const posting = entitlements.usable.has("calendar");

  const [cards, today, autoCount, context] = await Promise.all([
    loadSubjectCards(business.id, filters, zone, now),
    posting ? loadToday(business.id, filters, zone, now) : null,
    posting ? recentAutoCount(business.id, now) : 0,
    posting ? loadComposerContext(business.id) : null,
  ]);
  const nothingYet = cards.length === 1 && cards[0].kind === "general" && cards[0].total === 0 && !today?.posts.length && !today?.older;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Content"
        description="Review today's posts, then find every post by product, campaign or app."
        action={
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
          <Link href="/dashboard/content?auto=1&status=scheduled" className="inline-flex min-h-11 items-center font-semibold text-pulse-blue">
            See them
          </Link>
        </GlassCard>
      )}

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
          <FilterBar filters={filters} />
          <SubjectGrid cards={cards} filters={filters} />
        </>
      )}
    </div>
  );
}
