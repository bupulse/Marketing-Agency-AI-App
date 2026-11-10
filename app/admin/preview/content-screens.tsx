// Dev-only preview screens for round 2, part C (AI, Content, Inbox and Live chat), with made-up data. Rendered by
// app/admin/preview/[[...screen]]/page.tsx (which returns notFound() in production). Placeholder names only.
import type { ReactNode } from "react";
import { ExternalLink, Headset, Inbox } from "lucide-react";
import { InboxView, inboxShown } from "@/components/admin/inbox-view";
import { AgentsView } from "@/components/admin/live-chat/agents-view";
import { DepartmentsView } from "@/components/admin/live-chat/departments-view";
import { LiveChatHub } from "@/components/admin/live-chat/hub";
import { LeadsView } from "@/components/admin/live-chat/leads-view";
import { AiForm, HoursForm } from "@/components/admin/live-chat/settings-forms";
import { LIVE_CHAT_LOOK, LIVE_CHAT_TABS, LiveChatTabs, liveChatTab } from "@/components/admin/live-chat/tabs";
import { PageHeader } from "@/components/admin/kit";
import { notice } from "@/components/admin/ui";
import { Button } from "@/components/ui";
import type { InboxSection } from "@/lib/admin/inbox";
import type { AgentAdminView, DepartmentView } from "@/lib/support/agents";
import { DEFAULT_SUPPORT_SETTINGS } from "@/lib/support/settings";
import type { ChatLead } from "@/lib/support/admin-leads";
import { AiUsageView, type AiUsage } from "@/components/admin/content-ai/ai-usage-view";
import { APPROVAL_VIEWS, ApprovalsView } from "@/components/admin/content-ai/approvals-view";
import { JarvisView } from "@/components/admin/content-ai/jarvis-view";
import { chosen } from "@/components/admin/kit";
import type { ApprovalView } from "@/lib/admin/service";
import { BookOpen, Plus, Sparkles } from "lucide-react";
import { AnnouncementsView, ANNOUNCEMENT_STATES, type AnnouncementState } from "@/components/admin/content-ai/announcements-view";
import { TestimonialsView } from "@/components/admin/content-ai/testimonials-view";
import { IndustriesView, INDUSTRY_FILTERS } from "@/components/admin/content-ai/industries-view";
import { MusicView, TRACK_FILTERS } from "@/components/admin/content-ai/music-view";
import { FilterChips } from "@/components/admin/kit";
import { Panel } from "@/components/admin/ui";
import { LabHubCards } from "@/app/admin/(console)/(ai)/training-lab/hub-cards";
import { Gallery } from "@/app/admin/(console)/(ai)/training-lab/gallery";
import { WordsView, WORD_LISTS, type WordList } from "@/app/admin/(console)/(ai)/training-lab/words/view";
import { KIND_CHIPS, type GalleryItem } from "@/lib/training-lab/gallery";

type SP = Record<string, string | string[] | undefined>;
type Screen = { path: string; render: (sp: SP) => ReactNode };
/** A do-nothing server function for the preview's forms (client buttons only take real server functions). */
async function noop(): Promise<void> {
  "use server";
}
const str = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// ---- Inbox --------------------------------------------------------------------------------------------------------

