import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  business: { findUnique: vi.fn() },
  chatWidget: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: m }));

import { loadPublicWidget } from "@/lib/widget/config";

describe("widget of a suspended owner", () => {
  beforeEach(() => {
    m.business.findUnique.mockResolvedValue({ id: "b1", userId: "u1", name: "Glow", brandColors: [], logoUrl: null, contentLanguage: "English", knowledge: null });
    m.chatWidget.findUnique.mockResolvedValue({ enabled: true, accentColor: null, position: "right", greeting: null, allowedDomains: [] });
  });

  it("is enabled for an active owner", async () => {
    m.user.findUnique.mockResolvedValue({ suspendedAt: null, deletionScheduledFor: null });
    expect((await loadPublicWidget("KEY12345"))?.enabled).toBe(true);
  });

  it.each([["suspended", { suspendedAt: new Date(), deletionScheduledFor: null }], ["deleting", { suspendedAt: null, deletionScheduledFor: new Date() }]])("is unavailable (no AI, no leads) while the owner is %s", async (_n, owner) => {
    m.user.findUnique.mockResolvedValue(owner);
    expect((await loadPublicWidget("KEY12345"))?.enabled).toBe(false);
  });
});
