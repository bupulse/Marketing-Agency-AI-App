-- These tables are reached only by the app's own database role and the MFA hook function, never through the
-- Supabase API, so the service_role API key gets no access either (anon and authenticated were revoked already).
REVOKE ALL ON TABLE "CronRun", "AdminNote", "AdminMfaFailure" FROM service_role;
REVOKE ALL ON SEQUENCE "AdminMfaFailure_id_seq" FROM service_role;
