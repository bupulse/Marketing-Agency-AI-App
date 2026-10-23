-- No more templates (owner decision, 23 October 2026, docs/IMAGE_ENGINE.md): every post picture comes from the image
-- engine, so Starter gets AI pictures too, with its own image credits (30 a month: about 15 Lite pictures; when they run
-- out, the owner's own photos are used as they are). Only the STARTER row that has the prerequisite (designs) and not
-- the key yet changes; audited like an edit in Admin -> Plans. No schema change.
WITH before AS (
  SELECT * FROM "PlanDefinition"
  WHERE "key" = 'STARTER'
    AND jsonb_typeof("featureKeys") = 'array'
    AND "featureKeys" @> '["designs"]'::jsonb
    AND NOT "featureKeys" @> '["aiPhotos"]'::jsonb
),
changed AS (
  UPDATE "PlanDefinition" p
  SET "featureKeys" = p."featureKeys" || '["aiPhotos"]'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261030250000_starter_ai_pictures', 'update_plan', 'plan:' || c."key",
  jsonb_build_object('featureKeys', b."featureKeys"),
  jsonb_build_object('featureKeys', c."featureKeys"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";
