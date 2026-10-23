// A pretend agent API with made-up chats and visitors (example.com addresses, no real people), for the dev-only preview
// pages (app/support/preview) and the tests, until sc-core's server answers /api/support/v1/agent/*. Kept in memory per
// page load: replies, take-overs and closes change it, so the screens can be clicked through.
import type { AgentMe, ConversationDetail, ConversationListItem, LiveVisitor, MessageView, Stats } from "@/lib/support/contract";
import type { AgentApi, TeamMember } from "./api";
import { inView, matchesSearch } from "./lists";

const MIN = 60_000;

export function mockData(now = Date.now(), me: AgentMe = MOCK_AGENT) {
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const msg = (id: string, author: MessageView["author"], body: string, msAgo: number, extra: Partial<MessageView> = {}): MessageView & { seenByVisitorAt: string | null; original: string | null } => ({
    id,
    author,
    kind: "TEXT",
    body,
    agentName: author === "AGENT" ? me.name : null,
    sources: null,
    actions: null,
    attachment: null,
    createdAt: at(msAgo),
    clientMsgId: null,
    seenByVisitorAt: null,
    original: null,
    ...extra,
  });
  const base = { unread: false, tags: [] as string[], urgency: null, leadScore: null, language: "en", assigneeName: null, waitingSince: null, businessName: null };
  const list: ConversationListItem[] = [
    { ...base, id: "c1042", number: 1042, status: "OPEN", visitorName: "Aline Uwase", businessName: "Sample Beauty Salon", preview: "I paid with MoMo 2 hours ago but my plan…", lastMessageAt: at(1 * MIN), waitingSince: at(72_000), department: "billing", assigneeName: me.name, unread: true },
    { ...base, id: "c1043", number: 1043, status: "WAITING", visitorName: "Patrick H.", preview: "This is the third time my post failed!!", lastMessageAt: at(2 * MIN), waitingSince: at(2 * MIN), department: "technical", urgency: "upset" },
    { ...base, id: "c1044", number: 1044, status: "AI", visitorName: "Eric N.", preview: "Is Pro worth it for 3 shops?", lastMessageAt: at(4 * MIN), department: "sales", leadScore: 82 },
    { ...base, id: "c1045", number: 1045, status: "AI", visitorName: "Visitor in Musanze", preview: "Do you design posters for a restaurant?", lastMessageAt: at(6 * MIN), department: null, language: "rw" },
    { ...base, id: "c1046", number: 1046, status: "AI", visitorName: "Diane K.", preview: "When are creator payouts sent?", lastMessageAt: at(11 * MIN), department: "creators" },
    { ...base, id: "c1040", number: 1040, status: "CLOSED", visitorName: "Samuel B.", preview: "Thanks, all working now.", lastMessageAt: at(90 * MIN), department: "technical", assigneeName: me.name },
  ];
  const detail = (c: ConversationListItem, rest: Partial<ConversationDetail>): ConversationDetail => ({
    ...c,
    aiActive: c.status === "AI",
    handoverReason: null,
    summary: null,
    visitor: { id: `v-${c.id}`, name: c.visitorName, email: null, phone: null, signedIn: false },
    account: null,
    visit: null,
    past: [],
    messages: [],
    ...rest,
  });
  const details: Record<string, ConversationDetail> = {
    c1042: detail(list[0], {
      handoverReason: "topic",
      summary: "Aline paid for Standard by MoMo about 2 hours ago; the plan still shows pending. She sent the receipt. Handed over because payments always go to a person.",
      visitor: { id: "v-aline", name: "Aline Uwase", email: "aline@example.com", phone: "+250 78x xxx xxx", signedIn: true },
      account: { businessName: "Sample Beauty Salon", plan: "Standard", planStatus: "pending_payment", trialDaysLeft: null, businessInfoPercent: 90, channels: [{ platform: "Facebook", ok: true }, { platform: "Instagram", ok: false }], failedPostsThisWeek: 2, adminHref: "/admin/companies" },
      visit: {
        country: "RW",
        city: "Kigali",
        ip: "197.243.x.x",
        device: "Android phone",
        os: "Android",
        browser: "Chrome",
        referrer: "instagram.com",
        surface: "dashboard",
        currentPath: "/dashboard/billing/momo",
        pages: [
          { path: "/pricing", title: "Pricing", at: at(6 * MIN) },
          { path: "/dashboard/billing", title: "Billing", at: at(4 * MIN) },
          { path: "/dashboard/billing/momo", title: "Pay with MoMo", at: at(2 * MIN) },
        ],
        startedAt: at(6 * MIN),
        lastSeenAt: at(10_000),
        visitCount: 3,
      },
      past: [
        { id: "c0987", number: 987, title: "Setting up Instagram", outcome: "solved by AI", at: at(9 * 24 * 60 * MIN) },
        { id: "c0911", number: 911, title: "Which plan for a salon?", outcome: "rated good", at: at(30 * 24 * 60 * MIN) },
      ],
      messages: [
        msg("m1", "VISITOR", "I paid with MoMo 2 hours ago but my plan still says pending.", 3 * MIN),
        msg("m2", "VISITOR", "", 3 * MIN - 5000, { kind: "FILE", attachment: { id: "a1", mime: "image/jpeg", fileName: "momo-receipt.jpg", bytes: 182_000, url: null, durationSec: null, transcript: null } }),
        msg("m3", "AI", "Payments are confirmed by a person, so I’m passing you to the billing team now.", 72_000),
        msg("m4", "AGENT", "Note: receipt matches the MoMo reference. Confirming in Admin → Billing.", 30_000, { kind: "NOTE" }),
      ],
    }),
    c1043: detail(list[1], {
      handoverReason: "upset",
      summary: "Patrick's Instagram posts failed three times this week. He is upset and asked for a person.",
      visitor: { id: "v-patrick", name: "Patrick H.", email: "patrick@example.com", phone: null, signedIn: true },
      account: { businessName: "Sample Hardware Ltd", plan: "Pro", planStatus: "active", trialDaysLeft: null, businessInfoPercent: 75, channels: [{ platform: "Instagram", ok: false }], failedPostsThisWeek: 3, adminHref: "/admin/companies" },
      messages: [msg("p1", "VISITOR", "This is the third time my post failed!!", 2 * MIN), msg("p2", "AI", "I’m sorry about that. I’m getting a person from the technical team for you.", 2 * MIN - 4000)],
    }),
    c1044: detail(list[2], {
      summary: "Eric runs 3 shops and compares Standard and Pro. Hot lead: asked about the Pro price twice.",
      visitor: { id: "v-eric", name: "Eric N.", email: "eric@example.com", phone: null, signedIn: false },
      messages: [msg("e1", "VISITOR", "Is Pro worth it for 3 shops?", 4 * MIN), msg("e2", "AI", "For 3 shops Pro is the better fit: it covers several locations and more posts each month.", 4 * MIN - 3000)],
    }),
    c1045: detail(list[3], { messages: [msg("k1", "VISITOR", "Do you design posters for a restaurant?", 6 * MIN)] }),
    c1046: detail(list[4], { messages: [msg("d1", "VISITOR", "When are creator payouts sent?", 11 * MIN)] }),
    c1040: detail(list[5], { messages: [msg("s1", "VISITOR", "Thanks, all working now.", 90 * MIN)] }),
  };
  const visitors: LiveVisitor[] = [
    { visitId: "w1", visitorId: "v-aline", name: "Aline Uwase", kind: "client", group: "waiting", conversationId: "c1042", typing: null, country: "RW", city: "Kigali", currentPath: "/dashboard/billing/momo", pageCount: 3, secondsOnSite: 360, visitCount: 3, referrer: "instagram.com", device: "Android", browser: "Chrome", leadScore: null },
    { visitId: "w2", visitorId: "v-eric", name: "Eric N.", kind: "visitor", group: "chatting", conversationId: "c1044", typing: "and if I add a 4th shop la…", country: "RW", city: "Kigali", currentPath: "/pricing", pageCount: 5, secondsOnSite: 540, visitCount: 2, referrer: "google.com", device: "Windows", browser: "Edge", leadScore: 82 },
    { visitId: "w3", visitorId: "v-4821", name: "Visitor 4821", kind: "visitor", group: "browsing", conversationId: null, typing: null, country: "RW", city: "Huye", currentPath: "/industries/restaurants", pageCount: 4, secondsOnSite: 180, visitCount: 1, referrer: "facebook.com", device: "iPhone", browser: "Safari", leadScore: 54 },
    { visitId: "w4", visitorId: "v-hardware", name: "Sample Hardware Ltd", kind: "client", group: "browsing", conversationId: null, typing: null, country: "RW", city: "Kigali", currentPath: "/dashboard/calendar", pageCount: 12, secondsOnSite: 1440, visitCount: 41, referrer: null, device: "Mac", browser: "Chrome", leadScore: null },
    { visitId: "w5", visitorId: "v-4830", name: "Visitor 4830", kind: "visitor", group: "browsing", conversationId: null, typing: null, country: "UG", city: "Kampala", currentPath: "/signup", pageCount: 2, secondsOnSite: 60, visitCount: 1, referrer: "tiktok.com", device: "Android", browser: "Chrome", leadScore: 61 },
    { visitId: "w6", visitorId: "v-diane", name: "Diane K.", kind: "creator", group: "chatting", conversationId: "c1046", typing: null, country: "RW", city: "Rubavu", currentPath: "/creator/payouts", pageCount: 6, secondsOnSite: 660, visitCount: 8, referrer: null, device: "iPhone", browser: "Safari", leadScore: null },
    { visitId: "w7", visitorId: "v-4799", name: "Visitor 4799", kind: "visitor", group: "idle", conversationId: null, typing: null, country: "RW", city: "Musanze", currentPath: "/b/sample-bakery", pageCount: 1, secondsOnSite: 720, visitCount: 1, referrer: "instagram.com", device: "Android", browser: "Chrome", leadScore: 20 },
  ];
  const team: TeamMember[] = [
    { id: me.id, name: me.name, availability: "online", departments: me.departments, openChats: 3, maxChats: 5 },
    { id: "ag-claudine", name: "Claudine I.", availability: "away", departments: ["technical"], openChats: 1, maxChats: 5 },
    { id: "ag-samuel", name: "Samuel B.", availability: "offline", departments: ["creators"], openChats: 0, maxChats: 5 },
  ];
  const stats: Stats = {
    from: at(7 * 24 * 60 * MIN),
    to: at(0),
    chats: 412,
    aiSolvedPercent: 71,
    handoverPercent: 22,
    firstHumanReplySec: 100,
    ratedGoodPercent: 92,
    newLeads: 58,
    agents: [
      { id: me.id, name: me.name, availability: "online", openChats: 3, maxChats: 5, ratedGoodPercent: 95 },
      { id: "ag-claudine", name: "Claudine I.", availability: "away", openChats: 1, maxChats: 5, ratedGoodPercent: 89 },
      { id: "ag-samuel", name: "Samuel B.", availability: "offline", openChats: 0, maxChats: 5, ratedGoodPercent: 91 },
    ],
  };
  return { list, details, visitors, team, stats };
}

