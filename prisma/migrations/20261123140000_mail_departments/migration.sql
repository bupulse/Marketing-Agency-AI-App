-- Mail departments (owner, 23 Nov 2026): department mailboxes (support@ for everyone, sales@ and accounting@ for their
-- department), automatic copies by tag (bank, invoices, payments, receipts into accounting@), company details for
-- signatures, glass settings, profile photos and personal preferences. Additive only.

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'members';

-- AlterTable
ALTER TABLE "MailMember" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "photoPath" TEXT,
ADD COLUMN     "prefs" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "MailThread" ADD COLUMN     "copiedFrom" TEXT,
ADD COLUMN     "copyKind" TEXT,
ADD COLUMN     "important" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "MailSettings" ADD COLUMN     "address" TEXT NOT NULL DEFAULT 'Kigali, Rwanda',
ADD COLUMN     "companyPhone" TEXT,
ADD COLUMN     "ctaText" TEXT NOT NULL DEFAULT 'Get your free BuPulse quote',
ADD COLUMN     "ctaUrl" TEXT NOT NULL DEFAULT 'https://bupulse.com/quote',
ADD COLUMN     "defaultTemplate" TEXT NOT NULL DEFAULT 'classic',
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "glassClarity" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "glassTint" TEXT NOT NULL DEFAULT 'light',
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "usersChangeGlass" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "website" TEXT NOT NULL DEFAULT 'bupulse.com';

-- CreateTable
CREATE TABLE "MailDepartment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2f6bff',
    "headMemberId" TEXT,
    "mailboxId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailCopyRule" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailCopyRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailDepartment_name_key" ON "MailDepartment"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MailDepartment_mailboxId_key" ON "MailDepartment"("mailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "MailCopyRule_tag_mailboxId_key" ON "MailCopyRule"("tag", "mailboxId");


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MailDepartment', 'MailCopyRule'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC, anon, authenticated, service_role', t);
    END IF;
  END LOOP;
END
$$;

-- accounting@ for the Accounting department; support@ seen by everyone; sales@ and office@ by their departments.
INSERT INTO "Mailbox" ("id", "address", "name", "kind", "sortOrder", "visibility", "updatedAt") VALUES
  ('mbx_accounting', 'accounting@bupulse.com', 'Accounting', 'shared', 45, 'department', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
UPDATE "Mailbox" SET "visibility" = 'everyone' WHERE "id" = 'mbx_support';
UPDATE "Mailbox" SET "visibility" = 'department' WHERE "id" IN ('mbx_sales', 'mbx_office');

INSERT INTO "MailDepartment" ("id", "name", "color", "mailboxId", "sortOrder", "updatedAt") VALUES
  ('dep_leadership', 'Leadership', '#2f6bff', NULL, 10, CURRENT_TIMESTAMP),
  ('dep_sales', 'Sales', '#e0662a', 'mbx_sales', 20, CURRENT_TIMESTAMP),
  ('dep_support', 'Support', '#14a3a6', 'mbx_support', 30, CURRENT_TIMESTAMP),
  ('dep_accounting', 'Accounting', '#1f9d55', 'mbx_accounting', 40, CURRENT_TIMESTAMP),
  ('dep_office', 'Office', '#7b5cff', 'mbx_office', 50, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
UPDATE "Mailbox" SET "departmentId" = 'dep_sales' WHERE "id" = 'mbx_sales';
UPDATE "Mailbox" SET "departmentId" = 'dep_support' WHERE "id" = 'mbx_support';
UPDATE "Mailbox" SET "departmentId" = 'dep_accounting' WHERE "id" = 'mbx_accounting';
UPDATE "Mailbox" SET "departmentId" = 'dep_office' WHERE "id" = 'mbx_office';

INSERT INTO "MailCopyRule" ("id", "tag", "mailboxId", "createdBy") VALUES
  ('cpr_bank', 'bank', 'mbx_accounting', 'migration'),
  ('cpr_invoices', 'invoices', 'mbx_accounting', 'migration'),
  ('cpr_payments', 'payments', 'mbx_accounting', 'migration'),
  ('cpr_receipts', 'receipts', 'mbx_accounting', 'migration')
ON CONFLICT DO NOTHING;
