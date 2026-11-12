import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, FolderSearch, PenLine, Settings, Sparkles } from "lucide-react";
import { PageHeader, SectionCard, SectionGrid } from "@/components/admin/kit";
import { EmptyState } from "@/components/app/empty-state";
import { Button, GlassCard } from "@/components/ui";

/** What the Posts page shows besides the live pieces it is given (today's review, skits, banners). */
export type PostsViewData = {
  /** Posts scheduled on their own in the last 24 hours. */
  autoCount: number;
  /** Every post, and the products and campaigns that have some. */
  total: number;
  subjects: number;
  /** General posts' count, when the plan can post (the day view needs posting). */
  generalTotal: number | null;
  calendar: boolean;
  nothingYet: boolean;
};

/**
 * Posts (redesigned 12 Nov 2026, one job per screen): today's posts to check first, the talking skits, then cards to
 * the rest (All posts with the filters, General posts, Calendar). Plain data plus the live pieces as slots, so the dev
 * preview renders the same page.
 */
export function PostsView({ data, banners, today, skits }: { data: PostsViewData; banners?: ReactNode; today?: ReactNode; skits?: ReactNode }) {
  const { autoCount, total, subjects, generalTotal } = data;
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

      {banners}

      {data.nothingYet ? (
        <EmptyState
          icon={PenLine}
          title="No content yet"
          text="Add a product or campaign and BuPulse writes the posts for it: a caption for each app, with its picture or video. New posts wait here for your OK."
          action={<Button href="/dashboard/knowledge/products/new">Add a product or service</Button>}
        />
      ) : (
        <>
          {today}
          {skits}
          <section aria-labelledby="posts-more" className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5 px-1">
              <h2 id="posts-more" className="text-[18px] font-bold tracking-[-0.02em]">
                Find a post
              </h2>
              <p className="text-[13.5px] text-muted">Pick where to look.</p>
            </div>
            <SectionGrid>
              <SectionCard
                href="/dashboard/content/all"
                icon={FolderSearch}
                tone="violet"
                title="All posts"
                hint="By product, campaign, app or date, with filters."
                value={total}
                valueLabel={subjects ? `posts, ${subjects} ${subjects === 1 ? "product or campaign" : "products and campaigns"}` : "posts"}
                row
              />
              {generalTotal !== null && <SectionCard href="/dashboard/content/general" icon={Sparkles} tone="blue" title="General posts" hint="Posts about your business as a whole. Make today's here." value={generalTotal} valueLabel="posts" row />}
              {data.calendar && <SectionCard href="/dashboard/calendar" icon={CalendarDays} tone="indigo" title="Calendar" hint="What goes out each day, week and month." row />}
            </SectionGrid>
          </section>
        </>
      )}
    </div>
  );
}
