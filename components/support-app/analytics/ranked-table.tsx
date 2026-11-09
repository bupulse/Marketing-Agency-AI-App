import type { ReactNode } from "react";

// A ranked list as a table: the name, a thin bar for the share of the top row (a picture of the numbers beside it,
// which stay readable as text), and the counts. Works at phone width: the bar sits under the name.

export type RankedRow = { key: string; name: ReactNode; value: number; cells: ReactNode[] };

const num = (v: number) => v.toLocaleString("en-GB");

export function RankedTable({ caption, first, columns, rows, empty }: { caption: string; first: string; columns: string[]; rows: RankedRow[]; empty: string }) {
  if (rows.length === 0) return <p className="py-3 text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs tracking-[0.03em] text-muted">
            <th scope="col" className="border-b border-line py-2 pr-3 font-semibold">{first.toUpperCase()}</th>
            {columns.map((c) => <th key={c} scope="col" className="border-b border-line py-2 pl-3 text-right font-semibold whitespace-nowrap">{c.toUpperCase()}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="border-b border-line/60 py-2 pr-3 align-top">
                <span className="block break-words">{r.name}</span>
                <span aria-hidden className="mt-1 block h-1.5 rounded-full bg-ok-bg">
                  <span className="block h-full rounded-full bg-[var(--color-pulse-blue)]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
                </span>
              </td>
              {r.cells.map((c, i) => <td key={i} className="border-b border-line/60 py-2 pl-3 text-right align-top tabular-nums whitespace-nowrap">{typeof c === "number" ? num(c) : c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
