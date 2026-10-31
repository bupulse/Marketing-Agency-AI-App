import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  scheduleJob: vi.fn(async () => ({})),
  cancelJob: vi.fn(async () => {}),
  send: vi.fn(async () => "sent" as const),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { contactRequest: { findUnique: m.findUnique } } }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: m.scheduleJob, cancelJob: m.cancelJob, registerJobHandler: vi.fn() }));
vi.mock("./../../lib/lead-alerts/channels", () => ({ telegramChannel: { id: "telegram", send: m.send } }));
vi.mock("@/lib/lead-alerts/channels", () => ({ telegramChannel: { id: "telegram", send: m.send } }));
vi.mock("@/lib/auth/site-url", () => ({ publicSiteUrl: () => "https://test.bupulse.com" }));

import { REMINDERS, reminderAlert, runLeadReminder, scheduleLeadReminder } from "@/lib/lead-alerts/reminders";
import { telegramButtons, telegramText, type LeadAlert } from "@/lib/lead-alerts/format";

const row = { id: "cq_test_1234567", kind: "quote", handled: false, name: "Test Person", phone: "+250788000000", email: "test@example.com", businessName: "Sample Shop Ltd", message: "Hello", source: "instagram", pageUrl: "/quote", createdAt: new Date("2026-10-31T12:05:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
});

describe("lead reminders", () => {
  it("are planned 2 minutes ahead, one pending per request", async () => {
    await scheduleLeadReminder("cq_1", 1, new Date("2026-10-31T12:00:00Z"));
    expect(m.scheduleJob).toHaveBeenCalledWith({ kind: "lead.reminder", runAt: new Date("2026-10-31T12:02:00Z"), payload: { quoteId: "cq_1", n: 1 }, dedupeKey: "lead.reminder:cq_1" });
  });

  it("buzz Telegram and plan the next one while the request is not called", async () => {
    m.findUnique.mockResolvedValueOnce(row);
    expect(await runLeadReminder({ quoteId: row.id, n: 2 })).toBe("sent");
    const alert = (m.send.mock.calls[0] as unknown as [LeadAlert])[0];
    expect(telegramText(alert).split("\n")[0]).toBe("⏰ <b>Still waiting (2 of 5): call Test Person from Sample Shop Ltd</b>");
    expect(m.scheduleJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { quoteId: row.id, n: 3 } }));
  });

  it("stop after the last one, once called, or when the request is gone", async () => {
    m.findUnique.mockResolvedValueOnce(row);
    expect(await runLeadReminder({ quoteId: row.id, n: REMINDERS })).toBe("sent");
    expect(m.scheduleJob).not.toHaveBeenCalled();
    m.findUnique.mockResolvedValueOnce({ ...row, handled: true });
    expect(await runLeadReminder({ quoteId: row.id, n: 1 })).toBe("done");
    m.findUnique.mockResolvedValueOnce(null);
    expect(await runLeadReminder({ quoteId: row.id, n: 1 })).toBe("done");
    expect(await runLeadReminder({ nonsense: true })).toBe("done");
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it("carry a signed Called button that stops them", () => {
    const buttons = telegramButtons(reminderAlert(row, 1), "https://test.bupulse.com").flat();
    const called = buttons.find((b) => b.text.startsWith("✅ Called"));
    expect(called?.url).toMatch(/^https:\/\/test\.bupulse\.com\/called\/cq_test_1234567\?t=[\w-]{32}$/);
  });
});
