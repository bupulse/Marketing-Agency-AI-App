-- The pricing cards say that posts are made every day (owner decision, 23 October 2026, after
-- 20261030200000_daily_posts_every_plan). The line goes second, after the AI texts: Starter "A post made for you every
-- day, ready to approve", Standard, Business and Pro "Posts made for you every day, ready to approve". Only cards of
-- plans that have daily posts and do not mention them yet change; `features` (the old copy of the highlights) is kept
-- in step, as every save in Admin -> Plans does. Audited like an edit in Admin -> Plans. No schema change.
WITH lines("key", "line") AS (
  VALUES ('STARTER', 'A post made for you every day, ready to approve'),
         ('STANDARD', 'Posts made for you every day, ready to approve'),
         ('BUSINESS', 'Posts made for you every day, ready to approve'),
         ('PRO', 'Posts made for you every day, ready to approve')
),
before AS (
  SELECT p.*, l."line" FROM "PlanDefinition" p JOIN lines l ON l."key" = p."key"
  WHERE jsonb_typeof(p."highlights") = 'array'
    AND jsonb_typeof(p."featureKeys") = 'array'
    AND p."featureKeys" @> '["dailyPosts"]'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p."highlights") h WHERE h ILIKE '%every day%' OR h ILIKE '%daily post%')
),
changed AS (
  UPDATE "PlanDefinition" p
  SET "highlights" = CASE WHEN jsonb_array_length(b."highlights") = 0 THEN jsonb_build_array(b."line")
                          ELSE jsonb_insert(b."highlights", '{0}', to_jsonb(b."line"), true) END,
      "features" = CASE WHEN jsonb_array_length(b."highlights") = 0 THEN jsonb_build_array(b."line")
                        ELSE jsonb_insert(b."highlights", '{0}', to_jsonb(b."line"), true) END,
      "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261030210000_daily_posts_price_cards', 'update_plan', 'plan:' || c."key",
  jsonb_build_object('highlights', b."highlights"),
  jsonb_build_object('highlights', c."highlights"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";
