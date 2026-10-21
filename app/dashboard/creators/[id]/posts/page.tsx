import Link from "next/link";
import { CampaignHeader, openCampaign } from "@/components/creators/company/campaign-page";
import { PostsList } from "@/components/creators/company/posts-list";
import { cn } from "@/lib/cn";
import { listPosts } from "@/lib/creators/analytics";
import { POST_STATUS_LABEL } from "@/lib/creators/company-forms";

export const metadata = { title: "Campaign posts" };

const FILTERS = ["TRACKING", "CHECKING", "INVALID", "REMOVED", "REJECTED", "FINAL"];

export default async function CampaignPostsPage({ params, searchParams }: PageProps<"/dashboard/creators/[id]/posts">) {
  const { id } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && FILTERS.includes(sp.status) ? sp.status : undefined;
  const page = await openCampaign(id);
  if (!page.ok) return page.blocked;
  const { actor, campaign } = page;
  const posts = await listPosts(actor, campaign.id, { status });
  const chip = (value: string | undefined, label: string) => (
    <Link
      key={label}
      href={`/dashboard/creators/${campaign.id}/posts${value ? `?status=${value}` : ""}`}
      aria-current={status === value ? "page" : undefined}
      className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] font-medium no-underline", status === value ? "border-transparent bg-glass-strong text-text" : "border-line text-muted hover:text-text")}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex flex-col gap-6">
      <CampaignHeader campaign={campaign} tab="posts" />
      <nav aria-label="Filter posts" className="-mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-2">
          {chip(undefined, "All")}
          {FILTERS.map((f) => chip(f, POST_STATUS_LABEL[f]))}
        </div>
      </nav>
      <p className="px-1 text-[14px] text-muted">Every post is checked: on the creator&apos;s own connected account, posted on the task&apos;s day, and with one of your mentions. Posts count the moment they are handed in; reject one if it breaks your rules.</p>
      <PostsList campaignId={campaign.id} posts={posts} currency={campaign.currency} />
    </div>
  );
}
