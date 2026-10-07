import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishDue, collectMetrics } = vi.hoisted(() => ({ publishDue: vi.fn(), collectMetrics: vi.fn() }));
vi.mock("@/lib/publishing/engine", () => ({ publishDue }));
vi.mock("@/lib/publishing/metrics", () => ({ collectMetrics }));

import { POST as metricsRoute } from "@/app/api/cron/metrics/route";
import { POST as publishRoute } from "@/app/api/cron/publish/route";

const routes = [
  { name: "publish", post: publishRoute, job: publishDue, result: { claimed: 2, published: 2, reminders: 0, retrying: 0, failed: 0 } },
  { name: "metrics", post: metricsRoute, job: collectMetrics, result: { checked: 3, saved: 3, skipped: 0, failed: 0 } },
];

describe.each(routes)("/api/cron/$name", ({ name, post, job, result }) => {
  const call = (authorization?: string) =>
    post(new NextRequest(`https://bupulse.test/api/cron/${name}`, { method: "POST", headers: authorization ? { authorization } : {} }));

  beforeEach(() => {
    job.mockReset();
    job.mockResolvedValue(result);
    process.env.CRON_SECRET = "s3cret";
  });

  it("returns 500 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer s3cret")).status).toBe(500);
    expect(job).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong", "s3cret", "Bearer s3cret2", "bearer s3cret"])("returns 401 for %s", async (header) => {
    expect((await call(header)).status).toBe(401);
    expect(job).not.toHaveBeenCalled();
  });

  it("runs the job with the right secret and reports what it did", async () => {
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(job).toHaveBeenCalledTimes(1);
  });
});
