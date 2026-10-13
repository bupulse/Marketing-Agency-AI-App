import { requireAdmin } from "@/lib/admin/auth";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, notice } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { approvalNeedsCheck, isExpiredApproval, splitApprovals } from "@/lib/admin/approvals-view";
import { dateTime, money, nowMs, param } from "@/lib/admin/format";
import { APPROVAL_TTL_MS, listApprovals, type ApprovalView } from "@/lib/admin/service";
import { approveFormAction, rejectFormAction } from "@/app/admin/(console)/actions";
import { getPaddleConfig, type PaddleEnvironment } from "@/lib/billing/paddle-config";

export const metadata = { title: "Approvals" };

const paddleHost = (environment: PaddleEnvironment) => (environment === "production" ? "https://vendors.paddle.com" : "https://sandbox-vendors.paddle.com");
const txnOf = (a: ApprovalView) => String(a.params.transactionId ?? (a.result as { transactionId?: string } | null)?.transactionId ?? "");

function TxnLink({ a, env }: { a: ApprovalView; env: PaddleEnvironment }) {
  const id = txnOf(a);
  if (!/^txn_\w+$/.test(id)) return null;
  return (
    <p className="text-[13px]">
      Paddle transaction <a href={`${paddleHost(env)}/transactions-v2/${id}`} target="_blank" rel="noreferrer" className="underline">{id}</a>
      {typeof a.params.lineItemId === "string" && a.params.lineItemId ? <span className="text-muted"> · line item {a.params.lineItemId}</span> : null}
    </p>
  );
}

const requester = (r: string) => (r === "admin" ? "You (console)" : r.startsWith("jarvis:") ? "Jarvis" : r);

function describe(a: ApprovalView) {
  const p = a.params;
  if (a.kind === "issue_refund") {
    const refund = typeof p.refundAmountMinor === "number" ? p.refundAmountMinor : typeof p.amountMinor === "number" ? p.amountMinor : null;
    const cur = typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : "USD";
    const amount = refund !== null ? money(refund, cur) : "the last payment in full";
    const total = typeof p.transactionTotalMinor === "number" ? ` of a ${money(p.transactionTotalMinor, cur)} payment${p.transactionBilledAt ? ` from ${dateTime(String(p.transactionBilledAt)).replace(/, \d\d:\d\d.*/, "")}` : ""}` : "";
    return { title: "Refund", lines: [`Refund ${amount} (${p.refundType === "partial" ? "partial" : "full"})${total}`, `Reason: ${String(p.reason ?? "")}`] };
  }
  if (a.kind === "change_user_email") return { title: "Change a sign-in email", lines: [`${String(p.company ?? "A company")}: change ${String(p.currentEmail)} to ${String(p.newEmail)}`, "The old address is told, every session of that person is ended.", ...(p.sendReset ? ["A password reset link is sent to the new address."] : [])] };
  if (a.kind === "make_company_owner") return { title: "Hand over company ownership", lines: [`${String(p.company ?? "A company")}: ${String(p.email)} becomes the owner (billing and deleting the company).`, `The current owner${p.currentOwner ? ` (${String(p.currentOwner)})` : ""} becomes an Admin.`] };
  const from = p.currentPlan ? ` from ${String(p.currentPlan)}${p.currentInterval ? ` (${String(p.currentInterval).toLowerCase()})` : ""}` : "";
  if (a.kind === "create_offer") return { title: `Custom plan offer${p.send ? " (sent at once)" : " (saved as a draft)"}`, lines: [`${String(p.company ?? "A company")}: ${String(p.adjustedMinor)} ${String(p.currency)} ${p.interval === "YEAR" ? "a year" : "a month"}${p.adjustedMinor !== p.computedMinor ? ` (computed ${String(p.computedMinor)})` : ""}.`, ...(Array.isArray(p.lines) ? (p.lines as unknown[]).map(String) : [])] };
  if (a.kind === "plan_price_change") return { title: "Change a plan price", lines: [`${String(p.planName ?? p.plan)}: ${String(p.oldMonthlyCents)} to ${String(p.monthlyPriceCents)} cents a month, ${String(p.oldYearlyCents)} to ${String(p.yearlyPriceCents)} cents a year.`, ...(Array.isArray(p.lines) ? (p.lines as unknown[]).map(String) : [])] };
  return { title: "Change plan", lines: [`Move to ${String(p.plan)} (${String(p.interval ?? "").toLowerCase()}ly billing)${from}`, "Paddle prorates the change"] };
}