const INBOX: InboxSection[] = [
  { key: "quotes", title: "Quote requests to call", why: "People asked for a free quote on the website and expect a call. Call them, then mark them called.", href: "/admin/quotes", count: 3, tone: "danger", items: [
    { id: "q1", text: "Sample Bakery, +250 7xx xxx 101", sub: "Wants daily posts for 2 branches", href: "/admin/quotes", at: ago(1) },
    { id: "q2", text: "Example Salon, +250 7xx xxx 102", sub: "Asked about the 50k plan", href: "/admin/quotes", at: ago(3) },
    { id: "q3", text: "Demo Hardware, +250 7xx xxx 103", href: "/admin/quotes", at: ago(20) },
  ] },
  { key: "payments", title: "Payments to confirm", why: "Clients say they paid by Mobile Money. Check the money arrived, then confirm or reject.", href: "/admin/payments", count: 2, tone: "danger", items: [
    { id: "p1", text: "Sample Bakery paid RWF 50,000", sub: "MoMo reference 12345678", href: "/admin/payments", at: ago(2) },
    { id: "p2", text: "Example Pharmacy paid RWF 80,000", href: "/admin/payments", at: ago(6) },
  ] },
  { key: "approvals", title: "Money requests to approve", why: "Refunds, plan changes and offers Jarvis or the console asked for. Nothing happens until you approve.", href: "/admin/approvals", count: 1, tone: "danger", items: [{ id: "a1", text: "Refund RWF 29,000 to Example Salon", sub: "Asked by Jarvis", href: "/admin/approvals", at: ago(4) }] },
  { key: "demos", title: "Demos", why: "Booked demos in the next 48 hours, and past ones still to mark done or no-show.", href: "/admin/demos", count: 2, tone: "violet", items: [
    { id: "d1", text: "Demo Garage, today 14:00", href: "/admin/demos" },
    { id: "d2", text: "Sample Hotel, tomorrow 10:30", href: "/admin/demos" },
  ] },
  { key: "requests", title: "Plan requests", why: "Businesses asked for a custom plan. Reply with an offer or mark them contacted.", href: "/admin/requests", count: 7, tone: "violet", items: [{ id: "r1", text: "Example School wants 3 brands", href: "/admin/requests", at: ago(30) }] },
  { key: "errors", title: "Errors in the last 24 hours", why: "Server errors. Open Errors for details; Health shows whether anything is down.", href: "/admin/errors", count: 4, tone: "danger", items: [{ id: "e1", text: "Composio: token expired for 1 channel", href: "/admin/errors", at: ago(5) }] },
];

function InboxScreen({ sp }: { sp: SP }) {
  const sections = str(sp, "empty") ? [] : INBOX;
  const show = inboxShown(sections, str(sp, "show"));
  return (
    <>
      <PageHeader icon={Inbox} tone="blue" title="Inbox" description="Everything waiting for a person, most urgent first. Tap a row to open it, or a chip to see one kind." />
      <InboxView sections={sections} show={show} params={sp} />
    </>
  );
}

// ---- Live chat ----------------------------------------------------------------------------------------------------

const DEPTS: DepartmentView[] = [
  { key: "sales", name: "Sales", sort: 0, agents: 2 },
  { key: "technical", name: "Technical help", sort: 1, agents: 1 },
  { key: "billing", name: "Billing", sort: 2, agents: 2 },
  { key: "creators", name: "Creators", sort: 3, agents: 0 },
] as DepartmentView[];
const agent = (over: Partial<AgentAdminView>): AgentAdminView => ({ id: "a1", email: "agent@example.com", name: "Agent One", role: "AGENT", status: "active", availability: "online", maxChats: 5, departments: ["sales"], authenticator: true, lastSeenAt: ago(2), createdAt: ago(400), ...over }) as AgentAdminView;
const AGENTS: AgentAdminView[] = [
  agent({ id: "a1", name: "Grace Example", email: "grace@example.com", role: "SUPERVISOR", departments: [] }),
  agent({ id: "a2", name: "Jean Sample", email: "jean@example.com", departments: ["sales", "billing"] as AgentAdminView["departments"] }),
  agent({ id: "a3", name: "Aline Placeholder", email: "aline@example.com", status: "invited", authenticator: false, lastSeenAt: null }),
  agent({ id: "a4", name: "Eric Demo", email: "eric@example.com", status: "pending", authenticator: false, lastSeenAt: null, departments: [] }),
  agent({ id: "a5", name: "Lucie Test", email: "lucie@example.com", status: "locked", role: "TECH", departments: ["technical"] as AgentAdminView["departments"] }),
];
const LEADS: ChatLead[] = [
  { id: "l1", name: "Aline Uwase", email: "aline@example.com", phone: "+250 7xx xxx 104", businessName: "Sample Beauty Salon", message: "How much is the plan with videos?", createdAt: ago(1), conversationId: "c1" },
  { id: "l2", name: "Eric N.", email: "eric@example.com", phone: null, businessName: null, message: "Do you post on TikTok too?", createdAt: ago(9), conversationId: null },
];
const liveActions = { invite: noop, update: noop, setLocked: noop, resend: noop, resetAuthenticator: noop, answerRequest: noop };

