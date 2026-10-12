import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { Empty, Panel, Stat, TableWrap, Td, Th } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Meter } from "@/components/ui";
import { cn } from "@/lib/cn";
import { currencyDigits, dateTime, money, num } from "@/lib/admin/format";
import { formatPhone } from "@/lib/phone";
import { diffJson, show } from "@/lib/admin/diff";
import { AdminError, getBusiness, getUser, listFeatureFlags } from "@/lib/admin/service";
import {
  auditSection, billingSection, channelsSection, CLIENT_TABS, contentSection, errorsSection, leadsSection, loadClient, notesSection, overviewSection, usageSection,
  type ClientTab,
} from "@/lib/admin/client360";
import { describeRefundTarget } from "@/lib/billing/paddle-admin";
import { getPlans } from "@/lib/plan-catalog";
import { prisma } from "@/lib/db";
import { addNoteAction, changePlanAction, deleteNoteAction, extendTrialAction, flagOverrideAction, refundAction, restoreAction, suspendAction } from "@/app/admin/(console)/actions";


export const CLIENT_TAB_LABELS: Record<ClientTab, string> = { overview: "Overview", billing: "Billing", usage: "Usage", channels: "Channels", content: "Content", leads: "Leads and chat", errors: "Errors", audit: "Audit history", notes: "Notes" };

export { CLIENT_TABS };

export type ExtraTab = { key: string; label: string };

/**
 * Client 360 for one user (the account owner): tab nav, the actions and the active tab. Mounted by /admin/users/[id]
 * and by the company page. `extraTabs` are the host page's own tabs; the host renders them when `tab` matches one.
 * The caller has already passed requireAdmin.
 */
