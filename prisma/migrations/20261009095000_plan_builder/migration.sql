-- Plan builder: plans become rows an admin manages (/admin/plans) instead of the Plan enum + lib/plans.ts.
-- Existing data is kept as is: Subscription.plan changes from the enum to the same words as text ('TRIAL', 'STANDARD', 'PRO'),
-- so every existing row keeps its value and every comparison in the code still matches. The three plans are seeded with
-- exactly the old limits, prices and features, and any runtime limit override is folded into the plan's limits.

CREATE TABLE "PlanDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "trialDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "yearlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "paddleProductId" TEXT,
    "paddleMonthlyPriceId" TEXT,
    "paddleYearlyPriceId" TEXT,
    "paddlePrices" JSONB NOT NULL DEFAULT '[]',
    "syncState" TEXT NOT NULL DEFAULT 'not_synced',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanDefinition_key_key" ON "PlanDefinition"("key");

CREATE TABLE "PlanPriceChange" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "oldMonthlyCents" INTEGER NOT NULL,
    "newMonthlyCents" INTEGER NOT NULL,
    "oldYearlyCents" INTEGER NOT NULL,
    "newYearlyCents" INTEGER NOT NULL,
    "oldMonthlyPriceId" TEXT,
    "oldYearlyPriceId" TEXT,
    "newMonthlyPriceId" TEXT,
    "newYearlyPriceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "PlanPriceChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlanPriceChange_planKey_createdAt_idx" ON "PlanPriceChange"("planKey", "createdAt");
CREATE INDEX "PlanPriceChange_status_idx" ON "PlanPriceChange"("status");

CREATE TABLE "PlanPriceChangeItem" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "providerSubscriptionId" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "oldPriceId" TEXT NOT NULL,
    "newPriceId" TEXT NOT NULL,
    "oldCents" INTEGER NOT NULL,
    "newCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "noticeSentAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanPriceChangeItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanPriceChangeItem_changeId_userId_key" ON "PlanPriceChangeItem"("changeId", "userId");
CREATE INDEX "PlanPriceChangeItem_changeId_status_idx" ON "PlanPriceChangeItem"("changeId", "status");
ALTER TABLE "PlanPriceChange" ADD CONSTRAINT "PlanPriceChange_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "PlanDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanPriceChangeItem" ADD CONSTRAINT "PlanPriceChangeItem_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "PlanPriceChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The three current plans, exactly as lib/plans.ts and the pricing page had them (TRIAL_DAYS 7, $49 / $490, $99 / $990).
INSERT INTO "PlanDefinition" ("id", "key", "name", "description", "isTrial", "trialDays", "status", "sortOrder", "highlight", "monthlyPriceCents", "yearlyPriceCents", "currency", "limits", "features", "capabilities", "updatedAt") VALUES
('plan_trial', 'TRIAL', 'Free trial', 'Try everything free. No card needed.', true, 7, 'active', 0, false, 0, 0, 'USD',
 '{"text":10,"image":5,"videoSeconds":0,"voiceCharacters":0,"chat":50}',
 '[]',
 '{"apiAccess":false,"ownComposio":false}', CURRENT_TIMESTAMP),
('plan_standard', 'STANDARD', 'Standard', 'For owners who want steady, on-brand content every week.', false, NULL, 'active', 10, false, 4900, 49000, 'USD',
 '{"text":100,"image":50,"videoSeconds":0,"voiceCharacters":0,"chat":1000}',
 '["100 AI text generations a month","50 brand designs a month","Post to 5 social networks","Lead-capturing chat widget","Content calendar and scheduling"]',
 '{"apiAccess":false,"ownComposio":false}', CURRENT_TIMESTAMP),
('plan_pro', 'PRO', 'Pro', 'For busy businesses that post often and want every connection.', false, NULL, 'active', 20, true, 9900, 99000, 'USD',
 '{"text":300,"image":150,"videoSeconds":120,"voiceCharacters":20000,"chat":5000}',
 '["300 AI text generations a month","150 brand designs a month","Everything in Standard","App connectors and API access","Use your own Composio account","Video and voiceover when released"]',
 '{"apiAccess":true,"ownComposio":true}', CURRENT_TIMESTAMP);

-- Fold the admin's runtime limit overrides into the plans' own limits, then retire that table.
UPDATE "PlanDefinition" d SET "limits" = d."limits" || o."limits"
FROM "PlanLimitOverride" o WHERE d."key" = o."plan"::text;
DROP TABLE "PlanLimitOverride";

-- Subscription.plan: enum -> text holding the plan key, with a foreign key so a subscription can never point at nothing.
ALTER TABLE "Subscription" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text;
ALTER TABLE "Subscription" ALTER COLUMN "plan" SET DEFAULT 'TRIAL';
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_plan_fkey" FOREIGN KEY ("plan") REFERENCES "PlanDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Announcement" ALTER COLUMN "plans" TYPE TEXT[] USING "plans"::text[];
DROP TYPE "Plan";

ALTER TABLE "PlanDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanPriceChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanPriceChangeItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PlanDefinition", "PlanPriceChange", "PlanPriceChangeItem" FROM PUBLIC, anon, authenticated;