function LiveChatScreen({ sp }: { sp: SP }) {
  const tab = str(sp, "tab") ? liveChatTab(str(sp, "tab")) : null;
  return (
    <>
      <PageHeader
        icon={tab ? LIVE_CHAT_LOOK[tab].icon : Headset}
        tone="teal"
        title={tab ? LIVE_CHAT_TABS.find(([k]) => k === tab)![1] : "Live chat"}
        description={tab ? LIVE_CHAT_LOOK[tab].hint : "BuPulse's own help chat. Support agents sign in at the support app with their own accounts, never admin ones."}
        back={tab ? { href: "/admin/preview/livechat", label: "Live chat" } : undefined}
        actions={<Button href="/admin/preview/livechat" variant="outline" size="sm" trailing={<ExternalLink aria-hidden className="size-4" />}>Open the support app</Button>}
      />
      {str(sp, "notice") && <p role="status" className={notice.ok}>{str(sp, "notice")}</p>}
      {!tab && <LiveChatHub agents={AGENTS} departments={DEPTS} settings={DEFAULT_SUPPORT_SETTINGS} leads={{ count: 2, more: false }} />}
      {tab && <LiveChatTabs current={tab} />}
      {tab === "agents" && <AgentsView agents={AGENTS} departments={DEPTS} actions={liveActions} />}
      {tab === "departments" && <DepartmentsView departments={DEPTS} rename={noop} />}
      {tab === "hours" && <HoursForm hours={DEFAULT_SUPPORT_SETTINGS.hours} save={noop} />}
      {tab === "ai" && <AiForm settings={DEFAULT_SUPPORT_SETTINGS} save={noop} />}
      {tab === "leads" && <LeadsView leads={LEADS} next={null} appUrl="https://support.example.com" first />}
    </>
  );
}

// ---- AI ---------------------------------------------------------------------------------------------------------

const AI_USAGE = {
  month: "2026-11", isCurrentMonth: true,
  cap: { usd: 100, source: "admin", envDefaultUsd: 50, minUsd: 5, maxUsd: 2000 },
  spentUsd: 32.4, remainingUsd: 67.6, percentUsed: 32.4, paused: false, projectedUsd: 97.2, projectedOverCap: false,
  calls: 4210, estimatedCalls: 12,
  perDay: Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, costUsd: [2.1, 3.4, 2.8, 4.2, 3.1, 2.5, 3.9, 4.4, 3.0, 3.0][i], calls: 400 + i * 10, failed: i % 3 })),
  perModel: [
    { provider: "google", model: "gemini-2.5-flash", approximatePrice: false, calls: 3100, costUsd: 18.2, inputTokens: 0, outputTokens: 0, images: 0 },
    { provider: "anthropic", model: "claude-sonnet", approximatePrice: false, calls: 610, costUsd: 9.8, inputTokens: 0, outputTokens: 0, images: 0 },
    { provider: "elevenlabs", model: "music", approximatePrice: true, calls: 12, costUsd: 4.4, inputTokens: 0, outputTokens: 0, images: 0 },
  ],
  perFeature: [{ feature: "daily posts", calls: 2400, costUsd: 14.1 }, { feature: "chat replies", calls: 1300, costUsd: 9.9 }, { feature: "videos", calls: 510, costUsd: 8.4 }],
  topSpenders: [
    { userId: "u1", business: "Sample Bakery", email: "owner@sample-bakery.example", calls: 820, costUsd: 6.2, percentOfSpend: 19.1 },
    { userId: "u2", business: "Example Salon", email: "hello@example-salon.example", calls: 610, costUsd: 4.8, percentOfSpend: 14.8 },
  ],
  failed: { count: 38, percentOfCalls: 0.9, topErrors: [{ error: "429 Resource exhausted (quota)", count: 21 }, { error: "Timed out after 60 s", count: 17 }], recent: [{ at: ago(1), provider: "google", model: "gemini-2.5-flash", feature: "daily posts", userId: "u1", error: "429" }] },
} as unknown as AiUsage;

