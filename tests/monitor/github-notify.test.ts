import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  isServiceEnabled: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  sendEmail: vi.fn(async () => true),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/admin/auth", () => ({ adminEmails: () => ["owner@example.com"] }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: m.isServiceEnabled }));
vi.mock("@/lib/errors", () => ({ logError: m.logError }));
vi.mock("@/lib/publishing/email", async (orig) => ({ ...(await orig<typeof import("@/lib/publishing/email")>()), sendEmail: m.sendEmail }));
vi.mock("@/lib/support/alerts", () => ({ supportAppUrl: (path: string) => `https://support.example.com${path}` }));
vi.mock("@/lib/lead-alerts/telegram-settings", () => ({
  readTelegramChat: async () => ({ chatId: "42", name: "Test Owner", connectedAt: "" }),
  resolveTelegramToken: async () => "123456789:AAtest_placeholder_token_000000000000",
}));

import { sendLeadAlert, telegramChannel, type AlertChannel } from "@/lib/lead-alerts/channels";
import type { LeadAlert } from "@/lib/lead-alerts/format";
import { telegramRetry } from "@/lib/lead-alerts/telegram";
import { sendOwnerAlert } from "@/lib/monitor/alerts";
import { githubNotifyRetry, leadBackupText, notifyOwnerViaGithub, publicSafe, resetGithubNotifyWarning } from "@/lib/monitor/github-notify";

const GH = "github_pat_placeholder_0000000000";
const DISPATCH = "https://api.github.com/repos/bupulse/Marketing-Agency-AI-App/actions/workflows/notify-owner.yml/dispatches";

// Placeholder personal data: none of it may ever reach the public repository's workflow inputs.
const PRIVATE = ["Test Person", "+250788123456", "788123456", "test@example.com", "Sample Shop Ltd", "Call me about Instagram ads", "https://test.bupulse.com", "cuid_abc123"];
const lead: LeadAlert = {
  kind: "quote",
  name: "Test Person",
  phone: "+250788123456",
  email: "test@example.com",
  company: "Sample Shop Ltd",
  note: "Call me about Instagram ads",
  source: "instagram",
  page: "https://test.bupulse.com/quote",
  link: "https://test.bupulse.com/l/cuid_abc123",
  at: new Date("2026-11-18T09:00:00Z"),
  openUrl: "https://test.bupulse.com/admin/quotes?id=cuid_abc123",
  calledUrl: "https://test.bupulse.com/api/quotes/called?id=cuid_abc123&sig=x",
};

const expectNoPrivate = (text: string) => {
  for (const p of PRIVATE) expect(text, p).not.toContain(p);
};

type Call = [string, RequestInit];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetGithubNotifyWarning();
  githubNotifyRetry.delayMs = 0;
  telegramRetry.delaysMs = [0, 0];
  process.env.RESEND_API_KEY = "re_placeholder";
  process.env.GITHUB_NOTIFY_TOKEN = GH;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the public backup text", () => {
  it("a lead alert with a name, phone, email, company, note and links gives a text without any of them", () => {
    for (const kind of ["quote", "contact", "support_chat", "support_waiting"] as const) {
      const text = leadBackupText({ ...lead, kind, chat: { number: 12, reason: "asked for a person", away: true } });
      expect(text.length).toBeGreaterThan(10);
      expectNoPrivate(text);
      expect(publicSafe(text)).toBe(text);
    }
    expect(leadBackupText(lead)).toBe("New quote request waiting. Open Admin -> Quote requests.");
    expect(leadBackupText({ ...lead, reminder: { n: 2, of: 3 } })).toBe("Reminder 2 of 3: a quote request still waits for a call. Open Admin -> Quote requests.");
  });

  it("publicSafe strips links, email addresses and phone numbers on top, and keeps counts and minutes", () => {
    expect(publicSafe("Call +250 788 123 456 or 0788-123-456, mail test@example.com, see https://bupulse.com/admin/quotes?id=1")).toBe("Call or , mail see");
    expect(publicSafe("Site alert: bupulse.com was down about 12 minutes (back up now).")).toBe("Site alert: bupulse.com was down about 12 minutes (back up now).");
    expect(publicSafe("x".repeat(500))).toHaveLength(200);
  });
});

