import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: { contactRequest: { findFirst: vi.fn(), create: vi.fn() } },
  publicLimited: vi.fn<(kind: string, email?: string | null) => Promise<string | null>>(async () => null),
  alertInBackground: vi.fn(async () => {}),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/request-limits", () => ({ publicLimited: m.publicLimited }));
vi.mock("@/lib/lead-alerts/channels", () => ({ alertInBackground: m.alertInBackground }));
vi.mock("@/lib/errors", () => ({ logError: m.logError }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://test.bupulse.com" }));

import { submitQuoteRequest } from "@/lib/quote/submit";

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const values = { name: "Test Person", phone: "0788 123 456", email: "test@example.com", businessName: "Sample Shop Ltd", note: "Shoes and bags.", source: "ig", pageUrl: "/pricing", ...over };
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.contactRequest.findFirst.mockResolvedValue(null);
  m.prisma.contactRequest.create.mockResolvedValue({ createdAt: new Date("2026-10-31T12:05:00Z") });
});

describe("submitQuoteRequest", () => {
  it("stores the request as a quote with an E.164 number, then alerts the owner", async () => {
    expect(await submitQuoteRequest(form())).toEqual({ status: "success", firstName: "Test" });
    expect(m.prisma.contactRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { kind: "quote", name: "Test Person", email: "test@example.com", phone: "+250788123456", businessName: "Sample Shop Ltd", message: "Shoes and bags.", source: "instagram", pageUrl: "/pricing" } }),
    );
    expect(m.publicLimited).toHaveBeenCalledWith("quote", "test@example.com");
    expect(m.alertInBackground).toHaveBeenCalledTimes(1);
    expect(m.alertInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "quote", phone: "+250788123456", company: "Sample Shop Ltd", source: "instagram", page: "https://test.bupulse.com/pricing", openUrl: "https://test.bupulse.com/admin/quotes" }),
      "quote lead alert",
    );
  });

  it("stores no message when the note is left empty", async () => {
    await submitQuoteRequest(form({ note: "" }));
    expect(m.prisma.contactRequest.create.mock.calls[0][0].data.message).toBeNull();
  });

  it("pretends to succeed for a bot that fills the honeypot, and stores nothing", async () => {
    const f = form();
    f.set("website", "http://spam.example");
    expect(await submitQuoteRequest(f)).toEqual({ status: "success" });
    expect(m.prisma.contactRequest.create).not.toHaveBeenCalled();
    expect(m.alertInBackground).not.toHaveBeenCalled();
  });

  it("gives the errors per field and keeps what was typed", async () => {
    const r = await submitQuoteRequest(form({ phone: "123", email: "nope", businessName: "" }));
    expect(r.status).toBe("error");
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(["businessName", "email", "phone"]);
    expect(r.values).toMatchObject({ name: "Test Person", phone: "123" });
    expect(m.prisma.contactRequest.create).not.toHaveBeenCalled();
  });

  it("stops at the rate limit", async () => {
    m.publicLimited.mockResolvedValueOnce("Too many requests. Please try again in a few minutes.");
    const r = await submitQuoteRequest(form());
    expect(r).toMatchObject({ status: "error", errors: { form: expect.stringContaining("Too many") } });
    expect(m.prisma.contactRequest.create).not.toHaveBeenCalled();
  });

  it("stores and alerts once when the same person sends twice within a minute", async () => {
    m.prisma.contactRequest.findFirst.mockResolvedValueOnce({ id: "cq1" });
    expect((await submitQuoteRequest(form())).status).toBe("success");
    expect(m.prisma.contactRequest.create).not.toHaveBeenCalled();
    expect(m.alertInBackground).not.toHaveBeenCalled();
  });

  it("logs a database failure and asks to try again", async () => {
    m.prisma.contactRequest.create.mockRejectedValueOnce(new Error("db down"));
    const r = await submitQuoteRequest(form());
    expect(r).toMatchObject({ status: "error", errors: { form: expect.stringContaining("try again") } });
    expect(m.logError).toHaveBeenCalledWith(expect.any(Error), { source: "quote.submit" });
  });
});
