import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordHeartbeat } = vi.hoisted(() => ({ recordHeartbeat: vi.fn() }));
vi.mock("@/lib/monitor/heartbeat", () => ({ recordHeartbeat }));

import { POST } from "@/app/api/monitor/heartbeat/route";
import { HEARTBEAT_MAX_BYTES, parseHeartbeat } from "@/lib/monitor/heartbeat-input";

const NOW = new Date("2026-11-09T12:00:00Z");

// What cron-loop.ps1 sends (ConvertTo-Json -Compress of its hashtable).
const sample = {
  machine: "DESKTOP-BUPULSE",
  os: "Microsoft Windows 10 Pro 10.0.19045",
  bootAt: "2026-11-06T07:12:33Z",
  cpuPercent: 23,
  memTotalMb: 16303,
  memUsedMb: 9120,
  disks: [
    { name: "C:", roles: ["system"], freeGb: 81.4, totalGb: 237.9 },
    { name: "D:", roles: ["repo"], freeGb: 402.2, totalGb: 931.5 },
  ],
  tasks: [
    { name: "BuPulse server", state: "Running" },
    { name: "BuPulse tunnel", state: "Running" },
    { name: "BuPulse jobs", state: "Running" },
  ],
  serverListening: true,
  nodeVersion: "v24.11.0",
  cloudflaredVersion: "cloudflared version 2025.10.1 (built 2025-10-20-1200 UTC)",
};

function call(authorization: string | undefined, body: unknown) {
  return POST(
    new NextRequest("http://127.0.0.1:3002/api/monitor/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("heartbeat route", () => {
  beforeEach(() => {
    recordHeartbeat.mockReset();
    recordHeartbeat.mockResolvedValue(undefined);
    process.env.CRON_SECRET = "pc-s3cret";
  });

  it("returns 500 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer pc-s3cret", sample)).status).toBe(500);
    expect(recordHeartbeat).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong", "pc-s3cret", "Bearer pc-s3cret2", "bearer pc-s3cret"])("returns 401 for %s", async (header) => {
    expect((await call(header, sample)).status).toBe(401);
    expect(recordHeartbeat).not.toHaveBeenCalled();
  });

  it("stores a good report", async () => {
    const res = await call("Bearer pc-s3cret", sample);
    expect(res.status).toBe(200);
    expect(recordHeartbeat).toHaveBeenCalledTimes(1);
    const stored = recordHeartbeat.mock.calls[0][0];
    expect(stored.machine).toBe("DESKTOP-BUPULSE");
    expect(stored.bootAt).toEqual(new Date("2026-11-06T07:12:33Z"));
    expect(stored.tasks).toHaveLength(3);
  });

  it("accepts the byte order mark Windows PowerShell may add", async () => {
    expect((await call("Bearer pc-s3cret", `﻿${JSON.stringify(sample)}`)).status).toBe(200);
  });

  it.each([
    ["not JSON", "{nope"],
    ["empty", ""],
    ["a list", "[]"],
    ["no machine name", JSON.stringify({ ...sample, machine: "  " })],
    ["too big", JSON.stringify({ ...sample, os: "x".repeat(HEARTBEAT_MAX_BYTES) })],
  ])("returns 400 for a body that is %s", async (_, body) => {
    expect((await call("Bearer pc-s3cret", body)).status).toBe(400);
    expect(recordHeartbeat).not.toHaveBeenCalled();
  });
});

describe("parseHeartbeat", () => {
  it("keeps a full report as it is", () => {
    const r = parseHeartbeat(sample, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ machine: "DESKTOP-BUPULSE", cpuPercent: 23, memUsedMb: 9120, memTotalMb: 16303, serverListening: true, nodeVersion: "v24.11.0" });
    expect(r.value.disks).toEqual(sample.disks);
  });

  it("takes PowerShell's one-item lists, which arrive as plain objects", () => {
    const r = parseHeartbeat({ ...sample, disks: { name: "C:", roles: "system", freeGb: 50, totalGb: 100 }, tasks: { name: "BuPulse jobs", state: "running" } }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.disks).toEqual([{ name: "C:", roles: ["system"], freeGb: 50, totalGb: 100 }]);
    expect(r.value.tasks).toEqual([{ name: "BuPulse jobs", state: "Running" }]);
  });

  it("caps and cleans: long text cut, values out of range dropped, unknown tasks and bad disks left out", () => {
    const r = parseHeartbeat(
      {
        machine: `PC\u0000${"x".repeat(200)}`,
        os: "y".repeat(500),
        bootAt: "2099-01-01T00:00:00Z",
        cpuPercent: 250,
        memTotalMb: 8000,
        memUsedMb: 9000,
        disks: [{ name: "C:", freeGb: 900, totalGb: 100 }, { name: "../etc", freeGb: 1, totalGb: 2 }, { name: "C:", freeGb: 1, totalGb: 2 }, ...Array.from({ length: 10 }, (_, i) => ({ name: `${String.fromCharCode(69 + i)}:`, totalGb: 1, freeGb: 1 }))],
        tasks: [{ name: "Something else", state: "Running" }, { name: "BuPulse tunnel", state: "Exploded" }],
        serverListening: "yes",
        extra: "dropped",
      },
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.value.machine.length).toBe(64);
    expect(r.value.machine).not.toContain("\u0000");
    expect(r.value.os?.length).toBe(120);
    expect(r.value.bootAt).toBeNull();
    expect(r.value.cpuPercent).toBeNull();
    expect(r.value.memUsedMb).toBe(8000);
    expect(r.value.disks[0]).toEqual({ name: "C:", roles: [], freeGb: 100, totalGb: 100 });
    expect(r.value.disks.length).toBeLessThanOrEqual(4);
    expect(r.value.tasks).toEqual([{ name: "BuPulse tunnel", state: "Unknown" }]);
    expect(r.value.serverListening).toBeNull();
    expect(r.value).not.toHaveProperty("extra");
  });

  it("needs a machine name and an object", () => {
    expect(parseHeartbeat(null).ok).toBe(false);
    expect(parseHeartbeat([sample]).ok).toBe(false);
    expect(parseHeartbeat({ ...sample, machine: 42 }).ok).toBe(false);
    expect(parseHeartbeat({ machine: "PC" }).ok).toBe(true);
  });
});