describe("notifyOwnerViaGithub", () => {
  it("starts notify-owner.yml on main with the text, and 204 is sent", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await notifyOwnerViaGithub("New quote request waiting.", { GITHUB_NOTIFY_TOKEN: GH }, fetchMock)).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe(DISPATCH);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: `Bearer ${GH}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" });
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main", inputs: { text: "New quote request waiting." } });
  });

  it("is skipped quietly without a token (one console line per server start), without calling GitHub", async () => {
    const fetchMock = vi.fn();
    expect(await notifyOwnerViaGithub("x y z", {}, fetchMock)).toBe("skipped");
    expect(await notifyOwnerViaGithub("x y z", { GITHUB_NOTIFY_TOKEN: " " }, fetchMock)).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("retries once after a timeout or a 5xx, not after a refusal, and never throws", async () => {
    const timeout = () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const flaky = vi.fn().mockImplementationOnce(timeout).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await notifyOwnerViaGithub("hello there", { GITHUB_NOTIFY_TOKEN: GH }, flaky)).toBe("sent");
    expect(flaky).toHaveBeenCalledTimes(2);

    const down = vi.fn(timeout);
    expect(await notifyOwnerViaGithub("hello there", { GITHUB_NOTIFY_TOKEN: GH }, down)).toBe("failed");
    expect(down).toHaveBeenCalledTimes(2);

    const busy = vi.fn(async () => new Response(null, { status: 502 }));
    expect(await notifyOwnerViaGithub("hello there", { GITHUB_NOTIFY_TOKEN: GH }, busy)).toBe("failed");
    expect(busy).toHaveBeenCalledTimes(2);

    const refused = vi.fn(async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }));
    expect(await notifyOwnerViaGithub("hello there", { GITHUB_NOTIFY_TOKEN: GH }, refused)).toBe("failed");
    expect(refused).toHaveBeenCalledTimes(1);
  });
});

describe("lead alerts fall back to GitHub when Telegram fails", () => {
  const email: AlertChannel = { id: "email", send: vi.fn(async () => "sent" as const) };

  it("Telegram timing out sends the generic text through GitHub, never the lead's details", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://api.telegram.org")) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await sendLeadAlert(lead, [email, telegramChannel]);
    expect(out).toEqual({ email: "sent", telegram: "failed", github: "sent" });
    const gh = (fetchMock.mock.calls as unknown as Call[]).filter(([url]) => url === DISPATCH);
    expect(gh).toHaveLength(1);
    const body = String(gh[0][1].body);
    expectNoPrivate(body);
    expect(JSON.parse(body).inputs.text).toBe("New quote request waiting. Open Admin -> Quote requests.");
  });

  it("a GitHub backup that went out counts as reaching the owner; one that failed is logged", async () => {
    const broken: AlertChannel = { id: "telegram", send: vi.fn(async () => { throw new Error("Telegram did not answer in time."); }) };
    const off: AlertChannel = { id: "email", send: vi.fn(async () => "skipped" as const) };
    expect(await sendLeadAlert(lead, [off, broken], {}, async () => "sent")).toEqual({ email: "skipped", telegram: "failed", github: "sent" });
    expect(m.logError).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("reached nobody") }), expect.anything());
    m.logError.mockClear();
    expect(await sendLeadAlert(lead, [off, broken], {}, async () => "failed")).toEqual({ email: "skipped", telegram: "failed", github: "failed" });
    expect(m.logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("GitHub backup") }), expect.objectContaining({ source: "lead-alerts.github" }));
  });

  it("no backup when Telegram sent it or is not set up", async () => {
    const backup = vi.fn(async () => "sent" as const);
    const sent: AlertChannel = { id: "telegram", send: vi.fn(async () => "sent" as const) };
    const skipped: AlertChannel = { id: "telegram", send: vi.fn(async () => "skipped" as const) };
    expect(await sendLeadAlert(lead, [sent], {}, backup)).toEqual({ telegram: "sent" });
    expect(await sendLeadAlert(lead, [skipped], { quietIfNone: true }, backup)).toEqual({ telegram: "skipped" });
    expect(backup).not.toHaveBeenCalled();
  });
});

describe("owner alerts fall back to GitHub when Telegram fails", () => {
  const alert = {
    subject: "Warning: possible crypto-miner on the server PC (dlIhost)",
    heading: "Possible crypto-miner",
    line: "found dlIhost in C:\\Users\\WECPC015\\AppData\\Roaming\\DLL",
    emoji: "🚨",
    backupText: "Security alert on the server PC (1 finding). Details by email and on the support app's Server page.",
  };

  it("sends the backup text (not the line) and reports the github channel", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.startsWith("https://api.telegram.org") ? Promise.reject(new TypeError("fetch failed")) : new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendOwnerAlert(alert)).toEqual({ email: "sent", telegram: "failed", github: "sent" });
    const gh = (fetchMock.mock.calls as unknown as Call[]).filter(([url]) => url === DISPATCH);
    expect(JSON.parse(String(gh[0][1].body)).inputs.text).toBe(alert.backupText);
    expect(String(gh[0][1].body)).not.toContain("WECPC015");
  });

  it("keeps the old outcomes when Telegram delivered", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendOwnerAlert(alert)).toEqual({ email: "sent", telegram: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