export async function Client360({ userId, tab: asked, basePath, extraTabs = [] }: { userId: string; tab?: string; basePath: string; extraTabs?: ExtraTab[] }) {
  const id = userId;
  const tab: ClientTab = (CLIENT_TABS as readonly string[]).includes(asked ?? "") ? (asked as ClientTab) : "overview";
  const extra = extraTabs.some((t) => t.key === asked);
  let c;
  try {
    c = await loadClient(id);
  } catch (e) {
    if (e instanceof AdminError && e.code === "not_found") notFound();
    throw e;
  }
  const here = basePath;
  const showActions = !extra && (tab === "overview" || tab === "billing");
  return (
    <>
      <nav aria-label="Client sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {[...CLIENT_TABS.map((t) => ({ key: t as string, label: CLIENT_TAB_LABELS[t] })), ...extraTabs].map((t) => {
          const active = extra ? t.key === asked : t.key === tab;
          return (
            <Link
              key={t.key}
              href={t.key === "overview" ? here : `${here}?tab=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium no-underline", active ? "bg-surface text-text shadow-glass" : "bg-soft text-muted hover:text-text")}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {showActions && <Actions id={id} c={c} />}
      {!extra && tab === "overview" && <OverviewTab id={id} c={c} here={here} />}
      {!extra && tab === "billing" && <BillingTab c={c} />}
      {!extra && tab === "usage" && <UsageTab c={c} />}
      {!extra && tab === "channels" && <ChannelsTab c={c} />}
      {!extra && tab === "content" && <ContentTab c={c} />}
      {!extra && tab === "leads" && <LeadsTab c={c} />}
      {!extra && tab === "errors" && <ErrorsTab c={c} />}
      {!extra && tab === "audit" && <AuditTab c={c} />}
      {!extra && tab === "notes" && <NotesTab id={id} c={c} />}
    </>
  );
}

export async function clientHeader(userId: string) {
  const c = await loadClient(userId);
  const status = c.suspendedAt ? "suspended" : c.deletionScheduledFor ? "deleting" : "active";
  return { email: c.email, name: c.name, business: c.business?.name ?? null, status, tone: (status === "active" ? "success" : status === "suspended" ? "danger" : "neutral") as "success" | "danger" | "neutral" };
}

type C = Awaited<ReturnType<typeof loadClient>>;

async function Actions({ id, c }: { id: string; c: C }) {
  // One key per form, so a double submit of the same form is the same request but the two forms never collide.
  const idemPlan = `console-${randomUUID()}`;
  const idemRefund = `console-${randomUUID()}`;
  const plan = c.subscription?.plan ?? null;
  const allPlans = await getPlans();
  const interval = c.subscription?.interval ?? null;
  // The payment a refund would apply to, with its currency and line items. Paddle being down just hides the extras.
  const sub = c.subscription?.provider === "PADDLE" ? await prisma.subscription.findUnique({ where: { userId: id }, select: { providerCustomerId: true } }) : null;
  const target = sub?.providerCustomerId ? await describeRefundTarget({ customerId: sub.providerCustomerId }).catch(() => null) : null;
  const currency = target?.currency ?? "USD";
  return (
    <Panel title="Actions" description="Everything here is written to the audit log. Refunds and paid plan changes wait for your Approve.">
      <div className="flex flex-wrap gap-2">
        {plan === "TRIAL" && (
          <ConfirmButton action={extendTrialAction} fields={{ userId: id }} label="Extend trial" title="Extend trial" description="Adds days to the end of the trial.">
            <Field label="Days (1 to 90)"><Input name="days" type="number" min={1} max={90} defaultValue={7} required /></Field>
          </ConfirmButton>
        )}
        {c.suspendedAt ? (
          <ConfirmButton action={restoreAction} fields={{ userId: id }} label="Restore" title="Restore this user?" description="They can sign in and use BuPulse again." />
        ) : (
          <ConfirmButton action={suspendAction} fields={{ userId: id }} label="Suspend" title="Suspend this user?" description="They are signed out and blocked from every page and API call. Their data is kept.">
            <Field label="Reason (optional)"><Input name="reason" maxLength={300} /></Field>
          </ConfirmButton>
        )}
        <ConfirmButton action={changePlanAction} fields={{ userId: id, idem: idemPlan }} label="Change plan" title="Change plan" description="Moving to Standard or Pro creates an approval request. Trial is applied now.">
          <Field label="Plan"><Select name="plan" defaultValue={plan ?? "STANDARD"}>{allPlans.filter((p) => p.status !== "retired" || p.key === plan).map((p) => <option key={p.key} value={p.key}>{p.name}{p.status === "hidden" ? " (hidden)" : ""}</option>)}</Select></Field>
          <Field label="Billing"><Select name="interval" defaultValue={interval ?? "MONTH"}><option value="MONTH">Monthly</option><option value="YEAR">Yearly</option></Select></Field>
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
  );
}

async function OverviewTab({ id, c, here }: { id: string; c: C; here: string }) {
  const [o, user, flags] = await Promise.all([overviewSection(c), getUser(id), listFeatureFlags()]);
  const business = c.business ? await getBusiness(c.business.id) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Plan" value={o.subscription ? `${o.subscription.plan.toLowerCase()}` : "none"} source={o.subscription?.status.toLowerCase() ?? "no subscription"} />
        <Stat label="MRR from this client" value={money(o.mrrCents)} source="Plan price, if paying" href="/admin/revenue" />
        <Stat label="Signed up from" value={o.signupSource?.source ?? "unknown"} source={o.signupSource ? `first page ${o.signupSource.landingPage}` : "No tracked visit linked to the sign-up"} href="/admin/funnels" />
        <Stat label="Last active" value={o.lastActiveAt ? dateTime(o.lastActiveAt).replace(/ UTC$/, "") : "never"} source="Latest product event or AI call" />
      </div>
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
              {business.industryDescription && (<><dt className="text-muted">Describes itself</dt><dd className="text-[13px]">{business.industryDescription}</dd></>)}
              <dt className="text-muted">CEO</dt><dd>{business.ceoName ?? "n/a"}</dd>
              <dt className="text-muted">Phone</dt><dd>{business.phone ? <a href={`tel:${business.phone}`} className="underline">{formatPhone(business.phone)}</a> : "n/a"}</dd>
              <dt className="text-muted">Country</dt><dd>{business.country ?? "n/a"}</dd>
              <dt className="text-muted">Onboarded</dt><dd>{business.onboarded ? "Yes" : "No"}</dd>
              <dt className="text-muted">Projects, posts, leads</dt><dd>{business.counts.projects}, {business.counts.posts}, {business.counts.leads}</dd>
              <dt className="text-muted">Posts by status</dt><dd>{Object.entries(business.posts).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(", ") || "none"}</dd>
            </dl>
          )}
        </Panel>
      </div>

      <Panel title="Feature flags for this user" description="An override beats the flag’s rollout. “Default” removes the override.">
        {flags.length === 0 ? (
          <Empty>No flags exist yet. <Link href="/admin/flags" className="underline">Create one</Link>.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {flags.map((fl) => {
              const o2 = (fl.userOverrides as Record<string, boolean> | null)?.[id];
              return (
                <li key={fl.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span><code className="font-mono text-[13px]">{fl.key}</code> <span className="text-xs text-muted">flag {fl.enabled ? `on at ${fl.rolloutPercent}%` : "off"}</span></span>
                  <form action={flagOverrideAction} className="flex items-center gap-2">
                    <input type="hidden" name="key" value={fl.key} /><input type="hidden" name="userId" value={id} /><input type="hidden" name="back" value={here} />
                    <Select name="value" defaultValue={o2 === undefined ? "remove" : o2 ? "on" : "off"} aria-label={`Override for ${fl.key}`} className="min-h-11"><option value="remove">Default</option><option value="on">Forced on</option><option value="off">Forced off</option></Select>
                    <Button type="submit" size="sm" variant="outline">Save</Button>
                  </form>
                </li>
              );
            })}
          </ul>
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

async function BillingTab({ c }: { c: C }) {
  const b = await billingSection(c);
  return (
    <Panel title="Payments and refunds" description={b.provider ? `From ${b.provider.toLowerCase()} webhooks, newest first. Amounts are what the customer was charged or refunded, tax included.` : "This client has never paid."}>
      {b.items.length === 0 ? (
        <Empty>No payments or refunds recorded.</Empty>
      ) : (
        <TableWrap caption="Payments and refunds">
          <thead><tr><Th>When</Th><Th>Type</Th><Th>Provider id</Th><Th right>Amount</Th></tr></thead>
          <tbody>
            {b.items.map((i) => (
              <tr key={i.id}>
                <Td className="whitespace-nowrap">{dateTime(i.at)}</Td>
                <Td>{i.kind === "payment" ? <Badge tone="success">Payment</Badge> : <Badge tone="danger">Refund</Badge>}</Td>
                <Td className="font-mono text-xs">{i.providerId ?? ""}</Td>
                <Td right>{i.amountMinor === null ? "n/a" : money(i.kind === "refund" ? -i.amountMinor : i.amountMinor, /^[A-Z]{3}$/.test(i.currency) ? i.currency : "USD")}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Panel>
  );
}

async function UsageTab({ c }: { c: C }) {
  const u = await usageSection(c);
  return (
    <>
      <Panel title="Credits this period" description={u.periodStart ? `Period started ${dateTime(u.periodStart)}. Limits follow the client’s plan, including any override you set.` : "No usage recorded yet."}>
        <ul className="flex flex-col gap-4">
          {u.metrics.map((m) => (
            <li key={m.key} className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-3 text-[14px]"><span className="font-medium">{m.label}</span><span className="tabular-nums text-muted">{m.limit === 0 || m.limit === null ? `${num(m.used)} (not in plan)` : `${num(m.used)} / ${num(m.limit)}`}</span></div>
              {m.limit ? <Meter value={m.used} max={m.limit} label={m.label} /> : null}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="AI cost, 30 days" value={`$${u.ai.costUsd30d.toFixed(2)}`} source="AI call ledger" href="/admin/ai" />
        <Stat label="AI calls, 30 days" value={num(u.ai.calls30d)} source="AI call ledger" />
        <Stat label="Failed AI calls" value={num(u.ai.failures30d)} source="AI call ledger" />
      </div>
    </>
  );
}

async function ChannelsTab({ c }: { c: C }) {
  const ch = await channelsSection(c);
  return (
    <>
      <Panel title="Social channels" action={<Link href={`/admin/connections?tab=channels&q=${encodeURIComponent(c.email)}`} className="text-sm font-medium underline">Manage on Connections</Link>}>
        {ch.connections.length === 0 ? (
          <Empty>No channels connected.</Empty>
        ) : (
          <TableWrap caption="Channels">
            <thead><tr><Th>Account</Th><Th>Network</Th><Th>Status</Th><Th>Expires</Th></tr></thead>
            <tbody>
              {ch.connections.map((x) => (
                <tr key={x.id}>
                  <Td>{x.displayName ?? x.provider}{x.lastError && <span className="block max-w-[18rem] truncate text-xs text-danger" title={x.lastError}>{x.lastError}</span>}</Td>
                  <Td>{x.provider}</Td>
                  <Td><Badge tone={x.status === "ACTIVE" ? "success" : "neutral"}>{x.status.toLowerCase()}</Badge></Td>
                  <Td className="whitespace-nowrap">{x.expiresAt ? dateTime(x.expiresAt) : "n/a"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
      <Panel title="Connectors, webhooks and chat widget" action={<span className="flex gap-3 text-sm font-medium"><Link href={`/admin/connections?tab=connectors&q=${encodeURIComponent(c.email)}`} className="underline">Connectors</Link><Link href={`/admin/connections?tab=webhooks&q=${encodeURIComponent(c.email)}`} className="underline">Webhooks</Link><Link href={`/admin/connections?tab=widgets&q=${encodeURIComponent(c.email)}`} className="underline">Chat widget</Link></span>}>
        <ul className="grid gap-3 text-[14px] sm:grid-cols-2">
          <li>Stores: <strong>{ch.connectors?.stores ?? "n/a"}</strong></li>
          <li>Cloudflare: <strong>{ch.connectors?.cloudflare ?? "n/a"}</strong></li>
          <li>Imported files: <strong>{ch.connectors?.importedFiles ?? "n/a"}</strong></li>
          <li>Webhook endpoints: <strong>{ch.counts.webhooks}</strong></li>
          <li>API keys in use: <strong>{ch.counts.apiKeys}</strong></li>
          <li>Chat widget: <strong>{ch.widget ? (ch.widget.disabledByAdmin ? "switched off by you" : ch.widget.enabled ? "on" : "off") : "not set up"}</strong>{ch.widget?.lastSeenAt ? <span className="text-muted"> (seen {dateTime(ch.widget.lastSeenAt)}{ch.widget.lastSeenHost ? ` on ${ch.widget.lastSeenHost}` : ""})</span> : null}</li>
        </ul>
      </Panel>
    </>
  );
}

async function ContentTab({ c }: { c: C }) {
  const ct = await contentSection(c);
  return (
    <Panel title="Posts" description={Object.entries(ct.counts).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(" · ") || undefined}>
      {ct.posts.length === 0 ? (
        <Empty>No posts yet.</Empty>
      ) : (
        <TableWrap caption="Latest posts">
          <thead><tr><Th>Post</Th><Th>Network</Th><Th>Status</Th><Th>When</Th><Th right>Reach</Th><Th right>Likes</Th></tr></thead>
          <tbody>
            {ct.posts.map((p) => (
              <tr key={p.id}>
                <Td className="max-w-[22rem]"><span className="line-clamp-2">{p.text || "(no text)"}</span>{p.lastError && <span className="block text-xs text-danger">{p.lastError}</span>}</Td>
                <Td>{p.network}</Td><Td>{p.status.toLowerCase()}</Td>
                <Td className="whitespace-nowrap">{p.at ? dateTime(p.at) : ""}</Td>
                <Td right>{p.metrics?.reach ?? p.metrics?.views ?? "n/a"}</Td><Td right>{p.metrics?.likes ?? "n/a"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Panel>
  );
}

async function LeadsTab({ c }: { c: C }) {
  const l = await leadsSection(c);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Leads" value={num(l.total)} source={Object.entries(l.byStatus).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(", ") || "none yet"} />
        <Stat label="Website chats, 30 days" value={num(l.chat.sessions30d)} source="Chat sessions" />
      </div>
      <Panel title="Latest leads">
        {l.leads.length === 0 ? (
          <Empty>No leads yet.</Empty>
        ) : (
          <TableWrap caption="Latest leads">
            <thead><tr><Th>Lead</Th><Th>Source</Th><Th>Status</Th><Th>When</Th></tr></thead>
            <tbody>
              {l.leads.map((x) => (
                <tr key={x.id}><Td>{x.name ?? "Unnamed"}<span className="block text-xs text-muted">{x.email ?? ""}</span></Td><Td>{x.source}</Td><Td>{x.status.toLowerCase()}</Td><Td className="whitespace-nowrap">{dateTime(x.createdAt)}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}

async function ErrorsTab({ c }: { c: C }) {
  const e = await errorsSection(c);
  return (
    <Panel title="Errors for this client" action={<Link href={`/admin/errors?userId=${c.id}`} className="text-sm underline">Open the error log</Link>}>
      {e.length === 0 ? (
        <Empty>No errors for this client.</Empty>
      ) : (
        <ul className="flex flex-col gap-2 text-[14px]">
          {e.map((x) => (<li key={x.id}><span className="block break-words font-medium"><code className="font-mono text-[13px]">{x.source}</code> {x.message}</span><span className="text-xs text-muted">{dateTime(x.createdAt)} · {x.level}</span></li>))}
        </ul>
      )}
    </Panel>
  );
}

async function AuditTab({ c }: { c: C }) {
  const rows = await auditSection(c);
  return (
    <Panel title="Audit history" description="Admin and Jarvis actions on this client, newest first.">
      {rows.length === 0 ? (
        <Empty>Nothing has been done to this client yet.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((r) => {
            const d = diffJson(r.before, r.after);
            return (
              <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={r.actor === "admin" ? "blue" : "violet"}>{r.actor === "admin" ? "You" : "Jarvis"}</Badge>
                    <code className="font-mono text-[13px]">{r.action}</code>
                    <span className="text-xs text-muted">{dateTime(r.createdAt)}</span>
                  </summary>
                  {d.length === 0 ? <p className="mt-2 text-[13px] text-muted">No values recorded.</p> : (
                    <ul className="mt-2 flex flex-col gap-1 text-[13px]">{d.map((x) => (<li key={x.path} className="break-all"><span className="font-mono">{x.path}</span>: <span className="text-danger">{show(x.before)}</span> to <span className="text-success">{show(x.after)}</span></li>))}</ul>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

async function NotesTab({ id, c }: { id: string; c: C }) {
  const notes = await notesSection(c);
  return (
    <>
      <Panel title="Add a note" description="Private to the admin console. Notes are written to the audit log and erased with the account.">
        <form action={addNoteAction} className="flex flex-col gap-3">
          <input type="hidden" name="userId" value={id} />
          <Field label="Note"><Textarea name="body" rows={3} maxLength={2000} required /></Field>
          <Button type="submit" className="self-start">Save note</Button>
        </form>
      </Panel>
      <Panel title="Notes">
        {notes.length === 0 ? (
          <Empty>No notes about this client yet.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0"><p className="whitespace-pre-line break-words text-[14px]">{n.body}</p><p className="text-xs text-muted">{dateTime(n.createdAt)} · {n.createdBy === "admin" ? "You" : "Jarvis"}</p></div>
                <ConfirmButton action={deleteNoteAction} fields={{ userId: id, id: n.id }} label="Delete" title="Delete this note?" description="It is removed from this page; the audit log keeps a record of it." confirmLabel="Delete note" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
