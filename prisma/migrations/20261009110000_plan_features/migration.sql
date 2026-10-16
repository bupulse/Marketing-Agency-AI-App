-- Plans carry features (lib/features.ts). Two new columns: `highlights` takes over the marketing bullets that lived in
-- `features`, and `featureKeys` lists what the plan unlocks. The old `features` and `capabilities` columns stay and are
-- kept in step by the app, so a build from before this migration keeps working against the migrated table.
-- `featureKeys` is nullable with no default: a row an older build inserts after this migration has NULL there, which
-- the app reads as "the core features plus its capabilities" (the same as the backfill below). A default of '[]' would
-- have given such a plan no features at all.
--
-- Backfill, so NOTHING changes for existing companies:
--   TRIAL and STANDARD: every built feature of the app except the API (they never had API access or Composio);
--   PRO: every built feature of the app plus the client's own Composio account (its two capabilities);
--   any other plan: the core features plus whatever its capabilities already switched on.
-- The lists below are CORE_FEATURES and PRO_FEATURES in lib/plans.ts; tests/features/registry.test.ts keeps them equal.
-- The table already has RLS on and no grants for anon, authenticated or service_role (20261009095100_plan_builder_grants).

ALTER TABLE "PlanDefinition" ADD COLUMN "highlights" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PlanDefinition" ADD COLUMN "featureKeys" JSONB;

UPDATE "PlanDefinition" SET "highlights" = "features" WHERE jsonb_typeof("features") = 'array';

UPDATE "PlanDefinition" SET "featureKeys" = (
  SELECT jsonb_agg(f) FROM (
    SELECT f FROM jsonb_array_elements_text(
      '["content","designs","aiPhotos","calendar","gallery","websiteChat","autopilot","analytics","canva","storeImport","driveImport","webhooks"]'::jsonb
    ) AS core(f)
    UNION
    SELECT 'apiAccess' WHERE "key" = 'PRO' OR "capabilities"->>'apiAccess' = 'true'
    UNION
    SELECT 'ownComposio' WHERE "key" = 'PRO' OR "capabilities"->>'ownComposio' = 'true'
  ) AS keys
);
