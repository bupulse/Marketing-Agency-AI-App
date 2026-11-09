import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ me: vi.fn(), monitor: vi.fn() }));
vi.mock("@/lib/support/app-auth", () => ({ requireSupportAgentPage: h.me }));
vi.mock("@/lib/monitor/dashboard", () => ({ getServerMonitor: h.monitor }));
vi.mock("@/components/support-app/server/server-view", () => ({ ServerView: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import SupportServerPage from "@/app/support/(app)/server/page";

describe("support app Server page: technical staff and supervisors only", () => {
  beforeEach(() => {
    h.me.mockReset();
    h.monitor.mockReset();
    h.monitor.mockResolvedValue({ generatedAt: "2026-11-09T12:00:00.000Z" });
  });

  it("an agent gets not found, and nothing is read", async () => {
    h.me.mockResolvedValue({ id: "a1", role: "AGENT" });
    await expect(SupportServerPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.monitor).not.toHaveBeenCalled();
  });

  it.each(["TECH", "SUPERVISOR"])("%s sees the page", async (role) => {
    h.me.mockResolvedValue({ id: "a1", role });
    const page = await SupportServerPage();
    expect(page).toBeTruthy();
    expect(h.monitor).toHaveBeenCalledTimes(1);
  });
});
