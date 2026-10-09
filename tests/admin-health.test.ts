import { describe, expect, it } from "vitest";
import { CRON_JOBS, cronStatus, graceMs, nextRun, parseCron, prevRun, type LastRun } from "@/lib/admin/cron";


import { vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/admin/service", () => ({ APPROVAL_TTL_MS: 7 * 86_400_000 }));
const { evaluateHealth } = await import("@/lib/admin/health");

const at = (s: string) => new Date(s);
const job = (name: string) => CRON_JOBS.find((j) => j.job === name)!;
const run = (startedAt: string, ok = true): LastRun => ({ startedAt: at(startedAt), finishedAt: at(startedAt), ok, summary: null, error: ok ? null : "boom" });
const none = { failures24h: 0, runs24h: 0 };

describe("cron expressions", () => {
  it("finds the next and previous run", () => {
    expect(nextRun("23 * * * *", at("2026-10-09T10:30:00Z"))?.toISOString()).toBe("2026-10-09T11:23:00.000Z");
    expect(prevRun("23 * * * *", at("2026-10-09T10:30:00Z"))?.toISOString()).toBe("2026-10-09T10:23:00.000Z");
    expect(nextRun("* * * * *", at("2026-10-09T10:30:20Z"))?.toISOString()).toBe("2026-10-09T10:31:00.000Z");
    expect(nextRun("17 2 * * *", at("2026-10-09T10:00:00Z"))?.toISOString()).toBe("2026-10-10T02:17:00.000Z");
  });

  it("handles steps and day-of-week lists (autopilot: every 3 hours on Friday and Saturday)", () => {
    // 9 Oct 2026 is a Friday.
    expect(nextRun("11 */3 * * 5,6", at("2026-10-09T10:00:00Z"))?.toISOString()).toBe("2026-10-09T12:11:00.000Z");
    expect(nextRun("11 */3 * * 5,6", at("2026-10-10T22:00:00Z"))?.toISOString()).toBe("2026-10-16T00:11:00.000Z");
    expect(prevRun("11 */3 * * 5,6", at("2026-10-12T09:00:00Z"))?.toISOString()).toBe("2026-10-10T21:11:00.000Z");
  });

  it("refuses a bad expression", () => {
    expect(() => parseCron("* * *")).toThrow();
    expect(() => parseCron("61 * * * *")).toThrow();
  });

  it("every registered job has a valid schedule", () => {
    for (const j of CRON_JOBS) expect(nextRun(j.cron, at("2026-10-09T10:00:00Z"))).not.toBeNull();
  });
});

describe("jobs scheduled by GitHub Actions", () => {
  it("get at least 4 hours before they count as overdue", () => {
    const j = job("social-refresh"); // 04:43 daily, GitHub Actions
    expect(graceMs(j.cron, at("2026-10-09T04:43:00Z"), j.via)).toBe(4 * 60 * 60_000);
    // due 04:43, started yesterday: 2 hours late is fine, 5 hours late is overdue
    expect(cronStatus(j, run("2026-10-08T06:30:00Z"), none, at("2026-10-09T06:45:00Z")).state).toBe("ok");
    expect(cronStatus(j, run("2026-10-08T06:30:00Z"), none, at("2026-10-09T09:45:00Z")).state).toBe("overdue");
  });

  it("Cloudflare jobs keep the shorter grace", () => {
    expect(graceMs("17 2 * * *", at("2026-10-09T02:17:00Z"))).toBe(90 * 60_000);
  });
});

describe("overdue cron detection", () => {
  it("is on time when the latest scheduled run happened", () => {
    const s = cronStatus(job("metrics"), run("2026-10-09T10:23:05Z"), none, at("2026-10-09T10:40:00Z"));
    expect(s.state).toBe("ok");
    expect(s.nextExpectedAt).toBe("2026-10-09T11:23:00.000Z");
  });

  it("allows some lateness before calling an hourly job overdue", () => {
    expect(graceMs("23 * * * *", at("2026-10-09T10:23:00Z"))).toBe(15 * 60_000);
    // Next run was due 10:23; at 10:30 it is within the 15-minute grace.
    expect(cronStatus(job("metrics"), run("2026-10-09T09:23:02Z"), none, at("2026-10-09T10:30:00Z")).state).toBe("ok");
  });

  it("is overdue once grace has passed with no run since the scheduled time", () => {
    const s = cronStatus(job("metrics"), run("2026-10-09T08:23:02Z"), none, at("2026-10-09T10:45:00Z"));
    expect(s.state).toBe("overdue");
    expect(s.overdueByMinutes).toBe(82); // it should have started at 09:23
  });

  it("flags the every-minute publisher after a few minutes", () => {
    expect(cronStatus(job("publish"), run("2026-10-09T10:00:30Z"), none, at("2026-10-09T10:03:00Z")).state).toBe("ok");
    expect(cronStatus(job("publish"), run("2026-10-09T10:00:30Z"), none, at("2026-10-09T10:08:00Z")).state).toBe("overdue");
  });

  it("does not call a weekend-only job overdue on a Wednesday, but does after a missed Saturday", () => {
    const j = job("autopilot");
    expect(cronStatus(j, run("2026-10-10T21:11:05Z"), none, at("2026-10-14T12:00:00Z")).state).toBe("ok");
    expect(cronStatus(j, run("2026-10-03T21:11:05Z"), none, at("2026-10-14T12:00:00Z")).state).toBe("overdue");
  });

  it("reports a failed last run, and never for a job with no record", () => {
    expect(cronStatus(job("metrics"), run("2026-10-09T10:23:05Z", false), { failures24h: 1, runs24h: 5 }, at("2026-10-09T10:40:00Z")).state).toBe("failed");
    expect(cronStatus(job("metrics"), null, none, at("2026-10-09T10:40:00Z")).state).toBe("never");
  });
});

const queues = { postsOverdue: 0, postsStuck: 0, needsAction: 0, webhookPending: 0, webhookFailed24h: 0, webhookTotal24h: 0, pendingApprovals: 0, oldestApprovalHours: null };
const okCron = { job: "metrics", label: "Collect metrics", state: "ok" as const, failures24h: 0, runs24h: 24, overdueByMinutes: null };
const base = { crons: [okCron], queues, errors: { lastHour: 0 }, db: { sizeBytes: 50e6, limitBytes: 500e6 } };

describe("overall health status", () => {
  it("is ok when everything is quiet", () => {
    expect(evaluateHealth(base)).toEqual({ status: "ok", issues: [] });
  });

  it("warns for a late non-critical job and a problem for a late publisher", () => {
    expect(evaluateHealth({ ...base, crons: [{ ...okCron, state: "overdue", overdueByMinutes: 40 }] }).status).toBe("warning");
    expect(evaluateHealth({ ...base, crons: [{ ...okCron, job: "publish", label: "Publish posts", state: "overdue", overdueByMinutes: 12 }] }).status).toBe("problem");
  });

  it("treats a job that failed every run today as a problem", () => {
    expect(evaluateHealth({ ...base, crons: [{ ...okCron, state: "failed", failures24h: 4, runs24h: 4 }] }).status).toBe("problem");
    expect(evaluateHealth({ ...base, crons: [{ ...okCron, state: "failed", failures24h: 1, runs24h: 24 }] }).status).toBe("warning");
  });

  it("scales post queue issues", () => {
    expect(evaluateHealth({ ...base, queues: { ...queues, postsOverdue: 1 } }).status).toBe("warning");
    expect(evaluateHealth({ ...base, queues: { ...queues, postsOverdue: 5 } }).status).toBe("problem");
    expect(evaluateHealth({ ...base, queues: { ...queues, postsStuck: 3 } }).status).toBe("problem");
  });

  it("needs enough deliveries before judging the webhook failure rate", () => {
    expect(evaluateHealth({ ...base, queues: { ...queues, webhookTotal24h: 5, webhookFailed24h: 5 } }).status).toBe("ok");
    expect(evaluateHealth({ ...base, queues: { ...queues, webhookTotal24h: 20, webhookFailed24h: 6 } }).status).toBe("warning");
    expect(evaluateHealth({ ...base, queues: { ...queues, webhookTotal24h: 20, webhookFailed24h: 12 } }).status).toBe("problem");
  });

  it("warns on an old approval, an error spike and a full database", () => {
    expect(evaluateHealth({ ...base, queues: { ...queues, pendingApprovals: 1, oldestApprovalHours: 60 } }).status).toBe("warning");
    expect(evaluateHealth({ ...base, errors: { lastHour: 12 } }).status).toBe("warning");
    expect(evaluateHealth({ ...base, errors: { lastHour: 80 } }).status).toBe("problem");
    expect(evaluateHealth({ ...base, db: { sizeBytes: 380e6, limitBytes: 500e6 } }).status).toBe("warning");
    expect(evaluateHealth({ ...base, db: { sizeBytes: 470e6, limitBytes: 500e6 } }).status).toBe("problem");
  });

  it("an unreadable database size does not raise an issue", () => {
    expect(evaluateHealth({ ...base, db: null }).status).toBe("ok");
  });
});
