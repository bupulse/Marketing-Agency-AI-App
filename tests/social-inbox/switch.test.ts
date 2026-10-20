import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() }, adminSetting: { findMany: vi.fn() }, dueJob: { findUnique: vi.fn() } },
  hasFeature: vi.fn(),
  scheduleJob: vi.fn(),
  cancelJob: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));
vi.mock("@/lib/entitlements", () => ({ hasFeature: mocks.hasFeature }));
vi.mock("@/lib/jobs/due", () => ({ scheduleJob: mocks.scheduleJob, cancelJob: mocks.cancelJob, registerJobHandler: vi.fn() }));
vi.mock("@/lib/social/inbox/meta-subscribe", () => ({ subscribeToWebhooks: mocks.subscribe }));

import { inboxStates, setInboxEnabled } from "@/lib/social/inbox/accounts";
import { clearInboxSettingsCache } from "@/lib/social/inbox/settings";

const row = (over: Record<string, unknown> = {}) => ({ id: "c1", businessId: "biz", provider: "instagram", method: "COMPOSIO", status: "ACTIVE", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  clearInboxSettingsCache();
  mocks.hasFeature.mockResolvedValue(true);
  mocks.prisma.adminSetting.findMany.mockResolvedValue([]);
  mocks.prisma.connection.findUnique.mockResolvedValue(row());
  mocks.prisma.dueJob.findUnique.mockResolvedValue({ id: "sweep" });
});

describe("Answer comments and messages switch", () => {
  it("switches on: fresh cursor (nothing older is taken in) and a check right away", async () => {
    const r = await setInboxEnabled("biz", "c1", true);
    expect(r.ok).toBe(true);
    const data = mocks.prisma.connection.update.mock.calls[0][0].data;
    expect(data.inboxEnabled).toBe(true);
    expect(data.inboxCursor).toMatchObject({ v: 1, posts: {} });
    expect(mocks.scheduleJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "social.poll", dedupeKey: "poll:c1", businessId: "biz" }));
  });

  it("switches off and cancels the checks", async () => {
    expect((await setInboxEnabled("biz", "c1", false)).ok).toBe(true);
    expect(mocks.cancelJob).toHaveBeenCalledWith("poll:c1");
  });

  it("refuses another business's account, a plan without Inbox, and an account connected the other way", async () => {
    expect((await setInboxEnabled("other", "c1", true)).ok).toBe(false);
    mocks.prisma.connection.findUnique.mockResolvedValue(row({ provider: "linkedin" }));
    expect((await setInboxEnabled("biz", "c1", true)).ok).toBe(false);
    mocks.prisma.connection.findUnique.mockResolvedValue(row());
    mocks.hasFeature.mockResolvedValue(false);
    expect((await setInboxEnabled("biz", "c1", true)).message).toMatch(/Inbox feature/);
    mocks.hasFeature.mockResolvedValue(true);
    mocks.prisma.connection.findUnique.mockResolvedValue(row({ method: "DIRECT" }));
    expect((await setInboxEnabled("biz", "c1", true)).message).toMatch(/Reconnect/);
    expect(mocks.prisma.connection.update).not.toHaveBeenCalled();
  });

  it("subscribes the account to Meta's webhook on the Meta route", async () => {
    mocks.prisma.adminSetting.findMany.mockResolvedValue([{ key: "inbox.meta.transport", value: "meta" }]);
    mocks.prisma.connection.findUnique.mockResolvedValue(row({ method: "DIRECT", provider: "facebook" }));
    expect((await setInboxEnabled("biz", "c1", true)).ok).toBe(true);
    expect(mocks.subscribe).toHaveBeenCalledWith("c1", "facebook");
    expect(mocks.scheduleJob).not.toHaveBeenCalled();
  });

  it("shows why the switch cannot be used", async () => {
    mocks.prisma.connection.findMany.mockResolvedValue([
      { id: "a", method: "COMPOSIO", inboxEnabled: false, inboxCursor: null },
      { id: "b", method: "DIRECT", inboxEnabled: false, inboxCursor: null },
    ]);
    const states = await inboxStates("biz", true);
    expect(states.a).toMatchObject({ usable: true, enabled: false });
    expect(states.b.usable).toBe(false);
    expect(states.b.note).toMatch(/Reconnect/);
    expect((await inboxStates("biz", false)).a).toMatchObject({ usable: false, note: expect.stringMatching(/Inbox feature/) });
  });
});