const approval = (over: Partial<ApprovalView>): ApprovalView => ({ id: "ap1", kind: "issue_refund", params: { userId: "u1", refundAmountMinor: 2900000, currency: "RWF", refundType: "partial", reason: "Charged twice for October", transactionId: "txn_01example" }, status: "pending", requestedBy: "jarvis:key1", idempotencyKey: "k", result: null, decidedBy: null, decidedAt: null, createdAt: ago(3), ...over }) as ApprovalView;
const PENDING = [approval({}), approval({ id: "ap2", kind: "change_plan", params: { userId: "u2", plan: "PRO", interval: "MONTH", currentPlan: "STARTER", currentInterval: "MONTH" }, requestedBy: "admin", createdAt: ago(20) })];
const HISTORY = [
  approval({ id: "h1", status: "executed", decidedAt: ago(30), createdAt: ago(32) }),
  approval({ id: "h2", kind: "change_plan", params: { userId: "u3", plan: "BUSINESS", interval: "YEAR" }, status: "needs_check" as ApprovalView["status"], decidedAt: ago(50), createdAt: ago(52), result: { error: "Paddle did not answer in time" } }),
  approval({ id: "h3", status: "rejected", decidedAt: ago(80), createdAt: ago(90) }),
];
const KEYS = [
  { id: "k1", name: "Jarvis on the office Mac", prefix: "bpk_live_3f9a", ipAllowList: [], lastUsedAt: new Date(Date.now() - 600_000), revokedAt: null, createdAt: new Date(Date.now() - 40 * 86_400_000) },
  { id: "k2", name: "Test key", prefix: "bpk_live_77c1", ipAllowList: ["192.0.2.10"], lastUsedAt: null, revokedAt: null, createdAt: new Date(Date.now() - 3 * 86_400_000) },
  { id: "k3", name: "Old laptop", prefix: "bpk_live_0a12", ipAllowList: [], lastUsedAt: null, revokedAt: new Date(Date.now() - 90 * 86_400_000), createdAt: new Date(Date.now() - 200 * 86_400_000) },
] as unknown as Parameters<typeof JarvisView>[0]["keys"];

// ---- Training Lab -------------------------------------------------------------------------------------------------

const LAB_ITEMS: GalleryItem[] = [
  { id: "e1", title: "Bakery morning reel, slow pour shot", kind: "reel", kindLabel: "Reel", rating: 5, never: false, used: 4, warning: null, thumb: { type: "missing" } },
  { id: "e2", title: "Greeting in Kinyarwanda, market voice", kind: "voice", kindLabel: "Kinyarwanda recording", rating: 4, never: false, used: null, warning: null, thumb: { type: "audio" } },
  { id: "e3", title: "Presenter walks through the product", kind: "reel", kindLabel: "Reel", rating: 1, never: true, used: null, warning: null, thumb: { type: "link" } },
  { id: "e4", title: "Actor: Aline, salon presenter", kind: "actor", kindLabel: "Actor", rating: null, never: false, used: null, warning: "No consent recorded.", thumb: { type: "file" } },
  { id: "e5", title: "Best Instagram times, Kigali", kind: "schedule", kindLabel: "Posting habit", rating: 4, never: false, used: 2, warning: null, thumb: { type: "habit" } },
] as GalleryItem[];

