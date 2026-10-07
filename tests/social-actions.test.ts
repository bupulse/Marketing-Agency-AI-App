import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  disconnect: vi.fn(),
  saveReminderConnection: vi.fn(),
  rateLimit: vi.fn(),
  prisma: { business: { findUnique: vi.fn() }, connection: { findMany: vi.fn() } },
  deleteConnections: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: mocks.rateLimit }));
vi.mock("@/lib/social/connections", () => ({ disconnect: mocks.disconnect, saveConnections: vi.fn(), saveReminderConnection: mocks.saveReminderConnection, deleteConnections: mocks.deleteConnections }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("no"); } }));

import { connectReminderAction, disconnectAction, savePickedAccountsAction } from "@/app/dashboard/connections/actions";
import { automaticAvailable, canConnect, primaryVariant, showFacebookLink } from "@/components/connections/types";
import { deleteMetaConnections } from "@/lib/social/meta-callbacks";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireActiveUser.mockResolvedValue({ id: "u1" });
  mocks.prisma.business.findUnique.mockResolvedValue({ id: "biz1" });
  mocks.rateLimit.mockResolvedValue(undefined);
});

describe("connections actions", () => {
  it("always scopes disconnect to the signed-in user's business", async () => {
    await disconnectAction(form({ id: "someone-elses-connection" }));
    expect(mocks.disconnect).toHaveBeenCalledWith("someone-elses-connection", { businessId: "biz1" });
  });

  it("validates the personal Instagram handle", async () => {
    expect((await connectReminderAction({}, form({ handle: "not valid!" }))).error).toMatch(/username/);
    expect(mocks.saveReminderConnection).not.toHaveBeenCalled();
    expect(await connectReminderAction({}, form({ handle: "@my.shop", displayName: "My Shop" }))).toEqual({ ok: true });
    expect(mocks.saveReminderConnection).toHaveBeenCalledWith("biz1", "instagram", "@my.shop", "My Shop");
  });

  it("personal Instagram works without any Meta app keys", async () => {
    for (const k of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]) delete process.env[k];
    expect(await connectReminderAction({}, form({ handle: "shop" }))).toEqual({ ok: true });
    const base = { label: "", note: "", configured: false };
    expect(canConnect({ ...base, network: "instagram" })).toBe(true);
    for (const network of ["facebook", "linkedin", "tiktok", "youtube"] as const) expect(canConnect({ ...base, network })).toBe(false);
    expect(canConnect({ ...base, network: "facebook", configured: true })).toBe(true);
  });

  it("Instagram connect variants follow which Meta keys are set", () => {
    const base = { network: "instagram" as const, label: "Instagram", note: "" };
    const both = { ...base, configured: true, viaFacebook: true };
    const fbOnly = { ...base, configured: false, viaFacebook: true };
    const none = { ...base, configured: false, viaFacebook: false };
    expect([primaryVariant(both), showFacebookLink(both), automaticAvailable(both)]).toEqual(["instagram", true, true]);
    expect([primaryVariant(fbOnly), showFacebookLink(fbOnly), automaticAvailable(fbOnly)]).toEqual(["facebook", false, true]);
    expect([showFacebookLink(none), automaticAvailable(none), canConnect(none)]).toEqual([false, false, true]);
  });

  it("sends the user back when the account picker's cookie is gone or expired", async () => {
    await expect(savePickedAccountsAction(form({ account: "p1" }))).rejects.toThrow("redirect:/dashboard/connections?error=expired");
  });
});

describe("deleteMetaConnections", () => {
  it("finds connections by meta_uid scope or the Instagram account id, and deletes them", async () => {
    mocks.prisma.connection.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    expect(await deleteMetaConnections("555")).toBe(2);
    expect(mocks.prisma.connection.findMany.mock.calls[0][0].where).toEqual({
      provider: { in: ["facebook", "instagram"] },
      OR: [{ scopes: { has: "meta_uid:555" } }, { provider: "instagram", externalAccountId: "555" }],
    });
    expect(mocks.deleteConnections).toHaveBeenCalledWith(["a", "b"]);
  });
});
