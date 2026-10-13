import { beforeEach, describe, expect, it, vi } from "vitest";

const pack = vi.hoisted(() => ({ angleFacts: vi.fn(), recentAngles: vi.fn() }));
vi.mock("@/lib/studio/pack", () => pack);
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { planAutopilotAngles } from "@/lib/content-flow/autopilot";
import { buildPrompt } from "@/lib/autopilot/writer";

const project = { id: "p1", subject: "product" as const, type: "product", price: "15,000 RWF" };

beforeEach(() => {
  vi.clearAllMocks();
  pack.angleFacts.mockResolvedValue({ subjectType: "product", hasPrice: true, isNew: false, hasCompetitors: false, hasFaqs: false, moment: null });
  pack.recentAngles.mockResolvedValue(["features", "price", "story"]);
});

describe("Autopilot on the content packs' angles", () => {
  it("gives a product's posts the next angles of its rotation, different from each other, in day order", async () => {
    const groups = [
      { groupId: "g3", day: "2026-10-21", project },
      { groupId: "g1", day: "2026-10-19", project },
      { groupId: "g2", day: "2026-10-20", project },
      { groupId: "g4", day: "2026-10-20" },
    ];
    const angles = await planAutopilotAngles("b1", groups, "RW", new Date("2026-10-17T10:00:00Z"));
    expect(angles.has("g4")).toBe(false);
    const ids = ["g1", "g2", "g3"].map((g) => angles.get(g)!.id);
    expect(new Set(ids).size).toBe(3);
    for (const recent of ["features", "price", "story"]) expect(ids).not.toContain(recent);
    // The opening moves one step a day.
    expect(angles.get("g1")!.hook).not.toBe(angles.get("g2")!.hook);
    expect(pack.recentAngles).toHaveBeenCalledTimes(1);
  });

  it("writes without angles when they cannot be read", async () => {
    pack.recentAngles.mockRejectedValue(new Error("db down"));
    expect((await planAutopilotAngles("b1", [{ groupId: "g1", day: "2026-10-19", project }], null, new Date())).size).toBe(0);
  });

  it("puts the angle, opening and structure in the Autopilot writer's prompt", () => {
    const prompt = buildPrompt({
      brand: { businessName: "Green Kigali" },
      idea: { id: "x", name: "Product spotlight", goal: "sales", guidance: "Show it.", formats: {}, needs: [], template: null } as never,
      facts: { date: "2026-10-19", angle: { id: "how-it-works", label: "How it works", brief: "The steps.", hook: "Open with a question.", structure: "A short list." } },
      targets: [{ network: "facebook", format: "POST" }],
    });
    expect(prompt).toContain("How it works. The steps.");
    expect(prompt).toContain("Opening: Open with a question. Structure: A short list.");
  });
});
