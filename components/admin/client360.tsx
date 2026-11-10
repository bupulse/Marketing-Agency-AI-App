import { moneyFmt, type MoneyFmt } from "@/components/admin/money";
import { isCompanyAccount } from "@/lib/billing/company-account";
import { adminMoney } from "@/lib/money/display-server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle, BarChart3, Building2, CalendarClock, Coins, CreditCard, Flag, History, LayoutGrid, MessageSquare, NotebookPen, Plug, Send, ShieldCheck, Sparkles, UserRound, Users, Zap, type LucideIcon,
} from "lucide-react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { DataList, EmptyState, ExpandCard, FilterChips, SectionCard, SectionGrid, StatGrid, StatTile, StatusPill } from "@/components/admin/kit";
import { Fact } from "@/components/admin/business/shared";
import { Panel } from "@/components/admin/ui";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Meter } from "@/components/ui";
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
import { addNoteAction, changePlanAction, companyAccountAction, deleteNoteAction, extendTrialAction, flagOverrideAction, refundAction, restoreAction, suspendAction } from "@/app/admin/(console)/actions";


export const CLIENT_TAB_LABELS: Record<ClientTab, string> = { overview: "Overview", billing: "Billing", usage: "Usage", channels: "Channels", content: "Content", leads: "Leads and chat", errors: "Errors", audit: "Audit history", notes: "Notes" };

/** What each part of the client page holds, in a shop owner's words (the cards on Overview). */
const TAB_INFO: Record<string, { icon: LucideIcon; hint: string }> = {
  overview: { icon: LayoutGrid, hint: "The key facts and the actions." },
  billing: { icon: CreditCard, hint: "Every payment and refund, newest first." },
  usage: { icon: BarChart3, hint: "Credits used this period and what their AI cost." },
  channels: { icon: Plug, hint: "Social accounts, stores, webhooks and the website chat." },
  content: { icon: Send, hint: "Their latest posts, with reach and likes." },
  leads: { icon: MessageSquare, hint: "Leads they collected and website chats." },
  errors: { icon: AlertTriangle, hint: "Things that went wrong for this client." },
  audit: { icon: History, hint: "What you and Jarvis changed, with before and after." },
  notes: { icon: NotebookPen, hint: "Private notes about this client." },
  users: { icon: Users, hint: "The people in the company, their roles and sign-ins." },
};

export { CLIENT_TABS };

export type ExtraTab = { key: string; label: string };

/**
 * Client 360 for one user (the account owner): the parts as chips, the actions and the active part. Mounted by
 * /admin/users/[id] and by the company page. `extraTabs` are the host page's own parts; the host renders them when `tab`
 * matches one. `lead` is the host's own blocks for Overview and Billing (the company page's demo and custom-plan
 * cards), shown after the actions. The caller has already passed requireAdmin.
 */
