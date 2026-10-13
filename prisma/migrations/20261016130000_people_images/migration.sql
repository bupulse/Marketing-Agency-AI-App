-- People in most images (owner decision, 13 October 2026; docs/CONTENT_VISUALS.md). AI images are limited by plan and
-- included in its price, and each plan carries its own monthly AI allowance per company. Additive and idempotent:
-- a new nullable column, updated plan limits and copy, a new column default.

-- The company AI allowance per plan, in USD a month (lib/ai/budget.ts companyAllowanceUsd). NULL falls back to
-- AI_COMPANY_MONTHLY_USD (default $3), as custom plans do.
ALTER TABLE "PlanDefinition" ADD COLUMN IF NOT EXISTS "aiMonthlyUsd" DOUBLE PRECISION;
ALTER TABLE "PlanDefinition" DROP CONSTRAINT IF EXISTS "PlanDefinition_aiMonthlyUsd_check";
ALTER TABLE "PlanDefinition" ADD CONSTRAINT "PlanDefinition_aiMonthlyUsd_check" CHECK ("aiMonthlyUsd" IS NULL OR ("aiMonthlyUsd" >= 0 AND "aiMonthlyUsd" <= 1000));

UPDATE "PlanDefinition" SET "aiMonthlyUsd" = 2 WHERE "key" IN ('STARTER', 'STANDARD');
UPDATE "PlanDefinition" SET "aiMonthlyUsd" = 6 WHERE "key" IN ('BUSINESS', 'PRO');
UPDATE "PlanDefinition" SET "aiMonthlyUsd" = 1 WHERE "isTrial" = true;

-- AI images a month (the `image` limit): Starter and Standard 30, Business and Pro 100, the trial 5.
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{image}', '30'::jsonb) WHERE "key" IN ('STARTER', 'STANDARD') AND jsonb_typeof("limits") = 'object';
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{image}', '100'::jsonb) WHERE "key" IN ('BUSINESS', 'PRO') AND jsonb_typeof("limits") = 'object';
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{image}', '5'::jsonb) WHERE "isTrial" = true AND jsonb_typeof("limits") = 'object';

-- The pricing cards say what the limit is now: AI images (designs from templates stay unlimited).
UPDATE "PlanDefinition"
SET "highlights" = replace(replace(replace(replace("highlights"::text,
      '30 branded designs a month', '30 AI images a month'),
      '100 branded designs a month', '100 AI images a month'),
      '50 brand designs a month', '30 AI images a month'),
      '150 brand designs a month', '100 AI images a month')::jsonb,
    "features" = replace(replace(replace(replace("features"::text,
      '30 branded designs a month', '30 AI images a month'),
      '100 branded designs a month', '100 AI images a month'),
      '50 brand designs a month', '30 AI images a month'),
      '150 brand designs a month', '100 AI images a month')::jsonb
WHERE "key" IN ('STARTER', 'BUSINESS', 'STANDARD', 'PRO');

-- The image pack add-on (+50 AI images) in Rwanda: 5,000 RWF a month (already seeded as block:image; kept if set).
INSERT INTO "AddonPrice" ("id", "addonKey", "regionKey", "currency", "monthlyMinor", "updatedBy", "updatedAt") VALUES
    ('addon_rw_block_image', 'block:image', 'RW', 'RWF', 5000, 'migration', CURRENT_TIMESTAMP)
ON CONFLICT ("addonKey", "regionKey") DO NOTHING;

-- New Autopilot settings make AI photos with people by default (existing settings keep the owner's choice).
ALTER TABLE "AutopilotSettings" ALTER COLUMN "useAiImages" SET DEFAULT true;
