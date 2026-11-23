-- BuPulse Mail (docs/MAIL_CRM.md, 23 Nov 2026): mailboxes, members, threads, messages, attachments, labels, sender
-- rules and the daily send count. Additive only.

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "address" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "signature" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMember" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" UUID,
    "mail" BOOLEAN NOT NULL DEFAULT true,
    "crm" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxAccess" (
    "mailboxId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxAccess_pkey" PRIMARY KEY ("mailboxId","memberId")
);

-- CreateTable
CREATE TABLE "MailThread" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "subjectKey" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "participants" JSONB NOT NULL DEFAULT '[]',
    "folder" TEXT NOT NULL DEFAULT 'inbox',
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "hasSent" BOOLEAN NOT NULL DEFAULT false,
    "hasDraft" BOOLEAN NOT NULL DEFAULT false,
    "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "assignee" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trashedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT '',
    "to" JSONB NOT NULL DEFAULT '[]',
    "cc" JSONB NOT NULL DEFAULT '[]',
    "bcc" JSONB NOT NULL DEFAULT '[]',
    "replyTo" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "html" TEXT,
    "snippet" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendAt" TIMESTAMP(3),
    "authorEmail" TEXT,
    "providerId" TEXT,
    "error" TEXT,
    "rawPath" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "authResults" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "size" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "contentId" TEXT,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailLabel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailSenderRule" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailSenderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailSendDay" (
    "day" TEXT NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MailSendDay_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_address_key" ON "Mailbox"("address");

-- CreateIndex
CREATE UNIQUE INDEX "MailMember_email_key" ON "MailMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MailMember_userId_key" ON "MailMember"("userId");

-- CreateIndex
CREATE INDEX "MailboxAccess_memberId_idx" ON "MailboxAccess"("memberId");

-- CreateIndex
CREATE INDEX "MailThread_mailboxId_folder_lastMessageAt_idx" ON "MailThread"("mailboxId", "folder", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MailThread_mailboxId_subjectKey_idx" ON "MailThread"("mailboxId", "subjectKey");

-- CreateIndex
CREATE INDEX "MailThread_folder_trashedAt_idx" ON "MailThread"("folder", "trashedAt");

-- CreateIndex
CREATE INDEX "MailMessage_threadId_date_idx" ON "MailMessage"("threadId", "date");

-- CreateIndex
CREATE INDEX "MailMessage_status_sendAt_idx" ON "MailMessage"("status", "sendAt");

-- CreateIndex
CREATE INDEX "MailMessage_fromAddress_idx" ON "MailMessage"("fromAddress");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessage_mailboxId_messageId_key" ON "MailMessage"("mailboxId", "messageId");

-- CreateIndex
CREATE INDEX "MailAttachment_messageId_idx" ON "MailAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MailLabel_name_key" ON "MailLabel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MailSenderRule_pattern_key" ON "MailSenderRule"("pattern");

-- AddForeignKey
ALTER TABLE "MailboxAccess" ADD CONSTRAINT "MailboxAccess_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxAccess" ADD CONSTRAINT "MailboxAccess_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MailMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailThread" ADD CONSTRAINT "MailThread_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAttachment" ADD CONSTRAINT "MailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Server-only tables: RLS on with no policies, and no table rights for the API roles (like the other private tables).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Mailbox', 'MailMember', 'MailboxAccess', 'MailThread', 'MailMessage', 'MailAttachment', 'MailLabel', 'MailSenderRule', 'MailSendDay'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC, anon, authenticated, service_role', t);
    END IF;
  END LOOP;
END
$$;

-- The owner's mailboxes (decision 2): four named ones and the catch-all for every other @bupulse.com address.
INSERT INTO "Mailbox" ("id", "address", "name", "kind", "sortOrder", "updatedAt") VALUES
  ('mbx_cyusa', 'cyusa@bupulse.com', 'Cyusa', 'personal', 10, CURRENT_TIMESTAMP),
  ('mbx_office', 'office@bupulse.com', 'Office', 'shared', 20, CURRENT_TIMESTAMP),
  ('mbx_support', 'support@bupulse.com', 'Support', 'shared', 30, CURRENT_TIMESTAMP),
  ('mbx_sales', 'sales@bupulse.com', 'Sales', 'shared', 40, CURRENT_TIMESTAMP),
  ('mbx_other', NULL, 'Other', 'catchall', 90, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- The private "mail" bucket: no Storage policies, so only the server's key reads and writes (lib/mail/storage.ts).
-- 25 MB per file (the most a normal email carries); any type, since attachments can be anything.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('mail', 'mail', false, 26214400)
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;
END
$$;
