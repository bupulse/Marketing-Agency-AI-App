import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Megaphone, Package, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { getAppContext } from "@/components/app/context";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button, GlassCard } from "@/components/ui";
import { latestContentPosts } from "@/lib/content-board/drafts";
import { activeFilterCount, contentQuery, parseContentFilters, PAGE_SIZE, type ContentScope } from "@/lib/content-board/filters";
import { loadOnePost, loadSubjectInfo, loadSubjectPosts } from "@/lib/content-board/queries";
import { loadComposerContext } from "@/lib/publishing/queries";
import { CreatePostsButton } from "./content-actions";
import { FilterBar } from "./filter-bar";
import { GeneratePostsButton } from "./generate-posts";
import { PostBoard } from "./post-board";

type SearchParams = Record<string, string | string[] | undefined>;

/** One product's, campaign's or General's posts as cards, with the same filters as the grid. */
export async function SubjectPostsPage({ scope, searchParams }: { scope: ContentScope; searchParams: SearchParams }) {
  const blocked = (await featureGate("content")) ?? (await featureGate("calendar"));
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const info = await loadSubjectInfo(business.id, scope);
  if (!info) notFound();
  const filters = parseContentFilters(searchParams);
  const zone = business.timezone || "UTC";
  const now = new Date();
  const postId = typeof searchParams.post === "string" ? searchParams.post.slice(0, 64) : null;

  // Content written before posts were drafted gets them now, once (the backfill); then the list is read.
  const latest = scope.kind === "general" ? null : await latestContentPosts(business.id, scope.kind === "product" ? { productId: scope.id } : { campaignId: scope.id }, { backfill: true }).catch(() => null);
  const [list, context, openPost] = await Promise.all([
    loadSubjectPosts(business.id, scope, filters, zone, now),
    loadComposerContext(business.id),
    postId ? loadOnePost(business.id, postId) : null,
  ]);
  const path = scope.kind === "general" ? "/dashboard/content/general" : `/dashboard/content/${scope.kind === "product" ? "products" : "campaigns"}/${scope.id}`;
  const moreHref = list.hasMore ? `${path}${contentQuery({ ...filters, limit: filters.limit + PAGE_SIZE }, { limit: true })}` : null;
  const filtered = activeFilterCount(filters) > 0 || Boolean(filters.q);
  const Icon = scope.kind === "product" ? Package : scope.kind === "campaign" ? Megaphone : Sparkles;
  const thing = scope.kind === "campaign" ? "campaign" : "product";

  const empty = filtered ? (
    <EmptyState icon={Icon} title="No posts match these filters" text="Try another app, type or date, or clear the filters to see every post." action={<Button href={path}>Clear filters</Button>} />
  ) : latest && !latest.hasPosts ? (
    <EmptyState
      icon={Icon}
      title={`This ${thing} has content but no posts yet`}
      text="BuPulse makes a post for each app the content was written for, with its picture or video. Apps you have not connected get a reminder to post it yourself."
      action={<CreatePostsButton contentId={latest.contentId} />}
    />
  ) : scope.kind === "general" ? (
    <EmptyState
      icon={Sparkles}
      title="No general posts yet"
      text="Tips, greetings and brand posts that are not about one product or campaign show up here. Autopilot writes them for you every week."
      action={<Button href="/dashboard/autopilot">Set up Autopilot</Button>}
    />
  ) : (
    <EmptyState
      icon={Icon}
      title={`No posts for this ${thing} yet`}
      text={`BuPulse writes a post for each of your apps, with its picture or video, from what you told it about this ${thing}. They wait for your OK on the Content page.`}
      action={info.subjectId ? <GeneratePostsButton subjectId={info.subjectId} label={`Generate posts for this ${thing}`} /> : undefined}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/dashboard/content${contentQuery({ ...filters, q: undefined, sort: "recent" })}`} className="-mb-2 inline-flex min-h-11 w-fit items-center gap-1 px-1 text-[15px] font-medium text-muted hover:text-text">
        <ChevronLeft aria-hidden className="size-4" /> Content
      </Link>
      <PageHeader
        title={info.name}
        description={info.label}
        action={
          info.albumHref ? (
            <Button href={info.albumHref} variant="outline" size="sm">
              Open {thing}
            </Button>
          ) : undefined
        }
      />
      <FilterBar filters={filters} />
      {latest && !latest.hasPosts && list.posts.length > 0 && (
        <GlassCard className="flex flex-wrap items-center gap-3 p-4">
          <p className="min-w-0 flex-1 text-[15px]">The newest content for this {thing} has no posts yet.</p>
          <CreatePostsButton contentId={latest.contentId} />
        </GlassCard>
      )}
      <PostBoard posts={list.posts} total={list.total} zone={zone} context={context} moreHref={moreHref} openPost={openPost} empty={empty} />
    </div>
  );
}
