-- Conversations engine: contacts, the shared inbox, automations and due jobs (docs/INBOX.md, docs/AUTOMATIONS.md).
-- Only new tables, new types and one new nullable column on "Lead": nothing is dropped or rewritten. New tables are locked
-- like every other (row level security on, no Data API grants).

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'TELEGRAM', 'TIKTOK', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('CONTACT', 'BOT', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('MESSAGE', 'COMMENT', 'COMMENT_REPLY', 'STORY_MENTION', 'NOTE');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'LIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'WAITING', 'DONE', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "DueJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "contactId" TEXT;

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "language" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "emailOptIn" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribedAt" TIMESTAMP(3),
    "lastChannel" "ChannelKind",
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactIdentity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "ChannelKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "connectionId" TEXT,
    "handle" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTagLink" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTagLink_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "ContactField" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "ChannelKind" NOT NULL,
    "connectionId" TEXT,
    "externalThreadId" TEXT,
    "chatSessionId" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" UUID,
    "botPausedUntil" TIMESTAMP(3),
    "unread" INTEGER NOT NULL DEFAULT 0,
    "preview" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'MESSAGE',
    "agentId" UUID,
    "text" TEXT NOT NULL,
    "payload" JSONB,
    "externalId" TEXT,
    "postExternalId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "automationRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" TEXT,
    "channels" "ChannelKind"[],
    "graph" JSONB NOT NULL,
    "liveGraph" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "templateKey" TEXT,
    "createdById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "nodeId" TEXT,
    "waitingFor" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "kind" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "DueJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "DueJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_businessId_lastSeenAt_idx" ON "Contact"("businessId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Contact_businessId_email_idx" ON "Contact"("businessId", "email");

-- CreateIndex
CREATE INDEX "Contact_businessId_phone_idx" ON "Contact"("businessId", "phone");

-- CreateIndex
CREATE INDEX "Contact_businessId_createdAt_idx" ON "Contact"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactIdentity_contactId_idx" ON "ContactIdentity"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactIdentity_businessId_channel_externalId_key" ON "ContactIdentity"("businessId", "channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactTag_businessId_name_key" ON "ContactTag"("businessId", "name");

-- CreateIndex
CREATE INDEX "ContactTagLink_tagId_idx" ON "ContactTagLink"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactField_businessId_key_key" ON "ContactField"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_chatSessionId_key" ON "Conversation"("chatSessionId");

-- CreateIndex
CREATE INDEX "Conversation_businessId_status_lastMessageAt_idx" ON "Conversation"("businessId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_businessId_assigneeId_status_idx" ON "Conversation"("businessId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_businessId_channel_externalThreadId_key" ON "Conversation"("businessId", "channel", "externalThreadId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_businessId_createdAt_idx" ON "Message"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_externalId_key" ON "Message"("conversationId", "externalId");

-- CreateIndex
CREATE INDEX "Automation_businessId_status_triggerType_idx" ON "Automation"("businessId", "status", "triggerType");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_status_idx" ON "AutomationRun"("automationId", "status");

-- CreateIndex
CREATE INDEX "AutomationRun_contactId_status_idx" ON "AutomationRun"("contactId", "status");

-- CreateIndex
CREATE INDEX "AutomationRun_businessId_startedAt_idx" ON "AutomationRun"("businessId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DueJob_dedupeKey_key" ON "DueJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "DueJob_status_runAt_idx" ON "DueJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "DueJob_businessId_idx" ON "DueJob"("businessId");

-- CreateIndex
CREATE INDEX "Lead_contactId_idx" ON "Lead"("contactId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIdentity" ADD CONSTRAINT "ContactIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTagLink" ADD CONSTRAINT "ContactTagLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTagLink" ADD CONSTRAINT "ContactTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ContactTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactField" ADD CONSTRAINT "ContactField_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The app reaches these tables through Prisma only; the Data API roles get nothing (like every table,
-- tests/security/rls-coverage.test.ts).
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactTagLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Automation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DueJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Contact", "ContactIdentity", "ContactTag", "ContactTagLink", "ContactField", "Conversation", "Message", "Automation", "AutomationRun", "DueJob" FROM PUBLIC, anon, authenticated, service_role;
