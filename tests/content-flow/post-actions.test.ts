import { beforeEach, describe, expect, it, vi } from "vitest";

// The post panel's actions (app/dashboard/content/post-actions.ts): the `content` permission, so Members may generate
// again and restore their company's posts; the company account is charged; the person is named in the versions.

const auth = vi.hoisted(() => ({ requireActiveUser: vi.fn() }));
const writing = vi.hoisted(() => ({ postWritingView: vi.fn(), rewritePost: vi.fn(), restorePostVersion: vi.fn() }));
const gate = vi.hoisted(() => ({ featureBlocked: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { business: { findUnique: vi.fn(async () => ({ id: "b1" })) } } }));
vi.mock("@/lib/entitlements", () => ({ featureBlocked: gate.featureBlocked }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: gate.rateLimit }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/content-flow/post-writing", async () => {
  class PostWriteError extends Error {
    constructor(
      message: string,
      public blocked?: string,
    ) {
      super(message);
    }
  }
  return { ...writing, PostWriteError };
});

import { loadPostWritingAction, regeneratePostAction, restorePostVersionAction } from "@/app/dashboard/content/post-actions";
import { PostWriteError } from "@/lib/content-flow/post-writing";
import { ForbiddenError } from "@/lib/team/roles";

const member = { id: "owner-account", actorId: "member-1", role: "MEMBER", businessId: "b1" };
const view = { postId: "p1", versions: [] };

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireActiveUser.mockResolvedValue(member);
  gate.featureBlocked.mockResolvedValue(null);
  gate.rateLimit.mockResolvedValue(undefined);
  writing.postWritingView.mockResolvedValue(view);
  writing.rewritePost.mockResolvedValue(undefined);
  writing.restorePostVersion.mockResolvedValue({ changed: true });
});

describe("Generate again and Versions", () => {
  it("a Member may generate again: the content permission, the company's credits, the person in the versions", async () => {
    expect(await regeneratePostAction("p1", "headlines")).toEqual({ ok: true, view });
    expect(auth.requireActiveUser).toHaveBeenCalledWith("content", "throw");
    expect(gate.featureBlocked).toHaveBeenCalledWith("b1", "content");
    expect(writing.rewritePost).toHaveBeenCalledWith({ userId: "owner-account", businessId: "b1", actorId: "member-1" }, "p1", "headlines");
    expect(gate.rateLimit.mock.calls[0][0]).toBe("content:regenerate:b1");
  });

  it("a Member may restore a version too", async () => {
    expect(await restorePostVersionAction("p1", "v1")).toEqual({ ok: true, view, message: "Restored. It is the current version now." });
    expect(writing.restorePostVersion).toHaveBeenCalledWith({ userId: "owner-account", businessId: "b1", actorId: "member-1" }, "p1", "v1");
  });

  it("refuses an unknown part before anything runs", async () => {
    expect(await regeneratePostAction("p1", "everything")).toMatchObject({ ok: false });
    expect(auth.requireActiveUser).not.toHaveBeenCalled();
    expect(writing.rewritePost).not.toHaveBeenCalled();
  });

  it("answers in words when the role or the plan does not allow it", async () => {
    auth.requireActiveUser.mockRejectedValueOnce(new ForbiddenError("content"));
    expect(await regeneratePostAction("p1", "post")).toEqual({ ok: false, error: "Ask your company owner or an admin to do this." });
    gate.featureBlocked.mockResolvedValueOnce("Content is not part of your plan.");
    expect(await restorePostVersionAction("p1", "v1")).toEqual({ ok: false, error: "Content is not part of your plan." });
    expect(writing.rewritePost).not.toHaveBeenCalled();
    expect(writing.restorePostVersion).not.toHaveBeenCalled();
    // Loading the panel quietly shows nothing instead.
    gate.featureBlocked.mockResolvedValueOnce("Content is not part of your plan.");
    expect(await loadPostWritingAction("p1")).toMatchObject({ ok: false, quiet: true });
  });

  it("passes on why the plan stopped it, so the screen can offer the plans", async () => {
    writing.rewritePost.mockRejectedValueOnce(new PostWriteError("No text generations left this month.", "limit_reached"));
    expect(await regeneratePostAction("p1", "script")).toEqual({ ok: false, error: "No text generations left this month.", blocked: "limit_reached" });
  });
});
