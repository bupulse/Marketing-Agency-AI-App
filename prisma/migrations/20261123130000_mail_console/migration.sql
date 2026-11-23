-- Mail console (owner, 23 Nov 2026): user roles (member / mail admin), storage per user, the default signature,
-- forwarding rules and extra addresses. Additive only.

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "memberId" TEXT;

-- AlterTable
ALTER TABLE "MailMember" ADD COLUMN     "inviteTo" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "quotaMb" INTEGER NOT NULL DEFAULT 250,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'member',
ADD COLUMN     "signature" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "MailSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "signatureTemplate" TEXT NOT NULL DEFAULT '{name}
{title} · BuPulse LTD
{phone} · bupulse.com',
    "signatureLogo" BOOLEAN NOT NULL DEFAULT true,
    "signatureOnReplies" BOOLEAN NOT NULL DEFAULT true,
    "usersEditSignature" BOOLEAN NOT NULL DEFAULT false,
    "sharedSignAsTeam" BOOLEAN NOT NULL DEFAULT true,
    "defaultQuotaMb" INTEGER NOT NULL DEFAULT 250,
    "poolMb" INTEGER NOT NULL DEFAULT 1000,
    "catchAll" TEXT NOT NULL DEFAULT 'other',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailForwarder" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "external" BOOLEAN NOT NULL DEFAULT false,
    "keepCopy" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailForwarder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAlias" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailForwarder_source_idx" ON "MailForwarder"("source");

-- CreateIndex
CREATE UNIQUE INDEX "MailForwarder_source_target_key" ON "MailForwarder"("source", "target");

-- CreateIndex
CREATE UNIQUE INDEX "MailAlias_address_key" ON "MailAlias"("address");

-- CreateIndex
CREATE INDEX "MailAlias_mailboxId_idx" ON "MailAlias"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_memberId_key" ON "Mailbox"("memberId");


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MailSettings', 'MailForwarder', 'MailAlias'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC, anon, authenticated, service_role', t);
    END IF;
  END LOOP;
END
$$;

INSERT INTO "MailSettings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
