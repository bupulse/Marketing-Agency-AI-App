import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  adminEmails: vi.fn(() => ["owner@example.com", "staff@example.com"]),
  isServiceEnabled: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  sendEmail: vi.fn<(email: { to: string; subject: string; html: string; text: string }) => Promise<boolean>>(async () => true),
  logError: vi.fn(async () => {}),
  readTelegramChat: vi.fn(async () => ({ chatId: "42", name: "Test Owner", connectedAt: "" }) as { chatId: string; name: string; connectedAt: string } | null),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/admin/auth", () => ({ adminEmails: m.adminEmails }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: m.isServiceEnabled }));
vi.mock("@/lib/errors", () => ({ logError: m.logError }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: m.sendEmail }));
vi.mock("@/lib/lead-alerts/telegram-settings", () => ({ readTelegramChat: m.readTelegramChat }));

import { emailChannel, sendLeadAlert, telegramChannel, type AlertChannel } from "@/lib/lead-alerts/channels";
import type { LeadAlert } from "@/lib/lead-alerts/format";

const TOKEN = "123456789:AAtest_placeholder_token_000000000000";
const alert: LeadAlert = {
  kind: "quote",
  name: "Test Person",
  phone: "+250788123456",
  email: "test@example.com",
  company: "Sample Shop Ltd",
  note: null,
  source: "facebook",
  page: null,
  at: new Date("2026-10-31T12:05:00Z"),
  openUrl: "https://test.bupulse.com/admin/quotes",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env.RESEND_API_KEY = "re_placeholder";
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe("sendLeadAlert", () => {
  it("runs every channel, and a failing one is logged without stopping the others", async () => {
    const ok: AlertChannel = { id: "ok", send: vi.fn(async () => "sent" as const) };
    const off: AlertChannel = { id: "off", send: vi.fn(async () => "skipped" as const) };
    const broken: AlertChannel = { id: "phone", send: vi.fn(async () => { throw new Error("provider down"); }) };
    const out = await sendLeadAlert(alert, [ok, broken, off]);
    expect(out).toEqual({ ok: "sent", phone: "failed", off: "skipped" });
    expect(m.logError).toHaveBeenCalledWith(expect.objectContaining({ message: "provider down" }), expect.objectContaining({ source: "lead-alerts.phone" }));
  });
});

describe("the email channel", () => {
  it("emails every admin with the subject and the call and WhatsApp links", async () => {
    expect(await emailChannel.send(alert)).toBe("sent");
    expect(m.sendEmail).toHaveBeenCalledTimes(2);
    const email = m.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("owner@example.com");
    expect(email.subject).toBe("New quote request: Sample Shop Ltd — call Test Person now");
    expect(email.html).toContain('href="tel:+250788123456"');
    expect(email.html).toContain('href="https://wa.me/250788123456"');
    expect(email.text).toContain("Kigali time");
  });

  it("is skipped without admin addresses, without Resend or when Resend is switched off", async () => {
    m.adminEmails.mockReturnValueOnce([]);
    expect(await emailChannel.send(alert)).toBe("skipped");
    delete process.env.RESEND_API_KEY;
    expect(await emailChannel.send(alert)).toBe("skipped");
    process.env.RESEND_API_KEY = "re_placeholder";
    m.isServiceEnabled.mockResolvedValueOnce(false);
    expect(await emailChannel.send(alert)).toBe("skipped");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("fails (and is logged by sendLeadAlert) when no email went out", async () => {
    m.sendEmail.mockResolvedValue(false);
    await expect(emailChannel.send(alert)).rejects.toThrow(/no lead alert email/);
    m.sendEmail.mockResolvedValue(true);
  });
});

describe("the Telegram channel", () => {
  it("is skipped without a token, without calling Telegram", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await telegramChannel.send(alert)).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is skipped when no chat is connected or the service is switched off", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    m.readTelegramChat.mockResolvedValueOnce(null);
    expect(await telegramChannel.send(alert)).toBe("skipped");
    m.isServiceEnabled.mockResolvedValueOnce(false);
    expect(await telegramChannel.send(alert)).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the alert to the connected chat", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await telegramChannel.send(alert)).toBe("sent");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.chat_id).toBe("42");
    expect(body.text).toContain("call Test Person now");
  });

  it("throws on a refusal, so the failure is logged", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), { status: 403 })));
    await expect(telegramChannel.send(alert)).rejects.toThrow(/blocked/);
  });
});
