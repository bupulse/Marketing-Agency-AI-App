-- Companies with several users. Business.userId stays the company account (billing, Storage folder); Membership says who
-- belongs to the company and with which role. Every existing business gets exactly one OWNER membership for its user,
-- so nothing changes for current users.

CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "invitedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Membership_userId_key" ON "Membership"("userId");
CREATE INDEX "Membership_businessId_idx" ON "Membership"("businessId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE INDEX "Invite_businessId_idx" ON "Invite"("businessId");
CREATE INDEX "Invite_email_idx" ON "Invite"("email");
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing businesses: their user becomes the OWNER. Safe to re-run (the unique user id stops a second row).
INSERT INTO "Membership" ("id", "businessId", "userId", "role")
SELECT 'mem_' || replace(gen_random_uuid()::text, '-', ''), b."id", b."userId", 'OWNER'
FROM "Business" b
ON CONFLICT ("userId") DO NOTHING;

-- Same rules as the other internal tables: RLS on, no access for anon, authenticated or service_role (Prisma connects as postgres).
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Membership", "Invite" FROM PUBLIC, anon, authenticated, service_role;

-- Storage: company files live in a folder named after the company account (Business.userId). Members' own folders stay
-- allowed too, so nothing that exists today stops working. The function reads Membership with the owner's rights, because
-- the table itself is closed to the signed-in role; it only ever answers for auth.uid().
CREATE OR REPLACE FUNCTION public.bupulse_company_folder(uid uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT b."userId"::text FROM "Membership" m JOIN "Business" b ON b."id" = m."businessId" WHERE m."userId" = uid LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.bupulse_company_folder(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bupulse_company_folder(uuid) TO authenticated;

DO $$
DECLARE
  folder text := $f$bucket_id IN ('brand', 'media', 'designs')
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (storage.foldername(name))[1] = public.bupulse_company_folder((SELECT auth.uid())))$f$;
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
