import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireActiveUser: vi.fn() }));
const flow = vi.hoisted(() => ({ confirmContest: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: vi.fn(async () => ({ id: "b1" })) } } }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/content-flow/service", async (orig) => ({ ...(await orig<typeof import("@/lib/content-flow/service")>()), confirmContest: flow.confirmContest }));
const progress = vi.hoisted(() => ({ setProgress: vi.fn() }));
vi.mock("@/lib/visuals/progress", () => progress);
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/publishing/media", () => ({ signPaths: vi.fn(async () => new Map([["u1/designs/a.png", "https://signed/a"]])) }));

import { confirmContestAction, daySetProgressAction } from "@/app/dashboard/content/day-actions";
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

describe("the day's set progress (the loading screen polls it)", () => {
  it("reads the business's sets and signs the ready pictures", async () => {
    auth.requireActiveUser.mockResolvedValue({ id: "u1", role: "MEMBER" });
    progress.setProgress.mockResolvedValue([{ groupId: "11111111-aaaa", step: "images", images: [{ index: 0, status: "ready", stage: null, path: "u1/designs/a.png" }], reel: null }]);
    const res = await daySetProgressAction(["11111111-aaaa"]);
    expect(progress.setProgress).toHaveBeenCalledWith("b1", ["11111111-aaaa"]);
    expect(res).toMatchObject({ ok: true, sets: [{ images: [{ url: "https://signed/a" }] }] });
    expect(auth.requireActiveUser).toHaveBeenCalledWith("content", "throw");
  });

  it("refuses bad ids before reading anything", async () => {
    expect(await daySetProgressAction(["../x"])).toMatchObject({ ok: false });
    expect(await daySetProgressAction([])).toMatchObject({ ok: false });
    expect(progress.setProgress).not.toHaveBeenCalled();
  });
});
