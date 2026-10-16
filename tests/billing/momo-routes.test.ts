import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The webhook plug-in point answers 404 for every provider until an automatic one is registered, and the renewals
// cron route is protected by CRON_SECRET like the other cron routes.

const h = vi.hoisted(() => ({ process: vi.fn(async () => ({ checked: 0, nextCursor: null })), record: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()) }));
vi.mock("@/lib/billing/momo-renewals", () => ({ processMomoRenewals: h.process }));
vi.mock("@/lib/admin/cron-run", () => ({ recordCron: h.record }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { POST as webhook } from "@/app/api/billing/webhooks/[provider]/route";
import { POST as cron } from "@/app/api/cron/momo-renewals/route";

const post = (url: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${url}`, { method: "POST", headers, body: "{}" });

beforeEach(() => vi.clearAllMocks());

describe("/api/billing/webhooks/[provider]", () => {
  it("is 404 for providers that are not wired up (paypack, flutterwave, mtn, manual-momo, anything)", async () => {
    for (const provider of ["paypack", "flutterwave", "mtn", "manual-momo", "paddle2", "x"]) {
      const res = await webhook(post(`/api/billing/webhooks/${provider}`), { params: Promise.resolve({ provider }) });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Unknown payment provider" });
    }
  });
});

describe("/api/cron/momo-renewals", () => {
  it("needs the CRON_SECRET bearer and passes the cursor on", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await cron(post("/api/cron/momo-renewals"))).status).toBe(401);
    expect((await cron(post("/api/cron/momo-renewals", { authorization: "Bearer wrong" }))).status).toBe(401);
    const res = await cron(post("/api/cron/momo-renewals?cursor=abc", { authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
    expect(h.process).toHaveBeenCalledWith({ cursor: "abc" });
    expect(h.record).toHaveBeenCalledWith("momo-renewals", expect.any(Function));
  });

  it("is 500 when the secret is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await cron(post("/api/cron/momo-renewals", { authorization: "Bearer x" }))).status).toBe(500);
  });
});
