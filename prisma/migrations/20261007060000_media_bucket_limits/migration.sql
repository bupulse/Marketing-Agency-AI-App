-- The "media" bucket accepted up to 100 MB and video/gif from any signed-in user under <uid>/, which
-- bypassed the gallery's photo type and size checks. Uses today: project photos (<uid>/projects/) and
-- gallery photos (<uid>/gallery/), both signed uploads of JPEG/PNG/WebP up to 10 MB, plus server-made
-- JPEG copies for publishing. The INSERT policy stays because server code uploads with the user's session.
-- Stage 2 (video posts) must raise file_size_limit and add video types again, in its own migration.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  UPDATE storage.buckets
  SET file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
  WHERE id = 'media';
END
$$;
