-- AI clips for content videos (docs/CONTENT_VISUALS.md "Video quality", lib/visuals/ai-clips.ts): a video whose plan
-- says quality "ai" gets real moving clips made by Google Veo overnight, paid in studio credits, before the robot (or
-- the owner's browser) renders it. The state of that work lives on the visual:
-- - clipState: null (nothing to do), "waiting" (marked, not started), "making" (clips at Google), "done" (at least one
--   clip in the plan) or "fallback" (no clip: the simple slideshow, credits given back);
-- - clipJobs: the clips, [{ scene, photoPath, operation, status, path, bytes, error }] (no image bytes);
-- - clipCredits / clipPeriodStart: the studio credits held for the clips, given back once for the clips not made;
-- - clipUntil: when the clips are given up (Google's worst case is 6 minutes); clipLeaseUntil: one sweep at a time.

-- AlterTable
ALTER TABLE "ContentVisual" ADD COLUMN "clipState" TEXT,
ADD COLUMN "clipJobs" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "clipCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "clipPeriodStart" TIMESTAMP(3),
ADD COLUMN "clipUntil" TIMESTAMP(3),
ADD COLUMN "clipLeaseUntil" TIMESTAMP(3);

ALTER TABLE "ContentVisual" ADD CONSTRAINT "ContentVisual_clip_check"
  CHECK (("clipState" IS NULL OR "clipState" IN ('waiting', 'making', 'done', 'fallback')) AND "clipCredits" >= 0);

-- CreateIndex
CREATE INDEX "ContentVisual_clipState_clipLeaseUntil_idx" ON "ContentVisual"("clipState", "clipLeaseUntil");

-- Videos already marked "ai" and not made yet wait for their clips.
UPDATE "ContentVisual" SET "clipState" = 'waiting'
  WHERE "kind" = 'video' AND "status" = 'pending' AND "plan"->>'quality' = 'ai';
