import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, Building2, CalendarDays, ChartLine, Clock3, Coins, Plus, Smartphone, Sun, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/shell";
import { AreaCards, OverviewDashboard, OverviewToday, areaFigures, greeting, kigaliDayLabel, needsYouItems } from "@/components/admin/overview-dashboard";
import { TodayPayments, TodayTimeline } from "@/components/admin/overview-today";
import { BackLink, ChoiceTiles, DataList, EmptyState, ExpandCard, FilterChips, HubView, KitStyles, PageHeader, SectionCard, SectionGrid, StatGrid, StatTile, StatusPill, TodoList, chosen, type PillTone } from "@/components/admin/kit";
import { HowCalculated, Panel, Section, Stat, TableWrap, Td, Th, notice, RangeTabs, Empty } from "@/components/admin/ui";
import { buttonClasses } from "@/components/ui";
import { hubFiguresFrom } from "@/app/admin/(console)/hub/hub-content";
import { hubGroup, navFor } from "@/components/admin/nav";
import { INBOX_PERMISSION, type InboxKey } from "@/lib/admin/inbox";
import { previewAllowed } from "@/lib/support/preview";
import { CONTENT_SCREENS } from "../content-screens";
import { moneyFmt } from "@/components/admin/money";
import { BOOKS } from "@/lib/money/display";
import { BUSINESS_SCREENS } from "../business-screens";
import { MONEY_SCREENS } from "../money-screens";
import { PREVIEW_ATTENTION, PREVIEW_BADGES, PREVIEW_COMPANIES, PREVIEW_COUNTS, PREVIEW_OVERVIEW, PREVIEW_PAYMENTS, PREVIEW_TIMELINE, previewPermissions, type PreviewCompany } from "../preview-data";
import { SYSTEM_SCREENS, SystemPreview, isSystemScreen, systemPreviewPath } from "../system-screens";

const fx = moneyFmt({ ...BOOKS, currency: "RWF" });

export const metadata = { title: "Preview" };

const SCREENS = ["overview", "hub", "kit", ...SYSTEM_SCREENS] as const;
/** Round 2's section screens (Clients, Sales, Money), each with the console path it stands for. */
const MORE_SCREENS = { ...BUSINESS_SCREENS, ...MONEY_SCREENS };

/**
 * Development only: the redesigned admin shell, Overview, a group hub and the UI kit with made-up data, no sign-in and
 * no database, for checking the design in a browser. ?role=finance (or sales_agent, support, marketing, it...) shows
 * what that role sees; /admin/preview/hub?group=clients picks the hub. Not found in production.
 */
export default async function AdminPreviewPage({ params, searchParams }: PageProps<"/admin/preview/[[...screen]]">) {
  if (!previewAllowed()) notFound();
  const [{ screen }, sp] = await Promise.all([params, searchParams]);
  const contentScreen = Object.hasOwn(CONTENT_SCREENS, screen?.[0] ?? "") ? CONTENT_SCREENS[screen![0]] : null;
  if (contentScreen) { const w = previewPermissions(typeof sp.role === "string" ? sp.role : undefined); return <AdminShell email={w.email} roleName={w.roleName} permissions={w.permissions} badges={PREVIEW_BADGES} currency="RWF" pathname={contentScreen.path}><KitStyles />{contentScreen.render(sp)}</AdminShell>; }
  const which = (screen?.[0] ?? "overview") as (typeof SCREENS)[number];
  const more = Object.hasOwn(MORE_SCREENS, which) ? MORE_SCREENS[which as keyof typeof MORE_SCREENS] : null;
  if ((!SCREENS.includes(which) && !more) || (screen?.length ?? 0) > 1) notFound();
  const role = typeof sp.role === "string" ? sp.role : undefined;
  const who = previewPermissions(role);
  if (more) {
    return (
      <AdminShell email={who.email} roleName={who.roleName} permissions={who.permissions} badges={PREVIEW_BADGES} currency="RWF" pathname={more.path}>
        <KitStyles />
        {await more.render(sp)}
      </AdminShell>
    );
  }
  const can = (p: readonly string[] | string) => (typeof p === "string" ? [p] : p).some((x) => who.permissions.includes(x as never));
  const groupId = typeof sp.group === "string" ? sp.group : "money";
  const group = hubGroup(groupId) ?? hubGroup("money")!;
  const path = isSystemScreen(which) ? systemPreviewPath(which, sp) : which === "hub" ? group.hub!: which === "kit" ? "/admin/companies" : "/admin";

  return (
    <AdminShell email={who.email} roleName={who.roleName} permissions={who.permissions} badges={PREVIEW_BADGES} currency="RWF" pathname={path}>
      <KitStyles />
      {isSystemScreen(which) ? <SystemPreview which={which} sp={sp} /> : which === "overview" ?<OverviewPreview can={can} email={who.email} permissions={who.permissions} /> : which === "hub" ? <HubPreview groupId={group.id} permissions={who.permissions} /> : <KitPreview sp={sp} />}
    </AdminShell>
  );
}

