-- The inbox and automations (docs/INBOX.md, docs/AUTOMATIONS.md) in the plans, as in docs/bizdev/PLAN.md:
--   * Inbox and contacts: included in Business (Rwanda), Standard and Pro; an add-on for Starter.
--   * Automations: included in Pro; in Rwanda the "Social replies" add-on, 25,000 RWF a month with 1,000 replies
--     (lib/offers/shared.ts FEATURE_INCLUDES).
-- Prices are proposals the owner can change in Admin -> Add-on prices. Each plan change is written to the audit log
-- like an edit in Admin -> Plans. Plans without a feature list (an older build's NULL) are left alone.

WITH before AS (
  SELECT * FROM "PlanDefinition"
  WHERE "key" IN ('BUSINESS', 'STANDARD', 'PRO') AND jsonb_typeof("featureKeys") = 'array'
),
changed AS (
  UPDATE "PlanDefinition" p
  SET
    "featureKeys" = (
      SELECT jsonb_agg(DISTINCT k) FROM jsonb_array_elements_text(
        p."featureKeys" || CASE WHEN p."key" = 'PRO' THEN '["inbox", "automations"]'::jsonb ELSE '["inbox"]'::jsonb END
      ) AS k
    ),
    "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261025100100_inbox_automations_plans', 'update_plan', 'plan:' || c."key",
  jsonb_build_object('featureKeys', b."featureKeys"),
  jsonb_build_object('featureKeys', c."featureKeys"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";

INSERT INTO "AddonPrice" ("id", "addonKey", "regionKey", "currency", "monthlyMinor", "updatedBy", "updatedAt") VALUES
    ('addon_rw_inbox', 'inbox', 'RW', 'RWF', 5000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_automations', 'automations', 'RW', 'RWF', 25000, 'migration', CURRENT_TIMESTAMP)
ON CONFLICT ("addonKey", "regionKey") DO NOTHING;
