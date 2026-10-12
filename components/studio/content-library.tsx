"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge, Chip, GlassCard, Input } from "@/components/ui";
import { prefillFromContent } from "@/components/publishing/prefill";
import { ScheduleButton } from "@/components/publishing/schedule-button";
import { CopyButton } from "./copy-button";
import { formatCopyText, formatWhen, type StudioSubject, type StudioVariant } from "./helpers";

export type LibraryItem = {
  id: string;
  subject: StudioSubject;
  title: string;
  /** "Physical product", "Service", "Event"... */
  label: string;
  caption: string;
  hashtags: string[];
  videoScript: string;
  variants: StudioVariant[];
  language: string;
  edited: boolean;
  createdAt: string;
};

/** Latest text per product or campaign, with search and a filter. */
export function ContentLibrary({ items }: { items: LibraryItem[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");

  const present = useMemo(() => [...new Set(items.map((i) => i.label))].sort(), [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (type === "all" || i.label === type) &&
        (!q || i.caption.toLowerCase().includes(q) || i.title.toLowerCase().includes(q) || i.hashtags.some((h) => h.toLowerCase().includes(q))),
    );
  }, [items, query, type]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label="Search content" placeholder="Search captions, products and campaigns" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
        </div>
        {present.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
            <Chip selected={type === "all"} onClick={() => setType("all")} className="px-4 py-2">
              All
            </Chip>
            {present.map((t) => (
              <Chip key={t} selected={type === t} onClick={() => setType(t)} className="px-4 py-2">
                {t}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <p role="status" className="px-1 text-[13px] text-muted">
        {shown.length} {shown.length === 1 ? "piece" : "pieces"}
      </p>

      {shown.length === 0 ? (
        <GlassCard className="px-4 py-10 text-center text-[15px] text-muted">Nothing matches. Try a different word or filter.</GlassCard>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {shown.map((i) => (
            <li key={i.id}>
              <GlassCard className="flex h-full flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="blue">{i.label}</Badge>
                  <Badge tone={i.edited ? "violet" : "neutral"}>{i.edited ? "Edited" : "AI"}</Badge>
                  <span className="text-[13px] text-muted">{i.language}</span>
                  <span className="ml-auto text-[13px] text-muted">{formatWhen(i.createdAt)}</span>
                </div>
                <Link href={href(i.subject)} className="truncate text-[15px] font-semibold">
                  {i.title}
                </Link>
                <p className="line-clamp-4 flex-1 whitespace-pre-wrap break-words text-[15px] text-muted">{i.caption}</p>
                {i.hashtags.length > 0 && <p className="line-clamp-1 text-[13px] font-medium text-pulse-blue">{i.hashtags.join(" ")}</p>}
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={formatCopyText(i.caption, i.hashtags)} label="Copy" ariaLabel={`Copy caption for ${i.title}`} />
                  <ScheduleButton prefill={prefillFromContent(i, i.subject)} />
                  <Link href={href(i.subject)} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold">
                    Open {i.subject.kind}
                  </Link>
                </div>
              </GlassCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const href = (s: StudioSubject) => (s.kind === "product" ? `/dashboard/knowledge/products/${s.id}` : `/dashboard/knowledge/campaigns/${s.id}`);