function OverviewPreview({ can, email, permissions }: { can: (p: readonly string[] | string) => boolean; email: string; permissions: Parameters<typeof navFor>[0] }) {
  const d = PREVIEW_OVERVIEW;
  const counts: Partial<Record<InboxKey, number>> = {};
  for (const key of Object.keys(INBOX_PERMISSION) as InboxKey[]) if (can(INBOX_PERMISSION[key])) counts[key] = PREVIEW_COUNTS[key];
  const todos = needsYouItems({ counts, attention: PREVIEW_ATTENTION, paymentsWaiting: 2 });
  const now = new Date();
  const seeMoney = can("money.revenue");
  return (
    <>
      <PageHeader icon={Sun} tone="orange" eyebrow={kigaliDayLabel(now)} title={greeting(now, email)} description="Here is what needs you today. Everything else is one tap away in the cards below." />
      <Section title="Needs you" description="Anything waiting for you or looking wrong right now, worst first." action={<Link href="/admin/inbox" className="text-sm font-semibold text-pulse-blue">Open the inbox</Link>}>
        <TodoList items={todos} limit={6} columns={2} empty={{ title: "Nothing needs you right now.", hint: "No to-dos and no warnings. System health is all good." }} />
      </Section>
      <Section title="Today" description="Right now, at a glance. Tap a number for the page behind it.">
        <OverviewToday d={d} />
      </Section>
      <Section title="Go to" description="Every area of the console, one card each. The number is the one to watch.">
        <AreaCards groups={navFor(permissions).filter((g) => g.id !== "home")} figures={areaFigures({ counts, d, fx, see: { money: seeMoney, clients: can("clients.view"), ai: can("ai"), system: can("system") } })} />
      </Section>
      <OverviewDashboard d={d} fx={fx} today={false} show={{ money: seeMoney, clients: can("clients.view"), ai: can("ai") }} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <TodayPayments payments={PREVIEW_PAYMENTS} fx={fx} />
        <TodayTimeline items={PREVIEW_TIMELINE} />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel icon={ChartLine} tone="pink" title="Visits and sign-ups, 30 days" description="Daily counts from BuPulse's own tracker.">
          <Empty>No daily data yet. It appears after the first visits and the nightly roll-up.</Empty>
        </Panel>
        <Panel icon={Activity} tone="slate" title="Live activity" description="The latest things that happened. Updates every 5 seconds.">
          <Empty>The live feed is not part of the preview.</Empty>
        </Panel>
      </div>
    </>
  );
}

function HubPreview({ groupId, permissions }: { groupId: string; permissions: Parameters<typeof navFor>[0] }) {
  const mine = navFor(permissions).find((g) => g.id === groupId);
  if (!mine) return <EmptyState title="This role cannot open any page of this area." hint="The real hub answers 404 for them." />;
  return <HubView group={mine} figures={hubFiguresFrom(mine, PREVIEW_COUNTS, { total: 45, pastDue: 2, trial: 9 })} />;
}

const STATUS_TONE: Record<PreviewCompany["status"], PillTone> = { Active: "good", Trial: "info", "Past due": "bad" };

