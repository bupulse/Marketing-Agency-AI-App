import type { ReactNode } from "react";

// The full numbers behind a chart, as a table under "Show the full table" (the chart's accessible twin, with every row
// and every column, including the ones the chart leaves out).

export type RankedRow = { key: string; name: ReactNode; value: number; cells: ReactNode[] };

const num = (v: number) => v.toLocaleString("en-GB");

export function RankedTable({ caption, first, columns, rows, empty }: { caption: string; first: string; columns: string[]; rows: RankedRow[]; empty: string }) {
  if (rows.length === 0) return empty ? <p className="py-3 text-sm text-muted">{empty}</p> : null;
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line px-3.5 font-semibold outline-none hover:bg-pulse-blue/5 focus-visible:ring-4 focus-visible:ring-pulse-blue/30 [&::-webkit-details-marker]:hidden">
        Show the full table
      </summary>
      <div className="mt-2 max-h-96 overflow-auto">
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
                <td className="border-b border-line/60 py-2 pr-3 align-top"><span className="block break-words">{r.name}</span></td>
                {r.cells.map((c, i) => <td key={i} className="border-b border-line/60 py-2 pl-3 text-right align-top tabular-nums whitespace-nowrap">{typeof c === "number" ? num(c) : c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
