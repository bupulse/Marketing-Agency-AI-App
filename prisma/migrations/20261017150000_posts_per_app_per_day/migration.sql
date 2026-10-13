-- Posts per app per day by plan (docs/CONTENT.md): "Create today's content" and Autopilot make at most this many
-- posts per app per day for a product, campaign or General. A key in PlanDefinition.limits (JSON, like seats): trial,
-- Starter and Standard 1, Business and Pro 3, any other plan (custom plans from offers) 1 until set in the offer builder.
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{postsPerAppPerDay}', '3'::jsonb)
WHERE "key" IN ('BUSINESS', 'PRO') AND jsonb_typeof("limits") = 'object';
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{postsPerAppPerDay}', '1'::jsonb)
WHERE "key" NOT IN ('BUSINESS', 'PRO') AND jsonb_typeof("limits") = 'object' AND NOT ("limits" ? 'postsPerAppPerDay');
