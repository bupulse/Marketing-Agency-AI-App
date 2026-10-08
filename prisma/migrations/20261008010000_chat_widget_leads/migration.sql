-- Phase 6: website chat widget, its conversations, and a fuller Leads inbox.
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'WON', 'LOST');

ALTER TABLE "UsageRecord" ADD COLUMN "chatMessages" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "origin" TEXT,
    "pageUrl" TEXT,
    "language" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatSession_businessId_lastMessageAt_idx" ON "ChatSession"("businessId", "lastMessageAt");
CREATE INDEX "ChatSession_businessId_visitorId_idx" ON "ChatSession"("businessId", "visitorId");
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatWidget" (
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "greeting" TEXT,
    "position" TEXT NOT NULL DEFAULT 'right',
    "accentColor" TEXT,
    "allowedDomains" TEXT[],
    "notifyInstant" BOOLEAN NOT NULL DEFAULT true,
    "notifyDaily" BOOLEAN NOT NULL DEFAULT true,
    "webhookUrl" TEXT,
    "webhookSecretEncrypted" TEXT,
    "lastDigestAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatWidget_pkey" PRIMARY KEY ("businessId")
);
ALTER TABLE "ChatWidget" ADD CONSTRAINT "ChatWidget_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD COLUMN "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN "notes" TEXT,
ADD COLUMN "sessionId" TEXT,
ADD COLUMN "pageUrl" TEXT,
ADD COLUMN "notifiedAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Lead_sessionId_key" ON "Lead"("sessionId");
CREATE INDEX "Lead_businessId_status_idx" ON "Lead"("businessId", "status");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatWidget" ENABLE ROW LEVEL SECURITY;
