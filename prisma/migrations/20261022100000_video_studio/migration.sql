-- Video Studio in the app (docs/VIDEO_APP_INTEGRATION.md): one row per video the studio makes (VideoJob), what each
-- posted video did (VideoOutcome, the Brain's Outcome type), the month's video credits (UsageRecord.videoCredits), a
-- product photo's cut-out (MediaAsset) and each plan's monthly video credits (owner decision, 17 October 2026,
-- provisional: TRIAL 50, STARTER and STANDARD 100, BUSINESS 500, PRO 1,500; other plans 0 until Admin -> Plans sets
-- them; unused credits do not roll over). New tables and columns only: nothing existing is rewritten. The plan change is
-- written to the audit log like an edit in Admin -> Plans.


-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "videoCredits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "cutoutBox" JSONB,
ADD COLUMN     "cutoutPath" TEXT,
ADD COLUMN     "cutoutRefused" TEXT;

-- CreateTable
CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" UUID,
    "productId" TEXT,
    "campaignId" TEXT,
    "contentId" TEXT,
    "parentId" TEXT,
    "engine" TEXT NOT NULL,
    "mode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'designing',
    "templateId" TEXT,
    "hookId" TEXT,
    "platform" TEXT,
    "ratio" TEXT NOT NULL DEFAULT '9:16',
    "seconds" INTEGER NOT NULL,
    "quality" TEXT,
    "brief" JSONB NOT NULL,
    "spec" JSONB,
    "scene" JSONB,
    "prompt" TEXT,
    "references" JSONB NOT NULL DEFAULT '[]',
    "providerTaskId" TEXT,
    "storyboard" JSONB,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoPath" TEXT,
    "posterPath" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "voiceClipId" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "score" JSONB,
    "captionScore" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoOutcome" (
    "id" TEXT NOT NULL,
    "videoJobId" TEXT NOT NULL,
    "postId" TEXT,
    "businessId" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "templateId" TEXT,
    "hookId" TEXT,
    "formatId" TEXT,
    "captionFormulaId" TEXT,
    "seconds" INTEGER NOT NULL,
    "language" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "stats24h" JSONB,
    "stats7d" JSONB,
    "source" TEXT NOT NULL DEFAULT 'bupulse',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoJob_providerTaskId_key" ON "VideoJob"("providerTaskId");

-- CreateIndex
CREATE INDEX "VideoJob_businessId_createdAt_idx" ON "VideoJob"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoJob_status_nextPollAt_idx" ON "VideoJob"("status", "nextPollAt");

-- CreateIndex
CREATE INDEX "VideoJob_engine_status_leaseUntil_idx" ON "VideoJob"("engine", "status", "leaseUntil");

-- CreateIndex
CREATE INDEX "VideoJob_contentId_idx" ON "VideoJob"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoOutcome_postId_key" ON "VideoOutcome"("postId");

-- CreateIndex
CREATE INDEX "VideoOutcome_sector_platform_idx" ON "VideoOutcome"("sector", "platform");

-- CreateIndex
CREATE INDEX "VideoOutcome_businessId_postedAt_idx" ON "VideoOutcome"("businessId", "postedAt");

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "GeneratedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VideoJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_voiceClipId_fkey" FOREIGN KEY ("voiceClipId") REFERENCES "VoiceClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoOutcome" ADD CONSTRAINT "VideoOutcome_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoOutcome" ADD CONSTRAINT "VideoOutcome_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoOutcome" ADD CONSTRAINT "VideoOutcome_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- engine and status are text, checked here (like ContentVisual), so a new status needs no enum migration.
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_engine_check" CHECK ("engine" IN ('motion', 'premium3d', 'seedance'));
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_status_check" CHECK ("status" IN ('designing', 'designed', 'rendering', 'submitted', 'queued', 'running', 'ready', 'failed', 'cancelled', 'preview', 'preview-ready'));
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_numbers_check" CHECK ("credits" >= 0 AND "bytes" >= 0 AND "seconds" BETWEEN 4 AND 30 AND "attempts" >= 0);
ALTER TABLE "VideoOutcome" ADD CONSTRAINT "VideoOutcome_source_check" CHECK ("source" = 'bupulse');
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_videoCredits_check" CHECK ("videoCredits" >= 0);

-- The app reaches these tables through Prisma only; the Data API roles get nothing.
ALTER TABLE "VideoJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VideoOutcome" ENABLE ROW LEVEL SECURITY;

-- Each plan's monthly video credits, only where none is set yet (re-running changes nothing), audited per plan.
WITH before AS (
  SELECT * FROM "PlanDefinition" WHERE jsonb_typeof("limits") = 'object' AND NOT ("limits" ? 'videoCredits')
),
changed AS (
  UPDATE "PlanDefinition" p
  SET
    "limits" = p."limits" || jsonb_build_object('videoCredits', CASE p."key" WHEN 'TRIAL' THEN 50 WHEN 'STARTER' THEN 100 WHEN 'STANDARD' THEN 100 WHEN 'BUSINESS' THEN 500 WHEN 'PRO' THEN 1500 ELSE 0 END),
    "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261022100000_video_studio', 'update_plan', 'plan:' || c."key",
  jsonb_build_object('limits', b."limits"),
  jsonb_build_object('limits', c."limits"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";
