import { beforeEach, describe, expect, it, vi } from "vitest";

// The Contact and Done-for-you forms alert the owner like a quote request does (they had no alert before).

const m = vi.hoisted(() => ({
  alertInBackground: vi.fn(async () => {}),
  findFirst: vi.fn(async () => null as { id: string } | null),
  create: vi.fn(async () => ({ createdAt: new Date("2026-11-09T08:00:00Z") })),
}));

vi.mock("@/lib/db", () => ({ prisma: { contactRequest: { findFirst: m.findFirst, create: m.create } } }));
vi.mock("@/lib/lead-alerts/channels", () => ({ alertInBackground: m.alertInBackground }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://test.bupulse.com" }));
vi.mock("@/lib/request-limits", () => ({ publicLimited: vi.fn(async () => null) }));

import { contactAlert, submitContactRequest } from "@/lib/contact";

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ kind: "done_for_you", name: "Test Person", email: "test@example.com", phone: "0788 000 000", businessName: "Sample Shop Ltd", industry: "Retail", message: "Please run our social pages.", ...over })) f.set(k, v);
  return f;
};

beforeEach(() => vi.clearAllMocks());

describe("contact alerts", () => {
  it("carry the form, the phone as E.164 and the message", () => {
    const a = contactAlert({ kind: "contact", name: "Test Person", email: "test@example.com", phone: "0788 000 000", businessName: undefined, industry: undefined, message: "Hello there team" }, new Date());
    expect(a).toMatchObject({ kind: "contact", source: "contact", phone: "+250788000000", company: null, note: "Hello there team", page: "https://test.bupulse.com/contact", openUrl: null });
  });

  it("go out once for a stored request", async () => {
    expect(await submitContactRequest(form())).toEqual({ status: "success" });
    expect(m.alertInBackground).toHaveBeenCalledTimes(1);
    expect(m.alertInBackground).toHaveBeenCalledWith(expect.objectContaining({ kind: "contact", source: "done_for_you", note: "Industry: Retail\nPlease run our social pages.", page: "https://test.bupulse.com/done-for-you" }), "contact lead alert");
  });

  it("not for a repeat within a minute, nor for the honeypot", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "r1" });
    await submitContactRequest(form());
    await submitContactRequest(form({ website: "spam" }));
    expect(m.alertInBackground).not.toHaveBeenCalled();
  });
});
