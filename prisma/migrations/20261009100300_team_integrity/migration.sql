-- A company can never have two owners (ownership moves by demoting first, then promoting, in one transaction).
CREATE UNIQUE INDEX "Membership_one_owner_per_business" ON "Membership"("businessId") WHERE "role" = 'OWNER';

-- Admins opt in to the lead, digest and post alerts that go to the Owner. Everyone starts off.
ALTER TABLE "Membership" ADD COLUMN "notifyEmail" BOOLEAN NOT NULL DEFAULT false;

-- Brand files (the logo) may be changed by the Owner and Admins only; Members can still read them. The function answers
-- only for the caller, like bupulse_company_folder().
CREATE OR REPLACE FUNCTION public.bupulse_can_manage_company()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = auth.uid() AND m."role" IN ('OWNER', 'ADMIN'))
$$;
REVOKE ALL ON FUNCTION public.bupulse_can_manage_company() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bupulse_can_manage_company() TO authenticated;

DO $$
DECLARE
  folder text := $f$bucket_id IN ('brand', 'media', 'designs')
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (storage.foldername(name))[1] = (SELECT public.bupulse_company_folder()))
    AND (bucket_id <> 'brand' OR (SELECT public.bupulse_can_manage_company()))$f$;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping policies';
    RETURN;
  END IF;
  -- Reading stays as it was: every member of the company sees the company's files.
  DROP POLICY IF EXISTS bupulse_own_folder_insert ON storage.objects;
  DROP POLICY IF EXISTS bupulse_own_folder_update ON storage.objects;
  DROP POLICY IF EXISTS bupulse_own_folder_delete ON storage.objects;
  EXECUTE format('CREATE POLICY bupulse_own_folder_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (%s)', folder);
  EXECUTE format('CREATE POLICY bupulse_own_folder_update ON storage.objects FOR UPDATE TO authenticated USING (%1$s) WITH CHECK (%1$s)', folder);
  EXECUTE format('CREATE POLICY bupulse_own_folder_delete ON storage.objects FOR DELETE TO authenticated USING (%s)', folder);
END
$$;
