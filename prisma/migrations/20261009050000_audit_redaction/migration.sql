-- Account deletion removes the personal parts of a user's admin records but keeps the trail (who did what, when, to which id).
-- The audit trigger still refuses DELETE and TRUNCATE. It allows one narrow UPDATE: setting before/after to {"redacted": true},
-- only while redact_audit_for_user() has switched on a transaction-local flag.

CREATE OR REPLACE FUNCTION "audit_log_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('bupulse.audit_redact', true) = 'on'
     AND NEW."id" = OLD."id" AND NEW."actor" = OLD."actor" AND NEW."action" = OLD."action"
     AND NEW."target" IS NOT DISTINCT FROM OLD."target" AND NEW."ip" IS NOT DISTINCT FROM OLD."ip"
     AND NEW."createdAt" = OLD."createdAt"
     AND (NEW."before" IS NULL OR NEW."before" = '{"redacted": true}'::jsonb)
     AND (NEW."after" IS NULL OR NEW."after" = '{"redacted": true}'::jsonb) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION "redact_audit_for_user"(uid text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('bupulse.audit_redact', 'on', true);
  -- Audit rows about the user, and about money requests for the user (their params held the free-text reason).
  UPDATE "AuditLog" SET "before" = CASE WHEN "before" IS NULL THEN NULL ELSE '{"redacted": true}'::jsonb END,
                        "after" = CASE WHEN "after" IS NULL THEN NULL ELSE '{"redacted": true}'::jsonb END
  WHERE ("target" = 'user:' || uid
         OR "target" IN (SELECT 'approval:' || "id" FROM "AdminApproval" WHERE "params"->>'userId' = uid))
    AND (("before" IS NOT NULL AND "before" <> '{"redacted": true}'::jsonb) OR ("after" IS NOT NULL AND "after" <> '{"redacted": true}'::jsonb));
  -- Approvals keep kind, status, decidedAt and the provider ids needed for accounting; the reason and error text go.
  UPDATE "AdminApproval" SET "params" = ("params" - 'reason') || '{"redacted": true}'::jsonb,
                             "result" = CASE WHEN "result" IS NULL THEN NULL ELSE "result" - 'error' END
  WHERE "params"->>'userId' = uid;
  PERFORM set_config('bupulse.audit_redact', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION "redact_audit_for_user"(text) FROM PUBLIC;
