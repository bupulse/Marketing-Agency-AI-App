import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState } from "./empty-state";
import { CARD, FOCUS } from "./tones";

export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** The row's title: bold, first on a phone card, and the link when the list has `rowHref`. One column. */
  primary?: boolean;
  /** Left out of the phone cards (keep the cards short). */
  hideOnPhone?: boolean;
  className?: string;
};

/**
 * A list of records: a table on a computer (from `md`), a stack of cards on a phone, from the same columns. The cells
 * render twice (the table and the cards, one hidden by CSS), so keep forms with ids out of the cells, or pass
 * `mode="table"`. `rowHref` makes the primary cell a link to the record.
 */
export function DataList<T>({
  caption,
  rows,
  columns,
  rowKey,
  rowHref,
  empty,
  mode = "auto",
  className,
}: {
  /** Says what the table lists (for screen readers). */
  caption: string;
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | null;
  /** What to show when there are no rows (text, or an EmptyState). */
  empty?: ReactNode;
  /** "auto": table on a computer, cards on a phone; "table" or "cards" to force one. */
  mode?: "auto" | "table" | "cards";
  className?: string;
}) {
  if (rows.length === 0) return typeof empty === "string" || empty == null ? <EmptyState title={empty ?? "Nothing here yet."} /> : <>{empty}</>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const titleOf = (row: T) => {
    const href = rowHref?.(row);
    const content = primary.cell(row);
    return href ? (
      <Link href={href} className={cn("rounded-md font-semibold text-text underline-offset-2 hover:underline", FOCUS)}>
        {content}
      </Link>
    ) : (
      content
    );
  };
  return (
    <div className={className}>
      {mode !== "cards" && (
        <div className={cn("-mx-1 overflow-x-auto px-1", mode === "auto" && "hidden md:block")}>
          <table className="w-full text-left text-[14px]">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cn("whitespace-nowrap pb-2 pr-3 pt-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted", c.align === "right" && "text-right")}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="transition-colors hover:bg-soft/60">
                  {columns.map((c) => (
                    <td key={c.key} className={cn("border-t border-line py-3 pr-3 align-top", c.align === "right" && "text-right tabular-nums", c === primary && "font-semibold", c.className)}>
                      {c === primary ? titleOf(row) : c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode !== "table" && (
        <ul aria-label={caption} className={cn("flex flex-col gap-2.5", mode === "auto" && "md:hidden")}>
          {rows.map((row) => {
            const href = rowHref?.(row);
            const rest = columns.filter((c) => c !== primary && !c.hideOnPhone);
            return (
              <li key={rowKey(row)} className={cn("relative flex flex-col gap-2.5 p-4", CARD)}>
                <div className="flex items-start justify-between gap-2 text-[15px] font-semibold">
                  <span className="min-w-0">{titleOf(row)}</span>
                  {href && <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />}
                </div>
                {rest.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                    {rest.map((c) => (
                      <div key={c.key} className="flex min-w-0 flex-col gap-0.5">
                        <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{c.header}</dt>
                        <dd className={cn("min-w-0 break-words", c.align === "right" && "tabular-nums")}>{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
