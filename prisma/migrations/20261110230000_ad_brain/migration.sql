-- The Ad Brain, phase 1 (docs/AD_BRAIN.md): one AdJob per self-made ad and the AdAsset cache (frames, clips, music,
-- voice lines, real screen captures) keyed by the SHA-256 of what was asked, plus the private "ad-brain" bucket.

-- CreateTable
CREATE TABLE "AdJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "mode" TEXT NOT NULL DEFAULT 'real',
    "brief" JSONB NOT NULL,
    "brandBrief" JSONB,
    "concept" JSONB,
    "script" JSONB,
    "plan" JSONB,
    "planVersion" INTEGER NOT NULL DEFAULT 0,
    "pending" JSONB NOT NULL DEFAULT '{}',
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "scores" JSONB,
    "fixedOnce" BOOLEAN NOT NULL DEFAULT false,
    "videoPath" TEXT,
    "videoJobId" TEXT,
    "postGroupId" TEXT,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "log" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAsset" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "seconds" DOUBLE PRECISION,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdJob_businessId_createdAt_idx" ON "AdJob"("businessId", "createdAt");
CREATE INDEX "AdJob_status_leaseUntil_idx" ON "AdJob"("status", "leaseUntil");
CREATE UNIQUE INDEX "AdAsset_hash_key" ON "AdAsset"("hash");
CREATE INDEX "AdAsset_kind_createdAt_idx" ON "AdAsset"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "AdJob" ADD CONSTRAINT "AdJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdAsset" ADD CONSTRAINT "AdAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AdJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Like every table: only the server (the database owner) reads and writes them; the browser's Supabase keys never can.
ALTER TABLE "AdJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdAsset" ENABLE ROW LEVEL SECURITY;

-- The private bucket for the Ad Brain's files: no Storage policies, so only the server's key reads and writes it.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('ad-brain', 'ad-brain', false, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'application/json'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'application/json'];
END
$$;
