-- The Training Lab (docs/TRAINING_LAB.md, owner decision 24 October 2026): the owner-only library of examples (reels,
-- videos, images and posts, Kinyarwanda recordings, actor clips, posting habits) with notes and ratings that the engines
-- read when they plan. Platform-wide, not per Business. Locked like every other table (row level security on, no Data
-- API grants).

-- CreateTable
CREATE TABLE "TrainingExample" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT,
    "mime" TEXT,
    "bytes" INTEGER,
    "sourceUrl" TEXT,
    "howMade" TEXT NOT NULL,
    "whatIsGood" TEXT NOT NULL,
    "neverThis" TEXT,
    "notes" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sector" TEXT,
    "language" TEXT,
    "technique" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" INTEGER,
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "consentName" TEXT,
    "consentNote" TEXT,
    "consentAt" TIMESTAMP(3),
    "engines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "transcript" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingExample_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrainingExample_kind_check" CHECK ("kind" IN ('reel', 'video', 'image', 'voice', 'actor', 'schedule')),
    CONSTRAINT "TrainingExample_engines_check" CHECK ("engines" <@ ARRAY['video', 'reel', 'image', 'post', 'schedule', 'language', 'presenter']::TEXT[]),
    CONSTRAINT "TrainingExample_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
    CONSTRAINT "TrainingExample_bytes_check" CHECK ("bytes" IS NULL OR "bytes" >= 0)
);

-- CreateIndex
CREATE INDEX "TrainingExample_kind_createdAt_idx" ON "TrainingExample"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingExample_sector_idx" ON "TrainingExample"("sector");

-- CreateIndex
CREATE INDEX "TrainingExample_language_idx" ON "TrainingExample"("language");

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "TrainingExample" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TrainingExample" FROM PUBLIC, anon, authenticated, service_role;

-- The examples' files live in their own private bucket, up to 100 MB a file. It has no Storage policies, so a browser
-- can neither read nor write there on its own: only the server's key issues upload tokens and short-lived links
-- (lib/training-lab/storage.ts). Idempotent, like the other bucket migrations.
-- Note: Supabase's Free plan caps every upload at 50 MB whatever the bucket says (Storage settings, "Upload file size
-- limit"); files between 50 and 100 MB need the Pro plan's higher project limit.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('training-lab', 'training-lab', false, 104857600, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 104857600,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav'];
END
$$;
