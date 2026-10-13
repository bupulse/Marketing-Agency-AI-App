import { BOOKS_FMT, type MoneyFmt } from "@/components/admin/money";
import { Badge } from "@/components/ui";
import { num } from "@/lib/admin/format";
import { CATEGORY_LABEL, type CostLine, type CostSource, type MonthCosts } from "@/lib/money/costs-shared";
import { Empty, TableWrap, Td, Th } from "../ui";

const SOURCE: Record<CostSource, { label: string; tone: "success" | "violet" | "neutral" | "blue" }> = {
  actual: { label: "billed", tone: "success" },
  estimate: { label: "estimate", tone: "violet" },
  recurring: { label: "recurring", tone: "blue" },
  entered: { label: "entered", tone: "neutral" },
};

export const SourceBadge = ({ source }: { source: CostSource }) => <Badge tone={SOURCE[source].tone}>{SOURCE[source].label}</Badge>;

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** One month's cost lines, dearest first, each marked billed, estimate, recurring or entered. */
export function CostLinesTable({ month, fx = BOOKS_FMT }: { month: MonthCosts | undefined; fx?: MoneyFmt }) {
  if (!month || month.lines.length === 0) return <Empty>No costs for this month yet. Add your recurring costs below; AI costs appear with the first AI call.</Empty>;
  return (
    <TableWrap caption={`Costs of ${month.month}`}>
      <thead>
        <tr><Th>Cost</Th><Th>Kind</Th><Th>Source</Th><Th right>Amount</Th><Th right>Ledger estimate</Th></tr>
      </thead>
      <tbody>
        {month.lines.map((l: CostLine) => (
          <tr key={l.key}>
            <Td className="font-medium">
              {l.label}
              {l.calls ? <span className="block text-xs font-normal text-muted">{num(l.calls)} calls{l.estimatedCalls ? `, ${num(l.estimatedCalls)} timed out (estimated)` : ""}</span> : null}
            </Td>
            <Td>{CATEGORY_LABEL[l.category as keyof typeof CATEGORY_LABEL] ?? l.category}</Td>
            <Td><SourceBadge source={l.source} /></Td>
            <Td right>{fx.el(Math.round(l.cents))}</Td>
            <Td right className="text-muted">
              {l.source === "actual" ? (
                <>
                  {fx.el(Math.round(l.estimateCents ?? 0))}
                  <span className="block text-xs">{diffText(l.cents, l.estimateCents ?? 0)}</span>
                </>
              ) : l.source === "estimate" ? "this is it" : ""}
            </Td>
          </tr>
        ))}
        <tr>
          <Td className="font-semibold">Total</Td><Td /><Td /><Td right className="font-semibold">{fx.el(Math.round(month.totalCents))}</Td><Td />
        </tr>
      </tbody>
    </TableWrap>
  );
}

function diffText(bill: number, estimate: number): string {
  if (estimate <= 0) return "no ledger calls";
  const pct = Math.round(((bill - estimate) / estimate) * 100);
  return pct === 0 ? "matches" : `bill is ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"}`;
}

/** Month by month: AI and voice, recurring, entered, total, and how much of it is still an estimate. */
export function MonthCostTable({ months, fx = BOOKS_FMT }: { months: MonthCosts[]; fx?: MoneyFmt }) {
  if (months.every((m) => m.totalCents === 0)) return <Empty>No costs recorded yet.</Empty>;
  return (
    <TableWrap caption="Costs by month">
      <thead>
        <tr><Th>Month</Th><Th right>AI and voice</Th><Th right>Recurring</Th><Th right>Entered</Th><Th right>Total</Th><Th>Status</Th></tr>
      </thead>
      <tbody>
        {[...months].reverse().map((m) => (
          <tr key={m.month}>
            <Td>{monthLabel(m.month)}</Td>
            <Td right>{fx.el(Math.round(m.aiCents))}</Td>
            <Td right>{fx.el(Math.round(m.recurringCents))}</Td>
            <Td right>{fx.el(Math.round(m.enteredCents))}</Td>
            <Td right className="font-semibold">{fx.el(Math.round(m.totalCents))}</Td>
            <Td>{m.estimateCents > 0 ? <Badge tone="violet">{fx.el(Math.round(m.estimateCents))} estimated</Badge> : m.totalCents > 0 ? <Badge tone="success">all billed</Badge> : null}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