export const MOCK_AGENT: AgentMe = { id: "ag-jean", name: "Jean M.", email: "jean@example.com", role: "SUPERVISOR", availability: "online", departments: ["billing", "sales"] };

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export function createMockAgentApi({ me = MOCK_AGENT, now = Date.now(), delayMs = 120 }: { me?: AgentMe; now?: number; delayMs?: number } = {}): AgentApi {
  let self = { ...me };
  const data = mockData(now, me);
  let seq = 0;
  const pause = () => (delayMs ? wait(delayMs) : Promise.resolve());
  const find = (id: string) => {
    const d = data.details[id];
    if (!d) throw new Error("No chat with that id.");
    return d;
  };
  const patch = (id: string, fields: Partial<ConversationDetail>) => {
    const d = Object.assign(find(id), fields);
    const i = data.list.findIndex((c) => c.id === id);
    if (i >= 0) data.list[i] = { ...data.list[i], ...fields };
    return structuredClone(d);
  };
  return {
    async me() {
      await pause();
      return { ...self };
    },
    async setAvailability(availability) {
      await pause();
      self = { ...self, availability };
      return { ...self };
    },
    async conversations(view, q) {
      await pause();
      return { items: structuredClone(data.list.filter((c) => inView(c, view, self) && (!q || matchesSearch(c, q)))), next: null };
    },
    async conversation(id) {
      await pause();
      return structuredClone(find(id));
    },
    async send(id, body) {
      await pause();
      const message: MessageView & { seenByVisitorAt: string | null; original: string | null } = { id: `new-${++seq}`, author: "AGENT", kind: body.kind ?? "TEXT", body: body.text, agentName: self.name, sources: null, actions: null, attachment: null, createdAt: new Date().toISOString(), clientMsgId: body.clientMsgId, seenByVisitorAt: null, original: null };
      const d = find(id);
      d.messages.push(message);
      if (message.kind === "TEXT") patch(id, { status: "OPEN", aiActive: false, waitingSince: null, assigneeName: self.name, preview: body.text, lastMessageAt: message.createdAt });
      return { message };
    },
    async takeover(id) {
      await pause();
      return patch(id, { status: "OPEN", aiActive: false, assigneeName: self.name });
    },
    async release(id) {
      await pause();
      return patch(id, { status: "AI", aiActive: true, assigneeName: null, waitingSince: null });
    },
    async assign(id, body) {
      await pause();
      const to = data.team.find((t) => t.id === body.agentId);
      return patch(id, { assigneeName: to?.name ?? null, department: body.department ?? find(id).department, status: to ? "OPEN" : "WAITING" });
    },
    async close(id) {
      await pause();
      return patch(id, { status: "CLOSED", aiActive: false, waitingSince: null });
    },
    async reopen(id) {
      await pause();
      return patch(id, { status: "OPEN", assigneeName: self.name });
    },
    async typing() {},
    async assist(id) {
      await pause();
      const d = find(id);
      const first = d.visitor.name?.split(" ")[0] ?? "there";
      return {
        summary: d.summary ?? `${d.visitorName} asked: “${d.preview}”`,
        suggestions: [`Hi ${first}, I can see your payment. Confirming it now.`, "Could you send the transaction ID?", "Your Standard plan is active now."],
        sources: [{ title: "Billing, plans and usage", href: null }],
      };
    },
    async rewrite(body) {
      await pause();
      if (body.style === "shorter") return { text: body.text.split(/(?<=[.!?])\s/)[0] ?? body.text };
      if (body.style === "friendlier") return { text: `${body.text.replace(/[.!]?$/, "")} 🙂` };
      if (body.style === "translate") return { text: `[${body.lang ?? "rw"}] ${body.text}` };
      return { text: body.text };
    },
    async liveVisitors() {
      await pause();
      const counts = { waiting: 0, chatting: 0, browsing: 0, idle: 0 };
      for (const v of data.visitors) counts[v.group]++;
      return { items: structuredClone(data.visitors), counts };
    },
    async inviteVisitor(visitorId) {
      await pause();
      const v = data.visitors.find((x) => x.visitorId === visitorId);
      if (v) Object.assign(v, { group: "chatting", conversationId: "c1044" });
      return { conversationId: "c1044" };
    },
    async stats() {
      await pause();
      return structuredClone(data.stats);
    },
    async team() {
      await pause();
      return { agents: structuredClone(data.team) };
    },
    async realtime() {
      // No socket in the preview: the app falls back to re-asking every 15 s.
      throw new Error("No real time in the preview.");
    },
    async addDevice() {
      await pause();
      return { id: "dev-preview" };
    },
    async removeDevice() {},
  };
}
