import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ testimonial: { count: vi.fn() }, contentAngle: { findMany: vi.fn(), upsert: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

import { planAutopilotAngles } from "@/lib/content-flow/autopilot";
import { buildPrompt } from "@/lib/autopilot/writer";

const project = { id: "p1", subject: "product" as const, price: "15,000 RWF", createdAt: new Date("2026-01-01") };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.testimonial.count.mockResolvedValue(1);
  prisma.contentAngle.findMany.mockResolvedValue([{ day: new Date("2026-10-18T00:00:00Z"), angle: "offer", hook: "bold", structure: "punchy" }]);
  prisma.contentAngle.upsert.mockResolvedValue({});
});

describe("Autopilot uses the same angle rotation", () => {
  it("gives a product's posts different angles on consecutive days, after the Studio's last one, and remembers them", async () => {
    const groups = [
      { groupId: "g3", day: "2026-10-21", project },
      { groupId: "g1", day: "2026-10-19", project },
      { groupId: "g2", day: "2026-10-20", project },
      { groupId: "g4", day: "2026-10-20" },
    ];
    const angles = await planAutopilotAngles("b1", groups, new Date("2026-10-17T10:00:00Z"));
    expect(angles.has("g4")).toBe(false);
    const [a1, a2, a3] = ["g1", "g2", "g3"].map((g) => angles.get(g)!.angle);
    expect(a1).not.toBe("offer");
    expect(a2).not.toBe(a1);
    expect(a3).not.toBe(a2);
    expect(prisma.contentAngle.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.contentAngle.upsert.mock.calls[0][0].create).toMatchObject({ subjectKey: "product:p1", source: "autopilot" });
  });

  it("writes without angles when they cannot be read", async () => {
    prisma.testimonial.count.mockRejectedValue(new Error("db down"));
    expect((await planAutopilotAngles("b1", [{ groupId: "g1", day: "2026-10-19", project }], new Date())).size).toBe(0);
  });

  it("puts the angle in the Autopilot writer's prompt", () => {
    const prompt = buildPrompt({
      brand: { businessName: "Green Kigali" },
      idea: { id: "x", name: "Product spotlight", goal: "sales", guidance: "Show it.", formats: {}, needs: [], template: null } as never,
      facts: { date: "2026-10-19", angle: { angle: "how", hook: "question", structure: "list" } },
      targets: [{ network: "facebook", format: "POST" }],
    });
    expect(prompt).toContain("Today's angle: How it works.");
    expect(prompt).toContain("Hook: Open with a question");
  });
});
