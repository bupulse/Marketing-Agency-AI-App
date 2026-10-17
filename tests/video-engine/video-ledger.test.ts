import { describe, expect, it } from "vitest";
import { estimateCostUsd, resolvePrice } from "@/lib/ai/pricing";
import { AI_PROVIDER_SERVICE } from "@/lib/admin/service-catalog";
import { billKeyForLedger } from "@/lib/money/costs-shared";
import { SEEDANCE_MODELS, SEEDANCE_USD_PER_M_TOKENS, estimateSeedanceUsd, seedanceLedgerUsage, seedanceTierOf, seedanceTokenRate, seedanceUsage } from "@/lib/video-engine/seedance";
import { VIDEO_LEDGER_FEATURES, isVideoLedgerFeature } from "@/lib/video-engine/ledger-features";

describe("the Video Studio in the cost ledger", () => {
  it("names every video call video-…, so Admin → AI groups them and the company allowance skips them", () => {
    for (const f of Object.values(VIDEO_LEDGER_FEATURES)) expect(isVideoLedgerFeature(f), f).toBe(true);
    expect(isVideoLedgerFeature("content")).toBe(false);
    expect(isVideoLedgerFeature("widget")).toBe(false);
    expect(isVideoLedgerFeature(null)).toBe(false);
  });

  it("prices Seedance tokens per tier, the same in the app's price table and the lab", () => {
    expect(SEEDANCE_USD_PER_M_TOKENS).toEqual({ pro: 7, fast: 5.6, mini: 3.5 });
    for (const tier of ["pro", "fast", "mini"] as const) {
      const model = SEEDANCE_MODELS[tier].id;
      expect(resolvePrice(model)?.match, tier).toBe("exact");
      // 100,000 tokens: the app's ledger price equals the lab's.
      expect(estimateCostUsd(model, { outputTokens: 100_000 })).toBeCloseTo(seedanceUsage(tier, 100_000).costUsd, 4);
      expect(seedanceTierOf(model)).toBe(tier);
      expect(seedanceLedgerUsage(tier, 5)).toEqual({ provider: "byteplus", model, usage: { inputTokens: 0, outputTokens: 5 } });
    }
    // A 720p 5 s clip is about 108,000 tokens: the token price agrees with the per-second estimate, tier by tier.
    for (const tier of ["pro", "fast", "mini"] as const) expect(estimateCostUsd(SEEDANCE_MODELS[tier].id, { outputTokens: 108_000 })).toBeCloseTo(estimateSeedanceUsd({ tier, resolution: "720p", seconds: 5 }), 1);
    expect(resolvePrice("dreamina-seedance-2-0-fast-261231")?.key).toBe(SEEDANCE_MODELS.fast.id); // a newer model id: its family
    expect(seedanceTierOf("something-else")).toBeNull();
  });

  it("SEEDANCE_USD_PER_M_TOKENS moves every tier with the Pro rate", () => {
    process.env.SEEDANCE_USD_PER_M_TOKENS = "10";
    try {
      expect([seedanceTokenRate("pro"), seedanceTokenRate("fast"), seedanceTokenRate("mini")]).toEqual([10, 8, 5]);
    } finally {
      delete process.env.SEEDANCE_USD_PER_M_TOKENS;
    }
  });

  it("BytePlus calls obey the Seedance switch and replace their estimate with the BytePlus bill", () => {
    expect(AI_PROVIDER_SERVICE.byteplus).toBe("seedance");
    expect(billKeyForLedger("byteplus")).toBe("byteplus");
  });
});
