import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui";
import type { InboxSection } from "@/lib/admin/inbox";
import { dateTime, num } from "@/lib/admin/format";
import { Panel } from "./ui";

/** The to-do list: one card per kind of task, its count, why it matters, the first few items and a link to all. */
export function InboxView({ sections }: { sections: InboxSection[] }) {
  if (sections.length === 0) {
    return (
      <p role="status" className="flex items-center gap-3 rounded-[24px] bg-success-bg px-5 py-6 text-[16px] font-medium text-success">
        <CheckCircle2 aria-hidden className="size-6 shrink-0" /> Inbox zero. Nothing is waiting for you.
      </p>
    );
  }
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {sections.map((s) => (
        <Panel
          key={s.key}
          title={s.title}
          description={s.why}
          action={
            <span className="flex items-center gap-3">
              <Badge tone={s.tone} aria-label={`${s.count} waiting`}>{num(s.count)}</Badge>
              <Link href={s.href} className="text-sm font-medium underline">Open</Link>
            </span>
          }
        >
          <ul className="flex flex-col divide-y divide-line">
            {s.items.map((i) => (
              <li key={i.id} className="py-2.5">
                <Link href={i.href} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 no-underline hover:underline">
                  <span className="min-w-0 font-medium">{i.text}</span>
                  {i.at && <span className="text-xs text-muted">{dateTime(i.at)}</span>}
                  {i.sub && <span className="basis-full truncate text-[13px] text-muted">{i.sub}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {s.count > s.items.length && (
            <Link href={s.href} className="text-sm font-medium underline">
              See all {num(s.count)}
            </Link>
          )}
        </Panel>
      ))}
    </div>
  );
}
