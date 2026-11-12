import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: { contentVisual: { findFirst: vi.fn() } },
  render: vi.fn(),
  scheduleJob: vi.fn(async () => ({})),
  cancelJob: vi.fn(async () => undefined),
  handlers: new Map<string, (job: { id: string; businessId: string | null; payload: unknown; attempts: number }) => Promise<void>>(),
  after: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/visuals/service", () => ({ renderImageStep: h.render }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: h.scheduleJob, cancelJob: h.cancelJob, registerJobHandler: (kind: string, fn: never) => h.handlers.set(kind, fn) }));
vi.mock("next/server", () => ({ after: h.after }));

import { drawSet, SET_JOB, startSets } from "@/lib/content-flow/set-worker";

const NOW = new Date("2026-11-11T10:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.contentVisual.findFirst.mockResolvedValue({ id: "v1", status: "pending", business: { userId: "u1" } });
});

describe("the server draws the day's set without any browser", () => {
  it("steps all the set's pictures until it is ready, as the business (service key)", async () => {
    h.render.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "ready" });
    expect(await drawSet("b1", "g1")).toBe("ready");
    expect(h.render).toHaveBeenCalledTimes(3);
    expect(h.render.mock.calls[0]).toEqual([{ userId: "u1", businessId: "b1", service: true }, "v1", expect.objectContaining({ parallel: true })]);
    expect(h.prisma.contentVisual.findFirst.mock.calls[0][0].where).toEqual({ businessId: "b1", groupId: "g1", kind: { not: "video" } });
  });

  it("a finished, failed or unknown set is left alone; the job path takes one round and comes back while the browser draws", async () => {
    h.prisma.contentVisual.findFirst.mockResolvedValueOnce({ id: "v1", status: "ready", business: { userId: "u1" } });
    expect(await drawSet("b1", "g1")).toBe("ready");
    h.prisma.contentVisual.findFirst.mockResolvedValueOnce(null);
    expect(await drawSet("b1", "g1")).toBe("missing");
    h.render.mockResolvedValueOnce({ status: "rendering" });
    expect(await drawSet("b1", "g1", { maxSteps: 1 })).toBe("busy");
    h.render.mockResolvedValueOnce({ status: "pending" });
    expect(await drawSet("b1", "g1", { maxSteps: 1 })).toBe("pending");
    expect(h.render).toHaveBeenCalledTimes(2);
  });

  it("starts at once after the answer and leaves a job as the safety net, cancelled once the set is done", async () => {
    h.render.mockResolvedValue({ status: "ready" });
    await startSets("b1", ["g1", "g2"], NOW);
    expect(h.scheduleJob).toHaveBeenCalledWith({ kind: SET_JOB, runAt: new Date(NOW.getTime() + 3 * 60_000), payload: { groupId: "g1" }, businessId: "b1", dedupeKey: "dayset:g1" });
    expect(h.after).toHaveBeenCalledTimes(1);
    await (h.after.mock.calls[0][0] as () => Promise<void>)();
    expect(h.cancelJob).toHaveBeenCalledWith("dayset:g1");
    expect(h.cancelJob).toHaveBeenCalledWith("dayset:g2");
  });

  it("outside a request (no after()) the job loop draws it", async () => {
    h.after.mockImplementationOnce(() => {
      throw new Error("after() outside a request");
    });
    await expect(startSets("b1", ["g1"], NOW)).resolves.toBeUndefined();
    expect(h.scheduleJob).toHaveBeenCalledTimes(1);
  });

  it("the job carries a set on one round per call, and again a minute later while it is not finished", async () => {
    const handler = h.handlers.get(SET_JOB)!;
    h.render.mockResolvedValueOnce({ status: "pending" });
    await handler({ id: "j1", businessId: "b1", payload: { groupId: "g1" }, attempts: 1 });
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.scheduleJob).toHaveBeenCalledWith(expect.objectContaining({ kind: SET_JOB, dedupeKey: "dayset:g1", payload: { groupId: "g1" } }));
    h.scheduleJob.mockClear();
    h.render.mockResolvedValueOnce({ status: "ready" });
    await handler({ id: "j1", businessId: "b1", payload: { groupId: "g1" }, attempts: 2 });
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });
});
