import { describe, expect, it } from "vitest";
import { features } from "@/lib/content/site";
import { FEATURES } from "@/lib/features";
import { ADDONS } from "@/lib/offers/shared";

// The home page feature cards (components/marketing/home/features.tsx) match what the demo video says: content,
// designs, one calendar, chat, and Autopilot, which is honest about how it comes.
describe("home page feature cards", () => {
  it("include Autopilot, saying it comes with a custom plan or as an add-on", () => {
    const autopilot = features.find((f) => f.title === "Autopilot");
    expect(autopilot).toBeDefined();
    expect(autopilot!.text).toMatch(/^AI plans your week of posts/);
    expect(autopilot!.text).toMatch(/custom plan.*add-on/);
    expect(autopilot!.note).toBe("Custom plan or add-on");
    expect(autopilot!.soon).toBeFalsy();
    // It is built and sold as an add-on, so the card is true today.
    expect(FEATURES.find((f) => f.key === "autopilot")?.status).toBe("built");
    expect(ADDONS.some((a) => a.key === "autopilot")).toBe(true);
  });

  it("end on one full-width card, so the 2- and 3-column grids never end on a lone card", () => {
    const wide = features.filter((f) => f.wide);
    expect(wide.map((f) => f.title)).toEqual(["Autopilot"]);
    expect(features.at(-1)?.title).toBe("Autopilot");
    const narrow = features.length - wide.length;
    expect(narrow % 2).toBe(0);
    expect(narrow % 3).toBe(0);
  });
});
