-- B Mail agent API (docs/mail-crm/AGENT_API.md): keys an outreach agent uses to send from one mailbox and read what
-- arrives in it, and which key sent each message. Additive only.

CREATE TABLE IF NOT EXISTS "MailAgentKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "memberId" TEXT,
    "fromName" TEXT,
    "signature" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailAgentKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MailAgentKey_hash_key" ON "MailAgentKey"("hash");
CREATE INDEX IF NOT EXISTS "MailAgentKey_mailboxId_idx" ON "MailAgentKey"("mailboxId");
-- Server-only, like every Mail table: RLS on, no policies.
ALTER TABLE "MailAgentKey" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "MailMessage" ADD COLUMN IF NOT EXISTS "agentKeyId" TEXT;
CREATE INDEX IF NOT EXISTS "MailMessage_mailboxId_createdAt_idx" ON "MailMessage"("mailboxId", "createdAt");
CREATE INDEX IF NOT EXISTS "MailMessage_agentKeyId_createdAt_idx" ON "MailMessage"("agentKeyId", "createdAt");