function LabScreen({ sp }: { sp: SP }) {
  return (
    <>
      <PageHeader icon={Sparkles} tone="violet" title="Training Lab" description="Teach the engines by example: add a reel, video, photo, Kinyarwanda recording, actor or posting habit, and say in your own words what is good about it. Only you see this page." actions={<Button href="/admin/preview/lab" leading={<Plus aria-hidden className="size-4" />}>Add an example</Button>} />
      <LabHubCards reelsWaiting={3} health={[{ id: "e4", title: "Actor: Aline, salon presenter", problem: "No consent recorded: the presenters will not use this actor." }, { id: "e3", title: "Presenter walks through the product", problem: "No engine is switched on for it." }]} />
      <Panel icon={BookOpen} tone="violet" title="Library (5)" description="Newest first. Tap an example to see everything about it and change it.">
        <FilterChips label="Filter by kind" param="kind" base="/admin/preview/lab" params={sp} current={str(sp, "kind")} options={KIND_CHIPS.map((c) => ({ value: c.kind ?? "", label: c.label }))} />
        <Gallery items={LAB_ITEMS} details={{}} empty="Your Lab is empty." />
      </Panel>
    </>
  );
}

const WORDS = {
  wrong: [{ word: "murakaza nez", fix: "murakaza neza", id: "e2", title: "Greeting in Kinyarwanda", on: true }, { word: "amakuru yawe", fix: null, id: "e2", title: "Greeting in Kinyarwanda", on: false }],
  words: [{ word: "Mwiriwe", id: "e2", title: "Greeting in Kinyarwanda", on: true }, { word: "Murakoze", id: "e2", title: "Greeting in Kinyarwanda", on: true }, { word: "Isoko", id: "e2", title: "Market voice", on: true }],
  phrases: [{ phrase: "Murakaza neza ku isoko ryacu", id: "e2", title: "Greeting in Kinyarwanda", on: true }],
  recordings: 2,
} as unknown as Parameters<typeof WordsView>[0]["overview"];

// ---- Content ------------------------------------------------------------------------------------------------------

const day = 86_400_000;
const ANNOUNCEMENTS = [
  { id: "n1", title: "New: video posts on the 80k plan", body: "Your plan now includes 3 short videos a week. Open Posts to see the first one.", startsAt: new Date(Date.now() - 2 * day), endsAt: new Date(Date.now() + 5 * day), audience: "plan", plans: ["PRO", "BUSINESS"] },
  { id: "n2", title: "Holiday hours", body: "Support answers from 10:00 to 16:00 on public holidays.", startsAt: new Date(Date.now() + 3 * day), endsAt: null, audience: "all", plans: [] },
  { id: "n3", title: "Maintenance on Sunday night", body: "Posting pauses for 20 minutes after midnight.", startsAt: new Date(Date.now() - 20 * day), endsAt: new Date(Date.now() - 19 * day), audience: "all", plans: [] },
];
const TESTIMONIALS = [
  { id: "t1", clientName: "Aline U.", business: "Sample Beauty Salon", sector: "Beauty", quote: "Our Instagram finally posts every day, and clients book from it.", result: "+40% bookings in a month", consent: true, published: true, photoUrl: null },
  { id: "t2", clientName: "Eric N.", business: "Example Hardware", sector: null, quote: "The daily posts in Kinyarwanda sound like us.", result: null, consent: true, published: false, photoUrl: null },
  { id: "t3", clientName: "Grace M.", business: "Demo Bakery", sector: "Food", quote: "Simple and fast.", result: null, consent: false, published: false, photoUrl: null },
];
const INDUSTRIES = [
  { id: "i1", name: "Shops and boutiques", slug: "shops", shortDescription: "Shops selling everyday goods, fashion and gifts, in person and on WhatsApp.", businesses: 12, sortOrder: 10, active: true },
  { id: "i2", name: "Salons and beauty", slug: "beauty", shortDescription: "Hair, nails and beauty services, booked by phone or WhatsApp.", businesses: 8, sortOrder: 20, active: true },
  { id: "i3", name: "Restaurants and cafés", slug: "food", shortDescription: "Places to eat and drink, with delivery by moto.", businesses: 5, sortOrder: 30, active: true },
  { id: "i4", name: "Car wash", slug: "car-wash", shortDescription: "Car washing and detailing.", businesses: 0, sortOrder: 90, active: false },
];
const SUGGESTIONS = [{ key: "tailoring", label: "tailoring", count: 3, samples: ["Tailoring and kitenge", "tailor shop", "Tailoring"] }];
const TRACKS = [
  { id: "m1", title: "Kigali Morning", path: "a.mp3", bytes: 3_400_000, bpm: 104, moods: ["upbeat", "afro"], licence: "Pixabay licence", sourceUrl: "https://example.com/track/1", attribution: null, active: true },
  { id: "m2", title: "Calm Market", path: "b.mp3", bytes: 2_100_000, bpm: null, moods: ["calm"], licence: "CC BY 4.0", sourceUrl: "https://example.com/track/2", attribution: "Music by Example Artist", active: false },
];