const needsCheck = approvalNeedsCheck;
const tone = (s: string) => (s === "executed" ? "success" : s === "failed" || s === "rejected" || needsCheck(s) ? "danger" : s === "pending" ? "violet" : "neutral") as "success" | "danger" | "violet" | "neutral";

export default async function ApprovalsPage({ searchParams }: PageProps<"/admin/approvals">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const paddleEnv = (await getPaddleConfig()).environment;
  const sp = await searchParams;
  // Pending is its own query so a waiting request can never fall off the newest-100 history.
  const [pendingRows, recent] = await Promise.all([listApprovals({ status: "pending", limit: 100 }), listApprovals({ limit: 100 })]);
  const { pending, history } = splitApprovals(pendingRows, recent, nowMs(), APPROVAL_TTL_MS);
  const isExpired = (a: ApprovalView) => isExpiredApproval(a, nowMs(), APPROVAL_TTL_MS);

  return (
    <>
      <PageHeader title="Approvals" description="Refunds and changes to a paid plan never run by themselves. Jarvis and the API can only ask; they run when you click Approve." />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      {pending.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="Nothing waiting" text="When a refund or paid plan change is requested, it appears here for you to approve or reject." />
      ) : (
        <Panel title={`Waiting for you (${pending.length})`}>
          <ul className="flex flex-col divide-y divide-line">
            {pending.map((a) => {
              const d = describe(a);
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-semibold">{d.title} <Badge tone="violet">Pending</Badge></p>
                    {d.lines.map((l) => (<p key={l} className="text-[14px]">{l}</p>))}
                    <TxnLink a={a} env={paddleEnv} />
                    <p className="text-[13px] text-muted">
                      For <Link href={`/admin/users/${String(a.params.userId)}`} className="underline">this user</Link> · asked by {requester(a.requestedBy)} · {dateTime(a.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ConfirmButton action={rejectFormAction} fields={{ id: a.id }} label="Reject" title="Reject this request?" description="Nothing will be changed." confirmLabel="Reject" />
                    <ConfirmButton action={approveFormAction} fields={{ id: a.id }} variant="primary" label="Approve" title={`Approve: ${d.lines[0]}?`} description="This moves real money through Paddle and cannot be undone from here." confirmLabel="Approve and run" />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel title="History" description="Decided and expired requests. A request waits 7 days for you, then expires.">
        {history.length === 0 ? (
          <Empty>No decided requests yet.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {history.map((a) => {
              const d = describe(a);
              return (
                <li key={a.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                  <p className="text-[14px] font-medium">{d.title}: {d.lines[0]} <Badge tone={tone(isExpired(a) ? "rejected" : a.status)}>{isExpired(a) ? "expired" : a.status === "needs_check" ? "needs check" : a.status}</Badge></p>
                  <TxnLink a={a} env={paddleEnv} />
                  <p className="text-[13px] text-muted">Asked by {requester(a.requestedBy)} on {dateTime(a.createdAt)}{a.decidedAt ? `, decided ${dateTime(a.decidedAt)}` : ""}</p>
                  {needsCheck(a.status) && (
                    <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">
                      Verify in Paddle before doing anything; do not request it again. {a.status === "approved" ? "It was approved but never recorded as finished, so Paddle may have acted." : String((a.result as { warning?: string } | null)?.warning ?? "")}
                    </p>
                  )}
                  {(a.status === "failed" || needsCheck(a.status)) && a.result != null && <p className="text-[13px] text-danger">{String((a.result as { error?: string }).error ?? "")}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
