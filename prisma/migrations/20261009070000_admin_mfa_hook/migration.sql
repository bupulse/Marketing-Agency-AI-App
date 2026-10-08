-- Admin console: lock an account after 5 wrong authenticator codes in 10 minutes, even when the codes are sent
-- straight to the Supabase Auth API instead of through /admin/verify. Supabase calls this function as an
-- "MFA Verification Attempt" auth hook (turned on in the dashboard, see docs/ADMIN.md).

CREATE TABLE "AdminMfaFailure" (
    "id" BIGSERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "factorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "AdminMfaFailure_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminMfaFailure_userId_createdAt_idx" ON "AdminMfaFailure"("userId", "createdAt");

-- Only the hook reads or writes this table (through the SECURITY DEFINER function below).
ALTER TABLE "AdminMfaFailure" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AdminMfaFailure" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE "AdminMfaFailure_id_seq" FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hook_mfa_verification_attempt(event jsonb) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (event->>'user_id')::uuid;
  fid uuid := (event->>'factor_id')::uuid;
  recent integer;
BEGIN
  DELETE FROM public."AdminMfaFailure" WHERE "createdAt" < now() - interval '1 day';

  SELECT count(*) INTO recent FROM public."AdminMfaFailure"
    WHERE "userId" = uid AND "createdAt" > now() - interval '10 minutes';

  -- Locked: refuse even a correct code, so guessing cannot end in a lucky hit.
  IF recent >= 5 THEN
    RETURN jsonb_build_object('decision', 'reject', 'message', 'Too many wrong codes. Wait 10 minutes and try again.');
  END IF;

  IF (event->>'valid')::boolean IS TRUE THEN
    DELETE FROM public."AdminMfaFailure" WHERE "userId" = uid;
  ELSE
    INSERT INTO public."AdminMfaFailure" ("userId", "factorId") VALUES (uid, fid);
  END IF;

  RETURN jsonb_build_object('decision', 'continue');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hook_mfa_verification_attempt(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hook_mfa_verification_attempt(jsonb) TO supabase_auth_admin;
