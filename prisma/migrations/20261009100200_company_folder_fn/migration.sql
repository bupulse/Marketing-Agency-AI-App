-- The Storage helper answered for ANY uid, and signed-in users may call it over RPC (the policies need EXECUTE), so one user
-- could ask for another user's company folder id. It now takes no argument and always answers for the caller (auth.uid()),
-- and the policies call it once per statement instead of once per row.
CREATE OR REPLACE FUNCTION public.bupulse_company_folder()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT b."userId"::text FROM "Membership" m JOIN "Business" b ON b."id" = m."businessId" WHERE m."userId" = auth.uid() LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.bupulse_company_folder() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bupulse_company_folder() TO authenticated;

DO $$
DECLARE
  folder text := $f$bucket_id IN ('brand', 'media', 'designs')
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (storage.foldername(name))[1] = (SELECT public.bupulse_company_folder()))$f$;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping policies';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS bupulse_own_folder_select ON storage.objects;
  DROP POLICY IF EXISTS bupulse_own_folder_insert ON storage.objects;
  DROP POLICY IF EXISTS bupulse_own_folder_update ON storage.objects;
  DROP POLICY IF EXISTS bupulse_own_folder_delete ON storage.objects;
  EXECUTE format('CREATE POLICY bupulse_own_folder_select ON storage.objects FOR SELECT TO authenticated USING (%s)', folder);
  EXECUTE format('CREATE POLICY bupulse_own_folder_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (%s)', folder);
  EXECUTE format('CREATE POLICY bupulse_own_folder_update ON storage.objects FOR UPDATE TO authenticated USING (%1$s) WITH CHECK (%1$s)', folder);
  EXECUTE format('CREATE POLICY bupulse_own_folder_delete ON storage.objects FOR DELETE TO authenticated USING (%s)', folder);
END
$$;

-- The old one-argument version goes last: the policies above no longer use it.
DROP FUNCTION IF EXISTS public.bupulse_company_folder(uuid);
