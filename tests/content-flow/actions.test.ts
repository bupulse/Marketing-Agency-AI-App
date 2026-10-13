import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireActiveUser: vi.fn() }));
const flow = vi.hoisted(() => ({ confirmContest: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: vi.fn(async () => ({ id: "b1" })) } } }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/content-flow/service", async (orig) => ({ ...(await orig<typeof import("@/lib/content-flow/service")>()), confirmContest: flow.confirmContest }));

import { confirmContestAction } from "@/app/dashboard/content/day-actions";
import { ForbiddenError } from "@/lib/team/roles";

const input = { prize: "50,000 RWF", endsOn: "2026-10-16", howChosen: "Most likes", willPay: true };

beforeEach(() => vi.clearAllMocks());

describe("confirming a contest's prize", () => {
  it("needs an Owner or Admin (the approval level), never a Member", async () => {
    auth.requireActiveUser.mockRejectedValue(new ForbiddenError("contentSettings"));
    const res = await confirmContestAction("c1", input);
    expect(res.ok).toBe(false);
    expect(auth.requireActiveUser).toHaveBeenCalledWith("contentSettings", "throw");
    expect(flow.confirmContest).not.toHaveBeenCalled();
  });

  it("an Owner or Admin confirms it", async () => {
    auth.requireActiveUser.mockResolvedValue({ id: "u1", role: "ADMIN" });
    expect(await confirmContestAction("c1", input)).toEqual({ ok: true });
    expect(flow.confirmContest).toHaveBeenCalledWith({ userId: "u1", businessId: "b1" }, "c1", input);
  });

  it("refuses without the promise to give the prize", async () => {
    expect(await confirmContestAction("c1", { ...input, willPay: false })).toMatchObject({ ok: false });
    expect(auth.requireActiveUser).not.toHaveBeenCalled();
  });
});
