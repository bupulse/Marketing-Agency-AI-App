import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { num } from "@/lib/admin/format";
import { CATEGORY_LABEL, type CostLine, type CostSource, type MonthCosts } from "@/lib/money/costs-shared";
import { DataList, EmptyState, StatusPill, type PillTone } from "../kit";

const SOURCE: Record<CostSource, { label: string; tone: PillTone }> = {
  actual: { label: "billed", tone: "good" },
  estimate: { label: "estimate", tone: "new" },
  recurring: { label: "recurring", tone: "info" },
  entered: { label: "entered", tone: "muted" },
};

export const SourceBadge = ({ source }: { source: CostSource }) => <StatusPill tone={SOURCE[source].tone} dot>{SOURCE[source].label}</StatusPill>;

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** One month's cost lines, dearest first, each marked billed, estimate, recurring or entered, and the month's total. */
export function CostLinesTable({ month, fx = BOOKS_FMT }: { month: MonthCosts | undefined; fx?: MoneyFmt }) {
  if (!month || month.lines.length === 0) return <EmptyState title="No costs for this month yet." hint="Add your recurring costs; AI costs appear with the first AI call." />;
  return (
    <div className="flex flex-col gap-3">
      <DataList<CostLine>
        caption={`Costs of ${month.month}`}
        rows={month.lines}
        rowKey={(l) => l.key}
        columns={[
          {
            key: "cost",
            header: "Cost",
            primary: true,
            cell: (l) => (
              <span className="flex flex-col">
                <span>{l.label}</span>
                {l.calls ? <span className="text-xs font-normal text-muted">{num(l.calls)} calls{l.estimatedCalls ? `, ${num(l.estimatedCalls)} timed out (estimated)` : ""}</span> : null}
              </span>
            ),
          },
          { key: "amount", header: "Amount", cell: (l) => <span className="font-semibold">{fx.el(Math.round(l.cents))}</span>, align: "right" },
          { key: "source", header: "Source", cell: (l) => <SourceBadge source={l.source} /> },
          { key: "kind", header: "Kind", cell: (l) => CATEGORY_LABEL[l.category as keyof typeof CATEGORY_LABEL] ?? l.category, hideOnPhone: true },
          {
            key: "estimate",
            header: "Ledger estimate",
            align: "right",
            hideOnPhone: true,
            cell: (l) =>
              l.source === "actual" ? (
                <span className="text-muted">
                  {fx.el(Math.round(l.estimateCents ?? 0))}
                  <span className="block text-xs">{diffText(l.cents, l.estimateCents ?? 0)}</span>
                </span>
              ) : l.source === "estimate" ? (
                <span className="text-muted">this is it</span>
              ) : null,
          },
        ]}
      />
      <p className="flex items-baseline justify-between gap-3 rounded-2xl bg-soft px-4 py-3 text-[14px]">
        <span className="font-semibold">Total</span>
        <span className="text-[17px] font-bold tabular-nums">{fx.el(Math.round(month.totalCents))}</span>
      </p>
    </div>
  );
}

function diffText(bill: number, estimate: number): string {
  if (estimate <= 0) return "no ledger calls";
  const pct = Math.round(((bill - estimate) / estimate) * 100);
  return pct === 0 ? "matches" : `bill is ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"}`;
}

/** Month by month: AI and voice, recurring, entered, total, and how much of it is still an estimate. */
export function MonthCostTable({ months, fx = BOOKS_FMT }: { months: MonthCosts[]; fx?: MoneyFmt }) {
  if (months.every((m) => m.totalCents === 0)) return <EmptyState title="No costs recorded yet." hint="Costs appear with the first AI call or recurring cost." />;
  return (
    <DataList<MonthCosts>
      caption="Costs by month"
      rows={[...months].reverse()}
      rowKey={(m) => m.month}
      columns={[
        { key: "month", header: "Month", cell: (m) => monthLabel(m.month), primary: true },
        { key: "total", header: "Total", cell: (m) => <span className="font-semibold">{fx.el(Math.round(m.totalCents))}</span>, align: "right" },
        { key: "status", header: "Status", cell: (m) => (m.estimateCents > 0 ? <StatusPill tone="new" dot>{fx.el(Math.round(m.estimateCents))} estimated</StatusPill> : m.totalCents > 0 ? <StatusPill tone="good" dot>all billed</StatusPill> : null) },
        { key: "ai", header: "AI and voice", cell: (m) => fx.el(Math.round(m.aiCents)), align: "right", hideOnPhone: true },
        { key: "recurring", header: "Recurring", cell: (m) => fx.el(Math.round(m.recurringCents)), align: "right", hideOnPhone: true },
        { key: "entered", header: "Entered", cell: (m) => fx.el(Math.round(m.enteredCents)), align: "right", hideOnPhone: true },
      ]}
    />
  );
}
