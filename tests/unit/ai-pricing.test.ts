import { describe, expect, it } from "vitest";
import { estimateCostUsd, isApproximatePrice, normalizeModel, resolvePrice } from "@/lib/ai/pricing";

describe("estimateCostUsd", () => {
  it("prices text by tokens", () => {
    // 1,000 in at $0.30/M + 2,000 out at $2.50/M
    expect(estimateCostUsd("gemini-2.5-flash", { inputTokens: 1000, outputTokens: 2000 })).toBeCloseTo(0.0053, 6);
  });
  it("prices images per image when tokens are not reported", () => {
    expect(estimateCostUsd("gemini-2.5-flash-image", { images: 2 })).toBeCloseTo(0.078, 6);
  });
  it("never prices an image below its per-image price when only the text part of the output is reported", () => {
    // 40 text tokens out would be $0.0012; the image itself is $0.039.
    expect(estimateCostUsd("gemini-2.5-flash-image", { inputTokens: 600, outputTokens: 40, images: 1 })).toBeCloseTo(0.00018 + 0.039, 6);
  });
  it("keeps the token price when it is higher than the per-image floor", () => {
    expect(estimateCostUsd("gemini-2.5-flash-image", { outputTokens: 2580, images: 1 })).toBeCloseTo(0.0774, 6);
  });
  it("returns 0 for models of no known family", () => {
    expect(estimateCostUsd("mystery", { inputTokens: 5 })).toBe(0);
  });
});

describe("model names", () => {
  it("ignores prefixes and preview, latest, version and date suffixes", () => {
    expect(normalizeModel("models/gemini-3.1-flash-image-preview")).toBe("gemini-3.1-flash-image");
    expect(normalizeModel("gemini-2.5-flash-image-preview-09-2025")).toBe("gemini-2.5-flash-image");
    expect(normalizeModel("gemini-2.5-flash-001")).toBe("gemini-2.5-flash");
    expect(normalizeModel("claude-opus-5-5-20261001")).toBe("claude-opus-5-5");
    expect(normalizeModel("gemini-3.8-flash-latest")).toBe("gemini-3.8-flash");
  });
  it("prices a preview name like the model (it used to cost $0)", () => {
    expect(estimateCostUsd("gemini-3.1-flash-image-preview", { images: 1 })).toBeCloseTo(0.067, 6);
    expect(resolvePrice("gemini-3.1-flash-image-preview")?.match).toBe("normalized");
  });
  it("prices an unknown model of a known family at the family's dearest and flags it", () => {
    expect(resolvePrice("gemini-4-flash-lite")?.key).toBe("gemini-3.1-flash-lite");
    expect(resolvePrice("gemini-4-flash")?.key).toBe("gemini-3.5-flash");
    expect(resolvePrice("gemini-4-flash-image")?.key).toBe("gemini-3.1-flash-image");
    expect(resolvePrice("claude-sonnet-6")?.key).toBe("claude-sonnet-5-5");
    expect(resolvePrice("eleven_turbo_v3")?.key).toBe("eleven_multilingual_v2");
    expect(isApproximatePrice("gemini-4-flash")).toBe(true);
    expect(isApproximatePrice("gemini-3.8-flash")).toBe(false);
    expect(isApproximatePrice("mystery")).toBe(true);
  });
  it("prices the half-credit ElevenLabs models at half", () => {
    expect(estimateCostUsd("eleven_flash_v2_5", { inputTokens: 1000 })).toBeCloseTo(0.15, 6);
  });
});
