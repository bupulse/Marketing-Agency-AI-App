import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  prisma: { contactRequest: { findFirst: vi.fn(), create: vi.fn() }, user: { findUnique: vi.fn() } },
  waitlist: null as null | { launchAt: string; dateLabel: string; shortLabel: string },
  sendWaitlistThankYou: vi.fn(async () => true),
  ensureAccount: vi.fn(async () => true),
  allowGoogleSignIn: vi.fn(async () => true),
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/waitlist-server", () => ({ getWaitlist: async () => m.waitlist, signupsClosed: async () => m.waitlist !== null }));
vi.mock("@/lib/waitlist-email", () => ({ sendWaitlistThankYou: m.sendWaitlistThankYou }));
vi.mock("@/lib/request-limits", () => ({ publicLimited: async () => null }));
vi.mock("@/lib/lead-alerts/channels", () => ({ alertInBackground: async () => {} }));
vi.mock("@/lib/lead-alerts/reminders", () => ({ scheduleLeadReminder: async () => {} }));
vi.mock("@/lib/errors", () => ({ logError: async () => {} }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://bupulse.com" }));
vi.mock("@/lib/links/service", () => ({ currentTrackedLinkId: async () => null, linkTagFor: async () => null }));
vi.mock("@/lib/account", () => ({ ensureAccount: m.ensureAccount, allowGoogleSignIn: m.allowGoogleSignIn }));

import { submitQuoteRequest } from "@/lib/quote/submit";
import { afterGoogleSignIn } from "@/lib/auth/after-google";

const ON = { launchAt: "2026-12-14T22:00:00.000Z", dateLabel: "15 December", shortLabel: "15 Dec" };

const form = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ name: "Test Person", phone: "0788 123 456", email: "test@example.com", businessName: "Sample Shop", source: "website", pageUrl: "/" })) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.waitlist = null;
  m.prisma.contactRequest.findFirst.mockResolvedValue(null);
  m.prisma.contactRequest.create.mockResolvedValue({ id: "q1", createdAt: new Date() });
});

describe("quote requests and the waiting list", () => {
  it("sends the thank-you email while the waiting list is on", async () => {
    m.waitlist = ON;
    expect((await submitQuoteRequest(form())).status).toBe("success");
    await vi.waitFor(() => expect(m.sendWaitlistThankYou).toHaveBeenCalledWith("test@example.com", "Test", ON));
  });

  it("sends no email while it is off", async () => {
    await submitQuoteRequest(form());
    await new Promise((r) => setTimeout(r, 10));
    expect(m.sendWaitlistThankYou).not.toHaveBeenCalled();
  });
});

describe("Google sign-in and the waiting list", () => {
  const supabase = { auth: { signOut: vi.fn(async () => {}) } };
  const user = { id: "u1", email: "new@example.com" } as never;

  it("signs a new person out and shows the waiting list instead of creating an account", async () => {
    m.waitlist = ON;
    m.prisma.user.findUnique.mockResolvedValue(null);
    const res = await afterGoogleSignIn(supabase, user, "https://bupulse.com", "/dashboard", null);
    expect(res.headers.get("location")).toBe("https://bupulse.com/signup?waitlist=google");
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(m.ensureAccount).not.toHaveBeenCalled();
  });

  it("lets an existing account sign in as usual", async () => {
    m.waitlist = ON;
    m.prisma.user.findUnique.mockResolvedValue({ id: "u1" });
    const res = await afterGoogleSignIn(supabase, user, "https://bupulse.com", "/dashboard", null);
    expect(res.headers.get("location")).toBe("https://bupulse.com/dashboard");
    expect(m.ensureAccount).toHaveBeenCalled();
  });

  it("creates accounts normally while the list is off", async () => {
    await afterGoogleSignIn(supabase, user, "https://bupulse.com", "/dashboard", null);
    expect(m.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(m.ensureAccount).toHaveBeenCalled();
  });
});
