import { requireAdmin } from "@/lib/admin/auth";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeader } from "@/components/app";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, TableWrap, Td, Th, notice } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { dateTime, num, param } from "@/lib/admin/format";
import { currencyDigits, money } from "@/lib/admin/format";
import { describeRefundTarget } from "@/lib/billing/paddle-admin";
import { prisma } from "@/lib/db";
import { AdminError, getBusiness, getUser, listFeatureFlags, listPosts } from "@/lib/admin/service";
import { changePlanAction, extendTrialAction, flagOverrideAction, refundAction, restoreAction, suspendAction } from "../../actions";

export const metadata = { title: "User" };

export default async function UserPage({ params, searchParams }: PageProps<"/admin/users/[id]">) {
  await requireAdmin(); // pages render alongside the layout, so check here too
  const { id } = await params;
  const sp = await searchParams;
  let user;
  try {
    user = await getUser(id);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  const [business, posts, flags] = await Promise.all([
    user.business ? getBusiness(user.business.id) : null,
    listPosts({ userId: id, limit: 8 }),
    listFeatureFlags(),
  ]);
  // One key per form, so a double submit of the same form is the same request but the two forms never collide.
  const idemPlan = `console-${randomUUID()}`;
  const idemRefund = `console-${randomUUID()}`;
  // The payment a refund would apply to, with its currency and line items. Paddle being down just hides the extras.
  const sub = user.provider === "PADDLE" ? await prisma.subscription.findUnique({ where: { userId: id }, select: { providerCustomerId: true } }) : null;
  const target = sub?.providerCustomerId ? await describeRefundTarget({ customerId: sub.providerCustomerId }).catch(() => null) : null;
  const currency = target?.currency ?? "USD";
  const here = `/admin/users/${id}`;
  const statusTone = user.status === "active" ? "success" : user.status === "suspended" ? "danger" : "neutral";

  return (
    <>
      <PageHeader title={user.email} description={user.name ?? undefined} action={<Badge tone={statusTone}>{user.status}</Badge>} />
      {param(sp.notice) && <p role="status" className={notice.ok}>{param(sp.notice)}</p>}
      {param(sp.error) && <p role="alert" className={notice.bad}>{param(sp.error)}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
            <dt className="text-muted">Plan</dt><dd>{user.plan ?? "none"} ({user.subscriptionStatus?.toLowerCase() ?? "no subscription"})</dd>
            <dt className="text-muted">Billing</dt><dd>{user.provider ? `${user.provider.toLowerCase()}, ${user.interval?.toLowerCase() ?? "n/a"}` : "None"}</dd>
            <dt className="text-muted">Trial ends</dt><dd>{user.trialEndsAt ? dateTime(user.trialEndsAt) : "n/a"}</dd>
            <dt className="text-muted">Period ends</dt><dd>{user.currentPeriodEnd ? dateTime(user.currentPeriodEnd) : "n/a"}{user.cancelAtPeriodEnd ? " (cancels then)" : ""}</dd>
            <dt className="text-muted">Joined</dt><dd>{dateTime(user.createdAt)}</dd>
            <dt className="text-muted">Last sign-in</dt><dd>{user.lastSignInAt ? dateTime(user.lastSignInAt) : "unknown"}</dd>
            {user.suspendedAt && (<><dt className="text-muted">Suspended</dt><dd>{dateTime(user.suspendedAt)}{user.suspendedReason ? `: ${user.suspendedReason}` : ""}</dd></>)}
            {user.deletionScheduledFor && (<><dt className="text-muted">Deletion</dt><dd>{dateTime(user.deletionScheduledFor)}</dd></>)}
          </dl>
        </Panel>
        <Panel title="Business" description={business ? undefined : "This user has not set up a business yet."}>
          {business && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
              <dt className="text-muted">Name</dt><dd>{business.name}</dd>
              <dt className="text-muted">Industry</dt><dd>{business.industry ?? "n/a"}</dd>
              <dt className="text-muted">Country</dt><dd>{business.country ?? "n/a"}</dd>
              <dt className="text-muted">Onboarded</dt><dd>{business.onboarded ? "Yes" : "No"}</dd>
              <dt className="text-muted">Projects, posts, leads</dt><dd>{business.counts.projects}, {business.counts.posts}, {business.counts.leads}</dd>
              <dt className="text-muted">Posts by status</dt><dd>{Object.entries(business.posts).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(", ") || "none"}</dd>
            </dl>
          )}
        </Panel>
      </div>

      <Panel title="Usage this period" description="Metered features used, from the usage records.">
        {user.usage ? (
          <ul className="grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-5">
            {([["Text", user.usage.text], ["Images", user.usage.image], ["Video seconds", user.usage.videoSeconds], ["Voice characters", user.usage.voiceCharacters], ["Chat messages", user.usage.chat]] as const).map(([l, v]) => (
              <li key={l}><span className="block text-muted">{l}</span><span className="text-lg font-semibold tabular-nums">{num(v)}</span></li>
            ))}
          </ul>
        ) : (
          <Empty>No usage recorded yet.</Empty>
        )}
      </Panel>

      <Panel title="Actions" description="Everything here is written to the audit log. Refunds and paid plan changes wait for your Approve.">
        <div className="flex flex-wrap gap-2">
          {user.plan === "TRIAL" && (
            <ConfirmButton action={extendTrialAction} fields={{ userId: id }} label="Extend trial" title="Extend trial" description="Adds days to the end of the trial.">
              <Field label="Days (1 to 90)"><Input name="days" type="number" min={1} max={90} defaultValue={7} required /></Field>
            </ConfirmButton>
          )}
          {user.status === "suspended" ? (
            <ConfirmButton action={restoreAction} fields={{ userId: id }} label="Restore" title="Restore this user?" description="They can sign in and use BuPulse again." />
          ) : (
            <ConfirmButton action={suspendAction} fields={{ userId: id }} label="Suspend" title="Suspend this user?" description="They are signed out and blocked from every page and API call. Their data is kept." >
              <Field label="Reason (optional)"><Input name="reason" maxLength={300} /></Field>
            </ConfirmButton>
          )}
          <ConfirmButton action={changePlanAction} fields={{ userId: id, idem: idemPlan }} label="Change plan" title="Change plan" description="Moving to Standard or Pro creates an approval request. Trial is applied now.">
            <Field label="Plan"><Select name="plan" defaultValue={user.plan ?? "STANDARD"}><option value="TRIAL">Trial</option><option value="STANDARD">Standard</option><option value="PRO">Pro</option></Select></Field>
            <Field label="Billing"><Select name="interval" defaultValue={user.interval ?? "MONTH"}><option value="MONTH">Monthly</option><option value="YEAR">Yearly</option></Select></Field>
          </ConfirmButton>
          <ConfirmButton action={refundAction} fields={{ userId: id, idem: idemRefund, currency, ...(target ? { transactionId: target.transactionId } : {}) }} label="Refund" title="Request a refund" description="Creates an approval request. Nothing is refunded until you approve it." confirmLabel="Create request">
            {target ? (
              <p className="text-[14px] text-muted">Last payment: {money(target.totalMinor, currency)}{target.billedAt ? `, ${new Date(target.billedAt).toISOString().slice(0, 10)}` : ""} ({target.transactionId}).</p>
            ) : (
              <p className="text-[14px] text-muted">The payment details could not be loaded; the last completed payment is used.</p>
            )}
            {target && target.lines.length > 1 && (
              <Field label="Which item" hint="Needed for a partial refund; a full refund covers the whole payment.">
                <Select name="lineItemId" defaultValue={target.lines[0].id}>
                  {target.lines.map((l) => (<option key={l.id} value={l.id}>{l.id} ({money(l.totalMinor, currency)})</option>))}
                </Select>
              </Field>
            )}
            <Field label={`Amount in ${currency}`} hint={`Leave empty to refund the payment in full.${currencyDigits(currency) === 0 ? " Whole numbers only." : ""}`}><Input name="amount" inputMode="decimal" placeholder="Full refund" /></Field>
            <Field label="Reason" required><Input name="reason" maxLength={300} required /></Field>
          </ConfirmButton>
        </div>
      </Panel>

      <Panel title="Feature flags for this user" description="An override beats the flag’s rollout. “Default” removes the override.">
        {flags.length === 0 ? (
          <Empty>No flags exist yet. <Link href="/admin/flags" className="underline">Create one</Link>.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {flags.map((fl) => {
              const o = (fl.userOverrides as Record<string, boolean> | null)?.[id];
              return (
                <li key={fl.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span><code className="font-mono text-[13px]">{fl.key}</code> <span className="text-xs text-muted">flag {fl.enabled ? `on at ${fl.rolloutPercent}%` : "off"}</span></span>
                  <form action={flagOverrideAction} className="flex items-center gap-2">
                    <input type="hidden" name="key" value={fl.key} /><input type="hidden" name="userId" value={id} /><input type="hidden" name="back" value={here} />
                    <Select name="value" defaultValue={o === undefined ? "remove" : o ? "on" : "off"} aria-label={`Override for ${fl.key}`} className="min-h-11"><option value="remove">Default</option><option value="on">Forced on</option><option value="off">Forced off</option></Select>
                    <Button type="submit" size="sm" variant="outline">Save</Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Connections">
          {business && business.connections.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-[14px]">
              {business.connections.map((c) => (<li key={c.id} className="flex justify-between gap-2"><span className="truncate">{c.displayName ?? c.provider}</span><Badge tone={c.status === "ACTIVE" ? "success" : "neutral"}>{c.status.toLowerCase()}</Badge></li>))}
            </ul>
          ) : (<Empty>No social accounts connected.</Empty>)}
        </Panel>
        <Panel title="Recent errors" action={<Link href={`/admin/errors?userId=${id}`} className="text-sm underline">All</Link>}>
          {user.recentErrors.length ? (
            <ul className="flex flex-col gap-2 text-[14px]">
              {user.recentErrors.map((e) => (<li key={e.id}><span className="block truncate font-medium">{e.source}: {e.message}</span><span className="text-xs text-muted">{dateTime(e.createdAt)}</span></li>))}
            </ul>
          ) : (<Empty>No errors for this user.</Empty>)}
        </Panel>
      </div>

      <Panel title="Recent posts">
        {posts.items.length === 0 ? (<Empty>No posts yet.</Empty>) : (
          <TableWrap caption="Recent posts">
            <thead><tr><Th>Post</Th><Th>Network</Th><Th>Status</Th><Th>When</Th></tr></thead>
            <tbody>
              {posts.items.map((p) => (
                <tr key={p.id}><Td className="max-w-[22rem]"><span className="line-clamp-2">{p.text}</span>{p.lastError && <span className="block text-xs text-danger">{p.lastError}</span>}</Td><Td>{p.network}</Td><Td>{p.status.toLowerCase()}</Td><Td className="whitespace-nowrap">{dateTime(p.publishedAt ?? p.scheduledAt ?? p.createdAt)}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {user.recentApprovals.length > 0 && (
        <Panel title="Approval requests" action={<Link href="/admin/approvals" className="text-sm underline">Open approvals</Link>}>
          <ul className="flex flex-col gap-1 text-[14px]">{user.recentApprovals.map((a) => (<li key={a.id}>{a.kind.replace("_", " ")}: {a.status} ({dateTime(a.createdAt)})</li>))}</ul>
        </Panel>
      )}
    </>
  );
}
