-- Regions, regional prices and demo bookings (R1 of docs/RWANDA_LAUNCH_PLAN.md, section 12 for the demo-first trial).
-- Adds columns with defaults and new tables; no table rewrite, nothing dropped. Existing companies keep their plan,
-- status and prices: GLOBAL takes the current USD prices, and only new sign-ups wait for a demo.

-- ---- Business: the billing region, from the sign-up country --------------------------------------------------------
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "pricingRegion" TEXT NOT NULL DEFAULT 'GLOBAL';

-- ---- Subscription: the plan chosen at sign-up and the trial-end reminders ------------------------------------------
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "chosenPlan" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "trialReminder1SentAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "trialReminder2SentAt" TIMESTAMP(3);

-- ---- Tables --------------------------------------------------------------------------------------------------------
CREATE TABLE "PricingRegion" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "countries" TEXT[],
    "paymentMethods" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingRegion_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "PlanRegionPrice" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "regionKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "monthlyMinor" INTEGER NOT NULL,
    "yearlyMinor" INTEGER NOT NULL,
    "cardMonthlyUsdCents" INTEGER,
    "cardYearlyUsdCents" INTEGER,
    "paddleMonthlyPriceId" TEXT,
    "paddleYearlyPriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanRegionPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanRegionPrice_planKey_regionKey_key" ON "PlanRegionPrice"("planKey", "regionKey");
CREATE INDEX "PlanRegionPrice_regionKey_idx" ON "PlanRegionPrice"("regionKey");
ALTER TABLE "PlanRegionPrice" ADD CONSTRAINT "PlanRegionPrice_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "PlanDefinition"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanRegionPrice" ADD CONSTRAINT "PlanRegionPrice_regionKey_fkey" FOREIGN KEY ("regionKey") REFERENCES "PricingRegion"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdminAvailability" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAvailability_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAvailability_weekday_idx" ON "AdminAvailability"("weekday");

CREATE TABLE "DemoBooking" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "notes" TEXT,
    "meetingLink" TEXT,
    "icsToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemoBooking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DemoBooking_icsToken_key" ON "DemoBooking"("icsToken");
CREATE INDEX "DemoBooking_startsAt_idx" ON "DemoBooking"("startsAt");
CREATE INDEX "DemoBooking_businessId_status_idx" ON "DemoBooking"("businessId", "status");
-- Two clients can never hold the same start time: the booking code checks first, the database guarantees it.
CREATE UNIQUE INDEX "DemoBooking_live_slot_key" ON "DemoBooking"("startsAt") WHERE "status" = 'booked';
ALTER TABLE "DemoBooking" ADD CONSTRAINT "DemoBooking_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rules as the other internal tables: RLS on, no access for anon, authenticated or service_role (Prisma connects as postgres).
ALTER TABLE "PricingRegion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanRegionPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemoBooking" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PricingRegion", "PlanRegionPrice", "AdminAvailability", "DemoBooking" FROM PUBLIC, anon, authenticated, service_role;

