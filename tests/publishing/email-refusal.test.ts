import { beforeEach, describe, expect, it, vi } from "vitest";

// Why Resend refused an email reaches Admin -> Errors (and the Resend card in Services), not only the server log.

const m = vi.hoisted(() => ({ logError: vi.fn(async () => {}), recordServiceUse: vi.fn(async () => {}) }));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/errors", () => ({ logError: m.logError }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/admin/usage-counter", () => ({ recordServiceUse: m.recordServiceUse }));

import { refusalMessage, sendEmail } from "@/lib/publishing/email";

const email = { to: "someone@example.com", subject: "Hello", html: "<p>hi</p>", text: "hi" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env.RESEND_API_KEY = "re_placeholder";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("refusalMessage", () => {
  it("names Resend's error and keeps only the domain of an address", () => {
    expect(refusalMessage(403, JSON.stringify({ statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (owner@example.com)." }))).toBe(
      "Resend refused an email (403 validation_error): You can only send testing emails to your own email address (o***@example.com).",
    );
    expect(refusalMessage(429, JSON.stringify({ name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }))).toMatch(/^Resend refused an email \(429 daily_quota_exceeded\)/);
    expect(refusalMessage(500, "")).toBe("Resend refused an email (500): no details");
  });
});

describe("sendEmail", () => {
  it("logs a refusal as a warning and counts it as refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "Too many requests." }), { status: 429 })));
    expect(await sendEmail(email)).toBe(false);
    expect(m.logError).toHaveBeenCalledWith(expect.objectContaining({ message: "Resend refused an email (429 rate_limit_exceeded): Too many requests." }), expect.objectContaining({ source: "email.resend", level: "warn", subject: "Hello" }));
    expect(m.recordServiceUse).toHaveBeenCalledWith("resend", false);
  });

  it("logs when Resend cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND api.resend.com"); }));
    expect(await sendEmail(email)).toBe(false);
    expect(m.logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("could not be reached") }), expect.objectContaining({ source: "email.resend" }));
  });

  it("logs nothing when it is sent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "e1" }))));
    expect(await sendEmail(email)).toBe(true);
    expect(m.logError).not.toHaveBeenCalled();
  });
});
