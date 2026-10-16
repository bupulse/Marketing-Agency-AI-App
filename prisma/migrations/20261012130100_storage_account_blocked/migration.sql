-- Phase 9 security review (H2). The Storage policies only checked the folder, so a signed-in user whose account the
-- app treats as read-only (suspended, deletion scheduled, waiting for the demo, trial over, past due, ended) could
-- still write files straight to Storage with the publishable key and their session. Writes (INSERT and UPDATE) now
-- also need the account to be usable; reading and deleting stay as they were (the purge and "delete my files" work).
-- Mirrors accountBlock() in lib/entitlements.ts and the suspended / locked checks of lib/auth/require-user.ts.
-- Answers only for the caller (auth.uid()), like bupulse_company_folder().
CREATE OR REPLACE FUNCTION public.bupulse_account_blocked()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = auth.uid() AND (u."suspendedAt" IS NOT NULL OR u."deletionScheduledFor" IS NOT NULL)
    )
    OR EXISTS (
      SELECT 1
      FROM "Membership" m
      JOIN "Business" b ON b."id" = m."businessId"
      JOIN "User" o ON o."id" = b."userId"
      LEFT JOIN "Subscription" s ON s."userId" = b."userId"
      WHERE m."userId" = auth.uid()
        AND (
          o."suspendedAt" IS NOT NULL
          OR o."deletionScheduledFor" IS NOT NULL
          OR s."status" IN ('PENDING_DEMO', 'EXPIRED', 'PAST_DUE', 'CANCELED')
          OR (s."plan" = 'TRIAL' AND s."trialEndsAt" IS NOT NULL AND s."trialEndsAt" < now())
        )
    )
$$;
REVOKE ALL ON FUNCTION public.bupulse_account_blocked() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bupulse_account_blocked() TO authenticated;

DO $$
DECLARE
  folder text := $f$bucket_id IN ('brand', 'media', 'designs')
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (storage.foldername(name))[1] = (SELECT public.bupulse_company_folder()))
    AND (bucket_id <> 'brand' OR (SELECT public.bupulse_can_manage_company()))$f$;
  writable text := folder || $w$
    AND NOT (SELECT public.bupulse_account_blocked())$w$;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping policies';
    RETURN;
  END IF;
  -- SELECT and DELETE are unchanged (20261009100200_company_folder_fn, 20261009100300_team_integrity).
  DROP POLICY IF EXISTS bupulse_own_folder_insert ON storage.objects;
  DROP POLICY IF EXISTS bupulse_own_folder_update ON storage.objects;
  EXECUTE format('CREATE POLICY bupulse_own_folder_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (%s)', writable);
  EXECUTE format('CREATE POLICY bupulse_own_folder_update ON storage.objects FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', folder, writable);
END
$$;
