import { describe, expect, it } from "vitest";
import { priceNotes, shortPrice, splitPrice, withShortPrice } from "@/lib/video-engine/price";

describe("a product's price for a video", () => {
  it("keeps a short price as it is", () => {
    expect(splitPrice("250,000 RWF")).toEqual({ short: "250,000 RWF", notes: null });
    expect(splitPrice("From 25,000 RWF")).toEqual({ short: "From 25,000 RWF", notes: null });
    expect(splitPrice("50,000 RWF per day")).toEqual({ short: "50,000 RWF per day", notes: null });
    expect(splitPrice("  ")).toEqual({ short: null, notes: null });
    expect(shortPrice(null)).toBeNull();
  });

  it("takes the amount with its condition out of a paragraph, and keeps the rest as notes", () => {
    expect(splitPrice("From 250,000 RWF · Final pricing depends on the tower size, installation in Kigali included")).toEqual({ short: "From 250,000 RWF", notes: "Final pricing depends on the tower size, installation in Kigali included" });
    expect(splitPrice("250,000 RWF (delivery extra) · installment possible")).toEqual({ short: "250,000 RWF", notes: "delivery extra · installment possible" });
    expect(splitPrice("from 250,000 RWF, installment possible over 3 months for farmers in cooperatives")).toEqual({ short: "from 250,000 RWF", notes: "installment possible over 3 months for farmers in cooperatives" });
    expect(splitPrice("Starting at 180,000 Frw per month with the seeds and nutrients included every month")).toEqual({ short: "starting at 180,000 Frw per month", notes: "with the seeds and nutrients included every month" });
    expect(splitPrice("120,000 RWF. Price includes the pump and 30 net cups")).toEqual({ short: "120,000 RWF", notes: "Price includes the pump and 30 net cups" });
    expect(splitPrice("was 300,000 now 250,000 RWF")).toEqual({ short: "250,000 RWF", notes: "300,000" });
    expect(priceNotes("85,000 RWF - free delivery in Kigali")).toBe("free delivery in Kigali");
  });

  it("splits a product once", () => {
    const p = withShortPrice({ name: "LEAF Hydro Tower", price: "From 250,000 RWF · delivery extra" });
    expect(p).toEqual({ name: "LEAF Hydro Tower", price: "From 250,000 RWF", priceNotes: "delivery extra" });
    expect(withShortPrice(p)).toBe(p);
    expect(withShortPrice({ name: "x", price: null })).toEqual({ name: "x", price: null });
  });
});

describe("the short price reaches the engine", async () => {
  const { briefText } = await import("@/lib/video-engine/designer");
  const { suggestHooks } = await import("@/lib/video-engine/brain");
  const { factCheck } = await import("@/lib/video-engine/factcheck");
  const paragraph = "From 250,000 RWF · Final pricing depends on the tower size; installation in Kigali included for 30,000 RWF";
  const brief = { business: { name: "LEAF Rwanda", phone: "0788 300 400" }, product: { name: "LEAF Hydro Tower", price: paragraph }, photos: [], styleId: "product-hero", hookId: "auto", ratio: "9:16" as const, seconds: 15 };

  it("Claude sees the short price, and the rest only as notes for the caption's later lines", () => {
    const text = briefText(brief);
    expect(text).toContain("Price: From 250,000 RWF\n");
    expect(text).toContain("Price notes (facts for the voice or the caption's later lines only; never on screen, the caption opens with the price above): Final pricing depends on the tower size; installation in Kigali included for 30,000 RWF");
  });

  it("opening lines use the short price, never a number from the notes", () => {
    const lines = suggestHooks(brief, { platform: "tiktok" }).map((h) => h.line).join(" | ");
    expect(lines).not.toContain("30,000");
    expect(lines).toMatch(/250,000 RWF/);
  });

  it("a number from the notes is still a fact for the caption", () => {
    const spec = { scenes: [{ seconds: 3, layers: [], say: "" }], caption: "LEAF Hydro Tower from 250,000 RWF. Installation 30,000 RWF.", hashtags: [] };
    const warnings = factCheck(spec as never, { business: brief.business, product: { name: "LEAF Hydro Tower", price: "From 250,000 RWF", priceNotes: "installation in Kigali included for 30,000 RWF" } });
    expect(warnings.filter((w) => w.found.includes("30,000"))).toEqual([]);
  });
});
