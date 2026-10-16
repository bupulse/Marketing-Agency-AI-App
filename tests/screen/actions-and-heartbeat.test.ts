import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  adminAction: vi.fn(),
  service: {
    createScreenLink: vi.fn(),
    revokeScreenLink: vi.fn(),
    startSoundUpload: vi.fn(),
    finishSoundUpload: vi.fn(),
    generateSound: vi.fn(),
    setSoundActive: vi.fn(),
    deleteSound: vi.fn(),
  },
  updateMany: vi.fn(),
  waitUntil: vi.fn(),
}));
vi.mock("@/lib/admin/console", () => ({
  adminAction: h.adminAction,
  actionMessage: (e: Error) => e.message,
  finish: async (_back: string, _ok: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/screen/links", () => ({ createScreenLink: h.service.createScreenLink, revokeScreenLink: h.service.revokeScreenLink }));
vi.mock("@/lib/screen/sounds", () => ({
  startSoundUpload: h.service.startSoundUpload,
  finishSoundUpload: h.service.finishSoundUpload,
  generateSound: h.service.generateSound,
  setSoundActive: h.service.setSoundActive,
  deleteSound: h.service.deleteSound,
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { updateMany: h.updateMany } } }));
vi.mock("@/lib/platform/background", () => ({ waitUntil: h.waitUntil }));

import * as actions from "@/app/admin/(console)/(organisation)/organisation/screen/actions";
import { HEARTBEAT_EVERY_MS, heartbeat, resetHeartbeat } from "@/lib/staff/heartbeat";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

const calls: [string, () => Promise<unknown>][] = [
  ["createScreenLinkAction", () => actions.createScreenLinkAction("TV")],
  ["revokeScreenLinkAction", () => actions.revokeScreenLinkAction(form({ id: "l1" }))],
  ["startSoundUploadAction", () => actions.startSoundUploadAction({ bytes: 10, rights: true })],
  ["finishSoundUploadAction", () => actions.finishSoundUploadAction("p.mp3", { name: "Ding", rights: true })],
  ["generateSoundAction", () => actions.generateSoundAction(form({ name: "Ding", prompt: "Cash register", seconds: "3" }))],
  ["setSoundActiveAction", () => actions.setSoundActiveAction(form({ id: "c1", active: "true" }))],
  ["deleteSoundAction", () => actions.deleteSoundAction(form({ id: "c1" }))],
];

describe("Sales screen admin actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(calls)("%s needs screen.manage and does nothing without it", async (_name, call) => {
    h.adminAction.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.adminAction).toHaveBeenCalledWith("screen.manage");
    for (const fn of Object.values(h.service)) expect(fn).not.toHaveBeenCalled();
  });

  it("with the permission, the change runs as the staff member", async () => {
    const ctx = { actor: "staff:s1", viaApi: false };
    h.adminAction.mockResolvedValue(ctx);
    h.service.createScreenLink.mockResolvedValue({ id: "l1", url: "https://bupulse.com/screen/abc" });
    expect(await actions.createScreenLinkAction("TV")).toEqual({ ok: true, url: "https://bupulse.com/screen/abc" });
    await actions.revokeScreenLinkAction(form({ id: "l1" }));
    expect(h.service.revokeScreenLink).toHaveBeenCalledWith(ctx, "l1");
    await actions.finishSoundUploadAction("p.mp3", { name: "Ding", rights: "yes" as unknown as boolean });
    // Only a real `true` counts as the rights box.
    expect(h.service.finishSoundUpload).toHaveBeenCalledWith(ctx, "p.mp3", { name: "Ding", rights: false });
  });
});

describe("dashboard heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHeartbeat();
    h.updateMany.mockReturnValue(Promise.resolve({ count: 1 }));
  });

  it("writes at most once every 2 minutes per person, only over an older time, after the response", () => {
    const t = 1_760_000_000_000;
    heartbeat("u1", t);
    heartbeat("u1", t + 30_000);
    heartbeat("u1", t + HEARTBEAT_EVERY_MS - 1);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(h.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "u1", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(t - HEARTBEAT_EVERY_MS) } }] },
      data: { lastSeenAt: new Date(t) },
    });
    expect(h.waitUntil).toHaveBeenCalledTimes(1);
    heartbeat("u2", t);
    heartbeat("u1", t + HEARTBEAT_EVERY_MS);
    expect(h.updateMany).toHaveBeenCalledTimes(3);
  });

  it("never throws or fails the page", async () => {
    h.updateMany.mockReturnValueOnce(Promise.reject(new Error("db down")));
    expect(() => heartbeat("u3", 1)).not.toThrow();
    h.updateMany.mockImplementationOnce(() => {
      throw new Error("no client");
    });
    expect(() => heartbeat("u4", 1)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
