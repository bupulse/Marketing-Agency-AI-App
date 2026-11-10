// Dev-only preview screens for the Clients and Sales areas (app/admin/preview), with made-up data (placeholder names,
// numbers and phone numbers). The router renders them inside the console shell; not found in production.
import type { ReactNode } from "react";
import { Building2 } from "lucide-react";
import { PageHeader, StatusPill, type SearchParamsLike } from "@/components/admin/kit";
import { CompaniesView, type CompanyItem } from "@/components/admin/business/companies-view";
import { ConnectionsHub } from "@/components/admin/business/connections-hub";
import { DemosView, type DemoRow } from "@/components/admin/business/demos-view";
import { RequestsView, type PlanRequestRow } from "@/components/admin/business/requests-view";
import { QuotesView, type QuoteRow } from "@/components/admin/business/quotes-view";
import { PartnersView } from "@/components/admin/business/partners-view";
import { ActionsView, ClientSections, OverviewDetailsView, OverviewStatsView, clientTabs } from "@/components/admin/client360";
import { DemoPanelView } from "@/components/admin/demo-panel";
import { ClientHealthView } from "@/components/admin/clients/health-view";
import { UsageView } from "@/components/admin/clients/usage-view";
import { LeaderboardView, MyClientsView, TeamView } from "@/components/admin/sales/sales-views";
import { moneyFmt } from "@/components/admin/money";
import { BOOKS } from "@/lib/money/display";
import type { ClientRow } from "@/lib/admin/client-health";
import type { SalesClient } from "@/lib/sales/clients";
import type { LeaderRow } from "@/lib/sales/attribution";
import type { PartnerRow } from "@/lib/partners/service";
import { demoStatusAction, retryDemoCalendarAction } from "@/app/admin/(console)/(clients)/demos/actions";
import { setRequestStatusAction } from "@/app/admin/(console)/(clients)/requests/actions";
import { setQuoteHandledAction } from "@/app/admin/(console)/(sales)/quotes/actions";
import { reassignClientAction } from "@/app/admin/(console)/(sales)/sales/team/actions";
import { approvePartnerAction, pausePartnerAction, recordPayoutAction, rejectPartnerAction } from "@/app/admin/(console)/(sales)/sales/partners/actions";

export type PreviewScreen = { path: string; render: (sp: SearchParamsLike) => ReactNode | Promise<ReactNode> };

