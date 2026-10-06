import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "@/lib/ai/pricing";

describe("estimateCostUsd", () => {
  it("prices text by tokens", () => {
    // 1,000 in at $0.30/M + 2,000 out at $2.50/M
    expect(estimateCostUsd("gemini-2.5-flash", { inputTokens: 1000, outputTokens: 2000 })).toBeCloseTo(0.0053, 6);
  });
  it("prices images per image when tokens are not reported", () => {
    expect(estimateCostUsd("gemini-2.5-flash-image", { images: 2 })).toBeCloseTo(0.078, 6);
  });
  it("returns 0 for unknown models", () => {
    expect(estimateCostUsd("mystery", { inputTokens: 5 })).toBe(0);
  });
});
