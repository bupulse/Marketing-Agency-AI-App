-- New prices for videos (owner decision, 14 October 2026: every plan with video may make 120 voiced videos a month,
-- docs/CONTENT_VISUALS.md): Rwanda Business 35,000 -> 50,000 RWF a month (yearly = 10 months: 500,000), the video
-- add-on 10,000 -> 20,000 RWF, the voiceover add-on 5,000 -> 15,000 RWF. Pro is unchanged.
-- Only rows still at the old seeded amounts change (an admin's own price is kept). Each change is written to the audit
-- log, like a change made in Admin -> Regions and prices / Add-on prices. The card price follows the usual rule
-- (lib/region-format.ts cardUsdCents: RWF / the Settings rate x (1 + margin), rounded up to whole dollars) with the
-- database's own settings (defaults 1,450 and 12%), and the region's Paddle price ids are cleared: Admin -> Settings ->
-- Card payments -> "Set up prices" creates the new ones (docs/RELEASE_2.0.md).

WITH s AS (
  SELECT
    COALESCE((SELECT ("value"#>>'{}')::numeric FROM "AdminSetting" WHERE "key" = 'pricing.usdToRwf'), 1450) AS rate,
    COALESCE((SELECT ("value"#>>'{}')::numeric FROM "AdminSetting" WHERE "key" = 'pricing.cardMarginPercent'), 12) AS margin
),
card AS (
  SELECT
    (CEIL(ROUND(50000 / s.rate * (1 + s.margin / 100), 2)) * 100)::int AS monthly,
    (CEIL(ROUND(500000 / s.rate * (1 + s.margin / 100), 2)) * 100)::int AS yearly
  FROM s
),
before AS (
  SELECT * FROM "PlanRegionPrice" WHERE "planKey" = 'BUSINESS' AND "regionKey" = 'RW' AND "monthlyMinor" = 35000 AND "yearlyMinor" = 350000
),
changed AS (
  UPDATE "PlanRegionPrice" p
  SET "monthlyMinor" = 50000, "yearlyMinor" = 500000, "cardMonthlyUsdCents" = card.monthly, "cardYearlyUsdCents" = card.yearly,
      "paddleMonthlyPriceId" = NULL, "paddleYearlyPriceId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
  FROM before b, card
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261019140000_video_prices', 'update_region_price', 'plan:BUSINESS',
  jsonb_build_object('planKey', b."planKey", 'regionKey', b."regionKey", 'currency', b."currency", 'monthlyMinor', b."monthlyMinor", 'yearlyMinor', b."yearlyMinor", 'cardMonthlyUsdCents', b."cardMonthlyUsdCents", 'cardYearlyUsdCents', b."cardYearlyUsdCents"),
  jsonb_build_object('planKey', c."planKey", 'regionKey', c."regionKey", 'currency', c."currency", 'monthlyMinor', c."monthlyMinor", 'yearlyMinor', c."yearlyMinor", 'cardMonthlyUsdCents', c."cardMonthlyUsdCents", 'cardYearlyUsdCents', c."cardYearlyUsdCents"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";

WITH before AS (
  SELECT * FROM "AddonPrice" WHERE "regionKey" = 'RW' AND (("addonKey" = 'video' AND "monthlyMinor" = 10000) OR ("addonKey" = 'voice' AND "monthlyMinor" = 5000))
),
changed AS (
  UPDATE "AddonPrice" a
  SET "monthlyMinor" = CASE a."addonKey" WHEN 'video' THEN 20000 ELSE 15000 END, "updatedBy" = 'migration:20261019140000_video_prices', "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE a."id" = b."id"
  RETURNING a.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261019140000_video_prices', 'set_addon_price', 'addon:RW:' || b."addonKey",
  jsonb_build_object('monthlyMinor', b."monthlyMinor", 'currency', b."currency"),
  jsonb_build_object('monthlyMinor', c."monthlyMinor", 'currency', c."currency"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";
