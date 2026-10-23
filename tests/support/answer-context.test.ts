import { beforeEach, describe, expect, it, vi } from "vitest";

// Who is asking decides what the AI may say: a signed-in client gets answers about THEIR account (plan, trial days
// left) and never a sign-up answer or button, wherever they ask from. And the "from the guide" line names each page once.

const m = vi.hoisted(() => ({
  prisma: {
    supportConversation: { findUnique: vi.fn(), update: vi.fn() },
    supportMessage: { findMany: vi.fn(), create: vi.fn() },
  },
  generateReply: vi.fn(),
  accountFacts: vi.fn(),
  searchGuide: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue(undefined), RateLimitError: class extends Error {} }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: vi.fn(), registerJobHandler: vi.fn() }));
vi.mock("@/lib/ai/ledger", () => ({ withLedger: vi.fn() }));
vi.mock("@/lib/support/realtime", () => ({ broadcast: vi.fn() }));
vi.mock("@/lib/support/handover", () => ({ handOver: vi.fn(), handoverText: vi.fn(() => "A person will reply.") }));
vi.mock("@/lib/support/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/support/settings")>()), getSupportSettings: vi.fn(async () => (await orig<typeof import("@/lib/support/settings")>()).DEFAULT_SUPPORT_SETTINGS) }));
vi.mock("@/lib/support/facts", () => ({ accountFacts: m.accountFacts, factsContext: vi.fn(() => "Plan: Business (trial)\nTrial days left: 2"), pricingContext: vi.fn(async () => "- Business: 50,000 RWF a month") }));
vi.mock("@/lib/support/guide", () => ({ ensureGuideIndexed: vi.fn(), guideMap: vi.fn(async () => [{ title: "Billing, plans and usage", page: "/dashboard/billing" }]), searchGuide: m.searchGuide }));
vi.mock("@/lib/support/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/support/ai")>()), generateReply: m.generateReply }));

import { buildReplySystem, cleanReply, type AiReply, type ReplyContext } from "@/lib/support/ai";
import { answerVisitor } from "@/lib/support/answer";
import { allowedPagesFor, personOf } from "@/lib/support/rules";
import { pageSources, shortGuideTitle } from "@/lib/support/sources";

const section = (file: string, title: string, heading: string, page: string | null = null) => ({ id: `${file}#${heading}`, file, title, heading, anchor: heading, page, body: "…" });
const GUIDE = [
  section("02-sign-up.md", "Sign-up, onboarding and account states", "Limits and settings", "/signup"),
  section("02-sign-up.md", "Sign-up, onboarding and account states", "What you see", "/signup"),
  section("17-billing.md", "Billing, plans and usage", "Overview", "/dashboard/billing"),
  section("23-pricing.md", "Pricing page: the plan quiz and paying by Mobile Money", "What the visitor sees", "/pricing"),
];

const aiReply = (over: Partial<AiReply> = {}): AiReply => ({
  reply: "Your free trial is on: 2 days left.", language: "en", confident: true, handover: "none", sales: true, department: "sales", urgency: "none",
  leadSignal: "warm", note: "", topics: [], sources: [1, 2, 3], actions: [], ...over,
});

describe("the guide sources line", () => {
  it("shortens page titles", () => {
    expect(shortGuideTitle("Sign-up, onboarding and account states")).toBe("Sign-up");
    expect(shortGuideTitle("Pricing page: the plan quiz and paying by Mobile Money")).toBe("Pricing page");
    expect(shortGuideTitle("Social connections (Channels)")).toBe("Social connections");
    expect(shortGuideTitle("Autopilot")).toBe("Autopilot");
  });

  it("names each page once, at most two, in the order cited", () => {
    expect(pageSources(GUIDE)).toEqual([
      { title: "Sign-up", href: "/signup" },
      { title: "Billing", href: "/dashboard/billing" },
    ]);
    expect(pageSources([])).toEqual([]);
  });
});

