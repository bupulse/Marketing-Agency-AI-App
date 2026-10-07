-- Phase 5: scheduled posts, the media gallery and Autopilot. Post and PostMetrics were empty and are rebuilt.
CREATE TYPE "PostingMode" AS ENUM ('AUTO', 'NOTIFY');
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'NEEDS_ACTION', 'FAILED', 'CANCELLED');
CREATE TYPE "PostFormat" AS ENUM ('POST', 'CAROUSEL', 'ARTICLE', 'THREAD', 'SCRIPT');
CREATE TYPE "PostSource" AS ENUM ('MANUAL', 'AUTOPILOT');

ALTER TABLE "Business" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE "Connection" ADD COLUMN "postingMode" "PostingMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN "accountType" TEXT,
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "lastError" TEXT;

DROP TABLE "PostMetrics";
DROP TABLE "Post";

CREATE TABLE "AutopilotSettings" (
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "postsPerWeek" INTEGER NOT NULL DEFAULT 3,
    "connectionIds" TEXT[],
    "postingTimes" TEXT[] DEFAULT ARRAY['09:00', '18:00']::TEXT[],
    "useAiImages" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutopilotSettings_pkey" PRIMARY KEY ("businessId")
);
ALTER TABLE "AutopilotSettings" ADD CONSTRAINT "AutopilotSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutopilotRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutopilotRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutopilotRun_businessId_weekStart_key" ON "AutopilotRun"("businessId", "weekStart");
ALTER TABLE "AutopilotRun" ADD CONSTRAINT "AutopilotRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "connectionId" TEXT,
    "network" TEXT NOT NULL,
    "groupId" TEXT,
    "projectId" TEXT,
    "contentId" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "format" "PostFormat" NOT NULL DEFAULT 'POST',
    "source" "PostSource" NOT NULL DEFAULT 'MANUAL',
    "title" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[],
    "mediaPaths" TEXT[],
    "link" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "permalink" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "autopilotRunId" TEXT,
    "playbookId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Post_connectionId_externalId_key" ON "Post"("connectionId", "externalId");
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");
CREATE INDEX "Post_businessId_scheduledAt_idx" ON "Post"("businessId", "scheduledAt");
CREATE INDEX "Post_groupId_idx" ON "Post"("groupId");
ALTER TABLE "Post" ADD CONSTRAINT "Post_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_autopilotRunId_fkey" FOREIGN KEY ("autopilotRunId") REFERENCES "AutopilotRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PostMetrics" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    CONSTRAINT "PostMetrics_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PostMetrics_postId_capturedAt_idx" ON "PostMetrics"("postId", "capturedAt");
ALTER TABLE "PostMetrics" ADD CONSTRAINT "PostMetrics_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MediaFolder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaFolder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediaFolder_businessId_name_key" ON "MediaFolder"("businessId", "name");
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "folderId" TEXT,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediaAsset_path_key" ON "MediaAsset"("path");
CREATE INDEX "MediaAsset_businessId_folderId_createdAt_idx" ON "MediaAsset"("businessId", "folderId", "createdAt");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PostMetrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaFolder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutopilotSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutopilotRun" ENABLE ROW LEVEL SECURITY;
