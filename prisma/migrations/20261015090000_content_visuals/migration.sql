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
    "renderingUntil" TIMESTAMP(3),
    "uploadPath" TEXT,
    "uploadBytes" INTEGER NOT NULL DEFAULT 0,
    "uploadExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentVisual_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentVisual_kind_check" CHECK ("kind" IN ('image', 'carousel', 'video')),
    CONSTRAINT "ContentVisual_status_check" CHECK ("status" IN ('pending', 'ready', 'failed')),
    CONSTRAINT "ContentVisual_bytes_check" CHECK ("bytes" >= 0 AND "seconds" >= 0 AND "uploadBytes" >= 0),
    -- Every visual belongs to a content version or an Autopilot post group.
    CONSTRAINT "ContentVisual_owner_check" CHECK ("contentId" IS NOT NULL OR "groupId" IS NOT NULL)
);

CREATE INDEX "ContentVisual_contentId_idx" ON "ContentVisual"("contentId");
CREATE INDEX "ContentVisual_groupId_idx" ON "ContentVisual"("groupId");
CREATE INDEX "ContentVisual_businessId_kind_idx" ON "ContentVisual"("businessId", "kind");
CREATE INDEX "ContentVisual_uploadExpiresAt_idx" ON "ContentVisual"("uploadExpiresAt");

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

-- Videos are now a built feature (owner decision, 12 October 2026). Rwanda Business and East Africa / Global Pro get
-- 8 videos a month of up to 30 s (240 video seconds); the free trial gets one 30 s sample video whatever plan was
-- chosen. Starter and Standard do not: video is sold to them as an add-on or in a custom plan. lib/plans.ts holds the
-- same values for the code's fallback plans.
UPDATE "PlanDefinition"
SET "featureKeys" = "featureKeys" || '["video"]'::jsonb
WHERE ("key" IN ('BUSINESS', 'PRO') OR "isTrial" = true)
  AND "featureKeys" IS NOT NULL AND jsonb_typeof("featureKeys") = 'array' AND NOT ("featureKeys" @> '["video"]'::jsonb);

UPDATE "PlanDefinition"
SET "limits" = jsonb_set("limits", '{videoSeconds}', '240'::jsonb)
WHERE "key" IN ('BUSINESS', 'PRO') AND jsonb_typeof("limits") = 'object';

UPDATE "PlanDefinition"
SET "limits" = jsonb_set("limits", '{videoSeconds}', '30'::jsonb)
WHERE "isTrial" = true AND jsonb_typeof("limits") = 'object';

-- The video add-on in Rwanda: a placeholder price for the admin to set (Admin -> Money -> Add-on prices).
INSERT INTO "AddonPrice" ("id", "addonKey", "regionKey", "currency", "monthlyMinor", "updatedBy", "updatedAt") VALUES
    ('addon_rw_video', 'video', 'RW', 'RWF', 10000, 'migration (placeholder)', CURRENT_TIMESTAMP)
ON CONFLICT ("addonKey", "regionKey") DO NOTHING;
