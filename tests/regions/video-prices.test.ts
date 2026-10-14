import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardUsdCents, DEFAULT_CARD_MARGIN_PERCENT, DEFAULT_USD_TO_RWF } from "@/lib/region-format";
import { YEARLY_MONTHS } from "@/lib/offers/shared";

// The video prices (owner decision, 14 October 2026; docs/PLANS.md): Rwanda Business 50,000 RWF a month, yearly 10
// months, the card price by the usual rule; the video add-on 20,000 RWF and the voiceover add-on 15,000 RWF. Changed by
// a migration that only moves rows still at the old seeded amounts and audits each change.

const SQL = readFileSync("prisma/migrations/20261019140000_video_prices/migration.sql", "utf8");

describe("video prices (20261019140000_video_prices)", () => {
  it("Business RW 50,000 a month, 500,000 a year (10 months); its card price by the usual rule ($39, $387 with the defaults)", () => {
    expect(SQL).toContain(`SET "monthlyMinor" = 50000, "yearlyMinor" = 500000`);
    expect(500000).toBe(50000 * YEARLY_MONTHS);
    expect(SQL).toContain(`"monthlyMinor" = 35000 AND "yearlyMinor" = 350000`);
    // The SQL rounds like cardUsdCents: to cents first, then up to whole dollars.
    expect(SQL).toContain("CEIL(ROUND(50000 / s.rate * (1 + s.margin / 100), 2)) * 100");
    expect(SQL).toContain(`COALESCE((SELECT ("value"#>>'{}')::numeric FROM "AdminSetting" WHERE "key" = 'pricing.usdToRwf'), ${DEFAULT_USD_TO_RWF})`);
    expect(SQL).toContain(`'pricing.cardMarginPercent'), ${DEFAULT_CARD_MARGIN_PERCENT})`);
    expect(cardUsdCents(50000, "RWF", DEFAULT_USD_TO_RWF, DEFAULT_CARD_MARGIN_PERCENT)).toBe(3900);
    expect(cardUsdCents(500000, "RWF", DEFAULT_USD_TO_RWF, DEFAULT_CARD_MARGIN_PERCENT)).toBe(38700);
    // The old Paddle prices are wrong now: cleared, "Set up prices" makes new ones.
    expect(SQL).toContain(`"paddleMonthlyPriceId" = NULL, "paddleYearlyPriceId" = NULL`);
  });

  it("the add-ons: video 10,000 -> 20,000 RWF, voiceover 5,000 -> 15,000 RWF, only from the old amounts", () => {
    expect(SQL).toContain(`("addonKey" = 'video' AND "monthlyMinor" = 10000) OR ("addonKey" = 'voice' AND "monthlyMinor" = 5000)`);
    expect(SQL).toContain(`CASE a."addonKey" WHEN 'video' THEN 20000 ELSE 15000 END`);
  });

  it("every change is in the audit log, like the admin pages' own changes", () => {
    expect(SQL.match(/INSERT INTO "AuditLog"/g)).toHaveLength(2);
    expect(SQL).toContain(`'update_region_price', 'plan:BUSINESS'`);
    expect(SQL).toContain(`'set_addon_price', 'addon:RW:' || b."addonKey"`);
    expect(SQL).toContain("'migration:20261019140000_video_prices'");
  });
});
