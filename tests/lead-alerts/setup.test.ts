import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/admin/service", () => ({ APPROVAL_TTL_MS: 7 * 86_400_000 }));

import { alertSetupIssues, type AlertSetup } from "@/lib/lead-alerts/setup";
import { evaluateHealth, type Queues } from "@/lib/admin/health";

const ready: AlertSetup = { email: { enabled: true, hasKey: true, recipients: 1 }, telegram: { enabled: true, hasToken: true, chatConnected: true } };
const queues: Queues = { postsOverdue: 0, postsStuck: 0, needsAction: 0, webhookPending: 0, webhookFailed24h: 0, webhookTotal24h: 0, pendingApprovals: 0, oldestApprovalHours: null };

describe("alert setup issues (Admin -> Health)", () => {
  it("none when email and Telegram can both send", () => {
    expect(alertSetupIssues(ready)).toEqual([]);
  });

  it("Telegram on without a bot token: a warning pointing at the Telegram card in Services", () => {
    const [issue] = alertSetupIssues({ ...ready, telegram: { enabled: true, hasToken: false, chatConnected: false } });
    expect(issue).toMatchObject({ level: "warning", key: "alerts:telegram", href: "/admin/services" });
    expect(issue.text).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("a token but no connected chat: a warning pointing at Settings, Lead alerts", () => {
    const [issue] = alertSetupIssues({ ...ready, telegram: { enabled: true, hasToken: true, chatConnected: false } });
    expect(issue).toMatchObject({ level: "warning", href: "/admin/settings" });
    expect(issue.text).toContain("Connect");
  });

  it("Telegram switched off on purpose is not an issue", () => {
    expect(alertSetupIssues({ ...ready, telegram: { enabled: false, hasToken: false, chatConnected: false } })).toEqual([]);
  });

  it("email without a Resend key or an admin address is a problem", () => {
    expect(alertSetupIssues({ ...ready, email: { enabled: true, hasKey: false, recipients: 1 } })[0]).toMatchObject({ level: "problem", key: "alerts:email" });
    expect(alertSetupIssues({ ...ready, email: { enabled: true, hasKey: true, recipients: 0 } })[0].text).toContain("ADMIN_EMAILS");
  });

  it("feeds the overall health status", () => {
    const base = { crons: [], queues, errors: { lastHour: 0 }, db: null };
    expect(evaluateHealth({ ...base, alerts: ready }).status).toBe("ok");
    expect(evaluateHealth({ ...base, alerts: null }).status).toBe("ok");
    const h = evaluateHealth({ ...base, alerts: { ...ready, telegram: { enabled: true, hasToken: false, chatConnected: false } } });
    expect(h.status).toBe("warning");
    expect(h.issues.map((i) => i.key)).toEqual(["alerts:telegram"]);
  });
});
