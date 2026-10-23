-- BuPulse support chat (docs/SUPPORT_CHAT.md, section 9 "Server"): BuPulse's own help chat with an AI that answers
-- first and agents who take over in the support app. New: the Support* tables, the four departments, the heartbeat
-- RPC (the only thing the browser's anon key may call), RLS that closes every Support* table to the Data API, the
-- Realtime policies for the private staff topics, full-text search over the guide sections and the private "support"
-- Storage bucket. Visitors never get a Supabase session: their real-time topic `sv:<secret>` is public and carries
-- content-free pings only.

-- CreateEnum
CREATE TYPE "SupportRole" AS ENUM ('AGENT', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('AI', 'WAITING', 'OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportAuthor" AS ENUM ('VISITOR', 'AI', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportMessageKind" AS ENUM ('TEXT', 'NOTE', 'EVENT', 'FILE', 'VOICE');

-- CreateTable
CREATE TABLE "SupportAgent" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" UUID,
    "role" "SupportRole" NOT NULL DEFAULT 'AGENT',
    "status" TEXT NOT NULL DEFAULT 'invited',
    "availability" TEXT NOT NULL DEFAULT 'offline',
    "maxChats" INTEGER NOT NULL DEFAULT 5,
    "invitedBy" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportDepartment" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SupportDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAgentDepartment" (
    "agentId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "SupportAgentDepartment_pkey" PRIMARY KEY ("agentId","departmentId")
);

-- CreateTable
CREATE TABLE "SupportVisitor" (
    "id" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "userId" UUID,
    "businessId" TEXT,
    "creatorProfileId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "businessName" TEXT,
    "leadId" TEXT,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportVisit" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "ip" TEXT,
    "country" TEXT,
    "city" TEXT,
    "region" TEXT,
    "timezone" TEXT,
    "device" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "referrer" TEXT,
    "landingPath" TEXT,
    "currentPath" TEXT,
    "currentTitle" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportPageHit" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportPageHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "visitorId" TEXT NOT NULL,
    "visitId" TEXT,
    "surface" TEXT NOT NULL,
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'AI',
    "departmentId" TEXT,
    "assigneeId" TEXT,
    "aiActive" BOOLEAN NOT NULL DEFAULT true,
    "handoverAt" TIMESTAMP(3),
    "handoverReason" TEXT,
    "waitingSince" TIMESTAMP(3),
    "firstHumanReplyAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVisitorMessageAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "language" TEXT,
    "summary" TEXT,
    "summaryAt" TIMESTAMP(3),
    "leadScore" INTEGER,
    "urgency" TEXT,
    "tags" TEXT[],
    "aiReplyCount" INTEGER NOT NULL DEFAULT 0,
    "agentReplyCount" INTEGER NOT NULL DEFAULT 0,
    "aiResolved" BOOLEAN,
    "rating" INTEGER,
    "ratingComment" TEXT,
    "transcriptSentAt" TIMESTAMP(3),
    "alertSentAt" TIMESTAMP(3),
    "ticketSentAt" TIMESTAMP(3),
    "visitorDraft" TEXT,
    "visitorDraftAt" TIMESTAMP(3),
    "assist" JSONB,
    "assistMessageId" TEXT,
    "topicTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "author" "SupportAuthor" NOT NULL,
    "agentId" TEXT,
    "kind" "SupportMessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "lang" TEXT,
    "translations" JSONB,
    "attachmentId" TEXT,
    "aiSources" JSONB,
    "aiConfident" BOOLEAN,
    "clientMsgId" TEXT,
    "seenByVisitorAt" TIMESTAMP(3),
    "seenByAgentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "fileName" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER,
    "transcript" TEXT,
    "transcriptStatus" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportGuideChunk" (
    "id" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "page" TEXT,
    "heading" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "hash" TEXT NOT NULL,

    CONSTRAINT "SupportGuideChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportDevice" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB,
    "label" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conversationId" TEXT,
    "agentId" TEXT,
    "value" INTEGER,
    "valueInHours" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportAgent_email_key" ON "SupportAgent"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SupportAgent_userId_key" ON "SupportAgent"("userId");

-- CreateIndex
CREATE INDEX "SupportAgent_status_availability_idx" ON "SupportAgent"("status", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "SupportDepartment_key_key" ON "SupportDepartment"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SupportVisitor_visitorKey_key" ON "SupportVisitor"("visitorKey");

-- CreateIndex
CREATE INDEX "SupportVisitor_userId_idx" ON "SupportVisitor"("userId");

-- CreateIndex
CREATE INDEX "SupportVisitor_lastSeenAt_idx" ON "SupportVisitor"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportVisit_tokenHash_key" ON "SupportVisit"("tokenHash");

-- CreateIndex
CREATE INDEX "SupportVisit_lastSeenAt_idx" ON "SupportVisit"("lastSeenAt");

-- CreateIndex
CREATE INDEX "SupportVisit_visitorId_startedAt_idx" ON "SupportVisit"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "SupportPageHit_visitId_at_idx" ON "SupportPageHit"("visitId", "at");

-- CreateIndex
CREATE INDEX "SupportPageHit_at_idx" ON "SupportPageHit"("at");

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_number_key" ON "SupportConversation"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_topicTokenHash_key" ON "SupportConversation"("topicTokenHash");

-- CreateIndex
CREATE INDEX "SupportConversation_status_lastMessageAt_idx" ON "SupportConversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_assigneeId_status_idx" ON "SupportConversation"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "SupportConversation_visitorId_createdAt_idx" ON "SupportConversation"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportConversation_waitingSince_idx" ON "SupportConversation"("waitingSince");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_attachmentId_key" ON "SupportMessage"("attachmentId");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_conversationId_clientMsgId_key" ON "SupportMessage"("conversationId", "clientMsgId");

-- CreateIndex
CREATE INDEX "SupportAttachment_expiresAt_idx" ON "SupportAttachment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportGuideChunk_file_anchor_key" ON "SupportGuideChunk"("file", "anchor");

-- CreateIndex
CREATE UNIQUE INDEX "SupportDevice_endpoint_key" ON "SupportDevice"("endpoint");

-- CreateIndex
CREATE INDEX "SupportEvent_name_at_idx" ON "SupportEvent"("name", "at");

-- AddForeignKey
ALTER TABLE "SupportAgentDepartment" ADD CONSTRAINT "SupportAgentDepartment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SupportAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAgentDepartment" ADD CONSTRAINT "SupportAgentDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "SupportDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportVisit" ADD CONSTRAINT "SupportVisit_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "SupportVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportPageHit" ADD CONSTRAINT "SupportPageHit_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "SupportVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "SupportVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "SupportVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "SupportDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "SupportAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SupportAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "SupportAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDevice" ADD CONSTRAINT "SupportDevice_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "SupportAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The departments that route chats (docs/SUPPORT_CHAT.md section 3). Admin -> Live chat may rename them.
INSERT INTO "SupportDepartment" ("id", "key", "name", "sort") VALUES
  ('supdept_sales', 'sales', 'Sales', 0),
  ('supdept_technical', 'technical', 'Technical help', 1),
  ('supdept_billing', 'billing', 'Billing', 2),
  ('supdept_creators', 'creators', 'Creators', 3)
ON CONFLICT ("key") DO NOTHING;

-- Full-text search over the guide sections (lib/support/guide.ts): title and heading weigh more than the body. Not in
-- the Prisma schema (Prisma cannot describe a generated tsvector); reads go through $queryRaw.
ALTER TABLE "SupportGuideChunk" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '') || ' ' || coalesce("heading", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("body", '')), 'B')
) STORED;
CREATE INDEX "SupportGuideChunk_tsv_idx" ON "SupportGuideChunk" USING GIN ("tsv");

-- The app reaches these tables through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "SupportAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportDepartment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAgentDepartment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportVisitor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportPageHit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportGuideChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  "SupportAgent", "SupportDepartment", "SupportAgentDepartment", "SupportVisitor", "SupportVisit", "SupportPageHit",
  "SupportConversation", "SupportMessage", "SupportAttachment", "SupportGuideChunk", "SupportDevice", "SupportEvent"
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE "SupportConversation_number_seq" FROM PUBLIC, anon, authenticated, service_role;
-- Chat numbers people read out ("#1001") start at four digits.
ALTER SEQUENCE "SupportConversation_number_seq" RESTART WITH 1001;

-- The visitor's heartbeat (contract.ts HEARTBEAT_RPC), called straight from the browser with the anon key every
-- 30-60 s while the tab is visible, so browsing costs no Netlify function call (docs/research/support-chat-research.md
-- 3.2). It finds the visit by the token's SHA-256 (the token itself is never stored), notes the time and the page, and
-- adds a page hit when the page changed (50 per visit at most). Rate limit: one write per 10 s per visit, page changes
-- at most one a second; anything faster is answered "throttled" without writing. A visit idle 20 minutes (or ended) is
-- "expired": the widget then starts a new one through POST /api/support/v1/visit. A page change pings the private
-- staff topic so the live-visitors list updates; a failed ping never fails the heartbeat.
CREATE OR REPLACE FUNCTION public.support_heartbeat(p_token text, p_path text, p_title text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamp := (now() AT TIME ZONE 'utc');
  v_visit "SupportVisit"%ROWTYPE;
  v_path text := nullif(left(coalesce(p_path, ''), 500), '');
  v_title text := nullif(left(coalesce(p_title, ''), 300), '');
  v_changed boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  SELECT * INTO v_visit FROM "SupportVisit" WHERE "tokenHash" = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown');
  END IF;
  IF v_visit."endedAt" IS NOT NULL OR v_visit."lastSeenAt" < v_now - interval '20 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  v_changed := v_path IS NOT NULL AND v_path IS DISTINCT FROM v_visit."currentPath";
  IF (NOT v_changed AND v_visit."lastSeenAt" > v_now - interval '10 seconds') OR (v_changed AND v_visit."lastSeenAt" > v_now - interval '1 second') THEN
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;
  UPDATE "SupportVisit" SET
    "lastSeenAt" = v_now,
    "currentPath" = coalesce(v_path, "currentPath"),
    "currentTitle" = CASE WHEN v_changed THEN v_title ELSE coalesce(v_title, "currentTitle") END,
    "pageCount" = "pageCount" + CASE WHEN v_changed THEN 1 ELSE 0 END
  WHERE "id" = v_visit."id";
  IF v_changed THEN
    IF v_visit."pageCount" < 50 THEN
      INSERT INTO "SupportPageHit" ("id", "visitId", "path", "title", "at") VALUES (gen_random_uuid()::text, v_visit."id", v_path, v_title, v_now);
    END IF;
    BEGIN
      PERFORM realtime.send(jsonb_build_object('type', 'visitor.changed', 'visitId', v_visit."id"), 'support', 'staff:visitors', true);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.support_heartbeat(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_heartbeat(text, text, text) TO anon, authenticated;

-- Who may join a private support topic: an active, unlocked SupportAgent signed in with their authenticator code
-- (aal2). Staff topics (staff:inbox, staff:visitors, staff:presence) and conversation topics (conv:<id>) are open to
-- every such agent; agent:<id> only to that agent. Realtime caches the answer for the life of the socket, so locking
-- an agent also sends agent.force_logout (lib/support/agents.ts).
CREATE OR REPLACE FUNCTION public.support_realtime_allowed(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2' AND EXISTS (
    SELECT 1 FROM "SupportAgent" a
    WHERE a."userId" = auth.uid() AND a."status" = 'active' AND a."lockedAt" IS NULL
      AND (p_topic LIKE 'staff:%' OR p_topic LIKE 'conv:%' OR p_topic = 'agent:' || a."id")
  );
$$;
REVOKE ALL ON FUNCTION public.support_realtime_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_realtime_allowed(text) TO authenticated;

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime schema not found, skipping the support topic policies';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS "support agents receive" ON realtime.messages;
  DROP POLICY IF EXISTS "support agents share presence" ON realtime.messages;
  DROP POLICY IF EXISTS "support topics need an agent" ON realtime.messages;
  CREATE POLICY "support agents receive" ON realtime.messages FOR SELECT TO authenticated
    USING (realtime.messages.extension IN ('broadcast', 'presence') AND public.support_realtime_allowed(realtime.topic()));
  CREATE POLICY "support agents share presence" ON realtime.messages FOR INSERT TO authenticated
    WITH CHECK (realtime.messages.extension = 'presence' AND realtime.topic() = 'staff:presence' AND public.support_realtime_allowed(realtime.topic()));
  -- Whatever other policy is added later, the support prefixes stay closed to anyone who is not an agent.
  CREATE POLICY "support topics need an agent" ON realtime.messages AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (realtime.topic() LIKE 'staff:%' OR realtime.topic() LIKE 'conv:%' OR realtime.topic() LIKE 'agent:%') OR public.support_realtime_allowed(realtime.topic()))
    WITH CHECK (NOT (realtime.topic() LIKE 'staff:%' OR realtime.topic() LIKE 'conv:%' OR realtime.topic() LIKE 'agent:%') OR public.support_realtime_allowed(realtime.topic()));
END
$$;

-- Screenshots, photos, PDFs and voice notes sent in the chat (contract.ts UPLOAD_LIMITS: 10 MB). Private, with no
-- Storage policies: only the server's key issues upload tokens and signed download links (lib/support/uploads.ts).
-- Files are deleted when they expire (the retention job). Idempotent, like the other bucket migrations.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('support', 'support', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
END
$$;
