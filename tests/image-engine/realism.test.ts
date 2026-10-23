import { describe, expect, it } from "vitest";
import { chooseTiers, directBatch } from "@/lib/image-engine/director";
import { painterPrompt } from "@/lib/image-engine/painter-prompt";
import { CAMERAS, realismBlock, stripSlop } from "@/lib/image-engine/realism";

describe("anti-slop rules", () => {
  it("takes the hype words that make pictures look fake out of a prompt", () => {
    expect(stripSlop("A stunning, vibrant greenhouse with lush perfect lettuce, cinematic lighting, 8k, hyper-realistic")).toBe("A greenhouse with lettuce, lighting,");
    expect(stripSlop("Mid-morning in a dusty greenhouse, a woman kneels to cut a lettuce.")).toBe("Mid-morning in a dusty greenhouse, a woman kneels to cut a lettuce.");
  });
  it("gives every picture of a batch its own real camera, and the Painter says so with the realism rules", () => {
    const slots = directBatch({ tiers: chooseTiers(5, 100, "lite"), recent: [], photoCount: 1, facts: { reviews: false, price: false }, seed: "cam" });
    expect(new Set(slots.map((s) => s.camera)).size).toBe(5);
    for (const s of slots) expect(CAMERAS).toContain(s.camera);
    const p = painterPrompt({ businessName: "LEAF", aspectRatio: "4:5", concept: { prompt: "A woman cuts a lettuce.", headline: "Grow more", subline: "", cta: "" }, layout: "top", camera: slots[0].camera, treatment: "exact", hasPhoto: true, hasLogo: false, colors: [] });
    expect(p).toContain(`Shot as ${slots[0].camera}.`);
    expect(p).toContain("unretouched real photograph");
    expect(p).toContain("plastic, waxy or airbrushed skin");
    expect(p).not.toMatch(/top agency|professional ad photographed/);
    expect(realismBlock("x")).toMatch(/^Shot as x\./);
  });
});
