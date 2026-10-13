-- Content packs (docs/CONTENT_PACKS.md): "Write content" makes several different posts, each with its angle and its
-- own app. Three nullable columns on GeneratedContent and an index: content from before stays as it is (one post for
-- every app). The pack size lives in Business.contentSettings (JSON, packSize 3 to 7, default 5): no column.
ALTER TABLE "GeneratedContent" ADD COLUMN IF NOT EXISTS "packId" TEXT;
ALTER TABLE "GeneratedContent" ADD COLUMN IF NOT EXISTS "angle" TEXT;
ALTER TABLE "GeneratedContent" ADD COLUMN IF NOT EXISTS "network" TEXT;
CREATE INDEX IF NOT EXISTS "GeneratedContent_packId_idx" ON "GeneratedContent"("packId");
