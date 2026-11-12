-- Regions: Live / Coming soon, more regions, VAT per region (docs/REGIONS.md). Additive and safe in both deploy orders:
-- two columns with defaults on "PricingRegion", two on "ManualPayment", and data. A build from before this migration
-- ignores the new columns, and the new regions are inactive (= coming soon), which it already treats as "not matched".

-- ---- VAT per region: added on top of the region's prices (typed before VAT); basis points, 1800 = 18% ---------------
ALTER TABLE "PricingRegion" ADD COLUMN IF NOT EXISTS "vatRateBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PricingRegion" ADD COLUMN IF NOT EXISTS "vatLabel" TEXT NOT NULL DEFAULT 'VAT';
ALTER TABLE "PricingRegion" DROP CONSTRAINT IF EXISTS "PricingRegion_vatRateBps_check";
ALTER TABLE "PricingRegion" ADD CONSTRAINT "PricingRegion_vatRateBps_check" CHECK ("vatRateBps" >= 0 AND "vatRateBps" <= 10000);
-- Rwanda starts at 18%; every other region stays at 0 (off).
UPDATE "PricingRegion" SET "vatRateBps" = 1800, "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'RW' AND "vatRateBps" = 0;

-- ---- VAT snapshot on Mobile Money payments: amountMinor stays what the client sends (VAT included) -------------------
ALTER TABLE "ManualPayment" ADD COLUMN IF NOT EXISTS "vatMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ManualPayment" ADD COLUMN IF NOT EXISTS "vatRateBps" INTEGER;

-- ---- East Africa: the Horn of Africa joins (a country already in another region keeps it) ---------------------------
UPDATE "PricingRegion" r
SET "countries" = r."countries" || ARRAY(
      SELECT c FROM unnest(ARRAY['ET', 'DJ', 'ER']) AS c
      WHERE NOT EXISTS (SELECT 1 FROM "PricingRegion" o WHERE c = ANY(o."countries"))
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE r."key" = 'EAC';

-- ---- The catch-all is "Rest of the world", listed last (only when an admin has not renamed or moved it) -------------
UPDATE "PricingRegion" SET "name" = 'Rest of the world', "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'GLOBAL' AND "name" = 'Everywhere else';
UPDATE "PricingRegion" SET "sortOrder" = 900, "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'GLOBAL' AND "sortOrder" = 20;

-- ---- Coming soon regions (inactive). A country already in any region stays there; a region left with no country is
-- not created (it would look like a second catch-all). Every African country ends up in a region.
DO $$
DECLARE
  r RECORD;
  free TEXT[];
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('WEST_AFRICA', 'West Africa', 30, ARRAY['NG', 'GH', 'CI', 'SN', 'ML', 'BF', 'NE', 'GN', 'GW', 'SL', 'LR', 'TG', 'BJ', 'GM', 'CV', 'MR', 'SH']),
    ('SOUTHERN_AFRICA', 'Southern Africa', 40, ARRAY['ZA', 'NA', 'BW', 'LS', 'SZ', 'ZW', 'ZM', 'MW', 'MZ', 'AO', 'MG', 'MU', 'SC', 'KM', 'RE', 'YT']),
    ('NORTH_AFRICA', 'Northern Africa', 50, ARRAY['EG', 'LY', 'TN', 'DZ', 'MA', 'SD', 'EH']),
    ('CENTRAL_AFRICA', 'Central Africa', 55, ARRAY['CM', 'CF', 'TD', 'CG', 'GQ', 'GA', 'ST']),
    ('EUROPE', 'Europe', 60, ARRAY['AD', 'AL', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SJ', 'SK', 'SM', 'UA', 'VA', 'XK']),
    ('ASIA', 'Asia', 70, ARRAY['AE', 'AF', 'AM', 'AZ', 'BD', 'BH', 'BN', 'BT', 'CN', 'GE', 'HK', 'ID', 'IL', 'IN', 'IQ', 'IR', 'JO', 'JP', 'KG', 'KH', 'KP', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LK', 'MM', 'MN', 'MO', 'MV', 'MY', 'NP', 'OM', 'PH', 'PK', 'PS', 'QA', 'SA', 'SG', 'SY', 'TH', 'TJ', 'TL', 'TM', 'TR', 'TW', 'UZ', 'VN', 'YE']),
    ('OCEANIA', 'Australia and Oceania', 80, ARRAY['AU', 'NZ', 'FJ', 'PG', 'SB', 'VU', 'NC', 'PF', 'WS', 'TO', 'KI', 'TV', 'NR', 'PW', 'FM', 'MH', 'AS', 'GU', 'MP', 'CK', 'NU', 'TK', 'WF', 'NF', 'PN', 'CC', 'CX']),
    ('NORTH_AMERICA', 'North America', 90, ARRAY['US', 'CA', 'MX', 'GL', 'BM', 'PM', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA', 'CU', 'JM', 'HT', 'DO', 'PR', 'BS', 'BB', 'TT', 'AG', 'DM', 'GD', 'KN', 'LC', 'VC', 'AI', 'AW', 'BL', 'BQ', 'CW', 'KY', 'MF', 'MQ', 'GP', 'MS', 'SX', 'TC', 'VG', 'VI']),
    ('SOUTH_AMERICA', 'South America', 100, ARRAY['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE', 'GF', 'FK'])
  ) AS v("key", "name", "sortOrder", "countries")
  LOOP
    IF EXISTS (SELECT 1 FROM "PricingRegion" WHERE "key" = r."key") THEN CONTINUE; END IF;
    free := ARRAY(
      SELECT c FROM unnest(r."countries") WITH ORDINALITY AS t(c, i)
      WHERE NOT EXISTS (SELECT 1 FROM "PricingRegion" o WHERE t.c = ANY(o."countries"))
      ORDER BY t.i
    );
    IF cardinality(free) = 0 THEN CONTINUE; END IF;
    INSERT INTO "PricingRegion" ("key", "name", "currency", "countries", "paymentMethods", "active", "sortOrder", "vatRateBps", "vatLabel", "updatedAt")
    VALUES (r."key", r."name", 'USD', free, ARRAY['card'], false, r."sortOrder", 0, 'VAT', CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO NOTHING;
  END LOOP;
END $$;

-- ---- Plans and regions: a plan is offered where it has a PlanRegionPrice row. A plan with no row at all was offered
-- in the catch-all at its own price (the old implicit rule); give it that row, so the plan form shows the truth.
-- Custom plans and the trial are never offered on the pricing page and get none.
INSERT INTO "PlanRegionPrice" ("id", "planKey", "regionKey", "currency", "monthlyMinor", "yearlyMinor", "cardMonthlyUsdCents", "cardYearlyUsdCents", "paddleMonthlyPriceId", "paddleYearlyPriceId", "updatedAt")
SELECT 'prp_' || replace(gen_random_uuid()::text, '-', ''), p."key", 'GLOBAL', upper(p."currency"), p."monthlyPriceCents", p."yearlyPriceCents", p."monthlyPriceCents", p."yearlyPriceCents", p."paddleMonthlyPriceId", p."paddleYearlyPriceId", CURRENT_TIMESTAMP
FROM "PlanDefinition" p
WHERE p."isTrial" = false AND p."isCustom" = false
  AND NOT EXISTS (SELECT 1 FROM "PlanRegionPrice" x WHERE x."planKey" = p."key")
  AND EXISTS (SELECT 1 FROM "PricingRegion" g WHERE g."key" = 'GLOBAL')
ON CONFLICT ("planKey", "regionKey") DO NOTHING;
