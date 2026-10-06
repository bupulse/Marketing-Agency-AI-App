-- One sign-in method per account: remember whether it was created with a password or Google.
CREATE TYPE "SignUpMethod" AS ENUM ('PASSWORD', 'GOOGLE');

ALTER TABLE "User" ADD COLUMN "signUpMethod" "SignUpMethod" NOT NULL DEFAULT 'PASSWORD';

-- Existing users whose only login is Google.
UPDATE "User" u SET "signUpMethod" = 'GOOGLE'
WHERE EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'google')
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email');
