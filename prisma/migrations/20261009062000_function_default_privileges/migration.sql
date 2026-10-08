-- Supabase's default privileges give anon, authenticated and service_role EXECUTE on every function the postgres role
-- creates in public, which exposes it as /rest/v1/rpc/<name>. Close that for future functions; a function meant to be
-- called through the API then needs an explicit GRANT EXECUTE. (No function in public relies on the default today.)
-- Safe to repeat. Only affects functions created later by the role that runs migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;
