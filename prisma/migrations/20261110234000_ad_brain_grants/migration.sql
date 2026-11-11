-- Like every table: only the server (the database owner) reads and writes the Ad Brain's tables; the browser's
-- Supabase keys never can (tests/security/rls-coverage.test.ts).
REVOKE ALL ON TABLE "AdJob", "AdAsset" FROM PUBLIC, anon, authenticated, service_role;
