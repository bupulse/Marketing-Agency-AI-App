-- Refund requests keep the caller's original request (with the free-text reason) in params.request. Redaction must drop
-- that reason too. CREATE OR REPLACE keeps the owner (audit_redactor) and the grants set by 20261009060000.
CREATE OR REPLACE FUNCTION "redact_audit_for_user"(uid text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('bupulse.audit_redact', 'on', true);
  UPDATE "AuditLog" SET "before" = CASE WHEN "before" IS NULL THEN NULL ELSE '{"redacted": true}'::jsonb END,
                        "after" = CASE WHEN "after" IS NULL THEN NULL ELSE '{"redacted": true}'::jsonb END
  WHERE ("target" = 'user:' || uid
         OR "target" IN (SELECT 'approval:' || "id" FROM "AdminApproval" WHERE "params"->>'userId' = uid))
    AND (("before" IS NOT NULL AND "before" <> '{"redacted": true}'::jsonb) OR ("after" IS NOT NULL AND "after" <> '{"redacted": true}'::jsonb));
  UPDATE "AdminApproval" SET "params" = (CASE WHEN "params" ? 'request' THEN jsonb_set("params", '{request}', ("params"->'request') - 'reason') ELSE "params" END - 'reason') || '{"redacted": true}'::jsonb,
                             "result" = CASE WHEN "result" IS NULL THEN NULL ELSE "result" - 'error' END
  WHERE "params"->>'userId' = uid;
  PERFORM set_config('bupulse.audit_redact', 'off', true);
END;
$$;
