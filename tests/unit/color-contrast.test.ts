import { describe, expect, it } from "vitest";
import { brandPalette, contrastRatio, isHexColor, readableTextColor, relativeLuminance } from "@/lib/color-contrast";

describe("color-contrast", () => {
  it("validates 6-digit hex colours", () => {
    expect(isHexColor("#2F6BFF")).toBe(true);
    expect(isHexColor("2F6BFF")).toBe(false);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("red; background:url(x)")).toBe(false);
  });

  it("computes luminance and contrast", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("picks readable text", () => {
    expect(readableTextColor("#000000")).toBe("#FFFFFF");
    expect(readableTextColor("#FFFF00")).toBe("#0B0B0F");
    expect(readableTextColor("#2F6BFF")).toBe("#FFFFFF");
    expect(readableTextColor("nonsense")).toBe("#FFFFFF");
  });

  it("builds a palette with fallbacks", () => {
    expect(brandPalette([])).toEqual(["#2F6BFF", "#7B5CFF", "#7B5CFF"]);
    expect(brandPalette(["#112233"])).toEqual(["#112233", "#112233", "#112233"]);
    expect(brandPalette(["#112233", "bad", "#445566", "#778899"])).toEqual(["#112233", "#445566", "#778899"]);
  });
});
