import { beforeEach, describe, expect, it, vi } from "vitest";

// "Start my free trial" must drop the router's memory of the pages before the trial, then go to the dashboard: the
// stale "/dashboard sends you to /start-trial" entry made the browser bounce between them on a blank page.

const h = vi.hoisted(() => ({ order: [] as string[], start: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn((path: string, type?: string) => h.order.push(`revalidate:${path}:${type}`)) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { h.order.push(`redirect:${to}`); throw new Error("NEXT_REDIRECT"); }) }));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: vi.fn(async () => ({ businessId: "biz1", actorId: "u1" })) }));
vi.mock("@/lib/demo/limits", () => ({ demoLimited: vi.fn(async () => null) }));
vi.mock("@/lib/request-limits", () => ({ requestIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/trial/start", () => ({
  startOwnTrial: h.start,
  TrialError: class TrialError extends Error { constructor(public code: string, message: string) { super(message); } },
}));

import { startTrialAction } from "@/app/start-trial/actions";

beforeEach(() => {
  h.order = [];
  h.start.mockReset();
});

describe("startTrialAction", () => {
  it("revalidates the whole app before redirecting to the dashboard", async () => {
    h.start.mockResolvedValue(undefined);
    const form = new FormData();
    form.set("plan", "BUSINESS");
    await expect(startTrialAction({}, form)).rejects.toThrow("NEXT_REDIRECT");
    expect(h.start).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz1", planKey: "BUSINESS" }));
    expect(h.order).toEqual(["revalidate:/:layout", "redirect:/dashboard"]);
  });

  it("a refused plan answers in words and does not redirect", async () => {
    const { TrialError } = await import("@/lib/trial/start");
    h.start.mockRejectedValue(new (TrialError as unknown as new (c: string, m: string) => Error)("plan", "That plan is not offered here."));
    expect(await startTrialAction({}, new FormData())).toEqual({ error: "That plan is not offered here." });
    expect(h.order).toEqual([]);
  });
});
