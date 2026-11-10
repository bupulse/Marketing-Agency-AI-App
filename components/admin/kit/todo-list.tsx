import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, CircleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState } from "./empty-state";
import { FOCUS } from "./tones";

export type TodoItem = {
  key: string;
  text: ReactNode;
  href: string;
  /** bad: broken or overdue; warn: waiting for someone; info: worth a look. */
  tone?: "bad" | "warn" | "info";
  icon?: LucideIcon;
  /** How many are waiting (shown big on the right). */
  count?: number;
  /** A short call to action under the text ("Call them"). */
  sub?: ReactNode;
};

const TONE = {
  bad: { chip: "bg-danger-bg text-danger", bar: "bg-danger" },
  warn: { chip: "bg-[#fff4e0] text-[#b45309] dark:bg-[#3a2a0a] dark:text-[#ffc65c]", bar: "bg-[#f59e0b]" },
  info: { chip: "bg-ok-bg text-ok", bar: "bg-pulse-blue" },
} as const;

/**
 * "Needs you": things waiting for a person, worst first, one tappable row each (icon, plain sentence, count, arrow).
 * Says so kindly when nothing is waiting (`empty`). `limit` shows the first few and puts the rest behind "Show N
 * more" (a native details box, no script); `columns={2}` lays the rows out in two columns on a wide screen.
 */
export function TodoList({ items, empty, limit, columns = 1, className }: { items: TodoItem[]; empty?: { title: ReactNode; hint?: ReactNode }; limit?: number; columns?: 1 | 2; className?: string }) {
  if (items.length === 0) return <EmptyState tone="good" title={empty?.title ?? "Nothing needs you right now."} hint={empty?.hint} className={className} />;
  const first = limit && items.length > limit + 1 ? items.slice(0, limit) : items;
  const rest = items.slice(first.length);
  const list = cn("grid grid-cols-1 gap-2", columns === 2 && "xl:grid-cols-2");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ul className={cn("kit-rise", list)}>
        {first.map((i) => (
          <TodoRow key={i.key} i={i} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group/todo flex flex-col gap-2">
          <summary className={cn("inline-flex min-h-10 w-fit cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-pulse-blue hover:border-pulse-blue/40 dark:bg-white/[0.04] dark:text-[#8db0ff] [&::-webkit-details-marker]:hidden", FOCUS)}>
            <span className="group-open/todo:hidden">Show {rest.length} more</span>
            <span className="hidden group-open/todo:inline">Show fewer</span>
          </summary>
          <ul className={cn("mt-2", list)}>
            {rest.map((i) => (
              <TodoRow key={i.key} i={i} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TodoRow({ i }: { i: TodoItem }) {
  const t = TONE[i.tone ?? "warn"];
  const Icon = i.icon ?? CircleAlert;
  return (
    <li>
      <Link
        href={i.href}
        className={cn(
          "group relative flex h-full min-h-[60px] items-center gap-3 overflow-hidden rounded-2xl border border-line bg-surface py-2.5 pl-4 pr-3 text-text no-underline transition-[transform,border-color] duration-200 hover:-translate-y-px hover:border-pulse-blue/35 motion-reduce:transform-none dark:bg-white/[0.035]",
          FOCUS,
        )}
      >
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", t.bar)} />
        <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl", t.chip)}>
          <Icon className="size-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14.5px] font-semibold leading-snug">{i.text}</span>
          {i.sub && <span className="text-[12.5px] leading-snug text-muted">{i.sub}</span>}
        </span>
        {i.count != null && i.count > 0 && <span className="text-[20px] font-bold tabular-nums">{i.count > 999 ? "999+" : i.count}</span>}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none" />
      </Link>
    </li>
  );
}
