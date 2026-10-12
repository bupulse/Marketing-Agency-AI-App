-- Content visuals (docs/CONTENT_VISUALS.md): the image, carousel or video that comes with each piece of content.
-- A new table and a wider media bucket (rendered videos) only: nothing existing is rewritten.

CREATE TABLE "ContentVisual" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contentId" TEXT,
    "groupId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "items" JSONB NOT NULL DEFAULT '[]',
    "plan" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "renderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentVisual_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentVisual_kind_check" CHECK ("kind" IN ('image', 'carousel', 'video')),
    CONSTRAINT "ContentVisual_status_check" CHECK ("status" IN ('pending', 'ready', 'failed')),
    CONSTRAINT "ContentVisual_bytes_check" CHECK ("bytes" >= 0 AND "seconds" >= 0),
    -- Every visual belongs to a content version or an Autopilot post group.
    CONSTRAINT "ContentVisual_owner_check" CHECK ("contentId" IS NOT NULL OR "groupId" IS NOT NULL)
);

CREATE INDEX "ContentVisual_contentId_idx" ON "ContentVisual"("contentId");
CREATE INDEX "ContentVisual_groupId_idx" ON "ContentVisual"("groupId");
CREATE INDEX "ContentVisual_businessId_kind_idx" ON "ContentVisual"("businessId", "kind");

ALTER TABLE "ContentVisual" ADD CONSTRAINT "ContentVisual_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentVisual" ADD CONSTRAINT "ContentVisual_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "GeneratedContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reaches the table through Prisma only; the Data API roles get nothing.
ALTER TABLE "ContentVisual" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ContentVisual" FROM PUBLIC, anon, authenticated, service_role;

-- Rendered videos go to the media bucket at <userId>/videos/<visualId>-<n>.mp4 (or .webm). The browser uploads them
-- with a signed upload URL after the server checked the plan, the size (8 MB) and the quota; the bucket's 10 MB cap
-- per file stays. 20261007060000_media_bucket_limits asked for this to be its own migration.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
  WHERE id = 'media';
END
$$;

-- Videos are now a built feature. Pro has "every built feature" and the video seconds (lib/plans.ts PRO_FEATURES), so
-- the Pro plan row gets the key; Standard and the trial (0 video seconds) do not. Admins add it to other plans.
UPDATE "PlanDefinition"
SET "featureKeys" = "featureKeys" || '["video"]'::jsonb
WHERE "key" = 'PRO' AND "featureKeys" IS NOT NULL AND jsonb_typeof("featureKeys") = 'array' AND NOT ("featureKeys" @> '["video"]'::jsonb);
