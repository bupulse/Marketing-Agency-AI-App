import "server-only";
import { paddleApi } from "./paddle";

type TransactionLine = { id: string; totals?: { total?: string } };
type PaddleTransaction = {
  id: string;
  status: string;
  customer_id: string | null;
  currency_code: string;
  details?: { line_items?: TransactionLine[]; totals?: { grand_total?: string; total?: string } };
};

export type RefundResult = { adjustmentId: string; status: string; transactionId: string; type: "full" | "partial"; amountMinor: number | null; currency: string };

/** The customer's newest completed transaction id, or null. */
export async function latestCompletedTransaction(customerId: string): Promise<string | null> {
  const query = new URLSearchParams({ customer_id: customerId, status: "completed", order_by: "billed_at[DESC]", per_page: "1" });
  const rows = await paddleApi<{ id: string }[]>(`/transactions?${query}`);
  return rows[0]?.id ?? null;
}

export type RefundLine = { id: string; totalMinor: number };
export type RefundTarget = { transactionId: string; currency: string; totalMinor: number; status: string; billedAt: string | null; lines: RefundLine[] };

/**
 * Looks up the transaction a refund would apply to (the given one, or the customer's newest completed payment) so the
 * request can record exactly which payment and how much. It must belong to `customerId`.
 */
export async function describeRefundTarget(input: { customerId: string; transactionId?: string | null }): Promise<RefundTarget> {
  const transactionId = input.transactionId ?? (await latestCompletedTransaction(input.customerId));
  if (!transactionId) throw new Error("That customer has no completed payment to refund.");
  const tx = await paddleApi<PaddleTransaction & { billed_at?: string | null }>(`/transactions/${encodeURIComponent(transactionId)}`);
  if (tx.customer_id !== input.customerId) throw new Error("That transaction does not belong to this customer.");
  if (tx.status !== "completed") throw new Error(`That transaction is ${tx.status}, not completed, so it cannot be refunded.`);
  const total = Number(tx.details?.totals?.grand_total ?? tx.details?.totals?.total ?? 0);
  return { transactionId: tx.id, currency: tx.currency_code, totalMinor: Number.isFinite(total) ? total : 0, status: tx.status, billedAt: tx.billed_at ?? null, lines: (tx.details?.line_items ?? []).map((l) => ({ id: l.id, totalMinor: Number(l.totals?.total ?? 0) })) };
}

/**
 * Refunds a transaction through Paddle's adjustments API: all of it, or `amountMinor` (in the currency's smallest
 * unit, e.g. cents) from the first line item. The transaction must belong to `customerId`, so a mistyped id can
 * never refund someone else.
 */
export async function createRefund(input: { customerId: string; transactionId: string; amountMinor?: number | null; lineItemId?: string | null; reason: string }): Promise<RefundResult> {
  const tx = await paddleApi<PaddleTransaction>(`/transactions/${encodeURIComponent(input.transactionId)}`);
  if (tx.customer_id !== input.customerId) throw new Error("That transaction does not belong to this customer.");
  if (tx.status !== "completed") throw new Error(`That transaction is ${tx.status}, not completed, so it cannot be refunded.`);
  const partial = input.amountMinor != null;
  const body: Record<string, unknown> = { action: "refund", transaction_id: tx.id, reason: input.reason, type: partial ? "partial" : "full" };
  if (partial) {
    const lines = tx.details?.line_items ?? [];
    const line = input.lineItemId ? lines.find((l) => l.id === input.lineItemId) : lines.length === 1 ? lines[0] : undefined;
    if (!line) throw new Error(input.lineItemId ? "That line item is not on the transaction." : "The transaction has several line items; say which one to refund.");
    const max = Number(line.totals?.total ?? 0);
    if (input.amountMinor! > max) throw new Error(`The refund (${input.amountMinor}) is more than the line total (${max}).`);
    body.items = [{ item_id: line.id, type: "partial", amount: String(input.amountMinor) }];
  }
  const adjustment = await paddleApi<{ id: string; status: string }>("/adjustments", { method: "POST", body });
  return {
    adjustmentId: adjustment.id,
    status: adjustment.status,
    transactionId: tx.id,
    type: partial ? "partial" : "full",
    amountMinor: input.amountMinor ?? null,
    currency: tx.currency_code,
  };
}
