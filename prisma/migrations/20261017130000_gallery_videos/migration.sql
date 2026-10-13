-- Gallery videos (docs/MEDIA.md): the owner's own MP4 / MOV / WebM clips (up to 60 s and 50 MB) go in the Gallery,
-- folders and albums like photos, so AI content uses them first. Additive: existing rows are photos.
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "posterPath" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_kind_check";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_kind_check" CHECK ("kind" IN ('photo', 'video'));
ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_description_check";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_description_check" CHECK ("description" IS NULL OR char_length("description") <= 500);

-- The media bucket takes gallery videos: 50 MB a file (the Supabase free plan's limit), MP4 and WebM (MOV is
-- uploaded as MP4). The server still checks each kind's own limit (photos 10 MB, rendered videos 8 MB) and the bytes.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  UPDATE storage.buckets
  SET file_size_limit = 52428800,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg']
  WHERE id = 'media';
END
$$;
