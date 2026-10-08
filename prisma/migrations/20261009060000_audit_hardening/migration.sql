-- Hardening of 20261009050000_audit_redaction.
-- Supabase gives anon, authenticated and service_role EXECUTE on new public functions and ALL on new public tables by
-- default. REVOKE FROM PUBLIC does not remove those, so redact_audit_for_user() could be called through the REST API.
-- The app connects as the postgres role (DATABASE_URL and DIRECT_URL), which is the only role that needs these objects.

-- 1. A dedicated NOLOGIN role owns the redaction function. The trigger only allows the redaction when it runs as that
--    role, so setting the custom setting from an ordinary session is not enough.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_redactor') THEN
    CREATE ROLE audit_redactor NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT audit_redactor TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO audit_redactor;
GRANT SELECT, UPDATE ON "AuditLog", "AdminApproval" TO audit_redactor;
-- RLS is on with no policies; this role is the one exception, for these two tables only.
DROP POLICY IF EXISTS "audit_redactor_all" ON "AuditLog";
CREATE POLICY "audit_redactor_all" ON "AuditLog" FOR ALL TO audit_redactor USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "audit_redactor_all" ON "AdminApproval";
CREATE POLICY "audit_redactor_all" ON "AdminApproval" FOR ALL TO audit_redactor USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION "audit_log_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_user = 'audit_redactor'
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

GRANT CREATE ON SCHEMA public TO audit_redactor; -- needed only to take ownership below
ALTER FUNCTION "redact_audit_for_user"(text) OWNER TO audit_redactor;
REVOKE CREATE ON SCHEMA public FROM audit_redactor;
ALTER FUNCTION "redact_audit_for_user"(text) SET search_path = public, pg_temp;

-- 2. Nobody but the app's own role may call the functions or touch the admin tables through Supabase's API roles.
REVOKE ALL ON FUNCTION "redact_audit_for_user"(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION "redact_audit_for_user"(text) TO postgres;
REVOKE ALL ON FUNCTION "audit_log_immutable"() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE "AuditLog", "AdminApproval", "AdminApiKey", "FeatureFlag", "Announcement", "PlanLimitOverride" FROM anon, authenticated, service_role;