function KitPreview({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const status = chosen(sp, "status", ["active", "trial", "late"], "");
  const period = chosen(sp, "period", ["today", "week", "month"], "week");
  const rows = PREVIEW_COMPANIES.filter((c) => !status || (status === "active" && c.status === "Active") || (status === "trial" && c.status === "Trial") || (status === "late" && c.status === "Past due"));
  return (
    <>
      <PageHeader
        icon={Building2}
        tone="blue"
        title="UI kit"
        description="Every shared piece in the new look, with made-up data. Round 2 builds the section pages from these."
        back={{ href: "/admin/preview", label: "Back to the Overview preview" }}
        actions={
          <Link href="/admin/preview/kit" className={buttonClasses({ size: "md" })}>
            <Plus aria-hidden className="size-4" /> Add a company
          </Link>
        }
      />
      <p role="status" className={notice.ok}>Saved. The new trial length applies to sign-ups from now on.</p>
      <p role="alert" className={notice.bad}>That phone number is already used by another company.</p>
      <StatGrid cols={4}>
        <StatTile icon={Users} tone="blue" label="Paying clients" value="34" hint="Companies on a paid plan today." delta={{ now: 34, before: 30, against: "vs October" }} href="/admin/preview/kit" />
        <StatTile icon={Coins} tone="green" label="Revenue" value="RWF 2.7M" hint="Since the 1st of the month." spark={[3, 5, 4, 7, 9, 12]} />
        <StatTile icon={Smartphone} tone="green" label="Payments to confirm" value="2" alert hint="Mobile Money payments to check." />
        <StatTile icon={Clock3} tone="slate" label="Average reply" value="4 min" hint="How fast the team answers chats." delta={{ now: 4, before: 5, against: "vs last week", upIsGood: false }} />
      </StatGrid>
      <FilterChips label="Show companies" param="status" base="/admin/preview/kit" params={sp} current={status} options={[{ value: "", label: "All", count: 4 }, { value: "active", label: "Active", count: 2 }, { value: "trial", label: "On trial", count: 1 }, { value: "late", label: "Past due", count: 1 }]} />
      <DataList<PreviewCompany>
        caption="Companies"
        rows={rows}
        rowKey={(c) => c.id}
        rowHref={(c) => `/admin/companies/${c.id}`}
        columns={[
          { key: "name", header: "Company", cell: (c) => c.name, primary: true },
          { key: "plan", header: "Plan", cell: (c) => c.plan },
          { key: "status", header: "Status", cell: (c) => <StatusPill tone={STATUS_TONE[c.status]} dot>{c.status}</StatusPill> },
          { key: "mrr", header: "Pays a month", cell: (c) => c.mrr, align: "right" },
          { key: "seen", header: "Last seen", cell: (c) => c.lastSeen, hideOnPhone: true },
        ]}
        empty={<EmptyState title="No company matches." hint="Pick another filter above." />}
      />
      <ChoiceTiles label="Period" param="period" base="/admin/preview/kit" params={sp} current={period} options={[{ value: "today", label: "Today", hint: "Since midnight, Kigali time", icon: Sun, tone: "orange" }, { value: "week", label: "This week", hint: "Monday to now", icon: CalendarDays, tone: "blue" }, { value: "month", label: "This month", hint: "Since the 1st", icon: CalendarDays, tone: "violet" }]} />
      <SectionGrid>
        <SectionCard href="/admin/preview/hub" icon={Coins} tone="green" title="Revenue and profit" hint="Revenue from every client ever, MRR, ARPU, churn, costs and profit by month." value="RWF 2.7M" valueLabel="this month" />
        <SectionCard href="/admin/preview/hub" icon={Smartphone} tone="green" title="Payments" hint="Mobile Money payments to confirm, and the payment details clients see." count={2} countLabel="2 to check" value="2" valueLabel="payments to check" />
        <SectionCard href="/admin/preview/hub" icon={Users} tone="blue" title="Users" hint="Every person with an account, and their company." />
      </SectionGrid>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ExpandCard icon={Users} tone="blue" title="Clients" summary="34 paying · 9 on trial · 2 past due">
          <p className="text-[14px]">Details appear on hover (mouse), tap, or keyboard focus.</p>
        </ExpandCard>
        <ExpandCard icon={Clock3} tone="violet" title="Opening hours" summary="Mon–Sat 08:00–20:00" defaultOpen>
          <p className="text-[14px]">This one starts open.</p>
        </ExpandCard>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["good", "warn", "bad", "info", "new", "muted"] as PillTone[]).map((t) => (
          <StatusPill key={t} tone={t} dot>{t}</StatusPill>
        ))}
        <BackLink href="/admin/preview" label="Back to Overview" />
      </div>
      <Section title="The older pieces (ui.tsx)" description="Panel, Stat, TableWrap, HowCalculated and RangeTabs: every existing page uses these, now in the new look.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="MRR" value="RWF 2.9M" source="ARPU RWF 87,000" href="/admin/revenue" />
          <Stat label="Revenue" value="RWF 2.7M" previous={{ now: 186, before: 151, label: "October" }} spark={[1, 3, 2, 5, 6]} />
          <Stat label="Costs" value="$941" invert previous={{ now: 941, before: 700 }} source="Some estimated" />
          <Stat label="Profit" value="-$12" tone="danger" source="Revenue minus all costs" />
        </div>
        <Panel title="Payments" description="Mobile Money payments to confirm." action={<RangeTabs current="7d" base="/admin/preview/kit" />}>
          <TableWrap caption="Payments">
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Method</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {PREVIEW_PAYMENTS.map((p) => (
                <tr key={p.id}>
                  <Td>{p.company}</Td>
                  <Td>{p.method}</Td>
                  <Td right>{p.amount}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <HowCalculated>
            <p>Confirmed payments since midnight, Kigali time.</p>
          </HowCalculated>
        </Panel>
        <Empty>No refunds this month.</Empty>
      </Section>
    </>
  );
}
