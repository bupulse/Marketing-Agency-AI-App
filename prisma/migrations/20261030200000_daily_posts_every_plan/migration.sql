-- Daily posts made for you on every paid plan (owner decision, 23 October 2026; docs/PLANS.md, docs/CONTENT.md "Daily
-- posts"). Business and custom plans have them since 20261027100000_daily_posts; now Starter, Standard and Pro get the
-- feature key too, Starter sized to one app a day (the new limit `dailyPostApps` in PlanDefinition.limits; free designs,
-- as Starter has no AI photos). Only rows that have the prerequisites (content, designs, calendar, gallery) and not the
-- key yet change; each change is written to the audit log like an edit in Admin -> Plans. No schema change.

-- The feature, on Starter, Standard and Pro.
WITH before AS (
  SELECT * FROM "PlanDefinition"
  WHERE "key" IN ('STARTER', 'STANDARD', 'PRO')
    AND jsonb_typeof("featureKeys") = 'array'
    AND "featureKeys" @> '["content", "designs", "calendar", "gallery"]'::jsonb
    AND NOT "featureKeys" @> '["dailyPosts"]'::jsonb
),
changed AS (
  UPDATE "PlanDefinition" p
  SET "featureKeys" = p."featureKeys" || '["dailyPosts"]'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261030200000_daily_posts_every_plan', 'update_plan', 'plan:' || c."key",
  jsonb_build_object('featureKeys', b."featureKeys"),
  jsonb_build_object('featureKeys', c."featureKeys"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";

-- Starter: one app a day (only when no admin set the limit yet).
WITH before AS (
  SELECT * FROM "PlanDefinition"
  WHERE "key" = 'STARTER' AND jsonb_typeof("limits") = 'object' AND NOT ("limits" ? 'dailyPostApps')
),
changed AS (
  UPDATE "PlanDefinition" p
  SET "limits" = p."limits" || '{"dailyPostApps": 1}'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261030200000_daily_posts_every_plan', 'update_plan_limits', 'plan:' || c."key",
  b."limits", c."limits", CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";
