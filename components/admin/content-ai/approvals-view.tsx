import Link from "next/link";
import { BadgeCheck, CircleAlert, History, Hourglass } from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { approvalNeedsCheck } from "@/lib/admin/approvals-view";
import { dateTime, money } from "@/lib/admin/format";
import type { ApprovalView } from "@/lib/admin/service";
import type { PaddleEnvironment } from "@/lib/billing/paddle-config";
import { cn } from "@/lib/cn";
import { approveFormAction, rejectFormAction } from "@/app/admin/(console)/actions";
import { CARD, EmptyState, FilterChips, IconBadge, PageHeader, StatGrid, StatTile, StatusPill, type PillTone, type SearchParamsLike } from "../kit";
import { notice } from "../ui";

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

/** A request in words: its title and the lines that say what it does. */
export function describeApproval(a: ApprovalView) {
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
function pill(a: ApprovalView, expired: boolean): { tone: PillTone; text: string } {
  if (expired) return { tone: "muted", text: "Expired" };
  if (needsCheck(a.status)) return { tone: "bad", text: "Needs a check" };
  if (a.status === "executed") return { tone: "good", text: "Done" };
  if (a.status === "failed") return { tone: "bad", text: "Failed" };
  if (a.status === "rejected") return { tone: "muted", text: "Rejected" };
  if (a.status === "pending") return { tone: "new", text: "Pending" };
  return { tone: "muted", text: a.status };
}

export const APPROVAL_VIEWS = ["waiting", "history", "check"] as const;

/**
 * Approvals: three numbers, chips for Waiting / History / Needs a check, and one card per request. A waiting card
 * says in words what will happen, with Reject and Approve (both confirmed in a dialog, as before).
 */
export function ApprovalsView({ pending, history, isExpired, paddleEnv, view, params, message }: { pending: ApprovalView[]; history: ApprovalView[]; isExpired: (a: ApprovalView) => boolean; paddleEnv: PaddleEnvironment; view: (typeof APPROVAL_VIEWS)[number]; params: SearchParamsLike; message: { notice?: string; error?: string } }) {
  const checks = history.filter((a) => needsCheck(a.status) || a.status === "failed");
  const rows = view === "history" ? history : view === "check" ? checks : [];
  return (
    <>
      <PageHeader icon={BadgeCheck} tone="violet" title="Approvals" description="Refunds and changes to a paid plan never run by themselves. Jarvis and the API can only ask; they run when you tap Approve." />
      {message.notice && <p role="status" className={notice.ok}>{message.notice}</p>}
      {message.error && <p role="alert" className={notice.bad}>{message.error}</p>}
      <StatGrid cols={3}>
        <StatTile icon={Hourglass} tone="violet" label="Waiting for you" value={String(pending.length)} alert={pending.length > 0} hint="A request waits 7 days, then expires." />
        <StatTile icon={CircleAlert} tone="violet" label="To check in Paddle" value={String(checks.length)} alert={checks.length > 0} hint="Failed, or approved but never recorded as finished." />
        <StatTile icon={History} tone="violet" label="Decided" value={String(history.length)} hint="The newest 100 decided or expired requests." className="max-lg:col-span-2" />
      </StatGrid>
      <FilterChips
        label="Show requests"
        param="view"
        base="/admin/approvals"
        params={params}
        current={view}
        allValue="waiting"
        options={[{ value: "waiting", label: "Waiting", count: pending.length }, { value: "history", label: "History", count: history.length }, ...(checks.length ? [{ value: "check", label: "Needs a check", count: checks.length }] : [])]}
      />
      {view === "waiting" ? (
        pending.length === 0 ? (
          <EmptyState tone="good" icon={BadgeCheck} title="Nothing waiting." hint="When a refund or a paid plan change is requested, it appears here for you to approve or reject." />
        ) : (
          <ul className="kit-rise grid items-start gap-3 xl:grid-cols-2">
            {pending.map((a) => {
              const d = describeApproval(a);
              return (
                <li key={a.id} className={cn("relative flex min-w-0 flex-col gap-3 overflow-hidden p-4 sm:p-5", CARD)}>
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-pulse-violet" />
                  <div className="flex items-start gap-3">
                    <IconBadge icon={BadgeCheck} tone="violet" size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold">{d.title}</p>
                      <p className="text-[12.5px] text-muted">Asked by {requester(a.requestedBy)} · {dateTime(a.createdAt)}</p>
                    </div>
                    <StatusPill tone="new" dot>Pending</StatusPill>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-2xl bg-soft/70 px-3.5 py-3 text-[14px] dark:bg-white/[0.04]">
                    {d.lines.map((l) => (<p key={l}>{l}</p>))}
                    <TxnLink a={a} env={paddleEnv} />
                    <p className="pt-1 text-[13px] text-muted">For <Link href={`/admin/users/${String(a.params.userId)}`} className="underline">this user</Link></p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <ConfirmButton action={rejectFormAction} fields={{ id: a.id }} label="Reject" title="Reject this request?" description="Nothing will be changed." confirmLabel="Reject" />
                    <ConfirmButton action={approveFormAction} fields={{ id: a.id }} variant="primary" label="Approve" title={`Approve: ${d.lines[0]}?`} description="This moves real money through Paddle and cannot be undone from here." confirmLabel="Approve and run" />
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title={view === "check" ? "Nothing to check." : "No decided requests yet."} />
      ) : (
        <ul className="kit-rise flex flex-col gap-2.5">
          {rows.map((a) => {
            const d = describeApproval(a);
            const p = pill(a, isExpired(a));
            return (
              <li key={a.id} className={cn("flex min-w-0 flex-col gap-1 p-4", CARD, needsCheck(a.status) && "ring-1 ring-danger/35")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-[14px] font-semibold">{d.title}: <span className="font-normal">{d.lines[0]}</span></p>
                  <StatusPill tone={p.tone} dot>{p.text}</StatusPill>
                </div>
                <TxnLink a={a} env={paddleEnv} />
                <p className="text-[12.5px] text-muted">Asked by {requester(a.requestedBy)} on {dateTime(a.createdAt)}{a.decidedAt ? `, decided ${dateTime(a.decidedAt)}` : ""}</p>
                {needsCheck(a.status) && (
                  <p role="alert" className="mt-1 rounded-xl bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">
                    Verify in Paddle before doing anything; do not request it again. {a.status === "approved" ? "It was approved but never recorded as finished, so Paddle may have acted." : String((a.result as { warning?: string } | null)?.warning ?? "")}
                  </p>
                )}
                {(a.status === "failed" || needsCheck(a.status)) && a.result != null && <p className="text-[13px] text-danger">{String((a.result as { error?: string }).error ?? "")}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