describe("who is asking", () => {
  it("tells clients, creators and possible customers apart", () => {
    expect(personOf({ userId: "u1", businessId: "b1", creatorProfileId: null })).toBe("client");
    expect(personOf({ userId: "u1", businessId: null, creatorProfileId: "cp1" })).toBe("creator");
    expect(personOf({ userId: null, businessId: "b1", creatorProfileId: null })).toBe("prospect");
    expect(personOf({ userId: null, businessId: null, creatorProfileId: null })).toBe("prospect");
  });

  it("never offers sign-up, log-in or start-trial pages to someone signed in", () => {
    const pages = ["/pricing", "/signup", "/login", "/start-trial", "/dashboard/billing", "/signup"];
    expect(allowedPagesFor("client", pages)).toEqual(["/pricing", "/dashboard/billing"]);
    expect(allowedPagesFor("creator", pages)).toEqual(["/pricing", "/dashboard/billing"]);
    expect(allowedPagesFor("prospect", pages)).toEqual(["/pricing", "/signup", "/login", "/start-trial", "/dashboard/billing"]);
  });

  it("drops a sign-up button the AI adds anyway", () => {
    const allowed = allowedPagesFor("client", ["/signup", "/dashboard/billing"]);
    const cleaned = cleanReply(aiReply({ actions: [{ label: "Sign up", href: "/signup" }, { label: "Open Billing", href: "/dashboard/billing" }] }), 0, allowed);
    expect(cleaned.actions).toEqual([{ label: "Open Billing", href: "/dashboard/billing" }]);
  });

  it("the prompt tells the AI a signed-in client is not to be sent to sign up", () => {
    const base: ReplyContext = { surface: "public", history: [], guide: [], guideMap: [], pricing: null, account: "Plan: Business (trial)", hoursLine: "", aiRules: "", handoverTopics: [], allowedPages: allowedPagesFor("client", ["/pricing", "/signup"]), visitorName: null, person: "client" };
    const client = buildReplySystem(base);
    expect(client).toContain("signed-in BuPulse client");
    expect(client).toContain("Never tell them to sign up");
    expect(client).not.toContain("is not signed in: a possible customer");
    expect(client.split("ALLOWED PAGES\n").pop()).not.toContain("/signup");
    const prospect = buildReplySystem({ ...base, person: "prospect", account: null, allowedPages: ["/pricing", "/signup"] });
    expect(prospect).toContain("is not signed in: a possible customer");
    expect(prospect.split("ALLOWED PAGES\n").pop()).toContain("/signup");
  });
});

describe("answerVisitor for a signed-in client", () => {
  const conversation = (visitor: Record<string, unknown>, surface = "public") => ({
    id: "c1", status: "AI", aiActive: true, surface, tags: [], language: null, departmentId: null,
    visitor: { userId: null, name: "Aline", email: "visitor@example.com", phone: null, businessName: "Sample Shop Ltd", businessId: null, creatorProfileId: null, ...visitor },
    visit: { country: "RW" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    m.prisma.supportMessage.findMany.mockResolvedValue([{ author: "VISITOR", kind: "TEXT", body: "How does the trial work?", attachment: null }]);
    m.prisma.supportMessage.create.mockResolvedValue({ id: "m2" });
    m.prisma.supportConversation.update.mockResolvedValue({});
    m.accountFacts.mockResolvedValue({ planStatus: "trial" });
    m.searchGuide.mockResolvedValue(GUIDE);
    m.generateReply.mockResolvedValue(aiReply());
  });

  it("on the public site, reads their account and keeps sign-up pages out", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(conversation({ userId: "u1", businessId: "b1" }));
    await answerVisitor("c1", { ipHash: "h" });
    expect(m.accountFacts).toHaveBeenCalledWith("b1", expect.any(Date));
    const ctx = m.generateReply.mock.calls[0][0] as ReplyContext;
    expect(ctx.person).toBe("client");
    expect(ctx.account).toContain("Trial days left");
    expect(ctx.allowedPages).not.toContain("/signup");
    expect(ctx.allowedPages).not.toContain("/login");
    // The sources line: Sign-up once (not once per section), then Billing.
    expect(m.prisma.supportMessage.create.mock.calls[0][0].data.aiSources).toEqual([
      { title: "Sign-up", href: "/signup" },
      { title: "Billing", href: "/dashboard/billing" },
    ]);
  });

  it("a visitor who is not signed in is a possible customer: no account facts, sign-up allowed", async () => {
    m.prisma.supportConversation.findUnique.mockResolvedValue(conversation({}));
    await answerVisitor("c1", { ipHash: "h" });
    expect(m.accountFacts).not.toHaveBeenCalled();
    const ctx = m.generateReply.mock.calls[0][0] as ReplyContext;
    expect(ctx.person).toBe("prospect");
    expect(ctx.account).toBeNull();
    expect(ctx.allowedPages).toContain("/signup");
  });
});
