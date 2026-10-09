-- Team seats per plan: how many users a company on the plan may have (members plus pending invites).
-- Written into the plan's limits JSON for the three seeded plans; an admin edits it in the plan builder afterwards.
-- Plans that already have a seats value are left alone, so re-running is safe.
UPDATE "PlanDefinition"
SET "limits" = "limits" || jsonb_build_object('seats', CASE "key" WHEN 'TRIAL' THEN 1 WHEN 'STANDARD' THEN 3 WHEN 'PRO' THEN 10 ELSE 1 END)
WHERE NOT ("limits" ? 'seats');
