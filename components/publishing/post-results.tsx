"use client";

import Link from "next/link";
import { Bookmark, ExternalLink, Eye, Heart, MessageCircle, Share2, Users, type LucideIcon } from "lucide-react";
import { formatCompact } from "@/components/analytics/format";
import { timeAgo } from "@/components/leads/format";
import { cn } from "@/lib/cn";
import { badgeResults, knownResults, resultLabel, resultsNote, type PostResults, type ResultKey } from "@/lib/publishing/results";
import type { CalendarPost } from "@/lib/publishing/types";
import { formatDateTime } from "./helpers";
import { NetworkIcon, networkName } from "./network-icon";

const ICON: Record<ResultKey, LucideIcon> = { views: Eye, reach: Users, likes: Heart, comments: MessageCircle, shares: Share2, saves: Bookmark };
const TITLE: Record<ResultKey, string> = { views: "Views", reach: "Reach", likes: "Likes", comments: "Comments", shares: "Shares", saves: "Saves" };

/** "1.2K views, 48 likes, 6 comments": the badge in words, for a card's label. Null until results are in. */
export function resultsSummary(results: PostResults | undefined): string | null {
  if (results?.state !== "ready") return null;
  const items = badgeResults(results);
  return items.length > 0 ? items.map((i) => `${formatCompact(i.value)} ${resultLabel(i.key, i.value)}`).join(", ") : null;
}

/** A published post's numbers on its calendar card (views, likes, comments). Nothing until results are in. */
export function ResultsBadge({ results, className }: { results: PostResults | undefined; className?: string }) {
  if (results?.state !== "ready") return null;
  const items = badgeResults(results);
  if (items.length === 0) return null;
  return (
    <span data-results className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-semibold tabular-nums text-text", className)}>
      {items.map(({ key, value }) => {
        const Icon = ICON[key];
        return (
          <span key={key} title={TITLE[key]} className="inline-flex items-center gap-0.5">
            <Icon aria-hidden className="size-3 text-muted" />
            {formatCompact(value)}
          </span>
        );
      })}
    </span>
  );
}

/** The Results part of a published post's detail: one row per network the post went out on, this one first. */
export function ResultsPanel({ posts, zone }: { posts: CalendarPost[]; zone: string }) {
  return (
    <section aria-labelledby="post-results-title" className="flex flex-col gap-2">
      <h3 id="post-results-title" className="text-[15px] font-semibold">Results</h3>
      <ul className="flex flex-col gap-2">
        {posts.map((p) => (
          <ResultsRow key={p.id} post={p} zone={zone} />
        ))}
      </ul>
    </section>
  );
}

function ResultsRow({ post, zone }: { post: CalendarPost; zone: string }) {
  const results = post.results;
  if (!results) return null;
  const label = networkName(post.network);
  const note = resultsNote(results, post.network, label);
  const known = results.state === "ready" ? knownResults(results) : [];
  const reconnect = results.state === "reconnect" || (results.state === "ready" && results.stale === "reconnect");
  return (
    <li data-network={post.network} className="flex flex-col gap-2.5 rounded-2xl bg-soft p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <NetworkIcon network={post.network} size={18} />
        <span className="text-[14px] font-semibold">{label}</span>
        {post.accountName !== label && <span className="min-w-0 truncate text-[13px] text-muted">{post.accountName}</span>}
        {results.state === "ready" && (
          <span className="ml-auto text-[13px] text-muted">
            Updated <time dateTime={results.updatedAt} title={formatDateTime(results.updatedAt, zone)}>{timeAgo(results.updatedAt)}</time>
          </span>
        )}
      </div>
      {known.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
          {known.map(({ key, value }) => {
            const Icon = ICON[key];
            return (
              <div key={key} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface px-3 py-2">
                <dt className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
                  <Icon aria-hidden className="size-3.5" />
                  {TITLE[key]}
                </dt>
                <dd className="m-0 text-[20px] font-semibold tabular-nums tracking-[-0.02em]">{formatCompact(value)}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {note && <p className="text-[13px] text-muted">{note}</p>}
      {(reconnect || post.permalink) && (
        <div className="flex flex-wrap items-center gap-x-4">
          {reconnect && (
            <Link href="/dashboard/connections" className="inline-flex min-h-11 items-center text-[14px] font-semibold underline underline-offset-2">
              Reconnect {label}
            </Link>
          )}
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-pulse-blue">
              View on {label} <ExternalLink aria-hidden className="size-4" />
            </a>
          )}
        </div>
      )}
    </li>
  );
}