/** Screen name (the first part after /admin/preview/) -> the console path it pretends to be, and what it renders. */
export const CONTENT_SCREENS: Record<string, Screen> = {
  inbox: { path: "/admin/inbox", render: (sp) => <InboxScreen sp={sp} /> },
  livechat: { path: "/admin/live-chat", render: (sp) => <LiveChatScreen sp={sp} /> },
  ai: { path: "/admin/ai", render: (sp) => <AiUsageView u={AI_USAGE} usd={(n) => `$${n.toFixed(2)}`} currency="USD" thisMonth="2026-11" params={sp} message={{ notice: str(sp, "notice") || undefined }} /> },
  approvals: { path: "/admin/approvals", render: (sp) => <ApprovalsView pending={str(sp, "empty") ? [] : PENDING} history={HISTORY} isExpired={() => false} paddleEnv="sandbox" view={chosen(sp, "view", APPROVAL_VIEWS, "waiting") as (typeof APPROVAL_VIEWS)[number]} params={sp} message={{}} /> },
  lab: { path: "/admin/training-lab", render: (sp) => <LabScreen sp={sp} /> },
  words: { path: "/admin/training-lab/words", render: (sp) => <WordsView overview={WORDS} list={chosen(sp, "list", WORD_LISTS, "wrong") as WordList} params={sp} /> },
  announcements: { path: "/admin/announcements", render: (sp) => <AnnouncementsView rows={ANNOUNCEMENTS} plans={[{ key: "STARTER", name: "Starter" }, { key: "PRO", name: "Pro" }, { key: "BUSINESS", name: "Business" }]} now={Date.now()} show={chosen(sp, "show", ANNOUNCEMENT_STATES, "") as "" | AnnouncementState} params={sp} message={{}} /> },
  testimonials: { path: "/admin/testimonials", render: () => <TestimonialsView rows={TESTIMONIALS} message={{ notice: "Aline U. moved up." }} /> },
  industries: { path: "/admin/industries", render: (sp) => <IndustriesView industries={INDUSTRIES} suggestions={SUGGESTIONS} dismissed={[{ key: "x", label: "crypto" }]} show={chosen(sp, "show", INDUSTRY_FILTERS, "") as "" | (typeof INDUSTRY_FILTERS)[number]} params={sp} message={{}} /> },
  music: { path: "/admin/music", render: (sp) => <MusicView tracks={TRACKS} urlOf={(path) => `/preview-audio/${path}`} maxBytes={200 * 1024 * 1024} show={chosen(sp, "show", TRACK_FILTERS, "") as "" | (typeof TRACK_FILTERS)[number]} params={sp} message={{}} /> },
  jarvis: { path: "/admin/jarvis", render: () => <JarvisView keys={KEYS} base="https://bupulse.example" message={{}} /> },
};
