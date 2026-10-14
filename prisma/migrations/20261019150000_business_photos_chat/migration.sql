-- Business gets AI photos (its 100 AI images a month become usable) and the website chat with leads, 500 replies a
-- month (owner decision, 14 October 2026; at 50,000 RWF a month, migration 20261019140000_video_prices). Until now the
-- Business card promised "100 AI images a month" while AI photos were not in the plan, and Members were told they "see
-- leads" with no leads in the plan. The chat allowance matches the website chat add-on (lib/offers/shared.ts: 500).
-- Only the BUSINESS row changes; the change is written to the audit log like an edit in Admin -> Plans.

WITH before AS (
  SELECT * FROM "PlanDefinition" WHERE "key" = 'BUSINESS'
),
changed AS (
  UPDATE "PlanDefinition" p
  SET
    "featureKeys" = (
      SELECT jsonb_agg(DISTINCT k) FROM jsonb_array_elements_text(p."featureKeys" || '["aiPhotos", "websiteChat"]'::jsonb) AS k
    ),
    "limits" = CASE WHEN COALESCE((p."limits"->>'chat')::int, 0) < 500 THEN jsonb_set(p."limits", '{chat}', '500'::jsonb) ELSE p."limits" END,
    "highlights" = CASE WHEN p."highlights"::text LIKE '%Website chat%' THEN p."highlights"
      ELSE (SELECT jsonb_agg(h ORDER BY o) FROM (
        SELECT h, o FROM jsonb_array_elements(p."highlights") WITH ORDINALITY AS t(h, o)
        UNION ALL SELECT '"Website chat that answers visitors and saves leads: 500 replies a month"'::jsonb, 2.5
      ) x) END,
    "features" = CASE WHEN p."features"::text LIKE '%Website chat%' THEN p."features"
      ELSE (SELECT jsonb_agg(h ORDER BY o) FROM (
        SELECT h, o FROM jsonb_array_elements(p."features") WITH ORDINALITY AS t(h, o)
        UNION ALL SELECT '"Website chat that answers visitors and saves leads: 500 replies a month"'::jsonb, 2.5
      ) x) END,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
    AND jsonb_typeof(p."featureKeys") = 'array' AND jsonb_typeof(p."limits") = 'object'
    AND jsonb_typeof(p."highlights") = 'array' AND jsonb_typeof(p."features") = 'array'
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261019150000_business_photos_chat', 'update_plan', 'plan:BUSINESS',
  jsonb_build_object('featureKeys', b."featureKeys", 'limits', b."limits", 'highlights', b."highlights"),
  jsonb_build_object('featureKeys', c."featureKeys", 'limits', c."limits", 'highlights', c."highlights"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";
