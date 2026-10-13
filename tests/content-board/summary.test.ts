import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  post: { groupBy: vi.fn(), findMany: vi.fn() },
  business: { findUnique: vi.fn(), updateMany: vi.fn() },
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/team/recipients", () => ({ alertRecipients: vi.fn(async (_b: string, fallback: string) => [fallback]) }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: mail.sendEmail }));

import { selectSummaryPosts, sendContentSummaries, summaryDue, summaryEmail, type SummaryPost } from "@/lib/content-board/summary";

const zone = "Africa/Kigali";
const now = new Date("2026-10-13T07:30:00Z"); // 09:30 in Kigali
const p = (id: string, extra: Partial<SummaryPost> = {}): SummaryPost => ({
  id,
  network: "instagram",
  status: "SCHEDULED",
  text: "Fresh bread",
  title: null,
  scheduledAt: new Date("2026-10-13T16:00:00Z"),
  autoScheduledAt: new Date("2026-10-12T15:00:00Z"),
  productId: "p1",
  campaignId: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.post.groupBy.mockResolvedValue([{ businessId: "b1" }]);
  prisma.business.findUnique.mockResolvedValue({ name: "Sunrise Bakery", timezone: zone, contentSummarySentAt: null, user: { email: "owner@example.com" } });
  prisma.business.updateMany.mockResolvedValue({ count: 1 });
  prisma.post.findMany.mockResolvedValue([p("a")]);
});

describe("summaryDue", () => {
  it("is due from 08:00 local, once per local day", () => {
    expect(summaryDue({ zone, now, lastSentAt: null })).toBe(true);
    expect(summaryDue({ zone, now: new Date("2026-10-13T05:00:00Z"), lastSentAt: null })).toBe(false);
    expect(summaryDue({ zone, now, lastSentAt: new Date("2026-10-13T06:10:00Z") })).toBe(false);
    expect(summaryDue({ zone, now, lastSentAt: new Date("2026-10-12T06:10:00Z") })).toBe(true);
  });
});

describe("selectSummaryPosts", () => {
  it("lists posts auto-scheduled since the last email that still go out or went out, soonest first", () => {
    const posts = [
      p("later", { scheduledAt: new Date("2026-10-15T16:00:00Z") }),
      p("sooner"),
      p("cancelled", { status: "CANCELLED" }),
      p("back-to-review", { status: "PENDING_APPROVAL" }),
      p("old", { autoScheduledAt: new Date("2026-10-11T06:00:00Z") }),
      p("posted", { status: "PUBLISHED", scheduledAt: new Date("2026-10-12T16:00:00Z") }),
      p("manual", { autoScheduledAt: null }),
    ];
    expect(selectSummaryPosts(posts, { now, lastSentAt: new Date("2026-10-12T06:00:00Z") }).map((x) => x.id)).toEqual(["posted", "sooner", "later"]);
  });

  it("looks back one day for the first email", () => {
    expect(selectSummaryPosts([p("a"), p("old", { autoScheduledAt: new Date("2026-10-11T06:00:00Z") })], { now, lastSentAt: null }).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("summaryEmail", () => {
  it("says what was scheduled, when, with a link to each post and to the settings", () => {
    const email = summaryEmail({ businessName: "Sunrise Bakery", zone, posts: [p("a"), p("b", { network: "facebook", productId: null, campaignId: "c1" })] });
    expect(email.subject).toBe("2 posts were scheduled for you");
    expect(email.text).toContain("Instagram, Tue, Oct 13, 6:00 PM: Fresh bread");
    expect(email.text).toContain("/dashboard/content/products/p1?post=a");
    expect(email.text).toContain("/dashboard/content/campaigns/c1?post=b");
    expect(email.text).toContain("/dashboard/content/settings");
    expect(email.html).toContain("change or cancel");
  });
});

describe("sendContentSummaries", () => {
  it("claims the business with compare-and-set, then emails the recipients once", async () => {
    expect(await sendContentSummaries(now)).toEqual({ checked: 1, sent: 1 });
    expect(prisma.business.updateMany).toHaveBeenCalledWith({ where: { id: "b1", contentSummarySentAt: null }, data: { contentSummarySentAt: now } });
    expect(mail.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", subject: "1 post was scheduled for you" }));
  });

  it("sends nothing when another run claimed it first", async () => {
    prisma.business.updateMany.mockResolvedValue({ count: 0 });
    expect((await sendContentSummaries(now)).sent).toBe(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing before 08:00 local, after today's email, or with nothing new", async () => {
    expect((await sendContentSummaries(new Date("2026-10-13T05:00:00Z"))).sent).toBe(0);
    prisma.business.findUnique.mockResolvedValue({ name: "B", timezone: zone, contentSummarySentAt: new Date("2026-10-13T06:30:00Z"), user: { email: "o@example.com" } });
    expect((await sendContentSummaries(now)).sent).toBe(0);
    prisma.business.findUnique.mockResolvedValue({ name: "B", timezone: zone, contentSummarySentAt: null, user: { email: "o@example.com" } });
    prisma.post.findMany.mockResolvedValue([]);
    expect((await sendContentSummaries(now)).sent).toBe(0);
    expect(prisma.business.updateMany).not.toHaveBeenCalled();
  });
});