-- ---- Seeds: regions ------------------------------------------------------------------------------------------------
INSERT INTO "PricingRegion" ("key", "name", "currency", "countries", "paymentMethods", "active", "sortOrder", "updatedAt") VALUES
  ('RW', 'Rwanda', 'RWF', ARRAY['RW'], ARRAY['momo', 'card'], true, 0, CURRENT_TIMESTAMP),
  ('EAC', 'East Africa', 'USD', ARRAY['KE', 'UG', 'TZ', 'BI', 'SS', 'CD', 'SO'], ARRAY['card'], true, 10, CURRENT_TIMESTAMP),
  ('GLOBAL', 'Everywhere else', 'USD', ARRAY[]::TEXT[], ARRAY['card'], true, 20, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- ---- Seeds: the Rwanda plans (sold only in RW: they get no GLOBAL price) ---------------------------------------------
-- The plan-level USD price is the derived card price (15,000 RWF / 1,450 x 1.12 = $11.59, rounded up to $12), so the
-- plan builder's own checks pass; the price clients see is the RW row below.
INSERT INTO "PlanDefinition" ("id", "key", "name", "description", "isTrial", "trialDays", "status", "sortOrder", "highlight", "monthlyPriceCents", "yearlyPriceCents", "currency", "limits", "highlights", "featureKeys", "features", "capabilities", "paddlePrices", "syncState", "createdAt", "updatedAt") VALUES
  ('plan_starter', 'STARTER', 'Starter', 'For owners who want steady, on-brand posts every week.', false, NULL, 'active', 5, false, 1200, 11600, 'USD',
   '{"text":60,"image":30,"chat":0,"videoSeconds":0,"voiceCharacters":0,"seats":1}',
   '["60 AI texts a month: captions, scripts and headlines","30 branded designs a month","Calendar, scheduling and auto-publishing","Media gallery","1 user"]',
   '["content","designs","calendar","gallery"]',
   '["60 AI texts a month: captions, scripts and headlines","30 branded designs a month","Calendar, scheduling and auto-publishing","Media gallery","1 user"]',
   '{"apiAccess":false,"ownComposio":false}', '[]', 'not_synced', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_business', 'BUSINESS', 'Business', 'For busy businesses that post often and work as a team.', false, NULL, 'active', 6, true, 2800, 27100, 'USD',
   '{"text":200,"image":100,"chat":0,"videoSeconds":0,"voiceCharacters":0,"seats":3}',
   '["200 AI texts a month: captions, scripts and headlines","100 branded designs a month","Calendar, scheduling and auto-publishing","Media gallery","Up to 3 users"]',
   '["content","designs","calendar","gallery"]',
   '["200 AI texts a month: captions, scripts and headlines","100 branded designs a month","Calendar, scheduling and auto-publishing","Media gallery","Up to 3 users"]',
   '{"apiAccess":false,"ownComposio":false}', '[]', 'not_synced', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- ---- Seeds: prices per region ----------------------------------------------------------------------------------------
-- GLOBAL keeps today's USD prices: every paid plan that exists now (STANDARD $49/$490, PRO $99/$990 and any plan an admin
-- created) is copied as it is, so nothing changes for anyone outside Rwanda and East Africa.
INSERT INTO "PlanRegionPrice" ("id", "planKey", "regionKey", "currency", "monthlyMinor", "yearlyMinor", "cardMonthlyUsdCents", "cardYearlyUsdCents", "paddleMonthlyPriceId", "paddleYearlyPriceId", "updatedAt")
SELECT 'prp_' || replace(gen_random_uuid()::text, '-', ''), p."key", 'GLOBAL', 'USD', p."monthlyPriceCents", p."yearlyPriceCents", p."monthlyPriceCents", p."yearlyPriceCents", p."paddleMonthlyPriceId", p."paddleYearlyPriceId", CURRENT_TIMESTAMP
FROM "PlanDefinition" p
WHERE p."isTrial" = false AND p."key" NOT IN ('STARTER', 'BUSINESS')
ON CONFLICT ("planKey", "regionKey") DO NOTHING;

-- East Africa: Standard $25, Pro $49, yearly = 10 months. Card through Paddle; the Paddle price ids are filled by the sync (TODO).
INSERT INTO "PlanRegionPrice" ("id", "planKey", "regionKey", "currency", "monthlyMinor", "yearlyMinor", "cardMonthlyUsdCents", "cardYearlyUsdCents", "updatedAt")
SELECT 'prp_' || replace(gen_random_uuid()::text, '-', ''), v.plan, 'EAC', 'USD', v.monthly, v.yearly, v.monthly, v.yearly, CURRENT_TIMESTAMP
FROM (VALUES ('STANDARD', 2500, 25000), ('PRO', 4900, 49000)) AS v(plan, monthly, yearly)
WHERE EXISTS (SELECT 1 FROM "PlanDefinition" p WHERE p."key" = v.plan)
ON CONFLICT ("planKey", "regionKey") DO NOTHING;

-- Rwanda: Starter 15,000 RWF, Business 35,000 RWF, yearly = 10 months. The card price is RWF / 1,450 x 1.12, rounded
-- up to whole dollars (lib/region-format.ts cardUsdCents); the admin recomputes it from Settings when the rate moves.
INSERT INTO "PlanRegionPrice" ("id", "planKey", "regionKey", "currency", "monthlyMinor", "yearlyMinor", "cardMonthlyUsdCents", "cardYearlyUsdCents", "updatedAt")
SELECT 'prp_' || replace(gen_random_uuid()::text, '-', ''), v.plan, 'RW', 'RWF', v.monthly, v.yearly, v.card_monthly, v.card_yearly, CURRENT_TIMESTAMP
FROM (VALUES ('STARTER', 15000, 150000, 1200, 11600), ('BUSINESS', 35000, 350000, 2800, 27100)) AS v(plan, monthly, yearly, card_monthly, card_yearly)
WHERE EXISTS (SELECT 1 FROM "PlanDefinition" p WHERE p."key" = v.plan)
ON CONFLICT ("planKey", "regionKey") DO NOTHING;

-- ---- Seeds: existing companies get their region from the country they signed up with ---------------------------------
UPDATE "Business" SET "pricingRegion" = 'RW' WHERE "country" = 'Rwanda';
UPDATE "Business" SET "pricingRegion" = 'EAC' WHERE "country" IN ('Kenya', 'Uganda', 'Tanzania', 'Burundi', 'South Sudan', 'Congo (Democratic Republic)', 'Somalia');

-- ---- Seeds: demo availability, Monday to Friday 09:00-17:00 Africa/Kigali (edit in Admin -> Settings) -----------------
INSERT INTO "AdminAvailability" ("id", "weekday", "startMinute", "endMinute")
SELECT 'avail_' || d, d, 540, 1020 FROM generate_series(1, 5) AS d
WHERE NOT EXISTS (SELECT 1 FROM "AdminAvailability");