export async function Client360({ userId, tab: asked, basePath, extraTabs = [], lead }: { userId: string; tab?: string; basePath: string; extraTabs?: ExtraTab[]; lead?: ReactNode }) {
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
  const tabs = clientTabs(extraTabs);
  return (
    <>
      <ClientSections here={here} current={extra ? (asked as string) : tab} tabs={tabs} />
      {!extra && tab === "overview" && <OverviewStats c={c} />}
      {showActions && (
        <div id="actions" className="scroll-mt-24">
          <Actions id={id} c={c} />
        </div>
      )}
      {!extra && (tab === "overview" || tab === "billing") && lead}
      {!extra && tab === "overview" && <OverviewTab id={id} c={c} here={here} tabs={tabs.filter((t) => t.key !== "overview")} />}
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

/** The client page's parts as chips (Overview, Billing, Usage...): each opens that part's own view. */
export function ClientSections({ here, current, tabs }: { here: string; current: string; tabs: ExtraTab[] }) {
  return <FilterChips label="Client sections" param="tab" base={here} allValue="overview" current={current} options={tabs.map((t) => ({ value: t.key, label: t.label, icon: TAB_INFO[t.key]?.icon }))} />;
}

/** Every part of the client page, Client 360's own then the host's extra ones. */
export const clientTabs = (extraTabs: ExtraTab[] = []): ExtraTab[] => [...CLIENT_TABS.map((t) => ({ key: t as string, label: CLIENT_TAB_LABELS[t] })), ...extraTabs];

export async function clientHeader(userId: string) {
  const c = await loadClient(userId);
  const status = c.suspendedAt ? "suspended" : c.deletionScheduledFor ? "deleting" : "active";
  return { email: c.email, name: c.name, business: c.business?.name ?? null, status, tone: (status === "active" ? "success" : status === "suspended" ? "danger" : "neutral") as "success" | "danger" | "neutral" };
}

/** The header's status pill, in words. */
export function ClientStatusPill({ status }: { status: string }) {
  return (
    <StatusPill tone={status === "active" ? "good" : status === "suspended" ? "bad" : "muted"} dot className="text-[13px]">
      {status === "active" ? "Active account" : status === "suspended" ? "Suspended" : "Being deleted"}
    </StatusPill>
  );
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
  return <ActionsView id={id} plan={plan} interval={interval} plans={allPlans} suspended={Boolean(c.suspendedAt)} companyAccount={isCompanyAccount(c.subscription)} hasProvider={Boolean(c.subscription?.provider)} target={target} currency={currency} idemPlan={idemPlan} idemRefund={idemRefund} />;
}

type RefundTarget = Awaited<ReturnType<typeof describeRefundTarget>>;

/** The Actions card from plain data (the dev preview renders it too). */
export function ActionsView({ id, plan, interval, plans: allPlans, suspended, companyAccount, hasProvider, target, currency, idemPlan, idemRefund }: { id: string; plan: string | null; interval: string | null; plans: { key: string; name: string; status: string }[]; suspended: boolean; companyAccount: boolean; hasProvider: boolean; target: RefundTarget | null; currency: string; idemPlan: string; idemRefund: string }) {
  return (
    <Panel icon={Zap} tone="blue" title="Actions" description="Everything here is written to the audit log. Refunds and paid plan changes wait for your Approve.">
      <div className="flex flex-wrap gap-2">
        {plan === "TRIAL" && (
          <ConfirmButton action={extendTrialAction} fields={{ userId: id }} label="Extend trial" title="Extend trial" description="Adds days to the end of the trial.">
            <Field label="Days (1 to 90)"><Input name="days" type="number" min={1} max={90} defaultValue={7} required /></Field>
          </ConfirmButton>
        )}
        {suspended ? (
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
        {companyAccount ? (
          <ConfirmButton action={companyAccountAction} fields={{ userId: id, on: "0" }} label="End company account" title="End this company account?" description="The account goes back to a fresh free trial. Nothing is charged or refunded." />
        ) : !hasProvider ? (
          <ConfirmButton action={companyAccountAction} fields={{ userId: id, on: "1" }} label="Make company account" title="Make this a company account?" description="For BuPulse's own accounts only: every feature on the Pro plan, free, with no end date. Nothing is charged, and it is not counted as revenue." />
        ) : null}
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

async function OverviewStats({ c }: { c: C }) {
  const fx = moneyFmt(await adminMoney());
  const o = await overviewSection(c);
  return <OverviewStatsView o={o} fx={fx} />;
}

export type OverviewFacts = Pick<Awaited<ReturnType<typeof overviewSection>>, "subscription" | "mrrCents" | "signupSource" | "lastActiveAt">;

/** The four key numbers at the top of Overview, from plain data. */
export function OverviewStatsView({ o, fx }: { o: OverviewFacts; fx: MoneyFmt }) {
  return (
    <StatGrid cols={4}>
      <StatTile icon={Sparkles} tone="blue" label="Plan" value={o.subscription ? <span className="capitalize">{o.subscription.plan.toLowerCase()}</span> : "None"} hint={o.subscription ? `Status: ${o.subscription.status.toLowerCase().replace(/_/g, " ")}.` : "No subscription yet."} />
      <StatTile icon={Coins} tone="green" label="Pays a month" value={fx.text(o.mrrCents)} title={fx.title(o.mrrCents)} hint="Their plan price, when they pay." href="/admin/revenue" />
      <StatTile icon={UserRound} tone="violet" label="Came from" value={<span className="break-all text-[20px] sm:text-[22px]">{o.signupSource?.source ?? "Unknown"}</span>} hint={o.signupSource ? `First page: ${o.signupSource.landingPage}` : "No tracked visit linked to the sign-up."} href="/admin/funnels" />
      <StatTile icon={CalendarClock} tone="slate" label="Last active" value={<span className="text-[20px] sm:text-[22px]">{o.lastActiveAt ? dateTime(o.lastActiveAt).replace(/ UTC$/, "") : "Never"}</span>} hint="Their latest action or AI call." />
    </StatGrid>
  );
}

async function OverviewTab({ id, c, here, tabs }: { id: string; c: C; here: string; tabs: ExtraTab[] }) {
  const [user, flags] = await Promise.all([getUser(id), listFeatureFlags()]);
  const business = c.business ? await getBusiness(c.business.id) : null;
  return <OverviewDetailsView id={id} user={user} business={business} flags={flags} here={here} tabs={tabs} />;
}

/** Overview's detail cards (account, business, flags, approvals) and the cards to the other parts, from plain data. */
export function OverviewDetailsView({ id, user, business, flags, here, tabs }: { id: string; user: Awaited<ReturnType<typeof getUser>>; business: Awaited<ReturnType<typeof getBusiness>> | null; flags: Awaited<ReturnType<typeof listFeatureFlags>>; here: string; tabs: ExtraTab[] }) {
  const overrides = flags.filter((fl) => (fl.userOverrides as Record<string, boolean> | null)?.[id] !== undefined).length;
  return (
    <>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard
          icon={UserRound}
          tone="blue"
          title="Account"
          summary={[`${user.plan ?? "No plan"}${user.subscriptionStatus ? `, ${user.subscriptionStatus.toLowerCase().replace(/_/g, " ")}` : ""}`, `joined ${dateTime(user.createdAt).replace(/, \d\d:\d\d.*/, "")}`].join(" · ")}
          aside={user.suspendedAt ? <StatusPill tone="bad">Suspended</StatusPill> : undefined}
          defaultOpen={Boolean(user.suspendedAt || user.deletionScheduledFor)}
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label="Plan">{user.plan ?? "None"} ({user.subscriptionStatus?.toLowerCase() ?? "no subscription"})</Fact>
            <Fact label="Billing">{user.provider ? `${user.provider.toLowerCase()}, ${user.interval?.toLowerCase() ?? "n/a"}` : "None"}</Fact>
            <Fact label="Trial ends">{user.trialEndsAt ? dateTime(user.trialEndsAt) : "n/a"}</Fact>
            <Fact label="Period ends">{user.currentPeriodEnd ? dateTime(user.currentPeriodEnd) : "n/a"}{user.cancelAtPeriodEnd ? " (cancels then)" : ""}</Fact>
            <Fact label="Joined">{dateTime(user.createdAt)}</Fact>
            <Fact label="Last sign-in">{user.lastSignInAt ? dateTime(user.lastSignInAt) : "unknown"}</Fact>
            {user.suspendedAt && <Fact label="Suspended" wide>{dateTime(user.suspendedAt)}{user.suspendedReason ? `: ${user.suspendedReason}` : ""}</Fact>}
            {user.deletionScheduledFor && <Fact label="Deletion">{dateTime(user.deletionScheduledFor)}</Fact>}
          </dl>
        </ExpandCard>
        <ExpandCard icon={Building2} tone="blue" title="Business" summary={business ? [business.industry ?? "No industry", business.country, business.onboarded ? "set up" : "not set up yet"].filter(Boolean).join(" · ") : "No business set up yet."}>
          {business ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label="Name">{business.name}</Fact>
              <Fact label="Industry">{business.industry ?? "n/a"}</Fact>
              {business.industryDescription && <Fact label="Describes itself" wide>{business.industryDescription}</Fact>}
              <Fact label="CEO">{business.ceoName ?? "n/a"}</Fact>
              <Fact label="Phone">{business.phone ? <a href={`tel:${business.phone}`} className="underline">{formatPhone(business.phone)}</a> : "n/a"}</Fact>
              <Fact label="Country">{business.country ?? "n/a"}</Fact>
              <Fact label="Onboarded">{business.onboarded ? "Yes" : "No"}</Fact>
              <Fact label="Products, posts, leads">{business.counts.projects}, {business.counts.posts}, {business.counts.leads}</Fact>
              <Fact label="Posts by status">{Object.entries(business.posts).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(", ") || "none"}</Fact>
            </dl>
          ) : (
            <p className="text-[14px] text-muted">This user has not set up a business yet.</p>
          )}
        </ExpandCard>
        <ExpandCard icon={Flag} tone="slate" title="Feature flags for this user" summary={flags.length === 0 ? "No flags exist yet." : `${flags.length} ${flags.length === 1 ? "flag" : "flags"}, ${overrides} set just for this user.`}>
          <p className="pb-3 text-[13px] text-muted">An override beats the flag’s rollout. “Default” removes the override.</p>
          {flags.length === 0 ? (
            <p className="text-[14px] text-muted">No flags exist yet. <Link href="/admin/flags" className="underline">Create one</Link>.</p>
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
        </ExpandCard>
        {user.recentApprovals.length > 0 && (
          <ExpandCard icon={ShieldCheck} tone="violet" title="Approval requests" summary={`${user.recentApprovals.length} recent · latest ${user.recentApprovals[0].status}`} defaultOpen={user.recentApprovals.some((a) => a.status === "PENDING")}>
            <ul className="flex flex-col gap-1 text-[14px]">{user.recentApprovals.map((a) => (<li key={a.id}>{a.kind.replace("_", " ")}: {a.status} ({dateTime(a.createdAt)})</li>))}</ul>
            <Link href="/admin/approvals" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">Open approvals</Link>
          </ExpandCard>
        )}
      </div>

      <section aria-label="More about this client" className="flex flex-col gap-3">
        <div className="px-1">
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">More about this client</h2>
          <p className="text-[13px] text-muted">Each part opens on its own page, so this one stays short.</p>
        </div>
        <SectionGrid cols={3}>
          {tabs.map((t) => (
            <SectionCard row key={t.key} href={`${here}?tab=${t.key}`} icon={TAB_INFO[t.key]?.icon ?? LayoutGrid} tone="blue" title={t.label} hint={TAB_INFO[t.key]?.hint} />
          ))}
        </SectionGrid>
      </section>
    </>
  );
}

async function BillingTab({ c }: { c: C }) {
  const fx = moneyFmt(await adminMoney());
  const b = await billingSection(c);
  return (
    <Panel icon={CreditCard} tone="green" title="Payments and refunds" description={b.provider ? `From ${b.provider.toLowerCase()} webhooks, newest first. Amounts are what the customer was charged or refunded, tax included.` : "This client has never paid."}>
      <DataList
        caption="Payments and refunds"
        rows={b.items}
        rowKey={(i) => i.id}
        columns={[
          { key: "at", header: "When", cell: (i) => <span className="whitespace-nowrap">{dateTime(i.at)}</span>, primary: true },
          { key: "kind", header: "Type", cell: (i) => (i.kind === "payment" ? <StatusPill tone="good" dot>Payment</StatusPill> : <StatusPill tone="bad" dot>Refund</StatusPill>) },
          { key: "id", header: "Provider id", cell: (i) => <span className="break-all font-mono text-xs">{i.providerId ?? ""}</span>, hideOnPhone: true },
          { key: "amount", header: "Amount", align: "right", cell: (i) => (i.amountMinor === null ? "n/a" : fx.text(i.kind === "refund" ? -i.amountMinor : i.amountMinor, /^[A-Z]{3}$/.test(i.currency) ? i.currency : "USD")) },
        ]}
        empty={<EmptyState icon={CreditCard} title="No payments or refunds recorded." />}
      />
    </Panel>
  );
}

async function UsageTab({ c }: { c: C }) {
  const fx = moneyFmt(await adminMoney());
  const u = await usageSection(c);
  return (
    <>
      <Panel icon={BarChart3} tone="blue" title="Credits this period" description={u.periodStart ? `Period started ${dateTime(u.periodStart)}. Limits follow the client’s plan, including any override you set.` : "No usage recorded yet."}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {u.metrics.map((m) => (
            <li key={m.key} className="flex flex-col gap-1.5 rounded-2xl bg-soft/60 p-3.5">
              <div className="flex justify-between gap-3 text-[14px]"><span className="font-medium">{m.label}</span><span className="tabular-nums text-muted">{m.limit === 0 || m.limit === null ? `${num(m.used)} (not in plan)` : `${num(m.used)} / ${num(m.limit)}`}</span></div>
              {m.limit ? <Meter value={m.used} max={m.limit} label={m.label} /> : null}
            </li>
          ))}
        </ul>
      </Panel>
      <StatGrid cols={3}>
        <StatTile icon={Coins} tone="violet" label="AI cost, 30 days" value={fx.text(u.ai.costUsd30d * 100)} title={fx.title(u.ai.costUsd30d * 100)} hint="From the AI call ledger." href="/admin/ai" />
        <StatTile icon={Sparkles} tone="violet" label="AI calls, 30 days" value={num(u.ai.calls30d)} hint="Every AI request they made." />
        <StatTile icon={AlertTriangle} tone="violet" label="Failed AI calls" value={num(u.ai.failures30d)} hint="In the last 30 days." alert={u.ai.failures30d > 0} />
        <StatTile icon={Coins} tone="violet" label="AI spend this month" value={<span className="text-[20px] sm:text-[22px]">{`${fx.text(u.ai.monthUsd * 100)} of ${fx.text(u.ai.allowanceUsd * 100)}`}</span>} hint="Against the company allowance (the plan's AI allowance, else AI_COMPANY_MONTHLY_USD)." />
        <StatTile icon={MessageSquare} tone="teal" label="Website chat AI, this month" value={<span className="text-[20px] sm:text-[22px]">{`${fx.text(u.ai.widgetUsd * 100)} of ${fx.text(u.ai.widgetCapUsd * 100)}`}</span>} hint="Chat share (WIDGET_AI_SHARE); when used up, the chat collects details." />
        <StatTile icon={Zap} tone="blue" label="Owner features AI, this month" value={fx.text(u.ai.ownerUsd * 100)} hint="Studio, Autopilot, designs and the rest." />
      </StatGrid>
    </>
  );
}

async function ChannelsTab({ c }: { c: C }) {
  const ch = await channelsSection(c);
  const q = encodeURIComponent(c.email);
  const facts: [string, ReactNode][] = [
    ["Stores", ch.connectors?.stores ?? "n/a"],
    ["Cloudflare", ch.connectors?.cloudflare ?? "n/a"],
    ["Imported files", ch.connectors?.importedFiles ?? "n/a"],
    ["Webhook endpoints", ch.counts.webhooks],
    ["API keys in use", ch.counts.apiKeys],
  ];
  return (
    <>
      <Panel icon={Plug} tone="blue" title="Social channels" description="The accounts this client posts to, and whether each one still works." action={<Link href={`/admin/connections?tab=channels&q=${q}`} className="text-sm font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">Manage on Connections</Link>}>
        <DataList
          caption="Channels"
          rows={ch.connections}
          rowKey={(x) => x.id}
          columns={[
            { key: "acc", header: "Account", primary: true, cell: (x) => <>{x.displayName ?? x.provider}{x.lastError && <span className="block max-w-[18rem] truncate text-xs font-normal text-danger" title={x.lastError}>{x.lastError}</span>}</> },
            { key: "net", header: "Network", cell: (x) => x.provider },
            { key: "status", header: "Status", cell: (x) => <StatusPill tone={x.status === "ACTIVE" ? "good" : "muted"} dot>{x.status.toLowerCase()}</StatusPill> },
            { key: "exp", header: "Expires", cell: (x) => <span className="whitespace-nowrap">{x.expiresAt ? dateTime(x.expiresAt) : "n/a"}</span> },
          ]}
          empty={<EmptyState icon={Plug} title="No channels connected." />}
        />
      </Panel>
      <Panel
        icon={LayoutGrid}
        tone="blue"
        title="Connectors, webhooks and chat widget"
        description="Stores, files, developer tools and the chat on their website."
        action={
          <span className="flex flex-wrap gap-3 text-sm font-semibold text-pulse-blue dark:text-[#8db0ff]">
            <Link href={`/admin/connections?tab=connectors&q=${q}`} className="underline-offset-2 hover:underline">Connectors</Link>
            <Link href={`/admin/connections?tab=webhooks&q=${q}`} className="underline-offset-2 hover:underline">Webhooks</Link>
            <Link href={`/admin/connections?tab=widgets&q=${q}`} className="underline-offset-2 hover:underline">Chat widget</Link>
          </span>
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 rounded-2xl bg-soft/60 p-3.5">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="text-[18px] font-bold tabular-nums">{v}</dd>
            </div>
          ))}
          <div className="col-span-2 flex flex-col gap-0.5 rounded-2xl bg-soft/60 p-3.5 sm:col-span-3">
            <dt className="text-[12px] text-muted">Chat widget</dt>
            <dd className="text-[15px] font-semibold">
              {ch.widget ? (ch.widget.disabledByAdmin ? "Switched off by you" : ch.widget.enabled ? "On" : "Off") : "Not set up"}
              {ch.widget?.lastSeenAt ? <span className="font-normal text-muted"> (seen {dateTime(ch.widget.lastSeenAt)}{ch.widget.lastSeenHost ? ` on ${ch.widget.lastSeenHost}` : ""})</span> : null}
            </dd>
          </div>
        </dl>
      </Panel>
    </>
  );
}

async function ContentTab({ c }: { c: C }) {
  const ct = await contentSection(c);
  return (
    <Panel icon={Send} tone="pink" title="Posts" description={Object.entries(ct.counts).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(" · ") || "Their latest posts."}>
      <DataList
        caption="Latest posts"
        rows={ct.posts}
        rowKey={(p) => p.id}
        columns={[
          { key: "post", header: "Post", primary: true, className: "max-w-[22rem]", cell: (p) => <><span className="line-clamp-2 font-normal">{p.text || "(no text)"}</span>{p.lastError && <span className="block text-xs font-normal text-danger">{p.lastError}</span>}</> },
          { key: "net", header: "Network", cell: (p) => p.network },
          { key: "status", header: "Status", cell: (p) => p.status.toLowerCase() },
          { key: "when", header: "When", cell: (p) => <span className="whitespace-nowrap">{p.at ? dateTime(p.at) : ""}</span>, hideOnPhone: true },
          { key: "reach", header: "Reach", align: "right", cell: (p) => p.metrics?.reach ?? p.metrics?.views ?? "n/a" },
          { key: "likes", header: "Likes", align: "right", cell: (p) => p.metrics?.likes ?? "n/a" },
        ]}
        empty={<EmptyState icon={Send} title="No posts yet." />}
      />
    </Panel>
  );
}

async function LeadsTab({ c }: { c: C }) {
  const l = await leadsSection(c);
  return (
    <>
      <StatGrid cols={2}>
        <StatTile icon={Users} tone="teal" label="Leads" value={num(l.total)} hint={Object.entries(l.byStatus).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(", ") || "None yet."} />
        <StatTile icon={MessageSquare} tone="teal" label="Website chats, 30 days" value={num(l.chat.sessions30d)} hint="Visitor conversations on their website." />
      </StatGrid>
      <Panel icon={Users} tone="teal" title="Latest leads" description="People who left their details, newest first.">
        <DataList
          caption="Latest leads"
          rows={l.leads}
          rowKey={(x) => x.id}
          columns={[
            { key: "lead", header: "Lead", primary: true, cell: (x) => <>{x.name ?? "Unnamed"}<span className="block text-xs font-normal text-muted">{x.email ?? ""}</span></> },
            { key: "src", header: "Source", cell: (x) => x.source },
            { key: "status", header: "Status", cell: (x) => x.status.toLowerCase() },
            { key: "when", header: "When", cell: (x) => <span className="whitespace-nowrap">{dateTime(x.createdAt)}</span> },
          ]}
          empty={<EmptyState icon={Users} title="No leads yet." />}
        />
      </Panel>
    </>
  );
}

async function ErrorsTab({ c }: { c: C }) {
  const e = await errorsSection(c);
  return (
    <Panel icon={AlertTriangle} tone="red" title="Errors for this client" description="The latest problems logged for this account." action={<Link href={`/admin/errors?userId=${c.id}`} className="text-sm font-semibold text-pulse-blue underline-offset-2 hover:underline dark:text-[#8db0ff]">Open the error log</Link>}>
      {e.length === 0 ? (
        <EmptyState icon={ShieldCheck} tone="good" title="No errors for this client." />
      ) : (
        <ul className="flex flex-col divide-y divide-line text-[14px]">
          {e.map((x) => (<li key={x.id} className="py-2.5 first:pt-0 last:pb-0"><span className="block break-words font-medium"><code className="font-mono text-[13px]">{x.source}</code> {x.message}</span><span className="text-xs text-muted">{dateTime(x.createdAt)} · {x.level}</span></li>))}
        </ul>
      )}
    </Panel>
  );
}

async function AuditTab({ c }: { c: C }) {
  const rows = await auditSection(c);
  return (
    <Panel icon={History} tone="slate" title="Audit history" description="Admin and Jarvis actions on this client, newest first. Tap one to see what changed.">
      {rows.length === 0 ? (
        <EmptyState icon={History} title="Nothing has been done to this client yet." />
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
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Panel icon={NotebookPen} tone="blue" title="Add a note" description="Private to the admin console. Notes are written to the audit log and erased with the account.">
        <form action={addNoteAction} className="flex flex-col gap-3">
          <input type="hidden" name="userId" value={id} />
          <Field label="Note"><Textarea name="body" rows={3} maxLength={2000} required /></Field>
          <Button type="submit" className="self-start">Save note</Button>
        </form>
      </Panel>
      <Panel icon={NotebookPen} tone="slate" title="Notes" description="Newest first.">
        {notes.length === 0 ? (
          <EmptyState icon={NotebookPen} title="No notes about this client yet." />
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
    </div>
  );
}
