-- B Mail super admins (owner, 23 Nov 2026): office@bupulse.com, the company account, is the system administrator;
-- cyusa@bupulse.com is the owner's own super admin account with the Cyusa mailbox. Data only, idempotent.

INSERT INTO "MailMember" ("id", "email", "name", "role", "mail", "crm", "status", "createdBy", "updatedAt")
VALUES ('mm_office', 'office@bupulse.com', 'BuPulse Office', 'owner', true, true, 'active', 'migration', CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO UPDATE SET "role" = 'owner', "mail" = true, "status" = 'active';

INSERT INTO "MailMember" ("id", "email", "name", "role", "mail", "crm", "status", "createdBy", "updatedAt")
VALUES ('mm_cyusa', 'cyusa@bupulse.com', 'Cyusa', 'owner', true, true, 'invited', 'migration', CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO UPDATE SET "role" = 'owner', "mail" = true;

UPDATE "Mailbox" SET "memberId" = (SELECT "id" FROM "MailMember" WHERE "email" = 'cyusa@bupulse.com')
WHERE "id" = 'mbx_cyusa' AND "memberId" IS NULL;

-- Their first authenticator may be added without an emailed code for 7 days (lib/support/setup-grant.ts reads this key),
-- only while the login has no verified authenticator. A login that does not exist yet is made from the Mail console.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN RETURN; END IF;
  UPDATE auth.users u
  SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('support_setup_until', to_char((now() + interval '7 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  WHERE lower(u.email) IN ('office@bupulse.com', 'cyusa@bupulse.com')
    AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified');
END
$$;
