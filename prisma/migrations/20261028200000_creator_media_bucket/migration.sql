-- Creator campaigns (docs/CREATOR_CAMPAIGNS.md, "Limits"): the images and videos creators hand in live in their own
-- private bucket, up to 100 MB a file. It has no Storage policies, so a browser can neither read nor write there on
-- its own: only the server's key issues upload tokens (lib/creators/media.ts) and reads the files. The daily cleanup
-- deletes a campaign's files 60 days after it ends. Idempotent, like the other bucket migrations.
-- Note: Supabase's Free plan caps every upload at 50 MB whatever the bucket says (Storage settings, "Upload file size
-- limit"); files between 50 and 100 MB need the Pro plan's higher project limit.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('creator-media', 'creator-media', false, 104857600, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 104857600,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
END
$$;
