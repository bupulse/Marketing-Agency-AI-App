import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/support-app/server/auto-refresh", () => ({ AutoRefresh: () => null }));
vi.mock("@/components/support-app/server/run-check", () => ({ RunCheck: () => null }));

import { ServerView } from "@/components/support-app/server/server-view";
import type { ServerMonitor } from "@/lib/monitor/dashboard";

const base: ServerMonitor = {
  generatedAt: "2026-11-09T12:00:00.000Z",
  issues: [],
  site: { kind: "up", lastCheckAt: "2026-11-09T11:58:00.000Z" },
  uptime: { today: 100, week: 99.8, month: 99.95, since: "2026-11-09T09:00:00.000Z" },
  timeline: {
    hours: [{ start: "2026-11-09T11:00:00.000Z", checks: 12, failed: 1, avgMs: 640, uptime: 96.6 }, { start: "2026-11-09T12:00:00.000Z", checks: 0, failed: 0, avgMs: null, uptime: 100 }],
    days: [{ day: "2026-11-08T22:00:00.000Z", uptime: 99.2 }],
  },
  outages: [{ id: "cmpreview0001xx", startedAt: "2026-11-09T09:30:00.000Z", endedAt: "2026-11-09T09:53:00.000Z", minutes: 23, reason: "failed-check" }],
  pc: {
    state: "ok",
    lastAt: "2026-11-09T11:59:40.000Z",
    minutesSilent: 0,
    machine: "DESKTOP-BUPULSE",
    os: "Microsoft Windows 10 Pro 10.0.19045",
    bootAt: "2026-11-06T07:12:00.000Z",
    cpuPercent: 23,
    cpuHourAvg: 18,
    memUsedMb: 9120,
    memTotalMb: 16303,
    disks: [{ name: "C:", roles: ["system"], freeGb: 81.4, totalGb: 237.9 }, { name: "D:", roles: ["repo"], freeGb: 402.2, totalGb: 931.5 }],
    tasks: [{ name: "BuPulse server", state: "Running" }, { name: "BuPulse tunnel", state: "Running" }, { name: "BuPulse jobs", state: "Running" }],
    serverListening: true,
    nodeVersion: "v24.11.0",
    cloudflaredVersion: "cloudflared version 2025.10.1",
  },
  checks: {
    last: { checkedAt: "2026-11-09T11:58:00.000Z", ok: true, statusMs: 210, databaseMs: 35, version: "1.0.0", pages: [{ path: "/", status: 200, ms: 640 }, { path: "/pricing", status: 200, ms: 1200 }, { path: "/login", status: 502, ms: 90 }] },
    avg24h: [{ path: "/", ms: 700, failures: 0 }, { path: "/pricing", ms: 1100, failures: 0 }, { path: "/login", ms: 500, failures: 2 }],
  },
  db: { nowMs: 12, sizeBytes: 120_000_000, limitBytes: 500_000_000 },
  errors: { lastHour: 1, last24h: 9, top: [{ source: "publish", count: 5 }] },
  jobs: { total: 18, ok: 17, problems: [{ label: "Store sync", state: "failed", text: "failed on its last run (1 of 1 in 24 hours)" }] },
};

const html = (m: ServerMonitor) => renderToStaticMarkup(createElement(ServerView, { m }));

describe("ServerView", () => {
  it("shows every panel in plain words", () => {
    const out = html(base);
    expect(out).toContain("Everything is working");
    expect(out).toContain("99.8%");
    expect(out).toContain("23 minutes");
    expect(out).toContain("8.9 GB used of 16 GB");
    expect(out).toContain("9 Nov, 11:30 → 11:53");
    expect(out).toContain("3 days 4 hours ago");
    expect(out).toContain("81.4 GB free of 237.9 GB");
    expect(out).toContain("Tunnel (connects the PC to the internet)");
    expect(out).toContain("Failed (error 502)");
    expect(out).toContain("12 ms now");
    expect(out).toContain("17 of 18 fine");
    expect(out).toContain("Backup servers");
    expect(out).toContain("Not set up yet");
    expect(out).not.toContain("What is left to set up");
    // The timeline, its colour key and its table for screen readers.
    expect(out).toContain("Uptime timeline");
    expect(out).toContain("13:00–14:00");
    expect(out).toContain("12 checks, 1 failed");
    expect(out).toContain("Some trouble (1)");
    // Every reading says what it means.
    expect(out).toContain("Above 90% may slow the site");
  });

  it("a red banner when something is down, and the set-up steps before anything reported", () => {
    const out = html({
      ...base,
      issues: [{ level: "down", text: "The server PC has not reported for 7 minutes." }],
      site: { kind: "never" },
      uptime: { today: null, week: null, month: null, since: null },
      outages: [],
      pc: { ...base.pc, state: "never" },
      checks: { last: null, avg24h: base.checks.avg24h.map((a) => ({ ...a, ms: null, failures: 0 })) },
    });
    expect(out).toContain("Something is down");
    expect(out).toContain('role="alert"');
    expect(out).toContain("What is left to set up");
    expect(out).toContain("UPTIME_SECRET");
    expect(out).toContain("has not reported yet");
  });
});