const fx = moneyFmt({ ...BOOKS, currency: "RWF" });
const NOW = Date.parse("2026-11-10T09:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const pick = (sp: SearchParamsLike, k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) ?? "";

const COMPANIES: CompanyItem[] = [
  { id: "c1", name: "Kigali Bakery", ownerEmail: "aline@kigalibakery.example", plan: "STARTER", status: "ACTIVE", suspended: false, seatsUsed: 3, lastActiveAt: ago(0) },
  { id: "c2", name: "Nyamirambo Salon", ownerEmail: "eric@salon.example", plan: "TRIAL", status: "TRIALING", suspended: false, seatsUsed: 1, lastActiveAt: ago(1) },
  { id: "c3", name: "Musanze Tools and Hardware Supplies", ownerEmail: "jean@musanzetools.example", plan: "STANDARD", status: "PAST_DUE", suspended: false, seatsUsed: 2, lastActiveAt: ago(9) },
  { id: "c4", name: "Huye Coffee Roasters", ownerEmail: "grace@huyecoffee.example", plan: "STARTER", status: "PENDING_DEMO", suspended: false, seatsUsed: 1, lastActiveAt: null },
  { id: "c5", name: "Rubavu Beach Hotel", ownerEmail: "claude@rubavu.example", plan: "PRO", status: "ACTIVE", suspended: false, seatsUsed: 5, lastActiveAt: ago(2) },
  { id: "c6", name: "Gisenyi Phones", ownerEmail: null, plan: null, status: null, suspended: true, seatsUsed: 0, lastActiveAt: ago(40) },
];
const PLANS = [
  { key: "TRIAL", name: "Trial" },
  { key: "STARTER", name: "Starter" },
  { key: "STANDARD", name: "Standard" },
  { key: "PRO", name: "Pro" },
];

const usage = (t: number, i: number) => ({ text: t, image: i, videos: 30, videoCredits: 2, voiceCharacters: 4000, chat: 120 });
const CLIENT_ROWS: ClientRow[] = [
  { businessId: "c3", userId: "u3", name: "Musanze Tools", email: "jean@musanzetools.example", phone: "+250780000003", plan: "STANDARD", status: "PAST_DUE", trialEndsAt: null, periodStart: ago(20), lastActiveAt: ago(9), used: usage(12, 2), limits: usage(300, 60), usageShare: 0.04, aiCostMonthCents: 140, mrrCents: 3500, flags: ["past_due", "inactive"], risk: "high", score: 5 },
  { businessId: "c2", userId: "u2", name: "Nyamirambo Salon", email: "eric@salon.example", phone: "+250780000002", plan: "TRIAL", status: "TRIALING", trialEndsAt: ahead(2), periodStart: ago(5), lastActiveAt: ago(1), used: usage(40, 9), limits: usage(100, 20), usageShare: 0.45, aiCostMonthCents: 380, mrrCents: 0, flags: ["trial_ending"], risk: "medium", score: 2 },
  { businessId: "c4", userId: "u4", name: "Huye Coffee Roasters", email: "grace@huyecoffee.example", phone: null, plan: "STARTER", status: "PENDING_DEMO", trialEndsAt: null, periodStart: null, lastActiveAt: null, used: usage(0, 0), limits: usage(0, 0), usageShare: null, aiCostMonthCents: 0, mrrCents: 0, flags: ["waiting_demo"], risk: "medium", score: 1 },
  { businessId: "c1", userId: "u1", name: "Kigali Bakery", email: "aline@kigalibakery.example", phone: "+250780000001", plan: "STARTER", status: "ACTIVE", trialEndsAt: null, periodStart: ago(12), lastActiveAt: ago(0), used: usage(180, 31), limits: usage(300, 60), usageShare: 0.6, aiCostMonthCents: 520, mrrCents: 2900, flags: [], risk: "ok", score: 0 },
  { businessId: "c5", userId: "u5", name: "Rubavu Beach Hotel", email: "claude@rubavu.example", phone: "+250780000005", plan: "PRO", status: "ACTIVE", trialEndsAt: null, periodStart: ago(3), lastActiveAt: ago(2), used: usage(20, 4), limits: usage(1000, 200), usageShare: 0.02, aiCostMonthCents: 9900, mrrCents: 7900, flags: ["low_usage"], risk: "medium", score: 1 },
];

const DEMOS: DemoRow[] = [
  { id: "d1", businessId: "c4", userId: "u4", kind: "demo", requestId: null, planKey: "STARTER", status: "booked", notes: null, meetingLink: "https://meet.example/abc", googleSyncPending: false, googleSyncError: null, businessName: "Huye Coffee Roasters", country: "Rwanda", region: "RW", contactName: "Grace", email: "grace@huyecoffee.example", when: "Tue 11 Nov, 10:00", subscriptionStatus: "PENDING_DEMO" },
  { id: "d2", businessId: "c5", userId: "u5", kind: "custom_plan", requestId: "r1", planKey: "PRO", status: "booked", notes: "Wants three branches on one plan", meetingLink: "https://meet.example/def", googleSyncPending: true, googleSyncError: "Token expired", businessName: "Rubavu Beach Hotel", country: "Rwanda", region: "RW", contactName: "Claude", email: "claude@rubavu.example", when: "Wed 12 Nov, 14:30", subscriptionStatus: "ACTIVE" },
  { id: "d3", businessId: "c2", userId: "u2", kind: "demo", requestId: null, planKey: "STARTER", status: "done", notes: "Liked the calendar; starts the trial", meetingLink: null, googleSyncPending: false, googleSyncError: null, businessName: "Nyamirambo Salon", country: "Rwanda", region: "RW", contactName: "Eric", email: "eric@salon.example", when: "Thu 6 Nov, 09:00", subscriptionStatus: "TRIALING" },
];

const REQUESTS = [
  { id: "r1", businessId: "c5", companyName: "Rubavu Beach Hotel", name: "Claude", email: "claude@rubavu.example", phone: "+250780000005", createdAt: new Date(ago(2)), source: "billing", demoBookingId: "d2", status: "new", description: "A beach hotel with three branches. We post menus, events and room offers every day.", goals: "More direct bookings from Instagram.", features: ["websiteChat", "autopilot"], budgetLabel: "100,000 to 200,000 RWF a month", call: { status: "booked", when: "Wed 12 Nov, 14:30", meetingLink: "https://meet.example/def" } },
  { id: "r2", businessId: null, companyName: "Kimironko Market Stall", name: "Diane", email: "diane@market.example", phone: null, createdAt: new Date(ago(6)), source: "pricing", demoBookingId: null, status: "contacted", description: "Fruit and vegetables, we sell on WhatsApp.", goals: null, features: [], budgetLabel: null, call: null },
] as unknown as PlanRequestRow[];

const QUOTES = [
  { id: "q1", name: "Patrick", businessName: "Remera Auto Parts", phone: "+250780000011", email: "patrick@autoparts.example", note: "Need posts for our new branch opening next week.", source: "instagram", createdAt: new Date(ago(0)), handled: false, leadOf: "BuPulse (no agent)", link: "Instagram bio", pageUrl: "https://bupulse.com/quote?src=instagram" },
  { id: "q2", name: "Solange", businessName: null, phone: "+250780000012", email: "solange@example.com", note: null, source: null, createdAt: new Date(ago(1)), handled: false, leadOf: "Agent Sam", link: null, pageUrl: "https://bupulse.com/pricing" },
] as unknown as QuoteRow[];

const SALES_CLIENTS: SalesClient[] = [
  { businessId: "c1", userId: "u1", name: "Kigali Bakery", contactName: "Aline", phone: "+250780000001", email: "aline@kigalibakery.example", plan: "STARTER", status: "ACTIVE", trialEndsAt: null, lastSignInAt: ago(0), posts: 42, lastPayment: { at: ago(8), usdCents: 2000, localMinor: 29000, currency: "RWF" }, agentId: "s1" },
  { businessId: "c2", userId: "u2", name: "Nyamirambo Salon", contactName: "Eric", phone: "+250780000002", email: "eric@salon.example", plan: "TRIAL", status: "TRIALING", trialEndsAt: ahead(2), lastSignInAt: ago(1), posts: 6, lastPayment: null, agentId: "s1" },
  { businessId: "c3", userId: "u3", name: "Musanze Tools", contactName: null, phone: null, email: "jean@musanzetools.example", plan: "STANDARD", status: "PAST_DUE", trialEndsAt: null, lastSignInAt: ago(9), posts: 11, lastPayment: { at: ago(40), usdCents: 3500, localMinor: null, currency: "USD" }, agentId: null },
];
const BOARD: LeaderRow[] = [
  { staffId: "s2", name: "Bea", ownCents: 12000, teamShareCents: 800, totalCents: 12800, clients: 6 },
  { staffId: "s1", name: "Sam", ownCents: 4900, teamShareCents: 800, totalCents: 5700, clients: 2 },
  { staffId: "s3", name: "Olivier", ownCents: 2000, teamShareCents: 800, totalCents: 2800, clients: 1 },
  { staffId: "s4", name: "Ange", ownCents: 0, teamShareCents: 800, totalCents: 800, clients: 0 },
];
const MEMBERS = [
  { staffId: "s1", name: "Sam", email: "sam@example.com", roleName: "Sales agent", status: "active", refCode: "K7Q2" },
  { staffId: "s2", name: "Bea", email: "bea@example.com", roleName: "Sales manager", status: "active", refCode: "B3XA" },
  { staffId: "s3", name: "Olivier", email: "olivier@example.com", roleName: "Sales agent", status: "active", refCode: null },
];

const summary = (paying: number, earned: number, hold: number, paid: number) => ({ lines: [], referrals: [], payingClients: paying, currentPct: paying >= 5 ? 15 : 10, nextTier: null, earnedRwf: earned, onHoldRwf: hold, availableRwf: earned - hold, paidRwf: paid, owedRwf: earned - hold - paid });
const PARTNERS = [
  { id: "p1", status: "applied", kind: "agency", name: "Jean Bosco", organisation: "Kigali Web Studio", email: "bosco@webstudio.example", phone: "+250780000021", city: "Kigali", message: "We build websites for 30 small shops and can offer BuPulse to each of them.", refCode: null, link: null, page: null, rejectReason: null, createdAt: new Date(ago(1)), summary: null, companies: [], payouts: [] },
  { id: "p2", status: "approved", kind: "momo_agent", name: "Clarisse", organisation: null, email: "clarisse@example.com", phone: "+250780000022", city: "Huye", message: null, refCode: "CLR5", link: "https://bupulse.com/?ref=CLR5", page: "https://bupulse.com/p/CLR5", rejectReason: null, createdAt: new Date(ago(60)), summary: summary(3, 42000, 6000, 20000), companies: [{ businessId: "c1", name: "Kigali Bakery", plan: "STARTER", signedUpAt: new Date(ago(50)), firstPaidAt: new Date(ago(45)), qualified: true, earnUntil: null, earnedRwf: 26000 }, { businessId: "c2", name: "Nyamirambo Salon", plan: null, signedUpAt: new Date(ago(5)), firstPaidAt: null, qualified: false, earnUntil: null, earnedRwf: 0 }], payouts: [{ id: "po1", amountRwf: 20000, reference: "MP2610.1234", note: null, paidAt: new Date(ago(20)) }] },
  { id: "p3", status: "paused", kind: "coworking", name: "Yves", organisation: "Norrsken Desk", email: "yves@desk.example", phone: "+250780000023", city: "Kigali", message: null, refCode: "NRS1", link: "https://bupulse.com/?ref=NRS1", page: "https://bupulse.com/p/NRS1", rejectReason: null, createdAt: new Date(ago(90)), summary: summary(0, 0, 0, 0), companies: [], payouts: [] },
  { id: "p4", status: "rejected", kind: "agency", name: "Test", organisation: null, email: "test@example.com", phone: "+250780000024", city: null, message: null, refCode: null, link: null, page: null, rejectReason: "Not a real business", createdAt: new Date(ago(30)), summary: null, companies: [], payouts: [] },
] as unknown as PartnerRow[];

function CompanyPreview({ sp }: { sp: SearchParamsLike }) {
  const here = "/admin/preview/company";
  const tab = pick(sp, "tab") || "overview";
  const tabs = clientTabs([{ key: "users", label: "Users" }]);
  const user = { plan: "STARTER", subscriptionStatus: "ACTIVE", provider: "MANUAL", interval: "MONTH", trialEndsAt: null, currentPeriodEnd: ahead(20), cancelAtPeriodEnd: false, createdAt: ago(48), lastSignInAt: ago(0), suspendedAt: null, suspendedReason: null, deletionScheduledFor: null, recentApprovals: [{ id: "a1", kind: "plan_change", status: "APPROVED", createdAt: ago(20) }] };
  const business = { name: "Kigali Bakery", industry: "Bakery and café", industryDescription: "Fresh bread, cakes and coffee in Kimihurura.", ceoName: "Aline", phone: "+250780000001", country: "Rwanda", onboarded: true, counts: { projects: 14, posts: 42, leads: 9 }, posts: { PUBLISHED: 36, SCHEDULED: 4, FAILED: 2 } };
  const flags = [{ key: "video-studio", enabled: true, rolloutPercent: 20, userOverrides: { u1: true } }, { key: "new-calendar", enabled: false, rolloutPercent: 0, userOverrides: null }];
  return (
    <>
      <PageHeader icon={Building2} tone="blue" title="Kigali Bakery" description="aline@kigalibakery.example · STARTER · 3 users" back={{ href: "/admin/preview/companies", label: "Companies" }} actions={<StatusPill tone="good" dot className="text-[13px]">Active account</StatusPill>} />
      <ClientSections here={here} current={tab} tabs={tabs} />
      <OverviewStatsView fx={fx} o={{ subscription: { plan: "STARTER", status: "ACTIVE" } as never, mrrCents: 2000, signupSource: { source: "instagram", landingPage: "/pricing", campaign: null, country: "RW" }, lastActiveAt: ago(0) }} />
      <ActionsView id="u1" plan="STARTER" interval="MONTH" plans={[{ key: "TRIAL", name: "Trial", status: "public" }, { key: "STARTER", name: "Starter", status: "public" }, { key: "PRO", name: "Pro", status: "public" }]} suspended={false} companyAccount={false} hasProvider target={null} currency="RWF" idemPlan="preview-1" idemRefund="preview-2" />
      <DemoPanelView
        businessId="c1"
        back={here}
        p={{ region: "RW", regionMismatch: null, chosenPlanName: "Starter", trialDays: 14, booking: { id: "d0", status: "done", startsAt: new Date(ago(50)), when: "Mon 22 Sep, 10:00", meetingLink: null, notes: "Bakery, 3 staff, posts daily on Instagram" }, subscription: null } as never}
        regions={[{ key: "RW", name: "Rwanda", currency: "RWF", active: true }, { key: "GLOBAL", name: "Global", currency: "USD", active: true }] as never}
        sub={{ status: "ACTIVE", trialEndsAt: null }}
        summary={{ text: "Active, Starter, Mobile Money, paid until 30 Nov", links: ["change_plan"] }}
      />
      <OverviewDetailsView id="u1" user={user as never} business={business as never} flags={flags as never} here={here} tabs={tabs.filter((t) => t.key !== "overview")} />
    </>
  );
}

export const BUSINESS_SCREENS: Record<string, PreviewScreen> = {
  companies: {
    path: "/admin/companies",
    render: (sp) => {
      const status = pick(sp, "status");
      const plan = pick(sp, "plan");
      const items = COMPANIES.filter((c) => (!status || c.status === status) && (!plan || c.plan === plan));
      return <CompaniesView items={items} plans={PLANS} q={pick(sp, "q")} plan={plan} status={status} sp={sp} next="/admin/preview/companies?cursor=c6" bad={null} base="/admin/preview/companies" />;
    },
  },
  company: { path: "/admin/companies/c1", render: (sp) => <CompanyPreview sp={sp} /> },
  "client-health": {
    path: "/admin/client-health",
    render: (sp) => {
      const f = pick(sp, "flag");
      return (
        <>
          <PageHeader icon={Building2} tone="blue" title="Client health" description="Who is active, whose trial ends soon, and who is late paying or barely using BuPulse. One tap to WhatsApp or email them." />
          <ClientHealthView rows={CLIENT_ROWS} flag={(f || null) as never} now={NOW} base="/admin/preview/client-health" />
        </>
      );
    },
  },
  usage: { path: "/admin/usage", render: (sp) => <UsageView rows={CLIENT_ROWS} sort={(pick(sp, "sort") || "cost") as "cost"} fx={fx} base="/admin/preview/usage" /> },
  connections: { path: "/admin/connections", render: () => <ConnectionsHub /> },
  demos: {
    path: "/admin/demos",
    render: (sp) => (
      <DemosView
        demos={DEMOS}
        when="upcoming"
        status={pick(sp, "status")}
        sp={sp}
        trialDays={14}
        meetingLinkSet={false}
        googleNeedsReconnect={false}
        account={(userId) => (userId === "u2" ? { status: "TRIALING", summary: { text: "On trial until 20 Nov", links: ["extend_trial", "change_plan"] } } : { status: null, summary: null })}
        here="/admin/preview/demos"
        demoStatusAction={demoStatusAction}
        retryDemoCalendarAction={retryDemoCalendarAction}
      />
    ),
  },
  requests: { path: "/admin/requests", render: (sp) => <RequestsView requests={REQUESTS} status={pick(sp, "status")} open="r1" sp={sp} setStatusAction={setRequestStatusAction} /> },
  quotes: { path: "/admin/quotes", render: (sp) => <QuotesView items={QUOTES} filter="open" next={null} back="/admin/quotes" sp={sp} setHandledAction={setQuoteHandledAction} /> },
  "my-clients": {
    path: "/admin/sales",
    render: () => <MyClientsView fx={fx} d={{ isStaff: true, clients: SALES_CLIENTS.slice(0, 2), link: { code: "K7Q2", url: "https://bupulse.com/?ref=K7Q2" }, month: "2026-11", board: BOARD, staffId: "s1", canViewClients: true, now: NOW }} />,
  },
  team: {
    path: "/admin/sales/team",
    render: () => (
      <TeamView
        fx={fx}
        d={{ members: MEMBERS, board: BOARD, clients: SALES_CLIENTS, reassignments: [{ id: "x1", at: ago(3), client: "Musanze Tools", agent: null, reason: "Agent left", by: "staff:m1" }], month: "2026-11", canViewClients: true, canReassign: true, now: NOW }}
        reassignAction={reassignClientAction}
      />
    ),
  },
  leaderboard: { path: "/admin/sales/leaderboard", render: (sp) => <LeaderboardView fx={fx} rows={BOARD} month={pick(sp, "month") || "2026-11"} months={["2026-11", "2026-10", "2026-09", "2026-08"]} me="s1" base="/admin/preview/leaderboard" /> },
  partners: {
    path: "/admin/sales/partners",
    render: (sp) => <PartnersView rows={PARTNERS} canDecide canPay sp={sp} actions={{ approve: approvePartnerAction, reject: rejectPartnerAction, pause: pausePartnerAction, payout: recordPayoutAction }} />,
  },
};
